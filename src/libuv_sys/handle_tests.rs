//! For Miri, which calls the functions of [`fake`] in place of libuv's. They cite the lines of libuv's `src/` that they model.

use super::*;
use bun_core::ffi::zeroed_unchecked;
use bun_ptr::VecCellExt as _;
use std::rc::Rc;

/// Touches a handle or a request whenever libuv may, so that Miri reports one that was freed or moved.
mod fake {
    use super::*;
    use core::cell::RefCell;

    const CLOSING: c_uint = 1;
    const ACTIVE: c_uint = 4;
    const WRITABLE: c_uint = 0x8000;
    const UV_FS: uv_req_type = 6;

    #[derive(Copy, Clone, PartialEq, Default)]
    pub(super) enum Failure {
        #[default]
        None,
        BeforeInit,
        AfterInit,
    }

    thread_local! {
        static HANDLES: RefCell<Vec<*mut uv_handle_t>> = const { RefCell::new(Vec::new()) };
        static LOOKUPS: RefCell<Vec<*mut uv_getaddrinfo_t>> = const { RefCell::new(Vec::new()) };
        /// Each completes a request.
        static REQUESTS: RefCell<Vec<Box<dyn FnOnce()>>> = const { RefCell::new(Vec::new()) };
        /// The tty, the buffer, and whether the read was cancelled. libuv has one per process (win/tty.c:85).
        static LINE_READ: Cell<Option<(*mut uv_stream_t, uv_buf_t, bool)>> = const { Cell::new(None) };
        pub(super) static WRITTEN: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        pub(super) static CLOSED_FILES: Cell<u32> = const { Cell::new(0) };
        /// What the next call that can fail does.
        pub(super) static FAILURE: Cell<Failure> = const { Cell::new(Failure::None) };
    }

    fn handles(type_: HandleType) -> Vec<*mut uv_handle_t> {
        let mut handles = HANDLES.with_borrow(Vec::clone);
        // SAFETY: test stub; `handle.rs` passes a live handle.
        handles.retain(|&h| unsafe { (*h).type_ == type_ && (*h).flags & ACTIVE != 0 });
        handles
    }

    /// uv-common.h:332.
    unsafe fn init<H>(loop_: &Loop, handle: *mut H, type_: HandleType) -> ReturnCode {
        let failure = FAILURE.take();
        if failure == Failure::BeforeInit {
            return ReturnCode(UV_EBADF);
        }
        let handle = handle.cast::<uv_handle_t>();
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe { ((*handle).loop_, (*handle).type_) = (loop_.as_ptr(), type_) };
        HANDLES.with_borrow_mut(|handles| handles.push(handle));
        ReturnCode(if failure == Failure::AfterInit {
            UV_EBADF
        } else {
            0
        })
    }

    /// Replaces the listed pointer, as libuv finds a handle through what the last call gave it.
    unsafe fn set_active<H>(handle: *mut H) -> ReturnCode {
        let handle = handle.cast::<uv_handle_t>();
        HANDLES.with_borrow_mut(|all| *all.iter_mut().find(|h| **h == handle).unwrap() = handle);
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe {
            assert!((*handle).flags & CLOSING == 0);
            (*handle).flags |= ACTIVE;
        }
        ReturnCode::ZERO
    }

    /// One turn of the loop: requests, close callbacks, timers (win/core.c:802-815).
    pub(super) fn run() {
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe {
            // win/getaddrinfo.c:215.
            for req in LOOKUPS.take() {
                let status = (*req).retcode;
                let res = match status.int() {
                    0 => Box::into_raw(Box::new(zeroed_unchecked())),
                    _ => ptr::null_mut(),
                };
                (*req).getaddrinfo_cb.unwrap()(req, status, res);
            }
            for complete in REQUESTS.take() {
                complete();
            }
            // win/handle-inl.h:76, win/tty.c:2321.
            while let Some(handle) = HANDLES.with_borrow_mut(|handles| {
                let reading = LINE_READ.get().map(|read| read.0.cast());
                let index = handles
                    .iter()
                    .position(|&h| (*h).flags & CLOSING != 0 && Some(h) != reading)?;
                Some(handles.remove(index))
            }) {
                (*handle).flags |= UV_HANDLE_CLOSED;
                if let Some(close_cb) = (*handle).close_cb {
                    close_cb(handle);
                }
            }
            // timer.c:181,192.
            for timer in handles(HandleType::Timer) {
                (*timer).flags &= !ACTIVE;
                (*timer.cast::<Timer>()).timer_cb.unwrap()(timer.cast());
            }
        }
    }

