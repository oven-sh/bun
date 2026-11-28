//! DNS resolver — JSC bindings.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::{ManuallyDrop, MaybeUninit};
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};
use core::time::Duration;

use bun_collections::{BoundedArray, IntegerBitSet};
#[cfg(not(windows))]
use bun_core::Output;
use bun_core::ip_address::{self, IpText};
use bun_core::{self as bun, Fd, env_var, fmt as bun_fmt};
use bun_core::{ZStr, strings};
#[cfg(target_os = "macos")]
use bun_dns::GetAddrInfoResult;
use bun_dns::os::Os;
use bun_dns::{
    self, AddrInfoList, Backend as GetAddrInfoBackend, GetAddrInfo, Options as GetAddrInfoOptions,
    ResultList as GetAddrInfoResultList,
};
use bun_dns_client::{Answer, Answers, DEFAULT_PORT, Error, Events, RecordType, SocketId};
use bun_io::JsKeepAlive;
#[cfg(windows)]
use bun_iocp::Readiness;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, JSGlobalObject, JSPromiseStrong, JSValue, JsCell, JsResult, StringJsc as _,
};
use bun_ptr::RefPtr;
#[cfg(not(windows))]
use bun_sys::{self as sys};
use bun_uws::{ConnectingSocket, Loop};
use bun_wyhash::hash as wyhash;

use super::answer_jsc;
use crate::generated_bindgen::dns::LookupOptions;
use crate::generated_bindgen::dns_internals::{ResolverOptions, js_DNSResolver};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

// `sockaddr_storage` / `addrinfo` / `AF_*` / `AI_*` are absent from `libc` on
// the MSVC target; route through a single `netc` shim so call sites stay
// target-agnostic.
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
    pub(crate) use bun_sys::windows::ws2_32::{
        AF_INET, AF_INET6, AF_UNSPEC, EAI_NONAME, SOCK_STREAM, addrinfo, sockaddr, sockaddr_in,
        sockaddr_in6, sockaddr_storage,
    };
}
type SockaddrStorage = netc::sockaddr_storage;
type AddrInfo = netc::addrinfo;
type Sockaddr = netc::sockaddr;

#[inline]
fn global_resolver(global_this: &JSGlobalObject) -> &'static RefPtr<Resolver> {
    crate::jsc_hooks::dns_resolver().get_or_init(|| {
        let options = bun_dns_client::Options {
            timeout: None,
            max_timeout: None,
            tries: 4,
        };
        // The VM-global resolver serves every context of the realm.
        RefPtr::new(Resolver::setup(global_this.bun_vm(), None, options))
    })
}

bun_output::declare_scope!(DNSLookup, visible);
bun_output::declare_scope!(dns, hidden);
bun_output::declare_scope!(DNSResolver, visible);

// ──────────────────────────────────────────────────────────────────────────
// dns_sd (macOS): DNSServiceQueryRecord over one shared mDNSResponder connection, no per-lookup threads.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[path = "dns_sd.rs"]
pub(crate) mod dns_sd;

// ──────────────────────────────────────────────────────────────────────────
// resolver_pool (Windows): threads that block in getaddrinfo.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod resolver_pool {
    use std::sync::LazyLock;

    use bun_threading::fifo_pool::{Config, FifoPool};
    use bun_threading::work_pool::FilePool;

    pub(super) static SCRIPT_POOL: LazyLock<FifoPool> = LazyLock::new(|| {
        FifoPool::new(Config {
            // Follows a `UV_THREADPOOL_SIZE` that the script has assigned to `process.env`.
            max_threads: config().max_threads.max(FilePool::get().max_threads()),
            has_warmup: true,
            ..config()
        })
    });
    pub(super) static SOCKET_POOL: LazyLock<FifoPool> = LazyLock::new(|| FifoPool::new(config()));

    fn config() -> Config {
        Config {
            name: "DNS",
            max_threads: bun_core::get_thread_count().max(4).into(),
            stack_size: 1024 * 1024,
            on_thread_start: bun_core::Output::Source::configure_thread_no_js,
            has_warmup: false,
            keeps_idle_threads: false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// normalizeDNSName
// ──────────────────────────────────────────────────────────────────────────

fn normalize_dns_name<'a>(name: &'a [u8], backend: &mut GetAddrInfoBackend) -> &'a [u8] {
    if *backend == GetAddrInfoBackend::CAres {
        if internal::is_localhost_name(name) {
            *backend = GetAddrInfoBackend::System;
            return b"localhost";
        } else if name.ends_with(b".local") || ip_address::is_ipv6_address(name) {
            *backend = GetAddrInfoBackend::System;
        }
    }

    name
}

// ──────────────────────────────────────────────────────────────────────────
// LibC (blocking getaddrinfo on a worker thread)
// ──────────────────────────────────────────────────────────────────────────

mod lib_c {
    use super::*;
    use bun_jsc::job::{OwnedJob, Running};
    #[cfg(windows)]
    use bun_threading::Guarded;
    use core::convert::Infallible;
    #[cfg(windows)]
    use std::sync::Arc;

    pub(crate) fn start(
        this: &Resolver,
        query: GetAddrInfo,
        pending: PendingQuery,
        global: &JSGlobalObject,
    ) {
        let cx = global.js_thread(this.vm().root_context());
        let lookup = LibcLookup {
            backend: LibcBackend::Query(query),
        };
        let request = LibcRequest(Some(pending));
        #[cfg(windows)]
        bun_jsc::Job::<LibcLookup>::create(&cx, lookup, request, Arc::default()).run_inline();
        #[cfg(not(windows))]
        bun_jsc::Job::<LibcLookup>::schedule(&cx, lookup, request);
    }

    /// The blocking `getaddrinfo` of one libc-backend lookup, run on the pool (Windows: `resolver_pool`).
    struct LibcLookup {
        backend: LibcBackend,
    }

    /// The query a [`LibcLookup`] completes. If the VM tears down first, nothing is settled.
    struct LibcRequest(Option<PendingQuery>);
    // SAFETY: only the JS thread touches the query.
    unsafe impl bun_jsc::job::JsAffine for LibcRequest {}
    impl Drop for LibcRequest {
        fn drop(&mut self) {
            drop(self.0.take().map(PendingQuery::into_waiters));
        }
    }

    impl OwnedJob for LibcLookup {
        type OffThread = Self;
        type Js = LibcRequest;
        #[cfg(windows)]
        type Shared = Arc<Guarded<Option<Running<Self>>>>;
        #[cfg(not(windows))]
        type Shared = ();
        type Resume = Infallible;
        /// Lookups of the same name from any context wait on the one in flight.
        const OUTLIVES_SCRIPT: bool = true;
        #[cfg(windows)]
        fn run(mut job: Running<Self>) {
            let cancelled = LibcBackend::Err(bun_sys::windows::ws2_32::WSA_E_CANCELLED);
            let mut backend = core::mem::replace(&mut job.off().backend, cancelled);
            let can_block = backend.can_block();
            let slot = Arc::clone(job.shared());
            *slot.lock() = Some(job);
            let resolve = move || {
                if slot.lock().is_none() {
                    return;
                }
                backend.run();
                let job = slot.lock().take();
                if let Some(mut job) = job {
                    job.off().backend = backend;
                    job.finish();
                }
            };
            if can_block {
                resolver_pool::SCRIPT_POOL.go(resolve);
            } else {
                resolve();
            }
        }
        #[cfg(not(windows))]
        fn run(mut job: Running<Self>) {
            job.off().backend.run();
            job.finish();
        }
        fn resume(_: Running<Self>, with: Infallible) {
            match with {}
        }
        fn then(
            this: Self,
            mut request: LibcRequest,
            _: &bun_jsc::JsThread<'_>,
        ) -> bun_jsc::JsResult<()> {
            bun_output::scoped_log!(DNSLookup, "then");
            let query = request.0.take().expect("query");
            query.complete_native(match this.backend {
                LibcBackend::Success(list) => Ok(list),
                LibcBackend::Err(status) => Err(status),
                LibcBackend::Query(_) => unreachable!(),
            });
            Ok(())
        }
    }

    enum LibcBackend {
        Success(GetAddrInfoResultList),
        Err(i32),
        Query(GetAddrInfo),
    }

