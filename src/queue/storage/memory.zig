const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const Job = @import("../queue.zig").Job;
const JobStatus = @import("../queue.zig").JobStatus;

pub const MemoryStorage = struct {
    allocator: Allocator,
    jobs: ArrayList(Job),
    next_id: std.atomic.Value(u64),

    const Self = @This();

    pub fn init(allocator: Allocator) Self {
        return Self{
            .allocator = allocator,
            .jobs = ArrayList(Job).init(allocator),
            .next_id = std.atomic.Value(u64).init(1),
        };
    }

    pub fn deinit(self: *Self) void {
        for (self.jobs.items) |*job| {
            job.deinit(self.allocator);
        }
        self.jobs.deinit();
    }

    pub fn addJob(self: *Self, name: []const u8, data: []const u8) !u64 {
        const job_id = self.next_id.fetchAdd(1, .seq_cst);
        const job = try Job.init(self.allocator, job_id, name, data);
        try self.jobs.append(job);
        return job_id;
    }

    pub fn getJob(self: *Self, job_id: u64) ?*Job {
        for (self.jobs.items) |*job| {
            if (job.id == job_id) {
                return job;
            }
        }
        return null;
    }

    pub fn nextPendingJob(self: *Self) ?*Job {
        for (self.jobs.items) |*job| {
            if (job.status == .pending or job.shouldRetry()) {
                return job;
            }
        }
        return null;
    }

    pub fn updateJobStatus(self: *Self, job_id: u64, status: JobStatus) void {
        if (self.getJob(job_id)) |job| {
            job.status = status;
            job.updated_at = std.time.timestamp();
        }
    }

    pub fn getJobsByStatus(self: *Self, status: JobStatus, allocator: Allocator) !ArrayList(*Job) {
        var result = ArrayList(*Job).init(allocator);
        for (self.jobs.items) |*job| {
            if (job.status == status) {
                try result.append(job);
            }
        }
        return result;
    }

    pub fn countByStatus(self: *Self, status: JobStatus) u32 {
        var count: u32 = 0;
        for (self.jobs.items) |*job| {
            if (job.status == status) {
                count += 1;
            }
        }
        return count;
    }

    pub fn cleanup(self: *Self, max_age_seconds: i64) !void {
        const now = std.time.timestamp();
        const cutoff = now - max_age_seconds;

        var i: usize = 0;
        while (i < self.jobs.items.len) {
            const job = &self.jobs.items[i];
            if ((job.status == .completed or job.status == .failed) and
                job.updated_at < cutoff)
            {
                job.deinit(self.allocator);
                _ = self.jobs.swapRemove(i);
            } else {
                i += 1;
            }
        }
    }

    pub fn totalJobs(self: *const Self) u32 {
        return @intCast(self.jobs.items.len);
    }
};

test "MemoryStorage basic operations" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var storage = MemoryStorage.init(allocator);
    defer storage.deinit();

    const job1_id = try storage.addJob("job1", "data1");
    const job2_id = try storage.addJob("job2", "data2");

    try testing.expect(job1_id == 1);
    try testing.expect(job2_id == 2);
    try testing.expect(storage.totalJobs() == 2);

    const job1 = storage.getJob(job1_id);
    try testing.expect(job1 != null);
    try testing.expectEqualStrings("job1", job1.?.name);
    try testing.expectEqual(JobStatus.pending, job1.?.status);

    const next_job = storage.nextPendingJob();
    try testing.expect(next_job != null);
    try testing.expect(next_job.?.id == job1_id or next_job.?.id == job2_id);

    storage.updateJobStatus(job1_id, .completed);
    const updated_job = storage.getJob(job1_id);
    try testing.expectEqual(JobStatus.completed, updated_job.?.status);

    try testing.expect(storage.countByStatus(.completed) == 1);
    try testing.expect(storage.countByStatus(.pending) == 1);
}
