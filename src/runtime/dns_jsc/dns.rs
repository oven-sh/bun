//! DNS resolver — JSC bindings.
//! Port of `src/runtime/dns_jsc/dns.zig`.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::mem::{MaybeUninit, offset_of};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use bun_collections::{ArrayHashMap, HiveArray};
use bun_core::{self as bun, Global, Output, env_var, feature_flag, fmt as bun_fmt, mach_port};
use bun_core::{ZStr, ZigString, strings};
use bun_dns::{
    self, Backend as GetAddrInfoBackend, GetAddrInfo, GetAddrInfoResult,
    Options as GetAddrInfoOptions, ResultAny as GetAddrInfoResultAny,
    ResultList as GetAddrInfoResultList,
};
use bun_io::{self as Async, FilePoll, KeepAlive};
use bun_jsc::event_loop::EventLoop;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, JsCell, JsResult,
    SystemError, host_fn,
};
use bun_paths::{MAX_PATH_BYTES, PathBuffer};
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self as sys};
use bun_threading::{ThreadPool, thread_pool};
use bun_uws::{self as uws, ConnectingSocket, Loop};
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
pub mod netc {
    pub use bun_dns::AI_ADDRCONFIG;
    pub use libc::{
        AF_INET, AF_INET6, AF_UNSPEC, EAI_NONAME, SOCK_STREAM, addrinfo, sockaddr, sockaddr_in,
        sockaddr_in6, sockaddr_storage,
    };
}
#[cfg(windows)]
pub mod netc {
    /// `AI_ADDRCONFIG` (`ws2def.h`). Only consulted when
    /// `BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG` is set; default hints on Windows
    /// leave `ai_flags = 0` (matches dns.zig — `addrconfig = is_posix`).
    pub use bun_dns::AI_ADDRCONFIG;
    pub use bun_libuv_sys::{addrinfo, sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};
    pub use bun_sys::windows::ws2_32::{AF_INET, AF_INET6, AF_UNSPEC, SOCK_STREAM};
    use core::ffi::c_int;
    /// `WSAHOST_NOT_FOUND` — value `getaddrinfo` returns on Windows for
    /// EAI_NONAME (Zig: `std.os.windows.ws2_32.EAI_NONAME`).
    pub const EAI_NONAME: c_int = 11001;
}
type SockaddrStorage = netc::sockaddr_storage;
type AddrInfo = netc::addrinfo;
type Sockaddr = netc::sockaddr;

/// Helper: fetch the per-VM global DNS resolver (port of
/// `RareData::globalDNSResolver`). The slot itself lives in `bun_jsc::RareData`
/// as a type-erased `Option<NonNull<c_void>>` to break the
/// `bun_jsc → bun_runtime` dependency cycle; this function owns the lazy init
/// and the cast back to `*mut GlobalData`.
///
/// R-2: returns `&Resolver` (shared). All Resolver mutation routes through
/// `Cell` / `JsCell` fields, so a shared borrow is sufficient and avoids the
/// `noalias` hazard when c-ares callbacks re-enter on the same global resolver.
#[inline]
pub(crate) fn global_resolver(global_this: &JSGlobalObject) -> &Resolver {
    let vm = global_this.bun_vm();
    // PORT NOTE: reshaped for borrowck — `GlobalData::init` needs
    // `&VirtualMachine` while `rare_data()` needs `&mut VirtualMachine`. Read
    // the slot, drop the borrow, init if empty, then re-acquire the slot to
    // store. The two `as_mut()` borrows are sequenced (no overlap).
    let existing = *vm.as_mut().rare_data().global_dns_data_slot();
    let data: *mut GlobalData = match existing {
        Some(nn) => nn.as_ptr().cast::<GlobalData>(),
        None => {
            let gd_nn = bun_core::heap::into_raw_nn(GlobalData::init(vm));
            let gd = gd_nn.as_ptr();
            *vm.as_mut().rare_data().global_dns_data_slot() = Some(gd_nn.cast::<c_void>());
            // SAFETY: `gd` points to a live, freshly-allocated GlobalData.
            unsafe { (*gd).resolver.ref_() }; // live forever
            gd
        }
    };
    // SAFETY: `data` is the heap allocation owned by the RareData slot; it
    // outlives every caller (freed only at VM teardown).
    unsafe { &(*data).resolver }
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
pub(crate) fn js_event_loop_ctx() -> Async::EventLoopCtx {
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

pub type GetAddrInfoAsyncCallback = unsafe extern "C" fn(i32, *mut AddrInfo, *mut c_void);

const IANA_DNS_PORT: i32 = 53;

// ──────────────────────────────────────────────────────────────────────────
// LibInfo (macOS libinfo async getaddrinfo)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
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
        hints: *const AddrInfo,
        callback: GetAddrInfoAsyncCallback,
        context: *mut c_void,
    ) -> i32;
    pub type GetaddrinfoAsyncHandleReply = unsafe extern "C" fn(*mut mach_port) -> i32;
    pub type GetaddrinfoAsyncCancel = unsafe extern "C" fn(*mut mach_port);

    // PORTING.md §Global mutable state: lazy dlopen, JS-thread-only.
    // null = "tried and failed / not yet loaded"; LOADED disambiguates.
    static HANDLE: core::sync::atomic::AtomicPtr<c_void> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());
    static LOADED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

    pub fn get_handle() -> Option<*mut c_void> {
        use core::sync::atomic::Ordering::Relaxed;
        if LOADED.load(Relaxed) {
            let h = HANDLE.load(Relaxed);
            return if h.is_null() { None } else { Some(h) };
        }
        LOADED.store(true, Relaxed);
        let handle = sys::dlopen(
            bun_core::zstr!("libinfo.dylib"),
            sys::RTLD::LAZY | sys::RTLD::LOCAL,
        );
        if handle.is_none() {
            Output::debug("libinfo.dylib not found");
        }
        HANDLE.store(handle.unwrap_or(core::ptr::null_mut()), Relaxed);
        handle
    }

    pub fn getaddrinfo_async_start() -> Option<GetaddrinfoAsyncStart> {
        bun_core::Environment::only_mac();
        sys::dlsym_with_handle!(
            GetaddrinfoAsyncStart,
            "getaddrinfo_async_start",
            get_handle()
        )
    }

    pub fn getaddrinfo_async_handle_reply() -> Option<GetaddrinfoAsyncHandleReply> {
        bun_core::Environment::only_mac();
        sys::dlsym_with_handle!(
            GetaddrinfoAsyncHandleReply,
            "getaddrinfo_async_handle_reply",
            get_handle()
        )
    }

    pub fn getaddrinfo_async_cancel() -> Option<GetaddrinfoAsyncCancel> {
        bun_core::Environment::only_mac();
        sys::dlsym_with_handle!(
            GetaddrinfoAsyncCancel,
            "getaddrinfo_async_cancel",
            get_handle()
        )
    }

    pub fn lookup(this: &Resolver, query: GetAddrInfo, global_this: &JSGlobalObject) -> JSValue {
        bun_core::Environment::only_mac();

        let Some(getaddrinfo_async_start_) = getaddrinfo_async_start() else {
            return lib_c::lookup(this, query, global_this);
        };

        let key = get_addr_info_request::PendingCacheKey::init(&query);
        let cache =
            this.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheNative);

        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this);
            // SAFETY: inflight points into resolver's HiveArray buffer
            unsafe { (*inflight).append(dns_lookup) };
            return unsafe { (*dns_lookup).promise.value() };
        }

        // PERF(port): was StackFallbackAllocator(1024) — profile in Phase B
        let name_z = bun::ZBox::from_bytes(query.name.as_ref());

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libinfo(
                get_addr_info_request::BackendLibInfo::default(),
            ),
            Some(this.as_ctx_ptr()),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );
        // SAFETY: request was just heap-allocated in init() and is exclusively owned here.
        let promise_value = unsafe { (*request).head.promise.value() };

        let hints = query.options.to_libc();
        // SAFETY: FFI call into libinfo; request is heap-allocated and lives until callback.
        let errno = unsafe {
            getaddrinfo_async_start_(
                &raw mut (*request).backend.as_libinfo_mut().machport,
                name_z.as_ptr().cast::<c_char>(),
                ptr::null(),
                hints
                    .as_ref()
                    .map(|h| std::ptr::from_ref(h))
                    .unwrap_or(ptr::null()),
                GetAddrInfoRequest::get_addr_info_async_callback,
                request.cast::<c_void>(),
            )
        };

        if errno != 0 {
            let err_tag: &'static str = sys::get_errno(errno).into();
            // SAFETY: request is exclusively owned (callback was never registered).
            let _ = unsafe {
                (*request).head.promise.reject_task(
                    global_this,
                    global_this.create_error_instance(format_args!(
                        "getaddrinfo_async_start error: {}",
                        err_tag
                    )),
                )
            }; // TODO: properly propagate exception upwards
            // SAFETY: request is exclusively owned; freed below via heap::take.
            unsafe {
                if (*request).cache.pending_cache() {
                    // Release the pending-cache slot. `getOrPutIntoPendingCache` already
                    // set the `used` bit, so failing to unset it here permanently orphans
                    // the slot and leaves `buffer[pos].lookup` pointing at the request we
                    // are about to free (UAF on the next `.inflight` hit).
                    // `PendingCacheKey` is POD (`u64`/`u16`/`*mut`), so `put_raw`
                    // (no `T::drop`) is the right release; the previous
                    // `MaybeUninit::uninit().assume_init()` write was UB regardless of
                    // POD-ness.
                    let pos = (*request).cache.pos_in_pending();
                    this.pending_host_cache_native.with_mut(|c| {
                        let slot = c.buffer[pos as usize].as_mut_ptr();
                        c.put_raw(slot);
                    });
                }
                // Drop the KeepAlive + resolver ref that `GetAddrInfoRequest.init` took.
                DNSLookup::destroy(&raw mut (*request).head);
                drop(bun_core::heap::take(request));
            }
            return promise_value;
        }

        // SAFETY: request is live until the FilePoll callback fires.
        debug_assert!(unsafe { (*request).backend.as_libinfo().machport } != 0);
        let ctx = js_event_loop_ctx();
        let poll_ptr = FilePoll::init(
            ctx,
            // TODO: WHAT?????????
            sys::Fd::from_native(i32::MAX - 1),
            Default::default(),
            // TODO(port): FilePoll generic owner type GetAddrInfoRequest
            Async::Owner::new(
                Async::posix_event_loop::poll_tag::GET_ADDR_INFO_REQUEST,
                request.cast(),
            ),
        );
        // SAFETY: FilePoll::init returns a live pool slot; exclusive on this thread.
        let poll = unsafe { &mut *poll_ptr };
        // SAFETY: see above.
        let machport = unsafe { (*request).backend.as_libinfo().machport };
        let rc = poll.register_with_fd(
            // SAFETY: JS event loop is live for the resolver's lifetime.
            unsafe { ctx.platform_event_loop() },
            Async::PollKind::Machport,
            Async::posix_event_loop::OneShotFlag::OneShot,
            // bitcast u32 mach_port → i32 fd, matches Zig @bitCast
            sys::Fd::from_native(machport as i32),
        );
        debug_assert!(matches!(rc, sys::Result::Ok(_)));

        poll.enable_keeping_process_alive(ctx);
        // SAFETY: request is live (heap-allocated) and exclusively accessed on this thread.
        // The slot is hive-allocated by `FilePoll::init` and returned via
        // `FilePoll::deinit` in `get_addr_info_async_callback`.
        unsafe { (*request).backend.as_libinfo_mut().file_poll = NonNull::new(poll_ptr) };
        this.request_sent(this.vm());

        promise_value
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LibC (blocking getaddrinfo on a worker thread; non-Windows)
// ──────────────────────────────────────────────────────────────────────────

pub mod lib_c {
    use super::*;

