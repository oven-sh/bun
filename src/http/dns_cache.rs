//! Process-wide DNS cache used by the usockets connect path.
//! Lives in bun_http (not bun_dns) because the QUIC notify path must name
//! `H3::PendingConnect`; lives below bun_runtime so `bun_install` and the
//! QUIC client call it directly instead of through link-time externs.

use core::ffi::{c_char, c_int, c_void};
use core::mem::MaybeUninit;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_core::{self as bun, ZStr, env_var, fmt as bun_fmt, mach_port};
#[cfg(target_os = "macos")]
use bun_dns::lib_info;
use bun_dns::netc;
use bun_dns::{AddrInfo, Sockaddr, SockaddrStorage};
#[cfg(target_os = "macos")]
use bun_event_loop::EventLoopHandle;
use bun_io::FilePoll;
#[cfg(target_os = "macos")]
use bun_io::{self as Async};
#[cfg(target_os = "macos")]
use bun_sys as sys;
use bun_uws::{ConnectingSocket, Loop};
use bun_wyhash::hash as wyhash;

use crate::H3::PendingConnect;

bun_core::declare_scope!(dns_cache, hidden);

/// Send-wrapper for raw pointers handed to the threaded work pool. The DNS
/// `Request` is heap-allocated and only touched under `global_cache().lock()`,
/// so crossing threads is sound — Rust just can't see that through `*mut T`.
#[repr(transparent)]
struct SendPtr<T>(*mut T);
// SAFETY: see type doc — synchronization is provided by `global_cache()`.
unsafe impl<T> Send for SendPtr<T> {}

// PORTING.md §Global mutable state: lazy env-var memo — an `OnceLock<u32>`
// (idempotent init, safe concurrent read).
static MAX_DNS_TIME_TO_LIVE_SECONDS: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

pub(crate) fn get_max_dns_time_to_live_seconds() -> u32 {
    *MAX_DNS_TIME_TO_LIVE_SECONDS.get_or_init(|| {
        let value = env_var::BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS.get();
        value.unwrap_or(30) as u32
    })
}

// ───────────── Request ─────────────

// The stack key borrows the caller's host string; `to_owned()` copies
// before storing on the heap `Request`.
pub struct RequestKey<'a> {
    pub host: Option<&'a ZStr>,
    /// Used for getaddrinfo() to avoid glibc UDP port 0 bug, but NOT included in hash
    pub port: u16,
    /// Hash of hostname only - DNS results are port-agnostic
    pub hash: u64,
}

/// Heap-stored key on `Request` — owns its host buffer.
pub struct RequestKeyOwned {
    pub host: Option<bun::ZBox>,
    pub port: u16,
    pub hash: u64,
}

impl RequestKeyOwned {
    /// Cache-lookup equality: same hash *and* same hostname bytes. The hash
    /// (wyhash, fixed seed) is not collision resistant, so it is only a
    /// fast reject — never the sole match criterion.
    fn matches(&self, other: &RequestKey<'_>) -> bool {
        if self.hash != other.hash {
            return false;
        }
        match (self.host.as_ref(), other.host) {
            (Some(a), Some(b)) => a.as_bytes() == b.as_bytes(),
            (None, None) => true,
            _ => false,
        }
    }
}

impl<'a> RequestKey<'a> {
    pub fn init(name: Option<&'a ZStr>, port: u16) -> Self {
        let hash = if let Some(n) = name {
            Self::generate_hash(n) // Don't include port
        } else {
            0
        };
        Self {
            host: name,
            hash,
            port,
        }
    }

    fn generate_hash(name: &ZStr) -> u64 {
        wyhash(name.as_bytes())
    }

    pub fn to_owned(&self) -> RequestKeyOwned {
        if let Some(host) = self.host {
            let host_copy = bun::ZBox::from_bytes(host.as_bytes());
            RequestKeyOwned {
                host: Some(host_copy),
                hash: self.hash,
                port: self.port,
            }
        } else {
            RequestKeyOwned {
                host: None,
                hash: self.hash,
                port: self.port,
            }
        }
    }
}

// Crosses FFI to usockets via `Bun__addrinfo_getRequestResult` — layout MUST
// stay `{ info: ?*ResultEntry, err: c_int }` (8-byte thin ptr).
#[repr(C)]
pub struct RequestResult {
    pub info: Option<NonNull<ResultEntry>>, // thin ptr; head of intrusive `ai_next` chain
    pub err: c_int,
}
// Ownership of the ResultEntry buffer is `Request.result_buf` — this struct is
// a borrowed C-ABI view (`info` points at `result_buf[0]`). Do NOT free via
// this field.

#[derive(Default)]
pub struct MacAsyncDNS {
    pub file_poll: Option<NonNull<FilePoll>>, // OWNED hive slot (FilePoll::init)
    pub machport: mach_port,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn getaddrinfo_send_reply(
        port: mach_port,
        reply: lib_info::GetaddrinfoAsyncHandleReply,
    ) -> bool;
}

