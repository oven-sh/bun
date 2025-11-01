const strings = @This();

/// memmem is provided by libc on posix, but implemented in zig for windows.
pub const memmem = bun.sys.workaround_symbols.memmem;

pub const Encoding = enum {
    ascii,
    utf8,
    latin1,
    utf16,
};

pub const AsciiStatus = enum {
    unknown,
    all_ascii,
    non_ascii,

    pub fn fromBool(is_all_ascii: ?bool) AsciiStatus {
        return if (is_all_ascii orelse return .unknown)
            .all_ascii
        else
            .non_ascii;
    }
};

/// Returned by classification functions that do not discriminate between utf8 and ascii.
pub const EncodingNonAscii = enum {
    utf8,
    utf16,
    latin1,
};

pub fn containsChar(self: string, char: u8) callconv(bun.callconv_inline) bool {
    return indexOfChar(self, char) != null;
}

pub fn containsCharT(comptime T: type, self: []const T, char: u8) callconv(bun.callconv_inline) bool {
    return switch (T) {
        u8 => containsChar(self, char),
        u16 => std.mem.indexOfScalar(u16, self, char) != null,
        else => @compileError("invalid type"),
    };
}

pub fn contains(self: string, str: string) callconv(bun.callconv_inline) bool {
    return containsT(u8, self, str);
}

pub fn containsT(comptime T: type, self: []const T, str: []const T) callconv(bun.callconv_inline) bool {
    return indexOfT(T, self, str) != null;
}

pub fn containsCaseInsensitiveASCII(self: string, str: string) callconv(bun.callconv_inline) bool {
    var start: usize = 0;
    while (start + str.len <= self.len) {
        if (eqlCaseInsensitiveASCIIIgnoreLength(self[start..][0..str.len], str)) {
            return true;
        }
        start += 1;
    }
    return false;
}

pub const OptionalUsize = std.meta.Int(.unsigned, @bitSizeOf(usize) - 1);
pub fn indexOfAny(slice: string, comptime str: []const u8) ?OptionalUsize {
    return switch (comptime str.len) {
        0 => @compileError("str cannot be empty"),
        1 => return indexOfChar(slice, str[0]),
        else => if (bun.highway.indexOfAnyChar(slice, str)) |i|
            @intCast(i)
        else
            null,
    };
}

pub fn indexOfAny16(self: []const u16, comptime str: anytype) ?OptionalUsize {
    return indexOfAnyT(u16, self, str);
}

pub fn indexOfAnyT(comptime T: type, str: []const T, comptime chars: anytype) ?OptionalUsize {
    if (T == u8) return indexOfAny(str, chars);

    for (str, 0..) |c, i| {
        inline for (chars) |a| {
            if (c == a) {
                return @as(OptionalUsize, @intCast(i));
            }
        }
    }

    return null;
}

pub fn containsComptime(self: string, comptime str: string) callconv(bun.callconv_inline) bool {
    if (comptime str.len == 0) @compileError("Don't call this with an empty string plz.");

    const start = std.mem.indexOfScalar(u8, self, str[0]) orelse return false;
    var remain = self[start..];
    const Int = std.meta.Int(.unsigned, str.len * 8);

    while (remain.len >= comptime str.len) {
        if (@as(Int, @bitCast(remain.ptr[0..str.len].*)) == @as(Int, @bitCast(str.ptr[0..str.len].*))) {
            return true;
        }

        const next_start = std.mem.indexOfScalar(u8, remain[1..], str[0]) orelse return false;
        remain = remain[1 + next_start ..];
    }

    return false;
}
pub const includes = contains;

pub fn inMapCaseInsensitive(self: []const u8, comptime ComptimeStringMap: anytype) ?ComptimeStringMap.Value {
    return bun.String.ascii(self).inMapCaseInsensitive(ComptimeStringMap);
}

pub fn containsAny(in: anytype, target: anytype) callconv(bun.callconv_inline) bool {
    for (in) |str| if (contains(if (@TypeOf(str) == u8) &[1]u8{str} else bun.span(str), target)) return true;
    return false;
}

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json
/// - The name must be less than or equal to 214 characters. This includes the scope for scoped packages.
/// - The names of scoped packages can begin with a dot or an underscore. This is not permitted without a scope.
/// - New packages must not have uppercase letters in the name.
/// - The name ends up being part of a URL, an argument on the command line, and
///   a folder name. Therefore, the name can't contain any non-URL-safe
///   characters.
pub fn isNPMPackageName(target: string) bool {
    if (target.len > 214) return false;
    return isNPMPackageNameIgnoreLength(target);
}

pub fn isNPMPackageNameIgnoreLength(target: string) bool {
    if (target.len == 0) return false;

    const scoped = switch (target[0]) {
        // Old packages may have capital letters
        'A'...'Z', 'a'...'z', '0'...'9', '$', '-' => false,
        '@' => true,
        else => return false,
    };

    var slash_index: usize = 0;
    for (target[1..], 0..) |c, i| {
        switch (c) {
            // Old packages may have capital letters
            'A'...'Z', 'a'...'z', '0'...'9', '-', '_', '.' => {},
            '/' => {
                if (!scoped) return false;
                if (slash_index > 0) return false;
                slash_index = i + 1;
            },
            // issue#7045, package "@~3/svelte_mount"
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#description
            // It escapes all characters except: A–Z a–z 0–9 - _ . ! ~ * ' ( )
            '!', '~', '*', '\'', '(', ')' => {
                if (!scoped or slash_index > 0) return false;
            },
            else => return false,
        }
    }

    return !scoped or slash_index > 0 and slash_index + 1 < target.len;
}

pub fn isUUID(str: string) bool {
    if (str.len != uuid_len) return false;
    for (0..8) |i| {
        switch (str[i]) {
            '0'...'9', 'a'...'f', 'A'...'F' => {},
            else => return false,
        }
    }
    if (str[8] != '-') return false;
    for (9..13) |i| {
        switch (str[i]) {
            '0'...'9', 'a'...'f', 'A'...'F' => {},
            else => return false,
        }
    }
    if (str[13] != '-') return false;
    for (14..18) |i| {
        switch (str[i]) {
            '0'...'9', 'a'...'f', 'A'...'F' => {},
            else => return false,
        }
    }
    if (str[18] != '-') return false;
    for (19..23) |i| {
        switch (str[i]) {
            '0'...'9', 'a'...'f', 'A'...'F' => {},
            else => return false,
        }
    }
    if (str[23] != '-') return false;
    for (24..36) |i| {
        switch (str[i]) {
            '0'...'9', 'a'...'f', 'A'...'F' => {},
            else => return false,
        }
    }
    return true;
}

pub const uuid_len = 36;

pub fn startsWithUUID(str: string) bool {
    return isUUID(str[0..@min(str.len, uuid_len)]);
}

/// https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/node_modules/%40npmcli/redact/lib/matchers.js#L7
/// /\b(npms?_)[a-zA-Z0-9]{36,48}\b/gi
/// Returns the length of the secret if one exist.
pub fn startsWithNpmSecret(str: string) u8 {
    if (str.len < "npm_".len + 36) return 0;

    if (!strings.hasPrefixCaseInsensitive(str, "npm")) return 0;

    var i: u8 = "npm".len;

    if (str[i] == '_') {
        i += 1;
    } else if (str[i] == 's' or str[i] == 'S') {
        i += 1;
        if (str[i] != '_') return 0;
        i += 1;
    } else {
        return 0;
    }

    const min_len = i + 36;
    const max_len = i + 48;

    while (i < max_len) : (i += 1) {
        if (i == str.len) {
            return if (i >= min_len) i else 0;
        }

        switch (str[i]) {
            '0'...'9', 'a'...'z', 'A'...'Z' => {},
            else => return if (i >= min_len) i else 0,
        }
    }

    return i;
}

fn startsWithRedactedItem(text: string, comptime item: string) ?struct { usize, usize } {
    if (!strings.hasPrefixComptime(text, item)) return null;

    var whitespace = false;
    var offset: usize = item.len;
    while (offset < text.len and std.ascii.isWhitespace(text[offset])) {
        offset += 1;
        whitespace = true;
    }
    if (offset == text.len) return null;
    const cont = js_lexer.isIdentifierContinue(text[offset]);

    // must be another identifier
    if (!whitespace and cont) return null;

    // `null` is not returned after this point. Redact to the next
    // newline if anything is unexpected
    if (cont) return .{ offset, indexOfChar(text[offset..], '\n') orelse text[offset..].len };
    offset += 1;

    var end = offset;
    while (end < text.len and std.ascii.isWhitespace(text[end])) {
        end += 1;
    }

    if (end == text.len) {
        return .{ offset, text[offset..].len };
    }

    switch (text[end]) {
        inline '\'', '"', '`' => |q| {
            // attempt to find closing
            const opening = end;
            end += 1;
            while (end < text.len) {
                switch (text[end]) {
                    '\\' => {
                        // skip
                        end += 1;
                        end += 1;
                    },
                    q => {
                        // closing
                        return .{ opening + 1, (end - 1) - opening };
                    },
                    else => {
                        end += 1;
                    },
                }
            }

            const len = strings.indexOfChar(text[offset..], '\n') orelse text[offset..].len;
            return .{ offset, len };
        },
        else => {
            const len = strings.indexOfChar(text[offset..], '\n') orelse text[offset..].len;
            return .{ offset, len };
        },
    }
}

/// Returns offset and length of first secret found.
pub fn startsWithSecret(str: string) ?struct { usize, usize } {
    if (startsWithRedactedItem(str, "_auth")) |auth| {
        const offset, const len = auth;
        return .{ offset, len };
    }
    if (startsWithRedactedItem(str, "_authToken")) |auth_token| {
        const offset, const len = auth_token;
        return .{ offset, len };
    }
    if (startsWithRedactedItem(str, "email")) |email| {
        const offset, const len = email;
        return .{ offset, len };
    }
    if (startsWithRedactedItem(str, "_password")) |password| {
        const offset, const len = password;
        return .{ offset, len };
    }
    if (startsWithRedactedItem(str, "token")) |token| {
        const offset, const len = token;
        return .{ offset, len };
    }

    if (startsWithUUID(str)) {
        return .{ 0, 36 };
    }

    const npm_secret_len = startsWithNpmSecret(str);
    if (npm_secret_len > 0) {
        return .{ 0, npm_secret_len };
    }

    if (findUrlPassword(str)) |url_pass| {
        const offset, const len = url_pass;
        return .{ offset, len };
    }

    return null;
}

