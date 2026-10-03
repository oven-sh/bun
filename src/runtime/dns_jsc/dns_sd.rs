//! macOS DNSServiceQueryRecord backend: all lookups share one mDNSResponder connection (see dns.rs banner).

use super::*;
use bun_collections::index_sort;

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
pub(crate) const ERR_NO_SUCH_RECORD: DNSServiceErrorType = -65554;
pub(crate) const ERR_TIMEOUT: DNSServiceErrorType = -65568;
const ERR_DEFUNCT_CONNECTION: DNSServiceErrorType = -65569;

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

/// The A and the AAAA subordinate of one lookup; null for a family that was not asked for.
type FamilyRefs = [DNSServiceRef; 2];

fn deallocate_refs(sd_refs: FamilyRefs) {
    for sd_ref in sd_refs {
        if !sd_ref.is_null() {
            // SAFETY: FFI; a non-null entry is a live subordinate that nothing else releases.
            unsafe { DNSServiceRefDeallocate(sd_ref) };
        }
    }
}

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
    /// First hard error (NoSuchRecord/Timeout are per-family negatives, not errors).
    pub(crate) sd_error: DNSServiceErrorType,
    /// A family timed out: an unsuppressed reissue would only wait out the timeout again.
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
            sd_refs: [ptr::null_mut(); 2],
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

    fn deallocate_refs(&mut self) {
        deallocate_refs(core::mem::replace(&mut self.sd_refs, [ptr::null_mut(); 2]));
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
    fn record_reply(
        &mut self,
        flags: DNSServiceFlags,
        interface_index: u32,
        error_code: DNSServiceErrorType,
        rrtype: u16,
        rdata: &[u8],
        ttl: u32,
    ) {
        self.awaiting_more = flags & FLAGS_MORE_COMING != 0;
        // An A/AAAA reply (negatives are typed too) retires its family's bit; a CNAME on the way there retires nothing.
        self.pending_proto &= !match rrtype {
            TYPE_A => PROTOCOL_IPV4,
            TYPE_AAAA => PROTOCOL_IPV6,
            _ => 0,
        };
        match error_code {
            ERR_NO_ERROR if flags & FLAGS_ADD != 0 => {
                if let Some(address) = address_from_record(rrtype, rdata, interface_index) {
                    self.results.push(GetAddrInfoResult {
                        address,
                        ttl: ttl as i32,
                    });
                }
            }
            ERR_NO_ERROR | ERR_NO_SUCH_RECORD => {}
            ERR_TIMEOUT => self.saw_timeout = true,
            _ if self.sd_error == 0 => self.sd_error = error_code,
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

    pub(crate) fn take_results(&mut self) -> bun_dns::ResultList {
        let mut results = core::mem::take(&mut self.results);
        // Family arrival order races upstream; match getaddrinfo's RFC 6724 default (IPv6 first).
        index_sort::sort_slice_by(&mut results, |a, b| {
            (a.address.family() != netc::AF_INET6).cmp(&(b.address.family() != netc::AF_INET6))
        });
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

    /// The `on_reply` that turns `context()` back into this variant.
    fn reply_callback(&self) -> QueryRecordReply {
        match *self {
            Inflight::Jsc(_) => on_reply::<false>,
            Inflight::Internal(_) => on_reply::<true>,
        }
    }

    /// SAFETY: the request behind `self` is live (pinned in `inflight`);
    /// the `&mut` derives from the stored raw pointer, not from a borrow.
    unsafe fn query<'a>(self) -> &'a mut QueryState {
        // SAFETY: caller contract; event-loop thread only.
        unsafe {
            match self {
                Inflight::Jsc(r) => &mut (*r).backend.as_dns_sd_mut().query,
                Inflight::Internal(r) => &mut (*r).dns_sd.query,
            }
        }
    }
}

/// Records a reply; `on_readable` completes. SAFETY: `context` is a live request of the `INTERNAL` kind; `rdata` spans `rdlen` bytes.
unsafe extern "C" fn on_reply<const INTERNAL: bool>(
    _sd_ref: DNSServiceRef,
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
    let owner = if INTERNAL {
        Inflight::Internal(context.cast())
    } else {
        Inflight::Jsc(context.cast())
    };
    // SAFETY: caller contract; the slice is only read before this callback returns.
    let rdata = unsafe { bun::ffi::slice(rdata.cast::<u8>(), rdlen as usize) };
    // SAFETY: caller contract; event-loop thread, and no other borrow of the query is live here.
    unsafe { owner.query() }.record_reply(flags, interface_index, error_code, rrtype, rdata, ttl);
}

/// One per event loop: owns the primary `DNSServiceRef` + `FilePoll`; lookups are ShareConnection subordinates.
pub(crate) struct SharedConnection {
    main_ref: DNSServiceRef,
    file_poll: NonNull<FilePoll>,
    ctx: Async::EventLoopCtx,
    inflight: Vec<Inflight>,
    /// `context` of the previous reply (a different one ends the prior request's contiguous run).
    last_ctx: *mut c_void,
    /// Early-out timer (JS threads only; the daemon timeout backstops other loops).
    pub(crate) early_out_timer: JsCell<EventLoopTimer>,
    /// Deadline the timer is currently armed for (0 = disarmed).
    early_out_armed_for: Cell<i64>,
}

thread_local! {
    static SHARED: Cell<*mut SharedConnection> = const { Cell::new(ptr::null_mut()) };
}

impl SharedConnection {
    /// This thread's connection; don't hold the borrow across `DNSServiceProcessResult`/`finish`.
    fn current<'a>() -> Option<&'a mut Self> {
        // SAFETY: SHARED is null or this thread's live heap connection.
        unsafe { SHARED.get().as_mut() }
    }

    fn file_poll(&mut self) -> &mut FilePoll {
        // SAFETY: `file_poll` is the live hive slot owned by this connection until `destroy`.
        unsafe { self.file_poll.as_mut() }
    }

    /// Lazily connect; `None` (caller falls back to getaddrinfo) if mDNSResponder is unreachable.
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
        let raw_fd = unsafe { DNSServiceRefSockFD(main_ref) };
        if raw_fd < 0 {
            bun_output::scoped_log!(dns, "DNSServiceRefSockFD returned {}", raw_fd);
            // SAFETY: FFI; releasing the ref we just created.
            unsafe { DNSServiceRefDeallocate(main_ref) };
            return None;
        }
        let fd = sys::Fd::from_native(raw_fd);
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

    /// Start `owner`'s queries and track it (keeps the process alive); `false` if the daemon refused.
    pub(crate) fn start(
        &mut self,
        owner: Inflight,
        protocol: DNSServiceProtocol,
        hostname: &ZStr,
    ) -> bool {
        let suppress = addrconfig_flags(protocol);
        let Some(sd_refs) = self.issue(owner, protocol, suppress, hostname) else {
            return false;
        };
        if self.inflight.is_empty() {
            let ctx = self.ctx;
            self.file_poll().enable_keeping_process_alive(ctx);
        }
        // SAFETY: `owner` is the caller's live request, tracked here until `finish()`.
        let q = unsafe { owner.query() };
        q.sd_refs = sd_refs;
        q.attempt = if suppress != 0 {
            Attempt::Suppressed
        } else {
            Attempt::Plain
        };
        q.hostname = bun::ZBox::from_bytes(hostname.as_bytes());
        self.inflight.push(owner);
        true
    }

    /// One query per family in `protocol`, as libinfo does; `None`, with none left running, if the daemon refused one.
    fn issue(
        &mut self,
        owner: Inflight,
        protocol: DNSServiceProtocol,
        suppress: DNSServiceFlags,
        hostname: &ZStr,
    ) -> Option<FamilyRefs> {
        let flags = FLAGS_SHARE_CONNECTION | FLAGS_TIMEOUT | FLAGS_RETURN_INTERMEDIATES | suppress;
        // Sent as given: the daemon tries search domains only for a name with no trailing dot.
        let name = hostname.as_ptr().cast::<c_char>();
        let (callback, context) = (owner.reply_callback(), owner.context());
        let mut sd_refs: FamilyRefs = [ptr::null_mut(); 2];
        let families = [(PROTOCOL_IPV4, TYPE_A), (PROTOCOL_IPV6, TYPE_AAAA)];
        for (i, (family, rrtype)) in families.into_iter().enumerate() {
            if protocol & family == 0 {
                continue;
            }
            // ShareConnection requires `sub` to start as a copy of the primary ref.
            let mut sub: DNSServiceRef = self.main_ref;
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
                        callback,
                        context,
                    ),
                    None => DNSServiceQueryRecord(
                        &raw mut sub,
                        flags,
                        0,
                        name,
                        rrtype,
                        CLASS_IN,
                        callback,
                        context,
                    ),
                }
            };
            if err != ERR_NO_ERROR {
                bun_output::scoped_log!(dns, "DNSServiceQueryRecord failed: {}", err);
                deallocate_refs(sd_refs);
                return None;
            }
            sd_refs[i] = sub;
        }
        Some(sd_refs)
    }

    /// Called first from every reply callback: a different `context` ends the previous request's `MoreComing` run.
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

    /// Socket readable: drain every buffered reply (callbacks fire inline), then finish complete queries.
    pub(crate) fn on_readable(this: *mut Self) {
        // SAFETY: `this` is the live connection registered with the FilePoll.
        let main_ref = unsafe { (*this).main_ref };
        // One scope across `finish()` so the microtask drain runs after we let go of `this`.
        let _exit = event_loop_scope();

        // SAFETY: FFI; `main_ref` is live and no `&mut Self` is held (callbacks use `context`).
        let rc = unsafe { DNSServiceProcessResult(main_ref) };
        let Some(this) = Self::current() else {
            return;
        };
        if rc != ERR_NO_ERROR {
            bun_output::scoped_log!(dns, "DNSServiceProcessResult: {}", rc);
            // Defunct primary: detach, fail subordinates before freeing the parent (dns_sd.h), destroy.
            let ready = core::mem::take(&mut this.inflight);
            let detached = SHARED.replace(ptr::null_mut());
            for inf in ready {
                Self::finish(inf, Some(rc));
            }
            // SAFETY: `detached` was just removed from SHARED and drained.
            unsafe { Self::destroy(detached) };
            return;
        }
        let ready = this.take_ready(|q| q.is_ready());
        this.arm_early_out();
        for inf in ready {
            Self::finish(inf, None);
        }
    }

    /// Remove every in-flight query matching `pred` (dropping the keep-alive if none remain).
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

    /// Arm the timer for the nearest early-out deadline (JS thread only; daemon timeout otherwise).
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
        let now = bun::timespec::now(bun::TimespecMockMode::ForceRealTime);
        let next = now.add_ms((deadline - now.ms()).max(1));
        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: this thread's live RuntimeState; the timer slot is valid until `destroy`.
        unsafe {
            (*state).timer.update(
                core::ptr::addr_of!(self.early_out_timer)
                    .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                    .cast_mut(),
                &ElTimespec {
                    sec: next.sec,
                    nsec: next.nsec,
                },
            )
        };
        self.early_out_armed_for.set(deadline);
    }

    /// Timer fire (via dispatch.rs): complete overdue queries. SAFETY: `this` is the live connection whose timer fired.
    pub(crate) unsafe fn on_early_out(this: *mut Self) {
        // Raw receiver like `on_readable`: `finish()` may re-derive `&mut Self`, so no borrow of `*this` outlives it.
        let _exit = event_loop_scope();
        // SAFETY: `this` is the live connection whose timer fired; each borrow
        // below is scoped to its statement and ends before `finish()`.
        let ready = unsafe {
            // The heap pops without updating state; mark FIRED so a re-arm inserts instead of removing.
            (*this)
                .early_out_timer
                .with_mut(|t| t.state = EventLoopTimerState::FIRED);
            (*this).early_out_armed_for.set(0);
            let now = now_ms();
            let ready = (*this).take_ready(|q| {
                let due = q.early_out_deadline_ms().is_some_and(|d| d <= now);
                if due {
                    q.give_up_on_stragglers();
                }
                due
            });
            (*this).arm_early_out();
            ready
        };
        for inf in ready {
            Self::finish(inf, None);
        }
    }

    /// Free a detached connection. SAFETY: `this` is live, removed from SHARED, `inflight` empty.
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
        // SAFETY: FFI; releases the primary ref (and any remaining subordinates).
        unsafe { DNSServiceRefDeallocate(conn.main_ref) };
        drop(conn);
    }

    /// `force_err` drops partial results so teardown rejects instead of resolving.
    fn finish(inf: Inflight, force_err: Option<DNSServiceErrorType>) {
        // SAFETY: `inf` is a live heap request just removed from `inflight`.
        let q = unsafe { inf.query() };
        q.deallocate_refs();
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

    /// Reissue `inf`'s query without SuppressUnusable; `false` if it couldn't be reissued.
    fn retry_unsuppressed(inf: Inflight) -> bool {
        let Some(this) = Self::current() else {
            return false;
        };
        // SAFETY: `inf` is a live heap request removed from `inflight` by the caller.
        let q = unsafe { inf.query() };
        let (protocol, hostname) = (protocol_for_pending(q), q.hostname.clone());
        q.reset_for_retry(protocol);
        let Some(sd_refs) = this.issue(inf, protocol, 0, &hostname) else {
            return false;
        };
        bun_output::scoped_log!(
            dns,
            "retrying {} without SuppressUnusable",
            bstr::BStr::new(hostname.as_bytes())
        );
        q.sd_refs = sd_refs;
        if this.inflight.is_empty() {
            let ctx = this.ctx;
            this.file_poll().enable_keeping_process_alive(ctx);
        }
        this.inflight.push(inf);
        true
    }

    /// VM teardown: fail in-flight requests (like c-ares' EDESTRUCTION) and release the fd/FilePoll.
    pub(crate) fn close_for_terminate() {
        let this = SHARED.replace(ptr::null_mut());
        // SAFETY: SHARED held null or the live heap connection.
        let Some(conn) = (unsafe { this.as_mut() }) else {
            return;
        };
        // Subordinates are dealt with (deallocating them) before the parent.
        while let Some(inf) = conn.inflight.pop() {
            match inf {
                // A connect-path lookup lives in the process-wide cache and may
                // have waiters on other threads (and its outcome is cached): this
                // thread going away is not an answer. Finish it on the work pool.
                Inflight::Internal(req) => {
                    // SAFETY: `inf` is a live heap request just removed from `inflight`.
                    unsafe { inf.query() }.deallocate_refs();
                    internal::run_on_work_pool(req);
                }
                // A dns.lookup() from this thread's script: only this VM waits on it.
                Inflight::Jsc(_) => Self::finish(inf, Some(ERR_DEFUNCT_CONNECTION)),
            }
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
    context: bun_jsc::ContextId,
) -> JSValue {
    bun_core::Environment::only_mac();

    // mDNSResponder answers names; numeric hosts are a parse and AI_V4MAPPED/AI_ALL need getaddrinfo's semantics.
    if getaddrinfo_only_flags(query.options.flags)
        || bun_core::ip_address::to_ip_address(query.name.as_ref()).is_some()
    {
        return lib_c::lookup(this, query, global_this, context);
    }

    let key = get_addr_info_request::PendingCacheKey::init(query);
    let cache = this.get_or_put_into_pending_cache(&key, PendingCacheField::PendingHostCacheNative);

    if let CacheHit::Inflight(inflight) = cache {
        let dns_lookup = DNSLookup::init(this.as_ctx_ptr(), global_this, context);
        // SAFETY: inflight points into resolver's HiveArray buffer
        unsafe { (*inflight).append(dns_lookup) };
        // SAFETY: `dns_lookup` was just heap-allocated by `DNSLookup::init`.
        return unsafe { (*dns_lookup).promise.value() };
    }

    let Some(shared) = SharedConnection::get(js_event_loop_ctx()) else {
        if let CacheHit::New(new) = cache {
            this.pending_host_cache_native.with_mut(|c| {
                // SAFETY: `new` is the fresh HiveArray slot; no other token for it exists.
                unsafe { c.put(new) };
            });
        }
        return lib_c::lookup(this, query, global_this, context);
    };

    let protocol = protocol_for_family(query.options.family);
    let request = GetAddrInfoRequest::init(
        cache,
        get_addr_info_request::Backend::DnsSd(get_addr_info_request::BackendDnsSd::new(protocol)),
        Some(this.as_ctx_ptr()),
        global_this,
        context,
        PendingCacheField::PendingHostCacheNative,
    );
    // SAFETY: request was just heap-allocated in init() and is exclusively owned here.
    let promise_value = unsafe { (*request).head.promise.value() };

    let name_z = bun::ZBox::from_bytes(query.name.as_ref());
    if !shared.start(Inflight::Jsc(request), protocol, &name_z) {
        // SAFETY: request is exclusively owned; dns_sd never accepted it.
        unsafe {
            if let Some(pos) = (*request).pending_slot {
                this.pending_host_cache_native.with_mut(|c| {
                    let slot = c.ptr_at(pos as usize);
                    // SAFETY: `pos` was alloc'd; no other token outstanding.
                    c.put(slot);
                });
            }
            DNSLookup::destroy(&raw mut (*request).head);
            drop(bun_core::heap::take(request));
        }
        return lib_c::lookup(this, query, global_this, context);
    }

    this.request_sent(this.vm());

    promise_value
}
