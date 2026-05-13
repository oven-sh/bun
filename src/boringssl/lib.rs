// TODO: move all custom functions from the translated file into this file, then
// the translated file can be provided by `zig translate-c`

#![allow(unused, static_mut_refs)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
use core::ffi::CStr;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr;
use std::cell::Cell;

pub use bun_boringssl_sys as boring;
use bun_cares_sys as c_ares;
use bun_core::strings;

// MOVE_DOWN: ported from `src/runtime/api/bun/x509.zig::isSafeAltName`.
// Lives here so `boringssl` does not depend on `bun_runtime` (tier-6).
pub mod x509 {
    /// Returns `true` iff `name` contains no characters that would require
    /// escaping in a subjectAltName entry.
    #[inline]
    pub fn is_safe_alt_name(name: &[u8], utf8: bool) -> bool {
        for &c in name {
            match c {
                // These mess with encoding rules.
                // Commas make it impossible to split the list of subject
                // alternative names unambiguously, which is why we escape.
                // Single quotes are unlikely to appear in any legitimate values,
                // but they could be used to make a value look like it was escaped
                // (i.e., enclosed in single/double quotes).
                b'"' | b'\\' | b',' | b'\'' => return false,
                _ => {
                    if utf8 {
                        // In UTF-8 strings, require escaping for any ASCII control
                        // character, but NOT for non-ASCII characters. All bytes of
                        // any multi-byte code point have their MSB set.
                        if c < b' ' || c == 0x7f {
                            return false;
                        }
                    } else {
                        // Reject control characters and non-ASCII characters.
                        if c < b' ' || c > b'~' {
                            return false;
                        }
                    }
                }
            }
        }
        true
    }
}
use x509 as X509;

/// BoringSSL's translated C API
pub use boring as c;

pub fn load() {
    // Callers are expected to invoke this on a single thread during startup
    // before any concurrent BoringSSL use.
    bun_core::run_once! {{
        // BoringSSL no-arg init calls — declared `safe fn` in `bun_boringssl_sys`.
        boring::CRYPTO_library_init();
        // NB: do NOT fold this into `debug_assert!` — that macro elides its
        // argument entirely in release builds, which would skip the call.
        let rc = boring::SSL_library_init();
        debug_assert!(rc > 0);
        boring::SSL_load_error_strings();
        boring::ERR_load_BIO_strings();
        boring::OpenSSL_add_all_algorithms();

        if !cfg!(test) {
            // D006 added the bun_core dep for `run_once!`; keep_symbols! could
            // now be used here too — left as inline `black_box` for this pass.
            core::hint::black_box(OPENSSL_memory_alloc as *const ());
            core::hint::black_box(OPENSSL_memory_get_size as *const ());
            core::hint::black_box(OPENSSL_memory_free as *const ());
        }
    }}
}

// ──────────────────────────────────────────────────────────────────────────
// Extra FFI surface not yet exposed by `bun_boringssl_sys` (hand-curated
// subset). Ground truth: src/boringssl_sys/boringssl.zig + openssl/ssl.h.
// Remove once the bindgen pipeline lands these in the sys crate.
// ──────────────────────────────────────────────────────────────────────────

/// `enum ssl_verify_result_t` is `BORINGSSL_ENUM_INT`-backed; `ssl_verify_ok == 0`.
#[allow(non_camel_case_types)]
type ssl_verify_result_t = c_int;
#[allow(non_upper_case_globals)]
const ssl_verify_ok: ssl_verify_result_t = 0;

/// `#define SSL_DEFAULT_CIPHER_LIST "ALL"`
pub const SSL_DEFAULT_CIPHER_LIST: &core::ffi::CStr = c"ALL";

use boring::{
    CRYPTO_BUFFER_POOL, CRYPTO_BUFFER_POOL_new, SSL_CTX_set_cipher_list, SSL_CTX_set0_buffer_pool,
};

type SslCustomVerifyCb =
    Option<unsafe extern "C" fn(ssl: *mut boring::SSL, out_alert: *mut u8) -> ssl_verify_result_t>;

