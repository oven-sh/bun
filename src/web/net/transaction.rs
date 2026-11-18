//! What it takes to get the answer of a server: proxies, certificates and logins.

use core::cell::Cell;
use std::sync::Arc;

use bun_core::strings;
use bun_http::{CertificateInfo, PoolOptions};
use bun_threading::Guarded;

use super::auth::{AuthScheme, Challenge, Handshake, Identity, Login, Peer};
use super::body::Body;
use super::chain;
use super::embedder::{About, Outgoing, Prompt};
use super::error::{NetError, Result};
use super::http::{self, Connection, Progress};
use super::response::Answer;
use super::session::{Session, tls_for, trusts_system};
use super::tls::{self, CertificateRequest, Choice};
use super::tunnel::{self, Refusal, Tunnel, is_socks};
use crate::Bytes;
use crate::exec::{self, LocalFuture};
use crate::headers::HeaderList;
use crate::pattern::glob_matches;
use crate::request::RequestBody;
use crate::url::Url;

pub(super) struct Requester {
    pub about: About,
    pub includes_credentials: bool,
    /// When the server asks for it.
    pub logs_in: bool,
    pub prompts: bool,
    pub login: Option<Login>,
}

/// The attempts to log in to a server or to a proxy.
struct Attempts {
    is_proxy: bool,
    peer: Url,
    key: Bytes,
    given: Option<Login>,
    handshake: Option<Handshake>,
    authorization: Option<Vec<u8>>,
    refused: Vec<Identity>,
    has_prompted: bool,
}

impl Attempts {
    fn new(peer: &Url, is_proxy: bool, given: Option<Login>) -> Attempts {
        let key = [
            if is_proxy { &b"proxy "[..] } else { b"" },
            peer.protocol(),
            peer.host(),
        ]
        .concat()
        .into();
        Attempts {
            is_proxy,
            peer: peer.clone(),
            key,
            given,
            handshake: None,
            authorization: None,
            refused: Vec::new(),
            has_prompted: false,
        }
    }

    fn identity(&self) -> Option<&Identity> {
        self.handshake.as_ref().map(|it| &it.identity)
    }
}

enum Outcome {
    Answer(Answer),
    TunnelChallenge(HeaderList),
    CertificateRequest(CertificateRequest),
}

struct Transaction<'a> {
    session: &'a Arc<Session>,
    request: Outgoing,
    requester: &'a Requester,
    upload: Option<&'a Progress>,
    host: Bytes,
    /// In place of the connections that all requests share.
    pool: Option<u64>,
    /// Of the server, if the pool is this one's.
    certificate: Option<Bytes>,
    judges_certificate: bool,
    has_bad_certificate: Cell<bool>,
    has_judged: Cell<bool>,
}

fn is_listed(patterns: &[u8], host: &[u8]) -> bool {
    strings::tokenize_any(patterns, b",; ").any(|it| glob_matches(&it.to_ascii_lowercase(), host))
}

fn is_about_certificate(error: NetError) -> bool {
    matches!(error as i32, -299..=-200)
}

fn bare_hostname(url: &Url) -> &[u8] {
    strings::trim(url.hostname(), b"[]")
}

