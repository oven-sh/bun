//! On Windows: `RUSTFLAGS=-Clink-arg=/FORCE:UNRESOLVED cargo test -p bun_iocp --lib`

use core::cell::{Cell, RefCell};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;
use std::io::{Read as _, Write as _};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::os::windows::io::{
    AsHandle as _, AsRawHandle as _, AsRawSocket as _, BorrowedHandle, OwnedHandle,
};
use std::rc::Rc;
use std::sync::{Arc, Barrier, OnceLock, mpsc};
use std::time::Instant;

use bun_sys::windows::{self as w, NTSTATUS, PipeDirection, PipeMode};
use bun_threading::fifo_pool::{Config, FifoPool, has_warming_thread, try_during_warmup};
use bun_threading::spin::has_multiple_cpus;

use crate::blocking::{self, CancelToken, ConcurrencyGate};
use crate::faults::{self, Call, fail, intercept};
use crate::port::key;
use crate::sys;
use crate::{
    Completer, Completion, Event, Handle, LoopRef, OverlappedFile, Port, Readiness,
    ReadinessHandler, Request, SocketRegistration, Waker, WriteProgress,
};

thread_local! {
    static CLOCK_OFFSET: Cell<Duration> = const { Cell::new(Duration::from_secs(1)) };
    /// Added to `CLOCK_OFFSET` on every clock read.
    static CLOCK_STEP: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    static FROZEN_TIME: Cell<Option<Instant>> = const { Cell::new(None) };
}

#[unsafe(no_mangle)]
extern "C" fn clock_gettime_monotonic(sec: &mut i64, nsec: &mut i64) {
    static START: OnceLock<Instant> = OnceLock::new();
    advance_clock(CLOCK_STEP.get());
    let start = *START.get_or_init(Instant::now);
    let now = FROZEN_TIME.get().unwrap_or_else(Instant::now);
    let elapsed = now.saturating_duration_since(start) + CLOCK_OFFSET.get();
    *sec = elapsed.as_secs() as i64;
    *nsec = elapsed.subsec_nanos().into();
}

fn advance_clock(duration: Duration) {
    CLOCK_OFFSET.set(CLOCK_OFFSET.get() + duration);
}

fn freeze_clock() {
    FROZEN_TIME.set(Some(Instant::now()));
}

/// Returns the number of `Event::Wake` events.
fn run_iteration(port: &Port, timeout: Duration) -> usize {
    let wake_count = Cell::new(0);
    port.prepare();
    port.wait(Some(timeout.as_nanos() as u64));
    port.dispatch(|event| match event {
        Event::Wake => wake_count.update(|count| count + 1),
        Event::Socket(..) => unreachable!(),
    });
    wake_count.get()
}

fn run_until(port: &Port, is_done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !is_done() {
        assert!(Instant::now() < deadline);
        run_iteration(port, Duration::from_millis(100));
    }
}

const FILE_CONSTRUCTORS: [fn(&Rc<Port>, Arc<Handle>) -> OverlappedFile; 2] =
    [OverlappedFile::new_exclusive, OverlappedFile::new_shared];

fn create_pipe(
    port: &Rc<Port>,
    new_file: fn(&Rc<Port>, Arc<Handle>) -> OverlappedFile,
) -> (OverlappedFile, bun_sys::File) {
    let ours = PipeMode::Overlapped;
    let theirs = PipeMode::Synchronous;
    let pair = w::create_pipe_pair(ours, theirs, PipeDirection::Duplex).unwrap();
    let handle = Handle::from_owned(pair.ours);
    (new_file(port, handle), pair.theirs.into())
}

fn store_completion(result: &Rc<RefCell<Option<Completion>>>) -> impl FnOnce(Completion) + 'static {
    let result = Rc::clone(result);
    move |completion| assert!(result.replace(Some(completion)).is_none())
}

fn start_read(file: &OverlappedFile, result: &Rc<RefCell<Option<Completion>>>) -> Request {
    file.read(Vec::with_capacity(16), 16, store_completion(result))
        .unwrap_or_else(|_| panic!("failed to start"))
}

#[test]
fn wait_blocks_for_full_timeout() {
    let port = Port::new().unwrap();
    for timeout_ms in [30, 2, 10] {
        let start = Instant::now();
        run_iteration(&port, Duration::from_millis(timeout_ms));
        assert!(start.elapsed() >= Duration::from_millis(timeout_ms));
    }
}

#[test]
fn stale_timer_does_not_end_next_wait() {
    let port = Port::new().unwrap();
    port.waker().wake();
    assert_eq!(run_iteration(&port, Duration::from_millis(5)), 1);
    let start = Instant::now();
    run_iteration(&port, Duration::from_millis(40));
    assert!(start.elapsed() >= Duration::from_millis(40));
}

#[test]
fn wakes_are_coalesced() {
    let port = Port::new().unwrap();
    let waker = port.waker();
    for _ in 0..2 {
        waker.wake();
        waker.wake();
        assert_eq!(run_iteration(&port, Duration::from_secs(10)), 1);
        assert_eq!(run_iteration(&port, Duration::ZERO), 0);
    }
}

#[test]
fn pipe_reads_and_writes_complete() {
    let port = Port::new().unwrap();
    for new_file in FILE_CONSTRUCTORS {
        let (file, peer) = create_pipe(&port, new_file);
        for is_data_first in [true, false] {
            let read_result = Rc::default();
            if is_data_first {
                peer.write_all(b"abc").unwrap();
            }
            let _request = start_read(&file, &read_result);
            assert_eq!(port.prepare(), is_data_first);
            if !is_data_first {
                peer.write_all(b"abc").unwrap();
            }
            assert!(read_result.borrow().is_none());
            run_until(&port, || read_result.borrow().is_some());
            assert_eq!(read_result.take().unwrap().buffer, b"abc");
        }

        let write = file.try_write(b"now".to_vec(), |_| unreachable!());
        assert_eq!(write.err().unwrap().transferred, 3);
        assert!(!port.prepare());
        assert_eq!(peer.read(&mut [0; 8]).unwrap(), 3);

        let write_result = Rc::default();
        let _write = file.write(vec![7; 200_000], 50_000, store_completion(&write_result));
        run_iteration(&port, Duration::ZERO);
        assert!(write_result.borrow().is_none());
        let mut received = vec![0; 150_000];
        assert_eq!(peer.read_all(&mut received).unwrap(), 150_000);
        run_until(&port, || write_result.borrow().is_some());
        assert_eq!(write_result.take().unwrap().transferred, 150_000);

        let read_result = Rc::default();
        let _read = start_read(&file, &read_result);
        drop(peer);
        run_until(&port, || read_result.borrow().is_some());
        assert_eq!(read_result.take().unwrap().status, NTSTATUS::PIPE_BROKEN);
        let failed_read = file.read(Vec::with_capacity(1), 1, |_| unreachable!());
        assert_eq!(failed_read.err().unwrap().status, NTSTATUS::PIPE_BROKEN);
        assert_eq!(port.callback_count(), 0);
    }
}

#[test]
fn sync_write_completes_in_port_order() {
    let port = Port::new().unwrap();
    let mode = PipeMode::Overlapped;
    let pair = w::create_pipe_pair(mode, mode, PipeDirection::Duplex).unwrap();
    let [ours, theirs] = [pair.ours, pair.theirs]
        .map(|end| OverlappedFile::new_exclusive(&port, Handle::from_owned(end)));
    let order = Rc::new(RefCell::new(Vec::new()));
    let record = |name| {
        let order = Rc::clone(&order);
        move |_| order.borrow_mut().push(name)
    };

    let _read = theirs.read(Vec::with_capacity(1), 1, record("read"));
    let _reply = ours.read(Vec::with_capacity(1), 1, record("reply"));
    let _write = ours.write(b"x".to_vec(), 0, record("write"));
    assert!(theirs.try_write(b"y".to_vec(), record("")).is_err());
    run_until(&port, || order.borrow().len() == 3);
    assert_eq!(order.take(), ["read", "write", "reply"]);
}

#[test]
fn cancel_runs_callback_and_drop_does_not() {
    let port = Port::new().unwrap();
    for new_file in FILE_CONSTRUCTORS {
        let (file, peer) = create_pipe(&port, new_file);
        let result = Rc::default();
        let request = start_read(&file, &result);
        request.cancel();
        run_until(&port, || result.borrow().is_some());
        assert_eq!(result.take().unwrap().status, NTSTATUS::CANCELLED);

        drop(start_read(&file, &result));
        assert_eq!(port.callback_count(), 0);
        drop(file);
        assert_eq!(peer.read(&mut [0; 1]).unwrap(), 0);
        assert!(port.has_abandoned_requests());
        run_until(&port, || !port.has_abandoned_requests());
        assert!(result.borrow().is_none());
    }
}

#[test]
fn cancel_and_wait_returns_completion_without_callback() {
    let port = Port::new().unwrap();
    for new_file in FILE_CONSTRUCTORS {
        let (file, peer) = create_pipe(&port, new_file);
        let result = Rc::default();
        port.waker().wake();
        let cancelled = start_read(&file, &result).cancel_and_wait().ok().unwrap();
        assert_eq!(cancelled.status, NTSTATUS::CANCELLED);

        let request = start_read(&file, &result);
        peer.write_all(b"abc").unwrap();
        assert_eq!(request.cancel_and_wait().ok().unwrap().buffer, b"abc");
        assert_eq!(run_iteration(&port, Duration::from_secs(10)), 1);
        assert!(result.borrow().is_none() && port.callback_count() == 0);
    }
}