pub fn findUrlPassword(text: string) ?struct { usize, usize } {
    if (!strings.hasPrefixComptime(text, "http")) return null;
    var offset: usize = "http".len;
    if (hasPrefixComptime(text[offset..], "://")) {
        offset += "://".len;
    } else if (hasPrefixComptime(text[offset..], "s://")) {
        offset += "s://".len;
    } else {
        return null;
    }
    var remain = text[offset..];
    const end = indexOfChar(remain, '\n') orelse remain.len;
    remain = remain[0..end];
    const at = indexOfChar(remain, '@') orelse return null;
    const colon = indexOfCharNeg(remain[0..at], ':');
    if (colon == -1 or colon == at - 1) return null;
    offset += @intCast(colon + 1);
    const len: usize = at - @as(usize, @intCast(colon + 1));
    return .{ offset, len };
}

pub fn indexAnyComptime(target: string, comptime chars: string) ?usize {
    for (target, 0..) |parent, i| {
        inline for (chars) |char| {
            if (char == parent) return i;
        }
    }
    return null;
}

pub fn indexAnyComptimeT(comptime T: type, target: []const T, comptime chars: []const T) ?usize {
    for (target, 0..) |parent, i| {
        inline for (chars) |char| {
            if (char == parent) return i;
        }
    }
    return null;
}

pub fn indexEqualAny(in: anytype, target: string) ?usize {
    for (in, 0..) |str, i| if (eqlLong(str, target, true)) return i;
    return null;
}

pub fn repeatingAlloc(allocator: std.mem.Allocator, count: usize, char: u8) ![]u8 {
    const buf = try allocator.alloc(u8, count);
    repeatingBuf(buf, char);
    return buf;
}

pub fn repeatingBuf(self: []u8, char: u8) void {
    @memset(self, char);
}

pub fn indexOfCharNeg(self: string, char: u8) i32 {
    for (self, 0..) |c, i| {
        if (c == char) return @as(i32, @intCast(i));
    }
    return -1;
}

pub fn indexOfSigned(self: string, str: string) i32 {
    const i = std.mem.indexOf(u8, self, str) orelse return -1;
    return @as(i32, @intCast(i));
}

/// Returns last index of `char` before a character `before`.
pub fn lastIndexBeforeChar(in: []const u8, char: u8, before: u8) ?usize {
    const before_pos = indexOfChar(in, before) orelse in.len;
    return lastIndexOfChar(in[0..before_pos], char);
}

pub fn lastIndexOfChar(self: []const u8, char: u8) callconv(bun.callconv_inline) ?usize {
    if (comptime Environment.isLinux) {
        if (@inComptime()) {
            return lastIndexOfCharT(u8, self, char);
        }
        const start = bun.c.memrchr(self.ptr, char, self.len) orelse return null;
        const i = @intFromPtr(start) - @intFromPtr(self.ptr);
        return @intCast(i);
    }
    return lastIndexOfCharT(u8, self, char);
}

pub fn lastIndexOfCharT(comptime T: type, self: []const T, char: T) callconv(bun.callconv_inline) ?usize {
    return std.mem.lastIndexOfScalar(T, self, char);
}

pub fn lastIndexOf(self: string, str: string) callconv(bun.callconv_inline) ?usize {
    return std.mem.lastIndexOf(u8, self, str);
}

pub fn indexOf(self: string, str: string) ?usize {
    if (comptime !bun.Environment.isNative) {
        return std.mem.indexOf(u8, self, str);
    }

    const self_len = self.len;
    const str_len = str.len;

    // > Both old and new libc's have the bug that if needle is empty,
    // > haystack-1 (instead of haystack) is returned. And glibc 2.0 makes it
    // > worse, returning a pointer to the last byte of haystack. This is fixed
    // > in glibc 2.1.
    if (self_len == 0 or str_len == 0 or self_len < str_len)
        return null;

    const self_ptr = self.ptr;
    const str_ptr = str.ptr;

    if (str_len == 1)
        return indexOfCharUsize(self, str_ptr[0]);

    const start = memmem(self_ptr, self_len, str_ptr, str_len) orelse return null;

    const i = @intFromPtr(start) - @intFromPtr(self_ptr);
    bun.unsafeAssert(i < self_len);
    return @as(usize, @intCast(i));
}

pub fn indexOfT(comptime T: type, haystack: []const T, needle: []const T) ?usize {
    if (T == u8) return indexOf(haystack, needle);
    return std.mem.indexOf(T, haystack, needle);
}

pub fn split(self: string, delimiter: string) SplitIterator {
    return SplitIterator{
        .buffer = self,
        .index = 0,
        .delimiter = delimiter,
    };
}

pub const SplitIterator = struct {
    buffer: []const u8,
    index: ?usize,
    delimiter: []const u8,

    const Self = @This();

    /// Returns a slice of the first field. This never fails.
    /// Call this only to get the first field and then use `next` to get all subsequent fields.
    pub fn first(self: *Self) []const u8 {
        bun.unsafeAssert(self.index.? == 0);
        return self.next().?;
    }

    /// Returns a slice of the next field, or null if splitting is complete.
    pub fn next(self: *Self) ?[]const u8 {
        const start = self.index orelse return null;
        const end = if (indexOf(self.buffer[start..], self.delimiter)) |delim_start| blk: {
            const del = delim_start + start;
            self.index = del + self.delimiter.len;
            break :blk delim_start + start;
        } else blk: {
            self.index = null;
            break :blk self.buffer.len;
        };

        return self.buffer[start..end];
    }

    /// Returns a slice of the remaining bytes. Does not affect iterator state.
    pub fn rest(self: Self) []const u8 {
        const end = self.buffer.len;
        const start = self.index orelse end;
        return self.buffer[start..end];
    }

    /// Resets the iterator to the initial slice.
    pub fn reset(self: *Self) void {
        self.index = 0;
    }
};

pub fn cat(allocator: std.mem.Allocator, first: string, second: string) !string {
    var out = try allocator.alloc(u8, first.len + second.len);
    bun.copy(u8, out, first);
    bun.copy(u8, out[first.len..], second);
    return out;
}

// 31 character string or a slice
pub const StringOrTinyString = struct {
    pub const Max = 31;
    const Buffer = [Max]u8;

    remainder_buf: Buffer = undefined,
    meta: packed struct(u8) {
        remainder_len: u7 = 0,
        is_tiny_string: u1 = 0,
    } = .{},

    comptime {
        bun.unsafeAssert(@sizeOf(@This()) == 32);
    }

    pub fn slice(this: *const StringOrTinyString) callconv(bun.callconv_inline) []const u8 {
        // This is a switch expression instead of a statement to make sure it uses the faster assembly
        return switch (this.meta.is_tiny_string) {
            1 => this.remainder_buf[0..this.meta.remainder_len],
            0 => @as([*]const u8, @ptrFromInt(std.mem.readInt(usize, this.remainder_buf[0..@sizeOf(usize)], .little)))[0..std.mem.readInt(usize, this.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], .little)],
        };
    }

    pub fn deinit(this: *StringOrTinyString, _: std.mem.Allocator) void {
        if (this.meta.is_tiny_string == 1) return;

        // var slice_ = this.slice();
        // allocator.free(slice_);
    }

    pub fn initAppendIfNeeded(stringy: string, comptime Appender: type, appendy: Appender) OOM!StringOrTinyString {
        if (stringy.len <= StringOrTinyString.Max) {
            return StringOrTinyString.init(stringy);
        }

        return StringOrTinyString.init(try appendy.append(string, stringy));
    }

    pub fn initLowerCaseAppendIfNeeded(stringy: string, comptime Appender: type, appendy: Appender) OOM!StringOrTinyString {
        if (stringy.len <= StringOrTinyString.Max) {
            return StringOrTinyString.initLowerCase(stringy);
        }

        return StringOrTinyString.init(try appendy.appendLowerCase(string, stringy));
    }

    pub fn init(stringy: string) StringOrTinyString {
        switch (stringy.len) {
            0 => {
                return StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = 0,
                } };
            },
            1...(@sizeOf(Buffer)) => {
                @setRuntimeSafety(false);
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = @as(u7, @truncate(stringy.len)),
                } };
                @memcpy(tiny.remainder_buf[0..tiny.meta.remainder_len], stringy[0..tiny.meta.remainder_len]);
                return tiny;
            },
            else => {
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 0,
                    .remainder_len = 0,
                } };
                std.mem.writeInt(usize, tiny.remainder_buf[0..@sizeOf(usize)], @intFromPtr(stringy.ptr), .little);
                std.mem.writeInt(usize, tiny.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], stringy.len, .little);
                return tiny;
            },
        }
    }

    pub fn initLowerCase(stringy: string) StringOrTinyString {
        switch (stringy.len) {
            0 => {
                return StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = 0,
                } };
            },
            1...(@sizeOf(Buffer)) => {
                @setRuntimeSafety(false);
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = @as(u7, @truncate(stringy.len)),
                } };
                _ = copyLowercase(stringy, &tiny.remainder_buf);
                return tiny;
            },
            else => {
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 0,
                    .remainder_len = 0,
                } };
                std.mem.writeInt(usize, tiny.remainder_buf[0..@sizeOf(usize)], @intFromPtr(stringy.ptr), .little);
                std.mem.writeInt(usize, tiny.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], stringy.len, .little);
                return tiny;
            },
        }
    }
};

pub fn copyLowercase(in: string, out: []u8) string {
    var in_slice = in;
    var out_slice = out;

    begin: while (true) {
        for (in_slice, 0..) |c, i| {
            switch (c) {
                'A'...'Z' => {
                    bun.copy(u8, out_slice, in_slice[0..i]);
                    out_slice[i] = std.ascii.toLower(c);
                    const end = i + 1;
                    in_slice = in_slice[end..];
                    out_slice = out_slice[end..];
                    continue :begin;
                },
                else => {},
            }
        }

        bun.copy(u8, out_slice, in_slice);
        break :begin;
    }

    return out[0..in.len];
}

pub fn copyLowercaseIfNeeded(in: string, out: []u8) string {
    var in_slice = in;
    var out_slice = out;
    var any = false;

    begin: while (true) {
        for (in_slice, 0..) |c, i| {
            switch (c) {
                'A'...'Z' => {
                    bun.copy(u8, out_slice, in_slice[0..i]);
                    out_slice[i] = std.ascii.toLower(c);
                    const end = i + 1;
                    in_slice = in_slice[end..];
                    out_slice = out_slice[end..];
                    any = true;
                    continue :begin;
                },
                else => {},
            }
        }

        if (any) bun.copy(u8, out_slice, in_slice);
        break :begin;
    }

    return if (any) out[0..in.len] else in;
}

