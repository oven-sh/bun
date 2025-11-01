pub const BundleError = error{
    InvalidBundle,
    VerificationFailed,
    UnsupportedVersion,
    OutOfMemory,
};

/// Sigstore bundle verification material
pub const VerificationMaterial = struct {
    certificate: []const u8, // PEM encoded certificate
    tlog_entries: []TlogEntry,
    timestamp_verification_data: ?TimestampVerificationData,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *VerificationMaterial) void {
        self.allocator.free(self.certificate);
        for (self.tlog_entries) |*entry| {
            entry.deinit();
        }
        self.allocator.free(self.tlog_entries);
        if (self.timestamp_verification_data) |*tvd| {
            tvd.deinit();
        }
    }
};

/// Transparency log entry in bundle
pub const TlogEntry = struct {
    log_index: u64,
    log_id: LogId,
    kind_version: KindVersion,
    integrated_time: i64,
    inclusion_promise: ?InclusionPromise,
    inclusion_proof: ?InclusionProof,
    canonicalized_body: []const u8,
    allocator: std.mem.Allocator,

    pub const LogId = struct {
        key_id: []const u8,
        allocator: std.mem.Allocator,

        pub fn deinit(self: *LogId) void {
            self.allocator.free(self.key_id);
        }
    };

    pub const KindVersion = struct {
        kind: []const u8,
        version: []const u8,
        allocator: std.mem.Allocator,

        pub fn deinit(self: *KindVersion) void {
            self.allocator.free(self.kind);
            self.allocator.free(self.version);
        }
    };

    pub const InclusionPromise = struct {
        signed_entry_timestamp: []const u8,
        allocator: std.mem.Allocator,

        pub fn deinit(self: *InclusionPromise) void {
            self.allocator.free(self.signed_entry_timestamp);
        }
    };

    pub const InclusionProof = struct {
        log_index: u64,
        root_hash: []const u8,
        tree_size: u64,
        hashes: [][]const u8,
        checkpoint: ?[]const u8,
        allocator: std.mem.Allocator,

        pub fn deinit(self: *InclusionProof) void {
            self.allocator.free(self.root_hash);
            for (self.hashes) |hash| {
                self.allocator.free(hash);
            }
            self.allocator.free(self.hashes);
            if (self.checkpoint) |cp| {
                self.allocator.free(cp);
            }
        }
    };

    pub fn deinit(self: *TlogEntry) void {
        self.log_id.deinit();
        self.kind_version.deinit();
        if (self.inclusion_promise) |*promise| {
            promise.deinit();
        }
        if (self.inclusion_proof) |*proof| {
            proof.deinit();
        }
        self.allocator.free(self.canonicalized_body);
    }
};

/// Timestamp verification data for timestamped bundles
pub const TimestampVerificationData = struct {
    rfc3161_timestamps: []RFC3161Timestamp,
    allocator: std.mem.Allocator,

    pub const RFC3161Timestamp = struct {
        signed_timestamp: []const u8,
        allocator: std.mem.Allocator,

        pub fn deinit(self: *RFC3161Timestamp) void {
            self.allocator.free(self.signed_timestamp);
        }
    };

    pub fn deinit(self: *TimestampVerificationData) void {
        for (self.rfc3161_timestamps) |*ts| {
            ts.deinit();
        }
        self.allocator.free(self.rfc3161_timestamps);
    }
};

