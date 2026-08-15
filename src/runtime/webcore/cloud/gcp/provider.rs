//! Per-JS-thread cache of Google tokens keyed by what was asked for (scopes
//! / audience), resolved on the work pool with JS-side waiter fan-out.

use std::sync::Arc;

use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::{JSGlobalObject, JsResult};
use bun_s3_signing::ProviderError;

use super::chain::{self, GcpConfig, Token, TokenRequest};
use crate::webcore::cloud::cache::SingleFlightCache;

/// Google access tokens live an hour; refresh a little ahead like the AWS side.
const REFRESH_WINDOW_SECONDS: u64 = 240;

pub struct TokenProvider {
    request: TokenRequest,
    cache: SingleFlightCache<Token>,
}

pub type TokenResult = Result<Arc<Token>, Arc<ProviderError>>;

impl TokenProvider {
    pub fn request(&self) -> &TokenRequest {
        &self.request
    }

    pub fn cached_fresh(&self) -> Option<Arc<Token>> {
        self.cache.fresh()
    }

    pub fn cached_usable(&self) -> Option<Arc<Token>> {
        self.cache.usable()
    }

    pub fn forget(&self) {
        self.cache.forget()
    }

    pub fn resolve_with(&self, cfg: &GcpConfig) -> TokenResult {
        self.cache
            .get_or_resolve(|| chain::resolve(cfg, &self.request))
    }

    /// Usable now; if it is inside the refresh window a background refresh
    /// is started so later requests do not have to wait.
    pub fn usable_refreshing_ahead(
        self: &Arc<Self>,
        global: &JSGlobalObject,
    ) -> Option<Arc<Token>> {
        let t = self.cache.usable()?;
        if self.cache.fresh().is_none() {
            start(global, self, None);
        }
        Some(t)
    }

    fn key(&self) -> usize {
        std::ptr::from_ref(self) as usize
    }
}

/// This VM's token providers and in-flight resolutions.
#[derive(Default)]
pub(crate) struct State {
    registry: Vec<Arc<TokenProvider>>,
    pending: Vec<Pending>,
}

fn state() -> &'static mut State {
    &mut crate::webcore::cloud::PerVm::get(bun_jsc::virtual_machine::VirtualMachine::get()).gcp
}

struct Pending {
    key: usize,
    waiters: Vec<Continuation>,
}

pub fn provider_for(request: TokenRequest) -> Arc<TokenProvider> {
    let reg = &mut state().registry;
    if let Some(p) = reg.iter().find(|p| p.request == request) {
        return Arc::clone(p);
    }
    let p = Arc::new(TokenProvider {
        request,
        cache: SingleFlightCache::new(REFRESH_WINDOW_SECONDS),
    });
    reg.push(Arc::clone(&p));
    p
}

// ── async resolution ──────────────────────────────────────────────────────

pub type Continuation = Box<dyn FnOnce(TokenResult) -> JsResult<()>>;

fn cancelled() -> Arc<ProviderError> {
    Arc::new(ProviderError::new(
        "ERR_GCP_MISSING_CREDENTIALS",
        b"token resolution was cancelled because the VM is shutting down".to_vec(),
    ))
}

fn take_waiters(key: usize) -> Vec<Continuation> {
    let p = &mut state().pending;
    match p.iter().position(|e| e.key == key) {
        Some(i) => p.swap_remove(i).waiters,
        None => Vec::new(),
    }
}

fn run_waiters(waiters: Vec<Continuation>, result: &TokenResult) -> JsResult<()> {
    let mut first_err = Ok(());
    for w in waiters {
        let r = w(result.clone());
        if first_err.is_ok() {
            first_err = r;
        }
    }
    first_err
}

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
    provider: Arc<TokenProvider>,
    cfg: GcpConfig,
    result: Option<TokenResult>,
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
            .name("gcp-credentials".into())
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

/// Register `then` (if any) as a waiter and schedule the job unless one is
/// already in flight for this provider on this thread.
fn start(global: &JSGlobalObject, provider: &Arc<TokenProvider>, then: Option<Continuation>) {
    let key = provider.key();
    let first = {
        let p = &mut state().pending;
        match p.iter_mut().find(|e| e.key == key) {
            Some(entry) => {
                entry.waiters.extend(then);
                false
            }
            None => {
                p.push(Pending {
                    key,
                    waiters: then.into_iter().collect(),
                });
                true
            }
        }
    };
    if first {
        let cx = global.js_thread();
        Job::<ResolveJob>::schedule(
            &cx,
            Off {
                provider: Arc::clone(provider),
                cfg: GcpConfig::capture(global),
                result: None,
            },
            JsSide { key, live: true },
        );
    }
}

pub fn resolve_async(
    global: &JSGlobalObject,
    provider: &Arc<TokenProvider>,
    then: Continuation,
) -> JsResult<()> {
    if let Some(t) = provider.cached_fresh() {
        return then(Ok(t));
    }
    start(global, provider, Some(then));
    Ok(())
}
