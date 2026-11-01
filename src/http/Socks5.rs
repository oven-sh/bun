//! SOCKS5 (RFC 1928/1929) framing for Bun's HTTP transport.
//!
//! The caller owns the socket. This type owns handshake data, buffers partial
//! frames, and preserves bytes following a successful CONNECT reply.
//! It is a pure codec: it never touches a socket or DNS.

use std::net::IpAddr;

use bun_core::ip_address::to_ip_address;
use bun_url::URL;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Socks5Error {
    CredentialsIncomplete,
    CredentialsInvalid,
    CredentialsTooLong,
    DomainTooLong,
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
    InvalidWriteProgress,
    HandshakeTooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Greeting,
    Authentication,
    Connecting,
    Established,
}

/// Authentication to present to the proxy.
#[derive(Clone, PartialEq, Eq)]
pub enum Authentication {
    None,
    UsernamePassword {
        username: Box<[u8]>,
        password: Box<[u8]>,
    },
}

impl Authentication {
    pub fn is_some(&self) -> bool {
        matches!(self, Self::UsernamePassword { .. })
    }

    pub fn from_url(proxy: &URL<'_>) -> Result<Self, Socks5Error> {
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
        match (username, password) {
            (Some(u), Some(p)) => Ok(Self::UsernamePassword {
                username: u,
                password: p,
            }),
            _ => Ok(Self::None),
        }
    }
}

// Custom Debug that does not expose credentials.
impl std::fmt::Debug for Authentication {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => write!(f, "Authentication::None"),
            Self::UsernamePassword { .. } => {
                write!(f, "Authentication::UsernamePassword {{ ..redacted.. }}")
            }
        }
    }
}

/// Destination to CONNECT to through the proxy.
#[derive(Clone, PartialEq, Eq)]
pub enum TargetHost {
    Ip(IpAddr),
    Domain(Box<[u8]>),
}

impl TargetHost {
    /// Classify a URL hostname. IP literals (including bracketed IPv6) use
    /// their native ATYP; anything else is sent as a domain name for the
    /// proxy to resolve. Bun never resolves the target locally, so
    /// `socks5://` and `socks5h://` behave the same.
    pub fn parse(hostname: &[u8]) -> Result<Self, Socks5Error> {
        let hostname = hostname
            .strip_prefix(b"[")
            .and_then(|h| h.strip_suffix(b"]"))
            .unwrap_or(hostname);
        if let Some(ip) = to_ip_address(hostname) {
            return Ok(Self::Ip(ip));
        }
        if hostname.is_empty() || hostname.len() > 255 {
            return Err(Socks5Error::DomainTooLong);
        }
        Ok(Self::Domain(hostname.to_vec().into_boxed_slice()))
    }
}

impl std::fmt::Debug for TargetHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ip(ip) => write!(f, "TargetHost::Ip({ip})"),
            Self::Domain(_) => write!(f, "TargetHost::Domain(..redacted..)"),
        }
    }
}

const MAX_HANDSHAKE_INCOMING: usize = 512;

/// SOCKS5 handshake state. The target and credentials are owned so a proxy
/// redirect/retry cannot invalidate an in-flight handshake.
pub struct Socks5 {
    state: State,
    target: TargetHost,
    port: u16,
    authentication: Authentication,
    outgoing: Vec<u8>,
    outgoing_offset: usize,
    incoming: Vec<u8>,
    leftover: Vec<u8>,
}

// Manual Debug that redacts sensitive material.
impl std::fmt::Debug for Socks5 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Socks5")
            .field("state", &self.state)
            .field("target", &self.target)
            .field("port", &self.port)
            .field("authentication", &self.authentication)
            .field("outgoing_len", &self.outgoing.len())
            .field("outgoing_offset", &self.outgoing_offset)
            .field("incoming_len", &self.incoming.len())
            .field("leftover_len", &self.leftover.len())
            .finish()
    }
}