unsafe extern "C" {
    fn SSL_CTX_set_custom_verify(
        ctx: *mut boring::SSL_CTX,
        mode: c_int,
        callback: SslCustomVerifyCb,
    );
}

unsafe extern "C" fn noop_custom_verify(
    _ssl: *mut boring::SSL,
    _out_alert: *mut u8,
) -> ssl_verify_result_t {
    ssl_verify_ok
}

/// `Send + Sync` newtype around the process-lifetime client `SSL_CTX*` so it
/// can sit inside a `OnceLock` (raw pointers opt out of `Send`/`Sync`).
struct CtxStore(ptr::NonNull<boring::SSL_CTX>);
// SAFETY: `SSL_CTX` is internally thread-safe per BoringSSL docs (its refcount
// and method tables are guarded by `CRYPTO_MUTEX`); we only ever bump the
// refcount and hand it to `SSL_new`, both of which BoringSSL documents as
// thread-safe on a shared `SSL_CTX*`.
unsafe impl Send for CtxStore {}
unsafe impl Sync for CtxStore {}

static CTX_STORE: std::sync::OnceLock<CtxStore> = std::sync::OnceLock::new();

std::thread_local! {
    // Zig: `threadlocal var auto_crypto_buffer_pool: ?*CRYPTO_BUFFER_POOL = null`
    // (boringssl.zig:19225). One pool per thread, lazily allocated on first
    // `SSL_CTX.setup()` call from that thread.
    static AUTO_CRYPTO_BUFFER_POOL: Cell<*mut CRYPTO_BUFFER_POOL> =
        const { Cell::new(ptr::null_mut()) };
}

/// Zig: `SSL_CTX.setup(ctx)` (boringssl.zig:19204) — install the per-thread
/// `CRYPTO_BUFFER_POOL` and set the cipher list to BoringSSL's
/// `SSL_DEFAULT_CIPHER_LIST` (`"ALL"`).
///
/// # Safety
/// `ctx` must be a live `SSL_CTX*`.
pub unsafe fn ssl_ctx_setup(ctx: *mut boring::SSL_CTX) {
    AUTO_CRYPTO_BUFFER_POOL.with(|pool| unsafe {
        if pool.get().is_null() {
            pool.set(CRYPTO_BUFFER_POOL_new());
        }
        SSL_CTX_set0_buffer_pool(ctx, pool.get());
        let _ = SSL_CTX_set_cipher_list(ctx, SSL_DEFAULT_CIPHER_LIST.as_ptr());
    });
}

pub fn init_client() -> *mut boring::SSL {
    // SAFETY: BoringSSL FFI; single-threaded startup assumption (matches Zig).
    unsafe {
        // Zig: `if (ctx_store != null) _ = boring.SSL_CTX_up_ref(ctx_store.?);`
        // Bump the refcount on every call after the first; the first call's
        // `SSL_CTX_new` already returns refcount = 1.
        if let Some(stored) = CTX_STORE.get() {
            let _ = boring::SSL_CTX_up_ref(stored.0.as_ptr());
        }
        let ctx = CTX_STORE
            .get_or_init(|| {
                // Zig: `SSL_CTX.init()` — see boringssl.zig:19197. Three steps:
                //   1. SSL_CTX_new(TLS_with_buffers_method())
                //   2. setCustomVerify(noop_custom_verify) → SSL_CTX_set_custom_verify(ctx, 0, cb)
                //   3. setup() → CRYPTO_BUFFER_POOL_new + set0_buffer_pool + set_cipher_list("ALL")
                let ctx = boring::SSL_CTX_new(boring::TLS_with_buffers_method());
                SSL_CTX_set_custom_verify(ctx, 0, Some(noop_custom_verify));
                ssl_ctx_setup(ctx);
                CtxStore(ptr::NonNull::new(ctx).expect("SSL_CTX_new"))
            })
            .0
            .as_ptr();

        // Zig: `SSL.init(ctx)` = `SSL_new(ctx)`
        let ssl = boring::SSL_new(ctx);
        // Zig: `setIsClient(true)` = `SSL_set_connect_state(ssl)`
        boring::SSL_set_connect_state(ssl);

        ssl
    }
}

