//! Native OpenTelemetry core: ids, clock, W3C propagation, sampling, OTLP
//! protobuf encoding, and the export processor.
//! Transports and JS bindings live in `bun_telemetry_jsc`.

#![allow(clippy::new_without_default)]

pub mod clock;
pub mod db;
pub mod http_record;
pub mod limits;
pub mod otlp;
pub mod processor;
pub mod propagation;
pub mod proto;
pub mod record;
pub mod sampler;
pub mod span;
pub mod thread;

#[cfg(test)]
mod native_test_shims;

use core::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};

pub use clock::MonoInstant;
pub use limits::{DEFAULT_LIMITS, Limits};
pub use otlp::Value;
pub use processor::{ExportAttempt, ExportPayload, Exporter, FlushTarget, OwnerKey, Processor};
pub use record::{Carried, Exception, Record, SpanData};
pub use sampler::{RootSampler, Sampler};
pub use span::{Flags, SpanContext, SpanId, SpanKind, SpanStub, StatusCode, TraceId};

/// Process-wide, immutable once set. Read on hot paths without locking via
/// [`state()`]; replaced wholesale by [`set_state`].
#[derive(PartialEq, Eq)]
pub struct State {
    pub limits: Limits,
    pub propagate_trace_context: bool,
    pub propagate_baggage: bool,
    pub capture_db_statement: bool,
    pub capture_request_headers: Vec<CapturedHeader>,
}

/// A request header to record, stored as its attribute key
/// `http.request.header.<name>` so the per-request path formats nothing.
#[derive(PartialEq, Eq)]
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
        limits: DEFAULT_LIMITS,
        propagate_trace_context: true,
        propagate_baggage: true,
        capture_db_statement: true,
        capture_request_headers: Vec::new(),
    };
}

static STATE: AtomicPtr<State> = AtomicPtr::new(core::ptr::null_mut());
/// Each different value that was ever set. They are not freed, so `state()` can hand out `&'static`.
static KNOWN_STATES: bun_threading::Guarded<Vec<&'static State>> =
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
    let mut known = KNOWN_STATES.lock();
    let new = match known.iter().find(|known| ***known == s) {
        Some(known) => *known,
        None => *known.push_mut(Box::leak(Box::new(s))),
    };
    STATE.store(core::ptr::from_ref(new).cast_mut(), Ordering::Release);
}

/// Not in [`State`]: a program may go through any number of ratios.
static SAMPLER: AtomicU64 = AtomicU64::new(Sampler::ParentBased(RootSampler::AlwaysOn).to_bits());

#[inline]
pub fn sampler() -> Sampler {
    Sampler::from_bits(SAMPLER.load(Ordering::Relaxed))
}

pub fn set_sampler(sampler: Sampler) {
    SAMPLER.store(sampler.to_bits(), Ordering::Relaxed);
}

/// What one VM records with.
pub struct Local {
    pub records: record::RecordPool,
    pub rng: span::IdRng,
    pub peers: http_record::PeerCache,
}

impl Local {
    pub fn new(seed: [u64; 4]) -> Local {
        Local {
            records: record::RecordPool::new(),
            rng: span::IdRng::new(seed),
            peers: http_record::PeerCache::new(),
        }
    }

    /// Frees the buffers that are only kept for the next span.
    pub fn release_idle_memory(&mut self) {
        self.records = record::RecordPool::new();
        self.peers.release_memory();
    }
}

macro_rules! instruments {
    ($($variant:ident => $name:literal, $scope:literal, $policy:ident;)*) => {
        /// The discriminant is the bit in the enable mask and the index of the scope.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum Instrument { $($variant),* }

        impl Instrument {
            pub const ALL: &[Instrument] = &[$(Instrument::$variant),*];

            /// In `instrumentations` and `BUN_OTEL_INSTRUMENTATIONS`.
            pub const fn name(self) -> &'static str {
                match self { $(Instrument::$variant => $name),* }
            }

            pub const fn scope_name(self) -> &'static str {
                match self { $(Instrument::$variant => $scope),* }
            }

            const fn default_policy(self) -> Policy {
                match self { $(Instrument::$variant => Policy::$policy),* }
            }
        }
    };
}

#[derive(PartialEq, Eq)]
enum Policy {
    Always,
    /// Only under an active span: a script does not start a trace for each file it reads.
    Nested,
}

// packages/bun-types/telemetry.d.ts and docs/runtime/opentelemetry.mdx list the names.
instruments! {
    HttpServer   => "http",      "bun.http.server",   Always;
    HttpClient   => "fetch",     "bun.http.client",   Always;
    Sql          => "sql",       "bun.sql",           Always;
    Sqlite       => "sqlite",    "bun.sqlite",        Nested;
    Redis        => "redis",     "bun.redis",         Always;
    Net          => "net",       "bun.net",           Nested;
    WebSocket    => "websocket", "bun.websocket",     Always;
    Fs           => "fs",        "bun.fs",            Nested;
    ChildProcess => "spawn",     "bun.child_process", Nested;
    Dns          => "dns",       "bun.dns",           Nested;
    User         => "user",      "bun",               Always;
}

impl Instrument {
    pub const COUNT: usize = Self::ALL.len();

    #[inline]
    pub const fn bit(self) -> u32 {
        1 << (self as u32)
    }

    pub fn from_name(s: &[u8]) -> Option<Instrument> {
        Self::ALL.iter().copied().find(|i| i.name().as_bytes() == s)
    }
}

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
    /// Instruments that may start root spans unless configured otherwise.
    pub fn default_roots() -> Self {
        (Instrument::ALL.iter().copied())
            .filter(|i| i.default_policy() == Policy::Always)
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

impl ScopeId {
    pub const USER: ScopeId = ScopeId(Instrument::User as u16);
}

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
/// with the Acquire in [`enabled`], publishing STATE.
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
