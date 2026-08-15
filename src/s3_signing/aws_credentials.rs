//! Resolved AWS credentials and the provider hook `S3Credentials` falls back
//! to when it has no static keys. The provider *implementation* (the default
//! chain: env → profile/SSO/process/web-identity → container → IMDS) lives in
//! `bun_runtime::webcore::aws`; this crate only names the interface.

use std::sync::Arc;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CredentialsSource {
    Explicit,
    Env,
    Profile,
    AssumeRole,
    WebIdentity,
    Process,
    Sso,
    Container,
    Imds,
    Function,
}

impl CredentialsSource {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Env => "env",
            Self::Profile => "profile",
            Self::AssumeRole => "assume-role",
            Self::WebIdentity => "web-identity",
            Self::Process => "process",
            Self::Sso => "sso",
            Self::Container => "container",
            Self::Imds => "imds",
            Self::Function => "function",
        }
    }
}

pub struct AwsCredentials {
    pub access_key_id: Box<[u8]>,
    pub secret_access_key: Box<[u8]>,
    /// Empty when the credentials are long-lived.
    pub session_token: Box<[u8]>,
    /// Unix epoch seconds; `None` for non-expiring credentials.
    pub expiration: Option<u64>,
    pub account_id: Option<Box<[u8]>>,
    /// Region configured alongside the credentials (profile `region`), used
    /// when the caller did not set one.
    pub region: Option<Box<[u8]>>,
    pub source: CredentialsSource,
}

impl AwsCredentials {
    /// Credentials are refreshed this long before they expire.
    pub const REFRESH_WINDOW_SECONDS: u64 = 300;

    pub fn session_token(&self) -> Option<&[u8]> {
        if self.session_token.is_empty() {
            None
        } else {
            Some(&self.session_token)
        }
    }

    pub fn is_fresh_at(&self, now_epoch_secs: u64) -> bool {
        match self.expiration {
            None => true,
            Some(exp) => exp > now_epoch_secs + Self::REFRESH_WINDOW_SECONDS,
        }
    }

    pub fn sigv4(&self) -> crate::sigv4::Credentials<'_> {
        crate::sigv4::Credentials {
            access_key_id: &self.access_key_id,
            secret_access_key: &self.secret_access_key,
            session_token: self.session_token(),
        }
    }
}

impl Drop for AwsCredentials {
    fn drop(&mut self) {
        // SAFETY: exclusively borrowed boxed slices; `len` bytes writable.
        unsafe {
            bun_core::secure_zero(
                self.secret_access_key.as_mut_ptr(),
                self.secret_access_key.len(),
            );
            bun_core::secure_zero(self.session_token.as_mut_ptr(), self.session_token.len());
        }
    }
}

impl core::fmt::Debug for AwsCredentials {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("AwsCredentials")
            .field("access_key_id", &bstr::BStr::new(&self.access_key_id))
            .field("source", &self.source)
            .field("expiration", &self.expiration)
            .finish_non_exhaustive()
    }
}

/// Why credential resolution failed. `message` is user-facing.
#[derive(Debug)]
pub struct ProviderError {
    pub code: &'static str,
    pub message: Box<[u8]>,
}

impl ProviderError {
    pub fn new(code: &'static str, message: impl Into<Vec<u8>>) -> Self {
        Self {
            code,
            message: message.into().into_boxed_slice(),
        }
    }
}

pub type ProviderResult = Result<Arc<AwsCredentials>, Arc<ProviderError>>;

/// A source of credentials that may need I/O to produce them.
pub trait CredentialsProvider: Send + Sync {
    /// Non-blocking: cached credentials that have not expired (they may be
    /// inside the refresh window).
    fn cached(&self) -> Option<Arc<AwsCredentials>>;

    /// Nothing usable is cached, or what is cached is inside the refresh
    /// window. Asynchronous callers resolve ahead of signing when this is set.
    fn needs_refresh(&self) -> bool;

    /// Resolve, doing whatever I/O is needed on the calling thread. Returns
    /// cached credentials without I/O when they are still usable. Used by
    /// synchronous entry points (`presign`) and as the signer's fallback.
    fn resolve_blocking(&self) -> ProviderResult;

    /// A stable label for `console.log` / errors (e.g. `default`, a profile
    /// name, or `function`).
    fn label(&self) -> &[u8];
}

pub type SharedProvider = Arc<dyn CredentialsProvider>;
