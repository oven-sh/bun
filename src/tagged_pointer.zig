const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const default_allocator = bun.default_allocator;
const C = bun.C;
const typeBaseName = @import("./meta.zig").typeBaseName;

const TagSize = u15;
const AddressableSize = u49;

pub const TaggedPointer = packed struct {
    _ptr: AddressableSize,
    data: TagSize,

    pub inline fn init(ptr: anytype, data: TagSize) TaggedPointer {
        const Ptr = @TypeOf(ptr);

        if (comptime @typeInfo(Ptr) != .Pointer and Ptr != ?*anyopaque) {
            @compileError(@typeName(Ptr) ++ " must be a ptr, received: " ++ @tagName(@typeInfo(Ptr)));
        }

        const address = @intFromPtr(ptr);

        return TaggedPointer{
            ._ptr = @as(AddressableSize, @truncate(address)),
            .data = data,
        };
    }

    pub inline fn get(this: TaggedPointer, comptime Type: type) *Type {
        return @as(*Type, @ptrFromInt(@as(usize, @intCast(this._ptr))));
    }

    pub inline fn from(val: anytype) TaggedPointer {
        const ValueType = @TypeOf(val);
        return switch (ValueType) {
            f64, i64, u64 => @as(TaggedPointer, @bitCast(val)),
            ?*anyopaque, *anyopaque => @as(TaggedPointer, @bitCast(@intFromPtr(val))),
            else => @compileError("Unsupported type: " ++ @typeName(ValueType)),
        };
    }

    pub inline fn to(this: TaggedPointer) *anyopaque {
        return @as(*anyopaque, @ptrFromInt(@as(u64, @bitCast(this))));
    }
};

pub fn TaggedPointerUnion(comptime Types: anytype) type {
    const TagType: type = tag_break: {
        if (std.meta.trait.isIndexable(@TypeOf(Types))) {
            var enumFields: [Types.len]std.builtin.Type.EnumField = undefined;
            var decls = [_]std.builtin.Type.Declaration{};

            inline for (Types, 0..) |field, i| {
                enumFields[i] = .{
                    .name = comptime typeBaseName(@typeName(field)),
                    .value = 1024 - i,
                };
            }

            break :tag_break @Type(.{
                .Enum = .{
                    .tag_type = TagSize,
                    .fields = &enumFields,
                    .decls = &decls,
                    .is_exhaustive = false,
                },
            });
        } else {
            const Fields: []const std.builtin.Type.StructField = std.meta.fields(@TypeOf(Types));
            var enumFields: [Fields.len]std.builtin.Type.EnumField = undefined;
            var decls = [_]std.builtin.Type.Declaration{};

            inline for (Fields, 0..) |field, i| {
                enumFields[i] = .{
                    .name = comptime typeBaseName(@typeName(field.default_value.?)),
                    .value = 1024 - i,
                };
            }

            break :tag_break @Type(.{
                .Enum = .{
                    .tag_type = TagSize,
                    .fields = &enumFields,
                    .decls = &decls,
                    .is_exhaustive = false,
                },
            });
        }
    };

    return struct {
        pub const Tag = TagType;
        repr: TaggedPointer,

        const This = @This();
        fn assert_type(comptime Type: type) void {
            var name = comptime typeBaseName(@typeName(Type));
            if (!comptime @hasField(Tag, name)) {
                @compileError("TaggedPointerUnion does not have " ++ name ++ ".");
            }
        }
        pub inline fn get(this: This, comptime Type: anytype) ?*Type {
            comptime assert_type(Type);

            return if (this.is(Type)) this.as(Type) else null;
        }

        pub inline fn tag(this: This) TagType {
            return @as(TagType, @enumFromInt(this.repr.data));
        }

        /// unsafely cast a tagged pointer to a specific type, without checking that it's really that type
        pub inline fn as(this: This, comptime Type: type) *Type {
            comptime assert_type(Type);
            return this.repr.get(Type);
        }

        pub inline fn is(this: This, comptime Type: type) bool {
            comptime assert_type(Type);
            return this.repr.data == comptime @intFromEnum(@field(Tag, typeBaseName(@typeName(Type))));
        }

        pub fn set(this: *@This(), _ptr: anytype) void {
            this.* = @This().init(_ptr);
        }

        pub inline fn isValidPtr(_ptr: ?*anyopaque) bool {
            return This.isValid(This.from(_ptr));
        }

        pub inline fn isValid(this: This) bool {
            return switch (this.repr.data) {
                @intFromEnum(
                    @field(Tag, typeBaseName(@typeName(Types[Types.len - 1]))),
                )...@intFromEnum(
                    @field(Tag, typeBaseName(@typeName(Types[0]))),
                ) => true,
                else => false,
            };
        }

        pub inline fn from(_ptr: ?*anyopaque) This {
            return This{ .repr = TaggedPointer.from(_ptr) };
        }

        pub inline fn ptr(this: This) *anyopaque {
            return this.repr.to();
        }

        pub inline fn ptrUnsafe(this: This) *anyopaque {
            @setRuntimeSafety(false);
            return this.repr.to();
        }

        pub inline fn init(_ptr: anytype) This {
            const Type = std.meta.Child(@TypeOf(_ptr));
            return initWithType(Type, _ptr);
        }

        pub inline fn initWithType(comptime Type: type, _ptr: anytype) This {
            const name = comptime typeBaseName(@typeName(Type));

            // there will be a compiler error if the passed in type doesn't exist in the enum
            return This{ .repr = TaggedPointer.init(_ptr, @intFromEnum(@field(Tag, name))) };
        }
    };
}

