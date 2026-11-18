//! The X11 protocol: https://www.x.org/releases/current/doc/xproto/x11protocol.html

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::os::fd::{AsRawFd as _, OwnedFd, RawFd};
use std::os::unix::net::UnixStream;

pub use super::super::socket::{Bytes, padded};
use super::super::socket::{send, wait};
use crate::error::{Context as _, Result, bail};

pub const GENERIC_EVENT: u8 = 35;

pub struct Request(Vec<u8>);

impl Request {
    /// For an extension, `data` is the minor opcode.
    pub fn new(opcode: u8, data: u8) -> Request {
        let mut bytes = Vec::with_capacity(48);
        bytes.extend([opcode, data, 0, 0]);
        Request(bytes)
    }
    pub fn u16(self, value: u16) -> Request {
        self.bytes(&value.to_le_bytes())
    }
    pub fn i16(self, value: i32) -> Request {
        self.u16(value.clamp(i16::MIN.into(), i16::MAX.into()) as u16)
    }
    pub fn u32(self, value: u32) -> Request {
        self.bytes(&value.to_le_bytes())
    }
    pub fn words(self, values: &[u32]) -> Request {
        values
            .iter()
            .fold(self, |request, value| request.u32(*value))
    }
    pub fn bytes(mut self, bytes: &[u8]) -> Request {
        self.0.extend_from_slice(bytes);
        self
    }
}

#[derive(Clone, Copy, Default)]
pub struct Extension {
    pub opcode: u8,
    pub first_event: u8,
}

pub struct Screen {
    pub number: u32,
    pub root: u32,
    pub size: (u16, u16),
    pub visual: u32,
    pub depth: u8,
    pub visual_with_alpha: Option<u32>,
}

#[derive(Default)]
struct Incoming {
    bytes: Vec<u8>,
    events: VecDeque<Vec<u8>>,
    /// Replies and errors, by sequence number.
    answers: VecDeque<(u64, Vec<u8>)>,
    last_sequence: u64,
}

pub struct Connection {
    socket: OwnedFd,
    outgoing: RefCell<Vec<u8>>,
    descriptors: RefCell<Vec<OwnedFd>>,
    incoming: RefCell<Incoming>,
    /// Of requests whose errors somebody waits for.
    awaited: RefCell<Vec<u64>>,
    sequence: Cell<u64>,
    last_with_reply: Cell<u64>,
    next_id: Cell<u32>,
    free_ids: RefCell<Vec<u32>>,
    ids: (u32, u32),
    is_broken: Cell<bool>,
    pub max_request_bytes: usize,
    pub host_name: Vec<u8>,
    pub screen: Screen,
}

#[must_use]
pub struct Cookie(u64);

pub struct Property {
    pub kind: u32,
    pub value: Vec<u8>,
}

fn host_name() -> Vec<u8> {
    let mut name = [0u8; 256];
    // SAFETY: the buffer and less than its length.
    unsafe { libc::gethostname(name.as_mut_ptr().cast(), name.len() - 1) };
    name.into_iter().take_while(|it| *it != 0).collect()
}

fn authority(host: &str, display: &str, this_host: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    const LOCAL: u16 = 256;
    const WILD: u16 = 65535;
    let path = std::env::var_os("XAUTHORITY").map(std::path::PathBuf::from);
    let file =
        std::fs::read(path.or_else(|| Some(std::env::home_dir()?.join(".Xauthority")))?).ok()?;
    let is_local = matches!(host, "" | "unix" | "localhost" | "127.0.0.1");
    let mut rest = &file[..];
    while let Some((family, after)) = rest.split_first_chunk() {
        rest = after;
        let mut field = || {
            let (length, after) = rest.split_first_chunk()?;
            let (value, after) = after.split_at_checked(u16::from_be_bytes(*length).into())?;
            rest = after;
            Some(value)
        };
        let (address, number, kind, data) = (field()?, field()?, field()?, field()?);
        let is_for_host = match u16::from_be_bytes(*family) {
            WILD => true,
            LOCAL => is_local && address == this_host,
            _ => !is_local,
        };
        if is_for_host
            && (number.is_empty() || number == display.as_bytes())
            && kind == b"MIT-MAGIC-COOKIE-1"
        {
            return Some((kind.to_vec(), data.to_vec()));
        }
    }
    None
}

