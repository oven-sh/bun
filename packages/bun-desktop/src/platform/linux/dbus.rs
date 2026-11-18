//! https://dbus.freedesktop.org/doc/dbus-specification.html

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::os::fd::{AsRawFd as _, OwnedFd, RawFd};
use std::os::unix::net::UnixStream;
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::socket::{self, Bytes as _};
use crate::error::{Context as _, Result, bail, failure};

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Byte(u8),
    Bool(bool),
    I16(i16),
    I32(i32),
    U32(u32),
    I64(i64),
    U64(u64),
    F64(f64),
    Str(String),
    Path(String),
    Signature(String),
    /// An index into `Message::descriptors`.
    Fd(u32),
    Bytes(Vec<u8>),
    /// With the signature of an element.
    Array(String, Vec<Value>),
    Struct(Vec<Value>),
    Entry(Box<(Value, Value)>),
    Variant(Box<Value>),
}

static NOTHING: Value = Value::Struct(Vec::new());

impl From<&str> for Value {
    fn from(text: &str) -> Value {
        Value::Str(text.replace('\0', ""))
    }
}

impl Value {
    pub fn variant(self) -> Value {
        Value::Variant(Box::new(self))
    }

    pub fn path(path: &str) -> Value {
        Value::Path(path.into())
    }

