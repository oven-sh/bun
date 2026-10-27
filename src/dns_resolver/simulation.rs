//! Runs a [`Channel`] in a world made up by a script, and logs all it does there. For tests and fuzzing: nothing else reaches it.
//!
//! A script is lines of words separated by single spaces. `#` starts a comment line. A line that cannot be read is logged
//! as `? line` and passed over. A *text* word stands for bytes: `%XX` is a byte, `%` alone is no bytes, all else is itself.
//! A *hex* word is two digits a byte, `-` for none.
//!
//! The world, before anything is asked of the channel:
//! ```text
//! file PATH text [MTIME]      its contents, and when it was modified in seconds since the epoch
//! unreadable PATH             it is there and cannot be read
//! etc text                    what goes before `hosts` and the like, `/etc/` unless said; `-` for nowhere
//! env LOCALDOMAIN|RES_OPTIONS|HOSTALIASES text
//! hostname text
//! settings files|windows|mac|mac-fails|android
//! windows-server ADDRESS PORT INTERFACE_METRIC ROUTE_METRIC|- IPV6_INTERFACE
//! windows-suffix text
//! mac-resolver FOR_ONE_DOMAIN:0|1 REACH_FLAGS PORT INTERFACE OPTIONS:text|- [search=text | ADDRESS#PORT]...
//! android-property text
//! interface INDEX text        an interface and its name
//! route DESTINATION SOURCE|none|fails   the address packets to DESTINATION leave from; `none` unless said
//! loopback [ADDRESS]...       the system lists its loopback addresses, and they are these
//! seed NUMBER                 of the random bytes
//! fast-open                   TCP sockets are opened with TCP Fast Open
//! timeout MS | tries NUMBER   the options of the channel
//! ```
//! What is asked of the channel. The first of these makes it. Requests are numbered from 0.
//! ```text
//! query KIND text             KIND as `resolve()` spells it
//! lookup text PORT 0|4|6
//! reverse ADDRESS
//! nameinfo ADDRESS PORT
//! servers [ADDRESS#UDP_PORT#TCP_PORT#SCOPE]...
//! local ADDRESS
//! cancel | shutdown
//! ```
//! What happens to it. Sockets are numbered from 1.
//! ```text
//! advance MS                  time passes, then the channel looks at its timeouts
//! expire                      time passes until the next timeout is due
//! deliver SOCKET hex [ADDRESS#PORT]   bytes arrive, from the server unless said, and the socket is readable
//! queue SOCKET hex [ADDRESS#PORT]     they arrive, and nobody is told yet
//! break SOCKET                after what has arrived, reading fails. The socket is readable
//! readable SOCKET | writable SOCKET | both SOCKET
//! sends SOCKET [NUMBER|block|fail]...   what the next calls to send on it do: take that many bytes at most, or not
//! opens [ok|fail]...          what the next calls to open a socket do
//! touch PATH MTIME
//! ```
//! The log has a line for each call into the world that changes it, `done REQUEST ...` for each request that ends, and
//! `timer MS|none` whenever the next timeout is another than before, in milliseconds since the start.

use core::cell::RefCell;
use core::fmt::Write as _;
use core::net::{IpAddr, SocketAddr};
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;

use crate::addrinfo::Family;
use crate::io::{
    FileError, Io, IoError, MacResolver, Opened, Settings, Socket, Time, Transport, Variable,
    WindowsServer, WindowsSettings,
};
use crate::reply::{Addresses, Caa, Kind, Mx, Naptr, Reply, Soa, Srv};
use crate::{Answer, Channel, Options, Result, ServerConfig, Token};

