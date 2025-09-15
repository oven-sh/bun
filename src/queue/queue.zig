const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const Mutex = std.Thread.Mutex;
const Condition = std.Thread.Condition;

pub const JobStatus = enum {
    pending,
    running,
    completed,
    failed,
    retrying,
};

pub const Job = struct {
    id: u64,
    name: []const u8,
    data: []const u8,
    status: JobStatus,
    attempts: u32,
    max_attempts: u32,
    created_at: i64,
    updated_at: i64,

    const Self = @This();

    pub fn init(allocator: Allocator, id: u64, name: []const u8, data: []const u8) !Self {
        const now = std.time.timestamp();
        return Self{
            .id = id,
            .name = try allocator.dupe(u8, name),
            .data = try allocator.dupe(u8, data),
            .status = .pending,
            .attempts = 0,
            .max_attempts = 3,
            .created_at = now,
            .updated_at = now,
        };
    }

    pub fn deinit(self: *Self, allocator: Allocator) void {
        allocator.free(self.name);
        allocator.free(self.data);
    }

    pub fn markRunning(self: *Self) void {
        self.status = .running;
        self.attempts += 1;
        self.updated_at = std.time.timestamp();
    }

    pub fn markCompleted(self: *Self) void {
        self.status = .completed;
        self.updated_at = std.time.timestamp();
    }

    pub fn markFailed(self: *Self) void {
        if (self.attempts >= self.max_attempts) {
            self.status = .failed;
        } else {
            self.status = .retrying;
        }
        self.updated_at = std.time.timestamp();
    }

    pub fn shouldRetry(self: *const Self) bool {
        return self.status == .retrying and self.attempts < self.max_attempts;
    }
};

pub const QueueOptions = struct {
    storage: Storage = .memory,
    concurrency: u32 = 1,

    pub const Storage = enum {
        memory,
        redis,
    };
};

pub const Queue = struct {
    name: []const u8,
    options: QueueOptions,
    allocator: Allocator,
    jobs: ArrayList(Job),
    next_job_id: std.atomic.Value(u64),
    mutex: Mutex,
    condition: Condition,
    is_running: std.atomic.Value(bool),
    should_stop: std.atomic.Value(bool),

    const Self = @This();

    pub fn init(allocator: Allocator, name: []const u8, options: QueueOptions) !Self {
        return Self{
            .name = try allocator.dupe(u8, name),
            .options = options,
            .allocator = allocator,
            .jobs = ArrayList(Job).init(allocator),
            .next_job_id = std.atomic.Value(u64).init(1),
            .mutex = Mutex{},
            .condition = Condition{},
            .is_running = std.atomic.Value(bool).init(false),
            .should_stop = std.atomic.Value(bool).init(false),
        };
    }

    pub fn deinit(self: *Self) void {
        self.stop();

        self.mutex.lock();
        defer self.mutex.unlock();

        for (self.jobs.items) |*job| {
            job.deinit(self.allocator);
        }
        self.jobs.deinit();
        self.allocator.free(self.name);
    }

    pub fn add(self: *Self, job_name: []const u8, data: []const u8) !u64 {
        const job_id = self.next_job_id.fetchAdd(1, .seq_cst);
        const job = try Job.init(self.allocator, job_id, job_name, data);

        self.mutex.lock();
        defer self.mutex.unlock();

        try self.jobs.append(job);

        self.condition.signal();

        return job_id;
    }

    pub fn nextJob(self: *Self) ?*Job {
        self.mutex.lock();
        defer self.mutex.unlock();

        for (self.jobs.items) |*job| {
            if (job.status == .pending or job.shouldRetry()) {
                job.markRunning();
                return job;
            }
        }

        return null;
    }

    pub fn completeJob(self: *Self, job_id: u64) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        for (self.jobs.items) |*job| {
            if (job.id == job_id) {
                job.markCompleted();
                break;
            }
        }
    }

    pub fn failJob(self: *Self, job_id: u64) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        for (self.jobs.items) |*job| {
            if (job.id == job_id) {
                job.markFailed();
                if (job.shouldRetry()) {
                    self.condition.signal();
                }
                break;
            }
        }
    }

    pub fn waitForJob(self: *Self) ?*Job {
        self.mutex.lock();
        defer self.mutex.unlock();

        while (true) {
            if (self.should_stop.load(.seq_cst)) {
                return null;
            }

            for (self.jobs.items) |*job| {
                if (job.status == .pending or job.shouldRetry()) {
                    job.markRunning();
                    return job;
                }
            }

            self.condition.wait(&self.mutex);
        }
    }

    pub fn start(self: *Self) void {
        self.is_running.store(true, .seq_cst);
        self.should_stop.store(false, .seq_cst);
    }

    pub fn stop(self: *Self) void {
        self.should_stop.store(true, .seq_cst);
        self.is_running.store(false, .seq_cst);

        self.mutex.lock();
        self.condition.broadcast();
        self.mutex.unlock();
    }

    pub fn getStats(self: *Self) QueueStats {
        self.mutex.lock();
        defer self.mutex.unlock();

        var stats = QueueStats{
            .total = 0,
            .pending = 0,
            .running = 0,
            .completed = 0,
            .failed = 0,
            .retrying = 0,
        };

        for (self.jobs.items) |*job| {
            stats.total += 1;
            switch (job.status) {
                .pending => stats.pending += 1,
                .running => stats.running += 1,
                .completed => stats.completed += 1,
                .failed => stats.failed += 1,
                .retrying => stats.retrying += 1,
            }
        }

        return stats;
    }

    pub fn cleanup(self: *Self) !void {
        _ = self;
    }
};

pub const QueueStats = struct {
    total: u32,
    pending: u32,
    running: u32,
    completed: u32,
    failed: u32,
    retrying: u32,
};
