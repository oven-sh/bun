// TODO: move all custom functions from the translated file into this file, then
// the translated file can be provided by `zig translate-c`

use core::ffi::{c_char, c_int, c_void};
use core::ffi::CStr;
use core::ptr;

use bun_boringssl_sys as boring;
use bun_cares_sys as c_ares;
use bun_str::strings;

// MOVE_DOWN: bun_runtime::api::bun::x509::is_safe_alt_name → boringssl (this crate).
// TODO(b0): is_safe_alt_name body arrives from move-in (src/runtime/api/bun/x509.rs).
pub mod x509 {
    #[allow(unused_variables)]
    pub fn is_safe_alt_name(name: &[u8], utf8: bool) -> bool {
        unimplemented!("TODO(b0): pending move-in from bun_runtime::api::bun::x509")
    }
}
use x509 as X509;

/// BoringSSL's translated C API
pub use bun_boringssl_sys as c;

static mut LOADED: bool = false;

pub fn load() {
    // SAFETY: matches Zig's non-atomic global; callers are expected to invoke
    // this on a single thread during startup before any concurrent BoringSSL use.
    unsafe {
        if LOADED {
            return;
        }
        LOADED = true;
        boring::CRYPTO_library_init();
        debug_assert!(boring::SSL_library_init() > 0);
        boring::SSL_load_error_strings();
        boring::ERR_load_BIO_strings();
        boring::OpenSSL_add_all_algorithms();
    }

    if !cfg!(test) {
        core::hint::black_box(OPENSSL_memory_alloc as *const ());
        core::hint::black_box(OPENSSL_memory_get_size as *const ());
        core::hint::black_box(OPENSSL_memory_free as *const ());
    }
}

static mut CTX_STORE: Option<*mut boring::SSL_CTX> = None;

pub fn init_client() -> *mut boring::SSL {
    // SAFETY: matches Zig's non-atomic global; single-threaded startup assumption.
    unsafe {
        if let Some(ctx) = CTX_STORE {
            let _ = boring::SSL_CTX_up_ref(ctx);
        }

        let ctx = match CTX_STORE {
            Some(ctx) => ctx,
            None => 'brk: {
                CTX_STORE = Some(boring::SSL_CTX::init().expect("SSL_CTX::init"));
                break 'brk CTX_STORE.unwrap();
            }
        };

        let ssl = boring::SSL::init(ctx);
        (*ssl).set_is_client(true);

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
        let len = bun_alloc::mimalloc::mi_usable_size(ptr);
        ptr::write_bytes(ptr.cast::<u8>(), 0, len);
        bun_alloc::mimalloc::mi_free(ptr);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn OPENSSL_memory_get_size(ptr: *const c_void) -> usize {
    // SAFETY: ptr was returned by mi_malloc (or is null, which mi_usable_size handles).
    unsafe { bun_alloc::mimalloc::mi_usable_size(ptr) }
}

#[cfg(windows)]
const INET6_ADDRSTRLEN: usize = 65;
#[cfg(not(windows))]
const INET6_ADDRSTRLEN: usize = 46;

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

    // TODO(port): AF_INET / AF_INET6 constants — verify bun_sys exposes these
    let mut af: c_int = bun_sys::AF_INET;
    // get the standard text representation of the IP
    // SAFETY: out_ip is NUL-terminated above; ip_std_text is large enough for any address.
    unsafe {
        if c_ares::ares_inet_pton(af, out_ip.as_ptr().cast(), ip_std_text.as_mut_ptr().cast()) <= 0 {
            af = bun_sys::AF_INET6;
            if c_ares::ares_inet_pton(af, out_ip.as_ptr().cast(), ip_std_text.as_mut_ptr().cast()) <= 0 {
                return None;
            }
        }
        // ip_addr will contain the null-terminated string of the cannonicalized IP
        if c_ares::ares_inet_ntop(
            af,
            ip_std_text.as_ptr().cast(),
            out_ip.as_mut_ptr().cast(),
            out_ip.len(),
        )
        .is_null()
        {
            return None;
        }
    }
    // use the null-terminated size to return the string
    // SAFETY: ares_inet_ntop wrote a NUL-terminated string into out_ip on success.
    let size = unsafe { CStr::from_ptr(out_ip.as_ptr().cast::<c_char>()) }
        .to_bytes()
        .len();
    Some(&out_ip[..size])
}

