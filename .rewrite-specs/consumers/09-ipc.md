# Consumer-Requirements Inventory — Spawn IPC over uSockets

Scope: `src/jsc/ipc.rs`, `src/runtime/api/bun/subprocess.rs`, `src/runtime/api/bun/js_bun_spawn_bindings.rs`, `src/runtime/cli/test/parallel/Channel.rs`, plus the uws layers they call (`src/uws_sys/{SocketGroup.rs, socket.rs, us_socket_t.rs}`, `src/runtime/socket/{uws_handlers.rs, uws_dispatch.rs}`, `src/jsc/VirtualMachine.rs`, `src/jsc/rare_data.rs`, `src/spawn_sys/spawn_process.rs`, `src/runtime/ipc_host.rs`). All paths below are under `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU/`.

---

## 1. How the IPC channel gets a `us_socket_t`

### fd origin: an `AF_UNIX SOCK_STREAM` socketpair created at spawn time
- `src/spawn_sys/spawn_process.rs:935` — extra-fd slots (`PosixStdio::Ipc | Buffer | SocketFd`) do `bun_sys::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, is_ipc)`; for the IPC slot `is_ipc=true` (4th param is the nonblock flag on `bun_sys::socketpair`, `src/sys/lib.rs:3162`), and the explicit `set_nonblocking` at :938 is skipped for IPC (`!is_ipc`). Child end is `dup2`'d to `fileno` (default fd 3), parent end returned as `ExtraPipe::OwnedFd(fds[0])` (:960).
- The kernel-buffer bump and the deliberate **no `shutdown()`** policy: `src/spawn_sys/spawn_process.rs:826-830` — comment: shutdown(SHUT_WR) sends a FIN that programs polling the write end (Python asyncio) misread as connection closed.
- Slot selection / env plumbing: `js_bun_spawn_bindings.rs:522-547` (parse `ipc` callback + `serialization` → `IPC::Mode`, default `Advanced`), `:660` (`ipc_channel = extra_fds.len()` when user places `"ipc"` in stdio array), `:985-1000` (auto-append `Stdio::Ipc` at fd `ipc_channel+3` if absent), `:1006` `NODE_CHANNEL_FD={fd}` env, `:1017-1020` `NODE_CHANNEL_SERIALIZATION_MODE=json|advanced` env.

### Parent side (Bun.spawn) — `from_fd` adoption, POSIX
- `js_bun_spawn_bindings.rs:1272-1276` — `posix_ipc_fd = spawned_extra_pipes[ipc_channel].fd()`.
- `js_bun_spawn_bindings.rs:1503-1526` — the adoption call:
  ```rust
  .rare_data().spawn_ipc_group(...)
  .from_fd(bun_uws::SocketKind::SpawnIpc, None,
           size_of::<*mut IPC::SendQueue>() as c_int,
           posix_ipc_fd.native(), /*ipc=*/true)
  ```
  Group = the lazily-initialized **per-VM `RareData.spawn_ipc_group`** (`src/jsc/rare_data.rs:227, 773-775`; `lazy_group` inits with `vm.uws_loop()` at :765-771). Kind = `SocketKind::SpawnIpc` (`src/uws_sys/SocketKind.rs:56`, discriminant 18).
- Ext slot stamping: `js_bun_spawn_bindings.rs:1532-1540` — `posix_ipc_info.ext::<*mut IPC::SendQueue>()` is written with `ptr::from_mut(ipc_data)`; then `ipc_data.socket = SocketUnion::Open(socket)`.
- fd ownership transfer note: `js_bun_spawn_bindings.rs:1541-1544` — "uws owns the fd now (owns_fd=1); neutralize the slot so finalizeStreams doesn't double-close" (`ExtraPipe::Unavailable`).
- Version packet is written immediately after wiring: `js_bun_spawn_bindings.rs:1583` `ipc_data.write_version_packet(global_this)`.

