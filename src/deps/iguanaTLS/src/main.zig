const std = @import("std");
const mem = std.mem;
const Allocator = mem.Allocator;
const Sha224 = std.crypto.hash.sha2.Sha224;
const Sha384 = std.crypto.hash.sha2.Sha384;
const Sha512 = std.crypto.hash.sha2.Sha512;
const Sha256 = std.crypto.hash.sha2.Sha256;
const Hmac256 = std.crypto.auth.hmac.sha2.HmacSha256;

pub const asn1 = @import("asn1.zig");
pub const x509 = @import("x509.zig");
pub const crypto = @import("crypto.zig");

const ciphers = @import("ciphersuites.zig");
pub const ciphersuites = ciphers.suites;

pub const @"pcks1v1.5" = @import("pcks1-1_5.zig");

comptime {
    std.testing.refAllDecls(x509);
    std.testing.refAllDecls(asn1);
    std.testing.refAllDecls(crypto);
}

fn handshake_record_length(reader: anytype) !usize {
    return try record_length(0x16, reader);
}

pub const RecordHeader = struct {
    data: [5]u8,

    pub inline fn tag(self: @This()) u8 {
        return self.data[0];
    }

    pub inline fn len(self: @This()) u16 {
        return mem.readIntSliceBig(u16, self.data[3..]);
    }
};

pub fn record_header(reader: anytype) !RecordHeader {
    var header: [5]u8 = undefined;
    try reader.readNoEof(&header);

    if (!mem.eql(u8, header[1..3], "\x03\x03") and !mem.eql(u8, header[1..3], "\x03\x01"))
        return error.ServerInvalidVersion;

    return RecordHeader{
        .data = header,
    };
}

pub fn record_length(t: u8, reader: anytype) !usize {
    try check_record_type(t, reader);
    var header: [4]u8 = undefined;
    try reader.readNoEof(&header);
    if (!mem.eql(u8, header[0..2], "\x03\x03") and !mem.eql(u8, header[0..2], "\x03\x01"))
        return error.ServerInvalidVersion;
    return mem.readIntSliceBig(u16, header[2..4]);
}

pub const ServerAlert = error{
    AlertCloseNotify,
    AlertUnexpectedMessage,
    AlertBadRecordMAC,
    AlertDecryptionFailed,
    AlertRecordOverflow,
    AlertDecompressionFailure,
    AlertHandshakeFailure,
    AlertNoCertificate,
    AlertBadCertificate,
    AlertUnsupportedCertificate,
    AlertCertificateRevoked,
    AlertCertificateExpired,
    AlertCertificateUnknown,
    AlertIllegalParameter,
    AlertUnknownCA,
    AlertAccessDenied,
    AlertDecodeError,
    AlertDecryptError,
    AlertExportRestriction,
    AlertProtocolVersion,
    AlertInsufficientSecurity,
    AlertInternalError,
    AlertUserCanceled,
    AlertNoRenegotiation,
    AlertUnsupportedExtension,
};

fn check_record_type(
    expected: u8,
    reader: anytype,
) (@TypeOf(reader).Error || ServerAlert || error{ ServerMalformedResponse, EndOfStream })!void {
    const record_type = try reader.readByte();
    // Alert
    if (record_type == 0x15) {
        // Skip SSL version, length of record
        try reader.skipBytes(4, .{});

        const severity = try reader.readByte();
        _ = severity;
        const err_num = try reader.readByte();
        return alert_byte_to_error(err_num);
    }
    if (record_type != expected)
        return error.ServerMalformedResponse;
}

pub fn alert_byte_to_error(b: u8) (ServerAlert || error{ServerMalformedResponse}) {
    return switch (b) {
        0 => error.AlertCloseNotify,
        10 => error.AlertUnexpectedMessage,
        20 => error.AlertBadRecordMAC,
        21 => error.AlertDecryptionFailed,
        22 => error.AlertRecordOverflow,
        30 => error.AlertDecompressionFailure,
        40 => error.AlertHandshakeFailure,
        41 => error.AlertNoCertificate,
        42 => error.AlertBadCertificate,
        43 => error.AlertUnsupportedCertificate,
        44 => error.AlertCertificateRevoked,
        45 => error.AlertCertificateExpired,
        46 => error.AlertCertificateUnknown,
        47 => error.AlertIllegalParameter,
        48 => error.AlertUnknownCA,
        49 => error.AlertAccessDenied,
        50 => error.AlertDecodeError,
        51 => error.AlertDecryptError,
        60 => error.AlertExportRestriction,
        70 => error.AlertProtocolVersion,
        71 => error.AlertInsufficientSecurity,
        80 => error.AlertInternalError,
        90 => error.AlertUserCanceled,
        100 => error.AlertNoRenegotiation,
        110 => error.AlertUnsupportedExtension,
        else => error.ServerMalformedResponse,
    };
}

// TODO: Now that we keep all the hashes, check the ciphersuite for the hash
//   type used and use it where necessary instead of hardcoding sha256
const HashSet = struct {
    sha224: Sha224,
    sha256: Sha256,
    sha384: Sha384,
    sha512: Sha512,

    fn update(self: *@This(), buf: []const u8) void {
        self.sha224.update(buf);
        self.sha256.update(buf);
        self.sha384.update(buf);
        self.sha512.update(buf);
    }
};

fn HashingReader(comptime Reader: anytype) type {
    const State = struct {
        hash_set: *HashSet,
        reader: Reader,
    };
    const S = struct {
        pub fn read(state: State, buffer: []u8) Reader.Error!usize {
            const amt = try state.reader.read(buffer);
            if (amt != 0) {
                state.hash_set.update(buffer[0..amt]);
            }
            return amt;
        }
    };
    return std.io.Reader(State, Reader.Error, S.read);
}

fn make_hashing_reader(hash_set: *HashSet, reader: anytype) HashingReader(@TypeOf(reader)) {
    return .{ .context = .{ .hash_set = hash_set, .reader = reader } };
}

fn HashingWriter(comptime Writer: anytype) type {
    const State = struct {
        hash_set: *HashSet,
        writer: Writer,
    };
    const S = struct {
        pub fn write(state: State, buffer: []const u8) Writer.Error!usize {
            const amt = try state.writer.write(buffer);
            if (amt != 0) {
                state.hash_set.update(buffer[0..amt]);
            }
            return amt;
        }
    };
    return std.io.Writer(State, Writer.Error, S.write);
}

fn make_hashing_writer(hash_set: *HashSet, writer: anytype) HashingWriter(@TypeOf(writer)) {
    return .{ .context = .{ .hash_set = hash_set, .writer = writer } };
}

fn CertificateReaderState(comptime Reader: type) type {
    return struct {
        reader: Reader,
        length: usize,
        idx: usize = 0,
    };
}

fn CertificateReader(comptime Reader: type) type {
    const S = struct {
        pub fn read(state: *CertificateReaderState(Reader), buffer: []u8) Reader.Error!usize {
            const out_bytes = std.math.min(buffer.len, state.length - state.idx);
            const res = try state.reader.readAll(buffer[0..out_bytes]);
            state.idx += res;
            return res;
        }
    };

    return std.io.Reader(*CertificateReaderState(Reader), Reader.Error, S.read);
}

pub const CertificateVerifier = union(enum) {
    none,
    function: anytype,
    default,
};

pub fn CertificateVerifierReader(comptime Reader: type) type {
    return CertificateReader(HashingReader(Reader));
}

pub fn ClientConnectError(
    comptime verifier: CertificateVerifier,
    comptime Reader: type,
    comptime Writer: type,
    comptime has_client_certs: bool,
) type {
    const Additional = error{
        ServerInvalidVersion,
        ServerMalformedResponse,
        EndOfStream,
        ServerInvalidCipherSuite,
        ServerInvalidCompressionMethod,
        ServerInvalidRenegotiationData,
        ServerInvalidECPointCompression,
        ServerInvalidProtocol,
        ServerInvalidExtension,
        ServerInvalidCurve,
        ServerInvalidSignature,
        ServerInvalidSignatureAlgorithm,
        ServerAuthenticationFailed,
        ServerInvalidVerifyData,
        PreMasterGenerationFailed,
        OutOfMemory,
    };
    const err_msg = "Certificate verifier function cannot be generic, use CertificateVerifierReader to get the reader argument type";
    return Reader.Error || Writer.Error || ServerAlert || Additional || switch (verifier) {
        .none => error{},
        .function => |f| @typeInfo(@typeInfo(@TypeOf(f)).Fn.return_type orelse
            @compileError(err_msg)).ErrorUnion.error_set || error{CertificateVerificationFailed},
        .default => error{CertificateVerificationFailed},
    } || (if (has_client_certs) error{ClientCertificateVerifyFailed} else error{});
}

// See http://howardhinnant.github.io/date_algorithms.html
// Timestamp in seconds, only supports A.D. dates
fn unix_timestamp_from_civil_date(year: u16, month: u8, day: u8) i64 {
    var y: i64 = year;
    if (month <= 2) y -= 1;
    const era = @divTrunc(y, 400);
    const yoe = y - era * 400; // [0, 399]
    const doy = @divTrunc((153 * (month + (if (month > 2) @as(i64, -3) else 9)) + 2), 5) + day - 1; // [0, 365]
    const doe = yoe * 365 + @divTrunc(yoe, 4) - @divTrunc(yoe, 100) + doy; // [0, 146096]
    return (era * 146097 + doe - 719468) * 86400;
}

