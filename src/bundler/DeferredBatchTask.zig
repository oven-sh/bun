/// This task is run once all parse and resolve tasks have been complete
/// and we have deferred onLoad plugins that we need to resume
///
/// It enqueues a task to be run on the JS thread which resolves the promise
/// for every onLoad callback which called `.defer()`.
pub const DeferredBatchTask = @This();

running: if (Environment.isDebug) bool else u0 = if (Environment.isDebug) false else 0,

pub fn init(this: *DeferredBatchTask) void {
    if (comptime Environment.isDebug) bun.debugAssert(!this.running);
    this.* = .{
        .running = if (comptime Environment.isDebug) false else 0,
    };
}

pub fn getBundleV2(this: *DeferredBatchTask) *bun.BundleV2 {
    return @alignCast(@fieldParentPtr("drain_defer_task", this));
}

pub fn schedule(this: *DeferredBatchTask) void {
    if (comptime Environment.isDebug) {
        bun.assert(!this.running);
        this.running = false;
    }
    this.getBundleV2().jsLoopForPlugins().enqueueTaskConcurrent(jsc.ConcurrentTask.create(jsc.Task.init(this)));
}

pub fn deinit(this: *DeferredBatchTask) void {
    if (comptime Environment.isDebug) {
        this.running = false;
    }
}

pub fn runOnJSThread(this: *DeferredBatchTask) void {
    defer this.deinit();
    var bv2 = this.getBundleV2();
    bv2.plugins.?.drainDeferred(
        if (bv2.completion) |completion|
            completion.result == .err
        else
            false,
    ) catch return;
}

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