/// Copy a string into a buffer
/// Return the copied version
pub fn copy(buf: []u8, src: []const u8) []const u8 {
    const len = @min(buf.len, src.len);
    if (len > 0)
        @memcpy(buf[0..len], src[0..len]);
    return buf[0..len];
}

/// startsWith except it checks for non-empty strings
pub fn hasPrefix(self: string, str: string) bool {
    return str.len > 0 and startsWith(self, str);
}

pub fn startsWith(self: string, str: string) bool {
    if (str.len > self.len) {
        return false;
    }

    return eqlLong(self[0..str.len], str, false);
}

/// Transliterated from:
/// https://github.com/rust-lang/rust/blob/91376f416222a238227c84a848d168835ede2cc3/library/core/src/str/mod.rs#L188
pub fn isOnCharBoundary(self: string, idx: usize) bool {
    // 0 is always ok.
    // Test for 0 explicitly so that it can optimize out the check
    // easily and skip reading string data for that case.
    // Note that optimizing `self.get(..idx)` relies on this.
    if (idx == 0) {
        return true;
    }

    // For `idx >= self.len` we have two options:
    //
    // - idx == self.len
    //   Empty strings are valid, so return true
    // - idx > self.len
    //   In this case return false
    //
    // The check is placed exactly here, because it improves generated
    // code on higher opt-levels. See PR #84751 for more details.
    // TODO(zack) this code is optimized for Rust's `self.as_bytes().get(idx)` function, don'
    if (idx >= self.len) return idx == self.len;

    return isUtf8CharBoundary(self[idx]);
}

pub fn isUtf8CharBoundary(c: u8) bool {
    // This is bit magic equivalent to: b < 128 || b >= 192
    return @as(i8, @bitCast(c)) >= -0x40;
}

pub fn startsWithCaseInsensitiveAscii(self: string, prefix: string) bool {
    return self.len >= prefix.len and eqlCaseInsensitiveASCII(self[0..prefix.len], prefix, false);
}

pub fn startsWithGeneric(comptime T: type, self: []const T, str: []const T) bool {
    if (str.len > self.len) {
        return false;
    }

    return eqlLong(bun.reinterpretSlice(u8, self[0..str.len]), bun.reinterpretSlice(u8, str[0..str.len]), false);
}

pub fn endsWith(self: string, str: string) callconv(bun.callconv_inline) bool {
    return str.len == 0 or @call(bun.callmod_inline, std.mem.endsWith, .{ u8, self, str });
}

pub fn endsWithComptime(self: string, comptime str: anytype) callconv(bun.callconv_inline) bool {
    return self.len >= str.len and eqlComptimeIgnoreLen(self[self.len - str.len .. self.len], comptime str);
}

pub fn startsWithChar(self: string, char: u8) callconv(bun.callconv_inline) bool {
    return self.len > 0 and self[0] == char;
}

pub fn endsWithChar(self: string, char: u8) callconv(bun.callconv_inline) bool {
    return self.len > 0 and self[self.len - 1] == char;
}

pub fn endsWithCharOrIsZeroLength(self: string, char: u8) callconv(bun.callconv_inline) bool {
    return self.len == 0 or self[self.len - 1] == char;
}

pub fn endsWithAny(self: string, str: string) bool {
    const end = self[self.len - 1];
    for (str) |char| {
        if (char == end) {
            return true;
        }
    }

    return false;
}

pub fn quotedAlloc(allocator: std.mem.Allocator, self: string) !string {
    var count: usize = 0;
    for (self) |char| {
        count += @intFromBool(char == '"');
    }

    if (count == 0) {
        return allocator.dupe(u8, self);
    }

    var i: usize = 0;
    var out = try allocator.alloc(u8, self.len + count);
    for (self) |char| {
        if (char == '"') {
            out[i] = '\\';
            i += 1;
        }
        out[i] = char;
        i += 1;
    }

    return out;
}

pub fn eqlAnyComptime(self: string, comptime list: []const string) bool {
    inline for (list) |item| {
        if (eqlComptimeCheckLenWithType(u8, self, item, true)) return true;
    }

    return false;
}

/// Count the occurrences of a character in an ASCII byte array
/// uses SIMD
pub fn countChar(self: string, char: u8) usize {
    var total: usize = 0;
    var remaining = self;

    const splatted: AsciiVector = @splat(char);

    while (remaining.len >= 16) {
        const vec: AsciiVector = remaining[0..ascii_vector_size].*;
        const cmp = @popCount(@as(@Vector(ascii_vector_size, u1), @bitCast(vec == splatted)));
        total += @as(usize, @reduce(.Add, cmp));
        remaining = remaining[ascii_vector_size..];
    }

    while (remaining.len > 0) {
        total += @as(usize, @intFromBool(remaining[0] == char));
        remaining = remaining[1..];
    }

    return total;
}

pub fn endsWithAnyComptime(self: string, comptime str: string) bool {
    if (comptime str.len < 10) {
        const last = self[self.len - 1];
        inline for (str) |char| {
            if (char == last) {
                return true;
            }
        }

        return false;
    } else {
        return endsWithAny(self, str);
    }
}

pub fn eql(self: string, other: []const u8) bool {
    if (self.len != other.len) return false;
    if (comptime @TypeOf(other) == *string) {
        return eql(self, other.*);
    }

    return eqlLong(self, other, false);
}

pub fn eqlComptimeT(comptime T: type, self: []const T, comptime alt: anytype) bool {
    if (T == u16) {
        return eqlComptimeUTF16(self, alt);
    }

    return eqlComptime(self, alt);
}

pub fn eqlComptime(self: string, comptime alt: anytype) bool {
    return eqlComptimeCheckLenWithType(u8, self, alt, true);
}

pub fn eqlComptimeUTF16(self: []const u16, comptime alt: []const u8) bool {
    return eqlComptimeCheckLenWithType(u16, self, comptime toUTF16Literal(alt), true);
}

pub fn eqlComptimeIgnoreLen(self: string, comptime alt: anytype) bool {
    return eqlComptimeCheckLenWithType(u8, self, alt, false);
}

pub fn hasPrefixComptime(self: string, comptime alt: anytype) bool {
    return self.len >= alt.len and eqlComptimeCheckLenWithType(u8, self[0..alt.len], alt, false);
}

pub fn hasPrefixComptimeUTF16(self: []const u16, comptime alt: []const u8) bool {
    return self.len >= alt.len and eqlComptimeCheckLenWithType(u16, self[0..alt.len], comptime toUTF16Literal(alt), false);
}

pub fn hasPrefixComptimeType(comptime T: type, self: []const T, comptime alt: anytype) bool {
    const rhs = comptime switch (T) {
        u8 => alt,
        u16 => switch (bun.meta.Item(@TypeOf(alt))) {
            u16 => alt,
            else => w(alt),
        },
        else => @compileError("Unsupported type given to hasPrefixComptimeType"),
    };
    return self.len >= alt.len and eqlComptimeCheckLenWithType(T, self[0..rhs.len], rhs, false);
}

pub fn hasSuffixComptime(self: string, comptime alt: anytype) bool {
    return self.len >= alt.len and eqlComptimeCheckLenWithType(u8, self[self.len - alt.len ..], alt, false);
}

const eqlComptimeCheckLenU8 = if (bun.Environment.isDebug) eqlComptimeDebugRuntimeFallback else eqlComptimeCheckLenU8Impl;

fn eqlComptimeDebugRuntimeFallback(a: []const u8, b: []const u8, check_len: bool) bool {
    return std.mem.eql(u8, if (check_len) a else a.ptr[0..b.len], b);
}

fn eqlComptimeCheckLenU8Impl(a: []const u8, comptime b: []const u8, comptime check_len: bool) bool {
    @setEvalBranchQuota(9999);

    if (comptime check_len) {
        if (a.len != b.len) return false;
    }

    comptime var b_ptr: usize = 0;

    inline while (b.len - b_ptr >= @sizeOf(usize)) {
        if (@as(usize, @bitCast(a[b_ptr..][0..@sizeOf(usize)].*)) != comptime @as(usize, @bitCast(b[b_ptr..][0..@sizeOf(usize)].*)))
            return false;
        comptime b_ptr += @sizeOf(usize);
        if (comptime b_ptr == b.len) return true;
    }

    if (comptime @sizeOf(usize) == 8) {
        if (comptime (b.len & 4) != 0) {
            if (@as(u32, @bitCast(a[b_ptr..][0..@sizeOf(u32)].*)) != comptime @as(u32, @bitCast(b[b_ptr..][0..@sizeOf(u32)].*)))
                return false;
            comptime b_ptr += @sizeOf(u32);
            if (comptime b_ptr == b.len) return true;
        }
    }

    if (comptime (b.len & 2) != 0) {
        if (@as(u16, @bitCast(a[b_ptr..][0..@sizeOf(u16)].*)) != comptime @as(u16, @bitCast(b[b_ptr..][0..@sizeOf(u16)].*)))
            return false;

        comptime b_ptr += @sizeOf(u16);

        if (comptime b_ptr == b.len) return true;
    }

    if ((comptime (b.len & 1) != 0) and a[b_ptr] != comptime b[b_ptr]) return false;

    return true;
}

fn eqlComptimeCheckLenWithKnownType(comptime Type: type, a: []const Type, comptime b: []const Type, comptime check_len: bool) bool {
    if (comptime Type != u8) {
        return eqlComptimeCheckLenU8(std.mem.sliceAsBytes(a), comptime std.mem.sliceAsBytes(b), comptime check_len);
    }
    return eqlComptimeCheckLenU8(a, comptime b, comptime check_len);
}

/// Check if two strings are equal with one of the strings being a comptime-known value
///
///   strings.eqlComptime(input, "hello world");
///   strings.eqlComptime(input, "hai");
pub fn eqlComptimeCheckLenWithType(comptime Type: type, a: []const Type, comptime b: anytype, comptime check_len: bool) bool {
    return eqlComptimeCheckLenWithKnownType(comptime Type, a, if (@typeInfo(@TypeOf(b)) != .pointer) &b else b, comptime check_len);
}

pub fn eqlCaseInsensitiveASCIIIgnoreLength(
    a: string,
    b: string,
) bool {
    return eqlCaseInsensitiveASCII(a, b, false);
}

pub fn eqlCaseInsensitiveASCIIICheckLength(
    a: string,
    b: string,
) bool {
    return eqlCaseInsensitiveASCII(a, b, true);
}

pub fn eqlCaseInsensitiveASCII(a: string, b: string, comptime check_len: bool) bool {
    if (comptime check_len) {
        if (a.len != b.len) return false;
        if (a.len == 0) return true;
    }

    bun.unsafeAssert(b.len > 0);
    bun.unsafeAssert(a.len > 0);

    return bun.c.strncasecmp(a.ptr, b.ptr, a.len) == 0;
}

