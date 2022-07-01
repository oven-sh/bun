const std = @import("std");
const Environment = @import("./env.zig");
const strings = @import("./string_immutable.zig");
const bun = @import("./global.zig");

// -- Failed Experiment --
// Delete this code later
// -- Failed Experiment --
// Writing tons of < 8 byte chunks is kind of expensive
// because we have to loop through them to copy and then again to encode
// It would be faster if we could use SIMD
// but the behavior is out of our control
// so instead, we copy the _unencoded_ bytes to a buffer
// Then, just before we send it over the network, we encode it, usually in-place
// The caveat is if the encoding changes
// pub const Delayer = struct {
//     last_write: u32 = 0,
//     last_encoding: Encoding = Encoding.bytes,

//     const log = bun.Output.scoped(.Delayer, true);
//     pub const Encoding = enum {
//         bytes,
//         utf16,
//         latin1,
//     };

//     fn flushLatin1(this: *Delayer, list_: BabyList(u8), allocator: std.mem.Allocator) !BabyList(u8) {
//         var list = list_;
//         var remain = list.slice()[this.last_write..];
//         const element_count = strings.elementLengthLatin1IntoUTF8([]const u8, remain);
//         log("flushLatin1({any}, {any})", .{ .element_count = element_count, .remain = remain.len });
//         // common case: nothing to do, it's just ascii
//         if (element_count == remain.len) {
//             this.last_write += @truncate(u32, remain.len);

//             return list;
//         }

//         std.debug.assert(element_count > remain.len);
//         var arraylist = list.listManaged(allocator);
//         // assert we have enough room
//         try arraylist.ensureUnusedCapacity(element_count - remain.len);

//         list.update(arraylist);
//         var read_remain = arraylist.items.ptr[this.last_write..arraylist.items.len];
//         var write_remain = arraylist.items.ptr[this.last_write .. arraylist.items.len + (element_count - remain.len)];
//         std.debug.assert(write_remain.len > 0);
//         std.debug.assert(read_remain.len > 0);
//         std.debug.assert(write_remain.len > read_remain.len);
//         this.last_write += @truncate(u32, write_remain.len);
//         list.len += @intCast(u32, element_count - remain.len);

//         // faster path: stack allocated buffer
//         if (write_remain.len <= 4096) {
//             var buf: [4096]u8 = undefined;
//             const result = strings.copyLatin1IntoUTF8(&buf, []const u8, remain);
//             std.debug.assert(@as(usize, result.written) == write_remain.len);
//             std.debug.assert(@as(usize, result.read) == read_remain.len);
//             @memcpy(write_remain.ptr, &buf, write_remain.len);
//         } else {
//             // slow path
//             var temp_buf = try allocator.dupe(u8, read_remain);
//             defer allocator.free(temp_buf);
//             const result = strings.copyLatin1IntoUTF8(write_remain, []const u8, temp_buf);

//             std.debug.assert(@as(usize, result.written) == write_remain.len);
//             std.debug.assert(@as(usize, result.read) == read_remain.len);
//         }

//         return list;
//     }
//     fn flushUTF16(this: *Delayer, list_: BabyList(u8), allocator: std.mem.Allocator) !BabyList(u8) {
//         var list = list_;
//         var remain = std.mem.bytesAsSlice(u16, list.slice()[this.last_write..]);
//         const element_count = strings.elementLengthUTF16IntoUTF8(@TypeOf(remain), remain) * 2;
//         log("flushUTF16({any}, {any})", .{ .element_count = element_count, .remain = remain.len });

//         var arraylist = list.listManaged(allocator);

//         // assert we have enough room
//         const grow = element_count - list.slice()[this.last_write..].len;
//         try arraylist.ensureUnusedCapacity(grow);
//         list.update(arraylist);
//         var write_remain = arraylist.items.ptr[this.last_write .. arraylist.items.len + grow];
//         this.last_write += @truncate(u32, grow);
//         list.len += @intCast(u32, grow);

//         var buf: [4096]u8 = undefined;

//         if (element_count < buf.len) {
//             const result = strings.copyUTF16IntoUTF8(&buf, @TypeOf(remain), remain);
//             std.debug.assert(@as(usize, result.written * 2) == write_remain.len);
//             std.debug.assert(@as(usize, result.read) == remain.len);
//             @memcpy(write_remain.ptr, &buf, write_remain.len);
//         } else {
//             // slow path
//             var temp_buf = try allocator.alloc(u16, remain.len);
//             @memcpy(std.mem.sliceAsBytes(temp_buf).ptr, std.mem.sliceAsBytes(remain).ptr, std.mem.sliceAsBytes(remain).len);
//             defer allocator.free(temp_buf);
//             const result = strings.copyUTF16IntoUTF8(write_remain, @TypeOf(temp_buf), temp_buf);
//             std.debug.assert(@as(usize, result.written * 2) == write_remain.len);
//             std.debug.assert(@as(usize, result.read) == remain.len);
//         }

