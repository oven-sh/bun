//! From the bytes of a message to a [`Message`].

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use super::name::{self, Compression};
use super::{
    Caa, MAX_MESSAGE_LEN, Message, Mx, Name, Naptr, OptionValue, Question, RData, Rr, Sig, Soa,
    Srv, Svcb, class, flag, rcode, rr_type,
};
use crate::reader::Reader;
use crate::text::all_print;
use crate::{Error, Result};

/// Root name, type, class, TTL and RDLENGTH.
const MIN_RR_LEN: usize = 11;

/// The RDATA of one record: the cursor over the whole message, which a name may point back into,
/// and where the RDATA ends.
struct RDataReader<'r, 'a> {
    reader: &'r mut Reader<'a>,
    start_len: usize,
    rdlength: usize,
}

impl<'a> RDataReader<'_, 'a> {
    fn left(&self) -> usize {
        self.rdlength
            .saturating_sub(self.start_len - self.reader.remaining_len())
    }

    fn name(&mut self, compression: Compression) -> Result<Name> {
        name::parse(self.reader, compression)
    }

    /// A character-string (RFC 1035 section 3.3) of bytes that print.
    fn string(&mut self) -> Result<Vec<u8>> {
        let left = self.left();
        if left == 0 {
            return Err(Error::EBADRESP);
        }
        let len = usize::from(self.reader.u8()?);
        if len > left - 1 {
            return Err(Error::EBADRESP);
        }
        let bytes = self.reader.bytes(len)?;
        if !all_print(bytes) {
            return Err(Error::EBADSTR);
        }
        Ok(bytes.to_vec())
    }

    /// What is left of the RDATA, which has to be something.
    fn rest(&mut self) -> Result<&'a [u8]> {
        match self.left() {
            0 => Err(Error::EBADRESP),
            left => self.reader.bytes(left),
        }
    }

    /// `(id, length, value)` until the RDATA ends. A later value for an id replaces the earlier one
    /// in its place.
    fn options(&mut self) -> Result<Vec<OptionValue>> {
        let mut options: Vec<OptionValue> = Vec::new();
        // One RDATA has room for 16,383 of them.
        let mut places: BTreeMap<u16, usize> = BTreeMap::new();
        while self.left() != 0 {
            let id = self.reader.u16()?;
            let len = usize::from(self.reader.u16()?);
            let value = self.reader.bytes(len)?.to_vec();
            match places.entry(id) {
                Entry::Vacant(place) => {
                    place.insert(options.len());
                    options.push(OptionValue { id, value });
                }
                Entry::Occupied(place) => {
                    if let Some(option) = options.get_mut(*place.get()) {
                        option.value = value;
                    }
                }
            }
        }
        Ok(options)
    }

    fn svcb(&mut self) -> Result<Svcb> {
        Ok(Svcb {
            priority: self.reader.u16()?,
            target: self.name(Compression::Refused)?,
            params: self.options()?,
        })
    }
}

fn is_class_of_records(value: u16) -> bool {
    matches!(
        value,
        class::IN | class::CHAOS | class::HESIOD | class::NONE
    )
}

/// The types c-ares knows: `ANY`, which [`parse_rdata`] refuses, and those it makes more of than
/// [`RData::Raw`].
fn is_known_type(rr_type: u16) -> bool {
    use rr_type::*;
    matches!(
        rr_type,
        A | NS
            | CNAME
            | SOA
            | PTR
            | HINFO
            | MX
            | TXT
            | SIG
            | AAAA
            | SRV
            | NAPTR
            | OPT
            | TLSA
            | SVCB
            | HTTPS
            | ANY
            | URI
            | CAA
    )
}

