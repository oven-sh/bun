const ThreadPool = bun.ThreadPool;
const std = @import("std");
const bun = @import("root").bun;

pub const Batch = ThreadPool.Batch;
pub const Task = ThreadPool.Task;

pub fn NewWorkPool(comptime max_threads: ?usize) type {
    return struct {
        var pool: ThreadPool = undefined;
        var loaded: bool = false;

        fn create() *ThreadPool {
            @setCold(true);

            pool = ThreadPool.init(.{
                .max_threads = max_threads orelse @max(2, max_threads: {
                    if (bun.getenvZ("GOMAXPROCS")) |max_procs| try_override: {
                        break :max_threads std.fmt.parseInt(u32, max_procs, 10) catch
                            break :try_override;
                    }

                    break :max_threads @as(u32, @truncate(std.Thread.getCpuCount() catch 0));
                }),
                .stack_size = ThreadPool.default_thread_stack_size,
            });
            return &pool;
        }

        /// Initialization of WorkPool is not thread-safe, as it is
        /// assumed a single main thread sets everything up. Calling
        /// this afterwards is thread-safe.
        pub inline fn get() *ThreadPool {
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
}

pub const WorkPool = NewWorkPool(null);
