//! Windows system-proxy fallback: when `http_proxy`/`HTTPS_PROXY`/`NO_PROXY`
//! are unset, read `WinHttpGetIEProxyConfigForCurrentUser` once and map its
//! static proxy/bypass list onto the existing proxy plumbing; PAC/WPAD is
//! resolved per origin via `WinHttpGetProxyForUrl`. Env vars always win.

use bun_core::strings;
use std::sync::OnceLock;

bun_core::declare_scope!(system_proxy, hidden);

/// Parsed WinINet per-user proxy config, owned by a process-static `OnceLock`.
pub struct SystemProxy {
    http_proxy: Box<[u8]>,
    https_proxy: Box<[u8]>,
    no_proxy: Box<[u8]>,
    /// `<local>` was in the bypass list: hostnames with no `.` bypass.
    bypass_local: bool,
    /// `<-loopback>` was present: suppresses the implicit loopback/link-local bypass.
    disable_implicit_loopback: bool,
    pac: Option<Pac>,
}

impl SystemProxy {
    #[inline]
    pub fn http_proxy(&self) -> Option<&[u8]> {
        non_empty(&self.http_proxy)
    }
    #[inline]
    pub fn https_proxy(&self) -> Option<&[u8]> {
        non_empty(&self.https_proxy)
    }
    #[inline]
    pub fn no_proxy(&self) -> &[u8] {
        &self.no_proxy
    }
    #[inline]
    pub fn has_pac(&self) -> bool {
        self.pac.is_some()
    }

    #[inline]
    pub fn proxy_for_scheme(&self, is_https: bool) -> Option<&[u8]> {
        if is_https {
            self.https_proxy()
        } else {
            self.http_proxy()
        }
    }

    /// True when `hostname` should bypass the proxy per this config's bypass rules.
    pub fn is_bypassed(&self, hostname: &[u8], host: &[u8]) -> bool {
        if !self.disable_implicit_loopback && is_implicit_bypass(hostname) {
            return true;
        }
        if self.bypass_local && is_simple_hostname(hostname) {
            return true;
        }
        crate::env_loader::no_proxy_list_matches(&self.no_proxy, hostname, host)
    }

    /// Proxy href for `url` (static config or PAC); `None` → direct.
    pub fn resolve(&'static self, url: &bun_url::URL<'_>) -> Option<&'static [u8]> {
        if self.is_bypassed(url.hostname, url.host) {
            return None;
        }
        if let Some(href) = self.proxy_for_scheme(!url.is_http()) {
            return Some(href);
        }
        self.pac.as_ref()?.resolve(url)
    }
}

/// WinINet `<local>` bypass: a dotless intranet name, not an IP literal.
#[inline]
fn is_simple_hostname(hostname: &[u8]) -> bool {
    !hostname.is_empty() && !hostname.contains(&b'.') && !hostname.contains(&b':')
}

/// WinHTTP/Chromium implicit bypass (suppressible via `<-loopback>`): loopback, localhost, link-local.
pub fn is_implicit_bypass(hostname: &[u8]) -> bool {
    let h = hostname.strip_prefix(b"[").unwrap_or(hostname);
    let h = h.strip_suffix(b"]").unwrap_or(h);
    if strings::eql_case_insensitive_ascii(h, b"localhost", true) {
        return true;
    }
    if h.len() > 10 && strings::eql_case_insensitive_ascii(&h[h.len() - 10..], b".localhost", true)
    {
        return true;
    }
    if strings::has_prefix_comptime(h, b"127.") || strings::has_prefix_comptime(h, b"169.254.") {
        return true;
    }
    if h == b"::1" {
        return true;
    }
    h.len() >= 6 && strings::eql_case_insensitive_ascii(&h[..2], b"fe", true) && {
        let c = h[2].to_ascii_lowercase();
        (c == b'8' || c == b'9' || c == b'a' || c == b'b') && h[3] == b':'
    }
}

#[inline]
fn non_empty(s: &[u8]) -> Option<&[u8]> {
    if s.is_empty() { None } else { Some(s) }
}