#[test]
fn request_dropped_before_dispatch_skips_callback() {
    let port = Port::new().unwrap();
    let (first, first_peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let (second, second_peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let second_read = Rc::new(Cell::new(None));
    let second_read_clone = Rc::clone(&second_read);
    let _first = first.read(Vec::with_capacity(1), 1, move |_| {
        drop(second_read_clone.take())
    });
    second_read.set(
        second
            .read(Vec::with_capacity(1), 1, |_| unreachable!())
            .ok(),
    );
    first_peer.write_all(b"1").unwrap();
    second_peer.write_all(b"2").unwrap();
    run_until(&port, || port.requests.used_slot_count() == 0);
}

#[test]
fn dispatch_returns_despite_endless_deferral() {
    fn defer_repeatedly(port: &Rc<Port>, request: Rc<Cell<Option<Request>>>) {
        let port_clone = Rc::clone(port);
        let request_clone = Rc::clone(&request);
        request.set(Some(Request::defer(port, move || {
            defer_repeatedly(&port_clone, request_clone)
        })));
    }
    let port = Port::new().unwrap();
    let request = Rc::default();
    defer_repeatedly(&port, Rc::clone(&request));
    run_iteration(&port, Duration::from_secs(10));
    assert!(port.prepare());
    request.take();
}

/// Reads one byte at a time until a read returns no data.
fn start_read_loop(file: Rc<OverlappedFile>, log: Rc<RefCell<String>>, on_byte: Rc<dyn Fn()>) {
    let file_clone = Rc::clone(&file);
    let log_clone = Rc::clone(&log);
    let request = file.read(Vec::with_capacity(1), 1, move |completion| {
        if let [byte] = completion.buffer[..] {
            log_clone.borrow_mut().push(byte.into());
            on_byte();
            start_read_loop(file_clone, log_clone, on_byte);
        }
    });
    core::mem::forget(request);
}

#[test]
fn hangup_is_dispatched_after_buffered_data() {
    if !has_wait_packets() {
        return;
    }
    for (new_file, is_endless) in FILE_CONSTRUCTORS
        .map(|new_file| [(new_file, false), (new_file, true)])
        .concat()
    {
        let port = Port::new().unwrap();
        let log = Rc::new(RefCell::new(String::new()));
        let record = |tag| {
            let log = Rc::clone(&log);
            move || log.borrow_mut().push(tag)
        };
        let (input, writer) = create_pipe(&port, new_file);
        let (output, reader) = create_pipe(&port, new_file);
        let writer = Rc::new(writer);
        let writer_clone = Rc::clone(&writer);
        let refill = move || {
            if is_endless {
                writer_clone.write_all(b".").unwrap();
            }
        };
        start_read_loop(Rc::new(input), Rc::clone(&log), Rc::new(refill));
        let on_write_failure = record('F');
        let _write = output.write(vec![0; 1 << 20], 0, move |_| on_write_failure());
        let event = w::CreateEventW().unwrap();
        let _hangup =
            Request::wait(&port, event.as_handle(), record('S')).map(Request::mark_hangup);
        let _plain_wait = Request::wait(&port, event.as_handle(), record('o'));
        writer.write_all(b"abc").unwrap();
        drop(reader);
        w::set_event(&event);
        run_until(&port, || log.borrow().contains('S'));
        let expected = if is_endless { "aobc...FS" } else { "aobcFS" };
        assert!(log.borrow().starts_with(expected), "{}", log.borrow());
    }
}

#[test]
fn sync_read_can_be_deferred_to_next_iteration() {
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let result = Rc::default();
    let read = Rc::new(Cell::new(None));
    let result_clone = Rc::clone(&result);
    let read_clone = Rc::clone(&read);
    peer.write_all(b"x").unwrap();
    let _deferred = Request::defer(&port, move || {
        let request = start_read(&file, &result_clone);
        request.defer_to_next_iteration();
        read_clone.set(Some((request, file)));
    });
    run_iteration(&port, Duration::from_secs(10));
    assert!(result.borrow().is_none());
    run_iteration(&port, Duration::from_secs(10));
    assert!(result.borrow().is_some());
}

#[test]
fn wait_delay_and_completer_requests_complete() {
    let port = Port::new().unwrap();
    let log = Rc::new(RefCell::new(Vec::new()));
    let record = |name: &'static str| {
        let log = Rc::clone(&log);
        move || log.borrow_mut().push(name)
    };
    let event = w::CreateEventW().unwrap();
    drop(Request::wait(&port, event.as_handle(), record("dropped")).unwrap());
    drop(Request::delay(&port, Duration::ZERO, record("dropped")));
    let _signal = Request::wait(&port, event.as_handle(), record("signal")).unwrap();
    let _long_delay = Request::delay(&port, Duration::from_millis(60), record("long delay"));
    let _short_delay = Request::delay(&port, Duration::from_millis(30), record("short delay"));
    let on_result = record("result");
    let (_request, completer) = Request::with_completer(&port, move |value: u8| {
        assert_eq!(value, 7);
        on_result();
    });
    let (dropped_request, orphaned_completer) = Request::with_completer(&port, |()| unreachable!());
    drop(dropped_request);
    w::set_event(&event);
    run_until(&port, || log.borrow().len() == 1);
    blocking::spawn(move || {
        orphaned_completer.complete(());
        completer.complete(7);
    });
    while port.callback_count() > 0 {
        port.wait(None);
        port.dispatch(|_| {});
    }
    log.borrow_mut().retain(|name| *name != "result");
    assert_eq!(*log.borrow(), ["signal", "short delay", "long delay"]);
}

#[test]
fn cancel_interrupts_blocking_read() {
    let port = Port::new().unwrap();
    for mode in [PipeMode::Synchronous, PipeMode::Overlapped] {
        let pair = w::create_pipe_pair(mode, mode, PipeDirection::Inbound).unwrap();
        let file = bun_sys::File::from(pair.ours);
        for round in 0..200 {
            let result = Rc::new(Cell::new(None));
            let token = CancelToken::default();
            let result_clone = Rc::clone(&result);
            let (_request, completer) =
                Request::with_completer(&port, move |value| result_clone.set(Some(value)));
            let fd = file.fd();
            let token_clone = token.clone();
            blocking::spawn(move || {
                let read = || bun_sys::read(fd, &mut [0; 8]).map_err(|err| err.get_errno());
                completer.complete(token_clone.run(read));
            });
            for _ in 0..round * 50 {
                core::hint::spin_loop();
            }
            token.cancel();
            run_until(&port, || result.get().is_some());
            let result = result.get().unwrap();
            assert!(result.is_none_or(|read| read == Err(bun_sys::E::ECANCELED)));
        }
    }
}

#[test]
fn read_after_cancel_fails_with_ecanceled() {
    let mode = PipeMode::Synchronous;
    let direction = PipeDirection::Inbound;
    let pair = w::create_pipe_pair(mode, mode, direction).unwrap();
    let ours = bun_sys::File::from(pair.ours);
    let theirs = bun_sys::File::from(pair.theirs);
    bun_sys::write(theirs.fd(), b"ab").unwrap();
    let token = CancelToken::default();
    let read = || bun_sys::read(ours.fd(), &mut [0; 1]).map_err(|err| err.get_errno());
    let results = token.run(|| {
        let first = read();
        let token_clone = token.clone();
        std::thread::spawn(move || token_clone.cancel())
            .join()
            .unwrap();
        (first, read())
    });
    assert_eq!(results, Some((Ok(1), Err(bun_sys::E::ECANCELED))));
}

#[test]
fn concurrency_gate_opens_only_after_poster_blocks() {
    if !has_wait_packets() {
        return;
    }
    let event = w::CreateEventW().unwrap();
    let post_and_spin = |gate: &ConcurrencyGate| {
        gate.post();
        gate.post_on_signal(event.as_handle());
        w::set_event(&event);
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(30) {}
    };
    // Fault the code in first: waiting on a page fault also counts as blocking.
    post_and_spin(&ConcurrencyGate::new().unwrap());
    let gate = ConcurrencyGate::new().unwrap();
    let is_running = AtomicBool::new(true);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for _ in 0..2 {
                gate.wait();
                assert!(!is_running.load(Ordering::SeqCst));
            }
        });
        post_and_spin(&gate);
        is_running.store(false, Ordering::SeqCst);
    });
}

fn create_socket_pair() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    (listener.accept().unwrap().0, client)
}

fn register_socket(
    port: &Rc<Port>,
    socket: &TcpStream,
) -> (SocketRegistration, Rc<RefCell<Vec<Readiness>>>) {
    let events = Rc::new(RefCell::new(Vec::new()));
    let events_clone = Rc::clone(&events);
    let handler =
        ReadinessHandler::Callback(Rc::new(move |ready| events_clone.borrow_mut().push(ready)));
    let registration = SocketRegistration::new(port, socket.as_raw_socket() as usize, handler);
    (registration.unwrap(), events)
}

#[test]
fn readiness_is_level_triggered_and_filtered_by_interest() {
    let port = Port::new().unwrap();
    let (mut ours, mut peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &ours);
    registration.set_interest(Readiness::RECEIVE);
    run_iteration(&port, Duration::ZERO);
    assert_eq!(events.take(), []);

    registration.set_interest(Readiness::RECEIVE | Readiness::SEND);
    run_iteration(&port, Duration::ZERO);
    assert_eq!(events.take(), [Readiness::SEND]);

    registration.set_interest(Readiness::RECEIVE);
    peer.write_all(b"x").unwrap();
    for _ in 0..2 {
        run_until(&port, || !events.borrow().is_empty());
        assert_eq!(events.take(), [Readiness::RECEIVE]);
    }
    ours.read_exact(&mut [0]).unwrap();

    registration.set_interest(Readiness::DISCONNECT);
    run_iteration(&port, Duration::ZERO);
    registration.set_interest(Readiness::empty());
    peer.shutdown(Shutdown::Write).unwrap();
    run_iteration(&port, Duration::from_millis(50));
    assert_eq!(events.take(), []);
    registration.set_interest(Readiness::DISCONNECT);
    run_iteration(&port, Duration::from_secs(10));
    assert_eq!(events.take()[0], Readiness::DISCONNECT);
}

#[test]
fn disconnect_after_receive_is_reported_in_same_iteration() {
    let port = Port::new().unwrap();
    let (ours, peer) = create_socket_pair();
    let events = Rc::new(RefCell::new(Vec::new()));
    let events_clone = Rc::clone(&events);
    let socket = ours.as_raw_socket() as usize;
    (&peer).write_all(b"x").unwrap();
    let handler = ReadinessHandler::Callback(Rc::new(move |ready| {
        if events_clone.borrow().is_empty() {
            (&ours).read_exact(&mut [0]).unwrap();
            peer.shutdown(Shutdown::Write).unwrap();
            assert_eq!(ours.peek(&mut [0]).unwrap(), 0);
        }
        events_clone.borrow_mut().push(ready);
    }));
    let registration = SocketRegistration::new(&port, socket, handler).unwrap();
    registration.set_interest(Readiness::RECEIVE | Readiness::DISCONNECT);
    run_until(&port, || !events.borrow().is_empty());
    assert_eq!(events.take(), [Readiness::RECEIVE, Readiness::DISCONNECT]);
}

