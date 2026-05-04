// Authentication methods

use core::ffi::{c_char, c_int};

use bun_boringssl as boringssl;
use bun_core::{self, err};
use bun_jsc::VirtualMachine;
use bun_sha::{SHA1, SHA256};

use crate::shared::Data;
use super::new_reader::{decoder_wrap, NewReader};
use super::new_writer::{write_wrap, NewWriter};

bun_output::declare_scope!(Auth, hidden);

pub mod mysql_native_password {
    use super::*;

    // TODO(port): narrow error set
    pub fn scramble(password: &[u8], nonce: &[u8]) -> Result<[u8; 20], bun_core::Error> {
        // SHA1( password ) XOR SHA1( nonce + SHA1( SHA1( password ) ) ) )
        let mut stage1 = [0u8; 20];
        let mut stage2 = [0u8; 20];
        let mut stage3 = [0u8; 20];
        let mut result: [u8; 20] = [0u8; 20];
        if password.is_empty() {
            return Ok(result);
        }
        // A malicious or broken server can send an AuthSwitchRequest with a
        // short plugin_data; without this check the slicing below reads past
        // the end of the buffer.
        if nonce.len() < 20 {
            return Err(err!("MissingAuthData"));
        }

        // Stage 1: SHA1(password)
        SHA1::hash(password, &mut stage1, VirtualMachine::get().rare_data().boring_engine());

        // Stage 2: SHA1(SHA1(password))
        SHA1::hash(&stage1, &mut stage2, VirtualMachine::get().rare_data().boring_engine());

        // Stage 3: SHA1(nonce + SHA1(SHA1(password)))
        let mut sha1 = SHA1::init();
        sha1.update(&nonce[0..8]);
        sha1.update(&nonce[8..20]);
        sha1.update(&stage2);
        sha1.finalize(&mut stage3);
        // `defer sha1.deinit()` → handled by Drop on SHA1

        // Final: stage1 XOR stage3
        debug_assert_eq!(stage1.len(), stage3.len());
        for ((out, d1), d3) in result.iter_mut().zip(stage1.iter()).zip(stage3.iter()) {
            *out = d3 ^ d1;
        }

        Ok(result)
    }
}

pub mod caching_sha2_password {
    use super::*;

    // TODO(port): narrow error set
    pub fn scramble(password: &[u8], nonce: &[u8]) -> Result<[u8; 32], bun_core::Error> {
        // XOR(SHA256(password), SHA256(SHA256(SHA256(password)), nonce))
        let mut digest1 = [0u8; 32];
        let mut digest2 = [0u8; 32];
        let mut digest3 = [0u8; 32];
        let mut result: [u8; 32] = [0u8; 32];

        // SHA256(password)
        SHA256::hash(password, &mut digest1, VirtualMachine::get().rare_data().boring_engine());

        // SHA256(SHA256(password))
        SHA256::hash(&digest1, &mut digest2, VirtualMachine::get().rare_data().boring_engine());

        // SHA256(SHA256(SHA256(password)) + nonce)
        let mut combined = vec![0u8; nonce.len() + digest2.len()];
        combined[0..nonce.len()].copy_from_slice(nonce);
        combined[nonce.len()..].copy_from_slice(&digest2);
        SHA256::hash(&combined, &mut digest3, VirtualMachine::get().rare_data().boring_engine());
        // `defer bun.default_allocator.free(combined)` → Vec drops at scope exit

        // XOR(SHA256(password), digest3)
        debug_assert_eq!(digest1.len(), digest3.len());
        for ((out, d1), d3) in result.iter_mut().zip(digest1.iter()).zip(digest3.iter()) {
            *out = d1 ^ d3;
        }

        Ok(result)
    }

    // Zig: `enum(u8) { success = 0x03, continue_auth = 0x04, _ }` — non-exhaustive,
    // so represent as a transparent u8 newtype rather than a closed Rust enum.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub struct FastAuthStatus(pub u8);

    impl FastAuthStatus {
        pub const SUCCESS: Self = Self(0x03);
        pub const CONTINUE_AUTH: Self = Self(0x04);

        #[inline]
        pub const fn from_raw(n: u8) -> Self {
            Self(n)
        }
    }

    impl Default for FastAuthStatus {
        fn default() -> Self {
            Self::SUCCESS
        }
    }

    #[derive(Default)]
    pub struct Response {
        pub status: FastAuthStatus,
        pub data: Data,
    }