static CACHE: OnceLock<Option<SystemProxy>> = OnceLock::new();

pub fn get() -> Option<&'static SystemProxy> {
    CACHE.get_or_init(load).as_ref()
}

fn load() -> Option<SystemProxy> {
    if let Some(raw) = test_hook_config() {
        return parse_raw_config(raw);
    }
    #[cfg(windows)]
    {
        return ffi::read_ie_proxy_config().and_then(parse_raw_config);
    }
    #[cfg(not(windows))]
    None
}

/// UTF-8 copy of `WINHTTP_CURRENT_USER_IE_PROXY_CONFIG`.
struct RawConfig {
    auto_detect: bool,
    auto_config_url: Vec<u8>,
    proxy: Vec<u8>,
    proxy_bypass: Vec<u8>,
}

fn parse_raw_config(raw: RawConfig) -> Option<SystemProxy> {
    let (http_proxy, https_proxy) = parse_proxy_server(&raw.proxy);
    let (no_proxy, bypass_local, disable_implicit_loopback) = parse_bypass_list(&raw.proxy_bypass);

    let has_static = !http_proxy.is_empty() || !https_proxy.is_empty();
    let has_pac = raw.auto_detect || !raw.auto_config_url.is_empty();
    if !has_static && !has_pac {
        return None;
    }

    bun_core::scoped_log!(
        system_proxy,
        "Windows system proxy: http={:?} https={:?} no_proxy={:?} bypass_local={} pac_url={:?} auto_detect={}",
        bstr::BStr::new(&http_proxy),
        bstr::BStr::new(&https_proxy),
        bstr::BStr::new(&no_proxy),
        bypass_local,
        bstr::BStr::new(&raw.auto_config_url),
        raw.auto_detect,
    );

    let pac = if has_pac {
        Pac::new(raw.auto_detect, &raw.auto_config_url)
    } else {
        None
    };

    Some(SystemProxy {
        http_proxy: http_proxy.into_boxed_slice(),
        https_proxy: https_proxy.into_boxed_slice(),
        no_proxy: no_proxy.into_boxed_slice(),
        bypass_local,
        disable_implicit_loopback,
        pac,
    })
}

/// Test-only stand-in for the WinHTTP call: `fAutoDetect|pac_url|proxy|bypass`.
fn test_hook_config() -> Option<RawConfig> {
    let v = bun_core::env_var::BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG::get()?;
    let mut it = v.splitn(4, |&b| b == b'|');
    let auto_detect = it.next()? == b"1";
    let auto_config_url = it.next()?.to_vec();
    let proxy = it.next()?.to_vec();
    let proxy_bypass = it.next().unwrap_or(b"").to_vec();
    Some(RawConfig {
        auto_detect,
        auto_config_url,
        proxy,
        proxy_bypass,
    })
}

/// WinINet `ProxyServer` (`host:port` or `http=a;https=b`) → `(http_proxy, https_proxy)` hrefs.
fn parse_proxy_server(raw: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let raw = strings::trim(raw, &strings::WHITESPACE_CHARS);
    if raw.is_empty() {
        return (Vec::new(), Vec::new());
    }
    if !raw.iter().any(|&b| b == b'=') {
        let href = schemeify_proxy(raw);
        return (href.clone(), href);
    }
    let mut http = Vec::new();
    let mut https = Vec::new();
    for entry in raw.split(|&b| b == b';') {
        let entry = strings::trim(entry, &strings::WHITESPACE_CHARS);
        let Some(eq) = entry.iter().position(|&b| b == b'=') else {
            continue;
        };
        let scheme = &entry[..eq];
        let host = strings::trim(&entry[eq + 1..], &strings::WHITESPACE_CHARS);
        if host.is_empty() {
            continue;
        }
        if strings::eql_case_insensitive_ascii(scheme, b"http", true) {
            http = schemeify_proxy(host);
        } else if strings::eql_case_insensitive_ascii(scheme, b"https", true) {
            https = schemeify_proxy(host);
        }
        // `socks=` / `ftp=` are ignored: Bun's HTTP client has no SOCKS support.
    }
    (http, https)
}

