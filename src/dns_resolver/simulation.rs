//! Runs a [`Channel`] in a world made up by a script, and logs all it does there. For tests:
//! nothing else reaches it.
//!
//! A script is lines of words separated by single spaces. `#` starts a comment line. A line that
//! cannot be read is logged as `? line` and passed over. A *text* word stands for bytes: `%XX` is a
//! byte, `%` alone is no bytes, all else is itself. A *hex* word is two digits a byte, `-` for
//! none.
//!
//! The world. `timeout` and `tries` come before the channel is made. So does what the channel reads
//! only then, to have an effect: `settings` and what goes with it, `hostname`, `env` other than
//! `HOSTALIASES`. The rest may come at any time.
//! ```text
//! file PATH text [MTIME [INODE]]   its contents, when it was modified in seconds since the epoch (1699999000 unless
//!                                  said), and its inode (0 unless said)
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
//! What is asked of the channel. The first of these makes it, at 1700000000 seconds since the
//! epoch. Requests are numbered from 0.
//! ```text
//! query TYPE text             TYPE as `resolve()` spells it
//! lookup text PORT 0|4|6      the last is the family
//! reverse ADDRESS
//! nameinfo ADDRESS PORT
//! servers [ADDRESS#UDP_PORT#TCP_PORT#SCOPE]...   a port of 0 is 53
//! local ADDRESS
//! cancel | shutdown
//! ```
//! What happens to it, once it is made. Sockets are numbered from 1.
//! ```text
//! advance MS                  time passes, then the channel looks at its timeouts
//! expire                      time passes until the next timeout is due
//! deliver SOCKET hex [ADDRESS#PORT]   bytes arrive, from the server unless said, and the socket is readable.
//!                                     No bytes are an empty datagram, or the end of a TCP stream
//! queue SOCKET hex [ADDRESS#PORT]     they arrive, and nobody is told yet
//! break SOCKET                after what has arrived, reading fails. The socket is readable
//! readable SOCKET | writable SOCKET | both SOCKET
//! sends SOCKET [NUMBER|block|fail]...   what the next calls to send on it do: take that many bytes of a TCP stream at
//!                                       most, and one at least, or not
//! opens [ok|fail]...          what the next calls to open a socket do
//! ```
//! The log:
//! ```text
//! start                       the channel is being made
//! servers [ADDRESS#UDP_PORT#TCP_PORT#SCOPE]...   its servers, once it is made and after each `servers`
//! read PATH
//! open SOCKET udp|tcp ADDRESS#PORT#SCOPE [from ADDRESS]
//! open fails udp|tcp ADDRESS#PORT#SCOPE
//! send SOCKET hex|blocks|fails
//! watch SOCKET r-|rw
//! close SOCKET
//! done REQUEST error CODE                                  as c-ares names it, without `ARES_`
//! done REQUEST name=text|- [ADDRESS[/TTL]]...              query A, AAAA
//! done REQUEST [text]...                                   query CNAME, NS, PTR, TXT
//! done REQUEST [PREFERENCE,text]...                        query MX
//! done REQUEST [PRIORITY,WEIGHT,PORT,text]...              query SRV
//! done REQUEST [CRITICAL,text,text]...                     query CAA
//! done REQUEST [ORDER,PREFERENCE,text,text,text,text]...   query NAPTR: flags, services, regexp, replacement
//! done REQUEST text,text,SERIAL,REFRESH,RETRY,EXPIRE,MINIMUM   query SOA
//! done REQUEST [TYPE[ ... ]]...                            query ANY: each type it has, as above
//! done REQUEST name=text|- [text>text/TTL]... [ADDRESS#PORT/TTL]...   lookup: aliases, then addresses
//! done REQUEST name=text [text]...                         reverse: the name, then its aliases
//! done REQUEST name=text [service=text]                    nameinfo
//! timer MS|none               the next timeout, in milliseconds since the start, whenever it changes
//! ? line                      the line could not be read
//! ```
//! The ids of queries follow from `seed`, so to answer one, run the script as far as it goes and
//! copy the id out of the `send` line:
//! ```text
//! file /etc/resolv.conf nameserver%2010.0.0.1%0A
//! query A a.test
//! deliver 1 dd748180000100010000000001610474657374000001000101610474657374000001000100000064000401020304
//! ```
//! ```text
//! start
//! read /etc/resolv.conf
//! read /etc/nsswitch.conf
//! servers 10.0.0.1#53#53#0
//! open 1 udp 10.0.0.1#53#0
//! watch 1 r-
//! send 1 dd7401000001000000000000016104746573740000010001
//! timer 2000
//! close 1
//! done 0 name=a.test 1.2.3.4/100
//! timer none
//! ```

use core::cell::RefCell;
use core::fmt::Write as _;
use core::net::{IpAddr, SocketAddr};
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;

