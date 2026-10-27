//! What `dns.resolve*()` reports of an answer: c-ares's `ares_parse_*_reply()`.

use core::net::IpAddr;

use crate::addrinfo::{AddrInfo, Family};
use crate::record::{Name, RData, Record, Rr, class, rr_type};
use crate::{Error, Result};

/// `ares_parse_a_reply()` is given room for this many TTLs.
const MAX_TTLS: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Kind {
    A,
    Aaaa,
    Any,
    Caa,
    Cname,
    Mx,
    Naptr,
    Ns,
    Ptr,
    Soa,
    Srv,
    Txt,
}

impl Kind {
    pub fn rr_type(self) -> u16 {
        match self {
            Kind::A => rr_type::A,
            Kind::Aaaa => rr_type::AAAA,
            Kind::Any => rr_type::ANY,
            Kind::Caa => rr_type::CAA,
            Kind::Cname => rr_type::CNAME,
            Kind::Mx => rr_type::MX,
            Kind::Naptr => rr_type::NAPTR,
            Kind::Ns => rr_type::NS,
            Kind::Ptr => rr_type::PTR,
            Kind::Soa => rr_type::SOA,
            Kind::Srv => rr_type::SRV,
            Kind::Txt => rr_type::TXT,
        }
    }
}

/// The addresses of one family, and what a `struct hostent` says besides.
#[derive(Debug, PartialEq, Eq)]
pub struct Addresses {
    /// The target of the first CNAME, else the last name the answer is about.
    pub name: Option<Name>,
    pub addresses: Vec<IpAddr>,
    /// For the first [`MAX_TTLS`] of `addresses`. No more than the lowest TTL of the CNAMEs.
    pub ttls: Vec<i32>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Caa {
    pub critical: u8,
    pub property: Vec<u8>,
    pub value: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Mx {
    pub priority: u16,
    pub host: Name,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Srv {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub host: Name,
}

pub use crate::record::{Naptr, Soa};

/// Every list may be empty: an answer with records, none of them of the type.
#[derive(Debug, PartialEq, Eq)]
pub enum Reply {
    Addresses(Addresses),
    Any(Box<AnyReply>),
    Caa(Vec<Caa>),
    Mx(Vec<Mx>),
    Naptr(Vec<Naptr>),
    /// NS and PTR.
    Names(Vec<Name>),
    Soa(Soa),
    Srv(Vec<Srv>),
    /// One entry for each character-string, not for each record.
    Txt(Vec<Vec<u8>>),
}

/// Each type's reading of one answer. `None` where that reading fails.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct AnyReply {
    pub a: Option<Addresses>,
    pub aaaa: Option<Addresses>,
    pub mx: Option<Vec<Mx>>,
    pub ns: Option<Vec<Name>>,
    pub txt: Option<Vec<Vec<u8>>>,
    pub srv: Option<Vec<Srv>>,
    pub ptr: Option<Vec<Name>>,
    pub naptr: Option<Vec<Naptr>>,
    pub soa: Option<Soa>,
    pub caa: Option<Vec<Caa>>,
}

fn addresses(record: &Record, family: Family) -> Result<Addresses> {
    let mut info = AddrInfo::default();
    match info.add_answer(record, false, 0) {
        Ok(()) | Err(Error::ENODATA) => {}
        Err(error) => return Err(error),
    }

    let of_family = || {
        info.nodes
            .iter()
            .filter(|node| Family::of(&node.address) == family)
    };
    let addresses: Vec<IpAddr> = of_family().map(|node| node.address).collect();
    if addresses.is_empty() && info.aliases.is_empty() {
        return Err(Error::ENODATA);
    }
    let lowest_alias_ttl = info.aliases.iter().map(|alias| alias.ttl).min();
    let ttls = of_family()
        .take(MAX_TTLS)
        .map(|node| node.ttl.min(lowest_alias_ttl.unwrap_or(i32::MAX)))
        .collect();
    let name = match info.aliases.first() {
        Some(alias) => Some(alias.name.clone()),
        None => info.name,
    };
    Ok(Addresses {
        name,
        addresses,
        ttls,
    })
}

/// The answer's records of class IN (and CHAOS, for the two types c-ares also takes it for) that `pick` takes.
fn list<T>(
    record: &Record,
    chaos_too: bool,
    mut pick: impl FnMut(&RData, &mut Vec<T>),
) -> Result<Vec<T>> {
    if record.answer.is_empty() {
        return Err(Error::ENODATA);
    }
    let mut found = Vec::new();
    let in_class = |rr: &&Rr| rr.class == class::IN || (chaos_too && rr.class == class::CHAOS);
    for rr in record.answer.iter().filter(in_class) {
        pick(&rr.data, &mut found);
    }
    Ok(found)
}

/// As [`list`], for the types an answer without which is no data.
fn names(record: &Record, pick: impl Fn(&RData) -> Option<&Name>) -> Result<Vec<Name>> {
    let found = list(record, false, |data, found| {
        found.extend(pick(data).cloned())
    })?;
    if found.is_empty() {
        return Err(Error::ENODATA);
    }
    Ok(found)
}

fn ns(record: &Record) -> Result<Vec<Name>> {
    names(record, |data| match data {
        RData::Ns(name) => Some(name),
        _ => None,
    })
}

pub(crate) fn ptr(record: &Record) -> Result<Vec<Name>> {
    names(record, |data| match data {
        RData::Ptr(name) => Some(name),
        _ => None,
    })
}

fn caa(record: &Record) -> Result<Vec<Caa>> {
    list(record, true, |data, found| {
        if let RData::Caa {
            critical,
            tag,
            value,
        } = data
        {
            found.push(Caa {
                critical: *critical,
                property: tag.clone(),
                value: value.clone(),
            });
        }
    })
}

fn mx(record: &Record) -> Result<Vec<Mx>> {
    list(record, false, |data, found| {
        if let RData::Mx {
            preference,
            exchange,
        } = data
        {
            found.push(Mx {
                priority: *preference,
                host: exchange.clone(),
            });
        }
    })
}

fn naptr(record: &Record) -> Result<Vec<Naptr>> {
    list(record, false, |data, found| {
        if let RData::Naptr(naptr) = data {
            found.push(naptr.clone());
        }
    })
}

fn srv(record: &Record) -> Result<Vec<Srv>> {
    list(record, false, |data, found| {
        if let RData::Srv {
            priority,
            weight,
            port,
            target,
        } = data
        {
            found.push(Srv {
                priority: *priority,
                weight: *weight,
                port: *port,
                host: target.clone(),
            });
        }
    })
}

fn txt(record: &Record) -> Result<Vec<Vec<u8>>> {
    list(record, true, |data, found| {
        if let RData::Txt(strings) = data {
            found.extend(strings.iter().cloned());
        }
    })
}

fn soa(record: &Record) -> Result<Soa> {
    record
        .answer
        .iter()
        .filter(|rr| rr.class == class::IN)
        .find_map(|rr| match &rr.data {
            RData::Soa(soa) => Some(soa.clone()),
            _ => None,
        })
        .ok_or(Error::EBADRESP)
}

fn any(record: &Record) -> Result<AnyReply> {
    let mut last_error = None;
    let mut keep = |error: Error| {
        last_error = Some(error);
    };
    let reply = AnyReply {
        a: addresses(record, Family::V4).map_err(&mut keep).ok(),
        aaaa: addresses(record, Family::V6).map_err(&mut keep).ok(),
        mx: mx(record).map_err(&mut keep).ok(),
        ns: ns(record).map_err(&mut keep).ok(),
        txt: txt(record).map_err(&mut keep).ok(),
        srv: srv(record).map_err(&mut keep).ok(),
        ptr: ptr(record).map_err(&mut keep).ok(),
        naptr: naptr(record).map_err(&mut keep).ok(),
        soa: soa(record).map_err(&mut keep).ok(),
        caa: caa(record).map_err(&mut keep).ok(),
    };
    match last_error {
        Some(error) if reply == AnyReply::default() => Err(error),
        _ => Ok(reply),
    }
}

impl Reply {
    /// Reads `message`, the answer to a query of `kind`.
    pub fn parse(kind: Kind, message: &[u8]) -> Result<Reply> {
        let record = match Record::parse(message) {
            Ok(record) => record,
            // These five never report a bad name.
            Err(Error::EBADNAME)
                if matches!(
                    kind,
                    Kind::A | Kind::Aaaa | Kind::Cname | Kind::Ns | Kind::Ptr | Kind::Soa
                ) =>
            {
                return Err(Error::EBADRESP);
            }
            Err(error) => return Err(error),
        };
        Ok(match kind {
            Kind::A | Kind::Cname => Reply::Addresses(addresses(&record, Family::V4)?),
            Kind::Aaaa => Reply::Addresses(addresses(&record, Family::V6)?),
            Kind::Any => Reply::Any(Box::new(any(&record)?)),
            Kind::Caa => Reply::Caa(caa(&record)?),
            Kind::Mx => Reply::Mx(mx(&record)?),
            Kind::Naptr => Reply::Naptr(naptr(&record)?),
            Kind::Ns => Reply::Names(ns(&record)?),
            Kind::Ptr => Reply::Names(ptr(&record)?),
            Kind::Soa => Reply::Soa(soa(&record)?),
            Kind::Srv => Reply::Srv(srv(&record)?),
            Kind::Txt => Reply::Txt(txt(&record)?),
        })
    }
}
