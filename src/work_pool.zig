pub const Batch = ThreadPool.Batch;
pub const Task = ThreadPool.Task;

pub const WorkPool = struct {
    var pool: ThreadPool = undefined;

    var createOnce = bun.once(
        struct {
            pub fn create() void {
                @branchHint(.cold);
                pool = ThreadPool.init(.{
                    .max_threads = bun.getThreadCount(),
                    .stack_size = ThreadPool.default_thread_stack_size,
                });
            }
        }.create,
    );

    pub inline fn get() *ThreadPool {
        createOnce.call(.{});
        return &pool;
    }

    pub fn scheduleBatch(batch: ThreadPool.Batch) void {
        get().schedule(batch);
    }

    pub fn schedule(task: *ThreadPool.Task) void {
        get().schedule(ThreadPool.Batch.from(task));
    }

    pub fn go(allocator: std.mem.Allocator, comptime Context: type, context: Context, comptime function: fn (Context) void) !void {
        const TaskType = struct {
            task: Task,
            context: Context,
            allocator: std.mem.Allocator,

            pub fn callback(task: *Task) void {
                var this_task: *@This() = @fieldParentPtr("task", task);
                function(this_task.context);
                this_task.allocator.destroy(this_task);
            }
        };

        var task_ = try allocator.create(TaskType);
        task_.* = .{
            .task = .{ .callback = TaskType.callback },
            .context = context,
            .allocator = allocator,
        };
        schedule(&task_.task);
    }
};

const std = @import("std");

const bun = @import("bun");
const ThreadPool = bun.ThreadPool;
