//! Native OpenTelemetry core: ids, clock, W3C propagation, sampling, OTLP
//! protobuf encoding, per-VM span batching and the export processor.
//! No JSC or HTTP dependencies — transports and JS bindings live in
//! `bun_runtime::telemetry` and plug in through [`Exporter`].

#![allow(clippy::new_without_default)]

pub mod batch;
pub mod clock;
pub mod db;
pub mod http_record;
pub mod limits;
pub mod otlp;
pub mod pool;
pub mod processor;
pub mod propagation;
pub mod proto;
pub mod rt;
pub mod sampler;
pub mod span;

#[cfg(test)]
mod native_test_shims;

use core::sync::atomic::{AtomicPtr, AtomicU32, Ordering};

pub use clock::MonoInstant;
pub use limits::{DEFAULT_LIMITS, Limits};
pub use otlp::{SpanWriter, Value};
pub use pool::{JsCellRef, NativeSpan};
pub use processor::{ExportAttempt, ExportPayload, Exporter, FlushTarget, OwnerKey, Processor};
pub use sampler::{RootSampler, Sampler};
pub use span::{Flags, SpanContext, SpanId, SpanKind, SpanStub, StatusCode, TraceId};

/// Process-wide, immutable once set. Read on hot paths without locking via
/// [`state()`]; replaced wholesale by [`set_state`].
pub struct State {
    pub sampler: Sampler,
    pub limits: Limits,
    pub propagate_trace_context: bool,
    pub propagate_baggage: bool,
    pub capture_db_statement: bool,
    pub capture_request_headers: Vec<CapturedHeader>,
}

/// A request header to record, stored as its attribute key
/// `http.request.header.<name>` so the per-request path formats nothing.
pub struct CapturedHeader(Box<[u8]>);

impl CapturedHeader {
    const PREFIX: &'static [u8] = b"http.request.header.";

    /// `name` is lower-case.
    pub fn new(name: &[u8]) -> Self {
        CapturedHeader([Self::PREFIX, name].concat().into_boxed_slice())
    }
    pub fn name(&self) -> &[u8] {
        &self.0[Self::PREFIX.len()..]
    }
    pub fn attribute_key(&self) -> &[u8] {
        &self.0
    }
}

impl State {
    pub const DEFAULT: State = State {
        sampler: Sampler::ParentBased(RootSampler::AlwaysOn),
        limits: DEFAULT_LIMITS,
        propagate_trace_context: true,
        propagate_baggage: true,
        capture_db_statement: true,
        capture_request_headers: Vec::new(),
    };
}

static STATE: AtomicPtr<State> = AtomicPtr::new(core::ptr::null_mut());
/// Replaced values are retired, not freed (a few hundred bytes per
/// `Bun.otel.start()`), so `state()` can hand out `&'static`.
static RETIRED_STATES: bun_threading::Guarded<Vec<&'static State>> =
    bun_threading::Guarded::new(Vec::new());
static DEFAULT_STATE: State = State::DEFAULT;

#[inline]
pub fn state() -> &'static State {
    let p = STATE.load(Ordering::Acquire);
    if p.is_null() {
        &DEFAULT_STATE
    } else {
        // SAFETY: non-null values come from `Box::leak` in `set_state` and are never freed.
        unsafe { &*p }
    }
}

#[inline]
pub fn configured() -> bool {
    !STATE.load(Ordering::Acquire).is_null()
}

pub fn set_state(s: State) {
    let new: &'static State = Box::leak(Box::new(s));
    let old = STATE.swap(core::ptr::from_ref(new).cast_mut(), Ordering::AcqRel);
    if !old.is_null() {
        // SAFETY: every non-null STATE came from `Box::leak` above.
        RETIRED_STATES.lock().push(unsafe { &*old });
    }
}

/// Per-VM (per JS thread) telemetry state. Owned by the runtime's `VmState`
/// and reached through the VM; lower tiers get it via [`rt::with_local`].
pub struct Local {
    pub pool: pool::Pool,
    pub batch: batch::LocalBatch,
    pub http_templates: http_record::Cache,
    /// PRNG for span/trace ids; seeded lazily from the OS, per thread.
    pub rng: span::IdRng,
    /// Reused transcode buffers: [0..3] for attribute key/value/array bytes, [3] for the span name.
    pub scratch: [Vec<u8>; 4],
}

