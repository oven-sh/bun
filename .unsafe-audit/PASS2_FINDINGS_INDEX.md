# Pass 2/3 — Consolidated Findings Index

This is the master index of findings produced by the Claude pass-2 multi-agent
deep-dive plus the Codex pass-2/3 adversarial passes.

**Pass 3 final correction:** Claude's later Pass 3 promoted the bundler
parallel-callback issue from the watchlist into a confirmed high-confidence
Stacked Borrows / Tree Borrows violation group. This file keeps the original
Pass 2 roadmap for continuity, but the definitive Pass 3 adjudication is in
[PASS3_FINDINGS_INDEX.md](PASS3_FINDINGS_INDEX.md) and
[CODEX_PASS3_FINAL_REVIEW.md](CODEX_PASS3_FINAL_REVIEW.md).

**Accuracy rule for this index:** keep the real bugs forceful, but do not pad
the count by mixing them with intentional `bun:ffi` contracts, duplicates, or
design watchlist items. A finding is listed as a confirmed/high-confidence bug
only when the source contains a concrete unsound operation or a safe API contract
that lets ordinary Rust/JS callers create UB without another `unsafe` block.

**Headline:** Pass 1 found 2 compact latent bugs. Pass 2/3 expands that to:

- **14 confirmed or high-confidence patchable soundness bugs / bug groups**
  (Tier 1 below). Several groups contain multiple source sites.
- **7 unsafe public-contract defects / architecture defects** (Tier 2): real
  soundness risks at safe API boundaries, but larger than a one-line fix.
- **8 latent or threat-model-dependent watchlist findings** (Tier 3).
- **4 bounded leaks / availability bugs** and **4 perf-only refactor classes**.

That is a much stronger result than pass 1, but the count is now defensible: the
`bun:ffi` raw-pointer capabilities are separated from bugs in Bun's own lifetime
management.

## Tier 1 — Confirmed / High-Confidence Patchable Soundness Bugs

