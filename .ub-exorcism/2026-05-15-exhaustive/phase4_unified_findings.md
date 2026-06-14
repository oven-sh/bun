# Phase 4 Unified Findings — Run `2026-05-15-exhaustive`

Synthesizer pass over Phase 1 inventory (21 sections, A..U), Phase 2 static
sweep (25 buckets), Phase 3 dynamic sweep path-(a) standalone reproducers,
and the current EXP registry (EXP-001..EXP-111, with EXP-022..EXP-025
intentionally unused, EXP-105 reserved for non-counted support-model logs,
and EXP-109 demoted to `NO_EVIDENCE` after source-root-graph correction;
EXP-061..EXP-071 are later
idea-wizard additions, EXP-072 is the HiveArrayFallback migration, and
EXP-073..111 are Codex follow-up probes/confirmations).

This is the deduped, cross-linked, severity-ranked single source of truth
for the run. Each row is one finding, regardless of how many Phase 1/2/3
artifacts surfaced it. Rows with `EXP-ID` populated are tracked in
`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`; rows without an `EXP-ID` are
either deferred (CONTRACTUAL-BUT-DEFENSIBLE / SUSPICIOUS) or rolled up into
an existing experiment.

**Column contract:** the `EXP-ID` column sometimes contains non-owning
cross-references such as "shape cousin of EXP-051", "EXP-060 cluster
follow-up", or "EXP-061 vehicle". In those rows, the row's `status` is the
source of truth for that row; the referenced EXP is only a remediation vehicle,
confirmed sibling, or same-shape comparator. The registry remains authoritative
for the referenced EXP's own verdict.

Severity calibration per `references/UB-TAXONOMY.md`:

- **MUST-BE-UB** — sound static analysis says this *is* UB; experiment will confirm shape
- **LIKELY-UB** — strong static signal, dynamic check is the arbiter
- **SUSPICIOUS** — pattern-match flag, may be false positive
- **CONTRACTUAL-BUT-DEFENSIBLE** — relies on caller's contract; SAFETY documented and enforced at the boundary
- **CLEAN** — reviewed and explicitly not-a-finding (kept for the marketing-grade report)

---

## Unified findings table

