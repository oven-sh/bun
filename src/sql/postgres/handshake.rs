//! From the dial to the first ReadyForQuery: TLS negotiation, StartupMessage, authentication.

use std::borrow::Cow;

use bstr::BStr;
use bun_boringssl::c::{self as boringssl, SSL};
use bun_core::fmt::bytes_to_hex_lower_string as hex;
use bun_sha_hmac::hmac::EVP_MAX_MD_SIZE;
use bun_sha_hmac::{Algorithm, MD5, SHA256};

use super::AnyPostgresError::{self, *};
use super::frontend::{self, Length, SSL_REQUEST};
use crate::shared::SSLMode;

const PROTOCOL_3_0: u32 = 3 << 16;

// libpq's `AUTH_REQ_*`.
const OK: u32 = 0;
const KERBEROS_V5: u32 = 2;
const CLEARTEXT: u32 = 3;
const MD5_HASH: u32 = 5;
const GSS: u32 = 7;
const GSS_CONTINUE: u32 = 8;
const SSPI: u32 = 9;
const SASL: u32 = 10;
const SASL_CONTINUE: u32 = 11;
const SASL_FINAL: u32 = 12;

/// libpq's `channel_binding`.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ChannelBinding {
    Disable,
    Prefer,
    Require,
}

impl ChannelBinding {
    /// In the order of the numbers `createConnection` takes.
    pub const ALL: [ChannelBinding; 3] = [Self::Disable, Self::Prefer, Self::Require];
}

pub struct ConnectionStrings {
    buf: Box<[u8]>,
    /// Where each string ends, in the order of the arguments of `new`.
    ends: [usize; 6],
}

impl ConnectionStrings {
    pub fn new(
        user: &[u8],
        password: &[u8],
        scram_password: &[u8],
        database: &[u8],
        options: &[u8],
        path: &[u8],
    ) -> Self {
        let strings = [user, password, scram_password, database, options, path];
        let mut end = 0;
        Self {
            buf: strings.concat().into_boxed_slice(),
            ends: strings.map(|string| {
                end += string.len();
                end
            }),
        }
    }

    fn user(&self) -> &[u8] {
        &self.buf[..self.ends[0]]
    }

    fn password(&self) -> &[u8] {
        &self.buf[self.ends[0]..self.ends[1]]
    }

    /// SASLprep(password), which is what SCRAM hashes.
    fn scram_password(&self) -> &[u8] {
        &self.buf[self.ends[1]..self.ends[2]]
    }

    fn database(&self) -> &[u8] {
        &self.buf[self.ends[2]..self.ends[3]]
    }

    fn options(&self) -> &[u8] {
        &self.buf[self.ends[3]..self.ends[4]]
    }

    pub fn path(&self) -> &[u8] {
        &self.buf[self.ends[4]..self.ends[5]]
    }
}

impl Drop for ConnectionStrings {
    fn drop(&mut self) {
        bun_alloc::secure_zero(&mut self.buf);
    }
}

/// What the connection fails with.
pub struct Refusal {
    pub error: AnyPostgresError,
    pub message: Cow<'static, str>,
}

impl From<AnyPostgresError> for Refusal {
    fn from(error: AnyPostgresError) -> Refusal {
        Refusal {
            error,
            message: "Failed to read data".into(),
        }
    }
}

fn refuse<T>(error: AnyPostgresError, message: impl Into<Cow<'static, str>>) -> Result<T, Refusal> {
    let message = message.into();
    Err(Refusal { error, message })
}

pub enum Phase {
    Dialing,
    SslRequest {
        sent: usize,
    },
    /// Until the identity of the server is accepted.
    TlsHandshake,
    Startup(Auth),
    /// In place of `Startup`, on a connection that only carries a CancelRequest.
    CancelSent,
    Ready {
        announced: bool,
    },
    Closed {
        in_sasl: bool,
    },
}

pub enum Auth {
    Pending,
    PasswordSent,
    ScramFirst(Box<ClientFirst>),
    ScramFinal { signature: [u8; 32], bound: bool },
    ScramVerified { bound: bool },
    Ok,
}

pub struct Handshake {
    phase: Phase,
    pub strings: ConnectionStrings,
    pub ssl_mode: SSLMode,
    pub channel_binding: ChannelBinding,
}