type Words<'a> = &'a [&'a [u8]];

enum Arrival {
    Data(Vec<u8>, SocketAddr),
    Failure,
}

#[derive(Clone, Copy)]
enum Send {
    AtMost(usize),
    Block,
    Fail,
}

struct FakeSocket {
    transport: Transport,
    arrivals: VecDeque<Arrival>,
    sends: VecDeque<Send>,
    server: SocketAddr,
}

#[derive(Clone, Copy)]
enum Route {
    From(IpAddr),
    None,
    Fails,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SettingsKind {
    Files,
    Windows,
    Mac,
    MacFails,
    Android,
}

struct File {
    contents: Option<Vec<u8>>,
    modified: Option<i64>,
}

struct World {
    log: String,
    files: BTreeMap<Vec<u8>, File>,
    etc: Option<Vec<u8>>,
    local_domain: Option<Vec<u8>>,
    res_options: Option<Vec<u8>>,
    host_aliases: Option<Vec<u8>>,
    hostname: Option<Vec<u8>>,
    settings: SettingsKind,
    windows: WindowsSettings,
    mac: Vec<MacResolver>,
    android: Vec<Vec<u8>>,
    interfaces: Vec<(u32, Vec<u8>)>,
    routes: BTreeMap<IpAddr, Route>,
    loopback: Option<Vec<IpAddr>>,
    random: u64,
    fast_open: bool,
    elapsed_ms: u64,
    sockets: BTreeMap<u64, FakeSocket>,
    last_socket: u64,
    opens: VecDeque<bool>,
}

const START: Time = Time { sec: 1000, usec: 0 };
const START_UNIX: i64 = 1_700_000_000;

struct Text<'a>(&'a [u8]);

impl core::fmt::Display for Text<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.0.is_empty() {
            return f.write_str("%");
        }
        for &byte in self.0 {
            match byte {
                b'%' | 0..=b' ' | 0x7f.. => write!(f, "%{byte:02X}")?,
                _ => f.write_char(char::from(byte))?,
            }
        }
        Ok(())
    }
}

struct Hex<'a>(&'a [u8]);

impl core::fmt::Display for Hex<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.0.is_empty() {
            return f.write_str("-");
        }
        self.0.iter().try_for_each(|byte| write!(f, "{byte:02x}"))
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    char::from(byte).to_digit(16).map(|digit| digit as u8)
}

fn text(word: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(word.len());
    let mut rest = word;
    if rest == b"%" {
        return Some(out);
    }
    loop {
        rest = match rest {
            [] => return Some(out),
            [b'%', high, low, rest @ ..] => {
                out.push(hex_digit(*high)? << 4 | hex_digit(*low)?);
                rest
            }
            [b'%', ..] => return None,
            [byte, rest @ ..] => {
                out.push(*byte);
                rest
            }
        };
    }
}

fn hex(word: &[u8]) -> Option<Vec<u8>> {
    if word == b"-" {
        return Some(Vec::new());
    }
    let (pairs, []) = word.as_chunks::<2>() else {
        return None;
    };
    pairs
        .iter()
        .map(|[high, low]| Some(hex_digit(*high)? << 4 | hex_digit(*low)?))
        .collect()
}

fn parsed<T: core::str::FromStr>(word: &[u8]) -> Option<T> {
    core::str::from_utf8(word).ok()?.parse().ok()
}

fn parts(word: &[u8]) -> Vec<&[u8]> {
    bun_core::strings::split(word, b"#").collect()
}

/// `ADDRESS#PORT`
fn socket_address(word: &[u8]) -> Option<SocketAddr> {
    match parts(word).as_slice() {
        [address, port] => Some(SocketAddr::new(parsed(address)?, parsed(port)?)),
        _ => None,
    }
}

impl World {
    fn new() -> World {
        World {
            log: String::new(),
            files: BTreeMap::new(),
            etc: Some(b"/etc/".to_vec()),
            local_domain: None,
            res_options: None,
            host_aliases: None,
            hostname: None,
            settings: SettingsKind::Files,
            windows: WindowsSettings::default(),
            mac: Vec::new(),
            android: Vec::new(),
            interfaces: Vec::new(),
            routes: BTreeMap::new(),
            loopback: None,
            random: 0x9e37_79b9_7f4a_7c15,
            fast_open: false,
            elapsed_ms: 0,
            sockets: BTreeMap::new(),
            last_socket: 0,
            opens: VecDeque::new(),
        }
    }

    fn now(&self) -> Time {
        START.plus_ms(self.elapsed_ms)
    }

