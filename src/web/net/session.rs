//! What the requests of a profile have in common.

use core::cell::RefCell;
use core::future::Future;
use core::mem::ManuallyDrop;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use core::time::Duration;
use std::rc::Rc;
use std::sync::{Arc, Weak};

use bun_collections::HashMap;
use bun_core::{SensitiveCString, ZBox, strings};
use bun_http::ssl_config::{SSLConfig, SharedPtr as Tls, global_registry};
use bun_http::{CertificateInfo, HTTPThread};
use bun_sys::{Fd, File, O};
use bun_threading::{Guarded, RwLock};

use super::auth::Logins;
use super::cache::HttpCache;
use super::checks::Allowed;
use super::cookies::{Cause, Change, Cookie, Jar, SameSite};
use super::embedder::{About, Decision, Details, Embedder, RequestEvent, ResourceType, Verdict};
use super::error::{NetError, Result};
use super::hsts::Hsts;
use super::http::{self, Exchange};
use super::proxy;
use super::record::{RecordReader, RecordWriter};
use super::tls::{self, Choice};
use super::tunnel::is_socks;
use crate::Bytes;
use crate::exec::{self, Thread};
use crate::locks::LockManager;
use crate::origin::{Origin, Site, registrable_domain};
use crate::pattern::{UrlFilter, glob_matches};
use crate::storage::Storage;
use crate::url::Url;

const POOL_KINDS: u64 = 16;
const COOKIE_FORMAT: &[u8] = b"cookies 1";

pub struct Listener {
    pub urls: UrlFilter,
    /// None means all.
    pub types: Vec<ResourceType>,
}

#[derive(Default)]
pub struct Settings {
    pub listeners: [Option<Listener>; 8],
    pub handled_schemes: Vec<Bytes>,
    pub served_origins: Vec<Origin>,
    pub web_engine_hosts: Vec<Bytes>,
    pub host_resolver_rules: Bytes,
    pub verifies_certificates: bool,
    pub ignores_certificate_errors: bool,
    pub disables_http2: bool,
    /// Patterns of the hosts that may learn who is logged in to the system.
    pub trusted_servers: Bytes,
    /// And of those that may act as that user.
    pub delegates: Bytes,
    pub reports_answers: bool,
}

pub type CookieWatcher = Box<dyn Fn(&Change) + Send>;

pub struct Session {
    id: u32,
    main: Thread,
    directory: Option<Bytes>,
    pub settings: RwLock<Settings>,
    pub cache: Arc<HttpCache>,
    pub storage: Arc<Storage>,
    pub(super) preflights: Guarded<HashMap<Bytes, Allowed>>,
    pub(super) logins: Guarded<Logins>,
    /// By host and port.
    pub(super) client_certificates: Guarded<HashMap<Bytes, Choice>>,
    pub(super) hosts_with_bad_certificates: Guarded<Vec<Bytes>>,
    issuers: Guarded<HashMap<Bytes, Vec<Bytes>>>,
    pub(super) hsts: Hsts,
    jar: Guarded<Jar>,
    has_loaded_cookies: AtomicBool,
    has_read_cookies: AtomicBool,
    has_unsaved_cookies: AtomicBool,
    cookie_watchers: Guarded<Vec<(u32, CookieWatcher)>>,
    locks: Guarded<HashMap<Bytes, LockManager>>,
    pool: AtomicU64,
    special_pools: Guarded<Vec<(Option<Bytes>, u64)>>,
    exchanges: Guarded<Vec<Weak<Exchange>>>,
    proxy: RwLock<proxy::Config>,
    has_used_network: AtomicBool,
}

thread_local! {
    static EMBEDDERS: ManuallyDrop<RefCell<Vec<(u32, Rc<dyn Embedder>)>>> = ManuallyDrop::default();
}

static SESSIONS: RwLock<Vec<Arc<Session>>> = RwLock::new(Vec::new());

