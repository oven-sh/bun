//! DNS resolver — JSC bindings.

use core::cell::{Cell, RefCell};
use core::ffi::{c_char, c_int, c_void};
use core::mem::MaybeUninit;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::collections::BTreeMap;

use bun_collections::HiveArray;
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
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromiseStrong, JSValue, JsCell, JsResult};
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::windows::libuv;
#[cfg(not(windows))]
use bun_sys::{self as sys};
use bun_uws::{ConnectingSocket, Loop};
use bun_wyhash::hash as wyhash;

use super::dns_resolver_jsc::error_to_deferred;
use crate::generated_bindgen::dns::LookupOptions;
use crate::generated_bindgen::dns_internals::ResolverOptions;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_dns::Error as DnsError;
use bun_dns_resolver::addrinfo::Family;
use bun_dns_resolver::io::Time;
use bun_dns_resolver::reply::Kind;
use bun_dns_resolver::{Channel, Completion, ServerConfig, Token};

use super::system_io::SystemIo;

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
    /// The libuv spelling: `bun_dns::error_from_eai` reads UV_EAI_* codes on Windows.
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
/// `Cell` / `RefCell` / `JsCell` fields, so a shared borrow is sufficient when
/// script run by a settled lookup re-enters the same global resolver.
#[inline]
fn global_resolver(global_this: &JSGlobalObject) -> &'static Resolver {
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
bun_output::declare_scope!(GetAddrInfoRequest, visible);
bun_output::declare_scope!(DNSLookup, visible);
bun_output::declare_scope!(dns, hidden);
bun_output::declare_scope!(DNSResolver, visible);

// ──────────────────────────────────────────────────────────────────────────
// C type aliases
// ──────────────────────────────────────────────────────────────────────────

const IANA_DNS_PORT: u16 = 53;
/// Node's.
const DEFAULT_TRIES: u32 = 4;

// ──────────────────────────────────────────────────────────────────────────
// dns_sd (macOS): DNSServiceQueryRecord over one shared mDNSResponder connection, no per-lookup threads.
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
        context: bun_jsc::ContextId,
    ) -> JSValue {
        let key = get_addr_info_request::PendingCacheKey::init(query_init);

        let cache = this.get_or_put_into_pending_cache(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this, context);
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
            get_addr_info_request::Backend::Unset,
            Some(this.as_ctx_ptr()),
            global_this,
            context,
        );
        // SAFETY: request was just heap-allocated in init() and is exclusively owned here.
        let promise_value = unsafe { (*request).head.promise.value() };

        bun_jsc::Job::<get_addr_info_request::LibcLookup>::schedule(
            // The realm's: lookups of the same name from any context wait on the one in flight.
            &global_this.js_thread(this.vm().root_context()),
            get_addr_info_request::LibcLookup {
                backend: get_addr_info_request::LibcBackend::Query(query),
            },
            get_addr_info_request::LibcRequest(NonNull::new(request).expect("request")),
        );
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
        /// A lookup is shared by the realm; each promise waiting on it is settled for its own context.
        unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
            bun_event_loop::ContextId::NONE
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
        context: bun_jsc::ContextId,
    ) -> JsResult<JSValue> {
        let key = get_addr_info_request::PendingCacheKey::init(&query);

        let cache = this.get_or_put_into_pending_cache(&key);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this, context);
            unsafe { (*inflight).append(dns_lookup) };
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::uv_uninit()),
            Some(this.as_ctx_ptr()),
            global_this,
            context,
        );

        let hints = query.options.to_libc();
        let mut port_buf = [0u8; 128];
        let port_len = bun_fmt::print_int(&mut port_buf, query.port);
        port_buf[port_len] = 0;
        // SAFETY: port_buf[port_len] == 0 written above
        let port_z = ZStr::from_buf(&port_buf[..], port_len);

        let mut hostname = bun_paths::path_buffer_pool::get();
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
// GetAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct GetAddrInfoRequest {
    pub(crate) backend: get_addr_info_request::Backend,
    // TODO: should be Option<&'a Resolver>; raw ptr for now
    pub(crate) resolver_for_caching: Option<*mut Resolver>,
    /// Slot this request owns in the resolver's pending cache, which same-name
    /// lookups chain onto until completion drains it; `None` when the cache was full.
    pub(crate) pending_slot: Option<u8>,
    pub(crate) head: DNSLookup,
    pub(crate) tail: *mut DNSLookup, // INTRUSIVE
}

pub(crate) mod get_addr_info_request {
    use super::*;

    /// The blocking `getaddrinfo` of one libc-backend lookup, run on the pool.
    #[cfg(not(windows))]
    pub(crate) struct LibcLookup {
        pub(crate) backend: LibcBackend,
    }

    /// The request a [`LibcLookup`] completes: JS-thread state (promises,
    /// keep-alive, resolver ref) at a stable address the resolver's pending
    /// cache points at. Consumed by the completion; dropped unconsumed only
    /// when the VM tears down first, in which case everything is freed and
    /// nothing is settled.
    #[cfg(not(windows))]
    pub(crate) struct LibcRequest(pub(crate) NonNull<super::GetAddrInfoRequest>);
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
                        drop((*resolver).get_key_host(pos));
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

    pub(crate) struct PendingCacheKey {
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
    pub(crate) struct BackendDnsSd {
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
    pub(crate) enum LibcBackend {
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

            let mut hostname = bun_paths::path_buffer_pool::get();
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
    pub(crate) struct LibcBackend {
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
    pub(crate) enum Backend {
        /// Not filled in yet, or taken.
        #[cfg(not(windows))]
        Unset,
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
            let Backend::Libc(libc) = self;
            &mut libc.uv
        }
    }
}

impl GetAddrInfoRequest {
    pub(crate) fn init(
        cache: CacheHit,
        backend: get_addr_info_request::Backend,
        resolver: Option<*mut Resolver>,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> *mut Self {
        bun_output::scoped_log!(GetAddrInfoRequest, "init");
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            backend,
            resolver_for_caching: resolver,
            pending_slot: None,
            head: DNSLookup {
                // SAFETY: resolver is live and intrusively refcounted; init_ref bumps the embedded ref_count.
                _resolver: resolver.map(|r| unsafe { RefPtr::init_ref(r) }),
                global_this: bun_ptr::BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
                context,
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
                    .pending_host_cache()
                    .index_of(new)
                    .unwrap();
                (*request).pending_slot = Some(pos as u8);
                (*new).lookup = request;
            }
        }
        request
    }

