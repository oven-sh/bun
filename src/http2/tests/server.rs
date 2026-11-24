use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, RefCell};
use std::ptr::null_mut;
use std::rc::Rc;
use std::time::{Duration, Instant};

use bun_core::strings::ByteSet;
use bun_hpack::Decoder;
use bun_http2::server::{self, Connection, Server};

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for highway_byte_set.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_byte_set_prefix_length(
    text: *const u8,
    len: usize,
    set: &ByteSet,
) -> usize {
    // SAFETY: `ByteSet::prefix_len` passes a slice.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&byte| set.contains(byte)).count()
}

/// Stands in for highway_strings.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(text: *const u8, len: usize, byte: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&other| other != byte).count()
}

struct Allocator;

// SAFETY: it forwards to `System`.
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LARGEST_ALLOCATION.set(LARGEST_ALLOCATION.get().max(layout.size()));
        ALLOCATED.set(ALLOCATED.get().wrapping_add(layout.size()));
        // SAFETY: the contract of this function.
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        ALLOCATED.set(ALLOCATED.get().wrapping_sub(layout.size()));
        // SAFETY: the contract of this function.
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Allocator = Allocator;

type Stream = Rc<server::Stream<Host>>;
type Handler = Box<dyn Fn(&Stream)>;

const DATA: u8 = 0;
const HEADERS: u8 = 1;
const RST_STREAM: u8 = 3;
const SETTINGS: u8 = 4;
const PING: u8 = 6;
const GOAWAY: u8 = 7;
const WINDOW_UPDATE: u8 = 8;
const CONTINUATION: u8 = 9;
const END_STREAM: u8 = 1;
const END_HEADERS: u8 = 4;
const PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
const GET: &[u8] = b"\x82\x86\x84\x01\x01h";
const IDLE_TIMEOUT: u32 = 10;

thread_local! {
    static LARGEST_ALLOCATION: Cell<usize> = const { Cell::new(0) };
    static ALLOCATED: Cell<usize> = const { Cell::new(0) };
    static CONNECTION: RefCell<Option<Rc<Connection<Host>>>> = const { RefCell::new(None) };
    static WRITTEN: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static ROOM: Cell<usize> = const { Cell::new(usize::MAX) };
    static ROOM_AFTER_REFUSAL: Cell<usize> = const { Cell::new(0) };
    static DEFERS_CLOSE: Cell<bool> = const { Cell::new(false) };
    static EVENTS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    static TIMEOUTS: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
    static NOW: Cell<Instant> = Cell::new(Instant::now());
}

fn log(event: impl Into<String>) {
    EVENTS.with_borrow_mut(|events| events.push(event.into()));
}

#[derive(Clone, Copy)]
struct Socket;

impl server::Socket for Socket {
    fn write(self, bytes: &[u8]) -> usize {
        let len = bytes.len().min(ROOM.get());
        ROOM.set(ROOM.get() - len);
        if len == 0 {
            ROOM.set(ROOM_AFTER_REFUSAL.take());
        }
        WRITTEN.with_borrow_mut(|written| written.extend(&bytes[..len]));
        len
    }
    fn request_writable(self) {
        log("request writable");
    }
    fn shutdown(self) {
        log("shutdown");
    }
    fn close(self) {
        log("close");
        if !DEFERS_CLOSE.take() {
            CONNECTION.take().unwrap().on_close();
        }
    }
    fn set_timeout(self, seconds: u32) {
        TIMEOUTS.with_borrow_mut(|timeouts| timeouts.push(seconds));
    }
}

struct Host(Handler);

impl server::Host for Host {
    type Socket = Socket;
    type Field = ();

    fn field(_: &[u8], _: &[u8]) {}
    fn route(&self, stream: &Stream, _: server::Request<'_, ()>) -> bool {
        log("request");
        self.0(stream);
        true
    }
    fn date(&self) -> [u8; 29] {
        [b'd'; 29]
    }
    fn max_header_size(&self) -> usize {
        16384
    }
    fn schedule_drain(&self) {
        log("schedule");
    }
    fn now(&self) -> Instant {
        NOW.get()
    }
}

