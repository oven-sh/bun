# Section N: bun_core-foundation (9 crates)

## Purpose

The 9 crates under audit form Bun's foundational tier — the layer everything
else depends on. They span: the `bun_core` crate itself (strings, formatting,
logging, env vars, allocator/heap helpers, atomic primitives, fmt, util),
`bun_core_macros` (proc-macros that emit `#[derive(ThreadSafeRefCounted)]` /
`#[derive(CellRefCounted)]` / `#[derive(Anchored)]` glue), `bun_safety`
(allocator-identity registry, ASan/LSan FFI shims, debug-only `CriticalSection`
race detector), `bun_opaque` (the `opaque_ffi!` ZST handle macro), `bun_ptr`
(`RefPtr`, `RefCount`, `ParentRef`, `BackRef`, `ThisPtr`, `Owned`, `Shared`,
`CowSlice`, `TaggedPointer` — the workspace's pointer-utility hub), and the
SIMD/hashing leaves `bun_wyhash`, `bun_hash`, `bun_base64`, `bun_highway`.

If a UB shape exists *here*, every higher tier inherits it. Conversely, the
"strong-shape" patterns established here — typed `unsafe trait Atom` for atomic
cells, `addr_of!` projection in derive output to avoid `&Self` formation,
ZST-handle opaques with `UnsafeCell<[u8;0]> + PhantomPinned`, paired
`heap::into_raw`/`heap::take`/`heap::destroy` with explicit owner doc — set the
discipline reused throughout the runtime crates.

## Per-crate unsafe-surface tally (vs prior subtotals)

| Crate | New scan | Prior audit | Δ | Notes |
|-------|---------:|------------:|---:|-------|
| `bun_core` | **582** | 461 | +121 | env_var typed-cache macro expansion, Progress port, util argv/environ |
| `bun_core_macros` | **37** | n/a (not in prior audit) | new | proc-macro output (counts in macro source not call sites) |
| `bun_safety` | **8** | 7 | +1 | added one ASan wrapper variant |
| `bun_opaque` | **21** | 10 | +11 | grew `FfiLayout` macro expansion + windows wcslen helpers |
| `bun_ptr` | **161** | 128 | +33 | derive forwarders + `parent_ref` SAFETY-wrapped accessors |
| `bun_wyhash` | **5** | 4 | +1 | added `final_long` cold-tail unaligned-read |
| `bun_hash` | **0** | 3 | -3 | (prior count likely included some `// SAFETY:` text matches; current crate is 100% safe) |
| `bun_base64` | **4** | 3 | +1 | added `simdutf` wrapper (no new unsafe; FFI re-export) |
| `bun_highway` | **13** | 12 | +1 | one additional Highway shim |
| **TOTAL** | **831** | **625** | **+206** | |

## atomic_cell.rs re-confirmation

* **Default ordering: AcqRel verified.**
  * `load(&self) -> T`: `Ordering::Acquire` (line 92).
  * `store(&self, v)`: `Ordering::Release` (line 99).
  * `swap(&self, v) -> T`: `Ordering::AcqRel` (line 106).
  * `compare_exchange`: success `AcqRel`, failure `Acquire` (lines 119-120).
  * `fetch_update`: built on `compare_exchange` — inherits AcqRel.
  * Quote (lines 43-48): _"Default ordering is **Acquire/Release**, not
    Relaxed — at least six of the data-race findings that motivated this type
    were 'Relaxed gives no happens-before for the init it guards'. Telemetry
    / best-effort hints can opt out via `load_relaxed` / `store_relaxed`,
    named so grep finds every site that opted out of ordering."_

* **Relaxed opt-in: name-explicit verified.** The only paths that take
  `Ordering::Relaxed` in `atomic_cell.rs` are `pub fn load_relaxed` (line 144)
  and `pub fn store_relaxed` (line 151). A workspace-wide grep confirms only
  `atomic_cell.rs` itself defines/calls these names; downstream callers
  trip the grep when they opt out.

* **Too-weak Release-without-Acquire pairs?** None in `atomic_cell.rs`.
  Workspace-wide in section N: the SeqCst cluster in `bun_ptr/ref_count.rs`
  (8 sites: lines 474, 492, 527, 566, 588, 597, 1131, 1225) is the *opposite*
  of too-weak — SeqCst is conservative; could be downgraded to
  Release/Acquire/Relaxed-on-fastpath per stdlib `Arc`, but that is a
  performance polish, not a soundness defect.

* **Any SeqCst that should be Relaxed?** As above — `bun_ptr::ref_count` uses
  SeqCst for refcount fetch_add/fetch_sub/load. This is conservative
  over-synchronization, not UB. **No too-weak orderings detected**, matching
  the prior audit's finding.

* **Total atomic op sites in section N: 203** (vs prior 101). The doubling
  reflects growth in `bun_core::env_var` (typed-cache macro expansion,
  ~80 sites), `bun_core::Progress` (~15), `bun_core::util` argv/environ ports
  (~25), and `bun_safety::CriticalSection`'s ci_assert-only counters (~20).
  All Relaxed sites surveyed have either an inline rationale comment, carry
  scalar state that does not publish separate memory, or use an explicit
  publication edge elsewhere. For example, `env_var::string::Cache` stores
  `ptr_value` Relaxed and then publishes `len_value` with Release; readers
  Acquire-load `len_value` before loading `ptr_value`.

## bun_core::heap helpers audit (into_raw/take/destroy/release/alloc_nn)

* **No new shapes since prior audit.** `heap.rs` is unchanged structurally:
  `alloc` / `into_raw` / `release` / `take` / `destroy` / `alloc_nn` /
  `into_raw_nn`, plus the deprecated `leak` alias.
* Only `take` and `destroy` are `unsafe fn`; both have `# Safety` docs that
  say "ptr must be the unique live pointer to a `Box<T>` allocation that has
  not yet been [`take`]n or [`destroy`]ed."
* `release` (was `Box::leak`-by-another-name) is **safe** by signature, with
  doc demanding the call site name the owner that will reclaim — direct
  re-affirmation of prior audit's "audited across the raw-pointer-lifecycle
  cluster without finding direct use-after-free, double-free, or
  mismatched-allocator bugs in that helper discipline."
* Workspace usage: `rg 'bun_core::heap|heap::take|heap::destroy|heap::into_raw'`
  returns 1036 hits across the workspace — pervasive but uniformly through
  the typed wrappers `WorkPool::schedule_owned`, `Task::from_boxed`,
  `js_class!` `to_js_boxed`, etc. (not direct calls). No caller pattern that
  violates the helper's documented invariant detected.

## bun_ptr crate deep-dive (public unsafe fn surface)

24 `pub unsafe fn` exports, every one with a `# Safety` doc-comment block:

| pub unsafe fn | file:line | # Safety doc | dominant bucket |
|---------------|-----------|--------------|-----------------|
| `BackRef::get_mut` | `lib.rs:178` | yes | #1 aliasing |
| `detach_lifetime` (slice) | `lib.rs:238` | yes | #9 Pin/lifetime laundry |
| `detach_lifetime_ref` | `lib.rs:258` | yes | #9 |
| `detach_lifetime_mut` | `lib.rs:274` | yes | #9 |
| `boxed_slices_as_borrowed` | `lib.rs:337` | yes | #1 #6 |
| `ThisPtr::new` | `lib.rs:559` | yes | #4 validity-non-null |
| `ParentRef::from_nullable_mut` | `parent_ref.rs:255` | yes | #1 |
| `ParentRef::assume_mut` | `parent_ref.rs:340` | yes | #1 #2 (provenance) |
| `RefCount::ref_` (atomic) | `ref_count.rs:265` | yes | #7 |
| `RefCount::deref` (atomic) | `ref_count.rs:292` | yes | #7 |
| `RefCount::deref_with_context` | `ref_count.rs:302` | yes | #7 |
| `RefCount::dupe_ref` | `ref_count.rs:335` | yes | #7 |
| `CellRefCount::ref_` | `ref_count.rs:469` | yes | #1 |
| `CellRefCount::deref` | `ref_count.rs:487` | yes | #1 |
| `CellRefCount::release` | `ref_count.rs:522` | yes | #1 |
| `CellRefCount::dupe_ref` | `ref_count.rs:550` | yes | #1 |
| `RefPtr::init_ref` | `ref_count.rs:801` | yes | #4 |
| `RefPtr::adopt_ref` | `ref_count.rs:853` | yes | #4 |
| `RefPtr::from_raw` | `ref_count.rs:878` | yes | #4 |
| `RefPtr::take_ref` | `ref_count.rs:927` | yes | #4 |
| `RefPtr::unchecked_and_unsafe_init` | `ref_count.rs:956` | yes | #4 |
| `RefPtr::new` | `ref_count.rs:1011` | yes | #4 |
| `RefPtr::adopt` | `ref_count.rs:1027` | yes | #4 |
| `Owned::from_raw` | `owned.rs:302` | yes | #4 (alias of `heap::take`) |

**24 / 24 have `# Safety` doc.** No bare unsafe public surface in `bun_ptr`.

## bun_safety crate audit (any unsafe at all is suspicious)

8 unsafe sites total — 1 `unsafe extern "C"` decl block (with 7 ASan/LSan
function declarations) plus 7 wrapper unsafe blocks. **All 7 blocks are
gated by `cfg(bun_asan)`** and the `cfg!(not(bun_asan))` arm provides
no-op stubs. Every block has a SAFETY: comment naming "ASAN runtime is
linked when this cfg is active". The non-ASan files in the crate
(`alloc.rs`, `CriticalSection.rs`, `ThreadLock.rs`, `lib.rs`,
`thread_id.rs`) contain **zero** unsafe blocks — they implement
allocator-identity checks and a debug-only race detector entirely in safe
Rust. The `bun_safety` invariant ("the safest possible crate") holds.

The `lib.rs` allocator-vtable registry (`KNOWN_ALLOC_VTABLES` /
`KNOWN_ALLOC_LEN`) uses Relaxed atomics with an explicit doc rationale
(lines 49-57): _"Registration is single-threaded at startup
(`bun_bin::main` step 6, before reader threads spawn), so cross-thread
ordering is provided by the thread-spawn happens-before edge — not by
these atomics."_ This is a textbook init-once-then-RO pattern; Relaxed is
correct, not weak.

## bun_core::build_options post-#30749 audit

`build_options.rs` is generated by `scripts/build/buildOptionsRs.ts` from
the resolved `Config`. The generator emits **only** `pub const`
declarations (string literals, bool literals, a `Version { major, minor,
patch }` struct, a `&[u8]` byte-string for paths via `.as_bytes()`, and
three `cfg!()`-gated bool consts). **Zero unsafe in the generated file.**
The host script (`buildOptionsRs.ts`) does not contain `unsafe` either.
The `bun_core/build.rs` cargo build script is plain safe Rust that
asserts the file exists, then sets `rustc-env` and `rerun-if-changed`.
Net new unsafe attributable to commit `bb1973e485` and the build_options
re-architecture: **0**.

## SIMD crate audit (base64 / wyhash / hash / highway)

* **target_feature usage:** **none**. None of these 4 crates gates code on
  `#[target_feature(...)]` or `#[cfg(target_feature = ...)]`. SIMD
  dispatch lives entirely on the C++/Highway side (linked through
  `unsafe extern "C"` declarations).
* **inline asm:** **none**. `rg 'asm!' src/{base64,wyhash,hash,highway}`
  returns no matches.
* **unaligned reads:** 5 sites in `bun_wyhash::lib.rs` — all
  `core::ptr::read_unaligned` (lines 45-50, 568-580, 681) used inside the
  inner hash loop (`Wyhash::final_long` and `Wyhash::round`) to match Zig
  `std.mem.readInt(.little)` codegen exactly. Each site has a SAFETY
  comment that names the per-caller `data.len() >= N` proof. `read_unaligned`
  imposes no alignment requirement so #3 (alignment) is not engaged; #5
  (uninit) is engaged only insofar as the slice must be initialized, which
  the bounds-proven slice always is.
* **`bun_hash` crate is 0% unsafe** — entirely safe Rust over `&[u8]` with
  scalar-fold inner loops (`adler32`, `cityhash`, `murmur`, `rapidhash`,
  `xxhash`).
* **`bun_highway` is pure FFI shim** — one `unsafe extern "C"` block
  declaring 12 dispatch functions, plus one `unsafe { highway_*(...) }`
  wrapper per public entry point. SAFETY comments uniformly name "ptr/len
  readable/writable range".
* **`bun_base64`** combines a thin FFI shim (`WTF__base64URLEncode`) with
  two `get_unchecked` sites in the streaming decoder — both bounded:
  `c: u8 → c as usize ∈ 0..=255` indexed into `[u8; 256]`, and `dest_idx
  < calc_size_for_slice(source).unwrap()` proven by caller invariant.

## Notable patterns

1. **Typed `unsafe trait Atom` + `unsafe_impl_atom!` macro**
   (`atomic_cell.rs:194-365`): the size/no-padding obligation for
   `AtomicCell<T>` is discharged once at the trait impl, with a compile-time
   `const _ assert!` for size and a doc-required no-padding promise. Pointer
   types route through `AtomicPtr` so provenance is preserved. This is the
   `Zeroable`/`bytemuck` discipline applied to atomics — exemplary.

2. **`bun_core_macros` derive output uses `addr_of!` projection** (no
   `&Self` formed) at every `unsafe fn rc_*(this: *const Self)` —
   `&*::core::ptr::addr_of!((*this).#field)` — explicitly because callers
   may hold a live `&mut` on a sibling field (Stacked Borrows compatible by
   construction). See `bun_core_macros/lib.rs:319-352`.

3. **`bun_opaque::opaque_ffi!`** materializes the Nomicon-canonical opaque
   handle: `UnsafeCell<[u8; 0]>` (Freeze-disable), `PhantomData<*mut u8>`
   (`!Send + !Sync` default), `PhantomPinned` (address identity), `[u8; 0]`
   (no `dereferenceable(N)` obligation). This is the textbook fix for the
   `&T as *const T as *mut T` UB pattern that plagued earlier FFI ports.

4. **`bun_core::heap` discipline** — paired `into_raw` / `take` / `destroy`
   names plus a `release` (= `Box::leak`) form whose doc *requires* the call
   site to name the owner that will reclaim. This is the named-vocabulary
   layer that prior-audit "no UAFs/double-frees" stated as a working
   discipline — re-confirmed.

5. **`ThreadCell<T>`** (`atomic_cell.rs:494-595`) — a debug-checked
   `RacyCell` replacement that converts the unchecked "thread-confined"
   comment into a runtime-checked `claim()`/`assert_owner()` invariant.
   Release builds compile the latch away. Both `Sync` and `Send` impls have
   matching SAFETY documentation.

## Open questions

1. The `bun_core::env_var` typed-cache (env_var.rs:339-660) deserves a
   Phase-2 publication audit, but the current source is stronger than a plain
   Relaxed first-init cache. The string cache writes `ptr_value` with Relaxed
   and then publishes `len_value` with Release; readers load `len_value` with
   Acquire before loading `ptr_value` and forming the `&[u8]`. That establishes
   a happens-before edge for the pointer store when the reader observes the
   published length. The remaining questions are narrower: no read path should
   bypass the len Acquire, duplicate racing writers must publish identical
   envp-backed pointer/len pairs, and process environment mutation after
   publication remains outside the contract stated at the top of the file.
2. `bun_ptr::ref_count` SeqCst could be relaxed to Release/Acquire/(Relaxed
   on fastpath count==1 check) per stdlib `Arc`. **Not UB**, but a
   performance polish opportunity. Out-of-scope for Phase 1.
3. Two `bun_core::lib.rs:211-212` `unsafe impl Send/Sync for RawSlice<T:
   Sync>` lack a SAFETY: comment naming the invariant — they rely on bound
   inference (`&T: Send + Sync` rules). Defensible (the bound *is* the
   proof), but the workspace standard elsewhere is to spell it out. Phase
   2 cosmetic candidate.
4. The `bun_core::util.rs` argv/environ ops use Relaxed atomics with
   "single-threaded startup only" doc comments. Workspace-wide there is
   no enforcement that they are *only* called at startup — a defensive
   `debug_assert!(!THREAD_SPAWNED.load(Acquire))` guard would convert the
   informal contract into a runtime check. Phase 2 hardening candidate.
