//! Typed async `uv_fs_*` requests whose `uv_fs_t` is embedded in a heap
//! `Box<T>` (see [`IntrusiveUvFs`]): libuv owns the box while the request is
//! in flight and the completion hands it back, so the owner's code never
//! touches a raw request pointer or a `this` that might already be freed.
//! While libuv has the box nothing can reach the `T` — the same guarantee as
//! a `&T` borrow held from submission to completion.

use core::ffi::{CStr, c_int};

use bun_sys::windows::libuv as uv;

use crate::IntrusiveUvFs;

/// An owner that opens a file through its embedded request.
pub trait OnFsOpen: IntrusiveUvFs + 'static {
    /// Loop thread: `uv_fs_open` completed with `result` (the fd, or a
    /// negative error code). The request has not been cleaned up.
    fn on_fs_open(this: Box<Self>, result: uv::ReturnCodeI64);
}

/// An owner that writes a file through its embedded request.
pub trait OnFsWrite: IntrusiveUvFs + 'static {
    /// Loop thread: `uv_fs_write` completed with `result` (bytes written, or
    /// a negative error code). The request has not been cleaned up.
    fn on_fs_write(this: Box<Self>, result: uv::ReturnCodeI64);
}

/// Which of `T`'s completions a submitted request reports to.
trait Completion<T> {
    fn done(owner: Box<T>, result: uv::ReturnCodeI64);
}
struct Open;
impl<T: OnFsOpen> Completion<T> for Open {
    fn done(owner: Box<T>, result: uv::ReturnCodeI64) {
        T::on_fs_open(owner, result)
    }
}
struct Write;
impl<T: OnFsWrite> Completion<T> for Write {
    fn done(owner: Box<T>, result: uv::ReturnCodeI64) {
        T::on_fs_write(owner, result)
    }
}

/// Hand `owner` to libuv through `start(owner, req, cb)` — one `uv_fs_*` call
/// on `owner`'s embedded request with the completion `cb` — and give it back
/// to `C::done` when `cb` fires. If libuv refuses the request, `owner` comes
/// straight back with the code.
fn submit<T: IntrusiveUvFs + 'static, C: Completion<T>>(
    owner: Box<T>,
    start: impl FnOnce(*mut T, *mut uv::fs_t, uv::uv_fs_cb) -> uv::ReturnCode,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    extern "C" fn on_done<T: IntrusiveUvFs + 'static, C: Completion<T>>(req: *mut uv::fs_t) {
        // SAFETY: `req` is the live request libuv just completed.
        let result = unsafe { (*req).result };
        // SAFETY: it is embedded in the `Box<T>` that `submit` released to
        // libuv, which calls back exactly once; nothing else holds that box.
        let owner = unsafe { bun_core::heap::take(T::from_uv_fs(req)) };
        C::done(owner, result);
    }
    let raw = bun_core::heap::into_raw(owner);
    let rc = start(
        raw,
        raw.wrapping_byte_add(T::UV_FS_OFFSET).cast(),
        Some(on_done::<T, C>),
    );
    if rc.int() < 0 {
        // SAFETY: libuv did not take the request, so the box is ours again.
        return Err((unsafe { bun_core::heap::take(raw) }, rc));
    }
    Ok(())
}

/// `uv_fs_open(path, flags, mode)` on this thread's loop through `owner`'s
/// request. libuv keeps `owner` until [`OnFsOpen::on_fs_open`] gets it back;
/// if libuv refuses the request it comes straight back with the code.
pub fn open<T: OnFsOpen>(
    owner: Box<T>,
    path: &CStr,
    flags: c_int,
    mode: c_int,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    submit::<T, Open>(owner, |_, req, cb| {
        // SAFETY: `req` is the request inside the live heap `T` just released,
        // at a fixed address until `cb` reclaims the box; libuv copies `path`
        // before returning.
        unsafe { uv::uv_fs_open(uv::Loop::get(), req, path.as_ptr(), flags, mode, cb) }
    })
}

/// `uv_fs_write(fd, data(&owner), offset)` on this thread's loop through
/// `owner`'s request. `data` picks the bytes out of the owner (or static
/// memory), so they stay put for as long as libuv has the box; libuv keeps
/// `owner` until [`OnFsWrite::on_fs_write`] gets it back, or hands it
/// straight back with the code if it refuses the request.
pub fn write<T: OnFsWrite>(
    owner: Box<T>,
    fd: uv::uv_file,
    data: fn(&T) -> &[u8],
    offset: i64,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    submit::<T, Write>(owner, |raw, req, cb| {
        // SAFETY: `raw` is the live heap `T` just released; shared read only.
        let buf = uv::uv_buf_t::init(data(unsafe { &*raw }));
        // SAFETY: `req` and the bytes `buf` points at (inside `*raw` or
        // static, per `data`'s signature) stay at fixed addresses, untouched,
        // until `cb` reclaims the box. libuv copies the one `uv_buf_t`
        // descriptor before returning.
        unsafe { uv::uv_fs_write(uv::Loop::get(), req, fd, &buf, 1, offset, cb) }
    })
}
