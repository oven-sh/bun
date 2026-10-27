use super::name::{self, Charset, NameOffsets};
use super::{MAX_MESSAGE_LEN, Message, OptionValue, RData, Rr, Svcb, rcode};
use crate::{Error, Result};

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_string(out: &mut Vec<u8>, string: &[u8]) -> Result<()> {
    out.push(u8::try_from(string.len()).map_err(|_| Error::EFORMERR)?);
    out.extend_from_slice(string);
    Ok(())
}

fn put_nonempty(out: &mut Vec<u8>, bytes: &[u8]) -> Result<()> {
    if bytes.is_empty() {
        return Err(Error::EFORMERR);
    }
    out.extend_from_slice(bytes);
    Ok(())
}

fn put_options(out: &mut Vec<u8>, options: &[OptionValue]) {
    for option in options {
        put_u16(out, option.id);
        put_u16(out, option.value.len() as u16);
        out.extend_from_slice(&option.value);
    }
}

fn put_uncompressed_name(out: &mut Vec<u8>, name: &[u8]) -> Result<()> {
    name::write(out, None, Charset::Any, name)
}

fn put_svcb(out: &mut Vec<u8>, svcb: &Svcb) -> Result<()> {
    put_u16(out, svcb.priority);
    put_uncompressed_name(out, &svcb.target)?;
    put_options(out, &svcb.params);
    Ok(())
}

/// Only the types of RFC 1035 have their RDATA names compressed: a server that does not know a type passes it on as it is.
fn put_rdata(out: &mut Vec<u8>, written: &mut NameOffsets, data: &RData) -> Result<()> {
    let mut put_name =
        |out: &mut Vec<u8>, name: &[u8]| name::write(out, Some(written), Charset::Any, name);
    match data {
        RData::A(address) => out.extend_from_slice(address),
        RData::Ns(name) | RData::Cname(name) | RData::Ptr(name) => put_name(out, name)?,
        RData::Soa(soa) => {
            put_name(out, &soa.mname)?;
            put_name(out, &soa.rname)?;
            for value in [soa.serial, soa.refresh, soa.retry, soa.expire, soa.minimum] {
                put_u32(out, value);
            }
        }
        RData::Hinfo { cpu, os } => {
            put_string(out, cpu)?;
            put_string(out, os)?;
        }
        RData::Mx(mx) => {
            put_u16(out, mx.preference);
            put_name(out, &mx.exchange)?;
        }
        RData::Txt(strings) => {
            if strings.is_empty() {
                return Err(Error::EFORMERR);
            }
            for string in strings {
                put_string(out, string)?;
            }
        }
        RData::Sig(sig) => {
            put_u16(out, sig.type_covered);
            out.extend_from_slice(&[sig.algorithm, sig.labels]);
            put_u32(out, sig.original_ttl);
            put_u32(out, sig.expiration);
            put_u32(out, sig.inception);
            put_u16(out, sig.key_tag);
            put_uncompressed_name(out, &sig.signers_name)?;
            put_nonempty(out, &sig.signature)?;
        }
        RData::Aaaa(address) => out.extend_from_slice(address),
        RData::Srv(srv) => {
            for value in [srv.priority, srv.weight, srv.port] {
                put_u16(out, value);
            }
            put_uncompressed_name(out, &srv.target)?;
        }
        RData::Naptr(naptr) => {
            put_u16(out, naptr.order);
            put_u16(out, naptr.preference);
            put_string(out, &naptr.flags)?;
            put_string(out, &naptr.services)?;
            put_string(out, &naptr.regexp)?;
            put_uncompressed_name(out, &naptr.replacement)?;
        }
        RData::Opt { options, .. } => put_options(out, options),
        RData::Tlsa {
            cert_usage,
            selector,
            matching,
            data,
        } => {
            out.extend_from_slice(&[*cert_usage, *selector, *matching]);
            put_nonempty(out, data)?;
        }
        RData::Svcb(svcb) | RData::Https(svcb) => put_svcb(out, svcb)?,
        RData::Uri {
            priority,
            weight,
            target,
        } => {
            put_u16(out, *priority);
            put_u16(out, *weight);
            put_nonempty(out, target)?;
        }
        RData::Caa(caa) => {
            out.push(caa.critical);
            put_string(out, &caa.tag)?;
            put_nonempty(out, &caa.value)?;
        }
        RData::Raw { data, .. } => put_nonempty(out, data)?,
    }
    Ok(())
}

impl Message {
    fn put_rr(
        &self,
        out: &mut Vec<u8>,
        written: &mut NameOffsets,
        rr: &Rr,
        ttl_decrement: u32,
    ) -> Result<()> {
        name::write(out, Some(written), Charset::Hostname, &rr.name)?;
        put_u16(out, rr.data.rr_type());
        let (class, ttl) = match rr.data {
            RData::Opt {
                udp_size,
                version,
                flags,
                ..
            } => (
                udp_size,
                u32::from(self.rcode >> 4 & 0xff) << 24
                    | u32::from(version) << 16
                    | u32::from(flags),
            ),
            _ => (rr.class, rr.ttl.saturating_sub(ttl_decrement)),
        };
        put_u16(out, class);
        put_u32(out, ttl);

        let length_at = out.len();
        put_u16(out, 0);
        put_rdata(out, written, &rr.data)?;
        let rdlength = u16::try_from(out.len() - length_at - 2).map_err(|_| Error::EBADQUERY)?;
        if let Some(slot) = out.get_mut(length_at..length_at + 2) {
            slot.copy_from_slice(&rdlength.to_be_bytes());
        }
        Ok(())
    }

    /// The message, with `ttl_decrement` seconds taken off every TTL.
    ///
    /// Stricter than [`Message::parse`], as in c-ares: the name of the question and of every record has to be made of host name bytes unless an earlier RDATA already spelled it, no compressible name is longer than 255 bytes with its escapes, and a record of an unknown type has RDATA.
    pub(crate) fn write(&self, ttl_decrement: u32) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        let written = &mut NameOffsets::default();

        put_u16(&mut out, self.id);
        let low_rcode = if self.rcode > 15 && self.opt().is_none() {
            rcode::SERVFAIL
        } else {
            self.rcode & 0xf
        };
        let bits = self.flags | u16::from(self.opcode & 0xf) << 11 | low_rcode;
        put_u16(&mut out, bits);
        put_u16(&mut out, 1);
        for section in self.sections() {
            put_u16(&mut out, section.len() as u16);
        }

        let start = out.len();
        name::write(
            &mut out,
            Some(written),
            Charset::Hostname,
            &self.question.name,
        )?;
        if out.len() - start > name::MAX_WIRE_LEN {
            return Err(Error::EBADNAME);
        }
        put_u16(&mut out, self.question.qtype);
        put_u16(&mut out, self.question.qclass);
        for section in self.sections() {
            for rr in section {
                self.put_rr(&mut out, written, rr, ttl_decrement)?;
            }
        }

        if out.len() > MAX_MESSAGE_LEN {
            return Err(Error::EBADQUERY);
        }
        Ok(out)
    }
}
