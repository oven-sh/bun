//! Asynchronous `uv_fs_*` calls. Each takes the box that holds the request, and `then` gets it back.
#![cfg(windows)]

use core::ffi::{c_int, c_uint};
use core::mem::ManuallyDrop;

use bun_core::ffi::conjure_zst;
use bun_core::{IntrusiveField, ZStr};

use crate::libuv::{
    Loop, ReturnCode, ReturnCodeI64, StartResult, ULONG, fs_t, uv_buf_t, uv_file, uv_fs_cb,
    uv_fs_chmod, uv_fs_close, uv_fs_copyfile, uv_fs_fstat, uv_fs_open, uv_fs_read,
    uv_fs_req_cleanup, uv_fs_statfs, uv_fs_write, uv_stat_t, uv_statfs_t,
};

/// Cleaned up before its box is given back, so it can be moved, dropped or used again.
#[repr(transparent)]
pub struct Request(ManuallyDrop<fs_t>);

impl Default for Request {
    fn default() -> Self {
        Self(ManuallyDrop::new(bun_core::ffi::zeroed()))
    }
}

impl Request {
    /// What [`fstat`] wrote.
    pub fn statbuf(&self) -> &uv_stat_t {
        &self.0.statbuf
    }
}

/// # Safety
/// `call` returns the result of one asynchronous `uv_fs_*` call with the request, whose callback calls [`take`].
unsafe fn start<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    call: impl FnOnce(*const T, *mut fs_t) -> ReturnCode,
) -> StartResult<Box<T>> {
    let owner = bun_core::heap::into_raw(owner);
    // SAFETY: `owner` is live. libuv keeps nothing of a request that it refuses.
    unsafe {
        let req = T::field_of(owner).cast::<fs_t>();
        match call(owner, req) {
            rc if rc.is_err() => Err((take(req), rc)),
            _ => Ok(()),
        }
    }
}

/// # Safety
/// `req` came from `start::<T>`, libuv is done with it, and this is called once.
unsafe fn take<T: IntrusiveField<Request>>(req: *mut fs_t) -> Box<T> {
    // SAFETY: fn contract.
    unsafe {
        uv_fs_req_cleanup(req);
        bun_core::heap::take(T::from_field_ptr(req.cast()))
    }
}

/// libuv only tests for -1, and copies out of bounds of an `O::FILEMAP` view for a smaller offset.
fn clamp_offset(offset: i64) -> i64 {
    offset.max(-1)
}

/// `F` has no size, so the callback can make a copy of `_then`.
fn result_callback<T, F>(_then: F) -> uv_fs_cb
where
    T: IntrusiveField<Request>,
    F: Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
{
    unsafe extern "C" fn callback<T, F>(req: *mut fs_t)
    where
        T: IntrusiveField<Request>,
        F: Fn(Box<T>, ReturnCodeI64),
    {
        // SAFETY: libuv calls back once, with the request that `start::<T>` gave it.
        let (result, owner) = unsafe { ((*req).result, take(req)) };
        conjure_zst::<F>()(owner, result);
    }
    Some(callback::<T, F>)
}

pub fn open<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    path: &ZStr,
    flags: c_int,
    mode: c_int,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    // SAFETY: libuv copies `path`.
    unsafe {
        start(owner, |_, req| {
            uv_fs_open(loop_, req, path.as_ptr(), flags, mode, cb)
        })
    }
}

pub fn close<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    file: uv_file,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    // SAFETY: no other pointer is passed.
    unsafe { start(owner, |_, req| uv_fs_close(loop_, req, file, cb)) }
}

pub fn chmod<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    path: &ZStr,
    mode: c_int,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    // SAFETY: libuv copies `path`.
    unsafe {
        start(owner, |_, req| {
            uv_fs_chmod(loop_, req, path.as_ptr(), mode, cb)
        })
    }
}

pub fn copyfile<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    path: &ZStr,
    new_path: &ZStr,
    flags: c_int,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    // SAFETY: libuv copies both paths.
    unsafe {
        start(owner, |_, req| {
            uv_fs_copyfile(loop_, req, path.as_ptr(), new_path.as_ptr(), flags, cb)
        })
    }
}

pub fn fstat<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    file: uv_file,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    // SAFETY: no other pointer is passed.
    unsafe { start(owner, |_, req| uv_fs_fstat(loop_, req, file, cb)) }
}

