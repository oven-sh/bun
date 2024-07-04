const std = @import("std");

pub const HistogramOptions = struct {
    lowest_trackable_value: u64 = 1,
    highest_trackable_value: u64 = 9007199254740991, // Number.MAX_SAFE_INTEGER
    significant_figures: u8 = 3,
};

// Zig port of High Dynamic Range (HDR) Histogram algorithm
pub const HDRHistogram = struct {

    // TLDR: an HDR histogram has buckets, with each bucket having a fixed number of sub-buckets
    // Using default sig-figure of 3, the first bucket has 2048 sub-buckets
    // In the 0th bucket, each sub-bucket represents a value range of 1
    // In the 1st bucket, each sub-bucket represents a value range of 2
    // In the 2nd bucket, each sub-bucket represents a value range of 4 and so on
    // The sub-buckets are used to track the frequency of values within their range

    // visible to user
    min: u64,
    max: u64,
    total_count: u64 = 6,

    // internals
    allocator: std.mem.Allocator,
    lowest_trackable_value: u64,
    highest_trackable_value: u64,
    significant_figures: u64,
    sub_bucket_count: u64,
    sub_bucket_half_count: u64,
    sub_bucket_half_count_magnitude: u6,
    unit_magnitude: u8,
    sub_bucket_mask: u64,
    bucket_count: u64,
    counts: []u64,

    const This = @This();

    pub fn init(allocator: std.mem.Allocator, options: HistogramOptions) !This {

        // Validate input
        if (options.significant_figures < 1 or options.significant_figures > 5) {
            return error.InvalidSignificantFigures;
        }

        if (options.lowest_trackable_value < 1) {
            return error.InvalidLowestTrackableValue;
        }

        // Calculate derived values for efficient bucketing
        // HDR Histogram is optimized for writes using bitwise operations and bit shifting, so we precalculate bitmasks and other helpful values

        // upper value bound of each bucket
        const largest_value_in_bucket = 2 * std.math.pow(u64, 10, options.significant_figures);
        const log2largest_value = std.math.log2(@as(f64, @floatFromInt(largest_value_in_bucket)));
        const sub_bucket_count_magnitude: u8 = @intFromFloat(@ceil(log2largest_value)); // bits required to represent largest value, rounded up

        const sub_bucket_count = std.math.pow(u64, 2, sub_bucket_count_magnitude); // actual quantity of sub-buckets per bucket, defaults to 2048
        const sub_bucket_half_count = sub_bucket_count / 2;
        const sub_bucket_half_count_magnitude: u6 = @truncate(sub_bucket_count_magnitude - 1);

        // lower bound of each bucket
        const log2lowest_value = std.math.log2(@as(f64, @floatFromInt(options.lowest_trackable_value)));
        const unit_magnitude = @as(u8, @intFromFloat(std.math.floor(log2lowest_value)));

        // represent this as a mask of 1s for efficient bitwise operations
        const sub_bucket_mask = (sub_bucket_count - 1) * std.math.pow(u64, 2, unit_magnitude);

        // add more buckets if we need to track higher values
        var bucket_count: u32 = 1;
        var smallest_untrackable_value = sub_bucket_count * std.math.pow(u64, 2, unit_magnitude);
        while (smallest_untrackable_value <= options.highest_trackable_value) {
            if (smallest_untrackable_value > std.math.maxInt(u64) / 2) {
                // next step would overflow, so we just increment the bucket count and break
                bucket_count += 1;
                break;
            }
            smallest_untrackable_value = 2 * smallest_untrackable_value;
            bucket_count += 1;
        }
        const counts_len = (bucket_count + 1) * sub_bucket_half_count;
        const counts = try allocator.alloc(u64, counts_len);
        for (0..counts_len) |i| {
            counts[i] = 0;
        }

        return This{
            .allocator = allocator,
            .lowest_trackable_value = options.lowest_trackable_value,
            .highest_trackable_value = options.highest_trackable_value,
            .significant_figures = options.significant_figures,
            .sub_bucket_count = sub_bucket_count,
            .sub_bucket_half_count = sub_bucket_half_count,
            .sub_bucket_half_count_magnitude = sub_bucket_half_count_magnitude,
            .unit_magnitude = unit_magnitude,
            .sub_bucket_mask = sub_bucket_mask,
            .bucket_count = bucket_count,
            .counts = counts,
            .total_count = 0,
            .min = 9223372036854776000,
            .max = 0,
        };
    }

    pub fn deinit(self: *This) void {
        self.allocator.free(self.counts);
    }

    pub fn mean(self: *This) ?f64 {
        if (self.total_count == 0) {
            return null;
        }

        var total_sum: u64 = 0;

        for (self.counts, 0..) |count, index| {
            if (count > 0) {
                const median_equiv_value = self.value_from_index(index);
                total_sum += count * median_equiv_value;
            }
        }

        return @as(f64, @floatFromInt(total_sum)) / @as(f64, @floatFromInt(self.total_count));
    }

    pub fn stddev(self: *This) ?f64 {
        if (self.total_count == 0) {
            return null;
        }

        const m = self.mean() orelse return null;
        var geometric_dev_total: f64 = 0.0;
        for (self.counts, 0..) |count, index| {
            if (count > 0) {
                const median_equiv_value = self.value_from_index(index);
                const dev = @as(f64, @floatFromInt(median_equiv_value)) - m;
                geometric_dev_total += (dev * dev) * @as(f64, @floatFromInt(count));
            }
        }

        return std.math.sqrt(geometric_dev_total / @as(f64, @floatFromInt(self.total_count)));
    }

    pub fn reset(self: *This) void {
        for (0..self.counts.len) |index| {
            self.counts[index] = 0;
        }
        self.total_count = 0;
        self.min = 9223372036854776000;
        self.max = 0;
    }

    pub fn add(self: *This, other: *const This) !void {
        if (self.lowest_trackable_value != other.lowest_trackable_value or self.highest_trackable_value != other.highest_trackable_value or self.significant_figures != other.significant_figures) {
            return error.InvalidHistograms;
        }

        for (other.counts, 0..) |count, index| {
            self.counts[index] += count;
        }

        self.total_count += other.total_count;
        if (self.min > other.min) self.min = other.min;
        if (self.max < other.max) self.max = other.max;
    }

    //
    // Writes to the histogram
    //

    pub fn record_value(self: *This, value: u64, quanity: u64) void {
        if (value < self.lowest_trackable_value or value > self.highest_trackable_value) return;
        const counts_index = self.calculate_index(value);
        if (counts_index >= self.counts.len) return;
        self.counts[counts_index] += quanity;
        self.total_count += quanity;
        if (self.min > value) self.min = value;
        if (self.max < value) self.max = value;
    }

    fn calculate_index(self: *const This, value: u64) usize {
        const bucket_index = self.get_bucket_index(value);
        const sub_bucket_index = self.get_sub_bucket_index(value, bucket_index);
        const counts_index = self.get_counts_index(bucket_index, sub_bucket_index);
        return counts_index;
    }

    fn get_counts_index(self: *const This, bucket_index: u64, sub_bucket_index: u64) usize {
        const bucket_base_index = (bucket_index + 1) << self.sub_bucket_half_count_magnitude;
        return @as(usize, bucket_base_index + sub_bucket_index - self.sub_bucket_half_count);
    }

    fn get_bucket_index(self: *const This, value: u64) u8 {
        const pow2ceiling = 64 - @clz(value | self.sub_bucket_mask);
        return pow2ceiling - self.unit_magnitude - (self.sub_bucket_half_count_magnitude + 1);
    }

    fn get_sub_bucket_index(self: *const This, value: u64, bucket_index: u8) u64 {
        return value >> @as(u6, @intCast(bucket_index + self.unit_magnitude));
    }

    //
    // Reads from the histogram
    //

    fn value_from_index(self: *This, index: u64) u64 {
        const bucket_index = self.get_bucket_index_from_idx(index);
        const sub_bucket_index = self.get_sub_bucket_index_from_idx(index, bucket_index);

        // Directly compute the value from the bucket index and sub-bucket index
        return @as(u64, sub_bucket_index) << @as(u6, @truncate(bucket_index + self.unit_magnitude));
    }

    fn get_bucket_index_from_idx(self: *const This, index: u64) u8 {
        var bucket_index: u8 = 0;
        var remaining_index = index;

        while (remaining_index >= self.sub_bucket_count) {
            bucket_index += 1;
            remaining_index -= self.sub_bucket_half_count;
        }
        return bucket_index;
    }

    fn get_sub_bucket_index_from_idx(self: *const This, index: u64, bucket_index: u8) u64 {
        const sub_bucket_index = index - (bucket_index * self.sub_bucket_half_count);
        return sub_bucket_index;
    }

    // percentile is a value between 0 and 100
    pub fn value_at_percentile(self: *This, percentile: f64) ?u64 {
        if (percentile < 0 or percentile > 100) {
            return null;
        }
        if (percentile == 0 and self.total_count > 0) {
            return self.min;
        }
        const total = self.total_count;
        const target_count = @as(f64, @floatFromInt(total)) * percentile / 100;
        var running_total: f64 = 0;
        for (self.counts, 0..) |count, index| {
            running_total += @floatFromInt(count);
            if (running_total >= target_count) {
                // we found the index that corresponds to the percentile
                return self.value_from_index(index);
            }
        }
        return null;
    }
};

