//! DNS messages (RFC 1035 section 4) as values.

mod name;
mod parse;
mod write;

const MAX_MESSAGE_LEN: usize = 0xffff;

/// A domain name in presentation form: labels joined by `.`, with `\` before `".;\()@$` and `\DDD`
/// for a byte that does not print. No trailing dot; the root is empty.
pub(crate) type Name = Vec<u8>;

pub(crate) mod rr_type {
    pub(crate) const A: u16 = 1;
    pub(crate) const NS: u16 = 2;
    pub(crate) const CNAME: u16 = 5;
    pub(crate) const SOA: u16 = 6;
    pub(crate) const PTR: u16 = 12;
    pub(crate) const HINFO: u16 = 13;
    pub(crate) const MX: u16 = 15;
    pub(crate) const TXT: u16 = 16;
    pub(crate) const SIG: u16 = 24;
    pub(crate) const AAAA: u16 = 28;
    pub(crate) const SRV: u16 = 33;
    pub(crate) const NAPTR: u16 = 35;
    pub(crate) const OPT: u16 = 41;
    pub(crate) const TLSA: u16 = 52;
    pub(crate) const SVCB: u16 = 64;
    pub(crate) const HTTPS: u16 = 65;
    pub(crate) const ANY: u16 = 255;
    pub(crate) const URI: u16 = 256;
    pub(crate) const CAA: u16 = 257;
}

pub(crate) mod class {
    pub(crate) const IN: u16 = 1;
    pub(crate) const CHAOS: u16 = 3;
    pub(crate) const HESIOD: u16 = 4;
    pub(crate) const NONE: u16 = 254;
    pub(crate) const ANY: u16 = 255;
}

pub(crate) mod rcode {
    pub(crate) const NOERROR: u16 = 0;
    pub(crate) const FORMERR: u16 = 1;
    pub(crate) const SERVFAIL: u16 = 2;
    pub(crate) const NXDOMAIN: u16 = 3;
    pub(crate) const NOTIMP: u16 = 4;
    pub(crate) const REFUSED: u16 = 5;
    /// DSOTYPEI, the last of RFC 1035's four bits that is assigned.
    pub(crate) const LAST_BASIC: u16 = 11;
    pub(crate) const BADSIG: u16 = 16;
    pub(crate) const BADCOOKIE: u16 = 23;
}

/// The header's flag bits, at their places in the second 16 bits of a message.
pub(crate) mod flag {
    pub(crate) const QR: u16 = 0x8000;
    pub(crate) const AA: u16 = 0x0400;
    pub(crate) const TC: u16 = 0x0200;
    pub(crate) const RD: u16 = 0x0100;
    pub(crate) const RA: u16 = 0x0080;
    pub(crate) const AD: u16 = 0x0020;
    pub(crate) const CD: u16 = 0x0010;
    pub(crate) const ALL: u16 = QR | AA | TC | RD | RA | AD | CD;
}

#[derive(Clone)]
pub(crate) struct Question {
    pub(crate) name: Name,
    pub(crate) qtype: u16,
    pub(crate) qclass: u16,
}

