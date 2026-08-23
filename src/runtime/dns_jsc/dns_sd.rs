//! macOS DNSServiceGetAddrInfo backend: all lookups share one mDNSResponder connection (see dns.rs banner).

use core::cell::RefCell;
use std::rc::Rc;

use super::*;
use bun_collections::index_sort;
use bun_io::FilePoll;
use bun_sys::dns_sd as sd;

pub(crate) use sd::DNSServiceProtocol;
use sd::{DNSServiceErrorType, DNSServiceFlags};

/// Map a DNSServiceErrorType to the EAI_* code the existing error paths expect.
pub(crate) fn to_eai(err: DNSServiceErrorType) -> c_int {
    match err {
        sd::ERR_NO_ERROR => 0,
        sd::ERR_NO_SUCH_NAME | sd::ERR_NO_SUCH_RECORD => libc::EAI_NONAME,
        sd::ERR_TIMEOUT
        | sd::ERR_NO_ROUTER
        | sd::ERR_DEFUNCT_CONNECTION
        | sd::ERR_SERVICE_NOT_RUNNING => libc::EAI_AGAIN,
        sd::ERR_NO_MEMORY => libc::EAI_MEMORY,
        sd::ERR_POLICY_DENIED | sd::ERR_NOT_PERMITTED | sd::ERR_REFUSED => libc::EAI_FAIL,
        _ => libc::EAI_FAIL,
    }
}

pub(crate) fn protocol_for_family(family: bun_dns::Family) -> DNSServiceProtocol {
    match family {
        bun_dns::Family::Inet => sd::PROTOCOL_IPV4,
        bun_dns::Family::Inet6 => sd::PROTOCOL_IPV6,
        // Both explicitly (not 0): completion tracks per-family replies.
        _ => sd::PROTOCOL_IPV4 | sd::PROTOCOL_IPV6,
    }
}

pub(crate) fn protocol_for_hints(hints: &AddrInfo) -> DNSServiceProtocol {
    match hints.ai_family {
        f if f == netc::AF_INET => sd::PROTOCOL_IPV4,
        f if f == netc::AF_INET6 => sd::PROTOCOL_IPV6,
        _ => sd::PROTOCOL_IPV4 | sd::PROTOCOL_IPV6,
    }
}

/// `hints` bits dns_sd can't express (AI_V4MAPPED/AI_ALL/...); AI_ADDRCONFIG maps to SuppressUnusable.
pub(crate) fn getaddrinfo_only_flags(flags: c_int) -> bool {
    flags & !netc::AI_ADDRCONFIG != 0
}

/// SuppressUnusable = daemon-side AI_ADDRCONFIG (localhost exempt); libinfo's getaddrinfo sets it too.
fn addrconfig_flags(protocol: DNSServiceProtocol) -> DNSServiceFlags {
    if protocol != (sd::PROTOCOL_IPV4 | sd::PROTOCOL_IPV6)
        || env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG
            .get()
            .unwrap_or(false)
    {
        return 0;
    }
    sd::FLAGS_SUPPRESS_UNUSABLE
}

/// libinfo-style bound on waiting for the second family once the first has answered.
const SECOND_FAMILY_EXTRA_MS: i64 = 2000;

/// The suppressed query always asked for both families.
fn protocol_for_pending(_q: &QueryState) -> DNSServiceProtocol {
    sd::PROTOCOL_IPV4 | sd::PROTOCOL_IPV6
}

/// Real time: this timer lives in the real heap (`allow_fake_timers() == false`), so it must never read the mocked clock.
fn now_ms() -> i64 {
    bun::timespec::now(bun::TimespecMockMode::ForceRealTime).ms()
}

/// Once decisive answers are in: nothing dangling, waiting on stragglers since `ms` (a silent family or `MoreComing`), or gave up.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stragglers {
    None,
    Since(i64),
    GaveUp,
}

/// SuppressUnusable lifecycle: an all-empty `Suppressed` answer earns exactly one `Reissued` (unsuppressed) attempt.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Attempt {
    Plain,
    Suppressed,
    Reissued,
}

