use core::ffi::{c_int, c_uint};

use bun_boringssl_sys::{EVP_MD, EVP_sha256, EVP_sha384};
use bun_quic::crypto::{Cipher, Crypto, HeaderKey, NONCE_LEN, PacketKey, SAMPLE_LEN, TAG_LEN};

bun_opaque::opaque_ffi! {
    struct EVP_AEAD;
    struct EVP_AEAD_CTX;
}

/// `struct aes_key_st`.
#[repr(C, align(4))]
struct AES_KEY([u8; 244]);

unsafe extern "C" {
    safe fn EVP_aead_aes_128_gcm() -> &'static EVP_AEAD;
    safe fn EVP_aead_aes_256_gcm() -> &'static EVP_AEAD;
    safe fn EVP_aead_chacha20_poly1305() -> &'static EVP_AEAD;
    fn EVP_AEAD_CTX_new(
        aead: &EVP_AEAD,
        key: *const u8,
        key_len: usize,
        tag_len: usize,
    ) -> Option<Box<EVP_AEAD_CTX>>;
    fn EVP_AEAD_CTX_free(ctx: *mut EVP_AEAD_CTX);
    safe fn EVP_AEAD_CTX_aead(ctx: &EVP_AEAD_CTX) -> *const EVP_AEAD;
    fn EVP_AEAD_CTX_seal_scatter(
        ctx: &EVP_AEAD_CTX,
        out: *mut u8,
        out_tag: &mut [u8; TAG_LEN],
        out_tag_len: &mut usize,
        max_out_tag_len: usize,
        nonce: &[u8; NONCE_LEN],
        nonce_len: usize,
        input: *const u8,
        input_len: usize,
        extra_in: *const u8,
        extra_in_len: usize,
        ad: *const u8,
        ad_len: usize,
    ) -> c_int;
    fn EVP_AEAD_CTX_open_gather(
        ctx: &EVP_AEAD_CTX,
        out: *mut u8,
        nonce: &[u8; NONCE_LEN],
        nonce_len: usize,
        input: *const u8,
        input_len: usize,
        in_tag: &[u8; TAG_LEN],
        in_tag_len: usize,
        ad: *const u8,
        ad_len: usize,
    ) -> c_int;
    fn HKDF_extract(
        out_key: *mut u8,
        out_len: &mut usize,
        digest: *const EVP_MD,
        secret: *const u8,
        secret_len: usize,
        salt: *const u8,
        salt_len: usize,
    ) -> c_int;
    fn HKDF_expand(
        out_key: *mut u8,
        out_len: usize,
        digest: *const EVP_MD,
        prk: *const u8,
        prk_len: usize,
        info: *const u8,
        info_len: usize,
    ) -> c_int;
    fn AES_set_encrypt_key(key: *const u8, bits: c_uint, out: &mut AES_KEY) -> c_int;
    safe fn AES_encrypt(input: &[u8; 16], out: &mut [u8; 16], key: &AES_KEY);
    fn CRYPTO_chacha_20(
        out: *mut u8,
        input: *const u8,
        len: usize,
        key: &[u8; 32],
        nonce: &[u8; 12],
        counter: u32,
    );
}

pub struct BoringSsl;

impl Crypto for BoringSsl {
    fn fill_random(&self, out: &mut [u8]) {
        bun_boringssl_sys::rand_bytes(out);
    }

    fn extract(&self, salt: &[u8], key_material: &[u8]) -> [u8; 32] {
        let (mut out, mut len) = ([0; 32], 0);
        // SAFETY: `out` has the size of the digest, and the inputs are valid for their lengths.
        let result = unsafe {
            HKDF_extract(
                out.as_mut_ptr(),
                &mut len,
                EVP_sha256(),
                key_material.as_ptr(),
                key_material.len(),
                salt.as_ptr(),
                salt.len(),
            )
        };
        assert_eq!(result, 1);
        out
    }

    fn expand(&self, cipher: Cipher, secret: &[u8], info: &[u8], out: &mut [u8]) {
        let digest = match cipher {
            Cipher::Aes128GcmSha256 | Cipher::ChaCha20Poly1305Sha256 => EVP_sha256(),
            Cipher::Aes256GcmSha384 => EVP_sha384(),
        };
        // SAFETY: the pointers are valid for their lengths.
        let result = unsafe {
            HKDF_expand(
                out.as_mut_ptr(),
                out.len(),
                digest,
                secret.as_ptr(),
                secret.len(),
                info.as_ptr(),
                info.len(),
            )
        };
        assert_eq!(result, 1);
    }