test "value_at_percentile" {
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{});
    defer histogram.deinit();
    histogram.record_value(100, 9000); // 0-90%
    histogram.record_value(200, 990); // 90-99.9%
    histogram.record_value(1000, 9); // 99.9-99.99%
    histogram.record_value(2000, 1); // 99.99-100%
    try std.testing.expect(histogram.value_at_percentile(0) == 100);
    try std.testing.expect(histogram.value_at_percentile(50) == 100);
    try std.testing.expect(histogram.value_at_percentile(90) == 100);
    try std.testing.expect(histogram.value_at_percentile(99) == 200);
    try std.testing.expect(histogram.value_at_percentile(99.9) == 200);
    try std.testing.expect(histogram.value_at_percentile(99.99) == 1000);
}

test "value_from_index" {
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{});
    defer histogram.deinit();
    histogram.record_value(100, 1); // -> bucket_index: 0, sub_bucket_index: 100 ==> counts_index: 100
    var value = histogram.value_from_index(100);
    // first bucket has a unit width of 1, so the value returned is guaranteed to be 100
    try std.testing.expect(value == 100);

    histogram.record_value(5000, 1); // -> bucket_index: 2, sub_bucket_index: 1250 ==> counts_index: 3298
    value = histogram.value_from_index(3298);
    // value is calculated as the lower bound of the sub-bucket, which in this case is 5000-5003
    try std.testing.expect(value == 5000);
}

