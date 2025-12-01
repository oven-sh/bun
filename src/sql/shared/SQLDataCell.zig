pub const SQLDataCell = extern struct {
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
        uint8 = 14,
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
        uint8: u64,
    };

    pub const Array = extern struct {
        ptr: ?[*]SQLDataCell = null,
        len: u32,
        cap: u32,
        pub fn slice(this: *Array) []SQLDataCell {
            const ptr = this.ptr orelse return &.{};
            return ptr[0..this.len];
        }

        pub fn allocatedSlice(this: *Array) []SQLDataCell {
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

    pub fn deinit(this: *SQLDataCell) void {
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

    pub fn raw(optional_bytes: ?*const Data) SQLDataCell {
        if (optional_bytes) |bytes| {
            const bytes_slice = bytes.slice();
            return SQLDataCell{
                .tag = .raw,
                .value = .{ .raw = .{ .ptr = @ptrCast(bytes_slice.ptr), .len = bytes_slice.len } },
            };
        }
        // TODO: check empty and null fields
        return SQLDataCell{
            .tag = .null,
            .value = .{ .null = 0 },
        };
    }

    pub const Flags = packed struct(u32) {
        has_indexed_columns: bool = false,
        has_named_columns: bool = false,
        has_duplicate_columns: bool = false,
        _: u29 = 0,
    };

    // TODO: cppbind isn't yet able to detect slice parameters when the next is uint32_t
    pub fn constructObjectFromDataCell(
        globalObject: *jsc.JSGlobalObject,
        encodedArrayValue: jsc.JSValue,
        encodedStructureValue: jsc.JSValue,
        cells: [*]SQLDataCell,
        count: u32,
        flags: SQLDataCell.Flags,
        result_mode: u8,
        namesPtr: ?[*]bun.jsc.JSObject.ExternColumnIdentifier,
        namesCount: u32,
    ) !jsc.JSValue {
        if (comptime bun.Environment.ci_assert) {
            var scope: jsc.ExceptionValidationScope = undefined;
            scope.init(globalObject, @src());
            defer scope.deinit();
            const value = JSC__constructObjectFromDataCell(globalObject, encodedArrayValue, encodedStructureValue, cells, count, flags, result_mode, namesPtr, namesCount);
            scope.assertExceptionPresenceMatches(value == .zero);
            return if (value == .zero) error.JSError else value;
        } else {
            const value = JSC__constructObjectFromDataCell(globalObject, encodedArrayValue, encodedStructureValue, cells, count, flags, result_mode, namesPtr, namesCount);
            if (value == .zero) return error.JSError;
            return value;
        }
    }

    pub extern fn JSC__constructObjectFromDataCell(
        *jsc.JSGlobalObject,
        JSValue,
        JSValue,
        [*]SQLDataCell,
        u32,
        SQLDataCell.Flags,
        u8, // result_mode
        ?[*]jsc.JSObject.ExternColumnIdentifier, // names
        u32, // names count
    ) JSValue;
};

const bun = @import("bun");
const Data = @import("./Data.zig").Data;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