impl Handshake {
    pub fn new(strings: ConnectionStrings, ssl_mode: SSLMode, binding: ChannelBinding) -> Self {
        Self {
            phase: Phase::Dialing,
            strings,
            ssl_mode,
            channel_binding: binding,
        }
    }

    #[inline]
    pub fn phase(&self) -> &Phase {
        &self.phase
    }

    /// Of the login that is under way or was refused.
    pub fn in_sasl(&self) -> bool {
        use Auth::{ScramFinal, ScramFirst, ScramVerified};
        matches!(
            self.phase,
            Phase::Startup(ScramFirst(_) | ScramFinal { .. } | ScramVerified { .. })
                | Phase::Closed { in_sasl: true }
        )
    }

    /// Writes as much of the SSLRequest as `write` takes.
    pub fn request_tls(&mut self, write: impl FnOnce(&[u8]) -> usize) {
        let sent = match self.phase {
            Phase::Dialing => 0,
            Phase::SslRequest { sent } if sent < SSL_REQUEST.len() => sent,
            _ => return,
        };
        let sent = sent + write(&SSL_REQUEST[sent..]);
        self.phase = Phase::SslRequest { sent };
    }

    /// `true`: the TLS handshake comes next, `false`: the first message.
    pub fn on_ssl_reply(&mut self, reply: u8) -> Result<bool, Refusal> {
        match (reply, self.ssl_mode) {
            _ if !matches!(self.phase, Phase::SslRequest { .. }) => Err(UnexpectedMessage.into()),
            (b'S', _) => {
                self.phase = Phase::TlsHandshake;
                Ok(true)
            }
            (b'N', SSLMode::Disable | SSLMode::Prefer) => Ok(false),
            (b'N', _) => refuse(TLSNotAvailable, "Server does not support SSL"),
            _ => Err(UnexpectedMessage.into()),
        }
    }

    fn may_start(&self) -> bool {
        use SSLMode::{Disable, Prefer};
        matches!(
            (&self.phase, self.ssl_mode),
            (Phase::Dialing, Disable)
                | (Phase::SslRequest { .. }, Disable | Prefer)
                | (Phase::TlsHandshake, _)
        )
    }

    pub fn send_startup(&mut self, out: &mut Vec<u8>) -> Result<(), AnyPostgresError> {
        if !self.may_start() {
            return Ok(());
        }
        self.phase = Phase::Startup(Auth::Pending);
        let strings = &self.strings;
        let database = match strings.database() {
            b"" => strings.user(),
            database => database,
        };
        let length = Length::reserve(out);
        for part in [
            &PROTOCOL_3_0.to_be_bytes(),
            &b"user\0"[..],
            strings.user(),
            b"\0database\0",
            database,
            // A startup parameter outranks the server's defaults: `SQL, DMY` would print `03/04/2026`.
            b"\0client_encoding\0UTF8\0DateStyle\0ISO, MDY\0",
            strings.options(),
            b"\0",
        ] {
            out.extend_from_slice(part);
        }
        length.end_message(out)
    }

    pub fn send_cancel(&mut self, packet: &[u8; 16], out: &mut Vec<u8>) {
        if self.may_start() {
            self.phase = Phase::CancelSent;
            out.extend_from_slice(packet);
        }
    }

    /// `true`: it is the first one.
    #[inline]
    pub fn on_ready_for_query(&mut self) -> Result<bool, AnyPostgresError> {
        match self.phase {
            Phase::Ready { .. } => Ok(false),
            Phase::Startup(Auth::Ok) => {
                self.phase = Phase::Ready { announced: false };
                Ok(true)
            }
            _ => Err(UnexpectedMessage),
        }
    }

    /// `true` once, for a connection that is ready.
    #[inline]
    pub fn announce(&mut self) -> bool {
        match &mut self.phase {
            Phase::Ready { announced } => !core::mem::replace(announced, true),
            _ => false,
        }
    }

    pub fn close(&mut self) {
        let in_sasl = self.in_sasl();
        self.phase = Phase::Closed { in_sasl };
    }

