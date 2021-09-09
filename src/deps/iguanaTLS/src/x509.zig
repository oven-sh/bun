const std = @import("std");
const Allocator = std.mem.Allocator;
const mem = std.mem;
const trait = std.meta.trait;

const asn1 = @import("asn1.zig");

// zig fmt: off
// http://www.iana.org/assignments/tls-parameters/tls-parameters.xhtml#tls-parameters-8
pub const CurveId = enum {
    sect163k1, sect163r1, sect163r2, sect193r1,
    sect193r2, sect233k1, sect233r1, sect239k1,
    sect283k1, sect283r1, sect409k1, sect409r1,
    sect571k1, sect571r1, secp160k1, secp160r1,
    secp160r2, secp192k1, secp192r1, secp224k1,
    secp224r1, secp256k1, secp256r1, secp384r1,
    secp521r1,brainpoolP256r1, brainpoolP384r1,
    brainpoolP512r1, curve25519, curve448,
};
// zig fmt: on

pub const PublicKey = union(enum) {
    pub const empty = PublicKey{ .ec = .{ .id = undefined, .curve_point = &[0]u8{} } };

    /// RSA public key
    rsa: struct {
        //Positive std.math.big.int.Const numbers.
        modulus: []const usize,
        exponent: []const usize,
    },
    /// Elliptic curve public key
    ec: struct {
        id: CurveId,
        /// Public curve point (uncompressed format)
        curve_point: []const u8,
    },

    pub fn deinit(self: @This(), alloc: *Allocator) void {
        switch (self) {
            .rsa => |rsa| {
                alloc.free(rsa.modulus);
                alloc.free(rsa.exponent);
            },
            .ec => |ec| alloc.free(ec.curve_point),
        }
    }

    pub fn eql(self: @This(), other: @This()) bool {
        if (@as(std.meta.Tag(@This()), self) != @as(std.meta.Tag(@This()), other))
            return false;
        switch (self) {
            .rsa => |mod_exp| return mem.eql(usize, mod_exp.exponent, other.rsa.exponent) and
                mem.eql(usize, mod_exp.modulus, other.rsa.modulus),
            .ec => |ec| return ec.id == other.ec.id and mem.eql(u8, ec.curve_point, other.ec.curve_point),
        }
    }
};

pub const PrivateKey = PublicKey;

pub fn parse_public_key(allocator: *Allocator, reader: anytype) !PublicKey {
    if ((try reader.readByte()) != 0x30)
        return error.MalformedDER;
    const seq_len = try asn1.der.parse_length(reader);
    _ = seq_len;

    if ((try reader.readByte()) != 0x06)
        return error.MalformedDER;
    const oid_bytes = try asn1.der.parse_length(reader);
    if (oid_bytes == 9) {
        // @TODO This fails in async if merged with the if
        if (!try reader.isBytes(&[9]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0xD, 0x1, 0x1, 0x1 }))
            return error.MalformedDER;
        // OID is 1.2.840.113549.1.1.1
        // RSA key
        // Skip past the NULL
        const null_byte = try reader.readByte();
        if (null_byte != 0x05)
            return error.MalformedDER;
        const null_len = try asn1.der.parse_length(reader);
        if (null_len != 0x00)
            return error.MalformedDER;
        {
            // BitString next!
            if ((try reader.readByte()) != 0x03)
                return error.MalformedDER;
            _ = try asn1.der.parse_length(reader);
            const bit_string_unused_bits = try reader.readByte();
            if (bit_string_unused_bits != 0)
                return error.MalformedDER;

            if ((try reader.readByte()) != 0x30)
                return error.MalformedDER;
            _ = try asn1.der.parse_length(reader);

            // Modulus
            if ((try reader.readByte()) != 0x02)
                return error.MalformedDER;
            const modulus = try asn1.der.parse_int(allocator, reader);
            errdefer allocator.free(modulus.limbs);
            if (!modulus.positive) return error.MalformedDER;
            // Exponent
            if ((try reader.readByte()) != 0x02)
                return error.MalformedDER;
            const exponent = try asn1.der.parse_int(allocator, reader);
            errdefer allocator.free(exponent.limbs);
            if (!exponent.positive) return error.MalformedDER;
            return PublicKey{
                .rsa = .{
                    .modulus = modulus.limbs,
                    .exponent = exponent.limbs,
                },
            };
        }
    } else if (oid_bytes == 7) {
        // @TODO This fails in async if merged with the if
        if (!try reader.isBytes(&[7]u8{ 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01 }))
            return error.MalformedDER;
        // OID is 1.2.840.10045.2.1
        // Elliptical curve
        // We only support named curves, for which the parameter field is an OID.
        const oid_tag = try reader.readByte();
        if (oid_tag != 0x06)
            return error.MalformedDER;
        const curve_oid_bytes = try asn1.der.parse_length(reader);

        var key: PublicKey = undefined;
        if (curve_oid_bytes == 5) {
            if (!try reader.isBytes(&[4]u8{ 0x2B, 0x81, 0x04, 0x00 }))
                return error.MalformedDER;
            // 1.3.132.0.{34, 35}
            const last_byte = try reader.readByte();
            if (last_byte == 0x22)
                key = .{ .ec = .{ .id = .secp384r1, .curve_point = undefined } }
            else if (last_byte == 0x23)
                key = .{ .ec = .{ .id = .secp521r1, .curve_point = undefined } }
            else
                return error.MalformedDER;
        } else if (curve_oid_bytes == 8) {
            if (!try reader.isBytes(&[8]u8{ 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x3, 0x1, 0x7 }))
                return error.MalformedDER;
            key = .{ .ec = .{ .id = .secp256r1, .curve_point = undefined } };
        } else {
            return error.MalformedDER;
        }

        if ((try reader.readByte()) != 0x03)
            return error.MalformedDER;
        const byte_len = try asn1.der.parse_length(reader);
        const unused_bits = try reader.readByte();
        const bit_count = (byte_len - 1) * 8 - unused_bits;
        if (bit_count % 8 != 0)
            return error.MalformedDER;
        const bit_memory = try allocator.alloc(u8, std.math.divCeil(usize, bit_count, 8) catch unreachable);
        errdefer allocator.free(bit_memory);
        try reader.readNoEof(bit_memory[0 .. byte_len - 1]);

        key.ec.curve_point = bit_memory;
        return key;
    }
    return error.MalformedDER;
}

