/// Used to keep the bundle thread from spinning on Windows
pub fn timerCallback(_: *bun.windows.libuv.Timer) callconv(.c) void {}

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
                const bundle_thread = bun.handleOom(bun.default_allocator.create(Self));
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
                    bun.mimalloc.mi_collect(false);
                    has_bundled = false;
                }

                _ = instance.waker.wait();
            }
        }

        /// This is called from `Bun.build` in JavaScript.
        fn generateInNewThread(completion: *CompletionStruct, generation: bun.Generation) !void {
            var heap = ThreadLocalArena.init();
            defer heap.deinit();

            const allocator = heap.allocator();
            var ast_memory_allocator = try allocator.create(js_ast.ASTMemoryAllocator);
            ast_memory_allocator.* = .{ .allocator = allocator };
            ast_memory_allocator.reset();
            ast_memory_allocator.push();

            const transpiler = try allocator.create(bun.Transpiler);

            // Use the existing configureBundler for initial Transpiler setup.
            // For ?bundle imports, the shared config function is applied AFTER
            // to override env/define/naming with import attribute values.
            try completion.configureBundler(transpiler, allocator);

            if (@hasField(CompletionStruct, "bundle_import_config")) {
                if (completion.bundle_import_config) |bic| {
                    try bundler.bundle_config.configureTranspilerForBundle(transpiler, bic);
                    bundler.bundle_config.applyBundleModeOverrides(transpiler, .production);
                }
            }

            transpiler.resolver.generation = generation;

            // Phase 2 of the bake v2 plan: every top-level build is owned
            // by a `BuildPipeline`. The JS-API path is one-shot — the
            // pipeline is dropped at the end of the build via the
            // `pipeline.deinit()` deferred below.
            const pipeline = try bundler.BuildPipeline.createOneshot();

            const this = try BundleV2.init(
                transpiler,
                null, // TODO: Kit
                allocator,
                jsc.AnyEventLoop.init(allocator),
                false,
                jsc.WorkPool.get(),
                heap,
            );
            this.pipeline = pipeline;

            this.plugins = completion.plugins;
            this.completion = switch (CompletionStruct) {
                BundleV2.JSBundleCompletionTask => completion,
                else => @compileError("Unknown completion struct: " ++ CompletionStruct),
            };
            // Pass watcher to BundleV2 so it watches all resolved files during bundling
            if (@hasField(CompletionStruct, "bun_watcher")) {
                if (completion.bun_watcher) |watcher| {
                    this.bun_watcher = watcher;
                    transpiler.resolver.watcher = watcher.getResolveWatcher();
                }
            }
            // Set the file_map pointer for in-memory file support
            this.file_map = if (completion.config.files.map.count() > 0)
                &completion.config.files
            else
                null;
            completion.transpiler = this;

            defer {
                ast_memory_allocator.pop();
                this.deinitWithoutFreeingArena();
                pipeline.deinit();
            }

            errdefer {
                // Wait for wait groups to finish. There still may be ongoing work.
                this.linker.source_maps.line_offset_wait_group.wait();
                this.linker.source_maps.quoted_contents_wait_group.wait();

                var out_log = Logger.Log.init(bun.default_allocator);
                bun.handleOom(this.transpiler.log.appendToWithRecycled(&out_log, true));
                completion.log = out_log;
            }

            // Check the VM-wide sub-build cache ON the bundle thread. Builds
            // are processed sequentially here, so an earlier build's sub-build
            // (e.g. worker building frontend.tsx?bundle) may have seeded the
            // cache. If so, skip the full build — one build, shared result.
            const cached_result: ?BundleV2.BuildResult = cache_check: {
                if (!@hasField(CompletionStruct, "js_bundle_owner")) break :cache_check null;
                const owner = completion.js_bundle_owner orelse break :cache_check null;
                const cache = this.vmSubBuildCache() orelse break :cache_check null;
                const snap = cache.lookup(owner.path, owner.config) orelse break :cache_check null;
                defer snap.deref();
                const owned = try snap.materialize();
                break :cache_check BundleV2.BuildResult{
                    .output_files = std.array_list.Managed(options.OutputFile).fromOwnedSlice(
                        bun.default_allocator,
                        owned,
                    ),
                    .direct_file_count = snap.direct_file_count,
                };
            };

            completion.result = .{ .value = cached_result orelse try this.runFromJSInNewThread(transpiler.options.entry_points) };

            var out_log = Logger.Log.init(bun.default_allocator);
            bun.handleOom(this.transpiler.log.appendToWithRecycled(&out_log, true));
            completion.log = out_log;
            completion.completeOnBundleThread();
        }
    };
}

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const Logger = @import("../logger.zig");
const Timer = @import("../system_timer.zig");
const linker = @import("../linker.zig");
const options = @import("../options.zig");
const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const Transpiler = bun.Transpiler;
const bake = bun.bake;
const default_allocator = bun.default_allocator;
const js_ast = bun.ast;
const jsc = bun.jsc;

const allocators = bun.allocators;
const ThreadLocalArena = bun.allocators.MimallocArena;

const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;
