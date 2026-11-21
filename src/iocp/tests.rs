//! On Windows: `RUSTFLAGS=-Clink-arg=/FORCE:UNRESOLVED cargo test -p bun_iocp --lib`

use core::cell::{Cell, RefCell};
use core::ptr::{self, NonNull};
use core::time::Duration;
use std::io::{Read as _, Write as _};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::os::windows::io::{AsHandle as _, AsRawSocket as _, BorrowedHandle, OwnedHandle};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Instant;

use bun_sys::windows::{self as w, NTSTATUS, PipeDirection, PipeMode};
use bun_threading::fifo_pool::{Config, FifoPool, has_new_thread, on_new_thread};
use bun_threading::spin::has_other_cpu;

use crate::blocking::{self, Cancel};
use crate::faults::{self, Call, fail, intercept};
use crate::sys;
use crate::{
    AsyncFile, Completion, Event, Handle, Hold, Port, Readiness, Remote, Request, SocketWatch,
    Waker, Watcher,
};

thread_local! {
    static CLOCK_AHEAD: Cell<Duration> = const { Cell::new(Duration::from_secs(1)) };
    /// What each look at the clock takes.
    static CLOCK_STEP: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    static CLOCK_STOPPED_AT: Cell<Option<Instant>> = const { Cell::new(None) };
}

#[unsafe(no_mangle)]
extern "C" fn clock_gettime_monotonic(sec: &mut i64, nsec: &mut i64) {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    CLOCK_AHEAD.set(CLOCK_AHEAD.get() + CLOCK_STEP.get());
    let start = *START.get_or_init(Instant::now);
    let now = CLOCK_STOPPED_AT.get().unwrap_or_else(Instant::now);
    let now = now.saturating_duration_since(start) + CLOCK_AHEAD.get();
    (*sec, *nsec) = (now.as_secs() as i64, now.subsec_nanos().into());
}

fn turn(port: &Port, timeout: Duration) -> usize {
    let wakes = Cell::new(0);
    port.prepare();
    port.wait(Some(timeout.as_nanos() as u64));
    port.dispatch(|event| match event {
        Event::Wake => wakes.update(|it| it + 1),
        Event::Socket(..) => unreachable!(),
    });
    wakes.get()
}

fn run_until(port: &Port, is_done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !is_done() {
        assert!(Instant::now() < deadline);
        turn(port, Duration::from_millis(100));
    }
}

type Open = fn(&Rc<Port>, std::sync::Arc<Handle>) -> AsyncFile;
const BOTH_KINDS: [Open; 2] = [AsyncFile::exclusive, AsyncFile::shared];

fn pipe(port: &Rc<Port>, open: Open) -> (AsyncFile, bun_sys::File) {
    let (ours, theirs) = (PipeMode::Overlapped, PipeMode::Synchronous);
    let pair = w::pipe_pair(ours, theirs, PipeDirection::Duplex).unwrap();
    let handle = Handle::from_owned(pair.ours);
    (open(port, handle), pair.theirs.into())
}

type Slot = Rc<RefCell<Option<Completion>>>;

fn into(slot: &Slot) -> impl FnOnce(Completion) + 'static {
    let slot = Rc::clone(slot);
    move |completion| assert!(slot.replace(Some(completion)).is_none())
}

fn start_read(file: &AsyncFile, slot: &Slot) -> Request {
    (file.read(Vec::with_capacity(16), 16, into(slot))).unwrap_or_else(|_| panic!("refused"))
}

#[test]
fn a_wait_ends_on_time() {
    let port = Port::new().unwrap();
    for ms in [30, 2, 10] {
        let start = Instant::now();
        turn(&port, Duration::from_millis(ms));
        assert!(start.elapsed() >= Duration::from_millis(ms));
    }
}

#[test]
fn an_earlier_timeout_does_not_end_a_later_wait() {
    let port = Port::new().unwrap();
    port.waker().wake();
    assert_eq!(turn(&port, Duration::from_millis(5)), 1);
    let start = Instant::now();
    turn(&port, Duration::from_millis(40));
    assert!(start.elapsed() >= Duration::from_millis(40));
}

#[test]
fn wakes_are_coalesced() {
    let port = Port::new().unwrap();
    let waker = port.waker();
    for _ in 0..2 {
        waker.wake();
        waker.wake();
        assert_eq!(turn(&port, Duration::from_secs(10)), 1);
        assert_eq!(turn(&port, Duration::ZERO), 0);
    }
}

#[test]
fn reads_and_writes() {
    let port = Port::new().unwrap();
    for open in BOTH_KINDS {
        let (file, peer) = pipe(&port, open);
        for is_data_first in [true, false] {
            let read = Slot::default();
            if is_data_first {
                peer.write_all(b"abc").unwrap();
            }
            let _request = start_read(&file, &read);
            assert_eq!(port.prepare(), is_data_first);
            if !is_data_first {
                peer.write_all(b"abc").unwrap();
            }
            assert!(read.borrow().is_none());
            run_until(&port, || read.borrow().is_some());
            assert_eq!(read.take().unwrap().buffer, b"abc");
        }

        let write = file.write_now(b"now".to_vec(), |_| unreachable!());
        assert_eq!(write.err().unwrap().transferred, 3);
        assert!(!port.prepare());
        assert_eq!(peer.read(&mut [0; 8]).unwrap(), 3);

        let wrote = Slot::default();
        let _write = file.write(vec![7; 200_000], 50_000, into(&wrote));
        turn(&port, Duration::ZERO);
        assert!(wrote.borrow().is_none());
        let mut received = vec![0; 150_000];
        assert_eq!(peer.read_all(&mut received).unwrap(), 150_000);
        run_until(&port, || wrote.borrow().is_some());
        assert_eq!(wrote.take().unwrap().transferred, 150_000);

        let read = Slot::default();
        let _read = start_read(&file, &read);
        drop(peer);
        run_until(&port, || read.borrow().is_some());
        assert_eq!(read.take().unwrap().status, NTSTATUS::PIPE_BROKEN);
        let refused = file.read(Vec::with_capacity(1), 1, |_| unreachable!());
        assert_eq!(refused.err().unwrap().status, NTSTATUS::PIPE_BROKEN);
        assert_eq!(port.callback_count(), 0);
    }
}

#[test]
fn a_write_is_reported_in_the_order_of_the_port() {
    let port = Port::new().unwrap();
    let mode = PipeMode::Overlapped;
    let pair = w::pipe_pair(mode, mode, PipeDirection::Duplex).unwrap();
    let [ours, theirs] =
        [pair.ours, pair.theirs].map(|end| AsyncFile::exclusive(&port, Handle::from_owned(end)));
    let order = Rc::new(RefCell::new(Vec::new()));
    let note = |name| {
        let order = Rc::clone(&order);
        move |_| order.borrow_mut().push(name)
    };

    let _read = theirs.read(Vec::with_capacity(1), 1, note("read"));
    let _answer = ours.read(Vec::with_capacity(1), 1, note("answer"));
    let _write = ours.write(b"x".to_vec(), 0, note("wrote"));
    assert!(theirs.write_now(b"y".to_vec(), note("")).is_err());
    run_until(&port, || order.borrow().len() == 3);
    assert_eq!(order.take(), ["read", "wrote", "answer"]);
}