pub fn DecodeDERError(comptime Reader: type) type {
    return Reader.Error || error{
        MalformedPEM,
        MalformedDER,
        EndOfStream,
        OutOfMemory,
    };
}

pub const Certificate = struct {
    pub const SignatureAlgorithm = struct {
        hash: enum(u8) {
            none = 0,
            md5 = 1,
            sha1 = 2,
            sha224 = 3,
            sha256 = 4,
            sha384 = 5,
            sha512 = 6,
        },
        signature: enum(u8) {
            anonymous = 0,
            rsa = 1,
            dsa = 2,
            ecdsa = 3,
        },
    };

    /// Subject distinguished name
    dn: []const u8,
    /// A "CA" anchor is deemed fit to verify signatures on certificates.
    /// A "non-CA" anchor is accepted only for direct trust (server's certificate
    /// name and key match the anchor).
    is_ca: bool = false,
    public_key: PublicKey,

    const CaptureState = struct {
        self: *Certificate,
        allocator: *Allocator,
        dn_allocated: bool = false,
        pk_allocated: bool = false,
    };

    fn initSubjectDn(state: *CaptureState, tag: u8, length: usize, reader: anytype) !void {
        _ = tag;

        const dn_mem = try state.allocator.alloc(u8, length);
        errdefer state.allocator.free(dn_mem);
        try reader.readNoEof(dn_mem);
        state.self.dn = dn_mem;
        state.dn_allocated = true;
    }

    fn processExtension(state: *CaptureState, tag: u8, length: usize, reader: anytype) !void {
        _ = tag;
        _ = length;

        const object_id = try asn1.der.parse_value(state.allocator, reader);
        defer object_id.deinit(state.allocator);
        if (object_id != .object_identifier) return error.DoesNotMatchSchema;
        if (object_id.object_identifier.len != 4)
            return;

        const data = object_id.object_identifier.data;
        // Basic constraints extension
        if (data[0] != 2 or data[1] != 5 or data[2] != 29 or data[3] != 19)
            return;

        const basic_constraints = try asn1.der.parse_value(state.allocator, reader);
        defer basic_constraints.deinit(state.allocator);

        switch (basic_constraints) {
            .bool => state.self.is_ca = true,
            .octet_string => |s| {
                if (s.len != 5 or s[0] != 0x30 or s[1] != 0x03 or s[2] != 0x01 or s[3] != 0x01)
                    return error.DoesNotMatchSchema;
                state.self.is_ca = s[4] != 0x00;
            },
            else => return error.DoesNotMatchSchema,
        }
    }

    fn initExtensions(state: *CaptureState, tag: u8, length: usize, reader: anytype) !void {
        _ = tag;
        _ = length;

        const schema = .{
            .sequence_of,
            .{ .capture, 0, .sequence },
        };
        const captures = .{
            state, processExtension,
        };
        try asn1.der.parse_schema(schema, captures, reader);
    }

    fn initPublicKeyInfo(state: *CaptureState, tag: u8, length: usize, reader: anytype) !void {
        _ = tag;
        _ = length;

        state.self.public_key = try parse_public_key(state.allocator, reader);
        state.pk_allocated = true;
    }

    /// Initialize a trusted anchor from distinguished encoding rules (DER) encoded data
    pub fn create(allocator: *Allocator, der_reader: anytype) DecodeDERError(@TypeOf(der_reader))!@This() {
        var self: @This() = undefined;
        self.is_ca = false;
        // https://tools.ietf.org/html/rfc5280#page-117
        const schema = .{
            .sequence, .{
                // tbsCertificate
                .{
                    .sequence,
                    .{
                        .{ .context_specific, 0 }, // version
                        .{.int}, // serialNumber
                        .{.sequence}, // signature
                        .{.sequence}, // issuer
                        .{.sequence}, // validity,
                        .{ .capture, 0, .sequence }, // subject
                        .{ .capture, 1, .sequence }, // subjectPublicKeyInfo
                        .{ .optional, .context_specific, 1 }, // issuerUniqueID
                        .{ .optional, .context_specific, 2 }, // subjectUniqueID
                        .{ .capture, 2, .optional, .context_specific, 3 }, // extensions
                    },
                },
                // signatureAlgorithm
                .{.sequence},
                // signatureValue
                .{.bit_string},
            },
        };

        var capture_state = CaptureState{
            .self = &self,
            .allocator = allocator,
        };
        const captures = .{
            &capture_state, initSubjectDn,
            &capture_state, initPublicKeyInfo,
            &capture_state, initExtensions,
        };

        errdefer {
            if (capture_state.dn_allocated)
                allocator.free(self.dn);
            if (capture_state.pk_allocated)
                self.public_key.deinit(allocator);
        }

        asn1.der.parse_schema(schema, captures, der_reader) catch |err| switch (err) {
            error.InvalidLength,
            error.InvalidTag,
            error.InvalidContainerLength,
            error.DoesNotMatchSchema,
            => return error.MalformedDER,
            else => |e| return e,
        };
        return self;
    }

    pub fn deinit(self: @This(), alloc: *Allocator) void {
        alloc.free(self.dn);
        self.public_key.deinit(alloc);
    }

    pub fn format(self: @This(), comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
        _ = fmt;
        _ = options;

        try writer.print(
            \\CERTIFICATE
            \\-----------
            \\IS CA: {}
            \\Subject distinguished name (encoded):
            \\{X}
            \\Public key:
            \\
        , .{ self.is_ca, self.dn });

        switch (self.public_key) {
            .rsa => |mod_exp| {
                const modulus = std.math.big.int.Const{ .positive = true, .limbs = mod_exp.modulus };
                const exponent = std.math.big.int.Const{ .positive = true, .limbs = mod_exp.exponent };
                try writer.print(
                    \\RSA
                    \\modulus: {}
                    \\exponent: {}
                    \\
                , .{
                    modulus,
                    exponent,
                });
            },
            .ec => |ec| {
                try writer.print(
                    \\EC (Curve: {})
                    \\point: {}
                    \\
                , .{
                    ec.id,
                    ec.curve_point,
                });
            },
        }

        try writer.writeAll(
            \\-----------
            \\
        );
    }
};

