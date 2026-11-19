//! Temporary: run on the Windows machines, and removed before the PR is ready.

#[path = "../../iocp/faults.rs"]
#[expect(unused)]
mod faults;

use core::cell::{Cell, RefCell};
use core::time::Duration;
use std::io::Write as _;
use std::net::{TcpListener, TcpStream};
use std::os::windows::io::{AsRawHandle as _, IntoRawSocket as _, OwnedHandle};
use std::time::Instant;

use bun_sys::windows::{NTSTATUS, PipeDirection, PipeMode, PipePair};

use self::faults::{Call, fail};
use super::*;
use crate::pipe_writer::WriteEvent;
use crate::{IoEvent, PollTag};

#[unsafe(no_mangle)]
extern "C" fn clock_gettime_monotonic(sec: &mut i64, nsec: &mut i64) {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    let now = START.get_or_init(Instant::now).elapsed() + Duration::from_secs(1);
    (*sec, *nsec) = (now.as_secs() as i64, now.subsec_nanos().into());
}

#[derive(Debug, PartialEq, Eq)]
enum Seen {
    Data(Vec<u8>),
    Eof,
    ReadErr(E),
    Wrote,
    WriteErr(E),
    Other,
}

thread_local! {
    static SEEN: RefCell<std::collections::VecDeque<Seen>> = RefCell::default();
}

#[unsafe(no_mangle)]
fn __bun_run_io(_: Owner, event: IoEvent) {
    SEEN.with_borrow_mut(|seen| {
        seen.push_back(match event {
            IoEvent::Read(ReadEvent::Data(data)) => Seen::Data(data),
            IoEvent::Read(ReadEvent::Eof) => Seen::Eof,
            IoEvent::Read(ReadEvent::Err(err)) => Seen::ReadErr(err.get_errno()),
            IoEvent::Write(WriteEvent::Wrote(_)) => Seen::Wrote,
            IoEvent::Write(WriteEvent::Failed(err)) => Seen::WriteErr(err.get_errno()),
            _ => Seen::Other,
        });
    });
}

fn turn(port: &Port, ms: u64) {
    port.prepare();
    port.wait(Some(ms * 1_000_000));
    port.dispatch(|_| {});
}

fn until(port: &Port, is_done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !is_done() {
        assert!(Instant::now() < deadline);
        turn(port, 20);
    }
}

fn next(port: &Port) -> Seen {
    until(port, || SEEN.with_borrow(|seen| !seen.is_empty()));
    SEEN.with_borrow_mut(|seen| seen.pop_front().unwrap())
}

fn nothing_comes(port: &Port) {
    for _ in 0..3 {
        turn(port, 10);
    }
    assert_eq!(SEEN.with_borrow_mut(|seen| seen.pop_front()), None);
}

fn owner() -> Owner {
    Owner::new(PollTag::FileReader, core::ptr::dangling_mut())
}

fn reader(source: impl Into<ReadSource>) -> ReadSource {
    let source = source.into();
    // SAFETY: nothing looks at it.
    unsafe { source.set_owner(owner()) };
    source
}

fn writer(source: impl Into<WriteSource>) -> WriteSource {
    let source = source.into();
    // SAFETY: nothing looks at it.
    unsafe { source.set_owner(owner()) };
    source
}

fn pair(ours: PipeMode, direction: PipeDirection) -> (Fd, sys::File) {
    let PipePair { ours, theirs } = w::pipe_pair(ours, PipeMode::Synchronous, direction).unwrap();
    (sys::File::from(ours).into_raw(), theirs.into())
}

fn socket() -> (Fd, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let ours = listener.accept().unwrap().0.into_raw_socket();
    (Fd::from_system(ours as usize as _), peer)
}

fn looks_busy() -> faults::Intercepted {
    fail(Call::WaitForSingleObject, 1, 258)
}

fn set_nowait(fd: Fd) {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetNamedPipeHandleState(pipe: w::HANDLE, mode: &u32, a: usize, b: usize) -> i32;
    }
    // SAFETY: the last two are optional.
    assert_ne!(unsafe { SetNamedPipeHandleState(fd.native(), &1, 0, 0) }, 0);
}