#[test]
fn take_sync_completion_keeps_deferred_socket_packet() {
    let port = Port::new().unwrap();
    let (file, theirs) = create_pipe(&port, OverlappedFile::new_exclusive);
    theirs.write_all(b"x").unwrap();
    let read = start_read(&file, &Rc::default());

    let (ours, peer) = create_socket_pair();
    peer.shutdown(Shutdown::Write).unwrap();
    assert_eq!(ours.peek(&mut [0]).unwrap(), 0);
    let (registration, events) = register_socket(&port, &ours);
    registration.set_interest(Readiness::DISCONNECT);
    port.prepare();

    assert!(
        read.take_sync_completion()
            .is_ok_and(|read| read.buffer == b"x")
    );
    run_until(&port, || !events.borrow().is_empty());
}

#[test]
fn dropped_registration_skips_queued_update() {
    let port = Port::new().unwrap();
    let (ours, peer) = create_socket_pair();
    let (registration, _) = register_socket(&port, &ours);
    registration.set_interest(Readiness::RECEIVE);
    assert!(!port.prepare());
    peer.shutdown(Shutdown::Write).unwrap();
    assert_eq!(ours.peek(&mut [0]).unwrap(), 0);
    registration.set_interest(Readiness::RECEIVE | Readiness::DISCONNECT);
    drop(registration);
    assert!(!port.prepare());
}

#[test]
fn interest_can_grow_while_both_poll_requests_are_in_flight() {
    let port = Port::new().unwrap();
    let (ours, _peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &ours);
    let mut interest = Readiness::empty();
    for flag in [
        Readiness::ABORT,
        Readiness::RECEIVE,
        Readiness::DISCONNECT,
        Readiness::SEND,
    ] {
        interest |= flag;
        registration.set_interest(interest);
        port.prepare();
    }
    run_until(&port, || !events.borrow().is_empty());
    assert_eq!(events.take(), [Readiness::SEND]);
}

#[test]
fn socket_registered_on_two_ports_is_reported_by_both() {
    let ports = [Port::new().unwrap(), Port::new().unwrap()];
    let (ours, mut peer) = create_socket_pair();
    let registrations = ports.each_ref().map(|port| register_socket(port, &ours));
    for _ in 0..3 {
        for (port, (registration, _)) in ports.iter().zip(&registrations) {
            registration.set_interest(Readiness::RECEIVE);
            run_iteration(port, Duration::ZERO);
        }
    }
    peer.write_all(b"x").unwrap();
    for (port, (_, events)) in ports.iter().zip(&registrations) {
        run_until(port, || !events.borrow().is_empty());
    }
}

#[test]
fn registration_rejects_non_socket_handle() {
    let port = Port::new().unwrap();
    let event: OwnedHandle = w::CreateEventW().unwrap();
    let handle = event.as_raw_handle().addr();
    let handler = ReadinessHandler::Callback(Rc::new(|_| unreachable!()));
    assert!(SocketRegistration::new(&port, handle, handler).is_err());
    assert_eq!(port.callback_count(), 0);
}

#[test]
fn registrations_spanning_poll_groups_are_released() {
    let port = Port::new().unwrap();
    let sockets: Vec<_> = (0..70).map(|_| create_socket_pair()).collect();
    for _ in 0..3 {
        let registrations: Vec<_> = sockets
            .iter()
            .map(|(ours, _)| register_socket(&port, ours))
            .collect();
        for (registration, _) in &registrations {
            registration.set_interest(Readiness::RECEIVE);
        }
        run_iteration(&port, Duration::ZERO);
        drop(registrations);
        run_until(&port, || !port.sockets.has_polls_in_flight());
    }
}

#[test]
fn shutdown_returns_once_polls_complete() {
    let port = Port::new().unwrap();
    let (socket, _peer) = create_socket_pair();
    let (registration, _) = register_socket(&port, &socket);
    registration.set_interest(Readiness::RECEIVE);
    run_iteration(&port, Duration::ZERO);
    let start = Instant::now();
    port.shutdown();
    assert!(start.elapsed() < Duration::from_secs(5));
}

#[test]
fn shutdown_cancels_requests_and_polls() {
    let port = Port::new().unwrap();
    let (socket, _peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &socket);
    registration.set_interest(Readiness::RECEIVE);
    let pipes = FILE_CONSTRUCTORS.map(|new_file| create_pipe(&port, new_file));
    let result = Rc::default();
    let _reads = pipes.each_ref().map(|(file, _)| start_read(file, &result));
    run_iteration(&port, Duration::ZERO);

    port.shutdown();
    assert!(!port.has_abandoned_requests() && !port.sockets.has_polls_in_flight());
    assert!(result.borrow().is_none() && events.borrow().is_empty());
    registration.set_interest(Readiness::SEND);
    let failed_read = pipes[0].0.read(Vec::new(), 0, |_| unreachable!());
    assert_eq!(failed_read.err().unwrap().status, NTSTATUS::CANCELLED);
}

const fn to_return_value(status: NTSTATUS) -> usize {
    status.0 as usize
}

/// `NULL` or `FALSE`.
const WIN32_FAILURE: usize = 0;
const NO_RESOURCES: usize = to_return_value(NTSTATUS::INSUFFICIENT_RESOURCES);

fn has_wait_packets() -> bool {
    matches!(sys::WaitPacket::new(), Ok(Some(_)))
}

fn count_calls(call: Call) -> (faults::InterceptGuard, Rc<Cell<usize>>) {
    let call_count = Rc::new(Cell::new(0));
    let call_count_clone = Rc::clone(&call_count);
    let interceptor = move |_: &[usize]| {
        call_count_clone.update(|count| count + 1);
        None
    };
    (intercept(call, interceptor), call_count)
}

fn assert_pending_read_completes(port: &Port, file: &OverlappedFile, peer: &bun_sys::File) {
    let result = Rc::default();
    let _read = start_read(file, &result);
    run_iteration(port, Duration::ZERO);
    peer.write_all(b"some").unwrap();
    run_until(port, || result.borrow().is_some());
    assert_eq!(result.take().unwrap().buffer, b"some");
    run_iteration(port, Duration::from_millis(1));
    assert_eq!(port.callback_count(), 0);
}

#[test]
fn all_tests_pass_without_wait_packets() {
    if !has_wait_packets() {
        return;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .env(faults::NO_WAIT_PACKETS_ENV, "1")
        .output()
        .unwrap();
    let stdout = bun_core::fmt::s(&output.stdout);
    assert!(output.status.success(), "{stdout}");
}

#[test]
fn iteration_drains_multiple_batches() {
    let port = Port::new().unwrap();
    let mut writes = Vec::new();
    let completed_count = Rc::new(Cell::new(0));
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    for _ in 0..300 {
        let completed_count = Rc::clone(&completed_count);
        let write = file.write(vec![0], 0, move |_| {
            completed_count.update(|count| count + 1)
        });
        writes.push(write.unwrap_or_else(|_| panic!("failed to start")));
    }
    run_iteration(&port, Duration::from_secs(10));
    assert_eq!(completed_count.get(), 300);
}

#[test]
fn dispatch_returns_despite_endless_full_batches() {
    fn write_repeatedly(file: &Rc<OverlappedFile>, writes: &Rc<RefCell<Vec<Request>>>) {
        let file_clone = Rc::clone(file);
        let writes_clone = Rc::clone(writes);
        let write = file.write(Vec::new(), 0, move |_| {
            write_repeatedly(&file_clone, &writes_clone)
        });
        writes
            .borrow_mut()
            .push(write.unwrap_or_else(|_| panic!("failed to start")));
    }
    let port = Port::new().unwrap();
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let file = Rc::new(file);
    let writes = Rc::default();
    for _ in 0..200 {
        write_repeatedly(&file, &writes);
    }
    run_iteration(&port, Duration::from_secs(10));
    assert_eq!(port.callback_count(), 200);
    writes.take();
}

#[test]
fn port_creation_failure_is_returned() {
    let _failure = fail(Call::CreateIoCompletionPort, usize::MAX, WIN32_FAILURE);
    assert!(Port::new().is_err());
    let ours = PipeMode::Overlapped;
    let theirs = PipeMode::Synchronous;
    let pair = w::create_pipe_pair(ours, theirs, PipeDirection::Inbound).unwrap();
    assert!(crate::read_to_end([Some(pair.ours)]).is_err());
    assert!(crate::read_to_end([None, None]).is_ok());
}

#[test]
#[should_panic = "NtSetIoCompletion failed"]
fn wake_panics_when_post_fails() {
    let port = Port::new().unwrap();
    let _failure = fail(Call::NtSetIoCompletion, 1, NO_RESOURCES);
    port.waker().wake();
}

const SPAWN_WARMING: fn(Box<dyn FnOnce() + Send>) = |job| new_warmup_pool().go(job);
const SPAWN_AFTER_FAILED_ATTEMPTS: fn(Box<dyn FnOnce() + Send>) =
    |job| spawn_after_attempts(3, false, job);
const SPAWN_AFTER_ONE_SUCCESS: fn(Box<dyn FnOnce() + Send>) =
    |job| spawn_after_attempts(1, true, job);
const SPAWN_AFTER_MAX_SUCCESSES: fn(Box<dyn FnOnce() + Send>) =
    |job| spawn_after_attempts(2, true, job);
const SPAWN_WITHOUT_WARMUP: fn(Box<dyn FnOnce() + Send>) = |job| leak_pool(false).go(job);
const SPAWN_UNPOOLED: fn(Box<dyn FnOnce() + Send>) = |job| drop(std::thread::spawn(job));

fn spawn_after_attempts(attempt_count: usize, should_succeed: bool, job: Box<dyn FnOnce() + Send>) {
    let pool = new_warmup_pool();
    pool.go(move || {
        pool.go(job);
        for _ in 0..attempt_count {
            try_during_warmup(|| should_succeed);
        }
    });
}

fn new_warmup_pool() -> &'static FifoPool {
    leak_pool(true)
}

fn leak_pool(has_warmup: bool) -> &'static FifoPool {
    Box::leak(Box::new(FifoPool::new(Config {
        name: "Test",
        max_threads: 1,
        stack_size: 256 * 1024,
        on_thread_start: || {},
        has_warmup,
    })))
}

/// The thread stays in warm-up until the returned sender is dropped.
fn spawn_warming_thread() -> mpsc::Sender<()> {
    let (tx, rx) = mpsc::channel();
    new_warmup_pool().go(move || assert!(try_during_warmup(|| rx.recv().is_err())));
    tx
}

