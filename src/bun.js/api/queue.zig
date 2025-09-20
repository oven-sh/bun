const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const CallFrame = jsc.CallFrame;
const ArgumentsSlice = CallFrame.ArgumentsSlice;
pub const js = jsc.Codegen.JSQueue;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const Channel = @import("../../queue/channel.zig").Channel;
const Job = @import("../../queue/job.zig").Job;
const JobOptions = @import("../../queue/job.zig").JobOptions;
const JobStatus = @import("../../queue/job.zig").JobStatus;
const QueueImpl = @import("../../queue/queue.zig").Queue;
const QueueSettings = @import("../../queue/queue.zig").QueueSettings;
const WorkerPool = @import("../../queue/worker_pool.zig").WorkerPool;
const JobResult = @import("../../queue/worker_pool.zig").JobResult;

const Queue = @This();

queue: QueueImpl,
worker_callback: JSValue = .zero,
event_callback: JSValue = .zero,
global: *JSGlobalObject,
vm: *jsc.VirtualMachine,
has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
worker_thread: ?std.Thread = null,
event_listeners: std.hash_map.HashMap(u32, JSValue, std.hash_map.AutoContext(u32), std.hash_map.default_max_load_percentage),
job_promises: std.hash_map.HashMap(u64, *jsc.JSPromise, std.hash_map.AutoContext(u64), std.hash_map.default_max_load_percentage),

const Self = @This();

const WorkerTask = struct {
    task: jsc.AnyTask,
    queue_ref: *Self,
    job: *Job,

    pub fn create(queue: *Self, job: *Job) *WorkerTask {
        const worker_task = bun.default_allocator.create(WorkerTask) catch @panic("Failed to allocate WorkerTask");
        worker_task.* = WorkerTask{
            .task = jsc.AnyTask.New(WorkerTask, runFromMainThread).init(worker_task),
            .queue_ref = queue,
            .job = job,
        };
        return worker_task;
    }

    pub fn runFromMainThread(this: *WorkerTask) void {
        defer bun.default_allocator.destroy(this);
        const self = this.queue_ref;
        const job = this.job;
        const global = self.global;

        const job_js = self.jobToJS(global, job) catch {
            return;
        };

        const done_fn = jsc.JSFunction.create(global, "done", jobDoneCallback, 0, .{
            .implementation_visibility = .public,
            .intrinsic = .none,
            .constructor = null,
        });
        job_js.put(global, "done", done_fn);

        const result = self.worker_callback.call(global, global.toJSValue(), &.{job_js}) catch {
            return;
        };

        if (result.asAnyPromise()) |promise| {
            _ = promise;
            // TODO: handle promises properly in future implementation
        }
    }
};

pub const JSQueue = Queue;

