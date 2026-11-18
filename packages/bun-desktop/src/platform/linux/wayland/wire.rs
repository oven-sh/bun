//! https://wayland.freedesktop.org/docs/html/ch04.html#sect-Protocol-Wire-Format

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::os::fd::{AsRawFd as _, OwnedFd, RawFd};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::super::socket::{self, Bytes as _, MAX_DESCRIPTORS, padded};
use crate::error::{Context as _, Result};
use crate::hash::FastMap;
use crate::small_vec::SmallVec;

pub const DISPLAY: u32 = 1;
const FIRST_OF_SERVER: u32 = 0xff00_0000;
const MAX_TEXT: usize = 4000;

/// What an object is, as far as its events matter.
#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Silent,
    Display,
    Registry,
    Sync,
    Shell,
    Presentation,
    Output,
    LogicalOutput,
    Seat,
    Keyboard,
    Pointer,
    Pinch,
    Hold,
    Touch,
    TextInput,
    Idle,
    Surface,
    Scale,
    Role,
    Toplevel,
    Popup,
    Decoration,
    Frame,
    Feedback,
    Buffer,
    Token,
    Exported,
    DataDevice,
    DataSource,
    DataOffer,
    PrimaryDevice,
    PrimarySource,
    PrimaryOffer,
}

pub struct Event {
    pub object: u32,
    pub kind: Kind,
    /// What `object` was created for.
    pub owner: u32,
    pub opcode: u16,
    pub body: SmallVec<u8, 32>,
    pub file: Option<OwnedFd>,
}

impl Event {
    /// The arguments are counted in words.
    pub fn u32(&self, index: usize) -> u32 {
        self.body.u32(index * 4)
    }

    pub fn i32(&self, index: usize) -> i32 {
        self.body.i32(index * 4)
    }

    pub fn fixed(&self, index: usize) -> f32 {
        self.i32(index) as f32 / 256.
    }

    /// With the index of the next argument.
    pub fn array(&self, index: usize) -> (&[u8], usize) {
        let length = self.u32(index) as usize;
        (
            self.body.part(index * 4 + 4, length),
            index + 1 + padded(length) / 4,
        )
    }

    pub fn text(&self, index: usize) -> (String, usize) {
        let (bytes, next) = self.array(index);
        (
            String::from_utf8_lossy(bytes.strip_suffix(&[0]).unwrap_or(bytes)).into_owned(),
            next,
        )
    }
}

pub struct Connection {
    socket: UnixStream,
    unsent: RefCell<(Vec<u8>, Vec<OwnedFd>)>,
    received: RefCell<(Vec<u8>, VecDeque<OwnedFd>)>,
    events: RefCell<VecDeque<Event>>,
    objects: RefCell<Vec<(Kind, u32)>>,
    of_server: RefCell<FastMap<u32, Kind>>,
    free: RefCell<Vec<u32>>,
    is_broken: Cell<bool>,
}

impl Connection {
    pub fn open() -> Result<Connection> {
        let name = std::env::var_os("WAYLAND_DISPLAY").context("WAYLAND_DISPLAY is not set")?;
        let path =
            PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR").unwrap_or_default()).join(name);
        Ok(Connection {
            socket: UnixStream::connect(&path)
                .with_context(|| format!("could not connect to {}", path.display()))?,
            unsent: RefCell::default(),
            received: RefCell::default(),
            events: RefCell::default(),
            objects: RefCell::new(vec![(Kind::Silent, 0), (Kind::Display, 0)]),
            of_server: RefCell::default(),
            free: RefCell::default(),
            is_broken: Cell::default(),
        })
    }

    pub fn fd(&self) -> RawFd {
        self.socket.as_raw_fd()
    }

    pub fn is_broken(&self) -> bool {
        self.is_broken.get()
    }

    pub fn give_up(&self) {
        self.is_broken.set(true);
    }

    /// It has to be in the next request.
    pub fn new_id(&self, kind: Kind, owner: u32) -> u32 {
        let objects = &mut *self.objects.borrow_mut();
        let id = self.free.borrow_mut().pop().unwrap_or_else(|| {
            objects.push((kind, owner));
            objects.len() as u32 - 1
        });
        objects[id as usize] = (kind, owner);
        id
    }

    pub fn reuse(&self, id: u32) {
        self.free.borrow_mut().push(id);
    }

    fn write(&self, object: u32, opcode: u16, before: &[u32], text: Option<&str>, after: &[u32]) {
        if object == 0 {
            return;
        }
        let bytes = &mut self.unsent.borrow_mut().0;
        let text = text
            .map(|it| it.split('\0').next().unwrap_or_default())
            .map(|it| &it[..it.floor_char_boundary(MAX_TEXT)]);
        let length =
            8 + (before.len() + after.len()) * 4 + text.map_or(0, |it| 4 + padded(it.len() + 1));
        bytes.extend(
            [object, (length as u32) << 16 | u32::from(opcode)]
                .iter()
                .chain(before)
                .flat_map(|it| it.to_le_bytes()),
        );
        if let Some(text) = text {
            bytes.extend((text.len() as u32 + 1).to_le_bytes());
            bytes.extend(text.as_bytes());
            bytes.resize(padded(bytes.len() + 1), 0);
        }
        bytes.extend(after.iter().flat_map(|it| it.to_le_bytes()));
    }

    /// Object 0 stands for what the compositor does not have, and ignores everything.
    pub fn send(&self, object: u32, opcode: u16, arguments: &[u32]) {
        self.write(object, opcode, arguments, None, &[]);
    }

