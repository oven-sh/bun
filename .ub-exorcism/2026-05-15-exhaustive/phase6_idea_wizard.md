# Phase 6 — Idea Wizard

Project: Bun (Rust port of a JavaScript runtime, ~200-crate Cargo workspace
with C++/JSC bridge, vendored libuv/BoringSSL/lol-html/mimalloc, custom
arenas, intrusive lists, lock-free queues, N-API, FFI, plugin re-entry).

Mode: clever, non-obvious UB-detection techniques **specifically suited to
Bun's shape**. Generated 30, winnowed to 5, then expanded by 10 more.

Anchored to the 10 project-shape priors handed off by Phase 4
synthesizer (`bun_core::heap` chokepoint, `bun_ptr::detach_lifetime*`
168-occurrence cluster, `bun_libuv_sys::assert_size!` gold standard,
`uSockets RawPtrHandler<T>` two-mode adapter, `bun_ast::Ref` 64-bit packed,
`bun_threading::Channel<T, B>` generic-B-without-Send-bound,
`unsafe impl Linked` macro stamps, CLAUDE.md arena gotcha, 23-of-26 EXP-012
propagation, JS-thread-affinity 4-layer chain).

---

## 30 raw ideas

1. **`from_field_ptr!` two-mode lint** — proc-macro that emits an explicit
   `BorrowMode::{Mut, Raw}` token per call site; refuse to compile bare
   `&mut Parent` form without per-site `// SAFETY: re-entry impossible
   because …`.
2. **`detach_lifetime{,_ref,_mut}` paired-consumer enforcement** — pair
   every `detach_lifetime_ref(&'a X) -> &'static X` with a `'a`-bound
   consumer captured by a `lifetime!{ 'a => closure }` macro; the closure
   gets the `'static` view but is itself bound to `'a`.
3. **`#[bun_callback]` proc-macro** — synthesizes `ThisPtr` + `ref_guard`
   bracket + raw-place projection automatically, so the 26 EXP-012 sites
   collapse to one macro and the 3 remaining callback holes (EXP-026, EXP-044, F-21-2)
   become compile-error if they bypass it.
4. **`JsThreadAffine` marker trait** — sealed marker that compile-error
   rejects `spawn(move || captures JsThreadAffine)` (4-layer chain: VM →
   JsCell → WebWorker `Cell<*mut>` → BackRef `get_mut`).
5. **`#[layout_locked]` derive** — per-`#[repr(C)]` POD: emit `const _: ()
   = assert!(size_of::<T>() == EXPECTED, "ABI drift")` for **every field
   offset** crossed by FFI; CI build script reflects from C headers and
   regenerates. Propagates `bun_libuv_sys::assert_size!` discipline to
   NAPI/Win32/BoringSSL.
6. **Arena-drop `BumpDrop<T>` wrapper** — wraps any `T: Drop` allocated in
   `AstAlloc`, registers a destructor list with the arena, runs them on
   reset. Closes EXP-016 by type-system check rather than enumeration.
7. **`#[repr(transparent)] Ref(NonZeroU64)` with `normalize()` accessor**
   — compile-error-forbids `.hash()` on unnormalized form (F-L12-1).
   `normalize()` masks user bits before any Hash/Eq computation.
8. **`LockfileArrayElem` unsafe trait + per-impl validity audit** — `T:
   LockfileArrayElem` bound on `Buffers::read_array<T>`; impls hand-audit
   every variant of every `enum`/`bool`/`char`/Validity-bearing field
   reachable from disk. Closes EXP-036 + future variants.
9. **`unsafe trait Atom` style for `Pollable`/`UvHandle`/`Send-able
   FFI-handle`** — propagate the `bun_core::ffi::Zeroable` gold pattern
   (audited trait gates `mem::zeroed::<T>`) to every "this `*const T` is
   safe to materialise as `&T`" claim. Bucket-10 fix-point.