fn frame(kind: u8, flags: u8, stream: u32, payload: &[u8]) -> Vec<u8> {
    let len = (payload.len() as u32).to_be_bytes();
    [&len[1..], &[kind, flags], &stream.to_be_bytes(), payload].concat()
}

fn get(stream: u32) -> Vec<u8> {
    frame(HEADERS, END_HEADERS | END_STREAM, stream, GET)
}

fn post(stream: u32) -> Vec<u8> {
    frame(HEADERS, END_HEADERS, stream, GET)
}

fn window_update(stream: u32, increment: u32) -> Vec<u8> {
    frame(WINDOW_UPDATE, 0, stream, &increment.to_be_bytes())
}

fn setting(id: u8, value: u32) -> Vec<u8> {
    let payload = [&[0, id][..], &value.to_be_bytes()].concat();
    frame(SETTINGS, 0, 0, &payload)
}

fn connection() -> Rc<Connection<Host>> {
    CONNECTION.with_borrow(Clone::clone).unwrap()
}

fn send(bytes: &[u8]) {
    connection().on_data(bytes);
}

fn make_room(room: usize) {
    ROOM.set(room);
    connection().on_writable();
}

fn log_abort(stream: &Stream) {
    stream.set_on_aborted(Some(|_, _| log("aborted")), null_mut());
}

fn log_body(stream: &Stream) {
    let handler: server::OnData<Host> = |_, chunk, is_last, _| {
        log(format!("body {} {is_last}", chunk.escape_ascii()));
    };
    stream.set_on_data(Some(handler), null_mut());
}

struct Peer {
    server: Rc<Server<Host>>,
    streams: Rc<RefCell<Vec<Stream>>>,
    decoder: RefCell<Decoder>,
}

impl Peer {
    fn before_preface(handler: impl Fn(&Stream) + 'static) -> Self {
        let streams = Rc::<RefCell<Vec<Stream>>>::default();
        let kept = Rc::clone(&streams);
        let handler = move |stream: &Stream| {
            kept.borrow_mut().push(Rc::clone(stream));
            handler(stream);
        };
        let server = Server::new(Host(Box::new(handler)), IDLE_TIMEOUT);
        CONNECTION.set(Some(Connection::new(Rc::clone(&server), Socket, 0)));
        ROOM.set(usize::MAX);
        EVENTS.take();
        Self {
            server,
            streams,
            decoder: RefCell::new(Decoder::new()),
        }
    }

    fn new(handler: impl Fn(&Stream) + 'static) -> Self {
        let peer = Self::before_preface(handler);
        send(&[PREFACE, &frame(SETTINGS, 0, 0, b"")].concat());
        WRITTEN.take();
        TIMEOUTS.take();
        peer
    }

    fn with_wide_windows(handler: impl Fn(&Stream) + 'static) -> Self {
        let peer = Self::new(handler);
        send(&[setting(4, 1 << 30), window_update(0, 1 << 30)].concat());
        WRITTEN.take();
        peer
    }

    fn stream(&self, index: usize) -> Stream {
        Rc::clone(&self.streams.borrow()[index])
    }

