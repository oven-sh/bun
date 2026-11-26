//! Queries and replies on the wire (RFC 1035 §4).

use core::net::IpAddr;
use std::rc::Rc;

use crate::Error;
use crate::name::{self, Name};
use crate::system::Transport;

/// The types that can be asked for, with their values on the wire.
#[repr(u16)]
#[derive(
    Copy, Clone, Eq, PartialEq, Debug, enum_map::Enum, strum::FromRepr, strum::IntoStaticStr,
)]
pub enum RecordType {
    A = 1,
    NS = 2,
    CNAME = 5,
    SOA = 6,
    PTR = 12,
    MX = 15,
    TXT = 16,
    AAAA = 28,
    SRV = 33,
    NAPTR = 35,
    TLSA = 52,
    ANY = 255,
    CAA = 257,
}

const CLASS_IN: u16 = 1;
const CLASS_CHAOS: u16 = 3;

impl RecordType {
    fn is_read_in(self, class: u16) -> bool {
        class == CLASS_IN || (class == CLASS_CHAOS && matches!(self, Self::TXT | Self::CAA))
    }

    fn bit(self) -> u16 {
        1 << enum_map::Enum::into_usize(self)
    }
}

const HEADER_LEN: usize = 12;
const FLAG_RESPONSE: u16 = 0x8000;
const FLAG_TRUNCATED: u16 = 0x0200;
const FLAG_RECURSION_DESIRED: u16 = 0x0100;
const OPCODE_MASK: u16 = 0x7800;
const RCODE_MASK: u16 = 0x000f;
const NOERROR: u16 = 0;
const FORMERR: u16 = 1;
const NXDOMAIN: u16 = 3;
const NOTIMP: u16 = 4;
const REFUSED: u16 = 5;

/// The name in lower case, the type and the class, as on the wire.
#[derive(Clone)]
pub(crate) struct Question {
    bytes: Rc<[u8]>,
    kind: RecordType,
    pub(crate) hash: u64,
}

impl Question {
    pub(crate) fn new(text: &[u8], kind: RecordType, seed: u64) -> Result<Self, Error> {
        let mut name = [0; name::MAX_LEN];
        let name = name::encode(text, &mut name).ok_or(Error::EBADNAME)?;
        if name::is_onion(name) {
            return Err(Error::ENOTFOUND);
        }
        let after = [kind as u16, CLASS_IN].map(u16::to_be_bytes);
        let name = name.iter().map(u8::to_ascii_lowercase);
        let bytes: Rc<[u8]> = name.chain(after.as_flattened().iter().copied()).collect();
        let hash = bun_wyhash::hash_with_seed(seed, &bytes);
        Ok(Self { bytes, kind, hash })
    }

    /// The same question, of which [`is`](Self::is) says that it is another one.
    pub(crate) fn detached(&self) -> Self {
        let bytes = (*self.bytes).into();
        Self { bytes, ..*self }
    }

    /// Whether one is a clone of the other.
    pub(crate) fn is(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.bytes, &other.bytes)
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// No length of a label, type or class that is asked for has the value of a letter.
    pub(crate) fn matches(&self, bytes: &[u8]) -> bool {
        self.bytes.eq_ignore_ascii_case(bytes)
    }

    /// Appends the message, for TCP behind its length.
    pub(crate) fn write_query(&self, id: u16, transport: Transport, to: &mut Vec<u8>) {
        let len = HEADER_LEN + self.bytes.len();
        to.reserve(2 + len);
        if transport == Transport::Tcp {
            to.extend_from_slice(&(len as u16).to_be_bytes());
        }
        let header = [id, FLAG_RECURSION_DESIRED, 1, 0, 0, 0].map(u16::to_be_bytes);
        to.extend_from_slice(header.as_flattened());
        to.extend_from_slice(&self.bytes);
    }
}

/// The message in the frame that `bytes` start with. They move past it if it is complete.
pub(crate) fn take_frame<'a>(bytes: &mut &'a [u8]) -> Option<&'a [u8]> {
    let (len, rest) = bytes.split_first_chunk()?;
    let (message, rest) = rest.split_at_checked(usize::from(u16::from_be_bytes(*len)))?;
    *bytes = rest;
    Some(message)
}

pub(crate) fn id_of(message: &[u8]) -> Option<u16> {
    message.first_chunk().copied().map(u16::from_be_bytes)
}

pub(crate) enum Received {
    Reply(Message),
    Truncated,
    Malformed,
}

#[derive(Clone)]
struct Reader<'a> {
    message: &'a [u8],
    /// Where `rest` is in `message`.
    at: usize,
    rest: &'a [u8],
}

