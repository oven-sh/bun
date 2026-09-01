//! SOCKS5 (RFC 1928/1929) framing for Bun's HTTP transport.
//!
//! The caller owns the socket. This type owns handshake data, buffers partial
//! frames, and preserves bytes following a successful CONNECT reply.

use std::net::IpAddr;

use bun_core::ip_address::to_ip_address;
use bun_url::{PercentEncoding, URL};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Socks5Error {
    CredentialsIncomplete,
    CredentialsInvalid,
    CredentialsTooLong,
    DomainTooLong,
    DnsResolutionFailed,
    InvalidVersion,
    InvalidReserved,
    InvalidAddressType,
    InvalidReply,
    InvalidAuthenticationResponse,
    NoAcceptableMethods,
    AuthenticationFailed,
    GeneralFailure,
    ConnectionNotAllowed,
    NetworkUnreachable,
    HostUnreachable,
    ConnectionRefused,
    TtlExpired,
    CommandNotSupported,
    AddressTypeNotSupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Greeting,
    Authentication,
    Connecting,
    Established,
}

/// SOCKS5 handshake state. The target and credentials are owned so a proxy
/// redirect/retry cannot invalidate an in-flight handshake.
#[derive(Debug)]
pub struct Socks5 {
    state: State,
    target_atyp: u8,
    target: Box<[u8]>,
    port: u16,
    username: Option<Box<[u8]>>,
    password: Option<Box<[u8]>>,
    outgoing: Vec<u8>,
    outgoing_offset: usize,
    incoming: Vec<u8>,
    leftover: Vec<u8>,
}

impl Socks5 {
    /// Build a handshake for `proxy`, connecting it to `target`.
    ///
    /// Numeric literals use native IPv4/IPv6 ATYP for both schemes; names use
    /// domain ATYP and are resolved by the proxy.
    pub fn new(proxy: &URL<'_>, target: &[u8], port: u16) -> Result<Self, Socks5Error> {
        Self::new_with_resolution(proxy, target, port, false)
    }

    /// Build a handshake with scheme-specific hostname resolution.
    ///
    /// `socks5h://` forwards hostnames as a SOCKS domain (ATYP 0x03), while a
    /// local `socks5://` hostname must be resolved off-thread and passed to
    /// [`Self::new_with_resolved_ip`]. Numeric literals always retain their
    /// native ATYP. `resolve_locally` is retained as a validation guard for
    /// callers that have not completed that asynchronous step.
    pub fn new_with_resolution(
        proxy: &URL<'_>,
        target: &[u8],
        port: u16,
        resolve_locally: bool,
    ) -> Result<Self, Socks5Error> {
        let target = target
            .strip_prefix(b"[")
            .and_then(|target| target.strip_suffix(b"]"))
            .unwrap_or(target);
        let parsed_ip = to_ip_address(target);

        if resolve_locally && parsed_ip.is_none() {
            // Local hostname resolution is asynchronous in the HTTP client.
            // Callers must resolve the name off-thread and use
            // `new_with_resolved_ip` to construct the CONNECT frame.
            return Err(Socks5Error::DnsResolutionFailed);
        }
        Self::new_with_target(proxy, target, port, parsed_ip)
    }

    /// Build a handshake after the caller has asynchronously resolved a local
    /// SOCKS target. Keeping resolution out of this constructor ensures the
    /// HTTP event-loop thread never performs a blocking libc lookup.
    pub fn new_with_resolved_ip(
        proxy: &URL<'_>,
        target: &[u8],
        port: u16,
        resolved_ip: IpAddr,
    ) -> Result<Self, Socks5Error> {
        Self::new_with_target(proxy, target, port, Some(resolved_ip))
    }

    fn new_with_target(
        proxy: &URL<'_>,
        target: &[u8],
        port: u16,
        parsed_ip: Option<IpAddr>,
    ) -> Result<Self, Socks5Error> {
        // Empty URL slices normally point at static storage. When userinfo was
        // written explicitly (including `:@`), the parser's slices point into
        // href. RFC 1929 requires both fields to contain 1..=255 bytes.
        let credentials_supplied = bun_alloc::is_slice_in_buffer(proxy.username, proxy.href)
            || bun_alloc::is_slice_in_buffer(proxy.password, proxy.href);
        let username = decode_credential(proxy.username)?;
        let password = decode_credential(proxy.password)?;
        if username.is_some() != password.is_some()
            || (credentials_supplied && (username.is_none() || password.is_none()))
        {
            return Err(Socks5Error::CredentialsIncomplete);
        }

        if username.as_ref().is_some_and(|value| value.len() > 255)
            || password.as_ref().is_some_and(|value| value.len() > 255)
        {
            return Err(Socks5Error::CredentialsTooLong);
        }

        // URL hostnames retain the brackets around IPv6 literals. SOCKS carries
        // the sixteen address octets directly, without those URL delimiters.
        let target = target
            .strip_prefix(b"[")
            .and_then(|target| target.strip_suffix(b"]"))
            .unwrap_or(target);
        if target.len() > 255 {
            return Err(Socks5Error::DomainTooLong);
        }

        let (target_atyp, target_bytes): (u8, Box<[u8]>) = match parsed_ip {
            Some(IpAddr::V4(address)) => (0x01, address.octets().to_vec().into_boxed_slice()),
            Some(IpAddr::V6(address)) => (0x04, address.octets().to_vec().into_boxed_slice()),
            None => (0x03, target.to_vec().into_boxed_slice()),
        };

        let mut this = Self {
            state: State::Greeting,
            target_atyp,
            target: target_bytes,
            port,
            username,
            password,
            outgoing: Vec::with_capacity(4 + 1 + 255 + 1 + 255),
            outgoing_offset: 0,
            incoming: Vec::with_capacity(64),
            leftover: Vec::new(),
        };
        this.queue_greeting();
        Ok(this)
    }