/// `measure_wake` after a long run of the port's thread, while a pool thread is warming up.
fn measure_wake_after_long_run(
    port: &Port,
    spawn: fn(Box<dyn FnOnce() + Send>),
    job: impl FnOnce() + Send + 'static,
) -> (usize, usize) {
    let _warming_thread = spawn_warming_thread();
    advance_clock(Duration::from_millis(2));
    measure_wake(port, spawn, job)
}

/// Runs one iteration and spawns `job` when the port blocks. Returns the wake count and how many packets `job` posted.
fn measure_wake(
    port: &Port,
    spawn: fn(Box<dyn FnOnce() + Send>),
    job: impl FnOnce() + Send + 'static,
) -> (usize, usize) {
    let mut job = Some(job);
    let post_count = Rc::new(Cell::new(0));
    let post_count_clone = Rc::clone(&post_count);
    let _guard = intercept(Call::NtRemoveIoCompletionEx, move |args| {
        // SAFETY: `args[4]` is the `Timeout` pointer, which is null or valid during the call.
        let timeout = unsafe { ptr::with_exposed_provenance::<i64>(args[4]).as_ref() };
        let job = job.take_if(|_| timeout != Some(&0))?;
        let (tx, rx) = mpsc::channel();
        spawn(Box::new(move || {
            let (_guard, post_count) = count_calls(Call::NtSetIoCompletion);
            job();
            tx.send(post_count.get()).unwrap();
        }));
        post_count_clone.set(rx.recv().unwrap());
        None
    });
    let wake_count = run_iteration(port, Duration::from_secs(10));
    (wake_count, post_count.get())
}

fn new_counted_request(
    port: &Rc<Port>,
    completed_count: &Rc<Cell<usize>>,
) -> (Request, Completer<()>) {
    let completed_count = Rc::clone(completed_count);
    Request::with_completer(port, move |()| completed_count.update(|count| count + 1))
}

fn assert_wait_times_out(port: &Port) {
    let _warming_thread = spawn_warming_thread();
    let start = Instant::now();
    assert_eq!(run_iteration(port, Duration::from_millis(20)), 0);
    assert!(start.elapsed() >= Duration::from_millis(20));
}

#[test]
fn warming_thread_wakes_parked_port_with_event() {
    let port = Port::new().unwrap();
    let completed_count = Rc::default();
    let fallback_post_count = usize::from(!has_wait_packets());
    for (spawn, post_count) in [
        (SPAWN_WARMING, fallback_post_count),
        (SPAWN_AFTER_FAILED_ATTEMPTS, fallback_post_count),
        (SPAWN_AFTER_ONE_SUCCESS, fallback_post_count),
        (SPAWN_AFTER_MAX_SUCCESSES, 1),
        (SPAWN_WITHOUT_WARMUP, 1),
        (SPAWN_UNPOOLED, 1),
        (SPAWN_WARMING, fallback_post_count),
    ] {
        let waker = port.waker();
        let counts = measure_wake_after_long_run(&port, spawn, move || waker.wake());
        assert_eq!(counts, (1, post_count));
        assert_wait_times_out(&port);

        let (_request, completer) = new_counted_request(&port, &completed_count);
        let counts = measure_wake_after_long_run(&port, spawn, || completer.complete(()));
        assert_eq!((counts, completed_count.take()), ((0, post_count), 1));
        assert_wait_times_out(&port);

        for is_wake_first in [true, false] {
            let (_request, completer) = new_counted_request(&port, &completed_count);
            let waker = port.waker();
            let counts = measure_wake_after_long_run(&port, spawn, move || {
                if is_wake_first {
                    waker.wake();
                    completer.complete(());
                } else {
                    completer.complete(());
                    waker.wake();
                }
            });
            assert_eq!((counts, completed_count.take()), ((1, post_count + 1), 1));
            assert_wait_times_out(&port);
        }
    }
}

#[test]
fn timed_wait_boosts_thread_priority() {
    const REALTIME_PRIORITY_CLASS: usize = 0x100;
    if !has_multiple_cpus() {
        return;
    }
    let port = Port::new().unwrap();
    let set_priorities = Rc::new(RefCell::new(Vec::new()));
    let set_priorities_clone = Rc::clone(&set_priorities);
    let _set_guard = intercept(Call::NtSetInformationThread, move |args| {
        // SAFETY: `args[2]` is `ThreadInformation`, which points to the new priority.
        let priority = unsafe { *ptr::with_exposed_provenance::<i32>(args[2]) };
        set_priorities_clone.borrow_mut().push(priority);
        None
    });
    let class = Rc::new(Cell::new(sys::NORMAL_PRIORITY_CLASS as usize));
    let class_clone = Rc::clone(&class);
    let _class_guard = intercept(Call::GetPriorityClass, move |_| Some(class_clone.get()));
    let queried_priorities = Rc::new(Cell::new([0, 0]));
    let queried_priorities_clone = Rc::clone(&queried_priorities);
    let _query_guard = intercept(Call::NtQueryInformationThread, move |args| {
        // SAFETY: `args[2]` is the `ThreadInformation` out-pointer.
        let info: &mut sys::THREAD_BASIC_INFORMATION =
            unsafe { &mut *ptr::with_exposed_provenance_mut(args[2]) };
        [info.Priority, info.BasePriority] = queried_priorities_clone.get();
        Some(0)
    });
    freeze_clock();
    let advance_ms = |ms| advance_clock(Duration::from_millis(ms));
    // Returns the priorities that were set during the iteration.
    let sleep = |timeout_ms, is_woken_early: bool| {
        let waker = port.waker();
        let _guard = intercept(Call::NtRemoveIoCompletionEx, move |_| {
            if is_woken_early {
                waker.wake();
                None
            } else {
                advance_ms(timeout_ms);
                Some(to_return_value(NTSTATUS::TIMEOUT))
            }
        });
        run_iteration(&port, Duration::from_millis(timeout_ms));
        set_priorities.take()
    };
    assert_eq!(sleep(1_001, false), []);
    assert_eq!(sleep(10, false), [10, 8]);
    assert_eq!(sleep(20, false), [11, 8]);

    let counts_after_long_runs = [50, 0, 50, 5_000, 0].map(|run_ms| {
        advance_ms(run_ms);
        sleep(1, false).len()
    });
    assert_eq!(counts_after_long_runs, [2, 2, 0, 2, 2]);

    let counts_under_load = [(); 8].map(|()| {
        advance_ms(4);
        sleep(1, false).len()
    });
    assert_eq!(counts_under_load, [2, 2, 2, 2, 2, 0, 0, 0]);
    assert_eq!(sleep(60, false), [11, 8]);

    let early_wake_priorities = [(); 5].map(|()| sleep(10, true)).concat();
    assert_eq!(early_wake_priorities, [10, 10, 10, 10, 8]);
    assert_eq!(sleep(10, false), []);

    let busy_early_wake_priorities = [(); 3]
        .map(|()| {
            advance_ms(5);
            sleep(500, true)
        })
        .concat();
    assert_eq!(busy_early_wake_priorities, [11, 8]);
    assert_eq!(sleep(10, false), [10, 8]);

    class.set(sys::IDLE_PRIORITY_CLASS as usize);
    assert_eq!(sleep(10, false), [6, 4]);
    class.set(REALTIME_PRIORITY_CLASS);
    assert_eq!(sleep(10, false), []);
    class.set(sys::NORMAL_PRIORITY_CLASS as usize);
    for (dynamic_and_base, expected_count) in [([9, 0], 2), ([10, 0], 0), ([9, 1], 0)] {
        queried_priorities.set(dynamic_and_base);
        assert_eq!(sleep(10, false).len(), expected_count);
    }
    queried_priorities.set([8, 0]);
    let _boost_guard = intercept(Call::GetThreadPriorityBoost, |args| {
        // SAFETY: `args[1]` is the `pDisablePriorityBoost` out-pointer.
        unsafe { ptr::with_exposed_provenance_mut::<i32>(args[1]).write(1) };
        Some(1)
    });
    assert_eq!(sleep(10, false), []);
}

#[test]
fn delayed_set_event_still_delivers_wake() {
    if !has_wait_packets() {
        return;
    }
    let port = Port::new().unwrap();
    let completed_count = Rc::default();
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    for is_prefetched in [false, true] {
        let (_request, completer) = new_counted_request(&port, &completed_count);
        let waker = port.waker();
        let (event_tx, event_rx) = mpsc::channel();
        let counts = measure_wake_after_long_run(&port, SPAWN_WARMING, move || {
            let _guard = intercept(Call::SetEvent, move |args| {
                event_tx.send(args[0]).unwrap();
                Some(1)
            });
            waker.wake();
            completer.complete(());
        });
        assert_eq!((counts, completed_count.take()), ((0, 1), 1));

        let (_request, completer) = new_counted_request(&port, &completed_count);
        let counts = measure_wake_after_long_run(&port, SPAWN_WARMING, || completer.complete(()));
        assert_eq!((counts, completed_count.take()), ((0, 1), 1));

        let event = ptr::with_exposed_provenance_mut(event_rx.recv().unwrap());
        // SAFETY: the port keeps the event handle open.
        let event = unsafe { BorrowedHandle::borrow_raw(event) };
        w::set_event(&event.try_clone_to_owned().unwrap());
        if is_prefetched {
            assert!(start_read(&file, &Rc::default()).cancel_and_wait().is_ok());
        }
        assert_eq!(run_iteration(&port, Duration::ZERO), 1);
        assert_wait_times_out(&port);
    }
}

