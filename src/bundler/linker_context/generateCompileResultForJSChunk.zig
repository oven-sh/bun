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

const debug = LinkerContext.debug;

const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;

const std = @import("std");
const js_parser = bun.js_parser;
const Part = js_ast.Part;
const js_ast = bun.js_ast;
const sourcemap = bun.sourcemap;
const StringJoiner = bun.StringJoiner;
const base64 = bun.base64;
const sync = bun.ThreadPool;
const ImportRecord = bun.ImportRecord;
const ImportKind = bun.ImportKind;

const Dependency = js_ast.Dependency;
const JSAst = js_ast.BundledAst;
const Symbol = js_ast.Symbol;
const EventLoop = bun.JSC.AnyEventLoop;
const MultiArrayList = bun.MultiArrayList;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;
const Binding = js_ast.Binding;
const AutoBitSet = bun.bit_set.AutoBitSet;
const renamer = bun.renamer;
const StableSymbolCount = renamer.StableSymbolCount;
const MinifyRenamer = renamer.MinifyRenamer;
const Scope = js_ast.Scope;
const JSC = bun.JSC;
const debugTreeShake = Output.scoped(.TreeShake, true);
const debugPartRanges = Output.scoped(.PartRanges, true);
const BitSet = bun.bit_set.DynamicBitSetUnmanaged;
const bake = bun.bake;
const lol = bun.LOLHTML;
const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;
const Graph = bundler.Graph;
const LinkerGraph = bundler.LinkerGraph;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ParseTask = bun.bundle_v2.ParseTask;
const ImportTracker = bundler.ImportTracker;
const MangledProps = bundler.MangledProps;
const Chunk = bundler.Chunk;
const ServerComponentBoundary = bundler.ServerComponentBoundary;
const PathTemplate = bundler.PathTemplate;
const PartRange = bundler.PartRange;
const JSMeta = bundler.JSMeta;
const ExportData = bundler.ExportData;
const EntryPoint = bundler.EntryPoint;
const ResolvedExports = bundler.ResolvedExports;
const RefImportData = bundler.RefImportData;
const ImportData = bundler.ImportData;
const CrossChunkImport = bundler.CrossChunkImport;
const StableRef = bundler.StableRef;
const CompileResult = bundler.CompileResult;
const CompileResultForSourceMap = bundler.CompileResultForSourceMap;
const ContentHasher = bundler.ContentHasher;
const WrapKind = bundler.WrapKind;
const genericPathWithPrettyInitialized = bundler.genericPathWithPrettyInitialized;
const cheapPrefixNormalizer = bundler.cheapPrefixNormalizer;
const AdditionalFile = bundler.AdditionalFile;
const logPartDependencyTree = bundler.logPartDependencyTree;
const PendingPartRange = LinkerContext.PendingPartRange;
