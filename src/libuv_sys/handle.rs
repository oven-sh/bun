//! Owners of libuv handles. Callbacks capture nothing: what they need is in [`Handle::data`].

use super::*;

use bun_core::ffi::conjure_zst;
use bun_core::{IntrusiveField, ZStr};
use bun_ptr::{AliasableBox, OptionCellExt as _, RefCounted, RefPtr};
use core::cell::UnsafeCell;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use open_handles::Link;

/// What a [`Handle`] keeps next to a kind of libuv handle.
pub trait HandleState: Default {
    /// `true` if libuv still uses the closed handle, and a frame up the stack frees it.
    fn defer_free(&self) -> bool {
        false
    }
}

impl HandleState for () {}

/// A reference proves that the handle is initialised, stays in place and has not been freed.
///
/// ```compile_fail,E0596
/// use bun_libuv_sys as uv;
/// let (mut a, mut b) = (uv::Timer::init(uv::Loop::get(), ()), uv::Timer::init(uv::Loop::get(), ()));
/// core::mem::swap(&mut *a, &mut *b);
/// ```
///
/// ```compile_fail,E0277
/// let _: bun_libuv_sys::Timer = bun_core::ffi::zeroed();
/// ```
#[repr(C)]
pub struct Handle<H: UvHandle, D = ()> {
    uv: UnsafeCell<H>,
    link: Link,
    state: H::State,
    /// Dropped once libuv is done with the handle, which can be after the VM is gone.
    pub data: D,
}

impl<H: UvHandle, D> Handle<H, D> {
    /// Covers all of `self`, so a callback can cast it back.
    fn as_ptr(&self) -> *mut H {
        ptr::from_ref(self).cast_mut().cast()
    }

    fn as_handle(&self) -> *mut uv_handle_t {
        self.as_ptr().cast()
    }

    /// `None` once the [`Owned`] was dropped, which sets `data`.
    ///
    /// # Safety
    /// `handle` came from `as_ptr`, and its close callback has not run.
    unsafe fn from_ptr_unless_dropped<'a>(handle: *mut c_void) -> Option<&'a Self> {
        // SAFETY: fn contract.
        unsafe { ((*handle.cast::<uv_handle_t>()).data.is_null()).then(|| &*handle.cast()) }
    }

    /// `EINVAL` for a handle that is closing, as from `uv_read_start`.
    fn unless_closing(&self, start: impl FnOnce(*mut H) -> ReturnCode) -> ReturnCode {
        if self.is_closing() {
            return ReturnCode(UV_EINVAL);
        }
        start(self.as_ptr())
    }

    /// Lists the handle for a thread's teardown, which calls `stop` and closes it if it is open.
    pub fn on_vm_teardown<F: Fn(&Self) + Copy + 'static>(&self, _stop: F) {
        /// # Safety
        /// `this` is a live `Handle<H, D>`.
        unsafe fn stop<H: UvHandle, D, F: Fn(&Handle<H, D>)>(this: *mut c_void) {
            // SAFETY: fn contract.
            let this = unsafe { &*this.cast::<Handle<H, D>>() };
            // A `uv_walk` closes what is listed, and then `F` could free it.
            if !this.is_closing() {
                conjure_zst::<F>()(this);
                this.close();
            }
        }
        self.link.remove();
        // SAFETY: `self` holds the link, and stays in place.
        unsafe { self.link.add_handle(self.as_ptr().cast(), stop::<H, D, F>) };
    }

    /// Does nothing the second time. The memory stays until the [`Owned`] is dropped too.
    pub fn close(&self) {
        self.link.remove();
        if !self.is_closing() {
            // SAFETY: initialised, and not closing.
            unsafe { uv_close(self.as_handle(), Some(Self::free_if_dropped)) };
        }
    }

    /// # Safety
    /// `handle` is the first field of a `Self` that is not on the loop.
    unsafe extern "C" fn free_if_dropped(handle: *mut uv_handle_t) {
        // SAFETY: fn contract. `data` is null, or the box that the dropped `Owned` held.
        unsafe {
            let this = (*handle).data.cast::<Self>();
            if !this.is_null() && !(*this).state.defer_free() {
                bun_core::heap::destroy(this);
            }
        }
    }

    /// Also `true` once it has closed.
    pub fn is_closing(&self) -> bool {
        // SAFETY: initialised.
        unsafe { uv_is_closing(self.as_handle()) != 0 }
    }

    pub fn is_closed(&self) -> bool {
        // SAFETY: initialised.
        unsafe { uv_is_closed(self.as_handle()) }
    }

    pub fn is_active(&self) -> bool {
        // SAFETY: initialised.
        unsafe { uv_is_active(self.as_handle()) != 0 }
    }

    pub fn ref_(&self) {
        // SAFETY: initialised. It reaches for the loop only while the handle is active.
        unsafe { uv_ref(self.as_handle()) };
    }

    pub fn unref(&self) {
        // SAFETY: as in `ref_`.
        unsafe { uv_unref(self.as_handle()) };
    }

    /// Panics once the handle has closed.
    pub fn get_loop(&self) -> &Loop {
        assert!(!self.is_closed());
        // SAFETY: `uv_loop_close` refuses a loop that has handles, and then it is not freed.
        unsafe { &*(*self.as_handle()).loop_ }
    }
}