fn read_der_utc_timestamp(reader: anytype) !i64 {
    var buf: [17]u8 = undefined;

    const tag = try reader.readByte();
    if (tag != 0x17)
        return error.CertificateVerificationFailed;
    const len = try asn1.der.parse_length(reader);
    if (len > 17)
        return error.CertificateVerificationFailed;

    try reader.readNoEof(buf[0..len]);
    const year = std.fmt.parseUnsigned(u16, buf[0..2], 10) catch
        return error.CertificateVerificationFailed;
    const month = std.fmt.parseUnsigned(u8, buf[2..4], 10) catch
        return error.CertificateVerificationFailed;
    const day = std.fmt.parseUnsigned(u8, buf[4..6], 10) catch
        return error.CertificateVerificationFailed;

    var time = unix_timestamp_from_civil_date(2000 + year, month, day);
    time += (std.fmt.parseUnsigned(i64, buf[6..8], 10) catch
        return error.CertificateVerificationFailed) * 3600;
    time += (std.fmt.parseUnsigned(i64, buf[8..10], 10) catch
        return error.CertificateVerificationFailed) * 60;

    if (buf[len - 1] == 'Z') {
        if (len == 13) {
            time += std.fmt.parseUnsigned(u8, buf[10..12], 10) catch
                return error.CertificateVerificationFailed;
        } else if (len != 11) {
            return error.CertificateVerificationFailed;
        }
    } else {
        if (len == 15) {
            if (buf[10] != '+' and buf[10] != '-')
                return error.CertificateVerificationFailed;

            var additional = (std.fmt.parseUnsigned(i64, buf[11..13], 10) catch
                return error.CertificateVerificationFailed) * 3600;
            additional += (std.fmt.parseUnsigned(i64, buf[13..15], 10) catch
                return error.CertificateVerificationFailed) * 60;

            time += if (buf[10] == '+') -additional else additional;
        } else if (len == 17) {
            if (buf[12] != '+' and buf[12] != '-')
                return error.CertificateVerificationFailed;
            time += std.fmt.parseUnsigned(u8, buf[10..12], 10) catch
                return error.CertificateVerificationFailed;

            var additional = (std.fmt.parseUnsigned(i64, buf[13..15], 10) catch
                return error.CertificateVerificationFailed) * 3600;
            additional += (std.fmt.parseUnsigned(i64, buf[15..17], 10) catch
                return error.CertificateVerificationFailed) * 60;

            time += if (buf[12] == '+') -additional else additional;
        } else return error.CertificateVerificationFailed;
    }
    return time;
}

fn check_cert_timestamp(time: i64, tag_byte: u8, length: usize, reader: anytype) !void {
    _ = tag_byte;
    _ = length;
    if (time < (try read_der_utc_timestamp(reader)))
        return error.CertificateVerificationFailed;
    if (time > (try read_der_utc_timestamp(reader)))
        return error.CertificateVerificationFailed;
}

fn add_dn_field(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    _ = length;
    _ = tag;

    const seq_tag = try reader.readByte();
    if (seq_tag != 0x30)
        return error.CertificateVerificationFailed;
    const seq_length = try asn1.der.parse_length(reader);
    _ = seq_length;

    const oid_tag = try reader.readByte();
    if (oid_tag != 0x06)
        return error.CertificateVerificationFailed;

    const oid_length = try asn1.der.parse_length(reader);
    if (oid_length == 3 and (try reader.isBytes("\x55\x04\x03"))) {
        // Common name
        const common_name_tag = try reader.readByte();
        if (common_name_tag != 0x04 and common_name_tag != 0x0c and common_name_tag != 0x13 and common_name_tag != 0x16)
            return error.CertificateVerificationFailed;
        const common_name_len = try asn1.der.parse_length(reader);
        state.list.items[state.list.items.len - 1].common_name = state.fbs.buffer[state.fbs.pos .. state.fbs.pos + common_name_len];
    }
}

fn add_cert_subject_dn(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    state.list.items[state.list.items.len - 1].dn = state.fbs.buffer[state.fbs.pos .. state.fbs.pos + length];
    const schema = .{
        .sequence_of,
        .{
            .capture, 0, .set,
        },
    };
    const captures = .{
        state, add_dn_field,
    };
    try asn1.der.parse_schema_tag_len(tag, length, schema, captures, reader);
}

fn add_cert_public_key(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    _ = tag;
    _ = length;

    state.list.items[state.list.items.len - 1].public_key = x509.parse_public_key(
        state.allocator,
        reader,
    ) catch |err| switch (err) {
        error.MalformedDER => return error.CertificateVerificationFailed,
        else => |e| return e,
    };
}

fn add_cert_extensions(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    _ = tag;
    _ = length;

    const schema = .{
        .sequence_of,
        .{ .capture, 0, .sequence },
    };
    const captures = .{
        state, add_cert_extension,
    };

    try asn1.der.parse_schema(schema, captures, reader);
}

fn add_cert_extension(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    _ = tag;
    _ = length;

    const start = state.fbs.pos;

    // The happy path is allocation free
    // TODO: add a preflight check to mandate a specific tag
    const object_id = try asn1.der.parse_value(state.allocator, reader);
    defer object_id.deinit(state.allocator);
    if (object_id != .object_identifier) return error.DoesNotMatchSchema;
    if (object_id.object_identifier.len != 4)
        return;

    const data = object_id.object_identifier.data;
    // Prefix == id-ce
    if (data[0] != 2 or data[1] != 5 or data[2] != 29)
        return;

    switch (data[3]) {
        17 => {
            const san_tag = try reader.readByte();
            if (san_tag != @enumToInt(asn1.Tag.octet_string)) return error.DoesNotMatchSchema;

            const san_length = try asn1.der.parse_length(reader);
            _ = san_length;

            const body_tag = try reader.readByte();
            if (body_tag != @enumToInt(asn1.Tag.sequence)) return error.DoesNotMatchSchema;

            const body_length = try asn1.der.parse_length(reader);
            const total_read = state.fbs.pos - start;
            if (total_read + body_length > length) return error.DoesNotMatchSchema;

            state.list.items[state.list.items.len - 1].raw_subject_alternative_name = state.fbs.buffer[state.fbs.pos .. state.fbs.pos + body_length];

            // Validate to make sure this is iterable later
            const ref = state.fbs.pos;
            while (state.fbs.pos - ref < body_length) {
                const choice = try reader.readByte();
                if (choice < 0x80) return error.DoesNotMatchSchema;

                const chunk_length = try asn1.der.parse_length(reader);
                _ = try reader.skipBytes(chunk_length, .{});
            }
        },
        else => {},
    }
}

fn add_server_cert(state: *VerifierCaptureState, tag_byte: u8, length: usize, reader: anytype) !void {
    const is_ca = state.list.items.len != 0;

    // TODO: Some way to get tag + length buffer directly in the capture callback?
    const encoded_length = asn1.der.encode_length(length).slice();
    // This is not errdefered since default_cert_verifier call takes care of cleaning up all the certificate data.
    // Same for the signature.data
    const cert_bytes = try state.allocator.alloc(u8, length + 1 + encoded_length.len);
    cert_bytes[0] = tag_byte;
    mem.copy(u8, cert_bytes[1 .. 1 + encoded_length.len], encoded_length);

    try reader.readNoEof(cert_bytes[1 + encoded_length.len ..]);
    (try state.list.addOne(state.allocator)).* = .{
        .is_ca = is_ca,
        .bytes = cert_bytes,
        .dn = undefined,
        .common_name = &[0]u8{},
        .raw_subject_alternative_name = &[0]u8{},
        .public_key = x509.PublicKey.empty,
        .signature = asn1.BitString{ .data = &[0]u8{}, .bit_len = 0 },
        .signature_algorithm = undefined,
    };

    const schema = .{
        .sequence,
        .{
            .{ .context_specific, 0 }, // version
            .{.int}, // serialNumber
            .{.sequence}, // signature
            .{.sequence}, // issuer
            .{ .capture, 0, .sequence }, // validity
            .{ .capture, 1, .sequence }, // subject
            .{ .capture, 2, .sequence }, // subjectPublicKeyInfo
            .{ .optional, .context_specific, 1 }, // issuerUniqueID
            .{ .optional, .context_specific, 2 }, // subjectUniqueID
            .{ .capture, 3, .optional, .context_specific, 3 }, // extensions
        },
    };

    const captures = .{
        std.time.timestamp(), check_cert_timestamp,
        state,                add_cert_subject_dn,
        state,                add_cert_public_key,
        state,                add_cert_extensions,
    };

    var fbs = std.io.fixedBufferStream(@as([]const u8, cert_bytes[1 + encoded_length.len ..]));
    state.fbs = &fbs;

    asn1.der.parse_schema_tag_len(tag_byte, length, schema, captures, fbs.reader()) catch |err| switch (err) {
        error.InvalidLength,
        error.InvalidTag,
        error.InvalidContainerLength,
        error.DoesNotMatchSchema,
        => return error.CertificateVerificationFailed,
        else => |e| return e,
    };
}

fn set_signature_algorithm(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    _ = tag;
    _ = length;

    const cert = &state.list.items[state.list.items.len - 1];
    cert.signature_algorithm = (try x509.get_signature_algorithm(reader)) orelse return error.CertificateVerificationFailed;
}

fn set_signature_value(state: *VerifierCaptureState, tag: u8, length: usize, reader: anytype) !void {
    _ = tag;
    _ = length;

    const unused_bits = try reader.readByte();
    const bit_count = (length - 1) * 8 - unused_bits;
    const signature_bytes = try state.allocator.alloc(u8, length - 1);
    errdefer state.allocator.free(signature_bytes);
    try reader.readNoEof(signature_bytes);
    state.list.items[state.list.items.len - 1].signature = .{
        .data = signature_bytes,
        .bit_len = bit_count,
    };
}