pub fn statfs<T, F>(owner: Box<T>, loop_: &Loop, path: &ZStr, _then: F) -> StartResult<Box<T>>
where
    T: IntrusiveField<Request> + 'static,
    F: Fn(Box<T>, Result<uv_statfs_t, ReturnCode>) + Copy + 'static,
{
    unsafe extern "C" fn callback<T, F>(req: *mut fs_t)
    where
        T: IntrusiveField<Request>,
        F: Fn(Box<T>, Result<uv_statfs_t, ReturnCode>),
    {
        // SAFETY: as in `result_callback`. On success `ptr` is a `uv_statfs_t`, which `take` frees.
        let (result, owner) = unsafe {
            let read = |()| (*req).ptr_as::<uv_statfs_t>().read_unaligned();
            ((*req).result.into_result().map(read), take(req))
        };
        conjure_zst::<F>()(owner, result);
    }
    // SAFETY: libuv copies `path`.
    unsafe {
        start(owner, |_, req| {
            uv_fs_statfs(loop_, req, path.as_ptr(), Some(callback::<T, F>))
        })
    }
}

/// Appends at most `max_len` bytes to the `Vec` of `owner`, within its capacity.
pub fn read<T, F>(
    mut owner: Box<T>,
    loop_: &Loop,
    file: uv_file,
    max_len: usize,
    offset: i64,
    _then: F,
) -> StartResult<Box<T>>
where
    T: IntrusiveField<Request> + IntrusiveField<Vec<u8>> + 'static,
    F: Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
{
    unsafe extern "C" fn callback<T, F>(req: *mut fs_t)
    where
        T: IntrusiveField<Request> + IntrusiveField<Vec<u8>>,
        F: Fn(Box<T>, ReturnCodeI64),
    {
        // SAFETY: as in `result_callback`. libuv wrote `result` bytes into the spare capacity.
        let (result, owner) = unsafe {
            let (result, mut owner) = ((*req).result, take::<T>(req));
            if let Ok(len) = usize::try_from(result.int()) {
                bun_core::vec::commit_spare(owner.field_mut(), len);
            }
            (result, owner)
        };
        conjure_zst::<F>()(owner, result);
    }
    let spare = IntrusiveField::<Vec<u8>>::field_mut(&mut *owner).spare_capacity_mut();
    let buf = uv_buf_t {
        len: spare.len().min(max_len) as ULONG,
        base: spare.as_mut_ptr().cast(),
    };
    let cb: uv_fs_cb = Some(callback::<T, F>);
    let offset = clamp_offset(offset);
    // SAFETY: libuv copies `buf`, and has `owner`, which owns the bytes.
    unsafe {
        start(owner, |_, req| {
            uv_fs_read(loop_, req, file, &raw const buf, 1, offset, cb)
        })
    }
}

/// # Safety
/// `bufs` is valid for reads during this call. Until `then` is called or `Err` is returned, another
/// thread may write to the bytes that they name.
pub unsafe fn readv<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    file: uv_file,
    bufs: *const [uv_buf_t],
    offset: i64,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    let nbufs = c_uint::try_from(bufs.len()).expect("int cast");
    let offset = clamp_offset(offset);
    // SAFETY: fn contract. libuv copies `bufs`.
    unsafe {
        start(owner, |_, req| {
            uv_fs_read(loop_, req, file, bufs.cast(), nbufs, offset, cb)
        })
    }
}

pub fn write<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    file: uv_file,
    bytes: impl FnOnce(&T) -> &[u8],
    offset: i64,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    let offset = clamp_offset(offset);
    // SAFETY: libuv copies `buf`. The bytes are borrowed from `owner`, which nothing uses until `take`.
    unsafe {
        start(owner, |owner, req| {
            let buf = uv_buf_t::init(bytes(&*owner));
            uv_fs_write(loop_, req, file, &raw const buf, 1, offset, cb)
        })
    }
}

/// # Safety
/// `bufs` is valid for reads during this call. Until `then` is called or `Err` is returned, another
/// thread may read the bytes that they name.
pub unsafe fn writev<T: IntrusiveField<Request> + 'static>(
    owner: Box<T>,
    loop_: &Loop,
    file: uv_file,
    bufs: *const [uv_buf_t],
    offset: i64,
    then: impl Fn(Box<T>, ReturnCodeI64) + Copy + 'static,
) -> StartResult<Box<T>> {
    let cb = result_callback(then);
    let nbufs = c_uint::try_from(bufs.len()).expect("int cast");
    let offset = clamp_offset(offset);
    // SAFETY: fn contract. libuv copies `bufs`.
    unsafe {
        start(owner, |_, req| {
            uv_fs_write(loop_, req, file, bufs.cast(), nbufs, offset, cb)
        })
    }
}