fn drain(peer: sys::File) -> std::thread::JoinHandle<usize> {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(30));
        let (mut buf, mut total) = (vec![0; 1 << 16], 0);
        while let Ok(read @ 1..) = peer.read(&mut buf) {
            total += read;
        }
        total
    })
}

fn temp_file(name: &str, contents: &[u8], is_readable: bool) -> Fd {
    let path = std::env::temp_dir().join(format!("bun-io-{}-{name}", std::process::id()));
    std::fs::write(&path, contents).unwrap();
    let mut options = std::fs::OpenOptions::new();
    let file = options.read(is_readable).write(!is_readable).open(&path);
    let handle = OwnedHandle::from(file.unwrap());
    let _ = std::fs::remove_file(path);
    sys::File::from(handle).into_raw()
}

const BOTH: [PipeMode; 2] = [PipeMode::Overlapped, PipeMode::Synchronous];

#[test]
fn an_end_that_looks_busy_is_read_and_written() {
    let port = Port::new().unwrap();
    for mode in BOTH {
        let (fd, peer) = pair(mode, PipeDirection::Duplex);
        let busy = looks_busy();
        let source = reader(ReadSource::open(&port, fd, Ownership::Taken, None).unwrap());
        drop(busy);
        source.read(usize::MAX);
        assert!(source.take_available().is_none());
        peer.write_all(b"abc").unwrap();
        assert_eq!(next(&port), Seen::Data(b"abc".into()));

        let (fd, peer) = pair(mode, PipeDirection::Duplex);
        let busy = looks_busy();
        let sink = writer(WriteSource::open(&port, fd, Ownership::Taken).unwrap());
        drop(busy);
        let total = drain(peer);
        assert!(sink.write_now(vec![0; 200_000]).unwrap().is_none());
        assert_eq!(next(&port), Seen::Wrote);
        sink.write(Payload::Shared(Rc::new(vec![0; 100_000])))
            .unwrap();
        assert_eq!(next(&port), Seen::Wrote);
        drop(sink);
        assert_eq!(total.join().unwrap(), 300_000);
    }
}

#[test]
fn what_is_no_pipe() {
    let port = Port::new().unwrap();
    let file = sys::File::from_fd(temp_file("duplex", b"", true));
    let refused = |fd| Pipe::open_duplex(&port, fd).err().unwrap().get_errno();
    assert_eq!(refused(file.fd()), E::NOTSOCK);
    let (fd, mut peer) = socket();
    assert_eq!(refused(fd), E::NOTSOCK);
    let missing = ReadSource::open(&port, Fd::INVALID, Ownership::Borrowed, None);
    assert_eq!(missing.err().unwrap().get_errno(), E::BADF);

    let busy = looks_busy();
    let source = reader(ReadSource::open(&port, fd, Ownership::Borrowed, None).unwrap());
    drop(busy);
    source.read(usize::MAX);
    assert_eq!(next(&port), Seen::ReadErr(E::NOTSOCK));

    let busy = looks_busy();
    let sink = writer(WriteSource::open(&port, fd, Ownership::Borrowed).unwrap());
    drop(busy);
    sink.write(Payload::Owned(vec![0])).unwrap();
    assert_eq!(next(&port), Seen::WriteErr(E::NOTSOCK));

    let idle = fail(Call::WaitForSingleObject, 1, 0);
    let source = reader(ReadSource::open(&port, fd, Ownership::Borrowed, None).unwrap());
    drop(idle);
    assert!(source.fd().is_valid() && source.take_available().is_none());
    source.read(usize::MAX);
    peer.write_all(b"abc").unwrap();
    assert!(matches!(
        next(&port),
        Seen::Data(_) | Seen::ReadErr(E::INVAL)
    ));
    drop(source);
    nothing_comes(&port);
}

#[test]
fn a_synchronous_end_takes_turns() {
    let port = Port::new().unwrap();
    let (fd, peer) = pair(PipeMode::Synchronous, PipeDirection::Duplex);
    let pipe = Pipe::open_duplex(&port, fd).unwrap();
    let (source, sink) = (reader(pipe.clone()), writer(pipe));
    for _ in 0..20 {
        source.read(usize::MAX);
        turn(&port, 1);
        sink.write(Payload::Owned(b"out".into())).unwrap();
        source.read(usize::MAX);
        assert_eq!(next(&port), Seen::Wrote);
        assert_eq!(peer.read(&mut [0; 8]).unwrap(), 3);
        peer.write_all(b"in").unwrap();
        assert_eq!(next(&port), Seen::Data(b"in".into()));
    }
    sink.write(Payload::Owned(vec![0; 1 << 20])).unwrap();
    source.read(usize::MAX);
    nothing_comes(&port);
    drop(sink);
    peer.write_all(b"late").unwrap();
    assert_eq!(next(&port), Seen::Data(b"late".into()));
}

