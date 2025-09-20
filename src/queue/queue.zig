const std = @import("std");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const HashMap = std.hash_map.HashMap;
const Mutex = std.Thread.Mutex;
const Condition = std.Thread.Condition;
const Atomic = std.atomic.Value;

const Job = @import("job.zig").Job;
const JobData = @import("job.zig").JobData;
const JobStatus = @import("job.zig").JobStatus;
const JobOptions = @import("job.zig").JobOptions;
const EagerTimer = @import("eager_timer.zig").EagerTimer;

pub const QueueError = error{
    QueueClosed,
    InvalidJobId,
    JobNotFound,
    WorkerAlreadyStarted,
    NoWorkerFunction,
    OutOfMemory,
};

pub const QueueSettings = struct {
    stall_interval: u64 = 30000,
    max_stalled_count: u32 = 3,
    near_term_window: u64 = 1200000,
    delayed_debounce: u64 = 1000,
    activate_delayed_jobs: bool = true,
    get_events: bool = true,
    send_events: bool = true,
    store_jobs: bool = true,
    remove_on_success: bool = false,
    remove_on_failure: bool = false,
    is_worker: bool = false,
    ensure_scripts: bool = true,
    concurrency: u32 = 1,
    redis_scan_count: u32 = 100,
};

pub const QueueStats = struct {
    waiting: u32 = 0,
    active: u32 = 0,
    completed: u32 = 0,
    failed: u32 = 0,
    delayed: u32 = 0,
    newest_job: u64 = 0,
};

pub const JobMap = HashMap(u64, *Job, std.hash_map.AutoContext(u64), std.hash_map.default_max_load_percentage);
pub const ActiveJobSet = HashMap(u64, void, std.hash_map.AutoContext(u64), std.hash_map.default_max_load_percentage);

pub const EventCallback = *const fn (event_type: []const u8, job_id: u64, data: ?[]const u8, ctx: ?*anyopaque) void;

pub const WorkerFunction = *const fn (job: *Job, ctx: ?*anyopaque) anyerror!void;