/// Per-query state shared by the JS `dns.lookup` path and the internal connect path.
pub(crate) struct QueryState {
    pub(crate) results: bun_dns::ResultList,
    /// First hard error (NoSuchRecord/Timeout are per-family negatives, not errors).
    pub(crate) sd_error: DNSServiceErrorType,
    /// A family timed out: with no results this is EAI_AGAIN, not EAI_NONAME.
    saw_timeout: bool,
    /// Last reply had `MoreComing` and no other request's reply followed: more is queued daemon-side.
    awaiting_more: bool,
    /// Protocol bits with no reply yet; any family-tagged callback clears its bit.
    pub(crate) pending_proto: DNSServiceProtocol,
    stragglers: Stragglers,
    attempt: Attempt,
    /// Kept so `finish()` can reissue the query for the retry.
    hostname: bun::ZBox,
}

impl QueryState {
    pub(crate) fn new(protocol: DNSServiceProtocol) -> Self {
        Self {
            results: Default::default(),
            sd_error: 0,
            saw_timeout: false,
            awaiting_more: false,
            pending_proto: protocol,
            stragglers: Stragglers::None,
            attempt: Attempt::Plain,
            hostname: bun::ZBox::from_bytes(b""),
        }
    }

    /// Back to a fresh in-flight state for the unsuppressed reissue.
    pub(crate) fn reset_for_retry(&mut self, protocol: DNSServiceProtocol) {
        self.attempt = Attempt::Reissued;
        self.awaiting_more = false;
        self.stragglers = Stragglers::None;
        self.pending_proto = protocol;
    }

    /// What `on_early_out` does to a query whose deadline passed.
    pub(crate) fn give_up_on_stragglers(&mut self) {
        self.stragglers = Stragglers::GaveUp;
    }

    /// A suppressed query that returned nothing at all gets one unsuppressed retry.
    fn should_retry_unsuppressed(&self) -> bool {
        self.attempt == Attempt::Suppressed
            && self.results.is_empty()
            && self.sd_error == 0
            && !self.saw_timeout
    }

    /// Absorb one callback.
    pub(crate) fn record_reply(&mut self, reply: &sd::Reply<'_>) {
        let (flags, error_code) = (reply.flags, reply.error_code);
        self.awaiting_more = flags & sd::FLAGS_MORE_COMING != 0;
        // Only PolicyDenied passes a null sockaddr; A/AAAA replies (incl. negatives) are family-tagged.
        let Some(address) = reply.address else {
            if self.sd_error == 0 {
                self.sd_error = error_code;
            }
            return;
        };
        let fam = address.family();
        // Any reply retires the family's bit; completeness is tracked by `awaiting_more`.
        self.pending_proto &= !if fam == netc::AF_INET6 {
            sd::PROTOCOL_IPV6
        } else {
            sd::PROTOCOL_IPV4
        };
        if error_code == sd::ERR_NO_ERROR && flags & sd::FLAGS_ADD != 0 {
            self.results.push(GetAddrInfoResult {
                address,
                ttl: reply.ttl as i32,
            });
        } else if error_code == sd::ERR_TIMEOUT {
            self.saw_timeout = true;
        } else if error_code != sd::ERR_NO_ERROR
            && error_code != sd::ERR_NO_SUCH_RECORD
            && self.sd_error == 0
        {
            self.sd_error = error_code;
        }
        self.stragglers = match (self.only_stragglers_left(), self.stragglers) {
            (false, _) => Stragglers::None,
            (true, Stragglers::None) => Stragglers::Since(now_ms()),
            (true, current) => current,
        };
    }

    /// Everything decisive is in (answers, or every family reported) but a silent family or dangling `MoreComing` remains.
    fn only_stragglers_left(&self) -> bool {
        let outstanding = self.pending_proto != 0 || self.awaiting_more;
        outstanding && (self.pending_proto == 0 || !self.results.is_empty())
    }

    pub(crate) fn is_ready(&self) -> bool {
        self.sd_error != 0
            || self.stragglers == Stragglers::GaveUp
            || (self.pending_proto == 0 && !self.awaiting_more)
    }

    /// Deadline for giving up on stragglers (a silent second family, or a dangling `MoreComing`).
    pub(crate) fn early_out_deadline_ms(&self) -> Option<i64> {
        match self.stragglers {
            Stragglers::Since(t) if self.only_stragglers_left() => Some(t + SECOND_FAMILY_EXTRA_MS),
            _ => None,
        }
    }

    /// EAI_* status for a completed query with no results.
    pub(crate) fn empty_status(&self) -> c_int {
        if self.sd_error != 0 {
            to_eai(self.sd_error)
        } else if self.saw_timeout {
            libc::EAI_AGAIN
        } else {
            libc::EAI_NONAME
        }
    }

