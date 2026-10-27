use super::name::{self, Compression};
use super::{
    Name, Naptr, OptionValue, Question, RData, Record, Rr, Sig, Soa, Svcb, class, flag, rcode,
    rr_type,
};
use crate::buf::{Reader, all_print};
use crate::{Error, Result};

/// Root name, type, class, TTL and RDLENGTH.
const MIN_RR_LEN: usize = 11;
const MAX_MESSAGE_LEN: usize = 0xffff;

/// The RDATA of one record: the cursor over the whole message, which a name may point back into, and where the RDATA ends.
struct RDataReader<'r, 'a> {
    reader: &'r mut Reader<'a>,
    start_len: usize,
    rdlength: usize,
}

impl<'a> RDataReader<'_, 'a> {
    fn left(&self) -> usize {
        self.rdlength
            .saturating_sub(self.start_len - self.reader.len())
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

    /// `(id, length, value)` until the RDATA ends. A later value for an id replaces the earlier one in its place.
    fn options(&mut self) -> Result<Vec<OptionValue>> {
        let mut options: Vec<OptionValue> = Vec::new();
        while self.left() != 0 {
            let id = self.reader.be16()?;
            let len = usize::from(self.reader.be16()?);
            let value = self.reader.bytes(len)?.to_vec();
            match options.iter_mut().find(|option| option.id == id) {
                Some(option) => option.value = value,
                None => options.push(OptionValue { id, value }),
            }
        }
        Ok(options)
    }

    fn svcb(&mut self) -> Result<Svcb> {
        Ok(Svcb {
            priority: self.reader.be16()?,
            target: self.name(Compression::Refused)?,
            params: self.options()?,
        })
    }
}

fn class_is_valid(value: u16, rtype: u16, is_question: bool) -> bool {
    match value {
        class::IN | class::CHAOS | class::HESIOD | class::NONE => true,
        class::ANY => is_question || rtype == rr_type::SIG,
        _ => false,
    }
}

fn parse_rdata(
    rdata: &mut RDataReader<'_, '_>,
    rtype: u16,
    raw_class: u16,
    raw_ttl: u32,
    extended_rcode: &mut u16,
) -> Result<RData> {
    use Compression::Allowed;
    Ok(match rtype {
        rr_type::A => RData::A(rdata.reader.array()?),
        rr_type::NS => RData::Ns(rdata.name(Allowed)?),
        rr_type::CNAME => RData::Cname(rdata.name(Allowed)?),
        rr_type::SOA => RData::Soa(Soa {
            mname: rdata.name(Allowed)?,
            rname: rdata.name(Allowed)?,
            serial: rdata.reader.be32()?,
            refresh: rdata.reader.be32()?,
            retry: rdata.reader.be32()?,
            expire: rdata.reader.be32()?,
            minimum: rdata.reader.be32()?,
        }),
        rr_type::PTR => RData::Ptr(rdata.name(Allowed)?),
        rr_type::HINFO => RData::Hinfo {
            cpu: rdata.string()?,
            os: rdata.string()?,
        },
        rr_type::MX => RData::Mx {
            preference: rdata.reader.be16()?,
            exchange: rdata.name(Allowed)?,
        },
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
            type_covered: rdata.reader.be16()?,
            algorithm: rdata.reader.u8()?,
            labels: rdata.reader.u8()?,
            original_ttl: rdata.reader.be32()?,
            expiration: rdata.reader.be32()?,
            inception: rdata.reader.be32()?,
            key_tag: rdata.reader.be16()?,
            signers_name: rdata.name(Allowed)?,
            signature: rdata.rest()?.to_vec(),
        }),
        rr_type::AAAA => RData::Aaaa(rdata.reader.array()?),
        rr_type::SRV => RData::Srv {
            priority: rdata.reader.be16()?,
            weight: rdata.reader.be16()?,
            port: rdata.reader.be16()?,
            target: rdata.name(Allowed)?,
        },
        rr_type::NAPTR => RData::Naptr(Naptr {
            order: rdata.reader.be16()?,
            preference: rdata.reader.be16()?,
            flags: rdata.string()?,
            services: rdata.string()?,
            regexp: rdata.string()?,
            replacement: rdata.name(Allowed)?,
        }),
        rr_type::OPT => {
            // RFC 6891 section 6.1.3: the TTL is the high bits of the RCODE, the version and the flags.
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
            let (priority, weight) = (rdata.reader.be16()?, rdata.reader.be16()?);
            let target = rdata.rest()?;
            if !all_print(target) {
                return Err(Error::EBADRESP);
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
            RData::Caa {
                critical,
                tag,
                value: rdata.rest()?.to_vec(),
            }
        }
        _ => RData::Raw {
            rtype,
            data: match rdata.rdlength {
                0 => None,
                len => Some(rdata.reader.bytes(len)?.to_vec()),
            },
        },
    })
}

fn parse_rr(reader: &mut Reader<'_>, extended_rcode: &mut u16) -> Result<Rr> {
    let name = name::parse(reader, Compression::Allowed)?;
    let rtype = reader.be16()?;
    let raw_class = reader.be16()?;
    let raw_ttl = reader.be32()?;
    let rdlength = usize::from(reader.be16()?);
    if rdlength > reader.len() {
        return Err(Error::EBADRESP);
    }

    let start_len = reader.len();
    let mut rdata = RDataReader {
        reader,
        start_len,
        rdlength,
    };
    let data = parse_rdata(&mut rdata, rtype, raw_class, raw_ttl, extended_rcode)?;
    let (class, ttl) = match data {
        RData::Opt { .. } => (class::IN, 0),
        _ => (raw_class, raw_ttl),
    };
    if !matches!(data, RData::Raw { .. }) && !class_is_valid(class, rtype, false) {
        return Err(Error::EFORMERR);
    }

    // A name may end past the RDATA it began in. Bytes the type has no use for are passed over.
    let used = start_len - reader.len();
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

impl Record {
    pub fn parse(message: &[u8]) -> Result<Record> {
        if message.is_empty() || message.len() > MAX_MESSAGE_LEN {
            return Err(Error::EFORMERR);
        }
        let reader = &mut Reader::new(message);

        let id = reader.be16()?;
        let bits = reader.be16()?;
        let [qdcount, ancount, nscount, arcount] = [
            reader.be16()?,
            reader.be16()?,
            reader.be16()?,
            reader.be16()?,
        ]
        .map(usize::from);
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
            qtype: reader.be16()?,
            qclass: reader.be16()?,
        };
        if !class_is_valid(question.qclass, question.qtype, true) {
            return Err(Error::EFORMERR);
        }

        if ancount + nscount + arcount > reader.len() / MIN_RR_LEN {
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
        let is_opt = |rr: &&Rr| matches!(rr.data, RData::Opt { .. });
        if additional.iter().filter(is_opt).count() > 1 {
            return Err(Error::EBADRESP);
        }

        let is_assigned = raw_rcode <= rcode::LAST_BASIC
            || (rcode::BADSIG..=rcode::BADCOOKIE).contains(&raw_rcode);
        Ok(Record {
            id,
            flags: bits & flag::ALL,
            opcode,
            rcode: if is_assigned {
                raw_rcode
            } else {
                rcode::SERVFAIL
            },
            question: vec![question],
            answer,
            authority,
            additional,
        })
    }
}