| # | ID | Location | Class | Plan |
|---|----|----------|-------|------|
| 1 | pre-existing-ub-002 | `bun_ast::nodes:339-340` | Unconditional `unsafe impl<T> Send/Sync for StoreSlice<T>` while adjacent `StoreRef<T>` correctly requires `T: Send` / `T: Sync`. This launders `!Send` / `!Sync` payloads through a safe type. | C-003 |
| 2 | pre-existing-ub-001 | `linux_errno.rs:175-188` | `transmute<usize, SystemErrno>` with a kernel-range claim wider than the enum discriminants. A future caller can produce an invalid enum value. | C-002 |
| 3 | UB-RT-001 | `webcore/encoding.rs:303-310` | `Vec<u8>` -> `Vec<u16>` via `Vec::from_raw_parts`, violating allocator layout and alignment. The source TODO already flags the problem. | PASS2-bun-runtime |
| 4 | U1 | `pack_command.rs:3009` | Forms `&mut T` from `std::ptr::from_ref(...).cast_mut()`. Immediate UB under Stacked Borrows and Tree Borrows; fix by threading a true mutable/raw owner through the call chain. | PASS2-ptr-cast |
| 5 | U2.x8 | `http/AsyncHTTP.rs:117`, `http/lib.rs:176`, `runtime/node/node_fs.rs:2397`, `bun_alloc/lib.rs:3267`, `bun_core/string/mod.rs:1765`, `jsc/lib.rs:2022` (was `:2013` pre-`fe2635b460` cargo fmt; per Pass-5 accuracy sweep), `jsc/ZigString.rs:70,102` | Deallocation/free through a pointer derived from shared provenance (`from_ref(...).cast_mut()` / slice `.as_ptr().cast_mut()`). This is SB-UB on the dealloc path; the mechanical fix is to retain the original owning `Box`/`NonNull`/`*mut`. | PASS2-ptr-cast |
| 6 | pre-existing-ub-ptr-1 | `standalone_graph::slice_to[_mut/_z]` | Release builds use `from_raw_parts[_mut]` after `debug_assert!`-only bounds checks over offsets from embedded standalone module data. Tampered standalone artifacts can turn this into OOB slice formation. | PASS2-ptr-intrinsic |
| 7 | pre-existing-ub-ptr-2 | `bun_core::Unaligned::slice_align_cast[_mut]` | `debug_assert!`-only alignment check, then forms `&[T]` / `&mut [T]`. Any release caller with unaligned bytes creates immediate reference UB; JS ArrayBuffer helpers are representative callers. | PASS2-ptr-intrinsic |
| 8 | pre-existing-ub-ptr-3 | `bun_io::Request::store_callback_seq_cst` | `write_volatile` plus `SeqCst` fence used as a cross-thread publish primitive. Volatile is not atomic; the field should be an `AtomicPtr`/`AtomicUsize` with Release/Acquire. | PASS2-ptr-intrinsic |
| 9 | pre-existing-ub-ptr-4 | `SysQuietWriterAdapter::adapter_write_all` (`sys/lib.rs:9130`) | `this.pos + bytes.len()` can overflow, bypass the capacity check, then `copy_nonoverlapping` past the buffer. | PASS2-ptr-intrinsic |
| 10 | pre-existing-ub-ptr-5 | Windows shim `bun_shim_impl.rs:1244` | `ptr::copy(src, dst, len + 1)` is guarded only by `debug_assert!` against malformed shim metadata. Release builds need a real bound check. | PASS2-ptr-intrinsic |
| 11 | pre-existing-ub-ptr-6 | `SerializedSourceMap::header()` | Public/sibling accessors call `header()` before checking `bytes.len() >= size_of::<Header>()`, so a truncated blob can OOB-read via `read_unaligned`. | PASS2-ptr-intrinsic |
| 12 | pre-existing-ub-9 | `runtime/ffi/ffi_body.rs:1351-1370` | `FFI.close()` frees TinyCC/JIT state while JS-visible `JSFFIFunction` wrappers retain callable trampoline pointers. Calling a stashed function after close jumps into freed code/data. | PASS2-jsc-invariants |
| 13 | pre-existing-ub-10 | `runtime/ffi/ffi_body.rs:1281-1285`, exported from `FFIObject.rs` | Hidden-but-exported `closeCallback(ctx)` accepts a JS-supplied address and runs `heap::take` with no membership check. Wrong address or double-close is arbitrary-free/double-free. | PASS2-jsc-invariants |
| 14 | F-1 / pre-existing-ub-13 | `bun_collections::linear_fifo::assume_init_slice{,_mut}` | Reinterprets the full `[MaybeUninit<T>]` backing storage as `[T]`. Active niche-bearing users include `LinearFifo<RefDataValue, _>` in the test runner and Valkey queue payloads with `Box`/`Strong`-like fields. | PASS2-maybe-uninit |

## Tier 2 — Unsafe Public-Contract / Architecture Defects

These are real soundness problems at safe abstraction boundaries. They are not
weaker findings; they are simply larger remediations than Tier 1.

| # | ID | Location | Defect | Plan |
|---|----|----------|--------|------|
| 15 | F-2 / pre-existing-ub-14 | `bun_threading::Channel::{try_read_item, read_item}`, `BoundedArray::add_many_as_slice` | Same `MaybeUninit<T>` -> `T` reference shape as F-1. Current in-tree `T`s are POD-ish, but the generic APIs admit niche-bearing `T`. Bound or split the APIs before future callers make it active UB. | PASS2-maybe-uninit |
| 16 | CODEX-P3-task-traits | `AnyTaskJobCtx`, `ConcurrentPromiseTaskContext`, `WorkTaskContext`, `CryptoJobCtx`, `owned_task!` | Safe traits/macros let generic contexts run on worker threads without `C: Send` or an `unsafe trait` contract. Sampled current impls are often disciplined; the safe abstraction is still unsound for future impls. | CODEX-P3-cross-thread-task |
| 17 | CODEX-P3-writer-static-mut | `bun_core::output::*writer()` | Safe APIs return aliasable `&'static mut io::Writer` from TLS. The source itself calls the shape unsound if two refs are live. Replace with closure-scoped writer access. | CODEX-P3-static-mut-lifetime |
| 18 | CODEX-P3-scratch-buffers | `ModKey::hash_name`, `HPACK::decode`, `Repository::{try_ssh,try_https}`, `resolve_path::normalize_string` | Safe APIs return refs whose true lifetime is "until next call on this thread", not the signature's ordinary borrowed lifetime. | CODEX-P3-static-mut-lifetime |
| 19 | L-001 | `Watcher::shutdown` / `Watcher::thread_main` | High-confidence ownership race: the watcher thread can free `Watcher` while a concurrent `shutdown` still reads `watchloop_handle`. Source TODO says Rust needs `heap::take`/`Arc` to make this sound. | A-002 |
| 20 | PUB-N-A | `jsc/JSCell.rs:128` | `unsafe impl<T> Send for JsCell<T>` unbounded in `T`, same type-system shape as `StoreSlice<T>` but with smaller confirmed blast radius. | PASS2-custom-invariants |
| 21 | PUB-N-B | `bun_core/util.rs:2282` | `unsafe impl<T: ?Sized> Sync for RacyCell<T>` is discipline-only; docs forbid `Cell`/`Rc` payloads but the type system permits them. | PASS2-custom-invariants |