impl MacAsyncDNS {
    #[cfg(target_os = "macos")]
    pub(crate) fn on_machport_change(this: *mut Request) {
        // SAFETY: `this` is the heap-allocated Request the FilePoll was registered with.
        unsafe {
            if !getaddrinfo_send_reply(
                (*this).libinfo.machport,
                lib_info::getaddrinfo_async_handle_reply().unwrap(),
            ) {
                libinfo_callback(
                    sys::E::ENOSYS as i32,
                    ptr::null_mut(),
                    this.cast::<c_void>(),
                );
            }
        }
    }
}

/// `Owner.on_update` entry for cache `Request` machport polls (was the
/// REQUEST arm). Only registered from the macOS getaddrinfo-async path.
#[cfg(target_os = "macos")]
fn request_run_file_poll(owner: *mut (), _poll: *mut FilePoll, _size_or_offset: i64, _hup: bool) {
    #[cfg(target_os = "macos")]
    MacAsyncDNS::on_machport_change(owner.cast::<Request>());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = owner;
        debug_assert!(false, "InternalDNSRequest poll on non-mac");
    }
}

pub struct Request {
    pub key: RequestKeyOwned,
    pub result: Option<RequestResult>,
    /// Owns the `[ResultEntry; N]` packed by `process_results`; `result.info`
    /// borrows its first element. Freed by `Drop` in `Request::deinit`.
    pub result_buf: Option<Box<[ResultEntry]>>,

    pub notify: Vec<DNSRequestOwner>,

    /// number of sockets that have a reference to result or are waiting for the result
    /// while this is non-zero, this entry cannot be freed
    pub refcount: u32,

    /// Seconds since the epoch when this request was created.
    /// Not a precise timestamp.
    pub created_at: u32,

    pub valid: bool,

    #[cfg(target_os = "macos")]
    pub libinfo: MacAsyncDNS,
    #[cfg(not(target_os = "macos"))]
    pub libinfo: (),

    pub can_retry_for_addrconfig: bool,
}

impl Request {
    pub fn new(key: RequestKeyOwned, refcount: u32, created_at: u32) -> *mut Self {
        bun_core::heap::into_raw(Box::new(Self {
            key,
            result: None,
            result_buf: None,
            notify: Vec::new(),
            refcount,
            created_at,
            valid: true,
            #[cfg(target_os = "macos")]
            libinfo: MacAsyncDNS::default(),
            #[cfg(not(target_os = "macos"))]
            libinfo: (),
            can_retry_for_addrconfig: DEFAULT_HINTS_ADDRCONFIG,
        }))
    }

    pub fn is_expired(&mut self, timestamp_to_store: &mut u32) -> bool {
        if self.result.is_none() {
            return false;
        }

        let now = if *timestamp_to_store == 0 {
            GlobalCache::get_cache_timestamp()
        } else {
            *timestamp_to_store
        };
        *timestamp_to_store = now;

        if now.saturating_sub(self.created_at) > get_max_dns_time_to_live_seconds() {
            self.valid = false;
            return true;
        }

        false
    }

    /// # Safety
    /// `this` must be the heap-allocated `Request` returned by `Request::new`
    /// with `refcount == 0`; freed by this call.
    // `this` is reclaimed via `heap::take` (Box::from_raw); forming
    // `&mut *this` at entry would invalidate the pointer's allocation
    // provenance, so the param must stay `*mut`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn deinit(this: *mut Self) {
        // SAFETY: this is a heap-allocated Request with refcount==0
        unsafe {
            debug_assert!((*this).notify.is_empty());
            // `result_buf` (Box<[ResultEntry]>) and `key.host` freed by Drop.
            drop(bun_core::heap::take(this));
        }
    }
}

// ───────────── GlobalCache ─────────────

const MAX_ENTRIES: usize = 256;

/// The cache data guarded by `GLOBAL_CACHE`; the lock owns the data
/// (PORTING.md §Concurrency).
pub(crate) struct GlobalCache {
    pub cache: [*mut Request; MAX_ENTRIES],
    pub len: usize,
}

// SAFETY: every `*mut Request` stored here is a heap allocation transferred between
// threads only while `GLOBAL_CACHE` is locked; no thread-affine data hangs off it.
unsafe impl Send for GlobalCache {}

impl GlobalCache {
    pub(crate) const fn new() -> Self {
        Self {
            cache: [ptr::null_mut(); MAX_ENTRIES],
            len: 0,
        }
    }

