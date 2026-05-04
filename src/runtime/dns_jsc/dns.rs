//! DNS resolver — JSC bindings.
//! Port of `src/runtime/dns_jsc/dns.zig`.

use core::ffi::{c_char, c_int, c_void};
use core::mem::{offset_of, MaybeUninit};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use bun_jsc::{
    self as jsc, host_fn, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, SystemError,
    VirtualMachine, ZigString,
};
use bun_aio::{self as Async, FilePoll, KeepAlive};
use bun_core::{self as bun, env_var, feature_flag, fmt as bun_fmt, Global, Mutex, Output};
use bun_collections::{ArrayHashMap, HiveArray};
use bun_dns::GetAddrInfo;
use bun_paths::{PathBuffer, MAX_PATH_BYTES};
use bun_str::{self, strings, ZStr, ZigString as ZigStringSlice};
use bun_sys::{self as sys, libc, mach_port};
use bun_sys::windows::libuv;
use bun_threading::ThreadPool;
use bun_uws::{self as uws, ConnectingSocket, Loop};
use bun_wyhash::hash as wyhash;

use crate::c_ares;
use crate::Timer::EventLoopTimer;

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

pub type GetAddrInfoAsyncCallback =
    unsafe extern "C" fn(i32, *mut libc::addrinfo, *mut c_void);

#[cfg(windows)]
const INET6_ADDRSTRLEN: usize = 65;
#[cfg(not(windows))]
const INET6_ADDRSTRLEN: usize = 46;

const IANA_DNS_PORT: i32 = 53;

// ──────────────────────────────────────────────────────────────────────────
// LibInfo (macOS libinfo async getaddrinfo)
// ──────────────────────────────────────────────────────────────────────────

pub mod lib_info {
    use super::*;

    // static int32_t (*getaddrinfo_async_start)(mach_port_t*, const char*, const char*,
    //                                           const struct addrinfo*, getaddrinfo_async_callback, void*);
    // static int32_t (*getaddrinfo_async_handle_reply)(void*);
    // static void (*getaddrinfo_async_cancel)(mach_port_t);
    // typedef void getaddrinfo_async_callback(int32_t, struct addrinfo*, void*)
    pub type GetaddrinfoAsyncStart = unsafe extern "C" fn(
        *mut mach_port,
        node: *const c_char,
        service: *const c_char,
        hints: *const libc::addrinfo,
        callback: GetAddrInfoAsyncCallback,
        context: *mut c_void,
    ) -> i32;
    pub type GetaddrinfoAsyncHandleReply = unsafe extern "C" fn(*mut mach_port) -> i32;
    pub type GetaddrinfoAsyncCancel = unsafe extern "C" fn(*mut mach_port);

    static mut HANDLE: *mut c_void = ptr::null_mut();
    static mut LOADED: bool = false;

    pub fn get_handle() -> *mut c_void {
        // SAFETY: single-threaded init on JS thread; matches Zig's unguarded statics.
        unsafe {
            if LOADED {
                return HANDLE;
            }
            LOADED = true;
            HANDLE = sys::dlopen(b"libinfo.dylib\0", sys::DlopenFlags::LAZY | sys::DlopenFlags::LOCAL);
            if HANDLE.is_null() {
                Output::debug("libinfo.dylib not found", &[]);
            }
            HANDLE
        }
    }

    pub fn getaddrinfo_async_start() -> Option<GetaddrinfoAsyncStart> {
        bun_core::Environment::only_mac();
        sys::dlsym_with_handle::<GetaddrinfoAsyncStart>(b"getaddrinfo_async_start\0", get_handle)
    }

    pub fn getaddrinfo_async_handle_reply() -> Option<GetaddrinfoAsyncHandleReply> {
        bun_core::Environment::only_mac();
        sys::dlsym_with_handle::<GetaddrinfoAsyncHandleReply>(
            b"getaddrinfo_async_handle_reply\0",
            get_handle,
        )
    }

    pub fn get() -> Option<GetaddrinfoAsyncCancel> {
        bun_core::Environment::only_mac();
        sys::dlsym_with_handle::<GetaddrinfoAsyncCancel>(b"getaddrinfo_async_cancel\0", get_handle)
    }

    pub fn lookup(this: &mut Resolver, query: GetAddrInfo, global_this: &JSGlobalObject) -> JSValue {
        bun_core::Environment::only_mac();

        let Some(getaddrinfo_async_start_) = getaddrinfo_async_start() else {
            return lib_c::lookup(this, query, global_this);
        };

        let key = get_addr_info_request::PendingCacheKey::init(&query);
        let cache = this.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheNative);

        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this, global_this);
            // SAFETY: inflight points into resolver's HiveArray buffer
            unsafe { (*inflight).append(dns_lookup) };
            return unsafe { (*dns_lookup).promise.value() };
        }

        // PERF(port): was StackFallbackAllocator(1024) — profile in Phase B
        let name_z = bun_str::ZStr::from_bytes(query.name.as_ref());

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libinfo(get_addr_info_request::BackendLibInfo::default()),
            Some(this),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );
        // SAFETY: request was just Box::into_raw'd in init() and is exclusively owned here.
        let promise_value = unsafe { (*request).head.promise.value() };

        let hints = query.options.to_libc();
        // SAFETY: FFI call into libinfo; request is heap-allocated and lives until callback.
        let errno = unsafe {
            getaddrinfo_async_start_(
                &mut (*request).backend.as_libinfo_mut().machport,
                name_z.as_ptr() as *const c_char,
                ptr::null(),
                hints.as_ref().map(|h| h as *const _).unwrap_or(ptr::null()),
                GetAddrInfoRequest::get_addr_info_async_callback,
                request as *mut c_void,
            )
        };

        if errno != 0 {
            let err_tag: &'static str = sys::get_errno(errno).into();
            // SAFETY: request is exclusively owned (callback was never registered).
            let _ = unsafe {
                (*request).head.promise.reject_task(
                    global_this,
                    global_this.create_error_instance(
                        format_args!("getaddrinfo_async_start error: {}", err_tag),
                    ),
                )
            }; // TODO: properly propagate exception upwards
            // SAFETY: request is exclusively owned; freed below via Box::from_raw.
            unsafe {
                if (*request).cache.pending_cache() {
                    // Release the pending-cache slot. `getOrPutIntoPendingCache` already
                    // set the `used` bit via `HiveArray.get`, so failing to unset it here
                    // permanently orphans the slot and leaves `buffer[pos].lookup` pointing
                    // at the request we are about to free (UAF on the next `.inflight` hit).
                    let pos = (*request).cache.pos_in_pending();
                    this.pending_host_cache_native.buffer[pos as usize] = MaybeUninit::uninit().assume_init();
                    this.pending_host_cache_native.used.unset(pos as usize);
                }
                // Drop the KeepAlive + resolver ref that `GetAddrInfoRequest.init` took.
                DNSLookup::destroy(&mut (*request).head);
                drop(Box::from_raw(request));
            }
            return promise_value;
        }

        // SAFETY: request is live until the FilePoll callback fires.
        debug_assert!(unsafe { (*request).backend.as_libinfo().machport } != 0);
        let poll = FilePoll::init(
            this.vm,
            // TODO: WHAT?????????
            sys::Fd::from_native(i32::MAX - 1),
            Default::default(),
            // TODO(port): FilePoll generic owner type GetAddrInfoRequest
            request,
        );
        // SAFETY: request is live (heap-allocated) and exclusively accessed on this thread.
        unsafe { (*request).backend.as_libinfo_mut().file_poll = Some(poll) };
        // SAFETY: see above.
        let machport = unsafe { (*request).backend.as_libinfo().machport };
        let rc = poll.register_with_fd(
            this.vm.event_loop_handle.unwrap(),
            Async::PollKind::Machport,
            Async::PollMode::OneShot,
            // SAFETY: bitcast u32 mach_port → i32 fd, matches Zig @bitCast
            sys::Fd::from_native(unsafe { core::mem::transmute::<u32, i32>(machport) }),
        );
        debug_assert!(matches!(rc, sys::Result::Ok(_)));

        poll.enable_keeping_process_alive(this.vm.event_loop());
        this.request_sent(global_this.bun_vm());

        promise_value
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LibC (blocking getaddrinfo on a worker thread; non-Windows)
// ──────────────────────────────────────────────────────────────────────────

pub mod lib_c {
    use super::*;

    #[cfg(not(windows))]
    pub fn lookup(this: &mut Resolver, query_init: GetAddrInfo, global_this: &JSGlobalObject) -> JSValue {
        let key = get_addr_info_request::PendingCacheKey::init(&query_init);

        let cache = this.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheNative);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this, global_this);
            // SAFETY: inflight points into resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(dns_lookup) };
            // SAFETY: dns_lookup just Box::into_raw'd; owned by the inflight list.
            return unsafe { (*dns_lookup).promise.value() };
        }

        let query = query_init.clone();

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::Query(query.clone())),
            Some(this),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );
        // SAFETY: request was just Box::into_raw'd in init() and is exclusively owned here.
        let promise_value = unsafe { (*request).head.promise.value() };

        let io = get_addr_info_request::Task::create_on_js_thread(global_this, request);
        io.schedule();
        this.request_sent(global_this.bun_vm());

        promise_value
    }

    #[cfg(windows)]
    pub fn lookup(_this: &mut Resolver, _query_init: GetAddrInfo, _global_this: &JSGlobalObject) -> JSValue {
        unreachable!("Do not use this path on Windows");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LibUVBackend (Windows uv_getaddrinfo)
// ──────────────────────────────────────────────────────────────────────────

/// The windows implementation borrows the struct used for libc getaddrinfo
pub mod lib_uv_backend {
    use super::*;

    struct Holder {
        uv_info: *mut libuv::uv_getaddrinfo_t,
        task: jsc::AnyTask,
    }

    impl Holder {
        fn run(held: *mut Self) {
            // SAFETY: held was Box::into_raw'd in on_raw_libuv_complete
            let held = unsafe { Box::from_raw(held) };
            GetAddrInfoRequest::on_libuv_complete(held.uv_info);
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

        let holder = Box::into_raw(Box::new(Holder {
            uv_info,
            task: unsafe { MaybeUninit::zeroed().assume_init() },
        }));
        // SAFETY: holder is a valid heap allocation
        unsafe {
            (*holder).task = jsc::AnyTask::new::<Holder>(Holder::run, holder);
            (*this)
                .head
                .global_this
                .bun_vm()
                .enqueue_task(jsc::Task::init(&mut (*holder).task));
        }
    }

    pub fn lookup(
        this: &mut Resolver,
        query: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // TODO(port): narrow error set
        let key = get_addr_info_request::PendingCacheKey::init(&query);

        let cache = this.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheNative);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this, global_this);
            unsafe { (*inflight).append(dns_lookup) };
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::uv_uninit()),
            Some(this),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );

        let hints = query.options.to_libc();
        let mut port_buf = [0u8; 128];
        let port_len = bun_fmt::print_int(&mut port_buf, query.port, 10);
        port_buf[port_len] = 0;
        // SAFETY: port_buf[port_len] == 0 written above
        let port_z = unsafe { ZStr::from_raw(port_buf.as_ptr(), port_len) };

        let mut hostname = PathBuffer::uninit();
        // Reserve the last byte for the NUL terminator so the index below can never
        // exceed the buffer even if the upstream length guard in `doLookup` is bypassed.
        let copied = strings::copy(&mut hostname[..hostname.len() - 1], query.name.as_ref());
        hostname[copied.len()] = 0;
        // SAFETY: hostname[copied.len()] == 0 written above
        let host = unsafe { ZStr::from_raw(hostname.as_ptr(), copied.len()) };

        // SAFETY: request lives until completion; backend.libc.uv is the embedded uv_getaddrinfo_t
        let promise = unsafe {
            (*request).backend.as_libc_uv_mut().data = request as *mut c_void;
            let promise = (*request).head.promise.value();
            let rc = libuv::uv_getaddrinfo(
                this.vm.uv_loop(),
                (*request).backend.as_libc_uv_mut(),
                Some(on_raw_libuv_complete),
                host.as_ptr() as *const c_char,
                port_z.as_ptr() as *const c_char,
                hints.as_ref().map(|h| h as *const _).unwrap_or(ptr::null()),
            );
            if rc.int() < 0 {
                // uv_getaddrinfo can fail synchronously before it queues any work
                // (e.g. UV_EINVAL from the 256-byte IDNA buffer for long hostnames,
                // or UV_ENOMEM). Route the error through the same path the async
                // completion would have taken so the pending-cache slot is released
                // and the promise is rejected with a DNSException.
                if let Some(resolver) = (*request).resolver_for_caching {
                    if (*request).cache.pending_cache() {
                        (*resolver).drain_pending_host_native(
                            (*request).cache.pos_in_pending(),
                            (*request).head.global_this,
                            rc.int(),
                            GetAddrInfo::Result::Any::Addrinfo(ptr::null_mut()),
                        );
                        return Ok(promise);
                    }
                }
                let mut head = core::ptr::read(&(*request).head);
                head.process_get_addr_info_native(rc.int(), ptr::null_mut());
                drop(Box::from_raw(request));
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

pub fn normalize_dns_name<'a>(name: &'a [u8], backend: &mut GetAddrInfo::Backend) -> &'a [u8] {
    if *backend == GetAddrInfo::Backend::CAres {
        // https://github.com/c-ares/c-ares/issues/477
        if name.ends_with(b".localhost") {
            *backend = GetAddrInfo::Backend::System;
            return b"localhost";
        } else if name.ends_with(b".local") {
            *backend = GetAddrInfo::Backend::System;
            // https://github.com/c-ares/c-ares/pull/463
        } else if strings::is_ipv6_address(name) {
            *backend = GetAddrInfo::Backend::System;
        }
        // getaddrinfo() is inconsistent with ares_getaddrinfo() when using localhost
        else if name == b"localhost" {
            *backend = GetAddrInfo::Backend::System;
        }
    }

    name
}

// ──────────────────────────────────────────────────────────────────────────
// CacheConfig — packed struct(u16) shared by all request types
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Copy, Clone, Default)]
pub struct CacheConfig(u16);

