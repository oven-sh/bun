//! ClientHello fingerprint control for the fetch client: JA3 parsing and the BoringSSL calls.

use core::ffi::c_int;
use core::fmt;

use bun_boringssl::c as ssl;
use bun_core::strings;

use crate::ssl_config::{Fingerprint, Tls13CipherOrder};

unsafe extern "C" {
    /// `bssl::SSL_set_aes_hw_override_for_testing` via `NodeTLS.cpp` (C++ linkage).
    fn Bun__SSL_set_aes_hw_override(ssl: *mut ssl::SSL, aes_hw: bool);
}

// TLS 1.3 suites: always all three, ordered by `aes_hw` (`ssl_write_client_cipher_list`).
const TLS_AES_128_GCM_SHA256: u16 = 0x1301;
const TLS_AES_256_GCM_SHA384: u16 = 0x1302;
const TLS_CHACHA20_POLY1305_SHA256: u16 = 0x1303;

// Extension codepoints (`openssl/tls1.h`).
const EXT_SERVER_NAME: u16 = 0;
const EXT_STATUS_REQUEST: u16 = 5;
const EXT_SUPPORTED_GROUPS: u16 = 10;
const EXT_EC_POINT_FORMATS: u16 = 11;
const EXT_SIGNATURE_ALGORITHMS: u16 = 13;
const EXT_ALPN: u16 = 16;
const EXT_SIGNED_CERTIFICATE_TIMESTAMP: u16 = 18;
const EXT_PADDING: u16 = 21;
const EXT_EXTENDED_MASTER_SECRET: u16 = 23;
const EXT_COMPRESS_CERTIFICATE: u16 = 27;
const EXT_SESSION_TICKET: u16 = 35;
const EXT_PRE_SHARED_KEY: u16 = 41;
const EXT_EARLY_DATA: u16 = 42;
const EXT_SUPPORTED_VERSIONS: u16 = 43;
const EXT_COOKIE: u16 = 44;
const EXT_PSK_KEY_EXCHANGE_MODES: u16 = 45;
const EXT_KEY_SHARE: u16 = 51;
const EXT_ENCRYPTED_CLIENT_HELLO: u16 = 0xfe0d;
const EXT_RENEGOTIATION_INFO: u16 = 0xff01;

/// RFC 8701: `0x0a0a`, `0x1a1a`, ... `0xfafa`.
#[inline]
fn is_grease(value: u16) -> bool {
    value & 0x0f0f == 0x0a0a && (value >> 8) == (value & 0xff)
}

/// Each variant's `Display` is the user-facing reason.
#[derive(Debug, PartialEq, Eq)]
pub enum Ja3Error {
    Shape,
    Number { field: &'static str },
    Duplicate { field: &'static str, id: u16 },
    Version(u16),
    NoCiphers,
    Cipher(u16),
    Tls13Ciphers,
    Extension(u16),
    MissingExtension(u16),
    UnsentExtension(u16),
    Group(u16),
    NoGroups,
    PointFormats,
}

impl fmt::Display for Ja3Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shape => f.write_str(
                "expected 5 comma-separated fields: version,ciphers,extensions,groups,pointFormats",
            ),
            Self::Number { field } => {
                write!(
                    f,
                    "{field} must be dash-separated decimal numbers in 0..65535"
                )
            }
            Self::Duplicate { field, id } => {
                write!(f, "{field} lists {id} more than once")
            }
            Self::Version(v) => write!(
                f,
                "unsupported TLS version {v} (the ClientHello version field is 771 for TLS 1.2 and 1.3 clients)"
            ),
            Self::NoCiphers => f.write_str("the cipher list is empty"),
            Self::Cipher(id) => write!(f, "cipher suite {id} is not supported by BoringSSL"),
            Self::Tls13Ciphers => f.write_str(
                "TLS 1.3 cipher suites must lead the list as 4865-4866-4867 or 4867-4865-4866",
            ),
            Self::Extension(id) => {
                write!(f, "extension {id} cannot be sent by BoringSSL")
            }
            Self::MissingExtension(id) => {
                write!(
                    f,
                    "extension {id} is always sent by BoringSSL and must be listed"
                )
            }
            Self::UnsentExtension(id) => {
                write!(
                    f,
                    "extension {id} is not sent by BoringSSL for the TLS versions the cipher list offers"
                )
            }
            Self::Group(id) => write!(f, "supported group {id} is not supported by BoringSSL"),
            Self::NoGroups => f.write_str("the supported groups list is empty"),
            Self::PointFormats => f.write_str(
                "the point formats field must be 0 when TLS 1.2 is offered and empty otherwise",
            ),
        }
    }
}

