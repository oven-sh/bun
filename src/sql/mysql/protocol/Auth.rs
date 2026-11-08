// Authentication methods

#[cfg(debug_assertions)]
use core::ffi::c_char;

use bun_boringssl as boringssl;

use bun_sha_hmac::{SHA1, SHA256};

use super::new_writer::{NewWriter, WriterContext};
use super::stack_reader::PacketReader;
use crate::shared::Data;

bun_core::declare_scope!(Auth, hidden);

pub const NONCE_LENGTH: usize = 20;
pub type Nonce = [u8; NONCE_LENGTH];

/// The server terminates the nonce with a NUL that is not part of it.
pub fn nonce(plugin_data: &[u8]) -> crate::Result<Nonce> {
    plugin_data
        .first_chunk()
        .copied()
        .ok_or(crate::Error::MissingAuthData)
}

pub(crate) mod mysql_native_password {
    use super::*;

    pub(crate) fn scramble(password: &[u8], nonce: &Nonce) -> [u8; 20] {
        // SHA1( password ) XOR SHA1( nonce + SHA1( SHA1( password ) ) ) )
        let mut stage1 = [0u8; 20];
        let mut stage2 = [0u8; 20];
        let mut stage3 = [0u8; 20];
        let mut result: [u8; 20] = [0u8; 20];

        // Stage 1: SHA1(password)
        SHA1::hash(password, &mut stage1);

        // Stage 2: SHA1(SHA1(password))
        SHA1::hash(&stage1, &mut stage2);

        // Stage 3: SHA1(nonce + SHA1(SHA1(password)))
        let mut sha1 = SHA1::init();
        sha1.update(nonce);
        sha1.update(&stage2);
        sha1.r#final(&mut stage3);
        // `defer sha1.deinit()` → handled by Drop on SHA1

        // Final: stage1 XOR stage3
        debug_assert_eq!(stage1.len(), stage3.len());
        for ((out, d1), d3) in result.iter_mut().zip(stage1.iter()).zip(stage3.iter()) {
            *out = d3 ^ d1;
        }

        result
    }
}

pub mod caching_sha2_password {
    use super::*;

    pub(crate) fn scramble(password: &[u8], nonce: &Nonce) -> [u8; 32] {
        // XOR(SHA256(password), SHA256(SHA256(SHA256(password)), nonce))
        let mut digest1 = [0u8; 32];
        let mut digest2 = [0u8; 32];
        let mut digest3 = [0u8; 32];
        let mut result: [u8; 32] = [0u8; 32];

        // SHA256(password)
        SHA256::hash(password, &mut digest1);

        // SHA256(SHA256(password))
        SHA256::hash(&digest1, &mut digest2);

        // SHA256(SHA256(SHA256(password)) + nonce): the double hash comes FIRST.
        // mysql_native_password concatenates the other way around; the server's
        // Generate_scramble (sha2_password_common.cc) updates digest_stage2 then m_rnd.
        let mut sha256 = SHA256::init();
        sha256.update(&digest2);
        sha256.update(nonce);
        sha256.r#final(&mut digest3);

        // XOR(SHA256(password), digest3)
        debug_assert_eq!(digest1.len(), digest3.len());
        for ((out, d1), d3) in result.iter_mut().zip(digest1.iter()).zip(digest3.iter()) {
            *out = d1 ^ d3;
        }

        result
    }

    // Any wire byte is possible (success = 0x03, continue_auth = 0x04),
    // so represent as a transparent u8 newtype rather than a closed Rust enum.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub struct FastAuthStatus(pub(crate) u8);

    impl FastAuthStatus {
        pub const SUCCESS: Self = Self(0x03);
        pub const CONTINUE_AUTH: Self = Self(0x04);

        #[inline]
        pub(crate) const fn from_raw(n: u8) -> Self {
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
        pub(crate) data: Data,
    }

    impl Response {
        // `Data`'s own Drop frees `self.data`, so no explicit Drop impl is
        // needed here.

        pub fn decode(&mut self, reader: PacketReader<'_>) -> crate::Result<()> {
            let status: u8 = reader.int::<u8>()?;
            bun_core::scoped_log!(Auth, "FastAuthStatus: {}", status);
            self.status = FastAuthStatus::from_raw(status);

            self.data = reader.read(reader.peek().len())?;
            Ok(())
        }
    }

    // Borrowed param-pack: caller-owned slices that live only across a single
    // `write()` call. `RawSlice<u8>` (encapsulated fat raw pointer with safe
    // `Deref` under the outlives-holder invariant) avoids the per-method
    // `unsafe { &*self.field }` deref triple while keeping the struct
    // lifetime-free per PORTING.md conventions.
    pub struct EncryptedPassword {
        pub password: bun_ptr::RawSlice<u8>,
        pub public_key: bun_ptr::RawSlice<u8>,
        pub nonce: Nonce,
        pub sequence_id: u8,
    }

