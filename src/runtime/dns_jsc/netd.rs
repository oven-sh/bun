//! Android's platform resolver as the transport for `Resolver`.
//!
//! Android does not tell native code which nameservers to use — DNS is per
//! network, may be Private DNS (DoT/DoH), and is cached and policed centrally in
//! netd. So instead of c-ares talking to servers itself:
//!
//! * record queries (`resolve*`) go through `android_res_nquery`
//!   (`<android/multinetwork.h>`, API 29+, looked up at runtime because we target
//!   28). netd hands back the raw DNS reply, which is given to the record type's
//!   `ares_callback` exactly as `ares_query` would, so parsing and everything
//!   above it is shared with the c-ares transport;
//! * address → name (`reverse`, `lookupService`) goes through bionic's
//!   `gethostbyaddr_r`/`getnameinfo` on the work pool — bionic proxies those to
//!   netd as well, hosts file included — the same way `Backend::System` already
//!   handles name → address.
//!
//! A resolver that was given servers with `setServers()` uses c-ares to reach
//! them instead (`Resolver::servers_explicit`); record queries also stay on
//! c-ares where `android_res_nquery` does not exist yet.

use core::cell::{Cell, RefCell};
use std::collections::VecDeque;

use super::*;
use bun_io::FilePoll;
use bun_output::scoped_log;

bun_output::declare_scope!(netd, hidden);

unsafe extern "C" {
    /// bionic, API 23+; not in the libc crate's android bindings.
    fn gethostbyaddr_r(
        addr: *const c_void,
        len: libc::socklen_t,
        type_: c_int,
        ret: *mut libc::hostent,
        buf: *mut c_char,
        buflen: usize,
        result: *mut *mut libc::hostent,
        h_errnop: *mut c_int,
    ) -> c_int;
}

const NETWORK_UNSPECIFIED: u64 = 0;
/// `ANDROID_RESOLV_NO_RETRY`
const RESOLV_NO_RETRY: u32 = 1 << 0;
/// netd's `MAXPACKET`: larger answers come back cut to this with TC set.
const MAX_ANSWER: usize = 8 * 1024;
/// dnsproxyd refuses (EBUSY) beyond 256 concurrent requests per uid, a budget
/// shared with every `getaddrinfo` from the uid; queue locally below that.
const MAX_INFLIGHT: u32 = 192;
/// c-ares' default, for turning `{ timeout }` without `{ tries }` into a deadline.
const DEFAULT_TRIES: i32 = 3;

type ResNquery = unsafe extern "C" fn(
    network: u64,
    dname: *const c_char,
    ns_class: c_int,
    ns_type: c_int,
    flags: u32,
) -> c_int;
type ResNresult =
    unsafe extern "C" fn(fd: c_int, rcode: *mut c_int, answer: *mut u8, anslen: usize) -> c_int;
type ResCancel = unsafe extern "C" fn(fd: c_int);
type RawCallback = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int);

pub(crate) struct Api {
    nquery: ResNquery,
    nresult: ResNresult,
    cancel: ResCancel,
}

/// The netd record-query entry points, or `None` before API 29.
pub(crate) fn api() -> Option<&'static Api> {
    static API: std::sync::OnceLock<Option<Api>> = std::sync::OnceLock::new();
    API.get_or_init(|| {
        // libandroid_net.so is the small LL-NDK library that carries just these;
        // libandroid.so re-exports them and is what an app namespace can open.
        let handle = [
            bun_core::zstr!("libandroid_net.so"),
            bun_core::zstr!("libandroid.so"),
        ]
        .into_iter()
        .find_map(|name| sys::dlopen(name, sys::RTLD::LAZY | sys::RTLD::LOCAL))?;
        let sym = |name: &bun_core::ZStr| sys::dlsym_impl(Some(handle), name);
        // SAFETY: the symbols have these signatures in <android/multinetwork.h>.
        unsafe {
            Some(Api {
                nquery: core::mem::transmute::<*mut c_void, ResNquery>(sym(bun_core::zstr!(
                    "android_res_nquery"
                ))?),
                nresult: core::mem::transmute::<*mut c_void, ResNresult>(sym(bun_core::zstr!(
                    "android_res_nresult"
                ))?),
                cancel: core::mem::transmute::<*mut c_void, ResCancel>(sym(bun_core::zstr!(
                    "android_res_cancel"
                ))?),
            })
        }
    })
    .as_ref()
}

