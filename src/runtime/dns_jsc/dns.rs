//! DNS resolver — JSC bindings.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::mem::MaybeUninit;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::{ArrayHashMap, HiveArray};
#[cfg(not(windows))]
use bun_core::Output;
use bun_core::{self as bun, env_var, fmt as bun_fmt};
use bun_core::{ZStr, strings};
#[cfg(not(windows))]
use bun_dns::ResultList as GetAddrInfoResultList;
use bun_dns::{
    self, Backend as GetAddrInfoBackend, GetAddrInfo, GetAddrInfoResult,
    Options as GetAddrInfoOptions, ResultAny as GetAddrInfoResultAny,
};
#[cfg(not(windows))]
use bun_io::FilePoll;
use bun_io::{self as Async, KeepAlive};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsCell, JsResult,
    SystemError, host_fn,
};
use bun_paths::PathBuffer;
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::windows::libuv;
#[cfg(not(windows))]
use bun_sys::{self as sys};
use bun_uws::{ConnectingSocket, Loop};
use bun_wyhash::hash as wyhash;

use super::cares_jsc::error_to_deferred;
use crate::socket::socket_address::inet::INET6_ADDRSTRLEN;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_cares_sys::c_ares_draft as c_ares;

// `sockaddr_storage` / `addrinfo` / `AF_*` / `AI_*` are absent from `libc` on
// the MSVC target; route through a single `netc` shim so call sites stay
// target-agnostic. Windows values come from ws2def.h via the libuv-sys mirror
// (layout-identical: `ADDRINFOA`, 128-byte 8-aligned `sockaddr_storage`).
#[cfg(not(windows))]
pub(crate) mod netc {
    pub(crate) use bun_dns::AI_ADDRCONFIG;
    pub(crate) use libc::{
        AF_INET, AF_INET6, AF_UNSPEC, EAI_NONAME, SOCK_STREAM, addrinfo, sockaddr, sockaddr_in,
        sockaddr_in6, sockaddr_storage,
    };
}
#[cfg(windows)]
pub(crate) mod netc {
    pub(crate) use bun_libuv_sys::{
        addrinfo, sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage,
    };
    pub(crate) use bun_sys::windows::ws2_32::{AF_INET, AF_INET6, AF_UNSPEC, SOCK_STREAM};
    /// The libuv spelling: `c_ares::Error::init_eai` reads UV_EAI_* codes on Windows.
    pub(crate) const EAI_NONAME: core::ffi::c_int = bun_libuv_sys::UV_EAI_NONAME;
}
type SockaddrStorage = netc::sockaddr_storage;
type AddrInfo = netc::addrinfo;
type Sockaddr = netc::sockaddr;

/// Helper: fetch the per-VM global DNS resolver (port of
/// `RareData::globalDNSResolver`). The storage is
/// [`crate::jsc_hooks::RuntimeState::global_dns_data`] — concrete
/// `Option<Box<GlobalData>>`, freed by `deinit_runtime_state` on VM teardown.
///
/// R-2: returns `&Resolver` (shared). All Resolver mutation routes through
/// `Cell` / `JsCell` fields, so a shared borrow is sufficient and avoids the
/// `noalias` hazard when c-ares callbacks re-enter on the same global resolver.
#[inline]
fn global_resolver(global_this: &JSGlobalObject) -> &Resolver {
    let gd = crate::jsc_hooks::global_dns_data().get_or_init(|| {
        let gd = GlobalData::init(global_this.bun_vm());
        gd.resolver.ref_(); // pin for the VM's lifetime
        gd
    });
    &gd.resolver
}

/// Send-wrapper for raw pointers handed to the threaded work pool. The DNS
/// `Request` is heap-allocated and only touched under `global_cache().lock()`,
/// so crossing threads is sound — Rust just can't see that through `*mut T`.
#[repr(transparent)]
struct SendPtr<T>(*mut T);
// SAFETY: see type doc — synchronization is provided by `global_cache()`.
unsafe impl<T> Send for SendPtr<T> {}

/// Bridge the JS-thread `VirtualMachine` to the aio-level `EventLoopCtx` used
/// by `KeepAlive` / `FilePoll`. The DNS resolver always runs on the JS event
/// loop, so the global `Js` ctx is the correct erasure here.
#[inline]
fn js_event_loop_ctx() -> Async::EventLoopCtx {
    Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js)
}

bun_output::declare_scope!(LibUVBackend, visible);
bun_output::declare_scope!(ResolveInfoRequest, hidden);
bun_output::declare_scope!(GetHostByAddrInfoRequest, visible);
bun_output::declare_scope!(CAresNameInfo, hidden);
bun_output::declare_scope!(GetNameInfoRequest, visible);
bun_output::declare_scope!(GetAddrInfoRequest, visible);
bun_output::declare_scope!(CAresReverse, visible);
bun_output::declare_scope!(CAresLookup, hidden);
bun_output::declare_scope!(DNSLookup, visible);
bun_output::declare_scope!(dns, hidden);
bun_output::declare_scope!(DNSResolver, visible);

// ──────────────────────────────────────────────────────────────────────────
// C type aliases
// ──────────────────────────────────────────────────────────────────────────

const IANA_DNS_PORT: i32 = 53;

// ──────────────────────────────────────────────────────────────────────────
// dns_sd (macOS): DNSServiceGetAddrInfo over one shared mDNSResponder connection, no per-lookup threads.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[path = "dns_sd.rs"]
pub(crate) mod dns_sd;

// ──────────────────────────────────────────────────────────────────────────
// LibC (blocking getaddrinfo on a worker thread; non-Windows)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
mod lib_c {
    use super::*;

    pub(crate) fn lookup(
        this: &Resolver,
        query_init: &GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JSValue {
        let key = get_addr_info_request::PendingCacheKey::init(query_init);

        let cache =
            this.get_or_put_into_pending_cache(&key, PendingCacheField::PendingHostCacheNative);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this);
            // SAFETY: inflight points into resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(dns_lookup) };
            // SAFETY: dns_lookup just heap-allocated; owned by the inflight list.
            return unsafe { (*dns_lookup).promise.value() };
        }

        let query = query_init.clone();

        // The backend result is filled in by the job's completion; until then
        // the request (which the pending cache points at) holds a placeholder.
        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::CAres,
            Some(this.as_ctx_ptr()),
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );
        // SAFETY: request was just heap-allocated in init() and is exclusively owned here.
        let promise_value = unsafe { (*request).head.promise.value() };

        bun_jsc::Job::<get_addr_info_request::LibcLookup>::schedule(
            &global_this.js_thread(),
            get_addr_info_request::LibcLookup {
                backend: get_addr_info_request::LibcBackend::Query(query),
            },
            get_addr_info_request::LibcRequest(NonNull::new(request).expect("request")),
        );
        this.request_sent(this.vm());

        promise_value
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LibUVBackend (Windows uv_getaddrinfo)
// ──────────────────────────────────────────────────────────────────────────

/// The windows implementation borrows the struct used for libc getaddrinfo
#[cfg(windows)]
pub(crate) mod lib_uv_backend {
    use super::*;

    pub(crate) struct LibuvCompleteHolder {
        uv_info: *mut libuv::uv_getaddrinfo_t,
    }

    impl LibuvCompleteHolder {
        pub(crate) fn run(self: Box<Self>) {
            GetAddrInfoRequest::on_libuv_complete(self.uv_info);
        }
    }
    impl bun_event_loop::Taskable for LibuvCompleteHolder {
        const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::GetAddrInfoLibuvComplete;
        /// A uv_getaddrinfo the stop phase cancelled and drained into the queue:
        /// its completion is what frees the request and its cache slot, and it
        /// only settles promises (no callback runs; script is forbidden), so run it.
        unsafe fn release_unrun(this: *mut Self) {
            // SAFETY: fn contract — the box `on_raw_libuv_complete` queued.
            unsafe { bun_core::heap::take(this) }.run();
        }
    }

    extern "C" fn on_raw_libuv_complete(
        uv_info: *mut libuv::uv_getaddrinfo_t,
        _status: c_int,
        _res: *mut libuv::addrinfo,
    ) {
        // TODO: We schedule a task to run because otherwise the promise will not be solved, we need to investigate this
        // SAFETY: data was set to the GetAddrInfoRequest pointer before uv_getaddrinfo
        let this: *mut GetAddrInfoRequest = unsafe { (*uv_info).data.cast() };

        let task = jsc::Task::from_boxed(Box::new(LibuvCompleteHolder { uv_info }));
        // SAFETY: `this` is the live GetAddrInfoRequest set as uv data.
        unsafe {
            (*this)
                .head
                .global_this()
                .bun_vm()
                .as_mut()
                .enqueue_task(task);
        }
    }

    pub(crate) fn lookup(
        this: &Resolver,
        query: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let key = get_addr_info_request::PendingCacheKey::init(&query);

        let cache =
            this.get_or_put_into_pending_cache(&key, PendingCacheField::PendingHostCacheNative);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this);
            unsafe { (*inflight).append(dns_lookup) };
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::uv_uninit()),
            Some(this.as_ctx_ptr()),
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );

        let hints = query.options.to_libc();
        let mut port_buf = [0u8; 128];
        let port_len = bun_fmt::print_int(&mut port_buf, query.port);
        port_buf[port_len] = 0;
        // SAFETY: port_buf[port_len] == 0 written above
        let port_z = ZStr::from_buf(&port_buf[..], port_len);

        let mut hostname = PathBuffer::uninit();
        // Reserve the last byte for the NUL terminator so the index below can never
        // exceed the buffer even if the upstream length guard in `doLookup` is bypassed.
        let cap = hostname.len() - 1;
        // `strings::copy` returns a slice borrowing `hostname`; take only its length
        // so the mutable borrow ends immediately and `hostname` can be indexed again.
        let copied_len = strings::copy(&mut hostname[..cap], query.name.as_ref()).len();
        hostname[copied_len] = 0;
        // SAFETY: hostname[copied_len] == 0 written above
        let host = ZStr::from_buf(&hostname[..], copied_len);

        // SAFETY: request lives until completion; backend.libc.uv is the embedded uv_getaddrinfo_t
        let promise = unsafe {
            (*request).backend.as_libc_uv_mut().data = request.cast::<c_void>();
            let promise = (*request).head.promise.value();
            let rc = libuv::uv_getaddrinfo(
                this.vm().uv_loop(),
                (*request).backend.as_libc_uv_mut(),
                Some(on_raw_libuv_complete),
                host.as_ptr().cast::<c_char>(),
                port_z.as_ptr().cast::<c_char>(),
                hints
                    .as_ref()
                    .map_or(ptr::null(), |h| (h as *const AddrInfo).cast()),
            );
            if rc.int() < 0 {
                // uv_getaddrinfo can fail synchronously before it queues any work
                // (e.g. UV_EINVAL from the 256-byte IDNA buffer for long hostnames,
                // or UV_ENOMEM). Route the error through the same path the async
                // completion would have taken so the pending-cache slot is released
                // and the promise is rejected with a DNSException.
                if let Some(resolver) = (*request).resolver_for_caching {
                    if let Some(pos) = (*request).pending_slot {
                        (*resolver).drain_pending_host_native(
                            pos,
                            (*request).head.global_this(),
                            rc.int(),
                            &GetAddrInfoResultAny::Addrinfo(ptr::null_mut()),
                        );
                        return Ok(promise);
                    }
                }
                // Consume the request and move `head` out by value; `ptr::read`
                // + `heap::take` would double-Drop `DNSLookup` (impls Drop).
                let owned = *bun_core::heap::take(request);
                let mut head = owned.head;
                DNSLookup::process_get_addr_info_native(&mut head, rc.int(), ptr::null_mut());
                return Ok(promise);
            }
            promise
        };
        Ok(promise)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// normalizeDNSName
// ──────────────────────────────────────────────────────────────────────────

fn normalize_dns_name<'a>(name: &'a [u8], backend: &mut GetAddrInfoBackend) -> &'a [u8] {
    if *backend == GetAddrInfoBackend::CAres {
        // https://github.com/c-ares/c-ares/issues/477
        if name.ends_with(b".localhost") {
            *backend = GetAddrInfoBackend::System;
            return b"localhost";
        } else if name.ends_with(b".local")
            // https://github.com/c-ares/c-ares/pull/463
            || bun_core::ip_address::is_ipv6_address(name)
            // getaddrinfo() is inconsistent with ares_getaddrinfo() when using localhost
            || name == b"localhost"
        {
            *backend = GetAddrInfoBackend::System;
        }
    }

    name
}

// ──────────────────────────────────────────────────────────────────────────
// ResolveInfoRequest<T> — generic c-ares record request (SRV/SOA/TXT/…)
// ──────────────────────────────────────────────────────────────────────────

/// Each c-ares reply struct implements this with its record-type tag.
pub trait CAresRecordType: Sized {
    const TYPE_NAME: &'static str;
    /// `"query" + ucfirst(TYPE_NAME)` — each impl carries the precomputed
    /// literal so error paths report the right syscall.
    const SYSCALL: &'static str;
    /// `"pending_{TYPE_NAME}_cache_cares"` — used to reach the matching HiveArray on `Resolver`.
    const CACHE_FIELD: PendingCacheField;
    /// The DNS RR type passed to `ares_query`.
    const NS_TYPE: c_ares::NSType;
    /// The `ares_callback` thunk that parses raw reply bytes for this record type
    /// and forwards to `ResolveInfoRequest<Self>::on_cares_complete`. Used as
    /// `ResolveHandler::raw_callback` for the generic `Channel::resolve` dispatch.
    const RAW_CALLBACK: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int);
    fn to_js_response(
        &mut self,
        global: &JSGlobalObject,
        type_name: &'static str,
    ) -> JsResult<JSValue>;
    /// Free a reply; called once per reply, by `OwnedReply<Self>`'s `Drop`.
    /// SAFETY: `this` must be the pointer an `OwnedReply<Self>` adopted; not aliased.
    unsafe fn destroy(this: *mut Self);
}

/// The parsed reply of one query, freed by `T::destroy` when dropped.
#[repr(transparent)]
pub(crate) struct OwnedReply<T: CAresRecordType>(NonNull<T>);

impl<T: CAresRecordType> OwnedReply<T> {
    /// SAFETY: `reply` must be a live reply that `T::destroy` frees, and the
    /// caller must give up every other use of it.
    unsafe fn adopt(reply: NonNull<T>) -> Self {
        Self(reply)
    }
}

impl<T: CAresRecordType> core::ops::Deref for OwnedReply<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: `adopt` took the only handle to a live reply; only `drop` frees it.
        unsafe { self.0.as_ref() }
    }
}

impl<T: CAresRecordType> core::ops::DerefMut for OwnedReply<T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as in `deref`; `&mut self` rules out any other live borrow.
        unsafe { self.0.as_mut() }
    }
}

impl<T: CAresRecordType> Drop for OwnedReply<T> {
    fn drop(&mut self) {
        // SAFETY: `adopt`'s contract; no borrow handed out by `deref` outlives `self`.
        unsafe { T::destroy(self.0.as_ptr()) }
    }
}

pub(crate) struct ResolveInfoRequest<T: CAresRecordType> {
    // TODO: should be Option<&'a Resolver> (struct gets <'a>); raw ptr until reconciled with intrusive RC
    pub resolver_for_caching: Option<*mut Resolver>,
    /// Slot this request owns in the resolver's pending cache, which same-name
    /// lookups chain onto until completion drains it; `None` when the cache was full.
    pub pending_slot: Option<u8>,
    pub head: CAresLookup<T>,
    pub tail: *mut CAresLookup<T>, // INTRUSIVE — points at `head` or last appended node
}

pub mod resolve_info_request {
    use super::*;

    pub struct PendingCacheKey<T: CAresRecordType> {
        pub(crate) hash: u64,
        pub(crate) len: u16,
        pub name: Box<[u8]>,
        pub(crate) lookup: *mut ResolveInfoRequest<T>,
    }

    impl<T: CAresRecordType> PendingCacheKey<T> {
        pub(crate) fn append(&mut self, cares_lookup: *mut CAresLookup<T>) {
            // SAFETY: lookup/tail are valid while request is in the pending cache
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(cares_lookup);
                (*self.lookup).tail = cares_lookup;
            }
        }

        pub(crate) fn init(name: &[u8]) -> Self {
            let hash = wyhash(name);
            Self {
                hash,
                len: name.len() as u16,
                name: Box::<[u8]>::from(name),
                lookup: ptr::null_mut(),
            }
        }
    }
}

impl<T: CAresRecordType> ResolveInfoRequest<T> {
    fn init(
        cache: LookupCacheHit<Self>,
        resolver: Option<*mut Resolver>,
        name: &[u8],
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            pending_slot: None,
            head: CAresLookup {
                // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { RefPtr::init_ref(r) }),
                global_this: bun_ptr::BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
                name: Box::<[u8]>::from(name),
                _marker: core::marker::PhantomData,
            },
            // tail set to &head below
            tail: ptr::null_mut(),
        }));
        // SAFETY: request just allocated
        unsafe { (*request).tail = &raw mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            // SAFETY: `new` is &mut into resolver's HiveArray buffer
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_cache_for::<T>(cache_field)
                    .index_of(new)
                    .unwrap();
                (*request).pending_slot = Some(pos as u8);
                (*new).lookup = request;
            }
        }
        request
    }

    fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<OwnedReply<T>>,
    ) {
        // SAFETY: this is the heap-allocated request c-ares calls back with
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                scopeguard::defer! { (*resolver).request_completed() };
                if let Some(pos) = (*this).pending_slot {
                    (*resolver).drain_pending_cares::<T>(pos, err_, timeout, result);
                    return;
                }
            }

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `CAresLookup<T>` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            CAresLookup::<T>::process_resolve(&raw mut head, err_, timeout, result);
        }
    }
}

// Wires `ResolveInfoRequest<T>` into `Channel::resolve` — the per-record
// `T::RAW_CALLBACK` parses the raw DNS reply and calls back into
// `on_cares_complete`.
impl<T: CAresRecordType> c_ares::ResolveHandler for ResolveInfoRequest<T> {
    const LOOKUP_NAME: &'static [u8] = T::TYPE_NAME.as_bytes();
    const NS_TYPE: c_ares::NSType = T::NS_TYPE;
    unsafe extern "C" fn raw_callback(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    ) {
        // SAFETY: `ctx` is the `*mut ResolveInfoRequest<T>` handed to `ares_query`
        // by `Channel::resolve`; the callback owns it for this call.
        unsafe { (T::RAW_CALLBACK)(ctx, status, timeouts, buffer, buffer_length) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetHostByAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct GetHostByAddrInfoRequest {
    // TODO: should be Option<&'a Resolver>; raw ptr for now
    pub resolver_for_caching: Option<*mut Resolver>,
    /// See [`ResolveInfoRequest::pending_slot`].
    pub pending_slot: Option<u8>,
    pub head: CAresReverse,
    pub tail: *mut CAresReverse, // INTRUSIVE
}

pub mod get_host_by_addr_info_request {
    use super::*;

    pub struct PendingCacheKey {
        pub(crate) hash: u64,
        pub(crate) len: u16,
        pub name: Box<[u8]>,
        pub(crate) lookup: *mut GetHostByAddrInfoRequest,
    }

    impl PendingCacheKey {
        pub(crate) fn append(&mut self, cares_lookup: *mut CAresReverse) {
            // SAFETY: lookup/tail are valid while request is in the pending cache
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(cares_lookup);
                (*self.lookup).tail = cares_lookup;
            }
        }

        pub(crate) fn init(name: &[u8]) -> Self {
            let hash = wyhash(name);
            Self {
                hash,
                len: name.len() as u16,
                name: Box::<[u8]>::from(name),
                lookup: ptr::null_mut(),
            }
        }
    }
}

impl GetHostByAddrInfoRequest {
    /// Reverse lookups always cache through `pending_addr_cache_cares`, so no
    /// `cache_field` selector is needed (unlike `ResolveInfoRequest::<T>::init`).
    fn init(
        cache: LookupCacheHit<Self>,
        resolver: Option<*mut Resolver>,
        name: &[u8],
        global_this: &JSGlobalObject,
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            pending_slot: None,
            head: CAresReverse {
                // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { RefPtr::init_ref(r) }),
                global_this: bun_ptr::BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
                name: Box::<[u8]>::from(name),
            },
            tail: ptr::null_mut(),
        }));
        // SAFETY: request just allocated; head is an inline field.
        unsafe { (*request).tail = &raw mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            // SAFETY: `new` is &mut into resolver's HiveArray buffer; resolver/request are live.
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_addr_cache_cares
                    .get()
                    .index_of(new)
                    .unwrap();
                (*request).pending_slot = Some(pos as u8);
                (*new).lookup = request;
            }
        }
        request
    }

    fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        // SAFETY: this is the heap-allocated request c-ares calls back with
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                if let Some(pos) = (*this).pending_slot {
                    (*resolver).drain_pending_addr_cares(pos, err_, timeout, result);
                    return;
                }
            }

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `CAresReverse` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            CAresReverse::process_resolve(&raw mut head, err_, timeout, result);
        }
    }
}