/// A JA3 string in BoringSSL terms: 0 versions and empty lists mean "default".
#[derive(Debug, Default)]
pub struct Ja3 {
    pub min_version: u16,
    pub max_version: u16,
    /// `SSL_CTX_set_cipher_list` input: TLS 1.2 and below only.
    pub ciphers: Vec<u8>,
    /// `SSL_CTX_set1_groups_list` input.
    pub groups: Vec<u8>,
    pub fingerprint: Fingerprint,
}

fn parse_ids(field: &[u8], name: &'static str, out: &mut Vec<u16>) -> Result<(), Ja3Error> {
    if field.is_empty() {
        return Ok(());
    }
    for part in strings::split(field, b"-") {
        if part.is_empty() || part.len() > 5 || !part.iter().all(u8::is_ascii_digit) {
            return Err(Ja3Error::Number { field: name });
        }
        let mut value: u32 = 0;
        for &digit in part {
            value = value * 10 + u32::from(digit - b'0');
        }
        let value = u16::try_from(value).map_err(|_| Ja3Error::Number { field: name })?;
        // A ClientHello carries each cipher, extension and group at most once (RFC 8446 4.2).
        if out.contains(&value) {
            return Err(Ja3Error::Duplicate {
                field: name,
                id: value,
            });
        }
        out.push(value);
    }
    Ok(())
}

fn push_name(list: &mut Vec<u8>, name: &[u8]) {
    if !list.is_empty() {
        list.push(b':');
    }
    list.extend_from_slice(name);
}

impl Ja3 {
    pub fn parse(input: &[u8]) -> Result<Self, Ja3Error> {
        let mut fields = strings::split(input, b",");
        let (Some(version), Some(ciphers), Some(extensions), Some(groups), Some(formats), None) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            return Err(Ja3Error::Shape);
        };

        let mut ids: Vec<u16> = Vec::new();
        parse_ids(version, "version", &mut ids)?;
        let [version] = ids[..] else {
            return Err(Ja3Error::Number { field: "version" });
        };
        // BoringSSL always writes 0x0303 as the legacy version, so only 771 can be reproduced.
        if version != ssl::TLS1_2_VERSION {
            return Err(Ja3Error::Version(version));
        }

        let mut this = Ja3::default();

        // Ciphers.
        ids.clear();
        parse_ids(ciphers, "ciphers", &mut ids)?;
        let mut tls13: Vec<u16> = Vec::with_capacity(3);
        let mut has_tls12 = false;
        for &id in &ids {
            if is_grease(id) {
                this.fingerprint.grease = true;
                continue;
            }
            if matches!(
                id,
                TLS_AES_128_GCM_SHA256 | TLS_AES_256_GCM_SHA384 | TLS_CHACHA20_POLY1305_SHA256
            ) {
                // BoringSSL writes the TLS 1.3 suites before the configured list.
                if has_tls12 {
                    return Err(Ja3Error::Tls13Ciphers);
                }
                tls13.push(id);
                continue;
            }
            let cipher = ssl::SSL_get_cipher_by_value(id);
            if cipher.is_null() {
                return Err(Ja3Error::Cipher(id));
            }
            // SAFETY: static cipher table entry; the name is a static C string.
            let name =
                unsafe { bun_core::ffi::cstr(ssl::SSL_CIPHER_standard_name(cipher)) }.to_bytes();
            // Without a PSK callback BoringSSL drops PSK suites from the hello.
            if strings::contains(name, b"_PSK_") {
                return Err(Ja3Error::Cipher(id));
            }
            has_tls12 = true;
            push_name(&mut this.ciphers, name);
        }
        this.fingerprint.tls13_cipher_order = match tls13[..] {
            [] => Tls13CipherOrder::Default,
            [
                TLS_AES_128_GCM_SHA256,
                TLS_AES_256_GCM_SHA384,
                TLS_CHACHA20_POLY1305_SHA256,
            ] => Tls13CipherOrder::AesFirst,
            [
                TLS_CHACHA20_POLY1305_SHA256,
                TLS_AES_128_GCM_SHA256,
                TLS_AES_256_GCM_SHA384,
            ] => Tls13CipherOrder::ChaChaFirst,
            _ => return Err(Ja3Error::Tls13Ciphers),
        };
        match (has_tls12, tls13.is_empty()) {
            (false, true) => return Err(Ja3Error::NoCiphers),
            (false, false) => this.min_version = ssl::TLS1_3_VERSION,
            (true, true) => this.max_version = ssl::TLS1_2_VERSION,
            (true, false) => {}
        }