    impl Response {
        // Zig `deinit` only freed `self.data` — Data's own Drop handles that, so no
        // explicit Drop impl needed here.

        // TODO(port): narrow error set
        pub fn decode_internal<Context>(
            &mut self,
            reader: NewReader<Context>,
        ) -> Result<(), bun_core::Error> {
            let status: u8 = reader.int::<u8>()?;
            bun_output::scoped_log!(Auth, "FastAuthStatus: {}", status);
            self.status = FastAuthStatus::from_raw(status);

            // Read remaining data if any
            let remaining = reader.peek();
            if !remaining.is_empty() {
                self.data = reader.read(remaining.len())?;
            }
            Ok(())
        }

        // TODO(port): `pub const decode = decoderWrap(Response, decodeInternal).decode;`
        // — Phase B should confirm the decoder_wrap shape in new_reader.rs.
        pub fn decode<Context>(
            &mut self,
            reader: NewReader<Context>,
        ) -> Result<(), bun_core::Error> {
            decoder_wrap(Self::decode_internal, self, reader)
        }
    }

    // TODO(port): lifetime — borrowed param-pack. PORTING.md forbids lifetime
    // params on structs in Phase A for `[]const u8` fields (Box / &'static / raw
    // only). LIFETIMES.tsv has no row for these. These slices are caller-owned and
    // live only across a single write() call, so use raw `*const [u8]` here; Phase B
    // may promote to `<'a>` once the writer trait shape is settled.
    pub struct EncryptedPassword {
        pub password: *const [u8],
        pub public_key: *const [u8],
        pub nonce: *const [u8],
        pub sequence_id: u8,
    }

    impl EncryptedPassword {
        // https://mariadb.com/kb/en/sha256_password-plugin/#rsa-encrypted-password
        // RSA encrypted value of XOR(password, seed) using server public key (RSA_PKCS1_OAEP_PADDING).

        // TODO(port): narrow error set
        pub fn write_internal<Context>(
            &self,
            writer: NewWriter<Context>,
        ) -> Result<(), bun_core::Error> {
            // SAFETY: password/public_key/nonce are caller-owned slices that outlive
            // this single write() call (borrowed param-pack — see struct TODO above).
            let (password, public_key, nonce) =
                unsafe { (&*self.password, &*self.public_key, &*self.nonce) };
            // The XOR below does `nonce[i % nonce.len]`; an empty nonce from a
            // malicious server's AuthSwitchRequest would be a divide-by-zero.
            if nonce.is_empty() {
                return Err(err!("MissingAuthData"));
            }
            // `&this.public_key[0]` below would index past a zero-length
            // slice if the server answered the public-key request with an
            // empty payload.
            if public_key.is_empty() {
                return Err(err!("InvalidPublicKey"));
            }
            // 1024 is overkill but lets cover all cases
            // PERF(port): was stack-fallback (1024-byte stack buf with heap overflow path) — profile in Phase B
            let needed_len = password.len() + 1;
            let mut plain_password = vec![0u8; needed_len];
            plain_password[0..password.len()].copy_from_slice(password);
            plain_password[password.len()] = 0;

            for (i, c) in plain_password.iter_mut().enumerate() {
                *c ^= nonce[i % nonce.len()];
            }
            boringssl::load();
            // SAFETY: FFI call with no preconditions; clears thread-local error queue.
            unsafe { boringssl::c::ERR_clear_error() };
            // Decode public key
            // SAFETY: public_key is non-empty (checked above); BIO_new_mem_buf
            // borrows the buffer for the lifetime of `bio` and does not take ownership.
            let bio = unsafe {
                boringssl::c::BIO_new_mem_buf(
                    public_key.as_ptr() as *const core::ffi::c_void,
                    c_int::try_from(public_key.len()).unwrap(),
                )
            };
            if bio.is_null() {
                return Err(err!("InvalidPublicKey"));
            }
            let bio = scopeguard::guard(bio, |bio| {
                // SAFETY: bio is a valid non-null BIO* allocated by BIO_new_mem_buf above.
                unsafe { let _ = boringssl::c::BIO_free(bio); }
            });

            // SAFETY: *bio is a valid BIO*; null callback/userdata are permitted.
            let rsa = unsafe {
                boringssl::c::PEM_read_bio_RSA_PUBKEY(
                    *bio,
                    core::ptr::null_mut(),
                    None,
                    core::ptr::null_mut(),
                )
            };
            if rsa.is_null() {
                #[cfg(debug_assertions)]
                {
                    // SAFETY: FFI calls with no preconditions; buf is 256 bytes which is
                    // the documented minimum for ERR_error_string.
                    unsafe {
                        boringssl::c::ERR_load_ERR_strings();
                        boringssl::c::ERR_load_crypto_strings();
                        let mut buf = [0u8; 256];
                        let s = boringssl::c::ERR_error_string(
                            boringssl::c::ERR_get_error(),
                            buf.as_mut_ptr() as *mut c_char,
                        );
                        bun_output::scoped_log!(
                            Auth,
                            "Failed to read public key: {}",
                            bstr::BStr::new(core::ffi::CStr::from_ptr(s).to_bytes())
                        );
                    }
                }
                return Err(err!("InvalidPublicKey"));
            }
            let rsa = scopeguard::guard(rsa, |rsa| {
                // SAFETY: rsa is a valid non-null RSA* returned by PEM_read_bio_RSA_PUBKEY.
                unsafe { boringssl::c::RSA_free(rsa) };
            });
            // encrypt password

            // SAFETY: *rsa is a valid RSA*.
            let rsa_size = unsafe { boringssl::c::RSA_size(*rsa) } as usize;
            // should never ne bigger than 4096 but lets cover all cases
            // PERF(port): was stack-fallback (4096-byte stack buf with heap overflow path) — profile in Phase B
            let mut encrypted_password = vec![0u8; rsa_size];

            // SAFETY: plain_password and encrypted_password are valid for the given
            // lengths; *rsa is a valid RSA*; padding constant is a valid mode.
            let encrypted_password_len = unsafe {
                boringssl::c::RSA_public_encrypt(
                    c_int::try_from(plain_password.len()).unwrap(),
                    plain_password.as_ptr(),
                    encrypted_password.as_mut_ptr(),
                    *rsa,
                    boringssl::c::RSA_PKCS1_OAEP_PADDING,
                )
            };
            if encrypted_password_len == -1 {
                return Err(err!("FailedToEncryptPassword"));
            }
            let encrypted_password_slice =
                &encrypted_password[0..usize::try_from(encrypted_password_len).unwrap()];

            let mut packet = writer.start(self.sequence_id)?;
            writer.write(encrypted_password_slice)?;
            packet.end()?;
            Ok(())
        }