/// A heap handle. Dropping it closes the handle, which is freed once libuv is done with it.
///
/// ```compile_fail,E0521
/// use bun_libuv_sys as uv;
/// fn borrowed(data: &u8) {
///     uv::Timer::init(uv::Loop::get(), data);
/// }
/// ```
///
/// ```compile_fail,E0277
/// use bun_libuv_sys as uv;
/// let timer = uv::Timer::init(uv::Loop::get(), ());
/// std::thread::spawn(move || drop(timer));
/// ```
#[repr(transparent)]
pub struct Owned<H: UvHandle, D = ()>(NonNull<Handle<H, D>>);

impl<H: UvHandle, D: 'static> Owned<H, D> {
    /// # Safety
    /// `init` has initialised the zeroed handle if it does not return an error.
    unsafe fn init(data: D, init: impl FnOnce(*mut H) -> ReturnCode) -> Result<Self, ReturnCode> {
        let this = Self(Box::into_non_null(Box::new(Handle {
            // SAFETY: the contract of `UvHandle`.
            uv: UnsafeCell::new(unsafe { bun_core::ffi::zeroed_unchecked() }),
            link: Link::new(),
            state: H::State::default(),
            data,
        })));
        init(this.0.as_ptr().cast()).into_result()?;
        Ok(this)
    }
}

impl<H: UvHandle, D> Owned<H, D> {
    pub fn leak(self) -> &'static Handle<H, D> {
        // SAFETY: nothing frees it.
        unsafe { ManuallyDrop::new(self).0.as_ref() }
    }
}

impl<H: UvHandle, D> core::ops::Deref for Owned<H, D> {
    type Target = Handle<H, D>;
    fn deref(&self) -> &Handle<H, D> {
        // SAFETY: live until `self` is dropped.
        unsafe { self.0.as_ref() }
    }
}

/// Leaks the box if a `uv_walk` is closing the handle, as that passes no close callback.
impl<H: UvHandle, D> Drop for Owned<H, D> {
    fn drop(&mut self) {
        self.link.remove();
        let handle = self.0.as_ptr().cast::<uv_handle_t>();
        // SAFETY: zeroed or initialised, and it is freed once it is off the loop.
        unsafe {
            // What `close` passed to libuv came from a shared borrow, which may not free.
            (*handle).data = handle.cast();
            if (*handle).loop_.is_null() || uv_is_closed(handle) {
                Handle::<H, D>::free_if_dropped(handle);
            } else if uv_is_closing(handle) == 0 {
                uv_close(handle, Some(Handle::<H, D>::free_if_dropped));
            }
        }
    }
}

impl Timer {
    pub fn init<D: 'static>(loop_: &Loop, data: D) -> Owned<Timer, D> {
        // SAFETY: a zeroed handle at its final address.
        unsafe { Owned::init(data, |timer| uv_timer_init(loop_, timer)) }
            .expect("internal error: uv_timer_init failed")
    }

    /// A timer that closes itself after `callback`.
    pub fn start_once<D: 'static, F>(loop_: &Loop, timeout: u64, data: D, _callback: F)
    where
        F: Fn(&D) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<D, F: Fn(&D)>(timer: *mut Timer) {
            // SAFETY: the box given up below, for a timer that fires once.
            let timer = Owned::<Timer, D>(unsafe { NonNull::new_unchecked(timer.cast()) });
            conjure_zst::<F>()(&timer.data);
        }
        let timer = ManuallyDrop::new(Timer::init(loop_, data));
        // SAFETY: initialised, and not closing.
        unsafe { uv_timer_start(timer.0.as_ptr().cast(), Some(thunk::<D, F>), timeout, 0) }
            .into_result()
            .expect("internal error: uv_timer_start failed");
    }
}