        // Extensions: toggles set a flag, the ones BoringSSL always sends pass through.
        let fp = &mut this.fingerprint;
        fp.ocsp_stapling = false;
        fp.signed_cert_timestamps = false;
        fp.session_tickets = false;
        ids.clear();
        parse_ids(extensions, "extensions", &mut ids)?;
        for &id in &ids {
            match id {
                _ if is_grease(id) => fp.grease = true,
                EXT_STATUS_REQUEST => fp.ocsp_stapling = true,
                EXT_SIGNED_CERTIFICATE_TIMESTAMP => fp.signed_cert_timestamps = true,
                EXT_SESSION_TICKET => fp.session_tickets = true,
                EXT_COMPRESS_CERTIFICATE => {
                    fp.cert_compression = [ssl::TLSEXT_cert_compression_brotli as u8, 0, 0];
                }
                ssl::TLSEXT_TYPE_application_settings_old
                | ssl::TLSEXT_TYPE_application_settings => fp.alps_codepoint = id,
                EXT_ENCRYPTED_CLIENT_HELLO => fp.ech_grease = true,
                EXT_SERVER_NAME
                | EXT_SUPPORTED_GROUPS
                | EXT_EC_POINT_FORMATS
                | EXT_SIGNATURE_ALGORITHMS
                | EXT_ALPN
                | EXT_PADDING
                | EXT_EXTENDED_MASTER_SECRET
                | EXT_PRE_SHARED_KEY
                | EXT_EARLY_DATA
                | EXT_SUPPORTED_VERSIONS
                | EXT_COOKIE
                | EXT_PSK_KEY_EXCHANGE_MODES
                | EXT_KEY_SHARE
                | EXT_RENEGOTIATION_INFO => {}
                _ => return Err(Ja3Error::Extension(id)),
            }
        }
        // The converse check: what BoringSSL sends unconditionally has to be in the list.
        let mut required = vec![EXT_SUPPORTED_GROUPS, EXT_SIGNATURE_ALGORITHMS, EXT_ALPN];
        if has_tls12 {
            required.extend([
                EXT_EC_POINT_FORMATS,
                EXT_EXTENDED_MASTER_SECRET,
                EXT_RENEGOTIATION_INFO,
            ]);
        }
        if !tls13.is_empty() {
            required.extend([
                EXT_SUPPORTED_VERSIONS,
                EXT_PSK_KEY_EXCHANGE_MODES,
                EXT_KEY_SHARE,
            ]);
        }
        if let Some(&missing) = required.iter().find(|ext| !ids.contains(ext)) {
            return Err(Ja3Error::MissingExtension(missing));
        }
        // And what it sends only for a TLS version the cipher list does not offer must be absent.
        let unsent: &[u16] = if tls13.is_empty() {
            &[
                EXT_PRE_SHARED_KEY,
                EXT_EARLY_DATA,
                EXT_SUPPORTED_VERSIONS,
                EXT_COOKIE,
                EXT_PSK_KEY_EXCHANGE_MODES,
                EXT_KEY_SHARE,
                EXT_ENCRYPTED_CLIENT_HELLO,
                ssl::TLSEXT_TYPE_application_settings_old,
                ssl::TLSEXT_TYPE_application_settings,
            ]
        } else if !has_tls12 {
            &[
                EXT_EC_POINT_FORMATS,
                EXT_EXTENDED_MASTER_SECRET,
                EXT_RENEGOTIATION_INFO,
                EXT_SESSION_TICKET,
            ]
        } else {
            &[]
        };
        if let Some(&listed) = unsent.iter().find(|ext| ids.contains(ext)) {
            return Err(Ja3Error::UnsentExtension(listed));
        }

