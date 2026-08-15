//! Caching, single-flight wrapper around `chain::resolve`, shared process-
//! wide per profile key, plus the JS-thread glue that runs a resolution on
//! the work pool and continues on the JS thread.

use std::sync::Arc;

use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::{JSGlobalObject, JsResult};
use bun_s3_signing::{
    AwsCredentials, CredentialsProvider, ProviderError, ProviderResult, SharedProvider,
};
use bun_threading::{Condvar, Guarded};

use super::chain;
use super::config::ChainConfig;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

struct State {
    cached: Option<Arc<AwsCredentials>>,
    resolving: bool,
    /// Result of the resolution that just finished, for waiters that joined
    /// it; cleared when the next one starts.
    last_error: Option<Arc<ProviderError>>,
}

/// The default chain for one profile key (`None` = whatever `AWS_PROFILE`
/// says at resolution time).
pub struct DefaultProvider {
    profile: Option<Box<[u8]>>,
    label: Box<[u8]>,
    state: Guarded<State>,
    cv: Condvar,
}

impl DefaultProvider {
    fn new(profile: Option<Box<[u8]>>) -> Self {
        Self {
            label: profile.clone().unwrap_or_else(|| Box::from(b"default".as_slice())),
            profile,
            state: Guarded::new(State {
                cached: None,
                resolving: false,
                last_error: None,
            }),
            cv: Condvar::new(),
        }
    }

    pub fn profile(&self) -> Option<&[u8]> {
        self.profile.as_deref()
    }

    /// Cached and outside the refresh window.
    pub fn cached_fresh(&self) -> Option<Arc<AwsCredentials>> {
        let st = self.state.lock();
        let now = now_secs();
        st.cached.as_ref().filter(|c| c.is_fresh_at(now)).cloned()
    }

    pub fn forget(&self) {
        let mut st = self.state.lock();
        st.cached = None;
        st.last_error = None;
    }

