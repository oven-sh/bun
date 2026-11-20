use crate::span::{SpanContext, TraceId};

/// The decision for a span with no (valid) parent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RootSampler {
    AlwaysOn,
    AlwaysOff,
    /// Threshold on the low 64 bits of the trace id.
    TraceIdRatio(u64),
}

impl RootSampler {
    #[inline]
    fn should_sample(self, trace_id: &TraceId) -> bool {
        match self {
            RootSampler::AlwaysOn => true,
            RootSampler::AlwaysOff => false,
            RootSampler::TraceIdRatio(t) => t == u64::MAX || trace_id.low_u64() < t,
        }
    }
}

/// The SDK-spec built-in samplers. `ParentBased(root)` follows a valid
/// parent's sampled flag and uses `root` otherwise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sampler {
    Root(RootSampler),
    ParentBased(RootSampler),
}

impl Default for Sampler {
    fn default() -> Self {
        Sampler::ParentBased(RootSampler::AlwaysOn)
    }
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
    pub fn should_sample(&self, parent: Option<&SpanContext>, trace_id: &TraceId) -> bool {
        match *self {
            Sampler::Root(r) => r.should_sample(trace_id),
            Sampler::ParentBased(r) => match parent.filter(|p| p.is_valid()) {
                Some(p) => p.sampled(),
                None => r.should_sample(trace_id),
            },
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
        let (parent_based, root) = match name.strip_prefix(b"parentbased_") {
            Some(root) => (true, root),
            None => (false, name),
        };
        let root = match root {
            b"always_on" => RootSampler::AlwaysOn,
            b"always_off" => RootSampler::AlwaysOff,
            b"traceidratio" => RootSampler::TraceIdRatio(threshold()),
            _ => return None,
        };
        Some(if parent_based {
            Sampler::ParentBased(root)
        } else {
            Sampler::Root(root)
        })
    }
}