impl<D> Handle<Timer, D> {
    pub fn start<F>(&self, timeout: u64, repeat: u64, _callback: F)
    where
        F: Fn(&Self) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<D, F: Fn(&Handle<Timer, D>)>(timer: *mut Timer) {
            // SAFETY: the first field of a live `Handle`.
            conjure_zst::<F>()(unsafe { &*timer.cast() });
        }
        // SAFETY: initialised. libuv refuses a timer that is closing.
        unsafe { uv_timer_start(self.as_ptr(), Some(thunk::<D, F>), timeout, repeat) }
            .into_result()
            .expect("internal error: uv_timer_start failed");
    }

    pub fn stop(&self) {
        // SAFETY: initialised. It reaches for the loop only while the handle is active.
        unsafe { uv_timer_stop(self.as_ptr()) }
            .into_result()
            .expect("internal error: uv_timer_stop failed");
    }

    /// Panics once the handle has closed.
    pub fn get_due_in(&self) -> u64 {
        assert!(!self.is_closed());
        // SAFETY: initialised, and its loop is live as in `get_loop`.
        unsafe { uv_timer_get_due_in(self.as_ptr()) }
    }
}

impl uv_idle_t {
    pub fn init(loop_: &Loop) -> Owned<uv_idle_t> {
        // SAFETY: a zeroed handle at its final address.
        unsafe { Owned::init((), |idle| uv_idle_init(loop_, idle)) }
            .expect("internal error: uv_idle_init failed")
    }
}

impl Handle<uv_idle_t> {
    /// Keeps `uv_run` from blocking in its poll phase.
    pub fn start(&self) {
        extern "C" fn noop(_: *mut uv_idle_t) {}
        // SAFETY: initialised, and not closing.
        let _ = self.unless_closing(|idle| unsafe { uv_idle_start(idle, Some(noop)) });
    }

    pub fn stop(&self) {
        // SAFETY: initialised. It reaches for the loop only while the handle is active.
        let _ = unsafe { uv_idle_stop(self.as_ptr()) };
    }
}

impl uv_signal_t {
    pub fn start(
        loop_: &Loop,
        signum: c_int,
        callback: extern "C" fn(*mut uv_signal_t, c_int),
    ) -> Result<Owned<uv_signal_t>, ReturnCode> {
        // SAFETY: a zeroed handle at its final address, which is started once it is initialised.
        unsafe {
            let signal = Owned::init((), |signal| uv_signal_init(loop_, signal))?;
            uv_signal_start(signal.as_ptr(), Some(callback), signum).into_result()?;
            Ok(signal)
        }
    }
}

impl uv_fs_event_t {
    /// `callback` gets the file name, the events and the status.
    pub fn start<D: 'static, F>(
        loop_: &Loop,
        path: &ZStr,
        flags: c_uint,
        data: D,
        _callback: F,
    ) -> Result<Owned<uv_fs_event_t, D>, ReturnCode>
    where
        F: Fn(&Handle<uv_fs_event_t, D>, Option<&ZStr>, c_int, ReturnCode) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<D, F>(
            handle: *mut uv_fs_event_t,
            filename: *const c_char,
            events: c_int,
            status: ReturnCode,
        ) where
            F: Fn(&Handle<uv_fs_event_t, D>, Option<&ZStr>, c_int, ReturnCode),
        {
            // SAFETY: the first field of a live `Handle`, and null or a C string that lasts for the call.
            let (this, filename) = unsafe {
                let filename = (!filename.is_null()).then(|| bun_core::ffi::cstr(filename));
                (&*handle.cast(), filename.map(ZStr::from_cstr))
            };
            conjure_zst::<F>()(this, filename, events, status);
        }
        // SAFETY: a zeroed handle at its final address, which is started once it is initialised.
        // libuv copies `path`.
        unsafe {
            let this = Owned::init(data, |handle| uv_fs_event_init(loop_, handle))?;
            uv_fs_event_start(this.as_ptr(), Some(thunk::<D, F>), path.as_ptr(), flags)
                .into_result()?;
            Ok(this)
        }
    }
}

impl<D> Handle<uv_fs_event_t, D> {
    pub fn is_dir(&self) -> bool {
        // SAFETY: initialised.
        !unsafe { (*self.as_ptr()).dirw }.is_null()
    }

    /// Wyhash over `path ?? "null"`, `events` bytes, `filename`, `status` bytes.
    pub fn hash(&self, filename: &[u8], events: c_int, status: ReturnCode) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        // SAFETY: initialised.
        let path = unsafe { (*self.as_ptr()).path };
        if path.is_null() {
            hasher.update(b"null");
        } else {
            // SAFETY: a C string that libuv owns. It stores null when it frees it.
            hasher.update(unsafe { bun_core::ffi::cstr(path) }.to_bytes());
        }
        hasher.update(&events.to_ne_bytes());
        hasher.update(filename);
        hasher.update(&status.0.to_ne_bytes());
        hasher.final_()
    }
}

#[derive(Default)]
pub struct PollState {
    /// Number of poll callbacks for this handle on the stack. libuv reads the handle after each one.
    poll_cb_depth: Cell<u32>,
    /// A nested `uv_run` closed the dropped handle under such a callback.
    is_free_deferred: Cell<bool>,
}

