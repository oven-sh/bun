pub fn generateCompileResultForJSChunk(task: *ThreadPoolLib.Task) void {
    const part_range: *const PendingPartRange = @fieldParentPtr("task", task);
    const ctx = part_range.ctx;
    var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
    defer worker.unget();

    const prev_action = if (Environment.show_crash_trace) bun.crash_handler.current_action;
    defer if (Environment.show_crash_trace) {
        bun.crash_handler.current_action = prev_action;
    };
    if (Environment.show_crash_trace) bun.crash_handler.current_action = .{ .bundle_generate_chunk = .{
        .chunk = ctx.chunk,
        .context = ctx.c,
        .part_range = &part_range.part_range,
    } };

    if (Environment.show_crash_trace) {
        const path = ctx.c.parse_graph.input_files.items(.source)[part_range.part_range.source_index.get()].path;
        if (bun.cli.debug_flags.hasPrintBreakpoint(path)) {
            @breakpoint();
        }
    }

    ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForJSChunkImpl(worker, ctx.c, ctx.chunk, part_range.part_range);
}

fn generateCompileResultForJSChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, part_range: PartRange) CompileResult {
    const trace = bun.perf.trace("Bundler.generateCodeForFileInChunkJS");
    defer trace.end();

    // Client and server bundles for Bake must be globally allocated, as they
    // must outlive the bundle task.
    const allocator = blk: {
        const dev = c.dev_server orelse break :blk default_allocator;
        break :blk dev.allocator();
    };

    var arena = &worker.temporary_arena;
    var buffer_writer = js_printer.BufferWriter.init(allocator);
    defer _ = arena.reset(.retain_capacity);
    worker.stmt_list.reset();

    var runtime_scope: *Scope = &c.graph.ast.items(.module_scope)[c.graph.files.items(.input_file)[Index.runtime.value].get()];
    var runtime_members = &runtime_scope.members;
    const toCommonJSRef = c.graph.symbols.follow(runtime_members.get("__toCommonJS").?.ref);
    const toESMRef = c.graph.symbols.follow(runtime_members.get("__toESM").?.ref);
    const runtimeRequireRef = if (c.options.output_format == .cjs) null else c.graph.symbols.follow(runtime_members.get("__require").?.ref);

    const result = c.generateCodeForFileInChunkJS(
        &buffer_writer,
        chunk.renamer,
        chunk,
        part_range,
        toCommonJSRef,
        toESMRef,
        runtimeRequireRef,
        &worker.stmt_list,
        worker.allocator,
        arena.allocator(),
    );

    // Update bytesInOutput for this source in the chunk (for metafile)
    // Use atomic operation since multiple threads may update the same counter
    const code_len = switch (result) {
        .result => |r| r.code.len,
        else => 0,
    };
    if (code_len > 0 and !part_range.source_index.isRuntime()) {
        if (chunk.files_with_parts_in_chunk.getPtr(part_range.source_index.get())) |bytes_ptr| {
            _ = @atomicRmw(usize, bytes_ptr, .Add, code_len, .monotonic);
        }
    }

    return .{
        .javascript = .{
            .source_index = part_range.source_index.get(),
            .result = result,
        },
    };
}

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ParseTask = bun.bundle_v2.ParseTask;

const bun = @import("bun");
const Environment = bun.Environment;
const ThreadPoolLib = bun.ThreadPool;
const default_allocator = bun.default_allocator;
const js_printer = bun.js_printer;
const renamer = bun.renamer;

const js_ast = bun.ast;
const Scope = js_ast.Scope;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const CompileResult = bundler.CompileResult;
const Index = bun.bundle_v2.Index;
const PartRange = bundler.PartRange;
const ThreadPool = bun.bundle_v2.ThreadPool;

const LinkerContext = bun.bundle_v2.LinkerContext;
const PendingPartRange = LinkerContext.PendingPartRange;
