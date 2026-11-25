//! `getaddrinfo`, `gethostbyaddr` and `getnameinfo`: requests that can take more than one query, or none.

use core::cell::Cell;
use core::net::{IpAddr, Ipv4Addr};
use std::rc::Rc;

use bun_core::{ip_address, strings};

use crate::client::{Answers, Client, Outcome, Purpose, Reply};
use crate::config::{Config, Source, WHITESPACE, lines};
use crate::hosts::Table;
use crate::message::{Address, Message, Record, RecordType};
use crate::system::{System, Variable};
use crate::{Error, name, sort};

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Unspecified,
    Inet,
    Inet6,
}

impl Family {
    fn includes(self, ip: IpAddr) -> bool {
        match self {
            Family::Unspecified => true,
            Family::Inet => ip.is_ipv4(),
            Family::Inet6 => ip.is_ipv6(),
        }
    }
}

/// Shared by the queries for A and AAAA. The one that finishes last goes on with it.
pub(crate) struct AddressLookup<R> {
    request: R,
    host: Box<[u8]>,
    family: Family,
    sources: &'static [Source],
    /// The names to ask for, last first.
    candidates: Vec<Box<[u8]>>,
    had_no_data: bool,
    /// The first that was passed over. It leaves open whether there is an address.
    refusal: Option<Error>,
    found: Cell<Vec<Address>>,
    has_ipv4: Cell<bool>,
    /// Of the query that finished first.
    other_error: Cell<Option<Error>>,
}

impl<R> AddressLookup<R> {
    /// While AAAA is being asked for. It is not worth waiting for then.
    pub(crate) fn can_do_without_ipv6(&self) -> bool {
        self.has_ipv4.get() || self.other_error.get() == Some(Error::ENOTFOUND)
    }

    fn candidate(&self) -> &[u8] {
        self.candidates.last().map_or(&[], |name| name)
    }
}

pub(crate) struct NameLookup<R> {
    request: R,
    ip: IpAddr,
    /// `Some` if the name of the service is asked for too.
    port: Option<u16>,
    sources: &'static [Source],
}

/// The server was there, and says nothing about the name.
fn is_refusal(error: Error) -> bool {
    use Error::*;
    matches!(error, ESERVFAIL | EREFUSED | ENOTIMP | EFORMERR)
}

/// hostname(7)
fn host_alias(host: &[u8], system: &impl System) -> Option<Box<[u8]>> {
    let path = system.variable(Variable::HostAliases)?;
    if strings::contains_char(host, b'.') {
        return None;
    }
    lines(&system.read_file(path)?).find_map(|line| {
        let mut fields = strings::tokenize_any(line, WHITESPACE);
        fields.next().filter(|it| it.eq_ignore_ascii_case(host))?;
        fields
            .next()
            .filter(|it| name::is_hostname(it))
            .map(Into::into)
    })
}

/// Last first.
fn search_list(host: &[u8], config: &Config) -> Vec<Box<[u8]>> {
    if host.ends_with(b".") {
        return vec![host.into()];
    }
    let domains = config.domains.iter().rev();
    let in_domains = domains
        .map(|domain| [host, b".", domain].concat().into_boxed_slice())
        .filter(|name| name::can_encode(name));
    let as_is = core::iter::once(host.into());
    if strings::count_char(host, b'.') >= config.ndots {
        in_domains.chain(as_is).collect()
    } else {
        as_is.chain(in_domains).collect()
    }
}

/// RFC 1035 §3.5, RFC 3596 §2.5
fn reverse_name(ip: IpAddr) -> Vec<u8> {
    let mut name = Vec::with_capacity(72);
    match ip {
        IpAddr::V4(ip) => {
            let reversed = Ipv4Addr::from_bits(ip.to_bits().swap_bytes());
            name.extend_from_slice(&ip_address::IpText::new(reversed.into()));
            name.extend_from_slice(b".in-addr.arpa");
        }
        IpAddr::V6(ip) => {
            let digit = |nibble: u8| match nibble {
                ..10 => b'0' + nibble,
                _ => b'a' + nibble - 10,
            };
            for octet in ip.octets().into_iter().rev() {
                name.extend_from_slice(&[digit(octet & 15), b'.', digit(octet >> 4), b'.']);
            }
            name.extend_from_slice(b"ip6.arpa");
        }
    }
    name
}