#[test]
fn a_cancelled_request_is_reported_and_a_dropped_one_is_not() {
    let port = Port::new().unwrap();
    for open in BOTH_KINDS {
        let (file, peer) = pipe(&port, open);
        let read = Slot::default();
        let request = start_read(&file, &read);
        request.cancel();
        run_until(&port, || read.borrow().is_some());
        assert_eq!(read.take().unwrap().status, NTSTATUS::CANCELLED);

        drop(start_read(&file, &read));
        assert_eq!(port.callback_count(), 0);
        drop(file);
        assert_eq!(peer.read(&mut [0; 1]).unwrap(), 0);
        run_until(&port, || !port.requests.is_system_writing());
        assert!(read.borrow().is_none());
    }
}

#[test]
fn a_request_can_be_finished_without_a_turn() {
    let port = Port::new().unwrap();
    for open in BOTH_KINDS {
        let (file, peer) = pipe(&port, open);
        let unused = Slot::default();
        port.waker().wake();
        let idle = start_read(&file, &unused).finish_now().ok().unwrap();
        assert_eq!(idle.status, NTSTATUS::CANCELLED);

        let request = start_read(&file, &unused);
        peer.write_all(b"abc").unwrap();
        assert_eq!(request.finish_now().ok().unwrap().buffer, b"abc");
        assert_eq!(turn(&port, Duration::from_secs(10)), 1);
        assert!(unused.borrow().is_none() && port.callback_count() == 0);
    }
}

#[test]
fn a_nested_turn_sees_what_came_with_the_outer_one() {
    let port = Port::new().unwrap();
    let (first, first_peer) = pipe(&port, AsyncFile::exclusive);
    let (second, second_peer) = pipe(&port, AsyncFile::exclusive);
    let (read, is_done) = (Slot::default(), Rc::new(Cell::new(false)));
    let nested = {
        let (port, read, is_done) = (Rc::clone(&port), Rc::clone(&read), Rc::clone(&is_done));
        move |_| {
            run_until(&port, || read.borrow().is_some());
            is_done.set(true);
        }
    };
    let _first = first.read(Vec::with_capacity(1), 1, nested);
    let _second = start_read(&second, &read);
    first_peer.write_all(b"1").unwrap();
    second_peer.write_all(b"2").unwrap();
    run_until(&port, || is_done.get());
}

#[test]
fn a_request_can_be_dropped_while_its_packet_waits_to_be_dispatched() {
    let port = Port::new().unwrap();
    let (first, first_peer) = pipe(&port, AsyncFile::exclusive);
    let (second, second_peer) = pipe(&port, AsyncFile::exclusive);
    let victim = Rc::new(Cell::new(None));
    let dropper = Rc::clone(&victim);
    let _first = first.read(Vec::with_capacity(1), 1, move |_| drop(dropper.take()));
    victim.set(
        second
            .read(Vec::with_capacity(1), 1, |_| unreachable!())
            .ok(),
    );
    first_peer.write_all(b"1").unwrap();
    second_peer.write_all(b"2").unwrap();
    run_until(&port, || !port.requests.is_system_writing());
}

#[test]
fn what_is_deferred_over_and_over_lets_the_turn_end() {
    fn again(port: &Rc<Port>, slot: Rc<Cell<Option<Request>>>) {
        let (next_port, next_slot) = (Rc::clone(port), Rc::clone(&slot));
        slot.set(Some(Request::defer(port, move || {
            again(&next_port, next_slot)
        })));
    }
    let port = Port::new().unwrap();
    let slot = Rc::default();
    again(&port, Rc::clone(&slot));
    turn(&port, Duration::from_secs(10));
    assert!(port.prepare());
    slot.take();
}

#[test]
fn signals_delays_and_other_threads() {
    let port = Port::new().unwrap();
    let log = Rc::new(RefCell::new(Vec::new()));
    let note = |what: &'static str| {
        let log = Rc::clone(&log);
        move || log.borrow_mut().push(what)
    };
    let event = w::CreateEventW().unwrap();
    drop(Request::wait(&port, event.as_handle(), note("dropped")).unwrap());
    drop(Request::delay(&port, Duration::ZERO, note("dropped")));
    let _signal = Request::wait(&port, event.as_handle(), note("signal")).unwrap();
    let _late = Request::delay(&port, Duration::from_millis(60), note("late"));
    let _soon = Request::delay(&port, Duration::from_millis(30), note("soon"));
    let on_remote = note("remote");
    let (_remote, remote) = Request::remote(&port, move |value: u8| {
        assert_eq!(value, 7);
        on_remote();
    });
    let (dropped, unheard) = Request::remote(&port, |()| unreachable!());
    drop(dropped);
    w::set_event(&event);
    run_until(&port, || log.borrow().len() == 1);
    blocking::spawn(move || {
        unheard.complete(());
        remote.complete(7);
    });
    while port.callback_count() > 0 {
        port.wait(None);
        port.dispatch(|_| {});
    }
    log.borrow_mut().retain(|it| *it != "remote");
    assert_eq!(*log.borrow(), ["signal", "soon", "late"]);
}

#[test]
fn a_blocked_thread_can_be_interrupted() {
    let port = Port::new().unwrap();
    for mode in [PipeMode::Synchronous, PipeMode::Overlapped] {
        let pair = w::pipe_pair(mode, mode, PipeDirection::OursReads).unwrap();
        let file = bun_sys::File::from(pair.ours);
        for round in 0..200 {
            let (result, cancel) = (Rc::new(Cell::new(None)), Cancel::default());
            let slot = Rc::clone(&result);
            let (_request, remote) = Request::remote(&port, move |it| slot.set(Some(it)));
            let (fd, thread) = (file.fd(), cancel.clone());
            blocking::spawn(move || {
                let read = || bun_sys::read(fd, &mut [0; 8]).map_err(|err| err.get_errno());
                remote.complete(thread.run(read));
            });
            for _ in 0..round * 50 {
                core::hint::spin_loop();
            }
            cancel.cancel();
            run_until(&port, || result.get().is_some());
            let result = result.get().unwrap();
            assert!(result.is_none_or(|it| it == Err(bun_sys::E::ECANCELED)));
        }
    }
}

fn connected() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    (listener.accept().unwrap().0, client)
}

fn watch(port: &Rc<Port>, socket: &TcpStream) -> (SocketWatch, Rc<RefCell<Vec<Readiness>>>) {
    let seen = Rc::new(RefCell::new(Vec::new()));
    let log = Rc::clone(&seen);
    let watcher = Watcher::Callback(Rc::new(move |ready| log.borrow_mut().push(ready)));
    let watch = SocketWatch::new(port, socket.as_raw_socket() as usize, watcher);
    (watch.unwrap(), seen)
}

#[test]
fn readiness_is_reported_while_it_holds_and_is_asked_for() {
    let port = Port::new().unwrap();
    let (mut ours, mut peer) = connected();
    let (watch, seen) = watch(&port, &ours);
    watch.set_interest(Readiness::RECEIVE);
    turn(&port, Duration::ZERO);
    assert_eq!(seen.take(), []);

    watch.set_interest(Readiness::RECEIVE | Readiness::SEND);
    turn(&port, Duration::ZERO);
    assert_eq!(seen.take(), [Readiness::SEND]);

    watch.set_interest(Readiness::RECEIVE);
    peer.write_all(b"x").unwrap();
    for _ in 0..2 {
        run_until(&port, || !seen.borrow().is_empty());
        assert_eq!(seen.take(), [Readiness::RECEIVE]);
    }
    ours.read_exact(&mut [0]).unwrap();

    watch.set_interest(Readiness::DISCONNECT);
    turn(&port, Duration::ZERO);
    watch.set_interest(Readiness::empty());
    peer.shutdown(Shutdown::Write).unwrap();
    turn(&port, Duration::from_millis(50));
    assert_eq!(seen.take(), []);
    watch.set_interest(Readiness::DISCONNECT);
    turn(&port, Duration::from_secs(10));
    assert_eq!(seen.take()[0], Readiness::DISCONNECT);
}

