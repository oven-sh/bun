const std = @import("std");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;

pub const JobStatus = enum {
    created,
    waiting,
    active,
    completed,
    failed,
    delayed,
    stalled,

    pub fn toString(self: @This()) []const u8 {
        return switch (self) {
            .created => "created",
            .waiting => "waiting",
            .active => "active",
            .completed => "completed",
            .failed => "failed",
            .delayed => "delayed",
            .stalled => "stalled",
        };
    }
};

pub const BackoffStrategy = enum {
    immediate,
    fixed,
    exponential,
    linear,

    pub fn toString(self: @This()) []const u8 {
        return switch (self) {
            .immediate => "immediate",
            .fixed => "fixed",
            .exponential => "exponential",
            .linear => "linear",
        };
    }
};

pub const BackoffOptions = struct {
    strategy: BackoffStrategy = .immediate,
    delay: u64 = 0,
};

pub const JobOptions = struct {
    timestamp: i64 = 0,
    retries: u32 = 0,
    delay: ?i64 = null,
    timeout: ?u64 = null,
    backoff: ?BackoffOptions = null,
    stacktraces: ArrayList([]const u8),

    const Self = @This();

    pub fn init(allocator: Allocator) Self {
        return Self{
            .stacktraces = ArrayList([]const u8).init(allocator),
        };
    }

    pub fn deinit(self: *Self, allocator: Allocator) void {
        for (self.stacktraces.items) |trace| {
            allocator.free(trace);
        }
        self.stacktraces.deinit();
    }

    pub fn clone(self: *const Self, allocator: Allocator) !Self {
        var new_options = Self.init(allocator);
        new_options.timestamp = self.timestamp;
        new_options.retries = self.retries;
        new_options.delay = self.delay;
        new_options.timeout = self.timeout;
        new_options.backoff = self.backoff;

        for (self.stacktraces.items) |trace| {
            const cloned_trace = try allocator.dupe(u8, trace);
            try new_options.stacktraces.append(cloned_trace);
        }

        return new_options;
    }

    pub fn addStacktrace(self: *Self, allocator: Allocator, trace: []const u8) !void {
        const cloned_trace = try allocator.dupe(u8, trace);
        try self.stacktraces.insert(0, cloned_trace);
    }
};

pub const JobData = struct {
    data: []const u8,
    options: JobOptions,
    status: JobStatus,
    progress: f64,

    const Self = @This();

    pub fn init(allocator: Allocator, data: []const u8) !Self {
        return Self{
            .data = try allocator.dupe(u8, data),
            .options = JobOptions.init(allocator),
            .status = .created,
            .progress = 0.0,
        };
    }

    pub fn deinit(self: *Self, allocator: Allocator) void {
        allocator.free(self.data);
        self.options.deinit(allocator);
    }

    pub fn toJson(self: *const Self, allocator: Allocator) ![]const u8 {
        var json_obj = std.json.ObjectMap.init(allocator);
        defer json_obj.deinit();

        const data_value = std.json.Value{ .string = self.data };
        try json_obj.put("data", data_value);

        const status_value = std.json.Value{ .string = self.status.toString() };
        try json_obj.put("status", status_value);

        const progress_value = std.json.Value{ .float = self.progress };
        try json_obj.put("progress", progress_value);

        var options_obj = std.json.ObjectMap.init(allocator);
        defer options_obj.deinit();

        const timestamp_value = std.json.Value{ .integer = self.options.timestamp };
        try options_obj.put("timestamp", timestamp_value);

        const retries_value = std.json.Value{ .integer = @intCast(self.options.retries) };
        try options_obj.put("retries", retries_value);

        if (self.options.delay) |delay| {
            const delay_value = std.json.Value{ .integer = delay };
            try options_obj.put("delay", delay_value);
        }

        if (self.options.timeout) |timeout| {
            const timeout_value = std.json.Value{ .integer = @intCast(timeout) };
            try options_obj.put("timeout", timeout_value);
        }

        var stacktraces_array = std.json.Array.init(allocator);
        defer stacktraces_array.deinit();

        for (self.options.stacktraces.items) |trace| {
            const trace_value = std.json.Value{ .string = trace };
            try stacktraces_array.append(trace_value);
        }

        const stacktraces_value = std.json.Value{ .array = stacktraces_array };
        try options_obj.put("stacktraces", stacktraces_value);

        const options_value = std.json.Value{ .object = options_obj };
        try json_obj.put("options", options_value);

        const json_value = std.json.Value{ .object = json_obj };
        return try std.json.stringifyAlloc(allocator, json_value, .{});
    }
};