    fn get(&mut self, key: &RequestKey<'_>, timestamp_to_store: &mut u32) -> Option<*mut Request> {
        let mut len = self.len;
        let mut i: usize = 0;
        while i < len {
            let entry = self.cache[i];
            // SAFETY: entries 0..len are valid heap Requests
            unsafe {
                if (*entry).key.matches(key) && (*entry).valid {
                    if (*entry).is_expired(timestamp_to_store) {
                        bun_core::scoped_log!(dns_cache, "get: expired entry");
                        if (*entry).refcount == 0 {
                            let _ = self.delete_entry_at(len, i);
                            Request::deinit(entry);
                            len = self.len;
                        }
                        continue;
                    }
                    return Some(entry);
                }
            }
            i += 1;
        }
        None
    }

    // To preserve memory, we use a 32 bit timestamp
    // However, we're almost out of time to use 32 bit timestamps for anything
    // So we set the epoch to January 1st, 2024 instead.
    pub(crate) fn get_cache_timestamp() -> u32 {
        (bun::Timespec::now(bun::TimespecMockMode::AllowMockedTime).ms_unsigned() / 1000) as u32
    }

    fn is_nearly_full(&self) -> bool {
        // 80% full (value is kind of arbitrary)
        // Caller already holds GLOBAL_CACHE; no atomic load needed.
        self.len * 5 >= self.cache.len() * 4
    }

    fn delete_entry_at(&mut self, len: usize, i: usize) -> Option<*mut Request> {
        self.len -= 1;
        DNS_CACHE_SIZE.store(len - 1, Ordering::Relaxed);

        if len > 1 {
            let prev = self.cache[len - 1];
            self.cache[i] = prev;
            return Some(prev);
        }
        None
    }

    fn remove(&mut self, entry: *mut Request) {
        let len = self.len;
        // equivalent of swapRemove
        for i in 0..len {
            if self.cache[i] == entry {
                let _ = self.delete_entry_at(len, i);
                return;
            }
        }
    }

    fn try_push(&mut self, entry: *mut Request) -> bool {
        // is the cache full?
        if self.len >= self.cache.len() {
            // check if there is an element to evict
            for e in &mut self.cache[0..self.len] {
                // SAFETY: entries are valid
                unsafe {
                    if (**e).refcount == 0 {
                        Request::deinit(*e);
                        *e = entry;
                        return true;
                    }
                }
            }
            false
        } else {
            // just append to the end
            self.cache[self.len] = entry;
            self.len += 1;
            true
        }
    }
}

static GLOBAL_CACHE: bun_threading::Guarded<GlobalCache> =
    bun_threading::Guarded::new(GlobalCache::new());
#[inline]
fn global_cache() -> &'static bun_threading::Guarded<GlobalCache> {
    &GLOBAL_CACHE
}

// we just hardcode a STREAM socktype
#[cfg(unix)]
const DEFAULT_HINTS_ADDRCONFIG: bool = true;
#[cfg(not(unix))]
const DEFAULT_HINTS_ADDRCONFIG: bool = false;

#[allow(dead_code)]
fn default_hints() -> AddrInfo {
    let mut h: AddrInfo = bun_core::ffi::zeroed();
    h.ai_family = netc::AF_UNSPEC;
    // If the system is IPv4-only or IPv6-only, then only return the corresponding address family.
    // https://github.com/nodejs/node/commit/54dd7c38e507b35ee0ffadc41a716f1782b0d32f
    // https://bugzilla.mozilla.org/show_bug.cgi?id=467497
    // https://github.com/adobe/chromium/blob/cfe5bf0b51b1f6b9fe239c2a3c2f2364da9967d7/net/base/host_resolver_proc.cc#L122-L241
    // https://github.com/nodejs/node/issues/33816
    // https://github.com/aio-libs/aiohttp/issues/5357
    // https://github.com/libuv/libuv/issues/2225
    #[cfg(unix)]
    {
        h.ai_flags = netc::AI_ADDRCONFIG;
    }
    h.ai_socktype = netc::SOCK_STREAM;
    h
}

#[allow(dead_code)]
pub(crate) fn get_hints() -> AddrInfo {
    let mut hints_copy = default_hints();
    if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG
        .get()
        .unwrap_or(false)
    {
        hints_copy.ai_flags &= !netc::AI_ADDRCONFIG;
    }
    if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_IPV6
        .get()
        .unwrap_or(false)
    {
        hints_copy.ai_family = netc::AF_INET;
    } else if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_IPV4
        .get()
        .unwrap_or(false)
    {
        hints_copy.ai_family = netc::AF_INET6;
    }
    hints_copy
}

// `Request` is passed opaquely to usockets and round-tripped back into
// Rust; the C side never dereferences fields, so layout is irrelevant.
#[allow(improper_ctypes)]
unsafe extern "C" {
    fn us_internal_dns_callback(socket: *mut ConnectingSocket, req: *mut Request);
    fn us_internal_dns_callback_threadsafe(socket: *mut ConnectingSocket, req: *mut Request);
}

pub enum DNSRequestOwner {
    Socket(*mut ConnectingSocket), // FFI
    Prefetch(*mut Loop),           // FFI
    Quic(*mut PendingConnect),     // BORROW_PARAM
}

