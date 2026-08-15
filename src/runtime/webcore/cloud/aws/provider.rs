//! Caching, single-flight wrapper around `chain::resolve`, shared per JS
//! thread and profile key, plus the glue that runs a resolution on the work
//! pool and fans the result out to every waiter on the JS thread.

use core::cell::RefCell;
use std::sync::Arc;

use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsResult};
use bun_s3_signing::{
    AwsCredentials, CredentialsProvider, ProviderError, ProviderResult, SharedProvider,
};

use super::chain;
use super::config::ChainConfig;
use crate::webcore::cloud::cache::SingleFlightCache;

/// The default chain for one profile key (`None` = whatever `AWS_PROFILE`
/// says at resolution time).
pub struct DefaultProvider {
    profile: Option<Box<[u8]>>,
    label: Box<[u8]>,
    cache: SingleFlightCache<AwsCredentials>,
}

impl DefaultProvider {
    fn new(profile: Option<Box<[u8]>>) -> Self {
        Self {
            label: profile
                .clone()
                .unwrap_or_else(|| Box::from(b"default".as_slice())),
            profile,
            cache: SingleFlightCache::new(AwsCredentials::REFRESH_WINDOW_SECONDS),
        }
    }

    pub fn profile(&self) -> Option<&[u8]> {
        self.profile.as_deref()
    }

    /// Cached and outside the refresh window.
    pub fn cached_fresh(&self) -> Option<Arc<AwsCredentials>> {
        self.cache.fresh()
    }

    pub fn forget(&self) {
        self.cache.forget()
    }

    /// Resolve with `cfg`, or join a resolution already in flight.
    pub fn resolve_with(&self, cfg: &ChainConfig) -> ProviderResult {
        self.cache.get_or_resolve(|| chain::resolve(cfg))
    }

    fn key(&self) -> usize {
        std::ptr::from_ref(self) as usize
    }
}

impl CredentialsProvider for DefaultProvider {
    /// Whatever is cached and not past expiry, even if inside the refresh
    /// window — requests keep being served while a refresh is in flight.
    fn cached(&self) -> Option<Arc<AwsCredentials>> {
        self.cache.usable()
    }

    fn needs_resolution(&self) -> bool {
        if self.cache.usable().is_none() {
            return true;
        }
        if self.cache.fresh().is_none() && VirtualMachine::is_loaded() {
            // Usable but inside the refresh window: keep signing with what we
            // have and refresh in the background (once).
            refresh_ahead(VirtualMachine::get().global(), self);
        }
        false
    }

    fn resolve_blocking(&self) -> ProviderResult {
        if let Some(c) = self.cached() {
            return Ok(c);
        }
        // Reached from the signer on a JS thread (sync `presign`, or a path
        // that did not pre-resolve): read that thread's env.
        if !VirtualMachine::is_loaded() {
            return Err(Arc::new(ProviderError::new(
                "ERR_AWS_MISSING_CREDENTIALS",
                b"AWS credentials are not resolved on this thread".to_vec(),
            )));
        }
        let cfg = ChainConfig::capture(VirtualMachine::get().global(), self.profile());
        self.resolve_with(&cfg)
    }

    fn label(&self) -> &[u8] {
        &self.label
    }
}

// ── registry (per JS thread: a Worker with its own env gets its own) ──────

thread_local! {
    static REGISTRY: RefCell<Vec<Arc<DefaultProvider>>> = const { RefCell::new(Vec::new()) };
    /// Resolutions in flight from this thread, and who is waiting on each.
    static PENDING: RefCell<Vec<Pending>> = const { RefCell::new(Vec::new()) };
}

struct Pending {
    key: usize,
    waiters: Vec<Continuation>,
}

/// The shared provider for `profile` (`None` = default) on this thread.
pub fn default_provider(profile: Option<&[u8]>) -> Arc<DefaultProvider> {
    REGISTRY.with_borrow_mut(|reg| {
        if let Some(p) = reg.iter().find(|p| p.profile() == profile) {
            return Arc::clone(p);
        }
        let p = Arc::new(DefaultProvider::new(profile.map(Box::from)));
        reg.push(Arc::clone(&p));
        p
    })
}

pub fn shared(profile: Option<&[u8]>) -> SharedProvider {
    default_provider(profile)
}

/// Downcast helper: every `SharedProvider` we hand out is a
/// `DefaultProvider` from this thread's registry, so match by identity.
pub fn as_default(provider: &SharedProvider) -> Option<Arc<DefaultProvider>> {
    let target = Arc::as_ptr(provider).cast::<()>() as usize;
    REGISTRY.with_borrow(|reg| {
        reg.iter()
            .find(|p| Arc::as_ptr(p).cast::<()>() as usize == target)
            .cloned()
    })
}

// ── async resolution (JS thread → work pool → JS thread) ──────────────────

/// What to do with the credentials once they arrive (JS thread). Always
/// called exactly once — with a cancellation error if the VM is going away —
/// so whatever it owns (promises, request contexts) is released.
pub type Continuation = Box<dyn FnOnce(ProviderResult) -> JsResult<()>>;

fn cancelled() -> Arc<ProviderError> {
    Arc::new(ProviderError::new(
        "ERR_AWS_MISSING_CREDENTIALS",
        b"credential resolution was cancelled because the VM is shutting down".to_vec(),
    ))
}