    /// `body`: of an Authentication message. `true`: `out` has the reply.
    pub fn authenticate(
        &mut self,
        body: &[u8],
        tls: Option<&mut SSL>,
        out: &mut Vec<u8>,
    ) -> Result<bool, Refusal> {
        let auth = match &self.phase {
            Phase::Startup(auth) => auth,
            Phase::Ready { .. } => &Auth::Ok,
            // Nothing has asked for it, and the server may not be the right one.
            _ => return Err(UnexpectedMessage.into()),
        };
        let (method, data) = body.split_first_chunk().ok_or(InvalidMessageLength)?;
        let required = self.channel_binding == ChannelBinding::Require;
        let before = out.len();
        let next = match (u32::from_be_bytes(*method), data, auth) {
            (OK | KERBEROS_V5 | CLEARTEXT | GSS | SSPI, [_, ..], _)
            | (GSS_CONTINUE | SASL | SASL_CONTINUE | SASL_FINAL, [], _) => {
                Err(InvalidMessageLength)?
            }
            (MD5_HASH, salt, _) if salt.len() != 4 => Err(InvalidMessageLength)?,
            // RFC 5802 §5: the server proves itself first.
            (OK, _, Auth::ScramFirst(_) | Auth::ScramFinal { .. }) => Err(UnexpectedMessage)?,
            (OK, _, Auth::ScramVerified { bound: true }) => Auth::Ok,
            (OK, ..) if required => refuse(
                ChannelBindingRequired,
                "channel binding required, but server authenticated client without channel binding",
            )?,
            (OK, ..) => Auth::Ok,
            (CLEARTEXT | MD5_HASH, _, Auth::Pending) if required => refuse(
                ChannelBindingRequired,
                "channel binding required but not supported by server's authentication request",
            )?,
            (CLEARTEXT, _, Auth::Pending) => {
                frontend::message(out, b'p', &[self.strings.password(), b"\0"])?;
                Auth::PasswordSent
            }
            (MD5_HASH, salt, Auth::Pending) => {
                let inner = md5_hex(self.strings.password(), self.strings.user());
                let outer = md5_hex(inner.as_bytes(), salt);
                frontend::message(out, b'p', &[b"md5", outer.as_bytes(), b"\0"])?;
                Auth::PasswordSent
            }
            (SASL, mechanisms, Auth::Pending) => {
                let asked_for_tls = self.ssl_mode != SSLMode::Disable;
                let binding = Gs2::choose(mechanisms, self.channel_binding, tls, asked_for_tls)?;
                Auth::ScramFirst(Box::new(ClientFirst::send(binding, out)?))
            }
            (SASL_CONTINUE, server_first, auth) => {
                let server_first = ServerFirst::parse(server_first)?;
                let Auth::ScramFirst(client_first) = auth else {
                    Err(UnexpectedMessage)?
                };
                client_first.prove(&server_first, self.strings.scram_password(), out)?
            }
            (SASL_FINAL, server_final, Auth::ScramFinal { signature, bound }) => {
                let expected = bun_base64::encode_alloc(signature);
                // After `v=`.
                match server_final.get(2..) {
                    Some(sent) if boringssl::constant_time_eq(&expected, sent) => {
                        Auth::ScramVerified { bound: *bound }
                    }
                    _ => refuse(
                        SASL_SIGNATURE_MISMATCH,
                        "The server did not return the correct signature",
                    )?,
                }
            }
            (CLEARTEXT | MD5_HASH | SASL | SASL_FINAL, ..) => Err(UnexpectedMessage)?,
            (KERBEROS_V5, ..) => unsupported("Kerberos V5")?,
            (GSS | GSS_CONTINUE, ..) => unsupported("GSSAPI")?,
            (SSPI, ..) => unsupported("SSPI")?,
            _ => refuse(
                UNKNOWN_AUTHENTICATION_METHOD,
                "Unknown authentication method",
            )?,
        };
        if let Phase::Startup(auth) = &mut self.phase {
            *auth = next;
        }
        Ok(out.len() != before)
    }
}

fn unsupported(method: &str) -> Result<Auth, Refusal> {
    let message = format!("{method} authentication is not supported");
    refuse(UNSUPPORTED_AUTHENTICATION_METHOD, message)
}

