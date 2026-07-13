//! `us_socket_group_t` — PUBLIC repr(C), embedded by value in its owner
//! (Listener, VirtualMachine RareData, uWS App, HTTPThread). Layout FROZEN
//! (docs/cabi.md §3.1: uWS C++ embeds it and static_asserts offset/size).
//! Zero-initialization must remain a valid pre-init state. Semantics per
//! docs/semantics.md §3 (group lifecycle, linkage, adopt, close_all),
//! §6 (connect entry), §7 (listen/accept). Socket close/dispatch paths live
//! in socket.rs and call back into the linkage helpers here.

use core::ffi::{CStr, c_int, c_void};
use core::ptr;

use crate::backend::{Events, PollType};
use crate::connecting::{self, ConnectingSocket};
use crate::dispatch;
use crate::handle::{CloseCode, ListenSocket};
use crate::kind::SocketKind;
use crate::loop_::{Loop, timeouts};
use crate::socket::{self, SocketFlags, close_raw, socket_close, us_socket_t};
use crate::tls::Transport;
use crate::tls::context::{self as tls_context, SslCtx, us_bun_verify_error_t};
use crate::tls::sni::{OnServerName, SniMap};
use crate::tls::state::TlsState;
use crate::unsafe_core::ext::{deref_mut, drop_box, header_mut};
use crate::unsafe_core::{ffi, io, trampolines};
use crate::{LIBUS_LISTEN_DEFER_ACCEPT, LIBUS_SOCKET_ALLOW_HALF_OPEN, LIBUS_SOCKET_DESCRIPTOR};

#[repr(C)]
pub struct SocketGroup {
    pub loop_: *mut Loop,
    pub vtable: Option<&'static VTable>,
    /// Embedding owner — typed access via `owner<T>()` only.
    ext: *mut c_void,
    pub head_sockets: *mut us_socket_t,
    pub head_connecting_sockets: *mut ConnectingSocket,
    pub head_listen_sockets: *mut ListenSocket,
    pub iterator: *mut us_socket_t,
    pub prev: *mut SocketGroup,
    pub next: *mut SocketGroup,
    pub global_tick: u32,
    /// Sockets currently parked in `loop.data.low_prio_head` with
    /// `s->group == this` (NOT in `head_sockets` while queued) — C8.
    pub low_prio_count: u16,
    pub timestamp: u8,
    pub long_timestamp: u8,
    pub linked: u8,
}

/// Per-group C vtable (`us_socket_vtable_t`) — 11 slots, order FROZEN
/// (docs/cabi.md §3.7). NULL slots are skipped by dispatch. The C ABI keeps
/// the `-> *mut us_socket_t` return for stability, but with in-place adoption
/// it is always the input pointer (docs/design.md §Strategy 3).
#[repr(C)]
pub struct VTable {
    pub on_open:
        Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut u8, c_int) -> *mut us_socket_t>,
    pub on_data: Option<unsafe extern "C" fn(*mut us_socket_t, *mut u8, c_int) -> *mut us_socket_t>,
    pub on_fd: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_writable: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_close:
        Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut c_void) -> *mut us_socket_t>,
    pub on_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_long_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_end: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_connect_error: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_connecting_error:
        Option<unsafe extern "C" fn(*mut ConnectingSocket, c_int) -> *mut ConnectingSocket>,
    pub on_handshake:
        Option<unsafe extern "C" fn(*mut us_socket_t, c_int, us_bun_verify_error_t, *mut c_void)>,
}

// Must match `struct us_socket_group_t` in the surviving C header:
// 9 ptrs + u32 + u16 + 3×u8, padded to pointer alignment.
const _: () = assert!(
    core::mem::size_of::<SocketGroup>() == 9 * core::mem::size_of::<*mut c_void>() + 16,
    "SocketGroup layout drifted from us_socket_group_t"
);
const _: () = assert!(
    core::mem::size_of::<VTable>() == 11 * core::mem::size_of::<*mut c_void>(),
    "VTable layout drifted from us_socket_vtable_t"
);

// All-zero is valid for both (raw null pointers / None-via-NPO / zero ints);
// C++ owners zero-init embedded groups before `init`.
impl Default for SocketGroup {
    fn default() -> Self {
        SocketGroup {
            loop_: core::ptr::null_mut(),
            vtable: None,
            ext: core::ptr::null_mut(),
            head_sockets: core::ptr::null_mut(),
            head_connecting_sockets: core::ptr::null_mut(),
            head_listen_sockets: core::ptr::null_mut(),
            iterator: core::ptr::null_mut(),
            prev: core::ptr::null_mut(),
            next: core::ptr::null_mut(),
            global_tick: 0,
            low_prio_count: 0,
            timestamp: 0,
            long_timestamp: 0,
            linked: 0,
        }
    }
}

impl Default for VTable {
    fn default() -> Self {
        VTable {
            on_open: None,
            on_data: None,
            on_fd: None,
            on_writable: None,
            on_close: None,
            on_timeout: None,
            on_long_timeout: None,
            on_end: None,
            on_connect_error: None,
            on_connecting_error: None,
            on_handshake: None,
        }
    }
}

pub enum ConnectResult {
    Socket(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Failed,
}

// ──────────────────────────────────────────────────────────────────────────
// Listener accept state
// ──────────────────────────────────────────────────────────────────────────

/// Accept state of a `ListenSocket` (`us_listen_socket_t` fields beyond the
/// embedded socket — R7.1). Boxed; the listener header's `ext` word owns it
/// (`kind == Invalid` is the listener tag) until `close_listen_socket` drops
/// it. The listener list itself is chained through the header's `next`
/// (listeners are never in `head_sockets`, so the field is free; cabi walks
/// it the same way).
pub(crate) struct ListenerData {
    /// Borrowed SSL_CTX, up_ref'd at listen; released at close. Null = plain.
    pub(crate) ssl_ctx: *mut SslCtx,
    /// Server-name tree; lazily created by `add_server_name`.
    pub(crate) sni: Option<Box<SniMap>>,
    /// Dynamic missing-SNI resolver (docs/cabi.md §4.3).
    pub(crate) on_server_name: Option<OnServerName>,
    /// Ext size stamped onto every accepted socket.
    pub(crate) socket_ext_size: c_int,
    /// Kind stamped onto every accepted socket.
    pub(crate) accept_kind: SocketKind,
    /// True only if the defer-accept setsockopt succeeded (R7.2/R8.8).
    pub(crate) deferred_accept: bool,
    /// Owner word backing `ListenSocket::ext<T>()` (8-byte slot).
    pub(crate) owner_ext: *mut c_void,
    /// Protocol v2 accept hook (`Listener::on_create`, docs/design.md): runs
    /// per accepted socket BEFORE its on_open so the handler sees the owner.
    /// Static fn + context word — the accept path stays allocation-free.
    pub(crate) on_create: Option<(fn(*mut c_void, crate::handle::AnySocket), *mut c_void)>,
}

/// Recover the accept state of a not-yet-closed listener. The listener
/// header keeps `kind == Invalid` ("listener itself never dispatches", R7.2)
/// — that tag doubles as the listener discriminator.
pub(crate) fn listener_data<'a>(ls: *mut ListenSocket) -> &'a mut ListenerData {
    let h = header_mut(ls.cast::<us_socket_t>());
    debug_assert!(matches!(h.kind, SocketKind::Invalid));
    debug_assert!(!h.ext.is_null());
    deref_mut(h.ext.cast::<ListenerData>())
}

// ──────────────────────────────────────────────────────────────────────────
// SocketGroup surface
// ──────────────────────────────────────────────────────────────────────────

impl SocketGroup {
    /// Initialise an embedded, zero-initialized group. Does NOT link into the
    /// loop (lazy on first socket). Idempotent. `owner_ptr` is what
    /// `owner::<T>()` recovers inside handlers. (context.c:49-55)
    pub fn init(&mut self, loop_: *mut Loop, vt: Option<&'static VTable>, owner_ptr: *mut c_void) {
        *self = SocketGroup::default();
        self.loop_ = loop_;
        self.vtable = vt;
        self.ext = owner_ptr;
    }

