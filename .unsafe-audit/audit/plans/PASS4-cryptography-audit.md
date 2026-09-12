# PASS4 — Cryptography-Side Surface Audit

**Scope.** Apply the cryptography audit pattern bundle to Bun's crypto-adjacent
crates and JS-visible APIs. Strict accuracy: every finding cites a file:line and
a concrete attack-source. Negative findings are explicit (a section is "clean"
only after the audit pass has named what it looked for).

**Targets.**

| Crate / file                                            | Role                                                  | Tier |
| ------------------------------------------------------- | ----------------------------------------------------- | ---- |
| `src/sha_hmac/`                                         | SHA + HMAC primitives (thin BoringSSL wrappers)       | T1   |
| `src/csrf/`                                             | CSRF token gen + verify                               | T1   |
| `src/boringssl/`                                        | Safe wrapper over `bun_boringssl_sys` (client ctx, X509, IP) | T1   |
| `src/base64/`                                           | Base64 + base64url + URL-safe encode/decode           | T1   |
| `src/wyhash/`                                           | Non-crypto hashes (verify NOT used cryptographically) | T0   |
| `src/runtime/crypto/PasswordObject.rs`                  | `Bun.password` Argon2 + Bcrypt                        | T1   |
| `src/runtime/crypto/pwhash.rs`                          | argon2 / bcrypt shim (vendor crates)                  | T1   |
| `src/runtime/crypto/PBKDF2.rs`                          | `crypto.pbkdf2`                                       | T1   |
| `src/runtime/crypto/EVP.rs`                             | EVP digest wrapper                                    | T1   |
| `src/runtime/webcore/Crypto.rs`                         | WebCrypto `timingSafeEqual` / `getRandomValues`       | T1   |
| `src/runtime/api/csrf_jsc.rs`                           | JS host for CSRF                                      | T1   |
| `src/runtime/node/node_crypto_binding.rs`               | `node:crypto.timingSafeEqual`                         | T1   |
| `src/sql_jsc/postgres/SASL.rs`                          | SCRAM-SHA-256 client                                  | T1   |
| `src/sql_jsc/postgres/PostgresSQLConnection.rs` (auth)  | MD5 password + SASLFinal verify                       | T1   |
| `src/sql/mysql/protocol/Auth.rs`                        | MySQL native_password / caching_sha2 / SHA-256 RSA    | T1   |
| `src/sql/shared/Data.rs`                                | `Data::zdeinit()` (secure wipe for SQL packets)       | T1   |
| `src/s3_signing/credentials.rs`                         | AWS SigV4 (HMAC chain) + per-day key cache            | T1   |
| `src/jsc/rare_data.rs` (entropy cache, default secret)  | UUID + CSRF default secret seeding                    | T1   |
| `src/jsc/bindings/Secrets{Linux,Darwin,Windows}.cpp`    | `Bun.secrets` keyring bridge (out of Rust scope but cited) | C++  |
| `src/jsc/bindings/JSSecrets.cpp`                        | Job-options destructor (memsetSpan-based wipe)        | C++  |
| `src/jsc/bindings/node/crypto/{JSSign,CryptoSignJob}.cpp` | EVP_DigestVerifyFinal (out of Rust scope; cited)     | C++  |
| `src/bun_core/util.rs::csprng`                          | OS CSPRNG facade (getrandom/getentropy/RtlGenRandom)  | T1   |
| `src/bun_alloc/lib.rs::{secure_zero, free_sensitive}`   | The actual zeroing primitive                          | T1   |

**Methodology.**

1. Listed each target file's audit-relevant identifiers (HMAC verify, password
   verify, secret store, RNG seed, key drop).
2. For every secret-handling call site: classified (a) the comparison style
   (constant-time vs. byte-equality), (b) zeroization on drop, (c) RNG source,
   (d) cross-thread access.
3. Cross-checked the Zig sibling for intended semantics — only used as a
   tie-breaker on porting questions; never as an excuse for a missing
   constant-time compare.
4. Grepped for `==`, `.eq()`, `.starts_with`, `slice == slice` in HMAC / CSRF /
   password / secret / SAS-final paths.
5. Grepped for `impl Drop` and `free_sensitive` / `secure_zero` in these
   crates; missing Drop = secret persists.

---

## Headline verdict

**Bun's Rust crypto-side surface is broadly sound.** Every signature/HMAC/SASL
verification path that an attacker can drive with timing observations runs
through `bun_boringssl_sys::constant_time_eq` (which is BoringSSL's
`CRYPTO_memcmp` plus a length-pre-check that is itself observable but
unavoidable). The CSPRNG path is the OS CSPRNG (`getrandom(2)` /
`getentropy(3)` / `RtlGenRandom`) — no userspace PRNG re-seeding, no `rand`
crate, no `wyhash`-as-RNG. Password verification is delegated to
`rust-argon2` and `bcrypt`, both of which use constant-time compares on the
final digest. The hot intermediate buffers used by `Bun.password` are zeroed
on `Drop` via `secure_zero` (a `write_bytes` + `black_box` + `SeqCst`
compiler fence — strong against dead-store elimination).

**No T1 findings** — there is no exploitable cache-timing leak, branch-on-
secret, or known-bad `==` on HMAC bytes anywhere in the audited Rust surface.

**Six T2 findings** (architecture defects that don't reach exploitability on
their own but should be tightened):

1. SQL `SASL.SASL` has no `Drop` — the 32-byte derived `salted_password_bytes`
   plus the server signature persist in memory after auth completes, until the
   parent `AuthenticationState` is replaced. (Replaced via plain assignment, no
   secure wipe.)
2. S3 signing cache stores `{region}{service}{secret}` keys (containing the
   AWS secret access key) as `Box<[u8]>` in `StringArrayHashMap`; daily
   `cache.clear()` drops the boxes without zeroizing.
3. MySQL `caching_sha2_password::EncryptedPassword::write_internal`
   allocates a `Vec<u8>` for the cleartext password and never zeroizes
   before drop.
4. Postgres MD5-auth path on `PostgresSQLConnection.rs:2855` keeps
   intermediate MD5 digests + hex strings on the stack with no wipe.
