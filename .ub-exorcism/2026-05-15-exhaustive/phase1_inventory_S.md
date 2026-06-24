# Section S: sql-redis-payments — unsafe surface inventory

Run: `2026-05-15-exhaustive`
Source paths: `src/sql/`, `src/sql_jsc/`, `src/valkey/`, `src/patch/`, `src/patch_jsc/`, `src/codegen/`, `src/s3_signing/`, `src/csrf/`, `src/sha_hmac/`
Prior audit (Phase 0): 104 sites (103 `unsafe_block` + 1 `unsafe_impl`).
Current normalised count: **140 unsafe blocks/fns/impls/traits** across 9 crates (+36, ≈ +35 %).

## Per-crate unsafe-surface tally

| crate            | unsafe blocks | unsafe fn/impl/trait | total | prior | Δ    | files w/ unsafe | rust LOC | notes                                                                                          |
| ---------------- | ------------- | -------------------- | ----- | ----- | ---- | --------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `bun_sql`        | 12            | 0                    | 12    | 11    | +1   | 4 / 86          | 7 119    | BoringSSL FFI in MySQL `sha256_password` auth; `secure_zero` for sensitive blobs; ZStr deref.  |
| `bun_sql_jsc`    | 97            | 15 fn / 1 impl       | 113   | 90    | +23  | 16 / 40         | 16 255   | 90 % of section's surface; FFI hooks (SSL), ref-count discipline, JSC bridge thunks.           |
| `bun_valkey`     | 0             | 0                    | 0     | 0     | 0    | 0 / 2           | 606      | Pure-safe protocol parser (no client glue yet — that lives in `bun_runtime/valkey_jsc`).       |
| `bun_patch`      | 0             | 0                    | 0     | 0     | 0    | 0 / 1           | 2 135    | `bun patch` engine; FS ops via `bun_sys` only.                                                  |
| `bun_patch_jsc`  | 0             | 0                    | 0     | 0     | 0    | 0 / 2           | 243      | Test-only Rust; production is shimmed through `bun_runtime`.                                   |
| `bun_codegen`    | 0             | 0                    | 0     | 0     | 0    | 0 / 2           | 117      | Build-time TS scripts plus a tiny `process_windows_translate_c.rs`; no production unsafe.       |
| `bun_s3_signing` | 3             | 0                    | 3     | 2     | +1   | 1 / 5           | 1 682    | Two `secure_zero` of credential bytes + one `from_raw_parts` over a stack `[u8; 256]` builder. |
| `bun_csrf`       | 0             | 0                    | 0     | 0     | 0    | 0 / 1           | 256      | All cryptographic FFI delegated to `bun_sha_hmac::hmac` and BoringSSL constant-time compare.   |
| `bun_sha_hmac`   | 12            | 0                    | 12    | 1     | +11  | 2 / 3           | 424      | All inside two `macro_rules!` templates (`new_hasher!`, `new_evp!`); 16 instantiations expand. |
| **Section total**| **124**       | **16**               | **140** | **104** | **+36** | **23**     | **28 837** |                                                                                                |

`unsafe impl` count: **1** (`SSLConfig: Send` at `src/sql_jsc/jsc.rs:492`).

`#[unsafe(no_mangle)]` exports: **1** real attribute
(`PostgresSQLConnection__createInstance` at
`src/sql_jsc/postgres/PostgresSQLConnection.rs:1069`); the other two greps
are commentary/PORT-NOTE references to the attribute.

## SAFETY-comment density

| crate            | unsafe blocks | SAFETY context lines (≤2 above) | density |
| ---------------- | ------------- | ------------------------------- | ------- |
| `bun_sql`        | 12            | 10                              | ≈ 83 %  |
| `bun_sql_jsc`    | 97            | 63                              | ≈ 65 %  |
| `bun_s3_signing` | 3             | 2                               | ≈ 67 %  |
| `bun_sha_hmac`   | 12            | 11                              | ≈ 92 %  |

Section blended SAFETY density: **86 / 124 ≈ 69 %**. The sql_jsc shortfall is
dominated by tight refcount-deref one-liners
(`unsafe { Self::deref(this_ptr) }`) where the SAFETY rationale is documented
once as a doc comment on `deref` and called by name in adjacent comment
blocks rather than repeated per site (e.g.
`PostgresSQLQuery.rs:595/623/656/720/722/740/796/836` all share the same
"undoes the speculative `this.ref_()` above; count was ≥2, never frees here"
comment — counted only once by the regex).

## UB-taxonomy buckets (per `references/UB-TAXONOMY.md`)