pub fn constructor(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!*Self {
    const arguments = callframe.arguments_old(2).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const name_arg = args.nextEat() orelse {
        return globalThis.throw("Queue constructor requires a name as the first argument", .{});
    };

    if (!name_arg.isString()) {
        return globalThis.throw("Queue name must be a string", .{});
    }

    const name_slice = try name_arg.toSlice(globalThis, bun.default_allocator);
    defer name_slice.deinit();
    const name = name_slice.slice();

    var settings = QueueSettings{};
    if (args.nextEat()) |options_arg| {
        if (!options_arg.isUndefinedOrNull()) {
            if (!options_arg.isObject()) {
                return globalThis.throw("Queue options must be an object", .{});
            }

            if (try options_arg.getTruthy(globalThis, "concurrency")) |concurrency_val| {
                if (!concurrency_val.isNumber()) {
                    return globalThis.throw("Concurrency option must be a number", .{});
                }
                const concurrency_num = concurrency_val.asNumber();
                if (concurrency_num < 1 or concurrency_num > 100) {
                    return globalThis.throw("Concurrency must be between 1 and 100", .{});
                }
                settings.concurrency = @intFromFloat(concurrency_num);
            }

            if (try options_arg.getTruthy(globalThis, "isWorker")) |worker_val| {
                if (worker_val.isBoolean()) {
                    settings.is_worker = worker_val.asBoolean();
                }
            }

            if (try options_arg.getTruthy(globalThis, "activateDelayedJobs")) |delayed_val| {
                if (delayed_val.isBoolean()) {
                    settings.activate_delayed_jobs = delayed_val.asBoolean();
                }
            }

            if (try options_arg.getTruthy(globalThis, "stallInterval")) |stall_val| {
                if (stall_val.isNumber()) {
                    const stall_num = stall_val.asNumber();
                    if (stall_num > 0) {
                        settings.stall_interval = @intFromFloat(stall_num);
                    }
                }
            }

            if (try options_arg.getTruthy(globalThis, "removeOnSuccess")) |remove_val| {
                if (remove_val.isBoolean()) {
                    settings.remove_on_success = remove_val.asBoolean();
                }
            }

            if (try options_arg.getTruthy(globalThis, "removeOnFailure")) |remove_val| {
                if (remove_val.isBoolean()) {
                    settings.remove_on_failure = remove_val.asBoolean();
                }
            }
        }
    }

    var queue = QueueImpl.init(bun.default_allocator, name, settings) catch {
        return globalThis.throw("Failed to create queue", .{});
    };

    queue.connect() catch {
        queue.deinit();
        return globalThis.throw("Failed to connect queue", .{});
    };

    const js_queue = bun.default_allocator.create(Self) catch {
        queue.deinit();
        return globalThis.throwOutOfMemory();
    };

    js_queue.* = Self{
        .queue = queue,
        .global = globalThis,
        .vm = globalThis.bunVM(),
        .event_listeners = std.hash_map.HashMap(u32, JSValue, std.hash_map.AutoContext(u32), std.hash_map.default_max_load_percentage).init(bun.default_allocator),
        .job_promises = std.hash_map.HashMap(u64, *jsc.JSPromise, std.hash_map.AutoContext(u64), std.hash_map.default_max_load_percentage).init(bun.default_allocator),
    };

    js_queue.queue.onEvent(eventCallback, js_queue);

    return js_queue;
}

pub fn finalize(this: *Self) callconv(.C) void {
    this.stopWorker();
    this.queue.close(5000) catch {};
    this.queue.deinit();

    var iterator = this.event_listeners.iterator();
    while (iterator.next()) |entry| {
        entry.value_ptr.unprotect();
    }
    this.event_listeners.deinit();

    var promise_iterator = this.job_promises.iterator();
    while (promise_iterator.next()) |entry| {
        entry.value_ptr.*.reject(this.global, .zero);
    }
    this.job_promises.deinit();

    bun.default_allocator.destroy(this);
}

pub fn hasPendingActivity(this: *Self) callconv(.C) bool {
    return this.has_pending_activity.load(.seq_cst) > 0 or
        this.job_promises.count() > 0 or
        !this.queue.is_closed.load(.seq_cst);
}

pub fn add(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const name_arg = args.nextEat() orelse {
        return globalThis.throw("add() requires a job name as the first argument", .{});
    };

    if (!name_arg.isString()) {
        return globalThis.throw("Job name must be a string", .{});
    }

    const name_slice = try name_arg.toSlice(globalThis, bun.default_allocator);
    defer name_slice.deinit();
    const name = name_slice.slice();

    const data_arg = args.nextEat() orelse {
        return globalThis.throw("add() requires job data as the second argument", .{});
    };

    var json_str = bun.String.empty;
    data_arg.jsonStringify(globalThis, 0, &json_str) catch {
        return globalThis.throw("Failed to serialize job data to JSON", .{});
    };
    defer json_str.deref();

    const data = json_str.byteSlice();

    var job_options: ?JobOptions = null;
    if (args.nextEat()) |options_arg| {
        if (!options_arg.isUndefinedOrNull() and options_arg.isObject()) {
            var options = JobOptions.init(bun.default_allocator);
            job_options = options;

            if (try options_arg.getTruthy(globalThis, "retries")) |retries_val| {
                if (retries_val.isNumber()) {
                    const retries_num = retries_val.asNumber();
                    if (retries_num >= 0) {
                        options.retries = @intFromFloat(retries_num);
                    }
                }
            }

            if (try options_arg.getTruthy(globalThis, "delay")) |delay_val| {
                if (delay_val.isNumber()) {
                    const delay_num = delay_val.asNumber();
                    if (delay_num > 0) {
                        options.delay = @intFromFloat(delay_num);
                    }
                }
            }

            if (try options_arg.getTruthy(globalThis, "timeout")) |timeout_val| {
                if (timeout_val.isNumber()) {
                    const timeout_num = timeout_val.asNumber();
                    if (timeout_num > 0) {
                        options.timeout = @intFromFloat(timeout_num);
                    }
                }
            }
        }
    }
    defer if (job_options) |*opts| opts.deinit(bun.default_allocator);

    const job_id = this.queue.add(name, data, job_options) catch {
        return globalThis.throw("Failed to add job to queue", .{});
    };

    const promise = JSValue.createInternalPromise(globalThis);
    const promise_ptr = promise.asPromise() orelse {
        return globalThis.throw("Failed to create promise", .{});
    };

    this.job_promises.put(job_id, promise_ptr) catch {
        return globalThis.throw("Failed to store job promise", .{});
    };

    if (!this.worker_callback.isEmptyOrUndefinedOrNull()) {
        const job = this.queue.getJob(job_id) orelse {
            return globalThis.throw("Job not found after adding", .{});
        };

        const job_js = this.jobToJS(globalThis, job) catch {
            promise_ptr.reject(globalThis, .zero);
            return promise;
        };

        const result = this.worker_callback.call(globalThis, .zero, &.{job_js}) catch |err| {
            const error_value = switch (err) {
                error.JSError => globalThis.takeException(err),
                else => bun.String.static("Job processing failed").toJS(globalThis),
            };
            promise_ptr.reject(globalThis, error_value);
            // TODO: emit event asynchronously to avoid deadlock
            // this.queue.emitEvent("job failed", job_id, error_name);
            return promise;
        };

        promise_ptr.resolve(globalThis, result);
        // TODO: Emit event asynchronously to avoid deadlock
        // this.queue.emitEvent("job completed", job_id, null);
    } else {
        // No processor, resolve immediately with job ID
        promise_ptr.resolve(globalThis, JSValue.jsNumber(job_id));
    }

    return promise;
}

pub fn process(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const callback_arg = args.nextEat() orelse {
        return globalThis.throw("process() requires a callback function", .{});
    };

    if (!callback_arg.isCallable()) {
        return globalThis.throw("Worker callback must be a function", .{});
    }

    var concurrency: ?u32 = null;
    if (args.nextEat()) |concurrency_arg| {
        if (concurrency_arg.isNumber()) {
            const concurrency_num = concurrency_arg.asNumber();
            if (concurrency_num >= 1 and concurrency_num <= 100) {
                concurrency = @intFromFloat(concurrency_num);
            }
        }
    }

    this.stopWorker();

    this.worker_callback = callback_arg;
    this.worker_callback.protect();

    // for now, skip worker pool creation to avoid thread issues
    // execute jobs on main thread instead
    // TODO: Implement proper worker isolation using Bun's worker infrastructure

    // set the queue to worker mode
    this.queue.settings.is_worker = true;
    this.queue.settings.concurrency = concurrency orelse 1; // Single-threaded for now

    this.queue.process(workerFunction, this, 1) catch {
        this.stopWorker();
        return globalThis.throw("Failed to start worker", .{});
    };

    _ = this.has_pending_activity.fetchAdd(1, .seq_cst);

    return .js_undefined;
}

pub fn getJob(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const job_id_arg = args.nextEat() orelse {
        return globalThis.throw("getJob() requires a job ID", .{});
    };

    if (!job_id_arg.isNumber()) {
        return globalThis.throw("Job ID must be a number", .{});
    }

    const job_id: u64 = @intFromFloat(job_id_arg.asNumber());

    if (this.queue.getJob(job_id)) |job| {
        return this.jobToJS(globalThis, job);
    }

    return JSValue.null;
}

pub fn removeJob(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const job_id_arg = args.nextEat() orelse {
        return globalThis.throw("removeJob() requires a job ID", .{});
    };

    if (!job_id_arg.isNumber()) {
        return globalThis.throw("Job ID must be a number", .{});
    }

    const job_id: u64 = @intFromFloat(job_id_arg.asNumber());

    this.queue.removeJob(job_id) catch {
        return globalThis.throw("Failed to remove job", .{});
    };

    return .js_undefined;
}

pub fn getStats(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    _ = callframe;

    const stats = this.queue.getStats();

    const stats_obj = jsc.JSValue.createEmptyObject(globalThis, 6);
    stats_obj.put(globalThis, "waiting", jsc.JSValue.jsNumber(stats.waiting));
    stats_obj.put(globalThis, "active", jsc.JSValue.jsNumber(stats.active));
    stats_obj.put(globalThis, "completed", jsc.JSValue.jsNumber(stats.completed));
    stats_obj.put(globalThis, "failed", jsc.JSValue.jsNumber(stats.failed));
    stats_obj.put(globalThis, "delayed", jsc.JSValue.jsNumber(stats.delayed));
    stats_obj.put(globalThis, "newestJob", jsc.JSValue.jsNumber(stats.newest_job));

    return stats_obj;
}

pub fn getJobs(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const type_arg = args.nextEat() orelse {
        return globalThis.throw("getJobs() requires a job type", .{});
    };

    if (!type_arg.isString()) {
        return globalThis.throw("Job type must be a string", .{});
    }

    const type_slice = try type_arg.toSlice(globalThis, bun.default_allocator);
    defer type_slice.deinit();
    const job_type = type_slice.slice();

    var start: usize = 0;
    if (args.nextEat()) |start_arg| {
        if (start_arg.isNumber()) {
            const start_num = start_arg.asNumber();
            if (start_num >= 0) {
                start = @intFromFloat(start_num);
            }
        }
    }

    var end: usize = 100;
    if (args.nextEat()) |end_arg| {
        if (end_arg.isNumber()) {
            const end_num = end_arg.asNumber();
            if (end_num > 0) {
                end = @intFromFloat(end_num);
            }
        }
    }

    const jobs = this.queue.getJobs(bun.default_allocator, job_type, start, end) catch {
        return globalThis.throw("Failed to get jobs", .{});
    };
    defer jobs.deinit();

    const jobs_array = try jsc.JSValue.createEmptyArray(globalThis, jobs.items.len);
    for (jobs.items, 0..) |job, i| {
        const job_js = this.jobToJS(globalThis, job) catch continue;
        try jobs_array.putIndex(globalThis, @intCast(i), job_js);
    }

    return jobs_array;
}

pub fn pause(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    _ = globalThis;
    _ = callframe;

    this.queue.pause();
    return .js_undefined;
}

pub fn resumeQueue(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    _ = globalThis;
    _ = callframe;

    this.queue.resumeQueue();
    return .js_undefined;
}

pub fn close(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    var timeout: u64 = 5000; // Default 5 seconds
    if (args.nextEat()) |timeout_arg| {
        if (timeout_arg.isNumber()) {
            const timeout_num = timeout_arg.asNumber();
            if (timeout_num > 0) {
                timeout = @intFromFloat(timeout_num);
            }
        }
    }

    this.queue.close(timeout) catch {
        return globalThis.throw("Failed to close queue", .{});
    };

    this.stopWorker();

    return .js_undefined;
}

pub fn on(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    const event_arg = args.nextEat() orelse {
        return globalThis.throw("on() requires an event name", .{});
    };

    if (!event_arg.isString()) {
        return globalThis.throw("Event name must be a string", .{});
    }

    const callback_arg = args.nextEat() orelse {
        return globalThis.throw("on() requires a callback function", .{});
    };

    if (!callback_arg.isCallable()) {
        return globalThis.throw("Event callback must be a function", .{});
    }

    const event_slice = try event_arg.toSlice(globalThis, bun.default_allocator);
    defer event_slice.deinit();
    const event_name = event_slice.slice();

    var event_hash: u32 = 0;
    for (event_name) |c| {
        event_hash = event_hash *% 31 +% c;
    }

    callback_arg.protect();
    this.event_listeners.put(event_hash, callback_arg) catch {
        callback_arg.unprotect();
        return globalThis.throw("Failed to register event listener", .{});
    };

    return .js_undefined;
}

fn stopWorker(this: *Self) void {
    if (!this.worker_callback.isEmptyOrUndefinedOrNull()) {
        this.worker_callback.unprotect();
        this.worker_callback = .zero;
        _ = this.has_pending_activity.fetchSub(1, .seq_cst);
    }
}

fn jobToJS(_: *Self, globalThis: *JSGlobalObject, job: *Job) !JSValue {
    const job_obj = jsc.JSValue.createEmptyObject(globalThis, 6);

    if (job.id) |id| {
        job_obj.put(globalThis, "id", jsc.JSValue.jsNumber(id));
    }

    const name_str = bun.String.init(job.name);
    job_obj.put(globalThis, "name", name_str.toJS(globalThis));

    var data_str = bun.String.init(job.data);
    const data_js = data_str.toJSByParseJSON(globalThis) catch .js_undefined;
    job_obj.put(globalThis, "data", data_js);

    const status_str = bun.String.init(job.status.toString());
    job_obj.put(globalThis, "status", status_str.toJS(globalThis));

    job_obj.put(globalThis, "progress", jsc.JSValue.jsNumber(job.progress));

    const options_obj = jsc.JSValue.createEmptyObject(globalThis, 4);
    options_obj.put(globalThis, "retries", jsc.JSValue.jsNumber(job.options.retries));
    options_obj.put(globalThis, "timestamp", jsc.JSValue.jsNumber(job.options.timestamp));

    if (job.options.delay) |delay| {
        options_obj.put(globalThis, "delay", jsc.JSValue.jsNumber(delay));
    }

    if (job.options.timeout) |timeout| {
        options_obj.put(globalThis, "timeout", jsc.JSValue.jsNumber(timeout));
    }

    job_obj.put(globalThis, "options", options_obj);

    return job_obj;
}

fn enhancedWorkerFunction(job: *Job, ctx: ?*anyopaque) anyerror!void {
    const self: *Self = @ptrCast(@alignCast(ctx.?));

    if (self.worker_pool) |pool| {
        const promise = self.job_promises.get(job.id orelse return error.NoJobId);

        if (promise) |promise_ptr| {
            try pool.submitJob(job, promise_ptr, self.global);
        }
    } else {
        return workerFunction(job, ctx);
    }
}

fn workerFunction(job: *Job, ctx: ?*anyopaque) anyerror!void {
    const self: *Self = @ptrCast(@alignCast(ctx.?));

    if (self.worker_callback.isEmptyOrUndefinedOrNull()) {
        return error.NoWorkerCallback;
    }

    const worker_task = WorkerTask.create(self, job);

    self.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(jsc.Task.init(&worker_task.task)));
}

