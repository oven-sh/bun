//! Compile-time `us_socket_vtable_t` generator. Given a Rust handler type and
//! the ext payload type, emits a single static-const `VTable` whose entries are
//! `extern "C"` trampolines that recover the typed ext from the raw socket and
//! forward.
//!
//! This replaces `NewSocketHandler.configure`/`unsafeConfigure`/`wrapTLS`,
//! which did the same trampoline dance per-call at runtime via
//! `us_socket_context_on_*`. One handler type → one vtable in `.rodata`.
//!
//! Handler shape (any subset; missing methods → vtable entry left null):
//!   type Ext = MySocket;                // what `us_socket_ext` holds
//!   fn on_open(ext, *us_socket_t, is_client: bool, ip: &[u8])
//!   fn on_data(ext, *us_socket_t, data: &[u8])
//!   fn on_writable(ext, *us_socket_t)
//!   fn on_close(ext, *us_socket_t, code: i32, reason: Option<*mut c_void>)
//!
//! `Ext` may be omitted entirely (HAS_EXT = false); handlers then take
//! `(*us_socket_t, …)` and recover their owner from `s.group().owner::<T>()`
//! instead.
//!
//!   fn on_timeout(ext, *us_socket_t)
//!   fn on_long_timeout(ext, *us_socket_t)
//!   fn on_end(ext, *us_socket_t)
//!   fn on_fd(ext, *us_socket_t, fd: c_int)
//!   fn on_connect_error(ext, *us_socket_t, code: i32)
//!   fn on_connecting_error(*ConnectingSocket, code: i32)
//!   fn on_handshake(ext, *us_socket_t, ok: bool, err: us_bun_verify_error_t)

use core::ffi::{c_int, c_void};

use crate::socket_group::VTable;
use crate::{us_bun_verify_error_t, us_socket_t, ConnectingSocket};

// TODO(port): Zig uses `@hasDecl(H, "onX")` structural reflection to decide
// which vtable slots are populated. Rust has no equivalent, so handlers
// implement this trait and set the `HAS_ON_*` associated consts for each
// method they actually provide. Default impls are `unreachable!()` and the
// corresponding vtable slot is left `None` when the const is `false`.
pub trait Handler: 'static {
    /// What `us_socket_ext` holds. Ignored when `HAS_EXT == false`.
    type Ext;
    /// Zig: `@hasDecl(H, "Ext")`. When false, handlers take `(s, …)` instead
    /// of `(ext, s, …)` and recover their owner from `s.group().owner::<T>()`.
    const HAS_EXT: bool = true;

    const HAS_ON_OPEN: bool = false;
    const HAS_ON_DATA: bool = false;
    const HAS_ON_FD: bool = false;
    const HAS_ON_WRITABLE: bool = false;
    const HAS_ON_CLOSE: bool = false;
    const HAS_ON_TIMEOUT: bool = false;
    const HAS_ON_LONG_TIMEOUT: bool = false;
    const HAS_ON_END: bool = false;
    const HAS_ON_CONNECT_ERROR: bool = false;
    const HAS_ON_CONNECTING_ERROR: bool = false;
    const HAS_ON_HANDSHAKE: bool = false;

    #[allow(unused_variables)]
    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, is_client: bool, ip: &[u8]) { unreachable!() }
    #[allow(unused_variables)]
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) { unreachable!() }
    #[allow(unused_variables)]
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) { unreachable!() }
    #[allow(unused_variables)]
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) { unreachable!() }
    #[allow(unused_variables)]
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) { unreachable!() }
    #[allow(unused_variables)]
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) { unreachable!() }
    #[allow(unused_variables)]
    fn on_handshake(ext: &mut Self::Ext, s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) { unreachable!() }

    // TODO(port): Zig's `HAS_EXT == false` path drops the `ext` arg entirely
    // (handlers take `(s, …)`). Rust can't change a trait method's arity by a
    // const, so the no-ext variants are separate methods. Only called when
    // `HAS_EXT == false`.
    #[allow(unused_variables)]
    fn on_open_no_ext(s: *mut us_socket_t, is_client: bool, ip: &[u8]) { unreachable!() }
    #[allow(unused_variables)]
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) { unreachable!() }
    #[allow(unused_variables)]
    fn on_fd_no_ext(s: *mut us_socket_t, fd: c_int) { unreachable!() }
    #[allow(unused_variables)]
    fn on_writable_no_ext(s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) { unreachable!() }
    #[allow(unused_variables)]
    fn on_timeout_no_ext(s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_long_timeout_no_ext(s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_end_no_ext(s: *mut us_socket_t) { unreachable!() }
    #[allow(unused_variables)]
    fn on_connect_error_no_ext(s: *mut us_socket_t, code: i32) { unreachable!() }
    #[allow(unused_variables)]
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) { unreachable!() }
}

/// Produce a `&'static VTable` for `H`. The result is a const address into
/// `.rodata`; safe to store in any number of `SocketGroup`s.
pub fn make<H: Handler>() -> &'static VTable {
    &Make::<H>::VT
}

struct Make<H>(core::marker::PhantomData<H>);