    /// What `close_walk_cb` does to the handles that are left.
    pub(super) fn close_all_without_callback() {
        for handle in HANDLES.with_borrow(Vec::clone) {
            if uv_is_closing(handle) == 0 {
                uv_close(handle, None);
            }
        }
    }

    /// The handle is used after its callback (win/poll.c:233-243). None runs after a close (:205,591).
    pub(super) fn fire_polls() {
        for poll in handles(HandleType::Poll) {
            let poll = poll.cast::<uv_poll_t>();
            // SAFETY: test stub; `handle.rs` passes a live handle.
            unsafe {
                (*poll).poll_cb.unwrap()(poll, ReturnCode::ZERO, UV_READABLE);
                (*poll).submitted_events_1 = (*poll).events;
            }
        }
    }

    /// win/pipe.c:2316. None runs after a close (:2303).
    pub(super) fn fire_connections() {
        for server in handles(HandleType::NamedPipe) {
            let server = server.cast::<uv_stream_t>();
            // SAFETY: test stub; `handle.rs` passes a live handle.
            unsafe { (*server).stream.serv.connection_cb.unwrap()(server, ReturnCode::ZERO) };
        }
    }

    /// win/process.c:852. None runs after a close (:828).
    pub(super) fn exit_processes() {
        for process in handles(HandleType::Process) {
            let process = process.cast::<uv_process_t>();
            // SAFETY: test stub; `handle.rs` passes a live handle.
            unsafe { (*process).exit_cb.unwrap()(process, 3, 0) };
        }
    }

    fn request(complete: impl FnOnce() + 'static) -> ReturnCode {
        if FAILURE.take() != Failure::None {
            return ReturnCode(UV_EINVAL);
        }
        REQUESTS.with_borrow_mut(|requests| requests.push(Box::new(complete)));
        ReturnCode::ZERO
    }

    unsafe fn alloc(stream: *mut uv_stream_t) -> uv_buf_t {
        let mut buf = uv_buf_t::init(b"");
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe { (*stream).alloc_cb.unwrap()(stream.cast(), 8, &raw mut buf) };
        buf
    }

    /// As much of `bytes` as fits.
    unsafe fn fill(buf: uv_buf_t, bytes: &[u8]) -> ReturnCodeI64 {
        let len = bytes.len().min(buf.len as usize);
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe { buf.base.copy_from(bytes.as_ptr(), len) };
        ReturnCodeI64(len as i64)
    }

    unsafe fn record(buf: uv_buf_t) {
        // SAFETY: test stub; `handle.rs` passes a live handle.
        let bytes = unsafe { core::slice::from_raw_parts(buf.base, buf.len as usize) };
        WRITTEN.with_borrow_mut(|written| written.extend_from_slice(bytes));
    }

    /// win/pipe.c:1996,2082. An error comes without an allocation (:2213).
    pub(super) fn read_pipes(result: Result<&[u8], c_int>) {
        for pipe in handles(HandleType::NamedPipe) {
            let pipe = pipe.cast::<uv_stream_t>();
            // SAFETY: test stub; `handle.rs` passes a live handle.
            unsafe {
                let (buf, nread) = match result {
                    Ok(bytes) => {
                        let buf = alloc(pipe);
                        (buf, fill(buf, bytes))
                    }
                    Err(err) => (uv_buf_t::init(b""), ReturnCodeI64(err.into())),
                };
                (*pipe).read_cb.unwrap()(pipe, nread, &raw const buf);
            }
        }
    }

    /// win/tty.c:588,1036-1048.
    pub(super) fn finish_line_read(line: &[u8]) {
        let (tty, buf, was_cancelled) = LINE_READ.get().unwrap();
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe {
            let nread = fill(buf, line);
            if !was_cancelled {
                (*tty).read_cb.unwrap()(tty, nread, &raw const buf);
            }
            LINE_READ.set(((*tty).flags & ACTIVE != 0).then(|| (tty, alloc(tty), false)));
        }
    }

    /// win/fs.c:3236-3241.
    fn fs(
        req: *mut fs_t,
        cb: uv_fs_cb,
        work: impl FnOnce() -> ReturnCodeI64 + 'static,
    ) -> ReturnCode {
        // SAFETY: test stub; `handle.rs` passes a live handle.
        unsafe { ((*req).type_, (*req).result) = (UV_FS, ReturnCodeI64(0)) };
        // SAFETY: as above.
        request(move || unsafe {
            if (*req).result.int() == 0 {
                (*req).result = work();
            }
            cb.unwrap()(req);
        })
    }