    /// Explicit teardown — unlinks from the loop; asserts socket list empty.
    /// Not `Drop`: the group is `#[repr(C)]`, embedded by-value, FFI-managed.
    /// (R3.13, context.c:57-74)
    ///
    /// # Safety
    /// `this` must point to a group previously passed to `init`; not called
    /// concurrently with the loop walking this group.
    // Frozen surface requires this to stay an `unsafe fn` outside unsafe_core.
    #[allow(unsafe_code)]
    pub unsafe fn destroy(this: *mut Self) {
        let (linked, loop_) = {
            let g = deref_mut(this);
            debug_assert!(g.head_sockets.is_null());
            debug_assert!(g.head_connecting_sockets.is_null());
            debug_assert!(g.head_listen_sockets.is_null());
            debug_assert!(g.low_prio_count == 0);
            debug_assert!(g.iterator.is_null());
            (g.linked != 0, g.loop_)
        };
        if linked {
            loop_unlink_group(loop_, this);
            deref_mut(this).linked = 0;
        }
    }

    /// Close every socket AND listen socket in the group (fires `on_close`
    /// per socket, and accounts for low-prio-parked sockets). Group stays valid.
    pub fn close_all(&mut self) {
        close_all_ex(self, true);
    }

    /// Non-null after `init`.
    pub fn get_loop(&self) -> *mut Loop {
        debug_assert!(!self.loop_.is_null());
        self.loop_
    }

    /// Recover the embedding owner. Only valid for groups whose `init` passed
    /// a non-null owner; per-kind VM groups in `RareData` pass null. The deref
    /// obligation (correct `T`) lives at the deref site.
    pub fn owner<T>(&self) -> *mut T {
        debug_assert!(!self.ext.is_null());
        self.ext.cast::<T>()
    }

    /// Raw `ext` word for the C accessor surface — nullable, unlike `owner`
    /// (per-kind VM groups init with null; docs/cabi.md §1.5).
    pub(crate) fn ext_raw(&self) -> *mut c_void {
        self.ext
    }

    pub fn is_empty(&self) -> bool {
        self.head_sockets.is_null()
            && self.head_connecting_sockets.is_null()
            && self.head_listen_sockets.is_null()
            && self.low_prio_count == 0
    }

    /// Listener owns embedded accept state; accepted sockets get `kind`
    /// stamped, `socket_ext_size` ext, link into THIS group. `*err` receives
    /// an errno-ish code on null return (failure-only write, OQ-8 resolved).
    /// docs/semantics.md §7 (R7.2). CONTRACT: `socket_ext_size` is the
    /// adoption FAMILY's max — capacity is fixed here; larger adopts panic.
    pub fn listen(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        host: Option<&core::ffi::CStr>,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
        err: &mut c_int,
    ) -> *mut ListenSocket {
        let fd = match io::create_listen_socket(host, port, options) {
            Ok(fd) => fd,
            Err(e) => {
                // e == 0: getaddrinfo failed — C leaves *error untouched.
                if e != 0 {
                    *err = e;
                }
                return ptr::null_mut();
            }
        };
        finish_listen(
            self,
            kind,
            ssl_ctx.unwrap_or(ptr::null_mut()),
            fd,
            options,
            socket_ext_size,
            options & LIBUS_LISTEN_DEFER_ACCEPT != 0,
            err,
        )
    }

    /// Unix-domain variant; `path` supports abstract sockets (leading NUL).
    /// Identical minus defer-accept (R7.2).
    pub fn listen_unix(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        options: c_int,
        socket_ext_size: c_int,
        err: &mut c_int,
    ) -> *mut ListenSocket {
        let fd = match io::create_listen_socket_unix(path, options) {
            Ok(fd) => fd,
            Err(e) => {
                if e != 0 {
                    *err = e;
                }
                return ptr::null_mut();
            }
        };
        finish_listen(
            self,
            kind,
            ssl_ctx.unwrap_or(ptr::null_mut()),
            fd,
            options,
            socket_ext_size,
            false,
            err,
        )
    }

    /// May return a synchronous `Socket` (DNS already resolved), a
    /// `Connecting` placeholder, or `Failed`. May dispatch connect_error
    /// synchronously before returning (C5). docs/semantics.md §6 (R6.2).
    pub fn connect(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        host: &core::ffi::CStr,
        port: c_int,
        local_binding: Option<(&core::ffi::CStr, u16)>,
        options: c_int,
        socket_ext_size: c_int,
    ) -> ConnectResult {
        let this: *mut SocketGroup = self;
        let ssl_ctx = ssl_ctx.unwrap_or(ptr::null_mut());
        let port16 = port as u16;

        // 1. local_host is only ever a literal IP — never resolved. An
        // unparseable one is silently ignored: connect proceeds unbound
        // (context.c:574-578 has no failure branch).
        let local = local_binding
            .and_then(|(local_host, local_port)| io::try_parse_ip(local_host, local_port));

        // 2. Literal host: direct connect, no DNS.
        if let Some(addr) = io::try_parse_ip(host, port16) {
            let s = connect_resolved_dns(
                this,
                kind,
                ssl_ctx,
                &addr,
                local.as_ref(),
                options,
                socket_ext_size,
            );
            return if s.is_null() {
                ConnectResult::Failed
            } else {
                ConnectResult::Socket(s)
            };
        }

        // 3. Cache hit with a single clean address: fast path.
        let loop_ = deref_mut(this).loop_;
        let (req, already_resolved) = ffi::addrinfo_get(loop_, host.as_ptr(), port16);
        if already_resolved {
            let (entries, dns_err) = ffi::addrinfo_result(req);
            if dns_err == 0 && !entries.is_null() && ffi::addrinfo_next(entries).is_null() {
                let addr = io::addr_from_entry(entries, port16);
                let s = connect_resolved_dns(
                    this,
                    kind,
                    ssl_ctx,
                    &addr,
                    local.as_ref(),
                    options,
                    socket_ext_size,
                );
                // Invalidate the cache entry if the connect failed (R6.2.3).
                ffi::addrinfo_free_request(req, s.is_null());
                return if s.is_null() {
                    ConnectResult::Failed
                } else {
                    ConnectResult::Socket(s)
                };
            }
            // Cached ERROR or multi-address result: connecting-socket path.
        }

        // 4. Slow path: connecting socket owns the request from here.
        ConnectResult::Connecting(connecting::create(
            this, kind, ssl_ctx, req, port16, options,
        ))
    }

    /// Same shape via the unix connect syscalls; no DNS, no connecting
    /// socket (R6.4, context.c:636-663). Thread-local errno preserved on null.
    pub fn connect_unix(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        options: c_int,
        socket_ext_size: c_int,
    ) -> *mut us_socket_t {
        let this: *mut SocketGroup = self;
        let fd = match io::create_connect_socket_unix(path, options) {
            Ok(fd) => fd,
            Err(e) => {
                io::set_errno(e);
                return ptr::null_mut();
            }
        };
        let ssl_ctx = ssl_ctx.unwrap_or(ptr::null_mut());
        let s = start_semi_socket(this, kind, fd, options, socket_ext_size, ptr::null_mut());
        if s.is_null() {
            return ptr::null_mut();
        }
        if !ssl_ctx.is_null() {
            attach_tls(s, ssl_ctx, true, None);
        }
        link_socket(this, s);
        s
    }