impl c_ares::HostentHandler for GetHostByAddrInfoRequest {
    fn on_hostent(
        &mut self,
        status: Option<c_ares::Error>,
        timeouts: i32,
        results: *mut c_ares::struct_hostent,
    ) {
        let result = if results.is_null() {
            None
        } else {
            Some(results)
        };
        Self::on_cares_complete(std::ptr::from_mut::<Self>(self), status, timeouts, result);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresNameInfo
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct CAresNameInfo {
    pub global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    pub promise: JSPromiseStrong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresNameInfo>>, // INTRUSIVE
    pub name: Box<[u8]>,
}

impl CAresNameInfo {
    /// SAFETY: `global_this` is a JSC_BORROW backref set at construction (both
    /// `init()` and the inline `head` of `GetNameInfoRequest::init()`) from a
    /// live `&JSGlobalObject`; never null, and the JSGlobalObject outlives every
    /// in-flight DNS request.
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    fn init(global_this: &JSGlobalObject, name: Box<[u8]>) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        bun_core::heap::into_raw(Box::new(Self {
            global_this: bun_ptr::BackRef::new(global_this),
            promise: JSPromiseStrong::init(global_this),
            poll_ref,
            allocated: true,
            next: None,
            name,
        }))
    }

    /// SAFETY: `this` must be a live node — either the inline head of a `*Request`
    /// (allocated == false; owner drops it) or a Boxed tail node (allocated == true;
    /// freed via `Self::destroy`). No `&mut` may alias `*this` across this call.
    unsafe fn process_resolve(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        // SAFETY: see fn contract — `this` is a live node.
        let global_this = unsafe { (*this).global_this() };
        if let Some(err) = err_ {
            // SAFETY: see fn contract.
            unsafe {
                error_to_deferred(
                    err,
                    b"getnameinfo",
                    Some((*this).name.as_ref()),
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
            }
            return;
        }
        let Some(mut name_info) = result else {
            // SAFETY: see fn contract.
            unsafe {
                error_to_deferred(
                    c_ares::Error::ENOTFOUND,
                    b"getnameinfo",
                    Some((*this).name.as_ref()),
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
            }
            return;
        };
        let array = Outcome::of(
            global_this,
            super::cares_jsc::nameinfo_to_js_response(&mut name_info, global_this),
        );
        // SAFETY: see fn contract.
        unsafe { Self::on_complete(this, array) };
    }

    /// SAFETY: see `process_resolve`.
    unsafe fn on_complete(this: *mut Self, result: Outcome) {
        // SAFETY: see fn contract — `this` is a live node.
        let mut promise = unsafe { core::mem::take(&mut (*this).promise) };
        // SAFETY: see fn contract — `this` is a live node.
        let global_this = unsafe { (*this).global_this() };
        result.settle(&mut promise, global_this);
        // SAFETY: see fn contract.
        unsafe { Self::destroy(this) };
    }

    /// Conditionally free a heap-allocated tail node. Head nodes (`allocated == false`)
    /// are inline fields of the parent `*Request` (or a stack local moved out of it) and
    /// are dropped exactly once by their owner; this is a no-op for them.
    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `init()`.
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: see fn contract — `this` is a live node; if `allocated`, it is
        // the exact pointer returned by `heap::alloc` in `init()`.
        unsafe {
            if (*this).allocated {
                drop(bun_core::heap::take(this));
            }
        }
    }
}

impl Drop for CAresNameInfo {
    fn drop(&mut self) {
        self.poll_ref.unref(js_event_loop_ctx());
        // self.name freed by Box<[u8]> Drop
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetNameInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct GetNameInfoRequest {
    // TODO: should be Option<&'a Resolver>; raw ptr for now
    pub resolver_for_caching: Option<*mut Resolver>,
    /// See [`ResolveInfoRequest::pending_slot`].
    pub pending_slot: Option<u8>,
    pub head: CAresNameInfo,
    pub tail: *mut CAresNameInfo, // INTRUSIVE
}

pub mod get_name_info_request {
    use super::*;

    pub struct PendingCacheKey {
        pub(crate) hash: u64,
        pub(crate) len: u16,
        pub name: Box<[u8]>,
        pub(crate) lookup: *mut GetNameInfoRequest,
    }

    impl PendingCacheKey {
        pub(crate) fn append(&mut self, cares_lookup: *mut CAresNameInfo) {
            // SAFETY: lookup/tail are valid while request is in the pending cache
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(cares_lookup);
                (*self.lookup).tail = cares_lookup;
            }
        }

        pub(crate) fn init(name: &[u8]) -> Self {
            let hash = wyhash(name);
            Self {
                hash,
                len: name.len() as u16,
                name: Box::<[u8]>::from(name),
                lookup: ptr::null_mut(),
            }
        }
    }
}

impl GetNameInfoRequest {
    fn init(
        cache: LookupCacheHit<Self>,
        resolver: Option<*mut Resolver>,
        name: Box<[u8]>,
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            pending_slot: None,
            head: CAresNameInfo {
                global_this: bun_ptr::BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
                name,
            },
            tail: ptr::null_mut(),
        }));
        // SAFETY: `request` was just heap-allocated above; `head` is an inline field.
        unsafe { (*request).tail = &raw mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            // SAFETY: `new` points into the resolver's HiveArray buffer; resolver/request are live.
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_nameinfo_cache_cares
                    .get()
                    .index_of(new)
                    .unwrap();
                (*request).pending_slot = Some(pos as u8);
                (*new).lookup = request;
            }
        }
        let _ = cache_field;
        request
    }

    fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        // SAFETY: `this` is the heap-allocated request c-ares calls back with;
        // `resolver` (if set) is the live intrusive-RC ctx stored at init time.
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                scopeguard::defer! { (*resolver).request_completed() };
                if let Some(pos) = (*this).pending_slot {
                    (*resolver).drain_pending_name_info_cares(pos, err_, timeout, result);
                    return;
                }
            }

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `CAresNameInfo` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            CAresNameInfo::process_resolve(&raw mut head, err_, timeout, result);
        }
    }
}

impl c_ares::NameinfoHandler for GetNameInfoRequest {
    #[inline]
    fn on_nameinfo(
        &mut self,
        status: Option<c_ares::Error>,
        timeouts: i32,
        info: Option<c_ares::struct_nameinfo>,
    ) {
        // SAFETY: `self` is the `heap::alloc`'d heap request registered with
        // c-ares; `on_cares_complete` consumes it (heap::take) on every path.
        // The c-ares callback wrapper does not touch `self` after this returns.
        GetNameInfoRequest::on_cares_complete(
            std::ptr::from_mut::<Self>(self),
            status,
            timeouts,
            info,
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub struct GetAddrInfoRequest {
    pub(crate) backend: get_addr_info_request::Backend,
    // TODO: should be Option<&'a Resolver>; raw ptr for now
    pub(crate) resolver_for_caching: Option<*mut Resolver>,
    /// See [`ResolveInfoRequest::pending_slot`].
    pub(crate) pending_slot: Option<u8>,
    pub(crate) head: DNSLookup,
    pub(crate) tail: *mut DNSLookup, // INTRUSIVE
}

pub mod get_addr_info_request {
    use super::*;

    /// The blocking `getaddrinfo` of one libc-backend lookup, run on the pool.
    #[cfg(not(windows))]
    pub struct LibcLookup {
        pub(crate) backend: LibcBackend,
    }

    /// The request a [`LibcLookup`] completes: JS-thread state (promises,
    /// keep-alive, resolver ref) at a stable address the resolver's pending
    /// cache points at. Consumed by the completion; dropped unconsumed only
    /// when the VM tears down first, in which case everything is freed and
    /// nothing is settled.
    #[cfg(not(windows))]
    pub struct LibcRequest(pub(crate) NonNull<super::GetAddrInfoRequest>);
    // SAFETY: only the JS thread touches the request (see type doc).
    #[cfg(not(windows))]
    unsafe impl bun_jsc::job::JsAffine for LibcRequest {}
    #[cfg(not(windows))]
    impl Drop for LibcRequest {
        fn drop(&mut self) {
            let req = self.0.as_ptr();
            // SAFETY: JS thread; the live heap request and its coalesced
            // waiters, none of which anything else will touch again.
            unsafe {
                if let Some(resolver) = (*req).resolver_for_caching {
                    if let Some(pos) = (*req).pending_slot {
                        drop(
                            (*resolver)
                                .get_key_host(pos, PendingCacheField::PendingHostCacheNative),
                        );
                    }
                }
                let mut pending = (*req).head.next;
                drop(*bun_core::heap::take(req));
                while let Some(waiter) = pending {
                    pending = (*waiter.as_ptr()).next;
                    drop(bun_core::heap::take(waiter.as_ptr()));
                }
            }
        }
    }

    #[cfg(not(windows))]
    impl bun_jsc::JobContext for LibcLookup {
        type OffThread = Self;
        type Js = LibcRequest;
        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
            this.backend.run();
            Some(done)
        }
        fn then(
            this: Self,
            request: LibcRequest,
            cx: &bun_jsc::JsThread<'_>,
        ) -> bun_jsc::JsResult<()> {
            // Consumed here: `then` takes over the request on every path, so
            // the release-on-drop must not run.
            let req = core::mem::ManuallyDrop::new(request).0.as_ptr();
            // SAFETY: the live heap request; `then` consumes it on every path.
            unsafe { (*req).backend = Backend::Libc(this.backend) };
            super::GetAddrInfoRequest::then(req, cx.global());
            Ok(())
        }
    }

    pub struct PendingCacheKey {
        pub(crate) hash: u64,
        pub(crate) len: u16,
        pub name: Box<[u8]>,
        pub(crate) lookup: *mut GetAddrInfoRequest,
    }

    impl PendingCacheKey {
        pub(crate) fn append(&mut self, dns_lookup: *mut DNSLookup) {
            // SAFETY: `lookup`/`tail` are valid while the request sits in the pending cache.
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(dns_lookup);
                (*self.lookup).tail = dns_lookup;
            }
        }

        pub(crate) fn init(query: &GetAddrInfo) -> Self {
            Self {
                hash: query.hash(),
                len: query.name.len() as u16,
                name: query.name.clone(),
                lookup: ptr::null_mut(),
            }
        }
    }

    #[cfg(target_os = "macos")]
    pub struct BackendDnsSd {
        pub(crate) query: dns_sd::QueryState,
    }

    #[cfg(target_os = "macos")]
    impl BackendDnsSd {
        pub(crate) fn new(protocol: dns_sd::DNSServiceProtocol) -> Self {
            Self {
                query: dns_sd::QueryState::new(protocol),
            }
        }
    }

    /// Non-Windows libc backend (worker-thread blocking getaddrinfo).
    #[cfg(not(windows))]
    pub enum LibcBackend {
        Success(GetAddrInfoResultList),
        Err(i32),
        Query(GetAddrInfo),
    }

    #[cfg(not(windows))]
    impl LibcBackend {
        pub(crate) fn run(&mut self) {
            let LibcBackend::Query(query) = self else {
                unreachable!()
            };
            let query_name = core::mem::take(&mut query.name); // freed at end of scope
            let hints = query.options.to_libc();
            let mut port_buf = [0u8; 128];
            let port_len = bun_fmt::print_int(&mut port_buf, query.port);
            port_buf[port_len] = 0;
            // SAFETY: NUL written at port_buf[port_len]
            let port_z = ZStr::from_buf(&port_buf[..], port_len);

            let mut hostname = PathBuffer::uninit();
            // Reserve the last byte for the NUL terminator so the index below
            // can never exceed the buffer even if the upstream length guard in
            // `doLookup` is bypassed.
            let cap = hostname.len() - 1;
            let copied_len = strings::copy(&mut hostname[..cap], &query_name).len();
            hostname[copied_len] = 0;
            let mut addrinfo: *mut AddrInfo = ptr::null_mut();
            // SAFETY: hostname[copied_len] == 0
            let host = ZStr::from_buf(&hostname[..], copied_len);
            let debug_timer = Output::DebugTimer::start();
            // SAFETY: FFI; all pointers valid for the call duration
            let err = unsafe {
                libc::getaddrinfo(
                    host.as_ptr().cast::<c_char>(),
                    if port_len > 0 {
                        port_z.as_ptr().cast::<c_char>()
                    } else {
                        ptr::null()
                    },
                    hints
                        .as_ref()
                        .map(std::ptr::from_ref)
                        .unwrap_or(ptr::null()),
                    &raw mut addrinfo,
                )
            };
            sys::syslog!(
                "getaddrinfo({}, {}) = {} ({})",
                bstr::BStr::new(&query_name),
                bstr::BStr::new(port_z.as_bytes()),
                err,
                debug_timer,
            );
            if err != 0 || addrinfo.is_null() {
                *self = LibcBackend::Err(err);
                return;
            }

            // do not free addrinfo when err != 0: getaddrinfo only allocates the
            // result list on success, so the out-pointer is unspecified on error.
            let _free = scopeguard::guard(addrinfo, |a| {
                // SAFETY: `a` was returned by libc::getaddrinfo (non-null per the check above).
                unsafe { bun_dns::freeaddrinfo(a) }
            });

            // SAFETY: addrinfo is non-null (checked above); freed by `_free` guard after copy.
            *self = LibcBackend::Success(GetAddrInfoResult::to_list(unsafe { &*addrinfo }));
        }
    }

    /// Windows libc backend wraps a uv_getaddrinfo_t.
    #[cfg(windows)]
    pub struct LibcBackend {
        pub(crate) uv: libuv::uv_getaddrinfo_t,
    }
    #[cfg(windows)]
    impl LibcBackend {
        pub(crate) fn uv_uninit() -> Self {
            Self {
                uv: bun_core::ffi::zeroed(),
            }
        }
    }
    pub enum Backend {
        CAres,
        #[cfg(target_os = "macos")]
        DnsSd(BackendDnsSd),
        Libc(LibcBackend),
    }

    impl Backend {
        #[cfg(target_os = "macos")]
        pub(crate) fn as_dns_sd_mut(&mut self) -> &mut BackendDnsSd {
            match self {
                Backend::DnsSd(l) => l,
                _ => unreachable!(),
            }
        }
        #[cfg(windows)]
        pub(crate) fn as_libc_uv_mut(&mut self) -> &mut libuv::uv_getaddrinfo_t {
            match self {
                Backend::Libc(l) => &mut l.uv,
                _ => unreachable!(),
            }
        }
    }
}

impl GetAddrInfoRequest {
    pub(crate) fn init(
        cache: CacheHit,
        backend: get_addr_info_request::Backend,
        resolver: Option<*mut Resolver>,
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        bun_output::scoped_log!(GetAddrInfoRequest, "init");
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            backend,
            resolver_for_caching: resolver,
            pending_slot: None,
            head: DNSLookup {
                // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { RefPtr::init_ref(r) }),
                global_this: bun_ptr::BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
            },
            tail: ptr::null_mut(),
        }));
        // SAFETY: request just allocated; head is an inline field.
        unsafe { (*request).tail = &raw mut (*request).head };
        if let CacheHit::New(new) = cache {
            // SAFETY: `new` is &mut into resolver's HiveArray buffer; resolver/request are live.
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_host_cache(cache_field)
                    .index_of(new)
                    .unwrap();
                (*request).pending_slot = Some(pos as u8);
                (*new).lookup = request;
            }
        }
        request
    }

    /// Reply callback (inside `DNSServiceProcessResult`): records state; completion happens in `on_readable`.
    /// # Safety
    /// `context` is the registered `*mut GetAddrInfoRequest`; `address`, if non-null, is a valid sockaddr.
    #[cfg(target_os = "macos")]
    pub(crate) unsafe extern "C" fn dns_sd_reply(
        _sd_ref: dns_sd::DNSServiceRef,
        flags: u32,
        _interface_index: u32,
        error_code: i32,
        _hostname: *const c_char,
        address: *const Sockaddr,
        ttl: u32,
        context: *mut c_void,
    ) {
        dns_sd::SharedConnection::note_reply(context);
        // SAFETY: context is the *mut GetAddrInfoRequest passed to start().
        let this: *mut Self = context.cast();
        // SAFETY: `this` is the live heap request (JS thread); `address` is valid per dns_sd.h.
        unsafe {
            (*this)
                .backend
                .as_dns_sd_mut()
                .query
                .record_reply(flags, error_code, address, ttl);
        }
    }

    /// Complete a dns_sd-backed request; `this` is the live heap request, consumed on every path.
    #[cfg(target_os = "macos")]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn complete_dns_sd(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and exclusively owned here.
        unsafe {
            let query = &mut (*this).backend.as_dns_sd_mut().query;
            let results = query.take_results();
            let status = if !results.is_empty() {
                0
            } else {
                dns_sd::EMPTY_STATUS
            };
            bun_output::scoped_log!(
                GetAddrInfoRequest,
                "completeDnsSd: status={} results={}",
                status,
                results.len()
            );
            // Error path must be `Addrinfo(null)`: `drain_pending_host_native` keys on `result_any_to_js` == None.
            let any = if status == 0 {
                GetAddrInfoResultAny::List(results)
            } else {
                GetAddrInfoResultAny::Addrinfo(ptr::null_mut())
            };

            if let Some(resolver) = (*this).resolver_for_caching {
                if let Some(pos) = (*this).pending_slot {
                    (*resolver).drain_pending_host_native(
                        pos,
                        (*this).head.global_this(),
                        status,
                        &any,
                    );
                    return;
                }
            }

            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            if status != 0 {
                DNSLookup::process_get_addr_info_native(&raw mut head, status, ptr::null_mut());
            } else {
                DNSLookup::on_complete_native(&raw mut head, &any);
            }
        }
    }

    #[cfg(not(windows))]
    /// # Safety
    /// `this` must be the live heap `GetAddrInfoRequest` whose `run` already
    /// completed; consumed (freed) on every path.
    // `this` is reclaimed via `heap::take` (Box::from_raw) inside; forming
    // `&mut *this` at entry would invalidate the pointer's allocation
    // provenance, so the param must stay `*mut`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn then(this: *mut Self, _global: &JSGlobalObject) {
        bun_output::scoped_log!(GetAddrInfoRequest, "then");
        // SAFETY: called on the JS thread with the heap request the lookup was
        // created from; `resolver_for_caching` (if set) is the live ctx ref.
        unsafe {
            // Take the backend by value: `Success` holds a `Vec<GetAddrInfoResult>`
            // (not `Clone`) that we move into `GetAddrInfoResultAny::List`. The
            // request is consumed/freed on every path below, so the `CAres`
            // placeholder left behind owns no resources.
            let backend =
                core::mem::replace(&mut (*this).backend, get_addr_info_request::Backend::CAres);
            match backend {
                get_addr_info_request::Backend::Libc(
                    get_addr_info_request::LibcBackend::Success(result),
                ) => {
                    // `ResultAny` impls `Drop` (frees the list) — the by-value drop
                    // at the end of whichever callee receives `any`.
                    let any = GetAddrInfoResultAny::List(result);
                    if let Some(resolver) = (*this).resolver_for_caching {
                        if let Some(pos) = (*this).pending_slot {
                            (*resolver).drain_pending_host_native(
                                pos,
                                (*this).head.global_this(),
                                0,
                                &any,
                            );
                            return;
                        }
                    }
                    // Consume the request and move `head` out by value;
                    // `ptr::read` + `heap::take` would double-Drop `DNSLookup`.
                    let owned = *bun_core::heap::take(this);
                    let mut head = owned.head;
                    DNSLookup::on_complete_native(&raw mut head, &any);
                }
                get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::Err(
                    err,
                )) => {
                    if let Some(resolver) = (*this).resolver_for_caching {
                        if let Some(pos) = (*this).pending_slot {
                            (*resolver).drain_pending_host_native(
                                pos,
                                (*this).head.global_this(),
                                err,
                                &GetAddrInfoResultAny::Addrinfo(ptr::null_mut()),
                            );
                            return;
                        }
                    }
                    let owned = *bun_core::heap::take(this);
                    let mut head = owned.head;
                    DNSLookup::process_get_addr_info_native(&raw mut head, err, ptr::null_mut());
                }
                _ => unreachable!(),
            }
        }
    }

    /// # Safety
    /// `this` must be the heap `GetAddrInfoRequest` registered with c-ares;
    /// consumed (freed) on every path.
    // `this` is reclaimed via `heap::take` (Box::from_raw) inside; forming
    // `&mut *this` at entry would invalidate the pointer's allocation
    // provenance, so the param must stay `*mut`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::AddrInfo>,
    ) {
        bun_output::scoped_log!(GetAddrInfoRequest, "onCaresComplete");
        // SAFETY: `this` is the heap-allocated request c-ares calls back with;
        // `resolver` (if set) is the live intrusive-RC ctx stored at init time.
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                if let Some(pos) = (*this).pending_slot {
                    (*resolver).drain_pending_host_cares(pos, err_, timeout, result);
                    return;
                }
            }

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `DNSLookup` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            DNSLookup::process_get_addr_info(&raw mut head, err_, timeout, result);
        }
    }

    #[cfg(windows)]
    pub(crate) fn on_libuv_complete(uv_info: *mut libuv::uv_getaddrinfo_t) {
        unsafe {
            let retcode = (*uv_info).retcode.int();
            bun_output::scoped_log!(GetAddrInfoRequest, "onLibUVComplete: status={}", retcode);
            let this: *mut Self = (*uv_info).data.cast();
            #[cfg(windows)]
            debug_assert!(uv_info == core::ptr::from_mut((*this).backend.as_libc_uv_mut()));

            // On Windows, libuv's `uv_getaddrinfo` calls `GetAddrInfoW` then
            // re-packs the wide result into a single ANSI block allocated via
            // `uv__malloc`; that block must be released with `uv_freeaddrinfo`
            // (== `uv__free`). `GetAddrInfoResultAny::Addrinfo`'s `Drop` calls
            // `ws2_32!freeaddrinfo`, which is the wrong allocator here and
            // would corrupt the heap. Convert to an owned `List` immediately, free the libuv
            // buffer with the correct deallocator, and pass `List` downstream
            // so `ResultAny::Drop` never sees libuv-owned memory.
            let addrinfo = (*uv_info).addrinfo;
            let result_any = if addrinfo.is_null() {
                GetAddrInfoResultAny::Addrinfo(ptr::null_mut())
            } else {
                let list = GetAddrInfoResult::to_list(&*addrinfo);
                libuv::uv_freeaddrinfo(addrinfo.cast());
                GetAddrInfoResultAny::List(list)
            };

            if let Some(resolver) = (*this).resolver_for_caching {
                if let Some(pos) = (*this).pending_slot {
                    (*resolver).drain_pending_host_native(
                        pos,
                        (*this).head.global_this(),
                        retcode,
                        &result_any,
                    );
                    return;
                }
            }

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `DNSLookup` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            // Inline `process_get_addr_info_native` so the success path can
            // reuse the owned `List` instead of re-wrapping the (now-freed)
            // raw `addrinfo` pointer.
            if c_ares::Error::init_eai(retcode).is_some() {
                DNSLookup::process_get_addr_info_native(&raw mut head, retcode, ptr::null_mut());
            } else {
                DNSLookup::on_complete_native(&raw mut head, &result_any);
            }
        }
    }
}

// Wires `GetAddrInfoRequest` into `Channel::get_addr_info`.
impl c_ares::AddrInfoHandler for GetAddrInfoRequest {
    fn on_addr_info(
        &mut self,
        status: Option<c_ares::Error>,
        timeouts: i32,
        results: *mut c_ares::AddrInfo,
    ) {
        let result = if results.is_null() {
            None
        } else {
            Some(results)
        };
        Self::on_cares_complete(std::ptr::from_mut::<Self>(self), status, timeouts, result);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresReverse
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct CAresReverse {
    pub resolver: Option<RefPtr<Resolver>>,
    pub global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    pub promise: JSPromiseStrong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresReverse>>, // INTRUSIVE
    pub name: Box<[u8]>,
}

impl CAresReverse {
    /// Borrow the owning `JSGlobalObject`.
    ///
    /// SAFETY: `global_this` is a JSC_BORROW backref set from a live
    /// `&JSGlobalObject` in `init()` / `GetHostByAddrInfoRequest::init()`; the
    /// global outlives every DNS request hung off of it, so the pointer is
    /// always non-null and valid for the lifetime of `self`.
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    fn init(
        resolver: Option<*mut Resolver>,
        global_this: &JSGlobalObject,
        name: &[u8],
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
            resolver: resolver.map(|r| unsafe { RefPtr::init_ref(r) }),
            global_this: bun_ptr::BackRef::new(global_this),
            promise: JSPromiseStrong::init(global_this),
            poll_ref,
            allocated: true,
            next: None,
            name: Box::<[u8]>::from(name),
        }))
    }

    /// SAFETY: `this` must be a live node — either the inline head of a `*Request`
    /// (allocated == false; owner drops it) or a Boxed tail node (allocated == true;
    /// freed via `Self::destroy`). No `&mut` may alias `*this` across this call.
    unsafe fn process_resolve(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let global_this = (*this).global_this();
            if let Some(err) = err_ {
                error_to_deferred(
                    err,
                    b"getHostByAddr",
                    Some(&(*this).name),
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
                return;
            }
            let Some(node) = result else {
                error_to_deferred(
                    c_ares::Error::ENOTFOUND,
                    b"getHostByAddr",
                    Some(&(*this).name),
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
                return;
            };
            // node is a valid c-ares hostent for the callback's duration
            let array = Outcome::of(
                global_this,
                super::cares_jsc::hostent_to_js_response(&mut *node, global_this, b""),
            );
            Self::on_complete(this, array);
        }
    }

    /// SAFETY: see `process_resolve`.
    unsafe fn on_complete(this: *mut Self, result: Outcome) {
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            result.settle(&mut promise, global_this);
            if let Some(resolver) = (*this).resolver.as_ref() {
                // RefPtr holds a live ref; request_completed mutates pending_requests counter only.
                (*resolver.as_ptr()).request_completed();
            }
            Self::destroy(this);
        }
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `init()`. Head nodes (`!allocated`)
    /// are dropped by their owner; this is a no-op for them.
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: see fn contract — `this` is live; if `allocated`, it is the
        // exact pointer returned by `heap::alloc` in `init()`.
        unsafe {
            if (*this).allocated {
                drop(bun_core::heap::take(this));
            }
        }
    }
}