pub const CertificateChain = struct {
    data: std.ArrayList(Certificate),

    pub fn from_pem(allocator: *Allocator, pem_reader: anytype) DecodeDERError(@TypeOf(pem_reader))!@This() {
        var self = @This(){ .data = std.ArrayList(Certificate).init(allocator) };
        errdefer self.deinit();

        var it = pemCertificateIterator(pem_reader);
        while (try it.next()) |cert_reader| {
            var buffered = std.io.bufferedReader(cert_reader);
            const anchor = try Certificate.create(allocator, buffered.reader());
            errdefer anchor.deinit(allocator);
            try self.data.append(anchor);
        }
        return self;
    }

    pub fn deinit(self: @This()) void {
        const alloc = self.data.allocator;
        for (self.data.items) |ta| ta.deinit(alloc);
        self.data.deinit();
    }
};

pub fn get_signature_algorithm(
    reader: anytype,
) (@TypeOf(reader).Error || error{EndOfStream})!?Certificate.SignatureAlgorithm {
    const oid_tag = try reader.readByte();
    if (oid_tag != 0x06)
        return null;

    const oid_length = try asn1.der.parse_length(reader);
    if (oid_length == 9) {
        var oid_bytes: [9]u8 = undefined;
        try reader.readNoEof(&oid_bytes);

        if (mem.eql(u8, &oid_bytes, &[_]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01 })) {
            // TODO: Is hash actually none here?
            return Certificate.SignatureAlgorithm{ .signature = .rsa, .hash = .none };
        } else if (mem.eql(u8, &oid_bytes, &[_]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x04 })) {
            return Certificate.SignatureAlgorithm{ .signature = .rsa, .hash = .md5 };
        } else if (mem.eql(u8, &oid_bytes, &[_]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x05 })) {
            return Certificate.SignatureAlgorithm{ .signature = .rsa, .hash = .sha1 };
        } else if (mem.eql(u8, &oid_bytes, &[_]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0B })) {
            return Certificate.SignatureAlgorithm{ .signature = .rsa, .hash = .sha256 };
        } else if (mem.eql(u8, &oid_bytes, &[_]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0C })) {
            return Certificate.SignatureAlgorithm{ .signature = .rsa, .hash = .sha384 };
        } else if (mem.eql(u8, &oid_bytes, &[_]u8{ 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0D })) {
            return Certificate.SignatureAlgorithm{ .signature = .rsa, .hash = .sha512 };
        } else {
            return null;
        }
        return;
    } else if (oid_length == 10) {
        // TODO
        // ECDSA + <Hash> algorithms
    }
    return null;
}

