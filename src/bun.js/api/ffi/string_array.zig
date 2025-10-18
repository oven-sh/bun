const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;

pub const StringArray = struct {
    items: []const [:0]const u8 = &.{},
    pub fn deinit(this: *StringArray) void {
        for (this.items) |item| {
            // Attempting to free an empty null-terminated slice will crash if it was a default value
            bun.debugAssert(item.len > 0);

            bun.default_allocator.free(@constCast(item));
        }

        if (this.items.len > 0)
            bun.default_allocator.free(this.items);
    }

    pub fn fromJSArray(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, comptime property: []const u8) bun.JSError!StringArray {
        var iter = try value.arrayIterator(globalThis);
        var items = std.ArrayList([:0]const u8).init(bun.default_allocator);

        while (try iter.next()) |val| {
            if (!val.isString()) {
                for (items.items) |item| {
                    bun.default_allocator.free(@constCast(item));
                }
                items.deinit();
                return globalThis.throwInvalidArgumentTypeValue(property, "array of strings", val);
            }
            const str = try val.getZigString(globalThis);
            if (str.isEmpty()) continue;
            bun.handleOom(items.append(bun.handleOom(str.toOwnedSliceZ(bun.default_allocator))));
        }

        return .{ .items = items.items };
    }

    pub fn fromJSString(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, comptime property: []const u8) bun.JSError!StringArray {
        if (value.isUndefined()) return .{};
        if (!value.isString()) {
            return globalThis.throwInvalidArgumentTypeValue(property, "array of strings", value);
        }
        const str = try value.getZigString(globalThis);
        if (str.isEmpty()) return .{};
        var items = std.ArrayList([:0]const u8).init(bun.default_allocator);
        bun.handleOom(items.append(bun.handleOom(str.toOwnedSliceZ(bun.default_allocator))));
        return .{ .items = items.items };
    }

    pub fn fromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, comptime property: []const u8) bun.JSError!StringArray {
        if (value.isArray()) {
            return fromJSArray(globalThis, value, property);
        }
        return fromJSString(globalThis, value, property);
    }
};