#[test]
fn an_end_that_does_not_wait() {
    let port = Port::new().unwrap();
    for mode in BOTH {
        let (fd, peer) = pair(mode, PipeDirection::Duplex);
        let pipe = Pipe::open_duplex(&port, fd).unwrap();
        let (source, sink) = (reader(pipe.clone()), writer(pipe));
        set_nowait(fd);
        source.read(usize::MAX);
        nothing_comes(&port);
        peer.write_all(b"abc").unwrap();
        assert_eq!(next(&port), Seen::Data(b"abc".into()));

        set_nowait(fd);
        let total = drain(peer);
        assert!(sink.write_now(vec![0; 300_000]).unwrap().is_none());
        assert_eq!(next(&port), Seen::Wrote);
        set_nowait(fd);
        sink.write(Payload::Owned(vec![0; 300_000])).unwrap();
        assert_eq!(next(&port), Seen::Wrote);
        drop((source, sink));
        assert_eq!(total.join().unwrap(), 600_000);
    }
}

#[test]
fn the_wrong_direction() {
    let port = Port::new().unwrap();
    for mode in BOTH {
        let (fd, _peer) = pair(mode, PipeDirection::OursReads);
        let sink = writer(Pipe::open_duplex(&port, fd).unwrap());
        match sink.write(Payload::Owned(vec![0])) {
            Ok(()) => assert_eq!(next(&port), Seen::WriteErr(E::PIPE)),
            Err(err) => assert_eq!(err.get_errno(), E::PIPE),
        }
        let (fd, _peer) = pair(mode, PipeDirection::OursWrites);
        let source = reader(Pipe::open_duplex(&port, fd).unwrap());
        source.read(usize::MAX);
        assert_eq!(next(&port), Seen::ReadErr(E::NOTCONN));
    }
    let fd = temp_file("write-only", b"abc", false);
    let source = reader(ReadSource::open(&port, fd, Ownership::Taken, None).unwrap());
    source.read(usize::MAX);
    assert_eq!(next(&port), Seen::ReadErr(E::BADF));
}

#[test]
fn what_comes_during_a_pause_is_kept() {
    let port = Port::new().unwrap();
    let (fd, peer) = pair(PipeMode::Overlapped, PipeDirection::OursReads);
    let pipe = reader(Pipe::from_exclusive(&port, sys::File::from_fd(fd)));
    let fd = temp_file("paused", b"abcdef", true);
    let file = reader(ReadSource::open(&port, fd, Ownership::Taken, Some(0)).unwrap());
    peer.write_all(b"abcdef").unwrap();
    drop(peer);
    for source in [pipe, file] {
        source.read(usize::MAX);
        source.pause();
        nothing_comes(&port);
        source.read(4);
        source.read(4);
        assert_eq!(next(&port), Seen::Data(b"abcd".into()));
        source.read_on(4);
        assert_eq!(next(&port), Seen::Data(b"ef".into()));
        source.read_on(4);
        assert_eq!(next(&port), Seen::Eof);
    }
}

#[test]
fn what_is_held_can_be_taken() {
    let port = Port::new().unwrap();
    let (fd, peer) = pair(PipeMode::Overlapped, PipeDirection::OursReads);
    let source = reader(Pipe::from_exclusive(&port, sys::File::from_fd(fd)));
    source.read(usize::MAX);
    assert!(source.take_available().is_none());
    source.pause();
    peer.write_all(b"abc").unwrap();
    nothing_comes(&port);
    source.read(usize::MAX);
    assert!(matches!(source.take_available(), Some(ReadEvent::Data(data)) if data == b"abc"));
    nothing_comes(&port);
}