impl Local {
    pub const fn new() -> Local {
        Local {
            pool: pool::Pool::new(),
            batch: batch::LocalBatch::new(),
            http_templates: http_record::Cache::new(),
            rng: None,
            scratch: [Vec::new(), Vec::new(), Vec::new(), Vec::new()],
        }
    }
}

/// Built-in instrumentations. The discriminant is the bit index in the global
/// enable mask and the index into the built-in scope table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Instrument {
    /// Bun.serve and node:http server.
    HttpServer = 0,
    /// fetch() and node:http client.
    HttpClient = 1,
    /// Bun.sql (PostgreSQL, MySQL).
    Sql = 2,
    /// bun:sqlite.
    Sqlite = 3,
    /// Bun.redis.
    Redis = 4,
    /// Bun.connect / Bun.listen / node:net / node:tls.
    Net = 5,
    /// WebSocket client and ServerWebSocket.
    WebSocket = 6,
    /// node:fs, Bun.file, Bun.write.
    Fs = 7,
    /// Bun.spawn / node:child_process.
    ChildProcess = 8,
    /// node:dns / Bun.dns and connection-time lookups.
    Dns = 9,
    /// Spans created from JS (Bun.otel.tracer / @opentelemetry/api).
    User = 10,
}

// src/js/node/_http_client.ts tests the exported mask with `& 2`; JSSQLStatement.cpp uses Bun__Telemetry__SQLITE_MASK.
const _: () = assert!(Instrument::HttpClient.bit() == 1 << 1);

impl Instrument {
    pub const COUNT: usize = Instrument::User as usize + 1;
    pub const ALL: [Instrument; Self::COUNT] = [
        Instrument::HttpServer,
        Instrument::HttpClient,
        Instrument::Sql,
        Instrument::Sqlite,
        Instrument::Redis,
        Instrument::Net,
        Instrument::WebSocket,
        Instrument::Fs,
        Instrument::ChildProcess,
        Instrument::Dns,
        Instrument::User,
    ];
    #[inline]
    pub const fn bit(self) -> u32 {
        1 << (self as u32)
    }

    /// Config / env name (`instrumentations: { http: false }`,
    /// `BUN_OTEL_DISABLE=fs,dns`).
    pub const fn name(self) -> &'static str {
        match self {
            Instrument::HttpServer => "http",
            Instrument::HttpClient => "fetch",
            Instrument::Sql => "sql",
            Instrument::Sqlite => "sqlite",
            Instrument::Redis => "redis",
            Instrument::Net => "net",
            Instrument::WebSocket => "websocket",
            Instrument::Fs => "fs",
            Instrument::ChildProcess => "spawn",
            Instrument::Dns => "dns",
            Instrument::User => "user",
        }
    }

    pub fn from_name(s: &[u8]) -> Option<Instrument> {
        Self::ALL.into_iter().find(|i| i.name().as_bytes() == s)
    }

    /// OTel instrumentation scope name for spans from this integration.
    pub const fn scope_name(self) -> &'static str {
        match self {
            Instrument::HttpServer => "bun.http.server",
            Instrument::HttpClient => "bun.http.client",
            Instrument::Sql => "bun.sql",
            Instrument::Sqlite => "bun.sqlite",
            Instrument::Redis => "bun.redis",
            Instrument::Net => "bun.net",
            Instrument::WebSocket => "bun.websocket",
            Instrument::Fs => "bun.fs",
            Instrument::ChildProcess => "bun.child_process",
            Instrument::Dns => "bun.dns",
            Instrument::User => "bun",
        }
    }

    /// Instrumentations that, by default, only record when a parent span is
    /// already active — a bare script shouldn't emit a root span per readFile.
    pub const fn requires_parent_by_default(self) -> bool {
        matches!(
            self,
            Instrument::Fs
                | Instrument::Sqlite
                | Instrument::Net
                | Instrument::Dns
                | Instrument::ChildProcess
        )
    }
}

const _: () = {
    let mut i = 0;
    while i < Instrument::COUNT {
        assert!(Instrument::ALL[i] as usize == i);
        i += 1;
    }
};

/// A set of [`Instrument`]s; bit i = `Instrument` i.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
#[repr(transparent)]
pub struct InstrumentSet(u32);