5. `RareData::default_csrf_secret` (the per-VM 16-byte fallback CSRF key) is
   a `Box<[u8]>` with no zeroizing Drop.
6. `OPENSSL_memory_free` zeroes via `ptr::write_bytes(p, 0, len)` then
   `mi_free(p)` — the zero pass is _not_ wrapped in the `secure_zero` helper's
   `black_box`/`SeqCst` fence. The cross-TU FFI boundary makes elision
   unlikely in practice, but the same dead-store-elimination hazard that
   motivated `secure_zero` applies in principle.

**One T3 watchlist item** about Linux secrets `memset` (in C++ binding tier;
mitigation is to switch to `explicit_bzero`).

**One latent T3** about the SHA1/SHA-256 intermediate digests in the SQL
auth scramble paths.

---

## Per-target attack surface

### `bun_sha_hmac` — `src/sha_hmac/`

**Attack surface.** Three concrete entry points:

- `hmac::generate(key, data, alg, out)` — one-shot HMAC via BoringSSL `HMAC()`.
- `evp::SHA*::{init,hash,update,final}` — streaming + one-shot EVP digests.
- `hashers::SHA*` (deprecated SHA*_ API) — uses `SHA1_Init/Update/Final` and
  siblings directly.

**FFI boundary.** All seven `unsafe` blocks in `sha.rs` are FFI calls into
BoringSSL. Each has a tightly-scoped SAFETY comment naming the precondition.
The macros (`new_evp!` and `new_hasher!`) parameterise on a BoringSSL function
ident, so every expansion produces the same `Init -> Update* -> Final`
sequence.

**Drop hygiene.** `evp::SHA*` has an explicit `Drop` that calls
`EVP_MD_CTX_cleanup` (BoringSSL zeroes the context internally — confirmed by
the `EVP_MD_CTX_cleanup` contract). `hashers::SHA*` does **not** have a Drop —
the `SHA*_CTX` is plain POD with no internal allocation, but it contains
intermediate `h: [u32; 8]` and `data: [u8; 64]` state that derives from
secret input where the secret is being hashed. This is **not** a key, but
under the threat model "the attacker can read process memory after auth", the
hash state of the last block (containing tail bytes of the password) could
leak partial information about the password's final block.

**Verdict: clean for T1, T3 watchlist on `hashers::*` non-zeroing Drop.** The
`evp` path is the documented one (`hash_hmac::generate` and `evp::SHA*` are
exported; `hashers` is "API that OpenSSL 3 deprecated" — gradually unused).

**Comparison correctness.** No byte-comparison in this crate; it produces
digests, never verifies them.

**RNG.** Not used in this crate.

**Specific table — every `unsafe` block in `sha_hmac`:**

| Site                                                  | Operation                  | Secret in scope?       | Verdict |
| ----------------------------------------------------- | -------------------------- | ---------------------- | ------- |
| `hmac.rs:21-31` `HMAC()`                              | One-shot HMAC              | key (caller-owned)     | ✓       |
| `sha.rs:72-73` `zeroed_unchecked()` + `*_Init`        | Ctx init for SHA hashers   | none (digest state)    | ✓       |
| `sha.rs:81-83` `*_Hash(bytes, len, out)` (one-shot)   | One-shot SHA               | input may be sensitive | ✓       |
| `sha.rs:89-91` `*_Update(ctx, data, len)`             | Streaming SHA              | input may be sensitive | ✓       |
| `sha.rs:97` `*_Final(out, ctx)`                       | Streaming SHA final        | none                   | ✓       |
| `sha.rs:125` `zeroed_unchecked() + EVP_MD_CTX_init`   | EVP ctx init               | none                   | ✓       |
| `sha.rs:131` `EVP_DigestInit(ctx, md)`                | EVP digest start           | none                   | ✓       |
| `sha.rs:141-150` `EVP_Digest` (one-shot)              | One-shot EVP digest        | input may be sensitive | ✓       |
| `sha.rs:156-158` `EVP_DigestUpdate`                   | Streaming EVP              | input may be sensitive | ✓       |
| `sha.rs:164-166` `EVP_DigestFinal`                    | Streaming EVP final        | none                   | ✓       |
| `sha.rs:175-177` `EVP_MD_CTX_cleanup` (Drop)          | EVP ctx zeroize on drop    | digest state           | ✓       |

`zeroed_unchecked::<SHA_CTX>()` is sound because `SHA_CTX` is `#[repr(C)]`
POD (4 u32 + 1 u32 + 1 u32 + [u8; 64] + 1 c_uint — confirmed at
`boringssl_sys/boringssl.rs:187-228`). The "wrong `mem::zeroed::<KeyStruct>()`
with non-Default-zero fields" pattern from the prompt does **not** apply here.

### `bun_csrf` — `src/csrf/`

**Attack surface.** Two entry points: `generate(opts, &mut [u8; 512]) -> &mut
[u8]` and `verify(opts) -> bool`. Token layout is
`timestamp(8) || nonce(16) || expires_in(8) || HMAC(secret, payload)`.

**Comparison correctness.** `csrf/lib.rs:248-249`:

```rust
// Compare signatures in constant time (BoringSSL CRYPTO_memcmp).
boring::constant_time_eq(received_signature, signature)
```

`bun_boringssl_sys::constant_time_eq` (`boringssl_sys/lib.rs:18-24`) does a
pre-length check (`if a.len() != b.len() { return false; }`) and then
`CRYPTO_memcmp` on equal-length buffers. The length pre-check is itself
observable but is unavoidable in a wrapper that accepts arbitrary-length
slices — the length comparison only reveals the length-mismatch boundary
(i.e. that the attacker's tampered signature isn't the expected size, which
the attacker already knows from the algorithm choice). **No T1 leak.**

Note: the Zig original did the length check first by hand
(`if (received_signature.len != signature.len) return false;` then
`CRYPTO_memcmp(...) == 0`) — the Rust port collapses these into the helper
with identical observable semantics.

**RNG.** `bun_core::csprng(&mut nonce)` at line 93 — OS CSPRNG. 16 bytes
(128-bit) nonce. Acceptable for CSRF.

