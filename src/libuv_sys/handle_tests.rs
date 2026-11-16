//! For Miri, which calls the functions of [`fake`] in place of libuv's. They cite the lines of libuv's `src/` that they model.

use super::*;
use bun_core::ffi::zeroed_unchecked;
use std::rc::Rc;

/// Touches a handle or a request whenever libuv may, so that Miri reports one that was freed or moved.
mod fake {
    use super::*;
    use core::cell::RefCell;

    const CLOSING: c_uint = 1;
    const ACTIVE: c_uint = 4;

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
            // win/handle-inl.h:76.
            while let Some(handle) = HANDLES.with_borrow_mut(|handles| {
                let index = handles.iter().position(|&h| (*h).flags & CLOSING != 0)?;
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
        // win/handle.c:70-75, win/handle-inl.h:71.
        fn uv_close(h: *mut uv_handle_t, cb: uv_close_cb) = unsafe {
            set_active(h);
            ((*h).flags, (*h).close_cb) = (((*h).flags | CLOSING) & !ACTIVE, cb);
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
        fn uv_cancel(req: *mut uv_req_t) -> c_int = {
            if FAILURE.take() != Failure::None {
                return UV_EBUSY;
            }
            unsafe { (*req.cast::<uv_getaddrinfo_t>()).retcode = ReturnCode(UV_EAI_CANCELED) };
            0
        };
    }
}

use fake::{FAILURE, Failure};

/// Runs `test`, and closes the loop, which has to be empty by then. Miri reports what leaks.
fn with_loop(test: impl FnOnce(&Loop)) {
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