#[test]
fn wake_falls_back_to_post_when_event_setup_fails() {
    for (call, result) in [
        (Call::NtCreateWaitCompletionPacket, NO_RESOURCES),
        (Call::CreateEventW, WIN32_FAILURE),
        (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
    ] {
        let port = Port::new().unwrap();
        let failure = fail(call, usize::MAX, result);
        let waker = port.waker();
        assert_eq!(
            measure_wake_after_long_run(&port, SPAWN_WARMING, move || waker.wake()),
            (1, 1)
        );
        drop(failure);
        let waker = port.waker();
        let fallback_post_count = usize::from(!has_wait_packets());
        let counts = measure_wake_after_long_run(&port, SPAWN_WARMING, move || waker.wake());
        assert_eq!(counts, (1, fallback_post_count));
    }
}

#[test]
fn wake_skips_event_for_running_or_dropped_port() {
    let port = Port::new().unwrap();
    let wake_sets_event = |waker: Waker| {
        let (tx, rx) = mpsc::channel();
        new_warmup_pool().go(move || {
            let (_guard, set_count) = count_calls(Call::SetEvent);
            waker.wake();
            tx.send(set_count.get() > 0).unwrap();
        });
        rx.recv().unwrap()
    };
    assert_wait_times_out(&port);
    assert!(!wake_sets_event(port.waker()));
    assert_eq!(run_iteration(&port, Duration::ZERO), 1);

    assert_wait_times_out(&port);
    let waker = port.waker();
    drop(port);
    assert!(!wake_sets_event(waker));
}

#[test]
fn event_wake_without_warming_thread_requires_short_run() {
    const ISOLATED_ENV: &str = "BUN_IOCP_TEST_ALONE";
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Test",
        max_threads: 2,
        stack_size: 256 * 1024,
        on_thread_start: || {},
        has_warmup: true,
    });
    // The count of warming threads is process-wide, so rerun in a separate process.
    if std::env::var_os(ISOLATED_ENV).is_none() {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.arg("event_wake_without_warming_thread_requires_short_run");
        let output = command.env(ISOLATED_ENV, "1").output().unwrap();
        assert!(output.status.success());
        return;
    }
    let (unblock_tx, unblock_rx) = mpsc::channel::<()>();
    let (started_tx, started_rx) = mpsc::channel();
    POOL.go(move || {
        started_tx.send(()).unwrap();
        assert!(try_during_warmup(|| unblock_rx.recv().is_err()));
    });
    started_rx.recv().unwrap();
    let failure = fail(Call::CreateThread, 1, WIN32_FAILURE);
    POOL.go(|| {});
    assert!(has_warming_thread());
    drop((failure, unblock_tx));

    let port = Port::new().unwrap();
    let other_port = Port::new().unwrap();
    let start = Instant::now();
    run_until(&other_port, || !has_warming_thread());

    let pool = new_warmup_pool();
    let (state_tx, state_rx) = mpsc::channel();
    let recv_state = || state_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    for (attempt_count, should_succeed, is_warming) in
        [(1, false, true), (1, true, true), (1, true, false)]
    {
        let state_tx = state_tx.clone();
        pool.go(move || {
            let call_count = Cell::new(0);
            for _ in 0..attempt_count {
                try_during_warmup(|| {
                    call_count.update(|count| count + 1);
                    should_succeed
                });
            }
            state_tx
                .send((call_count.get() == attempt_count, has_warming_thread()))
                .unwrap();
        });
        assert_eq!(recv_state(), (is_warming, is_warming));
        run_iteration(&other_port, Duration::from_millis(20));
        run_until(&other_port, || has_warming_thread() != should_succeed);
    }
    let send_state = move || {
        state_tx
            .send((try_during_warmup(|| true), has_warming_thread()))
            .unwrap()
    };
    spawn_after_attempts(2, true, Box::new(send_state));
    assert_eq!(recv_state(), (false, false));
    assert!(
        start.elapsed() < Duration::from_secs(9),
        "pool threads reached the idle timeout"
    );

    freeze_clock();
    let (_guard, created_count) = count_calls(Call::CreateEventW);
    let event_count = usize::from(has_wait_packets());
    for (run_us, signal_count) in [(2_000, 0), (900, event_count), (1_000, 0), (0, event_count)] {
        advance_clock(Duration::from_micros(run_us));
        let waker = port.waker();
        let counts = measure_wake(&port, SPAWN_UNPOOLED, move || waker.wake());
        assert_eq!(counts, (1, 1 - signal_count));
        assert_eq!(
            created_count.get(),
            if run_us == 2_000 { 0 } else { event_count }
        );
    }
    for (requester, signal_count) in [("self", 0), ("thread", 0), ("loop", event_count)] {
        let waker = port.waker();
        let counts = measure_wake(&port, SPAWN_UNPOOLED, move || {
            let sender_port = Port::new().unwrap();
            let sender_waker = sender_port.waker();
            let wake_sender = move || {
                let _loop_waker = (requester == "loop").then(|| Port::new().unwrap().waker());
                sender_waker.wake();
            };
            match requester {
                "self" => wake_sender(),
                _ => std::thread::spawn(wake_sender).join().unwrap(),
            }
            run_iteration(&sender_port, Duration::ZERO);
            waker.wake();
        });
        assert_eq!(
            counts,
            (1, 1 - signal_count + usize::from(requester == "self"))
        );
    }
}

#[test]
fn concurrent_wakes_and_completions_are_not_lost() {
    let port = Port::new().unwrap();
    let completed_count = Rc::default();
    let spin = |count| (0..count % 4000).for_each(|_| core::hint::spin_loop());
    for round in 0..300 {
        let has_wake = round % 3 != 0;
        let has_completion = round % 3 != 1;
        let _request = has_completion.then(|| {
            let (request, completer) = new_counted_request(&port, &completed_count);
            new_warmup_pool().go(move || {
                spin(round * 7);
                completer.complete(());
            });
            request
        });
        if has_wake {
            let waker = port.waker();
            new_warmup_pool().go(move || {
                spin(round * 13);
                waker.wake();
            });
        }
        let start = Instant::now();
        let mut wake_count = 0;
        while (wake_count, completed_count.get()) != (has_wake.into(), has_completion.into()) {
            port.note_receive();
            wake_count += run_iteration(&port, Duration::from_secs(10));
            assert!(start.elapsed() < Duration::from_secs(9));
        }
        completed_count.set(0);
    }
}

