# Public API surface: `bun_uws_sys` (src/uws_sys) and `bun_uws` (src/uws)

All paths below are relative to `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU/`.

---

## 1. `us_socket_t` — src/uws_sys/us_socket_t.rs

Opaque ZST via `opaque_ffi!` [us_socket_t.rs:19]. TLS is per-socket (`s->ssl != NULL`), no `int ssl` selector; dispatch is by `kind()` [us_socket_t.rs:12-15].

**CloseCode** (`#[repr(i32)]`) [us_socket_t.rs:21-33]:
- `normal = 0` — TLS: send close_notify, defer fd close until peer replies; TCP: FIN.
- `failure = 1` — TLS: fast-shutdown; TCP: SO_LINGER{1,0} → RST dropping unflushed buffer. For `terminate()` / GC abort.
- `fast_shutdown = 2` — TLS: fast-shutdown; TCP: FIN. For `_handle.close()` where JS detaches immediately but written data must drain.
- PascalCase aliases `Normal`/`Failure`/`FastShutdown` as associated consts [socket.rs:38-43]; `CloseKind = CloseCode` legacy alias [uws/lib.rs:1361].

**UsIoVec** — `#[repr(C)] { base: *const c_void, len: usize }`, layout == POSIX iovec [us_socket_t.rs:36-41].

Methods on `us_socket_t`:
- `open(&mut, is_client: bool, ip_addr: Option<&[u8]>)` — fire open path / kick TLS accept/connect [us_socket_t.rs:44]
- `pause()` / `resume()` — stop/restart readable polling [us_socket_t.rs:65,70]
- `close(code: CloseCode)` — close with semantics per CloseCode [us_socket_t.rs:75]
- `shutdown()` — write-side shutdown (TLS close_notify / TCP FIN) [us_socket_t.rs:88]
- `shutdown_read()` [us_socket_t.rs:93]
- `is_closed() -> bool` [us_socket_t.rs:97]
- `write_check_error(&self, data) -> (i32, bool)` — write that also reports fatal non-EWOULDBLOCK send error for node:net [us_socket_t.rs:103]
- `is_shutdown() -> bool` [us_socket_t.rs:118]
- `is_tls() -> bool` [us_socket_t.rs:122]
- `local_port() / remote_port() -> i32` [us_socket_t.rs:126,130]
- `local_address / remote_address(&self, buf: &mut [u8]) -> Result<&[u8], bun_core::Error>` — view into buf; negative length → errno [us_socket_t.rs:135,151]
- `set_timeout(seconds: u32)` / `set_long_timeout(minutes: u32)` — second-wheel vs minute-wheel timeout [us_socket_t.rs:166,170]
- `set_nodelay(bool)` [us_socket_t.rs:174]
- `set_keepalive(enabled, delay: u32) -> i32` [us_socket_t.rs:178]
- `set_tos(i32) -> i32` / `get_tos() -> i32` — IP TOS/traffic class, negative errno on failure [us_socket_t.rs:184,189]
- `sni_resolve(ctx: *mut SslCtx, error: bool)` — resume handshake suspended by async SNICallback; consumes owned SSL_CTX ref (null = fall through to default ctx); error=true aborts [us_socket_t.rs:196]
- `ssl() -> Option<&mut SSL>` — `SSL*` if TLS else None [us_socket_t.rs:201]
- `get_native_handle() -> Option<*mut c_void>` — node `_handle` shape: SSL* for TLS, fd-as-pointer for TCP [us_socket_t.rs:216]
- `ext<T>() -> &mut T` / `ext_ptr() -> *mut u8` — LIBUS_EXT_ALIGNMENT-aligned trailing storage [us_socket_t.rs:221,231]
- `group() -> &mut SocketGroup` (+ `raw_group()` alias) [us_socket_t.rs:235,242]
- `kind() -> SocketKind` / `set_kind(SocketKind)` — dispatch tag; set_kind re-stamps in place (Listener.onCreate → BunSocket) [us_socket_t.rs:246,253]
- `adopt(&mut, g, kind, old_ext, new_ext) -> Option<NonNull<us_socket_t>>` — move socket to new group/kind, may realloc; self invalid after [us_socket_t.rs:260]
- `adopt_tls(&mut, g, kind, ssl_ctx, sni: Option<&CStr>, is_client, old_ext, new_ext) -> Option<NonNull<..>>` — adopt + attach fresh SSL* from ctx; does NOT kick handshake (caller repoints ext first). Replaces `us_socket_upgrade_to_tls`/`wrapTLS` [us_socket_t.rs:277]
- `start_tls_handshake()` — send ClientHello; split from adopt_tls [us_socket_t.rs:305]
- `tls_feed(data: &[u8])` — feed already-read bytes through TLS decrypt path (chunked at i32; stops if socket closes mid-feed) [us_socket_t.rs:312]
- `set_ssl_raw_tap(enabled)` — tee inbound ciphertext to `us_dispatch_ssl_raw_tap` before SSL_read (upgradeTLS `[raw, tls]` pair) [us_socket_t.rs:335]
- `write(data) -> i32` [us_socket_t.rs:339]
- `write_fd(data, fd: Fd) -> i32` — write + SCM_RIGHTS fd pass; `unreachable!` on Windows [us_socket_t.rs:353,374]
- `write2(first, second) -> i32` — two-buffer write (header+payload) [us_socket_t.rs:381]
- `raw_writev(iov: &[UsIoVec]) -> i32` — vectored raw write, one writev; plain-TCP only (bypasses TLS framing) [us_socket_t.rs:407]
- `raw_write(data) -> i32` — bypass TLS even if `is_tls()` [us_socket_t.rs:421]
- `flush()` [us_socket_t.rs:433]
- `send_file_needs_more()` — sendfile marker (`us_socket_sendfile_needs_more`) [us_socket_t.rs:437]
- `get_fd() -> Fd` [us_socket_t.rs:441]
- `get_verify_error() -> us_bun_verify_error_t` [us_socket_t.rs:456]
- `get_error() -> i32` [us_socket_t.rs:460]
- `is_established() -> bool` [us_socket_t.rs:464]