// void*, OPENSSL_memory_alloc, (size_t size)
// void, OPENSSL_memory_free, (void *ptr)
// size_t, OPENSSL_memory_get_size, (void *ptr)

// The following three functions can be defined to override default heap
// allocation and freeing. If defined, it is the responsibility of
// |OPENSSL_memory_free| to zero out the memory before returning it to the
// system. |OPENSSL_memory_free| will not be passed NULL pointers.
//
// WARNING: These functions are called on every allocation and free in
// BoringSSL across the entire process. They may be called by any code in the
// process which calls BoringSSL, including in process initializers and thread
// destructors. When called, BoringSSL may hold pthreads locks. Any other code
// in the process which, directly or indirectly, calls BoringSSL may be on the
// call stack and may itself be using arbitrary synchronization primitives.
//
// As a result, these functions may not have the usual programming environment
// available to most C or C++ code. In particular, they may not call into
// BoringSSL, or any library which depends on BoringSSL. Any synchronization
// primitives used must tolerate every other synchronization primitive linked
// into the process, including pthreads locks. Failing to meet these constraints
// may result in deadlocks, crashes, or memory corruption.

#[unsafe(no_mangle)]
pub extern "C" fn OPENSSL_memory_alloc(size: usize) -> *mut c_void {
    // SAFETY: mi_malloc is safe to call with any size; returns null on failure.
    unsafe { bun_alloc::mimalloc::mi_malloc(size) }
}

// BoringSSL always expects memory to be zero'd
#[unsafe(no_mangle)]
pub extern "C" fn OPENSSL_memory_free(ptr: *mut c_void) {
    // SAFETY: BoringSSL guarantees ptr is non-null and was returned by
    // OPENSSL_memory_alloc above (i.e. mi_malloc).
    unsafe {
        let len = bun_alloc::usable_size(ptr.cast());
        ptr::write_bytes(ptr.cast::<u8>(), 0, len);
        bun_alloc::mimalloc::mi_free(ptr);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn OPENSSL_memory_get_size(ptr: *const c_void) -> usize {
    // ptr was returned by mi_malloc (or is null, which usable_size handles).
    bun_alloc::usable_size(ptr.cast())
}

pub use bun_sys::posix::INET6_ADDRSTRLEN;

// Canonical cross-platform AF_* surface — handles the Windows ws2def.h split.
use bun_sys::posix::AF::{INET as AF_INET, INET6 as AF_INET6};

/// converts IP string to canonicalized IP string
/// return null when the IP is invalid
pub fn canonicalize_ip<'a>(
    addr_str: &[u8],
    out_ip: &'a mut [u8; INET6_ADDRSTRLEN + 1],
) -> Option<&'a [u8]> {
    if addr_str.len() >= INET6_ADDRSTRLEN {
        return None;
    }
    let mut ip_std_text = [0u8; INET6_ADDRSTRLEN + 1];
    // we need a null terminated string as input
    out_ip[..addr_str.len()].copy_from_slice(addr_str);
    out_ip[addr_str.len()] = 0;

    let mut af: c_int = AF_INET;
    // get the standard text representation of the IP
    // SAFETY: out_ip is NUL-terminated above; ip_std_text is large enough for any address.
    unsafe {
        if c_ares::ares_inet_pton(af, out_ip.as_ptr().cast(), ip_std_text.as_mut_ptr().cast()) <= 0
        {
            af = AF_INET6;
            if c_ares::ares_inet_pton(af, out_ip.as_ptr().cast(), ip_std_text.as_mut_ptr().cast())
                <= 0
            {
                return None;
            }
        }
    }
    // out_ip will contain the null-terminated canonicalized IP
    // SAFETY: ip_std_text holds the in_addr/in6_addr written by ares_inet_pton above.
    unsafe { c_ares::ntop(af, ip_std_text.as_ptr().cast(), &mut out_ip[..]) }
}