impl DNSRequestOwner {
    /// # Safety
    /// `req` must be a live cache `Request` with a populated `result`; the
    /// callee may take ownership and free it.
    // Forwards `req` to C++ without dereferencing; not_unsafe_ptr_arg_deref
    // is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn notify_threadsafe(&self, req: *mut Request) {
        match self {
            // SAFETY: `socket` is the live usockets handle stored when the request was registered.
            DNSRequestOwner::Socket(socket) => unsafe {
                us_internal_dns_callback_threadsafe(*socket, req)
            },
            DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
            // SAFETY: `pc` is the live PendingConnect borrowed for the lifetime of the request.
            DNSRequestOwner::Quic(pc) => unsafe { PendingConnect::on_dns_resolved_threadsafe(*pc) },
        }
    }

    /// # Safety
    /// `req` must be a live cache `Request` with a populated `result`; the
    /// callee may take ownership and free it.
    // Forwards `req` to C++ without dereferencing; not_unsafe_ptr_arg_deref
    // is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn notify(&self, req: *mut Request) {
        match self {
            DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
            // SAFETY: `socket` is the live usockets handle stored when the request was registered.
            DNSRequestOwner::Socket(socket) => unsafe { us_internal_dns_callback(*socket, req) },
            // SAFETY: `pc` is the live PendingConnect borrowed for the lifetime of the request.
            DNSRequestOwner::Quic(pc) => unsafe { PendingConnect::on_dns_resolved(*pc) },
        }
    }
}

/// Register `pc` to be notified when `request` resolves. Mirrors
/// us_getaddrinfo_set but for the QUIC client's connect path, which has
/// no us_connecting_socket_t to hang the callback on. The .quic notify
/// path frees the addrinfo request inline (via Bun__addrinfo_freeRequest),
/// which re-acquires global_cache.lock — so drop it before notifying.
///
/// # Safety
/// `request` must be a live cache `Request` (refcount held by the caller);
/// `pc` must stay valid until its `on_dns_resolved[_threadsafe]` fires.
// `request` is forwarded to `owner.notify`, which may free it inline
// (see fn doc); forming `&mut *request` at entry would be unsound across
// that hand-off, so the param must stay `*mut`.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub unsafe fn register_quic(request: *mut Request, pc: *mut PendingConnect) {
    let guard = global_cache().lock();
    let owner = DNSRequestOwner::Quic(pc);
    // SAFETY: `request` is a live cache entry; `result`/`notify` are only
    // touched under `global_cache().lock()`, which is held here.
    unsafe {
        if (*request).result.is_some() {
            drop(guard);
            owner.notify(request);
            return;
        }
        (*request).notify.push(owner);
    }
    drop(guard);
}

#[repr(C)]
pub struct ResultEntry {
    pub info: AddrInfo,
    pub addr: SockaddrStorage,
}

// re-order result to interleave ipv4 and ipv6 (also pack into a single allocation)
fn process_results(info: *mut AddrInfo) -> Box<[ResultEntry]> {
    let mut count: usize = 0;
    let mut info_: *mut AddrInfo = info;
    while !info_.is_null() {
        count += 1;
        // SAFETY: info_ walks the libc-allocated addrinfo list; freed by caller after we return.
        info_ = unsafe { (*info_).ai_next };
    }

    let mut results: Box<[MaybeUninit<ResultEntry>]> = Box::new_uninit_slice(count);

    // copy results
    let mut i: usize = 0;
    info_ = info;
    while !info_.is_null() {
        // SAFETY: info_ is a valid addrinfo node (counted above); results[i] is a
        // MaybeUninit slot we fully initialize in this iteration.
        unsafe {
            let entry = results[i].as_mut_ptr();
            (*entry).info = *info_;
            // Always initialize `addr`: assume_init() below requires every byte written.
            // Windows getaddrinfo may return non-null ai_addr with families other than
            // AF_INET/AF_INET6; zero `addr` for those rather than leaving it uninit.
            if !(*info_).ai_addr.is_null() && (*info_).ai_family == netc::AF_INET {
                (*entry).addr = bun_core::ffi::zeroed();
                let addr_in = (&raw mut (*entry).addr).cast::<netc::sockaddr_in>();
                *addr_in = *(*info_).ai_addr.cast::<netc::sockaddr_in>();
            } else if !(*info_).ai_addr.is_null() && (*info_).ai_family == netc::AF_INET6 {
                (*entry).addr = bun_core::ffi::zeroed();
                let addr_in = (&raw mut (*entry).addr).cast::<netc::sockaddr_in6>();
                *addr_in = *(*info_).ai_addr.cast::<netc::sockaddr_in6>();
            } else {
                (*entry).addr = bun_core::ffi::zeroed();
            }
            i += 1;
            info_ = (*info_).ai_next;
        }
    }

    // SAFETY: every slot 0..count was written above
    let mut results: Box<[ResultEntry]> = unsafe { results.assume_init() };

    // sort (interleave ipv4 and ipv6)
    let mut want = netc::AF_INET6 as usize;
    'outer: for idx in 0..count {
        if results[idx].info.ai_family as usize == want {
            continue;
        }
        for j in (idx + 1)..count {
            if results[j].info.ai_family as usize == want {
                results.swap(idx, j);
                want = if want == netc::AF_INET6 as usize {
                    netc::AF_INET as usize
                } else {
                    netc::AF_INET6 as usize
                };
            }
        }
        // the rest of the list is all one address family
        break 'outer;
    }

    // set up pointers
    for idx in 0..count {
        let (left, right) = results.split_at_mut(idx + 1);
        let entry = &mut left[idx];
        entry.info.ai_canonname = ptr::null_mut();
        if idx + 1 < count {
            entry.info.ai_next = &raw mut right[0].info;
        } else {
            entry.info.ai_next = ptr::null_mut();
        }
        if !entry.info.ai_addr.is_null() {
            entry.info.ai_addr = (&raw mut entry.addr).cast::<Sockaddr>();
        }
    }

    results
}

