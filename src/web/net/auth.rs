//! https://httpwg.org/specs/rfc9110.html#authentication

use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use bun_core::strings;
use bun_sha_hmac::sha::evp::{MD5, SHA256};

use super::{gssapi, ntlm};
use crate::Bytes;
use crate::headers::{collect_quoted, is_token, split};
use crate::url::{Url, percent_decode};

keywords! {
    /// The weakest first.
    pub enum AuthScheme {
        Basic = b"basic",
        Digest = b"digest",
        Ntlm = b"ntlm",
        Negotiate = b"negotiate",
    }
}

impl AuthScheme {
    pub(super) fn is_for_connection(self) -> bool {
        matches!(self, AuthScheme::Ntlm | AuthScheme::Negotiate)
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct Login {
    pub name: Bytes,
    pub password: Bytes,
}

impl Login {
    pub(super) fn of_url(url: &Url) -> Option<Login> {
        url.includes_credentials().then(|| Login {
            name: percent_decode(url.username()).into(),
            password: percent_decode(url.password()).into(),
        })
    }
}

pub(super) struct Challenge {
    pub scheme: AuthScheme,
    token: Vec<u8>,
    parameters: Vec<(Vec<u8>, Vec<u8>)>,
}

fn parameter(text: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let (name, value) = strings::split_once_char(text, b'=')
        .map(|it| (it.0.trim_ascii(), it.1.trim_ascii()))
        .filter(|it| is_token(it.0))?;
    Some((
        name.to_ascii_lowercase(),
        if value.starts_with(b"\"") {
            collect_quoted(value).0
        } else {
            value.to_vec()
        },
    ))
}

impl Challenge {
    /// Those of a known scheme.
    pub(super) fn parse_all<'a>(values: impl Iterator<Item = &'a [u8]>) -> Vec<Challenge> {
        let (mut all, mut is_known) = (Vec::<Challenge>::new(), false);
        for part in values.flat_map(|it| split(it, b',')) {
            let more = parameter(part).or_else(|| {
                let (scheme, rest) = strings::split_once_char(part, b' ').unwrap_or((part, b""));
                let scheme = AuthScheme::parse(&scheme.to_ascii_lowercase());
                is_known = scheme.is_some();
                let token = bun_base64::decode_alloc(rest.trim_ascii()).unwrap_or_default();
                all.push(Challenge {
                    scheme: scheme?,
                    token,
                    parameters: Vec::new(),
                });
                parameter(rest)
            });
            if let (Some(more), Some(last), true) = (more, all.last_mut(), is_known) {
                last.parameters.push(more);
            }
        }
        all
    }

    fn get(&self, name: &[u8]) -> &[u8] {
        self.parameters
            .iter()
            .find(|it| it.0 == name)
            .map_or(b"", |it| &it.1)
    }

    pub(super) fn realm(&self) -> &[u8] {
        self.get(b"realm")
    }

    /// It answers what was sent.
    pub(super) fn is_reply(&self) -> bool {
        !self.token.is_empty()
    }

    pub(super) fn is_stale(&self) -> bool {
        self.scheme == AuthScheme::Digest && self.get(b"stale").eq_ignore_ascii_case(b"true")
    }
}

/// https://httpwg.org/specs/rfc7616.html
pub(super) struct Digest {
    nonce: Bytes,
    opaque: Bytes,
    algorithm: Bytes,
    has_quality: bool,
    hashes_name: bool,
    uses: AtomicU32,
}

fn hex(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .flat_map(|it| [it >> 4, it & 15])
        .map(|it| b"0123456789abcdef"[it as usize])
        .collect()
}

fn quoted(text: &[u8]) -> Vec<u8> {
    let escaped = text.iter().flat_map(|it| {
        matches!(it, b'"' | b'\\')
            .then_some(b'\\')
            .into_iter()
            .chain([*it])
    });
    (*b"\"").into_iter().chain(escaped).chain(*b"\"").collect()
}

impl Digest {
    fn new(challenge: &Challenge) -> Option<Digest> {
        let (nonce, algorithm, quality) = (
            challenge.get(b"nonce"),
            challenge.get(b"algorithm"),
            challenge.get(b"qop"),
        );
        let has_quality = split(quality, b',').any(|it| it.eq_ignore_ascii_case(b"auth"));
        let is_known = matches!(
            &*algorithm.to_ascii_lowercase(),
            b"" | b"md5" | b"md5-sess" | b"sha-256" | b"sha-256-sess"
        );
        (is_known && !nonce.is_empty()).then(|| Digest {
            nonce: nonce.into(),
            opaque: challenge.get(b"opaque").into(),
            algorithm: algorithm.into(),
            has_quality,
            hashes_name: challenge.get(b"userhash").eq_ignore_ascii_case(b"true"),
            uses: AtomicU32::new(0),
        })
    }