#[test]
fn a_write_to_a_file_is_finished_or_never_started() {
    let port = Port::new().unwrap();
    let fd = temp_file("written", b"", false);
    let sink = writer(WriteSource::open(&port, fd, Ownership::Taken).unwrap());
    assert!(sink.is_file() && !sink.is_console() && sink.write_to_console(b"").is_none());
    assert!(sink.write_now(b"abc".into()).unwrap().is_none());
    finish_writes_to_disk();
    assert_eq!(next(&port), Seen::Other);
    until(&port, || port.callback_count() == 0);
    SEEN.take();
    sink.write(Payload::Shared(Rc::new(*b"def"))).unwrap();
    assert_eq!(next(&port), Seen::Wrote);
    stop_all_for_vm_teardown();
    assert_eq!(next(&port), Seen::Other);
}

fn name(suffix: &str) -> Vec<u8> {
    format!(r"\\.\pipe\bun-io-{}-{suffix}", std::process::id()).into()
}

fn serve(port: &Rc<Port>, name: &[u8]) -> (sys::Result<PipeServer>, Rc<RefCell<Vec<Pipe>>>) {
    let accepted = Rc::new(RefCell::new(Vec::new()));
    let into = Rc::clone(&accepted);
    let server = PipeServer::listen(port, name, move |pipe| into.borrow_mut().push(pipe));
    (server, accepted)
}

fn connect(port: &Rc<Port>, name: &[u8]) -> (PipeConnect, Rc<Cell<Option<sys::Result<Pipe>>>>) {
    let result = Rc::new(Cell::new(None));
    let into = Rc::clone(&result);
    let attempt = PipeConnect::start(port, name, move |it| into.set(Some(it))).unwrap();
    (attempt, result)
}

#[test]
fn a_server_can_be_refused() {
    let port = Port::new().unwrap();
    let errno = |name: &[u8]| serve(&port, name).0.err().unwrap().get_errno();
    assert_eq!(errno(br"C:\no\pipe"), E::ACCES);
    assert_eq!(errno(b"\xff"), E::INVAL);
    let _first = serve(&port, &name("twice")).0.unwrap();
    assert_eq!(errno(&name("twice")), E::ADDRINUSE);
    let _refused = fail(Call::CreateNamedPipeW, 1, usize::MAX);
    assert_eq!(errno(&name("memory")), E::NOMEM);
}

#[test]
fn a_server_outlasts_a_lack_of_resources() {
    let no_resources = NTSTATUS::INSUFFICIENT_RESOURCES.0 as usize;
    for (call, result) in [
        (Call::CreateNamedPipeW, usize::MAX),
        (Call::NtFsControlFile, no_resources),
    ] {
        let port = Port::new().unwrap();
        let name = name(&format!("{call:?}"));
        let (_server, accepted) = serve(&port, &name);
        let _refused = fail(call, 6, result);
        let clients = RefCell::new(Vec::new());
        until(&port, || {
            clients.borrow_mut().push(connect(&port, &name));
            accepted.borrow().len() >= 12
        });
        drop(clients);
    }
}

#[test]
fn a_client_waits_in_line() {
    let port = Port::new().unwrap();
    let name = name("line");
    let wide: Vec<u16> = name.iter().map(|&it| it.into()).chain([0]).collect();
    let wide = bun_core::WStr::from_slice_with_nul(&wide);
    for is_wait_refused in [false, true] {
        let only = w::named_pipe::create_instance(wide, true).unwrap();
        let _first = w::named_pipe::connect(wide).unwrap();
        let invalid = 0xC000_000D;
        let _refused = fail(Call::NtFsControlFile, usize::from(is_wait_refused), invalid);
        let [given_up, (_second, second), (_third, third)] =
            [(); 3].map(|()| connect(&port, &name));
        drop(given_up);
        nothing_comes(&port);
        let more = w::named_pipe::create_instance(wide, false).unwrap();
        let has = |it: &Cell<Option<_>>| {
            let value = it.take();
            let has = value.is_some();
            it.set(value);
            has
        };
        until(&port, || has(&second));
        assert!(second.take().unwrap().is_ok() && !has(&third));
        assert!(!only.as_raw_handle().is_null());
        drop((only, more, _first));
        until(&port, || has(&third));
        assert_eq!(third.take().unwrap().err().unwrap().get_errno(), E::NOENT);
    }
}