    /// `None`: the line cannot be read.
    fn configure(&mut self, command: &[u8], words: Words) -> Option<()> {
        match (command, words) {
            (b"file", [path, contents, modified @ ..]) => {
                let modified = match modified {
                    [] => Some(START_UNIX - 1000),
                    [modified] => Some(parsed(modified)?),
                    _ => return None,
                };
                let contents = Some(text(contents)?);
                self.files.insert(text(path)?, File { contents, modified });
            }
            (b"unreadable", [path]) => {
                let (contents, modified) = (None, None);
                self.files.insert(text(path)?, File { contents, modified });
            }
            (b"touch", [path, modified]) => {
                self.files.get_mut(&text(path)?)?.modified = Some(parsed(modified)?);
            }
            (b"etc", [b"-"]) => self.etc = None,
            (b"etc", [prefix]) => self.etc = Some(text(prefix)?),
            (b"env", [b"LOCALDOMAIN", value]) => self.local_domain = Some(text(value)?),
            (b"env", [b"RES_OPTIONS", value]) => self.res_options = Some(text(value)?),
            (b"env", [b"HOSTALIASES", value]) => self.host_aliases = Some(text(value)?),
            (b"hostname", [name]) => self.hostname = Some(text(name)?),
            (b"settings", [kind]) => {
                self.settings = match *kind {
                    b"files" => SettingsKind::Files,
                    b"windows" => SettingsKind::Windows,
                    b"mac" => SettingsKind::Mac,
                    b"mac-fails" => SettingsKind::MacFails,
                    b"android" => SettingsKind::Android,
                    _ => return None,
                }
            }
            (b"windows-server", [address, port, interface_metric, route_metric, interface]) => {
                self.windows.servers.push(WindowsServer {
                    address: SocketAddr::new(parsed(address)?, parsed(port)?),
                    interface_metric: parsed(interface_metric)?,
                    route_metric: match *route_metric {
                        b"-" => None,
                        metric => Some(parsed(metric)?),
                    },
                    ipv6_interface: parsed(interface)?,
                });
            }
            (b"windows-suffix", [suffix]) => self.windows.suffixes.push(text(suffix)?),
            (
                b"mac-resolver",
                [
                    for_one_domain,
                    reach_flags,
                    port,
                    interface,
                    options,
                    rest @ ..,
                ],
            ) => {
                let mut resolver = MacResolver {
                    for_one_domain: *for_one_domain == b"1",
                    reach_flags: parsed(reach_flags)?,
                    port: parsed(port)?,
                    interface: parsed(interface)?,
                    options: match *options {
                        b"-" => None,
                        options => Some(text(options)?),
                    },
                    ..MacResolver::default()
                };
                for word in rest {
                    match word.strip_prefix(b"search=") {
                        Some(domain) => resolver.search.push(text(domain)?),
                        None => resolver.nameservers.push(socket_address(word)?),
                    }
                }
                self.mac.push(resolver);
            }
            (b"android-property", [value]) => self.android.push(text(value)?),
            (b"interface", [index, name]) => self.interfaces.push((parsed(index)?, text(name)?)),
            (b"route", [destination, source]) => {
                let route = match *source {
                    b"none" => Route::None,
                    b"fails" => Route::Fails,
                    source => Route::From(parsed(source)?),
                };
                self.routes.insert(parsed(destination)?, route);
            }
            (b"loopback", addresses) => {
                self.loopback = Some(
                    addresses
                        .iter()
                        .map(|it| parsed(it))
                        .collect::<Option<_>>()?,
                );
            }
            (b"seed", [seed]) => self.random = parsed::<u64>(seed)?.max(1),
            (b"fast-open", []) => self.fast_open = true,
            (b"opens", results) => {
                for result in results {
                    self.opens.push_back(match *result {
                        b"ok" => true,
                        b"fail" => false,
                        _ => return None,
                    });
                }
            }
            (b"sends", [socket, results @ ..]) => {
                let socket = self.sockets.get_mut(&parsed(socket)?)?;
                for result in results {
                    socket.sends.push_back(match *result {
                        b"block" => Send::Block,
                        b"fail" => Send::Fail,
                        count => Send::AtMost(parsed(count)?),
                    });
                }
            }
            (b"queue" | b"deliver", [socket, data, from @ ..]) => {
                let socket = self.sockets.get_mut(&parsed(socket)?)?;
                let from = match from {
                    [] => socket.server,
                    [from] => socket_address(from)?,
                    _ => return None,
                };
                socket.arrivals.push_back(Arrival::Data(hex(data)?, from));
            }
            (b"break", [socket]) => {
                let socket = self.sockets.get_mut(&parsed(socket)?)?;
                socket.arrivals.push_back(Arrival::Failure);
            }
            _ => return None,
        }
        Some(())
    }