10. **`bun_core::heap` chokepoint enforcement** — clippy-style
   workspace-wide lint forbidding `Box::leak`, `Vec::leak`, `Box::into_raw`
   outside `bun_core::heap::*`. Cleans F-L-11 (9-site Box::leak cluster)
   and prevents drift.
11. **Tagged-pointer trait fix-point** — `pub trait TaggedPtr {
    fn pack(self) -> NonNull<()>; unsafe fn unpack(p: NonNull<()>) ->
    Self }` implemented for each tag-bit shape; the representation carries
    typed pointer provenance plus separate tag metadata. A
    `ptr::with_exposed_provenance` recovery can be an interim annotation, but
    it does not close the strict-provenance gate. Centralises Cluster D
    (16 sites).
12. **Loom + Shuttle "callback re-entry torture"** — synthesised harness
    that for every `from_field_ptr!` callsite (95 of them) drives the
    callback under interleaving search; assert no `&mut Parent` reborrow
    overlaps a sibling. Bucket-1 cluster-wide fuzz oracle.
13. **`miri_panic_safety` proc-macro** — every `unsafe fn` that does
    `ptr::read` + later `mem::forget` is rewritten by the macro to wrap
    the body in `catch_unwind`; double-drop on panic surfaces as a Miri
    leak instead of a silent UB. Closes EXP-039 + EXP-040 family.
14. **`#[const_validate(repr_u32)]` enum derive** — at every `transmute::<
    u32, E>()`/`read_unaligned::<E>()` call site, the derive auto-inserts
    `bytemuck::CheckedBitPattern::is_valid_bit_pattern`. Closes EXP-002,
    EXP-035, EXP-051 with one mechanical pass; EXP-037 is now a regression
    guard because current Windows watcher source already uses a checked match.
15. **`SerdeFromDisk` poison-byte witness** — synthetic Miri fuzzer that
    flips each byte of every on-disk structure read by `read_array` /
    `read_unaligned` through every 256 values; promote EXP-003/006/036
    family to a regression matrix that covers **all** disk-driven fields.
16. **`unsafe impl Linked` stamp linter** — every `impl_streaming_writer_
    parent!` invocation requires `re_entry_mode = (Allowed | Forbidden)`;
    `Allowed` sites must use raw `*mut Parent` mode. Generalises Section
    P's `RawPtrHandler<T>` to the entire intrusive-callback family.
17. **`Bound<T: Send + Sync>` generic safety** — replace every confirmed
    unbounded `unsafe impl<T> Send for X<T>` with a generic with the right
    bound; compile-time witness via `static_assertions::assert_impl_all!`
    smoke-test. Closes EXP-019, EXP-045, EXP-046; EXP-047 joins only as
    optional hardening after the safe-boundary correction.
18. **`MutexGuard<'static>`-launder API neutering** — `bun_alloc::Mutex::
    new()` becomes `pub const unsafe fn new() -> Self` and is callable only
    in `static` initialisers. Stops EXP-059 latent hazard at type level.
19. **`StringOrTinyString` representation swap** — replace `usize::from_le_bytes`
    pointer reconstruction with `Box<[u8]>` thin pointer + length sentinel;
    EXP-049 disappears at the representation layer.
19b. **`SmolStr` representation swap** — replace packed-`u128`
    pointer-bit storage with a typed heap-pointer representation; EXP-096
    disappears at the representation layer.
20. **`Volatile-is-not-Atomic` lint** — clippy-style: any `write_volatile`
    followed by a `SeqCst fence` in the same function is flagged unless
    annotated `// volatile-is-not-atomic: justified because <reason>`.
    Closes EXP-017.
21. **Re-entrant-VM tripwire** — `VirtualMachine` carries a debug-only
    `re_entry_count: Cell<u32>`; every `&mut VirtualMachine` (or path that
    forms one, like `repl::vm_mut`, `Scanner::resolve_dir_for_test`,
    `bv2_mut`) bumps it on entry and traps if > 1. Closes EXP-026, EXP-042,
    EXP-043, EXP-044 family with one debug assertion.
