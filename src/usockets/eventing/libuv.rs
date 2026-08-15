#![cfg(target_os = "windows")]
//! libuv eventing backend (Windows). Mirrors
//! `packages/bun-usockets/src/eventing/libuv.c` and
//! `internal/eventing/libuv.h` field-for-field so the `us_*` ABI is unchanged.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::size_of;
use core::ptr;

use bun_libuv_sys::{
    RunMode, UV_EOF, UV_READABLE, UV_WRITABLE, uv_async_init, uv_async_send, uv_async_t,
    uv_check_init, uv_check_start, uv_check_stop, uv_check_t, uv_close, uv_handle_t, uv_is_closing,
    uv_loop_delete, uv_loop_new, uv_loop_t, uv_poll_init_socket, uv_poll_start, uv_poll_stop,
    uv_poll_t, uv_prepare_init, uv_prepare_start, uv_prepare_stop, uv_prepare_t, uv_ref, uv_run,
    uv_timer_init, uv_timer_start, uv_timer_stop, uv_timer_t, uv_unref, uv_update_time,
};

use crate::types::{
    Bun__outOfMemory, LIBUS_SOCKET_DESCRIPTOR, POLL_TYPE_KIND_MASK, POLL_TYPE_POLLING_IN,
    POLL_TYPE_POLLING_MASK, POLL_TYPE_POLLING_OUT, us_calloc, us_free, us_internal_async,
    us_internal_callback_t, us_internal_loop_data_t, us_malloc, us_socket_t,
};

// ═══════════════════════════════════════════════════════════════════════════
// Backend constants (`internal/eventing/libuv.h`)
// ═══════════════════════════════════════════════════════════════════════════

pub const LIBUS_SOCKET_READABLE: c_int = UV_READABLE;
pub const LIBUS_SOCKET_WRITABLE: c_int = UV_WRITABLE;

// ═══════════════════════════════════════════════════════════════════════════
// Backend handle types (`internal/eventing/libuv.h`)
// ═══════════════════════════════════════════════════════════════════════════

/// `struct us_loop_t` — libuv-backed event loop.
#[repr(C, align(16))]
pub struct us_loop_t {
    pub data: us_internal_loop_data_t,
    pub uv_loop: *mut uv_loop_t,
    pub is_default: c_int,
    pub uv_pre: *mut uv_prepare_t,
    pub uv_check: *mut uv_check_t,
}

/// `struct us_poll_t` — unlike epoll/kqueue this is *not* castable to
/// `uv_poll_t`; it holds a pointer so the block can be resized.
#[repr(C)]
pub struct us_poll_t {
    pub uv_p: *mut uv_poll_t,
    pub fd: LIBUS_SOCKET_DESCRIPTOR,
    pub poll_type: u8,
}

/// Opaque timer handle; always points at a `us_internal_callback_t` with a
/// trailing `uv_timer_t` (see `us_create_timer`).
#[repr(C, align(16))]
pub struct us_timer_t {
    _p: [u8; 0],
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-file us_internal_* (defined in loop_core.rs) + Winsock/CRT glue
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn us_internal_dispatch_ready_poll(p: *mut us_poll_t, error: c_int, eof: c_int, events: c_int);
    fn us_internal_loop_pre(loop_: *mut us_loop_t);
    fn us_internal_loop_post(loop_: *mut us_loop_t);
    fn us_internal_loop_data_init(
        loop_: *mut us_loop_t,
        wakeup_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
        pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
        post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    );
    fn us_internal_loop_data_free(loop_: *mut us_loop_t);
    fn us_loop_integrate(loop_: *mut us_loop_t);
}

const SOL_SOCKET: c_int = 0xffff;
const SO_ERROR: c_int = 0x1007;

#[link(name = "ws2_32")]
unsafe extern "system" {
    fn getsockopt(
        s: LIBUS_SOCKET_DESCRIPTOR,
        level: c_int,
        optname: c_int,
        optval: *mut c_char,
        optlen: *mut c_int,
    ) -> c_int;
}

unsafe extern "C" {
    // MSVC CRT `errno` (what the `errno` macro expands to).
    fn _errno() -> *mut c_int;
}

// ═══════════════════════════════════════════════════════════════════════════
// Allocation helpers
// ═══════════════════════════════════════════════════════════════════════════

#[inline]
unsafe fn alloc_or_oom(n: usize) -> *mut c_void {
    // SAFETY: thin wrapper over libc malloc; caller owns the block.
    let p = unsafe { us_malloc(n) };
    if p.is_null() {
        // SAFETY: diverges; matches C's immediate null-deref crash with a diagnostic.
        unsafe { Bun__outOfMemory() };
    }
    p
}