pub const Job = struct {
    id: ?u64,
    name: []const u8,
    data: []const u8,
    status: JobStatus,
    progress: f64,
    options: JobOptions,
    allocator: Allocator,

    const Self = @This();

    pub fn init(allocator: Allocator, name: []const u8, data: []const u8, options: ?JobOptions) !Self {
        const now = std.time.milliTimestamp();
        var job_options = options orelse JobOptions.init(allocator);

        if (job_options.timestamp == 0) {
            job_options.timestamp = now;
        }

        return Self{
            .id = null,
            .name = try allocator.dupe(u8, name),
            .data = try allocator.dupe(u8, data),
            .status = .created,
            .progress = 0.0,
            .options = job_options,
            .allocator = allocator,
        };
    }

    pub fn fromData(allocator: Allocator, id: u64, name: []const u8, job_data: JobData) !Self {
        const job = Self{
            .id = id,
            .name = try allocator.dupe(u8, name),
            .data = try allocator.dupe(u8, job_data.data),
            .status = job_data.status,
            .progress = job_data.progress,
            .options = try job_data.options.clone(allocator),
            .allocator = allocator,
        };
        return job;
    }

    pub fn deinit(self: *Self) void {
        self.allocator.free(self.name);
        self.allocator.free(self.data);
        self.options.deinit(self.allocator);
    }

    pub fn setId(self: *Self, id: u64) *Self {
        self.id = id;
        return self;
    }

    pub fn retries(self: *Self, n: u32) !*Self {
        if (n < 0) {
            return error.NegativeRetries;
        }
        self.options.retries = n;
        return self;
    }

    pub fn delayUntil(self: *Self, timestamp: i64) !*Self {
        if (timestamp < 0) {
            return error.InvalidDelayTimestamp;
        }

        if (timestamp > std.time.milliTimestamp()) {
            self.options.delay = timestamp;
        }

        return self;
    }

    pub fn timeout(self: *Self, ms: u64) !*Self {
        if (ms < 0) {
            return error.NegativeTimeout;
        }
        self.options.timeout = ms;
        return self;
    }

    pub fn backoff(self: *Self, strategy: BackoffStrategy, delay: u64) !*Self {
        if (strategy != .immediate and delay <= 0) {
            return error.InvalidBackoffDelay;
        }

        self.options.backoff = BackoffOptions{
            .strategy = strategy,
            .delay = delay,
        };
        return self;
    }

    pub fn reportProgress(self: *Self, progress: f64) void {
        if (progress >= 0.0 and progress <= 1.0) {
            self.progress = progress;
        }
    }

    pub fn toData(self: *const Self) !JobData {
        const job_data = JobData{
            .data = try self.allocator.dupe(u8, self.data),
            .options = try self.options.clone(self.allocator),
            .status = self.status,
            .progress = self.progress,
        };
        return job_data;
    }

    pub fn computeDelay(self: *const Self) i64 {
        if (self.options.retries == 0) return -1;

        const backoff_opts = self.options.backoff orelse return 0;

        return switch (backoff_opts.strategy) {
            .immediate => 0,
            .fixed => @intCast(backoff_opts.delay),
            .exponential => {
                const attempts = self.getAttemptCount();
                const multiplier = std.math.pow(u64, 2, @min(attempts, 10));
                return @intCast(@min(multiplier * backoff_opts.delay, 300000));
            },
            .linear => {
                const attempts = self.getAttemptCount();
                return @intCast(attempts * backoff_opts.delay);
            },
        };
    }

    pub fn markRunning(self: *Self) void {
        self.status = .active;
    }

    pub fn markCompleted(self: *Self) void {
        self.status = .completed;
    }

    pub fn markFailed(self: *Self, error_msg: ?[]const u8) !void {
        if (error_msg) |msg| {
            try self.options.addStacktrace(self.allocator, msg);
        }

        if (self.options.retries > 0) {
            self.options.retries -= 1;
            self.status = .waiting;
        } else {
            self.status = .failed;
        }
    }

    pub fn shouldRetry(self: *const Self) bool {
        return self.status == .waiting and self.options.retries > 0;
    }

    fn getAttemptCount(self: *const Self) u32 {
        return if (self.options.retries > 0) 1 else 0;
    }

    pub fn isInStatus(self: *const Self, status: JobStatus) bool {
        return self.status == status;
    }

    pub fn clone(self: *const Self) !Self {
        return Self{
            .id = self.id,
            .name = try self.allocator.dupe(u8, self.name),
            .data = try self.allocator.dupe(u8, self.data),
            .status = self.status,
            .progress = self.progress,
            .options = try self.options.clone(self.allocator),
            .allocator = self.allocator,
        };
    }
};

test "Job creation and basic operations" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var job = try Job.init(allocator, "test-job", "test-data", null);
    defer job.deinit();

    try testing.expect(job.id == null);
    try testing.expectEqualStrings("test-job", job.name);
    try testing.expectEqualStrings("test-data", job.data);
    try testing.expect(job.status == .created);
    try testing.expect(job.progress == 0.0);

    _ = job.setId(123);
    try testing.expect(job.id.? == 123);

    job.reportProgress(0.5);
    try testing.expect(job.progress == 0.5);
}

test "Job retries and backoff" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var job = try Job.init(allocator, "retry-job", "data", null);
    defer job.deinit();

    _ = try job.retries(3);
    try testing.expect(job.options.retries == 3);

    _ = try job.backoff(.exponential, 1000);
    try testing.expect(job.options.backoff.?.strategy == .exponential);
    try testing.expect(job.options.backoff.?.delay == 1000);

    const delay = job.computeDelay();
    try testing.expect(delay >= 0);
}

test "Job delay and timeout" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var job = try Job.init(allocator, "delayed-job", "data", null);
    defer job.deinit();

    const future_time = std.time.milliTimestamp() + 5000;
    _ = try job.delayUntil(future_time);
    try testing.expect(job.options.delay.? == future_time);

    _ = try job.timeout(30000);
    try testing.expect(job.options.timeout.? == 30000);
}

test "Job failure with stacktrace" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var job = try Job.init(allocator, "failing-job", "data", null);
    defer job.deinit();

    _ = try job.retries(2);

    try job.markFailed("Test error message");
    try testing.expect(job.options.stacktraces.items.len == 1);
    try testing.expectEqualStrings("Test error message", job.options.stacktraces.items[0]);
    try testing.expect(job.shouldRetry());

    try job.markFailed("Another error");
    try testing.expect(job.options.stacktraces.items.len == 2);
    try testing.expect(job.shouldRetry());

    try job.markFailed("Final error");
    try testing.expect(job.status == .failed);
    try testing.expect(!job.shouldRetry());
}
