//! macOS `DNSServiceGetAddrInfo` backend: every lookup on an event loop is a
//! `kDNSServiceFlagsShareConnection` subordinate multiplexed over one Unix
//! domain socket to mDNSResponder (one fd, one kqueue registration, no
//! per-lookup threads). See the banner in `dns.rs`.

use super::*;

pub(crate) type DNSServiceRef = *mut c_void;
type DNSServiceFlags = u32;
type DNSServiceErrorType = i32;
pub(crate) type DNSServiceProtocol = u32;

pub(crate) const FLAGS_MORE_COMING: DNSServiceFlags = 0x1;
pub(crate) const FLAGS_ADD: DNSServiceFlags = 0x2;
const FLAGS_RETURN_INTERMEDIATES: DNSServiceFlags = 0x1000;
const FLAGS_SHARE_CONNECTION: DNSServiceFlags = 0x4000;
const FLAGS_SUPPRESS_UNUSABLE: DNSServiceFlags = 0x8000;
const FLAGS_TIMEOUT: DNSServiceFlags = 0x10000;

pub(crate) const PROTOCOL_IPV4: DNSServiceProtocol = 0x01;
pub(crate) const PROTOCOL_IPV6: DNSServiceProtocol = 0x02;

pub(crate) const ERR_NO_ERROR: DNSServiceErrorType = 0;
const ERR_NO_SUCH_NAME: DNSServiceErrorType = -65538;
const ERR_NO_MEMORY: DNSServiceErrorType = -65539;
const ERR_REFUSED: DNSServiceErrorType = -65553;
pub(crate) const ERR_NO_SUCH_RECORD: DNSServiceErrorType = -65554;
const ERR_SERVICE_NOT_RUNNING: DNSServiceErrorType = -65563;
const ERR_NO_ROUTER: DNSServiceErrorType = -65566;
pub(crate) const ERR_TIMEOUT: DNSServiceErrorType = -65568;
const ERR_DEFUNCT_CONNECTION: DNSServiceErrorType = -65569;
const ERR_POLICY_DENIED: DNSServiceErrorType = -65570;
const ERR_NOT_PERMITTED: DNSServiceErrorType = -65571;

type GetAddrInfoReply = unsafe extern "C" fn(
    sd_ref: DNSServiceRef,
    flags: DNSServiceFlags,
    interface_index: u32,
    error_code: DNSServiceErrorType,
    hostname: *const c_char,
    address: *const Sockaddr,
    ttl: u32,
    context: *mut c_void,
);

// libsystem_dnssd.dylib is part of the libSystem umbrella and always linked.
unsafe extern "C" {
    fn DNSServiceCreateConnection(sd_ref: *mut DNSServiceRef) -> DNSServiceErrorType;
    fn DNSServiceRefSockFD(sd_ref: DNSServiceRef) -> c_int;
    fn DNSServiceProcessResult(sd_ref: DNSServiceRef) -> DNSServiceErrorType;
    fn DNSServiceRefDeallocate(sd_ref: DNSServiceRef);
    fn DNSServiceGetAddrInfo(
        sd_ref: *mut DNSServiceRef,
        flags: DNSServiceFlags,
        interface_index: u32,
        protocol: DNSServiceProtocol,
        hostname: *const c_char,
        callback: GetAddrInfoReply,
        context: *mut c_void,
    ) -> DNSServiceErrorType;
}

/// Map a DNSServiceErrorType to an EAI_* code so existing error paths
/// (`c_ares::Error::init_eai`, `after_result`) see what they expect.
pub(crate) fn to_eai(err: DNSServiceErrorType) -> c_int {
    match err {
        ERR_NO_ERROR => 0,
        ERR_NO_SUCH_NAME | ERR_NO_SUCH_RECORD => libc::EAI_NONAME,
        ERR_TIMEOUT | ERR_NO_ROUTER | ERR_DEFUNCT_CONNECTION | ERR_SERVICE_NOT_RUNNING => {
            libc::EAI_AGAIN
        }
        ERR_NO_MEMORY => libc::EAI_MEMORY,
        ERR_POLICY_DENIED | ERR_NOT_PERMITTED | ERR_REFUSED => libc::EAI_FAIL,
        _ => libc::EAI_FAIL,
    }
}

