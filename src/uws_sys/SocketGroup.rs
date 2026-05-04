//! Rust mirror of `struct us_socket_group_t`. Embedded by value in its owner
//! (Listener, VirtualMachine, uWS App, HTTPThread) — never heap-allocated on
//! its own. The loop links it lazily on first socket and unlinks on last, so
//! unused kinds cost nothing.
//!
//! `#[repr(C)]` so field order/padding match the C definition exactly — this is
//! read/written directly by C (loop.c walks `head_sockets`/`iterator`,
//! context.c flips `linked`).

use core::ffi::{c_char, c_int, c_ushort, c_void};
use core::ptr;

use crate::{
    us_bun_verify_error_t, us_socket_t, ConnectingSocket, ListenSocket, Loop, SocketKind, SslCtx,
    LIBUS_SOCKET_DESCRIPTOR,
};

#[repr(C)]
pub struct SocketGroup {
    pub loop_: *mut Loop,
    pub vtable: Option<&'static VTable>,
    /// Embedding owner — typed access via `owner<T>()`. `*mut c_void` only
    /// because the C ABI slot is heterogenous (Listener / uWS App / RareData /
    /// null); never read this field directly.
    ext: *mut c_void,
    pub head_sockets: *mut us_socket_t,
    pub head_connecting_sockets: *mut ConnectingSocket,
    pub head_listen_sockets: *mut ListenSocket,
    pub iterator: *mut us_socket_t,
    pub prev: *mut SocketGroup,
    pub next: *mut SocketGroup,
    pub global_tick: u32,
    /// Sockets currently parked in `loop.data.low_prio_head` with
    /// `s->group == this`. They are NOT in `head_sockets` while queued, so
    /// `close_all`/`destroy` must account for them separately.
    pub low_prio_count: u16,
    pub timestamp: u8,
    pub long_timestamp: u8,
    pub linked: u8,
}

#[repr(C)]
pub struct VTable {
    pub on_open: Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut u8, c_int) -> *mut us_socket_t>,
    pub on_data: Option<unsafe extern "C" fn(*mut us_socket_t, *mut u8, c_int) -> *mut us_socket_t>,
    pub on_fd: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_writable: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_close: Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut c_void) -> *mut us_socket_t>,
    pub on_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_long_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_end: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_connect_error: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_connecting_error: Option<unsafe extern "C" fn(*mut ConnectingSocket, c_int) -> *mut ConnectingSocket>,
    pub on_handshake: Option<unsafe extern "C" fn(*mut us_socket_t, c_int, us_bun_verify_error_t, *mut c_void)>,
}

// Must match `struct us_socket_group_t` in libusockets.h.
// 9 ptrs + u32 + u16 + 3×u8, padded to 8-byte alignment.
const _: () = assert!(
    core::mem::size_of::<SocketGroup>() == 9 * core::mem::size_of::<*mut c_void>() + 16,
    "SocketGroup layout drifted from us_socket_group_t"
);
const _: () = assert!(
    core::mem::size_of::<VTable>() == 11 * core::mem::size_of::<*mut c_void>(),
    "VTable layout drifted from us_socket_vtable_t"
);

impl Default for SocketGroup {
    fn default() -> Self {
        // SAFETY: all-zero is a valid SocketGroup — every field is a raw
        // pointer (null), `Option<&'static _>` (None via NPO), or an integer (0).
        unsafe { core::mem::zeroed() }
    }
}

impl Default for VTable {
    fn default() -> Self {
        // SAFETY: all-zero is a valid VTable — every field is `Option<fn>` (None via NPO).
        unsafe { core::mem::zeroed() }
    }
}

pub enum ConnectResult {
    Socket(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Failed,
}

impl SocketGroup {
    /// Initialise an embedded group. `owner_ptr` is what `group.owner::<T>()`
    /// recovers inside handlers — pass the embedding struct so dispatch can
    /// find it from a raw `*us_socket_t`.
    // TODO(port): Zig accepted `owner_ptr: anytype` (any single-item pointer or
    // null) with comptime @typeInfo validation. Rust callers cast at the call
    // site; consider a typed `init_with_owner<T>(&mut self, ..., owner: &mut T)`
    // helper in Phase B if ergonomics warrant.
    pub fn init(&mut self, loop_: *mut Loop, vt: Option<&'static VTable>, owner_ptr: *mut c_void) {
        // SAFETY: C initializes all fields of `self` in-place; `self` is a valid
        // `#[repr(C)]` slot embedded in the caller.
        unsafe {
            us_socket_group_init(
                self,
                loop_,
                match vt {
                    Some(v) => v as *const VTable,
                    None => ptr::null(),
                },
                owner_ptr,
            );
        }
    }