impl Drop for CAresReverse {
    fn drop(&mut self) {
        let _ = self.global_this();
        self.poll_ref.unref(js_event_loop_ctx());
        // self.name freed by Box<[u8]> Drop
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresLookup<T>
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct CAresLookup<T: CAresRecordType> {
    pub resolver: Option<RefPtr<Resolver>>,
    pub global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    pub promise: JSPromiseStrong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresLookup<T>>>, // INTRUSIVE
    pub name: Box<[u8]>,
    _marker: core::marker::PhantomData<T>,
}

impl<T: CAresRecordType> CAresLookup<T> {
    fn new(data: Self) -> *mut Self {
        debug_assert!(data.allocated); // deinit will not free this otherwise
        bun_core::heap::into_raw(Box::new(data))
    }

    fn init(
        resolver: Option<*mut Resolver>,
        global_this: &JSGlobalObject,
        name: &[u8],
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
            resolver: resolver.map(|r| unsafe { RefPtr::init_ref(r) }),
            global_this: bun_ptr::BackRef::new(global_this),
            promise: JSPromiseStrong::init(global_this),
            poll_ref,
            allocated: true,
            next: None,
            name: Box::<[u8]>::from(name),
            _marker: core::marker::PhantomData,
        })
    }

    /// Borrow the owning [`JSGlobalObject`].
    ///
    /// SAFETY: `global_this` is a JSC_BORROW backref set at construction (both
    /// `init()` and the inline `head` of `ResolveInfoRequest::init()`) from a
    /// live `&JSGlobalObject`; never null, and the JSGlobalObject outlives every
    /// in-flight DNS request.
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    /// SAFETY: `this` must be a live node — either the inline head of a `*Request`
    /// (allocated == false; owner drops it) or a Boxed tail node (allocated == true;
    /// freed via `Self::destroy`). No `&mut` may alias `*this` across this call.
    unsafe fn process_resolve(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<OwnedReply<T>>,
    ) {
        // syscall = "query" + ucfirst(TYPE_NAME); each `CAresRecordType` impl
        // carries the precomputed literal.
        let syscall = T::SYSCALL; // e.g. "querySrv"

        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let global_this = (*this).global_this();
            if let Some(err) = err_ {
                error_to_deferred(
                    err,
                    syscall.as_bytes(),
                    Some(&(*this).name),
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
                return;
            }
            let Some(mut node) = result else {
                error_to_deferred(
                    c_ares::Error::ENOTFOUND,
                    syscall.as_bytes(),
                    Some(&(*this).name),
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
                return;
            };

            let array = Outcome::of(global_this, node.to_js_response(global_this, T::TYPE_NAME));
            Self::on_complete(this, array);
        }
    }

    /// SAFETY: see `process_resolve`.
    unsafe fn on_complete(this: *mut Self, result: Outcome) {
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            result.settle(&mut promise, global_this);
            if let Some(resolver) = (*this).resolver.as_ref() {
                // RefPtr holds a live ref; request_completed mutates pending_requests counter only.
                (*resolver.as_ptr()).request_completed();
            }
            Self::destroy(this);
        }
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `new()`. Head nodes (`!allocated`)
    /// are dropped by their owner; this is a no-op for them.
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: see fn contract — `this` is live; if `allocated`, it is the
        // exact pointer returned by `heap::alloc` in `init()`.
        unsafe {
            if (*this).allocated {
                drop(bun_core::heap::take(this));
            }
        }
    }
}

impl<T: CAresRecordType> Drop for CAresLookup<T> {
    fn drop(&mut self) {
        let _ = self.global_this();
        self.poll_ref.unref(js_event_loop_ctx());
        // self.name freed by Box<[u8]> Drop
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DNSLookup
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct DNSLookup {
    pub resolver: Option<RefPtr<Resolver>>,
    pub global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    pub promise: JSPromiseStrong,
    pub allocated: bool,
    pub next: Option<NonNull<DNSLookup>>, // INTRUSIVE
    pub poll_ref: KeepAlive,
}

impl DNSLookup {
    /// Borrow the owning `JSGlobalObject`.
    ///
    /// SAFETY (encapsulated): `global_this` is assigned exactly once at
    /// construction from a live `&JSGlobalObject` (never null) and is a
    /// JSC_BORROW backref — the global outlives every `DNSLookup` it spawns.
    /// The pointee is the JSC heap global, not memory owned by `self`, so the
    /// returned `&` remains valid even after `self` is dropped (drain loops
    /// rely on this when caching the ref across `heap::take`).
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    fn init(resolver: *mut Resolver, global_this: &JSGlobalObject) -> *mut Self {
        bun_output::scoped_log!(DNSLookup, "init");

        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());

        bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
            resolver: Some(unsafe { RefPtr::init_ref(resolver) }),
            global_this: bun_ptr::BackRef::new(global_this),
            poll_ref,
            promise: JSPromiseStrong::init(global_this),
            allocated: true,
            next: None,
        }))
    }

    /// SAFETY: `this` must be a live node — either the inline head of a `*Request`
    /// (allocated == false; owner drops it) or a Boxed tail node (allocated == true;
    /// freed via `Self::destroy`). No `&mut` may alias `*this` across this call.
    unsafe fn on_complete_native(this: *mut Self, result: &GetAddrInfoResultAny) {
        bun_output::scoped_log!(DNSLookup, "onCompleteNative");
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let global = (*this).global_this();
            // A null addrinfo with no error is an empty answer.
            let array = super::options_jsc::result_any_to_js(result, global)
                .and_then(|a| a.map_or_else(|| JSValue::create_empty_array(global, 0), Ok));
            Self::on_complete_with_array(this, Outcome::of(global, array));
        }
    }

    /// SAFETY: see `on_complete_native`.
    unsafe fn process_get_addr_info_native(this: *mut Self, status: i32, result: *mut AddrInfo) {
        bun_output::scoped_log!(DNSLookup, "processGetAddrInfoNative: status={}", status);
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            if let Some(err) = c_ares::Error::init_eai(status) {
                error_to_deferred(err, b"getaddrinfo", None, &mut (*this).promise)
                    .reject_later((*this).global_this());
                Self::destroy(this);
                return;
            }
            Self::on_complete_native(this, &GetAddrInfoResultAny::Addrinfo(result));
        }
    }

    /// SAFETY: see `on_complete_native`.
    unsafe fn process_get_addr_info(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<*mut c_ares::AddrInfo>,
    ) {
        bun_output::scoped_log!(DNSLookup, "processGetAddrInfo");
        // This path is reached when the pending-host cache is full (`.disabled`),
        // so we own the c-ares result here. The cached path frees it in
        // `drainPendingHostCares`; callers from there always pass `null`.
        let _free = scopeguard::guard(result, |r| {
            if let Some(r) = r {
                // SAFETY: r is the c-ares-allocated AddrInfo; we own it on this path.
                unsafe { c_ares::AddrInfo::destroy(r) };
            }
        });

        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let global_this = (*this).global_this();
            if let Some(err) = err_ {
                error_to_deferred(err, b"getaddrinfo", None, &mut (*this).promise)
                    .reject_later(global_this);
                Self::destroy(this);
                return;
            }

            // `r` is the c-ares-allocated AddrInfo valid for the callback's duration.
            let Some(r) = result.filter(|r| !(**r).node.is_null()) else {
                error_to_deferred(
                    c_ares::Error::ENOTFOUND,
                    b"getaddrinfo",
                    None,
                    &mut (*this).promise,
                )
                .reject_later(global_this);
                Self::destroy(this);
                return;
            };
            Self::on_complete(this, r);
        }
    }

    /// SAFETY: see `on_complete_native`.
    unsafe fn on_complete(this: *mut Self, result: *mut c_ares::AddrInfo) {
        bun_output::scoped_log!(DNSLookup, "onComplete");
        // SAFETY: caller contract — `this` is live; result is a live c-ares AddrInfo
        // owned by the caller's scopeguard; JSGlobalObject outlives the request.
        unsafe {
            let global = (*this).global_this();
            let array = super::cares_jsc::addr_info_to_js_array(&mut *result, global);
            Self::on_complete_with_array(this, Outcome::of(global, array));
        }
    }

    /// SAFETY: see `on_complete_native`.
    unsafe fn on_complete_with_array(this: *mut Self, result: Outcome) {
        bun_output::scoped_log!(DNSLookup, "onCompleteWithArray");
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            result.settle(&mut promise, global_this);
            if let Some(resolver) = (*this).resolver.as_ref() {
                // RefPtr holds a live ref; request_completed mutates pending_requests counter only.
                (*resolver.as_ptr()).request_completed();
            }
            Self::destroy(this);
        }
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `init()`. Head nodes (`!allocated`)
    /// are dropped by their owner; this is a no-op for them.
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; if `allocated`, it is the exact
        // pointer from `heap::alloc` in `init()`.
        unsafe {
            if (*this).allocated {
                drop(bun_core::heap::take(this));
            }
        }
    }
}

/// The converted answer for one global, shared by every waiter of a
/// pending-cache entry on that global. A conversion that threw is turned into
/// its exception value *once* (the first `reject(Err(Thrown))` would take it
/// off the VM and leave nothing for the next waiter); a termination settles
/// nobody.
#[derive(Clone, Copy)]
pub(crate) enum Outcome {
    Value(JSValue),
    Error(JSValue),
    Stopped,
}

impl Outcome {
    pub(crate) fn of(global: &JSGlobalObject, result: JsResult<JSValue>) -> Outcome {
        match result {
            Ok(v) => Outcome::Value(v),
            Err(bun_jsc::JsError::OutOfMemory) => {
                Outcome::Error(global.create_out_of_memory_error())
            }
            Err(err) => {
                let e = global.take_exception(err);
                if e.is_termination_exception() {
                    Outcome::Stopped
                } else {
                    Outcome::Error(e.to_error().unwrap_or(e))
                }
            }
        }
    }

    /// Each waiter's completion may allocate; keep the shared value alive across them.
    #[inline]
    fn keep_alive(&self) {
        if let Outcome::Value(v) | Outcome::Error(v) = self {
            v.ensure_still_alive();
        }
    }

    /// The resolver backends' completion callbacks (c-ares poll, libinfo,
    /// libuv) land here to settle the lookup's promise with a value built by
    /// the resolver: this is their fold for what settling leaves pending
    /// (allocation failure, a terminating VM).
    fn settle(self, promise: &mut JSPromiseStrong, global: &JSGlobalObject) {
        let _guard = VirtualMachine::get().enter_event_loop_scope();
        crate::dispatch::fold(match self {
            Outcome::Value(v) => promise.resolve(global, v),
            Outcome::Error(e) => promise.reject(global, Ok(e)),
            Outcome::Stopped => return,
        });
    }
}

#[inline]
fn keep_alive(outcome: &Outcome) {
    outcome.keep_alive();
}