fn take_waiters(key: usize) -> Vec<Continuation> {
    PENDING.with_borrow_mut(|p| match p.iter().position(|e| e.key == key) {
        Some(i) => p.swap_remove(i).waiters,
        None => Vec::new(),
    })
}

fn run_waiters(waiters: Vec<Continuation>, result: &ProviderResult) -> JsResult<()> {
    let mut first_err = Ok(());
    for w in waiters {
        let r = w(result.clone());
        if first_err.is_ok() {
            first_err = r;
        }
    }
    first_err
}

/// The JS-thread half of a resolution job: just the key to find its waiters.
struct JsSide {
    key: usize,
    live: bool,
}
// SAFETY: created, used and dropped on the owning JS thread only (Job contract).
unsafe impl JsAffine for JsSide {}
impl Drop for JsSide {
    fn drop(&mut self) {
        if self.live {
            let _ = run_waiters(take_waiters(self.key), &Err(cancelled()));
        }
    }
}

struct Off {
    provider: Arc<DefaultProvider>,
    cfg: ChainConfig,
    result: Option<ProviderResult>,
}

struct ResolveJob;

impl JobContext for ResolveJob {
    type OffThread = Off;
    type Js = JsSide;

    const CANCELLABLE: bool = true;

    /// VM teardown: make in-flight credential HTTP waits give up promptly.
    unsafe fn cancel(off: *mut Off) {
        // SAFETY: `off` is live (fn contract); only the atomic is touched,
        // concurrently with the resolver thread reading it.
        unsafe {
            (*off)
                .cfg
                .cancel
                .store(true, core::sync::atomic::Ordering::Relaxed)
        };
    }

    fn run(off: &mut Off, done: Completion<Self>) -> Option<Completion<Self>> {
        // Resolution blocks on network round-trips whose DNS lookups are
        // themselves serviced by the work pool, so wait on a short-lived
        // thread of our own instead of parking a pool worker. The Completion
        // (and with it the job's Ticket) travels with the work.
        let slot = Arc::new(bun_threading::Guarded::new(Some(done)));
        let for_thread = Arc::clone(&slot);
        let spawned = std::thread::Builder::new()
            .name("aws-credentials".into())
            .spawn(move || {
                // Stdio + WTF stack bounds for this thread (the parsers' stack checks need them).
                bun_core::output::Source::configure_thread();
                let Some(done) = for_thread.lock().take() else {
                    return;
                };
                // SAFETY: the pool callback has returned by the time this
                // runs far enough to matter, and nothing else touches the
                // off-thread half until `finish` posts it back.
                let off = unsafe { &mut *done.off_thread() };
                off.result = Some(off.provider.resolve_with(&off.cfg));
                done.finish();
            });
        match spawned {
            Ok(_) => None,
            Err(_) => {
                let done = slot.lock().take()?;
                off.result = Some(off.provider.resolve_with(&off.cfg));
                Some(done)
            }
        }
    }

    fn then(off: Off, mut js: JsSide, _cx: &JsThread<'_>) -> JsResult<()> {
        js.live = false;
        let result = off.result.unwrap_or_else(|| Err(cancelled()));
        run_waiters(take_waiters(js.key), &result)
    }
}

fn schedule(global: &JSGlobalObject, provider: Arc<DefaultProvider>, key: usize) {
    let cx = global.js_thread();
    let cfg = ChainConfig::capture(global, provider.profile());
    Job::<ResolveJob>::schedule(
        &cx,
        Off {
            provider,
            cfg,
            result: None,
        },
        JsSide { key, live: true },
    );
}

/// Resolve `provider` without blocking the JS thread. If fresh credentials
/// are cached `then` runs synchronously; otherwise it runs once the (single,
/// shared) work-pool resolution for this provider completes. `then` always
/// runs on `global`'s thread.
pub fn resolve_async(
    global: &JSGlobalObject,
    provider: &Arc<DefaultProvider>,
    then: Continuation,
) -> JsResult<()> {
    if let Some(c) = provider.cache.fresh() {
        return then(Ok(c));
    }
    let key = provider.key();
    let first = PENDING.with_borrow_mut(|p| match p.iter_mut().find(|e| e.key == key) {
        Some(entry) => {
            entry.waiters.push(then);
            false
        }
        None => {
            p.push(Pending {
                key,
                waiters: vec![then],
            });
            true
        }
    });
    if first {
        schedule(global, Arc::clone(provider), key);
    }
    Ok(())
}

/// Start a background refresh for stale-but-usable credentials if one is
/// not already running from this thread.
fn refresh_ahead(global: &JSGlobalObject, provider: &DefaultProvider) {
    let key = provider.key();
    let Some(provider) = REGISTRY.with_borrow(|reg| reg.iter().find(|p| p.key() == key).cloned())
    else {
        return;
    };
    let first = PENDING.with_borrow_mut(|p| {
        if p.iter().any(|e| e.key == key) {
            false
        } else {
            p.push(Pending {
                key,
                waiters: Vec::new(),
            });
            true
        }
    });
    if first {
        schedule(global, provider, key);
    }
}

/// Like [`resolve_async`] but for any `SharedProvider`; non-default
/// providers resolve inline (they have no off-thread half).
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