fn after_result(req: *mut Request, info: *mut AddrInfo, err: c_int) {
    let results: Option<Box<[ResultEntry]>> = if !info.is_null() {
        let res = process_results(info);
        // ws2_32!getaddrinfo-allocated on Windows — free via the matching
        // ws2_32!freeaddrinfo (NOT uv_freeaddrinfo: different allocator).
        // `.cast()` is identity on POSIX, libuv_sys→ws2_32 addrinfo on Windows.
        // SAFETY: `info` is non-null (checked above) and owned by getaddrinfo.
        unsafe { bun_dns::freeaddrinfo(info.cast()) };
        Some(res)
    } else {
        None
    };

    let guard = global_cache().lock();

    // SAFETY: `req` is the heap-allocated cache entry; its mutable fields are
    // only touched under `global_cache().lock()`, which is held here.
    let notify = unsafe {
        // Park the owning Box on `Request.result_buf`; `RequestResult.info`
        // borrows its first element as a thin pointer for the C side.
        (*req).result_buf = results;
        let info = (*req)
            .result_buf
            .as_mut()
            .and_then(|b| NonNull::new(b.as_mut_ptr()));
        (*req).result = Some(RequestResult { info, err });
        let notify = core::mem::take(&mut (*req).notify);
        (*req).refcount -= 1;
        notify
    };

    // is this correct, or should it go after the loop?
    drop(guard);

    for query in notify {
        query.notify_threadsafe(req);
    }
}

