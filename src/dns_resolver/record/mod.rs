//! DNS messages (RFC 1035 section 4) as values.

pub(crate) mod name;
mod parse;
mod write;

/// A domain name in presentation form: labels joined by `.`, with `\` before `".;\()@$` and `\DDD` for a byte that does not print. No trailing dot; the root is empty.
pub type Name = Vec<u8>;

pub mod rr_type {
    pub const A: u16 = 1;
    pub const NS: u16 = 2;
    pub const CNAME: u16 = 5;
    pub const SOA: u16 = 6;
    pub const PTR: u16 = 12;
    pub const HINFO: u16 = 13;
    pub const MX: u16 = 15;
    pub const TXT: u16 = 16;
    pub const SIG: u16 = 24;
    pub const AAAA: u16 = 28;
    pub const SRV: u16 = 33;
    pub const NAPTR: u16 = 35;
    pub const OPT: u16 = 41;
    pub const TLSA: u16 = 52;
    pub const SVCB: u16 = 64;
    pub const HTTPS: u16 = 65;
    pub const ANY: u16 = 255;
    pub const URI: u16 = 256;
    pub const CAA: u16 = 257;
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Question {
    pub name: Name,
    pub qtype: u16,
    pub qclass: u16,
}

/// One EDNS option or SVCB parameter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionValue {
    pub id: u16,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sig {
    pub type_covered: u16,
    pub algorithm: u8,
    pub labels: u8,
    pub original_ttl: u32,
    pub expiration: u32,
    pub inception: u32,
    pub key_tag: u16,
    pub signers_name: Name,
    pub signature: Vec<u8>,
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Svcb {
    pub priority: u16,
    pub target: Name,
    pub params: Vec<OptionValue>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RData {
    A([u8; 4]),
    Ns(Name),
    Cname(Name),
    Soa(Soa),
    Ptr(Name),
    Hinfo {
        cpu: Vec<u8>,
        os: Vec<u8>,
    },
    Mx {
        preference: u16,
        exchange: Name,
    },
    /// The character-strings of the record, at least one.
    Txt(Vec<Vec<u8>>),
    Sig(Sig),
    Aaaa([u8; 16]),
    Srv {
        priority: u16,
        weight: u16,
        port: u16,
        target: Name,
    },
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
    Caa {
        critical: u8,
        tag: Vec<u8>,
        value: Vec<u8>,
    },
    /// A type this crate does not read. `None` is RDATA of no bytes, which [`Record::write`] refuses as c-ares does.
    Raw {
        rtype: u16,
        data: Option<Vec<u8>>,
    },
}

impl RData {
    pub fn rtype(&self) -> u16 {
        match self {
            RData::A(_) => rr_type::A,
            RData::Ns(_) => rr_type::NS,
            RData::Cname(_) => rr_type::CNAME,
            RData::Soa(_) => rr_type::SOA,
            RData::Ptr(_) => rr_type::PTR,
            RData::Hinfo { .. } => rr_type::HINFO,
            RData::Mx { .. } => rr_type::MX,
            RData::Txt(_) => rr_type::TXT,
            RData::Sig(_) => rr_type::SIG,
            RData::Aaaa(_) => rr_type::AAAA,
            RData::Srv { .. } => rr_type::SRV,
            RData::Naptr(_) => rr_type::NAPTR,
            RData::Opt { .. } => rr_type::OPT,
            RData::Tlsa { .. } => rr_type::TLSA,
            RData::Svcb(_) => rr_type::SVCB,
            RData::Https(_) => rr_type::HTTPS,
            RData::Uri { .. } => rr_type::URI,
            RData::Caa { .. } => rr_type::CAA,
            RData::Raw { rtype, .. } => *rtype,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rr {
    pub name: Name,
    pub class: u16,
    pub ttl: u32,
    pub data: RData,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub id: u16,
    /// Bits of [`flag`].
    pub(crate) flags: u16,
    pub(crate) opcode: u8,
    /// With the eight high bits an OPT record adds. One that is not assigned reads as SERVFAIL.
    pub(crate) rcode: u16,
    pub question: Vec<Question>,
    pub answer: Vec<Rr>,
    pub authority: Vec<Rr>,
    pub additional: Vec<Rr>,
}

impl Record {
    /// A recursive query for one name.
    pub(crate) fn query(name: &[u8], qtype: u16) -> Record {
        Record {
            id: 0,
            flags: flag::RD,
            opcode: 0,
            rcode: rcode::NOERROR,
            question: vec![Question {
                name: name.to_vec(),
                qtype,
                qclass: class::IN,
            }],
            answer: Vec::new(),
            authority: Vec::new(),
            additional: Vec::new(),
        }
    }

    pub(crate) fn opt(&self) -> Option<&Rr> {
        self.additional
            .iter()
            .find(|rr| matches!(rr.data, RData::Opt { .. }))
    }

    pub(crate) fn sections(&self) -> [&[Rr]; 3] {
        [&self.answer, &self.authority, &self.additional]
    }

    /// What `parse(write(self))` gives, which is not always `self`: see [`Record::write`].
    pub(crate) fn rewritten(&self, ttl_decrement: u32) -> crate::Result<Record> {
        Record::parse(&self.write(ttl_decrement)?)
    }
}