const ServerCertificate = struct {
    bytes: []const u8,
    dn: []const u8,
    common_name: []const u8,
    raw_subject_alternative_name: []const u8,
    public_key: x509.PublicKey,
    signature: asn1.BitString,
    signature_algorithm: x509.Certificate.SignatureAlgorithm,
    is_ca: bool,

    const GeneralName = enum(u5) {
        other_name = 0,
        rfc822_name = 1,
        dns_name = 2,
        x400_address = 3,
        directory_name = 4,
        edi_party_name = 5,
        uniform_resource_identifier = 6,
        ip_address = 7,
        registered_id = 8,
    };

    fn iterSAN(self: ServerCertificate, choice: GeneralName) NameIterator {
        return .{ .cert = self, .choice = choice };
    }

    const NameIterator = struct {
        cert: ServerCertificate,
        choice: GeneralName,
        pos: usize = 0,

        fn next(self: *NameIterator) ?[]const u8 {
            while (self.pos < self.cert.raw_subject_alternative_name.len) {
                const choice = self.cert.raw_subject_alternative_name[self.pos];
                std.debug.assert(choice >= 0x80);
                const len = self.cert.raw_subject_alternative_name[self.pos + 1];
                const start = self.pos + 2;
                const end = start + len;
                self.pos = end;
                if (@enumToInt(self.choice) == choice - 0x80) {
                    return self.cert.raw_subject_alternative_name[start..end];
                }
            }
            return null;
        }
    };
};

const VerifierCaptureState = struct {
    list: std.ArrayListUnmanaged(ServerCertificate),
    allocator: *Allocator,
    // Used in `add_server_cert` to avoid an extra allocation
    fbs: *std.io.FixedBufferStream([]const u8),
};

// @TODO Move out of here
const ReverseSplitIterator = struct {
    buffer: []const u8,
    index: ?usize,
    delimiter: []const u8,

    pub fn next(self: *ReverseSplitIterator) ?[]const u8 {
        const end = self.index orelse return null;
        const start = if (mem.lastIndexOfLinear(u8, self.buffer[0..end], self.delimiter)) |delim_start| blk: {
            self.index = delim_start;
            break :blk delim_start + self.delimiter.len;
        } else blk: {
            self.index = null;
            break :blk 0;
        };
        return self.buffer[start..end];
    }
};

fn reverse_split(buffer: []const u8, delimiter: []const u8) ReverseSplitIterator {
    std.debug.assert(delimiter.len != 0);
    return .{
        .index = buffer.len,
        .buffer = buffer,
        .delimiter = delimiter,
    };
}

fn cert_name_matches(cert_name: []const u8, hostname: []const u8) bool {
    var cert_name_split = reverse_split(cert_name, ".");
    var hostname_split = reverse_split(hostname, ".");
    while (true) {
        const cn_part = cert_name_split.next();
        const hn_part = hostname_split.next();

        if (cn_part) |cnp| {
            if (hn_part == null and cert_name_split.index == null and mem.eql(u8, cnp, "www"))
                return true
            else if (hn_part) |hnp| {
                if (mem.eql(u8, cnp, "*"))
                    continue;
                if (!mem.eql(u8, cnp, hnp))
                    return false;
            }
        } else return hn_part == null;
    }
}

pub fn default_cert_verifier(
    allocator: *mem.Allocator,
    reader: anytype,
    certs_bytes: usize,
    trusted_certificates: []const x509.Certificate,
    hostname: []const u8,
) !x509.PublicKey {
    var capture_state = VerifierCaptureState{
        .list = try std.ArrayListUnmanaged(ServerCertificate).initCapacity(allocator, 3),
        .allocator = allocator,
        .fbs = undefined,
    };
    defer {
        for (capture_state.list.items) |cert| {
            cert.public_key.deinit(allocator);
            allocator.free(cert.bytes);
            allocator.free(cert.signature.data);
        }
        capture_state.list.deinit(allocator);
    }

    const schema = .{
        .sequence, .{
            // tbsCertificate
            .{ .capture, 0, .sequence },
            // signatureAlgorithm
            .{ .capture, 1, .sequence },
            // signatureValue
            .{ .capture, 2, .bit_string },
        },
    };
    const captures = .{
        &capture_state, add_server_cert,
        &capture_state, set_signature_algorithm,
        &capture_state, set_signature_value,
    };

    var bytes_read: u24 = 0;
    while (bytes_read < certs_bytes) {
        const cert_length = try reader.readIntBig(u24);

        asn1.der.parse_schema(schema, captures, reader) catch |err| switch (err) {
            error.InvalidLength,
            error.InvalidTag,
            error.InvalidContainerLength,
            error.DoesNotMatchSchema,
            => return error.CertificateVerificationFailed,
            else => |e| return e,
        };

        bytes_read += 3 + cert_length;
    }
    if (bytes_read != certs_bytes)
        return error.CertificateVerificationFailed;

    const chain = capture_state.list.items;
    if (chain.len == 0) return error.CertificateVerificationFailed;
    // Check if the hostname matches one of the leaf certificate's names
    name_matched: {
        if (cert_name_matches(chain[0].common_name, hostname)) {
            break :name_matched;
        }

        var iter = chain[0].iterSAN(.dns_name);
        while (iter.next()) |cert_name| {
            if (cert_name_matches(cert_name, hostname)) {
                break :name_matched;
            }
        }

        return error.CertificateVerificationFailed;
    }

    var i: usize = 0;
    while (i < chain.len - 1) : (i += 1) {
        if (!try @"pcks1v1.5".certificate_verify_signature(
            allocator,
            chain[i].signature_algorithm,
            chain[i].signature,
            chain[i].bytes,
            chain[i + 1].public_key,
        )) {
            return error.CertificateVerificationFailed;
        }
    }

    for (chain) |cert| {
        for (trusted_certificates) |trusted| {
            // Try to find an exact match to a trusted certificate
            if (cert.is_ca == trusted.is_ca and mem.eql(u8, cert.dn, trusted.dn) and
                cert.public_key.eql(trusted.public_key))
            {
                const key = chain[0].public_key;
                chain[0].public_key = x509.PublicKey.empty;
                return key;
            }

            if (!trusted.is_ca)
                continue;

            if (try @"pcks1v1.5".certificate_verify_signature(
                allocator,
                cert.signature_algorithm,
                cert.signature,
                cert.bytes,
                trusted.public_key,
            )) {
                const key = chain[0].public_key;
                chain[0].public_key = x509.PublicKey.empty;
                return key;
            }
        }
    }
    return error.CertificateVerificationFailed;
}

pub fn extract_cert_public_key(allocator: *Allocator, reader: anytype, length: usize) !x509.PublicKey {
    const CaptureState = struct {
        pub_key: x509.PublicKey,
        allocator: *Allocator,
    };
    var capture_state = CaptureState{
        .pub_key = undefined,
        .allocator = allocator,
    };

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
                    .{.sequence}, // validity
                    .{.sequence}, // subject
                    .{ .capture, 0, .sequence }, // subjectPublicKeyInfo
                    .{ .optional, .context_specific, 1 }, // issuerUniqueID
                    .{ .optional, .context_specific, 2 }, // subjectUniqueID
                    .{ .optional, .context_specific, 3 }, // extensions
                },
            },
            // signatureAlgorithm
            .{.sequence},
            // signatureValue
            .{.bit_string},
        },
    };
    const captures = .{
        &capture_state, struct {
            fn f(state: *CaptureState, tag: u8, _length: usize, subreader: anytype) !void {
                _ = tag;
                _ = _length;

                state.pub_key = x509.parse_public_key(state.allocator, subreader) catch |err| switch (err) {
                    error.MalformedDER => return error.ServerMalformedResponse,
                    else => |e| return e,
                };
            }
        }.f,
    };

    const cert_length = try reader.readIntBig(u24);
    asn1.der.parse_schema(schema, captures, reader) catch |err| switch (err) {
        error.InvalidLength,
        error.InvalidTag,
        error.InvalidContainerLength,
        error.DoesNotMatchSchema,
        => return error.ServerMalformedResponse,
        else => |e| return e,
    };
    errdefer capture_state.pub_key.deinit(allocator);

    try reader.skipBytes(length - cert_length - 3, .{});
    return capture_state.pub_key;
}