    fn receive(&mut self, id: u64, buffer: &mut [u8]) -> Result<(usize, SocketAddr), IoError> {
        let socket = self.sockets.get_mut(&id).ok_or(IoError::Failed)?;
        match socket.arrivals.pop_front() {
            None => Err(IoError::WouldBlock),
            Some(Arrival::Failure) => Err(IoError::Failed),
            Some(Arrival::Data(mut data, from)) => {
                let count = data.len().min(buffer.len());
                let rest = data.split_off(count);
                for (to, from) in buffer.iter_mut().zip(&data) {
                    *to = *from;
                }
                // What does not fit of a datagram is lost.
                if socket.transport == Transport::Tcp && !rest.is_empty() {
                    socket.arrivals.push_front(Arrival::Data(rest, from));
                }
                Ok((count, from))
            }
        }
    }
}

impl Io for World {
    fn open(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Result<Opened, IoError> {
        let kind = match transport {
            Transport::Udp => "udp",
            Transport::Tcp => "tcp",
        };
        let scope = match server {
            SocketAddr::V6(v6) if v6.scope_id() != 0 => v6.scope_id(),
            _ => 0,
        };
        let (ip, port) = (server.ip(), server.port());
        if !self.opens.pop_front().unwrap_or(true) {
            _ = writeln!(self.log, "open fails {kind} {ip}#{port}#{scope}");
            return Err(IoError::Failed);
        }
        self.last_socket += 1;
        let socket = self.last_socket;
        _ = write!(self.log, "open {socket} {kind} {ip}#{port}#{scope}");
        if let Some(local) = local {
            _ = write!(self.log, " from {local}");
        }
        self.log.push('\n');
        self.sockets.insert(
            socket,
            FakeSocket {
                transport,
                arrivals: VecDeque::new(),
                sends: VecDeque::new(),
                server,
            },
        );
        let fast_open = self.fast_open && transport == Transport::Tcp;
        Ok(Opened {
            socket: Socket(socket),
            fast_open,
        })
    }

    fn send(&mut self, Socket(id): Socket, data: &[u8]) -> Result<usize, IoError> {
        let socket = self.sockets.get_mut(&id).ok_or(IoError::Failed)?;
        let sent = match socket.sends.pop_front() {
            None => data,
            // A datagram goes out whole.
            Some(Send::AtMost(_)) if socket.transport == Transport::Udp => data,
            Some(Send::AtMost(count)) => data.get(..count.max(1)).unwrap_or(data),
            Some(Send::Block) => {
                _ = writeln!(self.log, "send {id} blocks");
                return Err(IoError::WouldBlock);
            }
            Some(Send::Fail) => {
                _ = writeln!(self.log, "send {id} fails");
                return Err(IoError::Failed);
            }
        };
        _ = writeln!(self.log, "send {id} {}", Hex(sent));
        Ok(sent.len())
    }

    fn recv_from(
        &mut self,
        Socket(id): Socket,
        buffer: &mut [u8],
    ) -> Result<(usize, SocketAddr), IoError> {
        self.receive(id, buffer)
    }

    fn recv(&mut self, Socket(id): Socket, buffer: &mut [u8]) -> Result<usize, IoError> {
        match self.receive(id, buffer)? {
            (0, _) => Err(IoError::Failed),
            (count, _) => Ok(count),
        }
    }

    fn watch(&mut self, Socket(id): Socket, readable: bool, writable: bool) {
        let (r, w) = (
            if readable { 'r' } else { '-' },
            if writable { 'w' } else { '-' },
        );
        _ = writeln!(self.log, "watch {id} {r}{w}");
    }

    fn close(&mut self, Socket(id): Socket) {
        self.sockets.remove(&id);
        _ = writeln!(self.log, "close {id}");
    }

    /// xorshift64*, a byte a step.
    fn random(&mut self, bytes: &mut [u8]) {
        for byte in bytes {
            self.random ^= self.random << 13;
            self.random ^= self.random >> 7;
            self.random ^= self.random << 17;
            *byte = (self.random.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 56) as u8;
        }
    }

    fn unix_time(&mut self) -> i64 {
        START_UNIX.saturating_add_unsigned(self.elapsed_ms / 1000)
    }

    fn read_file(&mut self, path: &[u8]) -> Result<Vec<u8>, FileError> {
        _ = writeln!(self.log, "read {}", Text(path));
        let file = self.files.get(path).ok_or(FileError::NotFound)?;
        file.contents.clone().ok_or(FileError::Other)
    }

    fn modified_time(&mut self, path: &[u8]) -> Option<i64> {
        self.files.get(path)?.modified
    }

    fn env(&mut self, variable: Variable) -> Option<Vec<u8>> {
        match variable {
            Variable::LocalDomain => self.local_domain.clone(),
            Variable::ResOptions => self.res_options.clone(),
            Variable::HostAliases => self.host_aliases.clone(),
        }
    }

    fn hostname(&mut self) -> Option<Vec<u8>> {
        self.hostname.clone()
    }

    fn settings(&mut self) -> Settings {
        match self.settings {
            SettingsKind::Files => Settings::Files,
            SettingsKind::Windows => Settings::Windows(core::mem::take(&mut self.windows)),
            SettingsKind::Mac => Settings::Mac(Some(core::mem::take(&mut self.mac))),
            SettingsKind::MacFails => Settings::Mac(None),
            SettingsKind::Android => Settings::Android(core::mem::take(&mut self.android)),
        }
    }

    fn etc_path(&mut self, name: &str) -> Option<Vec<u8>> {
        let mut path = self.etc.clone()?;
        path.extend_from_slice(name.as_bytes());
        Some(path)
    }

    fn interface_index(&mut self, name: &[u8]) -> Option<u32> {
        let (index, _) = self.interfaces.iter().find(|(_, it)| it == name)?;
        Some(*index)
    }

    fn has_interface(&mut self, index: u32) -> bool {
        self.interfaces.iter().any(|(it, _)| *it == index)
    }

    fn source_address(&mut self, destination: SocketAddr) -> Result<Option<IpAddr>, IoError> {
        match self.routes.get(&destination.ip()) {
            Some(Route::From(source)) => Ok(Some(*source)),
            Some(Route::None) | None => Ok(None),
            Some(Route::Fails) => Err(IoError::Failed),
        }
    }

    fn loopback_addresses(&mut self) -> Option<Vec<IpAddr>> {
        self.loopback.clone()
    }
}

/// The channel's hold on a world the simulation also has.
struct Shared(Rc<RefCell<World>>);

macro_rules! forward_to_the_world {
    ($(fn $name:ident($($argument:ident: $type:ty),*) $(-> $result:ty)?;)*) => {
        impl Io for Shared {
            $(fn $name(&mut self, $($argument: $type),*) $(-> $result)? {
                self.0.borrow_mut().$name($($argument),*)
            })*
        }
    };
}

forward_to_the_world! {
    fn open(transport: Transport, server: SocketAddr, local: Option<IpAddr>) -> Result<Opened, IoError>;
    fn send(socket: Socket, data: &[u8]) -> Result<usize, IoError>;
    fn recv_from(socket: Socket, buffer: &mut [u8]) -> Result<(usize, SocketAddr), IoError>;
    fn recv(socket: Socket, buffer: &mut [u8]) -> Result<usize, IoError>;
    fn watch(socket: Socket, readable: bool, writable: bool);
    fn close(socket: Socket);
    fn random(bytes: &mut [u8]);
    fn unix_time() -> i64;
    fn read_file(path: &[u8]) -> Result<Vec<u8>, FileError>;
    fn modified_time(path: &[u8]) -> Option<i64>;
    fn env(variable: Variable) -> Option<Vec<u8>>;
    fn hostname() -> Option<Vec<u8>>;
    fn settings() -> Settings;
    fn etc_path(name: &str) -> Option<Vec<u8>>;
    fn interface_index(name: &[u8]) -> Option<u32>;
    fn has_interface(index: u32) -> bool;
    fn source_address(destination: SocketAddr) -> Result<Option<IpAddr>, IoError>;
    fn loopback_addresses() -> Option<Vec<IpAddr>>;
}

fn kind_of(word: &[u8]) -> Option<Kind> {
    Some(match word {
        b"A" => Kind::A,
        b"AAAA" => Kind::Aaaa,
        b"ANY" => Kind::Any,
        b"CAA" => Kind::Caa,
        b"CNAME" => Kind::Cname,
        b"MX" => Kind::Mx,
        b"NAPTR" => Kind::Naptr,
        b"NS" => Kind::Ns,
        b"PTR" => Kind::Ptr,
        b"SOA" => Kind::Soa,
        b"SRV" => Kind::Srv,
        b"TXT" => Kind::Txt,
        _ => return None,
    })
}

fn write_optional_name(out: &mut String, name: Option<&Vec<u8>>) {
    match name {
        Some(name) => _ = write!(out, " name={}", Text(name)),
        None => out.push_str(" name=-"),
    }
}

fn write_addresses(out: &mut String, addresses: &Addresses) {
    write_optional_name(out, addresses.name.as_ref());
    for it in &addresses.addresses {
        _ = write!(out, " {}", it.address);
        if let Some(ttl) = it.ttl {
            _ = write!(out, "/{ttl}");
        }
    }
}

fn write_caa(out: &mut String, list: &[Caa]) {
    for it in list {
        let (property, value) = (Text(&it.property), Text(&it.value));
        _ = write!(out, " {},{property},{value}", it.critical);
    }
}

fn write_mx(out: &mut String, list: &[Mx]) {
    for it in list {
        _ = write!(out, " {},{}", it.priority, Text(&it.host));
    }
}

fn write_naptr(out: &mut String, list: &[Naptr]) {
    for it in list {
        let (flags, services) = (Text(&it.flags), Text(&it.services));
        let (regexp, replacement) = (Text(&it.regexp), Text(&it.replacement));
        let (order, preference) = (it.order, it.preference);
        _ = write!(
            out,
            " {order},{preference},{flags},{services},{regexp},{replacement}"
        );
    }
}

fn write_texts(out: &mut String, list: &[Vec<u8>]) {
    for it in list {
        _ = write!(out, " {}", Text(it));
    }
}

fn write_soa(out: &mut String, it: &Soa) {
    let (mname, rname) = (Text(&it.mname), Text(&it.rname));
    let (serial, refresh, retry, expire, minimum) =
        (it.serial, it.refresh, it.retry, it.expire, it.minimum);
    _ = write!(
        out,
        " {mname},{rname},{serial},{refresh},{retry},{expire},{minimum}"
    );
}

fn write_srv(out: &mut String, list: &[Srv]) {
    for it in list {
        let host = Text(&it.host);
        _ = write!(out, " {},{},{},{host}", it.priority, it.weight, it.port);
    }
}

/// ` LABEL[ ... ]` if there is a `part`.
fn write_part<T: ?Sized>(
    out: &mut String,
    label: &str,
    part: Option<&T>,
    write: fn(&mut String, &T),
) {
    if let Some(part) = part {
        _ = write!(out, " {label}[");
        write(out, part);
        out.push_str(" ]");
    }
}

fn write_reply(out: &mut String, reply: &Reply) {
    match reply {
        Reply::Addresses(addresses) => write_addresses(out, addresses),
        Reply::Any(any) => {
            write_part(out, "A", any.a.as_ref(), write_addresses);
            write_part(out, "AAAA", any.aaaa.as_ref(), write_addresses);
            write_part(out, "MX", any.mx.as_deref(), write_mx);
            write_part(out, "NS", any.ns.as_deref(), write_texts);
            write_part(out, "TXT", any.txt.as_deref(), write_texts);
            write_part(out, "SRV", any.srv.as_deref(), write_srv);
            write_part(out, "PTR", any.ptr.as_deref(), write_texts);
            write_part(out, "NAPTR", any.naptr.as_deref(), write_naptr);
            write_part(out, "SOA", any.soa.as_ref(), write_soa);
            write_part(out, "CAA", any.caa.as_deref(), write_caa);
        }
        Reply::Caa(list) => write_caa(out, list),
        Reply::Mx(list) => write_mx(out, list),
        Reply::Naptr(list) => write_naptr(out, list),
        Reply::Names(list) | Reply::Txt(list) => write_texts(out, list),
        Reply::Soa(soa) => write_soa(out, soa),
        Reply::Srv(list) => write_srv(out, list),
    }
}

fn write_answer(out: &mut String, answer: &Answer) {
    match answer {
        Answer::Reply(reply) => write_reply(out, reply),
        Answer::AddrInfo(info) => {
            write_optional_name(out, info.name.as_ref());
            for it in &info.aliases {
                _ = write!(out, " {}>{}/{}", Text(&it.alias), Text(&it.name), it.ttl);
            }
            for it in &info.nodes {
                _ = write!(out, " {}#{}/{}", it.address, it.port, it.ttl);
            }
        }
        Answer::Host(host) => {
            _ = write!(out, " name={}", Text(&host.name));
            for it in &host.aliases {
                _ = write!(out, " {}", Text(it));
            }
        }
        Answer::NameInfo(info) => {
            _ = write!(out, " name={}", Text(&info.node));
            if let Some(service) = &info.service {
                _ = write!(out, " service={}", Text(service));
            }
        }
    }
}

struct Simulation {
    world: Rc<RefCell<World>>,
    channel: Channel,
    requests: Token,
    timer: Option<Time>,
}

impl Simulation {
    fn new(world: Rc<RefCell<World>>, options: Options) -> Simulation {
        world.borrow_mut().log.push_str("start\n");
        let mut simulation = Simulation {
            channel: Channel::new(Box::new(Shared(Rc::clone(&world))), options),
            world,
            requests: 0,
            timer: None,
        };
        simulation.log_servers();
        simulation
    }