    pub(crate) fn take_results(&mut self) -> bun_dns::ResultList {
        let mut results = core::mem::take(&mut self.results);
        // Family arrival order races upstream; match getaddrinfo's RFC 6724 default (IPv6 first).
        index_sort::sort_slice_by(&mut results, |a, b| {
            (a.address.family() != netc::AF_INET6).cmp(&(b.address.family() != netc::AF_INET6))
        });
        results
    }
}

/// The request an in-flight query belongs to (it owns the `QueryState` the
/// reply callback writes).
pub(crate) enum InflightRequest {
    /// A `dns.lookup()`; owned here until `finish`.
    Jsc(bun_ptr::OwnedThis<GetAddrInfoRequest>),
    /// A connect-path lookup, owned by the global cache (its in-flight
    /// refcount keeps it alive until it completes).
    Internal(BackRef<internal::Request, bun_ptr::Mut>),
}

/// An in-flight query: its request plus the subordinate ref, which lives and
/// dies on this (the connection's) thread.
pub(crate) struct Inflight {
    /// Declared (so dropped) before `request`, the reply context it points at.
    sd_ref: Option<sd::Query>,
    request: InflightRequest,
}

impl InflightRequest {
    /// The reply-callback context registered for this query (identity only).
    fn context(&self) -> *const () {
        match self {
            InflightRequest::Jsc(r) => core::ptr::from_ref::<GetAddrInfoRequest>(r).cast(),
            InflightRequest::Internal(r) => r.as_ptr().cast_const().cast(),
        }
    }

    fn query(&self) -> &JsCell<QueryState> {
        match self {
            InflightRequest::Jsc(r) => &r.backend.dns_sd().query,
            InflightRequest::Internal(r) => &r.dns_sd.query,
        }
    }

    /// (Re)issue this query on `connection`.
    fn issue(
        &self,
        connection: &sd::Connection,
        protocol: DNSServiceProtocol,
        suppress: DNSServiceFlags,
        hostname: &core::ffi::CStr,
    ) -> Option<sd::Query> {
        let flags = sd::FLAGS_TIMEOUT | sd::FLAGS_RETURN_INTERMEDIATES | suppress;
        let result = match self {
            InflightRequest::Jsc(r) => {
                connection.get_addr_info(flags, 0, protocol, hostname, BackRef::new(&**r))
            }
            InflightRequest::Internal(r) => {
                connection.get_addr_info(flags, 0, protocol, hostname, BackRef::new(r.get()))
            }
        };
        match result {
            Ok(query) => Some(query),
            Err(err) => {
                bun_output::scoped_log!(dns, "DNSServiceGetAddrInfoEx failed: {}", err);
                None
            }
        }
    }
}

impl Inflight {
    fn query(&self) -> &JsCell<QueryState> {
        self.request.query()
    }
}

impl sd::GetAddrInfoReply for GetAddrInfoRequest {
    /// Reply callback (inside `process_result`): records state; completion
    /// happens in `on_readable`.
    fn on_reply(&self, reply: &sd::Reply<'_>) {
        SharedConnection::note_reply(core::ptr::from_ref(self).cast());
        self.backend
            .dns_sd()
            .query
            .with_mut(|q| q.record_reply(reply));
    }
}

/// One per event loop: owns the primary connection + its `FilePoll`; lookups are ShareConnection subordinates.
/// Only ever torn down through [`destroy`](Self::destroy) (fields in that order).
pub(crate) struct SharedConnection {
    inflight: RefCell<Vec<Inflight>>,
    file_poll: RefCell<Option<OwnedFilePoll>>,
    connection: sd::Connection,
    ctx: Async::EventLoopCtx,
    /// `context` of the previous reply (a different one ends the prior request's contiguous run).
    last_ctx: Cell<*const ()>,
    /// Early-out timer (JS threads only; the daemon timeout backstops other loops).
    pub(crate) early_out_timer: JsCell<EventLoopTimer>,
    /// Deadline the timer is currently armed for (0 = disarmed).
    early_out_armed_for: Cell<i64>,
}

thread_local! {
    /// This thread's connection. `ManuallyDrop`: a thread that exits without
    /// `close_for_terminate` leaves it (and mDNSResponder's fd) to the OS
    /// rather than running teardown against a gone event loop.
    static SHARED: RefCell<core::mem::ManuallyDrop<Option<Rc<SharedConnection>>>> =
        const { RefCell::new(core::mem::ManuallyDrop::new(None)) };
}