### Parent side — Windows named-pipe branch
- `js_bun_spawn_bindings.rs:1349-1358` — `ipc_data` SendQueue is created before spawn wiring with `SocketUnion::Uninitialized`.
- `js_bun_spawn_bindings.rs:1546-1582` — takes the heap `uv::Pipe` out of `stdio_pipes[idx]` (`WindowsStdioResult::Buffer`), then `IPC::SendQueue::windows_configure_server(ptr::from_mut(ipc_data), ipc_pipe)`. There is no uSockets socket at all on Windows — `SocketType = *mut uv::Pipe` (`ipc.rs:880-883`).
- `windows_configure_server` (`ipc.rs:1578-1618`): stores `this` in `pipe.data`, `unref()`s the pipe, sets `windows.is_server = true`, and `read_start_ctx::<SendQueue>(this)`.

### Child side (process.send / NODE_CHANNEL_FD)
- Env adoption: `src/jsc/VirtualMachine.rs:3246-3270` — `NODE_CHANNEL_FD` + `NODE_CHANNEL_SERIALIZATION_MODE` are removed from the env map, parsed (i32, non-negative), then `init_ipc_instance(Fd::from_uv(fd), mode)` which stores `IPCInstanceUnion::Waiting { fd, mode }` (:6423-6426, 2809-2817) — lazily materialized only when JS attaches a listener.
- Lazy start: `VirtualMachine::get_ipc_instance` (`VirtualMachine.rs:6429-6558`).
  - POSIX (:6444-6505): boxes an `IPCInstance`, patches `data.owner = instance as *mut dyn SendQueueOwner`, then
    ```rust
    ipc::Socket::from_fd::<ipc::SendQueue>(&mut *group, uws::SocketKind::SpawnIpc, fd,
                                           addr_of_mut!((*instance).data), true)
    ```
    (same `spawn_ipc_group`), followed by `socket.set_timeout(0)` (:6501) and `data.socket = SocketUnion::Open(socket)`. On failure: `IPCInstance::deinit`, warn "Unable to start IPC socket", return None.
  - Windows (:6519-6551): `SendQueue::windows_configure_client(data_ptr, fd)` — allocates a heap `uv::Pipe`, `init(loop, ipc=true)`, `open(pipe_fd.uv())`, `unref()`, `read_start_ctx` (`ipc.rs:1626-1670`).
  - Both branches end with `write_version_packet` (:6555).

### The `from_fd` API itself
- `src/uws_sys/SocketGroup.rs:275-294` → C `us_socket_from_fd(group, kind, ssl_ctx, socket_ext_size, fd, ipc: c_int)` (:370-377). The `ipc` flag makes usockets enable SCM_RIGHTS receive on the socket.
- The safe wrapper `NewSocketHandler::from_fd` (`src/uws_sys/socket.rs:725-753`): ext sized as `Option<NonNull<This>>` (8 bytes, null-niche — comment warns NOT `Option<*mut This>` = 16 bytes), stamped immediately after creation.
- Failure contract (quoted, `Channel.rs:235-236`): "us_socket_from_fd does NOT take ownership on failure; leaving the inherited IPC endpoint open keeps the peer process alive." — so caller closes fd on null return.
- `SocketGroup::pair` exists too (`SocketGroup.rs:296-303`, `us_socket_pair`) but the spawn-IPC path does not use it.

---

## 2. Vtable slots + every `us_socket_*` call

### Vtable registration
- `src/runtime/socket/uws_dispatch.rs:71` — `t[SocketKind::SpawnIpc as usize] = Some(vtable::make::<handlers::SpawnIPC>())`.
- `src/runtime/socket/uws_handlers.rs:846-893` — `SpawnIPC` implements `VHandler` with `Ext = ExtSlot<IPC::SendQueue>` and declares:
  `HAS_ON_OPEN, HAS_ON_DATA, HAS_ON_FD, HAS_ON_WRITABLE, HAS_ON_CLOSE, HAS_ON_TIMEOUT, HAS_ON_END` (all true; no `on_long_timeout`, no `on_connect_error`, no handshake). Comment at :846-849: "Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side `Bun.spawn({ipc})`."