pub const curves = struct {
    pub const x25519 = struct {
        pub const name = "x25519";
        const tag = 0x001D;
        const pub_key_len = 32;
        const Keys = std.crypto.dh.X25519.KeyPair;

        inline fn make_key_pair(rand: *std.rand.Random) Keys {
            while (true) {
                var seed: [32]u8 = undefined;
                rand.bytes(&seed);
                return std.crypto.dh.X25519.KeyPair.create(seed) catch continue;
            } else unreachable;
        }

        inline fn make_pre_master_secret(
            key_pair: Keys,
            pre_master_secret_buf: []u8,
            server_public_key: *const [32]u8,
        ) ![]const u8 {
            pre_master_secret_buf[0..32].* = std.crypto.dh.X25519.scalarmult(
                key_pair.secret_key,
                server_public_key.*,
            ) catch return error.PreMasterGenerationFailed;
            return pre_master_secret_buf[0..32];
        }
    };

    pub const secp384r1 = struct {
        pub const name = "secp384r1";
        const tag = 0x0018;
        const pub_key_len = 97;
        const Keys = crypto.ecc.KeyPair(crypto.ecc.SECP384R1);

        inline fn make_key_pair(rand: *std.rand.Random) Keys {
            var seed: [48]u8 = undefined;
            rand.bytes(&seed);
            return crypto.ecc.make_key_pair(crypto.ecc.SECP384R1, seed);
        }

        inline fn make_pre_master_secret(
            key_pair: Keys,
            pre_master_secret_buf: []u8,
            server_public_key: *const [97]u8,
        ) ![]const u8 {
            pre_master_secret_buf[0..96].* = crypto.ecc.scalarmult(
                crypto.ecc.SECP384R1,
                server_public_key[1..].*,
                &key_pair.secret_key,
            ) catch return error.PreMasterGenerationFailed;
            return pre_master_secret_buf[0..48];
        }
    };

    pub const secp256r1 = struct {
        pub const name = "secp256r1";
        const tag = 0x0017;
        const pub_key_len = 65;
        const Keys = crypto.ecc.KeyPair(crypto.ecc.SECP256R1);

        inline fn make_key_pair(rand: *std.rand.Random) Keys {
            var seed: [32]u8 = undefined;
            rand.bytes(&seed);
            return crypto.ecc.make_key_pair(crypto.ecc.SECP256R1, seed);
        }

        inline fn make_pre_master_secret(
            key_pair: Keys,
            pre_master_secret_buf: []u8,
            server_public_key: *const [65]u8,
        ) ![]const u8 {
            pre_master_secret_buf[0..64].* = crypto.ecc.scalarmult(
                crypto.ecc.SECP256R1,
                server_public_key[1..].*,
                &key_pair.secret_key,
            ) catch return error.PreMasterGenerationFailed;
            return pre_master_secret_buf[0..32];
        }
    };

    pub const all = &[_]type{ x25519, secp384r1, secp256r1 };

    fn max_pub_key_len(comptime list: anytype) usize {
        var max: usize = 0;
        for (list) |curve| {
            if (curve.pub_key_len > max)
                max = curve.pub_key_len;
        }
        return max;
    }

    fn max_pre_master_secret_len(comptime list: anytype) usize {
        var max: usize = 0;
        for (list) |curve| {
            const curr = @typeInfo(std.meta.fieldInfo(curve.Keys, .public_key).field_type).Array.len;
            if (curr > max)
                max = curr;
        }
        return max;
    }

    fn KeyPair(comptime list: anytype) type {
        var fields: [list.len]std.builtin.TypeInfo.UnionField = undefined;
        for (list) |curve, i| {
            fields[i] = .{
                .name = curve.name,
                .field_type = curve.Keys,
                .alignment = @alignOf(curve.Keys),
            };
        }
        return @Type(.{
            .Union = .{
                .layout = .Extern,
                .tag_type = null,
                .fields = &fields,
                .decls = &[0]std.builtin.TypeInfo.Declaration{},
            },
        });
    }

    inline fn make_key_pair(comptime list: anytype, curve_id: u16, rand: *std.rand.Random) KeyPair(list) {
        inline for (list) |curve| {
            if (curve.tag == curve_id) {
                return @unionInit(KeyPair(list), curve.name, curve.make_key_pair(rand));
            }
        }
        unreachable;
    }

    inline fn make_pre_master_secret(
        comptime list: anytype,
        curve_id: u16,
        key_pair: KeyPair(list),
        pre_master_secret_buf: *[max_pre_master_secret_len(list)]u8,
        server_public_key: [max_pub_key_len(list)]u8,
    ) ![]const u8 {
        inline for (list) |curve| {
            if (curve.tag == curve_id) {
                return try curve.make_pre_master_secret(
                    @field(key_pair, curve.name),
                    pre_master_secret_buf,
                    server_public_key[0..curve.pub_key_len],
                );
            }
        }
        unreachable;
    }
};