fn md5_hex(first: &[u8], second: &[u8]) -> String {
    let mut digest = [0; MD5::DIGEST];
    let mut md5 = MD5::init();
    md5.update(first);
    md5.update(second);
    md5.r#final(&mut digest);
    hex(&digest)
}

/// The channel binding flag of the GS2 header (RFC 5802 §7).
enum Gs2 {
    /// The client does not do channel binding.
    N,
    /// The client does, and thinks the server does not. A server that does refuses this.
    Y,
    TlsServerEndPoint(Vec<u8>),
}

impl Gs2 {
    /// As libpq's `pg_SASL_init`, with its messages.
    fn choose(
        mechanisms: &[u8],
        binding: ChannelBinding,
        tls: Option<&mut SSL>,
        asked_for_tls: bool,
    ) -> Result<Gs2, Refusal> {
        let offers = |name: &[u8]| bun_core::split(mechanisms, b"\0").any(|offer| offer == name);
        let plus = offers(b"SCRAM-SHA-256-PLUS") && binding != ChannelBinding::Disable;
        let required = binding == ChannelBinding::Require;
        match tls {
            None if required => refuse(
                ChannelBindingRequired,
                "channel binding required, but SSL not in use",
            ),
            // Something took TLS off. Unlike libpq, not if it was never asked for: a proxy may speak TLS for us.
            None if plus && asked_for_tls => refuse(
                ChannelBindingFailed,
                "server offered SCRAM-SHA-256-PLUS authentication over a non-SSL connection. channelBinding: \"disable\" connects without channel binding",
            ),
            // No fallback: who terminates TLS picks the certificate, and `n` is never refused.
            Some(tls) if plus => {
                let mut hash = [0; EVP_MAX_MD_SIZE];
                let certificate = tls.peer_leaf_certificate();
                match certificate.and_then(|it| it.tls_server_end_point_hash(&mut hash)) {
                    Some(len) => Ok(Gs2::TlsServerEndPoint(hash[..len].to_vec())),
                    None => refuse(
                        ChannelBindingFailed,
                        "could not get the hash of the server's certificate for channel binding: its signature algorithm names no digest. channelBinding: \"disable\" connects without channel binding",
                    ),
                }
            }
            Some(_) if required => refuse(
                ChannelBindingRequired,
                "channel binding is required, but server did not offer an authentication method that supports channel binding",
            ),
            _ if !offers(b"SCRAM-SHA-256") => refuse(
                SASLNoKnownMechanism,
                "none of the server's SASL authentication mechanisms are supported",
            ),
            Some(_) if binding == ChannelBinding::Prefer => Ok(Gs2::Y),
            _ => Ok(Gs2::N),
        }
    }

    /// The mechanism, the header and the channel binding data.
    fn parts(&self) -> [&[u8]; 3] {
        match self {
            Gs2::N => [b"SCRAM-SHA-256", b"n,,", b""],
            Gs2::Y => [b"SCRAM-SHA-256", b"y,,", b""],
            Gs2::TlsServerEndPoint(hash) => {
                [b"SCRAM-SHA-256-PLUS", b"p=tls-server-end-point,,", hash]
            }
        }
    }
}

struct ServerFirst<'a> {
    nonce: &'a [u8],
    salt: &'a [u8],
    iterations: &'a [u8],
}

impl<'a> ServerFirst<'a> {
    fn parse(message: &'a [u8]) -> Result<Self, AnyPostgresError> {
        let (mut r, mut s, mut i) = (None, None, None);
        for item in bun_core::split(message, b",") {
            match item {
                // RFC 5802 §5.1: a mandatory extension, and this client knows none.
                [b'm', b'=', ..] => return Err(InvalidMessage),
                [] | [_] | [_, _] => {}
                [b'r', _, value @ ..] => r = Some(value),
                [b's', _, value @ ..] => s = Some(value),
                [b'i', _, value @ ..] => i = Some(value),
                _ => {}
            }
        }
        Ok(ServerFirst {
            nonce: r.ok_or(InvalidMessage)?,
            salt: s.ok_or(InvalidMessage)?,
            iterations: i.ok_or(InvalidMessage)?,
        })
    }
}

