/// Environment strings need to be copied a lot
/// So we make them reference counted
///
/// But sometimes we use strings that are statically allocated, or are allocated
/// with a predetermined lifetime (e.g. strings in the AST). In that case we
/// don't want to incur the cost of heap allocating them and refcounting them
///
/// So environment strings can be ref counted or borrowed slices
pub const EnvStr = packed struct(u128) {
    ptr: u48,
    tag: Tag = .empty,
    len: usize = 0,

    const debug = bun.Output.scoped(.EnvStr, .hidden);

    const Tag = enum(u16) {
        /// no value
        empty,

        /// Dealloced by reference counting
        refcounted,

        /// Memory is managed elsewhere so don't dealloc it
        slice,
    };

    pub inline fn initSlice(str: []const u8) EnvStr {
        if (str.len == 0)
            // Zero length strings may have invalid pointers, leading to a bad integer cast.
            return .{ .tag = .empty, .ptr = 0, .len = 0 };

        return .{
            .ptr = toPtr(str.ptr),
            .tag = .slice,
            .len = str.len,
        };
    }

    fn toPtr(ptr_val: *const anyopaque) u48 {
        const num: [8]u8 = @bitCast(@intFromPtr(ptr_val));
        return @bitCast(num[0..6].*);
    }

    /// Same thing as `initRefCounted` except it duplicates thepassed string
    pub fn dupeRefCounted(old_str: []const u8) EnvStr {
        if (old_str.len == 0)
            return .{ .tag = .empty, .ptr = 0, .len = 0 };

        const str = bun.handleOom(bun.default_allocator.dupe(u8, old_str));
        return .{
            .ptr = toPtr(RefCountedStr.init(str)),
            .len = str.len,
            .tag = .refcounted,
        };
    }

    pub fn initRefCounted(str: []const u8) EnvStr {
        if (str.len == 0)
            return .{ .tag = .empty, .ptr = 0, .len = 0 };

        return .{
            .ptr = toPtr(RefCountedStr.init(str)),
            .tag = .refcounted,
        };
    }

    pub fn slice(this: EnvStr) []const u8 {
        return switch (this.tag) {
            .empty => "",
            .slice => this.castSlice(),
            .refcounted => this.castRefCounted().byteSlice(),
        };
    }

    pub fn memoryCost(this: EnvStr) usize {
        const divisor: usize = brk: {
            if (this.asRefCounted()) |refc| {
                break :brk refc.refcount;
            }
            break :brk 1;
        };
        if (divisor == 0) {
            @branchHint(.unlikely);
            return 0;
        }

        return this.len / divisor;
    }

    pub fn ref(this: EnvStr) void {
        if (this.asRefCounted()) |refc| {
            refc.ref();
        }
    }

    pub fn deref(this: EnvStr) void {
        if (this.asRefCounted()) |refc| {
            refc.deref();
        }
    }

    inline fn asRefCounted(this: EnvStr) ?*RefCountedStr {
        if (this.tag == .refcounted) return this.castRefCounted();
        return null;
    }

    inline fn castSlice(this: EnvStr) []const u8 {
        return @as([*]u8, @ptrFromInt(@as(usize, @intCast(this.ptr))))[0..this.len];
    }

    inline fn castRefCounted(this: EnvStr) *RefCountedStr {
        return @ptrFromInt(@as(usize, @intCast(this.ptr)));
    }
};

const bun = @import("bun");

const interpreter = @import("./interpreter.zig");
const RefCountedStr = interpreter.RefCountedStr;
