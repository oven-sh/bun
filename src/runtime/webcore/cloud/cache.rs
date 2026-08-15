//! A thread-safe, single-flight cache for one expiring credential: the first
//! caller that finds it stale resolves it; concurrent callers wait for that
//! resolution instead of starting their own.

use std::sync::Arc;

use bun_s3_signing::ProviderError;
use bun_threading::{Condvar, Guarded};

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
    resolving: bool,
    /// Outcome of the resolution that just finished, for callers that joined it.
    last_error: Option<Arc<ProviderError>>,
}

pub struct SingleFlightCache<V> {
    state: Guarded<State<V>>,
    cv: Condvar,
    /// Refresh this many seconds before expiry.
    refresh_window: u64,
}

/// Credentials this close to expiry are treated as expired (clock skew /
/// request latency margin).
const EXPIRY_MARGIN: u64 = 5;

impl<V: Expiring> SingleFlightCache<V> {
    pub const fn new(refresh_window: u64) -> Self {
        Self {
            state: Guarded::new(State {
                cached: None,
                resolving: false,
                last_error: None,
            }),
            cv: Condvar::new(),
            refresh_window,
        }
    }

    fn is_fresh(&self, v: &V, now: u64) -> bool {
        v.expiration().is_none_or(|e| e > now + self.refresh_window)
    }

    fn is_usable(v: &V, now: u64) -> bool {
        v.expiration().is_none_or(|e| e > now + EXPIRY_MARGIN)
    }

    /// Cached and outside the refresh window.
    pub fn fresh(&self) -> Option<Arc<V>> {
        let st = self.state.lock();
        let now = now_secs();
        st.cached
            .as_ref()
            .filter(|v| self.is_fresh(v, now))
            .cloned()
    }

    /// Cached and not yet expired (may be inside the refresh window) — good
    /// enough to sign with while a refresh is in flight.
    pub fn usable(&self) -> Option<Arc<V>> {
        let st = self.state.lock();
        let now = now_secs();
        st.cached
            .as_ref()
            .filter(|v| Self::is_usable(v, now))
            .cloned()
    }

    pub fn forget(&self) {
        let mut st = self.state.lock();
        st.cached = None;
        st.last_error = None;
    }

    /// Return the fresh cached value, or run `resolve` (or join a resolution
    /// already in flight) and cache its result. If a refresh fails but the old
    /// value has not actually expired yet, the old value is returned.
    pub fn get_or_resolve(
        &self,
        resolve: impl FnOnce() -> Result<V, ProviderError>,
    ) -> Result<Arc<V>, Arc<ProviderError>> {
        let mut st = self.state.lock();
        let now = now_secs();
        if let Some(v) = st.cached.as_ref().filter(|v| self.is_fresh(v, now)) {
            return Ok(Arc::clone(v));
        }
        if st.resolving {
            while st.resolving {
                self.cv.wait_guarded(&mut st);
            }
            return match (&st.cached, &st.last_error) {
                (Some(v), _) if Self::is_usable(v, now) => Ok(Arc::clone(v)),
                (_, Some(e)) => Err(Arc::clone(e)),
                _ => Err(Arc::new(ProviderError::new(
                    "ERR_CREDENTIALS_UNAVAILABLE",
                    b"credential resolution was abandoned".to_vec(),
                ))),
            };
        }
        st.resolving = true;
        st.last_error = None;
        drop(st);

        let result = resolve();

        let mut st = self.state.lock();
        st.resolving = false;
        let out = match result {
            Ok(v) => {
                let v = Arc::new(v);
                st.cached = Some(Arc::clone(&v));
                Ok(v)
            }
            Err(e) => {
                let e = Arc::new(e);
                st.last_error = Some(Arc::clone(&e));
                match &st.cached {
                    Some(v) if Self::is_usable(v, now) => Ok(Arc::clone(v)),
                    _ => {
                        st.cached = None;
                        Err(e)
                    }
                }
            }
        };
        drop(st);
        self.cv.notify_all();
        out
    }
}
