//! Ref counted string type. The reference count is stored before the data.
//! Zack said to name this string after myself; to leave my legacy.
const CloRefString = @This();

/// The string data, excluding the reference count.
/// Safe to access directly, but can only be freed by `deref`.
data: []u8,

pub fn deref(self: CloRefString, allocator: std.mem.Allocator) void {
    const rc = refCountPtr(self);
    rc.* -= 1;
    if (rc.* == 0) {
        allocator.free(allocatedSlice(self));
    }
}

pub fn dupeRef(self: CloRefString) CloRefString {
    refCountPtr(self).* += 1;
    return self;
}

pub fn refCount(self: *CloRefString) u32 {
    return refCountPtr(self).*;
}

pub fn fromUnsafeBytes(bytes: []u8, allocator: std.mem.Allocator) CloRefString {
    if (bun.AllocationScope.downcast(allocator)) |scope| {
        const byte_ptr: [*]const u8 = @ptrCast(refCountPtr(.{ .data = bytes }));
        bun.assert(scope.state.allocations.get(byte_ptr).?.extra == .clo_ref_string);
    }
    return .{ .data = bytes };
}

/// To build a CloRefString, the first 4 bytes must be reserved for the reference count.
/// So it makes sense to use this builder instead of your own work.
pub const Builder = struct {
    allocator: std.mem.Allocator,
    list: std.ArrayListUnmanaged(u8),

    pub fn init(allocator: std.mem.Allocator) !Builder {
        return initCapacity(allocator, 0);
    }

    pub fn initCapacity(allocator: std.mem.Allocator, estimate: u32) !Builder {
        var b: Builder = .{
            .allocator = allocator,
            .list = try .initCapacity(allocator, @sizeOf(u32) + estimate),
        };
        b.list.appendSliceAssumeCapacity(comptime std.mem.asBytes(&@as(u32, 1)));
        return b;
    }

    pub fn discard(self: *Builder) void {
        self.list.deinit();
    }

    pub fn setInitialRefCount(self: *Builder, ref_count: u32) void {
        self.list.items[0..4].* = std.mem.asBytes(&ref_count);
    }

    /// To use
    ///
    /// var b = try CloRefString.Builder.init(allocator);
    /// {
    ///     var mutable_string = b.asMutableString();
    ///     defer b = .fromMutableString(mutable_string);
    ///     ...
    /// }
    /// b.done();
    ///
    pub fn asMutableString(self: *Builder) bun.MutableString {
        defer self.* = undefined;
        return .{ .allocator = self.allocator, .list = self.list };
    }
    pub fn fromMutableString(str: bun.MutableString) @This() {
        bun.assert(std.mem.bytesAsValue(u32, str.list.items[0..4]).* == 1);
        return .{ .allocator = str.allocator, .list = str.list };
    }

    pub fn done(self: *Builder) CloRefString {
        // Try to shrink the allocation if possible, but don't reallocate.
        // This is fine in Bun because mimalloc does not require the right length.
        const old_memory = self.list.allocatedSlice();
        const bytes = if (self.allocator.remap(old_memory, self.list.items.len)) |new_items|
            new_items
        else
            self.list.items;
        self.list = .empty;

        const str: CloRefString = .{ .data = bytes[4..] };

        // Tag the original slice with an AllocationScope if possible
        if (bun.AllocationScope.downcast(self.allocator)) |scope| {
            scope.setPointerExtra(
                @ptrCast(bytes),
                .{ .clo_ref_string = .{ .ref_count = str.refCountPtr() } },
            );
        }

        return str;
    }
};

pub const DebugInfo = struct {
    ref_count: *align(1) u32,

    pub fn onAllocationLeak(self: @This(), ptr: []u8) void {
        _ = ptr;
        bun.Output.prettyError("This CloRefString has {d} refs\n", .{self.ref_count.*});
    }
};

fn refCountPtr(self: CloRefString) *align(1) u32 {
    return @ptrCast(self.data.ptr - @sizeOf(u32));
}

fn allocatedSlice(self: CloRefString) []u8 {
    return (self.data.ptr - 4)[0 .. self.data.len + 4];
}

const std = @import("std");
const bun = @import("bun");