    /// Complete a dns_sd-backed request; `this` is the live heap request, consumed on every path.
    #[cfg(target_os = "macos")]
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
    pub(crate) fn then(this: *mut Self, _global: &JSGlobalObject) {
        bun_output::scoped_log!(GetAddrInfoRequest, "then");
        // SAFETY: called on the JS thread with the heap request the lookup was
        // created from; `resolver_for_caching` (if set) is the live ctx ref.
        unsafe {
            // Take the backend by value: `Success` holds a `Vec<GetAddrInfoResult>`
            // (not `Clone`) that we move into `GetAddrInfoResultAny::List`. The
            // request is consumed/freed on every path below, so the `Unset`
            // placeholder left behind owns no resources.
            let backend =
                core::mem::replace(&mut (*this).backend, get_addr_info_request::Backend::Unset);
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

    #[cfg(windows)]
    pub(crate) fn on_libuv_complete(uv_info: *mut libuv::uv_getaddrinfo_t) {
        unsafe {
            let retcode = (*uv_info).retcode.int();
            bun_output::scoped_log!(GetAddrInfoRequest, "onLibUVComplete: status={}", retcode);
            let this: *mut Self = (*uv_info).data.cast();
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
            if bun_dns::error_from_eai(retcode).is_some() {
                DNSLookup::process_get_addr_info_native(&raw mut head, retcode, ptr::null_mut());
            } else {
                DNSLookup::on_complete_native(&raw mut head, &result_any);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DNSLookup
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct DNSLookup {
    /// The pending cache the lookup is chained in is the resolver's.
    _resolver: Option<RefPtr<Resolver>>,
    pub global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    pub promise: JSPromiseStrong,
    pub allocated: bool,
    pub next: Option<NonNull<DNSLookup>>, // INTRUSIVE
    pub poll_ref: KeepAlive,
    /// The context whose script asked (several contexts' lookups of one name
    /// share a request): an answer for a stopped one settles nothing.
    pub context: bun_jsc::ContextId,
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

    fn init(
        resolver: *mut Resolver,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> *mut Self {
        bun_output::scoped_log!(DNSLookup, "init");

        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());

        bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: resolver is live and intrusively refcounted; init_ref bumps the embedded ref_count.
            _resolver: Some(unsafe { RefPtr::init_ref(resolver) }),
            global_this: bun_ptr::BackRef::new(global_this),
            poll_ref,
            promise: JSPromiseStrong::init(global_this),
            allocated: true,
            next: None,
            context,
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
            if let Some(err) = bun_dns::error_from_eai(status) {
                error_to_deferred(err, b"getaddrinfo", None, &mut (*this).promise)
                    .reject_later((*this).global_this(), (*this).context);
                Self::destroy(this);
                return;
            }
            Self::on_complete_native(this, &GetAddrInfoResultAny::Addrinfo(result));
        }
    }

    /// SAFETY: see `on_complete_native`.
    unsafe fn on_complete_with_array(this: *mut Self, result: Outcome) {
        bun_output::scoped_log!(DNSLookup, "onCompleteWithArray");
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            result.settle(&mut promise, global_this, (*this).context);
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

    /// The resolver backends' completions (the channel, libinfo,
    /// libuv) land here to settle the lookup's promise with a value built by
    /// the resolver: this is their fold for what settling leaves pending
    /// (allocation failure, a terminating VM).
    fn settle(
        self,
        promise: &mut JSPromiseStrong,
        global: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) {
        // The lookup continues the script that asked for it.
        let _context = global.bun_vm().enter_context(context);
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

pub(crate) struct GlobalData {
    pub(crate) resolver: Resolver,
}

impl GlobalData {
    pub(crate) fn init(vm: &VirtualMachine) -> Box<Self> {
        Box::new(Self {
            // The VM-global resolver serves every context of the realm.
            resolver: Resolver::setup(vm, None),
        })
    }
}

impl Resolver {
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
                let request = (*lookup).backend.as_libc_uv_mut();
                let _ = libuv::uv_cancel(core::ptr::from_mut(request).cast());
            }
        }
    }

    /// Worker-terminate / main-VM-destruct hook: tear down the channel while
    /// the JSC VM, `RareData.file_polls`, event loop, and `runtime_state` are
    /// all still live. Every pending request fails with `EDESTRUCTION`, which
    /// dereferences `Waiter::global_this` (to enqueue the rejection task), and
    /// every socket is closed, which unregisters its hive `FilePoll` from the
    /// loop. Running this after either is freed is a UAF (Node
    /// `test-worker-dns-terminate.js`).
    ///
    /// `Stopped` if a channel was open.
    ///
    /// # Safety
    /// `this` is a live resolver. It may be freed by the time this returns (a
    /// failing query can drop the last reference); the caller touches nothing
    /// of it afterwards.
    pub(crate) unsafe fn close_channel_for_terminate(
        this: *mut Self,
    ) -> bun_jsc::virtual_machine::SweepResult {
        use bun_jsc::virtual_machine::SweepResult;
        // Failing the pending requests releases their refs on this resolver;
        // hold one so it outlives its own channel close.
        // SAFETY: fn contract.
        let _guard = unsafe { RefPtr::init_ref(this) };
        // SAFETY: alive under the ref just taken.
        let result = if unsafe { (*this).destroy_channel() } {
            SweepResult::Stopped
        } else {
            SweepResult::Idle
        };
        // The timer for the channel's next timeout (and its +1 ref on this
        // resolver plus the uws active-handle bump) can still be linked.
        // SAFETY: as above. `_guard` then releases our ref (may free `this`).
        unsafe { (*this).remove_timer() };
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// internal — process-wide DNS cache used by usockets connect path
// ──────────────────────────────────────────────────────────────────────────

pub(crate) mod internal {
    use super::*;
    use crate::generated_bindgen::dns::DNSCacheStats;

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
    pub(crate) struct RequestKeyOwned {
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
    pub(crate) struct RequestResult {
        pub(crate) info: Option<NonNull<ResultEntry>>, // thin ptr; head of intrusive `ai_next` chain
        pub(crate) err: c_int,
    }
    // Ownership of the ResultEntry buffer is `Request.result_buf` — this struct is
    // a borrowed C-ABI view (`info` points at `result_buf[0]`). Do NOT free via
    // this field.

    #[cfg(target_os = "macos")]
    pub(crate) struct MacAsyncDNS {
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

    pub(crate) struct Request {
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
        //
        // Every VM's JS thread and the HTTP thread share the cache, so ignore fake timers.
        fn get_cache_timestamp() -> u32 {
            (bun::Timespec::now(bun::TimespecMockMode::ForceRealTime).ms_unsigned() / 1000) as u32
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

    pub(crate) enum DNSRequestOwner {
        Socket(*mut ConnectingSocket),           // FFI
        Quic(*mut bun_http::H3::PendingConnect), // BORROW_PARAM
    }

    impl DNSRequestOwner {
        /// # Safety
        /// `req` must be a live cache `Request` with a populated `result`; the
        /// callee may take ownership and free it.
        pub(crate) fn notify_threadsafe(&self, req: *mut Request) {
            match self {
                // SAFETY: `socket` is the live usockets handle stored when the request was registered.
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback_threadsafe(*socket, req)
                },
                // SAFETY: `pc` is the live PendingConnect borrowed for the lifetime of the request.
                DNSRequestOwner::Quic(pc) => unsafe {
                    bun_http::H3::PendingConnect::on_dns_resolved_threadsafe(*pc)
                },
            }
        }

        /// # Safety
        /// `req` must be a live cache `Request` with a populated `result`; the
        /// callee may take ownership and free it.
        pub(crate) fn notify(&self, req: *mut Request) {
            match self {
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
    pub(crate) struct ResultEntry {
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
        shared.start(dns_sd::Inflight::Internal(req), protocol, host)
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

    pub(crate) fn get_cache_stats() -> DNSCacheStats {
        DNSCacheStats {
            cache_hits_completed: DNS_CACHE_HITS_COMPLETED.load(Ordering::Relaxed),
            cache_hits_inflight: DNS_CACHE_HITS_INFLIGHT.load(Ordering::Relaxed),
            cache_misses: DNS_CACHE_MISSES.load(Ordering::Relaxed),
            size: DNS_CACHE_SIZE.load(Ordering::Relaxed),
            errors: DNS_CACHE_ERRORS.load(Ordering::Relaxed),
            total_count: GETADDRINFO_CALLS.load(Ordering::Relaxed),
        }
    }

    const MAX_ADDRESSES_FOR_TESTING: usize = 64;

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
        if len > MAX_ADDRESSES_FOR_TESTING {
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
    pub(crate) fn is_localhost_name_for_testing(hostname: &[u8]) -> bool {
        is_localhost_name(hostname)
    }

    /// `bun:internal-for-testing`: [`is_all_loopback_of_one_family`] over `addresses` laid out as a getaddrinfo() answer.
    pub(crate) fn is_all_loopback_of_one_family_for_testing<'a>(
        cx: &mut JsScope<'a>,
        addresses: JsLocal<'a>,
    ) -> JsResult<bool> {
        let mut addrs = addresses_for_testing(cx.global(), addresses.to_js())?;
        let chain = addrinfo_chain(&mut addrs);
        let head = chain.first().map_or(ptr::null(), ptr::from_ref);
        Ok(is_all_loopback_of_one_family(head))
    }

    /// `bun:internal-for-testing`: seed the connect-path DNS cache for `hostname`
    /// by running `addresses` through the real [`process_results`] interleave and
    /// storing the result, so a real `fetch()` / `Bun.connect()` consumes it.
    pub(crate) fn seed_cache_for_testing<'a>(
        cx: &mut JsScope<'a>,
        hostname: &[u8],
        addresses: JsLocal<'a>,
    ) -> JsResult<core::iter::Take<core::array::IntoIter<i32, MAX_ADDRESSES_FOR_TESTING>>> {
        let global = cx.global();
        let hostname_z = bun::ZBox::from_bytes(hostname);
        let mut addrs = addresses_for_testing(global, addresses.to_js())?;
        if addrs.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!("addresses must not be empty")));
        }
        let mut chain = addrinfo_chain(&mut addrs);
        let results = process_results(chain.as_mut_ptr());

        let mut families = [0i32; MAX_ADDRESSES_FOR_TESTING];
        for (family, entry) in families.iter_mut().zip(results.iter()) {
            *family = if entry.info.ai_family == netc::AF_INET6 {
                6
            } else {
                4
            };
        }
        let families = families.into_iter().take(results.len());

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
        Ok(families)
    }

    /// `bun:internal-for-testing`: the error a lookup of `hostname` reports
    /// when getaddrinfo(3) returns the `EAI_*` status named `code`.
    pub(crate) fn getaddrinfo_error_for_testing(
        cx: &mut JsScope<'_>,
        code: &[u8],
        hostname: &[u8],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let Some(rc) = bun_dns::eai_raw_by_name(code) else {
            return Err(global.throw_invalid_arguments(format_args!(
                "unknown getaddrinfo status name: {}",
                bstr::BStr::new(code)
            )));
        };
        match bun_dns::error_from_eai(rc) {
            Some(err) => crate::dns_jsc::dns_resolver_jsc::error_to_js_with_syscall_and_hostname(
                err,
                global,
                b"getaddrinfo",
                hostname,
            ),
            None => Ok(JSValue::UNDEFINED),
        }
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

    pub(crate) fn prefetch_from_js(hostname: &[u8], port: u16) {
        let hostname_z = bun::ZBox::from_bytes(hostname);
        prefetch(
            VirtualMachine::get().uws_loop(),
            Some(hostname_z.as_zstr()),
            port,
        );
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

// ──────────────────────────────────────────────────────────────────────────
// Resolver — JSC-exposed `dns.Resolver` (a JSDNSResolver holds a ref)
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type PendingCache = HiveArray<get_addr_info_request::PendingCacheKey, 32>;
/// What makes two requests of a resolver's channel one: whoever asks for what is already in flight waits for the same answer.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum RequestKey {
    Query(Kind, Box<[u8]>),
    AddrInfo {
        name: Box<[u8]>,
        port: u16,
        family: Family,
    },
    /// The address as the caller spelled it.
    Reverse(Box<[u8]>),
    /// `address|port`.
    NameInfo(Box<[u8]>),
}

impl RequestKey {
    /// The `syscall` and `hostname` of the error a failure is reported as.
    fn error_context(&self) -> (&'static [u8], Option<&[u8]>) {
        match self {
            RequestKey::Query(kind, name) => {
                let syscall: &[u8] = match kind {
                    Kind::A => b"queryA",
                    Kind::Aaaa => b"queryAaaa",
                    Kind::Any => b"queryAny",
                    Kind::Caa => b"queryCaa",
                    Kind::Cname => b"queryCname",
                    Kind::Mx => b"queryMx",
                    Kind::Naptr => b"queryNaptr",
                    Kind::Ns => b"queryNs",
                    Kind::Ptr => b"queryPtr",
                    Kind::Soa => b"querySoa",
                    Kind::Srv => b"querySrv",
                    Kind::Txt => b"queryTxt",
                };
                (syscall, Some(name))
            }
            RequestKey::AddrInfo { .. } => (b"getaddrinfo", None),
            RequestKey::Reverse(address) => (b"getHostByAddr", Some(address)),
            RequestKey::NameInfo(name) => (b"getnameinfo", Some(name)),
        }
    }
}

/// One promise waiting for a request of a resolver's channel.
struct Waiter {
    promise: JSPromiseStrong,
    global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    /// The context whose script asked: an answer for a stopped one settles nothing.
    context: bun_jsc::ContextId,
    poll_ref: KeepAlive,
    /// A resolver nothing else refers to still finishes what it was asked.
    _resolver: RefPtr<Resolver>,
}

impl Waiter {
    fn new(resolver: &Resolver, global_this: &JSGlobalObject, context: bun_jsc::ContextId) -> Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self {
            promise: JSPromiseStrong::init(global_this),
            global_this: bun_ptr::BackRef::new(global_this),
            context,
            poll_ref,
            _resolver: resolver.ref_guard(),
        }
    }
}

impl Drop for Waiter {
    fn drop(&mut self) {
        self.poll_ref.unref(js_event_loop_ctx());
    }
}

fn monotonic_now() -> Time {
    let now = bun::timespec::now(bun::TimespecMockMode::ForceRealTime);
    Time {
        sec: now.sec,
        usec: (now.nsec / 1000) as u32,
    }
}

/// Who waits for each request the channel is working on.
#[derive(Default)]
struct Requests {
    in_flight: BTreeMap<Token, (RequestKey, Vec<Waiter>)>,
    tokens: BTreeMap<RequestKey, Token>,
    last_token: Token,
}

impl Requests {
    /// The token to ask the channel with, unless it is being asked already.
    fn add(&mut self, key: RequestKey, waiter: Waiter) -> Option<Token> {
        if let Some((_, waiters)) = self
            .tokens
            .get(&key)
            .and_then(|token| self.in_flight.get_mut(token))
        {
            waiters.push(waiter);
            return None;
        }
        self.last_token += 1;
        self.tokens.insert(key.clone(), self.last_token);
        self.in_flight.insert(self.last_token, (key, vec![waiter]));
        Some(self.last_token)
    }

    fn remove(&mut self, token: Token) -> Option<(RequestKey, Vec<Waiter>)> {
        let request = self.in_flight.remove(&token)?;
        self.tokens.remove(&request.0);
        Some(request)
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. Settling a
// promise can run script that calls back into this resolver, so no borrow of
// `channel` or `requests` is held across `settle`.
/// `DNSResolver`, declared in `dns_internals.bind.ts`.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct Resolver {
    pub(crate) ref_count: bun_ptr::RefCount<Resolver>,
    /// Opened by the first request.
    channel: RefCell<Option<Channel>>,
    requests: RefCell<Requests>,
    /// The context whose script made the resolver: its channel is that context's, whoever is first
    /// to query. `None`: the VM-global one, which is the realm's whatever the realm's context is
    /// called by then (`bun test --isolate` renews it for every file).
    made_in: Option<bun_jsc::ContextId>,
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>, // JSC_BORROW (BACKREF — VirtualMachine outlives the resolver; read-only after init)
    options: Cell<bun_dns_resolver::Options>,

    /// Set for the channel's next timeout.
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,

    pub(crate) pending_host_cache_native: JsCell<PendingCache>,

    /// Armed while a channel is open: a live channel has sockets, timers and
    /// queries in flight whose completion needs the context that opened it, which
    /// closes it (any resolver, not just the VM-global one) if nobody did before.
    pub(crate) abort_handle: bun_jsc::AbortHandle,
}

bun_event_loop::impl_timer_owner!(Resolver; from_timer_ptr => event_loop_timer);

bun_jsc::impl_abort_handle_owner!(Resolver, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ `destroy_channel` has
    // not run); it may free itself inside, and is not touched after.
    let _ = unsafe { Resolver::close_channel_for_terminate(this) };
});

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
    pub socket: bun_sys::Fd,
    /// Number of `on_dns_poll_uv` calls for this handle on the stack. libuv
    /// reads `poll` again after each one returns.
    poll_cb_depth: u32,
    /// True if a nested `uv_run` called `on_close_uv` while `poll_cb_depth` was
    /// non-zero. The outermost `on_dns_poll_uv` call then queues the free.
    closed: bool,
    pub poll: libuv::uv_poll_t,
}

#[cfg(windows)]
impl UvDnsPoll {
    pub(crate) fn new(parent: *mut Resolver, socket: bun_sys::Fd) -> *mut Self {
        bun_core::heap::into_raw(Box::new(Self {
            parent,
            socket,
            poll_cb_depth: 0,
            closed: false,
            poll: bun_core::ffi::zeroed(),
        }))
    }

    pub(crate) fn destroy(this: *mut Self) {
        // SAFETY: `this` came from `heap::into_raw` in `new`, and nothing uses it after this call.
        unsafe { drop(bun_core::heap::take(this)) };
    }

    fn from_poll(poll: *mut libuv::uv_poll_t) -> *mut Self {
        // SAFETY: poll points to UvDnsPoll.poll
        unsafe { bun_core::from_field_ptr!(UvDnsPoll, poll, poll) }
    }
}

#[cfg(windows)]
impl bun_event_loop::Taskable for UvDnsPoll {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::UvDnsPollFree;
    unsafe fn release_unrun(this: *mut Self) {
        Self::destroy(this);
    }
    /// The task doesn't run JS.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

#[derive(Clone, Copy)]
pub(crate) enum CacheHit {
    Inflight(*mut get_addr_info_request::PendingCacheKey), // BORROW_FIELD into resolver buffer
    New(*mut get_addr_info_request::PendingCacheKey),      // BORROW_FIELD into resolver buffer
    Disabled,
}

// Canonical enum + parser live in `bun_dns` (lower tier so `cli` can parse
// `--dns-result-order` without depending on the runtime). Re-export for
// existing `crate::dns_jsc::Order` callers.
pub(crate) use bun_dns::Order;

bun_core::comptime_string_map! {
    pub(super) static RECORD_TYPE_MAP: Kind = {
        b"A" => Kind::A, b"AAAA" => Kind::Aaaa, b"ANY" => Kind::Any,
        b"CAA" => Kind::Caa, b"CNAME" => Kind::Cname, b"MX" => Kind::Mx,
        b"NAPTR" => Kind::Naptr, b"NS" => Kind::Ns, b"PTR" => Kind::Ptr,
        b"SOA" => Kind::Soa, b"SRV" => Kind::Srv, b"TXT" => Kind::Txt,
        b"a" => Kind::A, b"aaaa" => Kind::Aaaa, b"any" => Kind::Any,
        b"caa" => Kind::Caa, b"cname" => Kind::Cname, b"mx" => Kind::Mx,
        b"naptr" => Kind::Naptr, b"ns" => Kind::Ns, b"ptr" => Kind::Ptr,
        b"soa" => Kind::Soa, b"srv" => Kind::Srv, b"txt" => Kind::Txt,
    };
}

/// Non-NaN, integer-truncated `0..=65535`, else `ERR_SOCKET_BAD_PORT`.
fn to_port_number(double: f64, global: &JSGlobalObject) -> JsResult<u16> {
    if double.is_nan() {
        return Err(jsc::Error::SOCKET_BAD_PORT.throw(global, format_args!("Invalid port number")));
    }
    let port = double as i64;
    if (0..=65535).contains(&port) {
        return Ok(port as u16);
    }
    Err(jsc::Error::SOCKET_BAD_PORT.throw(global, format_args!("Port number out of range: {port}")))
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
    pub(crate) fn ref_(&self) {
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
    pub(crate) unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; the 1→0 transition drops the Box.
        unsafe { bun_ptr::RefCount::<Self>::deref(this) };
    }

    pub(crate) fn setup(vm: &VirtualMachine, made_in: Option<bun_jsc::ContextId>) -> Self {
        Self {
            ref_count: bun_ptr::RefCount::init(),
            channel: RefCell::new(None),
            requests: RefCell::new(Requests::default()),
            made_in,
            vm: bun_ptr::BackRef::new(vm),
            options: Cell::new(bun_dns_resolver::Options {
                timeout_ms: None,
                tries: Some(DEFAULT_TRIES),
            }),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::DNSResolver,
            )),
            pending_host_cache_native: JsCell::new(PendingCache::init()),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Resolver>(),
        }
    }

    pub(crate) fn init(vm: &VirtualMachine, made_in: Option<bun_jsc::ContextId>) -> *mut Self {
        bun_output::scoped_log!(DNSResolver, "init");
        bun_core::heap::into_raw(Box::new(Self::setup(vm, made_in)))
    }

    // ─── R-2 interior-mutability helpers ────────────────────────────────────

    /// `self`'s address as `*mut Self` for `FilePoll` / `RefPtr` ctx slots and
    /// `Self::deref`. Callbacks deref it as `&*const` (shared) — see
    /// `on_dns_poll` — so no write provenance is required. All mutation routes
    /// through `Cell` / `RefCell` / `JsCell` (UnsafeCell-backed).
    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    // ───────────── timer / pending bookkeeping ─────────────

    pub(crate) fn check_timeouts(&self, _now: &ElTimespec, vm: &VirtualMachine) {
        let uws_loop = vm.uws_loop();
        let deref_this = self.as_ctx_ptr();
        scopeguard::defer! {
            // jsc/runtime crate cycle: low-tier `VirtualMachine.timer` is `()`;
            // resolve via the high-tier `RuntimeState` hook.
            let state = crate::jsc_hooks::runtime_state();
            // SAFETY: `state` is the boxed per-thread `RuntimeState`; single-threaded JS heap.
            unsafe { (*state).timer.increment_timer_ref(-1, uws_loop) };
            // SAFETY: `deref_this` is the heap allocation from `init`; releases
            // `set_timer`'s ref. May be the final release; nothing touches
            // `*self` after this point.
            unsafe { Self::deref(deref_this) };
        }

        self.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::PENDING);

        if self.channel.borrow().is_some() {
            self.with_channel(|channel, now| channel.process(now, None, None));
        }
    }

    /// Has `check_timeouts` called at `time`.
    fn set_timer(&self, time: Time) {
        let next = bun::timespec {
            sec: time.sec,
            nsec: i64::from(time.usec) * 1000,
        };
        let timer = self.event_loop_timer.get();
        let is_active = timer.state == EventLoopTimerState::ACTIVE;
        if is_active && (timer.next.sec, timer.next.nsec) == (next.sec, next.nsec) {
            return;
        }
        let state = crate::jsc_hooks::runtime_state();
        if !is_active {
            self.ref_();
            // SAFETY: `state` is the boxed per-thread `RuntimeState`; single-threaded JS heap.
            unsafe { (*state).timer.increment_timer_ref(1, self.vm().uws_loop()) };
        }
        // SAFETY: as above. Whole-struct provenance: `from_field_ptr!` recovers the container on fire.
        unsafe {
            (*state).timer.update(
                core::ptr::addr_of!(self.event_loop_timer)
                    .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                    .cast_mut(),
                &next,
            );
        }
    }

    fn remove_timer(&self) {
        if self.event_loop_timer.get().state != EventLoopTimerState::ACTIVE {
            return;
        }

        // Normally checkTimeouts does this, so we have to be sure to do it ourself if we cancel the timer
        let this = self.as_ctx_ptr();
        scopeguard::defer! {
            // SAFETY: `this` is the heap allocation from `init`. This releases
            // the ref taken by `set_timer`. Every caller holds at least one
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

    /// R-2: returns `&mut` from `&self` via `JsCell::get_mut`. Callers hold
    /// the borrow only for the duration of a slot read/claim/unset and never
    /// across a re-entrant call.
    #[allow(clippy::mut_from_ref)]
    fn pending_host_cache(&self) -> &mut PendingCache {
        // SAFETY: single-JS-thread invariant; caller holds the borrow only for
        // a short, non-reentrant window (see fn doc).
        unsafe { self.pending_host_cache_native.get_mut() }
    }

    fn get_key_host(&self, index: u8) -> get_addr_info_request::PendingCacheKey {
        let cache = self.pending_host_cache();
        // SAFETY: slot at `index` was alloc'd by `get_or_put_into_pending_cache`.
        unsafe { cache.box_at(index as usize) }
            .expect("pending DNS slot")
            .into_inner()
    }

    pub(crate) fn drain_pending_host_native(
        &self,
        index: u8,
        global_object: &JSGlobalObject,
        err: i32,
        result: &GetAddrInfoResultAny,
    ) {
        bun_output::scoped_log!(DNSResolver, "drainPendingHostNative");
        let key = self.get_key_host(index);

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

    pub(crate) fn get_or_put_into_pending_cache(
        &self,
        key: &get_addr_info_request::PendingCacheKey,
    ) -> CacheHit {
        let cache = self.pending_host_cache();
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

    // ───────────── the channel ─────────────

    fn open_channel(&self) -> Channel {
        let context = match self.made_in {
            Some(made_in) => self.vm.context_of(made_in),
            None => self.vm.root_context(),
        };
        // SAFETY: a resolver that opens a channel is at its final address (the
        // channel's polls hold it); it leaves its context in `destroy_channel`.
        unsafe { bun_jsc::AbortHandle::arm_owner(self.as_ctx_ptr(), context) };
        Channel::new(
            Box::new(SystemIo::new(self.as_ctx_ptr(), self.vm())),
            self.options.get(),
        )
    }

    /// Runs `f` on the channel, opening it first if need be. Then settles what has finished, which can run script.
    fn with_channel<R>(&self, f: impl FnOnce(&mut Channel, Time) -> R) -> R {
        let _guard = self.ref_guard();
        let result = {
            let mut channel = self.channel.borrow_mut();
            f(
                channel.get_or_insert_with(|| self.open_channel()),
                monotonic_now(),
            )
        };
        self.settle_what_finished();
        result
    }

    /// The caller holds a ref.
    fn settle_what_finished(&self) {
        loop {
            let completion = match self.channel.borrow_mut().as_mut() {
                Some(channel) => channel.next_completion(),
                None => None,
            };
            match completion {
                Some(completion) => self.settle(completion),
                None => break,
            }
        }
        match self
            .channel
            .borrow()
            .as_ref()
            .and_then(Channel::next_timeout)
        {
            Some(time) => self.set_timer(time),
            None => self.remove_timer(),
        }
    }

    /// Ends every waiter of a request. The caller holds a ref: theirs go.
    fn settle(&self, completion: Completion) {
        let Some((key, waiters)) = self.requests.borrow_mut().remove(completion.token) else {
            return;
        };
        let answer = match completion.result {
            Ok(answer) if super::dns_resolver_jsc::is_empty(&answer) => Err(DnsError::ENOTFOUND),
            Ok(answer) => Ok(answer),
            Err(error) => Err(error.as_node_reports_it()),
        };
        let answer = match answer {
            Ok(answer) => answer,
            Err(error) => {
                let (syscall, hostname) = key.error_context();
                for mut waiter in waiters {
                    error_to_deferred(error, syscall, hostname, &mut waiter.promise)
                        .reject_later(waiter.global_this.get(), waiter.context);
                }
                return;
            }
        };
        let kind = match key {
            RequestKey::Query(kind, _) => Some(kind),
            _ => None,
        };
        // Converted once for each global, and shared by its waiters.
        let mut converted: Option<(*const JSGlobalObject, Outcome)> = None;
        for mut waiter in waiters {
            let global = waiter.global_this.get();
            let outcome = match converted {
                Some((of, outcome)) if core::ptr::eq(of, global) => outcome,
                _ => Outcome::of(
                    global,
                    super::dns_resolver_jsc::answer_to_js(kind, &answer, global),
                ),
            };
            converted = Some((global, outcome));
            outcome.keep_alive();
            outcome.settle(&mut waiter.promise, global, waiter.context);
            outcome.keep_alive();
        }
    }

    /// The promise of the answer to `key`, which `start` asks the channel for unless it is being asked already.
    fn request(
        &self,
        key: RequestKey,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
        start: impl FnOnce(&mut Channel, Time, Token),
    ) -> JSValue {
        let waiter = Waiter::new(self, global_this, context);
        let promise = waiter.promise.value();
        let new = self.requests.borrow_mut().add(key, waiter);
        if let Some(token) = new {
            self.with_channel(|channel, now| start(channel, now, token));
        }
        promise
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
        // via `from_poll`. `on_close_uv` doesn't free it while `poll_cb_depth` is non-zero.
        // `parent` is the heap-allocated Resolver back-ptr (set in
        // `SystemIo::watch`); it is kept alive across `Channel::process` by the
        // `_guard` below.
        unsafe {
            (*poll).poll_cb_depth += 1;
            let parent: *mut Resolver = (*poll).parent;
            let vm = (*parent).vm.get();
            {
                // Dropping `_exit` drains microtasks. That JS can run a nested `uv_run`,
                // which calls `on_close_uv` for a socket the channel closed below.
                let _exit = vm.enter_event_loop_scope();
                // SAFETY: `parent` is the live heap-allocated Resolver back-ptr.
                let _guard = RefPtr::init_ref(parent);
                let socket = super::system_io::socket_of((*poll).socket);
                // An error is reported as a socket both readable and writable.
                // https://github.com/nodejs/node/blob/8a41d9b636be86350cd32847c3f89d327c4f6ff7/src/cares_wrap.cc#L93
                let readable = status < 0 || events & libuv::UV_READABLE != 0;
                let writable = status < 0 || events & libuv::UV_WRITABLE != 0;
                if (*parent).channel.borrow().is_some() {
                    (*parent).with_channel(|channel, now| {
                        channel.process(now, readable.then_some(socket), writable.then_some(socket))
                    });
                }
            }
            (*poll).poll_cb_depth -= 1;
            if (*poll).poll_cb_depth == 0 && (*poll).closed {
                // The task queue isn't drained until this libuv callback returns.
                vm.as_mut().enqueue_task(jsc::Task::init(poll));
            }
        }
    }

    #[cfg(windows)]
    pub(crate) unsafe extern "C" fn on_close_uv(watcher: *mut libuv::uv_handle_t) {
        // SAFETY: libuv invokes the close cb with the same handle pointer passed
        // to `uv_close`, which was `&mut UvDnsPoll::poll` (a `uv_poll_t` whose
        // header is `uv_handle_t`); `from_poll` recovers the containing struct.
        let poll = UvDnsPoll::from_poll(watcher.cast());
        // SAFETY: only the code below and the task `on_dns_poll_uv` queues free the struct.
        unsafe {
            if (*poll).poll_cb_depth > 0 {
                (*poll).closed = true;
                return;
            }
        }
        UvDnsPoll::destroy(poll);
    }

    /// POSIX `FilePoll` callback (kqueue/epoll). Windows has `on_dns_poll_uv`.
    #[cfg(not(windows))]
    pub(crate) fn on_dns_poll(&self, poll: &mut FilePoll) {
        let _exit = self.vm().enter_event_loop_scope();
        if self.channel.borrow().is_none() {
            poll.deinit();
            return;
        }
        // A refused datagram is EPOLLERR alone. As in libuv, an error is what was waited for, so that reading finds it.
        let failed = !poll
            .flags
            .is_disjoint(bun_io::PollFlag::Eof | bun_io::PollFlag::Hup);
        let readable =
            poll.is_readable() || (failed && poll.flags.contains(bun_io::PollFlag::PollReadable));
        let writable =
            poll.is_writable() || (failed && poll.flags.contains(bun_io::PollFlag::PollWritable));
        // The channel may close the socket, which frees `poll`.
        let socket = super::system_io::socket_of(poll.fd);
        self.with_channel(|channel, now| {
            channel.process(now, readable.then_some(socket), writable.then_some(socket))
        });
    }

    // ───────────── JS host fns: resolve* family ─────────────

    pub(crate) fn global_resolve(
        cx: &mut JsScope<'_>,
        name: &[u8],
        record: Option<&[u8]>,
    ) -> JsResult<JSValue> {
        global_resolver(cx.global()).resolve(cx, name, record)
    }

    pub(crate) fn resolve(
        &self,
        cx: &mut JsScope<'_>,
        name: &[u8],
        record: Option<&[u8]>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let context = global_this.bun_vm().context_of_caller().id();
        let record_type: Kind = match record {
            None | Some(b"") => Kind::A,
            Some(label) => match RECORD_TYPE_MAP.get(label) {
                Some(r) => *r,
                None => {
                    return Err(global_this.throw_invalid_argument_property_value(
                        b"record",
                        Some("one of: A, AAAA, ANY, CAA, CNAME, MX, NAPTR, NS, PTR, SOA, SRV, TXT"),
                        bun_string_jsc::create_utf8_for_js(global_this, label)?,
                    ));
                }
            },
        };

        if name.is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "resolve",
                "name",
                "non-empty string",
            ));
        }

        Ok(self.query(record_type, name, global_this, context))
    }

    pub(crate) fn global_reverse(cx: &mut JsScope<'_>, ip: &[u8]) -> JsResult<JSValue> {
        global_resolver(cx.global()).reverse(cx, ip)
    }

    pub(crate) fn reverse(&self, cx: &mut JsScope<'_>, ip: &[u8]) -> JsResult<JSValue> {
        let global_this = cx.global();
        let context = global_this.bun_vm().context_of_caller().id();
        if ip.is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "reverse",
                "ip",
                "non-empty string",
            ));
        }

        // "0000:0000:0000:0000:0000:ffff:192.168.100.228" is 45 bytes.
        let address = Some(ip)
            .filter(|ip| ip.len() <= 45)
            .and_then(bun_core::ip_address::parse_ares);
        let key = RequestKey::Reverse(ip.into());
        Ok(self.request(
            key,
            global_this,
            context,
            |channel, now, key| match address {
                Some(address) => channel.host_of_address(now, address, key),
                None => channel.fail(key, DnsError::ENOTIMP),
            },
        ))
    }

    pub(crate) fn global_lookup(
        cx: &mut JsScope<'_>,
        name: &[u8],
        options_object: &LookupOptions<'_>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let context = global_this.bun_vm().context_of_caller().id();
        if name.is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "lookup",
                "hostname",
                "non-empty string",
            ));
        }

        let mut port: u16 = 0;

        if let Some(port_value) = options_object.port {
            port = to_port_number(port_value, global_this)?;
        }

        let options = match super::options_jsc::options_from_js(options_object) {
            Ok(o) => o,
            Err(err) => {
                use bun_dns::OptionsFromJsError as E;
                return match err {
                    E::InvalidFlags => Err(global_this.throw_invalid_argument_value(
                        b"flags",
                        options_object
                            .flags
                            .map_or(JSValue::UNDEFINED, JSValue::js_number),
                    )),
                    // more information with these errors
                    _ => Err(global_this.throw(format_args!(
                        "Invalid options passed to lookup(): {}",
                        <&'static str>::from(&err)
                    ))),
                };
            }
        };

        let resolver = global_resolver(global_this);

        resolver.do_lookup(name, port, options, global_this, context)
    }

    pub(crate) fn do_lookup(
        &self,
        name: &[u8],
        port: u16,
        options: GetAddrInfoOptions,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> JsResult<JSValue> {
        if !bun_dns::is_valid_hostname(name) {
            let mut promise = JSPromiseStrong::init(global_this);
            let promise_value = promise.value();
            error_to_deferred(
                DnsError::ENOTFOUND,
                b"getaddrinfo",
                Some(name),
                &mut promise,
            )
            .reject_later(global_this, context);
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
            GetAddrInfoBackend::CAres => self.channel_lookup(&query, global_this, context),
            GetAddrInfoBackend::Libc => {
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(self, query, global_this, context)?
                }
                #[cfg(not(windows))]
                {
                    lib_c::lookup(self, &query, global_this, context)
                }
            }
            GetAddrInfoBackend::System => {
                #[cfg(target_os = "macos")]
                {
                    dns_sd::lookup(self, &query, global_this, context)
                }
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(self, query, global_this, context)?
                }
                #[cfg(all(not(target_os = "macos"), not(windows)))]
                {
                    lib_c::lookup(self, &query, global_this, context)
                }
            }
        })
    }

    // ───────── per-record-type global+instance resolve fns ─────────
    // These are mechanically identical across record types.
}

macro_rules! resolve_record_fn {
    ($global:ident, $method:ident, $jsname:literal, $kind:expr, $allow_empty:expr) => {
        pub(crate) fn $global(cx: &mut JsScope<'_>, name: &[u8]) -> JsResult<JSValue> {
            global_resolver(cx.global()).$method(cx, name)
        }

        pub(crate) fn $method(&self, cx: &mut JsScope<'_>, name: &[u8]) -> JsResult<JSValue> {
            let global_this = cx.global();
            let context = global_this.bun_vm().context_of_caller().id();
            if !$allow_empty && name.is_empty() {
                return Err(global_this.throw_invalid_argument_type(
                    $jsname,
                    "hostname",
                    "non-empty string",
                ));
            }
            Ok(self.query($kind, name, global_this, context))
        }
    };
}

impl Resolver {
    /// The one place a channel is torn down: every pending request fails with
    /// `EDESTRUCTION` (releasing its waiters' refs on this resolver) and the
    /// channel's sockets are closed. Returns whether there was a channel.
    fn destroy_channel(&self) -> bool {
        let Some(mut channel) = self.channel.borrow_mut().take() else {
            return false;
        };
        self.abort_handle.leave();
        channel.shut_down(monotonic_now());
        while let Some(completion) = channel.next_completion() {
            self.settle(completion);
        }
        true
    }
}

impl Resolver {
    resolve_record_fn!(
        global_resolve_srv,
        resolve_srv,
        "resolveSrv",
        Kind::Srv,
        false
    );
    resolve_record_fn!(
        global_resolve_soa,
        resolve_soa,
        "resolveSoa",
        Kind::Soa,
        true
    );
    resolve_record_fn!(
        global_resolve_caa,
        resolve_caa,
        "resolveCaa",
        Kind::Caa,
        false
    );
    resolve_record_fn!(global_resolve_ns, resolve_ns, "resolveNs", Kind::Ns, true);
    resolve_record_fn!(
        global_resolve_ptr,
        resolve_ptr,
        "resolvePtr",
        Kind::Ptr,
        false
    );
    resolve_record_fn!(
        global_resolve_cname,
        resolve_cname,
        "resolveCname",
        Kind::Cname,
        false
    );
    resolve_record_fn!(global_resolve_mx, resolve_mx, "resolveMx", Kind::Mx, false);
    resolve_record_fn!(
        global_resolve_naptr,
        resolve_naptr,
        "resolveNaptr",
        Kind::Naptr,
        false
    );
    resolve_record_fn!(
        global_resolve_txt,
        resolve_txt,
        "resolveTxt",
        Kind::Txt,
        false
    );
    resolve_record_fn!(
        global_resolve_any,
        resolve_any,
        "resolveAny",
        Kind::Any,
        false
    );

