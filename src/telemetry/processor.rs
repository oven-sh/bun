//! The batch span processor: collects per-thread batches, decides when to
//! export (`OTEL_BSP_*` semantics), builds the OTLP request once and fans it
//! out to every configured exporter.

use core::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock, RwLock};
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

/// A destination for span batches. Implemented by the runtime for OTLP/HTTP
/// and for JS callback exporters.
pub trait Exporter: Send + Sync {
    /// Deliver `payload`. Must not block the calling thread; when finished
    /// (including retries) call `processor.export_done(..)` exactly once.
    fn export(&self, processor: &'static Processor, payload: Arc<ExportPayload>);
    /// Synchronous best-effort delivery during process exit. Return once the
    /// payload is sent or `deadline_ns` (clock::now_unix_nanos domain) passes.
    fn export_blocking(&self, payload: Arc<ExportPayload>, deadline_ns: u64) -> ExportResult;
    /// Called on every processor tick (~scheduled delay) so exporters can
    /// drive retries without their own timers.
    fn tick(&self, _processor: &'static Processor) {}
    /// Payloads held for retry (still counted as in flight).
    fn pending_retries(&self) -> usize {
        0
    }
    fn name(&self) -> &str;
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
        BatchConfig { scheduled_delay_ms: 5000, export_timeout_ms: 30000, max_queue_size: 2048, max_export_batch_size: 512 }
    }
}

struct Pending {
    scopes: Vec<Vec<u8>>,
    count: u32,
    /// `clock::now_unix_nanos()` when the oldest pending span arrived; 0 if empty.
    oldest_ns: u64,
}

pub struct Processor {
    pending: Mutex<Pending>,
    exporters: RwLock<Vec<Arc<dyn Exporter>>>,
    /// Encoded `Resource` body.
    resource: RwLock<Arc<[u8]>>,
    /// Encoded `InstrumentationScope` bodies, indexed by `ScopeId`.
    scopes: RwLock<Vec<Box<[u8]>>>,
    scope_names: RwLock<Vec<Box<[u8]>>>,
    pub config: RwLock<BatchConfig>,
    inflight: AtomicUsize,
    idle: Condvar,
    idle_lock: Mutex<()>,
    pub stats: Stats,
    idle_hooks: RwLock<Vec<Box<dyn Fn() + Send + Sync>>>,
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
            scopes.push(otlp::encode_scope(i.scope_name().as_bytes(), version.as_bytes()).into_boxed_slice());
            names.push(i.scope_name().as_bytes().into());
        }
        Processor {
            pending: Mutex::new(Pending { scopes: Vec::new(), count: 0, oldest_ns: 0 }),
            exporters: RwLock::new(Vec::new()),
            resource: RwLock::new(Arc::from(Vec::new())),
            scopes: RwLock::new(scopes),
            scope_names: RwLock::new(names),
            config: RwLock::new(BatchConfig::default()),
            inflight: AtomicUsize::new(0),
            idle: Condvar::new(),
            idle_lock: Mutex::new(()),
            stats: Stats::default(),
            idle_hooks: RwLock::new(Vec::new()),
        }
    }

    pub fn set_resource(&self, encoded: Vec<u8>) {
        *self.resource.write().unwrap() = Arc::from(encoded);
    }

    pub fn resource(&self) -> Arc<[u8]> {
        self.resource.read().unwrap().clone()
    }

    pub fn add_exporter(&self, e: Arc<dyn Exporter>) {
        self.exporters.write().unwrap().push(e);
    }

    pub fn clear_exporters(&self) {
        self.exporters.write().unwrap().clear();
    }

    pub fn exporter_count(&self) -> usize {
        self.exporters.read().unwrap().len()
    }

    /// Called from any thread once nothing is in flight.
    pub fn on_idle(&self, f: Box<dyn Fn() + Send + Sync>) {
        self.idle_hooks.write().unwrap().push(f);
    }

    /// Instrumentation scope for a user tracer (`Bun.otel.tracer(name, version)`).
    pub fn register_scope(&self, name: &[u8], version: &[u8]) -> ScopeId {
        {
            let names = self.scope_names.read().unwrap();
            // Linear scan: a process has a handful of tracers.
            for (i, n) in names.iter().enumerate().skip(Instrument::COUNT) {
                if &**n == name && &*self.scopes.read().unwrap()[i] == &*otlp::encode_scope(name, version) {
                    return ScopeId(i as u16);
                }
            }
        }
        let mut names = self.scope_names.write().unwrap();
        let mut scopes = self.scopes.write().unwrap();
        if scopes.len() >= u16::MAX as usize {
            return ScopeId::from(Instrument::User);
        }
        names.push(name.into());
        scopes.push(otlp::encode_scope(name, version).into_boxed_slice());
        ScopeId((scopes.len() - 1) as u16)
    }

    pub fn scope_name(&self, id: ScopeId) -> Box<[u8]> {
        self.scope_names.read().unwrap().get(id.0 as usize).cloned().unwrap_or_default()
    }

    /// Take a thread's batch. Triggers an export if the batch-size threshold
    /// is crossed; otherwise the next `tick` past the schedule delay will.
    pub fn accept(&'static self, batch: LocalBatch) {
        let cfg = *self.config.read().unwrap();
        let export_now;
        {
            let mut p = self.pending.lock().unwrap();
            if p.count >= cfg.max_queue_size {
                self.stats.spans_dropped.fetch_add(batch.count as u64, Ordering::Relaxed);
                return;
            }
            if p.scopes.len() < batch.scopes.len() {
                p.scopes.resize_with(batch.scopes.len(), Vec::new);
            }
            for (i, buf) in batch.scopes.into_iter().enumerate() {
                if buf.is_empty() {
                    continue;
                }
                if p.scopes[i].is_empty() {
                    p.scopes[i] = buf;
                } else {
                    p.scopes[i].extend_from_slice(&buf);
                }
            }
            if p.count == 0 {
                p.oldest_ns = clock::now_unix_nanos();
            }
            p.count += batch.count;
            export_now = p.count >= cfg.max_export_batch_size;
        }
        if export_now {
            self.export();
        }
    }

    /// Periodic driver; call from each event loop every ~`scheduled_delay`.
    /// Returns true if an export was started.
    pub fn tick(&'static self) -> bool {
        crate::batch::flush_local();
        for e in self.exporters.read().unwrap().clone() {
            e.tick(self);
        }
        let cfg = *self.config.read().unwrap();
        let due = {
            let p = self.pending.lock().unwrap();
            p.count > 0 && clock::now_unix_nanos().saturating_sub(p.oldest_ns) >= (cfg.scheduled_delay_ms as u64) * 1_000_000
        };
        if due {
            self.export();
        }
        due
    }

    fn take_payload(&self) -> Option<Arc<ExportPayload>> {
        let (scopes, count) = {
            let mut p = self.pending.lock().unwrap();
            if p.count == 0 {
                return None;
            }
            let count = p.count;
            p.count = 0;
            p.oldest_ns = 0;
            (core::mem::take(&mut p.scopes), count)
        };
        let resource = self.resource();
        let scope_defs = self.scopes.read().unwrap();
        let chunks: Vec<otlp::ScopeChunk<'_>> = scopes
            .iter()
            .enumerate()
            .filter(|(_, b)| !b.is_empty())
            .map(|(i, b)| otlp::ScopeChunk { scope: scope_defs.get(i).map(|s| &**s).unwrap_or(&[]), spans: b })
            .collect();
        let body = otlp::encode_request(&resource, &chunks);
        Some(Arc::new(ExportPayload { body, span_count: count }))
    }

    /// Export everything pending now (non-blocking).
    pub fn export(&'static self) -> bool {
        crate::batch::flush_local();
        let Some(payload) = self.take_payload() else { return false };
        let exporters = self.exporters.read().unwrap().clone();
        if exporters.is_empty() {
            self.stats.spans_dropped.fetch_add(payload.span_count as u64, Ordering::Relaxed);
            return false;
        }
        self.stats.last_export_ns.store(clock::now_unix_nanos(), Ordering::Relaxed);
        self.inflight.fetch_add(exporters.len(), Ordering::AcqRel);
        for e in exporters {
            e.export(self, payload.clone());
        }
        true
    }

    /// Exporters call this exactly once per `export` call.
    pub fn export_done(&self, payload: &ExportPayload, result: ExportResult) {
        match result {
            ExportResult::Success => {
                self.stats.exports_ok.fetch_add(1, Ordering::Relaxed);
                self.stats.spans_exported.fetch_add(payload.span_count as u64, Ordering::Relaxed);
            }
            ExportResult::Failure => {
                self.stats.exports_failed.fetch_add(1, Ordering::Relaxed);
                self.stats.spans_dropped.fetch_add(payload.span_count as u64, Ordering::Relaxed);
            }
        }
        if self.inflight.fetch_sub(1, Ordering::AcqRel) == 1 {
            let _g = self.idle_lock.lock().unwrap();
            self.idle.notify_all();
            drop(_g);
            for h in self.idle_hooks.read().unwrap().iter() {
                h();
            }
        }
    }

    #[inline]
    pub fn inflight(&self) -> usize {
        self.inflight.load(Ordering::Acquire)
    }

    /// Block until no exports are in flight or `timeout` elapses.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let g = self.idle_lock.lock().unwrap();
        let (_g, res) = self.idle.wait_timeout_while(g, timeout, |_| self.inflight.load(Ordering::Acquire) != 0).unwrap();
        !res.timed_out()
    }

    /// Process-exit path: flush this thread, export synchronously through
    /// each exporter's blocking path, bounded by `export_timeout_ms`.
    pub fn shutdown_blocking(&'static self) {
        crate::batch::flush_local();
        let cfg = *self.config.read().unwrap();
        let deadline = clock::now_unix_nanos() + (cfg.export_timeout_ms as u64) * 1_000_000;
        // Anything already handed to async exporters: give it the same budget.
        if let Some(payload) = self.take_payload() {
            let exporters = self.exporters.read().unwrap().clone();
            for e in exporters {
                match e.export_blocking(payload.clone(), deadline) {
                    ExportResult::Success => {
                        self.stats.spans_exported.fetch_add(payload.span_count as u64, Ordering::Relaxed);
                    }
                    ExportResult::Failure => {
                        self.stats.spans_dropped.fetch_add(payload.span_count as u64, Ordering::Relaxed);
                    }
                }
            }
        }
        let remaining = deadline.saturating_sub(clock::now_unix_nanos());
        if self.inflight() > 0 && remaining > 0 {
            self.wait_idle(Duration::from_nanos(remaining));
        }
    }

    pub fn pending_count(&self) -> u32 {
        self.pending.lock().unwrap().count
    }
}
