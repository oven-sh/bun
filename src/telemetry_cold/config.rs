//! Configuration from `OTEL_*` / `BUN_OTEL*` environment variables and the
//! programmatic/bunfig options that override them.
//! https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/

use bun_telemetry::processor::BatchConfig;
use bun_telemetry::{CapturedHeader, Instrument, InstrumentSet, Limits, Sampler, State};

/// The OTLP/HTTP collector a bare `BUN_OTEL=1` / `Bun.otel.start()` exports to.
pub const DEFAULT_COLLECTOR: &str = "http://localhost:4318";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Compression {
    None,
    Gzip,
}

/// An OTLP/HTTP (protobuf) traces exporter.
#[derive(Clone, Debug)]
pub struct OtlpExporterConfig {
    /// Full URL of the traces endpoint (see [`traces_endpoint`]).
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub compression: Compression,
    pub timeout_ms: u32,
}

impl OtlpExporterConfig {
    pub fn new(url: String) -> OtlpExporterConfig {
        OtlpExporterConfig {
            url,
            headers: Vec::new(),
            compression: Compression::None,
            timeout_ms: 10000,
        }
    }
}

#[derive(Clone, Debug)]
pub enum ExporterConfig {
    Otlp(OtlpExporterConfig),
    /// OTLP/JSON on stderr (`OTEL_TRACES_EXPORTER=console`, `exporters: ["console"]`).
    Console,
}

/// The traces URL for an OTLP base endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`):
/// the spec appends `/v1/traces` to
/// whatever path the base has. Idempotent, so a full traces URL passes through.
/// Signal-specific URLs (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) are not passed
/// through here; they are used verbatim.
pub fn traces_endpoint(base: &str) -> String {
    let b = base.trim_end_matches('/');
    if b.ends_with("/v1/traces") {
        return b.to_string();
    }
    format!("{b}/v1/traces")
}

/// `Bun.otel.start({ endpoint })` / bunfig `endpoint`: a bare collector base
/// URL (no path) gets `/v1/traces`; a URL with a path is used as-is.
pub fn normalize_traces_url(url: &str) -> String {
    let after_scheme =
        bun_core::strings::index_of(url.as_bytes(), b"://").map_or(0, |i| i as usize + 3);
    match bun_core::strings::index_of_char(&url.as_bytes()[after_scheme..], b'/')
        .map(|i| i as usize)
    {
        None => traces_endpoint(url),
        Some(i) if url[after_scheme + i..].trim_end_matches('/').is_empty() => traces_endpoint(url),
        Some(_) => url.to_string(),
    }
}

/// A `resourceAttributes` / OTEL_RESOURCE_ATTRIBUTES value (env values are strings).
#[derive(Clone, Debug, PartialEq)]
pub enum ResourceValue {
    Str(String),
    Int(i64),
    Double(f64),
    Bool(bool),
}

impl std::fmt::Display for ResourceValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResourceValue::Str(s) => f.write_str(s),
            ResourceValue::Int(i) => write!(f, "{i}"),
            ResourceValue::Double(d) => write!(f, "{d}"),
            ResourceValue::Bool(b) => write!(f, "{b}"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub service_name: Option<String>,
    /// Extra resource attributes (`OTEL_RESOURCE_ATTRIBUTES` and user config).
    pub resource_attributes: Vec<(String, ResourceValue)>,
    pub sampler: Sampler,
    /// Instruments that record.
    pub instruments: InstrumentSet,
    /// Instruments allowed to start root spans.
    pub roots: InstrumentSet,
    pub batch: BatchConfig,
    pub exporters: Vec<ExporterConfig>,
    pub propagate_trace_context: bool,
    pub propagate_baggage: bool,
    pub limits: Limits,
    /// Record `db.query.text` for SQL/SQLite/Redis spans.
    pub capture_db_statement: bool,
    /// Request headers to record as `http.request.header.<name>` (lowercase).
    pub capture_request_headers: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        let d = State::DEFAULT;
        Config {
            service_name: None,
            resource_attributes: Vec::new(),
            sampler: d.sampler,
            instruments: InstrumentSet::ALL,
            roots: InstrumentSet::default_roots(),
            batch: BatchConfig::default(),
            exporters: Vec::new(),
            propagate_trace_context: d.propagate_trace_context,
            propagate_baggage: d.propagate_baggage,
            limits: d.limits,
            capture_db_statement: d.capture_db_statement,
            capture_request_headers: Vec::new(),
        }
    }
}

