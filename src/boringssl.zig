// TODO: move all custom functions from the translated file into this file, then
// the translated file can be provided by `zig translate-c`
/// BoringSSL's translated C API
pub const c = boring;

var loaded = false;
pub fn load() void {
    if (loaded) return;
    loaded = true;
    boring.CRYPTO_library_init();
    bun.assert(boring.SSL_library_init() > 0);
    boring.SSL_load_error_strings();
    boring.ERR_load_BIO_strings();
    boring.OpenSSL_add_all_algorithms();

    if (!builtin.is_test) {
        std.mem.doNotOptimizeAway(&OPENSSL_memory_alloc);
        std.mem.doNotOptimizeAway(&OPENSSL_memory_get_size);
        std.mem.doNotOptimizeAway(&OPENSSL_memory_free);
    }
}

var ctx_store: ?*boring.SSL_CTX = null;
pub fn initClient() *boring.SSL {
    if (ctx_store != null) _ = boring.SSL_CTX_up_ref(ctx_store.?);

    const ctx = ctx_store orelse brk: {
        ctx_store = boring.SSL_CTX.init().?;
        break :brk ctx_store.?;
    };

    var ssl = boring.SSL.init(ctx);
    ssl.setIsClient(true);

    return ssl;
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

export fn OPENSSL_memory_alloc(size: usize) ?*anyopaque {
    return bun.mimalloc.mi_malloc(size);
}

// BoringSSL always expects memory to be zero'd
export fn OPENSSL_memory_free(ptr: *anyopaque) void {
    const len = bun.mimalloc.mi_usable_size(ptr);
    @memset(@as([*]u8, @ptrCast(ptr))[0..len], 0);
    bun.mimalloc.mi_free(ptr);
}

export fn OPENSSL_memory_get_size(ptr: ?*const anyopaque) usize {
    return bun.mimalloc.mi_usable_size(ptr);
}

const INET6_ADDRSTRLEN = if (bun.Environment.isWindows) 65 else 46;

/// converts IP string to canonicalized IP string
/// return null when the IP is invalid
pub fn canonicalizeIP(addr_str: []const u8, outIP: *[INET6_ADDRSTRLEN + 1]u8) ?[]const u8 {
    if (addr_str.len >= INET6_ADDRSTRLEN) {
        return null;
    }
    var ip_std_text: [INET6_ADDRSTRLEN + 1]u8 = undefined;
    // we need a null terminated string as input
    bun.copy(u8, outIP, addr_str);
    outIP[addr_str.len] = 0;

    var af: c_int = std.posix.AF.INET;
    // get the standard text representation of the IP
    if (c_ares.ares_inet_pton(af, outIP, &ip_std_text) <= 0) {
        af = std.posix.AF.INET6;
        if (c_ares.ares_inet_pton(af, outIP, &ip_std_text) <= 0) {
            return null;
        }
    }
    // ip_addr will contain the null-terminated string of the cannonicalized IP
    if (c_ares.ares_inet_ntop(af, &ip_std_text, outIP, outIP.len) == null) {
        return null;
    }
    // use the null-terminated size to return the string
    const size = bun.len(bun.cast([*:0]u8, outIP));
    return outIP[0..size];
}

/// converts ASN1_OCTET_STRING to canonicalized IP string
/// return null when the IP is invalid
pub fn ip2String(ip: *boring.ASN1_OCTET_STRING, outIP: *[INET6_ADDRSTRLEN + 1]u8) ?[]const u8 {
    const af: c_int = if (ip.length == 4) std.posix.AF.INET else std.posix.AF.INET6;
    if (c_ares.ares_inet_ntop(af, ip.data, outIP, outIP.len) == null) {
        return null;
    }

    // use the null-terminated size to return the string
    const size = bun.len(bun.cast([*:0]u8, outIP));
    return outIP[0..size];
}

pub fn checkX509ServerIdentity(
    x509: *boring.X509,
    hostname: []const u8,
) bool {
    // we check with native code if the cert is valid
    const index = boring.X509_get_ext_by_NID(x509, boring.NID_subject_alt_name, -1);
    if (index >= 0) {
        // we can check hostname
        if (boring.X509_get_ext(x509, index)) |ext| {
            const method = boring.X509V3_EXT_get(ext);
            if (method != boring.X509V3_EXT_get_nid(boring.NID_subject_alt_name)) {
                return false;
            }

            if (strings.isIPAddress(hostname)) {
                // we safely ensure buffer size with max len + 1
                var canonicalIPBuf: [INET6_ADDRSTRLEN + 1]u8 = undefined;
                var certIPBuf: [INET6_ADDRSTRLEN + 1]u8 = undefined;
                // we try to canonicalize the IP before comparing
                const host_ip = canonicalizeIP(hostname, &canonicalIPBuf) orelse hostname;

                if (boring.X509V3_EXT_d2i(ext)) |names_| {
                    const names: *boring.struct_stack_st_GENERAL_NAME = bun.cast(*boring.struct_stack_st_GENERAL_NAME, names_);
                    defer boring.sk_GENERAL_NAME_pop_free(names, boring.sk_GENERAL_NAME_free);
                    for (0..boring.sk_GENERAL_NAME_num(names)) |i| {
                        const gen = boring.sk_GENERAL_NAME_value(names, i);
                        if (gen) |name| {
                            if (name.name_type == .GEN_IPADD) {
                                if (ip2String(name.d.ip, &certIPBuf)) |cert_ip| {
                                    if (strings.eql(host_ip, cert_ip)) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                if (boring.X509V3_EXT_d2i(ext)) |names_| {
                    const names: *boring.struct_stack_st_GENERAL_NAME = bun.cast(*boring.struct_stack_st_GENERAL_NAME, names_);
                    defer boring.sk_GENERAL_NAME_pop_free(names, boring.sk_GENERAL_NAME_free);
                    for (0..boring.sk_GENERAL_NAME_num(names)) |i| {
                        const gen = boring.sk_GENERAL_NAME_value(names, i);
                        if (gen) |name| {
                            if (name.name_type == .GEN_DNS) {
                                const dnsName = name.d.dNSName;
                                var dnsNameSlice = dnsName.data[0..@as(usize, @intCast(dnsName.length))];
                                // ignore empty dns names (should never happen)
                                if (dnsNameSlice.len > 0) {
                                    if (X509.isSafeAltName(dnsNameSlice, false)) {
                                        if (dnsNameSlice[0] == '*') {
                                            // RFC 6125 Section 6.4.3: Wildcard must match exactly one label
                                            // Enforce "*." prefix (wildcards must be leftmost and followed by a dot)
                                            if (dnsNameSlice.len >= 2 and dnsNameSlice[1] == '.') {
                                                const suffix = dnsNameSlice[2..];
                                                // Disallow "*.tld" (suffix must contain at least one dot for proper domain hierarchy)
                                                if (std.mem.indexOfScalar(u8, suffix, '.') != null) {
                                                    // Host must be at least "label.suffix" (suffix_len + 1 for dot + at least 1 char for label)
                                                    if (hostname.len > suffix.len + 1) {
                                                        const dot_index = hostname.len - suffix.len - 1;
                                                        // The character before suffix must be a dot, and there must be no other dots
                                                        // in the prefix (single-label wildcard only)
                                                        if (hostname[dot_index] == '.' and std.mem.indexOfScalar(u8, hostname[0..dot_index], '.') == null) {
                                                            const host_suffix = hostname[dot_index + 1 ..];
                                                            // RFC 4343: DNS names are case-insensitive
                                                            if (strings.eqlCaseInsensitiveASCII(suffix, host_suffix, true)) {
                                                                return true;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        // RFC 4343: DNS names are case-insensitive
                                        if (strings.eqlCaseInsensitiveASCII(dnsNameSlice, hostname, true)) {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return false;
}

pub fn checkServerIdentity(
    ssl_ptr: *boring.SSL,
    hostname: []const u8,
) bool {
    if (boring.SSL_get_peer_cert_chain(ssl_ptr)) |cert_chain| {
        if (boring.sk_X509_value(cert_chain, 0)) |x509| {
            return checkX509ServerIdentity(x509, hostname);
        }
    }
    return false;
}

pub fn ERR_toJS(globalThis: *jsc.JSGlobalObject, err_code: u32) jsc.JSValue {
    var outbuf: [128 + 1 + "BoringSSL ".len]u8 = undefined;
    @memset(&outbuf, 0);
    outbuf[0.."BoringSSL ".len].* = "BoringSSL ".*;
    const message_buf = outbuf["BoringSSL ".len..];

    _ = boring.ERR_error_string_n(err_code, message_buf, message_buf.len);

    const error_message: []const u8 = bun.sliceTo(outbuf[0..], 0);
    if (error_message.len == "BoringSSL ".len) {
        return globalThis.ERR(.BORINGSSL, "An unknown BoringSSL error occurred: {d}", .{err_code}).toJS();
    }

    return globalThis.ERR(.BORINGSSL, "{s}", .{error_message}).toJS();
}

const X509 = @import("./bun.js/api/bun/x509.zig");
const boring = @import("./deps/boringssl.translated.zig");
const builtin = @import("builtin");
const c_ares = @import("./deps/c_ares.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;
