pub const ClipboardJob = struct {
    vm: *jsc.VirtualMachine,
    task: jsc.WorkPoolTask,
    any_task: jsc.AnyTask,
    poll: Async.KeepAlive = .{},
    promise: jsc.Strong,

    ctx: *ClipboardJobOptions,

    // Opaque pointer to C++ ClipboardJobOptions struct
    const ClipboardJobOptions = opaque {
        pub extern fn Bun__ClipboardJobOptions__runTask(ctx: *ClipboardJobOptions, global: *jsc.JSGlobalObject) void;
        pub extern fn Bun__ClipboardJobOptions__runFromJS(ctx: *ClipboardJobOptions, global: *jsc.JSGlobalObject, promise: jsc.JSValue) void;
        pub extern fn Bun__ClipboardJobOptions__deinit(ctx: *ClipboardJobOptions) void;
    };

    pub fn create(global: *jsc.JSGlobalObject, ctx: *ClipboardJobOptions, promise: jsc.JSValue) *ClipboardJob {
        const vm = global.bunVM();
        const job = bun.new(ClipboardJob, .{
            .vm = vm,
            .task = .{
                .callback = &runTask,
            },
            .any_task = undefined,
            .ctx = ctx,
            .promise = jsc.Strong.create(promise, global),
        });
        job.any_task = jsc.AnyTask.New(ClipboardJob, &runFromJS).init(job);
        return job;
    }

    pub fn runTask(task: *jsc.WorkPoolTask) void {
        const job: *ClipboardJob = @fieldParentPtr("task", task);
        var vm = job.vm;
        defer vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(job.any_task.task()));

        ClipboardJobOptions.Bun__ClipboardJobOptions__runTask(job.ctx, vm.global);
    }

    pub fn runFromJS(this: *ClipboardJob) void {
        defer this.deinit();
        const vm = this.vm;

        if (vm.isShuttingDown()) {
            return;
        }

        const promise = this.promise.get();
        if (promise == .zero) return;

        ClipboardJobOptions.Bun__ClipboardJobOptions__runFromJS(this.ctx, vm.global, promise);
    }

    fn deinit(this: *ClipboardJob) void {
        ClipboardJobOptions.Bun__ClipboardJobOptions__deinit(this.ctx);
        this.poll.unref(this.vm);
        this.promise.deinit();
        bun.destroy(this);
    }

    pub fn schedule(this: *ClipboardJob) void {
        this.poll.ref(this.vm);
        jsc.WorkPool.schedule(&this.task);
    }
};

// Helper function for C++ to call with opaque pointer
export fn Bun__Clipboard__scheduleJob(global: *jsc.JSGlobalObject, options: *ClipboardJob.ClipboardJobOptions, promise: jsc.JSValue) void {
    const job = ClipboardJob.create(global, options, promise.withAsyncContextIfNeeded(global));
    job.schedule();
}

// Prevent dead code elimination
pub fn fixDeadCodeElimination() void {
    std.mem.doNotOptimizeAway(&Bun__Clipboard__scheduleJob);
}

comptime {
    _ = &fixDeadCodeElimination;
}

const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const jsc = bun.jsc;