thread_local! {
    /// Queries this thread has handed to netd and not yet collected.
    static INFLIGHT: Cell<u32> = const { Cell::new(0) };
    /// Queries held back to stay under `MAX_INFLIGHT`, oldest first.
    static WAITING: RefCell<VecDeque<*mut Query>> = const { RefCell::new(VecDeque::new()) };
}

// ──────────────────────────────────────────────────────────────────────────
// resolve*: android_res_nquery
// ──────────────────────────────────────────────────────────────────────────

/// One record query. Heap-allocated; listed in `Resolver::netd_queries` (so
/// `cancel()`, the `setServers` guard and teardown see it) and holding a ref
/// on the resolver until `finish` consumes it.
pub(crate) struct Query {
    resolver: *mut Resolver,
    api: &'static Api,
    ctx: *mut c_void,
    callback: RawCallback,
    name: Box<[u8]>,
    ns_type: c_int,
    flags: u32,
    deadline: Option<bun::timespec>,
    /// -1 while waiting for an in-flight slot.
    fd: c_int,
    poll: *mut FilePoll,
}

/// `Channel::resolve`'s counterpart: send `name`/`T::NS_TYPE` and complete
/// `request` through `T`'s raw callback — synchronously if it cannot be sent.
pub(crate) fn resolve<T: CAresRecordType>(
    api: &'static Api,
    resolver: &Resolver,
    name: &[u8],
    request: *mut ResolveInfoRequest<T>,
) {
    let callback: RawCallback = <ResolveInfoRequest<T> as c_ares::ResolveHandler>::raw_callback;
    let ctx = request.cast::<c_void>();
    let ns_type = T::NS_TYPE as c_int;
    if name.len() >= 1023
        || strings::contains_char(name, 0)
        || (name.is_empty()
            && ns_type != c_ares::NSType::ns_t_ns as c_int
            && ns_type != c_ares::NSType::ns_t_soa as c_int)
    {
        // SAFETY: completes the caller's live request, as c-ares does for a name
        // it rejects up front.
        unsafe { callback(ctx, c_ares::Error::EBADNAME as c_int, 0, ptr::null_mut(), 0) };
        return;
    }

    let options = resolver.options.get();
    let tries = options.tries.filter(|&t| t > 0);
    let deadline = options.timeout.filter(|&t| t > 0).map(|timeout| {
        bun::timespec::now(bun::TimespecMockMode::ForceRealTime)
            .add_ms(i64::from(timeout) * i64::from(tries.unwrap_or(DEFAULT_TRIES)))
    });
    let mut name_z = Vec::with_capacity(name.len() + 1);
    name_z.extend_from_slice(name);
    name_z.push(0);

    let query = bun_core::heap::into_raw(Box::new(Query {
        resolver: resolver.as_ctx_ptr(),
        api,
        ctx,
        callback,
        name: name_z.into_boxed_slice(),
        ns_type,
        flags: if tries == Some(1) { RESOLV_NO_RETRY } else { 0 },
        deadline,
        fd: -1,
        poll: ptr::null_mut(),
    }));
    track(resolver, query);
    if deadline.is_some() {
        let _ = resolver.add_timer(None);
    }
    submit(query);
}

fn submit(query: *mut Query) {
    if INFLIGHT.get() >= MAX_INFLIGHT {
        scoped_log!(netd, "queueing query; {} in flight", INFLIGHT.get());
        WAITING.with_borrow_mut(|w| w.push_back(query));
        return;
    }
    send(query);
}

