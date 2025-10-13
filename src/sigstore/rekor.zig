pub const RekorError = error{
    SubmissionFailed,
    InvalidResponse,
    NetworkError,
    InvalidEntry,
    VerificationFailed,
    OutOfMemory,
};

/// Rekor log entry for transparency logging
pub const LogEntry = struct {
    uuid: []const u8,
    log_index: u64,
    log_id: []const u8,
    integrated_time: i64,
    inclusion_proof: ?InclusionProof,
    body: []const u8, // Base64 encoded entry body
    signed_entry_timestamp: ?[]const u8, // SET from response headers
    allocator: std.mem.Allocator,

    pub fn deinit(self: *LogEntry) void {
        self.allocator.free(self.uuid);
        self.allocator.free(self.log_id);
        self.allocator.free(self.body);
        if (self.signed_entry_timestamp) |set| {
            self.allocator.free(set);
        }
        if (self.inclusion_proof) |*proof| {
            proof.deinit();
        }
    }
};

/// Merkle tree inclusion proof from Rekor
pub const InclusionProof = struct {
    log_index: u64,
    root_hash: []const u8,
    tree_size: u64,
    hashes: []const []const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *InclusionProof) void {
        self.allocator.free(self.root_hash);
        for (self.hashes) |hash| {
            self.allocator.free(hash);
        }
        self.allocator.free(self.hashes);
    }
};

/// Hashedrekord entry for DSSE envelopes
pub const HashedRekordEntry = struct {
    hash: Hash,
    signature: Signature,
    
    pub const Hash = struct {
        algorithm: []const u8,
        value: []const u8,
    };
    
    pub const Signature = struct {
        content: []const u8, // Base64 encoded signature
        public_key: ?PublicKey = null,
        
        pub const PublicKey = struct {
            content: []const u8, // PEM encoded public key
        };
    };

    pub fn toJSON(self: *const HashedRekordEntry, allocator: std.mem.Allocator) RekorError![]const u8 {
        return std.fmt.allocPrint(allocator,
            \\{{"apiVersion":"0.0.1","kind":"hashedrekord","spec":{{"signature":{{"content":"{s}","publicKey":{{"content":"{s}"}}}},"data":{{"hash":{{"algorithm":"{s}","value":"{s}"}}}}}}}}
        , .{
            self.signature.content,
            if (self.signature.public_key) |pk| pk.content else "",
            self.hash.algorithm,
            self.hash.value,
        });
    }
};

/// DSSE entry for Sigstore provenance
pub const DSSEEntry = struct {
    envelope: []const u8, // Base64 encoded DSSE envelope
    verifiers: []const []const u8, // PEM encoded certificates

    pub fn toJSON(self: *const DSSEEntry, allocator: std.mem.Allocator) RekorError![]const u8 {
        // Create JSON value structure
        var verifiers_array = std.ArrayList(std.json.Value).init(allocator);
        defer verifiers_array.deinit();
        
        // Add verifiers to array
        for (self.verifiers) |verifier| {
            const verifier_owned = allocator.dupe(u8, verifier) catch return RekorError.OutOfMemory;
            try verifiers_array.append(std.json.Value{ .string = verifier_owned });
        }
        
        // Build spec object
        var spec_map = std.json.ObjectMap.init(allocator);
        spec_map.put("envelope", std.json.Value{ .string = allocator.dupe(u8, self.envelope) catch return RekorError.OutOfMemory }) catch return RekorError.OutOfMemory;
        spec_map.put("verifiers", std.json.Value{ .array = std.json.Array.fromOwnedSlice(allocator, verifiers_array.toOwnedSlice() catch return RekorError.OutOfMemory) }) catch return RekorError.OutOfMemory;
        
        // Build main object
        var main_map = std.json.ObjectMap.init(allocator);
        main_map.put("apiVersion", std.json.Value{ .string = allocator.dupe(u8, "0.0.1") catch return RekorError.OutOfMemory }) catch return RekorError.OutOfMemory;
        main_map.put("kind", std.json.Value{ .string = allocator.dupe(u8, "dsse") catch return RekorError.OutOfMemory }) catch return RekorError.OutOfMemory;
        main_map.put("spec", std.json.Value{ .object = spec_map }) catch return RekorError.OutOfMemory;
        
        const root_value = std.json.Value{ .object = main_map };
        
        // Serialize to JSON string
        var json_string = std.ArrayList(u8).init(allocator);
        defer json_string.deinit();
        
        std.json.stringify(root_value, .{}, json_string.writer()) catch return RekorError.OutOfMemory;
        
        return json_string.toOwnedSlice() catch return RekorError.OutOfMemory;
    }
};

