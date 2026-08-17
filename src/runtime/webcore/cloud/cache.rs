//! What a credential provider remembers between resolutions: the last good
//! value (served until it expires, refreshed a little before), and the last
//! failure (served for a few seconds so a burst of callers does not re-run a
//! failing chain back to back). Scheduling — who resolves, who waits — lives
//! with the per-VM provider state; this is just the memory, behind a mutex so
//! the provider can sit in `Send + Sync` handles.

use std::sync::Arc;

use bun_s3_signing::ProviderError;
use bun_threading::Guarded;

pub trait Expiring {
    /// Unix epoch seconds; `None` never expires.
    fn expiration(&self) -> Option<u64>;
}

impl Expiring for bun_s3_signing::AwsCredentials {
    fn expiration(&self) -> Option<u64> {
        self.expiration
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

struct State<V> {
    cached: Option<Arc<V>>,
    /// When `cached` was obtained. A value counts as fresh for at least
    /// `MIN_REFRESH_INTERVAL` after that even if it was issued already inside
    /// the refresh window, so short-lived credentials do not refresh back to back.
    resolved_at: u64,
    last_error: Option<(Arc<ProviderError>, u64)>,
    /// A consumer read the value since the last `settle`.
    used: bool,
    /// `refresh: true`: the value no longer counts as fresh (but stays
    /// usable) until the next `settle`.
    stale: bool,
}

pub struct CredentialCache<V> {
    state: Guarded<State<V>>,
    /// Refresh this many seconds before expiry.
    refresh_window: u64,
}

/// Credentials this close to expiry are treated as expired (clock skew /
/// request latency margin).
const EXPIRY_MARGIN: u64 = bun_s3_signing::AwsCredentials::EXPIRY_MARGIN_SECONDS;
/// A failure is remembered (and returned without retrying) for this long.
const NEGATIVE_TTL: u64 = 3;
/// See `State::resolved_at`.
pub const MIN_REFRESH_INTERVAL: u64 = 60;

impl<V: Expiring> CredentialCache<V> {
    pub const fn new(refresh_window: u64) -> Self {
        Self {
            state: Guarded::new(State {
                cached: None,
                resolved_at: 0,
                last_error: None,
                used: false,
                stale: false,
            }),
            refresh_window,
        }
    }

    fn is_fresh(&self, st: &State<V>, v: &V, now: u64) -> bool {
        !st.stale
            && v.expiration().is_none_or(|e| {
                e > now + self.refresh_window
                    || (now < st.resolved_at + MIN_REFRESH_INTERVAL && e > now + EXPIRY_MARGIN)
            })
    }

    fn is_usable(v: &V, now: u64) -> bool {
        v.expiration().is_none_or(|e| e > now + EXPIRY_MARGIN)
    }

    /// How long from now until `v` should be refreshed in the background:
    /// when it enters the refresh window, or for a short-lived value halfway
    /// through what is left. `None` if it never expires.
    pub fn refresh_delay_ms(&self, v: &V) -> Option<u64> {
        let e = v.expiration()?;
        let now = now_secs();
        let secs = if e > now + self.refresh_window + MIN_REFRESH_INTERVAL {
            e - self.refresh_window - now
        } else {
            (e.saturating_sub(now + EXPIRY_MARGIN) / 2).max(1)
        };
        Some(secs.saturating_mul(1000))
    }

    /// The cached value's expiration and whether anyone read it since the
    /// last `settle` (resetting that flag).
    pub fn take_usage(&self) -> (Option<u64>, bool) {
        let mut st = self.state.lock();
        let used = core::mem::take(&mut st.used);
        (st.cached.as_ref().and_then(|v| v.expiration()), used)
    }

    /// The cached value if not yet expired, without counting as a use.
    pub fn peek(&self) -> Option<Arc<V>> {
        let st = self.state.lock();
        let now = now_secs();
        st.cached
            .as_ref()
            .filter(|v| Self::is_usable(v, now))
            .cloned()
    }

    /// Cached and outside the refresh window.
    pub fn fresh(&self) -> Option<Arc<V>> {
        let mut st = self.state.lock();
        let now = now_secs();
        let v = st
            .cached
            .as_ref()
            .filter(|v| self.is_fresh(&st, v, now))
            .cloned();
        st.used |= v.is_some();
        v
    }

    /// Cached and not yet expired (may be inside the refresh window) — good
    /// enough to sign with while a refresh is in flight.
    pub fn usable(&self) -> Option<Arc<V>> {
        let mut st = self.state.lock();
        let now = now_secs();
        let v = st
            .cached
            .as_ref()
            .filter(|v| Self::is_usable(v, now))
            .cloned();
        st.used |= v.is_some();
        v
    }

    /// A value is cached but has expired (as opposed to never resolved).
    pub fn has_expired_value(&self) -> bool {
        let st = self.state.lock();
        let now = now_secs();
        st.cached.as_ref().is_some_and(|v| !Self::is_usable(v, now))
    }

    /// The error of a resolution that failed less than `NEGATIVE_TTL` ago.
    pub fn recent_error(&self) -> Option<Arc<ProviderError>> {
        let st = self.state.lock();
        let now = now_secs();
        st.last_error
            .as_ref()
            .filter(|(_, at)| now < at + NEGATIVE_TTL)
            .map(|(e, _)| Arc::clone(e))
    }

    /// The last resolution's error, however old (cleared by a success).
    pub fn last_error(&self) -> Option<Arc<ProviderError>> {
        self.state
            .lock()
            .last_error
            .as_ref()
            .map(|(e, _)| Arc::clone(e))
    }

    /// `refresh: true`: keep serving the value to callers that cannot wait,
    /// but make everyone who can wait resolve anew.
    pub fn mark_stale(&self) {
        let mut st = self.state.lock();
        st.stale = true;
        st.last_error = None;
    }

    /// Record a finished resolution and return what callers should now get:
    /// the new value, or — if it failed but the old value has not actually
    /// expired — the old value.
    pub fn settle(&self, result: Result<V, ProviderError>) -> Result<Arc<V>, Arc<ProviderError>> {
        let mut st = self.state.lock();
        let now = now_secs();
        match result {
            Ok(v) => {
                let v = Arc::new(v);
                st.cached = Some(Arc::clone(&v));
                st.resolved_at = now;
                st.last_error = None;
                st.stale = false;
                Ok(v)
            }
            Err(e) => {
                let e = Arc::new(e);
                st.last_error = Some((Arc::clone(&e), now));
                // An explicit refresh that failed says so; a background one
                // keeps serving the old value while it lasts.
                let forced = core::mem::take(&mut st.stale);
                match &st.cached {
                    Some(v) if !forced && Self::is_usable(v, now) => Ok(Arc::clone(v)),
                    _ => Err(e),
                }
            }
        }
    }
}