impl HandleState for PollState {
    fn defer_free(&self) -> bool {
        self.is_free_deferred.set(self.poll_cb_depth.get() > 0);
        self.is_free_deferred.get()
    }
}

impl uv_poll_t {
    pub fn init_socket<D: 'static>(
        loop_: &Loop,
        socket: uv_os_sock_t,
        data: D,
    ) -> Result<Owned<uv_poll_t, D>, ReturnCode> {
        // SAFETY: a zeroed handle at its final address.
        unsafe { Owned::init(data, |poll| uv_poll_init_socket(loop_, poll, socket)) }
    }
}

impl<D: 'static> Handle<uv_poll_t, D> {
    /// `callback` gets the status and the events. It does not run once the handle is closing.
    pub fn start<F>(&self, events: c_int, _callback: F) -> ReturnCode
    where
        F: Fn(&Self, ReturnCode, c_int) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<D: 'static, F: Fn(&Handle<uv_poll_t, D>, ReturnCode, c_int)>(
            poll: *mut uv_poll_t,
            status: ReturnCode,
            events: c_int,
        ) {
            // SAFETY: the first field of a live `Handle`, which `poll_cb_depth` keeps.
            let this = unsafe { &*poll.cast::<Handle<uv_poll_t, D>>() };
            this.state.poll_cb_depth.update(|depth| depth + 1);
            conjure_zst::<F>()(this, status, events);
            this.state.poll_cb_depth.update(|depth| depth - 1);
            if this.state.poll_cb_depth.get() == 0 && this.state.is_free_deferred.get() {
                // SAFETY: `data` is the box that `free_if_dropped` left, and `loop_` is running.
                let (this, loop_) = unsafe {
                    let this = NonNull::new_unchecked((*poll).data.cast::<Handle<uv_poll_t, D>>());
                    (AliasableBox::from_non_null(this), &*(*poll).loop_)
                };
                Timer::start_once(loop_, 0, this, |_| {});
            }
        }
        // SAFETY: initialised, and not closing.
        self.unless_closing(|poll| unsafe { uv_poll_start(poll, events, Some(thunk::<D, F>)) })
    }
}

union StreamRequest {
    write: uv_write_t,
    connect: uv_connect_t,
}

pub struct StreamState {
    input: Cell<Vec<u8>>,
    /// `input`, from the alloc callback on. A console's line read writes to it past `uv_read_stop`, unreported.
    lent_input: Cell<Option<Vec<u8>>>,
    max_read_len: Cell<usize>,
    /// `Some` while libuv has `req`.
    output: Cell<Option<Vec<u8>>>,
    req: UnsafeCell<StreamRequest>,
}

impl Default for StreamState {
    fn default() -> Self {
        Self {
            input: Cell::default(),
            lent_input: Cell::new(None),
            max_read_len: Cell::new(usize::MAX),
            output: Cell::new(None),
            // SAFETY: integers, raw pointers and `Option<fn>`.
            req: UnsafeCell::new(unsafe { bun_core::ffi::zeroed_unchecked() }),
        }
    }
}

impl HandleState for StreamState {}

/// The callbacks can run after `close`, but not once the [`Owned`] was dropped.
impl<H: UvStream, D> Handle<H, D> {
    /// For a `uv_stdio_container_t`.
    pub fn as_stream(&self) -> *mut uv_stream_t {
        self.as_ptr().cast()
    }

    /// `INVALID_HANDLE_VALUE` if there is none.
    pub fn fd(&self) -> uv_os_fd_t {
        let mut fd = INVALID_HANDLE_VALUE;
        // SAFETY: initialised.
        let _ = unsafe { uv_fileno(self.as_handle(), &raw mut fd) };
        fd
    }

    /// What reads append to.
    pub fn input(&self) -> &Cell<Vec<u8>> {
        &self.state.input
    }

    pub fn set_max_read_len(&self, len: usize) {
        self.state.max_read_len.set(len);
    }

