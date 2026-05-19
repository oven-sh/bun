# Phase 8 Remediation Plan — Run `2026-05-15-exhaustive`

Architect deliverable. For every CONFIRMED_UB and CONFIRMED panic-safety
finding from `phase4_unified_findings.md` + the Phase 5 registry, this
file enumerates ≥2 isomorphic rewrites, scores them on the 5-axis rubric
defined in `references/REMEDIATION-PATTERNS.md`, picks a winner, and
records runners-up for future maintainers.

**Scoring rubric (per axis, 0–4; max total 20):**
Correctness margin · Performance delta · Diff blast radius · Reviewability · Maintainability.

**Constraints applied (per `phase0_run.json`):**
- Read-only on source.
- No GitHub push without explicit per-action authorization.
- No PRs opened or beads committed by this phase.
- High-stakes findings (custom allocators, lock-free DS, FFI public API) flagged for `/multi-model-triangulation` before merge.

---

## STRUCTURAL FIXES (priority cluster)

These thirteen high-leverage rewrites each close multiple Phase 4 findings.
They should be sequenced **before** per-EXP remediations because most
per-EXP work then degenerates to a one-line follow-up.

### S1. PR #30765 batch — three already-drafted soundness fixes
**Status:** unmerged PR on the `claude/unsafe-exorcist-demo` branch (verified `gh pr view 30765` 2026-05-16).
**Scope:** `src/threading/guarded.rs:132-134`, `src/ast/nodes.rs:339-340`, `src/errno/linux_errno.rs:192`.
**Blast radius — closes when landed:**
- **EXP-002** (CONFIRMED_UB) Linux errno transmute → checked path
- **EXP-018** (CONFIRMED_UB, safe API / OS-contract) `GuardedLock` `_not_send` marker
- **EXP-019** (CONFIRMED_UB) `StoreSlice<T>` Send/Sync bounds
- **F-S-1 / F-A-8 / EXP-045** (`JsCell<T>`) — now independently Miri-confirmed; same-shape one-line follow-up after template lands
**Action recommended:** request maintainer review + merge of PR #30765, then file the four-line `JsCell<T>` follow-up immediately (or fold it into the same maintainer-requested batch). Triangulation already complete for the three PR fixes; EXP-045 has a fresh standalone Miri data-race log.