    /// Wrap an existing fd (C14: owns the fd only on success; sets
    /// nonblocking itself; no on_open self-dispatch; `ipc` enables
    /// SCM_RIGHTS receive and `write_fd`). POSIX only (R3.27).
    pub fn from_fd(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        socket_ext_size: c_int,
        fd: LIBUS_SOCKET_DESCRIPTOR,
        ipc: bool,
    ) -> *mut us_socket_t {
        #[cfg(windows)]
        {
            let _ = (kind, ssl_ctx, socket_ext_size, fd, ipc);
            ptr::null_mut()
        }
        #[cfg(not(windows))]
        {
            let this: *mut SocketGroup = self;
            let loop_ = deref_mut(this).loop_;
            let mut flags = SocketFlags::default();
            flags.set(SocketFlags::IS_IPC, ipc);
            let s = socket::alloc(
                loop_,
                PollType::Socket,
                fd,
                this,
                kind,
                flags,
                socket_ext_size,
            );
            poll_created(loop_);
            if start_poll(loop_, s, Events::READABLE | Events::WRITABLE) != 0 {
                // The caller keeps ownership of `fd` on failure (C14).
                poll_freed(loop_);
                socket::free_unstarted(loop_, s);
                return ptr::null_mut();
            }
            io::nodelay(fd, true);
            io::no_sigpipe(fd);
            io::set_nonblocking(fd);
            link_socket(this, s);
            let ssl_ctx = ssl_ctx.unwrap_or(ptr::null_mut());
            if !ssl_ctx.is_null() {
                // Bun.connect({fd, tls}): TLS from the first byte, client
                // role, like connect_resolved_dns (socket.c:444-451).
                attach_tls(s, ssl_ctx, true, None);
            }
            s
        }
    }

