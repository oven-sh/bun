//! An X509 Certificate wrapping BoringSSL.
//!
//! This code is used by both `node:crypto` and other internal APIs, so its API
//! uses zig-native constructs instead of `JSValue`, etc.
//!
//! ## References
//! - [RFC 5280 - X509 Certificates](https://datatracker.ietf.org/doc/html/rfc5280)
//! - [RFC 1422 - PEM](https://www.rfc-editor.org/rfc/rfc1422)
//! - [BoringSSL API Docs - `x509.h`](https://commondatastorage.googleapis.com/chromium-boringssl-docs/x509.h.html)

const X509Certificate = @This();
const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
usingnamespace bun.BoringSSL;

// const X509 = BoringSSL.X509;

/// Do not access directly.
///
/// @internal
cert: *X509,

pub const Error = error{
    OutOfMemory,
    ParseErrorTODO,
};

/// Parse a PEM or DER encoded certificate from a buffer, usually obtained by
/// reading a file.
///
/// Buffer is borrowed and must outlive the returned certificate.
///
/// > NOTE: needed for Node API compat.
///
/// ## Parameters
/// - `buffer` - a PEM or DER encoded certificate.
pub fn parse(buffer: []const u8) Error!X509Certificate {
    // NOTE: if DER keys are common, we could optimize this by checking for
    // "-----BEGIN " before trying to read. If it is a DER, we save several
    // memory allocations plus iteration over the buffer (all w/in boringssl).
    // If we're wrong, we do this check twice. All that is to say it's only
    // worth it if DERs are common.
    var bio = try BIO.initReadonlyView(buffer);
    defer bio.deinit()();
 
    if (PEM_read_bio_X509_AUX(
        bio,
        null,
        noPasswordCallback,
        null,
    )) |pem| {
        return .{ .cert = pem };
    }
    bio.reset();

    const der = d2i_X509_bio(bio, null) orelse {
        // TODO: get error code using ERR_get_error() and convert it into an error union.
        return error.ParseErrorTODO;
    };
    return .{ .cert = der };
}

/// Create an `X509Certificate` from a BoringSSL `x509`. Meant for flexible
/// bun-internal use. Takes ownership of `certificate`.
pub fn init(certificate: *X509) X509Certificate {
    return .{ .cert = certificate };
}

/// Returns `true` if this is a certificate authority (CA) certificate.
/// 
/// NOTE: takes a mutable pointer for cache update and mutex locking purposes.
/// Actual certificate data will not be mutated.
pub fn getCa(self: *X509Certificate) bool {
    X509_check_ca(self) == 1;
}

pub fn getIssuer(self: X509Certificate) NameView {
    return .{ .inner = X509_get_issuer_name(self.cert) };
}

pub fn deinit(self: *X509Certificate) void {
    X509_free(self.cert);
    if (comptime builtin.mode == .Debug) {
        self.cert = undefined;
    }
}

/// Passing `null` to `password_cb` when reading a PEM uses a default
/// password-prompting callback, so this must be used instead of `null`. Node
/// does the same thing.
///
/// ```c
/// typedef int pem_password_cb(char *buf, int size, int rwflag, void *userdata);
/// ```
fn noPasswordCallback(buf: ?[*]u8, size: c_int, rwflag: c_int, userdata: ?*anyopaque) callconv(.C) c_int {
    return 0;
}

pub const NameView = struct {
    inner: ?*const X509_NAME,

    pub fn printEx(self: NameView) !void {
        var bio = try BIO.init();
        X509_NAME_print_ex()
    }
};

// bun.BoringSSL.X509_NAME