pub fn eqlCaseInsensitiveT(comptime T: type, a: []const T, b: []const u8) bool {
    if (a.len != b.len or a.len == 0) return false;
    if (comptime T == u8) return eqlCaseInsensitiveASCIIIgnoreLength(a, b);

    for (a, b) |c, d| {
        switch (c) {
            'a'...'z' => if (c != d and c & 0b11011111 != d) return false,
            'A'...'Z' => if (c != d and c | 0b00100000 != d) return false,
            else => if (c != d) return false,
        }
    }

    return true;
}

pub fn hasPrefixCaseInsensitiveT(comptime T: type, str: []const T, prefix: []const u8) bool {
    if (str.len < prefix.len) return false;

    return eqlCaseInsensitiveT(T, str[0..prefix.len], prefix);
}

pub fn hasPrefixCaseInsensitive(str: []const u8, prefix: []const u8) bool {
    return hasPrefixCaseInsensitiveT(u8, str, prefix);
}

pub fn eqlLongT(comptime T: type, a_str: []const T, b_str: []const T, comptime check_len: bool) bool {
    if (comptime check_len) {
        const len = b_str.len;
        if (len == 0) {
            return a_str.len == 0;
        }
        if (a_str.len != len) {
            return false;
        }
    }
    return eqlLong(bun.reinterpretSlice(u8, a_str), bun.reinterpretSlice(u8, b_str), false);
}

pub fn eqlLong(a_str: string, b_str: string, comptime check_len: bool) bool {
    const len = b_str.len;

    if (comptime check_len) {
        if (len == 0) {
            return a_str.len == 0;
        }

        if (a_str.len != len) {
            return false;
        }
    } else {
        if (comptime Environment.allow_assert) assert(b_str.len <= a_str.len);
    }

    const end = b_str.ptr + len;
    var a = a_str.ptr;
    var b = b_str.ptr;

    if (a == b)
        return true;

    {
        var dword_length = len >> 3;
        while (dword_length > 0) : (dword_length -= 1) {
            if (@as(usize, @bitCast(a[0..@sizeOf(usize)].*)) != @as(usize, @bitCast(b[0..@sizeOf(usize)].*)))
                return false;
            b += @sizeOf(usize);
            if (b == end) return true;
            a += @sizeOf(usize);
        }
    }

    if (comptime @sizeOf(usize) == 8) {
        if ((len & 4) != 0) {
            if (@as(u32, @bitCast(a[0..@sizeOf(u32)].*)) != @as(u32, @bitCast(b[0..@sizeOf(u32)].*)))
                return false;

            b += @sizeOf(u32);
            if (b == end) return true;
            a += @sizeOf(u32);
        }
    }

    if ((len & 2) != 0) {
        if (@as(u16, @bitCast(a[0..@sizeOf(u16)].*)) != @as(u16, @bitCast(b[0..@sizeOf(u16)].*)))
            return false;

        b += @sizeOf(u16);

        if (b == end) return true;

        a += @sizeOf(u16);
    }

    if (((len & 1) != 0) and a[0] != b[0]) return false;

    return true;
}

pub fn append(allocator: std.mem.Allocator, self: string, other: string) callconv(bun.callconv_inline) ![]u8 {
    var buf = try allocator.alloc(u8, self.len + other.len);
    if (self.len > 0)
        @memcpy(buf[0..self.len], self);
    if (other.len > 0)
        @memcpy(buf[self.len..][0..other.len], other);
    return buf;
}

pub fn concatAllocT(comptime T: type, allocator: std.mem.Allocator, strs: anytype) callconv(bun.callconv_inline) ![]T {
    const buf = try allocator.alloc(T, len: {
        var len: usize = 0;
        inline for (strs) |s| {
            len += s.len;
        }
        break :len len;
    });

    return concatBufT(T, buf, strs) catch |e| switch (e) {
        error.NoSpaceLeft => unreachable, // exact size calculated
    };
}

pub fn concatBufT(comptime T: type, out: []T, strs: anytype) callconv(bun.callconv_inline) ![]T {
    var remain = out;
    var n: usize = 0;
    inline for (strs) |s| {
        if (s.len > remain.len) {
            return error.NoSpaceLeft;
        }
        @memcpy(remain.ptr, s);
        remain = remain[s.len..];
        n += s.len;
    }

    return out[0..n];
}

pub fn index(self: string, str: string) i32 {
    if (strings.indexOf(self, str)) |i| {
        return @as(i32, @intCast(i));
    } else {
        return -1;
    }
}

/// Returns a substring starting at `start` up to the end of the string.
/// If `start` is greater than the string's length, returns an empty string.
pub fn substring(self: anytype, start: ?usize, stop: ?usize) @TypeOf(self) {
    const sta = start orelse 0;
    const sto = stop orelse self.len;

    return self[@min(sta, self.len)..@min(sto, self.len)];
}

pub const ascii_vector_size = if (Environment.isWasm) 8 else 16;
pub const ascii_u16_vector_size = if (Environment.isWasm) 4 else 8;
pub const AsciiVectorInt = std.meta.Int(.unsigned, ascii_vector_size);
pub const AsciiVectorIntU16 = std.meta.Int(.unsigned, ascii_u16_vector_size);
pub const max_16_ascii: @Vector(ascii_vector_size, u8) = @splat(@as(u8, 127));
pub const min_16_ascii: @Vector(ascii_vector_size, u8) = @splat(@as(u8, 0x20));
pub const max_u16_ascii: @Vector(ascii_u16_vector_size, u16) = @splat(@as(u16, 127));
pub const min_u16_ascii: @Vector(ascii_u16_vector_size, u16) = @splat(@as(u16, 0x20));
pub const AsciiVector = @Vector(ascii_vector_size, u8);
pub const AsciiVectorSmall = @Vector(8, u8);
pub const AsciiVectorU1 = @Vector(ascii_vector_size, u1);
pub const AsciiVectorU1Small = @Vector(8, u1);
pub const AsciiVectorU16U1 = @Vector(ascii_u16_vector_size, u1);
pub const AsciiU16Vector = @Vector(ascii_u16_vector_size, u16);
pub const max_4_ascii: @Vector(4, u8) = @splat(@as(u8, 127));

pub fn firstNonASCII(slice: []const u8) ?u32 {
    const result = bun.simdutf.validate.with_errors.ascii(slice);
    if (result.status == .success) {
        return null;
    }

    return @as(u32, @truncate(result.count));
}

pub const indexOfNewlineOrNonASCIIOrANSI = indexOfNewlineOrNonASCII;

/// Checks if slice[offset..] has any < 0x20 or > 127 characters
pub fn indexOfNewlineOrNonASCII(slice_: []const u8, offset: u32) ?u32 {
    return indexOfNewlineOrNonASCIICheckStart(slice_, offset, true);
}

pub fn indexOfSpaceOrNewlineOrNonASCII(slice_: []const u8, offset: u32) ?u32 {
    const slice = slice_[offset..];
    const remaining = slice;

    if (remaining.len == 0)
        return null;

    if (remaining[0] > 127 or (remaining[0] < 0x20 and remaining[0] != 0x09)) {
        return offset;
    }

    const i = bun.highway.indexOfSpaceOrNewlineOrNonASCII(remaining) orelse return null;
    return @as(u32, @truncate(i)) + offset;
}

pub fn indexOfNewlineOrNonASCIICheckStart(slice_: []const u8, offset: u32, comptime check_start: bool) ?u32 {
    const slice = slice_[offset..];
    const remaining = slice;

    if (remaining.len == 0)
        return null;

    if (comptime check_start) {
        // this shows up in profiling
        if (remaining[0] > 127 or (remaining[0] < 0x20 and remaining[0] != 0x09)) {
            return offset;
        }
    }

    const i = bun.highway.indexOfNewlineOrNonASCII(remaining) orelse return null;
    return @as(u32, @truncate(i)) + offset;
}

pub fn containsNewlineOrNonASCIIOrQuote(text: []const u8) bool {
    return bun.highway.containsNewlineOrNonASCIIOrQuote(text);
}

/// Supports:
/// - `"`
/// - `'`
/// - "`"
pub fn indexOfNeedsEscapeForJavaScriptString(slice: []const u8, quote_char: u8) ?u32 {
    if (slice.len == 0)
        return null;

    return bun.highway.indexOfNeedsEscapeForJavaScriptString(slice, quote_char);
}

pub fn indexOfNeedsURLEncode(slice: []const u8) ?u32 {
    var remaining = slice;
    if (remaining.len == 0)
        return null;

    if (remaining[0] >= 127 or
        remaining[0] < 0x20 or
        remaining[0] == '%' or
        remaining[0] == '\\' or
        remaining[0] == '"' or
        remaining[0] == '#' or
        remaining[0] == '?' or
        remaining[0] == '[' or
        remaining[0] == ']' or
        remaining[0] == '^' or
        remaining[0] == '|' or
        remaining[0] == '~')
    {
        return 0;
    }

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp: AsciiVectorU1 =
                @as(AsciiVectorU1, @bitCast(vec > max_16_ascii)) |
                @as(AsciiVectorU1, @bitCast((vec < min_16_ascii))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('%')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('\\')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('"')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('#')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('?')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('[')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(']')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('^')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('|')))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat('~'))));

            if (@reduce(.Max, cmp) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);
                return @as(u32, first) + @as(u32, @truncate(@intFromPtr(remaining.ptr) - @intFromPtr(slice.ptr)));
            }

            remaining = remaining[ascii_vector_size..];
        }
    }

    for (remaining) |*char_| {
        const char = char_.*;
        if (char > 127 or char < 0x20 or
            char == '\\' or
            char == '%' or
            char == '"' or
            char == '#' or
            char == '?' or
            char == '[' or
            char == ']' or
            char == '^' or
            char == '|' or
            char == '~')
        {
            return @as(u32, @truncate(@intFromPtr(char_) - @intFromPtr(slice.ptr)));
        }
    }

    return null;
}

pub fn indexOfCharZ(sliceZ: [:0]const u8, char: u8) ?u63 {
    return @truncate(bun.highway.indexOfChar(sliceZ, char) orelse return null);
}

pub fn indexOfChar(slice: []const u8, char: u8) ?u32 {
    return @as(u32, @truncate(indexOfCharUsize(slice, char) orelse return null));
}

pub fn indexOfCharUsize(slice: []const u8, char: u8) ?usize {
    if (comptime !Environment.isNative) {
        return std.mem.indexOfScalar(u8, slice, char);
    }

    return bun.highway.indexOfChar(slice, char);
}