    #[cfg(windows)]
    impl LibcBackend {
        /// An address of the requested family needs no lookup.
        fn can_block(&self) -> bool {
            let LibcBackend::Query(query) = self else {
                unreachable!()
            };
            bun_core::ip_address::parse_strict(&query.name).is_none_or(|ip| {
                let other_family = if ip.is_ipv4() {
                    bun_dns::Family::Inet6
                } else {
                    bun_dns::Family::Inet
                };
                query.options.family == other_family
            })
        }

        fn run(&mut self) {
            let LibcBackend::Query(query) = self else {
                unreachable!()
            };
            let mut port_buf = [0u8; 5];
            let port = bun_fmt::int_as_bytes(&mut port_buf, query.port);
            let hints = query.options.to_libc();
            *self = match AddrInfoList::lookup(Some(&query.name), Some(port), hints.as_ref()) {
                Ok(list) => LibcBackend::Success(bun_dns::to_result_list(&list)),
                Err(err) => LibcBackend::Err(err),
            };
        }
    }

    #[cfg(not(windows))]
    impl LibcBackend {
        fn run(&mut self) {
            let LibcBackend::Query(query) = self else {
                unreachable!()
            };
            let query_name = core::mem::take(&mut query.name); // freed at end of scope
            let hints = query.options.to_libc();
            let mut port_buf = [0u8; 21];
            let port_z = bun_fmt::itoa_z(&mut port_buf, query.port.into());

            let mut hostname = bun_paths::path_buffer_pool::get();
            // Reserve the last byte for the NUL terminator so the index below
            // can never exceed the buffer even if the upstream length guard in
            // `doLookup` is bypassed.
            let cap = hostname.len() - 1;
            let copied_len = strings::copy(&mut hostname[..cap], &query_name).len();
            let host = ZStr::nul_terminate(&mut hostname, copied_len);
            let debug_timer = Output::DebugTimer::start();
            let result = AddrInfoList::lookup(Some(host), Some(port_z), hints.as_ref());
            sys::syslog!(
                "getaddrinfo({}, {}) = {} ({})",
                bstr::BStr::new(&query_name),
                bstr::BStr::new(port_z.as_bytes()),
                result.as_ref().err().unwrap_or(&0),
                debug_timer,
            );
            *self = match result {
                Ok(list) => LibcBackend::Success(bun_dns::to_result_list(&list)),
                Err(err) => LibcBackend::Err(err),
            };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DNSLookup
// ──────────────────────────────────────────────────────────────────────────

struct DNSLookup {
    global_this: bun_ptr::BackRef<JSGlobalObject>, // JSC_BORROW (BACKREF — JSGlobalObject outlives the request)
    promise: JSPromiseStrong,
    _keep_alive: JsKeepAlive,
    /// The context whose script asked: an answer for a stopped one settles nothing.
    context: bun_jsc::ContextId,
}

impl DNSLookup {
    fn init(global_this: &JSGlobalObject, context: bun_jsc::ContextId) -> Self {
        bun_output::scoped_log!(DNSLookup, "init");

        Self {
            global_this: bun_ptr::BackRef::new(global_this),
            _keep_alive: JsKeepAlive::active(),
            promise: JSPromiseStrong::init(global_this),
            context,
        }
    }
}

/// The lookups that one answer settles.
pub(crate) struct Waiters {
    name: Box<[u8]>,
    first: DNSLookup,
    joined: Vec<DNSLookup>,
    /// Of the event loop, in which it was asked.
    turn: u64,
}

/// Selects one of the resolver's pending caches.
#[derive(Copy, Clone, enum_map::Enum)]
enum QueryKind {
    HostClient,
    HostNative,
    Addr,
    NameInfo,
    Record(RecordType),
}

impl QueryKind {
    fn syscall(self) -> &'static [u8] {
        match self {
            Self::HostClient | Self::HostNative => b"getaddrinfo",
            Self::Addr => b"getHostByAddr",
            Self::NameInfo => b"getnameinfo",
            Self::Record(RecordType::A) => b"queryA",
            Self::Record(RecordType::AAAA) => b"queryAaaa",
            Self::Record(RecordType::ANY) => b"queryAny",
            Self::Record(RecordType::CAA) => b"queryCaa",
            Self::Record(RecordType::CNAME) => b"queryCname",
            Self::Record(RecordType::MX) => b"queryMx",
            Self::Record(RecordType::NAPTR) => b"queryNaptr",
            Self::Record(RecordType::NS) => b"queryNs",
            Self::Record(RecordType::PTR) => b"queryPtr",
            Self::Record(RecordType::SOA) => b"querySoa",
            Self::Record(RecordType::SRV) => b"querySrv",
            Self::Record(RecordType::TXT) => b"queryTxt",
        }
    }
}

const PENDING_CACHE_SLOTS: usize = 32;

/// The queries of one kind that are in flight, for later lookups of the same name to join.
struct PendingCache {
    used: Cell<IntegerBitSet<PENDING_CACHE_SLOTS>>,
    hashes: [Cell<u64>; PENDING_CACHE_SLOTS],
    /// Not dropped: only the VM-global resolver can go with entries left, at process exit.
    entries: ManuallyDrop<[Cell<Option<Box<Waiters>>>; PENDING_CACHE_SLOTS]>,
}

impl Default for PendingCache {
    fn default() -> Self {
        Self {
            used: Cell::new(IntegerBitSet::init_empty()),
            hashes: Default::default(),
            entries: Default::default(),
        }
    }
}

impl PendingCache {
    /// Gives `lookup` back if no query for `name` is in flight that was asked in `first_turn` or later.
    fn join(
        &self,
        hash: u64,
        name: &[u8],
        first_turn: u64,
        lookup: DNSLookup,
    ) -> Result<(), DNSLookup> {
        let mut used = self.used.get().iter_set();
        while let Some(slot) = used.next() {
            if self.hashes[slot].get() != hash {
                continue;
            }
            let mut waiters = self.entries[slot].take().expect("pending DNS slot");
            if *waiters.name == *name && waiters.turn >= first_turn {
                waiters.joined.push(lookup);
                self.entries[slot].set(Some(waiters));
                return Ok(());
            }
            self.entries[slot].set(Some(waiters));
        }
        Err(lookup)
    }

    /// Gives `waiters` back if every slot is in use.
    fn put(&self, hash: u64, waiters: Box<Waiters>) -> Result<usize, Box<Waiters>> {
        let mut used = self.used.get();
        let Some(slot) = used.iterator::<false, true>().next() else {
            return Err(waiters);
        };
        used.set(slot);
        self.used.set(used);
        self.hashes[slot].set(hash);
        self.entries[slot].set(Some(waiters));
        Ok(slot)
    }

