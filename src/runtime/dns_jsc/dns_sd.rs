//! macOS DNSServiceQueryRecord backend: all lookups share one mDNSResponder connection (see dns.rs banner).

use super::*;
use crate::timer::OwnedTimer;
use bun_collections::index_sort;
use bun_ptr::AliasableBox;
use core::ops::DerefMut;
use core::ptr::NonNull;
use std::sync::Arc;

type DNSServiceRef = *mut c_void;
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

const TYPE_A: u16 = 1;
const TYPE_AAAA: u16 = 28;
const CLASS_IN: u16 = 1;

pub(crate) const ERR_NO_ERROR: DNSServiceErrorType = 0;
pub(crate) const ERR_TIMEOUT: DNSServiceErrorType = -65568;

type QueryRecordReply = unsafe extern "C" fn(
    sd_ref: DNSServiceRef,
    flags: DNSServiceFlags,
    interface_index: u32,
    error_code: DNSServiceErrorType,
    fullname: *const c_char,
    rrtype: u16,
    rrclass: u16,
    rdlen: u16,
    rdata: *const c_void,
    ttl: u32,
    context: *mut c_void,
);

// libsystem_dnssd.dylib is part of the libSystem umbrella and always linked.
unsafe extern "C" {
    fn DNSServiceCreateConnection(sd_ref: *mut DNSServiceRef) -> DNSServiceErrorType;
    fn DNSServiceRefSockFD(sd_ref: DNSServiceRef) -> c_int;
    fn DNSServiceProcessResult(sd_ref: DNSServiceRef) -> DNSServiceErrorType;
    fn DNSServiceRefDeallocate(sd_ref: DNSServiceRef);
    fn DNSServiceQueryRecord(
        sd_ref: *mut DNSServiceRef,
        flags: DNSServiceFlags,
        interface_index: u32,
        fullname: *const c_char,
        rrtype: u16,
        rrclass: u16,
        callback: QueryRecordReply,
        context: *mut c_void,
    ) -> DNSServiceErrorType;
}

/// `DNSServiceQueryRecord` plus an attribute. Absent on macOS 12, so resolved at runtime.
type QueryRecordWithAttributeFn = unsafe extern "C" fn(
    sd_ref: *mut DNSServiceRef,
    flags: DNSServiceFlags,
    interface_index: u32,
    fullname: *const c_char,
    rrtype: u16,
    rrclass: u16,
    attr: *const DNSServiceAttribute,
    callback: QueryRecordReply,
    context: *mut c_void,
) -> DNSServiceErrorType;

/// libinfo's getaddrinfo call: only QueryRecord sends `kDNSServiceAttrAllowFailover` to the daemon (`DNSServiceGetAddrInfoEx` drops it).
fn query_record_allowing_failover()
-> Option<(QueryRecordWithAttributeFn, *const DNSServiceAttribute)> {
    let f = bun_sys::dlsym_with_handle!(
        QueryRecordWithAttributeFn,
        "DNSServiceQueryRecordWithAttribute",
        Some(libc::RTLD_DEFAULT)
    )?;
    let attr = bun_sys::dlsym_with_handle!(
        *const DNSServiceAttribute,
        "kDNSServiceAttrAllowFailover",
        Some(libc::RTLD_DEFAULT)
    )?;
    Some((f, attr))
}

#[repr(C)]
pub(crate) struct DNSServiceAttribute {
    _opaque: [u8; 0],
}

/// No address: libinfo's `getaddrinfo` reports this as EAI_NONAME whatever the daemon's error was.
pub(crate) const EMPTY_STATUS: c_int = libc::EAI_NONAME;