    /// The whole ones since the last call.
    fn frames(&self) -> Vec<String> {
        let written = WRITTEN.take();
        let mut rest = written.as_slice();
        let mut frames = Vec::new();
        while let &[a, b, c, kind, flags, _, _, d, e, ref after @ ..] = rest
            && let Some((payload, after)) =
                after.split_at_checked(u32::from_be_bytes([0, a, b, c]) as usize)
        {
            rest = after;
            let number = || u32::from_be_bytes(*payload.last_chunk().unwrap());
            let id = u16::from_be_bytes([d, e]);
            frames.push(match kind {
                DATA => format!("DATA {id} {flags} {}", payload.len()),
                HEADERS if flags & END_HEADERS != 0 => {
                    let (mut text, mut scratch) = (format!("HEADERS {id} {flags}"), Vec::new());
                    let mut decoder = self.decoder.borrow_mut();
                    let mut fields = decoder.decode(payload, &mut scratch);
                    while let Some(field) = fields.next().unwrap() {
                        if field.name != b"date" {
                            text += &format!(" {}", field.value.escape_ascii());
                        }
                    }
                    text
                }
                RST_STREAM => format!("RST_STREAM {id} {}", number()),
                GOAWAY => format!("GOAWAY {} {}", payload[3], number()),
                WINDOW_UPDATE => format!("WINDOW_UPDATE {id} {}", number()),
                _ => format!("{kind} {id} {flags} {}", payload.len()),
            });
        }
        WRITTEN.set(rest.to_vec());
        frames
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        Connection::close_all(CONNECTION.with_borrow(Clone::clone).into_iter());
        self.server.cancel_drain();
        self.streams.take();
        WRITTEN.take();
        if !std::thread::panicking() {
            assert_eq!(Rc::strong_count(&self.server), 1, "a connection is left");
        }
    }
}

#[test]
fn reads_may_end_anywhere() {
    let conversation = [
        PREFACE,
        &frame(SETTINGS, 0, 0, b"\0\x04\0\0\0\x02"),
        &frame(HEADERS, 0x28, 1, b"\x01\0\0\0\0\x10\x82\x86\0"),
        &frame(CONTINUATION, END_HEADERS, 1, &GET[2..]),
        &frame(DATA, 8, 1, b"\x02ab\0\0"),
        &frame(PING, 0, 0, b"12345678"),
        &frame(DATA, END_STREAM, 1, b"c"),
        &frame(0xff, 0, 0, b""),
    ]
    .concat();
    for first in 1..conversation.len() {
        for second in [1, 2, 8, 9, 10, 40] {
            let peer = Peer::before_preface(|stream| {
                log_body(stream);
                assert_eq!(stream.write(b"xyz"), Err(2));
            });
            let (first, rest) = conversation.split_at(first);
            send(first);
            rest.chunks(second).for_each(send);
            assert_eq!(EVENTS.take(), ["request", "body ab false", "body c true"]);
            assert_eq!(
                peer.frames(),
                [
                    "4 0 0 24",
                    "WINDOW_UPDATE 0 16711681",
                    "4 0 1 0",
                    "HEADERS 1 4 200",
                    "DATA 1 0 2",
                    "6 0 1 8"
                ]
            );
        }
    }
}

#[test]
fn a_handler_may_run_the_event_loop() {
    let (head, tail) = GET.split_at(2);
    let second = [get(3), frame(HEADERS, END_STREAM, 5, head)].concat();
    let third = frame(CONTINUATION, END_HEADERS, 5, tail);
    for first in [
        get(1),
        [
            frame(HEADERS, END_STREAM, 1, head),
            frame(CONTINUATION, END_HEADERS, 1, tail),
        ]
        .concat(),
    ] {
        for at in 1..=first.len() {
            let nested = Cell::new([&second, &third[..4]].concat());
            let peer = Peer::new(move |stream| {
                send(&nested.take());
                stream.end(b"");
            });
            send(&first[..at]);
            send(&first[at..]);
            send(&third[4..]);
            assert_eq!(
                peer.frames(),
                [
                    "HEADERS 3 5 200 0",
                    "HEADERS 1 5 200 0",
                    "HEADERS 5 5 200 0"
                ]
            );
        }
    }
}

#[test]
fn short_writes_lose_nothing() {
    let whole = {
        let _peer = Peer::new(|stream| stream.end(&[7; 40_000]));
        send(&get(1));
        WRITTEN.take()
    };
    for room in [1000, 4096, 16393] {
        let _peer = Peer::new(|stream| stream.end(&[7; 40_000]));
        ROOM.set(5);
        send(&get(1));
        for _ in 0..=whole.len() / room {
            make_room(room);
        }
        assert!(WRITTEN.take() == whole);
    }
}