    fn log_servers(&mut self) {
        let mut line = String::from("servers");
        for it in self.channel.servers() {
            let (address, udp, tcp) = (it.address, it.udp_port, it.tcp_port);
            _ = write!(line, " {address}#{udp}#{tcp}#{}", it.scope_id);
        }
        line.push('\n');
        self.world.borrow_mut().log.push_str(&line);
    }

    fn request(&mut self) -> Token {
        self.requests += 1;
        self.requests - 1
    }

    /// `None`: the line cannot be read.
    fn act(&mut self, command: &[u8], words: Words) -> Option<()> {
        let now = self.world.borrow_mut().now();
        match (command, words) {
            (b"query", [kind, name]) => {
                let (kind, name, token) = (kind_of(kind)?, text(name)?, self.request());
                self.channel.query(now, kind, &name, token);
            }
            (b"lookup", [name, port, family]) => {
                let family = match *family {
                    b"0" => Family::Unspecified,
                    b"4" => Family::V4,
                    b"6" => Family::V6,
                    _ => return None,
                };
                let (name, port, token) = (text(name)?, parsed(port)?, self.request());
                self.channel.addr_info(now, &name, port, family, token);
            }
            (b"reverse", [address]) => {
                let (address, token) = (parsed(address)?, self.request());
                self.channel.host_of_address(now, address, token);
            }
            (b"nameinfo", [address, port]) => {
                let address = SocketAddr::new(parsed(address)?, parsed(port)?);
                let token = self.request();
                self.channel.name_info(now, address, token);
            }
            (b"servers", list) => {
                let mut servers = Vec::new();
                for word in list {
                    let [address, udp_port, tcp_port, scope_id] = *parts(word).as_slice() else {
                        return None;
                    };
                    servers.push(ServerConfig {
                        address: parsed(address)?,
                        udp_port: parsed(udp_port)?,
                        tcp_port: parsed(tcp_port)?,
                        scope_id: parsed(scope_id)?,
                    });
                }
                self.channel.set_servers(now, &servers);
                self.log_servers();
            }
            (b"local", [address]) => match parsed(address)? {
                IpAddr::V4(v4) => self.channel.set_local_v4(v4),
                IpAddr::V6(v6) => self.channel.set_local_v6(v6),
            },
            (b"cancel", []) => self.channel.cancel(now),
            (b"shutdown", []) => self.channel.shut_down(now),
            (b"advance", [ms]) => self.advance(parsed(ms)?),
            (b"expire", []) => {
                let due = self.channel.next_timeout()?;
                self.advance(due.ms_since(now));
            }
            (b"readable" | b"deliver" | b"break", [socket, ..]) => {
                if command != b"readable" {
                    self.world.borrow_mut().configure(command, words)?;
                }
                self.channel
                    .process(now, Some(Socket(parsed(socket)?)), None);
            }
            (b"writable", [socket]) => {
                self.channel
                    .process(now, None, Some(Socket(parsed(socket)?)));
            }
            (b"both", [socket]) => {
                let socket = Some(Socket(parsed(socket)?));
                self.channel.process(now, socket, socket);
            }
            _ => self.world.borrow_mut().configure(command, words)?,
        }
        Some(())
    }