    pub fn strings<'a>(strings: impl IntoIterator<Item = &'a str>) -> Value {
        Value::Array("s".into(), strings.into_iter().map(Value::from).collect())
    }

    /// `a{sv}`
    pub fn options<'a>(entries: impl IntoIterator<Item = (&'a str, Value)>) -> Value {
        let entry =
            |(key, value): (&str, Value)| Value::Entry(Box::new((key.into(), value.variant())));
        Value::Array("{sv}".into(), entries.into_iter().map(entry).collect())
    }

    /// `a{ss}`
    pub fn attributes(entries: &[(&str, &str)]) -> Value {
        let entry =
            |(key, value): &(&str, &str)| Value::Entry(Box::new(((*key).into(), (*value).into())));
        Value::Array("{ss}".into(), entries.iter().map(entry).collect())
    }

    fn inner(&self) -> &Value {
        match self {
            Value::Variant(value) => value.inner(),
            _ => self,
        }
    }

    pub fn str(&self) -> &str {
        match self.inner() {
            Value::Str(text) | Value::Path(text) | Value::Signature(text) => text,
            _ => "",
        }
    }

    pub fn number(&self) -> Option<i64> {
        Some(match *self.inner() {
            Value::Byte(it) => it.into(),
            Value::Bool(it) => it.into(),
            Value::I32(it) => it.into(),
            Value::U32(it) | Value::Fd(it) => it.into(),
            Value::I64(it) => it,
            Value::U64(it) => it as i64,
            _ => return None,
        })
    }

    pub fn is_true(&self) -> bool {
        *self.inner() == Value::Bool(true)
    }

    pub fn items(&self) -> &[Value] {
        match self.inner() {
            Value::Array(_, items) | Value::Struct(items) => items,
            _ => &[],
        }
    }

    pub fn at(&self, index: usize) -> &Value {
        self.items().get(index).unwrap_or(&NOTHING)
    }

    pub fn get(&self, key: &str) -> &Value {
        let found = self.items().iter().find_map(|item| match item {
            Value::Entry(entry) if entry.0.str() == key => Some(&entry.1),
            _ => None,
        });
        found.unwrap_or(&NOTHING)
    }

    fn write_signature(&self, out: &mut String) {
        let last = match self {
            Value::Byte(_) => 'y',
            Value::Bool(_) => 'b',
            Value::I16(_) => 'n',
            Value::I32(_) => 'i',
            Value::U32(_) => 'u',
            Value::I64(_) => 'x',
            Value::U64(_) => 't',
            Value::F64(_) => 'd',
            Value::Str(_) => 's',
            Value::Path(_) => 'o',
            Value::Signature(_) => 'g',
            Value::Fd(_) => 'h',
            Value::Variant(_) => 'v',
            Value::Bytes(_) => return out.push_str("ay"),
            Value::Array(element, _) => return out.extend(["a", element]),
            Value::Struct(fields) => {
                out.push('(');
                fields.iter().for_each(|field| field.write_signature(out));
                ')'
            }
            Value::Entry(entry) => {
                out.push('{');
                entry.0.write_signature(out);
                entry.1.write_signature(out);
                '}'
            }
        };
        out.push(last);
    }

    fn write(&self, out: &mut Vec<u8>) {
        fn number(out: &mut Vec<u8>, bytes: &[u8]) {
            out.resize(out.len().next_multiple_of(bytes.len()), 0);
            out.extend(bytes);
        }
        match self {
            Value::Byte(it) => out.push(*it),
            Value::Bool(it) => number(out, &u32::from(*it).to_le_bytes()),
            Value::I16(it) => number(out, &it.to_le_bytes()),
            Value::I32(it) => number(out, &it.to_le_bytes()),
            Value::U32(it) | Value::Fd(it) => number(out, &it.to_le_bytes()),
            Value::I64(it) => number(out, &it.to_le_bytes()),
            Value::U64(it) => number(out, &it.to_le_bytes()),
            Value::F64(it) => number(out, &it.to_le_bytes()),
            Value::Str(text) | Value::Path(text) => {
                number(out, &(text.len() as u32).to_le_bytes());
                out.extend(text.bytes().chain([0]));
            }
            Value::Signature(text) => out.extend(
                [text.len() as u8]
                    .into_iter()
                    .chain(text.bytes())
                    .chain([0]),
            ),
            Value::Bytes(bytes) => {
                number(out, &(bytes.len() as u32).to_le_bytes());
                out.extend(bytes);
            }
            Value::Array(element, items) => {
                number(out, &[0; 4]);
                let length_at = out.len() - 4;
                out.resize(
                    out.len().next_multiple_of(alignment(element.as_bytes()[0])),
                    0,
                );
                let start = out.len();
                items.iter().for_each(|item| item.write(out));
                let length = (out.len() - start) as u32;
                out[length_at..length_at + 4].copy_from_slice(&length.to_le_bytes());
            }
            Value::Struct(fields) => {
                out.resize(out.len().next_multiple_of(8), 0);
                fields.iter().for_each(|field| field.write(out));
            }
            Value::Entry(entry) => {
                out.resize(out.len().next_multiple_of(8), 0);
                entry.0.write(out);
                entry.1.write(out);
            }
            Value::Variant(value) => {
                let mut signature = String::new();
                value.write_signature(&mut signature);
                Value::Signature(signature).write(out);
                value.write(out);
            }
        }
    }
}

fn alignment(code: u8) -> usize {
    match code {
        b'y' | b'g' | b'v' => 1,
        b'n' | b'q' => 2,
        b'x' | b't' | b'd' | b'(' | b'{' => 8,
        _ => 4,
    }
}