## Tier 3 — Latent / Threat-Model-Dependent Watchlist

| # | ID | Location | Concern |
|---|----|----------|---------|
| 22 | CODEX-P2-windows-waker | `BundleThread.rs:147-155` | Windows-only `zeroed_unchecked()` for `Async::Waker` despite `placeholder()` now existing. |
| 23 | CODEX-P2-renamer-tasks | `bundler/Chunk.rs:130-132` plus Pass 3 B-1..B-5 sites | **Promoted by Pass 3.** This is no longer merely an in-tree TODO/watchlist item: worker callbacks materialize concurrent `&mut LinkerContext`, `&mut Chunk`, and renamer references across peer tasks. See `PASS3-bun-bundler-deep-dive.md` and the Codex Pass 3 final review. |
| 24 | pre-existing-ub-7 | `runtime/webcore/fetch/FetchTasklet.rs:374-391` | Shutdown-gated drop of `StrongOptional`/`Weak` from the HTTP thread. Fix by always routing JSC-handle drops to the JS thread or leaking at shutdown. |
| 25 | pre-existing-ub-8 | architectural | `bun_core::String` is `Send`/`Sync` and relies on call-site `to_thread_safe()` discipline for atom-string thread affinity. Needs a `ThreadSafeString` type to make the invariant static. |
| 26 | RT-DOC-001 | `jsc_hooks.rs:2324` | Invisible `'static` widening on a borrowed byte slice; currently call-graph-disciplined. |
| 27 | RT-FRAGILE-001 | `server/RequestContext.rs:321` | `as_response` returns `&'static mut Response` without encoding the GC-protect requirement. |
| 28 | RT-FRAGILE-002 | `node/path_watcher.rs:108` | `unsafe impl Sync` over `Cell<Fd>` is sound only through a `std::thread::spawn` publish edge invisible to the type. |
| 29 | UB-RISK-ALIGNMENT-pe | `exe_format/pe.rs:289,301` | `SectionHeader` view over bytes has unaligned-load risk; replace reference casts with `read_unaligned`/bytemuck checked APIs. |

## Intentional `bun:ffi` Unsafe Contract Hazards

These are dangerous and user-facing, but they are part of `bun:ffi`'s raw
pointer capability model. Do not count them as Bun lifetime bugs unless Bun's
docs/API claim they are safe for arbitrary JS values. Track them as API
contract hardening.

| ID | Location | Contract |
|----|----------|----------|
| FFI-CONTRACT-ADDR-LEN | `runtime/ffi/FFIObject.rs:801-916` | `toArrayBuffer` / `toBuffer` / `toCStringBuffer` accept user-provided `(addr, len)` and form `from_raw_parts_mut`. Document that the range must be valid, mapped, writable as required, and not aliased with Rust/JSC-owned memory. |
| FFI-CONTRACT-FINALIZER | `runtime/ffi/FFIObject.rs:22-29` | User-provided numbers can become typed-array finalizer function pointers. Keep the zero-overhead FFI escape hatch, but document it and consider registry validation for safer modes. |

## P3 — Bounded Leaks / Availability Bugs