test "TaggedPointerUnion" {
    const IntPrimitive = struct { val: u32 = 0 };
    const StringPrimitive = struct { val: []const u8 = "" };
    const Object = struct { blah: u32, val: u32 };
    // const Invalid = struct {
    //     wrong: bool = true,
    // };
    const Union = TaggedPointerUnion(.{ IntPrimitive, StringPrimitive, Object });
    var str = try default_allocator.create(StringPrimitive);
    str.* = StringPrimitive{ .val = "hello!" };
    var un = Union.init(str);
    try std.testing.expect(un.is(StringPrimitive));
    try std.testing.expectEqualStrings(un.as(StringPrimitive).val, "hello!");
    try std.testing.expect(!un.is(IntPrimitive));
    const num = try default_allocator.create(IntPrimitive);
    num.val = 9999;

    var un2 = Union.init(num);

    try std.testing.expect(un2.as(IntPrimitive).val == 9999);

    try std.testing.expect(un.tag() == .StringPrimitive);
    try std.testing.expect(un2.tag() == .IntPrimitive);

    un2.repr.data = 0;
    try std.testing.expect(un2.tag() != .IntPrimitive);
    try std.testing.expect(un2.get(IntPrimitive) == null);
    // try std.testing.expect(un2.is(Invalid) == false);
}

test "TaggedPointer" {
    const Hello = struct {
        what: []const u8,
    };

    var hello_struct_ptr = try default_allocator.create(Hello);
    hello_struct_ptr.* = Hello{ .what = "hiiii" };
    var tagged = TaggedPointer.init(hello_struct_ptr, 0);
    try std.testing.expectEqual(tagged.get(Hello), hello_struct_ptr);
    try std.testing.expectEqualStrings(tagged.get(Hello).what, hello_struct_ptr.what);
    tagged = TaggedPointer.init(hello_struct_ptr, 100);
    try std.testing.expectEqual(tagged.get(Hello), hello_struct_ptr);
    try std.testing.expectEqualStrings(tagged.get(Hello).what, hello_struct_ptr.what);
    tagged = TaggedPointer.init(hello_struct_ptr, std.math.maxInt(TagSize) - 500);
    try std.testing.expectEqual(tagged.get(Hello), hello_struct_ptr);
    try std.testing.expectEqual(tagged.data, std.math.maxInt(TagSize) - 500);
    try std.testing.expectEqualStrings(tagged.get(Hello).what, hello_struct_ptr.what);

    var i: TagSize = 0;
    while (i < std.math.maxInt(TagSize) - 1) : (i += 1) {
        hello_struct_ptr = try default_allocator.create(Hello);
        const what = try std.fmt.allocPrint(default_allocator, "hiiii {d}", .{i});
        hello_struct_ptr.* = Hello{ .what = what };
        try std.testing.expectEqualStrings(TaggedPointer.from(TaggedPointer.init(hello_struct_ptr, i).to()).get(Hello).what, what);
        var this = TaggedPointer.from(TaggedPointer.init(hello_struct_ptr, i).to());
        try std.testing.expect(this.data == i);
        try std.testing.expect(this.data != i + 1);
    }
}