**us_socket_stream_buffer_t** `#[repr(C)] {list_ptr, list_cap, list_len, total_bytes_written, cursor}` [us_socket_t.rs:601-608]; methods `update(StreamBuffer)`, `wrote(usize)`, `to_stream_buffer()`, `unsafe destroy(*mut Self)` [us_socket_t.rs:631-679]; exported `extern "C" us_socket_free_stream_buffer` [us_socket_t.rs:682].

---

## 2. `InternalSocket` / `NewSocketHandler<IS_SSL>` / `AnySocket` — src/uws_sys/socket.rs

Canonical implementation (bun_uws re-exports; do not duplicate) [socket.rs:1-12].

**InternalSocket** — `Copy` tagged raw-pointer enum: `Connected(*mut us_socket_t)`, `Connecting(*mut ConnectingSocket)`, `Detached`, `UpgradedDuplex(*mut UpgradedDuplex)`, `Pipe(*mut WindowsNamedPipe)` (Windows) / payload-less `Pipe` (non-Windows) [socket.rs:56-65]. `PartialEq` = variant + ptr identity; `(Pipe,Pipe)` non-Windows deliberately false [socket.rs:71-87]. Methods: `get() -> Option<*mut us_socket_t>` (Connected only) [92], `is_detached()` [99], `is_named_pipe()` [103].

**NewSocketHandler<const IS_SSL: bool>** — single-field `{socket: InternalSocket}`, `Copy` [socket.rs:194]. Aliases: `SocketTCP`/`SocketTLS`/`SocketTcp`/`SocketTls`/`SocketHandler<SSL>` [socket.rs:198-204]. IS_SSL only gates `get_native_handle`; not forwarded to C [socket.rs:190-193].

- `DETACHED` const / `detached()` [socket.rs:207,213]
- `assume_ssl()` / `assume_tcp()` / `cast_ssl<NEW_SSL>()` — const-generic discriminant casts (debug-asserted) [socket.rs:222,229,239]
- `detach()` / `is_detached()` / `is_named_pipe()` [socket.rs:247,251,255]
- `write_check_error(data) -> (i32, bool)` — fatal-error write; duplex/pipe fall back to plain write [socket.rs:263]
- `is_closed()` / `is_shutdown()` (detached ⇒ true) [socket.rs:272,282]
- `is_established()` [socket.rs:292]
- `is_closed_or_has_error()` [socket.rs:302]
- `get_verify_error() -> us_bun_verify_error_t` [socket.rs:306]
- `get_error() -> i32` [socket.rs:315]
- `dns_error() -> i32` — raw getaddrinfo rc for Connecting; 0 otherwise; different namespace from get_error (errno) [socket.rs:329]
- `close(code)` / `shutdown()` / `shutdown_read()` [socket.rs:338,348,358]
- `write(data) -> i32` (duplex/pipe → `encode_and_write`) [socket.rs:370]
- `write_fd(data, fd: c_int) -> i32` (POSIX only; duplex/pipe drop fd, plain write) [socket.rs:386]
- `raw_writev(iov) -> i32` — writev on real socket, sequential raw writes on duplex/pipe [socket.rs:401]
- `raw_write(data) -> i32` — bypass TLS [socket.rs:431]
- `flush()` [socket.rs:440]
- `timeout(seconds)` — direct, no long-timeout split [socket.rs:452]
- `set_timeout(seconds)` — >240 s split onto minute-granularity long-timeout wheel [socket.rs:463]
- `set_timeout_minutes(minutes)` [socket.rs:485]
- `pause_stream() / resume_stream() -> bool` (connecting/duplex false; TODO on duplex) [socket.rs:497,507]
- `set_no_delay(bool) -> bool` [socket.rs:517]
- `set_keep_alive(enabled, delay) -> bool` [socket.rs:527]
- `set_tos(i32) -> i32` / `get_tos() -> i32` — non-Connected reports -9 (-EBADF, node no-handle fallback) [socket.rs:537,545]
- `sni_resolve(ctx, error)` — non-Connected frees the passed SSL_CTX ref [socket.rs:555]
- `start_tls(is_client)` — kick TLS open on already-connected socket (calls `open`) [socket.rs:571]
- `ssl() -> Option<*mut SSL>` (None unless IS_SSL) [socket.rs:579]
- `get_native_handle() -> Option<*mut c_void>` — SSL* when IS_SSL, fd-as-ptr otherwise [socket.rs:590]
- `ext<T>() -> Option<*mut T>` — raw ptr (None for duplex/pipe/detached) [socket.rs:612]
- `group() -> Option<*mut SocketGroup>` [socket.rs:625]
- `fd() -> Fd` (Fd::INVALID unless Connected) [socket.rs:637]
- `local_port()` / `remote_port()` [socket.rs:644,651]
- `local_address / remote_address(buf) -> Option<&[u8]>` (panics on syscall error) [socket.rs:658,671]
- `mark_needs_more_for_sendfile()` — const-asserts `!IS_SSL` [socket.rs:684]
- Constructors: `from(*mut us_socket_t)` [694], `from_connecting` [700], `from_any(InternalSocket)` [706], `from_duplex` [710], `from_named_pipe` (Windows) [717], `from_fd<This>(g, kind, handle, this, is_ipc) -> Option<Self>` — wraps open fd, ext stores `Option<NonNull<This>>` (8-byte niche layout, NOT `Option<*mut>`) [socket.rs:725], `connect_group<Owner>(g, kind, ssl_ctx, host, port, owner, allow_half_open) -> Result<Self, ConnectError>` — strips `[v6]` brackets, NUL-terminates host, sets ext owner on both fast/slow arms [socket.rs:757], `connect_unix_group` [818], `adopt_group<Owner>(tcp, g, kind, owner, set_socket_field: FnOnce(*mut Owner, Self)) -> bool` — replaces `Socket.adoptPtr`; closure writes through raw ptr to avoid aliasing [socket.rs:849].

**ConnectError** — single variant `FailedToOpenSocket`, `Into<bun_core::Error>` [socket.rs:904-912].