#[test]
fn an_end_that_follows_data_is_reported_in_the_same_turn() {
    let port = Port::new().unwrap();
    let (ours, peer) = connected();
    let seen = Rc::new(RefCell::new(Vec::new()));
    let (log, socket) = (Rc::clone(&seen), ours.as_raw_socket() as usize);
    (&peer).write_all(b"x").unwrap();
    let watcher = Watcher::Callback(Rc::new(move |ready| {
        if log.borrow().is_empty() {
            (&ours).read_exact(&mut [0]).unwrap();
            peer.shutdown(Shutdown::Write).unwrap();
            assert_eq!(ours.peek(&mut [0]).unwrap(), 0);
        }
        log.borrow_mut().push(ready);
    }));
    let watch = SocketWatch::new(&port, socket, watcher).unwrap();
    watch.set_interest(Readiness::RECEIVE | Readiness::DISCONNECT);
    run_until(&port, || !seen.borrow().is_empty());
    assert_eq!(seen.take(), [Readiness::RECEIVE, Readiness::DISCONNECT]);
}

#[test]
fn taking_a_result_leaves_that_of_a_socket_alone() {
    let port = Port::new().unwrap();
    let (file, theirs) = pipe(&port, AsyncFile::exclusive);
    theirs.write_all(b"x").unwrap();
    let read = start_read(&file, &Slot::default());

    let (ours, peer) = connected();
    peer.shutdown(Shutdown::Write).unwrap();
    assert_eq!(ours.peek(&mut [0]).unwrap(), 0);
    let (watch, seen) = watch(&port, &ours);
    watch.set_interest(Readiness::DISCONNECT);
    port.prepare();

    assert!(read.take_immediate().is_ok_and(|read| read.buffer == b"x"));
    run_until(&port, || !seen.borrow().is_empty());
}

#[test]
fn a_dropped_watch_does_not_poll_again() {
    let port = Port::new().unwrap();
    let (ours, peer) = connected();
    let (watch, _) = watch(&port, &ours);
    watch.set_interest(Readiness::RECEIVE);
    assert!(!port.prepare());
    peer.shutdown(Shutdown::Write).unwrap();
    assert_eq!(ours.peek(&mut [0]).unwrap(), 0);
    watch.set_interest(Readiness::RECEIVE | Readiness::DISCONNECT);
    drop(watch);
    assert!(!port.prepare());
}

#[test]
fn interest_can_grow_more_often_than_packets_are_taken() {
    let port = Port::new().unwrap();
    let (ours, _peer) = connected();
    let (watch, seen) = watch(&port, &ours);
    let mut interest = Readiness::empty();
    for more in [
        Readiness::ABORT,
        Readiness::RECEIVE,
        Readiness::DISCONNECT,
        Readiness::SEND,
    ] {
        interest |= more;
        watch.set_interest(interest);
        port.prepare();
    }
    run_until(&port, || !seen.borrow().is_empty());
    assert_eq!(seen.take(), [Readiness::SEND]);
}

#[test]
fn two_ports_take_turns_on_one_socket() {
    let ports = [Port::new().unwrap(), Port::new().unwrap()];
    let (ours, mut peer) = connected();
    let watches = ports.each_ref().map(|port| watch(port, &ours));
    for _ in 0..3 {
        for (port, (watch, _)) in ports.iter().zip(&watches) {
            watch.set_interest(Readiness::RECEIVE);
            turn(port, Duration::ZERO);
        }
    }
    peer.write_all(b"x").unwrap();
    for (port, (_, seen)) in ports.iter().zip(&watches) {
        run_until(port, || !seen.borrow().is_empty());
    }
}

#[test]
fn what_is_not_a_socket_cannot_be_watched() {
    let port = Port::new().unwrap();
    let event: OwnedHandle = w::CreateEventW().unwrap();
    let handle = std::os::windows::io::AsRawHandle::as_raw_handle(&event).addr();
    let watcher = Watcher::Callback(Rc::new(|_| unreachable!()));
    assert!(SocketWatch::new(&port, handle, watcher).is_err());
    assert_eq!(port.callback_count(), 0);
}

#[test]
fn watches_come_and_go() {
    let port = Port::new().unwrap();
    let sockets: Vec<_> = (0..70).map(|_| connected()).collect();
    for _ in 0..3 {
        let watches: Vec<_> = sockets.iter().map(|(ours, _)| watch(&port, ours)).collect();
        for (watch, _) in &watches {
            watch.set_interest(Readiness::RECEIVE);
        }
        turn(&port, Duration::ZERO);
        drop(watches);
        run_until(&port, || !port.sockets.is_system_writing());
    }
}

#[test]
fn shutting_down_waits_for_polls_only_until_they_have_ended() {
    let port = Port::new().unwrap();
    let (socket, _peer) = connected();
    let (watch, _) = watch(&port, &socket);
    watch.set_interest(Readiness::RECEIVE);
    turn(&port, Duration::ZERO);
    let start = Instant::now();
    port.shut_down();
    assert!(start.elapsed() < Duration::from_secs(5));
}

#[test]
fn shutting_down_ends_everything() {
    let port = Port::new().unwrap();
    let (socket, _peer) = connected();
    let (watch, seen) = watch(&port, &socket);
    watch.set_interest(Readiness::RECEIVE);
    let pipes = BOTH_KINDS.map(|open| pipe(&port, open));
    let read = Slot::default();
    let _reads = pipes.each_ref().map(|(file, _)| start_read(file, &read));
    turn(&port, Duration::ZERO);

    port.shut_down();
    assert!(!port.requests.is_system_writing() && !port.sockets.is_system_writing());
    assert!(read.borrow().is_none() && seen.borrow().is_empty());
    watch.set_interest(Readiness::SEND);
    let refused = pipes[0].0.read(Vec::new(), 0, |_| unreachable!());
    assert_eq!(refused.err().unwrap().status, NTSTATUS::CANCELLED);
}

const fn status(status: NTSTATUS) -> usize {
    status.0 as usize
}

const NULL: usize = 0;
const NO_RESOURCES: usize = status(NTSTATUS::INSUFFICIENT_RESOURCES);

fn has_wait_packets() -> bool {
    matches!(sys::WaitPacket::new(), Ok(Some(_)))
}

fn count(call: Call) -> (faults::Intercepted, Rc<Cell<usize>>) {
    let count = Rc::new(Cell::new(0));
    let counter = Rc::clone(&count);
    let plan = move |_: &[usize]| {
        counter.update(|it| it + 1);
        None
    };
    (intercept(call, plan), count)
}

fn read_some(port: &Port, file: &AsyncFile, peer: &bun_sys::File) {
    let slot = Slot::default();
    let _read = start_read(file, &slot);
    turn(port, Duration::ZERO);
    peer.write_all(b"some").unwrap();
    run_until(port, || slot.borrow().is_some());
    assert_eq!(slot.take().unwrap().buffer, b"some");
    turn(port, Duration::from_millis(1));
    assert_eq!(port.callback_count(), 0);
}

