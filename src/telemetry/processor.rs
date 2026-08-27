//! The batch span processor: collects per-thread batches, decides when to
//! export (`OTEL_BSP_*` semantics), builds the OTLP request once and fans it
//! out to every configured exporter.

use bun_threading::{Condvar, Guarded, RwLock};
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use crate::batch::LocalBatch;
use crate::clock::MonoInstant;
use crate::{Instrument, ScopeId, otlp};

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
    pub fn retry_later(mut self, exporter: Arc<dyn Exporter>, backoff: Duration) {
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
    fn export_blocking(&self, payload: &ExportPayload, deadline: MonoInstant) -> ExportResult;
    /// Identity of the VM (thread) this exporter is bound to, if any: a
    /// reconfigure on one thread leaves other threads' bound exporters alone.
    fn owner(&self) -> Option<OwnerKey> {
        None
    }
    /// Periodic housekeeping from [`Processor::tick`] (e.g. aborting an
    /// export that has outlived its timeout).
    fn tick(&self, _now: MonoInstant) {}
}

/// A payload an exporter handed back for a later attempt. Parked payloads
/// are not counted in `inflight`, so batching and process exit never wait
/// out a backoff.
struct ParkedRetry {
    exporter: Arc<dyn Exporter>,
    payload: Arc<ExportPayload>,
    attempt: u32,
    due: MonoInstant,
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
    /// Enforce `1 <= max_export_batch_size <= max_queue_size`.
    fn normalized(mut self) -> BatchConfig {
        self.max_queue_size = self.max_queue_size.max(1);
        self.max_export_batch_size = self.max_export_batch_size.clamp(1, self.max_queue_size);
        self
    }
}

/// Spans that can arrive between crossing the batch threshold and the
/// export taking the buffers (one local flush per thread).
const LOCAL_FLUSH_HEADROOM: usize = 64;

struct Pending {
    scopes: Vec<Vec<u8>>,
    /// Buffers from the previous payload, kept for their capacity.
    spare: Vec<Vec<u8>>,
    count: u32,
    /// When the oldest pending span arrived; `None` if empty.
    oldest: Option<MonoInstant>,
}