    #[cfg(not(windows))]
    pub fn lookup(
        this: &Resolver,
        query_init: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JSValue {
        let key = get_addr_info_request::PendingCacheKey::init(&query_init);

        let cache =
            this.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheNative);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this);
            // SAFETY: inflight points into resolver's pending-cache HiveArray slot.
            unsafe { (*inflight).append(dns_lookup) };
            // SAFETY: dns_lookup just heap-allocated; owned by the inflight list.
            return unsafe { (*dns_lookup).promise.value() };
        }

        let query = query_init.clone();

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::Query(
                query.clone(),
            )),
            Some(this.as_ctx_ptr()),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheNative,
        );
        // SAFETY: request was just heap-allocated in init() and is exclusively owned here.
        let promise_value = unsafe { (*request).head.promise.value() };

        let io = get_addr_info_request::Task::create_on_js_thread(global_this, request);
        get_addr_info_request::Task::schedule(io);
        this.request_sent(this.vm());

        promise_value
    }

    #[cfg(windows)]
    pub fn lookup(
        _this: &Resolver,
        _query_init: GetAddrInfo,
        _global_this: &JSGlobalObject,
    ) -> JSValue {
        unreachable!("Do not use this path on Windows");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LibUVBackend (Windows uv_getaddrinfo)
// ──────────────────────────────────────────────────────────────────────────

/// The windows implementation borrows the struct used for libc getaddrinfo
#[cfg(windows)]
pub mod lib_uv_backend {
    use super::*;

    struct Holder {
        uv_info: *mut libuv::uv_getaddrinfo_t,
        task: jsc::AnyTask::AnyTask,
    }

    impl Holder {
        fn run(held: *mut c_void) -> jsc::AnyTask::JsResult<()> {
            // SAFETY: held was heap-allocated in on_raw_libuv_complete
            let held = unsafe { bun_core::heap::take(held.cast::<Self>()) };
            GetAddrInfoRequest::on_libuv_complete(held.uv_info);
            Ok(())
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

        let holder = bun_core::heap::into_raw(Box::new(Holder {
            uv_info,
            // Zig: `.task = undefined`. `AnyTask.callback` is a non-nullable
            // `fn` pointer, so `MaybeUninit::zeroed().assume_init()` would be
            // instant UB regardless of the overwrite below; use the trapping
            // Default and overwrite in place.
            task: jsc::AnyTask::AnyTask::default(),
        }));
        // SAFETY: holder is a valid heap allocation
        unsafe {
            (*holder).task = jsc::AnyTask::AnyTask {
                ctx: NonNull::new(holder.cast()),
                callback: Holder::run,
            };
            (*this)
                .head
                .global_this()
                .bun_vm()
                .as_mut()
                .enqueue_task(jsc::Task::init(&mut (*holder).task));
        }
    }

    pub fn lookup(
        this: &Resolver,
        query: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // TODO(port): narrow error set
        let key = get_addr_info_request::PendingCacheKey::init(&query);

        let cache =
            this.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheNative);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this);
            unsafe { (*inflight).append(dns_lookup) };
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::uv_uninit()),
            Some(this.as_ctx_ptr()),
            &query,
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
                    if (*request).cache.pending_cache() {
                        (*resolver).drain_pending_host_native(
                            (*request).cache.pos_in_pending(),
                            (*request).head.global_this(),
                            rc.int(),
                            GetAddrInfoResultAny::Addrinfo(ptr::null_mut()),
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

pub fn normalize_dns_name<'a>(name: &'a [u8], backend: &mut GetAddrInfoBackend) -> &'a [u8] {
    if *backend == GetAddrInfoBackend::CAres {
        // https://github.com/c-ares/c-ares/issues/477
        if name.ends_with(b".localhost") {
            *backend = GetAddrInfoBackend::System;
            return b"localhost";
        } else if name.ends_with(b".local") {
            *backend = GetAddrInfoBackend::System;
            // https://github.com/c-ares/c-ares/pull/463
        } else if strings::is_ipv6_address(name) {
            *backend = GetAddrInfoBackend::System;
        }
        // getaddrinfo() is inconsistent with ares_getaddrinfo() when using localhost
        else if name == b"localhost" {
            *backend = GetAddrInfoBackend::System;
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
    #[inline]
    pub const fn pending_cache(self) -> bool {
        self.0 & 0x0001 != 0
    }
    #[inline]
    pub const fn entry_cache(self) -> bool {
        self.0 & 0x0002 != 0
    }
    #[inline]
    pub const fn pos_in_pending(self) -> u8 {
        ((self.0 >> 2) & 0x1F) as u8
    }
    #[inline]
    pub const fn name_len(self) -> u16 {
        (self.0 >> 7) & 0x1FF
    }
    #[inline]
    pub const fn new(
        pending_cache: bool,
        entry_cache: bool,
        pos_in_pending: u8,
        name_len: u16,
    ) -> Self {
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
    /// `"query" ++ ucfirst(TYPE_NAME)` — Zig built this at comptime; each impl
    /// carries the precomputed literal so error paths report the right syscall.
    const SYSCALL: &'static str;
    /// `"pending_{TYPE_NAME}_cache_cares"` — used to reach the matching HiveArray on `Resolver`.
    const CACHE_FIELD: PendingCacheField;
    /// `@field(NSType, "ns_t_" ++ TYPE_NAME)` — the DNS RR type passed to `ares_query`.
    const NS_TYPE: c_ares::NSType;
    /// `cares_type.callbackWrapper(TYPE_NAME, ResolveInfoRequest(..), onCaresComplete)` —
    /// the `ares_callback` thunk that parses raw reply bytes for this record type
    /// and forwards to `ResolveInfoRequest<Self>::on_cares_complete`. Used as
    /// `ResolveHandler::raw_callback` for the generic `Channel::resolve` dispatch.
    const RAW_CALLBACK: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int);
    fn to_js_response(
        &mut self,
        global: &JSGlobalObject,
        type_name: &'static str,
    ) -> JsResult<JSValue>;
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
            Self {
                hash,
                len: name.len() as u16,
                lookup: ptr::null_mut(),
            }
        }

        /// Raw pointer to the owning request. NO `&`/`&mut` accessor is offered:
        /// `(*lookup).tail` may alias `(*lookup).head` (intrusive list), and the
        /// drain path hands `addr_of_mut!((*lookup).head)` into JS-re-entrant
        /// callbacks then `heap::take`s it — a live `&`/`&mut` across either
        /// would be UB. Callers must keep using raw derefs.
        #[inline]
        pub fn lookup_ptr(&self) -> *mut ResolveInfoRequest<T> {
            self.lookup
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
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            hash,
            cache: CacheConfig::default(),
            head: CAresLookup {
                // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::init_ref(r) }),
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
                (*request).cache = CacheConfig::new(true, false, pos as u8, name.len() as u16);
                (*new).lookup = request;
            }
        }
        request
    }

    pub fn on_cares_complete(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut T>,
    ) {
        // SAFETY: this is the heap-allocated request c-ares calls back with
        unsafe {
            if let Some(resolver) = (*this).resolver_for_caching {
                scopeguard::defer! { (*resolver).request_completed() };
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
// `on_cares_complete`. Zig: `channel.resolve(name, type_name, ResolveInfoRequest(..),
// request, cares_type, onCaresComplete)`.
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
            Self {
                hash,
                len: name.len() as u16,
                lookup: ptr::null_mut(),
            }
        }

        /// Raw pointer to the owning request. NO `&`/`&mut` accessor is offered:
        /// `(*lookup).tail` may alias `(*lookup).head` (intrusive list), and the
        /// drain path hands `addr_of_mut!((*lookup).head)` into JS-re-entrant
        /// callbacks then `heap::take`s it — a live `&`/`&mut` across either
        /// would be UB. Callers must keep using raw derefs.
        #[inline]
        pub fn lookup_ptr(&self) -> *mut GetHostByAddrInfoRequest {
            self.lookup
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
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            hash,
            cache: CacheConfig::default(),
            head: CAresReverse {
                // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::init_ref(r) }),
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

pub struct CAresNameInfo {
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
    /// in-flight DNS request (Zig spec: `*jsc.JSGlobalObject`, non-optional).
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    pub fn init(global_this: &JSGlobalObject, name: Box<[u8]>) -> *mut Self {
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
    pub unsafe fn process_resolve(
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
        let array = super::cares_jsc::nameinfo_to_js_response(&mut name_info, global_this)
            .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
        // SAFETY: see fn contract.
        unsafe { Self::on_complete(this, array) };
    }

    /// SAFETY: see `process_resolve`.
    pub unsafe fn on_complete(this: *mut Self, result: JSValue) {
        // SAFETY: see fn contract — `this` is a live node.
        let mut promise = unsafe { core::mem::take(&mut (*this).promise) };
        // SAFETY: see fn contract — `this` is a live node.
        let global_this = unsafe { (*this).global_this() };
        let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
        // SAFETY: see fn contract.
        unsafe { Self::destroy(this) };
    }

    /// Conditionally free a heap-allocated tail node. Head nodes (`allocated == false`)
    /// are inline fields of the parent `*Request` (or a stack local moved out of it) and
    /// are dropped exactly once by their owner; this is a no-op for them.
    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `init()`.
    pub unsafe fn destroy(this: *mut Self) {
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
            Self {
                hash,
                len: name.len() as u16,
                lookup: ptr::null_mut(),
            }
        }

        /// Raw pointer to the owning request. NO `&`/`&mut` accessor is offered:
        /// `(*lookup).tail` may alias `(*lookup).head` (intrusive list), and the
        /// drain path hands `addr_of_mut!((*lookup).head)` into JS-re-entrant
        /// callbacks then `heap::take`s it — a live `&`/`&mut` across either
        /// would be UB. Callers must keep using raw derefs.
        #[inline]
        pub fn lookup_ptr(&self) -> *mut GetNameInfoRequest {
            self.lookup
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
        poll_ref.ref_(js_event_loop_ctx());
        let name_len = name.len();
        let request = bun_core::heap::into_raw(Box::new(Self {
            resolver_for_caching: resolver,
            hash,
            cache: CacheConfig::default(),
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
        unsafe { (*request).tail = &raw mut (*request).head };
        if let LookupCacheHit::New(new) = cache {
            unsafe {
                (*request).resolver_for_caching = resolver;
                let pos = (*resolver.unwrap())
                    .pending_nameinfo_cache_cares
                    .get()
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
                scopeguard::defer! { (*resolver).request_completed() };
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
    pub backend: get_addr_info_request::Backend,
    // TODO(port): lifetime — TSV says BORROW_PARAM → Option<&'a Resolver>; raw ptr until Phase B
    pub resolver_for_caching: Option<*mut Resolver>,
    pub hash: u64,
    pub cache: CacheConfig,
    pub head: DNSLookup,
    pub tail: *mut DNSLookup, // INTRUSIVE
    pub task: thread_pool::Task,
}

pub mod get_addr_info_request {
    use super::*;

    /// `bun.jsc.WorkTask(GetAddrInfoRequest)` — runs blocking `getaddrinfo`
    /// on the work pool, then re-enters the JS thread via `then`.
    pub type Task = jsc::work_task::WorkTask<super::GetAddrInfoRequest>;

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

        /// Raw pointer to the owning request. NO `&`/`&mut` accessor is offered:
        /// `(*lookup).tail` may alias `(*lookup).head` (intrusive list), and the
        /// drain path hands `addr_of_mut!((*lookup).head)` into JS-re-entrant
        /// callbacks then `heap::take`s it — a live `&`/`&mut` across either
        /// would be UB. Callers must keep using raw derefs.
        #[inline]
        pub fn lookup_ptr(&self) -> *mut GetAddrInfoRequest {
            self.lookup
        }
    }

    pub struct BackendLibInfo {
        /// OWNED hive slot from `FilePoll::init` (returned via `FilePoll::deinit`,
        /// not `Box`/global-alloc — Zig: `?*bun.Async.FilePoll`).
        pub file_poll: Option<NonNull<FilePoll>>,
        pub machport: mach_port,
    }

    impl Default for BackendLibInfo {
        fn default() -> Self {
            Self {
                file_poll: None,
                machport: 0,
            }
        }
    }

    // TODO(port): move to <area>_sys
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn getaddrinfo_send_reply(
            port: mach_port,
            reply: lib_info::GetaddrinfoAsyncHandleReply,
        ) -> bool;
    }

    impl BackendLibInfo {
        pub fn on_machport_change(this: *mut GetAddrInfoRequest) {
            #[cfg(not(target_os = "macos"))]
            {
                unreachable!();
            }
            #[cfg(target_os = "macos")]
            unsafe {
                jsc::mark_binding();
                if !getaddrinfo_send_reply(
                    (*this).backend.as_libinfo().machport,
                    lib_info::getaddrinfo_async_handle_reply().unwrap(),
                ) {
                    bun_output::scoped_log!(
                        GetAddrInfoRequest,
                        "onMachportChange: getaddrinfo_send_reply failed"
                    );
                    GetAddrInfoRequest::get_addr_info_async_callback(
                        -1,
                        ptr::null_mut(),
                        this.cast::<c_void>(),
                    );
                }
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
        pub fn run(&mut self) {
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
                        .map(|h| std::ptr::from_ref(h))
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

            // do not free addrinfo when err != 0
            // https://github.com/ziglang/zig/pull/14242
            let _free = scopeguard::guard(addrinfo, |a| unsafe { bun_dns::freeaddrinfo(a) });

            // SAFETY: addrinfo is non-null (checked above); freed by `_free` guard after copy.
            *self =
                LibcBackend::Success(bun_core::handle_oom(GetAddrInfoResult::to_list(unsafe {
                    &*addrinfo
                })));
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
            Self {
                uv: bun_core::ffi::zeroed(),
            }
        }
        pub fn run(&mut self) {
            unreachable!("This path should never be reached on Windows");
        }
    }
    pub enum Backend {
        CAres,
        Libinfo(BackendLibInfo),
        Libc(LibcBackend),
    }

    impl Backend {
        pub fn as_libinfo(&self) -> &BackendLibInfo {
            match self {
                Backend::Libinfo(l) => l,
                _ => unreachable!(),
            }
        }
        pub fn as_libinfo_mut(&mut self) -> &mut BackendLibInfo {
            match self {
                Backend::Libinfo(l) => l,
                _ => unreachable!(),
            }
        }
        #[cfg(windows)]
        pub fn as_libc_uv_mut(&mut self) -> &mut libuv::uv_getaddrinfo_t {
            match self {
                Backend::Libc(l) => &mut l.uv,
                _ => unreachable!(),
            }
        }
    }
}

impl jsc::work_task::WorkTaskContext for GetAddrInfoRequest {
    const TASK_TAG: bun_event_loop::ConcurrentTask::TaskTag =
        bun_event_loop::ConcurrentTask::task_tag::GetAddrInfoRequestTask;

    #[inline]
    fn run(this: *mut Self, task: *mut get_addr_info_request::Task) {
        GetAddrInfoRequest::run(this, task);
    }
    #[inline]
    fn then(this: *mut Self, global_this: &JSGlobalObject) -> Result<(), jsc::JsTerminated> {
        GetAddrInfoRequest::then(this, global_this);
        Ok(())
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
        poll_ref.ref_(js_event_loop_ctx());
        let request = bun_core::heap::into_raw(Box::new(Self {
            backend,
            resolver_for_caching: resolver,
            hash: query.hash(),
            cache: CacheConfig::default(),
            head: DNSLookup {
                // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
                resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::init_ref(r) }),
                global_this: bun_ptr::BackRef::new(global_this),
                promise: JSPromiseStrong::init(global_this),
                poll_ref,
                allocated: false,
                next: None,
            },
            tail: ptr::null_mut(),
            // Zig: `task: bun.ThreadPool.Task = undefined`. The callback is
            // overwritten before scheduling; use a trapping stub so the
            // non-null fn-pointer invariant holds without `mem::zeroed()` UB.
            task: thread_pool::Task {
                node: Default::default(),
                callback: {
                    unsafe fn unset(_: *mut thread_pool::Task) {
                        unreachable!("GetAddrInfoRequest.task scheduled without callback");
                    }
                    unset
                },
            },
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
        addr_info: *mut AddrInfo,
        arg: *mut c_void,
    ) {
        // SAFETY: arg was a *mut GetAddrInfoRequest passed to getaddrinfo_async_start
        let this: *mut Self = arg.cast();
        bun_output::scoped_log!(
            GetAddrInfoRequest,
            "getAddrInfoAsyncCallback: status={}",
            status
        );

        // SAFETY: `this` is the heap-allocated request passed via `arg`; callback runs once.
        unsafe {
            if let get_addr_info_request::Backend::Libinfo(li) = &mut (*this).backend {
                if let Some(poll) = li.file_poll.take() {
                    // SAFETY: `poll` is the hive slot returned by `FilePoll::init`;
                    // exclusive on the JS thread. `deinit` returns it to the pool.
                    (*poll.as_ptr()).deinit();
                }
            }

            if let Some(resolver) = (*this).resolver_for_caching {
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_host_native(
                        (*this).cache.pos_in_pending(),
                        (*this).head.global_this(),
                        status,
                        GetAddrInfoResultAny::Addrinfo(addr_info),
                    );
                    return;
                }
            }

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `DNSLookup` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            DNSLookup::process_get_addr_info_native(&raw mut head, status, addr_info);
        }
    }

    pub fn run(this: *mut Self, task: *mut get_addr_info_request::Task) {
        // SAFETY: WorkTask invokes this on the threadpool with valid pointers
        unsafe {
            match &mut (*this).backend {
                get_addr_info_request::Backend::Libc(l) => l.run(),
                _ => unreachable!(),
            }
        }
        get_addr_info_request::Task::on_finish(task);
    }

    pub fn then(this: *mut Self, _global: &JSGlobalObject) {
        bun_output::scoped_log!(GetAddrInfoRequest, "then");
        #[cfg(not(windows))]
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
                    // `ResultAny` impls `Drop` (frees the list); Zig's `defer any.deinit()`
                    // is the by-value drop at the end of whichever callee receives `any`.
                    let any = GetAddrInfoResultAny::List(result);
                    if let Some(resolver) = (*this).resolver_for_caching {
                        // if (this.cache.entry_cache and result != null and result.?.node != null) {
                        //     resolver.putEntryInCache(this.hash, this.cache.name_len, result.?);
                        // }
                        if (*this).cache.pending_cache() {
                            (*resolver).drain_pending_host_native(
                                (*this).cache.pos_in_pending(),
                                (*this).head.global_this(),
                                0,
                                any,
                            );
                            return;
                        }
                    }
                    // Consume the request and move `head` out by value;
                    // `ptr::read` + `heap::take` would double-Drop `DNSLookup`.
                    let owned = *bun_core::heap::take(this);
                    let mut head = owned.head;
                    DNSLookup::on_complete_native(&raw mut head, any);
                }
                get_addr_info_request::Backend::Libc(get_addr_info_request::LibcBackend::Err(
                    err,
                )) => {
                    Self::get_addr_info_async_callback(err, ptr::null_mut(), this.cast::<c_void>());
                }
                _ => unreachable!(),
            }
        }
        #[cfg(windows)]
        {
            let _ = this;
            unreachable!()
        }
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

            // Consume the request and move `head` out by value; `ptr::read`
            // + `heap::take` would double-Drop `DNSLookup` (impls Drop).
            let owned = *bun_core::heap::take(this);
            let mut head = owned.head;
            DNSLookup::process_get_addr_info(&raw mut head, err_, timeout, result);
        }
    }

    #[cfg(windows)]
    pub fn on_libuv_complete(uv_info: *mut libuv::uv_getaddrinfo_t) {
        unsafe {
            let retcode = (*uv_info).retcode.int();
            bun_output::scoped_log!(GetAddrInfoRequest, "onLibUVComplete: status={}", retcode);
            let this: *mut Self = (*uv_info).data.cast();
            #[cfg(windows)]
            debug_assert!(uv_info == core::ptr::from_mut((*this).backend.as_libc_uv_mut()));
            if let get_addr_info_request::Backend::Libinfo(li) = &mut (*this).backend {
                if let Some(poll) = li.file_poll.take() {
                    // SAFETY: `poll` is the hive slot returned by `FilePoll::init`;
                    // exclusive on the JS thread. `deinit` returns it to the pool.
                    (*poll.as_ptr()).deinit();
                }
            }

            // On Windows, libuv's `uv_getaddrinfo` calls `GetAddrInfoW` then
            // re-packs the wide result into a single ANSI block allocated via
            // `uv__malloc`; that block must be released with `uv_freeaddrinfo`
            // (== `uv__free`). `GetAddrInfoResultAny::Addrinfo`'s `Drop` calls
            // `ws2_32!freeaddrinfo`, which is the wrong allocator here and
            // would corrupt the heap. The Zig spec never frees it on this path
            // (leak). Convert to an owned `List` immediately, free the libuv
            // buffer with the correct deallocator, and pass `List` downstream
            // so `ResultAny::Drop` never sees libuv-owned memory.
            let addrinfo = (*uv_info).addrinfo;
            let result_any = if addrinfo.is_null() {
                GetAddrInfoResultAny::Addrinfo(ptr::null_mut())
            } else {
                let list = GetAddrInfoResult::to_list(&*addrinfo).unwrap_or_default();
                libuv::uv_freeaddrinfo(addrinfo.cast());
                GetAddrInfoResultAny::List(list)
            };

            if let Some(resolver) = (*this).resolver_for_caching {
                if (*this).cache.pending_cache() {
                    (*resolver).drain_pending_host_native(
                        (*this).cache.pos_in_pending(),
                        (*this).head.global_this(),
                        retcode,
                        result_any,
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
                DNSLookup::on_complete_native(&raw mut head, result_any);
            }
        }
    }
}

// Wires `GetAddrInfoRequest` into `Channel::get_addr_info`. Zig:
// `channel.getAddrInfo(query.name, query.port, hints_buf, GetAddrInfoRequest,
// request, GetAddrInfoRequest.onCaresComplete)`.
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

pub struct CAresReverse {
    pub resolver: Option<bun_ptr::IntrusiveRc<Resolver>>, // SHARED (intrusive — Resolver embeds ref_count and crosses FFI as m_ctx)
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
    /// global outlives every DNS request hung off of it (Zig spec:
    /// `*jsc.JSGlobalObject`, non-optional), so the pointer is always non-null
    /// and valid for the lifetime of `self`.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    pub fn init(
        resolver: Option<*mut Resolver>,
        global_this: &JSGlobalObject,
        name: &[u8],
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
            resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::init_ref(r) }),
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
    pub unsafe fn process_resolve(
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
            let array = super::cares_jsc::hostent_to_js_response(&mut *node, global_this, b"")
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            Self::on_complete(this, array);
        }
    }

    /// SAFETY: see `process_resolve`.
    pub unsafe fn on_complete(this: *mut Self, result: JSValue) {
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
            if let Some(resolver) = (*this).resolver.as_ref() {
                // IntrusiveRc holds a live ref; request_completed mutates pending_requests counter only.
                (*resolver.as_ptr()).request_completed();
            }
            Self::destroy(this);
        }
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `init()`. Head nodes (`!allocated`)
    /// are dropped by their owner; this is a no-op for them.
    pub unsafe fn destroy(this: *mut Self) {
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
        // self.name / self.resolver freed by field Drop (Box / IntrusiveRc deref)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CAresLookup<T>
// ──────────────────────────────────────────────────────────────────────────

pub struct CAresLookup<T: CAresRecordType> {
    pub resolver: Option<bun_ptr::IntrusiveRc<Resolver>>, // SHARED (intrusive — Resolver embeds ref_count and crosses FFI as m_ctx)
    pub global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    pub promise: JSPromiseStrong,
    pub poll_ref: KeepAlive,
    pub allocated: bool,
    pub next: Option<NonNull<CAresLookup<T>>>, // INTRUSIVE
    pub name: Box<[u8]>,
    _marker: core::marker::PhantomData<T>,
}

impl<T: CAresRecordType> CAresLookup<T> {
    pub fn new(data: Self) -> *mut Self {
        debug_assert!(data.allocated); // deinit will not free this otherwise
        bun_core::heap::into_raw(Box::new(data))
    }

    pub fn init(
        resolver: Option<*mut Resolver>,
        global_this: &JSGlobalObject,
        name: &[u8],
    ) -> *mut Self {
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());
        Self::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
            resolver: resolver.map(|r| unsafe { bun_ptr::IntrusiveRc::init_ref(r) }),
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
    /// in-flight DNS request (Zig spec: `*jsc.JSGlobalObject`, non-optional).
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    /// SAFETY: `this` must be a live node — either the inline head of a `*Request`
    /// (allocated == false; owner drops it) or a Boxed tail node (allocated == true;
    /// freed via `Self::destroy`). No `&mut` may alias `*this` across this call.
    pub unsafe fn process_resolve(
        this: *mut Self,
        err_: Option<c_ares::Error>,
        _timeout: i32,
        result: Option<*mut T>,
    ) {
        // syscall = "query" + ucfirst(TYPE_NAME) — Zig built this at comptime;
        // each `CAresRecordType` impl carries the precomputed literal.
        let syscall = T::SYSCALL; // e.g. "querySrv"
        // This path is reached when the pending cache is full (`.disabled`),
        // so we own the c-ares result here. The cached path frees it in
        // `drainPendingCares`; callers from there always pass `null`.
        let _free = scopeguard::guard(result, |r| {
            if let Some(r) = r {
                // SAFETY: r is the c-ares-allocated reply; we own it on this path.
                unsafe { T::destroy(r) };
            }
        });

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
            let Some(node) = result else {
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

            // node is a valid c-ares reply for the callback's duration; freed by `_free` guard.
            let array = (*node)
                .to_js_response(global_this, T::TYPE_NAME)
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            Self::on_complete(this, array);
        }
    }

    /// SAFETY: see `process_resolve`.
    pub unsafe fn on_complete(this: *mut Self, result: JSValue) {
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
            if let Some(resolver) = (*this).resolver.as_ref() {
                // IntrusiveRc holds a live ref; request_completed mutates pending_requests counter only.
                (*resolver.as_ptr()).request_completed();
            }
            Self::destroy(this);
        }
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `new()`. Head nodes (`!allocated`)
    /// are dropped by their owner; this is a no-op for them.
    pub unsafe fn destroy(this: *mut Self) {
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
        // self.name / self.resolver freed by field Drop (Box / IntrusiveRc deref)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DNSLookup
// ──────────────────────────────────────────────────────────────────────────

pub struct DNSLookup {
    pub resolver: Option<bun_ptr::IntrusiveRc<Resolver>>, // SHARED (intrusive — Resolver embeds ref_count and crosses FFI as m_ctx)
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
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    pub fn init(resolver: *mut Resolver, global_this: &JSGlobalObject) -> *mut Self {
        bun_output::scoped_log!(DNSLookup, "init");

        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(js_event_loop_ctx());

        bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: resolver is a live intrusive-RC m_ctx; init_ref bumps the embedded ref_count.
            resolver: Some(unsafe { bun_ptr::IntrusiveRc::init_ref(resolver) }),
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
    pub unsafe fn on_complete_native(this: *mut Self, result: GetAddrInfoResultAny) {
        bun_output::scoped_log!(DNSLookup, "onCompleteNative");
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let array = super::options_jsc::result_any_to_js(&result, (*this).global_this())
                .ok()
                .flatten()
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            Self::on_complete_with_array(this, array);
        }
    }

    /// SAFETY: see `on_complete_native`.
    pub unsafe fn process_get_addr_info_native(
        this: *mut Self,
        status: i32,
        result: *mut AddrInfo,
    ) {
        bun_output::scoped_log!(DNSLookup, "processGetAddrInfoNative: status={}", status);
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            if let Some(err) = c_ares::Error::init_eai(status) {
                error_to_deferred(err, b"getaddrinfo", None, &mut (*this).promise)
                    .reject_later((*this).global_this());
                Self::destroy(this);
                return;
            }
            Self::on_complete_native(this, GetAddrInfoResultAny::Addrinfo(result));
        }
    }

    /// SAFETY: see `on_complete_native`.
    pub unsafe fn process_get_addr_info(
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
    pub unsafe fn on_complete(this: *mut Self, result: *mut c_ares::AddrInfo) {
        bun_output::scoped_log!(DNSLookup, "onComplete");
        // SAFETY: caller contract — `this` is live; result is a live c-ares AddrInfo
        // owned by the caller's scopeguard; JSGlobalObject outlives the request.
        unsafe {
            let array =
                super::cares_jsc::addr_info_to_js_array(&mut *result, (*this).global_this())
                    .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            Self::on_complete_with_array(this, array);
        }
    }

    /// SAFETY: see `on_complete_native`.
    pub unsafe fn on_complete_with_array(this: *mut Self, result: JSValue) {
        bun_output::scoped_log!(DNSLookup, "onCompleteWithArray");
        // SAFETY: caller contract — `this` is live; JSGlobalObject outlives the request.
        unsafe {
            let mut promise = core::mem::take(&mut (*this).promise);
            let global_this = (*this).global_this();
            let _ = promise.resolve_task(global_this, result); // TODO: properly propagate exception upwards
            if let Some(resolver) = (*this).resolver.as_ref() {
                // IntrusiveRc holds a live ref; request_completed mutates pending_requests counter only.
                (*resolver.as_ptr()).request_completed();
            }
            Self::destroy(this);
        }
    }

    /// SAFETY: `this` must point at a live node; if `(*this).allocated`, it must be the
    /// exact pointer returned by `heap::alloc` in `init()`. Head nodes (`!allocated`)
    /// are dropped by their owner; this is a no-op for them.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; if `allocated`, it is the exact
        // pointer from `heap::alloc` in `init()`.
        unsafe {
            if (*this).allocated {
                drop(bun_core::heap::take(this));
            }
        }
    }
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
        Box::new(Self {
            resolver: Resolver::setup(vm),
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// internal — process-wide DNS cache used by usockets connect path
// ──────────────────────────────────────────────────────────────────────────

pub mod internal {
    use super::*;

    // PORTING.md §Global mutable state: lazy env-var memo. Zig comments it as
    // "racy, but it's okay because the number won't be invalid, just stale" —
    // that's exactly an `OnceLock<u32>` (idempotent init, safe concurrent read).
    static MAX_DNS_TIME_TO_LIVE_SECONDS: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

    pub fn get_max_dns_time_to_live_seconds() -> u32 {
        *MAX_DNS_TIME_TO_LIVE_SECONDS.get_or_init(|| {
            let value = env_var::BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS.get();
            // Zig default for BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS is 30.
            value.unwrap_or(30) as u32
        })
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
        pub host: Option<bun::ZBox>,
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
                host: name.map(|n| std::ptr::from_ref::<ZStr>(n)),
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
                let host_copy = bun::ZBox::from_bytes(bytes);
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

    // Crosses FFI to usockets via `Bun__addrinfo_getRequestResult` — layout MUST match
    // Zig's `extern struct { info: ?[*]ResultEntry, err: c_int }` (8-byte thin ptr).
    #[repr(C)]
    pub struct RequestResult {
        pub info: Option<NonNull<ResultEntry>>, // thin ptr; head of intrusive `ai_next` chain
        pub err: c_int,
    }
    // Ownership of the ResultEntry buffer is `Request.result_buf` — this struct is
    // a borrowed C-ABI view (`info` points at `result_buf[0]`). Do NOT free via
    // this field.

    pub struct MacAsyncDNS {
        pub file_poll: Option<NonNull<FilePoll>>, // OWNED hive slot (FilePoll::init)
        pub machport: mach_port,
    }

    impl Default for MacAsyncDNS {
        fn default() -> Self {
            Self {
                file_poll: None,
                machport: 0,
            }
        }
    }

    // TODO(port): move to <area>_sys
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn getaddrinfo_send_reply(
            port: mach_port,
            reply: lib_info::GetaddrinfoAsyncHandleReply,
        ) -> bool;
    }

    impl MacAsyncDNS {
        #[cfg(target_os = "macos")]
        pub fn on_machport_change(this: *mut Request) {
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
        #[cfg(not(target_os = "macos"))]
        pub fn on_machport_change(_this: *mut Request) {
            // libinfo machport DNS is macOS-only.
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

    /// The cache data guarded by `GLOBAL_CACHE`. The Zig code stored a `bun.Mutex`
    /// adjacent to `cache`/`len`; in Rust the lock owns the data (PORTING.md §Concurrency).
    pub struct GlobalCache {
        pub cache: [*mut Request; MAX_ENTRIES],
        pub len: usize,
    }

    // SAFETY: every `*mut Request` stored here is a heap allocation transferred between
    // threads only while `GLOBAL_CACHE` is locked; no thread-affine data hangs off it.
    unsafe impl Send for GlobalCache {}

    pub enum CacheResult<'a> {
        Inflight(&'a mut Request),
        Resolved(&'a mut Request),
        None,
    }

    impl GlobalCache {
        pub const fn new() -> Self {
            Self {
                cache: [ptr::null_mut(); MAX_ENTRIES],
                len: 0,
            }
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
            (bun::Timespec::now(bun::TimespecMockMode::AllowMockedTime).ms_unsigned() / 1000) as u32
        }

        fn is_nearly_full(&self) -> bool {
            // 80% full (value is kind of arbitrary)
            // Caller already holds GLOBAL_CACHE; the Zig @atomicLoad was redundant.
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

    pub fn get_hints() -> AddrInfo {
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

    // TODO(port): move to <area>_sys
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
        pub fn notify_threadsafe(&self, req: *mut Request) {
            match self {
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback_threadsafe(*socket, req)
                },
                DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
                DNSRequestOwner::Quic(pc) => unsafe {
                    bun_http::H3::PendingConnect::on_dns_resolved_threadsafe(*pc)
                },
            }
        }

        pub fn notify(&self, req: *mut Request) {
            match self {
                DNSRequestOwner::Prefetch(_) => freeaddrinfo(req, 0),
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback(*socket, req)
                },
                DNSRequestOwner::Quic(pc) => unsafe {
                    bun_http::H3::PendingConnect::on_dns_resolved(*pc)
                },
            }
        }

        pub fn loop_(&self) -> *mut Loop {
            match self {
                DNSRequestOwner::Prefetch(l) => *l,
                DNSRequestOwner::Socket(s) => unsafe { (**s).r#loop() },
                DNSRequestOwner::Quic(pc) => unsafe { (**pc).r#loop() },
            }
        }
    }

    /// Register `pc` to be notified when `request` resolves. Mirrors
    /// us_getaddrinfo_set but for the QUIC client's connect path, which has
    /// no us_connecting_socket_t to hang the callback on. The .quic notify
    /// path frees the addrinfo request inline (via Bun__addrinfo_freeRequest),
    /// which re-acquires global_cache.lock — so drop it before notifying.
    pub fn register_quic(request: *mut Request, pc: *mut bun_http::H3::PendingConnect) {
        let guard = global_cache().lock();
        let owner = DNSRequestOwner::Quic(pc);
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
            unsafe { bun_dns::freeaddrinfo(info.cast()) };
            Some(res)
        } else {
            None
        };

        let guard = global_cache().lock();

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
    pub fn lookup_libinfo(req: *mut Request, loop_: jsc::EventLoopHandle) -> bool {
        let Some(getaddrinfo_async_start_) = lib_info::getaddrinfo_async_start() else {
            return false;
        };

        let mut machport: mach_port = 0;
        let mut service_buf = [0u8; 21];
        let port = unsafe { (*req).key.port };
        let service: *const c_char = if port > 0 {
            bun_fmt::itoa_z(&mut service_buf, port as u64).as_ptr()
        } else {
            ptr::null()
        };

        let mut hints = get_hints();

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
            crate::api::bun::process::event_loop_handle_to_ctx(loop_),
            // bitcast u32 mach_port → i32 fd, matches Zig @bitCast
            sys::Fd::from_native(machport as i32),
            Default::default(),
            // TODO(port): FilePoll generic owner type InternalDNSRequest
            Async::Owner::new(Async::posix_event_loop::poll_tag::REQUEST, req.cast::<()>()),
        );
        // SAFETY: `poll` is a freshly-allocated hive slot; `loop_.r#loop()` is the live uws loop.
        let rc = unsafe { (*poll).register(&mut *loop_.r#loop(), Async::PollKind::Machport, true) };

        if rc.is_err() {
            // SAFETY: `poll` is the freshly-allocated hive slot returned by
            // `FilePoll::init` above; nothing else aliases it. Registration
            // failed, so it was never armed — release the slot back to the hive.
            unsafe { (*poll).deinit() };
            return false;
        }

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
                        bun_output::scoped_log!(
                            dns,
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
                        // Zig: `@bitCast(machport)` — `as i32` is the same-width bitcast.
                        poll.fd = sys::Fd::from_native(machport as i32);
                        match poll.register(&mut *Loop::get(), Async::PollKind::Machport, true) {
                            sys::Result::Err(_) => {
                                bun_output::scoped_log!(
                                    dns,
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

    #[host_fn]
    pub fn get_dns_cache_stats(
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

                unsafe { (*entry).refcount += 1 };

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
                let res = lookup_libinfo(req, handle);
                bun_output::scoped_log!(
                    dns,
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

        bun_output::scoped_log!(
            dns,
            "getaddrinfo({}) = cache miss (libc)",
            bstr::BStr::new(host.map(|h| h.as_bytes()).unwrap_or(b""))
        );
        // schedule the request to be executed on the work pool
        let _ = bun_threading::work_pool::WorkPool::go(SendPtr(req), |r: SendPtr<Request>| {
            work_pool_callback(r.0)
        });
        Some(req)
    }

    #[host_fn]
    pub fn prefetch_from_js(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();

        if arguments.len() < 1 {
            return Err(global_this.throw_not_enough_arguments("prefetch", 1, arguments.len()));
        }

        let hostname_or_url = arguments[0];

        let hostname_slice;
        if hostname_or_url.is_string() {
            hostname_slice = hostname_or_url.to_slice(global_this)?;
        } else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("hostname must be a string"))
            );
        }

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

    pub fn prefetch(loop_: *mut Loop, hostname: Option<&ZStr>, port: u16) {
        let _ = getaddrinfo(loop_, hostname, port, None);
    }

    /// `bun_dns::__bun_dns_prefetch` body — declared `extern "Rust"` in the
    /// lower-tier `bun_dns` crate so `bun_install` can prefetch registry
    /// hostnames without a crate cycle. Link-time resolved.
    #[unsafe(no_mangle)]
    pub fn __bun_dns_prefetch(loop_: *mut c_void, hostname: *const u8, len: usize, port: u16) {
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
        unsafe { *socket = req.cast::<c_void>() };
        if is_cache_hit { 0 } else { 1 }
    }

    extern "C" fn us_getaddrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
        let _guard = global_cache().lock();
        let query = DNSRequestOwner::Socket(socket);
        unsafe {
            if (*request).result.is_some() {
                query.notify(request);
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

    pub(super) extern "C" fn freeaddrinfo(req: *mut Request, err: c_int) {
        let mut guard = global_cache().lock();

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

    // FFI exports — Zig used `@export` in a `comptime { }` block.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_set(request: *mut Request, socket: *mut ConnectingSocket) {
        us_getaddrinfo_set(request, socket)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_cancel(
        request: *mut Request,
        socket: *mut ConnectingSocket,
    ) -> c_int {
        us_getaddrinfo_cancel(request, socket)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_get(
        loop_: *mut Loop,
        host: *const c_char,
        port: u16,
        socket: *mut *mut c_void,
    ) -> c_int {
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
    /// QUIC analogue of `Bun__addrinfo_set` — link-time export so `bun_http`
    /// (lower-tier crate) can register without a `bun_runtime` dep cycle.
    /// Called via `bun_dns::internal::register_quic`.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__addrinfo_registerQuic(
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

// ──────────────────────────────────────────────────────────────────────────
// CAresRecordType impls — Zig instantiated `ResolveInfoRequest(cares_type, type_name)`
// per (struct, "tag") pair via comptime; Rust models the (struct, tag) tuple as a
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
        // Generic reply handler — forwards to `on_cares_complete`. Zig
        // monomorphized this via `cares_type.Callback(ResolveInfoRequest(..))`.
        impl c_ares::ReplyHandler<$ty> for ResolveInfoRequest<$ty> {
            fn on_reply(
                &mut self,
                status: Option<c_ares::Error>,
                timeouts: i32,
                results: *mut $ty,
            ) {
                let result = if results.is_null() {
                    None
                } else {
                    Some(results)
                };
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
// aggregate); convert via `heap::alloc` so the rest of the pipeline sees a
// uniform `*mut T` and `CAresRecordType::destroy` reclaims it with `heap::take`.
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
        // SAFETY: `this` was `heap::alloc`'d in `on_any` below; Drop frees inner replies.
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
        Self::on_cares_complete(
            std::ptr::from_mut::<Self>(self),
            status,
            timeouts,
            results.map(bun_core::heap::into_raw),
        );
    }
}

/// Transparent newtype over `struct_hostent` carrying the comptime `type_name` tag.
macro_rules! hostent_newtype {
    ($name:ident, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident, $wrapper:ident) => {
        #[repr(transparent)]
        pub struct $name(pub c_ares::struct_hostent);
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
                // SAFETY: `#[repr(transparent)]` — `*mut struct_hostent` casts to `*mut $name`.
                let result = if results.is_null() {
                    None
                } else {
                    Some(results.cast::<$name>())
                };
                Self::on_cares_complete(core::ptr::from_mut(self), status, timeouts, result);
            }
        }
    };
}

/// Transparent newtype over `hostent_with_ttls` for A/AAAA records.
macro_rules! hostent_ttls_newtype {
    ($name:ident, $tag:literal, $syscall:literal, $field:ident, $ns_type:ident, $parse:ident) => {
        #[repr(transparent)]
        pub struct $name(pub c_ares::hostent_with_ttls);
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
                // SAFETY: `#[repr(transparent)]`; allocated via `heap::alloc` in
                // `on_hostent_with_ttls` below — Drop calls `ares_free_hostent`.
                unsafe {
                    drop(bun_core::heap::take(
                        this.cast::<c_ares::hostent_with_ttls>(),
                    ))
                }
            }
        }
        impl c_ares::HostentWithTtlsHandler for ResolveInfoRequest<$name> {
            const PARSE: fn(
                *mut u8,
                c_int,
            ) -> Result<Box<c_ares::hostent_with_ttls>, c_ares::Error> =
                c_ares::hostent_with_ttls::$parse;
            fn on_hostent_with_ttls(
                &mut self,
                status: Option<c_ares::Error>,
                timeouts: i32,
                results: Option<Box<c_ares::hostent_with_ttls>>,
            ) {
                // SAFETY: `#[repr(transparent)]` — `*mut hostent_with_ttls` casts to `*mut $name`.
                let result = results.map(|b| bun_core::heap::into_raw(b).cast::<$name>());
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
#[bun_jsc::JsClass(name = "DNSResolver")]
pub struct Resolver {
    pub ref_count: bun_ptr::RefCount<Resolver>, // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — already Cell-backed
    pub channel: Cell<Option<*mut c_ares::Channel>>, // FFI
    pub vm: bun_ptr::BackRef<VirtualMachine>, // JSC_BORROW (BACKREF — VirtualMachine outlives the resolver; read-only after init)
    pub polls: JsCell<PollsMap>,
    pub options: Cell<c_ares::ChannelOptions>,

    pub event_loop_timer: JsCell<EventLoopTimer>,

    pub pending_host_cache_cares: JsCell<PendingCache>,
    pub pending_host_cache_native: JsCell<PendingCache>,
    pub pending_srv_cache_cares: JsCell<SrvPendingCache>,
    pub pending_soa_cache_cares: JsCell<SoaPendingCache>,
    pub pending_txt_cache_cares: JsCell<TxtPendingCache>,
    pub pending_naptr_cache_cares: JsCell<NaptrPendingCache>,
    pub pending_mx_cache_cares: JsCell<MxPendingCache>,
    pub pending_caa_cache_cares: JsCell<CaaPendingCache>,
    pub pending_ns_cache_cares: JsCell<NSPendingCache>,
    pub pending_ptr_cache_cares: JsCell<PtrPendingCache>,
    pub pending_cname_cache_cares: JsCell<CnamePendingCache>,
    pub pending_a_cache_cares: JsCell<APendingCache>,
    pub pending_aaaa_cache_cares: JsCell<AAAAPendingCache>,
    pub pending_any_cache_cares: JsCell<AnyPendingCache>,
    pub pending_addr_cache_cares: JsCell<AddrPendingCache>,
    pub pending_nameinfo_cache_cares: JsCell<NameInfoPendingCache>,
}

bun_event_loop::impl_timer_owner!(Resolver; from_timer_ptr => event_loop_timer);

/// RAII owner for a scoped `Resolver` refcount bump (Zig: `this.ref(); defer this.deref();`).
/// Constructed via [`Resolver::ref_scope`]; releases the ref on Drop.
#[must_use = "dropping immediately releases the scoped ref"]
struct ResolverRefGuard(*mut Resolver);

impl Drop for ResolverRefGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `ref_scope` took a ref on a live heap-allocated Resolver, so
        // `self.0` is still live here and `deref` has valid write provenance.
        unsafe { Resolver::deref(self.0) };
    }
}

// `pub const ref/deref` from RefCount mixin → provided by `bun_ptr::IntrusiveRc<Self>`.
impl bun_ptr::RefCounted for Resolver {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { &raw mut (*this).ref_count }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: last ref dropped; allocated via Box in `init()`.
        unsafe { Self::deinit(this) };
    }
}

#[cfg(windows)]
pub struct UvDnsPoll {
    // BACKREF — Zig: `parent: *Resolver` (mutable). Stored mut because the poll
    // callback hands it to `Resolver::deref`, which may write/free `*this`.
    pub parent: *mut Resolver,
    pub socket: c_ares::ares_socket_t,
    pub poll: libuv::uv_poll_t,
}

#[cfg(windows)]
impl UvDnsPoll {
    pub fn new(parent: *mut Resolver, socket: c_ares::ares_socket_t) -> *mut Self {
        bun_core::heap::into_raw(Box::new(Self {
            parent,
            socket,
            poll: bun_core::ffi::zeroed(),
        }))
    }

    pub fn destroy(this: *mut Self) {
        unsafe { drop(bun_core::heap::take(this)) };
    }

    pub fn from_poll(poll: *mut libuv::uv_poll_t) -> *mut Self {
        // SAFETY: poll points to UvDnsPoll.poll
        unsafe { bun_core::from_field_ptr!(UvDnsPoll, poll, poll) }
    }
}

pub enum CacheHit {
    Inflight(*mut get_addr_info_request::PendingCacheKey), // BORROW_FIELD into resolver buffer
    New(*mut get_addr_info_request::PendingCacheKey),      // BORROW_FIELD into resolver buffer
    Disabled,
}

pub enum LookupCacheHit<R: HasPendingCacheKey> {
    // PORT NOTE: Zig's `LookupCacheHit(request_type)` referenced `request_type.PendingCacheKey`.
    // We thread the request type via `R` and resolve `PendingCacheKey` through `HasPendingCacheKey`.
    Inflight(*mut R::PendingCacheKey), // BORROW_FIELD
    New(*mut R::PendingCacheKey),      // BORROW_FIELD
    Disabled,
}

/// Associates a request type with its `PendingCacheKey` and the matching `HiveArray`
/// field on `Resolver`. Stands in for Zig's `request_type.PendingCacheKey` projection
/// and `@field(resolver, comptime cache_name)` reflection.
pub trait HasPendingCacheKey {
    type PendingCacheKey;

    /// Return `&mut @field(resolver, cache_name)` — the per-request-type pending HiveArray.
    /// `field` is the runtime tag of the comptime field name (some request types are reachable
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
    /// Construct a fully-initialized `PendingCacheKey { hash, len, lookup: null }`
    /// for `HiveArray::get_init`. `lookup` is filled in later by `*Request::init`
    /// once the request has been heap-allocated; until then it is a defined null
    /// rather than uninit garbage, so the `iter_set` loop in
    /// `get_or_put_into_resolve_pending_cache` can safely materialise
    /// `&mut PendingCacheKey` over the slot.
    fn key_new(hash: u64, len: u16) -> Self::PendingCacheKey;
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
    fn key_new(hash: u64, len: u16) -> Self::PendingCacheKey {
        resolve_info_request::PendingCacheKey {
            hash,
            len,
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
    fn key_new(hash: u64, len: u16) -> Self::PendingCacheKey {
        get_host_by_addr_info_request::PendingCacheKey {
            hash,
            len,
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
    fn key_new(hash: u64, len: u16) -> Self::PendingCacheKey {
        get_name_info_request::PendingCacheKey {
            hash,
            len,
            lookup: ptr::null_mut(),
        }
    }
}

pub enum ChannelResult<'a> {
    Err(c_ares::Error),
    Result(&'a mut c_ares::Channel), // BORROW_FIELD — returns this.channel.?
}

// Canonical enum + parser live in `bun_dns` (lower tier so `cli` can parse
// `--dns-result-order` without depending on the runtime). Re-export for
// existing `crate::dns_jsc::Order` callers; `to_js` stays here as a tier-6
// extension since it needs JSC.
pub use bun_dns::{ORDER_MAP, Order};

pub trait OrderJscExt {
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

pub static RECORD_TYPE_MAP: phf::Map<&'static [u8], RecordType> = phf::phf_map! {
    b"A" => RecordType::A, b"AAAA" => RecordType::AAAA, b"ANY" => RecordType::ANY,
    b"CAA" => RecordType::CAA, b"CNAME" => RecordType::CNAME, b"MX" => RecordType::MX,
    b"NS" => RecordType::NS, b"PTR" => RecordType::PTR, b"SOA" => RecordType::SOA,
    b"SRV" => RecordType::SRV, b"TXT" => RecordType::TXT,
    b"a" => RecordType::A, b"aaaa" => RecordType::AAAA, b"any" => RecordType::ANY,
    b"caa" => RecordType::CAA, b"cname" => RecordType::CNAME, b"mx" => RecordType::MX,
    b"ns" => RecordType::NS, b"ptr" => RecordType::PTR, b"soa" => RecordType::SOA,
    b"srv" => RecordType::SRV, b"txt" => RecordType::TXT,
};

impl RecordType {
    pub const DEFAULT: Self = RecordType::A;
}

struct DNSQuery {
    name: ZigString,
    record_type: RecordType,
    ttl: i32,
}

impl Resolver {
    /// Dereference the back-pointer to the VirtualMachine.
    /// SAFETY: VirtualMachine outlives the Resolver (BACKREF, see field decl).
    #[inline]
    /// JS `new Resolver()` — `#[bun_jsc::JsClass]` requires an associated
    /// `constructor` returning `JsResult<*mut Self>`.
    pub fn constructor(
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        // SAFETY: `bun_vm()` returns the live thread-local VM for this global.
        let vm = global_this.bun_vm();
        Ok(Self::init(vm))
    }

    pub fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    // Intrusive refcount forwarders (RefCount.ref / RefCount.deref).
    pub fn ref_(&self) {
        // SAFETY: `self` is live; ref_count uses interior mutability.
        unsafe { bun_ptr::RefCount::<Self>::ref_(std::ptr::from_ref::<Self>(self).cast_mut()) };
    }
    /// Decrement the intrusive refcount; on last ref, runs `deinit` (frees the
    /// allocation via `heap::take`).
    ///
    /// Takes a raw `*mut Self` (not `&self`) because the final deref must write
    /// through / deallocate `*this`; deriving a `*mut` from a `&self` borrow
    /// and writing through it is UB under Stacked/Tree Borrows. Matches the
    /// Zig `RefCount.deref(*@This())` signature and the codebase pattern in
    /// `bun_ptr::RefCount::deref(self_: *mut T)`.
    ///
    /// # Safety
    /// `this` must point to a live heap-allocated `Resolver` originating from
    /// `heap::alloc` (see `init`). If this call may drop the last reference,
    /// the caller must not hold any live `&`/`&mut` borrow of `*this`.
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; `RefCount::deref` invokes
        // `RefCounted::destructor` (→ `Self::deinit`) on the 1→0 transition.
        unsafe { bun_ptr::RefCount::<Self>::deref(this) };
    }

    /// RAII bracket: bump the intrusive refcount now, drop it on guard Drop.
    /// Mirrors Zig's `this.ref(); defer this.deref();` so re-entrant c-ares
    /// callbacks that release their own refs cannot free `*this` mid-call.
    ///
    /// Captures a raw `*mut` (not `&self`) so the guard does not borrow the
    /// resolver — gives `deref` proper write provenance for the final
    /// `heap::take` in `deinit`.
    ///
    /// # Safety
    /// `this` must point to a live heap-allocated `Resolver` (see `init`).
    #[inline]
    unsafe fn ref_scope(this: *mut Self) -> ResolverRefGuard {
        // SAFETY: caller contract — `this` is live; `ref_()` uses interior mutability.
        unsafe { (*this).ref_() };
        ResolverRefGuard(this)
    }

    pub fn setup(vm: &VirtualMachine) -> Self {
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

    pub fn init(vm: &VirtualMachine) -> *mut Self {
        bun_output::scoped_log!(DNSResolver, "init");
        bun_core::heap::into_raw(Box::new(Self::setup(vm)))
    }

    pub fn finalize(self: Box<Self>) {
        // Refcounted: release the JS wrapper's +1; allocation may outlive this
        // call if other refs remain, so hand ownership back to the raw refcount.
        // SAFETY: `self` is the heap allocation from `init`; `deref` frees on count==0.
        unsafe { Self::deref(Box::into_raw(self)) };
    }

    fn deinit(this: *mut Self) {
        unsafe {
            if let Some(channel) = (*this).channel.get() {
                c_ares::Channel::destroy(channel);
            }
            drop(bun_core::heap::take(this));
        }
    }

    // ─── R-2 interior-mutability helpers ────────────────────────────────────

    /// `self`'s address as `*mut Self` for c-ares / `FilePoll` / `IntrusiveRc`
    /// ctx slots and `Self::deref`. Callbacks deref it as `&*const` (shared) —
    /// see `on_dns_poll`, `on_cares_complete` — so no write provenance is
    /// required; the `*mut` spelling is purely to match the C signature. All
    /// mutation routes through `Cell` / `JsCell` (UnsafeCell-backed).
    #[inline]
    pub fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    // ───────────── timer / pending bookkeeping ─────────────

    pub fn check_timeouts(&self, now: &ElTimespec, vm: &VirtualMachine) {
        // PORT NOTE: caller (`dispatch.rs::fire_timer`) hands us the event-loop's
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
            // PORT NOTE (b2-cycle): low-tier `VirtualMachine.timer` is `()`;
            // resolve via the high-tier `RuntimeState` hook.
            let state = crate::jsc_hooks::runtime_state();
            // SAFETY: `state` is the boxed per-thread `RuntimeState`; single-threaded JS heap.
            unsafe { (*state).timer.increment_timer_ref(-1, uws_loop) };
            // SAFETY: `deref_this` is the heap allocation from `init`. This releases the
            // ref taken by `add_timer` (no local `ref_()` pairing). The timer is
            // only ACTIVE while at least one pending request also holds an
            // `IntrusiveRc<Resolver>`, so this `deref` cannot drop the last ref
            // and `*self` stays live for the rest of the function body.
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
                let _ = self.add_timer(Some(&now));
            }
        }
    }

    fn any_requests_pending(&self) -> bool {
        // TODO(port): Zig used @typeInfo to iterate all `pending_*` fields.
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
            .unwrap_or_else(|| bun::timespec::now(bun::TimespecMockMode::AllowMockedTime));
        let next = now_ts.add_ms(1000);
        // PORT NOTE: `EventLoopTimer.next` uses the event-loop crate's local
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
            // `JsCell` is `#[repr(transparent)]`, so `as_ptr()` yields the same
            // address `dispatch.rs::owner!` recovers via `from_field_ptr!`.
            (*state).timer.insert(self.event_loop_timer.as_ptr());
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
            // SAFETY: `this` is the heap allocation from `init`. This releases the
            // ref taken by `add_timer`; all callers of `request_completed` (the only
            // path here) hold an `IntrusiveRc<Resolver>`, so the timer ref is never
            // the last and this `deref` cannot reach 0 while `&self` is live.
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
    // PORT NOTE: Zig used `@field(this, "pending_{TYPE_NAME}_cache_cares")` with a comptime
    // string. Each per-record cache is a distinct monomorphization of
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

    /// Generic `getKey` — copy the `PendingCacheKey` at `index` out by value and free the slot.
    // PORT NOTE: Zig used `@field(this, cache_name)` and returned `request_type.PendingCacheKey`
    // by value, then wrote `undefined` to the slot. We dispatch via `HasPendingCacheKey`.
    fn get_key<R: HasPendingCacheKey>(
        &self,
        index: u8,
        cache_field: PendingCacheField,
    ) -> R::PendingCacheKey {
        let cache = R::pending_cache(self, cache_field);
        debug_assert!(cache.used.is_set(index as usize));
        // SAFETY: `used` bit is set ⇒ slot was initialized by `get_or_put_into_resolve_pending_cache`
        // + `*Request::init`. `PendingCacheKey` is POD; reading by value then unsetting the bit
        // hands ownership of the slot back to the HiveArray (Zig's `= undefined`).
        let entry = unsafe { core::ptr::read(cache.buffer[index as usize].as_ptr()) };
        cache.used.unset(index as usize);
        entry
    }

    // Monomorphic helpers used by the drain* fns below.
    fn get_key_host(
        &self,
        index: u8,
        field: PendingCacheField,
    ) -> get_addr_info_request::PendingCacheKey {
        let cache = self.pending_host_cache(field);
        debug_assert!(cache.used.is_set(index as usize));
        let entry = unsafe { core::ptr::read(cache.buffer[index as usize].as_ptr()) };
        cache.used.unset(index as usize);
        entry
    }
    fn get_key_addr(&self, index: u8) -> get_host_by_addr_info_request::PendingCacheKey {
        self.pending_addr_cache_cares.with_mut(|cache| {
            debug_assert!(cache.used.is_set(index as usize));
            let entry = unsafe { core::ptr::read(cache.buffer[index as usize].as_ptr()) };
            cache.used.unset(index as usize);
            entry
        })
    }
    fn get_key_nameinfo(&self, index: u8) -> get_name_info_request::PendingCacheKey {
        self.pending_nameinfo_cache_cares.with_mut(|cache| {
            debug_assert!(cache.used.is_set(index as usize));
            let entry = unsafe { core::ptr::read(cache.buffer[index as usize].as_ptr()) };
            cache.used.unset(index as usize);
            entry
        })
    }

    pub fn drain_pending_cares<T: CAresRecordType>(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut T>,
    ) {
        // cache_name = format!("pending_{}_cache_cares", T::TYPE_NAME)
        // SAFETY: `self` is the live heap allocation; ref_scope keeps count > 0 across re-entrant callbacks.
        let _g = unsafe { Self::ref_scope(self.as_ctx_ptr()) };

        // TODO(port): generic getKey over T::CACHE_FIELD
        let key = {
            let cache = self.pending_cache_for::<T>(T::CACHE_FIELD);
            debug_assert!(cache.used.is_set(index as usize));
            // SAFETY: `used` bit is set ⇒ slot was initialized by
            // `get_or_put_into_resolve_pending_cache` + `*Request::init`.
            // `PendingCacheKey` is POD; reading by value then unsetting the bit hands
            // ownership of the slot back to the HiveArray (Zig's `= undefined`).
            let key = unsafe { core::ptr::read(cache.buffer[index as usize].as_ptr()) };
            cache.used.unset(index as usize);
            key
        };

        let Some(addr) = result else {
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

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();
            let mut array = (*addr)
                .to_js_response(prev_global, T::TYPE_NAME)
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            // SAFETY: addr is the c-ares-allocated reply; freed once after all consumers run.
            let _free_addr = scopeguard::guard(addr, |a| T::destroy(a));
            array.ensure_still_alive();
            CAresLookup::<T>::on_complete(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            array.ensure_still_alive();

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = (*addr)
                        .to_js_response(new_global, T::TYPE_NAME)
                        .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                CAresLookup::<T>::on_complete(value.as_ptr(), array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_host_cares(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::AddrInfo>,
    ) {
        let key = self.get_key_host(index, PendingCacheField::PendingHostCacheCares);

        // SAFETY: `self` is the live heap allocation; ref_scope keeps count > 0 across re-entrant callbacks.
        let _g = unsafe { Self::ref_scope(self.as_ctx_ptr()) };

        let Some(addr) = result else {
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

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();
            let mut array = super::cares_jsc::addr_info_to_js_array(&mut *addr, prev_global)
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            // SAFETY: addr is the c-ares-allocated AddrInfo; freed once after all consumers run.
            // Move the raw pointer into the guard so the loop body can keep borrowing `*addr`.
            let _free_addr = scopeguard::guard(addr, |a| c_ares::AddrInfo::destroy(a));
            array.ensure_still_alive();
            DNSLookup::on_complete_with_array(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            array.ensure_still_alive();
            // std.c.addrinfo

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = super::cares_jsc::addr_info_to_js_array(&mut *addr, new_global)
                        .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                DNSLookup::on_complete_with_array(value.as_ptr(), array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_host_native(
        &self,
        index: u8,
        global_object: &JSGlobalObject,
        err: i32,
        result: GetAddrInfoResultAny,
    ) {
        bun_output::scoped_log!(DNSResolver, "drainPendingHostNative");
        let key = self.get_key_host(index, PendingCacheField::PendingHostCacheNative);

        // SAFETY: `self` is the live heap allocation; ref_scope keeps count > 0 across re-entrant callbacks.
        let _g = unsafe { Self::ref_scope(self.as_ctx_ptr()) };

        let mut array: JSValue = match super::options_jsc::result_any_to_js(&result, global_object)
            .unwrap_or(None)
        {
            // TODO: properly propagate exception upwards
            Some(a) => a,
            None => {
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
        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();

            {
                array.ensure_still_alive();
                DNSLookup::on_complete_with_array(ptr::addr_of_mut!((*key.lookup).head), array);
                drop(bun_core::heap::take(key.lookup));
                array.ensure_still_alive();
            }

            // std.c.addrinfo

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                pending = (*value.as_ptr()).next;
                if !core::ptr::eq(prev_global, new_global) {
                    array = super::options_jsc::result_any_to_js(&result, new_global)
                        .unwrap_or(None)
                        .unwrap(); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }

                array.ensure_still_alive();
                DNSLookup::on_complete_with_array(value.as_ptr(), array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_addr_cares(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<*mut c_ares::struct_hostent>,
    ) {
        let key = self.get_key_addr(index);

        // SAFETY: `self` is the live heap allocation; ref_scope keeps count > 0 across re-entrant callbacks.
        let _g = unsafe { Self::ref_scope(self.as_ctx_ptr()) };

        let Some(addr) = result else {
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

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();
            //  The callback need not and should not attempt to free the memory
            //  pointed to by hostent; the ares library will free it when the
            //  callback returns.
            let mut array = super::cares_jsc::hostent_to_js_response(&mut *addr, prev_global, b"")
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            array.ensure_still_alive();
            CAresReverse::on_complete(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            array.ensure_still_alive();

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = super::cares_jsc::hostent_to_js_response(&mut *addr, new_global, b"")
                        .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                CAresReverse::on_complete(value.as_ptr(), array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn drain_pending_name_info_cares(
        &self,
        index: u8,
        err: Option<c_ares::Error>,
        timeout: i32,
        result: Option<c_ares::struct_nameinfo>,
    ) {
        let key = self.get_key_nameinfo(index);

        // SAFETY: `self` is the live heap allocation; ref_scope keeps count > 0 across re-entrant callbacks.
        let _g = unsafe { Self::ref_scope(self.as_ctx_ptr()) };

        let Some(mut name_info) = result else {
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

        unsafe {
            let mut pending = (*key.lookup).head.next;
            let mut prev_global = (*key.lookup).head.global_this();

            let mut array = super::cares_jsc::nameinfo_to_js_response(&mut name_info, prev_global)
                .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
            array.ensure_still_alive();
            CAresNameInfo::on_complete(ptr::addr_of_mut!((*key.lookup).head), array);
            drop(bun_core::heap::take(key.lookup));

            array.ensure_still_alive();

            while let Some(value) = pending {
                let new_global = (*value.as_ptr()).global_this();
                if !core::ptr::eq(prev_global, new_global) {
                    array = super::cares_jsc::nameinfo_to_js_response(&mut name_info, new_global)
                        .unwrap_or(JSValue::ZERO); // TODO: properly propagate exception upwards
                    prev_global = new_global;
                }
                pending = (*value.as_ptr()).next;

                array.ensure_still_alive();
                CAresNameInfo::on_complete(value.as_ptr(), array);
                array.ensure_still_alive();
            }
        }
    }

    pub fn get_or_put_into_resolve_pending_cache<R: HasPendingCacheKey>(
        &self,
        key: &R::PendingCacheKey,
        field: PendingCacheField,
    ) -> LookupCacheHit<R> {
        // PORT NOTE: Zig used `@field(this, field)` over a comptime string. We dispatch via
        // `HasPendingCacheKey::pending_cache`; the body is identical across all `R`.
        let cache = R::pending_cache(self, field);
        let mut inflight_iter = cache.used.iter_set();

        while let Some(index) = inflight_iter.next() {
            // SAFETY: `used` bit is set ⇒ slot was initialized.
            let entry = unsafe { &mut *cache.buffer[index].as_mut_ptr() };
            if R::key_hash(entry) == R::key_hash(key) && R::key_len(entry) == R::key_len(key) {
                return LookupCacheHit::Inflight(std::ptr::from_mut(entry));
            }
        }

        if let Some(new) = cache.get_init(R::key_new(R::key_hash(key), R::key_len(key))) {
            return LookupCacheHit::New(new.as_ptr());
        }

        LookupCacheHit::Disabled
    }

    pub fn get_or_put_into_pending_cache(
        &self,
        key: get_addr_info_request::PendingCacheKey,
        field: PendingCacheField,
    ) -> CacheHit {
        let cache = self.pending_host_cache(field);
        let mut inflight_iter = cache.used.iter_set();

        while let Some(index) = inflight_iter.next() {
            // SAFETY: `used` bit is set ⇒ slot was initialized.
            let entry = unsafe { &mut *cache.buffer[index].as_mut_ptr() };
            if entry.hash == key.hash && entry.len == key.len {
                return CacheHit::Inflight(std::ptr::from_mut(entry));
            }
        }

        if let Some(new) = cache.get_init(get_addr_info_request::PendingCacheKey {
            hash: key.hash,
            len: key.len,
            lookup: ptr::null_mut(),
        }) {
            return CacheHit::New(new.as_ptr());
        }

        CacheHit::Disabled
    }

    pub fn get_channel(&self) -> ChannelResult<'_> {
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

    pub fn get_channel_or_error(
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
                    path: bun_core::String::default(),
                    syscall: bun_core::String::default(),
                    hostname: bun_core::String::default(),
                    fd: -1,
                    dest: bun_core::String::default(),
                };
                Err(global_this.throw_value(system_error.to_error_instance(global_this)))
            }
        }
    }

    // ───────────── poll callbacks ─────────────

    #[cfg(windows)]
    pub extern "C" fn on_dns_poll_uv(watcher: *mut libuv::uv_poll_t, status: c_int, events: c_int) {
        let poll = UvDnsPoll::from_poll(watcher);
        // SAFETY: `poll` is the live `UvDnsPoll` recovered from libuv's `watcher`
        // via `from_poll` (libuv guarantees the handle outlives this callback).
        // `parent` is the heap-allocated Resolver back-ptr (set in
        // `on_dns_socket_state`); it is kept alive across `Channel::process` by the
        // `ref_()`/`_deref` bracket below. `channel` is non-null because c-ares
        // must have been initialized for this poll callback to fire.
        unsafe {
            let parent: *mut Resolver = (*poll).parent;
            let vm = (*parent).vm.get();
            let _exit = EventLoop::enter_scope(vm.event_loop());
            // SAFETY: `parent` is the live heap-allocated Resolver back-ptr.
            let _deref = Self::ref_scope(parent);
            // channel must be non-null here as c_ares must have been initialized if we're receiving callbacks
            let channel = (*parent).channel.get().unwrap();
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

    #[cfg(windows)]
    pub unsafe extern "C" fn on_close_uv(watcher: *mut libuv::uv_handle_t) {
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
    pub fn on_dns_poll(&self, poll: &mut FilePoll) {
        let vm = self.vm();
        let _exit = vm.enter_event_loop_scope();
        let Some(channel) = self.channel.get() else {
            self.polls.with_mut(|p| {
                let _ = p.remove(&poll.fd.native());
            });
            poll.deinit();
            return;
        };

        // SAFETY: `self` is the heap allocation from `init`; ref_scope keeps count > 0 across re-entrant callbacks.
        let _deref = unsafe { Self::ref_scope(self.as_ctx_ptr()) };

        // SAFETY: `channel` is the live c-ares channel owned by `self`; no `&mut`
        // to `*self` is held across this re-entrant call (all fields are
        // UnsafeCell-backed).
        unsafe {
            (*channel).process(poll.fd.native(), poll.is_readable(), poll.is_writable());
        }
    }

    pub fn on_dns_socket_state(&self, fd: c_ares::ares_socket_t, readable: bool, writable: bool) {
        #[cfg(windows)]
        {
            use libuv as uv;
            if !readable && !writable {
                // cleanup — Zig: `fetchOrderedRemove`; our `remove` is the
                // ordered, value-returning variant.
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
                // TODO(port): FilePoll generic owner type Resolver
            }

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
    pub fn global_resolve(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        global_resolver(global_this).resolve(global_this, callframe)
    }

    #[host_fn(method)]
    pub fn resolve(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<3>();
        if arguments.len < 1 {
            return Err(global_this.throw_not_enough_arguments("resolve", 3, arguments.len));
        }

        let record_type: RecordType = if arguments.len <= 1 {
            RecordType::DEFAULT
        } else {
            'brk: {
                let record_type_value = arguments.ptr[1];
                if record_type_value.is_empty_or_undefined_or_null()
                    || !record_type_value.is_string()
                {
                    break 'brk RecordType::DEFAULT;
                }
                // SAFETY: `to_js_string` returns a live *mut JSString rooted by `record_type_value`.
                let record_type_str = record_type_value.to_js_string(global_this)?;
                if record_type_str.length() == 0 {
                    break 'brk RecordType::DEFAULT;
                }
                // TODO(port): phf custom hasher — Zig used getWithEql with ZigString.eqlComptime
                match RECORD_TYPE_MAP.get(record_type_str.get_zig_string(global_this).slice()) {
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

        let name_value = arguments.ptr[0];
        if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
            return Err(global_this.throw_invalid_argument_type("resolve", "name", "string"));
        }
        // SAFETY: `to_js_string` returns a live *mut JSString rooted by `name_value`.
        let name_str = name_value.to_js_string(global_this)?;
        if name_str.length() == 0 {
            return Err(global_this.throw_invalid_argument_type(
                "resolve",
                "name",
                "non-empty string",
            ));
        }
        let name = name_str.to_slice_clone(global_this)?;

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
    pub fn global_reverse(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        global_resolver(global_this).reverse(global_this, callframe)
    }

    #[host_fn(method)]
    pub fn reverse(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        if arguments.len < 1 {
            return Err(global_this.throw_not_enough_arguments("reverse", 1, arguments.len));
        }

        let ip_value = arguments.ptr[0];
        if ip_value.is_empty_or_undefined_or_null() || !ip_value.is_string() {
            return Err(global_this.throw_invalid_argument_type("reverse", "ip", "string"));
        }
        // SAFETY: `to_js_string` returns a live *mut JSString rooted by `ip_value`.
        let ip_str = ip_value.to_js_string(global_this)?;
        if ip_str.length() == 0 {
            return Err(global_this.throw_invalid_argument_type(
                "reverse",
                "ip",
                "non-empty string",
            ));
        }

        let ip_slice = ip_str.to_slice_clone(global_this)?;
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
            unsafe { (*inflight).append(cares_reverse) };
            return Ok(unsafe { (*cares_reverse).promise.value() });
        }

        let request = GetHostByAddrInfoRequest::init(
            cache,
            Some(self.as_ctx_ptr()),
            ip,
            global_this,
            PendingCacheField::PendingAddrCacheCares,
        );

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
    pub fn global_lookup(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        if arguments.len < 1 {
            return Err(global_this.throw_not_enough_arguments("lookup", 2, arguments.len));
        }

        let name_value = arguments.ptr[0];
        if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
            return Err(global_this.throw_invalid_argument_type("lookup", "hostname", "string"));
        }
        // SAFETY: `to_js_string` returns a live *mut JSString rooted by `name_value`.
        let name_str = name_value.to_js_string(global_this)?;
        if name_str.length() == 0 {
            return Err(global_this.throw_invalid_argument_type(
                "lookup",
                "hostname",
                "non-empty string",
            ));
        }

        let mut options = GetAddrInfoOptions::default();
        let mut port: u16 = 0;

        if arguments.len > 1 && arguments.ptr[1].is_object() {
            let options_object = arguments.ptr[1];

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

        let name = name_str.to_slice(global_this);
        let resolver = global_resolver(global_this);

        resolver.do_lookup(name.slice(), port, options, global_this)
    }

    pub fn do_lookup(
        &self,
        name: &[u8],
        port: u16,
        options: GetAddrInfoOptions,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // The system backends copy the hostname into a fixed `bun.PathBuffer` on the
        // stack before null-terminating it. Reject anything that cannot fit so we never
        // index past that buffer. RFC 1035 caps hostnames at 253 octets and NI_MAXHOST
        // is 1025, so this never rejects a name that could have resolved.
        if name.len() >= MAX_PATH_BYTES {
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
                self.c_ares_lookup_with_normalized_name(query, global_this)?
            }
            GetAddrInfoBackend::Libc => {
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(self, query, global_this)?
                }
                #[cfg(not(windows))]
                {
                    lib_c::lookup(self, query, global_this)
                }
            }
            GetAddrInfoBackend::System => {
                #[cfg(target_os = "macos")]
                {
                    lib_info::lookup(self, query, global_this)
                }
                #[cfg(windows)]
                {
                    lib_uv_backend::lookup(self, query, global_this)?
                }
                #[cfg(all(not(target_os = "macos"), not(windows)))]
                {
                    lib_c::lookup(self, query, global_this)
                }
            }
        })
    }

    // ───────── per-record-type global+instance resolve fns ─────────
    // These are mechanically identical; Zig had one per record type.
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
            let arguments = callframe.arguments_old::<2>();
            if arguments.len < 1 {
                return Err(global_this.throw_not_enough_arguments($jsname, 1, arguments.len));
            }
            let name_value = arguments.ptr[0];
            if name_value.is_empty_or_undefined_or_null() || !name_value.is_string() {
                return Err(global_this.throw_invalid_argument_type($jsname, "hostname", "string"));
            }
            // SAFETY: `to_js_string` returns a live *mut JSString rooted by `name_value`.
            let name_str = name_value.to_js_string(global_this)?;
            if !$allow_empty && name_str.length() == 0 {
                return Err(global_this.throw_invalid_argument_type(
                    $jsname,
                    "hostname",
                    "non-empty string",
                ));
            }
            let name = name_str.to_slice_clone(global_this)?;
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
    // PORT NOTE: resolveTxt/resolveAny used arguments_old(1) in Zig; collapsed into the macro.

    pub fn do_resolve_cares<T: CAresRecordType>(
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
            unsafe { (*inflight).append(cares_lookup) };
            return Ok(unsafe { (*cares_lookup).promise.value() });
        }

        let request = ResolveInfoRequest::<T>::init(
            cache,
            Some(self.as_ctx_ptr()),
            name, // CAresLookup will have the ownership
            global_this,
            cache_field,
        );
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

    pub fn c_ares_lookup_with_normalized_name(
        &self,
        query: GetAddrInfo,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let channel: *mut c_ares::Channel = match self.get_channel() {
            ChannelResult::Result(res) => res,
            ChannelResult::Err(err) => {
                let syscall = bun_core::String::create_atom(&query.name);
                // PORT NOTE: SystemError has no Default impl upstream; spell out
                // the Zig field defaults (.empty strings, fd = c_int::MIN).
                let system_error = SystemError {
                    errno: -1,
                    code: bun_core::String::static_(err.code()),
                    message: bun_core::String::static_(err.label()),
                    path: bun_core::String::empty(),
                    syscall,
                    hostname: bun_core::String::empty(),
                    fd: c_int::MIN,
                    dest: bun_core::String::empty(),
                };
                return Err(global_this.throw_value(system_error.to_error_instance(global_this)));
            }
        };

        let key = get_addr_info_request::PendingCacheKey::init(&query);

        let cache =
            self.get_or_put_into_pending_cache(key, PendingCacheField::PendingHostCacheCares);
        if let CacheHit::Inflight(inflight) = cache {
            let dns_lookup = DNSLookup::init(self.as_ctx_ptr(), global_this);
            unsafe { (*inflight).append(dns_lookup) };
            return Ok(unsafe { (*dns_lookup).promise.value() });
        }

        let hints_buf = [query.to_cares()];
        let request = GetAddrInfoRequest::init(
            cache,
            get_addr_info_request::Backend::CAres,
            Some(self.as_ctx_ptr()),
            &query,
            global_this,
            PendingCacheField::PendingHostCacheCares,
        );
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
        scopeguard::defer! { unsafe { c_ares::ares_free_data(servers.cast()) } };

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

            // SAFETY: `src` is a `*const c_void` type-erasure of the in_addr/in6_addr
            // union arm (read-only); `dst` is the stack buffer slice starting at [1].
            let addr_ptr: *const c_void = current.addr_ptr();
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
            // PORT NOTE: `bun_core::ZigString` lacks `with_encoding`/`to_js` (those live
            // on `bun_jsc::zig_string::ZigString`). The formatted bytes here are pure
            // ASCII (IP address + optional port), so `with_encoding()` would be a no-op
            // anyway — borrow as a `bun_core::String` and hand to JS.
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

            i += 1;
            cur = current.next;
        }

        Ok(values)
    }

    // FFI shim emitted by `export_host_fn!` below — `#[host_fn]` (Free) cannot
    // expand inside an `impl` block (it emits a bare `fn_name(...)` call).
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
    pub fn set_local_address(
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
        let str_ = value.to_slice(global_this)?;
        // PORT NOTE: ZigStringSlice has no `into_owned_slice_z`; build the
        // NUL-terminated buffer inline (Zig: `toOwnedSliceZ`).
        let bytes = str_.slice();
        let mut slice = bytes.to_vec();
        slice.push(0);

        let mut addr = [0u8; 16];

        if unsafe {
            c_ares::ares_inet_pton(
                c_ares::AF::INET,
                slice.as_ptr().cast::<c_char>(),
                addr.as_mut_ptr().cast(),
            )
        } == 1
        {
            let ip = u32::from_be_bytes([addr[0], addr[1], addr[2], addr[3]]);
            // SAFETY: `channel` is a live handle returned by `ares_init_options`.
            c_ares::ares_set_local_ip4(unsafe { &mut *channel }, ip);
            return Ok(c_ares::AF::INET);
        }

        if unsafe {
            c_ares::ares_inet_pton(
                c_ares::AF::INET6,
                slice.as_ptr().cast::<c_char>(),
                addr.as_mut_ptr().cast(),
            )
        } == 1
        {
            unsafe { c_ares::ares_set_local_ip6(channel, addr.as_ptr()) };
            return Ok(c_ares::AF::INET6);
        }

        Err(jsc::Error::INVALID_IP_ADDRESS.throw(
            global_this,
            format_args!(
                "Invalid IP address: \"{}\"",
                bstr::BStr::new(&slice[..slice.len() - 1])
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

            // SAFETY: FFI; `address_buffer` is NUL-terminated above; `addr_mut_ptr()`
            // yields a `*mut c_void` over the in_addr/in6_addr union (16 bytes —
            // enough for in6_addr) with write provenance from `&mut node`.
            let addr_dst: *mut c_void = node.addr_mut_ptr();
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
            // PORT NOTE: reshaped for borrowck — raw ptr to avoid two &mut into entries.
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
    pub fn new_resolver(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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
    pub fn cancel(
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
    pub fn global_lookup_service(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        if arguments.len < 2 {
            return Err(global_this.throw_not_enough_arguments("lookupService", 2, arguments.len));
        }

        let addr_value = arguments.ptr[0];
        if addr_value.is_empty_or_undefined_or_null() || !addr_value.is_string() {
            return Err(global_this.throw_invalid_argument_type(
                "lookupService",
                "address",
                "string",
            ));
        }
        let addr_str = addr_value.to_js_string(global_this)?;
        if addr_str.length() == 0 {
            return Err(global_this.throw_invalid_argument_type(
                "lookupService",
                "address",
                "non-empty string",
            ));
        }
        let addr_zigstr = addr_str.get_zig_string(global_this);
        let addr_s = addr_zigstr.slice();

        let port_value = arguments.ptr[1];
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
            unsafe { (*inflight).append(info) };
            return Ok(unsafe { (*info).promise.value() });
        }

        let request = GetNameInfoRequest::init(
            cache,
            Some(resolver.as_ctx_ptr()),
            cache_name, // transfer ownership here
            global_this,
            PendingCacheField::PendingNameinfoCacheCares,
        );

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
    pub fn get_runtime_default_result_order_option(
        global_this: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a live VM pointer for the duration of the call.
        // PORT NOTE: VirtualMachine.dns_result_order is `u8` upstream (see
        // jsc/VirtualMachine.rs TODO(b2-cycle)); cast through Order's repr(u8).
        let raw = global_this.bun_vm().as_mut().dns_result_order;
        let order = match raw {
            4 => Order::Ipv4first,
            6 => Order::Ipv6first,
            _ => Order::Verbatim,
        };
        order.to_js(global_this)
    }
}

// ───────── JS host-fn FFI exports (Zig: comptime { @export(...) }) ─────────
// The #[host_fn] attribute emits the JSC-ABI shim under the Rust function name;
// re-export each under its `Bun__DNS__*` link name. Mirrors the proc-macro's
// shim body (see `bun_jsc_macros::host_fn`, `HostFnKind::Free`).
macro_rules! export_host_fn {
    ($scope:ident :: $f:ident, $name:literal) => {
        const _: () = {
            #[cfg(all(windows, target_arch = "x86_64"))]
            #[unsafe(export_name = $name)]
            pub unsafe extern "sysv64" fn __shim(
                g: *mut ::bun_jsc::JSGlobalObject,
                f: *mut ::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let g = unsafe { &*g };
                ::bun_jsc::__macro_support::host_fn_result(g, || $scope::$f(g, unsafe { &*f }))
            }
            #[cfg(not(all(windows, target_arch = "x86_64")))]
            #[unsafe(export_name = $name)]
            pub unsafe extern "C" fn __shim(
                g: *mut ::bun_jsc::JSGlobalObject,
                f: *mut ::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let g = unsafe { &*g };
                ::bun_jsc::__macro_support::host_fn_result(g, || $scope::$f(g, unsafe { &*f }))
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
// JS2Native ($newZigFunction) entry points — see GeneratedJS2Native.h
export_host_fn!(
    Resolver::new_resolver,
    "JS2Zig___src_runtime_dns_jsc_dns_zig__Resolver_newResolver"
);
export_host_fn!(
    Resolver::get_runtime_default_result_order_option,
    "JS2Zig___src_runtime_dns_jsc_dns_zig__Resolver_getRuntimeDefaultResultOrderOption"
);

// ported from: src/runtime/dns_jsc/dns.zig
