//! Configuration from `OTEL_*` / `BUN_OTEL*` environment variables and the
//! programmatic/bunfig options that override them.
//! https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/

use crate::data::{DEFAULT_LIMITS, Limits};
use crate::processor::BatchConfig;
use crate::{Instrument, Sampler};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Protocol {
    HttpProtobuf,
    HttpJson,
    Grpc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Compression {
    None,
    Gzip,
}

#[derive(Clone, Debug)]
pub struct OtlpExporterConfig {
    /// Full URL of the traces endpoint (…/v1/traces already appended when
    /// derived from `OTEL_EXPORTER_OTLP_ENDPOINT`).
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub protocol: Protocol,
    pub compression: Compression,
    pub timeout_ms: u32,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub service_name: Option<String>,
    /// Extra resource attributes (`OTEL_RESOURCE_ATTRIBUTES` and user config).
    pub resource_attributes: Vec<(String, String)>,
    pub sampler: Sampler,
    /// Bitmask of `Instrument`s that record.
    pub instruments: u32,
    /// Bitmask of `Instrument`s allowed to start root spans.
    pub roots: u32,
    pub batch: BatchConfig,
    pub otlp_exporters: Vec<OtlpExporterConfig>,
    /// `OTEL_TRACES_EXPORTER=console`.
    pub console_exporter: bool,
    pub propagate_trace_context: bool,
    pub propagate_baggage: bool,
    pub limits: Limits,
    /// Record `db.query.text` for SQL/SQLite/Redis spans.
    pub capture_db_statement: bool,
    /// Request headers to record as `http.request.header.<name>` (lowercase).
    pub capture_request_headers: Vec<String>,
    pub capture_response_headers: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        let mut all = 0u32;
        let mut roots = 0u32;
        for i in Instrument::ALL {
            all |= i.bit();
            if !i.requires_parent_by_default() {
                roots |= i.bit();
            }
        }
        Config {
            service_name: None,
            resource_attributes: Vec::new(),
            sampler: Sampler::default(),
            instruments: all,
            roots,
            batch: BatchConfig::default(),
            otlp_exporters: Vec::new(),
            console_exporter: false,
            propagate_trace_context: true,
            propagate_baggage: true,
            limits: DEFAULT_LIMITS,
            capture_db_statement: true,
            capture_request_headers: Vec::new(),
            capture_response_headers: Vec::new(),
        }
    }
}

/// `bunfig.toml` `[telemetry]` table, recorded at startup and layered
/// under the environment (env vars win, matching every other OTel SDK).
#[derive(Default, Clone, Debug)]
pub struct Bunfig {
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    pub headers: Vec<(String, String)>,
    pub service_name: Option<String>,
    /// `exporter = "datadog"` (see presets.rs); `BUN_OTEL_EXPORTER` wins.
    pub exporter: Option<String>,
}

static BUNFIG: std::sync::OnceLock<Bunfig> = std::sync::OnceLock::new();

pub fn set_bunfig(b: Bunfig) {
    let _ = BUNFIG.set(b);
}

pub fn bunfig() -> Option<&'static Bunfig> {
    BUNFIG.get()
}

/// Outcome of reading the environment.
pub struct EnvConfig {
    /// `BUN_OTEL` truthy (or `OTEL_BUN`), and not `OTEL_SDK_DISABLED`.
    pub enabled: bool,
    pub config: Config,
    pub warnings: Vec<String>,
}

fn truthy(v: &[u8]) -> bool {
    let v = v.trim_ascii();
    v == b"1"
        || v.eq_ignore_ascii_case(b"true")
        || v.eq_ignore_ascii_case(b"yes")
        || v.eq_ignore_ascii_case(b"on")
}

fn s(v: &[u8]) -> String {
    String::from_utf8_lossy(v.trim_ascii()).into_owned()
}

/// Parse `k=v,k2=v2` with URL-decoding of values (used by
/// OTEL_EXPORTER_OTLP_HEADERS and OTEL_RESOURCE_ATTRIBUTES).
pub fn parse_kv_list(v: &[u8]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for part in bun_core::strings::split(v, b",") {
        let part = part.trim_ascii();
        if part.is_empty() {
            continue;
        }
        let Some(eq) = bun_core::strings::index_of_char_usize(part, b'=') else {
            continue;
        };
        let k = s(&part[..eq]);
        let val = percent_decode(part[eq + 1..].trim_ascii());
        if !k.is_empty() {
            out.push((k, val));
        }
    }
    out
}