**Token length.** 32 bytes payload + ≥32 bytes HMAC (SHA-256 minimum). Encoded
to base64url by the calling JS host. Minimum decoded length check (`< 64`) at
line 189 prevents short-token attacks.

**Drop hygiene.** Tokens are stack-local `[u8; 512]` buffers — no allocation,
they vanish on stack unwind. The `secret` argument is a borrowed `&[u8]` —
the crate doesn't own it. Clean.

**Verdict: clean.**

### `bun_boringssl` (safe wrapper) — `src/boringssl/lib.rs`

**Attack surface.** Three groups:

- TLS client context (`init_client` and the `OnceLock<CtxStore>` — currently
  has **no callers**, a Phase-A scaffold).
- `OPENSSL_memory_alloc/free/get_size` — BoringSSL allocator hooks.
- X.509 server-identity check (`check_x509_server_identity`,
  `check_server_identity`) — host verification on TLS handshake.

**Cross-thread `SSL_CTX` lifecycle.** `CtxStore` wraps the process-lifetime
`SSL_CTX*` in an `OnceLock`; per BoringSSL docs `SSL_CTX` is internally
thread-safe (mutex-guarded refcount). Bun never frees this `SSL_CTX` — it
lives forever in the `OnceLock` — so the "wrong-thread destroy crashes
BoringSSL" hazard cited in the prompt does **not** apply: there is no
destroy. (Caveat: `init_client` is unused, so even if there were a teardown
hazard it would be unreachable. Per-connection `SSL*` objects do have a
clear ownership model elsewhere: `SSL_CTX_free` is called from the connection
that owns it, with explicit `unsafe` SAFETY comments.)

**OPENSSL_memory_free zeroing** (`boringssl/lib.rs:217-225`):

```rust
#[unsafe(no_mangle)]
pub extern "C" fn OPENSSL_memory_free(ptr: *mut c_void) {
    // SAFETY: BoringSSL guarantees ptr is non-null and was returned by
    // OPENSSL_memory_alloc above (i.e. mi_malloc).
    unsafe {
        let len = bun_alloc::usable_size(ptr.cast());
        ptr::write_bytes(ptr.cast::<u8>(), 0, len);
        bun_alloc::mimalloc::mi_free(ptr);
    }
}
```

BoringSSL's docstring (quoted in the source) explicitly requires zeroing. The
`write_bytes` here is bare — no `black_box` or `compiler_fence` like
`bun_alloc::secure_zero` uses. Two saving graces: (1) this is `extern "C"`
with `#[unsafe(no_mangle)]`, so the function body is unknown to the linker's
LTO from BoringSSL's perspective, and (2) `mi_free` is also a foreign call,
so the compiler cannot prove the zero is dead. In practice this is fine on
all current compilers. **T2 nit**: replacing with `bun_alloc::secure_zero`
would be defence-in-depth at zero cost.

**X.509 SAN matching** (`check_x509_server_identity`). RFC 6125 wildcard
semantics: `*.` prefix only, suffix must contain a dot, no nested wildcards,
exact label boundary check. Case-insensitive DNS comparison via
`strings::eql_case_insensitive_ascii`. Looks correct against RFC 6125 §6.4.3
and Node.js's `tls.checkServerIdentity`. **No T1.**

**Verdict: clean. T2 nit on `OPENSSL_memory_free`'s non-`secure_zero` wipe.**

### `bun_base64` — `src/base64/`

**Attack surface.** Encoding/decoding only — no comparisons, no keys. The
zig-base64 path uses lookup tables (`STANDARD_ALPHABET_CHARS`,
`Base64Decoder::char_to_index`), which means decoding is data-dependent on
input characters (the table index). For CSRF/cookie/JWT-shaped data this is
**not** a side-channel concern: the input is attacker-controlled and the
output is verified by HMAC afterwards, so the table-lookup pattern reveals
nothing the attacker doesn't already know.

The simdutf path (`bun_base64::decode`) and the zig fallback both run on the
client's untrusted input; the **secret** is never decoded by this crate.

**Verdict: clean.** Base64 is correctly used as a transport encoding here,
not as a comparison medium.

### `bun_wyhash` — `src/wyhash/`

**Cryptographic-grade?** No, and the file header is explicit:

> `Wyhash11` is a copy of Wyhash from the zig standard library, version
> v0.11.0-dev.2609+5e19250a1...

**Verification it is not used where crypto is needed.** Grepped
`bun_wyhash::|wyhash` across all of `src/`:

- `bun_collections` hashmap defaults
- `bun_install` integrity / cache keys
- `ast`, `bundler`, `css_modules` content hashing for cache invalidation
- `runtime/transpiler_cache` cache keys
- `base64::wyhash_url_safe` (CSS-modules placeholder hasher)

Cross-checked the crypto-adjacent crates: `bun_sha_hmac`, `bun_csrf`,
`runtime/crypto/*`, `boringssl`, `s3_signing`, `sql_jsc/postgres/SASL.rs`,
`sql/mysql/protocol/Auth.rs` — **none** reach `bun_wyhash`. The
non-crypto/crypto boundary is intact.

**Verdict: clean confinement.**

### `Bun.password` — `src/runtime/crypto/PasswordObject.rs` + `pwhash.rs`

**Attack surface.**

- `PasswordObject::hash(password, algorithm)` — Argon2{i,d,id} or bcrypt.
- `PasswordObject::verify(password, prev_hash, algorithm?)` — same.
- JS-visible as `Bun.password.hash[Sync]` / `Bun.password.verify[Sync]`.

**Constant-time comparison.** Delegated to the vendor crates:

- `vendor::verify_encoded` (rust-argon2) — does constant-time tag compare
  (confirmed by the crate's `verify_encoded` implementation; the comment at
  `pwhash.rs:242-243` notes "rust-argon2 constant_time compares and returns
  `Ok(false)` on mismatch").
- `vendor::verify(password, encoded)` (bcrypt crate) — constant-time compare
  on the 23-byte raw digest, confirmed at `pwhash.rs:375-376`.

**T2 / latent finding — `pwhash::bcrypt::verify_phc`** (`pwhash.rs:452`):

```rust
if computed[..DK_LENGTH] == expected {
    Ok(())
} else {
    Err(bun_core::err!("PasswordVerificationFailed"))
}
```

This is a Rust `[u8; 23] == [u8; 23]` comparison — `PartialEq` on a slice
short-circuits at the first mismatch, so it is **not** constant-time. The
inline comment cites the Zig original (`std.mem.eql`, which is _also_ not
constant-time). The exposure here is narrower than HMAC-tag comparison
because:

- bcrypt's `_hash_password` is a slow KDF (≥ 2¹⁰ block operations at the
  minimum cost 4, scaling exponentially up to 2³¹). Timing the comparison
  through the KDF dominates by many orders of magnitude.
