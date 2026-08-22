use crate::span::{SpanContext, TraceId};

/// The SDK-spec built-in samplers. `ParentBased(root)` delegates to the
/// remote/local parent's sampled flag when there is a parent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Sampler {
    AlwaysOn,
    AlwaysOff,
    /// Threshold on the low 64 bits of the trace id.
    TraceIdRatio(u64),
    #[default]
    ParentBasedAlwaysOn,
    ParentBasedAlwaysOff,
    ParentBasedTraceIdRatio(u64),
}

impl Sampler {
    pub fn ratio_threshold(ratio: f64) -> u64 {
        if ratio.is_nan() || ratio <= 0.0 {
            return 0;
        }
        if ratio >= 1.0 {
            return u64::MAX;
        }
        (ratio * (u64::MAX as f64)) as u64
    }

    #[inline]
    fn ratio_hit(threshold: u64, trace_id: &TraceId) -> bool {
        threshold == u64::MAX || trace_id.low_u64() < threshold
    }

    #[inline]
    pub fn should_sample(&self, parent: Option<&SpanContext>, trace_id: &TraceId) -> bool {
        match *self {
            Sampler::AlwaysOn => true,
            Sampler::AlwaysOff => false,
            Sampler::TraceIdRatio(t) => Self::ratio_hit(t, trace_id),
            Sampler::ParentBasedAlwaysOn
            | Sampler::ParentBasedAlwaysOff
            | Sampler::ParentBasedTraceIdRatio(_) => {
                if let Some(p) = parent.filter(|p| p.is_valid()) {
                    return p.sampled();
                }
                match *self {
                    Sampler::ParentBasedAlwaysOn => true,
                    Sampler::ParentBasedAlwaysOff => false,
                    Sampler::ParentBasedTraceIdRatio(t) => Self::ratio_hit(t, trace_id),
                    _ => unreachable!(),
                }
            }
        }
    }

    /// `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`.
    /// `OTEL_TRACES_SAMPLER_ARG` as a ratio: `Ok(None)` when absent/empty,
    /// `Err(())` when present but not a number in 0..=1.
    pub fn parse_ratio_arg(arg: Option<&[u8]>) -> Result<Option<f64>, ()> {
        let Some(a) = arg.map(|a| a.trim_ascii()).filter(|a| !a.is_empty()) else {
            return Ok(None);
        };
        core::str::from_utf8(a)
            .ok()
            .and_then(|a| a.parse::<f64>().ok())
            .filter(|r| (0.0..=1.0).contains(r))
            .map(Some)
            .ok_or(())
    }

    /// `ratio` defaults to 1.0 (the spec default) when None.
    pub fn from_env(name: &[u8], ratio: Option<f64>) -> Option<Sampler> {
        let threshold = || ratio.map(Sampler::ratio_threshold).unwrap_or(u64::MAX);
        Some(match name {
            b"always_on" => Sampler::AlwaysOn,
            b"always_off" => Sampler::AlwaysOff,
            b"traceidratio" => Sampler::TraceIdRatio(threshold()),
            b"parentbased_always_on" => Sampler::ParentBasedAlwaysOn,
            b"parentbased_always_off" => Sampler::ParentBasedAlwaysOff,
            b"parentbased_traceidratio" => Sampler::ParentBasedTraceIdRatio(threshold()),
            _ => return None,
        })
    }
}