### Slot bodies (POSIX, `ipc.rs` `IPCHandlers::PosixSocket`, :2043-2120)
| Slot | Behavior |
|---|---|
| `on_open` (:2046) | No-op. Critical comment: "it is NOT safe to use the first argument here because it has not been initialized yet… therefore, initializers of IPC handlers need to call `.ipc.writeVersionPacket()` themselves. this is covered by an assertion." (`has_written_version` debug counter, :834, :1105, :1143). |
| `on_close` (:2057) | "uSockets has already freed the underlying socket" → `send_queue._socket_closed()` only (no re-close). |
| `on_data` (:2063) | enter event-loop scope; `on_data2` — mode-specific incremental decode (`ipc.rs:1884-2036`), dispatching `handle_ipc_message`; any `InvalidFormat`/JS error ⇒ `close_socket(Failure)`. |
| `on_fd` (:2071) | **The SCM_RIGHTS receive slot.** Stores `Fd::from_native(fd)` into `send_queue.incoming_fd`; if one was already pending it is closed and overwritten (:2082-2086). Windows arm is dead code. |
| `on_writable` (:2090) | `continue_send(ContinueSendReason::OnWritable)` — drains partial writes. |
| `on_timeout` / `on_long_timeout` (:2100, :2105) | log-only no-ops (sockets are created with `set_timeout(0)`). |
| `on_connect_error` (:2110) | `close_socket(Failure)`. |
| `on_end` (:2116) | `close_socket(Failure, User)` — **no half-close support: a peer FIN immediately closes the socket** (a plain `close`, not `shutdown`; `close_socket` calls `s.close(CloseCode::Normal|Failure)` at `ipc.rs:966-969`). |

### `us_socket_*` calls used by this consumer
- `us_socket_from_fd` — adoption (above).
- `us_socket_write` — `socket.write(data)` in `SendQueue::_write` (`ipc.rs:1515`; wrapper `us_socket_t.rs:339-349`, `socket.rs:370-380`).
- `us_socket_ipc_write_fd` — **the fd-passing write**: `socket.write_fd(data, fd.native())` in `_write` when `queue[0].handle` carries an fd (`ipc.rs:1512-1513`). Wrappers: `socket.rs:386-403` ("Write `data` and pass `file_descriptor` over the socket via SCM_RIGHTS. POSIX-only — Windows IPC fd passing goes through libuv pipes instead."; duplex/pipe fall back to plain write dropping the fd; connecting/detached return 0) and `us_socket_t.rs:353-378` (`unreachable!` on Windows). FFI decl `us_socket_t.rs:522-527`.
- `us_socket_close` — via `NewSocketHandler::close(CloseCode)` (`socket.rs:338`) in `close_socket` (`ipc.rs:966`), `Channel` close/drop, and `raw_on_end` (`Channel.rs:604`).
- `us_socket_timeout` — `socket.set_timeout(0)` after adoption (`VirtualMachine.rs:6501`, `Channel.rs:241`; wrapper `socket.rs:463`).
- `ext()` — ext-slot stamping (`js_bun_spawn_bindings.rs:1534`, `socket.rs:750`, `Channel.rs:569`).
- `us_socket_get_fd` via `Listener` → `get_socket().get_fd()` in `do_send` to extract the fd of a JS `Listener` handle being sent (`src/runtime/ipc_host.rs:152`).
- Group-level: `us_socket_group_init/deinit` (lazy per-VM groups, `rare_data.rs:765-775`), `close_all()` on isolation swap with explicit skips for `spawn_ipc_group`, the child `IPCInstance.group`, and `test_parallel_ipc_group` (`VirtualMachine.rs:4685-4726`).

