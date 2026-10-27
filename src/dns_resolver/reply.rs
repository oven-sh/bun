//! What `dns.resolve*()` reports of an answer: c-ares's `ares_parse_*_reply()`.

use core::net::IpAddr;

use crate::addr_info::{AddrInfo, Family};
pub use crate::message::{Caa, Mx, Naptr, Soa, Srv};
use crate::message::{Message, Name, RData, Rr, class, rr_type};
use crate::{Error, Result};

/// Bun gave `ares_parse_a_reply()` room for this many TTLs, so `ttl` is `undefined` from the 257th address on.
const MAX_TTLS: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum RecordType {
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

bun_core::comptime_string_map! {
    static RECORD_TYPES: RecordType = {
        b"A" => RecordType::A, b"AAAA" => RecordType::Aaaa, b"ANY" => RecordType::Any,
        b"CAA" => RecordType::Caa, b"CNAME" => RecordType::Cname, b"MX" => RecordType::Mx,
        b"NAPTR" => RecordType::Naptr, b"NS" => RecordType::Ns, b"PTR" => RecordType::Ptr,
        b"SOA" => RecordType::Soa, b"SRV" => RecordType::Srv, b"TXT" => RecordType::Txt,
        b"a" => RecordType::A, b"aaaa" => RecordType::Aaaa, b"any" => RecordType::Any,
        b"caa" => RecordType::Caa, b"cname" => RecordType::Cname, b"mx" => RecordType::Mx,
        b"naptr" => RecordType::Naptr, b"ns" => RecordType::Ns, b"ptr" => RecordType::Ptr,
        b"soa" => RecordType::Soa, b"srv" => RecordType::Srv, b"txt" => RecordType::Txt,
    };
}

impl RecordType {
    /// As `dns.resolve()` spells it, in upper or in lower case.
    pub fn from_name(name: &[u8]) -> Option<RecordType> {
        RECORD_TYPES.get(name).copied()
    }

    pub(crate) fn rr_type(self) -> u16 {
        match self {
            RecordType::A => rr_type::A,
            RecordType::Aaaa => rr_type::AAAA,
            RecordType::Any => rr_type::ANY,
            RecordType::Caa => rr_type::CAA,
            RecordType::Cname => rr_type::CNAME,
            RecordType::Mx => rr_type::MX,
            RecordType::Naptr => rr_type::NAPTR,
            RecordType::Ns => rr_type::NS,
            RecordType::Ptr => rr_type::PTR,
            RecordType::Soa => rr_type::SOA,
            RecordType::Srv => rr_type::SRV,
            RecordType::Txt => rr_type::TXT,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Address {
    pub address: IpAddr,
    /// No more than the lowest TTL of the CNAMEs. `None` after the first [`MAX_TTLS`] addresses.
    pub ttl: Option<i32>,
}

/// The addresses of one family, and what a `struct hostent` says besides.
#[derive(Debug, PartialEq, Eq)]
pub struct Addresses {
    /// The target of the first CNAME, else the name asked for.
    pub name: Option<Name>,
    pub addresses: Vec<Address>,
}

/// Every list may be empty: an answer with records, none of them of the type.
#[derive(Debug, PartialEq, Eq)]
pub enum Reply {
    Addresses(Addresses),
    Any(Box<AnyReply>),
    Caa(Vec<Caa>),
    Mx(Vec<Mx>),
    Naptr(Vec<Naptr>),
    /// NS, PTR, and the one name of CNAME.
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

fn addresses(response: &Message, family: Family) -> Result<Addresses> {
    let mut info = AddrInfo::default();
    info.add_response(response, false, 0)?;

    let lowest_alias_ttl = info.aliases.iter().map(|alias| alias.ttl).min();
    let addresses: Vec<Address> = info
        .nodes
        .iter()
        .filter(|node| Family::of(&node.address) == family)
        .enumerate()
        .map(|(index, node)| Address {
            address: node.address,
            ttl: (index < MAX_TTLS).then(|| node.ttl.min(lowest_alias_ttl.unwrap_or(i32::MAX))),
        })
        .collect();
    if addresses.is_empty() && info.aliases.is_empty() {
        return Err(Error::ENODATA);
    }
    let name = match info.aliases.first() {
        Some(alias) => Some(alias.target.clone()),
        None => info.name,
    };
    Ok(Addresses { name, addresses })
}

/// What `pick` takes of the answer's records of class IN (and CHAOS, for the two types c-ares also takes it for).
fn list<'a, T: 'a>(
    response: &'a Message,
    chaos_too: bool,
    pick: impl Fn(&'a RData) -> Option<&'a T>,
) -> Result<impl Iterator<Item = &'a T>> {
    if response.answer.is_empty() {
        return Err(Error::ENODATA);
    }
    let in_class = move |rr: &&Rr| rr.class == class::IN || (chaos_too && rr.class == class::CHAOS);
    let records = response.answer.iter().filter(in_class);
    Ok(records.filter_map(move |rr| pick(&rr.data)))
}

/// [`list`], but none found is `ENODATA`.
fn names(response: &Message, pick: impl Fn(&RData) -> Option<&Name>) -> Result<Vec<Name>> {
    let found: Vec<Name> = list(response, false, pick)?.cloned().collect();
    if found.is_empty() {
        return Err(Error::ENODATA);
    }
    Ok(found)
}

fn ns(response: &Message) -> Result<Vec<Name>> {
    names(response, |data| match data {
        RData::Ns(name) => Some(name),
        _ => None,
    })
}

pub(crate) fn ptr(response: &Message) -> Result<Vec<Name>> {
    names(response, |data| match data {
        RData::Ptr(name) => Some(name),
        _ => None,
    })
}

fn caa(response: &Message) -> Result<Vec<Caa>> {
    let found = list(response, true, |data| match data {
        RData::Caa(caa) => Some(caa),
        _ => None,
    })?;
    Ok(found.cloned().collect())
}

fn mx(response: &Message) -> Result<Vec<Mx>> {
    let found = list(response, false, |data| match data {
        RData::Mx(mx) => Some(mx),
        _ => None,
    })?;
    Ok(found.cloned().collect())
}

fn naptr(response: &Message) -> Result<Vec<Naptr>> {
    let found = list(response, false, |data| match data {
        RData::Naptr(naptr) => Some(naptr),
        _ => None,
    })?;
    Ok(found.cloned().collect())
}

fn srv(response: &Message) -> Result<Vec<Srv>> {
    let found = list(response, false, |data| match data {
        RData::Srv(srv) => Some(srv),
        _ => None,
    })?;
    Ok(found.cloned().collect())
}

fn txt(response: &Message) -> Result<Vec<Vec<u8>>> {
    let found = list(response, true, |data| match data {
        RData::Txt(strings) => Some(strings),
        _ => None,
    })?;
    Ok(found.flatten().cloned().collect())
}

fn soa(response: &Message) -> Result<Soa> {
    response
        .answer
        .iter()
        .filter(|rr| rr.class == class::IN)
        .find_map(|rr| match &rr.data {
            RData::Soa(soa) => Some(soa.clone()),
            _ => None,
        })
        .ok_or(Error::EBADRESP)
}

fn any(response: &Message) -> Result<AnyReply> {
    let mut last_error = None;
    let mut keep = |error: Error| {
        last_error = Some(error);
    };
    let reply = AnyReply {
        a: addresses(response, Family::V4).map_err(&mut keep).ok(),
        aaaa: addresses(response, Family::V6).map_err(&mut keep).ok(),
        mx: mx(response).map_err(&mut keep).ok(),
        ns: ns(response).map_err(&mut keep).ok(),
        txt: txt(response).map_err(&mut keep).ok(),
        srv: srv(response).map_err(&mut keep).ok(),
        ptr: ptr(response).map_err(&mut keep).ok(),
        naptr: naptr(response).map_err(&mut keep).ok(),
        soa: soa(response).map_err(&mut keep).ok(),
        caa: caa(response).map_err(&mut keep).ok(),
    };
    match last_error {
        Some(error) if reply == AnyReply::default() => Err(error),
        _ => Ok(reply),
    }
}

impl Reply {
    /// Reads `bytes`, the response to a query for `record_type`.
    pub(crate) fn parse(record_type: RecordType, bytes: &[u8]) -> Result<Reply> {
        let response = match Message::parse(bytes) {
            Ok(response) => response,
            // `ares_parse_{a,aaaa,ns,ptr,soa}_reply()` report a bad name so.
            Err(Error::EBADNAME)
                if matches!(
                    record_type,
                    RecordType::A
                        | RecordType::Aaaa
                        | RecordType::Cname
                        | RecordType::Ns
                        | RecordType::Ptr
                        | RecordType::Soa
                ) =>
            {
                return Err(Error::EBADRESP);
            }
            Err(error) => return Err(error),
        };
        Ok(match record_type {
            RecordType::A => Reply::Addresses(addresses(&response, Family::V4)?),
            // As Node.js does it: `ares_parse_a_reply()`, of which only the host's name is used.
            RecordType::Cname => {
                Reply::Names(Vec::from_iter(addresses(&response, Family::V4)?.name))
            }
            RecordType::Aaaa => Reply::Addresses(addresses(&response, Family::V6)?),
            RecordType::Any => Reply::Any(Box::new(any(&response)?)),
            RecordType::Caa => Reply::Caa(caa(&response)?),
            RecordType::Mx => Reply::Mx(mx(&response)?),
            RecordType::Naptr => Reply::Naptr(naptr(&response)?),
            RecordType::Ns => Reply::Names(ns(&response)?),
            RecordType::Ptr => Reply::Names(ptr(&response)?),
            RecordType::Soa => Reply::Soa(soa(&response)?),
            RecordType::Srv => Reply::Srv(srv(&response)?),
            RecordType::Txt => Reply::Txt(txt(&response)?),
        })
    }
}
