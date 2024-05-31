const bun = @import("root").bun;
const std = @import("std");

pub fn fromSys(e: bun.JSC.SystemError) Error {
    return Error.newSys(e);
}

pub const Error = struct {
    impl: union(enum) {
        sys: bun.JSC.SystemError,
        any: AnyError,
    },

    pub fn format(this: *const Error, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (this.impl) {
            .sys => try writer.print("{}", .{this.impl.sys}),
            .any => try writer.print("{}", .{this.impl.any}),
        }
    }

    pub fn newSys(syserr: bun.JSC.SystemError) Error {
        return .{
            .impl = .{ .sys = syserr },
        };
    }

    pub fn fmt(comptime fmt_str: []const u8, args: anytype) Error {
        const T = @TypeOf(args);
        const Inner = struct {
            args: T,
            pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.print(fmt_str, this.args);
            }
        };
        return custom(Inner{ .args = args });
    }

    pub fn custom(value: anytype) Error {
        return .{
            .impl = .{ .any = AnyError.from(value) },
        };
    }

    pub fn fromZigErr(e: anyerror, comptime context: []const u8) Error {
        return .{
            .impl = .{ .any = AnyError.fromZigErr(e, context) },
        };
    }

    pub fn deinit(this: *Error) void {
        switch (this.impl) {
            .sys => this.impl.sys.deref(),
            .any => this.impl.any.deinit(),
        }
    }
};

const AnyError = struct {
    vtable: VTable,

    pub fn format(this: *const AnyError, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        const buf = this.vtable.fmt();
        defer bun.default_allocator.free(buf);
        try writer.print("{s}", .{buf});
    }

    pub fn fromZigErr(e: anyerror, comptime context: []const u8) AnyError {
        const Inner = struct {
            e: anyerror,

            pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.print("{s}: {s}", .{ @errorName(this.e), context });
            }
        };
        return from(Inner{
            .e = e,
        });
    }

    pub fn from(value: anytype) AnyError {
        const T = @TypeOf(value);

        const Inner = struct {
            val: T,

            pub fn fmt(ptr: *const anyopaque) []u8 {
                const this: *const @This() = @ptrCast(@alignCast(ptr));
                return std.fmt.allocPrint(bun.default_allocator, "{}", .{this.val}) catch bun.outOfMemory();
            }

            pub fn deinit(ptr: *anyopaque) void {
                var this: *@This() = @ptrCast(@alignCast(ptr));
                if (@hasDecl(T, "deinit")) {
                    this.val.deinit();
                }
                bun.default_allocator.destroy(this);
            }
        };

        const inner = bun.default_allocator.create(Inner) catch bun.outOfMemory();
        inner.* = .{
            .val = value,
        };

        return AnyError{
            .vtable = .{
                .ptr = @ptrCast(@alignCast(inner)),
                ._fmt = Inner.fmt,
                ._deinit = Inner.deinit,
            },
        };
    }

    pub fn deinit(this: *AnyError) void {
        this.vtable.deinit();
    }
};

const VTable = struct {
    ptr: *anyopaque,
    _fmt: *const fn (*const anyopaque) []u8,
    _deinit: *const fn (*anyopaque) void,

    fn fmt(this: *const VTable) []u8 {
        return this._fmt(this.ptr);
    }

    fn deinit(this: *VTable) void {
        this._deinit(this.ptr);
    }
};