#[test]
fn everything_works_without_wait_packets() {
    if !has_wait_packets() {
        return;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .env(faults::NO_WAIT_PACKETS, "1")
        .output()
        .unwrap();
    let stdout = bun_core::fmt::s(&output.stdout);
    assert!(output.status.success(), "{stdout}");
}

#[test]
fn more_packets_than_a_batch_has_room_for_take_one_turn() {
    let port = Port::new().unwrap();
    let (mut writes, done) = (Vec::new(), Rc::new(Cell::new(0)));
    let (file, _peer) = pipe(&port, AsyncFile::exclusive);
    for _ in 0..300 {
        let done = Rc::clone(&done);
        let write = file.write(vec![0], 0, move |_| done.update(|it| it + 1));
        writes.push(write.unwrap_or_else(|_| panic!("refused")));
    }
    turn(&port, Duration::from_secs(10));
    assert_eq!(done.get(), 300);
}

#[test]
fn full_batches_over_and_over_let_the_turn_end() {
    type Writes = Rc<RefCell<Vec<Request>>>;
    fn again(file: &Rc<AsyncFile>, writes: &Writes) {
        let (next, slot) = (Rc::clone(file), Rc::clone(writes));
        let write = file.write(Vec::new(), 0, move |_| again(&next, &slot));
        (writes.borrow_mut()).push(write.unwrap_or_else(|_| panic!("refused")));
    }
    let port = Port::new().unwrap();
    let (file, _peer) = pipe(&port, AsyncFile::exclusive);
    let (file, writes) = (Rc::new(file), Writes::default());
    for _ in 0..200 {
        again(&file, &writes);
    }
    turn(&port, Duration::from_secs(10));
    assert_eq!(port.callback_count(), 200);
    writes.take();
}

#[test]
fn a_port_can_be_refused() {
    let _refused = fail(Call::CreateIoCompletionPort, usize::MAX, NULL);
    assert!(Port::new().is_err());
    let (ours, theirs) = (PipeMode::Overlapped, PipeMode::Synchronous);
    let pair = w::pipe_pair(ours, theirs, PipeDirection::OursReads).unwrap();
    assert!(crate::read_to_end([Some(pair.ours)]).is_err());
    assert!(crate::read_to_end([None, None]).is_ok());
}

#[test]
fn a_wake_waits_for_memory() {
    let port = Port::new().unwrap();
    for result in [NO_RESOURCES, status(NTSTATUS::NO_MEMORY)] {
        let _refused = fail(Call::NtSetIoCompletion, 2, result);
        port.waker().wake();
        assert_eq!(turn(&port, Duration::from_secs(10)), 1);
    }
}

type Spawn = fn(Box<dyn FnOnce() + Send>);
const ON_NEW_THREAD: Spawn = |run| new_pool().go(run);
const AFTER_FAILURES: Spawn = |run| after_attempts(3, false, run);
const AFTER_A_SUCCESS: Spawn = |run| after_attempts(1, true, run);
const AFTER_THE_LAST_SUCCESS: Spawn = |run| after_attempts(2, true, run);
const ON_OTHER_POOL: Spawn = |run| pool_with(false).go(run);
const ON_NO_POOL: Spawn = |run| drop(std::thread::spawn(run));

fn after_attempts(count: usize, result: bool, run: Box<dyn FnOnce() + Send>) {
    let pool = new_pool();
    pool.go(move || {
        pool.go(run);
        for _ in 0..count {
            on_new_thread(|| result);
        }
    });
}

fn new_pool() -> &'static FifoPool {
    pool_with(true)
}

fn pool_with(has_new_threads: bool) -> &'static FifoPool {
    Box::leak(Box::new(FifoPool::new(Config {
        name: "Test",
        max_threads: 1,
        stack_size: 256 * 1024,
        on_thread_start: || {},
        has_new_threads,
    })))
}

/// Until it is dropped.
fn keep_a_thread_new() -> mpsc::Sender<()> {
    let (kept, is_kept) = mpsc::channel();
    new_pool().go(move || assert!(on_new_thread(|| is_kept.recv().is_err())));
    kept
}

/// `run` is called when the port goes to sleep. Returns the wakes, and how many packets that has posted.
fn turn_ended_by(port: &Port, spawn: Spawn, run: impl FnOnce() + Send + 'static) -> (usize, usize) {
    let (mut run, posted) = (Some(run), Rc::new(Cell::new(0)));
    let (slot, _new) = (Rc::clone(&posted), keep_a_thread_new());
    let _sleeps = intercept(Call::NtRemoveIoCompletionEx, move |args| {
        // SAFETY: the timeout of the call.
        let timeout = unsafe { ptr::with_exposed_provenance::<i64>(args[4]).as_ref() };
        let run = run.take_if(|_| timeout != Some(&0))?;
        let (ran, has_run) = mpsc::channel();
        spawn(Box::new(move || {
            let (_counted, posted) = count(Call::NtSetIoCompletion);
            run();
            ran.send(posted.get()).unwrap();
        }));
        slot.set(has_run.recv().unwrap());
        None
    });
    (turn(port, Duration::from_secs(10)), posted.get())
}

fn expect_outcome(port: &Rc<Port>, came: &Rc<Cell<usize>>) -> (Request, Remote<()>) {
    let came = Rc::clone(came);
    Request::remote(port, move |()| came.update(|it| it + 1))
}

fn nothing_comes(port: &Port) {
    let (_new, start) = (keep_a_thread_new(), Instant::now());
    assert_eq!(turn(port, Duration::from_millis(20)), 0);
    assert!(start.elapsed() >= Duration::from_millis(20));
}

#[test]
fn a_thread_that_sleeps_is_woken_by_an_event() {
    let (port, came) = (Port::new().unwrap(), Rc::default());
    let without = usize::from(!has_wait_packets());
    for (spawn, posted) in [
        (ON_NEW_THREAD, without),
        (AFTER_FAILURES, without),
        (AFTER_A_SUCCESS, without),
        (AFTER_THE_LAST_SUCCESS, 1),
        (ON_OTHER_POOL, 1),
        (ON_NO_POOL, 1),
        (ON_NEW_THREAD, without),
    ] {
        let waker = port.waker();
        let ended = turn_ended_by(&port, spawn, move || waker.wake());
        assert_eq!(ended, (1, posted));
        nothing_comes(&port);

        let (_request, remote) = expect_outcome(&port, &came);
        let ended = turn_ended_by(&port, spawn, || remote.complete(()));
        assert_eq!((ended, came.take()), ((0, posted), 1));
        nothing_comes(&port);

        for is_wake_first in [true, false] {
            let ((_request, remote), waker) = (expect_outcome(&port, &came), port.waker());
            let ended = turn_ended_by(&port, spawn, move || match is_wake_first {
                true => (waker.wake(), remote.complete(())).0,
                false => (remote.complete(()), waker.wake()).0,
            });
            assert_eq!((ended, came.take()), ((1, posted + 1), 1));
            nothing_comes(&port);
        }
    }
}

