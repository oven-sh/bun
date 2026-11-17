//! Which proxy a request goes through.

use core::future::Future;
use core::time::Duration;
use std::net::{IpAddr, ToSocketAddrs, UdpSocket};
use std::sync::Arc;

use bun_core::strings;
use bun_pac::{Script, is_in_network};
use bun_threading::Guarded;

use super::error::{NetError, Result};
use super::{http, schemes, system_proxy};
use crate::Bytes;
use crate::exec::{Either, Sender, Thread, blocking, oneshot, race, sleep, spawn};
use crate::pattern::glob_matches;
use crate::serial::Serial;
use crate::time::wall_now;
use crate::url::Url;

const SETTINGS_LIFETIME: f64 = 60.0;
const SCRIPT_LIFETIME: f64 = 2.0 * 60.0 * 60.0;
const MAX_SCRIPT_LEN: usize = 1 << 22;
const MAX_REDIRECTS: u8 = 5;

/// In the order in which to try them. `None` is no proxy.
pub type Route = Vec<Option<Url>>;

#[derive(Clone, Default)]
pub enum Config {
    Direct,
    #[default]
    System,
    AutoDetect,
    Script {
        url: Bytes,
        is_optional: bool,
    },
    Fixed {
        rules: Bytes,
        bypass: Bytes,
    },
}

fn direct() -> Route {
    vec![None]
}

fn is_local(host: &[u8]) -> bool {
    host == b"localhost"
        || host.ends_with(b".localhost")
        || [
            &b"127.0.0.0/8"[..],
            b"169.254.0.0/16",
            b"::1/128",
            b"fe80::/10",
        ]
        .iter()
        .any(|it| is_in_network(host, it))
}

fn bypasses(url: &Url, rules: &[u8]) -> bool {
    let (rules, name) = (
        || strings::tokenize_any(rules, b"\t\n\r ,;"),
        url.hostname(),
    );
    if is_local(name) && !rules().any(|it| it == b"<-loopback>") {
        return true;
    }
    rules().map(<[u8]>::to_ascii_lowercase).any(|rule| {
        let (scheme, pattern) =
            strings::split_once(&rule, b"://").unwrap_or_else(|| (url.scheme(), &rule));
        match pattern {
            b"<local>" => !strings::contains_any(name, b".:"),
            _ if scheme != url.scheme() => false,
            _ if strings::contains_char(pattern, b'/') => is_in_network(name, pattern),
            [b'.', ..] => [name, url.host()].iter().any(|it| it.ends_with(pattern)),
            _ => [name, url.host()]
                .iter()
                .any(|it| glob_matches(pattern, it)),
        }
    })
}

fn proxy_at(scheme: &[u8], address: &[u8]) -> Option<Url> {
    Url::parse(&[scheme, b"://", address].concat())
}

fn from_rules(url: &Url, rules: &[u8], bypass: &[u8]) -> Route {
    if bypasses(url, bypass) {
        return direct();
    }
    let rules = || {
        strings::split(rules, b";")
            .map(|it| {
                strings::split_once_char(it.trim_ascii(), b'=')
                    .unwrap_or_else(|| (b"", it.trim_ascii()))
            })
            .filter(|it| !it.1.is_empty())
    };
    let wanted: &[&[u8]] = match url.scheme() {
        b"http" => &[b"", b"http", b"socks"],
        b"https" => &[b"", b"https", b"socks"],
        _ => &[b"", b"socks", b"https", b"http"],
    };
    let Some((kind, proxies)) = wanted
        .iter()
        .find_map(|kind| rules().filter(|it| it.0 == *kind).last())
    else {
        return direct();
    };
    let implied: &[u8] = if kind == b"socks" { b"socks4" } else { b"http" };
    let parse = |it: &[u8]| match strings::split_once(it, b"://").unwrap_or((implied, it)) {
        (b"direct", _) => Some(None),
        (scheme, address) => proxy_at(scheme, address).map(Some),
    };
    strings::split(proxies, b",")
        .filter_map(|it| parse(it.trim_ascii()))
        .collect()
}

fn from_answer(answer: &[u8]) -> Route {
    let parse = |part: &[u8]| {
        let mut words = strings::tokenize_any(part, b"\t\n\r ");
        let scheme: &[u8] = match &*words.next()?.to_ascii_uppercase() {
            b"DIRECT" => return Some(None),
            b"PROXY" | b"HTTP" => b"http",
            b"HTTPS" => b"https",
            b"SOCKS" | b"SOCKS4" => b"socks4",
            b"SOCKS5" => b"socks5",
            _ => return None,
        };
        proxy_at(scheme, words.next()?).map(Some)
    };
    Some(strings::split(answer, b";").filter_map(parse).collect())
        .filter(|it: &Route| !it.is_empty())
        .unwrap_or_else(direct)
}

