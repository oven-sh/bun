const boring = @import("./deps/boringssl.translated.zig");
pub usingnamespace boring;
const std = @import("std");
const bun = @import("root").bun;
const c_ares = @import("./deps/c_ares.zig");
const strings = bun.strings;
const builtin = @import("builtin");
const X509 = @import("./bun.js/api/bun/x509.zig");

var loaded = false;
pub fn load() void {
    if (loaded) return;
    loaded = true;
    boring.CRYPTO_library_init();
    std.debug.assert(boring.SSL_library_init() > 0);
    boring.SSL_load_error_strings();
    boring.ERR_load_BIO_strings();
    boring.OpenSSL_add_all_algorithms();

    if (!builtin.is_test) {
        std.mem.doNotOptimizeAway(&OPENSSL_memory_alloc);
        std.mem.doNotOptimizeAway(&OPENSSL_memory_get_size);
        std.mem.doNotOptimizeAway(&OPENSSL_memory_free);
    }
}

var ctx_: ?*boring.SSL_CTX = null;
pub fn initClient() *boring.SSL {
    if (ctx_ != null) _ = boring.SSL_CTX_up_ref(ctx_.?);

    var ctx = ctx_ orelse brk: {
        ctx_ = boring.SSL_CTX.init().?;
        break :brk ctx_.?;
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
    return bun.Mimalloc.mi_malloc(size);
}

// BoringSSL always expects memory to be zero'd
export fn OPENSSL_memory_free(ptr: *anyopaque) void {
    const len = bun.Mimalloc.mi_usable_size(ptr);
    @memset(@as([*]u8, @ptrCast(ptr))[0..len], 0);
    bun.Mimalloc.mi_free(ptr);
}

export fn OPENSSL_memory_get_size(ptr: ?*const anyopaque) usize {
    return bun.Mimalloc.mi_usable_size(ptr);
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

    var af: c_int = std.os.AF.INET;
    // get the standard text representation of the IP
    if (c_ares.ares_inet_pton(af, outIP, &ip_std_text) != 1) {
        af = std.os.AF.INET6;
        if (c_ares.ares_inet_pton(af, outIP, &ip_std_text) != 1) {
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
    const af: c_int = if (ip.length == 4) std.os.AF.INET else std.os.AF.INET6;
    if (c_ares.ares_inet_ntop(af, ip.data, outIP, outIP.len) == null) {
        return null;
    }

    // use the null-terminated size to return the string
    const size = bun.len(bun.cast([*:0]u8, outIP));
    return outIP[0..size];
}

/// checks if a hostname matches a SAN or CN pattern
pub fn hostmatch(hostname: []const u8, pattern: []const u8) bool {
    // normalize hostname and pattern
    var host = hostname;
    var pat = pattern;
    if (host[host.len - 1] == '.') {
        host = host[0 .. host.len - 1];
    }
    if (pat[pat.len - 1] == '.') {
        pat = pat[0 .. pat.len - 1];
    }

    if (!strings.hasPrefixComptime(pat, "*.")) {
        // not a wildcard pattern, so the hostnames/IP address must match exactly.
        return strings.eqlInsensitive(host, pat);
    } else if (strings.isIPAddress(host)) {
        // IP address and wildcard pattern.
        return false;
    }

    // wildcard pattern.
    // we know the pattern starts with "*."
    if (strings.lastIndexOfChar(pat, '.') == 1) {
        // wildcard must have at least 2 period to be valid.
        // otherwise we could match too widely.
        // ex: "*.com"
        return false;
    }

    if (strings.indexOfChar(host, '.')) |host_label_end| {
        return strings.eqlInsensitive(host[host_label_end + 1 .. host.len], pat[2..pat.len]);
    }

    return false;
}

test "hostmatch" {
    try std.testing.expect(hostmatch("sub.bun.sh", "sub.bun.sh"));
    try std.testing.expect(hostmatch("sub.bun.sh.", "sub.bun.sh"));
    try std.testing.expect(hostmatch("sub.bun.sh.", "sub.BUN.sh."));
    try std.testing.expect(!hostmatch("sub.bun.sh", "bun.sh"));
    try std.testing.expect(hostmatch("sub.bun.sh", "*.bun.sh."));
    try std.testing.expect(!hostmatch("bun.sh", "*.bun.sh."));
    try std.testing.expect(hostmatch("127.0.0.1", "127.0.0.1"));
    try std.testing.expect(!hostmatch("127.0.0.1", "*.0.0.1"));
    try std.testing.expect(!hostmatch("bun.sh", "*.sh"));
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
                var host_ip = canonicalizeIP(hostname, &canonicalIPBuf) orelse hostname;

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
                                        if (hostmatch(hostname, dnsNameSlice)) {
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
    } else if (boring.X509_get_subject_name(x509)) |subject| {
        // if SAN is not present, check the CN.
        // get the position of the *last* CN field in the subject name field.
        var cn_index: c_int = -1;
        while (true) {
            const j = boring.X509_NAME_get_index_by_NID(subject, boring.NID_commonName, cn_index);
            if (j < 0) break;
            cn_index = j;
        }

        if (cn_index >= 0) {
            if (boring.X509_NAME_ENTRY_get_data(boring.X509_NAME_get_entry(subject, cn_index))) |asn1_str| {
                var peer_cn: ?[*:0]u8 = null;
                const peerlen = boring.ASN1_STRING_to_UTF8(&peer_cn, asn1_str);
                if (peer_cn) |cn_ptr| {
                    defer boring.OPENSSL_free(cn_ptr);

                    var cn: []u8 = cn_ptr[0..@as(usize, @intCast(peerlen))];
                    if (hostmatch(hostname, cn)) {
                        return true;
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

test "load" {
    load();
}