impl SharedConnection {
    /// This thread's connection, if any.
    fn current() -> Option<Rc<Self>> {
        SHARED.with_borrow(|s| Option::clone(s))
    }

    fn detach() -> Option<Rc<Self>> {
        SHARED.with_borrow_mut(|s| s.take())
    }

    /// Lazily connect; `None` (caller falls back to getaddrinfo) if mDNSResponder is unreachable.
    pub(crate) fn get(ctx: Async::EventLoopCtx) -> Option<Rc<Self>> {
        if let Some(existing) = Self::current() {
            return Some(existing);
        }
        let connection = match sd::Connection::create() {
            Ok(c) => c,
            Err(err) => {
                bun_output::scoped_log!(dns, "DNSServiceCreateConnection failed: {}", err);
                return None;
            }
        };
        let raw_fd = connection.sock_fd();
        if raw_fd < 0 {
            bun_output::scoped_log!(dns, "DNSServiceRefSockFD returned {}", raw_fd);
            return None;
        }
        let fd = bun_sys::Fd::from_native(raw_fd);
        let this = Rc::new(Self {
            inflight: RefCell::new(Vec::new()),
            file_poll: RefCell::new(None),
            connection,
            ctx,
            last_ctx: Cell::new(core::ptr::null()),
            early_out_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::DnsSdConnection,
            )),
            early_out_armed_for: Cell::new(0),
        });
        let mut poll = OwnedFilePoll::new(
            ctx,
            fd,
            Default::default(),
            Async::Owner::new(
                Async::posix_event_loop::poll_tag::GET_ADDR_INFO_REQUEST,
                Rc::as_ptr(&this).cast_mut().cast(),
            ),
        );
        let rc = poll.register_with_fd_on(
            ctx,
            Async::PollKind::Readable,
            Async::posix_event_loop::OneShotFlag::None,
            fd,
        );
        if rc.is_err() {
            return None;
        }
        *this.file_poll.borrow_mut() = Some(poll);
        SHARED.with_borrow_mut(|s| **s = Some(Rc::clone(&this)));
        Some(this)
    }

    fn with_file_poll(&self, f: impl FnOnce(&mut FilePoll)) {
        if let Some(poll) = self.file_poll.borrow_mut().as_deref_mut() {
            f(poll);
        }
    }

    /// Start a subordinate query and track it (keeps the process alive); `None` if the daemon refused.
    pub(crate) fn start(
        &self,
        request: InflightRequest,
        protocol: DNSServiceProtocol,
        hostname: &core::ffi::CStr,
    ) -> Option<()> {
        let suppress = addrconfig_flags(protocol);
        let sub = request.issue(&self.connection, protocol, suppress, hostname)?;
        if self.inflight.borrow().is_empty() {
            let ctx = self.ctx;
            self.with_file_poll(|p| p.enable_keeping_process_alive(ctx));
        }
        request.query().with_mut(|q| {
            q.attempt = if suppress != 0 {
                Attempt::Suppressed
            } else {
                Attempt::Plain
            };
            q.hostname = bun::ZBox::from_bytes(hostname.to_bytes());
        });
        self.inflight.borrow_mut().push(Inflight {
            request,
            sd_ref: Some(sub),
        });
        Some(())
    }

    /// Called first from every reply callback: a different `context` ends the previous request's `MoreComing` run.
    pub(crate) fn note_reply(context: *const ()) {
        let Some(this) = Self::current() else {
            return;
        };
        let prev = this.last_ctx.get();
        if !prev.is_null() && prev != context {
            for inf in this.inflight.borrow().iter() {
                if inf.request.context() == prev {
                    inf.query().with_mut(|q| q.awaiting_more = false);
                }
            }
        }
        this.last_ctx.set(context);
    }

    /// Socket readable: drain every buffered reply (callbacks fire inline), then finish complete queries.
    pub(crate) fn on_readable() {
        let Some(this) = Self::current() else {
            return;
        };
        // One scope across `finish()` so the microtask drain runs after we let go of `this`.
        let _exit = event_loop_scope();

        // Callbacks re-enter through `note_reply` and the requests' own cells;
        // no `RefCell` borrow is held here.
        let rc = this.connection.process_result();
        if rc != sd::ERR_NO_ERROR {
            bun_output::scoped_log!(dns, "DNSServiceProcessResult: {}", rc);
            // Defunct primary: detach, fail subordinates before freeing the parent (dns_sd.h), destroy.
            let ready = core::mem::take(&mut *this.inflight.borrow_mut());
            drop(Self::detach());
            for inf in ready {
                Self::finish(inf, Some(rc));
            }
            Self::destroy(this);
            return;
        }
        let ready = this.take_ready(|q| q.is_ready());
        this.arm_early_out();
        for inf in ready {
            Self::finish(inf, None);
        }
    }

    /// Remove every in-flight query matching `pred` (dropping the keep-alive if none remain).
    fn take_ready(&self, mut pred: impl FnMut(&mut QueryState) -> bool) -> Vec<Inflight> {
        let mut ready = Vec::new();
        let mut inflight = self.inflight.borrow_mut();
        let mut i = 0;
        while i < inflight.len() {
            if inflight[i].query().with_mut(&mut pred) {
                ready.push(inflight.swap_remove(i));
            } else {
                i += 1;
            }
        }
        if inflight.is_empty() {
            drop(inflight);
            let ctx = self.ctx;
            self.with_file_poll(|p| p.disable_keeping_process_alive(ctx));
        }
        ready
    }

    /// Arm the timer for the nearest early-out deadline (JS thread only; daemon timeout otherwise).
    fn arm_early_out(&self) {
        if !VirtualMachine::is_loaded() {
            return;
        }
        let mut min_deadline: Option<i64> = None;
        for inf in self.inflight.borrow().iter() {
            if let Some(d) = inf.query().get().early_out_deadline_ms() {
                min_deadline = Some(min_deadline.map_or(d, |m| m.min(d)));
            }
        }
        let Some(deadline) = min_deadline else {
            return;
        };
        let armed = self.early_out_armed_for.get();
        if armed != 0 && armed <= deadline {
            return;
        }
        let now = bun::timespec::now(bun::TimespecMockMode::ForceRealTime);
        let next = now.add_ms((deadline - now.ms()).max(1));
        timer_all_mut().update(
            self.early_out_timer.as_ptr(),
            &ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            },
        );
        self.early_out_armed_for.set(deadline);
    }

    /// Timer fire (via dispatch.rs): complete overdue queries.
    pub(crate) fn on_early_out() {
        let Some(this) = Self::current() else {
            return;
        };
        let _exit = event_loop_scope();
        // The heap pops without updating state; mark FIRED so a re-arm inserts instead of removing.
        this.early_out_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        this.early_out_armed_for.set(0);
        let now = now_ms();
        let ready = this.take_ready(|q| {
            let due = q.early_out_deadline_ms().is_some_and(|d| d <= now);
            if due {
                q.give_up_on_stragglers();
            }
            due
        });
        this.arm_early_out();
        for inf in ready {
            Self::finish(inf, None);
        }
    }

    /// Free a connection already removed from `SHARED` with `inflight` empty.
    fn destroy(this: Rc<Self>) {
        debug_assert!(this.inflight.borrow().is_empty());
        if this.early_out_timer.get().state == EventLoopTimerState::ACTIVE
            && VirtualMachine::is_loaded()
        {
            timer_all_mut().remove(this.early_out_timer.as_ptr());
        }
        // Return the `FilePoll` before the primary ref (and any remaining
        // subordinates) is deallocated with `connection`.
        drop(this.file_poll.borrow_mut().take());
        drop(this);
    }

    /// `force_err` drops partial results so teardown rejects instead of resolving.
    fn finish(mut inf: Inflight, force_err: Option<DNSServiceErrorType>) {
        drop(inf.sd_ref.take());
        let retry = inf.query().with_mut(|q| {
            if let Some(e) = force_err {
                q.results.clear();
                q.sd_error = e;
                false
            } else {
                q.should_retry_unsuppressed()
            }
        });
        let inf = if retry {
            match Self::retry_unsuppressed(inf) {
                Ok(()) => return,
                Err(inf) => inf,
            }
        } else {
            inf
        };
        match inf.request {
            InflightRequest::Jsc(r) => GetAddrInfoRequest::complete_dns_sd(r.into_inner()),
            InflightRequest::Internal(r) => internal::dns_sd_complete(r),
        }
    }

    /// Reissue `inf`'s query without SuppressUnusable; hands it back if it couldn't be reissued.
    fn retry_unsuppressed(mut inf: Inflight) -> Result<(), Inflight> {
        let Some(this) = Self::current() else {
            return Err(inf);
        };
        let (protocol, hostname) = {
            let q = inf.query().get();
            (protocol_for_pending(q), q.hostname.clone())
        };
        inf.query().with_mut(|q| q.reset_for_retry(protocol));
        let Some(sub) = inf
            .request
            .issue(&this.connection, protocol, 0, c_str(&hostname))
        else {
            return Err(inf);
        };
        bun_output::scoped_log!(
            dns,
            "retrying {} without SuppressUnusable",
            bstr::BStr::new(hostname.as_bytes())
        );
        inf.sd_ref = Some(sub);
        if this.inflight.borrow().is_empty() {
            let ctx = this.ctx;
            this.with_file_poll(|p| p.enable_keeping_process_alive(ctx));
        }
        this.inflight.borrow_mut().push(inf);
        Ok(())
    }

    /// VM teardown: fail in-flight requests (like c-ares' EDESTRUCTION) and release the fd/FilePoll.
    pub(crate) fn close_for_terminate() {
        let Some(conn) = Self::detach() else {
            return;
        };
        // Subordinates are dealt with (deallocating them) before the parent.
        loop {
            let Some(mut inf) = conn.inflight.borrow_mut().pop() else {
                break;
            };
            match &inf.request {
                // A connect-path lookup lives in the process-wide cache and may
                // have waiters on other threads (and its outcome is cached): this
                // thread going away is not an answer. Finish it on the work pool.
                InflightRequest::Internal(req) => {
                    drop(inf.sd_ref.take());
                    internal::run_on_work_pool(*req);
                }
                // A dns.lookup() from this thread's script: only this VM waits on it.
                InflightRequest::Jsc(_) => Self::finish(inf, Some(sd::ERR_DEFUNCT_CONNECTION)),
            }
        }
        Self::destroy(conn);
    }
}