#[test]
fn what_a_slow_peer_has_read_is_not_kept() {
    let _peer = Peer::new(|stream| {
        stream.write_header(b"a", &[0xff; 5000]);
        stream.end_without_body();
    });
    LARGEST_ALLOCATION.take();
    for id in (1..2000).step_by(2) {
        ROOM.set(0);
        send(&get(id));
        make_room(if id < 20 { 0 } else { 5000 });
        WRITTEN.take();
    }
    assert!(LARGEST_ALLOCATION.get() < 200_000);
}

#[test]
fn a_response_that_waits_does_not_hold_the_room_of_a_long_one() {
    let is_long = Cell::new(true);
    let _peer = Peer::new(move |stream| {
        if is_long.replace(!is_long.get()) {
            stream.write_header(b"a", &[b'a'; 30_000]);
            stream.end_without_body();
        } else {
            stream.write_header(b"a", b"a");
        }
    });
    let before = ALLOCATED.get();
    for id in (1..200).step_by(2) {
        send(&get(id));
        WRITTEN.take();
    }
    assert!(ALLOCATED.get().wrapping_sub(before) < 200_000);
}

#[test]
fn a_few_bytes_do_not_double_a_long_body() {
    let peer = Peer::new(|_| {});
    send(&[setting(4, 0), get(1)].concat());
    assert_eq!(peer.stream(0).write(&[0; 100_000]), Err(0));
    LARGEST_ALLOCATION.take();
    assert_eq!(peer.stream(0).write(&[0; 12]), Err(0));
    assert!(LARGEST_ALLOCATION.get() < 100_000);
}

#[test]
fn an_event_tries_a_refused_write_again() {
    let peer = Peer::new(|stream| stream.end(b"x"));
    ROOM.set(0);
    ROOM_AFTER_REFUSAL.set(100);
    send(&get(1));
    assert_eq!(peer.frames(), ["HEADERS 1 4 200 1", "DATA 1 1 1"]);
}

#[test]
fn long_bodies_take_turns() {
    let peer = Peer::with_wide_windows(|stream| stream.end(&vec![0; 600_000]));
    ROOM.set(0);
    send(&[setting(5, 100_000), get(1), get(3), get(5)].concat());
    make_room(usize::MAX);
    let frames = peer.frames();
    let data = frames.iter().filter(|frame| frame.starts_with("DATA"));
    assert_eq!(
        data.take(12).collect::<Vec<_>>(),
        [
            "DATA 1 0 100000",
            "DATA 1 0 100000",
            "DATA 1 0 62095",
            "DATA 1 0 100000",
            "DATA 3 0 100000",
            "DATA 5 0 62126",
            "DATA 1 0 100000",
            "DATA 3 0 100000",
            "DATA 5 0 62126",
            "DATA 1 0 100000",
            "DATA 3 0 100000",
            "DATA 5 0 62126",
        ]
    );
}

#[test]
fn those_that_had_no_turn_go_first() {
    let peer = Peer::new(|stream| stream.end(&[0; 65535]));
    send(&[setting(4, 1 << 20), get(1), get(3), get(5), get(7)].concat());
    peer.frames();
    for _ in 0..4 {
        send(&window_update(0, 1));
    }
    assert_eq!(
        peer.frames(),
        ["DATA 3 0 1", "DATA 5 0 1", "DATA 7 0 1", "DATA 3 0 1"]
    );
}

#[test]
fn a_writable_handler_goes_on() {
    let peer = Peer::new(|stream| {
        let handler: server::OnWritable<Host> = |stream, sent, _| {
            log(format!("writable {sent}"));
            stream.try_end(&b"abcde"[sent as usize..], 5)
        };
        stream.set_on_writable(Some(handler), null_mut());
        assert!(!stream.try_end(b"abcde", 5));
        assert_eq!(stream.buffered_amount(), 0);
    });
    send(&[setting(4, 1), get(1)].concat());
    send(&[window_update(1, 1), window_update(1, 1)].concat());
    send(&setting(4, 9));
    assert_eq!(EVENTS.take(), ["request", "writable 1", "writable 3"]);
    assert_eq!(
        peer.frames(),
        [
            "4 0 1 0",
            "HEADERS 1 4 200 5",
            "DATA 1 0 1",
            "DATA 1 0 2",
            "4 0 1 0",
            "DATA 1 1 2"
        ]
    );
}