thread_local! {
    /// This thread is handing payloads to `Exporter::export`. A synchronous
    /// exporter finishing inside that must not re-enter `export()`: it sets
    /// CHAIN_REQUESTED and the outermost dispatcher on this thread chains.
    static DISPATCHING: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
    static CHAIN_REQUESTED: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

/// Run `f` as a dispatch section; true when an exporter that completed
/// synchronously inside it asked for the next batch (outermost section only).
fn dispatching(f: impl FnOnce()) -> bool {
    let outer = DISPATCHING.replace(true);
    f();
    DISPATCHING.set(outer);
    !outer && CHAIN_REQUESTED.take()
}

pub struct Processor {
    pending: Guarded<Pending>,
    /// See [`Processor::exporters_snapshot`] before calling into one.
    exporters: RwLock<Vec<Arc<dyn Exporter>>>,
    retries: Guarded<Vec<ParkedRetry>>,
    /// Spans held by `retries`; they count against `max_queue_size` so an
    /// outage cannot buffer more than the queue would.
    parked_spans: core::sync::atomic::AtomicU32,
    /// Encoded `Resource` body.
    resource: RwLock<Arc<[u8]>>,
    /// Encoded `InstrumentationScope` bodies, indexed by `ScopeId`.
    scopes: RwLock<Vec<Box<[u8]>>>,
    /// Always stored normalized (see [`Processor::set_config`]).
    config: RwLock<BatchConfig>,
    inflight: AtomicUsize,
    /// `take_payload` left part of the batch pending (size cap): the next
    /// completion chains it regardless of size.
    split_remainder: core::sync::atomic::AtomicBool,
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
pub fn global() -> Option<&'static Processor> {
    GLOBAL.get()
}

pub fn global_or_init() -> &'static Processor {
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
                scopes: Vec::new(),
                spare: Vec::new(),
                count: 0,
                oldest: None,
            }),
            exporters: RwLock::new(Vec::new()),
            retries: Guarded::new(Vec::new()),
            parked_spans: core::sync::atomic::AtomicU32::new(0),
            resource: RwLock::new(Arc::from(Vec::new())),
            scopes: RwLock::new(scopes),
            config: RwLock::new(BatchConfig::default().normalized()),
            inflight: AtomicUsize::new(0),
            split_remainder: core::sync::atomic::AtomicBool::new(false),
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
        self.fail_retries_where(|x| Arc::ptr_eq(x, e));
    }

    /// Parked retries of exporters that are going away count as failed.
    fn fail_retries_where(&self, gone: impl Fn(&Arc<dyn Exporter>) -> bool) {
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
            list.retain(keep);
            list.extend(new);
        }
        self.fail_retries_where(|e| !keep(e));
    }

    pub fn exporter_count(&self) -> usize {
        self.exporters.read().len()
    }

    /// Snapshot for calling into exporters. INVARIANT: no `Exporter` method is
    /// ever called while `self.exporters` is locked (exporter callbacks re-enter
    /// the processor, and the lock is writer-preferring).
    fn exporters_snapshot(&self) -> Vec<Arc<dyn Exporter>> {
        self.exporters.read().clone()
    }

    /// [`ExportAttempt::retry_later`]: `payload` goes through `exporter` again
    /// after `backoff`, as attempt `attempt`.
    fn park(
        &'static self,
        exporter: Arc<dyn Exporter>,
        payload: Arc<ExportPayload>,
        attempt: u32,
        backoff: Duration,
    ) {
        let due = MonoInstant::now() + backoff;
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
        });
        self.finish_one();
        // Wake forceFlush() waiters: a flush waiting on this payload sends it
        // again now (`hurry_retries_before`) instead of waiting out the backoff.
        for (_, h) in self.settle_hooks.read().iter() {
            h();
        }
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
                    let (older, rest): (Vec<_>, Vec<_>) =
                        q.drain(..).partition(|r| r.payload.seq < seq);
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
        let chain = dispatching(|| {
            for r in due {
                self.unpark(&r.payload);
                r.exporter.export(self.issue(r.payload, r.attempt));
            }
        });
        if chain {
            self.export();
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
        let mut scopes = self.scopes.write();
        // Linear scan: a process has a handful of tracers.
        for (i, s) in scopes.iter().enumerate().skip(Instrument::COUNT) {
            if **s == *encoded {
                return ScopeId(i as u16);
            }
        }
        if scopes.len() >= u16::MAX as usize {
            return ScopeId::from(Instrument::User);
        }
        scopes.push(encoded.into_boxed_slice());
        ScopeId((scopes.len() - 1) as u16)
    }

    /// Copy a thread's batch into the pending buffers. Returns true when the
    /// batch-size threshold was crossed and the caller should [`export`]
    /// (after releasing its own borrow); otherwise the next `tick` past the
    /// schedule delay exports.
    pub fn accept(&'static self, batch: &LocalBatch) -> bool {
        if crate::is_shut_down() {
            self.stats
                .spans_dropped
                .fetch_add(batch.count as u64, Ordering::Relaxed);
            return false;
        }
        let cfg = *self.config.read();
        let mut p = self.pending.lock();
        if p.count
            .saturating_add(self.parked_spans.load(Ordering::Relaxed))
            >= cfg.max_queue_size
        {
            self.stats
                .spans_dropped
                .fetch_add(batch.count as u64, Ordering::Relaxed);
            return false;
        }
        if p.scopes.len() < batch.scopes.len() {
            p.scopes.resize_with(batch.scopes.len(), Vec::new);
        }
        for (i, buf) in batch.scopes.iter().enumerate() {
            if buf.is_empty() {
                continue;
            }
            let dst = &mut p.scopes[i];
            if dst.capacity() == 0 {
                // First batch for this scope since the last export: size for a
                // full export batch so appends don't regrow.
                let per_span = buf.len() / (batch.count.max(1) as usize) + 1;
                let want = per_span * (cfg.max_export_batch_size as usize + LOCAL_FLUSH_HEADROOM);
                dst.reserve(want.min(8 << 20));
            }
            dst.extend_from_slice(buf);
        }
        if p.count == 0 {
            p.oldest = Some(MonoInstant::now());
        }
        p.count += batch.count;
        // One export in flight at a time (like the SDK's BatchSpanProcessor):
        // while the exporter is busy the queue fills up to `max_queue_size`
        // and then drops, instead of buffering unboundedly in the exporter.
        p.count >= cfg.max_export_batch_size && self.inflight() == 0
    }

    /// Periodic driver; call from each event loop every ~`scheduled_delay`
    /// after flushing its VM's local batch.
    pub fn tick(&'static self) {
        let now = MonoInstant::now();
        for e in self.exporters_snapshot() {
            e.tick(now);
        }
        let cfg = *self.config.read();
        // Decide the timer export before releasing retries, so a parked
        // payload going out does not starve the pending batch.
        let due = self.inflight() == 0 && {
            let p = self.pending.lock();
            p.count > 0
                && p.oldest.is_some_and(|o| {
                    now.since(o) >= Duration::from_millis(u64::from(cfg.scheduled_delay_ms))
                })
        };
        self.dispatch_retries(RetryFilter::Due);
        if due {
            self.export();
        }
    }

    /// The next export request: at most `max_export_batch_size` spans (the
    /// knob bounds every request body, as OTEL_BSP_MAX_EXPORT_BATCH_SIZE is
    /// defined); the rest stays pending for the chained/next export.
    fn take_payload(&self) -> Option<Arc<ExportPayload>> {
        let max = self.config.read().max_export_batch_size;
        let (scopes, count) = {
            let mut p = self.pending.lock();
            let p = &mut *p;
            if p.count == 0 {
                return None;
            }
            let mut spare = core::mem::take(&mut p.spare);
            for v in &mut spare {
                v.clear();
            }
            if p.count <= max {
                let count = p.count;
                p.count = 0;
                p.oldest = None;
                (core::mem::replace(&mut p.scopes, spare), count)
            } else {
                // Split at a span boundary (each encoded span is tag(SS_SPANS)
                // + varint length + body): the first `max` spans leave in the
                // buffers they are in; only the (smaller) remainder is copied
                // out into the spare buffers, which then become `pending`.
                let mut taken = 0u32;
                let mut rest = spare;
                rest.resize_with(p.scopes.len().max(rest.len()), Vec::new);
                for (i, buf) in p.scopes.iter_mut().enumerate() {
                    if buf.is_empty() {
                        continue;
                    }
                    // Each `next()` consumes one `ScopeSpans.spans` entry.
                    let mut r = crate::proto::Reader::new(buf);
                    while r.pos < buf.len() && taken < max {
                        match r.next() {
                            Ok(Some(_)) => taken += 1,
                            _ => break,
                        }
                    }
                    let at = r.pos;
                    if at < buf.len() {
                        rest[i].extend_from_slice(&buf[at..]);
                        buf.truncate(at);
                    }
                }
                p.count -= taken;
                self.split_remainder.store(true, Ordering::Release);
                // `oldest` stays: the remainder is at least that old.
                (core::mem::replace(&mut p.scopes, rest), taken)
            }
        };
        let body = {
            let resource = self.resource();
            let scope_defs = self.scopes.read();
            let chunks: Vec<otlp::ScopeChunk<'_>> = scopes
                .iter()
                .enumerate()
                .filter(|(_, b)| !b.is_empty())
                .map(|(i, b)| otlp::ScopeChunk {
                    scope: scope_defs.get(i).map(|s| &**s).unwrap_or(&[]),
                    spans: b,
                })
                .collect();
            otlp::encode_request(&resource, &chunks)
        };
        {
            let mut p = self.pending.lock();
            if p.spare.is_empty() {
                p.spare = scopes;
            }
        }
        let seq = self.next_seq.fetch_add(1, Ordering::AcqRel);
        self.outstanding.lock().push(seq);
        Some(Arc::new(ExportPayload::new(body, count, seq)))
    }

    /// Export everything pending now, looping past `max_export_batch_size`
    /// (non-blocking); the target a flush then waits for.
    pub fn export_all(&'static self) -> FlushTarget {
        while self.pending_count() != 0 && self.exporter_count() != 0 {
            if !self.export() {
                break;
            }
        }
        FlushTarget(self.next_seq.load(Ordering::Acquire))
    }

    /// Send parked retries older than `t` again now: a live collector gets
    /// the retry at once, a dead one exhausts its attempts instead of holding
    /// a flush for the whole backoff schedule.
    pub fn hurry_retries_before(&'static self, t: FlushTarget) {
        self.dispatch_retries(RetryFilter::OlderThan(t.0));
    }

    /// True once no payload older than `t` is outstanding.
    pub fn settled_before(&self, t: FlushTarget) -> bool {
        self.outstanding.lock().iter().all(|s| *s >= t.0)
    }

    /// Export the next batch now (at most `max_export_batch_size` spans; the
    /// remainder chains). False when nothing was pending or no exporter is
    /// installed.
    pub fn export(&'static self) -> bool {
        let Some(mut payload) = self.take_payload() else {
            return false;
        };
        let mut first = true;
        loop {
            let exporters = self.exporters_snapshot();
            if exporters.is_empty() {
                self.drop_unexported(&payload);
                return !first;
            }
            self.inflight.fetch_add(exporters.len(), Ordering::AcqRel);
            payload.expect(exporters.len());
            // A synchronous exporter (console) completes inside `e.export()`;
            // if a full batch is waiting by then, `finish_one` sets
            // CHAIN_REQUESTED on this thread rather than re-entering, and the
            // outermost dispatch section here runs the next batch.
            let chain = dispatching(|| {
                for e in exporters {
                    e.export(self.issue(Arc::clone(&payload), 0));
                }
            });
            if !chain {
                return true;
            }
            let Some(next) = self.take_payload() else {
                return true;
            };
            payload = next;
            first = false;
        }
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
        }
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
        for (_, h) in self.settle_hooks.read().iter() {
            h();
        }
    }

    fn finish_one(&'static self) {
        if self.inflight.fetch_sub(1, Ordering::AcqRel) == 1 {
            {
                let _g = self.idle_lock.lock();
                self.idle.notify_all();
            }
            // A full batch accumulated while this export was running, or the
            // previous request was cut at max_export_batch_size: chain.
            let cfg = *self.config.read();
            if self.pending_count() >= cfg.max_export_batch_size
                || self.split_remainder.swap(false, Ordering::AcqRel)
            {
                if DISPATCHING.get() {
                    // Inside a dispatch section on this thread (synchronous
                    // exporter): the outermost dispatcher runs the next batch
                    // instead of recursing.
                    CHAIN_REQUESTED.set(true);
                } else {
                    self.export();
                }
            }
        }
    }

    #[inline]
    pub fn inflight(&self) -> usize {
        self.inflight.load(Ordering::Acquire)
    }

    /// Block until no exports are in flight or `timeout` elapses.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
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
                return self.inflight.load(Ordering::Acquire) == 0;
            }
        }
        true
    }

    pub fn config(&self) -> BatchConfig {
        *self.config.read()
    }

    /// Store `cfg` with `1 <= max_export_batch_size <= max_queue_size` enforced.
    pub fn set_config(&self, cfg: BatchConfig) {
        *self.config.write() = cfg.normalized();
    }

    /// Worker-exit path: the pending batch goes synchronously to exporters
    /// owned by `owner` (their event loop is about to disappear) and through
    /// the normal async path to everyone else.
    pub fn flush_for_owner(&'static self, owner: OwnerKey) {
        let deadline =
            MonoInstant::now() + Duration::from_millis(u64::from(self.config().export_timeout_ms));
        let chain = dispatching(|| {
            self.drain_pending(None, |e, payload| {
                if e.owner() == Some(owner) {
                    return Some(e.export_blocking(payload, deadline));
                }
                self.inflight.fetch_add(1, Ordering::AcqRel);
                e.export(self.issue(Arc::clone(payload), 0));
                None
            });
        });
        if chain {
            self.export();
        }
    }

    /// Hand each pending payload to every exporter through `deliver` (a
    /// verdict is recorded; `None` means dispatched asynchronously) until
    /// nothing is pending or `stop_after` has passed.
    fn drain_pending(
        &self,
        stop_after: Option<MonoInstant>,
        mut deliver: impl FnMut(Arc<dyn Exporter>, &Arc<ExportPayload>) -> Option<ExportResult>,
    ) {
        while let Some(payload) = self.take_payload() {
            let exporters = self.exporters_snapshot();
            if exporters.is_empty() {
                self.drop_unexported(&payload);
                continue;
            }
            payload.expect(exporters.len());
            for e in exporters {
                if let Some(result) = deliver(e, &payload) {
                    self.record_result(&payload, result);
                }
            }
            if stop_after.is_some_and(|d| MonoInstant::now() >= d) {
                break;
            }
        }
    }

    /// Process-exit path (caller flushed its VM's local batch): deliver parked
    /// retries and the pending batch synchronously through each exporter's
    /// blocking path, bounded by `export_timeout_ms`.
    pub fn shutdown_blocking(&'static self) {
        let ms = u64::from(self.config().export_timeout_ms);
        self.shutdown_blocking_bounded(Duration::from_millis(ms))
    }

    pub fn shutdown_blocking_bounded(&'static self, budget: Duration) {
        let deadline = MonoInstant::now() + budget;
        let parked = core::mem::take(&mut *self.retries.lock());
        for r in parked {
            self.unpark(&r.payload);
            let result = r.exporter.export_blocking(&r.payload, deadline);
            self.record_result(&r.payload, result);
        }
        self.drain_pending(Some(deadline), |e, p| Some(e.export_blocking(p, deadline)));
        // Anything already handed to async exporters gets the same budget.
        let remaining = deadline.remaining();
        if self.inflight() > 0 && !remaining.is_zero() {
            self.wait_idle(remaining);
        }
    }

    pub fn pending_count(&self) -> u32 {
        self.pending.lock().count
    }
}
