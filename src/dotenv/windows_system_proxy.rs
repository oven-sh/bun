//! Fallback to the Windows system proxy (Internet Options / WinINet) when the
//! standard `http_proxy`/`HTTPS_PROXY`/`NO_PROXY` environment variables are
//! unset.
//!
//! Corporate Windows environments typically configure the proxy in Windows
//! settings rather than the environment. Chromium's `ProxyConfigServiceWin`
//! and curl's schannel backend both consult this source.
//!
//! The configuration is read once via `WinHttpGetIEProxyConfigForCurrentUser`
//! and cached for the process lifetime. A static proxy + bypass list is mapped
//! onto `http_proxy`/`https_proxy`/`no_proxy` so the existing proxy plumbing
//! handles it unchanged. When only a PAC URL or WPAD auto-detect is
//! configured, `WinHttpGetProxyForUrl` is consulted per request origin.
//!
//! Env vars always win: this module is only consulted when none of the proxy
//! env vars are present.

use bun_core::strings;
use std::sync::OnceLock;

bun_core::declare_scope!(system_proxy, hidden);

/// Parsed copy of the WinINet per-user proxy configuration. Held in a
/// process-static `OnceLock`, so all `&[u8]` views handed out borrow
/// `'static` storage.
pub struct SystemProxy {
    http_proxy: Box<[u8]>,
    https_proxy: Box<[u8]>,
    no_proxy: Box<[u8]>,
    /// `<local>` was in the bypass list: hostnames with no `.` bypass.
    bypass_local: bool,
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
    pub fn bypass_local(&self) -> bool {
        self.bypass_local
    }
    #[inline]
    pub fn has_pac(&self) -> bool {
        self.pac.is_some()
    }

    /// Static-config proxy href for `is_https`, or `None` when no static proxy
    /// is configured for that scheme.
    #[inline]
    pub fn proxy_for_scheme(&self, is_https: bool) -> Option<&[u8]> {
        if is_https {
            self.https_proxy()
        } else {
            self.http_proxy()
        }
    }

    /// Proxy href for `url` from either the static config or PAC/WPAD. Returns
    /// `None` for a direct connection. The returned slice borrows `'static`
    /// storage (static config is owned by this `SystemProxy`; PAC results are
    /// interned in `Pac::cache`).
    pub fn resolve(&'static self, url: &bun_url::URL<'_>) -> Option<&'static [u8]> {
        let hostname = url.hostname;
        if self.bypass_local && !hostname.is_empty() && !hostname.contains(&b'.') {
            return None;
        }
        if let Some(href) = self.proxy_for_scheme(!url.is_http()) {
            return Some(href);
        }
        self.pac.as_ref()?.resolve(url)
    }
}

#[inline]
fn non_empty(s: &[u8]) -> Option<&[u8]> {
    if s.is_empty() { None } else { Some(s) }
}

static CACHE: OnceLock<Option<SystemProxy>> = OnceLock::new();

/// The cached system proxy configuration, or `None` when no system proxy is
/// configured (or on non-Windows hosts without the test-hook env var).
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

/// Raw string fields as returned by `WinHttpGetIEProxyConfigForCurrentUser`,
/// already converted to UTF-8.
struct RawConfig {
    auto_detect: bool,
    auto_config_url: Vec<u8>,
    proxy: Vec<u8>,
    proxy_bypass: Vec<u8>,
}

fn parse_raw_config(raw: RawConfig) -> Option<SystemProxy> {
    let (http_proxy, https_proxy) = parse_proxy_server(&raw.proxy);
    let (no_proxy, bypass_local) = parse_bypass_list(&raw.proxy_bypass);

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
        pac,
    })
}

/// `BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG` provides a fake
/// `WINHTTP_CURRENT_USER_IE_PROXY_CONFIG` for tests:
/// `<fAutoDetect 0|1>|<auto_config_url>|<proxy>|<bypass>`.
/// Allows exercising the parser and wiring without touching the user's
/// registry; honoured on all platforms so the test can run in the Linux gate.
fn test_hook_config() -> Option<RawConfig> {
    let v = std::env::var_os("BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG")?
        .into_string()
        .ok()?;
    let mut it = v.splitn(4, '|');
    let auto_detect = it.next()? == "1";
    let auto_config_url = it.next()?.as_bytes().to_vec();
    let proxy = it.next()?.as_bytes().to_vec();
    let proxy_bypass = it.next().unwrap_or("").as_bytes().to_vec();
    Some(RawConfig {
        auto_detect,
        auto_config_url,
        proxy,
        proxy_bypass,
    })
}

