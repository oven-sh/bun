//! Process-wide cache of Google tokens keyed by what was asked for (scopes /
//! audience), resolved on the work pool.

use std::sync::Arc;

use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::{JSGlobalObject, JsResult};
use bun_s3_signing::ProviderError;
use bun_threading::Guarded;

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
}

static REGISTRY: Guarded<Vec<Arc<TokenProvider>>> = Guarded::new(Vec::new());

pub fn provider_for(request: TokenRequest) -> Arc<TokenProvider> {
    let mut reg = REGISTRY.lock();
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

struct JsSide(Option<Continuation>);
// SAFETY: created, called and dropped on the owning JS thread only (Job contract).
unsafe impl JsAffine for JsSide {}
impl Drop for JsSide {
    fn drop(&mut self) {
        if let Some(f) = self.0.take() {
            let _ = f(Err(Arc::new(ProviderError::new(
                "ERR_GCP_MISSING_CREDENTIALS",
                b"token resolution was cancelled because the VM is shutting down".to_vec(),
            ))));
        }
    }
}

struct Off {
    provider: Arc<TokenProvider>,
    cfg: GcpConfig,
    result: Option<TokenResult>,
}
// SAFETY: plain owned data.
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
                "ERR_GCP_MISSING_CREDENTIALS",
                b"token resolution was cancelled".to_vec(),
            )))
        });
        match js.0.take() {
            Some(f) => f(result),
            None => Ok(()),
        }
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
    let cx = global.js_thread();
    let cfg = GcpConfig::capture(global);
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