pub const ClientCertificateChain = struct {
    /// Number of certificates in the chain
    cert_len: usize,
    /// Contains the raw data of each certificate in the certificate chain
    raw_certs: [*]const []const u8,
    /// Issuer distinguished name in DER format of each certificate in the certificate chain
    /// issuer_dn[N] is a dubslice of raw[N]
    cert_issuer_dns: [*]const []const u8,
    signature_algorithm: Certificate.SignatureAlgorithm,
    private_key: PrivateKey,

    // TODO: Encrypted private keys, non-RSA private keys
    pub fn from_pem(allocator: *Allocator, pem_reader: anytype) !@This() {
        var it = PEMSectionIterator(@TypeOf(pem_reader), .{
            .section_names = &.{
                "X.509 CERTIFICATE",
                "CERTIFICATE",
                "RSA PRIVATE KEY",
            },
            .skip_irrelevant_lines = true,
        }){ .reader = pem_reader };

        var raw_certs = std.ArrayListUnmanaged([]const u8){};
        var cert_issuer_dns = std.ArrayList([]const u8).init(allocator);
        errdefer {
            for (raw_certs.items) |bytes| {
                allocator.free(bytes);
            }
            raw_certs.deinit(allocator);
            cert_issuer_dns.deinit();
        }

        var signature_algorithm: Certificate.SignatureAlgorithm = undefined;
        var private_key: ?PrivateKey = null;
        errdefer if (private_key) |pk| {
            pk.deinit(allocator);
        };

        while (try it.next()) |state_and_reader| {
            switch (state_and_reader.state) {
                .@"X.509 CERTIFICATE", .@"CERTIFICATE" => {
                    const cert_bytes = try state_and_reader.reader.readAllAlloc(allocator, std.math.maxInt(usize));
                    errdefer allocator.free(cert_bytes);
                    try raw_certs.append(allocator, cert_bytes);

                    const schema = .{
                        .sequence, .{
                            // tbsCertificate
                            .{
                                .sequence,
                                .{
                                    .{ .context_specific, 0 }, // version
                                    .{.int}, // serialNumber
                                    .{.sequence}, // signature
                                    .{ .capture, 0, .sequence }, // issuer
                                    .{.sequence}, // validity
                                    .{.sequence}, // subject
                                    .{.sequence}, // subjectPublicKeyInfo
                                    .{ .optional, .context_specific, 1 }, // issuerUniqueID
                                    .{ .optional, .context_specific, 2 }, // subjectUniqueID
                                    .{ .optional, .context_specific, 3 }, // extensions
                                },
                            },
                            // signatureAlgorithm
                            .{ .capture, 1, .sequence },
                            // signatureValue
                            .{.bit_string},
                        },
                    };

                    var fbs = std.io.fixedBufferStream(cert_bytes);
                    const state = .{
                        .fbs = &fbs,
                        .dns = &cert_issuer_dns,
                        .signature_algorithm = &signature_algorithm,
                    };

                    const captures = .{
                        state,
                        struct {
                            fn capture(_state: anytype, tag: u8, length: usize, reader: anytype) !void {
                                _ = tag;
                                _ = reader;

                                // TODO: Some way to get tag + length buffer directly in the capture callback?
                                const encoded_length = asn1.der.encode_length(length).slice();
                                const pos = _state.fbs.pos;
                                const dn = _state.fbs.buffer[pos - encoded_length.len - 1 .. pos + length];
                                try _state.dns.append(dn);
                            }
                        }.capture,
                        state,
                        struct {
                            fn capture(_state: anytype, tag: u8, length: usize, reader: anytype) !void {
                                _ = tag;
                                _ = length;

                                if (_state.dns.items.len == 1)
                                    _state.signature_algorithm.* = (try get_signature_algorithm(reader)) orelse
                                        return error.InvalidSignatureAlgorithm;
                            }
                        }.capture,
                    };

                    asn1.der.parse_schema(schema, captures, fbs.reader()) catch |err| switch (err) {
                        error.DoesNotMatchSchema,
                        error.EndOfStream,
                        error.InvalidTag,
                        error.InvalidLength,
                        error.InvalidSignatureAlgorithm,
                        error.InvalidContainerLength,
                        => return error.InvalidCertificate,
                        error.OutOfMemory => return error.OutOfMemory,
                    };
                },
                .@"RSA PRIVATE KEY" => {
                    if (private_key != null)
                        return error.MultiplePrivateKeys;

                    const schema = .{
                        .sequence, .{
                            .{.int}, // version
                            .{ .capture, 0, .int }, //modulus
                            .{.int}, //publicExponent
                            .{ .capture, 1, .int }, //privateExponent
                            .{.int}, // prime1
                            .{.int}, //prime2
                            .{.int}, //exponent1
                            .{.int}, //exponent2
                            .{.int}, //coefficient
                            .{ .optional, .any }, //otherPrimeInfos
                        },
                    };

                    private_key = .{ .rsa = undefined };
                    const state = .{
                        .modulus = &private_key.?.rsa.modulus,
                        .exponent = &private_key.?.rsa.exponent,
                        .allocator = allocator,
                    };

                    const captures = .{
                        state,
                        struct {
                            fn capture(_state: anytype, tag: u8, length: usize, reader: anytype) !void {
                                _ = tag;

                                _state.modulus.* = (try asn1.der.parse_int_with_length(
                                    _state.allocator,
                                    length,
                                    reader,
                                )).limbs;
                            }
                        }.capture,
                        state,
                        struct {
                            fn capture(_state: anytype, tag: u8, length: usize, reader: anytype) !void {
                                _ = tag;

                                _state.exponent.* = (try asn1.der.parse_int_with_length(
                                    _state.allocator,
                                    length,
                                    reader,
                                )).limbs;
                            }
                        }.capture,
                    };

                    asn1.der.parse_schema(schema, captures, state_and_reader.reader) catch |err| switch (err) {
                        error.DoesNotMatchSchema,
                        error.EndOfStream,
                        error.InvalidTag,
                        error.InvalidLength,
                        error.InvalidContainerLength,
                        => return error.InvalidPrivateKey,
                        error.OutOfMemory => return error.OutOfMemory,
                        error.MalformedPEM => return error.MalformedPEM,
                    };
                },
                .none, .other => unreachable,
            }
        }
        if (private_key == null)
            return error.NoPrivateKey;

        std.debug.assert(cert_issuer_dns.items.len == raw_certs.items.len);
        return @This(){
            .cert_len = raw_certs.items.len,
            .raw_certs = raw_certs.toOwnedSlice(allocator).ptr,
            .cert_issuer_dns = cert_issuer_dns.toOwnedSlice().ptr,
            .signature_algorithm = signature_algorithm,
            .private_key = private_key.?,
        };
    }

    pub fn deinit(self: *@This(), allocator: *Allocator) void {
        for (self.raw_certs[0..self.cert_len]) |cert_bytes| {
            allocator.free(cert_bytes);
        }
        allocator.free(self.raw_certs[0..self.cert_len]);
        allocator.free(self.cert_issuer_dns[0..self.cert_len]);
        self.private_key.deinit(allocator);
    }
};