/// converts ASN1_OCTET_STRING to canonicalized IP string
/// return null when the IP is invalid
pub fn ip2_string<'a>(
    ip: &boring::ASN1_OCTET_STRING,
    out_ip: &'a mut [u8; INET6_ADDRSTRLEN + 1],
) -> Option<&'a [u8]> {
    let af: c_int = match ip.length {
        4 => AF_INET,
        16 => AF_INET6,
        _ => return None,
    };
    // SAFETY: ip.data points to ip.length bytes (4 or 16); out_ip is INET6_ADDRSTRLEN+1 bytes.
    unsafe { c_ares::ntop(af, ip.data.cast(), &mut out_ip[..]) }
}

/// Matches a DNS name pattern (possibly with a leading `*.` wildcard) against
/// `hostname`. Mirrors Node.js `check()` in lib/tls.js for a single pattern.
fn match_dns_name(pattern: &[u8], hostname: &[u8]) -> bool {
    if pattern.is_empty() {
        return false;
    }
    if !X509::is_safe_alt_name(pattern, false) {
        return false;
    }

    if pattern[0] == b'*' {
        // RFC 6125 Section 6.4.3: Wildcard must match exactly one label.
        // Enforce "*." prefix (wildcard must be leftmost and followed by a dot).
        if pattern.len() >= 2 && pattern[1] == b'.' {
            let suffix = &pattern[2..];
            // Disallow "*.tld" (suffix must contain at least one dot for proper domain hierarchy)
            if strings::index_of_char(suffix, b'.').is_some() {
                // Host must be at least "label.suffix" (suffix_len + 1 for dot + at least 1 char for label)
                if hostname.len() > suffix.len() + 1 {
                    let dot_index = hostname.len() - suffix.len() - 1;
                    // The character before suffix must be a dot, and there must be no other
                    // dots in the prefix (single-label wildcard only).
                    if hostname[dot_index] == b'.'
                        && strings::index_of_char(&hostname[..dot_index], b'.').is_none()
                    {
                        let host_suffix = &hostname[dot_index + 1..];
                        // RFC 4343: DNS names are case-insensitive
                        if strings::eql_case_insensitive_ascii(suffix, host_suffix, true) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    // RFC 4343: DNS names are case-insensitive
    strings::eql_case_insensitive_ascii(pattern, hostname, true)
}

pub fn check_x509_server_identity(x509: &mut boring::X509, hostname: &[u8]) -> bool {
    let host_is_ip = strings::is_ip_address(hostname);
    // Node.js: CN is consulted only when the certificate carries no
    // DNS / IP / URI subjectAltName entries. Track whether any were seen.
    let mut has_identifier_san = false;

    // we check with native code if the cert is valid
    // SAFETY: x509 is a valid &mut so non-null/aligned; all boring:: fns are
    // null-safe where documented.
    unsafe {
        let x509: *mut boring::X509 = x509;
        let index = boring::X509_get_ext_by_NID(x509, boring::NID_subject_alt_name, -1);
        if index >= 0 {
            // we can check hostname
            if let Some(ext) = boring::X509_get_ext(x509, index).as_mut() {
                let method = boring::X509V3_EXT_get(ext);
                if method != boring::X509V3_EXT_get_nid(boring::NID_subject_alt_name) {
                    return false;
                }

                // we safely ensure buffer size with max len + 1
                let mut canonical_ip_buf = [0u8; INET6_ADDRSTRLEN + 1];
                let mut cert_ip_buf = [0u8; INET6_ADDRSTRLEN + 1];
                // we try to canonicalize the IP before comparing (only when host is an IP literal)
                let host_ip: Option<&[u8]> = if host_is_ip {
                    Some(canonicalize_ip(hostname, &mut canonical_ip_buf).unwrap_or(hostname))
                } else {
                    None
                };

                let names_ = boring::X509V3_EXT_d2i(ext);
                if !names_.is_null() {
                    let names = names_.cast::<boring::struct_stack_st_GENERAL_NAME>();
                    let _guard = scopeguard::guard(names, |n| {
                        // SAFETY: `n` was returned by X509V3_EXT_d2i above and is non-null.
                        unsafe { boring::sk_GENERAL_NAME_pop_free(n, boring::sk_GENERAL_NAME_free) }
                    });
                    for i in 0..boring::sk_GENERAL_NAME_num(names) {
                        let r#gen = boring::sk_GENERAL_NAME_value(names, i);
                        if let Some(name) = r#gen.as_ref() {
                            // TODO(port): name_type discriminants — verify GEN_* are c_int consts in bun_boringssl_sys
                            match name.name_type {
                                boring::GEN_URI => {
                                    has_identifier_san = true;
                                }
                                boring::GEN_DNS => {
                                    has_identifier_san = true;
                                    if !host_is_ip {
                                        let dns_name = &*name.d.dNSName;
                                        let dns_name_slice = core::slice::from_raw_parts(
                                            dns_name.data,
                                            usize::try_from(dns_name.length).expect("int cast"),
                                        );
                                        if match_dns_name(dns_name_slice, hostname) {
                                            return true;
                                        }
                                    }
                                }
                                boring::GEN_IPADD => {
                                    has_identifier_san = true;
                                    if let Some(hip) = host_ip {
                                        if let Some(cert_ip) =
                                            ip2_string(&*name.d.ip, &mut cert_ip_buf)
                                        {
                                            if hip == cert_ip {
                                                return true;
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        // Node.js tls.checkServerIdentity: when the certificate has no
        // DNS/IP/URI subjectAltName entries, fall back to the Subject
        // Common Name. Never for IP-literal hosts (RFC 2818 §3.1).
        if !host_is_ip && !has_identifier_san {
            let subject = boring::X509_get_subject_name(x509);
            if !subject.is_null() {
                let mut last: c_int = -1;
                loop {
                    let entry_idx =
                        boring::X509_NAME_get_index_by_NID(subject, boring::NID_commonName, last);
                    if entry_idx < 0 {
                        break;
                    }
                    last = entry_idx;
                    let entry = boring::X509_NAME_get_entry(subject, entry_idx);
                    if entry.is_null() {
                        continue;
                    }
                    let data = boring::X509_NAME_ENTRY_get_data(entry);
                    if data.is_null() {
                        continue;
                    }
                    let cn_ptr = boring::ASN1_STRING_get0_data(data);
                    let cn_len = boring::ASN1_STRING_length(data);
                    if cn_ptr.is_null() || cn_len <= 0 {
                        continue;
                    }
                    let cn = core::slice::from_raw_parts(
                        cn_ptr,
                        usize::try_from(cn_len).expect("int cast"),
                    );
                    if match_dns_name(cn, hostname) {
                        return true;
                    }
                }
            }
        }
    }

    false
}

pub fn check_server_identity(ssl_ptr: &mut boring::SSL, hostname: &[u8]) -> bool {
    // SAFETY: ssl_ptr is a valid &mut so non-null/aligned; sk_X509_value returns
    // a borrowed cert pointer valid for the lifetime of the chain.
    unsafe {
        let cert_chain = boring::SSL_get_peer_cert_chain(std::ptr::from_mut(ssl_ptr));
        if !cert_chain.is_null() {
            let x509 = boring::sk_X509_value(cert_chain, 0);
            if let Some(x509) = x509.as_mut() {
                return check_x509_server_identity(x509, hostname);
            }
        }
    }
    false
}

// NOTE: `pub const ERR_toJS = @import("../runtime/crypto/boringssl_jsc.zig").ERR_toJS;`
// is intentionally dropped — *_jsc alias; in Rust the JS conversion lives in the
// `bun_runtime`/`*_jsc` crate as an extension method.

// ported from: src/boringssl/boringssl.zig
