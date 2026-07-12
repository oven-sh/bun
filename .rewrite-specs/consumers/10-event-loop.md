# Consumer-Requirements Inventory: bun_uws / bun_uws_sys `Loop` (for a Rust rewrite of the uSockets core)

Repo root: `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU` (all paths below are relative to this root; line numbers are anchors into these files).

---

## 0. The Loop type itself (reference surface)

`src/uws_sys/Loop.rs`

- `PosixLoop` is a **fully transparent `#[repr(C, align(16))]` mirror** of C `us_loop_t` (`src/uws_sys/Loop.rs:21-50`): fields `internal_loop_data`, `num_polls`, `num_ready_polls`, `current_ready_poll`, `fd`, `active`, `pending_wakeups`, `ready_polls: [EventType; 1024]`, with static layout assertions (`:64-83`). Consumers *directly poke* `num_polls`/`active` (see §1) — the rewrite cannot make these opaque without changing consumers.
- `pending_wakeups` doc (`:40-42`): "Incremented atomically by wakeup(), swapped to 0 before epoll/kqueue. If non-zero, the event loop will return immediately so we can skip the GC safepoint."
- `WindowsLoop` (`:389-398`): `internal_loop_data`, `uv_loop: *mut uv::Loop`, `is_default`, `pre: *mut uv_prepare_t`, `check: *mut uv_check_t`. Active-handle accounting is proxied to libuv's `active_handles` (`:447-457`, a **Bun-private** counter libuv reads in `uv__loop_alive` per comment `:434-438`).
- `InternalLoopData` (`src/uws_sys/InternalLoopData.rs:26-64`): `sweep_next_tick_ns` (POSIX) / `sweep_timer: *mut Timer` + `quic_timer` (Windows), `sweep_timer_count`, `wakeup_async`, `head`/`iterator` (SocketGroup list), `recv_buf`/`send_buf`, `pre_cb`/`post_cb`, `closed_udp_head`, `closed_head`, `low_prio_head`, `low_prio_budget`, `dns_ready_head`, `closed_connecting_head`, `mutex` (layout-matched to `Bun__lock`, `:7-18,50-56`), `parent_ptr`+`parent_tag` (tag 1 = `jsc::EventLoop`, 2 = `MiniEventLoop`, `:79-98`), `iteration_nr`, `jsc_vm: *const c_void`, `tick_depth`.
- Pre/post handler add/remove (`:305-334`, `:363-385`). Note `Handler::remove_pre` **intentionally calls `uws_loop_removePostHandler`** — "likely an upstream bug; preserving longstanding behavior verbatim" (`:377-384`). No Rust in-tree caller of `add_pre_handler`/`add_post_handler` currently exists (grep confirms only the definitions); C++ `packages/bun-uws/src/Loop.h:152,165` (`addPostHandler`/`addPreHandler`) and C `packages/bun-usockets/src/loop.c:400,422` (`pre_cb`/`post_cb` invoked in `us_internal_loop_pre/post`) are the live consumers.
- Raw re-exports for cross-thread use (`:654-661`): `us_loop_run`, `us_wakeup_loop` are exported raw because "the event-loop thread parks inside [`us_loop_run`] while worker threads call `us_wakeup_loop` concurrently; routing either through a `&mut self` receiver would create two live `&mut Loop`". Consumers: `src/http/HTTPThread.rs:1081` (`uws::us_wakeup_loop(self.uws_loop)`), `src/io/lib.rs:2199,2209` (WindowsWaker), `src/io/windows_event_loop.rs:417,426` (own re-declared shims, `:434-440`).
- `on_thread_exit()` → C `bun_clear_loop_at_thread_exit` (`:663-673`): clears the C TLS loop pointer when a thread that ran a uws loop exits.

---

## 1. Loop creation per VM/worker; `get`/`ensure_waker`/`wakeup`/`defer`; who ticks