//         return list;
//     }
//     pub fn writeUTF16(this: *Delayer, list_: BabyList(u8), str: []const u16, allocator: std.mem.Allocator) !BabyList(u8) {
//         var list = list_;
//         log("writeUTF16({any}, {any})", .{ .delayer = this, .len = str.len });

//         {
//             switch (this.last_encoding) {
//                 .latin1 => {
//                     list = try this.flushLatin1(list, allocator);
//                     this.last_write = list.len;
//                     var arraylist = list.listManaged(allocator);
//                     var bytes = std.mem.sliceAsBytes(str);
//                     try arraylist.ensureUnusedCapacity(bytes.len);
//                     @memcpy(arraylist.items.ptr + arraylist.items.len, bytes.ptr, bytes.len);
//                     this.last_encoding = .utf16;
//                     list.update(arraylist);
//                     list.len += @intCast(u32, bytes.len);
//                     return list;
//                 },
//                 .bytes, .utf16 => |enc| {
//                     if (enc == .bytes) {
//                         this.last_write = list.len;
//                         this.last_encoding = .utf16;
//                     }
//                     var arraylist = list.listManaged(allocator);
//                     var bytes = std.mem.sliceAsBytes(str);
//                     try arraylist.ensureUnusedCapacity(bytes.len);
//                     @memcpy(arraylist.items.ptr + arraylist.items.len, bytes.ptr, bytes.len);
//                     list.update(arraylist);
//                     list.len += @intCast(u32, bytes.len);
//                 },
//             }
//         }

//         return list;
//     }

//     pub fn flush(this: *Delayer, list_: BabyList(u8), allocator: std.mem.Allocator) !BabyList(u8) {
//         if (this.last_encoding == .bytes) {
//             std.debug.assert(this.last_write == list_.len);
//             return list_;
//         }

//         var list = list_;
//         switch (this.last_encoding) {
//             .utf16 => {
//                 list = try this.flushUTF16(list_, allocator);
//                 this.last_write = list.len;
//                 this.last_encoding = .bytes;
//             },
//             .latin1 => {
//                 list = try this.flushLatin1(list_, allocator);
//                 this.last_write = list.len;
//                 this.last_encoding = .bytes;
//             },
//             .bytes => unreachable,
//         }

//         return list;
//     }

//     pub fn writeLatin1(this: *Delayer, list_: BabyList(u8), str: []const u8, allocator: std.mem.Allocator) !BabyList(u8) {
//         var list = list_;
//         log("writeLatin1({any}, {s})", .{ .delayer = this, .str = str });

//         {
//             switch (this.last_encoding) {
//                 .utf16 => {
//                     list = try this.flushUTF16(list, allocator);
//                     this.last_write = list.len;
//                     var arraylist = list.listManaged(allocator);
//                     var bytes = std.mem.sliceAsBytes(str);
//                     try arraylist.ensureUnusedCapacity(bytes.len);
//                     @memcpy(arraylist.items.ptr + arraylist.items.len, bytes.ptr, bytes.len);
//                     this.last_encoding = .latin1;
//                     list.update(arraylist);
//                     list.len += @intCast(u32, bytes.len);
//                     return list;
//                 },
//                 .bytes, .latin1 => |enc| {
//                     if (enc == .bytes) {
//                         this.last_write = list.len;
//                         this.last_encoding = .latin1;
//                     }
//                     var arraylist = list.listManaged(allocator);
//                     var bytes = std.mem.sliceAsBytes(str);
//                     try arraylist.ensureUnusedCapacity(bytes.len);
//                     @memcpy(arraylist.items.ptr + arraylist.items.len, bytes.ptr, bytes.len);
//                     list.update(arraylist);
//                     list.len += @intCast(u32, bytes.len);
//                 },
//             }
//         }

//         return list;
//     }

//     pub fn writeBytes(this: *Delayer, list_: BabyList(u8), str: []const u8, allocator: std.mem.Allocator) !BabyList(u8) {
//         var list = list_;
//         log("writeBytes({any}, {any})", .{ .delayer = this, .str = str });

//         {
//             switch (this.last_encoding) {
//                 .utf16 => {
//                     list = try this.flushUTF16(list, allocator);
//                 },
//                 .latin1 => {
//                     list = try this.flushLatin1(list, allocator);
//                 },
//                 else => {},
//             }

//             var arraylist = list.listManaged(allocator);
//             var bytes = std.mem.sliceAsBytes(str);
//             try arraylist.ensureUnusedCapacity(bytes.len);
//             @memcpy(arraylist.items.ptr + arraylist.items.len, bytes.ptr, bytes.len);
//             list.update(arraylist);
//             list.len += @intCast(u32, bytes.len);
//             this.last_write = list.len;
//             this.last_encoding = .bytes;
//         }