/// Splits off the first complete type.
fn first_type(signature: &[u8]) -> Option<(&[u8], &[u8])> {
    let mut depth = 0;
    let end = signature.iter().position(|code| {
        depth += i32::from(matches!(code, b'(' | b'{')) - i32::from(matches!(code, b')' | b'}'));
        depth == 0 && *code != b'a'
    });
    Some(signature.split_at(end? + 1))
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    is_big_endian: bool,
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let taken = self.bytes.get(self.at..self.at.checked_add(length)?)?;
        self.at += length;
        Some(taken)
    }

    fn number(&mut self, size: usize) -> Option<u64> {
        let (bytes, append) = (self.take(size)?.iter(), |all, byte: &u8| {
            all << 8 | u64::from(*byte)
        });
        Some(if self.is_big_endian {
            bytes.fold(0, append)
        } else {
            bytes.rfold(0, append)
        })
    }

    fn text(&mut self, size_of_length: usize) -> Option<String> {
        let length = self.number(size_of_length)? as usize;
        Some(String::from_utf8_lossy(&self.take(length + 1)?[..length]).into_owned())
    }

    fn all(&mut self, mut signature: &[u8], depth: u32) -> Option<Vec<Value>> {
        let mut values = Vec::new();
        while let Some((first, rest)) = first_type(signature) {
            values.push(self.value(first, depth)?);
            signature = rest;
        }
        Some(values)
    }

    fn value(&mut self, signature: &[u8], depth: u32) -> Option<Value> {
        let (code, rest) = signature.split_first().filter(|_| depth < 64)?;
        self.at = self.at.next_multiple_of(alignment(*code));
        Some(match code {
            b'y' => Value::Byte(self.number(1)? as u8),
            b'b' => Value::Bool(self.number(4)? != 0),
            b'n' => Value::I32((self.number(2)? as i16).into()),
            b'q' => Value::U32(self.number(2)? as u32),
            b'i' => Value::I32(self.number(4)? as i32),
            b'u' => Value::U32(self.number(4)? as u32),
            b'h' => Value::Fd(self.number(4)? as u32),
            b'x' => Value::I64(self.number(8)? as i64),
            b't' => Value::U64(self.number(8)?),
            b'd' => Value::F64(f64::from_bits(self.number(8)?)),
            b's' => Value::Str(self.text(4)?),
            b'o' => Value::Path(self.text(4)?),
            b'g' => Value::Signature(self.text(1)?),
            b'v' => {
                let signature = self.text(1)?;
                self.value(signature.as_bytes(), depth + 1)?.variant()
            }
            b'a' => {
                let length = self.number(4)? as usize;
                if rest == b"y" {
                    return Some(Value::Bytes(self.take(length)?.to_vec()));
                }
                self.at = self.at.next_multiple_of(alignment(*rest.first()?));
                let (end, mut items) = (self.at + length, Vec::new());
                while self.at < end {
                    let before = self.at;
                    items.push(self.value(rest, depth + 1)?);
                    (self.at > before).then_some(())?;
                }
                Value::Array(String::from_utf8_lossy(rest).into_owned(), items)
            }
            b'(' => Value::Struct(self.all(rest.split_last()?.1, depth + 1)?),
            b'{' => {
                let [key, value] = self.all(rest.split_last()?.1, depth + 1)?.try_into().ok()?;
                Value::Entry(Box::new((key, value)))
            }
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Call = 1,
    Return,
    Error,
    Signal,
}

pub struct Message {
    pub kind: Kind,
    pub path: String,
    pub interface: String,
    /// Or the name of the error.
    pub member: String,
    /// The destination or the sender.
    pub peer: String,
    serial: u32,
    replies_to: u32,
    wants_reply: bool,
    /// A `Struct`.
    pub body: Value,
    pub descriptors: Vec<OwnedFd>,
}

impl Message {
    fn new(kind: Kind, [peer, path, interface, member]: [&str; 4], body: Vec<Value>) -> Message {
        Message {
            kind,
            path: path.into(),
            interface: interface.into(),
            member: member.into(),
            peer: peer.into(),
            serial: 0,
            replies_to: 0,
            wants_reply: kind == Kind::Call,
            body: Value::Struct(body),
            descriptors: Vec::new(),
        }
    }

    pub fn is(&self, interface: &str, member: &str) -> bool {
        self.interface == interface && self.member == member
    }

    fn write(&self, serial: u32, out: &mut Vec<u8>) {
        let (mut body, mut signature) = (Vec::new(), String::new());
        for value in self.body.items() {
            value.write(&mut body);
            value.write_signature(&mut signature);
        }
        let fields = [
            (1, Value::path(&self.path)),
            (2, self.interface.as_str().into()),
            (
                if self.kind == Kind::Error { 4 } else { 3 },
                self.member.as_str().into(),
            ),
            (5, Value::U32(self.replies_to)),
            (6, self.peer.as_str().into()),
            (8, Value::Signature(signature)),
            (9, Value::U32(self.descriptors.len() as u32)),
        ];
        let fields = fields
            .into_iter()
            .filter(|(_, it)| !it.str().is_empty() || it.number().unwrap_or(0) != 0);
        let fields =
            fields.map(|(code, value)| Value::Struct(vec![Value::Byte(code), value.variant()]));
        let mut header = vec![b'l', self.kind as u8, (!self.wants_reply).into(), 1];
        Value::U32(body.len() as u32).write(&mut header);
        Value::U32(serial).write(&mut header);
        Value::Array("(yv)".into(), fields.collect()).write(&mut header);
        header.resize(header.len().next_multiple_of(8), 0);
        out.extend(header);
        out.extend(body);
    }

    fn length(bytes: &[u8]) -> Option<usize> {
        let mut reader = Reader {
            bytes,
            at: 4,
            is_big_endian: bytes.u8(0) == b'B',
        };
        let (body, _, fields) = (reader.number(4)?, reader.number(4)?, reader.number(4)?);
        Some((16 + fields as usize).next_multiple_of(8) + body as usize)
    }

    fn read(bytes: &[u8], descriptors: &mut VecDeque<OwnedFd>) -> Option<Message> {
        let kind = *[Kind::Call, Kind::Return, Kind::Error, Kind::Signal]
            .get(usize::from(bytes[1]).checked_sub(1)?)?;
        let mut reader = Reader {
            bytes,
            at: 8,
            is_big_endian: bytes[0] == b'B',
        };
        let mut message = Message::new(kind, [""; 4], Vec::new());
        (message.serial, message.wants_reply) = (reader.number(4)? as u32, bytes[2] & 1 == 0);
        let mut signature = String::new();
        for field in reader.value(b"a(yv)", 0)?.items() {
            let (text, number) = (
                field.at(1).str().to_owned(),
                field.at(1).number().unwrap_or(0),
            );
            match field.at(0).number()? {
                1 => message.path = text,
                2 => message.interface = text,
                3 | 4 => message.member = text,
                5 => message.replies_to = number as u32,
                7 => message.peer = text,
                8 => signature = text,
                9 => message
                    .descriptors
                    .extend((0..number).map_while(|_| descriptors.pop_front())),
                _ => {}
            }
        }
        reader.at = reader.at.next_multiple_of(8);
        message.body = Value::Struct(reader.all(signature.as_bytes(), 0)?);
        Some(message)
    }

    fn into_result(self) -> Result<Message> {
        match self.kind {
            Kind::Error => Err(failure!("{}: {}", self.member, self.body.at(0).str())),
            _ => Ok(self),
        }
    }
}

type OnReply = Box<dyn FnOnce(Result<Message>)>;
type Listener = Rc<dyn Fn(&Bus, &Message)>;

pub struct Bus {
    socket: OwnedFd,
    outgoing: RefCell<Vec<u8>>,
    incoming: RefCell<Vec<u8>>,
    descriptors: RefCell<VecDeque<OwnedFd>>,
    messages: RefCell<VecDeque<Message>>,
    /// The answers to `AUTH` and `NEGOTIATE_UNIX_FD`.
    lines_to_come: Cell<u8>,
    serial: Cell<u32>,
    is_broken: Cell<bool>,
    name: RefCell<String>,
    pending: RefCell<Vec<(u32, OnReply)>>,
    listener: RefCell<Option<Listener>>,
}

pub const DAEMON: [&str; 3] = [
    "org.freedesktop.DBus",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus",
];
pub const PROPERTIES: &str = "org.freedesktop.DBus.Properties";

pub fn percent_decoded(text: &[u8]) -> Vec<u8> {
    let (mut decoded, mut at) = (Vec::with_capacity(text.len()), 0);
    while let Some(&byte) = text.get(at) {
        let digits = text.get(at + 1..at + 3).filter(|_| byte == b'%');
        let escaped =
            digits.and_then(|it| u8::from_str_radix(std::str::from_utf8(it).ok()?, 16).ok());
        decoded.push(escaped.unwrap_or(byte));
        at += if escaped.is_some() { 3 } else { 1 };
    }
    decoded
}

fn open_socket(address: &str) -> Option<UnixStream> {
    use std::os::unix::ffi::OsStrExt as _;
    address.strip_prefix("unix:")?.split(',').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        let value = percent_decoded(value.as_bytes());
        match key {
            "path" => UnixStream::connect(std::ffi::OsStr::from_bytes(&value)).ok(),
            #[cfg(target_os = "linux")]
            "abstract" => {
                use std::os::linux::net::SocketAddrExt as _;
                UnixStream::connect_addr(
                    &std::os::unix::net::SocketAddr::from_abstract_name(value).ok()?,
                )
                .ok()
            }
            _ => None,
        }
    })
}