#[test]
fn the_end_waits_for_what_is_unsent() {
    let ends: [fn(&Stream); 3] = [
        |stream| stream.end(b""),
        |stream| stream.end_stream(),
        |stream| stream.end_without_body(),
    ];
    for end in ends {
        let peer = Peer::new(move |stream| {
            assert_eq!(stream.write(b"ab"), Err(1));
            assert_eq!(stream.write(b"c"), Err(0));
            end(stream);
        });
        send(&[setting(4, 1), get(1)].concat());
        send(&window_update(1, 1));
        assert!(!peer.stream(0).is_retired());
        send(&window_update(1, 1));
        assert!(peer.stream(0).is_retired());
        assert_eq!(
            peer.frames()[2..],
            ["DATA 1 0 1", "DATA 1 0 1", "DATA 1 1 1"]
        );
    }
}

#[test]
fn a_long_header_block_is_split() {
    for (len, frames) in [
        (16353, &["HEADERS 1 5"][..]),
        (16354, &["1 1 1 16384", "9 1 4 1"]),
        (32737, &["1 1 1 16384", "9 1 0 16384", "9 1 4 1"]),
    ] {
        let peer = Peer::new(move |stream| {
            stream.write_header(b"A", &vec![0xff; len]);
            stream.end_without_body();
        });
        send(&get(1));
        let sent = peer.frames();
        let sent = sent.iter().map(|frame| &frame[..frame.len().min(11)]);
        assert_eq!(sent.collect::<Vec<_>>(), frames);
    }
}

#[test]
fn receive_windows() {
    let chunk = frame(DATA, 0, 1, &[0; 16384]);
    let peer = Peer::new(|_| {});
    send(&[post(1), chunk.repeat(4)].concat());
    assert_eq!(peer.frames(), [""; 0]);

    let stream = peer.stream(0);
    stream.widen_receive_window();
    stream.widen_receive_window();
    send(&chunk.repeat(31));
    assert_eq!(peer.frames(), ["WINDOW_UPDATE 1 1048576"]);
    send(&chunk);
    assert_eq!(peer.frames(), ["WINDOW_UPDATE 1 524288"]);

    stream.pause();
    send(&chunk.repeat(64));
    stream.resume();
    stream.resume();
    send(&chunk.repeat(155));
    assert_eq!(peer.frames()[0], "WINDOW_UPDATE 1 1048576");
    send(&chunk);
    assert_eq!(peer.frames(), ["WINDOW_UPDATE 0 4194304"]);

    stream.pause();
    send(&[chunk.repeat(64 - 28), frame(DATA, 0, 1, b"x")].concat());
    assert_eq!(peer.frames(), ["RST_STREAM 1 3"]);
}

#[test]
fn what_restarts_the_idle_timeout() {
    let peer = Peer::new(|_| {});
    let restarts = |bytes: &[u8]| {
        send(bytes);
        TIMEOUTS.take().len()
    };
    let ping = frame(PING, 0, 0, &[0; 8]);
    assert_eq!(restarts(&ping), 1);
    assert_eq!(restarts(&[setting(4, 0), post(1)].concat()), 1);
    assert_eq!(restarts(&ping), 0);
    assert_eq!(restarts(&frame(DATA, 0, 1, b"")), 0);
    assert_eq!(restarts(&frame(DATA, 8, 1, b"\0")), 0);
    assert_eq!(restarts(&frame(DATA, 0, 1, b"x")), 1);
    assert_eq!(restarts(&window_update(0, 1)), 0);
    assert_eq!(restarts(&window_update(1, 65536)), 1);
    assert_eq!(restarts(&window_update(1, 1)), 0);

    assert_eq!(peer.stream(0).write(&[0; 65536]), Ok(65536));
    assert!(!peer.server.drain());
    assert_eq!(TIMEOUTS.take().len(), 1);
    assert_eq!(restarts(&ping), 0);
    assert_eq!(restarts(&window_update(0, 1)), 1);
    assert_eq!(restarts(&frame(DATA, END_STREAM, 1, b"")), 1);
}

