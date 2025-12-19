//! bun:diff - SIMD-optimized Myers diff engine
//!
//! Provides high-performance text diffing and patching capabilities.
//! Designed for AI coding assistants like Claude Code.

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;

const line = @import("bun_diff_line.zig");
const myers = @import("bun_diff_myers.zig");

const LineIndex = line.LineIndex;
const Edit = myers.Edit;

/// JS binding: diff(a, b) -> DiffResult
fn jsDiff(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (callframe.argumentsCount() < 2) {
        return global.throwNotEnoughArguments("diff", 2, callframe.argumentsCount());
    }

    const a_val = callframe.argument(0);
    const b_val = callframe.argument(1);

    if (!a_val.isString() or !b_val.isString()) {
        return global.throwInvalidArguments("diff() arguments must be strings", .{});
    }

    const a_str = try a_val.toBunString(global);
    defer a_str.deref();
    const b_str = try b_val.toBunString(global);
    defer b_str.deref();

    const a_slice = a_str.toUTF8(bun.default_allocator);
    defer a_slice.deinit();
    const b_slice = b_str.toUTF8(bun.default_allocator);
    defer b_slice.deinit();

    // Create line indices
    var a_lines = LineIndex.init(a_slice.slice(), bun.default_allocator) catch {
        return global.throw("Failed to index lines in first argument", .{});
    };
    defer a_lines.deinit();

    var b_lines = LineIndex.init(b_slice.slice(), bun.default_allocator) catch {
        return global.throw("Failed to index lines in second argument", .{});
    };
    defer b_lines.deinit();

    // Compute diff
    const edits = myers.diff(a_lines, b_lines, bun.default_allocator) catch {
        return global.throw("Failed to compute diff", .{});
    };
    defer bun.default_allocator.free(edits);

    // Build result object
    return buildResultObject(global, edits);
}

fn buildResultObject(
    global: *jsc.JSGlobalObject,
    edits: []const Edit,
) bun.JSError!jsc.JSValue {
    const result = jsc.JSValue.createEmptyObject(global, 2);

    // Create edits array
    const edits_array = try jsc.JSValue.createEmptyArray(global, edits.len);

    var lines_added: u32 = 0;
    var lines_deleted: u32 = 0;

    for (edits, 0..) |edit, i| {
        const edit_obj = jsc.JSValue.createEmptyObject(global, 5);

        switch (edit) {
            .equal => |r| {
                edit_obj.put(global, bun.String.static("type"), bun.String.static("equal").toJS(global));
                edit_obj.put(global, bun.String.static("oldStart"), jsc.JSValue.jsNumber(r.old_start));
                edit_obj.put(global, bun.String.static("oldEnd"), jsc.JSValue.jsNumber(r.old_end));
                edit_obj.put(global, bun.String.static("newStart"), jsc.JSValue.jsNumber(r.new_start));
                edit_obj.put(global, bun.String.static("newEnd"), jsc.JSValue.jsNumber(r.new_end));
            },
            .insert => |r| {
                edit_obj.put(global, bun.String.static("type"), bun.String.static("insert").toJS(global));
                edit_obj.put(global, bun.String.static("oldStart"), jsc.JSValue.jsNumber(r.old_start));
                edit_obj.put(global, bun.String.static("oldEnd"), jsc.JSValue.jsNumber(r.old_end));
                edit_obj.put(global, bun.String.static("newStart"), jsc.JSValue.jsNumber(r.new_start));
                edit_obj.put(global, bun.String.static("newEnd"), jsc.JSValue.jsNumber(r.new_end));
                lines_added += r.new_end - r.new_start;
            },
            .delete => |r| {
                edit_obj.put(global, bun.String.static("type"), bun.String.static("delete").toJS(global));
                edit_obj.put(global, bun.String.static("oldStart"), jsc.JSValue.jsNumber(r.old_start));
                edit_obj.put(global, bun.String.static("oldEnd"), jsc.JSValue.jsNumber(r.old_end));
                edit_obj.put(global, bun.String.static("newStart"), jsc.JSValue.jsNumber(r.new_start));
                edit_obj.put(global, bun.String.static("newEnd"), jsc.JSValue.jsNumber(r.new_end));
                lines_deleted += r.old_end - r.old_start;
            },
        }

        try edits_array.putIndex(global, @truncate(i), edit_obj);
    }

    result.put(global, bun.String.static("edits"), edits_array);

    // Create stats object
    const stats = jsc.JSValue.createEmptyObject(global, 3);
    stats.put(global, bun.String.static("linesAdded"), jsc.JSValue.jsNumber(lines_added));
    stats.put(global, bun.String.static("linesDeleted"), jsc.JSValue.jsNumber(lines_deleted));
    stats.put(global, bun.String.static("hunks"), jsc.JSValue.jsNumber(countHunks(edits)));
    result.put(global, bun.String.static("stats"), stats);

    return result;
}

fn countHunks(edits: []const Edit) u32 {
    var hunks: u32 = 0;
    var in_change = false;

    for (edits) |edit| {
        const is_change = switch (edit) {
            .equal => false,
            .insert, .delete => true,
        };

        if (is_change and !in_change) {
            hunks += 1;
        }
        in_change = is_change;
    }

    return hunks;
}

/// Generate exports object for $zig binding
pub fn generate(global: *jsc.JSGlobalObject) jsc.JSValue {
    const exports = jsc.JSValue.createEmptyObject(global, 1);

    exports.put(
        global,
        bun.String.static("diff"),
        jsc.JSFunction.create(global, bun.String.static("diff"), jsDiff, 2, .{}),
    );

    return exports;
}
