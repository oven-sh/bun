//! DNS resolver — JSC bindings.

use core::cell::Cell;
use core::ffi::{CStr, c_int, c_void};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::ArrayHashMap;
#[cfg(not(windows))]
use bun_core::Output;
use bun_core::strings;
use bun_core::{self as bun, env_var, fmt as bun_fmt};
#[cfg(not(windows))]
use bun_dns::ResultList as GetAddrInfoResultList;
use bun_dns::{
    self, Backend as GetAddrInfoBackend, GetAddrInfo, GetAddrInfoResult,
    Options as GetAddrInfoOptions, ResultAny as GetAddrInfoResultAny,
};
#[cfg(not(windows))]
use bun_io::OwnedFilePoll;
use bun_io::{self as Async, KeepAlive};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsCell, JsResult,
    SystemError, host_fn,
};
use bun_paths::MAX_PATH_BYTES;
use bun_ptr::{BackRef, RefPtr, ThisPtr};
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_uws::Loop;
use bun_wyhash::hash as wyhash;

use super::cares_jsc::error_to_deferred;
use crate::jsc_hooks::timer_all_mut;
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
        AF_INET, AF_INET6, AF_UNSPEC, EAI_NONAME, SOCK_STREAM, addrinfo, sockaddr_in, sockaddr_in6,
        sockaddr_storage,
    };
}
#[cfg(windows)]
pub(crate) mod netc {
    pub(crate) use bun_libuv_sys::{addrinfo, sockaddr_in, sockaddr_in6, sockaddr_storage};
    pub(crate) use bun_sys::windows::ws2_32::{AF_INET, AF_INET6, AF_UNSPEC, SOCK_STREAM};
}
type SockaddrStorage = netc::sockaddr_storage;
type AddrInfo = netc::addrinfo;

/// The per-VM global DNS resolver, created on first use; pinned by
/// [`GlobalData`] until `deinit_runtime_state`.
#[inline]
fn global_resolver(global_this: &JSGlobalObject) -> ThisPtr<Resolver> {
    let gd =
        crate::jsc_hooks::global_dns_data().get_or_init(|| GlobalData::init(global_this.bun_vm()));
    gd.resolver.this_ptr()
}

/// The C view of `z`: up to its first NUL (an embedded NUL truncates, as it
/// would for any C resolver API).
#[inline]
fn c_str(z: &bun::ZStr) -> &CStr {
    CStr::from_bytes_until_nul(z.as_bytes_with_nul()).expect("ZStr ends in NUL")
}

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
        this: ThisPtr<Resolver>,
        query_init: &GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JSValue {
        let key = PendingCacheKey::init(query_init);

        let cache = Resolver::pending_host_cache(&this, PendingCacheField::PendingHostCacheNative)
            .get_or_put(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(Some(this), global_this);
            let promise = dns_lookup.promise.value();
            Resolver::pending_host_cache(&this, PendingCacheField::PendingHostCacheNative)
                .append(inflight, dns_lookup);
            return promise;
        }

        let query = query_init.clone();

        let request = get_addr_info_request::LibcRequest {
            head: Some(DNSLookup::init_head(Some(this), global_this)),
            pending_slot: cache.new_slot(),
        };
        let promise_value = request.head.as_ref().unwrap().promise.value();

        bun_jsc::Job::<get_addr_info_request::LibcLookup>::schedule(
            &global_this.js_thread(),
            get_addr_info_request::LibcLookup {
                backend: get_addr_info_request::LibcBackend::Query(query),
            },
            request,
        );
        Resolver::request_sent(this, this.vm());

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

    /// A completed `uv_getaddrinfo`, queued as a task (see `on_complete`).
    pub(crate) struct LibuvComplete {
        request: Box<GetAddrInfoRequest>,
        status: c_int,
        result: libuv::UvAddrInfo,
    }

    impl bun_event_loop::ManagedTask::RunOnce for LibuvComplete {
        fn run(self) -> bun_event_loop::JsResult<()> {
            GetAddrInfoRequest::on_libuv_complete(*self.request, self.status, self.result);
            Ok(())
        }

        /// A completion the stop phase cancelled and drained into the queue:
        /// running it is what frees the request and its cache slot, and it only
        /// settles promises (no callback runs; script is forbidden), so run it.
        fn cancelled(self) {
            let _ = self.run();
        }
    }

    impl libuv::GetAddrInfoRequest for GetAddrInfoRequest {
        fn uv_req(&mut self) -> &mut libuv::uv_getaddrinfo_t {
            self.backend.as_libc_uv_mut()
        }

        fn on_complete(this: Box<Self>, status: c_int, result: libuv::UvAddrInfo) {
            // TODO: We schedule a task to run because otherwise the promise will not be solved, we need to investigate this
            let vm = this.head.global_this().bun_vm();
            vm.as_mut()
                .enqueue_task(bun_event_loop::ManagedTask::ManagedTask::new_boxed(
                    Box::new(LibuvComplete {
                        request: this,
                        status,
                        result,
                    }),
                ));
        }
    }

    pub(crate) fn lookup(
        this: ThisPtr<Resolver>,
        query: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let key = PendingCacheKey::init(&query);

        let host_cache =
            Resolver::pending_host_cache(&this, PendingCacheField::PendingHostCacheNative);
        let cache = host_cache.get_or_put(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(Some(this), global_this);
            let promise = dns_lookup.promise.value();
            host_cache.append(inflight, dns_lookup);
            return Ok(promise);
        }

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::uv_uninit()),
            Some(this),
            global_this,
        );

        let hints = query.options.to_libc();
        let mut port_buf = [0u8; 128];
        let port_len = bun_fmt::print_int(&mut port_buf, query.port);
        port_buf[port_len] = 0;
        let port_z = CStr::from_bytes_until_nul(&port_buf).expect("NUL written above");

        // `do_lookup` rejects names of `MAX_PATH_BYTES` or more and names
        // containing NUL, so this always fits and terminates.
        let mut hostname = vec![0u8; query.name.len() + 1];
        hostname[..query.name.len()].copy_from_slice(&query.name);
        let host = CStr::from_bytes_until_nul(&hostname).expect("NUL written above");

        let promise = request.head.promise.value();
        match libuv::getaddrinfo(this.vm().uv_loop(), request, host, port_z, hints.as_ref()) {
            Ok(inflight) => {
                if let CacheHit::New(pos) = cache {
                    host_cache.set_uv_inflight(pos, inflight);
                }
                Ok(promise)
            }
            Err((rc, request)) => {
                // uv_getaddrinfo can fail synchronously before it queues any work
                // (e.g. UV_EINVAL from the 256-byte IDNA buffer for long hostnames,
                // or UV_ENOMEM). Route the error through the same path the async
                // completion would have taken so the pending-cache slot is released
                // and the promise is rejected with a DNSException.
                let request = *request;
                if let (Some(resolver), Some(pos)) = (request.head.resolver(), request.pending_slot)
                {
                    Resolver::drain_pending_host_native(
                        resolver,
                        pos,
                        rc.int(),
                        &GetAddrInfoResultAny::Addrinfo(core::ptr::null_mut()),
                        request.head,
                    );
                    return Ok(promise);
                }
                request.head.process_get_addr_info_native(rc.int());
                Ok(promise)
            }
        }
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
// Pending cache — same-name lookups issued while one is in flight wait on it.
// ──────────────────────────────────────────────────────────────────────────

const PENDING_CACHE_CAPACITY: usize = 32;

/// The identity of a lookup for the pending cache.
pub struct PendingCacheKey {
    hash: u64,
    len: u16,
    name: Box<[u8]>,
}

impl PendingCacheKey {
    pub(crate) fn init(query: &GetAddrInfo) -> Self {
        Self {
            hash: query.hash(),
            len: query.name.len() as u16,
            name: query.name.clone(),
        }
    }

    pub(crate) fn from_name(name: &[u8]) -> Self {
        Self {
            hash: wyhash(name),
            len: name.len() as u16,
            name: Box::<[u8]>::from(name),
        }
    }
}

/// One in-flight lookup other same-name lookups are chained onto until its
/// completion drains the slot.
struct PendingEntry<L> {
    hash: u64,
    len: u16,
    name: Box<[u8]>,
    /// The lookups that joined after the one that owns the slot, in order.
    waiters: Vec<L>,
    /// The in-flight `uv_getaddrinfo` (host-native cache only), so the stop
    /// phase can cancel it. Valid while held: the slot is drained (dropping
    /// this) by the request's completion, before the request is freed.
    #[cfg(windows)]
    uv_inflight: Option<libuv::InflightGetAddrInfo>,
}

/// Up to [`PENDING_CACHE_CAPACITY`] in-flight lookups of one kind, by slot.
pub struct PendingCache<L> {
    slots: JsCell<Vec<Option<PendingEntry<L>>>>,
    /// Bit `i` set ⇔ `slots[i]` is occupied.
    used: Cell<u32>,
}
const _: () = assert!(PENDING_CACHE_CAPACITY <= u32::BITS as usize);

#[derive(Clone, Copy)]
pub enum CacheHit {
    /// A same-name lookup is in flight in this slot; wait on it.
    Inflight(u8),
    /// This lookup now owns the slot.
    New(u8),
    /// The cache is full; run uncached.
    Disabled,
}

impl CacheHit {
    #[inline]
    fn new_slot(self) -> Option<u8> {
        match self {
            CacheHit::New(pos) => Some(pos),
            _ => None,
        }
    }
}

impl<L> PendingCache<L> {
    const fn init() -> Self {
        Self {
            slots: JsCell::new(Vec::new()),
            used: Cell::new(0),
        }
    }

    fn get_or_put(&self, key: &PendingCacheKey) -> CacheHit {
        self.slots.with_mut(|slots| {
            for (i, slot) in slots.iter().enumerate() {
                if let Some(entry) = slot {
                    if entry.hash == key.hash && entry.len == key.len && entry.name == key.name {
                        return CacheHit::Inflight(i as u8);
                    }
                }
            }
            let i = (!self.used.get()).trailing_zeros() as usize;
            if i >= PENDING_CACHE_CAPACITY {
                return CacheHit::Disabled;
            }
            let entry = PendingEntry {
                hash: key.hash,
                len: key.len,
                name: key.name.clone(),
                waiters: Vec::new(),
                #[cfg(windows)]
                uv_inflight: None,
            };
            if i < slots.len() {
                slots[i] = Some(entry);
            } else {
                slots.push(Some(entry));
            }
            self.used.set(self.used.get() | (1 << i));
            CacheHit::New(i as u8)
        })
    }

    fn append(&self, index: u8, waiter: L) {
        self.slots.with_mut(|slots| {
            slots[index as usize]
                .as_mut()
                .expect("pending DNS slot")
                .waiters
                .push(waiter)
        });
    }

    /// Release the slot, returning the lookups that were waiting on it.
    fn take(&self, index: u8) -> Vec<L> {
        self.used.set(self.used.get() & !(1 << index));
        self.slots
            .with_mut(|slots| slots[index as usize].take())
            .expect("pending DNS slot")
            .waiters
    }

    fn any_pending(&self) -> bool {
        self.used.get() != 0
    }