**AnySocket** — `Copy` enum `SocketTcp(SocketTCP) | SocketTls(SocketTLS)` (TODO rename ConnectedSocket) [socket.rs:919-923]. Own methods: `is_ssl()` [940], `socket() -> &InternalSocket` [944], `ext<T>()` [951], `terminate()` = close(failure) [958], `group() -> *mut SocketGroup` (unwraps) [962]. Macro-forwarded: `is_closed, is_shutdown, is_established, close, write, set_timeout, shutdown, shutdown_read, local_port, get_native_handle` [socket.rs:970-981].

---

## 3. `SocketGroup` — src/uws_sys/SocketGroup.rs

Not opaque: full `#[repr(C)]` Rust mirror of C `struct us_socket_group_t`, **embedded by value** in its owner (Listener, VirtualMachine RareData, uWS App, HTTPThread); loop links lazily on first socket, unlinks on last [SocketGroup.rs:1-8]. Fields: `loop_: *mut Loop`, `vtable: Option<&'static VTable>`, private `ext: *mut c_void` (owner), `head_sockets`, `head_connecting_sockets`, `head_listen_sockets`, `iterator`, `prev`, `next`, `global_tick: u32`, `low_prio_count: u16` (sockets parked in loop low_prio_head — not in head_sockets while queued), `timestamp: u8`, `long_timestamp: u8`, `linked: u8` [SocketGroup.rs:18-40]. Layout assertions: 9 ptrs + 16 bytes [SocketGroup.rs:63-66]. Zeroable; `Default` = zeroed [SocketGroup.rs:74-88].

**VTable** (per-group C vtable, `us_socket_vtable_t`, 11 fn-ptr slots) [SocketGroup.rs:42-59]:
- `on_open(*mut us_socket_t, c_int is_client, *mut u8 ip, c_int ip_len) -> *mut us_socket_t`
- `on_data(s, *mut u8, c_int) -> s`
- `on_fd(s, c_int fd) -> s`
- `on_writable(s) -> s`
- `on_close(s, c_int code, *mut c_void reason) -> s`
- `on_timeout(s) -> s` (short/seconds wheel)
- `on_long_timeout(s) -> s` (minutes wheel)
- `on_end(s) -> s`
- `on_connect_error(s, c_int) -> s`
- `on_connecting_error(*mut ConnectingSocket, c_int) -> *mut ConnectingSocket`
- `on_handshake(s, c_int ok, us_bun_verify_error_t, *mut c_void)`

Methods:
- `init(&mut, loop_: *mut Loop, vt: Option<&'static VTable>, owner_ptr: *mut c_void)` — in-place C init; owner_ptr is what `owner::<T>()` recovers [SocketGroup.rs:101]
- `unsafe destroy(*mut Self)` — explicit teardown (`us_socket_group_deinit`); no Drop (FFI-managed) [SocketGroup.rs:126]
- `close_all()` — `us_socket_group_close_all` [SocketGroup.rs:131]
- `get_loop() -> *mut Loop` (non-null post-init) [SocketGroup.rs:139]
- `owner<T>() -> *mut T` — recover embedding owner; null for per-kind VM groups in RareData [SocketGroup.rs:152]
- `is_empty() -> bool` — all heads null AND `low_prio_count == 0` [SocketGroup.rs:157]
- `listen(kind, ssl_ctx: Option<*mut SslCtx>, host: Option<&CStr>, port, options, socket_ext_size, err: &mut c_int) -> *mut ListenSocket` [SocketGroup.rs:164]
- `listen_unix(kind, ssl_ctx, path: &[u8], options, socket_ext_size, err) -> *mut ListenSocket` [SocketGroup.rs:189]
- `connect(kind, ssl_ctx, host: &CStr, port, local_binding: Option<(&CStr, u16)>, options, socket_ext_size) -> ConnectResult` — C out-param `has_dns_resolved` discriminates `Socket` (sync, DNS already resolved) vs `Connecting` placeholder vs `Failed` [SocketGroup.rs:213]
- `connect_unix(kind, ssl_ctx, path, options, socket_ext_size) -> *mut us_socket_t` [SocketGroup.rs:253]
- `from_fd(kind, ssl_ctx, socket_ext_size, fd, ipc: bool) -> *mut us_socket_t` [SocketGroup.rs:275]
- `pair(kind, ext_size, fds: &mut [LIBUS_SOCKET_DESCRIPTOR; 2]) -> *mut us_socket_t` — socketpair [SocketGroup.rs:296]
- `next_in_loop() -> *mut SocketGroup` — direct field read of `next` (iteration over loop-linked groups) [SocketGroup.rs:306]

`ConnectResult` enum: `Socket(*mut us_socket_t) | Connecting(*mut ConnectingSocket) | Failed` [SocketGroup.rs:90-94].
Timeout sweep state lives in `global_tick`/`timestamp`/`long_timestamp` fields walked by loop.c; ref/unref is a Loop concept (below), not per-group.

---

## 4. `Loop` — src/uws_sys/Loop.rs

`Loop = PosixLoop` (non-Windows) / `WindowsLoop` [Loop.rs:603-606]. **PosixLoop** is a sized `#[repr(C, align(16))]` mirror of C `us_loop_t`: `internal_loop_data: InternalLoopData`, `num_polls`, `num_ready_polls`, `current_ready_poll`, `fd`, `active: u32` (Bun-owned poll count), `pending_wakeups: u32` (atomic wakeup counter swapped to 0 before epoll/kqueue), align pad, `ready_polls: [EventType; 1024]` [Loop.rs:21-50]. `EventType` = `epoll_event` (Linux/Android) / `kevent64_s` (macOS) / `kevent` (FreeBSD) [Loop.rs:87-94]. Layout statically asserted [Loop.rs:64-83].

**LoopHandler trait** — `const WAKEUP: unsafe extern "C" fn(*mut Loop)`; optional `PRE`/`POST` [Loop.rs:101-105].