        // Supported groups.
        ids.clear();
        parse_ids(groups, "groups", &mut ids)?;
        for &id in &ids {
            if is_grease(id) {
                this.fingerprint.grease = true;
                continue;
            }
            // SAFETY: plain-id lookup; returns a static C string or null.
            let name = unsafe { ssl::SSL_get_group_name(id) };
            if name.is_null() {
                return Err(Ja3Error::Group(id));
            }
            // SAFETY: non-null, static, NUL-terminated.
            push_name(
                &mut this.groups,
                unsafe { bun_core::ffi::cstr(name) }.to_bytes(),
            );
        }
        // An empty list would fall back to BoringSSL's default groups.
        if this.groups.is_empty() {
            return Err(Ja3Error::NoGroups);
        }

        // Point formats: BoringSSL sends `ec_point_formats` with only 0 (uncompressed), TLS 1.2 only.
        ids.clear();
        parse_ids(formats, "pointFormats", &mut ids)?;
        let expected: &[u16] = if has_tls12 { &[0] } else { &[] };
        if ids[..] != *expected {
            return Err(Ja3Error::PointFormats);
        }

        Ok(this)
    }
}

/// The `SSL_CTX`-only settings; both are read at handshake time.
///
/// # Safety
/// `ctx` must be a live `SSL_CTX*` on which no handshake has started.
pub unsafe fn apply_to_ssl_ctx(ctx: *mut ssl::SSL_CTX, fp: &Fingerprint) {
    // SAFETY: caller guarantees `ctx` is live.
    unsafe {
        if fp.grease {
            ssl::SSL_CTX_set_grease_enabled(ctx, 1);
        }
        for alg in fp.cert_compression_algs() {
            let decompress: ssl::ssl_cert_decompression_func_t = match u16::from(alg) {
                ssl::TLSEXT_cert_compression_zlib => decompress_zlib,
                ssl::TLSEXT_cert_compression_brotli => decompress_brotli,
                ssl::TLSEXT_cert_compression_zstd => decompress_zstd,
                _ => continue,
            };
            // Fails only on OOM or a duplicate id; `Fingerprint` holds no duplicates.
            let _ =
                ssl::SSL_CTX_add_cert_compression_alg(ctx, u16::from(alg), None, Some(decompress));
        }
    }
}

/// Per-connection knobs.
///
/// # Safety
/// `ssl_ptr` must be a live client `SSL*` whose handshake has not started.
pub unsafe fn apply_to_ssl(ssl_ptr: *mut ssl::SSL, fp: &Fingerprint) {
    // SAFETY: caller guarantees `ssl_ptr` is live and pre-handshake.
    unsafe {
        if fp.signed_cert_timestamps {
            ssl::SSL_enable_signed_cert_timestamps(ssl_ptr);
        }
        if fp.ocsp_stapling {
            ssl::SSL_enable_ocsp_stapling(ssl_ptr);
        }
        if fp.permute_extensions {
            ssl::SSL_set_permute_extensions(ssl_ptr, 1);
        }
        if !fp.session_tickets {
            ssl::SSL_set_options(ssl_ptr, ssl::SSL_OP_NO_TICKET);
        }
        if fp.ech_grease {
            ssl::SSL_set_enable_ech_grease(ssl_ptr, 1);
        }
        if fp.alps_codepoint != 0 {
            // ALPS only means something for h2; Chrome offers it for h2 alone.
            ssl::SSL_add_application_settings(ssl_ptr, b"h2".as_ptr(), 2, core::ptr::null(), 0);
            ssl::SSL_set_alps_use_new_codepoint(
                ssl_ptr,
                c_int::from(fp.alps_codepoint == ssl::TLSEXT_TYPE_application_settings),
            );
        }
        match fp.tls13_cipher_order {
            Tls13CipherOrder::Default => {}
            Tls13CipherOrder::AesFirst => Bun__SSL_set_aes_hw_override(ssl_ptr, true),
            Tls13CipherOrder::ChaChaFirst => Bun__SSL_set_aes_hw_override(ssl_ptr, false),
        }
    }
}

// ── compress_certificate (RFC 8879) decompression callbacks, output bounded by `uncompressed_len` ──

/// Wraps `out` in a `CRYPTO_BUFFER` when it is exactly `uncompressed_len` bytes.
///
/// # Safety
/// `out_buf` must be the `CRYPTO_BUFFER**` BoringSSL passed to the callback.
unsafe fn finish_decompression(
    out_buf: *mut *mut ssl::CRYPTO_BUFFER,
    uncompressed_len: usize,
    out: &[u8],
) -> c_int {
    if out.len() != uncompressed_len {
        return 0;
    }
    // SAFETY: `CRYPTO_BUFFER_new` copies `out`; `out_buf` is valid per the callback contract.
    let buf = unsafe { ssl::CRYPTO_BUFFER_new(out.as_ptr(), out.len(), core::ptr::null_mut()) };
    if buf.is_null() {
        return 0;
    }
    // SAFETY: see above.
    unsafe { *out_buf = buf };
    1
}

