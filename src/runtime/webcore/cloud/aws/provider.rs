//! The cached AWS credential provider for one profile key; resolution,
//! waiting and background refresh are `cloud::flight`'s.

use std::sync::Arc;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsResult};
use bun_s3_signing::{AwsCredentials, CredentialsProvider, ProviderError, SharedProvider};

use super::chain;
use super::config::ChainConfig;
use crate::webcore::cloud::cache::CredentialCache;
use crate::webcore::cloud::flight::{self, Flights, Provider};
use crate::webcore::cloud::io::{ChainFuture, Io};

/// The default chain for one profile key (`None` = whatever `AWS_PROFILE`
/// says at resolution time).
pub struct DefaultProvider {
    profile: Option<Box<[u8]>>,
    label: Box<[u8]>,
    cache: CredentialCache<AwsCredentials>,
}

impl DefaultProvider {
    pub fn profile(&self) -> Option<&[u8]> {
        self.profile.as_deref()
    }

    pub fn mark_stale(&self) {
        self.cache.mark_stale()
    }

    /// The message for a synchronous API that finds these credentials
    /// neither cached nor obtainable without waiting.
    pub fn pending_message(&self) -> Vec<u8> {
        let label = bstr::BStr::new(&self.label);
        let how = if self.profile.is_none() {
            "Bun.aws.credentials()".to_string()
        } else {
            format!("new Bun.AWSClient({{ profile: {label:?} }}).credentials()")
        };
        if self.cache.has_expired_value() {
            format!(
                "AWS credentials for profile \"{label}\" have expired and their replacement has not arrived yet in this synchronous call; `await {how}` (or any asynchronous S3 operation) first"
            )
        } else {
            format!(
                "AWS credentials for profile \"{label}\" come from a source that needs a network round-trip (SSO, STS, a container endpoint or instance metadata) and have not been resolved yet in this synchronous call; `await {how}` (or any asynchronous S3 operation) first, or pass accessKeyId and secretAccessKey"
            )
        }
        .into_bytes()
    }
}

impl Provider for DefaultProvider {
    type Value = AwsCredentials;

    fn cache(&self) -> &CredentialCache<AwsCredentials> {
        &self.cache
    }

    fn begin(&self, global: &JSGlobalObject, io: Io) -> ChainFuture<chain::ChainResult> {
        chain::resolve(ChainConfig::capture(global, self.profile()), io)
    }

    fn flights() -> &'static mut Flights<Self> {
        &mut crate::webcore::cloud::PerVm::get(VirtualMachine::get()).aws
    }

    fn interrupted() -> ProviderError {
        ProviderError::new(
            "ERR_AWS_CREDENTIALS",
            b"credential resolution was interrupted because the JavaScript VM is shutting down"
                .to_vec(),
        )
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
        if VirtualMachine::is_loaded()
            && let Some(this) =
                DefaultProvider::flights().by_address(std::ptr::from_ref(self).cast())
        {
            flight::keep_warm(VirtualMachine::get().global(), &this);
        }
        false
    }

    fn label(&self) -> &[u8] {
        &self.label
    }
}

/// The shared provider for `profile` (`None` = default) in this VM (a
/// Worker with its own env gets its own).
pub fn default_provider(profile: Option<&[u8]>) -> Arc<DefaultProvider> {
    let flights = DefaultProvider::flights();
    if let Some(p) = flights.find(|p| p.profile() == profile) {
        return p;
    }
    let profile: Option<Box<[u8]>> = profile.map(Box::from);
    flights.insert(DefaultProvider {
        label: profile
            .clone()
            .unwrap_or_else(|| Box::from(b"default".as_slice())),
        profile,
        cache: CredentialCache::new(AwsCredentials::REFRESH_WINDOW_SECONDS),
    })
}

/// `S3Credentials` holds a type-erased `SharedProvider`; every one of those
/// is a `DefaultProvider` from this VM's registry, so recover it by identity.
pub fn as_default(provider: &SharedProvider) -> Option<Arc<DefaultProvider>> {
    DefaultProvider::flights().by_address(Arc::as_ptr(provider).cast())
}

/// [`flight::resolve_async`] for the type-erased handle `S3Credentials` carries.
pub fn resolve_shared_async(
    global: &JSGlobalObject,
    provider: &SharedProvider,
    then: flight::Continuation<AwsCredentials>,
) -> JsResult<()> {
    match as_default(provider) {
        Some(p) => flight::resolve_async(global, &p, then),
        None => then(provider.cached().ok_or_else(|| {
            Arc::new(ProviderError::new(
                "ERR_AWS_MISSING_CREDENTIALS",
                b"credentials provider is not registered with this JavaScript VM".to_vec(),
            ))
        })),
    }
}