    fn query(
        &self,
        kind: Kind,
        name: &[u8],
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> JSValue {
        let key = RequestKey::Query(kind, name.into());
        self.request(key, global_this, context, |channel, now, key| {
            channel.query(now, kind, name, key)
        })
    }

    /// `backend: "c-ares"`, the name it had when c-ares was what answered.
    fn channel_lookup(
        &self,
        query: &GetAddrInfo,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> JSValue {
        let family = match query.options.family {
            bun_dns::Family::Unspecified => Family::Unspecified,
            bun_dns::Family::Inet => Family::V4,
            bun_dns::Family::Inet6 => Family::V6,
        };
        let key = RequestKey::AddrInfo {
            name: query.name.clone(),
            port: query.port,
            family,
        };
        self.request(key, global_this, context, |channel, now, key| {
            channel.addr_info(now, &query.name, query.port, family, key)
        })
    }

    // ───────── servers / local address ─────────

    /// https://nodejs.org/api/dns.html#dnsgetservers
    pub(crate) fn get_servers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        let servers = self.with_channel(|channel, _| channel.servers());
        let values = JSValue::create_empty_array(global_this, servers.len())?;
        for (i, server) in servers.iter().enumerate() {
            let address = bun_core::ip_address::format(server.address);
            let address = bstr::BStr::new(&*address);
            let text = match (server.tcp_port, server.address) {
                (IANA_DNS_PORT, _) => format!("{address}"),
                (port, IpAddr::V4(_)) => format!("{address}:{port}"),
                (port, IpAddr::V6(_)) => format!("[{address}]:{port}"),
            };
            values.put_index(
                global_this,
                i as u32,
                bun_string_jsc::create_utf8_for_js(global_this, text.as_bytes())?,
            )?;
        }
        Ok(values)
    }

    pub(crate) fn get_global_servers(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        global_resolver(cx.global()).get_servers(cx)
    }

    pub(crate) fn set_local_address(
        &self,
        cx: &mut JsScope<'_>,
        first: &bun_core::String,
        second: Option<bun_core::String>,
    ) -> JsResult<()> {
        let global_this = cx.global();
        let first = self.set_one_local_address(global_this, first)?;
        let Some(second) = second else {
            return Ok(());
        };
        let second = self.set_one_local_address(global_this, &second)?;
        match (first, second) {
            (IpAddr::V4(_), IpAddr::V4(_)) => Err(global_this
                .throw_invalid_arguments(format_args!("Cannot specify two IPv4 addresses."))),
            (IpAddr::V6(_), IpAddr::V6(_)) => Err(global_this
                .throw_invalid_arguments(format_args!("Cannot specify two IPv6 addresses."))),
            _ => Ok(()),
        }
    }

    fn set_one_local_address(
        &self,
        global_this: &JSGlobalObject,
        value: &bun_core::String,
    ) -> JsResult<IpAddr> {
        let text = value.to_utf8();
        let Some(address) = bun_core::ip_address::parse_ares(&text) else {
            return Err(jsc::Error::INVALID_IP_ADDRESS.throw(
                global_this,
                format_args!("Invalid IP address: \"{}\"", bstr::BStr::new(&*text)),
            ));
        };
        self.with_channel(|channel, _| match address {
            IpAddr::V4(v4) => channel.set_local_v4(v4),
            IpAddr::V6(v6) => channel.set_local_v6(v6),
        });
        Ok(address)
    }

    pub(crate) fn set_servers(&self, cx: &mut JsScope<'_>, servers: JsLocal<'_>) -> JsResult<()> {
        let global_this = cx.global();
        let argument = servers.to_js();
        // It's okay to call dns.setServers with active queries, but not dns.Resolver.setServers
        let is_global = self.made_in.is_none();
        if !is_global && self.with_channel(|channel, _| channel.active_queries()) != 0 {
            return Err(global_this
                .err(
                    jsc::Error::DNS_SET_SERVERS_FAILED,
                    format_args!("Failed to set servers: there are pending queries"),
                )
                .throw());
        }

        if !argument.is_array() {
            return Err(global_this.throw_invalid_argument_type("setServers", "servers", "array"));
        }

        let mut triples_iterator = argument.array_iterator(global_this)?;
        let mut list: Vec<ServerConfig> = Vec::with_capacity(triples_iterator.len as usize);

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
                .coerce_to_i32(global_this)? as u16;

            if family != 4 && family != 6 {
                return Err(
                    global_this.throw_invalid_arguments(format_args!("Invalid address family"))
                );
            }

            let address_string = triple
                .get_index(global_this, 1)?
                .to_bun_string(global_this)?;
            let text = address_string.to_utf8();
            let address: Option<IpAddr> = match family {
                4 => bun_core::ip_address::parse_ares_v4(&text).map(Into::into),
                _ => bun_core::ip_address::parse_ares_v6(&text).map(Into::into),
            };
            let Some(address) = address else {
                return Err(jsc::Error::INVALID_IP_ADDRESS.throw(
                    global_this,
                    format_args!("Invalid IP address: \"{}\"", bstr::BStr::new(&*text)),
                ));
            };
            list.push(ServerConfig {
                address,
                udp_port: port,
                tcp_port: port,
                scope_id: 0,
            });
        }

        self.with_channel(|channel, now| channel.set_servers(now, &list));
        Ok(())
    }

