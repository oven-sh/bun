const std = @import("std");
const EnvPair = @import("../data/env_pair.zig").EnvPair;
const FinalizeResult = @import("../data/read_result.zig").FinalizeResult;
const VariablePosition = @import("../data/variable_position.zig").VariablePosition;

const EnvPairList = @import("../data/env_pair_list.zig").EnvPairList;

pub const LookupFn = *const fn (context: ?*anyopaque, key: []const u8) ?[]const u8;

/// Finalizes all values in the provided list of pairs.
pub fn finalizeAllValues(allocator: std.mem.Allocator, pairs: *EnvPairList, lookup_fn: ?LookupFn, context: ?*anyopaque) !void {
    for (pairs.items) |*pair| {
        _ = try finalizeValue(allocator, pair, pairs, lookup_fn, context);
    }
}

/// Recursively finalizes a single value, resolving all variable interpolations.
pub fn finalizeValue(
    allocator: std.mem.Allocator,
    pair: *EnvPair,
    pairs: *EnvPairList,
    lookup_fn: ?LookupFn,
    context: ?*anyopaque,
) !FinalizeResult {
    if (pair.value.is_already_interpolated) {
        return .copied;
    }

    if (pair.value.is_being_interpolated) {
        return .circular;
    }

    if (pair.value.interpolations.items.len == 0) {
        pair.value.is_already_interpolated = true;
        return .copied;
    }

    pair.value.is_being_interpolated = true;
    defer pair.value.is_being_interpolated = false;

    var result_status = FinalizeResult.copied;
    var found_circular = false;

    // Process interpolations in REVERSE order to keep earlier positions valid
    var i: usize = pair.value.interpolations.items.len;
    while (i > 0) {
        i -= 1;
        const interp = pair.value.interpolations.items[i];

        const var_name = interp.variable_str;

        var replacement_opt: ?[]const u8 = null;

        // 1. Try internal lookup in currently being parsed pairs
        if (findPairByKey(pairs, var_name)) |referenced_pair| {
            // Recursively finalize the referenced value
            const res = try finalizeValue(allocator, referenced_pair, pairs, lookup_fn, context);

            if (res == .circular) {
                found_circular = true;
            } else {
                replacement_opt = referenced_pair.value.value();
            }
        }

        // 2. Try external lookup if internal failed (and not circular)
        if (replacement_opt == null and !found_circular and lookup_fn != null) {
            replacement_opt = lookup_fn.?(context, var_name);
        }

        // 3. Use default value if both lookups failed
        if (replacement_opt == null and !found_circular) {
            if (interp.default_value.len > 0) {
                replacement_opt = interp.default_value;
            }
        }

        if (replacement_opt) |replacement| {
            // Replace the interpolation with the value
            try replaceInterpolation(allocator, pair, i, replacement);
            result_status = .interpolated;
        }
        // If not found, we leave the ${var} as is, per requirements.
    }

    pair.value.is_already_interpolated = true;
    if (found_circular) return .circular;
    return if (result_status == .interpolated) .interpolated else .copied;
}

fn findPairByKey(pairs: *EnvPairList, key: []const u8) ?*EnvPair {
    for (pairs.items) |*pair| {
        if (std.mem.eql(u8, pair.key.key(), key)) {
            return pair;
        }
    }
    return null;
}

fn replaceInterpolation(allocator: std.mem.Allocator, pair: *EnvPair, interp_idx: usize, replacement: []const u8) !void {
    _ = allocator;
    const interp = pair.value.interpolations.items[interp_idx];

    const old_val = pair.value.value();
    const prefix = old_val[0..interp.dollar_sign];
    const suffix = old_val[interp.end_brace + 1 ..];

    const new_len = prefix.len + replacement.len + suffix.len;
    const value_allocator = pair.value.buffer.allocator;
    var new_buffer = try value_allocator.alloc(u8, new_len);
    errdefer value_allocator.free(new_buffer);

    @memcpy(new_buffer[0..prefix.len], prefix);
    @memcpy(new_buffer[prefix.len .. prefix.len + replacement.len], replacement);
    @memcpy(new_buffer[prefix.len + replacement.len ..], suffix);

    // Update the value's buffer
    pair.value.setOwnBuffer(new_buffer);

    // We don't need to update other interpolation positions because we process in reverse.
    var removed = pair.value.interpolations.orderedRemove(interp_idx);
    removed.deinit();
}

test "finalizeValue - basic substitution" {
    const allocator = std.testing.allocator;
    var pairs = EnvPairList.init(allocator);
    defer {
        pairs.deinit();
    }

    var p1 = EnvPair.init(allocator);
    // Use setOwnBuffer to populate
    const k1 = try allocator.dupe(u8, "VAR");
    p1.key.setOwnBuffer(k1);
    const v1 = try allocator.dupe(u8, "hello");
    p1.value.setOwnBuffer(v1);
    try pairs.append(p1);

    var p2 = EnvPair.init(allocator);
    const k2 = try allocator.dupe(u8, "REF");
    p2.key.setOwnBuffer(k2);
    const v2 = try allocator.dupe(u8, "${VAR} world");
    p2.value.setOwnBuffer(v2);

    var vp_ref = VariablePosition.init(0, 1, 0);
    vp_ref.end_brace = 5;
    try vp_ref.setVariableStr(allocator, "VAR");
    try p2.value.interpolations.append(vp_ref);
    try pairs.append(p2);

    const res = try finalizeValue(allocator, &pairs.items[1], &pairs, null, null);
    try std.testing.expect(res == .interpolated);
    try std.testing.expectEqualStrings("hello world", pairs.items[1].value.value());
}