    #[inline]
    fn is_established(&self) -> bool {
        self.state == State::Established
    }

    #[inline]
    pub fn pending_write(&self) -> &[u8] {
        &self.outgoing[self.outgoing_offset..]
    }

    /// Advance the pending frame by the number of bytes accepted by the socket.
    pub fn written(&mut self, amount: usize) {
        debug_assert!(amount <= self.pending_write().len());
        self.outgoing_offset += amount;
        if self.outgoing_offset == self.outgoing.len() {
            self.outgoing.clear();
            self.outgoing_offset = 0;
        }
    }

    /// `Ok(true)` means CONNECT completed, possibly with leftover bytes.
    pub fn receive(&mut self, bytes: &[u8]) -> Result<bool, Socks5Error> {
        if self.is_established() {
            self.leftover.extend_from_slice(bytes);
            return Ok(true);
        }
        self.incoming.extend_from_slice(bytes);
        self.parse_available()
    }

    pub fn take_leftover(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.leftover)
    }

    #[inline]
    fn queue_greeting(&mut self) {
        self.outgoing.push(0x05);
        if self.username.is_some() {
            self.outgoing.extend_from_slice(&[2, 0x00, 0x02]);
        } else {
            self.outgoing.extend_from_slice(&[1, 0x00]);
        }
    }

    fn queue_authentication(&mut self) {
        let username = self.username.as_deref().unwrap_or_default();
        let password = self.password.as_deref().unwrap_or_default();
        self.outgoing.reserve(3 + username.len() + password.len());
        self.outgoing
            .extend_from_slice(&[0x01, username.len() as u8]);
        self.outgoing.extend_from_slice(username);
        self.outgoing.push(password.len() as u8);
        self.outgoing.extend_from_slice(password);
    }

    fn queue_connect(&mut self) {
        self.outgoing.reserve(7 + self.target.len());
        self.outgoing
            .extend_from_slice(&[0x05, 0x01, 0x00, self.target_atyp]);
        if self.target_atyp == 0x03 {
            self.outgoing.push(self.target.len() as u8);
        }
        self.outgoing.extend_from_slice(&self.target);
        self.outgoing.extend_from_slice(&self.port.to_be_bytes());
    }

    fn parse_available(&mut self) -> Result<bool, Socks5Error> {
        loop {
            let consumed = match self.state {
                State::Greeting => self.parse_method_response()?,
                State::Authentication => self.parse_authentication_response()?,
                State::Connecting => self.parse_connect_response()?,
                State::Established => return Ok(true),
            };
            let Some(consumed) = consumed else {
                return Ok(false);
            };
            self.incoming.drain(..consumed);
            if self.state == State::Established {
                self.leftover = core::mem::take(&mut self.incoming);
                return Ok(true);
            }
        }
    }

    fn parse_method_response(&mut self) -> Result<Option<usize>, Socks5Error> {
        if self.incoming.len() < 2 {
            return Ok(None);
        }
        if self.incoming[0] != 0x05 {
            return Err(Socks5Error::InvalidVersion);
        }
        let method = self.incoming[1];
        match method {
            0x00 => {
                self.queue_connect();
                self.state = State::Connecting;
            }
            0x02 if self.username.is_some() => {
                self.queue_authentication();
                self.state = State::Authentication;
            }
            0x02 => return Err(Socks5Error::NoAcceptableMethods),
            0xff => return Err(Socks5Error::NoAcceptableMethods),
            _ => return Err(Socks5Error::NoAcceptableMethods),
        }
        Ok(Some(2))
    }

    fn parse_authentication_response(&mut self) -> Result<Option<usize>, Socks5Error> {
        if self.incoming.len() < 2 {
            return Ok(None);
        }
        if self.incoming[0] != 0x01 {
            return Err(Socks5Error::InvalidAuthenticationResponse);
        }
        if self.incoming[1] != 0x00 {
            return Err(Socks5Error::AuthenticationFailed);
        }
        self.queue_connect();
        self.state = State::Connecting;
        Ok(Some(2))
    }

    fn parse_connect_response(&mut self) -> Result<Option<usize>, Socks5Error> {
        if self.incoming.len() < 4 {
            return Ok(None);
        }
        if self.incoming[0] != 0x05 || self.incoming[2] != 0x00 {
            return Err(if self.incoming[0] != 0x05 {
                Socks5Error::InvalidVersion
            } else {
                Socks5Error::InvalidReserved
            });
        }

        // A failure REP is complete enough to report without its BND.ADDR.
        let result = self.incoming[1];
        if result != 0x00 {
            return Err(match result {
                0x01 => Socks5Error::GeneralFailure,
                0x02 => Socks5Error::ConnectionNotAllowed,
                0x03 => Socks5Error::NetworkUnreachable,
                0x04 => Socks5Error::HostUnreachable,
                0x05 => Socks5Error::ConnectionRefused,
                0x06 => Socks5Error::TtlExpired,
                0x07 => Socks5Error::CommandNotSupported,
                0x08 => Socks5Error::AddressTypeNotSupported,
                _ => Socks5Error::InvalidReply,
            });
        }

        let address_len = match self.incoming[3] {
            0x01 => 4,
            0x04 => 16,
            0x03 => {
                if self.incoming.len() < 5 {
                    return Ok(None);
                }
                let len = usize::from(self.incoming[4]);
                if len == 0 {
                    return Err(Socks5Error::InvalidReply);
                }
                len
            }
            _ => return Err(Socks5Error::InvalidAddressType),
        };
        let address_header_len = if self.incoming[3] == 0x03 { 5 } else { 4 };
        let frame_len = address_header_len + address_len + 2;
        if self.incoming.len() < frame_len {
            return Ok(None);
        }
        self.state = State::Established;
        Ok(Some(frame_len))
    }
}