#[test]
fn the_most_permissive_timeout_counts() {
    let peer = Peer::new(|_| {});
    send(&[get(1), get(3)].concat());
    let (a, b) = (peer.stream(0), peer.stream(1));
    TIMEOUTS.take();
    a.set_timeout(5);
    b.set_timeout(6);
    a.set_timeout(255);
    a.set_timeout(0);
    a.set_timeout(4);
    b.pause();
    b.pause();
    b.set_timeout(7);
    b.resume();
    b.end(b"");
    b.set_timeout(9);
    b.reset_timeout();
    a.reset_timeout();
    a.end(b"");
    assert_eq!(TIMEOUTS.take(), [10, 6, 254, 0, 6, 0, 7, 4, 4, 10]);
}

#[test]
fn a_timeout_tells_the_streams_and_closes() {
    let peer = Peer::new(|stream| {
        log_abort(stream);
        stream.set_on_timeout(Some(|_, _| log("timeout")), null_mut());
    });
    send(&[get(1), get(3)].concat());
    EVENTS.take();
    connection().on_timeout();
    assert_eq!(
        EVENTS.take(),
        ["timeout", "timeout", "close", "aborted", "aborted"]
    );
    assert_eq!(peer.frames(), ["GOAWAY 3 0"]);
}

#[test]
fn a_stream_goes_after_the_call_that_ends_it() {
    let peer = Peer::new(|stream| {
        log_abort(stream);
        if stream.has_request_body_ended() {
            stream.end(b"");
            log("ended");
        }
    });
    send(&[get(1), post(3), post(5)].concat());
    assert_eq!(
        EVENTS.take(),
        ["request", "ended", "request", "request", "aborted"]
    );
    peer.frames();

    peer.stream(1).end(b"");
    peer.stream(2).abort();
    assert_eq!(EVENTS.take(), ["schedule"]);
    assert_eq!(peer.frames(), [""; 0]);
    assert!(!peer.server.drain());
    assert_eq!(EVENTS.take(), ["aborted", "aborted"]);
    assert_eq!(
        peer.frames(),
        ["HEADERS 3 5 200 0", "RST_STREAM 3 0", "RST_STREAM 5 2"]
    );
}

#[test]
fn a_drain_under_a_drain_leaves_the_next_one_to_be_scheduled() {
    thread_local!(static SERVER: RefCell<Option<Rc<Server<Host>>>> = const { RefCell::new(None) });
    let peer = Peer::new(|stream| {
        let on_writable = |_: &Stream, _, _| {
            log("writable");
            !SERVER.take().is_some_and(|server| server.drain())
        };
        stream.set_on_writable(Some(on_writable), null_mut());
    });
    SERVER.set(Some(Rc::clone(&peer.server)));
    send(
        &[
            setting(4, 1 << 20),
            window_update(0, 1 << 20),
            get(1),
            get(3),
        ]
        .concat(),
    );
    for index in 0..2 {
        assert!(peer.stream(index).write(&[0; 256 * 1024]).is_err());
    }
    assert!(!peer.server.drain());
    assert_eq!(
        EVENTS.take(),
        ["request", "request", "schedule", "writable", "writable"]
    );
    assert_eq!(peer.stream(0).write(b"x"), Ok(1));
    assert_eq!(EVENTS.take(), ["schedule"]);
}