    /// `on_read` gets how much `input` has grown, or an error, after which reading has stopped.
    pub fn read_start<F>(&self, _on_read: F) -> ReturnCode
    where
        F: Fn(&Self, ReturnCodeI64) + Copy + 'static,
    {
        /// For a tty this also runs from inside `uv_read_start` and `uv_tty_set_mode`.
        unsafe extern "C" fn alloc<H: UvStream, D>(
            handle: *mut uv_handle_t,
            suggested_size: usize,
            buf: *mut uv_buf_t,
        ) {
            // SAFETY: the first field of a live `Handle`.
            let state = unsafe { &(*handle.cast::<Handle<H, D>>()).state };
            let mut input = state
                .lent_input
                .take()
                .unwrap_or_else(|| state.input.take());
            let max_len = state.max_read_len.get().min(ULONG::MAX as usize);
            input.reserve(suggested_size.min(max_len));
            let spare = input.spare_capacity_mut();
            let (len, base) = (spare.len().min(max_len) as ULONG, spare.as_mut_ptr().cast());
            state.lent_input.set(Some(input));
            // SAFETY: libuv's out-parameter.
            unsafe { *buf = uv_buf_t { len, base } };
        }
        unsafe extern "C" fn read<H, D, F>(
            stream: *mut uv_stream_t,
            nread: ReturnCodeI64,
            _: *const uv_buf_t,
        ) where
            H: UvStream,
            F: Fn(&Handle<H, D>, ReturnCodeI64),
        {
            // SAFETY: the first field of a live `Handle`.
            let Some(this) = (unsafe { Handle::<H, D>::from_ptr_unless_dropped(stream.cast()) })
            else {
                return;
            };
            if let Some(mut input) = this.state.lent_input.take() {
                if let Ok(len) = usize::try_from(nread.int()) {
                    // SAFETY: libuv wrote them to what `alloc` handed out.
                    unsafe { bun_core::vec::commit_spare(&mut input, len) };
                }
                this.state.input.set(input);
            }
            match nread.int() {
                // EAGAIN or canceled.
                0 => return,
                1.. => {}
                _ => this.read_stop(),
            }
            conjure_zst::<F>()(this, nread);
        }
        // SAFETY: initialised. libuv refuses a stream that is closing or not readable.
        unsafe { uv_read_start(self.as_stream(), Some(alloc::<H, D>), Some(read::<H, D, F>)) }
    }

    pub fn read_stop(&self) {
        // SAFETY: initialised. It does nothing unless the stream is being read.
        let _ = unsafe { uv_read_stop(self.as_stream()) };
    }

    pub fn try_write(&self, bytes: &[u8]) -> ReturnCode {
        let buf = uv_buf_t::init(bytes);
        // SAFETY: initialised, and `bytes` is not used after the call.
        unsafe { uv_try_write(self.as_stream(), &raw const buf, 1) }
    }

    /// # Safety
    /// On success `req` and the bytes of `buf` stay until `cb`.
    unsafe fn start_write(
        &self,
        req: *mut uv_write_t,
        buf: uv_buf_t,
        cb: unsafe extern "C" fn(*mut uv_write_t, ReturnCode),
    ) -> ReturnCode {
        // SAFETY: fn contract. libuv copies `buf`, and refuses a stream that is closing or not writable.
        let rc = unsafe {
            (*req).data = self.as_ptr().cast();
            uv_write(req, self.as_stream(), &raw const buf, 1, Some(cb))
        };
        log!("uv_write({}) = {}", buf.len, rc.int());
        rc
    }

    /// Writes `bytes[start..]`. Panics while the last `write` or `connect` is in flight.
    pub fn write<F>(&self, bytes: Vec<u8>, start: usize, _then: F) -> StartResult<Vec<u8>>
    where
        F: Fn(&Self, Vec<u8>, ReturnCode) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<H, D, F>(req: *mut uv_write_t, status: ReturnCode)
        where
            H: UvStream,
            F: Fn(&Handle<H, D>, Vec<u8>, ReturnCode),
        {
            // SAFETY: set by `start_write`. A handle closes after its requests.
            if let Some(this) = unsafe { Handle::<H, D>::from_ptr_unless_dropped((*req).data) } {
                let bytes = this.state.output.take().expect("set by `write`");
                conjure_zst::<F>()(this, bytes, status);
            }
        }
        assert!(self.state.output.is_none());
        let buf = uv_buf_t::init(&bytes[start..]);
        self.state.output.set(Some(bytes));
        let req = self.state.req.get();
        // SAFETY: both are in `self`, and nothing uses them while `output` is `Some`.
        unsafe { self.start_write(&raw mut (*req).write, buf, thunk::<H, D, F>) }
            .into_result()
            .map_err(|rc| (self.state.output.take().expect("set above"), rc))
    }

    /// Allocates the request, which holds `source`, so any number can be in flight.
    pub fn queue_write<T: 'static, F>(
        &self,
        source: T,
        bytes: impl FnOnce(&T) -> &[u8],
        _then: F,
    ) -> ReturnCode
    where
        F: Fn(&Self, ReturnCode) + Copy + 'static,
    {
        #[repr(C)]
        struct Request<T> {
            uv: uv_write_t,
            source: T,
        }
        unsafe extern "C" fn thunk<H: UvHandle, D, T, F: Fn(&Handle<H, D>, ReturnCode)>(
            req: *mut uv_write_t,
            status: ReturnCode,
        ) {
            // SAFETY: the box given up below, whose `data` is as in `write`.
            let (_req, this) = unsafe {
                let this = Handle::<H, D>::from_ptr_unless_dropped((*req).data);
                (bun_core::heap::take(req.cast::<Request<T>>()), this)
            };
            if let Some(this) = this {
                conjure_zst::<F>()(this, status);
            }
        }
        let uv = bun_core::ffi::zeroed();
        let req = bun_core::heap::into_raw(Box::new(Request { uv, source }));
        // SAFETY: nothing touches `*req` until it is a box again.
        unsafe {
            let buf = uv_buf_t::init(bytes(&(*req).source));
            let rc = self.start_write(req.cast(), buf, thunk::<H, D, T, F>);
            if rc.is_err() {
                bun_core::heap::destroy(req);
            }
            rc
        }
    }

    pub fn set_blocking(&self) -> ReturnCode {
        // SAFETY: initialised.
        unsafe { uv_stream_set_blocking(self.as_stream(), 1) }
    }
}