    /// socketpair(2): returns one end as a socket, both fds in `fds`.
    /// POSIX only (R3.28); fds stay with the caller on from_fd failure.
    pub fn pair(
        &mut self,
        kind: SocketKind,
        ext_size: c_int,
        fds: &mut [LIBUS_SOCKET_DESCRIPTOR; 2],
    ) -> *mut us_socket_t {
        if io::socketpair_stream(fds) != 0 {
            return ptr::null_mut();
        }
        self.from_fd(kind, None, ext_size, fds[0], false)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// close_all (R3.30/R3.31)
// ──────────────────────────────────────────────────────────────────────────

/// `us_socket_group_close_all_ex` (context.c:81-147). `also_listeners=false`
/// is the process-exit path (`Loop::close_all_groups`) — listeners are 1:1
/// owned by a Listener/uWS App holding a raw pointer; closing them here
/// would UAF at finalize (R3.30).
pub(crate) fn close_all_ex(group: *mut SocketGroup, also_listeners: bool) {
    // C6: raw slot pointers held across dispatch, possibly at tick_depth 0 —
    // hold a depth ref so a nested tick's postlude cannot recycle them.
    // Null loop_ = zero-initialized pre-init group: nothing to walk.
    let loop_ = deref_mut(group).loop_;
    if loop_.is_null() {
        return;
    }
    ffi::ld_tick_depth_add(loop_, 1);
    if also_listeners {
        // Listeners first — stops new sockets from being accepted into
        // head_sockets while we drain it.
        loop {
            let head = deref_mut(group).head_listen_sockets;
            if head.is_null() {
                break;
            }
            close_listen_socket(head);
        }
    }

    drain_connecting(group);

    // Graceful walk, snapshot-then-act: the tick-depth ref above keeps every
    // snapshotted slot allocated for the whole walk (nested ticks defer the
    // closed drain), so collect once and revalidate per entry — a dispatch
    // may close or in-place adopt ANY sibling, but never recycle its slot.
    let mut snapshot: Vec<*mut us_socket_t> = Vec::new();
    let mut s = deref_mut(group).head_sockets;
    while !s.is_null() {
        // Every close path unlinks BEFORE setting IS_CLOSED, so a closed
        // node here means a corrupt chain (its `next` aims at the loop's
        // closed list) — stop rather than walk it.
        if header_mut(s).is_closed() {
            debug_assert!(false, "closed socket linked in head_sockets");
            break;
        }
        snapshot.push(s);
        s = header_mut(s).next;
    }
    for s in snapshot {
        // Revalidate: an earlier dispatch may have closed `s` or adopted it
        // into a foreign group. Sockets linked in mid-walk are not in the
        // snapshot; the force-drain below catches them.
        if !trampolines::socket_slot_live(s)
            || header_mut(s).is_closed()
            || header_mut(s).group != group
        {
            continue;
        }
        if !header_mut(s).is_established() {
            // In-flight connect: SEMI_SOCKET close dispatches nothing (C1),
            // so deliver the connect_error the natural failure path would
            // have — it detaches the owner wrapper (context.c:100-115).
            dispatch::dispatch_connect_error(s, libc::ECONNABORTED);
            // Header reads stay valid after the dispatch: the tick-depth
            // ref above keeps the slot undrained even across nested ticks.
            if !header_mut(s).is_closed() {
                close_raw(s, CloseCode::failure, ptr::null_mut());
            }
        } else {
            socket_close(s, CloseCode::normal, ptr::null_mut());
        }
    }

    // TLS graceful closes may have deferred (close_notify awaiting reply);
    // force-drain survivors so no socket outlives the owner's storage.
    loop {
        let mut s = deref_mut(group).head_sockets;
        let mut progress = false;
        while !s.is_null() {
            close_raw(s, CloseCode::failure, ptr::null_mut());
            if header_mut(s).is_closed() {
                progress = true;
                break;
            }
            // §1.4 in-use deferral keeps `s` linked (the SSL driver epilogue
            // on this stack closes it) — step past it instead of spinning.
            s = header_mut(s).next;
        }
        if !progress {
            break;
        }
    }

    // Backstop: a close dispatch above may have opened new connecting
    // sockets; drain them so close_all leaves the group's connecting list
    // empty even past the caller's retry cap (rare_data C16).
    drain_connecting(group);

    // Low-prio-parked sockets reuse prev/next for the loop-wide queue, so
    // they survived the walk above. Leave low_prio_state==1 so close takes
    // its low-prio branch (unlink + low_prio_count--).
    if deref_mut(group).low_prio_count > 0 {
        // Restart from the queue head after every close: a re-entrant close
        // of the cached next nulls its parked links (unlink_for_death) and
        // then re-aims `next` at the closed chain (push_closed).
        'low_prio: loop {
            let mut q = ffi::ld_low_prio_head(loop_);
            let mut progress = false;
            while !q.is_null() {
                debug_assert!(!header_mut(q).is_closed());
                if header_mut(q).group != group {
                    q = header_mut(q).next;
                    continue;
                }
                socket_close(q, CloseCode::normal, ptr::null_mut());
                if !header_mut(q).is_closed() && header_mut(q).low_prio_state == 1 {
                    // §1.4 deferral kept it parked — skip so the drain ends.
                    q = header_mut(q).next;
                    continue;
                }
                progress = true;
                break;
            }
            if !progress {
                break 'low_prio;
            }
        }
        debug_assert!(deref_mut(group).low_prio_count == 0);
    }
    ffi::ld_tick_depth_add(loop_, -1);
}

/// Close every live connecting socket, restarting from the head after each
/// dispatch (a callback may relink ANY cached sibling). Terminates: close_raw
/// detaches `c` from the group on every path before returning, so each pass
/// strictly shrinks the live prefix. A closed node still linked belongs to a
/// close_raw frame below us mid-dispatch — step past it; its `next_pending`
/// stays intact until that frame's detach. Raw field access only (C13/C17).
fn drain_connecting(group: *mut SocketGroup) {
    'restart: loop {
        let mut c = deref_mut(group).head_connecting_sockets;
        while !c.is_null() {
            if !ffi::conn_closed(c) {
                connecting::close_raw(c);
                continue 'restart;
            }
            c = ffi::conn_next_pending(c);
        }
        return;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Listen / accept (docs/semantics.md §7)
// ──────────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn finish_listen(
    group: &mut SocketGroup,
    kind: SocketKind,
    ssl_ctx: *mut SslCtx,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    options: c_int,
    socket_ext_size: c_int,
    defer_accept: bool,
    err: &mut c_int,
) -> *mut ListenSocket {
    let this: *mut SocketGroup = group;
    let loop_ = deref_mut(this).loop_;

    // kind = Invalid: the listener itself never dispatches (R7.2);
    // allow_half_open is inherited by accepted sockets.
    let mut flags = SocketFlags::default();
    flags.set(
        SocketFlags::ALLOW_HALF_OPEN,
        options & LIBUS_SOCKET_ALLOW_HALF_OPEN != 0,
    );
    let s = socket::alloc(
        loop_,
        PollType::SemiSocket,
        fd,
        this,
        SocketKind::Invalid,
        flags,
        0,
    );
    poll_created(loop_);
    if start_poll(loop_, s, Events::READABLE) != 0 {
        // EPOLL_CTL_ADD failed (e.g. ENOSPC at max_user_watches). Report via
        // BOTH the out-param and thread-local errno: Bun.listen reads *err,
        // Bun.serve reads errno (context.c:379-389).
        let saved = io::errno();
        io::close(fd, false);
        poll_freed(loop_);
        socket::free_unstarted(loop_, s);
        *err = saved;
        io::set_errno(saved);
        return ptr::null_mut();
    }

    if !ssl_ctx.is_null() {
        tls_context::ssl_ctx_up_ref(ssl_ctx);
    }
    let data = ListenerData {
        ssl_ctx,
        sni: None,
        on_server_name: None,
        socket_ext_size,
        accept_kind: kind,
        deferred_accept: false,
        owner_ext: ptr::null_mut(),
        on_create: None,
    };
    let ls = s.cast::<ListenSocket>();
    {
        let h = header_mut(s);
        h.ext = bun_core::heap::into_raw(Box::new(data)).cast::<c_void>();
        // Listener list chains through the header's `next` (never in
        // head_sockets, so the field is free — cabi walks it the same way).
        h.next = deref_mut(this).head_listen_sockets.cast::<us_socket_t>();
    }
    deref_mut(this).head_listen_sockets = ls;
    group_touched(this);

    if defer_accept {
        listener_data(ls).deferred_accept = io::set_defer_accept(fd) == 1;
    }
    ls
}

/// The SEMI_SOCKET/readable dispatch arm — the accept loop (R7.3,
/// loop.c:468-541). Called by the backend when a ready poll resolves to a
/// listener (SEMI_SOCKET without WRITABLE interest).
pub(crate) fn on_accept_poll_ready(ls: *mut ListenSocket) {
    let listen_s: *mut us_socket_t = ls.cast::<us_socket_t>();
    let loop_ = {
        let group = header_mut(listen_s).group;
        deref_mut(group).loop_
    };

    loop {
        let listen_fd = header_mut(listen_s).fd;
        let Ok((client_fd, addr)) = io::accept(listen_fd) else {
            // EAGAIN drains the backlog; EMFILE/ENFILE silently dropped
            // until the next readable event (TODO-in-source parity, R7.3).
            return;
        };

        // Snapshot per iteration BEFORE dispatching: a callback may close
        // the listener, which frees its ListenerData.
        let (accept_group, accept_kind, ext_size, ssl_ctx, deferred) = {
            let ld = listener_data(ls);
            (
                header_mut(listen_s).group,
                ld.accept_kind,
                ld.socket_ext_size,
                ld.ssl_ctx,
                ld.deferred_accept,
            )
        };
        let mut flags = SocketFlags::default();
        flags.set(
            SocketFlags::ALLOW_HALF_OPEN,
            header_mut(listen_s).flags.get(SocketFlags::ALLOW_HALF_OPEN),
        );

        let s = socket::alloc(
            loop_,
            PollType::Socket,
            client_fd,
            accept_group,
            accept_kind,
            flags,
            ext_size,
        );
        poll_created(loop_);
        if start_poll(loop_, s, Events::READABLE) != 0 {
            // Registration failed (e.g. ENOSPC): close the fd so the peer
            // sees RST instead of a black hole; accept the next one.
            io::close(client_fd, false);
            poll_freed(loop_);
            socket::free_unstarted(loop_, s);
            continue;
        }

        // We always use nodelay.
        io::nodelay(client_fd, true);
        link_socket(accept_group, s);

        if !ssl_ctx.is_null() {
            attach_tls_accepted(s, ssl_ctx, ls);
        }
        // Protocol v2 owner attach (`Listener::on_create`): copy the hook out
        // of ListenerData first — the hook may close the listener, which
        // drops the ListenerData box (no borrow may span the call).
        if let Some((hook, ctx)) = listener_data(ls).on_create {
            hook(ctx, crate::unsafe_core::trampolines::any_socket(s));
            // Design-shape deviation (docs/design.md has on_create SUPPLY the
            // owner): the hook attaches manually — surface a forgotten attach.
            debug_assert!(
                header_mut(s).is_closed()
                    || crate::dispatch::owner_ops(header_mut(s).kind).is_none()
                    || !header_mut(s).ext.is_null(),
                "on_create hook did not attach_owner on a Protocol v2 socket"
            );
        }
        if !header_mut(s).is_closed() {
            socket::socket_open(s, false, addr.ip());
        }
        // In-place adoption (docs/design.md §Strategy 3): `s` stays the live pointer
        // even if a callback adopted it — no forwarding needed (vs R3.6).

        if deferred && !header_mut(s).is_closed() {
            // Kernel deferred the accept until data arrived: the first bytes
            // are already buffered — dispatch readable now. The recv loop
            // tolerates EWOULDBLOCK if the defer timed out with no data.
            socket::on_socket_poll_ready(s, false, false, Events::READABLE);
        }

        // Exit if the listen socket was closed in on_open / request handler.
        if header_mut(listen_s).is_closed() {
            return;
        }
    }
}

/// `us_listen_socket_close` (R3.29, context.c:426-449). Never dispatches
/// on_close. The header itself is freed in the tick postlude — we can be
/// inside the accept loop right now; the accept loop snapshots everything it
/// needs before dispatching, so the `ListenerData` box is dropped here.
pub(crate) fn close_listen_socket(ls: *mut ListenSocket) {
    let s: *mut us_socket_t = ls.cast::<us_socket_t>();
    if header_mut(s).is_closed() {
        return;
    }
    let group = header_mut(s).group;
    let loop_ = deref_mut(group).loop_;
    let fd = header_mut(s).fd;

    stop_poll(loop_, s);
    io::close(fd, false);

    // us_internal_listen_socket_ssl_free (openssl.c:2537-2570): accepted
    // sockets carry `ls` in per-SSL ex_data; they may outlive the listener,
    // so wipe the backref before the ListenerData box drops — sni resolution
    // treats a null backref as OK.
    wipe_listener_backrefs(group, loop_, ls);

    // us_internal_listen_socket_ssl_free: SSL_CTX ref + SNI tree, then the
    // accept state itself (nulled so the drain sees nothing left to free).
    {
        let ld = listener_data(ls);
        if !ld.ssl_ctx.is_null() {
            tls_context::ssl_ctx_unref(ld.ssl_ctx);
            ld.ssl_ctx = ptr::null_mut();
        }
        ld.sni = None;
    }
    let ext = header_mut(s).ext;
    header_mut(s).ext = ptr::null_mut();
    drop_box(ext.cast::<ListenerData>());

    unlink_listen_socket(group, ls);
    group_maybe_unlink(group);

    socket::push_closed(s, loop_);
    header_mut(s).flags.set(SocketFlags::IS_CLOSED, true);
}

/// Clear the per-SSL listener backref (== `ls`) on every accepted socket
/// still alive: `head_sockets` AND the low-prio-parked population, which is
/// unlinked from `head_sockets` and is exactly the mid-handshake set that
/// runs SNI resolution next tick (openssl.c:2537-2570, docs/tls.md §2.6).
fn wipe_listener_backrefs(group: *mut SocketGroup, loop_: *mut Loop, ls: *mut ListenSocket) {
    let target = ls.cast::<c_void>();
    let mut s = deref_mut(group).head_sockets;
    while !s.is_null() {
        wipe_one_backref(s, target);
        s = header_mut(s).next;
    }
    let mut q = ffi::ld_low_prio_head(loop_);
    while !q.is_null() {
        if header_mut(q).group == group {
            wipe_one_backref(q, target);
        }
        q = header_mut(q).next;
    }
}

fn wipe_one_backref(s: *mut us_socket_t, target: *mut c_void) {
    if let Transport::Tls(t) = &mut header_mut(s).transport {
        if !t.ssl.is_null() && tls_context::listener_backref(t.ssl) == target {
            tls_context::clear_listener_backref(t.ssl);
        }
    }
}

/// Unlink from the singly-linked `head_listen_sockets` (pointer scan).
fn unlink_listen_socket(group: *mut SocketGroup, ls: *mut ListenSocket) {
    let ls_next = header_mut(ls.cast::<us_socket_t>()).next;
    let g = deref_mut(group);
    if g.head_listen_sockets == ls {
        g.head_listen_sockets = ls_next.cast::<ListenSocket>();
    } else {
        let mut cur = g.head_listen_sockets;
        while !cur.is_null() {
            let cur_h = header_mut(cur.cast::<us_socket_t>());
            if cur_h.next.cast::<ListenSocket>() == ls {
                cur_h.next = ls_next;
                break;
            }
            cur = cur_h.next.cast::<ListenSocket>();
        }
    }
    header_mut(ls.cast::<us_socket_t>()).next = ptr::null_mut();
}

// ──────────────────────────────────────────────────────────────────────────
// Connect socket creation (R6.3/R6.7; the state machine lives in connecting.rs)
// ──────────────────────────────────────────────────────────────────────────

/// Shared SEMI_SOCKET bring-up: alloc + poll(W). Null on registration
/// failure with the fd closed and errno preserved. Does NOT link.
fn start_semi_socket(
    group: *mut SocketGroup,
    kind: SocketKind,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    options: c_int,
    ext_size: c_int,
    connect_state: *mut ConnectingSocket,
) -> *mut us_socket_t {
    let loop_ = deref_mut(group).loop_;
    let mut flags = SocketFlags::default();
    flags.set(
        SocketFlags::ALLOW_HALF_OPEN,
        options & LIBUS_SOCKET_ALLOW_HALF_OPEN != 0,
    );
    let s = socket::alloc(
        loop_,
        PollType::SemiSocket,
        fd,
        group,
        kind,
        flags,
        ext_size,
    );
    header_mut(s).connect_state = connect_state;
    poll_created(loop_);
    // Polls WRITABLE-only until the connect completes (R6.3).
    if start_poll(loop_, s, Events::WRITABLE) != 0 {
        let saved = io::errno();
        io::close(fd, false);
        poll_freed(loop_);
        socket::free_unstarted(loop_, s);
        io::set_errno(saved);
        return ptr::null_mut();
    }
    s
}

/// `us_socket_group_connect_resolved_dns` (R6.3, context.c:496-528).
fn connect_resolved_dns(
    group: *mut SocketGroup,
    kind: SocketKind,
    ssl_ctx: *mut SslCtx,
    addr: &io::ConnectAddr,
    local: Option<&io::ConnectAddr>,
    options: c_int,
    ext_size: c_int,
) -> *mut us_socket_t {
    let fd = match io::create_connect_socket(addr, local, options) {
        Ok(fd) => fd,
        Err(e) => {
            io::set_errno(e);
            return ptr::null_mut();
        }
    };
    io::nodelay(fd, true);
    let s = start_semi_socket(group, kind, fd, options, ext_size, ptr::null_mut());
    if s.is_null() {
        return ptr::null_mut();
    }
    if !ssl_ctx.is_null() {
        // Fast path has no connecting socket to stage the ctx on —
        // attach client TLS now (R6.3).
        attach_tls(s, ssl_ctx, true, None);
    }
    link_socket(group, s);
    s
}

/// One happy-eyeballs attempt (R6.7): built like R6.3 but no local bind, no
/// TLS (staged on `c`), ext word installed by the caller. Null on failure —
/// the caller skips to the next address.
pub(crate) fn connect_attempt(
    group: *mut SocketGroup,
    kind: SocketKind,
    addr: &io::ConnectAddr,
    options: c_int,
    c: *mut ConnectingSocket,
) -> *mut us_socket_t {
    let fd = match io::create_connect_socket(addr, None, options) {
        Ok(fd) => fd,
        Err(_) => return ptr::null_mut(),
    };
    io::nodelay(fd, true);
    // ext_size 0: the caller installs the connecting's 8-byte ext word.
    let s = start_semi_socket(group, kind, fd, options, 0, c);
    if s.is_null() {
        return ptr::null_mut();
    }
    link_socket(group, s);
    s
}

// ──────────────────────────────────────────────────────────────────────────
// Adopt (R3.5, in-place — docs/design.md §Strategy 3; contract C10). The
// connect_state fixup half of R3.5 lives in `SocketHeader::adopt`.
// ──────────────────────────────────────────────────────────────────────────

/// `us_socket_adopt` minus relocation: re-stamp group/kind in place, clear
/// timeouts, fix group linkage (including low-prio parked accounting).
/// Precondition (R3.5): no adoption of closed or shut-down sockets.
pub(crate) fn adopt_socket(s: *mut us_socket_t, group: *mut SocketGroup, kind: SocketKind) {
    if header_mut(s).is_closed() || socket::is_shut_down_full(s) {
        return;
    }
    // Adoption stays within one ext-storage family (word vs inline area);
    // crossing families would reinterpret the ext word (docs/design.md §Strategy 3).
    debug_assert!(
        dispatch::uses_group_vtable(header_mut(s).kind) == dispatch::uses_group_vtable(kind)
    );
    let old_group = header_mut(s).group;
    let parked = header_mut(s).low_prio_state == 1;
    if !parked {
        // Also fixes group->iterator if we're inside on_timeout (R3.14).
        unlink_socket(old_group, s);
    } else if old_group != group {
        // Stays on the loop-wide low-prio queue, but ownership moves — keep
        // both groups' invariants consistent so old_group can deinit.
        deref_mut(old_group).low_prio_count -= 1;
        deref_mut(group).low_prio_count += 1;
        group_touched(group);
        group_maybe_unlink(old_group);
    }
    {
        let h = header_mut(s);
        h.group = group;
        h.kind = kind;
        h.timeout = 255;
        h.long_timeout = 255;
    }
    if !parked {
        link_socket(group, s);
    }
    // Parked (state 1): queue pointers are unchanged — the loop-queue splice
    // of R3.5 step 4 is structurally unnecessary without relocation.
}

/// `adopt` + attach a fresh `SSL*`. Does NOT kick the handshake — the caller
/// repoints ext then calls `start_tls_handshake` (C10).
pub(crate) fn adopt_tls_socket(
    s: *mut us_socket_t,
    group: *mut SocketGroup,
    kind: SocketKind,
    ssl_ctx: *mut SslCtx,
    sni: Option<&CStr>,
    is_client: bool,
) {
    // Only closed sockets refuse adopt-TLS (openssl.c:2236-2257): shut-down
    // ones skip the relink (adopt_socket no-ops, like us_socket_adopt
    // returning `s` unchanged) but still get the SSL attached.
    if header_mut(s).is_closed() {
        return;
    }
    adopt_socket(s, group, kind);
    attach_tls(s, ssl_ctx, is_client, sni);
}

// ──────────────────────────────────────────────────────────────────────────
// Ext + TLS attach helpers
// ──────────────────────────────────────────────────────────────────────────

/// Release whatever the header's `ext` word owns; called from the
/// closed-socket drain right before the slab slot is returned. Rust kinds
/// own nothing (the word is the consumer's back-pointer); group-vtable ext
/// is inline in the slab slot and dies with it; listeners normally
/// dropped their `ListenerData` in `close_listen_socket` already (null here).
pub(crate) fn free_socket_ext(s: *mut us_socket_t) {
    let (kind, ext) = {
        let h = header_mut(s);
        (h.kind, h.ext)
    };
    if matches!(kind, SocketKind::Invalid) && !ext.is_null() {
        header_mut(s).ext = ptr::null_mut();
        drop_box(ext.cast::<ListenerData>());
    }
}

/// Attach TLS to a plain socket (no handshake kick — C10/R6.3).
fn attach_tls(s: *mut us_socket_t, ssl_ctx: *mut SslCtx, is_client: bool, sni: Option<&CStr>) {
    // C6: a live Transport::Tls Box must stay in place until the tick
    // postlude — overwriting would Drop (SSL_free) it past the §1.4
    // deferral. adopt_tls also refuses is_tls().
    if header_mut(s).is_tls() {
        debug_assert!(false, "attach_tls on an already-TLS socket");
        return;
    }
    let tls = TlsState::attach(s, ssl_ctx, is_client, sni);
    header_mut(s).transport = Transport::Tls(tls);
}

/// Server-side accept attach: also stores the listener backref for SNI /
/// on_server_name resolution during the handshake (per-SSL ex_data — never
/// on the shared CTX, which can outlive the listener).
fn attach_tls_accepted(s: *mut us_socket_t, ssl_ctx: *mut SslCtx, ls: *mut ListenSocket) {
    let tls = TlsState::attach(s, ssl_ctx, false, None);
    if !tls.ssl.is_null() {
        tls_context::set_listener_backref(tls.ssl, ls.cast::<c_void>());
    }
    header_mut(s).transport = Transport::Tls(tls);
}

// ──────────────────────────────────────────────────────────────────────────
// Group ⟷ loop linkage (R3.8-R3.12; context.c:171-261, loop.c:160-196)
// ──────────────────────────────────────────────────────────────────────────

/// Lazy linking: first insertion of any socket/connecting/listener links the
/// group at the head of `loop.data.head` (R3.8).
pub(crate) fn group_touched(group: *mut SocketGroup) {
    let (linked, loop_) = {
        let g = deref_mut(group);
        (g.linked != 0, g.loop_)
    };
    if !linked {
        loop_link_group(loop_, group);
        deref_mut(group).linked = 1;
    }
}

/// Unlink iff linked and fully empty (incl. low_prio_count — C8).
pub(crate) fn group_maybe_unlink(group: *mut SocketGroup) {
    let (linked, empty, loop_) = {
        let g = deref_mut(group);
        (g.linked != 0, g.is_empty(), g.loop_)
    };
    if linked && empty {
        loop_unlink_group(loop_, group);
        deref_mut(group).linked = 0;
    }
}

pub(crate) fn loop_link_group(loop_: *mut Loop, group: *mut SocketGroup) {
    let head = ffi::ld_group_head(loop_);
    {
        let g = deref_mut(group);
        g.next = head;
        g.prev = ptr::null_mut();
    }
    if !head.is_null() {
        deref_mut(head).prev = group;
    }
    ffi::ld_set_group_head(loop_, group);
}

/// If the group is the loop's sweep cursor, advance it BEFORE unlinking so a
/// timeout handler that deinits the current group doesn't strand the sweep
/// in freed storage (R3.12).
pub(crate) fn loop_unlink_group(loop_: *mut Loop, group: *mut SocketGroup) {
    let (g_prev, g_next) = {
        let g = deref_mut(group);
        (g.prev, g.next)
    };
    let head_is_group = {
        if ffi::ld_iterator(loop_) == group {
            ffi::ld_set_iterator(loop_, g_next);
        }
        let is_head = ffi::ld_group_head(loop_) == group;
        if is_head {
            ffi::ld_set_group_head(loop_, g_next);
        }
        is_head
    };
    if head_is_group {
        if !g_next.is_null() {
            deref_mut(g_next).prev = ptr::null_mut();
        }
    } else {
        // C derefs group->prev unconditionally here (a non-head linked group
        // always has one).
        deref_mut(g_prev).next = g_next;
        if !g_next.is_null() {
            deref_mut(g_next).prev = g_prev;
        }
    }
}

/// Push at the head of `head_sockets`; no-op for closed sockets (R3.9).
pub(crate) fn link_socket(group: *mut SocketGroup, s: *mut us_socket_t) {
    if header_mut(s).is_closed() {
        return;
    }
    let head = deref_mut(group).head_sockets;
    {
        let h = header_mut(s);
        h.group = group;
        h.next = head;
        h.prev = ptr::null_mut();
    }
    if !head.is_null() {
        header_mut(head).prev = s;
    }
    deref_mut(group).head_sockets = s;
    group_touched(group);
    timeouts::sweep_enable(deref_mut(group).loop_, group);
}

/// Unlink from `head_sockets`, advancing the sweep iterator when it points
/// at `s` (R3.10/R3.14).
pub(crate) fn unlink_socket(group: *mut SocketGroup, s: *mut us_socket_t) {
    {
        let next = header_mut(s).next;
        let g = deref_mut(group);
        if g.iterator == s {
            g.iterator = next;
        }
    }
    let (prev, next) = {
        let h = header_mut(s);
        (h.prev, h.next)
    };
    if prev == next {
        // Both null ⟺ only element (head-detection idiom, context.c:215).
        deref_mut(group).head_sockets = ptr::null_mut();
    } else {
        if prev.is_null() {
            deref_mut(group).head_sockets = next;
        } else {
            header_mut(prev).next = next;
        }
        if !next.is_null() {
            header_mut(next).prev = prev;
        }
    }
    {
        let h = header_mut(s);
        h.prev = ptr::null_mut();
        h.next = ptr::null_mut();
    }
    timeouts::sweep_disable(deref_mut(group).loop_, group);
    group_maybe_unlink(group);
}

/// Same shape over `head_connecting_sockets` via `{prev,next}_pending`
/// (R3.11); no-op for closed connecting sockets. Raw field access only:
/// neighbor nodes may be inside their pending-resolve window (C13), where a
/// whole-struct `&mut` would span the resolver-owned `next` bytes.
pub(crate) fn link_connecting_socket(group: *mut SocketGroup, c: *mut ConnectingSocket) {
    if ffi::conn_closed(c) {
        return;
    }
    let head = deref_mut(group).head_connecting_sockets;
    ffi::conn_set_group(c, group);
    ffi::conn_set_next_pending(c, head);
    ffi::conn_set_prev_pending(c, ptr::null_mut());
    if !head.is_null() {
        ffi::conn_set_prev_pending(head, c);
    }
    deref_mut(group).head_connecting_sockets = c;
    group_touched(group);
    timeouts::sweep_enable(deref_mut(group).loop_, group);
}

pub(crate) fn unlink_connecting_socket(group: *mut SocketGroup, c: *mut ConnectingSocket) {
    let prev = ffi::conn_prev_pending(c);
    let next = ffi::conn_next_pending(c);
    if prev == next {
        deref_mut(group).head_connecting_sockets = ptr::null_mut();
    } else {
        if prev.is_null() {
            deref_mut(group).head_connecting_sockets = next;
        } else {
            ffi::conn_set_next_pending(prev, next);
        }
        if !next.is_null() {
            ffi::conn_set_prev_pending(next, prev);
        }
    }
    // C parity (context.c:247-261): links stay intact after unlink so
    // close_all's restart walk can step past a closed-but-still-linked
    // sibling mid-dispatch (its next_pending must remain readable).
    timeouts::sweep_disable(deref_mut(group).loop_, group);
    group_maybe_unlink(group);
}

// ──────────────────────────────────────────────────────────────────────────
// Poll plumbing shims (num_polls accounting mirrors us_create_poll/us_poll_free)
// ──────────────────────────────────────────────────────────────────────────

fn start_poll(loop_: *mut Loop, s: *mut us_socket_t, events: Events) -> i32 {
    #[cfg(not(windows))]
    {
        // PollState is the FIRST field of the header (repr(C), R2.2) — the
        // header pointer IS the poll pointer.
        crate::backend::poll_start_rc(s.cast::<crate::backend::PollState>(), loop_, events)
    }
    #[cfg(windows)]
    crate::backend::libuv::socket_poll_start(s, loop_, events)
}

fn stop_poll(loop_: *mut Loop, s: *mut us_socket_t) {
    #[cfg(not(windows))]
    crate::backend::poll_stop(s.cast::<crate::backend::PollState>(), loop_);
    #[cfg(windows)]
    crate::backend::libuv::socket_poll_stop(s, loop_);
}

/// `us_create_poll` counts the poll; libuv counts active handles itself.
fn poll_created(loop_: *mut Loop) {
    #[cfg(not(windows))]
    {
        crate::unsafe_core::poll_access::num_polls_add(loop_, 1);
    }
    #[cfg(windows)]
    let _ = loop_;
}

/// Failed-registration unwind only — successful sockets decrement via the
/// close path's `us_poll_free` equivalent in the drain.
fn poll_freed(loop_: *mut Loop) {
    #[cfg(not(windows))]
    {
        crate::unsafe_core::poll_access::num_polls_add(loop_, -1);
    }
    #[cfg(windows)]
    let _ = loop_;
}

// Test-only: raw fd + C-ABI vtable handler need `unsafe` outside unsafe_core.
#[cfg(all(test, not(miri), any(target_os = "linux", target_os = "android")))]
#[allow(unsafe_code)]
mod tests {
    use super::*;
    use crate::loop_::tick;
    use crate::unsafe_core::test_support::{create_test_loop, free_test_loop};
    use crate::unsafe_core::trampolines::socket_slot_live;
    use bun_core::Timespec;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicI32, AtomicUsize, Ordering};

