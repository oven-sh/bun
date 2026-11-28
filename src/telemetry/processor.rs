//! The batch span processor: queues the spans of every thread, decides when to
//! export (`OTEL_BSP_*` semantics), builds the OTLP request once and fans it
//! out to every configured exporter.

use bun_threading::{Condvar, Guarded, RwLock};
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;

use crate::clock::MonoInstant;
use crate::otlp::{self, RequestWriter};
use crate::thread::OnDemandThread;
use crate::{Instrument, ScopeId, http_record};

pub struct ExportPayload {
    /// Encoded `ExportTraceServiceRequest`.
    pub body: Vec<u8>,
    pub span_count: u32,
    /// Exporters still to report on this payload, and whether any succeeded:
    /// spans are counted exported/dropped once, when the last one reports.
    pending: core::sync::atomic::AtomicU32,
    any_ok: core::sync::atomic::AtomicBool,
    /// Exporters that have this payload parked for retry.
    parked: core::sync::atomic::AtomicU32,
    /// Those of them that are installed.
    parked_by_installed: core::sync::atomic::AtomicU32,
    seq: u64,
    epoch: u64,
}

impl ExportPayload {
    /// Only `take_payload` mints payloads: it pairs the seq with `outstanding`.
    fn new(body: Vec<u8>, span_count: u32, seq: u64, epoch: u64) -> Self {
        Self {
            body,
            span_count,
            pending: core::sync::atomic::AtomicU32::new(0),
            any_ok: core::sync::atomic::AtomicBool::new(false),
            parked: core::sync::atomic::AtomicU32::new(0),
            parked_by_installed: core::sync::atomic::AtomicU32::new(0),
            seq,
            epoch,
        }
    }
    fn is_parked(&self) -> bool {
        self.parked.load(Ordering::Acquire) != 0
    }

    fn expect(&self, exporters: usize) {
        self.pending.fetch_add(exporters as u32, Ordering::AcqRel);
    }
}