impl<S: System, R> Client<S, R> {
    fn hosts(&mut self) -> &Table {
        self.hosts.current(&self.config.hosts_path, &self.system)
    }

    /// Best first. An address is its own answer, whatever its family. One in a short form, such as `127.1`, has none.
    #[must_use]
    pub fn lookup(&mut self, host: &[u8], family: Family, request: R) -> Answers<R> {
        self.call(|this| {
            if let Some(ip) = ip_address::parse_strict(host) {
                let address = Address { ip, ttl: 0 };
                return this.answer(request, Ok(Reply::Addresses(vec![address])));
            }
            if name::encode(host, &mut [0; name::MAX_LEN]).is_some_and(name::is_onion)
                || ip_address::to_ip_address(host).is_some()
            {
                return this.answer(request, Err(Error::ENOTFOUND));
            }
            let alias = host_alias(host, &this.system);
            let lookup = AddressLookup {
                request,
                host: host.into(),
                family,
                sources: this.config.sources,
                candidates: alias.map_or_else(|| search_list(host, &this.config), |it| vec![it]),
                had_no_data: false,
                refusal: None,
                found: Cell::default(),
                has_ipv4: Cell::default(),
                other_error: Cell::default(),
            };
            this.look_for_addresses(lookup, Error::ENOTFOUND);
        })
    }

    /// `error` is the answer if there is nowhere left to look.
    fn look_for_addresses(&mut self, mut lookup: AddressLookup<R>, error: Error) {
        while let &[source, ref rest @ ..] = lookup.sources {
            if source == Source::Hosts {
                let listed = self.hosts().addresses(&lookup.host).iter();
                let found: Vec<Address> = listed
                    .filter(|&&ip| lookup.family.includes(ip))
                    .map(|&ip| Address { ip, ttl: 0 })
                    .collect();
                if !found.is_empty() {
                    return self.answer_addresses(lookup.request, found);
                }
            } else if !lookup.candidates.is_empty() {
                let lookup = Rc::new(lookup);
                if lookup.family != Family::Inet6 {
                    self.ask_for_addresses(&lookup, RecordType::A);
                }
                if lookup.family != Family::Inet {
                    self.ask_for_addresses(&lookup, RecordType::AAAA);
                }
                return;
            }
            lookup.sources = rest;
        }
        self.answer(lookup.request, Err(error));
    }

    fn answer_addresses(&mut self, request: R, mut found: Vec<Address>) {
        sort::sort(&mut found, &mut self.system);
        self.answer(request, Ok(Reply::Addresses(found)));
    }

    fn ask_for_addresses(&mut self, lookup: &Rc<AddressLookup<R>>, kind: RecordType) {
        let purpose = Purpose::Addresses(Rc::clone(lookup), kind);
        self.ask(lookup.candidate(), kind, purpose);
    }