    // PORT NOTE: not `impl Drop`. SocketGroup is `#[repr(C)]`, embedded
    // by-value in its owner, and its lifecycle is FFI-managed (C unlinks it
    // from the loop). PORTING.md's #[repr(C)]-across-FFI exception applies:
    // expose `unsafe fn destroy(*mut Self)` and have the owner call it
    // explicitly during its own teardown.
    ///
    /// # Safety
    /// `this` must point to a group previously passed to `init`; not called
    /// concurrently with the loop walking this group.
    pub unsafe fn destroy(this: *mut Self) {
        us_socket_group_deinit(this)
    }

    pub fn close_all(&mut self) {
        // SAFETY: `self` was previously passed to `init`.
        unsafe { us_socket_group_close_all(self) }
    }

    /// Non-null after `init`. The fields stay nullable raw pointers only because
    /// the struct is zero-init'd by default and read directly by C; these
    /// accessors encode the post-init invariant.
    pub fn get_loop(&self) -> *mut Loop {
        debug_assert!(!self.loop_.is_null());
        self.loop_
    }

    /// Recover the embedding owner. Only valid for groups whose `init` passed a
    /// non-null owner (Listener, uWS App/Context). Per-kind VM groups in
    /// `RareData` pass null, so callers must know which they have.
    ///
    /// # Safety
    /// `T` must be the exact type whose pointer was passed to `init`, and that
    /// object must still be alive (it embeds this group by value, so it is).
    pub unsafe fn owner<T>(&self) -> *mut T {
        debug_assert!(!self.ext.is_null());
        self.ext.cast::<T>()
    }

    pub fn is_empty(&self) -> bool {
        self.head_sockets.is_null()
            && self.head_connecting_sockets.is_null()
            && self.head_listen_sockets.is_null()
            && self.low_prio_count == 0
    }

    pub fn listen(
        &mut self,
        kind: SocketKind,
        ssl_ctx: *mut SslCtx,
        host: Option<&core::ffi::CStr>,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
        err: &mut c_int,
    ) -> *mut ListenSocket {
        // SAFETY: forwarding to C; all pointers are valid or null as documented.
        unsafe {
            us_socket_group_listen(
                self,
                kind as u8,
                ssl_ctx,
                host.map_or(ptr::null(), |h| h.as_ptr()),
                port,
                options,
                socket_ext_size,
                err,
            )
        }
    }

    pub fn listen_unix(
        &mut self,
        kind: SocketKind,
        ssl_ctx: *mut SslCtx,
        path: &[u8],
        options: c_int,
        socket_ext_size: c_int,
        err: &mut c_int,
    ) -> *mut ListenSocket {
        // SAFETY: forwarding to C; `path` ptr+len derived from a valid slice.
        unsafe {
            us_socket_group_listen_unix(
                self,
                kind as u8,
                ssl_ctx,
                path.as_ptr(),
                path.len(),
                options,
                socket_ext_size,
                err,
            )
        }
    }

    pub fn connect(
        &mut self,
        kind: SocketKind,
        ssl_ctx: *mut SslCtx,
        host: &core::ffi::CStr,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
    ) -> ConnectResult {
        // context.c writes 1 here on the synchronous path (DNS already resolved
        // → real `us_socket_t*` returned), 0 when it hands back a
        // `us_connecting_socket_t*` placeholder. Named to match the C side so
        // the branches read the right way round — see PR review #3161005603.
        let mut has_dns_resolved: c_int = 0;
        // SAFETY: forwarding to C; `host` is a valid NUL-terminated C string.
        let ptr = unsafe {
            us_socket_group_connect(
                self,
                kind as u8,
                ssl_ctx,
                host.as_ptr(),
                port,
                options,
                socket_ext_size,
                &mut has_dns_resolved,
            )
        };
        if ptr.is_null() {
            return ConnectResult::Failed;
        }
        if has_dns_resolved != 0 {
            ConnectResult::Socket(ptr.cast::<us_socket_t>())
        } else {
            ConnectResult::Connecting(ptr.cast::<ConnectingSocket>())
        }
    }

