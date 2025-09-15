const Queue = @This();

pub const js = JSQueue;

const QueueImpl = @import("../../queue/queue.zig").Queue;
const QueueOptions = @import("../../queue/queue.zig").QueueOptions;
const Job = @import("../../queue/queue.zig").Job;

queue: QueueImpl,
worker_callback: JSValue = .zero,
global: *JSGlobalObject,
has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
worker_thread: ?std.Thread = null,

pub const JSQueue = struct {
    queue: QueueImpl,
    worker_callback: JSValue = .zero,
    global: *JSGlobalObject,
    has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
    worker_thread: ?std.Thread = null,

    const Self = @This();

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

        var options = QueueOptions{};
        if (args.nextEat()) |options_arg| {
            if (!options_arg.isUndefinedOrNull()) {
                if (!options_arg.isObject()) {
                    return globalThis.throw("Queue options must be an object", .{});
                }

                if (try options_arg.getTruthy(globalThis, "storage")) |storage_val| {
                    if (!storage_val.isString()) {
                        return globalThis.throw("Storage option must be a string", .{});
                    }
                    const storage_str = try storage_val.toSlice(globalThis, bun.default_allocator);
                    defer storage_str.deinit();
                    const storage_slice = storage_str.slice();

                    if (std.mem.eql(u8, storage_slice, "memory")) {
                        options.storage = .memory;
                    } else if (std.mem.eql(u8, storage_slice, "sqlite")) {
                        return globalThis.throw("SQLite storage is not yet implemented. Use 'memory' storage for now.", .{});
                    } else {
                        return globalThis.throw("Invalid storage type. Must be 'memory' or 'sqlite'", .{});
                    }
                }

                if (try options_arg.getTruthy(globalThis, "concurrency")) |concurrency_val| {
                    if (!concurrency_val.isNumber()) {
                        return globalThis.throw("Concurrency option must be a number", .{});
                    }
                    const concurrency_num = concurrency_val.asNumber();
                    if (concurrency_num < 1 or concurrency_num > 100) {
                        return globalThis.throw("Concurrency must be between 1 and 100", .{});
                    }
                    options.concurrency = @intFromFloat(concurrency_num);

                    if (options.concurrency != 1) {
                        bun.Output.warn("Concurrency > 1 is not yet implemented. Using concurrency = 1.\n", .{});
                        options.concurrency = 1;
                    }
                }
            }
        }

        var queue = QueueImpl.init(bun.default_allocator, name, options) catch {
            return globalThis.throw("Failed to create queue", .{});
        };

        queue.start();

        const js_queue = bun.default_allocator.create(Self) catch {
            queue.deinit();
            return globalThis.throwOutOfMemory();
        };

        js_queue.* = Self{
            .queue = queue,
            .global = globalThis,
        };

        return js_queue;
    }

    pub fn finalize(this: *Self) callconv(.C) void {
        this.stopWorker();
        this.queue.deinit();
        bun.default_allocator.destroy(this);
    }

    pub fn hasPendingActivity(this: *Self) callconv(.C) bool {
        return this.has_pending_activity.load(.seq_cst) > 0 or this.worker_thread != null;
    }

    pub fn add(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
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

        const job_id = this.queue.add(name, data) catch {
            return globalThis.throw("Failed to add job to queue", .{});
        };

        return JSValue.jsNumber(job_id);
    }

    pub fn worker(this: *Self, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();

        const callback_arg = args.nextEat() orelse {
            return globalThis.throw("worker() requires a callback function", .{});
        };

        if (!callback_arg.isCallable()) {
            return globalThis.throw("Worker callback must be a function", .{});
        }

        this.stopWorker();

        this.worker_callback = callback_arg;
        this.worker_callback.protect();

        this.startWorker() catch {
            this.worker_callback.unprotect();
            this.worker_callback = .zero;
            return globalThis.throw("Failed to start worker thread", .{});
        };

        return .js_undefined;
    }

    fn startWorker(this: *Self) !void {
        _ = this.has_pending_activity.fetchAdd(1, .seq_cst);

        this.worker_thread = try std.Thread.spawn(.{}, workerThreadMain, .{this});
    }

    fn stopWorker(this: *Self) void {
        if (this.worker_thread) |thread| {
            this.queue.stop();
            thread.join();
            this.worker_thread = null;
            _ = this.has_pending_activity.fetchSub(1, .seq_cst);
        }

        if (!this.worker_callback.isEmptyOrUndefinedOrNull()) {
            this.worker_callback.unprotect();
            this.worker_callback = .zero;
        }
    }

    fn workerThreadMain(this: *Self) void {
        defer {
            _ = this.has_pending_activity.fetchSub(1, .seq_cst);
        }

        while (!this.queue.should_stop.load(.seq_cst)) {
            if (this.queue.waitForJob()) |job| {
                this.processJob(job);
            }
        }
    }

    fn processJob(this: *Self, job: *Job) void {
        const global = this.global;

        var data_str = bun.String.init(job.data);
        const job_data = data_str.toJSByParseJSON(global) catch {
            this.queue.failJob(job.id);
            return;
        };

        const job_obj = jsc.JSValue.createEmptyObject(global, 4);
        job_obj.put(global, "id", jsc.JSValue.jsNumber(job.id));
        const name_str = bun.String.init(job.name);
        job_obj.put(global, "name", name_str.toJS(global));
        job_obj.put(global, "data", job_data);

        const done_fn = jsc.JSFunction.create(global, "done", jobDoneCallback, 0, .{
            .implementation_visibility = .public,
            .intrinsic = .none,
            .constructor = null,
        });

        const retry_fn = jsc.JSFunction.create(global, "retry", jobRetryCallback, 0, .{
            .implementation_visibility = .public,
            .intrinsic = .none,
            .constructor = null,
        });

        job_obj.put(global, "done", done_fn);

        job_obj.put(global, "retry", retry_fn);

        job_obj.put(global, "__jobId", jsc.JSValue.jsNumber(job.id));

        const callback_result = this.worker_callback.call(global, global.toJSValue(), &.{job_obj}) catch {
            this.queue.failJob(job.id);
            return;
        };

        if (callback_result.asAnyPromise()) |_| {
            this.handleAsyncJob(callback_result, job.id);
        } else {
            this.queue.completeJob(job.id);
        }
    }

    fn handleAsyncJob(this: *Self, promise: JSValue, job_id: u64) void {
        const global = this.global;

        const then_callback = jsc.JSFunction.create(global, "then", thenCallbackImpl, 1, .{
            .implementation_visibility = .public,
            .intrinsic = .none,
            .constructor = null,
        });

        const catch_callback = jsc.JSFunction.create(global, "catch", catchCallbackImpl, 1, .{
            .implementation_visibility = .public,
            .intrinsic = .none,
            .constructor = null,
        });

        const then_promise = promise.call(global, promise, &.{ then_callback, JSValue.jsNumber(job_id) }) catch {
            this.queue.failJob(job_id);
            return;
        };

        _ = then_promise.call(global, then_promise, &.{ catch_callback, JSValue.jsNumber(job_id) }) catch {
            this.queue.failJob(job_id);
            return;
        };
    }

    fn thenCallbackImpl(_: *JSGlobalObject, callframe: *CallFrame) !JSValue {
        const this_val = callframe.this();
        if (this_val == .js_undefined) return .js_undefined;

        const queue_ptr = this_val.as(JSQueue) orelse return .js_undefined;

        const args = callframe.argumentsAsArray(1);
        if (args.len == 0 or !args[0].isNumber()) return .js_undefined;

        const id: u64 = @intFromFloat(args[0].asNumber());
        queue_ptr.queue.completeJob(id);

        return .js_undefined;
    }

    fn catchCallbackImpl(_: *JSGlobalObject, callframe: *CallFrame) !JSValue {
        const this_val = callframe.this();
        if (this_val == .js_undefined) return .js_undefined;

        const queue_ptr = this_val.as(JSQueue) orelse return .js_undefined;

        const args = callframe.argumentsAsArray(1);
        if (args.len == 0 or !args[0].isNumber()) return .js_undefined;

        const id: u64 = @intFromFloat(args[0].asNumber());
        queue_ptr.queue.failJob(id);

        return .js_undefined;
    }

    fn jobDoneCallback(global: *JSGlobalObject, callframe: *CallFrame) !JSValue {
        const this_val = callframe.this();
        if (this_val == .js_undefined) return .js_undefined;

        const job_id_val_opt = this_val.get(global, "__jobId") catch return .js_undefined;
        const job_id_val = job_id_val_opt orelse return .js_undefined;

        if (!job_id_val.isNumber()) return .js_undefined;
        const job_id: u64 = @intFromFloat(job_id_val.asNumber());

        const args = callframe.argumentsAsArray(1);
        _ = args;

        _ = job_id;
        return .js_undefined;
    }

    fn jobRetryCallback(global: *JSGlobalObject, callframe: *CallFrame) !JSValue {
        const this_val = callframe.this();
        if (this_val == .js_undefined) return .js_undefined;
        const job_id_val_opt = this_val.get(global, "__jobId") catch return .js_undefined;
        const job_id_val = job_id_val_opt orelse return .js_undefined;

        if (!job_id_val.isNumber()) return .js_undefined;
        const job_id: u64 = @intFromFloat(job_id_val.asNumber());

        const args = callframe.argumentsAsArray(1);
        _ = args;

        _ = job_id;
        return .js_undefined;
    }
};

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;
const Arena = std.heap.ArenaAllocator;

const queueIml = @import("../../queue/queue.zig");

const bun = @import("bun");
const BunString = bun.String;
const CodepointIterator = bun.strings.UnsignedCodepointIterator;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;
const CallFrame = jsc.CallFrame;