pub fn client_connect(
    options: anytype,
    hostname: []const u8,
) ClientConnectError(
    options.cert_verifier,
    @TypeOf(options.reader),
    @TypeOf(options.writer),
    @hasField(@TypeOf(options), "client_certificates"),
)!Client(
    @TypeOf(options.reader),
    @TypeOf(options.writer),
    if (@hasField(@TypeOf(options), "ciphersuites"))
        options.ciphersuites
    else
        ciphersuites.all,
    @hasField(@TypeOf(options), "protocols"),
) {
    const Options = @TypeOf(options);
    if (@TypeOf(options.cert_verifier) != CertificateVerifier and
        @TypeOf(options.cert_verifier) != @Type(.EnumLiteral))
        @compileError("cert_verifier should be of type CertificateVerifier");

    if (!@hasField(Options, "temp_allocator"))
        @compileError("Option tuple is missing field 'temp_allocator'");
    if (options.cert_verifier == .default) {
        if (!@hasField(Options, "trusted_certificates"))
            @compileError("Option tuple is missing field 'trusted_certificates' for .default cert_verifier");
    }

    const suites = if (!@hasField(Options, "ciphersuites"))
        ciphersuites.all
    else
        options.ciphersuites;
    if (suites.len == 0)
        @compileError("Must provide at least one ciphersuite type.");

    const curvelist = if (!@hasField(Options, "curves"))
        curves.all
    else
        options.curves;
    if (curvelist.len == 0)
        @compileError("Must provide at least one curve type.");

    const has_alpn = comptime @hasField(Options, "protocols");
    var handshake_record_hash_set = HashSet{
        .sha224 = Sha224.init(.{}),
        .sha256 = Sha256.init(.{}),
        .sha384 = Sha384.init(.{}),
        .sha512 = Sha512.init(.{}),
    };
    const reader = options.reader;
    const writer = options.writer;
    const hashing_reader = make_hashing_reader(&handshake_record_hash_set, reader);
    const hashing_writer = make_hashing_writer(&handshake_record_hash_set, writer);

    var client_random: [32]u8 = undefined;
    const rand = if (!@hasField(Options, "rand"))
        std.crypto.random
    else
        options.rand;

    rand.bytes(&client_random);

    var server_random: [32]u8 = undefined;
    const ciphersuite_bytes = 2 * suites.len + 2;
    const alpn_bytes = if (has_alpn) blk: {
        var sum: usize = 0;
        for (options.protocols) |proto| {
            sum += proto.len;
        }
        break :blk 6 + options.protocols.len + sum;
    } else 0;
    const curvelist_bytes = 2 * curvelist.len;
    var protocol: if (has_alpn) []const u8 else void = undefined;
    {
        const client_hello_start = comptime blk: {
            // TODO: We assume the compiler is running in a little endian system
            var starting_part: [46]u8 = [_]u8{
                // Record header: Handshake record type, protocol version, handshake size
                0x16, 0x03,      0x01,      undefined, undefined,
                // Handshake message type, bytes of client hello
                0x01, undefined, undefined, undefined,
                // Client version (hardcoded to TLS 1.2 even for TLS 1.3)
                0x03,
                0x03,
            } ++ ([1]u8{undefined} ** 32) ++ [_]u8{
                // Session ID
                0x00,
            } ++ mem.toBytes(@byteSwap(u16, ciphersuite_bytes));
            // using .* = mem.asBytes(...).* or mem.writeIntBig didn't work...

            // Same as above, couldnt achieve this with a single buffer.
            // TLS_EMPTY_RENEGOTIATION_INFO_SCSV
            var ciphersuite_buf: []const u8 = &[2]u8{ 0x00, 0x0f };
            for (suites) |cs| {
                // Also check for properties of the ciphersuites here
                if (cs.key_exchange != .ecdhe)
                    @compileError("Non ECDHE key exchange is not supported yet.");
                if (cs.hash != .sha256)
                    @compileError("Non SHA256 hash algorithm is not supported yet.");

                ciphersuite_buf = ciphersuite_buf ++ mem.toBytes(@byteSwap(u16, cs.tag));
            }

            var ending_part: [13]u8 = [_]u8{
                // Compression methods (no compression)
                0x01,      0x00,
                // Extensions length
                undefined, undefined,
                // Extension: server name
                // id, length, length of entry
                0x00,      0x00,
                undefined, undefined,
                undefined, undefined,
                // entry type, length of bytes
                0x00,      undefined,
                undefined,
            };
            break :blk starting_part ++ ciphersuite_buf ++ ending_part;
        };

        var msg_buf = client_hello_start.ptr[0..client_hello_start.len].*;
        mem.writeIntBig(u16, msg_buf[3..5], @intCast(u16, alpn_bytes + hostname.len + 0x55 + ciphersuite_bytes + curvelist_bytes));
        mem.writeIntBig(u24, msg_buf[6..9], @intCast(u24, alpn_bytes + hostname.len + 0x51 + ciphersuite_bytes + curvelist_bytes));
        mem.copy(u8, msg_buf[11..43], &client_random);
        mem.writeIntBig(u16, msg_buf[48 + ciphersuite_bytes ..][0..2], @intCast(u16, alpn_bytes + hostname.len + 0x28 + curvelist_bytes));
        mem.writeIntBig(u16, msg_buf[52 + ciphersuite_bytes ..][0..2], @intCast(u16, hostname.len + 5));
        mem.writeIntBig(u16, msg_buf[54 + ciphersuite_bytes ..][0..2], @intCast(u16, hostname.len + 3));
        mem.writeIntBig(u16, msg_buf[57 + ciphersuite_bytes ..][0..2], @intCast(u16, hostname.len));
        try writer.writeAll(msg_buf[0..5]);
        try hashing_writer.writeAll(msg_buf[5..]);
    }
    try hashing_writer.writeAll(hostname);
    if (has_alpn) {
        var msg_buf = [6]u8{ 0x00, 0x10, undefined, undefined, undefined, undefined };
        mem.writeIntBig(u16, msg_buf[2..4], @intCast(u16, alpn_bytes - 4));
        mem.writeIntBig(u16, msg_buf[4..6], @intCast(u16, alpn_bytes - 6));
        try hashing_writer.writeAll(&msg_buf);
        for (options.protocols) |proto| {
            try hashing_writer.writeByte(@intCast(u8, proto.len));
            try hashing_writer.writeAll(proto);
        }
    }

    // Extension: supported groups
    {
        var msg_buf = [6]u8{
            0x00,      0x0A,
            undefined, undefined,
            undefined, undefined,
        };

        mem.writeIntBig(u16, msg_buf[2..4], @intCast(u16, curvelist_bytes + 2));
        mem.writeIntBig(u16, msg_buf[4..6], @intCast(u16, curvelist_bytes));
        try hashing_writer.writeAll(&msg_buf);

        inline for (curvelist) |curve| {
            try hashing_writer.writeIntBig(u16, curve.tag);
        }
    }

    try hashing_writer.writeAll(&[25]u8{
        // Extension: EC point formats => uncompressed point format
        0x00, 0x0B, 0x00, 0x02, 0x01, 0x00,
        // Extension: Signature algorithms
        // RSA/PKCS1/SHA256, RSA/PKCS1/SHA512
        0x00, 0x0D, 0x00, 0x06, 0x00, 0x04,
        0x04, 0x01, 0x06, 0x01,
        // Extension: Renegotiation Info => new connection
        0xFF, 0x01,
        0x00, 0x01, 0x00,
        // Extension: SCT (signed certificate timestamp)
        0x00, 0x12, 0x00,
        0x00,
    });

    // Read server hello
    var ciphersuite: u16 = undefined;
    {
        const length = try handshake_record_length(reader);
        if (length < 44)
            return error.ServerMalformedResponse;
        {
            var hs_hdr_and_server_ver: [6]u8 = undefined;
            try hashing_reader.readNoEof(&hs_hdr_and_server_ver);
            if (hs_hdr_and_server_ver[0] != 0x02)
                return error.ServerMalformedResponse;
            if (!mem.eql(u8, hs_hdr_and_server_ver[4..6], "\x03\x03"))
                return error.ServerInvalidVersion;
        }
        try hashing_reader.readNoEof(&server_random);

        // Just skip the session id for now
        const sess_id_len = try hashing_reader.readByte();
        if (sess_id_len != 0)
            try hashing_reader.skipBytes(sess_id_len, .{});

        {
            ciphersuite = try hashing_reader.readIntBig(u16);
            var found = false;
            inline for (suites) |cs| {
                if (ciphersuite == cs.tag) {
                    found = true;
                    // TODO This segfaults stage1
                    // break;
                }
            }
            if (!found)
                return error.ServerInvalidCipherSuite;
        }

        // Compression method
        if ((try hashing_reader.readByte()) != 0x00)
            return error.ServerInvalidCompressionMethod;

        const exts_length = try hashing_reader.readIntBig(u16);
        var ext_byte_idx: usize = 0;
        while (ext_byte_idx < exts_length) {
            var ext_tag: [2]u8 = undefined;
            try hashing_reader.readNoEof(&ext_tag);

            const ext_len = try hashing_reader.readIntBig(u16);
            ext_byte_idx += 4 + ext_len;
            if (ext_tag[0] == 0xFF and ext_tag[1] == 0x01) {
                // Renegotiation info
                const renegotiation_info = try hashing_reader.readByte();
                if (ext_len != 0x01 or renegotiation_info != 0x00)
                    return error.ServerInvalidRenegotiationData;
            } else if (ext_tag[0] == 0x00 and ext_tag[1] == 0x00) {
                // Server name
                if (ext_len != 0)
                    try hashing_reader.skipBytes(ext_len, .{});
            } else if (ext_tag[0] == 0x00 and ext_tag[1] == 0x0B) {
                const format_count = try hashing_reader.readByte();
                var found_uncompressed = false;
                var i: usize = 0;
                while (i < format_count) : (i += 1) {
                    const byte = try hashing_reader.readByte();
                    if (byte == 0x0)
                        found_uncompressed = true;
                }
                if (!found_uncompressed)
                    return error.ServerInvalidECPointCompression;
            } else if (has_alpn and ext_tag[0] == 0x00 and ext_tag[1] == 0x10) {
                const alpn_ext_len = try hashing_reader.readIntBig(u16);
                if (alpn_ext_len != ext_len - 2)
                    return error.ServerMalformedResponse;
                const str_len = try hashing_reader.readByte();
                var buf: [256]u8 = undefined;
                try hashing_reader.readNoEof(buf[0..str_len]);
                const found = for (options.protocols) |proto| {
                    if (mem.eql(u8, proto, buf[0..str_len])) {
                        protocol = proto;
                        break true;
                    }
                } else false;
                if (!found)
                    return error.ServerInvalidProtocol;
                try hashing_reader.skipBytes(alpn_ext_len - str_len - 1, .{});
            } else return error.ServerInvalidExtension;
        }
        if (ext_byte_idx != exts_length)
            return error.ServerMalformedResponse;
    }
    // Read server certificates
    var certificate_public_key: x509.PublicKey = undefined;
    {
        const length = try handshake_record_length(reader);
        _ = length;
        {
            var handshake_header: [4]u8 = undefined;
            try hashing_reader.readNoEof(&handshake_header);
            if (handshake_header[0] != 0x0b)
                return error.ServerMalformedResponse;
        }
        const certs_length = try hashing_reader.readIntBig(u24);
        const cert_verifier: CertificateVerifier = options.cert_verifier;
        switch (cert_verifier) {
            .none => certificate_public_key = try extract_cert_public_key(
                options.temp_allocator,
                hashing_reader,
                certs_length,
            ),
            .function => |f| {
                var reader_state = CertificateReaderState(@TypeOf(hashing_reader)){
                    .reader = hashing_reader,
                    .length = certs_length,
                };
                var cert_reader = CertificateReader(@TypeOf(hashing_reader)){ .context = &reader_state };
                certificate_public_key = try f(cert_reader);
                try hashing_reader.skipBytes(reader_state.length - reader_state.idx, .{});
            },
            .default => certificate_public_key = try default_cert_verifier(
                options.temp_allocator,
                hashing_reader,
                certs_length,
                options.trusted_certificates,
                hostname,
            ),
        }
    }
    errdefer certificate_public_key.deinit(options.temp_allocator);
    // Read server ephemeral public key
    var server_public_key_buf: [curves.max_pub_key_len(curvelist)]u8 = undefined;
    var curve_id: u16 = undefined;
    var curve_id_buf: [3]u8 = undefined;
    var pub_key_len: u8 = undefined;
    {
        const length = try handshake_record_length(reader);
        _ = length;
        {
            var handshake_header: [4]u8 = undefined;
            try hashing_reader.readNoEof(&handshake_header);
            if (handshake_header[0] != 0x0c)
                return error.ServerMalformedResponse;

            try hashing_reader.readNoEof(&curve_id_buf);
            if (curve_id_buf[0] != 0x03)
                return error.ServerMalformedResponse;

            curve_id = mem.readIntBig(u16, curve_id_buf[1..]);
            var found = false;
            inline for (curvelist) |curve| {
                if (curve.tag == curve_id) {
                    found = true;
                    // @TODO This break segfaults stage1
                    // break;
                }
            }
            if (!found)
                return error.ServerInvalidCurve;
        }

        pub_key_len = try hashing_reader.readByte();
        inline for (curvelist) |curve| {
            if (curve.tag == curve_id) {
                if (curve.pub_key_len != pub_key_len)
                    return error.ServerMalformedResponse;
                // @TODO This break segfaults stage1
                // break;
            }
        }

        try hashing_reader.readNoEof(server_public_key_buf[0..pub_key_len]);
        if (curve_id != curves.x25519.tag) {
            if (server_public_key_buf[0] != 0x04)
                return error.ServerMalformedResponse;
        }

        // Signed public key
        const signature_id = try hashing_reader.readIntBig(u16);
        const signature_len = try hashing_reader.readIntBig(u16);

        var hash_buf: [64]u8 = undefined;
        var hash: []const u8 = undefined;
        const signature_algoritm: x509.Certificate.SignatureAlgorithm = switch (signature_id) {
            // TODO: More
            // RSA/PKCS1/SHA256
            0x0401 => block: {
                var sha256 = Sha256.init(.{});
                sha256.update(&client_random);
                sha256.update(&server_random);
                sha256.update(&curve_id_buf);
                sha256.update(&[1]u8{pub_key_len});
                sha256.update(server_public_key_buf[0..pub_key_len]);
                sha256.final(hash_buf[0..32]);
                hash = hash_buf[0..32];
                break :block .{ .signature = .rsa, .hash = .sha256 };
            },
            // RSA/PKCS1/SHA512
            0x0601 => block: {
                var sha512 = Sha512.init(.{});
                sha512.update(&client_random);
                sha512.update(&server_random);
                sha512.update(&curve_id_buf);
                sha512.update(&[1]u8{pub_key_len});
                sha512.update(server_public_key_buf[0..pub_key_len]);
                sha512.final(hash_buf[0..64]);
                hash = hash_buf[0..64];
                break :block .{ .signature = .rsa, .hash = .sha512 };
            },
            else => return error.ServerInvalidSignatureAlgorithm,
        };
        const signature_bytes = try options.temp_allocator.alloc(u8, signature_len);
        defer options.temp_allocator.free(signature_bytes);
        try hashing_reader.readNoEof(signature_bytes);

        if (!try @"pcks1v1.5".verify_signature(
            options.temp_allocator,
            signature_algoritm,
            .{ .data = signature_bytes, .bit_len = signature_len * 8 },
            hash,
            certificate_public_key,
        ))
            return error.ServerInvalidSignature;

        certificate_public_key.deinit(options.temp_allocator);
        certificate_public_key = x509.PublicKey.empty;
    }
    var client_certificate: ?*const x509.ClientCertificateChain = null;
    {
        const length = try handshake_record_length(reader);
        const record_type = try hashing_reader.readByte();
        if (record_type == 14) {
            // Server hello done
            const is_bytes = try hashing_reader.isBytes("\x00\x00\x00");
            if (length != 4 or !is_bytes)
                return error.ServerMalformedResponse;
        } else if (record_type == 13) {
            // Certificate request
            const certificate_request_bytes = try hashing_reader.readIntBig(u24);
            const hello_done_in_same_record =
                if (length == certificate_request_bytes + 8)
                true
            else if (length != certificate_request_bytes)
                false
            else
                return error.ServerMalformedResponse;
            // TODO: For now, we are ignoring the certificate types, as they have been somewhat
            // superceded by the supported_signature_algorithms field
            const certificate_types_bytes = try hashing_reader.readByte();
            try hashing_reader.skipBytes(certificate_types_bytes, .{});

            var chosen_client_certificates = std.ArrayListUnmanaged(*const x509.ClientCertificateChain){};
            defer chosen_client_certificates.deinit(options.temp_allocator);

            const signature_algorithms_bytes = try hashing_reader.readIntBig(u16);
            if (@hasField(Options, "client_certificates")) {
                var i: usize = 0;
                while (i < signature_algorithms_bytes / 2) : (i += 1) {
                    var signature_algorithm: [2]u8 = undefined;
                    try hashing_reader.readNoEof(&signature_algorithm);
                    for (options.client_certificates) |*cert_chain| {
                        if (@enumToInt(cert_chain.signature_algorithm.hash) == signature_algorithm[0] and
                            @enumToInt(cert_chain.signature_algorithm.signature) == signature_algorithm[1])
                        {
                            try chosen_client_certificates.append(options.temp_allocator, cert_chain);
                        }
                    }
                }
            } else {
                try hashing_reader.skipBytes(signature_algorithms_bytes, .{});
            }

            const certificate_authorities_bytes = try hashing_reader.readIntBig(u16);
            if (chosen_client_certificates.items.len == 0) {
                try hashing_reader.skipBytes(certificate_authorities_bytes, .{});
            } else {
                const dns_buf = try options.temp_allocator.alloc(u8, certificate_authorities_bytes);
                defer options.temp_allocator.free(dns_buf);

                try hashing_reader.readNoEof(dns_buf);
                var fbs = std.io.fixedBufferStream(dns_buf[2..]);
                var fbs_reader = fbs.reader();

                while (fbs.pos < fbs.buffer.len) {
                    const start_idx = fbs.pos;
                    const seq_tag = fbs_reader.readByte() catch return error.ServerMalformedResponse;
                    if (seq_tag != 0x30)
                        return error.ServerMalformedResponse;

                    const seq_length = asn1.der.parse_length(fbs_reader) catch return error.ServerMalformedResponse;
                    fbs_reader.skipBytes(seq_length, .{}) catch return error.ServerMalformedResponse;

                    var i: usize = 0;
                    while (i < chosen_client_certificates.items.len) {
                        const cert = chosen_client_certificates.items[i];
                        var cert_idx: usize = 0;
                        while (cert_idx < cert.cert_len) : (cert_idx += 1) {
                            if (mem.eql(u8, cert.cert_issuer_dns[cert_idx], fbs.buffer[start_idx..fbs.pos]))
                                break;
                        } else {
                            _ = chosen_client_certificates.swapRemove(i);
                            continue;
                        }
                        i += 1;
                    }
                }
                if (fbs.pos != fbs.buffer.len)
                    return error.ServerMalformedResponse;
            }
            // Server hello done
            if (!hello_done_in_same_record) {
                const hello_done_record_len = try handshake_record_length(reader);
                if (hello_done_record_len != 4)
                    return error.ServerMalformedResponse;
            }
            const hello_record_type = try hashing_reader.readByte();
            if (hello_record_type != 14)
                return error.ServerMalformedResponse;
            const is_bytes = try hashing_reader.isBytes("\x00\x00\x00");
            if (!is_bytes)
                return error.ServerMalformedResponse;

            // Send the client certificate message
            try writer.writeAll(&[3]u8{ 0x16, 0x03, 0x03 });
            if (chosen_client_certificates.items.len != 0) {
                client_certificate = chosen_client_certificates.items[0];

                const certificate_count = client_certificate.?.cert_len;
                // 7 bytes for the record type tag (1), record length (3), certificate list length (3)
                // 3 bytes for each certificate length
                var total_len: u24 = 7 + 3 * @intCast(u24, certificate_count);
                var i: usize = 0;
                while (i < certificate_count) : (i += 1) {
                    total_len += @intCast(u24, client_certificate.?.raw_certs[i].len);
                }
                try writer.writeIntBig(u16, @intCast(u16, total_len));
                var msg_buf: [7]u8 = [1]u8{0x0b} ++ ([1]u8{undefined} ** 6);
                mem.writeIntBig(u24, msg_buf[1..4], total_len - 4);
                mem.writeIntBig(u24, msg_buf[4..7], total_len - 7);
                try hashing_writer.writeAll(&msg_buf);
                i = 0;
                while (i < certificate_count) : (i += 1) {
                    try hashing_writer.writeIntBig(u24, @intCast(u24, client_certificate.?.raw_certs[i].len));
                    try hashing_writer.writeAll(client_certificate.?.raw_certs[i]);
                }
            } else {
                try writer.writeIntBig(u16, 7);
                try hashing_writer.writeAll(&[7]u8{ 0x0b, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00 });
            }
        } else return error.ServerMalformedResponse;
    }

    // Generate keys for the session
    const client_key_pair = curves.make_key_pair(curvelist, curve_id, rand);

    // Client key exchange
    try writer.writeAll(&[3]u8{ 0x16, 0x03, 0x03 });
    try writer.writeIntBig(u16, pub_key_len + 5);
    try hashing_writer.writeAll(&[5]u8{ 0x10, 0x00, 0x00, pub_key_len + 1, pub_key_len });

    inline for (curvelist) |curve| {
        if (curve.tag == curve_id) {
            const actual_len = @typeInfo(std.meta.fieldInfo(curve.Keys, .public_key).field_type).Array.len;
            if (pub_key_len == actual_len + 1) {
                try hashing_writer.writeByte(0x04);
            } else {
                std.debug.assert(pub_key_len == actual_len);
            }
            try hashing_writer.writeAll(&@field(client_key_pair, curve.name).public_key);
            break;
        }
    }

    // If we have a client certificate, send a certificate verify message
    if (@hasField(Options, "client_certificates")) {
        if (client_certificate) |client_cert| {
            var current_hash_buf: [64]u8 = undefined;
            var current_hash: []const u8 = undefined;
            const hash_algo = client_cert.signature_algorithm.hash;
            // TODO: Making this a switch statement kills stage1
            if (hash_algo == .none or hash_algo == .md5 or hash_algo == .sha1)
                return error.ClientCertificateVerifyFailed
            else if (hash_algo == .sha224) {
                var hash_copy = handshake_record_hash_set.sha224;
                hash_copy.final(current_hash_buf[0..28]);
                current_hash = current_hash_buf[0..28];
            } else if (hash_algo == .sha256) {
                var hash_copy = handshake_record_hash_set.sha256;
                hash_copy.final(current_hash_buf[0..32]);
                current_hash = current_hash_buf[0..32];
            } else if (hash_algo == .sha384) {
                var hash_copy = handshake_record_hash_set.sha384;
                hash_copy.final(current_hash_buf[0..48]);
                current_hash = current_hash_buf[0..48];
            } else {
                var hash_copy = handshake_record_hash_set.sha512;
                hash_copy.final(&current_hash_buf);
                current_hash = &current_hash_buf;
            }

            const signed = (try @"pcks1v1.5".sign(
                options.temp_allocator,
                client_cert.signature_algorithm,
                current_hash,
                client_cert.private_key,
            )) orelse return error.ClientCertificateVerifyFailed;
            defer options.temp_allocator.free(signed);

            try writer.writeAll(&[3]u8{ 0x16, 0x03, 0x03 });
            try writer.writeIntBig(u16, @intCast(u16, signed.len + 8));
            var msg_buf: [8]u8 = [1]u8{0x0F} ++ ([1]u8{undefined} ** 7);
            mem.writeIntBig(u24, msg_buf[1..4], @intCast(u24, signed.len + 4));
            msg_buf[4] = @enumToInt(client_cert.signature_algorithm.hash);
            msg_buf[5] = @enumToInt(client_cert.signature_algorithm.signature);
            mem.writeIntBig(u16, msg_buf[6..8], @intCast(u16, signed.len));
            try hashing_writer.writeAll(&msg_buf);
            try hashing_writer.writeAll(signed);
        }
    }

    // Client encryption keys calculation for ECDHE_RSA cipher suites with SHA256 hash
    var master_secret: [48]u8 = undefined;
    var key_data: ciphers.KeyData(suites) = undefined;
    {
        var pre_master_secret_buf: [curves.max_pre_master_secret_len(curvelist)]u8 = undefined;
        const pre_master_secret = try curves.make_pre_master_secret(
            curvelist,
            curve_id,
            client_key_pair,
            &pre_master_secret_buf,
            server_public_key_buf,
        );

        const seed_len = 77; // extra len variable to workaround a bug
        var seed: [seed_len]u8 = undefined;
        seed[0..13].* = "master secret".*;
        seed[13..45].* = client_random;
        seed[45..77].* = server_random;

        var a1: [32 + seed.len]u8 = undefined;
        Hmac256.create(a1[0..32], &seed, pre_master_secret);
        var a2: [32 + seed.len]u8 = undefined;
        Hmac256.create(a2[0..32], a1[0..32], pre_master_secret);

        a1[32..].* = seed;
        a2[32..].* = seed;

        var p1: [32]u8 = undefined;
        Hmac256.create(&p1, &a1, pre_master_secret);
        var p2: [32]u8 = undefined;
        Hmac256.create(&p2, &a2, pre_master_secret);

        master_secret[0..32].* = p1;
        master_secret[32..48].* = p2[0..16].*;

        // Key expansion
        seed[0..13].* = "key expansion".*;
        seed[13..45].* = server_random;
        seed[45..77].* = client_random;
        a1[32..].* = seed;
        a2[32..].* = seed;

        const KeyExpansionState = struct {
            seed: *const [77]u8,
            a1: *[32 + seed_len]u8,
            a2: *[32 + seed_len]u8,
            master_secret: *const [48]u8,
        };

        const next_32_bytes = struct {
            inline fn f(
                state: *KeyExpansionState,
                comptime chunk_idx: comptime_int,
                chunk: *[32]u8,
            ) void {
                if (chunk_idx == 0) {
                    Hmac256.create(state.a1[0..32], state.seed, state.master_secret);
                    Hmac256.create(chunk, state.a1, state.master_secret);
                } else if (chunk_idx % 2 == 1) {
                    Hmac256.create(state.a2[0..32], state.a1[0..32], state.master_secret);
                    Hmac256.create(chunk, state.a2, state.master_secret);
                } else {
                    Hmac256.create(state.a1[0..32], state.a2[0..32], state.master_secret);
                    Hmac256.create(chunk, state.a1, state.master_secret);
                }
            }
        }.f;
        var state = KeyExpansionState{
            .seed = &seed,
            .a1 = &a1,
            .a2 = &a2,
            .master_secret = &master_secret,
        };

        key_data = ciphers.key_expansion(suites, ciphersuite, &state, next_32_bytes);
    }

    // Client change cipher spec and client handshake finished
    {
        try writer.writeAll(&[6]u8{
            // Client change cipher spec
            0x14, 0x03, 0x03,
            0x00, 0x01, 0x01,
        });
        // The message we need to encrypt is the following:
        // 0x14 0x00 0x00 0x0c
        // <12 bytes of verify_data>
        // seed = "client finished" + SHA256(all handshake messages)
        // a1 = HMAC-SHA256(key=MasterSecret, data=seed)
        // p1 = HMAC-SHA256(key=MasterSecret, data=a1 + seed)
        // verify_data = p1[0..12]
        var verify_message: [16]u8 = undefined;
        verify_message[0..4].* = "\x14\x00\x00\x0C".*;
        {
            var seed: [47]u8 = undefined;
            seed[0..15].* = "client finished".*;
            // We still need to update the hash one time, so we copy
            // to get the current digest here.
            var hash_copy = handshake_record_hash_set.sha256;
            hash_copy.final(seed[15..47]);

            var a1: [32 + seed.len]u8 = undefined;
            Hmac256.create(a1[0..32], &seed, &master_secret);
            a1[32..].* = seed;
            var p1: [32]u8 = undefined;
            Hmac256.create(&p1, &a1, &master_secret);
            verify_message[4..16].* = p1[0..12].*;
        }
        handshake_record_hash_set.update(&verify_message);

        inline for (suites) |cs| {
            if (cs.tag == ciphersuite) {
                try cs.raw_write(
                    256,
                    rand,
                    &key_data,
                    writer,
                    [3]u8{ 0x16, 0x03, 0x03 },
                    0,
                    &verify_message,
                );
            }
        }
    }

    // Server change cipher spec
    {
        const length = try record_length(0x14, reader);
        const next_byte = try reader.readByte();
        if (length != 1 or next_byte != 0x01)
            return error.ServerMalformedResponse;
    }
    // Server handshake finished
    {
        const length = try handshake_record_length(reader);

        var verify_message: [16]u8 = undefined;
        verify_message[0..4].* = "\x14\x00\x00\x0C".*;
        {
            var seed: [47]u8 = undefined;
            seed[0..15].* = "server finished".*;
            handshake_record_hash_set.sha256.final(seed[15..47]);
            var a1: [32 + seed.len]u8 = undefined;
            Hmac256.create(a1[0..32], &seed, &master_secret);
            a1[32..].* = seed;
            var p1: [32]u8 = undefined;
            Hmac256.create(&p1, &a1, &master_secret);
            verify_message[4..16].* = p1[0..12].*;
        }

        inline for (suites) |cs| {
            if (cs.tag == ciphersuite) {
                if (!try cs.check_verify_message(&key_data, length, reader, verify_message))
                    return error.ServerInvalidVerifyData;
            }
        }
    }

    return Client(@TypeOf(reader), @TypeOf(writer), suites, has_alpn){
        .ciphersuite = ciphersuite,
        .key_data = key_data,
        .rand = rand,
        .parent_reader = reader,
        .parent_writer = writer,
        .protocol = protocol,
    };
}

