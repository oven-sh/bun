const std = @import("std");
const mem = std.mem;

const crypto = @import("crypto.zig");
const ChaCha20Stream = crypto.ChaCha20Stream;
const Chacha20Poly1305 = std.crypto.aead.chacha_poly.ChaCha20Poly1305;
const Poly1305 = std.crypto.onetimeauth.Poly1305;
const Aes128Gcm = std.crypto.aead.aes_gcm.Aes128Gcm;

const main = @import("main.zig");
const RecordHeader = main.RecordHeader;

pub const suites = struct {
    pub const ECDHE_RSA_Chacha20_Poly1305 = struct {
        pub const name = "ECDHE-RSA-CHACHA20-POLY1305";
        pub const tag = 0xCCA8;
        pub const key_exchange = .ecdhe;
        pub const hash = .sha256;
        pub const prefix_data_length = 0;
        pub const mac_length = 16;

        pub const Keys = struct {
            client_key: [32]u8,
            server_key: [32]u8,
            client_iv: [12]u8,
            server_iv: [12]u8,
        };

        pub const State = struct {
            mac: Poly1305,
            context: ChaCha20Stream.BlockVec,
            buf: [64]u8,
        };

        pub fn init_state(_: [0]u8, server_seq: u64, key_data: anytype, header: RecordHeader) State {
            const len = header.len() - 16;
            var nonce: [12]u8 = ([1]u8{0} ** 4) ++ ([1]u8{undefined} ** 8);
            mem.writeIntBig(u64, nonce[4..12], server_seq);
            for (nonce) |*n, i| {
                n.* ^= key_data.server_iv(@This())[i];
            }

            var additional_data: [13]u8 = undefined;
            mem.writeIntBig(u64, additional_data[0..8], server_seq);
            additional_data[8..11].* = header.data[0..3].*;
            mem.writeIntBig(u16, additional_data[11..13], len);

            var c: [4]u32 = undefined;
            c[0] = 1;
            c[1] = mem.readIntLittle(u32, nonce[0..4]);
            c[2] = mem.readIntLittle(u32, nonce[4..8]);
            c[3] = mem.readIntLittle(u32, nonce[8..12]);
            const server_key = crypto.keyToWords(key_data.server_key(@This()).*);

            return .{
                .mac = ChaCha20Stream.initPoly1305(key_data.server_key(@This()).*, nonce, additional_data),
                .context = ChaCha20Stream.initContext(server_key, c),
                .buf = undefined,
            };
        }

        pub fn decrypt_part(
            key_data: anytype,
            record_length: usize,
            idx: *usize,
            state: *State,
            encrypted: []const u8,
            out: []u8,
        ) void {
            _ = record_length;

            std.debug.assert(encrypted.len == out.len);
            ChaCha20Stream.chacha20Xor(
                out,
                encrypted,
                crypto.keyToWords(key_data.server_key(@This()).*),
                &state.context,
                idx,
                &state.buf,
            );

            state.mac.update(encrypted);
        }

        pub fn verify_mac(reader: anytype, record_length: usize, state: *State) !void {
            var poly1305_tag: [16]u8 = undefined;
            reader.readNoEof(&poly1305_tag) catch |err| switch (err) {
                error.EndOfStream => return error.ServerMalformedResponse,
                else => |e| return e,
            };
            try ChaCha20Stream.checkPoly1305(&state.mac, record_length, poly1305_tag);
        }

        pub fn raw_write(
            comptime buffer_size: usize,
            rand: *std.rand.Random,
            key_data: anytype,
            writer: anytype,
            prefix: [3]u8,
            seq: u64,
            buffer: []const u8,
        ) !void {
            _ = rand;

            std.debug.assert(buffer.len <= buffer_size);
            try writer.writeAll(&prefix);
            try writer.writeIntBig(u16, @intCast(u16, buffer.len + 16));

            var additional_data: [13]u8 = undefined;
            mem.writeIntBig(u64, additional_data[0..8], seq);
            additional_data[8..11].* = prefix;
            mem.writeIntBig(u16, additional_data[11..13], @intCast(u16, buffer.len));

            var encrypted_data: [buffer_size]u8 = undefined;
            var tag_data: [16]u8 = undefined;

            var nonce: [12]u8 = ([1]u8{0} ** 4) ++ ([1]u8{undefined} ** 8);
            mem.writeIntBig(u64, nonce[4..12], seq);
            for (nonce) |*n, i| {
                n.* ^= key_data.client_iv(@This())[i];
            }

            Chacha20Poly1305.encrypt(
                encrypted_data[0..buffer.len],
                &tag_data,
                buffer,
                &additional_data,
                nonce,
                key_data.client_key(@This()).*,
            );
            try writer.writeAll(encrypted_data[0..buffer.len]);
            try writer.writeAll(&tag_data);
        }

        pub fn check_verify_message(
            key_data: anytype,
            length: usize,
            reader: anytype,
            verify_message: [16]u8,
        ) !bool {
            if (length != 32)
                return false;

            var msg_in: [32]u8 = undefined;
            try reader.readNoEof(&msg_in);

            const additional_data: [13]u8 = ([1]u8{0} ** 8) ++ [5]u8{ 0x16, 0x03, 0x03, 0x00, 0x10 };
            var decrypted: [16]u8 = undefined;
            Chacha20Poly1305.decrypt(
                &decrypted,
                msg_in[0..16],
                msg_in[16..].*,
                &additional_data,
                key_data.server_iv(@This()).*,
                key_data.server_key(@This()).*,
            ) catch return false;

            return mem.eql(u8, &decrypted, &verify_message);
        }
    };

    pub const ECDHE_RSA_AES128_GCM_SHA256 = struct {
        pub const name = "ECDHE-RSA-AES128-GCM-SHA256";
        pub const tag = 0xC02F;
        pub const key_exchange = .ecdhe;
        pub const hash = .sha256;
        pub const prefix_data_length = 8;
        pub const mac_length = 16;

        pub const Keys = struct {
            client_key: [16]u8,
            server_key: [16]u8,
            client_iv: [4]u8,
            server_iv: [4]u8,
        };

        const Aes = std.crypto.core.aes.Aes128;
        pub const State = struct {
            aes: @typeInfo(@TypeOf(Aes.initEnc)).Fn.return_type.?,
            counterInt: u128,
        };

        pub fn init_state(prefix_data: [8]u8, server_seq: u64, key_data: anytype, header: RecordHeader) State {
            _ = server_seq;
            _ = header;

            var iv: [12]u8 = undefined;
            iv[0..4].* = key_data.server_iv(@This()).*;
            iv[4..].* = prefix_data;

            var j: [16]u8 = undefined;
            mem.copy(u8, j[0..12], iv[0..]);
            mem.writeIntBig(u32, j[12..][0..4], 2);

            return .{
                .aes = Aes.initEnc(key_data.server_key(@This()).*),
                .counterInt = mem.readInt(u128, &j, .Big),
            };
        }

        pub fn decrypt_part(
            key_data: anytype,
            record_length: usize,
            idx: *usize,
            state: *State,
            encrypted: []const u8,
            out: []u8,
        ) void {
            _ = key_data;
            _ = record_length;

            std.debug.assert(encrypted.len == out.len);

            crypto.ctr(
                @TypeOf(state.aes),
                state.aes,
                out,
                encrypted,
                &state.counterInt,
                idx,
                .Big,
            );
        }

        pub fn verify_mac(reader: anytype, record_length: usize, state: *State) !void {
            _ = state;
            _ = record_length;
            // @TODO Implement this
            reader.skipBytes(16, .{}) catch |err| switch (err) {
                error.EndOfStream => return error.ServerMalformedResponse,
                else => |e| return e,
            };
        }

        pub fn check_verify_message(
            key_data: anytype,
            length: usize,
            reader: anytype,
            verify_message: [16]u8,
        ) !bool {
            if (length != 40)
                return false;

            var iv: [12]u8 = undefined;
            iv[0..4].* = key_data.server_iv(@This()).*;
            try reader.readNoEof(iv[4..12]);

            var msg_in: [32]u8 = undefined;
            try reader.readNoEof(&msg_in);

            const additional_data: [13]u8 = ([1]u8{0} ** 8) ++ [5]u8{ 0x16, 0x03, 0x03, 0x00, 0x10 };
            var decrypted: [16]u8 = undefined;
            Aes128Gcm.decrypt(
                &decrypted,
                msg_in[0..16],
                msg_in[16..].*,
                &additional_data,
                iv,
                key_data.server_key(@This()).*,
            ) catch return false;

            return mem.eql(u8, &decrypted, &verify_message);
        }

        pub fn raw_write(
            comptime buffer_size: usize,
            rand: *std.rand.Random,
            key_data: anytype,
            writer: anytype,
            prefix: [3]u8,
            seq: u64,
            buffer: []const u8,
        ) !void {
            std.debug.assert(buffer.len <= buffer_size);
            var iv: [12]u8 = undefined;
            iv[0..4].* = key_data.client_iv(@This()).*;
            rand.bytes(iv[4..12]);

            var additional_data: [13]u8 = undefined;
            mem.writeIntBig(u64, additional_data[0..8], seq);
            additional_data[8..11].* = prefix;
            mem.writeIntBig(u16, additional_data[11..13], @intCast(u16, buffer.len));

            try writer.writeAll(&prefix);
            try writer.writeIntBig(u16, @intCast(u16, buffer.len + 24));
            try writer.writeAll(iv[4..12]);

            var encrypted_data: [buffer_size]u8 = undefined;
            var tag_data: [16]u8 = undefined;

            Aes128Gcm.encrypt(
                encrypted_data[0..buffer.len],
                &tag_data,
                buffer,
                &additional_data,
                iv,
                key_data.client_key(@This()).*,
            );
            try writer.writeAll(encrypted_data[0..buffer.len]);
            try writer.writeAll(&tag_data);
        }
    };

    pub const all = &[_]type{ ECDHE_RSA_Chacha20_Poly1305, ECDHE_RSA_AES128_GCM_SHA256 };
};

