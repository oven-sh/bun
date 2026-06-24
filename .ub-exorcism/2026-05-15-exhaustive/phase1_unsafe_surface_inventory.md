# Phase 1 Unsafe-Surface Inventory — Run 2026-05-15-exhaustive

> Source-of-truth aggregate. Each Phase-1 subagent appends its row block under the
> `## Section <ID>: <name>` heading below. The orchestrator merges per-section
> inventories (`phase1_inventory_<id>.md`) into this file at end of Phase 1.

| Column | Meaning |
|--------|---------|
| `file:line` | source location |
| `site_kind` | unsafe block / unsafe fn / unsafe impl Send/Sync / extern "C" decl / #[no_mangle] / #[repr(C\|transparent\|packed)] / atomic / custom Drop / MaybeUninit / transmute / from_raw / set_len / assume_init / get_unchecked / Pin::new_unchecked / UnsafeCell / intrinsics / hint::*_unchecked / mem::forget / mem::zeroed / mem::uninitialized / raw ptr::* / static_assertions |
| `bucket(s)` | multi-tag from UB-TAXONOMY.md (1..25) |
| `safety_status` | PRESENT_STRONG (>40 char, names invariants) / PRESENT_WEAK / MISSING |
| `macro_status` | SOURCE_DIRECT / MACRO_GENERATED |
| `prior_audit_id` | matching S-NNNNNN site ID from `.unsafe-audit/unsafe-inventory.jsonl` (or `n/a`) |
| `notes` | <= 1 line of context |

---

(Section bodies populated by per-section subagents.)

## Section A: runtime-webcore
Inventory: `phase1_inventory_A.md`. Notes: `phase1_notes/A_runtime_webcore.md`.
Sites: **604** (matches prior audit; delta 0). Dominant buckets are
aliasing/FFI-callback raw-parent patterns, refcount lifecycle, and byte-buffer
reinterpretation. Anchor: EXP-004 / UB-RT-001
(`runtime/webcore/encoding.rs:303-310`) remains the webcore Vec-layout
finding. No unsafe Send/Sync impls in this section. SAFETY-comment coverage
is ~77% strong, ~14% weak, ~9% missing; missing sites are mostly helper
blocks whose invariant is named one layer up.

## Section B: runtime-api
Inventory: `phase1_inventory_B.md`. Notes: `phase1_notes/B_runtime_api.md`.
Sites: **~573** (prior 531; **+42**, ~+8 %). SAFETY-comment coverage 467/573 ≈ **81 %**.
**Zero `transmute` calls section-wide.** **Refcount lifecycle pairing audit: clean** —
28 `bun_core::heap::into_raw` / 4 `Box::from_raw` / 1 `Vec::from_raw_parts` / 2
`IntrusiveRc::from_raw` / 1 `BackRef::from_raw` / 2 `mem::forget` / 7 `ManuallyDrop`
sites, all paired and documented, **no orphans found**. `subprocess.rs:124-129`
contains the explicit anti-pattern annotation `"Arc::from_raw on a Box allocation
is UB"` justifying `BackRef<Process>` over `Arc`. Only **1 `unsafe impl Send`**
(`js_bundle_completion_task.rs:106` — names the UnboundedQueue+Waker handshake
as the synchronization mechanism); 0 `unsafe impl Sync`; 4 `unsafe impl
bytemuck::Pod/Zeroable` on `#[repr(C, packed)]` wire-layout types (h2_frame_parser
StreamPriority + FullSettingsPayload) all carry "no padding, no niches" SAFETY
arguments. **No `&packed.field` references** anywhere (E0793-safe). The canonical
`*mut Self` re-entrant callback shape from Section F is replicated across 9 type
clusters in B (CronJob, BufferOutputSink, DocumentHandler / ElementHandler /
EndTagHandler, JSBundleCompletionTask, AsyncTask, MatchedRoute, JSBundlerPlugin
callbacks, Terminal init_terminal/free, Subprocess on_abort_signal) — same R-2
discipline, every site centralizes `*mut Self → &Self`/`&mut Self` behind one
documented helper (`from_ctx_ptr`/`bv2_mut`/`route()`/`transpiler_mut`/`promise_value`).
The lone Pin/self-referential cluster is `MatchedRoute` (filesystem_router.rs:706-822)
which uses `UnsafeCell` holders plus `Vec::from_raw_parts(ptr.cast::<Param<'static>>(),
len, cap)` for lifetime erasure rather than `Pin::new_unchecked`. **No anchored
Phase-0 witness for B**, but Phase 2 should still spin up Bucket 1/9/13/21/22
sweepers — those four buckets dominate the section's surface. Top tightening
opportunities: (1) cron.rs SAFETY-per-block ratio (53/163) where many `*mut Self`
callbacks share upstream PORT NOTE blocks — Phase 2 should verify per-line
coverage; (2) Terminal.rs dlopen/dlsym implicit "dlsym returned non-null
fn-pointer of declared signature" SAFETY; (3) `bun/spawn/stdio.rs:650`
`bun_core::ffi::zeroed::<uv::Pipe>()` missing inline SAFETY (libuv contract is
sound but undocumented). FFI ABI handshake: `jsc_host_abi!` in BunObject.rs
correctly selects `extern "sysv64"` on Windows-x64 to match C++ `SYSV_ABI`
across all 63 `BunObject_callback_*` / `BunObject_lazyPropCb_*` exports. The
`opaque_ffi!` ZST pattern (Plugin, AbortSignal, JSGlobalObject, JSPromise,
JSObject, BoringSSL handles) lets JSBundler's `unsafe extern "C"` block use
`safe fn` for 7 of 8 declared symbols — only `JSBundlerPlugin__create` returns
a raw `*mut Plugin`.

## Section C: runtime-cli
Inventory: `phase1_inventory_C.md`. Notes: `phase1_notes/C_runtime_cli.md`.
Sites: **518** keyword occurrences (prior 479; **+39 ≈ +8 %**) across 37
of 58 `.rs` files. Composition: 498 `unsafe { … }` blocks, 11 `unsafe extern`
blocks/fns, 3 `unsafe fn` decls (only one `pub`: `mod.rs:857 global_ctx()`,
`# Safety` documented), **0 `unsafe impl` / 0 `unsafe trait`**. SAFETY-comment
density 504 / 518 ≈ 97 %. All sites are **SOURCE_DIRECT** — the section's six
`macro_rules!` (`Arguments.rs:117/134/413`, `run_command.rs:47`,
`src/runtime/cli/filter_run.rs:260`, `src/runtime/cli/test/parallel/runner.rs:36`) stamp **no** `unsafe`
bodies. **fmt::Raw / fmt::raw / fmt::s call sites in section C: ZERO** —
anchor `P3-BC-001` (anchor body at `src/bun_core/fmt.rs:725-732`, section N)
**is NOT reachable from this section today**; argv display is routed through
`bstr::BStr::new(...)` (lossy UTF-8), e.g.
`install_completions_command.rs:322-326`. argv-validity hazard is latent
(could re-emerge if a future caller routes `bun_core::argv()` bytes through
`fmt::raw`); proposed CI guard noted in inventory. PASS5 U1 site
**`pack_command.rs:3009`** (cast-away-const → `&mut` on `ctx.command_ctx`)
is **UNCHANGED** — only the "single-threaded CLI dispatch" social invariant
keeps it sound. Dominant pattern: `zig_port_mut_ref` (`unsafe { &mut *ptr }`
reborrows of `*mut Transpiler`/`*mut Log`/`*mut PackageManager`/`*pm_raw`)
at 90 sites; ≈ 25 of those go through
`bun_options_types::context::global_ptr()` and would benefit from a typed
`GuardedBy<ContextData, SingleThreadMarker>` to make the
`pack_command.rs:3009` regression class compile-error-rejectable. Secondary
pattern: ≈ 12 `bun_core::RacyCell` static scratch buffers
(`SHELL_BUF`, 5× create_command path/URL buffers, `THREAD`,
`WORKER_FRAME`/`WORKER_CMDS`) all with comment-only "single-threaded"
SAFETY. **No unsafe is on the `bd` build path** — `bd` is a `package.json`
script, not a Bun subcommand; `build_command.rs` (the bundler subcommand)
contributes only 3 unrelated raw-deref sites. Concurrency: `unsafe impl
Send/Sync` count = 0, matching the partition's `concurrency: no` prior
(test-parallel coordinator IPC is inter-process over uv pipes, not
inter-thread). Suggested cleanup wins:
`bunx_command.rs:{866,1038,1310,1363}` `slice::from_raw_parts(buf, written)`
→ `&buf[..written]` (no provenance dependency);
`src/runtime/cli/test/parallel/Coordinator.rs:{95,573,612}` `base.add(i)` worker-pipe walks
→ safe slice iter.