    fn take(&self, slot: usize) -> Box<Waiters> {
        let waiters = self.entries[slot].take();
        let mut used = self.used.get();
        used.unset(slot);
        self.used.set(used);
        waiters.expect("pending DNS slot")
    }
}

enum QueryWaiters {
    /// Index in the `PendingCache` of the query's kind.
    Slot(usize),
    /// The `PendingCache` was full.
    Owned(Box<Waiters>),
}

/// A query in flight, owned by the backend that answers it.
pub(crate) struct PendingQuery {
    resolver: RefPtr<Resolver>,
    kind: QueryKind,
    waiters: QueryWaiters,
}

impl PendingQuery {
    /// The lookup's promise, and the query to send unless it joined one in flight.
    fn join_or_create(
        resolver: &RefPtr<Resolver>,
        kind: QueryKind,
        hash: u64,
        name: &[u8],
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> (JSValue, Option<Self>) {
        let lookup = DNSLookup::init(global_this, context);
        let promise = lookup.promise.value();
        let cache = &resolver.pending[kind];
        let turn = resolver.vm().uws_loop().iteration_number();
        let first_turn = match kind {
            QueryKind::HostNative => 0,
            // The client joins later ones, and can ask again for them.
            _ => turn,
        };
        let Err(first) = cache.join(hash, name, first_turn, lookup) else {
            return (promise, None);
        };
        let waiters = Box::new(Waiters {
            name: name.into(),
            first,
            joined: Vec::new(),
            turn,
        });
        let query = Self {
            resolver: resolver.clone(),
            kind,
            waiters: cache
                .put(hash, waiters)
                .map_or_else(QueryWaiters::Owned, QueryWaiters::Slot),
        };
        (promise, Some(query))
    }

    /// Removes the query from the pending cache: later lookups start a new one.
    fn into_waiters(self) -> Box<Waiters> {
        match self.waiters {
            QueryWaiters::Slot(slot) => self.resolver.pending[self.kind].take(slot),
            QueryWaiters::Owned(waiters) => waiters,
        }
    }

    /// `to_js` converts the answer once for each run of lookups in the same global.
    fn resolve(self, mut to_js: impl FnMut(&JSGlobalObject) -> JsResult<JSValue>) {
        let mut waiters = self.into_waiters();
        let mut joined = core::mem::take(&mut waiters.joined).into_iter();
        loop {
            let result = to_js(&waiters.first.global_this);
            if !Self::settle_run(result, &mut waiters.first, &mut joined) {
                break;
            }
        }
    }

    /// Settles `lookup` and those after it; `true` if it stopped at one of another global, now in `lookup`.
    fn settle_run(
        result: JsResult<JSValue>,
        lookup: &mut DNSLookup,
        joined: &mut std::vec::IntoIter<DNSLookup>,
    ) -> bool {
        let global = lookup.global_this;
        let outcome = Outcome::of(&global, result);
        loop {
            outcome.settle(&mut lookup.promise, &global, lookup.context);
            outcome.keep_alive();
            let Some(next) = joined.next() else {
                return false;
            };
            *lookup = next;
            if lookup.global_this != global {
                return true;
            }
        }
    }

    fn reject(self, err: Error) {
        let kind = self.kind;
        let with_hostname = !matches!(kind, QueryKind::HostClient | QueryKind::HostNative);
        let err = match (kind, err) {
            // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
            (QueryKind::HostClient, Error::ENODATA) => Error::ENOTFOUND,
            _ => err,
        };
        let Waiters {
            name,
            first,
            joined,
            ..
        } = *self.into_waiters();
        for lookup in core::iter::once(first).chain(joined) {
            answer_jsc::reject_later(
                lookup.promise,
                err,
                kind.syscall(),
                with_hostname.then_some(&name),
                &lookup.global_this,
                lookup.context,
            );
        }
    }

    /// Set the resolver's timer first: script can turn the loop or close the client from here.
    fn complete((query, answer): (Self, Answer)) {
        match answer {
            Ok(reply) => query.resolve(|global| answer_jsc::reply_to_js(&reply, global)),
            Err(err) => query.reject(err),
        }
    }

    /// The addresses or the status that the system's resolver answered with.
    pub(crate) fn complete_native(self, result: Result<GetAddrInfoResultList, i32>) {
        let list = match result.map_err(bun_dns::getaddrinfo_error) {
            Ok(list) => list,
            Err(Some(err)) => return self.reject(err),
            // No list and no error is an empty answer.
            Err(None) => Vec::new(),
        };
        self.resolver.update_timer();
        self.resolve(|global| super::options_jsc::results_to_js(&list, global));
    }
}

/// The converted answer for one global, shared by every waiter of a
/// pending-cache entry on that global. A conversion that threw is turned into
/// its exception value *once* (the first `reject(Err(Thrown))` would take it
/// off the VM and leave nothing for the next waiter); a termination settles
/// nobody.
#[derive(Clone, Copy)]
enum Outcome {
    Value(JSValue),
    Error(JSValue),
    Stopped,
}

impl Outcome {
    fn of(global: &JSGlobalObject, result: JsResult<JSValue>) -> Outcome {
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

    /// Reads `then` of the value, which can run script. The caller's loop scope, task or script drains the microtasks.
    fn settle(
        self,
        promise: &mut JSPromiseStrong,
        global: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) {
        let vm = global.bun_vm();
        if vm.test_isolation_enabled.get() && promise.value().is_from_retired_test_isolation_realm()
        {
            return;
        }
        // The lookup continues the script that asked for it.
        let _context = vm.enter_context(context);
        crate::dispatch::fold(match self {
            Outcome::Value(v) => promise.resolve(global, v),
            Outcome::Error(e) => promise.reject(global, Ok(e)),
            Outcome::Stopped => return,
        });
    }
}

impl Resolver {
    /// `Stopped` if the client was open. The VM, its polls and its timers have to be alive.
    pub(crate) fn close_client_for_terminate(
        self: &RefPtr<Self>,
    ) -> bun_jsc::virtual_machine::SweepResult {
        use bun_jsc::virtual_machine::SweepResult;
        let client = self.client.take();
        let result = if client.is_some() {
            SweepResult::Stopped
        } else {
            SweepResult::Idle
        };
        self.abort_handle.leave();
        self.request_completed(client.map(Client::close).unwrap_or_default());
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// internal — process-wide DNS cache used by usockets connect path
// ──────────────────────────────────────────────────────────────────────────

pub(crate) mod internal {
    use super::*;
    use crate::generated_bindgen::dns::DNSCacheStats;
    use bun_dns::Address;
    use bun_http::H3::PendingConnect;
    use bun_threading::Guarded;
    use core::sync::atomic::AtomicBool;
    use std::sync::{Arc, OnceLock};

    // PORTING.md §Global mutable state: lazy env-var memo — an `OnceLock<u32>`
    // (idempotent init, safe concurrent read).
    static MAX_DNS_TIME_TO_LIVE_SECONDS: OnceLock<u32> = OnceLock::new();

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
            if let Some(host) = self.host {
                let host_copy = bun::ZBox::from_bytes(host);
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

    /// `struct addrinfo_result`. Borrows the [`Request`] it was made from.
    #[repr(C)]
    pub(crate) struct RequestResult {
        entries: *const ResultEntry,
        error: c_int,
    }

    /// Shared by the cache, the lookup that fills it and the sockets that use or wait for it.
    pub(crate) struct Request {
        key: RequestKeyOwned,
        /// Set with `notify` locked.
        result: OnceLock<Result<Box<[ResultEntry]>, c_int>>,
        notify: Guarded<Vec<DNSRequestOwner>>,

        /// Seconds since the epoch when this request was created.
        /// Not a precise timestamp.
        created_at: u32,

        /// Only accessed with `GLOBAL_CACHE` locked, so `Relaxed` is enough.
        valid: AtomicBool,
    }

    impl Request {
        fn new(key: RequestKeyOwned, created_at: u32) -> Self {
            Self {
                key,
                result: OnceLock::new(),
                notify: Guarded::new(Vec::new()),
                created_at,
                valid: AtomicBool::new(true),
            }
        }

        fn is_valid(&self) -> bool {
            self.valid.load(Ordering::Relaxed)
        }

        fn is_expired(&self, timestamp_to_store: &mut u32) -> bool {
            if self.result.get().is_none() {
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

        /// Gives `owner` back if `result` is already set.
        fn join(&self, owner: DNSRequestOwner) -> Result<(), DNSRequestOwner> {
            let mut notify = self.notify.lock();
            if self.result.get().is_some() {
                return Err(owner);
            }
            notify.push(owner);
            Ok(())
        }
    }

    // ───────────── GlobalCache ─────────────

    const MAX_ENTRIES: usize = 256;

    /// The cache data guarded by `GLOBAL_CACHE`; the lock owns the data
    /// (PORTING.md §Concurrency).
    struct GlobalCache {
        cache: BoundedArray<Arc<Request>, MAX_ENTRIES>,
    }

    impl GlobalCache {
        const fn new() -> Self {
            Self {
                cache: BoundedArray::new(),
            }
        }

        fn get(
            &mut self,
            key: &RequestKey<'_>,
            timestamp_to_store: &mut u32,
        ) -> Option<&Arc<Request>> {
            let mut i: usize = 0;
            while let Some(entry) = self.cache.get(i) {
                if entry.key.matches(key) {
                    if entry.is_valid() && !entry.is_expired(timestamp_to_store) {
                        break;
                    }
                    bun_output::scoped_log!(dns, "get: stale entry");
                    if Self::is_unused(entry) {
                        self.delete_entry_at(i);
                        continue;
                    }
                }
                i += 1;
            }
            self.cache.get(i)
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
            self.cache.len() * 5 >= MAX_ENTRIES * 4
        }

        /// Only the cache holds `entry`.
        fn is_unused(entry: &Arc<Request>) -> bool {
            Arc::strong_count(entry) == 1
        }

        fn delete_entry_at(&mut self, i: usize) {
            let last = self.cache.len() - 1;
            self.cache.swap(i, last);
            self.cache.pop();
            DNS_CACHE_SIZE.store(last, Ordering::Relaxed);
        }

        fn remove(&mut self, entry: &Arc<Request>) {
            if let Some(i) = self.cache.iter().position(|e| Arc::ptr_eq(e, entry)) {
                self.delete_entry_at(i);
            }
        }

        fn try_push(&mut self, entry: Arc<Request>) -> bool {
            if self.cache.len() < MAX_ENTRIES {
                self.cache.append_assume_capacity(entry);
                return true;
            }
            // check if there is an element to evict
            let Some(unused) = self.cache.iter_mut().find(|e| Self::is_unused(e)) else {
                return false;
            };
            *unused = entry;
            true
        }
    }

    static GLOBAL_CACHE: Guarded<GlobalCache> = Guarded::new(GlobalCache::new());
    #[inline]
    fn global_cache() -> &'static Guarded<GlobalCache> {
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
    pub(super) fn is_localhost_name(host: &[u8]) -> bool {
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
        let addrs = [
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
        ]
        .map(|ip| Address::from_ip(ip, port));
        process_results(
            addrs
                .iter()
                .filter(|addr| family == netc::AF_UNSPEC || addr.family() == family)
                .map(Address::as_bytes),
        )
    }

    /// Chrome's `IsAllLocalhostOfOneFamily`: every address is loopback and only one family is present, the shape glibc's AI_ADDRCONFIG produces for a hosts-file loopback name (crbug 42058 / 49024).
    fn is_all_loopback_of_one_family<'a>(addrs: impl Iterator<Item = &'a [u8]>) -> bool {
        let mut families = addrs.map(family_of_loopback);
        let first = families.next().flatten();
        first.is_some() && families.all(|family| family == first)
    }

    unsafe extern "C" {
        fn us_internal_dns_callback_threadsafe(socket: *mut ConnectingSocket);
    }

    /// Each holds a ref on the [`Request`] that it waits for.
    enum DNSRequestOwner {
        Socket(*mut ConnectingSocket),
        Quic(PendingConnect),
    }

    // SAFETY: no VM state is read: `after_result_entries` only queues the socket for its loop's thread.
    unsafe impl Send for DNSRequestOwner {}

    #[repr(C)]
    pub(crate) struct ResultEntry {
        pub(crate) info: AddrInfo,
        /// A `sockaddr_storage` in C.
        addr: [u64; 16],
    }
    const _: () = assert!(size_of::<[u64; 16]>() == size_of::<SockaddrStorage>());
    const _: () = assert!(align_of::<[u64; 16]>() == align_of::<SockaddrStorage>());

    // SAFETY: `info` points only into the slice of entries that it is in.
    unsafe impl Send for ResultEntry {}
    // SAFETY: as above, and nothing writes through those pointers.
    unsafe impl Sync for ResultEntry {}

    // Pack getaddrinfo results into one allocation with address families
    // interleaved (RFC 8305 §4) so an unroutable family can never fill all
    // CONCURRENT_CONNECTIONS parallel connect attempts. See #4938 / #33278.
    fn process_results<'a>(addrs: impl Iterator<Item = &'a [u8]> + Clone) -> Box<[ResultEntry]> {
        let mut total = FamilyCounts::default();
        for addr in addrs.clone() {
            total.add(addr, 0);
        }
        let mut results = ResultEntry::zeroed_slice(total.first + total.other);
        let (mut placed, pairs) = (FamilyCounts::default(), total.first.min(total.other));
        for addr in addrs {
            results[placed.add(addr, pairs)].set_addr(addr);
        }
        link_results(results)
    }

    fn link_results(mut results: Box<[ResultEntry]>) -> Box<[ResultEntry]> {
        let mut next = ptr::null_mut();
        for entry in results.iter_mut().rev() {
            entry.info.ai_next = next;
            entry.info.ai_addr = (&raw mut entry.addr).cast::<Sockaddr>();
            next = &raw mut entry.info;
        }

        results
    }

    impl ResultEntry {
        fn zeroed_slice(len: usize) -> Box<[Self]> {
            let zeroed = |_| Self {
                info: bun_core::ffi::zeroed(),
                addr: [0; 16],
            };
            (0..len).map(zeroed).collect()
        }

        /// uSockets reads `ai_family`, `ai_addrlen`, `ai_addr` and `ai_next`.
        fn set_addr(&mut self, addr: &[u8]) {
            let storage = bun_core::bytes_of_mut(&mut self.addr);
            let len = addr.len().min(storage.len());
            self.info.ai_family = family_of(addr);
            self.info.ai_addrlen = len as _;
            if let netc::AF_INET | netc::AF_INET6 = self.info.ai_family {
                storage[..len].copy_from_slice(&addr[..len]);
            }
        }
    }

    /// The family has the same offset in every sockaddr.
    fn family_of(addr: &[u8]) -> c_int {
        bun_core::read_prefix::<netc::sockaddr_in>(addr)
            .map_or(netc::AF_UNSPEC, |addr| addr.sin_family.into())
    }

    /// `None` unless `addr` is a loopback address.
    fn family_of_loopback(addr: &[u8]) -> Option<c_int> {
        let family = family_of(addr);
        let ip = match family {
            netc::AF_INET => bun_core::read_prefix::<netc::sockaddr_in>(addr)
                .map(|v4| IpAddr::from(v4.sin_addr.s_addr.to_ne_bytes())),
            netc::AF_INET6 => bun_core::read_prefix::<netc::sockaddr_in6>(addr)
                .map(|v6| IpAddr::from(v6.sin6_addr.s6_addr)),
            _ => None,
        };
        ip?.is_loopback().then_some(family)
    }

    /// Addresses of the family that comes first, and of any other.
    #[derive(Default)]
    struct FamilyCounts {
        first_family: Option<c_int>,
        first: usize,
        other: usize,
    }

    impl FamilyCounts {
        /// Counts `addr`, and returns its index in a list whose first `pairs` pairs have one of each.
        fn add(&mut self, addr: &[u8], pairs: usize) -> usize {
            let family = family_of(addr);
            let is_other = *self.first_family.get_or_insert(family) != family;
            let count = if is_other {
                &mut self.other
            } else {
                &mut self.first
            };
            let i = *count;
            *count += 1;
            if i < pairs {
                2 * i + usize::from(is_other)
            } else {
                pairs + i
            }
        }
    }

    fn after_result_entries(req: Arc<Request>, result: Result<Box<[ResultEntry]>, c_int>) {
        let guard = global_cache().lock();
        let mut notify = req.notify.lock();
        let _ = req.result.set(result);
        for query in notify.drain(..) {
            match query {
                // SAFETY: the contract of `Bun__addrinfo_set`. `Bun__addrinfo_cancel` waits for `notify`,
                // and `Bun__addrinfo_freeRequest` for `guard`.
                DNSRequestOwner::Socket(socket) => unsafe {
                    us_internal_dns_callback_threadsafe(socket)
                },
                DNSRequestOwner::Quic(pc) => pc.on_dns_resolved_threadsafe(),
            }
        }
        notify.shrink_to_fit();
        drop(notify);
        // Before the unlock: `Bun__addrinfo_freeRequest` evicts only if its ref and the cache's are the last two.
        drop(req);
        drop(guard);
    }

    fn work_pool_callback(req: Arc<Request>) {
        let mut service_buf = [0u8; 21];
        let key = &req.key;
        let host = key.host.as_deref();
        let service = (key.port > 0).then(|| bun_fmt::itoa_z(&mut service_buf, key.port as u64));

        #[cfg(windows)]
        let result = {
            let mut hints: AddrInfo = bun_core::ffi::zeroed();
            hints.ai_family = netc::AF_UNSPEC;
            hints.ai_socktype = netc::SOCK_STREAM;
            let host = host.map(ZStr::as_bytes);
            let service = service.map(ZStr::as_bytes);
            AddrInfoList::lookup(host, service, Some(&hints))
        };
        #[cfg(not(windows))]
        let result = {
            let mut hints = get_hints();
            let mut result = AddrInfoList::lookup(host, service, Some(&hints));

            // Chrome's retries: AI_ADDRCONFIG left nothing, or only one family's loopback.
            if (hints.ai_flags & netc::AI_ADDRCONFIG) != 0
                && match &result {
                    Ok(list) => is_all_loopback_of_one_family(list.addresses()),
                    Err(err) => *err == netc::EAI_NONAME,
                }
            {
                hints.ai_flags &= !netc::AI_ADDRCONFIG;
                let unfiltered = AddrInfoList::lookup(host, service, Some(&hints));
                if unfiltered.is_ok() || result.is_err() {
                    result = unfiltered;
                }
            }
            result
        };
        after_result_entries(req, result.map(|list| process_results(list.addresses())));
    }

    #[cfg(target_os = "macos")]
    fn lookup_dns_sd(req: Arc<Request>, loop_: *const Loop) -> Result<(), Arc<Request>> {
        use bun_uws::InternalLoopDataExt as _;

        if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO
            .get()
            .unwrap_or(false)
        {
            return Err(req);
        }
        let Some(host) = &req.key.host else {
            // Null host: fall through to getaddrinfo(NULL, service) on the work pool.
            return Err(req);
        };
        // SAFETY: `loop_` is the live uSockets loop; `EventLoopHandle::set_as_parent_of` set its parent.
        let handle = unsafe {
            let (tag, ptr) = (*loop_).internal_loop_data.get_parent();
            jsc::EventLoopHandle::from_tag_ptr(tag, ptr)
        };
        let Some(mut shared) = dns_sd::SharedConnection::get(
            crate::api::bun::process::event_loop_handle_to_ctx(handle),
        ) else {
            return Err(req);
        };

        let protocol = dns_sd::protocol_for_hints(&get_hints());
        let Some(query) = shared.start(protocol, host.clone()) else {
            return Err(req);
        };
        shared.track(query, dns_sd::Request::Internal(req));
        Ok(())
    }

    /// Complete an internal request through `process_results` (happy-eyeballs order).
    #[cfg(target_os = "macos")]
    pub(super) fn dns_sd_complete(req: Arc<Request>, results: &mut [GetAddrInfoResult]) {
        if results.is_empty() {
            after_result_entries(req, Err(dns_sd::EMPTY_STATUS));
            return;
        }

        for result in results.iter_mut() {
            result.address.set_port(req.key.port);
        }
        let results = process_results(results.iter().map(|result| result.address.as_bytes()));
        after_result_entries(req, Ok(results));
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
    ) -> JsResult<Vec<Address>> {
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
                    Some(ip) => Ok(Address::from_ip(ip, 0)),
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

    /// `bun:internal-for-testing`: [`is_all_loopback_of_one_family`] over `addresses`.
    pub(crate) fn is_all_loopback_of_one_family_for_testing<'a>(
        cx: &mut JsScope<'a>,
        addresses: JsLocal<'a>,
    ) -> JsResult<bool> {
        let addrs = addresses_for_testing(cx.global(), addresses.to_js())?;
        Ok(is_all_loopback_of_one_family(
            addrs.iter().map(Address::as_bytes),
        ))
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
        let addrs = addresses_for_testing(global, addresses.to_js())?;
        if addrs.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!("addresses must not be empty")));
        }
        let results = process_results(addrs.iter().map(Address::as_bytes));

        let mut families = [0i32; MAX_ADDRESSES_FOR_TESTING];
        for (family, entry) in families.iter_mut().zip(results.iter()) {
            *family = if entry.info.ai_family == netc::AF_INET6 {
                6
            } else {
                4
            };
        }
        let families = families.into_iter().take(results.len());

        let key = RequestKey::init(Some(hostname), 0);
        let req = Request {
            result: Ok(results).into(),
            ..Request::new(key.to_owned(), GlobalCache::get_cache_timestamp())
        };
        let mut guard = global_cache().lock();
        if !guard.try_push(Arc::new(req)) {
            drop(guard);
            return Err(global.throw_invalid_arguments(format_args!("DNS cache is full")));
        }
        DNS_CACHE_SIZE.store(guard.cache.len(), Ordering::Relaxed);
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
        let Some(rc) = bun_dns::getaddrinfo_status_by_name(code) else {
            return Err(global.throw_invalid_arguments(format_args!(
                "unknown getaddrinfo status name: {}",
                bstr::BStr::new(code)
            )));
        };
        match bun_dns::getaddrinfo_error(rc) {
            Some(err) => crate::dns_jsc::answer_jsc::error_to_js_with_syscall_and_hostname(
                err,
                global,
                b"getaddrinfo",
                hostname,
            ),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    /// A prefetch passes `None` for `is_cache_hit` and gets no ref.
    fn getaddrinfo(
        loop_: *const Loop,
        host: Option<&[u8]>,
        port: u16,
        is_cache_hit: Option<&mut bool>,
    ) -> Option<Arc<Request>> {
        #[cfg(windows)]
        let ascii_host = host.and_then(bun_dns::to_ascii);
        #[cfg(windows)]
        let host = ascii_host.as_deref().or(host);
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
                let is_cache_hit = is_cache_hit?;

                if entry.result.get().is_some() {
                    *is_cache_hit = true;
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

                return Some(Arc::clone(entry));
            }
        }

        // no cache hit, we have to make a new request
        let req = Arc::new(Request::new(
            key.to_owned(),
            // Seconds since when this request was created
            if timestamp_to_store == 0 {
                GlobalCache::get_cache_timestamp()
            } else {
                timestamp_to_store
            },
        ));

        let _ = guard.try_push(Arc::clone(&req));
        let caller_ref = is_cache_hit.is_some().then(|| Arc::clone(&req));
        DNS_CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
        DNS_CACHE_SIZE.store(guard.cache.len(), Ordering::Relaxed);
        drop(guard);

        if host.is_some_and(|h| !bun_dns::is_valid_hostname(h)) {
            bun_output::scoped_log!(
                dns,
                "getaddrinfo({}) = cache miss (not a hostname)",
                bstr::BStr::new(host.unwrap_or(b""))
            );
            after_result_entries(req, Err(netc::EAI_NONAME));
            if let Some(is_cache_hit) = is_cache_hit {
                *is_cache_hit = true;
            }
            return caller_ref;
        }

        if host.is_some_and(is_localhost_name) {
            bun_output::scoped_log!(
                dns,
                "getaddrinfo({}) = cache miss (localhost)",
                bstr::BStr::new(host.unwrap_or(b""))
            );
            after_result_entries(req, Ok(localhost_results(port)));
            if let Some(is_cache_hit) = is_cache_hit {
                *is_cache_hit = true;
            }
            return caller_ref;
        }

        // if dns_sd is unavailable, fall back to the work pool
        #[cfg(target_os = "macos")]
        let Err(req) = lookup_dns_sd(req, loop_) else {
            bun_output::scoped_log!(
                dns,
                "getaddrinfo({}) = cache miss (dns_sd)",
                bstr::BStr::new(host.unwrap_or(b""))
            );
            return caller_ref;
        };
        #[cfg(not(target_os = "macos"))]
        let _ = loop_;

        bun_output::scoped_log!(
            dns,
            "getaddrinfo({}) = cache miss (libc)",
            bstr::BStr::new(host.unwrap_or(b""))
        );
        run_on_work_pool(req);
        caller_ref
    }

    /// getaddrinfo() on the work pool (Windows: `resolver_pool`); the result reaches every waiter through
    /// the global cache, whichever thread asked. Also how a lookup whose
    /// per-thread mDNSResponder connection went away with its thread is
    /// finished (see `SharedConnection::close_for_terminate`).
    pub(super) fn run_on_work_pool(req: Arc<Request>) {
        #[cfg(windows)]
        resolver_pool::SOCKET_POOL.go(move || work_pool_callback(req));
        #[cfg(not(windows))]
        let _ = bun_threading::work_pool::WorkPool::go(req, work_pool_callback);
    }

    pub(crate) fn prefetch_from_js(hostname: &[u8], port: u16) {
        let loop_: &Loop = VirtualMachine::get().uws_loop();
        prefetch(loop_, Some(hostname), port);
    }

    pub(crate) fn prefetch(loop_: *const Loop, hostname: Option<&[u8]>, port: u16) {
        let _ = getaddrinfo(loop_, hostname, port, None);
    }

    /// `bun_dns::__bun_dns_prefetch` body — declared `extern "Rust"` in the
    /// lower-tier `bun_dns` crate so `bun_install` can prefetch registry
    /// hostnames without a crate cycle. Link-time resolved.
    #[unsafe(no_mangle)]
    fn __bun_dns_prefetch(loop_: *const c_void, hostname: &[u8], port: u16) {
        let host = (!hostname.is_empty()).then_some(hostname);
        prefetch(loop_.cast::<Loop>(), host, port);
    }

    /// Writes a ref to `request`, for `Bun__addrinfo_freeRequest`. SAFETY: `loop_` is live.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__addrinfo_get(
        loop_: *mut Loop,
        host: Option<bun_core::CStrRef<'_>>,
        port: u16,
        request: &mut MaybeUninit<*const Request>,
    ) -> c_int {
        let host = host.map(|host| host.to_cstr().to_bytes());
        let mut is_cache_hit = false;
        let req = getaddrinfo(loop_, host, port, Some(&mut is_cache_hit)).unwrap();
        request.write(Arc::into_raw(req));
        if is_cache_hit { 0 } else { 1 }
    }