fn key_field_width(comptime T: type, comptime field: anytype) ?usize {
    if (!@hasField(T, @tagName(field)))
        return null;

    const field_info = std.meta.fieldInfo(T, field);
    if (!comptime std.meta.trait.is(.Array)(field_info.field_type) or std.meta.Elem(field_info.field_type) != u8)
        @compileError("Field '" ++ field ++ "' of type '" ++ @typeName(T) ++ "' should be an array of u8.");

    return @typeInfo(field_info.field_type).Array.len;
}

pub fn key_data_size(comptime ciphersuites: anytype) usize {
    var max: usize = 0;
    for (ciphersuites) |cs| {
        const curr = (key_field_width(cs.Keys, .client_mac) orelse 0) +
            (key_field_width(cs.Keys, .server_mac) orelse 0) +
            key_field_width(cs.Keys, .client_key).? +
            key_field_width(cs.Keys, .server_key).? +
            key_field_width(cs.Keys, .client_iv).? +
            key_field_width(cs.Keys, .server_iv).?;
        if (curr > max)
            max = curr;
    }
    return max;
}

pub fn KeyData(comptime ciphersuites: anytype) type {
    return struct {
        data: [key_data_size(ciphersuites)]u8,

        pub fn client_mac(self: *@This(), comptime cs: type) *[key_field_width(cs.Keys, .client_mac) orelse 0]u8 {
            return self.data[0..comptime (key_field_width(cs.Keys, .client_mac) orelse 0)];
        }

        pub fn server_mac(self: *@This(), comptime cs: type) *[key_field_width(cs.Keys, .server_mac) orelse 0]u8 {
            const start = key_field_width(cs.Keys, .client_mac) orelse 0;
            return self.data[start..][0..comptime (key_field_width(cs.Keys, .server_mac) orelse 0)];
        }

        pub fn client_key(self: *@This(), comptime cs: type) *[key_field_width(cs.Keys, .client_key).?]u8 {
            const start = (key_field_width(cs.Keys, .client_mac) orelse 0) +
                (key_field_width(cs.Keys, .server_mac) orelse 0);
            return self.data[start..][0..comptime key_field_width(cs.Keys, .client_key).?];
        }

        pub fn server_key(self: *@This(), comptime cs: type) *[key_field_width(cs.Keys, .server_key).?]u8 {
            const start = (key_field_width(cs.Keys, .client_mac) orelse 0) +
                (key_field_width(cs.Keys, .server_mac) orelse 0) +
                key_field_width(cs.Keys, .client_key).?;
            return self.data[start..][0..comptime key_field_width(cs.Keys, .server_key).?];
        }

        pub fn client_iv(self: *@This(), comptime cs: type) *[key_field_width(cs.Keys, .client_iv).?]u8 {
            const start = (key_field_width(cs.Keys, .client_mac) orelse 0) +
                (key_field_width(cs.Keys, .server_mac) orelse 0) +
                key_field_width(cs.Keys, .client_key).? +
                key_field_width(cs.Keys, .server_key).?;
            return self.data[start..][0..comptime key_field_width(cs.Keys, .client_iv).?];
        }

        pub fn server_iv(self: *@This(), comptime cs: type) *[key_field_width(cs.Keys, .server_iv).?]u8 {
            const start = (key_field_width(cs.Keys, .client_mac) orelse 0) +
                (key_field_width(cs.Keys, .server_mac) orelse 0) +
                key_field_width(cs.Keys, .client_key).? +
                key_field_width(cs.Keys, .server_key).? +
                key_field_width(cs.Keys, .client_iv).?;
            return self.data[start..][0..comptime key_field_width(cs.Keys, .server_iv).?];
        }
    };
}