pub const Queue = struct {
    name: []const u8,
    settings: QueueSettings,
    allocator: Allocator,

    jobs: JobMap,
    active_jobs: ActiveJobSet,
    waiting_jobs: ArrayList(u64),
    failed_jobs: ArrayList(u64),
    completed_jobs: ArrayList(u64),
    delayed_jobs: ArrayList(DelayedJob),
    stalled_jobs: ArrayList(u64),

    mutex: Mutex,
    condition: Condition,

    next_job_id: Atomic(u64),
    is_closed: Atomic(bool),
    is_paused: Atomic(bool),
    is_ready: Atomic(bool),

    worker_function: ?WorkerFunction,
    worker_context: ?*anyopaque,
    worker_threads: ArrayList(std.Thread),
    running_workers: Atomic(u32),

    delayed_timer: ?EagerTimer,

    event_callback: ?EventCallback,
    event_context: ?*anyopaque,

    const Self = @This();

    const DelayedJob = struct {
        job_id: u64,
        execute_at: i64,
    };

    pub fn init(allocator: Allocator, name: []const u8, settings: QueueSettings) !Self {
        var queue = Self{
            .name = try allocator.dupe(u8, name),
            .settings = settings,
            .allocator = allocator,
            .jobs = JobMap.init(allocator),
            .active_jobs = ActiveJobSet.init(allocator),
            .waiting_jobs = undefined,
            .failed_jobs = undefined,
            .completed_jobs = undefined,
            .delayed_jobs = undefined,
            .stalled_jobs = undefined,
            .mutex = Mutex{},
            .condition = Condition{},
            .next_job_id = Atomic(u64).init(1),
            .is_closed = Atomic(bool).init(false),
            .is_paused = Atomic(bool).init(false),
            .is_ready = Atomic(bool).init(false),
            .worker_function = null,
            .worker_context = null,
            .worker_threads = undefined,
            .running_workers = Atomic(u32).init(0),
            .delayed_timer = null,
            .event_callback = null,
            .event_context = null,
        };

        queue.waiting_jobs = ArrayList(u64).init(allocator);
        queue.failed_jobs = ArrayList(u64).init(allocator);
        queue.completed_jobs = ArrayList(u64).init(allocator);
        queue.delayed_jobs = ArrayList(DelayedJob).init(allocator);
        queue.stalled_jobs = ArrayList(u64).init(allocator);
        queue.worker_threads = ArrayList(std.Thread).init(allocator);

        if (settings.activate_delayed_jobs) {
            queue.delayed_timer = try EagerTimer.init(allocator, settings.near_term_window);
            queue.delayed_timer.?.onTrigger(delayedTimerCallback, &queue);
        }

        return queue;
    }

    pub fn deinit(self: *Self) void {
        self.close(5000) catch {};

        self.mutex.lock();
        defer self.mutex.unlock();

        if (self.delayed_timer) |*timer| {
            timer.deinit();
        }

        var job_iterator = self.jobs.iterator();
        while (job_iterator.next()) |entry| {
            entry.value_ptr.*.deinit();
            self.allocator.destroy(entry.value_ptr.*);
        }
        self.jobs.deinit();

        self.active_jobs.deinit();
        self.waiting_jobs.deinit();
        self.failed_jobs.deinit();
        self.completed_jobs.deinit();
        self.delayed_jobs.deinit();
        self.stalled_jobs.deinit();
        self.worker_threads.deinit();

        self.allocator.free(self.name);
    }

    pub fn connect(self: *Self) !void {
        self.mutex.lock();
        defer self.mutex.unlock();

        if (self.is_ready.load(.seq_cst)) return;

        if (self.delayed_timer) |*timer| {
            try timer.start();
        }

        self.is_ready.store(true, .seq_cst);
        self.emitEvent("ready", 0, null);
    }

    pub fn isRunning(self: *Self) bool {
        return !self.is_paused.load(.seq_cst);
    }

    pub fn createJob(self: *Self, name: []const u8, data: []const u8, options: ?JobOptions) !*Job {
        const job = try self.allocator.create(Job);
        errdefer self.allocator.destroy(job);

        job.* = try Job.init(self.allocator, name, data, options);
        return job;
    }

    pub fn add(self: *Self, name: []const u8, data: []const u8, options: ?JobOptions) !u64 {
        if (self.is_closed.load(.seq_cst)) return QueueError.QueueClosed;

        self.mutex.lock();
        defer self.mutex.unlock();

        const job_id = self.next_job_id.fetchAdd(1, .seq_cst);
        const job = try self.allocator.create(Job);
        errdefer self.allocator.destroy(job);

        job.* = try Job.init(self.allocator, name, data, options);
        _ = job.setId(job_id);

        try self.jobs.put(job_id, job);

        if (job.options.delay) |delay| {
            job.status = .delayed;
            try self.delayed_jobs.append(DelayedJob{
                .job_id = job_id,
                .execute_at = delay,
            });

            if (self.delayed_timer) |*timer| {
                timer.schedule(delay);
            }
        } else {
            job.status = .waiting;
            try self.waiting_jobs.append(job_id);

            self.condition.signal();
        }

        self.emitEvent("job added", job_id, name);
        return job_id;
    }

    pub fn getJob(self: *Self, job_id: u64) ?*Job {
        self.mutex.lock();
        defer self.mutex.unlock();

        return self.jobs.get(job_id);
    }

    pub fn removeJob(self: *Self, job_id: u64) !void {
        self.mutex.lock();
        defer self.mutex.unlock();

        const job = self.jobs.get(job_id) orelse return QueueError.JobNotFound;

        self.removeFromQueue(&self.waiting_jobs, job_id);
        self.removeFromQueue(&self.failed_jobs, job_id);
        self.removeFromQueue(&self.completed_jobs, job_id);
        self.removeFromQueue(&self.stalled_jobs, job_id);

        for (self.delayed_jobs.items, 0..) |delayed_job, i| {
            if (delayed_job.job_id == job_id) {
                _ = self.delayed_jobs.swapRemove(i);
                break;
            }
        }

        _ = self.active_jobs.remove(job_id);

        _ = self.jobs.remove(job_id);
        job.deinit();
        self.allocator.destroy(job);

        self.emitEvent("job removed", job_id, null);
    }

    pub fn process(self: *Self, worker_fn: WorkerFunction, context: ?*anyopaque, concurrency: ?u32) !void {
        if (self.worker_function != null) return QueueError.WorkerAlreadyStarted;
        if (!self.settings.is_worker) return error.NotWorkerQueue;

        self.worker_function = worker_fn;
        self.worker_context = context;

        _ = concurrency;

        _ = self.running_workers.fetchAdd(1, .seq_cst);

        self.emitEvent("workers started", 1, null);
    }

    pub fn getStats(self: *Self) QueueStats {
        self.mutex.lock();
        defer self.mutex.unlock();

        return QueueStats{
            .waiting = @intCast(self.waiting_jobs.items.len),
            .active = @intCast(self.active_jobs.count()),
            .completed = @intCast(self.completed_jobs.items.len),
            .failed = @intCast(self.failed_jobs.items.len),
            .delayed = @intCast(self.delayed_jobs.items.len),
            .newest_job = if (self.next_job_id.load(.seq_cst) > 1) self.next_job_id.load(.seq_cst) - 1 else 0,
        };
    }

    pub fn getJobs(self: *Self, result_allocator: Allocator, job_type: []const u8, start: usize, end: usize) !ArrayList(*Job) {
        self.mutex.lock();
        defer self.mutex.unlock();

        var result = ArrayList(*Job).init(result_allocator);

        if (std.mem.eql(u8, job_type, "waiting")) {
            const slice_end = @min(end, self.waiting_jobs.items.len);
            for (self.waiting_jobs.items[start..slice_end]) |job_id| {
                if (self.jobs.get(job_id)) |job| {
                    try result.append(job);
                }
            }
        } else if (std.mem.eql(u8, job_type, "active")) {
            var iterator = self.active_jobs.keyIterator();
            var count: usize = 0;
            while (iterator.next()) |job_id_ptr| {
                if (count >= start and count < end) {
                    if (self.jobs.get(job_id_ptr.*)) |job| {
                        try result.append(job);
                    }
                }
                count += 1;
            }
        } else if (std.mem.eql(u8, job_type, "failed")) {
            const slice_end = @min(end, self.failed_jobs.items.len);
            for (self.failed_jobs.items[start..slice_end]) |job_id| {
                if (self.jobs.get(job_id)) |job| {
                    try result.append(job);
                }
            }
        } else if (std.mem.eql(u8, job_type, "completed")) {
            const slice_end = @min(end, self.completed_jobs.items.len);
            for (self.completed_jobs.items[start..slice_end]) |job_id| {
                if (self.jobs.get(job_id)) |job| {
                    try result.append(job);
                }
            }
        } else if (std.mem.eql(u8, job_type, "delayed")) {
            const slice_end = @min(end, self.delayed_jobs.items.len);
            for (self.delayed_jobs.items[start..slice_end]) |delayed_job| {
                if (self.jobs.get(delayed_job.job_id)) |job| {
                    try result.append(job);
                }
            }
        }

        return result;
    }

    pub fn pause(self: *Self) void {
        self.is_paused.store(true, .seq_cst);
        self.emitEvent("paused", 0, null);
    }

    pub fn resumeQueue(self: *Self) void {
        self.is_paused.store(false, .seq_cst);
        self.mutex.lock();
        self.condition.broadcast();
        self.mutex.unlock();
        self.emitEvent("resumed", 0, null);
    }

    pub fn close(self: *Self, timeout_ms: u64) !void {
        if (self.is_closed.load(.seq_cst)) return;

        self.is_paused.store(true, .seq_cst);
        self.is_closed.store(true, .seq_cst);

        if (self.delayed_timer) |*timer| {
            timer.stop();
        }

        self.mutex.lock();
        self.condition.broadcast();
        self.mutex.unlock();

        const start_time = std.time.milliTimestamp();
        while (self.running_workers.load(.seq_cst) > 0) {
            const elapsed = std.time.milliTimestamp() - start_time;
            if (elapsed > timeout_ms) break;
            std.Thread.sleep(10 * std.time.ns_per_ms);
        }

        for (self.worker_threads.items) |thread| {
            thread.join();
        }
        self.worker_threads.clearRetainingCapacity();

        self.emitEvent("closed", 0, null);
    }

    pub fn onEvent(self: *Self, callback: EventCallback, context: ?*anyopaque) void {
        self.event_callback = callback;
        self.event_context = context;
    }

    fn removeFromQueue(_: *Self, queue: *ArrayList(u64), job_id: u64) void {
        for (queue.items, 0..) |id, i| {
            if (id == job_id) {
                _ = queue.swapRemove(i);
                break;
            }
        }
    }

    pub fn emitEvent(self: *Self, event_type: []const u8, job_id: u64, data: ?[]const u8) void {
        if (self.event_callback) |callback| {
            callback(event_type, job_id, data, self.event_context);
        }
    }

    fn getNextJob(self: *Self) ?*Job {
        self.mutex.lock();
        defer self.mutex.unlock();

        if (self.waiting_jobs.items.len == 0) return null;

        const job_id = self.waiting_jobs.swapRemove(0);
        const job = self.jobs.get(job_id) orelse return null;

        job.status = .active;
        job.markRunning();
        self.active_jobs.put(job_id, {}) catch return null;

        return job;
    }

    fn finishJob(self: *Self, job: *Job, result: anyerror!void) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        const job_id = job.id orelse return;

        _ = self.active_jobs.remove(job_id);

        if (result) |_| {
            job.markCompleted();
            if (!self.settings.remove_on_success) {
                self.completed_jobs.append(job_id) catch {};
            }
            self.emitEvent("job completed", job_id, null);
        } else |err| {
            const error_msg = @errorName(err);
            job.markFailed(error_msg) catch {};

            if (job.shouldRetry()) {
                const delay = job.computeDelay();
                if (delay > 0) {
                    job.status = .delayed;
                    const execute_at = std.time.milliTimestamp() + delay;
                    self.delayed_jobs.append(DelayedJob{
                        .job_id = job_id,
                        .execute_at = execute_at,
                    }) catch {};

                    if (self.delayed_timer) |*timer| {
                        timer.schedule(execute_at);
                    }

                    self.emitEvent("job retrying", job_id, error_msg);
                } else {
                    job.status = .waiting;
                    self.waiting_jobs.append(job_id) catch {};
                    self.condition.signal();
                    self.emitEvent("job retrying", job_id, error_msg);
                }
            } else {
                if (!self.settings.remove_on_failure) {
                    self.failed_jobs.append(job_id) catch {};
                }
                self.emitEvent("job failed", job_id, error_msg);
            }
        }
    }

    fn activateDelayedJobs(self: *Self) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        const now = std.time.milliTimestamp();
        var i: usize = 0;
        var activated_count: u32 = 0;

        while (i < self.delayed_jobs.items.len) {
            const delayed_job = self.delayed_jobs.items[i];

            if (delayed_job.execute_at <= now) {
                if (self.jobs.get(delayed_job.job_id)) |job| {
                    job.status = .waiting;
                    self.waiting_jobs.append(delayed_job.job_id) catch {};
                    activated_count += 1;
                }

                _ = self.delayed_jobs.swapRemove(i);
            } else {
                i += 1;
            }
        }

        if (activated_count > 0) {
            self.condition.broadcast();
            self.emitEvent("jobs activated", activated_count, null);
        }

        if (self.delayed_jobs.items.len > 0) {
            var next_time: i64 = std.math.maxInt(i64);
            for (self.delayed_jobs.items) |delayed_job| {
                next_time = @min(next_time, delayed_job.execute_at);
            }

            if (self.delayed_timer) |*timer| {
                timer.schedule(next_time);
            }
        }
    }

    fn checkStalledJobs(self: *Self) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        const now = std.time.milliTimestamp();
        const stall_threshold = now - @as(i64, @intCast(self.settings.stall_interval));

        var iterator = self.active_jobs.keyIterator();
        while (iterator.next()) |job_id_ptr| {
            if (self.jobs.get(job_id_ptr.*)) |job| {
                if (job.options.timestamp < stall_threshold) {
                    self.stalled_jobs.append(job.id.?) catch {};
                    self.emitEvent("job stalled", job.id.?, null);
                }
            }
        }
    }

    fn workerThread(self: *Self) void {
        defer _ = self.running_workers.fetchSub(1, .seq_cst);

        while (!self.is_closed.load(.seq_cst)) {
            if (self.is_paused.load(.seq_cst)) {
                std.Thread.sleep(100 * std.time.ns_per_ms);
                continue;
            }

            self.mutex.lock();
            while (self.waiting_jobs.items.len == 0 and !self.is_closed.load(.seq_cst) and !self.is_paused.load(.seq_cst)) {
                self.condition.wait(&self.mutex);
            }
            self.mutex.unlock();

            if (self.is_closed.load(.seq_cst)) break;

            if (self.getNextJob()) |job| {
                if (self.worker_function) |worker_fn| {
                    const result = worker_fn(job, self.worker_context);
                    self.finishJob(job, result);
                }
            }
        }
    }

    fn stalledJobChecker(self: *Self) void {
        while (!self.is_closed.load(.seq_cst)) {
            std.Thread.sleep(self.settings.stall_interval * std.time.ns_per_ms);

            if (!self.is_closed.load(.seq_cst)) {
                self.checkStalledJobs();
            }
        }
    }

    fn delayedTimerCallback(ctx: *anyopaque) void {
        const self: *Self = @ptrCast(@alignCast(ctx));
        self.activateDelayedJobs();
    }
};
