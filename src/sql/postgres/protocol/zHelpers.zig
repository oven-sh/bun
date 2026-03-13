pub fn zCount(slice: []const u8) usize {
    return if (slice.len > 0) slice.len + 1 else 0;
}

pub fn zFieldCount(prefix: []const u8, slice: []const u8) usize {
    if (slice.len > 0) {
        return zCount(prefix) + zCount(slice);
    }

    return zCount(prefix);
}