#[test]
fn an_event_can_be_late() {
    if !has_wait_packets() {
        return;
    }
    let (port, came) = (Port::new().unwrap(), Rc::default());
    let (file, _peer) = pipe(&port, AsyncFile::exclusive);
    for is_fetched in [false, true] {
        let ((_request, remote), waker) = (expect_outcome(&port, &came), port.waker());
        let (held_up, event) = mpsc::channel();
        let ended = turn_ended_by(&port, ON_NEW_THREAD, move || {
            let _late = intercept(Call::SetEvent, move |args| {
                held_up.send(args[0]).unwrap();
                Some(1)
            });
            waker.wake();
            remote.complete(());
        });
        assert_eq!((ended, came.take()), ((0, 1), 1));

        let (_request, remote) = expect_outcome(&port, &came);
        let ended = turn_ended_by(&port, ON_NEW_THREAD, || remote.complete(()));
        assert_eq!((ended, came.take()), ((0, 1), 1));

        let event = ptr::with_exposed_provenance_mut(event.recv().unwrap());
        // SAFETY: the port keeps it open.
        let event = unsafe { BorrowedHandle::borrow_raw(event) };
        w::set_event(&event.try_clone_to_owned().unwrap());
        if is_fetched {
            assert!(start_read(&file, &Slot::default()).finish_now().is_ok());
        }
        assert_eq!(turn(&port, Duration::ZERO), 1);
        nothing_comes(&port);
    }
}