PosixLoop methods [Loop.rs:112-356]:
- `uncork()` — `uws_res_clear_corked_socket` [113]
- `update_date()` — `uws_loop_date_header_timer_update` [118]
- `iteration_number() -> u64` — reads `internal_loop_data.iteration_nr` [123]
- `current_ready_event() -> EventType` — copy of `ready_polls[current_ready_poll]` [136]
- `inc()` / `dec()` — num_polls ± 1 [141,146]
- `ref_()` / `unref()` — num_polls and active ± 1 [151,164]
- `is_active() -> bool` — active > 0 [177]
- `add_active(u32)` / `sub_active(u32)` / `unref_count(i32)` [182,194,205]
- `get() -> *mut Loop` — thread-local `uws_get_loop()` [213]
- `drain_quic_if_necessary()` — flush HTTP/3 stream writes if `quic_head` non-null (`us_quic_loop_flush_if_pending`) [220]
- `create<H: LoopHandler>() -> *mut Loop` — `us_create_loop(hint=null, WAKEUP, PRE, POST, ext=0)` [228]
- `wakeup()` / `wake()` — `us_wakeup_loop` [237,243]
- `tick()` — `us_loop_run_bun_tick(self, null)` [247]
- `tick_without_idle()` — bun tick with zero timespec [252]
- `tick_with_timeout(Option<&Timespec>)` [258]
- `drain_closed_sockets()` — `us_internal_free_closed_sockets`; frees `closed_head`/`closed_connecting_head` at teardown when loop_post no longer runs (LSAN) [270]
- `close_all_groups() -> bool` — `us_socket_group_close_all` on every linked group [278]
- `next_tick(user_data, extern "C" fn(*mut c_void))` — `uws_loop_defer` [287]
- `unsafe add_post_handler(this: *mut Self, ctx, cb) -> Handler` / `unsafe add_pre_handler(...)` — takes raw ptr for provenance [305,322]
- `run()` — `us_loop_run` [336]
- `should_enable_date_header_timer() -> bool` — `sweep_timer_count > 0` [341]
- `unsafe destroy(*mut PosixLoop)` — `us_loop_free` [352]

`Handler` struct — stored `{loop_, ctx, callback}` with `remove_post()` / `remove_pre()` (remove_pre intentionally calls `uws_loop_removePostHandler` — preserved upstream bug) [Loop.rs:363-385].

**WindowsLoop** [Loop.rs:390-599]: fields `internal_loop_data`, `uv_loop: *mut uv::Loop`, `is_default`, `pre: *mut uv_prepare_t`, `check: *mut uv_check_t` [391-398]. Same surface routed through libuv: `get()` = `uws_get_loop_with_native(uv default loop)` [411]; `uv()`/`uv_mut()` accessors [427,440]; active/inc/dec forwarded to uv counters [447-526]; `tick_with_timeout` → `us_loop_run`; `tick_without_idle` → `us_loop_pump` [469,474]; plus `run/tick/wait`, `drain_closed_sockets`, `close_all_groups`, `next_tick`, `update_date`, `destroy`, `add_post_handler`/`add_pre_handler` — same semantics.

Raw re-exports for cross-thread callers (no `&mut` allowed): `pub use c::{us_loop_run, us_wakeup_loop}` [Loop.rs:661].
`on_thread_exit()` — clears the C thread-local loop pointer (`bun_clear_loop_at_thread_exit`); called when a Worker thread that ran a loop exits [Loop.rs:663-673].

### `InternalLoopData` — src/uws_sys/InternalLoopData.rs
`#[repr(C)]` mirror of `us_internal_loop_data_t` [InternalLoopData.rs:26-64]. Fields: `sweep_timer: *mut Timer` (Windows) / `sweep_next_tick_ns: i64` (POSIX), `sweep_timer_count: i32`, `wakeup_async: *mut us_internal_async` (opaque, [20-23]), `head`/`iterator: *mut SocketGroup`, `quic_head: *mut c_void`, `quic_next_tick_us: i64` (+`quic_timer` Windows), `recv_buf`/`send_buf: *mut u8`, `ssl_data: *mut c_void`, `pre_cb`/`post_cb`, `closed_udp_head`, `closed_head: *mut us_socket_t`, **`low_prio_head: *mut us_socket_t` + `low_prio_budget: i32`** (low-priority processing budget), `dns_ready_head`/`closed_connecting_head: *mut ConnectingSocket`, `mutex: LoopDataMutex` (layout placeholder for `zig_mutex_t`; C calls `Bun__lock/Bun__unlock` on it [7-18]), `parent_ptr`/`parent_tag` (1 = jsc::EventLoop, 2 = MiniEventLoop [79-82]), `iteration_nr: u64`, `jsc_vm: *const c_void`, `tick_depth: c_int`. Methods: `recv_slice() -> &mut [u8]` (512 KiB LIBUS_RECV_BUFFER_LENGTH) [69], `should_enable_date_header_timer()` [75], `set_parent_raw(tag, ptr)` / `get_parent_raw() -> (c_char, *mut c_void)` (panics if unset) [84,90]. Higher-tier typed accessors: `InternalLoopDataExt::{set_parent_event_loop, get_parent}` + `ParentEventLoopHandle` trait [uws/lib.rs:1283-1312].

---

## 5. Rust vtable generator — src/uws_sys/vtable.rs

`Handler` trait [vtable.rs:38-134]: `type Ext` (what socket ext holds), `const HAS_EXT` (false ⇒ `*_no_ext` methods used, owner recovered via `s.group().owner::<T>()`), plus one `HAS_ON_*: bool` per slot. Slots and Rust-side signatures:
- `on_open(ext, s, is_client: bool, ip: &[u8])` [57]
- `on_data(ext, s, data: &[u8])` [60]
- `on_fd(ext, s, fd: c_int)` [63]
- `on_writable(ext, s)` [66]
- `on_close(ext, s, code: i32, reason: Option<*mut c_void>)` [69]
- `on_timeout(ext, s)` — short (seconds) wheel [77]
- `on_long_timeout(ext, s)` — minute wheel (set via `set_long_timeout`; `NewSocketHandler::set_timeout` splits >240 s onto it) [80]
- `on_end(ext, s)` [83]
- `on_connect_error(ext, s, code: i32)` [86]
- `on_connecting_error(*mut ConnectingSocket, code: i32)` — no ext form [89]
- `on_handshake(ext, s, ok: bool, err: us_bun_verify_error_t)` [92]
- `*_no_ext` duplicates for HAS_EXT=false [104-133]