| # | ID | Location | Class |
|---|----|----------|-------|
| 30 | leak-1 | `install_types/resolver_hooks.rs:414` | `DependencyVersionValue::npm`'s `ManuallyDrop<NpmInfo>` is never reclaimed -> per-install memory leak. |
| 31 | leak-2 | `runtime/cli/open.rs:505-513` | Windows-only `MiniEventLoop + uv_loop_t` leak in `Editor::open` (author-flagged `FIXME(windows-leak)`). |
| 32 | drop-fchdir | `bun.rs:860` | `CwdRestore::drop` can abort the process on a real `fchdir` failure. Availability bug, not UB. |
| 33 | drop-mysql | `sql_jsc/mysql/MySQLRequestQueue.rs:347` | `expect("queue item non-null")` in Drop can abort on corrupt queue state. Availability bug, not UB. |

## P4 / P5 — Perf-only B-candidates and Refactor Classes

| # | ID | Class |
|---|----|-------|
| 34 | B-001 | 17 `unreachable_unchecked` sites — candidates only until benchmark logs are attached. |
| 35 | B-002 | 13 `get_unchecked` sites — candidates only until benchmark logs are attached. |
| 36 | atomic-too-strong | ~115 `SeqCst` sites that likely can be relaxed to AcqRel/Acquire/Release after measurement and proof; not correctness bugs. |
| 37 | bindgen-drift | `bun_jsc/generated.rs` — 4 `unreachable_unchecked` sites should become unconditional `unreachable!()` so bindgen drift fails safely. |
| 38 | strict-provenance | 11 pointer-address cycles that fail `-Zmiri-strict-provenance`; mechanical migration to `expose_provenance` / `with_exposed_provenance` or pointer-carrying storage. |

## C — Refactor Opportunities

| # | ID | Class |
|---|----|-------|
| 39 | C-001 | 22+ of 40 `NonNull::new_unchecked` sites refactor to `NonNull::from` / `NonNull::new(p).expect(...)` after excluding the const-site from the headline batch. |
| 40 | C-002 | 3 `transmute<int, enum>` sites -> `strum::FromRepr`, plus 3 checked/unchecked constructor pairs. |
| 41 | C-003 | 46 of 157 manual Send/Sync impls refactor (28 propagating + 9 assertions + 3 remove + 6 consolidate). |
| 42 | C-005 deferred | Pure-Rust `Self::xxx(this)` callers need rustdoc JSON/call graph to distinguish FFI callback paths from refactorable internal paths. |

## Significant Negative Findings

Audit value includes ruled-out classes:

| Audit | Result |
|-------|--------|
| 537 raw_ptr_lifecycle sites | No confirmed ordinary heap-roundtrip UAFs, double-frees, or mismatched allocators in the sampled/clustered `bun_core::heap` discipline. The exceptions are the separate provenance-dealloc findings in Tier 1. |
| 298 slice_from_raw sites | No high-priority JS-reachable buffer-overrun primitive found in ordinary `slice_from_raw` use. Defense-in-depth from JSC C++ bounds, JS-side asserts, and vendored-C contracts largely holds. |
| 101 atomic sites | No confirmed too-weak happens-before bugs; the audit found too-strong ordering candidates instead. |
| 1,610 Zig-port `*mut Self` sites (sampled 122) | No broad anti-pattern collapse. The `*mut Self` design is mostly load-bearing; the real issues are narrow exceptions and safe-contract leaks. |
| Pin projection | No Pin-projection UB surface in production Rust. Bun mostly uses raw heap-stability idioms, not `Pin` projection. |

## Macro-expanded Surface

`cargo expand` now runs for sampled crates after the audit-only `vendor/lolhtml/c-api`
stub.

| Crate | Source-level unsafe-ish hits | Macro-expanded unsafe-ish hits |
|-------|---:|---:|
| `bun_alloc` | 273 | 299 (+9.5%, not +2.1x) |
| `bun_errno` | ~8 | 9 + 2 `#[unsafe(no_mangle)]` |

**The 11,044 inventory remains a lower bound.** Macro expansion exposes more
tokens. The early sampled macro-emitted unsafe was mostly derive/bindgen/FFI
export machinery, but Pass 3's broader macro/source review did change the
priority story for bundler and JSC contract findings. Use the Pass 3 index for
current tiering.

## Real Verification

`verification-log.md` records per-crate `cargo +nightly miri test
-Zmiri-strict-provenance` attempts. The precise wording matters:

- **7 crates passed with real tests**: `bun_errno`, `bun_ast`, `bun_alloc`,
  `bun_ptr`, `bun_threading`, `bun_wyhash`, `bun_md` (**43 tests in fully
  passing crates**).
- **12 crates passed vacuously** because their lib targets had zero unit tests.
- **2 crates had pre-existing assertion failures** (`bun_paths`, `bun_base64`);
  these also fail outside miri and are not UB findings.
- **1 crate was miri-unsupported** (`bun_io`, FFI to simdutf).
- **1 crate had a test-code compile error** (`bun_collections`).

No miri run produced a UB diagnostic for the audited code. That is useful
negative evidence, not proof that the static findings are false: most Tier 1
bugs need adversarial inputs or new compile-time tests before miri can observe
them.

## Plan Documents in This Audit

- [PASS2-bun-runtime-deep-dive.md](audit/plans/PASS2-bun-runtime-deep-dive.md)
- [PASS2-ptr-cast-deep-dive.md](audit/plans/PASS2-ptr-cast-deep-dive.md)
- [PASS2-ptr-intrinsic-deep-dive.md](audit/plans/PASS2-ptr-intrinsic-deep-dive.md)
- [PASS2-maybe-uninit-deep-dive.md](audit/plans/PASS2-maybe-uninit-deep-dive.md)
- [PASS2-atomic-ordering-audit.md](audit/plans/PASS2-atomic-ordering-audit.md)
- [A-002-heap-roundtrip-audit.md](audit/plans/A-002-heap-roundtrip-audit.md)
- [PASS2-slice-from-raw-buffer-bounds.md](audit/plans/PASS2-slice-from-raw-buffer-bounds.md)
- [PASS2-todo-hunt-and-arena-drop.md](audit/plans/PASS2-todo-hunt-and-arena-drop.md)
- [PASS2-jsc-invariants-and-ffi.md](audit/plans/PASS2-jsc-invariants-and-ffi.md)
- [PASS2-pin-and-drop-hazards.md](audit/plans/PASS2-pin-and-drop-hazards.md)
- [PASS2-custom-invariants-and-other-recategorization.md](audit/plans/PASS2-custom-invariants-and-other-recategorization.md)
- [audit/synthesis/macro-expanded-unsafe-survey.md](audit/synthesis/macro-expanded-unsafe-survey.md)
- [verification-log.md](verification-log.md)
- Codex pass-2 and pass-3 addenda

## Pass-2 PR Landing Order

1. **`StoreSlice<T>` Send/Sync fix** — 2-line patch.
2. **`linux_errno.rs` `impl GetErrno for usize` fix** — checked enum conversion.
3. **`encoding.rs` `Vec<u8>` -> `Vec<u16>` fix** — eliminate raw-parts reinterpret.
4. **`linear_fifo` MaybeUninit slice fix** — return initialized range only or encode an `AnyBitPattern` bound.
5. **`pack_command.rs:3009` fix** — thread `*mut ContextData` / true mutable ownership end-to-end.
6. **8 mut-from-shared dealloc fixes** — retain original owner pointer instead of freeing through shared-provenance slices.
7. **`standalone_graph::slice_to_*` checks** — promote release bounds checks before slice formation.
8. **`Unaligned::slice_align_cast` checks** — promote alignment to runtime checked API.
9. **`bun_io::Request` publish fix** — replace volatile+fence with atomic pointer publication.
10. **`SysQuietWriterAdapter` overflow check** — use checked/saturating arithmetic before copy.
11. **Windows shim metadata bound check** — real release guard before `ptr::copy`.
12. **`SerializedSourceMap::header()` length check** — checked accessor before `read_unaligned`.
13. **`bun:ffi` close hardening** — invalidate `JSFFIFunction` wrappers on `FFI.close` and validate `closeCallback` membership.
14. **Task-trait contract migration** — make worker context traits `unsafe` or require/split `Send` state.
15. **Output writer / scratch-buffer API migrations** — closure-scoped writer access and non-escaping scratch-buffer APIs.

This is a reviewable roadmap of point fixes followed by architectural contract
PRs. The first dozen patches are small enough to land independently; the later
contract migrations should be split by subsystem.
