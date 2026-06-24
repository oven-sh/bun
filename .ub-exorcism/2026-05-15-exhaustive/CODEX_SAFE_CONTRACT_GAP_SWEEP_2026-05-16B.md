# Codex Safe-Contract Gap Sweep — 2026-05-16B

Scope: post-convergence detector pass after the EXP-049 / EXP-096 strict-provenance split. This pass looked specifically for UB that can hide outside obvious `unsafe { ... }` blocks:

- generic or weakly bounded `unsafe impl Send` / `unsafe impl Sync`
- safe APIs returning `&mut` / `&'static mut` from `&self`
- recurring validity/provenance primitives that could have escaped the registry

This is a **gap sweep**, not a new phase. It does not replace the 21-section Phase 1 inventory or the Phase 2 bucket files.

## Queries

Representative detector commands:

```bash
rg -n 'unsafe impl(.*<.*>|<.*>.*)(Send|Sync)|unsafe impl<.*(Send|Sync)|pub (unsafe )?fn .*\\(&self\\).*->\\s*&'?\\w*\\s*mut|pub (unsafe )?fn .*->\\s*&'static\\s*mut|impl<.*> Send for|impl<.*> Sync for' \
  /data/projects/bun/src --glob '*.rs'

rg -n 'from_utf8_unchecked|from_utf16_unchecked|mem::zeroed|MaybeUninit::uninit\\(\\)\\.assume_init|set_len\\(|assume_init_(read|ref|mut)|unreachable_unchecked|get_unchecked|unwrap_unchecked|slice::from_raw_parts(_mut)?\\(|Vec::from_raw_parts\\(' \
  /data/projects/bun/src --glob '*.rs'
```

## Verdict

No new default-runtime `CONFIRMED_UB` entry was added by this sweep.

The one real artifact defect uncovered by the broader primitive sweep was already fixed separately in this pass: EXP-049 was misnamed as `SmolStr`, while current source has two different strict-provenance representations:

- **EXP-049 / F-P-13:** `src/bun_core/string/immutable.rs:1076`, `StringOrTinyString::slice`, byte-buffer pointer reconstruction via `usize::from_le_bytes`.
- **EXP-096 / F-P-17:** `src/bun_core/string/SmolStr.rs`, packed heap-pointer bits in a `u128`.

## Already Counted Correctly

| Detector hit | Registry / table owner | Current status |
|---|---|---|
| `fn(&self) -> &'a mut T` cluster, including `PackageManager::{log_mut,downloads_node_mut,env_mut}`, `PackageInstaller::*_mut`, `HTTPThread::*_mut`, SQL/JSC helpers | F-L-1 / EXP-057 | `CONFIRMED_UB` shape-level; production sites rely on one-call/single-loop invariants |
| `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` | EXP-079 | `CONFIRMED_UB` with Tree-Borrows two-call witness |
| `ThreadPool::get_worker(&self, id) -> &'static mut Worker` | EXP-087 | `CONFIRMED_UB` with duplicate-handle Tree-Borrows witness |
| `IOWriter` / `IOReader` safe `&self` mutators over `UnsafeCell<State>` | EXP-083 | `CONFIRMED_UB` generic safe-API contract |
| `Blob: Send + Sync` with safe JS-thread-affine access | EXP-082 | `CONFIRMED_UB` generic safe-API contract |
| `VirtualMachine: Send + Sync` plus safe TLS-backed mutation accessors | EXP-084 | `CONFIRMED_UB` safe off-thread trap |
| `StoreSlice<T>` unbounded `Send` / `Sync` | EXP-019 | `CONFIRMED_UB`; proposed fix is open PR #30765 |
| `JsCell<T>` unbounded `Send` / `Sync` | EXP-045 | `CONFIRMED_UB`; same bounded-impl fix shape as EXP-019 |
| `AtomicCell<T: Copy>` unbounded `Send` / `Sync` with safe `new()` + `into_inner()` | EXP-098 | `CONFIRMED_UB`; later follow-up corrected this from hardening-only to direct Bun-crate Miri data-race witness |
| `link_interface!` public erased-handle fields | EXP-080 | `CONFIRMED_UB`; private-field macro fix |

## Reviewed But Not Promoted

These hits looked suspicious under the broad regex but did not justify new EXP entries:

| Hit | Why not a new EXP |
|---|---|
| `src/runtime/dns_jsc/dns.rs:107` and `src/bundler/BundleThread.rs:173` local `SendPtr<T>` wrappers | Already called out in Phase 8 as hardening siblings of EXP-019/045. The wrappers are private/function-local, and the audit has no source-faithful misuse witness that safe callers can exercise. Keep as bounded-wrapper hardening, not counted UB. |
| `src/css/declaration.rs:53-54` `DeclarationBlock<'bump>: Send + Sync` | Concrete, non-generic wrapper over `Property` arena vectors with a detailed post-parse-read-only SAFETY comment. This still deserves a future `assert_impl_all!(Property: Send, Sync)` / no-post-parse-allocation guard, but this sweep found no callable safe API that launders a `!Send` payload into `DeclarationBlock`. |
| `src/collections/array_hash_map.rs:1561-1562` `StringHashMapKey<A>: Send + Sync` | Bounded on allocator `A: Send/Sync`; the key payload is raw pointer + packed length whose ownership/lifetime modes are already documented. No new thread-affinity or `!Send` payload laundering found. |
| `src/http/HTTPThread.rs:287` `decompressor_mut(&self) -> &'a mut Decompressor` | Covered by F-L-1 as part of the caller-chosen-lifetime `&self -> &mut` cluster. The helper is not a separate finding unless a production double-borrow/re-entry path is proved. |
| `RacyCell<T>` / `ThreadCell<T>` generic impls | Already discussed in Bucket-7/8 notes and Phase 8. Current production instantiations are either C++-mutated extern statics or thread-confined scratch. Add per-payload assertions, but do not double-count without a concrete misuse witness. |

## Artifact Impact

- No registry verdict changes.
- No new default-runtime UB count.
- EXP-096 was the only new EXP from this detector cycle, and it is explicitly
  `DEFERRED` strict-provenance release-gate work.
- Later syn-walker round 83 promoted EXP-097, and the later AtomicCell
  follow-up promoted EXP-098. Current live registry totals are 94 EXP entries
  = 60 `CONFIRMED_UB`, 15 `NO_EVIDENCE`, 17 `DEFERRED`, 2 `RESOLVED`, 0
  `OPEN`, 0 `NEEDS_REFINEMENT`.