fn work_pool_callback(req: *mut Request) {
    let mut service_buf = [0u8; 21];
    // SAFETY: `req` is the heap-allocated cache entry; `key` is set at construction and read-only.
    let port = unsafe { (*req).key.port };
    let service: *const c_char = if port > 0 {
        bun_fmt::itoa_z(&mut service_buf, port as u64).as_ptr()
    } else {
        ptr::null()
    };

    #[cfg(windows)]
    unsafe {
        use bun_sys::windows::ws2_32 as wsa;
        let mut wsa_hints: wsa::addrinfo = bun_core::ffi::zeroed();
        wsa_hints.ai_family = wsa::AF_UNSPEC;
        wsa_hints.ai_socktype = wsa::SOCK_STREAM;

        let mut addrinfo: *mut wsa::addrinfo = ptr::null_mut();
        let err = wsa::getaddrinfo(
            (*req)
                .key
                .host
                .as_ref()
                .map(|h| h.as_ptr().cast::<c_char>())
                .unwrap_or(ptr::null()),
            service,
            &wsa_hints,
            &mut addrinfo,
        );
        after_result(req, addrinfo.cast(), err);
    }
    #[cfg(not(windows))]
    // SAFETY: FFI getaddrinfo; `req.key.host` is the owned NUL-terminated host
    // set at construction, `hints`/`addrinfo` are stack locals.
    unsafe {
        let mut addrinfo: *mut AddrInfo = ptr::null_mut();
        let mut hints = get_hints();

        let host_ptr = (*req)
            .key
            .host
            .as_ref()
            .map(|h| h.as_ptr().cast::<c_char>())
            .unwrap_or(ptr::null());
        let mut err = libc::getaddrinfo(host_ptr, service, &raw const hints, &raw mut addrinfo);

        // optional fallback
        if err == netc::EAI_NONAME && (hints.ai_flags & netc::AI_ADDRCONFIG) != 0 {
            hints.ai_flags &= !netc::AI_ADDRCONFIG;
            (*req).can_retry_for_addrconfig = false;
            err = libc::getaddrinfo(host_ptr, service, &raw const hints, &raw mut addrinfo);
        }
        after_result(req, addrinfo, err);
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn lookup_libinfo(req: *mut Request, loop_: EventLoopHandle) -> bool {
    let Some(getaddrinfo_async_start_) = lib_info::getaddrinfo_async_start() else {
        return false;
    };

    let mut machport: mach_port = 0;
    let mut service_buf = [0u8; 21];
    // SAFETY: `req` is the live heap-allocated request owned by the caller.
    let port = unsafe { (*req).key.port };
    let service: *const c_char = if port > 0 {
        bun_fmt::itoa_z(&mut service_buf, port as u64).as_ptr()
    } else {
        ptr::null()
    };

    let hints = get_hints();

    // SAFETY: FFI call into libinfo; `req` is heap-allocated and lives
    // until `libinfo_callback` fires.
    let errno = unsafe {
        getaddrinfo_async_start_(
            &raw mut machport,
            (*req)
                .key
                .host
                .as_ref()
                .map(|h| h.as_ptr().cast::<c_char>())
                .unwrap_or(ptr::null()),
            service,
            &raw const hints,
            libinfo_callback,
            req.cast::<c_void>(),
        )
    };

    if errno != 0 || machport == 0 {
        return false;
    }

    let poll = FilePoll::init(
        loop_.as_event_loop_ctx(),
        // bitcast u32 mach_port → i32 fd
        sys::Fd::from_native(machport as i32),
        Default::default(),
        Async::Owner::new(req.cast::<()>(), request_run_file_poll),
    );
    // SAFETY: `poll` is a freshly-allocated hive slot; `loop_.r#loop()` is the live uws loop.
    let rc = unsafe {
        (*poll).register(
            &mut *loop_.r#loop(),
            Async::posix_event_loop::Flags::Machport,
            true,
        )
    };

    if rc.is_err() {
        // SAFETY: `poll` is the freshly-allocated hive slot returned by
        // `FilePoll::init` above; nothing else aliases it. Registration
        // failed, so it was never armed — release the slot back to the hive.
        unsafe { (*poll).deinit() };
        return false;
    }

    // SAFETY: `req` is the live heap-allocated request owned by the caller.
    #[cfg(target_os = "macos")]
    unsafe {
        (*req).libinfo = MacAsyncDNS {
            file_poll: NonNull::new(poll),
            machport,
        };
    }
    #[cfg(not(target_os = "macos"))]
    let _ = poll;

    true
}

#[cfg(target_os = "macos")]
extern "C" fn libinfo_callback(status: i32, addr_info: *mut AddrInfo, arg: *mut c_void) {
    let req: *mut Request = arg.cast();
    let status_int: c_int = status;
    'retry: {
        // SAFETY: `arg` is the `req` pointer registered with
        // `getaddrinfo_async_start`; it stays alive until this callback
        // completes the request.
        unsafe {
            if status == netc::EAI_NONAME as i32 && (*req).can_retry_for_addrconfig {
                (*req).can_retry_for_addrconfig = false;
                let mut service_buf = [0u8; 21];
                let service: *const c_char = if (*req).key.port > 0 {
                    bun_fmt::itoa_z(&mut service_buf, (*req).key.port as u64).as_ptr()
                } else {
                    ptr::null()
                };
                let Some(getaddrinfo_async_start_) = lib_info::getaddrinfo_async_start() else {
                    break 'retry;
                };
                let mut machport: mach_port = 0;
                let mut hints = get_hints();
                hints.ai_flags &= !netc::AI_ADDRCONFIG;

                let errno = getaddrinfo_async_start_(
                    &raw mut machport,
                    (*req)
                        .key
                        .host
                        .as_ref()
                        .map(|h| h.as_ptr().cast::<c_char>())
                        .unwrap_or(ptr::null()),
                    service,
                    &raw const hints,
                    libinfo_callback,
                    req.cast::<c_void>(),
                );

                if errno != 0 || machport == 0 {
                    bun_core::scoped_log!(
                        dns_cache,
                        "libinfoCallback: getaddrinfo_async_start retry failed (errno={})",
                        errno
                    );
                    break 'retry;
                }

                // Each getaddrinfo_async_start() call allocates a fresh receive
                // port via mach_port_allocate(MACH_PORT_RIGHT_RECEIVE) inside
                // libinfo's si_async_workunit_create() (si_module.c) — it is NOT
                // the per-thread MIG reply port and is not reused across calls.
                // libinfo's "async" API is just a libdispatch worker running sync
                // getaddrinfo and signalling completion via a send-once right on
                // this port; getaddrinfo_async_handle_reply() then destroys the
                // receive right after invoking us. So by the time we are here:
                //   - the first request's port is already dead (no leak, no need
                //     to mach_port_deallocate it ourselves), and
                //   - its kqueue knote is gone (it was EV_ONESHOT, and EVFILT_
                //     MACHPORT knotes are dropped when the receive right dies).
                // Store the new port and re-register the existing FilePoll on it,
                // otherwise we'd never see the retry's reply.
                #[cfg(target_os = "macos")]
                {
                    (*req).libinfo.machport = machport;
                    // SAFETY: file_poll was set in lookup_libinfo before the first callback fires.
                    let poll = (*req).libinfo.file_poll.unwrap().as_mut();
                    // `as i32` is the same-width bitcast of the u32 mach port.
                    poll.fd = sys::Fd::from_native(machport as i32);
                    match poll.register(
                        &mut *Loop::get(),
                        Async::posix_event_loop::Flags::Machport,
                        true,
                    ) {
                        sys::Result::Err(_) => {
                            bun_core::scoped_log!(
                                dns_cache,
                                "libinfoCallback: failed to register poll"
                            );
                            break 'retry;
                        }
                        sys::Result::Ok(_) => return,
                    }
                }
            }
        }
    }
    after_result(req, addr_info, status_int);
}

static DNS_CACHE_HITS_COMPLETED: AtomicUsize = AtomicUsize::new(0);
static DNS_CACHE_HITS_INFLIGHT: AtomicUsize = AtomicUsize::new(0);
static DNS_CACHE_SIZE: AtomicUsize = AtomicUsize::new(0);
static DNS_CACHE_MISSES: AtomicUsize = AtomicUsize::new(0);
static DNS_CACHE_ERRORS: AtomicUsize = AtomicUsize::new(0);
static GETADDRINFO_CALLS: AtomicUsize = AtomicUsize::new(0);

/// Snapshot for `Bun.dns.getCacheStats()` (read by `bun_runtime::dns_jsc`).
pub struct CacheStats {
    pub cache_hits_completed: usize,
    pub cache_hits_inflight: usize,
    pub cache_misses: usize,
    pub size: usize,
    pub errors: usize,
    pub total_count: usize,
}
pub fn cache_stats() -> CacheStats {
    CacheStats {
        cache_hits_completed: DNS_CACHE_HITS_COMPLETED.load(Ordering::Relaxed),
        cache_hits_inflight: DNS_CACHE_HITS_INFLIGHT.load(Ordering::Relaxed),
        cache_misses: DNS_CACHE_MISSES.load(Ordering::Relaxed),
        size: DNS_CACHE_SIZE.load(Ordering::Relaxed),
        errors: DNS_CACHE_ERRORS.load(Ordering::Relaxed),
        total_count: GETADDRINFO_CALLS.load(Ordering::Relaxed),
    }
}

pub fn getaddrinfo(
    loop_: *mut Loop,
    host: Option<&ZStr>,
    port: u16,
    is_cache_hit: Option<&mut bool>,
) -> Option<*mut Request> {
    let preload = is_cache_hit.is_none();
    let key = RequestKey::init(host, port);
    let mut guard = global_cache().lock();
    GETADDRINFO_CALLS.fetch_add(1, Ordering::Relaxed);
    let mut timestamp_to_store: u32 = 0;
    // is there a cache hit?
    if !env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE
        .get()
        .unwrap_or(false)
    {
        if let Some(entry) = guard.get(&key, &mut timestamp_to_store) {
            if preload {
                drop(guard);
                return None;
            }

            // SAFETY: `entry` is a live cache slot; refcount is only mutated under the held lock.
            unsafe { (*entry).refcount += 1 };

            // SAFETY: `entry` is a live cache slot; `result` is only mutated under the held lock.
            if unsafe { (*entry).result.is_some() } {
                *is_cache_hit.unwrap() = true;
                bun_core::scoped_log!(
                    dns_cache,
                    "getaddrinfo({}) = cache hit",
                    bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
                );
                DNS_CACHE_HITS_COMPLETED.fetch_add(1, Ordering::Relaxed);
            } else {
                bun_core::scoped_log!(
                    dns_cache,
                    "getaddrinfo({}) = cache hit (inflight)",
                    bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
                );
                DNS_CACHE_HITS_INFLIGHT.fetch_add(1, Ordering::Relaxed);
            }

            drop(guard);
            return Some(entry);
        }
    }

    // no cache hit, we have to make a new request
    let req = Request::new(
        key.to_owned(),
        (!preload) as u32 + 1,
        // Seconds since when this request was created
        if timestamp_to_store == 0 {
            GlobalCache::get_cache_timestamp()
        } else {
            timestamp_to_store
        },
    );

    let _ = guard.try_push(req);
    DNS_CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
    DNS_CACHE_SIZE.store(guard.len, Ordering::Relaxed);
    drop(guard);

    #[cfg(target_os = "macos")]
    {
        if !env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO
            .get()
            .unwrap_or(false)
        {
            // SAFETY: `loop_` is the live uSockets loop; its parent tag/ptr
            // was set by `EventLoopHandle::set_as_parent_of` at startup.
            let handle = unsafe {
                let (tag, ptr) = (*loop_).internal_loop_data.get_parent_raw();
                EventLoopHandle::from_tag_ptr(tag, ptr)
            };
            let res = lookup_libinfo(req, handle);
            bun_core::scoped_log!(
                dns_cache,
                "getaddrinfo({}) = cache miss (libinfo)",
                bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
            );
            if res {
                return Some(req);
            }
            // if we were not able to use libinfo, we fall back to the work pool
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = loop_;

    bun_core::scoped_log!(
        dns_cache,
        "getaddrinfo({}) = cache miss (libc)",
        bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
    );
    // schedule the request to be executed on the work pool
    let _ = bun_threading::work_pool::WorkPool::go(SendPtr(req), |r: SendPtr<Request>| {
        work_pool_callback(r.0)
    });
    Some(req)
}

pub fn prefetch(loop_: *mut Loop, hostname: Option<&ZStr>, port: u16) {
    let _ = getaddrinfo(loop_, hostname, port, None);
}

extern "C" fn us_getaddrinfo(
    loop_: *mut Loop,
    _host: *const c_char,
    port: u16,
    socket: *mut *mut c_void,
) -> c_int {
    let host: Option<&ZStr> = if _host.is_null() {
        None
    } else {
        // SAFETY: caller passes NUL-terminated string; compute len via strlen.
        Some(unsafe {
            let p = _host.cast::<u8>();
            ZStr::from_raw(p, libc::strlen(_host) as usize)
        })
    };
    let mut is_cache_hit = false;
    let req = getaddrinfo(loop_, host, port, Some(&mut is_cache_hit)).unwrap();
    // SAFETY: `socket` is the out-param the usockets caller passes; valid for one write.
    unsafe { *socket = req.cast::<c_void>() };
    if is_cache_hit { 0 } else { 1 }
}

extern "C" fn us_getaddrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
    let _guard = global_cache().lock();
    let query = DNSRequestOwner::Socket(socket);
    // SAFETY: `request` is a live cache entry; `result`/`notify` are only
    // touched under `global_cache().lock()`, which is held here.
    unsafe {
        if (*request).result.is_some() {
            query.notify(request);
            return;
        }
        (*request).notify.push(DNSRequestOwner::Socket(socket));
    }
}

extern "C" fn us_getaddrinfo_cancel(request: *mut Request, socket: *mut ConnectingSocket) -> c_int {
    let _guard = global_cache().lock();
    // afterResult sets result and moves the notify list out under this same
    // lock, so once result is non-null the socket is no longer cancellable
    // (the callback has fired or is about to fire on the worker thread).
    // SAFETY: `request` is a live cache entry; `result`/`notify` are only
    // touched under `global_cache().lock()`, which is held here.
    unsafe {
        if (*request).result.is_some() {
            return 0;
        }
        for (i, item) in (*request).notify.iter().enumerate() {
            match item {
                DNSRequestOwner::Socket(s) if *s == socket => {
                    (*request).notify.swap_remove(i);
                    return 1;
                }
                _ => {}
            }
        }
    }
    0
}

pub(crate) extern "C" fn freeaddrinfo(req: *mut Request, err: c_int) {
    let mut guard = global_cache().lock();

    // SAFETY: `req` is a live cache entry; refcount/valid are only mutated
    // under `global_cache().lock()`, which is held here.
    unsafe {
        if err != 0 {
            (*req).valid = false;
        }
        DNS_CACHE_ERRORS.fetch_add((err != 0) as usize, Ordering::Relaxed);

        debug_assert!((*req).refcount > 0);
        (*req).refcount -= 1;
        if (*req).refcount == 0 && (guard.is_nearly_full() || !(*req).valid) {
            bun_core::scoped_log!(dns_cache, "cache --");
            guard.remove(req);
            Request::deinit(req);
        }
    }
}

extern "C" fn get_request_result(req: *mut Request) -> *mut RequestResult {
    // SAFETY: caller (usockets) only invokes this after notify, when result is set
    unsafe { std::ptr::from_mut::<RequestResult>((*req).result.as_mut().unwrap()) }
}

// FFI exports.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__addrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
    us_getaddrinfo_set(request, socket)
}
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__addrinfo_cancel(
    request: *mut Request,
    socket: *mut ConnectingSocket,
) -> c_int {
    us_getaddrinfo_cancel(request, socket)
}
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__addrinfo_get(
    loop_: *mut Loop,
    host: *const c_char,
    port: u16,
    socket: *mut *mut c_void,
) -> c_int {
    us_getaddrinfo(loop_, host, port, socket)
}
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__addrinfo_freeRequest(req: *mut Request, err: c_int) {
    freeaddrinfo(req, err)
}
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__addrinfo_getRequestResult(req: *mut Request) -> *mut RequestResult {
    get_request_result(req)
}