fn send(query: *mut Query) {
    // SAFETY: `query` is live (listed on its resolver) and not yet sent.
    let q = unsafe { &mut *query };
    // SAFETY: `name` is NUL-terminated; plain FFI call.
    let fd = unsafe {
        (q.api.nquery)(
            NETWORK_UNSPECIFIED,
            q.name.as_ptr().cast::<c_char>(),
            c_ares::NSClass::ns_c_in as c_int,
            q.ns_type,
            q.flags,
        )
    };
    scoped_log!(
        netd,
        "nquery({}, type {}) = {}",
        bstr::BStr::new(&q.name[..q.name.len() - 1]),
        q.ns_type,
        fd
    );
    if fd < 0 {
        finish(query, status_from_errno(-fd), &mut []);
        return;
    }

    let ctx = js_event_loop_ctx();
    let poll = FilePoll::init(
        ctx,
        sys::Fd::from_native(fd),
        Default::default(),
        Async::Owner::new(
            Async::posix_event_loop::poll_tag::DNS_NETD_QUERY,
            query.cast::<()>(),
        ),
    );
    // SAFETY: `event_loop_handle` is set once the VM is initialized; live for its lifetime.
    let loop_ = unsafe { &mut *(*q.resolver).vm().event_loop_handle.unwrap() };
    // SAFETY: `poll` is the live slot `FilePoll::init` returned; exclusive here.
    if unsafe { &mut *poll }
        .register(loop_, Async::PollKind::Readable, true)
        .is_err()
    {
        // SAFETY: as above; the fd is still ours until `cancel` closes it.
        unsafe {
            (*poll).deinit_with_vm(ctx);
            (q.api.cancel)(fd);
        }
        finish(query, c_ares::Error::ECONNREFUSED as c_int, &mut []);
        return;
    }
    // SAFETY: `poll` is live and registered; undone by `deinit_with_vm`.
    unsafe { (*poll).enable_keeping_process_alive(ctx) };
    q.fd = fd;
    q.poll = poll;
    INFLIGHT.set(INFLIGHT.get() + 1);
}

/// Take back a sent query's fd from the loop (the fd itself is closed by
/// `nresult`/`cancel`).
fn unpoll(q: &mut Query) -> c_int {
    debug_assert!(q.fd >= 0);
    // SAFETY: `poll` is the live slot created in `send`; the fd is still open.
    unsafe { (*q.poll).deinit_with_vm(js_event_loop_ctx()) };
    q.poll = ptr::null_mut();
    INFLIGHT.set(INFLIGHT.get() - 1);
    core::mem::replace(&mut q.fd, -1)
}

impl Query {
    /// `FilePoll` readiness callback: netd has an answer (or an error).
    pub(crate) fn on_poll(this: *mut Query) {
        // SAFETY: `this` is the live allocation registered as the poll owner;
        // the resolver is ref'd by it.
        let (vm, api) = unsafe { ((*(*this).resolver).vm(), (*this).api) };
        let _exit = vm.enter_event_loop_scope();
        // SAFETY: as above; exclusive for this call.
        let fd = unpoll(unsafe { &mut *this });

        let mut answer = [0u8; MAX_ANSWER];
        let mut rcode: c_int = 0;
        // SAFETY: `answer` is writable for its length; `fd` is the query fd
        // netd handed us, not yet consumed. This closes it.
        let n = unsafe { (api.nresult)(fd, &raw mut rcode, answer.as_mut_ptr(), answer.len()) };
        scoped_log!(netd, "nresult = {} (rcode {})", n, rcode);
        if n == -libc::EBUSY && INFLIGHT.get() > 0 {
            // Over dnsproxyd's per-uid budget (other processes of this uid count
            // too): retry when one of ours comes back.
            WAITING.with_borrow_mut(|w| w.push_front(this));
            return;
        }
        let (status, len) = if n < 0 {
            (status_from_errno(-n), 0)
        } else {
            (status_from_reply(rcode, &answer[..n as usize]), n as usize)
        };
        finish(this, status, &mut answer[..len]);
        kick_waiting();
    }
}

