pub const FulcioError = error{
    CertificateRequestFailed,
    InvalidResponse,
    UnauthorizedError,
    NetworkError,
    InvalidToken,
    OutOfMemory,
};

/// Certificate chain returned by Fulcio
pub const CertificateChain = struct {
    signing_cert: *bun.BoringSSL.c.X509,
    intermediate_certs: []const *bun.BoringSSL.c.X509,
    root_cert: ?*bun.BoringSSL.c.X509,
    sct: ?[]const u8, // Signed Certificate Timestamp
    allocator: std.mem.Allocator,

    pub fn deinit(self: *CertificateChain) void {
        bun.BoringSSL.c.X509_free(self.signing_cert);
        
        for (self.intermediate_certs) |cert| {
            bun.BoringSSL.c.X509_free(cert);
        }
        self.allocator.free(self.intermediate_certs);
        
        if (self.root_cert) |root| {
            bun.BoringSSL.c.X509_free(root);
        }
        
        if (self.sct) |sct| {
            self.allocator.free(sct);
        }
    }

    pub fn getSigningCertPEM(self: *const CertificateChain) FulcioError![]const u8 {
        const parser = crypto.CertificateParser.init(self.allocator);
        return parser.getCertificatePEM(self.signing_cert) catch FulcioError.InvalidResponse;
    }

    pub fn getSigningCertDER(self: *const CertificateChain) FulcioError![]const u8 {
        const parser = crypto.CertificateParser.init(self.allocator);
        return parser.getCertificateDER(self.signing_cert) catch FulcioError.InvalidResponse;
    }
};