/// Rekor transparency log client
pub const RekorClient = struct {
    base_url: []const u8,
    allocator: std.mem.Allocator,

    const DEFAULT_REKOR_URL = "https://rekor.sigstore.dev";

    pub fn init(allocator: std.mem.Allocator, base_url: ?[]const u8) RekorClient {
        return RekorClient{
            .base_url = base_url orelse DEFAULT_REKOR_URL,
            .allocator = allocator,
        };
    }

    /// Submit a DSSE envelope to Rekor transparency log
    pub fn submitDSSEEntry(
        self: *RekorClient,
        dsse_envelope: []const u8,
        certificate_chain: *const fulcio.CertificateChain,
    ) RekorError!LogEntry {
        // Encode DSSE envelope as base64
        const encoded_len = std.base64.standard.Encoder.calcSize(dsse_envelope.len);
        const encoded_envelope = try self.allocator.alloc(u8, encoded_len);
        defer self.allocator.free(encoded_envelope);
        _ = std.base64.standard.Encoder.encode(encoded_envelope, dsse_envelope);

        // Get certificate PEM
        const cert_pem = certificate_chain.getSigningCertPEM() catch return RekorError.InvalidEntry;
        defer self.allocator.free(cert_pem);

        // Create DSSE entry
        var verifiers = try self.allocator.alloc([]const u8, 1);
        defer self.allocator.free(verifiers);
        verifiers[0] = cert_pem;

        const dsse_entry = DSSEEntry{
            .envelope = encoded_envelope,
            .verifiers = verifiers,
        };

        // Convert to JSON
        const entry_json = try dsse_entry.toJSON(self.allocator);
        defer self.allocator.free(entry_json);

        return self.submitEntry(entry_json);
    }

    /// Submit a hashedrekord entry to Rekor
    pub fn submitHashedRekordEntry(
        self: *RekorClient,
        signature: []const u8,
        public_key_pem: []const u8,
        hash_algorithm: []const u8,
        hash_value: []const u8,
    ) RekorError!LogEntry {
        // Encode signature as base64
        const sig_encoded_len = std.base64.standard.Encoder.calcSize(signature.len);
        const sig_encoded = try self.allocator.alloc(u8, sig_encoded_len);
        defer self.allocator.free(sig_encoded);
        _ = std.base64.standard.Encoder.encode(sig_encoded, signature);

        const entry = HashedRekordEntry{
            .hash = .{
                .algorithm = hash_algorithm,
                .value = hash_value,
            },
            .signature = .{
                .content = sig_encoded,
                .public_key = .{
                    .content = public_key_pem,
                },
            },
        };

        const entry_json = try entry.toJSON(self.allocator);
        defer self.allocator.free(entry_json);

        return self.submitEntry(entry_json);
    }

    fn submitEntry(self: *RekorClient, entry_json: []const u8) RekorError!LogEntry {
        // Build request URL
        const url_str = try std.fmt.allocPrint(
            self.allocator,
            "{s}/api/v1/log/entries",
            .{self.base_url}
        );
        defer self.allocator.free(url_str);
        
        const url = URL.parse(url_str);

        // Set up headers
        var headers: http.HeaderBuilder = .{};
        headers.count("content-type", "application/json");
        headers.count("accept", "application/json");

        try headers.allocate(self.allocator);
        defer headers.deinit();

        headers.append("content-type", "application/json");
        headers.append("accept", "application/json");

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
            entry_json,
            null,
            null,
            .follow,
        );

        const res = req.sendSync() catch return RekorError.NetworkError;
        
        if (res.status_code != 201) {
            return RekorError.SubmissionFailed;
        }

        // Extract SignedEntryTimestamp from response headers
        const set = if (res.headers) |headers| blk: {
            // Look for x-rekor-signed-entry-timestamp header
            var it = headers.iterator();
            while (it.next()) |entry| {
                if (std.ascii.eqlIgnoreCase(entry.name, "x-rekor-signed-entry-timestamp")) {
                    break :blk try self.allocator.dupe(u8, entry.value);
                }
            }
            break :blk null;
        } else null;

        return self.parseLogEntryResponse(response_buf.list.items, set);
    }

    fn parseLogEntryResponse(self: *RekorClient, response_body: []const u8, signed_entry_timestamp: ?[]const u8) RekorError!LogEntry {
        var parser = std.json.Parser.init(self.allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(response_body) catch return RekorError.InvalidResponse;
        defer tree.deinit();

        if (tree.root != .object) return RekorError.InvalidResponse;
        const root_obj = tree.root.object;

        // Detect response shape: if has direct "uuid" field, use flat format
        // Otherwise, expect map format keyed by UUID
        var uuid_from_key: ?[]const u8 = null;
        const obj = if (root_obj.get("uuid") != null) 
            root_obj
        else blk: {
            // Map format: get first entry and capture UUID from key
            var iterator = root_obj.iterator();
            const first_entry = iterator.next() orelse return RekorError.InvalidResponse;
            if (first_entry.value_ptr.* != .object) return RekorError.InvalidResponse;
            uuid_from_key = first_entry.key_ptr.*;
            break :blk first_entry.value_ptr.object;
        };

        // Extract UUID (either from object field or from map key)
        const uuid_str = if (uuid_from_key) |key_uuid|
            key_uuid
        else blk: {
            const uuid_obj = obj.get("uuid") orelse return RekorError.InvalidResponse;
            if (uuid_obj != .string) return RekorError.InvalidResponse;
            break :blk uuid_obj.string;
        };
        const log_index_obj = obj.get("logIndex") orelse return RekorError.InvalidResponse;
        const log_id_obj = obj.get("logID") orelse return RekorError.InvalidResponse;
        const integrated_time_obj = obj.get("integratedTime") orelse return RekorError.InvalidResponse;

        if (log_id_obj != .string) return RekorError.InvalidResponse;

        const log_index = switch (log_index_obj) {
            .integer => @as(u64, @intCast(log_index_obj.integer)),
            .string => std.fmt.parseInt(u64, log_index_obj.string, 10) catch return RekorError.InvalidResponse,
            else => return RekorError.InvalidResponse,
        };

        const integrated_time = switch (integrated_time_obj) {
            .integer => integrated_time_obj.integer,
            .string => std.fmt.parseInt(i64, integrated_time_obj.string, 10) catch return RekorError.InvalidResponse,
            else => return RekorError.InvalidResponse,
        };

        // Extract body (base64 encoded)
        const body = if (obj.get("body")) |body_obj| blk: {
            if (body_obj == .string) {
                break :blk try self.allocator.dupe(u8, body_obj.string);
            } else {
                break :blk try self.allocator.dupe(u8, "");
            }
        } else try self.allocator.dupe(u8, "");

        return LogEntry{
            .uuid = try self.allocator.dupe(u8, uuid_str),
            .log_index = log_index,
            .log_id = try self.allocator.dupe(u8, log_id_obj.string),
            .integrated_time = integrated_time,
            .inclusion_proof = null, // Not included in submission response
            .body = body,
            .signed_entry_timestamp = signed_entry_timestamp,
            .allocator = self.allocator,
        };
    }

    /// Get log entry by UUID
    pub fn getLogEntry(self: *RekorClient, uuid: []const u8) RekorError!LogEntry {
        // Build request URL
        const url_str = try std.fmt.allocPrint(
            self.allocator,
            "{s}/api/v1/log/entries/{s}",
            .{ self.base_url, uuid }
        );
        defer self.allocator.free(url_str);
        
        const url = URL.parse(url_str);

        // Set up headers
        var headers: http.HeaderBuilder = .{};
        headers.count("accept", "application/json");

        try headers.allocate(self.allocator);
        defer headers.deinit();

        headers.append("accept", "application/json");

        // Prepare response buffer
        var response_buf = try MutableString.init(self.allocator, 4096);
        defer response_buf.deinit();

        // Make HTTP request
        var req = http.AsyncHTTP.initSync(
            self.allocator,
            .GET,
            url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            "",
            null,
            null,
            .follow,
        );

        const res = req.sendSync() catch return RekorError.NetworkError;
        
        if (res.status_code != 200) {
            return RekorError.InvalidResponse;
        }

        return self.parseLogEntryResponse(response_buf.list.items, null);
    }

    /// Get inclusion proof for a log entry
    pub fn getInclusionProof(self: *RekorClient, uuid: []const u8, tree_size: ?u64) RekorError!InclusionProof {
        // Build request URL with optional tree_size parameter
        const url_str = if (tree_size) |ts|
            try std.fmt.allocPrint(
                self.allocator,
                "{s}/api/v1/log/entries/{s}/inclusion/proof?treeSize={d}",
                .{ self.base_url, uuid, ts }
            )
        else
            try std.fmt.allocPrint(
                self.allocator,
                "{s}/api/v1/log/entries/{s}/inclusion/proof",
                .{ self.base_url, uuid }
            );
        defer self.allocator.free(url_str);
        
        const url = URL.parse(url_str);

        // Set up headers
        var headers: http.HeaderBuilder = .{};
        headers.count("accept", "application/json");

        try headers.allocate(self.allocator);
        defer headers.deinit();

        headers.append("accept", "application/json");

        // Prepare response buffer
        var response_buf = try MutableString.init(self.allocator, 4096);
        defer response_buf.deinit();

        // Make HTTP request
        var req = http.AsyncHTTP.initSync(
            self.allocator,
            .GET,
            url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            "",
            null,
            null,
            .follow,
        );

        const res = req.sendSync() catch return RekorError.NetworkError;
        
        if (res.status_code != 200) {
            return RekorError.InvalidResponse;
        }

        return self.parseInclusionProof(response_buf.list.items);
    }

    fn parseInclusionProof(self: *RekorClient, response_body: []const u8) RekorError!InclusionProof {
        var parser = std.json.Parser.init(self.allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(response_body) catch return RekorError.InvalidResponse;
        defer tree.deinit();

        if (tree.root != .object) return RekorError.InvalidResponse;
        const obj = tree.root.object;

        const log_index_obj = obj.get("logIndex") orelse return RekorError.InvalidResponse;
        const root_hash_obj = obj.get("rootHash") orelse return RekorError.InvalidResponse;
        const tree_size_obj = obj.get("treeSize") orelse return RekorError.InvalidResponse;
        const hashes_obj = obj.get("hashes") orelse return RekorError.InvalidResponse;

        if (root_hash_obj != .string or hashes_obj != .array) return RekorError.InvalidResponse;

        const log_index = switch (log_index_obj) {
            .integer => @as(u64, @intCast(log_index_obj.integer)),
            .string => std.fmt.parseInt(u64, log_index_obj.string, 10) catch return RekorError.InvalidResponse,
            else => return RekorError.InvalidResponse,
        };

        const tree_size = switch (tree_size_obj) {
            .integer => @as(u64, @intCast(tree_size_obj.integer)),
            .string => std.fmt.parseInt(u64, tree_size_obj.string, 10) catch return RekorError.InvalidResponse,
            else => return RekorError.InvalidResponse,
        };

        // Parse hashes array
        var hashes = std.ArrayList([]const u8).init(self.allocator);
        defer hashes.deinit();

        for (hashes_obj.array.items) |hash_item| {
            if (hash_item == .string) {
                try hashes.append(try self.allocator.dupe(u8, hash_item.string));
            }
        }

        return InclusionProof{
            .log_index = log_index,
            .root_hash = try self.allocator.dupe(u8, root_hash_obj.string),
            .tree_size = tree_size,
            .hashes = try hashes.toOwnedSlice(),
            .allocator = self.allocator,
        };
    }

    /// Verify inclusion proof
    pub fn verifyInclusionProof(self: *RekorClient, proof: *const InclusionProof, leaf_hash: []const u8) RekorError!bool {
        _ = self;
        _ = proof;
        _ = leaf_hash;
        // TODO: Implement RFC 6962 Merkle tree verification
        return RekorError.VerificationFailed;
    }
};

/// High-level function to submit a DSSE envelope and get transparency log entry
pub fn submitDSSEToRekor(
    allocator: std.mem.Allocator,
    dsse_envelope: []const u8,
    certificate_chain: *const fulcio.CertificateChain,
    rekor_url: ?[]const u8,
) RekorError!LogEntry {
    var client = RekorClient.init(allocator, rekor_url);
    return client.submitDSSEEntry(dsse_envelope, certificate_chain);
}

const std = @import("std");
const bun = @import("bun");
const crypto = @import("bun_crypto.zig");
const fulcio = @import("fulcio.zig");
const http = bun.http;
const MutableString = bun.MutableString;
const URL = bun.URL;