#[inline]
unsafe fn calloc_or_oom(n: usize, size: usize) -> *mut c_void {
    // SAFETY: thin wrapper over libc calloc; caller owns the block.
    let p = unsafe { us_calloc(n, size) };
    if p.is_null() {
        // SAFETY: diverges.
        unsafe { Bun__outOfMemory() };
    }
    p
}

#[inline]
fn as_handle<T>(p: *mut T) -> *mut uv_handle_t {
    p.cast()
}

// ═══════════════════════════════════════════════════════════════════════════
// libuv callbacks (static in C)
// ═══════════════════════════════════════════════════════════════════════════

/// `uv_poll_t->data` points back at the owning `us_poll_t` (except transiently
/// after `us_poll_stop`).
unsafe extern "C" fn poll_cb(p: *mut uv_poll_t, status: c_int, events: c_int) {
    // SAFETY: libuv guarantees `p` is the live handle we registered; `data`
    // was set to the `us_poll_t` at creation/resize time.
    unsafe {
        us_internal_dispatch_ready_poll(
            (*p).data.cast(),
            (status < 0 && status != UV_EOF) as c_int,
            (status == UV_EOF) as c_int,
            events,
        );
    }
}

unsafe extern "C" fn prepare_cb(p: *mut uv_prepare_t) {
    // SAFETY: `data` was set to the loop in `us_create_loop`.
    unsafe { us_internal_loop_pre((*p).data.cast()) };
}

/// Note: libuv timers execute AFTER the post callback.
unsafe extern "C" fn check_cb(p: *mut uv_check_t) {
    // SAFETY: `data` was set to the loop in `us_create_loop`.
    unsafe { us_internal_loop_post((*p).data.cast()) };
}

/// Not used for polls, since polls need two frees.
unsafe extern "C" fn close_cb_free(h: *mut uv_handle_t) {
    // SAFETY: `data` was set to the owning allocation before `uv_close`.
    unsafe { us_free((*h).data) };
}

/// Polls need two frees (the `uv_poll_t` and the `us_poll_t`).
unsafe extern "C" fn close_cb_free_poll(h: *mut uv_handle_t) {
    // SAFETY: only reached via `us_poll_stop`→`uv_close`. If `us_poll_free`
    // raced in before this fired it put the `us_poll_t` back into `data`;
    // otherwise `data` is null and both frees are no-ops.
    unsafe {
        let data = (*h).data;
        if !data.is_null() {
            us_free(data);
            us_free(h.cast());
        }
    }
}

unsafe extern "C" fn timer_cb(t: *mut uv_timer_t) {
    // SAFETY: `data` is the `us_internal_callback_t` set in `us_create_timer`.
    unsafe {
        let cb: *mut us_internal_callback_t = (*t).data.cast();
        if let Some(f) = (*cb).cb {
            f(cb);
        }
    }
}