22. **JS-thread fingerprint** — every JS-thread-affine type carries a
    debug-only `thread_id: ThreadId` field initialised at construction;
    every `&mut Self`/`&Self` method asserts `thread_id == current()`.
    Backs `JsThreadAffine` trait with runtime witness; cheap in release.
23. **N-API addon under loom** — model the N-API surface (`ThreadSafe
    Function`, `napi_call_threadsafe_function`, `napi_release_*`,
    `napi_threadsafe_finalize`) under loom with 4 producer threads + JS
    thread; replaces EXP-060 TBD with a concrete model harness.
24. **`UnsafeCell` exposed-deref discipline** — every `pub struct Foo`
    that contains `UnsafeCell` and exposes any `&self` method that
    deep-deref-touches the cell must implement a sealed `ProvenanceProof`
    trait (compile-time witness). Hardens F-A-10 `HTMLBundle::Route` and
    F-CLEAN-LinkerGraph patterns into the type system.
25. **`#[cfg(feature = "lockfile_unsound")]` killswitch** — feature flag
    that swaps `Buffers::read_array<T>` for a `serde_bincode`-style typed
    deserialiser; under the killswitch, every lockfile read is bounds-and-
    validity-checked. CI matrix runs full install suite under killswitch.
26. **Cross-target `cfg(...)` UB sweeper** — every `#[cfg(target_arch =
    "...")]` block runs through `cargo check --target {linux, macos,
    win} × {x64, aarch64}` and a static-asserts collector emits one
    summary. Closes F-P-14 (libuv `reserved[0]` fn-pointer-as-usize
    breaks on CHERI/wasm32/mismatched ptr-width).
27. **Stacked-Borrows ledger** — every `unsafe { &mut *p }` reborrow in
    the workspace gets a deterministic SB-stack snapshot logged to a JSON
    artifact via a `#[bun_reborrow]` macro; Miri runs reconcile the log
    with the SB stack to catch silent unobserved retags.
28. **`#[track_caller]` cross-thread `*mut` ownership map** — every `Send`
    of a raw pointer captures `caller_location()` + `ThreadId` of sender
    and receiver; a global debug-only map detects "two threads hold the
    same `*mut T`" anomalies. Cheap, catches Send-Sync drift at runtime.
29. **Signal-handler async-signal-safety static analyzer** — walk every
    transitively reachable function from `signal_handler` and reject any
    call to non-AS-safe APIs (`malloc`, `Mutex::lock`, `Display`, …).
    Promotes EXP-013 (9 of 14 audited steps / at least 8 operation
    classes) from comment-TODO to compile-time wall.
30. **`#[plugin_safe]` proc-macro** — every `Bun.serve` / bundler plugin
    callback is registered with a `pre/post` hook that snapshots the
    caller's `&mut`-borrow stack; on plugin re-entry, panic if any
    snapshot is still live. Closes EXP-044 (plugin re-entry mints two
    `&mut BundleV2`) by structural means.

---

## Winnow to top 5

Criteria: (a) hits Bun-shape priors directly, (b) closes multiple Phase 4
findings at once, (c) novel (no equivalent EXP exists yet), (d) feasible
inside a Cargo workspace with existing tools (Miri, loom, ast-grep),
(e) mechanical/structural fix rather than per-site whack-a-mole.

- **W1 = Idea 3** — `#[bun_callback]` proc-macro that synthesises
  EXP-012 fix-model. Targets the **largest** known mechanical fix-point
  (95 `from_field_ptr!` sites + 26 callback consumers). Already 23/26
  applied; the macro raises that to 26/26 by construction.
- **W2 = Idea 4** — `JsThreadAffine` marker trait. Hits the 4-layer
  JS-thread-affinity chain (VM → JsCell → WebWorker → BackRef) which is
  the **deepest** Bun-specific safety lie. Type-system fix.