| Bucket                                   | Section S sites                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-2 FFI contract** (BoringSSL/uSockets/heap hooks) | All 12 in `bun_sql/mysql/protocol/Auth.rs` (RSA OAEP encrypt path), all 12 `bun_sha_hmac` macro sites, both `bun_sql_jsc/jsc.rs` SSL-config hook sites, the `bun_sql_jsc/postgres/SASL.rs:83` PBKDF2 call, all `boringssl::SSL_CTX_free`/`RSA_free` drops in `PostgresSQLConnection.rs:1161`, `MySQLConnection.rs:317/JSMySQLConnection.rs:549`. |
| **B-1 Aliasing / `&mut` from raw**       | `MySQLConnection.rs:1555/1603/1613` `addr_of_mut!((*self.connection).…)` projections (no `&mut` materialised, `*mut` field reborrow); `sql_jsc/jsc.rs:335/342/348/383` `unsafe { &mut *(hooks().…)(self) }` over per-VM singleton hooks; `SQLDataCell.rs:230` `&mut self.value.array` over an active union variant.                                  |
| **B-3 Validity / union read**            | `sql_jsc/shared/SQLDataCell.rs:209/215/230/238` four union-variant reads gated by a discriminant `tag` field check; `sql_jsc/shared/CachedStructure.rs:58` `MaybeUninit::uninit().assume_init()` for a `[MaybeUninit<ExternColumnIdentifier>; 70]` (sound — outer type is itself `MaybeUninit`).                                                                            |
| **B-4 Box::from_raw / heap pairing**     | `SQLDataCell.rs:226/254` `Box::<[u8]>::from_raw(slice_from_raw_parts_mut(p, len))`. Current-source trace does **not** support a UB finding: Bytea `parse_bytea()` allocates exactly `hex.len()/2` bytes and records the same decoded length; Postgres typed arrays allocate `out_bytes` and deinit frees by `byte_len`. `SQLDataCell.rs:149` `drop(Vec::from_raw_parts(p, 0, cap))`; many `Self::deref(this_ptr)` refcount drops. |
| **B-5 Send/Sync (cross-thread)**         | One only: `unsafe impl Send for SSLConfig` at `sql_jsc/jsc.rs:492` — boxed handle whose contents (`CString`/`Vec`/`AtomicU64`) are themselves `Send`, only crosses threads during construction-then-handoff on the JS thread.                                                                                                                                  |
| **B-6 Pin/self-referential**             | None observed. The intrusive request queues use raw `*mut T` element types (`LinearFifo<*mut PostgresSQLQuery, …>` / `LinearFifo<*mut JSMySQLQuery, …>`), not `Pin`-projected fields.                                                                                                                                                                       |
| **B-7 Strict-provenance / int↔ptr cast** | None observed in section S. All ptr-casts use `.cast::<T>()` per workspace `clippy::ptr_as_ptr = warn`.                                                                                                                                                                                                                              |
| **B-8 `MaybeUninit` slice exposure**     | `SQLDataCell.rs:120/133` `slice::from_raw_parts_mut(self.ptr, self.len/cap)` over an inline `(ptr,len,cap)` ABI struct (caller-maintained init invariant); `s3_signing/credentials.rs:1400` over a builder buffer (n ≤ 256 by construction).                                                                                                              |

## Macro-generated vs source-direct