    pub fn connect_unix(
        &mut self,
        kind: SocketKind,
        ssl_ctx: *mut SslCtx,
        path: &[u8],
        options: c_int,
        socket_ext_size: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: forwarding to C; `path` ptr+len derived from a valid slice.
        unsafe {
            us_socket_group_connect_unix(
                self,
                kind as u8,
                ssl_ctx,
                path.as_ptr(),
                path.len(),
                options,
                socket_ext_size,
            )
        }
    }

    pub fn from_fd(
        &mut self,
        kind: SocketKind,
        ssl_ctx: *mut SslCtx,
        socket_ext_size: c_int,
        fd: LIBUS_SOCKET_DESCRIPTOR,
        ipc: bool,
    ) -> *mut us_socket_t {
        // SAFETY: forwarding to C.
        unsafe { us_socket_from_fd(self, kind as u8, ssl_ctx, socket_ext_size, fd, ipc as c_int) }
    }

    pub fn pair(
        &mut self,
        kind: SocketKind,
        ext_size: c_int,
        fds: &mut [LIBUS_SOCKET_DESCRIPTOR; 2],
    ) -> *mut us_socket_t {
        // SAFETY: forwarding to C; `fds` is a valid 2-element array.
        unsafe { us_socket_pair(self, kind as u8, ext_size, fds.as_mut_ptr().cast()) }
    }

    pub fn next_in_loop(&mut self) -> *mut SocketGroup {
        // SAFETY: forwarding to C.
        unsafe { us_socket_group_next(self) }
    }
}

unsafe extern "C" {
    fn us_socket_group_init(
        group: *mut SocketGroup,
        loop_: *mut Loop,
        vt: *const VTable,
        ext: *mut c_void,
    );
    fn us_socket_group_deinit(group: *mut SocketGroup);
    fn us_socket_group_close_all(group: *mut SocketGroup);
    #[allow(dead_code)]
    fn us_socket_group_timestamp(group: *mut SocketGroup) -> c_ushort;
    #[allow(dead_code)]
    fn us_socket_group_loop(group: *mut SocketGroup) -> *mut Loop;
    fn us_socket_group_next(group: *mut SocketGroup) -> *mut SocketGroup;
    fn us_socket_group_listen(
        group: *mut SocketGroup,
        kind: u8,
        ssl_ctx: *mut SslCtx,
        host: *const c_char,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
        err: *mut c_int,
    ) -> *mut ListenSocket;
    fn us_socket_group_listen_unix(
        group: *mut SocketGroup,
        kind: u8,
        ssl_ctx: *mut SslCtx,
        path: *const u8,
        pathlen: usize,
        options: c_int,
        socket_ext_size: c_int,
        err: *mut c_int,
    ) -> *mut ListenSocket;
    /// Returns `us_socket_t*` (fast path) OR `us_connecting_socket_t*` (slow
    /// path), discriminated by `*is_connecting`. The public `connect()` method
    /// turns this into the typed `ConnectResult` enum — call that, not this.
    fn us_socket_group_connect(
        group: *mut SocketGroup,
        kind: u8,
        ssl_ctx: *mut SslCtx,
        host: *const c_char,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
        is_connecting: *mut c_int,
    ) -> *mut c_void;
    fn us_socket_group_connect_unix(
        group: *mut SocketGroup,
        kind: u8,
        ssl_ctx: *mut SslCtx,
        path: *const u8,
        pathlen: usize,
        options: c_int,
        socket_ext_size: c_int,
    ) -> *mut us_socket_t;
    fn us_socket_from_fd(
        group: *mut SocketGroup,
        kind: u8,
        ssl_ctx: *mut SslCtx,
        socket_ext_size: c_int,
        fd: LIBUS_SOCKET_DESCRIPTOR,
        ipc: c_int,
    ) -> *mut us_socket_t;
    fn us_socket_pair(
        group: *mut SocketGroup,
        kind: u8,
        ext_size: c_int,
        fds: *mut [LIBUS_SOCKET_DESCRIPTOR; 2],
    ) -> *mut us_socket_t;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/SocketGroup.zig (208 lines)
//   confidence: medium
//   todos:      1
//   notes:      init() owner_ptr collapsed from anytype→*mut c_void; deinit→unsafe destroy(*mut Self) per #[repr(C)]-FFI exception (no Drop); imports assume Loop/SocketKind/SslCtx/etc. live in crate root
// ──────────────────────────────────────────────────────────────────────────
