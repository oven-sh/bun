//! Mozilla's root CAs (NSS certdata.txt, via packages/bun-usockets/generate-root-certs.mjs), embedded as DER.
//! `root_certs.cpp` hands them to BoringSSL as an `X509_LAZY_CERT_SET`, so a root is parsed only when a chain names
//! it, and `NodeTLS.cpp` re-encodes them for `tls.rootCertificates`.

/// `u32 count`, `u32 offsets[count + 1]`, then the certificates back to back; little-endian.
static BLOB: &[u8] = include_bytes!("../../../packages/bun-usockets/root_certs.der");

fn u32_at(i: usize) -> usize {
    u32::from_le_bytes(BLOB[i * 4..i * 4 + 4].try_into().unwrap()) as usize
}

#[unsafe(no_mangle)]
extern "C" fn us_bundled_root_cert_count() -> usize {
    u32_at(0)
}

/// The `index`th bundled root's DER (in static memory) and its length, or null past the end.
///
/// # Safety
/// `out_len` must be valid for a write.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_bundled_root_cert(index: usize, out_len: *mut usize) -> *const u8 {
    let count = u32_at(0);
    if index >= count {
        return core::ptr::null();
    }
    let data = &BLOB[4 + 4 * (count + 1)..];
    let (start, end) = (u32_at(1 + index), u32_at(2 + index));
    // SAFETY: caller contract.
    unsafe { *out_len = end - start };
    data[start..end].as_ptr()
}
