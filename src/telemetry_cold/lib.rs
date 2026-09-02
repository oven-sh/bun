//! The parts of Bun's OpenTelemetry support that only run at configuration
//! time or for debugging output (env/bunfig/`start()` option parsing,
//! resource encoding, the OTLP protobuf decoder and OTLP/JSON encoder). Kept out of `bun_telemetry` so they can be built for size while
//! the span hot paths are built for speed.

pub mod config;
pub mod decode;
pub mod otlp_json;
pub mod resource;

pub use config::Config;

#[cfg(test)]
#[path = "../telemetry/native_test_shims.rs"]
mod native_test_shims;