    fn hash(&self, parts: &[&[u8]]) -> Vec<u8> {
        let (text, mut md5, mut sha256) = (parts.join(&b':'), [0; 16], [0; 32]);
        if self.algorithm.len() > 3
            && self.algorithm[3] == b'-'
            && self.algorithm[0].eq_ignore_ascii_case(&b's')
        {
            SHA256::hash(&text, &mut sha256);
            return hex(&sha256);
        }
        MD5::hash(&text, &mut md5);
        hex(&md5)
    }

    fn respond(&self, login: &Login, realm: &[u8], method: &[u8], target: &[u8]) -> Vec<u8> {
        let mut random = [0; 8];
        bun_boringssl_sys::rand_bytes(&mut random);
        let (own_nonce, count) = (
            hex(&random),
            format!("{:08x}", self.uses.fetch_add(1, Ordering::Relaxed) + 1),
        );
        let mut secret = self.hash(&[&login.name, realm, &login.password]);
        if self.algorithm.to_ascii_lowercase().ends_with(b"-sess") {
            secret = self.hash(&[&secret, &self.nonce, &own_nonce]);
        }
        let asked = self.hash(&[method, target]);
        let response = if self.has_quality {
            self.hash(&[
                &secret,
                &self.nonce,
                count.as_bytes(),
                &own_nonce,
                b"auth",
                &asked,
            ])
        } else {
            self.hash(&[&secret, &self.nonce, &asked])
        };
        let name = if self.hashes_name {
            self.hash(&[&login.name, realm])
        } else {
            login.name.to_vec()
        };
        let fields = [
            ("username", Some(quoted(&name))),
            ("realm", Some(quoted(realm))),
            ("nonce", Some(quoted(&self.nonce))),
            ("uri", Some(quoted(target))),
            (
                "algorithm",
                (!self.algorithm.is_empty()).then(|| self.algorithm.to_vec()),
            ),
            ("response", Some(quoted(&response))),
            (
                "opaque",
                (!self.opaque.is_empty()).then(|| quoted(&self.opaque)),
            ),
            ("qop", self.has_quality.then(|| b"auth".to_vec())),
            ("nc", self.has_quality.then(|| count.into_bytes())),
            ("cnonce", self.has_quality.then(|| quoted(&own_nonce))),
            ("userhash", self.hashes_name.then(|| b"true".to_vec())),
        ];
        let written: Vec<_> = fields
            .into_iter()
            .filter_map(|it| Some([it.0.as_bytes(), b"=", &it.1?].concat()))
            .collect();
        [&b"Digest "[..], &written.join(&b", "[..])].concat()
    }
}

#[derive(Clone)]
enum Secret {
    Basic(Login),
    Digest(Login, Arc<Digest>),
    Ntlm(Login),
    /// Of who is logged in to the system.
    Ambient(AuthScheme),
}

/// What a server or a proxy is expected to accept.
#[derive(Clone)]
pub(super) struct Identity {
    pub realm: Bytes,
    secret: Secret,
}

impl Identity {
    pub(super) fn new(challenge: &Challenge, login: Option<Login>) -> Option<Identity> {
        let secret = match (challenge.scheme, login) {
            (AuthScheme::Basic, Some(login)) => Secret::Basic(login),
            (AuthScheme::Digest, Some(login)) if !login.name.iter().any(u8::is_ascii_control) => {
                Secret::Digest(login, Digest::new(challenge)?.into())
            }
            (AuthScheme::Ntlm, Some(login)) => Secret::Ntlm(login),
            (AuthScheme::Negotiate, None) => Secret::Ambient(challenge.scheme),
            (AuthScheme::Ntlm, None) if cfg!(windows) => Secret::Ambient(challenge.scheme),
            _ => return None,
        };
        Some(Identity {
            realm: challenge.realm().into(),
            secret,
        })
    }

    pub(super) fn scheme(&self) -> AuthScheme {
        match self.secret {
            Secret::Basic(_) => AuthScheme::Basic,
            Secret::Digest(..) => AuthScheme::Digest,
            Secret::Ntlm(_) => AuthScheme::Ntlm,
            Secret::Ambient(scheme) => scheme,
        }
    }

    pub(super) fn login(&self) -> Option<&Login> {
        match &self.secret {
            Secret::Basic(login) | Secret::Digest(login, _) | Secret::Ntlm(login) => Some(login),
            Secret::Ambient(_) => None,
        }
    }

    pub(super) fn is_same(&self, other: &Identity) -> bool {
        (self.scheme(), &self.realm, self.login()) == (other.scheme(), &other.realm, other.login())
    }
}

struct Known {
    peer: Bytes,
    identity: Identity,
    directories: Vec<Bytes>,
    /// Has the connections that are logged in.
    pool: Option<u64>,
}

/// What has been accepted.
#[derive(Default)]
pub(super) struct Logins(Vec<Known>);

fn directory_of(path: &[u8]) -> &[u8] {
    &path[..strings::last_index_of_char(path, b'/').map_or(0, |it| it + 1)]
}

impl Logins {
    pub(super) fn for_path(&self, peer: &[u8], path: &[u8]) -> Option<(Identity, Option<u64>)> {
        let depth = |it: &Known| {
            it.directories
                .iter()
                .filter(|it| path.starts_with(it))
                .map(|it| it.len())
                .max()
        };
        let of_peer = self.0.iter().filter(|it| *it.peer == *peer);
        of_peer
            .filter_map(|it| Some((depth(it)?, it)))
            .max_by_key(|it| it.0)
            .map(|it| (it.1.identity.clone(), it.1.pool))
    }