### Creation / acquisition
- **Main thread & workers:** the loop is *not* created explicitly by Rust — `uws::Loop::get()` (`src/uws_sys/Loop.rs:213-215,411-414`) hits C `uws_get_loop` (TLS lazy-create in loop.c with Bun's built-in wakeup/pre/post callbacks). Every JS thread (main + each web worker) gets its own TLS loop.
- **Explicit creation** only for spawnSync's isolated loop: `uws::Loop::create::<H: LoopHandler>()` (`src/uws_sys/Loop.rs:228-235`) with the `LoopHandler` trait (`:99-105`, const `WAKEUP` + optional `PRE`/`POST`). Sole caller: `src/event_loop/SpawnSyncEventLoop.rs:154` with no-op wakeup/pre/post handlers (`:117-142`).
- **`ensure_waker`** (`src/jsc/event_loop.rs:877-916`): on first call sets `vm.event_loop_handle = Async::Loop::get()` (POSIX: the uws loop itself; Windows: `uv::Loop::get()` — see `bun_io::Loop` alias, `src/io/lib.rs:74-101`), stores `uws::Loop::get()` in `EventLoop.uws_loop` on Windows (`:882,896-901`), inits the GC controller (`:889-894`), and writes `(tag=1, self_ptr)` into `internal_loop_data.set_parent_raw` (`:908-916`). `VirtualMachine::init` calls it **before** JSGlobalObject creation (`src/jsc/VirtualMachine.rs:2155-2159`) and sets `internal_loop_data.jsc_vm = vm.jsc_vm` **after** jsc_vm exists (`:2186-2192`).
- Loop pointer accessors on the VM: `VirtualMachine::uws_loop()` (`src/jsc/VirtualMachine.rs:1013-1028`) — POSIX: `event_loop_handle.unwrap_unchecked()`, Windows: `uws::Loop::get()`; `uws_loop_mut()` (`:868-876`); `platform_loop_opt()` (`:879-892`). `EventLoop::usockets_loop()` (`src/jsc/event_loop.rs:586-603`) panics with "call ensure_waker first" if unset.

### wakeup()
- `Loop::wakeup()` → `us_wakeup_loop` (`src/uws_sys/Loop.rs:237-245`, Windows `:459-467` → `uv_async_send` under the hood).
- `EventLoop::wakeup()` (`src/jsc/event_loop.rs:959-978`) takes **`&self`** and is called after every cross-thread enqueue: `enqueue_task_concurrent` (`:983-991`), `ref_concurrently`/`unref_concurrently` (`:993-1002`, atomic `concurrent_ref` fetch_add + wakeup), `enqueue_task_concurrent_batch` (`:1164-1188`). The queued ref delta is applied loop-locally in `update_counts` (`:540-570`) by **directly mutating `loop_.num_polls` / `loop_.active`** on POSIX and `add_active`/`sub_active` on Windows.
- Worker termination wakes the worker's loop cross-thread via `(*(*vm_ptr).event_loop()).wakeup()` (`src/jsc/web_worker.rs:373-374,706-707`).

### defer(task) — `uws_loop_defer`
- Exposed as `Loop::next_tick(user_data, extern "C" fn(*mut c_void))` (`src/uws_sys/Loop.rs:285-292`, Windows `:539-546`) → C `uws_loop_defer`. Semantics: run once on the loop thread on the next iteration; cross-thread-safe (used with the internal mutex in loop_data). Note the "Rust cannot monomorphize an extern "C" fn over a fn-pointer const generic" comment — callers hand-write C-ABI trampolines.

### Who runs/ticks, and integration with the JSC event loop
- **`us_loop_run_bun_tick`** (POSIX-only, `src/uws_sys/Loop.rs:247-263,641-642`): `tick()` (null timeout = park), `tick_without_idle()` (zero timeout), `tick_with_timeout(Option<&Timespec>)`. Windows: `tick_with_timeout` ignores the timeout and calls `us_loop_run` (`:469-477`); `tick_without_idle` = `us_loop_pump`.
- **`auto_tick`** (the real driver, `src/runtime/jsc_hooks.rs:869-1011`) per iteration: `tick_immediate_tasks` → drain `pending_unref_counter` into `loop.unref_count(n)` (`:896-902`) → `update_date_header_timer_if_necessary(&*loop_, vm)` (`:906-918`) → `run_imminent_gc_timer` → compute poll timeout from the timer heap `All::get_timeout(..., has_pending_immediate, quic_next_tick_us, ...)` (`:938-982`, folds the QUIC deadline from `internal_loop_data.quic_next_tick_us`, `:950-957`) → `loop.tick_with_timeout(...)` if `loop.is_active()`, else `tick_without_idle` (`:983-990`) → `drain_timers` (POSIX, `:993-1003`) → `vm.on_after_event_loop()` (fires the one-shot `after_event_loop_callback` — used by FilePoll deferred frees, see §6) → `handle_rejected_promises`. `auto_tick_active` (`:1013-1067`) is the same minus imminent-GC/rejections.
- **Microtask drain** happens in `EventLoop::drain_microtasks_with_global` (`src/jsc/event_loop.rs:311-353`): JSC drain → `deferred_tasks.run()` → **`vm.uws_loop_mut().drain_quic_if_necessary()`** each drain (`:345-352`; `drain_quic_if_necessary` early-outs on `quic_head == null`, `src/uws_sys/Loop.rs:216-226`). So microtask drain is *not* in the uws pre/post callbacks in Rust; it hangs off enter/exit counting (`:237-296`) and the tick loops in `EventLoop::tick` (`:610-653`).
- **`tick_possibly_forever`** (`src/jsc/event_loop.rs:1104-1131`): applies pending unrefs, installs the **forever poll** if `!loop.is_active()` — POSIX `hold_forever_poll` = bare `loop_.inc()` (`:1074-1082`, "Keep one poll registered with the loop so `us_loop_run_bun_tick` parks instead of returning immediately on `num_polls == 0`"); Windows = a 4-minute repeating `uws::Timer` (`:1084-1102`, closed at exit in `src/jsc/VirtualMachine.rs:1532-1538`) — then `tick_with_timeout(Some(1s))` (bounded park so `--hot` reload wakeups aren't missed, `:1122-1126`), then `on_after_event_loop` + `tick_concurrent` + `tick()`.
- `tick_while_paused` spins `platform_loop.tick()` until a C++-written volatile bool flips (`src/jsc/event_loop.rs:1049-1057`).
- "Is the process alive" logic reads `platform_loop_opt().is_active()` + task counts (`src/jsc/VirtualMachine.rs:1038-1057`).
- FFI aliasing rule the rewrite must preserve: `mod c` comment (`src/uws_sys/Loop.rs:618-623`) — loop-taking FFI stays `*mut Loop`, never `&mut Loop`, because ticks reentrantly dispatch Rust callbacks that fetch the same loop via `Loop::get()`.

---

## 2. `rare_data.rs` shutdown path

`src/jsc/rare_data.rs`

- **SocketGroups owned by RareData** — 14 embedded by-value groups (`:225-248`): `spawn_ipc_group`, `test_parallel_ipc_group`, `bun_connect_group_tcp/tls`, `postgres_group(+tls)`, `mysql_group_(+tls)`, `valkey_group_(+tls)`, `ws_upgrade_group_(+tls)`, `ws_client_group_(+tls)`. Lazily linked to the loop on first use via `lazy_group`: `g.init(vm.uws_loop(), None, null)` when `g.loop_.is_null()` (`:765-771`); typed accessors `:773-841`. The `for_each_socket_group!` macro enumerates all 14 (`:561-620`).
- **`close_all_socket_groups`** (`:848-878`), quoted:
  - Doc: "Drain every embedded socket group. Must run BEFORE JSC teardown — closeAll fires on_close → JS callbacks → needs a live VM. RareData.deinit() runs after `WebWorker__teardownJSCVM`…" (`:844-847`).
  - Body loops `while rounds < 8 { if !vm.uws_loop_mut().close_all_groups() break; }` — bounded retry because "a handler can call Bun.connect/postgres/etc. and re-populate a group we just drained" (`:849-871`). It deliberately walks the **loop's linked group list** (`us_loop_close_all_groups`, `src/uws_sys/Loop.rs:276-281`) instead of only the 14 fields: "Listener/uWS-App groups own their own SocketGroup… Iterating only the embedded fields missed those, leaking one 88-byte us_socket_t per still-open accepted connection at process.exit() (LSAN cluster on #29932 build 49245)" (`:857-861`).
  - **`drain_closed_sockets`** afterwards (`:872-877`): "us_socket_close pushes to loop->data.closed_head; loop_post() normally frees it on the next tick. We're past the last tick, so drain it now — every us_socket_t is libc-allocated and otherwise becomes an LSAN leak." Implemented at `src/uws_sys/Loop.rs:264-273` (`us_internal_free_closed_sockets`, frees `closed_head`/`closed_connecting_head`).
- **`Drop for RareData`** (`:1048-1095`): asserts closeAll already ran, then `SocketGroup::destroy` for each group whose `loop_` is non-null (`:1081-1093`; never-inited groups are skipped explicitly).
- **low_prio accounting**: not in rare_data itself — it lives in `InternalLoopData.low_prio_head`/`low_prio_budget` (`src/uws_sys/InternalLoopData.rs:46-47`) and per-group `SocketGroup.low_prio_count` (`src/uws_sys/SocketGroup.rs:33-36`: "Sockets currently parked in `loop.data.low_prio_head`"); group emptiness checks include `low_prio_count == 0` (`src/uws_sys/SocketGroup.rs:161`). The C loop's post phase consumes the budget; the rewrite must keep both fields and the group counter coherent for `close_all_groups`.
- Call sites of the shutdown pair: main thread `global_exit` (`src/jsc/VirtualMachine.rs:1573-1587`, followed by a second `(*uws::Loop::get()).drain_closed_sockets()` after `destructOnExit`, `:1603-1611` — "lastChanceToFinalize… sockets land in loop.closed_head. Drain again now or LSAN reports every accepted socket"); worker shutdown (`src/jsc/web_worker.rs:1267-1279`).

---

## 3. MiniEventLoop (HTTP thread + standalone tools)

`src/event_loop/MiniEventLoop.rs`

- **Loop ownership:** `MiniEventLoop.loop_: *mut UwsLoop` set from `UwsLoop::get()` in `init()` (`:82-108,311-325`) — i.e. it *borrows* the thread's TLS C loop, never creates/frees it. Sole accessor `loop_ptr()` (`:203-220`) with an explicit warning that a held `&mut UwsLoop` across `.tick()` would alias (FilePoll callbacks re-enter via `EventLoopCtx`).
- **TLS singleton / UAF hazard:** `GLOBAL: Cell<*mut MiniEventLoop<'static>>` thread-local (`:110-115`). `init_global` (`:123-201`) allocates once via `heap::into_raw` and **never frees** ("§Forbidden bans `Box::leak`… thread-lifetime singleton", `:133-136`), publishing the TLS pointer only after the init `&mut` ends (`:192-199`). This is the fix shape for the remembered *MiniEventLoop TLS Box UAF*: returning `&'static mut` or publishing early lets `MiniKind::get_vm()` (`:615-626`, reads `GLOBAL` without checking `GLOBAL_INITIALIZED`) alias/deref a dead or exclusively-borrowed box. Rewrite constraint: `EventLoopHandle::Mini` copies of this pointer are stored inside `InternalLoopData.parent_ptr` (`:149-157`, tag 2) and dereferenced on later ticks — the loop's parent-ptr slot must outlive the loop.
- **Cross-thread wakeup / task queues:** `tasks: LinearFifo<*mut AnyTaskWithExtraContext>` (loop-local) + `concurrent_tasks: UnboundedQueue` (intrusive MPSC, `:65-78`). `enqueue_task_concurrent{,_with_extra_ctx}` push then `(*self.loop_ptr()).wakeup()` (`:436-466`). Tick shapes: `tick_once` — inc/tick/dec around the park so the loop doesn't early-return on `num_polls == 0` (`:367-383`), `tick_without_idle` loops `tick_without_idle()` until both queues drain (`:385-401`), `tick(is_done)` (`:403-412`). `on_after_event_loop` one-shot callback (`:260-269`) mirrors the VM's (used by FilePoll deferred frees).
- HTTP thread: `src/http/HTTPThread.rs:1081` wakes its loop cross-thread via the raw `uws::us_wakeup_loop(self.uws_loop)` re-export (must not form `&mut Loop`).
- `EventLoopCtx` Mini vtable (`:510-531`): `platform_event_loop_ptr() => loop_ptr()`, `file_polls_ptr() => file_polls_raw` (raw-ptr lazy init to avoid re-entrant `&mut MiniEventLoop`, `:278-309`), `ref/unref_concurrently => unreachable!` (JS-VM-only).
- `AnyEventLoop`/`EventLoopHandle` (`src/event_loop/AnyEventLoop.rs`): `EventLoopHandle::{Js,Mini}` is the `Copy` handle stored in `InternalLoopData` via `into_tag_ptr`/`from_tag_ptr` (`:409-449`) and `set_as_parent_of(&mut UwsLoop)` (`:462-470`); loop plumbing `r#loop()`/`native_loop()`/`ref_()`/`unref()` (`:592-648`) all deref the raw loop pointer.

---

## 4. Timers

- **JS timers do NOT use `us_timer_t`.** They live in a Rust intrusive 4-heap `TimerHeap` inside `bun_runtime`'s `All` (`src/runtime/timer/mod.rs:607-629`). POSIX: the heap deadline becomes the epoll/kqueue timeout via `All::get_timeout` called from `auto_tick` (`src/runtime/timer/mod.rs:860-899`; `src/runtime/jsc_hooks.rs:974-986`), and firing happens in `drain_timers` after the poll. Windows: a single **libuv `uv_timer_t` per `All`** is "the ONLY thing that wakes `uv_run` for JS timers" (`ensure_uv_timer`, `src/runtime/timer/mod.rs:688-761`; callback `on_uv_timer` drains then re-arms, `:767-782`; min 1 ms, ref'd only while `active_timer_count > 0`).
- **Sweep timer (uSockets socket timeouts):** C-owned. POSIX `InternalLoopData.sweep_next_tick_ns` / Windows `sweep_timer: *mut Timer` + `sweep_timer_count` (`src/uws_sys/InternalLoopData.rs:27-31`); Rust only reads `should_enable_date_header_timer() = sweep_timer_count > 0` (`:75-77`).
- **DateHeaderTimer:** rides the JS timer heap, not us_timer. `src/runtime/timer/DateHeaderTimer.rs:21-32` — C calls `Bun__internal_ensureDateHeaderTimerIsEnabled(loop)`; `enable` (`src/runtime/timer/Timer.rs:454-495`) calls `(*vm.uws_loop()).update_date()` (→ C `uws_loop_date_header_timer_update`, `src/uws_sys/Loop.rs:118-121,651`) if >1 s stale, then (re)schedules itself +1000 ms; `run` re-arms only while `internal_loop_data.sweep_timer_count > 0` (`src/runtime/timer/mod.rs:398-421`). Also re-checked once per `auto_tick` (`src/runtime/jsc_hooks.rs:905-918`) gated on `loop_.should_enable_date_header_timer()` (`src/runtime/timer/Timer.rs:49-72`).
- **WTFTimer** (`src/runtime/timer/WTFTimer.rs`): wraps `WTF::RunLoop::TimerBase`; rides the same `All.timers` heap. Crucial cross-thread property: `update`/`cancel` "may be called off the JS thread — `All::update` takes its own lock" (`:180-192,217-229`; `All.lock`, `src/runtime/timer/mod.rs:654-660,697-700`). Imminent (≤0 s) timers publish into `EventLoop.imminent_gc_timer: AtomicPtr<()>` via CAS (`:137-163`) and are run from `run_imminent_gc_timer` (`src/jsc/event_loop.rs:469-480`) each `tick_concurrent_with_count`/`auto_tick`.
- **`uws::Timer` (us_timer_t) actual Rust uses:** Windows-only forever-timer (`src/jsc/event_loop.rs:79-80,1084-1102`; closed with `uws::Timer::close::<true>` at exit, `src/jsc/VirtualMachine.rs:1532-1538`). Plus C-internal sweep/quic timers on Windows (`InternalLoopData`).

---

## 5. Windows specifics

- `WindowsLoop` wraps `uv_loop_t` (`src/uws_sys/Loop.rs:389-398`); `WindowsLoop::get()` = `uws_get_loop_with_native(uv::Loop::get())` (`:411-414`) — the uws loop is bound to the **default libuv loop** of the thread. `pre`/`check` fields = uv_prepare/uv_check handles that C uses to run `us_internal_loop_pre/post` around each `uv_run` iteration.
- Ticking = `us_loop_run` (uv_run) / `us_loop_pump` (`:469-477,634-636`); there is **no** `us_loop_run_bun_tick` and timeouts are ignored — the JS-timer `uv_timer_t` (§4) provides the deadline instead.
- `VirtualMachine.event_loop_handle` on Windows is the **libuv** loop, while `EventLoop.uws_loop` holds the uws wrapper (`src/jsc/event_loop.rs:84-88,590-603`; divergence noted at `:345-348` and `src/io/windows_event_loop.rs:20-25`). `bun_io::uws_to_native` projects wrapper→`uv_loop` (`src/io/lib.rs:79-101`).
- `src/io/windows_event_loop.rs`: `Loop = uv::Loop` (`:25`); FilePoll ref/unref bookkeeping goes through `WindowsLoop::add_active/sub_active` → `uv_loop.active_handles` (`:210-225`); registration is effectively vestigial (`unregister` comment `:114-131`: "in practice this call is unreachable" — readiness on Windows is driven by libuv handles, not FilePolls). `Waker` = `BackRef<WindowsLoop>`; `wait` = raw `us_loop_run`, `wake` = raw `us_wakeup_loop` (uv_async_send) explicitly avoiding `&mut WindowsLoop` (`:369-440`).
- spawnSync on Windows: overrides `vm.event_loop_handle` with the isolated loop's `uv_loop` (`src/event_loop/SpawnSyncEventLoop.rs:310-315`), uses a heap `uv_timer_t` for the timeout whose callback calls `uv_loop.stop()` (`:346-364,373-399`), with elaborate Stacked-Borrows choreography around `timer.data = self` (`:433-455`).
- Worker teardown calls `bun_sys::windows::libuv::Loop::shutdown()` per thread (`src/jsc/web_worker.rs:1320-1325`).
- `get_active_tasks` reports `uv active_handles` instead of `num_polls` on Windows (`src/jsc/event_loop.rs:1208-1215`).

---

## 6. `io/posix_event_loop.rs` — how file/pipe pollers register

- **No `us_poll_t`.** FilePolls register **directly on the loop's epoll/kqueue fd** (`loop_.fd`): `register_with_fd_impl` (`src/io/posix_event_loop.rs:679-830`) does raw `epoll_ctl(watcher_fd, CTL_ADD/MOD, fd, event)` with `event.u64 = Pollable::init(self).ptr()` (`:731-744`) or `kevent64` changelists with `udata = Pollable` tagged pointer and `ext[0] = generation_number` (`:751-807`; macOS supports EVFILT READ/WRITE/PROC/MACHPORT/MEMORYSTATUS).
- **Dispatch back from the C loop:** C calls `Bun__internal_dispatch_ready_poll(loop_, tagged_pointer)` (`:1576-1609`) for non-socket ready polls; it reads the event out of the loop via `current_ready_event()` (copies `ready_polls[current_ready_poll]`, `src/uws_sys/Loop.rs:127-139`) then dispatches `on_kqueue_event`/`on_epoll_event`. So the rewrite must keep the `ready_polls`/`current_ready_poll` back-channel (or an equivalent accessor) and the "tagged-pointer udata belongs to Bun" convention.
- **Keep-alive accounting:** `activate`/`deactivate` mutate `loop_.inc()/dec()` + `active` via `loop_add_active`/`loop_sub_active` — plain field arithmetic on `PosixLoop.active` (`:14-27,523-560`); `ref_`/`unref`/`disable_keeping_process_alive` route through `EventLoopCtx.loop_mut()` (`:489-521,607-626`).
- **Deferred frees:** `Store::put` chains freed FilePolls on an intrusive list and registers a **one-shot after-event-loop callback** (`vm.set_after_event_loop_callback(process_deferred_frees_thunk, store)`, `:314-366` in the windows file; POSIX analog same shape) fired from `vm.on_after_event_loop()` at the end of each `auto_tick` (`src/runtime/jsc_hooks.rs:1007-1008`) / `MiniEventLoop::on_after_event_loop`.
- Unregister tolerates EBADF/ENOENT on kevent/epoll delete (`:60-86`).
- Wakers (used by non-uws worker threads, e.g. bundler): `src/io/lib.rs:1981-2120` — Linux/FreeBSD `eventfd`, macOS `kqueue + machport` (`io_darwin_schedule_wakeup`), Windows the uws loop itself.

---

## 7. Unusual lifecycle / teardown ordering

- **Main-thread exit** `VirtualMachine::global_exit` (`src/jsc/VirtualMachine.rs:1525-1616`), order: close Windows forever-timer → `cancel_all_timers` (heap nodes unlinked while JSC alive, comment `:1539-1551`) → `gc_controller.deinit()` → `terminate_all_workers_and_wait` → `drop_concurrent_cpp_tasks` (`src/jsc/event_loop.rs:683-713`, "must precede destructOnExit: deleting after JSC VM teardown would run `~JSEventListener` against freed Weak handle storage") → `close_all_socket_groups` → `bun_http::shutdown_for_exit()` → `release_queued_tasks_for_shutdown` (`src/jsc/event_loop.rs:715-754`, re-drains because the HTTP thread's `is_shutting_down` read "is non-atomic and can lag") → `Zig__GlobalObject__destructOnExit` → **second** `(*uws::Loop::get()).drain_closed_sockets()` (`:1605-1611`) → `destroy()`.
- **Worker teardown** `WebWorker::shutdown` (`src/jsc/web_worker.rs:1195-1384`), quoted ordering contract at `:1198-1211` (unpublish vm under lock so racing `notifyNeedTermination` "skips wakeup() instead of touching memory freed in step 5"; exit handlers; teardownJSCVM; dispatchExit; "free loop/arena/pools — no `this.*` dereferences below step 4"). Loop-relevant steps: `cancel_all_timers` + `gc_controller.deinit` + `close_all_socket_groups` + `release_queued_tasks_for_shutdown` before `WebWorker__teardownJSCVM` (`:1254-1287`); then `internal_loop_data.jsc_vm = null` (`:1316-1319`), Windows `libuv::Loop::shutdown()` (`:1320-1325`), VM dealloc, and finally **`bun_uws::on_thread_exit()`** (`:1364-1371`): "Free this thread's lazily-created uWS loop and its 512 KiB recv buffer. The C++ thread_local `~LoopCleaner` does not fire here… Everything that registers polls on the loop (gc_controller, sockets, timers) has been deinit'd above."
- **EventLoop::deinit** (`src/jsc/event_loop.rs:756-798`): frees `ManagedTask`s only (owners cancel via raw back-pointers during `destructOnExit`, doc `:725-737`), re-queues unreleasable tags so LSan can still reach them, cancels pending immediates via `__bun_cancel_pending_immediate`.
- **spawnSync loop swap:** `prepare` saves/overrides `vm.event_loop_handle` (`src/event_loop/SpawnSyncEventLoop.rs:302-316`); `cleanup` restores handle + `vm.event_loop` (`:319-334`); `Drop` destroys the jsc EventLoop **before** `uws::Loop::destroy` (`:277-297`) — the only Rust call sites of `us_loop_free` (`src/uws_sys/Loop.rs:345-355`).
- Deferred task queue (`EventLoop.deferred_tasks`) runs right after each microtask drain (`src/jsc/event_loop.rs:340-343`), guarded by `vm.is_inside_deferred_task_queue`; registered/unregistered from C++ via `Bun__EventLoop__postDeferredTask/unregisterDeferredTask` (`:1453-1472`).

---

## 8. Migration notes — required Loop API & thread-safety matrix

### Exact surface the new crate must expose (names from `src/uws_sys/Loop.rs`)

Constructors/acquisition: `Loop::get()` (TLS lazy default with Bun callbacks; Windows `get_with_native(uv_loop)`), `Loop::create::<H: LoopHandler>()` (custom wakeup/pre/post, spawnSync), `unsafe destroy(*mut Loop)` (`us_loop_free`), `on_thread_exit()` (clear TLS + free loop/recv_buf).

Loop-thread ops: `tick()` / `tick_without_idle()` / `tick_with_timeout(Option<&Timespec>)` (POSIX `us_loop_run_bun_tick(timespec)`), `run()` (`us_loop_run`), Windows `us_loop_pump`; `inc/dec` (`num_polls`), `ref_/unref/unref_count/add_active/sub_active/is_active` (`active` bookkeeping — POSIX consumers also write `num_polls`/`active` **as raw fields**, `src/jsc/event_loop.rs:556-569`); `iteration_number()`; `current_ready_event()` + `current_ready_poll`/`ready_polls` (poll dispatch back-channel, §6); `uncork()` (`uws_res_clear_corked_socket`); `update_date()` (`uws_loop_date_header_timer_update`); `should_enable_date_header_timer()` (`sweep_timer_count > 0`); `drain_quic_if_necessary()` (`quic_head` + `us_quic_loop_flush_if_pending`, plus readable `quic_next_tick_us`); `close_all_groups() -> bool` (`us_loop_close_all_groups`); `drain_closed_sockets()` (`us_internal_free_closed_sockets`); `loop.fd` (POSIX — FilePolls epoll_ctl/kevent directly against it); `recv_slice()` (512 KiB `recv_buf`, `src/uws_sys/InternalLoopData.rs:66-73`).

Handlers/deferral: `next_tick(ctx, extern "C" fn(*mut c_void))` (`uws_loop_defer`), `add_pre_handler`/`add_post_handler`/`Handler::{remove_pre,remove_post}` (raw `*mut Loop` provenance rules, `src/uws_sys/Loop.rs:294-334`; C++ `Loop.h` addPre/PostHandler and `loop.c` `pre_cb`/`post_cb` slots must survive), `LoopHandler` trait (WAKEUP required, PRE/POST optional).

InternalLoopData contract: `set_parent_raw/get_parent_raw` (tag 1 = jsc::EventLoop, 2 = MiniEventLoop; panics on unset, `src/uws_sys/InternalLoopData.rs:79-98`), `jsc_vm` slot (set post-init, nulled at worker teardown), `mutex` layout-compatible with `Bun__lock` (size checked at runtime by loop.c), `sweep_*`, `closed_head`/`closed_udp_head`/`closed_connecting_head`/`dns_ready_head`, `low_prio_head`/`low_prio_budget` (+ `SocketGroup.low_prio_count` coherence), `iteration_nr`, `tick_depth`, `wakeup_async`, `head`/`iterator` group list.

Windows extra: `uv_loop` field readable (projected everywhere via `uws_to_native`), `pre`/`check` handles, active-handle proxying into `uv_loop.active_handles`.

### Cross-thread-safe (may be called off the loop thread, while the loop thread is parked inside run/tick)
- `wakeup()` / raw `us_wakeup_loop(*mut Loop)` — the *only* documented cross-thread op; consumers: `EventLoop::wakeup` from `enqueue_task_concurrent`/`ref_concurrently`/`unref_concurrently` (`src/jsc/event_loop.rs:959-1002`), `HTTPThread` (`src/http/HTTPThread.rs:1081`), `WindowsWaker::wake` (`src/io/lib.rs:2202-2210`), worker `terminate`/`notify_need_termination` (`src/jsc/web_worker.rs:373,706`). Implementation constraint: must be callable with **only a raw pointer** while another thread holds what Rust considers exclusive access (re-export note, `src/uws_sys/Loop.rs:654-661`); POSIX bumps atomic `pending_wakeups` and signals `wakeup_async`.
- `us_loop_run` itself is exported raw for the same aliasing reason (waker `wait()` paths).
- `uws_loop_defer` (`next_tick`) — cross-thread deferral protected by `internal_loop_data.mutex` on the C side.
- NOT cross-thread in Rust today but adjacent: `WTFTimer::update/cancel` may run off-thread but only touch the Rust-side `All.lock`ed heap, not the loop; cross-thread ref/unref is funneled through atomics (`concurrent_ref`, `pending_unref_counter`) applied loop-locally.

### Loop-local only (single loop-thread)
Everything else: tick/run variants, `inc/dec/ref_/unref/active` field mutation, `current_ready_event`, `update_date`, `drain_quic_if_necessary`, `close_all_groups`, `drain_closed_sockets`, `set_parent_raw`, `recv_slice`, handler add/remove, `Loop::create`/`destroy`, epoll/kevent registration against `loop.fd`.

### Behavioral invariants to preserve
1. `us_loop_run_bun_tick(null)` parks; returns immediately when `num_polls == 0` (hence `hold_forever_poll`/`inc()` and MiniEventLoop's inc/tick/dec) and when `pending_wakeups != 0` (GC-safepoint skip).
2. `loop_post` frees `closed_head` once per tick; explicit `drain_closed_sockets` must exist for the post-last-tick window (teardown comments in §2/§7).
3. `close_all_groups` must walk the loop's full linked group list (not just caller-known groups) and report whether anything was linked (retry loop in rare_data).
4. Parent tag/ptr in loop data is dereferenced by C→Rust dispatch on later ticks — lifetime of `jsc::EventLoop` / `MiniEventLoop` singleton must exceed the loop's last tick (MiniEventLoop TLS-singleton UAF class).
5. All loop-taking FFI must remain `*mut Loop` (no `&mut` at the boundary): ticks re-enter Rust callbacks that re-fetch the same loop (`src/uws_sys/Loop.rs:618-623`, `src/io/posix_event_loop.rs:1596-1603`, `src/event_loop/MiniEventLoop.rs:206-216`).
6. Layout: `PosixLoop` is field-poked by consumers (`num_polls`, `active`, `fd`, `internal_loop_data.*`, `ready_polls`), and `Bun__lock__size == sizeof(loop->data.mutex)` is runtime-checked by loop.c — either keep the `#[repr(C)]` layout or migrate ~10 direct-field consumers to accessors in the same change.