// ── WinINet proxy-string parsing ────────────────────────────────────────────

/// Parse the WinINet `ProxyServer` value into `(http_proxy, https_proxy)`
/// hrefs with an explicit `http://` scheme so `URL::parse` recognises them.
///
/// Accepted forms (whitespace around entries is trimmed):
/// - `host[:port]` — one proxy for every scheme
/// - `scheme=host[:port][;...]` — per-scheme list. Only `http=` / `https=` /
///   `socks=` are consumed; `ftp=` and unknown schemes are ignored.
fn parse_proxy_server(raw: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let raw = strings::trim(raw, &strings::WHITESPACE_CHARS);
    if raw.is_empty() {
        return (Vec::new(), Vec::new());
    }
    // Per-scheme form is present iff any entry contains `=`.
    let per_scheme = raw.iter().any(|&b| b == b'=');
    if !per_scheme {
        let href = schemeify_proxy(raw);
        return (href.clone(), href);
    }
    let mut http = Vec::new();
    let mut https = Vec::new();
    let mut socks = Vec::new();
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
        } else if strings::eql_case_insensitive_ascii(scheme, b"socks", true) {
            socks = {
                let mut v = Vec::with_capacity(8 + host.len());
                v.extend_from_slice(b"socks://");
                v.extend_from_slice(host);
                v
            };
        }
    }
    // A `socks=` entry with no `http=`/`https=` applies to both, matching
    // Chromium's `ProxyConfigServiceWin`.
    if http.is_empty() && !socks.is_empty() {
        http = socks.clone();
    }
    if https.is_empty() && !socks.is_empty() {
        https = socks;
    }
    (http, https)
}

/// Prefix `http://` unless `host` already carries a scheme. WinINet usually
/// stores bare `host:port`; occasionally a user pastes a full URL.
fn schemeify_proxy(host: &[u8]) -> Vec<u8> {
    if strings::index_of(host, b"://").is_some() {
        return host.to_vec();
    }
    let mut v = Vec::with_capacity(7 + host.len());
    v.extend_from_slice(b"http://");
    v.extend_from_slice(host);
    v
}

/// Convert a WinINet bypass list (`;`-separated, `*.foo.com`, `<local>`,
/// `<-loopback>`) into the curl/`NO_PROXY` comma-separated form
/// `foo.com,10.0.0.1` that `no_proxy_matches` understands. `<local>` is
/// returned out-of-band because `NO_PROXY` has no equivalent token.
fn parse_bypass_list(raw: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut bypass_local = false;
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
            continue;
        }
        if strings::starts_with_char(entry, b'*') {
            entry = &entry[1..];
            if strings::starts_with_char(entry, b'.') {
                entry = &entry[1..];
            }
            if entry.is_empty() {
                // `*` → everything direct
                return (b"*".to_vec(), bypass_local);
            }
        }
        if !out.is_empty() {
            out.push(b',');
        }
        out.extend_from_slice(entry);
    }
    (out, bypass_local)
}

/// First proxy from a `WinHttpGetProxyForUrl` result list (entries separated
/// by `;` or whitespace), as an `http://host:port` href.
#[cfg_attr(not(windows), allow(dead_code))]
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

// ── PAC/WPAD ────────────────────────────────────────────────────────────────

/// Lazily-initialised WinHTTP session plus a per-origin result cache. Results
/// are interned (leaked) so callers receive `&'static [u8]` that survives
/// `HashMap` rehash. Origins are `scheme://host` which matches Chromium's
/// `ProxyService` cache granularity; a process talks to a bounded set of
/// origins so the interned set stays small.
struct Pac {
    #[cfg(windows)]
    inner: PacInner,
    cache: std::sync::Mutex<std::collections::HashMap<Box<[u8]>, Option<&'static [u8]>>>,
}

#[cfg(windows)]
struct PacInner {
    session: bun_sys::windows::winhttp::HINTERNET,
    auto_config_url: Box<[u16]>,
    auto_detect: bool,
    failed: std::sync::atomic::AtomicBool,
}