`make<H: Handler>() -> &'static VTable` — const vtable in `.rodata`, one per handler type; missing methods ⇒ null slot [vtable.rs:138-140,145-201]. `Trampolines<H>` — the `extern "C"` shims (pub(crate) so dispatch.rs can direct-call per-kind, bypassing the vtable pointer) [vtable.rs:206-344]; each returns `s` unchanged; `on_handshake` drops the C `_user` arg.

This replaces the runtime `us_socket_context_on_*` registration (`NewSocketHandler.configure`/`unsafeConfigure`/`wrapTLS`) [vtable.rs:5-8].

### thunk.rs helpers — src/uws_sys/thunk.rs
- `OpaqueHandle` trait + `as_handle(*mut Self) -> &mut Self` — safe re-typing of ZST opaques (null panics) [thunk.rs:51-80]
- `zst::<H>()` — conjure ZST handler [91]
- `user_mut<U>(*mut c_void) -> Option<&mut U>` [102]
- `handle_mut<T>` [119]
- `c_slice(ptr, len) -> &[u8]` (null/0 → empty) [132]
- `ext_owner` / `socket_ext_owner` — deref `Option<NonNull<T>>` ext word [149,157]
- `ExtSlot<T>` — `#[repr(transparent)] Option<NonNull<T>>` newtype: choosing `type Ext = ExtSlot<T>` asserts the non-re-entrancy contract; `owner_mut() -> Option<&mut T>` safe, `get() -> Option<NonNull<T>>` snapshot for pre-close reads [thunk.rs:191-217]

### `#[uws_callback]` macro
Re-exported from `bun_jsc_macros` at uws/lib.rs:27-32 — wraps a `&self`/`&mut self` method in an `extern "C"` thunk recovering Self from `*mut c_void` and lowering `&[T]` to `(ptr,len)`; no catch_unwind (panic=abort). Used by uWS App/Response consumers, not the SocketGroup vtable path.

---

## 6. `ConnectingSocket` — src/uws_sys/ConnectingSocket.rs

Opaque `us_connecting_socket_t` — connect in flight (DNS / non-blocking connect / happy-eyeballs); no I/O; loop promotes to `us_socket_t` + `onOpen` on success, `onConnectingError` on failure [ConnectingSocket.rs:5-9]. DNS flow: `SocketGroup::connect` returns `Connecting` when DNS is unresolved; resolved sockets queue on `InternalLoopData.dns_ready_head` [InternalLoopData.rs:48]; failures fire the vtable `on_connecting_error` slot [SocketGroup.rs:55-56].

- `close()` — cancellation [12]
- `group() / raw_group() -> *mut SocketGroup` [20,23]
- `kind() -> SocketKind` [27]
- `r#loop() -> *mut Loop` [34]
- `ext<T>() -> &mut T` [38]
- `get_error() -> i32` (errno) [46]
- `get_dns_error() -> i32` (raw getaddrinfo rc; 0 if failure was past resolution) [53]
- `get_native_handle() -> *mut c_void` [57]
- `is_closed()` / `is_shutdown()` [61,65]
- `long_timeout(minutes)` / `timeout(seconds)` [69,81]
- `shutdown()` / `shutdown_read()` [73,77]

---

## 7. `ListenSocket` — src/uws_sys/ListenSocket.rs

Opaque; layout-compatible with `us_socket_t` (a listen socket IS one) [ListenSocket.rs:29-34].

- `close()` [14]
- `get_local_address(buf) -> Result<&[u8], Error>` / `get_local_port() -> i32` [18,25]
- `get_socket() -> &mut us_socket_t` — cast [29]
- `socket<const IS_SSL>() -> NewSocketHandler<IS_SSL>` [36]
- `group() -> &mut SocketGroup` — group accepted sockets link into [44]
- `ext<T>() -> &mut T` [49]
- `fd() -> Fd` [55]
- `add_server_name(hostname: &CStr, ssl_ctx: *mut SslCtx, user: *mut c_void) -> bool` — SNI node; ctx is `SSL_CTX_up_ref`'d, dropped on close/remove; user is what `find_server_name_userdata` recovers (uWS: HttpRouter*, Bun.listen: null) [69-92]
- `remove_server_name(hostname)` [94]
- `find_server_name_userdata<T>(hostname) -> Option<NonNull<T>>` [103]
- `on_server_name(cb: extern "C" fn(*mut ListenSocket, *const c_char, *mut c_int, *mut c_void) -> *mut c_void)` — missing-SNI callback registration [113]

---

## 8. UDP — src/uws_sys/udp.rs

**udp::Socket** (opaque `us_udp_socket_t`):
- `create(loop_, data_cb: extern "C" fn(*mut Socket, *mut PacketBuffer, c_int), drain_cb: fn(*mut Socket), close_cb: fn(*mut Socket), recv_error_cb: fn(*mut Socket, c_int), host: *const c_char, port: c_ushort, options: c_int, err: Option<&mut c_int>, user_data: *mut c_void) -> *mut Socket` — create+bind with all four callbacks [udp.rs:17-48]
- `send(payloads: &[*const u8], lengths: &[usize], addresses: &[*const c_void]) -> c_int` — sendmmsg-style batch [50]
- `user() -> *mut c_void` [69]
- `bound_port() -> c_int` (host byte order) [74]
- `bound_ip(buf, &mut i32)` / `remote_ip(buf, &mut i32)` [78,83]
- `close()` [88]
- `connect(hostname, port) -> c_int` / `disconnect() -> c_int` [92,97]
- `set_broadcast(bool) -> c_int` [101]
- `set_unicast_ttl(i32)` / `set_multicast_ttl(i32)` [105,109]
- `set_multicast_loopback(bool)` [113]
- `set_multicast_interface(&sockaddr_storage)` [117]
- `set_membership(address, iface: Option<&sockaddr_storage>, drop: bool)` [121]
- `set_source_specific_membership(source, group, iface, drop)` [130]

**udp::PacketBuffer** (opaque `us_udp_packet_buffer_t`): `get_peer(index) -> &mut sockaddr_storage` [201], `get_payload(index) -> &mut [u8]` [211], `get_truncated(index) -> bool` [224].

---

## 9. `SocketKind` — src/uws_sys/SocketKind.rs