impl Drop for DNSLookup {
    fn drop(&mut self) {
        bun_output::scoped_log!(DNSLookup, "deinit");
        let _ = self.global_this();
        // DNSLookup is always created on the JS event loop (it holds a JSGlobalObject),
        // so the Js-arm vtable is the correct EventLoopCtx for KeepAlive::unref.
        self.poll_ref.unref(Async::posix_event_loop::get_vm_ctx(
            Async::AllocatorType::Js,
        ));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GlobalData
// ──────────────────────────────────────────────────────────────────────────

pub struct GlobalData {
    pub(crate) resolver: Resolver,
}

impl GlobalData {
    pub(crate) fn init(vm: &VirtualMachine) -> Box<Self> {
        Box::new(Self {
            resolver: Resolver::setup(vm),
        })
    }
}

impl Resolver {
    /// Worker-terminate / main-VM-destruct hook: tear down the c-ares channel
    /// while the JSC VM, `RareData.file_polls`, event loop, and `runtime_state`
    /// are all still live. `ares_destroy()` synchronously fires every pending
    /// query callback with `ARES_EDESTRUCTION` and then the socket-state
    /// callback for each fd it closes; those callback chains dereference
    /// `DNSLookup::global_this` (to enqueue the rejection task) and the hive
    /// `FilePoll` (to unregister it from the loop). Running this after either
    /// is freed is a UAF (Node `test-worker-dns-terminate.js`).
    /// Windows: `uv_getaddrinfo` requests are uv *requests* on this thread's
    /// loop, which the teardown drains before closing the loop; cancel the ones
    /// still in flight so that drain is prompt (each completes through its
    /// callback with UV_ECANCELED against the still-live VM).
    #[cfg(windows)]
    pub(crate) fn cancel_pending_uv_requests_for_teardown(&self) {
        // SAFETY: JS thread; no other borrow of the cache is live during the
        // stop phase (completions run later, from the loop drain).
        let cache = unsafe { self.pending_host_cache_native.get_mut() };
        let mut set = cache.used.iter_set();
        while let Some(index) = set.next() {
            // SAFETY: a set slot is an initialised `PendingCacheKey`; JS thread.
            let lookup = unsafe { (*cache.ptr_at(index)).lookup };
            if lookup.is_null() {
                continue;
            }
            // SAFETY: `lookup` is the live boxed request until its completion
            // callback removes it from the cache.
            unsafe {
                if let get_addr_info_request::Backend::Libc(l) = &mut (*lookup).backend {
                    let _ = libuv::uv_cancel(core::ptr::from_mut(&mut l.uv).cast());
                }
            }
        }
    }

    /// `Stopped` if a channel was open (its pending queries just failed with
    /// `ARES_EDESTRUCTION` into their callbacks).
    ///
    /// # Safety
    /// `this` is a live resolver. It may be freed by the time this returns (a
    /// failing query can drop the last reference); the caller touches nothing
    /// of it afterwards.
    pub(crate) unsafe fn close_channel_for_terminate(
        this: *mut Self,
    ) -> bun_jsc::virtual_machine::SweepResult {
        use bun_jsc::virtual_machine::SweepResult;
        // Failing the pending queries releases their refs on this resolver from
        // inside `ares_destroy`; hold one so it outlives its own channel close.
        // SAFETY: fn contract.
        let _guard = unsafe { RefPtr::init_ref(this) };
        // SAFETY: alive under the ref just taken.
        let result = if unsafe { (*this).destroy_channel() } {
            SweepResult::Stopped
        } else {
            SweepResult::Idle
        };
        // `GetAddrInfoRequest`'s EDESTRUCTION path does not call
        // `request_completed()`, so the c-ares timeout timer (and its +1 ref on
        // this resolver plus the uws active-handle bump) can still be linked.
        // SAFETY: as above. `_guard` then releases our ref (may free `this`).
        unsafe { (*this).remove_timer() };
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// internal — process-wide DNS cache used by usockets connect path
// ──────────────────────────────────────────────────────────────────────────

pub mod internal {
    use super::*;

    // PORTING.md §Global mutable state: lazy env-var memo — an `OnceLock<u32>`
    // (idempotent init, safe concurrent read).
    static MAX_DNS_TIME_TO_LIVE_SECONDS: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

    fn get_max_dns_time_to_live_seconds() -> u32 {
        *MAX_DNS_TIME_TO_LIVE_SECONDS.get_or_init(|| {
            let value = env_var::BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS.get();
            value.unwrap_or(30) as u32
        })
    }

    // ───────────── Request ─────────────

    // The stack key borrows the caller's host string; `to_owned()` copies
    // before storing on the heap `Request`.
    struct RequestKey<'a> {
        pub(crate) host: Option<&'a ZStr>,
        /// Used for getaddrinfo() to avoid glibc UDP port 0 bug, but NOT included in hash
        pub(crate) port: u16,
        /// Hash of hostname only - DNS results are port-agnostic
        pub(crate) hash: u64,
    }

    /// Heap-stored key on `Request` — owns its host buffer.
    pub struct RequestKeyOwned {
        pub(crate) host: Option<bun::ZBox>,
        pub(crate) port: u16,
        pub(crate) hash: u64,
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
        pub(crate) fn init(name: Option<&'a ZStr>, port: u16) -> Self {
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

        pub(crate) fn to_owned(&self) -> RequestKeyOwned {
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
        pub(crate) info: Option<NonNull<ResultEntry>>, // thin ptr; head of intrusive `ai_next` chain
        pub(crate) err: c_int,
    }
    // Ownership of the ResultEntry buffer is `Request.result_buf` — this struct is
    // a borrowed C-ABI view (`info` points at `result_buf[0]`). Do NOT free via
    // this field.

    #[cfg(target_os = "macos")]
    pub struct MacAsyncDNS {
        pub(crate) query: dns_sd::QueryState,
    }

    #[cfg(target_os = "macos")]
    impl Default for MacAsyncDNS {
        fn default() -> Self {
            Self {
                query: dns_sd::QueryState::new(0),
            }
        }
    }

    pub struct Request {
        pub(crate) key: RequestKeyOwned,
        pub(crate) result: Option<RequestResult>,
        /// Owns the `[ResultEntry; N]` packed by `process_results`; `result.info`
        /// borrows its first element. Freed by `Drop` in `Request::deinit`.
        pub(crate) result_buf: Option<Box<[ResultEntry]>>,

        pub(crate) notify: Vec<DNSRequestOwner>,

        /// number of sockets that have a reference to result or are waiting for the result
        /// while this is non-zero, this entry cannot be freed
        pub(crate) refcount: u32,

        /// Seconds since the epoch when this request was created.
        /// Not a precise timestamp.
        pub(crate) created_at: u32,

        pub(crate) valid: bool,

        #[cfg(target_os = "macos")]
        pub(crate) dns_sd: MacAsyncDNS,
    }

    impl Request {
        pub(crate) fn new(key: RequestKeyOwned, refcount: u32, created_at: u32) -> *mut Self {
            bun_core::heap::into_raw(Box::new(Self {
                key,
                result: None,
                result_buf: None,
                notify: Vec::new(),
                refcount,
                created_at,
                valid: true,
                #[cfg(target_os = "macos")]
                dns_sd: MacAsyncDNS::default(),
            }))
        }

        pub(crate) fn is_expired(&mut self, timestamp_to_store: &mut u32) -> bool {
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
        pub(crate) fn deinit(this: *mut Self) {
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
    struct GlobalCache {
        pub cache: [*mut Request; MAX_ENTRIES],
        pub len: usize,
    }

    // SAFETY: every `*mut Request` stored here is a heap allocation transferred between
    // threads only while `GLOBAL_CACHE` is locked; no thread-affine data hangs off it.
    unsafe impl Send for GlobalCache {}

    impl GlobalCache {
        const fn new() -> Self {
            Self {
                cache: [ptr::null_mut(); MAX_ENTRIES],
                len: 0,
            }
        }

        fn get(
            &mut self,
            key: &RequestKey<'_>,
            timestamp_to_store: &mut u32,
        ) -> Option<*mut Request> {
            let mut len = self.len;
            let mut i: usize = 0;
            while i < len {
                let entry = self.cache[i];
                // SAFETY: entries 0..len are valid heap Requests
                unsafe {
                    if (*entry).key.matches(key) && (*entry).valid {
                        if (*entry).is_expired(timestamp_to_store) {
                            bun_output::scoped_log!(dns, "get: expired entry");
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
        fn get_cache_timestamp() -> u32 {
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
    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
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

    /// Chrome's `IsLocalHostname` (RFC 6761 §6.3): `localhost` or `*.localhost`, ASCII case-insensitive, one trailing dot allowed.
    fn is_localhost_name(host: &[u8]) -> bool {
        const DOT_LOCALHOST: &[u8] = b".localhost";
        let host = host.strip_suffix(b".").unwrap_or(host);
        strings::eql_case_insensitive_ascii(host, b"localhost", true)
            || (host.len() >= DOT_LOCALHOST.len()
                && strings::eql_case_insensitive_ascii(
                    &host[host.len() - DOT_LOCALHOST.len()..],
                    DOT_LOCALHOST,
                    true,
                ))
    }

    /// Chrome's `ServeLocalhost`: a localhost name is `[::1, 127.0.0.1]` without asking the resolver, narrowed like every other lookup by the family feature flags.
    fn localhost_results(port: u16) -> Box<[ResultEntry]> {
        #[cfg(not(windows))]
        let family = get_hints().ai_family;
        #[cfg(windows)]
        let family = netc::AF_UNSPEC;
        let mut addrs: Vec<SockaddrStorage> = [
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
        ]
        .into_iter()
        .filter(|ip| family == netc::AF_UNSPEC || ip.is_ipv6() == (family == netc::AF_INET6))
        .map(|ip| bun_dns::Address::from_ip(ip, port).into_storage())
        .collect();
        let mut chain = addrinfo_chain(&mut addrs);
        process_results(chain.as_mut_ptr())
    }

    /// Chrome's `IsAllLocalhostOfOneFamily`: every address is loopback and only one family is present, the shape glibc's AI_ADDRCONFIG produces for a hosts-file loopback name (crbug 42058 / 49024).
    fn is_all_loopback_of_one_family(mut info: *const AddrInfo) -> bool {
        let (mut saw_v4, mut saw_v6) = (false, false);
        while !info.is_null() {
            // SAFETY: `info` walks a live addrinfo list whose `ai_addr` matches `ai_family`.
            unsafe {
                let addr = (*info).ai_addr;
                if addr.is_null() {
                    return false;
                }
                match (*info).ai_family {
                    netc::AF_INET => {
                        let octets = (*addr.cast::<netc::sockaddr_in>())
                            .sin_addr
                            .s_addr
                            .to_ne_bytes();
                        if !Ipv4Addr::from(octets).is_loopback() {
                            return false;
                        }
                        saw_v4 = true;
                    }
                    netc::AF_INET6 => {
                        let octets = (*addr.cast::<netc::sockaddr_in6>()).sin6_addr.s6_addr;
                        if !Ipv6Addr::from(octets).is_loopback() {
                            return false;
                        }
                        saw_v6 = true;
                    }
                    _ => return false,
                }
                info = (*info).ai_next;
            }
        }
        saw_v4 != saw_v6
    }

    // `Request` is passed opaquely to usockets and round-tripped back into
    // Rust; the C side never dereferences fields, so layout is irrelevant.
    #[allow(improper_ctypes)]
    unsafe extern "C" {
        fn us_internal_dns_callback(socket: *mut ConnectingSocket, req: *mut Request);
        fn us_internal_dns_callback_threadsafe(socket: *mut ConnectingSocket, req: *mut Request);
    }

    pub enum DNSRequestOwner {
        Socket(*mut ConnectingSocket),           // FFI
        Prefetch(*mut Loop),                     // FFI
        Quic(*mut bun_http::H3::PendingConnect), // BORROW_PARAM
    }

    impl DNSRequestOwner {
        /// # Safety
        /// `req` must be a live cache `Request` with a populated `result`; the
        /// callee may take ownership and free it.
        // Forwards `req` to C++ without dereferencing; not_unsafe_ptr_arg_deref
        // is a false positive on opaque-token forwarding.
        #[allow(clippy::not_unsafe_ptr_arg_deref)]
        pub(crate) fn notify_threadsafe(&self, req: *mut Request) {
            match self {
                // SAFETY: `socket` is the live usockets handle stored when the request was registered.
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback_threadsafe(*socket, req)
                },
                DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
                // SAFETY: `pc` is the live PendingConnect borrowed for the lifetime of the request.
                DNSRequestOwner::Quic(pc) => unsafe {
                    bun_http::H3::PendingConnect::on_dns_resolved_threadsafe(*pc)
                },
            }
        }

        /// # Safety
        /// `req` must be a live cache `Request` with a populated `result`; the
        /// callee may take ownership and free it.
        // Forwards `req` to C++ without dereferencing; not_unsafe_ptr_arg_deref
        // is a false positive on opaque-token forwarding.
        #[allow(clippy::not_unsafe_ptr_arg_deref)]
        pub(crate) fn notify(&self, req: *mut Request) {
            match self {
                DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
                // SAFETY: `socket` is the live usockets handle stored when the request was registered.
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback(*socket, req)
                },
                // SAFETY: `pc` is the live PendingConnect borrowed for the lifetime of the request.
                DNSRequestOwner::Quic(pc) => unsafe {
                    bun_http::H3::PendingConnect::on_dns_resolved(*pc)
                },
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
    fn register_quic(request: *mut Request, pc: *mut bun_http::H3::PendingConnect) {
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
        pub(crate) info: AddrInfo,
        pub(crate) addr: SockaddrStorage,
    }

    // Pack getaddrinfo results into one allocation with address families
    // interleaved (RFC 8305 §4) so an unroutable family can never fill all
    // CONCURRENT_CONNECTIONS parallel connect attempts. See #4938 / #33278.
    fn process_results(info: *mut AddrInfo) -> Box<[ResultEntry]> {
        let mut count: usize = 0;
        let mut n_first: usize = 0;
        let first_family = if info.is_null() {
            netc::AF_UNSPEC
        } else {
            // SAFETY: info is a live addrinfo node; freed by caller after we return.
            unsafe { (*info).ai_family }
        };
        let mut info_: *mut AddrInfo = info;
        while !info_.is_null() {
            // SAFETY: info_ walks the libc-allocated addrinfo list; freed by caller after we return.
            unsafe {
                count += 1;
                if (*info_).ai_family == first_family {
                    n_first += 1;
                }
                info_ = (*info_).ai_next;
            }
        }
        let n_other = count - n_first;

        let mut results: Box<[MaybeUninit<ResultEntry>]> = Box::new_uninit_slice(count);

        let mut i_first: usize = 0;
        let mut i_other: usize = 0;
        info_ = info;
        while !info_.is_null() {
            // SAFETY: info_ is a valid addrinfo node (counted above); the slot
            // mapping is a bijection over 0..count so every MaybeUninit slot
            // is fully initialized exactly once.
            unsafe {
                let i = if (*info_).ai_family == first_family {
                    let i = i_first;
                    i_first += 1;
                    if i < n_other { 2 * i } else { n_other + i }
                } else {
                    let j = i_other;
                    i_other += 1;
                    if j < n_first { 2 * j + 1 } else { n_first + j }
                };
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
                info_ = (*info_).ai_next;
            }
        }

        // SAFETY: every slot 0..count was written above
        let mut results: Box<[ResultEntry]> = unsafe { results.assume_init() };

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

    /// addrinfo nodes for [`process_results`]; they point into `addrs`, which must outlive them.
    fn addrinfo_chain(addrs: &mut [SockaddrStorage]) -> Box<[AddrInfo]> {
        let mut nodes: Box<[AddrInfo]> = addrs
            .iter_mut()
            .map(|addr| {
                let mut node: AddrInfo = bun_core::ffi::zeroed();
                node.ai_family = addr.ss_family as c_int;
                node.ai_socktype = netc::SOCK_STREAM;
                node.ai_addrlen = if node.ai_family == netc::AF_INET6 {
                    size_of::<netc::sockaddr_in6>() as _
                } else {
                    size_of::<netc::sockaddr_in>() as _
                };
                node.ai_addr = ptr::from_mut(addr).cast::<Sockaddr>();
                node
            })
            .collect();
        let base = nodes.as_mut_ptr();
        for i in 1..nodes.len() {
            // SAFETY: `i - 1` and `i` are in bounds of the boxed slice, which is not moved afterwards.
            unsafe { (*base.add(i - 1)).ai_next = base.add(i) };
        }
        nodes
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
        after_result_entries(req, results, err);
    }

    fn after_result_entries(req: *mut Request, results: Option<Box<[ResultEntry]>>, err: c_int) {
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
            libuv::uv__winsock_ensure();
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

            // Chrome's retries: AI_ADDRCONFIG left nothing, or only one family's loopback.
            if (hints.ai_flags & netc::AI_ADDRCONFIG) != 0
                && (err == netc::EAI_NONAME
                    || (err == 0 && is_all_loopback_of_one_family(addrinfo)))
            {
                hints.ai_flags &= !netc::AI_ADDRCONFIG;
                let mut unfiltered: *mut AddrInfo = ptr::null_mut();
                let retry_err =
                    libc::getaddrinfo(host_ptr, service, &raw const hints, &raw mut unfiltered);
                if retry_err == 0 || err != 0 {
                    if !addrinfo.is_null() {
                        bun_dns::freeaddrinfo(addrinfo);
                    }
                    addrinfo = unfiltered;
                    err = retry_err;
                }
            }
            after_result(req, addrinfo, err);
        }
    }

    #[cfg(target_os = "macos")]
    fn lookup_dns_sd(req: *mut Request, loop_: jsc::EventLoopHandle) -> bool {
        // SAFETY: `req` is the live heap-allocated request owned by the caller.
        let Some(host) = (unsafe { (*req).key.host.as_ref() }) else {
            // Null host: fall through to getaddrinfo(NULL, service) on the work pool.
            return false;
        };
        let Some(shared) = dns_sd::SharedConnection::get(
            crate::api::bun::process::event_loop_handle_to_ctx(loop_),
        ) else {
            return false;
        };

        let protocol = dns_sd::protocol_for_hints(&get_hints());
        // SAFETY: `req` is the live heap-allocated request owned by the caller.
        unsafe {
            (*req).dns_sd = MacAsyncDNS {
                query: dns_sd::QueryState::new(protocol),
            };
        }
        let Some(_) = shared.start(
            dns_sd::Inflight::Internal(req),
            protocol,
            host,
            dns_sd_reply,
            req.cast::<c_void>(),
        ) else {
            return false;
        };

        true
    }

    #[cfg(target_os = "macos")]
    unsafe extern "C" fn dns_sd_reply(
        _sd_ref: dns_sd::DNSServiceRef,
        flags: u32,
        _interface_index: u32,
        error_code: i32,
        _hostname: *const c_char,
        address: *const Sockaddr,
        ttl: u32,
        context: *mut c_void,
    ) {
        dns_sd::SharedConnection::note_reply(context);
        let req: *mut Request = context.cast();
        // SAFETY: `context` is the registered `req` (event-loop thread); `address` is valid per dns_sd.h.
        unsafe {
            (*req)
                .dns_sd
                .query
                .record_reply(flags, error_code, address, ttl)
        };
    }

    /// Complete an internal request: build an addrinfo chain and reuse `process_results` (happy-eyeballs order).
    #[cfg(target_os = "macos")]
    pub(super) fn dns_sd_complete(req: *mut Request) {
        // SAFETY: `req` is live and exclusively owned on the event-loop thread.
        let query = unsafe { &mut (*req).dns_sd.query };
        let results = query.take_results();
        // SAFETY: `req` is live; `key.port` is set at construction and read-only.
        let port = unsafe { (*req).key.port };

        if results.is_empty() {
            after_result_entries(req, None, dns_sd::EMPTY_STATUS);
            return;
        }

        let mut addrs: Box<[SockaddrStorage]> = results
            .iter()
            .map(|r| {
                let mut storage = r.address.into_storage();
                match storage.ss_family as c_int {
                    // SAFETY: ss_family == AF_INET ⇒ storage holds a sockaddr_in.
                    netc::AF_INET => unsafe {
                        (*(&raw mut storage).cast::<netc::sockaddr_in>()).sin_port = port.to_be()
                    },
                    // SAFETY: ss_family == AF_INET6 ⇒ storage holds a sockaddr_in6.
                    netc::AF_INET6 => unsafe {
                        (*(&raw mut storage).cast::<netc::sockaddr_in6>()).sin6_port = port.to_be()
                    },
                    _ => {}
                }
                storage
            })
            .collect();
        let mut chain = addrinfo_chain(&mut addrs);
        let results = process_results(chain.as_mut_ptr());
        after_result_entries(req, Some(results), 0);
    }

    static DNS_CACHE_HITS_COMPLETED: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_HITS_INFLIGHT: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_SIZE: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_MISSES: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_ERRORS: AtomicUsize = AtomicUsize::new(0);
    static GETADDRINFO_CALLS: AtomicUsize = AtomicUsize::new(0);

    #[host_fn]
    pub(crate) fn get_dns_cache_stats(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let object = JSValue::create_empty_object(global_object, 6);
        object.put(
            global_object,
            b"cacheHitsCompleted",
            JSValue::js_number(DNS_CACHE_HITS_COMPLETED.load(Ordering::Relaxed) as f64),
        );
        object.put(
            global_object,
            b"cacheHitsInflight",
            JSValue::js_number(DNS_CACHE_HITS_INFLIGHT.load(Ordering::Relaxed) as f64),
        );
        object.put(
            global_object,
            b"cacheMisses",
            JSValue::js_number(DNS_CACHE_MISSES.load(Ordering::Relaxed) as f64),
        );
        object.put(
            global_object,
            b"size",
            JSValue::js_number(DNS_CACHE_SIZE.load(Ordering::Relaxed) as f64),
        );
        object.put(
            global_object,
            b"errors",
            JSValue::js_number(DNS_CACHE_ERRORS.load(Ordering::Relaxed) as f64),
        );
        object.put(
            global_object,
            b"totalCount",
            JSValue::js_number(GETADDRINFO_CALLS.load(Ordering::Relaxed) as f64),
        );
        Ok(object)
    }

    /// The `addresses: string[]` argument of the testing hooks below, as sockaddrs.
    fn addresses_for_testing(
        global: &JSGlobalObject,
        addresses: JSValue,
    ) -> JsResult<Vec<SockaddrStorage>> {
        if !addresses.is_array() {
            return Err(
                global.throw_invalid_arguments(format_args!("expected addresses: string[]"))
            );
        }
        let len = addresses.get_length(global)? as usize;
        if len > 64 {
            return Err(global
                .throw_invalid_arguments(format_args!("addresses must have at most 64 entries")));
        }
        (0..len)
            .map(|i| {
                let address = addresses.get_index(global, i as u32)?.to_utf8(global)?;
                match bun_core::ip_address::to_ip_address(address.slice()) {
                    Some(ip) => Ok(bun_dns::Address::from_ip(ip, 0).into_storage()),
                    None => Err(global.throw_invalid_arguments(format_args!(
                        "addresses[{i}] is not an IPv4 or IPv6 literal"
                    ))),
                }
            })
            .collect()
    }

    /// `bun:internal-for-testing`: [`is_localhost_name`] for one hostname.
    pub(crate) fn is_localhost_name_for_testing(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let hostname = frame.argument(0);
        if !hostname.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("expected (hostname: string)")));
        }
        let hostname = hostname.to_utf8(global)?;
        Ok(JSValue::js_boolean(is_localhost_name(hostname.slice())))
    }

    /// `bun:internal-for-testing`: [`is_all_loopback_of_one_family`] over `addresses` laid out as a getaddrinfo() answer.
    pub(crate) fn is_all_loopback_of_one_family_for_testing(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut addrs = addresses_for_testing(global, frame.argument(0))?;
        let chain = addrinfo_chain(&mut addrs);
        let head = chain.first().map_or(ptr::null(), ptr::from_ref);
        Ok(JSValue::js_boolean(is_all_loopback_of_one_family(head)))
    }

    /// `bun:internal-for-testing`: seed the connect-path DNS cache for `hostname`
    /// by running `addresses` through the real [`process_results`] interleave and
    /// storing the result, so a real `fetch()` / `Bun.connect()` consumes it.
    pub(crate) fn seed_cache_for_testing(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = frame.arguments();
        if args.len() < 2 || !args[0].is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "expected (hostname: string, addresses: string[])"
            )));
        }
        let hostname_slice = args[0].to_utf8(global)?;
        let hostname_z = bun::ZBox::from_bytes(hostname_slice.slice());
        let mut addrs = addresses_for_testing(global, args[1])?;
        if addrs.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!("addresses must not be empty")));
        }
        let mut chain = addrinfo_chain(&mut addrs);
        let results = process_results(chain.as_mut_ptr());

        let out = JSValue::create_empty_array(global, results.len())?;
        for (i, entry) in (0u32..).zip(results.iter()) {
            let fam: i32 = if entry.info.ai_family == netc::AF_INET6 {
                6
            } else {
                4
            };
            out.put_index(global, i, JSValue::js_number_from_int32(fam))?;
        }

        let key = RequestKey::init(Some(hostname_z.as_zstr()), 0);
        let req = Request::new(key.to_owned(), 0, GlobalCache::get_cache_timestamp());
        // SAFETY: `req` is freshly heap-allocated and exclusively owned until
        // `try_push` transfers it to the lock-guarded cache.
        unsafe {
            (*req).result_buf = Some(results);
            let info = (*req)
                .result_buf
                .as_mut()
                .and_then(|b| NonNull::new(b.as_mut_ptr()));
            (*req).result = Some(RequestResult { info, err: 0 });
        }
        let mut guard = global_cache().lock();
        if !guard.try_push(req) {
            drop(guard);
            Request::deinit(req);
            return Err(global.throw_invalid_arguments(format_args!("DNS cache is full")));
        }
        DNS_CACHE_SIZE.store(guard.len, Ordering::Relaxed);
        drop(guard);
        Ok(out)
    }

    pub(crate) fn getaddrinfo(
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
                    bun_output::scoped_log!(
                        dns,
                        "getaddrinfo({}) = cache hit",
                        bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
                    );
                    DNS_CACHE_HITS_COMPLETED.fetch_add(1, Ordering::Relaxed);
                } else {
                    bun_output::scoped_log!(
                        dns,
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

        if host.is_some_and(|h| !bun_dns::is_valid_hostname(h.as_bytes())) {
            bun_output::scoped_log!(
                dns,
                "getaddrinfo({}) = cache miss (not a hostname)",
                bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
            );
            after_result_entries(req, None, netc::EAI_NONAME);
            if let Some(is_cache_hit) = is_cache_hit {
                *is_cache_hit = true;
            }
            return Some(req);
        }

        if host.is_some_and(|h| is_localhost_name(h.as_bytes())) {
            bun_output::scoped_log!(
                dns,
                "getaddrinfo({}) = cache miss (localhost)",
                bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
            );
            after_result_entries(req, Some(localhost_results(port)), 0);
            if let Some(is_cache_hit) = is_cache_hit {
                *is_cache_hit = true;
            }
            return Some(req);
        }

        #[cfg(target_os = "macos")]
        {
            use bun_uws::InternalLoopDataExt as _;
            if !env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO
                .get()
                .unwrap_or(false)
            {
                // SAFETY: `loop_` is the live uSockets loop; its parent tag/ptr
                // was set by `EventLoopHandle::set_as_parent_of` at startup.
                let handle = unsafe {
                    let (tag, ptr) = (*loop_).internal_loop_data.get_parent();
                    jsc::EventLoopHandle::from_tag_ptr(tag, ptr)
                };
                let res = lookup_dns_sd(req, handle);
                if res {
                    bun_output::scoped_log!(
                        dns,
                        "getaddrinfo({}) = cache miss (dns_sd)",
                        bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
                    );
                    return Some(req);
                }
                // if dns_sd was unavailable, fall back to the work pool
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = loop_;

        bun_output::scoped_log!(
            dns,
            "getaddrinfo({}) = cache miss (libc)",
            bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
        );
        // schedule the request to be executed on the work pool
        run_on_work_pool(req);
        Some(req)
    }

    /// getaddrinfo() on the work pool; the result reaches every waiter through
    /// the global cache, whichever thread asked. Also how a lookup whose
    /// per-thread mDNSResponder connection went away with its thread is
    /// finished (see `SharedConnection::close_for_terminate`).
    pub(super) fn run_on_work_pool(req: *mut Request) {
        let _ = bun_threading::work_pool::WorkPool::go(SendPtr(req), |r: SendPtr<Request>| {
            work_pool_callback(r.0)
        });
    }

    #[host_fn]
    pub(crate) fn prefetch_from_js(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();

        if arguments.len() < 1 {
            return Err(global_this.throw_not_enough_arguments("prefetch", 1, arguments.len()));
        }

        let hostname_or_url = arguments[0];

        let hostname_slice = if hostname_or_url.is_string() {
            hostname_or_url.to_utf8(global_this)?
        } else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("hostname must be a string"))
            );
        };

        let hostname_z = bun::ZBox::from_bytes(hostname_slice.slice());

        let port: u16 = if arguments.len() > 1 && !arguments[1].is_undefined_or_null() {
            global_this.validate_integer_range::<u16>(
                arguments[1],
                443,
                jsc::IntegerRange {
                    field_name: b"port",
                    always_allow_zero: true,
                    ..Default::default()
                },
            )?
        } else {
            443
        };

        // SAFETY: `VirtualMachine::get()` returns the live thread-local VM (panics if absent).
        prefetch(
            VirtualMachine::get().as_mut().uws_loop(),
            Some(hostname_z.as_zstr()),
            port,
        );
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn prefetch(loop_: *mut Loop, hostname: Option<&ZStr>, port: u16) {
        let _ = getaddrinfo(loop_, hostname, port, None);
    }

    /// `bun_dns::__bun_dns_prefetch` body — declared `extern "Rust"` in the
    /// lower-tier `bun_dns` crate so `bun_install` can prefetch registry
    /// hostnames without a crate cycle. Link-time resolved.
    ///
    /// # Safety
    /// `hostname` (if non-null) must point to a NUL-terminated `[u8; len]` live
    /// for the duration of the call.
    // `hostname` is null-guarded before the deref; the non-null contract is
    // documented above and on the `bun_dns` extern decl.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[unsafe(no_mangle)]
    fn __bun_dns_prefetch(loop_: *mut c_void, hostname: *const u8, len: usize, port: u16) {
        let host = if hostname.is_null() || len == 0 {
            None
        } else {
            // SAFETY: caller passes a NUL-terminated `[u8; len]` live for the call.
            Some(unsafe { ZStr::from_raw(hostname, len) })
        };
        prefetch(loop_.cast::<Loop>(), host, port);
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
                // Also wakes the loop: this can run inside the dns_ready_head drain itself.
                query.notify_threadsafe(request);
                return;
            }
            (*request).notify.push(DNSRequestOwner::Socket(socket));
        }
    }

    extern "C" fn us_getaddrinfo_cancel(
        request: *mut Request,
        socket: *mut ConnectingSocket,
    ) -> c_int {
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

    extern "C" fn freeaddrinfo(req: *mut Request, err: c_int) {
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
                bun_output::scoped_log!(dns, "cache --");
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
    extern "C" fn Bun__addrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
        us_getaddrinfo_set(request, socket)
    }
    #[unsafe(no_mangle)]
    extern "C" fn Bun__addrinfo_cancel(
        request: *mut Request,
        socket: *mut ConnectingSocket,
    ) -> c_int {
        us_getaddrinfo_cancel(request, socket)
    }
    #[unsafe(no_mangle)]
    extern "C" fn Bun__addrinfo_get(
        loop_: *mut Loop,
        host: *const c_char,
        port: u16,
        socket: *mut *mut c_void,
    ) -> c_int {
        us_getaddrinfo(loop_, host, port, socket)
    }
    #[unsafe(no_mangle)]
    extern "C" fn Bun__addrinfo_freeRequest(req: *mut Request, err: c_int) {
        freeaddrinfo(req, err)
    }
    #[unsafe(no_mangle)]
    extern "C" fn Bun__addrinfo_getRequestResult(req: *mut Request) -> *mut RequestResult {
        get_request_result(req)
    }
    /// QUIC analogue of `Bun__addrinfo_set` — link-time export so `bun_http`
    /// (lower-tier crate) can register without a `bun_runtime` dep cycle.
    /// Called via `bun_dns::internal::register_quic`.
    ///
    /// # Safety
    /// See [`register_quic`].
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__addrinfo_registerQuic(
        request: *mut Request,
        pc: *mut bun_http::H3::PendingConnect,
    ) {
        register_quic(request, pc)
    }
}

pub use internal::Request as InternalDNSRequest;

// ──────────────────────────────────────────────────────────────────────────
// Resolver — JSC-exposed `dns.Resolver` (m_ctx payload of JSDNSResolver)
// ──────────────────────────────────────────────────────────────────────────

/// Field selector for the `pending_*` cache fields on `Resolver` — Rust
/// cannot index struct fields by name string.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PendingCacheField {
    PendingHostCacheCares,
    PendingHostCacheNative,
    PendingSrvCacheCares,
    PendingSoaCacheCares,
    PendingTxtCacheCares,
    PendingNaptrCacheCares,
    PendingMxCacheCares,
    PendingCaaCacheCares,
    PendingNsCacheCares,
    PendingPtrCacheCares,
    PendingCnameCacheCares,
    PendingACacheCares,
    PendingAaaaCacheCares,
    PendingAnyCacheCares,
    PendingAddrCacheCares,
    PendingNameinfoCacheCares,
}

// ──────────────────────────────────────────────────────────────────────────
// CAresRecordType impls — each (struct, tag) pair is modeled as a
// trait impl. ns/ptr/cname share `struct_hostent` and a/aaaa share
// `hostent_with_ttls`, so those get `#[repr(transparent)]` newtype wrappers to
// keep the per-record monomorphizations (and pending caches) distinct.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! impl_cares_record_type {
    (
        $ty:ty, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident,
        $to_js:path
    ) => {
        impl CAresRecordType for $ty {
            const TYPE_NAME: &'static str = $tag;
            const SYSCALL: &'static str = $syscall;
            const CACHE_FIELD: PendingCacheField = PendingCacheField::$field;
            const NS_TYPE: c_ares::NSType = c_ares::NSType::$ns_type;
            const RAW_CALLBACK: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int) =
                c_ares::ares_reply_callback::<$ty, ResolveInfoRequest<$ty>>;
            fn to_js_response(
                &mut self,
                global: &JSGlobalObject,
                type_name: &'static str,
            ) -> JsResult<JSValue> {
                $to_js(self, global, type_name.as_bytes())
            }
            unsafe fn destroy(this: *mut Self) {
                // SAFETY: caller contract — `this` is the c-ares-allocated reply pointer
                // handed to the completion callback; not aliased. All six reply structs
                // are freed identically via `ares_free_data`.
                unsafe { c_ares::ares_free_data(this.cast::<core::ffi::c_void>()) }
            }
        }
        // Generic reply handler — forwards to `on_cares_complete`.
        impl c_ares::ReplyHandler<$ty> for ResolveInfoRequest<$ty> {
            fn on_reply(
                &mut self,
                status: Option<c_ares::Error>,
                timeouts: i32,
                results: *mut $ty,
            ) {
                // SAFETY: `ares_reply_callback` hands over the `ares_parse_*_reply`
                // allocation, which `destroy` frees.
                let result = NonNull::new(results).map(|reply| unsafe { OwnedReply::adopt(reply) });
                Self::on_cares_complete(core::ptr::from_mut(self), status, timeouts, result);
            }
        }
    };
}

impl_cares_record_type!(
    c_ares::struct_ares_srv_reply,
    "srv",
    "querySrv",
    PendingSrvCacheCares,
    ns_t_srv,
    super::cares_jsc::srv_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_soa_reply,
    "soa",
    "querySoa",
    PendingSoaCacheCares,
    ns_t_soa,
    super::cares_jsc::soa_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_txt_reply,
    "txt",
    "queryTxt",
    PendingTxtCacheCares,
    ns_t_txt,
    super::cares_jsc::txt_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_naptr_reply,
    "naptr",
    "queryNaptr",
    PendingNaptrCacheCares,
    ns_t_naptr,
    super::cares_jsc::naptr_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_mx_reply,
    "mx",
    "queryMx",
    PendingMxCacheCares,
    ns_t_mx,
    super::cares_jsc::mx_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_caa_reply,
    "caa",
    "queryCaa",
    PendingCaaCacheCares,
    ns_t_caa,
    super::cares_jsc::caa_reply_to_js_response
);

// `any` — handler receives `Option<Box<struct_any_reply>>` (parser allocates the
// aggregate); release it via `heap::into_raw_nn` so the rest of the pipeline sees a
// uniform `OwnedReply<T>` and `CAresRecordType::destroy` reclaims it with `heap::take`.
impl CAresRecordType for c_ares::struct_any_reply {
    const TYPE_NAME: &'static str = "any";
    const SYSCALL: &'static str = "queryAny";
    const CACHE_FIELD: PendingCacheField = PendingCacheField::PendingAnyCacheCares;
    const NS_TYPE: c_ares::NSType = c_ares::NSType::ns_t_any;
    const RAW_CALLBACK: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int) =
        c_ares::struct_any_reply::callback_wrapper::<ResolveInfoRequest<c_ares::struct_any_reply>>;
    fn to_js_response(
        &mut self,
        global: &JSGlobalObject,
        type_name: &'static str,
    ) -> JsResult<JSValue> {
        super::cares_jsc::any_reply_to_js_response(self, global, type_name.as_bytes())
    }
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` was released by `heap::into_raw_nn` in `on_any` below; Drop
        // frees inner replies.
        unsafe { drop(bun_core::heap::take(this)) }
    }
}
impl c_ares::AnyHandler for ResolveInfoRequest<c_ares::struct_any_reply> {
    fn on_any(
        &mut self,
        status: Option<c_ares::Error>,
        timeouts: i32,
        results: Option<Box<c_ares::struct_any_reply>>,
    ) {
        // SAFETY: `destroy` re-boxes the allocation released here.
        let result =
            results.map(|reply| unsafe { OwnedReply::adopt(bun_core::heap::into_raw_nn(reply)) });
        Self::on_cares_complete(std::ptr::from_mut::<Self>(self), status, timeouts, result);
    }
}

/// Transparent newtype over `struct_hostent` carrying the per-record-type `type_name` tag.
macro_rules! hostent_newtype {
    ($name:ident, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident, $wrapper:ident) => {
        #[repr(transparent)]
        pub(crate) struct $name(pub c_ares::struct_hostent);
        impl CAresRecordType for $name {
            const TYPE_NAME: &'static str = $tag;
            const SYSCALL: &'static str = $syscall;
            const CACHE_FIELD: PendingCacheField = PendingCacheField::$field;
            const NS_TYPE: c_ares::NSType = c_ares::NSType::$ns_type;
            const RAW_CALLBACK: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int) =
                c_ares::struct_hostent::$wrapper::<ResolveInfoRequest<$name>>;
            fn to_js_response(
                &mut self,
                global: &JSGlobalObject,
                type_name: &'static str,
            ) -> JsResult<JSValue> {
                super::cares_jsc::hostent_to_js_response(&mut self.0, global, type_name.as_bytes())
            }
            unsafe fn destroy(this: *mut Self) {
                // SAFETY: `#[repr(transparent)]` — `*mut Self` is `*mut struct_hostent`.
                unsafe { c_ares::struct_hostent::destroy(this.cast::<c_ares::struct_hostent>()) }
            }
        }
        impl c_ares::HostentHandler for ResolveInfoRequest<$name> {
            fn on_hostent(
                &mut self,
                status: Option<c_ares::Error>,
                timeouts: i32,
                results: *mut c_ares::struct_hostent,
            ) {
                let hostent = NonNull::new(results.cast::<$name>());
                // SAFETY: `RAW_CALLBACK` is an `ares_parse_*_reply` wrapper, so this hostent
                // is handed over for `destroy` to free (unlike the one `ares_gethostbyaddr`
                // lends to `GetHostByAddrInfoRequest`); `#[repr(transparent)]` makes the
                // cast sound.
                let result = hostent.map(|reply| unsafe { OwnedReply::adopt(reply) });
                Self::on_cares_complete(core::ptr::from_mut(self), status, timeouts, result);
            }
        }
    };
}