#[test]
fn wait_times_out_without_high_resolution_timer() {
    for (call, result) in [
        (Call::NtCreateWaitCompletionPacket, NO_RESOURCES),
        (Call::CreateWaitableTimerExW, WIN32_FAILURE),
        (Call::SetWaitableTimer, WIN32_FAILURE),
        (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
    ] {
        let port = Port::new().unwrap();
        let _failure = fail(call, usize::MAX, result);
        let start = Instant::now();
        run_iteration(&port, Duration::from_millis(20));
        let range = Duration::from_millis(20)..Duration::from_secs(5);
        assert!(range.contains(&start.elapsed()), "{call:?}");
    }
}

#[test]
fn failed_wait_request_releases_slot() {
    let failures = if has_wait_packets() {
        [
            (Call::NtCreateWaitCompletionPacket, NO_RESOURCES),
            (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
        ]
    } else {
        [
            (Call::DuplicateHandle, WIN32_FAILURE),
            (Call::CreateEventW, WIN32_FAILURE),
        ]
    };
    for (call, result) in failures {
        let port = Port::new().unwrap();
        let event = w::CreateEventW().unwrap();
        w::set_event(&event);
        let _failure = fail(call, 1, result);
        let failed_wait = Request::wait(&port, event.as_handle(), || unreachable!());
        assert_eq!(failed_wait.err(), Some(NTSTATUS::INSUFFICIENT_RESOURCES));
        assert_eq!(port.callback_count(), 0);
        assert_eq!(port.requests.used_slot_count(), 0);

        let _wait = Request::wait(&port, event.as_handle(), || {}).unwrap();
        run_until(&port, || port.callback_count() == 0);
    }
}

#[test]
fn dropped_wait_keeps_slot_until_packet_arrives() {
    if !has_wait_packets() {
        return;
    }
    let port = Port::new().unwrap();
    let first_event = w::CreateEventW().unwrap();
    let second_event = w::CreateEventW().unwrap();
    let first_wait = Request::wait(&port, first_event.as_handle(), || unreachable!()).unwrap();
    let pending = to_return_value(NTSTATUS::PENDING);
    let _failure = fail(Call::NtCancelWaitCompletionPacket, 1, pending);
    drop(first_wait);
    let _second_wait = Request::wait(&port, second_event.as_handle(), || {}).unwrap();
    w::set_event(&first_event);
    run_iteration(&port, Duration::from_secs(10));
    assert_eq!(port.callback_count(), 1);
    w::set_event(&second_event);
    run_until(&port, || port.callback_count() == 0);
}

#[test]
fn read_falls_back_to_event_when_bind_fails() {
    for call in [
        Call::CreateIoCompletionPort,
        Call::SetFileCompletionNotificationModes,
    ] {
        let port = Port::new().unwrap();
        let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
        let _failure = fail(call, 1, WIN32_FAILURE);
        assert_pending_read_completes(&port, &file, &peer);
        assert_pending_read_completes(&port, &file, &peer);
    }
}

#[test]
fn read_completes_on_file_bound_to_other_port() {
    let port = Port::new().unwrap();
    let other_port = Port::new().unwrap();
    let (first, peer) = create_pipe(&other_port, OverlappedFile::new_exclusive);
    assert_pending_read_completes(&other_port, &first, &peer);
    let second = OverlappedFile::new_exclusive(&port, Arc::clone(first.handle()));
    assert_pending_read_completes(&port, &second, &peer);
}

#[test]
fn request_that_fails_to_start_returns_buffer() {
    let mut failures = vec![(Call::CreateEventW, WIN32_FAILURE)];
    if has_wait_packets() {
        failures.push((Call::NtCreateWaitCompletionPacket, NO_RESOURCES));
    }
    for (call, result) in failures {
        let port = Port::new().unwrap();
        let (file, peer) = create_pipe(&port, OverlappedFile::new_shared);
        let _failure = fail(call, 1, result);
        let failed_write = file.write(b"kept".to_vec(), 0, |_| unreachable!());
        let completion = failed_write.err().unwrap();
        assert_eq!(completion.status, NTSTATUS::INSUFFICIENT_RESOURCES);
        assert_eq!(
            (completion.transferred, &*completion.buffer),
            (0, &b"kept"[..])
        );
        assert_eq!(port.callback_count(), 0);
        assert_pending_read_completes(&port, &file, &peer);
    }
}

#[test]
fn request_is_cancelled_when_notifier_association_fails() {
    let (call, result) = if has_wait_packets() {
        (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES)
    } else {
        (Call::DuplicateHandle, WIN32_FAILURE)
    };
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_shared);
    let read_result = Rc::default();
    let _failure = fail(call, 1, result);
    let read = start_read(&file, &read_result);
    assert!(port.prepare() && read_result.borrow().is_none());
    run_until(&port, || read_result.borrow().is_some());
    assert_eq!(read_result.take().unwrap().status, NTSTATUS::CANCELLED);
    read.cancel();
    assert_pending_read_completes(&port, &file, &peer);
}

#[test]
fn cancel_and_wait_returns_request_when_cancel_is_ignored() {
    let port = Port::new().unwrap();
    for new_file in FILE_CONSTRUCTORS {
        let (file, peer) = create_pipe(&port, new_file);
        let result = Rc::default();
        let read = start_read(&file, &result);
        let success = to_return_value(NTSTATUS::SUCCESS);
        let ignored_cancel = fail(Call::NtCancelIoFileEx, 1, success);
        let timeouts = Rc::new(RefCell::new(Vec::new()));
        let timeouts_clone = Rc::clone(&timeouts);
        let instant_timeout = intercept(Call::NtRemoveIoCompletionEx, move |args| {
            // SAFETY: `args[4]` is the `Timeout` pointer, which is null or valid during the call.
            let timeout = unsafe { ptr::with_exposed_provenance::<i64>(args[4]).as_ref() };
            timeouts_clone.borrow_mut().push(timeout.copied());
            Some(to_return_value(NTSTATUS::TIMEOUT))
        });
        freeze_clock();
        let _read = read.cancel_and_wait().err().unwrap();
        FROZEN_TIME.set(None);
        assert_eq!(timeouts.take(), [Some(-10_000_000)]);
        drop((ignored_cancel, instant_timeout));
        peer.write_all(b"late").unwrap();
        run_until(&port, || result.borrow().is_some());
        assert_eq!(result.take().unwrap().buffer, b"late");
    }
}

#[test]
fn cancel_and_wait_drains_port_after_deadline() {
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let read = start_read(&file, &Rc::default());
    for _ in 0..300 {
        sys::post_packet(&port.shared.handle, key::TIMER, 0);
    }
    peer.write_all(b"last").unwrap();
    CLOCK_STEP.set(Duration::from_secs(2));
    assert_eq!(read.cancel_and_wait().ok().unwrap().buffer, b"last");
}

#[test]
fn cancel_and_wait_outlasts_unrelated_packets() {
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let read = start_read(&file, &Rc::default());
    let success = to_return_value(NTSTATUS::SUCCESS);
    let _ignored_cancel = fail(Call::NtCancelIoFileEx, 1, success);
    let port_clone = Rc::clone(&port);
    let mut dequeue_count = 0;
    let _guard = intercept(Call::NtRemoveIoCompletionEx, move |_| {
        dequeue_count += 1;
        if dequeue_count < 2000 {
            sys::post_packet(&port_clone.shared.handle, key::TIMER, 0);
        } else {
            peer.write_all(b"last").unwrap();
        }
        None
    });
    assert_eq!(read.cancel_and_wait().ok().unwrap().buffer, b"last");
}

#[test]
fn shutdown_times_out_when_cancel_is_ignored() {
    let port = Port::new().unwrap();
    let (socket, mut socket_peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &socket);
    registration.set_interest(Readiness::RECEIVE);
    let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let result = Rc::default();
    let read = start_read(&file, &result);
    run_iteration(&port, Duration::ZERO);

    let success = to_return_value(NTSTATUS::SUCCESS);
    let _ignored_cancel = fail(Call::NtCancelIoFileEx, 2, success);
    CLOCK_STEP.set(Duration::from_secs(11));
    port.shutdown();
    assert!(port.has_abandoned_requests() && port.sockets.has_polls_in_flight());
    let handle = Arc::clone(file.handle());
    drop((registration, read, file, port));
    peer.write_all(b"late").unwrap();
    socket_peer.write_all(b"late").unwrap();
    drop(handle);
    assert!(result.borrow().is_none() && events.borrow().is_empty());
}

#[test]
fn failed_registration_can_be_retried_until_shutdown() {
    let (socket, mut peer) = create_socket_pair();
    peer.write_all(b"x").unwrap();
    for (call, result) in [
        (Call::NtCreateFile, NO_RESOURCES),
        (Call::CreateIoCompletionPort, WIN32_FAILURE),
        (Call::SetFileCompletionNotificationModes, WIN32_FAILURE),
    ] {
        let port = Port::new().unwrap();
        let _failure = fail(call, 1, result);
        let handler = ReadinessHandler::Callback(Rc::new(|_| unreachable!()));
        assert!(SocketRegistration::new(&port, socket.as_raw_socket() as usize, handler).is_err());
        assert_eq!(port.callback_count(), 0);

        let (registration, events) = register_socket(&port, &socket);
        registration.set_interest(Readiness::RECEIVE);
        run_until(&port, || !events.borrow().is_empty());

        port.shutdown();
        let handler = ReadinessHandler::Callback(Rc::new(|_| unreachable!()));
        assert!(SocketRegistration::new(&port, socket.as_raw_socket() as usize, handler).is_err());
    }
}

#[test]
fn failed_poll_is_reported_and_retried() {
    let port = Port::new().unwrap();
    let (socket, mut peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &socket);
    peer.write_all(b"x").unwrap();
    for interest in [
        Readiness::RECEIVE,
        Readiness::SEND,
        Readiness::RECEIVE | Readiness::DISCONNECT,
    ] {
        let invalid_handle = to_return_value(NTSTATUS::INVALID_HANDLE);
        let _failure = fail(Call::NtDeviceIoControlFile, 1, invalid_handle);
        registration.set_interest(interest);
        for _ in 0..3 {
            run_iteration(&port, Duration::from_millis(1));
        }
        assert_eq!(events.take(), [Readiness::POLL_FAILED]);

        advance_clock(Duration::from_secs(1));
        run_until(&port, || !events.borrow().is_empty());
        registration.set_interest(Readiness::empty());
        run_iteration(&port, Duration::ZERO);
        assert!(events.take().iter().all(|ready| interest.contains(*ready)));
    }
}

#[test]
fn poll_is_retried_silently_on_insufficient_resources() {
    let port = Port::new().unwrap();
    let (socket, mut peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &socket);
    peer.write_all(b"x").unwrap();
    let _failure = fail(Call::NtDeviceIoControlFile, 3, NO_RESOURCES);
    registration.set_interest(Readiness::RECEIVE);
    run_until(&port, || !events.borrow().is_empty());
    assert_eq!(events.borrow()[0], Readiness::RECEIVE);
}

#[test]
fn closed_socket_is_not_polled_again() {
    let port = Port::new().unwrap();
    let (socket, _peer) = create_socket_pair();
    let (registration, events) = register_socket(&port, &socket);
    registration.set_interest(Readiness::RECEIVE);
    run_iteration(&port, Duration::ZERO);
    drop(socket);
    let (_guard, poll_count) = count_calls(Call::NtDeviceIoControlFile);
    for _ in 0..3 {
        run_iteration(&port, Duration::from_millis(20));
    }
    assert_eq!((poll_count.get(), events.take()), (0, Vec::new()));
}

#[test]
fn set_user_data_applies_to_pending_poll() {
    let port = Port::new().unwrap();
    let (socket, _peer) = create_socket_pair();
    let [old_data, new_data] =
        [8, 16].map(|address| NonNull::new(ptr::without_provenance_mut(address)).unwrap());
    let handler = ReadinessHandler::UserData(old_data);
    let registration =
        SocketRegistration::new(&port, socket.as_raw_socket() as usize, handler).unwrap();
    registration.set_interest(Readiness::SEND);
    port.prepare();
    registration.set_user_data(new_data);
    let reported_data = Cell::new(None);
    port.wait(Some(10_000_000_000));
    port.dispatch(|event| match event {
        Event::Socket(user_data, _) => reported_data.set(Some(user_data)),
        Event::Wake => unreachable!(),
    });
    assert_eq!(reported_data.get(), Some(new_data));
    port.shutdown();
    registration.set_user_data(old_data);
}

#[test]
fn base_socket_lookup_falls_back_to_bsp_handle_poll() {
    const SIO_BASE_HANDLE: u32 = 0x4800_0022;
    const SOCKET_ERROR: usize = usize::MAX;
    let (socket, _peer) = create_socket_pair();
    let base = socket.as_raw_socket() as usize;
    let simulate_lsp = |next_layer: fn(usize, usize) -> Option<usize>| {
        intercept(Call::WSAIoctl, move |args| {
            if args[1] as u32 == SIO_BASE_HANDLE {
                return Some(SOCKET_ERROR);
            }
            let Some(bsp_socket) = next_layer(args[0], base) else {
                return Some(SOCKET_ERROR);
            };
            // SAFETY: `args[4]` is `lpvOutBuffer`, which is large enough for a socket.
            unsafe { ptr::with_exposed_provenance_mut::<usize>(args[4]).write(bsp_socket) };
            Some(0)
        })
    };
    let two_layers = simulate_lsp(|socket, base| Some((socket - 4).max(base)));
    assert_eq!(sys::find_base_socket(base + 8), Ok(base));
    drop(two_layers);
    let unsupported = simulate_lsp(|_, _| None);
    assert_eq!(sys::find_base_socket(base), Ok(base));
    drop(unsupported);
    let _cyclic = simulate_lsp(|socket, _| Some(socket ^ 4));
    assert!(sys::find_base_socket(base).is_ok());
}

#[test]
fn base_socket_lookup_tries_every_bsp_handle() {
    const SIO_BASE_HANDLE: u32 = 0x4800_0022;
    const SOCKET_ERROR: usize = usize::MAX;
    let (socket, _peer) = create_socket_pair();
    let base = socket.as_raw_socket() as usize;
    for passed_through in [0x4800_001B, 0x4800_001C, 0x4800_001D] {
        let _lsp = intercept(Call::WSAIoctl, move |args| {
            let bsp_socket = match args[1] as u32 {
                SIO_BASE_HANDLE => return Some(SOCKET_ERROR),
                control_code if control_code == passed_through => base,
                _ => args[0],
            };
            // SAFETY: `args[4]` is `lpvOutBuffer`, which is large enough for a socket.
            unsafe { ptr::with_exposed_provenance_mut::<usize>(args[4]).write(bsp_socket) };
            Some(0)
        });
        assert_eq!(sys::find_base_socket(base + 4), Ok(base));
    }
}

#[test]
fn cancel_token_runs_closure_when_thread_setup_fails() {
    for call in [Call::OpenThread, Call::CreateEventW] {
        let run = move || {
            let _failure = fail(call, 1, WIN32_FAILURE);
            CancelToken::default().run(|| 7)
        };
        assert_eq!(std::thread::spawn(run).join().unwrap(), Some(7));
    }
}

#[test]
fn cancel_is_retried_until_call_returns() {
    let pair = w::create_pipe_pair(
        PipeMode::Synchronous,
        PipeMode::Synchronous,
        PipeDirection::Inbound,
    );
    let pair = pair.unwrap();
    let file = bun_sys::File::from(pair.ours);
    let fd = file.fd();
    let token = CancelToken::default();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (proceed_tx, proceed_rx) = mpsc::channel();
    let token_clone = token.clone();
    let reader = std::thread::spawn(move || {
        token_clone.run(|| {
            entered_tx.send(()).unwrap();
            proceed_rx.recv().unwrap();
            bun_sys::read(fd, &mut [0; 8]).map_err(|err| err.get_errno())
        })
    });
    entered_rx.recv().unwrap();
    token.cancel();
    token.cancel();
    proceed_tx.send(()).unwrap();
    assert_eq!(reader.join().unwrap(), Some(Err(bun_sys::E::ECANCELED)));
}

#[test]
fn queued_task_runs_after_thread_spawn_failure() {
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Test",
        max_threads: 2,
        stack_size: 256 * 1024,
        on_thread_start: || {},
        has_warmup: false,
    });
    let (started_tx, started_rx) = mpsc::channel();
    let (proceed_tx, proceed_rx) = mpsc::channel();
    let started_tx_clone = started_tx.clone();
    POOL.go(move || {
        started_tx_clone.send(1).unwrap();
        proceed_rx.recv().unwrap();
    });
    assert_eq!(started_rx.recv(), Ok(1));

    let _failure = fail(Call::CreateThread, usize::MAX, WIN32_FAILURE);
    POOL.go(move || started_tx.send(2).unwrap());
    assert!(started_rx.try_recv().is_err());
    proceed_tx.send(()).unwrap();
    assert_eq!(started_rx.recv(), Ok(2));
}