impl<H: Handler> Make<H> {
    const VT: VTable = VTable {
        on_open: if H::HAS_ON_OPEN { Some(Trampolines::<H>::on_open) } else { None },
        on_data: if H::HAS_ON_DATA { Some(Trampolines::<H>::on_data) } else { None },
        on_fd: if H::HAS_ON_FD { Some(Trampolines::<H>::on_fd) } else { None },
        on_writable: if H::HAS_ON_WRITABLE { Some(Trampolines::<H>::on_writable) } else { None },
        on_close: if H::HAS_ON_CLOSE { Some(Trampolines::<H>::on_close) } else { None },
        on_timeout: if H::HAS_ON_TIMEOUT { Some(Trampolines::<H>::on_timeout) } else { None },
        on_long_timeout: if H::HAS_ON_LONG_TIMEOUT { Some(Trampolines::<H>::on_long_timeout) } else { None },
        on_end: if H::HAS_ON_END { Some(Trampolines::<H>::on_end) } else { None },
        on_connect_error: if H::HAS_ON_CONNECT_ERROR { Some(Trampolines::<H>::on_connect_error) } else { None },
        on_connecting_error: if H::HAS_ON_CONNECTING_ERROR { Some(Trampolines::<H>::on_connecting_error) } else { None },
        on_handshake: if H::HAS_ON_HANDSHAKE { Some(Trampolines::<H>::on_handshake) } else { None },
    };
}

/// The trampolines themselves, exposed so `dispatch.rs` can direct-call them
/// per-kind without going through the vtable pointer at all.
pub struct Trampolines<H>(core::marker::PhantomData<H>);

impl<H: Handler> Trampolines<H> {
    // Zig: `inline fn call(s, comptime f, extra)` — conditionally prepends
    // `s.ext(@typeInfo(E).pointer.child)` to the arg tuple. Rust can't splat
    // tuples into a call, so each trampoline inlines the HAS_EXT branch.
    //
    // TODO(port): Zig's `s.ext(@typeInfo(E).pointer.child)` unwraps the
    // pointer-child of `H.Ext` (e.g. `*MySocket` → `MySocket`) before calling
    // `us_socket_ext`. Here `H::Ext` is the *pointee* type directly and
    // `us_socket_t::ext::<T>()` returns `&mut T`.
    #[inline(always)]
    fn ext(s: *mut us_socket_t) -> &'static mut H::Ext {
        // SAFETY: `s` is a live socket passed from usockets; ext storage was
        // sized for `H::Ext` at context creation. Lifetime is bounded by the
        // trampoline call (we lie with 'static because the borrow never
        // escapes the handler call).
        unsafe { (*s).ext::<H::Ext>() }
    }

    pub extern "C" fn on_open(s: *mut us_socket_t, is_client: c_int, ip: *mut u8, ip_len: c_int) -> *mut us_socket_t {
        let ip_slice: &[u8] = if !ip.is_null() {
            // SAFETY: usockets guarantees `ip[0..ip_len]` is valid when non-null.
            unsafe { core::slice::from_raw_parts(ip, usize::try_from(ip_len).unwrap()) }
        } else {
            &[]
        };
        if H::HAS_EXT {
            H::on_open(Self::ext(s), s, is_client != 0, ip_slice);
        } else {
            H::on_open_no_ext(s, is_client != 0, ip_slice);
        }
        s
    }

    pub extern "C" fn on_data(s: *mut us_socket_t, data: *mut u8, len: c_int) -> *mut us_socket_t {
        // SAFETY: usockets guarantees `data[0..len]` is valid.
        let data_slice = unsafe { core::slice::from_raw_parts(data, usize::try_from(len).unwrap()) };
        if H::HAS_EXT {
            H::on_data(Self::ext(s), s, data_slice);
        } else {
            H::on_data_no_ext(s, data_slice);
        }
        s
    }

    pub extern "C" fn on_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_fd(Self::ext(s), s, fd);
        } else {
            H::on_fd_no_ext(s, fd);
        }
        s
    }

    pub extern "C" fn on_writable(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_writable(Self::ext(s), s);
        } else {
            H::on_writable_no_ext(s);
        }
        s
    }

    pub extern "C" fn on_close(s: *mut us_socket_t, code: c_int, reason: *mut c_void) -> *mut us_socket_t {
        let reason = if reason.is_null() { None } else { Some(reason) };
        if H::HAS_EXT {
            H::on_close(Self::ext(s), s, code as i32, reason);
        } else {
            H::on_close_no_ext(s, code as i32, reason);
        }
        s
    }

    pub extern "C" fn on_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_timeout(Self::ext(s), s);
        } else {
            H::on_timeout_no_ext(s);
        }
        s
    }

    pub extern "C" fn on_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_long_timeout(Self::ext(s), s);
        } else {
            H::on_long_timeout_no_ext(s);
        }
        s
    }

    pub extern "C" fn on_end(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_end(Self::ext(s), s);
        } else {
            H::on_end_no_ext(s);
        }
        s
    }

    pub extern "C" fn on_connect_error(s: *mut us_socket_t, code: c_int) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_connect_error(Self::ext(s), s, code as i32);
        } else {
            H::on_connect_error_no_ext(s, code as i32);
        }
        s
    }

    pub extern "C" fn on_connecting_error(cs: *mut ConnectingSocket, code: c_int) -> *mut ConnectingSocket {
        H::on_connecting_error(cs, code as i32);
        cs
    }

    pub extern "C" fn on_handshake(s: *mut us_socket_t, ok: c_int, err: us_bun_verify_error_t, _user: *mut c_void) {
        if H::HAS_EXT {
            H::on_handshake(Self::ext(s), s, ok != 0, err);
        } else {
            H::on_handshake_no_ext(s, ok != 0, err);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/vtable.zig (118 lines)
//   confidence: medium
//   todos:      3
//   notes:      @hasDecl reflection replaced with Handler trait + HAS_* consts; no-ext path duplicated as *_no_ext methods since Rust can't vary trait method arity by const
// ──────────────────────────────────────────────────────────────────────────