/// Transparent newtype over `hostent_with_ttls` for A/AAAA records.
macro_rules! hostent_ttls_newtype {
    ($name:ident, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident, $parse:ident) => {
        #[repr(transparent)]
        pub(crate) struct $name(pub c_ares::hostent_with_ttls);
        impl CAresRecordType for $name {
            const TYPE_NAME: &'static str = $tag;
            const SYSCALL: &'static str = $syscall;
            const CACHE_FIELD: PendingCacheField = PendingCacheField::$field;
            const NS_TYPE: c_ares::NSType = c_ares::NSType::$ns_type;
            const RAW_CALLBACK: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int) =
                c_ares::hostent_with_ttls::callback_wrapper::<ResolveInfoRequest<$name>>;
            fn to_js_response(
                &mut self,
                global: &JSGlobalObject,
                type_name: &'static str,
            ) -> JsResult<JSValue> {
                super::cares_jsc::hostent_with_ttls_to_js_response(
                    &mut self.0,
                    global,
                    type_name.as_bytes(),
                )
            }
            unsafe fn destroy(this: *mut Self) {
                // SAFETY: `#[repr(transparent)]`; released by `heap::into_raw_nn` in
                // `on_hostent_with_ttls` below. Drop calls `ares_free_hostent`.
                unsafe {
                    drop(bun_core::heap::take(
                        this.cast::<c_ares::hostent_with_ttls>(),
                    ))
                }
            }
        }
        impl c_ares::HostentWithTtlsHandler for ResolveInfoRequest<$name> {
            const PARSE: fn(&[u8]) -> Result<Box<c_ares::hostent_with_ttls>, c_ares::Error> =
                c_ares::hostent_with_ttls::$parse;
            fn on_hostent_with_ttls(
                &mut self,
                status: Option<c_ares::Error>,
                timeouts: i32,
                results: Option<Box<c_ares::hostent_with_ttls>>,
            ) {
                // SAFETY: `destroy` casts back and re-boxes the allocation released here;
                // `#[repr(transparent)]` makes the cast sound.
                let result = results.map(|reply| unsafe {
                    OwnedReply::adopt(bun_core::heap::into_raw_nn(reply).cast::<$name>())
                });
                Self::on_cares_complete(core::ptr::from_mut(self), status, timeouts, result);
            }
        }
    };
}

hostent_newtype!(
    NsHostent,
    "ns",
    "queryNs",
    PendingNsCacheCares,
    ns_t_ns,
    callback_wrapper_ns
);
hostent_newtype!(
    PtrHostent,
    "ptr",
    "queryPtr",
    PendingPtrCacheCares,
    ns_t_ptr,
    callback_wrapper_ptr
);
hostent_newtype!(
    CnameHostent,
    "cname",
    "queryCname",
    PendingCnameCacheCares,
    ns_t_cname,
    callback_wrapper_cname
);
hostent_ttls_newtype!(
    AHostentWithTtls,
    "a",
    "queryA",
    PendingACacheCares,
    ns_t_a,
    parse_a
);
hostent_ttls_newtype!(
    AaaaHostentWithTtls,
    "aaaa",
    "queryAaaa",
    PendingAaaaCacheCares,
    ns_t_aaaa,
    parse_aaaa
);

pub type PendingCache = HiveArray<get_addr_info_request::PendingCacheKey, 32>;
type SrvPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_srv_reply>, 32>;
type SoaPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_soa_reply>, 32>;
type TxtPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_txt_reply>, 32>;
type NaptrPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_naptr_reply>, 32>;
type MxPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_mx_reply>, 32>;
type CaaPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_caa_reply>, 32>;
type NSPendingCache = HiveArray<resolve_info_request::PendingCacheKey<NsHostent>, 32>;
type PtrPendingCache = HiveArray<resolve_info_request::PendingCacheKey<PtrHostent>, 32>;
type CnamePendingCache = HiveArray<resolve_info_request::PendingCacheKey<CnameHostent>, 32>;
type APendingCache = HiveArray<resolve_info_request::PendingCacheKey<AHostentWithTtls>, 32>;
type AAAAPendingCache = HiveArray<resolve_info_request::PendingCacheKey<AaaaHostentWithTtls>, 32>;
type AnyPendingCache =
    HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_any_reply>, 32>;
type AddrPendingCache = HiveArray<get_host_by_addr_info_request::PendingCacheKey, 32>;
type NameInfoPendingCache = HiveArray<get_name_info_request::PendingCacheKey, 32>;

#[cfg(windows)]
type PollType = UvDnsPoll;
#[cfg(not(windows))]
type PollType = FilePoll;

type PollsMap = ArrayHashMap<c_ares::ares_socket_t, *mut PollType>;

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). c-ares
// completion callbacks re-enter this Resolver (e.g. `request_completed`,
// `drain_pending_*`) while a `&self` borrow is live in `on_dns_poll` /
// `check_timeouts`; UnsafeCell-backed fields suppress `noalias` so LLVM cannot
// cache them across re-entrant FFI calls (the proper fix for the
// PROVEN_CACHED ref_count miscompile previously laundered with `black_box`).
#[bun_jsc::JsClass(name = "DNSResolver", no_constructor)]
#[derive(bun_ptr::RefCounted)]
pub struct Resolver {
    pub(crate) ref_count: bun_ptr::RefCount<Resolver>,
    pub(crate) channel: Cell<Option<*mut c_ares::Channel>>, // FFI
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>, // JSC_BORROW (BACKREF — VirtualMachine outlives the resolver; read-only after init)
    pub(crate) polls: JsCell<PollsMap>,
    pub(crate) options: Cell<c_ares::ChannelOptions>,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,

    pub(crate) pending_host_cache_cares: JsCell<PendingCache>,
    pub(crate) pending_host_cache_native: JsCell<PendingCache>,
    pub(crate) pending_srv_cache_cares: JsCell<SrvPendingCache>,
    pub(crate) pending_soa_cache_cares: JsCell<SoaPendingCache>,
    pub(crate) pending_txt_cache_cares: JsCell<TxtPendingCache>,
    pub(crate) pending_naptr_cache_cares: JsCell<NaptrPendingCache>,
    pub(crate) pending_mx_cache_cares: JsCell<MxPendingCache>,
    pub(crate) pending_caa_cache_cares: JsCell<CaaPendingCache>,
    pub(crate) pending_ns_cache_cares: JsCell<NSPendingCache>,
    pub(crate) pending_ptr_cache_cares: JsCell<PtrPendingCache>,
    pub(crate) pending_cname_cache_cares: JsCell<CnamePendingCache>,
    pub(crate) pending_a_cache_cares: JsCell<APendingCache>,
    pub(crate) pending_aaaa_cache_cares: JsCell<AAAAPendingCache>,
    pub(crate) pending_any_cache_cares: JsCell<AnyPendingCache>,
    pub(crate) pending_addr_cache_cares: JsCell<AddrPendingCache>,
    pub(crate) pending_nameinfo_cache_cares: JsCell<NameInfoPendingCache>,
}

bun_event_loop::impl_timer_owner!(Resolver; from_timer_ptr => event_loop_timer);

impl Drop for Resolver {
    fn drop(&mut self) {
        self.destroy_channel();
    }
}

#[cfg(windows)]
pub(crate) struct UvDnsPoll {
    // BACKREF — stored mut because the poll callback hands it to
    // `Resolver::deref`, which may write/free `*this`.
    pub parent: *mut Resolver,
    pub socket: c_ares::ares_socket_t,
    pub poll: libuv::uv_poll_t,
}

#[cfg(windows)]
impl UvDnsPoll {
    fn new(parent: *mut Resolver, socket: c_ares::ares_socket_t) -> *mut Self {
        bun_core::heap::into_raw(Box::new(Self {
            parent,
            socket,
            poll: bun_core::ffi::zeroed(),
        }))
    }

    fn destroy(this: *mut Self) {
        unsafe { drop(bun_core::heap::take(this)) };
    }

    fn from_poll(poll: *mut libuv::uv_poll_t) -> *mut Self {
        // SAFETY: poll points to UvDnsPoll.poll
        unsafe { bun_core::from_field_ptr!(UvDnsPoll, poll, poll) }
    }
}

#[derive(Clone, Copy)]
pub enum CacheHit {
    Inflight(*mut get_addr_info_request::PendingCacheKey), // BORROW_FIELD into resolver buffer
    New(*mut get_addr_info_request::PendingCacheKey),      // BORROW_FIELD into resolver buffer
    Disabled,
}

pub(crate) enum LookupCacheHit<R: HasPendingCacheKey> {
    // The request type is threaded via `R`; `PendingCacheKey` resolves
    // through `HasPendingCacheKey`.
    Inflight(*mut R::PendingCacheKey), // BORROW_FIELD
    New(*mut R::PendingCacheKey),      // BORROW_FIELD
    Disabled,
}

impl<R: HasPendingCacheKey> Clone for LookupCacheHit<R> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<R: HasPendingCacheKey> Copy for LookupCacheHit<R> {}

/// Associates a request type with its `PendingCacheKey` and the matching `HiveArray`
/// field on `Resolver`.
pub(crate) trait HasPendingCacheKey {
    type PendingCacheKey;

    /// Return the per-request-type pending HiveArray field on `Resolver`.
    /// `field` is the runtime tag selecting which field (some request types are reachable
    /// via more than one field, e.g. `pending_host_cache_{cares,native}`).
    ///
    /// R-2: takes `&Resolver` and projects `&mut` via the field's `JsCell`.
    /// Callers hold the borrow only for a short, non-reentrant window
    /// (slot read/claim/unset).
    #[allow(clippy::mut_from_ref)]
    fn pending_cache(
        resolver: &Resolver,
        field: PendingCacheField,
    ) -> &mut HiveArray<Self::PendingCacheKey, 32>;

    /// `key.hash` — all `PendingCacheKey` shapes carry `{ hash: u64, len: u16, lookup: *mut _ }`.
    fn key_hash(key: &Self::PendingCacheKey) -> u64;
    /// `key.len`
    fn key_len(key: &Self::PendingCacheKey) -> u16;
    fn key_name(key: &Self::PendingCacheKey) -> &[u8];
    /// Construct a fully-initialized `PendingCacheKey { hash, len, lookup: null }`
    /// for `HiveArray::get_init`. `lookup` is filled in later by `*Request::init`
    /// once the request has been heap-allocated; until then it is a defined null
    /// rather than uninit garbage, so the `iter_set` loop in
    /// `get_or_put_into_resolve_pending_cache` can safely materialise
    /// `&mut PendingCacheKey` over the slot.
    fn key_new(key: &Self::PendingCacheKey) -> Self::PendingCacheKey;
}

impl<T: CAresRecordType> HasPendingCacheKey for ResolveInfoRequest<T> {
    type PendingCacheKey = resolve_info_request::PendingCacheKey<T>;

    #[inline]
    fn pending_cache(
        resolver: &Resolver,
        field: PendingCacheField,
    ) -> &mut HiveArray<Self::PendingCacheKey, 32> {
        resolver.pending_cache_for::<T>(field)
    }
    #[inline]
    fn key_hash(key: &Self::PendingCacheKey) -> u64 {
        key.hash
    }
    #[inline]
    fn key_len(key: &Self::PendingCacheKey) -> u16 {
        key.len
    }
    #[inline]
    fn key_name(key: &Self::PendingCacheKey) -> &[u8] {
        &key.name
    }
    #[inline]
    fn key_new(key: &Self::PendingCacheKey) -> Self::PendingCacheKey {
        resolve_info_request::PendingCacheKey {
            hash: key.hash,
            len: key.len,
            name: key.name.clone(),
            lookup: ptr::null_mut(),
        }
    }
}

impl HasPendingCacheKey for GetHostByAddrInfoRequest {
    type PendingCacheKey = get_host_by_addr_info_request::PendingCacheKey;

    #[inline]
    fn pending_cache(
        resolver: &Resolver,
        _field: PendingCacheField,
    ) -> &mut HiveArray<Self::PendingCacheKey, 32> {
        // SAFETY: see `HasPendingCacheKey::pending_cache` doc — short,
        // non-reentrant borrow on the single JS thread.
        unsafe { resolver.pending_addr_cache_cares.get_mut() }
    }
    #[inline]
    fn key_hash(key: &Self::PendingCacheKey) -> u64 {
        key.hash
    }
    #[inline]
    fn key_len(key: &Self::PendingCacheKey) -> u16 {
        key.len
    }
    #[inline]
    fn key_name(key: &Self::PendingCacheKey) -> &[u8] {
        &key.name
    }
    #[inline]
    fn key_new(key: &Self::PendingCacheKey) -> Self::PendingCacheKey {
        get_host_by_addr_info_request::PendingCacheKey {
            hash: key.hash,
            len: key.len,
            name: key.name.clone(),
            lookup: ptr::null_mut(),
        }
    }
}

impl HasPendingCacheKey for GetNameInfoRequest {
    type PendingCacheKey = get_name_info_request::PendingCacheKey;

    #[inline]
    fn pending_cache(
        resolver: &Resolver,
        _field: PendingCacheField,
    ) -> &mut HiveArray<Self::PendingCacheKey, 32> {
        // SAFETY: see `HasPendingCacheKey::pending_cache` doc — short,
        // non-reentrant borrow on the single JS thread.
        unsafe { resolver.pending_nameinfo_cache_cares.get_mut() }
    }
    #[inline]
    fn key_hash(key: &Self::PendingCacheKey) -> u64 {
        key.hash
    }
    #[inline]
    fn key_len(key: &Self::PendingCacheKey) -> u16 {
        key.len
    }
    #[inline]
    fn key_name(key: &Self::PendingCacheKey) -> &[u8] {
        &key.name
    }
    #[inline]
    fn key_new(key: &Self::PendingCacheKey) -> Self::PendingCacheKey {
        get_name_info_request::PendingCacheKey {
            hash: key.hash,
            len: key.len,
            name: key.name.clone(),
            lookup: ptr::null_mut(),
        }
    }
}

pub(crate) enum ChannelResult<'a> {
    Err(c_ares::Error),
    Result(&'a mut c_ares::Channel), // BORROW_FIELD — borrows the resolver's `channel` field
}

// Canonical enum + parser live in `bun_dns` (lower tier so `cli` can parse
// `--dns-result-order` without depending on the runtime). Re-export for
// existing `crate::dns_jsc::Order` callers; `to_js` stays here as a tier-6
// extension since it needs JSC.
pub use bun_dns::Order;

trait OrderJscExt {
    fn to_js(self, global_this: &JSGlobalObject) -> JsResult<JSValue>;
}

impl OrderJscExt for Order {
    fn to_js(self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        use jsc::StringJsc as _;
        bun::String::static_(<&'static str>::from(self)).to_js(global_this)
    }
}

#[repr(C)] // c_int
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RecordType {
    A = 1,
    AAAA = 28,
    CAA = 257,
    CNAME = 5,
    MX = 15,
    NAPTR = 35,
    NS = 2,
    PTR = 12,
    SOA = 6,
    SRV = 33,
    TXT = 16,
    ANY = 255,
}

bun_core::comptime_string_map! {
    pub(super) static RECORD_TYPE_MAP: RecordType = {
        b"A" => RecordType::A, b"AAAA" => RecordType::AAAA, b"ANY" => RecordType::ANY,
        b"CAA" => RecordType::CAA, b"CNAME" => RecordType::CNAME, b"MX" => RecordType::MX,
        b"NAPTR" => RecordType::NAPTR, b"NS" => RecordType::NS, b"PTR" => RecordType::PTR,
        b"SOA" => RecordType::SOA, b"SRV" => RecordType::SRV, b"TXT" => RecordType::TXT,
        b"a" => RecordType::A, b"aaaa" => RecordType::AAAA, b"any" => RecordType::ANY,
        b"caa" => RecordType::CAA, b"cname" => RecordType::CNAME, b"mx" => RecordType::MX,
        b"naptr" => RecordType::NAPTR, b"ns" => RecordType::NS, b"ptr" => RecordType::PTR,
        b"soa" => RecordType::SOA, b"srv" => RecordType::SRV, b"txt" => RecordType::TXT,
    };
}

impl RecordType {
    pub(crate) const DEFAULT: Self = RecordType::A;
}

impl Resolver {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    pub(crate) fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    // Intrusive refcount forwarders (RefCount.ref / RefCount.deref).
    pub fn ref_(&self) {
        // SAFETY: `self` is live; ref_count uses interior mutability.
        unsafe { bun_ptr::RefCount::<Self>::ref_(std::ptr::from_ref::<Self>(self).cast_mut()) };
    }
    /// Decrement the intrusive refcount; the last ref drops the Box.
    ///
    /// Takes a raw `*mut Self` (not `&self`) because the final deref must write
    /// through / deallocate `*this`; deriving a `*mut` from a `&self` borrow
    /// and writing through it is UB under Stacked/Tree Borrows. Matches the
    /// codebase pattern in `bun_ptr::RefCount::deref(self_: *mut T)`.
    ///
    /// # Safety
    /// `this` must point to a live heap-allocated `Resolver` originating from
    /// `heap::alloc` (see `init`). If this call may drop the last reference,
    /// the caller must not hold any live `&`/`&mut` borrow of `*this`.
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; the 1→0 transition drops the Box.
        unsafe { bun_ptr::RefCount::<Self>::deref(this) };
    }