#[test]
fn what_is_written_when_a_stream_goes_waits_for_the_next_event() {
    thread_local!(static OTHER: RefCell<Option<Stream>> = const { RefCell::new(None) });
    for (going_away, events) in [
        (|| {}, &["schedule", "request writable"][..]),
        (|| send(&frame(GOAWAY, 0, 0, &[0; 8])), &["schedule"]),
        (
            || _ = Connection::close_idle(std::iter::once(connection()), true),
            &["schedule"],
        ),
    ] as [(fn(), _); 3]
    {
        let peer = Peer::new(|stream| {
            let on_aborted = |_: &Stream, _| OTHER.take().iter().for_each(|other| other.end(b""));
            stream.set_on_aborted(Some(on_aborted), null_mut());
        });
        send(&[get(1), get(3)].concat());
        going_away();
        OTHER.set(Some(peer.stream(1)));
        EVENTS.take();
        peer.stream(0).end(b"");
        assert!(!peer.server.drain());
        assert_eq!(EVENTS.take(), events);
        assert_eq!(peer.frames().last().unwrap(), "HEADERS 1 5 200 0");
        make_room(100);
        assert_eq!(peer.frames(), ["HEADERS 3 5 200 0"]);
    }
}

#[test]
fn a_read_sends_what_a_close_that_waits_has_left() {
    let peer = Peer::new(|_| {});
    ROOM.set(0);
    DEFERS_CLOSE.set(true);
    Connection::close_idle(std::iter::once(connection()), false);
    ROOM.set(100);
    send(&window_update(0, 1));
    assert_eq!(peer.frames(), ["GOAWAY 0 0"]);
    assert_eq!(EVENTS.take(), ["close", "close"]);
}

#[test]
fn nothing_is_sent_under_cork() {
    let peer = Peer::new(log_abort);
    send(&get(1));
    let stream = peer.stream(0);
    stream.cork(|| {
        stream.cork(|| stream.end(b"x"));
        assert!(!peer.server.drain());
        assert_eq!(EVENTS.take(), ["request"]);
    });
    stream.cork(|| assert!(!peer.server.drain()));
    assert_eq!(peer.frames(), [""; 0]);
    assert!(!peer.server.drain());
    assert_eq!(EVENTS.take(), ["schedule", "schedule", "aborted"]);
    assert_eq!(peer.frames(), ["HEADERS 1 4 200 1", "DATA 1 1 1"]);
}

#[test]
fn a_handler_may_close_the_connection() {
    let peer = Peer::new(|stream| {
        log_abort(stream);
        log_body(stream);
        connection().on_end();
        assert!(stream.is_retired() && stream.socket().is_none());
        assert_eq!(stream.write(b"x"), Err(0));
        assert!(!stream.try_end(b"x", 1));
        stream.pause();
        stream.resume();
        stream.end(b"x");
    });
    send(&[get(1), get(3)].concat());
    assert_eq!(EVENTS.take(), ["request", "close", "aborted"]);
    assert_eq!(peer.frames(), [""; 0]);
}

#[test]
fn a_stream_outlasts_the_call_that_closes_its_connection() {
    let peer = Peer::new(|_| {});
    send(&get(1));
    let stream = peer.streams.take().remove(0);
    stream.cork(|| {
        connection().on_end();
        assert_eq!(Rc::strong_count(&stream), 2);
    });
    assert_eq!(Rc::strong_count(&stream), 1);
}

#[test]
fn the_end_of_a_body_is_delivered_once() {
    let _peer = Peer::new(|stream| {
        log_body(stream);
        send(&frame(DATA, END_STREAM, 1, b"x"));
        log_body(stream);
    });
    send(&post(1));
    assert_eq!(EVENTS.take(), ["request", "body x true"]);
}

#[test]
fn closing_idle_connections() {
    let peer = Peer::new(|_| {});
    let close_idle = |close_when_idle| {
        let connections = std::iter::once(connection());
        Connection::close_idle(connections, close_when_idle)
    };
    send(&get(1));
    assert_eq!(close_idle(false), 0);
    assert_eq!(peer.frames(), [""; 0]);
    assert_eq!(close_idle(true), 0);
    send(&[post(3), frame(DATA, 0, 3, b"x")].concat());
    assert_eq!(peer.frames(), ["GOAWAY 1 0"]);

    ROOM.set(0);
    peer.stream(0).end(b"");
    assert!(!peer.server.drain());
    assert_eq!(EVENTS.take(), ["request", "schedule"]);
    make_room(100);
    assert_eq!(EVENTS.take(), ["close"]);

    drop(peer);
    let peer = Peer::new(|_| {});
    assert_eq!(close_idle(false), 1);
    assert_eq!(peer.frames(), ["GOAWAY 0 0"]);
}