pub fn indexOfCharPos(slice: []const u8, char: u8, start_index: usize) ?usize {
    if (!Environment.isNative) {
        return std.mem.indexOfScalarPos(u8, slice, char);
    }

    if (start_index >= slice.len) return null;

    const result = bun.highway.indexOfChar(slice[start_index..], char) orelse return null;
    bun.debugAssert(slice.len > result + start_index);
    return result + start_index;
}

pub fn indexOfAnyPosComptime(slice: []const u8, comptime chars: []const u8, start_index: usize) ?usize {
    if (chars.len == 1) return indexOfCharPos(slice, chars[0], start_index);
    return std.mem.indexOfAnyPos(u8, slice, start_index, chars);
}

pub fn indexOfChar16Usize(slice: []const u16, char: u16) ?usize {
    return std.mem.indexOfScalar(u16, slice, char);
}

pub fn indexOfNotChar(slice: []const u8, char: u8) ?u32 {
    var remaining = slice;
    if (remaining.len == 0)
        return null;

    if (remaining[0] != char)
        return 0;

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp = @as(AsciiVector, @splat(char)) != vec;
            if (@reduce(.Max, @as(AsciiVectorU1, @bitCast(cmp))) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);
                return @as(u32, first) + @as(u32, @intCast(slice.len - remaining.len));
            }

            remaining = remaining[ascii_vector_size..];
        }
    }

    for (remaining) |*current| {
        if (current.* != char) {
            return @as(u32, @truncate(@intFromPtr(current) - @intFromPtr(slice.ptr)));
        }
    }

    return null;
}

const invalid_char: u8 = 0xff;
const hex_table: [255]u8 = brk: {
    var values: [255]u8 = [_]u8{invalid_char} ** 255;
    values['0'] = 0;
    values['1'] = 1;
    values['2'] = 2;
    values['3'] = 3;
    values['4'] = 4;
    values['5'] = 5;
    values['6'] = 6;
    values['7'] = 7;
    values['8'] = 8;
    values['9'] = 9;
    values['A'] = 10;
    values['B'] = 11;
    values['C'] = 12;
    values['D'] = 13;
    values['E'] = 14;
    values['F'] = 15;
    values['a'] = 10;
    values['b'] = 11;
    values['c'] = 12;
    values['d'] = 13;
    values['e'] = 14;
    values['f'] = 15;

    break :brk values;
};

pub fn decodeHexToBytes(destination: []u8, comptime Char: type, source: []const Char) !usize {
    return _decodeHexToBytes(destination, Char, source, false);
}

pub fn decodeHexToBytesTruncate(destination: []u8, comptime Char: type, source: []const Char) usize {
    return _decodeHexToBytes(destination, Char, source, true) catch 0;
}

fn _decodeHexToBytes(destination: []u8, comptime Char: type, source: []const Char, comptime truncate: bool) callconv(bun.callconv_inline) !usize {
    var remain = destination;
    var input = source;

    while (remain.len > 0 and input.len > 1) {
        const int = input[0..2].*;
        if (comptime @sizeOf(Char) > 1) {
            if (int[0] > std.math.maxInt(u8) or int[1] > std.math.maxInt(u8)) {
                if (comptime truncate) break;
                return error.InvalidByteSequence;
            }
        }
        const a = hex_table[@as(u8, @truncate(int[0]))];
        const b = hex_table[@as(u8, @truncate(int[1]))];
        if (a == invalid_char or b == invalid_char) {
            if (comptime truncate) break;
            return error.InvalidByteSequence;
        }
        remain[0] = a << 4 | b;
        remain = remain[1..];
        input = input[2..];
    }

    if (comptime !truncate) {
        if (remain.len > 0 and input.len > 0) return error.InvalidByteSequence;
    }

    return destination.len - remain.len;
}

fn byte2hex(char: u8) u8 {
    return switch (char) {
        0...9 => char + '0',
        10...15 => char - 10 + 'a',
        else => unreachable,
    };
}

pub fn encodeBytesToHex(destination: []u8, source: []const u8) usize {
    if (comptime Environment.allow_assert) {
        bun.unsafeAssert(destination.len > 0);
        bun.unsafeAssert(source.len > 0);
    }
    const to_write = if (destination.len < source.len * 2)
        destination.len - destination.len % 2
    else
        source.len * 2;

    const to_read = to_write / 2;

    var remaining = source[0..to_read];
    var remaining_dest = destination;
    if (comptime Environment.enableSIMD) {
        const remaining_end = remaining.ptr + remaining.len - (remaining.len % 16);
        while (remaining.ptr != remaining_end) {
            const input_chunk: @Vector(16, u8) = remaining[0..16].*;
            const input_chunk_4: @Vector(16, u8) = input_chunk >> @as(@Vector(16, u8), @splat(@as(u8, 4)));
            const input_chunk_15: @Vector(16, u8) = input_chunk & @as(@Vector(16, u8), @splat(@as(u8, 15)));

            // This looks extremely redundant but it was the easiest way to make the compiler do the right thing
            // the more convienient "0123456789abcdef" string produces worse codegen
            // https://zig.godbolt.org/z/bfdracEeq
            const lower_16 = [16]u8{
                byte2hex(input_chunk_4[0]),
                byte2hex(input_chunk_4[1]),
                byte2hex(input_chunk_4[2]),
                byte2hex(input_chunk_4[3]),
                byte2hex(input_chunk_4[4]),
                byte2hex(input_chunk_4[5]),
                byte2hex(input_chunk_4[6]),
                byte2hex(input_chunk_4[7]),
                byte2hex(input_chunk_4[8]),
                byte2hex(input_chunk_4[9]),
                byte2hex(input_chunk_4[10]),
                byte2hex(input_chunk_4[11]),
                byte2hex(input_chunk_4[12]),
                byte2hex(input_chunk_4[13]),
                byte2hex(input_chunk_4[14]),
                byte2hex(input_chunk_4[15]),
            };
            const upper_16 = [16]u8{
                byte2hex(input_chunk_15[0]),
                byte2hex(input_chunk_15[1]),
                byte2hex(input_chunk_15[2]),
                byte2hex(input_chunk_15[3]),
                byte2hex(input_chunk_15[4]),
                byte2hex(input_chunk_15[5]),
                byte2hex(input_chunk_15[6]),
                byte2hex(input_chunk_15[7]),
                byte2hex(input_chunk_15[8]),
                byte2hex(input_chunk_15[9]),
                byte2hex(input_chunk_15[10]),
                byte2hex(input_chunk_15[11]),
                byte2hex(input_chunk_15[12]),
                byte2hex(input_chunk_15[13]),
                byte2hex(input_chunk_15[14]),
                byte2hex(input_chunk_15[15]),
            };

            const output_chunk = std.simd.interlace(.{
                lower_16,
                upper_16,
            });

            remaining_dest[0..32].* = @bitCast(output_chunk);
            remaining_dest = remaining_dest[32..];
            remaining = remaining[16..];
        }
    }

    for (remaining) |c| {
        const charset = "0123456789abcdef";

        const buf: [2]u8 = .{ charset[c >> 4], charset[c & 15] };
        remaining_dest[0..2].* = buf;
        remaining_dest = remaining_dest[2..];
    }

    return to_read * 2;
}

/// Leave a single leading char
/// ```zig
/// trimSubsequentLeadingChars("foo\n\n\n\n", '\n') -> "foo\n"
/// ```
pub fn trimSubsequentLeadingChars(slice: []const u8, char: u8) []const u8 {
    if (slice.len == 0) return slice;
    var end = slice.len - 1;
    var endend = slice.len;
    while (end > 0 and slice[end] == char) : (end -= 1) {
        endend = end + 1;
    }
    return slice[0..endend];
}

pub fn trimLeadingChar(slice: []const u8, char: u8) []const u8 {
    if (indexOfNotChar(slice, char)) |i| {
        return slice[i..];
    }
    return "";
}

/// Trim leading pattern of 2 bytes
///
/// e.g.
/// `trimLeadingPattern2("abcdef", 'a', 'b') == "cdef"`
pub fn trimLeadingPattern2(slice_: []const u8, comptime byte1: u8, comptime byte2: u8) []const u8 {
    // const pattern: u16 = comptime @as(u16, byte2) << 8 | @as(u16, byte1);
    var slice = slice_;
    while (slice.len >= 2) {
        if (slice[0] == byte1 and slice[1] == byte2) {
            slice = slice[2..];
        } else {
            break;
        }
    }
    return slice;
}

/// prefix is of type []const u8 or []const u16
pub fn trimPrefixComptime(comptime T: type, buffer: []const T, comptime prefix: anytype) []const T {
    return if (hasPrefixComptimeType(T, buffer, prefix))
        buffer[prefix.len..]
    else
        buffer;
}

pub fn trimSuffixComptime(buffer: []const u8, comptime suffix: anytype) []const u8 {
    return if (hasSuffixComptime(buffer, suffix))
        buffer[0 .. buffer.len - suffix.len]
    else
        buffer;
}