impl Pipe {
    /// A pipe for `uv_spawn` to open.
    pub fn init<D: 'static>(
        loop_: &Loop,
        ipc: bool,
        data: D,
    ) -> Result<Owned<Pipe, D>, ReturnCode> {
        // SAFETY: a zeroed handle at its final address.
        let this = unsafe { Owned::init(data, |pipe| uv_pipe_init(loop_, pipe, ipc.into())) }?;
        this.on_vm_teardown(|_| {});
        Ok(this)
    }

    /// The pipe owns `file` on `Ok`.
    pub fn open<D: 'static>(
        loop_: &Loop,
        ipc: bool,
        file: uv_file,
        data: D,
    ) -> Result<Owned<Pipe, D>, ReturnCode> {
        let this = Pipe::init(loop_, ipc, data)?;
        // SAFETY: initialised, and not open yet.
        unsafe { uv_pipe_open(this.as_ptr(), file) }.into_result()?;
        Ok(this)
    }

    pub fn connect<D: 'static, F>(
        loop_: &Loop,
        name: &ZStr,
        data: D,
        _then: F,
    ) -> Result<Owned<Pipe, D>, ReturnCode>
    where
        F: Fn(&Handle<Pipe, D>, ReturnCode) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<D, F: Fn(&Handle<Pipe, D>, ReturnCode)>(
            req: *mut uv_connect_t,
            status: ReturnCode,
        ) {
            // SAFETY: set below. A handle closes after its requests.
            if let Some(this) = unsafe { Handle::<Pipe, D>::from_ptr_unless_dropped((*req).data) } {
                this.state.output.set(None);
                conjure_zst::<F>()(this, status);
            }
        }
        let this = Pipe::init(loop_, false, data)?;
        // Marks the request as in flight.
        this.state.output.set(Some(Vec::new()));
        let pipe = this.as_ptr();
        let (name, len, flags) = (name.as_ptr().cast(), name.len(), UV_PIPE_NO_TRUNCATE);
        // SAFETY: initialised, and not open yet. `req` is as in `write`. libuv copies `name`.
        unsafe {
            let req = &raw mut (*this.state.req.get()).connect;
            (*req).data = pipe.cast();
            uv_pipe_connect2(req, pipe, name, len, flags, Some(thunk::<D, F>)).into_result()?;
        }
        Ok(this)
    }
}

impl<D> Handle<Pipe, D> {
    pub fn ipc_remote_pid(&self) -> DWORD {
        // SAFETY: zeroed, or written by libuv.
        unsafe { (*self.as_ptr()).pipe.conn.ipc_remote_pid }
    }
}

impl uv_tty_t {
    /// Not listed for a thread's teardown until `on_vm_teardown` is called.
    pub fn init<D: 'static>(
        loop_: &Loop,
        file: uv_file,
        data: D,
    ) -> Result<Owned<uv_tty_t, D>, ReturnCode> {
        // SAFETY: a zeroed handle at its final address.
        unsafe { Owned::init(data, |tty| uv_tty_init(loop_, tty, file, 0)) }
    }
}

impl<D> Handle<uv_tty_t, D> {
    pub fn set_mode(&self, mode: TtyMode) -> ReturnCode {
        // SAFETY: initialised. It reaches for the loop only while the tty is being read.
        unsafe { uv_tty_set_mode(self.as_ptr(), mode as _) }
    }
}

/// A `uv_pipe_t` on which `uv_listen` was called.
#[repr(transparent)]
pub struct ListeningPipe(Pipe);