### Backpressure model (write side)
- `SendQueue` (`ipc.rs:828-859`): ordered `queue: Vec<SendHandle>`, per-message `data: StreamBuffer` with a `cursor`; `_write` (`ipc.rs:1423-1520`) issues ONE `us_socket_write`/`write_fd` per attempt: full write pops the item (and moves handle-bearing messages to `waiting_for_ack`, `ipc.rs:1296-1305`); partial write advances `cursor` and waits for `on_writable` (:1315-1319); `n == 0` waits for writable (:1321); `n < 0` ⇒ `close_socket(Failure)` (:1326).
- Handle messages implement a NODE_HANDLE ACK/NACK stop-and-wait protocol: only ack/nack packets may bypass `waiting_for_ack` (`ipc.rs:1255-1260`); NACK retries up to `MAX_HANDLE_RETRANSMISSIONS = 3` (`ipc.rs:1165-1174, 1743`) then emits `SentHandleNotReceivedWarning`.
- The fd is re-sent with every retry: `SendHandle` comment (`ipc.rs:748-752`) — "when a message has a handle, make sure it has a new SendHandle… / keep sending the handle until data is drained (assume it hasn't sent until data is fully drained)". A partial write means the handle was not sent (`ipc.rs:1316-1317` comment).
- Event-loop keep-alive: `should_ref`/`update_ref` (`ipc.rs:1201-1229`) ref the loop while `waiting_for_ack` or a partially-sent head exists; via `bun_io::KeepAlive` + `get_vm_ctx`.
- JS-visible backpressure: `serialize_and_send` returns `Backoff` when `waiting_for_ack && !queue.is_empty()` (`ipc.rs:1366, 1382-1385`); `do_send` maps Success→`true`, Backoff→`false`, Failure→"process.send() failed" TypeError with `syscall: "write"` (`ipc_host.rs:161-185`).

### Close/disconnect semantics
- No half-close anywhere: user `disconnect()` → `close_socket_next_tick(true)` (`subprocess.rs:803-816`) → deferred task → `close_socket(Normal, User)` → `s.close(...)`. Pending outgoing bytes ARE dropped (Windows only has `try_close_after_write` deferral, `ipc.rs:955-962`; POSIX closes immediately).
- `on_end` (peer FIN) is treated as failure-close, not read-shutdown (`ipc.rs:2116-2119`).
- Close notification is a next-tick task `_onAfterIPCClosed` → `owner.handle_ipc_close()` exactly once (`close_event_sent` gate, `ipc.rs:1082-1094`), only enqueued on the open→closed transition (`ipc.rs:1001`).

---

## 3. Socket ref storage & lifetime

### Parent side
- `Subprocess.ipc_data: JsCell<Option<IPC::SendQueue>>` — inline in the JSC-heap Subprocess (`subprocess.rs:147`). The socket ext slot holds a raw `*mut SendQueue` back into that inline storage (`js_bun_spawn_bindings.rs:1532-1537`); the SendQueue holds `SocketUnion::Open(Socket)` back (bidirectional backrefs).
- `SendQueue.owner: *mut dyn SendQueueOwner` — BACKREF into the embedding Subprocess/IPCInstance; layering note `ipc.rs:29-44` (Subprocess is tier-6 so a trait object is used); field doc `ipc.rs:842-847`: "never reborrow as `&mut dyn` while a `&mut SendQueue` is live".
- GC pinning: `compute_has_pending_activity` (`subprocess.rs:407-421`) keeps the JS wrapper alive until `close_event_sent` — quoted rationale: "gating on `close_event_sent` (rather than `socket != .closed`) keeps the wrapper Strong across the window where the socket is already `.closed` but the task holding a raw `*SendQueue` into `ipc_data` is still queued."
- Finalizer: `subprocess.rs:1298-1306` — `ipc_data.replace(None)` then `drop`; comment: "`disconnectIPC` would be a no-op in that state and would leak the SendQueue's buffers; deinit it instead. `SendQueue.deinit` handles the VM-shutdown case where the socket is still open."

### Child side
- `VirtualMachine.ipc: Option<IPCInstanceUnion>` (`VirtualMachine.rs:314`); `IPCInstance` is a `heap::into_raw` Box holding `{global_this, group: *mut SocketGroup, data: SendQueue, has_disconnect_called}` (`VirtualMachine.rs:2820-2830`). `channel_ref: Async::KeepAlive` on the VM (:335-337) holds the loop for `process.channel.ref()/unref()` semantics (`node_cluster_binding.rs:321-342`); disabled in `handle_ipc_close` (:2901).
- Test-isolation swap repoints `instance.global_this` at the new global "so `Process__emitMessageEvent` doesn't dispatch on a freed cell" (`VirtualMachine.rs:4787-4791`).

