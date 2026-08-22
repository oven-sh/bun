//! Named exporter presets for hosted backends that accept OTLP/HTTP with a
//! static auth header. Anything else (AWS X-Ray, Google Cloud Trace: signed
//! per-request credentials) goes through a Collector.

use crate::config::{Compression, OtlpExporterConfig, traces_endpoint};

pub struct PresetInput<'a> {
    pub name: &'a str,
    /// API key / token. Falls back to the vendor's own env var.
    pub api_key: Option<String>,
    /// Vendor region / site / zone (e.g. `datadoghq.eu`, `eu`, `prod-us-east-0`).
    pub site: Option<String>,
    /// Second credential where the vendor needs one (Grafana instance id,
    /// Honeycomb classic dataset, Axiom dataset, Dynatrace environment id).
    pub id: Option<String>,
    /// Explicit endpoint override (base URL; `/v1/traces` is appended).
    pub endpoint: Option<String>,
}

pub type EnvGet<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Why a preset could not be turned into an exporter.
#[derive(Debug)]
pub enum PresetError {
    /// A required credential/identifier was neither passed nor found in the environment.
    Missing {
        preset: String,
        what: &'static str,
    },
    Unknown(String),
}

impl core::fmt::Display for PresetError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            PresetError::Missing { preset, what } => {
                write!(f, "exporter preset {preset:?} needs {what}")
            }
            PresetError::Unknown(name) => write!(
                f,
                "unknown exporter preset {name:?} (known: datadog, honeycomb, grafana, newrelic, axiom, dynatrace, sentry, otlp)"
            ),
        }
    }
}

fn need(what: &'static str, preset: &str) -> PresetError {
    PresetError::Missing {
        preset: preset.to_string(),
        what,
    }
}