impl CacheConfig {
    #[inline] pub const fn pending_cache(self) -> bool { self.0 & 0x0001 != 0 }
    #[inline] pub const fn entry_cache(self) -> bool { self.0 & 0x0002 != 0 }
    #[inline] pub const fn pos_in_pending(self) -> u8 { ((self.0 >> 2) & 0x1F) as u8 }
    #[inline] pub const fn name_len(self) -> u16 { (self.0 >> 7) & 0x1FF }
    #[inline]
    pub const fn new(pending_cache: bool, entry_cache: bool, pos_in_pending: u8, name_len: u16) -> Self {
        Self(
            (pending_cache as u16)
                | ((entry_cache as u16) << 1)
                | (((pos_in_pending as u16) & 0x1F) << 2)
                | ((name_len & 0x1FF) << 7),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ResolveInfoRequest<T> — generic c-ares record request (SRV/SOA/TXT/…)
// ──────────────────────────────────────────────────────────────────────────

/// Trait standing in for Zig's `(comptime cares_type: type, comptime type_name: []const u8)` pair.
/// Each c-ares reply struct implements this with its record-type tag.
// TODO(port): proc-macro — Zig instantiated this per (type, "name") pair via comptime.
pub trait CAresRecordType: Sized {
    const TYPE_NAME: &'static str;
    /// `"pending_{TYPE_NAME}_cache_cares"` — used to reach the matching HiveArray on `Resolver`.
    const CACHE_FIELD: PendingCacheField;
    fn to_js_response(&mut self, global: &JSGlobalObject, type_name: &'static str) -> JsResult<JSValue>;
    /// Free a c-ares-allocated reply struct (`ares_free_data` / `ares_free_hostent`).
    /// SAFETY: `this` must be the pointer c-ares handed to the callback; not aliased.
    unsafe fn destroy(this: *mut Self);
}

pub struct ResolveInfoRequest<T: CAresRecordType> {
    // TODO(port): lifetime — TSV says BORROW_PARAM → Option<&'a Resolver> (struct gets <'a>); raw ptr until Phase B reconciles with intrusive RC
    pub resolver_for_caching: Option<*mut Resolver>,
    pub hash: u64,
    pub cache: CacheConfig,
    pub head: CAresLookup<T>,
    pub tail: *mut CAresLookup<T>, // INTRUSIVE — points at `head` or last appended node
}

pub mod resolve_info_request {
    use super::*;

    pub struct PendingCacheKey<T: CAresRecordType> {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut ResolveInfoRequest<T>,
    }

    impl<T: CAresRecordType> PendingCacheKey<T> {
        pub fn append(&mut self, cares_lookup: *mut CAresLookup<T>) {
            // SAFETY: lookup/tail are valid while request is in the pending cache
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(cares_lookup);
                (*self.lookup).tail = cares_lookup;
            }
        }

        pub fn init(name: &[u8]) -> Self {
            let hash = wyhash(name);
            Self { hash, len: name.len() as u16, lookup: ptr::null_mut() }
        }
    }
}

impl<T: CAresRecordType> ResolveInfoRequest<T> {
    pub fn init(
        cache: LookupCacheHit<Self>,
        resolver: Option<*mut Resolver>,
        name: &[u8],
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        let hash = wyhash(name);
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        let request = Box::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            hash,
            cache: CacheConfig::default(),
            head: CAresLookup {
                // SAFETY: resolver is a live intrusive-RC m_ctx; clone_from_raw bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::clone_from_raw(r) }),
                global_this,
                promise: JSPromise::Strong::init(global_this),
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
        unsafe { (*request).tail = &mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            // SAFETY: `new` is &mut into resolver's HiveArray buffer
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_cache_for::<T>(cache_field)
                    .index_of(new)
                    .unwrap();
                (*request).cache = CacheConfig::new(true, false, pos as u8, name.len() as u16);
                (*new).lookup = request;
            }
        }
        request
    }

    pub fn on_cares_complete(this: *mut Self, err_: Option<c_ares::Error>, timeout: i32, result: Option<*mut T>) {
        // SAFETY: this is the heap-allocated request c-ares calls back with
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                let _guard = scopeguard::guard((), |_| (*resolver).request_completed());
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_cares::<T>(
                        (*this).cache.pos_in_pending(),
                        err_,
                        timeout,
                        result,
                    );
                    return;
                }
            }

            let mut head = core::ptr::read(&(*this).head);
            drop(Box::from_raw(this));
            head.process_resolve(err_, timeout, result);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetHostByAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub struct GetHostByAddrInfoRequest {
    // TODO(port): lifetime — TSV says BORROW_PARAM → Option<&'a Resolver>; raw ptr until Phase B
    pub resolver_for_caching: Option<*mut Resolver>,
    pub hash: u64,
    pub cache: CacheConfig,
    pub head: CAresReverse,
    pub tail: *mut CAresReverse, // INTRUSIVE
}

pub mod get_host_by_addr_info_request {
    use super::*;

    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut GetHostByAddrInfoRequest,
    }

    impl PendingCacheKey {
        pub fn append(&mut self, cares_lookup: *mut CAresReverse) {
            // SAFETY: lookup/tail are valid while request is in the pending cache
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(cares_lookup);
                (*self.lookup).tail = cares_lookup;
            }
        }

        pub fn init(name: &[u8]) -> Self {
            let hash = wyhash(name);
            Self { hash, len: name.len() as u16, lookup: ptr::null_mut() }
        }
    }
}

impl GetHostByAddrInfoRequest {
    pub fn init(
        cache: LookupCacheHit<Self>,
        resolver: Option<*mut Resolver>,
        name: &[u8],
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        let hash = wyhash(name);
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        let request = Box::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            hash,
            cache: CacheConfig::default(),
            head: CAresReverse {
                // SAFETY: resolver is a live intrusive-RC m_ctx; clone_from_raw bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::clone_from_raw(r) }),
                global_this,
                promise: JSPromise::Strong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
                name: Box::<[u8]>::from(name),
            },
            tail: ptr::null_mut(),
        }));
        // SAFETY: request just allocated; head is an inline field.
        unsafe { (*request).tail = &mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            // SAFETY: `new` is &mut into resolver's HiveArray buffer; resolver/request are live.
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_addr_cache_cares
                    .index_of(new)
                    .unwrap();
                (*request).cache = CacheConfig::new(true, false, pos as u8, name.len() as u16);
                (*new).lookup = request;
            }
        }
        // TODO(port): cache_field is always "pending_addr_cache_cares" for this type
        let _ = cache_field;
        request
    }

    pub fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        // SAFETY: this is the heap-allocated request c-ares calls back with
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_addr_cares(
                        (*this).cache.pos_in_pending(),
                        err_,
                        timeout,
                        result,
                    );
                    return;
                }
            }

            let mut head = core::ptr::read(&(*this).head);
            drop(Box::from_raw(this));
            head.process_resolve(err_, timeout, result);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresNameInfo
// ──────────────────────────────────────────────────────────────────────────

pub struct CAresNameInfo {
    pub global_this: &'static JSGlobalObject, // JSC_BORROW
    pub promise: JSPromise::Strong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresNameInfo>>, // INTRUSIVE
    pub name: Box<[u8]>,
}

impl CAresNameInfo {
    pub fn init(global_this: &JSGlobalObject, name: Box<[u8]>) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        Box::into_raw(Box::new(Self {
            // SAFETY: JSGlobalObject lives for the program's JS lifetime
            global_this: unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global_this) },
            promise: JSPromise::Strong::init(global_this),
            poll_ref,
            allocated: true,
            next: None,
            name,
        }))
    }

    pub fn process_resolve(
        &mut self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        if let Some(err) = err_ {
            err.to_deferred("getnameinfo", Some(&self.name), &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        }
        let Some(mut name_info) = result else {
            c_ares::Error::ENOTFOUND
                .to_deferred("getnameinfo", Some(&self.name), &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        };
        let array = name_info
            .to_js_response(self.global_this)
            .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
        self.on_complete(array);
    }

    pub fn on_complete(&mut self, result: JSValue) {
        let promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this;
        let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
        // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
        unsafe { Self::destroy(self as *mut Self) };
    }

    /// Conditionally free a heap-allocated tail node. Head nodes (`allocated == false`)
    /// are inline fields of the parent `*Request` and freed when that Box drops.
    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `Box::into_raw` in `init()`.
    // TODO(port): callers reach this via &mut self methods — reshape those to *mut Self in Phase B.
    pub unsafe fn destroy(this: *mut Self) {
        if (*this).allocated {
            drop(Box::from_raw(this));
        } else {
            core::ptr::drop_in_place(this);
        }
    }
}

impl Drop for CAresNameInfo {
    fn drop(&mut self) {
        self.poll_ref.unref(self.global_this.bun_vm());
        // self.name freed by Box<[u8]> Drop
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetNameInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub struct GetNameInfoRequest {
    // TODO(port): lifetime — TSV says BORROW_PARAM → Option<&'a Resolver>; raw ptr until Phase B
    pub resolver_for_caching: Option<*mut Resolver>,
    pub hash: u64,
    pub cache: CacheConfig,
    pub head: CAresNameInfo,
    pub tail: *mut CAresNameInfo, // INTRUSIVE
}

pub mod get_name_info_request {
    use super::*;

    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut GetNameInfoRequest,
    }

    impl PendingCacheKey {
        pub fn append(&mut self, cares_lookup: *mut CAresNameInfo) {
            // SAFETY: lookup/tail are valid while request is in the pending cache
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(cares_lookup);
                (*self.lookup).tail = cares_lookup;
            }
        }

        pub fn init(name: &[u8]) -> Self {
            let hash = wyhash(name);
            Self { hash, len: name.len() as u16, lookup: ptr::null_mut() }
        }
    }
}

impl GetNameInfoRequest {
    pub fn init(
        cache: LookupCacheHit<Self>,
        resolver: Option<*mut Resolver>,
        name: Box<[u8]>,
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        let hash = wyhash(&name);
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        let name_len = name.len();
        let request = Box::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            hash,
            cache: CacheConfig::default(),
            head: CAresNameInfo {
                global_this: unsafe { core::mem::transmute(global_this) },
                promise: JSPromise::Strong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
                name,
            },
            tail: ptr::null_mut(),
        }));
        unsafe { (*request).tail = &mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_nameinfo_cache_cares
                    .index_of(new)
                    .unwrap();
                (*request).cache = CacheConfig::new(true, false, pos as u8, name_len as u16);
                (*new).lookup = request;
            }
        }
        let _ = cache_field;
        request
    }

    pub fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                let _guard = scopeguard::guard((), |_| (*resolver).request_completed());
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_name_info_cares(
                        (*this).cache.pos_in_pending(),
                        err_,
                        timeout,
                        result,
                    );
                    return;
                }
            }

            let mut head = core::ptr::read(&(*this).head);
            drop(Box::from_raw(this));
            head.process_resolve(err_, timeout, result);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetAddrInfoRequest
// ──────────────────────────────────────────────────────────────────────────

pub struct GetAddrInfoRequest {
    pub backend: get_addr_info_request::Backend,
    // TODO(port): lifetime — TSV says BORROW_PARAM → Option<&'a Resolver>; raw ptr until Phase B
    pub resolver_for_caching: Option<*mut Resolver>,
    pub hash: u64,
    pub cache: CacheConfig,
    pub head: DNSLookup,
    pub tail: *mut DNSLookup, // INTRUSIVE
    pub task: ThreadPool::Task,
}

pub mod get_addr_info_request {
    use super::*;

    pub type Task = jsc::WorkTask<GetAddrInfoRequest>;

    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut GetAddrInfoRequest,
    }

    impl PendingCacheKey {
        pub fn append(&mut self, dns_lookup: *mut DNSLookup) {
            unsafe {
                let tail = (*self.lookup).tail;
                (*tail).next = NonNull::new(dns_lookup);
                (*self.lookup).tail = dns_lookup;
            }
        }

        pub fn init(query: &GetAddrInfo) -> Self {
            Self {
                hash: query.hash(),
                len: query.name.len() as u16,
                lookup: ptr::null_mut(),
            }
        }
    }

    pub struct BackendLibInfo {
        pub file_poll: Option<Box<FilePoll>>, // OWNED
        pub machport: mach_port,
    }

    impl Default for BackendLibInfo {
        fn default() -> Self { Self { file_poll: None, machport: 0 } }
    }

    impl BackendLibInfo {
        // TODO(port): move to <area>_sys
        unsafe extern "C" {
            fn getaddrinfo_send_reply(
                port: mach_port,
                reply: lib_info::GetaddrinfoAsyncHandleReply,
            ) -> bool;
        }

        pub fn on_machport_change(this: *mut GetAddrInfoRequest) {
            #[cfg(not(target_os = "macos"))]
            { unreachable!(); }
            #[cfg(target_os = "macos")]
            unsafe {
                jsc::mark_binding(core::panic::Location::caller());
                if !getaddrinfo_send_reply(
                    (*this).backend.as_libinfo().machport,
                    lib_info::getaddrinfo_async_handle_reply().unwrap(),
                ) {
                    bun_output::scoped_log!(GetAddrInfoRequest, "onMachportChange: getaddrinfo_send_reply failed");
                    GetAddrInfoRequest::get_addr_info_async_callback(-1, ptr::null_mut(), this as *mut c_void);
                }
            }
        }
    }

    /// Non-Windows libc backend (worker-thread blocking getaddrinfo).
    #[cfg(not(windows))]
    pub enum LibcBackend {
        Success(GetAddrInfo::Result::List),
        Err(i32),
        Query(GetAddrInfo),
    }

    #[cfg(not(windows))]
    impl LibcBackend {
        pub fn run(&mut self) {
            let LibcBackend::Query(query) = self else { unreachable!() };
            let query_name = core::mem::take(&mut query.name); // freed at end of scope
            let hints = query.options.to_libc();
            let mut port_buf = [0u8; 128];
            let port_len = bun_fmt::print_int(&mut port_buf, query.port, 10);
            port_buf[port_len] = 0;
            // SAFETY: NUL written at port_buf[port_len]
            let port_z = unsafe { ZStr::from_raw(port_buf.as_ptr(), port_len) };

            let mut hostname = PathBuffer::uninit();
            // Reserve the last byte for the NUL terminator so the index below
            // can never exceed the buffer even if the upstream length guard in
            // `doLookup` is bypassed.
            let copied = strings::copy(&mut hostname[..hostname.len() - 1], &query_name);
            hostname[copied.len()] = 0;
            let mut addrinfo: *mut libc::addrinfo = ptr::null_mut();
            // SAFETY: hostname[copied.len()] == 0
            let host = unsafe { ZStr::from_raw(hostname.as_ptr(), copied.len()) };
            let debug_timer = Output::DebugTimer::start();
            // SAFETY: FFI; all pointers valid for the call duration
            let err = unsafe {
                libc::getaddrinfo(
                    host.as_ptr() as *const c_char,
                    if port_len > 0 { port_z.as_ptr() as *const c_char } else { ptr::null() },
                    hints.as_ref().map(|h| h as *const _).unwrap_or(ptr::null()),
                    &mut addrinfo,
                )
            };
            sys::syslog(format_args!(
                "getaddrinfo({}, {}) = {} ({})",
                bstr::BStr::new(&query_name),
                bstr::BStr::new(port_z.as_bytes()),
                err,
                debug_timer,
            ));
            if err != 0 || addrinfo.is_null() {
                *self = LibcBackend::Err(err);
                return;
            }

            // do not free addrinfo when err != 0
            // https://github.com/ziglang/zig/pull/14242
            let _free = scopeguard::guard(addrinfo, |a| unsafe { libc::freeaddrinfo(a) });

            *self = LibcBackend::Success(GetAddrInfo::Result::to_list(addrinfo));
        }
    }

    /// Windows libc backend wraps a uv_getaddrinfo_t.
    #[cfg(windows)]
    pub struct LibcBackend {
        pub uv: libuv::uv_getaddrinfo_t,
    }
    #[cfg(windows)]
    impl LibcBackend {
        pub fn uv_uninit() -> Self {
            // SAFETY: uv_getaddrinfo_t is C-POD initialized by uv_getaddrinfo
            Self { uv: unsafe { core::mem::zeroed() } }
        }
        pub fn run(&mut self) {
            unreachable!("This path should never be reached on Windows");
        }
    }
    #[cfg(not(windows))]
    impl LibcBackend {
        pub fn uv_uninit() -> Self { unreachable!() }
    }

    pub enum Backend {
        CAres,
        Libinfo(BackendLibInfo),
        Libc(LibcBackend),
    }

    impl Backend {
        pub fn as_libinfo(&self) -> &BackendLibInfo {
            match self { Backend::Libinfo(l) => l, _ => unreachable!() }
        }
        pub fn as_libinfo_mut(&mut self) -> &mut BackendLibInfo {
            match self { Backend::Libinfo(l) => l, _ => unreachable!() }
        }
        #[cfg(windows)]
        pub fn as_libc_uv_mut(&mut self) -> &mut libuv::uv_getaddrinfo_t {
            match self { Backend::Libc(l) => &mut l.uv, _ => unreachable!() }
        }
    }
}