`#[repr(u8)]` closed-world dispatch tag stamped at creation, switched in `src/runtime/socket/uws_dispatch.rs` (all variants) [SocketKind.rs:1-16]. Variants + consumers (per grep across src/):
- `Invalid = 0` — reserved calloc trap [23]
- `Dynamic = 1` — group vtable dispatch (uWS C++ per-App vtable, tests); used by `runtime/cli/test/parallel/Channel.rs` [27]
- `BunSocketTcp` / `BunSocketTls` — Bun.connect/listen sockets; `runtime/socket/{Listener.rs,socket_body.rs,uws_dispatch.rs}` [30-31]
- `BunListenerTcp` / `BunListenerTls` — server-accepted, ext = *Listener until onCreate re-stamps; `runtime/socket/Listener.rs` [32-35]
- `HttpClient` / `HttpClientTls` — HTTP client thread; `http/HTTPContext.rs` [37-39]
- `WsClientUpgrade` / `WsClientUpgradeTls` — `http_jsc/websocket_client/WebSocketUpgradeClient.rs` [42-43]
- `WsClient` / `WsClientTls` — `http_jsc/websocket_client.rs` [44-45]
- `Postgres` / `PostgresTls` — `sql_jsc/postgres/PostgresSQLConnection.rs` [48-49]
- `Mysql` / `MysqlTls` — `sql_jsc/mysql/JSMySQLConnection.rs` [50-51]
- `Valkey` / `ValkeyTls` — `runtime/valkey_jsc/valkey.rs` [52-53]
- `SpawnIpc` — Bun.spawn IPC socketpair; `jsc/VirtualMachine.rs`, `runtime/api/bun/js_bun_spawn_bindings.rs` [56]
- `UwsHttp` / `UwsHttpTls` / `UwsWs` / `UwsWsTls` — Bun.serve / uWS C++; dispatch reads `group->ext` as `HttpContext<SSL>*` [59-63]

`from_u8(u8) -> Self` checked conversion [72]; `is_tls() -> bool` [102]. Exported `#[no_mangle]` ordinals for C++ (`BUN_SOCKET_KIND_DYNAMIC/UWS_HTTP/UWS_HTTP_TLS/UWS_WS/UWS_WS_TLS/BUN_SOCKET_TLS`, the last referenced from openssl.c for the `'session'` marker) [SocketKind.rs:127-140]. Alias `DispatchKind = SocketKind` [uws/lib.rs:1355].

---

## 10. TLS pieces

**BunSocketContextOptions** (`us_bun_socket_context_options_t` mirror) — src/uws_sys/SocketContext.rs:98-121. Fields: key/cert/passphrase/dh_params/ca file names, `ssl_ciphers`, `ssl_prefer_low_memory_usage`, inline `key`/`cert`/`ca` string arrays + counts, `secure_options`, `ssl_min_version`/`ssl_max_version`, `reject_unauthorized`, `request_cert`, `client_renegotiation_limit` (default 3) / `client_renegotiation_window` (default 600) [123-148]. Methods:
- `create_ssl_context(self, err: &mut create_bun_socket_error_t) -> Option<*mut SSL_CTX>` — wraps `us_ssl_ctx_from_options`; caller owns one ref, `SSL_CTX_free` releases; passphrase freed inside; **mode-neutral** ctx (client verify override applied per-SSL in `us_internal_ssl_attach`) [SocketContext.rs:162-166]
- `digest() -> [u8; 32]` — content-addressed SHA-256 over all fields (file-backed fields fed path + mtime/size via `stat_for_digest` so in-place cert rotation invalidates); key for SSLContextCache [172-249]
- `approx_cert_bytes() -> usize` — memoryCost feed [253]

`create_bun_socket_error_t` — `none | load_ca_file | invalid_ca_file | invalid_ca | invalid_ciphers`, `.message()` [uws_sys/lib.rs:102-123].

`us_bun_verify_error_t` — `#[repr(C)] { error_no: c_int, code: *const c_char, reason: *const c_char }` (BoringSSL static strings); accessors `code()/reason() -> Option<&CStr>`, `code_bytes()/reason_bytes()` [uws_sys/lib.rs:42-100]. Handshake callback shape: vtable `on_handshake(s, ok: c_int, us_bun_verify_error_t, *mut c_void)` [SocketGroup.rs:57-58].

Extra ctx FFI: `us_ssl_ctx_live_count()`, `us_ssl_ctx_add_ca_cert(ctx, pem)`, `us_ssl_parse_pkcs12(...)` [SocketContext.rs:304-334].

**SNI**: server side = `ListenSocket::{add_server_name, remove_server_name, find_server_name_userdata, on_server_name}` (above); async resume = `us_socket_t::sni_resolve` / `NewSocketHandler::sni_resolve`. `SslCtx = bun_boringssl_sys::SSL_CTX` alias [uws_sys/lib.rs:35; uws/lib.rs:41].

**ssl_wrapper (`bun_uws::ssl_wrapper::SSLWrapper<T>`)** — src/uws/lib.rs:150-1268. Memory-BIO TLS engine mimicking uSockets openssl.c for non-fd transports; users: `http/ProxyTunnel.rs`, `http_jsc/websocket_client/WebSocketProxyTunnel.rs`, `runtime/socket/UpgradedDuplex.rs`, `runtime/socket/WindowsNamedPipe.rs`, `http_jsc` (SslWrapper alias). Surface:
- `Handlers<T: Copy> { ctx, on_open, on_handshake(T, bool, us_bun_verify_error_t), write(T, &[u8]), on_data(T, &[u8]), on_close, on_session: Option<fn(T,&[u8])>, on_keylog: Option<fn(T,&[u8])> }` [339-354]
- `Flags` Cell-backed bitfield + `HandshakeState {Pending, Completed, RenegotiationPending}` [232-337]
- `init_with_ctx(ctx: NonNull<SSL_CTX>, is_client, handlers) -> Result<Self, InitError>` — SSL_new, reneg mode explicit(client)/never(server), client verify override + shared default CA store when ctx is VERIFY_NONE, mem BIOs, session/keylog opt-in [380-503]
- `init_from_options(&BunSocketContextOptions, is_client, handlers)` [510]
- `start()` / `start_with_payload(&[u8])` [533,540]
- `shutdown_read()` (fake: swaps on_data for a no-op) [548]
- `shutdown(fast_shutdown: bool) -> bool` — SSL_shutdown 1/2-step; renegotiation-count DoS guard elsewhere [562]
- `flush() -> usize` (pending write bytes) [668]
- `has_pending_data()` [680]
- `is_shutdown()` / `is_closed()` / `is_authorized()` [700,707,711]
- `receive_data(&[u8])` (network → BIO_write → traffic) [721]
- `write_data(&[u8]) -> Result<usize, WriteDataError{ConnectionClosed,WantRead,WantWrite}>` [743]
- `deinit()` (idempotent; also Drop) [795,1222]
- internal: `handle_traffic`/`handle_reading`/`handle_writing`/`update_handshake_state`/`flush_pending_events` (session/keylog queue drain via `us_ssl_pop_pending_session/keylog`); reneg cap `MAX_RENEGOTIATIONS = 3` per 600 s window [208-210]
- FFI it uses: `us_get_shared_default_ca_store`, `us_ssl_socket_verify_error_from_ssl`, `us_ssl_enable_pending_events`, `us_ssl_pop_pending_session`, `us_ssl_pop_pending_keylog` [1239-1267]