pub(crate) fn protocol_for_family(family: bun_dns::Family) -> DNSServiceProtocol {
    match family {
        bun_dns::Family::Inet => PROTOCOL_IPV4,
        bun_dns::Family::Inet6 => PROTOCOL_IPV6,
        // Both explicitly (not 0): completion tracks per-family replies, so
        // the requested set must be known up front.
        _ => PROTOCOL_IPV4 | PROTOCOL_IPV6,
    }
}

pub(crate) fn protocol_for_hints(hints: &AddrInfo) -> DNSServiceProtocol {
    match hints.ai_family {
        f if f == netc::AF_INET => PROTOCOL_IPV4,
        f if f == netc::AF_INET6 => PROTOCOL_IPV6,
        _ => PROTOCOL_IPV4 | PROTOCOL_IPV6,
    }
}

/// Literals getaddrinfo handles itself (`::1`, `127.1`, `0x7f000001`,
/// `fe80::1%en0`); the daemon would query them as hostnames.
pub(crate) fn getaddrinfo_only_name(name: &[u8]) -> bool {
    strings::is_ip_address(name)
        || strings::contains_char(name, b'%')
        // inet_aton forms getaddrinfo accepts: `127.1`, `2130706433`,
        // `0x7f000001`, `0177.0.0.1`.
        || (name.first().is_some_and(|b| b.is_ascii_digit())
            && name
                .iter()
                .all(|b| b.is_ascii_hexdigit() || matches!(*b, b'.' | b'x' | b'X')))
}

/// `hints` bits dns_sd has no equivalent for (AI_V4MAPPED/AI_ALL/…);
/// `AI_ADDRCONFIG` maps to `kDNSServiceFlagsSuppressUnusable` and is
/// handled here.
pub(crate) fn getaddrinfo_only_flags(flags: c_int) -> bool {
    flags & !netc::AI_ADDRCONFIG != 0
}

/// `kDNSServiceFlagsSuppressUnusable` = daemon-side `AI_ADDRCONFIG`: a
/// family with no routable address gets a local `NoSuchRecord` (localhost
/// exempt). libinfo's getaddrinfo sets it too (mdns_module.c).
fn addrconfig_flags(protocol: DNSServiceProtocol) -> DNSServiceFlags {
    if protocol != (PROTOCOL_IPV4 | PROTOCOL_IPV6)
        || env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG
            .get()
            .unwrap_or(false)
    {
        return 0;
    }
    FLAGS_SUPPRESS_UNUSABLE
}

/// libinfo-style bound on waiting for the second family once the first
/// has answered, instead of sitting out the daemon's full query timeout.
const SECOND_FAMILY_EXTRA_MS: i64 = 2000;

/// The suppressed query always asked for both families.
fn protocol_for_pending(_q: &QueryState) -> DNSServiceProtocol {
    PROTOCOL_IPV4 | PROTOCOL_IPV6
}

fn now_ms() -> i64 {
    bun::timespec::now(bun::TimespecMockMode::AllowMockedTime).ms()
}