/// Get the line number and the byte offsets of `line_range_count` above the desired line number
/// The final element is the end index of the desired line
const LineRange = struct {
    start: u32,
    end: u32,
};
pub fn indexOfLineRanges(text: []const u8, target_line: u32, comptime line_range_count: usize) bun.BoundedArray(LineRange, line_range_count) {
    const remaining = text;
    if (remaining.len == 0) return .{};

    var ranges = bun.BoundedArray(LineRange, line_range_count){};

    var current_line: u32 = 0;
    const first_newline_or_nonascii_i = strings.indexOfNewlineOrNonASCIICheckStart(text, 0, true) orelse {
        if (target_line == 0) {
            ranges.appendAssumeCapacity(.{
                .start = 0,
                .end = @truncate(text.len),
            });
        }

        return ranges;
    };

    var iter = CodepointIterator.initOffset(text, 0);
    var cursor = CodepointIterator.Cursor{
        .i = first_newline_or_nonascii_i,
    };
    const first_newline_range: LineRange = brk: {
        while (iter.next(&cursor)) {
            const codepoint = cursor.c;
            switch (codepoint) {
                '\n' => {
                    current_line += 1;
                    break :brk .{
                        .start = 0,
                        .end = cursor.i,
                    };
                },
                '\r' => {
                    if (iter.next(&cursor)) {
                        const codepoint2 = cursor.c;
                        if (codepoint2 == '\n') {
                            current_line += 1;
                            break :brk .{
                                .start = 0,
                                .end = cursor.i,
                            };
                        }
                    }
                },
                else => {},
            }
        }

        ranges.appendAssumeCapacity(.{
            .start = 0,
            .end = @truncate(text.len),
        });
        return ranges;
    };

    ranges.appendAssumeCapacity(first_newline_range);

    if (target_line == 0) {
        return ranges;
    }

    var prev_end = first_newline_range.end;
    while (strings.indexOfNewlineOrNonASCIICheckStart(text, cursor.i + @as(u32, cursor.width), true)) |current_i| {
        cursor.i = current_i;
        cursor.width = 0;
        const current_line_range: LineRange = brk: {
            bun.assert(iter.next(&cursor)); // cursor points to current_i where we know there is some character
            const codepoint = cursor.c;
            switch (codepoint) {
                '\n' => {
                    const start = prev_end;
                    prev_end = cursor.i;
                    break :brk .{
                        .start = start,
                        .end = cursor.i + 1,
                    };
                },
                '\r' => {
                    const current_end = cursor.i;
                    if (iter.next(&cursor) and cursor.c == '\n') {
                        defer prev_end = cursor.i;
                        break :brk .{
                            .start = prev_end,
                            .end = current_end,
                        };
                    } else {
                        break :brk .{
                            .start = prev_end,
                            .end = cursor.i + 1,
                        };
                    }
                },
                else => continue,
            }
        };

        if (ranges.len == line_range_count and current_line <= target_line) {
            var new_ranges = bun.BoundedArray(LineRange, line_range_count){};
            new_ranges.appendSliceAssumeCapacity(ranges.slice()[1..]);
            ranges = new_ranges;
        }
        ranges.appendAssumeCapacity(current_line_range);

        if (current_line >= target_line) {
            return ranges;
        }

        current_line += 1;
    }

    if (ranges.len == line_range_count and current_line <= target_line) {
        var new_ranges = bun.BoundedArray(LineRange, line_range_count){};
        new_ranges.appendSliceAssumeCapacity(ranges.slice()[1..]);
        ranges = new_ranges;
    }

    return ranges;
}

/// Get N lines from the start of the text
pub fn getLinesInText(text: []const u8, line: u32, comptime line_range_count: usize) ?bun.BoundedArray([]const u8, line_range_count) {
    const ranges = indexOfLineRanges(text, line, line_range_count);
    if (ranges.len == 0) return null;
    var results = bun.BoundedArray([]const u8, line_range_count){};
    results.len = ranges.len;

    for (results.slice()[0..ranges.len], ranges.slice()) |*chunk, range| {
        chunk.* = text[range.start..range.end];
    }

    std.mem.reverse([]const u8, results.slice());

    return results;
}

pub fn firstNonASCII16(slice: []const u16) ?u32 {
    var remaining = slice;
    const remaining_start = remaining.ptr;

    if (Environment.enableSIMD and Environment.isNative) {
        const end_ptr = remaining.ptr + remaining.len - (remaining.len % ascii_u16_vector_size);
        if (remaining.len >= ascii_u16_vector_size) {
            while (remaining.ptr != end_ptr) {
                const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;
                const max_value = @reduce(.Max, vec);

                if (max_value > 127) {
                    const cmp = vec > max_u16_ascii;
                    const bitmask: u8 = @as(u8, @bitCast(cmp));
                    const index_of_first_nonascii_in_vector = @ctz(bitmask);

                    const offset_of_vector_in_input = (@intFromPtr(remaining.ptr) - @intFromPtr(remaining_start)) / 2;
                    const out: u32 = @intCast(offset_of_vector_in_input + index_of_first_nonascii_in_vector);

                    if (comptime Environment.isDebug) {
                        for (0..index_of_first_nonascii_in_vector) |i| {
                            if (vec[i] > 127) {
                                bun.Output.panic("firstNonASCII16: found non-ASCII character in ASCII vector before the first non-ASCII character", .{});
                            }
                        }

                        if (slice[out] <= 127) {
                            bun.Output.panic("firstNonASCII16: Expected non-ascii character", .{});
                        }
                    }

                    return out;
                }

                remaining.ptr += ascii_u16_vector_size;
            }
            remaining.len -= (@intFromPtr(remaining.ptr) - @intFromPtr(remaining_start)) / 2;
        }

        bun.unsafeAssert(remaining.len < ascii_u16_vector_size);
    }

    var i: usize = (@intFromPtr(remaining.ptr) - @intFromPtr(remaining_start)) / 2;

    for (remaining) |char| {
        if (char > 127) {
            return @truncate(i);
        }
        i += 1;
    }

    return null;
}

// this is std.mem.trim except it doesn't forcibly change the slice to be const
pub fn trim(slice: anytype, comptime values_to_strip: []const u8) @TypeOf(slice) {
    var begin: usize = 0;
    var end: usize = slice.len;

    while (begin < end and std.mem.indexOfScalar(u8, values_to_strip, slice[begin]) != null) : (begin += 1) {}
    while (end > begin and std.mem.indexOfScalar(u8, values_to_strip, slice[end - 1]) != null) : (end -= 1) {}
    return slice[begin..end];
}

pub fn trimSpaces(slice: anytype) @TypeOf(slice) {
    return trim(slice, &whitespace_chars);
}

pub fn isAllWhitespace(slice: []const u8) bool {
    var begin: usize = 0;
    while (begin < slice.len and std.mem.indexOfScalar(u8, &whitespace_chars, slice[begin]) != null) : (begin += 1) {}
    return begin == slice.len;
}

pub const whitespace_chars = [_]u8{ ' ', '\t', '\n', '\r', std.ascii.control_code.vt, std.ascii.control_code.ff };

pub fn lengthOfLeadingWhitespaceASCII(slice: string) usize {
    brk: for (slice) |*c| {
        inline for (whitespace_chars) |wc| if (c.* == wc) continue :brk;
        return @intFromPtr(c) - @intFromPtr(slice.ptr);
    }

    return slice.len;
}

pub fn join(slices: []const string, delimiter: string, allocator: std.mem.Allocator) !string {
    return try std.mem.join(allocator, delimiter, slices);
}

pub fn order(a: []const u8, b: []const u8) std.math.Order {
    const len = @min(a.len, b.len);

    const cmp = if (comptime Environment.isNative) bun.c.memcmp(a.ptr, b.ptr, len) else return std.mem.order(u8, a, b);
    return switch (std.math.sign(cmp)) {
        0 => std.math.order(a.len, b.len),
        1 => .gt,
        -1 => .lt,
        else => unreachable,
    };
}

pub fn cmpStringsAsc(_: void, a: string, b: string) bool {
    return order(a, b) == .lt;
}

pub fn cmpStringsDesc(_: void, a: string, b: string) bool {
    return order(a, b) == .gt;
}

/// Every time you read a non^2 sized integer, Zig masks off the extra bits.
/// This is a meaningful performance difference, including in release builds.
pub const u3_fast = u8;

pub fn sortAsc(in: []string) void {
    // TODO: experiment with simd to see if it's faster
    std.sort.pdq([]const u8, in, {}, cmpStringsAsc);
}

pub fn sortDesc(in: []string) void {
    // TODO: experiment with simd to see if it's faster
    std.sort.pdq([]const u8, in, {}, cmpStringsDesc);
}

pub const StringArrayByIndexSorter = struct {
    keys: []const []const u8,
    pub fn lessThan(sorter: *const @This(), a: usize, b: usize) bool {
        return strings.order(sorter.keys[a], sorter.keys[b]) == .lt;
    }

    pub fn init(keys: []const []const u8) @This() {
        return .{
            .keys = keys,
        };
    }
};

pub fn isASCIIHexDigit(c: u8) bool {
    return std.ascii.isHex(c);
}

pub fn toASCIIHexValue(character: u8) u8 {
    if (comptime Environment.isDebug) assert(isASCIIHexDigit(character));
    return switch (character) {
        0...('A' - 1) => character - '0',
        else => (character - 'A' + 10) & 0xF,
    };
}

pub fn NewLengthSorter(comptime Type: type, comptime field: string) type {
    return struct {
        const LengthSorter = @This();
        pub fn lessThan(_: LengthSorter, lhs: Type, rhs: Type) bool {
            return @field(lhs, field).len < @field(rhs, field).len;
        }
    };
}

pub fn NewGlobLengthSorter(comptime Type: type, comptime field: string) type {
    return struct {
        const GlobLengthSorter = @This();
        pub fn lessThan(_: GlobLengthSorter, lhs: Type, rhs: Type) bool {
            // Assert: keyA ends with "/" or contains only a single "*".
            // Assert: keyB ends with "/" or contains only a single "*".
            const key_a = @field(lhs, field);
            const key_b = @field(rhs, field);

            // Let baseLengthA be the index of "*" in keyA plus one, if keyA contains "*", or the length of keyA otherwise.
            // Let baseLengthB be the index of "*" in keyB plus one, if keyB contains "*", or the length of keyB otherwise.
            const star_a = indexOfChar(key_a, '*');
            const star_b = indexOfChar(key_b, '*');
            const base_length_a = star_a orelse key_a.len;
            const base_length_b = star_b orelse key_b.len;

            // If baseLengthA is greater than baseLengthB, return -1.
            // If baseLengthB is greater than baseLengthA, return 1.
            if (base_length_a > base_length_b)
                return true;
            if (base_length_b > base_length_a)
                return false;

            // If keyA does not contain "*", return 1.
            // If keyB does not contain "*", return -1.
            if (star_a == null)
                return false;
            if (star_b == null)
                return true;

            // If the length of keyA is greater than the length of keyB, return -1.
            // If the length of keyB is greater than the length of keyA, return 1.
            if (key_a.len > key_b.len)
                return true;
            if (key_b.len > key_a.len)
                return false;

            return false;
        }
    };
}

/// Update all strings in a struct pointing to "from" to point to "to".
pub fn moveAllSlices(comptime Type: type, container: *Type, from: string, to: string) void {
    const fields_we_care_about = comptime brk: {
        var count: usize = 0;
        for (std.meta.fields(Type)) |field| {
            if (std.meta.isSlice(field.type) and std.meta.Child(field.type) == u8) {
                count += 1;
            }
        }

        var fields: [count][]const u8 = undefined;
        count = 0;
        for (std.meta.fields(Type)) |field| {
            if (std.meta.isSlice(field.type) and std.meta.Child(field.type) == u8) {
                fields[count] = field.name;
                count += 1;
            }
        }
        break :brk fields;
    };

    inline for (fields_we_care_about) |name| {
        const slice = @field(container, name);
        if ((@intFromPtr(from.ptr) + from.len) >= @intFromPtr(slice.ptr) + slice.len and
            (@intFromPtr(from.ptr) <= @intFromPtr(slice.ptr)))
        {
            @field(container, name) = moveSlice(slice, from, to);
        }
    }
}