#[test]
fn a_thread_is_woken_without_the_event() {
    for (call, result) in [
        (Call::NtCreateWaitCompletionPacket, NO_RESOURCES),
        (Call::CreateEventW, NULL),
        (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
    ] {
        let port = Port::new().unwrap();
        let (refused, waker) = (fail(call, usize::MAX, result), port.waker());
        assert_eq!(
            turn_ended_by(&port, ON_NEW_THREAD, move || waker.wake()),
            (1, 1)
        );
        drop(refused);
        let (waker, without) = (port.waker(), usize::from(!has_wait_packets()));
        let ended = turn_ended_by(&port, ON_NEW_THREAD, move || waker.wake());
        assert_eq!(ended, (1, without));
    }
}

#[test]
fn a_thread_that_is_awake_or_gone_needs_no_event() {
    let port = Port::new().unwrap();
    let sets_event = |waker: Waker| {
        let (ran, has_run) = mpsc::channel();
        new_pool().go(move || {
            let (_counted, set) = count(Call::SetEvent);
            waker.wake();
            ran.send(set.get() > 0).unwrap();
        });
        has_run.recv().unwrap()
    };
    nothing_comes(&port);
    assert!(!sets_event(port.waker()));
    assert_eq!(turn(&port, Duration::ZERO), 1);

    nothing_comes(&port);
    let waker = port.waker();
    drop(port);
    assert!(!sets_event(waker));
}

#[test]
fn no_event_is_made_without_a_new_thread() {
    const ALONE: &str = "BUN_IOCP_TEST_ALONE";
    if std::env::var_os(ALONE).is_none() {
        let mut alone = std::process::Command::new(std::env::current_exe().unwrap());
        alone.arg("no_event_is_made_without_a_new_thread");
        return assert!(alone.env(ALONE, "1").output().unwrap().status.success());
    }
    let refused = fail(Call::CreateThread, 2, NULL);
    let kept = keep_a_thread_new();
    assert!(has_new_thread());
    drop((refused, kept));

    let (port, other) = (Port::new().unwrap(), Port::new().unwrap());
    let start = Instant::now();
    run_until(&other, || !has_new_thread());

    let (pool, (tell, told)) = (new_pool(), mpsc::channel());
    let is_new = || told.recv_timeout(Duration::from_secs(5)).unwrap();
    for (count, result, expected) in [(1, false, true), (1, true, true), (1, true, false)] {
        let tell = tell.clone();
        pool.go(move || {
            let attempts = Cell::new(0);
            for _ in 0..count {
                on_new_thread(|| (attempts.update(|it| it + 1), result).1);
            }
            tell.send((attempts.get() == count, has_new_thread()))
                .unwrap();
        });
        assert_eq!(is_new(), (expected, expected));
        turn(&other, Duration::from_millis(20));
        run_until(&other, || has_new_thread() != result);
    }
    let ask = move || {
        tell.send((on_new_thread(|| true), has_new_thread()))
            .unwrap()
    };
    after_attempts(2, true, Box::new(ask));
    assert_eq!(is_new(), (false, false));
    assert!(
        start.elapsed() < Duration::from_secs(9),
        "threads have ended"
    );

    let (request, remote) = Request::remote(&port, |()| {});
    blocking::spawn(|| {
        std::thread::sleep(Duration::from_millis(20));
        remote.complete(());
    });
    let (_counted, created) = count(Call::CreateEventW);
    run_until(&port, || port.callback_count() == 0);
    assert_eq!(created.get(), 0);
    drop(request);
}

#[test]
fn no_wake_is_lost() {
    let (port, came) = (Port::new().unwrap(), Rc::default());
    let spin = |times| (0..times % 4000).for_each(|_| core::hint::spin_loop());
    for round in 0..300 {
        let (has_wake, has_outcome) = (round % 3 != 0, round % 3 != 1);
        let _request = has_outcome.then(|| {
            let (request, remote) = expect_outcome(&port, &came);
            new_pool().go(move || (spin(round * 7), remote.complete(())).1);
            request
        });
        if has_wake {
            let waker = port.waker();
            new_pool().go(move || (spin(round * 13), waker.wake()).1);
        }
        let (start, mut wakes) = (Instant::now(), 0);
        while (wakes, came.get()) != (has_wake.into(), has_outcome.into()) {
            port.did_receive();
            wakes += turn(&port, Duration::from_secs(10));
            assert!(start.elapsed() < Duration::from_secs(9));
        }
        came.set(0);
    }
}

#[test]
fn a_wait_ends_without_the_timer() {
    for (call, result) in [
        (Call::NtCreateWaitCompletionPacket, NO_RESOURCES),
        (Call::CreateWaitableTimerExW, NULL),
        (Call::SetWaitableTimer, NULL),
        (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
    ] {
        let port = Port::new().unwrap();
        let _refused = fail(call, usize::MAX, result);
        let start = Instant::now();
        turn(&port, Duration::from_millis(20));
        let range = Duration::from_millis(20)..Duration::from_secs(5);
        assert!(range.contains(&start.elapsed()), "{call:?}");
    }
}

#[test]
fn a_wait_for_a_signal_can_be_refused() {
    let calls = match has_wait_packets() {
        true => [
            (Call::NtCreateWaitCompletionPacket, NO_RESOURCES),
            (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
        ],
        false => [(Call::DuplicateHandle, NULL), (Call::CreateEventW, NULL)],
    };
    for (call, result) in calls {
        let port = Port::new().unwrap();
        let event = w::CreateEventW().unwrap();
        w::set_event(&event);
        let _refused = fail(call, 1, result);
        let refused = Request::wait(&port, event.as_handle(), || unreachable!());
        assert_eq!(refused.err(), Some(NTSTATUS::INSUFFICIENT_RESOURCES));
        assert_eq!(port.callback_count(), 0);
        assert_eq!(port.requests.in_use(), 0);

        let _wait = Request::wait(&port, event.as_handle(), || {}).unwrap();
        run_until(&port, || port.callback_count() == 0);
    }
}

#[test]
fn a_dropped_wait_keeps_its_slot_while_the_packet_is_under_way() {
    if !has_wait_packets() {
        return;
    }
    let port = Port::new().unwrap();
    let (first, second) = (w::CreateEventW().unwrap(), w::CreateEventW().unwrap());
    let wait = Request::wait(&port, first.as_handle(), || unreachable!()).unwrap();
    let under_way = status(NTSTATUS::PENDING);
    let _late = fail(Call::NtCancelWaitCompletionPacket, 1, under_way);
    drop(wait);
    let _other = Request::wait(&port, second.as_handle(), || {}).unwrap();
    w::set_event(&first);
    turn(&port, Duration::from_secs(10));
    assert_eq!(port.callback_count(), 1);
    w::set_event(&second);
    run_until(&port, || port.callback_count() == 0);
}

#[test]
fn a_file_that_cannot_be_bound_is_read_all_the_same() {
    for call in [
        Call::CreateIoCompletionPort,
        Call::SetFileCompletionNotificationModes,
    ] {
        let port = Port::new().unwrap();
        let (file, peer) = pipe(&port, AsyncFile::exclusive);
        let _refused = fail(call, 1, NULL);
        read_some(&port, &file, &peer);
        read_some(&port, &file, &peer);
    }
}

#[test]
fn a_file_that_is_bound_to_another_port_is_read_all_the_same() {
    let (port, other) = (Port::new().unwrap(), Port::new().unwrap());
    let (first, peer) = pipe(&other, AsyncFile::exclusive);
    read_some(&other, &first, &peer);
    let second = AsyncFile::exclusive(&port, std::sync::Arc::clone(first.handle()));
    read_some(&port, &second, &peer);
}

#[test]
fn a_refused_request_gives_its_buffer_back() {
    let mut calls = vec![(Call::CreateEventW, NULL)];
    if has_wait_packets() {
        calls.push((Call::NtCreateWaitCompletionPacket, NO_RESOURCES));
    }
    for (call, result) in calls {
        let port = Port::new().unwrap();
        let (file, peer) = pipe(&port, AsyncFile::shared);
        let _refused = fail(call, 1, result);
        let refused = file.write(b"kept".to_vec(), 0, |_| unreachable!());
        let refused = refused.err().unwrap();
        assert_eq!(refused.status, NTSTATUS::INSUFFICIENT_RESOURCES);
        assert_eq!((refused.transferred, &*refused.buffer), (0, &b"kept"[..]));
        assert_eq!(port.callback_count(), 0);
        read_some(&port, &file, &peer);
    }
}

#[test]
fn a_request_whose_end_could_not_be_heard_is_cancelled() {
    let (call, result) = match has_wait_packets() {
        true => (Call::NtAssociateWaitCompletionPacket, NO_RESOURCES),
        false => (Call::DuplicateHandle, NULL),
    };
    let port = Port::new().unwrap();
    let (file, peer) = pipe(&port, AsyncFile::shared);
    let slot = Slot::default();
    let _refused = fail(call, 1, result);
    let read = start_read(&file, &slot);
    assert!(!port.requests.is_system_writing() && slot.borrow().is_none());
    run_until(&port, || slot.borrow().is_some());
    assert_eq!(slot.take().unwrap().status, NTSTATUS::CANCELLED);
    read.cancel();
    read_some(&port, &file, &peer);
}

#[test]
fn a_request_that_does_not_end_is_not_finished_at_once() {
    let port = Port::new().unwrap();
    for open in BOTH_KINDS {
        let (file, peer) = pipe(&port, open);
        let slot = Slot::default();
        let read = start_read(&file, &slot);
        let deaf = fail(Call::NtCancelIoFileEx, 1, status(NTSTATUS::SUCCESS));
        let timeout = status(NTSTATUS::TIMEOUT);
        let hurried = fail(Call::NtRemoveIoCompletionEx, usize::MAX, timeout);
        let _read = read.finish_now().err().unwrap();
        drop((deaf, hurried));
        peer.write_all(b"late").unwrap();
        run_until(&port, || slot.borrow().is_some());
        assert_eq!(slot.take().unwrap().buffer, b"late");
    }
}

#[test]
fn shutting_down_gives_up_on_what_does_not_end() {
    let port = Port::new().unwrap();
    let (socket, mut socket_peer) = connected();
    let (watch, seen) = watch(&port, &socket);
    watch.set_interest(Readiness::RECEIVE);
    let (file, peer) = pipe(&port, AsyncFile::exclusive);
    let slot = Slot::default();
    let read = start_read(&file, &slot);
    turn(&port, Duration::ZERO);

    let _deaf = fail(Call::NtCancelIoFileEx, 2, status(NTSTATUS::SUCCESS));
    CLOCK_STEP.set(Duration::from_secs(11));
    port.shut_down();
    assert!(port.requests.is_system_writing() && port.sockets.is_system_writing());
    let handle = std::sync::Arc::clone(file.handle());
    drop((watch, read, file, port));
    peer.write_all(b"late").unwrap();
    socket_peer.write_all(b"late").unwrap();
    drop(handle);
    assert!(slot.borrow().is_none() && seen.borrow().is_empty());
}

#[test]
fn a_watch_can_be_refused() {
    let (socket, mut peer) = connected();
    peer.write_all(b"x").unwrap();
    for (call, result) in [
        (Call::NtCreateFile, NO_RESOURCES),
        (Call::CreateIoCompletionPort, NULL),
        (Call::SetFileCompletionNotificationModes, NULL),
    ] {
        let port = Port::new().unwrap();
        let _refused = fail(call, 1, result);
        let watcher = Watcher::Callback(Rc::new(|_| unreachable!()));
        assert!(SocketWatch::new(&port, socket.as_raw_socket() as usize, watcher).is_err());
        assert_eq!(port.callback_count(), 0);

        let (watch, seen) = watch(&port, &socket);
        watch.set_interest(Readiness::RECEIVE);
        run_until(&port, || !seen.borrow().is_empty());

        port.shut_down();
        let watcher = Watcher::Callback(Rc::new(|_| unreachable!()));
        assert!(SocketWatch::new(&port, socket.as_raw_socket() as usize, watcher).is_err());
    }
}

#[test]
fn a_failed_poll_is_reported_and_tried_again() {
    let port = Port::new().unwrap();
    let (socket, mut peer) = connected();
    let (watch, seen) = watch(&port, &socket);
    peer.write_all(b"x").unwrap();
    for interest in [
        Readiness::RECEIVE,
        Readiness::SEND,
        Readiness::RECEIVE | Readiness::DISCONNECT,
    ] {
        let failure = status(NTSTATUS::INVALID_HANDLE);
        let _refused = fail(Call::NtDeviceIoControlFile, 1, failure);
        watch.set_interest(interest);
        for _ in 0..3 {
            turn(&port, Duration::from_millis(1));
        }
        assert_eq!(seen.take(), [Readiness::WATCH_FAILED]);

        CLOCK_AHEAD.set(CLOCK_AHEAD.get() + Duration::from_secs(1));
        run_until(&port, || !seen.borrow().is_empty());
        watch.set_interest(Readiness::empty());
        turn(&port, Duration::ZERO);
        assert!(seen.take().iter().all(|it| interest.contains(*it)));
    }
}

#[test]
fn a_poll_waits_for_memory() {
    let port = Port::new().unwrap();
    let (socket, mut peer) = connected();
    let (watch, seen) = watch(&port, &socket);
    peer.write_all(b"x").unwrap();
    let _refused = fail(Call::NtDeviceIoControlFile, 3, NO_RESOURCES);
    watch.set_interest(Readiness::RECEIVE);
    run_until(&port, || !seen.borrow().is_empty());
    assert_eq!(seen.borrow()[0], Readiness::RECEIVE);
}

#[test]
fn a_socket_that_is_closed_is_not_polled_again() {
    let port = Port::new().unwrap();
    let (socket, _peer) = connected();
    let (watch, seen) = watch(&port, &socket);
    watch.set_interest(Readiness::RECEIVE);
    turn(&port, Duration::ZERO);
    drop(socket);
    let (_counted, polls) = count(Call::NtDeviceIoControlFile);
    for _ in 0..3 {
        turn(&port, Duration::from_millis(20));
    }
    assert_eq!((polls.get(), seen.take()), (0, Vec::new()));
}

#[test]
fn a_watcher_can_move() {
    let port = Port::new().unwrap();
    let (socket, _peer) = connected();
    let [before, after] = [8, 16].map(|it| NonNull::new(ptr::without_provenance_mut(it)).unwrap());
    let watcher = Watcher::Foreign(before);
    let watch = SocketWatch::new(&port, socket.as_raw_socket() as usize, watcher).unwrap();
    watch.set_interest(Readiness::SEND);
    port.prepare();
    watch.set_address(after);
    let seen = Cell::new(None);
    port.wait(Some(10_000_000_000));
    port.dispatch(|event| match event {
        Event::Socket(address, _) => seen.set(Some(address)),
        Event::Wake => unreachable!(),
    });
    assert_eq!(seen.get(), Some(after));
    port.shut_down();
    watch.set_address(before);
}

#[test]
fn the_base_socket_is_found_under_layers_that_hide_it() {
    const SIO_BASE_HANDLE: u32 = 0x4800_0022;
    const SOCKET_ERROR: usize = usize::MAX;
    let (socket, _peer) = connected();
    let base = socket.as_raw_socket() as usize;
    let layers = |below: fn(usize, usize) -> Option<usize>| {
        intercept(Call::WSAIoctl, move |args| {
            if args[1] as u32 == SIO_BASE_HANDLE {
                return Some(SOCKET_ERROR);
            }
            let Some(below) = below(args[0], base) else {
                return Some(SOCKET_ERROR);
            };
            // SAFETY: the output of the call, which has room for a socket.
            unsafe { ptr::with_exposed_provenance_mut::<usize>(args[4]).write(below) };
            Some(0)
        })
    };
    let two = layers(|socket, base| Some((socket - 4).max(base)));
    assert_eq!(sys::base_socket(base + 8), Ok(base));
    drop(two);
    let silent = layers(|_, _| None);
    assert_eq!(sys::base_socket(base), Ok(base));
    drop(silent);
    let _endless = layers(|socket, _| Some(socket ^ 4));
    assert!(sys::base_socket(base).is_ok());
}

#[test]
fn a_call_runs_on_a_thread_that_cannot_be_interrupted() {
    for call in [Call::OpenThread, Call::CreateEventW] {
        let run = move || {
            let _refused = fail(call, 1, NULL);
            Cancel::default().run(|| 7)
        };
        assert_eq!(std::thread::spawn(run).join().unwrap(), Some(7));
    }
}

#[test]
fn a_cancellation_is_repeated_until_the_call_has_returned() {
    let pair = w::pipe_pair(
        PipeMode::Synchronous,
        PipeMode::Synchronous,
        PipeDirection::OursReads,
    );
    let pair = pair.unwrap();
    let file = bun_sys::File::from(pair.ours);
    let (fd, cancel) = (file.fd(), Cancel::default());
    let ((entered, has_entered), (go, may_go)) = (mpsc::channel(), mpsc::channel());
    let thread = cancel.clone();
    let reader = std::thread::spawn(move || {
        thread.run(|| {
            entered.send(()).unwrap();
            may_go.recv().unwrap();
            bun_sys::read(fd, &mut [0; 8]).map_err(|err| err.get_errno())
        })
    });
    has_entered.recv().unwrap();
    cancel.cancel();
    cancel.cancel();
    go.send(()).unwrap();
    assert_eq!(reader.join().unwrap(), Some(Err(bun_sys::E::ECANCELED)));
}

#[test]
fn a_task_outlasts_a_lack_of_threads() {
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Test",
        max_threads: 2,
        stack_size: 256 * 1024,
        on_thread_start: || {},
        has_new_threads: false,
    });
    let ((ran, has_run), (go, may_go)) = (mpsc::channel(), mpsc::channel());
    let first = ran.clone();
    let none_yet = fail(Call::CreateThread, 3, NULL);
    POOL.go(move || {
        first.send(1).unwrap();
        may_go.recv().unwrap();
    });
    assert_eq!(has_run.recv(), Ok(1));
    drop(none_yet);

    let _no_more = fail(Call::CreateThread, usize::MAX, NULL);
    POOL.go(move || ran.send(2).unwrap());
    assert!(has_run.try_recv().is_err());
    go.send(()).unwrap();
    assert_eq!(has_run.recv(), Ok(2));
}

#[test]
fn what_is_deferred_over_and_over_has_a_share_of_the_time() {
    fn again(port: &Rc<Port>, slot: Rc<Cell<Option<Request>>>, rounds: Rc<Cell<usize>>) {
        let (next_port, next_slot) = (Rc::clone(port), Rc::clone(&slot));
        slot.set(Some(Request::defer(port, move || {
            rounds.update(|it| it + 1);
            again(&next_port, next_slot, rounds)
        })));
    }
    let port = Port::new().unwrap();
    let (slot, rounds) = (Rc::default(), Rc::default());
    again(&port, Rc::clone(&slot), Rc::clone(&rounds));
    CLOCK_STEP.set(Duration::from_millis(1));
    for (busy_ms, expected) in [(0, 2..16), (50, 30..80), (0, 2..24), (9000, 60..120)] {
        CLOCK_AHEAD.set(CLOCK_AHEAD.get() + Duration::from_millis(busy_ms));
        turn(&port, Duration::ZERO);
        assert!(expected.contains(&rounds.take()), "{busy_ms}");
    }
    slot.take();
}

#[test]
fn a_slow_turn_waits_a_moment_for_more() {
    let port = Port::new().unwrap();
    for (busy_ms, is_waited_for) in [(0, false), (50, true)] {
        let start = Instant::now();
        turn(&port, Duration::ZERO);
        let has_come = Rc::new(Cell::new(false));
        let (came, slot, next_port) = (
            Rc::clone(&has_come),
            Rc::new(Cell::new(None)),
            Rc::clone(&port),
        );
        let next = Rc::clone(&slot);
        let _first = Request::defer(&port, move || {
            let (request, remote) = Request::remote(&next_port, move |()| came.set(true));
            next.set(Some(request));
            remote.complete(());
            next_port.expect_more();
        });
        CLOCK_AHEAD.set(CLOCK_AHEAD.get() + Duration::from_millis(busy_ms));
        turn(&port, Duration::ZERO);
        if has_other_cpu() && (is_waited_for || start.elapsed() < Duration::from_millis(2)) {
            assert_eq!(has_come.get(), is_waited_for);
        }
        run_until(&port, || has_come.get());
    }
    port.expect_more();
    CLOCK_AHEAD.set(CLOCK_AHEAD.get() + Duration::from_millis(50));
    assert_eq!(turn(&port, Duration::ZERO), 0);
}

#[test]
fn timers_that_keep_overrunning_yield() {
    let port = Port::new().unwrap();
    let pass = |ms| CLOCK_AHEAD.set(CLOCK_AHEAD.get() + Duration::from_millis(ms));
    let (lost_ms, waker) = (Rc::new(Cell::new(0)), port.waker());
    let lost = Rc::clone(&lost_ms);
    let _waking = intercept(Call::SwitchToThread, move |_| {
        pass(lost.get());
        waker.wake();
        Some(1)
    });
    CLOCK_STOPPED_AT.set(Some(Instant::now()));
    let yields = |busy_ms| {
        pass(busy_ms);
        port.note_overdue_timer();
        turn(&port, Duration::ZERO)
    };
    assert_eq!([50; 3].map(yields), [0, 1, 1]);
    assert_eq!([6; 6].map(yields), [0, 0, 1, 0, 0, 1]);

    pass(50);
    assert_eq!(turn(&port, Duration::ZERO), 0);
    let _ready = Request::defer(&port, || {});
    assert_eq!([0; 2].map(yields), [0, 1]);

    let waits = || {
        port.waker().wake();
        assert_eq!(turn(&port, Duration::from_secs(10)), 1);
    };
    waits();
    assert_eq!([500; 2].map(yields), [0, 1]);

    lost_ms.set(10);
    assert_eq!([20, 20, 5].map(yields), [1, 0, 1]);
    lost_ms.set(50);
    assert_eq!([50; 6].map(yields), [1, 0, 0, 0, 1, 0]);
    waits();
    assert_eq!([20, 20, 100].map(yields), [0, 0, 1]);
    lost_ms.set(3_600_000);
    assert_eq!([200, 2200, 100].map(yields), [1, 0, 1]);
}

#[test]
fn a_flood_is_left_to_gather() {
    let port = Port::new().unwrap();
    CLOCK_STOPPED_AT.set(Some(Instant::now()));
    CLOCK_STEP.set(Duration::from_nanos(100));
    let micros = |sends: bool| {
        let before = CLOCK_AHEAD.get();
        port.did_receive();
        if sends {
            port.did_send();
        }
        port.waker().wake();
        turn(&port, Duration::from_secs(10));
        (CLOCK_AHEAD.get() - before).as_micros()
    };
    let pause = if has_other_cpu() { 19..22 } else { 0..2 };
    for _ in 0..2 {
        assert!((0..4).all(|_| micros(false) < 2));
        assert!((0..4).all(|_| pause.contains(&micros(false))));
        assert!(micros(true) < 2);
    }
    let pauses = (0..128).filter(|_| micros(false) >= 2).count();
    assert_eq!(pauses, if has_other_cpu() { 120 } else { 0 });
}

#[test]
fn what_comes_to_a_thread_that_sleeps_is_no_flood() {
    let port = Port::new().unwrap();
    CLOCK_STOPPED_AT.set(Some(Instant::now()));
    CLOCK_STEP.set(Duration::from_nanos(100));
    let waker = port.waker();
    let _sender = intercept(Call::NtRemoveIoCompletionEx, move |args| {
        // SAFETY: the timeout of the call.
        if unsafe { ptr::with_exposed_provenance::<i64>(args[4]).as_ref() } != Some(&0) {
            waker.wake();
        }
        None
    });
    for _ in 0..8 {
        let before = CLOCK_AHEAD.get();
        port.did_receive();
        turn(&port, Duration::from_secs(10));
        assert!((CLOCK_AHEAD.get() - before).as_micros() < 5);
    }
}

#[test]
fn a_thread_waits_for_writes_but_not_for_long() {
    let port = Port::new().unwrap();
    assert!(!port.wait_for_pending_writes());

    let end_soon = |write| {
        blocking::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            drop(write);
        });
    };
    end_soon(port.pending_write());
    assert!(!port.wait_for_pending_writes());

    let _never = port.pending_write();
    end_soon(port.pending_write());
    assert!(port.wait_for_pending_writes());
    CLOCK_STEP.set(Duration::from_secs(1));
    assert!(!port.wait_for_pending_writes());
}