## Section D: runtime-node-compat
Inventory: `phase1_inventory_D.md`. Notes: `phase1_notes/D_runtime_node.md`.
Sites: **543** (prior ~475; **+68**). Anchor: **dirent-parser-bugs T1 finding does
NOT transfer wholesale to Section D's parser** — `src/runtime/node/dir_iterator.rs`
returns `IteratorResult { name: PathString, kind }` on POSIX (owned, no
lifetime erasure), but `IteratorResultWName { data: RawSlice<u16> }` on Windows
is **lifetime-erased and sendable** because `RawSlice<T>` has `unsafe impl<T:
Sync> Send + Sync` in `src/bun_core/lib.rs:208-212`. The Section D POSIX parser
is the **safer template**; Phase 2 candidate to migrate Section P's 6 consumers
(`glob`, `shell::builtin::{ls,rm}`, `publish_command`, `walker_skippable`,
`path_watcher`) to the owned-result shape and erase the POSIX T1 finding.
Windows needs separate remediation (EXP-027).
Per-platform header reads at `dir_iterator.rs:192/294/395/670/817` use
`read_unaligned` + `addr_of!` with PRESENT_STRONG SAFETY citing `align(1)` +
kernel record contract. **libuv FFI surface**: 3 patterns — (1)
`UVFSRequest<R, A, const F>` async wrapper at `node_fs.rs:698-1074` with
audit-grade Stacked-Borrows discipline at `:988-992` ("`req` aliases `this.req`
… re-deriving through raw `req` would create a second overlapping `&mut`"); (2)
**in-place RAII** `UvFsReq` at `node_fs.rs:311-351` is the canonical Section D
**Pin replacement** (libuv `fs_t` is self-referential — `scopeguard::guard`
would relocate it; doc comment explicit); (3) `uv_signal_t` lifecycle in
`uv_signal_handle_windows.rs` with every block annotated. **Pin discipline:
zero `Pin::new_unchecked`, zero `Pin<T>` sites** — address-stability is
RAII-encoded, not Pin-encoded. **Buffer ↔ Uint8Array** bridging is `buffer.rs`
(`Bun__Buffer_fill`, 5 sites); the heavy encoder UB candidates live in Section
A's `webcore::encoding`, not here. **1 transmute** (`fs_events.rs:164`
`transmute_copy::<*mut c_void, T>` for dlsym fn-pointer typing, const
size-asserted). **10 unsafe Send/Sync impls** total — `CStrPtr` (rodata),
`CoreFoundation`/`CoreServices` (dlopen handle), 3× `Linked` (intrusive
queues), `PathWatcherManager` Send+Sync (UnsafeCell-guarded by `mutex`,
multi-paragraph SAFETY). SAFETY density 491/654 ≈ 75 % — weakest in `node_os.rs`
(libc FFI thunks) and `node_crypto_binding.rs`. **No `mem::forget` in
Section D** — the `heap::release`/`take` pair is the consistent FFI box
discipline.