impl ListeningPipe {
    /// `on_connection` does not run once the handle is closing.
    pub fn listen<D: 'static, F>(
        loop_: &Loop,
        name: &ZStr,
        backlog: c_int,
        data: D,
        _on_connection: F,
    ) -> Result<Owned<ListeningPipe, D>, ReturnCode>
    where
        F: Fn(&Handle<ListeningPipe, D>, ReturnCode) + Copy + 'static,
    {
        unsafe extern "C" fn thunk<D, F: Fn(&Handle<ListeningPipe, D>, ReturnCode)>(
            server: *mut uv_stream_t,
            status: ReturnCode,
        ) {
            // SAFETY: the first field of a live `Handle`.
            conjure_zst::<F>()(unsafe { &*server.cast() }, status);
        }
        // SAFETY: a zeroed handle at its final address, which is bound once it is initialised.
        // libuv copies `name`.
        unsafe {
            let this = Owned::init(data, |pipe: *mut Self| uv_pipe_init(loop_, pipe.cast(), 0))?;
            this.on_vm_teardown(|_| {});
            let pipe = this.as_ptr().cast::<Pipe>();
            uv_pipe_bind2(pipe, name.as_ptr().cast(), name.len(), UV_PIPE_NO_TRUNCATE)
                .into_result()?;
            uv_listen(pipe.cast(), backlog, Some(thunk::<D, F>)).into_result()?;
            Ok(this)
        }
    }
}

impl<D> Handle<ListeningPipe, D> {
    pub fn accept<C: 'static>(&self, data: C) -> Result<Owned<Pipe, C>, ReturnCode> {
        let client = Pipe::init(self.get_loop(), false, data)?;
        // SAFETY: a listening pipe, and one on its loop that is not open yet.
        self.unless_closing(|server| unsafe { uv_accept(server.cast(), client.as_stream()) })
            .into_result()?;
        Ok(client)
    }
}

/// A `uv_process_t` in a refcounted owner, on which libuv holds a ref until the handle has closed.
#[repr(C)]
pub struct Process {
    uv: UnsafeCell<uv_process_t>,
    link: Link,
    close_cb: Cell<uv_close_cb>,
}

impl Default for Process {
    fn default() -> Self {
        Self {
            // SAFETY: integers, raw pointers, `Option<fn>` and `HandleType::Unknown`.
            uv: UnsafeCell::new(unsafe { bun_core::ffi::zeroed_unchecked() }),
            link: Link::new(),
            close_cb: Cell::new(None),
        }
    }
}

impl Process {
    /// `None` before `spawn`, and once the handle has closed.
    fn open_handle(&self) -> Option<*mut uv_process_t> {
        let process = self.uv.get();
        // SAFETY: zeroed or initialised.
        unsafe { !(*process).loop_.is_null() && !uv_is_closed(process.cast()) }.then_some(process)
    }

    /// Sets `options.exit_cb`. `on_exit` gets the exit status and the signal.
    ///
    /// # Safety
    /// The pointers in `options` are valid for the call, and a stream in `options.stdio` is a pipe on
    /// `loop_` that nothing has opened or closed.
    pub unsafe fn spawn<T: RefCounted + 'static, F>(
        owner: &RefPtr<T>,
        field: impl FnOnce(&T) -> &Process,
        loop_: &Loop,
        options: &mut uv_process_options_t,
        _on_exit: F,
    ) -> ReturnCode
    where
        F: Fn(&RefPtr<T>, i64, c_int) + Copy + 'static,
    {
        unsafe extern "C" fn on_exit<T: RefCounted, F: Fn(&RefPtr<T>, i64, c_int)>(
            process: *mut uv_process_t,
            exit_status: i64,
            term_signal: c_int,
        ) {
            // SAFETY: the ref that `data` owns until `on_close`.
            let owner = ManuallyDrop::new(unsafe { RefPtr::from_raw((*process).data.cast::<T>()) });
            conjure_zst::<F>()(&owner, exit_status, term_signal);
        }
        unsafe extern "C" fn on_close<T: RefCounted>(process: *mut uv_handle_t) {
            // SAFETY: the ref that `data` owns; libuv calls this once.
            unsafe { RefPtr::decrement_strong_count((*process).data.cast::<T>()) };
        }
        /// # Safety
        /// `this` is a live `Process`.
        unsafe fn close(this: *mut c_void) {
            // SAFETY: fn contract.
            unsafe { &*this.cast::<Process>() }.close();
        }

        let this = field(owner);
        assert!(this.close_cb.replace(Some(on_close::<T>)).is_none());
        options.exit_cb = Some(on_exit::<T, F>);
        // SAFETY: fn contract. The ref keeps `*owner` alive and shared, and so what it lends in place.
        let rc = unsafe {
            (*this.uv.get()).data = owner.clone().into_raw().cast();
            uv_spawn(loop_, this.uv.get(), options)
        };
        if rc.is_err() {
            this.close();
        } else {
            let holder = ptr::from_ref(this).cast_mut().cast();
            // SAFETY: `this` holds the link, and stays in place as above.
            unsafe { this.link.add_handle(holder, close) };
        }
        rc
    }

    /// The child keeps running. Does nothing the second time.
    pub fn close(&self) {
        self.link.remove();
        if let Some(process) = self.open_handle() {
            // SAFETY: initialised.
            unsafe {
                if uv_is_closing(process.cast()) == 0 {
                    uv_close(process.cast(), self.close_cb.get());
                }
            }
        }
    }

    pub fn pid(&self) -> uv_pid_t {
        // SAFETY: zeroed or initialised. Off this thread libuv writes other fields only.
        unsafe { (*self.uv.get()).pid }
    }

    /// `None` once the handle has closed.
    pub fn process_handle(&self) -> Option<HANDLE> {
        let process = self.open_handle()?;
        // SAFETY: as in `pid`.
        Some(unsafe { (*process).process_handle })
    }

    /// `None` once the handle has closed.
    pub fn kill(&self, signum: c_int) -> Option<ReturnCode> {
        let process = self.open_handle()?;
        // SAFETY: initialised, and not closed.
        Some(unsafe { uv_process_kill(process, signum) })
    }

    pub fn ref_(&self) {
        if let Some(process) = self.open_handle() {
            // SAFETY: initialised, and not closed.
            unsafe { uv_ref(process.cast()) };
        }
    }

    pub fn unref(&self) {
        if let Some(process) = self.open_handle() {
            // SAFETY: initialised, and not closed.
            unsafe { uv_unref(process.cast()) };
        }
    }
}

