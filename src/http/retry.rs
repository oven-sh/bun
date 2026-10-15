//! How long a request that failed waits before it is sent again.

use std::time::Duration;

use bun_core::strings;

use crate::HTTPClientResult;

/// The first wait in ms, from the value of `BUN_CONFIG_HTTP_RETRY_BACKOFF`. 0 sends again at once.
pub fn base_ms(configured: Option<&[u8]>) -> u32 {
    configured
        .and_then(|ms| bun_core::parse_unsigned::<u32>(ms, 10).ok())
        .unwrap_or(250)
}

/// `attempt` is 1 for the first retry. +-20%, so that a fleet of clients does not retry in step.
pub fn backoff(base_ms: u32, attempt: u16) -> Duration {
    let base = u64::from(base_ms);
    let ms = (base << attempt.saturating_sub(1).min(6)).min(base * 40);
    let jitter = ms / 5;
    Duration::from_millis(ms - jitter + bun_core::fast_random() % (2 * jitter + 1))
}

/// `Retry-After: <seconds>`, at most a minute. The HTTP-date form is ignored.
pub fn retry_after(response: &HTTPClientResult<'_>) -> Option<Duration> {
    let value = response.metadata.as_ref()?.header(b"retry-after")?;
    let secs = bun_core::parse_unsigned::<u64>(strings::trim(value, b" \t"), 10).ok()?;
    Some(Duration::from_secs(secs.min(60)))
}