impl Transaction<'_> {
    fn can_repeat(&self) -> bool {
        !matches!(self.request.body, Some(RequestBody::Stream(None)))
    }

    fn upgrades(&self) -> bool {
        matches!(self.request.body, Some(RequestBody::Upgrade(_)))
    }

    fn tunnels(&self, proxy: &Url) -> bool {
        self.request.url.scheme() == b"https" || is_socks(proxy) || self.upgrades()
    }

    async fn judge(&self, certificate: CertificateInfo, sent: Vec<Bytes>) -> Result<()> {
        if certificate.error.is_some() {
            let mut hosts = self.session.hosts_with_bad_certificates.lock();
            if !hosts.contains(&self.host) {
                hosts.push(self.host.clone());
            }
        }
        self.has_judged.set(true);
        let about = &self.requester.about;
        let certificate = Arc::new(chain::complete(self.session, about, certificate, sent).await);
        self.has_bad_certificate.set(certificate.error.is_some());
        match self
            .session
            .verify_certificate(Arc::clone(&certificate))
            .await
        {
            Err(error)
                if is_about_certificate(error) && self.requester.about.destination.is_some() =>
            {
                let about = self.requester.about.clone();
                let is_excused = self
                    .session
                    .consult(move |it| it.excuses_certificate(&about, &certificate, error))
                    .await?;
                if is_excused { Ok(()) } else { Err(error) }
            }
            verdict => verdict,
        }
    }

    async fn attempt(
        &mut self,
        proxy: Option<&Attempts>,
        authorization: Option<&[u8]>,
    ) -> Result<Outcome> {
        let (session, url) = (self.session, &self.request.url);
        let mapped = if proxy.is_some() {
            None
        } else {
            session.map_host(url)?
        };
        let mut headers = self.request.headers.clone();
        if mapped.is_some() {
            headers.set(b"host", url.host());
        }
        if let Some(authorization) = authorization {
            headers.set(b"Authorization", authorization);
        }
        let mut tunnel = None;
        if let Some(proxy) = proxy.filter(|it| self.tunnels(&it.peer)) {
            let name = (proxy.peer.scheme() != b"socks5" && is_socks(&proxy.peer))
                .then(|| Bytes::from(url.hostname()));
            let address = if let Some(name) = name {
                exec::blocking(move || tunnel::look_up(&name))
                    .await
                    .flatten()
            } else {
                None
            };
            let user_agent = headers.get_or_empty(b"user-agent");
            tunnel = Some(Arc::new(Guarded::new(Tunnel::new(
                &proxy.peer,
                url,
                &user_agent,
                proxy.identity().cloned(),
                address,
            ))));
        }
        let choice = match session.client_certificates.lock().get(&self.host) {
            _ if !self.requester.includes_credentials => Choice::Nothing,
            known => known.cloned().unwrap_or(Choice::Undecided),
        };
        // Only a handshake in a tunnel can wait for the key, which may ask the user.
        let direct =
            (proxy.is_none() && url.scheme() == b"https" && matches!(choice, Choice::Identity(..)))
                .then(|| mapped.as_ref().unwrap_or(url));
        if let Some(target) = direct {
            tunnel = Some(Arc::new(Guarded::new(Tunnel::direct(target))));
        }
        if url.scheme() == b"https" || proxy.is_some_and(|it| it.peer.scheme() == b"https") {
            chain::read_distrusted().await;
        }
        let judges = self.judges_certificate || session.settings.read().verifies_certificates;
        let keeps_certificates = self.pool.is_some() || judges;
        let handshake = (url.scheme() == b"https")
            .then(|| tls::Handshake::new(choice, bare_hostname(url), keeps_certificates));
        // What a page was excused for is not good enough for the app.
        let is_for_app = self.requester.about.destination.is_none();
        let kind = u64::from(self.requester.includes_credentials)
            + 2 * u64::from(trusts_system())
            + 4 * u64::from(judges)
            + 8 * u64::from(judges && is_for_app);
        let pool = self.pool.map(|first| first + kind).unwrap_or_else(|| {
            match proxy.filter(|it| is_socks(&it.peer)) {
                Some(proxy) => session.pool_for(Some(
                    [&*proxy.key, &self.host, &[kind as u8]].concat().into(),
                )),
                None if tunnel.is_some() && self.upgrades() => session.pool_for(None),
                None => session.pool(kind),
            }
        });
        let address_of = |proxy: &Url| {
            let port = proxy.port_or_default().unwrap_or(1080);
            [
                if proxy.scheme() == b"https" && direct.is_none() {
                    &b"https://"[..]
                } else {
                    b"http://"
                },
                proxy.hostname(),
                format!(":{port}").as_bytes(),
            ]
            .concat()
            .into()
        };
        let for_proxy = |it: &Attempts| {
            it.authorization
                .iter()
                .filter(|_| tunnel.is_none())
                .map(|it| ("Proxy-Authorization", it))
                .collect()
        };
        let (disables_http2, ignores_certificate_errors) = {
            let settings = session.settings.read();
            (settings.disables_http2, settings.ignores_certificate_errors)
        };
        let body = self.request.body.as_mut().map(RequestBody::take);
        let this = &*self;
        let verify = |certificate: CertificateInfo| -> LocalFuture<'_, Result<()>> {
            let sent = handshake.as_ref().map(|it| it.certificates.lock().clone());
            Box::pin(this.judge(certificate, sent.unwrap_or_default()))
        };
        let connection = Connection {
            proxy: (proxy.map(|it| (address_of(&it.peer), for_proxy(it))))
                .or_else(|| direct.map(|it| (address_of(it), HeaderList::default()))),
            tunnel: tunnel.clone(),
            handshake: handshake.clone(),
            tls: tls_for(mapped.as_ref().map(|_| this.request.url.hostname())),
            pool: PoolOptions {
                id: pool,
                offers_h2: !disables_http2 && this.pool.is_none() && !this.upgrades(),
                ..Default::default()
            },
            ignores_certificate_errors,
            verify: if judges && !ignores_certificate_errors {
                Some(&verify)
            } else {
                None
            },
            started: &|it| session.track(it),
        };
        let sent = http::send(
            mapped.as_ref().unwrap_or(&this.request.url),
            &this.request.method,
            &headers,
            body,
            this.upload,
            connection,
        )
        .await;
        let handshake = handshake.map(|it| {
            (
                it.certificates.lock().first().cloned(),
                it.request.lock().take(),
            )
        });
        let (certificate, request) = handshake.unwrap_or_default();
        self.certificate = certificate.or_else(|| self.certificate.take());
        match (
            sent,
            request,
            tunnel.and_then(|it| it.lock().refusal.take()),
        ) {
            (Ok(answer), ..) => Ok(Outcome::Answer(answer)),
            (Err(NetError::Aborted), ..) => Err(NetError::Aborted),
            (Err(_), Some(request), _) => Ok(Outcome::CertificateRequest(request)),
            (Err(_), _, Some(Refusal::Challenge(headers))) => Ok(Outcome::TunnelChallenge(headers)),
            (Err(error), _, None) | (Err(_), _, Some(Refusal::Error(error))) => Err(error),
        }
    }

    async fn select_client_certificate(
        &self,
        CertificateRequest {
            authorities,
            server,
            sent,
        }: CertificateRequest,
    ) -> Result<()> {
        let (ignores_errors, verifies) = {
            let settings = self.session.settings.read();
            (
                settings.ignores_certificate_errors,
                settings.verifies_certificates,
            )
        };
        let session = self.session;
        let accepted = (verifies || server.error.is_some()).then(|| server.cert.clone());
        if !ignores_errors {
            self.judge(server, sent).await?;
        }
        let known = session.client_certificates.lock().get(&self.host).cloned();
        let identity = if let Some(Choice::Identity(identity, _)) = known {
            Some(identity)
        } else {
            let candidates = exec::blocking(move || tls::identities_for(&authorities))
                .await
                .unwrap_or_default();
            let (about, listed) = (self.requester.about.clone(), candidates.clone());
            let at = if candidates.is_empty() {
                None
            } else {
                session
                    .consult(move |it| it.select_client_certificate(&about, &listed))
                    .await?
            };
            at.and_then(|it| candidates.get(it).cloned())
        };
        session.client_certificates.lock().insert(
            self.host.clone(),
            identity.map_or(Choice::Nothing, |it| Choice::Identity(it, accepted)),
        );
        Ok(())
    }

    /// The next message, or the first without `challenges`.
    async fn shake_hands(
        &self,
        attempts: &mut Attempts,
        challenges: Option<Arc<[Challenge]>>,
    ) -> bool {
        let Some(mut handshake) = attempts.handshake.take() else {
            return false;
        };
        let url = &self.request.url;
        let target = [url.path_or_root(), url.search()].concat();
        let (method, hostname) = (
            self.request.method.clone(),
            Bytes::from(bare_hostname(&attempts.peer)),
        );
        let certificate = self
            .certificate
            .clone()
            .filter(|_| !attempts.is_proxy)
            .unwrap_or_default();
        let may_act_as_user = is_listed(&self.session.settings.read().delegates, &hostname);
        let blocks = handshake.identity.login().is_none();
        let step = move || {
            let peer = Peer {
                hostname: &hostname,
                certificate: &certificate,
                may_act_as_user,
            };
            let next = match challenges {
                Some(challenges) => handshake.go_on(&challenges, &peer),
                None => handshake.start(&method, &target, &peer),
            };
            (handshake, next)
        };
        let Some((handshake, next)) = (if blocks {
            exec::blocking(step).await
        } else {
            Some(step())
        }) else {
            return false;
        };
        (attempts.handshake, attempts.authorization) = (Some(handshake), next);
        attempts.authorization.is_some()
    }

    async fn log_in_unasked(&mut self, attempts: &mut Attempts) {
        let path = if attempts.is_proxy {
            b""
        } else {
            self.request.url.path_or_root()
        };
        let Some((identity, pool)) = self.session.logins.lock().for_path(&attempts.key, path)
        else {
            return;
        };
        let is_for_connection = identity.scheme().is_for_connection();
        attempts.handshake = Some(Handshake::new(identity));
        if is_for_connection {
            self.pool = self
                .pool
                .or_else(|| pool.filter(|it| self.session.has_pool(*it)));
        } else {
            self.shake_hands(attempts, None).await;
        }
    }

    async fn find_identity(
        &self,
        attempts: &mut Attempts,
        challenge: &Challenge,
        headers: &HeaderList,
    ) -> Result<Option<Identity>> {
        let is_new = |it: &Identity| !attempts.refused.iter().any(|refused| refused.is_same(it));
        if let Some(ambient) = Identity::new(challenge, None) {
            let is_trusted = attempts.is_proxy
                || is_listed(
                    &self.session.settings.read().trusted_servers,
                    attempts.peer.hostname(),
                );
            let ambient = (is_trusted && is_new(&ambient)).then_some(ambient);
            if ambient.is_some() || challenge.scheme == AuthScheme::Negotiate {
                return Ok(ambient);
            }
        }
        let known = self
            .session
            .logins
            .lock()
            .for_challenge(&attempts.key, challenge);
        let at_hand = [attempts.given.clone(), known]
            .into_iter()
            .flatten()
            .filter_map(|it| Identity::new(challenge, Some(it)))
            .find(is_new);
        if at_hand.is_some() || !(attempts.is_proxy || self.requester.prompts) {
            return Ok(at_hand);
        }
        let prompt = Prompt {
            is_proxy: attempts.is_proxy,
            scheme: challenge.scheme,
            peer: attempts.peer.clone(),
            realm: challenge.realm().into(),
            is_first_attempt: !core::mem::replace(&mut attempts.has_prompted, true),
            headers: headers.clone(),
        };
        let about = self.requester.about.clone();
        let login = (self.session)
            .consult(move |it| it.log_in(&about, prompt))
            .await?;
        Ok(login.and_then(|it| Identity::new(challenge, Some(it))))
    }

    /// Whether to try again. `body` is read if the connection is still needed.
    async fn meet_challenge(
        &mut self,
        attempts: &mut Attempts,
        headers: &HeaderList,
        body: &mut Body,
        is_for_tunnel: bool,
    ) -> Result<bool> {
        let mut challenges = Challenge::parse_all(headers.values(if attempts.is_proxy {
            b"proxy-authenticate"
        } else {
            b"www-authenticate"
        }));
        bun_collections::index_sort::sort_slice_by_key(&mut challenges, |it| {
            core::cmp::Reverse(it.scheme as u8)
        });
        let challenges = Arc::<[Challenge]>::from(challenges);
        let has_tried = attempts
            .handshake
            .as_ref()
            .is_some_and(|it| is_for_tunnel || it.has_started());
        if has_tried
            && !is_for_tunnel
            && self
                .shake_hands(attempts, Some(Arc::clone(&challenges)))
                .await
        {
            const MAX_SKIPPED: usize = 1 << 20;
            if body.peek(MAX_SKIPPED + 1).await?.len() > MAX_SKIPPED {
                return Err(NetError::InvalidHttpResponse);
            }
            return Ok(true);
        }
        let last = attempts.handshake.take().map(|it| it.identity);
        if let Some(refused) = last
            .clone()
            .filter(|_| has_tried && !challenges.iter().any(Challenge::is_stale))
        {
            self.session.logins.lock().forget(&attempts.key, &refused);
            let is_ambient = refused.login().is_none();
            attempts.refused.push(refused);
            // What else it accepts is only said at the start.
            if is_ambient && !is_for_tunnel && challenges.iter().any(Challenge::is_reply) {
                attempts.authorization = None;
                return Ok(true);
            }
        }
        for challenge in challenges.iter() {
            let renewed = last
                .as_ref()
                .filter(|_| challenge.is_stale())
                .and_then(|it| Identity::new(challenge, it.login().cloned()));
            let found = if renewed.is_some() {
                renewed
            } else {
                self.find_identity(attempts, challenge, headers).await?
            };
            let Some(identity) = found else {
                if challenge.scheme == AuthScheme::Negotiate {
                    continue;
                }
                return Ok(false);
            };
            if challenge.scheme.is_for_connection() && !is_for_tunnel {
                let needs_certificate =
                    identity.login().is_none() && self.request.url.scheme() == b"https";
                if !needs_certificate || self.certificate.is_none() {
                    self.pool = Some(self.session.pool_for(None));
                }
                if needs_certificate && self.certificate.is_none() {
                    attempts.authorization = None;
                    return Ok(true);
                }
            }
            attempts.handshake = Some(Handshake::new(identity.clone()));
            if self.shake_hands(attempts, None).await {
                return Ok(true);
            }
            attempts.handshake = None;
            attempts.refused.push(identity);
        }
        Ok(false)
    }

    fn remember(&self, attempts: &Attempts) {
        if let Some(identity) = attempts
            .identity()
            .filter(|_| attempts.authorization.is_some())
        {
            let path = if attempts.is_proxy {
                b""
            } else {
                self.request.url.path_or_root()
            };
            let pool = self
                .pool
                .filter(|_| !attempts.is_proxy || !self.tunnels(&attempts.peer));
            self.session
                .logins
                .lock()
                .remember(&attempts.key, identity, path, pool);
        }
    }

    async fn send_through(&mut self, proxy: Option<&Url>) -> Result<Answer> {
        const MAX_ATTEMPTS: usize = 32;
        let mut proxy = proxy.map(|it| Attempts::new(it, true, Login::of_url(it)));
        let mut server = Attempts::new(&self.request.url, false, self.requester.login.clone());
        if let Some(proxy) = &mut proxy {
            self.log_in_unasked(proxy).await;
        }
        if self.requester.includes_credentials
            && server.given.is_none()
            && !self.request.headers.contains(b"authorization")
        {
            self.log_in_unasked(&mut server).await;
        }
        let mut was_misdirected = false;
        for _ in 0..MAX_ATTEMPTS {
            let has_trusted_system = trusts_system();
            self.has_judged.set(false);
            let tries_again = match self
                .attempt(proxy.as_ref(), server.authorization.as_deref())
                .await
            {
                Ok(Outcome::Answer(mut answer)) => {
                    let challenger = match answer.status {
                        401 => self.requester.logs_in.then_some(&mut server),
                        407 => Some(
                            proxy
                                .as_mut()
                                .filter(|it| !self.tunnels(&it.peer))
                                .ok_or(NetError::UnexpectedProxyAuth)?,
                        ),
                        _ => None,
                    };
                    let tries_again = match challenger.filter(|_| self.can_repeat()) {
                        Some(challenger) => {
                            self.meet_challenge(
                                challenger,
                                &answer.headers,
                                &mut answer.body,
                                false,
                            )
                            .await?
                        }
                        None => {
                            answer.status == 421
                                && self.can_repeat()
                                && !core::mem::replace(&mut was_misdirected, true)
                        }
                    };
                    if let Some(proxy) = proxy.as_mut().filter(|_| answer.status != 407) {
                        self.remember(proxy);
                        proxy.authorization = proxy.authorization.take().filter(|_| {
                            !proxy
                                .identity()
                                .is_some_and(|it| it.scheme().is_for_connection())
                        });
                    }
                    if !tries_again {
                        if !matches!(answer.status, 401 | 407) {
                            self.remember(&server);
                        }
                        return Ok(answer);
                    }
                    if answer.status == 421 {
                        self.pool = Some(self.session.pool_for(None));
                    }
                    Ok(())
                }
                Ok(Outcome::TunnelChallenge(headers)) => {
                    let proxy = proxy.as_mut().ok_or(NetError::ProxyAuthRequested)?;
                    self.meet_challenge(proxy, &headers, &mut Body::default(), true)
                        .await?
                        .then_some(())
                        .ok_or(NetError::ProxyAuthRequested)
                }
                Ok(Outcome::CertificateRequest(request)) => {
                    self.select_client_certificate(request).await
                }
                Err(error) => Err(error),
            };
            match tries_again {
                Err(NetError::CertAuthorityInvalid) if !has_trusted_system => {
                    self.session.trust_system().await?
                }
                Err(error)
                    if is_about_certificate(error)
                        && !self.judges_certificate
                        && !self.has_judged.get()
                        && (self.requester.about.destination.is_some()
                            || error == NetError::CertAuthorityInvalid) =>
                {
                    self.judges_certificate = true;
                }
                other => other?,
            }
            if !self.can_repeat() {
                return Err(tries_again.err().unwrap_or(NetError::Failed));
            }
        }
        Err(NetError::TooManyRetries)
    }
}