pub struct ClientFirst {
    nonce: Vec<u8>,
    binding: Gs2,
}

impl ClientFirst {
    fn send(binding: Gs2, out: &mut Vec<u8>) -> Result<ClientFirst, AnyPostgresError> {
        let mut random = [0; 18];
        boringssl::rand_bytes(&mut random);
        let nonce = bun_base64::encode_alloc(&random);
        let [mechanism, header, _] = binding.parts();
        let data = [header, b"n=*,r=", &nonce].concat();
        let length = (data.len() as u32).to_be_bytes();
        frontend::message(out, b'p', &[mechanism, b"\0", &length, &data])?;
        Ok(ClientFirst { nonce, binding })
    }

    fn prove(
        &self,
        server: &ServerFirst<'_>,
        password: &[u8],
        out: &mut Vec<u8>,
    ) -> Result<Auth, Refusal> {
        // RFC 5802 §5.1
        if !server.nonce.starts_with(&self.nonce) {
            Err(InvalidMessage)?;
        }
        let iterations: u32 =
            bun_core::fmt::parse_int(server.iterations, 10).map_err(|_| InvalidCharacter)?;
        // The minimum is RFC 7677 §4's. The maximum keeps a server from burning the CPU.
        if !(4096..=10_000_000).contains(&iterations) {
            refuse(
                SASLIterationCountOutOfRange,
                format!(
                    "SCRAM-SHA-256 iteration count {iterations} is out of range: it must be between 4096 and 10000000"
                ),
            )?;
        }
        if server.salt.len() > 2048 {
            Err(InvalidMessage)?;
        }
        let salt =
            bun_base64::decode_alloc(server.salt).map_err(|_| SASL_SIGNATURE_INVALID_BASE64)?;
        if !(1..=1024).contains(&salt.len()) {
            Err(InvalidMessage)?;
        }
        let salted = pbkdf2(password, &salt, iterations).ok_or(PBKDFD2)?;

        let [_, header, hash] = self.binding.parts();
        let binding = bun_base64::encode_alloc(&[header, hash].concat());
        let [c, client_nonce, r, s, i] = [
            &binding,
            &self.nonce,
            server.nonce,
            server.salt,
            server.iterations,
        ]
        .map(BStr::new);
        let auth_message = format!("n=*,r={client_nonce},r={r},s={s},i={i},c={c},r={r}");

        let server_key = hmac(&salted, b"Server Key").ok_or(InvalidServerKey)?;
        let signature = hmac(&server_key, auth_message.as_bytes()).ok_or(InvalidServerSignature)?;
        let mut proof = hmac(&salted, b"Client Key").ok_or(OutOfMemory)?;
        let mut stored_key = [0; SHA256::DIGEST];
        SHA256::hash(&proof, &mut stored_key);
        let client_signature = hmac(&stored_key, auth_message.as_bytes()).ok_or(OutOfMemory)?;
        for (key, signature) in proof.iter_mut().zip(client_signature) {
            *key ^= signature;
        }

        let client_final = format!("c={c},r={r},p=");
        let proof = bun_base64::encode_alloc(&proof);
        frontend::message(out, b'p', &[client_final.as_bytes(), &proof])?;
        Ok(Auth::ScramFinal {
            signature,
            bound: matches!(self.binding, Gs2::TlsServerEndPoint(_)),
        })
    }
}

fn hmac(key: &[u8], data: &[u8]) -> Option<[u8; 32]> {
    let mut out = [0; EVP_MAX_MD_SIZE];
    let digest = bun_sha_hmac::generate(key, data, Algorithm::Sha256, &mut out)?;
    digest.try_into().ok()
}

fn pbkdf2(password: &[u8], salt: &[u8], iterations: u32) -> Option<[u8; 32]> {
    let mut out = [0; 32];
    boringssl::ERR_clear_error();
    // SAFETY: each pointer is valid for the length after it.
    let rc = unsafe {
        boringssl::PKCS5_PBKDF2_HMAC(
            password.as_ptr(),
            password.len(),
            salt.as_ptr(),
            salt.len(),
            iterations,
            boringssl::EVP_sha256(),
            out.len(),
            out.as_mut_ptr(),
        )
    };
    (rc > 0).then_some(out)
}