/// Complete Sigstore bundle
pub const SigstoreBundle = struct {
    media_type: []const u8,
    verification_material: VerificationMaterial,
    dsse_envelope: dsse.Envelope,
    allocator: std.mem.Allocator,

    pub const MEDIA_TYPE_V01 = "application/vnd.dev.sigstore.bundle+json;version=0.1";
    pub const MEDIA_TYPE_V02 = "application/vnd.dev.sigstore.bundle+json;version=0.2";
    pub const MEDIA_TYPE_V03 = "application/vnd.dev.sigstore.bundle+json;version=0.3";

    pub fn init(
        allocator: std.mem.Allocator,
        verification_material: VerificationMaterial,
        dsse_envelope: dsse.Envelope,
        media_type: ?[]const u8,
    ) !SigstoreBundle {
        return SigstoreBundle{
            .media_type = try allocator.dupe(u8, media_type orelse MEDIA_TYPE_V02),
            .verification_material = verification_material,
            .dsse_envelope = dsse_envelope,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *SigstoreBundle) void {
        self.allocator.free(self.media_type);
        self.verification_material.deinit();
        self.dsse_envelope.deinit();
    }

    pub fn toJSON(self: *const SigstoreBundle) BundleError![]const u8 {
        // Escape certificate for JSON
        var escaped_cert = std.ArrayList(u8).init(self.allocator);
        defer escaped_cert.deinit();
        
        for (self.verification_material.certificate) |c| {
            switch (c) {
                '\n' => try escaped_cert.appendSlice("\\n"),
                '"' => try escaped_cert.appendSlice("\\\""),
                '\\' => try escaped_cert.appendSlice("\\\\"),
                else => try escaped_cert.append(c),
            }
        }

        // Build tlog entries JSON
        var tlog_json = std.ArrayList(u8).init(self.allocator);
        defer tlog_json.deinit();
        
        try tlog_json.append('[');
        for (self.verification_material.tlog_entries, 0..) |entry, i| {
            if (i > 0) try tlog_json.appendSlice(",");
            
            const entry_json = if (entry.inclusion_promise) |promise|
                try std.fmt.allocPrint(self.allocator,
                    \\{{"logIndex":"{d}","logId":{{"keyId":"{s}"}},"kindVersion":{{"kind":"{s}","version":"{s}"}},"integratedTime":"{d}","inclusionPromise":{{"signedEntryTimestamp":"{s}"}},"canonicalizedBody":"{s}"}}
                , .{
                    entry.log_index,
                    entry.log_id.key_id,
                    entry.kind_version.kind,
                    entry.kind_version.version,
                    entry.integrated_time,
                    promise.signed_entry_timestamp,
                    entry.canonicalized_body,
                })
            else
                try std.fmt.allocPrint(self.allocator,
                    \\{{"logIndex":"{d}","logId":{{"keyId":"{s}"}},"kindVersion":{{"kind":"{s}","version":"{s}"}},"integratedTime":"{d}","canonicalizedBody":"{s}"}}
                , .{
                    entry.log_index,
                    entry.log_id.key_id,
                    entry.kind_version.kind,
                    entry.kind_version.version,
                    entry.integrated_time,
                    entry.canonicalized_body,
                });
            defer self.allocator.free(entry_json);
            
            try tlog_json.appendSlice(entry_json);
        }
        try tlog_json.append(']');

        // Get DSSE envelope JSON
        const dsse_json = self.dsse_envelope.toJSON() catch return BundleError.InvalidBundle;
        defer self.allocator.free(dsse_json);

        // Build complete bundle JSON
        return std.fmt.allocPrint(self.allocator,
            \\{{"mediaType":"{s}","verificationMaterial":{{"certificate":"{s}","tlogEntries":{s}}},"dsseEnvelope":{s}}}
        , .{
            self.media_type,
            escaped_cert.items,
            tlog_json.items,
            dsse_json,
        });
    }

    pub fn fromJSON(allocator: std.mem.Allocator, json_data: []const u8) BundleError!SigstoreBundle {
        var parser = std.json.Parser.init(allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(json_data) catch return BundleError.InvalidBundle;
        defer tree.deinit();

        if (tree.root != .object) return BundleError.InvalidBundle;
        const obj = tree.root.object;

        // Extract media type
        const media_type_obj = obj.get("mediaType") orelse return BundleError.InvalidBundle;
        if (media_type_obj != .string) return BundleError.InvalidBundle;

        // Extract verification material
        const vm_obj = obj.get("verificationMaterial") orelse return BundleError.InvalidBundle;
        if (vm_obj != .object) return BundleError.InvalidBundle;

        const cert_obj = vm_obj.object.get("certificate") orelse return BundleError.InvalidBundle;
        if (cert_obj != .string) return BundleError.InvalidBundle;

        // Unescape certificate
        var unescaped_cert = std.ArrayList(u8).init(allocator);
        defer unescaped_cert.deinit();
        
        var i: usize = 0;
        while (i < cert_obj.string.len) {
            if (cert_obj.string[i] == '\\' and i + 1 < cert_obj.string.len) {
                switch (cert_obj.string[i + 1]) {
                    'n' => {
                        try unescaped_cert.append('\n');
                        i += 2;
                    },
                    '"' => {
                        try unescaped_cert.append('"');
                        i += 2;
                    },
                    '\\' => {
                        try unescaped_cert.append('\\');
                        i += 2;
                    },
                    else => {
                        try unescaped_cert.append(cert_obj.string[i]);
                        i += 1;
                    },
                }
            } else {
                try unescaped_cert.append(cert_obj.string[i]);
                i += 1;
            }
        }

        // Parse tlog entries
        const tlog_obj = vm_obj.object.get("tlogEntries") orelse return BundleError.InvalidBundle;
        if (tlog_obj != .array) return BundleError.InvalidBundle;

        var tlog_entries = std.ArrayList(TlogEntry).init(allocator);
        defer tlog_entries.deinit();

        for (tlog_obj.array.items) |entry_obj| {
            if (entry_obj != .object) continue;
            
            const log_index_obj = entry_obj.object.get("logIndex") orelse continue;
            const log_id_obj = entry_obj.object.get("logId") orelse continue;
            const kind_version_obj = entry_obj.object.get("kindVersion") orelse continue;
            const integrated_time_obj = entry_obj.object.get("integratedTime") orelse continue;
            const canonicalized_body_obj = entry_obj.object.get("canonicalizedBody") orelse continue;

            const log_index = switch (log_index_obj) {
                .integer => @as(u64, @intCast(log_index_obj.integer)),
                .string => std.fmt.parseInt(u64, log_index_obj.string, 10) catch continue,
                else => continue,
            };

            const integrated_time = switch (integrated_time_obj) {
                .integer => integrated_time_obj.integer,
                .string => std.fmt.parseInt(i64, integrated_time_obj.string, 10) catch continue,
                else => continue,
            };

            if (log_id_obj != .object or kind_version_obj != .object or canonicalized_body_obj != .string) continue;

            const key_id_obj = log_id_obj.object.get("keyId") orelse continue;
            if (key_id_obj != .string) continue;

            const kind_obj = kind_version_obj.object.get("kind") orelse continue;
            const version_obj = kind_version_obj.object.get("version") orelse continue;
            if (kind_obj != .string or version_obj != .string) continue;

            // Parse inclusion promise if present
            var inclusion_promise: ?TlogEntry.InclusionPromise = null;
            if (entry_obj.object.get("inclusionPromise")) |promise_obj| {
                if (promise_obj == .object) {
                    if (promise_obj.object.get("signedEntryTimestamp")) |set_obj| {
                        if (set_obj == .string) {
                            inclusion_promise = TlogEntry.InclusionPromise{
                                .signed_entry_timestamp = try allocator.dupe(u8, set_obj.string),
                                .allocator = allocator,
                            };
                        }
                    }
                }
            }

            const entry = TlogEntry{
                .log_index = log_index,
                .log_id = TlogEntry.LogId{
                    .key_id = try allocator.dupe(u8, key_id_obj.string),
                    .allocator = allocator,
                },
                .kind_version = TlogEntry.KindVersion{
                    .kind = try allocator.dupe(u8, kind_obj.string),
                    .version = try allocator.dupe(u8, version_obj.string),
                    .allocator = allocator,
                },
                .integrated_time = integrated_time,
                .inclusion_promise = inclusion_promise,
                .inclusion_proof = null, // Not typically included in bundles
                .canonicalized_body = try allocator.dupe(u8, canonicalized_body_obj.string),
                .allocator = allocator,
            };

            try tlog_entries.append(entry);
        }

        // Parse DSSE envelope
        const dsse_obj = obj.get("dsseEnvelope") orelse return BundleError.InvalidBundle;
        const dsse_json = try std.json.stringifyAlloc(allocator, dsse_obj, .{});
        defer allocator.free(dsse_json);

        var dsse_envelope = dsse.Envelope.fromJSON(allocator, dsse_json) catch return BundleError.InvalidBundle;

        const verification_material = VerificationMaterial{
            .certificate = try unescaped_cert.toOwnedSlice(),
            .tlog_entries = try tlog_entries.toOwnedSlice(),
            .timestamp_verification_data = null,
            .allocator = allocator,
        };

        return SigstoreBundle.init(allocator, verification_material, dsse_envelope, media_type_obj.string);
    }

    pub fn verify(self: *const SigstoreBundle) BundleError!bool {
        // Basic verification checks
        if (self.verification_material.tlog_entries.len == 0) {
            return false;
        }

        if (self.dsse_envelope.signatures.len == 0) {
            return false;
        }

        // TODO: Implement full verification:
        // 1. Verify certificate chain against Sigstore root
        // 2. Verify DSSE signature against certificate public key
        // 3. Verify transparency log inclusion proofs
        // 4. Check certificate validity period
        // 5. Verify OIDC claims in certificate

        // For now, return true if basic structure is valid
        return true;
    }

    pub fn getSubject(self: *const SigstoreBundle) BundleError![]const u8 {
        // Extract subject from SLSA provenance payload
        const payload_bytes = self.dsse_envelope.getPayloadBytes() catch return BundleError.InvalidBundle;
        defer self.allocator.free(payload_bytes);

        var parser = std.json.Parser.init(self.allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(payload_bytes) catch return BundleError.InvalidBundle;
        defer tree.deinit();

        if (tree.root != .object) return BundleError.InvalidBundle;
        const obj = tree.root.object;

        const subject_obj = obj.get("subject") orelse return BundleError.InvalidBundle;
        if (subject_obj != .array or subject_obj.array.items.len == 0) return BundleError.InvalidBundle;

        const first_subject = subject_obj.array.items[0];
        if (first_subject != .object) return BundleError.InvalidBundle;

        const name_obj = first_subject.object.get("name") orelse return BundleError.InvalidBundle;
        if (name_obj != .string) return BundleError.InvalidBundle;

        return self.allocator.dupe(u8, name_obj.string);
    }

    pub fn getSHA512Digest(self: *const SigstoreBundle) BundleError![]const u8 {
        // Extract SHA512 digest from SLSA provenance payload
        const payload_bytes = self.dsse_envelope.getPayloadBytes() catch return BundleError.InvalidBundle;
        defer self.allocator.free(payload_bytes);

        var parser = std.json.Parser.init(self.allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(payload_bytes) catch return BundleError.InvalidBundle;
        defer tree.deinit();

        if (tree.root != .object) return BundleError.InvalidBundle;
        const obj = tree.root.object;

        const subject_obj = obj.get("subject") orelse return BundleError.InvalidBundle;
        if (subject_obj != .array or subject_obj.array.items.len == 0) return BundleError.InvalidBundle;

        const first_subject = subject_obj.array.items[0];
        if (first_subject != .object) return BundleError.InvalidBundle;

        const digest_obj = first_subject.object.get("digest") orelse return BundleError.InvalidBundle;
        if (digest_obj != .object) return BundleError.InvalidBundle;

        const sha512_obj = digest_obj.object.get("sha512") orelse return BundleError.InvalidBundle;
        if (sha512_obj != .string) return BundleError.InvalidBundle;

        return self.allocator.dupe(u8, sha512_obj.string);
    }
};

/// Builder for creating Sigstore bundles
pub const BundleBuilder = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) BundleBuilder {
        return BundleBuilder{ .allocator = allocator };
    }

    pub fn buildFromComponents(
        self: *BundleBuilder,
        certificate_chain: *const fulcio.CertificateChain,
        dsse_envelope: dsse.Envelope,
        log_entry: *const rekor.LogEntry,
    ) BundleError!SigstoreBundle {
        // Get certificate PEM
        const cert_pem = certificate_chain.getSigningCertPEM() catch return BundleError.OutOfMemory;

        // Create tlog entry
        var tlog_entries = try self.allocator.alloc(TlogEntry, 1);
        tlog_entries[0] = TlogEntry{
            .log_index = log_entry.log_index,
            .log_id = TlogEntry.LogId{
                .key_id = try self.allocator.dupe(u8, log_entry.log_id),
                .allocator = self.allocator,
            },
            .kind_version = TlogEntry.KindVersion{
                .kind = try self.allocator.dupe(u8, "dsse"),
                .version = try self.allocator.dupe(u8, "0.0.1"),
                .allocator = self.allocator,
            },
            .integrated_time = log_entry.integrated_time,
            .inclusion_promise = null, // Omit until real SET is available
            .inclusion_proof = null,
            .canonicalized_body = try self.allocator.dupe(u8, log_entry.body),
            .allocator = self.allocator,
        };

        const verification_material = VerificationMaterial{
            .certificate = cert_pem,
            .tlog_entries = tlog_entries,
            .timestamp_verification_data = null,
            .allocator = self.allocator,
        };

        return SigstoreBundle.init(self.allocator, verification_material, dsse_envelope, null);
    }
};

const std = @import("std");
const bun = @import("bun");
const crypto = @import("bun_crypto.zig");
const fulcio = @import("fulcio.zig");
const rekor = @import("rekor.zig");
const dsse = @import("dsse.zig");