fn PEMSectionReader(comptime Reader: type, comptime options: PEMSectionIteratorOptions) type {
    const Error = Reader.Error || error{MalformedPEM};
    const read = struct {
        fn f(it: *PEMSectionIterator(Reader, options), buf: []u8) Error!usize {
            var out_idx: usize = 0;
            if (it.waiting_chars_len > 0) {
                const rest_written = std.math.min(it.waiting_chars_len, buf.len);
                while (out_idx < rest_written) : (out_idx += 1) {
                    buf[out_idx] = it.waiting_chars[out_idx];
                }

                it.waiting_chars_len -= rest_written;
                if (it.waiting_chars_len != 0) {
                    std.mem.copy(u8, it.waiting_chars[0..], it.waiting_chars[rest_written..]);
                }

                if (out_idx == buf.len) {
                    return out_idx;
                }
            }
            if (it.state == .none)
                return out_idx;

            var base64_buf: [4]u8 = undefined;
            var base64_idx: usize = 0;
            while (true) {
                const byte = it.reader.readByte() catch |err| switch (err) {
                    error.EndOfStream => return out_idx,
                    else => |e| return e,
                };

                if (byte == '-') {
                    if (it.reader.isBytes("----END ") catch |err| switch (err) {
                        error.EndOfStream => return error.MalformedPEM,
                        else => |e| return e,
                    }) {
                        try it.reader.skipUntilDelimiterOrEof('\n');
                        it.state = .none;
                        return out_idx;
                    } else return error.MalformedPEM;
                } else if (byte == '\r') {
                    if ((it.reader.readByte() catch |err| switch (err) {
                        error.EndOfStream => return error.MalformedPEM,
                        else => |e| return e,
                    }) != '\n')
                        return error.MalformedPEM;
                    continue;
                } else if (byte == '\n')
                    continue;

                base64_buf[base64_idx] = byte;
                base64_idx += 1;
                if (base64_idx == base64_buf.len) {
                    base64_idx = 0;

                    const out_len = std.base64.standard_decoder.calcSizeForSlice(&base64_buf) catch
                        return error.MalformedPEM;

                    const rest_chars = if (out_len > buf.len - out_idx)
                        out_len - (buf.len - out_idx)
                    else
                        0;
                    const buf_chars = out_len - rest_chars;

                    var res_buffer: [3]u8 = undefined;
                    std.base64.standard_decoder.decode(res_buffer[0..out_len], &base64_buf) catch
                        return error.MalformedPEM;

                    var i: u3 = 0;
                    while (i < buf_chars) : (i += 1) {
                        buf[out_idx] = res_buffer[i];
                        out_idx += 1;
                    }

                    if (rest_chars > 0) {
                        mem.copy(u8, &it.waiting_chars, res_buffer[i..]);
                        it.waiting_chars_len = @intCast(u2, rest_chars);
                    }
                    if (out_idx == buf.len)
                        return out_idx;
                }
            }
        }
    }.f;

    return std.io.Reader(
        *PEMSectionIterator(Reader, options),
        Error,
        read,
    );
}