fn open_socket(host: &str, display: &str) -> std::io::Result<OwnedFd> {
    if !matches!(host, "" | "unix") && !host.starts_with('/') {
        let port = 6000 + display.parse::<u16>().unwrap_or(0);
        let stream = TcpStream::connect((host, port))?;
        stream.set_nodelay(true)?;
        return Ok(stream.into());
    }
    let path = if host.starts_with('/') {
        format!("{host}:{display}")
    } else {
        format!("/tmp/.X11-unix/X{display}")
    };
    #[cfg(target_os = "linux")]
    {
        use std::os::linux::net::SocketAddrExt as _;
        let address = std::os::unix::net::SocketAddr::from_abstract_name(&path)?;
        if let Ok(stream) = UnixStream::connect_addr(&address) {
            return Ok(stream.into());
        }
    }
    Ok(UnixStream::connect(path)?.into())
}

impl Connection {
    pub fn open() -> Result<Connection> {
        let name = std::env::var("DISPLAY")
            .ok()
            .filter(|it| !it.is_empty())
            .context("DISPLAY is not set")?;
        let (host, rest) = name
            .rsplit_once(':')
            .context("DISPLAY has no display number")?;
        let (display, screen) = rest.split_once('.').unwrap_or((rest, "0"));
        let socket = open_socket(host, display)
            .with_context(|| format!("could not connect to the display {name}"))?;
        let mut stream = UnixStream::from(socket);
        let host_name = host_name();
        let (kind, data) = authority(host, display, &host_name).unwrap_or_default();
        let mut hello = vec![
            b'l',
            0,
            11,
            0,
            0,
            0,
            kind.len() as u8,
            0,
            data.len() as u8,
            0,
            0,
            0,
        ];
        for part in [kind, data] {
            hello.extend(part);
            hello.resize(padded(hello.len()), 0);
        }
        stream.write_all(&hello)?;
        let mut setup = vec![0; 8];
        stream.read_exact(&mut setup)?;
        setup.resize(8 + usize::from(setup.u16(6)) * 4, 0);
        stream.read_exact(&mut setup[8..])?;
        if setup[0] != 1 {
            bail!(
                "the display {name} refused: {}",
                String::from_utf8_lossy(&setup[8..]).trim_matches(['\0', '\n'])
            );
        }
        let formats = 40 + padded(setup.u16(24).into());
        let has_32_bits = |depth: u8| {
            let mut formats =
                (0..usize::from(setup[29])).map(|index| setup.part(formats + index * 8, 8));
            formats.any(|format| format.u8(0) == depth && format.u8(1) == 32)
        };
        let number = screen.parse().unwrap_or(0);
        let mut at = formats + usize::from(setup[29]) * 8;
        let mut found = None;
        for index in 0..setup[28] {
            let mut visual_with_alpha = None;
            let start = at;
            at += 40;
            for _ in 0..setup.u8(start + 39) {
                let visuals = (0..usize::from(setup.u16(at + 2)))
                    .map(|index| setup.part(at + 8 + index * 24, 24));
                let mut true_color = visuals.filter(|it| it.u8(4) == 4 && it.u32(8) == 0xff_0000);
                if setup.u8(at) == 32 && has_32_bits(32) {
                    visual_with_alpha = true_color.next().map(|it| it.u32(0));
                }
                at += 8 + usize::from(setup.u16(at + 2)) * 24;
            }
            if u32::from(index) == number {
                found = Some(Screen {
                    number,
                    root: setup.u32(start),
                    size: (setup.u16(start + 20), setup.u16(start + 22)),
                    visual: setup.u32(start + 32),
                    depth: setup.u8(start + 38),
                    visual_with_alpha,
                });
            }
        }
        let mut screen = found.context("the display has no such screen")?;
        if !has_32_bits(screen.depth) || screen.depth < 24 {
            screen.visual = screen
                .visual_with_alpha
                .context("the display does not have 32 bits per pixel")?;
            screen.depth = 32;
        }
        Ok(Connection {
            socket: stream.into(),
            outgoing: RefCell::default(),
            descriptors: RefCell::default(),
            incoming: RefCell::default(),
            awaited: RefCell::default(),
            sequence: Cell::new(0),
            last_with_reply: Cell::new(0),
            next_id: Cell::new(1),
            free_ids: RefCell::default(),
            ids: (setup.u32(12), setup.u32(16)),
            is_broken: Cell::new(false),
            max_request_bytes: usize::from(setup.u16(26)) * 4,
            host_name,
            screen,
        })
    }

