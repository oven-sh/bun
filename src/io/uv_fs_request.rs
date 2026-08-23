//! Typed async `uv_fs_*` requests whose `uv_fs_t` is embedded in a heap
//! `Box<T>` (see [`IntrusiveUvFs`]): libuv owns the box while the request is
//! in flight and the completion hands it back, so the owner's code never
//! touches a raw request pointer or a `this` that might already be freed.
//! While libuv has the box nothing can reach the `T` — the same guarantee as
//! a `&T` borrow held from submission to completion.

use core::ffi::{CStr, c_int, c_void};

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

/// An owner that reads a file into a `Vec<u8>` it holds through its embedded
/// request.
pub trait OnFsRead: IntrusiveUvFs + 'static {
    /// Loop thread: `uv_fs_read` completed with `result` (bytes read, or a
    /// negative error code). The bytes read are already appended to the
    /// `Vec` that [`read`] was given. The request has not been cleaned up.
    fn on_fs_read(this: Box<Self>, result: uv::ReturnCodeI64);
}

/// An owner that `fstat`s a file through its embedded request.
pub trait OnFsStat: IntrusiveUvFs + 'static {
    /// Loop thread: `uv_fs_fstat` completed with `result`; on success the
    /// request's `statbuf` is filled. The request has not been cleaned up.
    fn on_fs_stat(this: Box<Self>, result: uv::ReturnCodeI64);
}

/// An owner that copies a file through its embedded request.
pub trait OnFsCopyfile: IntrusiveUvFs + 'static {
    /// Loop thread: `uv_fs_copyfile` completed with `result`; on success the
    /// request's `statbuf` describes the source. The request has not been
    /// cleaned up.
    fn on_fs_copyfile(this: Box<Self>, result: uv::ReturnCodeI64);
}

/// An owner that `chmod`s a path through its embedded request.
pub trait OnFsChmod: IntrusiveUvFs + 'static {
    /// Loop thread: `uv_fs_chmod` completed with `result`. The request has
    /// not been cleaned up.
    fn on_fs_chmod(this: Box<Self>, result: uv::ReturnCodeI64);
}