    /// SAFETY: on the thread of `socket`'s loop. `socket` lives until it is notified or has cancelled, and
    /// the loop until `Bun__addrinfo_cancel` or `Bun__addrinfo_freeRequest` has returned for `socket`.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__addrinfo_set(request: &Request, socket: *mut ConnectingSocket) {
        if request.join(DNSRequestOwner::Socket(socket)).is_err() {
            // Also wakes the loop: this can run inside the dns_ready_head drain itself.
            // SAFETY: caller contract.
            unsafe { us_internal_dns_callback_threadsafe(socket) };
        }
    }

    /// 0 once there is a result: `socket` is queued on its loop, and the lookup is done with that loop.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__addrinfo_cancel(request: &Request, socket: *mut ConnectingSocket) -> c_int {
        let mut notify = request.notify.lock();
        let Some(i) = notify
            .iter()
            .position(|item| matches!(item, DNSRequestOwner::Socket(s) if *s == socket))
        else {
            return 0;
        };
        notify.swap_remove(i);
        1
    }

    /// SAFETY: `req` is a ref from `Bun__addrinfo_get`, given back once.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__addrinfo_freeRequest(req: *const Request, err: c_int) {
        let mut guard = global_cache().lock();
        // SAFETY: caller contract. `req` drops before `guard`, so the next lock holder reads the lowered count.
        let req = unsafe { Arc::from_raw(req) };

