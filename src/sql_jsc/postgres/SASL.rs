use bun_base64;

use bun_sha_hmac::hmac::EVP_MAX_MD_SIZE;

const NONCE_BYTE_LEN: usize = 18;
const NONCE_BASE64_LEN: usize = bun_base64::encode_len_from_size(NONCE_BYTE_LEN);

const SERVER_SIGNATURE_BYTE_LEN: usize = 32;
const SERVER_SIGNATURE_BASE64_LEN: usize =
    bun_base64::encode_len_from_size(SERVER_SIGNATURE_BYTE_LEN);

const SALTED_PASSWORD_BYTE_LEN: usize = 32;

/// RFC 5802 §7 GS2 channel binding flag of the client-first-message.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ChannelBindingFlag {
    /// `n,,`
    NotSupported,
    /// `y,,`: supported by the client, not offered by the server.
    SupportedNotOffered,
    /// `p=tls-server-end-point,,`
    TlsServerEndPoint,
}

impl ChannelBindingFlag {
    pub(crate) fn gs2_header(self) -> &'static [u8] {
        match self {
            Self::NotSupported => b"n,,",
            Self::SupportedNotOffered => b"y,,",
            Self::TlsServerEndPoint => b"p=tls-server-end-point,,",
        }
    }

    pub(crate) fn mechanism_name(self) -> &'static [u8] {
        match self {
            Self::TlsServerEndPoint => b"SCRAM-SHA-256-PLUS",
            _ => b"SCRAM-SHA-256",
        }
    }
}

/// `c=` is base64(gs2-header + cbind-data): at most 24 + `EVP_MAX_MD_SIZE` bytes.
pub(crate) const CBIND_INPUT_MAX_LEN: usize = 24 + EVP_MAX_MD_SIZE;
pub(crate) const CBIND_BASE64_MAX_LEN: usize =
    bun_base64::encode_len_from_size(CBIND_INPUT_MAX_LEN);

pub struct SASL {
    pub(crate) nonce_base64_bytes: [u8; NONCE_BASE64_LEN],
    pub(crate) nonce_len: u8,

    pub(crate) server_signature_base64_bytes: [u8; SERVER_SIGNATURE_BASE64_LEN],
    pub(crate) server_signature_len: u8,

    pub(crate) salted_password_bytes: [u8; SALTED_PASSWORD_BYTE_LEN],
    pub(crate) salted_password_created: bool,

    pub(crate) channel_binding: ChannelBindingFlag,
    pub(crate) peer_cert_hash: [u8; EVP_MAX_MD_SIZE],
    pub(crate) peer_cert_hash_len: u8,

    pub(crate) status: SASLStatus,
}