    macro_rules! fakes {
        ($(fn $name:ident($($arg:tt: $type:ty),*) $(-> $ret:ty)? = $body:expr;)*) => {$(
            #[unsafe(no_mangle)]
            extern "C" fn $name($($arg: $type),*) $(-> $ret)? {
                $body
            }
        )*};
    }
    // SAFETY: test stub; `handle.rs` passes a live handle.
    fakes! {
        fn uv_loop_init(_: *mut Loop) -> ReturnCode = ReturnCode::ZERO;
        // uv-common.c:888.
        fn uv_loop_close(_: *mut Loop) -> ReturnCode = {
            assert!(HANDLES.with_borrow(Vec::is_empty));
            ReturnCode::ZERO
        };
        // win/handle.c:152.
        fn uv_is_closing(h: *const uv_handle_t) -> c_int =
            unsafe { (*h).flags & (CLOSING | UV_HANDLE_CLOSED) != 0 }.into();
        // win/handle.c:70-75, win/handle-inl.h:71, win/pipe.c:1104, win/tty.c:2308,2318.
        fn uv_close(h: *mut uv_handle_t, cb: uv_close_cb) = unsafe {
            if (*h).type_ == HandleType::Tty {
                uv_read_stop(h.cast());
            }
            set_active(h);
            ((*h).flags, (*h).close_cb) = (((*h).flags | CLOSING) & !(ACTIVE | WRITABLE), cb);
        };
        // timer.c:57.
        fn uv_timer_init(l: &Loop, h: *mut Timer) -> ReturnCode =
            unsafe { init(l, h, HandleType::Timer) };
        // timer.c:73.
        fn uv_timer_start(h: *mut Timer, cb: uv_timer_cb, _: u64, _: u64) -> ReturnCode = unsafe {
            if uv_is_closing(h.cast()) != 0 {
                return ReturnCode(UV_EINVAL);
            }
            (*h).timer_cb = cb;
            set_active(h)
        };
        // win/loop-watcher.c:39.
        fn uv_idle_init(l: &Loop, h: *mut uv_idle_t) -> ReturnCode =
            unsafe { init(l, h, HandleType::Idle) };
        // win/loop-watcher.c:46, which links a closing handle too.
        fn uv_idle_start(h: *mut uv_idle_t, _: uv_idle_cb) -> ReturnCode = unsafe { set_active(h) };
        // win/poll.c:474,496,507.
        fn uv_poll_init_socket(l: &Loop, h: *mut uv_poll_t, _: uv_os_sock_t) -> ReturnCode =
            unsafe { init(l, h, HandleType::Poll) };
        // win/poll.c:540.
        fn uv_poll_start(h: *mut uv_poll_t, _: c_int, cb: uv_poll_cb) -> ReturnCode = unsafe {
            (*h).poll_cb = cb;
            set_active(h)
        };
        // win/pipe.c:148.
        fn uv_pipe_init(l: &Loop, h: *mut Pipe, _: c_int) -> ReturnCode =
            unsafe { init(l, h, HandleType::NamedPipe) };
        // win/pipe.c:760.
        fn uv_pipe_bind2(_: *mut Pipe, _: *const u8, len: usize, _: c_uint) -> ReturnCode =
            ReturnCode(if len == 0 { UV_EINVAL } else { 0 });
        // win/pipe.c:1263.
        fn uv_listen(h: *mut uv_stream_t, _: c_int, cb: uv_connection_cb) -> ReturnCode = unsafe {
            (*h).stream.serv.connection_cb = cb;
            set_active(h)
        };
        // win/process.c:909,1161.
        fn uv_spawn(l: &Loop, h: *mut uv_process_t, o: *const uv_process_options_t) -> ReturnCode = unsafe {
            let rc = init(l, h, HandleType::Process);
            (*h).exit_cb = (*o).exit_cb;
            if rc.is_err() {
                return rc;
            }
            (*h).pid = 7;
            set_active(h)
        };
        // win/process.c:1424.
        fn uv_process_kill(h: *mut uv_process_t, _: c_int) -> ReturnCode =
            ReturnCode(if unsafe { (*h).pid } == 0 { UV_EINVAL } else { 0 });
        // win/getaddrinfo.c:262,274.
        fn uv_getaddrinfo(
            _: &Loop,
            req: *mut uv_getaddrinfo_t,
            cb: uv_getaddrinfo_cb,
            _: *const c_char,
            _: *const c_char,
            _: Option<&addrinfo>
        ) -> ReturnCode = {
            unsafe { (*req).getaddrinfo_cb = cb };
            if FAILURE.take() != Failure::None {
                return ReturnCode(UV_EINVAL);
            }
            LOOKUPS.with_borrow_mut(|lookups| lookups.push(req));
            ReturnCode::ZERO
        };
        // win/getaddrinfo.c:219.
        fn uv_freeaddrinfo(ai: *mut addrinfo) = drop(unsafe { Box::from_raw(ai) });
        // threadpool.c:307, win/getaddrinfo.c:113.
        fn uv_cancel(req: *mut uv_req_t) -> c_int = unsafe {
            if FAILURE.take() != Failure::None {
                return UV_EBUSY;
            }
            if (*req).type_ == UV_FS {
                (*req.cast::<fs_t>()).result = ReturnCodeI64(UV_ECANCELED.into());
            } else {
                (*req.cast::<uv_getaddrinfo_t>()).retcode = ReturnCode(UV_EAI_CANCELED);
            }
            0
        };
        // win/pipe.c:1210, which is freed with the handle (:721).
        fn uv_accept(server: *mut uv_stream_t, client: *mut uv_stream_t) -> ReturnCode = {
            assert_eq!(uv_is_closing(server.cast()), 0);
            uv_pipe_open(client.cast(), 0)
        };
        // win/pipe.c:2547.
        fn uv_pipe_open(h: *mut Pipe, _: uv_file) -> ReturnCode = {
            unsafe { (*h).flags |= WRITABLE };
            ReturnCode::ZERO
        };
        // win/pipe.c:2346-2357.
        fn uv_pipe_connect2(
            req: *mut uv_connect_t,
            h: *mut Pipe,
            _: *const u8,
            _: usize,
            _: c_uint,
            cb: uv_connect_cb
        ) -> ReturnCode = request(move || {
            let status = match uv_is_closing(h.cast()) {
                0 => uv_pipe_open(h, 0),
                _ => ReturnCode(UV_ECANCELED),
            };
            unsafe { cb.unwrap()(req, status) };
        });
        // win/tty.c:285.
        fn uv_tty_init(l: &Loop, h: *mut uv_tty_t, _: uv_file, _: c_int) -> ReturnCode =
            unsafe { init(l, h, HandleType::Tty) };
        // uv-common.c:928-932, win/tty.c:652,1086.
        fn uv_read_start(h: *mut uv_stream_t, alloc_cb: uv_alloc_cb, read_cb: uv_read_cb) -> ReturnCode = unsafe {
            if (*h).flags & (CLOSING | ACTIVE) != 0 {
                return ReturnCode(if (*h).flags & CLOSING != 0 { UV_EINVAL } else { UV_EALREADY });
            }
            ((*h).alloc_cb, (*h).read_cb) = (alloc_cb, read_cb);
            if (*h).type_ == HandleType::Tty && LINE_READ.get().is_none() {
                LINE_READ.set(Some((h, alloc(h), false)));
            }
            set_active(h)
        };
        // win/stream.c:97, win/tty.c:1127-1131.
        fn uv_read_stop(h: *mut uv_stream_t) -> ReturnCode = unsafe {
            if (*h).flags & ACTIVE == 0 {
                return ReturnCode::ZERO;
            }
            (*h).flags &= !ACTIVE;
            if FAILURE.take() != Failure::None {
                return ReturnCode(UV_EBADF);
            }
            LINE_READ.update(|read| read.map(|(tty, buf, _)| (tty, buf, true)));
            ReturnCode::ZERO
        };
        // win/stream.c:122. The status is the kernel's, also after a close (win/pipe.c:2266).
        fn uv_write(
            req: *mut uv_write_t,
            h: *mut uv_stream_t,
            bufs: *const uv_buf_t,
            _: c_uint,
            cb: uv_write_cb
        ) -> ReturnCode = {
            if unsafe { (*h).flags } & WRITABLE == 0 {
                return ReturnCode(UV_EPIPE);
            }
            let buf = unsafe { *bufs };
            request(move || unsafe {
                record(buf);
                cb.unwrap()(req, ReturnCode::ZERO);
                assert!(!uv_is_closed(h.cast()));
            })
        };
        // win/fs.c:3327.
        fn uv_fs_read(
            _: *const Loop,
            req: *mut fs_t,
            _: uv_file,
            bufs: *const uv_buf_t,
            _: c_uint,
            _: i64,
            cb: uv_fs_cb
        ) -> ReturnCode = {
            let buf = unsafe { *bufs };
            fs(req, cb, move || unsafe { fill(buf, b"file") })
        };
        // win/fs.c:3360.
        fn uv_fs_write(
            _: *const Loop,
            req: *mut fs_t,
            _: uv_file,
            bufs: *const uv_buf_t,
            _: c_uint,
            _: i64,
            cb: uv_fs_cb
        ) -> ReturnCode = {
            let buf = unsafe { *bufs };
            fs(req, cb, move || {
                unsafe { record(buf) };
                ReturnCodeI64(buf.len.into())
            })
        };
        // win/fs.c:3294.
        fn uv_fs_close(_: *const Loop, req: *mut fs_t, _: uv_file, cb: uv_fs_cb) -> ReturnCode =
            fs(req, cb, || {
                CLOSED_FILES.update(|n| n + 1);
                ReturnCodeI64(0)
            });
        // win/fs.c:3245.
        fn uv_fs_req_cleanup(req: *mut fs_t) = unsafe { (*req).type_ = 0 };
    }
}