#[test]
fn resets_are_rationed() {
    let peer = Peer::new(|_| {});
    let mut ids = (1..).step_by(2);
    let mut reset = |count| {
        for id in ids.by_ref().take(count) {
            send(&[get(id), frame(RST_STREAM, 0, id, &[0, 0, 0, 8])].concat());
        }
        peer.frames().len()
    };
    NOW.set(NOW.get() + Duration::from_secs(5));
    assert_eq!(reset(1000), 0);
    NOW.set(NOW.get() + Duration::from_secs(2));
    assert_eq!(reset(66), 0);
    assert_eq!(reset(1), 1);
}

#[test]
fn answers_that_nobody_reads_are_limited() {
    let pings = |count| frame(PING, 0, 0, &[0; 8]).repeat(count);
    let (limit, _peer) = ((1 << 20) / 17, Peer::new(|_| {}));
    ROOM.set(0);
    send(&pings(limit));
    make_room(limit * 17);
    send(&pings(limit));
    make_room(limit * 17 - 1);
    send(&pings(1));
    assert_eq!(EVENTS.take(), [""; 0]);
    send(&pings(1));
    assert_eq!(EVENTS.take(), ["shutdown", "close"]);
}

#[test]
fn only_the_last_resets_are_remembered() {
    for (resets, last_frame) in [(256, "RST_STREAM 511 0"), (257, "GOAWAY 1 5")] {
        let peer = Peer::new(|stream| stream.end(b""));
        for id in (1..).step_by(2).take(resets) {
            send(&post(id));
        }
        send(&frame(DATA, 0, 1, b"x"));
        assert_eq!(peer.frames().last().unwrap(), last_frame);
    }
}

#[test]
fn limits_of_a_header_block() {
    let fields = |count: usize| [GET, &b"\0\x01a\0".repeat(count - 4)].concat();
    let sized = |size: usize| {
        let len = size - 59 - 127;
        let len_bytes = [
            127,
            len as u8 | 128,
            (len >> 7) as u8 | 128,
            (len >> 14) as u8,
        ];
        [GET, b"\0\x01a", &len_bytes, &vec![b'v'; len + 127]].concat()
    };
    for (block, fragment_len, answer) in [
        (fields(200), 16384, "HEADERS 1 5 200 0"),
        (fields(201), 16384, "HEADERS 1 5 431 0"),
        (fields(400), 16384, "HEADERS 1 5 431 0"),
        (fields(401), 16384, "GOAWAY 0 11"),
        (sized(16384), 16384, "HEADERS 1 5 200 0"),
        (sized(16385), 16384, "HEADERS 1 5 431 0"),
        (sized(32768), 16384, "HEADERS 1 5 431 0"),
        (sized(32769), 16384, "GOAWAY 0 11"),
        ([GET, &b"\x90".repeat(27)].concat(), 1, "HEADERS 1 5 200 0"),
        ([GET, &b"\x90".repeat(28)].concat(), 1, "GOAWAY 0 11"),
    ] {
        let peer = Peer::new(|stream| stream.end(b""));
        let mut fragments = block.chunks(fragment_len).enumerate().peekable();
        let mut frames = Vec::new();
        while let Some((index, fragment)) = fragments.next() {
            let (kind, flags) = match index {
                0 => (HEADERS, END_STREAM),
                _ => (CONTINUATION, 0),
            };
            let is_last = fragments.peek().is_none();
            let flags = flags | if is_last { END_HEADERS } else { 0 };
            frames.extend(frame(kind, flags, 1, fragment));
        }
        send(&frames);
        assert_eq!(peer.frames(), [answer]);
    }
}