fn schemeify_proxy(host: &[u8]) -> Vec<u8> {
    if strings::index_of(host, b"://").is_some() {
        return host.to_vec();
    }
    let mut v = Vec::with_capacity(7 + host.len());
    v.extend_from_slice(b"http://");
    v.extend_from_slice(host);
    v
}

/// WinINet bypass list (`;`-separated, `*.foo`, `<local>`, `<-loopback>`) → `(no_proxy, had_local, had_disable_loopback)`.
fn parse_bypass_list(raw: &[u8]) -> (Vec<u8>, bool, bool) {
    let mut out = Vec::new();
    let mut bypass_local = false;
    let mut disable_loopback = false;
    for entry in raw.split(|&b| b == b';' || b == b',' || b == b' ') {
        let mut entry = strings::trim(entry, &strings::WHITESPACE_CHARS);
        if entry.is_empty() {
            continue;
        }
        if strings::eql_case_insensitive_ascii(entry, b"<local>", true) {
            bypass_local = true;
            continue;
        }
        if strings::eql_case_insensitive_ascii(entry, b"<-loopback>", true) {
            disable_loopback = true;
            continue;
        }
        if strings::starts_with_char(entry, b'*') {
            entry = &entry[1..];
            if strings::starts_with_char(entry, b'.') {
                entry = &entry[1..];
            }
            if entry.is_empty() {
                return (b"*".to_vec(), bypass_local, disable_loopback);
            }
        }
        if !out.is_empty() {
            out.push(b',');
        }
        out.extend_from_slice(entry);
    }
    (out, bypass_local, disable_loopback)
}

#[cfg(windows)]
fn first_proxy_from_list(list: &[u8]) -> Option<Vec<u8>> {
    for entry in list.split(|&b| b == b';' || b.is_ascii_whitespace()) {
        let entry = strings::trim(entry, &strings::WHITESPACE_CHARS);
        if entry.is_empty() {
            continue;
        }
        return Some(schemeify_proxy(entry));
    }
    None
}

/// WinHTTP session + per-origin PAC result cache (owned here so callers get `&'static [u8]`).
struct Pac {
    #[cfg(windows)]
    inner: PacInner,
    cache: std::sync::Mutex<std::collections::HashMap<Box<[u8]>, Option<Box<[u8]>>>>,
}

#[cfg(windows)]
struct PacInner {
    session: bun_sys::windows::winhttp::HINTERNET,
    auto_config_url: Box<[u16]>,
    auto_detect: bool,
    failed: std::sync::atomic::AtomicBool,
}

// SAFETY: WinHTTP session handles are thread-safe; other fields are `Send+Sync`.
#[cfg(windows)]
unsafe impl Send for PacInner {}
#[cfg(windows)]
unsafe impl Sync for PacInner {}

