//! Typed one-shot libuv fs requests: a heap object that embeds its
//! `uv_fs_t`, is owned by libuv while the request is in flight, and comes
//! back as a `Box` when it completes.

use core::ffi::c_int;

use bun_core::ZStr;
use bun_sys::windows::libuv as uv;

/// A heap object with an embedded [`uv::OwnedFsReq`].
///
/// The submitters below take it as a `Box`, hand the allocation to libuv for
/// the duration of the request (nothing else may touch it meanwhile), and give
/// it back to [`on_complete`](Self::on_complete) on the loop thread once libuv
/// has filled in `req().result` (and, per op, `req()`'s result accessors).
pub trait UvFsRequest: Sized + 'static {
    fn req(&mut self) -> &mut uv::OwnedFsReq;
    fn on_complete(this: Box<Self>);
}

/// I/O parameters for [`read`]/[`write`], read off the boxed owner once it is
/// at its final address: `(request, fd, buffers, position)` in one split
/// borrow (`position` is `-1` for the current one). libuv copies the
/// descriptor array before returning; the memory the descriptors cover must
/// stay valid and otherwise untouched until completion, which the owner
/// guarantees by holding (and, for JS-backed buffers, pinning) it — the
/// `PlatformIoVec` convention used by every vectored-I/O entry point in
/// `bun_sys`.
pub trait UvFsIo: UvFsRequest {
    fn io_parts(&mut self) -> (&mut uv::OwnedFsReq, uv::uv_file, IoBufs<'_>, i64);
}

pub enum IoBufs<'a> {
    One(uv::uv_buf_t),
    Many(&'a [uv::uv_buf_t]),
}

impl IoBufs<'_> {
    #[inline]
    fn as_slice(&self) -> &[uv::uv_buf_t] {
        match self {
            IoBufs::One(b) => core::slice::from_ref(b),
            IoBufs::Many(s) => s,
        }
    }
}

extern "C" fn on_uv_fs_done<T: UvFsRequest>(req: *mut uv::fs_t) {
    // SAFETY: `req.data` is the `Box<T>` released in `start`; libuv is done
    // with the request, so ownership returns here exactly once.
    let owner: Box<T> = unsafe { bun_core::heap::take((*req).data.cast::<T>()) };
    T::on_complete(owner);
}

/// Release `owner` to libuv and run `submit` on its embedded request. A
/// submission error comes back synchronously as `Err((owner, rc))` with
/// `req().result` also holding `rc` — libuv will not call back in that case.
fn start<T: UvFsRequest>(
    owner: Box<T>,
    submit: impl FnOnce(*mut uv::Loop, *mut uv::fs_t, uv::uv_fs_cb) -> uv::ReturnCode,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    let raw: *mut T = bun_core::heap::into_raw(owner);
    // SAFETY: `raw` is the live allocation released above; exclusive here.
    let req: *mut uv::fs_t = unsafe {
        let req: &mut uv::fs_t = (*raw).req();
        req.data = raw.cast();
        req
    };
    let rc = submit(uv::Loop::get(), req, Some(on_uv_fs_done::<T>));
    if rc.is_err() {
        // SAFETY: libuv rejected the request and will not call back; reclaim.
        let mut owner = unsafe { bun_core::heap::take(raw) };
        owner.req().result = rc.into();
        return Err((owner, rc));
    }
    Ok(())
}

/// `uv_fs_open`; libuv copies `path` before returning.
pub fn open<T: UvFsRequest>(
    owner: Box<T>,
    path: &ZStr,
    flags: c_int,
    mode: c_int,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    start(owner, |l, req, cb| {
        // SAFETY: `req` is the owner's embedded request; `path` is NUL-terminated.
        unsafe { uv::uv_fs_open(l, req, path.as_ptr(), flags, mode, cb) }
    })
}

/// `uv_fs_close`.
pub fn close<T: UvFsRequest>(
    owner: Box<T>,
    fd: uv::uv_file,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    // SAFETY: `req` is the owner's embedded request.
    start(owner, |l, req, cb| unsafe {
        uv::uv_fs_close(l, req, fd, cb)
    })
}

/// `uv_fs_statfs`; libuv copies `path` before returning. Read the result with
/// `req().statfs_result()`.
pub fn statfs<T: UvFsRequest>(owner: Box<T>, path: &ZStr) -> Result<(), (Box<T>, uv::ReturnCode)> {
    start(owner, |l, req, cb| {
        // SAFETY: `req` is the owner's embedded request; `path` is NUL-terminated.
        unsafe { uv::uv_fs_statfs(l, req, path.as_ptr(), cb) }
    })
}

fn start_io<T: UvFsIo>(
    owner: Box<T>,
    op: unsafe extern "C" fn(
        *mut uv::Loop,
        *mut uv::fs_t,
        uv::uv_file,
        *const uv::uv_buf_t,
        core::ffi::c_uint,
        i64,
        uv::uv_fs_cb,
    ) -> uv::ReturnCode,
) -> Result<(), (Box<T>, uv::ReturnCode)> {
    let raw: *mut T = bun_core::heap::into_raw(owner);
    // SAFETY: `raw` is the live allocation released above; exclusive here (one
    // `&mut` reborrow, split by `io_parts`). The descriptor array is copied by
    // libuv during the call; what it describes is kept valid by `*raw` until
    // completion (see `UvFsIo`).
    let rc = unsafe {
        let owner: &mut T = &mut *raw;
        let (req, fd, bufs, position) = owner.io_parts();
        req.data = raw.cast();
        let req: *mut uv::fs_t = &mut **req;
        let slice = bufs.as_slice();
        let (ptr, len) = (slice.as_ptr(), slice.len());
        op(
            uv::Loop::get(),
            req,
            fd,
            ptr,
            core::ffi::c_uint::try_from(len).expect("int cast"),
            position,
            Some(on_uv_fs_done::<T>),
        )
    };
    if rc.is_err() {
        // SAFETY: libuv rejected the request and will not call back; reclaim.
        let mut owner = unsafe { bun_core::heap::take(raw) };
        owner.req().result = rc.into();
        return Err((owner, rc));
    }
    Ok(())
}

/// `uv_fs_read` into the owner's buffers.
pub fn read<T: UvFsIo>(owner: Box<T>) -> Result<(), (Box<T>, uv::ReturnCode)> {
    start_io(owner, uv::uv_fs_read)
}

/// `uv_fs_write` from the owner's buffers.
pub fn write<T: UvFsIo>(owner: Box<T>) -> Result<(), (Box<T>, uv::ReturnCode)> {
    start_io(owner, uv::uv_fs_write)
}