/// As a script would give it.
pub fn to_answer(route: &[Option<Url>]) -> Vec<u8> {
    let describe = |proxy: &Option<Url>| {
        let Some(proxy) = proxy else {
            return b"DIRECT".to_vec();
        };
        let keyword: &[u8] = match proxy.scheme() {
            b"http" => b"PROXY ",
            b"https" => b"HTTPS ",
            b"socks4" => b"SOCKS ",
            _ => b"SOCKS5 ",
        };
        [
            keyword,
            proxy.hostname(),
            b":",
            proxy
                .port_or_default()
                .unwrap_or(1080)
                .to_string()
                .as_bytes(),
        ]
        .concat()
    };
    route
        .iter()
        .map(describe)
        .collect::<Vec<_>>()
        .join(&b"; "[..])
}

struct Known<T> {
    value: Option<T>,
    expires: f64,
    is_being_read: bool,
    waiting: Vec<Sender<T>>,
}

/// What has been read stays in use while it is read again.
struct Cached<T>(Guarded<Known<T>>);

impl<T: Clone + Send + 'static> Cached<T> {
    fn new() -> Arc<Self> {
        Arc::new(Cached(Guarded::new(Known {
            value: None,
            expires: 0.0,
            is_being_read: false,
            waiting: Vec::new(),
        })))
    }

    async fn get<F: Future<Output = Option<T>> + 'static>(
        self: Arc<Self>,
        main: &Thread,
        lifetime: f64,
        read: impl FnOnce() -> F + Send + 'static,
    ) -> Option<T> {
        let (sender, receiver) = oneshot();
        let starts = {
            let mut known = self.0.lock();
            match &known.value {
                Some(value) => sender.send(value.clone()),
                None => known.waiting.push(sender),
            }
            known.expires <= wall_now() && !core::mem::replace(&mut known.is_being_read, true)
        };
        if starts {
            main.run(move || spawn(async move { self.finish(read().await, lifetime) }));
        }
        receiver.await
    }

    fn finish(&self, value: Option<T>, lifetime: f64) {
        let mut known = self.0.lock();
        known.value = value.or_else(|| known.value.take());
        known.expires = if known.value.is_some() {
            wall_now() + lifetime
        } else {
            0.0
        };
        known.is_being_read = false;
        for sender in core::mem::take(&mut known.waiting) {
            if let Some(value) = &known.value {
                sender.send(value.clone());
            }
        }
    }
}

struct ThisMachine;

impl bun_pac::Host for ThisMachine {
    fn resolve(&self, name: &[u8]) -> Vec<IpAddr> {
        let found = core::str::from_utf8(name)
            .ok()
            .and_then(|it| (it, 0).to_socket_addrs().ok());
        let mut addresses: Vec<_> = found.into_iter().flatten().map(|it| it.ip()).collect();
        addresses.dedup();
        addresses
    }

    /// Those that the routes to the internet and to private networks start at. Nothing is sent.
    fn own_addresses(&self) -> Vec<IpAddr> {
        let source_for = |target: &&str| {
            let target: IpAddr = target.parse().ok()?;
            let socket = UdpSocket::bind(if target.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            })
            .ok()?;
            socket.connect((target, 80)).ok()?;
            Some(socket.local_addr().ok()?.ip())
        };
        let routes: [&[&str]; 2] = [
            &["8.8.8.8", "2001:4860:4860::8888"],
            &["10.0.0.0", "172.16.0.0", "192.168.0.0", "fc00::"],
        ];
        routes
            .iter()
            .map(|it| it.iter().filter_map(source_for).collect())
            .find(|it: &Vec<_>| !it.is_empty())
            .unwrap_or_default()
    }

    fn now(&self) -> f64 {
        bun_core::time::milli_timestamp() as f64
    }

    fn offset_at(&self, time: f64) -> f64 {
        unsafe extern "C" {
            safe fn Bun__DesktopHost__localTimeOffset(time: f64) -> f64;
        }
        Bun__DesktopHost__localTimeOffset(time)
    }
}

struct Loaded {
    script: Guarded<Script>,
    /// It takes one thread of the pool at most, however many ask.
    questions: Arc<Serial>,
}

impl Loaded {
    async fn ask(self: Arc<Self>, url: &Url) -> Option<Route> {
        let (scheme, path): (&[u8], _) = match url.scheme() {
            b"https" | b"wss" => (b"https", b"/".to_vec()),
            b"ws" => (b"http", [url.path_or_root(), url.search()].concat()),
            scheme => (scheme, [url.path_or_root(), url.search()].concat()),
        };
        let (shown, host) = (
            [scheme, b"://", url.host(), &path].concat(),
            strings::trim(url.hostname(), b"[]").to_vec(),
        );
        let answer = Arc::clone(&self.questions)
            .run(move || self.script.lock().find(&shown, &host, &ThisMachine))
            .await?;
        Some(from_answer(&answer.ok()?))
    }
}

