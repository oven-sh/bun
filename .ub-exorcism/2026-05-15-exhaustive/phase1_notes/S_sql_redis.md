# Section S: sql-redis-payments (9 crates)

## Purpose

Section S covers Bun's database, cache, and payment-adjacent crates: the
Postgres + MySQL + SQLite SQL engines (`bun_sql`, `bun_sql_jsc`), the Redis-
compatible Valkey protocol (`bun_valkey` — protocol parser only; the JSC
client glue lives in section J's `bun_runtime/valkey_jsc`), the `bun patch`
implementation (`bun_patch`, `bun_patch_jsc`), the build-time `bun_codegen`
crate, AWS SigV4 signing for `Bun.s3` (`bun_s3_signing`), CSRF token
generation (`bun_csrf`), and the SHA/HMAC primitive wrappers
(`bun_sha_hmac`).

Concurrency profile: async clients (Postgres/MySQL/SQLite via uSockets event
loop), but all per-connection state is single-threaded on the JS event-loop
thread. Cross-thread data movement is limited to the boxed `SSLConfig` handle
(`unsafe impl Send`).

## Per-crate unsafe-surface tally

(See `phase1_inventory_S.md` for the per-file table.)

- 7 of 9 crates have ≤ 12 unsafe sites each.
- `bun_sql_jsc` carries 113 of section S's 140 sites (≈ 81 %).
- `bun_valkey`, `bun_patch`, `bun_patch_jsc`, `bun_codegen`, `bun_csrf`
  declare **zero unsafe** in production-shipping Rust code.

## sql_jsc audit (Postgres / MySQL / SQLite)

### Three repeating idioms account for ≈ 60 sites

1. **Speculative-ref / undo-on-error** (≈ 20 sites across
   `PostgresSQLQuery.rs`, `JSMySQLQuery.rs`, `MySQLQuery.rs`,
   `JSMySQLConnection.rs`). Pattern:

   ```rust
   this.ref_();                                  // count ≥ 2
   if let Err(e) = do_thing(this_ptr) {
       // SAFETY: undoes the speculative ref above; count was ≥2, never frees here.
       unsafe { Self::deref(this_ptr) };
       return Err(e);
   }
   ```

   Mechanically sound but mechanically repeated. A `RefGuard`-style scope
   guard would consolidate ≈ 15-20 unsafe blocks.

2. **Hook-table dispatch** (`jsc.rs:335/342/348/383/414/419/499/513/523/536/559/587/594/970`,
   ~14 sites). The `SqlRuntimeHooks` struct is 18 `unsafe fn(...)` fields
   filled by `bun_runtime::init_runtime_state`. Each call:

   ```rust
   unsafe { (hooks().X)(args) }
   ```

   Init-order invariant lives in `bun_runtime`, not section S. No defensive
   null-check at call sites; correct under the documented invariant.

3. **uSockets adopt_tls + ext-slot write** (`PostgresSQLConnection.rs:451-494`,
   `MySQLConnection.rs:339-380`). Identical pattern in both protocol
   crates: build `tls_options`, take `&mut *raw` over the underlying socket
   ptr (`raw` may be reallocated by `adopt_tls`), then write the new
   socket's `ext::<Option<NonNull<Self>>>()` slot. SAFETY notes correctly
   cover both the alias-after-realloc case and the ext-slot ABI.

### SQLDataCell `Box::<[u8]>::from_raw` reconstructions

`src/sql_jsc/shared/SQLDataCell.rs:226/254` — two `Box::<[u8]>::from_raw`
calls reconstructing a heap allocation from a `(ptr, len)` pair carried in a
tagged-union value. Both carry **active TODO(port) notes**, but current-source
producer tracing does not support a UB finding:

- **Bytea (line 226)**: `postgres/DataCell.rs:30-47` allocates exactly
  `hex.len()/2` bytes and stores `written`. `decode_hex_to_bytes()` either
  errors before `bun_core::heap::into_raw(buf)` or returns that exact decoded
  count. Odd-length input leaves the final nibble unused, so the behavior may
  deserve semantic review, but the `Box::<[u8]>::from_raw` layout matches.
  Binary bytea (`DataCell.rs:1141-1147`) is borrowed (`free_value=0`) and is
  not freed by `SQLDataCell::deinit()`.
- **TypedArray (line 254)**: the TODO says the branch may be dead, but it is
  live for Postgres binary typed arrays. `from_bytes_typed_array()`
  (`DataCell.rs:822-851`) allocates `out_bytes`, stores `byte_len = out_bytes`,
  and sets `free_value = 1`; `SQLDataCell::deinit()` frees with `byte_len`.
  That is the correct Rust layout contract.

The implementation already does the safer half correctly: it builds the fat
pointer with `ptr::slice_from_raw_parts_mut` (no `&mut` materialised) and
only `Box::from_raw` is unsafe. The remaining action is to update/delete the
stale source TODOs, not to file a T1 UB finding.

### CachedStructure stack uninit

`src/sql_jsc/shared/CachedStructure.rs:58` uses
`MaybeUninit::uninit().assume_init()` to make a `[MaybeUninit<…>; 70]`
(N.B.: outer-type-is-MaybeUninit, so the assume_init is sound — see
UB-TAXONOMY B-3 carve-out). Lines 109 `set_len(non_duplicated_count)` after
the dedup loop completes the SoA migration into a heap `Vec`. Both are
correct.

### Send/Sync surface

One `unsafe impl Send`: `SSLConfig` at `jsc.rs:492`. Comment names every
contained type and explicitly notes the cross-thread move is JS-thread-bound
in practice. No section-S `unsafe impl Sync`.

### Macro-generated unsafe in sql_jsc

3 `bun_opaque::opaque_ffi! { pub struct …; }` instantiations
(`TimerHeap` jsc.rs:409, `Blob` jsc.rs:582, `SslCtxCache` jsc.rs:960). The
macro emits an opaque `repr(C)` ZST plus an `_p` field accessor; runtime
unsafe is in the user-written method bodies (counted under per-file tallies),
not in the macro expansion. `jsc_abi_extern!` (`jsc.rs:735` + ≈ 5 callers
nearby) emits `unsafe extern "C" fn` thunks for SysV-on-Win64 ABI handling.
Estimated total expansion: ≈ 24 additional unsafe sites post-macro.

## LinearFifo / EXP-001 status

`bun_valkey` itself (`src/valkey/`, the protocol parser) has zero unsafe and
no LinearFifo instantiations. The Valkey *client* with its
`LinearFifo<{Entry, PromisePair}, _>` instantiations lives in
`src/runtime/valkey_jsc/` and is partitioned to section J.

The other LinearFifo instantiations in section S are:

- `src/sql_jsc/postgres/PostgresRequest.rs:500-502` —
  `LinearFifo<*mut PostgresSQLQuery, DynamicBuffer<*mut PostgresSQLQuery>>`
- `src/sql_jsc/mysql/MySQLRequestQueue.rs:20` —
  `LinearFifo<*mut JSMySQLQuery, DynamicBuffer<*mut JSMySQLQuery>>`

Codex correction: **do not say EXP-001 does not apply merely because the
element types are raw pointers.** The current EXP-001 framing is broader than
"niche-bearing T": `DynamicBuffer<T>::as_slice()` exposes the entire
`Box<[MaybeUninit<T>]>` backing allocation as `&[T]`, including uninitialized
slots. A raw pointer has no invalid discriminant, so it is a lower-signal
Miri witness than `NonNull<T>` / `Box<T>` / enum-heavy values, but
uninitialized memory is still not an initialized `*mut T` value.

The accurate Section-S statement is:

- Section J's `LinearFifo<RefDataValue>`, `LinearFifo<Entry>`, and
  `LinearFifo<PromisePair>` remain the strongest live EXP-001 witnesses.
- Section S's SQL queues are **additional users of the same unsound container
  abstraction**, but current queue control flow may avoid observing
  uninitialized slots.
- Phase 2 may add a raw-pointer queue Miri witness if needed, but the real
  remediation should fix `bun_collections::linear_fifo` globally.

## Crypto re-confirmation (csrf / sha_hmac)

Cross-checked against the prior-audit conclusion ("BoringSSL constant-time
used; OS CSPRNG only; no userspace PRNG"):

- **`bun_csrf` (zero unsafe)**: `csprng()` from `bun_core` for nonce
  (OS-backed via getrandom/CryptGenRandom — no userspace PRNG path);
  HMAC via `bun_sha_hmac::hmac::generate`; signature compare via
  `boring::constant_time_eq` (BoringSSL `CRYPTO_memcmp`). Constant-time
  discipline preserved.
- **`bun_sha_hmac` (12 unsafe)**: every site is a thin BoringSSL FFI call
  inside one of two macro templates (`new_hasher!`, `new_evp!`) defined in
  `sha.rs:50-180`. SAFETY comments live in the macro template body and
  cover (a) zeroed-POD context init, (b) update reads `len` bytes only,
  (c) final writes `DIGEST` bytes. **Note**: source-direct unsafe sites grew
  from prior 1 → 12 because the SHA/EVP wrapper macros were ported in this
  run; expanded count is ≈ 75 (16 instantiations × per-template branch
  count). Template surface is small and audited; no per-instance unsafe
  edits.
- **`bun_s3_signing` (3 unsafe)**: 2 of 3 are `secure_zero` of credential
  bytes (`zero_sensitive` helper, line 1102-1105 — exclusive `&mut Box<[u8]>`
  borrow, well-formed). The 3rd is `slice::from_raw_parts(buf.as_ptr(), n)`
  over a 256-byte stack builder where `n ≤ 256` is provable by
  construction.

## Notable patterns

1. **`unsafe fn` field in hook tables** — `SqlRuntimeHooks` (`jsc.rs:244-277`)
   has 18 unsafe-fn fields. Caller carries the unsafe burden. Right shape;
   forces an unsafe block at every call site.
2. **`scopeguard::guard(...)` for BoringSSL handles** — used consistently in
   `bun_sql/mysql/protocol/Auth.rs` for `BIO_free` and `RSA_free`. Each
   guard carries a SAFETY note inside the closure. Removes a class of leak-
   on-early-return bugs.
3. **`bun_core::heap::*` / `Self::deref` consolidation already partly done**
   — many call sites comment "// SAFETY: this is the live Box-allocated
   connection; this releases one ref" and call a `deref` static method
   rather than open-coding `Box::from_raw + drop`. Further consolidation
   (RefGuard) would lift ≈ 20 unsafe blocks but introduces a new abstraction
   layer.
4. **Tagged-union reads gated by discriminant** — `SQLDataCell::deinit`
   reads each `Value` union variant inside an `unsafe { self.value.X }`
   gated by a `match self.tag` arm. The discipline is right; comments name
   the gating tag at every site.
5. **PORT NOTE comments throughout sql_jsc explicitly call out which
   per-site `unsafe { ... }` was *removed* by an audited helper** (e.g.
   `PostgresSQLConnection.rs:223-225` "One audited unsafe here replaces the
   per-site `unsafe { self.vm().event_loop_mut() }`"). Strong audit-trail
   discipline; each consolidation is named.
6. **Three opaque-FFI ZST types in `jsc.rs`** (`TimerHeap`, `Blob`,
   `SslCtxCache`) use the `bun_opaque::opaque_ffi!` macro. The pattern keeps
   `&mut Self`/`&Self` accessors safe even though the underlying pointer
   targets opaque C++ memory.

## Open questions

- **`SQLDataCell.rs:226/254` source TODO cleanup** — current producer trace
  shows Bytea and Postgres TypedArray deinit are layout-consistent. These
  should be documented as stale TODOs rather than UB candidates unless a new
  producer with mismatched `(ptr, len)` appears.
- **Hook-table init order** — confirm `bun_runtime::init_runtime_state`
  always runs before any sql_jsc entry point. Cross-section invariant; doc
  reference in Phase-2 notes.
- **Speculative-ref/undo idiom consolidation** — propose a `RefGuard`-style
  RAII type for the ≈ 20 repeated sites; phase-11 candidate.
- **`MySQLQuery.rs:240/248` thunk index bounds** — confirm
  `Execute::write_internal` enforces `i < len` *contemporaneously* with
  every `is_null_thunk`/`to_data_thunk` invocation, not stored-and-trusted.