pub fn moveSlice(slice: string, from: string, to: string) string {
    if (comptime Environment.allow_assert) {
        bun.unsafeAssert(from.len <= to.len and from.len >= slice.len);
        // assert we are in bounds
        bun.unsafeAssert(
            (@intFromPtr(from.ptr) + from.len) >=
                @intFromPtr(slice.ptr) + slice.len and
                (@intFromPtr(from.ptr) <= @intFromPtr(slice.ptr)),
        );
        bun.unsafeAssert(eqlLong(from, to[0..from.len], false)); // data should be identical
    }

    const ptr_offset = @intFromPtr(slice.ptr) - @intFromPtr(from.ptr);
    const result = to[ptr_offset..][0..slice.len];

    if (comptime Environment.allow_assert) assert(eqlLong(slice, result, false)); // data should be identical

    return result;
}

pub const ExactSizeMatcher = @import("./immutable/exact_size_matcher.zig").ExactSizeMatcher;

pub const unicode_replacement = 0xFFFD;
pub const unicode_replacement_str = brk: {
    var out: [std.unicode.utf8CodepointSequenceLength(unicode_replacement) catch unreachable]u8 = undefined;
    _ = std.unicode.utf8Encode(unicode_replacement, &out) catch unreachable;
    break :brk out;
};

pub fn isIPAddress(input: []const u8) bool {
    var max_ip_address_buffer: [512]u8 = undefined;
    if (input.len >= max_ip_address_buffer.len) return false;

    var sockaddr: std.posix.sockaddr = undefined;
    @memset(std.mem.asBytes(&sockaddr), 0);
    @memcpy(max_ip_address_buffer[0..input.len], input);
    max_ip_address_buffer[input.len] = 0;

    const ip_addr_str: [:0]const u8 = max_ip_address_buffer[0..input.len :0];

    return bun.c_ares.ares_inet_pton(std.posix.AF.INET, ip_addr_str.ptr, &sockaddr) > 0 or bun.c_ares.ares_inet_pton(std.posix.AF.INET6, ip_addr_str.ptr, &sockaddr) > 0;
}

pub fn isIPV6Address(input: []const u8) bool {
    var max_ip_address_buffer: [512]u8 = undefined;
    if (input.len >= max_ip_address_buffer.len) return false;

    var sockaddr: std.posix.sockaddr = undefined;
    @memset(std.mem.asBytes(&sockaddr), 0);
    @memcpy(max_ip_address_buffer[0..input.len], input);
    max_ip_address_buffer[input.len] = 0;

    const ip_addr_str: [:0]const u8 = max_ip_address_buffer[0..input.len :0];
    return bun.c_ares.ares_inet_pton(std.posix.AF.INET6, ip_addr_str.ptr, &sockaddr) > 0;
}

pub fn leftHasAnyInRight(to_check: []const string, against: []const string) bool {
    for (to_check) |check| {
        for (against) |item| {
            if (eqlLong(check, item, true)) return true;
        }
    }
    return false;
}

/// Returns true if the input has the prefix and the next character is not an identifier character
/// Also returns true if the input ends with the prefix (i.e. EOF)
///
/// Example:
/// ```zig
/// // returns true
/// hasPrefixWithWordBoundary("console.log", "console") // true
/// hasPrefixWithWordBoundary("console.log", "log") // false
/// hasPrefixWithWordBoundary("console.log", "console.log") // true
/// ```
pub fn hasPrefixWithWordBoundary(input: []const u8, comptime prefix: []const u8) bool {
    if (hasPrefixComptime(input, prefix)) {
        if (input.len == prefix.len) return true;

        const next = input[prefix.len..];
        var bytes: [4]u8 = .{
            next[0],
            if (next.len > 1) next[1] else 0,
            if (next.len > 2) next[2] else 0,
            if (next.len > 3) next[3] else 0,
        };

        if (!bun.js_lexer.isIdentifierContinue(decodeWTF8RuneT(&bytes, wtf8ByteSequenceLength(next[0]), i32, -1))) {
            return true;
        }
    }

    return false;
}

pub fn concatWithLength(
    allocator: std.mem.Allocator,
    args: []const string,
    length: usize,
) bun.OOM![]u8 {
    const out = try allocator.alloc(u8, length);
    var remain = out;
    for (args) |arg| {
        @memcpy(remain[0..arg.len], arg);
        remain = remain[arg.len..];
    }
    bun.unsafeAssert(remain.len == 0); // all bytes should be used
    return out;
}

pub fn concat(
    allocator: std.mem.Allocator,
    args: []const string,
) bun.OOM![]u8 {
    var length: usize = 0;
    for (args) |arg| {
        length += arg.len;
    }
    return concatWithLength(allocator, args, length);
}

pub fn concatIfNeeded(
    allocator: std.mem.Allocator,
    dest: *[]const u8,
    args: []const string,
    interned_strings_to_check: []const string,
) !void {
    const total_length: usize = brk: {
        var length: usize = 0;
        for (args) |arg| {
            length += arg.len;
        }
        break :brk length;
    };

    if (total_length == 0) {
        dest.* = "";
        return;
    }

    if (total_length < 1024) {
        var stack = std.heap.stackFallback(1024, allocator);
        const stack_copy = concatWithLength(stack.get(), args, total_length) catch unreachable;
        for (interned_strings_to_check) |interned| {
            if (eqlLong(stack_copy, interned, true)) {
                dest.* = interned;
                return;
            }
        }
    }

    const is_needed = brk: {
        const out = dest.*;
        var remain = out;

        for (args) |arg| {
            if (args.len > remain.len) {
                break :brk true;
            }

            if (eqlLong(remain[0..args.len], arg, true)) {
                remain = remain[args.len..];
            } else {
                break :brk true;
            }
        }

        break :brk false;
    };

    if (!is_needed) return;

    var buf = try allocator.alloc(u8, total_length);
    dest.* = buf;
    var remain = buf[0..];
    for (args) |arg| {
        @memcpy(remain[0..arg.len], arg);

        remain = remain[arg.len..];
    }
    bun.unsafeAssert(remain.len == 0);
}

pub fn mustEscapeYAMLString(contents: []const u8) bool {
    if (contents.len == 0) return true;

    return switch (contents[0]) {
        'A'...'Z', 'a'...'z' => strings.hasPrefixComptime(contents, "Yes") or strings.hasPrefixComptime(contents, "No") or strings.hasPrefixComptime(contents, "true") or
            strings.hasPrefixComptime(contents, "false") or
            std.mem.indexOfAnyPos(u8, contents, 1, ": \t\r\n\x0B\x0C\\\",[]") != null,
        else => true,
    };
}

pub const QuoteEscapeFormatFlags = struct {
    quote_char: u8,
    ascii_only: bool = false,
    json: bool = false,
    str_encoding: Encoding = .utf8,
};
/// usage: print(" string: '{'}' ", .{formatEscapesJS("hello'world!")});
pub fn formatEscapes(str: []const u8, comptime flags: QuoteEscapeFormatFlags) QuoteEscapeFormat(flags) {
    return .{ .data = str };
}
fn QuoteEscapeFormat(comptime flags: QuoteEscapeFormatFlags) type {
    return struct {
        data: []const u8,

        pub fn format(self: @This(), writer: *std.Io.Writer) !void {
            try bun.js_printer.writePreQuotedString(self.data, @TypeOf(writer), writer, flags.quote_char, false, flags.json, flags.str_encoding);
        }
    };
}

/// Generic. Works on []const u8, []const u16, etc
pub fn indexOfScalar(input: anytype, scalar: std.meta.Child(@TypeOf(input))) callconv(bun.callconv_inline) ?usize {
    if (comptime std.meta.Child(@TypeOf(input)) == u8) {
        return strings.indexOfCharUsize(input, scalar);
    } else {
        return std.mem.indexOfScalar(std.meta.Child(@TypeOf(input)), input, scalar);
    }
}

/// Generic. Works on []const u8, []const u16, etc
pub fn containsScalar(input: anytype, item: std.meta.Child(@TypeOf(input))) bool {
    return indexOfScalar(input, item) != null;
}

pub fn withoutSuffixComptime(input: []const u8, comptime suffix: []const u8) []const u8 {
    if (hasSuffixComptime(input, suffix)) {
        return input[0 .. input.len - suffix.len];
    }
    return input;
}

pub fn withoutPrefixComptime(input: []const u8, comptime prefix: []const u8) []const u8 {
    if (hasPrefixComptime(input, prefix)) {
        return input[prefix.len..];
    }
    return input;
}

pub fn withoutPrefixComptimeZ(input: [:0]const u8, comptime prefix: []const u8) [:0]const u8 {
    if (hasPrefixComptime(input, prefix)) {
        return input[prefix.len..];
    }
    return input;
}

pub fn withoutPrefixIfPossibleComptime(input: string, comptime prefix: string) ?string {
    if (hasPrefixComptime(input, prefix)) {
        return input[prefix.len..];
    }
    return null;
}

/// Returns the first byte of the string and the rest of the string excluding the first byte
pub fn splitFirst(self: string) ?struct { first: u8, rest: []const u8 } {
    if (self.len == 0) {
        return null;
    }

    const first = self[0];
    return .{ .first = first, .rest = self[1..] };
}

/// Returns the first byte of the string which matches the expected byte and the rest of the string excluding the first byte
pub fn splitFirstWithExpected(self: string, comptime expected: u8) ?[]const u8 {
    if (self.len > 0 and self[0] == expected) {
        return self[1..];
    }
    return null;
}

pub fn percentEncodeWrite(
    utf8_input: []const u8,
    writer: *std.array_list.Managed(u8),
) error{ OutOfMemory, IncompleteUTF8 }!void {
    var remaining = utf8_input;
    while (indexOfNeedsURLEncode(remaining)) |j| {
        const safe = remaining[0..j];
        remaining = remaining[j..];
        const code_point_len: usize = wtf8ByteSequenceLengthWithInvalid(remaining[0]);
        if (remaining.len < code_point_len) {
            @branchHint(.unlikely);
            return error.IncompleteUTF8;
        }

        const to_encode = remaining[0..code_point_len];
        remaining = remaining[code_point_len..];

        try writer.ensureUnusedCapacity(safe.len + ("%FF".len) * code_point_len);

        // Write the safe bytes
        writer.appendSliceAssumeCapacity(safe);

        // URL encode the code point
        for (to_encode) |byte| {
            writer.appendSliceAssumeCapacity(&.{
                '%',
                byte2hex((byte >> 4) & 0xF),
                byte2hex(byte & 0xF),
            });
        }
    }

    // Write the rest of the string
    try writer.appendSlice(remaining);
}