    fn advance(&mut self, ms: u64) {
        let now = {
            let mut world = self.world.borrow_mut();
            world.elapsed_ms = world.elapsed_ms.saturating_add(ms).min(u64::from(u32::MAX));
            world.now()
        };
        self.channel.process(now, None, None);
    }

    fn log_what_changed(&mut self) {
        while let Some(done) = self.channel.next_completion() {
            let mut line = format!("done {}", done.token);
            match &done.result {
                Ok(answer) => write_answer(&mut line, answer),
                Err(error) => _ = write!(line, " error {error:?}"),
            }
            line.push('\n');
            self.world.borrow_mut().log.push_str(&line);
        }
        let timer = self.channel.next_timeout();
        if timer != self.timer {
            self.timer = timer;
            let log = &mut self.world.borrow_mut().log;
            match timer {
                Some(due) => _ = writeln!(log, "timer {}", due.ms_since(START)),
                None => log.push_str("timer none\n"),
            }
        }
    }
}

const MAKES_THE_CHANNEL: [&[u8]; 8] = [
    b"query",
    b"lookup",
    b"reverse",
    b"nameinfo",
    b"servers",
    b"local",
    b"cancel",
    b"shutdown",
];

/// See the module's documentation.
pub fn run(script: &[u8]) -> String {
    let mut options = Options::default();
    let world = Rc::new(RefCell::new(World::new()));
    let mut simulation: Option<Simulation> = None;

    for line in bun_core::strings::split(script, b"\n") {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let words: Vec<&[u8]> = bun_core::strings::split(line, b" ").collect();
        let Some((command, words)) = words.split_first() else {
            continue;
        };
        if command.is_empty() || command.starts_with(b"#") {
            continue;
        }
        let understood = match (&simulation, *command, words) {
            (None, b"timeout", [ms]) => parsed(ms).map(|ms| options.timeout_ms = Some(ms)),
            (None, b"tries", [tries]) => parsed(tries).map(|tries| options.tries = Some(tries)),
            (None, ..) if !MAKES_THE_CHANNEL.contains(command) => {
                world.borrow_mut().configure(command, words)
            }
            _ => {
                let simulation =
                    simulation.get_or_insert_with(|| Simulation::new(Rc::clone(&world), options));
                let understood = simulation.act(command, words);
                simulation.log_what_changed();
                understood
            }
        };
        if understood.is_none() {
            _ = writeln!(world.borrow_mut().log, "? {}", Text(line));
        }
    }

    core::mem::take(&mut world.borrow_mut().log)
}