/// Reserves `len` bytes of spare capacity, or `None` on allocation failure.
fn reserve_exact(len: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    out.try_reserve_exact(len).ok()?;
    Some(out)
}

unsafe extern "C" fn decompress_brotli(
    _ssl: *mut ssl::SSL,
    out_buf: *mut *mut ssl::CRYPTO_BUFFER,
    uncompressed_len: usize,
    input: *const u8,
    in_len: usize,
) -> c_int {
    use bun_brotli::c::{BrotliDecoder, BrotliDecoderResult};
    // SAFETY: BoringSSL passes a valid `input[..in_len]`.
    let input = unsafe { bun_core::ffi::slice(input, in_len) };
    let Some(mut out) = reserve_exact(uncompressed_len) else {
        return 0;
    };
    if !BrotliDecoder::initialize_brotli() {
        return 0;
    }
    // SAFETY: the allocator thunks are valid `extern "C"` fns; opaque is unused.
    let Some(decoder) = (unsafe {
        BrotliDecoder::create_instance(
            Some(bun_brotli::BrotliAllocator::alloc),
            Some(bun_brotli::BrotliAllocator::free),
            core::ptr::null_mut(),
        )
    }) else {
        return 0;
    };
    let mut available_in = input.len();
    let mut next_in = input.as_ptr();
    let mut available_out = uncompressed_len;
    let mut next_out = out.spare_capacity_mut().as_mut_ptr().cast::<u8>();
    let result = BrotliDecoder::decompress_stream(
        decoder,
        &mut available_in,
        &mut next_in,
        &mut available_out,
        &mut next_out,
        None,
    );
    BrotliDecoder::destroy_instance(decoder);
    if result != BrotliDecoderResult::success || available_in != 0 {
        return 0;
    }
    // SAFETY: brotli initialized `uncompressed_len - available_out` bytes of spare capacity.
    unsafe { bun_core::vec::commit_spare(&mut out, uncompressed_len - available_out) };
    // SAFETY: `out_buf` comes from BoringSSL.
    unsafe { finish_decompression(out_buf, uncompressed_len, &out) }
}

unsafe extern "C" fn decompress_zlib(
    _ssl: *mut ssl::SSL,
    out_buf: *mut *mut ssl::CRYPTO_BUFFER,
    uncompressed_len: usize,
    input: *const u8,
    in_len: usize,
) -> c_int {
    use bun_zlib::{FlushValue, InflateDecoder, ReturnCode};
    // SAFETY: BoringSSL passes a valid `input[..in_len]`.
    let input = unsafe { bun_core::ffi::slice(input, in_len) };
    let Some(mut out) = reserve_exact(uncompressed_len) else {
        return 0;
    };
    // Positive window bits: RFC 1950 zlib framing, which RFC 8879 specifies.
    let Ok(mut decoder) = InflateDecoder::new(bun_zlib::MAX_WBITS) else {
        return 0;
    };
    // The spare capacity is the output window, so inflate cannot write past it.
    let (consumed, rc) = decoder.step(input, &mut out, 0, FlushValue::Finish);
    if rc != ReturnCode::StreamEnd || consumed != input.len() {
        return 0;
    }
    // SAFETY: `out_buf` comes from BoringSSL.
    unsafe { finish_decompression(out_buf, uncompressed_len, &out) }
}

unsafe extern "C" fn decompress_zstd(
    _ssl: *mut ssl::SSL,
    out_buf: *mut *mut ssl::CRYPTO_BUFFER,
    uncompressed_len: usize,
    input: *const u8,
    in_len: usize,
) -> c_int {
    // SAFETY: BoringSSL passes a valid `input[..in_len]`.
    let input = unsafe { bun_core::ffi::slice(input, in_len) };
    let Some(mut out) = reserve_exact(uncompressed_len) else {
        return 0;
    };
    // Bounded by the spare capacity: a larger frame fails with `dstSize_tooSmall`.
    if bun_zstd::decompress_append(&mut out, input).is_err() {
        return 0;
    }
    // SAFETY: `out_buf` comes from BoringSSL.
    unsafe { finish_decompression(out_buf, uncompressed_len, &out) }
}