fn event_loop_scope() -> Option<bun_jsc::event_loop::EventLoopEnterGuard> {
    VirtualMachine::is_loaded().then(|| VirtualMachine::get().enter_event_loop_scope())
}

pub(crate) fn lookup(
    this: ThisPtr<Resolver>,
    query: &GetAddrInfo,
    global_this: &JSGlobalObject,
) -> JSValue {
    bun_core::Environment::only_mac();

    // mDNSResponder answers names; numeric hosts are a parse and AI_V4MAPPED/AI_ALL need getaddrinfo's semantics.
    if getaddrinfo_only_flags(query.options.flags)
        || bun_core::ip_address::to_ip_address(query.name.as_ref()).is_some()
    {
        return lib_c::lookup(this, query, global_this);
    }

    let key = PendingCacheKey::init(query);
    let pending = Resolver::pending_host_cache(&this, PendingCacheField::PendingHostCacheNative);
    let cache = pending.get_or_put(&key);

    if let CacheHit::Inflight(inflight) = cache {
        let dns_lookup = DNSLookup::init(Some(this), global_this);
        let promise = dns_lookup.promise.value();
        pending.append(inflight, dns_lookup);
        return promise;
    }

    let Some(shared) = SharedConnection::get(js_event_loop_ctx()) else {
        if let CacheHit::New(new) = cache {
            drop(pending.take(new));
        }
        return lib_c::lookup(this, query, global_this);
    };

    let protocol = protocol_for_family(query.options.family);
    let request = bun_ptr::OwnedThis::new(*GetAddrInfoRequest::init(
        cache,
        get_addr_info_request::Backend::DnsSd(get_addr_info_request::BackendDnsSd::new(protocol)),
        Some(this),
        global_this,
    ));
    let promise_value = request.head.promise.value();

    let name_z = bun::ZBox::from_bytes(query.name.as_ref());
    // On `None`, dns_sd never accepted it and `start` dropped the request; its
    // slot goes with it (nothing else could have joined it yet).
    let pending_slot = request.pending_slot;
    let Some(()) = shared.start(InflightRequest::Jsc(request), protocol, c_str(&name_z)) else {
        if let Some(pos) = pending_slot {
            drop(pending.take(pos));
        }
        return lib_c::lookup(this, query, global_this);
    };

    Resolver::request_sent(this, this.vm());

    promise_value
}