impl<'a> Reader<'a> {
    fn new(message: &'a [u8], at: usize) -> Self {
        let rest = message.get(at..).unwrap_or_default();
        Self { message, at, rest }
    }

    fn bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        let bytes = self.rest.split_off(..len)?;
        self.at += len;
        Some(bytes)
    }

    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.bytes(N)?.first_chunk().copied()
    }

    fn u16(&mut self) -> Option<u16> {
        self.array().map(u16::from_be_bytes)
    }

    fn u32(&mut self) -> Option<u32> {
        self.array().map(u32::from_be_bytes)
    }

    /// Does not follow pointers.
    fn name(&mut self) -> Option<Name<'a>> {
        let (message, start) = (self.message, self.at);
        self.bytes(name::len_in_place(self.rest)?)?;
        Some(Name { message, start })
    }

    fn text(&mut self) -> Option<&'a [u8]> {
        let [len] = self.array()?;
        let text = self.bytes(len.into())?;
        (!text.iter().any(u8::is_ascii_control)).then_some(text)
    }

    fn ascii(&mut self) -> Option<&'a [u8]> {
        self.text().filter(|text| text.is_ascii())
    }

    fn strings(self) -> Option<Strings<'a>> {
        let strings = Strings(self.rest);
        let len: usize = strings.clone().map(|string| 1 + string.len()).sum();
        (len > 0 && len == self.rest.len()).then_some(strings)
    }

    fn resource(&mut self) -> Option<Resource<'a>> {
        self.name()?;
        let (kind, class, ttl, len) = (self.u16()?, self.u16()?, self.u32()?, self.u16()?);
        let data = Reader {
            message: self.message,
            at: self.at,
            rest: self.bytes(len.into())?,
        };
        Some(Resource {
            kind,
            class,
            ttl: ttl.min(i32::MAX as u32),
            data,
        })
    }
}

struct Resource<'a> {
    kind: u16,
    class: u16,
    ttl: u32,
    data: Reader<'a>,
}

impl Resource<'_> {
    fn is(&self, kind: RecordType) -> bool {
        self.kind == kind as u16 && kind.is_read_in(self.class)
    }
}

/// The strings of a TXT record.
#[derive(Clone)]
pub struct Strings<'a>(&'a [u8]);

impl<'a> Iterator for Strings<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        let (&len, rest) = self.0.split_first()?;
        let (string, rest) = rest.split_at_checked(len.into())?;
        self.0 = rest;
        Some(string)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Address {
    pub ip: IpAddr,
    pub ttl: u32,
}

impl Address {
    fn read(kind: RecordType, ttl: u32, data: &[u8]) -> Option<Self> {
        let ip = match kind {
            RecordType::A => <[u8; 4]>::try_from(data).map(IpAddr::from),
            _ => <[u8; 16]>::try_from(data).map(IpAddr::from),
        };
        ip.ok().map(|ip| Self { ip, ttl })
    }
}