| F-ID | file:line(s) | bucket(s) | severity | static_tools | dynamic_tools | EXP-ID | status | one_line |
|------|--------------|-----------|----------|--------------|---------------|--------|--------|----------|
| F-001 | `src/collections/linear_fifo.rs:62-80, 115-118, 127-172` | 5, 4 | MUST-BE-UB | rg, ast-grep | Miri strict-provenance + experiments/EXP-001 | EXP-001 | CONFIRMED_UB | `assume_init_slice<T>` exposes entire `LinearFifo` backing buffer as `&[T]`; hot callers: bun_test, valkey ValkeyCommand, http callback pair |
| F-002 | `src/errno/linux_errno.rs:192` | 4, 6 | MUST-BE-UB | rg, syn-walker | Miri mirror + direct Bun-crate witness (`experiments/EXP-002-bun-errno-crate`) | EXP-002 | CONFIRMED_UB | real `bun_errno::GetErrno for usize` `transmute::<u16, SystemErrno>` bypasses sibling checked path (134/65536 valid) |
| F-003 | `src/install/lockfile/Package/Meta.rs:39-46`; lockfile read at `Package::load_fields` | 4 | MUST-BE-UB | rg, syn-walker | Miri strict-provenance + experiments/EXP-003 | EXP-003 | CONFIRMED_UB | `Meta::has_install_script` (3/256) read directly from `bun.lockb` mmap |
| F-004 | `src/runtime/webcore/encoding.rs:303-310` | 20, 6 | MUST-BE-UB | ast-grep | Miri symbolic-alignment-check + experiments/EXP-004 | EXP-004 | CONFIRMED_UB | `Vec<u8>→Vec<u16>` reinterpret triggers allocator-layout mismatch on dealloc |
| F-004b | `src/ast/e.rs:1449-1459, 1413-1424`; callers `src/js_parser/lexer.rs:2751-2752`, `src/parsers/json_lexer.rs:575-581`, `src/parsers/yaml.rs:1782-1785` | 3, 15, 11 | MUST-BE-UB (safe constructor/accessor shape) | Phase-2 alignment sweep + Codex source re-read | Miri mirror + direct Bun-crate witness (`experiments/EXP-088-bun-ast-crate`) | EXP-088 | CONFIRMED_UB | real `E::String::init_utf16` narrows a `2*N` byte `&[u16]` backing slice down to `N` bytes in `Str`, then `slice16()` retags `2*N` bytes. Miri rejects the re-expanded retag at `src/ast/e.rs:1424` even for source-shaped aligned input. |
| F-004c | `src/exe_format/pe.rs:203-220, 281-302, 315-334, 389-396, 900-920` | 3, 10, 11 | MUST-BE-UB (byte-backed PE parsing) | Phase-2 alignment sweep + Codex source re-read | Miri symbolic-alignment mirror + direct Bun-crate witness (`experiments/EXP-093`, `experiments/EXP-093-bun-exe-format-crate`) | EXP-093 | CONFIRMED_UB | PE parser helpers are documented as unaligned byte views, but callers materialise `&T` / `&[SectionHeader]` from `Vec<u8>` offsets without checking `align_of::<T>()`. The direct `bun_exe_format::PEFile::init` witness fails at `pe.rs:317` while materialising `&DOSHeader` from byte storage; the mirror witness isolates the later odd section-header typed-slice path. |
| F-004d | `src/exe_format/macho.rs:121-130, 361-403`; module contract at `src/exe_format/macho_types.rs:1-12` | 3, 10, 11 | MUST-BE-UB (byte-backed Mach-O command mutation) | Phase-2 alignment sweep + Codex Mach-O source re-read | Miri symbolic-alignment mirror + direct Bun-crate witness (`experiments/EXP-095`, `experiments/EXP-095-bun-exe-format-crate`) | EXP-095 | CONFIRMED_UB | Mach-O iterator reads load commands soundly with `read_unaligned`, but mutation paths later materialise `&mut [section_64]` / `&mut *_command` over the same byte storage. The direct `MachoFile::write_section` witness fails at `macho.rs:122` while materialising `&mut [section_64]`; the mirror witness isolates the `&mut symtab_command` path. |
| F-005 | `src/install/yarn.rs:918-925, 1401-1402` | 5, 4 | MUST-BE-UB | rg | Miri strict-provenance + ignore-leaks + experiments/EXP-005 | EXP-005 | CONFIRMED_UB | `&mut [Dependency]` over uninitialized `Vec` capacity; `DependencyVersionTag` validity-bearing field fires |
| F-005b | `src/bun_core/util.rs:997-1003, 1045-1050`; `src/install/lockfile/Tree.rs:87-91` | 5, 4, 11 | MUST-BE-UB (safe scratch-buffer constructors) | ast-grep `uninit-maybeuninit-assume-init` + Codex source re-read | Miri mirror + direct Bun-crate witness (`experiments/EXP-089-bun-core-crate`) | EXP-089 | CONFIRMED_UB | `PathBuffer::uninit`, `WPathBuffer::uninit`, and `depth_buf_uninit` call `MaybeUninit::uninit().assume_init()` for primitive arrays. Miri rejects construction itself at real `bun_core::PathBuffer::uninit`: uninitialized integer elements are not initialized values, even though every bit pattern is valid. |
| F-006 | `src/install/lib.rs:1128-1135` | 4 | MUST-BE-UB | rg | Miri strict-provenance + experiments/EXP-006 (phase3) | EXP-006 | CONFIRMED_UB (Phase 3) | `Meta::origin` (3/256) — same-shape twin of EXP-003; settled as CONFIRMED_UB in the registry |
| F-007 | `src/install/lockfile/Tree.rs:1020` | 4 | MUST-BE-UB | rg | Miri + experiments/EXP-007 | EXP-007 | CONFIRMED_UB | `get_unchecked(dep_id)` over attacker-controlled dependency ID; PUB-INSTALL-4 |
| F-008 | `src/semver/lib.rs:613` | 4 | MUST-BE-UB | rg, ast-grep | Miri strict-provenance --release + experiments/EXP-008 (phase3) | EXP-008 | CONFIRMED_UB (Phase 3) | `bun_semver::String::slice` packed (off,len) `get_unchecked` OOB; release-mode debug-assert stripped; settled as CONFIRMED_UB in the registry |
| F-009 | `src/semver/lib.rs:536-537` | 4 | MUST-BE-UB | rg, ast-grep | Miri strict-provenance --release + experiments/EXP-009 (phase3) | EXP-009 | CONFIRMED_UB (Phase 3) | `bun_semver::String::eql` same packed (off,len) shape; settled as CONFIRMED_UB in the registry |
| F-010 | `src/bundler/LinkerContext.rs:1657-1663`; `linker_context/{generateCompileResultForJSChunk.rs:54-62, generateCompileResultForCssChunk.rs:45-46, prepareCssAstsForChunk.rs:76-80}` (B-1..B-5 cluster) | 1, 7, 21 | MUST-BE-UB | ast-grep, syn-walker | Miri TB model | EXP-010 | CONFIRMED_UB (TB model) | bundler parallel-callback `&mut LinkerContext` 5-site cluster; **also a Bucket-7 cross-thread race surface** (loom prep) |
| F-010b | `src/bundler/Chunk.rs:80-84,114-134`; `linker_context/{generateCompileResultForJSChunk.rs:54-68,160-169,generateCompileResultForCssChunk.rs:38-47,generateCodeForFileInChunkJS.rs:30-35}` | 1, 7, 8 | MUST-BE-UB | deep-pass Lane B + source TODO + default-Miri retag/data-race model + Codex source-scope correction | `phase5_experiment_results/EXP-111-sb.log`; Tree-Borrows rerun is clean and documented | EXP-111 | CONFIRMED_UB | `Chunk` is `Send + Sync` and worker fan-out shares one raw chunk pointer. The confirmed default-Miri witness is the concurrent whole-`Chunk` `&mut` retag; `ChunkRenamer`'s `&mut {Number,Minify}Renamer` view is an additional source TODO, not the only root cause. Fix must remove concurrent whole-owner `&mut LinkerContext` / `&mut Chunk` worker entries and make renamer/follow lookups read-only. |
| F-011 | `src/picohttp/lib.rs:383` | 2, 14, 4 | MUST-BE-UB | rg | Miri TB model + experiments/EXP-011 | EXP-011 | CONFIRMED_UB (TB model) | picohttp NUL-write through `SharedReadOnly` provenance derived from `&[u8]` request buffer; ASM-verified |
| F-012 | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637` | 21, 1, 13 | RESOLVED | rg | code-search | EXP-012 | RESOLVED (watchpoint) | named `cancel` path already uses `*mut Self` + `ThisPtr` + `ref_guard`; **this is the canonical Bucket-21 fix-model exemplar** |
| F-013 | `src/crash_handler/lib.rs:588, 878-1342, 1657-1673`; `:1737 (SA_RESETHAND)` | 18, 11 | MUST-BE-UB (POSIX signal contract) | rg, manual source-callgraph audit | `phase5_experiment_results/EXP-013-signal-safety-source-audit.log`; `phase5_exp013_signal_safety_source_audit.md` | EXP-013 | CONFIRMED_UB | POSIX SIGSEGV/SIGILL/SIGBUS/SIGFPE handler reaches non-async-signal-safe operations (`Mutex::lock` / `try_lock`, output formatting/flush/restore, stack trace, `which`, reload process). This is a POSIX/libc contract violation, not a Miri Rust abstract-machine trace; panic hook and Windows VEH are explicitly not counted under this row. |
| F-014 | `src/collections/multi_array_list.rs:540-568`; consumers `LinkerGraph.rs:495-700`, `bundle_v2.rs:{1997,2062,2170,5270}` | 1, 12 | MUST-BE-UB | source TODO, ast-grep | Miri TB model | EXP-014 | CONFIRMED_UB | `Slice<T>: Copy` allows overlapping `ColMut` views; project-local trait drift that unsafe `split_mut` trusts |
| F-014b | `src/bun_core/deprecated.rs:114-410` | 1, 15 | MUST-BE-UB | Phase-11 full-workspace Miri path-b | In-tree unit-test failure under Miri (`basic_doubly_linked_list_test`) | EXP-094 | CONFIRMED_UB | `DoublyLinkedList<T>` stores raw pointers minted from `&mut node`; later re-minting `&mut` to an already-linked node invalidates the stored tags, and traversal reads through a stale tag. This is an in-tree unit-test failure, not a standalone-only witness. |
| F-015 | `src/collections/array_hash_map.rs:1898-1905, 2008-2014` | 15, 8 | LIKELY-UB | rg | Miri (clean for current callers) | EXP-015 | NO_EVIDENCE | `StringHashMap::put_borrowed/get_or_put_borrowed` cast `&[u8] → &'static [u8]`; lint-silenced, contract-only |
| F-016 | `src/ast/new_store.rs` + every `Vec<T, AstAlloc>` consumer | 11, 20 | RESOURCE-LEAK / STRUCTURAL-HARDENING | ast-grep, ast/arena audit, compiler `needs_drop` probe | `phase5_experiment_results/EXP-016-astalloc-enumeration.log`; `EXP-016-astalloc-enumeration-tier2.log`; `EXP-016-needs-drop.log`; `phase5_exp016_astalloc_drop_audit.md` | EXP-016 | NO_EVIDENCE | current direct `AstAlloc` payloads do not contain a soundness-critical destructor; `G::Property` needs Drop only because `TypeScript::Metadata::MDot(Vec<Ref>)` can leak. EXP-066 remains preventive hardening, not a currently proven UB fix |
| F-017 | `src/io/lib.rs:1164-1169` (store), `:870, :1020` (read); `runtime/webcore/Blob.rs:7075-7088` (close-path rewrite) | 7, 16 | HARDENING / REGRESSION-GUARD | rg, semantic audit | Miri primitive model + source-overlap audit | EXP-017 | NO_EVIDENCE | `Request::store_callback_seq_cst` primitive race model is real, but current source only writes callbacks before queue publication or after IO pop has cleared `scheduled`; no live overlapping read/write path found (`phase5_exp017_source_overlap_audit.md`) |
| F-018 | `src/threading/guarded.rs:132-134` | 8 | MUST-BE-UB (safe API / OS-contract) | rg, type audit, source-faithful compile witness | `phase5_experiment_results/EXP-018-autotrait.log`; `EXP-018-source-faithful-autotrait.log`; `phase5_exp018_guarded_lock_autotrait_audit.md` | EXP-018 | CONFIRMED_UB | `GuardedLock<…, Mutex>` missing `_not_send: PhantomData<*const ()>`; safe Rust can move a held guard to `thread::spawn`, then `Drop` calls `Mutex::unlock()` on a different OS thread. Windows SRWLOCK documents UB; Darwin aborts; Linux/futex violates Bun's own `Mutex::unlock` contract |
| F-019 | `src/ast/nodes.rs:339-340` | 8, 7, 1 | MUST-BE-UB | rg, type audit | Miri mirror + direct Bun-crate witness (`experiments/EXP-019-bun-ast-crate`) | EXP-019 | CONFIRMED_UB | `unsafe impl<T> Send/Sync for StoreSlice<T>` unbounded; safe `bun_ast::StoreSlice::new(&[Cell<u32>])` cross-thread race confirmed |
| F-020 | `src/url/lib.rs:340-351` | 2 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance + experiments/EXP-020 (phase3) | EXP-020 | DEFERRED | `bun_url::URL::host_with_path` int-to-pointer round-trip loses provenance under `-Zmiri-strict-provenance`; policy-gated, not counted as default-Miri/runtime UB |
| F-021 | `src/ast/nodes.rs:42-113, 170-208, 342-413` | 15, 4, 5 | MUST-BE-UB | type audit | Miri + experiments/EXP-021 | EXP-021 | CONFIRMED_UB | `StoreRef`/`StoreStr`/`StoreSlice` safe constructors + caller-chosen-lifetime reborrow → dangling slice |
| F-026 | `src/runtime/timer/mod.rs:897, 1016`; `src/runtime/jsc_hooks.rs:152-157` | 1, 21, 15 | MUST-BE-UB | rg, source TODO | Miri TB model | EXP-026 | CONFIRMED_UB (TB model) | `timer::All::{get_timeout, drain_timers}` `&mut self` receiver across re-entry; `TODO(b2)` in-source |
| F-026b | `src/runtime/node/node_cluster_binding.rs:35-51,147-158`; `src/jsc/ipc.rs:140-159` | 1, 15, 21 | MUST-BE-UB | source comments + RacyCell/singleton safe-boundary audit | Miri Tree-Borrows model (`experiments/EXP-099`) | EXP-099 | CONFIRMED_UB | `child_singleton<'a>() -> &'a mut InternalMsgHolder` plus `InternalMsgHolder::flush(&mut self)` runs JS callbacks that can re-enter the same singleton; `black_box(ptr::from_mut(self))` does not remove the live protected receiver tag |
| F-026c | `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; opaque shims `src/uws_sys/lib.rs:191-201` | 1, 15, 21 | MUST-BE-UB | R-2 source sweep + ProxyTunnel contrast audit | Miri Tree-Borrows model (`experiments/EXP-100`) | EXP-100 | CONFIRMED_UB | `UpgradedDuplex::{flush,close,shutdown,encode_and_write,on_internal_receive_data}` borrow `&mut self.wrapper` and call `SSLWrapper`, whose callbacks re-enter via `ctx: *mut UpgradedDuplex` and materialize `&mut UpgradedDuplex`; `on_close` can set `self.wrapper = None` while the caller's receiver borrow remains live. |
| F-026d | `src/http/ProxyTunnel.rs:707-711`; live callers `src/http/lib.rs:1347-1355`, `src/http/HTTPContext.rs:692-700` | 1, 15, 21 | MUST-BE-UB | follow-up to EXP-100 ProxyTunnel contrast audit | Miri Tree-Borrows model (`experiments/EXP-101`) + clean raw-owner control (`EXP-101-good.log`) | EXP-101 | CONFIRMED_UB | `ProxyTunnel` contains the correct `close_raw` / disjoint-field callback pattern, but `shutdown(&mut self)` still calls `wrapper.shutdown(true)` while a whole-struct receiver borrow is protected. The callbacks' raw disjoint-field writes are valid only through the raw-owner path, not under the old `&mut self` receiver. |
| F-026e | `src/http/ProxyTunnel.rs:768-775`; live callers `src/http/lib.rs:2876-2888`, `src/http/lib.rs:2913-2947` | 1, 15, 21 | MUST-BE-UB | follow-up to EXP-101 ProxyTunnel write-path audit | Miri Tree-Borrows model (`experiments/EXP-102`) + clean raw-owner control (`EXP-102-good.log`) | EXP-102 | CONFIRMED_UB | `ProxyTunnel::write(&mut self, buf)` still calls `wrapper.write_data(buf)` under a protected whole-struct receiver. `SSLWrapper::write_data` reaches `handle_traffic()` and synchronously invokes ProxyTunnel callbacks; their disjoint raw-field writes are sound only through a raw-owner `write_raw`, not under the old `&mut self` receiver. |
| F-026f | `src/http/ProxyTunnel.rs:714-749,752-765`; live callers `src/http/lib.rs:2754-2755`, `src/http/lib.rs:3254-3258` | 1, 15, 21 | MUST-BE-UB | follow-up to EXP-102 raw-capture-first audit | Miri Tree-Borrows model (`experiments/EXP-103`) + clean raw-owner controls (`EXP-103-on-writable-good.log`, `EXP-103-receive-good.log`) | EXP-103 | CONFIRMED_UB | `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` capture a raw pointer first, but the call frame still has a protected whole-struct receiver. `SSLWrapper::flush` / `receive_data` can synchronously invoke callbacks that raw-write tunnel fields; the same field writes are clean only when the entry path is raw-owner. |
| F-026g | `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238`; generated receiver thunk `src/jsc_macros/lib.rs:828-843` | 1, 15, 21 | MUST-BE-UB | follow-up to EXP-100..103 SSLWrapper receiver sweep | Miri Tree-Borrows model (`experiments/EXP-104`) + clean raw-owner controls (`EXP-104-flush-good.log`, `EXP-104-receive-good.log`) | EXP-104 | CONFIRMED_UB | `WindowsNamedPipe`'s `WRAPPER_BUSY` guard correctly defers wrapper drop during SSLWrapper re-entry, but representative SSLWrapper-driving paths still begin from whole-struct `&mut self` receivers. Generated `#[uws_callback]` exports are one source of that receiver; `on_read` / `on_internal_receive_data` receive paths are internal same-shape entries. `SSLWrapper::flush` / `receive_data` can synchronously invoke `ssl_write` / `ssl_on_close`, which materialize fresh whole-struct `&mut WindowsNamedPipe`; Tree-Borrows rejects the callback reborrow under the protected receiver while accepting the same logic through raw-owner entry points. |
| F-026h | `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; `src/runtime/webcore/FileSink.rs:463-531` | 1, 15, 21 | MUST-BE-UB | `LaunderedSelf` source sweep + FileSink parent callback audit | Miri Tree-Borrows model (`experiments/EXP-106`) + clean raw-owner control (`EXP-106-good.log`) | EXP-106 | CONFIRMED_UB | `PipeWriter` completion methods call `Parent::on_write` while their `&mut self` receiver is protected. `FileSink::on_write` can run JS/microtasks and re-enter the same intrusive writer via `writer.with_mut(|w| w.end()/close())`; `black_box(ptr::from_mut(self))` reloads fields but does not remove the receiver protector. |
| F-026i | `src/jsc/rare_data.rs:864-891`; registration/removal edges `src/runtime/node/node_fs_watcher.rs:997,1130-1135`; caller `src/jsc/VirtualMachine.rs:4551` | 1, 15, 21 | MUST-BE-UB | callback-receiver shape sweep + source comment | Miri Tree-Borrows model (`experiments/EXP-107`) + clean raw-owner control (`EXP-107-good.log`) | EXP-107 | CONFIRMED_UB | `RareData::close_all_watchers_for_isolation(&mut self)` pops watcher entries and invokes opaque close callbacks while its receiver remains protected. Source says close re-enters JS and can push back into the same watcher Vecs; Tree-Borrows rejects that fresh raw-owner mutable reborrow under the protected receiver, while a raw-owner cleanup loop passes. |
| F-026j | `src/jsc/event_loop.rs:455-507`; host exports `src/jsc/event_loop.rs:1147-1186`; VM accessor `src/jsc/VirtualMachine.rs:727-749` | 1, 15, 21 | MUST-BE-UB | callback-receiver shape sweep + source comment | Miri Tree-Borrows model (`experiments/EXP-108`) + clean raw-owner control (`EXP-108-good.log`) | EXP-108 | CONFIRMED_UB | `EventLoop::{run_callback,run_callback_with_result}(&mut self)` call JS while a protected loop receiver is live. Source says JS can re-enter via `vm.event_loop()` and run nested `enter()/exit()` or `drain_microtasks`; Tree-Borrows rejects the nested fresh mutable loop access under the receiver tag. |
| F-026k | `src/runtime/api/bun/h2_frame_parser.rs:1850-1981`; dispatch `:2626-2628`; call sites `:5594`, `:5637-5646` | 1, 15, 21 | MUST-BE-UB | callback-receiver shape sweep + source comment | Miri Tree-Borrows model (`experiments/EXP-110`) + clean raw-owner control (`EXP-110-good.log`) | EXP-110 | CONFIRMED_UB | `Stream::queue_frame(&mut self)` dispatches JS write callbacks while the stream receiver is protected. Source says callbacks can re-enter h2 host functions, look the same stream up through `client.streams`, and call `queue_frame()` again with a fresh `&mut Stream`; Tree-Borrows rejects that reborrow, while the same logic through a raw-owner queue-frame helper passes. |
| F-027 | `src/runtime/node/dir_iterator.rs:44-67, 499-522, 895-899`; `src/bun_core/lib.rs:208-212` | 8, 15, 4 | MUST-BE-UB | rg, type audit | Miri + experiments/EXP-027 | EXP-027 | CONFIRMED_UB | Windows `IteratorResultWName.RawSlice<u16>` is sendable lifetime-erased borrow; iterator state single-threaded |
| F-028 | `src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81` | 1, 14 | STALE-DRAFT-HARDENING | source TODO, ast-grep, source audit | Miri TB clean on source-shaped repro; current canonical source already raw | EXP-028 | NO_EVIDENCE | TODO-marked `owner(&mut self) -> &mut DevServer` remains in the Phase-A draft module mounted as `directory_watch_store_body`, but the canonical `crate::bake::dev_server::DirectoryWatchStore` in `dev_server/mod.rs` uses `owner(&mut self) -> *mut DevServer`; no call sites of the draft type found |
| F-029 | `src/runtime/shell/EnvStr.rs:188-200, 197-200` | 2, 15, 4 | STRICT_PROVENANCE_FAIL | ast-grep, source TODO | Miri strict-provenance | EXP-029 | DEFERRED | `cast_slice`/`cast_ref_counted` rebuild pointers from masked low-48-bit integer addresses; policy-gated, not counted as default-Miri/runtime UB |
| F-072 | `src/collections/hive_array.rs:214-215,523-546`; 8 callers in `src/install/PackageManager/PackageManagerEnqueue.rs:358,1659,1803`, `src/install/PackageManager/runTasks.rs:1711`, `src/runtime/server/server_body.rs:3415`, `src/runtime/server/mod.rs:705`, `src/runtime/bake/DevServer.rs:2097`, `src/runtime/api/bun/h2_frame_parser.rs:7375` | 5 | MUST-BE-UB (self-acknowledged + Miri-confirmed generic contract) | rg, source deprecation audit | Miri mirror + direct `bun_collections` witness | EXP-072 | CONFIRMED_UB | deprecated `HiveArray::get` and `HiveArrayFallback::{get, try_get, get_and_see_if_new}` return `*mut T` to claimed-but-uninitialized storage; EXP-072 confirms the early-return-before-write hazard drops uninitialized `T`. The direct `bun_collections` witness also exposes the aliasing retag failure in `HiveArray::put` from the pointer-return + later `&mut self` call shape. Production exploitability is per-caller; migration is one PR per crate to `get_init` / `emplace` / `claim`, then delete deprecated raw-slot methods. |
| F-073 | `src/runtime/webcore/blob/copy_file.rs:1005, 1300, 1580, 1666` | 1, 14, 23 | MUST-BE-UB | ast-grep + source audit | Miri default SB + TB (`experiments/EXP-073`) | EXP-073 | CONFIRMED_UB | `CopyFileWindows.event_loop: &EventLoop` is cast to `*mut EventLoop` and passed to `EventLoop::enter_scope()`, which mutates `entered_event_loop_count`; sibling `WriteFileWindows` already uses the correct raw-pointer representation |
| F-A-1 | `src/runtime/webcore/Sink.rs:1232` | 1, 2, 15 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | EXP-048-adjacent (`TaggedPtrUnion::as_uintptr`; explicit rewrite needed) | DEFERRED | `unsafe { &mut *(ptr.as_uintptr() as usize as *mut Subprocess<'_>) }` — TaggedPointer integer round-trip then `&mut`; strict-provenance failure, not counted as default-runtime UB |
| F-A-2 | 95-site `from_field_ptr!` enumeration (see Bucket-1 Section §A) | 1, 14 | LIKELY-UB-SHAPE / STRUCTURAL-HARDENING | ast-grep | (per-site TB model) | EXP-028 / EXP-061 / EXP-069 | DEFERRED-VEHICLE | 95 invocations workspace-wide; **13 raw-enumerated shapes return `&mut Parent` rather than raw**. EXP-028 was demoted after the draft/canonical source audit; dispatch.rs:794/799/823/828 is reviewed/demoted for aliasing; the non-dispatch subset is now a deferred macro/harness hardening target under EXP-061/EXP-069 rather than an open registry proof obligation. |
| F-A-3 | `src/bun_core/util.rs:747` | 1, 6 | CONTRACTUAL-BUT-DEFENSIBLE | ast-grep + source audit | `WStr` verified `#[repr(transparent)]` over `[u16]` | — | REVIEWED | `WStr::from_raw_mut(ptr, len)` is an `unsafe fn` whose caller contract proves writability and NUL discipline. The `&mut [u16] -> &mut WStr` cast is layout-valid because `WStr` is `#[repr(transparent)] pub struct WStr([u16])`; keep as a library-contract site, not a UB finding. |
| F-A-4 | `src/bundler/linker_context/doStep5.rs:694` | 1, 5 | DEFENSIBLE-BUT-BRITTLE | ast-grep + source audit | source proof of slot initialization | — | REVIEWED | `stmts_count` exactly equals per-export writes plus the three conditional trailing statements. `all_export_stmts_base` is captured after per-export writes; the cast covers only `[all_export_stmts_base..stmts_head]`, and each branch that contributes to `all_export_stmts_len` writes exactly one slot before the cast. Brittle, but current source does not expose uninitialized `Stmt` slots. |
| F-A-5 | `src/jsc/TopExceptionScope.rs:497-498` | 1, 5 | DEFENSIBLE-LAYOUT-PUN | ast-grep + source audit | size/alignment proof + single-field offset proof | — | REVIEWED | `ExceptionValidationScope` contains only `scope: TopExceptionScope` under `cfg(any(debug_assertions, bun_asan))`; the const assertion proves equal size and alignment. With one non-ZST field, equal size/alignment forces field offset 0, and `MaybeUninit<T>` preserves layout, so the storage reinterpretation is defensible. Do not count as UB. |
| F-A-6 | `src/ini/lib.rs:1361` | 1, 15 | CONTRACTUAL-BUT-DEFENSIBLE | ast-grep + source audit | source-owned-output audit (2026-05-16) | — (reviewed/demoted; no EXP needed) | REVIEWED | `&mut *(env as *mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>)` is lifetime laundering, but `load_npmrc()` drops the parser before return and every surviving value is boxed/owned (`ConfigItem`, `ScopeItem`, `NpmRegistry`, `PnpmMatcher`). Keep as a refactor/documentation target, not a live UB claim. |
| F-A-7 | `src/runtime/api/JSBundler.rs:1387-1405` (`bv2_mut`, `bv2_plugin`) | 1, 21 | LIKELY-UB | source audit | Miri TB model + plugin re-entry stub | EXP-044 | CONFIRMED_UB (plugin re-entry harness) | centralised `*mut BundleV2 → &mut BundleV2` with caller-chosen lifetime; same family as EXP-044 (bundle_v2 self.bv2) |
| F-A-8 | `src/jsc/JSCell.rs:126-128`; `src/runtime/dns_jsc/dns.rs:104-107`; `src/bundler/BundleThread.rs:170-173` | 1, 8 | MIXED-CONFIRMED-AND-HARDENING | type audit + source audit | EXP-045 Miri-confirmed for JsCell; SendPtr siblings demoted | EXP-045 (JsCell) / hardening siblings | PARTIAL (EXP-045 CONFIRMED_UB; siblings REVIEWED) | `JsCell<T>` is confirmed UB because safe `get() -> &T` exposes `Cell` cross-thread. The two `SendPtr<T>` siblings are private/function-local and current instantiations are fixed to the intended raw pointer type; keep them as refactor/lint targets, not counted UB findings. |
| F-A-9 | `src/options_types/context.rs` (3 `pub unsafe fn` over `*mut Log`) | 1, 8 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | n/a | — | REVIEWED | gold-standard SAFETY docs naming every aliasing path; auditor-fragile but documented |
| F-A-10 | `src/runtime/server/HTMLBundle.rs:154` (`pub struct Route`) | 1, 13 | CLEAN | source audit | n/a | — | REVIEWED | `&self` + UnsafeCell pattern — **safe-pattern reference** for Bucket 21; Phase 1 J/B confirms this design intent |
| F-A-11 | `src/runtime/webcore/Sink.rs:1232` + `src/runtime/shell/EnvStr.rs` + `src/url/lib.rs` cluster | 1, 2 | STRICT_PROVENANCE_FAIL-CLUSTER | ast-grep | Miri strict-provenance | EXP-048 / EXP-020 / EXP-029 | DEFERRED | 3-site int-to-pointer reference-materialisation family; strict-provenance failure confirmed, default-runtime UB not claimed without adopting strict provenance as a gate |
| F-A-12 | `src/runtime/dispatch.rs:794, 799, 823, 828` | 1, 21 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | aliasing demoted; provenance tracked by F-P-9 | — (reviewed/demoted; no EXP needed) | REVIEWED | POSIX epoll/kqueue io_poll callback receives a raw `*mut Poll` from the event loop and recovers `ReadFile`/`WriteFile` by container-of. The `&mut Poll` used during registration is short-lived and not retained, so this is not the same live-`&mut self` overlap as EXP-028. The remaining pack/unpack provenance issue is tracked separately as F-P-9. |
| F-P-1 | `src/css/values/ident.rs:321` | 2 | STRICT_PROVENANCE_FAIL (debug-only) | ast-grep | Miri strict-provenance | per-site debug-only custom packer (not `TaggedPtr::get/to`) | DEFERRED | `#[cfg(debug_assertions)]` `self.ptrbits() as usize as *const *const [u8]`; strict-provenance-only |
| F-P-2 | `src/css/values/ident.rs:377` | 2 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site custom packer (not `TaggedPtr::get/to`) | DEFERRED | `IdentOrRef::as_ident` — `self.ptrbits() as usize as *const u8` + `from_raw_parts`; strict-provenance-only |
| F-P-3 | `src/ast/nodes.rs:866` | 2, 6 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site packed enum payload (not `TaggedPtr::get/to`) | DEFERRED | `InlinedEnumValueDecoded::decode`: `self.raw_data as usize as *const E::String`; strict-provenance-only |
| F-P-4 | `src/ptr/tagged_pointer.rs:53-56, 60-64` (`TaggedPtr::get`/`to`) | 2 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | EXP-048 | DEFERRED | **centralised library helpers** for true `TaggedPtr` round-trips — strict-provenance failure confirmed; not counted as default-runtime UB |
| F-P-5 | `src/jsc/DecodedJSValue.rs:58` | 2, 21 | DEFENSIBLE-FFI | source audit | (strict-provenance documents the gap) | — | REVIEWED | JSC C++ side originates the pointer as `u64`; provenance loss is FFI-inherent |
| F-P-6 | `src/runtime/webcore/Blob.rs:5815, 5835` | 2, 21 | DEFENSIBLE-FFI | source audit | n/a | — | REVIEWED | JS Number-as-pointer round-trip; same FFI boundary |
| F-P-7 | `src/jsc/PosixSignalHandle.rs:101` | 2, 4 | STRICT_PROVENANCE_REVIEW (layout-only) | ast-grep | Miri strict-provenance | layout-only integer-as-value review (not `TaggedPtr::get/to`) | DEFERRED | integer-as-value through pointer slot; layout-only, no real provenance to preserve |
| F-P-8 | `src/runtime/api/NativePromiseContext.rs:200` | 2, 4 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site custom packer (not `TaggedPtr::get/to`) | DEFERRED | tag-bit OR'd pointer pack-and-mask |
| F-P-9 | `src/io/lib.rs:1357` | 2, 4 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site custom packer (not `TaggedPtr::get/to`) | DEFERRED | `Pollable::poll` masked-low-bit pointer reconstruction |
| F-P-10 | `src/runtime/server/ServerWebSocket.rs:144` | 2, 4 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site packed WebSocket pointer (not `TaggedPtr::get/to`) | DEFERRED | packed WebSocket pointer; **hot WebSocket dispatch path** |
| F-P-11 | `src/sourcemap/ParsedSourceMap.rs:278` | 2, 21 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site trivial cast fix (not `TaggedPtr::get/to`) | DEFERRED | trivial fix: cast directly via `.cast::<Loaded>()` |
| F-P-12 | `src/sys/lib.rs:9067` | 2, 6 | STRICT_PROVENANCE_REVIEW (layout-only) | ast-grep | Miri strict-provenance | layout-only integer-as-value review (not `TaggedPtr::get/to`) | DEFERRED | fd-as-pointer write into QuietWriter first word; layout-only |
| F-P-13 | `src/bun_core/string/immutable.rs:1076` | 2, 4 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | EXP-049 | DEFERRED | `StringOrTinyString::slice` — pure-byte-buffer pointer reconstruction via `usize::from_le_bytes`; strict-provenance failure confirmed, default-runtime UB not claimed without adopting strict provenance |
| F-P-14 | `src/libuv_sys/libuv.rs:976, 989` | 2, 6, 10 | PORTABILITY-HARDENING | ast-grep + width assert | `phase5_experiment_results/EXP-055-handle-type-crosscheck.log`; `phase5_exp055_libuv_handle_type_crosscheck.md` | EXP-055 (cross-tag with HandleType cluster) | NO_EVIDENCE | fn-pointer-as-usize round-trip through libuv `reserved[0]` slot has target-width parity on current supported target. Still worth replacing with a typed callback slot / trampoline, but not counted as live UB without CHERI/wasm32 or mismatched-width support evidence |
| F-P-15 | `src/runtime/ffi/FFIObject.rs:28` | 2, 18 | DEFENSIBLE-FFI | source audit | n/a | — | REVIEWED | JS-supplied numeric address; provenance loss is FFI-inherent |
| F-P-16 | `src/bun_alloc/lib.rs:925, 930, 935, 940, 946` | 2, 4 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | EXP-050 | DEFERRED | `ZigString` tag-bit mark/untag — **cross-language string ABI between Bun and JSC**; strict-provenance failure confirmed, default-runtime UB not claimed without adopting strict provenance |
| F-P-17 | `src/bun_core/string/SmolStr.rs:56-91, 115-124, 156-164` | 2, 4, 20 | STRICT_PROVENANCE_FAIL | Codex primitive-gap sweep | Miri strict-provenance | EXP-096 | DEFERRED | exported `SmolStr` packs heap pointer bits into a `u128` and reconstructs `*const/*mut u8`; separate representation from EXP-049 |
| F-A14-A | `src/runtime/server/WebSocketServerContext.rs:79-96` + 10 siblings (`subprocess.rs:265`, `Terminal.rs:373`, `cron.rs:1401`, `node_fs_watcher.rs:107`, `node_fs_stat_watcher.rs:550`, `interpreter.rs:894`, `JSTranspiler.rs:1192`, `dns.rs:4017`, `socket_body.rs:347`, `h2_frame_parser.rs:1340`) | 14, 1 | MUST-BE-UB | ast-grep, lint | Miri TB model | EXP-041 | CONFIRMED_UB (TB) | `active_connections_saturating_{add,sub}` writes through `addr_of!(self.active_connections).cast_mut()`; `&self`-derived SharedReadOnly — fix is `Cell<usize>` per in-source TODO |
| F-A14-B | `src/runtime/cli/repl.rs:94-101` | 14, 1 | MUST-BE-UB | `#[allow(invalid_reference_casting)]` | Miri TB model | EXP-042 | CONFIRMED_UB (TB) | `vm_mut(vm: &'a VM) -> &'a mut VM` — canonical `&T → &mut T` forgery; lint is silenced |
| F-A14-C | `src/runtime/cli/test/Scanner.rs:255-265, 365` | 14, 1 | MUST-BE-UB | `#[allow(invalid_reference_casting)]` | Miri TB model | EXP-043 | CONFIRMED_UB (TB) | `resolve_dir_for_test` forges `&mut RealFS` from `&self.fs.fs` reborrow chain |
| F-A14-D | `src/runtime/bake/DevServer.rs:2115, 3021` | 14, 1 | MUST-BE-UB | code audit | Miri default SB + TB (`experiments/EXP-075`) | EXP-075 | CONFIRMED_UB | `DevServer::try_define_deferred_request(&mut self)` stores `dev: std::ptr::from_ref(self)`, then `DeferredRequest::__free` mutates `(*self.dev.cast_mut()).deferred_request_pool`; default Miri + Tree Borrows reject the shared-reborrow backref. Fix: store `std::ptr::from_mut(self)`. |
| F-A14-E | `src/runtime/socket/WindowsNamedPipeContext.rs:269-272` | 14, 1 | MUST-BE-UB | ast-grep + source audit | Miri default SB + TB (`experiments/EXP-076`) | EXP-076 | CONFIRMED_UB | `WindowsNamedPipeContext::deinit_in_next_tick` casts `vm: &'static VirtualMachine` through `ptr::from_ref(vm).cast_mut()` and calls `VirtualMachine::enqueue_task(&mut self)`; default Miri rejects the receiver retag and Tree Borrows rejects the nested event-loop write. |
| F-A14-F | `src/runtime/timer/timer_object_internals.rs:107, 856-869, 970-1021` | 14, 1, 21 | MUST-BE-UB | ast-grep + caller audit | Miri default SB + TB (`experiments/EXP-074`) | EXP-074 | CONFIRMED_UB | `parent_ptr(&self) → from_ref(self).cast_mut()` recovers parent, then `set_event_loop_timer_state(&self)` writes plain `EventLoopTimer.state` through that shared-provenance pointer. Source comment says writes must go through `Cell`/`UnsafeCell`, but this field is plain; default Miri + Tree Borrows reject the faithful model. |
| F-DR-1 | `src/threading/ThreadPool.rs:1480-1599` (`Queue::cache: Cell<*mut Node>`) | 7, 8, 1 | DEFENSIBLE-BUT-UNVERIFIED | source audit | loom model clean | EXP-030 | NO_EVIDENCE | `unsafe impl Sync for Queue {}` + `Cell<*mut Node>` cache; loom model supports the tag-bit CAS discipline, with production parity still worth keeping as a regression guard |
| F-DR-2 | `src/threading/channel.rs:35-49, 174-242` | 7, 8, 1 | DEFENSIBLE-BUT-UNVERIFIED | source audit | (loom 2P-1C) | (covered under loom soak campaign) | DEFERRED | `Channel<T, B>` MPMC with Mutex+Condition; `B` trait carries no Send/Sync bound — type-system loose, runtime sound |
| F-DR-3 | `src/threading/unbounded_queue.rs:216-369` | 7 | DEFENSIBLE-BUT-UNVERIFIED | source audit | loom 2P-1C clean | EXP-052 | NO_EVIDENCE | lock-free MPSC `UnboundedQueue<T>`; regression-guard loom model supports the AcqRel/Acquire discipline, keep soak |
| F-DR-4 | `src/runtime/bake/DevServer/WatcherAtomics.rs:27, 128-225, 232-285` | 7, 1 | DEFENSIBLE-BUT-UNVERIFIED | source audit | loom model clean | EXP-031 | NO_EVIDENCE | watcher thread writes `current_event`/`pending_event` non-atomically; Phase-5 loom model supports the AcqRel handoff edge, with slot-picker parity still worth checking |
| F-DR-5 | `src/jsc/web_worker.rs:127-128, 145, 246-326, 332-388` | 7, 1, 8 | DEFENSIBLE-BUT-HARDEN | source audit | `phase5_experiment_results/EXP-032.log`; `phase5_exp032_webworker_cell_conceptual_review.md` | EXP-032 | NO_EVIDENCE | `terminate_all_and_wait` forms `&WebWorker` cross-thread, but every modeled `Cell` access is serialized by `live_workers::MUTEX` / `vm_lock`; `!Sync` alone is not UB. Keep AtomicCell / marker hardening if desired |
| F-DR-6 | `src/bun_alloc/lib.rs:2182-2183` (`BSSList`) | 7, 8, 1 | CONTRACTUAL-BUT-DEFENSIBLE | type audit + Codex correction | n/a | hardening only | REVIEWED | Prior text incorrectly cited `BSSList::at_index(&self) -> &V`; that method belongs to `OverflowList`, not `BSSList`. `BSSList` has unsafe raw-pointer mutation APIs and `MaybeUninit<V>` storage, but no safe shared `&self -> &V` accessor, so `Sync where V: Send` is a `Mutex<T>`-like shape rather than a current `StoreSlice<T>`-class unsound safe API. Hardening: make fields private and add `V: Sync` if a future shared read accessor is introduced. |
| F-DR-7 | `src/bun_core/atomic_cell.rs:65-66` | 7, 8, 11 | MUST-BE-UB (generic safe-API contract) | type audit + direct Bun-crate Miri witness | Miri default + Tree-Borrows (`experiments/EXP-098-bun-core-crate`) | EXP-098 | CONFIRMED_UB | `unsafe impl<T: Copy> Sync/Send for AtomicCell<T>` is not saved by gating only the atomic methods on `T: Atom`: safe `new()` + `into_inner()` can transport `AtomicCell<&Cell<u32>>` across a scoped thread, and Miri reports a `Cell` data race. |
| F-DR-8 | `src/bun_core/atomic_cell.rs:503-504` (`ThreadCell<T>`) | 8, 7 | HARDENING | type audit + safe-boundary check | `EXP-047-safe-boundary-bun-core` | EXP-047 | NO_EVIDENCE (project-UB claim demoted) | `unsafe impl<T: ?Sized> Sync for ThreadCell<T>` is auditor-fragile and debug-only `assert_owner()` compiles out in release, but safe code only obtains raw pointers and the two in-tree statics route cross-thread access to documented queue/waker fields. Keep payload audit + naming hardening; do not count as confirmed UB. |
| F-DR-9 | `src/bun_core/util.rs:2276-2277` (`RacyCell<T>`) | 8, 7 | HARDENING | type audit + safe-boundary check | `EXP-047-safe-boundary-bun-core` | EXP-047 | NO_EVIDENCE (project-UB claim demoted) | The old `RacyCell<Cell<u32>>` Miri race required caller-side `unsafe` dereference of `get()`. Safe code can share the wrapper and call `get()`, but cannot dereference or send the raw pointer. Current payloads still deserve per-site review; this is not a counted Bun UB finding. |
| F-DR-10 | `src/sys/lib.rs:154-159, 183-192, 207-221, 804-808` (`dir_iterator::Name`) | 7, 8, 15 | MUST-BE-UB (safe-API shape) | type audit + Miri witness | Miri default | EXP-081 | CONFIRMED_UB | POSIX `WrappedIterator::next` safely returns an owned `IteratorResult` whose `Name` points into the iterator's inline buffer with no lifetime tie. Safe code can retain the entry, drop/advance the iterator, then call safe `slice_u8()`; EXP-081 reports dangling-pointer UB. |
| F-DR-11 | `src/jsc/web_worker.rs:127-128 + 252` | 7 | DEFENSIBLE-BUT-HARDEN | source audit | `phase5_experiment_results/EXP-032.log`; `phase5_exp032_webworker_cell_conceptual_review.md` | EXP-032 (companion) | NO_EVIDENCE | `Cell::get`/`set` of `*mut WebWorker` are cross-thread only under the mutex in the audited paths; loom negative control proves the model would catch an unsynchronized sweep |
| F-DR-12 | `src/bundler/Chunk.rs:133-134 + :152`; `linker_context/generateCompileResultFor{JS,Css}Chunk.rs` | 7, 1, 8 | MUST-BE-UB | source TODO + EXP-111 default-Miri witness | `phase5_experiment_results/EXP-111-sb.log`; `CODEX_EXP111_SOURCE_SCOPE_CORRECTION_2026-05-16.md` | EXP-111 | CONFIRMED_UB | The intended disjoint-write pieces (`CompileResultSlots`, atomic counters) are not enough to justify concurrent whole-owner `&mut Chunk` / `&mut LinkerContext` worker entries. EXP-111's default-Miri witness flags the retag/data-race at `&mut Chunk` construction. The renamer `&mut` TODO is a real subproblem, but a renamer-only patch is incomplete. |
| F-DR-13 | 5 Relaxed publish sites surveyed | 7 | CONTRACTUAL-BUT-DEFENSIBLE | manual audit | n/a | — | REVIEWED | all five have explicit publication-edge documentation; none too-weak |
| F-S-1 | `src/jsc/JSCell.rs:126-128` | 8, 1, 7 | MUST-BE-UB | type audit | Miri data-race witness | EXP-045 | CONFIRMED_UB | `unsafe impl<T> Send/Sync for JsCell<T>` unbounded while safe `get() -> &T` permits `static JsCell<Cell<u32>>` cross-thread; Miri reports a `Cell` data race. Same one-line fix shape as EXP-019. |
| F-S-2 | `src/runtime/dns_jsc/dns.rs:104-107` (`SendPtr<T>`) | 8, 13 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | private current-use audit | (hardening only) | REVIEWED | module-private wrapper; current source constructs only `SendPtr(req)` for `req: *mut Request` and dispatches under the documented DNS cache discipline. Refactor to a non-generic `DnsRequestPtr` or bounded shared helper, but do not count as current UB. |
| F-S-3 | `src/bundler/BundleThread.rs:170-173` (`SendPtr<T>` fn-local) | 8, 13 | DEFENSIBLE-HARDENING | source audit | function-local current-use audit | (hardening only) | REVIEWED | function-local wrapper inside `BundleThread::spawn`; current source instantiates only with `*mut Self`, moves it into the thread, and immediately calls `thread_main`. Refactor to `SpawnPtr(*mut Self)` for clarity. |
| F-S-4 | `src/bun_core/atomic_cell.rs:65-66` (AtomicCell `Copy` bound) | 8, 7, 11 | MUST-BE-UB (generic safe-API contract) | type audit + direct Bun-crate Miri witness | Miri default + Tree-Borrows (`experiments/EXP-098-bun-core-crate`) | EXP-098 | CONFIRMED_UB | same as F-DR-7; tighten the auto-trait impls / constructor surface so `T: Copy + !Send/!Sync + !Atom` cannot become a Send wrapper. |
| F-S-5 | `src/bun_core/atomic_cell.rs:503-504` (ThreadCell Sync) | 8, 7 | HARDENING | type audit + safe-boundary check | `EXP-047-safe-boundary-bun-core` | EXP-047 | NO_EVIDENCE (project-UB claim demoted) | same as F-DR-8; keep as a hardening item, not a confirmed safe-contract defect |
| F-S-6 | `src/bun_core/util.rs:2276-2277` (RacyCell Sync) | 8, 7 | HARDENING | type audit + safe-boundary check | `EXP-047-safe-boundary-bun-core` | EXP-047 | NO_EVIDENCE (project-UB claim demoted) | same as F-DR-9; the Miri race is caller-contract violation evidence, not project UB evidence |
| F-S-7 | `src/install/windows-shim/main.rs:214` (windows-shim RacyCell) | 8 | CONTRACTUAL-BUT-DEFENSIBLE | type audit | n/a | — | REVIEWED | single-binary install-time shim, lower exposure |
| F-S-8 | `src/jsc/WorkTask.rs:58` | 8, 21 | LIKELY-UB | type audit + Send-bound compile experiment | generic owned-wrapper Miri witness + 7/7 in-tree contexts fail `+ Send` bound | EXP-046 | CONFIRMED_UB (unsafe-contract defect) | `unsafe impl<C: WorkTaskContext> Send for WorkTask<C>` — trait lacks `C: Send`; production wrapper stores `*mut C`, so per-context exploitability still needs care, but the safe trait boundary is unsound. |
| F-S-9 | `src/jsc/ConcurrentPromiseTask.rs:55` | 8, 21 | LIKELY-UB | type audit + Send-bound compile experiment | generic owned-wrapper Miri witness + 7/7 in-tree contexts fail `+ Send` bound | EXP-046 | CONFIRMED_UB (unsafe-contract defect) | same generic-bound shape as F-S-8; stronger because `ctx: Box<C>` is owned by the task wrapper. Per-context production crash paths remain separate from the confirmed abstraction defect. |
| F-S-10 | `src/ptr/lib.rs:627-628`; `src/ptr/parent_ref.rs:406-407` (BackRef/ParentRef) | 8, 13 | CONTRACTUAL-BUT-DEFENSIBLE | type audit | n/a | — | REVIEWED | matches `&T` auto-trait rules; `get_mut(&self) -> &mut T` is `unsafe`, pushes burden to call site |
| F-S-11 | `src/jsc/webcore_types.rs:60-96, 220-231`; `src/runtime/webcore/Blob.rs:1509,1557,1869,1911` | 8, 21, 7 | MUST-BE-UB (generic safe-API contract) | type audit + Miri witness | Miri default | EXP-082 | CONFIRMED_UB (generic contract) | `Blob: Send + Sync` while safe `global_this(&self)` returns `Option<&JSGlobalObject>`, exposing a JS-thread-affine opaque handle whenever the pointer is present. EXP-082 confirms the safe API shape races a thread-affine `Cell`; no current claim of a proven production off-thread Blob caller. |
| F-S-12 | `src/runtime/shell/IOWriter.rs:237-252, 969-985`; `src/runtime/shell/IOReader.rs:72-100, 220-268` | 8, 7, 1 | MUST-BE-UB (generic safe-API contract) | type audit + Miri witness | Miri default | EXP-083 | CONFIRMED_UB (generic contract) | `IOWriter` / `IOReader` are `Sync` while safe `&self` methods mutate `UnsafeCell<State>`; EXP-083 confirms the safe two-thread `enqueue(&self)` shape. Prior Drop-only framing was too weak. |
| F-S-13 | `src/runtime/shell/builtin/rm.rs:710-714` | 8 | UNDOCUMENTED-AMBIGUITY | source audit | n/a | — | REVIEWED | shared SAFETY comment between ShellRmTask + DirTask; split recommended |
| F-S-14 | `src/jsc/VirtualMachine.rs:604-688` | 8, 7, 21 | MUST-BE-UB (generic safe-API contract) | type audit + Miri witness | Miri `--release` | EXP-084 | CONFIRMED_UB (generic contract) | `VirtualMachine: Send + Sync` lets `&VirtualMachine` cross threads, while safe `as_mut()` / `get_mut()` assume the current thread's TLS VM slot exists and call `unwrap_unchecked`; EXP-084 proves the safe off-thread call enters unreachable code. Direct safe `VirtualMachine::get_mut()` on a non-VM thread reaches the same unchecked precondition. |
| F-S-15 | `src/bun_core/string/mod.rs:1264-1265` | 8 | CONTRACTUAL-BUT-DEFENSIBLE | source TODO | n/a | — | REVIEWED | CLAUDE.md cross-thread string hazards; ThreadSafeString newtype split deferred |
| F-S-16 | `src/bundler/Chunk.rs:133-134` | 8, 1 | LIKELY-UB | source TODO | Miri TB model | EXP-010 cross-ref | CONFIRMED_UB-SHAPE | `Renamer<'r>` `&mut` reborrow; TODO `// ub-audit`; treated as part of the EXP-010 bundler parallel-callback aliasing family, though no separate integrated `bun build` trace exists for the renamer subcase |
| F-S-17..F-S-25 | various FFI/JS-thread Send/Sync (LinkerGraph, ThreadPool, hot_reloader, PathWatcherManager, DynLib, Waker, CoreFoundation, FFI-strings, Bytes/StoreRef) | 8 | DEFENSIBLE / DEFENSIBLE-AUDITOR-FRAGILE | per-site audit | n/a | — | REVIEWED | 9 concrete impls with strong SAFETY discipline |
| F-S-26 | `src/bundler/lib.rs:341-342` (DevServerHandle) | 8, 13 | LIKELY-UB-SHAPE | source audit | EXP-080 adjacent | — | REVIEWED-SUBSUMED | type-erased fn-vtable + `*mut ()`; the concrete safe-forgery defect is F-S-32 / EXP-080. Keep the Send/Sync angle as a hardening proof obligation, not an unresolved registry hypothesis |
| F-S-27 | `src/bundler/bundle_v2.rs:1543-1544` (CompletionHandle) | 8, 13 | DEFENSIBLE-WITH-SEQUENCING-EVIDENCE | source audit | n/a | — | REVIEWED | common `result` path appears sequenced bundle-thread write → JS-thread read; still affected by F-S-32 public-field bypass |
| F-S-28 | `src/runtime/api/js_bundle_completion_task.rs:106` | 8, 13 | LIKELY-UB-SHAPE / HARDENING | type audit | source audit | — | REVIEWED-FOLLOW-UP | `unsafe impl Send` only while CompletionHandle asserts Sync. Source audit did not prove a live concurrent read/write path: observed sequencing is bundle-thread mutation, JS-thread enqueue, later JS-thread read. Keep as a follow-up hardening proof obligation, not an open registry experiment. |
| F-S-29 | `src/resolver/fs.rs:1841-1842, 1836-1837`; `lib.rs:897-898` | 8 | DEFENSIBLE / DUPLICATED | source audit | (consolidate) | — | REVIEWED | triple-declared Entry/EntriesOption Send/Sync; 3 SAFETY blocks for same invariant |
| F-S-30 | `src/semver/SemverQuery.rs:131-132, 261-262` | 8 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | n/a | lifetime-shape cousin of EXP-021; no separate EXP | REVIEWED (not part of EXP-021 verdict) | List/Group lifetime-erased; sound by-construction; `'a` parameterisation advised |
| F-S-31 | `src/jsc/web_worker.rs:590`; `src/jsc/Debugger.rs:593`; `src/bundler/bundle_v2.rs:1543`; `src/bundler/BundleThread.rs:389` | 8 | DEFENSIBLE | source audit | (consolidate) | — | REVIEWED | 4 fn-local `struct SendPtr(*mut T)` shapes; refactor to shared `bun_threading::SendPtr<T: Send>` |
| F-S-32 | `src/dispatch/lib.rs:302-318`; generated handles such as `src/bundler/lib.rs:326-342` | 8, 10, 11 | MUST-BE-UB (safe API shape) | source audit + Miri witness | Miri default mirror + direct `bun_dispatch` macro witness | EXP-080 | CONFIRMED_UB | `link_interface!` emits public `kind`/`owner`; safe code bypasses `unsafe fn new` and calls safe dispatch through invalid owner. The direct witness compiles against Bun's actual proc macro and reaches the generated unsafe thunk. Fix by privatizing generated fields. |
| F-L-1 | `src/install/PackageManager.rs:701, 719, 1100`; `src/install/PackageInstaller.rs:398, 412, 419`; `src/install/NetworkTask.rs:175`; `src/install/isolated_install/Installer.rs:138`; `src/http/h3_client/PendingConnect.rs:50`; `src/http/HTTPThread.rs:45, 287, 387`; `src/sql_jsc/postgres/PostgresSQLConnection.rs:219, 229`; `src/sql_jsc/mysql/JSMySQLQuery.rs:612`; `src/sql_jsc/mysql/JSMySQLConnection.rs:137, 146`; `src/runtime/node/node_fs_watcher.rs:76`; `src/runtime/bake/DevServer/HmrSocket.rs:56`; `src/runtime/test_runner/Execution.rs:132`; `src/io/lib.rs:211` | 15, 1 | LIKELY-UB-SHAPE-CLUSTER | rg, type audit | Miri TB double-call witness | EXP-057 | CONFIRMED_UB (shape-level) | **17-site `fn(&self) -> &'a mut T` cluster** — caller-chosen `'a` with unconstrained variance; Miri confirms the double-call shape, while production sites still rely on "called at most once per stack frame" invariants. Codex post-convergence sweep found a wider 70-hit safe `&self -> &mut` R-2 queue; see `CODEX_MUT_FROM_REF_SWEEP_2026-05-16.md`. |
| F-L-2 | `src/bun_core/output.rs:1075-1083, 1086, 1090, 1095, 1104, 1108` | 15, 1 | MUST-BE-UB | source TODO | Miri TB witness | EXP-058 | CONFIRMED_UB | `source_writer_escape() → &'static mut Writer` + 5 wrappers; in-source TODO admits 2-call hazard. Faithful two-call model trips Tree-Borrows (`write access ... is forbidden`). |
| F-L-3 | `src/http/lib.rs:733-755, 881-899, 973-977`; `src/http/HTTPThread.rs:77-81` | 15, 8 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | n/a | — | REVIEWED | HTTP-thread `&'static mut` cluster; ThreadCell owner-asserts gate access; auditor-fragile |
| F-L-4 | `src/paths/resolve_path.rs:33-37, 393-405` | 15, 1 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | n/a | — | REVIEWED | thread-local scratch `&'static mut`; honest contract |
| F-L-5 | `src/runtime/shell/subproc.rs:253-263`; `src/uws_sys/vtable.rs:237-244`; `src/uws_sys/WebSocket.rs:248-255` | 15, 13 | CONTRACTUAL-BUT-DEFENSIBLE | source + call-site audit | n/a | vtable subcase feeds deferred EXP-070 vehicle; no direct EXP | REVIEWED (EXP-070 is remediation tooling, not this row's verdict) | `CmdHandle::cmd_mut` is an `unsafe fn` with 3 immediate callers; uWS `Trampolines::ext` scopes the `'static` lie to the handler call; `AnyWebSocket::as_::<T>()` remains a TODO-marked hardening API, but actual WebSocket trampolines use `as_ptr::<T>()` specifically to avoid holding `&mut T` across JS re-entry / `tcp.close()`. |
| F-L-6 | `src/bundler/ThreadPool.rs:414-428, 629-652` | 15, 1, 8 | MUST-BE-UB (safe-API shape) | source audit + Codex safe-API follow-up | Miri TB (`experiments/EXP-087`) | EXP-087 | CONFIRMED_UB | `ThreadPool::get_worker(&self, id) -> &'static mut Worker` can be called twice for the same `ThreadId` and returns two live `&mut Worker`s to the same heap allocation. The map lock protects lookup, not the lifetime of the returned reference. This is a source-specific promotion of the earlier under-demoted F-L-6 row. |
| F-L-7 | `src/bundler/transpiler.rs:262`; `src/runtime/api/JSTranspiler.rs:787, 1336, 1527, 1713, 993` | 15, 1 | MUST-BE-UB (safe-API shape) | source audit + Miri TB model | Miri TB (`experiments/EXP-079`) | EXP-079 | CONFIRMED_UB | `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` lets safe callers mint two coexisting `&mut Loader`s; EXP-079 confirms the exact shape. Adjacent `set_arena(detach_lifetime_ref)` sites remain per-call proof obligations rather than part of the confirmed two-call witness. |
| F-L-8 | `src/ast/lib.rs:524, 1586, 3369`; `src/router/lib.rs:1456-1467`; `src/picohttp/lib.rs:342-351, 561-571`; `src/md/types.rs:214-228`; `src/runtime/api/filesystem_router.rs:782` | 15 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | n/a | — | REVIEWED | 9-site `unsafe fn detach_lifetime(self) -> Self<'static>` cluster — **good-citizen pattern** |
| F-L-9 | `src/bun_alloc/lib.rs:550-565` | 15, 8 | LIKELY-UB-LATENT | source audit | API-misuse witness | EXP-059 | CONFIRMED_UB (latent API misuse) | `bun_alloc::Mutex::lock()` MutexGuard `'_ → 'static` transmute; all current instances are BSS, but the public const constructor `Mutex::new()` admits stack construction and the source-shaped Miri witness trips |
| F-L-10 | `src/dotenv/env_loader.rs:935`; `src/bun_alloc/lib.rs:2801, 3224, 2598`; `src/bun_alloc/heap_breakdown.rs:50, 97` | 15 | CLEAN | source audit | n/a | — | REVIEWED | best-practice witnesses: `// PORTING.md §Forbidden: no Box::leak` documented bans |
| F-L-11 | `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:322`; `src/sys/windows/env.rs:72, 92`; `src/runtime/api/bun/Terminal.rs:1847`; `src/runtime/node/node_fs.rs:2416, 2458`; `src/jsc/PluginRunner.rs:160, 177`; `src/bundler/HTMLScanner.rs:73` | 15, 21 | CONTRACTUAL-BUT-DEFENSIBLE | source spot-check | foreign-owner / process-lifetime ownership | — | REVIEWED | 9-site `Box::leak/Vec::leak → &'static` cluster. Spot-checked paths either transfer ownership to JSC (`MarkedArrayBuffer::from_bytes`), reconstruct/free during worker cleanup (`node_fs`), or intentionally install process/build-lifetime storage. Keep as `heap::release` / ownership-helper lint target, not a live UB claim. |
| F-L-12 | `src/runtime/cli/open.rs:379` | 15, 2 | STRICT_PROVENANCE_FAIL | ast-grep | Miri strict-provenance | per-site thread-handoff address smuggling (not `TaggedPtr::get/to`) | DEFERRED | closure captures `usize` address then reconstructs `*mut`; strict-provenance-only, not counted as default-runtime UB |
| NEW-U-1 | `src/threading/channel.rs:121-142, 208-242` | 5, 11 | LIKELY-UB | source audit | Miri (`Channel<bool>` shape) | EXP-033 | CONFIRMED_UB | `Channel::try_read_item`/`read_item` cast `[MaybeUninit<T>; 1]` to `&mut [T; 1]` before any slot is written; safe-by-luck for audited pointer/integer-like in-tree payloads; pub generic `T: Copy` API still admits validity-bearing `Copy` payloads |
| NEW-U-2 | `src/install/migration.rs:1492-1493` | 5, 4 | MUST-BE-UB | source audit | Miri | EXP-034 | CONFIRMED_UB | npm `package-lock.json` migration `set_len` over uninit cursor; same shape as EXP-005 |
| NEW-U-3 | `src/bun_core/util.rs:111-119, 166, 294-301` | 5, 11 | MUST-BE-UB (safe-API shape) | API audit + Codex Miri witness | Miri uninit-read mirror + direct Bun-crate witness (`experiments/EXP-078-bun-core-crate`) | EXP-078 | CONFIRMED_UB | `ArrayLike::set_len_and_slice<T>` is a **safe** trait method returning `&mut [T]` immediately after `Vec::set_len`; EXP-078 shows safe caller can read uninitialized `bool` through the returned slice, and the direct witness repeats it via real `bun_core::util::ArrayLike`. |
| NEW-V-1 | `src/standalone_graph/StandaloneModuleGraph.rs:230-246, 577-580` | 4, 6 | MUST-BE-UB | source audit | Miri | EXP-035 | CONFIRMED_UB | `read_unaligned::<CompiledModuleGraphFile>` from `__BUN` mach-o section; 4 sparse enums × 256^4; **structural twin of EXP-003** |
| NEW-V-2 | `src/install/lockfile/bun.lockb.rs:590`; `src/install/lockfile.rs:3369-3378` | 4 | MUST-BE-UB | source audit | Miri | EXP-036 | CONFIRMED_UB | `Buffers::read_array<PatchedDep>` — first lockfile reader with `bool` (`patchfile_hash_is_null`) validity-bearing field; bytes `2..=255` are immediate UB |
| NEW-V-3 | `src/watcher/WindowsWatcher.rs:55, 196-211` | 4 | RESOLVED / REGRESSION-GUARD | source re-check | stale negative-pattern Miri witness | EXP-037 | RESOLVED | `WindowsWatcher::Action` is a closed `#[repr(u32)]` enum, but current source decodes raw `FILE_NOTIFY_INFORMATION.Action` with a checked `match` and skips unknown values; old transmute-shaped witness is useful only as a regression guard |
| NEW-V-4 | `src/runtime/dispatch.rs:393`; `src/runtime/api/js_bundle_completion_task.rs:504, 599, 621, 755`; `src/jsc/generated.rs:409, 464, 494, 622` | 4, 11 | SUSPICIOUS | source audit | (macro/codegen drift proof or malformed-tag witness) | — | WATCHLIST | `unreachable_unchecked` exhaustiveness watchlist split into three suspicious families: dispatch inner match (currently guarded by outer macro or-pattern), bundle-completion local control-flow asserts, and generated FFI tagged unions. This is not a complete inventory of every `unreachable_unchecked` call; the extra current sites are reviewed separately in `CODEX_UNCHECKED_INTRINSICS_SWEEP_2026-05-16.md`, with `src/bun.rs:1585` promoted as EXP-086 / NEW-V-6. `dispatch.rs:460` is a comment/panic branch, not a site. |
| NEW-V-5 | `src/bun_core/fmt.rs:724-731, 3744-3749`; representative live call sites in `src/bun_core/output.rs:2422-2431`, `src/install/extract_tarball.rs`, `src/install/PackageManager/PackageManagerDirectories.rs` | 4, 12 | MUST-BE-UB (safe-API shape) | prior unsafe-audit P3-BC-001 + Codex source audit | Miri mirror + direct Bun-crate witness (`experiments/EXP-085-bun-core-crate`) | EXP-085 | CONFIRMED_UB | `fmt::Raw` / `fmt::s` is a safe `Display` adapter that calls `from_utf8_unchecked` on caller-supplied bytes. Miri confirms downstream UB on invalid bytes through real `bun_core::fmt::s(&[0xff])`; per-call production reachability still depends on each byte source, so do not overclaim stale argv reachability without a current call path. |
| NEW-V-6 | `src/bun.rs:1582-1586` | 4, 12 | MUST-BE-UB (safe-API shape) | Codex unchecked-intrinsics sweep | Miri unreachable witness | EXP-086 | CONFIRMED_UB | `pub fn unsafe_assert(condition: bool)` is safe but calls `unreachable_unchecked()` for caller-controlled `false`. No current in-tree callers, so production reachability is zero today; the safe function contract is still unsound until the helper is deleted, made `unsafe fn`, or changed to panic. |
| NEW-U-PS-1 | `src/jsc/any_task_job.rs:141-153` | 11, 18 | PANIC-POLICY-HARDENING | source audit | panic-injection harness for unwind-enabled model | EXP-038 | NO_EVIDENCE | `AnyTaskJob::run_task` lacks `catch_unwind`, but Bun's current dev/release profiles are `panic = "abort"` and crash before unwinding; retain as a regression guard if an unwind-enabled profile is introduced |
| NEW-U-PS-2 | `src/runtime/socket/Listener.rs:235, 317` (2 live panic-prone sites; previous `:1069/:1289` overcount corrected) | 11, 13 | LIKELY-UB under unwind profile | source audit | panic-injection harness | EXP-039 | NO_EVIDENCE today | `ptr::read` + `mem::forget` panic-window is real in an unwind-enabled model; Bun's configured profiles abort on panic, so this is a regression guard rather than current production UB |
| NEW-U-PS-3 | `src/runtime/webcore/s3/simple_request.rs:476-495, 599-670` | 11 | PANIC-SAFETY-HARDENING | source audit | panic-injection harness for future reclaim path | EXP-040 | NO_EVIDENCE | `S3HttpSimpleTask::Drop` `assume_init_mut` trip-hazard; current path leaks on panic rather than dropping, but a reclaim-on-unwind leak fix would immediately trip UB unless `http` is guarded by `initialized` / `Option` |
| F-21-1 | `src/runtime/napi/napi_body.rs:2461-2870, 2947-2971, 2975-3007` (`ThreadSafeFunction`) | 21, 7, 8 | MUST-BE-UB | source audit | Miri source-shaped raw-handle witness | EXP-060 | CONFIRMED_UB | exported N-API wrappers mint concurrent `&mut ThreadSafeFunction` from the same raw `napi_threadsafe_function` before taking the internal mutex; Miri confirms the retag/data-race shape |
| F-21-1b | `src/js/bun/ffi.ts:84-109`; `src/runtime/ffi/ffi_body.rs:1322-1339,2131-2271`; `src/jsc/bindings/JSFFIFunction.cpp:47-70` | 13, 15, 21 | NO_EVIDENCE | Codex source-root-graph correction + non-source-faithful standalone stale-handle model | `phase5_experiment_results/EXP-109.log`; `CODEX_EXP109_ROOT_GRAPH_CORRECTION_2026-05-16.md` | EXP-109 | NO_EVIDENCE | Original `JSCallback` GC-root-loss hypothesis is falsified: production callback state owns `FFICallbackFunctionWrapper`, which owns `JSC::Strong<JSFunction>` + `JSC::Strong<GlobalObject>`. The stale-handle Miri log remains a generic guard only; do not count this as production UB or remediation-required `Strong` migration. |
| F-21-2 | `src/runtime/socket/WindowsNamedPipe.rs:1432-1445` | 21, 1 | LIKELY-UB-SHAPE / HARDENING | source audit | Miri TB model | EXP-061 / EXP-070 vehicle | REVIEWED-SUBSUMED | only `borrow = mut` consumer of `impl_streaming_writer_parent!`; S4 propagates the EXP-012 `*mut Self + ref_guard` fix model here. Keep as a borrow-mode hardening target, not an unresolved registry hypothesis |
| F-21-3 | `src/cares_sys/c_ares.rs:741` (`Channel` ZST static_assert) | 21, 11 | DEFENSIBLE-LOAD-BEARING | source audit | n/a | — | REVIEWED | entire c-ares re-entrancy story rests on `size_of::<Channel>() == 0`; static-assertion catches at compile time |
| F-21-4 | `src/runtime/napi/napi_body.rs:2378, 2437, 2485` | 21, 8, 13 | LIKELY-UB-LATENT / HARDENING | source audit | follow-up Shuttle/env-teardown model | EXP-060 cluster follow-up; no separate EXP | SUBSUMED-FOLLOW-UP (EXP-060 primary bug confirmed) | napi finalizer queued task vs env teardown race remains a follow-up subcase, but EXP-060 is already confirmed by the raw-handle `&mut` witness; do not count this as a separate open proof obligation. |
| F-21-5 | `src/runtime/api/JSBundler.rs:1387-1405` (`bv2_mut`/`bv2_plugin`) | 21, 1 | LIKELY-UB | source audit | Miri TB + plugin re-entry harness | EXP-044 | CONFIRMED_UB (plugin re-entry harness) | centralised `*mut BundleV2 → &mut BundleV2` with caller-chosen lifetime; re-entrant plugin chain can mint two `&mut BundleV2` |
| F-21-6 | `src/runtime/dispatch.rs:794, 799, 823, 828` | 21, 1 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | aliasing demoted; provenance tracked by F-P-9 | — (reviewed/demoted; no EXP needed) | REVIEWED | POSIX io_poll → `&mut *from_field_ptr!(ReadFile/WriteFile, io_poll, poll)` is a raw-pointer event-loop callback, not libuv and not a proven overlapping-`&mut` callback. Keep the local raw-pointer conversion small; track the strict-provenance concern at `Pollable::poll` (F-P-9). |
| F-21-7 | `src/runtime/jsc_hooks.rs:152-157` (`timer_all_mut`) | 21, 1, 15 | MUST-BE-UB | source TODO | Miri TB model | EXP-026 (cross-link) | CONFIRMED_UB (TB; via EXP-026 root) | safe accessor synthesising `&'static mut`; covered by EXP-026 root |
| F-21-8 | `src/runtime/server/RequestContext.rs:266, 321-323` (`as_response`, `NativePromiseContext::take`) | 21, 15 | CONTRACTUAL-BUT-DEFENSIBLE | source audit + caller audit | n/a | — | REVIEWED | `as_response` is already `unsafe fn` with a local sole-`&mut` + GC-root safety contract; the `NativePromiseContext::take` wrapper is private to `RequestContext.rs`, the underlying cell take nulls/transfers the ref, and reviewed call sites immediately install `RequestContextRef`. Keep as hardening/docs watchlist, not an unresolved UB EXP. |
| F-21-9 | `src/uws_sys/vtable.rs:237` (`ext(s) -> &'static mut H::Ext`) | 21, 1 | DEFENSIBLE-LOAD-BEARING | source audit | borrow-mode annotation linter / callback re-entry torture | EXP-070 | DEFERRED | uSockets trampoline materialises `&'static mut` per upcall; `RawPtrHandler<T>` is the explicit escape hatch for re-entrant/freeing handlers. EXP-070 owns the borrow-mode annotation/linter vehicle; do not duplicate as a new EXP. |
| F-10-1 | `src/io/source.rs:260, 270` (`Source::get_handle`/`to_stream`) | 10, 21 | LAYOUT-HARDENING | source audit | code-search + latent layout-drift witness | EXP-053 | NO_EVIDENCE | direct `.cast()` to `*mut uv_handle_t`/`*mut uv_stream_t` bypasses `UvHandle::as_handle_mut()` discipline; current `Pipe` layout satisfies the prefix invariant, so this is hardening against future drift rather than current UB |
| F-10-2 | `src/runtime/napi/napi_body.rs:512, 524, 536, 1985, 2032` | 10 | STRUCTURAL-HARDENING | C/Rust layout cross-check | `phase5_experiment_results/EXP-054-layout-crosscheck.log`; `phase5_exp054_napi_layout_crosscheck.md` | EXP-054 | NO_EVIDENCE | 5 N-API `#[repr(C)]` POD structs lack layout asserts, but LP64 C-header values match the Rust mirrors today; keep as EXP-063 layout-lock hardening, not live UB |
| F-10-3 | `src/libuv_sys/libuv.rs:257-276` (`HandleType` enum) | 10, 6 | STRUCTURAL-HARDENING | C/Rust enum cross-check | `phase5_experiment_results/EXP-055-handle-type-crosscheck.log`; `phase5_exp055_libuv_handle_type_crosscheck.md` | EXP-055 | NO_EVIDENCE | `HandleType` discriminants match Bun's vendored `uv.h`; keep per-variant asserts as hardening, not live UB |
| F-10-4 | `src/windows_sys/externs.rs` (48 structs, 4 asserts) | 10 | LIKELY-LATENT-DRIFT | source audit | n/a | EXP-063 propagation | DEFERRED | Win32 ABI mirrors lack layout asserts beyond WSADATA / sockaddr_storage / TEB; no concrete mismatch currently proven, so this is layout-lock hardening rather than an unresolved UB proof obligation |
| F-10-5 | `src/boringssl_sys/boringssl.rs` (15 structs, 0 asserts) | 10, 22 | LIKELY-LATENT-DRIFT | source audit + Codex zeroed sweep | n/a | EXP-063 propagation | DEFERRED | BoringSSL crypto state structs are hand-written and should gain C-side layout locks; `EVP_MD_CTX` itself is all-zero-valid as Rust POD (byte-array union + raw pointers), so do not count this as a live zero-validity bug without a concrete C/Rust mismatch |
| F-10-6 | `src/runtime/generated_classes.rs`; `src/runtime/generated_host_exports.rs` file-level `#![allow]` | 10, 21 | DEFENSIBLE-LOAD-BEARING | source audit | n/a | — | REVIEWED | codegen contract is safety proof; rustc lint will not catch real ABI mismatch |
| F-10-7 | `src/jsc/cpp.rs` file-level `#![allow]` | 10 | DEFENSIBLE-LOAD-BEARING | source audit | n/a | — | REVIEWED | cppbind.ts codegen is source of truth; tracked as bead-blocker for legacy hand-written decl migration |
| F-10-mimalloc | `src/boringssl/lib.rs:209-225` (OPENSSL_memory_free over mi_malloc_usable_size) | 10 | CONTRACTUAL-BUT-DEFENSIBLE | source audit | n/a | — | REVIEWED | zero spans full size-class, > requested bytes; mimalloc invariant pinning advised |
| F-NF20-2 | `src/runtime/webcore/streams.rs:2533-2597` | 20, 11, 1 | MUST-BE-UB (safe API shape) | source audit + Codex safe-API probe | Miri stack-deallocation harness | EXP-092 | CONFIRMED_UB | `ReadResult::Read(*mut [u8])` plus safe `to_stream(...)` lets safe Rust pass a disjoint stack/non-Vec slice; pointer inequality from `buf` is treated as heap ownership and `Vec::from_raw_parts` later deallocates memory it does not own |
| F-NF20-3 | `src/jsc/bindgen.rs:255-353` | 20, 11, 6 | MUST-BE-UB (safe generic API shape) | source audit + Codex safe-API probe | Miri layout-mismatch harness | EXP-091 | CONFIRMED_UB | `BindgenArray<Child>::convert_from_extern` can return `Vec<ZigType>` over storage allocated as `Vec<ExternType>` when size matches but alignment differs; Miri rejects drop with an incorrect deallocation layout |
| F-NF6-26 | `packages/bun-native-plugin-rs/src/lib.rs:637` (`BunLoader` read) | 6, 4 | MUST-BE-UB | source audit | proptest + bytemuck::checked | EXP-051 | CONFIRMED_UB | `(loader as u8 as u32)` transmute into `#[repr(u32)]` `BunLoader`; field is `u8`, no validity check for `13..=255` |
| F-NF6-4 | `src/errno/windows_errno.rs:248-255`; `src/errno/lib.rs:303-310` | 6, 4, 11 | MUST-BE-UB (safe API shape) | syn-walker transmute-pairs + source audit | release-mode Miri witness (`experiments/EXP-097`) | EXP-097 | CONFIRMED_UB | safe public errno `from_raw` helpers transmute unchecked sparse enum discriminants; debug-only assertion in `E::from_raw` is not a safety boundary, and `SystemErrno::from_raw` has no Windows validity check |
| F-NF6-1 | `src/bundler/linker_context/scanImportsAndExports.rs:1682` (`PropertyIdTag` transmute) | 6, 4 | LIKELY-UB | source audit | bytemuck::CheckedBitPattern | EXP-064 vehicle / EXP-051 shape cousin | DEFERRED | `u16 → PropertyIdTag` transmute relies on populator; no `try_from`. Same checked-bit-pattern remediation shape as EXP-051, but no separate source-shaped witness was run for this exact enum |
| F-NF6-2 | `src/perf/tracy.rs:710-726, :798` (dlsym `transmute_copy`) | 6, 18 | HARDENING | source call-site audit | const-assert lift | — | REVIEWED-HARDENING | all current `dlsym::<T>` monomorphisations use `tracy_fns::*` unsafe extern fn pointers; no live non-pointer `T` path was found. Replace the runtime `debug_assert_eq!(size_of …)` with a compile-time typed-dlsym gate to prevent future drift |
| F-NF6-3 | `src/css/css_parser.rs:2718, 2723` (`'_ → 'static` widen pair) | 6, 15 | MUST-BE-UB (safe-API shape) | source TODO + Codex Miri witness | Miri lifetime model | EXP-077 | CONFIRMED_UB | `ToCssResult` / `ToCssResultInternal` expose arena-backed `CssModuleExports` / `CssModuleReferences` as `'static`. Miri confirms the dangling-reference safe-API shape; current reviewed in-tree callers only read `result.code`, so production exploitability is caller-dependent. |
| F-L12-1 | `src/ast/lib.rs:398-410` (`Ref` Hash) | 12 | CORRECTNESS-DRIFT | source audit | proptest Hash≥Eq | — | REVIEWED | `Ref::hash = as_u64()` (all 64 bits); `eql` masks user bits; silent map miss possible |
| F-L12-2 | `src/bundler/ungate_support.rs:107-129` (`StableRef` Ord/Eq) | 12 | CORRECTNESS-DRIFT | source audit | proptest Ord≡Eq | — | REVIEWED | `cmp == Equal` does not imply `==`; dead-but-wrong via `sort_unstable_by(is_less_than)` workaround |
| F-L12-3 | `src/runtime/bake/FrameworkRouter.rs:466-473` (`EffectiveUrlContext::eql`) | 12 | CORRECTNESS-DRIFT | source audit | adversarial fuzz | — | REVIEWED | `eql(a, b) = hash(a) == hash(b)` — hash collision treated as equality |
| F-NHR-1 | `src/runtime/server/NodeHTTPResponse.rs:1919, 1924-1934, 1943-1955`; `src/ptr/lib.rs:638-643` | 13, 21 | MUST-BE-UB (zero-ref dealloc through shared provenance) | source audit + Miri Tree-Borrows witness | `phase5_experiment_results/EXP-056-shared-dealloc.log`; `phase5_exp056_node_http_response_shared_dealloc.md` | EXP-056 | CONFIRMED_UB | `deref(&self)` zero path calls `deinit(&self)` then `heap::take(self.as_ctx_ptr())`; `AsCtxPtr` is `&self -> *mut Self` shared/read-only provenance and Miri rejects `Box::from_raw`/deallocation through that tag. Narrow claim: no `RefPtr<NodeHTTPResponse>` or cross-thread `Cell` race is asserted. |
| F-CLEAN-LinkerGraph | `src/bundler/LinkerGraph.rs:96-97` | 8 | CLEAN | source audit | n/a | — | REVIEWED | extensive SAFETY enumerating exactly which columns workers may touch through `&LinkerGraph`; **best-in-section discipline** |
| F-CLEAN-Resolver | `src/runtime/dns_jsc/dns.rs:3650-3658` (`ResolverRefGuard`) | 21 | CLEAN | source audit | n/a | — | REVIEWED | best-in-section RAII chokepoint; cited as canonical for `_not_send: PhantomData` marker |
| F-CLEAN-Section-K | `src/jsc/Strong.rs:13-15`, `Weak.rs:81-95` | 8 | CLEAN | type audit | n/a | — | REVIEWED | Strong/Weak audited `!Send + !Sync` by auto-trait; minor hardening gap (explicit type-level marker) only |
| F-CLEAN-Bucket-9 | `src/jsc/ConsoleObject.rs:146-174` | 9 | CLEAN | rg, source audit | n/a | — | REVIEWED | sole `Pin<Box<T>>` API workspace-wide; sound by `Box::into_pin` + `PhantomPinned`; **0 callers** |
| F-CLEAN-Bucket-19 | workspace-wide | 19 | CLEAN | rg | n/a | — | REVIEWED | zero `#[target_feature]` sites; Bun delegates SIMD to vendored C libs |
| F-CLEAN-Bucket-22 | workspace-wide | 22 | CLEAN | rg, ast-grep | rustc E0793 baseline | — | REVIEWED | 8 nominal packed types; 0 `&packed.field` sites; rustc E0793 hard error backstops |
| F-CLEAN-Bucket-24 | workspace-wide | 24 | CLEAN | rg | n/a | — | REVIEWED | 0 `feature(specialization)`/`min_specialization`; drift-guarded by pinned nightly + hashbrown_bridge |
| F-CLEAN-Bucket-25 | 12 manual Hash impls | 25 | CLEAN | manual audit | n/a | — | REVIEWED | zero strict drift; lossy-hash sites (KeyframesName, LayerName, PropertyId) preserve Hash≥Eq direction |
| F-CLEAN-mem-zeroed | 8 live `mem::zeroed::<T>` sites | 4 | CLEAN | rg, type audit | n/a | — | REVIEWED | every T is POD; `bun_core::ffi::Zeroable` audited trait gates the rest |
| F-CLEAN-volatile | `src/sql_jsc/postgres/PostgresSQLConnection.rs:1519` | 16 | CLEAN | rg, source audit | n/a | — | REVIEWED | single-threaded sensitive-data zeroize on teardown |
| F-CLEAN-inline-asm | 11 `asm!` sites | 18 | CLEAN | manual audit | n/a | — | REVIEWED | every site has correct option flags; chkstk verbatim from compiler_builtins |
| F-CLEAN-T | `src/libuv_sys/libuv.rs` 74 `assert_size!`/`assert_offset!` | 10 | CLEAN | source audit | n/a | — | REVIEWED | **gold-standard layout-assert discipline**; cross-validated against runtime `uv_*_size()` |
| F-CLEAN-uds-best-pattern | `src/runtime/socket/udp_socket.rs:1207-1212` | 5 | CLEAN | source audit | n/a | — | REVIEWED | **best-in-section anti-EXP-005 pattern**: `vec![…; len]` zero-init with SAFETY comment naming the EXP-005 hazard by name |

---

## Structural fix points

These are the high-leverage code locations where a single change closes
multiple Phase 4 findings. Each names the EXP-IDs it would close.

### 1. `Buffers::read_array<LockfileArrayElem>` bound (Section L)

**Scope:** `src/install/lockfile/Buffers.rs:104-178`

**Mechanism:** introduce `unsafe trait LockfileArrayElem: Copy` with hand-audited
impls per allowable lockfile column type; require `T: LockfileArrayElem` on
`read_array`. Closes:

- **EXP-036 (NEW-V-2)** — `read_array::<PatchedDep>` bool validity
- Hardens any future `T` carrying `bool`/`char`/`enum` payload (auditor wall)

**Does NOT close** (per Section L Phase-1 correction, preserved here):
EXP-003, EXP-005, EXP-006, EXP-007 — those land at `Package::load_fields`
typed-column memcpy, `yarn.rs` uninit slice, and `Tree.rs:1020` unchecked
index respectively, **not** at `read_array`.

### 2. Dirent migrate POSIX `Name` → owned `IteratorResult` (Section P)

**Scope:** `src/sys/lib.rs:154-159, 183-192, 207-221, 322, 391, 513, 804-808` (POSIX dir_iterator parser + safe accessors)

**Mechanism:** migrate POSIX parser to the Section D owned-result template
(`IteratorResult { name: PathString, kind }`) instead of `Name { ptr,
len }` lifetime-erased borrow. Closes:

- **F-DR-10 / EXP-081** (POSIX `Name` lifetime-erased safe dangling-slice API; not merely a cross-thread watchlist)
- **EXP-027** Windows cousin remains (Windows uses `IteratorResultWName.RawSlice<u16>` — separate fix)
- Hardens 6 Section P consumers (`glob`, `shell::builtin::{ls,rm}`, `publish_command`, `walker_skippable`, `path_watcher`) with **no consumer-side change required**

### 3. PR #30765 batch (open PR)

**Scope:** `src/threading/guarded.rs:132-134`, `src/ast/nodes.rs:339-340`, `src/errno/linux_errno.rs:192`

**Mechanism:** the open PR carries three soundness fixes:
- `GuardedLock` `_not_send: PhantomData<*const ()>` marker
- `StoreSlice<T>` Send/Sync bounds (`T: Send` / `T: Sync`)
- Linux `impl GetErrno for usize` routed through `SystemErrno::init` checked path

Closes (when landed):
- **EXP-002** (linux_errno transmute)
- **EXP-018** (GuardedLock)
- **EXP-019** (StoreSlice<T>)
- Adjacent siblings: **EXP-045** (JsCell<T>) gets one-line same-shape fix as a follow-up

### 4. `TaggedPtr::get`/`TaggedPtr::to` centralised provenance fix (Section N)

**Scope:** `src/ptr/tagged_pointer.rs:53-64`

**Mechanism:** the strict-provenance-clean fix is a typed representation
carrying `NonNull<T>` plus separate tag metadata. A lower-diff
`ptr::with_exposed_provenance` rewrite can document today's exposed-address
dependency and keep default Miri clean, but it does **not** close the
strict-provenance gate.

Directly closes / hardens (depending on whether the typed representation or
the interim exposed-provenance annotation is chosen):
- **EXP-048 / F-P-4** (`TaggedPtr::get/to`)
- Any true `TaggedPtrUnion::{get,as_unchecked,ptr,ptr_unsafe}` caller
- **F-A-1** (Sink.rs:1232) only after the explicit `.as_uintptr()` escape is rewritten too; `TaggedPtr::get/to` alone does not touch that method
- Does **not** close **F-P-1/F-P-2/F-P-3/F-P-8/F-P-9/F-P-10/F-P-11/F-P-12/F-P-17** (custom packers / layout-only slots), **F-P-5/F-P-6/F-P-15** (reviewed FFI numeric-pointer boundaries), **EXP-050** (ZigString — separate representation), **EXP-049** (`StringOrTinyString` bytes — separate representation), or **EXP-096** (`SmolStr` packed pointer bits — separate representation)

### 5. `from_field_ptr!` `&mut Parent` → `*mut Parent` macro mode (cluster)

**Scope:** `src/bun_core/lib.rs:699-863` (macro definition); 13 raw-enumerated `&mut Parent` call sites, of which 9 remain still-risky after the dispatch io_poll demotion

**Mechanism:** make the macro **always** return raw `*mut Parent`; force
every call site to opt-in to `&mut *raw_parent` reborrow with a per-site
SAFETY comment.

Closes (substantially):
- **EXP-028** (DirectoryWatchStore::owner)
- **F-A-2** (95-site cluster; remaining risky shapes flip to raw)
- Hardens the bundler worker-thread parent recovery tracked under **F-A-2 / EXP-069**

Does **not** need to close F-A-12 / F-21-6: the dispatch.rs io_poll subset
was source-audited and demoted for aliasing; its remaining issue is the
strict-provenance pack/unpack in F-P-9.

### 6. EXP-012 fix-model propagation (Section F + bundler + timer)

**Scope:** `src/runtime/timer/mod.rs:897, 1016`; `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`; `src/runtime/socket/WindowsNamedPipe.rs:1432-1445`; `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; `src/jsc/rare_data.rs:864-891`; `src/jsc/event_loop.rs:455-507`; `src/runtime/api/bun/h2_frame_parser.rs:1850-1981`

**Mechanism:** flip `&mut self` receivers → `this: *mut Self`; use
`ThisPtr` + `ref_guard` RAII bracket where lifetimes can re-enter.

Closes:
- **EXP-026** (timer::All re-entry)
- **EXP-044** (bundle_v2 self.bv2 reborrow; CONFIRMED_UB)
- **F-21-2** (WindowsNamedPipe `borrow = mut` → `borrow = ptr`)
- **EXP-106** (PipeWriter parent callback re-entry into `writer.with_mut`)
- **EXP-107** (RareData watcher cleanup callback re-entry)
- **EXP-108** (EventLoop JS callback re-entry)
- **EXP-110** (h2 `Stream::queue_frame` write-callback re-entry)

---

## Multi-agent disagreements requiring adjudication

### Disagreement 1: Section L vs Bucket-4 sweeper on `Buffers::read_array<T: Copy>` structural-fix claim

- **Section L (Phase 1 note `L_install.md`)**: explicitly states `Buffers::read_array<T: Copy>` is **NOT** a universal fix-point for the four PUB-INSTALL witnesses (EXP-003/005/006/007). Those land at `Package::load_fields`' typed-column memcpy, the yarn uninit slice, and `Tree.rs:1020` unchecked index respectively.
- **Bucket 4 sweeper (`phase2_findings_04_validity.md` §3.2)**: agrees with Section L's correction; identifies `read_array<PatchedDep>` as the strongest current witness whose `T` carries a validity-bearing field (`bool`), but states the `read_array` fix would harden this one path, **not close the anchored witnesses**.
- **Prompt's "EXP-019 (Buffers.rs structural fix)" framing**: conflates two artefacts — the registry's actual EXP-019 is `StoreSlice<T>` Send/Sync (Bucket 8), unrelated to `read_array`.
- **Synthesizer verdict (this file):** Section L + Bucket 4 are aligned and correct. The `LockfileArrayElem` bound on `read_array<T>` is a **legitimate structural fix** but only for the `PatchedDep`-class path (newly registered as **EXP-036**). It does **not** retroactively close EXP-003/005/006/007. Do **not** renumber EXP-019 or claim it covers `read_array`.

### Disagreement 2: EXP-028 (`DirectoryWatchStore::owner`) — author TODO vs canonical implementation

- **Phase 1 Section G + EXP-028 registry entry**: author wrote in-source `TODO(port): unsound under stacked borrows` in `src/runtime/bake/DevServer/DirectoryWatchStore.rs`.
- **Phase 3 (path-a) reproducer**: minimal Tree-Borrows model mirroring source shape **ran clean**. A deliberately stronger model where a parent-borrowing RAII guard stays live while `self` is used **fails to compile** under Rust's borrow checker (current `ThreadLock::lock()` returns `()`, not an RAII borrow).
- **Phase 5 source audit**: current canonical `crate::bake::dev_server::DirectoryWatchStore` is defined in `src/runtime/bake/dev_server/mod.rs`, not in the TODO-marked draft type. The canonical `owner(&mut self)` already returns `*mut DevServer` (`mod.rs:1013-1023`) and the later call sites explicitly reborrow disjoint fields. `rg` found no call sites of `directory_watch_store_body::DirectoryWatchStore`.
- **Bucket 1 sweeper (`phase2_findings_01_aliasing.md`)**: includes this in the `F-A-2` enumeration of `from_field_ptr!` sites that return `&mut Parent`; the dispatch io_poll subset has since been demoted separately after source audit.
- **Synthesizer verdict:** demote EXP-028 to **NO_EVIDENCE / stale-draft hygiene** for current production source. The author TODO is real, but it is no longer evidence that the live `DirectoryWatchStore` path returns `&mut Parent`. S3 remains the right macro-mode remediation for the broader F-A-2 cluster, but it should not claim to close EXP-028 as a live production bug.

### Disagreement 3: Phase 2 Bucket-23 vs Phase 1 Section C on `pack_command.rs:3009`

- **Phase 1 Section C inventory**: PASS5 U1 site at `pack_command.rs:3009` (cast-away-const → `&mut` on `ctx.command_ctx`) is **UNCHANGED**; "single-threaded CLI dispatch" social invariant keeps it sound.
- **Phase 2 Bucket-23 sweep**: confirms "no strict `.rodata` writes" workspace-wide; heap-backed const-strip sites are bucket 1+14 primary, 23 secondary.
- **Phase 2 Bucket-14 sweep**: `repl::vm_mut` (`F14-B`, **EXP-042**) and `Scanner::resolve_dir_for_test` (`F14-C`, **EXP-043**) are MUST-BE-UB; `pack_command.rs:3009` is NOT in this MUST-BE-UB cluster (it's a different shape: pre-existing forge in CLI single-thread context, not a `&T → &mut T` forgery returned to caller).
- **Synthesizer verdict:** Section C's "single-threaded CLI dispatch" argument is **bucket-7 (race) reasoning**, which does NOT discharge bucket-1 (aliasing) / bucket-14 (`*const T` mutation). However, the site is reachable only via CLI single-thread path, never via JS-API; **classify as LIKELY-UB-LATENT** in this synthesis (no current production caller will fire the Tree-Borrows hazard). Track as a Phase-11 audit candidate, not a Phase-5 priority experiment. **Not promoted to a new EXP** because EXP-042 (repl::vm_mut) and EXP-043 (Scanner) already cover the MUST-BE-UB members of this family.

---

## Cross-section pattern clusters

### Cluster A: 95-site `from_field_ptr!` enumeration

Workspace `rg 'from_field_ptr!' --type rust src/` finds **95 invocations** across the bundler, runtime, http, jsc, event_loop, io, and bake crates. Stratified by aliasing-overlap shape (Bucket 1 F-A-2):

- **13 sites return `&mut Parent`** in the raw enumeration; after source audit, dispatch.rs's 4 io_poll sites are reviewed/demoted for aliasing, leaving the non-dispatch subset as the real EXP-069 target.
  - `bake/DevServer/DirectoryWatchStore.rs:69-81` (EXP-028; stale Phase-A draft, no canonical call sites found)
  - `dispatch.rs:794, 799, 823, 828` (F-A-12 / F-21-6; reviewed/demoted for aliasing, strict-provenance tracked by F-P-9)
  - `bundler/ParseTask.rs:354, 362`, `ServerComponentParseTask.rs:76`, `DeferredBatchTask.rs:46`
  - `linker_context/prepareCssAstsForChunk.rs:58`, `generateCompileResultForHtmlChunk.rs:56`, `LinkerContext.rs:1407, 1441, 1711`
  - `jsc/AsyncModule.rs:401`, `http/AsyncHTTP.rs:970`
- **~82 sites return raw `*mut Parent`** (sound mode)

**Action:** Structural fix point #5 (force all callers through raw return). Single macro change closes the 9 still-risky sites and hardens the 4 dispatch sites; per-site SAFETY comments needed at each `&mut` reborrow.

### Cluster B: unbounded / under-bounded generic `Send`/`Sync`

(Bucket 1 F-A-8 / Bucket 8 F-S-1/2/3 + EXP-019)

- `src/ast/nodes.rs:339-340` — `StoreSlice<T>` (EXP-019, CONFIRMED_UB)
- `src/jsc/JSCell.rs:126-128` — `JsCell<T>` (EXP-045, CONFIRMED_UB)
- `src/runtime/dns_jsc/dns.rs:104-107` — `SendPtr<T>` (covered)
- `src/bundler/BundleThread.rs:170-173` — `SendPtr<T>` (covered)

Plus 3 partially-bounded / auditor-fragile classes:
- `AtomicCell<T: Copy>` — `Copy ≠ Send`; EXP-098 proves the `new()` + `into_inner()` path bypasses `T: Atom` method gating (F-DR-7/F-S-4 CONFIRMED_UB generic contract)
- `ThreadCell<T>` Sync unbounded (F-DR-8/F-S-5 — EXP-047 `NO_EVIDENCE`; project-UB claim demoted; hardening only)
- `RacyCell<T>` Sync unbounded (F-DR-9/F-S-6 — EXP-047 `NO_EVIDENCE`; project-UB claim demoted; hardening only)

Plus 2 trait-bounded-Context-without-Send:
- `WorkTask<C>` (F-S-8 — EXP-046)
- `ConcurrentPromiseTask<C>` (F-S-9 — EXP-046)

**Action:** PR #30765 batch (structural fix point #3) is the right vehicle. Single mechanical change closes the unbounded sites once template is established.

### Cluster C: ~1610-site `*mut Self` callback pattern with Section F as densest concentration

Workspace `rg 'unsafe fn .*\(this: \*mut Self' --type rust src/` finds **337 callback signatures** using the canonical EXP-012 fix model. Section F (server + jsc_hooks) is the densest concentration at **808 unsafe sites** total / **~93 `*mut Self` shapes**.

23 of 26 callback consumers fully apply EXP-012; **4 have remaining callback holes**:
- `timer::All` (EXP-026)
- `BundleV2` plugin path (EXP-044)
- `WindowsNamedPipe` `borrow = mut` (F-21-2)
- `PipeWriter` writer-completion methods (EXP-106)

Plus the c-ares family rests on the **load-bearing** `const _: () = assert!(size_of::<Channel>() == 0)` invariant (F-21-3).

**Action:** Structural fix point #6 (EXP-012 propagation) closes the 3 remaining callback holes. F-21-3 should be promoted to a documented EXP to survive future refactors.

### Cluster D: strict-provenance / numeric-pointer family

Table-defined family spanning F-A-1, F-P-1..F-P-16, F-L-12, and EXP-029. Do not compress this to a single site count: the rows mix true strict-provenance failures, reviewed FFI numeric-pointer boundaries, layout-only integer-as-value slots, and separate representation rewrites.

- **Centralised library helper:** F-P-4 (TaggedPtr::get/to) — EXP-048
- **Tag-bit OR/mask pack-and-mask:** F-P-1, F-P-2, F-P-8, F-P-9, F-P-10, F-P-12, F-P-16 (ZigString — EXP-050), EXP-029 (EnvStr)
- **Byte-buffer pointer reconstruct:** F-P-13 (`StringOrTinyString` — EXP-049)
- **Packed-string pointer bits:** F-P-17 (`SmolStr` — EXP-096)
- **FFI-exposed unavoidable:** F-P-5 (DecodedJSValue), F-P-6 (Blob JS Number), F-P-11 (ParsedSourceMap), F-P-15 (FFIObject)

**Action:** Structural fix point #4 fixes the true `TaggedPtr` helper and gives the template for related custom packers, but it does not by itself collapse every Cluster-D row. F-P-1/F-P-2/F-P-3/F-P-8/F-P-9/F-P-10/F-P-11/F-P-12/F-P-17 need per-site rewrites or a second abstraction; FFI numeric-pointer rows remain reviewed boundary cases. EXP-049 (`StringOrTinyString`), EXP-050 (ZigString), and EXP-096 (`SmolStr`) need separate representation changes. Strict-provenance is a **release-gate decision**, not a runtime-UB classification — none of these cause default-Miri UB.

### Cluster E: 17-site `fn(&self) -> &'a mut T` cluster (F-L-1)

(Bucket 15)

17 sites across install/, http/, sql_jsc/, runtime/node/, runtime/bake/,
runtime/test_runner/, io/. Every site forms `&'a mut *self.field_raw_ptr`
with caller-chosen unconstrained `'a`. **EXP-057.**

**Action:** Audit each site for two-interleaved-call hazard; mechanical fix is to return `*mut T` and require call-site `unsafe { &mut *p }` reborrow (same model as `from_field_ptr!` cluster A).

---

## Convergence prep notes

### Phase 5 experiment-executor queue / results

**Tier-1 (must-run, prove the registry's NEW MUST-BE-UB entries):**

| EXP-ID | site | reproducer status | tool |
|--------|------|-------------------|------|
| EXP-030 | ThreadPool::Queue cache | loom model ran clean; registry `NO_EVIDENCE` | loom |
| EXP-031 | WatcherAtomics triple-buffer | loom model ran clean; registry `NO_EVIDENCE` | loom |
| EXP-032 | WebWorker Cell cross-thread | loom race model clean; registry `NO_EVIDENCE` after conceptual correction that `!Sync` alone is not UB | loom |
| EXP-033 | Channel::try_read_item | `Channel<bool>`-shape Miri stub confirmed uninit `&mut [T]` validity UB | Miri |
| EXP-034 | migration.rs set_len | same shape as EXP-005, confirmed | Miri |
| EXP-035 | StandaloneModuleGraph 4-enum | same shape as EXP-003, confirmed | Miri |
| EXP-036 | read_array<PatchedDep> | bool validity reproducer confirmed | Miri |
| EXP-038 | AnyTaskJob panic-safety | unwind-model leak/Drop-skip witness retained; current Bun `panic = "abort"` profiles demote production UB to NO_EVIDENCE | runtime/Miri |
| EXP-039 | Listener.rs ptr::read/forget | registry `NO_EVIDENCE` for current production UB; source-faithful Miri witness double-drops `Handlers` only in an unwind-enabled model | Miri |
| EXP-041 | WebSocketServerContext::active_connections | minimal `addr_of!.cast_mut().*p = ...` confirmed | Miri TB |
| EXP-042 | repl::vm_mut | `from_ref(&vm).cast_mut(); &mut *p` confirmed | Miri TB |
| EXP-043 | Scanner::resolve_dir_for_test | sibling-shape confirmed | Miri TB |
| EXP-044 | bundle_v2 self.bv2 reborrow | plugin re-entry harness confirmed | Miri TB |
| EXP-051 | BunLoader transmute | hostile-host-input transmute confirmed | Miri |

**Tier-2 (high-value type-system / Send-Sync witnesses):**

| EXP-ID | site | reproducer | tool |
|--------|------|------------|------|
| EXP-045 | JsCell<T> Send/Sync | `assert_impl_all!(JsCell<Cell<u32>>: Send)` compile-time + Miri race | compile + Miri |
| EXP-046 | WorkTask<C> / ConcurrentPromiseTask<C> | impl-walker enumerates `!Send` Context types | compile |
| EXP-047 | ThreadCell/RacyCell unbounded Sync | safe-boundary check: safe sharing compiles, raw-pointer send fails; old Miri race required caller-side unsafe deref | cargo check + Miri context |
| EXP-048 | TaggedPtr fix-point | F-P-4 mirror under `-Zmiri-strict-provenance` | Miri strict |
| EXP-049 | `StringOrTinyString` bytes reconstruct | byte-buffer-as-ptr Miri strict mirror | Miri strict |
| EXP-050 | ZigString tag-bit mark/untag | EnvStr-shaped mirror | Miri strict |
| EXP-096 | `SmolStr` packed pointer bits | packed-`u128` pointer-bit mirror | Miri strict |

**Tier-3 (FFI contract drift; deferred to Phase 11 soak):**

| EXP-ID | site | tool |
|--------|------|------|
| EXP-053 | Source::get_handle bypasses UvHandle | `unsafe trait UvHandle` impl-walker |
| EXP-054 | NAPI struct layout | C-side reflector + build script |
| EXP-055 | HandleType discriminant | per-variant const-assert generator |

**Tier-4 (panic-safety follow-ups; runtime witness):**

- EXP-040 (S3HttpSimpleTask Drop trip-hazard) — post-reclaim panic-injection model; registry verdict is `NO_EVIDENCE` for current production UB, retained as a future-reclaim regression guard
- EXP-058 (source_writer_escape 2-call hazard) — TSan double-yield
- EXP-059 (bun_alloc::Mutex stack-construction hazard) — API-misuse witness

### What Phase 6 (idea-wizard) should prompt for (project-shape priors)

Anchor the project-shaped UB-detection-techniques prompt with these
Bun-specific priors:

1. **`bun_core::heap::{into_raw, take, destroy}` 3-fn centralisation** — single chokepoint for global-allocator `Box::from_raw`/`into_raw`. Idea-wizard targets: alternate paths that bypass this chokepoint, e.g. raw `Box::leak` sites uncovered in F-L-11.
2. **`bun_ptr::detach_lifetime{,_ref,_mut}` 168-occurrence cluster** — best-in-class lifetime-launder containment. Idea-wizard targets: per-call-site checkable contracts (a `'lt!()` proc-macro that pairs `detach_lifetime_X(&'a T)` with a `'a`-bound consumer).
3. **`bun_libuv_sys::assert_size!/assert_offset!` gold-standard layout discipline** — 74 asserts cross-validated against runtime `uv_*_size()`. Idea-wizard targets: propagate to napi/windows_sys/boringssl (F-10-2/4/5).
4. **uSockets `RawPtrHandler<T>` two-mode adapter** (Section E note) — the codebase's canonical mechanical-EXP-012 propagation surface. Idea-wizard targets: generalise to a `BorrowMode<Ptr|Mut|Shared>` per-callback macro.
5. **`bun_ast::Ref` 64-bit packed identifier** — Hash/Eq drift (F-L12-1). Idea-wizard targets: a `#[repr(transparent)] Ref(NonZeroU64)` with a `normalize()` accessor that compile-error-forbids hashing the unnormalized form.
6. **`bun_threading::Channel<T, B>`** — generic `B` trait carries no Send/Sync bound. Idea-wizard targets: typed `LockFreeBuffer` trait with required Send bound.
7. **`unsafe impl Linked` intrusive-queue stamps (Section P)** — macro-emitted (`impl_streaming_writer_parent!`); 215 ref_guard/ref_scope sites. Idea-wizard targets: an `IntrusivePool` macro that requires per-callback re-entry-mode annotation.
8. **CLAUDE.md "Arena gotcha"** (`Vec<T, AstAlloc>` skip Drop on reset) — audited by EXP-016 and demoted for current source: `G::Property` is destructor-bearing via `MDot(Vec<Ref>)`, but current evidence is leak-only rather than UB. Idea-wizard target EXP-066 remains useful as a future-proof type-system check.
9. **The 23 of 26 fully-applied EXP-012 fix-model consumers** — best-in-codebase mechanical-fix propagation. Idea-wizard targets: extract a `#[bun_callback]` proc-macro that generates the boilerplate (`ThisPtr` + `ref_guard` + `let _guard = ...`).
10. **JS-thread-affinity through 4 layers** (VirtualMachine `Sync` → JsCell `unbounded T` → WebWorker `Cell<*mut>` → BackRef `&self → get_mut`). Idea-wizard targets: a `JsThreadAffine` marker trait that compile-error-rejects `spawn` of any `&JsThreadAffine`-capturing closure.

### What Phase 11 (soak) should campaign

**Long-running campaigns (per `phase3_dynamic_findings.md` Path c plan):**

| Campaign | Configs | Targets |
|----------|---------|---------|
| **Miri matrix** | 4 configs (default SB / tree-borrows / strict-provenance / symbolic-alignment-check) × full Bun test suite | EXP-001..EXP-021 + EXP-026..EXP-029 + EXP-030..EXP-060 mirror set; EXP-061..EXP-071 idea-wizard additions get per-technique tooling; EXP-072 has a dedicated HiveArray uninit-slot witness |
| **TSan / ASan** | full suite per sanitizer | EXP-030, EXP-031, EXP-032, EXP-038, EXP-060; EXP-017 only as a future-regression guard if callback rewrites move after queue publication |
| **Loom models** | per-primitive | EXP-030 (ThreadPool::Queue), EXP-031 (WatcherAtomics), EXP-032 (WebWorker Cell), EXP-052 (UnboundedQueue), F-DR-2 (Channel) |
| **Shuttle** | for primitives where loom blows up | EXP-060 finalizer/env-teardown subcase (primary raw-handle `&mut` bug already Miri-confirmed) |
| **24h fuzz** | per Bucket-4 lockfile / Bucket-6 hostile-host-input target | EXP-007 (Tree.rs get_unchecked attacker-controlled), EXP-035 (StandaloneModuleGraph tampered binary), EXP-036 (PatchedDep bool), EXP-051 (BunLoader hostile host); EXP-037 stays as a Windows watcher regression check, not a current fuzz target |
| **Layout-assert build-script** | C-side reflector emits sizeof of each `#[repr(C)]` POD; CI gate | EXP-054 (NAPI), F-10-4 (Win32), F-10-5 (BoringSSL) |
| **Workspace ast-grep audits** | enumerate `RacyCell<Cell<X>>`, `WorkTaskContext` impls, BSSList field-privacy/accessor drift, `Mutex::new()` stack-construction sites | EXP-046, EXP-047, F-DR-6, EXP-059 |

**Wide-net soak (Phase 11 specific):**

- 10⁴+ loom iterations against EXP-030..EXP-032 + EXP-052
- Multi-day Miri over full test suite under each MIRIFLAGS configuration (rch worker-a/b tagged `bun,go,rust`)
- Windows watcher torture (Section G open question #2 — `ReadDirectoryChangesW` completion vs `Box<Watcher>` free race)
- Adversarial wyhash collision fuzzing against `EffectiveUrlContext` (F-L12-3 correctness drift)

---

## Final counts (Phase-4 table plus Phase-5/7/11 status note)

- **Unified rows:** 182 data rows (170 `F-*` rows + 12 `NEW-*` rows, including CLEAN/REVIEWED rows).
- **Important interpretation:** the Phase-4 table preserves historical row severities/statuses for traceability. It is a synthesis table, not the authoritative current verdict counter. Rows that were later proved, demoted, deferred, or subsumed intentionally retain their original context.
- **Current source-of-truth registry totals after the Codex EXP-109 source-root-graph correction:** 70 `CONFIRMED_UB`, 0 `OPEN`, 0 `NEEDS_REFINEMENT`, 17 `NO_EVIDENCE`, 17 `DEFERRED`, and 2 `RESOLVED` across 106 EXP entries.
- **Current table parse sanity checks:** 0 status-column `OPEN` rows, 15 `CLEAN` rows, and 58 `REVIEWED*` status rows.
- **Late promotions reflected here:** F-NF20-2 and F-NF20-3 were promoted to EXP-092 and EXP-091 respectively and Miri-confirmed; the old PE `EXP-022` alignment candidate is now EXP-093; EXP-094 records the in-tree `DoublyLinkedList<T>` Miri failure; EXP-095 records the Mach-O byte-backed typed-reference mutation failure; F-P-17 / EXP-096 records the separate `SmolStr` strict-provenance representation split; F-NF6-4 / EXP-097 records the safe errno `from_raw` invalid-discriminant API defect; F-DR-7 / F-S-4 / EXP-098 records the `AtomicCell<T: Copy>` unbounded auto-trait defect; F-026b / EXP-099 records the node-cluster IPC singleton re-entry `&mut self` defect; F-026c / EXP-100 records the `UpgradedDuplex` / `SSLWrapper` callback re-entry receiver defect; F-026d / EXP-101 records the remaining `ProxyTunnel::shutdown(&mut self)` receiver defect; F-026e / EXP-102 records the remaining `ProxyTunnel::write(&mut self, ...)` receiver defect; F-026f / EXP-103 records the remaining `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` receiver defects; F-026g / EXP-104 records the `WindowsNamedPipe` / `SSLWrapper` receiver-protector defect where `WRAPPER_BUSY` prevents wrapper drop but not aliasing through protected whole-struct receiver entry points; F-026h / EXP-106 records PipeWriter parent-callback writer re-entry; F-026i / EXP-107 records RareData watcher cleanup callback re-entry; F-026j / EXP-108 records EventLoop callback-runner re-entry; F-026k / EXP-110 records h2 `Stream::queue_frame` write-callback re-entry; F-010b / F-DR-12 / EXP-111 record the bundler part-range fan-out defect: default Miri confirms concurrent whole-`Chunk` `&mut` retags, and the mutable renamer view is a separate author-acknowledged TODO. EXP-109 is tracked as `NO_EVIDENCE` after source review proved the `JSCallback` path is rooted by `JSC::Strong`. Use `FINAL_UB_REPORT.md` and `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` for current registry verdict totals.
- **New EXP entries appended (this Phase 4):** 31 (EXP-030 .. EXP-060, skipping nothing inside that range)
- **Phase 3/5 verdict transitions relayed to orchestrator:** EXP-006 / EXP-007 / EXP-008 / EXP-009 / EXP-073 / EXP-074 / EXP-075 / EXP-076 / EXP-077 / EXP-078 / EXP-079 / EXP-080 / EXP-081 / EXP-082 / EXP-083 / EXP-084 / EXP-085 / EXP-086 / EXP-097 / EXP-098 / EXP-099 / EXP-100 / EXP-101 / EXP-102 / EXP-103 / EXP-104 / EXP-106 / EXP-107 / EXP-108 / EXP-110 / EXP-111 → CONFIRMED_UB; EXP-109 → NO_EVIDENCE after the `FFICallbackFunctionWrapper` / `JSC::Strong` root-graph correction; EXP-020 / EXP-029 / EXP-048 / EXP-049 / EXP-050 / EXP-096 → DEFERRED as strict-provenance release-gate failures; EXP-028 (legacy on-disk EXP-022) → NO_EVIDENCE after canonical-vs-draft source audit

Source-of-truth files referenced:

- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase0_run.json`
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase0_partition.json`
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase0_preflight.md`
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_unsafe_surface_inventory.md`
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_notes/{A..U}*.md` (24 files)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase2_findings_{01..25}_*.md` (25 files)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase3_dynamic_findings.md`
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`