fn jobDoneCallback(global: *JSGlobalObject, callframe: *CallFrame) !JSValue {
    _ = global;
    _ = callframe;

    return .js_undefined;
}

fn eventCallback(event_type: []const u8, job_id: u64, data: ?[]const u8, ctx: ?*anyopaque) void {
    const self: *Self = @ptrCast(@alignCast(ctx.?));
    const global = self.global;

    if (std.mem.eql(u8, event_type, "job completed")) {
        self.resolveJobPromise(job_id, true, data);
    } else if (std.mem.eql(u8, event_type, "job failed")) {
        self.resolveJobPromise(job_id, false, data);
    }

    var event_hash: u32 = 0;
    for (event_type) |c| {
        event_hash = event_hash *% 31 +% c;
    }

    if (self.event_listeners.get(event_hash)) |callback| {
        const job = self.queue.getJob(job_id);
        const job_js = if (job) |j| self.jobToJS(global, j) catch JSValue.jsNull() else JSValue.jsNull();

        const data_js = if (data) |d| bun.String.init(d).toJS(global) else JSValue.jsNull();

        _ = callback.call(global, global.toJSValue(), &.{ job_js, data_js }) catch {};
    }
}

fn resolveJobPromise(self: *Self, job_id: u64, success: bool, data: ?[]const u8) void {
    if (self.job_promises.fetchRemove(job_id)) |entry| {
        const promise = entry.value;

        if (success) {
            const result = if (data) |d| blk: {
                var data_str = bun.String.init(d);
                break :blk data_str.toJSByParseJSON(self.global) catch .zero;
            } else .zero;

            promise.resolve(self.global, result);
        } else {
            const error_msg = if (data) |d| bun.String.init(d) else bun.String.init("Job failed");
            const error_js = error_msg.toJS(self.global);
            promise.reject(self.global, error_js);
        }
    }
}