    fn packet_key(&self, cipher: Cipher, key: &[u8]) -> Box<dyn PacketKey> {
        let aead = match cipher {
            Cipher::Aes128GcmSha256 => EVP_aead_aes_128_gcm(),
            Cipher::Aes256GcmSha384 => EVP_aead_aes_256_gcm(),
            Cipher::ChaCha20Poly1305Sha256 => EVP_aead_chacha20_poly1305(),
        };
        // SAFETY: `key` is valid for its length. The type has no size, so the box frees it only by `drop`.
        unsafe { EVP_AEAD_CTX_new(aead, key.as_ptr(), key.len(), TAG_LEN) }
            .expect("the key has the length of the cipher")
    }

    fn header_key(&self, cipher: Cipher, key: &[u8]) -> Box<dyn HeaderKey> {
        if cipher == Cipher::ChaCha20Poly1305Sha256 {
            let key = key.try_into();
            return Box::new(ChaCha20(key.expect("the key has the length of the cipher")));
        }
        let mut aes = Box::new(AES_KEY([0; _]));
        // SAFETY: `key` has that many bits.
        let result =
            unsafe { AES_set_encrypt_key(key.as_ptr(), key.len() as c_uint * 8, &mut aes) };
        assert_eq!(result, 0);
        aes
    }
}

impl Drop for EVP_AEAD_CTX {
    fn drop(&mut self) {
        // SAFETY: the only values are the boxes from `EVP_AEAD_CTX_new`.
        unsafe { EVP_AEAD_CTX_free(self) }
    }
}

impl EVP_AEAD_CTX {
    fn is_chacha20(&self) -> bool {
        core::ptr::eq(EVP_AEAD_CTX_aead(self), EVP_aead_chacha20_poly1305())
    }
}

impl PacketKey for EVP_AEAD_CTX {
    fn seal(&self, nonce: &[u8; NONCE_LEN], header: &[u8], payload: &mut [u8]) -> [u8; TAG_LEN] {
        let (mut tag, mut tag_len) = ([0; TAG_LEN], 0);
        let at = payload.as_mut_ptr();
        // SAFETY: the pointers are valid for their lengths, and the input may be the output.
        let result = unsafe {
            EVP_AEAD_CTX_seal_scatter(
                self,
                at,
                &mut tag,
                &mut tag_len,
                TAG_LEN,
                nonce,
                NONCE_LEN,
                at,
                payload.len(),
                core::ptr::null(),
                0,
                header.as_ptr(),
                header.len(),
            )
        };
        assert_eq!(result, 1);
        tag
    }

    fn open(
        &self,
        nonce: &[u8; NONCE_LEN],
        header: &[u8],
        payload: &mut [u8],
        tag: &[u8; TAG_LEN],
    ) -> bool {
        let at = payload.as_mut_ptr();
        // SAFETY: the pointers are valid for their lengths, and the input may be the output.
        let result = unsafe {
            EVP_AEAD_CTX_open_gather(
                self,
                at,
                nonce,
                NONCE_LEN,
                at,
                payload.len(),
                tag,
                TAG_LEN,
                header.as_ptr(),
                header.len(),
            )
        };
        if result != 1 {
            bun_boringssl_sys::ERR_clear_error();
        }
        result == 1
    }

    fn confidentiality_limit(&self) -> u64 {
        if self.is_chacha20() { 1 << 62 } else { 1 << 23 }
    }

    fn integrity_limit(&self) -> u64 {
        if self.is_chacha20() { 1 << 36 } else { 1 << 52 }
    }
}

impl Drop for AES_KEY {
    fn drop(&mut self) {
        bun_core::secure_zero(&mut self.0);
    }
}

impl HeaderKey for AES_KEY {
    fn mask(&self, sample: &[u8; SAMPLE_LEN]) -> [u8; 5] {
        let mut block = [0; 16];
        AES_encrypt(sample, &mut block, self);
        let [a, b, c, d, e, ..] = block;
        [a, b, c, d, e]
    }
}

struct ChaCha20([u8; 32]);

impl Drop for ChaCha20 {
    fn drop(&mut self) {
        bun_core::secure_zero(&mut self.0);
    }
}

impl HeaderKey for ChaCha20 {
    fn mask(&self, &[a, b, c, d, nonce @ ..]: &[u8; SAMPLE_LEN]) -> [u8; 5] {
        let mut mask = [0; 5];
        let (at, counter) = (mask.as_mut_ptr(), u32::from_le_bytes([a, b, c, d]));
        // SAFETY: `at` is valid for five bytes, and the input may be the output.
        unsafe { CRYPTO_chacha_20(at, at, 5, &self.0, &nonce, counter) };
        mask
    }
}