    pub(crate) fn setup(vm: &VirtualMachine) -> Self {
        Self {
            ref_count: bun_ptr::RefCount::init(),
            channel: Cell::new(None),
            vm: bun_ptr::BackRef::new(vm),
            polls: JsCell::new(PollsMap::new()),
            options: Cell::new(c_ares::ChannelOptions::default()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::DNSResolver,
            )),
            pending_host_cache_cares: JsCell::new(PendingCache::init()),
            pending_host_cache_native: JsCell::new(PendingCache::init()),
            pending_srv_cache_cares: JsCell::new(HiveArray::init()),
            pending_soa_cache_cares: JsCell::new(HiveArray::init()),
            pending_txt_cache_cares: JsCell::new(HiveArray::init()),
            pending_naptr_cache_cares: JsCell::new(HiveArray::init()),
            pending_mx_cache_cares: JsCell::new(HiveArray::init()),
            pending_caa_cache_cares: JsCell::new(HiveArray::init()),
            pending_ns_cache_cares: JsCell::new(HiveArray::init()),
            pending_ptr_cache_cares: JsCell::new(HiveArray::init()),
            pending_cname_cache_cares: JsCell::new(HiveArray::init()),
            pending_a_cache_cares: JsCell::new(HiveArray::init()),
            pending_aaaa_cache_cares: JsCell::new(HiveArray::init()),
            pending_any_cache_cares: JsCell::new(HiveArray::init()),
            pending_addr_cache_cares: JsCell::new(HiveArray::init()),
            pending_nameinfo_cache_cares: JsCell::new(HiveArray::init()),
        }
    }

    pub(crate) fn init(vm: &VirtualMachine) -> *mut Self {
        bun_output::scoped_log!(DNSResolver, "init");
        bun_core::heap::into_raw(Box::new(Self::setup(vm)))
    }

    // ─── R-2 interior-mutability helpers ────────────────────────────────────

    /// `self`'s address as `*mut Self` for c-ares / `FilePoll` / `RefPtr`
    /// ctx slots and `Self::deref`. Callbacks deref it as `&*const` (shared) —
    /// see `on_dns_poll`, `on_cares_complete` — so no write provenance is
    /// required; the `*mut` spelling is purely to match the C signature. All
    /// mutation routes through `Cell` / `JsCell` (UnsafeCell-backed).
    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    // ───────────── timer / pending bookkeeping ─────────────

    pub(crate) fn check_timeouts(&self, now: &ElTimespec, vm: &VirtualMachine) {
        // Caller (`dispatch.rs::fire_timer`) hands us the event-loop's
        // local `ElTimespec`; `add_timer` works in `bun_core::timespec`. Same
        // `{ sec: i64, nsec: i64 }` layout — convert field-by-field.
        let now = bun::timespec {
            sec: now.sec,
            nsec: now.nsec,
        };
        let uws_loop = vm.uws_loop();
        // R-2: `&self` carries no `noalias`, and every field touched below is
        // UnsafeCell-backed, so the re-entrant `ares_process_fd` callbacks
        // (`request_completed`, `drain_pending_*`) may freely re-derive
        // `&Resolver` from their stored ctx without aliasing UB.
        let deref_this = self.as_ctx_ptr();
        scopeguard::defer! {
            // jsc/runtime crate cycle: low-tier `VirtualMachine.timer` is `()`;
            // resolve via the high-tier `RuntimeState` hook.
            let state = crate::jsc_hooks::runtime_state();
            // SAFETY: `state` is the boxed per-thread `RuntimeState`; single-threaded JS heap.
            unsafe { (*state).timer.increment_timer_ref(-1, uws_loop) };
            // SAFETY: `deref_this` is the heap allocation from `init`; releases
            // `add_timer`'s ref. May be the final release; nothing touches
            // `*self` after this point.
            unsafe { Self::deref(deref_this) };
        }

        self.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::PENDING);

        if let Ok(channel) = self.get_channel_or_error(vm.global()) {
            if self.any_requests_pending() {
                // SAFETY: `channel` is the live c-ares channel owned by `self`.
                c_ares::ares_process_fd(
                    unsafe { &mut *channel },
                    c_ares::ARES_SOCKET_BAD,
                    c_ares::ARES_SOCKET_BAD,
                );
                // See `on_dns_poll` — c-ares detaches post-callback, so re-check.
                if self.any_requests_pending() {
                    let _ = self.add_timer(Some(&now));
                } else {
                    self.remove_timer();
                }
            }
        }
    }

    fn any_requests_pending(&self) -> bool {
        // Rust has no field reflection; keep this list in sync with
        // `Resolver`'s `pending_*` fields.
        macro_rules! check { ($($f:ident),*) => { $( if self.$f.get().used.find_first_set().is_some() { return true; } )* } }
        check!(
            pending_host_cache_cares,
            pending_host_cache_native,
            pending_srv_cache_cares,
            pending_soa_cache_cares,
            pending_txt_cache_cares,
            pending_naptr_cache_cares,
            pending_mx_cache_cares,
            pending_caa_cache_cares,
            pending_ns_cache_cares,
            pending_ptr_cache_cares,
            pending_cname_cache_cares,
            pending_a_cache_cares,
            pending_aaaa_cache_cares,
            pending_any_cache_cares,
            pending_addr_cache_cares,
            pending_nameinfo_cache_cares
        );
        // The 32-slot caches overflow to `LookupCacheHit::Disabled`; c-ares' own
        // queue length covers those too. Its channel lock is recursive, so this
        // is safe from inside a completion callback.
        if let Some(channel) = self.channel.get() {
            // SAFETY: `channel` is the live c-ares channel owned by `self`.
            if c_ares::ares_queue_active_queries(unsafe { &*channel }) != 0 {
                return true;
            }
        }
        false
    }

    fn request_sent(&self, _vm: &VirtualMachine) {
        let _ = self.add_timer(None);
    }

    fn request_completed(&self) {
        if self.any_requests_pending() {
            let _ = self.add_timer(None);
        } else {
            self.remove_timer();
        }
    }

    fn add_timer(&self, now: Option<&bun::timespec>) -> bool {
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            return false;
        }

        self.ref_();
        let now_ts = now
            .copied()
            .unwrap_or_else(|| bun::timespec::now(bun::TimespecMockMode::ForceRealTime));
        let next = now_ts.add_ms(1000);
        // `EventLoopTimer.next` uses the event-loop crate's local
        // `Timespec` (distinct from `bun_core::Timespec`); convert by field.
        self.event_loop_timer.with_mut(|t| {
            t.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            }
        });
        let uws_loop = self.vm().uws_loop();
        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; single-threaded JS heap.
        unsafe {
            (*state).timer.increment_timer_ref(1, uws_loop);
            // whole-struct provenance: `from_field_ptr!` recovers the container on fire
            (*state).timer.insert(
                core::ptr::addr_of!(self.event_loop_timer)
                    .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                    .cast_mut(),
            );
        }
        true
    }

    fn remove_timer(&self) {
        if self.event_loop_timer.get().state != EventLoopTimerState::ACTIVE {
            return;
        }

        // Normally checkTimeouts does this, so we have to be sure to do it ourself if we cancel the timer
        let this = self.as_ctx_ptr();
        scopeguard::defer! {
            // SAFETY: `this` is the heap allocation from `init`. This releases
            // the ref taken by `add_timer`. Every caller holds at least one
            // other ref for the duration of this call (a `RefPtr` or the
            // global-resolver permanent pin), so this
            // `deref` cannot reach 0 while `&self` is live.
            unsafe {
                let uws_loop = (*this).vm().uws_loop();
                let state = crate::jsc_hooks::runtime_state();
                (*state).timer.increment_timer_ref(-1, uws_loop);
                Self::deref(this);
            }
        }

        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; single-threaded JS heap.
        unsafe { (*state).timer.remove(self.event_loop_timer.as_ptr()) };
    }

    // ───────────── pending-cache helpers ─────────────

    /// Dispatch to the GetAddrInfo PendingCache by field enum.
    ///
    /// R-2: returns `&mut` from `&self` via `JsCell::get_mut`. Callers hold
    /// the borrow only for the duration of a slot read/claim/unset and never
    /// across a re-entrant call (the c-ares callback path that re-enters the
    /// resolver runs *after* the borrow is dropped).
    #[allow(clippy::mut_from_ref)]
    fn pending_host_cache(&self, field: PendingCacheField) -> &mut PendingCache {
        // SAFETY: single-JS-thread invariant; caller holds the borrow only for
        // a short, non-reentrant window (see fn doc).
        unsafe {
            match field {
                PendingCacheField::PendingHostCacheCares => self.pending_host_cache_cares.get_mut(),
                PendingCacheField::PendingHostCacheNative => {
                    self.pending_host_cache_native.get_mut()
                }
                _ => unreachable!(),
            }
        }
    }

    /// Dispatch to a typed ResolveInfoRequest cache by record type.
    // Each per-record cache is a distinct monomorphization of
    // `HiveArray<resolve_info_request::PendingCacheKey<_>, 32>`; `PendingCacheKey<T>` is
    // layout-identical for all `T` (only the `*mut ResolveInfoRequest<T>` payload's pointee
    // type differs), so reinterpreting the field reference at the caller's `T` is sound when
    // `T::CACHE_FIELD` selects the matching field.
    #[allow(clippy::mut_from_ref)]
    fn pending_cache_for<T: CAresRecordType>(
        &self,
        _field: PendingCacheField,
    ) -> &mut HiveArray<resolve_info_request::PendingCacheKey<T>, 32> {
        macro_rules! field {
            ($f:ident) => {
                // SAFETY: the matched arm guarantees `self.$f` *is*
                // `JsCell<HiveArray<PendingCacheKey<T>, 32>>` for this `T::CACHE_FIELD`;
                // the cast is an identity transmute (same layout, same lifetime).
                // R-2: `JsCell::as_ptr` projects `&mut` from `&self`; caller
                // holds the borrow only for a short, non-reentrant window
                // (see `pending_host_cache` doc).
                unsafe {
                    &mut *self
                        .$f
                        .as_ptr()
                        .cast::<HiveArray<resolve_info_request::PendingCacheKey<T>, 32>>()
                }
            };
        }
        match T::CACHE_FIELD {
            PendingCacheField::PendingSrvCacheCares => field!(pending_srv_cache_cares),
            PendingCacheField::PendingSoaCacheCares => field!(pending_soa_cache_cares),
            PendingCacheField::PendingTxtCacheCares => field!(pending_txt_cache_cares),
            PendingCacheField::PendingNaptrCacheCares => field!(pending_naptr_cache_cares),
            PendingCacheField::PendingMxCacheCares => field!(pending_mx_cache_cares),
            PendingCacheField::PendingCaaCacheCares => field!(pending_caa_cache_cares),
            PendingCacheField::PendingNsCacheCares => field!(pending_ns_cache_cares),
            PendingCacheField::PendingPtrCacheCares => field!(pending_ptr_cache_cares),
            PendingCacheField::PendingCnameCacheCares => field!(pending_cname_cache_cares),
            PendingCacheField::PendingACacheCares => field!(pending_a_cache_cares),
            PendingCacheField::PendingAaaaCacheCares => field!(pending_aaaa_cache_cares),
            PendingCacheField::PendingAnyCacheCares => field!(pending_any_cache_cares),
            // host/addr/nameinfo caches use distinct key types and have their own helpers.
            PendingCacheField::PendingHostCacheCares
            | PendingCacheField::PendingHostCacheNative
            | PendingCacheField::PendingAddrCacheCares
            | PendingCacheField::PendingNameinfoCacheCares => {
                unreachable!()
            }
        }
    }

    // Monomorphic helpers used by the drain* fns below.
    fn get_key_host(
        &self,
        index: u8,
        field: PendingCacheField,
    ) -> get_addr_info_request::PendingCacheKey {
        let cache = self.pending_host_cache(field);
        // SAFETY: slot at `index` was alloc'd by `get_or_put_into_resolve_pending_cache`.
        unsafe { cache.box_at(index as usize) }
            .expect("pending DNS slot")
            .into_inner()
    }
    fn get_key_addr(&self, index: u8) -> get_host_by_addr_info_request::PendingCacheKey {
        self.pending_addr_cache_cares.with_mut(|cache| {
            // SAFETY: slot at `index` was alloc'd by `get_or_put_into_resolve_pending_cache`.
            unsafe { cache.box_at(index as usize) }
                .expect("pending DNS slot")
                .into_inner()
        })
    }
    fn get_key_nameinfo(&self, index: u8) -> get_name_info_request::PendingCacheKey {
        self.pending_nameinfo_cache_cares.with_mut(|cache| {
            // SAFETY: slot at `index` was alloc'd by `get_or_put_into_resolve_pending_cache`.
            unsafe { cache.box_at(index as usize) }
                .expect("pending DNS slot")
                .into_inner()
        })
    }

    pub(crate) fn drain_pending_cares<T: CAresRecordType>(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<OwnedReply<T>>,
    ) {
        // cache_name = format!("pending_{}_cache_cares", T::TYPE_NAME)
        let _guard = self.ref_guard();

        let key = {
            let cache = self.pending_cache_for::<T>(T::CACHE_FIELD);
            // SAFETY: slot at `index` was alloc'd by `get_or_put_into_resolve_pending_cache`.
            unsafe { cache.box_at(index as usize) }
                .expect("pending DNS slot")
                .into_inner()
        };

        let Some(mut addr) = result else {
            // SAFETY: `key.lookup` is the heap-allocated request stored in the
            // pending-cache slot; consumed via `heap::take` below.
            unsafe {
                let mut pending = (*key.lookup).head.next;
                CAresLookup::<T>::process_resolve(
                    ptr::addr_of_mut!((*key.lookup).head),
                    err,
                    timeout,
                    None,
                );
                drop(bun_core::heap::take(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    CAresLookup::<T>::process_resolve(value.as_ptr(), err, timeout, None);
                }
            }
            return;
        };

        // SAFETY: `key.lookup` is the heap-allocated request stored in the
        // pending-cache slot; consumed via `heap::take` below.
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();
            let mut array =
                Outcome::of(prev_global, addr.to_js_response(prev_global, T::TYPE_NAME));
            keep_alive(&array);
            CAresLookup::<T>::on_complete(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            keep_alive(&array);

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = Outcome::of(new_global, addr.to_js_response(new_global, T::TYPE_NAME));
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                keep_alive(&array);
                CAresLookup::<T>::on_complete(value.as_ptr(), array);
                keep_alive(&array);
            }
        }
    }

    pub(crate) fn drain_pending_host_cares(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::AddrInfo>,
    ) {
        let key = self.get_key_host(index, PendingCacheField::PendingHostCacheCares);

        let _guard = self.ref_guard();

        let Some(addr) = result else {
            // SAFETY: `key.lookup` is the heap-allocated request stored in the
            // pending-cache slot; consumed via `heap::take` below.
            unsafe {
                let mut pending = (*key.lookup).head.next;
                DNSLookup::process_get_addr_info(
                    ptr::addr_of_mut!((*key.lookup).head),
                    err,
                    timeout,
                    None,
                );
                drop(bun_core::heap::take(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    DNSLookup::process_get_addr_info(value.as_ptr(), err, timeout, None);
                }
            }
            return;
        };

        // SAFETY: `key.lookup` is the heap-allocated request stored in the pending-cache
        // slot; `addr` is the c-ares-allocated AddrInfo freed by `_free_addr` below.
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();
            let mut array = Outcome::of(
                prev_global,
                super::cares_jsc::addr_info_to_js_array(&mut *addr, prev_global),
            );
            // SAFETY: addr is the c-ares-allocated AddrInfo; freed once after all consumers run.
            // Move the raw pointer into the guard so the loop body can keep borrowing `*addr`.
            let _free_addr = scopeguard::guard(addr, |a| c_ares::AddrInfo::destroy(a));
            keep_alive(&array);
            DNSLookup::on_complete_with_array(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            keep_alive(&array);

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = Outcome::of(
                        new_global,
                        super::cares_jsc::addr_info_to_js_array(&mut *addr, new_global),
                    );
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                keep_alive(&array);
                DNSLookup::on_complete_with_array(value.as_ptr(), array);
                keep_alive(&array);
            }
        }
    }

    pub(crate) fn drain_pending_host_native(
        &self,
        index: u8,
        global_object: &JSGlobalObject,
        err: i32,
        result: &GetAddrInfoResultAny,
    ) {
        bun_output::scoped_log!(DNSResolver, "drainPendingHostNative");
        let key = self.get_key_host(index, PendingCacheField::PendingHostCacheNative);

        let _guard = self.ref_guard();

        let mut array: Outcome = match super::options_jsc::result_any_to_js(result, global_object)
            .transpose()
        {
            Some(a) => Outcome::of(global_object, a),
            None => {
                // SAFETY: `key.lookup` is the heap-allocated request stored in the
                // pending-cache slot; consumed via `heap::take` below.
                unsafe {
                    let mut pending = (*key.lookup).head.next;
                    // Consume the request and move `head` out by value;
                    // `ptr::read` + `heap::take` would double-Drop `DNSLookup`.
                    let owned = *bun_core::heap::take(key.lookup);
                    let mut head = owned.head;
                    DNSLookup::process_get_addr_info_native(&raw mut head, err, ptr::null_mut());

                    while let Some(value) = pending {
                        pending = (*value.as_ptr()).next;
                        DNSLookup::process_get_addr_info_native(
                            value.as_ptr(),
                            err,
                            ptr::null_mut(),
                        );
                    }
                }
                return;
            }
        };
        // SAFETY: `key.lookup` is the heap-allocated request stored in the
        // pending-cache slot; consumed via `heap::take` below.
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();

            {
                keep_alive(&array);
                DNSLookup::on_complete_with_array(ptr::addr_of_mut!((*key.lookup).head), array);
                drop(bun_core::heap::take(key.lookup));
                keep_alive(&array);
            }

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                pending = (*value.as_ptr()).next;
                if !core::ptr::eq(prev_global, new_global) {
                    // Non-null addrinfo (checked above): never `None`.
                    array = Outcome::of(
                        new_global,
                        super::options_jsc::result_any_to_js(result, new_global)
                            .map(|a| a.expect("addrinfo present")),
                    );
                    prev_global = new_global;
                }

                keep_alive(&array);
                DNSLookup::on_complete_with_array(value.as_ptr(), array);
                keep_alive(&array);
            }
        }
    }

    pub(crate) fn drain_pending_addr_cares(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        let key = self.get_key_addr(index);

        let _guard = self.ref_guard();

        let Some(addr) = result else {
            // SAFETY: `key.lookup` is the heap-allocated request stored in the
            // pending-cache slot; consumed via `heap::take` below.
            unsafe {
                let mut pending = (*key.lookup).head.next;
                CAresReverse::process_resolve(
                    ptr::addr_of_mut!((*key.lookup).head),
                    err,
                    timeout,
                    None,
                );
                drop(bun_core::heap::take(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    CAresReverse::process_resolve(value.as_ptr(), err, timeout, None);
                }
            }
            return;
        };

        // SAFETY: `key.lookup` is the heap-allocated request stored in the pending-cache
        // slot; `addr` is the c-ares-owned hostent (freed by c-ares after the callback).
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();
            //  The callback need not and should not attempt to free the memory
            //  pointed to by hostent; the ares library will free it when the
            //  callback returns.
            let mut array = Outcome::of(
                prev_global,
                super::cares_jsc::hostent_to_js_response(&mut *addr, prev_global, b""),
            );
            keep_alive(&array);
            CAresReverse::on_complete(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            keep_alive(&array);

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = Outcome::of(
                        new_global,
                        super::cares_jsc::hostent_to_js_response(&mut *addr, new_global, b""),
                    );
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                keep_alive(&array);
                CAresReverse::on_complete(value.as_ptr(), array);
                keep_alive(&array);
            }
        }
    }

    pub(crate) fn drain_pending_name_info_cares(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        let key = self.get_key_nameinfo(index);

        let _guard = self.ref_guard();

        let Some(mut name_info) = result else {
            // SAFETY: `key.lookup` is the heap-allocated request stored in the
            // pending-cache slot; consumed via `heap::take` below.
            unsafe {
                let mut pending = (*key.lookup).head.next;
                CAresNameInfo::process_resolve(
                    ptr::addr_of_mut!((*key.lookup).head),
                    err,
                    timeout,
                    None,
                );
                drop(bun_core::heap::take(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    CAresNameInfo::process_resolve(value.as_ptr(), err, timeout, None);
                }
            }
            return;
        };

        // SAFETY: `key.lookup` is the heap-allocated request stored in the
        // pending-cache slot; consumed via `heap::take` below.
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();

            let mut array = Outcome::of(
                prev_global,
                super::cares_jsc::nameinfo_to_js_response(&mut name_info, prev_global),
            );
            keep_alive(&array);
            CAresNameInfo::on_complete(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            keep_alive(&array);

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = Outcome::of(
                        new_global,
                        super::cares_jsc::nameinfo_to_js_response(&mut name_info, new_global),
                    );
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                keep_alive(&array);
                CAresNameInfo::on_complete(value.as_ptr(), array);
                keep_alive(&array);
            }
        }
    }

    pub(crate) fn get_or_put_into_resolve_pending_cache<R: HasPendingCacheKey>(
        &self,
        key: &R::PendingCacheKey,
        field: PendingCacheField,
    ) -> LookupCacheHit<R> {
        // Dispatch via `HasPendingCacheKey::pending_cache`; the body is
        // identical across all `R`.
        let cache = R::pending_cache(self, field);
        let mut inflight_iter = cache.used.iter_set();

        while let Some(index) = inflight_iter.next() {
            // SAFETY: `used` bit is set ⇒ slot was initialized.
            let entry = unsafe { &mut *cache.ptr_at(index) };
            if R::key_hash(entry) == R::key_hash(key)
                && R::key_len(entry) == R::key_len(key)
                && R::key_name(entry) == R::key_name(key)
            {
                return LookupCacheHit::Inflight(std::ptr::from_mut(entry));
            }
        }

        if let Some(new) = cache.get_init(R::key_new(key)) {
            return LookupCacheHit::New(new.as_ptr());
        }

        LookupCacheHit::Disabled
    }

    pub(crate) fn get_or_put_into_pending_cache(
        &self,
        key: &get_addr_info_request::PendingCacheKey,
        field: PendingCacheField,
    ) -> CacheHit {
        let cache = self.pending_host_cache(field);
        let mut inflight_iter = cache.used.iter_set();

        while let Some(index) = inflight_iter.next() {
            // SAFETY: `used` bit is set ⇒ slot was initialized.
            let entry = unsafe { &mut *cache.ptr_at(index) };
            if entry.hash == key.hash && entry.len == key.len && entry.name == key.name {
                return CacheHit::Inflight(std::ptr::from_mut(entry));
            }
        }

        if let Some(new) = cache.get_init(get_addr_info_request::PendingCacheKey {
            hash: key.hash,
            len: key.len,
            name: key.name.clone(),
            lookup: ptr::null_mut(),
        }) {
            return CacheHit::New(new.as_ptr());
        }

        CacheHit::Disabled
    }

    pub(crate) fn get_channel(&self) -> ChannelResult<'_> {
        if self.channel.get().is_none() {
            let opts = self.options.get();
            if let Some(err) = c_ares::Channel::init(self, opts) {
                return ChannelResult::Err(err);
            }
        }
        // SAFETY: channel set by init() on success
        ChannelResult::Result(unsafe { &mut *self.channel.get().unwrap() })
    }

    fn get_channel_from_vm(global_this: &JSGlobalObject) -> JsResult<*mut c_ares::Channel> {
        global_resolver(global_this).get_channel_or_error(global_this)
    }

    pub(crate) fn get_channel_or_error(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<*mut c_ares::Channel> {
        match self.get_channel() {
            ChannelResult::Result(result) => Ok(std::ptr::from_mut(result)),
            ChannelResult::Err(err) => {
                let system_error = SystemError {
                    errno: -1,
                    code: bun_core::String::static_(err.code()),
                    message: bun_core::String::static_(err.label()),
                    ..Default::default()
                };
                Err(global_this.throw_value(system_error.to_error_instance(global_this)))
            }
        }
    }

    // ───────────── poll callbacks ─────────────

    #[cfg(windows)]
    pub(crate) extern "C" fn on_dns_poll_uv(
        watcher: *mut libuv::uv_poll_t,
        status: c_int,
        events: c_int,
    ) {
        let poll = UvDnsPoll::from_poll(watcher);
        // SAFETY: `poll` is the live `UvDnsPoll` recovered from libuv's `watcher`
        // via `from_poll` (libuv guarantees the handle outlives this callback).
        // `parent` is the heap-allocated Resolver back-ptr (set in
        // `on_dns_socket_state`); it is kept alive across `Channel::process` by the
        // `_guard` below. `channel` is non-null because c-ares
        // must have been initialized for this poll callback to fire.
        unsafe {
            let parent: *mut Resolver = (*poll).parent;
            let vm = (*parent).vm.get();
            let _exit = vm.enter_event_loop_scope();
            // SAFETY: `parent` is the live heap-allocated Resolver back-ptr.
            let _guard = RefPtr::init_ref(parent);
            // channel must be non-null here as c_ares must have been initialized if we're receiving callbacks
            let channel = (*parent).channel.get().unwrap();
            if status < 0 {
                // an error occurred. just pretend that the socket is both readable and writable.
                // https://github.com/nodejs/node/blob/8a41d9b636be86350cd32847c3f89d327c4f6ff7/src/cares_wrap.cc#L93
                (*channel).process((*poll).socket, true, true);
            } else {
                (*channel).process(
                    (*poll).socket,
                    events & libuv::UV_READABLE != 0,
                    events & libuv::UV_WRITABLE != 0,
                );
            }

            // See `on_dns_poll` for why this re-check follows `ares_process_fd`.
            if !(*parent).any_requests_pending() {
                (*parent).remove_timer();
            }
        }
    }

    #[cfg(windows)]
    pub(crate) unsafe extern "C" fn on_close_uv(watcher: *mut libuv::uv_handle_t) {
        // SAFETY: libuv invokes the close cb with the same handle pointer passed
        // to `uv_close`, which was `&mut UvDnsPoll::poll` (a `uv_poll_t` whose
        // header is `uv_handle_t`); `from_poll` recovers the containing struct.
        let poll = UvDnsPoll::from_poll(watcher.cast());
        UvDnsPoll::destroy(poll);
    }

    /// POSIX `FilePoll` callback (kqueue/epoll). Windows drives c-ares via
    /// libuv (`on_dns_poll_uv`) instead, and the only caller
    /// (`dispatch::__bun_run_file_poll`) is itself `#[cfg(not(windows))]`.
    ///
    /// R-2: `&self` (no `noalias`). `Channel::process` (== `ares_process_fd`)
    /// synchronously fires c-ares completion callbacks which re-enter this
    /// Resolver via a fresh `&Resolver` (e.g. `request_completed`,
    /// `drain_pending_*`, `ref_`/`deref`). With every mutable field
    /// UnsafeCell-backed, LLVM cannot cache `ref_count` across the FFI call —
    /// the structural fix for the previously ASM-verified PROVEN_CACHED
    /// miscompile that needed `black_box` laundering under `&mut self`.
    #[cfg(not(windows))]
    pub(crate) fn on_dns_poll(&self, poll: &mut FilePoll) {
        let vm = self.vm();
        let _exit = vm.enter_event_loop_scope();
        let Some(channel) = self.channel.get() else {
            self.polls.with_mut(|p| {
                let _ = p.remove(&poll.fd.native());
            });
            poll.deinit();
            return;
        };

        let _guard = self.ref_guard();

        // SAFETY: `channel` is the live c-ares channel owned by `self`; no `&mut`
        // to `*self` is held across this re-entrant call (all fields are
        // UnsafeCell-backed).
        unsafe {
            (*channel).process(poll.fd.native(), poll.is_readable(), poll.is_writable());
        }

        // c-ares detaches a query only *after* its callback returns, so
        // `request_completed` may have seen it still counted; re-check now.
        if !self.any_requests_pending() {
            self.remove_timer();
        }
    }

    pub(crate) fn on_dns_socket_state(
        &self,
        fd: c_ares::ares_socket_t,
        readable: bool,
        writable: bool,
    ) {
        #[cfg(windows)]
        {
            use libuv as uv;
            if !readable && !writable {
                // cleanup — `remove` is the ordered, value-returning variant.
                if let Some(entry) = self.polls.with_mut(|p| p.remove(&fd)) {
                    // SAFETY: `entry` is the heap `UvDnsPoll` we inserted below;
                    // libuv takes ownership of the handle until `on_close_uv`
                    // frees the allocation.
                    unsafe {
                        uv::uv_close(
                            core::ptr::from_mut(&mut (*entry).poll).cast(),
                            Some(Self::on_close_uv),
                        )
                    };
                }
                return;
            }

            // Capture `self` as a raw backref for `UvDnsPoll::parent`.
            let this_ptr: *mut Self = self.as_ctx_ptr();
            // SAFETY: single-JS-thread; the `&mut PollsMap` borrow does not span
            // any re-entrant call (libuv `uv_poll_*` below do not call back into
            // this resolver synchronously).
            let polls = unsafe { self.polls.get_mut() };
            let poll_entry = bun_core::handle_oom(polls.get_or_put(fd));
            let poll: *mut UvDnsPoll = if poll_entry.found_existing {
                *poll_entry.value_ptr
            } else {
                let new_poll = UvDnsPoll::new(this_ptr, fd);
                // Publish into the map first so the `GetOrPutResult` borrow can
                // end (NLL) before we may need to `swap_remove` on init failure.
                *poll_entry.value_ptr = new_poll;
                // SAFETY: `Loop::get()` is the live per-thread uws loop;
                // `new_poll` is a fresh heap allocation with a zeroed `uv_poll_t`.
                if unsafe {
                    uv::uv_poll_init_socket((*Loop::get()).uv_loop, &mut (*new_poll).poll, fd as _)
                } < 0
                {
                    UvDnsPoll::destroy(new_poll);
                    let _ = polls.swap_remove(&fd);
                    return;
                }
                new_poll
            };

            let uv_events = (if readable { uv::UV_READABLE } else { 0 })
                | (if writable { uv::UV_WRITABLE } else { 0 });
            // SAFETY: `poll` is the live entry just inserted/looked up above.
            if unsafe {
                uv::uv_poll_start(&mut (*poll).poll, uv_events, Some(Self::on_dns_poll_uv))
            } < 0
            {
                let _ = polls.swap_remove(&fd);
                // SAFETY: handle was successfully `uv_poll_init_socket`-ed, so
                // `uv_close` is the required teardown path; `on_close_uv` frees
                // the `UvDnsPoll` box.
                unsafe {
                    uv::uv_close(
                        core::ptr::from_mut(&mut (*poll).poll).cast(),
                        Some(Self::on_close_uv),
                    )
                };
            }
        }
        #[cfg(not(windows))]
        {
            let ctx = js_event_loop_ctx();

            if !readable && !writable {
                // read == 0 and write == 0 this is c-ares's way of notifying us that
                // the socket is now closed. We must free the data associated with
                // socket.
                if let Some(value) = self.polls.with_mut(|p| p.remove(&fd)) {
                    // SAFETY: `value` is the heap-allocated FilePoll for this fd.
                    unsafe { (*value).deinit_with_vm(ctx) };
                }
                return;
            }

            let owner = Async::Owner::new(
                Async::posix_event_loop::poll_tag::DNS_RESOLVER,
                self.as_ctx_ptr().cast::<()>(),
            );
            // SAFETY: `event_loop_handle` is set once VM is initialized; live for VM lifetime.
            let loop_ = unsafe { &mut *self.vm().event_loop_handle.unwrap() };
            // SAFETY: single-JS-thread; the `&mut PollsMap` borrow does not span
            // any re-entrant call (`FilePoll::register` is a syscall wrapper).
            let polls = unsafe { self.polls.get_mut() };
            let poll_entry = polls.get_or_put(fd).expect("unreachable");

            if !poll_entry.found_existing {
                *poll_entry.value_ptr =
                    FilePoll::init(ctx, sys::Fd::from_native(fd), Default::default(), owner);
            }

            // SAFETY: `value_ptr` points at a slot just initialized above (or a
            // previously-initialized live FilePoll hive slot); JS-thread exclusive.
            let poll = unsafe { &mut **poll_entry.value_ptr };

            // c-ares reports the full desired (readable, writable) set for this
            // fd; sync the poll's registration to match. FilePoll now supports
            // both directions on one poll (epoll: combined mask via CTL_MOD;
            // kqueue: two filters on the same ident, both EV_DELETEd on
            // unregister).
            let have_readable = poll.flags.contains(Async::PollFlag::PollReadable);
            let have_writable = poll.flags.contains(Async::PollFlag::PollWritable);

            if (have_readable && !readable) || (have_writable && !writable) {
                // Dropping a direction. FilePoll has no per-direction
                // unregister (epoll CTL_DEL removes both; a targeted kqueue
                // EV_DELETE would need a new API), and leaving the unwanted
                // direction armed would busy-loop on level-triggered writable
                // once the socket connects. Full resync is the simplest
                // correct path and c-ares DNS fds are short-lived.
                let _ = poll.unregister(loop_, false);
                if readable {
                    let _ = poll.register(loop_, Async::PollKind::Readable, false);
                }
                if writable {
                    let _ = poll.register(loop_, Async::PollKind::Writable, false);
                }
            } else {
                // Only adding directions (or no change). register() issues a
                // single CTL_MOD on epoll that preserves the other direction;
                // on kqueue EV_ADD creates a separate (ident, filter) knote
                // without disturbing the existing one.
                if readable && !have_readable {
                    let _ = poll.register(loop_, Async::PollKind::Readable, false);
                }
                if writable && !have_writable {
                    let _ = poll.register(loop_, Async::PollKind::Writable, false);
                }
            }
        }
    }

    // ───────────── JS host fns: resolve* family ─────────────

    // JSC-ABI shim for this associated fn is emitted by `export_host_fn!` at
    // module scope; `#[host_fn]` cannot be used here because its Free expansion
    // calls the function by bare name, which doesn't resolve inside `impl`.
    pub(crate) fn global_resolve(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        global_resolver(global_this).resolve(global_this, callframe)
    }

    #[host_fn(method)]
    pub(crate) fn resolve(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_as_array::<3>();
        let arguments_len = callframe.arguments_count() as usize;
        if arguments_len < 1 {
            return Err(global_this.throw_not_enough_arguments("resolve", 3, arguments_len));
        }

        let record_type: RecordType = if arguments_len <= 1 {
            RecordType::DEFAULT
        } else {
            'brk: {
                let record_type_value = arguments[1];
                if record_type_value.is_empty_or_undefined_or_null()
                    || !record_type_value.is_string()
                {
                    break 'brk RecordType::DEFAULT;
                }
                let record_type_view = record_type_value.to_js_string_view(global_this)?;
                if record_type_view.is_empty() {
                    break 'brk RecordType::DEFAULT;
                }
                match RECORD_TYPE_MAP.get(record_type_view.to_utf8().slice()) {
                    Some(r) => *r,
                    None => {
                        return Err(global_this.throw_invalid_argument_property_value(
                            b"record",
                            Some(
                                "one of: A, AAAA, ANY, CAA, CNAME, MX, NAPTR, NS, PTR, SOA, SRV, TXT",
                            ),
                            record_type_value,
                        ));
                    }
                }
            }
        };

        let name_value = arguments[0];
        if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
            return Err(global_this.throw_invalid_argument_type("resolve", "name", "string"));
        }
        let name_view = name_value.to_js_string_view(global_this)?;
        let name = name_view.to_utf8();
        if name.slice().is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "resolve",
                "name",
                "non-empty string",
            ));
        }

        match record_type {
            RecordType::A => self.do_resolve_cares::<AHostentWithTtls>(name.slice(), global_this),
            RecordType::AAAA => {
                self.do_resolve_cares::<AaaaHostentWithTtls>(name.slice(), global_this)
            }
            RecordType::ANY => {
                self.do_resolve_cares::<c_ares::struct_any_reply>(name.slice(), global_this)
            }
            RecordType::CAA => {
                self.do_resolve_cares::<c_ares::struct_ares_caa_reply>(name.slice(), global_this)
            }
            RecordType::CNAME => self.do_resolve_cares::<CnameHostent>(name.slice(), global_this),
            RecordType::MX => {
                self.do_resolve_cares::<c_ares::struct_ares_mx_reply>(name.slice(), global_this)
            }
            RecordType::NAPTR => {
                self.do_resolve_cares::<c_ares::struct_ares_naptr_reply>(name.slice(), global_this)
            }
            RecordType::NS => self.do_resolve_cares::<NsHostent>(name.slice(), global_this),
            RecordType::PTR => self.do_resolve_cares::<PtrHostent>(name.slice(), global_this),
            RecordType::SOA => {
                self.do_resolve_cares::<c_ares::struct_ares_soa_reply>(name.slice(), global_this)
            }
            RecordType::SRV => {
                self.do_resolve_cares::<c_ares::struct_ares_srv_reply>(name.slice(), global_this)
            }
            RecordType::TXT => {
                self.do_resolve_cares::<c_ares::struct_ares_txt_reply>(name.slice(), global_this)
            }
        }
    }

    // JSC-ABI shim emitted by `export_host_fn!` at module scope (see `global_resolve`).
    pub(crate) fn global_reverse(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        global_resolver(global_this).reverse(global_this, callframe)
    }

    #[host_fn(method)]
    pub(crate) fn reverse(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_as_array::<2>();
        let arguments_len = callframe.arguments_count() as usize;
        if arguments_len < 1 {
            return Err(global_this.throw_not_enough_arguments("reverse", 1, arguments_len));
        }

        let ip_value = arguments[0];
        if ip_value.is_empty_or_undefined_or_null() || !ip_value.is_string() {
            return Err(global_this.throw_invalid_argument_type("reverse", "ip", "string"));
        }
        let ip_view = ip_value.to_js_string_view(global_this)?;
        let ip_slice = ip_view.to_utf8();
        if ip_slice.slice().is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "reverse",
                "ip",
                "non-empty string",
            ));
        }

        let ip = ip_slice.slice();
        let channel: *mut c_ares::Channel = match self.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                return Err(global_this.throw_value(
                    super::cares_jsc::error_to_js_with_syscall_and_hostname(
                        err,
                        global_this,
                        b"getHostByAddr",
                        ip,
                    )?,
                ));
            }
        };

        let key = get_host_by_addr_info_request::PendingCacheKey::init(ip);
        let cache = self.get_or_put_into_resolve_pending_cache::<GetHostByAddrInfoRequest>(
            &key,
            PendingCacheField::PendingAddrCacheCares,
        );
        if let LookupCacheHit::Inflight(inflight) = cache {
            let cares_reverse = CAresReverse::init(Some(self.as_ctx_ptr()), global_this, ip);
            // SAFETY: `inflight` points into the resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(cares_reverse) };
            // SAFETY: `cares_reverse` was just heap-allocated; owned by the inflight list.
            return Ok(unsafe { (*cares_reverse).promise.value() });
        }

        let request =
            GetHostByAddrInfoRequest::init(cache, Some(self.as_ctx_ptr()), ip, global_this);

        // SAFETY: `request` just heap-allocated in `init()`; `tail` points at its inline `head`.
        let promise = unsafe { (*(*request).tail).promise.value() };
        // SAFETY: `request` is the heap-allocated GetHostByAddrInfoRequest; channel
        // stores it as the c-ares ctx and calls back via HostentHandler::on_hostent.
        unsafe {
            (*channel).get_host_by_addr(ip, &mut *request);
        }

        // SAFETY: `bun_vm()` returns the live VM back-ptr.
        self.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    // JSC-ABI shim emitted by `export_host_fn!` at module scope (see `global_resolve`).
    pub(crate) fn global_lookup(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_as_array::<2>();
        let arguments_len = callframe.arguments_count() as usize;
        if arguments_len < 1 {
            return Err(global_this.throw_not_enough_arguments("lookup", 2, arguments_len));
        }

        let name_value = arguments[0];
        if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
            return Err(global_this.throw_invalid_argument_type("lookup", "hostname", "string"));
        }
        let name_view = name_value.to_js_string_view(global_this)?;
        let name = name_view.to_utf8();
        if name.slice().is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "lookup",
                "hostname",
                "non-empty string",
            ));
        }

        let mut options = GetAddrInfoOptions::default();
        let mut port: u16 = 0;

        if arguments_len > 1 && arguments[1].is_object() {
            let options_object = arguments[1];

            if let Some(port_value) = options_object.get_truthy(global_this, "port")? {
                port = port_value.to_port_number(global_this)?;
            }

            options = match super::options_jsc::options_from_js(options_object, global_this) {
                Ok(o) => o,
                Err(err) => {
                    use bun_dns::OptionsFromJsError as E;
                    return match err {
                        E::InvalidFlags => Err(global_this.throw_invalid_argument_value(
                            b"flags",
                            options_object
                                .get_truthy(global_this, "flags")?
                                .unwrap_or(JSValue::UNDEFINED),
                        )),
                        E::JSError => Err(jsc::JsError::Thrown),
                        // more information with these errors
                        _ => Err(global_this.throw(format_args!(
                            "Invalid options passed to lookup(): {}",
                            <&'static str>::from(&err)
                        ))),
                    };
                }
            };
        }

        let resolver = global_resolver(global_this);

        resolver.do_lookup(name.slice(), port, options, global_this)
    }

    pub(crate) fn do_lookup(
        &self,
        name: &[u8],
        port: u16,
        options: GetAddrInfoOptions,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        if !bun_dns::is_valid_hostname(name) {
            let mut promise = JSPromiseStrong::init(global_this);
            let promise_value = promise.value();
            error_to_deferred(
                c_ares::Error::ENOTFOUND,
                b"getaddrinfo",
                Some(name),
                &mut promise,
            )
            .reject_later(global_this);
            return Ok(promise_value);
        }

        let mut opts = options;
        let mut backend = opts.backend;
        let normalized = normalize_dns_name(name, &mut backend);
        opts.backend = backend;
        let query = GetAddrInfo {
            options: opts,
            port,
            name: normalized.into(),
        };

        Ok(match opts.backend {
            GetAddrInfoBackend::CAres => {
                self.c_ares_lookup_with_normalized_name(&query, global_this)?
            }
            GetAddrInfoBackend::Libc => {
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(self, query, global_this)?
                }
                #[cfg(not(windows))]
                {
                    lib_c::lookup(self, &query, global_this)
                }
            }
            GetAddrInfoBackend::System => {
                #[cfg(target_os = "macos")]
                {
                    dns_sd::lookup(self, &query, global_this)
                }
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(self, query, global_this)?
                }
                #[cfg(all(not(target_os = "macos"), not(windows)))]
                {
                    lib_c::lookup(self, &query, global_this)
                }
            }
        })
    }

    // ───────── per-record-type global+instance resolve fns ─────────
    // These are mechanically identical across record types.
}