const PEMSectionIteratorOptions = struct {
    section_names: []const []const u8,
    skip_irrelevant_lines: bool = false,
};

fn PEMSectionIterator(comptime Reader: type, comptime options: PEMSectionIteratorOptions) type {
    var biggest_name_len = 0;

    var fields: [options.section_names.len + 2]std.builtin.TypeInfo.EnumField = undefined;
    fields[0] = .{ .name = "none", .value = 0 };
    fields[1] = .{ .name = "other", .value = 1 };
    for (fields[2..]) |*field, idx| {
        field.name = options.section_names[idx];
        field.value = @as(u8, idx + 2);
        if (field.name.len > biggest_name_len)
            biggest_name_len = field.name.len;
    }

    const StateEnum = @Type(.{
        .Enum = .{
            .layout = .Auto,
            .tag_type = u8,
            .fields = &fields,
            .decls = &.{},
            .is_exhaustive = true,
        },
    });

    const _biggest_name_len = biggest_name_len;

    return struct {
        pub const SectionReader = PEMSectionReader(Reader, options);
        pub const StateAndName = struct {
            state: StateEnum,
            reader: SectionReader,
        };
        pub const NextError = SectionReader.Error || error{EndOfStream};

        reader: Reader,
        // Internal state for the iterator and the current reader.
        state: StateEnum = .none,
        waiting_chars: [4]u8 = undefined,
        waiting_chars_len: u2 = 0,

        // TODO More verification, this will accept lots of invalid PEM
        // TODO Simplify code
        pub fn next(self: *@This()) NextError!?StateAndName {
            self.waiting_chars_len = 0;
            outer_loop: while (true) {
                const byte = self.reader.readByte() catch |err| switch (err) {
                    error.EndOfStream => if (self.state == .none)
                        return null
                    else
                        return error.EndOfStream,
                    else => |e| return e,
                };

                switch (self.state) {
                    .none => switch (byte) {
                        '#' => {
                            try self.reader.skipUntilDelimiterOrEof('\n');
                            continue;
                        },
                        '\r', '\n', ' ', '\t' => continue,
                        '-' => {
                            if (try self.reader.isBytes("----BEGIN ")) {
                                var name_char_idx: usize = 0;
                                var name_buf: [_biggest_name_len]u8 = undefined;

                                while (true) {
                                    const next_byte = try self.reader.readByte();
                                    switch (next_byte) {
                                        '-' => {
                                            try self.reader.skipUntilDelimiterOrEof('\n');
                                            const name = name_buf[0..name_char_idx];
                                            for (options.section_names) |sec_name, idx| {
                                                if (mem.eql(u8, sec_name, name)) {
                                                    self.state = @intToEnum(StateEnum, @intCast(u8, idx + 2));
                                                    return StateAndName{
                                                        .reader = .{ .context = self },
                                                        .state = self.state,
                                                    };
                                                }
                                            }
                                            self.state = .other;
                                            continue :outer_loop;
                                        },
                                        '\n' => return error.MalformedPEM,
                                        else => {
                                            if (name_char_idx == _biggest_name_len) {
                                                try self.reader.skipUntilDelimiterOrEof('\n');
                                                self.state = .other;
                                                continue :outer_loop;
                                            }
                                            name_buf[name_char_idx] = next_byte;
                                            name_char_idx += 1;
                                        },
                                    }
                                }
                            } else return error.MalformedPEM;
                        },
                        else => {
                            if (options.skip_irrelevant_lines) {
                                try self.reader.skipUntilDelimiterOrEof('\n');
                                continue;
                            } else {
                                return error.MalformedPEM;
                            }
                        },
                    },
                    else => switch (byte) {
                        '#' => {
                            try self.reader.skipUntilDelimiterOrEof('\n');
                            continue;
                        },
                        '\r', '\n', ' ', '\t' => continue,
                        '-' => {
                            if (try self.reader.isBytes("----END ")) {
                                try self.reader.skipUntilDelimiterOrEof('\n');
                                self.state = .none;
                                continue;
                            } else return error.MalformedPEM;
                        },
                        // TODO: Make sure the character is base64
                        else => continue,
                    },
                }
            }
        }
    };
}