fn percent_decode(v: &[u8]) -> String {
    let mut out = Vec::with_capacity(v.len());
    let mut i = 0;
    while i < v.len() {
        if v[i] == b'%' && i + 2 < v.len() {
            let h = |c: u8| (c as char).to_digit(16);
            if let (Some(a), Some(b)) = (h(v[i + 1]), h(v[i + 2])) {
                out.push((a * 16 + b) as u8);
                i += 3;
                continue;
            }
        }
        out.push(v[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn join_url(base: &str, path: &str) -> String {
    let b = base.trim_end_matches('/');
    format!("{b}{path}")
}

/// Read configuration from the environment via `get`.
pub fn from_env(get: &dyn Fn(&str) -> Option<Vec<u8>>) -> EnvConfig {
    let mut c = Config::default();
    let mut warnings = Vec::new();

    let bunfig = bunfig();
    let mut enabled = get("BUN_OTEL")
        .map(|v| truthy(&v))
        .or_else(|| get("OTEL_BUN").map(|v| truthy(&v)))
        .or_else(|| bunfig.and_then(|b| b.enabled))
        .unwrap_or(false);
    if get("OTEL_SDK_DISABLED")
        .map(|v| truthy(&v))
        .unwrap_or(false)
    {
        enabled = false;
    }
    if let Some(b) = bunfig {
        c.service_name = b.service_name.clone();
    }

    if let Some(v) = get("OTEL_SERVICE_NAME") {
        let v = s(&v);
        if !v.is_empty() {
            c.service_name = Some(v);
        }
    }
    if let Some(v) = get("OTEL_RESOURCE_ATTRIBUTES") {
        c.resource_attributes = parse_kv_list(&v);
        if c.service_name.is_none() {
            if let Some((_, v)) = c
                .resource_attributes
                .iter()
                .find(|(k, _)| k == "service.name")
            {
                c.service_name = Some(v.clone());
            }
        }
        c.resource_attributes.retain(|(k, _)| k != "service.name");
    }

    if let Some(name) = get("OTEL_TRACES_SAMPLER") {
        let arg = get("OTEL_TRACES_SAMPLER_ARG");
        match Sampler::from_env(name.trim_ascii(), arg.as_deref()) {
            Some(sm) => c.sampler = sm,
            None => warnings.push(format!(
                "unknown OTEL_TRACES_SAMPLER {:?}; using parentbased_always_on",
                s(&name)
            )),
        }
    }

    let num = |k: &str, w: &mut Vec<String>| -> Option<u32> {
        let v = get(k)?;
        match core::str::from_utf8(v.trim_ascii())
            .ok()
            .and_then(|x| x.parse::<u32>().ok())
        {
            Some(n) => Some(n),
            None => {
                w.push(format!("{k} is not a non-negative integer; ignoring"));
                None
            }
        }
    };
    if let Some(n) = num("OTEL_BSP_SCHEDULE_DELAY", &mut warnings) {
        c.batch.scheduled_delay_ms = n;
    }
    if let Some(n) = num("OTEL_BSP_EXPORT_TIMEOUT", &mut warnings) {
        c.batch.export_timeout_ms = n;
    }
    if let Some(n) = num("OTEL_BSP_MAX_QUEUE_SIZE", &mut warnings) {
        c.batch.max_queue_size = n.max(1);
    }
    if let Some(n) = num("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", &mut warnings) {
        c.batch.max_export_batch_size = n.max(1);
    }
    c.batch.max_export_batch_size = c.batch.max_export_batch_size.min(c.batch.max_queue_size);
    if let Some(n) = num("OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT", &mut warnings)
        .or_else(|| num("OTEL_ATTRIBUTE_COUNT_LIMIT", &mut warnings))
    {
        c.limits.attributes = n.min(u16::MAX as u32) as u16;
    }
    if let Some(n) = num("OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", &mut warnings)
        .or_else(|| num("OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT", &mut warnings))
    {
        c.limits.attribute_value_length = n;
    }
    if let Some(n) = num("OTEL_SPAN_EVENT_COUNT_LIMIT", &mut warnings) {
        c.limits.events = n.min(u16::MAX as u32) as u16;
    }
    if let Some(n) = num("OTEL_SPAN_LINK_COUNT_LIMIT", &mut warnings) {
        c.limits.links = n.min(u16::MAX as u32) as u16;
    }

    if let Some(v) = get("OTEL_PROPAGATORS") {
        c.propagate_trace_context = false;
        c.propagate_baggage = false;
        for p in bun_core::strings::split(&v, b",") {
            match p.trim_ascii() {
                b"tracecontext" => c.propagate_trace_context = true,
                b"baggage" => c.propagate_baggage = true,
                b"none" | b"" => {}
                other => warnings.push(format!(
                    "OTEL_PROPAGATORS: {:?} is not supported; supported: tracecontext, baggage",
                    s(other)
                )),
            }
        }
    }

    // Exporter selection.
    let mut want_otlp = true;
    let preset = get("BUN_OTEL_EXPORTER").or_else(|| {
        bunfig
            .and_then(|b| b.exporter.clone())
            .map(|s| s.into_bytes())
    });
    if let Some(v) = preset {
        for name in bun_core::strings::split(&v, b",") {
            let name = name.trim_ascii();
            if name.is_empty() {
                continue;
            }
            want_otlp = false;
            let input = crate::presets::PresetInput {
                name: &s(name),
                api_key: None,
                site: None,
                id: None,
                endpoint: None,
            };
            match crate::presets::resolve(&input, &|k| get(k).map(|v| s(&v))) {
                Ok(x) => c.otlp_exporters.push(x),
                Err(e) => warnings.push(format!("BUN_OTEL_EXPORTER: {e}")),
            }
        }
    }
    if let Some(v) = get("OTEL_TRACES_EXPORTER") {
        want_otlp = false;
        for e in bun_core::strings::split(&v, b",") {
            match e.trim_ascii() {
                b"otlp" => want_otlp = true,
                b"console" => c.console_exporter = true,
                b"none" | b"" => {}
                other => warnings.push(format!(
                    "OTEL_TRACES_EXPORTER: {:?} is not supported",
                    s(other)
                )),
            }
        }
    }
    if want_otlp {
        let protocol = match get("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL")
            .or_else(|| get("OTEL_EXPORTER_OTLP_PROTOCOL"))
            .as_deref()
            .map(|v| v.trim_ascii().to_vec())
            .as_deref()
        {
            None | Some(b"" | b"http/protobuf") => Protocol::HttpProtobuf,
            Some(b"http/json") => Protocol::HttpJson,
            Some(b"grpc") => {
                warnings.push("OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported yet; using http/protobuf on the same endpoint".into());
                Protocol::HttpProtobuf
            }
            Some(other) => {
                warnings.push(format!(
                    "unknown OTEL_EXPORTER_OTLP_PROTOCOL {:?}; using http/protobuf",
                    s(other)
                ));
                Protocol::HttpProtobuf
            }
        };
        let url = if let Some(v) = get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") {
            let v = s(&v);
            if v.is_empty() { None } else { Some(v) }
        } else if let Some(v) = get("OTEL_EXPORTER_OTLP_ENDPOINT") {
            let v = s(&v);
            if v.is_empty() {
                None
            } else {
                Some(join_url(&v, "/v1/traces"))
            }
        } else if let Some(v) = bunfig.and_then(|b| b.endpoint.as_deref()) {
            Some(join_url(v, "/v1/traces"))
        } else if enabled {
            Some("http://localhost:4318/v1/traces".to_string())
        } else {
            None
        };
        if let Some(url) = url {
            let mut headers = bunfig.map(|b| b.headers.clone()).unwrap_or_default();
            for (k, val) in get("OTEL_EXPORTER_OTLP_HEADERS")
                .map(|v| parse_kv_list(&v))
                .unwrap_or_default()
            {
                headers.retain(|(hk, _)| !hk.eq_ignore_ascii_case(&k));
                headers.push((k, val));
            }
            if let Some(v) = get("OTEL_EXPORTER_OTLP_TRACES_HEADERS") {
                for (k, val) in parse_kv_list(&v) {
                    headers.retain(|(hk, _)| !hk.eq_ignore_ascii_case(&k));
                    headers.push((k, val));
                }
            }
            let compression = match get("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION")
                .or_else(|| get("OTEL_EXPORTER_OTLP_COMPRESSION"))
                .as_deref()
                .map(|v| v.trim_ascii().to_vec())
                .as_deref()
            {
                Some(b"gzip") => Compression::Gzip,
                None | Some(b"none") | Some(b"") => Compression::None,
                Some(other) => {
                    warnings.push(format!(
                        "unknown OTEL_EXPORTER_OTLP_COMPRESSION {:?}; using none",
                        s(other)
                    ));
                    Compression::None
                }
            };
            let timeout_ms = num("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", &mut warnings)
                .or_else(|| num("OTEL_EXPORTER_OTLP_TIMEOUT", &mut warnings))
                .unwrap_or(10000);
            c.otlp_exporters.push(OtlpExporterConfig {
                url,
                headers,
                protocol,
                compression,
                timeout_ms,
            });
        }
    }

    // Instrument selection: BUN_OTEL_INSTRUMENTATIONS is an allow-list,
    // BUN_OTEL_DISABLE a deny-list; `name!` forces root spans on, `name?`
    // forces parent-required.
    if let Some(v) = get("BUN_OTEL_INSTRUMENTATIONS") {
        let mut mask = 0u32;
        for n in bun_core::strings::split(&v, b",") {
            let n = n.trim_ascii();
            if n.is_empty() {
                continue;
            }
            let (n, force) = match n.last() {
                Some(b'!') => (&n[..n.len() - 1], Some(true)),
                Some(b'?') => (&n[..n.len() - 1], Some(false)),
                _ => (n, None),
            };
            match Instrument::from_name(n) {
                Some(i) => {
                    mask |= i.bit();
                    match force {
                        Some(true) => c.roots |= i.bit(),
                        Some(false) => c.roots &= !i.bit(),
                        None => {}
                    }
                }
                None => warnings.push(format!(
                    "BUN_OTEL_INSTRUMENTATIONS: unknown instrumentation {:?}",
                    s(n)
                )),
            }
        }
        // User spans are always allowed.
        c.instruments = mask | Instrument::User.bit();
    }
    if let Some(v) = get("BUN_OTEL_DISABLE") {
        for n in bun_core::strings::split(&v, b",") {
            let n = n.trim_ascii();
            if n.is_empty() {
                continue;
            }
            match Instrument::from_name(n) {
                Some(i) => c.instruments &= !i.bit(),
                None => warnings.push(format!(
                    "BUN_OTEL_DISABLE: unknown instrumentation {:?}",
                    s(n)
                )),
            }
        }
    }
    if let Some(v) = get("BUN_OTEL_CAPTURE_DB_STATEMENT") {
        c.capture_db_statement = truthy(&v);
    }
    if let Some(v) = get("OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST") {
        c.capture_request_headers = bun_core::strings::split(&v, b",")
            .map(|h| s(h).to_ascii_lowercase())
            .filter(|h| !h.is_empty())
            .collect();
    }
    if let Some(v) = get("OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE") {
        c.capture_response_headers = bun_core::strings::split(&v, b",")
            .map(|h| s(h).to_ascii_lowercase())
            .filter(|h| !h.is_empty())
            .collect();
    }

    EnvConfig {
        enabled,
        config: c,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<Vec<u8>> {
        let m: HashMap<String, Vec<u8>> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.as_bytes().to_vec()))
            .collect();
        move |k: &str| m.get(k).cloned()
    }

    #[test]
    fn defaults_when_enabled() {
        let e = env(&[("BUN_OTEL", "1")]);
        let r = from_env(&e);
        assert!(r.enabled);
        assert_eq!(r.config.otlp_exporters.len(), 1);
        assert_eq!(
            r.config.otlp_exporters[0].url,
            "http://localhost:4318/v1/traces"
        );
    }

    #[test]
    fn endpoint_and_headers() {
        let e = env(&[
            ("BUN_OTEL", "true"),
            (
                "OTEL_EXPORTER_OTLP_ENDPOINT",
                "https://otel.example.com:4318/",
            ),
            (
                "OTEL_EXPORTER_OTLP_HEADERS",
                "x-api-key=secret%20key, other = v",
            ),
            (
                "OTEL_RESOURCE_ATTRIBUTES",
                "service.name=api,deployment.environment=prod",
            ),
            ("BUN_OTEL_DISABLE", "fs, dns"),
        ]);
        let r = from_env(&e);
        let x = &r.config.otlp_exporters[0];
        assert_eq!(x.url, "https://otel.example.com:4318/v1/traces");
        assert_eq!(
            x.headers,
            vec![
                ("x-api-key".into(), "secret key".into()),
                ("other".into(), "v".into())
            ]
        );
        assert_eq!(r.config.service_name.as_deref(), Some("api"));
        assert_eq!(
            r.config.resource_attributes,
            vec![("deployment.environment".into(), "prod".into())]
        );
        assert_eq!(r.config.instruments & Instrument::Fs.bit(), 0);
        assert_eq!(r.config.instruments & Instrument::Dns.bit(), 0);
        assert_ne!(r.config.instruments & Instrument::HttpServer.bit(), 0);
    }

    #[test]
    fn disabled() {
        let e = env(&[("BUN_OTEL", "1"), ("OTEL_SDK_DISABLED", "true")]);
        assert!(!from_env(&e).enabled);
        let e = env(&[("OTEL_EXPORTER_OTLP_ENDPOINT", "http://x")]);
        let r = from_env(&e);
        assert!(!r.enabled);
        // Endpoint is still parsed so `Bun.otel.start()` with no args uses it.
        assert_eq!(r.config.otlp_exporters[0].url, "http://x/v1/traces");
    }
}