pub(crate) fn protocol_for_family(family: bun_dns::Family) -> DNSServiceProtocol {
    match family {
        bun_dns::Family::Inet => PROTOCOL_IPV4,
        bun_dns::Family::Inet6 => PROTOCOL_IPV6,
        // Both explicitly (not 0): completion tracks per-family replies.
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

/// `hints` bits dns_sd can't express (AI_V4MAPPED/AI_ALL/...); AI_ADDRCONFIG maps to SuppressUnusable.
pub(crate) fn getaddrinfo_only_flags(flags: c_int) -> bool {
    flags & !netc::AI_ADDRCONFIG != 0
}

/// SuppressUnusable = daemon-side AI_ADDRCONFIG (localhost exempt); libinfo's getaddrinfo sets it too.
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

/// libinfo-style bound on waiting for the second family once the first has answered.
const SECOND_FAMILY_EXTRA_MS: i64 = 2000;

/// The suppressed query always asked for both families.
fn protocol_for_pending(_q: &QueryState) -> DNSServiceProtocol {
    PROTOCOL_IPV4 | PROTOCOL_IPV6
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

/// A subordinate has to drop before the primary.
struct OwnedServiceRef(NonNull<c_void>);

impl Drop for OwnedServiceRef {
    fn drop(&mut self) {
        // SAFETY: FFI; made only from a ref that dns_sd just returned.
        unsafe { DNSServiceRefDeallocate(self.0.as_ptr()) };
    }
}

/// The A and the AAAA subordinate of one lookup; `None` for a family that was not asked for.
type FamilyRefs = [Option<OwnedServiceRef>; 2];

/// What dnssd_clientstub's `handle_addrinfo_response` builds: a link-local address is scoped to the interface it was seen on.
fn address_from_record(
    rrtype: u16,
    rdata: &[u8],
    interface_index: u32,
) -> Option<bun_dns::Address> {
    match rrtype {
        TYPE_A => {
            let ip = Ipv4Addr::from(<[u8; 4]>::try_from(rdata).ok()?);
            Some(bun_dns::Address::from_ip(ip.into(), 0))
        }
        TYPE_AAAA => {
            let ip = Ipv6Addr::from(<[u8; 16]>::try_from(rdata).ok()?);
            let mut address = bun_dns::Address::from_ip(ip.into(), 0);
            if ip.is_unicast_link_local() {
                address.set_scope_id(interface_index);
            }
            Some(address)
        }
        _ => None,
    }
}

/// Per-query state shared by the JS `dns.lookup` path and the internal connect path.
pub(crate) struct QueryState {
    sd_refs: FamilyRefs,
    pub(crate) results: bun_dns::ResultList,
    /// A family timed out: an unsuppressed reissue would only wait out the timeout again.
    saw_timeout: bool,
    /// Last reply had `MoreComing` and no other request's reply followed: more is queued daemon-side.
    awaiting_more: bool,
    /// Protocol bits with no reply yet; an address record or any error for a family's question clears its bit.
    pub(crate) pending_proto: DNSServiceProtocol,
    stragglers: Stragglers,
    attempt: Attempt,
    /// Kept so `finish()` can reissue the query for the retry.
    hostname: bun::ZBox,
}

impl QueryState {
    fn new(protocol: DNSServiceProtocol, attempt: Attempt, hostname: bun::ZBox) -> Self {
        Self {
            sd_refs: FamilyRefs::default(),
            results: Default::default(),
            saw_timeout: false,
            awaiting_more: false,
            pending_proto: protocol,
            stragglers: Stragglers::None,
            attempt,
            hostname,
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
        self.attempt == Attempt::Suppressed && self.results.is_empty() && !self.saw_timeout
    }

    /// Absorb one callback for the question `sd_ref`.
    fn record_reply(
        &mut self,
        sd_ref: DNSServiceRef,
        flags: DNSServiceFlags,
        interface_index: u32,
        error_code: DNSServiceErrorType,
        rrtype: u16,
        rdata: &[u8],
        ttl: u32,
    ) {
        self.awaiting_more = flags & FLAGS_MORE_COMING != 0;
        // As in libinfo, any error ends only its own family. The daemon's refusals carry no rrtype, so `sd_ref` names the family.
        if error_code != ERR_NO_ERROR || matches!(rrtype, TYPE_A | TYPE_AAAA) {
            let is_ipv4 = matches!(&self.sd_refs[0], Some(ipv4) if ipv4.0.as_ptr() == sd_ref);
            self.pending_proto &= !if is_ipv4 {
                PROTOCOL_IPV4
            } else {
                PROTOCOL_IPV6
            };
        }
        match error_code {
            ERR_NO_ERROR if flags & FLAGS_ADD != 0 => {
                if let Some(address) = address_from_record(rrtype, rdata, interface_index) {
                    self.results.push(GetAddrInfoResult {
                        address,
                        ttl: ttl as i32,
                    });
                }
            }
            ERR_TIMEOUT => self.saw_timeout = true,
            _ => {}
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
        self.stragglers == Stragglers::GaveUp || (self.pending_proto == 0 && !self.awaiting_more)
    }

    /// Deadline for giving up on stragglers (a silent second family, or a dangling `MoreComing`).
    pub(crate) fn early_out_deadline_ms(&self) -> Option<i64> {
        match self.stragglers {
            Stragglers::Since(t) if self.only_stragglers_left() => Some(t + SECOND_FAMILY_EXTRA_MS),
            _ => None,
        }
    }

    fn take_results(&mut self) -> bun_dns::ResultList {
        let mut results = core::mem::take(&mut self.results);
        // Family arrival order races upstream; match getaddrinfo's RFC 6724 default (IPv6 first).
        index_sort::sort_slice_by(&mut results, |a, b| {
            (a.address.family() != netc::AF_INET6).cmp(&(b.address.family() != netc::AF_INET6))
        });
        results
    }
}

pub(crate) enum Request {
    Jsc(PendingQuery),
    Internal(Arc<internal::Request>),
}

struct Inflight {
    /// Its address is the `context` that `on_reply` receives.
    query: AliasableBox<QueryState>,
    request: Request,
}

impl Inflight {
    fn complete(mut self) {
        let mut results = self.query.take_results();
        match self.request {
            Request::Jsc(pending) => {
                bun_output::scoped_log!(DNSLookup, "completeDnsSd: {}", results.len());
                pending.complete_native(if results.is_empty() {
                    Err(EMPTY_STATUS)
                } else {
                    Ok(results)
                });
            }
            Request::Internal(request) => internal::dns_sd_complete(request, &mut results),
        }
    }
}

/// Records a reply; `on_readable` completes. SAFETY: `context` is the `query` of an `Inflight`; `rdata` spans `rdlen` bytes.
unsafe extern "C" fn on_reply(
    sd_ref: DNSServiceRef,
    flags: DNSServiceFlags,
    interface_index: u32,
    error_code: DNSServiceErrorType,
    _fullname: *const c_char,
    rrtype: u16,
    _rrclass: u16,
    rdlen: u16,
    rdata: *const c_void,
    ttl: u32,
    context: *mut c_void,
) {
    SharedConnection::note_reply(context);
    // SAFETY: caller contract; the slice is only read before this callback returns.
    let rdata = unsafe { bun::ffi::slice(rdata.cast::<u8>(), rdlen as usize) };
    // SAFETY: caller contract; event-loop thread, and no other borrow of the query is live here.
    let query = unsafe { bun_ptr::callback_ctx::<QueryState>(context) };
    query.record_reply(
        sd_ref,
        flags,
        interface_index,
        error_code,
        rrtype,
        rdata,
        ttl,
    );
}

/// One per event loop: owns the primary `DNSServiceRef` + `FilePoll`; lookups are ShareConnection subordinates.
pub(crate) struct SharedConnection {
    /// Before `main_ref`: it holds the subordinate refs, which have to drop first.
    inflight: Vec<Inflight>,
    file_poll: bun_io::OwnedFilePoll,
    /// After `file_poll`, whose fd it closes.
    main_ref: OwnedServiceRef,
    /// `context` of the previous reply (a different one ends the prior request's contiguous run).
    last_ctx: *mut c_void,
    /// Early-out timer (JS threads only; the daemon timeout backstops other loops).
    early_out_timer: OwnedTimer,
    /// Deadline the timer is currently armed for (0 = disarmed).
    early_out_armed_for: Cell<i64>,
}

impl Drop for SharedConnection {
    fn drop(&mut self) {
        debug_assert!(self.inflight.is_empty());
    }
}

thread_local! {
    /// Not dropped when the thread exits: the event loop of `file_poll` can be gone by then.
    static SHARED: ManuallyDrop<Cell<Option<AliasableBox<SharedConnection>>>> =
        const { ManuallyDrop::new(Cell::new(None)) };
}

impl SharedConnection {
    fn take() -> Option<AliasableBox<Self>> {
        SHARED.with(|shared| shared.take())
    }

    fn put_back_on_drop(this: AliasableBox<Self>) -> impl DerefMut<Target = AliasableBox<Self>> {
        scopeguard::guard(this, |this| {
            // Empty, as no guard is live while a connection is made.
            let _ = ManuallyDrop::new(SHARED.with(|shared| shared.replace(Some(this))));
        })
    }

    /// The thread has no connection until this drops, so drop it before `DNSServiceProcessResult`/`finish`.
    fn current() -> Option<impl DerefMut<Target = AliasableBox<Self>>> {
        Self::take().map(Self::put_back_on_drop)
    }

    /// Lazily connect; `None` (caller falls back to getaddrinfo) if mDNSResponder is unreachable.
    pub(crate) fn get(
        ctx: bun_io::EventLoopCtx,
    ) -> Option<impl DerefMut<Target = AliasableBox<Self>>> {
        Self::take()
            .or_else(|| Self::connect(ctx))
            .map(Self::put_back_on_drop)
    }

    fn connect(ctx: bun_io::EventLoopCtx) -> Option<AliasableBox<Self>> {
        let mut main_ref: DNSServiceRef = ptr::null_mut();
        // SAFETY: FFI; `main_ref` is stack-local.
        let err = unsafe { DNSServiceCreateConnection(&raw mut main_ref) };
        let (ERR_NO_ERROR, Some(main_ref)) = (err, NonNull::new(main_ref)) else {
            bun_output::scoped_log!(dns, "DNSServiceCreateConnection failed: {}", err);
            return None;
        };
        let main_ref = OwnedServiceRef(main_ref);
        // SAFETY: FFI; `main_ref` is the live ref just returned above.
        let raw_fd = unsafe { DNSServiceRefSockFD(main_ref.0.as_ptr()) };
        if raw_fd < 0 {
            bun_output::scoped_log!(dns, "DNSServiceRefSockFD returned {}", raw_fd);
            return None;
        }
        let fd = sys::Fd::from_native(raw_fd);
        let owner = bun_io::Owner::new(bun_io::PollTag::GetAddrInfoRequest, ptr::null_mut());
        let this = AliasableBox::new(Self {
            // SAFETY: this tag has no pointee.
            file_poll: unsafe { bun_io::OwnedFilePoll::new(ctx, fd, owner) },
            main_ref,
            inflight: Vec::new(),
            last_ctx: ptr::null_mut(),
            early_out_timer: OwnedTimer::init_paused(EventLoopTimerTag::DnsSdConnection),
            early_out_armed_for: Cell::new(0),
        });
        this.file_poll
            .register(bun_io::PollKind::Readable, false)
            .ok()?;
        Some(this)
    }

    /// Sends the queries; the caller passes the result to `track`. `None` if the daemon refused.
    pub(crate) fn start(
        &mut self,
        protocol: DNSServiceProtocol,
        hostname: bun::ZBox,
    ) -> Option<AliasableBox<QueryState>> {
        let suppress = addrconfig_flags(protocol);
        let attempt = if suppress != 0 {
            Attempt::Suppressed
        } else {
            Attempt::Plain
        };
        let mut query = AliasableBox::new(QueryState::new(protocol, attempt, hostname));
        query.sd_refs = self.issue(&query, protocol, suppress)?;
        Some(query)
    }

    /// Adds the query to `inflight`, which keeps the process alive while it is not empty.
    pub(crate) fn track(&mut self, query: AliasableBox<QueryState>, request: Request) {
        if self.inflight.is_empty() {
            self.file_poll.enable_keeping_process_alive();
        }
        self.inflight.push(Inflight { query, request });
    }

    /// One query per family in `protocol`, as libinfo does; `None`, with none left running, if the daemon refused one.
    fn issue(
        &mut self,
        query: &AliasableBox<QueryState>,
        protocol: DNSServiceProtocol,
        suppress: DNSServiceFlags,
    ) -> Option<FamilyRefs> {
        let flags = FLAGS_SHARE_CONNECTION | FLAGS_TIMEOUT | FLAGS_RETURN_INTERMEDIATES | suppress;
        // Sent as given: the daemon tries search domains only for a name with no trailing dot.
        let name = query.hostname.as_ptr().cast::<c_char>();
        let context = query.as_ptr().cast();
        let mut sd_refs = FamilyRefs::default();
        let families = [(PROTOCOL_IPV4, TYPE_A), (PROTOCOL_IPV6, TYPE_AAAA)];
        for (i, (family, rrtype)) in families.into_iter().enumerate() {
            if protocol & family == 0 {
                continue;
            }
            // ShareConnection requires `sub` to start as a copy of the primary ref.
            let mut sub: DNSServiceRef = self.main_ref.0.as_ptr();
            // SAFETY: FFI; `name` is NUL-terminated (copied by dns_sd); `context` is only stored.
            let err = unsafe {
                match query_record_allowing_failover() {
                    Some((query_record, allow_failover)) => query_record(
                        &raw mut sub,
                        flags,
                        0,
                        name,
                        rrtype,
                        CLASS_IN,
                        allow_failover,
                        on_reply,
                        context,
                    ),
                    None => DNSServiceQueryRecord(
                        &raw mut sub,
                        flags,
                        0,
                        name,
                        rrtype,
                        CLASS_IN,
                        on_reply,
                        context,
                    ),
                }
            };
            if err != ERR_NO_ERROR {
                bun_output::scoped_log!(dns, "DNSServiceQueryRecord failed: {}", err);
                return None;
            }
            sd_refs[i] = NonNull::new(sub).map(OwnedServiceRef);
        }
        Some(sd_refs)
    }

    /// Called first from every reply callback: a different `context` ends the previous request's `MoreComing` run.
    pub(crate) fn note_reply(context: *mut c_void) {
        let Some(mut this) = Self::current() else {
            return;
        };
        let prev = this.last_ctx;
        if !prev.is_null() && prev != context {
            for inf in &mut this.inflight {
                if inf.query.as_ptr().cast() == prev {
                    inf.query.awaiting_more = false;
                }
            }
        }
        this.last_ctx = context;
    }

    /// Socket readable: drain every buffered reply (callbacks fire inline), then finish complete queries.
    pub(crate) fn on_readable() {
        let Some(main_ref) = Self::current().map(|this| this.main_ref.0.as_ptr()) else {
            return;
        };
        // One scope across `finish()` so the microtask drain runs after the last one.
        let _exit = event_loop_scope();

        // SAFETY: FFI; the only callback is `on_reply`, which leaves the connection open.
        let rc = unsafe { DNSServiceProcessResult(main_ref) };
        if rc != ERR_NO_ERROR {
            bun_output::scoped_log!(dns, "DNSServiceProcessResult: {}", rc);
            // Defunct primary: detach, fail subordinates before freeing the parent (dns_sd.h), destroy.
            let Some(mut detached) = Self::take() else {
                return;
            };
            for inf in core::mem::take(&mut detached.inflight) {
                Self::fail(inf);
            }
            return;
        }
        let Some(mut this) = Self::current() else {
            return;
        };
        let ready = this.take_ready(|q| q.is_ready());
        this.arm_early_out();
        drop(this);
        for inf in ready {
            Self::finish(inf);
        }
    }

    /// Remove every in-flight query matching `pred` (dropping the keep-alive if none remain).
    fn take_ready(&mut self, mut pred: impl FnMut(&mut QueryState) -> bool) -> Vec<Inflight> {
        let mut ready = Vec::new();
        let mut i = 0;
        while i < self.inflight.len() {
            if pred(&mut self.inflight[i].query) {
                ready.push(self.inflight.swap_remove(i));
            } else {
                i += 1;
            }
        }
        if self.inflight.is_empty() {
            self.file_poll.disable_keeping_process_alive();
        }
        ready
    }

    /// Arm the timer for the nearest early-out deadline (JS thread only; daemon timeout otherwise).
    fn arm_early_out(&mut self) {
        if !VirtualMachine::is_loaded() {
            return;
        }
        let mut min_deadline: Option<i64> = None;
        for inf in self.inflight.iter() {
            if let Some(d) = inf.query.early_out_deadline_ms() {
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
        crate::jsc_hooks::timer_all()
            .update(OwnedTimer::node(&raw const self.early_out_timer), &next);
        self.early_out_armed_for.set(deadline);
    }

    /// Timer fire (via dispatch.rs): complete overdue queries. SAFETY: the heap has just popped `early_out_timer`.
    pub(crate) unsafe fn on_early_out() {
        let _exit = event_loop_scope();
        let Some(mut this) = Self::current() else {
            return;
        };
        // The heap pops without updating state; mark FIRED so a re-arm inserts instead of removing.
        this.early_out_timer.state.set(EventLoopTimerState::FIRED);
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
        drop(this);
        for inf in ready {
            Self::finish(inf);
        }
    }

    fn finish(mut inf: Inflight) {
        inf.query.sd_refs = FamilyRefs::default();
        if inf.query.should_retry_unsuppressed()
            && let Some(mut this) = Self::current()
            && this.retry_unsuppressed(&mut inf.query)
        {
            return this.track(inf.query, inf.request);
        }
        inf.complete();
    }

    /// The connection is going away: drops partial results so the request rejects instead of resolving.
    fn fail(mut inf: Inflight) {
        inf.query.sd_refs = FamilyRefs::default();
        inf.query.results.clear();
        inf.complete();
    }

    /// Reissue `q` without SuppressUnusable; `false` if it couldn't be reissued.
    fn retry_unsuppressed(&mut self, q: &mut AliasableBox<QueryState>) -> bool {
        let protocol = protocol_for_pending(q);
        q.reset_for_retry(protocol);
        let Some(sd_refs) = self.issue(q, protocol, 0) else {
            return false;
        };
        bun_output::scoped_log!(
            dns,
            "retrying {} without SuppressUnusable",
            bstr::BStr::new(q.hostname.as_bytes())
        );
        q.sd_refs = sd_refs;
        true
    }

    /// VM teardown: fail in-flight requests (like c-ares' EDESTRUCTION) and release the fd/FilePoll.
    pub(crate) fn close_for_terminate() {
        let Some(mut conn) = Self::take() else {
            return;
        };
        // Subordinates are dealt with (deallocating them) before the parent.
        while let Some(inf) = conn.inflight.pop() {
            match inf.request {
                // A connect-path lookup lives in the process-wide cache and may
                // have waiters on other threads (and its outcome is cached): this
                // thread going away is not an answer. Finish it on the work pool.
                Request::Internal(req) => {
                    drop(inf.query);
                    internal::run_on_work_pool(req);
                }
                // A dns.lookup() from this thread's script: only this VM waits on it.
                Request::Jsc(_) => Self::fail(inf),
            }
        }
    }
}

fn event_loop_scope() -> Option<bun_jsc::event_loop::EventLoopEnterGuard<'static>> {
    VirtualMachine::get_or_null().map(VirtualMachine::enter_event_loop_scope)
}

/// Gives `pending` back if mDNSResponder cannot answer it.
pub(crate) fn start(query: &GetAddrInfo, pending: PendingQuery) -> Result<(), PendingQuery> {
    bun_core::Environment::only_mac();

    // mDNSResponder answers names; numeric hosts are a parse and AI_V4MAPPED/AI_ALL need getaddrinfo's semantics.
    if getaddrinfo_only_flags(query.options.flags)
        || bun_core::ip_address::to_ip_address(query.name.as_ref()).is_some()
    {
        return Err(pending);
    }

    let Some(mut shared) = SharedConnection::get(bun_io::js_vm_ctx()) else {
        return Err(pending);
    };

    let protocol = protocol_for_family(query.options.family);
    let Some(state) = shared.start(protocol, bun::ZBox::from_bytes(query.name.as_ref())) else {
        return Err(pending);
    };
    shared.track(state, Request::Jsc(pending));
    Ok(())
}