| Crate            | Source-direct unsafe sites | Expanded post-macro sites (estimate) | Notes                                                                                                              |
| ---------------- | -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bun_sha_hmac`   | 12                         | ≈ 75                                | `new_hasher!` × 6 instances × 4 unsafe sites; `new_evp!` × 10 × 5; bodies share a SAFETY comment per template branch. |
| `bun_sql_jsc`    | 113 visible                | + ≈ 24 expanded                     | `bun_opaque::opaque_ffi!` (×3 — TimerHeap/Blob/SslCtxCache) + `jsc_abi_extern!` (≈ 5 sites in `jsc.rs`) emit `unsafe extern "C" {}` and `unsafe fn` accessors per opaque.                                                                                  |
| Other crates     | n/a                        | n/a                                 | No unsafe-emitting macros instantiated.                                                                            |

## sql_jsc concentration map (top files)

| File                                          | Sites | Top pattern                                                                                                |
| --------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `jsc.rs`                                      | 36    | Hook-table `unsafe fn` declarations for cross-crate SSL/timer/Blob FFI; `&mut *self`-style getters.        |
| `postgres/PostgresSQLConnection.rs`           | 25    | uSockets `adopt_tls`, `Self::deref` refcount drops, BoringSSL `SSL_CTX_free`, ext-slot writes.              |
| `postgres/PostgresSQLQuery.rs`                | 14    | Speculative `this.ref_()` / `Self::deref(this_ptr)` undo-on-error pattern (8 of 14 sites).                  |
| `mysql/MySQLConnection.rs`                    | 14    | Mirror of PostgresSQLConnection: TLS adoption, statement deref, write-buffer reborrow.                     |
| `shared/SQLDataCell.rs`                       | 12    | Tagged-union reads + `Box::<[u8]>::from_raw` reconstructions (Bytea, TypedArray; producer traces currently layout-match). |
| `mysql/MySQLRequestQueue.rs`                  | 9     | LinearFifo holds intrusive ref → `unsafe { JSMySQLQuery::deref(request) }` on discard.                     |
| `mysql/JSMySQLConnection.rs`                  | 7     | Connection-handoff `Self::deref(ptr)` paths + SSL_CTX_free.                                                 |
| `mysql/MySQLQuery.rs`                         | 6     | `is_null_thunk`/`to_data_thunk` extern-callable fn ptrs over `*mut Value` array.                            |
| `mysql/JSMySQLQuery.rs`                       | 4     | `ScopedRef::new(self.as_ctx_ptr())` pattern + cleanup.                                                      |
| `shared/CachedStructure.rs`                   | 3     | Local `[MaybeUninit<…>; 70]` table of dedup'd column ids + `set_len(non_dup_count)`.                        |
| Others (PostgresSQLContext, SASL, DataCell, postgres/types/date, MySQLContext, MySQLValue) | 12 | Single-block sites (PBKDF2 call, CStr-from-static, transmute-equivalent fn-ptr cast, etc.).               |

## EXP-001 caller status (LinearFifo uninitialized backing exposure)

`bun_collections::linear_fifo::LinearFifo<T, B>` is instantiated **3 times**
in section S, all with raw-pointer element types:

| Caller                                                                           | Element type                | Niche?                       |
| -------------------------------------------------------------------------------- | --------------------------- | ---------------------------- |
| `src/sql_jsc/postgres/PostgresRequest.rs:500-502` (`Queue`)                       | `*mut PostgresSQLQuery`      | No (raw ptr; full bit range) |
| `src/sql_jsc/mysql/MySQLRequestQueue.rs:20` (`Queue`)                             | `*mut JSMySQLQuery`          | No (raw ptr; full bit range) |
| `src/sql_jsc/jsc.rs:404-419` `TimerHeap` is **not** a LinearFifo (intrusive heap) | n/a                          | n/a                          |

**Correction (Codex): EXP-001 still applies at the container layer.** The
older "non-niche element type ⇒ sound" framing is too weak for Rust. Raw
pointers have no invalid discriminant, so they do not give the crisp
`invalid tag` witness that `RefDataValue` / `Entry` / `PromisePair` do, but
`DynamicBuffer<T>::as_slice()` still reinterprets the entire
`Box<[MaybeUninit<T>]>` backing allocation as `&[T]`, including slots that
were never initialized as `T`. Reading uninitialized memory is UB even when
every bit pattern is otherwise a valid raw pointer.

The practical risk in Section S is lower than Section J because the queue
operations appear to read only logically initialized slots, but this does not
make the underlying `LinearFifo` accessor sound. Phase 2 should either:

- fix `LinearFifo` once globally (preferred), or
- instantiate a raw-pointer Miri witness to confirm whether Section S's
  specific `read_item`/queue paths avoid observing uninitialized slots under
  current control flow.

Section J's Valkey/test-runner callers remain the strongest live witnesses;
Section S's Postgres/MySQL queues are additional users of the same unsound
container abstraction, not proof that EXP-001 is inapplicable.

## Crypto re-confirmation (csrf / sha_hmac / s3_signing)

- **`bun_csrf`**: zero unsafe blocks. All MAC operations route through
  `bun_sha_hmac::hmac::generate`. CSPRNG: `bun_core::csprng(&mut nonce)`
  (which goes through OS getrandom/CryptGenRandom — no userspace PRNG).
  Constant-time compare: `boring::constant_time_eq(received, expected)`
  (BoringSSL `CRYPTO_memcmp`).
- **`bun_sha_hmac`**: every unsafe block is a thin BoringSSL FFI call inside a
  macro template; SAFETY comment per template branch covers init/update/final
  buffer-length contracts. **Source-direct sites grew from 1 → 12** because
  the SHA/EVP wrapper macros were ported in this run; expansion volume is up
  ≈ 75 sites but template surface is small and audited.
- **`bun_s3_signing`**: 2 of 3 unsafe sites are `secure_zero` of credential
  bytes (`zero_sensitive` helper); the 3rd is a 256-byte stack builder
  `slice::from_raw_parts(buf.as_ptr(), n)` with `n ≤ 256` proven by
  construction. No SigV4-string handling unsafe; no key material handling
  unsafe outside the zero-on-drop path.

Prior-audit conclusion ("BoringSSL constant-time used; OS CSPRNG only; no
userspace PRNG") **stands**.

## Notable patterns

1. **Speculative-refcount-undo idiom in sql_jsc (≈ 20 sites)**. Every JS
   entry point that may `throw` performs `this.ref_()` first, attempts the
   work, and on error calls `unsafe { Self::deref(this_ptr) }` to release the
   speculative ref. The SAFETY narration is identical at every site
   ("undoes the speculative `this.ref_()` above; count was ≥2, never frees
   here"). Consolidating this into a `RefGuard`-style RAII drop type would
   cut ≈ 15-20 unsafe sites without changing semantics.
2. **`addr_of_mut!((*self.connection).field)` field-reborrow** — used in
   `MySQLConnection.rs:1555/1603/1613` to return `&mut OffsetByteList` over
   a single `*mut MySQLConnection` parent. SAFETY comments correctly call out
   "no two `&mut OffsetByteList` coexist" rather than relying on `&mut self`
   exclusivity.
3. **`Box::<[u8]>::from_raw` reconstruction in SQLDataCell** — the source
   still contains TODO(port) comments, but the current producers checked in
   Phase 1 trace cleanly. Bytea `parse_bytea()` allocates `hex.len()/2`,
   and `decode_hex_to_bytes()` either errors before `into_raw()` or returns
   that exact count (odd trailing nibble is ignored, which is semantic
   behavior, not layout UB). Postgres binary typed arrays allocate
   `out_bytes` and record/free by `byte_len`, not element count.
4. **Hook-table `unsafe fn` field type** (`sql_jsc/jsc.rs:245-277`) — the
   `SqlRuntimeHooks` struct is 18 fn-pointer fields, all `unsafe fn(...)`.
   These are filled in by `bun_runtime` at `init_runtime_state()` and called
   with `unsafe { (hooks().X)(...) }`. This is the right shape — caller
   carries the unsafe burden — but means every hook call site is an unsafe
   block.
5. **MySQL `sha256_password` BoringSSL chain** — the longest single sequence
   of unsafe in section S (`Auth.rs:208-281`, 8 unsafe blocks): clear-error,
   BIO_new_mem_buf, scopeguard BIO_free, PEM_read_bio_RSA_PUBKEY,
   scopeguard RSA_free, RSA_size, RSA_public_encrypt. SAFETY comments
   present per call; uses `scopeguard::guard` for RAII free.
6. **`unsafe impl Send for SSLConfig`** is the only `unsafe impl` in the
   entire section. The contained `NonNull<c_void>` points to a boxed
   `bun_runtime::socket::SSLConfig` whose fields (`CString`, `Vec`,
   `AtomicU64`) are themselves `Send`. Real cross-thread movement is bounded
   by the JS thread invariant — the comment notes this and effectively
   makes the impl narrative-only.
7. **`marked_argument_buffer_run` fn-ptr transmute** (`jsc.rs:948`) is the
   one ABI-shape cast in the section (`extern "C" fn(*mut Ctx, *mut MAB)` →
   `extern "C" fn(*mut c_void, *mut c_void)`). SAFETY note correctly
   identifies the requirement: same arity + same per-arg repr; reasoning is
   sound under thin-pointer ABI.

## Open questions

- **`SQLDataCell.rs:226` Bytea free** — source TODO is stale under current
  Postgres producers. `parse_bytea()` allocates exactly `hex.len()/2` bytes
  and records the same count in `bytea[1]`; binary bytea is borrowed
  (`free_value=0`). No current allocator-layout UB finding.
- **`SQLDataCell.rs:254` TypedArray free** — source TODO is also stale: this
  branch is live for Postgres binary typed arrays (`free_value=1`), but it
  records `byte_len == out_bytes` from the boxed allocation and deinit frees
  by `byte_len`. No current allocator-layout UB finding.
- **Hook-table init order** — hooks are called from JS-thread code that
  assumes `init_runtime_state` ran. No `Option`-wrap or
  `OnceCell::get_or_init`; each call dereferences a 0xCC-or-real fn pointer
  directly. Single-init is enforced upstream in `bun_runtime`; section-S
  callers carry no defensive null-check. Document the cross-section
  invariant in Phase-2 notes.
- **`unsafe impl Send for SSLConfig`** — should this be replaced with a
  `Send` blanket bound on `bun_runtime::socket::SSLConfig` itself, exposed
  through the type rather than the handle wrapper? Cross-section question
  with bun_runtime authors.
- **MySQL `is_null_thunk`/`to_data_thunk`** (`MySQLQuery.rs:240/248`) — the
  callback receives `ctx: *mut c_void` plus an index, casts to
  `*mut Value`, and `add(i)` walks the array. The `len` is documented as
  "checked in `Execute::write_internal`" — confirm bound is enforced
  contemporaneously, not stored-and-trusted across calls.