fn kick_waiting() {
    while INFLIGHT.get() < MAX_INFLIGHT {
        let Some(query) = WAITING.with_borrow_mut(|w| w.pop_front()) else {
            break;
        };
        send(query);
    }
}

/// Consume `query`: unlist it, hand `answer`/`status` to the record callback
/// (which consumes the request), release the resolver ref.
fn finish(query: *mut Query, status: c_int, answer: &mut [u8]) {
    // SAFETY: `query` is live and, if it was sent, already `unpoll`ed; nothing
    // touches it after this.
    let owned = unsafe { bun_core::heap::take(query) };
    debug_assert!(owned.fd < 0);
    let resolver = owned.resolver;
    // SAFETY: ref'd by this query until the `deref` below.
    untrack(unsafe { &*resolver }, query);
    // SAFETY: `ctx`/`callback` are the request and its `ares_callback` thunk,
    // which consumes the request; `answer` outlives the call.
    unsafe {
        (owned.callback)(
            owned.ctx,
            status,
            0,
            answer.as_mut_ptr(),
            c_int::try_from(answer.len()).expect("int cast"),
        );
    }
    // SAFETY: balances the `ref_()` in `track`; no borrow of the resolver is
    // live past this point.
    unsafe { Resolver::deref(resolver) };
}

fn track(resolver: &Resolver, query: *mut Query) {
    resolver.ref_();
    resolver.netd_queries.with_mut(|list| list.push(query));
    resolver.sync_active_handle();
}

fn untrack(resolver: &Resolver, query: *mut Query) {
    resolver.netd_queries.with_mut(|list| {
        if let Some(i) = list.iter().position(|&q| core::ptr::eq(q, query)) {
            list.swap_remove(i);
        }
    });
    resolver.sync_active_handle();
}

/// Fail one listed query with `status`, wherever it is in its life.
fn abort(query: *mut Query, status: c_int) {
    // SAFETY: listed ⇒ live.
    let q = unsafe { &mut *query };
    if q.fd >= 0 {
        let api = q.api;
        let fd = unpoll(q);
        // SAFETY: the query fd, not yet consumed; this closes it.
        unsafe { (api.cancel)(fd) };
    } else {
        WAITING.with_borrow_mut(|w| w.retain(|&p| !core::ptr::eq(p, query)));
    }
    finish(query, status, &mut []);
}

pub(crate) fn has_pending(resolver: &Resolver) -> bool {
    !resolver.netd_queries.get().is_empty()
        || resolver
            .netd_name_jobs
            .get()
            .iter()
            // SAFETY: listed ⇒ live.
            .any(|&job| unsafe { (*job).request.is_some() })
}

pub(crate) fn has_deadlines(resolver: &Resolver) -> bool {
    resolver
        .netd_queries
        .get()
        .iter()
        // SAFETY: listed ⇒ live.
        .any(|&q| unsafe { (*q).deadline.is_some() })
}

/// `Resolver.cancel()` / teardown: fail every query of `resolver` with `status`.
pub(crate) fn cancel_all(resolver: &Resolver, status: c_int) {
    while let Some(query) = resolver.netd_queries.get().last().copied() {
        abort(query, status);
    }
    kick_waiting();
    // Pool lookups keep running; settle their requests now and let `then` free.
    let jobs: Vec<*mut NameJob> = resolver.netd_name_jobs.get().clone();
    for job in jobs {
        // SAFETY: listed ⇒ live; only the JS thread touches `request`.
        if let Some(request) = unsafe { (*job).request.take() } {
            fail(request, status);
        }
    }
}

/// Called from the resolver's 1 s timer while any query has a deadline.
pub(crate) fn check_deadlines(resolver: &Resolver, now: &bun::timespec) {
    let expired: Vec<*mut Query> = resolver
        .netd_queries
        .get()
        .iter()
        .copied()
        // SAFETY: listed ⇒ live.
        .filter(|&q| unsafe { (*q).deadline }.is_some_and(|d| !d.greater(now)))
        .collect();
    for query in expired {
        abort(query, c_ares::Error::ETIMEOUT as c_int);
    }
    kick_waiting();
}

