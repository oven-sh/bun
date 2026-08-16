//! The cached Google token provider for one (request, source) pair;
//! resolution, waiting and background refresh are `cloud::flight`'s.

use std::sync::Arc;

use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_s3_signing::ProviderError;

use super::chain::{self, CredentialSource, GcpConfig, Token, TokenRequest};
use crate::webcore::cloud::cache::CredentialCache;
use crate::webcore::cloud::flight::{self, Flights, Provider};
use crate::webcore::cloud::io::{ChainFuture, Io};

/// Google access tokens live an hour; refresh a little ahead like the AWS side.
const REFRESH_WINDOW_SECONDS: u64 = 240;

pub struct TokenProvider {
    request: TokenRequest,
    source: CredentialSource,
    cache: CredentialCache<Token>,
}

impl TokenProvider {
    pub fn request(&self) -> &TokenRequest {
        &self.request
    }

    pub fn cached_usable(&self) -> Option<Arc<Token>> {
        self.cache.usable()
    }

    pub fn mark_stale(&self) {
        self.cache.mark_stale()
    }

    /// Usable now, keeping the background refresh going.
    pub fn usable_kept_warm(self: &Arc<Self>, global: &JSGlobalObject) -> Option<Arc<Token>> {
        let t = self.cache.usable()?;
        flight::keep_warm(global, self);
        Some(t)
    }
}

impl Provider for TokenProvider {
    type Value = Token;

    fn cache(&self) -> &CredentialCache<Token> {
        &self.cache
    }

    fn begin(&self, global: &JSGlobalObject, io: Io) -> ChainFuture<Result<Token, ProviderError>> {
        chain::resolve(
            GcpConfig::capture(global, &self.source),
            self.request.clone(),
            io,
        )
    }

    fn flights() -> &'static mut Flights<Self> {
        &mut crate::webcore::cloud::PerVm::get(VirtualMachine::get()).gcp
    }

    fn interrupted() -> ProviderError {
        ProviderError::new(
            "ERR_GCP_CREDENTIALS",
            b"token resolution was interrupted because the JavaScript VM is shutting down".to_vec(),
        )
    }
}

pub fn provider_for(request: TokenRequest, source: &CredentialSource) -> Arc<TokenProvider> {
    let flights = TokenProvider::flights();
    if let Some(p) = flights.find(|p| p.request == request && p.source == *source) {
        return p;
    }
    flights.insert(TokenProvider {
        request,
        source: source.clone(),
        cache: CredentialCache::new(REFRESH_WINDOW_SECONDS),
    })
}