impl Config {
    /// The hot-path knobs `bun_telemetry::set_state` publishes.
    pub fn state(&self) -> State {
        State {
            sampler: self.sampler,
            limits: self.limits,
            propagate_trace_context: self.propagate_trace_context,
            propagate_baggage: self.propagate_baggage,
            capture_db_statement: self.capture_db_statement,
            capture_request_headers: self
                .capture_request_headers
                .iter()
                .map(|s| CapturedHeader::new(s.as_bytes()))
                .collect(),
        }
    }

    /// At most one console exporter, however many times `console` is listed.
    pub fn add_console(&mut self) {
        if !self
            .exporters
            .iter()
            .any(|e| matches!(e, ExporterConfig::Console))
        {
            self.exporters.push(ExporterConfig::Console);
        }
    }

    pub fn otlp_exporters(&self) -> impl Iterator<Item = &OtlpExporterConfig> {
        self.exporters.iter().filter_map(|e| match e {
            ExporterConfig::Otlp(x) => Some(x),
            ExporterConfig::Console => None,
        })
    }
}

/// `bunfig.toml` `[otel]` table, recorded at startup and layered
/// under the environment (env vars win, matching every other OTel SDK).
#[derive(Default, Clone, Debug)]
pub struct Bunfig {
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    pub headers: Vec<(String, String)>,
    pub service_name: Option<String>,
}

static BUNFIG: std::sync::OnceLock<Bunfig> = std::sync::OnceLock::new();

pub fn set_bunfig(b: Bunfig) {
    let _ = BUNFIG.set(b);
}

pub fn bunfig() -> Option<&'static Bunfig> {
    BUNFIG.get()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Activation {
    /// `OTEL_SDK_DISABLED`: nothing may turn tracing on, `Bun.otel.start()` included.
    SdkDisabled,
    /// Not enabled by `BUN_OTEL`/bunfig; `Bun.otel.start()` may.
    Off,
    /// `BUN_OTEL` truthy or bunfig `[otel] enabled = true`.
    On,
}

/// Outcome of reading the environment.
pub struct EnvConfig {
    pub activation: Activation,
    /// `OTEL_TRACES_EXPORTER` was set (possibly `none`): the environment
    /// chose the exporters, so `start()` adds no default endpoint.
    pub exporters_chosen_by_env: bool,
    pub config: Config,
    pub warnings: Vec<String>,
}

fn truthy(v: &[u8]) -> bool {
    bun_core::env_var::string_is_truthy(v.trim_ascii())
}

fn s(v: &[u8]) -> String {
    bstr::ByteSlice::to_str_lossy(v.trim_ascii()).into_owned()
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
    // OTel spec: header values are percent-decoded; malformed escapes are kept verbatim.
    let _ = bun_url::PercentEncoding::decode_fault_tolerant::<_, true>(&mut out, v);
    bstr::ByteVec::into_string_lossy(out)
}

