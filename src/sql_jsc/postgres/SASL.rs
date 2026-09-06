use bun_base64;

use bun_sha_hmac::hmac::EVP_MAX_MD_SIZE;

const NONCE_BYTE_LEN: usize = 18;
const NONCE_BASE64_LEN: usize = bun_base64::encode_len_from_size(NONCE_BYTE_LEN);

const SERVER_SIGNATURE_BYTE_LEN: usize = 32;
const SERVER_SIGNATURE_BASE64_LEN: usize =
    bun_base64::encode_len_from_size(SERVER_SIGNATURE_BYTE_LEN);

const SALTED_PASSWORD_BYTE_LEN: usize = 32;

pub struct SASL {
    pub(crate) nonce_base64_bytes: [u8; NONCE_BASE64_LEN],
    pub(crate) nonce_len: u8,

    pub(crate) server_signature_base64_bytes: [u8; SERVER_SIGNATURE_BASE64_LEN],
    pub(crate) server_signature_len: u8,

    pub(crate) salted_password_bytes: [u8; SALTED_PASSWORD_BYTE_LEN],
    pub(crate) salted_password_created: bool,

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
        // BoringSSL's `PKCS5_PBKDF2_HMAC` with `EVP_sha256`.
        use bun_boringssl_sys as boringssl;

        self.salted_password_created = true;
        let out = &mut self.salted_password_bytes;
        out.fill(0);
        boringssl::ERR_clear_error();
        if !boringssl::pbkdf2_hmac_sha256(password, salt_bytes, iteration_count as u32, out) {
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
        // BoringSSL's `EVP_DigestInit_ex` never reads its `ENGINE*` argument,
        // so the default engine is bit-identical to the VM's.
        SHA256::digest(client_key, &mut sha_digest);
        hmac(&sha_digest, auth_string).unwrap()
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