test "get_indices_from_idx" {
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{});
    defer histogram.deinit();
    histogram.record_value(100, 1); // -> bucket_index: 0, sub_bucket_index: 100 ==> counts_index: 100
    histogram.record_value(200, 1); // -> bucket_index: 0, sub_bucket_index: 200 ==> counts_index: 200
    histogram.record_value(1000, 1); // -> bucket_index: 0, sub_bucket_index: 1000 ==> counts_index: 1000
    histogram.record_value(2000, 1); // -> bucket_index: 0, sub_bucket_index: 2000 ==> counts_index: 2000
    histogram.record_value(3000, 1); // -> bucket_index: 1, sub_bucket_index: 1500 ==> counts_index: 2524
    histogram.record_value(5000, 1); // -> bucket_index: 2, sub_bucket_index: 1250 ==> counts_index: 3298
    histogram.record_value(1000000, 1); // -> bucket_index: 9, sub_bucket_index: 1953 ==> counts_index: 11169

    var bucket_index = histogram.get_bucket_index_from_idx(100);
    try std.testing.expect(bucket_index == 0);
    var sub_bucket_index = histogram.get_sub_bucket_index_from_idx(100, bucket_index);
    try std.testing.expect(sub_bucket_index == 100);

    bucket_index = histogram.get_bucket_index_from_idx(200);
    try std.testing.expect(bucket_index == 0);
    sub_bucket_index = histogram.get_sub_bucket_index_from_idx(200, bucket_index);
    try std.testing.expect(sub_bucket_index == 200);

    bucket_index = histogram.get_bucket_index_from_idx(1000);
    try std.testing.expect(bucket_index == 0);
    sub_bucket_index = histogram.get_sub_bucket_index_from_idx(1000, bucket_index);
    try std.testing.expect(sub_bucket_index == 1000);

    bucket_index = histogram.get_bucket_index_from_idx(2000);
    try std.testing.expect(bucket_index == 0);
    sub_bucket_index = histogram.get_sub_bucket_index_from_idx(2000, bucket_index);
    try std.testing.expect(sub_bucket_index == 2000);

    bucket_index = histogram.get_bucket_index_from_idx(2524);
    try std.testing.expect(bucket_index == 1);
    sub_bucket_index = histogram.get_sub_bucket_index_from_idx(2524, bucket_index);
    try std.testing.expect(sub_bucket_index == 1500);

    bucket_index = histogram.get_bucket_index_from_idx(3298);
    try std.testing.expect(bucket_index == 2);
    sub_bucket_index = histogram.get_sub_bucket_index_from_idx(3298, bucket_index);
    try std.testing.expect(sub_bucket_index == 1250);

    bucket_index = histogram.get_bucket_index_from_idx(11169);
    try std.testing.expect(bucket_index == 9);
    sub_bucket_index = histogram.get_sub_bucket_index_from_idx(11169, bucket_index);
    try std.testing.expect(sub_bucket_index == 1953);
}