    static SLOT_LIVE_AFTER_NESTED_TICK: AtomicI32 = AtomicI32::new(-1);

    unsafe extern "C" fn close_and_pump_connect_error(
        s: *mut us_socket_t,
        _code: c_int,
    ) -> *mut us_socket_t {
        let loop_ = deref_mut(header_mut(s).group).loop_;
        close_raw(s, CloseCode::normal, ptr::null_mut());
        // Nested tick while the close_all walk (depth-held) still owns `s`.
        tick::run_bun_tick(loop_, Some(&Timespec::EPOCH));
        SLOT_LIVE_AFTER_NESTED_TICK.store(socket_slot_live(s) as i32, Ordering::SeqCst);
        s
    }

    static VT: VTable = VTable {
        on_open: None,
        on_data: None,
        on_fd: None,
        on_writable: None,
        on_close: None,
        on_timeout: None,
        on_long_timeout: None,
        on_end: None,
        on_connect_error: Some(close_and_pump_connect_error),
        on_connecting_error: None,
        on_handshake: None,
    };

    /// C6: close_all at tick_depth 0 holds raw slot pointers across dispatch;
    /// a handler-pumped nested tick's postlude must defer the closed drain.
    #[test]
    fn close_all_defers_drain_under_nested_tick() {
        let loop_ = create_test_loop();
        let mut group = Box::new(SocketGroup::default());
        group.init(loop_, Some(&VT), ptr::null_mut());
        let g: *mut SocketGroup = &mut *group;

        // SAFETY: plain fd creation; close_raw closes it during the test.
        let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
        assert!(fd >= 0);
        let s = socket::alloc(
            loop_,
            PollType::SemiSocket,
            fd,
            g,
            SocketKind::Dynamic,
            SocketFlags(0),
            0,
        );
        link_socket(g, s);
        poll_created(loop_); // model the armed connect poll (drain decrements)

        close_all_ex(g, false);

        assert_eq!(
            SLOT_LIVE_AFTER_NESTED_TICK.load(Ordering::SeqCst),
            1,
            "nested tick drained a slot the depth-0 close_all walk still holds"
        );
        assert!(
            socket_slot_live(s),
            "slot stays queued until an outermost drain"
        );

        tick::drain_closed_sockets(loop_);
        assert!(!socket_slot_live(s), "explicit drain frees the queued slot");

        // SAFETY: heads drained above; group unlinks itself from the loop.
        unsafe { SocketGroup::destroy(g) };
        drop(group);
        free_test_loop(loop_);
    }