/// One EDNS option or SVCB parameter.
#[derive(Clone)]
pub(crate) struct OptionValue {
    pub(crate) id: u16,
    pub(crate) value: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mx {
    pub preference: u16,
    pub exchange: Name,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Srv {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub target: Name,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Caa {
    pub critical: u8,
    pub tag: Vec<u8>,
    pub value: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Soa {
    pub mname: Name,
    pub rname: Name,
    pub serial: u32,
    pub refresh: u32,
    pub retry: u32,
    pub expire: u32,
    pub minimum: u32,
}

#[derive(Clone)]
pub(crate) struct Sig {
    pub(crate) type_covered: u16,
    pub(crate) algorithm: u8,
    pub(crate) labels: u8,
    pub(crate) original_ttl: u32,
    pub(crate) expiration: u32,
    pub(crate) inception: u32,
    pub(crate) key_tag: u16,
    pub(crate) signers_name: Name,
    pub(crate) signature: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Naptr {
    pub order: u16,
    pub preference: u16,
    pub flags: Vec<u8>,
    pub services: Vec<u8>,
    pub regexp: Vec<u8>,
    pub replacement: Name,
}

/// SVCB and HTTPS have one shape.
#[derive(Clone)]
pub(crate) struct Svcb {
    pub(crate) priority: u16,
    pub(crate) target: Name,
    pub(crate) params: Vec<OptionValue>,
}

#[derive(Clone)]
pub(crate) enum RData {
    A([u8; 4]),
    Ns(Name),
    Cname(Name),
    Soa(Soa),
    Ptr(Name),
    Hinfo {
        cpu: Vec<u8>,
        os: Vec<u8>,
    },
    Mx(Mx),
    /// The character-strings of the record, at least one.
    Txt(Vec<Vec<u8>>),
    Sig(Sig),
    Aaaa([u8; 16]),
    Srv(Srv),
    Naptr(Naptr),
    Opt {
        udp_size: u16,
        version: u8,
        flags: u16,
        options: Vec<OptionValue>,
    },
    Tlsa {
        cert_usage: u8,
        selector: u8,
        matching: u8,
        data: Vec<u8>,
    },
    Svcb(Svcb),
    Https(Svcb),
    Uri {
        priority: u16,
        weight: u16,
        target: Vec<u8>,
    },
    Caa(Caa),
    /// A type this crate does not read. [`Message::write`] refuses RDATA of no bytes, as c-ares
    /// does.
    Raw {
        rr_type: u16,
        data: Vec<u8>,
    },
}

impl RData {
    pub(crate) fn rr_type(&self) -> u16 {
        match self {
            RData::A(_) => rr_type::A,
            RData::Ns(_) => rr_type::NS,
            RData::Cname(_) => rr_type::CNAME,
            RData::Soa(_) => rr_type::SOA,
            RData::Ptr(_) => rr_type::PTR,
            RData::Hinfo { .. } => rr_type::HINFO,
            RData::Mx(_) => rr_type::MX,
            RData::Txt(_) => rr_type::TXT,
            RData::Sig(_) => rr_type::SIG,
            RData::Aaaa(_) => rr_type::AAAA,
            RData::Srv(_) => rr_type::SRV,
            RData::Naptr(_) => rr_type::NAPTR,
            RData::Opt { .. } => rr_type::OPT,
            RData::Tlsa { .. } => rr_type::TLSA,
            RData::Svcb(_) => rr_type::SVCB,
            RData::Https(_) => rr_type::HTTPS,
            RData::Uri { .. } => rr_type::URI,
            RData::Caa(_) => rr_type::CAA,
            RData::Raw { rr_type, .. } => *rr_type,
        }
    }
}

#[derive(Clone)]
pub(crate) struct Rr {
    pub(crate) name: Name,
    pub(crate) class: u16,
    pub(crate) ttl: u32,
    pub(crate) data: RData,
}

impl Rr {
    fn is_opt(&self) -> bool {
        matches!(self.data, RData::Opt { .. })
    }
}

#[derive(Clone)]
pub(crate) struct Message {
    pub(crate) id: u16,
    /// Bits of [`flag`].
    pub(crate) flags: u16,
    pub(crate) opcode: u8,
    /// With the eight high bits an OPT record adds. One that is not assigned reads as SERVFAIL.
    pub(crate) rcode: u16,
    pub(crate) question: Question,
    pub(crate) answer: Vec<Rr>,
    pub(crate) authority: Vec<Rr>,
    pub(crate) additional: Vec<Rr>,
}

impl Message {
    /// A recursive query for one name.
    pub(crate) fn query(name: &[u8], qtype: u16) -> Message {
        Message {
            id: 0,
            flags: flag::RD,
            opcode: 0,
            rcode: rcode::NOERROR,
            question: Question {
                name: name.to_vec(),
                qtype,
                qclass: class::IN,
            },
            answer: Vec::new(),
            authority: Vec::new(),
            additional: Vec::new(),
        }
    }

    pub(crate) fn opt(&self) -> Option<&Rr> {
        self.additional.iter().find(|rr| rr.is_opt())
    }

    pub(crate) fn sections(&self) -> [&[Rr]; 3] {
        [&self.answer, &self.authority, &self.additional]
    }

    /// What `parse(write(self))` gives, which is not always `self`: see [`Message::write`].
    pub(crate) fn rewritten(&self, ttl_decrement: u32) -> crate::Result<Message> {
        Message::parse(&self.write(ttl_decrement)?)
    }
}