pub fn key_expansion(
    comptime ciphersuites: anytype,
    tag: u16,
    context: anytype,
    comptime next_32_bytes: anytype,
) KeyData(ciphersuites) {
    var res: KeyData(ciphersuites) = undefined;
    inline for (ciphersuites) |cs| {
        if (cs.tag == tag) {
            var chunk: [32]u8 = undefined;
            next_32_bytes(context, 0, &chunk);
            comptime var chunk_idx = 1;
            comptime var data_cursor = 0;
            comptime var chunk_cursor = 0;

            const fields = .{
                .client_mac, .server_mac,
                .client_key, .server_key,
                .client_iv,  .server_iv,
            };
            inline for (fields) |field| {
                if (chunk_cursor == 32) {
                    next_32_bytes(context, chunk_idx, &chunk);
                    chunk_idx += 1;
                    chunk_cursor = 0;
                }

                const field_width = comptime (key_field_width(cs.Keys, field) orelse 0);
                const first_read = comptime std.math.min(32 - chunk_cursor, field_width);
                const second_read = field_width - first_read;

                res.data[data_cursor..][0..first_read].* = chunk[chunk_cursor..][0..first_read].*;
                data_cursor += first_read;
                chunk_cursor += first_read;

                if (second_read != 0) {
                    next_32_bytes(context, chunk_idx, &chunk);
                    chunk_idx += 1;
                    res.data[data_cursor..][0..second_read].* = chunk[chunk_cursor..][0..second_read].*;
                    data_cursor += second_read;
                    chunk_cursor = second_read;
                    comptime std.debug.assert(chunk_cursor != 32);
                }
            }

            return res;
        }
    }
    unreachable;
}

pub fn InRecordState(comptime ciphersuites: anytype) type {
    var fields: [ciphersuites.len]std.builtin.TypeInfo.UnionField = undefined;
    for (ciphersuites) |cs, i| {
        fields[i] = .{
            .name = cs.name,
            .field_type = cs.State,
            .alignment = if (@sizeOf(cs.State) > 0) @alignOf(cs.State) else 0,
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