    /// Resolve with `cfg`, or join a resolution already in flight.
    pub fn resolve_with(&self, cfg: &ChainConfig) -> ProviderResult {
        let mut st = self.state.lock();
        let now = now_secs();
        if let Some(c) = &st.cached {
            if c.is_fresh_at(now) {
                return Ok(Arc::clone(c));
            }
        }
        if st.resolving {
            while st.resolving {
                self.cv.wait_guarded(&mut st);
            }
            return match (&st.cached, &st.last_error) {
                (Some(c), _) if c.expiration.is_none_or(|e| e > now + 5) => Ok(Arc::clone(c)),
                (_, Some(e)) => Err(Arc::clone(e)),
                _ => Err(Arc::new(ProviderError::new(
                    "ERR_AWS_MISSING_CREDENTIALS",
                    b"credential resolution was abandoned".to_vec(),
                ))),
            };
        }
        st.resolving = true;
        st.last_error = None;
        drop(st);

        let result = chain::resolve(cfg);

        let mut st = self.state.lock();
        st.resolving = false;
        let out = match result {
            Ok(c) => {
                let c = Arc::new(c);
                st.cached = Some(Arc::clone(&c));
                Ok(c)
            }
            Err(e) => {
                let e = Arc::new(e);
                st.last_error = Some(Arc::clone(&e));
                // Keep serving not-yet-expired credentials if a refresh fails.
                match &st.cached {
                    Some(c) if c.expiration.is_none_or(|exp| exp > now + 5) => Ok(Arc::clone(c)),
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

impl CredentialsProvider for DefaultProvider {
    /// Whatever is cached and not past expiry, even if inside the refresh
    /// window — requests keep being served while a refresh is in flight.
    fn cached(&self) -> Option<Arc<AwsCredentials>> {
        let st = self.state.lock();
        let now = now_secs();
        st.cached
            .as_ref()
            .filter(|c| c.expiration.is_none_or(|e| e > now + 5))
            .cloned()
    }

    fn needs_refresh(&self) -> bool {
        self.cached_fresh().is_none()
    }

    fn resolve_blocking(&self) -> ProviderResult {
        if let Some(c) = self.cached() {
            return Ok(c);
        }
        // Reached from the signer on a JS thread (sync `presign`, or a path
        // that did not pre-resolve): read that thread's env.
        if !bun_jsc::virtual_machine::VirtualMachine::is_loaded() {
            return Err(Arc::new(ProviderError::new(
                "ERR_AWS_MISSING_CREDENTIALS",
                b"AWS credentials are not resolved on this thread".to_vec(),
            )));
        }
        let vm = bun_jsc::virtual_machine::VirtualMachine::get();
        let cfg = ChainConfig::capture(vm.global(), self.profile());
        self.resolve_with(&cfg)
    }

    fn label(&self) -> &[u8] {
        &self.label
    }
}

// ── registry ──────────────────────────────────────────────────────────────

static REGISTRY: Guarded<Vec<Arc<DefaultProvider>>> = Guarded::new(Vec::new());

/// The shared provider for `profile` (`None` = default).
pub fn default_provider(profile: Option<&[u8]>) -> Arc<DefaultProvider> {
    let mut reg = REGISTRY.lock();
    if let Some(p) = reg.iter().find(|p| p.profile() == profile) {
        return Arc::clone(p);
    }
    let p = Arc::new(DefaultProvider::new(profile.map(Box::from)));
    reg.push(Arc::clone(&p));
    p
}

pub fn shared(profile: Option<&[u8]>) -> SharedProvider {
    default_provider(profile)
}

// ── async resolution (JS thread → work pool → JS thread) ──────────────────

/// What to do with the credentials once they arrive (JS thread). Always
/// called exactly once — with a cancellation error if the VM is going away —
/// so whatever it owns (promises, request contexts) is released.
pub type Continuation = Box<dyn FnOnce(ProviderResult) -> JsResult<()>>;

struct JsSide(Option<Continuation>);
// SAFETY: created, called and dropped on the owning JS thread only (Job contract).
unsafe impl JsAffine for JsSide {}
impl Drop for JsSide {
    fn drop(&mut self) {
        if let Some(f) = self.0.take() {
            let _ = f(Err(Arc::new(ProviderError::new(
                "ERR_AWS_MISSING_CREDENTIALS",
                b"credential resolution was cancelled because the VM is shutting down".to_vec(),
            ))));
        }
    }
}

struct Off {
    provider: Arc<DefaultProvider>,
    cfg: ChainConfig,
    result: Option<ProviderResult>,
}
// SAFETY: `ChainConfig` is plain owned data; `EnvMap` is `HashMap<String,String>`.
unsafe impl Send for Off {}

struct ResolveJob;

impl JobContext for ResolveJob {
    type OffThread = Off;
    type Js = JsSide;

    fn run(off: &mut Off, done: Completion<Self>) -> Option<Completion<Self>> {
        off.result = Some(off.provider.resolve_with(&off.cfg));
        Some(done)
    }

    fn then(off: Off, mut js: JsSide, _cx: &JsThread<'_>) -> JsResult<()> {
        let result = off.result.unwrap_or_else(|| {
            Err(Arc::new(ProviderError::new(
                "ERR_AWS_MISSING_CREDENTIALS",
                b"credential resolution was cancelled".to_vec(),
            )))
        });
        match js.0.take() {
            Some(f) => f(result),
            None => Ok(()),
        }
    }
}

/// Resolve `provider` without blocking the JS thread. If fresh credentials
/// are cached `then` runs synchronously, otherwise after the work-pool
/// resolution completes. `then` always runs on `global`'s thread.
pub fn resolve_async(
    global: &JSGlobalObject,
    provider: &Arc<DefaultProvider>,
    then: Continuation,
) -> JsResult<()> {
    if let Some(c) = provider.cached_fresh() {
        return then(Ok(c));
    }
    let cx = global.js_thread();
    let cfg = ChainConfig::capture(global, provider.profile());
    Job::<ResolveJob>::schedule(
        &cx,
        Off {
            provider: Arc::clone(provider),
            cfg,
            result: None,
        },
        JsSide(Some(then)),
    );
    Ok(())
}

/// Like [`resolve_async`] but for any `SharedProvider`; non-default
/// providers resolve inline (they have no off-thread half yet).
pub fn resolve_shared_async(
    global: &JSGlobalObject,
    provider: &SharedProvider,
    then: Continuation,
) -> JsResult<()> {
    if let Some(default) = as_default(provider) {
        return resolve_async(global, &default, then);
    }
    then(provider.resolve_blocking())
}

/// Downcast helper: every `SharedProvider` we hand out today is a
/// `DefaultProvider` from the registry, so match by identity.
pub fn as_default(provider: &SharedProvider) -> Option<Arc<DefaultProvider>> {
    let reg = REGISTRY.lock();
    let target = Arc::as_ptr(provider).cast::<()>() as usize;
    reg.iter()
        .find(|p| Arc::as_ptr(p).cast::<()>() as usize == target)
        .cloned()
}