    pub(super) fn for_challenge(&self, peer: &[u8], challenge: &Challenge) -> Option<Login> {
        let fits = |it: &&Known| {
            *it.peer == *peer
                && it.identity.scheme() == challenge.scheme
                && *it.identity.realm == *challenge.realm()
        };
        self.0.iter().find(fits)?.identity.login().cloned()
    }

    pub(super) fn remember(
        &mut self,
        peer: &[u8],
        identity: &Identity,
        path: &[u8],
        pool: Option<u64>,
    ) {
        const MAX_KNOWN: usize = 20;
        const MAX_DIRECTORIES: usize = 10;
        let is_replaced = |it: &Known| {
            *it.peer == *peer
                && it.identity.scheme() == identity.scheme()
                && it.identity.realm == identity.realm
        };
        let mut directories = self
            .0
            .iter()
            .position(is_replaced)
            .map(|at| self.0.remove(at).directories)
            .unwrap_or_default();
        if !directories.iter().any(|it| path.starts_with(it)) {
            directories.insert(0, directory_of(path).into());
            directories.truncate(MAX_DIRECTORIES);
        }
        self.0.insert(
            0,
            Known {
                peer: peer.into(),
                identity: identity.clone(),
                directories,
                pool,
            },
        );
        self.0.truncate(MAX_KNOWN);
    }

    pub(super) fn forget(&mut self, peer: &[u8], identity: &Identity) {
        self.0
            .retain(|it| *it.peer != *peer || !it.identity.is_same(identity));
    }
}

/// Who is to be convinced.
pub(super) struct Peer<'a> {
    pub hostname: &'a [u8],
    /// In the DER format, or empty.
    pub certificate: &'a [u8],
    pub may_act_as_user: bool,
}

enum Round {
    First,
    Ntlm,
    Ambient(gssapi::Context),
    Last,
}

/// On one connection.
pub(super) struct Handshake {
    pub identity: Identity,
    round: Round,
}

fn name_of_ambient(scheme: AuthScheme) -> &'static [u8] {
    match scheme {
        AuthScheme::Ntlm => b"NTLM",
        _ => b"Negotiate",
    }
}

fn with_token(scheme: &[u8], token: &[u8]) -> Vec<u8> {
    [scheme, b" ", &bun_base64::encode_alloc(token)].concat()
}

impl Handshake {
    pub(super) fn new(identity: Identity) -> Handshake {
        Handshake {
            identity,
            round: Round::First,
        }
    }

    pub(super) fn has_started(&self) -> bool {
        !matches!(self.round, Round::First)
    }

    /// May block.
    pub(super) fn start(
        &mut self,
        method: &[u8],
        target: &[u8],
        peer: &Peer<'_>,
    ) -> Option<Vec<u8>> {
        let (value, round) = match &self.identity.secret {
            Secret::Basic(login) => (
                with_token(
                    b"Basic",
                    &[&login.name, &b":"[..], &login.password].concat(),
                ),
                Round::Last,
            ),
            Secret::Digest(login, digest) => (
                digest.respond(login, &self.identity.realm, method, target),
                Round::Last,
            ),
            Secret::Ntlm(_) => (with_token(b"NTLM", &ntlm::negotiate_message()), Round::Ntlm),
            Secret::Ambient(scheme) => {
                let mut context = gssapi::Context::new(*scheme, peer)?;
                (
                    with_token(name_of_ambient(*scheme), &context.step(b"")?),
                    Round::Ambient(context),
                )
            }
        };
        self.round = round;
        Some(value)
    }

    /// `None` if the identity has been refused.
    pub(super) fn go_on(&mut self, challenges: &[Challenge], peer: &Peer<'_>) -> Option<Vec<u8>> {
        let token = &challenges
            .iter()
            .find(|it| it.scheme == self.identity.scheme() && !it.token.is_empty())?
            .token;
        match &mut self.round {
            Round::Ntlm => {
                self.round = Round::Last;
                Some(with_token(
                    b"NTLM",
                    &ntlm::authenticate_message(self.identity.login()?, token, peer)?,
                ))
            }
            Round::Ambient(context) => Some(with_token(
                name_of_ambient(self.identity.scheme()),
                &context.step(token)?,
            )),
            Round::First | Round::Last => None,
        }
    }
}

/// https://www.rfc-editor.org/rfc/rfc5929#section-4
pub(super) fn channel_binding(certificate: &[u8]) -> Vec<u8> {
    let mut hash = [0; 32];
    SHA256::hash(certificate, &mut hash);
    [&b"tls-server-end-point:"[..], &hash].concat()
}