/// Makes every later timed condition wait on this thread expire immediately. Sends whether each wait is timed.
fn expire_timed_waits(is_timed_tx: mpsc::Sender<bool>) {
    core::mem::forget(intercept(Call::SleepConditionVariableSRW, move |args| {
        let is_timed = args[2] as u32 != u32::MAX;
        _ = is_timed_tx.send(is_timed);
        is_timed.then_some(WIN32_FAILURE)
    }));
}

#[test]
fn pool_keeps_last_idle_thread() {
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Test",
        max_threads: 2,
        stack_size: 256 * 1024,
        on_thread_start: || {},
        has_warmup: false,
    });
    static BARRIER: Barrier = Barrier::new(2);
    let (is_timed_tx, is_timed_rx) = mpsc::channel();
    for is_timed_tx in [is_timed_tx.clone(), is_timed_tx] {
        POOL.go(move || {
            expire_timed_waits(is_timed_tx);
            BARRIER.wait();
        });
    }
    assert_eq!(
        [is_timed_rx.recv(), is_timed_rx.recv()],
        [Ok(false), Ok(true)]
    );

    let _failure = fail(Call::CreateThread, usize::MAX, WIN32_FAILURE);
    let (done_tx, done_rx) = mpsc::channel();
    POOL.go(move || done_tx.send(()).unwrap());
    assert_eq!(done_rx.recv(), Ok(()));
}

#[test]
fn idle_timeout_ends_warmup() {
    let pool = new_warmup_pool();
    let (is_timed_tx, is_timed_rx) = mpsc::channel();
    pool.go(move || expire_timed_waits(is_timed_tx));
    assert_eq!(
        [is_timed_rx.recv(), is_timed_rx.recv()],
        [Ok(true), Ok(false)]
    );

    let (is_warming_tx, is_warming_rx) = mpsc::channel();
    pool.go(move || is_warming_tx.send(try_during_warmup(|| true)).unwrap());
    assert_eq!(is_warming_rx.recv(), Ok(false));
}

#[test]
fn deferred_dispatch_time_scales_with_busy_time() {
    fn defer_repeatedly(
        port: &Rc<Port>,
        request: Rc<Cell<Option<Request>>>,
        round_count: Rc<Cell<usize>>,
    ) {
        let port_clone = Rc::clone(port);
        let request_clone = Rc::clone(&request);
        request.set(Some(Request::defer(port, move || {
            round_count.update(|count| count + 1);
            defer_repeatedly(&port_clone, request_clone, round_count)
        })));
    }
    let port = Port::new().unwrap();
    let request = Rc::default();
    let round_count = Rc::default();
    defer_repeatedly(&port, Rc::clone(&request), Rc::clone(&round_count));
    CLOCK_STEP.set(Duration::from_millis(1));
    for (busy_ms, expected) in [(0, 2..16), (50, 30..80), (0, 2..24), (9000, 60..120)] {
        advance_clock(Duration::from_millis(busy_ms));
        run_iteration(&port, Duration::ZERO);
        assert!(expected.contains(&round_count.take()), "{busy_ms}");
    }
    request.take();
}

#[test]
fn slow_iteration_spins_for_expected_data() {
    let port = Port::new().unwrap();
    for (busy_ms, should_spin) in [(0, false), (50, true)] {
        let start = Instant::now();
        run_iteration(&port, Duration::ZERO);
        let is_completed = Rc::new(Cell::new(false));
        let is_completed_clone = Rc::clone(&is_completed);
        let pending = Rc::new(Cell::new(None));
        let port_clone = Rc::clone(&port);
        let pending_clone = Rc::clone(&pending);
        let _deferred = Request::defer(&port, move || {
            let (request, completer) =
                Request::with_completer(&port_clone, move |()| is_completed_clone.set(true));
            pending_clone.set(Some(request));
            completer.complete(());
            port_clone.expect_more_data();
        });
        advance_clock(Duration::from_millis(busy_ms));
        run_iteration(&port, Duration::ZERO);
        if has_multiple_cpus() && (should_spin || start.elapsed() < Duration::from_millis(2)) {
            assert_eq!(is_completed.get(), should_spin);
        }
        run_until(&port, || is_completed.get());
    }
    port.expect_more_data();
    advance_clock(Duration::from_millis(50));
    assert_eq!(run_iteration(&port, Duration::ZERO), 0);
}

fn simulate_timer_overrun(port: &Port, busy_ms: u64) {
    advance_clock(Duration::from_millis(busy_ms));
    port.note_timers_drained();
    port.note_overdue_timer();
    run_iteration(port, Duration::ZERO);
}

#[test]
fn repeated_timer_overrun_grants_io_budget() {
    let port = Port::new().unwrap();
    freeze_clock();
    let take_full_budget = |busy_ms| {
        simulate_timer_overrun(&port, busy_ms);
        let granted = port.take_io_budget(usize::MAX);
        assert_eq!(port.is_io_starved(), granted > 0);
        granted
    };
    assert_eq!([50, 50, 1, 0].map(take_full_budget), [0, 16, 16, 0]);
    run_iteration(&port, Duration::ZERO);
    assert_eq!([50, 50].map(take_full_budget), [0, 16]);
    assert_eq!(port.iteration(), 7);

    port.note_timers_drained();
    advance_clock(Duration::from_millis(50));
    port.note_overdue_timer_and_tasks();
    run_iteration(&port, Duration::ZERO);
    assert!(!port.is_io_starved());

    let take_shares = || {
        simulate_timer_overrun(&port, 50);
        [99, 0, 1, 99, 99].map(|requested| port.take_io_budget(requested))
    };
    assert_eq!(take_shares(), [16, 0, 0, 0, 0]);
    simulate_timer_overrun(&port, 50);
    assert_eq!(take_shares(), [4, 0, 1, 4, 4]);
}

#[test]
fn sync_write_completes_in_same_iteration_when_io_starved() {
    for is_io_starved in [false, true] {
        let port = Port::new().unwrap();
        let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
        if is_io_starved {
            simulate_timer_overrun(&port, 50);
        }
        let result = Rc::default();
        let write = Rc::new(Cell::new(None));
        let done = store_completion(&result);
        let write_clone = Rc::clone(&write);
        let _deferred = Request::defer(&port, move || {
            write_clone.set(Some(file.write(vec![1], 0, done)));
        });
        simulate_timer_overrun(&port, 50);
        assert_eq!(result.borrow().is_some(), is_io_starved);
        run_until(&port, || result.borrow().is_some());
    }
}

#[test]
fn sync_write_does_not_overtake_readable_socket() {
    let port = Port::new().unwrap();
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let (ours, mut theirs) = create_socket_pair();
    let (registration, events) = register_socket(&port, &ours);
    registration.set_interest(Readiness::RECEIVE);
    theirs.write_all(b"x").unwrap();
    run_until(&port, || !events.take().is_empty());
    simulate_timer_overrun(&port, 50);
    let result = Rc::default();
    let write = Rc::new(Cell::new(None));
    let done = store_completion(&result);
    let write_clone = Rc::clone(&write);
    let _deferred = Request::defer(&port, move || {
        write_clone.set(Some(file.write(vec![1], 0, done)))
    });
    simulate_timer_overrun(&port, 50);
    assert!(port.is_io_starved() && result.borrow().is_none());
}

#[test]
fn sync_write_does_not_overtake_queued_socket_update() {
    let port = Port::new().unwrap();
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let (ours, _theirs) = create_socket_pair();
    let registration = Rc::new(register_socket(&port, &ours).0);
    simulate_timer_overrun(&port, 50);
    let result = Rc::default();
    let write = Rc::new(Cell::new(None));
    let port_clone = Rc::clone(&port);
    let done = store_completion(&result);
    let write_clone = Rc::clone(&write);
    let registration_clone = Rc::clone(&registration);
    let _deferred = Request::defer(&port, move || {
        core::mem::forget(Request::defer(&port_clone, move || {
            registration_clone.set_interest(Readiness::RECEIVE);
            write_clone.set(Some(file.write(vec![1], 0, done)));
        }));
    });
    simulate_timer_overrun(&port, 50);
    assert!(port.is_io_starved() && result.borrow().is_none());
}

#[test]
fn always_ready_socket_does_not_extend_iteration() {
    let port = Port::new().unwrap();
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let (ours, _theirs) = create_socket_pair();
    let event_count = Rc::new(Cell::new(0));
    let event_count_clone = Rc::clone(&event_count);
    let handler = ReadinessHandler::Callback(Rc::new(move |_| {
        event_count_clone.update(|count| count + 1);
        core::mem::forget(file.write(vec![1], 0, |_| {}));
    }));
    let registration =
        SocketRegistration::new(&port, ours.as_raw_socket() as usize, handler).unwrap();
    registration.set_interest(Readiness::SEND);
    let counts = [(); 4].map(|()| {
        simulate_timer_overrun(&port, 50);
        event_count.take()
    });
    assert_eq!(counts, [1, 2, 2, 2]);
    assert!(port.is_io_starved());
    port.shutdown();
}