pub const CodepointIterator = unicode.CodepointIterator;
pub const NewCodePointIterator = unicode.NewCodePointIterator;
pub const UnsignedCodepointIterator = unicode.UnsignedCodepointIterator;
pub const EncodeIntoResult = unicode.EncodeIntoResult;
pub const BOM = unicode.BOM;
pub const allocateLatin1IntoUTF8 = unicode.allocateLatin1IntoUTF8;
pub const allocateLatin1IntoUTF8WithList = unicode.allocateLatin1IntoUTF8WithList;
pub const appendUTF8MachineWordToUTF16MachineWord = unicode.appendUTF8MachineWordToUTF16MachineWord;
pub const codepointSize = unicode.codepointSize;
pub const containsNonBmpCodePoint = unicode.containsNonBmpCodePoint;
pub const containsNonBmpCodePointOrIsInvalidIdentifier = unicode.containsNonBmpCodePointOrIsInvalidIdentifier;
pub const convertUTF16ToUTF8 = unicode.convertUTF16ToUTF8;
pub const convertUTF16ToUTF8Append = unicode.convertUTF16ToUTF8Append;
pub const convertUTF16ToUTF8WithoutInvalidSurrogatePairs = unicode.convertUTF16ToUTF8WithoutInvalidSurrogatePairs;
pub const convertUTF16toUTF8InBuffer = unicode.convertUTF16toUTF8InBuffer;
pub const convertUTF8BytesIntoUTF16 = unicode.convertUTF8BytesIntoUTF16;
pub const convertUTF8BytesIntoUTF16WithLength = unicode.convertUTF8BytesIntoUTF16WithLength;
pub const convertUTF8toUTF16InBuffer = unicode.convertUTF8toUTF16InBuffer;
pub const convertUTF8toUTF16InBufferZ = unicode.convertUTF8toUTF16InBufferZ;
pub const copyLatin1IntoASCII = unicode.copyLatin1IntoASCII;
pub const copyLatin1IntoUTF16 = unicode.copyLatin1IntoUTF16;
pub const copyCP1252IntoUTF16 = unicode.copyCP1252IntoUTF16;
pub const copyLatin1IntoUTF8 = unicode.copyLatin1IntoUTF8;
pub const copyLatin1IntoUTF8StopOnNonASCII = unicode.copyLatin1IntoUTF8StopOnNonASCII;
pub const copyU16IntoU8 = unicode.copyU16IntoU8;
pub const copyU8IntoU16 = unicode.copyU8IntoU16;
pub const copyUTF16IntoUTF8 = unicode.copyUTF16IntoUTF8;
pub const copyUTF16IntoUTF8Impl = unicode.copyUTF16IntoUTF8Impl;
pub const copyUTF16IntoUTF8WithBufferImpl = unicode.copyUTF16IntoUTF8WithBufferImpl;
pub const decodeCheck = unicode.decodeCheck;
pub const decodeWTF8RuneT = unicode.decodeWTF8RuneT;
pub const decodeWTF8RuneTMultibyte = unicode.decodeWTF8RuneTMultibyte;
pub const elementLengthCP1252IntoUTF16 = unicode.elementLengthCP1252IntoUTF16;
pub const elementLengthLatin1IntoUTF8 = unicode.elementLengthLatin1IntoUTF8;
pub const elementLengthUTF16IntoUTF8 = unicode.elementLengthUTF16IntoUTF8;
pub const elementLengthUTF8IntoUTF16 = unicode.elementLengthUTF8IntoUTF16;
pub const encodeUTF8Comptime = unicode.encodeUTF8Comptime;
pub const encodeWTF8Rune = unicode.encodeWTF8Rune;
pub const encodeWTF8RuneT = unicode.encodeWTF8RuneT;
pub const eqlUtf16 = unicode.eqlUtf16;
pub const isAllASCII = unicode.isAllASCII;
pub const isValidUTF8 = unicode.isValidUTF8;
pub const isValidUTF8WithoutSIMD = unicode.isValidUTF8WithoutSIMD;
pub const cp1252ToCodepointAssumeNotASCII = unicode.cp1252ToCodepointAssumeNotASCII;
pub const cp1252ToCodepointBytesAssumeNotASCII16 = unicode.cp1252ToCodepointBytesAssumeNotASCII16;
pub const literal = unicode.literal;
pub const nonASCIISequenceLength = unicode.nonASCIISequenceLength;
pub const replaceLatin1WithUTF8 = unicode.replaceLatin1WithUTF8;
pub const toUTF16Alloc = unicode.toUTF16Alloc;
pub const toUTF16AllocForReal = unicode.toUTF16AllocForReal;
pub const toUTF16AllocMaybeBuffered = unicode.toUTF16AllocMaybeBuffered;
pub const toUTF16Literal = unicode.toUTF16Literal;
pub const toUTF8Alloc = unicode.toUTF8Alloc;
pub const toUTF8AllocWithType = unicode.toUTF8AllocWithType;
pub const toUTF8AllocWithTypeWithoutInvalidSurrogatePairs = unicode.toUTF8AllocWithTypeWithoutInvalidSurrogatePairs;
pub const toUTF8AllocZ = unicode.toUTF8AllocZ;
pub const toUTF8AppendToList = unicode.toUTF8AppendToList;
pub const toUTF8FromLatin1 = unicode.toUTF8FromLatin1;
pub const toUTF8FromLatin1Z = unicode.toUTF8FromLatin1Z;
pub const toUTF8ListWithType = unicode.toUTF8ListWithType;
pub const toUTF8ListWithTypeBun = unicode.toUTF8ListWithTypeBun;
pub const u16GetSupplementary = unicode.u16GetSupplementary;
pub const u16IsLead = unicode.u16IsLead;
pub const u16IsTrail = unicode.u16IsTrail;
pub const u16Lead = unicode.u16Lead;
pub const u16Trail = unicode.u16Trail;
pub const utf16Codepoint = unicode.utf16Codepoint;
pub const utf16CodepointWithFFFD = unicode.utf16CodepointWithFFFD;
pub const utf16EqlString = unicode.utf16EqlString;
pub const utf8ByteSequenceLength = unicode.utf8ByteSequenceLength;
pub const utf8ByteSequenceLengthUnsafe = unicode.utf8ByteSequenceLengthUnsafe;
pub const w = unicode.w;
pub const withoutUTF8BOM = unicode.withoutUTF8BOM;
pub const wtf8ByteSequenceLength = unicode.wtf8ByteSequenceLength;
pub const wtf8ByteSequenceLengthWithInvalid = unicode.wtf8ByteSequenceLengthWithInvalid;
pub const wtf8Sequence = unicode.wtf8Sequence;

pub const isAmgiguousCodepointType = visible_.isAmgiguousCodepointType;
pub const isFullWidthCodepointType = visible_.isFullWidthCodepointType;
pub const isZeroWidthCodepointType = visible_.isZeroWidthCodepointType;
pub const visible = visible_.visible;
pub const visibleCodepointWidth = visible_.visibleCodepointWidth;
pub const visibleCodepointWidthMaybeEmoji = visible_.visibleCodepointWidthMaybeEmoji;
pub const visibleCodepointWidthType = visible_.visibleCodepointWidthType;

pub const escapeHTMLForLatin1Input = escapeHTML_.escapeHTMLForLatin1Input;
pub const escapeHTMLForUTF16Input = escapeHTML_.escapeHTMLForUTF16Input;

pub const escapeRegExp = escapeRegExp_.escapeRegExp;
pub const escapeRegExpForPackageNameMatching = escapeRegExp_.escapeRegExpForPackageNameMatching;

pub const addNTPathPrefix = paths_.addNTPathPrefix;
pub const addNTPathPrefixIfNeeded = paths_.addNTPathPrefixIfNeeded;
pub const addLongPathPrefix = paths_.addLongPathPrefix;
pub const charIsAnySlash = paths_.charIsAnySlash;
pub const cloneNormalizingSeparators = paths_.cloneNormalizingSeparators;
pub const fromWPath = paths_.fromWPath;
pub const isWindowsAbsolutePathMissingDriveLetter = paths_.isWindowsAbsolutePathMissingDriveLetter;
pub const normalizeSlashesOnly = paths_.normalizeSlashesOnly;
pub const normalizeSlashesOnlyT = paths_.normalizeSlashesOnlyT;
pub const pathContainsNodeModulesFolder = paths_.pathContainsNodeModulesFolder;
pub const removeLeadingDotSlash = paths_.removeLeadingDotSlash;
pub const startsWithWindowsDriveLetter = paths_.startsWithWindowsDriveLetter;
pub const startsWithWindowsDriveLetterT = paths_.startsWithWindowsDriveLetterT;
pub const toExtendedPathNormalized = paths_.toExtendedPathNormalized;
pub const toKernel32Path = paths_.toKernel32Path;
pub const toNTPath = paths_.toNTPath;
pub const toNTPath16 = paths_.toNTPath16;
pub const toPath = paths_.toPath;
pub const toPathMaybeDir = paths_.toPathMaybeDir;
pub const toPathNormalized = paths_.toPathNormalized;
pub const toWDirPath = paths_.toWDirPath;
pub const toWPath = paths_.toWPath;
pub const toWPathMaybeDir = paths_.toWPathMaybeDir;
pub const toWPathNormalizeAutoExtend = paths_.toWPathNormalizeAutoExtend;
pub const toWPathNormalized = paths_.toWPathNormalized;
pub const toWPathNormalized16 = paths_.toWPathNormalized16;
pub const withoutLeadingPathSeparator = paths_.withoutLeadingPathSeparator;
pub const withoutLeadingSlash = paths_.withoutLeadingSlash;
pub const withoutNTPrefix = paths_.withoutNTPrefix;
pub const withoutTrailingSlash = paths_.withoutTrailingSlash;
pub const withoutTrailingSlashWindowsPath = paths_.withoutTrailingSlashWindowsPath;
pub const basename = paths_.basename;

pub const log = bun.Output.scoped(.STR, .hidden);
pub const grapheme = @import("./immutable/grapheme.zig");
pub const CodePoint = i32;

const string = []const u8;

const escapeHTML_ = @import("./immutable/escapeHTML.zig");
const escapeRegExp_ = @import("./escapeRegExp.zig");
const paths_ = @import("./immutable/paths.zig");
const std = @import("std");
const unicode = @import("./immutable/unicode.zig");
const visible_ = @import("./immutable/visible.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const OOM = bun.OOM;
const assert = bun.assert;
const js_lexer = bun.js_lexer;