unsafe extern "C" fn async_cb(a: *mut uv_async_t) {
    // SAFETY: `data` is the `us_internal_callback_t` set in `us_internal_async_set`.
    // Internal asyncs pass their loop, not themselves.
    unsafe {
        let cb: *mut us_internal_callback_t = (*a).data.cast();
        if let Some(f) = (*cb).cb {
            f((*cb).loop_.cast());
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Poll
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_init(
    p: *mut us_poll_t,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    poll_type: c_int,
) {
    // SAFETY: caller owns `p`.
    unsafe {
        (*p).poll_type = poll_type as u8;
        (*p).fd = fd;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_free(p: *mut us_poll_t, _loop: *mut us_loop_t) {
    // SAFETY: caller owns `p`.
    unsafe {
        let uv_p = (*p).uv_p;
        // Poll was resized and no longer owns its uv_poll_t.
        if uv_p.is_null() {
            us_free(p.cast());
            return;
        }
        // `us_poll_stop` nulls uv_p->data and arms close_cb_free_poll. If that
        // close is still pending we hand `p` back via `data` so the close cb
        // frees both; otherwise free both now.
        if uv_is_closing(as_handle(uv_p)) != 0 {
            (*uv_p).data = p.cast();
        } else {
            us_free(uv_p.cast());
            us_free(p.cast());
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start(p: *mut us_poll_t, loop_: *mut us_loop_t, events: c_int) {
    // SAFETY: caller owns `p`; `loop_` is a live loop.
    unsafe {
        let uv_p = (*p).uv_p;
        if uv_p.is_null() {
            return;
        }
        (*p).poll_type = (us_internal_poll_type(p)
            | if events & LIBUS_SOCKET_READABLE != 0 {
                POLL_TYPE_POLLING_IN
            } else {
                0
            }
            | if events & LIBUS_SOCKET_WRITABLE != 0 {
                POLL_TYPE_POLLING_OUT
            } else {
                0
            }) as u8;

        uv_poll_init_socket((*loop_).uv_loop, uv_p, (*p).fd);
        // Bun's event loop keeps sockets alive via Async.KeepAlive, so unref
        // here; usockets itself has no notion of ref-counted handles.
        uv_unref(as_handle(uv_p));
        uv_poll_start(uv_p, events, Some(poll_cb));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start_rc(
    p: *mut us_poll_t,
    loop_: *mut us_loop_t,
    events: c_int,
) -> c_int {
    // SAFETY: forwards to us_poll_start.
    unsafe { us_poll_start(p, loop_, events) };
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_change(p: *mut us_poll_t, _loop: *mut us_loop_t, events: c_int) {
    // SAFETY: caller owns `p`.
    unsafe {
        let uv_p = (*p).uv_p;
        if uv_p.is_null() {
            return;
        }
        if us_poll_events(p) != events {
            (*p).poll_type = (us_internal_poll_type(p)
                | if events & LIBUS_SOCKET_READABLE != 0 {
                    POLL_TYPE_POLLING_IN
                } else {
                    0
                }
                | if events & LIBUS_SOCKET_WRITABLE != 0 {
                    POLL_TYPE_POLLING_OUT
                } else {
                    0
                }) as u8;
            uv_poll_start(uv_p, events, Some(poll_cb));
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_stop(p: *mut us_poll_t, _loop: *mut us_loop_t) {
    // SAFETY: caller owns `p`.
    unsafe {
        let uv_p = (*p).uv_p;
        if uv_p.is_null() {
            return;
        }
        uv_poll_stop(uv_p);
        // Null `data` so close_cb_free_poll is a no-op unless `us_poll_free`
        // races in and restores it before the close fires.
        (*uv_p).data = ptr::null_mut();
        uv_close(as_handle(uv_p), Some(close_cb_free_poll));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_events(p: *mut us_poll_t) -> c_int {
    // SAFETY: caller owns `p`.
    let pt = unsafe { (*p).poll_type } as c_int;
    (if pt & POLL_TYPE_POLLING_IN != 0 {
        LIBUS_SOCKET_READABLE
    } else {
        0
    }) | (if pt & POLL_TYPE_POLLING_OUT != 0 {
        LIBUS_SOCKET_WRITABLE
    } else {
        0
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_accept_poll_event(_p: *mut us_poll_t) -> usize {
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_type(p: *mut us_poll_t) -> c_int {
    // SAFETY: caller owns `p`.
    unsafe { (*p).poll_type as c_int & POLL_TYPE_KIND_MASK }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_set_type(p: *mut us_poll_t, poll_type: c_int) {
    // SAFETY: caller owns `p`.
    unsafe {
        (*p).poll_type = (poll_type | ((*p).poll_type as c_int & POLL_TYPE_POLLING_MASK)) as u8;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_fd(p: *mut us_poll_t) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: caller owns `p`.
    unsafe { (*p).fd }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_poll(
    _loop: *mut us_loop_t,
    _fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_poll_t {
    // SAFETY: fresh malloc'd block; uv_p->data back-links to `p`.
    unsafe {
        let p = alloc_or_oom(size_of::<us_poll_t>() + ext_size as usize).cast::<us_poll_t>();
        let uv_p = alloc_or_oom(size_of::<uv_poll_t>()).cast::<uv_poll_t>();
        (*p).uv_p = uv_p;
        (*uv_p).data = p.cast();
        p
    }
}

/// If we move the block we must re-point `uv_p->data` at the new `us_poll_t`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_resize(
    p: *mut us_poll_t,
    _loop: *mut us_loop_t,
    old_ext_size: c_uint,
    ext_size: c_uint,
) -> *mut us_poll_t {
    // SAFETY: caller owns `p`; returns either `p` or a fresh block that now
    // owns `p`'s `uv_poll_t` (old `p` is leaked/freed elsewhere by caller).
    unsafe {
        if (*p).uv_p.is_null() {
            return p;
        }
        let old_size = size_of::<us_poll_t>() + old_ext_size as usize;
        let new_size = size_of::<us_poll_t>() + ext_size as usize;
        if new_size <= old_size {
            return p;
        }

        let new_p = calloc_or_oom(1, new_size).cast::<us_poll_t>();
        ptr::copy_nonoverlapping(p.cast::<u8>(), new_p.cast::<u8>(), old_size);

        (*(*new_p).uv_p).data = new_p.cast();
        (*p).uv_p = ptr::null_mut();
        new_p
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_pump(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is a live loop.
    unsafe { uv_run((*loop_).uv_loop, RunMode::NoWait) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_loop(
    hint: *mut c_void,
    wakeup_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    ext_size: c_uint,
) -> *mut us_loop_t {
    // SAFETY: fresh calloc'd block; libuv handles are heap-owned and freed via
    // close_cb_free in `us_loop_free`.
    unsafe {
        let loop_ =
            calloc_or_oom(1, size_of::<us_loop_t>() + ext_size as usize).cast::<us_loop_t>();

        (*loop_).uv_loop = if hint.is_null() {
            uv_loop_new()
        } else {
            hint.cast()
        };
        (*loop_).is_default = (!hint.is_null()) as c_int;

        let uv_pre = alloc_or_oom(size_of::<uv_prepare_t>()).cast::<uv_prepare_t>();
        (*loop_).uv_pre = uv_pre;
        uv_prepare_init((*loop_).uv_loop, uv_pre);
        uv_prepare_start(uv_pre, Some(prepare_cb));
        uv_unref(as_handle(uv_pre));
        (*uv_pre).data = loop_.cast();

        let uv_check = alloc_or_oom(size_of::<uv_check_t>()).cast::<uv_check_t>();
        (*loop_).uv_check = uv_check;
        uv_check_init((*loop_).uv_loop, uv_check);
        uv_unref(as_handle(uv_check));
        uv_check_start(uv_check, Some(check_cb));
        (*uv_check).data = loop_.cast();

        // Creates two unreffed handles — sweep timer and wakeup async.
        us_internal_loop_data_init(loop_, wakeup_cb, pre_cb, post_cb);

        // If we do not own this loop, integrate now and arm the timer.
        if !hint.is_null() {
            us_loop_integrate(loop_);
        }

        loop_
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_free(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` came from `us_create_loop`.
    unsafe {
        let uv_pre = (*loop_).uv_pre;
        uv_ref(as_handle(uv_pre));
        uv_prepare_stop(uv_pre);
        (*uv_pre).data = uv_pre.cast();
        uv_close(as_handle(uv_pre), Some(close_cb_free));

        let uv_check = (*loop_).uv_check;
        uv_ref(as_handle(uv_check));
        uv_check_stop(uv_check);
        (*uv_check).data = uv_check.cast();
        uv_close(as_handle(uv_check), Some(close_cb_free));

        us_internal_loop_data_free(loop_);

        // Run one last round to fire close callbacks — only if we own the loop.
        if (*loop_).is_default == 0 {
            uv_run((*loop_).uv_loop, RunMode::NoWait);
            uv_loop_delete((*loop_).uv_loop);
        }

        us_free(loop_.cast());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is a live loop.
    unsafe {
        us_loop_integrate(loop_);
        uv_update_time((*loop_).uv_loop);
        uv_run((*loop_).uv_loop, RunMode::Once);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Timer
// ═══════════════════════════════════════════════════════════════════════════

/// Pointer to the `uv_timer_t` laid out immediately after `cb`.
#[inline]
unsafe fn cb_uv_timer(cb: *mut us_internal_callback_t) -> *mut uv_timer_t {
    // SAFETY: `cb` was allocated with trailing `uv_timer_t` by `us_create_timer`.
    unsafe { cb.add(1).cast() }
}

/// Pointer to the `uv_async_t` laid out immediately after `cb`.
#[inline]
unsafe fn cb_uv_async(cb: *mut us_internal_callback_t) -> *mut uv_async_t {
    // SAFETY: `cb` was allocated with trailing `uv_async_t` by `us_internal_create_async`.
    unsafe { cb.add(1).cast() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_timer(
    loop_: *mut us_loop_t,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_timer_t {
    // SAFETY: fresh calloc'd block holding callback header + uv_timer_t + ext.
    unsafe {
        let cb = calloc_or_oom(
            1,
            size_of::<us_internal_callback_t>() + size_of::<uv_timer_t>() + ext_size as usize,
        )
        .cast::<us_internal_callback_t>();

        (*cb).loop_ = loop_;
        (*cb).cb_expects_the_loop = 0;
        (*cb).leave_poll_ready = 0;

        let uv_timer = cb_uv_timer(cb);
        uv_timer_init((*loop_).uv_loop, uv_timer);
        (*uv_timer).data = cb.cast();

        if fallthrough != 0 {
            uv_unref(as_handle(uv_timer));
        }

        cb.cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_ext(timer: *mut us_timer_t) -> *mut c_void {
    // SAFETY: ext area is immediately past the callback header + uv_timer_t.
    unsafe {
        timer
            .cast::<u8>()
            .add(size_of::<us_internal_callback_t>() + size_of::<uv_timer_t>())
            .cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_close(t: *mut us_timer_t, _fallthrough: c_int) {
    // SAFETY: `t` is a live timer from `us_create_timer`.
    unsafe {
        let cb = t.cast::<us_internal_callback_t>();
        let uv_timer = cb_uv_timer(cb);

        // Always ref before closing.
        uv_ref(as_handle(uv_timer));
        uv_timer_stop(uv_timer);

        (*uv_timer).data = cb.cast();
        uv_close(as_handle(uv_timer), Some(close_cb_free));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_set(
    t: *mut us_timer_t,
    cb: Option<unsafe extern "C" fn(*mut us_timer_t)>,
    ms: c_int,
    repeat_ms: c_int,
) {
    // SAFETY: `t` is a live timer from `us_create_timer`.
    unsafe {
        let internal_cb = t.cast::<us_internal_callback_t>();

        // Match epoll/kqueue: re-arming is allowed (uv_timer_start restarts a
        // running timer). The one-shot guard applies only to the sweep timer,
        // which every new context arms with identical args.
        if (*(*internal_cb).loop_).data.sweep_timer == t {
            if (*internal_cb).has_added_timer_to_event_loop != 0 {
                return;
            }
            (*internal_cb).has_added_timer_to_event_loop = 1;
        }

        (*internal_cb).cb = core::mem::transmute::<
            Option<unsafe extern "C" fn(*mut us_timer_t)>,
            Option<unsafe extern "C" fn(*mut us_internal_callback_t)>,
        >(cb);

        let uv_timer = cb_uv_timer(internal_cb);
        if ms == 0 {
            uv_timer_stop(uv_timer);
        } else {
            uv_timer_start(uv_timer, Some(timer_cb), ms as u64, repeat_ms as u64);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_loop(t: *mut us_timer_t) -> *mut us_loop_t {
    // SAFETY: `t` is a live timer from `us_create_timer`.
    unsafe { (*t.cast::<us_internal_callback_t>()).loop_ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Async (internal only)
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_create_async(
    loop_: *mut us_loop_t,
    _fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_internal_async {
    // SAFETY: fresh calloc'd block holding callback header + uv_async_t + ext.
    unsafe {
        let cb = calloc_or_oom(
            1,
            size_of::<us_internal_callback_t>() + size_of::<uv_async_t>() + ext_size as usize,
        )
        .cast::<us_internal_callback_t>();
        (*cb).loop_ = loop_;
        cb
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_close(a: *mut us_internal_async) {
    // SAFETY: `a` is a live async from `us_internal_create_async`.
    unsafe {
        let cb: *mut us_internal_callback_t = a;
        let uv_async = cb_uv_async(cb);

        // Always ref before closing.
        uv_ref(as_handle(uv_async));

        (*uv_async).data = cb.cast();
        uv_close(as_handle(uv_async), Some(close_cb_free));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_set(
    a: *mut us_internal_async,
    cb: Option<unsafe extern "C" fn(*mut us_internal_async)>,
) {
    // SAFETY: `a` is a live async from `us_internal_create_async`.
    unsafe {
        let internal_cb: *mut us_internal_callback_t = a;
        (*internal_cb).cb = cb;

        let uv_async = cb_uv_async(internal_cb);
        uv_async_init((*(*internal_cb).loop_).uv_loop, uv_async, Some(async_cb));
        uv_unref(as_handle(uv_async));
        (*uv_async).data = internal_cb.cast();
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_wakeup(a: *mut us_internal_async) {
    // SAFETY: `a` is a live async that has been `us_internal_async_set`.
    unsafe { uv_async_send(cb_uv_async(a)) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket error
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_get_error(s: *mut us_socket_t) -> c_int {
    let mut error: c_int = 0;
    let mut len: c_int = size_of::<c_int>() as c_int;
    // SAFETY: `s` is layout-prefixed with `us_poll_t`; getsockopt writes into
    // our locals only.
    unsafe {
        if getsockopt(
            us_poll_fd(s.cast()),
            SOL_SOCKET,
            SO_ERROR,
            (&raw mut error).cast(),
            &raw mut len,
        ) == -1
        {
            return *_errno();
        }
    }
    error
}