#[test]
fn repeated_timer_overrun_yields_cpu() {
    let port = Port::new().unwrap();
    let advance_ms = |ms| advance_clock(Duration::from_millis(ms));
    let yield_ms = Rc::new(Cell::new(0));
    let waker = port.waker();
    let yield_ms_clone = Rc::clone(&yield_ms);
    let _guard = intercept(Call::SwitchToThread, move |_| {
        advance_ms(yield_ms_clone.get());
        waker.wake();
        Some(1)
    });
    freeze_clock();
    let count_yields = |busy_ms| {
        advance_ms(busy_ms);
        port.note_overdue_timer();
        run_iteration(&port, Duration::ZERO)
    };
    assert_eq!([50; 3].map(count_yields), [0, 1, 1]);
    assert_eq!([1; 6].map(count_yields), [0, 1, 0, 1, 0, 1]);

    advance_ms(50);
    assert_eq!(run_iteration(&port, Duration::ZERO), 0);
    let _deferred = Request::defer(&port, || {});
    assert_eq!([0; 2].map(count_yields), [0, 1]);
    advance_ms(50);
    port.note_timers_drained();
    port.note_overdue_timer_and_tasks();
    assert_eq!(run_iteration(&port, Duration::ZERO), 0);
    assert!(port.is_io_starved());

    let park = || {
        port.waker().wake();
        assert_eq!(run_iteration(&port, Duration::from_secs(10)), 1);
    };
    park();
    assert_eq!([500; 2].map(count_yields), [0, 1]);

    yield_ms.set(10);
    assert_eq!([20, 8, 5].map(count_yields), [1, 0, 1]);
    yield_ms.set(50);
    assert_eq!([50; 6].map(count_yields), [1, 0, 0, 0, 1, 0]);
    park();
    assert_eq!([20, 20, 100].map(count_yields), [0, 0, 1]);
    yield_ms.set(3_600_000);
    assert_eq!([200, 2200, 100].map(count_yields), [1, 0, 1]);
}

#[test]
fn receive_streak_triggers_coalescing_delay() {
    let port = Port::new().unwrap();
    freeze_clock();
    CLOCK_STEP.set(Duration::from_nanos(100));
    let measure_iteration_us = |should_send: bool| {
        let start = CLOCK_OFFSET.get();
        port.note_receive();
        if should_send {
            port.note_send();
        }
        port.waker().wake();
        run_iteration(&port, Duration::from_secs(10));
        (CLOCK_OFFSET.get() - start).as_micros()
    };
    let delay_range = if has_multiple_cpus() { 19..22 } else { 0..2 };
    for _ in 0..2 {
        assert!((0..4).all(|_| measure_iteration_us(false) < 2));
        assert!((0..4).all(|_| delay_range.contains(&measure_iteration_us(false))));
        assert!(measure_iteration_us(true) < 2);
    }
    let delay_count = (0..128)
        .filter(|_| measure_iteration_us(false) >= 2)
        .count();
    assert_eq!(delay_count, if has_multiple_cpus() { 120 } else { 0 });
}

#[test]
fn blocking_waits_do_not_trigger_coalescing_delay() {
    let port = Port::new().unwrap();
    freeze_clock();
    CLOCK_STEP.set(Duration::from_nanos(100));
    let waker = port.waker();
    let _guard = intercept(Call::NtRemoveIoCompletionEx, move |args| {
        // SAFETY: `args[4]` is the `Timeout` pointer, which is null or valid during the call.
        if unsafe { ptr::with_exposed_provenance::<i64>(args[4]).as_ref() } != Some(&0) {
            waker.wake();
        }
        None
    });
    for _ in 0..8 {
        let start = CLOCK_OFFSET.get();
        port.note_receive();
        run_iteration(&port, Duration::from_secs(10));
        assert!((CLOCK_OFFSET.get() - start).as_micros() < 5);
    }
}

#[test]
fn wait_for_pending_writes_reports_partial_progress() {
    let port = Port::new().unwrap();
    assert_eq!(port.wait_for_pending_writes(), WriteProgress::Drained);

    let finish_after_delay = |write| {
        blocking::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            drop(write);
        });
    };
    finish_after_delay(port.add_pending_write());
    assert_eq!(port.wait_for_pending_writes(), WriteProgress::Drained);

    let _stuck_write = port.add_pending_write();
    finish_after_delay(port.add_pending_write());
    assert_eq!(port.wait_for_pending_writes(), WriteProgress::Partial);
    CLOCK_STEP.set(Duration::from_secs(1));
    assert_eq!(port.wait_for_pending_writes(), WriteProgress::Stalled);
}

#[test]
fn wait_for_pending_writes_covers_thread_bound_writes() {
    let port = Port::new().unwrap();
    let (bound_file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let _write = bound_file.write(vec![0; 200_000], 0, |_| unreachable!());
    assert_eq!(port.requests.thread_bound_write_count(), 0);

    let (file, peer) = create_pipe(&port, OverlappedFile::new_shared);
    let _read = start_read(&file, &Rc::default());
    assert_eq!(port.requests.thread_bound_write_count(), 0);
    let result = Rc::default();
    let _write = file.write(vec![0; 200_000], 0, store_completion(&result));
    let reader = std::thread::spawn(move || {
        assert_eq!(peer.read(&mut vec![0; 200_000]).unwrap(), 200_000);
        peer
    });
    assert_eq!(port.wait_for_pending_writes(), WriteProgress::Drained);
    assert!(port.requests.thread_bound_write_count() == 0 && result.borrow().is_none());
    run_until(&port, || result.borrow().is_some());

    let _peer = reader.join().unwrap();
    let _stuck_write = file.write(vec![0; 200_000], 0, |_| unreachable!());
    CLOCK_STEP.set(Duration::from_millis(200));
    assert_eq!(port.wait_for_pending_writes(), WriteProgress::Stalled);
    assert_eq!(port.requests.thread_bound_write_count(), 1);
}

#[test]
fn large_sync_read_completes_in_next_iteration() {
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    peer.write_all(b"ab").unwrap();
    let file = Rc::new(file);
    let result = Rc::default();
    let read = Rc::new(Cell::new(None));
    let done = store_completion(&result);
    let read_clone = Rc::clone(&read);
    let _deferred = Request::defer(&port, move || read_clone.set(file.read_large(2, done).ok()));
    run_iteration(&port, Duration::ZERO);
    assert!(result.borrow().is_none());
    assert!(port.prepare());
    run_iteration(&port, Duration::ZERO);
    assert_eq!(result.take().unwrap().buffer, b"ab");
}

#[test]
fn write_is_capped_at_max_write_len() {
    let port = Port::new().unwrap();
    let (file, _peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    file.set_max_write_len(2);
    let write = file.try_write(b"abc".to_vec(), |_| unreachable!());
    assert_eq!(write.err().unwrap().transferred, 2);
}

#[test]
fn loop_ref_is_counted_once() {
    let port = Port::new().unwrap();
    let first = LoopRef::new(&port);
    let second = LoopRef::new(&port);
    first.set(true);
    first.set(true);
    second.set(true);
    first.set(false);
    assert!(port.has_loop_refs());
    drop(second);
    assert!(!port.has_loop_refs());
}

#[test]
fn read_to_end_reads_pipes_concurrently() {
    let ours = PipeMode::Overlapped;
    let theirs = PipeMode::Synchronous;
    let [first, second, broken] =
        [(); 3].map(|()| w::create_pipe_pair(ours, theirs, PipeDirection::Inbound).unwrap());
    drop(broken.theirs);
    let writer = std::thread::spawn(move || {
        let files = [second.theirs, first.theirs].map(bun_sys::File::from);
        for (file, byte) in files.iter().zip([2, 1]) {
            file.write_all(&vec![byte; 300_000]).unwrap();
        }
    });
    let pipes = [Some(first.ours), None, Some(second.ours), Some(broken.ours)];
    let contents = crate::read_to_end(pipes).unwrap();
    assert!(contents == [vec![1; 300_000], vec![], vec![2; 300_000], vec![]]);
    writer.join().unwrap();
}

#[test]
fn cancel_and_wait_keeps_slot_until_packet_arrives() {
    if !has_wait_packets() {
        return;
    }
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_shared);
    let read = start_read(&file, &Rc::default());
    let pending = to_return_value(NTSTATUS::PENDING);
    let _failure = fail(Call::NtCancelWaitCompletionPacket, 1, pending);
    let completion = read.cancel_and_wait().ok().unwrap();
    assert_eq!(completion.status, NTSTATUS::CANCELLED);
    assert_pending_read_completes(&port, &file, &peer);
}

#[test]
fn take_sync_completion_requires_completed_read() {
    let port = Port::new().unwrap();
    let (file, peer) = create_pipe(&port, OverlappedFile::new_exclusive);
    let pending_read = start_read(&file, &Rc::default());
    drop(pending_read.take_sync_completion().err().unwrap());
    drop(
        Request::defer(&port, || {})
            .cancel_and_wait()
            .err()
            .unwrap(),
    );
    run_until(&port, || !port.has_abandoned_requests());

    peer.write_all(b"here").unwrap();
    let completed_read = start_read(&file, &Rc::default());
    completed_read.cancel();
    assert_eq!(
        completed_read.cancel_and_wait().ok().unwrap().buffer,
        b"here"
    );
}

#[test]
fn backoff_expiry_skips_dropped_or_repolled_socket() {
    let port = Port::new().unwrap();
    let (socket, _peer) = create_socket_pair();
    for is_dropped in [true, false] {
        let (registration, events) = register_socket(&port, &socket);
        let failure = fail(Call::NtDeviceIoControlFile, 1, NO_RESOURCES);
        registration.set_interest(Readiness::DISCONNECT);
        run_iteration(&port, Duration::from_millis(1));
        let registration = (!is_dropped).then_some(registration);
        if let Some(registration) = &registration {
            registration.set_interest(Readiness::DISCONNECT | Readiness::RECEIVE);
        }
        run_iteration(&port, Duration::from_millis(1));

        drop(failure);
        let (_guard, poll_count) = count_calls(Call::NtDeviceIoControlFile);
        advance_clock(Duration::from_secs(1));
        run_iteration(&port, Duration::from_millis(1));
        run_iteration(&port, Duration::from_millis(1));
        assert_eq!((poll_count.get(), events.take()), (0, Vec::new()));
    }
}