fn PEMCertificateIterator(comptime Reader: type) type {
    const SectionIterator = PEMSectionIterator(Reader, .{
        .section_names = &.{ "X.509 CERTIFICATE", "CERTIFICATE" },
    });

    return struct {
        pub const SectionReader = SectionIterator.SectionReader;
        pub const NextError = SectionReader.Error || error{EndOfStream};

        section_it: SectionIterator,

        pub fn next(self: *@This()) NextError!?SectionReader {
            return ((try self.section_it.next()) orelse return null).reader;
        }
    };
}

/// Iterator of io.Reader that each decode one certificate from the PEM reader.
/// Readers do not have to be fully consumed until end of stream, but they must be
/// read from in order.
/// Iterator.SectionReader is the type of the io.Reader, Iterator.NextError is the error
/// set of the next() function.
pub fn pemCertificateIterator(reader: anytype) PEMCertificateIterator(@TypeOf(reader)) {
    return .{ .section_it = .{ .reader = reader } };
}

pub const NameElement = struct {
    // Encoded OID without tag
    oid: asn1.ObjectIdentifier,
    // Destination buffer
    buf: []u8,
    status: enum {
        not_found,
        found,
        errored,
    },
};

const github_pem = @embedFile("../test/github.pem");
const github_der = @embedFile("../test/github.der");

fn expected_pem_certificate_chain(bytes: []const u8, certs: []const []const u8) !void {
    var fbs = std.io.fixedBufferStream(bytes);

    var it = pemCertificateIterator(fbs.reader());
    var idx: usize = 0;
    while (try it.next()) |cert_reader| : (idx += 1) {
        const result_bytes = try cert_reader.readAllAlloc(std.testing.allocator, std.math.maxInt(usize));
        defer std.testing.allocator.free(result_bytes);
        try std.testing.expectEqualSlices(u8, certs[idx], result_bytes);
    }
    if (idx != certs.len) {
        std.debug.panic("Read {} certificates, wanted {}", .{ idx, certs.len });
    }
    try std.testing.expect((try it.next()) == null);
}

fn expected_pem_certificate(bytes: []const u8, cert_bytes: []const u8) !void {
    try expected_pem_certificate_chain(bytes, &[1][]const u8{cert_bytes});
}

test "pemCertificateIterator" {
    try expected_pem_certificate(github_pem, github_der);
    try expected_pem_certificate(
        \\-----BEGIN BOGUS-----
        \\-----END BOGUS-----
        \\
            ++
            github_pem,
        github_der,
    );

    try expected_pem_certificate_chain(
        github_pem ++
            \\
            \\-----BEGIN BOGUS-----
            \\-----END BOGUS-----
            \\
        ++ github_pem,
        &[2][]const u8{ github_der, github_der },
    );

    try expected_pem_certificate_chain(
        \\-----BEGIN BOGUS-----
        \\-----END BOGUS-----
        \\
    ,
        &[0][]const u8{},
    );

    // Try reading byte by byte from a cert reader
    {
        var fbs = std.io.fixedBufferStream(github_pem ++ "\n# Some comment\n" ++ github_pem);
        var it = pemCertificateIterator(fbs.reader());
        // Read a couple of bytes from the first reader, then skip to the next
        {
            const first_reader = (try it.next()) orelse return error.NoCertificate;
            var first_few: [8]u8 = undefined;
            const bytes = try first_reader.readAll(&first_few);
            try std.testing.expectEqual(first_few.len, bytes);
            try std.testing.expectEqualSlices(u8, github_der[0..bytes], &first_few);
        }

        const next_reader = (try it.next()) orelse return error.NoCertificate;
        var idx: usize = 0;
        while (true) : (idx += 1) {
            const byte = next_reader.readByte() catch |err| switch (err) {
                error.EndOfStream => break,
                else => |e| return e,
            };
            if (github_der[idx] != byte) {
                std.debug.panic("index {}: expected 0x{X}, found 0x{X}", .{ idx, github_der[idx], byte });
            }
        }
        try std.testing.expectEqual(github_der.len, idx);
        try std.testing.expect((try it.next()) == null);
    }
}