/// Per-query state for one `DNSServiceGetAddrInfo` subordinate, shared
/// by the JS `dns.lookup` request and the internal connect-path request
/// so both apply identical completion rules.
pub(crate) struct QueryState {
    pub(crate) sd_ref: DNSServiceRef,
    pub(crate) results: bun_dns::ResultList,
    /// First hard `DNSServiceErrorType` (NoSuchRecord/Timeout are
    /// per-family negatives, not errors).
    pub(crate) sd_error: DNSServiceErrorType,
    /// A family reported `kDNSServiceErr_Timeout`; with no results this
    /// is a transient EAI_AGAIN, not a definitive EAI_NONAME.
    saw_timeout: bool,
    /// Last reply carried `MoreComing` and no other request's reply has
    /// followed: more of this answer set is queued daemon-side. (If it never
    /// comes, `kDNSServiceFlagsTimeout` still completes the request.)
    awaiting_more: bool,
    /// `kDNSServiceProtocol_*` bits with no reply yet; any family-tagged
    /// callback (Add, NoSuchRecord, Timeout) clears its bit.
    pub(crate) pending_proto: DNSServiceProtocol,
    /// Answers are in hand but something is outstanding (a silent family, or
    /// a `MoreComing` continuation): the timestamp starts the
    /// `SECOND_FAMILY_EXTRA_MS` early-out. A stale reply for a deallocated
    /// subordinate is dropped by the client stub without a callback, so this
    /// timer is also what clears an orphaned `awaiting_more`.
    partial_at_ms: Option<i64>,
    gave_up_on_pending: bool,
    /// Set when the query was issued with `SuppressUnusable`; an all-empty
    /// answer under it is retried once without the flag before reporting
    /// EAI_NONAME, in case the daemon's usability check false-negatived.
    used_suppress: bool,
    retried: bool,
    /// Kept so `finish()` can reissue the query for the retry.
    hostname: bun::ZBox,
    callback: Option<GetAddrInfoReply>,
}

impl QueryState {
    pub(crate) fn new(protocol: DNSServiceProtocol) -> Self {
        Self {
            sd_ref: ptr::null_mut(),
            results: Default::default(),
            sd_error: 0,
            saw_timeout: false,
            awaiting_more: false,
            pending_proto: protocol,
            partial_at_ms: None,
            gave_up_on_pending: false,
            used_suppress: false,
            retried: false,
            hostname: bun::ZBox::from_bytes(b""),
            callback: None,
        }
    }

    /// A suppressed dual-family query that came back with nothing at all
    /// gets one more try without the suppression.
    fn should_retry_unsuppressed(&self) -> bool {
        self.used_suppress
            && !self.retried
            && self.results.is_empty()
            && self.sd_error == 0
            && !self.saw_timeout
    }

