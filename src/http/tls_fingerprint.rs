//! ClientHello fingerprint control for the fetch client.
//!
//! Two halves:
//! - [`Ja3`] parses a JA3 string (`version,ciphers,extensions,groups,formats`,
//!   decimal IANA ids) into the cipher list, group list, version bounds and
//!   [`Fingerprint`] toggles that reproduce it. Anything BoringSSL cannot send
//!   is a parse error, so a caller never gets a silently different fingerprint.
//! - [`apply_to_ssl_ctx`] / [`apply_to_ssl`] turn a [`Fingerprint`] into the
//!   BoringSSL calls, on the custom `SSL_CTX` the fetch client builds for a TLS
//!   config and on each `SSL` before its handshake.

use core::ffi::c_int;
use core::fmt;

use bun_boringssl::c as ssl;
use bun_core::strings;

use crate::ssl_config::{Fingerprint, Tls13CipherOrder};

unsafe extern "C" {
    /// `src/jsc/bindings/NodeTLS.cpp`: wraps `bssl::SSL_set_aes_hw_override_for_testing`,
    /// which only has C++ linkage.
    fn Bun__SSL_set_aes_hw_override(ssl: *mut ssl::SSL, aes_hw: bool);
}

// TLS 1.3 suites. Not part of the configurable cipher list: BoringSSL always
// offers all three and orders them by `aes_hw` (see `ssl_write_client_cipher_list`).
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

#[derive(Debug, PartialEq, Eq)]
pub enum Ja3Error {
    /// Not five comma-separated fields.
    Shape,
    /// A field holds something other than dash-separated decimal numbers
    /// that fit in 16 bits.
    Number { field: &'static str },
    /// The first field is not 769..=772.
    Version(u16),
    /// No cipher suite at all once GREASE values are dropped.
    NoCiphers,
    /// This BoringSSL does not implement the suite, or cannot offer it
    /// (PSK suites need a PSK callback).
    Cipher(u16),
    /// TLS 1.3 suites must appear as a complete set in one of BoringSSL's two
    /// orders: AES first (`4865-4866-4867`) or ChaCha20 first (`4867-4865-4866`).
    Tls13Ciphers,
    /// BoringSSL cannot send this extension, or the fetch client cannot toggle it.
    Extension(u16),
    /// `SSL_get_group_name` does not know this group.
    Group(u16),
    /// Only the uncompressed point format (`0`) is supported.
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
            Self::Version(v) => write!(f, "unsupported TLS version {v} (expected 769 to 772)"),
            Self::NoCiphers => f.write_str("the cipher list is empty"),
            Self::Cipher(id) => write!(f, "cipher suite {id} is not supported by BoringSSL"),
            Self::Tls13Ciphers => f.write_str(
                "TLS 1.3 cipher suites must be listed as 4865-4866-4867 or 4867-4865-4866",
            ),
            Self::Extension(id) => {
                write!(f, "extension {id} cannot be sent by BoringSSL")
            }
            Self::Group(id) => write!(f, "supported group {id} is not supported by BoringSSL"),
            Self::PointFormats => f.write_str("only point format 0 (uncompressed) is supported"),
        }
    }
}