fn parse_rdata(
    rdata: &mut RDataReader<'_, '_>,
    rr_type: u16,
    raw_class: u16,
    raw_ttl: u32,
    extended_rcode: &mut u16,
) -> Result<RData> {
    use Compression::Allowed;
    Ok(match rr_type {
        rr_type::A => RData::A(rdata.reader.array()?),
        rr_type::NS => RData::Ns(rdata.name(Allowed)?),
        rr_type::CNAME => RData::Cname(rdata.name(Allowed)?),
        rr_type::SOA => RData::Soa(Soa {
            mname: rdata.name(Allowed)?,
            rname: rdata.name(Allowed)?,
            serial: rdata.reader.u32()?,
            refresh: rdata.reader.u32()?,
            retry: rdata.reader.u32()?,
            expire: rdata.reader.u32()?,
            minimum: rdata.reader.u32()?,
        }),
        rr_type::PTR => RData::Ptr(rdata.name(Allowed)?),
        rr_type::HINFO => RData::Hinfo {
            cpu: rdata.string()?,
            os: rdata.string()?,
        },
        rr_type::MX => RData::Mx(Mx {
            preference: rdata.reader.u16()?,
            exchange: rdata.name(Allowed)?,
        }),
        rr_type::TXT => {
            if rdata.rdlength == 0 {
                return Err(Error::EBADRESP);
            }
            let mut strings = Vec::new();
            while rdata.left() != 0 {
                let len = usize::from(rdata.reader.u8()?);
                strings.push(rdata.reader.bytes(len)?.to_vec());
            }
            RData::Txt(strings)
        }
        rr_type::SIG => RData::Sig(Sig {
            type_covered: rdata.reader.u16()?,
            algorithm: rdata.reader.u8()?,
            labels: rdata.reader.u8()?,
            original_ttl: rdata.reader.u32()?,
            expiration: rdata.reader.u32()?,
            inception: rdata.reader.u32()?,
            key_tag: rdata.reader.u16()?,
            signers_name: rdata.name(Allowed)?,
            signature: rdata.rest()?.to_vec(),
        }),
        rr_type::AAAA => RData::Aaaa(rdata.reader.array()?),
        rr_type::SRV => RData::Srv(Srv {
            priority: rdata.reader.u16()?,
            weight: rdata.reader.u16()?,
            port: rdata.reader.u16()?,
            target: rdata.name(Allowed)?,
        }),
        rr_type::NAPTR => RData::Naptr(Naptr {
            order: rdata.reader.u16()?,
            preference: rdata.reader.u16()?,
            flags: rdata.string()?,
            services: rdata.string()?,
            regexp: rdata.string()?,
            replacement: rdata.name(Allowed)?,
        }),
        rr_type::OPT => {
            // RFC 6891 section 6.1.3: the TTL is the high bits of the RCODE, the version and the
            // flags.
            *extended_rcode |= (raw_ttl >> 20) as u16 & 0x0ff0;
            RData::Opt {
                udp_size: raw_class,
                version: (raw_ttl >> 16) as u8,
                flags: raw_ttl as u16,
                options: rdata.options()?,
            }
        }
        rr_type::TLSA => RData::Tlsa {
            cert_usage: rdata.reader.u8()?,
            selector: rdata.reader.u8()?,
            matching: rdata.reader.u8()?,
            data: rdata.rest()?.to_vec(),
        },
        rr_type::SVCB => RData::Svcb(rdata.svcb()?),
        rr_type::HTTPS => RData::Https(rdata.svcb()?),
        rr_type::ANY => return Err(Error::EBADRESP),
        rr_type::URI => {
            let (priority, weight) = (rdata.reader.u16()?, rdata.reader.u16()?);
            let target = rdata.rest()?;
            if !all_print(target) {
                return Err(Error::EBADSTR);
            }
            RData::Uri {
                priority,
                weight,
                target: target.to_vec(),
            }
        }
        rr_type::CAA => {
            let critical = rdata.reader.u8()?;
            let tag = rdata.string()?;
            if tag.is_empty() {
                return Err(Error::EBADRESP);
            }
            RData::Caa(Caa {
                critical,
                tag,
                value: rdata.rest()?.to_vec(),
            })
        }
        _ => RData::Raw {
            rr_type,
            data: rdata.reader.bytes(rdata.rdlength)?.to_vec(),
        },
    })
}