async fn download(mut url: Url) -> Option<Vec<u8>> {
    for _ in 0..=MAX_REDIRECTS {
        let answer = match url.scheme() {
            b"data" => schemes::fetch_data(&url),
            b"file" => schemes::fetch_file(&url, &Default::default()).await,
            _ => {
                http::send(
                    &url,
                    b"GET",
                    &Default::default(),
                    None,
                    None,
                    http::Connection::direct(),
                )
                .await
            }
        };
        let mut answer = answer.ok()?;
        match answer.status {
            200..300 => {
                return answer
                    .body
                    .peek(MAX_SCRIPT_LEN + 1)
                    .await
                    .ok()
                    .filter(|it| it.len() <= MAX_SCRIPT_LEN)
                    .map(<[u8]>::to_vec);
            }
            300..400 if url.is_http() => {
                url = url
                    .join(&answer.headers.get(b"location")?)
                    .filter(Url::is_http)?
            }
            _ => return None,
        }
    }
    None
}

pub(super) async fn within<T>(seconds: u64, future: impl Future<Output = Option<T>>) -> Option<T> {
    match race(future, sleep(Duration::from_secs(seconds))).await {
        Either::First(value) => value,
        Either::Second(()) => None,
    }
}

async fn read_script(url: &[u8]) -> Option<Arc<Loaded>> {
    let source = within(30, download(Url::parse(url)?)).await?;
    let script = blocking(move || Script::load(&source, &ThisMachine))
        .await?
        .ok()?;
    Some(Arc::new(Loaded {
        script: Guarded::new(script),
        questions: Arc::default(),
    }))
}

/// That there is none is an answer too.
async fn detect_script() -> Option<Option<Arc<Loaded>>> {
    let addresses = within(
        1,
        blocking(|| bun_pac::Host::resolve(&ThisMachine, b"wpad")),
    )
    .await;
    Some(if addresses.is_some_and(|it| !it.is_empty()) {
        read_script(b"http://wpad/wpad.dat").await
    } else {
        None
    })
}

struct Caches {
    system: Arc<Cached<Config>>,
    detected: Arc<Cached<Option<Arc<Loaded>>>>,
    scripts: Vec<(Bytes, Arc<Cached<Arc<Loaded>>>)>,
}

static CACHES: Guarded<Option<Caches>> = Guarded::new(None);

fn with_caches<R>(read: impl FnOnce(&mut Caches) -> R) -> R {
    read(CACHES.lock().get_or_insert_with(|| Caches {
        system: Cached::new(),
        detected: Cached::new(),
        scripts: Vec::new(),
    }))
}

/// Forgets the settings of the system, and the scripts.
pub fn reload() {
    *CACHES.lock() = None;
}

async fn from_script(address: Bytes, url: &Url, main: &Thread) -> Option<Route> {
    let cached = with_caches(|it| {
        let index = it
            .scripts
            .iter()
            .position(|it| it.0 == address)
            .unwrap_or_else(|| {
                it.scripts.push((address.clone(), Cached::new()));
                it.scripts.len() - 1
            });
        Arc::clone(&it.scripts[index].1)
    });
    cached
        .get(main, SCRIPT_LIFETIME, || async move {
            read_script(&address).await
        })
        .await?
        .ask(url)
        .await
}

impl Config {
    /// What has to be read is read on `main`.
    pub async fn resolve(mut self, url: &Url, main: &Thread) -> Result<Route> {
        if let Config::System = self {
            let system = with_caches(|it| Arc::clone(&it.system));
            self = system
                .get(main, SETTINGS_LIFETIME, || blocking(system_proxy::read))
                .await
                .unwrap_or(Config::Direct);
        }
        match self {
            Config::Direct | Config::System => Ok(direct()),
            Config::Fixed { rules, bypass } => Ok(from_rules(url, &rules, &bypass)),
            _ if bypasses(url, b"") => Ok(direct()),
            Config::AutoDetect => {
                let detected = with_caches(|it| Arc::clone(&it.detected))
                    .get(main, 5.0 * SETTINGS_LIFETIME, detect_script)
                    .await
                    .flatten();
                Ok(match detected {
                    Some(script) => script.ask(url).await.unwrap_or_else(direct),
                    None => direct(),
                })
            }
            Config::Script {
                url: address,
                is_optional,
            } => from_script(address, url, main)
                .await
                .or_else(|| is_optional.then(direct))
                .ok_or(NetError::MandatoryProxyConfigurationFailed),
        }
    }
}
