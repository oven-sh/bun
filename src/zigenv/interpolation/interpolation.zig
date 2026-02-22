/// Search backward from current position to find `$` that precedes `{`.
/// Returns position of `$` or null if not found or if escaped.
/// Called AFTER '{' is added to buffer, so we start from buffer.len - 2 to skip the '{'.
pub fn positionOfDollarLastSign(value: *const EnvValue) ?usize {
    // value.buffer.len is where the NEXT char will go.
    // buffer.len - 1 is the '{' that was just added.
    // So we start searching from buffer.len - 2.
    if (value.buffer.length() < 2) {
        return null;
    }

    // Using isize for calculation to avoid underflow
    var tmp: isize = @as(isize, @intCast(value.buffer.length())) - 2;
    const items_data = value.buffer.usedSlice();

    while (tmp >= 0) {
        const u_tmp = @as(usize, @intCast(tmp));
        if (items_data[u_tmp] == '$') {
            // Check for explicit escape recorded during parsing
            if (value.escaped_dollar_index) |esc_idx| {
                if (u_tmp == esc_idx) return null;
            }
            // Check for literal backslash check (still useful for some cases)
            if (u_tmp > 0 and items_data[u_tmp - 1] == '\\') {
                return null; // escaped $
            }
            return u_tmp;
        }
        if (items_data[u_tmp] == ' ') {
            tmp -= 1;
            continue; // skip whitespace between $ and {
        }
        return null; // non-whitespace (other than '{') between $ and {
    }
    return null;
}

/// Called when `{` is encountered; start tracking a new variable interpolation.
pub fn openVariable(value: *EnvValue) !void {
    // We treat empty variable placeholder as a parse error (or just don't open it)
    if (value.buffer.length() < 2) return;

    const dollar_pos_opt = positionOfDollarLastSign(value);

    if (dollar_pos_opt) |dollar_pos| {
        value.is_parsing_variable = true;

        // Create VariablePosition (by value, as ArrayList stores struct)
        // dollar_pos is where $ starts.
        // open brace is at buffer.len - 1.
        // var_start (where variable name starts) is buffer.len.
        const new_pos = VariablePosition.init(value.buffer.length(), value.buffer.length() - 1, dollar_pos);

        try value.interpolations.append(new_pos);
    }
}

/// Called when first char of variable name is encountered in braceless mode (e.g. $VAR)
/// Assumes pre-checks (unquoted/double-quoted, previous char was $) are done by caller.
pub fn openBracelessVariable(value: *EnvValue) !void {
    // We assume caller verified previous char is $
    // buffer.len points to where the current/next char will be written.
    // Previous char (buffer.len - 1) is $.
    if (value.buffer.length() < 1) return;
    const dollar_pos = value.buffer.length() - 1;

    value.is_parsing_braceless_variable = true;

    // start_brace is just used as boundary for whitespace check.
    // We set it to dollar_pos so checks stop at $.
    // variable_start is where the current char will be written (buffer.len),
    const new_pos = VariablePosition.init(value.buffer.length(), dollar_pos, dollar_pos);

    try value.interpolations.append(new_pos);
}

/// Called when `}` is encountered; finalize the current variable interpolation.
pub fn closeVariable(allocator: std.mem.Allocator, value: *EnvValue) !void {
    // Find the last unclosed interpolation (LIFO for nesting)
    var active_idx: ?usize = null;
    var i: usize = value.interpolations.items.len;
    while (i > 0) {
        i -= 1;
        if (!value.interpolations.items[i].closed) {
            active_idx = i;
            break;
        }
    }

    if (active_idx == null) {
        value.is_parsing_variable = false;
        return;
    }

    const idx = active_idx.?;
    const interpolation_item = &value.interpolations.items[idx];

    interpolation_item.end_brace = value.buffer.length() - 1;
    // variable_end = buffer.len - 2 (character before })
    if (value.buffer.length() >= 2) {
        interpolation_item.variable_end = value.buffer.length() - 2;
    } else {
        // Should catch this, but 0 based index...
        interpolation_item.variable_end = 0;
    }

    const val_slice = value.value();

    // Trim left whitespace
    const left = whitespace_utils.getWhiteSpaceOffsetLeft(val_slice, interpolation_item);
    if (left > 0) {
        interpolation_item.variable_start += left;
    }

    // Trim right whitespace
    const right = whitespace_utils.getWhiteSpaceOffsetRight(val_slice, interpolation_item);
    if (right > 0) {
        if (interpolation_item.variable_end >= right) {
            interpolation_item.variable_end -= right;
        }
    }

    // Extract variable name
    // Length = (end - start) + 1
    if (interpolation_item.variable_end >= interpolation_item.variable_start) {
        const full_len = (interpolation_item.variable_end - interpolation_item.variable_start) + 1;
        const start = interpolation_item.variable_start;
        // Safety check
        if (start + full_len <= val_slice.len) {
            const full_content = val_slice[start .. start + full_len];

            if (std.mem.indexOf(u8, full_content, ":-")) |sep_idx| {
                const var_name = full_content[0..sep_idx];
                const default_val = full_content[sep_idx + 2 ..];

                try interpolation_item.setVariableStr(allocator, std.mem.trim(u8, var_name, &[_]u8{ ' ', '\t' }));
                try interpolation_item.setDefaultValue(allocator, default_val);
                // Update variable_end to point to the start of strictly the separator so finalizer can find it
                interpolation_item.variable_end = interpolation_item.variable_start + sep_idx;
            } else {
                try interpolation_item.setVariableStr(allocator, std.mem.trim(u8, full_content, &[_]u8{ ' ', '\t' }));
            }
        }
    }

    interpolation_item.closed = true;

    // Update parsing state based on remaining unclosed items
    var still_parsing = false;
    var j: usize = value.interpolations.items.len;
    while (j > 0) {
        j -= 1;
        if (!value.interpolations.items[j].closed) {
            still_parsing = true;
            break;
        }
    }
    value.is_parsing_variable = still_parsing;
    value.interpolation_index += 1;
}

