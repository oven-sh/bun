use bun_base64;

use bun_boringssl_sys::SSL;
use bun_sha_hmac::hmac::EVP_MAX_MD_SIZE;
use bun_sql::postgres::protocol::authentication::SASLMechanisms;

const NONCE_BYTE_LEN: usize = 18;
const NONCE_BASE64_LEN: usize = bun_base64::encode_len_from_size(NONCE_BYTE_LEN);

const SERVER_SIGNATURE_BYTE_LEN: usize = 32;
const SERVER_SIGNATURE_BASE64_LEN: usize =
    bun_base64::encode_len_from_size(SERVER_SIGNATURE_BYTE_LEN);

const SALTED_PASSWORD_BYTE_LEN: usize = 32;

/// libpq's `channel_binding`.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum ChannelBinding {
    Disable,
    Prefer,
    Require,
}

impl ChannelBinding {
    /// In the order of the numbers `createConnection` takes.
    pub(crate) const ALL: [ChannelBinding; 3] = [
        ChannelBinding::Disable,
        ChannelBinding::Prefer,
        ChannelBinding::Require,
    ];
}

/// The messages are libpq's.
#[derive(Copy, Clone)]
pub(crate) struct Refusal {
    pub(crate) code: &'static [u8],
    pub(crate) message: &'static str,
}

impl Refusal {
    const fn required(message: &'static str) -> Refusal {
        Refusal {
            code: b"ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
            message,
        }
    }

    const fn failed(message: &'static str) -> Refusal {
        Refusal {
            code: b"ERR_POSTGRES_CHANNEL_BINDING_FAILED",
            message,
        }
    }

    const NO_KNOWN_MECHANISM: Refusal = Refusal {
        code: b"ERR_POSTGRES_SASL_NO_KNOWN_MECHANISM",
        message: "none of the server's SASL authentication mechanisms are supported",
    };
    pub(crate) const NOT_A_SASL_REQUEST: Refusal = Refusal::required(
        "channel binding required but not supported by server's authentication request",
    );
    pub(crate) const NOT_BOUND: Refusal = Refusal::required(
        "channel binding required, but server authenticated client without channel binding",
    );
}

/// The channel binding flag of the GS2 header (RFC 5802 §7).
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Gs2Flag {
    /// The client does not do channel binding.
    N,
    /// The client does, and thinks the server does not. A server that does refuses this.
    Y,
    TlsServerEndPoint,
}

impl Gs2Flag {
    pub(crate) fn header(self) -> &'static [u8] {
        match self {
            Gs2Flag::N => b"n,,",
            Gs2Flag::Y => b"y,,",
            Gs2Flag::TlsServerEndPoint => b"p=tls-server-end-point,,",
        }
    }

    pub(crate) fn mechanism(self) -> &'static [u8] {
        match self {
            Gs2Flag::N | Gs2Flag::Y => b"SCRAM-SHA-256",
            Gs2Flag::TlsServerEndPoint => b"SCRAM-SHA-256-PLUS",
        }
    }
}

const CHANNEL_BINDING_MAX_LEN: usize = b"p=tls-server-end-point,,".len() + EVP_MAX_MD_SIZE;
pub(crate) const CHANNEL_BINDING_BASE64_MAX_LEN: usize =
    bun_base64::encode_len_from_size(CHANNEL_BINDING_MAX_LEN);

pub struct SASL {
    pub(crate) nonce_base64_bytes: [u8; NONCE_BASE64_LEN],
    pub(crate) nonce_len: u8,

    pub(crate) server_signature_base64_bytes: [u8; SERVER_SIGNATURE_BASE64_LEN],
    pub(crate) server_signature_len: u8,

    pub(crate) salted_password_bytes: [u8; SALTED_PASSWORD_BYTE_LEN],
    pub(crate) salted_password_created: bool,

    pub(crate) gs2_flag: Gs2Flag,
    certificate_hash: [u8; EVP_MAX_MD_SIZE],
    certificate_hash_len: u8,

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
            gs2_flag: Gs2Flag::N,
            certificate_hash: [0; EVP_MAX_MD_SIZE],
            certificate_hash_len: 0,
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
    /// Chooses as libpq's `pg_SASL_init` does, with one exception: -PLUS in the list of a connection without TLS,
    /// which libpq always refuses, is taken from a server that `asked_for_tls` says was never asked for TLS.
    /// There a proxy speaks TLS to the server for a client that was set up to speak plaintext to the proxy.
    pub(crate) fn init(
        offered: SASLMechanisms,
        channel_binding: ChannelBinding,
        tls: Option<&mut SSL>,
        asked_for_tls: bool,
    ) -> Result<SASL, Refusal> {
        let mut sasl = SASL::default();
        let Some(ssl) = tls else {
            if channel_binding == ChannelBinding::Require {
                return Err(Refusal::required(
                    "channel binding required, but SSL not in use",
                ));
            }
            // The server is on TLS and this client, which wanted it, is not: something in between took it off.
            if offered.scram_sha_256_plus
                && asked_for_tls
                && channel_binding != ChannelBinding::Disable
            {
                return Err(Refusal::failed(
                    "server offered SCRAM-SHA-256-PLUS authentication over a non-SSL connection. channelBinding: \"disable\" connects without channel binding",
                ));
            }
            return offered
                .scram_sha_256
                .then_some(sasl)
                .ok_or(Refusal::NO_KNOWN_MECHANISM);
        };

        if offered.scram_sha_256_plus && channel_binding != ChannelBinding::Disable {
            // No fallback: who terminates TLS picks the certificate, and `n` is never refused.
            let Some(len) = ssl
                .peer_leaf_certificate()
                .and_then(|cert| cert.tls_server_end_point_hash(&mut sasl.certificate_hash))
            else {
                return Err(Refusal::failed(
                    "could not get the hash of the server's certificate for channel binding: its signature algorithm names no digest. channelBinding: \"disable\" connects without channel binding",
                ));
            };
            sasl.certificate_hash_len = len as u8;
            sasl.gs2_flag = Gs2Flag::TlsServerEndPoint;
            return Ok(sasl);
        }

        if channel_binding == ChannelBinding::Require {
            return Err(Refusal::required(
                "channel binding is required, but server did not offer an authentication method that supports channel binding",
            ));
        }
        if !offered.scram_sha_256 {
            return Err(Refusal::NO_KNOWN_MECHANISM);
        }
        if channel_binding == ChannelBinding::Prefer {
            sasl.gs2_flag = Gs2Flag::Y;
        }
        Ok(sasl)
    }

    /// The `c=` attribute: the GS2 header and the channel binding data.
    pub(crate) fn channel_binding_base64<'a>(
        &self,
        out: &'a mut [u8; CHANNEL_BINDING_BASE64_MAX_LEN],
    ) -> &'a [u8] {
        let header = self.gs2_flag.header();
        let hash = &self.certificate_hash[..self.certificate_hash_len as usize];
        let mut input = [0u8; CHANNEL_BINDING_MAX_LEN];
        input[..header.len()].copy_from_slice(header);
        input[header.len()..][..hash.len()].copy_from_slice(hash);
        let len = bun_base64::encode(out, &input[..header.len() + hash.len()]);
        &out[..len]
    }

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