    /// Absorb one callback from `DNSServiceGetAddrInfo`.
    /// SAFETY: `address`, if non-null, points at a valid sockaddr of the
    /// family it declares (guaranteed by dnssd_clientstub for the callback).
    pub(crate) unsafe fn record_reply(
        &mut self,
        flags: DNSServiceFlags,
        error_code: DNSServiceErrorType,
        address: *const Sockaddr,
        ttl: u32,
    ) {
        self.awaiting_more = flags & FLAGS_MORE_COMING != 0;
        // dnssd_clientstub always passes a family-tagged sockaddr for A/AAAA
        // replies (including NoSuchRecord/Timeout); only PolicyDenied is null.
        if address.is_null() {
            if self.sd_error == 0 {
                self.sd_error = error_code;
            }
            return;
        }
        // SAFETY: caller contract.
        let fam = unsafe { (*address).sa_family } as i32;
        // Any reply for a family retires its pending bit; whether the
        // whole answer set has arrived is tracked by `awaiting_more`.
        self.pending_proto &= !if fam == netc::AF_INET6 {
            PROTOCOL_IPV6
        } else {
            PROTOCOL_IPV4
        };
        if error_code == ERR_NO_ERROR && flags & FLAGS_ADD != 0 {
            self.results.push(GetAddrInfoResult {
                // SAFETY: caller contract.
                address: unsafe { bun_dns::Address::init_posix(address.cast()) },
                ttl: ttl as i32,
            });
        } else if error_code == ERR_TIMEOUT {
            self.saw_timeout = true;
        } else if error_code != ERR_NO_ERROR
            && error_code != ERR_NO_SUCH_RECORD
            && self.sd_error == 0
        {
            self.sd_error = error_code;
        }
        let waiting = self.pending_proto != 0 || self.awaiting_more;
        if !self.results.is_empty() && waiting && self.partial_at_ms.is_none() {
            self.partial_at_ms = Some(now_ms());
        } else if !waiting {
            self.partial_at_ms = None;
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        self.sd_error != 0
            || self.gave_up_on_pending
            || (self.pending_proto == 0 && !self.awaiting_more)
    }

    /// Deadline for giving up on whatever is still outstanding (a silent
    /// family, or an unanswered `MoreComing`) once answers are in hand.
    pub(crate) fn early_out_deadline_ms(&self) -> Option<i64> {
        if self.gave_up_on_pending || self.results.is_empty() {
            return None;
        }
        if self.pending_proto == 0 && !self.awaiting_more {
            return None;
        }
        self.partial_at_ms.map(|t| t + SECOND_FAMILY_EXTRA_MS)
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
        // Arrival order across families races (each family is a separate
        // A/AAAA question upstream); getaddrinfo sorted with the RFC 6724
        // default policy, which puts IPv6 first when both are configured.
        results.sort_by_key(|r| r.address.family() != netc::AF_INET6);
        results
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Inflight {
    Jsc(*mut GetAddrInfoRequest),
    Internal(*mut internal::Request),
}

impl Inflight {
    fn context(&self) -> *mut c_void {
        match *self {
            Inflight::Jsc(r) => r.cast(),
            Inflight::Internal(r) => r.cast(),
        }
    }

    /// SAFETY: the request behind `self` is live (pinned in `inflight`).
    unsafe fn query(&self) -> &mut QueryState {
        // SAFETY: caller contract; event-loop thread only.
        unsafe {
            match *self {
                Inflight::Jsc(r) => &mut (*r).backend.as_dns_sd_mut().query,
                Inflight::Internal(r) => &mut (*r).dns_sd.query,
            }
        }
    }
}

/// One per event loop. Owns the primary `DNSServiceRef` and its `FilePoll`;
/// every lookup is a `kDNSServiceFlagsShareConnection` subordinate on it.
pub(crate) struct SharedConnection {
    main_ref: DNSServiceRef,
    file_poll: NonNull<FilePoll>,
    ctx: Async::EventLoopCtx,
    inflight: Vec<Inflight>,
    /// `context` of the previous reply: a request's contiguous run of
    /// replies has ended once a different request's reply follows it.
    last_ctx: *mut c_void,
    /// Runtime-heap timer for `SECOND_FAMILY_EXTRA_MS` early-outs (armed
    /// only on JS threads; the daemon's own timeout is the backstop on the
    /// HTTP-thread loop).
    pub(crate) early_out_timer: JsCell<EventLoopTimer>,
    /// Deadline the timer is currently armed for (0 = disarmed).
    early_out_armed_for: Cell<i64>,
}

bun_event_loop::impl_timer_owner!(SharedConnection; from_early_out_timer_ptr => early_out_timer);

thread_local! {
    static SHARED: Cell<*mut SharedConnection> = const { Cell::new(ptr::null_mut()) };
}

impl SharedConnection {
    /// The connection registered for this thread, if any. Callers must not
    /// hold the returned borrow across a call that can re-enter here
    /// (`DNSServiceProcessResult`, `finish`).
    fn current<'a>() -> Option<&'a mut Self> {
        // SAFETY: SHARED holds either null or the live heap connection for
        // this thread; access is event-loop-thread-only.
        unsafe { SHARED.get().as_mut() }
    }

    fn file_poll(&mut self) -> &mut FilePoll {
        // SAFETY: `file_poll` is the live hive slot set in `get()` and owned
        // by this connection until `destroy`.
        unsafe { self.file_poll.as_mut() }
    }

    /// Lazily create the shared connection for this event loop. Returns
    /// `None` if mDNSResponder is unreachable; the caller falls back to
    /// blocking `getaddrinfo` on the work pool.
    pub(crate) fn get<'a>(ctx: Async::EventLoopCtx) -> Option<&'a mut Self> {
        if let Some(existing) = Self::current() {
            return Some(existing);
        }
        let mut main_ref: DNSServiceRef = ptr::null_mut();
        // SAFETY: FFI; `main_ref` is stack-local.
        let err = unsafe { DNSServiceCreateConnection(&raw mut main_ref) };
        if err != ERR_NO_ERROR || main_ref.is_null() {
            bun_output::scoped_log!(dns, "DNSServiceCreateConnection failed: {}", err);
            return None;
        }
        // SAFETY: FFI; `main_ref` is the live ref just returned above.
        let fd = sys::Fd::from_native(unsafe { DNSServiceRefSockFD(main_ref) });
        let mut this = Box::new(Self {
            main_ref,
            file_poll: NonNull::dangling(),
            ctx,
            inflight: Vec::new(),
            last_ctx: ptr::null_mut(),
            early_out_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::DnsSdConnection,
            )),
            early_out_armed_for: Cell::new(0),
        });
        let poll_ptr = FilePoll::init(
            ctx,
            fd,
            Default::default(),
            Async::Owner::new(
                Async::posix_event_loop::poll_tag::GET_ADDR_INFO_REQUEST,
                (&raw mut *this).cast(),
            ),
        );
        // SAFETY: `FilePoll::init` returned a live pool slot; exclusive here.
        let poll = unsafe { &mut *poll_ptr };
        // SAFETY: the event loop outlives every lookup made on it.
        let loop_ = unsafe { ctx.platform_event_loop() };
        let rc = poll.register_with_fd(
            loop_,
            Async::PollKind::Readable,
            Async::posix_event_loop::OneShotFlag::None,
            fd,
        );
        if rc.is_err() {
            poll.deinit();
            // SAFETY: FFI; `main_ref` is the live connection ref.
            unsafe { DNSServiceRefDeallocate(main_ref) };
            return None;
        }
        this.file_poll = NonNull::new(poll_ptr).unwrap();
        SHARED.set(bun_core::heap::into_raw(this));
        Self::current()
    }

    /// Start a subordinate query and register it in-flight (keeping the
    /// process alive while any is pending). `None` if the daemon rejected it.
    pub(crate) fn start(
        &mut self,
        owner: Inflight,
        protocol: DNSServiceProtocol,
        hostname: &ZStr,
        callback: GetAddrInfoReply,
        context: *mut c_void,
    ) -> Option<DNSServiceRef> {
        let suppress = addrconfig_flags(protocol);
        let sub = self.issue(protocol, suppress, hostname, callback, context)?;
        if self.inflight.is_empty() {
            let ctx = self.ctx;
            self.file_poll().enable_keeping_process_alive(ctx);
        }
        // SAFETY: `owner` is the caller's live request; the connection now
        // tracks it until `finish()`.
        let q = unsafe { owner.query() };
        q.sd_ref = sub;
        q.used_suppress = suppress != 0;
        q.hostname = bun::ZBox::from_bytes(hostname.as_bytes());
        q.callback = Some(callback);
        self.inflight.push(owner);
        Some(sub)
    }

    fn issue(
        &mut self,
        protocol: DNSServiceProtocol,
        suppress: DNSServiceFlags,
        hostname: &ZStr,
        callback: GetAddrInfoReply,
        context: *mut c_void,
    ) -> Option<DNSServiceRef> {
        // `sub` starts as a copy of the primary ref, as ShareConnection
        // requires.
        let mut sub: DNSServiceRef = self.main_ref;
        // SAFETY: FFI; `hostname` is NUL-terminated and copied by dns_sd
        // before returning. `context` is stored, not dereferenced, until
        // a reply arrives inside `on_readable`.
        let err = unsafe {
            DNSServiceGetAddrInfo(
                &raw mut sub,
                FLAGS_SHARE_CONNECTION | FLAGS_TIMEOUT | FLAGS_RETURN_INTERMEDIATES | suppress,
                0,
                protocol,
                hostname.as_ptr().cast::<c_char>(),
                callback,
                context,
            )
        };
        if err != ERR_NO_ERROR {
            bun_output::scoped_log!(dns, "DNSServiceGetAddrInfo failed: {}", err);
            return None;
        }
        Some(sub)
    }

    /// Called first from every reply callback (inside `on_readable`, where no
    /// connection borrow is held): when the wire moves to a different
    /// request, the previous one's contiguous run — and its `MoreComing` —
    /// is over.
    pub(crate) fn note_reply(context: *mut c_void) {
        let Some(this) = Self::current() else {
            return;
        };
        let prev = this.last_ctx;
        if !prev.is_null() && prev != context {
            for inf in this.inflight.iter() {
                if inf.context() == prev {
                    // SAFETY: entries in `inflight` are live requests.
                    unsafe { inf.query() }.awaiting_more = false;
                }
            }
        }
        this.last_ctx = context;
    }

    /// Socket readable: `DNSServiceProcessResult` drains every buffered
    /// reply (firing callbacks inline), then complete queries are finished.
    pub(crate) fn on_readable(this: *mut Self) {
        // SAFETY: `this` is the live connection the FilePoll was registered
        // with; only the primary ref is read here.
        let main_ref = unsafe { (*this).main_ref };
        // One scope across `finish()` so the microtask drain (which may
        // re-enter `start()` or teardown) runs after we let go of `this`.
        let _exit = event_loop_scope();

        // Callbacks reach per-request state via `context`; no `&mut Self`
        // is live across this call.
        // SAFETY: FFI; `main_ref` is the live primary connection.
        let rc = unsafe { DNSServiceProcessResult(main_ref) };
        let Some(this) = Self::current() else {
            return;
        };
        if rc != ERR_NO_ERROR {
            bun_output::scoped_log!(dns, "DNSServiceProcessResult: {}", rc);
            // Primary is defunct: detach so re-entrant lookups reconnect, fail
            // subordinates *before* freeing the parent (dns_sd.h: freeing a
            // parent frees its subordinates), then destroy it.
            let ready = core::mem::take(&mut this.inflight);
            let detached = SHARED.replace(ptr::null_mut());
            for inf in ready {
                Self::finish(inf, Some(rc));
            }
            // SAFETY: `detached` is the connection just removed from
            // `SHARED`, with `inflight` drained above.
            unsafe { Self::destroy(detached) };
            return;
        }
        let ready = this.take_ready(|q| q.is_ready());
        this.arm_early_out();
        for inf in ready {
            Self::finish(inf, None);
        }
    }

    /// Remove every in-flight query matching `pred` (dropping the
    /// keep-alive if none remain) and return them for completion.
    fn take_ready(&mut self, mut pred: impl FnMut(&mut QueryState) -> bool) -> Vec<Inflight> {
        let mut ready = Vec::new();
        let mut i = 0;
        while i < self.inflight.len() {
            // SAFETY: entries in `inflight` are live requests.
            if pred(unsafe { self.inflight[i].query() }) {
                ready.push(self.inflight.swap_remove(i));
            } else {
                i += 1;
            }
        }
        if self.inflight.is_empty() {
            let ctx = self.ctx;
            self.file_poll().disable_keeping_process_alive(ctx);
        }
        ready
    }

    /// Arm the runtime timer for the nearest second-family early-out
    /// deadline among in-flight queries, if any. No-op off the JS thread
    /// (no timer heap there); the daemon timeout still bounds the wait.
    fn arm_early_out(&mut self) {
        if VirtualMachine::get_or_null().is_none() {
            return;
        }
        let mut min_deadline: Option<i64> = None;
        for inf in self.inflight.iter() {
            // SAFETY: entries in `inflight` are live requests.
            if let Some(d) = unsafe { inf.query() }.early_out_deadline_ms() {
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
        let now = bun::timespec::now(bun::TimespecMockMode::AllowMockedTime);
        let next = now.add_ms((deadline - now.ms()).max(1));
        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `state` is this thread's live RuntimeState; the timer slot
        // stays valid until `destroy` unlinks it.
        unsafe {
            (*state).timer.update(
                self.early_out_timer.as_ptr(),
                &ElTimespec {
                    sec: next.sec,
                    nsec: next.nsec,
                },
            )
        };
        self.early_out_armed_for.set(deadline);
    }

    /// Runtime-timer fire (via `dispatch.rs`): complete queries that have
    /// had one family's answers for `SECOND_FAMILY_EXTRA_MS` while the
    /// other family stayed silent.
    pub(crate) fn on_early_out(&mut self) {
        // See `on_readable`: keep one scope open across `finish()`.
        let _exit = event_loop_scope();
        // The heap popped this timer to fire it but leaves the state for the
        // owner to update; mark it so a re-arm below inserts rather than
        // trying to remove an entry that is no longer in the heap.
        self.early_out_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        self.early_out_armed_for.set(0);
        let now = now_ms();
        let ready = self.take_ready(|q| {
            let due = q
                .early_out_deadline_ms()
                .is_some_and(|d| d <= now && !q.results.is_empty());
            if due {
                q.gave_up_on_pending = true;
            }
            due
        });
        self.arm_early_out();
        for inf in ready {
            Self::finish(inf, None);
        }
    }

    /// Free a detached connection with no in-flight sub-refs.
    /// SAFETY: `this` must be the live heap connection, already removed
    /// from `SHARED`, with `inflight` empty; it is freed by this call.
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract.
        let conn = unsafe { bun_core::heap::take(this) };
        debug_assert!(conn.inflight.is_empty());
        if conn.early_out_timer.get().state == EventLoopTimerState::ACTIVE
            && VirtualMachine::get_or_null().is_some()
        {
            // SAFETY: this thread's live RuntimeState owns the timer heap.
            unsafe {
                (*crate::jsc_hooks::runtime_state())
                    .timer
                    .remove(conn.early_out_timer.as_ptr())
            };
        }
        // SAFETY: `file_poll` is the live hive slot; `deinit` returns it.
        unsafe { (*conn.file_poll.as_ptr()).deinit() };
        // SAFETY: FFI; the primary ref (and any remaining subordinates)
        // are released here.
        unsafe { DNSServiceRefDeallocate(conn.main_ref) };
        drop(conn);
    }

    /// `force_err` (defunct connection / teardown) drops partial results
    /// so completion rejects rather than resolving mid-teardown.
    fn finish(inf: Inflight, force_err: Option<DNSServiceErrorType>) {
        // SAFETY: `inf` is a live heap request just removed from
        // `inflight`.
        let q = unsafe { inf.query() };
        // SAFETY: FFI; `sd_ref` is this request's live subordinate.
        unsafe { DNSServiceRefDeallocate(q.sd_ref) };
        if let Some(e) = force_err {
            q.results.clear();
            q.sd_error = e;
        } else if q.should_retry_unsuppressed() && Self::retry_unsuppressed(inf) {
            return;
        }
        match inf {
            Inflight::Jsc(r) => GetAddrInfoRequest::complete_dns_sd(r),
            Inflight::Internal(r) => internal::dns_sd_complete(r),
        }
    }

    /// Reissue `inf`'s query without `SuppressUnusable` and put it back
    /// in-flight. `false` if it could not be reissued.
    fn retry_unsuppressed(inf: Inflight) -> bool {
        let Some(this) = Self::current() else {
            return false;
        };
        // SAFETY: `inf` is a live heap request (removed from `inflight` by
        // the caller); its state is not otherwise borrowed.
        let q = unsafe { inf.query() };
        let (protocol, hostname) = (protocol_for_pending(q), q.hostname.clone());
        let Some(callback) = q.callback else {
            return false;
        };
        q.retried = true;
        q.awaiting_more = false;
        q.partial_at_ms = None;
        q.pending_proto = protocol;
        let Some(sub) = this.issue(protocol, 0, &hostname, callback, inf.context()) else {
            return false;
        };
        bun_output::scoped_log!(
            dns,
            "retrying {} without SuppressUnusable",
            bstr::BStr::new(hostname.as_bytes())
        );
        q.sd_ref = sub;
        if this.inflight.is_empty() {
            let ctx = this.ctx;
            this.file_poll().enable_keeping_process_alive(ctx);
        }
        this.inflight.push(inf);
        true
    }

    /// VM-teardown hook: fail in-flight requests (like c-ares'
    /// `EDESTRUCTION`) and release the fd/FilePoll while the loop is live.
    pub(crate) fn close_for_terminate() {
        let this = SHARED.replace(ptr::null_mut());
        // SAFETY: SHARED held null or the live heap connection.
        let Some(conn) = (unsafe { this.as_mut() }) else {
            return;
        };
        // Subordinates are failed (deallocating them) before the parent.
        while let Some(inf) = conn.inflight.pop() {
            Self::finish(inf, Some(ERR_DEFUNCT_CONNECTION));
        }
        // SAFETY: `this` is detached and drained.
        unsafe { Self::destroy(this) };
    }
}

fn event_loop_scope() -> Option<bun_jsc::event_loop::EventLoopEnterGuard> {
    // SAFETY: the current thread's VM, if any, is live for the callback.
    VirtualMachine::get_or_null().map(|vm| unsafe { (*vm).enter_event_loop_scope() })
}

pub(crate) fn lookup(
    this: &Resolver,
    query: &GetAddrInfo,
    global_this: &JSGlobalObject,
) -> JSValue {
    bun_core::Environment::only_mac();

    if getaddrinfo_only_flags(query.options.flags) || getaddrinfo_only_name(query.name.as_ref()) {
        return lib_c::lookup(this, query, global_this);
    }

    let key = get_addr_info_request::PendingCacheKey::init(query);
    let cache = this.get_or_put_into_pending_cache(&key, PendingCacheField::PendingHostCacheNative);

    if let CacheHit::Inflight(inflight) = cache {
        let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this);
        // SAFETY: inflight points into resolver's HiveArray buffer
        unsafe { (*inflight).append(dns_lookup) };
        // SAFETY: `dns_lookup` was just heap-allocated by `DNSLookup::init`.
        return unsafe { (*dns_lookup).promise.value() };
    }

    let Some(shared) = SharedConnection::get(js_event_loop_ctx()) else {
        if let CacheHit::New(new) = cache {
            this.pending_host_cache_native.with_mut(|c| {
                // SAFETY: `new` is the freshly-allocated HiveArray slot
                // returned by `get_or_put_into_pending_cache`; no other
                // token for it is outstanding.
                unsafe { c.put(new) };
            });
        }
        return lib_c::lookup(this, query, global_this);
    };

    let protocol = protocol_for_family(query.options.family);
    let request = GetAddrInfoRequest::init(
        cache,
        get_addr_info_request::Backend::DnsSd(get_addr_info_request::BackendDnsSd::new(protocol)),
        Some(this.as_ctx_ptr()),
        query,
        global_this,
        PendingCacheField::PendingHostCacheNative,
    );
    // SAFETY: request was just heap-allocated in init() and is exclusively owned here.
    let promise_value = unsafe { (*request).head.promise.value() };

    let name_z = bun::ZBox::from_bytes(query.name.as_ref());
    let Some(_) = shared.start(
        Inflight::Jsc(request),
        protocol,
        &name_z,
        GetAddrInfoRequest::dns_sd_reply,
        request.cast::<c_void>(),
    ) else {
        // SAFETY: request is exclusively owned; dns_sd never accepted it.
        unsafe {
            if (*request).cache.pending_cache() {
                let pos = (*request).cache.pos_in_pending();
                this.pending_host_cache_native.with_mut(|c| {
                    let slot = c.ptr_at(pos as usize);
                    // SAFETY: `pos` was alloc'd; no other token outstanding.
                    c.put(slot);
                });
            }
            DNSLookup::destroy(&raw mut (*request).head);
            drop(bun_core::heap::take(request));
        }
        return lib_c::lookup(this, query, global_this);
    };

    this.request_sent(this.vm());

    promise_value
}