### Cross-thread concerns
- Everything is single-JS-thread; the code's discipline is aliasing (Stacked Borrows), not locking: ext-slot / `uv_handle_t.data` pointers must derive from the root raw allocation, e.g. `VirtualMachine.rs:6471-6478` (quoted): "PROVENANCE: `from_fd` STORES the `*mut SendQueue` in the socket ext slot for the socket's lifetime, so that pointer must derive from the root raw `instance` (SharedReadWrite tag, never popped), NOT from a `&mut IPCInstance` reborrow whose Unique tag would be invalidated by later writes through `instance`."
- Same for both Windows configure fns' `# Safety` contracts (`ipc.rs:1571-1576, 1620-1625`).
- Groups are per-VM (per-thread) — `RareData.spawn_ipc_group` — so a rewritten core must support multiple independent socket groups on one loop, each carrying its own vtable, enumerable via `internal_loop_data.head` / `group.next` (`VirtualMachine.rs:4707-4725`, `SocketGroup.rs` `next_in_loop`).

---

## 4. Unusual lifecycle (quotes verbatim)

**Child exit vs socket close ordering (parent):** `Subprocess::on_process_exit` runs callbacks then `self.disconnect_ipc(true)` at the tail (`subprocess.rs:1135`) — i.e. process exit *initiates* a next-tick socket close; the socket may also close first via peer EOF (`on_end`). `connected` getter is `ipc_data.is_connected()` which is false as soon as a close is *scheduled* (`ipc.rs:930-936` checks `close_next_tick.is_none()`).

**Deferred deinit / UAF discipline:**
- `ipc.rs:996-1000`: "Only enqueue the close notification for the open→closed transition. `closeSocket` (via `SendQueue.deinit` during the owner's finalizer) can reach this path again with the socket already `.closed`; the owner is about to free the memory that backs `this`, so scheduling a task that points back into it would use-after-free."
- `ipc.rs:851-854` (`after_close_task` doc): "Set while an `_onAfterIPCClosed` task is queued. Cleared when the task runs. Tracked so `deinit` can cancel it; the task captures a raw `*SendQueue` into the owner's inline storage, which is freed right after `deinit` returns."
- `Drop for SendQueue` (`ipc.rs:1707-1740`): `close_socket(Failure, Deinit)` "must go first"; closes any un-consumed `incoming_fd` — ":1715-1716: 'An SCM_RIGHTS fd can be stashed by `onFd` and not yet consumed by the `NODE_HANDLE` decoder when the socket closes.'"; cancels `close_next_tick`: ":1721: 'if there is a close next tick task, cancel it so it doesn't get called and then UAF'"; and cancels `after_close_task`: ":1729-1732: 'Same for the close-notification task. `closeSocket` above may have just enqueued this (VM-shutdown path with the socket still open), or it may be left over from an earlier `_socketClosed` that hasn't drained yet; either way the owner is about to free our storage.'"
- Windows write-request orphaning (`ipc.rs:984-991`): "SAFETY: `windows_write` was leaked via `heap::alloc` in `_write`; libuv still holds it and will free it in `_windows_on_write_complete`. We only clear the backref so the callback doesn't touch a dead `SendQueue`." (callback checks `owner == None` → "orelse case if disconnected before the write completes", :1534).
- Sync-error aliasing (`ipc.rs:1482-1488`): "Synchronous-error path: do NOT call `_windows_on_write_complete` here — that helper rebuilds `&mut SendQueue` from the raw `write_req.owner` backref, which would alias the `&mut self` already live in this frame."