/// What a JA3 string asks the ClientHello to look like, in BoringSSL terms.
#[derive(Debug, Default)]
pub struct Ja3 {
    /// `TLS1_VERSION`..`TLS1_3_VERSION`, or 0 to keep the default floor.
    pub min_version: u16,
    /// `TLS1_2_VERSION` when the string offers no TLS 1.3 suite, else 0.
    pub max_version: u16,
    /// Colon-separated IETF names for `SSL_CTX_set_cipher_list`, TLS 1.2 and
    /// below only. Empty when the string lists TLS 1.3 suites only.
    pub ciphers: Vec<u8>,
    /// Colon-separated group names for `SSL_CTX_set1_groups_list`. Empty when
    /// the string lists no group.
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
        if !(ssl::TLS1_VERSION..=ssl::TLS1_3_VERSION).contains(&version) {
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
                tls13.push(id);
                continue;
            }
            let cipher = ssl::SSL_get_cipher_by_value(id);
            if cipher.is_null() {
                return Err(Ja3Error::Cipher(id));
            }
            // SAFETY: `cipher` is a pointer into BoringSSL's static cipher table
            // and `SSL_CIPHER_standard_name` returns a static NUL-terminated string.
            let name =
                unsafe { bun_core::ffi::cstr(ssl::SSL_CIPHER_standard_name(cipher)) }.to_bytes();
            // The client masks PSK suites out of the ClientHello when no PSK
            // callback is configured, and fetch never configures one.
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
            // TLS 1.3 only: no legacy suites, so no TLS 1.2 handshake either.
            (false, false) => this.min_version = ssl::TLS1_3_VERSION,
            // No TLS 1.3 suites: the client does not speak TLS 1.3.
            (true, true) => this.max_version = ssl::TLS1_2_VERSION,
            (true, false) => {}
        }
        // The JA3 version field is the ClientHello's legacy_version: 771 for
        // every TLS 1.2+ client. It only carries information below that.
        if has_tls12 && version < ssl::TLS1_2_VERSION {
            this.min_version = version;
        }

        // Extensions: the ones the fetch client can toggle set a flag; the
        // ones BoringSSL sends on its own are accepted as-is.
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

        // Supported groups.
        ids.clear();
        parse_ids(groups, "groups", &mut ids)?;
        for &id in &ids {
            if is_grease(id) {
                this.fingerprint.grease = true;
                continue;
            }
            // SAFETY: `SSL_get_group_name` takes a plain id and returns a
            // static NUL-terminated string or null.
            let name = unsafe { ssl::SSL_get_group_name(id) };
            if name.is_null() {
                return Err(Ja3Error::Group(id));
            }
            // SAFETY: non-null, static, NUL-terminated (checked above).
            push_name(
                &mut this.groups,
                unsafe { bun_core::ffi::cstr(name) }.to_bytes(),
            );
        }

        // Point formats. BoringSSL only ever sends uncompressed (0).
        ids.clear();
        parse_ids(formats, "pointFormats", &mut ids)?;
        if !matches!(ids[..], [] | [0]) {
            return Err(Ja3Error::PointFormats);
        }

        Ok(this)
    }
}

/// Context-wide knobs: the two settings BoringSSL only exposes on the
/// `SSL_CTX`. Both are read from the context when the handshake runs, so this
/// may also be called on a context whose `SSL` already exists, as long as no
/// handshake has started on it.
///
/// # Safety
/// `ctx` must be a live `SSL_CTX*` on which no handshake has started.
pub unsafe fn apply_to_ssl_ctx(ctx: *mut ssl::SSL_CTX, fp: &Fingerprint) {
    // SAFETY: caller guarantees `ctx` is live; these only set flags and
    // register static callbacks on it.
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
            // Only fails on OOM or a duplicate id, and `Fingerprint` never
            // holds duplicates.
            let _ =
                ssl::SSL_CTX_add_cert_compression_alg(ctx, u16::from(alg), None, Some(decompress));
        }
    }
}

/// Per-connection knobs. Call on a client `SSL` before its handshake starts.
///
/// # Safety
/// `ssl` must be a live client `SSL*` whose handshake has not started.
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

// ── compress_certificate (RFC 8879) decompression callbacks ──────────────
//
// BoringSSL hands over the compressed bytes and the length the peer claims;
// the callback must produce exactly that many bytes in a `CRYPTO_BUFFER`.
// Each decoder is given an output bound of `uncompressed_len` so a server
// cannot make the client inflate more than it announced.

/// Wraps `out` in a `CRYPTO_BUFFER` when it is exactly `uncompressed_len`
/// bytes. Returns the BoringSSL status code.
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
    // SAFETY: `CRYPTO_BUFFER_new` copies `out`; `out_buf` is valid per the
    // callback contract.
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
    // Anything but a completed stream that consumed all input and filled the
    // announced length exactly is a malformed or oversized certificate.
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
    // `step` uses the whole spare capacity as the output window, so the
    // decoder cannot write past the announced length (plus allocator slack).
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
    // One-shot decode bounded by the spare capacity: a frame larger than
    // `uncompressed_len` fails with `dstSize_tooSmall`.
    if bun_zstd::decompress_append(&mut out, input).is_err() {
        return 0;
    }
    // SAFETY: `out_buf` comes from BoringSSL.
    unsafe { finish_decompression(out_buf, uncompressed_len, &out) }
}
