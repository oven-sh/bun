const std = @import("std");
const Api = @import("./api/schema.zig").Api;
usingnamespace @import("./global.zig");

/// QueryString hash table that does few allocations and preserves the original order
pub const QueryStringMap = struct {
    allocator: *std.mem.Allocator,
    slice: string,
    buffer: []u8,
    list: Param.List,
    name_count: ?usize = null,

    threadlocal var _name_count: [8]string = undefined;
    pub fn getNameCount(this: *QueryStringMap) usize {
        if (this.name_count == null) {
            var count: usize = 0;
            var iterate = this.iter();
            while (iterate.next(&_name_count) != null) {
                count += 1;
            }
            this.name_count = count;
        }
        return this.name_count.?;
    }

    pub fn iter(this: *const QueryStringMap) Iterator {
        return Iterator.init(this);
    }

    pub const Iterator = struct {
        // Assume no query string param map will exceed 2048 keys
        // Browsers typically limit URL lengths to around 64k
        const VisitedMap = std.bit_set.ArrayBitSet(usize, 2048);

        i: usize = 0,
        map: *const QueryStringMap,
        visited: VisitedMap,

        const Result = struct {
            name: string,
            values: []string,
        };

        pub fn init(map: *const QueryStringMap) Iterator {
            return Iterator{ .i = 0, .map = map, .visited = VisitedMap.initEmpty() };
        }

        pub fn next(this: *Iterator, target: []string) ?Result {
            while (this.visited.isSet(this.i)) : (this.i += 1) {}
            if (this.i >= this.map.list.len) return null;

            var count: usize = 0;
            var slice = this.map.list.slice();
            const hash = slice.items(.name_hash)[this.i];
            var result = Result{ .name = this.map.str(slice.items(.name)[this.i]), .values = target[0..1] };
            target[0] = this.map.str(slice.items(.value)[this.i]);

            this.visited.set(this.i);
            this.i += 1;

            var remainder_hashes = slice.items(.name_hash)[this.i..];
            var remainder_values = slice.items(.value)[this.i..];

            var target_i: usize = 1;
            var current_i: usize = 0;

            while (std.mem.indexOfScalar(u64, remainder_hashes[current_i..], hash)) |next_index| {
                const real_i = current_i + next_index + this.i;
                if (comptime isDebug) {
                    std.debug.assert(!this.visited.isSet(real_i));
                }

                this.visited.set(real_i);
                target[target_i] = this.map.str(remainder_values[current_i + next_index]);
                target_i += 1;
                result.values = target[0..target_i];

                current_i += next_index + 1;
                if (target_i >= target.len) return result;
                if (real_i + 1 >= this.map.list.len) return result;
            }

            return result;
        }
    };

    pub fn str(this: *const QueryStringMap, ptr: Api.StringPointer) string {
        return this.slice[ptr.offset .. ptr.offset + ptr.length];
    }

    pub fn getIndex(this: *const QueryStringMap, input: string) ?usize {
        const hash = std.hash.Wyhash.hash(0, input);
        return std.mem.indexOfScalar(u64, this.list.items(.name_hash), hash);
    }

    pub fn get(this: *const QueryStringMap, input: string) ?string {
        const hash = std.hash.Wyhash.hash(0, input);
        const _slice = this.list.slice();
        const i = std.mem.indexOfScalar(u64, _slice.items(.name_hash), hash) orelse return null;
        return this.str(_slice.items(.value)[i]);
    }

    pub fn has(this: *const QueryStringMap, input: string) bool {
        return this.getIndex(input) != null;
    }

    pub fn getAll(this: *const QueryStringMap, input: string, target: []string) usize {
        const hash = std.hash.Wyhash.hash(0, input);
        const _slice = this.list.slice();
        return @call(.{ .modifier = .always_inline }, getAllWithHashFromOffset, .{ this, target, hash, 0, _slice });
    }

    pub fn getAllWithHashFromOffset(this: *const QueryStringMap, target: []string, hash: u64, offset: usize, _slice: Param.List.Slice) usize {
        var remainder_hashes = _slice.items(.name_hash)[offset..];
        var remainder_values = _slice.items(.value)[offset..];
        var target_i: usize = 0;
        while (remainder_hashes.len > 0 and target_i < target.len) {
            const i = std.mem.indexOfScalar(u64, remainder_hashes, hash) orelse break;
            target[target_i] = this.str(remainder_values[i]);
            remainder_values = remainder_values[i + 1 ..];
            remainder_hashes = remainder_hashes[i + 1 ..];
            target_i += 1;
        }
        return target_i;
    }

    pub const Param = struct {
        name: Api.StringPointer,
        name_hash: u64,
        value: Api.StringPointer,

        pub const List = std.MultiArrayList(Param);
    };

    pub fn init(
        allocator: *std.mem.Allocator,
        query_string: string,
    ) !?QueryStringMap {
        var list = Param.List{};

        var scanner = Scanner.init(query_string);
        var count: usize = 0;
        var estimated_str_len: usize = 0;

        var nothing_needs_decoding = true;
        while (scanner.next()) |result| {
            if (result.name_needs_decoding or result.value_needs_decoding) {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length + result.value.length;
            count += 1;
        }

        if (count == 0) return null;

        scanner = Scanner.init(query_string);
        try list.ensureTotalCapacity(allocator, count);

        if (nothing_needs_decoding) {
            scanner = Scanner.init(query_string);
            while (scanner.next()) |result| {
                std.debug.assert(!result.name_needs_decoding);
                std.debug.assert(!result.value_needs_decoding);

                var name = result.name;
                var value = result.value;
                const name_hash: u64 = std.hash.Wyhash.hash(0, result.rawName(query_string));
                list.appendAssumeCapacity(Param{ .name = name, .value = value, .name_hash = name_hash });
            }

            return QueryStringMap{
                .list = list,
                .buffer = &[_]u8{},
                .slice = query_string,
                .allocator = allocator,
            };
        }

        var buf = try std.ArrayList(u8).initCapacity(allocator, estimated_str_len);
        var writer = buf.writer();
        var buf_writer_pos: u32 = 0;

        var list_slice = list.slice();
        const Writer = @TypeOf(writer);
        while (scanner.next()) |result| {
            var name = result.name;
            var value = result.value;
            var name_hash: u64 = undefined;
            if (result.name_needs_decoding) {
                name.length = PercentEncoding.decode(Writer, writer, query_string[name.offset..][0..name.length]) catch continue;
                name.offset = buf_writer_pos;
                buf_writer_pos += name.length;
            } else {
                name_hash = std.hash.Wyhash.hash(0, result.rawName(query_string));
                if (std.mem.indexOfScalar(u64, list_slice.items(.name_hash), name_hash)) |index| {
                    name = list_slice.items(.name)[index];
                } else {
                    name.length = PercentEncoding.decode(Writer, writer, query_string[name.offset..][0..name.length]) catch continue;
                    name.offset = buf_writer_pos;
                    buf_writer_pos += name.length;
                }
            }

            value.length = PercentEncoding.decode(Writer, writer, query_string[value.offset..][0..value.length]) catch continue;
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            list.appendAssumeCapacity(Param{ .name = name, .value = value, .name_hash = name_hash });
        }

        buf.expandToCapacity();
        return QueryStringMap{
            .list = list,
            .buffer = buf.items,
            .slice = buf.items[0..buf_writer_pos],
            .allocator = allocator,
        };
    }

    pub fn deinit(this: *QueryStringMap) void {
        if (this.buffer.len > 0) {
            this.allocator.free(this.buffer);
        }

        if (this.list.len > 0) {
            this.list.deinit(this.allocator);
        }
    }
};

pub const PercentEncoding = struct {
    pub fn decode(comptime Writer: type, writer: Writer, input: string) !u32 {
        var i: usize = 0;
        var written: u32 = 0;
        // unlike JavaScript's decodeURIComponent, we are not handling invalid surrogate pairs
        // we are assuming the input is valid ascii
        while (i < input.len) {
            switch (input[i]) {
                '%' => {
                    if (!(i + 3 <= input.len and strings.isASCIIHexDigit(input[i + 1]) and strings.isASCIIHexDigit(input[i + 2]))) return error.DecodingError;
                    try writer.writeByte((strings.toASCIIHexValue(input[i + 1]) << 4) | strings.toASCIIHexValue(input[i + 2]));
                    i += 3;
                    written += 1;
                    continue;
                },
                else => {
                    const start = i;
                    i += 1;

                    // scan ahead assuming .writeAll is faster than .writeByte one at a time
                    while (i < input.len and input[i] != '%') : (i += 1) {}
                    try writer.writeAll(input[start..i]);
                    written += @truncate(u32, i - start);
                },
            }
        }

        return written;
    }
};

pub const Scanner = struct {
    query_string: string,
    i: usize,

    pub fn init(query_string: string) Scanner {
        if (query_string.len > 0 and query_string[0] == '?') {
            return Scanner{ .query_string = query_string, .i = 1 };
        }

        return Scanner{ .query_string = query_string, .i = 0 };
    }

    pub const Result = struct {
        name_needs_decoding: bool = false,
        value_needs_decoding: bool = false,
        name: Api.StringPointer,
        value: Api.StringPointer,

        pub inline fn rawName(this: *const Result, query_string: string) string {
            return if (this.name.length > 0) query_string[this.name.offset..][0..this.name.length] else "";
        }

        pub inline fn rawValue(this: *const Result, query_string: string) string {
            return if (this.value.length > 0) query_string[this.value.offset..][0..this.value.length] else "";
        }
    };

    /// Get the next query string parameter without allocating memory.
    pub fn next(this: *Scanner) ?Result {
        var relative_i: usize = 0;
        defer this.i += relative_i;

        // reuse stack space
        // otherwise we'd recursively call the function
        loop: while (true) {
            if (this.i >= this.query_string.len) return null;

            var slice = this.query_string[this.i..];
            relative_i = 0;
            var name = Api.StringPointer{ .offset = @truncate(u32, this.i), .length = 0 };
            var value = Api.StringPointer{ .offset = 0, .length = 0 };
            var name_needs_decoding = false;

            while (relative_i < slice.len) {
                const char = slice[relative_i];
                switch (char) {
                    '=' => {
                        name.length = @truncate(u32, relative_i);
                        relative_i += 1;

                        value.offset = @truncate(u32, relative_i + this.i);

                        const offset = relative_i;
                        var value_needs_decoding = false;
                        while (relative_i < slice.len and slice[relative_i] != '&') : (relative_i += 1) {
                            value_needs_decoding = value_needs_decoding or switch (slice[relative_i]) {
                                '%', '+' => true,
                                else => false,
                            };
                        }
                        value.length = @truncate(u32, relative_i - offset);
                        // If the name is empty and it's just a value, skip it.
                        // This is kind of an opinion. But, it's hard to see where that might be intentional.
                        if (name.length == 0) return null;
                        return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding, .value_needs_decoding = value_needs_decoding };
                    },
                    '%', '+' => {
                        name_needs_decoding = true;
                    },
                    '&' => {
                        // key&
                        if (relative_i > 0) {
                            name.length = @truncate(u32, relative_i);
                            return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding, .value_needs_decoding = false };
                        }

                        // &&&&&&&&&&&&&key=value
                        while (relative_i < slice.len and slice[relative_i] == '&') : (relative_i += 1) {}
                        this.i += relative_i;

                        // reuse stack space
                        continue :loop;
                    },
                    else => {},
                }

                relative_i += 1;
            }

            if (relative_i == 0) {
                return null;
            }

            name.length = @truncate(u32, relative_i);
            return Result{ .name = name, .value = value, .name_needs_decoding = name_needs_decoding };
        }
    }
};