test "CertificateChain" {
    var fbs = std.io.fixedBufferStream(github_pem ++
        \\
        \\# Hellenic Academic and Research Institutions RootCA 2011
        \\-----BEGIN CERTIFICATE-----
        \\MIIEMTCCAxmgAwIBAgIBADANBgkqhkiG9w0BAQUFADCBlTELMAkGA1UEBhMCR1Ix
        \\RDBCBgNVBAoTO0hlbGxlbmljIEFjYWRlbWljIGFuZCBSZXNlYXJjaCBJbnN0aXR1
        \\dGlvbnMgQ2VydC4gQXV0aG9yaXR5MUAwPgYDVQQDEzdIZWxsZW5pYyBBY2FkZW1p
        \\YyBhbmQgUmVzZWFyY2ggSW5zdGl0dXRpb25zIFJvb3RDQSAyMDExMB4XDTExMTIw
        \\NjEzNDk1MloXDTMxMTIwMTEzNDk1MlowgZUxCzAJBgNVBAYTAkdSMUQwQgYDVQQK
        \\EztIZWxsZW5pYyBBY2FkZW1pYyBhbmQgUmVzZWFyY2ggSW5zdGl0dXRpb25zIENl
        \\cnQuIEF1dGhvcml0eTFAMD4GA1UEAxM3SGVsbGVuaWMgQWNhZGVtaWMgYW5kIFJl
        \\c2VhcmNoIEluc3RpdHV0aW9ucyBSb290Q0EgMjAxMTCCASIwDQYJKoZIhvcNAQEB
        \\BQADggEPADCCAQoCggEBAKlTAOMupvaO+mDYLZU++CwqVE7NuYRhlFhPjz2L5EPz
        \\dYmNUeTDN9KKiE15HrcS3UN4SoqS5tdI1Q+kOilENbgH9mgdVc04UfCMJDGFr4PJ
        \\fel3r+0ae50X+bOdOFAPplp5kYCvN66m0zH7tSYJnTxa71HFK9+WXesyHgLacEns
        \\bgzImjeN9/E2YEsmLIKe0HjzDQ9jpFEw4fkrJxIH2Oq9GGKYsFk3fb7u8yBRQlqD
        \\75O6aRXxYp2fmTmCobd0LovUxQt7L/DICto9eQqakxylKHJzkUOap9FNhYS5qXSP
        \\FEDH3N6sQWRstBmbAmNtJGSPRLIl6s5ddAxjMlyNh+UCAwEAAaOBiTCBhjAPBgNV
        \\HRMBAf8EBTADAQH/MAsGA1UdDwQEAwIBBjAdBgNVHQ4EFgQUppFC/RNhSiOeCKQp
        \\5dgTBCPuQSUwRwYDVR0eBEAwPqA8MAWCAy5ncjAFggMuZXUwBoIELmVkdTAGggQu
        \\b3JnMAWBAy5ncjAFgQMuZXUwBoEELmVkdTAGgQQub3JnMA0GCSqGSIb3DQEBBQUA
        \\A4IBAQAf73lB4XtuP7KMhjdCSk4cNx6NZrokgclPEg8hwAOXhiVtXdMiKahsog2p
        \\6z0GW5k6x8zDmjR/qw7IThzh+uTczQ2+vyT+bOdrwg3IBp5OjWEopmr95fZi6hg8
        \\TqBTnbI6nOulnJEWtk2C4AwFSKls9cz4y51JtPACpf1wA+2KIaWuE4ZJwzNzvoc7
        \\dIsXRSZMFpGD/md9zU1jZ/rzAxKWeAaNsWftjj++n08C9bMJL/NMh98qy5V8Acys
        \\Nnq/onN694/BtZqhFLKPM58N7yLcZnuEvUUXBj08yrl3NI/K6s8/MT7jiOOASSXI
        \\l7WdmplNsDz4SgCbZN2fOUvRJ9e4
        \\-----END CERTIFICATE-----
        \\
        \\# ePKI Root Certification Authority
        \\-----BEGIN CERTIFICATE-----
        \\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
        \\hNQ+IIX3Sj0rnP0qCglN6oH4EZw=
        \\-----END CERTIFICATE-----
    );
    const chain = try CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer chain.deinit();
}