/// Which of `T`'s completions a submitted request reports to.
trait Completion<T> {
    /// `data` is the request's `data` word as [`submit`]'s `start` left it.
    fn done(owner: Box<T>, data: *mut c_void, result: uv::ReturnCodeI64);
}
struct Open;
impl<T: OnFsOpen> Completion<T> for Open {
    fn done(owner: Box<T>, _: *mut c_void, result: uv::ReturnCodeI64) {
        T::on_fs_open(owner, result)
    }
}
struct Write;
impl<T: OnFsWrite> Completion<T> for Write {
    fn done(owner: Box<T>, _: *mut c_void, result: uv::ReturnCodeI64) {
        T::on_fs_write(owner, result)
    }
}
struct Stat;
impl<T: OnFsStat> Completion<T> for Stat {
    fn done(owner: Box<T>, _: *mut c_void, result: uv::ReturnCodeI64) {
        T::on_fs_stat(owner, result)
    }
}
struct Copyfile;
impl<T: OnFsCopyfile> Completion<T> for Copyfile {
    fn done(owner: Box<T>, _: *mut c_void, result: uv::ReturnCodeI64) {
        T::on_fs_copyfile(owner, result)
    }
}
struct Chmod;
impl<T: OnFsChmod> Completion<T> for Chmod {
    fn done(owner: Box<T>, _: *mut c_void, result: uv::ReturnCodeI64) {
        T::on_fs_chmod(owner, result)
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
        let (data, result) = unsafe { ((*req).data, (*req).result) };
        // SAFETY: it is embedded in the `Box<T>` that `submit` released to
        // libuv, which calls back exactly once; nothing else holds that box.
        let owner = unsafe { bun_core::heap::take(T::from_uv_fs(req)) };
        C::done(owner, data, result);
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

struct Read<T: OnFsRead>(core::marker::PhantomData<T>);

/// `req.data` while a [`read`] is in flight (the word libuv never touches):
/// the `Vec` libuv is filling — moved out of the owner for the duration, so
/// the buffer libuv writes to is exactly the one whose length is bumped —
/// how much spare room it was granted, and where to put it back.
struct ReadTarget<T> {
    vec: Vec<u8>,
    granted: usize,
    put_back: fn(&mut T) -> &mut Vec<u8>,
}

impl<T: OnFsRead> Completion<T> for Read<T> {
    fn done(mut owner: Box<T>, data: *mut c_void, result: uv::ReturnCodeI64) {
        // SAFETY: `read` boxed this `ReadTarget<T>` into `req.data` for exactly
        // this completion; it is reclaimed once, here.
        let mut target = unsafe { bun_core::heap::take(data.cast::<ReadTarget<T>>()) };
        if result.int() > 0 {
            let filled = usize::try_from(result.int()).expect("int cast");
            assert!(filled <= target.granted);
            // SAFETY: libuv was handed `granted` bytes of `target.vec`'s spare
            // capacity (untouched since) and initialized the first `filled`.
            unsafe { target.vec.set_len(target.vec.len() + filled) };
        }
        *(target.put_back)(&mut owner) = target.vec;
        T::on_fs_read(owner, result)
    }
}

/// `uv_fs_read(fd, offset)` into the spare capacity of `buffer(&mut owner)`
/// (at most `max_len` bytes) on this thread's loop through `owner`'s request.
/// That `Vec` is moved out of the owner while libuv has it and stored back
/// through `buffer`, with the bytes read appended, before
/// [`OnFsRead::on_fs_read`] gets `owner` back; if libuv refuses the request
/// `owner` comes straight back (its `Vec` restored) with the code.
pub fn read<T: OnFsRead>(
    mut owner: Box<T>,
    fd: uv::uv_file,
    buffer: fn(&mut T) -> &mut Vec<u8>,
    max_len: usize,
    offset: i64,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    let vec = core::mem::take(buffer(&mut owner));
    let granted = (vec.capacity() - vec.len())
        .min(max_len)
        .min(uv::ULONG::MAX as usize);
    let mut target = Box::new(ReadTarget::<T> {
        vec,
        granted,
        put_back: buffer,
    });
    let buf = uv::uv_buf_t {
        len: granted as uv::ULONG,
        base: target.vec.spare_capacity_mut().as_mut_ptr().cast::<u8>(),
    };
    let target = bun_core::heap::into_raw(target);
    submit::<T, Read<T>>(owner, |_, req, cb| {
        // SAFETY: `req` (inside the heap `T` just released) and the spare
        // capacity `buf` points at (the heap buffer of `target.vec`) stay at
        // fixed addresses, untouched, until `cb` reclaims both boxes; libuv
        // copies the one `uv_buf_t` descriptor before returning.
        unsafe {
            (*req).data = target.cast();
            uv::uv_fs_read(uv::Loop::get(), req, fd, &buf, 1, offset, cb)
        }
    })
    .map_err(|(mut owner, rc)| {
        // SAFETY: libuv refused the request, so `Read::done` will never
        // reclaim `target`; it is still ours.
        let target = unsafe { bun_core::heap::take(target) };
        *(target.put_back)(&mut owner) = target.vec;
        (owner, rc)
    })
}

/// `uv_fs_fstat(fd)` on this thread's loop through `owner`'s request; libuv
/// keeps `owner` until [`OnFsStat::on_fs_stat`] gets it back, or hands it
/// straight back with the code if it refuses the request.
pub fn fstat<T: OnFsStat>(owner: Box<T>, fd: uv::uv_file) -> Result<(), (Box<T>, uv::ReturnCode)> {
    submit::<T, Stat>(owner, |_, req, cb| {
        // SAFETY: `req` is the request inside the live heap `T` just released,
        // at a fixed address until `cb` reclaims the box.
        unsafe { uv::uv_fs_fstat(uv::Loop::get(), req, fd, cb) }
    })
}

/// `uv_fs_copyfile(src, dest, flags)` on this thread's loop through `owner`'s
/// request; libuv keeps `owner` until [`OnFsCopyfile::on_fs_copyfile`] gets it
/// back, or hands it straight back with the code if it refuses the request.
pub fn copyfile<T: OnFsCopyfile>(
    owner: Box<T>,
    src: &CStr,
    dest: &CStr,
    flags: c_int,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    submit::<T, Copyfile>(owner, |_, req, cb| {
        // SAFETY: `req` is the request inside the live heap `T` just released,
        // at a fixed address until `cb` reclaims the box; libuv copies both
        // paths before returning.
        unsafe { uv::uv_fs_copyfile(uv::Loop::get(), req, src.as_ptr(), dest.as_ptr(), flags, cb) }
    })
}

/// `uv_fs_chmod(path, mode)` on this thread's loop through `owner`'s
/// request; libuv keeps `owner` until [`OnFsChmod::on_fs_chmod`] gets it
/// back, or hands it straight back with the code if it refuses the request.
pub fn chmod<T: OnFsChmod>(
    owner: Box<T>,
    path: &CStr,
    mode: c_int,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    submit::<T, Chmod>(owner, |_, req, cb| {
        // SAFETY: `req` is the request inside the live heap `T` just released,
        // at a fixed address until `cb` reclaims the box; libuv copies `path`
        // before returning.
        unsafe { uv::uv_fs_chmod(uv::Loop::get(), req, path.as_ptr(), mode, cb) }
    })
}