**Mode negotiation (json/advanced):** `Mode` enum `ipc.rs:203-233`; Advanced sends a 5-byte `Version(1)` packet first (`ipc.rs:290-320`); JSON's version packet is empty (`ipc.rs:452-454`). Mode is chosen by parent (`serialization` option) and propagated to the child via `NODE_CHANNEL_SERIALIZATION_MODE`; child defaults to Json when the env var is absent (`VirtualMachine.rs:3250-3254`) — Node interop. JSON internal messages get a leading `0x02` byte (`ipc.rs:462-465`). Advanced decode has an explicit u32-overflow bounds-check comment (`ipc.rs:356-364`). NODE_HANDLE ACK/NACK constant packets exist per mode (`ipc.rs:393-398, 455-460`).

**fd receive → JS handle:** `handle_ipc_message` (`ipc.rs:1811-1867`): on `cmd:"NODE_HANDLE"`, ACK iff `incoming_fd` is present, then `ipc_parse(global, target, msg, fd_js)` (C++ shim reconstructs a net.Server/Socket from the raw fd); on parse error the fd is closed and "ack written already, that's okay." Send side: `ipc_serialize` (C++ `IPCSerialize`) splits a JS handle into `[serialized_handle, message]` and `do_send` extracts the fd from a `Listener` via `get_socket().get_fd()` (`ipc_host.rs:128-156`).

**Windows uv-pipe branch:** parent = pipe server (`windows_configure_server`, spawn creates the pipe pair), child = `uv_pipe_open` on the inherited fd (`windows_configure_client`, `ipc.rs:1626-1670`); read path via `StreamReader` trait (`ipc.rs:1677-1705`) with the Stacked-Borrows note that only the read *length* crosses the trampoline; `WindowsNamedPipe::on_read_alloc` hands out spare capacity of the incoming buffer directly (`ipc.rs:2125-2139`). `TODO: send fd on windows` (`ipc.rs:1431-1433`) — fd-passing is unimplemented on Windows.

---

## 5. `test/parallel/Channel.rs` — what it does with sockets