    // ── shared fixture helpers for the close_all walk tests ────────────────

    const VT_NONE: VTable = VTable {
        on_open: None,
        on_data: None,
        on_fd: None,
        on_writable: None,
        on_close: None,
        on_timeout: None,
        on_long_timeout: None,
        on_end: None,
        on_connect_error: None,
        on_connecting_error: None,
        on_handshake: None,
    };

    /// Established plain socket linked into `g` (the close paths under test
    /// own the fd from here).
    fn make_test_socket(loop_: *mut Loop, g: *mut SocketGroup) -> *mut us_socket_t {
        // SAFETY: plain fd creation; close_raw/socket_close closes it.
        let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
        assert!(fd >= 0);
        let s = socket::alloc(
            loop_,
            PollType::Socket,
            fd,
            g,
            SocketKind::Dynamic,
            SocketFlags(0),
            0,
        );
        poll_created(loop_);
        link_socket(g, s);
        s
    }

    /// Group-linked connecting socket with no live resolve (close_raw takes
    /// the non-pending terminal arm: dispatch + detach, no keep-alive dec).
    fn make_test_connecting(loop_: *mut Loop, g: *mut SocketGroup) -> *mut ConnectingSocket {
        let c = crate::loop_::alloc_connecting(
            loop_,
            ConnectingSocket {
                kind: SocketKind::Dynamic,
                group: ptr::null_mut(),
                loop_,
                addrinfo_req: ptr::null_mut(),
                ssl_ctx: ptr::null_mut(),
                options: 0,
                port: 0,
                dns_error: 0,
                error: 0,
                closed: false,
                shut_down: false,
                shut_down_read: false,
                pending_resolve_callback: false,
                timeout: 255,
                long_timeout: 255,
                next: ptr::null_mut(),
                prev_pending: ptr::null_mut(),
                next_pending: ptr::null_mut(),
                addrinfo_head: ptr::null_mut(),
                attempts: [ptr::null_mut(); connecting::CONCURRENT_CONNECTIONS],
                ext: ptr::null_mut(),
            },
        );
        link_connecting_socket(g, c);
        c
    }