**UpgradedDuplex / WindowsNamedPipe cycle-break shims** — uws_sys/lib.rs:175-348: opaque handles whose methods (`ssl_error, is_established, is_closed, is_shutdown, ssl, set_timeout, flush, encode_and_write, raw_write, shutdown, shutdown_read, close`, + pipe `pause_stream/resume_stream`) forward to `#[no_mangle]` symbols exported by `bun_runtime::socket` (real impls in `src/runtime/socket/{UpgradedDuplex.rs, WindowsNamedPipe.rs}`).

Other TLS-adjacent: `get_default_ciphers() -> &'static ZStr` (`us_get_default_ciphers`) [uws/lib.rs:129-145]; `BUN__warn__extra_ca_load_failed` export [uws/lib.rs:111].

---

## 11. Timer — src/uws_sys/Timer.rs

Windows/libuv only (module cfg(windows) [uws_sys/lib.rs:382-385]; elsewhere use `bun_event_loop::EventLoopTimer`). Opaque `Timer`:
- `create<T>(loop_: &mut Loop, _ptr: T) -> NonNull<Timer>` — `us_create_timer(loop, fallthrough=0, ext_size=size_of::<T>())`; panics on null [Timer.rs:13]
- `set<T>(ptr: T, cb: Option<extern "C" fn(*mut Timer)>, ms: i32, repeat_ms: i32)` — `us_timer_set` + write T into `us_timer_ext` [Timer.rs:30]
- `unsafe close::<FALLTHROUGH>(*mut Self)` — `us_timer_close` frees [Timer.rs:46]

Timers also appear as `InternalLoopData.sweep_timer` / `quic_timer` on Windows [InternalLoopData.rs:28,37].

---

## 12. h3 / QUIC surface

- `quic` module [uws_sys/quic.rs] — lsquic bindings: `Context`, `Socket`, `Stream`, `PendingConnect`, `Header`/`Qpack`; `global_init()` (`us_quic_global_init`). FFI: `us_quic_socket_context_{connect,loop,on_close,on_goaway,on_hsk_done,on_stream_close,on_stream_data,on_stream_headers,on_stream_open,on_stream_writable}`, `us_quic_socket_{close,ext,make_stream,status,streams_avail}`, `us_quic_stream_{close,ext,header,header_count,reset,send_headers,shutdown,socket,want_read,want_write,write}`, `us_quic_pending_connect_{addrinfo,cancel,resolved}`. DNS resolution for QUIC connects flows via `PendingConnect` (`resolved`/`cancel`).
- `h3` module [uws_sys/h3.rs, re-exported as `bun_uws::H3` at uws/lib.rs:34] — `uws_h3_*` App/Req/Res/ListenSocket C++ shims (full list in section 14).
- Loop hooks: `quic_head`/`quic_next_tick_us` in InternalLoopData; `Loop::drain_quic_if_necessary()` → `us_quic_loop_flush_if_pending` [Loop.rs:220-226].
- `ResponseKind {Tcp, Ssl, H3}` cross-boundary tag [uws/lib.rs:52-70].

---

## 13. `bun_uws` (src/uws/lib.rs) — remaining crate-local surface

Mostly re-exports of `bun_uws_sys` types (one canonical type each): handles [22-25], `uws_callback` macro [32], `State` [33], `H3/quic/udp/vtable` [34], `Socket = us_socket_t` [35], `SslCtx` [41], `WebSocketUpgradeContext` [48], listen flags [87-91], `Opcode/SendStatus/create_bun_socket_error_t/us_bun_verify_error_t` [96], `on_thread_exit` [107], `LIBUS_SOCKET_DESCRIPTOR` [127], Loop family [1277-1278], `SocketGroupVTable`/`ConnectResult`/`SocketGroup` [1323-1324], `BunSocketContextOptions` (+ `us_bun_socket_context_options_t` alias) [1329-1343], `SocketKind`/`DispatchKind` [1351-1355], `CloseCode`/`CloseKind` [1357-1361], socket handler family [1370-1373], `AnyRequest`/`Response<SSL>`/`AnyResponse`/`WriteResult` [1430-1446].

Crate-local definitions:
- `ResponseKind` enum + `from(ssl, http3)` [52-70]
- perMessageDeflate compressor constants (`SHARED_COMPRESSOR` … `DEDICATED_COMPRESSOR`) [72-85]
- `SocketAddress { ip: Box<[u8]>, port: i32, is_ipv6: bool }` (owned; distinct from sys inline variant) [101-105]
- `get_default_ciphers()` [136]
- `ssl_wrapper` module (section 10)
- `InternalLoopDataExt` / `ParentEventLoopHandle` [1283-1312]
- `MaybeAnySocket {Tcp, Ssl, None}` with `from_generic`, `write`, `is_closed` — proxy-tunnel use [1379-1418]

