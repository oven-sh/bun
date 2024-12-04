const std = @import("std");
const bun = @import("root").bun;

// jsc
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

// ssl
const BoringSSL = bun.BoringSSL;
const X509 = BoringSSL.X509;
const BIO = BoringSSL.BIO;
const Crypto = JSC.API.Bun.Crypto;

/// Provides read-only access to an X.509 certificate.
///
/// ## References
/// - [Node Docs - `X509Certificate](https://nodejs.org/api/crypto.html#class-x509certificate)
/// - [RFC 5280 - X509 Certificates](https://datatracker.ietf.org/doc/html/rfc5280)
/// - [RFC 1422 - PEM](https://www.rfc-editor.org/rfc/rfc1422)
/// - [BoringSSL API Docs - `x509.h`](https://commondatastorage.googleapis.com/chromium-boringssl-docs/x509.h.html)
pub const X509Certificate = struct {
    cert: *X509,

    const name = "X509Certificate";

    pub usingnamespace JSC.Codegen.JSX509Certificate;
    pub usingnamespace bun.New(@This());

    /// Create a new certificate from
    ///
    /// `new X509Certificate(buffer)`
    pub fn constructor(global: *JSGlobalObject, frame: *JSC.CallFrame) bun.JSError!*X509Certificate {
        if (frame.argumentsCount() != 1) return global.throwNotEnoughArguments(name, 1, frame.argumentsCount());
        var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
        const alloc = stack_fallback.get();

        // TODO: ensure buffer outlives the cert. Maybe store a reference?
        const buffer: JSC.Node.StringOrBuffer = blk: {
            const buffer_arg = frame.argument(0);
            if (!buffer_arg.isCell()) return global.throwInvalidArgumentTypeValue("buffer", "string, TypedArray, Buffer, or DataView", buffer_arg);
            break :blk JSC.Node.StringOrBuffer.fromJS(global, alloc, buffer_arg) orelse {
                return global.throwInvalidArgumentTypeValue("buffer", "string, TypedArray, Buffer, or DataView", buffer_arg);
            };
        };

        const cert = try parse(global, buffer.slice());
        return X509Certificate.new(cert);
    }

    pub fn getCa(this: *X509Certificate, _: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.cert.isCA());
    }

    /// ```cpp
    /// static constexpr int kX509NameFlagsMultiline =
    /// ASN1_STRFLGS_ESC_2253 | ASN1_STRFLGS_ESC_CTRL | ASN1_STRFLGS_UTF8_CONVERT |
    /// XN_FLAG_SEP_MULTILINE | XN_FLAG_FN_SN;
    /// ```
    const MULTILINE_FLAGS = BoringSSL.ASN1_STRFLGS_ESC_2253 | BoringSSL.ASN1_STRFLGS_ESC_CTRL | BoringSSL.ASN1_STRFLGS_UTF8_CONVERT | BoringSSL.XN_FLAG_SEP_MULTILINE | BoringSSL.XN_FLAG_FN_SN;

    pub fn getIssuer(this: *const X509Certificate, global: *JSGlobalObject) JSValue {
        defer BoringSSL.ERR_clear_error();

        const iss_name = this.cert.issuer() orelse return JSValue.jsUndefined();
        var iss_str: *BIO = iss_name.printEx(0, MULTILINE_FLAGS) catch {
            // Node suppresses these errors in their code, returning a null
            // pointer.  We do the same, but we want to catch these bugs in
            // tests and debug builds.
            if (comptime bun.Environment.isDebug) {
                @panic("X509Certificate.getIssuer: failed to print issuer name, meaning cert.issuer() somehow returned an uninitialized instance. See BIO_write in boringssl/crypto/bio/bio.cc:161 for details.");
            }
            return JSValue.jsUndefined();
        };
        defer iss_str.deinit();
        var iss = bun.String.createUTF8(iss_str.slice());
        return iss.transferToJS(global);
    }

    pub fn getSubject(this: *const X509Certificate, global: *JSGlobalObject) JSValue {
        defer BoringSSL.ERR_clear_error();

        const sub_name = this.cert.subject() orelse return JSValue.jsUndefined();
        var sub_str: *BIO = sub_name.printEx(0, MULTILINE_FLAGS) catch {
            // Node suppresses these errors in their code, returning a null
            // pointer.  We do the same, but we want to catch these bugs in
            // tests and debug builds.
            if (comptime bun.Environment.isDebug) {
                @panic("X509Certificate.getSubject: failed to print subuer name, meaning cert.subject() somehow returned an uninitialized instance. See BIO_write in boringssl/crypto/bio/bio.cc:161 for details.");
            }
            return JSValue.jsUndefined();
        };
        defer sub_str.deinit();
        var sub = bun.String.createUTF8(sub_str.slice());
        return sub.transferToJS(global);
    }

    /// Parse an X.509 certificate from a PEM or DER encoded buffer.
    ///
    /// `buffer` is not moved or copied, and must outlive the returned certificate.
    fn parse(global: *JSGlobalObject, buffer: []const u8) bun.JSError!X509Certificate {

        // NOTE: if DER keys are common, we could optimize this by checking for
        // "-----BEGIN " before trying to read. If it is a DER, we save several
        // memory allocations plus iteration over the buffer (all w/in boringssl).
        // If we're wrong, we do this check twice. All that is to say it's only
        // worth it if DERs are common.
        var bio = try BIO.initReadonlyView(buffer);
        defer bio.deinit();

        // PEM parsing pushes to error queue on failure. If `buffer` is a
        // DER, we need to clear the queue.
        defer BoringSSL.ERR_clear_error();

        if (X509.initPEM(bio)) |pem| {
            return .{ .cert = pem };
        }
        bio.reset();

        if (X509.initDER(bio)) |der| {
            return .{ .cert = der };
        }

        const err = Crypto.createCryptoError(global, BoringSSL.ERR_get_error());
        return global.throwValue(err);
    }

    pub fn finalize(self: *X509Certificate) void {
        self.cert.deinit();
    }
};