    fn dispatch_count(events: &Mutex<Vec<usize>>, addr: usize) -> usize {
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|&&a| a == addr)
            .count()
    }

    // ── graceful walk: snapshot-then-act is single-pass ─────────────────────

    static A_EVENTS: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    static A_LINKER: AtomicUsize = AtomicUsize::new(0); // socket whose on_close links
    static A_NEW: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "C" fn a_on_close(
        s: *mut us_socket_t,
        _code: c_int,
        _reason: *mut c_void,
    ) -> *mut us_socket_t {
        A_EVENTS.lock().unwrap().push(s as usize);
        if s as usize == A_LINKER.load(Ordering::SeqCst) {
            let g = header_mut(s).group;
            let n = make_test_socket(deref_mut(g).loop_, g);
            A_NEW.store(n as usize, Ordering::SeqCst);
        }
        s
    }

    static VT_A: VTable = VTable {
        on_close: Some(a_on_close),
        ..VT_NONE
    };

    /// The graceful walk must visit each snapshotted socket exactly once: a
    /// §5.2-deferred close (simulated via socket::test_defer_close) must NOT
    /// be re-attempted when a sibling's on_close shifts list positions, and
    /// a socket linked mid-walk is closed once by the force-drain backstop.
    #[test]
    fn close_all_graceful_walk_is_single_pass() {
        let loop_ = create_test_loop();
        let mut group = Box::new(SocketGroup::default());
        group.init(loop_, Some(&VT_A), ptr::null_mut());
        let g: *mut SocketGroup = &mut *group;

        let s1 = make_test_socket(loop_, g);
        let s2 = make_test_socket(loop_, g);
        let s3 = make_test_socket(loop_, g); // head order: [s3, s2, s1]
        A_LINKER.store(s2 as usize, Ordering::SeqCst);
        socket::test_defer_close::TARGET.store(s3, Ordering::SeqCst);
        socket::test_defer_close::ATTEMPTS.store(0, Ordering::SeqCst);

        close_all_ex(g, false);

        socket::test_defer_close::TARGET.store(ptr::null_mut(), Ordering::SeqCst);
        assert_eq!(
            socket::test_defer_close::ATTEMPTS.load(Ordering::SeqCst),
            1,
            "deferred socket got more than one graceful close attempt (walk not single-pass)"
        );
        let n = A_NEW.load(Ordering::SeqCst);
        assert_ne!(n, 0, "mid-walk link never happened");
        for addr in [s1 as usize, s2 as usize, s3 as usize, n] {
            assert_eq!(
                dispatch_count(&A_EVENTS, addr),
                1,
                "each socket dispatches on_close exactly once"
            );
        }
        assert!(deref_mut(g).head_sockets.is_null());

        tick::drain_closed_sockets(loop_);
        // SAFETY: heads drained above; group unlinks itself from the loop.
        unsafe { SocketGroup::destroy(g) };
        drop(group);
        free_test_loop(loop_);
    }