#[test]
fn a_hold_counts_once() {
    let port = Port::new().unwrap();
    let (first, second) = (Hold::new(&port), Hold::new(&port));
    first.set(true);
    first.set(true);
    second.set(true);
    first.set(false);
    assert!(port.is_held());
    drop(second);
    assert!(!port.is_held());
}

#[test]
fn pipes_are_read_to_their_end_side_by_side() {
    let (ours, theirs) = (PipeMode::Overlapped, PipeMode::Synchronous);
    let [first, second, broken] =
        [(); 3].map(|()| w::pipe_pair(ours, theirs, PipeDirection::OursReads).unwrap());
    drop(broken.theirs);
    let writer = std::thread::spawn(move || {
        let files = [second.theirs, first.theirs].map(bun_sys::File::from);
        for (file, byte) in files.iter().zip([2, 1]) {
            file.write_all(&vec![byte; 300_000]).unwrap();
        }
    });
    let pipes = [Some(first.ours), None, Some(second.ours), Some(broken.ours)];
    let read = crate::read_to_end(pipes).unwrap();
    assert!(read == [vec![1; 300_000], vec![], vec![2; 300_000], vec![]]);
    writer.join().unwrap();
}

#[test]
fn a_finished_request_keeps_its_slot_while_the_packet_is_under_way() {
    if !has_wait_packets() {
        return;
    }
    let port = Port::new().unwrap();
    let (file, peer) = pipe(&port, AsyncFile::shared);
    let read = start_read(&file, &Slot::default());
    let under_way = status(NTSTATUS::PENDING);
    let _late = fail(Call::NtCancelWaitCompletionPacket, 1, under_way);
    let finished = read.finish_now().ok().unwrap();
    assert_eq!(finished.status, NTSTATUS::CANCELLED);
    read_some(&port, &file, &peer);
}