/// Resolve a preset to a concrete OTLP/HTTP exporter. `env` reads the
/// vendor's conventional variables (`DD_API_KEY`, `HONEYCOMB_API_KEY`, …).
pub fn resolve(p: &PresetInput<'_>, env: EnvGet<'_>) -> Result<OtlpExporterConfig, PresetError> {
    let key = |vars: &[&str]| -> Option<String> {
        p.api_key
            .clone()
            .or_else(|| vars.iter().find_map(|v| env(v)))
            .filter(|s| !s.is_empty())
    };
    let site = |vars: &[&str], default: &str| -> String {
        p.site
            .clone()
            .or_else(|| vars.iter().find_map(|v| env(v)))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default.to_string())
    };
    let mut headers: Vec<(String, String)> = Vec::new();
    let url = match p.name {
        // Datadog agentless OTLP intake. With no API key, assume a local
        // Datadog Agent with OTLP ingest enabled.
        "datadog" => match key(&["DD_API_KEY"]) {
            Some(k) => {
                headers.push(("dd-api-key".into(), k));
                headers.push(("dd-otlp-source".into(), "bun".into()));
                let s = site(&["DD_SITE"], "datadoghq.com");
                traces_endpoint(
                    p.endpoint
                        .as_deref()
                        .unwrap_or(&format!("https://otlp.{s}")),
                )
            }
            None => {
                let dd_endpoint = env("DD_OTLP_ENDPOINT");
                traces_endpoint(
                    p.endpoint
                        .as_deref()
                        .or(dd_endpoint.as_deref())
                        .unwrap_or("http://localhost:4318"),
                )
            }
        },
        "honeycomb" => {
            let k = key(&["HONEYCOMB_API_KEY"])
                .ok_or_else(|| need("apiKey (or HONEYCOMB_API_KEY)", p.name))?;
            headers.push(("x-honeycomb-team".into(), k));
            if let Some(ds) = p.id.clone().or_else(|| env("HONEYCOMB_DATASET")) {
                headers.push(("x-honeycomb-dataset".into(), ds));
            }
            let s = site(&["HONEYCOMB_API_ENDPOINT"], "");
            let base = if let Some(e) = &p.endpoint {
                e.clone()
            } else if s.starts_with("http") {
                s
            } else if s.eq_ignore_ascii_case("eu") || s.starts_with("eu1") {
                "https://api.eu1.honeycomb.io".into()
            } else {
                "https://api.honeycomb.io".into()
            };
            traces_endpoint(&base)
        }
        "grafana" => {
            let token = key(&["GRAFANA_CLOUD_API_KEY", "GRAFANA_OTLP_TOKEN"])
                .ok_or_else(|| need("apiKey (a Cloud Access Policy token)", p.name))?;
            let instance =
                p.id.clone()
                    .or_else(|| env("GRAFANA_CLOUD_INSTANCE_ID"))
                    .ok_or_else(|| need("id (the stack's instance id)", p.name))?;
            let cred = format!("{instance}:{token}");
            let auth = bun_base64::encode_alloc(cred.as_bytes());
            headers.push((
                "authorization".into(),
                format!("Basic {}", bstr::ByteVec::into_string_lossy(auth)),
            ));
            let base = match (
                &p.endpoint,
                p.site.clone().or_else(|| env("GRAFANA_CLOUD_ZONE")),
            ) {
                (Some(e), _) => e.clone(),
                (None, Some(zone)) if zone.starts_with("http") => zone,
                (None, Some(zone)) => format!("https://otlp-gateway-{zone}.grafana.net/otlp"),
                (None, None) => {
                    return Err(need(
                        "site (the OTLP gateway zone, e.g. prod-us-east-0) or endpoint",
                        p.name,
                    ));
                }
            };
            traces_endpoint(&base)
        }
        "newrelic" => {
            let k = key(&["NEW_RELIC_LICENSE_KEY", "NEW_RELIC_API_KEY"])
                .ok_or_else(|| need("apiKey (or NEW_RELIC_LICENSE_KEY)", p.name))?;
            headers.push(("api-key".into(), k));
            let s = site(&["NEW_RELIC_REGION"], "us");
            let base = match &p.endpoint {
                Some(e) => e.clone(),
                None if s.eq_ignore_ascii_case("eu") => "https://otlp.eu01.nr-data.net".into(),
                None if s.eq_ignore_ascii_case("fedramp") || s.eq_ignore_ascii_case("gov") => {
                    "https://gov-otlp.nr-data.net".into()
                }
                None => "https://otlp.nr-data.net".into(),
            };
            traces_endpoint(&base)
        }
        "axiom" => {
            let k = key(&["AXIOM_TOKEN", "AXIOM_API_TOKEN"])
                .ok_or_else(|| need("apiKey (or AXIOM_TOKEN)", p.name))?;
            let ds =
                p.id.clone()
                    .or_else(|| env("AXIOM_DATASET"))
                    .ok_or_else(|| need("id (dataset name, or AXIOM_DATASET)", p.name))?;
            headers.push(("authorization".into(), format!("Bearer {k}")));
            headers.push(("x-axiom-dataset".into(), ds));
            let base = p
                .endpoint
                .clone()
                .or_else(|| p.site.clone())
                .or_else(|| env("AXIOM_DOMAIN"))
                .map(|d| {
                    if d.starts_with("http") {
                        d
                    } else {
                        format!("https://{d}")
                    }
                })
                .unwrap_or_else(|| "https://api.axiom.co".into());
            traces_endpoint(&base)
        }
        "dynatrace" => {
            let k = key(&["DT_API_TOKEN", "DYNATRACE_API_TOKEN"]).ok_or_else(|| {
                need(
                    "apiKey (an API token with openTelemetryTrace.ingest)",
                    p.name,
                )
            })?;
            headers.push(("authorization".into(), format!("Api-Token {k}")));
            let base = match (
                &p.endpoint,
                p.id.clone().or_else(|| env("DT_ENVIRONMENT_ID")),
            ) {
                (Some(e), _) => e.clone(),
                (None, Some(envid)) => format!("https://{envid}.live.dynatrace.com/api/v2/otlp"),
                (None, None) => {
                    return Err(need(
                        "id (environment id) or endpoint (…/api/v2/otlp)",
                        p.name,
                    ));
                }
            };
            traces_endpoint(&base)
        }
        // Sentry's OTLP traces URL is per project; take it verbatim.
        "sentry" => {
            let e = p
                .endpoint
                .clone()
                .or_else(|| env("SENTRY_OTLP_TRACES_ENDPOINT"))
                .ok_or_else(|| need("endpoint (the project's OTLP traces URL)", p.name))?;
            let k = key(&["SENTRY_PUBLIC_KEY"])
                .ok_or_else(|| need("apiKey (the DSN public key)", p.name))?;
            headers.push(("x-sentry-auth".into(), format!("sentry sentry_key={k}")));
            e
        }
        // Local Collector / Jaeger / Tempo.
        "otlp" => traces_endpoint(p.endpoint.as_deref().unwrap_or("http://localhost:4318")),
        other => return Err(PresetError::Unknown(other.to_string())),
    };
    Ok(OtlpExporterConfig {
        headers,
        compression: Compression::Gzip,
        ..OtlpExporterConfig::new(url)
    })
}