impl Drop for ExportPayload {
    /// The allocator would give the pages back, and the next batch fault them in again.
    fn drop(&mut self) {
        let mut pending = global().pending.lock();
        if pending.spare_body.capacity() == 0 {
            core::mem::swap(&mut pending.spare_body, &mut self.body);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExportResult {
    Success,
    /// Gave up (non-retryable status, retries exhausted, shutdown).
    Failure,
    /// The exporter's VM is going away. The verdicts of the others count.
    Abandoned,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RetryFilter {
    Due,
    OlderThan(u64),
    AllForTheLastTime,
}

#[derive(Clone, Copy)]
pub enum Backoff {
    /// A flush cuts it short.
    Own(Duration),
    /// `Retry-After`. A flush leaves the payload parked, and does not wait for it.
    AskedByServer(Duration),
}

/// One exporter's obligation for one payload. The Processor issues it when it
/// hands a payload out; exactly one of `done`, `retry_later`, `abandoned`
/// finishes it (each consumes the token).
#[must_use = "finish with done(), retry_later() or abandoned()"]
pub struct ExportAttempt {
    processor: &'static Processor,
    payload: Option<Arc<ExportPayload>>,
    /// 0-based delivery attempt.
    attempt: u32,
}

impl ExportAttempt {
    pub fn payload(&self) -> &Arc<ExportPayload> {
        self.payload.as_ref().expect("unfinished ExportAttempt")
    }

    pub fn attempt(&self) -> u32 {
        self.attempt
    }

    /// The exporter's verdict.
    pub fn done(mut self, result: ExportResult) {
        let p = self.payload.take().expect("unfinished ExportAttempt");
        self.processor.record_result(&p, result);
        self.processor.finish_one();
    }

    /// Hand the payload back to go through `exporter` again after `backoff`,
    /// as the next attempt.
    pub fn retry_later(mut self, exporter: Arc<dyn Exporter>, backoff: Backoff) {
        let p = self.payload.take().expect("unfinished ExportAttempt");
        self.processor.park(exporter, p, self.attempt + 1, backoff);
    }

    pub fn abandoned(self) {
        self.done(ExportResult::Abandoned);
    }
}

impl Drop for ExportAttempt {
    fn drop(&mut self) {
        if let Some(p) = self.payload.take() {
            debug_assert!(false, "ExportAttempt dropped unfinished");
            self.processor.record_result(&p, ExportResult::Failure);
            self.processor.finish_one();
        }
    }
}

/// Identity of the VM (JS thread) an exporter or settle hook belongs to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct OwnerKey(core::num::NonZeroUsize);

impl OwnerKey {
    /// Keyed on the address of the owner's per-VM state.
    pub fn of<T>(owner: &T) -> OwnerKey {
        OwnerKey(
            core::num::NonZeroUsize::new(core::ptr::from_ref(owner) as usize).expect("non-null"),
        )
    }
}

/// Every payload taken before this point (see [`Processor::settled_before`]).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FlushTarget(u64);

/// A destination for span batches. Implemented by the runtime for OTLP/HTTP,
/// `console` and JS callback exporters.
pub trait Exporter: Send + Sync {
    /// Deliver `attempt.payload()` without blocking the caller; finish the
    /// attempt exactly once.
    fn export(self: Arc<Self>, attempt: ExportAttempt);
    /// For an exporter with an owner, whose event loop runs no more tasks.
    fn export_now(&self, _payload: &ExportPayload) -> ExportResult {
        ExportResult::Abandoned
    }
    /// Identity of the VM (thread) this exporter is bound to, if any: a
    /// reconfigure on one thread leaves other threads' bound exporters alone.
    fn owner(&self) -> Option<OwnerKey> {
        None
    }
    /// Periodic housekeeping from [`Processor::tick`] (e.g. aborting an
    /// export that has outlived its timeout).
    fn tick(&self, _now: MonoInstant) {}
    /// The attempts that wait for an event loop, which nobody is going to wait for.
    fn take_queued_attempts(&self) -> Vec<ExportAttempt> {
        Vec::new()
    }
    /// The process has waited for as long as it does.
    fn warn_of_unfinished(&self) {}
}

/// A payload an exporter handed back for a later attempt. Parked payloads
/// are not counted in `inflight`, so batching and process exit never wait
/// out a backoff.
struct ParkedRetry {
    exporter: Arc<dyn Exporter>,
    payload: Arc<ExportPayload>,
    attempt: u32,
    due: MonoInstant,
    is_asked_by_server: bool,
    /// What a replaced exporter has left takes no room from the next.
    takes_room: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct BatchConfig {
    pub scheduled_delay_ms: u32,
    pub export_timeout_ms: u32,
    pub max_queue_size: u32,
    pub max_export_batch_size: u32,
}

impl Default for BatchConfig {
    fn default() -> Self {
        BatchConfig {
            scheduled_delay_ms: 5000,
            export_timeout_ms: 30000,
            max_queue_size: 2048,
            max_export_batch_size: 512,
        }
    }
}

impl BatchConfig {
    fn delay(&self) -> Duration {
        Duration::from_millis(self.scheduled_delay_ms.into())
    }

    /// Enforce `1 <= max_export_batch_size <= max_queue_size`. A timeout of 0 is no limit.
    fn normalized(mut self) -> BatchConfig {
        if self.export_timeout_ms == 0 {
            self.export_timeout_ms = u32::MAX;
        }
        self.max_queue_size = self.max_queue_size.max(1);
        self.max_export_batch_size = self.max_export_batch_size.clamp(1, self.max_queue_size);
        self
    }
}

#[derive(Default)]
pub(crate) struct Queue {
    /// `ScopeSpans.spans` entries, by `ScopeId`.
    scopes: Vec<Vec<u8>>,
    pub(crate) requests: http_record::Queue,
}

impl Queue {
    #[inline]
    pub(crate) fn scope(&mut self, scope: ScopeId) -> &mut Vec<u8> {
        let i = scope.0 as usize;
        if i >= self.scopes.len() {
            self.scopes.resize_with(i + 1, Vec::new);
        }
        &mut self.scopes[i]
    }

    fn clear(&mut self) {
        self.scopes.iter_mut().for_each(Vec::clear);
        self.requests.clear();
    }

    /// Goes `n` spans on from `at`, and copies them to `out`.
    fn advance(&self, at: &mut Cursor, n: u32, mut out: Option<&mut Queue>) {
        let requests = out.as_deref_mut().map(|out| &mut out.requests);
        let mut left = n as usize
            - self
                .requests
                .advance(&mut at.requests, n as usize, requests);
        while left > 0
            && let Some(spans) = self.scopes.get(at.scope)
        {
            let mut entries = crate::proto::Reader::new(&spans[at.offset..]);
            while left > 0 && matches!(entries.next(), Ok(Some(_))) {
                left -= 1;
            }
            let passed = &spans[at.offset..][..entries.pos];
            if let Some(out) = out.as_deref_mut().filter(|_| !passed.is_empty()) {
                (out.scope(ScopeId(at.scope as u16))).extend_from_slice(passed);
            }
            at.offset += passed.len();
            if left > 0 {
                (at.scope, at.offset) = (at.scope + 1, 0);
            }
        }
    }

    /// Moves the last `moved` spans, which follow the first `kept`, to `rest`.
    fn split_off_into(&mut self, kept: u32, moved: u32, rest: &mut Queue) {
        let mut end = Cursor::default();
        self.advance(&mut end, kept, None);
        self.advance(&mut end.clone(), moved, Some(rest));
        self.requests.truncate(&end.requests);
        for (i, spans) in self.scopes.iter_mut().enumerate().skip(end.scope) {
            spans.truncate(if i == end.scope { end.offset } else { 0 });
        }
    }

    fn encode(&self, out: Vec<u8>, resource: &[u8], scopes: &[Box<[u8]>]) -> Vec<u8> {
        let encoded = self
            .scopes
            .iter()
            .map(|spans| spans.len() + 64)
            .sum::<usize>();
        let mut request =
            RequestWriter::new(out, resource, encoded + self.requests.encoded_len_hint());
        if self.requests.len() != 0 {
            let scope = &scopes[Instrument::HttpServer as usize];
            request.scope(scope, |out| self.requests.encode(out));
        }
        for (spans, scope) in self.scopes.iter().zip(scopes) {
            if !spans.is_empty() {
                request.scope(scope, |out| out.extend_from_slice(spans));
            }
        }
        request.finish()
    }
}

#[derive(Clone, Default)]
struct Cursor {
    requests: http_record::Cursor,
    scope: usize,
    offset: usize,
}

/// Takes no more spans, so whoever empties it comes to an end.
struct Sealed {
    queue: Queue,
    read: Cursor,
    is_untouched: bool,
    left: u32,
    epoch: u64,
}

struct Pending {
    queue: Queue,
    /// Spans in `queue`.
    open: u32,
    /// Older than `queue`.
    sealed: VecDeque<Sealed>,
    /// Spans in both.
    count: u32,
    /// When the first span of `queue` came.
    opened_at: MonoInstant,
    /// Flushes so far.
    epoch: u64,
    /// The buffers of the previous payload, kept for their capacity.
    spare: Option<Queue>,
    spare_body: Vec<u8>,
    /// Always normalized.
    config: BatchConfig,
}

impl Pending {
    fn seal(&mut self) {
        if self.open != 0 {
            let empty = self.spare.take().unwrap_or_default();
            self.sealed.push_back(Sealed {
                queue: core::mem::replace(&mut self.queue, empty),
                read: Cursor::default(),
                is_untouched: true,
                left: core::mem::take(&mut self.open),
                epoch: self.epoch,
            });
        }
    }

    /// What is pending now is older than the target, and nothing that comes later is.
    fn flush(&mut self) -> FlushTarget {
        self.seal();
        self.epoch += 1;
        FlushTarget(self.epoch)
    }

    fn has_older_than(&self, t: FlushTarget) -> bool {
        (self.sealed.front()).is_some_and(|oldest| oldest.epoch < t.0)
    }

    fn is_due(&self) -> bool {
        !self.sealed.is_empty() || self.open >= self.config.max_export_batch_size
    }

    /// Copies a batch at most.
    fn take_batch(&mut self) -> Option<Batch> {
        let max = self.config.max_export_batch_size;
        if self.sealed.is_empty() {
            if self.open > max && self.open - max <= max {
                let mut rest = self.spare.take().unwrap_or_default();
                self.open -= max;
                self.count -= max;
                self.queue.split_off_into(max, self.open, &mut rest);
                return Some(Batch {
                    spans: core::mem::replace(&mut self.queue, rest),
                    count: max,
                    epoch: self.epoch,
                });
            }
            self.seal();
        }
        let oldest = self.sealed.front()?;
        let epoch = oldest.epoch;
        let (mut spans, mut count) = if oldest.is_untouched && oldest.left <= max {
            (self.sealed.pop_front()).map(|whole| (whole.queue, whole.left))?
        } else {
            (self.spare.take().unwrap_or_default(), 0)
        };
        while count < max
            && let Some(next) = self.sealed.front_mut()
        {
            let n = next.left.min(max - count);
            next.queue.advance(&mut next.read, n, Some(&mut spans));
            next.is_untouched = false;
            next.left -= n;
            count += n;
            if next.left == 0 {
                self.sealed.pop_front();
            }
        }
        self.count -= count;
        Some(Batch {
            spans,
            count,
            epoch,
        })
    }
}

struct Batch {
    spans: Queue,
    count: u32,
    /// Of its oldest span.
    epoch: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Taker {
    /// Takes nothing unless a batch is due and none is in flight.
    Schedule,
    Reconfiguration,
    /// Its own exporters get the batch before the call returns.
    LeavingVm(OwnerKey),
    /// No event loop is waited for.
    ClosingProcess,
}

const LAST_ATTEMPT: u32 = u32::MAX - 1;

/// For [`Exporter::export_now`].
type Calls = Vec<(Arc<dyn Exporter>, Arc<ExportPayload>)>;

pub struct Processor {
    pending: Guarded<Pending>,
    /// See [`Processor::exporters_snapshot`] before calling into one.
    exporters: RwLock<Vec<Arc<dyn Exporter>>>,
    /// Replaced, and alive for as long as they have attempts to finish.
    retired: Guarded<Vec<Weak<dyn Exporter>>>,
    retries: Guarded<Vec<ParkedRetry>>,
    /// Spans held by `retries`; they count against `max_queue_size` so an
    /// outage cannot buffer more than the queue would.
    parked_spans: core::sync::atomic::AtomicU32,
    /// Encoded `Resource` body.
    resource: RwLock<Arc<[u8]>>,
    /// Encoded `InstrumentationScope` bodies, indexed by `ScopeId`.
    scopes: RwLock<Vec<Box<[u8]>>>,
    inflight: AtomicUsize,
    /// The process is exiting: the thread that drains the queue is the only one to take from it.
    is_closing: core::sync::atomic::AtomicBool,
    /// Threads that are handing out a payload.
    exporting: AtomicUsize,
    is_export_scheduled: core::sync::atomic::AtomicBool,
    /// `(epoch, seq)` of the payloads that an exporter has yet to settle.
    outstanding: Guarded<Vec<(u64, u64)>>,
    next_seq: core::sync::atomic::AtomicU64,
    idle: Condvar,
    idle_lock: Guarded<()>,
    pub stats: Stats,
    /// Run whenever a payload settles or is parked for retry; forceFlush()
    /// waiters re-check then. Owners remove theirs with
    /// [`Processor::remove_settle_hooks`].
    settle_hooks: RwLock<Vec<(OwnerKey, Box<dyn Fn() + Send + Sync>)>>,
}

#[derive(Default)]
pub struct Stats {
    pub spans_exported: AtomicU64,
    pub spans_dropped: AtomicU64,
    pub exports_ok: AtomicU64,
    pub exports_failed: AtomicU64,
}

static GLOBAL: OnceLock<Processor> = OnceLock::new();

#[inline]
pub fn global() -> &'static Processor {
    GLOBAL.get_or_init(Processor::new)
}

impl Processor {
    fn new() -> Processor {
        let version = bun_core::Environment::VERSION_STRING;
        let mut scopes: Vec<Box<[u8]>> = Vec::with_capacity(Instrument::COUNT);
        for i in Instrument::ALL {
            scopes.push(
                otlp::encode_scope(i.scope_name().as_bytes(), version.as_bytes())
                    .into_boxed_slice(),
            );
        }
        Processor {
            pending: Guarded::new(Pending {
                opened_at: MonoInstant::now(),
                epoch: 0,
                queue: Queue::default(),
                spare: None,
                spare_body: Vec::new(),
                open: 0,
                sealed: VecDeque::new(),
                count: 0,
                config: BatchConfig::default().normalized(),
            }),
            exporters: RwLock::new(Vec::new()),
            retired: Guarded::new(Vec::new()),
            retries: Guarded::new(Vec::new()),
            parked_spans: core::sync::atomic::AtomicU32::new(0),
            resource: RwLock::new(Arc::from(Vec::new())),
            scopes: RwLock::new(scopes),
            inflight: AtomicUsize::new(0),
            is_closing: core::sync::atomic::AtomicBool::new(false),
            exporting: AtomicUsize::new(0),
            is_export_scheduled: core::sync::atomic::AtomicBool::new(false),
            outstanding: Guarded::new(Vec::new()),
            next_seq: core::sync::atomic::AtomicU64::new(1),
            idle: Condvar::new(),
            idle_lock: Guarded::new(()),
            stats: Stats::default(),
            settle_hooks: RwLock::new(Vec::new()),
        }
    }

    fn issue(&'static self, payload: Arc<ExportPayload>, attempt: u32) -> ExportAttempt {
        ExportAttempt {
            processor: self,
            payload: Some(payload),
            attempt,
        }
    }

    pub fn set_resource(&self, encoded: Vec<u8>) {
        *self.resource.write() = Arc::from(encoded);
    }

    pub fn resource(&self) -> Arc<[u8]> {
        self.resource.read().clone()
    }

    pub fn remove_exporter(&self, e: &Arc<dyn Exporter>) {
        self.exporters.write().retain(|x| !Arc::ptr_eq(x, e));
    }

    /// Add `new`; with `replace_owner`, first drop every exporter not owned by
    /// another VM — in the same write, so a concurrent `export()` never sees
    /// an empty list in between.
    #[optimize(size)]
    pub fn install_exporters(&self, replace_owner: Option<OwnerKey>, new: Vec<Arc<dyn Exporter>>) {
        let Some(owner) = replace_owner else {
            self.exporters.write().extend(new);
            return;
        };
        let keep = |e: &Arc<dyn Exporter>| e.owner().is_some_and(|o| o != owner);
        {
            let mut list = self.exporters.write();
            let replaced = list.extract_if(.., |e| !keep(e));
            let mut retired = self.retired.lock();
            retired.retain(|e| e.strong_count() != 0);
            retired.extend(replaced.map(|e| Arc::downgrade(&e)));
            list.extend(new);
        }
        for r in self.retries.lock().iter_mut() {
            if !self.is_installed(&r.exporter) {
                self.give_room_back(r);
            }
        }
    }

    /// Snapshot for calling into exporters. INVARIANT: no `Exporter` method is
    /// ever called while `self.exporters` is locked (exporter callbacks re-enter
    /// the processor, and the lock is writer-preferring).
    fn exporters_snapshot(&self) -> Vec<Arc<dyn Exporter>> {
        self.exporters.read().clone()
    }

    /// The oldest first.
    fn exporters_with_attempts(&self) -> Vec<Arc<dyn Exporter>> {
        let mut all = Vec::new();
        (self.retired.lock()).retain(|e| e.upgrade().map(|e| all.push(e)).is_some());
        all.extend(self.exporters_snapshot());
        all
    }

    /// [`ExportAttempt::retry_later`]: `payload` goes through `exporter` again
    /// after `backoff`, as attempt `attempt`.
    #[optimize(size)]
    fn park(
        &'static self,
        exporter: Arc<dyn Exporter>,
        payload: Arc<ExportPayload>,
        attempt: u32,
        backoff: Backoff,
    ) {
        if self.is_closing() {
            return exporter.export(self.issue(payload, LAST_ATTEMPT));
        }
        let (Backoff::Own(delay) | Backoff::AskedByServer(delay)) = backoff;
        let due = MonoInstant::now() + delay;
        payload.parked.fetch_add(1, Ordering::AcqRel);
        let mut retries = self.retries.lock();
        let takes_room = self.is_installed(&exporter);
        // Once, however many exporters park it.
        if takes_room && payload.parked_by_installed.fetch_add(1, Ordering::AcqRel) == 0 {
            (self.parked_spans).fetch_add(payload.span_count, Ordering::Relaxed);
        }
        retries.push(ParkedRetry {
            exporter,
            payload,
            attempt,
            due,
            is_asked_by_server: matches!(backoff, Backoff::AskedByServer(_)),
            takes_room,
        });
        drop(retries);
        self.finish_one();
        // Wake forceFlush() waiters: a flush waiting on this payload sends it
        // again now (`hurry_retries_before`) instead of waiting out the backoff.
        self.run_settle_hooks();
    }

    /// `Due`: retries whose backoff has elapsed; `OlderThan`: the parked
    /// retries a forceFlush is waiting on. Backoff already staggers them.
    #[optimize(size)]
    fn dispatch_retries(&'static self, filter: RetryFilter) {
        let due: Vec<ParkedRetry> = {
            let mut q = self.retries.lock();
            if q.is_empty() {
                return;
            }
            match filter {
                RetryFilter::OlderThan(epoch) => {
                    let (older, rest): (Vec<_>, Vec<_>) = q
                        .drain(..)
                        .partition(|r| r.payload.epoch < epoch && !r.is_asked_by_server);
                    *q = rest;
                    if older.is_empty() {
                        return;
                    }
                    older
                }
                RetryFilter::AllForTheLastTime => {
                    q.iter_mut().for_each(|r| r.attempt = LAST_ATTEMPT);
                    core::mem::take(&mut *q)
                }
                RetryFilter::Due => {
                    let now = MonoInstant::now();
                    let (due, later): (Vec<_>, Vec<_>) = q.drain(..).partition(|r| r.due <= now);
                    *q = later;
                    if due.is_empty() {
                        return;
                    }
                    due
                }
            }
        };
        self.inflight.fetch_add(due.len(), Ordering::AcqRel);
        for mut r in due {
            self.give_room_back(&mut r);
            r.payload.parked.fetch_sub(1, Ordering::AcqRel);
            r.exporter.export(self.issue(r.payload, r.attempt));
        }
    }

    fn is_installed(&self, exporter: &Arc<dyn Exporter>) -> bool {
        (self.exporters.read().iter()).any(|e| Arc::ptr_eq(e, exporter))
    }

    fn give_room_back(&self, r: &mut ParkedRetry) {
        if core::mem::take(&mut r.takes_room)
            && r.payload.parked_by_installed.fetch_sub(1, Ordering::AcqRel) == 1
        {
            (self.parked_spans).fetch_sub(r.payload.span_count, Ordering::Relaxed);
        }
    }

    pub fn on_settle(&self, owner: OwnerKey, f: Box<dyn Fn() + Send + Sync>) {
        self.settle_hooks.write().push((owner, f));
    }

    pub fn remove_settle_hooks(&self, owner: OwnerKey) {
        self.settle_hooks.write().retain(|(o, _)| *o != owner);
    }

    /// Instrumentation scope for a user tracer (`Bun.otel.tracer(name, version)`).
    pub fn register_scope(&self, name: &[u8], version: &[u8]) -> ScopeId {
        let encoded = otlp::encode_scope(name, version);
        // A process has a handful of tracers.
        let find = |scopes: &[Box<[u8]>]| {
            let known = scopes[Instrument::COUNT..]
                .iter()
                .position(|s| **s == *encoded);
            known.map(|i| ScopeId((Instrument::COUNT + i) as u16))
        };
        if let Some(known) = find(&self.scopes.read()) {
            return known;
        }
        let mut scopes = self.scopes.write();
        if let Some(known) = find(&scopes) {
            return known;
        }
        if scopes.len() >= u16::MAX as usize {
            return ScopeId::USER;
        }
        scopes.push(encoded.into_boxed_slice());
        ScopeId((scopes.len() - 1) as u16)
    }

    /// `write` appends one span.
    #[inline]
    pub(crate) fn record(&'static self, write: &mut dyn FnMut(&mut Queue)) {
        let mut p = self.pending.lock();
        let queued = (p.count).saturating_add(self.parked_spans.load(Ordering::Relaxed));
        if queued >= p.config.max_queue_size || crate::is_shut_down() {
            self.stats.spans_dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        write(&mut p.queue);
        if p.open == 0 {
            p.opened_at = MonoInstant::now();
        }
        p.open += 1;
        p.count += 1;
        let is_due = p.is_due();
        drop(p);
        if is_due {
            self.schedule_export();
        }
    }

    /// One at a time, as in the SDK: behind a slow exporter the queue fills up and then drops. On another thread:
    /// the caller has requests to serve. False if there is none to be had.
    #[inline]
    fn schedule_export(&self) -> bool {
        static EXPORTS: OnDemandThread = OnDemandThread::new(|| {
            let this = global();
            this.is_export_scheduled.store(false, Ordering::Release);
            this.hand_out_next(Taker::Schedule);
        });
        let has_no_thread = self.inflight() == 0
            && !self.is_export_scheduled.swap(true, Ordering::AcqRel)
            && !EXPORTS.wake();
        if has_no_thread {
            self.is_export_scheduled.store(false, Ordering::Release);
        }
        !has_no_thread
    }

    /// Call it from an event loop, after [`time_to_tick`](Self::time_to_tick).
    pub fn tick(&'static self) {
        let now = MonoInstant::now();
        for e in self.exporters_with_attempts() {
            e.tick(now);
        }
        self.dispatch_retries(RetryFilter::Due);
        let mut p = self.pending.lock();
        if p.sealed.is_empty() && now >= p.opened_at + p.config.delay() {
            p.seal();
        }
        let is_due = p.is_due();
        drop(p);
        if is_due && !self.schedule_export() {
            self.hand_out_next(Taker::Schedule);
        }
    }

    /// Timeouts and retries cannot wait for a long delay.
    pub fn time_to_tick(&self) -> Duration {
        let p = self.pending.lock();
        let until_due = match p.open {
            0 => p.config.delay(),
            _ => (p.opened_at + p.config.delay()).remaining(),
        };
        let timeout = Duration::from_millis(p.config.export_timeout_ms.into());
        (until_due.min(timeout)).clamp(Duration::from_millis(50), Duration::from_secs(1))
    }

    /// With the exporters that it is for. It counts as in flight until the caller calls `finish_one`.
    fn take_payload(&self, taker: Taker) -> Option<(Arc<ExportPayload>, Vec<Arc<dyn Exporter>>)> {
        let mut p = self.pending.lock();
        if taker == Taker::Schedule && !(self.inflight() == 0 && p.is_due()) {
            return None;
        }
        let mut batch = p.take_batch()?;
        // Under the lock: whoever finds the queue empty finds these spans outstanding.
        let seq = self.next_seq.fetch_add(1, Ordering::AcqRel);
        self.outstanding.lock().push((batch.epoch, seq));
        self.inflight.fetch_add(1, Ordering::AcqRel);
        let (resource, exporters) = (self.resource(), self.exporters_snapshot());
        let body = core::mem::take(&mut p.spare_body);
        drop(p);
        let body = batch.spans.encode(body, &resource, &self.scopes.read());
        batch.spans.clear();
        self.pending.lock().spare.get_or_insert(batch.spans);
        let payload = ExportPayload::new(body, batch.count, seq, batch.epoch);
        Some((Arc::new(payload), exporters))
    }

    /// What is pending now, and nothing that comes meanwhile.
    #[optimize(size)]
    fn hand_out_all(&'static self, taker: Taker) -> Calls {
        let target = self.pending.lock().flush();
        let mut calls = Calls::new();
        while self.pending.lock().has_older_than(target)
            && let Some(more) = self.hand_out_next(taker)
        {
            calls.extend(more);
        }
        calls
    }

    #[optimize(size)]
    fn queued_calls(&'static self, of: Option<OwnerKey>) -> Calls {
        let mut calls = Calls::new();
        for e in self.exporters_with_attempts() {
            if of.is_none() || e.owner() == of {
                for mut attempt in e.take_queued_attempts() {
                    calls.extend(attempt.payload.take().map(|p| (Arc::clone(&e), p)));
                    self.finish_one();
                }
            }
        }
        calls
    }

    /// Nobody waits for these: a function may block, or end the process.
    fn make(&self, calls: Calls) {
        for (exporter, payload) in calls {
            self.record_result(&payload, exporter.export_now(&payload));
        }
    }

    /// Until every payload that another thread has taken is with its exporters. That takes encoding and posting.
    fn wait_for_handouts(&self) {
        while self.exporting.load(Ordering::SeqCst) != 0 {
            std::thread::yield_now();
        }
    }

    /// Before the resource or the exporters change.
    pub fn hand_out_pending(&'static self) {
        self.hand_out_all(Taker::Reconfiguration);
        self.wait_for_handouts();
    }

    /// What is pending now is due. See [`settled_before`](Self::settled_before).
    pub fn flush(&'static self) -> FlushTarget {
        let target = self.pending.lock().flush();
        self.schedule_export();
        target
    }

    /// Send parked retries older than `t` again now: a live collector gets
    /// the retry at once, a dead one exhausts its attempts instead of holding
    /// a flush for the whole backoff schedule.
    pub fn hurry_retries_before(&'static self, t: FlushTarget) {
        self.dispatch_retries(RetryFilter::OlderThan(t.0));
    }

    /// True once every payload older than `t` is settled, or only waits because a server asked for it.
    #[optimize(size)]
    pub fn settled_before(&self, t: FlushTarget) -> bool {
        if self.pending.lock().has_older_than(t) {
            return false;
        }
        let retries = self.retries.lock();
        let mut asked: Vec<_> = (retries.iter().filter(|r| r.is_asked_by_server))
            .map(|r| (r.payload.seq, r.payload.pending.load(Ordering::Acquire)))
            .collect();
        asked.sort_unstable();
        let only_waits_for_servers = |seq: u64| {
            let asked = &asked[asked.partition_point(|a| a.0 < seq)..];
            let count = asked.partition_point(|a| a.0 == seq);
            count != 0 && asked[count - 1].1 as usize == count
        };
        (self.outstanding.lock().iter())
            .all(|&(epoch, seq)| epoch >= t.0 || only_waits_for_servers(seq))
    }

    /// `None` if nothing was taken.
    fn hand_out_next(&'static self, taker: Taker) -> Option<Calls> {
        self.exporting.fetch_add(1, Ordering::SeqCst);
        let may_take = taker == Taker::ClosingProcess || !self.is_closing();
        let Some((payload, exporters)) = may_take.then(|| self.take_payload(taker)).flatten()
        else {
            self.exporting.fetch_sub(1, Ordering::SeqCst);
            return None;
        };
        if exporters.is_empty() {
            self.drop_unexported(&payload);
        }
        payload.expect(exporters.len());
        let (blocking, others): (Vec<_>, Vec<_>) =
            exporters.into_iter().partition(|e| match taker {
                Taker::Schedule | Taker::Reconfiguration => false,
                Taker::LeavingVm(owner) => e.owner() == Some(owner),
                Taker::ClosingProcess => e.owner().is_some(),
            });
        for e in others {
            self.inflight.fetch_add(1, Ordering::AcqRel);
            e.export(self.issue(Arc::clone(&payload), 0));
        }
        self.exporting.fetch_sub(1, Ordering::SeqCst);
        self.finish_one();
        Some((blocking.into_iter().map(|e| (e, Arc::clone(&payload)))).collect())
    }

    /// One exporter's verdict on `payload`. `exports_*` count per exporter;
    /// `spans_*` count each span once: exported if any exporter delivered
    /// it, dropped if none did.
    fn record_result(&self, payload: &ExportPayload, result: ExportResult) {
        match result {
            ExportResult::Success => {
                self.stats.exports_ok.fetch_add(1, Ordering::Relaxed);
                payload.any_ok.store(true, Ordering::Relaxed);
            }
            ExportResult::Failure => {
                self.stats.exports_failed.fetch_add(1, Ordering::Relaxed);
            }
            ExportResult::Abandoned => {}
        }
        self.settle(payload);
    }

    /// One exporter is done with `payload` (verdict already noted); when the
    /// last one is, count its spans once.
    fn settle(&self, payload: &ExportPayload) {
        if payload.pending.fetch_sub(1, Ordering::AcqRel) == 1 {
            let counter = if payload.any_ok.load(Ordering::Relaxed) {
                &self.stats.spans_exported
            } else {
                &self.stats.spans_dropped
            };
            counter.fetch_add(payload.span_count as u64, Ordering::Relaxed);
            self.retire(payload);
        } else if payload.is_parked() {
            self.run_settle_hooks();
        }
    }

    fn run_settle_hooks(&self) {
        self.settle_hooks.read().iter().for_each(|(_, hook)| hook());
    }

    /// A payload taken with no exporter to hand it to.
    fn drop_unexported(&self, payload: &ExportPayload) {
        self.stats
            .spans_dropped
            .fetch_add(payload.span_count as u64, Ordering::Relaxed);
        self.retire(payload);
    }

    /// `payload` is done (exported, dropped or abandoned): no longer outstanding.
    fn retire(&self, payload: &ExportPayload) {
        {
            let mut o = self.outstanding.lock();
            if let Some(i) = o.iter().position(|&(_, seq)| seq == payload.seq) {
                o.swap_remove(i);
            }
        }
        self.run_settle_hooks();
    }

    fn finish_one(&'static self) {
        if self.inflight.fetch_sub(1, Ordering::AcqRel) == 1 {
            {
                let _g = self.idle_lock.lock();
                self.idle.notify_all();
            }
            if self.pending.lock().is_due() {
                self.schedule_export();
            }
        }
    }

    #[inline]
    pub fn inflight(&self) -> usize {
        self.inflight.load(Ordering::Acquire)
    }

    #[optimize(size)]
    fn wait_idle(&self, deadline: MonoInstant, is_stuck: &dyn Fn() -> bool) {
        while self.inflight() != 0 && !deadline.remaining().is_zero() && !is_stuck() {
            let now = MonoInstant::now();
            (self.exporters_with_attempts().iter()).for_each(|e| e.tick(now));
            let mut g = self.idle_lock.lock();
            if self.inflight() != 0 {
                let slice = deadline.remaining().min(Duration::from_millis(100));
                let _ = (self.idle).timed_wait_guarded(&mut g, slice.as_nanos() as u64);
            }
        }
    }

    pub fn is_closing(&self) -> bool {
        self.is_closing.load(Ordering::SeqCst)
    }

    pub fn config(&self) -> BatchConfig {
        self.pending.lock().config
    }

    /// Store `cfg` with `1 <= max_export_batch_size <= max_queue_size` enforced.
    pub fn set_config(&self, cfg: BatchConfig) {
        self.pending.lock().config = cfg.normalized();
    }

    /// A VM or its realm goes away: the pending batch goes synchronously to exporters
    /// owned by `owner` (their event loop is about to disappear) and through
    /// the normal async path to everyone else.
    pub fn flush_for_owner(&'static self, owner: OwnerKey) {
        let pending = self.hand_out_all(Taker::LeavingVm(owner));
        self.wait_for_handouts();
        self.make(self.queued_calls(Some(owner)));
        self.make(pending);
    }

    /// The process exits. Blocks for `export_timeout_ms` at most, or until `is_stuck`, which is asked now and then.
    pub fn close(&'static self, is_stuck: &dyn Fn() -> bool) {
        let ms = u64::from(self.config().export_timeout_ms);
        self.close_within(Duration::from_millis(ms), is_stuck);
    }

    /// The process is about to end without exiting, which can fail.
    pub fn flush_blocking(&'static self, budget: Duration, is_stuck: &dyn Fn() -> bool) {
        self.close_within(budget, is_stuck);
        self.is_closing.store(false, Ordering::Release);
    }

    #[optimize(size)]
    fn close_within(&'static self, budget: Duration, is_stuck: &dyn Fn() -> bool) {
        let deadline = MonoInstant::now() + budget;
        self.is_closing.store(true, Ordering::SeqCst);
        self.wait_for_handouts();
        let mut calls = self.queued_calls(None);
        // Twice: a worker may leave its last spans meanwhile.
        for is_first in [true, false] {
            let has_news = self.pending_count() != 0 || !self.retries.lock().is_empty();
            calls.extend(self.hand_out_all(Taker::ClosingProcess));
            self.dispatch_retries(RetryFilter::AllForTheLastTime);
            if is_first || has_news {
                // A collector that hangs uses up the time, so what is sent later gets a little more.
                let grace = MonoInstant::now() + Duration::from_millis(250);
                self.wait_idle(deadline.max(grace), is_stuck);
            }
            // Last: a function may end the process, or write to where the console exporter writes.
            self.make(core::mem::take(&mut calls));
        }
        for e in self.exporters_with_attempts() {
            e.warn_of_unfinished();
        }
    }

    pub fn pending_count(&self) -> u32 {
        self.pending.lock().count
    }

    /// Whether a later [`tick`](Self::tick) has something to do.
    pub fn has_work(&self) -> bool {
        self.pending_count() != 0 || !self.outstanding.lock().is_empty()
    }

    /// Frees the buffers that are only kept for the next batch.
    pub fn release_idle_memory(&self) {
        let mut p = self.pending.lock();
        if p.count == 0 {
            p.queue = Queue::default();
            p.spare = None;
            p.spare_body = Vec::new();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(max: u32) -> Pending {
        Pending {
            queue: Queue::default(),
            open: 0,
            sealed: VecDeque::new(),
            count: 0,
            opened_at: MonoInstant::FAR_FUTURE,
            epoch: 0,
            spare: None,
            spare_body: Vec::new(),
            config: BatchConfig {
                max_export_batch_size: max,
                ..BatchConfig::default()
            },
        }
    }

    fn push(p: &mut Pending, id: u8) {
        crate::proto::write_bytes(p.queue.scope(ScopeId(u16::from(id % 3))), 2, &[id]);
        p.open += 1;
        p.count += 1;
    }

    fn take(p: &mut Pending) -> Option<Vec<u8>> {
        let Batch {
            spans: mut batch,
            count,
            ..
        } = p.take_batch()?;
        let ids: Vec<u8> = (batch.scopes.concat().chunks(3))
            .map(|entry| entry[2])
            .collect();
        assert_eq!(ids.len(), count as usize);
        batch.clear();
        p.spare.get_or_insert(batch);
        Some(ids)
    }

    #[test]
    fn every_span_leaves_once_whatever_the_sizes() {
        for max in 1..6 {
            for total in 0..30 {
                let mut p = pending(max);
                (0..total).for_each(|id| push(&mut p, id));
                let mut seen = Vec::new();
                while let Some(ids) = take(&mut p) {
                    assert!(ids.len() <= max as usize);
                    seen.extend(ids);
                }
                seen.sort_unstable();
                assert_eq!(seen, (0..total).collect::<Vec<_>>());
                assert_eq!((p.count, p.open), (0, 0));
            }
        }
    }

    #[test]
    fn many_small_flushes_make_few_batches() {
        let mut p = pending(4);
        for id in 0..10 {
            push(&mut p, id);
            p.seal();
        }
        let sizes: Vec<_> = core::iter::from_fn(|| take(&mut p))
            .map(|ids| ids.len())
            .collect();
        assert_eq!(sizes, [4, 4, 2]);
    }

    #[test]
    fn what_is_sealed_leaves_before_what_comes_later() {
        let mut p = pending(2);
        (0..5).for_each(|id| push(&mut p, id));
        p.seal();
        let mut seen = Vec::new();
        for late in 100.. {
            push(&mut p, late);
            seen.extend(take(&mut p).unwrap());
            if p.sealed.is_empty() {
                break;
            }
        }
        seen.sort_unstable();
        assert_eq!(seen, [0, 1, 2, 3, 4]);
    }
}