fn decode_credential(value: &[u8]) -> Result<Option<Box<[u8]>>, Socks5Error> {
    if value.is_empty() {
        return Ok(None);
    }
    PercentEncoding::decode_alloc(value)
        .map(Some)
        .map_err(|_| Socks5Error::CredentialsInvalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(href: &[u8]) -> URL<'_> {
        URL::parse(href)
    }

    fn connect_frame(proxy_url: &URL<'_>, target: &[u8], port: u16) -> Vec<u8> {
        let mut socks = Socks5::new(proxy_url, target, port).unwrap();
        socks.written(socks.pending_write().len());
        assert!(!socks.receive(&[5, 0]).unwrap());
        socks.pending_write().to_vec()
    }

    #[test]
    fn fragmented_handshake_and_leftover() {
        let mut socks = Socks5::new(&proxy(b"socks5://127.0.0.1"), b"127.0.0.1", 80).unwrap();
        assert_eq!(socks.pending_write(), &[5, 1, 0]);
        socks.written(1);
        assert_eq!(socks.pending_write(), &[1, 0]);
        socks.written(2);
        assert!(!socks.receive(&[5]).unwrap());
        assert!(!socks.receive(&[0]).unwrap());
        assert_eq!(socks.pending_write(), &[5, 1, 0, 1, 127, 0, 0, 1, 0, 80]);
        socks.written(socks.pending_write().len());
        assert!(!socks.receive(&[5, 0, 0]).unwrap());
        assert!(
            socks
                .receive(&[1, 127, 0, 0, 1, 0, 80, b'O', b'K'])
                .unwrap()
        );
        assert_eq!(socks.take_leftover(), b"OK");
    }

    #[test]
    fn auth_is_decoded_separately() {
        let mut socks = Socks5::new(
            &proxy(b"socks5://u%40ser:p%3Ass@127.0.0.1"),
            b"example.com",
            0,
        )
        .unwrap();
        assert_eq!(socks.pending_write(), &[5, 2, 0, 2]);
        socks.written(4);
        socks.receive(&[5, 2]).unwrap();
        assert_eq!(
            socks.pending_write(),
            &[
                1, 5, b'u', b'@', b's', b'e', b'r', 4, b'p', b':', b's', b's'
            ]
        );
    }

    #[test]
    fn connect_uses_native_ip_address_types() {
        assert_eq!(
            connect_frame(&proxy(b"socks5://127.0.0.1"), b"192.0.2.4", 8080),
            [5, 1, 0, 1, 192, 0, 2, 4, 0x1f, 0x90]
        );
        assert_eq!(
            connect_frame(&proxy(b"socks5://127.0.0.1"), b"[2001:db8::1]", 443),
            [
                5, 1, 0, 4, 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0x01, 0xbb,
            ]
        );
        assert_eq!(
            connect_frame(&proxy(b"socks5h://127.0.0.1"), b"example.com", 80),
            [
                5, 1, 0, 3, 11, b'e', b'x', b'a', b'm', b'p', b'l', b'e', b'.', b'c', b'o', b'm',
                0, 80,
            ]
        );
        assert_eq!(
            connect_frame(&proxy(b"socks5h://127.0.0.1"), b"192.0.2.4", 80),
            [5, 1, 0, 1, 192, 0, 2, 4, 0, 80]
        );
    }

    #[test]
    fn socks5h_forwards_names_but_socks5_uses_resolved_ip() {
        let proxy_url = proxy(b"socks5h://127.0.0.1");
        let socks5h = connect_frame(&proxy_url, b"localhost", 80);
        assert_eq!(socks5h[3], 0x03);

        let proxy_url = proxy(b"socks5://127.0.0.1");
        let mut socks5 = Socks5::new_with_resolved_ip(
            &proxy_url,
            b"localhost",
            80,
            "127.0.0.1".parse().unwrap(),
        )
        .unwrap();
        socks5.written(socks5.pending_write().len());
        assert!(!socks5.receive(&[5, 0]).unwrap());
        assert_ne!(socks5.pending_write()[3], 0x03);
    }

    #[test]
    fn validates_configuration_before_handshake() {
        let default_port_proxy = proxy(b"SoCkS5://127.0.0.1");
        assert!(default_port_proxy.is_socks());
        assert_eq!(default_port_proxy.get_proxy_port_auto(), 1080);

        assert_eq!(
            Socks5::new(&proxy(b"socks5://user@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            Socks5::new(&proxy(b"socks5://:password@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            Socks5::new(&proxy(b"socks5://user:@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            Socks5::new(&proxy(b"socks5://:@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            Socks5::new(
                &proxy(b"socks5://bad%ZZ:value@127.0.0.1"),
                b"example.com",
                80
            )
            .unwrap_err(),
            Socks5Error::CredentialsInvalid
        );

        let hostname = vec![b'a'; 256];
        assert_eq!(
            Socks5::new(&proxy(b"socks5://127.0.0.1"), &hostname, 80).unwrap_err(),
            Socks5Error::DomainTooLong
        );

        let href = format!("socks5://{}:password@127.0.0.1", "u".repeat(256));
        assert_eq!(
            Socks5::new(&proxy(href.as_bytes()), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsTooLong
        );
    }

    #[test]
    fn validates_protocol_fields_and_write_progress() {
        let mut socks = Socks5::new(&proxy(b"socks5://127.0.0.1"), b"example.com", 80).unwrap();
        socks.written(0);
        assert_eq!(socks.pending_write(), [5, 1, 0]);
        socks.written(3);
        assert_eq!(socks.receive(&[4, 0]), Err(Socks5Error::InvalidVersion));

        for method in [0x01, 0x02, 0x80, 0xff] {
            let mut socks = Socks5::new(&proxy(b"socks5://127.0.0.1"), b"example.com", 80).unwrap();
            socks.written(socks.pending_write().len());
            assert_eq!(
                socks.receive(&[5, method]),
                Err(Socks5Error::NoAcceptableMethods)
            );
        }

        for (reply, expected) in [
            ([5, 0, 1, 1], Socks5Error::InvalidReserved),
            ([5, 0, 0, 2], Socks5Error::InvalidAddressType),
            ([5, 9, 0, 1], Socks5Error::InvalidReply),
        ] {
            let mut socks = Socks5::new(&proxy(b"socks5://127.0.0.1"), b"example.com", 80).unwrap();
            socks.written(socks.pending_write().len());
            socks.receive(&[5, 0]).unwrap();
            socks.written(socks.pending_write().len());
            assert_eq!(socks.receive(&reply), Err(expected));
        }
    }

    #[test]
    fn reply_errors_are_distinct() {
        for (reply, expected) in [
            (1, Socks5Error::GeneralFailure),
            (2, Socks5Error::ConnectionNotAllowed),
            (3, Socks5Error::NetworkUnreachable),
            (4, Socks5Error::HostUnreachable),
            (5, Socks5Error::ConnectionRefused),
            (6, Socks5Error::TtlExpired),
            (7, Socks5Error::CommandNotSupported),
            (8, Socks5Error::AddressTypeNotSupported),
        ] {
            let mut socks = Socks5::new(&proxy(b"socks5://127.0.0.1"), b"127.0.0.1", 80).unwrap();
            socks.written(socks.pending_write().len());
            socks.receive(&[5, 0]).unwrap();
            socks.written(socks.pending_write().len());
            assert_eq!(
                socks.receive(&[5, reply, 0, 1, 127, 0, 0, 1, 0, 80]),
                Err(expected)
            );
        }
    }
}
