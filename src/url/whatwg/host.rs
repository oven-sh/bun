//! The host parser.

use crate::buffer::Buffer;
use crate::class::{
    self, C0_CONTROL, DIGIT_OR_X, ENCODED_IN_OPAQUE_HOST, FORBIDDEN_IN_DOMAIN, FORBIDDEN_IN_HOST,
    HostTraits, PERCENT_OR_NOT_ASCII, UPPERCASE,
};
use crate::parser::Parser;
use crate::{Error, Punycode, Result, domain, ipv4, ipv6, percent};

impl Parser<'_> {
    /// For a host that is not empty. `traits` are those that [`Self::scan_host`] found.
    #[inline]
    pub(crate) fn host(&mut self, start: usize, end: usize, traits: HostTraits) -> Result<()> {
        const OF_DOMAIN: HostTraits =
            FORBIDDEN_IN_DOMAIN | PERCENT_OR_NOT_ASCII | UPPERCASE | DIGIT_OR_X;
        const OF_OPAQUE_HOST: HostTraits = FORBIDDEN_IN_HOST | ENCODED_IN_OPAQUE_HOST;
        let is_special = self.is_special();
        if traits
            & if is_special {
                OF_DOMAIN
            } else {
                OF_OPAQUE_HOST
            }
            == 0
        {
            return Ok(());
        }
        match &self.source.bytes[start..end] {
            [b'[', address @ .., b']'] => self.replace_host(
                start,
                end,
                ipv6::serialize(&ipv6::parse(address)?, &mut [0; 41]),
            ),
            [b'[', ..] => Err(Error::Invalid),
            _ if is_special => self.domain(start, end, traits),
            _ if traits & FORBIDDEN_IN_HOST != 0 => Err(Error::Invalid),
            host => {
                let host = self.source.with_bytes(host);
                percent::encode(host, C0_CONTROL, self.out.interrupt(start)?)?;
                self.out.resume(end);
                Ok(())
            }
        }
    }

    fn replace_host(&mut self, start: usize, end: usize, host: &[u8]) -> Result<()> {
        if self.source.bytes[start..end] != *host {
            self.out.replace(start, end, host)?;
        }
        Ok(())
    }

    fn domain(&mut self, start: usize, end: usize, traits: HostTraits) -> Result<()> {
        let mut host = &self.source.bytes[start..end];
        let (mut storage, mut encoded) = (Buffer::new(), Buffer::new());
        let mut punycode = self.punycode;
        if traits & PERCENT_OR_NOT_ASCII != 0 {
            percent::decode(self.source.with_bytes(host), &mut storage)?;
            storage.make_ascii_lowercase();
            host = &storage;
            if !host.is_ascii() {
                domain::encode(host, &mut encoded)?;
                host = &encoded;
                punycode = Punycode::Unchecked;
            }
            let is_forbidden = |&byte| class::host_traits(byte) & FORBIDDEN_IN_DOMAIN != 0;
            if host.is_empty() || host.iter().any(is_forbidden) {
                return Err(Error::Invalid);
            }
        } else if traits & FORBIDDEN_IN_DOMAIN != 0 {
            return Err(Error::Invalid);
        } else if traits & UPPERCASE != 0 {
            storage.extend(host)?;
            storage.make_ascii_lowercase();
            host = &storage;
        }

        if ipv4::ends_in_number(host) {
            return self.replace_host(
                start,
                end,
                ipv4::serialize(ipv4::parse(host)?, &mut [0; 16]),
            );
        }
        if punycode == Punycode::Checked && !domain::has_valid_ace_labels(host) {
            return Err(Error::Invalid);
        }
        self.replace_host(start, end, host)
    }

    /// The host may be empty. The output has got to `parts.host_start`.
    pub(crate) fn host_of_file(
        &mut self,
        start: usize,
        end: usize,
        traits: HostTraits,
    ) -> Result<()> {
        if start == end {
            return Ok(());
        }
        self.host(start, end, traits)?;
        let host = self.parts.host_start as usize..self.out.position(end);
        if host
            .map(|position| self.out.byte(position))
            .eq(*b"localhost")
        {
            let out = self.out.interrupt(end)?;
            out.truncate(out.len() - "localhost".len());
        }
        Ok(())
    }
}
