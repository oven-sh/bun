//! AES

use core::ffi::{c_int, c_void};

#[cfg(unix)]
unsafe extern "C" {
    safe fn EVP_aes_128_cbc() -> *const c_void;
    safe fn EVP_CIPHER_CTX_new() -> *mut c_void;
    fn EVP_CIPHER_CTX_free(context: *mut c_void);
    fn EVP_CipherInit_ex(
        context: *mut c_void,
        cipher: *const c_void,
        engine: *mut c_void,
        key: *const u8,
        iv: *const u8,
        encrypts: c_int,
    ) -> c_int;
    fn EVP_CipherUpdate(
        context: *mut c_void,
        out: *mut u8,
        written: *mut c_int,
        data: *const u8,
        length: c_int,
    ) -> c_int;
    fn EVP_CipherFinal_ex(context: *mut c_void, out: *mut u8, written: *mut c_int) -> c_int;
}

unsafe extern "C" {
    safe fn EVP_aead_aes_256_gcm() -> *const c_void;
    fn EVP_AEAD_CTX_new(
        aead: *const c_void,
        key: *const u8,
        length: usize,
        tag_length: usize,
    ) -> *mut c_void;
    fn EVP_AEAD_CTX_free(context: *mut c_void);
    fn EVP_AEAD_CTX_seal(
        context: *const c_void,
        out: *mut u8,
        written: *mut usize,
        capacity: usize,
        nonce: *const u8,
        nonce_length: usize,
        data: *const u8,
        length: usize,
        additional: *const u8,
        additional_length: usize,
    ) -> c_int;
    fn EVP_AEAD_CTX_open(
        context: *const c_void,
        out: *mut u8,
        written: *mut usize,
        capacity: usize,
        nonce: *const u8,
        nonce_length: usize,
        data: *const u8,
        length: usize,
        additional: *const u8,
        additional_length: usize,
    ) -> c_int;
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Direction {
    Decrypt,
    Encrypt,
}

pub(crate) const TAG: usize = 16;

#[cfg(unix)]
pub(crate) fn aes_128_cbc(
    direction: Direction,
    key: &[u8; 16],
    iv: &[u8; 16],
    data: &[u8],
) -> Option<Vec<u8>> {
    let length = c_int::try_from(data.len()).ok()?;
    let (mut out, mut first, mut last) = (vec![0; data.len() + 32], 0, 0);
    // SAFETY: the key and the IV are as long as the cipher needs, and `out` has room for another block.
    let is_ok = unsafe {
        let context = EVP_CIPHER_CTX_new();
        let (cipher, engine) = (EVP_aes_128_cbc(), core::ptr::null_mut());
        let is_ok = !context.is_null()
            && EVP_CipherInit_ex(
                context,
                cipher,
                engine,
                key.as_ptr(),
                iv.as_ptr(),
                direction as c_int,
            ) == 1
            && EVP_CipherUpdate(
                context,
                out.as_mut_ptr(),
                &raw mut first,
                data.as_ptr(),
                length,
            ) == 1
            && EVP_CipherFinal_ex(context, out.as_mut_ptr().add(first as usize), &raw mut last)
                == 1;
        EVP_CIPHER_CTX_free(context);
        is_ok
    };
    if !is_ok {
        bun_boringssl_sys::ERR_clear_error();
        return None;
    }
    out.truncate((first + last) as usize);
    Some(out)
}

/// The tag follows the ciphertext.
pub(crate) fn aes_256_gcm(
    direction: Direction,
    key: &[u8],
    nonce: &[u8],
    data: &[u8],
) -> Option<Vec<u8>> {
    let (mut out, mut written) = (vec![0; data.len() + TAG], 0);
    let run = if direction == Direction::Encrypt {
        EVP_AEAD_CTX_seal
    } else {
        EVP_AEAD_CTX_open
    };
    // SAFETY: each pointer goes with its length.
    let is_ok = unsafe {
        let context = EVP_AEAD_CTX_new(EVP_aead_aes_256_gcm(), key.as_ptr(), key.len(), TAG);
        let is_ok = !context.is_null()
            && run(
                context,
                out.as_mut_ptr(),
                &raw mut written,
                out.len(),
                nonce.as_ptr(),
                nonce.len(),
                data.as_ptr(),
                data.len(),
                core::ptr::null(),
                0,
            ) == 1;
        EVP_AEAD_CTX_free(context);
        is_ok
    };
    if !is_ok {
        bun_boringssl_sys::ERR_clear_error();
        return None;
    }
    out.truncate(written);
    Some(out)
}