## Section E: runtime-socket-udp-tcp
Inventory: `phase1_inventory_E.md`. Notes: `phase1_notes/E_runtime_socket.md`.
Sites: **471** (14 files in `src/runtime/socket/`; prior 424; **+47 ≈ +11 %**,
driven by `WindowsNamedPipeContext.rs` two-phase `MaybeUninit + ptr::write`
allocation port +16 and `tls_socket_functions.rs` `safe fn`-style BoringSSL
shim growth +10). SAFETY-comment density **326 / 471 ≈ 69 %** (gap is the
9 `unsafe extern "C" { }` block headers, 7 `#[unsafe(no_mangle)]` attributes,
and the default empty `unsafe fn` bodies in `RawSocketEvents`). **No anchored
witnesses.** **Zero local `unsafe impl Send` / `unsafe impl Sync` rows in
`src/runtime/socket/*.rs`** — the local socket wrappers are single-JS-thread
affine by auto-trait propagation from `Cell` + `JsCell` + JSC `Strong`. Caveat:
`src/runtime/socket/SSLConfig.rs` re-exports `bun_http::SSLConfig`, whose
documented `unsafe impl Send/Sync` lives in `src/http/ssl_config.rs`. **The dispatcher kind→adapter table at
`uws_dispatch.rs:43-79` is the single source of truth for uSockets re-entry
mode per socket kind**; `BunSocketTcp/Tls` → `RawPtrHandler` (`*mut Self`
discipline, EXP-012-shape protected — see `mod.rs:120-128` PORT NOTE on
`socket.write/end/reload` re-derived `&mut` aliasing + `noalias` dead-store),
SQL drivers (Postgres/MySQL/Valkey) and `SpawnIPC` → `NsHandler` / inline
`VHandler` impl (`&mut Owner` — contract-only re-entrancy discipline).
**Top concerns**: (1) `NsHandler::on_writable`/`on_data` hold `&mut Owner`
across `H::on_*` bodies that synchronously call `socket.write` →
re-entry into `try_send` re-derives `&mut Owner` (mechanical-prevention
gap; Section E's most plausible Stacked-Borrows surface); (2)
`WindowsNamedPipe::close`/`shutdown` (`:1176/1216`) use
`core::hint::black_box(from_mut(self))` field-cache launder pattern —
old-style workaround superseded by all-`Cell` design in `NewSocket`
(`socket_body.rs:254`), candidate for migration so the workaround can
drop; (3) the `bun_uws::uws_callback` macro emits `&mut Self`
first-arg `extern "C" fn` thunks (~14 sites in Section E) — should match
`bun_jsc::host_fn` and emit `*mut Self` instead. **UDP scatter-gather
contract**: `recvmmsg`/`sendmmsg` live in Section Q (`bun_uws_sys::udp`);
Section E's `udp_socket.rs:1119-1335` `send_many` two-phase flow is
**best-in-section anti-EXP-005 pattern** — `vec![…; len]` zero-init
explicit ("no `set_len` over uninit memory" comment at `:1210-1211`),
`MarkedArgumentBuffer::run` GC-root trampoline (`extern "C" fn run`
at `:1143`) closes the user-JS-detaches-ArrayBuffer UAF that the
long doc-comment at `:1119-1136` enumerates. `set_multicast_interface` /
`set_source_specific_membership` (`:894-897/1018-1026`) carry explicit
"`assume_init()` on partially-init `sockaddr_storage` is UB" SAFETY
notes — Section E **proactively avoids** the EXP-005 shape. **TLS
FFI discipline**: `tls_socket_functions.rs:67-213` `ffi::` shim block
(~30 BoringSSL decls, mostly `safe fn` over opaque-ZST `&SSL`/`&X509`,
`unsafe fn` only for caller-owned-buffer / +1-ownership cases with
per-decl `// SAFETY (unsafe fn): …`) is the strongest FFI-decl
discipline in Section E. **Best-in-section SAFETY documentation**:
`Handlers::mark_inactive` (`Handlers.rs:234-280`, multi-paragraph
Safety block citing Stacked-Borrows protector UB + dual server/client
allocation contracts + post-return-`this`-dangles caller obligation).
**U2 cross-ref**: NO U2-shape (`from_ref(slice).cast_mut()` →
`heap::destroy`) sites in Section E — clean.

## Section F: runtime-server-and-jsc-hooks
Inventory: `phase1_inventory_F.md`. Notes: `phase1_notes/F_server_jsc_hooks.md`.
Sites: **808** (prior ~762; +46). `runtime/server` and `runtime/jsc_hooks`
dominate. EXP-012's original concrete WebSocket-upgrade `cancel` hypothesis
is falsified/resolved on current source: `WebSocketUpgradeClient::cancel`
already uses `*mut Self`, `ThisPtr`, short-lived raw field access, and a
ref guard before re-entrant close. Remaining Section-F watchpoint is the
broader server/JSC hook re-entry surface, not that specific cancelled path.

## Section G: runtime-bake-dev-server
Inventory: `phase1_inventory_G.md`. Notes: `phase1_notes/G_runtime_bake.md`.
Sites: **322** (prior 295; **+27**, ~+9 %). SAFETY-comment coverage 278/322 ≈ **86 %**.
Composition: 298 `unsafe { ... }` blocks + 23 `unsafe fn` + 1 `unsafe impl Sync`
(`DotenvSingleton` in `production.rs:74`, single-init build-command invariant).
**Zero `transmute`, zero `Pin::new_unchecked`, zero `async fn`/`Future`/`block_on`** —
the Phase-0 "Pin" prior is N/A (audit JSONL `pin_unchecked` tag at S-005476 was a
regex false-positive against `NonNull::new_unchecked`). The 5 `Drop` impls
(`DevServer`, `Assets`, `UserOptions`, `PerThread`, plus the destroy-self
`HmrSocket::on_close` path) are enumerated in §async-Drop hazards; only
`Drop for DevServer` (DevServer.rs:1072) carries non-trivial concurrent state at
teardown — synchronous WS-close cascade dispatching `HmrSocket::on_close`
re-entrantly + `ManuallyDrop::take(&mut self.bun_watcher)` + `Watcher::shutdown`
hand-off where the watcher thread frees the `Box<Watcher>` allocation. The HMR
concurrency surface is the most rigorously-documented in the run: triple-buffered
`HotReloadEvent` slots with a single `next_event: AtomicU8` channel
(Acquire/Release/AcqRel) + structural exclusivity (3 slots, watcher uses ≤2,
DevServer uses ≤1). `graph_safety_lock: bun_safety::ThreadLock` is debug-build
thread-affinity assertion only — NOT mutual exclusion. The WS callback shape
(`bun_uws_sys::web_socket::Wrap` trait impl at DevServer.rs:1443) mirrors
Section F exactly: `*mut Self` receivers in the trait arms, `&mut *this`
reborrowed only inside inherent bodies, `on_close` stays at the pointer level
for the destroy-self path. **Open questions**: (1) EXP-028 `DirectoryWatchStore::owner`
(DevServer/DirectoryWatchStore.rs:69) returns `&mut DevServer` from field
projection via `from_field_ptr!` — self-flagged "unsound under stacked
borrows" TODO(port), but Phase-5 Tree-Borrows model of the source-shaped use
ran clean; do not count it confirmed without an integrated live-overlap
witness; (2) the Windows
`ReadDirectoryChangesW` completion vs `Box<Watcher>` free race in DevServer
Drop; (3) uws `websocket.close()` re-entrancy bound — currently mitigated by
up-front `keys().copied().collect::<Vec<_>>` snapshot of
`active_websocket_connections`. `BackRef<T>` (29 sites) is the dominant
"GC-rooted backreference" pattern; `container_of`/`from_field_ptr!` (10 sites)
all return `*mut`, never `&mut`, except the flagged DirectoryWatchStore one.
The lone self-referential pattern is `UserOptions { arena, framework with
'static slices }` in `bake_body.rs`, handled via `arena_erase` lifetime erasure
(PORTING.md-sanctioned) — Phase B should thread `'bump` to remove the `'static`
lie. Macro generation is ~1 % (3 small macros: `impl_timer_owner!`,
`from_field_ptr!`, `web_socket::Wrap::apply`).

## Section H: runtime-shell
Inventory: `phase1_inventory_H.md`. Notes: `phase1_notes/H_runtime_shell.md`.
Sites: **293** (prior 277; **+16**, ~+5.8 %). SAFETY-comment density 259/293 ≈ **88 %**.
**Zero direct `posix_spawn` / `CreateProcess` calls** in this section — all spawn FFI
routes through `bun_process::spawn_process`; Section H owns the *preparation* and
*result-handoff* surface (`subproc.rs::spawn_maybe_sync_impl` at `:594–860`). The
`inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap>` (`subproc.rs:611`)
buffer-lifetime contract is the canonical pattern: env-K=V\0 storage kept
on-stack until `spawn_process` returns, raw `*const c_char` pointers in
`spawn_args.env_array` borrow into it, null-sentinel pushed unconditionally at
`:701`, `argv` null-tail debug-asserted at `:699`. Two-phase Subprocess init
at `:759–824` (out-pointer write *before* callback re-entry, then `ptr::write`
of populated struct) is the canonical Bun answer to "callback expects a parent
that doesn't exist yet". Spawn-failure Windows deinit at `:714–722` /
`:731–739` names the trap door precisely (`WindowsSpawnOptions` has no `Drop`,
implicit `drop()` would leak pipe handles open in the uv loop). **3 `unsafe
impl Send/Sync` total**: `IOWriter` + `IOReader` Send+Sync (`IOWriter.rs:243-244`,
`IOReader.rs:82-83`, both PRESENT_STRONG: "shell is single-threaded; Arc is
used purely for refcounting"); `ShellRmTask` + `DirTask` Send-only
(`builtin/rm.rs:713-714`, PRESENT_WEAK: shared 4-line comment for two distinct
types — open question whether to split). **2 `unsafe extern "C"` decls**: a
`safe static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char` in `subproc.rs:2509`
(load-time-init immutable rodata) and a lexer C-bridge thunk in
`shell_body.rs:223`. **Dirent-parser consumers** (`shell::builtin::{ls,rm}`):
both call `bun_sys::dir_iterator::iterate(fd)` from Section P at `ls.rs:516`
and `rm.rs:1100`; every consumer copies `current.name.slice_u8()` bytes
out before the next `iterator.next()` call (`add_entry` via
`extend_from_slice` on the output Vec; `enqueue`/`remove_entry_file` via
`ZBox::from_bytes` of the joined path), so the Section P lifetime-erasure
hazard is latent on the parser side, not the consumer side here. Section D's
recommendation to migrate Section P's parser to the PathString-owned template
would close the hazard with **no consumer-side change required** in this
section. **Glob integration** (`bun_glob::BunGlobWalkerZ`, Section R) at three
sites (`shell_body.rs:64` type alias, `states/Expansion.rs:319` walk init,
`dispatch_tasks.rs:131-209` `ShellGlobTask` worker-pool trampoline) is clean —
heap-lifecycle pair (`heap::alloc` at `:175` / `heap::take` at `:156`) is
documented at every step and the SENTINEL=true NUL strip at `:201-207` keeps
argv word boundaries clean. **`UnsafeCell` decls**: 3 (`IOReader.rs:77-78`
`reader` + `state` split, `IOWriter.rs:238` `state`) — load-bearing
single-mutation-gate discipline for `Arc<Self>`-shared, re-entrant callbacks;
the `reader`/`state` split in IOReader is designed so re-entrant callbacks
touch only `state`. **NodeId arena + `node_accessors!` macro**
(`interpreter.rs:186`) is the single largest concentration of shape-identical
unsafe in the section (~28 emitted typed reborrows over a flat
`Vec<Slot>`), all covered by one arena invariant. Per-field interior
mutability on `Interpreter` (`Cell<T>`/`JsCell<T>` per field, `:294-299`)
makes overlapping `&Interpreter` sound and the entire dispatcher can take
`&self`. **No anchored Phase-0 witness for H**. Top tightening
opportunities: (1) `EnvStr::cast_slice` int-to-pointer round-trip
(`EnvStr.rs:188-194`) is now EXP-029 with a strict-provenance Miri mirror;
the fix requires a provenance-carrying pointer representation, not merely
`ptr::with_exposed_provenance`; (2) split the `ShellRmTask` + `DirTask`
shared SAFETY comment into two per-type comments at `rm.rs:710-714`; (3)
verify the lifetime-contract sentence at `subproc.rs:1989` is fully spelled
out, not truncated.

## Section I: runtime-dns-jsc
Inventory: `phase1_inventory_I.md`. Notes: `phase1_notes/I_runtime_dns_jsc.md`.
Sites: **297** normalised (4 files in `src/runtime/dns_jsc/`; prior 257;
**+40 ≈ +16 %**, driven by `export_host_fn!` macro cluster +17 normalised,
Windows `UvDnsPoll` libuv path, and per-block SAFETY-tightening splits).
SAFETY-comment density 225 / 297 ≈ **76 %** (gap is 3 `unsafe extern "C"
{…}` block headers, 3 `unsafe impl`/`unsafe trait` rows, and shared-introducer
walker loops in `cares_jsc.rs`). **No anchored Phase-0 witness.** Macro share
~40 / 297 ≈ **13 %** (`impl_cares_record_type!` ×9 record types,
`export_host_fn!` ×17, `impl_cares_linked!` ×5). **Two `unsafe impl Send`
rows / zero `unsafe impl Sync`**: (1) `dns.rs:107 SendPtr<T>` private
generic raw-pointer wrapper for the threaded work pool (PRESENT_WEAK; current
source constructs only `SendPtr<Request>` at `dns.rs:3080`, so this is a
future-proofing / type-narrowing item, not an EXP-019-equivalent public
safe-API bug; Phase 2: tighten to a request-specific or lock-token-typed
wrapper); (2)
`dns.rs:2386 GlobalCache` (PRESENT_WEAK but precise — every payload `*mut
Request` is heap-allocated, every cross-thread access takes
`global_cache().lock()` first). **Cross-thread handoff status: DIFFERENT
SHAPE from Section Q.** Section I uses a global `bun_threading::Guarded<
GlobalCache>` mutex protecting a fixed-size 256-slot cache of `*mut Request`
plus per-Request `Vec<DNSRequestOwner>` subscriber lists, NOT Section Q's
`PendingConnect.rs:179 Guarded<Vec<*mut T>>` head pattern. The c-ares socket-
state callback `on_dns_poll`/`on_dns_poll_uv` (`dns.rs:4694-4766`) ties the
chain back to Section Q's `cares_sys/c_ares.rs:792 on_sock_state` — the
load-bearing invariant `assert!(size_of::<Channel>() == 0)` in Section Q is
what lets Section I call `safe fn(&mut Channel)` from inside the JS-thread
re-entrant `Channel::process` body. **Callback aliasing contract:
PRESENT_STRONG** — uniform `*mut Self` (no `&mut self`) EXP-012 discipline
across 4 request clusters (DNSLookup, ResolveInfoRequest<T>, CAresNameInfo,
CAresReverse, CAresLookup<T>); `*bun_core::heap::take(this)` move-out
pattern (`dns.rs:1521-1524/1572-1573/1616-1617`) explicitly avoids the
`ptr::read + heap::take` double-Drop trap with inline SAFETY citation;
best-in-section `on_dns_poll` doc (`:4746-4766`) cites the ASM-verified
PROVEN_CACHED `ref_count` miscompile and explains why every Resolver
field is `Cell`/`JsCell`-wrapped as the structural fix. **Top 3 concerning
patterns**: (1) **`unsafe { core::ptr::read(cache.buffer[index].as_ptr()) }`
on pending-cache HiveArray slots (`dns.rs:4244-4275`, 4 sites)** — assumes
`PendingCacheKey: !Drop` but doesn't enforce it; a future `Drop` impl on
`PendingCacheKey` makes all 4 sites double-Drop UAFs. Phase-2 must-fix:
`static_assertions::assert_not_impl_any!(PendingCacheKey: Drop)`. (2)
**Generic `unsafe impl<T> Send for SendPtr<T>` (`dns.rs:107`)** — the
definition is wider than the invariant it documents, but it is private and
currently used only as `SendPtr<Request>`; harden rather than count as a
confirmed UB finding. (3) **`on_dns_socket_state`'s comment-only
`// SAFETY: single-JS-thread` markers (`:4794`, `:4858`)** — no
`cfg!(debug_assertions)` enforcement; if a future caller violates the
contract from a worker thread, the libuv polls would be touched off-thread.
**Section-K Strong-affinity audit lesson applies indirectly**: Resolver
uses `bun_ptr::IntrusiveRc` (not `Strong`), so K's "auto-trait inference
without explicit thread-affinity marker" gap doesn't reach here, but the
`ResolverRefGuard` RAII at `:3650-3658` is the centralised chokepoint
that would be the natural place to add a `_not_send: PhantomData` marker
if hardening is desired.

## Section J: runtime-misc
Inventory: `phase1_inventory_J.md`. Notes: `phase1_notes/J_runtime_misc.md`.
Sites: **942** (10 paths; prior 789; **+153 ≈ +19 %**). SAFETY-comment density
787 / 942 ≈ 84 %. **EXP-001 hot callers confirmed (3):** test_runner
`bun_test.rs:1503` (`LinearFifo<RefDataValue, _>`), valkey_jsc
`ValkeyCommand.rs:132` (`LinearFifo<Entry, _>`) and `:258`
(`LinearFifo<PromisePair, _>`); EXP-001 applicability per-T pending Phase-2
Miri. **EXP-026 (`timer_all_mut`) side-condition: confirmed model witness,
`TODO(b2)`** — `All::drain_timers` (`timer/mod.rs:1016`) and `get_timeout`
(`:897`) bodies convert `self → *mut Self` up-front and form only short-lived
`&mut *this` borrows around `peek()`/`delete_min()`, dropping them before each
re-entrant `fire()`, but receivers still bind `&mut self` and the
`jsc_hooks.rs` call-site auto-ref produces a `&mut All` for the call frame;
flip-to-`*mut Self` would close it (TODOs at lines 908 and 1029 spell out the
fix). **napi**: 115 `pub extern "C" fn napi_*` exports + 29 import blocks;
`unsafe impl ExternalSharedDescriptor for NapiEnv` routes ref/deref through
C++ counts; **1 explicit `unsafe impl Sync` (`napi_node_version`,
SAFETY-OK)**; **zero `transmute`/`set_len`/`assume_init`/`get_unchecked` in
napi**; Phase-2-open: cross-thread protocol audit for `ThreadSafeFunction`
(the exported handle is a raw pointer crossing the C ABI boundary, so Rust
auto-traits do not prove the protocol) and finalizer-queue / env-lifetime
verification. **ffi crate (TinyCC JIT)**: single W^X chokepoint
`dangerously_run_without_jit_protections` toggles
`pthread_jit_write_protect_np` on aarch64-macOS with `scopeguard::defer!`
restore; `BUN_FFI_OFFSETS: RacyCell<Offsets>` defends against optimizer
immutability assumption for C++-mutated extern static; user-supplied fn-ptr
transmute `deallocator_from_addr` (FFIObject.rs:24-33) is Rust-sound via NPO
but hostile-input-sensitive. **crypto**: 41 SAFETY vs 37 blocks ≈ 110 %
coverage, **zero `transmute`**, `MaybeUninit::<HMAC_CTX>` followed immediately
by `HMAC_CTX_init` (no `assume_init` before init), `getrandom::fill` for salt
(no userspace PRNG), constant-time compare via BoringSSL `CRYPTO_memcmp`;
**CLAUDE.md "BoringSSL constant-time used; OS CSPRNG only; no userspace PRNG"
confirmed.** **image**: 41 `unsafe extern` blocks (libspng + libjpeg-turbo +
libwebp + WIC COM); **no SIMD anywhere** (no `target_feature`, no `asm!`, no
`repr(simd)`); only `transmute` is the `WICConvertBitmapSourceFn` fn-ptr
recovered from `GetProcAddress` (backend_wic.rs:921-923). **test_runner**:
`BunTestCell` is the cleanest R-2 `UnsafeCell` + caller-discipline pattern in
the section. **webview**: 21 sites, cfg-gated subprocess fork-exec for
Chrome/WebView host. **allocators**: 1 file (`LinuxMemFdAllocator`), uses
`bun_ptr::ThreadSafeRefCount` (atomic) because Blob stores cross threads.
**webcore.rs**: 4 sites, all auto-flush trampolines for `DeferredTaskQueue`.

## Section K: jsc-core
Inventory: `phase1_inventory_K.md`. Notes: `phase1_notes/K_jsc.md`.
Sites: **993** (`bun_jsc` 972 + `bun_jsc_macros` 21; prior 745; +248). Delta dominated
by macro-template growth (`#[host_fn]`/`#[uws_callback]` per-shim SAFETY-commented
unsafe blocks each count) and the `hot_reloader.rs` 45→68 KB rewrite. Strong/Weak
audited as `!Send + !Sync`; **`Weak<T>` (`Weak.rs:81-95`) and `DeprecatedStrong`
(`DeprecatedStrong.rs:56-62`) rely on auto-trait inference rather than an
explicit type-level thread-affinity marker/doc** (minor hardening gap). The
source has 23 actual `unsafe impl` lines in Section K; a looser `rg 'unsafe impl'`
count returns 29 because six hits are comments. All three
`ExternalSharedDescriptor` impls, including `webcore_types.rs:489` for `Blob`,
have SAFETY coverage. JSC task
wrappers remain the prior-audit `tracked-separately` hazards; canonical
`AnyTaskJob<C>` replaced 5 hand-rolled Zig sites. **Zero `transmute` calls.**
`safe fn` discipline in `unsafe extern "C"` blocks (155 blocks) is consistent,
backed by the `opaque_ffi!` ZST-handle pattern.

## Section L: install-and-pkg-manager
Inventory: `phase1_inventory_L.md`. Notes: `phase1_notes/L_install.md`.
Sites: **583** current grep/tally. Disk lockfile bytes are the primary attack
surface. Anchors: EXP-003 (`HasInstallScript`), EXP-006 (`Origin`),
EXP-005 (`yarn.rs` uninitialized `&mut [Dependency]`), and EXP-007
(`Tree.rs` attacker-derived `get_unchecked`) all remain live on current
source. Important correction preserved: `Buffers::read_array<T>` is not a
single universal choke point for all four P0s; the strongest binary-lockfile
closed-enum hazards flow through Package column memcpy into `Meta`, while the
yarn path is its own uninitialized-slice issue.

## Section M: bundler-and-transpiler
Inventory: `phase1_inventory_M.md`. Notes: `phase1_notes/M_bundler_transpiler.md`.
Sites: **619** (prior ~576; **+43**). Anchors: EXP-010 (parallel-callback
aliasing 5-site cluster: B-1 `Chunk.rs:130-132`, B-2 `LinkerContext.rs:1657`,
B-3 `generateCompileResultForJSChunk.rs:61-62`, B-4
`generateCompileResultForCssChunk.rs:45-46`, B-5
`prepareCssAstsForChunk.rs:76-80`) — **all five UNCHANGED**, no maintainer
commit since the original Rust port (`23427dbc12`). EXP-014 (`Slice<T>: Copy`
documented gap) — exploiters live at `LinkerGraph::load`
(`LinkerGraph.rs:495-700`, 5 `.slice()` calls) and `bundle_v2.rs:{1997, 2062,
2170, 5270}` (4 `Slice` snapshots into `split_mut`/`split_raw`); all
single-threaded so the gap is unweaponized but the type still permits the UB
shape. The "correct" template (raw `*mut Self` + `&Self` deref + `split_raw()`
column writes) is implemented in `do_step5.rs:43-58` and
`renameSymbolsInChunk.rs:43`; B-2..B-5 should adopt it. SAFETY-comment density
is high (534/619 ≈ 86 %), the major exception being
`bundler_jsc/analyze_jsc.rs` (7/26 ≈ 27 %, FFI-thunk file). `src/transpiler/`
is a 16-line re-export crate; all transpiler unsafe lives in
`bun_bundler::transpiler`.

## Section N: bun_core-foundation
Inventory: `phase1_inventory_N.md`. Notes: `phase1_notes/N_bun_core_foundation.md`.
Sites: **831** (prior 625; **+206**). Re-confirmed both prior-audit anchors:
**`atomic_cell.rs` is still clean** — default `load`/`store`/`swap`/`cas` use
Acquire/Release/AcqRel/AcqRel; the only Relaxed paths are the name-explicit
`load_relaxed` / `store_relaxed` (`atomic_cell.rs:144,151`). Atomic op sites
across the section: **203** (vs prior 101) — doubling tracks `bun_core::env_var`
typed-cache macro expansion (~80), `bun_core::Progress` (~15), `bun_core::util`
argv/environ ports (~25), and `bun_safety::CriticalSection` ci_assert counters
(~20). **No too-weak orderings.** `bun_ptr::ref_count` SeqCst cluster
(`ref_count.rs:474,492,527,566,588,597,1131,1225`) is conservative — could be
downgraded per stdlib `Arc`, but is sound. **`bun_core::heap` discipline still
clean** — `into_raw`/`take`/`destroy` thin wrappers unchanged; 1036
workspace-wide call sites surveyed, no UAF/double-free shape detected. **All 24
`pub unsafe fn` exports in `bun_ptr` carry `# Safety` doc** (most thorough at
`parent_ref::assume_mut` which spells out the `from_raw_mut` vs `new` provenance
distinction — write-prov vs `SharedReadOnly`). **`bun_safety` clean** — only
unsafe is 7 `cfg(bun_asan)`-gated ASan/LSan FFI wrappers, each with SAFETY
naming "ASAN runtime is linked when this cfg is active"; non-ASan files are 0
unsafe. **SIMD crates clean** — no `#[target_feature]`, no `asm!`; `bun_hash`
is **0 unsafe**, `bun_highway` is pure FFI shim (12 wrapper blocks each named
ptr/len readable/writable), `bun_wyhash` 5 sites are bounded `read_unaligned`
matching Zig codegen, `bun_base64` 4 sites (1 FFI + 2 `get_unchecked` with
proven bounds + 1 paired). **`bun_core::build_options` post-#bb1973e485 audit:
0 unsafe** — TS generator emits only `pub const` literals + `cfg!()` bools.
**Open: `bun_core::env_var` typed-cache deserves a Phase-2 publication audit,
but it is not a plain Relaxed publication bug** — the string cache stores
`ptr_value` Relaxed, then publishes `len_value` with Release, and readers
Acquire-load `len_value` before loading `ptr_value`. Verify no bypass path and
duplicate-writer equivalence.

## Section O: alloc-and-collections
Inventory: `phase1_inventory_O.md`. Notes: `phase1_notes/O_alloc_collections.md`.
Sites: **457** (prior ~430; +27), mostly from the `4d443e5402`
`multi_array_list` Col/ColMut refactor. EXP-001 still applies:
`linear_fifo::assume_init_slice<T>` / `_mut` expose full uninitialized
`MaybeUninit<T>` backing storage as `T`; the Miri witness uses a niche type
for signal quality, but the source issue is broader. MAL's post-refactor
surface is a real safety-posture improvement; the remaining known gap is
`Slice<T>: Copy` allowing overlapping mutable column views (Tree-Borrows mirror
confirmed in EXP-014; Section M consumers still need integrated caller audit).

## Section P: sys-io-event-loop-threading
Inventory: `phase1_inventory_P.md`. Notes: `phase1_notes/P_sys_io_event_loop.md`.
Sites: **1094** (prior 879; **+215** — driven by macro-emitted `unsafe fn`
headers in `impl_streaming_writer_parent!` / `impl_buffered_writer_parent!`
and intrusive-queue `unsafe impl Linked` stamps). Anchor: **EXP-002 still
applies** — `src/errno/linux_errno.rs:192` `unsafe { core::mem::transmute::<u16,
E>(int as u16) }` is **UNCHANGED** since the prior audit; sibling checked
paths `SystemErrno::init` (`src/errno/lib.rs:322`) and `E::try_from_raw`
(`src/errno/windows_errno.rs:262`) exist but the Linux `impl GetErrno for
usize` was not re-routed through them. **`GuardedLock` `_not_send` PhantomData
marker MISSING** at `src/threading/guarded.rs:132-134` — re-exposes the prior
T1 finding (`MutexGuard`/`RwLockReadGuard`/`RwLockWriteGuard` carry it;
`GuardedLock` does not, and `unsafe impl Send` on Darwin/Windows `Mutex`
auto-propagates `Send` through `&GuardedBy<…, Mutex>`). **dirent parser
unchanged** — Linux/macOS/FreeBSD/Windows branches in
`src/sys/lib.rs:322/391/513/587` still rely on a comment-only
streaming-iterator contract via `Name { ptr: NonNull<u8>, len }` with `unsafe
impl Send/Sync` (POSIX, `lib.rs:190/192`). **`StoreSlice<T> Send/Sync` lives in
section R, not P** (noted because prior audit namechecked it — actual location
is `src/ast/nodes.rs:339-340`). `impl_streaming_writer_parent!` is defined here
(`src/io/PipeWriter.rs:2623`); the only section-P caller is `StaticPipeWriter`
with `borrow = mut` (`src/spawn/static_pipe_writer.rs:78`). Risky
`borrow = ptr` callers (`FileSink`, `Terminal`) live in section A.

## Section Q: http-network-stack
Inventory: `phase1_inventory_Q.md`. Notes: `phase1_notes/Q_http_network.md`.
Sites: **1091** normalised (12 crates; vs prior 867; **+224 ≈ +26 %**, mostly
`bun_uws_sys` +118, `bun_http_jsc` +34, `bun_cares_sys` +33, `bun_http` +11).
SAFETY-comment density 812 / 1130 ≈ 72 %.
Anchor: **EXP-011 picohttp NUL-write @ `src/picohttp/lib.rs:383` — CONFIRMED_UB model**
(unchanged shape: `path_ptr.cast_mut().add(path_len).write(0)` writing through
SharedReadOnly provenance derived from `&'a [u8]` request buffer via
`phr_parse_request`'s `*mut *const c_char` out-param; SAFETY comment justifies
bounds, not provenance, and explicitly admits "Zig casts away const here too").
Phase-5 Tree-Borrows mirror `experiments/EXP-011` fails with
`write access ... is forbidden` on the sentinel write; this proves the wrapper
provenance pattern, though not a full integrated picohttpparser run.
U2 cluster HTTP portion: **2 of 8 sites** in Section Q
(`src/http/AsyncHTTP.rs:117` `free_owned_href` over `href: &'static [u8]`,
and `src/http/lib.rs:176` `Drop for HTTPResponseMetadata` over
`list: &[Header]` — both unchanged from PASS5 11.1/11.2). Possible 9th
candidate: `src/http/ProxyTunnel.rs:791` `detach_and_deref` (weaker — IntrusiveRc
deref, not `Box::from_raw`). Best in-section remediation reference:
`src/http/lib.rs:4136-4141` chunked-decoder Vec-base provenance recovery.
~100 macro-generated unsafe sites (35× `bun_opaque::opaque_ffi!` + ~20
`bun_dispatch::link_impl_*!` + ~12 `define_*_callback!` thunks; ≈ 9 % of
1091). uSockets re-entrancy: `WebSocketUpgradeClient`'s 17 `*mut Self`
handlers (incl. EXP-012 `cancel` reference fix) are best-in-section;
`vtable::on_writable` and `App::*_handler` are contract-only and the
top concern. c-ares `Channel` opaque-ZST (`size_of == 0` static assertion at
`src/cares_sys/c_ares.rs:741`) makes `safe fn(&mut Channel)` sound;
ChannelContainer R-2 contract requires `&self` in `on_dns_socket_state`.
Strict-provenance hazard: `bun_url::URL::host_with_path` int-to-pointer
round-trip at `src/url/lib.rs:340-351`. Note: `bun_dispatch` is a proc-macro
crate; its 13 unsafe-keyword sites are `quote!`-emitted into consumer crates,
not runtime unsafe; `bun_url_jsc` has 0 unsafe sites (re-export-only).

## Section R: parsers-and-lang
Inventory: `phase1_inventory_R.md`. Notes: `phase1_notes/R_parsers_lang.md`.
Sites: **826** (prior ~726; +100). Anchors: EXP-008 (`String::slice` @ `src/semver/lib.rs:613`,
prior `S-009716`) and EXP-009 (`String::eql` @ `src/semver/lib.rs:536-537`,
prior `S-009714/5`) now have release-mode Miri helper-contract witnesses for
forged packed `(off,len)` → `get_unchecked` OOB; lockfile integration
reachability remains the remaining exploitability proof. EXP-019 (`StoreSlice<T>` unbounded Send/Sync) remains live on current
main and is now Miri-confirmed with a safe-code `Cell<u32>` data-race witness
(`experiments/EXP-019`). **New Codex addition: EXP-021** — `StoreRef` / `StoreStr` /
`StoreSlice<T>` expose safe lifetime-erased constructors and safe
caller-chosen-lifetime reborrows over raw arena pointers; a mirror of the
current `StoreSlice<T>` shape is Miri-confirmed dangling-reference UB in
`experiments/EXP-021`. JSON lexer commit `314d044c0a` introduces **no** new
unsafe.

## Section S: sql-redis-payments
Inventory: `phase1_inventory_S.md`. Notes: `phase1_notes/S_sql_redis.md`
(plus Codex correction note `phase1_notes/S_sql_redis_payments.md`).
Sites: **140** normalized unsafe blocks/fns/impls/traits (prior ~104; +36).
Surface is concentrated in `bun_sql_jsc` (113 sites): JSC bridge hooks,
speculative refcount undo, tagged-union reads, BoringSSL cleanup, and
`SQLDataCell` ownership reconstruction. Crypto reconfirmation stands:
`bun_csrf` has zero unsafe; `bun_sha_hmac` uses BoringSSL; `bun_s3_signing`
unsafe is limited to credential zeroing plus a bounded stack-buffer slice.
Codex correction: `SQLDataCell` Bytea/TypedArray `Box::<[u8]>::from_raw`
reconstruction should not be promoted as UB on current source. Bytea
`parse_bytea()` allocates and records the same decoded length; binary bytea is
borrowed. Postgres typed arrays are live `free_value=1` users, but allocate
`out_bytes` and deinit by matching `byte_len`.
Codex correction: Section S is **not** exempt from EXP-001 merely because its
`LinearFifo` queues store raw pointers. Raw pointers lack niche invalid tags,
but `DynamicBuffer<T>::as_slice()` still exposes uninitialized backing slots
as `T`. Section S is a lower-signal user of the global LinearFifo defect,
not a refutation.

## Section T: ffi-c-libs
Inventory: `phase1_inventory_T.md`. Notes: `phase1_notes/T_ffi_c_libs.md`.
Sites: **670** (prior 468; **+202**, ≈ +43 % — driven by `bun_libuv_sys`
+48 (the prior counter did not weight `unsafe trait UvHandle/UvStream/UvReq`
+ 17 `unsafe impl` lines, plus layout-assert macro emits accumulate),
`bun_libarchive_sys` +28, `bun_lolhtml_sys` +26, `bun_boringssl_sys` +21,
`bun_windows_sys` +21, `bun_mimalloc_sys` +10, `bun_libdeflate_sys` +9,
`bun_brotli_sys` +8, `bun_tcc_sys` +9 — all consistent with porting
broadening the hand-written `unsafe extern "C"` declaration surface).
SAFETY-comment density 381 / 670 ≈ **57 %** raw — but the 193 `unsafe extern`
declaration sites describe the C-header contract once at the top docstring
rather than per-decl; **wrapper-side coverage is 381 / 477 ≈ 80 %**, in line
with Sections K/L/M/U. **Anchor: N/A (partition `anchored_witness: null`)**;
the closest is `S021`-cited `Zeroable` impls on POD `repr(C)` structs (zlib
`zStream_struct`, `EVP_MD_CTX`), both carrying per-impl SAFETY proofs that
all-zero is the documented post-init state. **bindgen vs hand-written
breakdown**: **zero bindgen invocations workspace-wide.** All 15 crates are
hand-written or `zig translate-c` ports — `bindgen` mentions are aspirational
TODOs (`brotli_sys/brotli_c.rs:1`, `boringssl/lib.rs:81-85`,
`boringssl_sys/boringssl.rs:1-7`). Mitigations: (a) `bun_libuv_sys`'s 95
`assert_size!`/`assert_offset!` block (the gold standard — every uv handle,
every req-derived struct, and every prefix offset asserted; sizes derived
from a Windows-x64 build of libuv with runtime cross-validation in
`bun_sys::windows::assert_uv_layout()`), (b) `bun_zlib_sys/shared.rs`
deduplicating `zStream_struct` cross-platform with a comment justifying
`c_ulong`-based ABI correctness on both LP64 and LLP64, (c) the
`#[clashing_extern_declarations]` rustc lint catching cross-crate divergence.
**Allocator-pairing audit: CLEAN** — every cross-allocator wiring point
provides BOTH alloc + free or neither: `bun_libdeflate_sys::libdeflate.rs:73-81`
(`libdeflate_set_memory_allocator(mi_malloc, mi_free)`), `bun_zlib::lib.rs:189-190`
(read path) + `:923-924` (write path) (`z_stream.alloc_func = zlib_mi_malloc;
.free_func = zlib_mi_free`), `bun_boringssl::lib.rs:209-225` (3 `#[unsafe(no_mangle)]`
exports `OPENSSL_memory_alloc`/`_free`/`_get_size` routing through
`mi_malloc`/`mi_free`/`mi_malloc_usable_size`). `bun_brotli_sys` and `bun_zstd`
default to internal malloc (Bun never registers callbacks). **No
`Box::from_raw` over a C-allocator pointer**: the only `Box::from_raw` calls
in T are in `bun_libuv_sys::libuv.rs:608` (paired with `Box::into_raw` at
:590 inside `UvHandle::set_owned_data`/`take_owned_data`) and `:1282, 1288`
(in `Pipe::close_and_destroy`, paired with `Box<Pipe>` on the caller side).
**No repr(C) layout drift detected** in spot checks; full per-symbol
validation against `vendor/` headers is a Phase-2 conformance task. **Inline
asm CLEAN** — 3 sites in `bun_windows_sys::externs.rs` (`gs:[0x30]` x86-64
TEB read at line 1574, `x18` ARM64 TEB read at :1582, `gs:[0x60]` x86-64 PEB
read at :1600), all with `nostack, pure, readonly` options (the correct
minimal clobber list for a single-instruction segment-register read with no
memory effects and no flag changes). **`teb()` correctly `pub fn` (not
`pub unsafe fn`)** — the segment-register / `x18` reservation is guaranteed
by the Windows ABI for every thread, so there is no caller obligation;
the deref obligation moves to the caller of the returned `*mut TEB`. `peb()`
deliberately returns `*const PEB` not `&'static PEB` because the OS mutates
fields behind Rust's back. **Transmute audit**: 5 `mem::transmute` sites
section-wide, all sound — 2 fn-pointer-shape transmutes in
`bun_boringssl_sys` for the SK_DUP_FREE callback (BoringSSL's STACK_OF
type-erased free fn), 1 typed close-cb fn-ptr in `bun_libuv_sys::libuv.rs:623`
(ABI-identical via handle-prefix layout invariant), 1 `usize → fn(*mut T,
ReturnCode)` in `bun_libuv_sys::libuv.rs:989` (round-trips an address stored
in `req.reserved[0]`; sound on Win64 where `usize == fn-ptr width`), 1
ranged `c_int → HandleType` in `bun_libuv_sys::libuv.rs:292`. **Notable
patterns**: (1) the `unsafe trait UvHandle/UvStream/UvReq` marker-trait
shape encoding "this `#[repr(C)]` struct starts with `UV_HANDLE_FIELDS`"
across 21 implementors is the cleanest layout-prefix invariant in the
codebase — adding a new uv handle type requires a deliberate `unsafe impl`,
and the 95 `assert_size!`/`assert_offset!` lines provide the proof; (2)
`bun_opaque::opaque_ffi!` + `UnsafeCell<[u8;0]>` ZST opaque-handle pattern
used in 12+ sites (libarchive Archive/Entry, libdeflate Compressor,
zstd ZSTD_DStream/CCtx, brotli BrotliDecoder/Encoder, lol-html
HTMLRewriter/Builder/Selector/Element/EndTag/Attribute/Comment/DocEnd/DocType,
BoringSSL ENGINE/EVP_MD/etc.) sidesteps the `dereferenceable(N)` / `noalias`
aliasing requirements that make raw-handle FFI tricky; (3) Rust 2024
`pub safe fn` keyword used extensively in `bun_mimalloc_sys`,
`bun_brotli_sys`, `bun_libdeflate_sys`, `bun_zlib`, `bun_zstd` for
scalar-only / no-precondition entry points (~25 declarations) restricting
`unsafe { … }` to actual pointer-handling sites; (4) `bun_tcc_sys::tcc_externs!`
defensive-stub macro arm emits `unsafe extern "C" fn ... { unreachable!() }`
on Android/FreeBSD/Win-arm64 so the link still resolves and any future
regression of the runtime ENABLE_TINYCC gate panics loudly instead of
silently invoking UB — worth propagating workspace-wide for optional FFI
features. **Top-3 concerning patterns** (all bounded but worth Phase-2
attention): hand-rolled extern decl drift risk, `usize → fn-ptr` transmute
in `uv_write` callback shape, `OPENSSL_memory_free` zeroing through
`mi_malloc_usable_size` (sound under documented mimalloc contract, but
metadata-page-adjacent if the contract ever weakens). **Open questions**:
(1) `bun_brotli`'s `c_thunks_for_zone!("brotli")` thunks — registered with
brotli's C side or decorative for usage tracking?; (2) `ArchiveFileSink`
caller-discipline audit; (3) `bun_libuv_sys` consumers in Sections D + P
should be checked for direct `(self as *mut Self).cast::<uv_handle_t>()`
casts that bypass `UvHandle::as_handle_mut()`.

## Section U: crash-meta-utility
Inventory: `phase1_inventory_U.md`. Notes: `phase1_notes/U_crash_meta.md`.
Sites: **300** (prior partition estimate ~203; +97, ≈ +48 % — driven by
`bun_perf` Tracy fn-pointer **type-alias** declarations counted as keyword
sites (43 → 71), `bun_bin` growth from `extern "C" fn main` + signal-ignore +
libuv allocator wiring (5 → 17), `bun_dispatch` proc-macro `quote!{}` strings
(2 → 15; emitted into Sections F/J/K and not runtime unsafe here), `bun_paths`
(28 → 37), `bun_watcher` (34 → 37), `bun_options_types` (9 → 13), and
`bun_analytics` (1 → 9 — 8 unsafe export/no_mangle ABI attributes + one
macOS sysctlbyname call counted)). Anchor: **EXP-013 (crash_handler async-signal-safety violations)
STILL APPLIES** — `src/crash_handler/lib.rs:588` carries a TODO comment
(`// TODO: I don't think it's safe to lock/unlock a mutex inside a signal
handler.`) acknowledging the hazard, and the per-handler audit confirms
**9 of 14 audited call-graph steps** (at least 8 distinct operation classes)
in the `handle_segfault_posix` → `crash_handler` →
report/upload-preparation chain are not on the POSIX async-signal-safe
whitelist (Mutex::lock,
Output::flush, format_args!, Output::pretty_fmt_args, dump_stack_trace via
dladdr libc-internal locks, reload_process re-exec setup, bun_which::which
path lookup with getcwd / stat / dirent, plus `print_metadata` formatting).
`fork`/`execve` have separate POSIX async-signal-safety treatment; the problem
is that the path reaches them only after non-safe setup.
Only mitigation: `SA_RESETHAND` set at `lib.rs:1737`. The Zig spec has the
same shape; the Rust port carried it forward intact. **Inline asm CLEAN** —
3 sites in `src/perf/hw_timer.rs` (mrs CNTVCT_EL0, rdtsc, mrs CNTFRQ_EL0),
all using `nomem, nostack, preserves_flags` with correct out-register
declarations per ARM ARM v8 §C5.2.18 and Intel SDM Vol 2B §RDTSC. **`bun_bin`
unsafe is the expected shape** — 17 FFI shims around `extern "C" fn main`
(argv capture, signal-ignore, uv_replace_allocator on Windows, AVX-warning
call, `Bun__panic` C export); each block has an inline SAFETY note. **`bun_analytics`
has one runtime unsafe operation** — a single FFI call to read macOS
`kern.osproductversion`; the other counted sites are unsafe export/no_mangle
ABI attributes for C-visible counters/probes. No upload-side unsafe in the file
(telemetry POSTs go through `bun_http`, audited under Q). **0 unsafe in 6 sub-crates**:
`src/output/`, `src/bun_output_tags/`, `src/meta/`, `src/api/`, `src/clap_macros/`,
`src/node-fallbacks/`. **Best-in-section safety narration: `src/options_types/context.rs`**
— three `pub unsafe fn` accessors over a `*mut Log` carry multi-paragraph
`# Safety` docs that name every other aliasing path (transpiler, install,
JSON parsing, package manager) and explicitly debunk the "`&mut self` proves
exclusivity" intuition. **Cleanest `*mut Self` thread-spawn handoff**:
`src/watcher/Watcher.rs::thread_main` (line 280) scopes `me = &mut *this`
strictly before `heap::take(this)`; Phase-3 Miri candidate. **Phase-2 fix
sketch for EXP-013**: split signal entry from report path — POSIX handler
should `write(2)` a fixed pre-formatted message and re-raise; formatting,
dladdr/backtrace work, path lookup, and report/upload orchestration should run
in a sibling thread woken by an eventfd from the signal handler.