/// Reading those of the system is slow, so that waits for a server that needs them.
static AUTHORITIES: RwLock<Option<Vec<Bytes>>> = RwLock::new(None);

fn next_pool() -> u64 {
    // `Bun.FetchSession` counts from 1.
    static NEXT: AtomicU64 = AtomicU64::new(1 << 62);
    NEXT.fetch_add(POOL_KINDS, Ordering::Relaxed)
}

fn close_pools(first: u64) {
    (first..first + POOL_KINDS).for_each(HTTPThread::schedule_pool_close);
}

pub fn next_request_id() -> u32 {
    static NEXT: AtomicU32 = AtomicU32::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

static IS_ANY_INSPECTED: AtomicBool = AtomicBool::new(false);

/// A debugger watches the requests of some page.
pub fn is_any_inspected() -> bool {
    IS_ANY_INSPECTED.load(Ordering::Relaxed)
}

pub fn set_any_inspected() {
    IS_ANY_INSPECTED.store(true, Ordering::Relaxed);
}

pub(super) fn trusts_system() -> bool {
    AUTHORITIES.read().is_some()
}

pub fn authorities() -> Option<Vec<Bytes>> {
    AUTHORITIES.read().clone()
}

pub(super) fn tls_for(server_name: Option<&[u8]>) -> Option<Tls> {
    static WITHOUT_NAME: Guarded<Option<Tls>> = Guarded::new(None);
    let authorities = AUTHORITIES.read();
    let make = || {
        let mut config = SSLConfig::zero();
        config.server_name = server_name.map(SensitiveCString::new);
        config.ca = authorities
            .as_ref()
            .map(|it| it.iter().map(|it| SensitiveCString::new(it)).collect());
        config.requires_custom_request_ctx = true;
        global_registry::intern(config)
    };
    match (server_name, &*authorities) {
        (None, None) => None,
        (None, Some(_)) => Some(WITHOUT_NAME.lock().get_or_insert_with(make).clone()),
        (Some(_), _) => Some(make()),
    }
}

impl Session {
    /// On the main thread.
    pub fn new(
        directory: Option<&[u8]>,
        embedder: impl FnOnce(u32) -> Rc<dyn Embedder>,
    ) -> Arc<Session> {
        Session::make(directory, |id| Some(embedder(id)))
    }

    /// It has nobody to ask.
    pub(crate) fn without_embedder() -> Arc<Session> {
        Session::make(None, |_| None)
    }

    fn make(
        directory: Option<&[u8]>,
        embedder: impl FnOnce(u32) -> Option<Rc<dyn Embedder>>,
    ) -> Arc<Session> {
        let mut sessions = SESSIONS.write();
        let id = sessions.len() as u32;
        EMBEDDERS.with(|it| it.borrow_mut().extend(embedder(id).map(|it| (id, it))));
        let session = Arc::new(Session {
            id,
            main: Thread::current(),
            directory: directory.map(Bytes::from),
            settings: RwLock::new(Settings::default()),
            cache: Arc::new(HttpCache::new(directory)),
            storage: Storage::new(directory),
            preflights: Guarded::default(),
            logins: Guarded::default(),
            client_certificates: Guarded::default(),
            hosts_with_bad_certificates: Guarded::default(),
            issuers: Guarded::default(),
            hsts: Hsts::new(directory),
            jar: Guarded::default(),
            has_loaded_cookies: AtomicBool::new(false),
            has_read_cookies: AtomicBool::new(false),
            has_unsaved_cookies: AtomicBool::new(false),
            cookie_watchers: Guarded::default(),
            locks: Guarded::default(),
            pool: AtomicU64::new(next_pool()),
            special_pools: Guarded::default(),
            exchanges: Guarded::default(),
            proxy: RwLock::new(proxy::Config::System),
            has_used_network: AtomicBool::new(false),
        });
        sessions.push(Arc::clone(&session));
        session
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn find(id: u32) -> Arc<Session> {
        Arc::clone(&SESSIONS.read()[id as usize])
    }

    fn embedder(id: u32) -> Option<Rc<dyn Embedder>> {
        EMBEDDERS.with(|it| Some(Rc::clone(&it.borrow().iter().find(|it| it.0 == id)?.1)))
    }

    pub(super) fn notify(&self, steps: impl FnOnce(&dyn Embedder) + Send + 'static) {
        let id = self.id;
        self.main
            .run(move || Session::embedder(id).map_or((), |it| steps(&*it)));
    }

    pub(super) async fn consult<T: Send + 'static, F: Future<Output = Result<T>> + 'static>(
        &self,
        start: impl FnOnce(&dyn Embedder) -> F + Send + 'static,
    ) -> Result<T> {
        let id = self.id;
        self.main
            .call(move || {
                let asking = Session::embedder(id).map(|it| start(&*it));
                async { asking.ok_or(NetError::Failed)?.await }
            })
            .await
            .unwrap_or(Err(NetError::Aborted))
    }

    pub(super) fn later(&self, steps: impl FnOnce() + Send + 'static) {
        self.main.post(steps);
    }

    pub fn handles(&self, scheme: &[u8]) -> bool {
        self.settings
            .read()
            .handled_schemes
            .iter()
            .any(|it| **it == *scheme)
    }

    pub fn serves(&self, url: &Url) -> bool {
        self.settings
            .read()
            .served_origins
            .iter()
            .any(|it| it.is_origin_of(url))
    }

    pub(super) fn is_for_web_engine(&self, url: &Url) -> bool {
        self.settings
            .read()
            .web_engine_hosts
            .iter()
            .any(|it| glob_matches(it, url.hostname()) || glob_matches(it, url.host()))
    }

    pub fn listens(&self, event: RequestEvent, about: &About) -> bool {
        let is_socket_of_app =
            about.destination.is_none() && !about.url.is_http() && about.url.is_http_or_ws();
        self.settings.read().listeners[event as usize]
            .as_ref()
            .is_some_and(|it| {
                !is_socket_of_app
                    && it.urls.matches(&about.url)
                    && (it.types.is_empty() || it.types.contains(&about.resource_type))
            })
    }

    pub(super) fn tell(
        self: &Arc<Self>,
        event: RequestEvent,
        about: &About,
        details: impl FnOnce() -> Details,
    ) {
        if about.is_inspected || self.listens(event, about) {
            let (about, details) = (about.clone(), details());
            self.notify(move |it| it.tell(event, &about, details));
        }
    }

    pub(super) async fn ask(
        &self,
        event: RequestEvent,
        about: &About,
        details: impl FnOnce() -> Details,
    ) -> Result<Decision> {
        if !self.listens(event, about) {
            return Ok(Decision::default());
        }
        let (about, details) = (about.clone(), details());
        let decision = self
            .consult(move |it| it.ask(event, &about, details))
            .await?;
        if decision.cancels {
            Err(NetError::BlockedByClient)
        } else {
            Ok(decision)
        }
    }

    /// Where `--host-resolver-rules` sends what is for `url`.
    pub fn map_host(&self, url: &Url) -> Result<Option<Url>> {
        let settings = self.settings.read();
        let with_port = [
            url.hostname(),
            format!(":{}", url.port_or_default().unwrap_or(80)).as_bytes(),
        ]
        .concat();
        let mut target = None;
        for rule in strings::split(&settings.host_resolver_rules, b",") {
            let mut words = strings::tokenize_any(rule, b" \t");
            let (Some(kind), Some(pattern)) =
                (words.next(), words.next().map(<[u8]>::to_ascii_lowercase))
            else {
                continue;
            };
            if glob_matches(&pattern, url.hostname()) || glob_matches(&pattern, &with_port) {
                if kind.eq_ignore_ascii_case(b"exclude") {
                    return Ok(None);
                }
                target =
                    target.or_else(|| words.next().filter(|_| kind.eq_ignore_ascii_case(b"map")));
            }
        }
        match target {
            Some([b'~' | b'^', rest @ ..]) if rest.eq_ignore_ascii_case(b"notfound") => {
                Err(NetError::NameNotResolved)
            }
            _ => Ok(target.and_then(|it| url.with_host(it))),
        }
    }

    pub async fn resolve_proxy(&self, url: &Url) -> Result<proxy::Route> {
        let config = self.proxy.read().clone();
        config.resolve(url, &self.main).await
    }

    pub async fn route(&self, url: &Url) -> Result<proxy::Route> {
        if !self.has_used_network.swap(true, Ordering::Relaxed) {
            self.notify(|it| it.network_is_used());
        }
        let mut proxies = self.resolve_proxy(url).await?;
        proxies.retain(|it| it.as_ref().is_none_or(|it| it.is_http() || is_socks(it)));
        if proxies.is_empty() {
            Err(NetError::NoSupportedProxies)
        } else {
            Ok(proxies)
        }
    }

    pub async fn verify_certificate(&self, certificate: Arc<CertificateInfo>) -> Result<()> {
        let error = certificate.error.map(|it| http::error_of(it, 0));
        let asks = self.settings.read().verifies_certificates;
        match if asks {
            self.consult(move |it| it.verify_certificate(&certificate, error))
                .await?
        } else {
            Verdict::AsVerified
        } {
            Verdict::Accept => Ok(()),
            Verdict::Refuse => Err(NetError::Failed),
            Verdict::AsVerified => error.map_or(Ok(()), Err),
        }
    }

    pub(super) async fn issuers_at<F: Future<Output = Option<Vec<Bytes>>>>(
        &self,
        url: Url,
        download: impl FnOnce(Url) -> F,
    ) -> Option<Vec<Bytes>> {
        const MAX_KEPT: usize = 64;
        let key = Bytes::from(url.href());
        if let Some(known) = self.issuers.lock().get(&key) {
            return Some(known.clone());
        }
        let found = download(url).await?;
        let mut issuers = self.issuers.lock();
        if issuers.len() == MAX_KEPT {
            issuers.clear();
        }
        issuers.insert(key, found.clone());
        Some(found)
    }

    pub fn set_proxy(&self, config: proxy::Config) {
        *self.proxy.write() = config;
        self.renew_pool();
    }

    pub fn reload_proxy(&self) {
        proxy::reload();
        self.renew_pool();
    }

    pub(super) fn track(&self, exchange: &Arc<Exchange>) {
        let mut exchanges = self.exchanges.lock();
        if exchanges.len() == exchanges.capacity() {
            exchanges.retain(|it| it.strong_count() > 0);
            let left = exchanges.len();
            exchanges.reserve(left.max(16));
        }
        exchanges.push(Arc::downgrade(exchange));
    }

    /// `kind` is below [`POOL_KINDS`].
    pub(super) fn pool(&self, kind: u64) -> u64 {
        self.pool.load(Ordering::Relaxed) + kind
    }

    /// For connections that are only good for what `key` names.
    pub(super) fn pool_for(&self, key: Option<Bytes>) -> u64 {
        const MAX_POOLS: usize = 256;
        let mut pools = self.special_pools.lock();
        if let Some(known) = pools.iter().find(|it| key.is_some() && it.0 == key) {
            return known.1;
        }
        if pools.len() == MAX_POOLS {
            close_pools(pools.remove(0).1);
        }
        pools.push((key, next_pool()));
        pools[pools.len() - 1].1
    }

    pub(super) async fn trust_system(&self) -> Result<()> {
        let of_user = exec::blocking(|| tls::authorities_of_user().collect::<Vec<_>>())
            .await
            .unwrap_or_default();
        self.consult(|it| {
            if AUTHORITIES.read().is_none() {
                *AUTHORITIES.write() = Some([it.system_authorities(), of_user].concat());
            }
            core::future::ready(Ok(()))
        })
        .await
    }

    pub fn close_idle_connections(&self) {
        if bun_http::http_thread::is_initialized() {
            close_pools(self.pool.load(Ordering::Relaxed));
            for (_, first) in &*self.special_pools.lock() {
                close_pools(*first);
            }
        }
    }

    pub fn renew_pool(&self) {
        self.close_idle_connections();
        self.special_pools.lock().clear();
        self.pool.store(next_pool(), Ordering::Relaxed);
    }

    pub(super) fn renew_all_pools() {
        SESSIONS.read().iter().for_each(|it| it.renew_pool());
    }

    pub(super) fn has_pool(&self, first: u64) -> bool {
        self.special_pools.lock().iter().any(|it| it.1 == first)
    }

    pub fn disconnect(&self, reason: NetError, includes_loopback: bool) {
        for exchange in self.exchanges.lock().iter().filter_map(Weak::upgrade) {
            if includes_loopback || !exchange.is_for_loopback() {
                exchange.abort(reason);
            }
        }
        self.close_idle_connections();
    }

    pub(crate) fn locks_of(&self, bucket: &[u8]) -> LockManager {
        self.locks.lock().entry(bucket.into()).or_default().clone()
    }

    pub(crate) async fn source_of(&self, url: &Url) -> Result<Option<Vec<u8>>> {
        let url = url.clone();
        self.consult(move |it| it.source_of(&url)).await
    }

    pub fn clear_logins(&self) {
        *self.logins.lock() = Logins::default();
        self.client_certificates.lock().clear();
        self.renew_pool();
    }

    fn cookie_file(&self, suffix: &[u8]) -> Option<ZBox> {
        Some(ZBox::from_bytes(
            [self.directory.as_deref()?, b"/Cookie Jar", suffix].concat(),
        ))
    }

    fn load_cookies(&self) {
        if self.has_loaded_cookies.swap(true, Ordering::AcqRel) {
            return;
        }
        self.read_cookies();
        let embedder = Session::embedder(self.id).filter(|it| it.encrypt(b"").is_some());
        let imported = match embedder {
            Some(embedder) => self.storage.import_cookies(&|it| embedder.decrypt(it)),
            None => Vec::new(),
        };
        self.has_unsaved_cookies
            .store(!imported.is_empty(), Ordering::Release);
        self.jar.lock().restore(imported);
        self.flush_cookies();
    }

    /// The key may come later than the first request.
    fn read_cookies(&self) -> Option<()> {
        (!self.has_read_cookies.load(Ordering::Acquire)).then_some(())?;
        let encrypted = File::read_from(Fd::cwd(), self.cookie_file(b"")?.as_bytes()).ok()?;
        let stored = parse_cookies(&Session::embedder(self.id)?.decrypt(&encrypted)?)?;
        self.jar.lock().restore(stored);
        self.has_read_cookies.store(true, Ordering::Release);
        Some(())
    }

    /// Before [`with_cookies`](Self::with_cookies), on another thread than the main one.
    pub async fn cookies_loaded(self: &Arc<Self>) {
        if !self.has_loaded_cookies.load(Ordering::Acquire) {
            let session = Arc::clone(self);
            self.main
                .call(move || async move { session.load_cookies() })
                .await;
        }
    }

    pub fn with_cookies<R>(self: &Arc<Self>, steps: impl FnOnce(&mut Jar) -> R) -> R {
        if !self.has_loaded_cookies.load(Ordering::Acquire) && self.main.is_current() {
            self.load_cookies();
        }
        let (result, changes) = {
            let mut jar = self.jar.lock();
            (steps(&mut jar), jar.take_changes())
        };
        if !changes.is_empty() {
            self.cookies_changed(changes);
        }
        result
    }

    fn cookies_changed(self: &Arc<Self>, changes: Vec<super::cookies::Change>) {
        for (_, watcher) in self.cookie_watchers.lock().iter() {
            changes.iter().for_each(watcher);
        }
        let saves = changes.iter().any(|it| it.cookie.expires.is_some())
            && !self.has_unsaved_cookies.swap(true, Ordering::AcqRel);
        let session = Arc::clone(self);
        self.notify(move |embedder| {
            changes.iter().for_each(|it| embedder.cookie_changed(it));
            if saves {
                exec::spawn_background(async move {
                    exec::sleep(Duration::from_secs(1)).await;
                    session.flush_cookies();
                });
            }
        });
    }

    /// Of the sites of `urls`, or of all others.
    pub fn clear_cookies(self: &Arc<Self>, urls: &[Url], is_listed: bool) {
        let is_of_site = |cookie: &Cookie, url: &Url| {
            registrable_domain(url.hostname()) == registrable_domain(&cookie.domain)
        };
        self.with_cookies(|jar| {
            jar.remove_if(Cause::Explicit, |it| {
                urls.iter().any(|url| is_of_site(it, url)) == is_listed
            })
        });
    }

    /// `watcher` is called on the thread that makes the change.
    pub fn watch_cookies(&self, id: u32, watcher: Option<CookieWatcher>) {
        let mut watchers = self.cookie_watchers.lock();
        watchers.retain(|it| it.0 != id);
        watchers.extend(watcher.map(|it| (id, it)));
    }

    /// On the main thread.
    pub fn flush_cookies(&self) -> Option<()> {
        self.has_unsaved_cookies
            .swap(false, Ordering::AcqRel)
            .then_some(())?;
        let (partial, file) = (self.cookie_file(b"~")?, self.cookie_file(b"")?);
        self.read_cookies();
        let plain = serialize_cookies(self.jar.lock().all());
        let encrypted = Session::embedder(self.id)?.encrypt(&plain)?;
        File::make_open(
            partial.as_bytes(),
            O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC,
            0o600,
        )
        .ok()?
        .write_all(&encrypted)
        .ok()?;
        self.has_read_cookies.store(true, Ordering::Release);
        bun_sys::rename(&partial, &file).ok()
    }
}

fn serialize_cookies(cookies: &[Cookie]) -> Vec<u8> {
    let mut record = RecordWriter::default();
    record.bytes(COOKIE_FORMAT);
    record.count(cookies.iter().filter(|it| it.expires.is_some()).count());
    for (cookie, expires) in cookies.iter().filter_map(|it| Some((it, it.expires?))) {
        let partition = cookie.partition.as_ref().map_or(&b""[..], Site::as_bytes);
        for it in [
            &cookie.name,
            &cookie.value,
            &cookie.domain,
            &cookie.path,
            cookie.same_site.as_bytes(),
            partition,
        ] {
            record.bytes(it);
        }
        record.bytes(&[cookie.is_host_only, cookie.is_secure, cookie.is_http_only].map(u8::from));
        record.number(expires);
        record.number(cookie.created);
    }
    record.0
}

fn parse_cookies(bytes: &[u8]) -> Option<Vec<Cookie>> {
    let mut record = RecordReader(bytes);
    (record.bytes()? == COOKIE_FORMAT).then_some(())?;
    record.list(|it| {
        let (name, value, domain, path) = (
            it.bytes()?.into(),
            it.bytes()?.into(),
            it.bytes()?.into(),
            it.bytes()?.into(),
        );
        let (same_site, partition) = (SameSite::parse(it.bytes()?)?, it.bytes()?);
        let [is_host_only, is_secure, is_http_only] =
            <[u8; 3]>::try_from(it.bytes()?).ok()?.map(|it| it != 0);
        let partition = (!partition.is_empty()).then(|| Site::from_serialized(partition));
        let (expires, created) = (Some(it.number()?), it.number()?);
        Some(Cookie {
            name,
            value,
            domain,
            is_host_only,
            path,
            is_secure,
            is_http_only,
            expires,
            same_site,
            partition,
            created,
        })
    })
}