        if err != 0 {
            req.valid.store(false, Ordering::Relaxed);
        }
        DNS_CACHE_ERRORS.fetch_add((err != 0) as usize, Ordering::Relaxed);

        // 2: `req` and the cache's ref.
        if Arc::strong_count(&req) == 2 && (guard.is_nearly_full() || !req.is_valid()) {
            bun_output::scoped_log!(dns, "cache --");
            guard.remove(&req);
        }
    }

    /// Panics if `req` has no result yet.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__addrinfo_getRequestResult(req: &Request) -> RequestResult {
        match req.result.get().unwrap() {
            Ok(entries) => RequestResult {
                // Empty if no `addrinfo` had an address.
                entries: entries.first().map_or(ptr::null(), ptr::from_ref),
                error: 0,
            },
            Err(error) => RequestResult {
                entries: ptr::null(),
                error: *error,
            },
        }
    }

    /// QUIC analogue of `Bun__addrinfo_set`, declared in `bun_http`.
    #[unsafe(no_mangle)]
    fn __bun_dns_register_quic(pc: PendingConnect) {
        // SAFETY: `pc` holds this ref from `Bun__addrinfo_get` until `on_dns_resolved`.
        let request = unsafe { &*pc.addrinfo().cast::<Request>() };
        if let Err(DNSRequestOwner::Quic(pc)) = request.join(DNSRequestOwner::Quic(pc)) {
            pc.on_dns_resolved();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Resolver — JSC-exposed `dns.Resolver` (a JSDNSResolver holds a ref)
// ──────────────────────────────────────────────────────────────────────────

type Client = bun_dns_client::Client<Os<DnsPoll>, PendingQuery>;

/// `DNSResolver`, declared in `dns_internals.bind.ts`.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct Resolver {
    pub(crate) ref_count: bun_ptr::RefCount<Resolver>,
    /// Borrowed for no longer than a call into it, which runs no script.
    client: JsCell<Option<Client>>,
    /// The context whose script made the resolver: its client is that context's, whoever is first
    /// to query. `None`: the VM-global one, which is the realm's whatever the realm's context is
    /// called by then (`bun test --isolate` renews it for every file).
    made_in: Option<bun_jsc::ContextId>,
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine>, // JSC_BORROW (BACKREF — VirtualMachine outlives the resolver; read-only after init)
    options: bun_dns_client::Options,

    pub(crate) event_loop_timer: EventLoopTimer,
    /// Held while the timer is armed.
    pub(crate) timer_ref: Cell<Option<RefPtr<Resolver>>>,

    pending: enum_map::EnumMap<QueryKind, PendingCache>,

    /// Armed while the client is open: its queries need the context that opened it, which closes it if nobody did before.
    pub(crate) abort_handle: bun_jsc::AbortHandle,
}

bun_event_loop::impl_timer_owner!(Resolver; from_timer_ptr => event_loop_timer);

bun_jsc::impl_abort_handle_owner!(Resolver, abort_handle, |this, _cause| {
    // SAFETY: trait contract.
    let _ = unsafe { RefPtr::init_ref(this) }.close_client_for_terminate();
});

/// The resolver whose client has the polls.
struct PollOwner(*mut Resolver);

#[cfg(not(windows))]
struct DnsPoll(bun_io::OwnedFilePoll);

#[cfg(not(windows))]
impl bun_dns::os::Poll for DnsPoll {
    type Owner = PollOwner;

    fn open(owner: &PollOwner, socket: Fd) -> Option<Self> {
        let owner = bun_io::Owner::new(bun_io::PollTag::DnsResolver, owner.0.cast());
        // SAFETY: the poll becomes a part of its owner.
        let poll = unsafe { bun_io::OwnedFilePoll::new(bun_io::js_vm_ctx(), socket, owner) };
        Some(Self(poll))
    }

    fn watch(&self, writable: bool) {
        // There is no way to drop one direction and keep the other.
        if self.0.has_flag(bun_io::PollFlag::PollWritable) {
            let _ = self.0.unregister(false);
        }
        if !self.0.has_flag(bun_io::PollFlag::PollReadable) {
            let _ = self.0.register(bun_io::PollKind::Readable, false);
        }
        if writable {
            let _ = self.0.register(bun_io::PollKind::Writable, false);
        }
    }
}

#[cfg(windows)]
struct DnsPoll {
    registration: bun_iocp::SocketRegistration,
    _loop_ref: bun_iocp::LoopRef,
}

#[cfg(windows)]
impl DnsPoll {
    const READ: Readiness = Readiness::RECEIVE
        .union(Readiness::DISCONNECT)
        .union(Readiness::ABORT);
    const WRITE: Readiness = Readiness::SEND.union(Readiness::CONNECT_FAIL);
}

#[cfg(windows)]
impl bun_dns::os::Poll for DnsPoll {
    type Owner = PollOwner;

    fn open(owner: &PollOwner, socket: Fd) -> Option<Self> {
        let (resolver, socket) = (owner.0, bun_dns::os::socket_id(socket));
        let on_ready = move |ready: Readiness| {
            let events = Events {
                readable: ready.intersects(Self::READ | Readiness::POLL_FAILED),
                writable: ready.intersects(Self::WRITE),
                failed: ready.contains(Readiness::POLL_FAILED),
            };
            // SAFETY: the registration is a part of `resolver`, so it is live when this runs.
            unsafe { RefPtr::init_ref(resolver) }.on_dns_poll(socket, events);
        };
        let handler = bun_iocp::ReadinessHandler::Callback(std::rc::Rc::new(on_ready));
        let port = Loop::get().port();
        let registration = bun_iocp::SocketRegistration::new(port, socket, handler).ok()?;
        let loop_ref = bun_iocp::LoopRef::new(port);
        loop_ref.set(true);
        Some(Self {
            registration,
            _loop_ref: loop_ref,
        })
    }

    fn watch(&self, writable: bool) {
        let mut interest = Self::READ;
        interest.set(Self::WRITE, writable);
        self.registration.set_interest(interest);
    }
}

pub(crate) use bun_dns::Order;

bun_core::comptime_string_map! {
    static RECORD_TYPE_MAP: RecordType = {
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

fn throw_invalid_ip(global: &JSGlobalObject, address: &[u8]) -> jsc::JsError {
    let address = bstr::BStr::new(address);
    jsc::Error::INVALID_IP_ADDRESS.throw(global, format_args!("Invalid IP address: \"{address}\""))
}

/// What Node.js takes for `reverse()` and `setLocalAddress()`.
fn parse_address(text: &[u8]) -> Option<IpAddr> {
    ip_address::parse_uv_inet_pton(text).filter(|_| !strings::contains_char(text, 0))
}

impl Resolver {
    pub(crate) fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    fn setup(
        vm: &VirtualMachine,
        made_in: Option<bun_jsc::ContextId>,
        options: bun_dns_client::Options,
    ) -> Self {
        Self {
            ref_count: bun_ptr::RefCount::init(),
            client: JsCell::new(None),
            made_in,
            vm: bun_ptr::BackRef::new(vm),
            options,
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::DNSResolver),
            timer_ref: Cell::new(None),
            pending: Default::default(),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Resolver>(),
        }
    }

    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    // ───────────── timer / pending bookkeeping ─────────────

    pub(crate) fn check_timeouts(self: RefPtr<Self>, vm: &VirtualMachine) {
        self.event_loop_timer
            .state
            .set(EventLoopTimerState::PENDING);
        crate::jsc_hooks::timer_all().increment_timer_ref(-1, vm.uws_loop());

        if self.next_check().is_some() {
            let _exit = vm.enter_event_loop_scope();
            let answers = self.with_client(Client::process_timeouts);
            self.update_timer();
            answers.into_iter().for_each(PendingQuery::complete);
        }
    }

    /// Joins the query in flight for `name`, or has `send` hand a new one to the client.
    fn ask(
        self: &RefPtr<Self>,
        kind: QueryKind,
        hash: u64,
        name: &[u8],
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
        send: impl FnOnce(&mut Client, PendingQuery) -> Answers<PendingQuery>,
    ) -> JSValue {
        let (promise, query) =
            PendingQuery::join_or_create(self, kind, hash, name, global_this, context);
        if let Some(query) = query {
            self.request_sent(self.with_client(|client| send(client, query)));
        }
        promise
    }

    fn request_sent(self: &RefPtr<Self>, answers: Answers<PendingQuery>) {
        // If it was answered inside the call (cache, hosts file, error), that takes a turn of the loop as in Node.
        let now = || bun::timespec::now(bun::TimespecMockMode::ForceRealTime);
        self.add_timer(self.next_check().unwrap_or_else(now));
        answers.into_iter().for_each(PendingQuery::complete);
    }

    fn request_completed(self: &RefPtr<Self>, answers: Answers<PendingQuery>) {
        self.update_timer();
        answers.into_iter().for_each(PendingQuery::complete);
    }

    fn update_timer(self: &RefPtr<Self>) {
        if let Some(next) = self.next_check() {
            self.add_timer(next);
        } else {
            self.remove_timer();
        }
    }

    fn add_timer(self: &RefPtr<Self>, next: bun::timespec) {
        if self.event_loop_timer.state.get() == EventLoopTimerState::ACTIVE
            && !self.event_loop_timer.next.get().greater(&next)
        {
            return;
        }

        self.remove_timer();
        self.timer_ref.set(Some(self.clone()));
        self.event_loop_timer.next.set(next);
        let uws_loop = self.vm().uws_loop();
        let timers = crate::jsc_hooks::timer_all();
        timers.increment_timer_ref(1, uws_loop);
        timers.insert(&raw const self.event_loop_timer);
    }

    fn remove_timer(self: &RefPtr<Self>) {
        if self.event_loop_timer.state.get() != EventLoopTimerState::ACTIVE {
            return;
        }

        let timers = crate::jsc_hooks::timer_all();
        timers.remove(&self.event_loop_timer);
        // Normally checkTimeouts does this, so we have to be sure to do it ourself if we cancel the timer
        timers.increment_timer_ref(-1, self.vm().uws_loop());
        self.timer_ref.set(None);
    }

    fn next_check(&self) -> Option<bun::timespec> {
        let next = self.client.get().as_ref()?.next_check()?;
        Some(bun::timespec {
            sec: next.as_secs() as i64,
            nsec: next.subsec_nanos().into(),
        })
    }

    /// Opens it if it is closed.
    fn with_client<T>(&self, call: impl FnOnce(&mut Client) -> T) -> T {
        self.client
            .with_mut(|client| call(client.get_or_insert_with(|| self.open_client())))
    }

    #[cold]
    fn open_client(&self) -> Client {
        let context = match self.made_in {
            Some(made_in) => self.vm.context_of(made_in),
            None => self.vm.root_context(),
        };
        // SAFETY: it stays in its box, and the handle is disarmed when it drops.
        unsafe { bun_jsc::AbortHandle::arm_owner(self.as_ctx_ptr(), context) };
        Client::new(Os::new(PollOwner(self.as_ctx_ptr())), self.options)
    }

    // ───────────── poll callbacks ─────────────

    pub(crate) fn on_dns_poll(self: RefPtr<Self>, socket: SocketId, events: Events) {
        let _exit = self.vm().enter_event_loop_scope();
        self.request_completed(self.with_client(|client| client.process(socket, events)));
    }
}

macro_rules! resolve_record_fns {
    ($($global:ident, $method:ident, $js_name:literal => $record:ident;)+) => {$(
        pub(crate) fn $global(cx: &mut JsScope<'_>, name: &[u8]) -> JsResult<JSValue> {
            global_resolver(cx.global()).$method(cx, name)
        }

        pub(crate) fn $method(self: &RefPtr<Self>, cx: &mut JsScope<'_>, name: &[u8]) -> JsResult<JSValue> {
            self.resolve_hostname(cx.global(), $js_name, RecordType::$record, name)
        }
    )+};
}

impl Resolver {
    resolve_record_fns! {
        global_resolve_any, resolve_any, "resolveAny" => ANY;
        global_resolve_caa, resolve_caa, "resolveCaa" => CAA;
        global_resolve_cname, resolve_cname, "resolveCname" => CNAME;
        global_resolve_mx, resolve_mx, "resolveMx" => MX;
        global_resolve_naptr, resolve_naptr, "resolveNaptr" => NAPTR;
        global_resolve_ns, resolve_ns, "resolveNs" => NS;
        global_resolve_ptr, resolve_ptr, "resolvePtr" => PTR;
        global_resolve_soa, resolve_soa, "resolveSoa" => SOA;
        global_resolve_srv, resolve_srv, "resolveSrv" => SRV;
        global_resolve_txt, resolve_txt, "resolveTxt" => TXT;
    }

    fn resolve_hostname(
        self: &RefPtr<Self>,
        global_this: &JSGlobalObject,
        js_name: &'static str,
        record: RecordType,
        name: &[u8],
    ) -> JsResult<JSValue> {
        // An empty name asks the root zone.
        if name.is_empty() && !matches!(record, RecordType::NS | RecordType::SOA) {
            return Err(global_this.throw_invalid_argument_type(
                js_name,
                "hostname",
                "non-empty string",
            ));
        }
        Ok(self.resolve_record(global_this, record, name))
    }

    fn resolve_record(
        self: &RefPtr<Self>,
        global_this: &JSGlobalObject,
        record: RecordType,
        name: &[u8],
    ) -> JSValue {
        let context = global_this.bun_vm().context_of_caller().id();
        let (kind, hash) = (QueryKind::Record(record), wyhash(name));
        self.ask(kind, hash, name, global_this, context, |client, query| {
            client.resolve(record, name, query)
        })
    }

    pub(crate) fn global_resolve(
        cx: &mut JsScope<'_>,
        name: &[u8],
        record: Option<&[u8]>,
    ) -> JsResult<JSValue> {
        global_resolver(cx.global()).resolve(cx, name, record)
    }

    pub(crate) fn resolve(
        self: &RefPtr<Self>,
        cx: &mut JsScope<'_>,
        name: &[u8],
        record: Option<&[u8]>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let record_type = match record {
            None | Some(b"") => RecordType::A,
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

        Ok(self.resolve_record(global_this, record_type, name))
    }

    pub(crate) fn global_reverse(cx: &mut JsScope<'_>, ip: &[u8]) -> JsResult<JSValue> {
        global_resolver(cx.global()).reverse(cx, ip)
    }

    pub(crate) fn reverse(
        self: &RefPtr<Self>,
        cx: &mut JsScope<'_>,
        ip: &[u8],
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let context = global_this.bun_vm().context_of_caller().id();
        if ip.is_empty() {
            return Err(global_this.throw_invalid_argument_type(
                "reverse",
                "ip",
                "non-empty string",
            ));
        }

        let send = |client: &mut Client, query| match parse_address(ip) {
            Some(ip) => client.reverse(ip, query),
            None => vec![(query, Err(Error::ENOTIMP))],
        };
        Ok(self.ask(QueryKind::Addr, wyhash(ip), ip, global_this, context, send))
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

    fn do_lookup(
        self: &RefPtr<Self>,
        name: &[u8],
        port: u16,
        options: GetAddrInfoOptions,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) -> JsResult<JSValue> {
        #[cfg(windows)]
        let ascii_name = bun_dns::to_ascii(name);
        #[cfg(windows)]
        let name = ascii_name.as_deref().unwrap_or(name);
        if !bun_dns::is_valid_hostname(name) {
            let promise = JSPromiseStrong::init(global_this);
            let promise_value = promise.value();
            answer_jsc::reject_later(
                promise,
                Error::ENOTFOUND,
                b"getaddrinfo",
                Some(name),
                global_this,
                context,
            );
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

        if opts.backend == GetAddrInfoBackend::CAres {
            let (kind, hash) = (QueryKind::HostClient, query.hash());
            let send = |client: &mut Client, it| client.lookup(&query.name, opts.family, it);
            return Ok(self.ask(kind, hash, &query.name, global_this, context, send));
        }

        // The result is posted to the loop of the first lookup, and only the macro loop ticks while a macro runs.
        let hash = query.hash() ^ self.vm().current_loop_kind() as u64;
        let kind = QueryKind::HostNative;
        let (promise, pending) =
            PendingQuery::join_or_create(self, kind, hash, &query.name, global_this, context);
        let Some(pending) = pending else {
            return Ok(promise);
        };
        #[cfg(target_os = "macos")]
        let pending = match opts.backend {
            GetAddrInfoBackend::System => match dns_sd::start(&query, pending) {
                Ok(()) => return Ok(promise),
                Err(refused) => refused,
            },
            _ => pending,
        };
        lib_c::start(self, query, pending, global_this);
        Ok(promise)
    }

    // ───────── servers / local address ─────────

    pub(crate) fn get_global_servers(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        global_resolver(cx.global()).get_servers(cx)
    }

    pub(crate) fn get_servers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        let servers: Vec<SocketAddr> = self.with_client(|client| client.servers().collect());
        let values = JSValue::create_empty_array(global_this, 0)?;

        for (i, server) in (0u32..).zip(servers) {
            let (ip, port) = (IpText::new(server.ip()), server.port());
            // https://nodejs.org/api/dns.html#dnsgetservers
            let server = if port == DEFAULT_PORT {
                bun::String::clone_latin1(&ip)
            } else if server.is_ipv6() {
                bun::String::create_format(format_args!("[{ip}]:{port}"))
            } else {
                bun::String::create_format(format_args!("{ip}:{port}"))
            };
            values.put_index(global_this, i, server.into_js(global_this)?)?;
        }

        Ok(values)
    }

    pub(crate) fn set_local_address(
        &self,
        cx: &mut JsScope<'_>,
        first: &bun_core::String,
        second: Option<bun_core::String>,
    ) -> JsResult<()> {
        let global_this = cx.global();
        let set = |value: &bun_core::String| {
            let ip = parse_address(&value.to_utf8()).ok_or_else(|| {
                let message = format_args!("Invalid IP address.");
                jsc::Error::INVALID_ARG_VALUE.throw(global_this, message)
            })?;
            self.with_client(|client| client.set_local_ip(ip));
            JsResult::Ok(ip)
        };

        let first = set(first)?;
        match (first, second.map(|second| set(&second)).transpose()?) {
            (IpAddr::V4(_), Some(IpAddr::V4(_))) => Err(global_this
                .throw_invalid_arguments(format_args!("Cannot specify two IPv4 addresses."))),
            (IpAddr::V6(_), Some(IpAddr::V6(_))) => Err(global_this
                .throw_invalid_arguments(format_args!("Cannot specify two IPv6 addresses."))),
            _ => Ok(()),
        }
    }

    /// Runs script: the elements are coerced.
    fn servers_from_js(
        global_this: &JSGlobalObject,
        argument: JSValue,
    ) -> JsResult<Vec<(IpAddr, u16)>> {
        if !argument.is_array() {
            return Err(global_this.throw_invalid_argument_type("setServers", "servers", "array"));
        }

        let mut triples_iterator = argument.array_iterator(global_this)?;

        let mut entries = Vec::new();

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

            let address = triple.get_index(global_this, 1)?.to_utf8(global_this)?;
            let ip = ip_address::parse_strict(&address)
                .filter(|ip| ip.is_ipv4() == (family == 4))
                .ok_or_else(|| throw_invalid_ip(global_this, &address))?;
            entries.push((ip, port as u16));
        }
        Ok(entries)
    }

    pub(crate) fn set_global_servers(cx: &mut JsScope<'_>, servers: JsLocal<'_>) -> JsResult<()> {
        global_resolver(cx.global()).set_servers(cx, servers)
    }

    pub(crate) fn set_servers(
        self: &RefPtr<Self>,
        cx: &mut JsScope<'_>,
        servers: JsLocal<'_>,
    ) -> JsResult<()> {
        let global_this = cx.global();
        let busy = self.with_client(|client| client.has_requests());
        // It's okay to call dns.setServers with active queries, but not dns.Resolver.setServers
        if busy && self.made_in.is_some() {
            return Err(global_this
                .err(
                    jsc::Error::DNS_SET_SERVERS_FAILED,
                    format_args!("Failed to set servers: there are pending queries"),
                )
                .throw());
        }

        let entries = Self::servers_from_js(global_this, servers.to_js());
        let entries = entries.inspect_err(|_| self.update_timer())?;
        self.request_completed(self.with_client(|client| client.set_servers(&entries)));
        Ok(())
    }

    pub(crate) fn new_resolver(cx: &mut JsScope<'_>, options: &ResolverOptions) -> JSValue {
        let global_this = cx.global();
        let vm = global_this.bun_vm();
        let options = bun_dns_client::Options {
            timeout: (options.timeout > 0).then(|| Duration::from_millis(options.timeout as u64)),
            max_timeout: (options.max_timeout > 0)
                .then(|| Duration::from_millis(options.max_timeout.into())),
            tries: options.tries.max(1) as u32,
        };
        bun_output::scoped_log!(DNSResolver, "init");
        let made_in = Some(vm.context_of_caller().id());
        js_DNSResolver::to_js(RefPtr::new(Self::setup(vm, made_in, options)), global_this)
    }

    pub(crate) fn cancel(self: &RefPtr<Self>) {
        self.request_completed(self.with_client(Client::cancel));
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

        let Some(ip) = ip_address::parse_strict(addr_s) else {
            return Err(global_this.throw_invalid_argument_value(
                b"address",
                bun_string_jsc::create_utf8_for_js(global_this, addr_s)?,
            ));
        };

        let resolver = global_resolver(global_this);
        // For one address, the hashes are equal only if the ports are.
        let (kind, hash) = (QueryKind::NameInfo, wyhash(addr_s) ^ u64::from(port));
        // An IPv4-mapped address has no name in ip6.arpa.
        let send = |client: &mut Client, query| client.name_info(ip.to_canonical(), port, query);
        Ok(resolver.ask(kind, hash, addr_s, global_this, context, send))
    }

    pub(crate) fn get_runtime_default_result_order_option() -> bun::String {
        // `VirtualMachine.dns_result_order` is stored as a raw `u8` (the jsc
        // crate cannot depend on this crate's `Order`); cast through Order's repr(u8).
        let raw = VirtualMachine::get().dns_result_order.get();
        let order = match raw {
            4 => Order::Ipv4first,
            6 => Order::Ipv6first,
            _ => Order::Verbatim,
        };
        bun::String::static_(<&'static str>::from(order))
    }
}
