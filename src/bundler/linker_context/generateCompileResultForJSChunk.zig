pub fn generateCompileResultForJSChunk(task: *ThreadPoolLib.Task) void {
    const part_range: *const PendingPartRange = @fieldParentPtr("task", task);
    const ctx = part_range.ctx;
    defer ctx.wg.finish();
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
        if (bun.CLI.debug_flags.hasPrintBreakpoint(path)) {
            @breakpoint();
        }
    }

    ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForJSChunkImpl(worker, ctx.c, ctx.chunk, part_range.part_range);
}

fn generateCompileResultForJSChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, part_range: PartRange) CompileResult {
    const trace = bun.perf.trace("Bundler.generateCodeForFileInChunkJS");
    defer trace.end();

    // Client bundles for Bake must be globally allocated,
    // as it must outlive the bundle task.
    const allocator = if (c.dev_server) |dev|
        if (c.parse_graph.ast.items(.target)[part_range.source_index.get()].bakeGraph() == .client)
            dev.allocator
        else
            default_allocator
    else
        default_allocator;

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

    return .{
        .javascript = .{
            .result = result,
            .source_index = part_range.source_index.get(),
        },
    };
}

const bun = @import("bun");
const Index = bun.bundle_v2.Index;
const js_printer = bun.js_printer;
const LinkerContext = bun.bundle_v2.LinkerContext;
const ThreadPool = bun.bundle_v2.ThreadPool;
const ThreadPoolLib = bun.ThreadPool;

const Environment = bun.Environment;
const default_allocator = bun.default_allocator;

const js_ast = bun.js_ast;

const renamer = bun.renamer;
const Scope = js_ast.Scope;
const bundler = bun.bundle_v2;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ParseTask = bun.bundle_v2.ParseTask;
const Chunk = bundler.Chunk;
const PartRange = bundler.PartRange;
const CompileResult = bundler.CompileResult;
const PendingPartRange = LinkerContext.PendingPartRange;