    pub fn fd(&self) -> RawFd {
        self.socket.as_raw_fd()
    }

    pub fn is_broken(&self) -> bool {
        self.is_broken.get()
    }

    pub fn new_id(&self) -> u32 {
        self.free_ids.borrow_mut().pop().unwrap_or_else(|| {
            let (base, mask) = self.ids;
            base | (self.next_id.replace(self.next_id.get() + 1) << mask.trailing_zeros()) & mask
        })
    }

    /// Of something that no event refers to.
    pub fn free_id(&self, id: u32) {
        self.free_ids.borrow_mut().push(id);
    }

    fn push(&self, Request(mut bytes): Request) -> u64 {
        bytes.resize(padded(bytes.len()), 0);
        debug_assert!(bytes.len() <= self.max_request_bytes);
        let length = (bytes.len() / 4) as u16;
        bytes[2..4].copy_from_slice(&length.to_le_bytes());
        let is_full = {
            let mut outgoing = self.outgoing.borrow_mut();
            outgoing.extend(bytes);
            outgoing.len() > 1 << 16
        };
        self.sequence.set(self.sequence.get() + 1);
        if is_full {
            self.flush();
        }
        self.sequence.get()
    }

    /// For a request without a reply. An error is only logged.
    pub fn send(&self, request: Request) {
        // The server only tells 16 bits of the sequence number.
        if self.push(request) - self.last_with_reply.get() > 0x7000 {
            self.forget(self.ask(Request::new(43, 0)));
        }
    }

    pub fn send_with_descriptor(&self, request: Request, descriptor: OwnedFd) -> Result<()> {
        self.flush();
        self.descriptors.borrow_mut().push(descriptor);
        self.check(request)
    }

    /// For a request without a reply.
    pub fn check(&self, request: Request) -> Result<()> {
        let sequence = self.push(request);
        self.awaited.borrow_mut().push(sequence);
        self.sync();
        self.awaited.borrow_mut().retain(|it| *it != sequence);
        match self.take_answer(sequence) {
            Some(error) => bail!("the display answered with error {}", error[1]),
            None => Ok(()),
        }
    }

    pub fn ask(&self, request: Request) -> Cookie {
        let sequence = self.push(request);
        self.last_with_reply.set(sequence);
        self.awaited.borrow_mut().push(sequence);
        Cookie(sequence)
    }

    pub fn forget(&self, Cookie(sequence): Cookie) {
        self.awaited.borrow_mut().retain(|it| *it != sequence);
        self.take_answer(sequence);
    }

    fn take_answer(&self, sequence: u64) -> Option<Vec<u8>> {
        let answers = &mut self.incoming.borrow_mut().answers;
        let at = answers.iter().position(|it| it.0 == sequence)?;
        Some(answers.remove(at)?.1)
    }

    pub fn reply(&self, Cookie(sequence): Cookie) -> Result<Vec<u8>> {
        self.flush();
        let answer = loop {
            if let Some(answer) = self.take_answer(sequence) {
                break Some(answer);
            }
            if self.is_broken() {
                break None;
            }
            self.read(-1);
        };
        self.awaited.borrow_mut().retain(|it| *it != sequence);
        match answer {
            Some(reply) if reply[0] == 1 => Ok(reply),
            Some(error) => bail!(
                "the display answered request {}.{} with error {}",
                error[10],
                error.u16(8),
                error[1]
            ),
            None => bail!("the display is gone"),
        }
    }