impl Bus {
    pub fn session() -> Result<Bus> {
        let address = std::env::var("DBUS_SESSION_BUS_ADDRESS")
            .or_else(|_| std::env::var("XDG_RUNTIME_DIR").map(|it| format!("unix:path={it}/bus")));
        Bus::open(&address.context("there is no session bus")?)
    }

    pub fn system() -> Result<Bus> {
        let address = std::env::var("DBUS_SYSTEM_BUS_ADDRESS");
        Bus::open(
            address
                .as_deref()
                .unwrap_or("unix:path=/var/run/dbus/system_bus_socket"),
        )
    }

    /// Does not wait for the other side.
    pub fn open(addresses: &str) -> Result<Bus> {
        let socket = addresses
            .split(';')
            .find_map(open_socket)
            .context("could not connect to the bus")?;
        // SAFETY: it has no preconditions.
        let user = unsafe { libc::geteuid() }.to_string();
        let user: String = user.bytes().map(|digit| format!("{digit:x}")).collect();
        let bus = Bus {
            socket: socket.into(),
            outgoing: b"NEGOTIATE_UNIX_FD\r\nBEGIN\r\n".to_vec().into(),
            incoming: RefCell::default(),
            descriptors: RefCell::default(),
            messages: RefCell::default(),
            lines_to_come: Cell::new(2),
            serial: Cell::new(0),
            is_broken: Cell::new(false),
            name: RefCell::default(),
            pending: RefCell::default(),
            listener: RefCell::default(),
        };
        socket::send(
            bus.socket.as_raw_fd(),
            format!("\0AUTH EXTERNAL {user}\r\n").as_bytes(),
            &[],
        )?;
        bus.send(&Message::new(
            Kind::Call,
            [DAEMON[0], DAEMON[1], DAEMON[2], "Hello"],
            Vec::new(),
        ));
        Ok(bus)
    }