impl Pac {
    #[cfg(windows)]
    fn new(auto_detect: bool, auto_config_url: &[u8]) -> Option<Self> {
        let session = ffi::open_session()?;
        let auto_config_url: Box<[u16]> = if auto_config_url.is_empty() {
            Box::new([])
        } else {
            strings::to_utf16_alloc_for_real(auto_config_url, false, true)
                .ok()?
                .into_boxed_slice()
        };
        Some(Self {
            inner: PacInner {
                session,
                auto_config_url,
                auto_detect,
                failed: std::sync::atomic::AtomicBool::new(false),
            },
            cache: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }

    #[cfg(not(windows))]
    fn new(_auto_detect: bool, _auto_config_url: &[u8]) -> Option<Self> {
        None
    }

    fn resolve(&self, url: &bun_url::URL<'_>) -> Option<&'static [u8]> {
        #[cfg(windows)]
        if self.inner.failed.load(std::sync::atomic::Ordering::Relaxed) {
            return None;
        }
        let key = pac_cache_key(url);
        if let Some(cached) = self.cache.lock().ok()?.get(key.as_slice()) {
            return cached.as_deref().map(Self::as_static);
        }
        // CVE-2016-5134: pass only `scheme://host/`; never hand userinfo/path/query to a WPAD-fetched PAC script.
        let mut sanitized = key.clone();
        sanitized.push(b'/');
        let proxy = self.resolve_uncached(&sanitized).map(Vec::into_boxed_slice);
        let mut cache = self.cache.lock().ok()?;
        cache
            .entry(key.into_boxed_slice())
            .or_insert(proxy)
            .as_deref()
            .map(Self::as_static)
    }

    #[inline]
    fn as_static(b: &[u8]) -> &'static [u8] {
        // SAFETY: `Pac` lives in the process-static `OnceLock<Option<SystemProxy>>`
        // and `cache` entries are never removed, so every `Box<[u8]>` value
        // outlives the process. `HashMap` rehash moves the `Box` handle but
        // not its heap allocation, so this pointer stays valid.
        unsafe { &*core::ptr::from_ref::<[u8]>(b) }
    }

    #[cfg(windows)]
    fn resolve_uncached(&self, url_href: &[u8]) -> Option<Vec<u8>> {
        use std::sync::atomic::Ordering;
        let inner = &self.inner;
        if inner.failed.load(Ordering::Relaxed) {
            return None;
        }
        match ffi::get_proxy_for_url(
            inner.session,
            url_href,
            inner.auto_detect,
            &inner.auto_config_url,
        ) {
            Ok(list) => list.as_deref().and_then(first_proxy_from_list),
            Err(err) => {
                bun_core::scoped_log!(
                    system_proxy,
                    "WinHttpGetProxyForUrl failed ({}); disabling PAC for this process",
                    err
                );
                inner.failed.store(true, Ordering::Relaxed);
                None
            }
        }
    }

    #[cfg(not(windows))]
    fn resolve_uncached(&self, _url_href: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

#[cfg(windows)]
impl Drop for PacInner {
    fn drop(&mut self) {
        // SAFETY: `session` is the handle `WinHttpOpen` returned.
        unsafe { bun_sys::windows::winhttp::WinHttpCloseHandle(self.session) };
    }
}

fn pac_cache_key(url: &bun_url::URL<'_>) -> Vec<u8> {
    let mut k = Vec::with_capacity(url.protocol.len() + 3 + url.host.len());
    k.extend_from_slice(url.protocol);
    k.extend_from_slice(b"://");
    k.extend_from_slice(url.host);
    k
}

#[cfg(windows)]
mod ffi {
    use super::RawConfig;
    use bun_core::strings;
    use bun_sys::windows::winhttp::{
        GlobalFree, HINTERNET, WINHTTP_ACCESS_TYPE_NAMED_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A,
        WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL, WINHTTP_AUTOPROXY_OPTIONS,
        WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WINHTTP_PROXY_INFO,
        WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl, WinHttpOpen,
        WinHttpSetTimeouts,
    };
    use core::ptr;

    unsafe fn take_lpwstr(p: *mut u16) -> Vec<u8> {
        if p.is_null() {
            return Vec::new();
        }
        // SAFETY: WinHTTP out-strings are NUL-terminated and caller-owned until `GlobalFree`.
        let len = unsafe { bun_core::ffi::wcslen(p) };
        let slice = unsafe { core::slice::from_raw_parts(p, len) };
        let out = strings::to_utf8_alloc(slice);
        unsafe { GlobalFree(p.cast()) };
        out
    }

    pub(super) fn read_ie_proxy_config() -> Option<RawConfig> {
        let mut cfg = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG {
            fAutoDetect: 0,
            lpszAutoConfigUrl: ptr::null_mut(),
            lpszProxy: ptr::null_mut(),
            lpszProxyBypass: ptr::null_mut(),
        };
        // SAFETY: `cfg` is a valid out-struct for the call.
        let ok = unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut cfg) };
        if ok == 0 {
            bun_core::scoped_log!(
                super::system_proxy,
                "WinHttpGetIEProxyConfigForCurrentUser failed ({})",
                bun_sys::windows::kernel32::GetLastError()
            );
            return None;
        }
        // SAFETY: on success each LPWSTR is null or a GlobalAlloc'd NUL-terminated wide string we own.
        unsafe {
            Some(RawConfig {
                auto_detect: cfg.fAutoDetect != 0,
                auto_config_url: take_lpwstr(cfg.lpszAutoConfigUrl),
                proxy: take_lpwstr(cfg.lpszProxy),
                proxy_bypass: take_lpwstr(cfg.lpszProxyBypass),
            })
        }
    }

    pub(super) fn open_session() -> Option<HINTERNET> {
        static AGENT: &[u16] = &[b'B' as u16, b'u' as u16, b'n' as u16, 0];
        // SAFETY: WINHTTP_NO_PROXY_NAME/_BYPASS are NULL by definition.
        let h = unsafe {
            WinHttpOpen(
                AGENT.as_ptr(),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                ptr::null(),
                ptr::null(),
                0,
            )
        };
        if h.is_null() {
            bun_core::scoped_log!(
                super::system_proxy,
                "WinHttpOpen failed ({})",
                bun_sys::windows::kernel32::GetLastError()
            );
            return None;
        }
        // SAFETY: `h` is the live session handle; all args are by-value ints.
        unsafe { WinHttpSetTimeouts(h, 5000, 5000, 5000, 5000) };
        Some(h)
    }

    pub(super) fn get_proxy_for_url(
        session: HINTERNET,
        url_href: &[u8],
        auto_detect: bool,
        auto_config_url: &[u16],
    ) -> Result<Option<Vec<u8>>, u32> {
        let url_w = strings::to_utf16_alloc_for_real(url_href, false, true).map_err(|_| 0u32)?;
        let mut opts = WINHTTP_AUTOPROXY_OPTIONS {
            dwFlags: 0,
            dwAutoDetectFlags: 0,
            lpszAutoConfigUrl: ptr::null(),
            lpvReserved: ptr::null_mut(),
            dwReserved: 0,
            fAutoLogonIfChallenged: 0,
        };
        if auto_detect {
            opts.dwFlags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            opts.dwAutoDetectFlags = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
        }
        if !auto_config_url.is_empty() {
            opts.dwFlags |= WINHTTP_AUTOPROXY_CONFIG_URL;
            opts.lpszAutoConfigUrl = auto_config_url.as_ptr();
        }
        let mut info = WINHTTP_PROXY_INFO {
            dwAccessType: 0,
            lpszProxy: ptr::null_mut(),
            lpszProxyBypass: ptr::null_mut(),
        };
        // SAFETY: all pointers are valid for the call; WinHTTP populates `info` on success.
        let mut ok =
            unsafe { WinHttpGetProxyForUrl(session, url_w.as_ptr(), &mut opts, &mut info) };
        if ok == 0 {
            let err = bun_sys::windows::kernel32::GetLastError();
            const ERROR_WINHTTP_LOGIN_FAILURE: u32 = 12015;
            if err != ERROR_WINHTTP_LOGIN_FAILURE {
                return Err(err);
            }
            opts.fAutoLogonIfChallenged = 1;
            // SAFETY: same as above; `opts`/`info` are still valid.
            ok = unsafe { WinHttpGetProxyForUrl(session, url_w.as_ptr(), &mut opts, &mut info) };
            if ok == 0 {
                return Err(bun_sys::windows::kernel32::GetLastError());
            }
        }
        // SAFETY: on success `info`'s LPWSTR fields are either null or owned.
        let proxy = unsafe { take_lpwstr(info.lpszProxy) };
        unsafe { take_lpwstr(info.lpszProxyBypass) };
        if info.dwAccessType == WINHTTP_ACCESS_TYPE_NAMED_PROXY && !proxy.is_empty() {
            Ok(Some(proxy))
        } else {
            Ok(None)
        }
    }
}