/// `ares_query`'s mapping from a reply to a status, so callers see the same
/// codes whichever transport carried the query.
fn status_from_reply(rcode: c_int, answer: &[u8]) -> c_int {
    if answer.len() < 12 {
        return c_ares::Error::EBADRESP as c_int;
    }
    let ancount = u16::from_be_bytes([answer[6], answer[7]]);
    match rcode {
        0 if ancount == 0 => c_ares::Error::ENODATA as c_int,
        1 => c_ares::Error::EFORMERR as c_int,
        2 => c_ares::Error::ESERVFAIL as c_int,
        3 => c_ares::Error::ENOTFOUND as c_int,
        4 => c_ares::Error::ENOTIMP as c_int,
        5 => c_ares::Error::EREFUSED as c_int,
        _ => c_ares::ARES_SUCCESS,
    }
}

/// netd reports failures as a negative errno from `nquery`/`nresult`.
fn status_from_errno(errno: c_int) -> c_int {
    match errno {
        libc::ETIMEDOUT => c_ares::Error::ETIMEOUT as c_int,
        libc::ENOMEM => c_ares::Error::ENOMEM as c_int,
        // `res_mkquery` rejected the name (bad label/length).
        libc::EMSGSIZE => c_ares::Error::EBADNAME as c_int,
        libc::EINVAL => c_ares::Error::EBADQUERY as c_int,
        // No nameservers configured for the network.
        libc::ESRCH => c_ares::Error::ESERVFAIL as c_int,
        _ => c_ares::Error::ECONNREFUSED as c_int,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// reverse / lookupService: bionic on the work pool
// ──────────────────────────────────────────────────────────────────────────

const NI_MAXHOST: usize = 1025;
const NI_MAXSERV: usize = 32;

/// Off-thread half: the address in, the names out.
pub(crate) struct NameLookup {
    sa: SockaddrStorage,
    want_service: bool,
    status: c_int,
    /// NUL-terminated; `names[0]` is the canonical name, the rest aliases.
    names: Vec<Box<[u8]>>,
    service: [u8; NI_MAXSERV],
}

/// JS-thread half: the request the lookup completes. Consumed by `then`;
/// dropped unconsumed only when the VM tears down first, in which case the
/// request and its coalesced waiters are freed and nothing is settled.
pub(crate) enum NameRequest {
    Reverse(NonNull<GetHostByAddrInfoRequest>),
    Service(NonNull<GetNameInfoRequest>),
}
// SAFETY: only the JS thread touches the request (see type doc).
unsafe impl bun_jsc::job::JsAffine for NameRequest {}

impl Drop for NameRequest {
    fn drop(&mut self) {
        // SAFETY: JS thread; the live heap request and its coalesced waiters,
        // none of which anything else will touch again.
        unsafe {
            match *self {
                NameRequest::Reverse(req) => {
                    let req = req.as_ptr();
                    if let Some(resolver) = (*req).resolver_for_caching {
                        if (*req).cache.pending_cache() {
                            drop((*resolver).get_key_addr((*req).cache.pos_in_pending()));
                        }
                    }
                    let mut pending = (*req).head.next;
                    drop(bun_core::heap::take(req));
                    while let Some(waiter) = pending {
                        pending = (*waiter.as_ptr()).next;
                        drop(bun_core::heap::take(waiter.as_ptr()));
                    }
                }
                NameRequest::Service(req) => {
                    let req = req.as_ptr();
                    if let Some(resolver) = (*req).resolver_for_caching {
                        if (*req).cache.pending_cache() {
                            drop((*resolver).get_key_nameinfo((*req).cache.pos_in_pending()));
                        }
                    }
                    let mut pending = (*req).head.next;
                    drop(bun_core::heap::take(req));
                    while let Some(waiter) = pending {
                        pending = (*waiter.as_ptr()).next;
                        drop(bun_core::heap::take(waiter.as_ptr()));
                    }
                }
            }
        }
    }
}

/// One pool name lookup as the resolver sees it: listed in
/// `Resolver::netd_name_jobs` and holding a ref on the resolver until the job
/// ends. `cancel()`/teardown take `request` out and settle it right away; the
/// blocking call cannot be interrupted, so when it returns `then` finds the
/// request gone and only frees.
pub(crate) struct NameJob {
    resolver: *mut Resolver,
    request: Option<NameRequest>,
}

/// The job's JS-thread half: owns the `NameJob`. Consumed by `then`; dropped
/// unconsumed only when the VM tears down first, in which case a request still
/// present is freed with its waiters and nothing is settled.
pub(crate) struct NameJobHandle(NonNull<NameJob>);
// SAFETY: only the JS thread touches the job and its request.
unsafe impl bun_jsc::job::JsAffine for NameJobHandle {}

impl NameJobHandle {
    fn new(resolver: &Resolver, request: NameRequest) -> Self {
        resolver.ref_();
        let job = bun_core::heap::into_raw(Box::new(NameJob {
            resolver: resolver.as_ctx_ptr(),
            request: Some(request),
        }));
        resolver.netd_name_jobs.with_mut(|list| list.push(job));
        resolver.sync_active_handle();
        NameJobHandle(NonNull::new(job).expect("just allocated"))
    }

    /// Unlist and free the job; hands back the request if nobody settled it yet.
    fn finish(self) -> Option<NameRequest> {
        let job = core::mem::ManuallyDrop::new(self).0.as_ptr();
        // SAFETY: the live allocation from `new`; nothing touches it afterwards.
        let NameJob { resolver, request } = unsafe { *bun_core::heap::take(job) };
        // SAFETY: ref'd in `new` until the `deref` below.
        let resolver_ref = unsafe { &*resolver };
        resolver_ref.netd_name_jobs.with_mut(|list| {
            if let Some(i) = list.iter().position(|&j| core::ptr::eq(j, job)) {
                list.swap_remove(i);
            }
        });
        resolver_ref.sync_active_handle();
        // SAFETY: balances `new`; no borrow of the resolver outlives this.
        unsafe { Resolver::deref(resolver) };
        request
    }
}

impl Drop for NameJobHandle {
    fn drop(&mut self) {
        // The request (if still ours) frees itself and its waiters on drop.
        drop(NameJobHandle(self.0).finish());
    }
}

/// Settle `request` with `status` and no result, as c-ares does on failure.
fn fail(request: NameRequest, status: c_int) {
    let request = core::mem::ManuallyDrop::new(request);
    let err = c_ares::Error::get(status);
    // SAFETY: the live heap request; the handler consumes it.
    unsafe {
        match &*request {
            NameRequest::Reverse(req) => {
                c_ares::HostentHandler::on_hostent(&mut *req.as_ptr(), err, 0, ptr::null_mut())
            }
            NameRequest::Service(req) => {
                c_ares::NameinfoHandler::on_nameinfo(&mut *req.as_ptr(), err, 0, None)
            }
        }
    }
}

impl NameLookup {
    fn new(sa: SockaddrStorage, want_service: bool) -> Self {
        Self {
            sa,
            want_service,
            status: c_ares::Error::ENOTFOUND as c_int,
            names: Vec::new(),
            service: [0; NI_MAXSERV],
        }
    }

    fn salen(&self) -> libc::socklen_t {
        if c_int::from(self.sa.ss_family) == libc::AF_INET {
            core::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t
        } else {
            core::mem::size_of::<libc::sockaddr_in6>() as libc::socklen_t
        }
    }

    /// Pool thread: the blocking bionic call.
    fn run_blocking(&mut self) {
        if self.want_service {
            let mut host = [0u8; NI_MAXHOST];
            // SAFETY: `sa` is a sockaddr_in/in6 of `salen()` bytes; the out
            // buffers are writable for the lengths given.
            let rc = unsafe {
                libc::getnameinfo(
                    (&raw const self.sa).cast::<libc::sockaddr>(),
                    self.salen(),
                    host.as_mut_ptr().cast::<c_char>(),
                    host.len() as _,
                    self.service.as_mut_ptr().cast::<c_char>(),
                    self.service.len() as _,
                    libc::NI_NAMEREQD,
                )
            };
            if rc == 0 {
                self.status = c_ares::ARES_SUCCESS;
                self.names.push(cstr_boxed(host.as_ptr().cast::<c_char>()));
            } else {
                self.status = status_from_eai(rc);
            }
            return;
        }

        let (addr, addrlen, family): (*const c_void, libc::socklen_t, c_int) =
            if c_int::from(self.sa.ss_family) == libc::AF_INET {
                // SAFETY: family says this storage holds a sockaddr_in.
                let sin = unsafe { &*(&raw const self.sa).cast::<libc::sockaddr_in>() };
                ((&raw const sin.sin_addr).cast(), 4, libc::AF_INET)
            } else {
                // SAFETY: family says this storage holds a sockaddr_in6.
                let sin6 = unsafe { &*(&raw const self.sa).cast::<libc::sockaddr_in6>() };
                ((&raw const sin6.sin6_addr).cast(), 16, libc::AF_INET6)
            };
        // SAFETY: plain C struct of pointers and ints; all-zero is a valid value.
        let mut hostent: libc::hostent = unsafe { core::mem::zeroed() };
        let mut result: *mut libc::hostent = ptr::null_mut();
        let mut h_errno: c_int = 0;
        let mut buf = vec![0u8; 8192];
        // SAFETY: all pointers reference live locals of the stated sizes.
        let rc = unsafe {
            gethostbyaddr_r(
                addr,
                addrlen,
                family,
                &raw mut hostent,
                buf.as_mut_ptr().cast::<c_char>(),
                buf.len(),
                &raw mut result,
                &raw mut h_errno,
            )
        };
        if rc != 0 || result.is_null() {
            self.status = if rc == libc::ERANGE || rc == libc::ENOMEM {
                c_ares::Error::ENOMEM as c_int
            } else {
                c_ares::Error::ENOTFOUND as c_int
            };
            return;
        }
        // SAFETY: a successful gethostbyaddr_r filled `hostent` with pointers
        // into `buf`: a NUL-terminated h_name and a NULL-terminated h_aliases.
        unsafe {
            self.names.push(cstr_boxed(hostent.h_name));
            let mut alias = hostent.h_aliases;
            while !alias.is_null() && !(*alias).is_null() {
                self.names.push(cstr_boxed(*alias));
                alias = alias.add(1);
            }
        }
        self.status = c_ares::ARES_SUCCESS;
    }

    /// JS thread: hand the names to the request the way c-ares would.
    fn complete(mut self, request: NameRequest) {
        let request = core::mem::ManuallyDrop::new(request);
        let err = c_ares::Error::get(self.status);
        let mut name_ptrs: Vec<*mut c_char> = self
            .names
            .iter_mut()
            .map(|n| n.as_mut_ptr().cast::<c_char>())
            .collect();
        match &*request {
            NameRequest::Reverse(req) => {
                let mut no_addrs: [*mut c_char; 1] = [ptr::null_mut()];
                // As `ares_parse_ptr_reply` shapes it: every PTR name in `h_aliases`
                // (that is the list `reverse()` reports), the first also as `h_name`.
                let mut hostent = (!name_ptrs.is_empty()).then(|| {
                    name_ptrs.push(ptr::null_mut());
                    c_ares::struct_hostent {
                        h_name: name_ptrs[0],
                        h_aliases: name_ptrs.as_mut_ptr(),
                        h_addrtype: c_int::from(self.sa.ss_family),
                        h_length: 0,
                        h_addr_list: no_addrs.as_mut_ptr(),
                    }
                });
                let hostent_ptr = hostent
                    .as_mut()
                    .map_or(ptr::null_mut(), |h| core::ptr::from_mut(h));
                // SAFETY: the live heap request; `on_hostent` consumes it and only
                // reads the hostent (whose strings live in `self.names`) during the call.
                unsafe {
                    c_ares::HostentHandler::on_hostent(&mut *req.as_ptr(), err, 0, hostent_ptr)
                };
            }
            NameRequest::Service(req) => {
                let info = (!name_ptrs.is_empty()).then(|| c_ares::struct_nameinfo {
                    node: name_ptrs[0].cast::<u8>(),
                    service: self.service.as_mut_ptr(),
                });
                // SAFETY: the live heap request; `on_nameinfo` consumes it and
                // copies node/service during the call.
                unsafe { c_ares::NameinfoHandler::on_nameinfo(&mut *req.as_ptr(), err, 0, info) };
            }
        }
    }
}

impl bun_jsc::JobContext for NameLookup {
    type OffThread = Self;
    type Js = NameJobHandle;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.run_blocking();
        Some(done)
    }
    fn then(this: Self, job: NameJobHandle, cx: &bun_jsc::JsThread<'_>) -> bun_jsc::JsResult<()> {
        let _exit = cx.vm().enter_event_loop_scope();
        if let Some(request) = job.finish() {
            this.complete(request);
        }
        Ok(())
    }
}

/// `Channel::get_host_by_addr`'s counterpart.
pub(crate) fn get_host_by_addr(
    resolver: &Resolver,
    global_this: &JSGlobalObject,
    ip: &[u8],
    request: *mut GetHostByAddrInfoRequest,
) {
    let mut sa: SockaddrStorage = bun_core::ffi::zeroed();
    // SAFETY: sockaddr_storage holds any family `get_sockaddr` writes.
    if c_ares::get_sockaddr(ip, 0, unsafe { &mut *(&raw mut sa).cast() }) != 0 {
        // SAFETY: nothing was started; complete the caller's live request the
        // way c-ares does for an address it cannot parse.
        unsafe {
            c_ares::HostentHandler::on_hostent(
                &mut *request,
                c_ares::Error::get(c_ares::Error::ENOTIMP as c_int),
                0,
                ptr::null_mut(),
            )
        };
        return;
    }
    bun_jsc::Job::<NameLookup>::schedule(
        &global_this.js_thread(),
        NameLookup::new(sa, false),
        NameJobHandle::new(
            resolver,
            NameRequest::Reverse(NonNull::new(request).expect("request")),
        ),
    );
}

/// `Channel::get_name_info`'s counterpart.
pub(crate) fn get_name_info(
    resolver: &Resolver,
    global_this: &JSGlobalObject,
    sa: &SockaddrStorage,
    request: *mut GetNameInfoRequest,
) {
    bun_jsc::Job::<NameLookup>::schedule(
        &global_this.js_thread(),
        NameLookup::new(*sa, true),
        NameJobHandle::new(
            resolver,
            NameRequest::Service(NonNull::new(request).expect("request")),
        ),
    );
}

fn cstr_boxed(s: *const c_char) -> Box<[u8]> {
    // SAFETY: callers pass NUL-terminated strings written by bionic.
    unsafe { bun_core::ffi::cstr(s) }
        .to_bytes_with_nul()
        .to_vec()
        .into_boxed_slice()
}

/// `getnameinfo` failure → the status c-ares' `ares_getnameinfo` reports.
fn status_from_eai(rc: c_int) -> c_int {
    match rc {
        libc::EAI_MEMORY => c_ares::Error::ENOMEM as c_int,
        libc::EAI_FAMILY => c_ares::Error::EBADFAMILY as c_int,
        libc::EAI_AGAIN => c_ares::Error::ETIMEOUT as c_int,
        _ => c_ares::Error::ENOTFOUND as c_int,
    }
}