const expect = std.testing.expect;
const expectString = std.testing.expectEqualStrings;
test "Scanner.init" {
    var scanner = Scanner.init("?hello=true");
    try expect(scanner.i == 1);
    scanner = Scanner.init("hello=true");
    try expect(scanner.i == 0);
}

test "Scanner.next" {
    var scanner = Scanner.init("?hello=true&welcome=to&the=what&is=this&1=100&&&&bacon&&&&what=true&ok&=100");
    var result: Scanner.Result = undefined;
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "hello");
    try expectString(result.rawValue(scanner.query_string), "true");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "welcome");
    try expectString(result.rawValue(scanner.query_string), "to");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "the");
    try expectString(result.rawValue(scanner.query_string), "what");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "is");
    try expectString(result.rawValue(scanner.query_string), "this");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "1");
    try expectString(result.rawValue(scanner.query_string), "100");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "bacon");
    try expectString(result.rawValue(scanner.query_string), "");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "what");
    try expectString(result.rawValue(scanner.query_string), "true");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding == false);
    try expect(result.value_needs_decoding == false);
    try expectString(result.rawName(scanner.query_string), "ok");
    try expectString(result.rawValue(scanner.query_string), "");
    try expect(scanner.next() == null);
}

test "Scanner.next - % encoded" {
    var scanner = Scanner.init("?foo%20=%201023%20&%20what%20the%20fuck%20=%20am%20i%20looking%20at");
    var result: Scanner.Result = undefined;
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding);
    try expect(result.value_needs_decoding);
    try expectString(result.rawName(scanner.query_string), "foo%20");
    try expectString(result.rawValue(scanner.query_string), "%201023%20");
    result = scanner.next() orelse return try std.testing.expect(false);
    try expect(result.name_needs_decoding);
    try expect(result.value_needs_decoding);
    try expectString(result.rawName(scanner.query_string), "%20what%20the%20fuck%20");
    try expectString(result.rawValue(scanner.query_string), "%20am%20i%20looking%20at");
    try expect(scanner.next() == null);
}