    pub(crate) fn set_global_servers(cx: &mut JsScope<'_>, servers: JsLocal<'_>) -> JsResult<()> {
        global_resolver(cx.global()).set_servers(cx, servers)
    }

    pub(crate) fn new_resolver(cx: &mut JsScope<'_>, options: &ResolverOptions) -> JSValue {
        let global_this = cx.global();
        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        let resolver = Resolver::init(
            global_this.bun_vm(),
            Some(global_this.bun_vm().context_of_caller().id()),
        );

        // Zero and less ask for the default.
        let positive = |option: i32| u32::try_from(option).ok().filter(|&it| it != 0);
        // SAFETY: `resolver` is the heap allocation from `init`; not yet
        // wrapped in JS so exclusively owned here.
        unsafe { &(*resolver).options }.set(bun_dns_resolver::Options {
            timeout_ms: positive(options.timeout),
            tries: positive(options.tries),
        });

        // SAFETY: `resolver` was `heap::alloc`'d in `Resolver::init`; ownership
        // transfers to the JS wrapper, which holds one ref.
        unsafe { Resolver::to_js_ptr(resolver, global_this) }
    }

    pub(crate) fn cancel(&self, _cx: &mut JsScope<'_>) -> JsResult<()> {
        self.with_channel(|channel, now| channel.cancel(now));
        Ok(())
    }

