use crate::class::{
    self, AT_SIGN, DIGIT_OR_X, HOST_SCAN, HostTraits, TAB_OR_NEWLINE, TO_BE_REMOVED, USERINFO,
};
use crate::parser::{Parser, Step};
use crate::{Error, Result, Scheme};

/// The digits that `text` starts with: how many there are, and the port if they are one.
#[inline]
pub(crate) fn leading_port(text: &[u8]) -> (usize, Option<u16>) {
    let (mut count, mut value, mut all_values) = (0, 0u32, 0);
    while let Some(digit @ b'0'..=b'9') = text.get(count) {
        value = value.wrapping_mul(10).wrapping_add(u32::from(digit - b'0'));
        all_values |= value;
        count += 1;
    }
    let is_port = count != 0 && all_values <= 0xffff;
    (count, is_port.then_some(value as u16))
}

/// With the colon.
pub(crate) fn serialize_port(mut port: u16, storage: &mut [u8; 6]) -> &[u8] {
    let mut start = storage.len();
    loop {
        start -= 1;
        storage[start] = b'0' + (port % 10) as u8;
        port /= 10;
        if port == 0 {
            break;
        }
    }
    storage[start - 1] = b':';
    &storage[start - 1..]
}

impl Parser<'_> {
    #[inline]
    fn ends_authority(&self, at: usize) -> bool {
        self.is_slash(at) || matches!(self.source.bytes.get(at), None | Some(b'?' | b'#'))
    }

    /// Where the host that starts at `start` ends.
    pub(crate) fn scan_host(&self, start: usize) -> (usize, HostTraits) {
        let input = self.source.bytes;
        let first = input.get(start).copied().unwrap_or_default();
        let mut traits = class::host_traits(first) & DIGIT_OR_X;
        let mut colon_ends_host = self.parts.scheme != Scheme::File;
        for at in HOST_SCAN.scan(input, start) {
            match input[at] {
                b':' if colon_ends_host => return (at, traits),
                b'[' => colon_ends_host = false,
                b']' => colon_ends_host = self.parts.scheme != Scheme::File,
                _ if self.ends_authority(at) => return (at, traits),
                _ => {}
            }
            traits |= class::host_traits(input[at]);
        }
        (input.len(), traits)
    }

    #[inline]
    pub(crate) fn authority(&mut self, start: usize) -> Result<Step> {
        let input = self.source.bytes;
        self.parts.set_empty_authority(self.mark(start));
        let mut host_start = start;
        let (mut host_end, mut traits) = self.scan_host(start);
        let is_port = |at| self.ends_authority(at + leading_port(&input[at..]).0);
        if traits & AT_SIGN != 0 || !(self.ends_authority(host_end) || is_port(host_end + 1)) {
            host_start = self.credentials(start)?;
            (host_end, traits) = self.scan_host(host_start);
        }
        let has_port = !self.ends_authority(host_end);
        self.failure_is_final = traits & TO_BE_REMOVED == 0;
        if host_end > host_start {
            self.host(host_start, host_end, traits)?;
        } else if self.is_special() || has_port || host_start > start {
            return Err(Error::Invalid);
        }
        self.failure_is_final = false;
        self.parts.host_end = self.mark(host_end);
        let end = if has_port {
            self.port(host_end)?
        } else {
            host_end
        };
        self.path_start(end)
    }

    /// Returns where the host starts.
    fn credentials(&mut self, start: usize) -> Result<usize> {
        let input = self.source.bytes;
        let at_sign = HOST_SCAN
            .scan(input, start)
            .take_while(|&at| !self.ends_authority(at))
            .filter(|&at| input[at] == b'@')
            .last()
            .ok_or(Error::Invalid)?;
        let username_end = bun_highway::index_of_char(&input[start..at_sign], b':')
            .map_or(at_sign, |colon| start + colon);

        self.userinfo(start, username_end)?;
        self.parts.username_end = self.mark(username_end);
        if username_end + 1 < at_sign {
            self.userinfo(username_end + 1, at_sign)?;
        } else if username_end == start {
            self.out.replace(start, at_sign + 1, b"")?;
        } else if username_end < at_sign {
            self.out.replace(username_end, at_sign, b"")?;
        }
        self.parts.host_start = self.mark(at_sign + 1);
        Ok(at_sign + 1)
    }

    fn userinfo(&mut self, start: usize, end: usize) -> Result<()> {
        for at in start..end {
            let byte = self.source.bytes[at];
            if class::is_in(USERINFO, byte) {
                if class::is_in(TAB_OR_NEWLINE, byte) {
                    return Err(Error::Invalid);
                }
                self.escape(at, at + 1)?;
            }
        }
        Ok(())
    }

    /// Returns where the port ends.
    fn port(&mut self, colon: usize) -> Result<usize> {
        let digits = &self.source.bytes[colon + 1..];
        let (count, port) = leading_port(digits);
        let end = colon + 1 + count;
        if !self.ends_authority(end) || (port.is_none() && count != 0) {
            return Err(Error::Invalid);
        }
        match port.filter(|_| port != self.parts.scheme.default_port()) {
            None => self.out.replace(colon, end, b"")?,
            Some(port) => {
                self.parts.port = port;
                if count > 1 && digits[0] == b'0' {
                    self.out
                        .replace(colon, end, serialize_port(port, &mut [0; 6]))?;
                }
            }
        }
        Ok(end)
    }
}