impl Default for SASL {
    fn default() -> Self {
        Self {
            nonce_base64_bytes: [0; NONCE_BASE64_LEN],
            nonce_len: 0,
            server_signature_base64_bytes: [0; SERVER_SIGNATURE_BASE64_LEN],
            server_signature_len: 0,
            salted_password_bytes: [0; SALTED_PASSWORD_BYTE_LEN],
            salted_password_created: false,
            channel_binding: ChannelBindingFlag::NotSupported,
            peer_cert_hash: [0; EVP_MAX_MD_SIZE],
            peer_cert_hash_len: 0,
            status: SASLStatus::Init,
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum SASLStatus {
    Init,
    Continue,
}

fn hmac(password: &[u8], data: &[u8]) -> Option<[u8; 32]> {
    let mut buf = [0u8; EVP_MAX_MD_SIZE];
    // TODO: I don't think this is failable.
    let result = bun_sha_hmac::generate(password, data, bun_sha_hmac::Algorithm::Sha256, &mut buf)?;
    debug_assert!(result.len() == 32);
    let mut out = [0u8; 32];
    out.copy_from_slice(&buf[0..32]);
    Some(out)
}

impl SASL {
    // Note: takes the password slice rather than `&mut PostgresSQLConnection` —
    // only `connection.password` is read, and `&mut PostgresSQLConnection` here
    // would alias the `&mut self.authentication_state` borrow live at the call
    // site in `PostgresSQLConnection::on`. Caller dereferences the
    // self-referential `*const [u8]` and passes the slice directly.
    pub(crate) fn compute_salted_password(
        &mut self,
        salt_bytes: &[u8],
        iteration_count: u32,
        password: &[u8],
    ) -> crate::Result<()> {
        // Note: `bun_runtime::crypto::EVP::pbkdf2` is a thin wrapper over
        // BoringSSL's `PKCS5_PBKDF2_HMAC` with `EVP_sha256`. Inlined here to
        // avoid the `bun_runtime` dep (which would create a cycle through
        // `bun_jsc`); `bun_boringssl_sys` is already a direct dependency.
        use bun_boringssl_sys as boringssl;
        use core::ffi::c_uint;

        self.salted_password_created = true;
        let out = &mut self.salted_password_bytes;
        out.fill(0);
        boringssl::ERR_clear_error();
        // SAFETY: password/salt/out are valid for the given lengths;
        // `EVP_sha256()` returns a static EVP_MD singleton.
        let rc = unsafe {
            boringssl::PKCS5_PBKDF2_HMAC(
                if password.is_empty() {
                    core::ptr::null()
                } else {
                    password.as_ptr()
                },
                password.len(),
                salt_bytes.as_ptr(),
                salt_bytes.len(),
                iteration_count as c_uint,
                boringssl::EVP_sha256(),
                out.len(),
                out.as_mut_ptr(),
            )
        };
        if rc <= 0 {
            return Err(crate::Error::PBKDFD2);
        }
        Ok(())
    }

    pub(crate) fn salted_password(&self) -> &[u8] {
        debug_assert!(self.salted_password_created);
        &self.salted_password_bytes[0..SALTED_PASSWORD_BYTE_LEN]
    }

    pub(crate) fn server_signature(&self) -> &[u8] {
        debug_assert!(self.server_signature_len > 0);
        &self.server_signature_base64_bytes[0..self.server_signature_len as usize]
    }

    pub(crate) fn compute_server_signature(&mut self, auth_string: &[u8]) -> crate::Result<()> {
        debug_assert!(self.server_signature_len == 0);

        let server_key =
            hmac(self.salted_password(), b"Server Key").ok_or(crate::Error::InvalidServerKey)?;
        let server_signature_bytes =
            hmac(&server_key, auth_string).ok_or(crate::Error::InvalidServerSignature)?;
        self.server_signature_len = u8::try_from(bun_base64::encode(
            &mut self.server_signature_base64_bytes,
            &server_signature_bytes,
        ))
        .unwrap();
        Ok(())
    }

    pub(crate) fn client_key(&self) -> [u8; 32] {
        hmac(self.salted_password(), b"Client Key").unwrap()
    }

    pub(crate) fn client_key_signature(&self, client_key: &[u8], auth_string: &[u8]) -> [u8; 32] {
        use bun_sha_hmac::SHA256;
        let mut sha_digest = [0u8; SHA256::DIGEST];
        // BoringSSL's `EVP_DigestInit_ex` never reads its `ENGINE*`
        // argument (see vendor/boringssl/crypto/fipsmodule/digest/digest.cc.inc;
        // the parameter exists only for OpenSSL API compatibility). Passing
        // null is bit-identical, so the upward hook is intentionally dropped —
        // same rationale as `s3_signing::credentials::boring_engine`.
        // SAFETY: engine is null (default).
        unsafe { SHA256::hash(client_key, &mut sha_digest, core::ptr::null_mut()) };
        hmac(&sha_digest, auth_string).unwrap()
    }

    /// Writes the `c=` attribute value into `out` and returns its length.
    pub(crate) fn cbind_base64(&self, out: &mut [u8; CBIND_BASE64_MAX_LEN]) -> usize {
        let mut input = [0u8; CBIND_INPUT_MAX_LEN];
        let header = self.channel_binding.gs2_header();
        input[..header.len()].copy_from_slice(header);
        let mut len = header.len();
        if self.channel_binding == ChannelBindingFlag::TlsServerEndPoint {
            let hash = &self.peer_cert_hash[..self.peer_cert_hash_len as usize];
            input[len..len + hash.len()].copy_from_slice(hash);
            len += hash.len();
        }
        bun_base64::encode(out, &input[..len])
    }

    pub(crate) fn nonce(&mut self) -> &[u8] {
        if self.nonce_len == 0 {
            let mut bytes: [u8; NONCE_BYTE_LEN] = [0; NONCE_BYTE_LEN];
            bun_boringssl_sys::rand_bytes(&mut bytes);
            self.nonce_len = u8::try_from(bun_base64::encode(&mut self.nonce_base64_bytes, &bytes))
                .expect("int cast");
        }
        &self.nonce_base64_bytes[0..self.nonce_len as usize]
    }
}

// The only "deinit" site (`AuthenticationState::zero`) replaces the whole
// enum variant by assignment, so no `reset()` is needed and nothing maps to Drop.