test "PercentEncoding.decode" {
    var buffer: [4096]u8 = undefined;
    std.mem.set(u8, &buffer, 0);

    var stream = std.io.fixedBufferStream(&buffer);
    var writer = stream.writer();
    const Writer = @TypeOf(writer);

    {
        const written = try PercentEncoding.decode(Writer, writer, "hello%20world%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B%20%2B");
        const correct = "hello world + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + + +";
        try expect(written == correct.len);
        try expectString(buffer[0..written], correct);
    }

    stream.reset();

    {
        const correct = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        const written = try PercentEncoding.decode(Writer, writer, correct);
        try expect(written == correct.len);
        try expectString(buffer[0..written], correct);
    }

    stream.reset();

    {
        const correct = "hello my name is ?????";
        const input = "hello%20my%20name%20is%20%3F%3F%3F%3F%3F";
        const written = try PercentEncoding.decode(Writer, writer, correct);
        try expect(written == correct.len);
        try expectString(buffer[0..written], correct);
    }
}

test "QueryStringMap (full)" {

    // This is copy pasted from a random twitter thread on Chrome
    const url = "?cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&dm_users=false&include_groups=true&include_inbox_timelines=true&include_ext_media_color=true&supports_reactions=true&muting_enabled=false&nsfw_filtering_enabled=false&cursor=GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA&filter_low_quality=true&include_quality=all&ext=mediaColor&ext=altText&ext=mediaStats&ext=highlightedLabel&ext=voiceInfo";
    // from chrome's devtools
    const fixture = .{
        .@"cards_platform" = "Web-12",
        .@"include_cards" = "1",
        .@"include_ext_alt_text" = "true",
        .@"include_quote_count" = "true",
        .@"include_reply_count" = "1",
        .@"tweet_mode" = "extended",
        .@"dm_users" = "false",
        .@"include_groups" = "true",
        .@"include_inbox_timelines" = "true",
        .@"include_ext_media_color" = "true",
        .@"supports_reactions" = "true",
        .@"muting_enabled" = "false",
        .@"nsfw_filtering_enabled" = "false",
        .@"cursor" = "GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA",
        .@"filter_low_quality" = "true",
        .@"include_quality" = "all",
        .@"ext" = &[_]string{ "mediaColor", "altText", "mediaStats", "highlightedLabel", "voiceInfo" },
    };

    var map = (try QueryStringMap.init(std.testing.allocator, url)) orelse return try std.testing.expect(false);
    defer map.deinit();
    try expectString(fixture.cards_platform, map.get("cards_platform").?);
    try expectString(fixture.include_cards, map.get("include_cards").?);
    try expectString(fixture.include_ext_alt_text, map.get("include_ext_alt_text").?);
    try expectString(fixture.include_quote_count, map.get("include_quote_count").?);
    try expectString(fixture.include_reply_count, map.get("include_reply_count").?);
    try expectString(fixture.tweet_mode, map.get("tweet_mode").?);
    try expectString(fixture.dm_users, map.get("dm_users").?);
    try expectString(fixture.include_groups, map.get("include_groups").?);
    try expectString(fixture.include_inbox_timelines, map.get("include_inbox_timelines").?);
    try expectString(fixture.include_ext_media_color, map.get("include_ext_media_color").?);
    try expectString(fixture.supports_reactions, map.get("supports_reactions").?);
    try expectString(fixture.muting_enabled, map.get("muting_enabled").?);
    try expectString(fixture.nsfw_filtering_enabled, map.get("nsfw_filtering_enabled").?);
    try expectString(fixture.cursor, map.get("cursor").?);
    try expectString(fixture.filter_low_quality, map.get("filter_low_quality").?);
    try expectString(fixture.include_quality, map.get("include_quality").?);
    try expectString(fixture.ext[0], map.get("ext").?);

    var target: [fixture.ext.len]string = undefined;
    try expect((map.getAll("ext", &target)) == fixture.ext.len);

    for (target) |item, i| {
        try expectString(
            fixture.ext[i],
            item,
        );
    }
}

