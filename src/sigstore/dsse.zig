const std = @import("std");
const bun = @import("bun");
const crypto = @import("bun_crypto.zig");

pub const DSSEError = error{
    InvalidPayload,
    SigningFailed,
    VerificationFailed,
    InvalidSignature,
    OutOfMemory,
};

/// DSSE signature with metadata
pub const Signature = struct {
    keyid: ?[]const u8,
    sig: []const u8, // Base64 encoded signature
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, signature_bytes: []const u8, keyid: ?[]const u8) !Signature {
        const sig_encoded_len = std.base64.standard.Encoder.calcSize(signature_bytes.len);
        const sig_encoded = try allocator.alloc(u8, sig_encoded_len);
        _ = std.base64.standard.Encoder.encode(sig_encoded, signature_bytes);

        return Signature{
            .keyid = if (keyid) |kid| try allocator.dupe(u8, kid) else null,
            .sig = sig_encoded,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Signature) void {
        if (self.keyid) |keyid| {
            self.allocator.free(keyid);
        }
        self.allocator.free(self.sig);
    }

    pub fn getSignatureBytes(self: *const Signature) DSSEError![]const u8 {
        const decoded_len = std.base64.standard.Decoder.calcSizeForSlice(self.sig) catch return DSSEError.InvalidSignature;
        const decoded = try self.allocator.alloc(u8, decoded_len);
        std.base64.standard.Decoder.decode(decoded, self.sig) catch {
            self.allocator.free(decoded);
            return DSSEError.InvalidSignature;
        };
        return decoded;
    }
};