- **W3 = Idea 5** — `#[layout_locked]` derive + C-side build-script
  reflector. Propagates `bun_libuv_sys::assert_size!` gold standard to
  NAPI / Win32 / BoringSSL (F-10-2/4/5 cluster, 63 unasserted structs).
- **W4 = Idea 14** — `#[const_validate(repr_u32)]` enum derive. Closes
  the **disk-driven enum** family with one mechanical pass: EXP-002,
  EXP-035, EXP-036, EXP-051 are sibling shapes. EXP-037 stays as a
  regression guard because current Windows watcher source already checks
  the raw action code before constructing the enum.
- **W5 = Idea 21** — Re-entrant-VM tripwire (`re_entry_count: Cell<u32>`
  debug field). Closes EXP-026, EXP-042, EXP-043, EXP-044 with one debug
  assertion — catches the entire `&T → &mut T` forgery family at runtime.

---

## Expand by 10 more

Filling under-covered surfaces from the 30 raw ideas, biased toward
Bun-shape features that don't yet have an EXP entry:

- **E1 = Idea 6** — `BumpDrop<T>` arena-drop wrapper. CLAUDE.md gotcha
  finally typed. After the EXP-016 follow-up, this is preventive hardening:
  current source is leak-only / NO_EVIDENCE for UB, but the wrapper prevents
  future soundness-critical `Drop` payloads from entering `AstAlloc` silently.
- **E2 = Idea 7** — `Ref(NonZeroU64)` `normalize()` accessor with
  compile-error-on-unmasked-hash. Closes F-L12-1.
- **E3 = Idea 10** — `bun_core::heap` chokepoint workspace lint. Closes
  F-L-11 (9-site Box::leak cluster).
- **E4 = Idea 11** — `TaggedPtr` trait fix-point with
  `with_exposed_provenance` macro. Cluster D (16 sites).
- **E5 = Idea 12** — Loom + Shuttle callback re-entry torture harness
  for 95-site `from_field_ptr!` enumeration. Bucket-1 cluster-wide
  dynamic oracle.
- **E6 = Idea 16** — `impl_streaming_writer_parent!` re-entry-mode
  annotation linter. Generalises Section P `RawPtrHandler<T>` macro.
- **E7 = Idea 17** — `Bound<T: Send + Sync>` workspace static-assertions
  smoke-test for every `unsafe impl<T> Send/Sync`.
- **E8 = Idea 20** — `Volatile-is-not-Atomic` lint. Closes EXP-017 by
  structural check.
- **E9 = Idea 23** — N-API loom + shuttle model. Replaces EXP-060 TBD
  reproducer with a concrete harness.
- **E10 = Idea 29** — Signal-handler AS-safety static analyzer.
  Promotes EXP-013 from comment-TODO to compile-time wall.

---

## Final 15 → operationalization table

(Bun anchors are `file:line` against current workspace; verified via
`rg`/`ast-grep`.)