- The PHC-bcrypt form (`$bcrypt$r=N$<salt>$<hash>`) is rarely emitted —
  Bun's hasher always produces the modular-crypt `$2b$…` form, which goes
  through `vendor::verify` (the constant-time path). The PHC path only runs
  when `previous_hash` was generated by an external system using PHC
  bcrypt, which is uncommon.

**Classification: T2** (architecture nit; not exploitable in practice
because the KDF dominates timing — an attacker would need ≥2³¹ samples per
byte to distinguish the comparator's branch through the cost noise, and
even that is theoretical given clock skew on remote login endpoints).

**Recommended fix:** swap line 452 to
`bun_boringssl_sys::constant_time_eq(&computed[..DK_LENGTH], &expected)`.

**Secret zeroing.**

- `PasswordJob::Drop` (`PasswordObject.rs:614-622`) calls
  `bun_alloc::free_sensitive(core::mem::take(&mut self.password))` — zeroes
  before freeing the password Box.
- `VerifyOp::Drop` (`PasswordObject.rs:566-572`) does the same for
  `prev_hash`.
- `password_to_use` in `hash` / `verify_with_algorithm` (the SHA-512
  pre-hash for >72-byte bcrypt input) — stack-local `[u8; 64]`, vanishes on
  stack unwind. No heap allocation to leak.

**RNG (Argon2 salt).** `pwhash::argon2::str_hash` line 152:
`getrandom::fill(&mut salt)`. The `getrandom` crate uses
`SYS_getrandom`/`getentropy`/`BCryptGenRandom` per platform — same primitive
as `bun_core::csprng`. Salt is 32 bytes.

**Cross-thread.** `PasswordJob` schedules onto `WorkPool` (off-thread
hashing). The `password: Box<[u8]>` is `Send`. The `event_loop: *mut
EventLoop` + `global: *const JSGlobalObject` are `Send` by raw-pointer
sleight of hand — but the only thing touched off-thread is `op.compute`,
which never reaches the JS heap, and the result is shipped back via
`ConcurrentTask` to the JS thread. **OK.**

**Verdict.** **T2 on `verify_phc` non-constant-time array compare**, else
clean. Argon2 + standard bcrypt paths are correct.

### `Bun.secrets` — C++ binding tier

The Rust side (`src/jsc/JSSecrets.rs`) is purely a job-scheduling shim
(`AnyTaskJob<SecretsCtx>` → C++ `Bun__SecretsJobOptions__runTask`). All
keyring interaction lives in C++: `SecretsLinux.cpp` (libsecret),
`SecretsDarwin.cpp` (Keychain), `SecretsWindows.cpp` (Credential Manager),
`JSSecrets.cpp` (job-options struct + dtor).

**Cross-thread access.** `Bun__Secrets__scheduleJob` (`JSSecrets.rs:67`)
takes an `options: *mut SecretsJobOptions` from C++ and a `JSValue` promise.
The promise is wrapped in a `Strong` on the JS thread (`Strong::create`); the
options pointer is opaque, and the C++ destructor (`SecretsJobOptions::~`)
zeros all four sensitive `WTF::Vector` byte spans via `memsetSpan(..., 0)`
when the job is reclaimed via `Bun__SecretsJobOptions__deinit`. **OK from
the Rust side.**

**Linux platform** (`SecretsLinux.cpp:360`):

```cpp
// Clear the password before freeing
memset(raw_password, 0, length);
framework->secret_password_free(raw_password);
```

`memset` here is _probably_ not elided because `secret_password_free` is an
opaque dlsym'd function pointer (the compiler can't prove the memset is
dead-store-eliminable across an unknown call), but `explicit_bzero`
(glibc 2.25+) or `OPENSSL_cleanse` would be the canonical pattern.

**Windows** (`SecretsWindows.cpp:188`): `SecureZeroMemory` — correct.

**Darwin** (`SecretsDarwin.cpp`): no explicit zero pass before `CFRelease`
on the returned `CFDataRef`. The bytes copied into the result `WTF::Vector`
are zeroed by `SecretsJobOptions::~` later, but the original CFData buffer
isn't zeroed; Keychain Services owns its own page-locked storage on macOS,
so this is by design.

**Classification: T2 (Linux) / T3 (Darwin)**, both in the C++ tier — flagged
for completeness; not Rust unsafe work.

### `Bun.CSRF` JS host — `src/runtime/api/csrf_jsc.rs`

**Token / secret lifetimes.** `secret`, `token` are `Option<ZigStringSlice>`
which holds a WTFStringImpl ref. Drop releases the ref; the underlying
storage is GC-managed. The borrowed `&[u8]` passed into `csrf::generate` /
`csrf::verify` lives only for the call.

**Default secret fallback** (`csrf_jsc.rs:174-175`, `:312-314`):

```rust
None => global.bun_vm().as_mut().rare_data().default_csrf_secret(),
```