pub enum Record<'a> {
    /// A and AAAA
    Address(Address),
    /// CNAME, NS and PTR
    Name(Name<'a>),
    Mx {
        preference: u16,
        exchange: Name<'a>,
    },
    Txt(Strings<'a>),
    Srv {
        priority: u16,
        weight: u16,
        port: u16,
        target: Name<'a>,
    },
    Naptr {
        order: u16,
        preference: u16,
        flags: &'a [u8],
        services: &'a [u8],
        regexp: &'a [u8],
        replacement: Name<'a>,
    },
    Soa {
        mname: Name<'a>,
        rname: Name<'a>,
        serial: u32,
        refresh: u32,
        retry: u32,
        expire: u32,
        minimum: u32,
    },
    Tlsa {
        cert_usage: u8,
        selector: u8,
        matching_type: u8,
        data: &'a [u8],
    },
    Caa {
        flags: u8,
        tag: &'a [u8],
        value: &'a [u8],
    },
}

impl<'a> Record<'a> {
    fn read(kind: RecordType, ttl: u32, mut data: Reader<'a>) -> Option<Self> {
        Some(match kind {
            RecordType::A | RecordType::AAAA => Self::Address(Address::read(kind, ttl, data.rest)?),
            RecordType::CNAME | RecordType::NS | RecordType::PTR => Self::Name(data.name()?),
            RecordType::MX => Self::Mx {
                preference: data.u16()?,
                exchange: data.name()?,
            },
            RecordType::TXT => Self::Txt(data.strings()?),
            RecordType::SRV => Self::Srv {
                priority: data.u16()?,
                weight: data.u16()?,
                port: data.u16()?,
                target: data.name()?,
            },
            RecordType::NAPTR => Self::Naptr {
                order: data.u16()?,
                preference: data.u16()?,
                flags: data.ascii()?,
                services: data.ascii()?,
                regexp: data.text()?,
                replacement: data.name()?,
            },
            RecordType::SOA => Self::Soa {
                mname: data.name()?,
                rname: data.name()?,
                serial: data.u32()?,
                refresh: data.u32()?,
                retry: data.u32()?,
                expire: data.u32()?,
                minimum: data.u32()?,
            },
            RecordType::TLSA => {
                let [cert_usage, selector, matching_type] = data.array()?;
                Self::Tlsa {
                    cert_usage,
                    selector,
                    matching_type,
                    data: Some(data.rest).filter(|data| !data.is_empty())?,
                }
            }
            RecordType::CAA => Self::Caa {
                flags: data.array().map(u8::from_be_bytes)?,
                tag: data.ascii().filter(|tag| !tag.is_empty())?,
                value: data.rest,
            },
            RecordType::ANY => return None,
        })
    }

    fn has_valid_names(&self) -> bool {
        match *self {
            Self::Address(_) | Self::Txt(_) | Self::Tlsa { .. } | Self::Caa { .. } => true,
            Self::Soa { mname, rname, .. } => mname.is_valid() && rname.is_valid(),
            Self::Name(name)
            | Self::Mx { exchange: name, .. }
            | Self::Srv { target: name, .. }
            | Self::Naptr {
                replacement: name, ..
            } => name.is_valid(),
        }
    }

    /// One that points to a host has to have the name of a host. A PTR can point to a service (RFC 6763 §4.1).
    fn is_usable(&self, kind: RecordType) -> bool {
        match *self {
            Self::Name(_) if kind == RecordType::PTR => true,
            Self::Name(name) if kind == RecordType::CNAME => name.is_alias_target(),
            Self::Name(host) | Self::Mx { exchange: host, .. } | Self::Srv { target: host, .. } => {
                host.is_hostname()
            }
            _ => true,
        }
    }
}

/// A reply in which what was asked for is well formed.
#[derive(Clone)]
pub(crate) struct Message {
    bytes: Rc<[u8]>,
    asked: RecordType,
    answers_at: usize,
    answer_count: u16,
    /// A [`RecordType::bit`] for each type of which the answer section has a record to use.
    answer_types: u16,
    rcode: u16,
    has_unusable: bool,
    /// `u32::MAX` without a CNAME.
    cname_ttl: u32,
    /// For how many seconds it holds.
    pub(crate) lifetime: u32,
    /// For how many it has been in the cache.
    pub(crate) age: u32,
}

impl Message {
    /// `None` if `bytes` are no reply to `question`. `is_final`: a truncated reply is all there is.
    pub(crate) fn receive(bytes: &[u8], question: &Question, is_final: bool) -> Option<Received> {
        let mut reader = Reader::new(bytes, 0);
        let [_, _, a, b, c, d, e, f, g, h, _, _] = reader.array::<HEADER_LEN>()?;
        let [flags, questions, answers, authorities] =
            [[a, b], [c, d], [e, f], [g, h]].map(u16::from_be_bytes);
        if flags & (FLAG_RESPONSE | OPCODE_MASK) != FLAG_RESPONSE {
            return None;
        }
        // Some servers refuse without repeating the question.
        if questions != 0 && !question.matches(reader.bytes(question.bytes.len())?) {
            return None;
        }
        if questions != 1 {
            return Some(Received::Malformed);
        }
        if flags & FLAG_TRUNCATED != 0 && !is_final {
            return Some(Received::Truncated);
        }
        let message = Self::parse(reader, question.kind, flags, answers, authorities);
        Some(message.map_or(Received::Malformed, Received::Reply))
    }

    /// `reader` is behind the question.
    fn parse(
        mut reader: Reader<'_>,
        asked: RecordType,
        flags: u16,
        answer_count: u16,
        authority_count: u16,
    ) -> Option<Self> {
        let answers_at = reader.at;
        let (mut answer_types, mut has_unusable) = (0, false);
        let (mut cname_ttl, mut lifetime) = (u32::MAX, u32::MAX);
        for _ in 0..answer_count {
            let resource = reader.resource()?;
            lifetime = lifetime.min(resource.ttl);
            if resource.is(RecordType::CNAME) {
                cname_ttl = cname_ttl.min(resource.ttl);
            }
            let kind = match asked {
                RecordType::ANY => RecordType::from_repr(resource.kind),
                _ => Some(asked),
            };
            if let Some(kind) = kind.filter(|&kind| resource.is(kind)) {
                let record = Record::read(kind, resource.ttl, resource.data)
                    .filter(Record::has_valid_names)?;
                // The next alias is not that of the name that was asked for.
                if record.is_usable(kind) && !(has_unusable && kind == RecordType::CNAME) {
                    answer_types |= kind.bit();
                } else {
                    has_unusable = true;
                }
            }
        }

        let rcode = flags & RCODE_MASK;
        if flags & FLAG_TRUNCATED != 0 || !matches!(rcode, NOERROR | NXDOMAIN) {
            lifetime = 0;
        } else if rcode == NXDOMAIN || answer_types == 0 {
            lifetime = lifetime.min(negative_ttl(reader.clone(), authority_count).unwrap_or(0));
        }
        Some(Self {
            bytes: reader.message.into(),
            asked,
            answers_at,
            answer_count,
            answer_types,
            rcode,
            has_unusable,
            cname_ttl,
            lifetime,
            age: 0,
        })
    }

    pub(crate) fn len(&self) -> usize {
        self.bytes.len()
    }

    pub(crate) fn question(&self) -> &[u8] {
        let question = self.bytes.get(HEADER_LEN..self.answers_at);
        question.unwrap_or_default()
    }

    /// `Some` for an error response. NXDOMAIN is none: it answers the question (RFC 9520 §2).
    pub(crate) fn rcode_error(&self) -> Option<Error> {
        Some(match self.rcode {
            NOERROR | NXDOMAIN => return None,
            FORMERR => Error::EFORMERR,
            NOTIMP => Error::ENOTIMP,
            REFUSED => Error::EREFUSED,
            _ => Error::ESERVFAIL,
        })
    }

    pub(crate) fn has_answers(&self) -> bool {
        self.answer_count > 0
    }

    pub(crate) fn is_refusal(&self) -> bool {
        self.rcode == REFUSED
    }

    /// As in Node.js, it depends on the type whether an empty list is an error.
    pub(crate) fn into_records(self) -> Result<Records, Error> {
        use RecordType::*;
        Err(match (self.rcode, self.asked) {
            (NOERROR, _) if self.answer_count == 0 => Error::ENODATA,
            (NOERROR, _) if self.answer_types != 0 => return Ok(Records(self)),
            (NOERROR, A | AAAA) if self.cname_ttl != u32::MAX => return Ok(Records(self)),
            // RFC 5321 §5.1
            (NOERROR, MX | SRV | NS | CNAME) if self.has_unusable => Error::EBADRESP,
            (NOERROR, MX | TXT | SRV | NAPTR | TLSA | ANY | CAA) => return Ok(Records(self)),
            (NOERROR, SOA) => Error::EBADRESP,
            (NOERROR, _) => Error::ENODATA,
            _ => self.rcode_error().unwrap_or(Error::ENOTFOUND),
        })
    }
}

/// RFC 2308 §5
fn negative_ttl(mut authorities: Reader<'_>, count: u16) -> Option<u32> {
    let mut authorities = (0..count).map_while(|_| authorities.resource());
    let mut soa = authorities.find(|resource| resource.is(RecordType::SOA))?;
    soa.data.name()?;
    soa.data.name()?;
    soa.data.array::<16>()?;
    Some(soa.data.u32()?.min(soa.ttl))
}

/// The answer section of a reply.
pub struct Records(Message);

impl Records {
    pub fn asked(&self) -> RecordType {
        self.0.asked
    }

    pub fn of(&self, kind: RecordType) -> impl Iterator<Item = Record<'_>> {
        let records = self.resources(kind);
        records
            .filter_map(move |(ttl, data)| Record::read(kind, ttl, data))
            .filter(move |record| !self.0.has_unusable || record.is_usable(kind))
    }

    /// In reply to A or AAAA.
    pub fn addresses(&self) -> impl Iterator<Item = Address> {
        let records = self.resources(self.asked());
        records.filter_map(|(ttl, data)| Address::read(self.asked(), ttl, data.rest))
    }

    /// A record holds no longer than the aliases that lead to it.
    fn resources(&self, kind: RecordType) -> impl Iterator<Item = (u32, Reader<'_>)> {
        let message = &self.0;
        let mut reader = Reader::new(&message.bytes, message.answers_at);
        let count = if message.answer_types & kind.bit() != 0 {
            message.answer_count
        } else {
            0
        };
        (0..count)
            .map_while(move |_| reader.resource())
            .filter(move |resource| resource.is(kind))
            .map(|Resource { ttl, data, .. }| {
                (ttl.min(message.cname_ttl).saturating_sub(message.age), data)
            })
    }
}