fn parse_rr(reader: &mut Reader<'_>, extended_rcode: &mut u16) -> Result<Rr> {
    let name = name::parse(reader, Compression::Allowed)?;
    let rr_type = reader.u16()?;
    let raw_class = reader.u16()?;
    let raw_ttl = reader.u32()?;
    let rdlength = usize::from(reader.u16()?);
    if rdlength > reader.remaining_len() {
        return Err(Error::EBADRESP);
    }

    let (class, ttl) = match rr_type {
        rr_type::OPT => (class::IN, 0),
        _ => (raw_class, raw_ttl),
    };
    // The class of an unknown type is not checked.
    let is_valid_class =
        is_class_of_records(class) || (class == class::ANY && rr_type == rr_type::SIG);
    if is_known_type(rr_type) && !is_valid_class {
        return Err(Error::EFORMERR);
    }

    let start_len = reader.remaining_len();
    let mut rdata = RDataReader {
        reader,
        start_len,
        rdlength,
    };
    let data = parse_rdata(&mut rdata, rr_type, raw_class, raw_ttl, extended_rcode)?;

    // A name may end past the RDATA it began in. Bytes the type has no use for are passed over.
    let used = start_len - reader.remaining_len();
    if used > rdlength {
        return Err(Error::EBADRESP);
    }
    reader.bytes(rdlength - used)?;

    Ok(Rr {
        name,
        class,
        ttl,
        data,
    })
}

impl Message {
    pub(crate) fn parse(message: &[u8]) -> Result<Message> {
        if message.is_empty() || message.len() > MAX_MESSAGE_LEN {
            return Err(Error::EFORMERR);
        }
        let reader = &mut Reader::new(message);

        let id = reader.u16()?;
        let bits = reader.u16()?;
        let [qdcount, ancount, nscount, arcount] =
            [reader.u16()?, reader.u16()?, reader.u16()?, reader.u16()?].map(usize::from);
        let opcode = (bits >> 11) as u8 & 0xf;
        // QUERY, IQUERY, STATUS, NOTIFY and UPDATE.
        if !matches!(opcode, 0 | 1 | 2 | 4 | 5) {
            return Err(Error::EFORMERR);
        }
        if qdcount != 1 {
            return Err(Error::EBADRESP);
        }

        let question = Question {
            name: name::parse(reader, Compression::Allowed)?,
            qtype: reader.u16()?,
            qclass: reader.u16()?,
        };
        if !is_class_of_records(question.qclass) && question.qclass != class::ANY {
            return Err(Error::EFORMERR);
        }

        if ancount + nscount + arcount > reader.remaining_len() / MIN_RR_LEN {
            return Err(Error::EBADRESP);
        }
        let mut raw_rcode = bits & 0xf;
        let mut section = |count: usize| -> Result<Vec<Rr>> {
            let mut records = Vec::with_capacity(count);
            for _ in 0..count {
                records.push(parse_rr(reader, &mut raw_rcode)?);
            }
            Ok(records)
        };
        let answer = section(ancount)?;
        let authority = section(nscount)?;
        let additional = section(arcount)?;

        // RFC 6891 section 6.1.1: one OPT record at most.
        if additional.iter().filter(|rr| rr.is_opt()).count() > 1 {
            return Err(Error::EBADRESP);
        }

        let is_assigned = raw_rcode <= rcode::LAST_BASIC
            || (rcode::BADSIG..=rcode::BADCOOKIE).contains(&raw_rcode);
        Ok(Message {
            id,
            flags: bits & flag::ALL,
            opcode,
            rcode: if is_assigned {
                raw_rcode
            } else {
                rcode::SERVFAIL
            },
            question,
            answer,
            authority,
            additional,
        })
    }
}