    pub(crate) fn got_addresses(
        &mut self,
        lookup: Rc<AddressLookup<R>>,
        kind: RecordType,
        outcome: Outcome,
    ) {
        let records = outcome.and_then(Message::into_records);
        if let Ok(records) = &records {
            let mut found = lookup.found.take();
            found.extend(records.addresses());
            lookup.has_ipv4.set(found.iter().any(|it| it.ip.is_ipv4()));
            lookup.found.set(found);
        }
        let error = records.err().unwrap_or(Error::ENODATA);
        let other_error = lookup.other_error.replace(Some(error));

        let Some(mut lookup) = Rc::into_inner(lookup) else {
            return;
        };
        if let Error::ECANCELLED | Error::EDESTRUCTION = error {
            return self.answer(lookup.request, Err(error));
        }
        let found = lookup.found.take();
        if !found.is_empty() {
            return self.answer_addresses(lookup.request, found);
        }

        let error = match (kind, error, other_error.unwrap_or(error)) {
            (RecordType::A, a, aaaa) | (_, aaaa, a) => {
                lookup.had_no_data |= a == Error::ENODATA || aaaa == Error::ENODATA;
                match (a, aaaa) {
                    (none @ Error::ENODATA, refusal)
                    | (refusal, none @ (Error::ENOTFOUND | Error::ENODATA))
                        if is_refusal(refusal) =>
                    {
                        lookup.refusal.get_or_insert(refusal);
                        none
                    }
                    (Error::ENODATA, error) | (error, _) => error,
                }
            }
        };
        let goes_on = match error {
            Error::ENOTFOUND | Error::ENODATA => true,
            // systemd-resolved refuses a single label: https://github.com/c-ares/c-ares/issues/852
            Error::ESERVFAIL | Error::EREFUSED => !strings::contains_char(lookup.candidate(), b'.'),
            _ => false,
        };
        if !goes_on {
            return self.answer(lookup.request, Err(error));
        }
        lookup.candidates.pop();
        lookup.other_error.set(None);
        let no_data = lookup.had_no_data.then_some(Error::ENODATA);
        let error = lookup.refusal.or(no_data).unwrap_or(error);
        self.look_for_addresses(lookup, error);
    }

    /// From the hosts file, it is the aliases as in Node.js, or else the canonical name.
    #[must_use]
    pub fn reverse(&mut self, ip: IpAddr, request: R) -> Answers<R> {
        self.lookup_names(ip, None, request)
    }

    #[must_use]
    pub fn name_info(&mut self, ip: IpAddr, port: u16, request: R) -> Answers<R> {
        self.lookup_names(ip, Some(port), request)
    }

    fn lookup_names(&mut self, ip: IpAddr, port: Option<u16>, request: R) -> Answers<R> {
        let sources = self.config.sources;
        self.call(|this| {
            this.look_for_names(NameLookup {
                request,
                ip,
                port,
                sources,
            });
        })
    }

    fn look_for_names(&mut self, mut lookup: NameLookup<R>) {
        while let &[source, ref rest @ ..] = lookup.sources {
            lookup.sources = rest;
            if source == Source::Dns {
                let name = reverse_name(lookup.ip);
                return self.ask(&name, RecordType::PTR, Purpose::Names(lookup));
            }
            if let [host, aliases @ ..] = self.hosts().names(lookup.ip) {
                let reply = match lookup.port {
                    Some(port) => name_info(host.clone(), port, &self.system),
                    None if aliases.is_empty() => Reply::Names(vec![host.clone()]),
                    None => Reply::Names(aliases.to_vec()),
                };
                return self.answer(lookup.request, Ok(reply));
            }
        }
        self.answer(lookup.request, Err(Error::ENOTFOUND));
    }

    pub(crate) fn got_names(&mut self, lookup: NameLookup<R>, outcome: Outcome) {
        let records = match outcome.and_then(Message::into_records) {
            Ok(records) => records,
            Err(error @ (Error::ECANCELLED | Error::EDESTRUCTION)) => {
                return self.answer(lookup.request, Err(error));
            }
            Err(_) => return self.look_for_names(lookup),
        };
        let mut text = Vec::new();
        let hosts = records
            .of(RecordType::PTR)
            .filter_map(|record| match record {
                Record::Name(name) if name.is_hostname() => {
                    name.write_to(&mut text);
                    (!text.is_empty()).then(|| text.as_slice().into())
                }
                _ => None,
            });
        let mut hosts: Vec<Box<[u8]>> = hosts.collect();
        let reply = match lookup.port {
            Some(port) => hosts.pop().map(|host| name_info(host, port, &self.system)),
            None => (!hosts.is_empty()).then_some(Reply::Names(hosts)),
        };
        match reply {
            Some(reply) => self.answer(lookup.request, Ok(reply)),
            None => self.look_for_names(lookup),
        }
    }
}

fn name_info(host: Box<[u8]>, port: u16, system: &impl System) -> Reply {
    let number = || bun_core::fmt::itoa(&mut Default::default(), port).into();
    let service = (port != 0).then(|| system.service_name(port).unwrap_or_else(number));
    Reply::NameInfo { host, service }
}