impl Socks5 {
    /// Build a handshake for the given authentication and destination. The
    /// greeting is queued immediately; poll `pending_write` to send it.
    pub fn new(
        authentication: Authentication,
        target: TargetHost,
        port: u16,
    ) -> Result<Self, Socks5Error> {
        if let TargetHost::Domain(domain) = &target {
            if domain.is_empty() || domain.len() > 255 {
                return Err(Socks5Error::DomainTooLong);
            }
        }
        if let Authentication::UsernamePassword { username, password } = &authentication {
            if username.len() > 255 || password.len() > 255 {
                return Err(Socks5Error::CredentialsTooLong);
            }
        }
        let mut this = Self {
            state: State::Greeting,
            target,
            port,
            authentication,
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
    pub fn written(&mut self, amount: usize) -> Result<(), Socks5Error> {
        if amount > self.pending_write().len() {
            return Err(Socks5Error::InvalidWriteProgress);
        }
        self.outgoing_offset += amount;
        if self.outgoing_offset == self.outgoing.len() {
            self.outgoing.clear();
            self.outgoing_offset = 0;
        }
        Ok(())
    }

    /// `Ok(true)` means CONNECT completed, possibly with leftover bytes.
    /// The parser is bounded: a malicious proxy cannot force unbounded
    /// allocation. Only the bytes required for the current frame are
    /// considered; the bound is derived from the protocol (domain BND.ADDR
    /// is bounded by its one-byte length field, max frame ~262 bytes, total
    /// handshake <512).
    pub fn receive(&mut self, bytes: &[u8]) -> Result<bool, Socks5Error> {
        if self.is_established() {
            self.leftover.extend_from_slice(bytes);
            return Ok(true);
        }
        if self.incoming.len() + bytes.len() > MAX_HANDSHAKE_INCOMING {
            return Err(Socks5Error::HandshakeTooLarge);
        }
        self.incoming.extend_from_slice(bytes);
        self.parse_available()
    }

    pub fn take_leftover(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.leftover)
    }

    #[inline]
    fn queue_greeting(&mut self) {
        // With credentials, offer NO AUTHENTICATION as well (curl, Go
        // x/net/proxy and Node `socks` do the same): a proxy that does not
        // require auth still connects, and nothing is sent under 0x00.
        if self.authentication.is_some() {
            self.outgoing.extend_from_slice(&[0x05, 2, 0x00, 0x02]);
        } else {
            self.outgoing.extend_from_slice(&[0x05, 1, 0x00]);
        }
    }

    fn queue_authentication(&mut self) {
        let (username, password) = match &self.authentication {
            Authentication::UsernamePassword { username, password } => {
                (username.as_ref(), password.as_ref())
            }
            Authentication::None => unreachable!("queue_authentication with no auth"),
        };
        self.outgoing.reserve(3 + username.len() + password.len());
        self.outgoing
            .extend_from_slice(&[0x01, username.len() as u8]);
        self.outgoing.extend_from_slice(username);
        self.outgoing.push(password.len() as u8);
        self.outgoing.extend_from_slice(password);
    }

    fn queue_connect(&mut self) {
        match &self.target {
            TargetHost::Ip(ip) => {
                self.outgoing.reserve(10 + 16);
                self.outgoing.extend_from_slice(&[0x05, 0x01, 0x00]);
                match ip {
                    IpAddr::V4(v4) => {
                        self.outgoing.push(0x01);
                        self.outgoing.extend_from_slice(&v4.octets());
                    }
                    IpAddr::V6(v6) => {
                        self.outgoing.push(0x04);
                        self.outgoing.extend_from_slice(&v6.octets());
                    }
                }
                self.outgoing.extend_from_slice(&self.port.to_be_bytes());
            }
            TargetHost::Domain(domain) => {
                self.outgoing.reserve(7 + domain.len());
                self.outgoing
                    .extend_from_slice(&[0x05, 0x01, 0x00, 0x03, domain.len() as u8]);
                self.outgoing.extend_from_slice(domain);
                self.outgoing.extend_from_slice(&self.port.to_be_bytes());
            }
        }
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
                // No complete frame yet; but if incoming already exceeds the
                // bound we must fail rather than keep buffering.
                if self.incoming.len() > MAX_HANDSHAKE_INCOMING {
                    return Err(Socks5Error::HandshakeTooLarge);
                }
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
        match self.incoming[1] {
            0x00 => {
                self.queue_connect();
                self.state = State::Connecting;
            }
            0x02 if self.authentication.is_some() => {
                self.queue_authentication();
                self.state = State::Authentication;
            }
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
        // Bound check: frame_len can never exceed MAX_HANDSHAKE_INCOMING
        // (max domain length 255 → 262). If the proxy claims a larger frame,
        // it's invalid.
        if frame_len > MAX_HANDSHAKE_INCOMING {
            return Err(Socks5Error::HandshakeTooLarge);
        }
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
    bun_url::PercentEncoding::decode_alloc(value)
        .map(Some)
        .map_err(|_| Socks5Error::CredentialsInvalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(href: &[u8]) -> URL<'_> {
        URL::parse(href)
    }

    fn auth_none() -> Authentication {
        Authentication::None
    }

    fn auth_user_pass(user: &[u8], pass: &[u8]) -> Authentication {
        Authentication::UsernamePassword {
            username: user.to_vec().into_boxed_slice(),
            password: pass.to_vec().into_boxed_slice(),
        }
    }

    fn from_url(proxy_url: &URL<'_>, target: &[u8], port: u16) -> Result<Socks5, Socks5Error> {
        Socks5::new(
            Authentication::from_url(proxy_url)?,
            TargetHost::parse(target)?,
            port,
        )
    }

    fn connect_frame(proxy_url: &URL<'_>, target: &[u8], port: u16) -> Vec<u8> {
        let mut socks = from_url(proxy_url, target, port).unwrap();
        socks.written(socks.pending_write().len()).unwrap();
        assert!(!socks.receive(&[5, 0]).unwrap());
        socks.pending_write().to_vec()
    }

    #[test]
    fn fragmented_handshake_and_leftover() {
        let mut socks = Socks5::new(
            auth_none(),
            TargetHost::Ip("127.0.0.1".parse().unwrap()),
            80,
        )
        .unwrap();
        assert_eq!(socks.pending_write(), &[5, 1, 0]);
        socks.written(1).unwrap();
        assert_eq!(socks.pending_write(), &[1, 0]);
        socks.written(2).unwrap();
        assert!(!socks.receive(&[5]).unwrap());
        assert!(!socks.receive(&[0]).unwrap());
        assert_eq!(socks.pending_write(), &[5, 1, 0, 1, 127, 0, 0, 1, 0, 80]);
        socks.written(socks.pending_write().len()).unwrap();
        assert!(!socks.receive(&[5, 0, 0]).unwrap());
        assert!(
            socks
                .receive(&[1, 127, 0, 0, 1, 0, 80, b'O', b'K'])
                .unwrap()
        );
        assert_eq!(socks.take_leftover(), b"OK");
    }

    #[test]
    fn greeting_offers_no_auth_and_user_pass_when_credentials_exist() {
        let no_auth = Socks5::new(
            Authentication::None,
            TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
            80,
        )
        .unwrap();
        assert_eq!(no_auth.pending_write(), &[5, 1, 0]);

        let with_auth = Socks5::new(
            auth_user_pass(b"user", b"pass"),
            TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
            80,
        )
        .unwrap();
        assert_eq!(with_auth.pending_write(), &[5, 2, 0, 2]);
    }

    #[test]
    fn auth_is_decoded_separately() {
        let mut socks = from_url(
            &proxy(b"socks5://u%40ser:p%3Ass@127.0.0.1"),
            b"example.com",
            0,
        )
        .unwrap();
        assert_eq!(socks.pending_write(), &[5, 2, 0, 2]);
        socks.written(4).unwrap();
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
    fn hostnames_use_domain_atyp_for_both_schemes() {
        for href in [&b"socks5://127.0.0.1"[..], b"socks5h://127.0.0.1"] {
            assert_eq!(connect_frame(&proxy(href), b"localhost", 80)[3], 0x03);
        }
        assert_eq!(
            TargetHost::parse(b"[::1]").unwrap(),
            TargetHost::Ip("::1".parse().unwrap())
        );
        assert_eq!(
            TargetHost::parse(b"").unwrap_err(),
            Socks5Error::DomainTooLong
        );
    }

    #[test]
    fn validates_configuration_before_handshake() {
        let default_port_proxy = proxy(b"SoCkS5://127.0.0.1");
        assert!(default_port_proxy.is_socks());
        assert_eq!(default_port_proxy.get_proxy_port_auto(), 1080);

        assert_eq!(
            from_url(&proxy(b"socks5://user@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            from_url(&proxy(b"socks5://:password@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            from_url(&proxy(b"socks5://user:@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            from_url(&proxy(b"socks5://:@127.0.0.1"), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsIncomplete
        );
        assert_eq!(
            from_url(
                &proxy(b"socks5://bad%ZZ:value@127.0.0.1"),
                b"example.com",
                80
            )
            .unwrap_err(),
            Socks5Error::CredentialsInvalid
        );

        let hostname = vec![b'a'; 256];
        assert_eq!(
            from_url(&proxy(b"socks5://127.0.0.1"), &hostname, 80).unwrap_err(),
            Socks5Error::DomainTooLong
        );

        let href = format!("socks5://{}:password@127.0.0.1", "u".repeat(256));
        assert_eq!(
            from_url(&proxy(href.as_bytes()), b"example.com", 80).unwrap_err(),
            Socks5Error::CredentialsTooLong
        );
    }

    #[test]
    fn validates_protocol_fields_and_write_progress() {
        let mut socks = Socks5::new(
            auth_none(),
            TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
            80,
        )
        .unwrap();
        socks.written(0).unwrap();
        assert_eq!(socks.pending_write(), [5, 1, 0]);
        socks.written(3).unwrap();
        assert_eq!(socks.receive(&[4, 0]), Err(Socks5Error::InvalidVersion));

        for method in [0x01, 0x02, 0x80, 0xff] {
            let mut socks = Socks5::new(
                auth_none(),
                TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
                80,
            )
            .unwrap();
            socks.written(socks.pending_write().len()).unwrap();
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
            let mut socks = Socks5::new(
                auth_none(),
                TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
                80,
            )
            .unwrap();
            socks.written(socks.pending_write().len()).unwrap();
            socks.receive(&[5, 0]).unwrap();
            socks.written(socks.pending_write().len()).unwrap();
            assert_eq!(socks.receive(&reply), Err(expected));
        }
        // Over-reporting written bytes must fail in release builds.
        let mut socks = Socks5::new(
            auth_none(),
            TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
            80,
        )
        .unwrap();
        assert_eq!(socks.written(999), Err(Socks5Error::InvalidWriteProgress));
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
            let mut socks = Socks5::new(
                auth_none(),
                TargetHost::Ip("127.0.0.1".parse().unwrap()),
                80,
            )
            .unwrap();
            socks.written(socks.pending_write().len()).unwrap();
            socks.receive(&[5, 0]).unwrap();
            socks.written(socks.pending_write().len()).unwrap();
            assert_eq!(
                socks.receive(&[5, reply, 0, 1, 127, 0, 0, 1, 0, 80]),
                Err(expected)
            );
        }
    }

    #[test]
    fn bounded_input_and_credentials_redacted() {
        let mut socks = Socks5::new(
            auth_user_pass(b"user", b"pass"),
            TargetHost::Domain(b"example.com".to_vec().into_boxed_slice()),
            80,
        )
        .unwrap();
        socks.written(socks.pending_write().len()).unwrap();
        // Provide huge input – should be bounded.
        let huge = vec![0u8; 2048];
        assert_eq!(socks.receive(&huge), Err(Socks5Error::HandshakeTooLarge));

        // Debug must not contain credentials.
        let debug = format!("{:?}", socks);
        assert!(!debug.contains("user"));
        assert!(!debug.contains("pass"));
    }

    #[test]
    fn server_may_select_no_auth_even_with_credentials() {
        let mut socks = Socks5::new(
            auth_user_pass(b"u", b"p"),
            TargetHost::Ip("127.0.0.1".parse().unwrap()),
            80,
        )
        .unwrap();
        socks.written(4).unwrap();
        assert!(!socks.receive(&[5, 0]).unwrap());
        // Straight to CONNECT; the credentials are never written.
        assert_eq!(socks.pending_write()[..3], [5, 1, 0]);

        let mut socks = Socks5::new(
            auth_user_pass(b"u", b"p"),
            TargetHost::Ip("127.0.0.1".parse().unwrap()),
            80,
        )
        .unwrap();
        socks.written(4).unwrap();
        assert_eq!(
            socks.receive(&[5, 0xff]),
            Err(Socks5Error::NoAcceptableMethods)
        );
    }
}
