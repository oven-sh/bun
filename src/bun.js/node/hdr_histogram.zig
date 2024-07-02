const std = @import("std");

// Zig port of High Dynamic Range (HDR) Histogram algorithm
// Only supports recording values for now
pub const RecordableHistogram = struct {
    allocator: *std.mem.Allocator,
    lowest_trackable_value: u64,
    highest_trackable_value: u64,
    significant_figures: u64,
    sub_bucket_count: u64,
    sub_bucket_half_count: u64,
    unit_magnitude: u64,
    sub_bucket_mask: u64,
    bucket_count: u64,
    counts: []u64,
    total_count: u64,
    min_value: u64,
    max_value: u64,

    pub fn deinit(self: *RecordableHistogram) void {
        self.allocator.free(self.counts);
    }

    pub fn init(
        allocator: *std.mem.Allocator,
        lowest_trackable_value: u64,
        highest_trackable_value: u64,
        significant_figures: u32,
    ) !RecordableHistogram {
        // Validate input
        if (significant_figures < 1 or significant_figures > 5) {
            return error.InvalidSignificantFigures;
        }

        // Calculate derived values for efficient bucketing
        const largest_value_with_single_unit_resolution = 2 * std.math.pow(u64, 10, significant_figures);
        const sub_bucket_count_magnitude: u32 = @intFromFloat(@ceil(std.math.log2(@as(f64, @floatFromInt(largest_value_with_single_unit_resolution)))));
        const sub_bucket_count = std.math.pow(u64, 2, sub_bucket_count_magnitude);
        const sub_bucket_half_count = sub_bucket_count / 2;
        const unit_magnitude = @as(u64, @intFromFloat(std.math.floor(std.math.log2(@as(f64, @floatFromInt(lowest_trackable_value))))));
        const sub_bucket_mask = (sub_bucket_count - 1) * std.math.pow(u64, 2, unit_magnitude);
        var smallest_untrackable_value = sub_bucket_count * std.math.pow(u64, 2, unit_magnitude);
        var bucket_count: u32 = 1;
        while (smallest_untrackable_value <= highest_trackable_value) {
            if (smallest_untrackable_value > std.math.maxInt(u64) / 2) {
                // next step would overflow, so we just increment the bucket count and break
                bucket_count += 1;
                break;
            }
            smallest_untrackable_value = 2 * smallest_untrackable_value;
            bucket_count += 1;
        }
        const counts_len = (bucket_count + 1) * sub_bucket_half_count;
        return RecordableHistogram{
            .allocator = allocator,
            .lowest_trackable_value = lowest_trackable_value,
            .highest_trackable_value = highest_trackable_value,
            .significant_figures = significant_figures,
            .sub_bucket_count = sub_bucket_count,
            .sub_bucket_half_count = sub_bucket_half_count,
            .unit_magnitude = unit_magnitude,
            .sub_bucket_mask = sub_bucket_mask,
            .bucket_count = bucket_count,
            .counts = try allocator.alloc(u64, counts_len),
            .total_count = 0,
            .min_value = std.math.maxInt(u64),
            .max_value = 0,
        };
    }

    pub fn record_value(self: *RecordableHistogram, value: u64, count: u64) void {
        if (value < self.lowest_trackable_value or value > self.highest_trackable_value) return;

        const counts_index = self.calculate_index(value);
        if (counts_index >= self.counts.len) return;
        self.counts[counts_index] += count;
        self.total_count += count;
        self.min_value = std.math.min(self.min_value, value);
        self.max_value = std.math.max(self.max_value, value);
    }

    fn calculate_index(self: *const RecordableHistogram, value: u64) usize {
        const bucket_index = self.get_bucket_index(value);
        const sub_bucket_index = self.get_sub_bucket_index(value, bucket_index);
        return self.get_counts_index(bucket_index, sub_bucket_index);
    }

    fn get_bucket_index(self: *const RecordableHistogram, value: u64) u64 {
        const pow2ceiling = 64 - @clz(value | self.sub_bucket_mask);
        return pow2ceiling - self.unit_magnitude - (@as(u64, @intFromFloat(std.math.ceil(std.math.log2(@as(f64, @floatFromInt(self.sub_bucket_half_count)))) + 1)));
    }

    fn get_sub_bucket_index(self: *const RecordableHistogram, value: u64, bucket_index: u64) u64 {
        return value >> (bucket_index + self.unit_magnitude);
    }

    fn get_counts_index(self: *const RecordableHistogram, bucket_index: u64, sub_bucket_index: u64) usize {
        const bucket_base_index = (bucket_index + 1) << @as(u64, @intFromFloat(std.math.ceil(@as(f64, @floatFromInt(self.sub_bucket_half_count)))));
        const offset_in_bucket = sub_bucket_index - self.sub_bucket_half_count;
        return @as(usize, bucket_base_index + offset_in_bucket);
    }
};