impl InstrumentSet {
    pub const EMPTY: InstrumentSet = InstrumentSet(0);
    pub const ALL: InstrumentSet = InstrumentSet((1u32 << Instrument::COUNT) - 1);

    #[inline]
    pub const fn of(i: Instrument) -> Self {
        InstrumentSet(i.bit())
    }
    #[inline]
    pub const fn contains(self, i: Instrument) -> bool {
        self.0 & i.bit() != 0
    }
    #[inline]
    pub const fn with(self, i: Instrument) -> Self {
        InstrumentSet(self.0 | i.bit())
    }
    #[inline]
    pub const fn without(self, i: Instrument) -> Self {
        InstrumentSet(self.0 & !i.bit())
    }
    #[inline]
    pub fn insert(&mut self, i: Instrument) {
        *self = self.with(i);
    }
    #[inline]
    pub fn remove(&mut self, i: Instrument) {
        *self = self.without(i);
    }
    #[inline]
    pub const fn bits(self) -> u32 {
        self.0
    }
    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
    /// Instruments that may start root spans unless configured otherwise.
    pub fn default_roots() -> Self {
        Instrument::ALL
            .into_iter()
            .filter(|i| !i.requires_parent_by_default())
            .collect()
    }
}

impl FromIterator<Instrument> for InstrumentSet {
    fn from_iter<I: IntoIterator<Item = Instrument>>(it: I) -> Self {
        let mut s = Self::EMPTY;
        for i in it {
            s.insert(i);
        }
        s
    }
}

/// Instrumentation scope handle. Values `< Instrument::COUNT` are the
/// built-ins; larger values index user tracers registered via
/// [`Processor::register_scope`].
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(transparent)]
pub struct ScopeId(pub u16);

impl From<Instrument> for ScopeId {
    #[inline]
    fn from(i: Instrument) -> ScopeId {
        ScopeId(i as u16)
    }
}

/// Bit i set ⇔ `Instrument` i records spans. Zero when telemetry is off, so
/// every integration's fast path is `load; test; branch`. Exported so C++
/// integrations (bun:sqlite) can do the same load.
#[unsafe(export_name = "Bun__Telemetry__enabled")]
pub static ENABLED: AtomicU32 = AtomicU32::new(0);
/// Bit i set ⇔ `Instrument` i records even without an active parent.
static ROOTS: AtomicU32 = AtomicU32::new(0);

/// The one check integrations make before doing any telemetry work.
/// Acquire pairs with the Release in [`activate`], which runs after STATE is
/// published: a thread that sees its bit set also sees the configuration
/// (same cost as a plain load on x86; `ldar` on ARM).
#[inline(always)]
pub fn enabled(i: Instrument) -> bool {
    ENABLED.load(Ordering::Acquire) & i.bit() != 0
}

#[inline(always)]
pub fn any_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed) != 0
}

#[inline]
pub fn allows_root(i: Instrument) -> bool {
    ROOTS.load(Ordering::Relaxed) & i.bit() != 0
}

#[inline]
pub fn capture_db_statement() -> bool {
    state().capture_db_statement
}

/// `Bun.otel.shutdown()` / `tracerProvider.shutdown()` ran (and no `start()`
/// since): nothing records — instrumentations are off via the mask, user
/// spans are non-recording — and nothing is delivered to exporters.
static SHUT_DOWN: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

#[inline]
pub fn is_shut_down() -> bool {
    SHUT_DOWN.load(Ordering::Relaxed)
}

/// `configure`: these instruments record from now on. The Release store pairs
/// with the Acquire in [`enabled`], publishing STATE and the rt hooks.
pub fn activate(instruments: InstrumentSet, roots: InstrumentSet) {
    SHUT_DOWN.store(false, Ordering::Relaxed);
    ROOTS.store(roots.bits(), Ordering::Relaxed);
    ENABLED.store(instruments.bits(), Ordering::Release);
}

/// `Bun.otel.shutdown()`: nothing records and nothing is delivered until the
/// next [`activate`].
pub fn shut_down() {
    ROOTS.store(0, Ordering::Relaxed);
    ENABLED.store(0, Ordering::Release);
    SHUT_DOWN.store(true, Ordering::Release);
}