    pub fn send_text(&self, object: u32, opcode: u16, before: &[u32], text: &str, after: &[u32]) {
        self.write(object, opcode, before, Some(text), after);
    }

    /// For the next request.
    pub fn attach(&self, file: OwnedFd) {
        if self.unsent.borrow().1.len() == MAX_DESCRIPTORS {
            self.flush();
        }
        self.unsent.borrow_mut().1.push(file);
    }

    /// With a request whose first argument is the new object.
    pub fn create(
        &self,
        kind: Kind,
        owner: u32,
        object: u32,
        opcode: u16,
        arguments: &[u32],
    ) -> u32 {
        if object == 0 {
            return 0;
        }
        let id = self.new_id(kind, owner);
        self.write(object, opcode, &[id], None, arguments);
        id
    }

    /// Its events are ignored from now on.
    pub fn destroy(&self, object: u32, opcode: u16) {
        self.send(object, opcode, &[]);
        self.events.borrow_mut().retain(|it| it.object != object);
        if let Some(entry) = self.objects.borrow_mut().get_mut(object as usize) {
            entry.1 = u32::MAX;
        }
    }

    pub fn flush(&self) {
        let (bytes, files) = &mut *self.unsent.borrow_mut();
        let mut sent = 0;
        while sent < bytes.len() && !self.is_broken() {
            match socket::send(self.fd(), &bytes[sent..], files) {
                Ok(count) => {
                    sent += count;
                    files.clear();
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => {
                    let has_room = || socket::wait(self.fd(), libc::POLLOUT, 5000);
                    self.is_broken
                        .set(error.kind() != std::io::ErrorKind::WouldBlock || !has_room());
                }
            }
        }
        bytes.clear();
    }

    pub fn read(&self) {
        let (bytes, files) = &mut *self.received.borrow_mut();
        loop {
            bytes.reserve(4096);
            let count = socket::receive(self.fd(), bytes, files);
            if count <= 0 {
                let error = std::io::Error::last_os_error().kind();
                let goes_on = count < 0
                    && matches!(
                        error,
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    );
                self.is_broken.set(self.is_broken() || !goes_on);
                break;
            }
            if bytes.len() < bytes.capacity() {
                break;
            }
        }
        let mut rest = &bytes[..];
        while let Some((message, after)) = rest.split_at_checked(usize::from(rest.u16(6)).max(8)) {
            rest = after;
            let (object, opcode, body) = (message.u32(0), message.u16(4), &message[8..]);
            let (kind, owner) = match object {
                FIRST_OF_SERVER.. => (
                    self.of_server
                        .borrow()
                        .get(&object)
                        .copied()
                        .unwrap_or(Kind::Silent),
                    0,
                ),
                _ => self
                    .objects
                    .borrow()
                    .get(object as usize)
                    .copied()
                    .unwrap_or((Kind::Silent, 0)),
            };
            let mut file = None;
            match (kind, opcode) {
                (Kind::Keyboard | Kind::PrimarySource, 0) | (Kind::DataSource, 1) => {
                    file = files.pop_front()
                }
                (Kind::DataDevice, 0) => drop(
                    self.of_server
                        .borrow_mut()
                        .insert(body.u32(0), Kind::DataOffer),
                ),
                (Kind::PrimaryDevice, 0) => drop(
                    self.of_server
                        .borrow_mut()
                        .insert(body.u32(0), Kind::PrimaryOffer),
                ),
                _ => {}
            }
            if kind != Kind::Silent && owner != u32::MAX {
                self.events.borrow_mut().push_back(Event {
                    object,
                    kind,
                    owner,
                    opcode,
                    body: body.iter().copied().collect(),
                    file,
                });
            }
        }
        let used = bytes.len() - rest.len();
        bytes.drain(..used);
    }

    pub fn has_events(&self) -> bool {
        !self.events.borrow().is_empty()
    }

    pub fn take_event(&self, is_wanted: impl Fn(&Event) -> bool) -> Option<Event> {
        let events = &mut *self.events.borrow_mut();
        events
            .iter()
            .position(is_wanted)
            .and_then(|index| events.remove(index))
    }

    /// Returns whether such an event has come. All of them stay in the queue.
    pub fn wait_for(&self, patience: Duration, is_wanted: impl Fn(&Event) -> bool) -> bool {
        let until = Instant::now() + patience;
        self.flush();
        while !self.events.borrow().iter().any(&is_wanted) {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() || self.is_broken() {
                return false;
            }
            if socket::wait(self.fd(), libc::POLLIN, left.as_millis() as i32 + 1) {
                self.read();
            }
        }
        true
    }

    /// Returns whether there is something to read in `file`. Until then, the events that are wanted are handled.
    pub fn wait_for_file(
        &self,
        file: RawFd,
        until: Instant,
        handle: impl Fn(Event),
        is_wanted: impl Fn(&Event) -> bool,
    ) -> bool {
        loop {
            while let Some(event) = self.take_event(&is_wanted) {
                handle(event);
            }
            self.flush();
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() || self.is_broken() {
                return false;
            }
            let mut both = [file, self.fd()].map(|fd| libc::pollfd {
                fd,
                events: libc::POLLIN,
                revents: 0,
            });
            // SAFETY: two entries.
            unsafe { libc::poll(both.as_mut_ptr(), 2, left.as_millis() as i32 + 1) };
            if both[0].revents != 0 {
                return true;
            }
            self.read();
        }
    }

    /// Until the compositor has seen all requests.
    pub fn sync(&self) {
        let done = self.create(Kind::Sync, 0, DISPLAY, 0, &[]);
        self.wait_for(Duration::from_secs(5), |it| it.object == done);
        self.take_event(|it| it.object == done);
    }
}