    pub fn fd(&self) -> Option<RawFd> {
        (!self.is_broken.get()).then(|| self.socket.as_raw_fd())
    }

    fn send(&self, message: &Message) -> u32 {
        self.serial.set(self.serial.get() + 1);
        message.write(self.serial.get(), &mut self.outgoing.borrow_mut());
        self.serial.get()
    }

    pub fn flush(&self) {
        // GLib's server loses what comes before its first answer.
        if self.lines_to_come.get() == 2 {
            return;
        }
        let outgoing = self.outgoing.take();
        let mut rest = &outgoing[..];
        while !rest.is_empty() && !self.is_broken.get() {
            match socket::send(self.socket.as_raw_fd(), rest, &[]) {
                Ok(sent) => rest = &rest[sent..],
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    self.is_broken
                        .set(!socket::wait(self.socket.as_raw_fd(), libc::POLLOUT, 2000));
                }
                Err(error) => self
                    .is_broken
                    .set(error.kind() != std::io::ErrorKind::Interrupted),
            }
        }
    }

    fn receive(&self, into: &mut Vec<u8>) -> bool {
        into.reserve(4096);
        let count = socket::receive(
            self.socket.as_raw_fd(),
            into,
            &mut self.descriptors.borrow_mut(),
        );
        if count <= 0 {
            let kind = std::io::Error::last_os_error().kind();
            let is_fine = matches!(
                kind,
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
            );
            self.is_broken.set(count == 0 || !is_fine);
        }
        count > 0
    }

    fn read(&self) {
        let incoming = &mut *self.incoming.borrow_mut();
        while !self.is_broken.get() && self.receive(incoming) {}
        while self.lines_to_come.get() > 0 {
            let Some(end) = incoming.iter().position(|byte| *byte == b'\n') else {
                return;
            };
            if incoming.starts_with(b"REJECTED") {
                return self.is_broken.set(true);
            }
            incoming.drain(..=end);
            self.lines_to_come.set(self.lines_to_come.get() - 1);
        }
        let mut at = 0;
        while let Some(bytes) =
            Message::length(&incoming[at..]).and_then(|length| incoming.get(at..at + length))
        {
            at += bytes.len();
            match Message::read(bytes, &mut self.descriptors.borrow_mut()) {
                Some(hello) if hello.replies_to == 1 => {
                    drop(self.name.replace(hello.body.at(0).str().into()))
                }
                message => self.messages.borrow_mut().extend(message),
            }
        }
        incoming.drain(..at);
    }

    /// `None` waits for as long as it takes.
    fn wait_for(
        &self,
        timeout: Option<Duration>,
        is_wanted: impl Fn(&Message) -> bool,
    ) -> Result<Message> {
        let deadline = timeout.map(|it| Instant::now() + it);
        loop {
            self.flush();
            let at = self.messages.borrow().iter().position(&is_wanted);
            if let Some(message) = at.and_then(|at| self.messages.borrow_mut().remove(at)) {
                return Ok(message);
            }
            let left = deadline.map(|it| it.saturating_duration_since(Instant::now()));
            if self.is_broken.get() || left.is_some_and(|it| it.is_zero()) {
                bail!("the bus did not answer");
            }
            socket::wait(
                self.socket.as_raw_fd(),
                libc::POLLIN,
                left.map_or(-1, |it| it.as_millis() as i32 + 1),
            );
            self.read();
        }
    }

    pub fn call(&self, object: [&str; 3], member: &str, body: Vec<Value>) -> Result<Message> {
        self.call_within(Duration::from_secs(10), object, member, body)
    }

    pub fn call_within(
        &self,
        patience: Duration,
        [peer, path, interface]: [&str; 3],
        member: &str,
        body: Vec<Value>,
    ) -> Result<Message> {
        let serial = self.send(&Message::new(
            Kind::Call,
            [peer, path, interface, member],
            body,
        ));
        self.wait_for(Some(patience), |it| it.replies_to == serial)?
            .into_result()
    }

    /// `Value::Fd(0)` stands for the file.
    pub fn call_with_file(
        &self,
        [peer, path, interface]: [&str; 3],
        member: &str,
        body: Vec<Value>,
        file: OwnedFd,
    ) -> Result<Message> {
        self.unique_name()?;
        let mut message = Message::new(Kind::Call, [peer, path, interface, member], body);
        message.descriptors.push(file);
        let serial = self.send(&message);
        let sent = socket::send(
            self.socket.as_raw_fd(),
            &self.outgoing.borrow(),
            &message.descriptors,
        )?;
        self.outgoing.borrow_mut().drain(..sent);
        self.wait_for(Some(Duration::from_secs(10)), |it| it.replies_to == serial)?
            .into_result()
    }

    /// Answers the calls that come while it waits.
    pub fn call_serving(
        &self,
        patience: Duration,
        [peer, path, interface]: [&str; 3],
        member: &str,
        body: Vec<Value>,
    ) -> Result<Message> {
        let (serial, deadline) = (
            self.send(&Message::new(
                Kind::Call,
                [peer, path, interface, member],
                body,
            )),
            Instant::now() + patience,
        );
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let message = self.wait_for(Some(left), |it| {
                it.replies_to == serial || it.kind == Kind::Call
            })?;
            match self
                .listener
                .borrow()
                .clone()
                .filter(|_| message.kind == Kind::Call)
            {
                Some(listener) => listener(self, &message),
                None => return message.into_result(),
            }
        }
    }

    pub fn call_then(
        &self,
        [peer, path, interface]: [&str; 3],
        member: &str,
        body: Vec<Value>,
        then: impl FnOnce(Result<Message>) + 'static,
    ) {
        let serial = self.send(&Message::new(
            Kind::Call,
            [peer, path, interface, member],
            body,
        ));
        self.pending.borrow_mut().push((serial, Box::new(then)));
    }

    /// A call whose result does not matter.
    pub fn tell(&self, [peer, path, interface]: [&str; 3], member: &str, body: Vec<Value>) {
        let mut message = Message::new(Kind::Call, [peer, path, interface, member], body);
        message.wants_reply = false;
        self.send(&message);
    }

    pub fn emit(&self, path: &str, interface: &str, member: &str, body: Vec<Value>) {
        self.send(&Message::new(
            Kind::Signal,
            ["", path, interface, member],
            body,
        ));
    }

    /// With the result, or the name of an error.
    pub fn answer(&self, call: &Message, result: Result<Vec<Value>, &str>) {
        if call.wants_reply {
            let mut message = match result {
                Ok(body) => Message::new(Kind::Return, [&call.peer, "", "", ""], body),
                Err(name) => Message::new(
                    Kind::Error,
                    [&call.peer, "", "", name],
                    vec![call.member.as_str().into()],
                ),
            };
            message.replies_to = call.serial;
            self.send(&message);
        }
    }

    pub fn subscribe(&self, rule: &str) {
        self.tell(
            DAEMON,
            "AddMatch",
            vec![format!("type='signal',{rule}").as_str().into()],
        );
    }

    pub fn wait_for_signal(&self, path: &str, member: &str) -> Result<Message> {
        self.wait_for(None, |it| {
            it.kind == Kind::Signal && it.path == path && it.member == member
        })
    }

    /// For signals and calls.
    pub fn listen(&self, listener: impl Fn(&Bus, &Message) + 'static) {
        self.listener.replace(Some(Rc::new(listener)));
    }

    pub fn unique_name(&self) -> Result<String> {
        if self.name.borrow().is_empty() {
            self.call(DAEMON, "GetId", Vec::new())?;
        }
        Ok(self.name.borrow().clone())
    }

    pub fn has_messages(&self) -> bool {
        !self.messages.borrow().is_empty()
            || self.is_broken.get() && !self.pending.borrow().is_empty()
    }

    pub fn dispatch(&self) {
        self.read();
        loop {
            let Some(message) = self.messages.borrow_mut().pop_front() else {
                break;
            };
            if matches!(message.kind, Kind::Return | Kind::Error) {
                let then = self
                    .pending
                    .borrow_mut()
                    .extract_if(.., |it| it.0 == message.replies_to)
                    .next();
                if let Some((_, then)) = then {
                    then(message.into_result());
                }
            } else if let Some(listener) = self.listener.borrow().clone() {
                listener(self, &message);
            }
        }
        if self.is_broken.get() {
            self.pending
                .take()
                .into_iter()
                .for_each(|(_, then)| then(Err(failure!("the bus is gone"))));
        }
    }
}