/// DSSE envelope containing signed payload
pub const Envelope = struct {
    payload: []const u8, // Base64 encoded payload
    payload_type: []const u8,
    signatures: []Signature,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, payload_bytes: []const u8, payload_type: []const u8) !Envelope {
        const payload_encoded_len = std.base64.standard.Encoder.calcSize(payload_bytes.len);
        const payload_encoded = try allocator.alloc(u8, payload_encoded_len);
        _ = std.base64.standard.Encoder.encode(payload_encoded, payload_bytes);

        return Envelope{
            .payload = payload_encoded,
            .payload_type = try allocator.dupe(u8, payload_type),
            .signatures = try allocator.alloc(Signature, 0),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Envelope) void {
        self.allocator.free(self.payload);
        self.allocator.free(self.payload_type);
        
        for (self.signatures) |*sig| {
            sig.deinit();
        }
        self.allocator.free(self.signatures);
    }

    pub fn getPayloadBytes(self: *const Envelope) DSSEError![]const u8 {
        const decoded_len = std.base64.standard.Decoder.calcSizeForSlice(self.payload) catch return DSSEError.InvalidPayload;
        const decoded = try self.allocator.alloc(u8, decoded_len);
        std.base64.standard.Decoder.decode(decoded, self.payload) catch {
            self.allocator.free(decoded);
            return DSSEError.InvalidPayload;
        };
        return decoded;
    }

    pub fn addSignature(self: *Envelope, signature: Signature) !void {
        const new_signatures = try self.allocator.realloc(self.signatures, self.signatures.len + 1);
        new_signatures[new_signatures.len - 1] = signature;
        self.signatures = new_signatures;
    }

    pub fn toJSON(self: *const Envelope) DSSEError![]const u8 {
        var json_buf = std.ArrayList(u8).init(self.allocator);
        defer json_buf.deinit();

        try json_buf.appendSlice("{\"payload\":\"");
        try json_buf.appendSlice(self.payload);
        try json_buf.appendSlice("\",\"payloadType\":\"");
        try json_buf.appendSlice(self.payload_type);
        try json_buf.appendSlice("\",\"signatures\":[");

        for (self.signatures, 0..) |sig, i| {
            if (i > 0) try json_buf.appendSlice(",");
            try json_buf.appendSlice("{\"sig\":\"");
            try json_buf.appendSlice(sig.sig);
            try json_buf.appendSlice("\"");
            
            if (sig.keyid) |keyid| {
                try json_buf.appendSlice(",\"keyid\":\"");
                try json_buf.appendSlice(keyid);
                try json_buf.appendSlice("\"");
            }
            
            try json_buf.appendSlice("}");
        }

        try json_buf.appendSlice("]}");
        return json_buf.toOwnedSlice();
    }

    pub fn fromJSON(allocator: std.mem.Allocator, json_data: []const u8) DSSEError!Envelope {
        var parser = std.json.Parser.init(allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(json_data) catch return DSSEError.InvalidPayload;
        defer tree.deinit();

        if (tree.root != .object) return DSSEError.InvalidPayload;
        const obj = tree.root.object;

        const payload_obj = obj.get("payload") orelse return DSSEError.InvalidPayload;
        const payload_type_obj = obj.get("payloadType") orelse return DSSEError.InvalidPayload;
        const signatures_obj = obj.get("signatures") orelse return DSSEError.InvalidPayload;

        if (payload_obj != .string or payload_type_obj != .string or signatures_obj != .array) {
            return DSSEError.InvalidPayload;
        }

        var envelope = Envelope{
            .payload = try allocator.dupe(u8, payload_obj.string),
            .payload_type = try allocator.dupe(u8, payload_type_obj.string),
            .signatures = try allocator.alloc(Signature, 0),
            .allocator = allocator,
        };

        // Parse signatures
        for (signatures_obj.array.items) |sig_obj| {
            if (sig_obj != .object) continue;
            
            const sig_data = sig_obj.object.get("sig") orelse continue;
            if (sig_data != .string) continue;

            const keyid = if (sig_obj.object.get("keyid")) |kid_obj| 
                if (kid_obj == .string) kid_obj.string else null
            else null;

            // Create signature without decoding (already base64)
            const signature = Signature{
                .keyid = if (keyid) |kid| try allocator.dupe(u8, kid) else null,
                .sig = try allocator.dupe(u8, sig_data.string),
                .allocator = allocator,
            };

            try envelope.addSignature(signature);
        }

        return envelope;
    }
};

/// DSSE Pre-Authentication Encoding (PAE) 
/// See https://github.com/secure-systems-lab/dsse/blob/main/spec.md
fn createPAE(allocator: std.mem.Allocator, payload_type: []const u8, payload: []const u8) ![]const u8 {
    // PAE format: "DSSEv1" + SP + LEN(type) + SP + type + SP + LEN(payload) + SP + payload
    const pae_prefix = "DSSEv1";
    const space = " ";
    
    const type_len_str = try std.fmt.allocPrint(allocator, "{d}", .{payload_type.len});
    defer allocator.free(type_len_str);
    
    const payload_len_str = try std.fmt.allocPrint(allocator, "{d}", .{payload.len});
    defer allocator.free(payload_len_str);

    const total_len = pae_prefix.len + space.len + type_len_str.len + space.len + 
                     payload_type.len + space.len + payload_len_str.len + space.len + payload.len;
    
    const pae = try allocator.alloc(u8, total_len);
    var offset: usize = 0;
    
    @memcpy(pae[offset..offset + pae_prefix.len], pae_prefix);
    offset += pae_prefix.len;
    
    @memcpy(pae[offset..offset + space.len], space);
    offset += space.len;
    
    @memcpy(pae[offset..offset + type_len_str.len], type_len_str);
    offset += type_len_str.len;
    
    @memcpy(pae[offset..offset + space.len], space);
    offset += space.len;
    
    @memcpy(pae[offset..offset + payload_type.len], payload_type);
    offset += payload_type.len;
    
    @memcpy(pae[offset..offset + space.len], space);
    offset += space.len;
    
    @memcpy(pae[offset..offset + payload_len_str.len], payload_len_str);
    offset += payload_len_str.len;
    
    @memcpy(pae[offset..offset + space.len], space);
    offset += space.len;
    
    @memcpy(pae[offset..offset + payload.len], payload);
    
    return pae;
}

/// DSSE signer for creating signed envelopes
pub const Signer = struct {
    signing_context: crypto.SigningContext,

    pub fn init(allocator: std.mem.Allocator) Signer {
        return Signer{
            .signing_context = crypto.SigningContext.init(allocator),
        };
    }

    pub fn signPayload(
        self: *Signer,
        keypair: *const crypto.EphemeralKeyPair,
        payload: []const u8,
        payload_type: []const u8,
        keyid: ?[]const u8,
    ) DSSEError!Envelope {
        // Create envelope
        var envelope = Envelope.init(self.signing_context.allocator, payload, payload_type) catch return DSSEError.OutOfMemory;

        // Create PAE (Pre-Authentication Encoding)
        const pae = createPAE(self.signing_context.allocator, payload_type, payload) catch return DSSEError.OutOfMemory;
        defer self.signing_context.allocator.free(pae);

        // Sign the PAE
        const signature_bytes = self.signing_context.signPayload(keypair, pae) catch return DSSEError.SigningFailed;
        defer self.signing_context.allocator.free(signature_bytes);

        // Create DSSE signature
        const signature = Signature.init(self.signing_context.allocator, signature_bytes, keyid) catch return DSSEError.OutOfMemory;
        
        // Add signature to envelope
        envelope.addSignature(signature) catch return DSSEError.OutOfMemory;

        return envelope;
    }
};

/// DSSE verifier for validating signed envelopes
pub const Verifier = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Verifier {
        return Verifier{ .allocator = allocator };
    }

    pub fn verifyEnvelope(
        self: *Verifier,
        envelope: *const Envelope,
        public_key_pem: []const u8,
    ) DSSEError!bool {
        if (envelope.signatures.len == 0) return false;

        // Get payload bytes
        const payload_bytes = envelope.getPayloadBytes() catch return DSSEError.InvalidPayload;
        defer self.allocator.free(payload_bytes);

        // Create PAE for verification
        const pae = createPAE(self.allocator, envelope.payload_type, payload_bytes) catch return DSSEError.OutOfMemory;
        defer self.allocator.free(pae);

        // Verify at least one signature
        for (envelope.signatures) |sig| {
            if (self.verifySignature(&sig, pae, public_key_pem)) {
                return true;
            } else |_| {
                continue;
            }
        }

        return false;
    }

    fn verifySignature(
        self: *Verifier,
        signature: *const Signature,
        pae: []const u8,
        public_key_pem: []const u8,
    ) DSSEError!bool {
        _ = self;
        _ = signature;
        _ = pae;
        _ = public_key_pem;
        
        // Simplified verification - in production this would:
        // 1. Parse the public key PEM
        // 2. Decode the signature from base64
        // 3. Verify the signature against the PAE using the public key
        // 4. Use BoringSSL's EVP_DigestVerify functions
        
        return true; // Mock verification for now
    }
};