    // ── connecting walk: restart sees nodes linked at the head mid-walk ─────

    static B_EVENTS: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    static B_LINKER: AtomicUsize = AtomicUsize::new(0);
    static B_NEW: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "C" fn b_on_connecting_error(
        c: *mut ConnectingSocket,
        _code: c_int,
    ) -> *mut ConnectingSocket {
        B_EVENTS.lock().unwrap().push(c as usize);
        if c as usize == B_LINKER.load(Ordering::SeqCst) {
            let g = ffi::conn_group(c);
            let n = make_test_connecting(ffi::connecting_loop(c), g);
            B_NEW.store(n as usize, Ordering::SeqCst);
        }
        c
    }

    static VT_B: VTable = VTable {
        on_connecting_error: Some(b_on_connecting_error),
        ..VT_NONE
    };

    /// A connecting socket linked at the head by an on_connecting_error
    /// callback must still be closed by the same close_all (the cached-next
    /// walk missed it; the restart walk must not).
    #[test]
    fn close_all_connecting_walk_restarts_from_head() {
        let loop_ = create_test_loop();
        let mut group = Box::new(SocketGroup::default());
        group.init(loop_, Some(&VT_B), ptr::null_mut());
        let g: *mut SocketGroup = &mut *group;

        let c1 = make_test_connecting(loop_, g);
        B_LINKER.store(c1 as usize, Ordering::SeqCst);

        close_all_ex(g, false);

        assert!(
            deref_mut(g).head_connecting_sockets.is_null(),
            "connecting socket linked mid-walk escaped close_all"
        );
        let n = B_NEW.load(Ordering::SeqCst);
        assert_ne!(n, 0, "mid-walk link never happened");
        for addr in [c1 as usize, n] {
            assert_eq!(
                dispatch_count(&B_EVENTS, addr),
                1,
                "each connecting socket dispatches exactly once"
            );
        }

        tick::drain_closed_sockets(loop_);
        // SAFETY: heads drained above; group unlinks itself from the loop.
        unsafe { SocketGroup::destroy(g) };
        drop(group);
        free_test_loop(loop_);
    }

    // ── force-drain backstop covers connecting sockets opened by on_close ───

    static C_CONN_EVENTS: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    static C_NEW: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "C" fn c_on_close(
        s: *mut us_socket_t,
        _code: c_int,
        _reason: *mut c_void,
    ) -> *mut us_socket_t {
        if C_NEW.load(Ordering::SeqCst) == 0 {
            let g = header_mut(s).group;
            let n = make_test_connecting(deref_mut(g).loop_, g);
            C_NEW.store(n as usize, Ordering::SeqCst);
        }
        s
    }

    unsafe extern "C" fn c_on_connecting_error(
        c: *mut ConnectingSocket,
        _code: c_int,
    ) -> *mut ConnectingSocket {
        C_CONN_EVENTS.lock().unwrap().push(c as usize);
        c
    }

    static VT_C: VTable = VTable {
        on_close: Some(c_on_close),
        on_connecting_error: Some(c_on_connecting_error),
        ..VT_NONE
    };

    /// A connecting socket opened by an on_close callback (after the initial
    /// connecting walk already ran) must be drained before close_all returns
    /// — otherwise it outlives the owner's storage past the retry cap.
    #[test]
    fn close_all_drains_connecting_opened_during_close() {
        let loop_ = create_test_loop();
        let mut group = Box::new(SocketGroup::default());
        group.init(loop_, Some(&VT_C), ptr::null_mut());
        let g: *mut SocketGroup = &mut *group;

        make_test_socket(loop_, g);

        close_all_ex(g, false);

        assert!(
            deref_mut(g).head_connecting_sockets.is_null(),
            "connecting socket opened by on_close escaped close_all"
        );
        let n = C_NEW.load(Ordering::SeqCst);
        assert_ne!(n, 0, "on_close never opened the connecting socket");
        assert_eq!(dispatch_count(&C_CONN_EVENTS, n), 1);

        tick::drain_closed_sockets(loop_);
        // SAFETY: heads drained above; group unlinks itself from the loop.
        unsafe { SocketGroup::destroy(g) };
        drop(group);
        free_test_loop(loop_);
    }

    // ── loop walk: freeing the next group during dispatch must be safe ──────

    static D_EVENTS: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    static D_A_SOCK: AtomicUsize = AtomicUsize::new(0);
    static D_B_SOCK: AtomicUsize = AtomicUsize::new(0);
    static D_B_GROUP: AtomicUsize = AtomicUsize::new(0);
    static D_POISON: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "C" fn d_on_close(
        s: *mut us_socket_t,
        _code: c_int,
        _reason: *mut c_void,
    ) -> *mut us_socket_t {
        D_EVENTS.lock().unwrap().push(s as usize);
        if s as usize == D_A_SOCK.load(Ordering::SeqCst) {
            let sb = D_B_SOCK.load(Ordering::SeqCst) as *mut us_socket_t;
            close_raw(sb, CloseCode::normal, ptr::null_mut());
            let b = D_B_GROUP.swap(0, Ordering::SeqCst) as *mut SocketGroup;
            // SAFETY: b's heads drained by the close above; freeing the
            // walk's `next` group mid-dispatch is the scenario under test.
            unsafe {
                SocketGroup::destroy(b);
                drop(Box::from_raw(b));
            }
            // Same-size-class realloc typically reuses b's chunk, so a walk
            // that still probes the cached `next` reads hostile bytes
            // instead of benign stale ones (freed at the end of the test).
            let poison = Box::into_raw(Box::new([0xFFu8; size_of::<SocketGroup>()]));
            D_POISON.store(poison as usize, Ordering::SeqCst);
        }
        s
    }

    static VT_D: VTable = VTable {
        on_close: Some(d_on_close),
        ..VT_NONE
    };

    /// close_all_groups must never touch a cached `next` group after
    /// dispatch: here A's on_close closes B's socket and frees B outright
    /// (UAF under ASAN if the walk probes B afterwards).
    #[test]
    fn close_all_groups_survives_next_group_freed_mid_walk() {
        let loop_ = create_test_loop();
        let b = Box::into_raw(Box::new(SocketGroup::default()));
        deref_mut(b).init(loop_, Some(&VT_D), ptr::null_mut());
        let mut a = Box::new(SocketGroup::default());
        a.init(loop_, Some(&VT_D), ptr::null_mut());
        let ga: *mut SocketGroup = &mut *a;

        // Link B's socket first, then A's: loop head = [A, B], A.next == B.
        let sb = make_test_socket(loop_, b);
        let sa = make_test_socket(loop_, ga);
        assert_eq!(ffi::ld_group_head(loop_), ga);
        assert_eq!(deref_mut(ga).next, b);
        D_A_SOCK.store(sa as usize, Ordering::SeqCst);
        D_B_SOCK.store(sb as usize, Ordering::SeqCst);
        D_B_GROUP.store(b as usize, Ordering::SeqCst);

        assert!(Loop::close_all_groups(loop_));

        assert_eq!(D_B_GROUP.load(Ordering::SeqCst), 0, "B was never freed");
        for addr in [sa as usize, sb as usize] {
            assert_eq!(dispatch_count(&D_EVENTS, addr), 1);
        }
        assert!(deref_mut(ga).head_sockets.is_null());

        tick::drain_closed_sockets(loop_);
        // SAFETY: heads drained above; group unlinks itself from the loop;
        // the poison box was leaked by the handler and is reclaimed here.
        unsafe {
            SocketGroup::destroy(ga);
            drop(Box::from_raw(
                D_POISON.swap(0, Ordering::SeqCst) as *mut [u8; size_of::<SocketGroup>()]
            ));
        }
        drop(a);
        free_test_loop(loop_);
    }
}
