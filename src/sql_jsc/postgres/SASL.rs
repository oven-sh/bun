use bun_base64;
use bun_boringssl_sys::EVP_MAX_MD_SIZE;
use bun_core;
use bun_hmac;
use bun_jsc::VirtualMachine;
use bun_sha::SHA256;

use super::postgres_sql_connection::PostgresSQLConnection;
// TODO(port): verify path — Zig: `jsc.API.Bun.Crypto.EVP.pbkdf2` (src/runtime/api/crypto.zig)
use bun_runtime::api::crypto::EVP;

const NONCE_BYTE_LEN: usize = 18;
const NONCE_BASE64_LEN: usize = bun_base64::encode_len_from_size(NONCE_BYTE_LEN);

const SERVER_SIGNATURE_BYTE_LEN: usize = 32;
const SERVER_SIGNATURE_BASE64_LEN: usize = bun_base64::encode_len_from_size(SERVER_SIGNATURE_BYTE_LEN);

const SALTED_PASSWORD_BYTE_LEN: usize = 32;

pub struct SASL {
    pub nonce_base64_bytes: [u8; NONCE_BASE64_LEN],
    pub nonce_len: u8,

    pub server_signature_base64_bytes: [u8; SERVER_SIGNATURE_BASE64_LEN],
    pub server_signature_len: u8,

    pub salted_password_bytes: [u8; SALTED_PASSWORD_BYTE_LEN],
    pub salted_password_created: bool,

    pub status: SASLStatus,
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
    // SAFETY: all-zero is a valid [u8; N]
    let mut buf: [u8; EVP_MAX_MD_SIZE as usize] = unsafe { core::mem::zeroed() };

    // TODO: I don't think this is failable.
    let result = bun_hmac::generate(password, data, bun_hmac::Algorithm::Sha256, &mut buf)?;

    debug_assert!(result.len() == 32);
    let mut out = [0u8; 32];
    out.copy_from_slice(&buf[0..32]);
    Some(out)
}

impl SASL {
    pub fn compute_salted_password(
        &mut self,
        salt_bytes: &[u8],
        iteration_count: u32,
        connection: &mut PostgresSQLConnection,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.salted_password_created = true;
        if EVP::pbkdf2(
            &mut self.salted_password_bytes,
            &connection.password,
            salt_bytes,
            iteration_count,
            EVP::Algorithm::Sha256,
        )
        .is_none()
        {
            return Err(bun_core::err!("PBKDFD2"));
        }
        Ok(())
    }

    pub fn salted_password(&self) -> &[u8] {
        debug_assert!(self.salted_password_created);
        &self.salted_password_bytes[0..SALTED_PASSWORD_BYTE_LEN]
    }

    pub fn server_signature(&self) -> &[u8] {
        debug_assert!(self.server_signature_len > 0);
        &self.server_signature_base64_bytes[0..self.server_signature_len as usize]
    }

    pub fn compute_server_signature(&mut self, auth_string: &[u8]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        debug_assert!(self.server_signature_len == 0);

        let server_key =
            hmac(self.salted_password(), b"Server Key").ok_or(bun_core::err!("InvalidServerKey"))?;
        let server_signature_bytes =
            hmac(&server_key, auth_string).ok_or(bun_core::err!("InvalidServerSignature"))?;
        self.server_signature_len = u8::try_from(bun_base64::encode(
            &mut self.server_signature_base64_bytes,
            &server_signature_bytes,
        ))
        .unwrap();
        Ok(())
    }

    pub fn client_key(&self) -> [u8; 32] {
        hmac(self.salted_password(), b"Client Key").unwrap()
    }

    pub fn client_key_signature(&self, client_key: &[u8], auth_string: &[u8]) -> [u8; 32] {
        // SAFETY: all-zero is a valid [u8; N]
        let mut sha_digest: <SHA256 as bun_sha::Hasher>::Digest = unsafe { core::mem::zeroed() };
        // TODO(port): verify VirtualMachine::get().rare_data().boring_engine() path
        SHA256::hash(
            client_key,
            &mut sha_digest,
            VirtualMachine::get().rare_data().boring_engine(),
        );
        hmac(&sha_digest, auth_string).unwrap()
    }

    pub fn nonce(&mut self) -> &[u8] {
        if self.nonce_len == 0 {
            let mut bytes: [u8; NONCE_BYTE_LEN] = [0; NONCE_BYTE_LEN];
            bun_core::csprng(&mut bytes);
            self.nonce_len =
                u8::try_from(bun_base64::encode(&mut self.nonce_base64_bytes, &bytes)).unwrap();
        }
        &self.nonce_base64_bytes[0..self.nonce_len as usize]
    }
}

impl Drop for SASL {
    fn drop(&mut self) {
        // TODO(port): Zig `deinit` only resets state (no owned resources) — likely a reset()
        // for reuse rather than a destructor. Phase B: confirm callers and rename to reset().
        self.nonce_len = 0;
        self.salted_password_created = false;
        self.server_signature_len = 0;
        self.status = SASLStatus::Init;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/SASL.zig (94 lines)
//   confidence: medium
//   todos:      4
//   notes:      crate paths for bun_base64/bun_hmac/bun_sha/csprng/EVP::pbkdf2 are guesses; deinit→Drop is suspect (looks like reset)
// ──────────────────────────────────────────────────────────────────────────