    // Resolves the given address and port into a host name and service using the operating system's underlying getnameinfo implementation.
    // If address is not a valid IP address, a TypeError will be thrown. The port will be coerced to a number.
    // If it is not a legal port, a TypeError will be thrown.
    pub(crate) fn global_lookup_service(
        cx: &mut JsScope<'_>,
        addr_s: &[u8],
        port_value: f64,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let context = global_this.bun_vm().context_of_caller().id();
        if addr_s.is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "lookupService",
                "address",
                "non-empty string",
            ));
        }

        let port: u16 = to_port_number(port_value, global_this)?;

        let address = Some(addr_s)
            .filter(|text| text.len() < 128)
            .and_then(bun_core::ip_address::parse_ares);
        let Some(address) = address else {
            return Err(global_this.throw_invalid_argument_value(
                b"address",
                bun_string_jsc::create_utf8_for_js(global_this, addr_s)?,
            ));
        };
        // The OS getnameinfo Node uses looks `::ffff:a.b.c.d` up as IPv4. Under ip6.arpa it never resolves.
        let address = match address {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(address, IpAddr::V4),
            IpAddr::V4(_) => address,
        };

        let key = RequestKey::NameInfo(
            format!("{}|{}", bstr::BStr::new(addr_s), port)
                .into_bytes()
                .into(),
        );
        Ok(
            global_resolver(global_this).request(key, global_this, context, |channel, now, key| {
                channel.name_info(now, SocketAddr::new(address, port), key)
            }),
        )
    }

    pub(crate) fn get_runtime_default_result_order_option() -> bun::String {
        // `VirtualMachine.dns_result_order` is stored as a raw `u8` (the jsc
        // crate cannot depend on this crate's `Order`); cast through Order's repr(u8).
        let raw = VirtualMachine::get().dns_result_order;
        let order = match raw {
            4 => Order::Ipv4first,
            6 => Order::Ipv6first,
            _ => Order::Verbatim,
        };
        bun::String::static_(<&'static str>::from(order))
    }
}