use fake::{CLOSED_FILES, FAILURE, Failure, WRITTEN};

/// Runs `test`, and closes the loop, which has to be empty by then. Miri reports what leaks.
fn with_loop(test: impl FnOnce(&'static Loop)) {
    test(Loop::get());
    // SAFETY: `test` has returned.
    unsafe { Loop::close_thread_loop() };
}

fn is_dropped<T>(data: &Rc<T>) -> bool {
    Rc::strong_count(data) == 1
}

/// Where a callback finds the owner of its own handle.
type Slot<H> = Rc<Cell<Option<Owned<H, SlotData<H>>>>>;
struct SlotData<H: UvHandle>(Slot<H>);

#[test]
fn drop_frees_in_the_close_callback() {
    with_loop(|loop_| {
        let data = Rc::new(());
        drop(Timer::init(loop_, Rc::clone(&data)));
        assert!(!is_dropped(&data));
        fake::run();
        assert!(is_dropped(&data));
    });
}

#[test]
fn freed_by_the_later_of_drop_and_close() {
    for closed_before_drop in [false, true] {
        with_loop(|loop_| {
            let data = Rc::new(());
            let timer = Timer::init(loop_, Rc::clone(&data));
            timer.close();
            timer.close();
            if closed_before_drop {
                fake::run();
            }
            assert!(timer.is_closing());
            assert_eq!(timer.is_closed(), closed_before_drop);
            drop(timer);
            assert_eq!(is_dropped(&data), closed_before_drop);
            fake::run();
            assert!(is_dropped(&data));
        });
    }
}

#[test]
fn drop_under_a_close_without_callback_leaks() {
    with_loop(|loop_| {
        let data = [Rc::new(()), Rc::new(())];
        let [early, late] = data.each_ref().map(|d| Timer::init(loop_, Rc::clone(d)));
        let leaked = early.0;
        fake::close_all_without_callback();
        drop(early);
        fake::run();
        drop(late);
        assert_eq!(data.each_ref().map(is_dropped), [false, true]);
        // SAFETY: Miri reports it if `drop` has freed the box.
        unsafe { bun_core::heap::destroy(leaked.as_ptr()) };
    });
}

#[test]
fn closed_handle_outlives_its_loop() {
    let mut timer = None;
    with_loop(|loop_| {
        timer.insert(Timer::init(loop_, ())).close();
        fake::run();
    });
    timer.as_ref().unwrap().close();
}

#[test]
fn failed_init_closes_a_handle_that_is_on_the_loop() {
    for failure in [Failure::BeforeInit, Failure::AfterInit] {
        with_loop(|loop_| {
            let data = Rc::new(());
            FAILURE.set(failure);
            assert!(uv_poll_t::init_socket(loop_, 1, Rc::clone(&data)).is_err());
            assert_eq!(is_dropped(&data), failure == Failure::BeforeInit);
            fake::run();
            assert!(is_dropped(&data));
        });
    }
}

#[test]
fn closing_handle_does_not_start() {
    with_loop(|loop_| {
        let idle = uv_idle_t::init(loop_);
        let poll = uv_poll_t::init_socket(loop_, 1, ()).unwrap();
        idle.close();
        poll.close();
        idle.start();
        assert_eq!(poll.start(UV_READABLE, |_, _, _| {}).int(), UV_EINVAL);
        fake::run();
    });
}

#[test]
fn callback_can_drop_its_handle() {
    with_loop(|loop_| {
        let slot = Slot::default();
        let timer = Timer::init(loop_, SlotData(Rc::clone(&slot)));
        timer.start(1, 0, |timer| {
            drop(timer.data.0.take());
            assert!(timer.is_closing());
        });
        slot.set(Some(timer));
        fake::run();
        assert!(!is_dropped(&slot));
        fake::run();
        assert!(is_dropped(&slot));
    });
}

#[test]
fn start_once_closes_the_timer() {
    with_loop(|loop_| {
        let fired = Rc::new(Cell::new(0));
        Timer::start_once(loop_, 1, Rc::clone(&fired), |n| n.update(|n| n + 1));
        fake::run();
        fake::run();
        assert_eq!(fired.get(), 1);
        assert!(is_dropped(&fired));
    });
}

#[test]
fn poll_closed_under_its_callback_is_freed_after_it() {
    with_loop(|loop_| {
        let slot = Slot::default();
        let poll = uv_poll_t::init_socket(loop_, 1, SlotData(Rc::clone(&slot))).unwrap();
        let rc = poll.start(UV_READABLE, |poll, _, _| {
            drop(poll.data.0.take());
            fake::run();
            assert!(poll.is_closed());
        });
        assert!(!rc.is_err());
        slot.set(Some(poll));
        fake::fire_polls();
        fake::run();
        assert!(!is_dropped(&slot));
        fake::run();
        assert!(is_dropped(&slot));
    });
}

#[test]
fn teardown_closes_what_is_listed() {
    with_loop(|loop_| {
        let listen = |name| {
            ListeningPipe::listen(loop_, name, 1, Cell::new(0), |pipe, _| {
                assert!(pipe.accept(()).is_ok());
                pipe.data.update(|n| n + 1)
            })
        };
        assert!(listen(bun_core::zstr!("")).is_err());
        let [first, dropped, closed, last] =
            [(); 4].map(|()| listen(bun_core::zstr!("a")).unwrap());
        drop(dropped);
        closed.close();
        fake::run();
        fake::fire_connections();
        open_handles::stop_all_for_vm_teardown();
        fake::fire_connections();
        assert!(first.is_closing() && last.is_closing());
        assert!(first.accept(()).is_err_and(|rc| rc.int() == UV_EINVAL));
        assert_eq!(
            [first.data.get(), closed.data.get(), last.data.get()],
            [1, 0, 1]
        );
        fake::run();
    });
}

#[derive(bun_ptr::RefCounted)]
struct Child {
    ref_count: bun_ptr::RefCount,
    exit_status: Rc<Cell<i64>>,
    process: Process,
}

fn spawn(loop_: &Loop, exit_status: &Rc<Cell<i64>>) -> (RefPtr<Child>, ReturnCode) {
    let child = RefPtr::new(Child {
        ref_count: bun_ptr::RefCount::init(),
        exit_status: Rc::clone(exit_status),
        process: Process::default(),
    });
    assert!(child.process.kill(9).is_none());
    child.process.close();
    let on_exit = |child: &RefPtr<Child>, exit_status, _| {
        child.exit_status.set(exit_status);
        child.process.close();
    };
    // SAFETY: the fake reads `exit_cb` only.
    let rc = unsafe {
        let options = &mut zeroed_unchecked();
        Process::spawn(&child, |c| &c.process, loop_, options, on_exit)
    };
    (child, rc)
}

#[test]
fn process_keeps_its_owner_until_it_has_closed() {
    let closers: [fn(); 2] = [fake::exit_processes, open_handles::stop_all_for_vm_teardown];
    for (close, expected) in closers.into_iter().zip([3, 0]) {
        with_loop(|loop_| {
            let exit_status = Rc::default();
            drop(spawn(loop_, &exit_status));
            fake::run();
            assert!(!is_dropped(&exit_status));
            close();
            assert!(!is_dropped(&exit_status));
            fake::run();
            assert!(is_dropped(&exit_status));
            assert_eq!(exit_status.get(), expected);
        });
    }
}

#[test]
fn process_is_inert_once_it_has_closed() {
    for (failure, pid) in [(Failure::None, 7), (Failure::AfterInit, 0)] {
        with_loop(|loop_| {
            FAILURE.set(failure);
            let (child, rc) = spawn(loop_, &Rc::default());
            assert_eq!(rc.is_err(), failure != Failure::None);
            child.process.close();
            child.process.close();
            assert!(child.process.kill(9).is_some());
            fake::run();
            assert!(RefPtr::has_one_ref(&child));
            assert!(child.process.kill(9).is_none());
            assert!(child.process.process_handle().is_none());
            assert_eq!(child.process.pid(), pid);
        });
    }
}

struct Lookup {
    status: Rc<Cell<Option<c_int>>>,
    request: GetAddrInfoRequest,
}
bun_core::intrusive_field!(Lookup, request: GetAddrInfoRequest);

#[test]
fn getaddrinfo_returns_its_box() {
    with_loop(|loop_| {
        let lookup = || {
            let status = Rc::default();
            let owner = Box::new(Lookup {
                status: Rc::clone(&status),
                request: GetAddrInfoRequest::default(),
            });
            let then = |owner: Box<Lookup>, result: Result<OwnedAddrInfo, ReturnCode>| {
                let status = result.map_or_else(ReturnCode::int, |list| list.ai_flags);
                owner.status.set(Some(status));
            };
            let name = bun_core::zstr!("a");
            let result = getaddrinfo(owner, loop_, name, name, None, then);
            (status, result.is_ok())
        };
        FAILURE.set(Failure::BeforeInit);
        let (refused, started) = lookup();
        assert!(!started && is_dropped(&refused));

        let (done, _) = lookup();
        fake::run();
        let (running, _) = lookup();
        FAILURE.set(Failure::BeforeInit);
        open_handles::cancel_requests_for_vm_teardown();
        let (cancelled, _) = lookup();
        open_handles::cancel_requests_for_vm_teardown();
        let (late, _) = lookup();
        fake::run();
        assert_eq!(
            [refused, done, running, cancelled, late].map(|status| status.get()),
            [None, Some(0), Some(0), Some(UV_EAI_CANCELED), Some(0)]
        );
    });
}

/// What the callbacks got.
type Results = Rc<Cell<Vec<i64>>>;

#[test]
fn reads_append_to_the_input() {
    with_loop(|loop_| {
        let results = Results::default();
        let pipe = Pipe::open(loop_, false, 3, Rc::clone(&results)).unwrap();
        pipe.input().set(b"a".to_vec());
        let rc = pipe.read_start(|pipe, nread| pipe.data.push(nread.int()));
        assert!(!rc.is_err());
        fake::read_pipes(Ok(b"bc"));
        fake::read_pipes(Ok(b""));
        pipe.set_max_read_len(1);
        fake::read_pipes(Ok(b"de"));
        fake::read_pipes(Err(UV_EOF));
        fake::read_pipes(Ok(b"f"));
        assert_eq!(results.take(), [2, 1, UV_EOF.into()]);
        assert_eq!(pipe.input().take(), b"abcd");
        drop(pipe);
        fake::run();
    });
}

#[test]
fn cancelled_line_read_keeps_its_buffer() {
    for last_cancel in [Failure::None, Failure::BeforeInit] {
        with_loop(|loop_| {
            let results = Results::default();
            let tty = uv_tty_t::init(loop_, 0, Rc::clone(&results)).unwrap();
            let read_start = || {
                tty.read_start(|tty, nread| {
                    tty.data.push(nread.int());
                    assert_eq!(tty.input().take(), b"ab");
                })
            };
            assert!(!read_start().is_err());
            tty.read_stop();
            drop(tty.input().take());
            assert!(!read_start().is_err());
            fake::finish_line_read(b"lost");
            fake::finish_line_read(b"ab");
            assert_eq!(results.take(), [2]);

            FAILURE.set(last_cancel);
            drop(tty);
            fake::run();
            assert!(!is_dropped(&results));
            fake::finish_line_read(b"lost");
            fake::run();
            assert!(is_dropped(&results));
        });
    }
}

#[test]
fn request_reports_after_close_but_not_after_drop() {
    type Start = fn(&Loop, Results) -> Owned<Pipe, Results>;
    fn then(pipe: &Handle<Pipe, Results>, status: ReturnCode) {
        pipe.data.push(status.int().into());
    }
    let starts: [(Start, &[u8], c_int); 3] = [
        (
            |loop_, data| Pipe::connect(loop_, bun_core::zstr!("a"), data, then).unwrap(),
            b"",
            UV_ECANCELED,
        ),
        (
            |loop_, data| {
                let pipe = Pipe::open(loop_, false, 3, data).unwrap();
                let result = pipe.write(b"abc".to_vec(), 1, |pipe, bytes, status| {
                    assert_eq!(bytes, b"abc");
                    then(pipe, status);
                });
                assert!(result.is_ok());
                pipe
            },
            b"bc",
            0,
        ),
        (
            |loop_, data| {
                let pipe = Pipe::open(loop_, false, 3, data).unwrap();
                let bytes = Box::<[u8]>::from(*b"abc");
                assert!(!pipe.queue_write(bytes, |bytes| bytes, then).is_err());
                pipe
            },
            b"abc",
            0,
        ),
    ];
    for (start, written, after_close) in starts {
        with_loop(|loop_| {
            let results = Results::default();
            let [open, closed, dropped] = [(); 3].map(|()| start(loop_, Rc::clone(&results)));
            closed.close();
            drop(dropped);
            fake::run();
            assert_eq!(results.take(), [0, after_close.into()]);
            assert_eq!(WRITTEN.take(), written.repeat(3));
            drop((open, closed));
            fake::run();
        });
    }
}

#[test]
fn write_can_follow_a_connect_a_write_or_a_refusal() {
    with_loop(|loop_| {
        let pipe = Pipe::connect(loop_, bun_core::zstr!("a"), (), |pipe, _| {
            let result = pipe.write(b"a".to_vec(), 0, |pipe, _, _| {
                assert!(pipe.write(b"b".to_vec(), 0, |_, _, _| {}).is_ok());
            });
            assert!(result.is_ok());
        })
        .unwrap();
        for _ in 0..3 {
            fake::run();
        }
        FAILURE.set(Failure::BeforeInit);
        let (refused, _) = pipe.write(b"c".to_vec(), 0, |_, _, _| {}).unwrap_err();
        FAILURE.set(Failure::BeforeInit);
        assert!(pipe.queue_write(vec![0], |v| v, |_, _| {}).is_err());
        assert!(pipe.write(refused, 0, |_, _, _| {}).is_ok());
        fake::run();
        pipe.close();
        let (_, rc) = pipe.write(vec![0], 0, |_, _, _| {}).unwrap_err();
        assert_eq!(rc.int(), UV_EPIPE);
        fake::run();
        assert_eq!(WRITTEN.take(), b"abc");
    });
}

#[test]
fn teardown_callback_can_drop_its_handle() {
    with_loop(|loop_| {
        let slot = Slot::default();
        let pipe = Pipe::init(loop_, false, SlotData(Rc::clone(&slot))).unwrap();
        pipe.on_vm_teardown(|pipe| drop(pipe.data.0.take()));
        slot.set(Some(pipe));
        open_handles::stop_all_for_vm_teardown();
        fake::run();
        assert!(is_dropped(&slot));
    });
}

#[test]
fn teardown_skips_what_a_walk_has_closed() {
    with_loop(|loop_| {
        let slot = Slot::default();
        let pipe = Pipe::init(loop_, false, SlotData(Rc::clone(&slot))).unwrap();
        pipe.on_vm_teardown(|pipe| drop(pipe.data.0.take()));
        slot.set(Some(pipe));
        fake::close_all_without_callback();
        fake::run();
        open_handles::stop_all_for_vm_teardown();
        drop(slot.take().unwrap());
        assert!(is_dropped(&slot));
    });
}

thread_local! {
    static FILE: Cell<Option<OwnedFile<u8>>> = const { Cell::new(None) };
    static FILE_RESULT: Cell<Option<(u8, Vec<u8>, i64)>> = const { Cell::new(None) };
}

fn drop_file(data: u8, buffer: Vec<u8>, result: ReturnCodeI64) {
    FILE.set(None);
    FILE_RESULT.set(Some((data, buffer, result.int())));
}

#[test]
fn file_callback_can_drop_its_file() {
    with_loop(|loop_| {
        for (cancel, expected) in [
            (None, (&b"fil"[..], 3)),
            (Some(Failure::None), (b"", UV_ECANCELED.into())),
            (Some(Failure::BeforeInit), (b"fil", 3)),
        ] {
            let file = OwnedFile::new(loop_, 3, 1);
            FAILURE.set(Failure::BeforeInit);
            let (buffer, _) = file
                .read(Vec::with_capacity(8), 3, None, drop_file)
                .unwrap_err();
            assert!(file.read(buffer, 3, None, drop_file).is_ok());
            file.data().set(2);
            if let Some(failure) = cancel {
                FAILURE.set(failure);
                file.cancel();
            }
            file.set_close_on_drop(true);
            FILE.set(Some(file));
            fake::run();
            let (data, buffer, result) = FILE_RESULT.take().unwrap();
            assert_eq!((data, (&buffer[..], result)), (2, expected));
            fake::run();
            assert_eq!(CLOSED_FILES.take(), 1);
        }
    });
}

#[test]
fn file_dropped_under_an_operation_closes_after_it() {
    with_loop(|loop_| {
        let file = OwnedFile::new(loop_, 3, 1);
        file.on_vm_teardown(|_| FILE.set(None));
        file.set_close_on_drop(true);
        assert!(file.write(b"abc".to_vec(), 1, drop_file).is_ok());
        FILE.set(Some(file));
        open_handles::stop_all_for_vm_teardown();
        fake::run();
        assert_eq!((WRITTEN.take(), CLOSED_FILES.get()), (b"bc".to_vec(), 0));
        fake::run();
        assert_eq!(CLOSED_FILES.take(), 1);
        assert!(FILE_RESULT.take().is_none());
    });
}