pub fn Client(
    comptime _Reader: type,
    comptime _Writer: type,
    comptime _ciphersuites: anytype,
    comptime has_protocol: bool,
) type {
    return struct {
        const ReaderError = _Reader.Error || ServerAlert || error{ ServerMalformedResponse, ServerInvalidVersion, AuthenticationFailed };
        pub const Reader = std.io.Reader(*@This(), ReaderError, read);
        pub const Writer = std.io.Writer(*@This(), _Writer.Error, write);

        const InRecordState = ciphers.InRecordState(_ciphersuites);
        const ReadState = union(enum) {
            none,
            in_record: struct {
                record_length: usize,
                index: usize = 0,
                state: InRecordState,
            },
        };

        ciphersuite: u16,
        client_seq: u64 = 1,
        server_seq: u64 = 1,
        key_data: ciphers.KeyData(_ciphersuites),
        read_state: ReadState = .none,
        rand: *std.rand.Random,

        parent_reader: _Reader,
        parent_writer: _Writer,

        protocol: if (has_protocol) []const u8 else void,

        pub fn reader(self: *@This()) Reader {
            return .{ .context = self };
        }

        pub fn writer(self: *@This()) Writer {
            return .{ .context = self };
        }

        pub fn read(self: *@This(), buffer: []u8) ReaderError!usize {
            const buf_size = 1024;

            switch (self.read_state) {
                .none => {
                    const header = record_header(self.parent_reader) catch |err| switch (err) {
                        error.EndOfStream => return 0,
                        else => |e| return e,
                    };

                    const len_overhead = inline for (_ciphersuites) |cs| {
                        if (self.ciphersuite == cs.tag) {
                            break cs.mac_length + cs.prefix_data_length;
                        }
                    } else unreachable;

                    const rec_length = header.len();
                    if (rec_length < len_overhead)
                        return error.ServerMalformedResponse;
                    const len = rec_length - len_overhead;

                    if ((header.tag() != 0x17 and header.tag() != 0x15) or
                        (header.tag() == 0x15 and len != 2))
                    {
                        return error.ServerMalformedResponse;
                    }

                    inline for (_ciphersuites) |cs| {
                        if (self.ciphersuite == cs.tag) {
                            var prefix_data: [cs.prefix_data_length]u8 = undefined;
                            if (cs.prefix_data_length > 0) {
                                self.parent_reader.readNoEof(&prefix_data) catch |err| switch (err) {
                                    error.EndOfStream => return error.ServerMalformedResponse,
                                    else => |e| return e,
                                };
                            }
                            self.read_state = .{ .in_record = .{
                                .record_length = len,
                                .state = @unionInit(
                                    InRecordState,
                                    cs.name,
                                    cs.init_state(prefix_data, self.server_seq, &self.key_data, header),
                                ),
                            } };
                        }
                    }

                    if (header.tag() == 0x15) {
                        var encrypted: [2]u8 = undefined;
                        self.parent_reader.readNoEof(&encrypted) catch |err| switch (err) {
                            error.EndOfStream => return error.ServerMalformedResponse,
                            else => |e| return e,
                        };

                        var result: [2]u8 = undefined;
                        inline for (_ciphersuites) |cs| {
                            if (self.ciphersuite == cs.tag) {
                                // This decrypt call should always consume the whole record
                                cs.decrypt_part(
                                    &self.key_data,
                                    self.read_state.in_record.record_length,
                                    &self.read_state.in_record.index,
                                    &@field(self.read_state.in_record.state, cs.name),
                                    &encrypted,
                                    &result,
                                );
                                std.debug.assert(self.read_state.in_record.index == self.read_state.in_record.record_length);
                                try cs.verify_mac(
                                    self.parent_reader,
                                    self.read_state.in_record.record_length,
                                    &@field(self.read_state.in_record.state, cs.name),
                                );
                            }
                        }
                        self.read_state = .none;
                        self.server_seq += 1;
                        // CloseNotify
                        if (result[1] == 0)
                            return 0;
                        return alert_byte_to_error(result[1]);
                    } else if (header.tag() == 0x17) {
                        const curr_bytes = std.math.min(std.math.min(len, buf_size), buffer.len);
                        // Partially decrypt the data.
                        var encrypted: [buf_size]u8 = undefined;
                        const actually_read = try self.parent_reader.read(encrypted[0..curr_bytes]);

                        inline for (_ciphersuites) |cs| {
                            if (self.ciphersuite == cs.tag) {
                                cs.decrypt_part(
                                    &self.key_data,
                                    self.read_state.in_record.record_length,
                                    &self.read_state.in_record.index,
                                    &@field(self.read_state.in_record.state, cs.name),
                                    encrypted[0..actually_read],
                                    buffer[0..actually_read],
                                );

                                if (self.read_state.in_record.index == self.read_state.in_record.record_length) {
                                    try cs.verify_mac(
                                        self.parent_reader,
                                        self.read_state.in_record.record_length,
                                        &@field(self.read_state.in_record.state, cs.name),
                                    );
                                    self.server_seq += 1;
                                    self.read_state = .none;
                                }
                            }
                        }
                        return actually_read;
                    } else unreachable;
                },
                .in_record => |*in_record| {
                    const curr_bytes = std.math.min(std.math.min(buf_size, buffer.len), in_record.record_length - in_record.index);
                    // Partially decrypt the data.
                    var encrypted: [buf_size]u8 = undefined;
                    const actually_read = try self.parent_reader.read(encrypted[0..curr_bytes]);

                    inline for (_ciphersuites) |cs| {
                        if (self.ciphersuite == cs.tag) {
                            cs.decrypt_part(
                                &self.key_data,
                                in_record.record_length,
                                &in_record.index,
                                &@field(in_record.state, cs.name),
                                encrypted[0..actually_read],
                                buffer[0..actually_read],
                            );

                            if (in_record.index == in_record.record_length) {
                                try cs.verify_mac(
                                    self.parent_reader,
                                    in_record.record_length,
                                    &@field(in_record.state, cs.name),
                                );
                                self.server_seq += 1;
                                self.read_state = .none;
                            }
                        }
                    }
                    return actually_read;
                },
            }
        }

        pub fn write(self: *@This(), buffer: []const u8) _Writer.Error!usize {
            if (buffer.len == 0) return 0;

            inline for (_ciphersuites) |cs| {
                if (self.ciphersuite == cs.tag) {
                    // @TODO Make this buffer size configurable
                    const curr_bytes = @truncate(u16, std.math.min(buffer.len, 1024));
                    try cs.raw_write(
                        1024,
                        self.rand,
                        &self.key_data,
                        self.parent_writer,
                        [3]u8{ 0x17, 0x03, 0x03 },
                        self.client_seq,
                        buffer[0..curr_bytes],
                    );
                    self.client_seq += 1;
                    return curr_bytes;
                }
            }
            unreachable;
        }

        pub fn close_notify(self: *@This()) !void {
            inline for (_ciphersuites) |cs| {
                if (self.ciphersuite == cs.tag) {
                    try cs.raw_write(
                        1024,
                        self.rand,
                        &self.key_data,
                        self.parent_writer,
                        [3]u8{ 0x15, 0x03, 0x03 },
                        self.client_seq,
                        "\x01\x00",
                    );
                    self.client_seq += 1;
                    return;
                }
            }
            unreachable;
        }
    };
}