### S2. `TaggedPtr::get` / `TaggedPtr::to` centralised provenance fix
**Scope:** `src/ptr/tagged_pointer.rs:53-64` (two helpers).
**Blast radius — closes / hardens:**
- **EXP-048** (`DEFERRED`, strict-provenance fix-point — release-gate decision)
- **F-A-1** Sink.rs:1232 (the lone `.as_uintptr()` consumer)
- **F-P-4 / F-P-7 / F-P-8 / F-P-9 / F-P-10 / F-P-11 / F-P-12** — every TaggedPointer-shaped tag-bit pack-and-mask site in Cluster D
- Hot path **F-P-10** (`ServerWebSocket.rs:144`) is the dominant beneficiary
**Does NOT close:** EXP-049 (`StringOrTinyString` byte-buffer pointer), EXP-050 (ZigString — JSC ABI cross-boundary), or EXP-096 (`SmolStr` packed pointer bits).
See [R-EXP-048](#r-exp-048) below for the rewrite-pair scoring.

### S3. `from_field_ptr!` macro mode `&mut → *mut` (95-site cluster)
**Scope:** `src/bun_core/lib.rs:699-863` (macro definition); 13 raw-enumerated `&mut Parent` call sites in Cluster A, 9 still-risky after the dispatch io_poll source-audit demotion.
**Mechanism:** force the macro to **always** return `*mut Parent`; require every call site to opt in to `&mut *raw_parent` reborrow with a per-site SAFETY comment.
**Blast radius — closes (substantially) or hardens:**
- Remaining F-A-2 sites that still materialise `&mut Parent`. EXP-028 is now `NO_EVIDENCE`: the TODO-marked `DirectoryWatchStore` file is a stale Phase-A draft, while canonical `dev_server::DirectoryWatchStore` already uses raw parent recovery.
- **F-A-2** (95-site cluster; 9 still-risky sites flip to raw, 4 dispatch sites harden but are no longer counted as likely aliasing UB)
- Remaining F-A-2 risky `from_field_ptr!` sites where source audit shows a live parent/child overlap.
- Bundler worker-thread parent recovery sites that still materialise `&mut Parent` instead of staying raw.
**Diff radius:** small (one macro arm + ≤13 SAFETY comments). Reviewability is high because the diff is mechanical.

### S4. EXP-012 fix-model propagation (callback-running receiver cleanup)
**Scope:** `src/runtime/timer/mod.rs:897, 1016`; `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`; `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238,1432-1445`; `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; `src/http/ProxyTunnel.rs:707-775`; `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; `src/jsc/rare_data.rs:864-891`; `src/jsc/event_loop.rs:455-507`; `src/runtime/api/bun/h2_frame_parser.rs:1850-1981`.
**Mechanism:** flip `&mut self` receivers → `this: *mut Self`; install `ThisPtr` + `ref_guard` RAII bracket where re-entry is possible. Direct port of the **already-shipped** EXP-012 exemplar (`WebSocketUpgradeClient::cancel`, RESOLVED — see exemplar in F-CLEAN-Resolver and EXP-012 entry).
**Blast radius — closes:**
- **EXP-026** (CONFIRMED_UB; timer::All re-entry)
- **EXP-044** (CONFIRMED_UB; bundle_v2 self.bv2 reborrow)
- **EXP-099** (CONFIRMED_UB; node-cluster singleton `flush(&mut self)` re-entry)
- **EXP-100** (CONFIRMED_UB; UpgradedDuplex / SSLWrapper re-entry)
- **EXP-101/102/103** (CONFIRMED_UB; stale ProxyTunnel receiver wrappers)
- **EXP-104** (CONFIRMED_UB; WindowsNamedPipe `WRAPPER_BUSY` receiver-protector gap)
- **EXP-106** (CONFIRMED_UB; PipeWriter parent-callback writer re-entry)
- **EXP-107** (CONFIRMED_UB; RareData watcher-close callback re-entry)
- **EXP-108** (CONFIRMED_UB; EventLoop JS callback re-entry)
- **EXP-110** (CONFIRMED_UB; h2 Stream write-callback re-entry)
- **F-21-2** (WindowsNamedPipe streaming-writer `borrow = mut` → `borrow = ptr` hardening sibling)

### S5. POSIX `Name` → owned `IteratorResult` migration (Section P → Section D template)
**Scope:** `src/sys/lib.rs:154-159, 183-192, 207-221, 322, 391, 513, 804-808` (POSIX dir_iterator parser and safe accessors).
**Mechanism:** migrate POSIX parser to the Section D owned-result template (`IteratorResult { name: PathString, kind }`) instead of `Name { ptr, len }` lifetime-erased borrow.
**Blast radius — closes:**
- **F-DR-10 / EXP-081** (CONFIRMED_UB) POSIX `Name` safe lifetime-erased dangling-slice API
- 6 Section P consumers (`glob`, `shell::builtin::{ls,rm}`, `publish_command`, `walker_skippable`, `path_watcher`) hardened with **no consumer-side change**
**Does NOT close:** **EXP-027** Windows cousin (separate fix; Windows uses `RawSlice<u16>`).

### S6. `Buffers::read_array<LockfileArrayElem>` bound (Section L)
**Scope:** `src/install/lockfile/Buffers.rs:104-178`.
**Mechanism:** introduce `unsafe trait LockfileArrayElem: Copy` with hand-audited per-T impls; require `T: LockfileArrayElem` on `read_array`.
**Blast radius — closes:**
- **EXP-036** (CONFIRMED_UB; `read_array::<PatchedDep>` bool validity)
- Hardens any future `T` with `bool` / `char` / `enum` payload (auditor wall)
**Does NOT close** (per Section L Phase-1 correction): EXP-003, EXP-005, EXP-006, EXP-007 — those land at `Package::load_fields` typed-column memcpy / yarn uninit slice / `Tree.rs:1020` unchecked index respectively. See R-EXP-003, R-EXP-005, R-EXP-006, R-EXP-007 for those.

### S7. Windows webcore file I/O event-loop pointer normalization
**Scope:** `src/runtime/webcore/blob/copy_file.rs:1005, 1300, 1580, 1666`.
**Mechanism:** change `CopyFileWindows.event_loop` from `&'a EventLoop` to `*mut EventLoop`, matching sibling `WriteFileWindows`.
**Blast radius — closes:**
- **EXP-073** (CONFIRMED_UB) `&EventLoop` → `*mut EventLoop` → `enter_scope()` mutation.
**Why structural:** the project already has the isomorphic fix in `WriteFileWindows`; this is a representation mismatch, not a new architecture. Read-only uses can still materialize short-lived `&EventLoop` from the raw pointer, but mutation must not originate from a shared reference.

### S8. Timer parent/timer provenance normalization
**Scope:** `src/runtime/timer/timer_object_internals.rs:106-131, 856-869, 970-1021`.
**Mechanism:** stop deriving mutable `EventLoopTimer` writes from `&TimerObjectInternals`. Either carry raw parent/timer provenance for the mutable timer-state path, or make `EventLoopTimer.state` explicit interior mutability (`Cell<EventLoopTimerState>`) if the API must remain `&self`.
**Blast radius — closes:**
- **EXP-074** (CONFIRMED_UB) `parent_ptr(&self) -> from_ref(self).cast_mut()` followed by a write to plain `EventLoopTimer.state`.
**Why structural:** this is the same noalias-remediation family as the timer `run` / `fire` `*mut Self` conversion already documented in-source. The current comment says writes must go through `Cell`/`UnsafeCell`; the code should either honor that statement or use raw mutable provenance for the state write.

### S9. DevServer deferred-request backref provenance normalization
**Scope:** `src/runtime/bake/DevServer.rs:2115, 3021`.
**Mechanism:** when `try_define_deferred_request(&mut self, ...)` stores the `DeferredRequest.dev` backref, use mutable provenance (`std::ptr::from_mut(self)` or `NonNull::from(self)`) rather than first weakening `self` through `std::ptr::from_ref(self)`.
**Blast radius — closes:**
- **EXP-075** (CONFIRMED_UB) deferred request stores a shared-provenance `*const DevServer` then later mutates `deferred_request_pool` through `dev.cast_mut()`.
**Why structural:** this is the smallest possible fix: the later pool mutation is semantically intended, and the constructor already has `&mut self`. The bug is only the origin pointer. Do not rewrite pool ownership until a larger bake-server refactor demands it.

### S10. `bun_dispatch::link_interface!` handle-field privatization
**Scope:** `src/dispatch/lib.rs:302-318` (macro output) plus any call sites that directly construct or inspect generated handle fields.
**Mechanism:** make generated `kind` and `owner` fields private; keep `unsafe fn new(kind, owner)` as the only general constructor; optionally add `pub fn kind(&self)` and `pub unsafe fn from_raw_parts_unchecked(...)` for rare low-level callers.
**Blast radius — closes:**
- **EXP-080** (CONFIRMED_UB) safe code can forge a dispatch handle with an invalid owner and call safe methods.
- Hardens `DevServerHandle`, `VmLoaderCtx`, `OutputSink`, `Pollable`, `SystemThread`, crash-handler dispatch handles, and every future `link_interface!` use.
**Why structural:** the macro documentation already says `unsafe fn new()` is the invariant-establishing boundary. Public fields contradict that boundary. This fix makes the code match its own safety model without changing dispatch performance or ABI.

### S11. Split JS-thread-affine `Blob` wrapper from cross-thread blob payload
**Scope:** `src/jsc/webcore_types.rs:60-96, 220-231`; `src/runtime/webcore/Blob.rs:1509,1557,1869,1911`.
**Mechanism:** stop making the JS-thread wrapper itself `Send + Sync`. Move only a data-only `BlobPayload` / `SendBlobData` across workers and registries; keep `global_this: Cell<*const JSGlobalObject>` behind a JS-thread-affine wrapper whose safe methods cannot be called from arbitrary threads. If a short-term compatibility shim is needed, make `global_this` access unsafe/raw-pointer-only and debug-assert the owning JS thread.
**Blast radius — closes:**
- **F-S-11 / EXP-082** (CONFIRMED_UB generic safe-API contract) `Blob: Send + Sync` plus safe `global_this(&self) -> Option<&JSGlobalObject>`
- Hardens every Blob worker / ObjectURLRegistry path by forcing cross-thread code to carry only data it may legally inspect.
**Does NOT claim:** a proven production off-thread `Blob::global_this()` call. EXP-082 proves the safe public contract is unsound; caller reachability remains a separate exploitability classification.
**Why structural:** this matches the design intent already written in the SAFETY comment: workers may move blob bytes and refcounted storage, but JSC globals must only be dereferenced on their owning JS thread. The type system should encode that split.

### S12. Make shell IO handles non-`Sync` or event-loop-serialized
**Scope:** `src/runtime/shell/IOWriter.rs:237-252, 969-985`; `src/runtime/shell/IOReader.rs:72-100, 220-268`.
**Mechanism:** remove `Sync` from `IOWriter` / `IOReader` by adding a non-Sync marker, or replace direct cross-thread access with an event-loop task handle. Safe `&self` mutators over `UnsafeCell<State>` must not be callable through `Arc<T>: Sync`.
**Blast radius — closes:**
- **F-S-12 / EXP-083** (CONFIRMED_UB generic safe-API contract) safe concurrent `IOWriter::enqueue(&self)` / `IOReader::*(&self)` state mutation.
**Does NOT claim:** that current shell code intentionally spawns threads calling these methods today. The confirmed defect is that the type advertises `Sync` while exposing unsynchronized safe mutators.
**Why structural:** the files already state "shell is single-threaded." The type should encode that claim instead of relying on every future caller to remember it.

### S13. Remove the safe off-thread `VirtualMachine::as_mut()` trap
**Scope:** `src/jsc/VirtualMachine.rs:604-688`.
**Mechanism:** stop combining cross-thread shareability with safe unchecked TLS mutation. Preferred structural fix: make `VirtualMachine` JS-thread-affine (`!Send + !Sync`) and pass narrow raw/event-loop task handles across threads instead of `&VirtualMachine`. Short-term compatible fix: keep any required `Sync` assertion, but change `as_mut()` / `get_mut()` to return `Option` or panic in release when the current thread has no VM, and move the existing `unwrap_unchecked` path behind an `unsafe fn`.
**Blast radius — closes:**
- **F-S-14 / EXP-084** (CONFIRMED_UB generic safe-API contract) safe captured `&VirtualMachine` can call `as_mut()` on a non-VM thread and hit `unwrap_unchecked(None)`; direct safe `VirtualMachine::get_mut()` on a non-VM thread reaches the same unchecked TLS precondition.
**Does NOT claim:** a proven production worker currently captures `&VirtualMachine` and calls `as_mut()` off-thread. EXP-084 proves the safe API boundary is unsound under exactly the auto-trait contract Bun publishes.
**Why structural:** this is the root JS-thread-affinity type. The auto-trait boundary should prevent invalid cross-thread captures, and the safe mutation accessor must not encode a caller-controlled TLS precondition as unchecked UB.

---

## Per-finding remediations (CONFIRMED_UB + CONFIRMED panic-safety)

Cited EXP-IDs throughout. Each block ends with cross-references to the
EXP that proved the original UB and the experiment that should prove
the remediation sound.

---

### R-EXP-001: `linear_fifo::assume_init_slice<T>` exposes uninit slots

**Finding:** EXP-001, MUST-BE-UB → CONFIRMED_UB, `src/collections/linear_fifo.rs:62-80, 115-118, 127-172`.
**Shape:** Shape 7 (`MaybeUninit::assume_init` over partially-filled buffer).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Track init-len explicitly; rename helper to `assume_init_prefix(len) -> &[T]`; keep inner storage as `MaybeUninit`; only return the prefix that callers wrote | 4 | 4 (neutral) | 3 | 4 | 4 | **19** |
| B | Replace backing `Box<[MaybeUninit<T>]>` with `VecDeque<T>` | 4 | 2 (one extra heap alloc + copy on resize) | 2 (rewrite all 9 internal call sites) | 4 | 4 | 16 |
| C | Keep API; add `T: Copy` bound (forbids niche-bearing T) + `#[track_caller]` debug assert | 2 (still UB if `T = bool`/enum reaches it via generic) | 4 | 4 | 3 | 2 (regresses on first non-Copy reuse) | 15 |

**Winner:** **A — explicit init-len tracking with renamed helper.**
**Rationale:** Shape-7 default per playbook. Closes the MUST-BE-UB primitive while leaving the hot consumers (`bun_test`, `valkey ValkeyCommand`, `http callback pair`) untouched at the call-site level — they already track `len`/`head`/`tail` and just need the helper renamed.
**Runners-up:** B is correct but pays a perf tax that bun_test can't afford. C is a band-aid that breaks the moment a future generic instantiation passes a niche type.
**Proves-original-UB:** EXP-001 (CONFIRMED_UB, Phase 3 strict-provenance trace).
**Proves-new-soundness:** new EXP-001-fix — re-run the EXP-001 reproducer against the renamed helper; expect Miri-clean.

---

### R-EXP-002: `linux_errno::impl GetErrno for usize` transmute

**Finding:** EXP-002, MUST-BE-UB → CONFIRMED_UB, `src/errno/linux_errno.rs:192`.
**Shape:** Shape 6 variant (`transmute` of integer → enum where value range is partial).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Route through the sibling `SystemErrno::init` checked path that already exists in the file (the proposed PR #30765 fix) | 4 | 4 (one branch on a hot syscall path; negligible) | 4 (one-line) | 4 | 4 | **20** |
| B | Use `bytemuck::CheckedBitPattern::try_from_bytes` derive on `SystemErrno`; return `Option` | 4 | 3 (slightly more codegen than the hand-written check) | 3 (touches `SystemErrno` declaration) | 3 | 4 | 17 |
| C | Replace `SystemErrno` enum with `#[repr(transparent)] struct SystemErrno(NonZeroI32)` and accessor methods | 4 | 4 | 1 (touches every consumer) | 3 | 4 | 16 |

**Winner:** **A — checked path (PR #30765).**
**Rationale:** The fix is already drafted, reviewed by the author, and waiting on maintainer merge. Diff radius is one line. Routed through structural fix S1 (see above).
**Runners-up:** B and C are both correct but introduce churn the project doesn't need.
**Proves-original-UB:** EXP-002 (CONFIRMED_UB, Phase 3 enum-tag witness `0x0086`) plus `phase5_experiment_results/EXP-002-bun-errno-crate.log`, a direct source-linked harness that reports the invalid enum tag at `/data/projects/bun/src/errno/linux_errno.rs:192`.
**Proves-new-soundness:** re-run EXP-002 reproducer against the patched code; expect the checked-path branch to return `Err`.

---

### R-EXP-003 / R-EXP-006: `Meta::has_install_script` / `Meta::origin` enum from disk (PUB-INSTALL-1, -2)

**Finding:** EXP-003 + EXP-006, MUST-BE-UB → CONFIRMED_UB, `src/install/lockfile/Package/Meta.rs:39-46` + `src/install/lib.rs:1128-1135`.
**Shape:** Shape 6 (`transmute` from disk bytes into validity-bearing `#[repr(u8)]` enums; 3/256 valid for has_install_script, 3/256 for origin).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Wrap the enums in `#[repr(transparent)] struct Foo(u8)` + `try_from()` returning `Result<Foo, LockfileCorrupt>`; `Package::load_fields` validates each typed column on read | 4 | 4 (one validity check per row at load) | 3 (touches the load path + enum decls) | 4 | 4 | **19** |
| B | `bytemuck::CheckedBitPattern` derive on the enums; `cast_slice_box` returns `Result` | 4 | 3 | 3 | 3 | 4 | 17 |
| C | Layer the validation **outside** the typed-column memcpy: keep enums as bytes in memory, validate at consumer-read | 3 (pushes validity to consumers; easy to skip) | 4 | 2 (touches every consumer) | 2 | 3 | 14 |

**Winner:** **A — `#[repr(transparent)] struct + try_from at Package::load_fields`.**
**Rationale:** UB lands at the `Meta::has_install_script` / `Meta::origin` field-read site, not at `Buffers::read_array`. Section L's correction explicitly says S6 doesn't close these. The fix needs to be at the field-read layer.
**Runners-up:** B is mechanically equivalent but adds a bytemuck dependency (already in tree, but per-byte CheckedBitPattern is less ergonomic for two-discriminant enums than a hand-written newtype). C is unsafe by deferral.
**Proves-original-UB:** EXP-003 (`enum value has invalid tag: 0x2a`) and EXP-006 (`invalid enum tag 0x2a`).
**Proves-new-soundness:** new EXP-003-fix and EXP-006-fix — feed tampered lockfile bytes through the patched `load_fields`; expect `Err(LockfileCorrupt)`.

---

### R-EXP-004: `Vec<u8>→Vec<u16>` allocator-layout mismatch on dealloc

**Finding:** EXP-004, MUST-BE-UB → CONFIRMED_UB, `src/runtime/webcore/encoding.rs:303-310`.
**Shape:** Shape 6 (type-pun via `transmute` over `Vec` representation, allocator-layout-dependent).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Allocate a fresh `Vec<u16>` with the right capacity and copy bytes in via `chunks_exact(2).map(u16::from_ne_bytes)` | 4 | 3 (one extra alloc + copy; negligible for small encoded strings) | 3 | 4 | 4 | **18** |
| B | Use `bytemuck::cast_vec` (compile-time safe under `Pod` + matching size) | 4 | 4 | 4 | 4 | 4 | **20** if bytemuck supports the case |
| C | Use `unsafe { Vec::from_raw_parts(ptr.cast::<u16>(), len/2, cap/2) }` with `mem::forget(old)` and a manual `Layout::array::<u16>` dealloc impl | 3 (still nearly as fragile, just explicit) | 4 | 1 | 2 | 1 | 11 |

**Winner candidate-by-candidate verification:** bytemuck does **not** support `cast_vec` between sizes (alignment + capacity invariants); the safe variant is `cast_slice` + collect, which collapses to A. So the practical winner is **A — explicit copy via `chunks_exact(2).map(u16::from_ne_bytes).collect()`.**
**Rationale:** The allocator-layout-mismatch UB is structural (Rust's allocator API requires matched `Layout` for dealloc; `Vec`'s capacity carries the original element size). Only fully redoing the allocation makes this sound.
**Runners-up:** C is the existing pattern with a manual dealloc — still UB-prone if anyone clones or grows the result.
**Proves-original-UB:** EXP-004 (`symbolic-alignment-check` allocator-layout mismatch).
**Proves-new-soundness:** new EXP-004-fix — Miri the allocate-and-copy variant; expect zero allocator complaint.

---

### R-EXP-091: `BindgenArray` cross-layout `Vec` reuse

**Finding:** EXP-091, MUST-BE-UB safe generic API shape → CONFIRMED_UB, `src/jsc/bindgen.rs:235-353`.
**Shape:** Bucket 20 allocator-layout pairing + Bucket 11 safe API contract.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Always allocate fresh converted `Vec<ZigType>` for the non-`SAME_REPR` path | 4 | 2 | 3 | 5 | 5 | **19** |
| B | Reuse storage only when the eventual `Vec<ZigType>` layout matches the original allocation layout; otherwise allocate fresh | 4 | 4 | 4 | 5 | 4 | **21** |
| C | Keep the current `USE_MIMALLOC` / "mi_free ignores layout" justification | 0 | 5 | 5 | 1 | 1 | 12 |

**Winner:** **B — layout-equal reuse only, fresh allocation for every layout-different conversion.**
**Rationale:** The current branch already requires exact size+align equality for `SAME_REPR`; the post-conversion branch relaxed alignment and relies on the `bindgen.rs:10-18` mimalloc-layout comment. Rust's `Vec::from_raw_parts` contract does not allow that shortcut: deallocation must use the same layout the allocation used even if the current allocator implementation ignores some layout fields. The exact contract is layout equality, not necessarily element-size equality: reuse is sound only when `align_of::<ZigType>() == align_of::<ExternType>()` and `size_of::<ZigType>() * new_capacity == size_of::<ExternType>() * old_capacity` (or when a raw-allocation wrapper preserves the original layout for deallocation). B preserves valid layout-equal fast paths and makes all other conversions structurally sound.
**Proves-original-UB:** EXP-091 Miri witness (`phase5_experiment_results/EXP-091.log`) rejects `Vec<Zig>` drop over storage allocated as `Vec<Extern>` with the same size but different alignment.
**Proves-new-soundness:** new EXP-091-fix — rerun the witness after adding the allocation-layout gate/fresh-allocation fallback; expect no deallocation-layout mismatch.

---

### R-EXP-092: `ReadResult::to_stream` owned-slice tokenization

**Finding:** EXP-092, MUST-BE-UB safe API shape → CONFIRMED_UB, `src/runtime/webcore/streams.rs:2533-2597`.
**Shape:** Bucket 20 allocator ownership/pairing + Bucket 11 safe API contract.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Make `ReadResult::Read` carry an enum that distinguishes `Borrowed(RawSlice<u8>)` from `Owned(Vec<u8>)`; `to_stream` moves owned Vecs and never infers ownership from pointer inequality | 4 | 4 | 3 | 5 | 5 | **21** |
| B | Keep raw slice payload but make `to_stream` unsafe with a documented "default-allocator, cap==len" precondition | 2 | 5 | 4 | 2 | 2 | 15 |
| C | Always copy disjoint slices into a fresh Vec | 4 | 2 | 4 | 5 | 4 | 19 |

**Winner:** **A — explicit owned-token vs borrowed-slice representation.**
**Rationale:** Pointer inequality from `buf` is not an ownership proof. A preserves the zero-copy owned path when the producer really has a `Vec<u8>`/`Box<[u8]>`, keeps borrowed slices cheap, and removes the safe-API footgun where safe Rust can pass stack or foreign memory and get a `Vec` back.
**Proves-original-UB:** EXP-092 Miri witness (`phase5_experiment_results/EXP-092.log`) rejects dropping the returned Vec because it deallocates stack memory through the Rust heap allocator.
**Proves-new-soundness:** new EXP-092-fix — rerun the witness after the representation split; safe code should no longer be able to construct the owned branch from a raw borrowed slice.

---

### R-EXP-088: `E::String::init_utf16` / `slice16` narrowed UTF-16 range

**Finding:** EXP-088, MUST-BE-UB safe constructor/accessor shape → CONFIRMED_UB, `src/ast/e.rs:1449-1459, 1413-1424`; callers at `src/js_parser/lexer.rs:2751-2752`, `src/parsers/json_lexer.rs:575-581`, `src/parsers/yaml.rs:1782-1785`.
**Shape:** Bucket 3 (alignment/provenance) + Bucket 15 (safe accessor lifetime/range contract) + Bucket 11 (unsafe library contract exposed through a safe constructor).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Store a typed UTF-16 representation (`Utf16Bytes { ptr: NonNull<u16>, len_u16 }` or equivalent arena-backed slice) and make `slice16()` return from typed provenance | 4 | 4 | 2 | 3 | 4 | **17** |
| B | Keep `Str` as the byte carrier, but store the full byte length (`2 * len_u16`) plus an explicit UTF-16 element count used by `slice16()` | 4 | 4 | 3 | 4 | 3 | **18** |
| C | Keep the current narrowed byte slice and document that callers must never call `slice16()` after `init_utf16` | 0 | 4 | 5 | 1 | 1 | 11 |

**Winner:** **B as the first Bun-sized patch; A as the maintainable endpoint if the AST string representation can absorb a typed variant.**
**Rationale:** The bug is not just alignment-by-chance. `init_utf16(&[u16])` stores a `Str` that covers only `len_u16` bytes, then `slice16()` retags `2 * len_u16` bytes. B fixes the current representation with a constrained diff and makes the byte/unit length distinction explicit. A is cleaner because typed UTF-16 provenance cannot be narrowed accidentally, but it likely touches more parser/AST storage code.
**Runners-up:** A should be preferred if maintainers are already changing `EString` layout. C is the current defect and is not a sound option.
**Proves-original-UB:** EXP-088 symbolic-alignment/provenance witness (`phase5_experiment_results/EXP-088.log`) mirrors `init_utf16` + `slice16`; Miri rejects the re-expanded retag at byte offset 2 because the stored shared tag only covered `[0x0..0x2]`. `phase5_experiment_results/EXP-088-bun-ast-crate.log` repeats the failure through the real `bun_ast::E::String::init_utf16` / `slice16()` pair and points at `/data/projects/bun/src/ast/e.rs:1424`.
**Proves-new-soundness:** new EXP-088-fix — construct an `E::String` from a two-code-unit UTF-16 slice and call `slice16()` under `MIRIFLAGS="-Zmiri-symbolic-alignment-check"`; expect no retag/provenance error and the full two-element slice to round-trip.
**Reachability note:** the source-shaped callers in JS, JSON, and YAML lexers call `E::String::init_utf16` with aligned UTF-16 data. The defect is the representation's narrowed range, not hostile unaligned input.

---

### R-EXP-093: `bun_exe_format::pe` unaligned header parsing

**Finding:** EXP-093, MUST-BE-UB under hostile/tampered PE bytes → CONFIRMED_UB, `src/exe_format/pe.rs:203-220, 281-302, 315-334, 389-396, 900-920`.
**Shape:** Bucket 3 (alignment) + Bucket 10 (typed raw pointer/slice construction) + Bucket 11 (hostile-byte safe parser contract).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Parse PE headers by value with `ptr::read_unaligned` / `ptr::write_unaligned` and keep section headers as copied values for iteration | 4 | 3 | 3 | 4 | 4 | **18** |
| B | Keep typed references/slices but reject any offset that is not `align_of::<T>()`-aligned before constructing `&T` / `&[T]` | 3 | 4 | 4 | 3 | 2 | 16 |
| C | Mark header structs `#[repr(C, packed)]` and use `addr_of!` for every field access | 3 | 3 | 2 | 2 | 2 | 12 |

**Winner:** **A — unaligned parse/write helpers.**
**Rationale:** The source already says Zig used `*align(1) const T`; the Rust-equivalent representation is byte parsing or unaligned value loads, not typed references into `Vec<u8>` storage. B is a cheap emergency fix if maintainers want to reject malformed PE files, but it preserves a brittle invariant and may reject odd-but-otherwise-parseable files. C risks E0793 footguns across every field access and makes future maintenance worse.
**Proves-original-UB:** EXP-093 Miri witness (`phase5_experiment_results/EXP-093.log`) rejects `slice::from_raw_parts(ptr.cast::<SectionHeader>(), 1)` for an odd section-header offset. The direct Bun-crate witness (`phase5_experiment_results/EXP-093-bun-exe-format-crate.log`) calls real `PEFile::init(&data)` and fails at `/data/projects/bun/src/exe_format/pe.rs:317` while materialising `&DOSHeader` from byte-backed `Vec<u8>` storage.
**Proves-new-soundness:** new EXP-093-fix — rerun the witness against helper-level code that reads the same bytes via `read_unaligned` / byte-copy parsing; expect no reference-alignment error. Add a regression test with odd `e_lfanew` / section-header offset if Bun chooses to accept such files, or an explicit validation test if Bun chooses to reject them.

---

### R-EXP-095: `bun_exe_format::macho` unaligned load-command mutation

**Finding:** EXP-095, MUST-BE-UB over byte-backed Mach-O command storage → CONFIRMED_UB, `src/exe_format/macho.rs:121-130, 361-403`; good-helper contract at `src/exe_format/macho_types.rs:1-12`.
**Shape:** Bucket 3 (alignment) + Bucket 10 (typed raw pointer/slice construction) + Bucket 11 (byte-backed object-file editing contract).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Mutate load commands by value: `read_unaligned` into a local, update fields, `write_unaligned` back; iterate section arrays element-by-element with unaligned reads/writes | 4 | 4 | 3 | 4 | 4 | **19** |
| B | Copy section/load-command arrays into aligned temporary structs, mutate, then serialize back with `write_unaligned` | 4 | 3 | 3 | 4 | 4 | 18 |
| C | Keep typed `&mut T` / `&mut [T]`, but require and validate alignment of `self.data` plus every command/section offset before constructing references | 3 | 4 | 2 | 2 | 2 | 13 |

**Winner:** **A — unaligned value loads/writes.**
**Rationale:** `LoadCommand::cast<T>()` is already the local good pattern because it returns an owned `T` via `read_unaligned`; the mutation path should use the same representation instead of typed references over `Vec<u8>` / `&[u8]` storage. A is also isomorphic to the adjacent `macho.rs:163-170` code, which already writes `segment_command_64` with `ptr::write_unaligned` and explicitly cites Zig `*align(1)`.
**Proves-original-UB:** EXP-095 Miri witness (`phase5_experiment_results/EXP-095.log`) rejects `&mut *cmd_ptr.cast::<SymtabCommand>()` for byte-backed unaligned command storage. The direct Bun-crate witness (`phase5_experiment_results/EXP-095-bun-exe-format-crate.log`) calls real `MachoFile::write_section` and fails at `/data/projects/bun/src/exe_format/macho.rs:122` while materialising `&mut [section_64]` over the byte-backed load-command region.
**Proves-new-soundness:** new EXP-095-fix — rerun the witness against helper-level code that performs the same field updates through `read_unaligned` / `write_unaligned`; expect no reference-alignment error. Add a source regression test that parses/mutates a Mach-O image supplied from a deliberately offset byte slice if Bun chooses to accept such inputs, or an explicit alignment-rejection test if maintainers choose C.

---

### R-EXP-005 / R-EXP-034: `&mut [T]` over uninitialized `Vec` capacity

**Finding:** EXP-005 + EXP-034, MUST-BE-UB → CONFIRMED_UB, `src/install/yarn.rs:918-925, 1401-1402` + `src/install/migration.rs:1492-1493`.
**Shape:** Shape 7 (`MaybeUninit` slice exposed before init complete).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | `vec![Dependency::default(); n]` zero-init then mutate; or `Vec::with_capacity(n) + extend(iter)` | 4 | 3 (one extra default-init pass for `n` items) | 4 | 4 | 4 | **19** |
| B | Switch to `Vec::spare_capacity_mut() -> &mut [MaybeUninit<T>]` + `MaybeUninit::write` per element + `set_len(n)` after; never expose as `&mut [T]` | 4 | 4 | 3 | 3 | 4 | 18 |
| C | Use the F-CLEAN-uds-best-pattern reference from `src/runtime/socket/udp_socket.rs:1207-1212` (`vec![…; len]` with explicit SAFETY comment naming the EXP-005 hazard) | 4 | 3 | 4 | 4 | 4 | **19** |

**Winner:** **A or C (tie at 19) — `vec![default(); n]` zero-init.**
**Rationale:** A + C are the same pattern; the udp_socket comment (C) is the project-canonical anti-EXP-005 pattern and should be cited from the SAFETY comment.
**Runners-up:** B is the right escape hatch when `T: !Default` or when zero-init is genuinely too expensive — but `Dependency` and the migration cursor types are cheap defaults.
**Proves-original-UB:** EXP-005 (`Uninitialized memory occurred at alloc211[0x0..0x4]`); EXP-034 (Phase 5 Miri trace).
**Proves-new-soundness:** new EXP-005-fix and EXP-034-fix — re-run reproducers; expect zero uninit-read.

---

### R-EXP-089: primitive scratch buffers constructed with `MaybeUninit::uninit().assume_init()`

**Finding:** EXP-089, MUST-BE-UB → CONFIRMED_UB, `src/bun_core/util.rs:997-1003, 1045-1050`; `src/install/lockfile/Tree.rs:87-91`.
**Shape:** Bucket 5 (uninitialized memory) + Bucket 4 (initialized-value validity) + Bucket 11 (safe API contract). Construction of the returned primitive-array value is UB.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Revert the three `uninit()` helpers to zero-initialized arrays (`ZEROED` / `[0; N]`) | 4 | 2 (restores the documented memset cost) | 4 | 5 | 4 | **19** |
| B | Change scratch-buffer representation to `MaybeUninit<[T; N]>` / `[MaybeUninit<T>; N]`, with raw write pointers and initialized-prefix accessors only | 4 | 4 | 2 | 3 | 5 | **18** |
| C | Keep returning uninitialized `[u8; N]` / `[u16; N]` / `[u32; N]` and rely on write-before-read discipline | 0 | 4 | 5 | 1 | 1 | 11 |

**Winner:** **A as the emergency correctness patch; B as the performance-preserving follow-up.**
**Rationale:** The existing helpers are safe functions used as broad scratch-buffer constructors. Miri rejects construction itself, so there is no caller-discipline argument that can save the current API. A is the smallest patch and should be landed immediately if maintainers want a one-review fix. B preserves the Zig "undefined scratch" performance model but needs more call-site reshaping; `src/sys/lib.rs` `AlignedBuf(MaybeUninit<[u8; BUF_SIZE]>)` is the local template.
**Runners-up:** B is the long-term best representation once call sites can absorb explicit initialized-prefix APIs. C is the invalid current state.
**Proves-original-UB:** EXP-089 Miri witness (`phase5_experiment_results/EXP-089.log`) rejects `PathBuffer([u8; N])` construction at `assume_init()`: `encountered uninitialized memory, but expected an integer`. `phase5_experiment_results/EXP-089-bun-core-crate.log` repeats the failure through the real `bun_core::PathBuffer::uninit()` API and points to `/data/projects/bun/src/bun_core/util.rs:1003`.
**Proves-new-soundness:** new EXP-089-fix — if A lands, run the same witness with zero-initialized constructors and expect no invalid-value error. If B lands, a trybuild test should prove safe code cannot obtain `&[T]` / `[T; N]` over uninitialized slots; a Miri test should expose only initialized prefixes.
**Reachability note:** `PathBuffer::uninit()` and `WPathBuffer::uninit()` are broad utilities; `depth_buf_uninit()` is used by lockfile tree iteration. This is stronger than a future-misuse contract: the constructors themselves execute UB.

---

### R-EXP-007: `Tree.rs::get_unchecked` over attacker-controlled dependency ID

**Finding:** EXP-007, MUST-BE-UB → CONFIRMED_UB (standalone mirror; integration witness still useful), `src/install/lockfile/Tree.rs:1020`.
**Shape:** Shape 8 (pointer / index arithmetic that exceeds the original allocation).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace `get_unchecked(dep_id)` with `get(dep_id).ok_or(LockfileCorrupt::DepIdOutOfRange(dep_id))?` | 4 | 3 (one bounds check on a hot tree-walk path) | 4 | 4 | 4 | **19** |
| B | Validate every `dep_id` at lockfile load time, then `get_unchecked` is sound by invariant | 4 (only if validation is exhaustive) | 4 | 2 (must touch load path) | 3 | 3 (validation can drift from consumer reads) | 16 |
| C | `debug_assert!(dep_id < deps.len())` + `get_unchecked` | 1 (release builds strip the assert; this is the current shape!) | 4 | 4 | 3 | 1 | 13 |

**Winner:** **A — checked `get` returning Result.**
**Rationale:** Hostile lockfile is the threat model. Per-bounds-check overhead is dwarfed by the disk read that produced the dep_id.
**Runners-up:** B is the "earn back the perf via global invariant" play; correct but harder to audit, easier to drift.
**Proves-original-UB:** EXP-007 (`get_unchecked` with hostile dep_id; Miri reports ``assume` called with `false``).
**Proves-new-soundness:** new EXP-007-fix — same reproducer should error cleanly.

---

### R-EXP-008 / R-EXP-009: `bun_semver::String::slice` / `eql` packed `(off, len)` get_unchecked OOB

**Finding:** EXP-008 + EXP-009, MUST-BE-UB → CONFIRMED_UB (release), `src/semver/lib.rs:613` + `:536-537`.
**Shape:** Shape 8 (pointer arithmetic exceeding allocation; debug-assert stripped in release).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace `get_unchecked(off..off+len)` with `get(off..off+len).ok_or(SemverParseError::SliceOutOfRange)?`; promote `slice`/`eql` return types to `Result` (or `Option`) | 4 | 3 (one bounds check per access) | 3 (touches return types of two functions + every caller) | 4 | 4 | 18 |
| B | Add `bun_core::debug_assertions_or_release_check!` macro that keeps the bounds check in release builds for safety-critical paths; preserve current API | 4 | 3 | 4 | 3 | 4 | **18** |
| C | Migrate the packed `(off, len)` representation to a `&str` slice carrying its own bounds + lifetime; recompute on demand | 4 | 4 (slightly faster — fewer indirections) | 1 (rewrites bun_semver storage) | 3 | 4 | 16 |

**Winner:** **A — checked `slice` returning `Result`.**
**Rationale:** B preserves the API but introduces a project-novel macro that future maintainers won't recognize. Tie-breaker: bun_semver's caller surface is small enough that propagating `Result` is mechanical.
**Runners-up:** B is the right escape hatch if PR review pushes back on the API shape change. C is the larger representation redesign, but it is not required to eliminate the current UB.
**Proves-original-UB:** EXP-008/009 (`get_offset_len_noubcheck` OOB in release).
**Proves-new-soundness:** new EXP-008-fix — feed packed `(off, len)` with `off+len > buf.len()`; expect `Err`.

---

### R-EXP-073: `CopyFileWindows.event_loop: &EventLoop` mutated through `enter_scope`

**Finding:** EXP-073, MUST-BE-UB → CONFIRMED_UB, `src/runtime/webcore/blob/copy_file.rs:1005, 1300, 1580, 1666`.
**Shape:** Shape 1/14 (`&T` → `*mut T` → mutation over non-`UnsafeCell` fields).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Store `event_loop: *mut EventLoop` in `CopyFileWindows`, exactly matching `WriteFileWindows`; call `EventLoop::enter_scope(self.event_loop)` | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Keep `&EventLoop`, but change `entered_event_loop_count` and every field touched by `enter()` / `exit()` to interior mutability (`Cell` / `UnsafeCell`) | 3 | 4 | 1 | 2 | 2 | 12 |
| C | Keep `&EventLoop` and reacquire `event_loop_mut()` from the VM at completion time | 2 | 4 | 2 | 2 | 2 | 12 |

**Winner:** **A — raw pointer field, matching `WriteFileWindows`.**
**Rationale:** `VirtualMachine::event_loop()` already documents the right model: raw pointer, short-lived mutable reborrow at the use site. `CopyFileWindows` is an async heap object and already pins/unpins the loop through `ref_concurrently`; storing a raw VM-owned event-loop backref is the representation used by sibling Windows file I/O. No semantic behavior changes.
**Runners-up:** B makes this one mutation legal by broadening core `EventLoop` interior mutability, which is too much blast radius. C risks minting a second `&mut EventLoop` during completion rather than removing the shared-reference origin.
**Proves-original-UB:** EXP-073 default Miri (`SharedReadOnly` → `SharedReadWrite` retag failure) and Tree-Borrows (`write access ... forbidden`).
**Proves-new-soundness:** new EXP-073-fix — same reproducer with `event_loop: *mut EventLoop`; default Miri and Tree-Borrows should both pass.

---

### R-EXP-074: `TimerObjectInternals::parent_ptr(&self)` writes `EventLoopTimer.state`

**Finding:** EXP-074, MUST-BE-UB → CONFIRMED_UB, `src/runtime/timer/timer_object_internals.rs:106-131, 856-869, 970-1021`.
**Shape:** Shape 1/14 (`&T` → `*mut T` → mutation over non-`UnsafeCell` field) with callback/re-entry constraints.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Change mutable timer-state accessors to operate from raw parent/timer provenance (`*mut TimerObjectInternals` / `*mut EventLoopTimer`) and keep read-only helpers on `&self` | 4 | 4 | 3 | 4 | 4 | **19** |
| B | Make `EventLoopTimer.state` a `Cell<EventLoopTimerState>` and update all reads/writes through `get`/`set` | 4 | 4 | 2 | 3 | 3 | 16 |
| C | Keep current shape and rely on single-JS-thread discipline | 0 | 4 | 4 | 1 | 0 | 9 |

**Winner:** **A — raw mutable provenance for mutable state writes.**
**Rationale:** Timer internals already converted re-entrant callback paths to `*mut Self` specifically to avoid noalias. Extending that discipline to `EventLoopTimer.state` is smaller and more semantically honest than making the whole timer state cell-like. Read-only methods can stay `&self`; write methods must not start from `ptr::from_ref`.
**Runners-up:** B is acceptable if maintainers prefer `&self` APIs everywhere, but it widens interior mutability across the timer heap. C is Miri-rejected.
**Proves-original-UB:** EXP-074 default Miri (`SharedReadOnly`-derived write) and Tree-Borrows (`Frozen` tag write).
**Proves-new-soundness:** new EXP-074-fix — same reproducer with raw parent/timer provenance or `Cell<EventLoopTimerState>`; default Miri and Tree-Borrows should both pass.

---

### R-EXP-075: `DevServer` deferred-request backref writes through `std::ptr::from_ref(self)`

**Finding:** EXP-075, MUST-BE-UB → CONFIRMED_UB, `src/runtime/bake/DevServer.rs:2115, 3021`.
**Shape:** Shape 1/14 (`&T`-origin raw pointer stored for later mutation).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Store mutable provenance at construction: `dev: std::ptr::from_mut(self)` or `NonNull::from(self)`; keep the later pool mutation unchanged | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Store `&'a mut DevServer` in `DeferredRequest<'a>` and thread a lifetime through the deferred-request pool | 4 | 4 | 1 | 2 | 2 | 13 |
| C | Make `deferred_request_pool` interior-mutable and keep `std::ptr::from_ref(self)` | 3 | 4 | 2 | 2 | 2 | 13 |

**Winner:** **A — preserve mutable provenance at the existing backref point.**
**Rationale:** `try_define_deferred_request` already has `&mut self`, so the sound pointer exists at the exact construction site. Changing the stored pointer origin is isomorphic: no pool semantics, scheduling, or drop order changes. B is type-theoretically tidy but infects the pool and async/request lifecycle with a lifetime that the current design intentionally erases. C broadens interior mutability to hide a one-token provenance bug.
**Proves-original-UB:** EXP-075 default Miri (`SharedReadOnly`-derived write) and Tree-Borrows (`Frozen` tag write).
**Proves-new-soundness:** new EXP-075-fix — same reproducer with `std::ptr::from_mut(self)` / `NonNull::from(self)`; default Miri and Tree-Borrows should both pass.

---

### R-EXP-010: Bundler parallel-callback `&mut LinkerContext` 5-site cluster

**Finding:** EXP-010, MUST-BE-UB → CONFIRMED_UB (TB model), `src/bundler/LinkerContext.rs:1657-1663` + B-1..B-5 cluster.
**Shape:** Bucket 1 (aliasing) — multiple `&mut LinkerContext` from worker callbacks; **also** Bucket 7 race surface (loom prep).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Apply S4 (EXP-012 fix-model): worker-callback receivers become `this: *mut LinkerContext`; per-callback SAFETY comment names the disjoint-write column set (mirror the F-CLEAN-LinkerGraph 96-line SAFETY block) | 4 | 4 | 3 (5 callback shapes touched) | 4 | 4 | **19** |
| B | Move the 5 callbacks into `crossbeam::scope` blocks that take `&LinkerContext` and use `Cell<…>` / atomic columns for the per-chunk writes | 4 | 3 (atomic ops on hot bundler path; benchmark needed) | 2 (rewrites scheduling) | 3 | 4 | 16 |
| C | Wrap `LinkerContext` columns in `UnsafeCell` per the existing F-DR-12 `CompileResultSlots(Box<[UnsafeCell]>)` pattern; receivers become `&LinkerContext` | 3 (UnsafeCell still allows aliasing UB if two callbacks touch the same cell) | 4 | 2 | 3 | 3 | 15 |

**Winner:** **A — EXP-012 fix-model propagation (rolls into S4 cluster).**
**Rationale:** The `*mut Self` + per-callback disjoint-column SAFETY pattern is already the project canonical (LinkerGraph is the gold-standard). The B-1..B-5 cluster is a mechanical port.
**Runners-up:** B is more "Rusty" but pays a perf tax that bundler benchmarks would catch immediately. C trusts UnsafeCell to do work it can't do.
**Proves-original-UB:** EXP-010 (Tree-Borrows model trace, Phase 5 log).
**Proves-new-soundness:** future EXP-010-fix harness — port the TB model with `*mut Self` receivers; expect TB-clean.
**Triangulation:** **recommended** (`/multi-model-triangulation` over the parallel scheduling shape; bundler is hot).

---

### R-EXP-011: picohttp NUL-write through `SharedReadOnly` provenance

**Finding:** EXP-011, MUST-BE-UB → CONFIRMED_UB (TB), `src/picohttp/lib.rs:383`.
**Shape:** Bucket 2 (provenance) — write through pointer derived from `&[u8]` request buffer.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Take `&mut [u8]` at the picohttp boundary; the FFI declaration becomes `extern "C" fn picohttpparser_parse(buf: *mut u8, ...)` | 4 | 4 | 3 (touches FFI sig + 1 caller) | 4 | 4 | **19** |
| B | Copy the request buffer into an owned `Vec<u8>` before parsing | 4 | 1 (extra alloc + copy on every request — unacceptable for a hot HTTP path) | 4 | 4 | 4 | 17 |
| C | Forge `*mut u8` via `UnsafeCell<[u8]>` wrapper at the buffer-allocation site | 3 (still requires Tree-Borrows reasoning to justify the write) | 4 | 2 | 2 | 3 | 14 |

**Winner:** **A — `&mut [u8]` at the FFI boundary.**
**Rationale:** picohttp wants to write a NUL terminator; the buffer's owner already permits this. Just declare the mutability at the type system level.
**Runners-up:** B is correct but adds avoidable allocation/copy latency on a hot HTTP path. C papers over the issue without removing it.
**Proves-original-UB:** EXP-011 (Tree-Borrows model + ASM-verified NUL write through SharedReadOnly).
**Proves-new-soundness:** new EXP-011-fix — same TB model with `&mut [u8]` parameter; expect TB-clean.

---

### R-EXP-014: `multi_array_list::Slice<T>: Copy` allows overlapping `ColMut` views

**Finding:** EXP-014, MUST-BE-UB → CONFIRMED_UB, `src/collections/multi_array_list.rs:540-568`.
**Shape:** Bucket 1 (aliasing) — `Copy` impl is project-local trait drift.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Remove `Copy + Clone` from `Slice<T>`; convert call sites that cloned into explicit `.reborrow()` / `.split_mut()` chains | 4 | 4 | 3 (4 consumer files) | 4 | 4 | **19** |
| B | Replace `split_mut` with a typed `Disjoint::<Col1, Col2>` newtype that statically forbids two `ColMut` over the same column | 4 | 4 | 1 (rewrites the API) | 3 | 4 | 16 |
| C | Add a runtime debug assertion that no two `ColMut` overlap; release builds trust the caller | 1 (release strips the assert) | 4 | 4 | 2 | 1 | 12 |

**Winner:** **A — drop `Copy`.**
**Rationale:** The TODO in the source already names this as the right fix. Diff is mechanical.
**Runners-up:** B is the long-term "type-state machine" answer (Shape 19); good follow-up after A lands.
**Proves-original-UB:** EXP-014 (Tree-Borrows model trace).
**Proves-new-soundness:** new EXP-014-fix — re-run TB model with non-Copy Slice; the second `ColMut` won't compile.

---

### R-EXP-094: `bun_core::deprecated::DoublyLinkedList<T>` intrusive list loses Stacked-Borrows tags

**Finding:** EXP-094, MUST-BE-UB → CONFIRMED_UB, `src/bun_core/deprecated.rs:114-410`.
**Shape:** Bucket 1 (aliasing) + Bucket 15 (intrusive raw-pointer lifetime escape).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Delete `DoublyLinkedList<T>` after verifying no production callers remain; keep or rewrite the test to cover the replacement if needed | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Replace with `intrusive-collections` adapter and pinned node handles | 4 | 4 | 2 | 3 | 4 | 17 |
| C | Redesign as list-owned `Box<DoublyLinkedNode<T>>` storage so callers do not keep/re-mint `&mut node` while the list stores raw links | 4 | 3 | 2 | 3 | 3 | 15 |
| D | Keep raw pointers but require all operations to take raw `NonNull<DoublyLinkedNode<T>>` only, with no `&mut node` API | 3 | 4 | 3 | 2 | 2 | 14 |

**Winner:** **A — delete if unused.**
**Rationale:** The file is already named `deprecated.rs`, and the strongest evidence is an in-tree Miri failure in the type's own unit test. If production call sites exist, B is the cleanest sound intrusive-list design; C is the cleanest ownership redesign. D is smaller but still leaves the burden on callers.
**Proves-original-UB:** EXP-094 path-b full-workspace Miri log (`phase11_artifacts/miri-leaf/cargo_miri_workspace_sp_nofailfast.log`) reports a stale borrow-stack tag in `basic_doubly_linked_list_test`.
**Proves-new-soundness:** if A lands, `rg 'DoublyLinkedList|DoublyLinkedNode' src/` should find no production uses and `cargo +nightly miri test -p bun_core --lib basic_doubly_linked_list_test` should either disappear or pass against the replacement. If B/C lands, rerun the same test under default Miri and Tree-Borrows.

---

### R-EXP-019: `StoreSlice<T>` unbounded `unsafe impl Send/Sync`

**Finding:** EXP-019, MUST-BE-UB → CONFIRMED_UB, `src/ast/nodes.rs:339-340`.
**Shape:** Shape 4 (custom unsafe impl Send/Sync).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Bound the impls: `unsafe impl<T: Send> Send for StoreSlice<T>` / `unsafe impl<T: Sync> Sync for StoreSlice<T>` (PR #30765) | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Replace with auto-trait via removing the manual impl entirely (only works if all fields are Send+Sync) | 4 | 4 | 4 | 4 | 4 | **20** if applicable |
| C | Keep the unsafe impls and document the invariant in a SAFETY comment | 1 (still UB for `T = Cell<u32>`) | 4 | 4 | 2 | 1 | 12 |

**Winner:** **A — bounded impls (PR #30765).** B is equivalent but only if no internal field needs the manual escape hatch — the StoreSlice contains lifetime-erased pointers that defeat auto-trait derivation, so A is required.
**Rationale:** Bounded impls are the standard fix and already drafted in PR #30765 (S1).
**Runners-up:** Same shape applies to **F-A-8 / F-S-1 / F-S-2 / F-S-3** (`JsCell<T>`, `SendPtr<T>` × 2). `JsCell<T>` is now independently confirmed as EXP-045; the `SendPtr<T>` siblings still need misuse witnesses or a preventive hardening PR.
**Proves-original-UB:** EXP-019 (cross-thread `Cell<u32>` race, Phase 5 log) plus `phase5_experiment_results/EXP-019-bun-ast-crate.log`, a direct source-linked harness that races through the real `bun_ast::StoreSlice::new(&[Cell<u32>])` API.
**Proves-new-soundness:** new EXP-019-fix — `assert_impl_all!(StoreSlice<Cell<u32>>: !Send)` becomes a compile-time test.

---

### R-EXP-058: `source_writer_escape() -> &'static mut Writer`

**Finding:** EXP-058, MUST-BE-UB → CONFIRMED_UB, `src/bun_core/output.rs:1075-1108`.
**Shape:** Shape 2 (borrow-scope compression) + Bucket 15 lifetime escape.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace the five public `*_writer*() -> &'static mut Writer` accessors with closure-scoped `with_*_writer(|w| ...)` helpers and migrate call sites mechanically | 4 | 4 | 2 | 3 | 4 | **17** |
| B | Return a `WriterGuard<'a>` tied to the thread-local borrow and implementing `Write` / Bun's writer trait surface | 4 | 4 | 2 | 3 | 4 | **17** |
| C | Keep returning `&'static mut Writer` and rely on the "brief use" convention plus SAFETY comments | 0 | 4 | 4 | 1 | 0 | 9 |

**Winner:** **A for call sites that can be closure-shaped; B for API surfaces that truly need a value.**
**Rationale:** The current safe API can produce two simultaneous `&'static mut Writer` values in safe Rust; Miri Tree-Borrows confirms the second tag is disabled by the first write. A closure API removes the escaping lifetime entirely and matches the source TODO's intended migration path.
**Runners-up:** B is a good adapter if too many call sites need to pass a writer into existing helpers.
**Proves-original-UB:** EXP-058 (`MIRIFLAGS="-Zmiri-tree-borrows"`; `write access ... is forbidden`).
**Proves-new-soundness:** EXP-058-fix — the two-call witness should fail to compile because the borrow is closure-scoped / guard-scoped.

---

### R-EXP-020: `URL::host_with_path` provenance-preserving subslice

**Finding:** EXP-020, `STRICT_PROVENANCE_FAIL` → `DEFERRED`, `src/url/lib.rs:340-351`.
**Shape:** Bucket 2 (provenance) — local address arithmetic rebuilds a pointer from `usize`.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Derive indices relative to `self.href` and return `&self.href[start..end]`; use provenance-preserving `ptr.add` / `offset_from` only to compute offsets after `is_slice_in_buffer` proves same allocation | 5 | 5 | 4 | 5 | 5 | **24** |
| B | Keep the current address arithmetic but reconstruct with `ptr::with_exposed_provenance` | 2 (still strict-prov-fail) | 5 | 4 | 3 | 3 | 17 |
| C | Gate/skip the function under strict-provenance Miri | 0 | 4 | 4 | 2 | 1 | 11 |

**Winner:** **A — provenance-preserving subslice from `self.href`.**
**Rationale:** EXP-020 is not an integer-storage representation like `EnvStr` / `TaggedPtr` / `SmolStr`; both `self.host` and `self.path` are already proven to be slices inside `self.href`. The optimal fix is to compute `start`/`end` offsets and slice `self.href` directly. `ptr::with_exposed_provenance` would merely annotate the current problem and still fail the strict-provenance gate.
**Evidence for original issue:** EXP-020 fails under `-Zmiri-strict-provenance`; not counted as default-Miri/runtime UB.
**Proves-new-soundness:** rerun the EXP-020 mirror under default Miri and strict-provenance with a model that returns a subslice from the original allocation. Add a unit-level Rust test for trailing-slash behavior (`host + path` without ending slash).

### R-EXP-029: `EnvStr` packed-address representation (strict-provenance)

**Finding:** EXP-029, `STRICT_PROVENANCE_FAIL` → `DEFERRED`, `src/runtime/shell/EnvStr.rs:188-200`.
**Shape:** Bucket 2 (provenance) — masked low-48-bit pointer/address encoding.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace packed integer address with a typed pointer/`NonNull<u8>` plus explicit length/refcount/tag metadata, preserving pointer provenance | 5 | 4 | 2 | 3 | 5 | **19** |
| B | Use `ptr::with_exposed_provenance` at recovery sites as an intermediate declaration of exposed-address dependency | 3 (still strict-prov-fail) | 5 | 4 | 4 | 3 | 19 |
| C | Gate/skip strict-provenance Miri for `EnvStr` | 0 | 4 | 4 | 2 | 1 | 11 |

**Winner:** **A for strict-provenance closure; B only as an interim annotation if maintainers want a low-diff migration step.**
**Rationale:** Unlike EXP-020, `EnvStr` actually stores pointer identity in integer bits. Strict-provenance cleanliness requires a representation change, not a local pointer-arithmetic tweak. `with_exposed_provenance` can make the dependency explicit for today's model but does not close the gate.
**Evidence for original issue:** EXP-029 fails under `-Zmiri-strict-provenance`; this is a release-gate failure, not a default-Miri/runtime UB trace.
**Proves-new-soundness:** strict-provenance Miri over the mirror should pass only after the representation carries a typed pointer/`NonNull` instead of raw address bits.
**Note:** the centralised TaggedPtr fix (S2 / R-EXP-048) covers true `TaggedPtr` helper users; it does **not** fix `EnvStr`, `StringOrTinyString`, `ZigString`, `SmolStr`, or `URL::host_with_path`.

---

### R-EXP-021: `bun_ast` lifetime-erased Store wrappers expose safe dangling-reference APIs

**Finding:** EXP-021, MUST-BE-UB → CONFIRMED_UB, `src/ast/nodes.rs:42-113, 170-208, 342-413`.
**Shape:** Bucket 15 (lifetime escape) + Bucket 4 (validity).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Mark every `StoreRef::new` / `StoreSlice::new` constructor `unsafe fn` and document the lifetime contract with the arena that backs them; rename safe consumers to take an explicit `'arena` lifetime | 4 | 4 | 2 (touches 8 constructors + every caller) | 4 | 4 | 18 |
| B | Replace lifetime-erased pointers with arena-indexed handles (`ArenaIndex<T>`) per Shape-1 default | 4 | 3 (one extra deref per access) | 1 (rewrites the AST node representation) | 3 | 4 | 15 |
| C | Add a phantom-lifetime parameter to `StoreRef<'arena, T>` carried through the type system | 4 | 4 | 1 (rewrites every site) | 3 | 4 | 16 |

**Winner:** **A — `unsafe fn` constructors + arena-lifetime contract.**
**Rationale:** Hardens the safe-API surface today without rewriting the bun_ast representation. C is the long-term type-system fix; A is the bridge.
**Runners-up:** B is the textbook Shape-1 answer (arena + index) but bun_ast has 1000s of consumers.
**Proves-original-UB:** EXP-021 (Phase 5 dangling-slice trace).
**Proves-new-soundness:** new EXP-021-fix — re-run the dangling-slice scenario; the `unsafe fn` constructor is the audit point.

---

### R-EXP-077: CSS module export/reference maps erase bump lifetime to `'static`

**Finding:** EXP-077, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/css/css_parser.rs:2309-2322, 2718, 2723`.
**Shape:** Bucket 15 (lifetime escape) + Bucket 6 (`transmute` lifetime rebind).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Re-type `ToCssResult<'bump>` / `ToCssResultInternal<'bump>` and return `CssModuleExports<'bump>` / `CssModuleReferences<'bump>` | 4 | 4 | 2 (threads one result lifetime through callers) | 4 | 4 | 18 |
| B | Deep-copy CSS module exports/references into owned `Box<[u8]>` / `Vec<u8>` maps before returning | 4 | 2 (allocates per export/reference) | 3 | 4 | 3 | 16 |
| C | Keep `'static` fields but document "caller must drop before arena reset" | 0 | 4 | 5 | 1 | 1 | 11 |

**Winner:** **A — thread the bump lifetime through the result type.**
**Rationale:** The current API claims `'static` for arena-backed slices. A captures the real invariant in Rust's type system with zero copying; it matches the in-source TODO at `css_parser.rs:2309-2314`. B is acceptable only if caller ergonomics require an owned result across arena resets.
**Runners-up:** B is the compatibility fallback for JS-facing CSS module metadata if it must outlive the parser arena.
**Proves-original-UB:** EXP-077 default-Miri witness (`phase5_experiment_results/EXP-077-default-miri.log`) reports a dangling reference when constructing / reading the `'static`-typed result.
**Proves-new-soundness:** new EXP-077-fix — compile-time check that `ToCssResult<'bump>` cannot be moved beyond the arena lifetime, plus a Miri harness that drops/resets the backing arena and verifies no safe read path remains.
**Reachability note:** reviewed current in-tree callers only read `result.code` / `print_result.code`. That limits current production exploitability, but does not repair the safe result type.

---

### R-EXP-078: `ArrayLike::set_len_and_slice` exposes initialized-typed slices over uninitialized `Vec` capacity

**Finding:** EXP-078, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/bun_core/util.rs:111-119, 166, 294-301`.
**Shape:** Bucket 5 (uninit) + Bucket 11 (unsafe library contract exposed through safe API).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Mark `ArrayLike::set_len_and_slice` as `unsafe fn` and add a `# Safety` contract requiring every newly-live element be initialized before read/drop; update the single in-tree caller to use an unsafe block immediately followed by `copy_from_slice` | 4 | 4 | 5 | 5 | 4 | 22 |
| B | Replace `set_len_and_slice` with `initialize_from_slice(&mut self, &[Elem])`, so no typed slice over uninit storage escapes at all | 4 | 4 | 3 | 4 | 5 | 20 |
| C | Keep the safe method and rely on comments around the only current caller | 0 | 4 | 5 | 1 | 1 | 11 |

**Winner:** **A — make the unsafe contract explicit immediately.**
**Rationale:** One trait signature and one call site close the current unsound public API with almost no churn. B is the long-term ergonomic cleanup if this reflection-port helper survives; A is the smallest sound bridge.
**Runners-up:** B is stronger because it removes the footgun entirely, but the helper already exists as a porting bridge and may be deleted once call sites are migrated away from Zig-style reflection.
**Proves-original-UB:** EXP-078 default-Miri witness (`phase5_experiment_results/EXP-078-default-miri.log`) reads an uninitialized `bool` through the safe returned `&mut [bool]`. The direct Bun-crate witness (`phase5_experiment_results/EXP-078-bun-core-crate.log`) repeats the same safe-code invalid read through the actual `bun_core::util::ArrayLike` implementation for `Vec<bool>`.
**Proves-new-soundness:** new EXP-078-fix — trybuild check that external safe code cannot call `set_len_and_slice`; Miri check that the in-tree `from_slice` helper initializes all elements before any observable read.
**Reachability note:** reviewed current in-tree call path uses `from_slice` and immediately `copy_from_slice`s. This lowers production blast radius, but the public trait method is still unsound until its signature encodes the precondition.

---

### R-EXP-079: `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` safe mutable-borrow minting

**Finding:** EXP-079, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/bundler/transpiler.rs:262`.
**Shape:** Bucket 15 (lifetime escape) + Bucket 1 (aliasing) — safe `&self` method returns caller-lifetime `&mut`.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Change `env_mut(&self)` to return `*mut dot_env::Loader<'a>` / `NonNull<Loader<'a>>`; each caller materializes a statement-scoped `unsafe { &mut *ptr }` with a local SAFETY note | 4 | 4 | 3 | 4 | 4 | **19** |
| B | Change `env_mut(&self)` to `env_mut(&mut self) -> &mut Loader<'a>` and thread mutable `Transpiler` borrows through all callers | 4 | 4 | 2 (many borrow-checker reshapes) | 3 | 4 | 17 |
| C | Keep the method safe and add comments that callers must not call twice | 0 | 4 | 5 | 1 | 1 | 11 |

**Winner:** **A — raw pointer / `NonNull` accessor plus statement-scoped reborrows.**
**Rationale:** This matches Bun's accepted pattern for re-entrant FFI surfaces (`AnyWebSocket::as_ptr`, EXP-012 fix-model): the shared receiver can expose a raw pointer, but the creation of an actual `&mut Loader` must be explicit, local, and auditable. B is type-theoretically cleaner but likely explodes borrowck churn across CLI/runtime paths that intentionally reborrow disjoint `Transpiler` fields.
**Runners-up:** B is the long-term safe-Rust goal if the call graph can be reshaped incrementally.
**Proves-original-UB:** EXP-079 Tree-Borrows witness (`phase5_experiment_results/EXP-079.log`) calls the safe method twice and gets `write access ... is forbidden`.
**Proves-new-soundness:** new EXP-079-fix — the two-call safe witness should fail to compile because safe code can no longer receive `&mut Loader`; every call site must opt into a local unsafe reborrow.
**Reachability note:** many current in-tree callers are statement-scoped and already comment around re-derivation after invalidating operations. The defect is the safe API boundary, not proof that every caller is currently live UB.

### R-EXP-087: `ThreadPool::get_worker(&self, id) -> &'static mut Worker` duplicate-handle safe API

**Finding:** EXP-087, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/bundler/ThreadPool.rs:414-428, 629-652`.
**Shape:** Bucket 15 (lifetime escape) + Bucket 1 (aliasing) + Bucket 8 (cross-thread worker handle) — safe `&self` method returns an escaping `&'static mut Worker`.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace `get_worker(&self, id) -> &'static mut Worker` with a closure-scoped `with_worker(id, |worker| ...)` / `WorkerGuard<'_>` API that keeps uniqueness tied to a guard lifetime | 4 | 3 | 2 | 3 | 4 | **16** |
| B | Return `NonNull<Worker>` / `*mut Worker`; every call site must create a statement-scoped `unsafe { &mut *worker.as_ptr() }` and justify uniqueness locally | 4 | 4 | 3 | 4 | 3 | **18** |
| C | Keep returning `&'static mut Worker` and rely on "one worker per OS thread" comments | 0 | 4 | 5 | 1 | 1 | 11 |

**Winner:** **B for the first Bun-sized patch; A as the long-term safe API.**
**Rationale:** Bun's current comments explicitly say Zig returned `*Worker`, and the real hot-path call sites already operate in statement-sized phases (`get`, `create`, `push`, `unget`). Returning a raw pointer restores the Zig semantics without pretending the compiler can enforce uniqueness. A is cleaner but likely touches more of the bundler scheduling flow. C is the current defect: the `Guarded` map lock protects lookup and insertion, but it is dropped before returning the reference and therefore cannot guard the lifetime of the escaped `&'static mut Worker`.
**Proves-original-UB:** EXP-087 Tree-Borrows witness (`phase5_experiment_results/EXP-087.log`) calls a source-shaped safe `get_worker(&self)` twice for the same heap cell and Miri rejects the second write: `write access through <245> ... is forbidden`.
**Proves-new-soundness:** new EXP-087-fix — the duplicate-call safe witness should either fail to compile (closure/guard API) or require unsafe raw-pointer reborrows at the call sites, making the uniqueness invariant local and reviewable.
**Reachability note:** current production bundler callers may preserve one-live-worker-handle discipline. The confirmed defect is the safe API contract, not a proven production crash path.

### R-EXP-080: `link_interface!` public fields bypass `unsafe fn new`

**Finding:** EXP-080, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/dispatch/lib.rs:302-318`.
**Shape:** Bucket 11 (unsafe contract exposed through safe API) + Bucket 8/10 dispatch-handle soundness.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Make generated `kind` and `owner` fields private; expose read-only `kind()` if needed; keep `unsafe fn new` as the only normal constructor | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Leave fields public but make every generated dispatch method `unsafe fn` | 4 | 4 | 2 | 3 | 2 | 15 |
| C | Keep fields public and add debug assertions for null / kind-range | 1 | 4 | 4 | 3 | 1 | 13 |

**Winner:** **A — field privatization.**
**Rationale:** This is the direct isomorphic fix: dispatch stays safe because construction is unsafe-gated. It also preserves every optimized `match kind { ... extern "Rust" ... }` dispatch path.
**Runners-up:** B is sound but contaminates every call site with unnecessary `unsafe`. C does not fix dangling or wrong-type owners and does nothing in release for many invalid handles.
**Proves-original-UB:** EXP-080 Miri witnesses forge a handle in safe code and reach a null-pointer deref through a safe method. The minimized mirror is `phase5_experiment_results/EXP-080-default-miri.log`; the direct Bun-crate witness is `phase5_experiment_results/EXP-080-bun-dispatch-crate.log`, which compiles against the real `bun_dispatch::link_interface!` / `link_impl_*!` macro expansion.
**Proves-new-soundness:** new EXP-080-fix — attempt to construct `DevServerHandle { kind, owner }` or the minimized `Handle { kind, owner }` from safe external code should fail to compile; existing legitimate constructors still compile through `unsafe fn new`.

---

### R-EXP-081: POSIX `dir_iterator::Name` lifetime-erased safe dangling-slice API

**Finding:** EXP-081, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/sys/lib.rs:154-159, 183-192, 207-221, 804-808`.
**Shape:** Bucket 15 lifetime escape + Bucket 8 unsafe Send/Sync over a borrowed scratch buffer.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Migrate POSIX to owned entry names (`IteratorResult { name: PathString/Vec<u8>, kind }`) using the Section D owned-result template | 4 | 2 (one copy per entry on POSIX hot paths) | 3 | 4 | 4 | **17** |
| B | Add an explicit lifetime: `IteratorResult<'iter> { name: Name<'iter>, kind }`, with `Name<'iter>` borrowing the iterator buffer | 4 | 4 | 2 (lifetime threads through many consumers) | 3 | 4 | 17 |
| C | Make `Name::slice*` accessors unsafe and remove Send/Sync | 3 | 4 | 4 | 2 | 2 | 15 |

**Winner:** **A for correctness margin and API simplicity**, unless benchmarks show the per-entry copy is unacceptable for install/glob hot paths; then B is the zero-copy fallback.
**Rationale:** The current public safe API already documents a streaming invalidation contract that Rust does not enforce. Owned entries make the contract disappear rather than moving it to every consumer. B preserves zero-copy but leaks lifetime complexity into all iterator clients.
**Proves-original-UB:** EXP-081 (`phase5_experiment_results/EXP-081-rerun.log`) retains an owned `IteratorResult`, drops the iterator, and Miri reports a dangling pointer at `Name::slice_u8`.
**Proves-new-soundness:** new EXP-081-fix — the old reproducer should either compile and run cleanly (owned result) or fail to compile because `entry` cannot outlive `iter` (lifetime-param result).

---

### R-EXP-082: `Blob: Send + Sync` exposes safe `Option<&JSGlobalObject>` access across threads

**Finding:** EXP-082, MUST-BE-UB generic safe-API contract → CONFIRMED_UB, `src/jsc/webcore_types.rs:60-96, 220-231`.
**Shape:** Bucket 8 (unsafe Send/Sync), Bucket 21 (JS-thread-affine FFI handle), Bucket 7 (data race if the exposed handle reaches thread-local mutable state).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Split `Blob` into a JS-thread-affine wrapper (`!Send + !Sync`, owns `global_this`) and a data-only `SendBlobData` / `BlobPayload` that worker tasks and registries may move across threads | 4 | 4 | 2 | 3 | 4 | **17** |
| B | Keep `Blob: Send` but remove `Sync`; make every shared cross-thread holder store only `BlobPayload` or an owned clone of the bytes/refcounted store | 4 | 4 | 2 | 3 | 3 | 16 |
| C | Keep `Blob: Send + Sync`, but make `global_this()` unsafe/raw-pointer-only and add a debug JS-thread assertion before returning `&JSGlobalObject` | 3 | 4 | 4 | 3 | 2 | 16 |

**Winner:** **A — split the JS-affine wrapper from the cross-thread payload.**
**Rationale:** This is the only option that encodes the stated safety invariant in the type system: blob data may move; JSC globals may not. B is acceptable if source compatibility demands a smaller first PR. C is a stopgap only; it removes the safe-API footgun but leaves the type carrying a comment-only cross-thread contract.
**Proves-original-UB:** EXP-082 Miri witness (`phase5_experiment_results/EXP-082.log`) shares a `Blob`-shaped `Arc` across two threads, calls safe `global_this()`, and Miri reports a data race through the thread-affine `Cell` payload.
**Proves-new-soundness:** new EXP-082-fix — the old witness should fail to compile because the JS-affine wrapper is not `Sync`, while a separate `SendBlobData` payload compiles and carries no `global_this()` accessor.

---

### R-EXP-083: shell `IOWriter` / `IOReader` safe `&self` mutators over `UnsafeCell<State>`

**Finding:** EXP-083, MUST-BE-UB generic safe-API contract → CONFIRMED_UB, `src/runtime/shell/IOWriter.rs:237-252, 969-985`; `src/runtime/shell/IOReader.rs:72-100, 220-268`.
**Shape:** Bucket 8 (unsafe Sync), Bucket 7 (unsynchronized state mutation), Bucket 1 (coexisting mutable reborrows).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Remove `Sync` by adding a `_not_sync: PhantomData<*const ()>` / private marker to `IOWriter` and `IOReader`; keep single-threaded shell access unchanged | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Wrap `State` in a real `Mutex` / `Guarded` so `Arc<T>: Sync` is truthful | 4 | 2 | 2 | 3 | 3 | 14 |
| C | Keep `Sync`, but make state-mutating methods unsafe or route cross-thread use through explicit event-loop tasks | 3 | 4 | 3 | 3 | 3 | 16 |

**Winner:** **A — make the handles non-`Sync`.**
**Rationale:** The source contract says the shell is single-threaded. Encoding that with auto-traits is smaller and faster than introducing locks. If later work genuinely needs cross-thread shell IO handles, it should use an event-loop message handle, not direct shared access to the IO state.
**Proves-original-UB:** EXP-083 Miri witness (`phase5_experiment_results/EXP-083.log`) calls a safe `enqueue(&self)` method from two threads on an `Arc`-shared IOWriter-shaped type; Stacked Borrows rejects the second `&mut *UnsafeCell` reborrow.
**Proves-new-soundness:** new EXP-083-fix — the old witness should fail to compile because the handle is not `Sync`; shell-thread-only call sites still compile.

---

### R-EXP-084: `VirtualMachine: Send + Sync` plus safe TLS-backed mutation

**Finding:** EXP-084, MUST-BE-UB generic safe-API contract → CONFIRMED_UB, `src/jsc/VirtualMachine.rs:604-688`.
**Shape:** Bucket 8 (unsafe Send/Sync), Bucket 7 (thread-local state assumed by safe API), Bucket 21 (JS-thread-affinity boundary).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Make `VirtualMachine` explicitly JS-thread-affine (`!Send + !Sync`) and replace cross-thread uses with narrow task/event-loop handles | 4 | 4 | 2 | 3 | 4 | 17 |
| B | Keep `Sync` temporarily, but make `as_mut()` / `get_mut()` checked safe APIs (`Option` or release panic) and move the current unchecked path behind `unsafe fn *_unchecked` | 3 | 3 | 4 | 4 | 4 | **18** |
| C | Keep current auto-traits and `unwrap_unchecked` safe methods | 0 | 4 | 4 | 1 | 0 | 9 |

**Winner:** **B short-term, A structural.**
**Rationale:** `VirtualMachine` is central enough that immediately removing `Sync` may cascade through many `'static` closures. The minimal safety fix is to stop making a missing TLS VM slot an unchecked precondition of safe methods. The long-term fix is the existing `JsThreadAffine` marker-trait plan.
**Proves-original-UB:** EXP-084 Miri witness (`phase5_experiment_results/EXP-084-release.log`) sends a safe `&VirtualMachine` to a thread with no TLS VM slot and calls safe `as_mut()`; Miri reports `Undefined Behavior: entering unreachable code` at the modeled `unwrap_unchecked()`.
**Proves-new-soundness:** new EXP-084-fix — either the off-thread capture fails to compile (`VirtualMachine: !Sync`), or the safe method returns `None` / panics rather than invoking unchecked UB.

---

### R-EXP-085: `fmt::Raw` / `fmt::s` safe Display over arbitrary bytes

**Finding:** EXP-085, MUST-BE-UB safe-API contract → CONFIRMED_UB, `src/bun_core/fmt.rs:724-731, 3744-3749`.
**Shape:** Bucket 4 (`str` validity), Bucket 12 (safe trait contract).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace `fmt::Raw`'s `Display` body with byte-oriented lossy display (`bstr::BStr`-style or local escaped formatter) | 4 | 3 | 4 | 4 | 4 | **19** |
| B | Keep `Display`, but validate with `str_utf8` and print replacement/escaped output on invalid bytes | 4 | 3 | 4 | 4 | 3 | 18 |
| C | Make `fmt::raw` / `fmt::s` unsafe and keep `from_utf8_unchecked` | 3 | 4 | 3 | 3 | 2 | 15 |
| D | Keep the current safe API and assume every caller passes UTF-8 | 0 | 4 | 4 | 1 | 0 | 9 |

**Winner:** **A or B; prefer A for byte-oriented user-visible paths.**
**Rationale:** The adapter is named like Zig's `{s}` and is used for paths, tarball entry names, package-manager messages, and command echoing. Those are byte strings in several subsystems, not Rust `str`s. A lossy or escaped byte formatter preserves output robustness without making every caller prove UTF-8 before display.
**Proves-original-UB:** EXP-085 Miri witness (`phase5_experiment_results/EXP-085.log`) formats `[0xff]` through a source-shaped safe `Raw` wrapper; Miri reports UB in `core::str::next_code_point` after the invalid `&str` is consumed. `phase5_experiment_results/EXP-085-bun-core-crate.log` repeats the witness through the real safe `bun_core::fmt::s(&[0xff])` API.
**Proves-new-soundness:** new EXP-085-fix — rerun the witness with invalid bytes; it must print lossily/escaped or return an error/panic, but must not call `from_utf8_unchecked` on caller bytes.

---

### R-EXP-086: `bun::unsafe_assert` safe wrapper around `unreachable_unchecked`

**Finding:** EXP-086, MUST-BE-UB safe-API contract → CONFIRMED_UB, `src/bun.rs:1582-1586`.
**Shape:** Bucket 4 (`unreachable_unchecked` precondition), Bucket 12 (safe API contract).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Delete `unsafe_assert` if it remains unused | 4 | 4 | 4 | 5 | 5 | **22** |
| B | Replace false branch with `panic!` / `unreachable!` | 4 | 3 | 5 | 5 | 4 | 21 |
| C | Make the helper `pub unsafe fn unsafe_assert` and document the precondition | 3 | 4 | 4 | 4 | 3 | 18 |
| D | Keep safe `pub fn unsafe_assert(bool)` over `unreachable_unchecked` | 0 | 4 | 5 | 1 | 0 | 10 |

**Winner:** **A if still unused; otherwise B.**
**Rationale:** `rg 'unsafe_assert\(' src --glob '*.rs'` currently finds only the
definition, so deletion is the best fix. If a future hot path wants the helper,
the safe API must not turn caller-controlled `false` into UB. A release panic is
acceptable for an assertion helper; making it `unsafe fn` is correct but still
invites casual misuse because the name already looks like an assertion macro.
**Proves-original-UB:** EXP-086 Miri witness (`phase5_experiment_results/EXP-086.log`) calls a source-shaped `unsafe_assert(false)` and reports `Undefined Behavior: entering unreachable code` at `unreachable_unchecked()`.
**Proves-new-soundness:** new EXP-086-fix — the same witness either fails to compile because the helper is gone / unsafe, or panics normally instead of invoking `unreachable_unchecked`.

---

### R-EXP-026: `runtime::timer::All` re-entrant `&mut self`

**Finding:** EXP-026, MUST-BE-UB → CONFIRMED_UB (TB), `src/runtime/timer/mod.rs:897, 1016`.
**Shape:** Bucket 1 (aliasing) — re-entrant callback with `&mut self`.

**Apply S4** (EXP-012 fix-model propagation). See the structural fix above. Single rewrite plan: flip `&mut self` → `this: *mut Self`; install `ThisPtr` + `ref_guard` RAII bracket around the re-entry hazard line.
**Proves-original-UB:** EXP-026 (TB model).
**Proves-new-soundness:** new EXP-026-fix — same TB model, expect TB-clean.

---

### R-EXP-027: Windows `dir_iterator::IteratorResultWName` sendable lifetime-erased borrow

**Finding:** EXP-027, MUST-BE-UB → CONFIRMED_UB, `src/runtime/node/dir_iterator.rs:44-67, 499-522, 895-899`.
**Shape:** Shape 4 (custom unsafe impl Send/Sync over a borrow).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Migrate to the Section D owned-result template (`IteratorResultWName { name: WString, kind }`) — Windows analogue of S5's POSIX migration | 4 | 3 (one extra heap copy per dir entry; iter is already heap-allocated) | 3 (touches Windows iter consumers) | 4 | 4 | **18** |
| B | Add `_not_send: PhantomData<*const ()>` marker; require callers to materialize before sending | 4 | 4 | 4 | 3 | 3 | 18 |
| C | Tie the `RawSlice<u16>` to the iterator's lifetime via `IteratorResultWName<'iter>` | 4 | 4 | 3 | 4 | 4 | **19** |

**Winner:** **C — explicit `'iter` lifetime parameter.**
**Rationale:** Lowest-cost fix that the type system enforces. A is the structural twin of S5 but Windows iter consumers are different from POSIX; the lifetime parameter route is more surgical.
**Runners-up:** A is the long-term right answer for cross-platform symmetry; C is the bridge.
**Proves-original-UB:** EXP-027 (Phase 5 trace).
**Proves-new-soundness:** new EXP-027-fix — `assert_impl_all!(IteratorResultWName<'static>: !Send)`.

---

### R-EXP-035: `StandaloneModuleGraph` `read_unaligned` over 4 sparse enums

**Finding:** EXP-035, MUST-BE-UB → CONFIRMED_UB, `src/standalone_graph/StandaloneModuleGraph.rs:230-246, 577-580`.
**Shape:** Shape 6 (transmute from disk bytes; structural twin of EXP-003).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace each `#[repr(u8)]` enum with `#[repr(transparent)] struct Foo(u8)` + `try_from()`; validate at the `read_unaligned` call site; fail with `StandaloneCorrupt` on tampered binary | 4 | 4 | 3 | 4 | 4 | **19** |
| B | Ship a CompiledModuleGraphFile signature/hash; verify before parse | 4 | 3 (one HMAC per Bun startup) | 2 | 3 | 4 | 16 |
| C | bytemuck::CheckedBitPattern derive over the 4 enums | 4 | 3 | 3 | 3 | 4 | 17 |

**Winner:** **A — newtype + try_from at read site.**
**Rationale:** Structural twin of EXP-003 with the same default-pick fix. B is a defense-in-depth follow-up (good, but separate concern).
**Runners-up:** B is the right thing to add **after** A — protects against the truly malicious binary.
**Proves-original-UB:** EXP-035 (Phase 5 trace).
**Proves-new-soundness:** new EXP-035-fix — feed tampered Mach-O `__BUN` section; expect `Err`.
**Triangulation:** **recommended** (FFI public API; tampered-binary attack surface).

---

### R-EXP-036: `Buffers::read_array<PatchedDep>` validity-fails on bool

**Finding:** EXP-036, MUST-BE-UB → CONFIRMED_UB, `src/install/lockfile/bun.lockb.rs:590` + `src/install/lockfile.rs:3369-3378`.
**Shape:** Shape 6 (validity-bearing field in disk bytes).

**Apply S6** (`LockfileArrayElem` bound). See the structural fix above. Single mechanical change: add `unsafe trait LockfileArrayElem: Copy` with hand-audited per-T impls; reject `T = PatchedDep` until the `bool` is replaced with a byte-open `u8` representation plus an accessor that either interprets or validates the disk byte.

**Per-impl plan for `PatchedDep`:**
- Preferred: replace `patchfile_hash_is_null: bool` with `patchfile_hash_is_null: u8` and expose `is_null() -> bool { self.patchfile_hash_is_null != 0 }` (or a stricter checked accessor if non-0/1 bytes should reject the lockfile). Then `PatchedDep` is byte-open and can safely implement `LockfileArrayElem`.
- Alternative: introduce a separate `read_array_checked::<PatchedDep>()` / `LockfileDecode` path that reads raw bytes first, validates each bool byte as `0 | 1`, and only then constructs `PatchedDep`. Do **not** form `&[PatchedDep]` before validation; materializing a `bool = 0xff` is already UB.

**Proves-original-UB:** EXP-036 (Phase 5 Miri witness `0xff` bool).
**Proves-new-soundness:** new EXP-036-fix — feed `0xff` to the patched read path; expect `Err(LockfileCorrupt)` not UB.

---

### R-EXP-041: `WebSocketServerContext::active_connections_saturating_{add,sub}` writes through `addr_of!.cast_mut()` on `&self`

**Finding:** EXP-041, MUST-BE-UB → CONFIRMED_UB, `src/runtime/server/WebSocketServerContext.rs:79-96` + 10 siblings.
**Shape:** Bucket 14 (`*const T → *mut T → write`).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace field with `Cell<usize>`; `add(1)` / `sub(1)` operate on `&Cell<usize>`. The in-source TODO already calls this out as the right fix | 4 | 4 | 3 (touches the field type + 11 sibling sites mechanically) | 4 | 4 | **19** |
| B | Replace field with `AtomicUsize` (Relaxed) — defends against the next refactor that makes the type accidentally `Sync` | 4 | 4 | 3 | 4 | 4 | **19** |
| C | Wrap field in `UnsafeCell<usize>` and keep the helpers; document the single-thread invariant | 3 (still trusts the invariant; lint-silenceable) | 4 | 4 | 2 | 2 | 15 |

**Winner:** **B — `AtomicUsize` (Relaxed).**
**Rationale:** Same diff radius as A but defends against future cross-thread access (e.g., a metrics scraper). The Relaxed atomic op is cheaper than a `Cell` + a thread-id check would be.
**Runners-up:** A is the per-site canonical fix; B is the defensive upgrade. Either closes the bug.
**Proves-original-UB:** EXP-041 (Phase 5 log).
**Proves-new-soundness:** new EXP-041-fix — same TB model; the `&self` no longer derives a write.

**Apply same pattern to all 11 cluster-A14-A siblings:** `subprocess.rs:265`, `Terminal.rs:373`, `cron.rs:1401`, `node_fs_watcher.rs:107`, `node_fs_stat_watcher.rs:550`, `interpreter.rs:894`, `JSTranspiler.rs:1192`, `dns.rs:4017`, `socket_body.rs:347`, `h2_frame_parser.rs:1340`. Cluster summary: **all 11 `addr_of!.cast_mut()` count writes converge on `AtomicUsize` (Relaxed) as winner.**

---

### R-EXP-042: `runtime::cli::repl::vm_mut` forges `&mut VM` from `&VM`

**Finding:** EXP-042, MUST-BE-UB → CONFIRMED_UB, `src/runtime/cli/repl.rs:94-101`.
**Shape:** Bucket 14 — canonical `&T → &mut T` forgery; lint silenced.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Change the parameter type at every call site to `&mut VirtualMachine`; remove `vm_mut` | 4 | 4 | 3 (audit every caller of vm_mut) | 4 | 4 | **19** |
| B | Wrap mutable VM state in `RefCell<VMState>`; `vm_mut` becomes `vm.state.borrow_mut()` | 4 | 3 (one borrow check per access) | 2 (rewrites VM struct) | 3 | 4 | 16 |
| C | Restore the `#[deny(invalid_reference_casting)]` lint and let it fail; force the call site fix | 4 | 4 | 4 (one-line lint flip) | 4 | 4 | **20** if the resulting compile error path is feasible |

**Winner:** **C — restore the lint, then apply A at the resulting compile failures.**
**Rationale:** The lint already exists, the project explicitly silenced it. The lint is the audit. Combine C (flip the lint) → A (fix call sites) for a single-PR remediation.
**Runners-up:** B is the more "Rusty" answer but VirtualMachine has hundreds of sites that read state.
**Proves-original-UB:** EXP-042 (Phase 5 log).
**Proves-new-soundness:** the lint is the witness — if it compiles, the UB is gone.

---

### R-EXP-043: `runtime::cli::test::Scanner::resolve_dir_for_test` forges `&mut RealFS`

**Finding:** EXP-043, MUST-BE-UB → CONFIRMED_UB, `src/runtime/cli/test/Scanner.rs:255-265, 365`.
**Shape:** Same as EXP-042.

**Apply same A+C plan** as R-EXP-042. The Scanner struct holds the FS by `Arc<RealFS>`; the `&self.fs.fs` reborrow chain should become a method on `RealFS` that takes `&mut self` (or returns a `RefCell::borrow_mut`).
**Proves-original-UB:** EXP-043 (Phase 5 log).
**Proves-new-soundness:** lint-flip witness.

---

### R-EXP-076: `WindowsNamedPipeContext` mutates `VirtualMachine` through a shared VM backref

**Finding:** EXP-076, MUST-BE-UB → CONFIRMED_UB, `src/runtime/socket/WindowsNamedPipeContext.rs:269-272`.
**Shape:** Same Bucket-14 family as EXP-042, but the receiver mutation is `VirtualMachine::enqueue_task(&mut self)`.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Do not call `VirtualMachine::enqueue_task(&mut self)` from a `&'static VirtualMachine`; enqueue through the VM-owned raw event-loop pointer (`vm.event_loop()` / `event_loop_ref()` short-lived projection) or add a dedicated `enqueue_task_from_shared_vm(&self, Task)` wrapper that uses the existing audited event-loop projection | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Change `WindowsNamedPipeContext.vm` to a raw `*mut VirtualMachine` and derive it from `VirtualMachine::get_mut_ptr()` / a true mutable VM source at construction | 4 | 4 | 3 | 3 | 3 | 17 |
| C | Keep the current cast and rely on "same JS thread" discipline | 0 | 4 | 4 | 1 | 0 | 9 |

**Winner:** **A — avoid minting a whole-VM `&mut`; enqueue through the event-loop projection already designed for shared VM references.**
**Rationale:** `VirtualMachine.rs` explicitly documents `event_loop(&self) -> *mut EventLoop` and `event_loop_mut(&self) -> &mut EventLoop` as the escape hatch for the active loop. The named-pipe site only needs to enqueue a task; it does not need mutable access to the whole `VirtualMachine`. Using that narrower projection is smaller than changing the context's stored VM representation and removes the exact `ptr::from_ref(vm).cast_mut()` retag that Miri rejects.
**Runners-up:** B is also sound if the construction site can prove a true mutable VM pointer, but it widens raw whole-VM authority through a long-lived context for no benefit. C is Miri-rejected; single-threadedness is not an aliasing proof.
**Proves-original-UB:** EXP-076 default Miri (`SharedReadOnly` receiver retag failure) and Tree-Borrows (`Frozen` event-loop write).
**Proves-new-soundness:** EXP-076 fix-model logs (`EXP-076-fix-event-loop-ptr-default-miri.log`, `EXP-076-fix-event-loop-ptr-tree-borrows.log`) are Miri-clean when the context stores/enqueues through a stable raw event-loop pointer instead of forging a whole-VM `&mut`.

---

### R-EXP-044: `bundle_v2.rs:1216, 1227, 1362, 1376` JS-loop trampoline `&mut *self.bv2` reborrow

**Finding:** EXP-044, MUST-BE-UB → CONFIRMED_UB, `src/bundler/bundle_v2.rs:*`.
**Shape:** Bucket 1 + Bucket 21 (centralised `*mut BundleV2 → &mut BundleV2` with caller-chosen lifetime, re-entrant via plugin chain).

**Apply S4** (EXP-012 fix-model propagation). See the structural fix above. The fix is direct port of `WebSocketUpgradeClient::cancel`'s `ThisPtr + ref_guard` pattern.
**Proves-original-UB:** EXP-044 (Phase 5 plugin re-entry harness).
**Proves-new-soundness:** new EXP-044-fix — same harness with `ThisPtr` should be TB-clean.
**Triangulation:** **recommended** (re-entrant plugin path; high-stakes).

---

### R-EXP-051: `bun-native-plugin-rs::BunLoader` `(u8 as u32)` transmute

**Finding:** EXP-051, MUST-BE-UB → CONFIRMED_UB, `packages/bun-native-plugin-rs/src/lib.rs:637`.
**Shape:** Shape 6 (transmute u8 → `#[repr(u32)]` enum, 13 valid / 256 input space).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | `bytemuck::CheckedBitPattern` derive on `BunLoader`; FFI call returns `Result<BunLoader, InvalidLoader>` | 4 | 4 | 3 | 4 | 4 | **19** |
| B | Manual `try_from(u8) -> Result<BunLoader, ...>` with explicit match on each valid variant | 4 | 4 | 3 | 4 | 4 | **19** |
| C | Document the host-side invariant + add a runtime panic on invalid value | 2 (UB if host doesn't honor invariant) | 4 | 4 | 3 | 2 | 15 |

**Winner:** **B — manual `try_from` with explicit match.**
**Rationale:** A and B tie on score, but bun-native-plugin-rs is a public FFI API that downstream native-plugin authors depend on; explicit `try_from` is more debuggable than a derived trait. Keep bytemuck out of the public surface.
**Runners-up:** A is fine if the team prefers derive-everything style.
**Proves-original-UB:** EXP-051 (Phase 5 log + reproducer at `experiments/EXP-051/`).
**Proves-new-soundness:** new EXP-051-fix — feed hostile loader byte to patched API; expect `Err`.
**Triangulation:** **strongly recommended** (`/multi-model-triangulation`) — this is the public FFI surface for **every native plugin**. Breaking the API here is a downstream-ecosystem event.

---

### R-EXP-097: safe errno `from_raw` helpers transmute unchecked sparse enum discriminants

**Finding:** EXP-097, MUST-BE-UB safe-API shape → CONFIRMED_UB, `src/errno/windows_errno.rs:248-255` and `src/errno/lib.rs:303-310`.
**Shape:** Shape 6 (safe `pub const fn from_raw(u16) -> #[repr(u16)] enum` with unchecked sparse-enum transmute).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Replace `from_raw` bodies with `from_repr(n).expect("invalid errno discriminant")` / `try_from_raw(n).expect(...)`; keep signature for internal call-site compatibility | 4 | 4 | 5 | 5 | 5 | **23** |
| B | Make `from_raw` `unsafe const fn` and require all callers to prove discriminant validity | 3 | 4 | 3 | 3 | 2 | 15 |
| C | Keep debug assertions and add comments | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — checked conversion inside the safe function.**
**Rationale:** `from_raw` is already safe and has existing safe call sites; preserving the API while removing the invalid-enum construction is the smallest correct change. A panic on invalid raw tags is vastly preferable to UB, and existing checked helpers already exist.
**Proves-original-UB:** EXP-097 release-mode Miri witness (`phase5_experiment_results/EXP-097.log`) plus direct Bun-crate witness (`phase5_experiment_results/EXP-097-bun-errno-crate.log`) that reports the invalid enum tag at `/data/projects/bun/src/errno/lib.rs:310`.
**Proves-new-soundness:** new EXP-097-fix — call `E::from_raw(138)` / `SystemErrno::from_raw(138)` under release-mode Miri and observe a panic or `Result`/`Option` path, not invalid enum construction.
**Bundle with:** EXP-002. The Linux raw-syscall fix and safe `from_raw` cleanup should land in one errno PR.

---

### R-EXP-098: `AtomicCell<T: Copy>` unbounded `Send`/`Sync`

**Finding:** EXP-098, MUST-BE-UB generic safe-API contract → CONFIRMED_UB, `src/bun_core/atomic_cell.rs:65-66` plus safe `new()` / `into_inner()` at `:68-83`.
**Shape:** Shape 8 (unbounded unsafe auto-trait impl) + Shape 7 (data race through safe API).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Tighten the unsafe auto-trait impls to `unsafe impl<T: Atom> Send/Sync for AtomicCell<T>` and keep the atomic API unchanged | 4 | 5 | 5 | 5 | 4 | **23** |
| B | Split `AtomicCell<T: Atom>` from a non-Send `CopyCell<T: Copy>` / `LocalCopyCell<T>` for `new()` + `into_inner()`-only storage | 5 | 5 | 3 | 4 | 5 | **22** |
| C | Add docs saying non-Atom payloads must not cross threads | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A first, B if source compatibility requires non-Atom local payloads.**
**Rationale:** The real bug is the wrapper's auto-trait surface, not the atomic operations. `T: Atom` already encodes the intended set of payloads; making the auto-trait impls match that contract prevents `AtomicCell<&Cell<_>>` from becoming a Send wrapper. If maintainers need non-Atom local storage, it should be a different non-Send type.
**Proves-original-UB:** EXP-098 direct Bun-crate witness (`phase5_experiment_results/EXP-098-bun-core-crate-default.log` and `EXP-098-bun-core-crate.log`) reports a `Cell` data race through safe `bun_core::AtomicCell`.
**Proves-new-soundness:** compile-fail witness: `AtomicCell::new(&Cell::new(0))` must not be movable into `std::thread::scope(... spawn ...)`; Miri rerun should fail to compile rather than race.
**Bundle with:** EXP-045 / EXP-019 / EXP-111 bounded-auto-trait cleanup if maintainers want one coherent "generic unsafe impl Send/Sync" PR. Keep EXP-047 (`ThreadCell` / `RacyCell`) in the same review only as hardening/naming cleanup; it is not a counted confirmed-UB fix after the safe-boundary correction.

---

### R-EXP-111: bundler part-range fan-out `&mut` cleanup + shared renamer view

**Finding:** EXP-111, MUST-BE-UB default-Miri retag/data-race witness, `src/bundler/Chunk.rs:80-84,114-134`, `generateCompileResultForJSChunk.rs:54-68,160-169`, `generateCompileResultForCssChunk.rs:38-47`, and `generateCodeForFileInChunkJS.rs:30-35`.
**Shape:** Shape 1 (aliased whole-owner `&mut`), Shape 8 (unsafe auto-trait impl), and Shape 7 (cross-thread retag/data-race). Tree Borrows accepts the current read-only model, so cite default Miri for this one. The renamer TODO is real, but a renamer-only patch is incomplete while the worker callbacks still materialize concurrent `&mut LinkerContext` / `&mut Chunk`.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Refactor the part-range worker API to stop forming concurrent whole-owner `&mut LinkerContext` / `&mut Chunk`; pass granular shared views for read-only graph/chunk access, keep `CompileResultSlots` and atomic counters as the only write paths, and then complete the source TODO by making `Renamer<'r>` carry shared/read-only borrows. Prove worker-time `SymbolMap::follow()` is store-free after `follow_all()` or use a no-compress read-only follow path. | 5 | 5 | 3 | 3 | 5 | **21** |
| B | Remove `unsafe impl Send/Sync for Chunk` and keep part-range chunk processing single-threaded until the whole-owner borrowing and renamer ownership model is redesigned. | 5 | 2 | 3 | 5 | 4 | 19 |
| C | Flip only `Renamer<'r>` to shared borrows but leave `generate_compile_result_for_{js,css}_chunk` forming concurrent whole-owner `&mut` references. | 2 | 5 | 4 | 3 | 2 | 16 |
| D | Keep the unsafe impls and rely on code-review discipline that parallel workers only read the renamer today. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — remove the concurrent whole-owner `&mut` worker entries and finish the renamer TODO.**
**Rationale:** The default-Miri witness fails at the `&mut Chunk` retag, so the fix must address the worker API, not just the renamer enum. The author comment correctly identifies the renamer half of the fix, but source review shows `generate_compile_result_for_{js,css}_chunk` still constructs `&mut LinkerContext` and `&mut Chunk` while peer tasks are live. If the read-only/shared-view split cannot be done cleanly, B is the temporary soundness fallback.
**Proves-original-UB:** EXP-111 default-Miri log (`phase5_experiment_results/EXP-111-sb.log`) reports the cross-thread retag/data-race witness. `EXP-111-tb.log` is intentionally clean and should be kept as the model-boundary note, not cited as failure evidence.
**Proves-new-soundness:** compile-time/API check that the part-range worker callbacks no longer materialize `&mut LinkerContext` / `&mut Chunk`; compile-time check that `Renamer<'r>` no longer contains `&'r mut` renamer fields during the fan-out phase; rerun EXP-111's default-Miri harness as a compile-fail or clean read-only model; add a targeted check that parallel printer paths either run after `follow_all()` has fully compressed symbol links or use a no-compress follow function.
**Bundle with:** EXP-010 bundler fan-out cleanup first; EXP-019 / EXP-045 / EXP-098 bounded-auto-trait cleanup second. Do not land a renamer-only patch and claim EXP-111 closed.

---

### R-EXP-099: `InternalMsgHolder::flush(&mut self)` re-entry through `child_singleton()`

**Finding:** EXP-099, MUST-BE-UB Tree-Borrows model, `src/runtime/node/node_cluster_binding.rs:35-51,147-158` plus `src/jsc/ipc.rs:140-159`.
**Shape:** Shape 1 (aliasing), Shape 15 (caller-chosen mutable lifetime), Shape 21 (JSC callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Change `InternalMsgHolder::flush` from `fn flush(&mut self, global)` to `fn flush(this: *mut Self, global)` (or `NonNull<Self>`), and have `node_cluster_binding` call it with `CHILD_SINGLETON.get()` / a raw owner token. Materialize short `&mut` borrows only between callback invocations. | 5 | 5 | 4 | 5 | 5 | **24** |
| B | Keep receiver but wrap re-entrant callback dispatch in an internal guard flag that panics/queues on re-entry | 2 | 4 | 4 | 3 | 2 | 15 |
| C | Keep the current `black_box(ptr::from_mut(self))` laundering and strengthen comments | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — remove the protected `&mut self` receiver from the callback-running path.**
**Rationale:** The current source already knows the noalias issue: `jsc/ipc.rs:142-149` states that `dispatch_unsafe -> event_loop.run_callback` can re-enter through a fresh `&mut Self`. `black_box(ptr::from_mut(self))` forces reloads but does not remove the live receiver borrow. The EXP-026 timer fix model is the right shape: pass a raw owner and create statement-scoped `&mut` references only in spans that do not call JS.
**Proves-original-UB:** EXP-099 source-shaped Tree-Borrows witness (`phase5_experiment_results/EXP-099.log`) rejects re-entry into `child_singleton()` while `flush(&mut self)`'s protected tag is live.
**Proves-new-soundness:** add an EXP-099-fix model where `flush_raw(this: *mut Self)` takes `messages` and calls callbacks without any call-frame `&mut self`; Miri Tree-Borrows should run clean. Source-side, compile grep should show no `flush(&mut self)` path that invokes `event_loop.run_callback`.
**Bundle with:** EXP-026 timer re-entry receiver cleanup; both are the same "callback-running method must not take `&mut self`" remediation family.

---

### R-EXP-100: `UpgradedDuplex` / `SSLWrapper` callback receiver re-entry

**Finding:** EXP-100, MUST-BE-UB Tree-Borrows model, `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599` plus opaque safe shims in `src/uws_sys/lib.rs:191-201`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (SSLWrapper callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Port `UpgradedDuplex` to the already-present `ProxyTunnel` pattern: raw owner pointer entry, wrapper-field-only accessors for wrapper calls, disjoint-field `addr_of!` accessors inside SSLWrapper callbacks, no whole-struct `&mut UpgradedDuplex` callback while `&mut SSLWrapper` is live. | 5 | 5 | 3 | 5 | 5 | **23** |
| B | Change only `close`/`shutdown` to raw-owner functions and leave `flush`/`receive_data`/`start_tls` as `&mut self` | 3 | 5 | 4 | 3 | 3 | 18 |
| C | Add a `WRAPPER_BUSY` guard like WindowsNamedPipe but keep whole-struct `&mut` callback bodies | 2 | 4 | 4 | 3 | 2 | 15 |

**Winner:** **A — copy the `ProxyTunnel` disjoint-field design.**
**Rationale:** `src/http/ProxyTunnel.rs:97-180` and `:222-230` already document the exact invariant `UpgradedDuplex` needs: SSLWrapper callbacks are invoked while the caller holds `&mut SSLWrapper`, so callbacks must not materialize `&mut Parent` and must touch only fields disjoint from `wrapper`. `UpgradedDuplex` currently does the opposite: callbacks at `:101-146` materialize `&mut UpgradedDuplex`, and `on_close` tears down `self.wrapper`.
**Proves-original-UB:** EXP-100 Tree-Borrows witness (`phase5_experiment_results/EXP-100.log`) rejects the callback write through re-entered `&mut UpgradedDuplex` while `close(&mut self)`'s protected tag is live.
**Proves-new-soundness:** add an EXP-100-fix model where `close_raw(this: NonNull<Self>)` projects only `wrapper`, and callbacks project only disjoint fields. The fixed model should run clean under `-Zmiri-tree-borrows`.
**Bundle with:** EXP-026 and EXP-099 callback-running receiver cleanup.

---

### R-EXP-101: `ProxyTunnel::shutdown(&mut self)` leftover receiver re-entry

**Finding:** EXP-101, MUST-BE-UB Tree-Borrows model, `src/http/ProxyTunnel.rs:707-711` with live callers at `src/http/lib.rs:1347-1355` and `src/http/HTTPContext.rs:692-700`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (SSLWrapper callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Delete/privatize `shutdown(&mut self)` and route both live callers through a raw-owner `shutdown_raw(this: NonNull<Self>)` / existing `close_raw` path. | 5 | 5 | 4 | 5 | 5 | **24** |
| B | Keep `shutdown(&mut self)` but make it capture `NonNull<Self>` and never use `self` again before calling raw `shutdown_raw`. | 4 | 5 | 4 | 4 | 3 | 20 |
| C | Leave the method and rely on the fact callbacks do not form `&mut ProxyTunnel`. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — remove the old receiver API from live call paths.**
**Rationale:** EXP-101 proves that the callbacks' disjoint-field discipline is sound on the raw-owner path and unsound under a protected whole-struct receiver. `ProxyTunnel` already has the necessary building blocks (`wrapper_mut`, `close_raw`, disjoint-field accessors); the remaining work is to stop calling the stale `shutdown(&mut self)` wrapper.
**Proves-original-UB:** EXP-101 bad-path Tree-Borrows witness (`phase5_experiment_results/EXP-101.log`) rejects a callback raw-field write while `shutdown(&mut self)`'s protected tag is live.
**Proves-new-soundness:** EXP-101 good-path control (`phase5_experiment_results/EXP-101-good.log`) runs clean when the same callback field writes happen through raw-owner `close_raw`.
**Bundle with:** EXP-100; do not cite ProxyTunnel as fully cleaned until both UpgradedDuplex copies the pattern and ProxyTunnel's own leftover receiver path is removed.

---

### R-EXP-102: `ProxyTunnel::write(&mut self, buf)` leftover receiver re-entry

**Finding:** EXP-102, MUST-BE-UB Tree-Borrows model, `src/http/ProxyTunnel.rs:768-775` with live callers at `src/http/lib.rs:2876-2888` (`RequestStage::ProxyBody`) and `src/http/lib.rs:2913-2947` (`RequestStage::ProxyHeaders`).
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (SSLWrapper callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Delete/privatize `write(&mut self, buf)` and route both live callers through `write_raw(this: NonNull<Self>, buf: &[u8]) -> Result<usize, Error>`, projecting only the wrapper field before calling `SSLWrapper::write_data`. | 5 | 5 | 4 | 5 | 5 | **24** |
| B | Keep `write(&mut self, buf)` as a thin wrapper that immediately captures `NonNull<Self>` and delegates to `write_raw` without touching `self` again. | 4 | 5 | 4 | 4 | 3 | 20 |
| C | Leave the method and rely on callbacks touching only disjoint fields. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — remove the old receiver API from live request-body/header paths.**
**Rationale:** EXP-102 proves that disjoint-field callbacks are only sufficient when the entry path is also raw-owner. `SSLWrapper::write_data` can synchronously run `handle_traffic`, which reaches `write_encrypted` / close callbacks while the `write(&mut self)` receiver protector is still live. The existing `wrapper_mut` / disjoint-field accessors already provide the pieces for `write_raw`.
**Proves-original-UB:** EXP-102 bad-path Tree-Borrows witness (`phase5_experiment_results/EXP-102.log`) rejects a callback raw-field write while `write(&mut self)`'s protected tag is live.
**Proves-new-soundness:** EXP-102 good-path control (`phase5_experiment_results/EXP-102-good.log`) runs clean when the same callback writes happen through raw-owner `write_raw`.
**Bundle with:** EXP-101; both are stale `ProxyTunnel` receiver wrappers around the same otherwise-good raw-owner / disjoint-field callback design.

---

### R-EXP-103: `ProxyTunnel::on_writable(&mut self)` / `receive(&mut self, ...)` raw-capture-first receiver re-entry

**Finding:** EXP-103, MUST-BE-UB Tree-Borrows model, `src/http/ProxyTunnel.rs:714-749,752-765` with live callers at `src/http/lib.rs:2754-2755` (`on_writable`) and `src/http/lib.rs:3254-3258` (`receive`).
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (SSLWrapper callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Delete/privatize both receiver wrappers and route callers through `on_writable_raw(this: NonNull<Self>, socket)` / `receive_raw(this: NonNull<Self>, buf)`, projecting only the wrapper field before `SSLWrapper::flush` / `receive_data`. | 5 | 5 | 4 | 5 | 5 | **24** |
| B | Keep the public methods as thin wrappers that immediately capture `NonNull<Self>` and delegate to raw-owner functions without any further `self` use. | 4 | 5 | 4 | 4 | 3 | 20 |
| C | Leave the methods and rely on the local "raw pointer captured before this line" comment. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — remove the old receiver APIs from live writable/receive paths.**
**Rationale:** EXP-103 proves the subtle point that `NonNull::from(&mut *self)` at method entry does not end the `&mut self` receiver protector. The same raw field writes are accepted when the entry path is raw-owner, so the fix is mechanical: move `on_writable` / `receive` to raw-owner entry points matching the existing callback discipline.
**Proves-original-UB:** EXP-103 bad-path Tree-Borrows witnesses (`phase5_experiment_results/EXP-103-on-writable.log`, `phase5_experiment_results/EXP-103-receive.log`) reject callback field writes while the corresponding receiver tags are live.
**Proves-new-soundness:** EXP-103 raw-owner controls (`phase5_experiment_results/EXP-103-on-writable-good.log`, `phase5_experiment_results/EXP-103-receive-good.log`) run clean with the same callback field writes.
**Bundle with:** EXP-101 and EXP-102; all four stale `ProxyTunnel` receiver wrappers should be removed in one PR so the type can be accurately cited as the raw-owner / disjoint-field fix model.
**Non-counted sibling cleanup:** `ProxyTunnel::close(&mut self, err)` at `src/http/ProxyTunnel.rs:677-681` has the same raw-capture-first wrapper shape but no live in-tree caller was found. Remove or privatize it in the same PR so it cannot become the next stale entry path; do not increment the confirmed-finding count for it without a live caller or separate witness.

---

### R-EXP-104: `WindowsNamedPipe` `WRAPPER_BUSY` receiver-protector gap

**Finding:** EXP-104, MUST-BE-UB Tree-Borrows model, `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238` plus generated receiver thunk shape in `src/jsc_macros/lib.rs:828-843`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (SSLWrapper callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Keep `WRAPPER_BUSY`, but change all callback-driving WindowsNamedPipe SSLWrapper entry points to raw-owner functions (`NonNull<Self>` / `*mut Self`): exported C ABI thunks should not first materialize `&mut Self`, and internal receive/start helpers should not hold whole-struct `&mut self` across SSLWrapper entry. Callbacks then use disjoint-field raw projections where needed. | 5 | 5 | 3 | 4 | 5 | **22** |
| B | Add more `black_box(ptr::from_mut(self))` laundering while keeping generated `&mut self` receivers. | 1 | 5 | 4 | 2 | 1 | 13 |
| C | Keep `WRAPPER_BUSY` as the only guard and document single-threaded Windows IPC. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — preserve the UAF guard, change the receiver shape.**
**Rationale:** `WRAPPER_BUSY` solves a real, separate problem: it defers `self.wrapper = None` while a raw pointer into the wrapper payload is executing. EXP-104 proves that a protected whole-struct `&mut self` receiver is still a Tree-Borrows problem even when wrapper teardown is deferred. The remediation is not to remove the guard; it is to stop entering callback-capable `SSLWrapper` operations through exported `#[uws_callback]` thunks or internal helpers while such a receiver remains live.
**Proves-original-UB:** EXP-104 bad-path witnesses (`phase5_experiment_results/EXP-104-flush.log`, `phase5_experiment_results/EXP-104-receive.log`) reject representative `ssl_write` / `ssl_on_close` reborrows while the `flush_bad(&mut self)` / `receive_bad(&mut self)` receiver tags are protected. `flush_bad` is the generated-export representative; `receive_bad` is the internal receive-path representative. Other listed WindowsNamedPipe SSLWrapper-driving methods are same-shape remediation scope, not separately Miri-proven one by one.
**Proves-new-soundness:** EXP-104 raw-owner controls (`phase5_experiment_results/EXP-104-flush-good.log`, `phase5_experiment_results/EXP-104-receive-good.log`) run clean with identical callback writes and identical `WRAPPER_BUSY` deferral.
**Bundle with:** EXP-100 UpgradedDuplex and EXP-101/102/103 ProxyTunnel stale-wrapper cleanup; all are the same SSLWrapper callback-receiver family. Also flip the streaming-writer `impl_streaming_writer_parent!(borrow = mut)` site to raw mode in the same WindowsNamedPipe PR if the diff stays reviewable.

---

### R-EXP-106: `PipeWriter` completion callbacks re-enter `writer.with_mut`

**Finding:** EXP-106, MUST-BE-UB Tree-Borrows model, `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; concrete parent exemplar `src/runtime/webcore/FileSink.rs:463-531`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (FFI/libuv callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Convert callback-running writer completion/error paths to raw-owner helpers (`on_write_complete_raw(this: *mut Self, ...)`, `_on_write_raw(this: *mut Self, ...)`) and keep parent callbacks on raw `*mut Parent`. Create `&mut Self` only in statement-scoped spans that do not call parent/JS/libuv callbacks. | 5 | 5 | 3 | 4 | 5 | **22** |
| B | Keep `&mut self` receivers and rely on `black_box(ptr::from_mut(self))` / `LaunderedSelf::r(this)` to reload fields after parent callbacks. | 1 | 5 | 5 | 2 | 1 | 14 |
| C | Convert `FileSink` parent dispatch away from `writer.with_mut` while leaving other `PipeWriter` parents unchanged. | 3 | 4 | 3 | 3 | 2 | 15 |

**Winner:** **A — raw-owner writer completion paths.**
**Rationale:** `borrow = ptr` on `FileSink` is the right parent mode and should stay. The bug is one layer lower: the writer completion method itself starts with a protected `&mut self` receiver and then calls a parent callback that can re-enter the same intrusive writer. EXP-106 proves `black_box` does not remove that protected tag; the raw-owner control passes with the same parent callback write.
**Proves-original-UB:** `phase5_experiment_results/EXP-106-bad.log` rejects the parent callback write through `writer.with_mut` while the writer completion receiver tag is protected.
**Proves-new-soundness:** `phase5_experiment_results/EXP-106-good.log` passes the same parent callback write when the completion path starts from a raw owner.
**Bundle with:** EXP-099/100/101/102/103/104 callback-running receiver cleanup. This can be a separate PR if the PipeWriter diff is nontrivial; do not regress the existing `FileSink` `borrow = ptr` parent-provenance fix.

---

### R-EXP-107: `RareData` watcher cleanup re-enters watcher vectors

**Finding:** EXP-107, MUST-BE-UB Tree-Borrows model, `src/jsc/rare_data.rs:864-891`; registration/removal edges `src/runtime/node/node_fs_watcher.rs:997,1130-1135`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (JS callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Change `close_all_watchers_for_isolation` to a raw-owner helper (`unsafe fn close_all_watchers_for_isolation_raw(this: *mut RareData)`) and call it from `VirtualMachine::swap_global_for_test_isolation` after deriving the raw pointer from `rare_data.as_deref_mut()`. Keep each vector pop in a statement-scoped borrow before the callback. | 5 | 5 | 4 | 5 | 5 | **24** |
| B | Keep `&mut self` and rely on `black_box(ptr::from_mut(self))` before and after close callbacks. | 1 | 5 | 5 | 2 | 1 | 14 |
| C | Prevent watcher registration during isolation close with a runtime boolean guard. | 3 | 4 | 3 | 3 | 3 | 16 |

**Winner:** **A — raw-owner cleanup loop.**
**Rationale:** The source comment already documents the re-entry: watcher close can run JS and push back into the same vectors. EXP-107 proves `black_box` handles optimizer stale loads but not the receiver protector. A raw-owner helper is isomorphic to the EXP-012/106 fix model and preserves the "close newly-added watchers until empty" behavior.
**Proves-original-UB:** `phase5_experiment_results/EXP-107-bad.log` rejects the re-entrant watcher push while `close_all_watchers_for_isolation(&mut self)`'s receiver tag is protected.
**Proves-new-soundness:** `phase5_experiment_results/EXP-107-good.log` passes the same re-entrant push when the loop starts from a raw owner.
**Bundle with:** EXP-108 if touching core JSC event-loop/test-isolation callback paths together; otherwise it is a small standalone patch.

---

### R-EXP-108: `EventLoop::run_callback` / `run_callback_with_result` re-enter the same loop

**Finding:** EXP-108, MUST-BE-UB Tree-Borrows model, `src/jsc/event_loop.rs:455-507`; host exports `src/jsc/event_loop.rs:1147-1186`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (JS callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Introduce raw-owner callback runners (`run_callback_raw(loop: *mut EventLoop, ...)`, `run_callback_with_result_raw(...)`) and have host exports / callback-driving call sites use them. Keep `enter()` / `exit()` statement-scoped around the JS call without a function-frame `&mut self` receiver. | 5 | 5 | 3 | 4 | 5 | **22** |
| B | Make `entered_event_loop_count` and every field touched during callback re-entry explicit interior mutability, then keep `&self` callback runners. | 4 | 4 | 2 | 2 | 3 | 15 |
| C | Keep current `&mut self` receivers and rely on `black_box` around `callback.call`. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — raw-owner event-loop callback runners.**
**Rationale:** The source comment states that JS callbacks can re-enter through `vm.event_loop()` and run nested `enter()/exit()` pairs. EXP-108 proves the outer `&mut self` receiver is the problem. Rewriting only the callback-running entry points is smaller than making the whole event loop cell-like.
**Proves-original-UB:** `phase5_experiment_results/EXP-108-bad.log` rejects the nested fresh `&mut EventLoop` while `run_callback(&mut self)`'s receiver tag is protected.
**Proves-new-soundness:** `phase5_experiment_results/EXP-108-good.log` passes the same nested `enter()/exit()` when the outer runner starts from a raw owner.
**Bundle with:** EXP-073/084 only conceptually. EXP-108 is a single-threaded callback-receiver fix; EXP-073 and EXP-084 have different source mechanisms and should stay separate PR scopes unless maintainers choose a broad EventLoop/VM provenance cleanup.

---

### R-EXP-110: h2 `Stream::queue_frame` write callbacks re-enter the same stream

**Finding:** EXP-110, MUST-BE-UB Tree-Borrows model, `src/runtime/api/bun/h2_frame_parser.rs:1850-1981`; callback dispatch `:2626-2628`; live call sites `:5594`, `:5637-5646`.
**Shape:** Shape 1 (aliasing), Shape 15 (receiver lifetime/protector escape), Shape 21 (JS callback re-entry).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Change callback-dispatching `Stream::queue_frame` paths to a raw-owner helper (`queue_frame_raw(stream: *mut Stream, client: &H2FrameParser, ...)`). Create statement-scoped `&mut Stream` borrows only around queue operations that do not call `dispatch_write_callback`. | 5 | 5 | 3 | 4 | 5 | **22** |
| B | Keep `&mut self`, but make `client.streams` lookup return an interior-mutability wrapper for each stream. | 3 | 4 | 2 | 2 | 3 | 14 |
| C | Keep current receiver and rely on `black_box(ptr::from_mut(self))` around callback dispatch. | 1 | 5 | 5 | 2 | 1 | 14 |

**Winner:** **A — raw-owner `queue_frame` for callback-dispatching branches.**
**Rationale:** The source comment already names the re-entry route: `dispatch_write_callback()` can run JS, call h2 host functions such as `writeStream`, look this same stream up from `client.streams`, and reach `queue_frame()` again. EXP-110 proves `black_box` does not remove the original `&mut Stream` receiver protector. The raw-owner control passes with the same queue mutation before callback, same callback re-entry, and same post-callback queue mutation.
**Proves-original-UB:** `phase5_experiment_results/EXP-110-bad.log` rejects the callback's fresh `&mut Stream` while `queue_frame(&mut self)`'s receiver tag is protected.
**Proves-new-soundness:** `phase5_experiment_results/EXP-110-good.log` passes the same re-entrant queue mutation when the outer queue-frame path starts from a raw owner.
**Bundle with:** S4 / EXP-012 callback-running receiver cleanup. This can be a targeted h2 PR if maintainers want to keep runtime/JSC and h2 changes reviewable.

---

### R-EXP-038: `AnyTaskJob::run_task` panic policy (panic-safety)

**Finding:** EXP-038, `NO_EVIDENCE` for current production UB under Bun's `panic = "abort"` profiles, with a retained unwind-enabled regression witness, `src/jsc/any_task_job.rs:141-153`.
**Shape:** Shape 11 (panic from drop / panic across FFI boundary).

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Document that panics inside `C::run` abort the process; keep `panic = "abort"` as the invariant and add a regression note pointing to EXP-038 if a future profile enables unwinding | 4 | 4 | 4 | 4 | 4 | **20** |
| B | Wrap `run_task` body in `std::panic::catch_unwind(AssertUnwindSafe(...))`; on `Err`, forward via `bun_core::output::panic` and still enqueue the JS-side completion with an error result | 2 (contradicts current project-wide panic-abort policy) | 4 | 4 | 3 | 2 | 15 |
| C | Add a panic-handling layer one level up in `bun_threading::ThreadPool` | 2 (same policy mismatch, wider blast radius) | 4 | 3 | 3 | 2 | 14 |

**Winner:** **A — document/enforce the existing panic-abort contract.**
**Rationale:** Root `Cargo.toml` sets `panic = "abort"` for dev and release, and `bun_core` / `crash_handler` document that `catch_unwind` is unreachable. The Phase-5 reproducer demonstrates the leak and Drop-skip only under a standalone `panic = "unwind"` model. Adding `catch_unwind` locally is the wrong shape unless Bun deliberately changes the global panic policy.
**Runners-up:** B is only appropriate for an unwind-enabled test/profile.
**Proves-original-bug:** EXP-038 now proves a regression hazard, not current production UB.
**Proves-new-soundness:** keep a profile check in CI / docs: this path assumes `panic = "abort"`; if any supported profile enables unwinding, reopen EXP-038 and land the wrapper.

---

### R-EXP-039: `Listener.rs ptr::read → mem::forget` panic-window regression guard (2 live panic-prone sites)

**Finding:** EXP-039, `NO_EVIDENCE` for current production UB under Bun's `panic = "abort"` profiles; confirmed unwind-model double-drop witness for `src/runtime/socket/Listener.rs:235, 317`. Earlier `:1069/:1289` coverage was an overcount: those connect-path sites only `Option::take()` before `mem::forget` and do allocation-prone `take_protos()` later.
**Shape:** Shape 11 (panic-during-`mem::forget` window leaves struct double-dropped) as a regression guard if Bun ever supports unwinding here.

| ID | Description | Correctness | Perf | Diff | Reviewability | Maintainability | Total |
|----|-------------|------------:|-----:|-----:|--------------:|----------------:|------:|
| A | Reorder: do all panic-prone `take_protos()` work **before** the `ptr::read`. Then `ptr::read` + `mem::forget` are infallible under an unwind-enabled model | 4 | 4 | 4 (mechanical at 2 sites) | 4 | 4 | **20** |
| B | Use `ManuallyDrop<SocketConfig>` instead of `mem::forget`; `ManuallyDrop::take` is the canonical pattern | 4 | 4 | 3 (changes the field type + every consumer) | 4 | 4 | 19 |
| C | Wrap the unwind window in `catch_unwind` and re-panic after `mem::forget` | 3 (still leaks bytes inside `Handlers` if ssl.take panics) | 4 | 3 | 3 | 3 | 16 |

**Winner:** **A — no production fix required while panic-abort is policy; if unwind is enabled, reorder so panic-prone ops happen first.**
**Rationale:** Surgical fix if needed; preserves the existing types. Today the production guarantee is the project-wide `panic = "abort"` profile, same as EXP-038.
**Runners-up:** B is more "Rusty" but a bigger refactor.
**Proves-original-UB:** EXP-039 source-faithful panic witness (`phase5_experiment_results/EXP-039-Listener.log`) double-drops the moved `Handlers` field after `take_protos` panics in an unwind-enabled model.
**Proves-new-soundness:** new EXP-039-fix — same harness with reordered code; expect single-Drop, no double-free.

---

### R-EXP-012 (RESOLVED — keep as exemplar)

**Finding:** EXP-012, RESOLVED, `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637`.
**Shape:** Bucket 21 (canonical fix-model — `*mut Self` + `ThisPtr` + `ref_guard`).

**No remediation needed; this is the canonical exemplar that S4 propagates to EXP-026, EXP-044, F-21-2.** Phase 11 should add a lint or doctest that asserts the pattern stays in place across future refactors.

---

## Per-finding-class summary

| Class | Convergence | Recommended winner |
|-------|-------------|--------------------|
| Bucket-4 / Bucket-6 validity-bearing disk / FFI bytes (EXP-003, EXP-006, EXP-035, EXP-036, EXP-051, EXP-097) | Disk/FFI byte surfaces converge on `#[repr(transparent)] struct + try_from / CheckedBitPattern`; EXP-036 is a `bool` bit-pattern bug, not an enum transmute; errno safe `from_raw` converges on checked conversion inside the existing safe function | manual `try_from` for FFI surfaces and errno; bytemuck::CheckedBitPattern internally |
| Bucket-5 MaybeUninit-as-init (EXP-001, EXP-005, EXP-034, EXP-089) | EXP-001/005/034 converge on `vec![default(); n]` zero-init or `MaybeUninit::write` per-element; EXP-089 specifically converges on either zero-initialized scratch arrays or keeping scratch storage wrapped in `MaybeUninit<[T; N]>` until an initialized prefix is exposed. | `vec![default(); n]` / per-element write for collections; `MaybeUninit` wrapper or zeroed arrays for scratch buffers |
| Bucket-14 const→mut count writes (EXP-041 + 10 A14-A siblings) | All 11 converge on `Cell<usize>` or `AtomicUsize` (Relaxed) | `AtomicUsize` (defends future Sync) |
| Bucket-14 `&T → &mut T` forgery (EXP-042, EXP-043) | Both converge on restore-the-lint + fix-call-sites | restore `#[deny(invalid_reference_casting)]` |
| Bucket-1/14 shared-event-loop mutation (EXP-073) | Converges on storing raw VM-owned event-loop backrefs in async heap objects; sibling `WriteFileWindows` is the exact template | `*mut EventLoop` in `CopyFileWindows` |
| Bucket-1/14 timer parent/timer shared-provenance write (EXP-074) | Converges on not deriving mutable `EventLoopTimer.state` writes from `&TimerObjectInternals` | raw parent/timer provenance for state writes, or `Cell<EventLoopTimerState>` |
| Bucket-1 callback `&mut Self` re-entry (EXP-026, EXP-044, EXP-099, EXP-100, EXP-101, EXP-102, EXP-103, EXP-104, EXP-106, EXP-107, EXP-108, EXP-110, F-21-2) | All converge on EXP-012 / raw-owner fix-models: callback-running methods must not carry `&mut self` across re-entry, and callbacks must not materialize a whole-struct `&mut Parent` / intrusive child overlapping a live receiver or field borrow. ProxyTunnel and WebSocketProxyTunnel contain the right pattern, but EXP-101/102/103 prove ProxyTunnel's old `shutdown(&mut self)`, `write(&mut self, buf)`, `on_writable(&mut self, ...)`, and `receive(&mut self, ...)` paths still need migration; EXP-104 proves WindowsNamedPipe's `WRAPPER_BUSY` guard must be paired with raw-owner entry points; EXP-106 proves the same issue one layer down in PipeWriter completion callbacks; EXP-107/108/110 extend the same rule to `RareData` watcher cleanup, the core `EventLoop` callback runner, and h2 `Stream::queue_frame` write callbacks. | `*mut Self` / `NonNull<Self>` + `ThisPtr` / `ref_guard` where intrusive lifetime is involved; disjoint-field raw projections where the parent owns an inline callback field |
| Bucket-1 parallel-callback aliasing (EXP-010 5-site cluster + EXP-111 `Chunk` subcase) | Converges on EXP-012 fix-model with disjoint-column SAFETY discipline. EXP-111 sharpens this: the fix must stop forming concurrent whole-owner `&mut LinkerContext` / `&mut Chunk` in part-range workers; `CompileResultSlots` and atomic counters are valid narrow write paths, not a justification for whole-struct `&mut`. | granular shared worker views + raw/interior-mutable disjoint writes |
| Bucket-2 strict-provenance (EXP-020, EXP-029, EXP-048, EXP-049, EXP-050, EXP-096 + ~10 F-P sites) | Strict-provenance witnesses are confirmed, but not counted as default-runtime UB. `URL::host_with_path` has a cheap local provenance-preserving subslice fix; `TaggedPtr` converges on S2; `EnvStr`, `StringOrTinyString`, `ZigString`, and `SmolStr` need separate provenance-carrying representation rewrites or explicitly interim exposed-provenance annotations. | EXP-020 subslice fix; centralised TaggedPtr fix; EXP-029/049/050/096 representation rewrites |
| Bucket-3/20 typed-slice / Vec-layout reinterpretation (EXP-004 + EXP-088 + EXP-091 + EXP-092 + EXP-093 + EXP-095) | Reinterpreting byte storage as wider typed storage or converting raw slices into owned Vecs must preserve both allocator layout and the full retagged byte range. `Vec<u8>→Vec<u16>` converges on allocate-and-copy; `E::String` UTF-16 converges on typed UTF-16 storage or explicit full-byte-length accounting; `BindgenArray` converges on exact allocation-layout reuse only, fresh allocation otherwise; `ReadResult` converges on explicit owned-token vs borrowed-slice variants; PE and Mach-O object-file parsing/editing converge on unaligned value loads / byte-copy parsing or explicit alignment rejection. | allocate/copy for owned Vec; typed or full-byte-length representation for AST UTF-16; allocation-layout gate for `BindgenArray`; explicit owned token for `ReadResult`; unaligned PE/Mach-O parse/edit helpers |
| Bucket-1/15 intrusive raw-pointer collections (EXP-094 + F-A-2 cousin) | Intrusive data structures that store raw pointers derived from caller-owned `&mut node` values must not allow callers to re-mint mutable references while the structure still uses old tags. `DoublyLinkedList<T>` fails in its own Miri test; `from_field_ptr!` parent-recovery is the broader cousin class. | delete if unused; otherwise pinned intrusive adapter or ownership redesign |
| Bucket-7/8 unbounded `unsafe impl Send/Sync` / erased handles (EXP-019 + EXP-045 + EXP-080 + EXP-082 + EXP-083 + EXP-084 + EXP-098 + EXP-111 + F-S-2/3, with EXP-047 hardening-only) | `StoreSlice<T>`, `JsCell<T>`, `AtomicCell<T: Copy>`, bundler `Chunk`/`Renamer`, `Blob: Send + Sync`, shell `IOWriter` / `IOReader: Sync`, and `VirtualMachine: Send + Sync` plus safe TLS-backed mutation are confirmed at the generic safe-API level. They converge on bounded impls or type splits that keep thread-affine / single-threaded payloads from crossing threads; `ThreadCell` / `RacyCell` production instantiations stay payload-audit / naming-hardening only after EXP-047's safe-boundary correction; `SendPtr<T>` siblings are preventive hardening unless a misuse witness appears; `link_interface!` handle forging is a macro-level safe-API defect, fixed by private fields. EXP-111 also belongs to the Bucket-1 fan-out cleanup: changing the renamer type without removing concurrent whole-`Chunk` / whole-`LinkerContext` `&mut` worker entries is not sufficient. EXP-099 is intentionally not counted as a generic `RacyCell` defect: it is a concrete safe `&mut` singleton + re-entrant receiver defect. | bounded auto-trait impls + payload audit; JS-affine/data payload split; non-`Sync` shell IO handles; checked or unsafe VM mutation accessors; private erased-handle fields; raw/guard-scoped singleton callback APIs |
| Bucket-8 task-wrapper laundering (EXP-046) | Synthetic owned-context witness confirms the hazard class; production `WorkTask` / `ConcurrentPromiseTask` need per-context classification before a live-UB fix lands | add `C: Send` bounds where source-compatible; otherwise split raw-pointer wrappers from owned-context wrappers |
| Bucket-15 escaped `&'static mut` writer (EXP-058) | Closure-scoped writer helpers or `WriterGuard<'_>` prevent two simultaneous `&mut Writer` handles | `with_*_writer` first, guard if needed |
| Bucket-15 safe lifetime escape (EXP-057 + EXP-058 + EXP-079 + EXP-081 + EXP-087) | Caller-chosen `&mut` from shared/singleton accessors and duplicate worker handles converge on raw-pointer or closure/guard-scoped APIs. Lifetime-erased iterator entries converge on owned-result or explicit-lifetime APIs. Keep statement-sized reborrows explicit at the use site; do not expose safe `&'static mut` or borrowed scratch buffers as owned results. | raw pointer / `NonNull` accessor, closure-scoped writer / worker API, owned iterator result, or explicit lifetime parameter |
| Bucket-15 lifetime-erased arena result types (EXP-077 + EXP-021 family) | `CssModuleExports` / `References` and AST store wrappers both converge on making the arena lifetime explicit, with owned-copy fallback only where JS/API consumers need data after arena reset | lifetime-thread result/store types; owned-copy fallback |
| Bucket-11 panic-safety (EXP-038, EXP-039, EXP-040) | Document/enforce Bun's `panic = "abort"` contract for EXP-038 and EXP-039, keep EXP-039's two-site reorder as an unwind-regression guard, and add an `initialized` / `Option` guard before any reclaim-on-unwind fix for EXP-040 | Shape 11 default per case |

---

## Recommended PR sequencing for Bun maintainers

Local-only authoring; **no GitHub push without explicit per-action authorization** (per `phase0_run.json`).

1. **PR #30765 (already open)** — request maintainer review + merge. Closes EXP-002, EXP-018, EXP-019. Add an immediate errno follow-up for EXP-097 (or fold it into the same errno patch if rebasing the PR). Immediately follow with EXP-045 (`JsCell<T>` bounded impls), EXP-098 (`AtomicCell<T: Copy>` auto-trait bound), EXP-010/EXP-111 (bundler part-range worker view split + shared renamer/no-compress follow), and the callback-receiver cleanup cluster EXP-026 + EXP-099 + EXP-100 + EXP-101 + EXP-102 + EXP-103 + EXP-104 + EXP-106 + EXP-107 + EXP-108 + EXP-110; leave F-S-2/3 `SendPtr<T>` as hardening unless a misuse witness appears.
2. **CopyFileWindows event-loop pointer normalization** — PR per S7 / R-EXP-073. One field type change to match `WriteFileWindows`; closes a default-Miri + Tree-Borrows-confirmed aliasing bug.
3. **Timer parent/timer provenance normalization** — PR per S8 / R-EXP-074. Small timer-internals API cleanup; closes a default-Miri + Tree-Borrows-confirmed aliasing bug.
4. **DevServer deferred-request backref provenance** — PR per S9 / R-EXP-075. One-line pointer-origin fix; closes a default-Miri + Tree-Borrows-confirmed aliasing bug.
5. **WindowsNamedPipe VM enqueue narrowing** — PR per R-EXP-076. Replace the whole-VM mutable receiver with event-loop enqueue projection; closes a default-Miri + Tree-Borrows-confirmed aliasing bug.
6. **Mechanical Bucket-14 cluster fix** — PR per Cluster A14-A (12 sites × `Cell<usize>` / `AtomicUsize`). Closes EXP-041 + 10 siblings.
7. **Mechanical EXP-012 / raw-owner callback-receiver propagation** — PR per S4 site (timer, bundle_v2, WindowsNamedPipe, UpgradedDuplex, ProxyTunnel shutdown/write/on_writable/receive, PipeWriter completion/error paths, RareData watcher cleanup, EventLoop callback runners, h2 stream queue callbacks). Closes EXP-026, EXP-044, EXP-099, EXP-100, EXP-101, EXP-102, EXP-103, EXP-104, EXP-106, EXP-107, EXP-108, EXP-110, and hardens F-21-2.
8. **`from_field_ptr!` macro mode flip** — PR per S3. Closes/hardens the still-risky F-A-2 sites; EXP-028 is already `NO_EVIDENCE` for current production source because canonical `DirectoryWatchStore` uses raw parent recovery. F-A-12 is already demoted for aliasing and should be handled, if at all, through the F-P-9 strict-provenance track.
9. **TaggedPtr centralised fix** — PR per S2. Hardens EXP-048 / F-P-4 and true `TaggedPtrUnion` callers. Treat F-P-1/F-P-2/F-P-3/F-P-8/F-P-9/F-P-10/F-P-11/F-P-12 as related per-site strict-provenance migrations, not as closed by the one helper. Do not market any of this family as default-runtime UB unless strict-provenance is adopted as a release gate.
10. **Lockfile validity hardening** — PR per S6 + R-EXP-003 + R-EXP-006 + R-EXP-007. Closes EXP-003, EXP-006, EXP-007, EXP-036.
11. **Scratch-buffer initialization fix** — PR per R-EXP-089. Emergency path: revert to zeroed arrays; performance path: wrap storage in `MaybeUninit<[T; N]>` and expose initialized prefixes only. Closes immediate construction UB in broad utility constructors.
12. **Public-FFI BunLoader fix** — PR per R-EXP-051 with `/multi-model-triangulation` review first.
12a. **Safe errno `from_raw` cleanup** — PR per R-EXP-097 if not bundled with EXP-002; replace unchecked transmute bodies with checked conversion inside the safe function.
12b. **Bounded auto-trait cleanup** — PR per R-EXP-098 plus the renamer half of R-EXP-111 if not bundled with the bundler fan-out cleanup; align `AtomicCell` `Send`/`Sync` with `T: Atom`, and complete the `Chunk`/`Renamer` shared-borrow TODO only after the part-range worker path no longer forms concurrent whole-owner `&mut` references.
12c. **IPC/timer/UpgradedDuplex/ProxyTunnel/WindowsNamedPipe/PipeWriter/RareData/EventLoop/h2 callback receiver cleanup** — PR per R-EXP-099 + R-EXP-100 + R-EXP-101 + R-EXP-102 + R-EXP-103 + R-EXP-104 + R-EXP-106 + R-EXP-107 + R-EXP-108 + R-EXP-110 + EXP-026; convert callback-running `&mut self` receivers to raw-owner entry points with statement-scoped reborrows / disjoint-field projections.
13. **BindgenArray layout-gated reuse** — PR per R-EXP-091. Reuse only when the eventual `Vec<ZigType>` deallocation layout matches the original allocation layout; otherwise allocate fresh. Closes a confirmed safe generic API allocator-layout witness.
14. **ReadResult owned-slice tokenization** — PR per R-EXP-092. Split owned allocations from borrowed raw slices so pointer inequality no longer implies heap ownership.
15. **PE header unaligned parse fix** — PR per R-EXP-093. Replace typed `&T` / `&[SectionHeader]` views over `Vec<u8>` with unaligned value reads/writes or explicit alignment validation.
16. **Mach-O load-command unaligned mutation fix** — PR per R-EXP-095. Use the same `read_unaligned` / `write_unaligned` discipline already used by `LoadCommand::cast<T>()` and the adjacent segment write.
17. **Deprecated intrusive-list deletion or redesign** — PR per R-EXP-094. Prefer deleting `DoublyLinkedList<T>` if unused; otherwise migrate to pinned intrusive handles or list-owned nodes.
18. **Writer lifetime escape** — PR per R-EXP-058 (`with_*_writer` / `WriterGuard<'_>`). Closes a safe-API `&'static mut` UB witness with a small, obvious API migration.
19. **ArrayLike uninit safe-API hardening** — PR per R-EXP-078. One trait signature + one caller unsafe block closes a confirmed safe-API uninitialized-read witness.
20. **Transpiler env_mut safe-API hardening** — PR per R-EXP-079. Return raw pointer / `NonNull` and force statement-scoped unsafe reborrows at call sites; closes a confirmed safe two-call aliasing witness.
21. **ThreadPool worker-access hardening** — PR per R-EXP-087. Return raw `NonNull<Worker>` first, or a closure/guard API if the call graph can absorb it; closes a confirmed safe duplicate-`&mut Worker` witness.
22. **AST UTF-16 representation hardening** — PR per R-EXP-088. Store typed UTF-16 data or full-byte-length accounting; closes a source-shaped parser/lexer representation bug.
23. **`link_interface!` field privatization** — PR per S10 / R-EXP-080. Make generated `kind` and `owner` fields private so safe code cannot bypass `unsafe fn new`; no runtime cost.
24. **Blob JS-affinity split** — PR per S11 / R-EXP-082. This is a confirmed generic safe-API contract defect; keep the PR honest by saying production off-thread reachability still needs caller classification.
25. **Shell IO non-`Sync` hardening** — PR per S12 / R-EXP-083. This is a confirmed generic safe-API contract defect; it should be a small marker-field / unsafe-impl deletion if current shell code is genuinely single-threaded.
26. **VirtualMachine safe TLS trap** — PR per S13 / R-EXP-084. Short-term: checked safe accessors or unsafe unchecked variants. Long-term: `JsThreadAffine` / narrow task handles so `&VirtualMachine` does not cross threads as an ordinary `Sync` reference.
27. **`fmt::Raw` byte-display hardening** — PR per R-EXP-085. Replace safe `from_utf8_unchecked` with byte-oriented display or checked UTF-8; classify call sites by byte source.
28. **`unsafe_assert` deletion / safe-panic conversion** — PR per R-EXP-086. Current source has no callers, so deletion is likely the cleanest patch.
29. **Panic-safety hardening** — document/enforce the R-EXP-038/R-EXP-039 `panic = "abort"` contract; only land the EXP-039 two-site reorder if Bun enables unwinding on those paths; add the EXP-040 `initialized` / `Option` pre-fix if reclaim-on-unwind is touched.
30. **POSIX dirent migration** — PR per S5 / R-EXP-081. This is confirmed safe-API UB, not a latent cross-thread-only watchlist.
31. **bun_semver bounds checking** — PR per R-EXP-008 + R-EXP-009.

Sequencing rationale: PRs 1–6 are mechanical and should be the lowest-review-friction entry points. PR 7 propagates an already-accepted callback shape; PR 8 removes a macro footgun that keeps recreating parent-recovery aliasing hazards. PRs 9–19 carry the highest user-visible impact (strict-provenance release gate, hostile-lockfile validity, scratch-buffer construction UB, native-plugin ABI, bindgen layout reuse, `ReadResult` owned-slice tokenization, PE/Mach-O object-file alignment, intrusive-list deletion/redesign, escaped writer lifetime, safe uninit trait API). Later PRs are follow-up hardening / cleanup, with EXP-082, EXP-083, EXP-084, EXP-085, EXP-086, and EXP-087 explicitly framed as generic safe-API contract fixes unless production call-site reachability is later proven; EXP-088, EXP-089, EXP-091, EXP-092, EXP-093, EXP-094, and EXP-095 are stronger because source-shaped/public-safe/in-tree test evidence hits the invalid representation/construction directly.

---

## Time budget actual: ~45 min architect pass, single agent, read-only on source.

Source-of-truth files referenced:

- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase4_unified_findings.md` (182-row synthesis + 13 structural fix points)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` (106-entry registry; EXP-001..EXP-111 with EXP-022..025 intentionally unused and EXP-105 reserved for non-counted support-model logs; EXP-109 is NO_EVIDENCE after source-root-graph correction)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase3_dynamic_findings.md` (Path-(a) Miri verdicts)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase0_run.json` (constraints)
- `/home/ubuntu/.claude/skills/rust-undefined-behavior-exorcist/references/REMEDIATION-PATTERNS.md` (Shape 1–20 playbook)
