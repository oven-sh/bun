pub const DataCell = extern struct {
    tag: Tag,

    value: Value,
    free_value: u8 = 0,
    isIndexedColumn: u8 = 0,
    index: u32 = 0,

    pub const Tag = enum(u8) {
        null = 0,
        string = 1,
        float8 = 2,
        int4 = 3,
        int8 = 4,
        bool = 5,
        date = 6,
        date_with_time_zone = 7,
        bytea = 8,
        json = 9,
        array = 10,
        typed_array = 11,
        raw = 12,
        uint4 = 13,
    };

    pub const Value = extern union {
        null: u8,
        string: ?bun.WTF.StringImpl,
        float8: f64,
        int4: i32,
        int8: i64,
        bool: u8,
        date: f64,
        date_with_time_zone: f64,
        bytea: [2]usize,
        json: ?bun.WTF.StringImpl,
        array: Array,
        typed_array: TypedArray,
        raw: Raw,
        uint4: u32,
    };

    pub const Array = extern struct {
        ptr: ?[*]DataCell = null,
        len: u32,
        cap: u32,
        pub fn slice(this: *Array) []DataCell {
            const ptr = this.ptr orelse return &.{};
            return ptr[0..this.len];
        }

        pub fn allocatedSlice(this: *Array) []DataCell {
            const ptr = this.ptr orelse return &.{};
            return ptr[0..this.cap];
        }

        pub fn deinit(this: *Array) void {
            const allocated = this.allocatedSlice();
            this.ptr = null;
            this.len = 0;
            this.cap = 0;
            bun.default_allocator.free(allocated);
        }
    };
    pub const Raw = extern struct {
        ptr: ?[*]const u8 = null,
        len: u64,
    };
    pub const TypedArray = extern struct {
        head_ptr: ?[*]u8 = null,
        ptr: ?[*]u8 = null,
        len: u32,
        byte_len: u32,
        type: JSValue.JSType,

        pub fn slice(this: *TypedArray) []u8 {
            const ptr = this.ptr orelse return &.{};
            return ptr[0..this.len];
        }

        pub fn byteSlice(this: *TypedArray) []u8 {
            const ptr = this.head_ptr orelse return &.{};
            return ptr[0..this.len];
        }
    };

    pub fn deinit(this: *DataCell) void {
        if (this.free_value == 0) return;

        switch (this.tag) {
            .string => {
                if (this.value.string) |str| {
                    str.deref();
                }
            },
            .json => {
                if (this.value.json) |str| {
                    str.deref();
                }
            },
            .bytea => {
                if (this.value.bytea[1] == 0) return;
                const slice = @as([*]u8, @ptrFromInt(this.value.bytea[0]))[0..this.value.bytea[1]];
                bun.default_allocator.free(slice);
            },
            .array => {
                for (this.value.array.slice()) |*cell| {
                    cell.deinit();
                }
                this.value.array.deinit();
            },
            .typed_array => {
                bun.default_allocator.free(this.value.typed_array.byteSlice());
            },

            else => {},
        }
    }
    pub fn raw(optional_bytes: ?*Data) DataCell {
        if (optional_bytes) |bytes| {
            const bytes_slice = bytes.slice();
            return DataCell{
                .tag = .raw,
                .value = .{ .raw = .{ .ptr = @ptrCast(bytes_slice.ptr), .len = bytes_slice.len } },
            };
        }
        // TODO: check empty and null fields
        return DataCell{
            .tag = .null,
            .value = .{ .null = 0 },
        };
    }

    fn parseBytea(hex: []const u8) !DataCell {
        const len = hex.len / 2;
        const buf = try bun.default_allocator.alloc(u8, len);
        errdefer bun.default_allocator.free(buf);

        return DataCell{
            .tag = .bytea,
            .value = .{
                .bytea = .{
                    @intFromPtr(buf.ptr),
                    try bun.strings.decodeHexToBytes(buf, u8, hex),
                },
            },
            .free_value = 1,
        };
    }

    fn unescapePostgresString(input: []const u8, buffer: []u8) ![]u8 {
        var out_index: usize = 0;
        var i: usize = 0;

        while (i < input.len) : (i += 1) {
            if (out_index >= buffer.len) return error.BufferTooSmall;

            if (input[i] == '\\' and i + 1 < input.len) {
                i += 1;
                switch (input[i]) {
                    // Common escapes
                    'b' => buffer[out_index] = '\x08', // Backspace
                    'f' => buffer[out_index] = '\x0C', // Form feed
                    'n' => buffer[out_index] = '\n', // Line feed
                    'r' => buffer[out_index] = '\r', // Carriage return
                    't' => buffer[out_index] = '\t', // Tab
                    '"' => buffer[out_index] = '"', // Double quote
                    '\\' => buffer[out_index] = '\\', // Backslash
                    '\'' => buffer[out_index] = '\'', // Single quote

                    // JSON allows forward slash escaping
                    '/' => buffer[out_index] = '/',

                    // PostgreSQL hex escapes (used for unicode too)
                    'x' => {
                        if (i + 2 >= input.len) return error.InvalidEscapeSequence;
                        const hex_value = try std.fmt.parseInt(u8, input[i + 1 .. i + 3], 16);
                        buffer[out_index] = hex_value;
                        i += 2;
                    },

                    else => return error.UnknownEscapeSequence,
                }
            } else {
                buffer[out_index] = input[i];
            }
            out_index += 1;
        }

        return buffer[0..out_index];
    }
    fn trySlice(slice: []const u8, count: usize) []const u8 {
        if (slice.len <= count) return "";
        return slice[count..];
    }
    fn parseArray(bytes: []const u8, bigint: bool, comptime arrayType: types.Tag, globalObject: *JSC.JSGlobalObject, offset: ?*usize, comptime is_json_sub_array: bool) !DataCell {
        const closing_brace = if (is_json_sub_array) ']' else '}';
        const opening_brace = if (is_json_sub_array) '[' else '{';
        if (bytes.len < 2 or bytes[0] != opening_brace) {
            return error.UnsupportedArrayFormat;
        }
        // empty array
        if (bytes.len == 2 and bytes[1] == closing_brace) {
            if (offset) |offset_ptr| {
                offset_ptr.* = 2;
            }
            return DataCell{ .tag = .array, .value = .{ .array = .{ .ptr = null, .len = 0, .cap = 0 } } };
        }

        var array = std.ArrayListUnmanaged(DataCell){};
        var stack_buffer: [16 * 1024]u8 = undefined;

        errdefer {
            if (array.capacity > 0) array.deinit(bun.default_allocator);
        }
        var slice = bytes[1..];
        var reached_end = false;
        const separator = switch (arrayType) {
            .box_array => ';',
            else => ',',
        };
        while (slice.len > 0) {
            switch (slice[0]) {
                closing_brace => {
                    if (reached_end) {
                        // cannot reach end twice
                        return error.UnsupportedArrayFormat;
                    }
                    // end of array
                    reached_end = true;
                    slice = trySlice(slice, 1);
                    break;
                },
                opening_brace => {
                    var sub_array_offset: usize = 0;
                    const sub_array = try parseArray(slice, bigint, arrayType, globalObject, &sub_array_offset, is_json_sub_array);
                    try array.append(bun.default_allocator, sub_array);
                    slice = trySlice(slice, sub_array_offset);
                    continue;
                },
                '"' => {
                    // parse string
                    var current_idx: usize = 0;
                    const source = slice[1..];
                    // simple escape check to avoid something like "\\\\" and "\""
                    var is_escaped = false;
                    for (source, 0..source.len) |byte, index| {
                        if (byte == '"' and !is_escaped) {
                            current_idx = index + 1;
                            break;
                        }
                        is_escaped = !is_escaped and byte == '\\';
                    }
                    // did not find a closing quote
                    if (current_idx == 0) return error.UnsupportedArrayFormat;
                    switch (arrayType) {
                        .bytea_array => {
                            // this is a bytea array so we need to parse the bytea strings
                            const bytea_bytes = slice[1..current_idx];
                            if (bun.strings.startsWith(bytea_bytes, "\\\\x")) {
                                // its a bytea string lets parse it as a bytea
                                try array.append(bun.default_allocator, try parseBytea(bytea_bytes[3..][0 .. bytea_bytes.len - 3]));
                                slice = trySlice(slice, current_idx + 1);
                                continue;
                            }
                            // invalid bytea array
                            return error.UnsupportedByteaFormat;
                        },
                        .timestamptz_array,
                        .timestamp_array,
                        .date_array,
                        => {
                            const date_str = slice[1..current_idx];
                            var str = bun.String.init(date_str);
                            defer str.deref();
                            try array.append(bun.default_allocator, DataCell{ .tag = .date, .value = .{ .date = str.parseDate(globalObject) } });

                            slice = trySlice(slice, current_idx + 1);
                            continue;
                        },
                        .json_array,
                        .jsonb_array,
                        => {
                            const str_bytes = slice[1..current_idx];
                            const needs_dynamic_buffer = str_bytes.len < stack_buffer.len;
                            const buffer = if (needs_dynamic_buffer) try bun.default_allocator.alloc(u8, str_bytes.len) else stack_buffer[0..];
                            defer if (needs_dynamic_buffer) bun.default_allocator.free(buffer);
                            const unescaped = unescapePostgresString(str_bytes, buffer) catch return error.InvalidByteSequence;
                            try array.append(bun.default_allocator, DataCell{ .tag = .json, .value = .{ .json = if (unescaped.len > 0) String.createUTF8(unescaped).value.WTFStringImpl else null }, .free_value = 1 });
                            slice = trySlice(slice, current_idx + 1);
                            continue;
                        },
                        else => {},
                    }
                    const str_bytes = slice[1..current_idx];
                    if (str_bytes.len == 0) {
                        // empty string
                        try array.append(bun.default_allocator, DataCell{ .tag = .string, .value = .{ .string = null }, .free_value = 1 });
                        slice = trySlice(slice, current_idx + 1);
                        continue;
                    }
                    const needs_dynamic_buffer = str_bytes.len < stack_buffer.len;
                    const buffer = if (needs_dynamic_buffer) try bun.default_allocator.alloc(u8, str_bytes.len) else stack_buffer[0..];
                    defer if (needs_dynamic_buffer) bun.default_allocator.free(buffer);
                    const string_bytes = unescapePostgresString(str_bytes, buffer) catch return error.InvalidByteSequence;
                    try array.append(bun.default_allocator, DataCell{ .tag = .string, .value = .{ .string = if (string_bytes.len > 0) String.createUTF8(string_bytes).value.WTFStringImpl else null }, .free_value = 1 });

                    slice = trySlice(slice, current_idx + 1);
                    continue;
                },
                separator => {
                    // next element or positive number, just advance
                    slice = trySlice(slice, 1);
                    continue;
                },
                else => {
                    switch (arrayType) {
                        // timez, date, time, interval are handled like single string cases
                        .timetz_array,
                        .date_array,
                        .time_array,
                        .interval_array,
                        // text array types
                        .bpchar_array,
                        .varchar_array,
                        .char_array,
                        .text_array,
                        .name_array,
                        .numeric_array,
                        .money_array,
                        .varbit_array,
                        .int2vector_array,
                        .bit_array,
                        .path_array,
                        .xml_array,
                        .point_array,
                        .lseg_array,
                        .box_array,
                        .polygon_array,
                        .line_array,
                        .cidr_array,
                        .circle_array,
                        .macaddr8_array,
                        .macaddr_array,
                        .inet_array,
                        .aclitem_array,
                        .pg_database_array,
                        .pg_database_array2,
                        => {
                            // this is also a string until we reach "," or "}" but a single word string like Bun
                            var current_idx: usize = 0;

                            for (slice, 0..slice.len) |byte, index| {
                                switch (byte) {
                                    '}', separator => {
                                        current_idx = index;
                                        break;
                                    },
                                    else => {},
                                }
                            }
                            if (current_idx == 0) return error.UnsupportedArrayFormat;
                            const element = slice[0..current_idx];
                            // lets handle NULL case here, if is a string "NULL" it will have quotes, if its a NULL it will be just NULL
                            if (bun.strings.eqlComptime(element, "NULL")) {
                                try array.append(bun.default_allocator, DataCell{ .tag = .null, .value = .{ .null = 0 } });
                                slice = trySlice(slice, current_idx);
                                continue;
                            }
                            if (arrayType == .date_array) {
                                var str = bun.String.init(element);
                                defer str.deref();
                                try array.append(bun.default_allocator, DataCell{ .tag = .date, .value = .{ .date = str.parseDate(globalObject) } });
                            } else {
                                // the only escape sequency possible here is \b
                                if (bun.strings.eqlComptime(element, "\\b")) {
                                    try array.append(bun.default_allocator, DataCell{ .tag = .string, .value = .{ .string = bun.String.createUTF8("\x08").value.WTFStringImpl }, .free_value = 1 });
                                } else {
                                    try array.append(bun.default_allocator, DataCell{ .tag = .string, .value = .{ .string = if (element.len > 0) bun.String.createUTF8(element).value.WTFStringImpl else null }, .free_value = 0 });
                                }
                            }
                            slice = trySlice(slice, current_idx);
                            continue;
                        },
                        else => {
                            // non text array, NaN, Null, False, True etc are special cases here
                            switch (slice[0]) {
                                'N' => {
                                    // null or nan
                                    if (slice.len < 3) return error.UnsupportedArrayFormat;
                                    if (slice.len >= 4) {
                                        if (bun.strings.eqlComptime(slice[0..4], "NULL")) {
                                            try array.append(bun.default_allocator, DataCell{ .tag = .null, .value = .{ .null = 0 } });
                                            slice = trySlice(slice, 4);
                                            continue;
                                        }
                                    }
                                    if (bun.strings.eqlComptime(slice[0..3], "NaN")) {
                                        try array.append(bun.default_allocator, DataCell{ .tag = .float8, .value = .{ .float8 = std.math.nan(f64) } });
                                        slice = trySlice(slice, 3);
                                        continue;
                                    }
                                    return error.UnsupportedArrayFormat;
                                },
                                'f' => {
                                    // false
                                    if (arrayType == .json_array or arrayType == .jsonb_array) {
                                        if (slice.len < 5) return error.UnsupportedArrayFormat;
                                        if (bun.strings.eqlComptime(slice[0..5], "false")) {
                                            try array.append(bun.default_allocator, DataCell{ .tag = .bool, .value = .{ .bool = 0 } });
                                            slice = trySlice(slice, 5);
                                            continue;
                                        }
                                    } else {
                                        try array.append(bun.default_allocator, DataCell{ .tag = .bool, .value = .{ .bool = 0 } });
                                        slice = trySlice(slice, 1);
                                        continue;
                                    }
                                },
                                't' => {
                                    // true
                                    if (arrayType == .json_array or arrayType == .jsonb_array) {
                                        if (slice.len < 4) return error.UnsupportedArrayFormat;
                                        if (bun.strings.eqlComptime(slice[0..4], "true")) {
                                            try array.append(bun.default_allocator, DataCell{ .tag = .bool, .value = .{ .bool = 1 } });
                                            slice = trySlice(slice, 4);
                                            continue;
                                        }
                                    } else {
                                        try array.append(bun.default_allocator, DataCell{ .tag = .bool, .value = .{ .bool = 1 } });
                                        slice = trySlice(slice, 1);
                                        continue;
                                    }
                                },
                                'I',
                                'i',
                                => {
                                    // infinity
                                    if (slice.len < 8) return error.UnsupportedArrayFormat;

                                    if (bun.strings.eqlCaseInsensitiveASCII(slice[0..8], "Infinity", false)) {
                                        if (arrayType == .date_array or arrayType == .timestamp_array or arrayType == .timestamptz_array) {
                                            try array.append(bun.default_allocator, DataCell{ .tag = .date, .value = .{ .date = std.math.inf(f64) } });
                                        } else {
                                            try array.append(bun.default_allocator, DataCell{ .tag = .float8, .value = .{ .float8 = std.math.inf(f64) } });
                                        }
                                        slice = trySlice(slice, 8);
                                        continue;
                                    }

                                    return error.UnsupportedArrayFormat;
                                },
                                '+' => {
                                    slice = trySlice(slice, 1);
                                    continue;
                                },
                                '-', '0'...'9' => {
                                    // parse number, detect float, int, if starts with - it can be -Infinity or -Infinity
                                    var is_negative = false;
                                    var is_float = false;
                                    var current_idx: usize = 0;
                                    var is_infinity = false;
                                    // track exponent stuff (1.1e-12, 1.1e+12)
                                    var has_exponent = false;
                                    var has_negative_sign = false;
                                    var has_positive_sign = false;
                                    for (slice, 0..slice.len) |byte, index| {
                                        switch (byte) {
                                            '0'...'9' => {},
                                            closing_brace, separator => {
                                                current_idx = index;
                                                // end of element
                                                break;
                                            },
                                            'e' => {
                                                if (!is_float) return error.UnsupportedArrayFormat;
                                                if (has_exponent) return error.UnsupportedArrayFormat;
                                                has_exponent = true;
                                                continue;
                                            },
                                            '+' => {
                                                if (!has_exponent) return error.UnsupportedArrayFormat;
                                                if (has_positive_sign) return error.UnsupportedArrayFormat;
                                                has_positive_sign = true;
                                                continue;
                                            },
                                            '-' => {
                                                if (index == 0) {
                                                    is_negative = true;
                                                    continue;
                                                }
                                                if (!has_exponent) return error.UnsupportedArrayFormat;
                                                if (has_negative_sign) return error.UnsupportedArrayFormat;
                                                has_negative_sign = true;
                                                continue;
                                            },
                                            '.' => {
                                                // we can only have one dot and the dot must be before the exponent
                                                if (is_float) return error.UnsupportedArrayFormat;
                                                is_float = true;
                                            },
                                            'I', 'i' => {
                                                // infinity
                                                is_infinity = true;
                                                const element = if (is_negative) slice[1..] else slice;
                                                if (element.len < 8) return error.UnsupportedArrayFormat;
                                                if (bun.strings.eqlCaseInsensitiveASCII(element[0..8], "Infinity", false)) {
                                                    if (arrayType == .date_array or arrayType == .timestamp_array or arrayType == .timestamptz_array) {
                                                        try array.append(bun.default_allocator, DataCell{ .tag = .date, .value = .{ .date = if (is_negative) -std.math.inf(f64) else std.math.inf(f64) } });
                                                    } else {
                                                        try array.append(bun.default_allocator, DataCell{ .tag = .float8, .value = .{ .float8 = if (is_negative) -std.math.inf(f64) else std.math.inf(f64) } });
                                                    }
                                                    slice = trySlice(slice, 8 + @as(usize, @intFromBool(is_negative)));
                                                    break;
                                                }

                                                return error.UnsupportedArrayFormat;
                                            },
                                            else => {
                                                return error.UnsupportedArrayFormat;
                                            },
                                        }
                                    }
                                    if (is_infinity) {
                                        continue;
                                    }
                                    if (current_idx == 0) return error.UnsupportedArrayFormat;
                                    const element = slice[0..current_idx];
                                    if (is_float or arrayType == .float8_array) {
                                        try array.append(bun.default_allocator, DataCell{ .tag = .float8, .value = .{ .float8 = bun.parseDouble(element) catch std.math.nan(f64) } });
                                        slice = trySlice(slice, current_idx);
                                        continue;
                                    }
                                    switch (arrayType) {
                                        .int8_array => {
                                            if (bigint) {
                                                try array.append(bun.default_allocator, DataCell{ .tag = .int8, .value = .{ .int8 = std.fmt.parseInt(i64, element, 0) catch return error.UnsupportedArrayFormat } });
                                            } else {
                                                try array.append(bun.default_allocator, DataCell{ .tag = .string, .value = .{ .string = if (element.len > 0) bun.String.createUTF8(element).value.WTFStringImpl else null }, .free_value = 1 });
                                            }
                                            slice = trySlice(slice, current_idx);
                                            continue;
                                        },
                                        .cid_array, .xid_array, .oid_array => {
                                            try array.append(bun.default_allocator, DataCell{ .tag = .uint4, .value = .{ .uint4 = std.fmt.parseInt(u32, element, 0) catch 0 } });
                                            slice = trySlice(slice, current_idx);
                                            continue;
                                        },
                                        else => {
                                            const value = std.fmt.parseInt(i32, element, 0) catch return error.UnsupportedArrayFormat;

                                            try array.append(bun.default_allocator, DataCell{ .tag = .int4, .value = .{ .int4 = @intCast(value) } });
                                            slice = trySlice(slice, current_idx);
                                            continue;
                                        },
                                    }
                                },
                                else => {
                                    if (arrayType == .json_array or arrayType == .jsonb_array) {
                                        if (slice[0] == '[') {
                                            var sub_array_offset: usize = 0;
                                            const sub_array = try parseArray(slice, bigint, arrayType, globalObject, &sub_array_offset, true);
                                            try array.append(bun.default_allocator, sub_array);
                                            slice = trySlice(slice, sub_array_offset);
                                            continue;
                                        }
                                    }
                                    return error.UnsupportedArrayFormat;
                                },
                            }
                        },
                    }
                },
            }
        }

        if (offset) |offset_ptr| {
            offset_ptr.* = bytes.len - slice.len;
        }

        // postgres dont really support arrays with more than 2^31 elements, 2ˆ32 is the max we support, but users should never reach this branch
        if (!reached_end or array.items.len > std.math.maxInt(u32)) {
            @branchHint(.unlikely);

            return error.UnsupportedArrayFormat;
        }
        return DataCell{ .tag = .array, .value = .{ .array = .{ .ptr = array.items.ptr, .len = @truncate(array.items.len), .cap = @truncate(array.capacity) } } };
    }

    pub fn fromBytes(binary: bool, bigint: bool, oid: types.Tag, bytes: []const u8, globalObject: *JSC.JSGlobalObject) !DataCell {
        switch (oid) {
            // TODO: .int2_array, .float8_array
            inline .int4_array, .float4_array => |tag| {
                if (binary) {
                    if (bytes.len < 16) {
                        return error.InvalidBinaryData;
                    }
                    // https://github.com/postgres/postgres/blob/master/src/backend/utils/adt/arrayfuncs.c#L1549-L1645
                    const dimensions_raw: int4 = @bitCast(bytes[0..4].*);
                    const contains_nulls: int4 = @bitCast(bytes[4..8].*);

                    const dimensions = @byteSwap(dimensions_raw);
                    if (dimensions > 1) {
                        return error.MultidimensionalArrayNotSupportedYet;
                    }

                    if (contains_nulls != 0) {
                        return error.NullsInArrayNotSupportedYet;
                    }

                    if (dimensions == 0) {
                        return DataCell{
                            .tag = .typed_array,
                            .value = .{
                                .typed_array = .{
                                    .ptr = null,
                                    .len = 0,
                                    .byte_len = 0,
                                    .type = try tag.toJSTypedArrayType(),
                                },
                            },
                        };
                    }

                    const elements = (try tag.pgArrayType()).init(bytes).slice();

                    return DataCell{
                        .tag = .typed_array,
                        .value = .{
                            .typed_array = .{
                                .head_ptr = if (bytes.len > 0) @constCast(bytes.ptr) else null,
                                .ptr = if (elements.len > 0) @ptrCast(elements.ptr) else null,
                                .len = @truncate(elements.len),
                                .byte_len = @truncate(bytes.len),
                                .type = try tag.toJSTypedArrayType(),
                            },
                        },
                    };
                } else {
                    return try parseArray(bytes, bigint, tag, globalObject, null, false);
                }
            },
            .int2 => {
                if (binary) {
                    return DataCell{ .tag = .int4, .value = .{ .int4 = try parseBinary(.int2, i16, bytes) } };
                } else {
                    return DataCell{ .tag = .int4, .value = .{ .int4 = std.fmt.parseInt(i32, bytes, 0) catch 0 } };
                }
            },
            .cid, .xid, .oid => {
                if (binary) {
                    return DataCell{ .tag = .uint4, .value = .{ .uint4 = try parseBinary(.oid, u32, bytes) } };
                } else {
                    return DataCell{ .tag = .uint4, .value = .{ .uint4 = std.fmt.parseInt(u32, bytes, 0) catch 0 } };
                }
            },
            .int4 => {
                if (binary) {
                    return DataCell{ .tag = .int4, .value = .{ .int4 = try parseBinary(.int4, i32, bytes) } };
                } else {
                    return DataCell{ .tag = .int4, .value = .{ .int4 = std.fmt.parseInt(i32, bytes, 0) catch 0 } };
                }
            },
            // postgres when reading bigint as int8 it returns a string unless type: { bigint: postgres.BigInt is set
            .int8 => {
                if (bigint) {
                    // .int8 is a 64-bit integer always string
                    return DataCell{ .tag = .int8, .value = .{ .int8 = std.fmt.parseInt(i64, bytes, 0) catch 0 } };
                } else {
                    return DataCell{ .tag = .string, .value = .{ .string = if (bytes.len > 0) bun.String.createUTF8(bytes).value.WTFStringImpl else null }, .free_value = 1 };
                }
            },
            .float8 => {
                if (binary and bytes.len == 8) {
                    return DataCell{ .tag = .float8, .value = .{ .float8 = try parseBinary(.float8, f64, bytes) } };
                } else {
                    const float8: f64 = bun.parseDouble(bytes) catch std.math.nan(f64);
                    return DataCell{ .tag = .float8, .value = .{ .float8 = float8 } };
                }
            },
            .float4 => {
                if (binary and bytes.len == 4) {
                    return DataCell{ .tag = .float8, .value = .{ .float8 = try parseBinary(.float4, f32, bytes) } };
                } else {
                    const float4: f64 = bun.parseDouble(bytes) catch std.math.nan(f64);
                    return DataCell{ .tag = .float8, .value = .{ .float8 = float4 } };
                }
            },
            .numeric => {
                if (binary) {
                    // this is probrably good enough for most cases
                    var stack_buffer = std.heap.stackFallback(1024, bun.default_allocator);
                    const allocator = stack_buffer.get();
                    var numeric_buffer = std.ArrayList(u8).fromOwnedSlice(allocator, &stack_buffer.buffer);
                    numeric_buffer.items.len = 0;
                    defer numeric_buffer.deinit();

                    // if is binary format lets display as a string because JS cant handle it in a safe way
                    const result = parseBinaryNumeric(bytes, &numeric_buffer) catch return error.UnsupportedNumericFormat;
                    return DataCell{ .tag = .string, .value = .{ .string = bun.String.createUTF8(result.slice()).value.WTFStringImpl }, .free_value = 1 };
                } else {
                    // nice text is actually what we want here
                    return DataCell{ .tag = .string, .value = .{ .string = if (bytes.len > 0) String.createUTF8(bytes).value.WTFStringImpl else null }, .free_value = 1 };
                }
            },
            .jsonb, .json => {
                return DataCell{ .tag = .json, .value = .{ .json = if (bytes.len > 0) String.createUTF8(bytes).value.WTFStringImpl else null }, .free_value = 1 };
            },
            .bool => {
                if (binary) {
                    return DataCell{ .tag = .bool, .value = .{ .bool = @intFromBool(bytes.len > 0 and bytes[0] == 1) } };
                } else {
                    return DataCell{ .tag = .bool, .value = .{ .bool = @intFromBool(bytes.len > 0 and bytes[0] == 't') } };
                }
            },
            .date, .timestamp, .timestamptz => |tag| {
                if (binary and bytes.len == 8) {
                    switch (tag) {
                        .timestamptz => return DataCell{ .tag = .date_with_time_zone, .value = .{ .date_with_time_zone = types.date.fromBinary(bytes) } },
                        .timestamp => return DataCell{ .tag = .date, .value = .{ .date = types.date.fromBinary(bytes) } },
                        else => unreachable,
                    }
                } else {
                    var str = bun.String.init(bytes);
                    defer str.deref();
                    return DataCell{ .tag = .date, .value = .{ .date = str.parseDate(globalObject) } };
                }
            },

            .bytea => {
                if (binary) {
                    return DataCell{ .tag = .bytea, .value = .{ .bytea = .{ @intFromPtr(bytes.ptr), bytes.len } } };
                } else {
                    if (bun.strings.hasPrefixComptime(bytes, "\\x")) {
                        return try parseBytea(bytes[2..]);
                    }
                    return error.UnsupportedByteaFormat;
                }
            },
            // text array types
            inline .bpchar_array,
            .varchar_array,
            .char_array,
            .text_array,
            .name_array,
            .json_array,
            .jsonb_array,
            // special types handled as text array
            .path_array,
            .xml_array,
            .point_array,
            .lseg_array,
            .box_array,
            .polygon_array,
            .line_array,
            .cidr_array,
            .numeric_array,
            .money_array,
            .varbit_array,
            .bit_array,
            .int2vector_array,
            .circle_array,
            .macaddr8_array,
            .macaddr_array,
            .inet_array,
            .aclitem_array,
            .tid_array,
            .pg_database_array,
            .pg_database_array2,
            // numeric array types
            .int8_array,
            .int2_array,
            .float8_array,
            .oid_array,
            .xid_array,
            .cid_array,

            // special types
            .bool_array,
            .bytea_array,

            //time types
            .time_array,
            .date_array,
            .timetz_array,
            .timestamp_array,
            .timestamptz_array,
            .interval_array,
            => |tag| {
                return try parseArray(bytes, bigint, tag, globalObject, null, false);
            },
            else => {
                return DataCell{ .tag = .string, .value = .{ .string = if (bytes.len > 0) bun.String.createUTF8(bytes).value.WTFStringImpl else null }, .free_value = 1 };
            },
        }
    }

    // #define pg_hton16(x)        (x)
    // #define pg_hton32(x)        (x)
    // #define pg_hton64(x)        (x)

    // #define pg_ntoh16(x)        (x)
    // #define pg_ntoh32(x)        (x)
    // #define pg_ntoh64(x)        (x)

    fn pg_ntoT(comptime IntSize: usize, i: anytype) std.meta.Int(.unsigned, IntSize) {
        @setRuntimeSafety(false);
        const T = @TypeOf(i);
        if (@typeInfo(T) == .array) {
            return pg_ntoT(IntSize, @as(std.meta.Int(.unsigned, IntSize), @bitCast(i)));
        }

        const casted: std.meta.Int(.unsigned, IntSize) = @intCast(i);
        return @byteSwap(casted);
    }
    fn pg_ntoh16(x: anytype) u16 {
        return pg_ntoT(16, x);
    }

    fn pg_ntoh32(x: anytype) u32 {
        return pg_ntoT(32, x);
    }
    const PGNummericString = union(enum) {
        static: [:0]const u8,
        dynamic: []const u8,

        pub fn slice(this: PGNummericString) []const u8 {
            return switch (this) {
                .static => |value| value,
                .dynamic => |value| value,
            };
        }
    };

    fn parseBinaryNumeric(input: []const u8, result: *std.ArrayList(u8)) !PGNummericString {
        // Reference: https://github.com/postgres/postgres/blob/50e6eb731d98ab6d0e625a0b87fb327b172bbebd/src/backend/utils/adt/numeric.c#L7612-L7740
        if (input.len < 8) return error.InvalidBuffer;
        var fixed_buffer = std.io.fixedBufferStream(input);
        var reader = fixed_buffer.reader();

        // Read header values using big-endian
        const ndigits = try reader.readInt(i16, .big);
        const weight = try reader.readInt(i16, .big);
        const sign = try reader.readInt(u16, .big);
        const dscale = try reader.readInt(i16, .big);

        // Handle special cases
        switch (sign) {
            0xC000 => return PGNummericString{ .static = "NaN" },
            0xD000 => return PGNummericString{ .static = "Infinity" },
            0xF000 => return PGNummericString{ .static = "-Infinity" },
            0x4000, 0x0000 => {},
            else => return error.InvalidSign,
        }

        if (ndigits == 0) {
            return PGNummericString{ .static = "0" };
        }

        // Add negative sign if needed
        if (sign == 0x4000) {
            try result.append('-');
        }

        // Calculate decimal point position
        var decimal_pos: i32 = @as(i32, weight + 1) * 4;
        if (decimal_pos <= 0) {
            decimal_pos = 1;
        }
        // Output all digits before the decimal point

        var scale_start: i32 = 0;
        if (weight < 0) {
            try result.append('0');
            scale_start = @as(i32, @intCast(weight)) + 1;
        } else {
            var idx: usize = 0;
            var first_non_zero = false;

            while (idx <= weight) : (idx += 1) {
                const digit = if (idx < ndigits) try reader.readInt(u16, .big) else 0;
                var digit_str: [4]u8 = undefined;
                const digit_len = std.fmt.formatIntBuf(&digit_str, digit, 10, .lower, .{ .width = 4, .fill = '0' });
                if (!first_non_zero) {
                    //In the first digit, suppress extra leading decimal zeroes
                    var start_idx: usize = 0;
                    while (start_idx < digit_len and digit_str[start_idx] == '0') : (start_idx += 1) {}
                    if (start_idx == digit_len) continue;
                    const digit_slice = digit_str[start_idx..digit_len];
                    try result.appendSlice(digit_slice);
                    first_non_zero = true;
                } else {
                    try result.appendSlice(digit_str[0..digit_len]);
                }
            }
        }
        // If requested, output a decimal point and all the digits that follow it.
        // We initially put out a multiple of 4 digits, then truncate if needed.
        if (dscale > 0) {
            try result.append('.');
            // negative scale means we need to add zeros before the decimal point
            // greater than ndigits means we need to add zeros after the decimal point
            var idx: isize = scale_start;
            const end: usize = result.items.len + @as(usize, @intCast(dscale));
            while (idx < dscale) : (idx += 4) {
                if (idx >= 0 and idx < ndigits) {
                    const digit = reader.readInt(u16, .big) catch 0;
                    var digit_str: [4]u8 = undefined;
                    const digit_len = std.fmt.formatIntBuf(&digit_str, digit, 10, .lower, .{ .width = 4, .fill = '0' });
                    try result.appendSlice(digit_str[0..digit_len]);
                } else {
                    try result.appendSlice("0000");
                }
            }
            if (result.items.len > end) {
                result.items.len = end;
            }
        }
        return PGNummericString{ .dynamic = result.items };
    }

    pub fn parseBinary(comptime tag: types.Tag, comptime ReturnType: type, bytes: []const u8) AnyPostgresError!ReturnType {
        switch (comptime tag) {
            .float8 => {
                return @as(f64, @bitCast(try parseBinary(.int8, i64, bytes)));
            },
            .int8 => {
                // pq_getmsgfloat8
                if (bytes.len != 8) return error.InvalidBinaryData;
                return @byteSwap(@as(i64, @bitCast(bytes[0..8].*)));
            },
            .int4 => {
                // pq_getmsgint
                switch (bytes.len) {
                    1 => {
                        return bytes[0];
                    },
                    2 => {
                        return pg_ntoh16(@as(u16, @bitCast(bytes[0..2].*)));
                    },
                    4 => {
                        return @bitCast(pg_ntoh32(@as(u32, @bitCast(bytes[0..4].*))));
                    },
                    else => {
                        return error.UnsupportedIntegerSize;
                    },
                }
            },
            .oid => {
                switch (bytes.len) {
                    1 => {
                        return bytes[0];
                    },
                    2 => {
                        return pg_ntoh16(@as(u16, @bitCast(bytes[0..2].*)));
                    },
                    4 => {
                        return pg_ntoh32(@as(u32, @bitCast(bytes[0..4].*)));
                    },
                    else => {
                        return error.UnsupportedIntegerSize;
                    },
                }
            },
            .int2 => {
                // pq_getmsgint
                switch (bytes.len) {
                    1 => {
                        return bytes[0];
                    },
                    2 => {
                        // PostgreSQL stores numbers in big-endian format, so we must read as big-endian
                        // Read as raw 16-bit unsigned integer
                        const value: u16 = @bitCast(bytes[0..2].*);
                        // Convert from big-endian to native-endian (we always use little endian)
                        return @bitCast(@byteSwap(value)); // Cast to signed 16-bit integer (i16)
                    },
                    else => {
                        return error.UnsupportedIntegerSize;
                    },
                }
            },
            .float4 => {
                // pq_getmsgfloat4
                return @as(f32, @bitCast(try parseBinary(.int4, i32, bytes)));
            },
            else => @compileError("TODO"),
        }
    }

    pub const Flags = packed struct(u32) {
        has_indexed_columns: bool = false,
        has_named_columns: bool = false,
        has_duplicate_columns: bool = false,
        _: u29 = 0,
    };

    pub const Putter = struct {
        list: []DataCell,
        fields: []const protocol.FieldDescription,
        binary: bool = false,
        bigint: bool = false,
        count: usize = 0,
        globalObject: *JSC.JSGlobalObject,

        extern fn JSC__constructObjectFromDataCell(
            *JSC.JSGlobalObject,
            JSValue,
            JSValue,
            [*]DataCell,
            u32,
            Flags,
            u8, // result_mode
            ?[*]JSC.JSObject.ExternColumnIdentifier, // names
            u32, // names count
        ) JSValue;

        pub fn toJS(this: *Putter, globalObject: *JSC.JSGlobalObject, array: JSValue, structure: JSValue, flags: Flags, result_mode: PostgresSQLQueryResultMode, cached_structure: ?PostgresCachedStructure) JSValue {
            var names: ?[*]JSC.JSObject.ExternColumnIdentifier = null;
            var names_count: u32 = 0;
            if (cached_structure) |c| {
                if (c.fields) |f| {
                    names = f.ptr;
                    names_count = @truncate(f.len);
                }
            }

            return JSC__constructObjectFromDataCell(
                globalObject,
                array,
                structure,
                this.list.ptr,
                @truncate(this.fields.len),
                flags,
                @intFromEnum(result_mode),
                names,
                names_count,
            );
        }

        fn putImpl(this: *Putter, index: u32, optional_bytes: ?*Data, comptime is_raw: bool) !bool {
            const field = &this.fields[index];
            const oid = field.type_oid;
            debug("index: {d}, oid: {d}", .{ index, oid });
            const cell: *DataCell = &this.list[index];
            if (is_raw) {
                cell.* = DataCell.raw(optional_bytes);
            } else {
                const tag = if (std.math.maxInt(short) < oid) .text else @as(types.Tag, @enumFromInt(@as(short, @intCast(oid))));
                cell.* = if (optional_bytes) |data|
                    try DataCell.fromBytes((field.binary or this.binary) and tag.isBinaryFormatSupported(), this.bigint, tag, data.slice(), this.globalObject)
                else
                    DataCell{
                        .tag = .null,
                        .value = .{
                            .null = 0,
                        },
                    };
            }
            this.count += 1;
            cell.index = switch (field.name_or_index) {
                // The indexed columns can be out of order.
                .index => |i| i,

                else => @intCast(index),
            };

            // TODO: when duplicate and we know the result will be an object
            // and not a .values() array, we can discard the data
            // immediately.
            cell.isIndexedColumn = switch (field.name_or_index) {
                .duplicate => 2,
                .index => 1,
                .name => 0,
            };
            return true;
        }

        pub fn putRaw(this: *Putter, index: u32, optional_bytes: ?*Data) !bool {
            return this.putImpl(index, optional_bytes, true);
        }
        pub fn put(this: *Putter, index: u32, optional_bytes: ?*Data) !bool {
            return this.putImpl(index, optional_bytes, false);
        }
    };
};

const bun = @import("bun");

const JSC = bun.JSC;
const std = @import("std");
const JSValue = JSC.JSValue;
const postgres = @import("./postgres.zig");
const Data = postgres.Data;
const types = postgres.types;
const String = bun.String;
const int4 = postgres.int4;
const AnyPostgresError = postgres.AnyPostgresError;
const protocol = postgres.protocol;
const PostgresSQLQueryResultMode = postgres.PostgresSQLQueryResultMode;
const PostgresCachedStructure = postgres.PostgresCachedStructure;
const debug = postgres.debug;
const short = postgres.short;