test "HTTPS request on wikipedia main page" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "en.wikipedia.org", 443);
    defer sock.close();

    var fbs = std.io.fixedBufferStream(@embedFile("../test/DigiCertHighAssuranceEVRootCA.crt.pem"));
    var trusted_chain = try x509.CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer trusted_chain.deinit();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    var client = try client_connect(.{
        .rand = rand,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .default,
        .temp_allocator = std.testing.allocator,
        .trusted_certificates = trusted_chain.data.items,
        .ciphersuites = .{ciphersuites.ECDHE_RSA_Chacha20_Poly1305},
        .protocols = &[_][]const u8{"http/1.1"},
        .curves = .{curves.x25519},
    }, "en.wikipedia.org");
    defer client.close_notify() catch {};
    try std.testing.expectEqualStrings("http/1.1", client.protocol);
    try client.writer().writeAll("GET /wiki/Main_Page HTTP/1.1\r\nHost: en.wikipedia.org\r\nAccept: */*\r\n\r\n");

    {
        const header = try client.reader().readUntilDelimiterAlloc(std.testing.allocator, '\n', std.math.maxInt(usize));
        try std.testing.expectEqualStrings("HTTP/1.1 200 OK", mem.trim(u8, header, &std.ascii.spaces));
        std.testing.allocator.free(header);
    }

    // Skip the rest of the headers expect for Content-Length
    var content_length: ?usize = null;
    hdr_loop: while (true) {
        const header = try client.reader().readUntilDelimiterAlloc(std.testing.allocator, '\n', std.math.maxInt(usize));
        defer std.testing.allocator.free(header);

        const hdr_contents = mem.trim(u8, header, &std.ascii.spaces);
        if (hdr_contents.len == 0) {
            break :hdr_loop;
        }

        if (mem.startsWith(u8, hdr_contents, "Content-Length: ")) {
            content_length = try std.fmt.parseUnsigned(usize, hdr_contents[16..], 10);
        }
    }
    try std.testing.expect(content_length != null);
    const html_contents = try std.testing.allocator.alloc(u8, content_length.?);
    defer std.testing.allocator.free(html_contents);

    try client.reader().readNoEof(html_contents);
}

