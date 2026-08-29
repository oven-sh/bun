//! Mozilla's root CAs (NSS certdata.txt, via packages/bun-usockets/generate-root-certs.mjs), embedded as DER.
//! `root_certs.cpp` hands them to BoringSSL as an `X509_LAZY_CERT_SET`, so a root is parsed only when a chain names
//! it, and `NodeTLS.cpp` re-encodes them for `tls.rootCertificates`.

/// `u32 count`, `u32 offsets[count + 1]`, then the certificates back to back; little-endian.
static BLOB: &[u8] = include_bytes!("../../../packages/bun-usockets/root_certs.der");

struct Index {
    ptrs: Box<[*const u8]>,
    lens: Box<[usize]>,
}
// SAFETY: the pointers are into `BLOB`, which is 'static and immutable.
unsafe impl Sync for Index {}
unsafe impl Send for Index {}

fn u32_at(i: usize) -> usize {
    u32::from_le_bytes(BLOB[i * 4..i * 4 + 4].try_into().unwrap()) as usize
}

static INDEX: std::sync::LazyLock<Index> = std::sync::LazyLock::new(|| {
    let count = u32_at(0);
    let data = &BLOB[4 + 4 * (count + 1)..];
    let mut ptrs = Vec::with_capacity(count);
    let mut lens = Vec::with_capacity(count);
    for i in 0..count {
        let (start, end) = (u32_at(1 + i), u32_at(2 + i));
        ptrs.push(data[start..end].as_ptr());
        lens.push(end - start);
    }
    Index {
        ptrs: ptrs.into(),
        lens: lens.into(),
    }
});

/// The bundled roots as parallel arrays of DER pointers and lengths, valid for the life of the process.
///
/// # Safety
/// `out_certs` and `out_lens` must be valid for one pointer write each.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_bundled_root_certs_der(
    out_certs: *mut *const *const u8,
    out_lens: *mut *const usize,
) -> usize {
    let index = &*INDEX;
    // SAFETY: caller contract.
    unsafe {
        *out_certs = index.ptrs.as_ptr();
        *out_lens = index.lens.as_ptr();
    }
    index.ptrs.len()
}