    impl EncryptedPassword {
        // https://mariadb.com/kb/en/sha256_password-plugin/#rsa-encrypted-password
        // RSA encrypted value of XOR(password, seed) using server public key (RSA_PKCS1_OAEP_PADDING).

        pub(crate) fn write_internal<Context: WriterContext>(
            &self,
            writer: NewWriter<Context>,
        ) -> crate::Result<()> {
            // `RawSlice` invariant: backing storage outlives the holder (this
            // struct lives only for the single `write()` call its caller wraps it
            // in), so safe `Deref` recovers `&[u8]` without an `unsafe` block.
            let (password, public_key) = (self.password.slice(), self.public_key.slice());
            // `&this.public_key[0]` below would index past a zero-length
            // slice if the server answered the public-key request with an
            // empty payload.
            if public_key.is_empty() {
                return Err(crate::Error::InvalidPublicKey);
            }
            // 1024 is overkill but lets cover all cases
            let needed_len = password.len() + 1;
            let mut plain_password = vec![0u8; needed_len];
            plain_password[0..password.len()].copy_from_slice(password);
            plain_password[password.len()] = 0;

            for (i, c) in plain_password.iter_mut().enumerate() {
                *c ^= self.nonce[i % NONCE_LENGTH];
            }
            boringssl::load();
            boringssl::c::ERR_clear_error();
            // Decode public key
            // SAFETY: public_key is non-empty (checked above); BIO_new_mem_buf
            // borrows the buffer for the lifetime of `bio` and does not take ownership.
            let bio = unsafe {
                boringssl::c::BIO_new_mem_buf(
                    public_key.as_ptr().cast::<core::ffi::c_void>(),
                    isize::try_from(public_key.len()).expect("int cast"),
                )
            };
            if bio.is_null() {
                return Err(crate::Error::InvalidPublicKey);
            }
            let bio = OwnedBio(bio);

            // SAFETY: bio.0 is a valid BIO*; null callback/userdata are permitted.
            let rsa = unsafe {
                boringssl::c::PEM_read_bio_RSA_PUBKEY(
                    bio.0,
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
                            buf.as_mut_ptr().cast::<c_char>(),
                        );
                        bun_core::scoped_log!(
                            Auth,
                            "Failed to read public key: {}",
                            bstr::BStr::new(bun_core::ffi::cstr(s).to_bytes())
                        );
                    }
                }
                return Err(crate::Error::InvalidPublicKey);
            }
            let rsa = OwnedRsa(rsa);
            // encrypt password

            // SAFETY: rsa.0 is a valid RSA*.
            let rsa_size = unsafe { boringssl::c::RSA_size(rsa.0) } as usize;
            // should never ne bigger than 4096 but lets cover all cases
            let mut encrypted_password = vec![0u8; rsa_size];

            // SAFETY: plain_password and encrypted_password are valid for the given
            // lengths; rsa.0 is a valid RSA*; padding constant is a valid mode.
            let encrypted_password_len = unsafe {
                boringssl::c::RSA_public_encrypt(
                    plain_password.len(),
                    plain_password.as_ptr(),
                    encrypted_password.as_mut_ptr(),
                    rsa.0,
                    boringssl::c::RSA_PKCS1_OAEP_PADDING,
                )
            };
            if encrypted_password_len == -1 {
                return Err(crate::Error::FailedToEncryptPassword);
            }
            let encrypted_password_slice =
                &encrypted_password[0..usize::try_from(encrypted_password_len).expect("int cast")];

            let mut packet = writer.start(self.sequence_id)?;
            writer.write(encrypted_password_slice)?;
            packet.end()?;
            Ok(())
        }

        // See src/sql/mysql/protocol/NewWriter.rs
        pub fn write<Context: WriterContext>(
            &self,
            writer: NewWriter<Context>,
        ) -> crate::Result<()> {
            self.write_internal(writer)
        }
    }

    #[derive(Default)]
    pub struct PublicKeyResponse {
        pub data: Data,
    }

    impl PublicKeyResponse {
        // `Data`'s own Drop frees `self.data`.

        pub fn decode(&mut self, reader: PacketReader<'_>) -> crate::Result<()> {
            self.data = reader.read(reader.peek().len())?;
            Ok(())
        }
    }

    struct OwnedBio(*mut boringssl::c::BIO);

    impl Drop for OwnedBio {
        fn drop(&mut self) {
            // SAFETY: a non-null BIO* from BIO_new_mem_buf, freed once.
            unsafe {
                let _ = boringssl::c::BIO_free(self.0);
            }
        }
    }

    struct OwnedRsa(*mut boringssl::c::RSA);

    impl Drop for OwnedRsa {
        fn drop(&mut self) {
            // SAFETY: a non-null RSA* from PEM_read_bio_RSA_PUBKEY, freed once.
            unsafe { boringssl::c::RSA_free(self.0) };
        }
    }
}
