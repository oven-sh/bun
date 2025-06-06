pub fn generateCompileResultForCssChunk(task: *ThreadPoolLib.Task) void {
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

    ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForCssChunkImpl(worker, ctx.c, ctx.chunk, part_range.i);
}

fn generateCompileResultForCssChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, imports_in_chunk_index: u32) CompileResult {
    const trace = bun.perf.trace("Bundler.generateCodeForFileInChunkCss");
    defer trace.end();

    var arena = &worker.temporary_arena;
    var buffer_writer = js_printer.BufferWriter.init(worker.allocator);
    defer _ = arena.reset(.retain_capacity);

    const css_import = chunk.content.css.imports_in_chunk_in_order.at(imports_in_chunk_index);
    const css: *const bun.css.BundlerStyleSheet = &chunk.content.css.asts[imports_in_chunk_index];
    // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
    const symbols = &c.graph.symbols;

    switch (css_import.kind) {
        .layers => {
            const printer_options = bun.css.PrinterOptions{
                // TODO: make this more configurable
                .minify = c.options.minify_whitespace,
                .targets = bun.css.Targets.forBundlerTarget(c.options.target),
            };
            _ = switch (css.toCssWithWriter(
                worker.allocator,
                &buffer_writer,
                printer_options,
                .{
                    .import_records = &css_import.condition_import_records,
                    .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                    .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                },
                &c.mangled_props,
                // layer does not need symbols i think
                symbols,
            )) {
                .result => {},
                .err => {
                    return CompileResult{
                        .css = .{
                            .result = .{ .err = error.PrintError },
                            .source_index = Index.invalid.get(),
                        },
                    };
                },
            };
            return CompileResult{
                .css = .{
                    .result = .{ .result = buffer_writer.getWritten() },
                    .source_index = Index.invalid.get(),
                },
            };
        },
        .external_path => {
            var import_records = BabyList(ImportRecord).init(css_import.condition_import_records.sliceConst());
            const printer_options = bun.css.PrinterOptions{
                // TODO: make this more configurable
                .minify = c.options.minify_whitespace,
                .targets = bun.css.Targets.forBundlerTarget(c.options.target),
            };
            _ = switch (css.toCssWithWriter(
                worker.allocator,
                &buffer_writer,
                printer_options,
                .{
                    .import_records = &import_records,
                    .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                    .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                },
                &c.mangled_props,
                // external_path does not need symbols i think
                symbols,
            )) {
                .result => {},
                .err => {
                    return CompileResult{
                        .css = .{
                            .result = .{ .err = error.PrintError },
                            .source_index = Index.invalid.get(),
                        },
                    };
                },
            };
            return CompileResult{
                .css = .{
                    .result = .{ .result = buffer_writer.getWritten() },

                    .source_index = Index.invalid.get(),
                },
            };
        },
        .source_index => |idx| {
            const printer_options = bun.css.PrinterOptions{
                .targets = bun.css.Targets.forBundlerTarget(c.options.target),
                // TODO: make this more configurable
                .minify = c.options.minify_whitespace or c.options.minify_syntax or c.options.minify_identifiers,
            };
            _ = switch (css.toCssWithWriter(
                worker.allocator,
                &buffer_writer,
                printer_options,
                .{
                    .import_records = &c.graph.ast.items(.import_records)[idx.get()],
                    .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                    .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                },
                &c.mangled_props,
                symbols,
            )) {
                .result => {},
                .err => {
                    return CompileResult{
                        .css = .{
                            .result = .{ .err = error.PrintError },
                            .source_index = idx.get(),
                        },
                    };
                },
            };
            return CompileResult{
                .css = .{
                    .result = .{ .result = buffer_writer.getWritten() },
                    .source_index = idx.get(),
                },
            };
        },
    }
}

const bun = @import("bun");
const resolve_path = bun.bundle_v2.resolve_path;
const Fs = bun.bundle_v2.Fs;
const options = bun.options;
const Loader = bun.Loader;
const HTMLScanner = bun.bundle_v2.HTMLScanner;
const Ref = bun.bundle_v2.Ref;
const BabyList = bun.BabyList;
const DataURL = bun.bundle_v2.DataURL;
const Logger = bun.logger;
const Index = bun.bundle_v2.Index;
const Loc = Logger.Loc;
const js_printer = bun.js_printer;
const LinkerContext = bun.bundle_v2.LinkerContext;
const ThreadPoolLib = bun.ThreadPool;

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
pub const ThreadPool = bun.bundle_v2.ThreadPool;
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