| # | Technique | Bun anchor | EXP-NNN status |
|---|-----------|------------|----------------|
| W1 | `#[bun_callback]` proc-macro synthesising `ThisPtr + ref_guard + raw-place projection` | `src/ptr/lib.rs:518-546` (`ThisPtr` def); 95 `from_field_ptr!` sites workspace-wide; 60 `ref_guard` sites; `src/io/PipeWriter.rs:2623-2670` (`impl_streaming_writer_parent!`); 3 open EXP holes (EXP-026, EXP-044, F-21-2) | **NEW EXP-061** |
| W2 | `JsThreadAffine` sealed marker trait + compile-error on `spawn` capture | `src/jsc/VirtualMachine.rs:611-612` (foundational lie); `src/jsc/JSCell.rs:126-128`; `src/jsc/web_worker.rs:127-128, 246-326`; `src/ptr/lib.rs:627-628` (`BackRef::get_mut(&self) -> &mut T`); ~92 `thread_local!` site count | **NEW EXP-062** |
| W3 | `#[layout_locked]` derive + C-reflector build-script for NAPI/Win32/BoringSSL | `src/runtime/napi/napi_body.rs:512, 524, 536, 1985, 2032` (EXP-054); `src/windows_sys/externs.rs` (48 structs, 4 asserts); `src/boringssl_sys/boringssl.rs` (15 structs, 0 asserts); gold standard at `src/libuv_sys/libuv.rs:257-276, :395-396` | **NEW EXP-063** (subsumes EXP-054 + F-10-4/5) |
| W4 | `#[const_validate]` enum derive + `bytemuck::CheckedBitPattern` auto-insert | `src/errno/linux_errno.rs:192` (EXP-002); `src/install/lockfile/Package/Meta.rs:39-46` (EXP-003); `src/install/lib.rs:1128-1135` (EXP-006); `src/standalone_graph/StandaloneModuleGraph.rs:230-246` (EXP-035); `src/install/lockfile/bun.lockb.rs:590` (EXP-036); `packages/bun-native-plugin-rs/src/lib.rs:637` (EXP-051); `src/bundler/linker_context/scanImportsAndExports.rs:1682` (PropertyIdTag). EXP-037 is already resolved by `WindowsWatcher.rs:196-211` checked match. | **NEW EXP-064** |
| W5 | Re-entrant-VM tripwire (`re_entry_count: Cell<u32>` debug field) | `src/jsc/VirtualMachine.rs:611-612`; `src/runtime/cli/repl.rs:94-101` (EXP-042); `src/runtime/cli/test/Scanner.rs:255-265, 365` (EXP-043); `src/runtime/api/JSBundler.rs:1387-1405` (EXP-044); `src/runtime/timer/mod.rs:897, 1016` (EXP-026); `src/runtime/jsc_hooks.rs:152-157` | **NEW EXP-065** |
| E1 | `BumpDrop<T: Drop>` arena-drop wrapper | `src/ast/new_store.rs` (`Vec<T, AstAlloc>` consumers); `src/ast/g.rs:27, 83, 142, 149` (`AstAlloc::vec()`); `src/ast/nodes.rs:521`; ~190 `MimallocArena` references | Hardens **EXP-016**; **NEW EXP-066** for the type-system check |
| E2 | `Ref(NonZeroU64)::normalize()` with compile-error-on-unnormalised-hash | `src/ast/lib.rs:398-410` (F-L12-1) | **NEW EXP-067** |
| E3 | `bun_core::heap` chokepoint workspace lint (forbid `Box::leak` outside heap mod) | `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:322`; `src/sys/windows/env.rs:72, 92`; `src/runtime/api/bun/Terminal.rs:1847`; `src/runtime/node/node_fs.rs:2416, 2458`; `src/jsc/PluginRunner.rs:160, 177`; `src/bundler/HTMLScanner.rs:73` (F-L-11 9-site cluster) | **NEW EXP-068** |
| E4 | `TaggedPtr` trait + `with_exposed_provenance` macro fix-point | `src/ptr/tagged_pointer.rs:53-64` (centralised); covers EXP-048 / F-P-4 and true `TaggedPtrUnion` callers. Related packed-pointer rows still need per-site migration. | Already covered by **EXP-048**; new entry would duplicate |
| E5 | Loom + Shuttle 95-site `from_field_ptr!` re-entry torture harness | 95 invocations workspace-wide (Cluster A enumeration); densest at `src/runtime/dispatch.rs:794, 799, 823, 828`; `src/bundler/ParseTask.rs:354, 362` | **NEW EXP-069** |
| E6 | `impl_streaming_writer_parent!` re-entry-mode annotation linter | `src/io/PipeWriter.rs:2623-2670` (macro def); `src/uws_sys/vtable.rs:237-244`; `src/uws_sys/WebSocket.rs:248-255`; F-21-9 `RawPtrHandler<T>` escape hatch | **NEW EXP-070** |
| E7 | `Bound<T: Send + Sync>` workspace `assert_impl_all!` smoke-test | `src/ast/nodes.rs:339-340` (EXP-019); `src/jsc/JSCell.rs:126-128` (EXP-045); `src/jsc/WorkTask.rs:58` (EXP-046); optional hardening for `src/bun_core/atomic_cell.rs:503-504` (EXP-047 ThreadCell) and `src/bun_core/util.rs:2276-2277` (EXP-047 RacyCell); `src/runtime/dns_jsc/dns.rs:104-107`; `src/bundler/BundleThread.rs:170-173` | Already covered by **EXP-019 / EXP-045 / EXP-046**, with EXP-047 hardening optional — no new entry |
| E8 | `Volatile-is-not-Atomic` clippy lint | `src/io/lib.rs:1164-1169` (store), `:870, :1020` (read) (EXP-017) | Already covered by **EXP-017**; lint is a remediation vehicle (Phase 8/11) |
| E9 | N-API loom + shuttle TSFN model | `src/runtime/napi/napi_body.rs:2461-2870`; `:2378, 2437, 2485` finalizers (F-21-1, F-21-4) | Already covered by **EXP-060** — the TBD reproducer is the loom/shuttle harness itself |
| E10 | Signal-handler async-signal-safety static analyzer | `src/crash_handler/lib.rs:588, 1320-1450, 1801, 1737` (EXP-013) | Already covered by **EXP-013** as a remediation vehicle, but a **NEW EXP-071** is warranted for the *static analyzer* as an experiment in its own right (turns the source-callgraph claim into a file:line reachability artifact) |