pub(super) async fn send(
    session: &Arc<Session>,
    request: Outgoing,
    requester: &Requester,
    upload: Option<&Progress>,
) -> Result<Answer> {
    use NetError::*;
    let is_for_socket = matches!(request.body, Some(RequestBody::Upgrade(_)));
    let routed = if is_for_socket {
        &requester.about.url
    } else {
        &request.url
    };
    let route = session.route(routed).await?;
    let host = Bytes::from(request.url.host());
    let was_bad = session.hosts_with_bad_certificates.lock().contains(&host);
    let has_bad_certificate =
        Cell::new(was_bad || session.settings.read().ignores_certificate_errors);
    let mut transaction = Transaction {
        session,
        request,
        requester,
        upload,
        host,
        pool: None,
        certificate: None,
        judges_certificate: was_bad,
        has_bad_certificate,
        has_judged: Cell::new(false),
    };
    let mut failure = ProxyConnectionFailed;
    for proxy in &route {
        failure = match transaction.send_through(proxy.as_ref()).await {
            Ok(answer) => {
                let is_secure = transaction.request.url.scheme() == b"https"
                    && !transaction.has_bad_certificate.get();
                if let Some(policy) = answer
                    .headers
                    .values(b"strict-transport-security")
                    .next()
                    .filter(|_| is_secure)
                {
                    session.hsts.receive(&transaction.request.url, policy);
                }
                return Ok(answer);
            }
            Err(ConnectionRefused | NameNotResolved | InternetDisconnected | TimedOut)
                if proxy.is_some() =>
            {
                ProxyConnectionFailed
            }
            Err(SocksConnectionFailed) => SocksConnectionFailed,
            Err(ProxyAuthRequested) => return Err(TunnelConnectionFailed),
            Err(error) => return Err(error),
        };
        if !transaction.can_repeat() {
            break;
        }
        transaction.pool = None;
    }
    Err(failure)
}
