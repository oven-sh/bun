//! Stand-ins for native code the compiler's front end calls on every build, for binaries that link none of Bun's C++: BoringSSL's SHA-256 and library initializers, the abort handler for removed features, the crash handler's queries about compiled code, the two WTF string functions that `bun_sys::Error`'s `Display` links and never calls, ICU's collator, which only the React Compiler calls, and what `bun_core::output::stdio::init` calls at start.

use bun_alloc::WTFStringImplStruct;
use bun_boringssl_sys::{ENGINE, EVP_MD, EVP_MD_CTX, SHA256_CTX, env_md_ctx_md_data};
use bun_core::ffi::zeroed;
use core::ffi::{c_int, c_uint, c_void};
use core::sync::atomic::{AtomicI32, Ordering};

unsafe fn bytes<'a>(p: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        // SAFETY: the contract of this function: `p` and `len` are those of a slice that lives for
        // `'a`.
        unsafe { core::slice::from_raw_parts(p, len) }
    }
}

const INITIAL_HASH_VALUE: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const INITIAL_CONTEXT: SHA256_CTX = SHA256_CTX {
    h: INITIAL_HASH_VALUE,
    Nl: 0,
    Nh: 0,
    data: [0; 64],
    num: 0,
    md_len: 32,
};

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn compress(state: &mut [u32; 8], block: &[u8; 64]) {
    let mut schedule = [0u32; 64];
    for (word, encoded) in schedule.iter_mut().zip(block.as_chunks::<4>().0) {
        *word = u32::from_be_bytes(*encoded);
    }
    for t in 16..64 {
        let (x, y) = (schedule[t - 15], schedule[t - 2]);
        let small_sigma0 = x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3);
        let small_sigma1 = y.rotate_right(17) ^ y.rotate_right(19) ^ (y >> 10);
        schedule[t] = schedule[t - 16]
            .wrapping_add(small_sigma0)
            .wrapping_add(schedule[t - 7])
            .wrapping_add(small_sigma1);
    }

    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for (k, w) in K.iter().zip(&schedule) {
        let big_sigma0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let big_sigma1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choice = (e & f) ^ (!e & g);
        let majority = (a & b) ^ (a & c) ^ (b & c);
        let t1 = h
            .wrapping_add(big_sigma1)
            .wrapping_add(choice)
            .wrapping_add(*k)
            .wrapping_add(*w);
        let t2 = big_sigma0.wrapping_add(majority);
        (h, g, f, e) = (g, f, e, d.wrapping_add(t1));
        (d, c, b, a) = (c, b, a, t1.wrapping_add(t2));
    }
    for (word, addend) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
        *word = word.wrapping_add(addend);
    }
}

fn bit_length(context: &SHA256_CTX) -> u64 {
    (u64::from(context.Nh) << 32) | u64::from(context.Nl)
}

fn absorb(context: &mut SHA256_CTX, mut input: &[u8]) {
    let length = bit_length(context).wrapping_add((input.len() as u64) << 3);
    context.Nl = length as u32;
    context.Nh = (length >> 32) as u32;

    let buffered = context.num as usize;
    if buffered > 0 {
        let taken = input.len().min(context.data.len() - buffered);
        context.data[buffered..buffered + taken].copy_from_slice(&input[..taken]);
        context.num += taken as c_uint;
        if buffered + taken < context.data.len() {
            return;
        }
        compress(&mut context.h, &context.data);
        input = &input[taken..];
    }
    let (blocks, rest) = input.as_chunks::<64>();
    for block in blocks {
        compress(&mut context.h, block);
    }
    context.data[..rest.len()].copy_from_slice(rest);
    context.num = rest.len() as c_uint;
}

