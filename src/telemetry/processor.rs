//! The batch span processor: collects per-thread batches, decides when to
//! export (`OTEL_BSP_*` semantics), builds the OTLP request once and fans it
//! out to every configured exporter.

use bun_threading::{Condvar, Guarded, RwLock};
use core::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use crate::batch::LocalBatch;
use crate::{Instrument, ScopeId, clock, otlp};

pub struct ExportPayload {
    /// Encoded `ExportTraceServiceRequest`.
    pub body: Vec<u8>,
    pub span_count: u32,
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
    All,
}

/// A destination for span batches. Implemented by the runtime for OTLP/HTTP,
/// `console` and JS callback exporters.
pub trait Exporter: Send + Sync {
    /// Deliver `payload` (delivery attempt `attempt`, 0-based) without
    /// blocking the calling thread. Finish by calling exactly one of
    /// [`Processor::export_done`] or [`Processor::retry_later`].
    fn export(
        self: Arc<Self>,
        processor: &'static Processor,
        payload: Arc<ExportPayload>,
        attempt: u32,
    );
    /// Synchronous best-effort delivery during process exit. Return once the
    /// payload is sent or `deadline_ns` (clock::now_unix_nanos domain) passes.
    fn export_blocking(&self, payload: &ExportPayload, deadline_ns: u64) -> ExportResult;
}

/// A payload an exporter handed back for a later attempt. Parked payloads
/// are not counted in `inflight`, so batching and process exit never wait
/// out a backoff.
struct ParkedRetry {
    exporter: Arc<dyn Exporter>,
    payload: Arc<ExportPayload>,
    attempt: u32,
    due_ns: u64,
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

/// Spans that can arrive between crossing the batch threshold and the
/// export taking the buffers (one local flush per thread).
const LOCAL_FLUSH_HEADROOM: usize = 64;

struct Pending {
    scopes: Vec<Vec<u8>>,
    /// Buffers from the previous payload, kept for their capacity.
    spare: Vec<Vec<u8>>,
    count: u32,
    /// `clock::now_unix_nanos()` when the oldest pending span arrived; 0 if empty.
    oldest_ns: u64,
}

pub struct Processor {
    pending: Guarded<Pending>,
    exporters: RwLock<Vec<Arc<dyn Exporter>>>,
    retries: Guarded<Vec<ParkedRetry>>,
    /// Encoded `Resource` body.
    resource: RwLock<Arc<[u8]>>,
    /// Encoded `InstrumentationScope` bodies, indexed by `ScopeId`.
    scopes: RwLock<Vec<Box<[u8]>>>,
    scope_names: RwLock<Vec<Box<[u8]>>>,
    pub config: RwLock<BatchConfig>,
    inflight: AtomicUsize,
    idle: Condvar,
    idle_lock: Guarded<()>,
    pub stats: Stats,
    /// `(owner key, hook)`; owners remove theirs with [`Processor::remove_idle_hooks`].
    idle_hooks: RwLock<Vec<(usize, Box<dyn Fn() + Send + Sync>)>>,
}

#[derive(Default)]
pub struct Stats {
    pub spans_exported: AtomicU64,
    pub spans_dropped: AtomicU64,
    pub exports_ok: AtomicU64,
    pub exports_failed: AtomicU64,
    pub last_export_ns: AtomicU64,
    pub generation: AtomicU32,
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
        let mut names: Vec<Box<[u8]>> = Vec::with_capacity(Instrument::COUNT);
        for i in Instrument::ALL {
            scopes.push(
                otlp::encode_scope(i.scope_name().as_bytes(), version.as_bytes())
                    .into_boxed_slice(),
            );
            names.push(i.scope_name().as_bytes().into());
        }
        Processor {
            pending: Guarded::new(Pending {
                scopes: Vec::new(),
                spare: Vec::new(),
                count: 0,
                oldest_ns: 0,
            }),
            exporters: RwLock::new(Vec::new()),
            retries: Guarded::new(Vec::new()),
            resource: RwLock::new(Arc::from(Vec::new())),
            scopes: RwLock::new(scopes),
            scope_names: RwLock::new(names),
            config: RwLock::new(BatchConfig::default()),
            inflight: AtomicUsize::new(0),
            idle: Condvar::new(),
            idle_lock: Guarded::new(()),
            stats: Stats::default(),
            idle_hooks: RwLock::new(Vec::new()),
        }
    }

    pub fn set_resource(&self, encoded: Vec<u8>) {
        *self.resource.write() = Arc::from(encoded);
    }

    pub fn resource(&self) -> Arc<[u8]> {
        self.resource.read().clone()
    }

