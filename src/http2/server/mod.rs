//! The server of `Bun.serve()`.

mod connection;
mod output;
mod request;
mod stream;

use core::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

use bun_http_types::Method::Method;
use bun_http1::queue::Queue;

pub use connection::Connection;
pub use stream::{OnData, OnEvent, OnWritable, State, Stream};

use connection::Pin;
use output::Fields;
use request::DecodeBuffer;

const MAX_FRAME_SIZE: u32 = 16384;
/// Until the handler asks for the body, so that a peer cannot park a whole one on each stream.
const INITIAL_STREAM_WINDOW: u32 = 64 * 1024;
const WIDE_STREAM_WINDOW: u32 = 1 << 20;
const CONNECTION_WINDOW: u32 = 1 << 24;
const MAX_CONCURRENT_STREAMS: usize = 256;
/// With this much queued for the socket, the rest of a body waits.
const HIGH_WATER_MARK: usize = 256 * 1024;

pub trait Socket: Copy {
    /// Returns how much it took. Nothing runs under it.
    fn write(self, bytes: &[u8]) -> usize;
    /// [`Connection::on_writable`] follows, as after a short write.
    fn request_writable(self);
    fn shutdown(self);
    /// [`Connection::on_close`] runs under it, or later.
    fn close(self);
    fn set_timeout(self, seconds: u32);
}

pub struct Request<'a, F> {
    pub method: Method,
    pub path: &'a [u8],
    /// Or `host`, if there is none.
    pub authority: &'a [u8],
    /// With the pseudo-headers.
    pub fields: &'a [F],
}

pub trait Host: Sized {
    type Socket: Socket;
    /// It may point to what it was made of until `route` returns.
    type Field;

    fn field(name: &[u8], value: &[u8]) -> Self::Field;
    /// False if no handler took it.
    fn route(&self, stream: &Rc<Stream<Self>>, request: Request<'_, Self::Field>) -> bool;
    fn date(&self) -> [u8; 29];
    fn max_header_size(&self) -> usize;
    /// [`Server::drain`] has to run soon, but not under this call.
    fn schedule_drain(&self);
    fn now(&self) -> Instant;
}

pub struct Server<H: Host> {
    pub host: H,
    /// In seconds. 0 is none.
    idle_timeout: u32,
    /// A connection swaps its empty one for it during an event.
    shared_queue: RefCell<Queue>,
    is_shared_queue_lent: Cell<bool>,
    decode_buffer: RefCell<DecodeBuffer<H::Field>>,
    /// An allocation for the next response.
    spare_fields: Cell<Fields>,
    to_drain: RefCell<Vec<Pin<H>>>,
    is_drain_scheduled: Cell<bool>,
}

impl<H: Host> Server<H> {
    pub fn new(host: H, idle_timeout: u32) -> Rc<Self> {
        Rc::new(Self {
            host,
            idle_timeout,
            shared_queue: RefCell::default(),
            is_shared_queue_lent: Cell::new(false),
            decode_buffer: RefCell::default(),
            spare_fields: Cell::default(),
            to_drain: RefCell::default(),
            is_drain_scheduled: Cell::new(false),
        })
    }

    fn max_header_list_size(&self) -> usize {
        match self.host.max_header_size() {
            0 => 64 * 1024,
            size => size.min(0xff_ffff),
        }
    }

    /// Of a header block and of what it decodes to. Above it the connection fails, instead of the request.
    fn max_header_block_size(&self) -> usize {
        (self.max_header_list_size() * 2).max(MAX_FRAME_SIZE as usize)
    }

    fn take_fields(&self) -> Fields {
        self.spare_fields.take().with_room()
    }

    fn return_fields(&self, fields: Fields) {
        if let Some(fields) = fields.recycled() {
            self.spare_fields.set(fields);
        }
    }

    fn drain_later(&self, connection: Pin<H>) {
        self.to_drain.borrow_mut().push(connection);
        if !self.is_drain_scheduled.replace(true) {
            self.host.schedule_drain();
        }
    }

    /// Sends what calls from outside of a socket event have queued. True if it has to run again.
    pub fn drain(&self) -> bool {
        for connection in self.to_drain.take() {
            connection.drain();
        }
        let has_more = !self.to_drain.borrow().is_empty();
        self.is_drain_scheduled.set(has_more);
        has_more
    }

    /// For when `drain` will not run again.
    pub fn cancel_drain(&self) {
        self.to_drain.take();
    }
}