/// Certificate signing request for Fulcio
pub const CertificateRequest = struct {
    csr_pem: []const u8,
    oidc_token: []const u8,
    audience: []const u8,
    allocator: std.mem.Allocator,

    pub fn init(
        allocator: std.mem.Allocator,
        keypair: *const crypto.EphemeralKeyPair,
        token: *const oidc.OIDCToken,
        subject_email: []const u8,
    ) FulcioError!CertificateRequest {
        const csr_pem = crypto.generateCSR(allocator, keypair, subject_email) catch return FulcioError.CertificateRequestFailed;
        
        return CertificateRequest{
            .csr_pem = csr_pem,
            .oidc_token = token.token,
            .audience = token.audience orelse "sigstore",
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *CertificateRequest) void {
        self.allocator.free(self.csr_pem);
    }

    pub fn toJSON(self: *const CertificateRequest) FulcioError![]const u8 {
        // Escape the PEM data for JSON
        var escaped_csr = std.ArrayList(u8).init(self.allocator);
        defer escaped_csr.deinit();
        
        for (self.csr_pem) |c| {
            switch (c) {
                '\n' => try escaped_csr.appendSlice("\\n"),
                '"' => try escaped_csr.appendSlice("\\\""),
                '\\' => try escaped_csr.appendSlice("\\\\"),
                else => try escaped_csr.append(c),
            }
        }

        return std.fmt.allocPrint(self.allocator,
            \\{{"certificateSigningRequest":"{s}","audience":"{s}"}}
        , .{ escaped_csr.items, self.audience });
    }
};

/// Fulcio certificate authority client
pub const FulcioClient = struct {
    base_url: []const u8,
    allocator: std.mem.Allocator,

    const DEFAULT_FULCIO_URL = "https://fulcio.sigstore.dev";

    pub fn init(allocator: std.mem.Allocator, base_url: ?[]const u8) FulcioClient {
        return FulcioClient{
            .base_url = base_url orelse DEFAULT_FULCIO_URL,
            .allocator = allocator,
        };
    }

    pub fn requestCertificate(
        self: *FulcioClient,
        request: *const CertificateRequest,
    ) FulcioError!CertificateChain {
        // Create JSON request body
        const request_json = CertificateRequest.toJSON(request) catch return FulcioError.CertificateRequestFailed;
        defer self.allocator.free(request_json);

        // Build request URL
        const url_str = try std.fmt.allocPrint(
            self.allocator,
            "{s}/api/v2/signingCert",
            .{self.base_url}
        );
        defer self.allocator.free(url_str);
        
        const url = URL.parse(url_str);

        // Set up headers
        var headers: http.HeaderBuilder = .{};
        headers.count("content-type", "application/json");
        headers.count("accept", "application/json");
        
        // Add authorization header
        const auth_header = try std.fmt.allocPrint(
            self.allocator,
            "Bearer {s}",
            .{request.oidc_token}
        );
        defer self.allocator.free(auth_header);
        headers.count("authorization", auth_header);

        try headers.allocate(self.allocator);
        defer headers.deinit();

        headers.append("content-type", "application/json");
        headers.append("accept", "application/json");
        headers.append("authorization", auth_header);

        // Prepare response buffer
        var response_buf = try MutableString.init(self.allocator, 4096);
        defer response_buf.deinit();

        // Make HTTP request
        var req = http.AsyncHTTP.initSync(
            self.allocator,
            .POST,
            url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            request_json,
            null,
            null,
            .follow,
        );

        const res = req.sendSync() catch return FulcioError.NetworkError;
        
        if (res.status_code != 200) {
            if (res.status_code == 401) {
                return FulcioError.UnauthorizedError;
            }
            return FulcioError.CertificateRequestFailed;
        }

        return self.parseCertificateResponse(response_buf.list.items);
    }
    
    fn createMockCertificateChain(self: *FulcioClient) FulcioError!CertificateChain {
        // Mock certificate PEM for testing
        const mock_cert_pem = 
            \\-----BEGIN CERTIFICATE-----
            \\MIICqDCCAi6gAwIBAgIUABCDEFGHIJKLMNOPQRSTUVWXYZabcjAKBggqhkjOPQQD
            \\AjBjMQswCQYDVQQGEwJVUzETMBEGA1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UEBwwN
            \\U2FuIEZyYW5jaXNjbzEQMA4GA1UECgwHU2lnc3RvcmUxFTATBgNVBAMMDHNpZ3N0
            \\b3JlLmRldjAeFw0yNDA3MTQxNTMwMDBaFw0yNDA3MTQxNjMwMDBaMGMxCzAJBgNV
            \\BAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNp
            \\c2NvMRAwDgYDVQQKDAdTaWdzdG9yZTEVMBMGA1UEAwwMc2lnc3RvcmUuZGV2MFYW
            \\EAYHKoZIzj0CAQYFK4EEAAoDQgAEtXXbUo2l3xF5pE3yKJIeGYgCqyJAo2l7pBzZ
            \\iKoV8tGvz/CuP3YcjRhyMF5V+xpHBb5wUuU0BSH4w8hGF3tChqOBzjCByzAdBgNV
            \\HQ4EFgQU2YtbKS5H4QfD8PgV7SpLKtL8iE0wHwYDVR0jBBgwFoAU2YtbKS5H4QfD
            \\8PgV7SpLKtL8iE0wDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwEgYD
            \\VR0lAQH/BAgwBgYEVR0lADAaBgNVHREEEzARgg9zaWdzdG9yZS1kZXYuY29tMAoG
            \\CCqGSM49BAMCA0gAMEUCIQD2tO+w1Q2L8K3yZRcD5R4QF6B3O7K+zP5nQ8z9L2m9
            \\dQIgKV9g1XjP4Q+F7H8yQ9Z2L1cF3K8O4X7z+9kL2O5I1Q4=
            \\-----END CERTIFICATE-----
            ;
        
        const cert_parser = crypto.CertificateParser.init(self.allocator);
        const signing_cert = cert_parser.parsePEM(mock_cert_pem) catch return FulcioError.InvalidResponse;
        
        return CertificateChain{
            .signing_cert = signing_cert,
            .intermediate_certs = try self.allocator.alloc(*bun.BoringSSL.c.X509, 0),
            .root_cert = null,
            .sct = null,
            .allocator = self.allocator,
        };
    }

    fn parseCertificateResponse(self: *FulcioClient, response_body: []const u8) FulcioError!CertificateChain {
        var parser = std.json.Parser.init(self.allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(response_body) catch return FulcioError.InvalidResponse;
        defer tree.deinit();

        if (tree.root != .object) return FulcioError.InvalidResponse;
        const obj = tree.root.object;

        // Extract signing certificate
        const signed_cert_embedded_sct = obj.get("signedCertificateEmbeddedSct") orelse 
            return FulcioError.InvalidResponse;
        
        if (signed_cert_embedded_sct != .string) return FulcioError.InvalidResponse;
        
        const cert_parser = crypto.CertificateParser.init(self.allocator);
        const signing_cert = cert_parser.parsePEM(signed_cert_embedded_sct.string) catch 
            return FulcioError.InvalidResponse;

        // Extract certificate chain
        var intermediate_certs = std.ArrayList(*bun.BoringSSL.c.X509).init(self.allocator);
        defer intermediate_certs.deinit();

        if (obj.get("chain")) |chain_obj| {
            if (chain_obj == .object) {
                if (chain_obj.object.get("certificates")) |certs_array| {
                    if (certs_array == .array) {
                        for (certs_array.array.items) |cert_item| {
                            if (cert_item == .string) {
                                if (cert_parser.parsePEM(cert_item.string)) |cert| {
                                    try intermediate_certs.append(cert);
                                } else |_| {
                                    // Failed to parse intermediate cert, continue
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Extract SCT if present
        var sct: ?[]const u8 = null;
        if (obj.get("sct")) |sct_obj| {
            if (sct_obj == .string) {
                sct = try self.allocator.dupe(u8, sct_obj.string);
            }
        }

        return CertificateChain{
            .signing_cert = signing_cert,
            .intermediate_certs = try intermediate_certs.toOwnedSlice(),
            .root_cert = null, // Fulcio doesn't return root cert in response
            .sct = sct,
            .allocator = self.allocator,
        };
    }

    pub fn validateCertificateChain(self: *FulcioClient, chain: *const CertificateChain) FulcioError!bool {
        _ = self;
        bun.BoringSSL.load();

        // Create certificate store
        const store = bun.BoringSSL.c.X509_STORE_new() orelse return FulcioError.OutOfMemory;
        defer bun.BoringSSL.c.X509_STORE_free(store);

        // Add intermediate certificates to store
        for (chain.intermediate_certs) |cert| {
            if (bun.BoringSSL.c.X509_STORE_add_cert(store, cert) != 1) {
                // Failed to add intermediate cert
                continue;
            }
        }

        // Create store context for verification
        const store_ctx = bun.BoringSSL.c.X509_STORE_CTX_new() orelse return FulcioError.OutOfMemory;
        defer bun.BoringSSL.c.X509_STORE_CTX_free(store_ctx);

        // Initialize verification context
        if (bun.BoringSSL.c.X509_STORE_CTX_init(store_ctx, store, chain.signing_cert, null) != 1) {
            return FulcioError.InvalidResponse;
        }

        // Verify the certificate chain
        const verify_result = bun.BoringSSL.c.X509_verify_cert(store_ctx);
        return verify_result == 1;
    }

    /// Get the subject alternative name from the certificate (contains the identity)
    pub fn extractIdentity(self: *FulcioClient, chain: *const CertificateChain) FulcioError![]const u8 {
        const cert_parser = crypto.CertificateParser.init(self.allocator);
        if (cert_parser.extractSubjectAltName(chain.signing_cert)) |san| {
            return san;
        } else |_| {
            return FulcioError.InvalidResponse;
        }
    }
};

/// High-level function to request a certificate from Fulcio
pub fn requestSigningCertificate(
    allocator: std.mem.Allocator,
    keypair: *const crypto.EphemeralKeyPair,
    token: *const oidc.OIDCToken,
    subject_email: []const u8,
    fulcio_url: ?[]const u8,
) FulcioError!CertificateChain {
    var client = FulcioClient.init(allocator, fulcio_url);
    
    var cert_request = CertificateRequest.init(allocator, keypair, token, subject_email) catch 
        return FulcioError.CertificateRequestFailed;
    defer cert_request.deinit();

    const chain = try client.requestCertificate(&cert_request);
    
    // Validate the certificate chain
    if (!client.validateCertificateChain(&chain) catch false) {
        var chain_copy = chain;
        chain_copy.deinit();
        return FulcioError.InvalidResponse;
    }

    return chain;
}

const std = @import("std");
const bun = @import("bun");
const crypto = @import("bun_crypto.zig");
const oidc = @import("oidc.zig");
const http = bun.http;
const MutableString = bun.MutableString;
const URL = bun.URL;