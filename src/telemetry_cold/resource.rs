//! The OTLP `Resource` describing this process.

use bun_telemetry::otlp::{self, Value};

pub struct ResourceInfo<'a> {
    pub service_name: Option<&'a str>,
    pub extra: &'a [(String, crate::config::ResourceValue)],
    pub runtime_version: &'a str,
    pub pid: u32,
    /// The entrypoint (`process.command`).
    pub command: &'a [u8],
    pub executable_path: &'a [u8],
    pub host_name: &'a [u8],
    /// semconv `host.arch` / `os.type` values (`amd64`, `linux`, …).
    pub host_arch: &'a str,
    pub os_type: &'a str,
    pub os_version: &'a [u8],
}

/// Semconv resource: service.*, telemetry.sdk.*, process.*, host.*, os.*
/// (what the JS SDK's default env/process/host/os detectors report).
#[cold]
#[inline(never)]
pub fn encode(info: &ResourceInfo<'_>) -> Vec<u8> {
    // A `bun build --compile` binary is its own executable.
    let exe_name: &[u8] = match bun_paths::basename(info.executable_path) {
        b"" => b"bun",
        n => n,
    };
    let default_service_name;
    let service_name: &str = match info.service_name {
        Some(s) if !s.is_empty() => s,
        // semconv: `unknown_service:` + process.executable.name
        _ => {
            default_service_name = format!("unknown_service:{}", bstr::BStr::new(exe_name));
            &default_service_name
        }
    };
    let mut attrs: Vec<(&[u8], Value<'_>)> = Vec::with_capacity(16 + info.extra.len());
    attrs.push((b"service.name", Value::Str(service_name.as_bytes())));
    attrs.push((b"telemetry.sdk.name", Value::Str(b"bun")));
    attrs.push((b"telemetry.sdk.language", Value::Str(b"bun")));
    attrs.push((
        b"telemetry.sdk.version",
        Value::Str(info.runtime_version.as_bytes()),
    ));
    attrs.push((b"process.runtime.name", Value::Str(b"bun")));
    attrs.push((b"process.runtime.description", Value::Str(b"Bun")));
    attrs.push((
        b"process.runtime.version",
        Value::Str(info.runtime_version.as_bytes()),
    ));
    attrs.push((b"process.pid", Value::Int(info.pid as i64)));
    attrs.push((b"process.executable.name", Value::Str(exe_name)));
    if !info.executable_path.is_empty() {
        attrs.push((b"process.executable.path", Value::Str(info.executable_path)));
    }
    if !info.command.is_empty() {
        attrs.push((b"process.command", Value::Str(info.command)));
    }
    if !info.host_name.is_empty() {
        attrs.push((b"host.name", Value::Str(info.host_name)));
    }
    attrs.push((b"host.arch", Value::Str(info.host_arch.as_bytes())));
    attrs.push((b"os.type", Value::Str(info.os_type.as_bytes())));
    if !info.os_version.is_empty() {
        attrs.push((b"os.version", Value::Str(info.os_version)));
    }
    for (k, v) in info.extra {
        let k = k.as_bytes();
        // User-provided keys win over our defaults except the sdk identity; last write wins.
        if k.starts_with(b"telemetry.sdk.") {
            continue;
        }
        let v = match v {
            crate::config::ResourceValue::Str(s) => Value::Str(s.as_bytes()),
            crate::config::ResourceValue::Int(i) => Value::Int(*i),
            crate::config::ResourceValue::Double(d) => Value::Double(*d),
            crate::config::ResourceValue::Bool(b) => Value::Bool(*b),
        };
        if let Some(pos) = attrs.iter().position(|(bk, _)| *bk == k) {
            attrs[pos].1 = v;
        } else {
            attrs.push((k, v));
        }
    }
    otlp::encode_resource(&attrs)
}