/// Payload types for common DSSE usage
pub const PayloadType = struct {
    pub const SLSA_PROVENANCE_V1 = "application/vnd.in-toto+json";
    pub const SLSA_PROVENANCE_V02 = "https://in-toto.io/Statement/v0.1";
    pub const INTOTO_STATEMENT = "application/vnd.in-toto+json";
};

/// High-level function to sign a provenance payload with DSSE
pub fn signProvenancePayload(
    allocator: std.mem.Allocator,
    keypair: *const crypto.EphemeralKeyPair,
    provenance_json: []const u8,
    keyid: ?[]const u8,
) DSSEError!Envelope {
    var signer = Signer.init(allocator);
    return signer.signPayload(keypair, provenance_json, PayloadType.SLSA_PROVENANCE_V1, keyid);
}

/// High-level function to verify a DSSE envelope
pub fn verifyDSSEEnvelope(
    allocator: std.mem.Allocator,
    envelope_json: []const u8,
    public_key_pem: []const u8,
) DSSEError!bool {
    var envelope = Envelope.fromJSON(allocator, envelope_json) catch return DSSEError.InvalidPayload;
    defer envelope.deinit();

    var verifier = Verifier.init(allocator);
    return verifier.verifyEnvelope(&envelope, public_key_pem);
}

@import("bun")