/// Used to keep the bundle thread from spinning on Windows
pub fn timerCallback(_: *bun.windows.libuv.Timer) callconv(.C) void {}

/// Originally, bake.DevServer required a separate bundling thread, but that was
/// later removed. The bundling thread's scheduling logic is generalized over
/// the completion structure.
///
/// CompletionStruct's interface:
///
/// - `configureBundler` is used to configure `Bundler`.
/// - `completeOnBundleThread` is used to tell the task that it is done.
pub fn BundleThread(CompletionStruct: type) type {
    return struct {
        const Self = @This();

        waker: bun.Async.Waker,
        ready_event: std.Thread.ResetEvent,
        queue: bun.UnboundedQueue(CompletionStruct, .next),
        generation: bun.Generation = 0,

        /// To initialize, put this somewhere in memory, and then call `spawn()`
        pub const uninitialized: Self = .{
            .waker = undefined,
            .queue = .{},
            .generation = 0,
            .ready_event = .{},
        };

        pub fn spawn(instance: *Self) !std.Thread {
            const thread = try std.Thread.spawn(.{}, threadMain, .{instance});
            instance.ready_event.wait();
            return thread;
        }

        /// Lazily-initialized singleton. This is used for `Bun.build` since the
        /// bundle thread may not be needed.
        pub const singleton = struct {
            var once = std.once(loadOnceImpl);
            var instance: ?*Self = null;

            // Blocks the calling thread until the bun build thread is created.
            // std.once also blocks other callers of this function until the first caller is done.
            fn loadOnceImpl() void {
                const bundle_thread = bun.default_allocator.create(Self) catch bun.outOfMemory();
                bundle_thread.* = uninitialized;
                instance = bundle_thread;

                // 2. Spawn the bun build thread.
                const os_thread = bundle_thread.spawn() catch
                    Output.panic("Failed to spawn bun build thread", .{});
                os_thread.detach();
            }

            pub fn get() *Self {
                once.call();
                return instance.?;
            }

            pub fn enqueue(completion: *CompletionStruct) void {
                get().enqueue(completion);
            }
        };

        pub fn enqueue(instance: *Self, completion: *CompletionStruct) void {
            instance.queue.push(completion);
            instance.waker.wake();
        }

        fn threadMain(instance: *Self) void {
            Output.Source.configureNamedThread("Bundler");

            instance.waker = bun.Async.Waker.init() catch @panic("Failed to create waker");

            // Unblock the calling thread so it can continue.
            instance.ready_event.set();

            var timer: bun.windows.libuv.Timer = undefined;
            if (bun.Environment.isWindows) {
                timer.init(instance.waker.loop.uv_loop);
                timer.start(std.math.maxInt(u64), std.math.maxInt(u64), &timerCallback);
            }

            var has_bundled = false;
            while (true) {
                while (instance.queue.pop()) |completion| {
                    generateInNewThread(completion, instance.generation) catch |err| {
                        completion.result = .{ .err = err };
                        completion.completeOnBundleThread();
                    };
                    has_bundled = true;
                }
                instance.generation +|= 1;

                if (has_bundled) {
                    bun.Mimalloc.mi_collect(false);
                    has_bundled = false;
                }

                _ = instance.waker.wait();
            }
        }

        /// This is called from `Bun.build` in JavaScript.
        fn generateInNewThread(completion: *CompletionStruct, generation: bun.Generation) !void {
            var heap = try ThreadlocalArena.init();
            defer heap.deinit();

            const allocator = heap.allocator();
            var ast_memory_allocator = try allocator.create(js_ast.ASTMemoryAllocator);
            ast_memory_allocator.* = .{ .allocator = allocator };
            ast_memory_allocator.reset();
            ast_memory_allocator.push();

            const transpiler = try allocator.create(bun.Transpiler);

            try completion.configureBundler(transpiler, allocator);

            transpiler.resolver.generation = generation;

            const this = try BundleV2.init(
                transpiler,
                null, // TODO: Kit
                allocator,
                JSC.AnyEventLoop.init(allocator),
                false,
                JSC.WorkPool.get(),
                heap,
            );

            this.plugins = completion.plugins;
            this.completion = switch (CompletionStruct) {
                BundleV2.JSBundleCompletionTask => completion,
                else => @compileError("Unknown completion struct: " ++ CompletionStruct),
            };
            completion.transpiler = this;

            defer {
                this.graph.pool.reset();
                ast_memory_allocator.pop();
                this.deinitWithoutFreeingArena();
            }

            errdefer {
                // Wait for wait groups to finish. There still may be ongoing work.
                this.linker.source_maps.line_offset_wait_group.wait();
                this.linker.source_maps.quoted_contents_wait_group.wait();

                var out_log = Logger.Log.init(bun.default_allocator);
                this.transpiler.log.appendToWithRecycled(&out_log, true) catch bun.outOfMemory();
                completion.log = out_log;
            }

            completion.result = .{ .value = .{
                .output_files = try this.runFromJSInNewThread(transpiler.options.entry_points),
            } };

            var out_log = Logger.Log.init(bun.default_allocator);
            this.transpiler.log.appendToWithRecycled(&out_log, true) catch bun.outOfMemory();
            completion.log = out_log;
            completion.completeOnBundleThread();
        }
    };
}

const Transpiler = bun.Transpiler;
const bun = @import("bun");
const Output = bun.Output;
const Environment = bun.Environment;
const default_allocator = bun.default_allocator;

const std = @import("std");
const Logger = @import("../logger.zig");
const options = @import("../options.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
pub const Ref = @import("../ast/base.zig").Ref;
const ThreadlocalArena = @import("../allocators/mimalloc_arena.zig").Arena;
const allocators = @import("../allocators.zig");
const Timer = @import("../system_timer.zig");

pub const Index = @import("../ast/base.zig").Index;
const JSC = bun.JSC;
const Async = bun.Async;
const bake = bun.bake;
const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