test "HTTPS request on wikipedia alternate name" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "en.m.wikipedia.org", 443);
    defer sock.close();

    var fbs = std.io.fixedBufferStream(@embedFile("../test/DigiCertHighAssuranceEVRootCA.crt.pem"));
    var trusted_chain = try x509.CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer trusted_chain.deinit();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    var client = try client_connect(.{
        .rand = rand,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .default,
        .temp_allocator = std.testing.allocator,
        .trusted_certificates = trusted_chain.data.items,
        .ciphersuites = .{ciphersuites.ECDHE_RSA_Chacha20_Poly1305},
        .protocols = &[_][]const u8{"http/1.1"},
        .curves = .{curves.x25519},
    }, "en.m.wikipedia.org");
    defer client.close_notify() catch {};
}

test "HTTPS request on twitch oath2 endpoint" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "id.twitch.tv", 443);
    defer sock.close();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    var client = try client_connect(.{
        .rand = rand,
        .temp_allocator = std.testing.allocator,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .none,
        .protocols = &[_][]const u8{"http/1.1"},
    }, "id.twitch.tv");
    try std.testing.expectEqualStrings("http/1.1", client.protocol);
    defer client.close_notify() catch {};

    try client.writer().writeAll("GET /oauth2/validate HTTP/1.1\r\nHost: id.twitch.tv\r\nAccept: */*\r\n\r\n");
    var content_length: ?usize = null;
    hdr_loop: while (true) {
        const header = try client.reader().readUntilDelimiterAlloc(std.testing.allocator, '\n', std.math.maxInt(usize));
        defer std.testing.allocator.free(header);

        const hdr_contents = mem.trim(u8, header, &std.ascii.spaces);
        if (hdr_contents.len == 0) {
            break :hdr_loop;
        }

        if (mem.startsWith(u8, hdr_contents, "Content-Length: ")) {
            content_length = try std.fmt.parseUnsigned(usize, hdr_contents[16..], 10);
        }
    }
    try std.testing.expect(content_length != null);
    const html_contents = try std.testing.allocator.alloc(u8, content_length.?);
    defer std.testing.allocator.free(html_contents);

    try client.reader().readNoEof(html_contents);
}

test "Connecting to expired.badssl.com returns an error" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "expired.badssl.com", 443);
    defer sock.close();

    var fbs = std.io.fixedBufferStream(@embedFile("../test/DigiCertGlobalRootCA.crt.pem"));
    var trusted_chain = try x509.CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer trusted_chain.deinit();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    if (client_connect(.{
        .rand = rand,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .default,
        .temp_allocator = std.testing.allocator,
        .trusted_certificates = trusted_chain.data.items,
    }, "expired.badssl.com")) |_| {
        return error.ExpectedVerificationFailed;
    } else |err| {
        try std.testing.expect(err == error.CertificateVerificationFailed);
    }
}

test "Connecting to wrong.host.badssl.com returns an error" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "wrong.host.badssl.com", 443);
    defer sock.close();

    var fbs = std.io.fixedBufferStream(@embedFile("../test/DigiCertGlobalRootCA.crt.pem"));
    var trusted_chain = try x509.CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer trusted_chain.deinit();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    if (client_connect(.{
        .rand = rand,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .default,
        .temp_allocator = std.testing.allocator,
        .trusted_certificates = trusted_chain.data.items,
    }, "wrong.host.badssl.com")) |_| {
        return error.ExpectedVerificationFailed;
    } else |err| {
        try std.testing.expect(err == error.CertificateVerificationFailed);
    }
}

test "Connecting to self-signed.badssl.com returns an error" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "self-signed.badssl.com", 443);
    defer sock.close();

    var fbs = std.io.fixedBufferStream(@embedFile("../test/DigiCertGlobalRootCA.crt.pem"));
    var trusted_chain = try x509.CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer trusted_chain.deinit();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    if (client_connect(.{
        .rand = rand,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .default,
        .temp_allocator = std.testing.allocator,
        .trusted_certificates = trusted_chain.data.items,
    }, "self-signed.badssl.com")) |_| {
        return error.ExpectedVerificationFailed;
    } else |err| {
        try std.testing.expect(err == error.CertificateVerificationFailed);
    }
}

test "Connecting to client.badssl.com with a client certificate" {
    const sock = try std.net.tcpConnectToHost(std.testing.allocator, "client.badssl.com", 443);
    defer sock.close();

    var fbs = std.io.fixedBufferStream(@embedFile("../test/DigiCertGlobalRootCA.crt.pem"));
    var trusted_chain = try x509.CertificateChain.from_pem(std.testing.allocator, fbs.reader());
    defer trusted_chain.deinit();

    // @TODO Remove this once std.crypto.rand works in .evented mode
    var rand = blk: {
        var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
        try std.os.getrandom(&seed);
        break :blk &std.rand.DefaultCsprng.init(seed).random;
    };

    var client_cert = try x509.ClientCertificateChain.from_pem(
        std.testing.allocator,
        std.io.fixedBufferStream(@embedFile("../test/badssl.com-client.pem")).reader(),
    );
    defer client_cert.deinit(std.testing.allocator);

    var client = try client_connect(.{
        .rand = rand,
        .reader = sock.reader(),
        .writer = sock.writer(),
        .cert_verifier = .default,
        .temp_allocator = std.testing.allocator,
        .trusted_certificates = trusted_chain.data.items,
        .client_certificates = &[1]x509.ClientCertificateChain{client_cert},
    }, "client.badssl.com");
    defer client.close_notify() catch {};

    try client.writer().writeAll("GET / HTTP/1.1\r\nHost: client.badssl.com\r\nAccept: */*\r\n\r\n");

    const line = try client.reader().readUntilDelimiterAlloc(std.testing.allocator, '\n', std.math.maxInt(usize));
    defer std.testing.allocator.free(line);
    try std.testing.expectEqualStrings("HTTP/1.1 200 OK\r", line);
}