macro_rules! resolve_record_fn {
    ($global:ident, $method:ident, $jsname:literal, $ty:ty, $allow_empty:expr) => {
        // JSC-ABI shim emitted by `export_host_fn!` at module scope (see `global_resolve`).
        pub fn $global(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
            global_resolver(global_this).$method(global_this, callframe)
        }

        #[host_fn(method)]
        pub fn $method(
            &self,
            global_this: &JSGlobalObject,
            callframe: &CallFrame,
        ) -> JsResult<JSValue> {
            let arguments = callframe.arguments_as_array::<2>();
            let arguments_len = callframe.arguments_count() as usize;
            if arguments_len < 1 {
                return Err(global_this.throw_not_enough_arguments($jsname, 1, arguments_len));
            }
            let name_value = arguments[0];
            if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
                return Err(global_this.throw_invalid_argument_type($jsname, "hostname", "string"));
            }
            let name_view = name_value.to_js_string_view(global_this)?;
            let name = name_view.to_utf8();
            if !$allow_empty && name.slice().is_empty() {
                return Err(global_this.throw_invalid_argument_type(
                    $jsname,
                    "hostname",
                    "non-empty string",
                ));
            }
            self.do_resolve_cares::<$ty>(name.slice(), global_this)
        }
    };
}

// `c_ares::Channel::init` requires this to wire the socket-state callback and
// hand the allocated channel pointer back into `self.channel`.
impl c_ares::ChannelContainer for Resolver {
    #[inline]
    fn on_dns_socket_state(&self, socket: c_ares::ares_socket_t, readable: bool, writable: bool) {
        Resolver::on_dns_socket_state(self, socket, readable, writable);
    }
    #[inline]
    fn set_channel(&self, channel: *mut c_ares::Channel) {
        self.channel.set(Some(channel));
        // A live channel has sockets, timers and queries in flight whose
        // callbacks need this VM: the stop phase closes it (any resolver, not
        // just the VM-global one) if nobody did before. Unregistered in
        // `destroy_channel`.
        crate::jsc_hooks::ActiveHandle::DnsResolver(core::ptr::NonNull::from(self)).register();
    }
}

impl Resolver {
    /// The one place a channel is torn down: `ares_destroy` fails every
    /// pending query with `ARES_EDESTRUCTION` into its callback (releasing the
    /// request's ref on this resolver) and closes the channel's sockets.
    /// Returns whether there was a channel.
    fn destroy_channel(&self) -> bool {
        let Some(channel) = self.channel.take() else {
            return false;
        };
        crate::jsc_hooks::ActiveHandle::DnsResolver(core::ptr::NonNull::from(self)).unregister();
        // SAFETY: `channel` is the live handle from `ares_init_options`, owned by this resolver.
        unsafe { c_ares::Channel::destroy(channel) };
        true
    }
}

impl Resolver {
    resolve_record_fn!(
        global_resolve_srv,
        resolve_srv,
        "resolveSrv",
        c_ares::struct_ares_srv_reply,
        false
    );
    resolve_record_fn!(
        global_resolve_soa,
        resolve_soa,
        "resolveSoa",
        c_ares::struct_ares_soa_reply,
        true
    );
    resolve_record_fn!(
        global_resolve_caa,
        resolve_caa,
        "resolveCaa",
        c_ares::struct_ares_caa_reply,
        false
    );
    resolve_record_fn!(global_resolve_ns, resolve_ns, "resolveNs", NsHostent, true);
    resolve_record_fn!(
        global_resolve_ptr,
        resolve_ptr,
        "resolvePtr",
        PtrHostent,
        false
    );
    resolve_record_fn!(
        global_resolve_cname,
        resolve_cname,
        "resolveCname",
        CnameHostent,
        false
    );
    resolve_record_fn!(
        global_resolve_mx,
        resolve_mx,
        "resolveMx",
        c_ares::struct_ares_mx_reply,
        false
    );
    resolve_record_fn!(
        global_resolve_naptr,
        resolve_naptr,
        "resolveNaptr",
        c_ares::struct_ares_naptr_reply,
        false
    );
    resolve_record_fn!(
        global_resolve_txt,
        resolve_txt,
        "resolveTxt",
        c_ares::struct_ares_txt_reply,
        false
    );
    resolve_record_fn!(
        global_resolve_any,
        resolve_any,
        "resolveAny",
        c_ares::struct_any_reply,
        false
    );