//         return list;
//     }
// };

/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GB
///
/// This lets us have array lists which occupy the same amount of space as a slice
pub fn BabyList(comptime Type: type) type {
    return struct {
        const ListType = @This();
        ptr: [*]Type = undefined,
        len: u32 = 0,
        cap: u32 = 0,

        pub inline fn init(items: []const Type) ListType {
            @setRuntimeSafety(false);
            return ListType{
                // Remove the const qualifier from the items
                .ptr = @intToPtr([*]Type, @ptrToInt(items.ptr)),

                .len = @truncate(u32, items.len),
                .cap = @truncate(u32, items.len),
            };
        }

        pub inline fn fromList(list_: anytype) ListType {
            @setRuntimeSafety(false);

            if (comptime Environment.allow_assert) {
                std.debug.assert(list_.items.len <= list_.capacity);
            }

            return ListType{
                .ptr = list_.items.ptr,
                .len = @truncate(u32, list_.items.len),
                .cap = @truncate(u32, list_.capacity),
            };
        }

        pub fn update(this: *ListType, list_: anytype) void {
            @setRuntimeSafety(false);
            this.ptr = list_.items.ptr;
            this.len = @truncate(u32, list_.items.len);
            this.cap = @truncate(u32, list_.capacity);

            if (comptime Environment.allow_assert) {
                std.debug.assert(this.len <= this.cap);
            }
        }

        pub fn list(this: ListType) std.ArrayListUnmanaged(Type) {
            return std.ArrayListUnmanaged(Type){
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
            };
        }

        pub fn listManaged(this: ListType, allocator: std.mem.Allocator) std.ArrayList(Type) {
            return std.ArrayList(Type){
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
                .allocator = allocator,
            };
        }

        pub inline fn first(this: ListType) ?*Type {
            return if (this.len > 0) this.ptr[0] else @as(?*Type, null);
        }

        pub inline fn last(this: ListType) ?*Type {
            return if (this.len > 0) &this.ptr[this.len - 1] else @as(?*Type, null);
        }

        pub inline fn first_(this: ListType) Type {
            return this.ptr[0];
        }

        pub fn one(allocator: std.mem.Allocator, value: Type) !ListType {
            var items = try allocator.alloc(Type, 1);
            items[0] = value;
            return ListType{
                .ptr = @ptrCast([*]Type, items.ptr),
                .len = 1,
                .cap = 1,
            };
        }

        pub inline fn @"[0]"(this: ListType) Type {
            return this.ptr[0];
        }
        const OOM = error{OutOfMemory};

        pub fn push(this: *ListType, allocator: std.mem.Allocator, value: Type) OOM!void {
            var list_ = this.list();
            try list_.append(allocator, value);
            this.update(list_);
        }

        pub inline fn slice(this: ListType) []Type {
            @setRuntimeSafety(false);
            return this.ptr[0..this.len];
        }

        pub fn write(this: *@This(), allocator: std.mem.Allocator, str: []const u8) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            var list_ = this.listManaged(allocator);
            try list_.appendSlice(str);
            this.update(list_);
            return this.len - initial;
        }
        pub fn writeLatin1(this: *@This(), allocator: std.mem.Allocator, str: []const u8) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            const old = this.listManaged(allocator);
            const new = try strings.allocateLatin1IntoUTF8WithList(old, old.items.len, []const u8, str);
            this.update(new);
            return this.len - initial;
        }
        pub fn writeUTF16(this: *@This(), allocator: std.mem.Allocator, str: []const u16) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));

            var list_ = this.listManaged(allocator);
            const initial = this.len;
            {
                defer this.update(list_);
                try list_.ensureTotalCapacityPrecise(list_.items.len + str.len + 4);

                var remain = str;
                while (remain.len > 0) {
                    const orig_len = list_.items.len;

                    var slice_ = list_.items.ptr[orig_len..list_.capacity];
                    const result = strings.copyUTF16IntoUTF8(slice_, []const u16, remain);
                    remain = remain[result.read..];
                    list_.items.len += @as(usize, result.written);
                    if (remain.len > 0) {
                        try list_.ensureTotalCapacityPrecise(list_.items.len + strings.elementLengthUTF16IntoUTF8([]const u16, remain));
                        continue;
                    }
                    if (result.read == 0 or result.written == 0) break;
                }
            }

            if (comptime Environment.allow_assert) {
                // sanity check that encoding produced a consistent result
                var allocated = try strings.toUTF8Alloc(allocator, str);
                defer allocator.free(allocated);
                const encoded = this.ptr[initial..this.len];
                std.testing.expectEqualStrings(allocated, encoded) catch unreachable;
            }
            return this.len - initial;
        }
    };
}
