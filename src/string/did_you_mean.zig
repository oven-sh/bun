const std = @import("std");
const bun = @import("bun");

/// Returns the index of the closest match in the haystack, or null if no match is found.
/// If the best match has a similarity score lower than the threshold, returns null.
///
/// This function uses Jaro-Winkler distance to find similar strings, which works well
/// for short strings like command names or identifiers.
pub fn didYouMean(
    haystack: []const []const u8,
    needle: []const u8,
) ?u32 {
    if (haystack.len == 0 or needle.len == 0) {
        return null;
    }

    // First check for exact matches
    for (haystack, 0..) |hay, i| {
        if (bun.strings.eql(hay, needle)) {
            return @intCast(i);
        }
    }

    var best_match_idx: u32 = 0;
    var best_similarity: f64 = 0.0;

    const threshold: f64 = 0.7;

    for (haystack, 0..) |hay, i| {
        // Skip empty strings in haystack
        if (hay.len == 0) continue;

        // Quick length check - if lengths differ too much, they're probably not similar
        const len_diff = if (hay.len > needle.len) hay.len - needle.len else needle.len - hay.len;
        if (len_diff > 3) continue;

        const similarity = jaroWinkler(hay, needle);
        if (similarity > best_similarity) {
            best_similarity = similarity;
            best_match_idx = @intCast(i);
        }
    }

    // If the best similarity is too low or no match was found
    if (best_similarity < threshold) {
        return null;
    }

    return best_match_idx;
}

/// Calculate the Jaro-Winkler similarity between two strings.
/// Returns a value between 0.0 (completely different) and 1.0 (identical).
fn jaroWinkler(s1: []const u8, s2: []const u8) f64 {
    // Handle edge cases
    if (s1.len == 0 and s2.len == 0) return 1.0;
    if (s1.len == 0 or s2.len == 0) return 0.0;
    if (bun.strings.eql(s1, s2)) return 1.0;
    if (s1.len > 256 or s2.len > 256) return 0.0;

    // Calculate match distance (half the length of the longer string)
    const match_distance = @max(s1.len, s2.len) / 2;

    // Count matching characters
    var matches: usize = 0;
    var transpositions: usize = 0;
    var s1_matched = bun.bit_set.ArrayBitSet(usize, 256).initEmpty();
    var s2_matched = bun.bit_set.ArrayBitSet(usize, 256).initEmpty();

    // Find matches
    for (s1, 0..) |c1, i| {
        const start: usize = if (i > match_distance) i - match_distance else 0;
        const end: usize = @min(i + match_distance + 1, s2.len);

        for (s2[start..end], start..) |c2, j| {
            if (!s2_matched.isSet(j) and c1 == c2) {
                s1_matched.set(i);
                s2_matched.set(j);
                matches += 1;
                break;
            }
        }
    }

    if (matches == 0) return 0.0;

    // Count transpositions
    var j: usize = 0;
    for (s1, 0..) |_, i| {
        if (s1_matched.isSet(i)) {
            while (!s2_matched.isSet(j)) j += 1;
            if (s1[i] != s2[j]) transpositions += 1;
            j += 1;
        }
    }

    // Calculate Jaro similarity
    const m = @as(f64, @floatFromInt(matches));
    const t = @as(f64, @floatFromInt(transpositions)) / 2.0;
    const jaro_similarity = (m / @as(f64, @floatFromInt(s1.len)) +
        m / @as(f64, @floatFromInt(s2.len)) +
        (m - t) / m) / 3.0;

    // Calculate Jaro-Winkler similarity
    // Find length of common prefix (up to 4 characters)
    var prefix_len: usize = 0;
    const max_prefix = @min(4, @min(s1.len, s2.len));
    while (prefix_len < max_prefix and s1[prefix_len] == s2[prefix_len]) {
        prefix_len += 1;
    }

    // Winkler's scaling factor - how much to boost score based on prefix
    const scaling_factor = 0.1;

    // Calculate final Jaro-Winkler similarity
    return jaro_similarity + @as(f64, @floatFromInt(prefix_len)) * scaling_factor * (1.0 - jaro_similarity);
}