/// Read configuration from the environment via `get`.
#[cold]
#[inline(never)]
pub fn from_env(get: &dyn Fn(&str) -> Option<Vec<u8>>) -> EnvConfig {
    // OTel SDK env spec: an empty value is the same as unset.
    let get = |k: &str| get(k).filter(|v| !v.trim_ascii().is_empty());
    let mut c = Config::default();
    let mut warnings = Vec::new();

    let bunfig = bunfig();
    let activation = if get("OTEL_SDK_DISABLED").is_some_and(|v| truthy(&v)) {
        Activation::SdkDisabled
    } else if get("BUN_OTEL")
        .map(|v| truthy(&v))
        .or_else(|| bunfig.and_then(|b| b.enabled))
        .unwrap_or(false)
    {
        Activation::On
    } else {
        Activation::Off
    };
    let enabled = activation == Activation::On;
    let mut exporters_chosen_by_env = false;
    // service.name: OTEL_SERVICE_NAME > OTEL_RESOURCE_ATTRIBUTES > bunfig.
    if let Some(v) = get("OTEL_SERVICE_NAME") {
        let v = s(&v);
        if !v.is_empty() {
            c.service_name = Some(v);
        }
    }
    if let Some(v) = get("OTEL_RESOURCE_ATTRIBUTES") {
        c.resource_attributes = parse_kv_list(&v)
            .into_iter()
            .map(|(k, v)| (k, ResourceValue::Str(v)))
            .collect();
        if c.service_name.is_none() {
            if let Some((_, v)) = c
                .resource_attributes
                .iter()
                .find(|(k, _)| k == "service.name")
            {
                c.service_name = Some(v.to_string());
            }
        }
        c.resource_attributes.retain(|(k, _)| k != "service.name");
    }
    if c.service_name.is_none() {
        if let Some(b) = bunfig {
            c.service_name.clone_from(&b.service_name);
        }
    }

    if let Some(name) = get("OTEL_TRACES_SAMPLER") {
        let arg = get("OTEL_TRACES_SAMPLER_ARG");
        let ratio = Sampler::parse_ratio_arg(arg.as_deref()).unwrap_or_else(|()| {
            warnings.push(format!(
                "OTEL_TRACES_SAMPLER_ARG {:?} is not a number in 0..=1; using 1.0",
                s(arg.as_deref().unwrap_or_default())
            ));
            None
        });
        match Sampler::from_env(name.trim_ascii(), ratio) {
            Some(sm) => c.sampler = sm,
            None => warnings.push(format!(
                "unknown OTEL_TRACES_SAMPLER {:?}; using parentbased_always_on",
                s(&name)
            )),
        }
    }

    let num = |k: &str, w: &mut Vec<String>| -> Option<u32> {
        let v = get(k)?;
        match bun_core::fmt::parse_unsigned::<u32>(v.trim_ascii(), 10).ok() {
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
        c.batch.max_queue_size = n;
    }
    if let Some(n) = num("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", &mut warnings) {
        c.batch.max_export_batch_size = n;
    }
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

    // Exporter selection: OTEL_EXPORTER_OTLP_* (and bunfig endpoint/headers).
    match get("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL")
        .or_else(|| get("OTEL_EXPORTER_OTLP_PROTOCOL"))
        .as_deref()
        .map(<[u8]>::trim_ascii)
    {
        None | Some(b"" | b"http/protobuf") => {}
        Some(v @ (b"http/json" | b"grpc")) => warnings.push(format!(
            "OTEL_EXPORTER_OTLP_PROTOCOL={} is not supported yet; using http/protobuf on the same endpoint",
            s(v)
        )),
        Some(other) => warnings.push(format!(
            "unknown OTEL_EXPORTER_OTLP_PROTOCOL {:?}; using http/protobuf",
            s(other)
        )),
    }
    let explicit_url = if let Some(v) = get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") {
        Some(s(&v))
    } else if let Some(v) = get("OTEL_EXPORTER_OTLP_ENDPOINT") {
        Some(traces_endpoint(&s(&v)))
    } else {
        bunfig
            .and_then(|b| b.endpoint.as_deref())
            .map(normalize_traces_url)
    };
    let mut env_headers = bunfig.map(|b| b.headers.clone()).unwrap_or_default();
    for (k, val) in get("OTEL_EXPORTER_OTLP_HEADERS")
        .map(|v| parse_kv_list(&v))
        .unwrap_or_default()
    {
        env_headers.retain(|(hk, _)| !hk.eq_ignore_ascii_case(&k));
        env_headers.push((k, val));
    }
    if let Some(v) = get("OTEL_EXPORTER_OTLP_TRACES_HEADERS") {
        for (k, val) in parse_kv_list(&v) {
            env_headers.retain(|(hk, _)| !hk.eq_ignore_ascii_case(&k));
            env_headers.push((k, val));
        }
    }
    let compression = match get("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION")
        .or_else(|| get("OTEL_EXPORTER_OTLP_COMPRESSION"))
        .as_deref()
        .map(<[u8]>::trim_ascii)
    {
        Some(b"gzip") => Some(Compression::Gzip),
        Some(b"none") | Some(b"") => Some(Compression::None),
        None => None,
        Some(other) => {
            warnings.push(format!(
                "unknown OTEL_EXPORTER_OTLP_COMPRESSION {:?}; using none",
                s(other)
            ));
            Some(Compression::None)
        }
    };
    let timeout_ms = num("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", &mut warnings)
        .or_else(|| num("OTEL_EXPORTER_OTLP_TIMEOUT", &mut warnings));

    let mut want_otlp = true;
    if let Some(v) = get("OTEL_TRACES_EXPORTER") {
        want_otlp = false;
        exporters_chosen_by_env = true;
        for e in bun_core::strings::split(&v, b",") {
            match e.trim_ascii() {
                b"otlp" => want_otlp = true,
                b"console" => c.add_console(),
                b"" => {}
                b"none" => {
                    c.exporters.clear();
                    want_otlp = false;
                }
                other => warnings.push(format!(
                    "OTEL_TRACES_EXPORTER: {:?} is not supported",
                    s(other)
                )),
            }
        }
    }
    if want_otlp {
        let url = explicit_url.or_else(|| enabled.then(|| traces_endpoint(DEFAULT_COLLECTOR)));
        if let Some(url) = url {
            let mut x = OtlpExporterConfig::new(url);
            x.headers = env_headers;
            if let Some(v) = compression {
                x.compression = v;
            }
            if let Some(t) = timeout_ms {
                x.timeout_ms = t;
            }
            c.exporters.push(ExporterConfig::Otlp(x));
        }
    }

    // Instrument selection: BUN_OTEL_INSTRUMENTATIONS is an allow-list,
    // BUN_OTEL_DISABLE a deny-list; `name!` forces root spans on, `name?`
    // forces parent-required.
    if let Some(v) = get("BUN_OTEL_INSTRUMENTATIONS") {
        let mut mask = InstrumentSet::EMPTY;
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
                    mask.insert(i);
                    match force {
                        Some(true) => c.roots.insert(i),
                        Some(false) => c.roots.remove(i),
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
        c.instruments = mask.with(Instrument::User);
    }
    if let Some(v) = get("BUN_OTEL_DISABLE") {
        for n in bun_core::strings::split(&v, b",") {
            let n = n.trim_ascii();
            if n.is_empty() {
                continue;
            }
            match Instrument::from_name(n) {
                Some(i) => c.instruments.remove(i),
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
        for h in bun_core::strings::split(&v, b",") {
            let h = s(h.trim_ascii()).to_ascii_lowercase();
            if h.is_empty() {
                continue;
            }
            // RFC 9110 token characters; anything else can never match a header.
            if h.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            {
                c.capture_request_headers.push(h);
            } else {
                warnings.push(format!(
                    "OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST: {h:?} is not a valid header name; ignored"
                ));
            }
        }
    }
    for unsupported in [
        "OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE",
        "OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_CLIENT_REQUEST",
        "OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_CLIENT_RESPONSE",
    ] {
        if get(unsupported).is_some() {
            warnings.push(format!(
                "{unsupported} is not supported yet; those headers are not recorded"
            ));
        }
    }
    // Client certificates / a custom CA for the exporter are not wired up yet;
    // say so rather than silently exporting without them. (NODE_EXTRA_CA_CERTS,
    // NODE_TLS_REJECT_UNAUTHORIZED and HTTPS_PROXY / NO_PROXY do apply.)
    for unsupported in [
        "OTEL_EXPORTER_OTLP_CERTIFICATE",
        "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE",
        "OTEL_EXPORTER_OTLP_CLIENT_KEY",
        "OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY",
        "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE",
        "OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE",
    ] {
        if get(unsupported).is_some() {
            warnings.push(format!("{unsupported} is not supported yet and is ignored"));
        }
    }

    EnvConfig {
        activation,
        exporters_chosen_by_env,
        config: c,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_telemetry::RootSampler;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<Vec<u8>> {
        let m: Vec<(String, Vec<u8>)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.as_bytes().to_vec()))
            .collect();
        move |k: &str| m.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone())
    }

    #[test]
    fn invalid_sampler_arg_warns_and_defaults() {
        let e = env(&[
            ("BUN_OTEL", "1"),
            ("OTEL_TRACES_SAMPLER", "traceidratio"),
            ("OTEL_TRACES_SAMPLER_ARG", "lots"),
        ]);
        let r = from_env(&e);
        assert!(matches!(
            r.config.sampler,
            Sampler::Root(RootSampler::TraceIdRatio(u64::MAX))
        ));
        assert!(
            r.warnings
                .iter()
                .any(|w| w.starts_with("OTEL_TRACES_SAMPLER_ARG"))
        );
        let e = env(&[
            ("BUN_OTEL", "1"),
            ("OTEL_TRACES_SAMPLER", "traceidratio"),
            ("OTEL_TRACES_SAMPLER_ARG", " 0.5 "),
        ]);
        let r = from_env(&e);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        assert!(matches!(
            r.config.sampler,
            Sampler::Root(RootSampler::TraceIdRatio(t)) if t != u64::MAX && t != 0
        ));
    }

    #[test]
    fn empty_env_values_are_unset() {
        let e = env(&[
            ("BUN_OTEL", "1"),
            ("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", ""),
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "  "),
            ("OTEL_SERVICE_NAME", ""),
        ]);
        let r = from_env(&e);
        let otlp: Vec<_> = r.config.otlp_exporters().collect();
        assert_eq!(otlp.len(), 1);
        assert_eq!(otlp[0].url, "http://localhost:4318/v1/traces");
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn defaults_when_enabled() {
        let e = env(&[("BUN_OTEL", "1")]);
        let r = from_env(&e);
        assert_eq!(r.activation, Activation::On);
        let otlp: Vec<_> = r.config.otlp_exporters().collect();
        assert_eq!(otlp.len(), 1);
        assert_eq!(otlp[0].url, "http://localhost:4318/v1/traces");
    }

    #[test]
    fn repeated_console_exporter_is_one() {
        let e = env(&[
            ("BUN_OTEL", "1"),
            ("OTEL_TRACES_EXPORTER", "console, console,otlp,otlp"),
        ]);
        let c = from_env(&e).config;
        let consoles = c
            .exporters
            .iter()
            .filter(|e| matches!(e, ExporterConfig::Console))
            .count();
        assert_eq!(consoles, 1);
        assert_eq!(c.otlp_exporters().count(), 1);
    }

    #[test]
    fn traces_exporter_none_and_otlp_env() {
        let e = env(&[
            ("BUN_OTEL", "1"),
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector"),
            ("OTEL_TRACES_EXPORTER", "none"),
        ]);
        assert!(from_env(&e).config.exporters.is_empty());
        let e = env(&[
            ("BUN_OTEL", "1"),
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector"),
            ("OTEL_EXPORTER_OTLP_HEADERS", "authorization=x"),
            ("OTEL_EXPORTER_OTLP_COMPRESSION", "none"),
            ("OTEL_EXPORTER_OTLP_TIMEOUT", "1234"),
        ]);
        let r = from_env(&e);
        let otlp: Vec<_> = r.config.otlp_exporters().collect();
        assert_eq!(otlp.len(), 1);
        let x = otlp[0];
        assert_eq!(x.url, "https://collector/v1/traces");
        assert!(
            x.headers
                .iter()
                .any(|(k, v)| k == "authorization" && v == "x")
        );
        assert_eq!(x.compression, Compression::None);
        assert_eq!(x.timeout_ms, 1234);
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
        let x = r.config.otlp_exporters().next().unwrap();
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
            vec![(
                "deployment.environment".into(),
                ResourceValue::Str("prod".into())
            )]
        );
        assert!(!r.config.instruments.contains(Instrument::Fs));
        assert!(!r.config.instruments.contains(Instrument::Dns));
        assert!(r.config.instruments.contains(Instrument::HttpServer));
    }

    #[test]
    fn disabled() {
        let e = env(&[("BUN_OTEL", "1"), ("OTEL_SDK_DISABLED", "true")]);
        assert_eq!(from_env(&e).activation, Activation::SdkDisabled);
        let e = env(&[("OTEL_EXPORTER_OTLP_ENDPOINT", "http://x")]);
        let r = from_env(&e);
        assert_eq!(r.activation, Activation::Off);
        // Endpoint is still parsed so `Bun.otel.start()` with no args uses it.
        assert_eq!(
            r.config.otlp_exporters().next().unwrap().url,
            "http://x/v1/traces"
        );
    }
}