fn finish(context: &mut SHA256_CTX) -> [u8; 32] {
    let length = bit_length(context);
    let length_start = context.data.len() - size_of::<u64>();
    let buffered = context.num as usize;
    context.data[buffered] = 0x80;
    context.data[buffered + 1..].fill(0);
    if buffered >= length_start {
        compress(&mut context.h, &context.data);
        context.data.fill(0);
    }
    context.data[length_start..].copy_from_slice(&length.to_be_bytes());
    compress(&mut context.h, &context.data);

    let mut digest = [0; 32];
    for (encoded, word) in digest.as_chunks_mut::<4>().0.iter_mut().zip(context.h) {
        *encoded = word.to_be_bytes();
    }
    digest
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut context = INITIAL_CONTEXT;
    absorb(&mut context, bytes);
    finish(&mut context)
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn SHA256_Init(sha: *mut SHA256_CTX) -> c_int {
    // SAFETY: the caller passes room for a context, which need not be initialized.
    unsafe { sha.write(INITIAL_CONTEXT) };
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn SHA256_Update(sha: *mut SHA256_CTX, data: *const c_void, len: usize) -> c_int {
    // SAFETY: the caller passes a context that `SHA256_Init` wrote, and a slice as a pointer and a
    // length.
    unsafe { absorb(&mut *sha, bytes(data.cast(), len)) };
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn SHA256_Final(out: *mut u8, sha: *mut SHA256_CTX) -> c_int {
    // SAFETY: the caller passes room for 32 bytes, and a context that `SHA256_Init` wrote.
    unsafe { out.cast::<[u8; 32]>().write(finish(&mut *sha)) };
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn SHA256(data: *const u8, len: usize, out: *mut u8) -> *mut u8 {
    // SAFETY: the caller passes a slice as a pointer and a length, and room for 32 bytes.
    unsafe { out.cast::<[u8; 32]>().write(sha256(bytes(data, len))) };
    out
}

static SHA256_MARKER: u8 = 0;

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn EVP_sha256() -> *const EVP_MD {
    (&raw const SHA256_MARKER).cast()
}

const _: () = assert!(
    size_of::<SHA256_CTX>() <= size_of::<env_md_ctx_md_data>()
        && align_of::<SHA256_CTX>() <= align_of::<env_md_ctx_md_data>()
);

unsafe fn sha256_context<'a>(ctx: *mut EVP_MD_CTX) -> &'a mut SHA256_CTX {
    // SAFETY: the contract of this function: `ctx` is an initialized context that lives for `'a`.
    // `md_data` has the size and alignment of a `SHA256_CTX`, and any bytes are a valid one.
    unsafe {
        assert!((*ctx).digest == EVP_sha256(), "EVP_DigestInit has not run");
        &mut *(&raw mut (*ctx).md_data).cast::<SHA256_CTX>()
    }
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn EVP_MD_CTX_init(ctx: &mut EVP_MD_CTX) {
    *ctx = zeroed();
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn EVP_MD_CTX_cleanup(ctx: *mut EVP_MD_CTX) -> c_int {
    // SAFETY: the caller passes a context.
    unsafe { ctx.write(zeroed()) };
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn EVP_DigestInit(ctx: *mut EVP_MD_CTX, type_: *const EVP_MD) -> c_int {
    assert!(type_ == EVP_sha256(), "only SHA-256 has a stand-in");
    // SAFETY: the caller passes room for a context, which need not be initialized.
    unsafe {
        ctx.write(EVP_MD_CTX {
            digest: type_,
            ..zeroed()
        });
        *sha256_context(ctx) = INITIAL_CONTEXT;
    }
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn EVP_DigestUpdate(
    ctx: *mut EVP_MD_CTX,
    data: *const c_void,
    len: usize,
) -> c_int {
    // SAFETY: the caller passes an initialized context, and a slice as a pointer and a length.
    unsafe { absorb(sha256_context(ctx), bytes(data.cast(), len)) };
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn EVP_DigestFinal(
    ctx: *mut EVP_MD_CTX,
    md_out: *mut u8,
    out_size: *mut c_uint,
) -> c_int {
    // SAFETY: the caller passes an initialized context, room for 32 bytes, and null or room for the
    // size.
    unsafe {
        let digest = finish(sha256_context(ctx));
        md_out.cast::<[u8; 32]>().write(digest);
        if !out_size.is_null() {
            out_size.write(32);
        }
        EVP_MD_CTX_cleanup(ctx)
    }
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn EVP_Digest(
    data: *const c_void,
    len: usize,
    md_out: *mut u8,
    md_out_size: *mut c_uint,
    type_: *const EVP_MD,
    _impl: *mut ENGINE,
) -> c_int {
    let mut context = zeroed::<EVP_MD_CTX>();
    let ctx = &raw mut context;
    // SAFETY: `ctx` is a context, and the caller's pointers are what the three functions require.
    unsafe {
        EVP_DigestInit(ctx, type_);
        EVP_DigestUpdate(ctx, data, len);
        EVP_DigestFinal(ctx, md_out, md_out_size)
    }
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn CRYPTO_library_init() {}
#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn SSL_library_init() -> c_int {
    1
}
#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn SSL_load_error_strings() {}
#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn ERR_load_BIO_strings() {}
#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn OpenSSL_add_all_algorithms() {}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn Bun__abortForRemovedFeature(feature: u16) -> ! {
    panic!("removed feature {feature} was entered")
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn Bun__AOT__offsetInCode(_address: *const c_void) -> i64 {
    -1
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn Bun__AOT__frameAtReturnAddress(_return_address: *const c_void) -> i64 {
    -1
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn Bun__AOT__describeAddresses(
    _addresses: *const usize,
    _count: usize,
    _buffer: *mut u8,
    _capacity: usize,
) -> usize {
    0
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn Bun__AOT__addressOfOffsetInCode(offset: usize) -> usize {
    panic!("offset {offset} is in compiled code, and this program has none")
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn BunString__fromBytes(_bytes: *const u8, _len: usize) -> bun_core::String {
    panic!("this program has no WTF strings")
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn BunString__fromLatin1(_bytes: *const u8, _len: usize) -> bun_core::String {
    panic!("this program has no WTF strings")
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn Bun__WTFStringImpl__destroy(_this: *const WTFStringImplStruct) {
    panic!("this program has no WTF strings")
}

unsafe extern "C" {
    safe static bun_stdio_tty: [AtomicI32; 3];
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn bun_initialize_process() {
    for (descriptor, is_terminal) in (0..).zip(&bun_stdio_tty) {
        // SAFETY: `isatty` takes any integer.
        is_terminal.store(unsafe { libc::isatty(descriptor) }, Ordering::Relaxed);
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn bun_remember_inherited_file_descriptors() {}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn Bun__collateUTF8(
    _is_numeric_and_base: bool,
    _a: *const u8,
    _a_len: usize,
    _b: *const u8,
    _b_len: usize,
) -> i32 {
    panic!("this program has no ICU")
}

#[unsafe(no_mangle)]
#[linkage = "weak"]
unsafe extern "C" fn Bun__collateUTF16(
    _is_numeric_and_base: bool,
    _a: *const u16,
    _a_len: usize,
    _b: *const u16,
    _b_len: usize,
) -> i32 {
    panic!("this program has no ICU")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TYPESCRIPT_LIBS;
    use core::mem::MaybeUninit;
    use core::ptr::{null, null_mut};

    fn hex(digest: [u8; 32]) -> String {
        use core::fmt::Write;
        let mut text = String::new();
        for byte in digest {
            write!(text, "{byte:02x}").unwrap();
        }
        text
    }

    fn sha256_one_shot(input: &[u8]) -> [u8; 32] {
        let mut digest = [0; 32];
        // SAFETY: `input` is a slice, and `digest` has room for 32 bytes.
        let out = unsafe { SHA256(input.as_ptr(), input.len(), digest.as_mut_ptr()) };
        assert_eq!(out, digest.as_mut_ptr());
        digest
    }

    fn sha256_incremental(parts: [&[u8]; 3]) -> [u8; 32] {
        let mut context = MaybeUninit::<SHA256_CTX>::uninit();
        let sha = context.as_mut_ptr();
        let mut digest = [0; 32];
        // SAFETY: `SHA256_Init` writes the context before the other two read it. Every part is a
        // slice, and `digest` has room for 32 bytes.
        unsafe {
            assert_eq!(SHA256_Init(sha), 1);
            for part in parts {
                assert_eq!(SHA256_Update(sha, part.as_ptr().cast(), part.len()), 1);
            }
            assert_eq!(SHA256_Final(digest.as_mut_ptr(), sha), 1);
        }
        digest
    }

    fn evp_one_shot(input: &[u8]) -> [u8; 32] {
        let mut digest = [0; 32];
        let mut size = 0;
        // SAFETY: `input` is a slice, `digest` has room for 32 bytes, and `size` is a `c_uint`.
        let result = unsafe {
            EVP_Digest(
                input.as_ptr().cast(),
                input.len(),
                digest.as_mut_ptr(),
                &raw mut size,
                EVP_sha256(),
                null_mut(),
            )
        };
        assert_eq!((result, size), (1, 32));
        digest
    }

    fn evp_incremental(parts: [&[u8]; 3]) -> [u8; 32] {
        let mut context = zeroed::<EVP_MD_CTX>();
        EVP_MD_CTX_init(&mut context);
        let ctx = &raw mut context;
        let mut digest = [0; 32];
        // SAFETY: `ctx` is a context, every part is a slice, and `digest` has room for 32 bytes.
        unsafe {
            assert_eq!(EVP_DigestInit(ctx, EVP_sha256()), 1);
            for part in parts {
                assert_eq!(EVP_DigestUpdate(ctx, part.as_ptr().cast(), part.len()), 1);
            }
            assert_eq!(EVP_DigestFinal(ctx, digest.as_mut_ptr(), null_mut()), 1);
            assert_eq!(EVP_MD_CTX_cleanup(ctx), 1);
        }
        digest
    }

    #[test]
    fn sha256_matches_nist_vectors() {
        let million = vec![b'a'; 1_000_000];
        let vectors: [(&[u8], &str); 4] = [
            (
                b"",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            ),
            (
                &million,
                "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            ),
        ];
        for (input, digest) in vectors {
            assert_eq!(hex(sha256(input)), digest);
        }
    }

    #[test]
    fn one_shot_and_incremental_digests_agree() {
        for length in [0usize, 55, 56, 63, 64, 65, 200] {
            let input: Vec<u8> = (0..length).map(|i| i as u8).collect();
            let (head, rest) = input.split_at(length.min(1));
            let (middle, tail) = rest.split_at(length.min(64) - head.len());
            let parts = [head, middle, tail];
            let digest = sha256(&input);
            assert_eq!(sha256_one_shot(&input), digest, "{length} bytes");
            assert_eq!(sha256_incremental(parts), digest, "{length} bytes");
            assert_eq!(evp_one_shot(&input), digest, "{length} bytes");
            assert_eq!(evp_incremental(parts), digest, "{length} bytes");
        }
    }

    #[test]
    fn last_byte_changes_digest() {
        let mut input = [0; 65];
        let digest = sha256(&input);
        input[64] = 1;
        assert_ne!(sha256(&input), digest);
    }

    #[test]
    fn null_input_with_zero_length_is_empty() {
        let mut digest = [0; 32];
        // SAFETY: a length of 0 reads nothing through `data`, and `digest` has room for 32 bytes.
        unsafe { SHA256(null(), 0, digest.as_mut_ptr()) };
        assert_eq!(digest, sha256(b""));
    }

    #[test]
    fn decoder_reads_bundled_typescript_libs() {
        let es5 = (TYPESCRIPT_LIBS.read)(b"lib.es5.d.ts").unwrap();
        assert!(es5.starts_with(b"/*!"));
        assert!((TYPESCRIPT_LIBS.read)(b"lib.es2015.core.d.ts").is_some());
    }

    #[test]
    fn unknown_typescript_lib_is_absent() {
        assert!((TYPESCRIPT_LIBS.has)(b"lib.es5.d.ts"));
        assert!(!(TYPESCRIPT_LIBS.has)(b"lib.nothing.d.ts"));
    }
}