/// Called when a non-identifier char is encountered for a braceless variable.
/// The terminating char is NOT yet in the buffer.
pub fn closeBracelessVariable(allocator: std.mem.Allocator, value: *EnvValue) !void {
    value.is_parsing_braceless_variable = false;

    if (value.interpolations.items.len <= value.interpolation_index) {
        return; // Should not happen
    }

    const interpolation_item = &value.interpolations.items[value.interpolation_index];

    // The previous char added to buffer was the last char of variable name.
    // So end_brace (which we treat as end of token) is buffer.len - 1.
    if (value.buffer.length() > 0) {
        interpolation_item.end_brace = value.buffer.length() - 1;
        interpolation_item.variable_end = value.buffer.length() - 1;
    } else {
        // Should catch this
        interpolation_item.end_brace = 0;
        interpolation_item.variable_end = 0;
    }

    // No whitespace trimming for braceless variables as they can't contain spaces.
    const val_slice = value.value();

    // Extract variable name
    if (interpolation_item.variable_end >= interpolation_item.variable_start) {
        const len = (interpolation_item.variable_end - interpolation_item.variable_start) + 1;
        const start = interpolation_item.variable_start;

        if (start + len <= val_slice.len) {
            const var_name = val_slice[start .. start + len];
            try interpolation_item.setVariableStr(allocator, var_name);
        }
    }

    interpolation_item.closed = true;
    value.interpolation_index += 1;
}

/// After parsing completes, remove any interpolation that wasn't closed with `}`.
pub fn removeUnclosedInterpolation(value: *EnvValue) void {
    var i: usize = value.interpolations.items.len;
    while (i > 0) {
        i -= 1;
        // Check if closed without copying the struct
        if (!value.interpolations.items[i].closed) {
            var removed_item = value.interpolations.orderedRemove(i);
            removed_item.deinit();

            // If we remove one before interpolation_index, we should decrement index
            if (i < value.interpolation_index) {
                value.interpolation_index -= 1;
            }
        }
    }
}

test "positionOfDollarLastSign basic" {
    var val = EnvValue.init(std.testing.allocator);
    defer val.deinit();

    // Simulate content
    // "abc$ {"
    try val.buffer.appendSlice("abc$ ");
    // val.value_index is implied by buffer.len

    // We are at the position where '{' is encountered.
    // So buffer has "$ ". buffer.len is length.

    const pos = positionOfDollarLastSign(&val);
    try std.testing.expect(pos != null);
    try std.testing.expectEqual(@as(usize, 3), pos.?); // 0:a, 1:b, 2:c, 3:$
}

test "positionOfDollarLastSign with escape" {
    var val = EnvValue.init(std.testing.allocator);
    defer val.deinit();

    try val.buffer.appendSlice("abc\\$");

    const pos = positionOfDollarLastSign(&val);
    try std.testing.expect(pos == null);
}

test "open and close variable" {
    var val = EnvValue.init(std.testing.allocator);
    defer val.deinit();

    // Parsing "Hello ${name}"
    // 1. "Hello "
    try val.buffer.appendSlice("Hello ");

    // 2. "$"
    try val.buffer.append('$');

    // 3. "{" -> openVariable (called after adding)
    try val.buffer.append('{');

    try openVariable(&val);

    try std.testing.expect(val.is_parsing_variable);
    try std.testing.expectEqual(@as(usize, 1), val.interpolations.items.len);
    try std.testing.expectEqual(@as(usize, 6), val.interpolations.items[0].dollar_sign); // Hello_ is 6 chars. $ is at 6.

    // 4. "name"
    try val.buffer.appendSlice("name"); // We append name

    // 5. "}" -> closeVariable
    // closeVariable
    try val.buffer.append('}');

    try closeVariable(std.testing.allocator, &val);

    try std.testing.expect(!val.is_parsing_variable);
    const interp = val.interpolations.items[0];
    try std.testing.expect(interp.closed);
    try std.testing.expectEqualStrings("name", interp.variable_str);
}

const std = @import("std");
const EnvValue = @import("../data/env_value.zig").EnvValue;
const VariablePosition = @import("../data/variable_position.zig").VariablePosition;
const whitespace_utils = @import("../utils/whitespace_utils.zig");