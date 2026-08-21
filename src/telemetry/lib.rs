//! Native OpenTelemetry core: ids, clock, W3C propagation, sampling, OTLP
//! protobuf encoding, per-thread span batching and the export processor.
//! No JSC or HTTP dependencies — transports and JS bindings live in
//! `bun_runtime::telemetry` and plug in through [`Exporter`].

#![allow(clippy::new_without_default)]

pub mod batch;
pub mod clock;
pub mod config;
pub mod data;
pub mod db;
pub mod otlp;
pub mod otlp_json;
pub mod pool;
pub mod processor;
pub mod propagation;
pub mod proto;
pub mod resource;
pub mod rt;
pub mod sampler;
pub mod span;

use core::sync::atomic::{AtomicU32, Ordering};

pub use config::Config;
pub use data::{DEFAULT_LIMITS, Limits};
pub use otlp::{SpanWriter, Value};
pub use pool::NativeSpan;
pub use processor::{ExportPayload, Exporter, Processor};
pub use sampler::Sampler;
pub use span::{Flags, SpanContext, SpanId, SpanKind, SpanStub, StatusCode, TraceId};

/// Built-in instrumentations. The discriminant is the bit index in the global
/// enable mask and the index into the built-in scope table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Instrument {
    /// Bun.serve and node:http server.
    HttpServer = 0,
    /// fetch() and node:http client.
    HttpClient,
    /// Bun.sql (PostgreSQL, MySQL).
    Sql,
    /// bun:sqlite.
    Sqlite,
    /// Bun.redis.
    Redis,
    /// Bun.connect / Bun.listen / node:net / node:tls.
    Net,
    /// WebSocket client and ServerWebSocket.
    WebSocket,
    /// node:fs, Bun.file, Bun.write.
    Fs,
    /// Bun.spawn / node:child_process.
    ChildProcess,
    /// node:dns / Bun.dns and connection-time lookups.
    Dns,
    /// Spans created from JS (Bun.otel.tracer / @opentelemetry/api).
    User,
}

impl Instrument {
    pub const COUNT: usize = 11;
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
        Some(match s {
            b"http" | b"serve" | b"node:http" => Instrument::HttpServer,
            b"fetch" | b"http-client" | b"undici" => Instrument::HttpClient,
            b"sql" | b"postgres" | b"mysql" => Instrument::Sql,
            b"sqlite" | b"bun:sqlite" => Instrument::Sqlite,
            b"redis" | b"valkey" => Instrument::Redis,
            b"net" | b"tcp" | b"tls" | b"node:net" => Instrument::Net,
            b"websocket" | b"ws" => Instrument::WebSocket,
            b"fs" | b"node:fs" | b"file" => Instrument::Fs,
            b"spawn" | b"child_process" | b"node:child_process" => Instrument::ChildProcess,
            b"dns" | b"node:dns" => Instrument::Dns,
            b"user" | b"api" => Instrument::User,
            _ => return None,
        })
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
#[inline(always)]
pub fn enabled(i: Instrument) -> bool {
    ENABLED.load(Ordering::Relaxed) & i.bit() != 0
}

#[inline(always)]
pub fn any_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed) != 0
}

#[inline]
pub fn allows_root(i: Instrument) -> bool {
    ROOTS.load(Ordering::Relaxed) & i.bit() != 0
}

pub fn set_enabled_mask(enabled: u32, roots: u32) {
    ROOTS.store(roots, Ordering::Relaxed);
    ENABLED.store(enabled, Ordering::Release);
}

/// TEMPORARY benchmark experiment knobs (BUN_OTEL_EXP bitmask).
pub static EXP: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(0);
#[inline]
pub fn exp(bit: u32) -> bool {
    EXP.load(core::sync::atomic::Ordering::Relaxed) & bit != 0
}

pub fn enabled_mask() -> u32 {
    ENABLED.load(Ordering::Relaxed)
}