use bun_core::strings;

use crate::addr_info::Family;
use crate::io::{
    EnvVar, FileError, FileIdentity, Io, IoError, MacResolver, Opened, Settings, Socket, Time,
    Transport, WindowsServer, WindowsSettings,
};
use crate::reply::{Addresses, Caa, Mx, Naptr, RecordType, Reply, Soa, Srv};
use crate::{Answer, Channel, Options, Result, ServerConfig, Token};

type Words<'a> = &'a [&'a [u8]];

enum Arrival {
    Data(Vec<u8>, SocketAddr),
    Failure,
}

struct FakeSocket {
    transport: Transport,
    arrivals: VecDeque<Arrival>,
    /// What the next calls to send do: take so many bytes at most, or not.
    sends: VecDeque<Result<usize, IoError>>,
    server: SocketAddr,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum SettingsKind {
    #[default]
    Files,
    Windows,
    Mac,
    MacFails,
    Android,
}

struct File {
    contents: Option<Vec<u8>>,
    modified: Option<i64>,
    inode: u64,
}

#[derive(Default)]
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
    routes: BTreeMap<IpAddr, Result<Option<IpAddr>, IoError>>,
    loopback: Option<Vec<IpAddr>>,
    random_state: u64,
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
    if !word.len().is_multiple_of(2) {
        return None;
    }
    let mut bytes = vec![0; word.len() / 2];
    strings::decode_hex_to_bytes(&mut bytes, word).ok()?;
    Some(bytes)
}

fn parsed<T: core::str::FromStr>(word: &[u8]) -> Option<T> {
    core::str::from_utf8(word).ok()?.parse().ok()
}

fn parts(word: &[u8]) -> Vec<&[u8]> {
    strings::split(word, b"#").collect()
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
            etc: Some(b"/etc/".to_vec()),
            random_state: 0x9e37_79b9_7f4a_7c15,
            ..World::default()
        }
    }

    fn now(&self) -> Time {
        START.plus_ms(self.elapsed_ms)
    }

    /// `None`: the line cannot be read.
    fn configure(&mut self, command: &[u8], words: Words) -> Option<()> {
        match (command, words) {
            (b"file", [path, contents, identity @ ..]) => {
                let (modified, inode) = match identity {
                    [] => (START_UNIX - 1000, 0),
                    [modified] => (parsed(modified)?, 0),
                    [modified, inode] => (parsed(modified)?, parsed(inode)?),
                    _ => return None,
                };
                let file = File {
                    contents: Some(text(contents)?),
                    modified: Some(modified),
                    inode,
                };
                self.files.insert(text(path)?, file);
            }
            (b"unreadable", [path]) => {
                let file = File {
                    contents: None,
                    modified: None,
                    inode: 0,
                };
                self.files.insert(text(path)?, file);
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
                    for_one_domain: match *for_one_domain {
                        b"0" => false,
                        b"1" => true,
                        _ => return None,
                    },
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
                    b"none" => Ok(None),
                    b"fails" => Err(IoError::Failed),
                    source => Ok(Some(parsed(source)?)),
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
            (b"seed", [seed]) => self.random_state = parsed::<u64>(seed)?.max(1),
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
                        b"block" => Err(IoError::WouldBlock),
                        b"fail" => Err(IoError::Failed),
                        count => Ok(parsed(count)?),
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
            SocketAddr::V6(v6) => v6.scope_id(),
            SocketAddr::V4(_) => 0,
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
            Some(Ok(_)) if socket.transport == Transport::Udp => data,
            Some(Ok(count)) => data.get(..count.max(1)).unwrap_or(data),
            Some(Err(error)) => {
                let what = match error {
                    IoError::WouldBlock => "blocks",
                    IoError::Failed => "fails",
                };
                _ = writeln!(self.log, "send {id} {what}");
                return Err(error);
            }
        };
        match sent {
            [] => _ = writeln!(self.log, "send {id} -"),
            _ => _ = writeln!(self.log, "send {id} {}", bun_core::fmt::hex_lower(sent)),
        }
        Ok(sent.len())
    }

    fn recv_from(
        &mut self,
        Socket(id): Socket,
        buffer: &mut [u8],
    ) -> Result<(usize, SocketAddr), IoError> {
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

    fn recv(&mut self, socket: Socket, buffer: &mut [u8]) -> Result<usize, IoError> {
        match self.recv_from(socket, buffer)? {
            (0, _) => Err(IoError::Failed),
            (count, _) => Ok(count),
        }
    }

    fn watch(&mut self, Socket(id): Socket, writable: bool) {
        let w = if writable { 'w' } else { '-' };
        _ = writeln!(self.log, "watch {id} r{w}");
    }

    fn close(&mut self, Socket(id): Socket) {
        self.sockets.remove(&id);
        _ = writeln!(self.log, "close {id}");
    }

    /// xorshift64*, a byte a step.
    fn random(&mut self, bytes: &mut [u8]) {
        for byte in bytes {
            self.random_state ^= self.random_state << 13;
            self.random_state ^= self.random_state >> 7;
            self.random_state ^= self.random_state << 17;
            *byte = (self.random_state.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 56) as u8;
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

    fn file_identity(&mut self, path: &[u8]) -> Option<FileIdentity> {
        let file = self.files.get(path)?;
        Some(FileIdentity {
            modified_at: file.modified?,
            size: file
                .contents
                .as_ref()
                .map_or(0, |contents| contents.len() as u64),
            inode: file.inode,
            device: 0,
        })
    }

    fn env(&mut self, variable: EnvVar) -> Option<Vec<u8>> {
        match variable {
            EnvVar::LocalDomain => self.local_domain.clone(),
            EnvVar::ResOptions => self.res_options.clone(),
            EnvVar::HostAliases => self.host_aliases.clone(),
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
        let route = self.routes.get(&destination.ip());
        route.copied().unwrap_or(Ok(None))
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
    fn watch(socket: Socket, writable: bool);
    fn close(socket: Socket);
    fn random(bytes: &mut [u8]);
    fn unix_time() -> i64;
    fn read_file(path: &[u8]) -> Result<Vec<u8>, FileError>;
    fn file_identity(path: &[u8]) -> Option<FileIdentity>;
    fn env(variable: EnvVar) -> Option<Vec<u8>>;
    fn hostname() -> Option<Vec<u8>>;
    fn settings() -> Settings;
    fn etc_path(name: &str) -> Option<Vec<u8>>;
    fn interface_index(name: &[u8]) -> Option<u32>;
    fn has_interface(index: u32) -> bool;
    fn source_address(destination: SocketAddr) -> Result<Option<IpAddr>, IoError>;
    fn loopback_addresses() -> Option<Vec<IpAddr>>;
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
        let (property, value) = (Text(&it.tag), Text(&it.value));
        _ = write!(out, " {},{property},{value}", it.critical);
    }
}

fn write_mx(out: &mut String, list: &[Mx]) {
    for it in list {
        _ = write!(out, " {},{}", it.preference, Text(&it.exchange));
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
        let host = Text(&it.target);
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
                _ = write!(out, " {}>{}/{}", Text(&it.owner), Text(&it.target), it.ttl);
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
    /// As last logged.
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

    fn next_token(&mut self) -> Token {
        self.requests += 1;
        self.requests - 1
    }

    /// `None`: the line cannot be read.
    fn act(&mut self, command: &[u8], words: Words) -> Option<()> {
        let now = self.world.borrow_mut().now();
        match (command, words) {
            (b"query", [record_type, name]) => {
                let record_type = RecordType::from_name(record_type)?;
                let (name, token) = (text(name)?, self.next_token());
                self.channel.resolve(now, record_type, &name, token);
            }
            (b"lookup", [name, port, family]) => {
                let family = match *family {
                    b"0" => Family::Unspecified,
                    b"4" => Family::V4,
                    b"6" => Family::V6,
                    _ => return None,
                };
                let (name, port, token) = (text(name)?, parsed(port)?, self.next_token());
                self.channel.lookup(now, &name, port, family, token);
            }
            (b"reverse", [address]) => {
                let (address, token) = (parsed(address)?, self.next_token());
                self.channel.reverse(now, address, token);
            }
            (b"nameinfo", [address, port]) => {
                let address = SocketAddr::new(parsed(address)?, parsed(port)?);
                let token = self.next_token();
                self.channel.lookup_service(now, address, token);
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
                let due = self.channel.next_deadline()?;
                self.advance(due.ms_since(now));
            }
            (b"readable" | b"deliver" | b"break", [socket, ..]) => {
                if command != b"readable" {
                    self.world.borrow_mut().configure(command, words)?;
                }
                let socket = Socket(parsed(socket)?);
                self.channel.socket_ready(now, socket, true, false);
            }
            (b"writable", [socket]) => {
                let socket = Socket(parsed(socket)?);
                self.channel.socket_ready(now, socket, false, true);
            }
            (b"both", [socket]) => {
                let socket = Socket(parsed(socket)?);
                self.channel.socket_ready(now, socket, true, true);
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
        self.channel.check_timeouts(now);
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
        let timer = self.channel.next_deadline();
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

/// The requests of [`Simulation::act`].
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

pub fn run(script: &[u8]) -> String {
    let mut options = Options::default();
    let world = Rc::new(RefCell::new(World::new()));
    let mut simulation: Option<Simulation> = None;

    for line in strings::split(script, b"\n") {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let words: Vec<&[u8]> = strings::split(line, b" ").collect();
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
