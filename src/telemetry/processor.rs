//! The batch span processor: queues the spans of every thread, decides when to
//! export (`OTEL_BSP_*` semantics), builds the OTLP request once and fans it
//! out to every configured exporter.

use bun_threading::{Condvar, Guarded, RwLock, WorkPool};
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;

use crate::clock::MonoInstant;
use crate::otlp::{self, RequestWriter};
use crate::{Instrument, ScopeId, http_record};

pub struct ExportPayload {
    /// Encoded `ExportTraceServiceRequest`.
    pub body: Vec<u8>,
    pub span_count: u32,
    /// Exporters still to report on this payload, and whether any succeeded:
    /// spans are counted exported/dropped once, when the last one reports.
    pending: core::sync::atomic::AtomicU32,
    any_ok: core::sync::atomic::AtomicBool,
    /// Exporters that currently have this payload parked for retry (its
    /// spans count against the queue once while this is non-zero).
    parked: core::sync::atomic::AtomicU32,
    /// Creation order; `forceFlush()` waits for every payload up to the ones
    /// it produced (see `Processor::outstanding`).
    seq: u64,
}

impl ExportPayload {
    /// Only `take_payload` mints payloads: it pairs the seq with `outstanding`.
    fn new(body: Vec<u8>, span_count: u32, seq: u64) -> Self {
        Self {
            body,
            span_count,
            pending: core::sync::atomic::AtomicU32::new(0),
            any_ok: core::sync::atomic::AtomicBool::new(false),
            parked: core::sync::atomic::AtomicU32::new(0),
            seq,
        }
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
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RetryFilter {
    Due,
    OlderThan(u64),
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

    /// The owning event loop is gone; stop waiting (not a failure: the
    /// remaining exporters' verdicts count the spans).
    pub fn abandoned(mut self) {
        let p = self.payload.take().expect("unfinished ExportAttempt");
        self.processor.settle(&p);
        self.processor.finish_one();
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
    /// Synchronous best-effort delivery during process exit. Return once the
    /// payload is sent or `deadline` passes.
    fn export_blocking(
        self: Arc<Self>,
        payload: &Arc<ExportPayload>,
        deadline: MonoInstant,
    ) -> ExportResult;
    /// Identity of the VM (thread) this exporter is bound to, if any: a
    /// reconfigure on one thread leaves other threads' bound exporters alone.
    fn owner(&self) -> Option<OwnerKey> {
        None
    }
    /// Periodic housekeeping from [`Processor::tick`] (e.g. aborting an
    /// export that has outlived its timeout).
    fn tick(&self, _now: MonoInstant) {}
    /// The calling thread runs no more tasks, and waits for no other event loop: finish every attempt that
    /// depends on one.
    fn finish_for_exit(&self) {}
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
}

struct Pending {
    queue: Queue,
    /// Spans in `queue`.
    open: u32,
    /// Older than `queue`.
    sealed: VecDeque<Sealed>,
    /// Spans in both.
    count: u32,
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
            });
        }
    }

    fn is_due(&self) -> bool {
        !self.sealed.is_empty() || self.open >= self.config.max_export_batch_size
    }

    /// Copies a batch at most.
    fn take_batch(&mut self) -> Option<(Queue, u32)> {
        let max = self.config.max_export_batch_size;
        if self.sealed.is_empty() {
            if self.open > max && self.open - max <= max {
                let mut rest = self.spare.take().unwrap_or_default();
                self.open -= max;
                self.count -= max;
                self.queue.split_off_into(max, self.open, &mut rest);
                return Some((core::mem::replace(&mut self.queue, rest), max));
            }
            self.seal();
        }
        let oldest = self.sealed.front_mut()?;
        let count = oldest.left.min(max);
        self.count -= count;
        oldest.left -= count;
        if oldest.left == 0 && oldest.is_untouched {
            return self.sealed.pop_front().map(|whole| (whole.queue, count));
        }
        let mut batch = self.spare.take().unwrap_or_default();
        (oldest.queue).advance(&mut oldest.read, count, Some(&mut batch));
        oldest.is_untouched = false;
        if oldest.left == 0 {
            self.sealed.pop_front();
        }
        Some((batch, count))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Take {
    Now,
    IfIdleAndDue,
}

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
    /// Threads inside [`Processor::export`].
    exporting: AtomicUsize,
    is_export_scheduled: core::sync::atomic::AtomicBool,
    /// Sequence numbers of payloads taken and not yet settled by every
    /// exporter (in flight or parked for retry), and the next one to assign.
    outstanding: Guarded<Vec<u64>>,
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
        self.fail_retries_where(&|x| Arc::ptr_eq(x, e));
    }

    /// Parked retries of exporters that are going away count as failed.
    fn fail_retries_where(&self, gone: &dyn Fn(&Arc<dyn Exporter>) -> bool) {
        let dropped: Vec<ParkedRetry> = self
            .retries
            .lock()
            .extract_if(.., |r| gone(&r.exporter))
            .collect();
        for r in dropped {
            self.unpark(&r.payload);
            self.record_result(&r.payload, ExportResult::Failure);
        }
    }

    /// Add `new`; with `replace_owner`, first drop every exporter not owned by
    /// another VM — in the same write, so a concurrent `export()` never sees
    /// an empty list in between.
    pub fn install_exporters(&self, replace_owner: Option<OwnerKey>, new: Vec<Arc<dyn Exporter>>) {
        let Some(owner) = replace_owner else {
            self.exporters.write().extend(new);
            return;
        };
        let keep = |e: &Arc<dyn Exporter>| e.owner().is_some_and(|o| o != owner);
        {
            let mut list = self.exporters.write();
            let replaced = list.extract_if(.., |e| !keep(e));
            (self.retired.lock()).extend(replaced.map(|e| Arc::downgrade(&e)));
            list.extend(new);
        }
        self.fail_retries_where(&|e| !keep(e));
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
    fn park(
        &'static self,
        exporter: Arc<dyn Exporter>,
        payload: Arc<ExportPayload>,
        attempt: u32,
        backoff: Backoff,
    ) {
        let (Backoff::Own(delay) | Backoff::AskedByServer(delay)) = backoff;
        let due = MonoInstant::now() + delay;
        // Counted against the queue once, however many exporters park it.
        if payload.parked.fetch_add(1, Ordering::AcqRel) == 0 {
            self.parked_spans
                .fetch_add(payload.span_count, Ordering::Relaxed);
        }
        self.retries.lock().push(ParkedRetry {
            exporter,
            payload,
            attempt,
            due,
            is_asked_by_server: matches!(backoff, Backoff::AskedByServer(_)),
        });
        self.finish_one();
        // Wake forceFlush() waiters: a flush waiting on this payload sends it
        // again now (`hurry_retries_before`) instead of waiting out the backoff.
        self.run_settle_hooks();
    }

    /// `Due`: retries whose backoff has elapsed; `OlderThan`: the parked
    /// retries a forceFlush is waiting on. Backoff already staggers them.
    fn dispatch_retries(&'static self, filter: RetryFilter) {
        let due: Vec<ParkedRetry> = {
            let mut q = self.retries.lock();
            if q.is_empty() {
                return;
            }
            match filter {
                RetryFilter::OlderThan(seq) => {
                    let (older, rest): (Vec<_>, Vec<_>) = q
                        .drain(..)
                        .partition(|r| r.payload.seq < seq && !r.is_asked_by_server);
                    *q = rest;
                    if older.is_empty() {
                        return;
                    }
                    older
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
        for r in due {
            self.unpark(&r.payload);
            r.exporter.export(self.issue(r.payload, r.attempt));
        }
    }

    fn unpark(&self, payload: &ExportPayload) {
        if payload.parked.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.parked_spans
                .fetch_sub(payload.span_count, Ordering::Relaxed);
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
        p.open += 1;
        p.count += 1;
        let is_due = p.is_due();
        drop(p);
        if is_due {
            self.schedule_export();
        }
    }

    /// One at a time, as in the SDK: behind a slow exporter the queue fills up and then drops. On the work pool:
    /// the caller has requests to serve.
    #[inline]
    fn schedule_export(&'static self) {
        if self.inflight() == 0 && !self.is_export_scheduled.swap(true, Ordering::AcqRel) {
            bun_core::handle_oom(WorkPool::go(self, |this| {
                this.is_export_scheduled.store(false, Ordering::Release);
                this.export(Take::IfIdleAndDue);
            }));
        }
    }

    /// Call it from an event loop every `scheduled_delay_ms`.
    pub fn tick(&'static self) {
        let now = MonoInstant::now();
        for e in self.exporters_with_attempts() {
            e.tick(now);
        }
        self.dispatch_retries(RetryFilter::Due);
        let mut p = self.pending.lock();
        if p.sealed.is_empty() {
            p.seal();
        }
        let is_due = p.is_due();
        drop(p);
        if is_due {
            self.schedule_export();
        }
    }

    /// It counts as in flight until the caller, having handed it out, calls `finish_one`.
    fn take_payload(&self, take: Take) -> Option<Arc<ExportPayload>> {
        let mut p = self.pending.lock();
        if take == Take::IfIdleAndDue && !(self.inflight() == 0 && p.is_due()) {
            return None;
        }
        let (mut batch, count) = p.take_batch()?;
        // Under the lock: whoever finds the queue empty finds these spans outstanding.
        let seq = self.next_seq.fetch_add(1, Ordering::AcqRel);
        self.outstanding.lock().push(seq);
        self.inflight.fetch_add(1, Ordering::AcqRel);
        let resource = self.resource();
        let body = core::mem::take(&mut p.spare_body);
        drop(p);
        let body = batch.encode(body, &resource, &self.scopes.read());
        batch.clear();
        self.pending.lock().spare.get_or_insert(batch);
        Some(Arc::new(ExportPayload::new(body, count, seq)))
    }

    /// Calls `step` until it has taken what is pending now, or returns false.
    fn until_sealed_is_taken(&self, mut step: impl FnMut() -> bool) {
        self.pending.lock().seal();
        while !self.pending.lock().sealed.is_empty() && step() {}
    }

    /// Hands out everything that is pending now. A flush then waits for the target.
    pub fn export_all(&'static self) -> FlushTarget {
        self.until_sealed_is_taken(|| self.export(Take::Now));
        FlushTarget(self.next_seq.load(Ordering::Acquire))
    }

    /// Send parked retries older than `t` again now: a live collector gets
    /// the retry at once, a dead one exhausts its attempts instead of holding
    /// a flush for the whole backoff schedule.
    pub fn hurry_retries_before(&'static self, t: FlushTarget) {
        self.dispatch_retries(RetryFilter::OlderThan(t.0));
    }

    /// True once every payload older than `t` is settled, or only waits because a server asked for it.
    pub fn settled_before(&self, t: FlushTarget) -> bool {
        let retries = self.retries.lock();
        let only_waits_for_servers = |seq: u64| {
            let mut asked =
                (retries.iter()).filter(|r| r.payload.seq == seq && r.is_asked_by_server);
            asked.next().is_some_and(|first| {
                first.payload.pending.load(Ordering::Acquire) as usize == 1 + asked.count()
            })
        };
        (self.outstanding.lock().iter()).all(|&seq| seq >= t.0 || only_waits_for_servers(seq))
    }

    /// False if nothing was taken.
    fn export(&'static self, take: Take) -> bool {
        self.exporting.fetch_add(1, Ordering::SeqCst);
        let exported = !self.is_closing.load(Ordering::SeqCst)
            && self.deliver_next(take, &mut |e, payload| self.start_attempt(e, payload));
        self.exporting.fetch_sub(1, Ordering::SeqCst);
        exported
    }

    fn start_attempt(&'static self, exporter: Arc<dyn Exporter>, payload: &Arc<ExportPayload>) {
        self.inflight.fetch_add(1, Ordering::AcqRel);
        exporter.export(self.issue(Arc::clone(payload), 0));
    }

    /// False if nothing was taken.
    fn deliver_next(
        &'static self,
        take: Take,
        deliver: &mut dyn FnMut(Arc<dyn Exporter>, &Arc<ExportPayload>),
    ) -> bool {
        let Some(payload) = self.take_payload(take) else {
            return false;
        };
        let exporters = self.exporters_snapshot();
        if exporters.is_empty() {
            self.drop_unexported(&payload);
        }
        payload.expect(exporters.len());
        exporters.into_iter().for_each(|e| deliver(e, &payload));
        self.finish_one();
        true
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
        } else if payload.parked.load(Ordering::Acquire) != 0 {
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
            if let Some(i) = o.iter().position(|s| *s == payload.seq) {
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

    /// Block until no exports are in flight or `timeout` elapses.
    fn wait_idle(&self, timeout: Duration) {
        let mut g = self.idle_lock.lock();
        let deadline = MonoInstant::now() + timeout;
        while self.inflight.load(Ordering::Acquire) != 0 {
            let left = deadline.remaining();
            if left.is_zero()
                || self
                    .idle
                    .timed_wait_guarded(&mut g, u64::try_from(left.as_nanos()).unwrap_or(u64::MAX))
                    .is_err()
            {
                return;
            }
        }
    }

    pub fn config(&self) -> BatchConfig {
        self.pending.lock().config
    }

    /// Store `cfg` with `1 <= max_export_batch_size <= max_queue_size` enforced.
    pub fn set_config(&self, cfg: BatchConfig) {
        self.pending.lock().config = cfg.normalized();
    }

    /// Worker-exit path: the pending batch goes synchronously to exporters
    /// owned by `owner` (their event loop is about to disappear) and through
    /// the normal async path to everyone else.
    pub fn flush_for_owner(&'static self, owner: OwnerKey) {
        let deadline =
            MonoInstant::now() + Duration::from_millis(u64::from(self.config().export_timeout_ms));
        for e in self.exporters_with_attempts() {
            if e.owner() == Some(owner) {
                e.finish_for_exit();
            }
        }
        self.until_sealed_is_taken(|| {
            self.deliver_next(Take::Now, &mut |e, payload| {
                if e.owner() == Some(owner) {
                    self.record_result(payload, e.export_blocking(payload, deadline));
                } else {
                    self.start_attempt(e, payload);
                }
            })
        });
    }

    /// The process exits. Blocks for `export_timeout_ms` at most.
    pub fn close(&'static self) {
        let ms = u64::from(self.config().export_timeout_ms);
        self.close_within(Duration::from_millis(ms));
    }

    /// The process is about to end without exiting, which can fail.
    pub fn flush_blocking(&'static self, budget: Duration) {
        self.close_within(budget);
        self.is_closing.store(false, Ordering::Release);
    }

    fn close_within(&'static self, budget: Duration) {
        let deadline = MonoInstant::now() + budget;
        self.is_closing.store(true, Ordering::SeqCst);
        // What they hand out has to be in sight below. They encode and post, and wait for nothing.
        while self.exporting.load(Ordering::SeqCst) != 0 {
            std::thread::yield_now();
        }
        for e in self.exporters_with_attempts() {
            e.finish_for_exit();
        }
        self.until_sealed_is_taken(|| {
            self.deliver_next(Take::Now, &mut |e, payload| {
                self.record_result(payload, e.export_blocking(payload, deadline));
            }) && !deadline.remaining().is_zero()
        });
        self.wait_idle(deadline.remaining());
        // Last: what was in flight may have been parked by now.
        let parked = core::mem::take(&mut *self.retries.lock());
        for r in parked {
            self.unpark(&r.payload);
            let result = r.exporter.export_blocking(&r.payload, deadline);
            self.record_result(&r.payload, result);
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
        let (mut batch, count) = p.take_batch()?;
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