    pub(crate) fn do_resolve_cares<T: CAresRecordType>(
        &self,
        name: &[u8],
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel: *mut c_ares::Channel = match self.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                // syscall = "query" + ucfirst(TYPE_NAME) — precomputed per record type.
                return Err(
                    global_this.throw_value(super::cares_jsc::error_to_js_with_syscall(
                        err,
                        global_this,
                        T::SYSCALL.as_bytes(),
                    )?),
                );
            }
        };

        let cache_field = T::CACHE_FIELD; // "pending_{TYPE_NAME}_cache_cares"

        let key = resolve_info_request::PendingCacheKey::<T>::init(name);

        let cache =
            self.get_or_put_into_resolve_pending_cache::<ResolveInfoRequest<T>>(&key, cache_field);
        if let LookupCacheHit::Inflight(inflight) = cache {
            // CAresLookup will have the name ownership
            let cares_lookup = CAresLookup::<T>::init(Some(self.as_ctx_ptr()), global_this, name);
            // SAFETY: `inflight` points into the resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(cares_lookup) };
            // SAFETY: `cares_lookup` was just heap-allocated; owned by the inflight list.
            return Ok(unsafe { (*cares_lookup).promise.value() });
        }

        let request = ResolveInfoRequest::<T>::init(
            cache,
            Some(self.as_ctx_ptr()),
            name, // CAresLookup will have the ownership
            global_this,
            cache_field,
        );
        // SAFETY: `request` just heap-allocated in `init()`; `tail` points at its inline `head`.
        let promise = unsafe { (*(*request).tail).promise.value() };

        // SAFETY: `channel` is the live c-ares channel owned by `self`; `request`
        // is the freshly heap-allocated ResolveInfoRequest. c-ares stores the ctx
        // pointer and calls `T::RAW_CALLBACK` (→ `on_cares_complete`) which
        // consumes the request, so the `&mut` borrow is not held past this call.
        unsafe { (*channel).resolve(name, &mut *request) };

        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        self.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    pub(crate) fn c_ares_lookup_with_normalized_name(
        &self,
        query: &GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel: *mut c_ares::Channel = match self.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                let syscall = bun_core::String::create_atom(&query.name);
                let system_error = SystemError {
                    errno: -1,
                    code: bun_core::String::static_(err.code()),
                    message: bun_core::String::static_(err.label()),
                    syscall,
                    ..Default::default()
                };
                return Err(global_this.throw_value(system_error.to_error_instance(global_this)));
            }
        };

        let key = get_addr_info_request::PendingCacheKey::init(query);

        let cache =
            self.get_or_put_into_pending_cache(&key, PendingCacheField::PendingHostCacheCares);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(self.as_ctx_ptr(), global_this);
            // SAFETY: `inflight` points into the resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(dns_lookup) };
            // SAFETY: `dns_lookup` was just heap-allocated; owned by the inflight list.
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let hints_buf = [query.to_cares()];
        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::CAres,
            Some(self.as_ctx_ptr()),
            global_this,
            PendingCacheField::PendingHostCacheCares,
        );
        // SAFETY: `request` just heap-allocated in `init()`; `tail` points at its inline `head`.
        let promise = unsafe { (*(*request).tail).promise.value() };

        // SAFETY: `channel` is the live c-ares channel owned by `self`; `request`
        // is the freshly heap-allocated GetAddrInfoRequest. c-ares stores the ctx
        // pointer and calls `AddrInfo::callback_wrapper::<GetAddrInfoRequest>`
        // (→ `on_cares_complete`) which consumes the request, so the `&mut`
        // borrow is not held past this call.
        unsafe { (*channel).get_addr_info(&query.name, query.port, &hints_buf, &mut *request) };

        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        self.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    // ───────── servers / local address ─────────

    fn get_channel_servers(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut servers: *mut c_ares::struct_ares_addr_port_node = ptr::null_mut();
        // SAFETY: `channel` is a live handle from `ares_init_options`; `servers` is a stack out-param.
        let r = unsafe { c_ares::ares_get_servers_ports(channel, &raw mut servers) };
        if r != c_ares::ARES_SUCCESS {
            let err = c_ares::Error::get(r).unwrap();
            return Err(
                global_this.throw_value(global_this.create_error_instance(format_args!(
                    "ares_get_servers_ports error: {}",
                    err.label()
                ))),
            );
        }
        scopeguard::defer! {
            // SAFETY: `servers` was allocated by ares_get_servers_ports; ares_free_data is its deallocator.
            unsafe { c_ares::ares_free_data(servers.cast()) }
        };

        let values = JSValue::create_empty_array(global_this, 0)?;

        let mut i: u32 = 0;
        let mut cur = servers;
        while !cur.is_null() {
            // SAFETY: `cur` is non-null (loop guard) and walks the c-ares-allocated list.
            let current = unsafe { &*cur };
            // Formatting reference: https://nodejs.org/api/dns.html#dnsgetservers
            // Brackets '[' and ']' consume 2 bytes, used for IPv6 format (e.g., '[2001:4860:4860::8888]:1053').
            // Port range is 6 bytes (e.g., ':65535').
            // Null terminator '\0' uses 1 byte.
            let mut buf = [0u8; INET6_ADDRSTRLEN + 2 + 6 + 1];
            let family = current.family;

            let addr_ptr: *const c_void = current.addr_ptr();
            // SAFETY: `addr_ptr` type-erases the in_addr/in6_addr union arm (read-only);
            // `dst` is the stack buffer slice starting at [1].
            let Some(ip) = (unsafe { bun_cares_sys::ntop(family, addr_ptr, &mut buf[1..]) }) else {
                return Err(global_this.throw_value(global_this.create_error_instance(
                    format_args!(
                        "ares_inet_ntop error: no more space to convert a network format address"
                    ),
                )));
            };

            let mut port = current.tcp_port;
            if port == 0 {
                port = current.udp_port;
            }
            if port == 0 {
                port = IANA_DNS_PORT;
            }

            // size = strlen(buf+1) + 1
            let size = ip.len() + 1;
            use jsc::StringJsc as _;
            if port == IANA_DNS_PORT {
                values.put_index(
                    global_this,
                    i,
                    bun_string_jsc::create_utf8_for_js(global_this, &buf[1..size])?,
                )?;
            } else if family == netc::AF_INET6 {
                buf[0] = b'[';
                buf[size] = b']';
                use std::io::Write;
                let port_len = {
                    let avail = buf.len() - (size + 1);
                    let mut cursor = &mut buf[size + 1..];
                    write!(cursor, ":{}", port).expect("unreachable");
                    avail - cursor.len()
                };
                values.put_index(
                    global_this,
                    i,
                    bun_core::String::borrow_utf8(&buf[0..size + 1 + port_len])
                        .to_js(global_this)?,
                )?;
            } else {
                use std::io::Write;
                let port_len = {
                    let avail = buf.len() - size;
                    let mut cursor = &mut buf[size..];
                    write!(cursor, ":{}", port).expect("unreachable");
                    avail - cursor.len()
                };
                values.put_index(
                    global_this,
                    i,
                    bun_string_jsc::create_utf8_for_js(global_this, &buf[1..size + port_len])?,
                )?;
            }

            i += 1;
            cur = current.next;
        }

        Ok(values)
    }

    // FFI shim emitted by `export_host_fn!` below — `#[host_fn]` (Free) cannot
    // expand inside an `impl` block (it emits a bare `fn_name(...)` call).
    pub(crate) fn get_global_servers(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::get_channel_servers(
            Self::get_channel_from_vm(global_this)?,
            global_this,
            callframe,
        )
    }

    #[host_fn(method)]
    pub(crate) fn get_servers(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::get_channel_servers(
            self.get_channel_or_error(global_this)?,
            global_this,
            callframe,
        )
    }

    #[host_fn(method)]
    pub(crate) fn set_local_address(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_channel_local_addresses(
            self.get_channel_or_error(global_this)?,
            global_this,
            callframe,
        )
    }

    fn set_channel_local_addresses(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return Err(global_this.throw_not_enough_arguments("setLocalAddress", 1, 0));
        }

        let first_af = Self::set_channel_local_address(channel, global_this, arguments[0])?;

        if arguments.len() < 2 || arguments[1].is_undefined() {
            return Ok(JSValue::UNDEFINED);
        }

        let second_af = Self::set_channel_local_address(channel, global_this, arguments[1])?;

        if first_af != second_af {
            return Ok(JSValue::UNDEFINED);
        }

        match first_af {
            x if x == c_ares::AF::INET => Err(global_this
                .throw_invalid_arguments(format_args!("Cannot specify two IPv4 addresses."))),
            x if x == c_ares::AF::INET6 => Err(global_this
                .throw_invalid_arguments(format_args!("Cannot specify two IPv6 addresses."))),
            _ => unreachable!(),
        }
    }

    fn set_channel_local_address(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<c_int> {
        let address = value.to_bun_string(global_this)?.to_owned_slice_z();

        let mut addr = [0u8; 16];

        // SAFETY: FFI; `address` is NUL-terminated; `addr` is a 16-byte stack buffer.
        if unsafe {
            c_ares::ares_inet_pton(c_ares::AF::INET, address.as_ptr(), addr.as_mut_ptr().cast())
        } == 1
        {
            let ip = u32::from_be_bytes([addr[0], addr[1], addr[2], addr[3]]);
            // SAFETY: `channel` is a live handle returned by `ares_init_options`.
            c_ares::ares_set_local_ip4(unsafe { &mut *channel }, ip);
            return Ok(c_ares::AF::INET);
        }

        // SAFETY: FFI; `address` is NUL-terminated; `addr` is a 16-byte stack buffer.
        if unsafe {
            c_ares::ares_inet_pton(
                c_ares::AF::INET6,
                address.as_ptr(),
                addr.as_mut_ptr().cast(),
            )
        } == 1
        {
            // SAFETY: `channel` is a live handle from `ares_init_options`; `addr` is the 16-byte in6_addr.
            unsafe { c_ares::ares_set_local_ip6(channel, addr.as_ptr()) };
            return Ok(c_ares::AF::INET6);
        }

        Err(jsc::Error::INVALID_IP_ADDRESS.throw(
            global_this,
            format_args!(
                "Invalid IP address: \"{}\"",
                bstr::BStr::new(address.as_bytes())
            ),
        ))
    }

    fn set_channel_servers(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // It's okay to call dns.setServers with active queries, but not dns.Resolver.setServers
        if channel != Self::get_channel_from_vm(global_this)?
            // SAFETY: `channel` is a live handle returned by `ares_init_options`.
            && c_ares::ares_queue_active_queries(unsafe { &*channel }) != 0
        {
            return Err(global_this
                .err(
                    jsc::Error::DNS_SET_SERVERS_FAILED,
                    format_args!("Failed to set servers: there are pending queries"),
                )
                .throw());
        }

        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return Err(global_this.throw_not_enough_arguments("setServers", 1, 0));
        }

        let argument = arguments[0];
        if !argument.is_array() {
            return Err(global_this.throw_invalid_argument_type("setServers", "servers", "array"));
        }

        let mut triples_iterator = argument.array_iterator(global_this)?;

        if triples_iterator.len == 0 {
            // SAFETY: FFI; channel is a live initialized ares_channel; null clears the server list.
            let r = unsafe { c_ares::ares_set_servers_ports(channel, ptr::null_mut()) };
            if r != c_ares::ARES_SUCCESS {
                let err = c_ares::Error::get(r).unwrap();
                return Err(global_this.throw_value(global_this.create_error_instance(
                    format_args!("ares_set_servers_ports error: {}", err.label()),
                )));
            }
            return Ok(JSValue::UNDEFINED);
        }

        let mut entries: Vec<c_ares::struct_ares_addr_port_node> =
            Vec::with_capacity(triples_iterator.len as usize);

        while let Some(triple) = triples_iterator.next()? {
            if !triple.is_array() {
                return Err(global_this.throw_invalid_argument_type(
                    "setServers",
                    "triple",
                    "array",
                ));
            }

            let family = triple
                .get_index(global_this, 0)?
                .coerce_to_i32(global_this)?;
            let port = triple
                .get_index(global_this, 2)?
                .coerce_to_i32(global_this)?;

            if family != 4 && family != 6 {
                return Err(
                    global_this.throw_invalid_arguments(format_args!("Invalid address family"))
                );
            }

            let address_string = triple
                .get_index(global_this, 1)?
                .to_bun_string(global_this)?;
            let address_slice = address_string.to_owned_slice();

            let mut address_buffer = vec![0u8; address_slice.len() + 1];
            let _ = strings::copy(&mut address_buffer, &address_slice);
            address_buffer[address_slice.len()] = 0;

            let af: c_int = if family == 4 {
                netc::AF_INET
            } else {
                netc::AF_INET6
            };

            let mut node: c_ares::struct_ares_addr_port_node = bun_core::ffi::zeroed();
            node.next = ptr::null_mut();
            node.family = af;
            node.udp_port = port;
            node.tcp_port = port;

            let addr_dst: *mut c_void = node.addr_mut_ptr();
            // SAFETY: FFI; `address_buffer` is NUL-terminated above; `addr_dst` points at the
            // in_addr/in6_addr union (16 bytes — enough for in6_addr) with write provenance.
            if unsafe {
                c_ares::ares_inet_pton(af, address_buffer.as_ptr().cast::<c_char>(), addr_dst)
            } != 1
            {
                return Err(jsc::Error::INVALID_IP_ADDRESS.throw(
                    global_this,
                    format_args!(
                        "Invalid IP address: \"{}\"",
                        bstr::BStr::new(&address_slice)
                    ),
                ));
            }

            entries.push(node);
        }
        // Link the list AFTER the Vec is fully populated (no reallocs past this point).
        for i in 1..entries.len() {
            // Reshaped for borrowck — raw ptr to avoid two &mut into entries.
            let next: *mut _ = &raw mut entries[i];
            entries[i - 1].next = next;
        }

        // SAFETY: FFI; channel is live; entries form a valid singly-linked list (next ptrs set above)
        // and remain alive for the duration of the call (c-ares copies them internally).
        let r = unsafe { c_ares::ares_set_servers_ports(channel, entries.as_mut_ptr()) };
        if r != c_ares::ARES_SUCCESS {
            let err = c_ares::Error::get(r).unwrap();
            return Err(
                global_this.throw_value(global_this.create_error_instance(format_args!(
                    "ares_set_servers_ports error: {}",
                    err.label()
                ))),
            );
        }

        Ok(JSValue::UNDEFINED)
    }

    // FFI shim emitted by `export_host_fn!` below.
    pub(crate) fn set_global_servers(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_channel_servers(
            Self::get_channel_from_vm(global_this)?,
            global_this,
            callframe,
        )
    }

    #[host_fn(method)]
    pub(crate) fn set_servers(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_channel_servers(
            self.get_channel_or_error(global_this)?,
            global_this,
            callframe,
        )
    }

    // FFI shim emitted by `export_host_fn!` below (JS2Native link name).
    pub(crate) fn new_resolver(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        let resolver = Resolver::init(global_this.bun_vm());

        let options = callframe.argument(0);
        if options.is_object() {
            // SAFETY: `resolver` is the heap allocation from `init`; not yet
            // wrapped in JS so exclusively owned here.
            let opts_cell = unsafe { &(*resolver).options };
            let mut opts = opts_cell.get();
            if let Some(timeout) = options.get_truthy(global_this, "timeout")? {
                opts.timeout = Some(timeout.coerce_to_i32(global_this)?);
            }
            if let Some(tries) = options.get_truthy(global_this, "tries")? {
                opts.tries = Some(tries.coerce_to_i32(global_this)?);
            }
            opts_cell.set(opts);
        }

        // SAFETY: `resolver` was `heap::alloc`'d in `Resolver::init`; ownership
        // transfers to the GC wrapper (`DNSResolver__create` → `finalize` →
        // `Self::deref` → `heap::take`).
        Ok(unsafe { Resolver::to_js_ptr(resolver, global_this) })
    }

    #[host_fn(method)]
    pub(crate) fn cancel(
        &self,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let channel = self.get_channel_or_error(global_this)?;
        // SAFETY: `channel` is a live handle returned by `ares_init_options`.
        c_ares::ares_cancel(unsafe { &mut *channel });
        Ok(JSValue::UNDEFINED)
    }

    // Resolves the given address and port into a host name and service using the operating system's underlying getnameinfo implementation.
    // If address is not a valid IP address, a TypeError will be thrown. The port will be coerced to a number.
    // If it is not a legal port, a TypeError will be thrown.
    // FFI shim emitted by `export_host_fn!` below.
    pub(crate) fn global_lookup_service(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_as_array::<2>();
        let arguments_len = callframe.arguments_count() as usize;
        if arguments_len < 2 {
            return Err(global_this.throw_not_enough_arguments("lookupService", 2, arguments_len));
        }

        let addr_value = arguments[0];
        if addr_value.is_empty_or_undefined_or_null() || !addr_value.is_string() {
            return Err(global_this.throw_invalid_argument_type(
                "lookupService",
                "address",
                "string",
            ));
        }
        let addr_view = addr_value.to_js_string_view(global_this)?;
        if addr_view.is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "lookupService",
                "address",
                "non-empty string",
            ));
        }
        let addr_slice = addr_view.to_utf8();
        let addr_s = addr_slice.slice();

        let port_value = arguments[1];
        let port: u16 = port_value.to_port_number(global_this)?;

        let mut sa: SockaddrStorage = bun_core::ffi::zeroed();
        // SAFETY: sockaddr_storage is large enough to hold any sockaddr family
        // get_sockaddr writes (in/in6); the `&mut *` reborrow yields a
        // `&mut sockaddr` view into that storage.
        if c_ares::get_sockaddr(addr_s, port, unsafe {
            // Target type inferred from `get_sockaddr`'s signature: `libc::sockaddr`
            // on POSIX, `bun_cares_sys::winsock::sockaddr` on Windows (the latter
            // is crate-private, so it cannot be named here).
            &mut *(&raw mut sa).cast()
        }) != 0
        {
            return Err(global_this.throw_invalid_argument_value(b"address", addr_value));
        }

        let resolver = global_resolver(global_this);
        let channel = resolver.get_channel_or_error(global_this)?;

        // This string will be freed in `CAresNameInfo.deinit`
        let mut cache_name = Vec::new();
        {
            use std::io::Write;
            write!(&mut cache_name, "{}|{}", bstr::BStr::new(addr_s), port)
                .expect("infallible: in-memory write");
        }
        let cache_name: Box<[u8]> = cache_name.into_boxed_slice();

        let key = get_name_info_request::PendingCacheKey::init(&cache_name);
        let cache = resolver.get_or_put_into_resolve_pending_cache::<GetNameInfoRequest>(
            &key,
            PendingCacheField::PendingNameinfoCacheCares,
        );

        if let LookupCacheHit::Inflight(inflight) = cache {
            let info = CAresNameInfo::init(global_this, cache_name);
            // SAFETY: `inflight` points into the resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(info) };
            // SAFETY: `info` was just heap-allocated; owned by the inflight list.
            return Ok(unsafe { (*info).promise.value() });
        }

        let request = GetNameInfoRequest::init(
            cache,
            Some(resolver.as_ctx_ptr()),
            cache_name, // transfer ownership here
            global_this,
            PendingCacheField::PendingNameinfoCacheCares,
        );

        // SAFETY: `request` just heap-allocated in `init()`; `tail` points at its inline `head`.
        let promise = unsafe { (*(*request).tail).promise.value() };
        // SAFETY: `channel` is the live c-ares channel; `sa` is a valid
        // sockaddr_storage reborrowed as sockaddr; `request` was just
        // `heap::alloc`'d and is owned by c-ares until the callback fires.
        unsafe {
            (*channel).get_name_info(
                // See `get_sockaddr` call above — inferred `sockaddr` type is
                // platform-dependent and unnameable on Windows from this crate.
                &mut *(&raw mut sa).cast(),
                &mut *request,
            );
        }

        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        resolver.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    // FFI shim emitted by `export_host_fn!` below (JS2Native link name).
    pub(crate) fn get_runtime_default_result_order_option(
        global_this: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        // `VirtualMachine.dns_result_order` is stored as a raw `u8` (the jsc
        // crate cannot depend on this crate's `Order`); cast through Order's repr(u8).
        let raw = global_this.bun_vm().as_mut().dns_result_order;
        let order = match raw {
            4 => Order::Ipv4first,
            6 => Order::Ipv6first,
            _ => Order::Verbatim,
        };
        order.to_js(global_this)
    }
}

// ───────── JS host-fn FFI exports ─────────
// The #[host_fn] attribute emits the JSC-ABI shim under the Rust function name;
// re-export each under its `Bun__DNS__*` link name. Mirrors the proc-macro's
// shim body (see `bun_jsc_macros::host_fn`, `HostFnKind::Free`).
macro_rules! export_host_fn {
    ($scope:ident :: $f:ident, $name:literal) => {
        const _: () = {
            #[cfg(all(windows, target_arch = "x86_64"))]
            #[unsafe(export_name = $name)]
            pub(crate) unsafe extern "sysv64" fn __shim(
                g: *mut ::bun_jsc::JSGlobalObject,
                f: *mut ::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let (g, f) = unsafe { (&*g, &*f) };
                ::bun_jsc::__macro_support::host_fn_result(g, || $scope::$f(g, f))
            }
            #[cfg(not(all(windows, target_arch = "x86_64")))]
            #[unsafe(export_name = $name)]
            pub(crate) unsafe extern "C" fn __shim(
                g: *mut ::bun_jsc::JSGlobalObject,
                f: *mut ::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let (g, f) = unsafe { (&*g, &*f) };
                ::bun_jsc::__macro_support::host_fn_result(g, || $scope::$f(g, f))
            }
        };
    };
}
export_host_fn!(Resolver::global_resolve, "Bun__DNS__resolve");
export_host_fn!(Resolver::global_lookup, "Bun__DNS__lookup");
export_host_fn!(Resolver::global_resolve_txt, "Bun__DNS__resolveTxt");
export_host_fn!(Resolver::global_resolve_soa, "Bun__DNS__resolveSoa");
export_host_fn!(Resolver::global_resolve_mx, "Bun__DNS__resolveMx");
export_host_fn!(Resolver::global_resolve_naptr, "Bun__DNS__resolveNaptr");
export_host_fn!(Resolver::global_resolve_srv, "Bun__DNS__resolveSrv");
export_host_fn!(Resolver::global_resolve_caa, "Bun__DNS__resolveCaa");
export_host_fn!(Resolver::global_resolve_ns, "Bun__DNS__resolveNs");
export_host_fn!(Resolver::global_resolve_ptr, "Bun__DNS__resolvePtr");
export_host_fn!(Resolver::global_resolve_cname, "Bun__DNS__resolveCname");
export_host_fn!(Resolver::global_resolve_any, "Bun__DNS__resolveAny");
export_host_fn!(Resolver::get_global_servers, "Bun__DNS__getServers");
export_host_fn!(Resolver::set_global_servers, "Bun__DNS__setServers");
export_host_fn!(Resolver::global_reverse, "Bun__DNS__reverse");
export_host_fn!(Resolver::global_lookup_service, "Bun__DNS__lookupService");
export_host_fn!(internal::prefetch_from_js, "Bun__DNS__prefetch");
export_host_fn!(internal::get_dns_cache_stats, "Bun__DNS__getCacheStats");
// JS2Native ($newRustFunction) entry points — see GeneratedJS2Native.h
export_host_fn!(
    Resolver::new_resolver,
    "JS2Rust___src_runtime_dns_jsc_dns_rs__Resolver_newResolver"
);
export_host_fn!(
    Resolver::get_runtime_default_result_order_option,
    "JS2Rust___src_runtime_dns_jsc_dns_rs__Resolver_getRuntimeDefaultResultOrderOption"
);
export_host_fn!(
    internal::seed_cache_for_testing,
    "JS2Rust___src_runtime_dns_jsc_dns_rs__internal_seedCacheForTesting"
);
export_host_fn!(
    internal::is_localhost_name_for_testing,
    "JS2Rust___src_runtime_dns_jsc_dns_rs__internal_isLocalhostNameForTesting"
);
export_host_fn!(
    internal::is_all_loopback_of_one_family_for_testing,
    "JS2Rust___src_runtime_dns_jsc_dns_rs__internal_isAllLoopbackOfOneFamilyForTesting"
);
