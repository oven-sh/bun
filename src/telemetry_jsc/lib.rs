//! OpenTelemetry tracing: `Bun.otel`, the `@opentelemetry/api` providers, the exporters, and what Bun's own
//! APIs record their spans with. README.md says how to instrument one.

mod api;
mod baggage;
mod configure;
mod context;
pub mod db;
mod decode;
mod engine;
mod exporter;
pub mod fs;
pub(crate) mod generated_bindgen;
mod held;
pub mod http_client;
pub mod http_server;
mod native;
mod outcome;
mod promise;
mod span;
mod state;
mod trace_state;
mod tracer;
mod values;
pub mod websocket;

pub use bun_telemetry::{Instrument, Record, SpanKind};
pub use configure::before_entry_point;
pub use held::{Active, HeldSpan};
pub use native::{NativeSpan, SpanCell};
pub use outcome::{Aborted, Failed, Outcome, PendingException, Thrown};
pub use promise::PromiseSpan;
pub use span::Span;
pub use state::{VmState, VmTask, flush};