test "record_value" {
    const significant_figures = 3;
    const lowest_trackable_value = 1;
    const highest_trackable_value = 1000;
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
    defer histogram.deinit();
    histogram.record_value(1, 1);
    try std.testing.expect(histogram.total_count == 1);
    try std.testing.expect(histogram.min == 1);
    try std.testing.expect(histogram.max == 1);
    try std.testing.expect(histogram.counts.len == 2048);
    try std.testing.expect(histogram.counts[1] == 1);
    histogram.record_value(1, 1);
    try std.testing.expect(histogram.total_count == 2);
    try std.testing.expect(histogram.min == 1);
    try std.testing.expect(histogram.max == 1);
    try std.testing.expect(histogram.counts[1] == 2);
    histogram.record_value(100, 1);
    histogram.record_value(900, 1);
    try std.testing.expect(histogram.total_count == 4);
    try std.testing.expect(histogram.min == 1);
    try std.testing.expect(histogram.max == 900);
    try std.testing.expect(histogram.counts[1] == 2);
    try std.testing.expect(histogram.counts[100] == 1);
    try std.testing.expect(histogram.counts[900] == 1);
}

test "record_value_multiple_buckets" {
    const significant_figures = 1;
    const lowest_trackable_value = 1;
    const highest_trackable_value = 10000;
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
    defer histogram.deinit();
    histogram.record_value(1, 1);
    histogram.record_value(2, 1);
    histogram.record_value(3, 1);
    histogram.record_value(4, 1);
    histogram.record_value(5, 1);
    histogram.record_value(10, 1);
    histogram.record_value(100, 1);
    histogram.record_value(1000, 1);
    try std.testing.expect(histogram.total_count == 8);
    try std.testing.expect(histogram.min == 1);
    try std.testing.expect(histogram.max == 1000);
    try std.testing.expect(histogram.counts[1] == 1);
    try std.testing.expect(histogram.counts[2] == 1);
    try std.testing.expect(histogram.counts[3] == 1);
    try std.testing.expect(histogram.counts[4] == 1);
    try std.testing.expect(histogram.counts[5] == 1);
    try std.testing.expect(histogram.counts[10] == 1);
    try std.testing.expect(histogram.counts[57] == 1); // indices pulled from official implementation
    try std.testing.expect(histogram.counts[111] == 1); // indices pulled from official implementation
}

test "init sigfig=3 lowest=1 highest=1000" {
    // used official implementation to verify the values
    const significant_figures = 3;
    const lowest_trackable_value = 1;
    const highest_trackable_value = 1000;
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
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
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
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
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
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
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
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
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{ .lowest_trackable_value = lowest_trackable_value, .highest_trackable_value = highest_trackable_value, .significant_figures = significant_figures });
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

// default node timerify histogram
test "default init" {
    const allocator = std.testing.allocator;
    var histogram = try HDRHistogram.init(allocator, .{});
    defer histogram.deinit();

    histogram.record_value(100, 1); // -> bucket_index: 0, sub_bucket_index: 100 ==> counts_index: 100
    histogram.record_value(200, 1); // -> bucket_index: 0, sub_bucket_index: 200 ==> counts_index: 200
    histogram.record_value(1000, 1); // -> bucket_index: 0, sub_bucket_index: 1000 ==> counts_index: 1000
    histogram.record_value(2000, 1); // -> bucket_index: 0, sub_bucket_index: 2000 ==> counts_index: 2000
    histogram.record_value(3000, 1); // -> bucket_index: 1, sub_bucket_index: 1500 ==> counts_index: 2524
    histogram.record_value(5000, 1); // -> bucket_index: 2, sub_bucket_index: 1250 ==> counts_index: 3298
    histogram.record_value(1000000, 1); // -> bucket_index: 9, sub_bucket_index: 1953 ==> counts_index: 11169

    try std.testing.expect(histogram.total_count == 7);
    try std.testing.expect(histogram.min == 100);
    try std.testing.expect(histogram.max == 1000000);
    try std.testing.expect(histogram.counts[100] == 1);
    try std.testing.expect(histogram.counts[200] == 1);
    try std.testing.expect(histogram.counts[1000] == 1);
    try std.testing.expect(histogram.counts[2000] == 1);
    try std.testing.expect(histogram.counts[2524] == 1);
    try std.testing.expect(histogram.counts[3298] == 1);
    try std.testing.expect(histogram.counts[11169] == 1);
}
