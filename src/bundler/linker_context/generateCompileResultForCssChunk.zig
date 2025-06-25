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
const options = bun.options;
const BabyList = bun.BabyList;
const Index = bun.bundle_v2.Index;
const js_printer = bun.js_printer;
const LinkerContext = bun.bundle_v2.LinkerContext;
const ThreadPoolLib = bun.ThreadPool;

const Environment = bun.Environment;

const js_ast = bun.js_ast;
const ImportRecord = bun.ImportRecord;

const Symbol = js_ast.Symbol;
const bundler = bun.bundle_v2;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
const Chunk = bundler.Chunk;
const CompileResult = bundler.CompileResult;
const PendingPartRange = LinkerContext.PendingPartRange;
