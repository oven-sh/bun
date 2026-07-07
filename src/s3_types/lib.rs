//! Plain-data S3 types shared between the env loader (`bun_dotenv`) and the
//! signer (`bun_s3_signing`), so neither needs an upward dependency.

/// Value fields of an S3 credential set. `bun_dotenv` produces this from the
/// environment; `bun_s3_signing::S3Credentials` is built from it via `From`.
#[derive(Clone, Default)]
pub struct S3CredentialsValue {
    pub access_key_id: Box<[u8]>,
    pub secret_access_key: Box<[u8]>,
    pub region: Box<[u8]>,
    pub endpoint: Box<[u8]>,
    pub bucket: Box<[u8]>,
    pub session_token: Box<[u8]>,
    /// Important for MinIO support.
    pub insecure_http: bool,
}
