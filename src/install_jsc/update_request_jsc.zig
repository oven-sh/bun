//! JSC bridge for `bun.install.PackageManager.UpdateRequest`.

pub fn fromJS(globalThis: *jsc.JSGlobalObject, input: jsc.JSValue) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack.get();
    var all_positionals = std.array_list.Managed([]const u8).init(allocator);

    var log = logger.Log.init(allocator);

    if (input.isString()) {
        var input_str = try input.toSliceCloneWithAllocator(
            globalThis,
            allocator,
        );
        if (input_str.len > 0)
            try all_positionals.append(input_str.slice());
    } else if (input.isArray()) {
        var iter = try input.arrayIterator(globalThis);
        while (try iter.next()) |item| {
            const slice = try item.toSliceCloneWithAllocator(globalThis, allocator);
            if (slice.len == 0) continue;
            try all_positionals.append(slice.slice());
        }
    } else {
        return .js_undefined;
    }

    if (all_positionals.items.len == 0) {
        return .js_undefined;
    }

    var array = UpdateRequest.Array{};

    const update_requests = UpdateRequest.parseWithError(allocator, null, &log, all_positionals.items, &array, .add, false) catch {
        return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependencies"));
    };
    if (update_requests.len == 0) return .js_undefined;

    if (log.msgs.items.len > 0) {
        return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependencies"));
    }

    if (update_requests[0].failed) {
        return globalThis.throw("Failed to parse dependencies", .{});
    }

    var object = jsc.JSValue.createEmptyObject(globalThis, 2);
    var name_str = bun.String.init(update_requests[0].name);
    object.put(globalThis, "name", try name_str.transferToJS(globalThis));
    object.put(globalThis, "version", try update_requests[0].version.toJS(update_requests[0].version_buf, globalThis));
    return object;
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const logger = bun.logger;
const UpdateRequest = bun.install.PackageManager.UpdateRequest;