---

## Summary of net-new EXP entries

| EXP-ID | One-liner |
|--------|-----------|
| EXP-061 | `#[bun_callback]` proc-macro — single-vehicle EXP-012 propagation closing the 3 remaining holes (EXP-026, EXP-044, F-21-2) |
| EXP-062 | `JsThreadAffine` sealed marker trait — 4-layer JS-thread-affinity chain compile-error fix |
| EXP-063 | `#[layout_locked]` derive + C-reflector build-script — propagate `bun_libuv_sys` gold standard to NAPI/Win32/BoringSSL |
| EXP-064 | `#[const_validate]` enum derive auto-inserting `CheckedBitPattern` — closes 8-site disk-driven enum family with one mechanical pass |
| EXP-065 | Re-entrant-VM tripwire (`Cell<u32>` debug field) — catches `&T → &mut T` forgery family at runtime |
| EXP-066 | `BumpDrop<T: Drop>` arena-drop wrapper — types the CLAUDE.md arena gotcha |
| EXP-067 | `Ref(NonZeroU64)::normalize()` with compile-error-on-unnormalised-hash — closes F-L12-1 correctness drift |
| EXP-068 | `bun_core::heap` chokepoint workspace lint — forbids `Box::leak` outside `heap::*`, closes F-L-11 9-site cluster |
| EXP-069 | Loom + Shuttle 95-site `from_field_ptr!` re-entry torture harness — cluster-wide dynamic oracle |
| EXP-070 | `impl_streaming_writer_parent!` re-entry-mode annotation linter — generalises Section P RawPtrHandler<T> escape hatch |
| EXP-071 | Signal-handler async-signal-safety static analyzer — promotes EXP-013 non-AS-safe callgraph claim from comment-TODO to checkable artifact |

E4/E7/E8/E9 cite the existing EXP-048/EXP-019+045+046+047/EXP-017/EXP-060 entries respectively and are **not** duplicated.

---

## Constraints honoured

- No source edits to Bun (read-only UB-exorcist audit mode; remediation is Phase 8 territory)
- No sub-subagents
- No Miri / cargo invocations (Phase 5's job)
- File:line anchors verified by `rg`/grep against current tree
- Historical note: at the time this Phase-6 idea pass was written, the registry
  max was EXP-060 and the 11 proposed IDs were unused. Later Codex/Claude
  passes expanded the registry to EXP-095 with gaps; use
  `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` for current numbering.
- Time budget: under 30 min
