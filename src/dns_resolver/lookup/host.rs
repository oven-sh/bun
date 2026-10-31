//! `gethostbyaddr()` and `getnameinfo()`: the names of an address.

use core::net::{IpAddr, SocketAddr};
use std::io::Write as _;

use bun_core::strings;

use super::{Host, NameInfo};
use crate::channel::{Answer, Channel, LookupId, Owner, Token};
use crate::io::Time;
use crate::message::{Message, rr_type};
use crate::system_config::{Source, load_etc_file};
use crate::text::{take_while, trim_start, word};
use crate::{Error, Result, reply};

/// c-ares's buffer, with its NUL.
const SERVICE_NAME_SIZE: usize = 33;

enum Wanted {
    Host,
    /// With the service of this port.
    NameInfo(u16),
}

pub(crate) struct HostLookup {
    token: Token,
    wanted: Wanted,
    address: IpAddr,
    next_source: usize,
}

/// `4.3.2.1.in-addr.arpa`, or the 32 nibbles of an IPv6 address under `ip6.arpa`.
fn reverse_name(address: IpAddr) -> Vec<u8> {
    let mut name = Vec::new();
    match address {
        IpAddr::V4(v4) => {
            for octet in v4.octets().iter().rev() {
                let _ = write!(name, "{octet}.");
            }
            name.extend_from_slice(b"in-addr.arpa");
        }
        IpAddr::V6(v6) => {
            for octet in v6.octets().iter().rev() {
                let _ = write!(name, "{:x}.{:x}.", octet & 0xf, octet >> 4);
            }
            name.extend_from_slice(b"ip6.arpa");
        }
    }
    name
}

/// `strtoul(text, &rest, 0)` with `u32::MAX` for anything above it, as glibc reads a number in its
/// databases. `None` without a digit.
fn strtou32(text: &[u8]) -> Option<(u32, &[u8])> {
    let text = trim_start(text);
    let (negative, text) = match text {
        [b'-', rest @ ..] => (true, rest),
        [b'+', rest @ ..] => (false, rest),
        _ => (false, text),
    };
    let (radix, digits) = match text {
        [b'0', b'x' | b'X', rest @ ..] if rest.first().is_some_and(u8::is_ascii_hexdigit) => {
            (16, rest)
        }
        [b'0', ..] => (8, text),
        _ => (10, text),
    };
    let (digits, rest) = take_while(digits, |byte| char::from(byte).is_digit(radix));
    if digits.is_empty() {
        return None;
    }
    let value = digits.iter().try_fold(0u64, |value, &byte| {
        value
            .checked_mul(radix.into())?
            .checked_add(char::from(byte).to_digit(radix)?.into())
    });
    let value = match value {
        Some(value) if negative => value.wrapping_neg(),
        Some(value) => value,
        None => u64::MAX,
    };
    Some((value.min(u32::MAX.into()) as u32, rest))
}

/// services(5), lines of `name port/protocol aliases...`, the way glibc's `getservbyport_r()` reads
/// them.
fn tcp_service_name(services: &[u8], port: u16) -> Option<&[u8]> {
    strings::split(services, b"\n").find_map(|line| {
        // A line is a C string there.
        let line = match strings::index_of_any(line, b"#\0") {
            Some(end) => line.get(..end)?,
            None => line,
        };
        let (name, rest) = word(trim_start(line));
        let (number, rest) = strtou32(rest)?;
        let (slashes, rest) = take_while(rest, |byte| byte == b'/');
        let (protocol, _) = word(rest);
        (!slashes.is_empty() && number as u16 == port && protocol == b"tcp").then_some(name)
    })
}

impl Channel {
    /// `dns.reverse()`.
    pub fn reverse(&mut self, now: Time, address: IpAddr, token: Token) {
        self.start_host_lookup(now, address, Wanted::Host, token);
    }

    /// `dns.lookupService()`: fails if the address has no name.
    pub fn lookup_service(&mut self, now: Time, address: SocketAddr, token: Token) {
        self.start_host_lookup(now, address.ip(), Wanted::NameInfo(address.port()), token);
    }

    fn start_host_lookup(&mut self, now: Time, address: IpAddr, wanted: Wanted, token: Token) {
        let id = self.new_lookup_id();
        self.host_lookups.insert(
            id,
            HostLookup {
                token,
                wanted,
                address,
                next_source: 0,
            },
        );
        self.host_lookup_next(now, id);
    }

    fn host_lookup_next(&mut self, now: Time, id: LookupId) {
        loop {
            let Some(lookup) = self.host_lookups.get_mut(&id) else {
                return;
            };
            let address = lookup.address;
            let source = self.sources.get(lookup.next_source).copied();
            lookup.next_source += 1;
            match source {
                Some(Source::Dns) => {
                    let owner = Owner::Host { lookup: id };
                    self.ask(now, &reverse_name(address), rr_type::PTR, owner);
                    return;
                }
                Some(Source::Files) => {
                    let host = self
                        .hosts_file()
                        .ok()
                        .and_then(|file| file.host_at(address));
                    if let Some(host) = host {
                        return self.end_host_lookup(id, Ok(host));
                    }
                }
                None => return self.end_host_lookup(id, Err(Error::ENOTFOUND)),
            }
        }
    }

    pub(crate) fn host_lookup_answered(
        &mut self,
        now: Time,
        id: LookupId,
        result: Result<Message>,
    ) {
        match result {
            Ok(response) => {
                let host = reply::ptr(&response).and_then(|names| {
                    Ok(Host {
                        name: names.last().ok_or(Error::ENODATA)?.clone(),
                        aliases: names,
                    })
                });
                self.end_host_lookup(id, host);
            }
            Err(error @ (Error::EDESTRUCTION | Error::ECANCELLED)) => {
                self.end_host_lookup(id, Err(error));
            }
            Err(_) => self.host_lookup_next(now, id),
        }
    }

    fn end_host_lookup(&mut self, id: LookupId, host: Result<Host>) {
        let Some(lookup) = self.host_lookups.remove(&id) else {
            return;
        };
        let answer = host.map(|host| match lookup.wanted {
            Wanted::Host => Answer::Host(host),
            Wanted::NameInfo(port) => Answer::NameInfo(NameInfo {
                node: host.name,
                service: self.service_of_port(port),
            }),
        });
        self.complete(lookup.token, answer);
    }

    fn service_of_port(&mut self, port: u16) -> Option<Vec<u8>> {
        if port == 0 {
            return None;
        }
        let name = load_etc_file(&mut *self.io, "services")
            .ok()
            .and_then(|services| tcp_service_name(&services, port).map(<[u8]>::to_vec))
            .unwrap_or_else(|| port.to_string().into_bytes());
        // c-ares copies a name that does not fit as the empty string.
        Some(if name.len() < SERVICE_NAME_SIZE {
            name
        } else {
            Vec::new()
        })
    }
}