    pub fn add_exporter(&self, e: Arc<dyn Exporter>) {
        self.exporters.write().push(e);
    }

    pub fn remove_exporter(&self, e: &Arc<dyn Exporter>) {
        self.exporters.write().retain(|x| !Arc::ptr_eq(x, e));
        let mut retries = self.retries.lock();
        let (dropped, kept): (Vec<_>, Vec<_>) = core::mem::take(&mut *retries)
            .into_iter()
            .partition(|r| Arc::ptr_eq(&r.exporter, e));
        *retries = kept;
        drop(retries);
        for r in dropped {
            self.record_result(&r.payload, ExportResult::Failure);
        }
    }

    pub fn clear_exporters(&self) {
        self.exporters.write().clear();
        let parked = core::mem::take(&mut *self.retries.lock());
        for r in parked {
            self.record_result(&r.payload, ExportResult::Failure);
        }
    }

    pub fn exporter_count(&self) -> usize {
        self.exporters.read().len()
    }

    /// Payloads parked for a later retry.
    pub fn pending_retries(&self) -> usize {
        self.retries.lock().len()
    }

    /// Instead of [`Processor::export_done`]: hand `payload` back to be
    /// exported through `exporter` again after `backoff`, as attempt `attempt`.
    pub fn retry_later(
        &self,
        exporter: Arc<dyn Exporter>,
        payload: Arc<ExportPayload>,
        attempt: u32,
        backoff: Duration,
    ) {
        let due_ns = clock::now_unix_nanos().saturating_add(backoff.as_nanos() as u64);
        self.retries.lock().push(ParkedRetry {
            exporter,
            payload,
            attempt,
            due_ns,
        });
        self.finish_one();
    }

    /// Send parked retries now instead of at their backoff deadline (`forceFlush()`).
    pub fn retry_now(&'static self) {
        self.dispatch_retries(RetryFilter::All);
    }

    fn dispatch_retries(&'static self, filter: RetryFilter) {
        let due: Vec<ParkedRetry> = {
            let mut q = self.retries.lock();
            if q.is_empty() {
                return;
            }
            let now = clock::now_unix_nanos();
            let (due, later) = q
                .drain(..)
                .partition(|r| filter == RetryFilter::All || r.due_ns <= now);
            *q = later;
            due
        };
        self.inflight.fetch_add(due.len(), Ordering::AcqRel);
        for r in due {
            r.exporter.export(self, r.payload, r.attempt);
        }
    }

    pub fn on_idle(&self, owner: usize, f: Box<dyn Fn() + Send + Sync>) {
        self.idle_hooks.write().push((owner, f));
    }

    pub fn remove_idle_hooks(&self, owner: usize) {
        self.idle_hooks.write().retain(|(o, _)| *o != owner);
    }

    /// Instrumentation scope for a user tracer (`Bun.otel.tracer(name, version)`).
    pub fn register_scope(&self, name: &[u8], version: &[u8]) -> ScopeId {
        let encoded = otlp::encode_scope(name, version);
        let mut names = self.scope_names.write();
        let mut scopes = self.scopes.write();
        // Linear scan: a process has a handful of tracers.
        for (i, n) in names.iter().enumerate().skip(Instrument::COUNT) {
            if &**n == name && *scopes[i] == *encoded {
                return ScopeId(i as u16);
            }
        }
        if scopes.len() >= u16::MAX as usize {
            return ScopeId::from(Instrument::User);
        }
        names.push(name.into());
        scopes.push(encoded.into_boxed_slice());
        ScopeId((scopes.len() - 1) as u16)
    }

    pub fn scope_name(&self, id: ScopeId) -> Box<[u8]> {
        self.scope_names
            .read()
            .get(id.0 as usize)
            .cloned()
            .unwrap_or_default()
    }

    /// Copy a thread's batch into the pending buffers. Returns true when the
    /// batch-size threshold was crossed and the caller should [`export`]
    /// (after releasing its own borrow); otherwise the next `tick` past the
    /// schedule delay exports.
    pub fn accept(&'static self, batch: &LocalBatch) -> bool {
        let cfg = *self.config.read();
        let mut p = self.pending.lock();
        if p.count >= cfg.max_queue_size {
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
            p.oldest_ns = clock::now_unix_nanos();
        }
        p.count += batch.count;
        // One export in flight at a time (like the SDK's BatchSpanProcessor):
        // while the exporter is busy the queue fills up to `max_queue_size`
        // and then drops, instead of buffering unboundedly in the exporter.
        p.count >= cfg.max_export_batch_size && self.inflight() == 0
    }