test "finalizeValue - recursive substitution" {
    const allocator = std.testing.allocator;
    var pairs = EnvPairList.init(allocator);
    defer {
        pairs.deinit();
    }

    // A=${B}
    var p1 = EnvPair.init(allocator);
    p1.key.setOwnBuffer(try allocator.dupe(u8, "A"));
    p1.value.setOwnBuffer(try allocator.dupe(u8, "${B}"));
    var vp_a1 = VariablePosition.init(0, 1, 0);
    vp_a1.end_brace = 3;
    try vp_a1.setVariableStr(allocator, "B");
    try p1.value.interpolations.append(vp_a1);
    try pairs.append(p1);

    // B=${C}
    var p2 = EnvPair.init(allocator);
    p2.key.setOwnBuffer(try allocator.dupe(u8, "B"));
    p2.value.setOwnBuffer(try allocator.dupe(u8, "${C}"));
    var vp_b1 = VariablePosition.init(0, 1, 0);
    vp_b1.end_brace = 3;
    try vp_b1.setVariableStr(allocator, "C");
    try p2.value.interpolations.append(vp_b1);
    try pairs.append(p2);

    // C=final
    var p3 = EnvPair.init(allocator);
    p3.key.setOwnBuffer(try allocator.dupe(u8, "C"));
    p3.value.setOwnBuffer(try allocator.dupe(u8, "final"));
    try pairs.append(p3);

    const res = try finalizeValue(allocator, &pairs.items[0], &pairs, null, null);
    try std.testing.expect(res == .interpolated);
    try std.testing.expectEqualStrings("final", pairs.items[0].value.value());
    try std.testing.expectEqualStrings("final", pairs.items[1].value.value());
}

test "finalizeValue - circular dependency" {
    const allocator = std.testing.allocator;
    var pairs = EnvPairList.init(allocator);
    defer {
        pairs.deinit();
    }

    // A=${B}
    var p1 = EnvPair.init(allocator);
    p1.key.setOwnBuffer(try allocator.dupe(u8, "A"));
    p1.value.setOwnBuffer(try allocator.dupe(u8, "${B}"));
    var vp_a2 = VariablePosition.init(0, 1, 0);
    vp_a2.end_brace = 3;
    try vp_a2.setVariableStr(allocator, "B");
    try p1.value.interpolations.append(vp_a2);
    try pairs.append(p1);

    // B=${A}
    var p2 = EnvPair.init(allocator);
    p2.key.setOwnBuffer(try allocator.dupe(u8, "B"));
    p2.value.setOwnBuffer(try allocator.dupe(u8, "${A}"));
    var vp_b2 = VariablePosition.init(0, 1, 0);
    vp_b2.end_brace = 3;
    try vp_b2.setVariableStr(allocator, "A");
    try p2.value.interpolations.append(vp_b2);
    try pairs.append(p2);

    const res = try finalizeValue(allocator, &pairs.items[0], &pairs, null, null);
    // When circular, it should return circular and keep the original string
    try std.testing.expect(res == .circular);
    try std.testing.expectEqualStrings("${B}", pairs.items[0].value.value());
}

test "finalizeValue - missing variable" {
    const allocator = std.testing.allocator;
    var pairs = EnvPairList.init(allocator);
    defer {
        pairs.deinit();
    }

    var p1 = EnvPair.init(allocator);
    p1.key.setOwnBuffer(try allocator.dupe(u8, "A"));
    p1.value.setOwnBuffer(try allocator.dupe(u8, "${MISSING}"));
    var vp_missing = VariablePosition.init(0, 1, 0);
    vp_missing.end_brace = 9;
    try vp_missing.setVariableStr(allocator, "MISSING");
    try p1.value.interpolations.append(vp_missing);
    try pairs.append(p1);

    const res = try finalizeValue(allocator, &pairs.items[0], &pairs, null, null);
    try std.testing.expect(res == .copied);
    try std.testing.expectEqualStrings("${MISSING}", pairs.items[0].value.value());
}

test "finalizeValue - multiple interpolations in reverse order" {
    const allocator = std.testing.allocator;
    var pairs = EnvPairList.init(allocator);
    defer {
        pairs.deinit();
    }

    var p1 = EnvPair.init(allocator);
    p1.key.setOwnBuffer(try allocator.dupe(u8, "A"));
    p1.value.setOwnBuffer(try allocator.dupe(u8, "1"));
    try pairs.append(p1);

    var p2 = EnvPair.init(allocator);
    p2.key.setOwnBuffer(try allocator.dupe(u8, "B"));
    p2.value.setOwnBuffer(try allocator.dupe(u8, "2"));
    try pairs.append(p2);

    var p3 = EnvPair.init(allocator);
    p3.key.setOwnBuffer(try allocator.dupe(u8, "C"));
    p3.value.setOwnBuffer(try allocator.dupe(u8, "${A}${B}"));
    var vp_a = VariablePosition.init(0, 1, 0);
    vp_a.end_brace = 3;
    try vp_a.setVariableStr(allocator, "A");
    try p3.value.interpolations.append(vp_a); // ${A}
    var vp_b = VariablePosition.init(4, 5, 4);
    vp_b.end_brace = 7;
    try vp_b.setVariableStr(allocator, "B");
    try p3.value.interpolations.append(vp_b); // ${B}
    try pairs.append(p3);

    const res = try finalizeValue(allocator, &pairs.items[2], &pairs, null, null);
    try std.testing.expect(res == .interpolated);
    try std.testing.expectEqualStrings("12", pairs.items[2].value.value());
}