impl GetAddrInfoRequest {
    pub fn init(
        cache: CacheHit,
        backend: get_addr_info_request::Backend,
        resolver: Option<*mut Resolver>,
        query: &GetAddrInfo,
        global_this: &JSGlobalObject,
        cache_field: PendingCacheField,
    ) -> *mut Self {
        bun_output::scoped_log!(GetAddrInfoRequest, "init");
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        let request = Box::into_raw(Box::new(Self {
            backend,
            resolver_for_caching: resolver,
            hash: query.hash(),
            cache: CacheConfig::default(),
            head: DNSLookup {
                // SAFETY: resolver is a live intrusive-RC m_ctx; clone_from_raw bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::clone_from_raw(r) }),
                // SAFETY: JSGlobalObject lives for the program's JS lifetime
                global_this: unsafe { core::mem::transmute(global_this) },
                promise: JSPromise::Strong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
            },
            tail: ptr::null_mut(),
            // SAFETY: all-zero is a valid `Task` (POD callback+ctx pair).
            task: unsafe { core::mem::zeroed() },
        }));
        // SAFETY: request just allocated; head is an inline field.
        unsafe { (*request).tail = &mut (*request).head };
        if let CacheHit::New(new) = cache {
            // SAFETY: `new` is &mut into resolver's HiveArray buffer; resolver/request are live.
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_host_cache(cache_field)
                    .index_of(new)
                    .unwrap();
                (*request).cache =
                    CacheConfig::new(true, false, pos as u8, query.name.len() as u16);
                (*new).lookup = request;
            }
        }
        request
    }

    pub const ON_MACHPORT_CHANGE: fn(*mut Self) =
        get_addr_info_request::BackendLibInfo::on_machport_change;

    pub extern "C" fn get_addr_info_async_callback(
        status: i32,
        addr_info: *mut libc::addrinfo,
        arg: *mut c_void,
    ) {
        // SAFETY: arg was a *mut GetAddrInfoRequest passed to getaddrinfo_async_start
        let this: *mut Self = arg.cast();
        bun_output::scoped_log!(GetAddrInfoRequest, "getAddrInfoAsyncCallback: status={}", status);

        // SAFETY: `this` is the heap-allocated request passed via `arg`; callback runs once.
        unsafe {
            if let get_addr_info_request::Backend::Libinfo(li) = &mut (*this).backend {
                if let Some(poll) = li.file_poll.take() {
                    drop(poll);
                }
            }

            if let Some(resolver) = (*this).resolver_for_caching {
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_host_native(
                        (*this).cache.pos_in_pending(),
                        (*this).head.global_this,
                        status,
                        GetAddrInfo::Result::Any::Addrinfo(addr_info),
                    );
                    return;
                }
            }

            let mut head = core::ptr::read(&(*this).head);
            drop(Box::from_raw(this));
            head.process_get_addr_info_native(status, addr_info);
        }
    }

    pub fn run(this: *mut Self, task: *mut get_addr_info_request::Task) {
        // SAFETY: WorkTask invokes this on the threadpool with valid pointers
        unsafe {
            match &mut (*this).backend {
                get_addr_info_request::Backend::Libc(l) => l.run(),
                _ => unreachable!(),
            }
            (*task).on_finish();
        }
    }

    pub fn then(this: *mut Self, _global: &JSGlobalObject) {
        bun_output::scoped_log!(GetAddrInfoRequest, "then");
        #[cfg(not(windows))]
        unsafe {
            match &(*this).backend {
                get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::Success(result)) => {
                    let any = GetAddrInfo::Result::Any::List(result.clone());
                    let _free = scopeguard::guard((), |_| any.deinit());
                    if let Some(resolver) = (*this).resolver_for_caching {
                        // if (this.cache.entry_cache and result != null and result.?.node != null) {
                        //     resolver.putEntryInCache(this.hash, this.cache.name_len, result.?);
                        // }
                        if (*this).cache.pending_cache() {
                            (*resolver).drain_pending_host_native(
                                (*this).cache.pos_in_pending(),
                                (*this).head.global_this,
                                0,
                                any,
                            );
                            return;
                        }
                    }
                    let mut head = core::ptr::read(&(*this).head);
                    drop(Box::from_raw(this));
                    head.on_complete_native(any);
                }
                get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::Err(err)) => {
                    Self::get_addr_info_async_callback(*err, ptr::null_mut(), this as *mut c_void);
                }
                _ => unreachable!(),
            }
        }
        #[cfg(windows)]
        { let _ = this; unreachable!() }
    }

    pub fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::AddrInfo>,
    ) {
        bun_output::scoped_log!(GetAddrInfoRequest, "onCaresComplete");
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                // if (this.cache.entry_cache and result != null and result.?.node != null) {
                //     resolver.putEntryInCache(this.hash, this.cache.name_len, result.?);
                // }
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_host_cares(
                        (*this).cache.pos_in_pending(),
                        err_,
                        timeout,
                        result,
                    );
                    return;
                }
            }

            let mut head = core::ptr::read(&(*this).head);
            drop(Box::from_raw(this));
            head.process_get_addr_info(err_, timeout, result);
        }
    }

    pub fn on_libuv_complete(uv_info: *mut libuv::uv_getaddrinfo_t) {
        unsafe {
            let retcode = (*uv_info).retcode.int();
            bun_output::scoped_log!(GetAddrInfoRequest, "onLibUVComplete: status={}", retcode);
            let this: *mut Self = (*uv_info).data.cast();
            #[cfg(windows)]
            debug_assert!(uv_info == (*this).backend.as_libc_uv_mut() as *mut _);
            if let get_addr_info_request::Backend::Libinfo(li) = &mut (*this).backend {
                if let Some(poll) = li.file_poll.take() {
                    drop(poll);
                }
            }

            if let Some(resolver) = (*this).resolver_for_caching {
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_host_native(
                        (*this).cache.pos_in_pending(),
                        (*this).head.global_this,
                        retcode,
                        GetAddrInfo::Result::Any::Addrinfo((*uv_info).addrinfo),
                    );
                    return;
                }
            }

            let mut head = core::ptr::read(&(*this).head);
            head.process_get_addr_info_native(retcode, (*uv_info).addrinfo);
            drop(Box::from_raw(this));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresReverse
// ──────────────────────────────────────────────────────────────────────────

pub struct CAresReverse {
    pub resolver: Option<bun_ptr::IntrusiveRc<Resolver>>, // SHARED (intrusive — Resolver embeds ref_count and crosses FFI as m_ctx)
    pub global_this: &'static JSGlobalObject, // JSC_BORROW
    pub promise: JSPromise::Strong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresReverse>>, // INTRUSIVE
    pub name: Box<[u8]>,
}

impl CAresReverse {
    pub fn init(resolver: Option<*mut Resolver>, global_this: &JSGlobalObject, name: &[u8]) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        Box::into_raw(Box::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; clone_from_raw bumps the embedded ref_count.
            resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::clone_from_raw(r) }),
            // SAFETY: JSGlobalObject lives for the program's JS lifetime
            global_this: unsafe { core::mem::transmute(global_this) },
            promise: JSPromise::Strong::init(global_this),
            poll_ref,
            allocated: true,
            next: None,
            name: Box::<[u8]>::from(name),
        }))
    }

    pub fn process_resolve(
        &mut self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        if let Some(err) = err_ {
            err.to_deferred("getHostByAddr", Some(&self.name), &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        }
        let Some(node) = result else {
            c_ares::Error::ENOTFOUND
                .to_deferred("getHostByAddr", Some(&self.name), &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        };
        // SAFETY: node is a valid c-ares hostent for the callback's duration
        let array = unsafe { (*node).to_js_response(self.global_this, "") }
            .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
        self.on_complete(array);
    }

    pub fn on_complete(&mut self, result: JSValue) {
        let promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this;
        let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
        if let Some(resolver) = self.resolver.as_ref() {
            // SAFETY: IntrusiveRc holds a live ref; request_completed mutates pending_requests counter only.
            unsafe { (*resolver.as_ptr()).request_completed() };
        }
        // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
        unsafe { Self::destroy(self as *mut Self) };
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `Box::into_raw` in `init()`.
    // TODO(port): callers reach this via &mut self methods — reshape those to *mut Self in Phase B.
    pub unsafe fn destroy(this: *mut Self) {
        if (*this).allocated {
            drop(Box::from_raw(this));
        } else {
            core::ptr::drop_in_place(this);
        }
    }
}

impl Drop for CAresReverse {
    fn drop(&mut self) {
        self.poll_ref.unref(self.global_this.bun_vm());
        // self.name / self.resolver freed by field Drop (Box / IntrusiveRc deref)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresLookup<T>
// ──────────────────────────────────────────────────────────────────────────

pub struct CAresLookup<T: CAresRecordType> {
    pub resolver: Option<bun_ptr::IntrusiveRc<Resolver>>, // SHARED (intrusive — Resolver embeds ref_count and crosses FFI as m_ctx)
    pub global_this: &'static JSGlobalObject, // JSC_BORROW
    pub promise: JSPromise::Strong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresLookup<T>>>, // INTRUSIVE
    pub name: Box<[u8]>,
    _marker: core::marker::PhantomData<T>,
}

impl<T: CAresRecordType> CAresLookup<T> {
    pub fn new(data: Self) -> *mut Self {
        debug_assert!(data.allocated); // deinit will not free this otherwise
        Box::into_raw(Box::new(data))
    }

    pub fn init(resolver: Option<*mut Resolver>, global_this: &JSGlobalObject, name: &[u8]) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());
        Self::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; clone_from_raw bumps the embedded ref_count.
            resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::clone_from_raw(r) }),
            // SAFETY: JSGlobalObject lives for the program's JS lifetime
            global_this: unsafe { core::mem::transmute(global_this) },
            promise: JSPromise::Strong::init(global_this),
            poll_ref,
            allocated: true,
            next: None,
            name: Box::<[u8]>::from(name),
            _marker: core::marker::PhantomData,
        })
    }

    pub fn process_resolve(&mut self, err_: Option<c_ares::Error>, _timeout: i32, result: Option<*mut T>) {
        // syscall = "query" + ucfirst(TYPE_NAME)
        // TODO(port): const-eval — Zig built this at comptime
        let syscall = T::syscall_name(); // e.g. "querySrv"
        // This path is reached when the pending cache is full (`.disabled`),
        // so we own the c-ares result here. The cached path frees it in
        // `drainPendingCares`; callers from there always pass `null`.
        let _free = scopeguard::guard(result, |r| {
            if let Some(r) = r {
                // SAFETY: r is the c-ares-allocated reply; we own it on this path.
                unsafe { T::destroy(r) };
            }
        });

        if let Some(err) = err_ {
            err.to_deferred(syscall, Some(&self.name), &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        }
        let Some(node) = result else {
            c_ares::Error::ENOTFOUND
                .to_deferred(syscall, Some(&self.name), &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        };

        // SAFETY: node is a valid c-ares reply for the callback's duration; freed by `_free` guard.
        let array = unsafe { (*node).to_js_response(self.global_this, T::TYPE_NAME) }
            .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
        self.on_complete(array);
    }

    pub fn on_complete(&mut self, result: JSValue) {
        let promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this;
        let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
        if let Some(resolver) = self.resolver.as_ref() {
            // SAFETY: IntrusiveRc holds a live ref; request_completed mutates pending_requests counter only.
            unsafe { (*resolver.as_ptr()).request_completed() };
        }
        // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
        unsafe { Self::destroy(self as *mut Self) };
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `Box::into_raw` in `new()`.
    // TODO(port): callers reach this via &mut self methods — reshape those to *mut Self in Phase B.
    pub unsafe fn destroy(this: *mut Self) {
        if (*this).allocated {
            drop(Box::from_raw(this));
        } else {
            core::ptr::drop_in_place(this);
        }
    }
}

impl<T: CAresRecordType> Drop for CAresLookup<T> {
    fn drop(&mut self) {
        self.poll_ref.unref(self.global_this.bun_vm());
        // self.name / self.resolver freed by field Drop (Box / IntrusiveRc deref)
    }
}

// Extension on the record-type trait for the comptime "queryXxx" string.
pub trait CAresRecordTypeExt: CAresRecordType {
    fn syscall_name() -> &'static str;
}
// TODO(port): impl CAresRecordTypeExt for each c_ares reply type with const_format::concatcp!("query", ucfirst(TYPE_NAME))

// ──────────────────────────────────────────────────────────────────────────
// DNSLookup
// ──────────────────────────────────────────────────────────────────────────

pub struct DNSLookup {
    pub resolver: Option<bun_ptr::IntrusiveRc<Resolver>>, // SHARED (intrusive — Resolver embeds ref_count and crosses FFI as m_ctx)
    pub global_this: &'static JSGlobalObject, // JSC_BORROW
    pub promise: JSPromise::Strong,
    pub allocated: bool,
    pub next: Option<NonNull<DNSLookup>>, // INTRUSIVE
    pub poll_ref: KeepAlive,
}

impl DNSLookup {
    pub fn init(resolver: *mut Resolver, global_this: &JSGlobalObject) -> *mut Self {
        bun_output::scoped_log!(DNSLookup, "init");

        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(global_this.bun_vm());

        Box::into_raw(Box::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; clone_from_raw bumps the embedded ref_count.
            resolver: Some(unsafe { bun_ptr::IntrusiveRc::clone_from_raw(resolver) }),
            // SAFETY: JSGlobalObject lives for the program's JS lifetime
            global_this: unsafe { core::mem::transmute(global_this) },
            poll_ref,
            promise: JSPromise::Strong::init(global_this),
            allocated: true,
            next: None,
        }))
    }

    pub fn on_complete_native(&mut self, result: GetAddrInfo::Result::Any) {
        bun_output::scoped_log!(DNSLookup, "onCompleteNative");
        let array = result.to_js(self.global_this).unwrap_or(JSValue::ZERO).unwrap(); // TODO: properly propagate exception upwards
        self.on_complete_with_array(array);
    }

    pub fn process_get_addr_info_native(&mut self, status: i32, result: *mut libc::addrinfo) {
        bun_output::scoped_log!(DNSLookup, "processGetAddrInfoNative: status={}", status);
        if let Some(err) = c_ares::Error::init_eai(status) {
            err.to_deferred("getaddrinfo", None, &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        }
        self.on_complete_native(GetAddrInfo::Result::Any::Addrinfo(result));
    }

    pub fn process_get_addr_info(
        &mut self,
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

        if let Some(err) = err_ {
            err.to_deferred("getaddrinfo", None, &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        }

        // SAFETY: `r` is the c-ares-allocated AddrInfo valid for the callback's duration.
        let Some(r) = result.filter(|r| unsafe { !(**r).node.is_null() }) else {
            c_ares::Error::ENOTFOUND
                .to_deferred("getaddrinfo", None, &mut self.promise)
                .reject_later(self.global_this);
            // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
            unsafe { Self::destroy(self as *mut Self) };
            return;
        };
        self.on_complete(r);
    }

    pub fn on_complete(&mut self, result: *mut c_ares::AddrInfo) {
        bun_output::scoped_log!(DNSLookup, "onComplete");
        // SAFETY: result is a live c-ares AddrInfo owned by the caller's scopeguard.
        let array = unsafe { (*result).to_js_array(self.global_this) }
            .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
        self.on_complete_with_array(array);
    }

    pub fn on_complete_with_array(&mut self, result: JSValue) {
        bun_output::scoped_log!(DNSLookup, "onCompleteWithArray");
        let promise = core::mem::take(&mut self.promise);
        let global_this = self.global_this;
        let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
        if let Some(resolver) = self.resolver.as_ref() {
            // SAFETY: IntrusiveRc holds a live ref; request_completed mutates pending_requests counter only.
            unsafe { (*resolver.as_ptr()).request_completed() };
        }
        // SAFETY: self is either the inline head (drop_in_place) or a Boxed tail node.
        unsafe { Self::destroy(self as *mut Self) };
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `Box::into_raw` in `init()`.
    // TODO(port): callers reach this via &mut self methods — reshape those to *mut Self in Phase B.
    pub unsafe fn destroy(this: *mut Self) {
        if (*this).allocated {
            drop(Box::from_raw(this));
        } else {
            core::ptr::drop_in_place(this);
        }
    }
}

impl Drop for DNSLookup {
    fn drop(&mut self) {
        bun_output::scoped_log!(DNSLookup, "deinit");
        self.poll_ref.unref(self.global_this.bun_vm());
        // self.resolver freed by IntrusiveRc Drop → deref
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GlobalData
// ──────────────────────────────────────────────────────────────────────────

pub struct GlobalData {
    pub resolver: Resolver,
}

impl GlobalData {
    pub fn init(vm: &VirtualMachine) -> Box<Self> {
        Box::new(Self { resolver: Resolver::setup(vm) })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// internal — process-wide DNS cache used by usockets connect path
// ──────────────────────────────────────────────────────────────────────────

pub mod internal {
    use super::*;

    static mut MAX_DNS_TIME_TO_LIVE_SECONDS: Option<u32> = None;

    pub fn get_max_dns_time_to_live_seconds() -> u32 {
        // This is racy, but it's okay because the number won't be invalid, just stale.
        // SAFETY: see above.
        unsafe {
            MAX_DNS_TIME_TO_LIVE_SECONDS.unwrap_or_else(|| {
                let value = env_var::BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS.get();
                let v = value as u32;
                MAX_DNS_TIME_TO_LIVE_SECONDS = Some(v);
                v
            })
        }
    }

    // ───────────── Request ─────────────

    // PORT NOTE: Zig stored a borrowed `[:0]const u8` here and only allocated in
    // `toOwned()`. We keep a raw borrow on the stack key (constructed in `init`) and
    // allocate in `to_owned()` before storing on the heap `Request`.
    // TODO(port): lifetime — model the borrow with `<'a>` once Phase B settles ZStr ownership.
    pub struct RequestKey {
        pub host: Option<*const ZStr>, // BORROW until to_owned(); never freed via this field
        /// Used for getaddrinfo() to avoid glibc UDP port 0 bug, but NOT included in hash
        pub port: u16,
        /// Hash of hostname only - DNS results are port-agnostic
        pub hash: u64,
    }

    /// Heap-stored key on `Request` — owns its host buffer.
    pub struct RequestKeyOwned {
        pub host: Option<Box<ZStr>>,
        pub port: u16,
        pub hash: u64,
    }

    impl RequestKey {
        pub fn init(name: Option<&ZStr>, port: u16) -> Self {
            let hash = if let Some(n) = name {
                Self::generate_hash(n) // Don't include port
            } else {
                0
            };
            Self {
                host: name.map(|n| n as *const ZStr),
                hash,
                port,
            }
        }

        fn generate_hash(name: &ZStr) -> u64 {
            wyhash(name.as_bytes())
        }

        pub fn to_owned(&self) -> RequestKeyOwned {
            if let Some(host) = self.host {
                // SAFETY: host borrows the caller's NUL-terminated slice for the stack key's lifetime.
                let bytes = unsafe { (*host).as_bytes() };
                let host_copy = ZStr::from_bytes(bytes);
                RequestKeyOwned { host: Some(host_copy), hash: self.hash, port: self.port }
            } else {
                RequestKeyOwned { host: None, hash: self.hash, port: self.port }
            }
        }
    }

    // Crosses FFI to usockets via `Bun__addrinfo_getRequestResult` — layout MUST match
    // Zig's `extern struct { info: ?[*]ResultEntry, err: c_int }` (8-byte thin ptr).
    #[repr(C)]
    pub struct RequestResult {
        pub info: Option<NonNull<ResultEntry>>, // thin ptr; head of intrusive `ai_next` chain
        pub err: c_int,
    }
    // Ownership of the ResultEntry buffer is tracked separately on `Request` (see
    // `Request::deinit` / `process_results`); this struct is a read-only view for C.
    // TODO(port): store the owning `Box<[ResultEntry]>` on `Request` and write its
    // `.as_mut_ptr()` here; do NOT free via this field.

    pub struct MacAsyncDNS {
        pub file_poll: Option<Box<FilePoll>>, // OWNED
        pub machport: mach_port,
    }

    impl Default for MacAsyncDNS {
        fn default() -> Self { Self { file_poll: None, machport: 0 } }
    }

    impl MacAsyncDNS {
        // TODO(port): move to <area>_sys
        unsafe extern "C" {
            fn getaddrinfo_send_reply(
                port: mach_port,
                reply: lib_info::GetaddrinfoAsyncHandleReply,
            ) -> bool;
        }

        pub fn on_machport_change(this: *mut Request) {
            // SAFETY: `this` is the heap-allocated Request the FilePoll was registered with.
            unsafe {
                if !getaddrinfo_send_reply(
                    (*this).libinfo.machport,
                    lib_info::getaddrinfo_async_handle_reply().unwrap(),
                ) {
                    libinfo_callback(libc::E::NOSYS as i32, ptr::null_mut(), this as *mut c_void);
                }
            }
        }
    }

    pub struct Request {
        pub key: RequestKeyOwned,
        pub result: Option<RequestResult>,

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
            Box::into_raw(Box::new(Self {
                key,
                result: None,
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

        pub fn deinit(this: *mut Self) {
            // SAFETY: this is a Box::into_raw'd Request with refcount==0
            unsafe {
                debug_assert!((*this).notify.is_empty());
                // result.info / key.host freed by Drop
                drop(Box::from_raw(this));
            }
        }
    }

    // ───────────── GlobalCache ─────────────

    const MAX_ENTRIES: usize = 256;

    pub struct GlobalCache {
        pub lock: Mutex,
        pub cache: [*mut Request; MAX_ENTRIES],
        pub len: usize,
    }

    pub enum CacheResult<'a> {
        Inflight(&'a mut Request),
        Resolved(&'a mut Request),
        None,
    }

    impl GlobalCache {
        pub const fn new() -> Self {
            Self { lock: Mutex::new(), cache: [ptr::null_mut(); MAX_ENTRIES], len: 0 }
        }

        fn get(&mut self, key: &RequestKey, timestamp_to_store: &mut u32) -> Option<*mut Request> {
            let mut len = self.len;
            let mut i: usize = 0;
            while i < len {
                let entry = self.cache[i];
                // SAFETY: entries 0..len are valid heap Requests
                unsafe {
                    if (*entry).key.hash == key.hash && (*entry).valid {
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
        pub fn get_cache_timestamp() -> u32 {
            (bun::get_rough_tick_count_ms(bun::TimeSource::AllowMockedTime) / 1000) as u32
        }

        fn is_nearly_full(&self) -> bool {
            // 80% full (value is kind of arbitrary)
            // SAFETY: monotonic atomic read of self.len
            unsafe { core::ptr::read_volatile(&self.len) * 5 >= self.cache.len() * 4 }
            // TODO(port): Zig used @atomicLoad — make `len` an AtomicUsize in Phase B
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

    static mut GLOBAL_CACHE: GlobalCache = GlobalCache::new();
    // SAFETY: all access guarded by GLOBAL_CACHE.lock; matches Zig file-scope `var`.
    fn global_cache() -> &'static mut GlobalCache { unsafe { &mut *core::ptr::addr_of_mut!(GLOBAL_CACHE) } }

    // we just hardcode a STREAM socktype
    #[cfg(unix)]
    const DEFAULT_HINTS_ADDRCONFIG: bool = true;
    #[cfg(not(unix))]
    const DEFAULT_HINTS_ADDRCONFIG: bool = false;

    fn default_hints() -> libc::addrinfo {
        let mut h: libc::addrinfo = unsafe { core::mem::zeroed() };
        // SAFETY: all-zero is a valid addrinfo (matches Zig field-defaults below)
        h.ai_family = libc::AF_UNSPEC;
        // If the system is IPv4-only or IPv6-only, then only return the corresponding address family.
        // https://github.com/nodejs/node/commit/54dd7c38e507b35ee0ffadc41a716f1782b0d32f
        // https://bugzilla.mozilla.org/show_bug.cgi?id=467497
        // https://github.com/adobe/chromium/blob/cfe5bf0b51b1f6b9fe239c2a3c2f2364da9967d7/net/base/host_resolver_proc.cc#L122-L241
        // https://github.com/nodejs/node/issues/33816
        // https://github.com/aio-libs/aiohttp/issues/5357
        // https://github.com/libuv/libuv/issues/2225
        #[cfg(unix)]
        { h.ai_flags = libc::AI_ADDRCONFIG; }
        h.ai_socktype = libc::SOCK_STREAM;
        h
    }

    pub fn get_hints() -> libc::addrinfo {
        let mut hints_copy = default_hints();
        if feature_flag::BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG.get() {
            hints_copy.ai_flags &= !libc::AI_ADDRCONFIG;
        }
        if feature_flag::BUN_FEATURE_FLAG_DISABLE_IPV6.get() {
            hints_copy.ai_family = libc::AF_INET;
        } else if feature_flag::BUN_FEATURE_FLAG_DISABLE_IPV4.get() {
            hints_copy.ai_family = libc::AF_INET6;
        }
        hints_copy
    }

    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        fn us_internal_dns_callback(socket: *mut ConnectingSocket, req: *mut Request);
        fn us_internal_dns_callback_threadsafe(socket: *mut ConnectingSocket, req: *mut Request);
    }

    pub enum DNSRequestOwner {
        Socket(*mut ConnectingSocket), // FFI
        Prefetch(*mut Loop),           // FFI
        Quic(*mut bun_http::H3::PendingConnect), // BORROW_PARAM
    }

    impl DNSRequestOwner {
        pub fn notify_threadsafe(&self, req: *mut Request) {
            match self {
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback_threadsafe(*socket, req)
                },
                DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
                DNSRequestOwner::Quic(pc) => unsafe { (**pc).on_dns_resolved_threadsafe() },
            }
        }

        pub fn notify(&self, req: *mut Request) {
            match self {
                DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback(*socket, req)
                },
                DNSRequestOwner::Quic(pc) => unsafe { (**pc).on_dns_resolved() },
            }
        }

        pub fn loop_(&self) -> *mut Loop {
            match self {
                DNSRequestOwner::Prefetch(l) => *l,
                DNSRequestOwner::Socket(s) => unsafe { (**s).loop_() },
                DNSRequestOwner::Quic(pc) => unsafe { (**pc).loop_() },
            }
        }
    }

    /// Register `pc` to be notified when `request` resolves. Mirrors
    /// us_getaddrinfo_set but for the QUIC client's connect path, which has
    /// no us_connecting_socket_t to hang the callback on. The .quic notify
    /// path frees the addrinfo request inline (via Bun__addrinfo_freeRequest),
    /// which re-acquires global_cache.lock — so drop it before notifying.
    pub fn register_quic(request: *mut Request, pc: *mut bun_http::H3::PendingConnect) {
        global_cache().lock.lock();
        let owner = DNSRequestOwner::Quic(pc);
        unsafe {
            if (*request).result.is_some() {
                global_cache().lock.unlock();
                owner.notify(request);
                return;
            }
            (*request).notify.push(owner);
        }
        global_cache().lock.unlock();
    }

    #[repr(C)]
    pub struct ResultEntry {
        pub info: libc::addrinfo,
        pub addr: libc::sockaddr_storage,
    }

    // re-order result to interleave ipv4 and ipv6 (also pack into a single allocation)
    fn process_results(info: *mut libc::addrinfo) -> Box<[ResultEntry]> {
        let mut count: usize = 0;
        let mut info_: *mut libc::addrinfo = info;
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
                if !(*info_).ai_addr.is_null() {
                    if (*info_).ai_family == libc::AF_INET {
                        let addr_in = &mut (*entry).addr as *mut _ as *mut libc::sockaddr_in;
                        *addr_in = *((*info_).ai_addr as *const libc::sockaddr_in);
                    } else if (*info_).ai_family == libc::AF_INET6 {
                        let addr_in = &mut (*entry).addr as *mut _ as *mut libc::sockaddr_in6;
                        *addr_in = *((*info_).ai_addr as *const libc::sockaddr_in6);
                    }
                } else {
                    (*entry).addr = core::mem::zeroed();
                }
                i += 1;
                info_ = (*info_).ai_next;
            }
        }

        // SAFETY: every slot 0..count was written above
        let mut results: Box<[ResultEntry]> = unsafe { core::mem::transmute(results) };

        // sort (interleave ipv4 and ipv6)
        let mut want = libc::AF_INET6 as usize;
        'outer: for idx in 0..count {
            if results[idx].info.ai_family as usize == want { continue; }
            for j in (idx + 1)..count {
                if results[j].info.ai_family as usize == want {
                    results.swap(idx, j);
                    want = if want == libc::AF_INET6 as usize { libc::AF_INET as usize } else { libc::AF_INET6 as usize };
                }
            }
            // PORT NOTE: Zig's inner `for ... else { break }` has no `break` in its body,
            // so the else fires unconditionally — mirrored exactly.
            // the rest of the list is all one address family
            break 'outer;
        }

        // set up pointers
        for idx in 0..count {
            let (left, right) = results.split_at_mut(idx + 1);
            let entry = &mut left[idx];
            entry.info.ai_canonname = ptr::null_mut();
            if idx + 1 < count {
                entry.info.ai_next = &mut right[0].info;
            } else {
                entry.info.ai_next = ptr::null_mut();
            }
            if !entry.info.ai_addr.is_null() {
                entry.info.ai_addr = &mut entry.addr as *mut _ as *mut libc::sockaddr;
            }
        }

        results
    }

    fn after_result(req: *mut Request, info: *mut libc::addrinfo, err: c_int) {
        let results: Option<Box<[ResultEntry]>> = if !info.is_null() {
            let res = process_results(info);
            unsafe { libc::freeaddrinfo(info) };
            Some(res)
        } else {
            None
        };

        global_cache().lock.lock();

        let notify = unsafe {
            (*req).result = Some(RequestResult { info: results, err });
            let notify = core::mem::take(&mut (*req).notify);
            (*req).refcount -= 1;
            notify
        };

        // is this correct, or should it go after the loop?
        global_cache().lock.unlock();

        for query in notify {
            query.notify_threadsafe(req);
        }
    }

    fn work_pool_callback(req: *mut Request) {
        let mut service_buf = [0u8; bun_fmt::fast_digit_count(u16::MAX as u64) as usize + 2];
        let service: *const c_char = unsafe {
            if (*req).key.port > 0 {
                use std::io::Write;
                let n = {
                    let mut cursor = &mut service_buf[..];
                    write!(cursor, "{}", (*req).key.port).expect("unreachable");
                    service_buf.len() - cursor.len()
                };
                service_buf[n] = 0;
                service_buf.as_ptr() as *const c_char
            } else {
                ptr::null()
            }
        };

        #[cfg(windows)]
        unsafe {
            use bun_sys::windows::ws2_32 as wsa;
            let mut wsa_hints: wsa::addrinfo = core::mem::zeroed();
            wsa_hints.ai_family = wsa::AF_UNSPEC;
            wsa_hints.ai_socktype = wsa::SOCK_STREAM;

            let mut addrinfo: *mut wsa::addrinfo = ptr::null_mut();
            let err = wsa::getaddrinfo(
                (*req).key.host.as_ref().map(|h| h.as_ptr() as *const c_char).unwrap_or(ptr::null()),
                service,
                &wsa_hints,
                &mut addrinfo,
            );
            after_result(req, addrinfo.cast(), err);
        }
        #[cfg(not(windows))]
        unsafe {
            let mut addrinfo: *mut libc::addrinfo = ptr::null_mut();
            let mut hints = get_hints();

            let host_ptr = (*req).key.host.as_ref().map(|h| h.as_ptr() as *const c_char).unwrap_or(ptr::null());
            let mut err = libc::getaddrinfo(host_ptr, service, &hints, &mut addrinfo);

            // optional fallback
            if err == libc::EAI_NONAME && (hints.ai_flags & libc::AI_ADDRCONFIG) != 0 {
                hints.ai_flags &= !libc::AI_ADDRCONFIG;
                (*req).can_retry_for_addrconfig = false;
                err = libc::getaddrinfo(host_ptr, service, &hints, &mut addrinfo);
            }
            after_result(req, addrinfo, err);
        }
    }

    pub fn lookup_libinfo(req: *mut Request, loop_: jsc::EventLoopHandle) -> bool {
        let Some(getaddrinfo_async_start_) = lib_info::getaddrinfo_async_start() else {
            return false;
        };

        let mut machport: mach_port = 0;
        let mut service_buf = [0u8; bun_fmt::fast_digit_count(u16::MAX as u64) as usize + 2];
        let service: *const c_char = unsafe {
            if (*req).key.port > 0 {
                use std::io::Write;
                let n = {
                    let mut cursor = &mut service_buf[..];
                    write!(cursor, "{}", (*req).key.port).expect("unreachable");
                    service_buf.len() - cursor.len()
                };
                service_buf[n] = 0;
                service_buf.as_ptr() as *const c_char
            } else {
                ptr::null()
            }
        };

        let mut hints = get_hints();

        let errno = unsafe {
            getaddrinfo_async_start_(
                &mut machport,
                (*req).key.host.as_ref().map(|h| h.as_ptr() as *const c_char).unwrap_or(ptr::null()),
                service,
                &hints,
                libinfo_callback,
                req as *mut c_void,
            )
        };

        if errno != 0 || machport == 0 {
            return false;
        }

        let poll = FilePoll::init(
            loop_,
            // SAFETY: bitcast u32 mach_port → i32 fd, matches Zig @bitCast
            sys::Fd::from_native(unsafe { core::mem::transmute::<u32, i32>(machport) }),
            Default::default(),
            // TODO(port): FilePoll generic owner type InternalDNSRequest
            req,
        );
        let rc = poll.register(loop_.loop_(), Async::PollKind::Machport, true);

        if matches!(rc, sys::Result::Err(_)) {
            drop(poll);
            return false;
        }

        #[cfg(target_os = "macos")]
        unsafe {
            (*req).libinfo = MacAsyncDNS { file_poll: Some(poll), machport };
        }

        true
    }

    extern "C" fn libinfo_callback(status: i32, addr_info: *mut libc::addrinfo, arg: *mut c_void) {
        let req: *mut Request = arg.cast();
        let status_int: c_int = status;
        'retry: {
            unsafe {
                if status == libc::EAI_NONAME as i32 && (*req).can_retry_for_addrconfig {
                    (*req).can_retry_for_addrconfig = false;
                    let mut service_buf = [0u8; bun_fmt::fast_digit_count(u16::MAX as u64) as usize + 2];
                    let service: *const c_char = if (*req).key.port > 0 {
                        use std::io::Write;
                        let n = {
                            let mut cursor = &mut service_buf[..];
                            write!(cursor, "{}", (*req).key.port).expect("unreachable");
                            service_buf.len() - cursor.len()
                        };
                        service_buf[n] = 0;
                        service_buf.as_ptr() as *const c_char
                    } else {
                        ptr::null()
                    };
                    let Some(getaddrinfo_async_start_) = lib_info::getaddrinfo_async_start() else {
                        break 'retry;
                    };
                    let mut machport: mach_port = 0;
                    let mut hints = get_hints();
                    hints.ai_flags &= !libc::AI_ADDRCONFIG;

                    let errno = getaddrinfo_async_start_(
                        &mut machport,
                        (*req).key.host.as_ref().map(|h| h.as_ptr() as *const c_char).unwrap_or(ptr::null()),
                        service,
                        &hints,
                        libinfo_callback,
                        req as *mut c_void,
                    );

                    if errno != 0 || machport == 0 {
                        bun_output::scoped_log!(dns, "libinfoCallback: getaddrinfo_async_start retry failed (errno={})", errno);
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
                        let poll = (*req).libinfo.file_poll.as_mut().unwrap();
                        poll.fd = sys::Fd::from_native(core::mem::transmute::<u32, i32>(machport));
                        match poll.register(Loop::get(), Async::PollKind::Machport, true) {
                            sys::Result::Err(_) => {
                                bun_output::scoped_log!(dns, "libinfoCallback: failed to register poll");
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

    #[host_fn]
    pub fn get_dns_cache_stats(global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let object = JSValue::create_empty_object(global_object, 6);
        object.put(global_object, ZigString::static_("cacheHitsCompleted"), JSValue::js_number(DNS_CACHE_HITS_COMPLETED.load(Ordering::Relaxed)));
        object.put(global_object, ZigString::static_("cacheHitsInflight"), JSValue::js_number(DNS_CACHE_HITS_INFLIGHT.load(Ordering::Relaxed)));
        object.put(global_object, ZigString::static_("cacheMisses"), JSValue::js_number(DNS_CACHE_MISSES.load(Ordering::Relaxed)));
        object.put(global_object, ZigString::static_("size"), JSValue::js_number(DNS_CACHE_SIZE.load(Ordering::Relaxed)));
        object.put(global_object, ZigString::static_("errors"), JSValue::js_number(DNS_CACHE_ERRORS.load(Ordering::Relaxed)));
        object.put(global_object, ZigString::static_("totalCount"), JSValue::js_number(GETADDRINFO_CALLS.load(Ordering::Relaxed)));
        Ok(object)
    }

    pub fn getaddrinfo(
        loop_: *mut Loop,
        host: Option<&ZStr>,
        port: u16,
        is_cache_hit: Option<&mut bool>,
    ) -> Option<*mut Request> {
        let preload = is_cache_hit.is_none();
        let key = RequestKey::init(host, port);
        global_cache().lock.lock();
        GETADDRINFO_CALLS.fetch_add(1, Ordering::Relaxed);
        let mut timestamp_to_store: u32 = 0;
        // is there a cache hit?
        if !feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE.get() {
            if let Some(entry) = global_cache().get(&key, &mut timestamp_to_store) {
                if preload {
                    global_cache().lock.unlock();
                    return None;
                }

                unsafe { (*entry).refcount += 1 };

                if unsafe { (*entry).result.is_some() } {
                    *is_cache_hit.unwrap() = true;
                    bun_output::scoped_log!(dns, "getaddrinfo({}) = cache hit", bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b"")));
                    DNS_CACHE_HITS_COMPLETED.fetch_add(1, Ordering::Relaxed);
                } else {
                    bun_output::scoped_log!(dns, "getaddrinfo({}) = cache hit (inflight)", bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b"")));
                    DNS_CACHE_HITS_INFLIGHT.fetch_add(1, Ordering::Relaxed);
                }

                global_cache().lock.unlock();
                return Some(entry);
            }
        }

        // no cache hit, we have to make a new request
        let req = Request::new(
            key.to_owned(),
            (!preload) as u32 + 1,
            // Seconds since when this request was created
            if timestamp_to_store == 0 { GlobalCache::get_cache_timestamp() } else { timestamp_to_store },
        );

        let _ = global_cache().try_push(req);
        DNS_CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
        DNS_CACHE_SIZE.store(global_cache().len, Ordering::Relaxed);
        global_cache().lock.unlock();

        #[cfg(target_os = "macos")]
        {
            if !feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO.get() {
                let res = lookup_libinfo(req, unsafe { (*loop_).internal_loop_data.get_parent() });
                bun_output::scoped_log!(dns, "getaddrinfo({}) = cache miss (libinfo)", bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b"")));
                if res { return Some(req); }
                // if we were not able to use libinfo, we fall back to the work pool
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = loop_;

        bun_output::scoped_log!(dns, "getaddrinfo({}) = cache miss (libc)", bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b"")));
        // schedule the request to be executed on the work pool
        bun_threading::WorkPool::go(req, work_pool_callback);
        Some(req)
    }

    #[host_fn]
    pub fn prefetch_from_js(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();

        if arguments.len() < 1 {
            return global_this.throw_not_enough_arguments("prefetch", 1, arguments.len());
        }

        let hostname_or_url = arguments[0];

        let hostname_slice;
        if hostname_or_url.is_string() {
            hostname_slice = hostname_or_url.to_slice(global_this)?;
        } else {
            return global_this.throw_invalid_arguments("hostname must be a string", &[]);
        }

        let hostname_z = ZStr::from_bytes(hostname_slice.slice());

        let port: u16 = 'brk: {
            if arguments.len() > 1 && !arguments[1].is_undefined_or_null() {
                break 'brk global_this.validate_integer_range::<u16>(
                    arguments[1], 443, jsc::ValidateIntegerRangeOptions { field_name: "port", always_allow_zero: true },
                )?;
            } else {
                break 'brk 443;
            }
        };

        prefetch(VirtualMachine::get().uws_loop(), Some(&hostname_z), port);
        Ok(JSValue::UNDEFINED)
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
            // SAFETY: caller passes NUL-terminated string
            Some(unsafe { ZStr::from_ptr(_host as *const u8) })
        };
        let mut is_cache_hit = false;
        let req = getaddrinfo(loop_, host, port, Some(&mut is_cache_hit)).unwrap();
        unsafe { *socket = req as *mut c_void };
        if is_cache_hit { 0 } else { 1 }
    }

    extern "C" fn us_getaddrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
        global_cache().lock.lock();
        let _g = scopeguard::guard((), |_| global_cache().lock.unlock());
        let query = DNSRequestOwner::Socket(socket);
        unsafe {
            if (*request).result.is_some() {
                query.notify(request);
                return;
            }
            (*request).notify.push(DNSRequestOwner::Socket(socket));
        }
    }

    extern "C" fn us_getaddrinfo_cancel(request: *mut Request, socket: *mut ConnectingSocket) -> c_int {
        global_cache().lock.lock();
        let _g = scopeguard::guard((), |_| global_cache().lock.unlock());
        // afterResult sets result and moves the notify list out under this same
        // lock, so once result is non-null the socket is no longer cancellable
        // (the callback has fired or is about to fire on the worker thread).
        unsafe {
            if (*request).result.is_some() { return 0; }
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

    pub(super) extern "C" fn freeaddrinfo(req: *mut Request, err: c_int) {
        global_cache().lock.lock();
        let _g = scopeguard::guard((), |_| global_cache().lock.unlock());

        unsafe {
            if err != 0 {
                (*req).valid = false;
            }
            DNS_CACHE_ERRORS.fetch_add((err != 0) as usize, Ordering::Relaxed);

            debug_assert!((*req).refcount > 0);
            (*req).refcount -= 1;
            if (*req).refcount == 0 && (global_cache().is_nearly_full() || !(*req).valid) {
                bun_output::scoped_log!(dns, "cache --");
                global_cache().remove(req);
                Request::deinit(req);
            }
        }
    }

    extern "C" fn get_request_result(req: *mut Request) -> *mut RequestResult {
        // SAFETY: caller (usockets) only invokes this after notify, when result is set
        unsafe { (*req).result.as_mut().unwrap() as *mut RequestResult }
    }

    // FFI exports — Zig used `@export` in a `comptime { }` block.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
        us_getaddrinfo_set(request, socket)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_cancel(request: *mut Request, socket: *mut ConnectingSocket) -> c_int {
        us_getaddrinfo_cancel(request, socket)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_get(loop_: *mut Loop, host: *const c_char, port: u16, socket: *mut *mut c_void) -> c_int {
        us_getaddrinfo(loop_, host, port, socket)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_freeRequest(req: *mut Request, err: c_int) {
        freeaddrinfo(req, err)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_getRequestResult(req: *mut Request) -> *mut RequestResult {
        get_request_result(req)
    }
}

pub use internal::Request as InternalDNSRequest;

// ──────────────────────────────────────────────────────────────────────────
// Resolver — JSC-exposed `dns.Resolver` (m_ctx payload of JSDNSResolver)
// ──────────────────────────────────────────────────────────────────────────

/// Field selector standing in for Zig's `comptime cache_field: []const u8` /
/// `std.meta.FieldEnum(Resolver)` — Rust cannot index struct fields by name string.
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

pub type PendingCache = HiveArray<get_addr_info_request::PendingCacheKey, 32>;
type SrvPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_srv_reply>, 32>;
type SoaPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_soa_reply>, 32>;
type TxtPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_txt_reply>, 32>;
type NaptrPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_naptr_reply>, 32>;
type MxPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_mx_reply>, 32>;
type CaaPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_ares_caa_reply>, 32>;
type NSPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::NsHostent>, 32>;
type PtrPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::PtrHostent>, 32>;
type CnamePendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::CnameHostent>, 32>;
type APendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::AHostentWithTtls>, 32>;
type AAAAPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::AaaaHostentWithTtls>, 32>;
type AnyPendingCache = HiveArray<resolve_info_request::PendingCacheKey<c_ares::struct_any_reply>, 32>;
type AddrPendingCache = HiveArray<get_host_by_addr_info_request::PendingCacheKey, 32>;
type NameInfoPendingCache = HiveArray<get_name_info_request::PendingCacheKey, 32>;
// TODO(port): Zig instantiated ns/ptr/cname over the same `c_ares.struct_hostent` with
// different comptime `type_name` strings, and a/aaaa over `hostent_with_ttls`. Rust needs
// distinct newtype wrappers (NsHostent etc.) implementing `CAresRecordType` to keep the
// per-record cache types distinct. Define those in c_ares.rs.

#[cfg(windows)]
type PollType = UvDnsPoll;
#[cfg(not(windows))]
type PollType = FilePoll;

type PollsMap = ArrayHashMap<c_ares::ares_socket_t, *mut PollType>;

#[bun_jsc::JsClass]
pub struct Resolver {
    pub ref_count: bun_ptr::IntrusiveRcField, // bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
    pub channel: Option<*mut c_ares::Channel>, // FFI
    pub vm: &'static VirtualMachine, // JSC_BORROW
    pub polls: PollsMap,
    pub options: c_ares::ChannelOptions,

    pub event_loop_timer: EventLoopTimer,

    pub pending_host_cache_cares: PendingCache,
    pub pending_host_cache_native: PendingCache,
    pub pending_srv_cache_cares: SrvPendingCache,
    pub pending_soa_cache_cares: SoaPendingCache,
    pub pending_txt_cache_cares: TxtPendingCache,
    pub pending_naptr_cache_cares: NaptrPendingCache,
    pub pending_mx_cache_cares: MxPendingCache,
    pub pending_caa_cache_cares: CaaPendingCache,
    pub pending_ns_cache_cares: NSPendingCache,
    pub pending_ptr_cache_cares: PtrPendingCache,
    pub pending_cname_cache_cares: CnamePendingCache,
    pub pending_a_cache_cares: APendingCache,
    pub pending_aaaa_cache_cares: AAAAPendingCache,
    pub pending_any_cache_cares: AnyPendingCache,
    pub pending_addr_cache_cares: AddrPendingCache,
    pub pending_nameinfo_cache_cares: NameInfoPendingCache,
}

pub struct UvDnsPoll {
    pub parent: *const Resolver, // BACKREF
    pub socket: c_ares::ares_socket_t,
    pub poll: libuv::uv_poll_t,
}

impl UvDnsPoll {
    pub fn new(parent: *const Resolver, socket: c_ares::ares_socket_t) -> *mut Self {
        Box::into_raw(Box::new(Self {
            parent,
            socket,
            poll: unsafe { core::mem::zeroed() },
        }))
    }

    pub fn destroy(this: *mut Self) {
        unsafe { drop(Box::from_raw(this)) };
    }

    pub fn from_poll(poll: *mut libuv::uv_poll_t) -> *mut Self {
        // SAFETY: poll points to UvDnsPoll.poll
        unsafe {
            (poll as *mut u8).sub(offset_of!(UvDnsPoll, poll)).cast::<UvDnsPoll>()
        }
    }
}

pub enum CacheHit {
    Inflight(*mut get_addr_info_request::PendingCacheKey), // BORROW_FIELD into resolver buffer
    New(*mut get_addr_info_request::PendingCacheKey),      // BORROW_FIELD into resolver buffer
    Disabled,
}

pub enum LookupCacheHit<R> {
    // TODO(port): Zig's `LookupCacheHit(request_type)` referenced `request_type.PendingCacheKey`.
    // We thread the request type via `R` and resolve `PendingCacheKey` per-impl below.
    Inflight(*mut R::PendingCacheKey), // BORROW_FIELD
    New(*mut R::PendingCacheKey),      // BORROW_FIELD
    Disabled,
}
// TODO(port): replace `R::PendingCacheKey` projection with an associated-type trait
// `pub trait HasPendingCacheKey { type PendingCacheKey; }` impl'd by each request type.

pub enum ChannelResult<'a> {
    Err(c_ares::Error),
    Result(&'a mut c_ares::Channel), // BORROW_FIELD — returns this.channel.?
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Order {
    #[strum(serialize = "verbatim")]
    Verbatim = 0,
    #[strum(serialize = "ipv4first")]
    Ipv4first = 4,
    #[strum(serialize = "ipv6first")]
    Ipv6first = 6,
}

impl Order {
    pub const DEFAULT: Self = Order::Verbatim;

    pub static MAP: phf::Map<&'static [u8], Order> = phf::phf_map! {
        b"verbatim" => Order::Verbatim,
        b"ipv4first" => Order::Ipv4first,
        b"ipv6first" => Order::Ipv6first,
        b"0" => Order::Verbatim,
        b"4" => Order::Ipv4first,
        b"6" => Order::Ipv6first,
    };

    pub fn to_js(self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        ZigString::init(<&'static str>::from(self).as_bytes()).to_js(global_this)
    }

    pub fn from_string(order: &[u8]) -> Option<Order> {
        Self::MAP.get(order).copied()
    }

    pub fn from_string_or_die(order: &[u8]) -> Order {
        Self::from_string(order).unwrap_or_else(|| {
            Output::pretty_errorln("<r><red>error<r><d>:<r> Invalid DNS result order.", &[]);
            Global::exit(1);
        })
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

impl RecordType {
    pub const DEFAULT: Self = RecordType::A;

    pub static MAP: phf::Map<&'static [u8], RecordType> = phf::phf_map! {
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

struct DNSQuery {
    name: ZigStringSlice,
    record_type: RecordType,
    ttl: i32,
}

impl Resolver {
    // Intrusive refcount forwarders (RefCount.ref / RefCount.deref).
    pub fn ref_(&self) { self.ref_count.ref_(); }
    pub fn deref(&self) {
        if self.ref_count.deref() {
            // SAFETY: last ref; self is heap-allocated via Box::into_raw
            Self::deinit(self as *const Self as *mut Self);
        }
    }

    pub fn setup(vm: &VirtualMachine) -> Self {
        Self {
            ref_count: bun_ptr::IntrusiveRcField::init(),
            channel: None,
            // SAFETY: VM lives for program lifetime
            vm: unsafe { core::mem::transmute(vm) },
            polls: PollsMap::new(),
            options: c_ares::ChannelOptions::default(),
            event_loop_timer: EventLoopTimer { next: bun::timespec::EPOCH, tag: EventLoopTimer::Tag::DNSResolver, ..Default::default() },
            pending_host_cache_cares: PendingCache::empty(),
            pending_host_cache_native: PendingCache::empty(),
            pending_srv_cache_cares: HiveArray::empty(),
            pending_soa_cache_cares: HiveArray::empty(),
            pending_txt_cache_cares: HiveArray::empty(),
            pending_naptr_cache_cares: HiveArray::empty(),
            pending_mx_cache_cares: HiveArray::empty(),
            pending_caa_cache_cares: HiveArray::empty(),
            pending_ns_cache_cares: HiveArray::empty(),
            pending_ptr_cache_cares: HiveArray::empty(),
            pending_cname_cache_cares: HiveArray::empty(),
            pending_a_cache_cares: HiveArray::empty(),
            pending_aaaa_cache_cares: HiveArray::empty(),
            pending_any_cache_cares: HiveArray::empty(),
            pending_addr_cache_cares: HiveArray::empty(),
            pending_nameinfo_cache_cares: HiveArray::empty(),
        }
    }

    pub fn init(vm: &VirtualMachine) -> *mut Self {
        bun_output::scoped_log!(DNSResolver, "init");
        Box::into_raw(Box::new(Self::setup(vm)))
    }

    pub fn finalize(this: *mut Self) {
        unsafe { (*this).deref() };
    }

    fn deinit(this: *mut Self) {
        unsafe {
            if let Some(channel) = (*this).channel {
                (*channel).deinit();
            }
            drop(Box::from_raw(this));
        }
    }

    // ───────────── timer / pending bookkeeping ─────────────

    pub fn check_timeouts(&mut self, now: &bun::timespec, vm: &VirtualMachine) {
        let _g = scopeguard::guard((), |_| {
            vm.timer.increment_timer_ref(-1);
            self.deref();
        });

        self.event_loop_timer.state = EventLoopTimer::State::PENDING;

        if let Ok(channel) = self.get_channel_or_error(vm.global) {
            if self.any_requests_pending() {
                unsafe { c_ares::ares_process_fd(channel, c_ares::ARES_SOCKET_BAD, c_ares::ARES_SOCKET_BAD) };
                let _ = self.add_timer(Some(now));
            }
        }
    }

    fn any_requests_pending(&self) -> bool {
        // TODO(port): Zig used @typeInfo to iterate all `pending_*` fields.
        macro_rules! check { ($($f:ident),*) => { $( if self.$f.used.find_first_set().is_some() { return true; } )* } }
        check!(
            pending_host_cache_cares, pending_host_cache_native, pending_srv_cache_cares,
            pending_soa_cache_cares, pending_txt_cache_cares, pending_naptr_cache_cares,
            pending_mx_cache_cares, pending_caa_cache_cares, pending_ns_cache_cares,
            pending_ptr_cache_cares, pending_cname_cache_cares, pending_a_cache_cares,
            pending_aaaa_cache_cares, pending_any_cache_cares, pending_addr_cache_cares,
            pending_nameinfo_cache_cares
        );
        false
    }

    fn request_sent(&mut self, _vm: &VirtualMachine) {
        let _ = self.add_timer(None);
    }

    fn request_completed(&mut self) {
        if self.any_requests_pending() {
            let _ = self.add_timer(None);
        } else {
            self.remove_timer();
        }
    }

    fn add_timer(&mut self, now: Option<&bun::timespec>) -> bool {
        if self.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
            return false;
        }

        self.ref_();
        let now_ts = now.copied().unwrap_or_else(|| bun::timespec::now(bun::TimeSource::AllowMockedTime));
        self.event_loop_timer.next = now_ts.add_ms(1000);
        self.vm.timer.increment_timer_ref(1);
        self.vm.timer.insert(&mut self.event_loop_timer);
        true
    }

    fn remove_timer(&mut self) {
        if self.event_loop_timer.state != EventLoopTimer::State::ACTIVE {
            return;
        }

        // Normally checkTimeouts does this, so we have to be sure to do it ourself if we cancel the timer
        let _g = scopeguard::guard((), |_| {
            self.vm.timer.increment_timer_ref(-1);
            self.deref();
        });

        self.vm.timer.remove(&mut self.event_loop_timer);
    }

    // ───────────── pending-cache helpers ─────────────

    /// Dispatch to the GetAddrInfo PendingCache by field enum.
    fn pending_host_cache(&mut self, field: PendingCacheField) -> &mut PendingCache {
        match field {
            PendingCacheField::PendingHostCacheCares => &mut self.pending_host_cache_cares,
            PendingCacheField::PendingHostCacheNative => &mut self.pending_host_cache_native,
            _ => unreachable!(),
        }
    }

    /// Dispatch to a typed ResolveInfoRequest cache by record type.
    // TODO(port): Zig used `@field(this, cache_name)` with a comptime string.
    fn pending_cache_for<T: CAresRecordType>(
        &mut self,
        _field: PendingCacheField,
    ) -> &mut HiveArray<resolve_info_request::PendingCacheKey<T>, 32> {
        // TODO(port): proc-macro / specialization — return the matching `pending_{TYPE_NAME}_cache_cares`.
        unimplemented!("dispatch on T::CACHE_FIELD in Phase B")
    }

    fn get_key<R>(&mut self, index: u8, cache_field: PendingCacheField) -> R
    where
        R: Copy, // PendingCacheKey is POD
    {
        // TODO(port): generic over cache type — Zig used `@field(this, cache_name)`
        // and returned `request_type.PendingCacheKey` by value, then poisoned the slot.
        unimplemented!("dispatch on cache_field in Phase B; see get_key_{{host,addr,nameinfo}} helpers")
    }

    // Monomorphic helpers used by the drain* fns below.
    fn get_key_host(&mut self, index: u8, field: PendingCacheField) -> get_addr_info_request::PendingCacheKey {
        let cache = self.pending_host_cache(field);
        debug_assert!(cache.used.is_set(index as usize));
        let entry = unsafe { core::ptr::read(&cache.buffer[index as usize]) };
        cache.used.unset(index as usize);
        entry
    }
    fn get_key_addr(&mut self, index: u8) -> get_host_by_addr_info_request::PendingCacheKey {
        let cache = &mut self.pending_addr_cache_cares;
        debug_assert!(cache.used.is_set(index as usize));
        let entry = unsafe { core::ptr::read(&cache.buffer[index as usize]) };
        cache.used.unset(index as usize);
        entry
    }
    fn get_key_nameinfo(&mut self, index: u8) -> get_name_info_request::PendingCacheKey {
        let cache = &mut self.pending_nameinfo_cache_cares;
        debug_assert!(cache.used.is_set(index as usize));
        let entry = unsafe { core::ptr::read(&cache.buffer[index as usize]) };
        cache.used.unset(index as usize);
        entry
    }

    pub fn drain_pending_cares<T: CAresRecordType>(
        &mut self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut T>,
    ) {
        // cache_name = format!("pending_{}_cache_cares", T::TYPE_NAME)
        self.ref_();
        let _g = scopeguard::guard((), |_| self.deref());

        // TODO(port): generic getKey over T::CACHE_FIELD
        let cache = self.pending_cache_for::<T>(T::CACHE_FIELD);
        debug_assert!(cache.used.is_set(index as usize));
        let key = unsafe { core::ptr::read(&cache.buffer[index as usize]) };
        cache.used.unset(index as usize);

        let Some(addr) = result else {
            unsafe {
                let mut pending = (*key.lookup).head.next;
                (*key.lookup).head.process_resolve(err, timeout, None);
                drop(Box::from_raw(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    (*value.as_ptr()).process_resolve(err, timeout, None);
                }
            }
            return;
        };

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this;
            let mut array = (*addr).to_js_response(prev_global, T::TYPE_NAME).unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            // SAFETY: addr is the c-ares-allocated reply; freed once after all consumers run.
            let _free_addr = scopeguard::guard((), |_| T::destroy(addr));
            array.ensure_still_alive();
            (*key.lookup).head.on_complete(array);
            drop(Box::from_raw(key.lookup));

            array.ensure_still_alive();

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this;
                if !core::ptr::eq(prev_global, new_global) {
                    array = (*addr).to_js_response(new_global, T::TYPE_NAME).unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                (*value.as_ptr()).on_complete(array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_host_cares(
        &mut self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::AddrInfo>,
    ) {
        let key = self.get_key_host(index, PendingCacheField::PendingHostCacheCares);

        self.ref_();
        let _g = scopeguard::guard((), |_| self.deref());

        let Some(addr) = result else {
            unsafe {
                let mut pending = (*key.lookup).head.next;
                (*key.lookup).head.process_get_addr_info(err, timeout, None);
                drop(Box::from_raw(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    (*value.as_ptr()).process_get_addr_info(err, timeout, None);
                }
            }
            return;
        };

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this;
            let mut array = (*addr).to_js_array(prev_global).unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            // SAFETY: addr is the c-ares-allocated AddrInfo; freed once after all consumers run.
            let _free_addr = scopeguard::guard((), |_| c_ares::AddrInfo::destroy(addr));
            array.ensure_still_alive();
            (*key.lookup).head.on_complete_with_array(array);
            drop(Box::from_raw(key.lookup));

            array.ensure_still_alive();
            // std.c.addrinfo

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this;
                if !core::ptr::eq(prev_global, new_global) {
                    array = (*addr).to_js_array(new_global).unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                (*value.as_ptr()).on_complete_with_array(array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_host_native(
        &mut self,
        index: u8,
        global_object: &JSGlobalObject,
        err: i32,
        result: GetAddrInfo::Result::Any,
    ) {
        bun_output::scoped_log!(DNSResolver, "drainPendingHostNative");
        let key = self.get_key_host(index, PendingCacheField::PendingHostCacheNative);

        self.ref_();
        let _g = scopeguard::guard((), |_| self.deref());

        let mut array = match result.to_js(global_object).unwrap_or(JSValue::ZERO) { // TODO: properly propagate exception upwards
            Some(a) => a,
            None => {
                unsafe {
                    let mut pending = (*key.lookup).head.next;
                    let mut head = core::ptr::read(&(*key.lookup).head);
                    head.process_get_addr_info_native(err, ptr::null_mut());
                    drop(Box::from_raw(key.lookup));

                    while let Some(value) = pending {
                        pending = (*value.as_ptr()).next;
                        (*value.as_ptr()).process_get_addr_info_native(err, ptr::null_mut());
                    }
                }
                return;
            }
        };
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this;

            {
                array.ensure_still_alive();
                (*key.lookup).head.on_complete_with_array(array);
                drop(Box::from_raw(key.lookup));
                array.ensure_still_alive();
            }

            // std.c.addrinfo

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this;
                pending = (*value.as_ptr()).next;
                if !core::ptr::eq(prev_global, new_global) {
                    array = result.to_js(new_global).unwrap_or(JSValue::ZERO).unwrap(); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }

                array.ensure_still_alive();
                (*value.as_ptr()).on_complete_with_array(array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_addr_cares(
        &mut self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        let key = self.get_key_addr(index);

        self.ref_();
        let _g = scopeguard::guard((), |_| self.deref());

        let Some(addr) = result else {
            unsafe {
                let mut pending = (*key.lookup).head.next;
                (*key.lookup).head.process_resolve(err, timeout, None);
                drop(Box::from_raw(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    (*value.as_ptr()).process_resolve(err, timeout, None);
                }
            }
            return;
        };

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this;
            //  The callback need not and should not attempt to free the memory
            //  pointed to by hostent; the ares library will free it when the
            //  callback returns.
            let mut array = (*addr).to_js_response(prev_global, "").unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            array.ensure_still_alive();
            (*key.lookup).head.on_complete(array);
            drop(Box::from_raw(key.lookup));

            array.ensure_still_alive();

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this;
                if !core::ptr::eq(prev_global, new_global) {
                    array = (*addr).to_js_response(new_global, "").unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                (*value.as_ptr()).on_complete(array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_name_info_cares(
        &mut self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        let key = self.get_key_nameinfo(index);

        self.ref_();
        let _g = scopeguard::guard((), |_| self.deref());

        let Some(mut name_info) = result else {
            unsafe {
                let mut pending = (*key.lookup).head.next;
                (*key.lookup).head.process_resolve(err, timeout, None);
                drop(Box::from_raw(key.lookup));

                while let Some(value) = pending {
                    pending = (*value.as_ptr()).next;
                    (*value.as_ptr()).process_resolve(err, timeout, None);
                }
            }
            return;
        };

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this;

            let mut array = name_info.to_js_response(prev_global).unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            array.ensure_still_alive();
            (*key.lookup).head.on_complete(array);
            drop(Box::from_raw(key.lookup));

            array.ensure_still_alive();

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this;
                if !core::ptr::eq(prev_global, new_global) {
                    array = name_info.to_js_response(new_global).unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                (*value.as_ptr()).on_complete(array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn get_or_put_into_resolve_pending_cache<R>(
        &mut self,
        key: &R::PendingCacheKey,
        field: PendingCacheField,
    ) -> LookupCacheHit<R> {
        // TODO(port): Zig used `@field(this, field)` over a comptime string. We dispatch
        // on `field` to the matching HiveArray; the body is identical across all R.
        // Phase B: implement via macro per record type or trait `HasPendingCacheKey`.
        unimplemented!("dispatch on field in Phase B")
    }

    pub fn get_or_put_into_pending_cache(
        &mut self,
        key: get_addr_info_request::PendingCacheKey,
        field: PendingCacheField,
    ) -> CacheHit {
        let cache = self.pending_host_cache(field);
        let mut inflight_iter = cache.used.iter_set();

        while let Some(index) = inflight_iter.next() {
            let entry = &mut cache.buffer[index];
            if entry.hash == key.hash && entry.len == key.len {
                return CacheHit::Inflight(entry as *mut _);
            }
        }

        if let Some(new) = cache.get() {
            new.hash = key.hash;
            new.len = key.len;
            return CacheHit::New(new as *mut _);
        }

        CacheHit::Disabled
    }

    pub fn get_channel(&mut self) -> ChannelResult<'_> {
        if self.channel.is_none() {
            if let Some(err) = c_ares::Channel::init(self, &self.options) {
                return ChannelResult::Err(err);
            }
        }
        // SAFETY: channel set by init() on success
        ChannelResult::Result(unsafe { &mut *self.channel.unwrap() })
    }

    fn get_channel_from_vm(global_this: &JSGlobalObject) -> JsResult<*mut c_ares::Channel> {
        let vm = global_this.bun_vm();
        let resolver = vm.rare_data().global_dns_resolver(vm);
        resolver.get_channel_or_error(global_this)
    }

    pub fn get_channel_or_error(&mut self, global_this: &JSGlobalObject) -> JsResult<*mut c_ares::Channel> {
        match self.get_channel() {
            ChannelResult::Result(result) => Ok(result as *mut _),
            ChannelResult::Err(err) => {
                let system_error = SystemError {
                    errno: -1,
                    code: bun_str::String::static_(err.code()),
                    message: bun_str::String::static_(err.label()),
                    ..Default::default()
                };
                global_this.throw_value(system_error.to_error_instance(global_this))
            }
        }
    }

    // ───────────── poll callbacks ─────────────

    pub extern "C" fn on_dns_poll_uv(watcher: *mut libuv::uv_poll_t, status: c_int, events: c_int) {
        let poll = UvDnsPoll::from_poll(watcher);
        unsafe {
            let parent = (*poll).parent as *mut Resolver;
            let vm = (*parent).vm;
            vm.event_loop().enter();
            let _exit = scopeguard::guard((), |_| vm.event_loop().exit());
            (*parent).ref_();
            let _deref = scopeguard::guard((), |_| (*parent).deref());
            // channel must be non-null here as c_ares must have been initialized if we're receiving callbacks
            let channel = (*parent).channel.unwrap();
            if status < 0 {
                // an error occurred. just pretend that the socket is both readable and writable.
                // https://github.com/nodejs/node/blob/8a41d9b636be86350cd32847c3f89d327c4f6ff7/src/cares_wrap.cc#L93
                (*channel).process((*poll).socket, true, true);
                return;
            }
            (*channel).process(
                (*poll).socket,
                events & libuv::UV_READABLE != 0,
                events & libuv::UV_WRITABLE != 0,
            );
        }
    }

    pub extern "C" fn on_close_uv(watcher: *mut c_void) {
        let poll = UvDnsPoll::from_poll(watcher.cast());
        UvDnsPoll::destroy(poll);
    }

    pub fn on_dns_poll(&mut self, poll: &mut FilePoll) {
        let vm = self.vm;
        vm.event_loop().enter();
        let _exit = scopeguard::guard((), |_| vm.event_loop().exit());
        let Some(channel) = self.channel else {
            let _ = self.polls.ordered_remove(&poll.fd.native());
            poll.deinit();
            return;
        };

        self.ref_();
        let _deref = scopeguard::guard((), |_| self.deref());

        unsafe {
            (*channel).process(poll.fd.native(), poll.is_readable(), poll.is_writable());
        }
    }

    pub fn on_dns_socket_state(&mut self, fd: c_ares::ares_socket_t, readable: bool, writable: bool) {
        #[cfg(windows)]
        {
            use libuv as uv;
            if !readable && !writable {
                // cleanup
                if let Some(entry) = self.polls.fetch_ordered_remove(&fd) {
                    unsafe { uv::uv_close((&mut (*entry.value).poll) as *mut _ as *mut _, Some(Self::on_close_uv)) };
                }
                return;
            }

            let poll_entry = self.polls.get_or_put(fd);
            if !poll_entry.found_existing {
                let poll = UvDnsPoll::new(self, fd);
                if unsafe { uv::uv_poll_init_socket(Loop::get().uv_loop, &mut (*poll).poll, fd as _) } < 0 {
                    UvDnsPoll::destroy(poll);
                    let _ = self.polls.swap_remove(&fd);
                    return;
                }
                *poll_entry.value_ptr = poll;
            }

            let poll: *mut UvDnsPoll = *poll_entry.value_ptr;

            let uv_events = (if readable { uv::UV_READABLE } else { 0 }) | (if writable { uv::UV_WRITABLE } else { 0 });
            if unsafe { uv::uv_poll_start(&mut (*poll).poll, uv_events, Some(Self::on_dns_poll_uv)) } < 0 {
                let _ = self.polls.swap_remove(&fd);
                unsafe { uv::uv_close((&mut (*poll).poll) as *mut _ as *mut _, Some(Self::on_close_uv)) };
            }
        }
        #[cfg(not(windows))]
        {
            let vm = self.vm;

            if !readable && !writable {
                // read == 0 and write == 0 this is c-ares's way of notifying us that
                // the socket is now closed. We must free the data associated with
                // socket.
                if let Some(entry) = self.polls.fetch_ordered_remove(&fd) {
                    unsafe { (*entry.value).deinit_with_vm(vm) };
                }
                return;
            }

            let poll_entry = self.polls.get_or_put(fd).expect("unreachable");

            if !poll_entry.found_existing {
                *poll_entry.value_ptr = FilePoll::init(vm, sys::Fd::from_native(fd), Default::default(), self);
                // TODO(port): FilePoll generic owner type Resolver
            }

            let poll = unsafe { &mut **poll_entry.value_ptr };

            // c-ares reports the full desired (readable, writable) set for this
            // fd; sync the poll's registration to match. FilePoll now supports
            // both directions on one poll (epoll: combined mask via CTL_MOD;
            // kqueue: two filters on the same ident, both EV_DELETEd on
            // unregister).
            let loop_ = vm.event_loop_handle.unwrap();
            let have_readable = poll.flags.contains(Async::PollFlags::POLL_READABLE);
            let have_writable = poll.flags.contains(Async::PollFlags::POLL_WRITABLE);

            if (have_readable && !readable) || (have_writable && !writable) {
                // Dropping a direction. FilePoll has no per-direction
                // unregister (epoll CTL_DEL removes both; a targeted kqueue
                // EV_DELETE would need a new API), and leaving the unwanted
                // direction armed would busy-loop on level-triggered writable
                // once the socket connects. Full resync is the simplest
                // correct path and c-ares DNS fds are short-lived.
                let _ = poll.unregister(loop_, false);
                if readable { let _ = poll.register(loop_, Async::PollKind::Readable, false); }
                if writable { let _ = poll.register(loop_, Async::PollKind::Writable, false); }
            } else {
                // Only adding directions (or no change). register() issues a
                // single CTL_MOD on epoll that preserves the other direction;
                // on kqueue EV_ADD creates a separate (ident, filter) knote
                // without disturbing the existing one.
                if readable && !have_readable { let _ = poll.register(loop_, Async::PollKind::Readable, false); }
                if writable && !have_writable { let _ = poll.register(loop_, Async::PollKind::Writable, false); }
            }
        }
    }

    // ───────────── JS host fns: resolve* family ─────────────

    #[host_fn]
    pub fn global_resolve(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let vm = global_this.bun_vm();
        let resolver = vm.rare_data().global_dns_resolver(vm);
        resolver.resolve(global_this, callframe)
    }

    #[host_fn(method)]
    pub fn resolve(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(3);
        if arguments.len() < 1 {
            return global_this.throw_not_enough_arguments("resolve", 3, arguments.len());
        }

        let record_type: RecordType = if arguments.len() <= 1 {
            RecordType::DEFAULT
        } else {
            'brk: {
                let record_type_value = arguments.ptr[1];
                if record_type_value.is_empty_or_undefined_or_null() || !record_type_value.is_string() {
                    break 'brk RecordType::DEFAULT;
                }
                let record_type_str = record_type_value.to_js_string(global_this)?;
                if record_type_str.length() == 0 {
                    break 'brk RecordType::DEFAULT;
                }
                // TODO(port): phf custom hasher — Zig used getWithEql with ZigString.eqlComptime
                match RecordType::MAP.get(record_type_str.get_zig_string(global_this).slice()) {
                    Some(r) => *r,
                    None => return global_this.throw_invalid_argument_property_value(
                        "record",
                        "one of: A, AAAA, ANY, CAA, CNAME, MX, NS, PTR, SOA, SRV, TXT",
                        record_type_value,
                    ),
                }
            }
        };

        let name_value = arguments.ptr[0];
        if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
            return global_this.throw_invalid_argument_type("resolve", "name", "string");
        }
        let name_str = name_value.to_js_string(global_this)?;
        if name_str.length() == 0 {
            return global_this.throw_invalid_argument_type("resolve", "name", "non-empty string");
        }
        let name = name_str.to_slice_clone(global_this)?;

        match record_type {
            RecordType::A => this.do_resolve_cares::<c_ares::AHostentWithTtls>(name.slice(), global_this),
            RecordType::AAAA => this.do_resolve_cares::<c_ares::AaaaHostentWithTtls>(name.slice(), global_this),
            RecordType::ANY => this.do_resolve_cares::<c_ares::struct_any_reply>(name.slice(), global_this),
            RecordType::CAA => this.do_resolve_cares::<c_ares::struct_ares_caa_reply>(name.slice(), global_this),
            RecordType::CNAME => this.do_resolve_cares::<c_ares::CnameHostent>(name.slice(), global_this),
            RecordType::MX => this.do_resolve_cares::<c_ares::struct_ares_mx_reply>(name.slice(), global_this),
            RecordType::NS => this.do_resolve_cares::<c_ares::NsHostent>(name.slice(), global_this),
            RecordType::PTR => this.do_resolve_cares::<c_ares::PtrHostent>(name.slice(), global_this),
            RecordType::SOA => this.do_resolve_cares::<c_ares::struct_ares_soa_reply>(name.slice(), global_this),
            RecordType::SRV => this.do_resolve_cares::<c_ares::struct_ares_srv_reply>(name.slice(), global_this),
            RecordType::TXT => this.do_resolve_cares::<c_ares::struct_ares_txt_reply>(name.slice(), global_this),
        }
    }

    #[host_fn]
    pub fn global_reverse(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let vm = global_this.bun_vm();
        let resolver = vm.rare_data().global_dns_resolver(vm);
        resolver.reverse(global_this, callframe)
    }

    #[host_fn(method)]
    pub fn reverse(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2);
        if arguments.len() < 1 {
            return global_this.throw_not_enough_arguments("reverse", 1, arguments.len());
        }

        let ip_value = arguments.ptr[0];
        if ip_value.is_empty_or_undefined_or_null() || !ip_value.is_string() {
            return global_this.throw_invalid_argument_type("reverse", "ip", "string");
        }
        let ip_str = ip_value.to_js_string(global_this)?;
        if ip_str.length() == 0 {
            return global_this.throw_invalid_argument_type("reverse", "ip", "non-empty string");
        }

        let ip_slice = ip_str.to_slice_clone(global_this)?;
        let ip = ip_slice.slice();
        let channel: *mut c_ares::Channel = match this.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                return global_this.throw_value(err.to_js_with_syscall_and_hostname(global_this, "getHostByAddr", ip)?);
            }
        };

        let key = get_host_by_addr_info_request::PendingCacheKey::init(ip);
        let cache = this.get_or_put_into_resolve_pending_cache::<GetHostByAddrInfoRequest>(
            &key,
            PendingCacheField::PendingAddrCacheCares,
        );
        if let LookupCacheHit::Inflight(inflight) = cache {
            let cares_reverse = CAresReverse::init(Some(this), global_this, ip);
            unsafe { (*inflight).append(cares_reverse) };
            return Ok(unsafe { (*cares_reverse).promise.value() });
        }

        let request = GetHostByAddrInfoRequest::init(
            cache, Some(this), ip, global_this, PendingCacheField::PendingAddrCacheCares,
        );

        let promise = unsafe { (*(*request).tail).promise.value() };
        unsafe {
            (*channel).get_host_by_addr(ip, request, GetHostByAddrInfoRequest::on_cares_complete);
        }

        this.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    #[host_fn]
    pub fn global_lookup(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2);
        if arguments.len() < 1 {
            return global_this.throw_not_enough_arguments("lookup", 2, arguments.len());
        }

        let name_value = arguments.ptr[0];
        if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
            return global_this.throw_invalid_argument_type("lookup", "hostname", "string");
        }
        let name_str = name_value.to_js_string(global_this)?;
        if name_str.length() == 0 {
            return global_this.throw_invalid_argument_type("lookup", "hostname", "non-empty string");
        }

        let mut options = GetAddrInfo::Options::default();
        let mut port: u16 = 0;

        if arguments.len() > 1 && arguments.ptr[1].is_object() {
            let options_object = arguments.ptr[1];

            if let Some(port_value) = options_object.get_truthy(global_this, "port")? {
                port = port_value.to_port_number(global_this)?;
            }

            options = match GetAddrInfo::Options::from_js(options_object, global_this) {
                Ok(o) => o,
                Err(err) => {
                    return match err {
                        e if e == bun_core::err!(InvalidFlags) => global_this.throw_invalid_argument_value(
                            "flags",
                            options_object.get_truthy(global_this, "flags")?.unwrap_or(JSValue::UNDEFINED),
                        ),
                        e if e.is_js_error() => Err(e.into()),
                        e if e == bun_core::err!(OutOfMemory) => Err(jsc::JsError::OutOfMemory),
                        e if e.is_js_terminated() => Err(jsc::JsError::Terminated),
                        // more information with these errors
                        _ => global_this.throw(format_args!(
                            "Invalid options passed to lookup(): {}",
                            err.name()
                        )),
                    };
                }
            };
        }

        let name = name_str.to_slice(global_this);
        let vm = global_this.bun_vm();
        let resolver = vm.rare_data().global_dns_resolver(vm);

        resolver.do_lookup(name.slice(), port, options, global_this)
    }

    pub fn do_lookup(
        &mut self,
        name: &[u8],
        port: u16,
        options: GetAddrInfo::Options,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // The system backends copy the hostname into a fixed `bun.PathBuffer` on the
        // stack before null-terminating it. Reject anything that cannot fit so we never
        // index past that buffer. RFC 1035 caps hostnames at 253 octets and NI_MAXHOST
        // is 1025, so this never rejects a name that could have resolved.
        if name.len() >= MAX_PATH_BYTES {
            let mut promise = JSPromise::Strong::init(global_this);
            let promise_value = promise.value();
            c_ares::Error::ENOTFOUND
                .to_deferred("getaddrinfo", Some(name), &mut promise)
                .reject_later(global_this);
            return Ok(promise_value);
        }

        let mut opts = options;
        let mut backend = opts.backend;
        let normalized = normalize_dns_name(name, &mut backend);
        opts.backend = backend;
        let query = GetAddrInfo { options: opts, port, name: normalized.into() };

        Ok(match opts.backend {
            GetAddrInfo::Backend::CAres => self.c_ares_lookup_with_normalized_name(query, global_this)?,
            GetAddrInfo::Backend::Libc => {
                #[cfg(windows)] { lib_uv_backend::lookup(self, query, global_this)? }
                #[cfg(not(windows))] { lib_c::lookup(self, query, global_this) }
            }
            GetAddrInfo::Backend::System => {
                #[cfg(target_os = "macos")] { lib_info::lookup(self, query, global_this) }
                #[cfg(windows)] { lib_uv_backend::lookup(self, query, global_this)? }
                #[cfg(all(not(target_os = "macos"), not(windows)))] { lib_c::lookup(self, query, global_this) }
            }
        })
    }

    // ───────── per-record-type global+instance resolve fns ─────────
    // These are mechanically identical; Zig had one per record type.

    macro_rules! resolve_record_fn {
        ($global:ident, $method:ident, $jsname:literal, $ty:ty, $allow_empty:expr) => {
            #[host_fn]
            pub fn $global(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
                let vm = global_this.bun_vm();
                let resolver = vm.rare_data().global_dns_resolver(vm);
                resolver.$method(global_this, callframe)
            }

            #[host_fn(method)]
            pub fn $method(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
                let arguments = callframe.arguments_old(2);
                if arguments.len() < 1 {
                    return global_this.throw_not_enough_arguments($jsname, 1, arguments.len());
                }
                let name_value = arguments.ptr[0];
                if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
                    return global_this.throw_invalid_argument_type($jsname, "hostname", "string");
                }
                let name_str = name_value.to_js_string(global_this)?;
                if !$allow_empty && name_str.length() == 0 {
                    return global_this.throw_invalid_argument_type($jsname, "hostname", "non-empty string");
                }
                let name = name_str.to_slice_clone(global_this)?;
                this.do_resolve_cares::<$ty>(name.slice(), global_this)
            }
        };
    }

    resolve_record_fn!(global_resolve_srv, resolve_srv, "resolveSrv", c_ares::struct_ares_srv_reply, false);
    resolve_record_fn!(global_resolve_soa, resolve_soa, "resolveSoa", c_ares::struct_ares_soa_reply, true);
    resolve_record_fn!(global_resolve_caa, resolve_caa, "resolveCaa", c_ares::struct_ares_caa_reply, false);
    resolve_record_fn!(global_resolve_ns, resolve_ns, "resolveNs", c_ares::NsHostent, true);
    resolve_record_fn!(global_resolve_ptr, resolve_ptr, "resolvePtr", c_ares::PtrHostent, false);
    resolve_record_fn!(global_resolve_cname, resolve_cname, "resolveCname", c_ares::CnameHostent, false);
    resolve_record_fn!(global_resolve_mx, resolve_mx, "resolveMx", c_ares::struct_ares_mx_reply, false);
    resolve_record_fn!(global_resolve_naptr, resolve_naptr, "resolveNaptr", c_ares::struct_ares_naptr_reply, false);
    resolve_record_fn!(global_resolve_txt, resolve_txt, "resolveTxt", c_ares::struct_ares_txt_reply, false);
    resolve_record_fn!(global_resolve_any, resolve_any, "resolveAny", c_ares::struct_any_reply, false);
    // PORT NOTE: resolveTxt/resolveAny used arguments_old(1) in Zig; collapsed into the macro.

    pub fn do_resolve_cares<T: CAresRecordType>(
        &mut self,
        name: &[u8],
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel: *mut c_ares::Channel = match self.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                // syscall = "query" + ucfirst(TYPE_NAME)
                return global_this.throw_value(err.to_js_with_syscall(global_this, T::syscall_name())?);
            }
        };

        let cache_field = T::CACHE_FIELD; // "pending_{TYPE_NAME}_cache_cares"

        let key = resolve_info_request::PendingCacheKey::<T>::init(name);

        let cache = self.get_or_put_into_resolve_pending_cache::<ResolveInfoRequest<T>>(&key, cache_field);
        if let LookupCacheHit::Inflight(inflight) = cache {
            // CAresLookup will have the name ownership
            let cares_lookup = CAresLookup::<T>::init(Some(self), global_this, name);
            unsafe { (*inflight).append(cares_lookup) };
            return Ok(unsafe { (*cares_lookup).promise.value() });
        }

        let request = ResolveInfoRequest::<T>::init(
            cache, Some(self),
            name, // CAresLookup will have the ownership
            global_this, cache_field,
        );
        let promise = unsafe { (*(*request).tail).promise.value() };

        unsafe {
            (*channel).resolve::<T>(name, T::TYPE_NAME, request, ResolveInfoRequest::<T>::on_cares_complete);
        }

        self.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    pub fn c_ares_lookup_with_normalized_name(
        &mut self,
        query: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel: *mut c_ares::Channel = match self.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                let syscall = bun_str::String::create_atom_ascii(&query.name);
                let system_error = SystemError {
                    errno: -1,
                    code: bun_str::String::static_(err.code()),
                    message: bun_str::String::static_(err.label()),
                    syscall,
                    ..Default::default()
                };
                return global_this.throw_value(system_error.to_error_instance(global_this));
            }
        };

        let key = get_addr_info_request::PendingCacheKey::init(&query);

        let cache = self.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheCares);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(self, global_this);
            unsafe { (*inflight).append(dns_lookup) };
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let hints_buf = [query.to_cares()];
        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::CAres,
            Some(self),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheCares,
        );
        let promise = unsafe { (*(*request).tail).promise.value() };

        unsafe {
            (*channel).get_addr_info(
                &query.name,
                query.port,
                &hints_buf,
                request,
                GetAddrInfoRequest::on_cares_complete,
            );
        }

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
        let r = unsafe { c_ares::ares_get_servers_ports(channel, &mut servers) };
        if r != c_ares::ARES_SUCCESS {
            let err = c_ares::Error::get(r).unwrap();
            return global_this.throw_value(global_this.create_error_instance(
                format_args!("ares_get_servers_ports error: {}", err.label()),
            ));
        }
        let _free = scopeguard::guard((), |_| unsafe { c_ares::ares_free_data(servers.cast()) });

        let values = JSValue::create_empty_array(global_this, 0)?;

        let mut i: u32 = 0;
        let mut cur = servers;
        while !cur.is_null() {
            let current = unsafe { &*cur };
            // Formatting reference: https://nodejs.org/api/dns.html#dnsgetservers
            // Brackets '[' and ']' consume 2 bytes, used for IPv6 format (e.g., '[2001:4860:4860::8888]:1053').
            // Port range is 6 bytes (e.g., ':65535').
            // Null terminator '\0' uses 1 byte.
            let mut buf = [0u8; INET6_ADDRSTRLEN + 2 + 6 + 1];
            let family = current.family;

            let ip = if family == libc::AF_INET6 {
                unsafe { c_ares::ares_inet_ntop(family, &current.addr.addr6 as *const _ as *const c_void, buf[1..].as_mut_ptr() as *mut c_char, (buf.len() - 1) as _) }
            } else {
                unsafe { c_ares::ares_inet_ntop(family, &current.addr.addr4 as *const _ as *const c_void, buf[1..].as_mut_ptr() as *mut c_char, (buf.len() - 1) as _) }
            };
            if ip.is_null() {
                return global_this.throw_value(global_this.create_error_instance(
                    format_args!("ares_inet_ntop error: no more space to convert a network format address"),
                ));
            }

            let mut port = current.tcp_port;
            if port == 0 { port = current.udp_port; }
            if port == 0 { port = IANA_DNS_PORT; }

            // size = strlen(buf+1) + 1
            let size = unsafe { core::ffi::CStr::from_ptr(buf[1..].as_ptr() as *const c_char) }.to_bytes().len() + 1;
            if port == IANA_DNS_PORT {
                values.put_index(global_this, i, ZigString::init(&buf[1..size]).with_encoding().to_js(global_this))?;
            } else if family == libc::AF_INET6 {
                buf[0] = b'[';
                buf[size] = b']';
                use std::io::Write;
                let port_len = {
                    let mut cursor = &mut buf[size + 1..];
                    write!(cursor, ":{}", port).expect("unreachable");
                    buf.len() - (size + 1) - cursor.len()
                };
                values.put_index(global_this, i, ZigString::init(&buf[0..size + 1 + port_len]).with_encoding().to_js(global_this))?;
            } else {
                use std::io::Write;
                let port_len = {
                    let mut cursor = &mut buf[size..];
                    write!(cursor, ":{}", port).expect("unreachable");
                    buf.len() - size - cursor.len()
                };
                values.put_index(global_this, i, ZigString::init(&buf[1..size + port_len]).with_encoding().to_js(global_this))?;
            }

            i += 1;
            cur = current.next;
        }

        Ok(values)
    }

    #[host_fn]
    pub fn get_global_servers(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::get_channel_servers(Self::get_channel_from_vm(global_this)?, global_this, callframe)
    }

    #[host_fn(method)]
    pub fn get_servers(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::get_channel_servers(this.get_channel_or_error(global_this)?, global_this, callframe)
    }

    #[host_fn(method)]
    pub fn set_local_address(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::set_channel_local_addresses(this.get_channel_or_error(global_this)?, global_this, callframe)
    }

    fn set_channel_local_addresses(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return global_this.throw_not_enough_arguments("setLocalAddress", 1, 0);
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
            x if x == c_ares::AF::INET => global_this.throw_invalid_arguments("Cannot specify two IPv4 addresses.", &[]),
            x if x == c_ares::AF::INET6 => global_this.throw_invalid_arguments("Cannot specify two IPv6 addresses.", &[]),
            _ => unreachable!(),
        }
    }

    fn set_channel_local_address(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<c_int> {
        let str_ = value.to_slice(global_this)?;
        let slice = str_.into_owned_slice_z()?;

        let mut addr = [0u8; 16];

        if unsafe { c_ares::ares_inet_pton(c_ares::AF::INET, slice.as_ptr() as *const c_char, addr.as_mut_ptr().cast()) } == 1 {
            let ip = u32::from_be_bytes([addr[0], addr[1], addr[2], addr[3]]);
            unsafe { c_ares::ares_set_local_ip4(channel, ip) };
            return Ok(c_ares::AF::INET);
        }

        if unsafe { c_ares::ares_inet_pton(c_ares::AF::INET6, slice.as_ptr() as *const c_char, addr.as_mut_ptr().cast()) } == 1 {
            unsafe { c_ares::ares_set_local_ip6(channel, addr.as_ptr()) };
            return Ok(c_ares::AF::INET6);
        }

        jsc::Error::INVALID_IP_ADDRESS.throw(global_this, format_args!("Invalid IP address: \"{}\"", bstr::BStr::new(slice.as_bytes())))
    }

    fn set_channel_servers(
        channel: *mut c_ares::Channel,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // It's okay to call dns.setServers with active queries, but not dns.Resolver.setServers
        if channel != Self::get_channel_from_vm(global_this)?
            && unsafe { c_ares::ares_queue_active_queries(channel) } != 0
        {
            return global_this
                .err(jsc::Error::DNS_SET_SERVERS_FAILED, format_args!("Failed to set servers: there are pending queries"))
                .throw();
        }

        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return global_this.throw_not_enough_arguments("setServers", 1, 0);
        }

        let argument = arguments[0];
        if !argument.is_array() {
            return global_this.throw_invalid_argument_type("setServers", "servers", "array");
        }

        let mut triples_iterator = argument.array_iterator(global_this)?;

        if triples_iterator.len == 0 {
            // SAFETY: FFI; channel is a live initialized ares_channel; null clears the server list.
            let r = unsafe { c_ares::ares_set_servers_ports(channel, ptr::null_mut()) };
            if r != c_ares::ARES_SUCCESS {
                let err = c_ares::Error::get(r).unwrap();
                return global_this.throw_value(global_this.create_error_instance(
                    format_args!("ares_set_servers_ports error: {}", err.label()),
                ));
            }
            return Ok(JSValue::UNDEFINED);
        }

        let mut entries: Vec<c_ares::struct_ares_addr_port_node> =
            Vec::with_capacity(triples_iterator.len as usize);

        while let Some(triple) = triples_iterator.next(global_this)? {
            if !triple.is_array() {
                return global_this.throw_invalid_argument_type("setServers", "triple", "array");
            }

            let family = triple.get_index(global_this, 0)?.coerce_to_int32(global_this)?;
            let port = triple.get_index(global_this, 2)?.coerce_to_int32(global_this)?;

            if family != 4 && family != 6 {
                return global_this.throw_invalid_arguments("Invalid address family", &[]);
            }

            let address_string = triple.get_index(global_this, 1)?.to_bun_string(global_this)?;
            let address_slice = address_string.to_owned_slice()?;

            let mut address_buffer = vec![0u8; address_slice.len() + 1];
            let _ = strings::copy(&mut address_buffer, &address_slice);
            address_buffer[address_slice.len()] = 0;

            let af: c_int = if family == 4 { libc::AF_INET } else { libc::AF_INET6 };

            let mut node = c_ares::struct_ares_addr_port_node {
                next: ptr::null_mut(),
                family: af,
                // SAFETY: all-zero is a valid `ares_addr` (POD union of in_addr/in6_addr).
                addr: unsafe { core::mem::zeroed() },
                udp_port: port,
                tcp_port: port,
            };

            // SAFETY: FFI; address_buffer is NUL-terminated above; node.addr has space for in6_addr.
            if unsafe { c_ares::ares_inet_pton(af, address_buffer.as_ptr() as *const c_char, &mut node.addr as *mut _ as *mut c_void) } != 1 {
                return jsc::Error::INVALID_IP_ADDRESS.throw(global_this, format_args!("Invalid IP address: \"{}\"", bstr::BStr::new(&address_slice)));
            }

            entries.push(node);
        }
        // Link the list AFTER the Vec is fully populated (no reallocs past this point).
        for i in 1..entries.len() {
            // PORT NOTE: reshaped for borrowck — raw ptr to avoid two &mut into entries.
            let next: *mut _ = &mut entries[i];
            entries[i - 1].next = next;
        }

        // SAFETY: FFI; channel is live; entries form a valid singly-linked list (next ptrs set above)
        // and remain alive for the duration of the call (c-ares copies them internally).
        let r = unsafe { c_ares::ares_set_servers_ports(channel, entries.as_mut_ptr()) };
        if r != c_ares::ARES_SUCCESS {
            let err = c_ares::Error::get(r).unwrap();
            return global_this.throw_value(global_this.create_error_instance(
                format_args!("ares_set_servers_ports error: {}", err.label()),
            ));
        }

        Ok(JSValue::UNDEFINED)
    }

    #[host_fn]
    pub fn set_global_servers(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::set_channel_servers(Self::get_channel_from_vm(global_this)?, global_this, callframe)
    }

    #[host_fn(method)]
    pub fn set_servers(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::set_channel_servers(this.get_channel_or_error(global_this)?, global_this, callframe)
    }

    #[host_fn]
    pub fn new_resolver(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let resolver = Resolver::init(global_this.bun_vm());

        let options = callframe.argument(0);
        if options.is_object() {
            if let Some(timeout) = options.get_truthy(global_this, "timeout")? {
                unsafe { (*resolver).options.timeout = timeout.coerce_to_int32(global_this)? };
            }
            if let Some(tries) = options.get_truthy(global_this, "tries")? {
                unsafe { (*resolver).options.tries = tries.coerce_to_int32(global_this)? };
            }
        }

        Ok(unsafe { (*resolver).to_js(global_this) })
    }

    #[host_fn(method)]
    pub fn cancel(this: &mut Self, global_this: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let channel = this.get_channel_or_error(global_this)?;
        unsafe { c_ares::ares_cancel(channel) };
        Ok(JSValue::UNDEFINED)
    }

    // Resolves the given address and port into a host name and service using the operating system's underlying getnameinfo implementation.
    // If address is not a valid IP address, a TypeError will be thrown. The port will be coerced to a number.
    // If it is not a legal port, a TypeError will be thrown.
    #[host_fn]
    pub fn global_lookup_service(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2);
        if arguments.len() < 2 {
            return global_this.throw_not_enough_arguments("lookupService", 2, arguments.len());
        }

        let addr_value = arguments.ptr[0];
        if addr_value.is_empty_or_undefined_or_null() || !addr_value.is_string() {
            return global_this.throw_invalid_argument_type("lookupService", "address", "string");
        }
        let addr_str = addr_value.to_js_string(global_this)?;
        if addr_str.length() == 0 {
            return global_this.throw_invalid_argument_type("lookupService", "address", "non-empty string");
        }
        let addr_s = addr_str.get_zig_string(global_this).slice();

        let port_value = arguments.ptr[1];
        let port: u16 = port_value.to_port_number(global_this)?;

        // SAFETY: all-zero is a valid sockaddr_storage
        let mut sa: libc::sockaddr_storage = unsafe { core::mem::zeroed() };
        if c_ares::get_sockaddr(addr_s, port, &mut sa as *mut _ as *mut libc::sockaddr) != 0 {
            return global_this.throw_invalid_argument_value("address", addr_value);
        }

        let vm = global_this.bun_vm();
        let resolver = vm.rare_data().global_dns_resolver(vm);
        let channel = resolver.get_channel_or_error(global_this)?;

        // This string will be freed in `CAresNameInfo.deinit`
        let mut cache_name = Vec::new();
        {
            use std::io::Write;
            write!(&mut cache_name, "{}|{}", bstr::BStr::new(addr_s), port).unwrap();
        }
        let cache_name: Box<[u8]> = cache_name.into_boxed_slice();

        let key = get_name_info_request::PendingCacheKey::init(&cache_name);
        let cache = resolver.get_or_put_into_resolve_pending_cache::<GetNameInfoRequest>(
            &key,
            PendingCacheField::PendingNameinfoCacheCares,
        );

        if let LookupCacheHit::Inflight(inflight) = cache {
            let info = CAresNameInfo::init(global_this, cache_name);
            unsafe { (*inflight).append(info) };
            return Ok(unsafe { (*info).promise.value() });
        }

        let request = GetNameInfoRequest::init(
            cache, Some(resolver),
            cache_name, // transfer ownership here
            global_this,
            PendingCacheField::PendingNameinfoCacheCares,
        );

        let promise = unsafe { (*(*request).tail).promise.value() };
        unsafe {
            (*channel).get_name_info(
                &mut sa as *mut _ as *mut libc::sockaddr,
                request,
                GetNameInfoRequest::on_cares_complete,
            );
        }

        resolver.request_sent(global_this.bun_vm());
        Ok(promise)
    }

    #[host_fn]
    pub fn get_runtime_default_result_order_option(
        global_this: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        global_this.bun_vm().dns_result_order.to_js(global_this)
    }
}

// ───────── JS host-fn FFI exports (Zig: comptime { @export(...) }) ─────────
// The #[host_fn] attribute emits the JSC-ABI shim; here we export them by name.
bun_jsc::export_host_fn!(Resolver::global_resolve, "Bun__DNS__resolve");
bun_jsc::export_host_fn!(Resolver::global_lookup, "Bun__DNS__lookup");
bun_jsc::export_host_fn!(Resolver::global_resolve_txt, "Bun__DNS__resolveTxt");
bun_jsc::export_host_fn!(Resolver::global_resolve_soa, "Bun__DNS__resolveSoa");
bun_jsc::export_host_fn!(Resolver::global_resolve_mx, "Bun__DNS__resolveMx");
bun_jsc::export_host_fn!(Resolver::global_resolve_naptr, "Bun__DNS__resolveNaptr");
bun_jsc::export_host_fn!(Resolver::global_resolve_srv, "Bun__DNS__resolveSrv");
bun_jsc::export_host_fn!(Resolver::global_resolve_caa, "Bun__DNS__resolveCaa");
bun_jsc::export_host_fn!(Resolver::global_resolve_ns, "Bun__DNS__resolveNs");
bun_jsc::export_host_fn!(Resolver::global_resolve_ptr, "Bun__DNS__resolvePtr");
bun_jsc::export_host_fn!(Resolver::global_resolve_cname, "Bun__DNS__resolveCname");
bun_jsc::export_host_fn!(Resolver::global_resolve_any, "Bun__DNS__resolveAny");
bun_jsc::export_host_fn!(Resolver::get_global_servers, "Bun__DNS__getServers");
bun_jsc::export_host_fn!(Resolver::set_global_servers, "Bun__DNS__setServers");
bun_jsc::export_host_fn!(Resolver::global_reverse, "Bun__DNS__reverse");
bun_jsc::export_host_fn!(Resolver::global_lookup_service, "Bun__DNS__lookupService");
bun_jsc::export_host_fn!(internal::prefetch_from_js, "Bun__DNS__prefetch");
bun_jsc::export_host_fn!(internal::get_dns_cache_stats, "Bun__DNS__getCacheStats");

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/dns_jsc/dns.zig (3649 lines)
//   confidence: low
//   todos:      32
//   notes:      Heavy comptime-type/@field reflection (per-record caches, getKey, getOrPutIntoResolvePendingCache) modeled via CAresRecordType trait + PendingCacheField enum with unimplemented!() stubs; Resolver refcount now IntrusiveRc (Arc removed); lookup deinit split into Drop+destroy(*mut Self) — callers still &mut self, reshape in Phase B; RequestKey split into borrowed + RequestKeyOwned; RequestResult thinned to NonNull for FFI layout — owning Box<[ResultEntry]> must move onto Request; ~100 unsafe blocks still need // SAFETY: annotation (cited hot paths done).
// ──────────────────────────────────────────────────────────────────────────
