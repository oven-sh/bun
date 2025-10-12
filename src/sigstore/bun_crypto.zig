const std = @import("std");
const bun = @import("bun");
const BoringSSL = bun.BoringSSL.c;

pub const SigstoreError = error{
    KeyGenerationFailed,
    SigningFailed,
    CertificateParsingFailed,
    InvalidSignature,
    OutOfMemory,
};

/// Simplified ephemeral key pair using Bun's crypto patterns
pub const EphemeralKeyPair = struct {
    pkey: *BoringSSL.EVP_PKEY,
    allocator: std.mem.Allocator,

    pub fn generate(allocator: std.mem.Allocator) SigstoreError!EphemeralKeyPair {
        bun.BoringSSL.load();

        // Use pattern from Bun's WebCrypto implementation
        const ctx = BoringSSL.EVP_PKEY_CTX_new_id(BoringSSL.EVP_PKEY_EC, null) orelse return SigstoreError.KeyGenerationFailed;
        defer BoringSSL.EVP_PKEY_CTX_free(ctx);

        if (BoringSSL.EVP_PKEY_keygen_init(ctx) != 1) return SigstoreError.KeyGenerationFailed;
        if (BoringSSL.EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx, BoringSSL.NID_X9_62_prime256v1) != 1) return SigstoreError.KeyGenerationFailed;

        var pkey: ?*BoringSSL.EVP_PKEY = null;
        if (BoringSSL.EVP_PKEY_keygen(ctx, &pkey) != 1) return SigstoreError.KeyGenerationFailed;

        return EphemeralKeyPair{
            .pkey = pkey.?,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *EphemeralKeyPair) void {
        BoringSSL.EVP_PKEY_free(self.pkey);
    }

    pub fn signData(self: *const EphemeralKeyPair, data: []const u8) SigstoreError![]const u8 {
        // Use ECDSA signing pattern from Bun's WebCrypto
        const ctx = BoringSSL.EVP_PKEY_CTX_new(self.pkey, null) orelse return SigstoreError.SigningFailed;
        defer BoringSSL.EVP_PKEY_CTX_free(ctx);

        if (BoringSSL.EVP_PKEY_sign_init(ctx) != 1) return SigstoreError.SigningFailed;

        var sig_len: usize = 0;
        if (BoringSSL.EVP_PKEY_sign(ctx, null, &sig_len, data.ptr, data.len) != 1) return SigstoreError.SigningFailed;

        const signature = try self.allocator.alloc(u8, sig_len);
        if (BoringSSL.EVP_PKEY_sign(ctx, signature.ptr, &sig_len, data.ptr, data.len) != 1) {
            self.allocator.free(signature);
            return SigstoreError.SigningFailed;
        }

        return signature[0..sig_len];
    }
};

/// Compatibility wrapper for SigningContext (simplified from original)
pub const SigningContext = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) SigningContext {
        return SigningContext{ .allocator = allocator };
    }

    pub fn signPayload(self: *const SigningContext, keypair: *const EphemeralKeyPair, payload: []const u8) SigstoreError![]const u8 {
        return keypair.signData(payload);
    }
};

/// Certificate parsing using ncrypto patterns
pub const CertificateParser = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) CertificateParser {
        return CertificateParser{ .allocator = allocator };
    }

    pub fn parsePEM(self: *const CertificateParser, pem_data: []const u8) SigstoreError!*BoringSSL.X509 {
        _ = self;
        bun.BoringSSL.load();

        // Use the same pattern as ncrypto.cpp
        const bio = BoringSSL.BIO_new_mem_buf(pem_data.ptr, @intCast(pem_data.len)) orelse return SigstoreError.OutOfMemory;
        defer BoringSSL.BIO_free(bio);

        const cert = BoringSSL.PEM_read_bio_X509(bio, null, null, null) orelse return SigstoreError.CertificateParsingFailed;
        return cert;
    }

    pub fn extractSubjectAltName(self: *const CertificateParser, cert: *BoringSSL.X509) SigstoreError!?[]const u8 {
        const san_ext = BoringSSL.X509_get_ext_d2i(cert, BoringSSL.NID_subject_alt_name, null, null);
        if (san_ext == null) return null;

        // This is a simplified extraction - in production you'd want more robust SAN parsing
        const san_names = @as(*BoringSSL.GENERAL_NAMES, @ptrCast(san_ext));
        const name_count = BoringSSL.sk_GENERAL_NAME_num(san_names);

        if (name_count > 0) {
            const general_name = BoringSSL.sk_GENERAL_NAME_value(san_names, 0);
            if (BoringSSL.GENERAL_NAME_get0_value(general_name, null)) |asn1_string| {
                const data_ptr = BoringSSL.ASN1_STRING_get0_data(asn1_string);
                const data_len = BoringSSL.ASN1_STRING_length(asn1_string);
                
                const result = try self.allocator.alloc(u8, @intCast(data_len));
                @memcpy(result, @as([*]const u8, @ptrCast(data_ptr))[0..@intCast(data_len)]);
                return result;
            }
        }

        return null;
    }

    pub fn getCertificatePEM(self: *const CertificateParser, cert: *BoringSSL.X509) SigstoreError![]const u8 {
        const bio = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse return SigstoreError.OutOfMemory;
        defer BoringSSL.BIO_free(bio);

        if (BoringSSL.PEM_write_bio_X509(bio, cert) != 1) return SigstoreError.CertificateParsingFailed;

        var cert_data: [*c]u8 = undefined;
        const cert_len = BoringSSL.BIO_get_mem_data(bio, &cert_data);

        const result = try self.allocator.alloc(u8, @intCast(cert_len));
        @memcpy(result, cert_data[0..@intCast(cert_len)]);
        return result;
    }
};

/// Generate CSR for certificate request
pub fn generateCSR(allocator: std.mem.Allocator, keypair: *const EphemeralKeyPair, subject_email: []const u8) SigstoreError![]const u8 {
    bun.BoringSSL.load();

    const req = BoringSSL.X509_REQ_new() orelse return SigstoreError.OutOfMemory;
    defer BoringSSL.X509_REQ_free(req);

    // Set version
    if (BoringSSL.X509_REQ_set_version(req, 0) != 1) return SigstoreError.KeyGenerationFailed;

    // Set subject name with email
    const name = BoringSSL.X509_REQ_get_subject_name(req);
    if (BoringSSL.X509_NAME_add_entry_by_txt(name, "emailAddress", BoringSSL.MBSTRING_ASC, subject_email.ptr, @intCast(subject_email.len), -1, 0) != 1) {
        return SigstoreError.KeyGenerationFailed;
    }

    // Set public key
    if (BoringSSL.X509_REQ_set_pubkey(req, keypair.pkey) != 1) return SigstoreError.KeyGenerationFailed;

    // Sign the request
    if (BoringSSL.X509_REQ_sign(req, keypair.pkey, BoringSSL.EVP_sha256()) == 0) return SigstoreError.SigningFailed;

    // Convert to PEM
    const bio = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse return SigstoreError.OutOfMemory;
    defer BoringSSL.BIO_free(bio);

    if (BoringSSL.PEM_write_bio_X509_REQ(bio, req) != 1) return SigstoreError.KeyGenerationFailed;

    var csr_data: [*c]u8 = undefined;
    const csr_len = BoringSSL.BIO_get_mem_data(bio, &csr_data);

    const result = try allocator.alloc(u8, @intCast(csr_len));
    @memcpy(result, csr_data[0..@intCast(csr_len)]);
    return result;
}

@import("bun")