    #[cfg(windows)]
    fn set_uv_inflight(&self, index: u8, inflight: libuv::InflightGetAddrInfo) {
        self.slots.with_mut(|slots| {
            slots[index as usize]
                .as_mut()
                .expect("pending DNS slot")
                .uv_inflight = Some(inflight)
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ResolveInfoRequest<T> — generic c-ares record request (SRV/SOA/TXT/…)
// ──────────────────────────────────────────────────────────────────────────

/// Each c-ares record type implements this with its record-type tag.
pub trait CAresRecordType: Sized + 'static {
    const TYPE_NAME: &'static str;
    /// `"query" + ucfirst(TYPE_NAME)` — each impl carries the precomputed
    /// literal so error paths report the right syscall.
    const SYSCALL: &'static str;
    /// The DNS RR type passed to `ares_query`.
    const NS_TYPE: c_ares::NSType;
    /// The parsed, owned reply.
    type Reply;
    fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, c_ares::Error>;
    fn reply_to_js(
        reply: &Self::Reply,
        global: &JSGlobalObject,
        type_name: &'static str,
    ) -> JsResult<JSValue>;
    /// This record type's pending cache on `resolver`.
    fn pending_cache(resolver: &Resolver) -> &PendingCache<CAresLookup<Self>>;
}

pub(crate) struct ResolveInfoRequest<T: CAresRecordType> {
    /// See [`PendingEntry`]; `None` when the cache was full.
    pending_slot: Option<u8>,
    head: CAresLookup<T>,
}

impl<T: CAresRecordType> ResolveInfoRequest<T> {
    fn init(
        cache: CacheHit,
        resolver: Option<ThisPtr<Resolver>>,
        name: &[u8],
        global_this: &JSGlobalObject,
    ) -> Box<Self> {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Box::new(Self {
            pending_slot: cache.new_slot(),
            head: CAresLookup {
                resolver: resolver.map(RefPtr::from_this),
                global_this: BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                name: Box::<[u8]>::from(name),
                _marker: core::marker::PhantomData,
            },
        })
    }

    fn on_cares_complete(
        self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<T::Reply>,
    ) {
        if let Some(resolver) = self.head.resolver() {
            let resolver = scopeguard::guard(resolver, Resolver::request_completed);
            if let Some(pos) = self.pending_slot {
                Resolver::drain_pending_cares::<T>(
                    *resolver, pos, err_, timeout, result, self.head,
                );
                return;
            }
        }

        self.head.process_resolve(err_, timeout, result.as_ref());
    }
}

impl<T: CAresRecordType> c_ares::QueryHandler for ResolveInfoRequest<T> {
    const LOOKUP_NAME: &'static str = T::TYPE_NAME;
    const NS_TYPE: c_ares::NSType = T::NS_TYPE;
    type Reply = T::Reply;
    fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, c_ares::Error> {
        T::parse(buffer)
    }
    fn on_reply(
        self: Box<Self>,
        status: Option<c_ares::Error>,
        timeouts: i32,
        reply: Option<Self::Reply>,
    ) {
        Self::on_cares_complete(*self, status, timeouts, reply);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetHostByAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct GetHostByAddrInfoRequest {
    /// See [`PendingEntry`].
    pending_slot: Option<u8>,
    head: CAresReverse,
}

impl GetHostByAddrInfoRequest {
    fn init(
        cache: CacheHit,
        resolver: Option<ThisPtr<Resolver>>,
        name: &[u8],
        global_this: &JSGlobalObject,
    ) -> Box<Self> {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Box::new(Self {
            pending_slot: cache.new_slot(),
            head: CAresReverse {
                resolver: resolver.map(RefPtr::from_this),
                global_this: BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                name: Box::<[u8]>::from(name),
            },
        })
    }

    fn on_cares_complete(
        self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<&c_ares::struct_hostent>,
    ) {
        if let (Some(resolver), Some(pos)) = (self.head.resolver(), self.pending_slot) {
            Resolver::drain_pending_addr_cares(resolver, pos, err_, timeout, result, self.head);
            return;
        }

        self.head.process_resolve(err_, timeout, result);
    }
}

impl c_ares::HostentHandler for GetHostByAddrInfoRequest {
    fn on_hostent(
        self: Box<Self>,
        status: Option<c_ares::Error>,
        timeouts: i32,
        hostent: Option<&c_ares::struct_hostent>,
    ) {
        Self::on_cares_complete(*self, status, timeouts, hostent);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresNameInfo
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct CAresNameInfo {
    global_this: BackRef<JSGlobalObject>,
    promise: JSPromiseStrong,
    poll_ref: KeepAlive,
    name: Box<[u8]>,
}

impl CAresNameInfo {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    fn init(global_this: &JSGlobalObject, name: Box<[u8]>) -> Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self {
            global_this: BackRef::new(global_this),
            promise: JSPromiseStrong::init(global_this),
            poll_ref,
            name,
        }
    }

    fn process_resolve(
        mut self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<c_ares::NameInfo<'_>>,
    ) {
        let global_this = self.global_this.get();
        if let Some(err) = err_ {
            error_to_deferred(
                err,
                b"getnameinfo",
                Some(self.name.as_ref()),
                &mut self.promise,
            )
            .reject_later(global_this);
            return;
        }
        let Some(name_info) = result else {
            error_to_deferred(
                c_ares::Error::ENOTFOUND,
                b"getnameinfo",
                Some(self.name.as_ref()),
                &mut self.promise,
            )
            .reject_later(global_this);
            return;
        };
        let array = Outcome::of(
            global_this,
            super::cares_jsc::nameinfo_to_js_response(&name_info, global_this),
        );
        self.on_complete(array);
    }

    fn on_complete(mut self, result: Outcome) {
        let mut promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this();
        result.settle(&mut promise, global_this);
        drop(self);
    }
}

impl Drop for CAresNameInfo {
    fn drop(&mut self) {
        self.poll_ref.unref(js_event_loop_ctx());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetNameInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct GetNameInfoRequest {
    /// The VM-global resolver (pinned for the VM's lifetime, so it outlives
    /// every request).
    resolver_for_caching: Option<BackRef<Resolver, bun_ptr::Mut>>,
    /// See [`PendingEntry`].
    pending_slot: Option<u8>,
    head: CAresNameInfo,
}

impl GetNameInfoRequest {
    fn init(
        cache: CacheHit,
        resolver: Option<ThisPtr<Resolver>>,
        name: Box<[u8]>,
        global_this: &JSGlobalObject,
    ) -> Box<Self> {
        Box::new(Self {
            resolver_for_caching: resolver.map(BackRef::from),
            pending_slot: cache.new_slot(),
            head: CAresNameInfo::init(global_this, name),
        })
    }

    fn on_cares_complete(
        self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::NameInfo<'_>>,
    ) {
        if let Some(resolver) = self.resolver_for_caching {
            let resolver = scopeguard::guard(resolver.this_ptr(), Resolver::request_completed);
            if let Some(pos) = self.pending_slot {
                Resolver::drain_pending_name_info_cares(
                    *resolver, pos, err_, timeout, result, self.head,
                );
                return;
            }
        }

        self.head.process_resolve(err_, timeout, result);
    }
}

impl c_ares::NameInfoHandler for GetNameInfoRequest {
    #[inline]
    fn on_nameinfo(
        self: Box<Self>,
        status: Option<c_ares::Error>,
        timeouts: i32,
        info: Option<c_ares::NameInfo<'_>>,
    ) {
        Self::on_cares_complete(*self, status, timeouts, info);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub struct GetAddrInfoRequest {
    /// Backend state that must live at the request's address (the libuv req,
    /// the dns_sd query); nothing for c-ares / the work pool.
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    pub(crate) backend: get_addr_info_request::Backend,
    /// See [`PendingEntry`].
    pub(crate) pending_slot: Option<u8>,
    pub(crate) head: DNSLookup,
}

pub mod get_addr_info_request {
    use super::*;

    /// The blocking `getaddrinfo` of one libc-backend lookup, run on the pool.
    #[cfg(not(windows))]
    pub struct LibcLookup {
        pub(crate) backend: LibcBackend,
    }

    /// The request a [`LibcLookup`] completes: JS-thread state (promise,
    /// keep-alive, resolver ref) plus the pending-cache slot it owns. Consumed
    /// by the completion; dropped unconsumed only when the VM tears down
    /// first, in which case everything is freed and nothing is settled.
    #[cfg(not(windows))]
    #[derive(bun_jsc::JsAffine)]
    pub struct LibcRequest {
        pub(crate) head: Option<DNSLookup>,
        pub(crate) pending_slot: Option<u8>,
    }
    #[cfg(not(windows))]
    impl Drop for LibcRequest {
        fn drop(&mut self) {
            if let (Some(head), Some(pos)) = (&self.head, self.pending_slot) {
                if let Some(resolver) = head.resolver() {
                    drop(
                        Resolver::pending_host_cache(
                            &resolver,
                            PendingCacheField::PendingHostCacheNative,
                        )
                        .take(pos),
                    );
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
            mut request: LibcRequest,
            cx: &bun_jsc::JsThread<'_>,
        ) -> bun_jsc::JsResult<()> {
            // Consumed here: `then` takes over the request on every path, so
            // the release-on-drop must not run.
            let pending_slot = request.pending_slot.take();
            let head = request.head.take().expect("LibcRequest head");
            let _ = cx;
            super::GetAddrInfoRequest::then(this.backend, head, pending_slot);
            Ok(())
        }
    }

    #[cfg(target_os = "macos")]
    pub struct BackendDnsSd {
        pub(crate) query: JsCell<dns_sd::QueryState>,
    }

    #[cfg(target_os = "macos")]
    impl BackendDnsSd {
        pub(crate) fn new(protocol: dns_sd::DNSServiceProtocol) -> Self {
            Self {
                query: JsCell::new(dns_sd::QueryState::new(protocol)),
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
            let port_z = CStr::from_bytes_until_nul(&port_buf).expect("NUL written above");

            // `do_lookup` rejects names of `MAX_PATH_BYTES` or more and names
            // containing NUL, so this always terminates where expected.
            let mut hostname = Vec::with_capacity(query_name.len() + 1);
            hostname.extend_from_slice(&query_name);
            hostname.push(0);
            let host = CStr::from_bytes_until_nul(&hostname).expect("NUL written above");
            let debug_timer = Output::DebugTimer::start();
            let result = bun_sys::net::AddrInfoList::lookup(
                Some(host),
                if port_len > 0 { Some(port_z) } else { None },
                hints.as_ref(),
            );
            bun_sys::syslog!(
                "getaddrinfo({}, {}) = {} ({})",
                bstr::BStr::new(&query_name),
                bstr::BStr::new(port_z.to_bytes()),
                result.as_ref().err().copied().unwrap_or(0),
                debug_timer,
            );
            *self = match result {
                Ok(Some(list)) => LibcBackend::Success(GetAddrInfoResult::to_list(list.first())),
                Ok(None) => LibcBackend::Err(0),
                Err(err) => LibcBackend::Err(err),
            };
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
        #[cfg(windows)]
        Libc(LibcBackend),
    }

    impl Backend {
        #[cfg(target_os = "macos")]
        pub(crate) fn dns_sd(&self) -> &BackendDnsSd {
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
        resolver: Option<ThisPtr<Resolver>>,
        global_this: &JSGlobalObject,
    ) -> Box<Self> {
        bun_output::scoped_log!(GetAddrInfoRequest, "init");
        Box::new(Self {
            backend,
            pending_slot: cache.new_slot(),
            head: DNSLookup::init_head(resolver, global_this),
        })
    }

    /// Complete a dns_sd-backed request.
    #[cfg(target_os = "macos")]
    pub(crate) fn complete_dns_sd(self) {
        let (results, status) = self.backend.dns_sd().query.with_mut(|query| {
            let results = query.take_results();
            let status = if !results.is_empty() {
                0
            } else {
                query.empty_status()
            };
            (results, status)
        });
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
            GetAddrInfoResultAny::Addrinfo(core::ptr::null_mut())
        };

        if let (Some(resolver), Some(pos)) = (self.head.resolver(), self.pending_slot) {
            Resolver::drain_pending_host_native(resolver, pos, status, &any, self.head);
            return;
        }

        if status != 0 {
            self.head.process_get_addr_info_native(status);
        } else {
            self.head.on_complete_native(&any);
        }
    }

    /// The JS-thread completion of a libc (work-pool) lookup.
    #[cfg(not(windows))]
    pub(crate) fn then(
        backend: get_addr_info_request::LibcBackend,
        head: DNSLookup,
        pending_slot: Option<u8>,
    ) {
        bun_output::scoped_log!(GetAddrInfoRequest, "then");
        match backend {
            get_addr_info_request::LibcBackend::Success(result) => {
                // `ResultAny` impls `Drop` (frees the list) — the by-value drop
                // at the end of whichever callee receives `any`.
                let any = GetAddrInfoResultAny::List(result);
                if let (Some(resolver), Some(pos)) = (head.resolver(), pending_slot) {
                    Resolver::drain_pending_host_native(resolver, pos, 0, &any, head);
                    return;
                }
                head.on_complete_native(&any);
            }
            get_addr_info_request::LibcBackend::Err(err) => {
                if let (Some(resolver), Some(pos)) = (head.resolver(), pending_slot) {
                    Resolver::drain_pending_host_native(
                        resolver,
                        pos,
                        err,
                        &GetAddrInfoResultAny::Addrinfo(core::ptr::null_mut()),
                        head,
                    );
                    return;
                }
                head.process_get_addr_info_native(err);
            }
            get_addr_info_request::LibcBackend::Query(_) => unreachable!(),
        }
    }

    pub(crate) fn on_cares_complete(
        self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::AresBox<c_ares::AddrInfo>>,
    ) {
        bun_output::scoped_log!(GetAddrInfoRequest, "onCaresComplete");
        if let (Some(resolver), Some(pos)) = (self.head.resolver(), self.pending_slot) {
            Resolver::drain_pending_host_cares(resolver, pos, err_, timeout, result, self.head);
            return;
        }

        self.head
            .process_get_addr_info(err_, timeout, result.as_deref());
    }

    #[cfg(windows)]
    pub(crate) fn on_libuv_complete(self, retcode: c_int, result: libuv::UvAddrInfo) {
        bun_output::scoped_log!(GetAddrInfoRequest, "onLibUVComplete: status={}", retcode);

        // libuv re-packs the wide result into a `uv__malloc` block that
        // `UvAddrInfo` frees with `uv_freeaddrinfo`; copy it into an owned
        // `List` now so `ResultAny::Drop` (which calls `ws2_32!freeaddrinfo`)
        // never sees libuv-owned memory.
        let result_any = match result.head() {
            None => GetAddrInfoResultAny::Addrinfo(core::ptr::null_mut()),
            Some(head) => GetAddrInfoResultAny::List(GetAddrInfoResult::to_list(head)),
        };
        drop(result);

        if let (Some(resolver), Some(pos)) = (self.head.resolver(), self.pending_slot) {
            Resolver::drain_pending_host_native(resolver, pos, retcode, &result_any, self.head);
            return;
        }

        if c_ares::Error::init_eai(retcode).is_some() {
            self.head.process_get_addr_info_native(retcode);
        } else {
            self.head.on_complete_native(&result_any);
        }
    }
}

impl c_ares::AddrInfoHandler for GetAddrInfoRequest {
    fn on_addr_info(
        self: Box<Self>,
        status: Option<c_ares::Error>,
        timeouts: i32,
        result: Option<c_ares::AresBox<c_ares::AddrInfo>>,
    ) {
        Self::on_cares_complete(*self, status, timeouts, result);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresReverse
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct CAresReverse {
    /// Keeps the resolver alive for the lookup; released in `Drop`.
    resolver: Option<RefPtr<Resolver>>,
    global_this: BackRef<JSGlobalObject>,
    promise: JSPromiseStrong,
    poll_ref: KeepAlive,
    name: Box<[u8]>,
}

impl CAresReverse {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    #[inline]
    fn resolver(&self) -> Option<ThisPtr<Resolver>> {
        self.resolver.as_ref().map(RefPtr::this_ptr)
    }

    fn init(
        resolver: Option<ThisPtr<Resolver>>,
        global_this: &JSGlobalObject,
        name: &[u8],
    ) -> Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self {
            resolver: resolver.map(RefPtr::from_this),
            global_this: BackRef::new(global_this),
            promise: JSPromiseStrong::init(global_this),
            poll_ref,
            name: Box::<[u8]>::from(name),
        }
    }

    fn process_resolve(
        mut self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<&c_ares::struct_hostent>,
    ) {
        let global_this = self.global_this.get();
        if let Some(err) = err_ {
            error_to_deferred(err, b"getHostByAddr", Some(&self.name), &mut self.promise)
                .reject_later(global_this);
            return;
        }
        let Some(node) = result else {
            error_to_deferred(
                c_ares::Error::ENOTFOUND,
                b"getHostByAddr",
                Some(&self.name),
                &mut self.promise,
            )
            .reject_later(global_this);
            return;
        };
        let array = Outcome::of(
            global_this,
            super::cares_jsc::hostent_to_js_response(node, global_this, b""),
        );
        self.on_complete(array);
    }

    fn on_complete(mut self, result: Outcome) {
        let mut promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this();
        result.settle(&mut promise, global_this);
        if let Some(resolver) = self.resolver() {
            Resolver::request_completed(resolver);
        }
        drop(self);
    }
}

impl Drop for CAresReverse {
    fn drop(&mut self) {
        self.poll_ref.unref(js_event_loop_ctx());
        if let Some(resolver) = self.resolver.take() {
            resolver.deref();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresLookup<T>
// ──────────────────────────────────────────────────────────────────────────

pub struct CAresLookup<T: CAresRecordType> {
    /// Keeps the resolver alive for the lookup; released in `Drop`.
    resolver: Option<RefPtr<Resolver>>,
    global_this: BackRef<JSGlobalObject>,
    promise: JSPromiseStrong,
    poll_ref: KeepAlive,
    name: Box<[u8]>,
    _marker: core::marker::PhantomData<T>,
}

impl<T: CAresRecordType> CAresLookup<T> {
    fn init(
        resolver: Option<ThisPtr<Resolver>>,
        global_this: &JSGlobalObject,
        name: &[u8],
    ) -> Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self {
            resolver: resolver.map(RefPtr::from_this),
            global_this: BackRef::new(global_this),
            promise: JSPromiseStrong::init(global_this),
            poll_ref,
            name: Box::<[u8]>::from(name),
            _marker: core::marker::PhantomData,
        }
    }

    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    #[inline]
    fn resolver(&self) -> Option<ThisPtr<Resolver>> {
        self.resolver.as_ref().map(RefPtr::this_ptr)
    }

    fn process_resolve(
        mut self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<&T::Reply>,
    ) {
        // syscall = "query" + ucfirst(TYPE_NAME); each `CAresRecordType` impl
        // carries the precomputed literal.
        let syscall = T::SYSCALL; // e.g. "querySrv"

        let global_this = self.global_this.get();
        if let Some(err) = err_ {
            error_to_deferred(err, syscall.as_bytes(), Some(&self.name), &mut self.promise)
                .reject_later(global_this);
            return;
        }
        let Some(node) = result else {
            error_to_deferred(
                c_ares::Error::ENOTFOUND,
                syscall.as_bytes(),
                Some(&self.name),
                &mut self.promise,
            )
            .reject_later(global_this);
            return;
        };

        let array = Outcome::of(global_this, T::reply_to_js(node, global_this, T::TYPE_NAME));
        self.on_complete(array);
    }

    fn on_complete(mut self, result: Outcome) {
        let mut promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this();
        result.settle(&mut promise, global_this);
        if let Some(resolver) = self.resolver() {
            Resolver::request_completed(resolver);
        }
        drop(self);
    }
}

impl<T: CAresRecordType> Drop for CAresLookup<T> {
    fn drop(&mut self) {
        self.poll_ref.unref(js_event_loop_ctx());
        if let Some(resolver) = self.resolver.take() {
            resolver.deref();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DNSLookup
// ──────────────────────────────────────────────────────────────────────────

#[derive(bun_jsc::JsAffine)]
pub struct DNSLookup {
    /// Keeps the resolver alive for the lookup (and names the resolver whose
    /// pending cache the owning request sits in); released in `Drop`.
    resolver: Option<RefPtr<Resolver>>,
    global_this: BackRef<JSGlobalObject>,
    promise: JSPromiseStrong,
    poll_ref: KeepAlive,
}

impl DNSLookup {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    #[inline]
    fn resolver(&self) -> Option<ThisPtr<Resolver>> {
        self.resolver.as_ref().map(RefPtr::this_ptr)
    }

    /// A lookup joining an in-flight request.
    fn init(resolver: Option<ThisPtr<Resolver>>, global_this: &JSGlobalObject) -> Self {
        bun_output::scoped_log!(DNSLookup, "init");
        Self::init_head(resolver, global_this)
    }

    /// The lookup embedded in a request.
    fn init_head(resolver: Option<ThisPtr<Resolver>>, global_this: &JSGlobalObject) -> Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self {
            resolver: resolver.map(RefPtr::from_this),
            global_this: BackRef::new(global_this),
            poll_ref,
            promise: JSPromiseStrong::init(global_this),
        }
    }

    fn on_complete_native(self, result: &GetAddrInfoResultAny) {
        bun_output::scoped_log!(DNSLookup, "onCompleteNative");
        let global = self.global_this();
        // A null addrinfo with no error is an empty answer.
        let array = super::options_jsc::result_any_to_js(result, global)
            .and_then(|a| a.map_or_else(|| JSValue::create_empty_array(global, 0), Ok));
        let outcome = Outcome::of(global, array);
        self.on_complete_with_array(outcome);
    }

    fn process_get_addr_info_native(mut self, status: i32) {
        bun_output::scoped_log!(DNSLookup, "processGetAddrInfoNative: status={}", status);
        if let Some(err) = c_ares::Error::init_eai(status) {
            error_to_deferred(err, b"getaddrinfo", None, &mut self.promise)
                .reject_later(self.global_this());
            return;
        }
        self.on_complete_native(&GetAddrInfoResultAny::Addrinfo(core::ptr::null_mut()))
    }

    fn process_get_addr_info(
        mut self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<&c_ares::AddrInfo>,
    ) {
        bun_output::scoped_log!(DNSLookup, "processGetAddrInfo");
        let global_this = self.global_this.get();
        if let Some(err) = err_ {
            error_to_deferred(err, b"getaddrinfo", None, &mut self.promise)
                .reject_later(global_this);
            return;
        }

        let Some(r) = result.filter(|r| !r.is_empty()) else {
            error_to_deferred(
                c_ares::Error::ENOTFOUND,
                b"getaddrinfo",
                None,
                &mut self.promise,
            )
            .reject_later(global_this);
            return;
        };
        self.on_complete(r);
    }

    fn on_complete(self, result: &c_ares::AddrInfo) {
        bun_output::scoped_log!(DNSLookup, "onComplete");
        let global = self.global_this();
        let array = super::cares_jsc::addr_info_to_js_array(result, global);
        let outcome = Outcome::of(global, array);
        self.on_complete_with_array(outcome);
    }

    fn on_complete_with_array(mut self, result: Outcome) {
        bun_output::scoped_log!(DNSLookup, "onCompleteWithArray");
        let mut promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this();
        result.settle(&mut promise, global_this);
        if let Some(resolver) = self.resolver() {
            Resolver::request_completed(resolver);
        }
        drop(self);
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

    /// The resolver backends' completion callbacks (c-ares poll, dns_sd,
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
        // DNSLookup is always created on the JS event loop (it holds a JSGlobalObject),
        // so the Js-arm vtable is the correct EventLoopCtx for KeepAlive::unref.
        self.poll_ref.unref(Async::posix_event_loop::get_vm_ctx(
            Async::AllocatorType::Js,
        ));
        if let Some(resolver) = self.resolver.take() {
            resolver.deref();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GlobalData
// ──────────────────────────────────────────────────────────────────────────

pub struct GlobalData {
    pub(crate) resolver: RefPtr<Resolver>,
}

impl GlobalData {
    pub(crate) fn init(vm: &VirtualMachine) -> Box<Self> {
        Box::new(Self {
            resolver: RefPtr::new(Resolver::setup(vm)),
        })
    }
}

impl Drop for GlobalData {
    fn drop(&mut self) {
        // Tear the channel down now (its pending queries fail into their
        // callbacks and release their refs) rather than whenever the last ref
        // goes; then release ours.
        self.resolver.destroy_channel();
        self.resolver.deref();
    }
}

impl Resolver {
    /// Windows: `uv_getaddrinfo` requests are uv *requests* on this thread's
    /// loop, which the teardown drains before closing the loop; cancel the ones
    /// still in flight so that drain is prompt (each completes through its
    /// callback with UV_ECANCELED against the still-live VM).
    #[cfg(windows)]
    pub(crate) fn cancel_pending_uv_requests_for_teardown(&self) {
        for entry in self.pending_host_cache_native.slots.get().iter().flatten() {
            if let Some(inflight) = &entry.uv_inflight {
                inflight.cancel();
            }
        }
    }

    /// Worker-terminate / main-VM-destruct hook: tear down the c-ares channel
    /// while the JSC VM, `RareData.file_polls`, event loop, and `runtime_state`
    /// are all still live. `ares_destroy()` synchronously fires every pending
    /// query callback with `ARES_EDESTRUCTION` and then the socket-state
    /// callback for each fd it closes; those callback chains dereference
    /// `DNSLookup::global_this` (to enqueue the rejection task) and the
    /// `FilePoll` (to unregister it from the loop). Running this after either
    /// is freed is a UAF (Node `test-worker-dns-terminate.js`).
    ///
    /// `Stopped` if a channel was open (its pending queries just failed with
    /// `ARES_EDESTRUCTION` into their callbacks). The resolver may be gone by
    /// the time this returns (a failing query can drop the last reference).
    pub(crate) fn close_channel_for_terminate(
        this: ThisPtr<Self>,
    ) -> bun_jsc::virtual_machine::SweepResult {
        use bun_jsc::virtual_machine::SweepResult;
        // Failing the pending queries releases their refs on this resolver from
        // inside `ares_destroy`; hold one so it outlives its own channel close.
        let _guard = this.ref_guard();
        let result = if this.destroy_channel() {
            SweepResult::Stopped
        } else {
            SweepResult::Idle
        };
        // `GetAddrInfoRequest`'s EDESTRUCTION path does not call
        // `request_completed()`, so the c-ares timeout timer (and its +1 ref on
        // this resolver plus the uws active-handle bump) can still be linked.
        Self::remove_timer(this);
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// internal — process-wide DNS cache used by usockets connect path
// ──────────────────────────────────────────────────────────────────────────

pub mod internal {
    use super::*;
    use core::sync::atomic::{AtomicBool, AtomicU32};

    use bun_uws::ConnectingSocket;
    use bun_uws_sys::addrinfo::{
        AddrInfoResult, DnsWaitingSocket, addrinfo_result, addrinfo_result_entry,
    };

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
        pub(crate) host: Option<&'a [u8]>,
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
                (Some(a), Some(b)) => a.as_bytes() == b,
                (None, None) => true,
                _ => false,
            }
        }
    }

    impl<'a> RequestKey<'a> {
        pub(crate) fn init(name: Option<&'a [u8]>, port: u16) -> Self {
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

        fn generate_hash(name: &[u8]) -> u64 {
            wyhash(name)
        }

        pub(crate) fn to_owned(&self) -> RequestKeyOwned {
            RequestKeyOwned {
                host: self.host.map(bun::ZBox::from_bytes),
                hash: self.hash,
                port: self.port,
            }
        }
    }

    /// The dns_sd query state of a connect-path lookup. Only the thread whose
    /// `SharedConnection` issued the query touches it (from the reply callback
    /// and completion), until `dns_sd_complete` publishes the result.
    #[cfg(target_os = "macos")]
    pub struct MacAsyncDNS {
        pub(crate) query: JsCell<dns_sd::QueryState>,
    }

    #[cfg(target_os = "macos")]
    impl Default for MacAsyncDNS {
        fn default() -> Self {
            Self {
                query: JsCell::new(dns_sd::QueryState::new(0)),
            }
        }
    }

    /// One cached lookup. usockets, the QUIC client and the work pool all hold
    /// it by address (`ThisPtr` / `BackRef`); the cache owns it and frees it
    /// only once `refcount` is back to zero.
    pub struct Request {
        pub(crate) key: RequestKeyOwned,
        /// Set once, under the cache lock, when the lookup finishes; read
        /// lock-free by usockets after it has been notified.
        result: std::sync::OnceLock<AddrInfoResult>,
        /// Who to notify when `result` lands; guarded by the cache lock (this
        /// lock is only ever taken under it).
        notify: bun_threading::Guarded<Vec<DNSRequestOwner>>,
        /// number of sockets that have a reference to result or are waiting for the result
        /// while this is non-zero, this entry cannot be freed
        refcount: AtomicU32,
        /// Seconds since the epoch when this request was created.
        /// Not a precise timestamp.
        pub(crate) created_at: u32,
        valid: AtomicBool,
        #[cfg(target_os = "macos")]
        pub(crate) dns_sd: MacAsyncDNS,
    }

    impl Request {
        pub(crate) fn new(
            key: RequestKeyOwned,
            refcount: u32,
            created_at: u32,
        ) -> bun_ptr::OwnedThis<Self> {
            bun_ptr::OwnedThis::new(Self {
                key,
                result: std::sync::OnceLock::new(),
                notify: bun_threading::Guarded::new(Vec::new()),
                refcount: AtomicU32::new(refcount),
                created_at,
                valid: AtomicBool::new(true),
                #[cfg(target_os = "macos")]
                dns_sd: MacAsyncDNS::default(),
            })
        }

        #[inline]
        fn refcount(&self) -> u32 {
            self.refcount.load(Ordering::Relaxed)
        }

        #[inline]
        fn is_valid(&self) -> bool {
            self.valid.load(Ordering::Relaxed)
        }

        #[inline]
        pub(crate) fn has_result(&self) -> bool {
            self.result.get().is_some()
        }

        pub(crate) fn is_expired(&self, timestamp_to_store: &mut u32) -> bool {
            if !self.has_result() {
                return false;
            }

            let now = if *timestamp_to_store == 0 {
                GlobalCache::get_cache_timestamp()
            } else {
                *timestamp_to_store
            };
            *timestamp_to_store = now;

            if now.saturating_sub(self.created_at) > get_max_dns_time_to_live_seconds() {
                self.valid.store(false, Ordering::Relaxed);
                return true;
            }

            false
        }
    }

    impl Drop for Request {
        fn drop(&mut self) {
            debug_assert!(self.notify.lock().is_empty());
        }
    }

    // ───────────── GlobalCache ─────────────

    const MAX_ENTRIES: usize = 256;

    /// The cache data guarded by `GLOBAL_CACHE`; the lock owns the data
    /// (PORTING.md §Concurrency).
    struct GlobalCache {
        cache: Vec<bun_ptr::OwnedThis<Request>>,
        /// Requests handed out while the cache had no room for them; freed
        /// like cached ones once their last holder lets go.
        orphans: Vec<bun_ptr::OwnedThis<Request>>,
    }

    impl GlobalCache {
        const fn new() -> Self {
            Self {
                cache: Vec::new(),
                orphans: Vec::new(),
            }
        }

        #[inline]
        fn len(&self) -> usize {
            self.cache.len()
        }

        fn get(
            &mut self,
            key: &RequestKey<'_>,
            timestamp_to_store: &mut u32,
        ) -> Option<ThisPtr<Request>> {
            let mut i: usize = 0;
            while i < self.cache.len() {
                let entry = &self.cache[i];
                if entry.key.matches(key) && entry.is_valid() {
                    if entry.is_expired(timestamp_to_store) {
                        bun_output::scoped_log!(dns, "get: expired entry");
                        if entry.refcount() == 0 {
                            let len = self.cache.len();
                            self.delete_entry_at(len, i);
                        }
                        // An expired entry that is still referenced is now
                        // invalid, so the next pass over `i` skips it.
                        continue;
                    }
                    return Some(entry.this_ptr());
                }
                i += 1;
            }
            None
        }

        // To preserve memory, we use a 32 bit timestamp
        // However, we're almost out of time to use 32 bit timestamps for anything
        // So we set the epoch to January 1st, 2024 instead.
        pub(super) fn get_cache_timestamp() -> u32 {
            (bun::Timespec::now(bun::TimespecMockMode::AllowMockedTime).ms_unsigned() / 1000) as u32
        }

        fn is_nearly_full(&self) -> bool {
            // 80% full (value is kind of arbitrary)
            // Caller already holds GLOBAL_CACHE; no atomic load needed.
            self.cache.len() * 5 >= MAX_ENTRIES * 4
        }

        /// Free entry `i` of `len` (swap-remove).
        fn delete_entry_at(&mut self, len: usize, i: usize) {
            DNS_CACHE_SIZE.store(len - 1, Ordering::Relaxed);
            drop(self.cache.swap_remove(i));
        }

        /// Free `entry` (a cached request or an orphan).
        fn remove(&mut self, entry: ThisPtr<Request>) {
            let is =
                |e: &bun_ptr::OwnedThis<Request>| core::ptr::eq(&raw const **e, entry.as_ptr());
            if let Some(i) = self.cache.iter().position(is) {
                let len = self.cache.len();
                self.delete_entry_at(len, i);
            } else if let Some(i) = self.orphans.iter().position(is) {
                drop(self.orphans.swap_remove(i));
            }
        }

        /// Cache `entry` (evicting an idle one if full); hands it back if
        /// there was no room.
        fn try_push(
            &mut self,
            entry: bun_ptr::OwnedThis<Request>,
        ) -> Result<(), bun_ptr::OwnedThis<Request>> {
            // is the cache full?
            if self.cache.len() >= MAX_ENTRIES {
                // check if there is an element to evict
                for e in self.cache.iter_mut() {
                    if e.refcount() == 0 {
                        *e = entry;
                        return Ok(());
                    }
                }
                Err(entry)
            } else {
                // just append to the end
                self.cache.push(entry);
                Ok(())
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

    pub enum DNSRequestOwner {
        Socket(DnsWaitingSocket),
        Prefetch,
        Quic(bun_http::H3::DnsPendingConnect),
    }

    impl DNSRequestOwner {
        pub(crate) fn notify_threadsafe(self, req: ThisPtr<Request>) {
            match self {
                DNSRequestOwner::Socket(socket) => socket.notify_threadsafe(),
                DNSRequestOwner::Prefetch => freeaddrinfo(req, 0),
                DNSRequestOwner::Quic(pc) => pc.notify_threadsafe(),
            }
        }
    }

    /// Register `pc` to be notified when `request` resolves. Mirrors
    /// us_getaddrinfo_set but for the QUIC client's connect path, which has
    /// no us_connecting_socket_t to hang the callback on. The .quic notify
    /// path frees the addrinfo request inline (via Bun__addrinfo_freeRequest),
    /// which re-acquires global_cache.lock — so drop it before notifying.
    pub(crate) fn register_quic(request: ThisPtr<Request>, pc: Box<bun_http::H3::PendingConnect>) {
        let guard = global_cache().lock();
        if request.has_result() {
            drop(guard);
            pc.on_dns_resolved_now();
            return;
        }
        request
            .notify
            .lock()
            .push(DNSRequestOwner::Quic(bun_http::H3::DnsPendingConnect::new(
                pc,
            )));
        drop(guard);
    }

    /// The `ai_family`/`ai_socktype`/`ai_addrlen` header for a synthesized
    /// result entry.
    fn synthetic_addrinfo(family: c_int) -> AddrInfo {
        let mut n: AddrInfo = bun_core::ffi::zeroed();
        n.ai_family = family;
        n.ai_socktype = netc::SOCK_STREAM;
        n.ai_addrlen = if family == netc::AF_INET6 {
            core::mem::size_of::<netc::sockaddr_in6>() as _
        } else {
            core::mem::size_of::<netc::sockaddr_in>() as _
        };
        n
    }

    // Pack getaddrinfo results into one allocation with address families
    // interleaved (RFC 8305 §4) so an unroutable family can never fill all
    // CONCURRENT_CONNECTIONS parallel connect attempts. See #4938 / #33278.
    fn process_results(
        nodes: impl Iterator<Item = (AddrInfo, Option<SockaddrStorage>)> + Clone,
        err: c_int,
    ) -> AddrInfoResult {
        let first_family = nodes
            .clone()
            .next()
            .map_or(netc::AF_UNSPEC, |(info, _)| info.ai_family);
        let is_first = move |info: &AddrInfo| info.ai_family == first_family;
        let count = nodes.clone().count();
        let entry = |(info, addr): (AddrInfo, Option<SockaddrStorage>)| {
            // Windows getaddrinfo may return non-null ai_addr with families other
            // than AF_INET/AF_INET6; those entries keep a (zeroed) `addr`.
            let addr = addr.map(|a| {
                if info.ai_family == netc::AF_INET || info.ai_family == netc::AF_INET6 {
                    a
                } else {
                    bun_core::ffi::zeroed()
                }
            });
            addrinfo_result_entry::new(info, addr.as_ref())
        };

        // first, other, first, other, … then whatever is left of the longer run.
        let mut firsts = nodes.clone().filter(move |(info, _)| is_first(info));
        let mut others = nodes.filter(move |(info, _)| !is_first(info));
        let mut results: Vec<addrinfo_result_entry> = Vec::with_capacity(count);
        loop {
            match (firsts.next(), others.next()) {
                (None, None) => break,
                (first, other) => {
                    results.extend(first.map(entry));
                    results.extend(other.map(entry));
                }
            }
        }
        AddrInfoResult::new(results, err)
    }

    fn after_result(
        req: ThisPtr<Request>,
        result: Result<Option<bun_sys::net::AddrInfoList>, c_int>,
    ) {
        let result = match result {
            Ok(Some(list)) => process_results(
                list.iter()
                    .map(|e| (*e.raw(), e.address().map(bun_dns::Address::into_storage))),
                0,
            ),
            Ok(None) => AddrInfoResult::new(Vec::new(), 0),
            Err(err) => AddrInfoResult::new(Vec::new(), err),
        };
        after_result_entries(req, result);
    }

    fn after_result_entries(req: ThisPtr<Request>, result: AddrInfoResult) {
        let guard = global_cache().lock();

        let notify = {
            let _ = req.result.set(result);
            let notify = core::mem::take(&mut *req.notify.lock());
            req.refcount.fetch_sub(1, Ordering::Relaxed);
            notify
        };

        // is this correct, or should it go after the loop?
        drop(guard);

        for query in notify {
            query.notify_threadsafe(req);
        }
    }

    fn work_pool_callback(req: BackRef<Request, bun_ptr::Mut>) {
        let mut service_buf = [0u8; 21];
        let port = req.key.port;
        let service: Option<&CStr> = if port > 0 {
            Some(bun_fmt::itoa_z(&mut service_buf, port as u64))
        } else {
            None
        };
        let host: Option<&CStr> = req.key.host.as_deref().map(c_str);

        #[cfg(windows)]
        let result = {
            use bun_sys::windows::ws2_32 as wsa;
            let mut wsa_hints: AddrInfo = bun_core::ffi::zeroed();
            wsa_hints.ai_family = wsa::AF_UNSPEC;
            wsa_hints.ai_socktype = wsa::SOCK_STREAM;
            bun_sys::net::AddrInfoList::lookup(host, service, Some(&wsa_hints))
        };
        #[cfg(not(windows))]
        let result = {
            let mut hints = get_hints();
            let mut result = bun_sys::net::AddrInfoList::lookup(host, service, Some(&hints));
            // optional fallback
            if result.as_ref().err() == Some(&netc::EAI_NONAME)
                && (hints.ai_flags & netc::AI_ADDRCONFIG) != 0
            {
                hints.ai_flags &= !netc::AI_ADDRCONFIG;
                result = bun_sys::net::AddrInfoList::lookup(host, service, Some(&hints));
            }
            result
        };
        after_result(req.this_ptr(), result);
    }

    #[cfg(target_os = "macos")]
    fn lookup_dns_sd(req: ThisPtr<Request>, ctx: Async::EventLoopCtx) -> bool {
        let Some(host) = req.key.host.as_ref() else {
            // Null host: fall through to getaddrinfo(NULL, service) on the work pool.
            return false;
        };
        let Some(shared) = dns_sd::SharedConnection::get(ctx) else {
            return false;
        };

        let protocol = dns_sd::protocol_for_hints(&get_hints());
        req.dns_sd.query.set(dns_sd::QueryState::new(protocol));
        shared
            .start(
                dns_sd::InflightRequest::Internal(BackRef::from(req)),
                protocol,
                c_str(host),
            )
            .is_some()
    }

    #[cfg(target_os = "macos")]
    impl bun_sys::dns_sd::GetAddrInfoReply for Request {
        fn on_reply(&self, reply: &bun_sys::dns_sd::Reply<'_>) {
            dns_sd::SharedConnection::note_reply(core::ptr::from_ref(self).cast());
            self.dns_sd.query.with_mut(|q| q.record_reply(reply));
        }
    }

    /// Complete an internal request: build an addrinfo chain and reuse `process_results` (happy-eyeballs order).
    #[cfg(target_os = "macos")]
    pub(super) fn dns_sd_complete(req: BackRef<Request, bun_ptr::Mut>) {
        let (results, empty_status) = req
            .dns_sd
            .query
            .with_mut(|query| (query.take_results(), query.empty_status()));
        let port = req.key.port;
        let req = req.this_ptr();

        if results.is_empty() {
            after_result_entries(req, AddrInfoResult::new(Vec::new(), empty_status));
            return;
        }

        let nodes = results.iter().map(|r| {
            let mut address = r.address;
            address.set_port(port);
            (
                synthetic_addrinfo(address.family()),
                Some(address.into_storage()),
            )
        });
        after_result_entries(req, process_results(nodes, 0));
    }

    static DNS_CACHE_HITS_COMPLETED: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_HITS_INFLIGHT: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_SIZE: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_MISSES: AtomicUsize = AtomicUsize::new(0);
    static DNS_CACHE_ERRORS: AtomicUsize = AtomicUsize::new(0);
    static GETADDRINFO_CALLS: AtomicUsize = AtomicUsize::new(0);

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

    /// `bun:internal-for-testing`: seed the connect-path DNS cache for `hostname`
    /// by running `addresses` through the real [`process_results`] interleave and
    /// storing the result, so a real `fetch()` / `Bun.connect()` consumes it.
    pub(crate) fn seed_cache_for_testing(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = frame.arguments();
        if args.len() < 2 || !args[0].is_string() || !args[1].is_array() {
            return Err(global.throw_invalid_arguments(format_args!(
                "expected (hostname: string, addresses: string[])"
            )));
        }
        let hostname_slice = args[0].to_slice(global)?;
        let len = args[1].get_length(global)? as usize;
        if len == 0 || len > 64 {
            return Err(
                global.throw_invalid_arguments(format_args!("addresses must have 1..=64 entries"))
            );
        }

        let mut nodes: Vec<(AddrInfo, Option<SockaddrStorage>)> = Vec::with_capacity(len);
        for i in 0..len {
            let addr_slice = args[1].get_index(global, i as u32)?.to_slice(global)?;
            let addr_z = bun::ZBox::from_bytes(addr_slice.slice());
            let mut octets = [0u8; 16];
            let ip: std::net::IpAddr =
                if c_ares::inet_pton(netc::AF_INET, c_str(&addr_z), &mut octets) > 0 {
                    std::net::Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]).into()
                } else if c_ares::inet_pton(netc::AF_INET6, c_str(&addr_z), &mut octets) > 0 {
                    std::net::Ipv6Addr::from(octets).into()
                } else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "addresses[{i}] is not an IPv4 or IPv6 literal"
                    )));
                };
            let address = bun_dns::Address::from_ip(ip, 0);
            nodes.push((
                synthetic_addrinfo(address.family()),
                Some(address.into_storage()),
            ));
        }

        let results = process_results(nodes.iter().copied(), 0);

        let out = JSValue::create_empty_array(global, results.entries().len())?;
        for (i, entry) in (0u32..).zip(results.entries().iter()) {
            let fam: i32 = if entry.info.ai_family == netc::AF_INET6 {
                6
            } else {
                4
            };
            out.put_index(global, i, JSValue::js_number_from_int32(fam))?;
        }

        let key = RequestKey::init(Some(hostname_slice.slice()), 0);
        let req = Request::new(key.to_owned(), 0, GlobalCache::get_cache_timestamp());
        let _ = req.result.set(results);
        let mut guard = global_cache().lock();
        if let Err(req) = guard.try_push(req) {
            drop(guard);
            drop(req);
            return Err(global.throw_invalid_arguments(format_args!("DNS cache is full")));
        }
        DNS_CACHE_SIZE.store(guard.len(), Ordering::Relaxed);
        drop(guard);
        Ok(out)
    }

    pub(crate) fn getaddrinfo(
        loop_: &Loop,
        host: Option<&[u8]>,
        port: u16,
        is_cache_hit: Option<&mut bool>,
    ) -> Option<ThisPtr<Request>> {
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

                entry.refcount.fetch_add(1, Ordering::Relaxed);

                if entry.has_result() {
                    *is_cache_hit.unwrap() = true;
                    bun_output::scoped_log!(
                        dns,
                        "getaddrinfo({}) = cache hit",
                        bstr::BStr::new(host.unwrap_or(b""))
                    );
                    DNS_CACHE_HITS_COMPLETED.fetch_add(1, Ordering::Relaxed);
                } else {
                    bun_output::scoped_log!(
                        dns,
                        "getaddrinfo({}) = cache hit (inflight)",
                        bstr::BStr::new(host.unwrap_or(b""))
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
        let handle = req.this_ptr();
        if let Err(orphan) = guard.try_push(req) {
            guard.orphans.push(orphan);
        }
        let req = handle;
        DNS_CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
        DNS_CACHE_SIZE.store(guard.len(), Ordering::Relaxed);
        drop(guard);

        #[cfg(target_os = "macos")]
        {
            use bun_uws::InternalLoopDataExt as _;
            if !env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO
                .get()
                .unwrap_or(false)
            {
                // The loop's parent tag (set by `EventLoopHandle::set_as_parent_of`
                // at startup) says which of this thread's event loops owns it.
                let (tag, _) = loop_.internal_loop_data.get_parent();
                let ctx = match tag {
                    1 => Some(Async::posix_event_loop::get_vm_ctx(
                        Async::AllocatorType::Js,
                    )),
                    2 => Some(Async::posix_event_loop::get_vm_ctx(
                        Async::AllocatorType::Mini,
                    )),
                    _ => None,
                };
                if let Some(ctx) = ctx {
                    if lookup_dns_sd(req, ctx) {
                        bun_output::scoped_log!(
                            dns,
                            "getaddrinfo({}) = cache miss (dns_sd)",
                            bstr::BStr::new(host.unwrap_or(b""))
                        );
                        return Some(req);
                    }
                }
                // if dns_sd was unavailable, fall back to the work pool
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = loop_;

        bun_output::scoped_log!(
            dns,
            "getaddrinfo({}) = cache miss (libc)",
            bstr::BStr::new(host.unwrap_or(b""))
        );
        // schedule the request to be executed on the work pool
        run_on_work_pool(BackRef::from(req));
        Some(req)
    }

    /// getaddrinfo() on the work pool; the result reaches every waiter through
    /// the global cache, whichever thread asked. Also how a lookup whose
    /// per-thread mDNSResponder connection went away with its thread is
    /// finished (see `SharedConnection::close_for_terminate`). The request's
    /// in-flight `refcount` keeps it alive until `after_result`.
    pub(super) fn run_on_work_pool(req: BackRef<Request, bun_ptr::Mut>) {
        let _ = bun_threading::work_pool::WorkPool::go(req, work_pool_callback);
    }

    pub(crate) fn prefetch_from_js(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();

        if arguments.is_empty() {
            return Err(global_this.throw_not_enough_arguments("prefetch", 1, arguments.len()));
        }

        let hostname_or_url = arguments[0];

        let hostname_slice = if hostname_or_url.is_string() {
            hostname_or_url.to_slice(global_this)?
        } else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("hostname must be a string"))
            );
        };

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

        prefetch(
            VirtualMachine::get().uws_loop_mut(),
            Some(hostname_slice.slice()),
            port,
        );
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn prefetch(loop_: &Loop, hostname: Option<&[u8]>, port: u16) {
        let _ = getaddrinfo(loop_, hostname, port, None);
    }

    pub(crate) fn us_getaddrinfo(
        loop_: &Loop,
        host: Option<&CStr>,
        port: u16,
        request: &mut *mut c_void,
    ) -> c_int {
        let mut is_cache_hit = false;
        let req = getaddrinfo(
            loop_,
            host.map(CStr::to_bytes),
            port,
            Some(&mut is_cache_hit),
        )
        .unwrap();
        *request = req.as_ptr().cast::<c_void>();
        if is_cache_hit { 0 } else { 1 }
    }

    pub(crate) fn us_getaddrinfo_set(request: ThisPtr<Request>, socket: &ConnectingSocket) {
        let _guard = global_cache().lock();
        if request.has_result() {
            bun_uws_sys::addrinfo::dns_ready(socket);
            return;
        }
        // usockets keeps `socket` alive until it is notified or withdraws
        // itself with `Bun__addrinfo_cancel`.
        request
            .notify
            .lock()
            .push(DNSRequestOwner::Socket(DnsWaitingSocket::new(
                BackRef::new(socket),
            )));
    }

    pub(crate) fn us_getaddrinfo_cancel(
        request: ThisPtr<Request>,
        socket: &ConnectingSocket,
    ) -> c_int {
        let _guard = global_cache().lock();
        // afterResult sets result and moves the notify list out under this same
        // lock, so once result is non-null the socket is no longer cancellable
        // (the callback has fired or is about to fire on the worker thread).
        if request.has_result() {
            return 0;
        }
        let mut notify = request.notify.lock();
        for (i, item) in notify.iter().enumerate() {
            match item {
                DNSRequestOwner::Socket(s) if s.is(socket) => {
                    notify.swap_remove(i);
                    return 1;
                }
                _ => {}
            }
        }
        0
    }

    pub(crate) fn freeaddrinfo(req: ThisPtr<Request>, err: c_int) {
        let mut guard = global_cache().lock();

        if err != 0 {
            req.valid.store(false, Ordering::Relaxed);
        }
        DNS_CACHE_ERRORS.fetch_add((err != 0) as usize, Ordering::Relaxed);

        debug_assert!(req.refcount() > 0);
        let remaining = req.refcount.fetch_sub(1, Ordering::Relaxed) - 1;
        if remaining == 0 && (guard.is_nearly_full() || !req.is_valid()) {
            bun_output::scoped_log!(dns, "cache --");
            guard.remove(req);
        }
    }

    pub(crate) fn get_request_result(req: ThisPtr<Request>) -> *const addrinfo_result {
        // usockets only asks after it was notified, i.e. once `result` is set.
        core::ptr::from_ref(req.get().result.get().expect("addrinfo result").as_c())
    }
}

pub use internal::Request as InternalDNSRequest;

// ──────────────────────────────────────────────────────────────────────────
// Resolver — JSC-exposed `dns.Resolver` (m_ctx payload of JSDNSResolver)
// ──────────────────────────────────────────────────────────────────────────

/// Which of the two `GetAddrInfo` pending caches a request sits in.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PendingCacheField {
    PendingHostCacheCares,
    PendingHostCacheNative,
}

// ──────────────────────────────────────────────────────────────────────────
// CAresRecordType impls — each (struct, tag) pair is modeled as a
// trait impl. ns/ptr/cname share `struct_hostent` and a/aaaa share
// `hostent_with_ttls`, so those get marker types to keep the per-record
// monomorphizations (and pending caches) distinct.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! impl_cares_record_type {
    (
        $ty:ty, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident,
        $to_js:path
    ) => {
        impl CAresRecordType for $ty {
            const TYPE_NAME: &'static str = $tag;
            const SYSCALL: &'static str = $syscall;
            const NS_TYPE: c_ares::NSType = c_ares::NSType::$ns_type;
            type Reply = c_ares::AresBox<$ty>;
            fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, c_ares::Error> {
                <$ty as c_ares::AresReply>::parse(buffer)
            }
            fn reply_to_js(
                reply: &Self::Reply,
                global: &JSGlobalObject,
                type_name: &'static str,
            ) -> JsResult<JSValue> {
                $to_js(reply, global, type_name.as_bytes())
            }
            fn pending_cache(resolver: &Resolver) -> &PendingCache<CAresLookup<Self>> {
                &resolver.$field
            }
        }
    };
}

impl_cares_record_type!(
    c_ares::struct_ares_srv_reply,
    "srv",
    "querySrv",
    pending_srv_cache_cares,
    ns_t_srv,
    super::cares_jsc::srv_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_soa_reply,
    "soa",
    "querySoa",
    pending_soa_cache_cares,
    ns_t_soa,
    super::cares_jsc::soa_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_txt_reply,
    "txt",
    "queryTxt",
    pending_txt_cache_cares,
    ns_t_txt,
    super::cares_jsc::txt_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_naptr_reply,
    "naptr",
    "queryNaptr",
    pending_naptr_cache_cares,
    ns_t_naptr,
    super::cares_jsc::naptr_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_mx_reply,
    "mx",
    "queryMx",
    pending_mx_cache_cares,
    ns_t_mx,
    super::cares_jsc::mx_reply_to_js_response
);
impl_cares_record_type!(
    c_ares::struct_ares_caa_reply,
    "caa",
    "queryCaa",
    pending_caa_cache_cares,
    ns_t_caa,
    super::cares_jsc::caa_reply_to_js_response
);

impl CAresRecordType for c_ares::struct_any_reply {
    const TYPE_NAME: &'static str = "any";
    const SYSCALL: &'static str = "queryAny";
    const NS_TYPE: c_ares::NSType = c_ares::NSType::ns_t_any;
    type Reply = Box<c_ares::struct_any_reply>;
    fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, c_ares::Error> {
        c_ares::struct_any_reply::parse(buffer).map(Some)
    }
    fn reply_to_js(
        reply: &Self::Reply,
        global: &JSGlobalObject,
        type_name: &'static str,
    ) -> JsResult<JSValue> {
        super::cares_jsc::any_reply_to_js_response(reply, global, type_name.as_bytes())
    }
    fn pending_cache(resolver: &Resolver) -> &PendingCache<CAresLookup<Self>> {
        &resolver.pending_any_cache_cares
    }
}

/// Marker for a record type answered with a plain `struct_hostent`.
macro_rules! hostent_record {
    ($name:ident, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident, $parse:ident) => {
        pub struct $name;
        impl CAresRecordType for $name {
            const TYPE_NAME: &'static str = $tag;
            const SYSCALL: &'static str = $syscall;
            const NS_TYPE: c_ares::NSType = c_ares::NSType::$ns_type;
            type Reply = c_ares::AresBox<c_ares::struct_hostent>;
            fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, c_ares::Error> {
                c_ares::struct_hostent::$parse(buffer)
            }
            fn reply_to_js(
                reply: &Self::Reply,
                global: &JSGlobalObject,
                type_name: &'static str,
            ) -> JsResult<JSValue> {
                super::cares_jsc::hostent_to_js_response(reply, global, type_name.as_bytes())
            }
            fn pending_cache(resolver: &Resolver) -> &PendingCache<CAresLookup<Self>> {
                &resolver.$field
            }
        }
    };
}

/// Marker for A/AAAA, answered with a `hostent_with_ttls`.
macro_rules! hostent_ttls_record {
    ($name:ident, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident, $parse:ident) => {
        pub struct $name;
        impl CAresRecordType for $name {
            const TYPE_NAME: &'static str = $tag;
            const SYSCALL: &'static str = $syscall;
            const NS_TYPE: c_ares::NSType = c_ares::NSType::$ns_type;
            type Reply = Box<c_ares::hostent_with_ttls>;
            fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, c_ares::Error> {
                c_ares::hostent_with_ttls::$parse(buffer).map(Some)
            }
            fn reply_to_js(
                reply: &Self::Reply,
                global: &JSGlobalObject,
                type_name: &'static str,
            ) -> JsResult<JSValue> {
                super::cares_jsc::hostent_with_ttls_to_js_response(
                    reply,
                    global,
                    type_name.as_bytes(),
                )
            }
            fn pending_cache(resolver: &Resolver) -> &PendingCache<CAresLookup<Self>> {
                &resolver.$field
            }
        }
    };
}

hostent_record!(
    NsHostent,
    "ns",
    "queryNs",
    pending_ns_cache_cares,
    ns_t_ns,
    parse_ns
);
hostent_record!(
    PtrHostent,
    "ptr",
    "queryPtr",
    pending_ptr_cache_cares,
    ns_t_ptr,
    parse_ptr
);
hostent_record!(
    CnameHostent,
    "cname",
    "queryCname",
    pending_cname_cache_cares,
    ns_t_cname,
    parse_cname
);
hostent_ttls_record!(
    AHostentWithTtls,
    "a",
    "queryA",
    pending_a_cache_cares,
    ns_t_a,
    parse_a
);
hostent_ttls_record!(
    AaaaHostentWithTtls,
    "aaaa",
    "queryAaaa",
    pending_aaaa_cache_cares,
    ns_t_aaaa,
    parse_aaaa
);

/// The c-ares socket's poll: a `FilePoll` (kqueue/epoll) or, on Windows, a
/// libuv `uv_poll_t`.
#[cfg(windows)]
type PollType = libuv::SocketPoll<UvDnsPoll>;
#[cfg(not(windows))]
type PollType = OwnedFilePoll;

type PollsMap = ArrayHashMap<c_ares::ares_socket_t, PollType>;

/// Intrusively refcounted: the JS wrapper, every in-flight lookup and the
/// armed timer each hold a ref. Methods take `ThisPtr<Self>` / `&self` with
/// per-field interior mutability because c-ares completion callbacks re-enter
/// the resolver (`request_completed`, `drain_pending_*`, releasing refs) from
/// inside `on_dns_poll` / `check_timeouts`.
#[bun_jsc::JsClass(name = "DNSResolver", no_constructor)]
#[derive(bun_ptr::RefCounted)]
pub struct Resolver {
    pub(crate) ref_count: bun_ptr::RefCount<Resolver>,
    pub(crate) channel: JsCell<Option<c_ares::OwnedChannel>>,
    pub(crate) vm: BackRef<VirtualMachine>,
    pub(crate) polls: JsCell<PollsMap>,
    pub(crate) options: Cell<c_ares::ChannelOptions>,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    /// The ref the armed `event_loop_timer` holds on this resolver; released
    /// when it fires (`check_timeouts`) or is removed (`remove_timer`).
    timer_ref: Cell<Option<RefPtr<Resolver>>>,

    pub(crate) pending_host_cache_cares: PendingCache<DNSLookup>,
    pub(crate) pending_host_cache_native: PendingCache<DNSLookup>,
    pub(crate) pending_srv_cache_cares: PendingCache<CAresLookup<c_ares::struct_ares_srv_reply>>,
    pub(crate) pending_soa_cache_cares: PendingCache<CAresLookup<c_ares::struct_ares_soa_reply>>,
    pub(crate) pending_txt_cache_cares: PendingCache<CAresLookup<c_ares::struct_ares_txt_reply>>,
    pub(crate) pending_naptr_cache_cares:
        PendingCache<CAresLookup<c_ares::struct_ares_naptr_reply>>,
    pub(crate) pending_mx_cache_cares: PendingCache<CAresLookup<c_ares::struct_ares_mx_reply>>,
    pub(crate) pending_caa_cache_cares: PendingCache<CAresLookup<c_ares::struct_ares_caa_reply>>,
    pub(crate) pending_ns_cache_cares: PendingCache<CAresLookup<NsHostent>>,
    pub(crate) pending_ptr_cache_cares: PendingCache<CAresLookup<PtrHostent>>,
    pub(crate) pending_cname_cache_cares: PendingCache<CAresLookup<CnameHostent>>,
    pub(crate) pending_a_cache_cares: PendingCache<CAresLookup<AHostentWithTtls>>,
    pub(crate) pending_aaaa_cache_cares: PendingCache<CAresLookup<AaaaHostentWithTtls>>,
    pub(crate) pending_any_cache_cares: PendingCache<CAresLookup<c_ares::struct_any_reply>>,
    pub(crate) pending_addr_cache_cares: PendingCache<CAresReverse>,
    pub(crate) pending_nameinfo_cache_cares: PendingCache<CAresNameInfo>,
}

bun_event_loop::impl_timer_owner!(Resolver; from_timer_ptr => event_loop_timer);

impl Drop for Resolver {
    /// Last ref gone: close the channel (its pending queries fail into their
    /// callbacks, its socket-state callbacks unregister the polls) before the
    /// fields go.
    fn drop(&mut self) {
        self.destroy_channel();
    }
}

/// Owner data of the libuv poll on one c-ares socket (Windows).
#[cfg(windows)]
pub(crate) struct UvDnsPoll {
    /// The resolver whose `polls` map owns this poll (so outlives it).
    parent: BackRef<Resolver, bun_ptr::Mut>,
    socket: c_ares::ares_socket_t,
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
        bun_jsc::bun_string_jsc::create_utf8_for_js(
            global_this,
            <&'static str>::from(self).as_bytes(),
        )
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
        b"NS" => RecordType::NS, b"PTR" => RecordType::PTR, b"SOA" => RecordType::SOA,
        b"SRV" => RecordType::SRV, b"TXT" => RecordType::TXT,
        b"a" => RecordType::A, b"aaaa" => RecordType::AAAA, b"any" => RecordType::ANY,
        b"caa" => RecordType::CAA, b"cname" => RecordType::CNAME, b"mx" => RecordType::MX,
        b"ns" => RecordType::NS, b"ptr" => RecordType::PTR, b"soa" => RecordType::SOA,
        b"srv" => RecordType::SRV, b"txt" => RecordType::TXT,
    };
}

impl RecordType {
    pub(crate) const DEFAULT: Self = RecordType::A;
}

impl Resolver {
    pub(crate) fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    pub(crate) fn setup(vm: &VirtualMachine) -> Self {
        Self {
            ref_count: bun_ptr::RefCount::init(),
            channel: JsCell::new(None),
            vm: BackRef::new(vm),
            polls: JsCell::new(PollsMap::new()),
            options: Cell::new(c_ares::ChannelOptions::default()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::DNSResolver,
            )),
            timer_ref: Cell::new(None),
            pending_host_cache_cares: PendingCache::init(),
            pending_host_cache_native: PendingCache::init(),
            pending_srv_cache_cares: PendingCache::init(),
            pending_soa_cache_cares: PendingCache::init(),
            pending_txt_cache_cares: PendingCache::init(),
            pending_naptr_cache_cares: PendingCache::init(),
            pending_mx_cache_cares: PendingCache::init(),
            pending_caa_cache_cares: PendingCache::init(),
            pending_ns_cache_cares: PendingCache::init(),
            pending_ptr_cache_cares: PendingCache::init(),
            pending_cname_cache_cares: PendingCache::init(),
            pending_a_cache_cares: PendingCache::init(),
            pending_aaaa_cache_cares: PendingCache::init(),
            pending_any_cache_cares: PendingCache::init(),
            pending_addr_cache_cares: PendingCache::init(),
            pending_nameinfo_cache_cares: PendingCache::init(),
        }
    }

    // ───────────── timer / pending bookkeeping ─────────────

    pub(crate) fn check_timeouts(this: ThisPtr<Self>, now: &ElTimespec, vm: &VirtualMachine) {
        // Caller (`dispatch.rs::fire_timer`) hands us the event-loop's
        // local `ElTimespec`; `add_timer` works in `bun_core::timespec`. Same
        // `{ sec: i64, nsec: i64 }` layout — convert field-by-field.
        let now = bun::timespec {
            sec: now.sec,
            nsec: now.nsec,
        };
        let uws_loop = vm.uws_loop();
        // The ref `add_timer` took for this firing; released on the way out
        // (after a possible re-arm has taken its own).
        let _release = scopeguard::guard(this.timer_ref.take(), move |timer_ref| {
            timer_all_mut().increment_timer_ref(-1, uws_loop);
            if let Some(timer_ref) = timer_ref {
                timer_ref.deref();
            }
        });

        this.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::PENDING);

        if let Ok(channel) = Self::get_channel_or_error(&this, vm.global()) {
            if this.any_requests_pending() {
                channel.process(c_ares::ARES_SOCKET_BAD, false, false);
                // See `on_dns_poll` — c-ares detaches post-callback, so re-check.
                if this.any_requests_pending() {
                    let _ = Self::add_timer(this, Some(&now));
                } else {
                    Self::remove_timer(this);
                }
            }
        }
    }

    fn any_requests_pending(&self) -> bool {
        // Rust has no field reflection; keep this list in sync with
        // `Resolver`'s `pending_*` fields.
        macro_rules! check { ($($f:ident),*) => { $( if self.$f.any_pending() { return true; } )* } }
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
        // The 32-slot caches overflow to `CacheHit::Disabled`; c-ares' own
        // queue length covers those too. Its channel lock is recursive, so this
        // is safe from inside a completion callback.
        if let Some(channel) = self.channel.get().as_deref() {
            if channel.active_queries() != 0 {
                return true;
            }
        }
        false
    }

    fn request_sent(this: ThisPtr<Self>, _vm: &VirtualMachine) {
        let _ = Self::add_timer(this, None);
    }

    fn request_completed(this: ThisPtr<Self>) {
        if this.any_requests_pending() {
            let _ = Self::add_timer(this, None);
        } else {
            Self::remove_timer(this);
        }
    }

    fn add_timer(this: ThisPtr<Self>, now: Option<&bun::timespec>) -> bool {
        if this.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            return false;
        }

        this.timer_ref.set(Some(RefPtr::from_this(this)));
        let now_ts = now
            .copied()
            .unwrap_or_else(|| bun::timespec::now(bun::TimespecMockMode::ForceRealTime));
        let next = now_ts.add_ms(1000);
        // `EventLoopTimer.next` uses the event-loop crate's local
        // `Timespec` (distinct from `bun_core::Timespec`); convert by field.
        this.event_loop_timer.with_mut(|t| {
            t.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            }
        });
        let uws_loop = this.vm().uws_loop();
        timer_all_mut().increment_timer_ref(1, uws_loop);
        timer_all_mut().insert(this.event_loop_timer.as_ptr());
        true
    }

    fn remove_timer(this: ThisPtr<Self>) {
        if this.event_loop_timer.get().state != EventLoopTimerState::ACTIVE {
            return;
        }

        timer_all_mut().remove(this.event_loop_timer.as_ptr());
        // Normally checkTimeouts does this, so we have to be sure to do it ourself if we cancel the timer
        let uws_loop = this.vm().uws_loop();
        timer_all_mut().increment_timer_ref(-1, uws_loop);
        // Every caller holds at least one other ref for the duration of this
        // call (a lookup's `RefPtr`, a `ref_guard`, or the global-resolver
        // pin), so this is never the last.
        if let Some(timer_ref) = this.timer_ref.take() {
            timer_ref.deref();
        }
    }

    // ───────────── pending-cache helpers ─────────────

    /// The `GetAddrInfo` pending cache `field` names.
    fn pending_host_cache(&self, field: PendingCacheField) -> &PendingCache<DNSLookup> {
        match field {
            PendingCacheField::PendingHostCacheCares => &self.pending_host_cache_cares,
            PendingCacheField::PendingHostCacheNative => &self.pending_host_cache_native,
        }
    }

    pub(crate) fn drain_pending_cares<T: CAresRecordType>(
        this: ThisPtr<Self>,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<T::Reply>,
        head: CAresLookup<T>,
    ) {
        let _g = this.ref_guard();

        let waiters = T::pending_cache(&this).take(index);

        let Some(addr) = result else {
            head.process_resolve(err, timeout, None);
            for waiter in waiters {
                waiter.process_resolve(err, timeout, None);
            }
            return;
        };

        let mut prev_global = head.global_this;
        let mut array = Outcome::of(
            &prev_global,
            T::reply_to_js(&addr, &prev_global, T::TYPE_NAME),
        );
        keep_alive(&array);
        head.on_complete(array);

        keep_alive(&array);

        for waiter in waiters {
            let new_global = waiter.global_this;
            if prev_global != new_global {
                array = Outcome::of(
                    &new_global,
                    T::reply_to_js(&addr, &new_global, T::TYPE_NAME),
                );
                prev_global = new_global;
            }

            keep_alive(&array);
            waiter.on_complete(array);
            keep_alive(&array);
        }
    }

    pub(crate) fn drain_pending_host_cares(
        this: ThisPtr<Self>,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::AresBox<c_ares::AddrInfo>>,
        head: DNSLookup,
    ) {
        let waiters = this
            .pending_host_cache(PendingCacheField::PendingHostCacheCares)
            .take(index);

        let _g = this.ref_guard();

        let Some(addr) = result else {
            head.process_get_addr_info(err, timeout, None);
            for waiter in waiters {
                waiter.process_get_addr_info(err, timeout, None);
            }
            return;
        };

        let mut prev_global = head.global_this;
        let mut array = Outcome::of(
            &prev_global,
            super::cares_jsc::addr_info_to_js_array(&addr, &prev_global),
        );
        keep_alive(&array);
        head.on_complete_with_array(array);

        keep_alive(&array);

        for waiter in waiters {
            let new_global = waiter.global_this;
            if prev_global != new_global {
                array = Outcome::of(
                    &new_global,
                    super::cares_jsc::addr_info_to_js_array(&addr, &new_global),
                );
                prev_global = new_global;
            }

            keep_alive(&array);
            waiter.on_complete_with_array(array);
            keep_alive(&array);
        }
        // `addr` (the c-ares `ares_addrinfo`) is freed once, after all consumers ran.
    }

    pub(crate) fn drain_pending_host_native(
        this: ThisPtr<Self>,
        index: u8,
        err: i32,
        result: &GetAddrInfoResultAny,
        head: DNSLookup,
    ) {
        bun_output::scoped_log!(DNSResolver, "drainPendingHostNative");
        let global_object = head.global_this;
        let waiters = this
            .pending_host_cache(PendingCacheField::PendingHostCacheNative)
            .take(index);

        let _g = this.ref_guard();

        let mut array: Outcome =
            match super::options_jsc::result_any_to_js(result, &global_object).transpose() {
                Some(a) => Outcome::of(&global_object, a),
                None => {
                    head.process_get_addr_info_native(err);
                    for waiter in waiters {
                        waiter.process_get_addr_info_native(err);
                    }
                    return;
                }
            };
        let mut prev_global = head.global_this;

        {
            keep_alive(&array);
            head.on_complete_with_array(array);
            keep_alive(&array);
        }

        for waiter in waiters {
            let new_global = waiter.global_this;
            if prev_global != new_global {
                // Non-null addrinfo (checked above): never `None`.
                array = Outcome::of(
                    &new_global,
                    super::options_jsc::result_any_to_js(result, &new_global)
                        .map(|a| a.expect("addrinfo present")),
                );
                prev_global = new_global;
            }

            keep_alive(&array);
            waiter.on_complete_with_array(array);
            keep_alive(&array);
        }
    }

    pub(crate) fn drain_pending_addr_cares(
        this: ThisPtr<Self>,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<&c_ares::struct_hostent>,
        head: CAresReverse,
    ) {
        let waiters = this.pending_addr_cache_cares.take(index);

        let _g = this.ref_guard();

        let Some(addr) = result else {
            head.process_resolve(err, timeout, None);
            for waiter in waiters {
                waiter.process_resolve(err, timeout, None);
            }
            return;
        };

        let mut prev_global = head.global_this;
        //  The callback need not and should not attempt to free the memory
        //  pointed to by hostent; the ares library will free it when the
        //  callback returns.
        let mut array = Outcome::of(
            &prev_global,
            super::cares_jsc::hostent_to_js_response(addr, &prev_global, b""),
        );
        keep_alive(&array);
        head.on_complete(array);

        keep_alive(&array);

        for waiter in waiters {
            let new_global = waiter.global_this;
            if prev_global != new_global {
                array = Outcome::of(
                    &new_global,
                    super::cares_jsc::hostent_to_js_response(addr, &new_global, b""),
                );
                prev_global = new_global;
            }

            keep_alive(&array);
            waiter.on_complete(array);
            keep_alive(&array);
        }
    }

    pub(crate) fn drain_pending_name_info_cares(
        this: ThisPtr<Self>,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::NameInfo<'_>>,
        head: CAresNameInfo,
    ) {
        let waiters = this.pending_nameinfo_cache_cares.take(index);

        let _g = this.ref_guard();

        let Some(name_info) = result else {
            head.process_resolve(err, timeout, None);
            for waiter in waiters {
                waiter.process_resolve(err, timeout, None);
            }
            return;
        };

        let mut prev_global = head.global_this;

        let mut array = Outcome::of(
            &prev_global,
            super::cares_jsc::nameinfo_to_js_response(&name_info, &prev_global),
        );
        keep_alive(&array);
        head.on_complete(array);

        keep_alive(&array);

        for waiter in waiters {
            let new_global = waiter.global_this;
            if prev_global != new_global {
                array = Outcome::of(
                    &new_global,
                    super::cares_jsc::nameinfo_to_js_response(&name_info, &new_global),
                );
                prev_global = new_global;
            }

            keep_alive(&array);
            waiter.on_complete(array);
            keep_alive(&array);
        }
    }

    /// This resolver's c-ares channel, created on first use.
    pub(crate) fn get_channel<'a>(
        this: &'a ThisPtr<Self>,
    ) -> Result<&'a c_ares::Channel, c_ares::Error> {
        if this.channel.get().is_none() {
            let channel = c_ares::Channel::init(*this, this.options.get())?;
            this.channel.set(Some(channel));
            // A live channel has sockets, timers and queries in flight whose
            // callbacks need this VM: the stop phase closes it (any resolver,
            // not just the VM-global one) if nobody did before. Unregistered in
            // `destroy_channel`.
            crate::jsc_hooks::ActiveHandle::DnsResolver(core::ptr::NonNull::from(*this)).register();
        }
        Ok(this.channel.get().as_deref().expect("channel set above"))
    }

    fn get_channel_from_vm(global_this: &JSGlobalObject) -> JsResult<ThisPtr<Self>> {
        let resolver = global_resolver(global_this);
        Self::get_channel_or_error(&resolver, global_this)?;
        Ok(resolver)
    }

    pub(crate) fn get_channel_or_error<'a>(
        this: &'a ThisPtr<Self>,
        global_this: &JSGlobalObject,
    ) -> JsResult<&'a c_ares::Channel> {
        Self::get_channel(this).map_err(|err| {
            let system_error = SystemError {
                errno: -1,
                code: bun_core::String::static_(err.code()),
                message: bun_core::String::static_(err.label()),
                ..Default::default()
            };
            global_this.throw_value(system_error.to_error_instance(global_this))
        })
    }

    // ───────────── poll callbacks ─────────────

    /// POSIX `FilePoll` callback (kqueue/epoll) for the c-ares socket `fd`.
    /// Windows drives c-ares via libuv (`UvDnsPoll::on_poll`) instead.
    ///
    /// `Channel::process` (== `ares_process_fd`) synchronously fires c-ares
    /// completion callbacks which re-enter this Resolver (`request_completed`,
    /// `drain_pending_*`, releasing refs).
    #[cfg(not(windows))]
    pub(crate) fn on_dns_poll(
        this: ThisPtr<Self>,
        fd: c_ares::ares_socket_t,
        readable: bool,
        writable: bool,
    ) {
        let vm = this.vm();
        let _exit = vm.enter_event_loop_scope();
        if this.channel.get().is_none() {
            drop(this.polls.with_mut(|p| p.remove(&fd)));
            return;
        }

        let _guard = this.ref_guard();

        if let Some(channel) = this.channel.get().as_deref() {
            channel.process(fd, readable, writable);
        }

        // c-ares detaches a query only *after* its callback returns, so
        // `request_completed` may have seen it still counted; re-check now.
        if !this.any_requests_pending() {
            Self::remove_timer(this);
        }
    }

    #[cfg(windows)]
    fn on_dns_socket_state(
        this: ThisPtr<Self>,
        fd: c_ares::ares_socket_t,
        readable: bool,
        writable: bool,
    ) {
        if !readable && !writable {
            // cleanup — dropping the poll `uv_close`s it; libuv frees it in
            // the close callback.
            drop(this.polls.with_mut(|p| p.remove(&fd)));
            return;
        }

        let uv_loop = this.vm().uv_loop();
        this.polls.with_mut(|polls| {
            if !polls.contains(&fd) {
                let data = UvDnsPoll {
                    parent: BackRef::from(this),
                    socket: fd,
                };
                let Ok(poll) = libuv::SocketPoll::init(uv_loop, fd as libuv::uv_os_sock_t, data)
                else {
                    return;
                };
                bun_core::handle_oom(polls.put(fd, poll));
            }
            let poll = polls.get(&fd).expect("inserted above");

            let uv_events = (if readable { libuv::UV_READABLE } else { 0 })
                | (if writable { libuv::UV_WRITABLE } else { 0 });
            if poll.start(uv_events) < 0 {
                // Dropping the poll is the required `uv_close` teardown.
                let _ = polls.swap_remove(&fd);
            }
        });
    }

    #[cfg(not(windows))]
    fn on_dns_socket_state(
        this: ThisPtr<Self>,
        fd: c_ares::ares_socket_t,
        readable: bool,
        writable: bool,
    ) {
        let ctx = js_event_loop_ctx();

        if !readable && !writable {
            // read == 0 and write == 0 this is c-ares's way of notifying us that
            // the socket is now closed. We must free the data associated with
            // socket.
            drop(this.polls.with_mut(|p| p.remove(&fd)));
            return;
        }

        let owner = Async::Owner::new(
            Async::posix_event_loop::poll_tag::DNS_RESOLVER,
            this.as_ptr().cast::<()>(),
        );
        // The `&mut PollsMap` borrow does not span any re-entrant call
        // (`FilePoll::register` is a syscall wrapper).
        this.polls.with_mut(|polls| {
            if !polls.contains(&fd) {
                let poll = OwnedFilePoll::new(
                    ctx,
                    bun_sys::Fd::from_native(fd),
                    Default::default(),
                    owner,
                );
                bun_core::handle_oom(polls.put(fd, poll));
            }
            let poll = polls.get_mut(&fd).expect("inserted above");

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
                let _ = poll.unregister_on(ctx, false);
                if readable {
                    let _ = poll.register_on(ctx, Async::PollKind::Readable, false);
                }
                if writable {
                    let _ = poll.register_on(ctx, Async::PollKind::Writable, false);
                }
            } else {
                // Only adding directions (or no change). register() issues a
                // single CTL_MOD on epoll that preserves the other direction;
                // on kqueue EV_ADD creates a separate (ident, filter) knote
                // without disturbing the existing one.
                if readable && !have_readable {
                    let _ = poll.register_on(ctx, Async::PollKind::Readable, false);
                }
                if writable && !have_writable {
                    let _ = poll.register_on(ctx, Async::PollKind::Writable, false);
                }
            }
        });
    }

    // ───────────── JS host fns: resolve* family ─────────────

    pub fn global_resolve(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::resolve(global_resolver(global_this), global_this, callframe)
    }

    #[host_fn(method)]
    pub fn resolve(
        this: ThisPtr<Self>,
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
                            Some("one of: A, AAAA, ANY, CAA, CNAME, MX, NS, PTR, SOA, SRV, TXT"),
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
            RecordType::A => {
                Self::do_resolve_cares::<AHostentWithTtls>(this, name.slice(), global_this)
            }
            RecordType::AAAA => {
                Self::do_resolve_cares::<AaaaHostentWithTtls>(this, name.slice(), global_this)
            }
            RecordType::ANY => {
                Self::do_resolve_cares::<c_ares::struct_any_reply>(this, name.slice(), global_this)
            }
            RecordType::CAA => Self::do_resolve_cares::<c_ares::struct_ares_caa_reply>(
                this,
                name.slice(),
                global_this,
            ),
            RecordType::CNAME => {
                Self::do_resolve_cares::<CnameHostent>(this, name.slice(), global_this)
            }
            RecordType::MX => Self::do_resolve_cares::<c_ares::struct_ares_mx_reply>(
                this,
                name.slice(),
                global_this,
            ),
            RecordType::NS => Self::do_resolve_cares::<NsHostent>(this, name.slice(), global_this),
            RecordType::PTR => {
                Self::do_resolve_cares::<PtrHostent>(this, name.slice(), global_this)
            }
            RecordType::SOA => Self::do_resolve_cares::<c_ares::struct_ares_soa_reply>(
                this,
                name.slice(),
                global_this,
            ),
            RecordType::SRV => Self::do_resolve_cares::<c_ares::struct_ares_srv_reply>(
                this,
                name.slice(),
                global_this,
            ),
            RecordType::TXT => Self::do_resolve_cares::<c_ares::struct_ares_txt_reply>(
                this,
                name.slice(),
                global_this,
            ),
        }
    }

    pub fn global_reverse(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::reverse(global_resolver(global_this), global_this, callframe)
    }

    #[host_fn(method)]
    pub fn reverse(
        this: ThisPtr<Self>,
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
        let channel = match Self::get_channel(&this) {
            Ok(res) => res,
            Err(err) => {
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

        let key = PendingCacheKey::from_name(ip);
        let cache = this.pending_addr_cache_cares.get_or_put(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let cares_reverse = CAresReverse::init(Some(this), global_this, ip);
            let promise = cares_reverse.promise.value();
            this.pending_addr_cache_cares
                .append(inflight, cares_reverse);
            return Ok(promise);
        }

        let request = GetHostByAddrInfoRequest::init(cache, Some(this), ip, global_this);

        let promise = request.head.promise.value();
        channel.get_host_by_addr(ip, request);

        Self::request_sent(this, global_this.bun_vm());
        Ok(promise)
    }

    pub fn global_lookup(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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

        Self::do_lookup(resolver, name.slice(), port, options, global_this)
    }

    pub(crate) fn do_lookup(
        this: ThisPtr<Self>,
        name: &[u8],
        port: u16,
        options: GetAddrInfoOptions,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // The system backends copy the hostname into a NUL-terminated buffer.
        // Reject anything that cannot fit a `bun.PathBuffer` (the historical
        // bound) or embeds a NUL. RFC 1035 caps hostnames at 253 octets and
        // NI_MAXHOST is 1025, so this never rejects a name that could have
        // resolved.
        if name.len() >= MAX_PATH_BYTES || strings::contains_char(name, 0) {
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
                Self::c_ares_lookup_with_normalized_name(this, &query, global_this)?
            }
            GetAddrInfoBackend::Libc => {
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(this, query, global_this)?
                }
                #[cfg(not(windows))]
                {
                    lib_c::lookup(this, &query, global_this)
                }
            }
            GetAddrInfoBackend::System => {
                #[cfg(target_os = "macos")]
                {
                    dns_sd::lookup(this, &query, global_this)
                }
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(this, query, global_this)?
                }
                #[cfg(all(not(target_os = "macos"), not(windows)))]
                {
                    lib_c::lookup(this, &query, global_this)
                }
            }
        })
    }

    // ───────── per-record-type global+instance resolve fns ─────────
    // These are mechanically identical across record types.
}

macro_rules! resolve_record_fn {
    ($global:ident, $method:ident, $jsname:literal, $ty:ty, $allow_empty:expr) => {
        pub fn $global(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
            Self::$method(global_resolver(global_this), global_this, callframe)
        }

        #[host_fn(method)]
        pub fn $method(
            this: ThisPtr<Self>,
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
            Self::do_resolve_cares::<$ty>(this, name.slice(), global_this)
        }
    };
}

// `c_ares::Channel::init` reports socket-state changes here.
impl c_ares::ChannelOwner for Resolver {
    #[inline]
    fn on_socket_state(
        this: ThisPtr<Self>,
        socket: c_ares::ares_socket_t,
        readable: bool,
        writable: bool,
    ) {
        Resolver::on_dns_socket_state(this, socket, readable, writable);
    }
}

#[cfg(windows)]
impl libuv::SocketPollHandler for UvDnsPoll {
    fn on_poll(data: &Self, status: c_int, events: c_int) {
        let parent = data.parent.this_ptr();
        let socket = data.socket;
        let vm = parent.vm.get();
        let _exit = vm.enter_event_loop_scope();
        // Kept alive across `Channel::process` (which re-enters and may
        // release refs) by the guard.
        let _guard = parent.ref_guard();
        // channel must be non-null here as c_ares must have been initialized if we're receiving callbacks
        let channel = parent.channel.get().as_deref().expect("c-ares channel");
        if status < 0 {
            // an error occurred. just pretend that the socket is both readable and writable.
            // https://github.com/nodejs/node/blob/8a41d9b636be86350cd32847c3f89d327c4f6ff7/src/cares_wrap.cc#L93
            channel.process(socket, true, true);
        } else {
            channel.process(
                socket,
                events & libuv::UV_READABLE != 0,
                events & libuv::UV_WRITABLE != 0,
            );
        }

        // See `on_dns_poll` for why this re-check follows `ares_process_fd`.
        if !parent.any_requests_pending() {
            Resolver::remove_timer(parent);
        }
    }
}

impl Resolver {
    /// The one place a channel is torn down: `ares_destroy` fails every
    /// pending query with `ARES_EDESTRUCTION` into its callback (releasing the
    /// request's ref on this resolver) and closes the channel's sockets.
    /// Returns whether there was a channel.
    fn destroy_channel(&self) -> bool {
        let Some(channel) = self.channel.replace(None) else {
            return false;
        };
        crate::jsc_hooks::ActiveHandle::DnsResolver(core::ptr::NonNull::from(self)).unregister();
        drop(channel);
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
        this: ThisPtr<Self>,
        name: &[u8],
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel = match Self::get_channel(&this) {
            Ok(res) => res,
            Err(err) => {
                return Err(
                    global_this.throw_value(super::cares_jsc::error_to_js_with_syscall(
                        err,
                        global_this,
                        T::SYSCALL.as_bytes(),
                    )?),
                );
            }
        };

        let key = PendingCacheKey::from_name(name);

        let pending = T::pending_cache(&this);
        let cache = pending.get_or_put(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let cares_lookup = CAresLookup::<T>::init(Some(this), global_this, name);
            let promise = cares_lookup.promise.value();
            pending.append(inflight, cares_lookup);
            return Ok(promise);
        }

        let request = ResolveInfoRequest::<T>::init(cache, Some(this), name, global_this);
        let promise = request.head.promise.value();

        channel.query(name, request);

        Self::request_sent(this, global_this.bun_vm());
        Ok(promise)
    }

    pub(crate) fn c_ares_lookup_with_normalized_name(
        this: ThisPtr<Self>,
        query: &GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel = match Self::get_channel(&this) {
            Ok(res) => res,
            Err(err) => {
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

        let key = PendingCacheKey::init(query);

        let pending = this.pending_host_cache(PendingCacheField::PendingHostCacheCares);
        let cache = pending.get_or_put(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(Some(this), global_this);
            let promise = dns_lookup.promise.value();
            pending.append(inflight, dns_lookup);
            return Ok(promise);
        }

        let hints_buf = [query.to_cares()];
        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::CAres,
            Some(this),
            global_this,
        );
        let promise = request.head.promise.value();

        channel.get_addr_info(&query.name, query.port, &hints_buf, request);

        Self::request_sent(this, global_this.bun_vm());
        Ok(promise)
    }

    // ───────── servers / local address ─────────

    fn get_channel_servers(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let channel = Self::get_channel_or_error(&this, global_this)?;
        let servers = match channel.servers() {
            Ok(servers) => servers,
            Err(err) => {
                return Err(global_this.throw_value(global_this.create_error_instance(
                    format_args!("ares_get_servers_ports error: {}", err.label()),
                )));
            }
        };

        let values = JSValue::create_empty_array(global_this, 0)?;

        for (i, current) in (0u32..).zip(servers.as_deref().into_iter().flat_map(|s| s.iter())) {
            // Formatting reference: https://nodejs.org/api/dns.html#dnsgetservers
            // Brackets '[' and ']' consume 2 bytes, used for IPv6 format (e.g., '[2001:4860:4860::8888]:1053').
            // Port range is 6 bytes (e.g., ':65535').
            // Null terminator '\0' uses 1 byte.
            let mut buf = [0u8; INET6_ADDRSTRLEN + 2 + 6 + 1];
            let family = current.family;

            let Some(ip_len) = current.ip_text(&mut buf[1..]).map(<[u8]>::len) else {
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
            let size = ip_len + 1;
            // The formatted bytes here are pure ASCII (IP address + optional
            // port) — borrow as a `bun_core::String` and hand to JS.
            use jsc::StringJsc as _;
            if port == IANA_DNS_PORT {
                values.put_index(
                    global_this,
                    i,
                    bun_core::String::borrow_utf8(&buf[1..size]).to_js(global_this)?,
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
                    bun_core::String::borrow_utf8(&buf[1..size + port_len]).to_js(global_this)?,
                )?;
            }
        }

        Ok(values)
    }

    pub fn get_global_servers(
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
    pub fn get_servers(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::get_channel_servers(this, global_this, callframe)
    }

    #[host_fn(method)]
    pub fn set_local_address(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let channel = Self::get_channel_or_error(&this, global_this)?;
        Self::set_channel_local_addresses(channel, global_this, callframe)
    }

    fn set_channel_local_addresses(
        channel: &c_ares::Channel,
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
        channel: &c_ares::Channel,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<c_int> {
        let str_ = value.to_slice(global_this)?;
        let text = bun::ZBox::from_bytes(str_.slice());

        let mut addr = [0u8; 16];

        if c_ares::inet_pton(c_ares::AF::INET, c_str(&text), &mut addr) == 1 {
            let ip = u32::from_be_bytes([addr[0], addr[1], addr[2], addr[3]]);
            channel.set_local_ip4(ip);
            return Ok(c_ares::AF::INET);
        }

        if c_ares::inet_pton(c_ares::AF::INET6, c_str(&text), &mut addr) == 1 {
            channel.set_local_ip6(&addr);
            return Ok(c_ares::AF::INET6);
        }

        Err(jsc::Error::INVALID_IP_ADDRESS.throw(
            global_this,
            format_args!(
                "Invalid IP address: \"{}\"",
                bstr::BStr::new(text.as_bytes())
            ),
        ))
    }

    fn set_channel_servers(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let channel = Self::get_channel_or_error(&this, global_this)?;
        // It's okay to call dns.setServers with active queries, but not dns.Resolver.setServers
        if this.as_ptr() != Self::get_channel_from_vm(global_this)?.as_ptr()
            && channel.active_queries() != 0
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
            if let Err(err) = channel.set_servers(&mut []) {
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
            let address_z = bun::ZBox::from_bytes(&address_slice);

            let af: c_int = if family == 4 {
                netc::AF_INET
            } else {
                netc::AF_INET6
            };

            let mut addr = [0u8; 16];
            if c_ares::inet_pton(af, c_str(&address_z), &mut addr) != 1 {
                return Err(jsc::Error::INVALID_IP_ADDRESS.throw(
                    global_this,
                    format_args!(
                        "Invalid IP address: \"{}\"",
                        bstr::BStr::new(&address_slice)
                    ),
                ));
            }

            entries.push(c_ares::struct_ares_addr_port_node::new(
                af, &addr, port, port,
            ));
        }

        if let Err(err) = channel.set_servers(&mut entries) {
            return Err(
                global_this.throw_value(global_this.create_error_instance(format_args!(
                    "ares_set_servers_ports error: {}",
                    err.label()
                ))),
            );
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn set_global_servers(
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
    pub fn set_servers(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_channel_servers(this, global_this, callframe)
    }

    pub fn new_resolver(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let resolver = RefPtr::new(Resolver::setup(global_this.bun_vm()));

        let options = callframe.argument(0);
        if options.is_object() {
            let mut opts = resolver.options.get();
            if let Some(timeout) = options.get_truthy(global_this, "timeout")? {
                opts.timeout = Some(timeout.coerce_to_i32(global_this)?);
            }
            if let Some(tries) = options.get_truthy(global_this, "tries")? {
                opts.tries = Some(tries.coerce_to_i32(global_this)?);
            }
            resolver.options.set(opts);
        }

        // Ownership of the initial ref transfers to the GC wrapper
        // (`DNSResolver__create` → `finalize`).
        Ok(Resolver::to_js_nonnull(
            core::ptr::NonNull::from(resolver.into_this_ptr()),
            global_this,
        ))
    }

    #[host_fn(method)]
    pub fn cancel(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let channel = Self::get_channel_or_error(&this, global_this)?;
        channel.cancel();
        Ok(JSValue::UNDEFINED)
    }

    // Resolves the given address and port into a host name and service using the operating system's underlying getnameinfo implementation.
    // If address is not a valid IP address, a TypeError will be thrown. The port will be coerced to a number.
    // If it is not a legal port, a TypeError will be thrown.
    pub fn global_lookup_service(
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

        let Some(sa) = c_ares::get_sockaddr(addr_s, port) else {
            return Err(global_this.throw_invalid_argument_value(b"address", addr_value));
        };

        let resolver = global_resolver(global_this);
        let channel = Self::get_channel_or_error(&resolver, global_this)?;

        let mut cache_name = Vec::new();
        {
            use std::io::Write;
            write!(&mut cache_name, "{}|{}", bstr::BStr::new(addr_s), port)
                .expect("infallible: in-memory write");
        }
        let cache_name: Box<[u8]> = cache_name.into_boxed_slice();

        let key = PendingCacheKey::from_name(&cache_name);
        let cache = resolver.pending_nameinfo_cache_cares.get_or_put(&key);

        if let CacheHit::Inflight(inflight) = cache {
            let info = CAresNameInfo::init(global_this, cache_name);
            let promise = info.promise.value();
            resolver.pending_nameinfo_cache_cares.append(inflight, info);
            return Ok(promise);
        }

        let request = GetNameInfoRequest::init(
            cache,
            Some(resolver),
            cache_name, // transfer ownership here
            global_this,
        );

        let promise = request.head.promise.value();
        channel.get_name_info(&sa, request);

        Self::request_sent(resolver, global_this.bun_vm());
        Ok(promise)
    }

    pub fn get_runtime_default_result_order_option(
        global_this: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
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

// ───────── C / JS host-fn exports (thunks are generated from the `HOST_EXPORT` markers) ─────────

// HOST_EXPORT(Bun__DNS__resolve)
pub fn dns_resolve(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve(global, frame)
}
// HOST_EXPORT(Bun__DNS__lookup)
pub fn dns_lookup(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_lookup(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveTxt)
pub fn dns_resolve_txt(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_txt(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveSoa)
pub fn dns_resolve_soa(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_soa(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveMx)
pub fn dns_resolve_mx(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_mx(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveNaptr)
pub fn dns_resolve_naptr(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_naptr(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveSrv)
pub fn dns_resolve_srv(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_srv(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveCaa)
pub fn dns_resolve_caa(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_caa(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveNs)
pub fn dns_resolve_ns(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_ns(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolvePtr)
pub fn dns_resolve_ptr(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_ptr(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveCname)
pub fn dns_resolve_cname(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_cname(global, frame)
}
// HOST_EXPORT(Bun__DNS__resolveAny)
pub fn dns_resolve_any(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_resolve_any(global, frame)
}
// HOST_EXPORT(Bun__DNS__getServers)
pub fn dns_get_servers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::get_global_servers(global, frame)
}
// HOST_EXPORT(Bun__DNS__setServers)
pub fn dns_set_servers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::set_global_servers(global, frame)
}
// HOST_EXPORT(Bun__DNS__reverse)
pub fn dns_reverse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_reverse(global, frame)
}
// HOST_EXPORT(Bun__DNS__lookupService)
pub fn dns_lookup_service(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::global_lookup_service(global, frame)
}
// HOST_EXPORT(Bun__DNS__prefetch)
pub fn dns_prefetch(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    internal::prefetch_from_js(global, frame)
}
// HOST_EXPORT(Bun__DNS__getCacheStats)
pub fn dns_get_cache_stats(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    internal::get_dns_cache_stats(global, frame)
}
// JS2Native ($newRustFunction) entry points — see GeneratedJS2Native.h
// HOST_EXPORT(JS2Rust___src_runtime_dns_jsc_dns_rs__Resolver_newResolver)
pub fn new_resolver(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Resolver::new_resolver(global, frame)
}
// HOST_EXPORT(JS2Rust___src_runtime_dns_jsc_dns_rs__Resolver_getRuntimeDefaultResultOrderOption)
pub fn get_runtime_default_result_order_option(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    Resolver::get_runtime_default_result_order_option(global, frame)
}
// HOST_EXPORT(JS2Rust___src_runtime_dns_jsc_dns_rs__internal_seedCacheForTesting)
pub fn seed_cache_for_testing(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    internal::seed_cache_for_testing(global, frame)
}

/// `bun_dns::internal::prefetch` — declared `extern "C"` in the lower-tier
/// `bun_dns` crate so `bun_install` can prefetch registry hostnames without a
/// crate cycle. Link-time resolved.
// HOST_EXPORT(__bun_dns_prefetch, c)
pub fn bun_dns_prefetch(loop_: &bun_uws::Loop, hostname: &[u8], port: u16) {
    internal::prefetch(loop_, (!hostname.is_empty()).then_some(hostname), port)
}

// The usockets connect path (`packages/bun-usockets`, `internal.h`).
// HOST_EXPORT(Bun__addrinfo_get, c)
pub fn addrinfo_get(
    loop_: &bun_uws::Loop,
    host: Option<&CStr>,
    port: u16,
    request: &mut *mut c_void,
) -> c_int {
    internal::us_getaddrinfo(loop_, host, port, request)
}
// HOST_EXPORT(Bun__addrinfo_set, c)
pub fn addrinfo_set(
    request: ThisPtr<crate::dns_jsc::internal::Request>,
    socket: &bun_uws::ConnectingSocket,
) {
    internal::us_getaddrinfo_set(request, socket)
}
// HOST_EXPORT(Bun__addrinfo_cancel, c)
pub fn addrinfo_cancel(
    request: ThisPtr<crate::dns_jsc::internal::Request>,
    socket: &bun_uws::ConnectingSocket,
) -> c_int {
    internal::us_getaddrinfo_cancel(request, socket)
}
// HOST_EXPORT(Bun__addrinfo_freeRequest, c)
pub fn addrinfo_free_request(request: ThisPtr<crate::dns_jsc::internal::Request>, error: c_int) {
    internal::freeaddrinfo(request, error)
}
// HOST_EXPORT(Bun__addrinfo_getRequestResult, c)
pub fn addrinfo_get_request_result(
    request: ThisPtr<crate::dns_jsc::internal::Request>,
) -> *const bun_uws_sys::addrinfo::addrinfo_result {
    internal::get_request_result(request)
}
/// QUIC analogue of `Bun__addrinfo_set` — `bun_http` (lower-tier crate)
/// registers through `bun_dns::internal::register_quic`, handing over its
/// `PendingConnect` box until notification.
// HOST_EXPORT(Bun__addrinfo_registerQuic, c)
pub fn addrinfo_register_quic(
    request: ThisPtr<crate::dns_jsc::internal::Request>,
    pc: Option<Box<bun_http::H3::PendingConnect>>,
) {
    internal::register_quic(request, pc.expect("PendingConnect"))
}