    /// Periodic driver; call from each event loop every ~`scheduled_delay`
    /// after flushing its VM's local batch. Returns true if an export was
    /// started.
    pub fn tick(&'static self) -> bool {
        self.dispatch_retries(RetryFilter::Due);
        let cfg = *self.config.read();
        let due = self.inflight() == 0 && {
            let p = self.pending.lock();
            p.count > 0
                && clock::now_unix_nanos().saturating_sub(p.oldest_ns)
                    >= (cfg.scheduled_delay_ms as u64) * 1_000_000
        };
        if due {
            self.export();
        }
        due
    }

    fn take_payload(&self) -> Option<Arc<ExportPayload>> {
        let (scopes, count) = {
            let mut p = self.pending.lock();
            let p = &mut *p;
            if p.count == 0 {
                return None;
            }
            let count = p.count;
            p.count = 0;
            p.oldest_ns = 0;
            let mut spare = core::mem::take(&mut p.spare);
            for v in &mut spare {
                v.clear();
            }
            (core::mem::replace(&mut p.scopes, spare), count)
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
        Some(Arc::new(ExportPayload {
            body,
            span_count: count,
        }))
    }

    /// Export everything pending now (non-blocking).
    pub fn export(&'static self) -> bool {
        let Some(payload) = self.take_payload() else {
            return false;
        };
        let exporters = self.exporters.read().clone();
        if exporters.is_empty() {
            self.stats
                .spans_dropped
                .fetch_add(payload.span_count as u64, Ordering::Relaxed);
            return false;
        }
        self.stats
            .last_export_ns
            .store(clock::now_unix_nanos(), Ordering::Relaxed);
        self.inflight.fetch_add(exporters.len(), Ordering::AcqRel);
        for e in exporters {
            e.export(self, Arc::clone(&payload), 0);
        }
        true
    }

    fn record_result(&self, payload: &ExportPayload, result: ExportResult) {
        match result {
            ExportResult::Success => {
                self.stats.exports_ok.fetch_add(1, Ordering::Relaxed);
                self.stats
                    .spans_exported
                    .fetch_add(payload.span_count as u64, Ordering::Relaxed);
            }
            ExportResult::Failure => {
                self.stats.exports_failed.fetch_add(1, Ordering::Relaxed);
                self.stats
                    .spans_dropped
                    .fetch_add(payload.span_count as u64, Ordering::Relaxed);
            }
        }
    }

    /// Exporters call this exactly once per `export` call.
    pub fn export_done(&self, payload: &ExportPayload, result: ExportResult) {
        self.record_result(payload, result);
        self.finish_one();
    }

    fn finish_one(&self) {
        if self.inflight.fetch_sub(1, Ordering::AcqRel) == 1 {
            {
                let _g = self.idle_lock.lock();
                self.idle.notify_all();
            }
            for (_, h) in self.idle_hooks.read().iter() {
                h();
            }
            // A full batch accumulated while this export was running: chain.
            let cfg = *self.config.read();
            if self.pending_count() >= cfg.max_export_batch_size {
                if let Some(p) = global() {
                    p.export();
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
        let deadline = clock::now_unix_nanos().saturating_add(timeout.as_nanos() as u64);
        while self.inflight.load(Ordering::Acquire) != 0 {
            let now = clock::now_unix_nanos();
            if now >= deadline
                || self
                    .idle
                    .timed_wait_guarded(&mut g, deadline - now)
                    .is_err()
            {
                return self.inflight.load(Ordering::Acquire) == 0;
            }
        }
        true
    }

    /// Process-exit path (caller flushed its VM's local batch): deliver parked
    /// retries and the pending batch synchronously through each exporter's
    /// blocking path, bounded by `export_timeout_ms`.
    pub fn shutdown_blocking(&'static self) {
        let cfg = *self.config.read();
        let deadline = clock::now_unix_nanos() + (cfg.export_timeout_ms as u64) * 1_000_000;
        let parked = core::mem::take(&mut *self.retries.lock());
        for r in parked {
            let result = r.exporter.export_blocking(&r.payload, deadline);
            self.record_result(&r.payload, result);
        }
        if let Some(payload) = self.take_payload() {
            for e in self.exporters.read().clone() {
                let result = e.export_blocking(&payload, deadline);
                self.record_result(&payload, result);
            }
        }
        // Anything already handed to async exporters gets the same budget.
        let remaining = deadline.saturating_sub(clock::now_unix_nanos());
        if self.inflight() > 0 && remaining > 0 {
            self.wait_idle(Duration::from_nanos(remaining));
        }
    }

    pub fn pending_count(&self) -> u32 {
        self.pending.lock().count
    }
}