#[test]
fn only_what_has_ended_can_be_taken() {
    let port = Port::new().unwrap();
    let (file, peer) = pipe(&port, AsyncFile::exclusive);
    let pending = start_read(&file, &Slot::default());
    drop(pending.take_immediate().err().unwrap());
    drop(Request::defer(&port, || {}).finish_now().err().unwrap());
    run_until(&port, || !port.requests.is_system_writing());

    peer.write_all(b"here").unwrap();
    let ended = start_read(&file, &Slot::default());
    ended.cancel();
    assert_eq!(ended.finish_now().ok().unwrap().buffer, b"here");
}

#[test]
fn a_rest_is_over_for_a_watch_that_has_gone_or_polls_again() {
    let port = Port::new().unwrap();
    let (socket, _peer) = connected();
    for is_dropped in [true, false] {
        let (watch, seen) = watch(&port, &socket);
        let refused = fail(Call::NtDeviceIoControlFile, 1, NO_RESOURCES);
        watch.set_interest(Readiness::DISCONNECT);
        turn(&port, Duration::from_millis(1));
        let watch = (!is_dropped).then_some(watch);
        if let Some(watch) = &watch {
            watch.set_interest(Readiness::DISCONNECT | Readiness::RECEIVE);
        }
        turn(&port, Duration::from_millis(1));

        drop(refused);
        let (_counted, polls) = count(Call::NtDeviceIoControlFile);
        CLOCK_AHEAD.set(CLOCK_AHEAD.get() + Duration::from_secs(1));
        turn(&port, Duration::from_millis(1));
        turn(&port, Duration::from_millis(1));
        assert_eq!((polls.get(), seen.take()), (0, Vec::new()));
    }
}
