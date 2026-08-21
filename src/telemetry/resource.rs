//! The OTLP `Resource` describing this process.

use crate::otlp::{self, Value};

pub struct ResourceInfo<'a> {
    pub service_name: Option<&'a str>,
    pub extra: &'a [(String, String)],
    pub runtime_version: &'a str,
    pub pid: u32,
    /// argv[1] basename or the entrypoint, for `process.command`-ish hints.
    pub script: Option<&'a str>,
}

pub fn encode(info: &ResourceInfo<'_>) -> Vec<u8> {
    let default_name;
    let service_name: &str = match info.service_name {
        Some(s) if !s.is_empty() => s,
        _ => {
            default_name = match info.script {
                Some(s) if !s.is_empty() => format!("unknown_service:{s}"),
                _ => "unknown_service:bun".to_string(),
            };
            &default_name
        }
    };
    let mut attrs: Vec<(&[u8], Value<'_>)> = Vec::with_capacity(8 + info.extra.len());
    attrs.push((b"service.name", Value::Str(service_name.as_bytes())));
    attrs.push((b"telemetry.sdk.name", Value::Str(b"bun")));
    attrs.push((b"telemetry.sdk.language", Value::Str(b"bun")));
    attrs.push((
        b"telemetry.sdk.version",
        Value::Str(info.runtime_version.as_bytes()),
    ));
    attrs.push((b"process.runtime.name", Value::Str(b"bun")));
    attrs.push((
        b"process.runtime.version",
        Value::Str(info.runtime_version.as_bytes()),
    ));
    attrs.push((b"process.pid", Value::Int(info.pid as i64)));
    for (k, v) in info.extra {
        let k = k.as_bytes();
        // User-provided keys win over our defaults except the sdk identity; last write wins.
        if k.starts_with(b"telemetry.sdk.") {
            continue;
        }
        if let Some(pos) = attrs.iter().position(|(bk, _)| *bk == k) {
            attrs[pos].1 = Value::Str(v.as_bytes());
        } else {
            attrs.push((k, Value::Str(v.as_bytes())));
        }
    }
    otlp::encode_resource(&attrs)
}
