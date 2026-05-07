use bun_base64;

use bun_sha_hmac::hmac::EVP_MAX_MD_SIZE;

const NONCE_BYTE_LEN: usize = 18;
// PORT NOTE: `bun_base64::encode_len_from_size` is not `const fn` yet; inlined
// the standard base64 ceil-div formula. Matches Zig `bun.base64.encodeLenFromSize(18)`.
const NONCE_BASE64_LEN: usize = (NONCE_BYTE_LEN + 2) / 3 * 4;

const SERVER_SIGNATURE_BYTE_LEN: usize = 32;
const SERVER_SIGNATURE_BASE64_LEN: usize = (SERVER_SIGNATURE_BYTE_LEN + 2) / 3 * 4;

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
    let mut buf: [u8; EVP_MAX_MD_SIZE] = unsafe { core::mem::zeroed() };
    // TODO: I don't think this is failable.
    let result = bun_sha_hmac::generate(password, data, bun_sha_hmac::Algorithm::Sha256, &mut buf)?;
    debug_assert!(result.len() == 32);
    let mut out = [0u8; 32];
    out.copy_from_slice(&buf[0..32]);
    Some(out)
}

impl SASL {
    // PORT NOTE: reshaped for borrowck — Zig passed `*PostgresSQLConnection` but
    // only read `connection.password`. Taking `&mut PostgresSQLConnection` here
    // would alias the `&mut self.authentication_state` borrow live at the call
    // site in `PostgresSQLConnection::on`. Caller dereferences the
    // self-referential `*const [u8]` and passes the slice directly.
    pub fn compute_salted_password(
        &mut self,
        salt_bytes: &[u8],
        iteration_count: u32,
        password: &[u8],
    ) -> Result<(), bun_core::Error> {
        // Zig: `jsc.API.Bun.Crypto.EVP.pbkdf2` (src/runtime/api/crypto.zig).
        // PORT NOTE: `bun_runtime::crypto::EVP::pbkdf2` is a thin wrapper over
        // BoringSSL's `PKCS5_PBKDF2_HMAC` with `EVP_sha256`. Inlined here to
        // avoid the `bun_runtime` dep (which would create a cycle through
        // `bun_jsc`); `bun_boringssl_sys` is already a direct dependency.
        use bun_boringssl_sys as boringssl;
        use core::ffi::c_uint;

        self.salted_password_created = true;
        let out = &mut self.salted_password_bytes;
        out.fill(0);
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions.
        unsafe { boringssl::ERR_clear_error() };
        // SAFETY: password/salt/out are valid for the given lengths;
        // `EVP_sha256()` returns a static EVP_MD singleton.
        let rc = unsafe {
            boringssl::PKCS5_PBKDF2_HMAC(
                if password.is_empty() { core::ptr::null() } else { password.as_ptr() },
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
        use bun_sha_hmac::SHA256;
        // SAFETY: all-zero is a valid [u8; N]
        let mut sha_digest: [u8; SHA256::DIGEST] = unsafe { core::mem::zeroed() };
        // TODO(b2-blocked): bun_jsc::VirtualMachine::get / RareData::boring_engine
        // Zig passes `jsc.VirtualMachine.get().rareData().boringEngine()` here;
        // `None` falls through to BoringSSL's default engine, which is
        // functionally equivalent for SHA256. Swap once bun_jsc compiles.
        SHA256::hash(client_key, &mut sha_digest, core::ptr::null_mut());
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

// TODO(port): Zig `deinit` is reset-for-reuse (zeroes scalar state, no owned resources);
// add `pub fn reset(&mut self)` if callers need it. Not mapped to Drop — no side effects.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/SASL.zig (94 lines)
//   confidence: medium
//   todos:      1
//   notes:      hmac/nonce/client_key_signature un-gated (bun_sha_hmac + bun_core::csprng);
//               compute_salted_password inlines BoringSSL PKCS5_PBKDF2_HMAC (no bun_runtime dep)
// ──────────────────────────────────────────────────────────────────────────