        // TODO(port): `pub const write = writeWrap(EncryptedPassword, writeInternal).write;`
        pub fn write<Context>(&self, writer: NewWriter<Context>) -> Result<(), bun_core::Error> {
            write_wrap(Self::write_internal, self, writer)
        }
    }

    #[derive(Default)]
    pub struct PublicKeyResponse {
        pub data: Data,
    }

    impl PublicKeyResponse {
        // Zig `deinit` only freed `self.data` — Data's own Drop handles that.

        // TODO(port): narrow error set
        pub fn decode_internal<Context>(
            &mut self,
            reader: NewReader<Context>,
        ) -> Result<(), bun_core::Error> {
            // get all the data
            let remaining = reader.peek();
            if !remaining.is_empty() {
                self.data = reader.read(remaining.len())?;
            }
            Ok(())
        }

        // TODO(port): `pub const decode = decoderWrap(PublicKeyResponse, decodeInternal).decode;`
        pub fn decode<Context>(
            &mut self,
            reader: NewReader<Context>,
        ) -> Result<(), bun_core::Error> {
            decoder_wrap(Self::decode_internal, self, reader)
        }
    }

    pub struct PublicKeyRequest;

    impl PublicKeyRequest {
        // TODO(port): narrow error set
        pub fn write_internal<Context>(
            &self,
            writer: NewWriter<Context>,
        ) -> Result<(), bun_core::Error> {
            writer.int1(0x02)?; // Request public key
            Ok(())
        }

        // TODO(port): `pub const write = writeWrap(PublicKeyRequest, writeInternal).write;`
        pub fn write<Context>(&self, writer: NewWriter<Context>) -> Result<(), bun_core::Error> {
            write_wrap(Self::write_internal, self, writer)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/Auth.zig (229 lines)
//   confidence: medium
//   todos:      10
//   notes:      decoder_wrap/write_wrap signatures guessed; EncryptedPassword fields are raw *const [u8] (Phase-A no-lifetime rule) — Phase B may promote to <'a>; stack-fallback bufs replaced with Vec (PERF-tagged); BoringSSL FFI wrapped in scopeguard for defer-free.
// ──────────────────────────────────────────────────────────────────────────