    pub fn call(&self, request: Request) -> Result<Vec<u8>> {
        self.reply(self.ask(request))
    }

    /// Replied to when the server has done what was sent before.
    pub fn fence(&self) -> Cookie {
        self.ask(Request::new(43, 0))
    }

    pub fn sync(&self) {
        self.reply(self.fence()).ok();
    }

    pub fn flush(&self) {
        let mut outgoing = self.outgoing.take();
        let mut rest = &outgoing[..];
        while !rest.is_empty() && !self.is_broken() {
            let result = send(self.fd(), rest, &self.descriptors.borrow());
            match result {
                Ok(sent) => {
                    rest = &rest[sent..];
                    self.descriptors.borrow_mut().clear();
                }
                // The server may be waiting for this side to read.
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    wait(self.fd(), libc::POLLIN | libc::POLLOUT, -1);
                    self.read(0);
                }
                Err(error) => self
                    .is_broken
                    .set(error.kind() != std::io::ErrorKind::Interrupted),
            }
        }
        outgoing.clear();
        outgoing.shrink_to(1 << 12);
        self.outgoing.replace(outgoing);
    }

    /// Takes what has arrived off the socket.
    pub fn read(&self, milliseconds: i32) {
        if milliseconds != 0 && !wait(self.fd(), libc::POLLIN, milliseconds) {
            return;
        }
        let incoming = &mut *self.incoming.borrow_mut();
        loop {
            incoming.bytes.reserve(4096);
            let spare = incoming.bytes.spare_capacity_mut();
            let room = spare.len();
            // SAFETY: the buffer and its length.
            let count = unsafe {
                libc::recv(
                    self.fd(),
                    spare.as_mut_ptr().cast(),
                    room,
                    libc::MSG_DONTWAIT,
                )
            };
            if count <= 0 {
                let kind = std::io::Error::last_os_error().kind();
                let is_fine = matches!(
                    kind,
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                );
                self.is_broken.set(count == 0 || !is_fine);
                break;
            }
            // SAFETY: `recv` wrote that many.
            unsafe {
                incoming
                    .bytes
                    .set_len(incoming.bytes.len() + count as usize)
            };
            if (count as usize) < room {
                break;
            }
        }
        let mut at = 0;
        while let Some(head) = incoming.bytes.get(at..at + 32) {
            let has_more = head[0] == 1 || head[0] & 0x7f == GENERIC_EVENT;
            let length = 32
                + if has_more {
                    head.u32(4) as usize * 4
                } else {
                    0
                };
            let Some(packet) = incoming.bytes.get(at..at + length) else {
                break;
            };
            at += length;
            // KeymapNotify has no sequence number.
            if packet[0] & 0x7f != 11 {
                let ahead = packet.u16(2).wrapping_sub(incoming.last_sequence as u16);
                incoming.last_sequence += u64::from(ahead);
            }
            if packet[0] > 1 {
                incoming.events.push_back(packet.to_vec());
            } else if self.awaited.borrow().contains(&incoming.last_sequence) {
                incoming
                    .answers
                    .push_back((incoming.last_sequence, packet.to_vec()));
            } else if packet[0] == 0 {
                crate::diagnostics::log!(
                    "X11 error {} for request {}.{}",
                    packet[1],
                    packet[10],
                    packet.u16(8)
                );
            }
        }
        incoming.bytes.drain(..at);
        if incoming.bytes.is_empty() {
            incoming.bytes.shrink_to(1 << 14);
        }
    }

    pub fn has_events(&self) -> bool {
        !self.incoming.borrow().events.is_empty()
    }

    pub fn next_event(&self) -> Option<Vec<u8>> {
        self.incoming.borrow_mut().events.pop_front()
    }

    /// Ahead of the ones that arrived before it.
    pub fn take_event(&self, is_wanted: impl Fn(&[u8]) -> bool) -> Option<Vec<u8>> {
        let events = &mut self.incoming.borrow_mut().events;
        let at = events.iter().position(|event| is_wanted(event))?;
        events.remove(at)
    }

    pub fn ask_for_extension(&self, name: &str) -> Cookie {
        self.ask(
            Request::new(98, 0)
                .u16(name.len() as u16)
                .u16(0)
                .bytes(name.as_bytes()),
        )
    }

    pub fn extension(&self, cookie: Cookie) -> Option<Extension> {
        let reply = self.reply(cookie).ok().filter(|reply| reply[8] != 0)?;
        Some(Extension {
            opcode: reply[9],
            first_event: reply[10],
        })
    }

    pub fn ask_for_atom(&self, name: &str) -> Cookie {
        self.ask(
            Request::new(16, 0)
                .u16(name.len() as u16)
                .u16(0)
                .bytes(name.as_bytes()),
        )
    }

    pub fn atom(&self, cookie: Cookie) -> u32 {
        self.reply(cookie).map_or(0, |reply| reply.u32(8))
    }

    fn change_property(&self, window: u32, property: u32, kind: u32, format: u8, value: &[u8]) {
        let mut chunks = value.chunks((self.max_request_bytes - 24) & !3);
        let first = chunks.next().unwrap_or_default();
        for (index, chunk) in std::iter::once(first).chain(chunks).enumerate() {
            let request =
                Request::new(18, if index == 0 { 0 } else { 2 }).words(&[window, property, kind]);
            let count = chunk.len() as u32 / u32::from(format / 8);
            self.send(request.u32(format.into()).u32(count).bytes(chunk));
        }
    }

    pub fn set_bytes(&self, window: u32, property: u32, kind: u32, value: &[u8]) {
        self.change_property(window, property, kind, 8, value);
    }

    pub fn set_words(&self, window: u32, property: u32, kind: u32, value: &[u32]) {
        let bytes: Vec<u8> = value.iter().flat_map(|it| it.to_le_bytes()).collect();
        self.change_property(window, property, kind, 32, &bytes);
    }

    pub fn delete_property(&self, window: u32, property: u32) {
        self.send(Request::new(19, 0).words(&[window, property]));
    }

    pub fn ask_for_property(&self, window: u32, property: u32, deletes: bool) -> Cookie {
        self.ask(Request::new(20, deletes.into()).words(&[window, property, 0, 0, u32::MAX / 4]))
    }

    pub fn property(&self, cookie: Cookie) -> Option<Property> {
        let mut reply = self.reply(cookie).ok().filter(|reply| reply.u32(8) != 0)?;
        let (kind, length) = (
            reply.u32(8),
            reply.u32(16) as usize * usize::from(reply[1] / 8),
        );
        reply.drain(..32);
        reply.truncate(length);
        Some(Property { kind, value: reply })
    }

    pub fn words(&self, window: u32, property: u32) -> Vec<u32> {
        let found = self.property(self.ask_for_property(window, property, false));
        found.map(|it| it.value.words()).unwrap_or_default()
    }

    pub fn send_event(&self, destination: u32, mask: u32, event: Request) {
        let mut event = event.0;
        event.resize(32, 0);
        self.send(
            Request::new(25, 0)
                .words(&[destination, mask])
                .bytes(&event),
        );
    }

    pub fn send_message(
        &self,
        destination: u32,
        mask: u32,
        window: u32,
        kind: u32,
        data: [u32; 5],
    ) {
        self.send_event(
            destination,
            mask,
            Request::new(33, 32).words(&[window, kind]).words(&data),
        );
    }

    pub fn selection_owner(&self, selection: u32) -> u32 {
        self.call(Request::new(23, 0).u32(selection))
            .map_or(0, |reply| reply.u32(8))
    }

    pub fn select_events(&self, window: u32, mask: u32) {
        self.send(Request::new(2, 0).words(&[window, 0x800, mask]));
    }
}