test "init sigfig=3 lowest=1 highest=1000" {
    // used official implementation to verify the values
    const significant_figures = 3;
    const lowest_trackable_value = 1;
    const highest_trackable_value = 1000;
    var allocator = std.testing.allocator;
    var histogram = try RecordableHistogram.init(&allocator, lowest_trackable_value, highest_trackable_value, significant_figures);
    defer histogram.deinit();
    try std.testing.expect(histogram.lowest_trackable_value == lowest_trackable_value);
    try std.testing.expect(histogram.highest_trackable_value == highest_trackable_value);
    try std.testing.expect(histogram.significant_figures == significant_figures);
    try std.testing.expect(histogram.sub_bucket_count == 2048);
    try std.testing.expect(histogram.sub_bucket_half_count == 1024);
    try std.testing.expect(histogram.unit_magnitude == 0);
    try std.testing.expect(histogram.sub_bucket_mask == 2047);
    try std.testing.expect(histogram.bucket_count == 1);
    try std.testing.expect(histogram.counts.len == 2048);
}

test "init sigfig=3 lowest=1 highest=10_000" {
    const significant_figures = 3;
    const lowest_trackable_value = 1;
    const highest_trackable_value = 10_000;
    var allocator = std.testing.allocator;
    var histogram = try RecordableHistogram.init(&allocator, lowest_trackable_value, highest_trackable_value, significant_figures);
    defer histogram.deinit();
    try std.testing.expect(histogram.lowest_trackable_value == lowest_trackable_value);
    try std.testing.expect(histogram.highest_trackable_value == highest_trackable_value);
    try std.testing.expect(histogram.significant_figures == significant_figures);
    try std.testing.expect(histogram.sub_bucket_count == 2048);
    try std.testing.expect(histogram.sub_bucket_half_count == 1024);
    try std.testing.expect(histogram.unit_magnitude == 0);
    try std.testing.expect(histogram.sub_bucket_mask == 2047);
    try std.testing.expect(histogram.bucket_count == 4);
    try std.testing.expect(histogram.counts.len == 5120);
}

test "init sigfig=4 lowest=1 highest=10_000" {
    const significant_figures = 4;
    const lowest_trackable_value = 1;
    const highest_trackable_value = 10_000;
    var allocator = std.testing.allocator;
    var histogram = try RecordableHistogram.init(&allocator, lowest_trackable_value, highest_trackable_value, significant_figures);
    defer histogram.deinit();
    //&{lowestDiscernibleValue:1 highestTrackableValue:10000 unitMagnitude:0 significantFigures:4 subBucketHalfCountMagnitude:14 subBucketHalfCount:16384 subBucketMask:32767 subBucketCount:32768 bucketCount:1 countsLen:32768 totalCount:0 counts
    try std.testing.expect(histogram.lowest_trackable_value == lowest_trackable_value);
    try std.testing.expect(histogram.highest_trackable_value == highest_trackable_value);
    try std.testing.expect(histogram.significant_figures == significant_figures);
    try std.testing.expect(histogram.sub_bucket_count == 32768);
    try std.testing.expect(histogram.sub_bucket_half_count == 16384);
    try std.testing.expect(histogram.unit_magnitude == 0);
    try std.testing.expect(histogram.sub_bucket_mask == 32767);
    try std.testing.expect(histogram.bucket_count == 1);
    try std.testing.expect(histogram.counts.len == 32768);
}

test "init sigfig=4 lowest=5 highest=1000" {
    const significant_figures = 4;
    const lowest_trackable_value = 5;
    const highest_trackable_value = 1000;
    var allocator = std.testing.allocator;
    var histogram = try RecordableHistogram.init(&allocator, lowest_trackable_value, highest_trackable_value, significant_figures);
    defer histogram.deinit();
    try std.testing.expect(histogram.lowest_trackable_value == lowest_trackable_value);
    try std.testing.expect(histogram.highest_trackable_value == highest_trackable_value);
    try std.testing.expect(histogram.significant_figures == significant_figures);
    try std.testing.expect(histogram.sub_bucket_count == 32768);
    try std.testing.expect(histogram.sub_bucket_half_count == 16384);
    try std.testing.expect(histogram.unit_magnitude == 2);
    try std.testing.expect(histogram.sub_bucket_mask == 131068);
    try std.testing.expect(histogram.bucket_count == 1);
    try std.testing.expect(histogram.counts.len == 32768);
}

test "init sigfig=5 lowest=10 highest=200" {
    const significant_figures = 5;
    const lowest_trackable_value = 10;
    const highest_trackable_value = 200;
    var allocator = std.testing.allocator;
    var histogram = try RecordableHistogram.init(&allocator, lowest_trackable_value, highest_trackable_value, significant_figures);
    defer histogram.deinit();
    try std.testing.expect(histogram.lowest_trackable_value == lowest_trackable_value);
    try std.testing.expect(histogram.highest_trackable_value == highest_trackable_value);
    try std.testing.expect(histogram.significant_figures == significant_figures);
    try std.testing.expect(histogram.sub_bucket_count == 262144);
    try std.testing.expect(histogram.sub_bucket_half_count == 131072);
    try std.testing.expect(histogram.unit_magnitude == 3);
    try std.testing.expect(histogram.sub_bucket_mask == 2097144);
    try std.testing.expect(histogram.bucket_count == 1);
    try std.testing.expect(histogram.counts.len == 262144);
}