// SAFETY: WinHTTP session handles are documented as usable from multiple
// threads concurrently; every other field is already `Send + Sync`.
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
        let key = pac_cache_key(url);
        if let Some(&cached) = self.cache.lock().ok()?.get(key.as_slice()) {
            return cached;
        }
        let proxy = self.resolve_uncached(url.href);
        let interned: Option<&'static [u8]> = proxy.map(|v| &*Box::leak(v.into_boxed_slice()));
        self.cache.lock().ok()?.insert(key.into_boxed_slice(), interned);
        interned
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

// ── Windows FFI ─────────────────────────────────────────────────────────────

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
    };
    use core::ptr;

    /// Convert a WinHTTP-allocated `LPWSTR` to an owned UTF-8 `Vec<u8>` and
    /// `GlobalFree` it. `null` → empty vec.
    unsafe fn take_lpwstr(p: *mut u16) -> Vec<u8> {
        if p.is_null() {
            return Vec::new();
        }
        // SAFETY: WinHTTP contract — non-null out-strings are NUL-terminated
        // and owned by the caller until `GlobalFree`.
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
        // SAFETY: on success WinHTTP populated the LPWSTR fields (each either
        // null or a GlobalAlloc'd NUL-terminated wide string we now own).
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
        // SAFETY: WINHTTP_NO_PROXY_NAME / _BYPASS are documented as NULL.
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
        Some(h)
    }

    /// `Ok(Some(list))` → named proxy list (UTF-8), `Ok(None)` → DIRECT,
    /// `Err(code)` → WinHTTP error (`GetLastError`).
    pub(super) fn get_proxy_for_url(
        session: HINTERNET,
        url_href: &[u8],
        auto_detect: bool,
        auto_config_url: &[u16],
    ) -> Result<Option<Vec<u8>>, u32> {
        let url_w =
            strings::to_utf16_alloc_for_real(url_href, false, true).map_err(|_| 0u32)?;
        let mut opts = WINHTTP_AUTOPROXY_OPTIONS {
            dwFlags: 0,
            dwAutoDetectFlags: 0,
            lpszAutoConfigUrl: ptr::null(),
            lpvReserved: ptr::null_mut(),
            dwReserved: 0,
            fAutoLogonIfChallenged: 1,
        };
        if auto_detect {
            opts.dwFlags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            opts.dwAutoDetectFlags =
                WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
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
        // SAFETY: all pointers are valid for the duration of the call; WinHTTP
        // writes into `info` and allocates its string fields on success.
        let ok =
            unsafe { WinHttpGetProxyForUrl(session, url_w.as_ptr(), &mut opts, &mut info) };
        if ok == 0 {
            return Err(bun_sys::windows::kernel32::GetLastError());
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

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_server_single() {
        let (h, s) = parse_proxy_server(b"corp-proxy:3128");
        assert_eq!(h, b"http://corp-proxy:3128");
        assert_eq!(s, b"http://corp-proxy:3128");
    }

    #[test]
    fn proxy_server_per_scheme() {
        let (h, s) = parse_proxy_server(b"http=a:80;https=b:443;ftp=c:21");
        assert_eq!(h, b"http://a:80");
        assert_eq!(s, b"http://b:443");
    }

    #[test]
    fn proxy_server_socks_fallback() {
        let (h, s) = parse_proxy_server(b"socks=s:1080");
        assert_eq!(h, b"socks://s:1080");
        assert_eq!(s, b"socks://s:1080");
        let (h, s) = parse_proxy_server(b"http=a:80;socks=s:1080");
        assert_eq!(h, b"http://a:80");
        assert_eq!(s, b"socks://s:1080");
    }

    #[test]
    fn proxy_server_with_scheme_already() {
        let (h, _) = parse_proxy_server(b"http://corp-proxy:3128");
        assert_eq!(h, b"http://corp-proxy:3128");
    }

    #[test]
    fn bypass_list() {
        let (np, local) = parse_bypass_list(b"*.contoso.com;10.*;<local>");
        assert_eq!(np, b"contoso.com,10.");
        assert!(local);
        let (np, local) = parse_bypass_list(b"localhost;127.0.0.1");
        assert_eq!(np, b"localhost,127.0.0.1");
        assert!(!local);
        let (np, _) = parse_bypass_list(b"*");
        assert_eq!(np, b"*");
    }

    #[test]
    fn pac_list() {
        assert_eq!(
            first_proxy_from_list(b"a:80; b:81").as_deref(),
            Some(b"http://a:80".as_slice())
        );
        assert_eq!(first_proxy_from_list(b"  ").as_deref(), None);
    }
}