Bidirectional coordinator↔worker channel for `bun test --parallel` (module doc :1-16).
- **Adopt** (`Channel::adopt`, :180-244): POSIX — `Socket::from_fd(group, SocketKind::Dynamic, fd, ptr_to_self, /*ipc=*/true)` on the per-VM `test_parallel_ipc_group`, then `set_timeout(0)`. Uses `SocketKind::Dynamic` with a **hand-rolled per-Owner static `SocketGroupVTable`** installed lazily on the group (:128-135, :545-557) because the generic `vtable::Handler` is `'static`-bounded. Note: `ipc=true` even though it never sends fds (framing parity with the peer end created by spawn's IPC slot).
- **Vtable slots implemented** (:545-557): `on_data` (frame ingest), `on_writable` (flush buffered `out`), `on_close` (detach + `mark_done`), `on_end` (→ `(*s).close(CloseCode::normal)` — again no half-close). `on_open/on_fd/on_timeout/…` = None.
- **Writes** (:285-308, :409-425): direct `socket.write()`; short/zero writes buffer the remainder in `out`, drained on `on_writable`. `wrote <= 0` just waits (no error close on the POSIX write path).
- **Close/Drop** (:427-450, :504-524): flush best-effort, `socket.close(CloseCode::Normal)`, detach. "Drop assumes no write is in flight."
- Windows backend is a `uv::Pipe` (init'ed with `ipc=true`; comment :187-193 explains libuv's transparent IPC framing requirement) with a single in-flight `uv_write` + swap-buffer scheme (:311-377).
- Owner recovery is `container_of` via `IntrusiveField::OFFSET` (:80-87), ext slot holds `*mut Channel<Owner>` (:536-570).

---

## 6. Migration notes — required surface of the new uSockets-core crate

**fd adoption:**
1. `us_socket_from_fd(group, kind, ssl_ctx, ext_size, fd, ipc_flag) -> *mut us_socket_t` with exactly these semantics:
   - takes ownership of the fd **only on success** (`Channel.rs:235`; caller closes on null);
   - `owns_fd` set so socket close closes the fd (`js_bun_spawn_bindings.rs:1541`);
   - registers in the loop immediately readable/writable-armed; **no `on_open` dispatch usable for writes** (ipc.rs:2046-2055 contract — version packet is written by the adopter, not on_open);
   - `ipc_flag` enables SCM_RIGHTS receive → `on_fd` callback;
   - per-socket ext storage of caller-specified size, readable/writable via `ext()`, stamped post-creation;
   - works on an adopted `AF_UNIX SOCK_STREAM` socketpair end that may be **blocking** (IPC parent end is not set nonblocking at spawn: `spawn_process.rs:938` skips it for `is_ipc` — usockets must set nonblocking itself on adoption).
2. Socket groups: multiple lazily-created groups per loop (`RareData.spawn_ipc_group`, `test_parallel_ipc_group`), each with its own static vtable (`Option<fn>` slots — Channel.rs installs a vtable *after* group init, first-owner-wins :128-135), iterable (`head`/`next`/`linked`) and bulk-closable with skip-lists (`VirtualMachine.rs:4707-4725`).
3. `us_socket_pair` exists in the current API (`SocketGroup.rs:296`) but spawn-IPC doesn't use it; Channel/spawn always adopt externally-created fds.

**fd passing:**
4. `us_socket_ipc_write_fd(s, data, len, fd) -> i32` — write `data` with the fd attached as SCM_RIGHTS ancillary on the *first byte(s)*; return bytes accepted (partial OK). Contract consumers rely on: a partial write ⇒ handle NOT delivered, and the retry re-attaches the same fd (`ipc.rs:1316-1317`, `SendHandle` doc :748-752). POSIX-only; must be callable repeatedly for retransmission (NACK retry, `ipc.rs:1165-1174`).
5. `on_fd(ext, socket, fd)` receive slot delivering the raw received fd; may fire before the accompanying `NODE_HANDLE` json/advanced message bytes; consumer stores at most one pending fd and closes the previous on overwrite (`ipc.rs:2082-2086`) and closes an unconsumed one at socket teardown (`ipc.rs:1715-1719`).
6. `us_socket_get_fd` (used to *send* a listening socket: `ipc_host.rs:152`).

**write/backpressure:**
7. `us_socket_write(s, data, len) -> i32` with `>=0` partial-write semantics, `0 = would-block`, `<0 = error`; `on_writable` fired when the kernel buffer drains. The IPC consumer performs its own queueing — it needs *no* internal usockets send buffer, but the return-count contract must be exact (cursor arithmetic `ipc.rs:1295-1330`).
8. `us_socket_timeout(s, 0)` (disable), `us_socket_close(s, code)`.

**close semantics:**
9. `on_end` (peer FIN) as a distinct slot — consumers respond with full `close()`; **no half-close/shutdown API is required** by these consumers (and `spawn_process.rs:826` documents that shutdown must NOT be issued on the pair).
10. `on_close(ext, s, code, reason)` fired exactly once after the fd is already freed ("uSockets has already freed the underlying socket", `ipc.rs:2058`), including for `close()` called from within other callbacks; ext must still be readable inside `on_close` (SendQueue backref runs `_socket_closed`).
11. `close()` must be safe to call re-entrantly/idempotently from `Drop`/finalizers (CloseFrom::Deinit path), and from inside `on_data` after a protocol error.

**dispatch/ext discipline:**
12. Ext slot is an 8-byte pointer read as `Option<NonNull<T>>` (`socket.rs:743-747`); trampolines must tolerate a null/None ext (every `SpawnIPC` slot bails on `owner_mut() == None`, `uws_handlers.rs:868-892`) because the ext is stamped *after* `from_fd` returns.
13. Stored context pointers must be treated as whole-allocation raw pointers (never reborrowed `&mut`) — preserve the ability to write the ext slot with root-provenance pointers (PROVENANCE comments at `VirtualMachine.rs:6471`, `js_bun_spawn_bindings.rs:1565`, `ipc.rs:1571`).
14. Windows is entirely out of scope for the socket core here: IPC and Channel both use libuv named pipes (`SocketType = *mut uv::Pipe`, `ipc.rs:880-883`; `write_fd` is `unreachable!` on Windows, `us_socket_t.rs:374-378`).