`uws_sys::lib.rs` extras not covered above: listen/connect option flags `LIBUS_LISTEN_DEFAULT/EXCLUSIVE_PORT/REUSE_PORT/REUSE_ADDR/IPV6_ONLY/ALLOW_HALF_OPEN/DISALLOW_REUSE_PORT_FAILURE` [26-32]; `Opcode` (non-exhaustive `#[repr(transparent)] i32`, both Text/TEXT spellings) [131-151]; `SendStatus {Backpressure, Success, Dropped}` [155-160]; `Timespec` re-export [163]; `fault_inject` module (cfg `socket_fault_injection`): `us_fault_set/clear/clear_all` + `UsFaultRule` [398-436]; legacy aliases `NewApp<SSL>`, `NewAppResponse<SSL>`, `Socket`, `SocketContext = us_socket_context_t` [467-470].

---

## 14. Complete extern "C" surface Rust calls (libuwsockets.cpp / uSockets C / C++ shims)

From `unsafe extern "C"` blocks across src/uws_sys/*.rs and src/uws/lib.rs (grep of `fn us_*/uws_*`):

**Socket**: `us_socket_open, us_socket_pause, us_socket_resume, us_socket_close, us_socket_shutdown, us_socket_shutdown_read, us_socket_is_closed, us_socket_is_shut_down, us_socket_is_tls, us_socket_is_established, us_socket_write, us_socket_write2, us_socket_write_check_error, us_socket_ipc_write_fd, us_socket_raw_write, us_socket_raw_writev, us_socket_flush, us_socket_timeout, us_socket_long_timeout, us_socket_nodelay, us_socket_keepalive, us_socket_set_tos, us_socket_get_tos, us_socket_local_port, us_socket_remote_port, us_socket_local_address, us_socket_remote_address, us_socket_ext, us_socket_group, us_socket_kind, us_socket_set_kind, us_socket_get_fd, us_socket_get_native_handle, us_socket_get_error, us_socket_verify_error, us_socket_sendfile_needs_more, us_socket_mark_needs_more_not_ssl, us_socket_adopt, us_socket_adopt_tls, us_socket_tls_feed, us_socket_start_tls_handshake, us_socket_sni_resolve, us_socket_set_ssl_raw_tap, us_socket_from_fd, us_socket_pair`

**SocketGroup**: `us_socket_group_init, us_socket_group_deinit, us_socket_group_close_all, us_socket_group_listen, us_socket_group_listen_unix, us_socket_group_connect, us_socket_group_connect_unix`

**ConnectingSocket**: `us_connecting_socket_{close, group, kind, ext, get_error, get_dns_error, get_native_handle, is_closed, is_shut_down, long_timeout, shutdown, shutdown_read, timeout, get_loop}`

**ListenSocket**: `us_listen_socket_{close, group, ext, get_fd, add_server_name, remove_server_name, find_server_name_userdata, on_server_name}`

**Loop**: `us_create_loop, us_loop_free, us_loop_run, us_loop_pump (win), us_loop_run_bun_tick (posix), us_wakeup_loop, us_internal_free_closed_sockets, us_loop_close_all_groups, uws_get_loop, uws_get_loop_with_native (win), uws_loop_defer, uws_loop_addPostHandler, uws_loop_addPreHandler, uws_loop_removePostHandler, uws_res_clear_corked_socket, uws_loop_date_header_timer_update, us_quic_loop_flush_if_pending, bun_clear_loop_at_thread_exit`

**Timer (win)**: `us_create_timer, us_timer_set, us_timer_ext, us_timer_close`

**UDP**: `us_create_udp_socket, us_udp_socket_{send, user, bound_port, bound_ip, remote_ip, close, connect, disconnect, set_broadcast, set_ttl_unicast, set_ttl_multicast, set_multicast_loopback, set_multicast_interface, set_membership, set_source_specific_membership}, us_udp_packet_buffer_{peer, payload, payload_length, truncated}`

**TLS/SSL**: `us_ssl_ctx_from_options, us_ssl_ctx_live_count, us_ssl_ctx_add_ca_cert, us_ssl_parse_pkcs12, us_get_default_ciphers, us_get_shared_default_ca_store, us_ssl_socket_verify_error_from_ssl, us_ssl_enable_pending_events, us_ssl_pop_pending_session, us_ssl_pop_pending_keylog`

**Fault injection (cfg)**: `us_fault_set, us_fault_clear, us_fault_clear_all`

**QUIC**: `us_quic_global_init` + the `us_quic_socket_context_*/us_quic_socket_*/us_quic_stream_*/us_quic_pending_connect_*` set (section 12).

**uWS C++ shims** (App/Request/Response/WebSocket/h3, in App.rs/Request.rs/Response.rs/WebSocket.rs/h3.rs — outside the uSockets-core replacement scope but linked from the same crate): `uws_create_app, uws_app_{get,post,put,delete,patch,options,head,trace,connect,any,listen,listen_with_config,listen_domain_with_options,domain,run,close,close_idle,destroy,clear_routes,set_flags,set_max_http_header_size,set_on_clienterror}, uws_constructor_failed, uws_get_native_handle, uws_add_server_name[_with_options], uws_remove_server_name, uws_missing_server_name, uws_filter, uws_publish, uws_num_subscribers, uws_req_*, uws_res_* (write/end/try_end/cork/uncork/is_corked/pause/resume/timeout/reset_timeout/state/upgrade/on_aborted/on_data/on_writable/on_timeout/write_status/write_header[_int]/write_continue/write_mark/end_stream/end_sendfile/prepare_for_sendfile/flush_headers/get_write_offset/override_write_offset/get_buffered_amount/get_native_handle/get_remote_address_*/get_socket_data/has_responded/is_connect_request/mark_wrote_content_length_header/clear_on_writable), uws_ws_* (send*/publish*/subscribe/unsubscribe/is_subscribed/iterate_topics/cork/end/close/get_buffered_amount/get_remote_address*/get_user_data/memory_cost), uws_h3_*` (full h3 mirror of app/req/res/listen-socket).

**Rust→C exports in these crates** (reverse direction, for completeness): `us_socket_free_stream_buffer` [us_socket_t.rs:682], `BUN_SOCKET_KIND_*` statics [SocketKind.rs:127-140], `BUN__warn__extra_ca_load_failed` [uws/lib.rs:111]; plus the runtime-crate exports the sys shims link against (`UpgradedDuplex__*`, `WindowsNamedPipe__*`).