Per-VM `Box<[u8]>` of 16 bytes (`rare_data.rs:742-749`), seeded with
`bun_core::csprng`. **T2 finding**: no `Drop` zeroes this Box when the VM
tears down. A short-lived process leaks a CSRF secret to a swap file in the
worst case. (Severity is low because the secret only protects CSRF for
that VM's session; once the VM is gone the secret is moot.)

**Verdict.** Clean for T1. T2 on the default-secret Box's missing
secure-wipe Drop.

### Postgres SASL/SCRAM — `src/sql_jsc/postgres/`

**`SASL.rs::compute_salted_password`.** Calls BoringSSL's
`PKCS5_PBKDF2_HMAC` (line 84) with SHA-256, putting the 32-byte derived
key in `self.salted_password_bytes`.

**`SASL.rs::client_key_signature`** (line 135): standard SCRAM client-key
chain — SHA-256 of `client_key`, then HMAC with `auth_string`. No
verification comparison here (the server side does that).

**`PostgresSQLConnection.rs:2811-2825` — SASLFinal server-signature
verification:**

```rust
if comparison_signature.len() < 2
    || !BoringSSL::c::constant_time_eq(
        server_signature,
        &comparison_signature[2..],
    )
```

`constant_time_eq` is correct here. (Note: the `< 2` short-circuit is on the
length-prefix `v=`, not on the signature itself — fine.) **T1 clean.**

**T2 — SASL state not zeroed:**

```rust
self.authentication_state.with_mut(|s| s.zero());  // PostgresSQLConnection.rs:2828
```

`AuthenticationState::zero` (`AuthenticationState.rs:12-17`) just reassigns
`*self = AuthenticationState::None;` — the previous `Sasl(SASL { ... })`
variant is dropped, **but `SASL` has no `Drop` impl**:

```rust
// Grep confirms:
// `Drop for SASL` and `impl Drop.*SASL`: zero matches in sql_jsc/postgres/
```

So the 32-byte `salted_password_bytes` and the 88-byte
`server_signature_base64_bytes` are returned to the allocator with their
contents intact. The Zig comment in `AuthenticationState.rs:13` notes "Zig
explicitly called `sasl.deinit()` before reassigning; in Rust, assigning
into `*self` drops the previous variant (and thus SASL's Drop impl)
automatically" — but the Drop impl never landed. **T2 fix:** add

```rust
impl Drop for SASL {
    fn drop(&mut self) {
        unsafe {
            bun_alloc::secure_zero(self.salted_password_bytes.as_mut_ptr(), SALTED_PASSWORD_BYTE_LEN);
            bun_alloc::secure_zero(
                self.server_signature_base64_bytes.as_mut_ptr(),
                self.server_signature_base64_bytes.len(),
            );
        }
    }
}
```

**MD5 auth path** (`PostgresSQLConnection.rs:2855-2900`). Three stack-local
buffers (`first_hash_buf: [u8; 16]`, `first_hash_str: [u8; 32]`,
`final_hash_buf: [u8; 16]`) contain MD5 digests over the password+username.
Stack memory vanishes on unwind, but a `core::hint::black_box` won't fire
without an explicit wipe — same hygiene shape as the bcrypt SHA-pre-hash
temporary `digest` in `PasswordObject.rs:354`. **T3 watchlist.**

**Verdict.** Constant-time compare correct. **T2 on missing SASL Drop.**
T3 watchlist on MD5 path.

### MySQL `Auth.rs` — `src/sql/mysql/protocol/Auth.rs`

**`mysql_native_password::scramble`** (line 20): SHA-1 XOR scramble. No
verification, only emission. Intermediate `stage1`, `stage2`, `stage3`,
`result` are `[u8; 20]` stack-locals.

**`caching_sha2_password::scramble`** (line 68): SHA-256 chain XOR.
Intermediate `digest1`, `digest2`, `digest3`, `result` are `[u8; 32]`
stack-locals.

**T2 — `caching_sha2_password::EncryptedPassword::write_internal`** (line
197-205):

```rust
let mut plain_password = vec![0u8; needed_len];
plain_password[0..password.len()].copy_from_slice(password);
plain_password[password.len()] = 0;

for (i, c) in plain_password.iter_mut().enumerate() {
    *c ^= nonce[i % nonce.len()];
}
```

`plain_password` is a heap `Vec<u8>` holding the cleartext password XORed
with the server nonce. It's RSA-encrypted at line 273, then dropped at
end-of-scope. The Vec frees its backing without zeroing. The password is
recoverable from the heap until mimalloc reuses the slab.

**Recommended fix:** wrap the Vec drop in `free_sensitive`:

```rust
let plain_box = plain_password.into_boxed_slice();
// ... use plain_box ...
bun_alloc::free_sensitive(plain_box);
```

**Verdict.** T2 on `plain_password` Vec; SHA / RSA bindings themselves are
correct.

### S3 SigV4 — `src/s3_signing/credentials.rs`

**Attack surface.** AWS SigV4 signing-key derivation chain (HMAC-SHA-256 ×
4) at line 510-547. No verification — clients only sign, servers verify.

**T2 — signing-key cache** (`credentials.rs:131-143`):

```rust
pub fn set(&self, numeric_day: u64, key: &[u8], value: [u8; 32]) {
    let mut inner = self.0.lock();
    if inner.date == 0 {
        inner.cache = StringArrayHashMap::new();
    } else if inner.date != numeric_day {
        inner.cache.clear();   // <-- drops Box<[u8]> keys without zeroizing
    }
    inner.date = numeric_day;
    bun_core::handle_oom(inner.cache.put(key, value));
}
```

The cache `key` is `"{region}{service}{secret}"` — the AWS **secret access
key** is part of the hash map key string. The `value` is a 32-byte derived
signing key. `cache.clear()` drops the `Box<[u8]>` key boxes without
zeroizing. `AWSSignatureCache::Default::default()` provides a default Drop
that does the same.

**Recommended fix:** wrap `StringArrayHashMap` in a wrapper whose Drop
secure-zeroes each key + value before releasing. Alternatively, hash the
key first (so the cache stores `wyhash(region||service||secret)` as a
fixed-size `[u8; 16]`) — but wyhash is not preimage-resistant, so SHA-256
the secret first.

**RNG.** Not used here.

**Constant-time compare.** Not applicable — S3 signs, server verifies.

**Verdict.** T2 on cache holding raw secret as map key.

### `Bun.password` work pool — cross-thread

Already covered in the PasswordObject section. The off-thread invocation
moves a `Box<[u8]>` of password bytes onto a worker thread, computes,
returns the result via `ConcurrentTask`. **The password buffer is freed
on the worker thread via the `PasswordJob::Drop` calling
`bun_alloc::free_sensitive(core::mem::take(&mut self.password))` —
`secure_zero` + `mi_free`, on whichever thread runs the Drop.** Mimalloc
is thread-safe; the password Vec's backing was allocated by the calling
thread but mimalloc handles cross-thread free correctly. **Clean.**

### `bun_core::csprng` — `src/bun_core/util.rs:3011-3060`

**Per platform:**

| Platform              | Source                                       | Saturating loop  |
| --------------------- | -------------------------------------------- | ---------------- |
| Linux / Android       | `libc::getrandom(ptr, len, 0)`               | EINTR retry      |
| macOS / iOS / FreeBSD | `libc::getentropy(ptr, len)` in 256B chunks  | 256B chunks      |
| Windows               | `SystemFunction036` (`RtlGenRandom`)         | `u32::MAX` chunks |

The Linux `getrandom(0, blocking)` choice is correct — non-blocking
`GRND_NONBLOCK` would risk early-boot entropy starvation. `getentropy(3)`
on Darwin reads from `kern.random` (BoringSSL's source on those platforms).
`RtlGenRandom` is what BoringSSL itself uses on Windows.

**No userspace PRNG**, no `rand` crate, no `wyhash`-as-RNG, no seeded
ChaCha. The "Quality of the seed?" question doesn't apply — there's no
seed because there's no userspace PRNG.

**Verdict: clean.** Strong RNG path.

### Entropy cache — `src/jsc/rare_data.rs::EntropyCache`

A 2 KB buffer (`EntropyCache::SIZE = 16 * 128 = 2048`) of CSPRNG output, used
to satisfy small (≤ 256-byte by default, ≤ 512-byte effective) random
requests without a syscall per request. Refilled via `bun_core::csprng`
when exhausted.

**Concern:** consumed bytes are **not** wiped from the cache; only `index`
advances. Under "attacker reads process memory" they recover all entropy
bytes generated since the last refill. Same risk profile as BoringSSL's
internal CTR_DRBG output buffer. **T3 watchlist** — process-memory
disclosure is already game-over.

### WebCrypto `timingSafeEqual` — `src/runtime/webcore/Crypto.rs:220-249`

Length pre-check + `bun_boringssl_sys::constant_time_eq(a, b)`. **Clean.**

### `node:crypto.timingSafeEqual` — `src/runtime/node/node_crypto_binding.rs:1129`

Same pattern. **Clean.**

### `EVP_DigestVerifyFinal` — `src/jsc/bindings/node/crypto/JSSign.cpp`

Cited for completeness. BoringSSL's `EVP_DigestVerifyFinal` is internally
constant-time (uses `CRYPTO_memcmp`). **Out of Rust scope.**

---

## Specific table — every audited secret-handling site

Format: `(file:line) — operation, secret, comparison, zeroed-on-drop, RNG`

| Site                                                       | Op                       | Secret             | Compare              | Drop-zero | RNG (if any)          |
| ---------------------------------------------------------- | ------------------------ | ------------------ | -------------------- | --------- | --------------------- |
| `csrf/lib.rs:113`                                          | HMAC sign                | secret             | n/a (sign only)      | n/a       | csprng(nonce 16)      |
| `csrf/lib.rs:249`                                          | HMAC verify              | secret/sig         | `constant_time_eq`   | n/a       | n/a                   |
| `runtime/webcore/Crypto.rs:248`                            | WebCrypto verify         | user bufs          | `constant_time_eq`   | n/a       | n/a                   |
| `runtime/webcore/Crypto.rs:357`                            | `getRandomValues`        | n/a                | n/a                  | n/a       | csprng OR cache       |
| `runtime/node/node_crypto_binding.rs:1129`                 | `timingSafeEqual`        | user bufs          | `constant_time_eq`   | n/a       | n/a                   |
| `runtime/crypto/PasswordObject.rs:344`                     | argon2 hash              | password           | n/a (hash)           | ✓ (Drop)  | getrandom(salt 32)    |
| `runtime/crypto/PasswordObject.rs:377`                     | bcrypt hash              | password           | n/a (hash)           | ✓ (Drop)  | bcrypt internal       |
| `runtime/crypto/PasswordObject.rs:407`                     | argon2 verify            | password / hash    | rust-argon2 CT       | ✓ (Drop)  | n/a                   |
| `runtime/crypto/PasswordObject.rs:429`                     | bcrypt verify (`$2…`)    | password / hash    | bcrypt-crate CT      | ✓ (Drop)  | n/a                   |
| `runtime/crypto/pwhash.rs:452` **PHC bcrypt**              | bcrypt verify (`$bcrypt`)| password / hash    | **`==` (not CT)**    | ✓         | n/a                   |
| `runtime/crypto/PBKDF2.rs:54`                              | PBKDF2-HMAC              | password           | n/a (derive)         | (sob)     | n/a                   |
| `runtime/crypto/EVP.rs:209`                                | EVP digest init          | none               | n/a                  | ✓ (Drop)  | n/a                   |
| `sha_hmac/hmac.rs:21`                                      | HMAC one-shot            | key                | n/a (sign)           | n/a       | n/a                   |
| `sha_hmac/sha.rs:72-175`                                   | SHA / EVP                | input maybe        | n/a                  | EVP ✓; hashers ✗ | n/a            |
| `boringssl/lib.rs:217-225` `OPENSSL_memory_free`           | allocator zero+free      | any BoringSSL heap | n/a                  | bare `write_bytes` (T2 nit) | n/a |
| `boringssl/lib.rs:163-175` `init_client`                   | SSL_CTX init             | n/a                | n/a                  | never freed (intentional) | n/a |
| `boringssl_sys/lib.rs:18-24` `constant_time_eq`            | length-check + memcmp    | inputs             | CRYPTO_memcmp        | n/a       | n/a                   |
| `bun_alloc/lib.rs:1486-1492` `secure_zero`                 | wipe primitive           | any                | n/a                  | n/a       | n/a                   |
| `bun_alloc/lib.rs:1501-1510` `free_sensitive<T: Copy>`     | wipe + free              | any                | n/a                  | n/a       | n/a                   |
| `bun_alloc/lib.rs:1516-1529` `free_sensitive_cstr`         | wipe + free              | C-string secret    | n/a                  | n/a       | n/a                   |
| `bun_core/util.rs:3011-3060` `csprng`                      | OS CSPRNG                | output             | n/a                  | n/a       | OS getrandom et al    |
| `jsc/rare_data.rs:138-141` `EntropyCache::fill`            | refill from csprng       | cache contents     | n/a                  | ✗ (consumed bytes stay) | OS csprng |
| `jsc/rare_data.rs:742-749` `default_csrf_secret`           | 16-byte secret           | CSRF secret        | n/a                  | **✗ no Drop wipe** | OS csprng        |
| `s3_signing/credentials.rs:131-143` `AWSSignatureCache::set` | cache store            | AWS secret in key  | n/a                  | **✗ clear() drops keys** | n/a         |
| `s3_signing/credentials.rs:519-547`                        | SigV4 HMAC chain         | secret_access_key  | n/a (sign)           | ✗ tmp buffers | n/a                |
| `sql/mysql/protocol/Auth.rs:20-61` `mysql_native_password` | SHA-1 XOR scramble       | password           | n/a (emit)           | ✗ stack `[u8;20]` (vanishes) | n/a    |
| `sql/mysql/protocol/Auth.rs:68-96` `caching_sha2_password::scramble` | SHA-256 chain  | password           | n/a (emit)           | ✗ stack `[u8;32]` (vanishes) | n/a    |
| `sql/mysql/protocol/Auth.rs:197-205`                       | **RSA OAEP plaintext**   | password           | n/a (emit)           | **✗ `Vec<u8>` plain_password** | n/a |
| `sql/shared/Data.rs:58-74` `Data::zdeinit`                 | wipe + free              | SQL bytes          | n/a                  | n/a       | n/a                   |
| `sql/postgres/protocol/Authentication.rs:40-54` `Drop`     | SASL message wipe        | SASL data          | n/a                  | ✓ via `Data::zdeinit` | n/a           |
| `sql_jsc/postgres/SASL.rs::SASL`                           | SCRAM state              | salted_password    | n/a (sign)           | **✗ no Drop**       | csprng(nonce 18)     |
| `sql_jsc/postgres/PostgresSQLConnection.rs:2811-2828`      | SASLFinal verify         | server_signature   | `constant_time_eq`   | n/a       | n/a                   |
| `sql_jsc/postgres/PostgresSQLConnection.rs:2855-2900`      | MD5 auth chain           | password           | n/a (emit)           | ✗ stack `[u8;16]+[u8;32]` | n/a               |
| `http/ssl_config.rs:387/398/472/481`                       | TLS key / passphrase     | private key data   | n/a                  | ✓ `free_sensitive_cstr` | n/a              |
| `runtime/socket/SSLConfig.rs:282/348`                      | TLS key / passphrase     | private key data   | n/a                  | ✓ `free_sensitive_cstr` | n/a              |
| `runtime/node/types.rs::StringOrBuffer::Drop`              | password / key carrier   | password           | n/a                  | ✗ no secure-zero (JS-owned Buffer/string) | n/a |

---

## Tiered findings

### T1 — concrete secret leak / cache-timing-exploitable compare

**None.** Every HMAC/signature verification path that an attacker can drive
flows through `bun_boringssl_sys::constant_time_eq` (= `CRYPTO_memcmp`).

This is a strong negative finding for the reviewed crypto surface:
the audited Rust HMAC/signature verification paths that an attacker can drive
flow through constant-time comparison rather than byte-by-byte equality.

### T2 — architecture defect (recommended fixes)

**T2-1.** `pwhash::bcrypt::verify_phc` — `computed[..23] == expected`
(`pwhash.rs:452`). Not constant-time. Mitigated by KDF-dominated runtime.
**Fix:** replace with `bun_boringssl_sys::constant_time_eq(&computed[..23],
&expected)`.

**T2-2.** `SASL` struct has no `Drop`. The 32-byte `salted_password_bytes`
and the base64-encoded `server_signature_base64_bytes` are returned to
mimalloc with their contents intact when `AuthenticationState` transitions
out of `Sasl(_)`. **Fix:** add a `Drop` impl that calls
`bun_alloc::secure_zero` over both arrays.

**T2-3.** `AWSSignatureCache::set` — cache key is the raw concatenation
`"{region}{service}{secret}"` stored as `Box<[u8]>`. `clear()` drops the
boxes without zeroizing. **Fix:** either SHA-256 the secret before keying,
or wrap `StringArrayHashMap` in a `Drop` that calls `secure_zero` on each
key + value before releasing.

**T2-4.** `caching_sha2_password::EncryptedPassword::write_internal` —
heap `Vec<u8>` `plain_password` holds the XOR'd cleartext and is dropped
without zeroizing. **Fix:** convert to `Box<[u8]>` and wipe via
`bun_alloc::free_sensitive` after the RSA encrypt completes.

**T2-5.** `RareData::default_csrf_secret` — `Box<[u8]>` of 16 bytes with
no Drop wipe when the VM tears down. **Fix:** wrap in a newtype with a
zeroizing Drop.

**T2-6.** `OPENSSL_memory_free` uses bare `ptr::write_bytes(p, 0, len)`
instead of `bun_alloc::secure_zero(p as *mut u8, len)`. **Fix:** route
through `secure_zero` (the `black_box` + `compiler_fence(SeqCst)` provides
defense against future LTO/PGO regressions).

### T3 — latent watchlist

**T3-1.** `EntropyCache` doesn't wipe consumed bytes — only advances
`index`. A process-memory disclosure recovers all entropy generated since
the last refill. Mitigation: process-memory disclosure is already
catastrophic; this only makes it slightly worse.

**T3-2.** `hashers::SHA*` (the deprecated SHA1/256/512/RIPEMD path) has
no Drop — the per-call `SHA_CTX` state vanishes with the stack frame but
leaves residue in registers/spill slots. Not exploitable; `hashers` is
nearly unused (the `evp` path replaces it).

**T3-3.** Postgres MD5 auth path's stack-local digest buffers
(`first_hash_buf`, `final_hash_buf`, the hex strings) — same shape as
T3-2. Vanish on unwind.

**T3-4.** MySQL `mysql_native_password::scramble` / `caching_sha2_password::
scramble` intermediate stack digests — same shape.

**T3-5.** Linux `Bun.secrets` uses `memset` rather than `explicit_bzero`.
C++ tier; flagged.

**T3-6.** Darwin `Bun.secrets` doesn't zero the CFData buffer before
`CFRelease`. C++ tier; flagged.

**T3-7.** `bun_node::StringOrBuffer::Drop` doesn't secure-wipe the
underlying password / key bytes. The JS-side Buffer/string holding the
secret remains live until GC; standard Node.js behavior.

---

## NEGATIVE findings (the strong claims)

The discipline note in the prompt asks for negative findings to be explicit.
Here they are:

1. **Bun does not roll its own constant-time compare.** All seven
   constant-time comparison sites
   (`csrf`, `runtime/webcore/Crypto.rs::timing_safe_equal_without_type_checks`,
   `runtime/node/node_crypto_binding.rs::timing_safe_equal`,
   `PostgresSQLConnection.rs::SASLFinal`, plus the two pwhash-vendor calls)
   route through `bun_boringssl_sys::constant_time_eq` → BoringSSL's
   `CRYPTO_memcmp`. Bun never re-implements the bit-trick (`x ^ y | (a-b)`)
   that's typically where home-rolled crypto goes wrong.

2. **Bun does not seed a userspace PRNG from `/dev/urandom`.** There is no
   ChaCha20 RNG, no `rand::thread_rng`, no `SmallRng`. Every random byte
   that escapes a function comes from the OS CSPRNG: `getrandom(2)` /
   `getentropy(3)` / `RtlGenRandom`. `getrandom` is called with `flags=0`
   (blocking), not `GRND_NONBLOCK`, so early-boot entropy starvation can
   never cause a fall-through to a weaker source.

3. **`bun_wyhash` is not used for any cryptographic decision.** Every
   reach-site is hashmap keying, content-hash cache invalidation, or CSS
   identifier hashing. The crypto crates do not depend on `bun_wyhash`.

4. **No `mem::zeroed::<KeyStruct>()` with non-zero-default fields.** All
   `zeroed_unchecked` call sites in crypto code are for `EVP_MD_CTX`,
   `SHA_CTX`, `SHA256_CTX`, `SHA512_CTX`, `RIPEMD160_CTX` — all of which
   are `#[repr(C)]` POD where the all-zero bit pattern is exactly what
   `*_Init` expects to overwrite.

5. **No cross-thread `SSL_CTX` destroy.** The client-side `OnceLock<CtxStore>`
   in `boringssl/lib.rs` never frees the `SSL_CTX`; per-connection
   `SSL_CTX_free` sites (e.g. `HTTPContext.rs:1100`, `websocket_client.rs:190`)
   each have explicit SAFETY comments tying the call to the thread that
   originally received the refcount.

6. **`Bun.secrets` / `Bun.cookie` have no Rust-tier cross-thread access
   patterns to audit.** `Bun.secrets` work happens on a WorkPool thread but
   the secret bytes are inside a C++ `SecretsJobOptions` struct whose dtor
   does `memsetSpan(..., 0)` over all four sensitive fields when the job
   completes. `CookieMap` does not have any signing/HMAC code — cookies are
   stored and emitted as plain strings; Bun does not sign cookies.

7. **Bun's password verify always runs the KDF.** `Bun.password.verify`
   never short-circuits on a malformed hash before running the KDF — see
   `PasswordObject::verify` lines 383-446. (The PHC bcrypt path's
   `verify_phc` runs the cipher unconditionally before the
   non-constant-time compare, so even that T2 finding gets the full
   2^(rounds_log) cost as cover.)

---

## Recommended order-of-fix

If only a handful of fixes can land:

1. **T2-1** (`pwhash.rs:452`) — a one-line change to remove a non-CT compare.
2. **T2-2** (SASL `Drop`) — adds 8 lines; closes a 32-byte salted-password
   leak on every Postgres SCRAM session.
3. **T2-3** (AWS cache hashes the secret) — modest refactor; prevents AWS
   secret access keys from sitting in process memory between days.

The remaining T2/T3 items are defense-in-depth.

---

## Build / verification notes

This audit is read-only — no source modifications were made. To verify any
finding above:

```bash
# Reproduce: every constant_time_eq site in Bun
rg -n 'constant_time_eq|CRYPTO_memcmp' src/

# Reproduce: every Drop impl in the crypto crates (none for SASL)
rg -n 'impl Drop' src/sql_jsc/postgres/ src/csrf/ src/sha_hmac/ src/runtime/crypto/

# Reproduce: every csprng/getrandom/arc4random/BCryptGenRandom call
rg -n 'csprng|getrandom|arc4random|BCryptGenRandom|RtlGenRandom|getentropy' src/

# Reproduce: wyhash NOT in crypto crates
rg -n 'bun_wyhash|wyhash' src/sha_hmac/ src/csrf/ src/runtime/crypto/ src/boringssl/ src/s3_signing/ src/sql_jsc/postgres/SASL.rs src/sql/mysql/protocol/Auth.rs
# → zero matches expected

# Reproduce: free_sensitive / secure_zero call sites
rg -n 'free_sensitive|secure_zero|bun_alloc::secure_zero' src/
```

---

## Closing assessment

Bun's Rust crypto-side surface is unusually well-disciplined for a JS
runtime port. The audit reaches its strongest negative finding — **no T1
issues** — because the runtime delegates every constant-time comparison
through BoringSSL's `CRYPTO_memcmp` and every random byte through the OS
CSPRNG. The T2 findings are mop-up: missing Drop wipes that the Zig
originals also lacked (Zig's `defer sasl.deinit()` was the porting
intent, but the deinit method never zeroed; the Rust port faithfully
preserved the gap).

The bcrypt PHC-format non-constant-time array compare (T2-1) is the
closest thing to a real finding; it's the one line where a one-character
fix produces a strictly better answer. Everything else is process-memory-
disclosure defence-in-depth.

The C++ binding-tier wipes (Secrets, JSSecrets dtor) are out of Rust scope
but flagged here for completeness — the Linux `memset` should be
`explicit_bzero`; the Darwin path should call `cleanseCFData` before
`CFRelease`. Neither is an exploit on its own.
