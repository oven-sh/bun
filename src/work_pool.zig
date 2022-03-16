const ThreadPool = @import("thread_pool");
const std = @import("std");

pub const Batch = ThreadPool.Batch;
pub const Task = ThreadPool.Task;

pub fn NewWorkPool(comptime max_threads: ?usize) type {
    return struct {
        var pool: ThreadPool = undefined;
        var loaded: bool = false;

        fn create() *ThreadPool {
            @setCold(true);

            pool = ThreadPool.init(.{
                .max_threads = max_threads orelse @floatToInt(u32, @floor(@intToFloat(f32, @maximum(std.Thread.getCpuCount() catch 0, 2)) * 0.8)),
                .stack_size = 2 * 1024 * 1024,
            });
            return &pool;
        }
        pub inline fn get() *ThreadPool {
            // lil racy
            if (loaded) return &pool;
            loaded = true;

            return create();
        }

        pub fn scheduleBatch(batch: ThreadPool.Batch) void {
            get().schedule(batch);
        }

        pub fn schedule(task: *ThreadPool.Task) void {
            get().schedule(ThreadPool.Batch.from(task));
        }
    };
}

pub const WorkPool = NewWorkPool(null);
