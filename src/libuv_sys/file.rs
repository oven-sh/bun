//! A file descriptor and the one `uv_fs_t` that reads, writes and closes it.

use super::*;

use bun_core::ffi::conjure_zst;
use core::cell::UnsafeCell;
use core::ptr::NonNull;
use open_handles::Link;

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    Idle,
    Operating,
    Canceling,
}

/// Shared borrows only: a pool thread writes `fs` while an operation is in flight.
#[repr(C)]
struct File<D> {
    fs: UnsafeCell<fs_t>,
    link: Link,
    loop_: &'static Loop,
    file: uv_file,
    state: Cell<State>,
    is_dropped: Cell<bool>,
    close_on_drop: Cell<bool>,
    /// What the operation in flight reads to or writes from.
    buffer: Cell<Vec<u8>>,
    data: Cell<D>,
}

impl<D> File<D> {
    fn finish(self: Box<Self>) {
        unsafe extern "C" fn on_close<D>(fs: *mut fs_t) {
            // SAFETY: the box given up below.
            unsafe { bun_core::heap::destroy(fs.cast::<File<D>>()) };
        }
        if self.close_on_drop.get() {
            let file = self.file;
            let fs = bun_core::heap::into_raw(self).cast::<fs_t>();
            // SAFETY: `fs` is the first field of a box that lives until `on_close`.
            unsafe { uv_fs_close(Loop::get(), fs, file, Some(on_close::<D>)) };
        }
    }
}

/// An operation in flight keeps the memory past the drop, but its callback does not run.
pub struct OwnedFile<D>(NonNull<File<D>>);

impl<D> OwnedFile<D> {
    fn get(&self) -> &File<D> {
        // SAFETY: live until `self` is dropped.
        unsafe { self.0.as_ref() }
    }

    pub fn file(&self) -> uv_file {
        self.get().file
    }

    pub fn data(&self) -> &Cell<D> {
        &self.get().data
    }

    pub fn is_busy(&self) -> bool {
        self.get().state.get() != State::Idle
    }

    pub fn set_close_on_drop(&self, value: bool) {
        self.get().close_on_drop.set(value);
    }

    /// The callback gets `UV_ECANCELED`, or the result if it is too late to cancel.
    pub fn cancel(&self) {
        let state = &self.get().state;
        // SAFETY: `fs`, the first field, is a request in flight.
        if state.get() == State::Operating && unsafe { uv_cancel(self.0.as_ptr().cast()) } == 0 {
            state.set(State::Canceling);
        }
    }
}

impl<D: Copy + 'static> OwnedFile<D> {
    pub fn new(loop_: &'static Loop, file: uv_file, data: D) -> Self {
        Self(Box::into_non_null(Box::new(File {
            fs: UnsafeCell::new(bun_core::ffi::zeroed()),
            link: Link::default(),
            loop_,
            file,
            state: Cell::new(State::Idle),
            is_dropped: Cell::new(false),
            close_on_drop: Cell::new(false),
            buffer: Cell::default(),
            data: Cell::new(data),
        })))
    }

    /// A thread's teardown calls `stop`. Panics the second time.
    pub fn on_vm_teardown<F: Fn(D) + Copy + 'static>(&self, _stop: F) {
        /// # Safety
        /// `this` is a live `File<D>`.
        unsafe fn stop<D: Copy, F: Fn(D)>(this: *mut c_void) {
            // SAFETY: fn contract.
            conjure_zst::<F>()(unsafe { (*this.cast::<File<D>>()).data.get() });
        }
        let link = &self.get().link;
        // SAFETY: the box stays in place, and `drop` removes the link.
        unsafe { link.add_handle(self.0.as_ptr().cast(), stop::<D, F>) };
    }

    /// Appends at most `max_len` bytes to `buffer`, within its capacity. Panics while it is busy.
    pub fn read<F>(
        &self,
        mut buffer: Vec<u8>,
        max_len: usize,
        offset: Option<usize>,
        then: F,
    ) -> StartResult<Vec<u8>>
    where
        F: Fn(D, Vec<u8>, ReturnCodeI64) + Copy + 'static,
    {
        let spare = buffer.spare_capacity_mut();
        let buf = uv_buf_t {
            len: spare.len().min(max_len) as ULONG,
            base: spare.as_mut_ptr().cast(),
        };
        let offset = offset.map_or(-1, |offset| i64::try_from(offset).expect("int cast"));
        // SAFETY: `buf` is the spare capacity of `buffer`.
        unsafe { self.start::<true, F>(buffer, buf, offset, then) }
    }

    /// Writes `bytes[start..]` at the current position. Panics while it is busy.
    pub fn write<F>(&self, bytes: Vec<u8>, start: usize, then: F) -> StartResult<Vec<u8>>
    where
        F: Fn(D, Vec<u8>, ReturnCodeI64) + Copy + 'static,
    {
        let buf = uv_buf_t::init(&bytes[start..]);
        // SAFETY: `buf` is in `bytes`.
        unsafe { self.start::<false, F>(bytes, buf, -1, then) }
    }

    /// # Safety
    /// `buf` is in `buffer`. For a read it starts at the spare capacity. `offset` is at least -1.
    unsafe fn start<const READ: bool, F>(
        &self,
        buffer: Vec<u8>,
        buf: uv_buf_t,
        offset: i64,
        _then: F,
    ) -> StartResult<Vec<u8>>
    where
        F: Fn(D, Vec<u8>, ReturnCodeI64) + Copy + 'static,
    {
        /// # Safety
        /// libuv has refused the operation, or is calling its callback.
        unsafe fn complete<D>(this: &File<D>) -> Vec<u8> {
            // SAFETY: fn contract: no pool thread has `fs`.
            unsafe { uv_fs_req_cleanup(this.fs.get()) };
            this.state.set(State::Idle);
            this.buffer.take()
        }
        unsafe extern "C" fn thunk<const READ: bool, D: Copy, F: Fn(D, Vec<u8>, ReturnCodeI64)>(
            fs: *mut fs_t,
        ) {
            let this = fs.cast::<File<D>>();
            // SAFETY: the first field of the box, which is this callback's once its owner is gone.
            // A read has written as many bytes as it reports.
            let (data, buffer, result) = unsafe {
                let result = (*fs).result;
                let mut buffer = complete(&*this);
                if (*this).is_dropped.get() {
                    return bun_core::heap::take(this).finish();
                }
                if READ && let Ok(len) = usize::try_from(result.int()) {
                    bun_core::vec::commit_spare(&mut buffer, len);
                }
                ((*this).data.get(), buffer, result)
            };
            conjure_zst::<F>()(data, buffer, result);
        }

        let this = self.get();
        assert!(this.state.replace(State::Operating) == State::Idle);
        this.buffer.set(buffer);
        let (loop_, fs, file) = (this.loop_, self.0.as_ptr().cast(), this.file);
        let call = if READ { uv_fs_read } else { uv_fs_write };
        let cb = thunk::<READ, D, F>;
        // SAFETY: fn contract. A busy file and its buffer stay until `complete`, and libuv copies `buf`.
        unsafe {
            call(loop_, fs, file, &raw const buf, 1, offset, Some(cb))
                .into_result()
                .map_err(|rc| (complete(this), rc))
        }
    }
}

impl<D> Drop for OwnedFile<D> {
    fn drop(&mut self) {
        self.get().link.remove();
        if self.is_busy() {
            self.get().is_dropped.set(true);
        } else {
            // SAFETY: the box `new` made, which libuv is not using.
            unsafe { bun_core::heap::take(self.0.as_ptr()) }.finish();
        }
    }
}