/// converts ASN1_OCTET_STRING to canonicalized IP string
/// return null when the IP is invalid
pub fn ip2_string<'a>(
    ip: &boring::ASN1_OCTET_STRING,
    out_ip: &'a mut [u8; INET6_ADDRSTRLEN + 1],
) -> Option<&'a [u8]> {
    let af: c_int = if ip.length == 4 {
        bun_sys::AF_INET
    } else {
        bun_sys::AF_INET6
    };
    // SAFETY: ip.data points to ip.length bytes; out_ip is INET6_ADDRSTRLEN+1 bytes.
    unsafe {
        if c_ares::ares_inet_ntop(af, ip.data.cast(), out_ip.as_mut_ptr().cast(), out_ip.len())
            .is_null()
        {
            return None;
        }
    }

    // use the null-terminated size to return the string
    // SAFETY: ares_inet_ntop wrote a NUL-terminated string into out_ip on success.
    let size = unsafe { CStr::from_ptr(out_ip.as_ptr().cast::<c_char>()) }
        .to_bytes()
        .len();
    Some(&out_ip[..size])
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

                if host_is_ip {
                    // we safely ensure buffer size with max len + 1
                    let mut canonical_ip_buf = [0u8; INET6_ADDRSTRLEN + 1];
                    let mut cert_ip_buf = [0u8; INET6_ADDRSTRLEN + 1];
                    // we try to canonicalize the IP before comparing
                    let host_ip: &[u8] =
                        canonicalize_ip(hostname, &mut canonical_ip_buf).unwrap_or(hostname);

                    let names_ = boring::X509V3_EXT_d2i(ext);
                    if !names_.is_null() {
                        let names = names_.cast::<boring::struct_stack_st_GENERAL_NAME>();
                        let _guard = scopeguard::guard(names, |n| {
                            boring::sk_GENERAL_NAME_pop_free(n, boring::sk_GENERAL_NAME_free)
                        });
                        for i in 0..boring::sk_GENERAL_NAME_num(names) {
                            let gen = boring::sk_GENERAL_NAME_value(names, i);
                            if let Some(name) = gen.as_ref() {
                                // TODO(port): name_type discriminants — verify GEN_* are c_int consts in bun_boringssl_sys
                                match name.name_type {
                                    boring::GEN_DNS | boring::GEN_URI => {
                                        has_identifier_san = true;
                                    }
                                    boring::GEN_IPADD => {
                                        has_identifier_san = true;
                                        if let Some(cert_ip) =
                                            ip2_string(&*name.d.ip, &mut cert_ip_buf)
                                        {
                                            if host_ip == cert_ip {
                                                return true;
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                } else {
                    let names_ = boring::X509V3_EXT_d2i(ext);
                    if !names_.is_null() {
                        let names = names_.cast::<boring::struct_stack_st_GENERAL_NAME>();
                        let _guard = scopeguard::guard(names, |n| {
                            boring::sk_GENERAL_NAME_pop_free(n, boring::sk_GENERAL_NAME_free)
                        });
                        for i in 0..boring::sk_GENERAL_NAME_num(names) {
                            let gen = boring::sk_GENERAL_NAME_value(names, i);
                            if let Some(name) = gen.as_ref() {
                                match name.name_type {
                                    boring::GEN_IPADD | boring::GEN_URI => {
                                        has_identifier_san = true;
                                    }
                                    boring::GEN_DNS => {
                                        has_identifier_san = true;
                                        let dns_name = &*name.d.dNSName;
                                        let dns_name_slice = core::slice::from_raw_parts(
                                            dns_name.data,
                                            usize::try_from(dns_name.length).unwrap(),
                                        );
                                        if match_dns_name(dns_name_slice, hostname) {
                                            return true;
                                        }
                                    }
                                    _ => {}
                                }
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
                    let cn =
                        core::slice::from_raw_parts(cn_ptr, usize::try_from(cn_len).unwrap());
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
        let cert_chain = boring::SSL_get_peer_cert_chain(ssl_ptr as *mut _);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/boringssl/boringssl.zig (272 lines)
//   confidence: medium
//   todos:      2
//   notes:      static mut globals match Zig (non-atomic); AF_INET/GEN_* constant paths need Phase B verification; scopeguard used for sk_GENERAL_NAME_pop_free defer
// ──────────────────────────────────────────────────────────────────────────