/// The result of [`getaddrinfo`].
pub struct OwnedAddrInfo(NonNull<addrinfo>);

impl core::ops::Deref for OwnedAddrInfo {
    type Target = addrinfo;
    fn deref(&self) -> &addrinfo {
        // SAFETY: live until `self` is dropped.
        unsafe { self.0.as_ref() }
    }
}

impl Drop for OwnedAddrInfo {
    fn drop(&mut self) {
        // SAFETY: the list that libuv passed to the callback.
        unsafe { uv_freeaddrinfo(self.0.as_ptr()) };
    }
}

/// A field of the box that [`getaddrinfo`] takes.
#[repr(C)]
pub struct GetAddrInfoRequest {
    uv: uv_getaddrinfo_t,
    link: Link,
}

impl Default for GetAddrInfoRequest {
    fn default() -> Self {
        Self {
            // SAFETY: integers, raw pointers and `Option<fn>`.
            uv: unsafe { bun_core::ffi::zeroed_unchecked() },
            link: Link::new(),
        }
    }
}

/// `then` gets `owner` back.
pub fn getaddrinfo<T, F>(
    owner: Box<T>,
    loop_: &Loop,
    node: &ZStr,
    service: &ZStr,
    hints: Option<&addrinfo>,
    _then: F,
) -> StartResult<Box<T>>
where
    T: IntrusiveField<GetAddrInfoRequest> + 'static,
    F: Fn(Box<T>, Result<OwnedAddrInfo, ReturnCode>) + Copy + 'static,
{
    unsafe extern "C" fn thunk<T, F>(
        req: *mut uv_getaddrinfo_t,
        status: ReturnCode,
        res: *mut addrinfo,
    ) where
        T: IntrusiveField<GetAddrInfoRequest>,
        F: Fn(Box<T>, Result<OwnedAddrInfo, ReturnCode>),
    {
        let request = req.cast::<GetAddrInfoRequest>();
        // SAFETY: `req` is the first field of the request in the box given up below.
        let owner = unsafe {
            (*request).link.remove();
            bun_core::heap::take(T::from_field_ptr(request))
        };
        conjure_zst::<F>()(owner, NonNull::new(res).map(OwnedAddrInfo).ok_or(status));
    }
    /// # Safety
    /// `req` is in flight.
    unsafe fn cancel(req: *mut c_void) {
        // SAFETY: fn contract.
        let _ = unsafe { uv_cancel(req.cast()) };
    }

    let owner = bun_core::heap::into_raw(owner);
    // SAFETY: the request is libuv's until `owner` is a box again, and listed no longer than that.
    // libuv copies the other arguments, and keeps nothing of a call it refuses.
    unsafe {
        let request = T::field_of(owner);
        let (node, service) = (node.as_ptr(), service.as_ptr());
        let callback = thunk::<T, F>;
        let rc = uv_getaddrinfo(loop_, request.cast(), Some(callback), node, service, hints);
        if rc.is_err() {
            return Err((bun_core::heap::take(owner), rc));
        }
        (*request).link.add_request(request.cast(), cancel);
    }
    Ok(())
}

#[cfg(all(test, miri))]
#[path = "handle_tests.rs"]
mod tests;