test "QueryStringMap not encoded" {
    const url = "?hey=1&wow=true";
    const fixture = .{
        .@"hey" = "1",
        .@"wow" = "true",
    };
    const url_slice = std.mem.span(url);
    var map = (try QueryStringMap.init(std.testing.allocator, url_slice)) orelse return try std.testing.expect(false);
    try expect(map.buffer.len == 0);
    try expect(url_slice.ptr == map.slice.ptr);
    defer map.deinit();
    try expectString(fixture.hey, map.get("hey").?);
    try expectString(fixture.wow, map.get("wow").?);
}
const expectEqual = std.testing.expectEqual;
test "QueryStringMap Iterator" {
    // This is copy pasted from a random twitter thread on Chrome
    // The only difference from the one above is "ext" is moved before the last one
    // This is to test order of iteration
    const url = "?cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&dm_users=false&include_groups=true&include_inbox_timelines=true&include_ext_media_color=true&supports_reactions=true&muting_enabled=false&nsfw_filtering_enabled=false&cursor=GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA&filter_low_quality=true&ext=voiceInfo&include_quality=all&ext=mediaColor&ext=altText&ext=mediaStats&ext=highlightedLabel";
    // from chrome's devtools
    const fixture = .{
        .@"cards_platform" = "Web-12",
        .@"include_cards" = "1",
        .@"include_ext_alt_text" = "true",
        .@"include_quote_count" = "true",
        .@"include_reply_count" = "1",
        .@"tweet_mode" = "extended",
        .@"dm_users" = "false",
        .@"include_groups" = "true",
        .@"include_inbox_timelines" = "true",
        .@"include_ext_media_color" = "true",
        .@"supports_reactions" = "true",
        .@"muting_enabled" = "false",
        .@"nsfw_filtering_enabled" = "false",
        .@"cursor" = "GRwmkMCq6fLUnMAnFpDAquny1JzAJyUAAAA",
        .@"filter_low_quality" = "true",
        .@"include_quality" = "all",
        .@"ext" = &[_]string{
            "voiceInfo",
            "mediaColor",
            "altText",
            "mediaStats",
            "highlightedLabel",
        },
    };

    var map = (try QueryStringMap.init(std.testing.allocator, url)) orelse return try std.testing.expect(false);
    defer map.deinit();
    var buf_: [48]string = undefined;
    var buf = std.mem.span(&buf_);
    var iter = map.iter();

    var result: QueryStringMap.Iterator.Result = iter.next(buf) orelse return try expect(false);
    try expectString("cards_platform", result.name);
    try expectString(fixture.cards_platform, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_cards", result.name);
    try expectString(fixture.include_cards, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_ext_alt_text", result.name);
    try expectString(fixture.include_ext_alt_text, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_quote_count", result.name);
    try expectString(fixture.include_quote_count, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_reply_count", result.name);
    try expectString(fixture.include_reply_count, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("tweet_mode", result.name);
    try expectString(fixture.tweet_mode, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("dm_users", result.name);
    try expectString(fixture.dm_users, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_groups", result.name);
    try expectString(fixture.include_groups, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_inbox_timelines", result.name);
    try expectString(fixture.include_inbox_timelines, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_ext_media_color", result.name);
    try expectString(fixture.include_ext_media_color, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("supports_reactions", result.name);
    try expectString(fixture.supports_reactions, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("muting_enabled", result.name);
    try expectString(fixture.muting_enabled, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("nsfw_filtering_enabled", result.name);
    try expectString(fixture.nsfw_filtering_enabled, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("cursor", result.name);
    try expectString(fixture.cursor, result.values[0]);
    try expectEqual(result.values.len, 1);
    result = iter.next(buf) orelse return try expect(false);
    try expectString("filter_low_quality", result.name);
    try expectString(fixture.filter_low_quality, result.values[0]);
    try expectEqual(result.values.len, 1);

    result = iter.next(buf) orelse return try expect(false);
    try expectString("ext", result.name);
    try expectEqual(result.values.len, fixture.ext.len);
    for (fixture.ext) |ext, i| {
        try expectString(ext, result.values[i]);
    }

    result = iter.next(buf) orelse return try expect(false);
    try expectString("include_quality", result.name);
    try expectString(fixture.include_quality, result.values[0]);
    try expectEqual(result.values.len, 1);

    try expect(iter.next(buf) == null);
}
