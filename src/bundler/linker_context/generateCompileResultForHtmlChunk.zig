/// Rrewrite the HTML with the following transforms:
/// 1. Remove all <script> and <link> tags which were not marked as
///    external. This is defined by the source_index on the ImportRecord,
///    when it's not Index.invalid then we update it accordingly. This will
///    need to be a reference to the chunk or asset.
/// 2. For all other non-external URLs, update the "src" or "href"
///    attribute to point to the asset's unique key. Later, when joining
///    chunks, we will rewrite these to their final URL or pathname,
///    including the public_path.
/// 3. If a JavaScript chunk exists, add a <script type="module" crossorigin> tag that contains
///    the JavaScript for the entry point which uses the "src" attribute
///    to point to the JavaScript chunk's unique key.
/// 4. If a CSS chunk exists, add a <link rel="stylesheet" href="..." crossorigin> tag that contains
///    the CSS for the entry point which uses the "href" attribute to point to the
///    CSS chunk's unique key.
/// 5. For each imported module or chunk within the JavaScript code, add
///    a <link rel="modulepreload" href="..." crossorigin> tag that
///    points to the module or chunk's unique key so that we tell the
///    browser to preload the user's code.
pub fn generateCompileResultForHtmlChunk(task: *ThreadPoolLib.Task) void {
    const part_range: *const PendingPartRange = @fieldParentPtr("task", task);
    const ctx = part_range.ctx;
    var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
    defer worker.unget();

    ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForHTMLChunkImpl(worker, ctx.c, ctx.chunk, ctx.chunks);
}

fn generateCompileResultForHTMLChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, chunks: []Chunk) CompileResult {
    const parse_graph = c.parse_graph;
    const input_files = parse_graph.input_files.slice();
    const sources = input_files.items(.source);
    const import_records = c.graph.ast.items(.import_records);

    const HTMLLoader = struct {
        linker: *LinkerContext,
        source_index: Index.Int,
        import_records: []const ImportRecord,
        log: *Logger.Log,
        allocator: std.mem.Allocator,
        current_import_record_index: u32 = 0,
        chunk: *Chunk,
        chunks: []Chunk,
        minify_whitespace: bool,
        output: std.array_list.Managed(u8),
        end_tag_indices: struct {
            head: ?u32 = 0,
            body: ?u32 = 0,
            html: ?u32 = 0,
        },
        added_head_tags: bool,

        pub fn onWriteHTML(this: *@This(), bytes: []const u8) void {
            bun.handleOom(this.output.appendSlice(bytes));
        }

        pub fn onHTMLParseError(_: *@This(), err: []const u8) void {
            Output.panic("Parsing HTML during replacement phase errored, which should never happen since the first pass succeeded: {s}", .{err});
        }

        pub fn onTag(this: *@This(), element: *lol.Element, _: []const u8, url_attribute: []const u8, _: ImportKind) void {
            if (this.current_import_record_index >= this.import_records.len) {
                Output.panic("Assertion failure in HTMLLoader.onTag: current_import_record_index ({d}) >= import_records.len ({d})", .{ this.current_import_record_index, this.import_records.len });
            }

            const import_record: *const ImportRecord = &this.import_records[this.current_import_record_index];
            this.current_import_record_index += 1;
            const unique_key_for_additional_files = if (import_record.source_index.isValid())
                this.linker.parse_graph.input_files.items(.unique_key_for_additional_file)[import_record.source_index.get()]
            else
                "";
            const loader: Loader = if (import_record.source_index.isValid())
                this.linker.parse_graph.input_files.items(.loader)[import_record.source_index.get()]
            else
                .file;

            if (import_record.flags.is_external_without_side_effects) {
                debug("Leaving external import: {s}", .{import_record.path.text});
                return;
            }

            if (this.linker.dev_server != null) {
                if (unique_key_for_additional_files.len > 0) {
                    element.setAttribute(url_attribute, unique_key_for_additional_files) catch {
                        std.debug.panic("unexpected error from Element.setAttribute", .{});
                    };
                } else if (import_record.path.is_disabled or loader.isJavaScriptLike() or loader.isCSS()) {
                    element.remove();
                } else {
                    element.setAttribute(url_attribute, import_record.path.pretty) catch {
                        std.debug.panic("unexpected error from Element.setAttribute", .{});
                    };
                }
                return;
            }

            if (import_record.source_index.isInvalid()) {
                debug("Leaving import with invalid source index: {s}", .{import_record.path.text});
                return;
            }

            if (loader.isJavaScriptLike() or loader.isCSS()) {
                // Remove the original non-external tags
                element.remove();
                return;
            }
            if (unique_key_for_additional_files.len > 0) {
                // Replace the external href/src with the unique key so that we later will rewrite it to the final URL or pathname
                element.setAttribute(url_attribute, unique_key_for_additional_files) catch {
                    std.debug.panic("unexpected error from Element.setAttribute", .{});
                };
                return;
            }
        }

        pub fn onHeadTag(this: *@This(), element: *lol.Element) bool {
            element.onEndTag(endHeadTagHandler, this) catch return true;
            return false;
        }

        pub fn onHtmlTag(this: *@This(), element: *lol.Element) bool {
            element.onEndTag(endHtmlTagHandler, this) catch return true;
            return false;
        }

        pub fn onBodyTag(this: *@This(), element: *lol.Element) bool {
            element.onEndTag(endBodyTagHandler, this) catch return true;
            return false;
        }

        /// This is called for head, body, and html; whichever ends up coming first.
        fn addHeadTags(this: *@This(), endTag: *lol.EndTag) !void {
            if (this.added_head_tags) return;
            this.added_head_tags = true;

            var html_appender = std.heap.stackFallback(256, bun.default_allocator);
            const allocator = html_appender.get();
            const slices = this.getHeadTags(allocator);
            defer for (slices.slice()) |slice|
                allocator.free(slice);
            for (slices.slice()) |slice|
                try endTag.before(slice, true);
        }

        fn getHeadTags(this: *@This(), allocator: std.mem.Allocator) bun.BoundedArray([]const u8, 2) {
            var array: bun.BoundedArray([]const u8, 2) = .{};
            // Put CSS before JS to reduce changes of flash of unstyled content
            if (this.chunk.getCSSChunkForHTML(this.chunks)) |css_chunk| {
                const link_tag = bun.handleOom(std.fmt.allocPrintSentinel(allocator, "<link rel=\"stylesheet\" crossorigin href=\"{s}\">", .{css_chunk.unique_key}, 0));
                array.appendAssumeCapacity(link_tag);
            }
            if (this.chunk.getJSChunkForHTML(this.chunks)) |js_chunk| {
                // type="module" scripts do not block rendering, so it is okay to put them in head
                const script = bun.handleOom(std.fmt.allocPrintSentinel(allocator, "<script type=\"module\" crossorigin src=\"{s}\"></script>", .{js_chunk.unique_key}, 0));
                array.appendAssumeCapacity(script);
            }
            return array;
        }

        fn endHeadTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.c) lol.Directive {
            const this: *@This() = @ptrCast(@alignCast(opaque_this.?));
            if (this.linker.dev_server == null) {
                this.addHeadTags(end) catch return .stop;
            } else {
                this.end_tag_indices.head = @intCast(this.output.items.len);
            }
            return .@"continue";
        }

        fn endBodyTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.c) lol.Directive {
            const this: *@This() = @ptrCast(@alignCast(opaque_this.?));
            if (this.linker.dev_server == null) {
                this.addHeadTags(end) catch return .stop;
            } else {
                this.end_tag_indices.body = @intCast(this.output.items.len);
            }
            return .@"continue";
        }

        fn endHtmlTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.c) lol.Directive {
            const this: *@This() = @ptrCast(@alignCast(opaque_this.?));
            if (this.linker.dev_server == null) {
                this.addHeadTags(end) catch return .stop;
            } else {
                this.end_tag_indices.html = @intCast(this.output.items.len);
            }
            return .@"continue";
        }
    };

    // HTML bundles for dev server must be allocated to it, as it must outlive
    // the bundle task. See `DevServer.RouteBundle.HTML.bundled_html_text`
    const output_allocator = if (c.dev_server) |dev| dev.allocator() else worker.allocator;

    var html_loader: HTMLLoader = .{
        .linker = c,
        .source_index = chunk.entry_point.source_index,
        .import_records = import_records[chunk.entry_point.source_index].slice(),
        .log = c.log,
        .allocator = worker.allocator,
        .minify_whitespace = c.options.minify_whitespace,
        .chunk = chunk,
        .chunks = chunks,
        .output = std.array_list.Managed(u8).init(output_allocator),
        .current_import_record_index = 0,
        .end_tag_indices = .{
            .html = null,
            .body = null,
            .head = null,
        },
        .added_head_tags = false,
    };

    HTMLScanner.HTMLProcessor(HTMLLoader, true).run(
        &html_loader,
        sources[chunk.entry_point.source_index].contents,
    ) catch std.debug.panic("unexpected error from HTMLProcessor.run", .{});

    // There are some cases where invalid HTML will make it so </head> is
    // never emitted, even if the literal text DOES appear. These cases are
    // along the lines of having a self-closing tag for a non-self closing
    // element. In this case, head_end_tag_index will be 0, and a simple
    // search through the page is done to find the "</head>"
    // See https://github.com/oven-sh/bun/issues/17554
    const script_injection_offset: u32 = if (c.dev_server != null) brk: {
        if (html_loader.end_tag_indices.head) |head|
            break :brk head;
        if (bun.strings.indexOf(html_loader.output.items, "</head>")) |head|
            break :brk @intCast(head);
        if (html_loader.end_tag_indices.body) |body|
            break :brk body;
        if (html_loader.end_tag_indices.html) |html|
            break :brk html;
        break :brk @intCast(html_loader.output.items.len); // inject at end of file.
    } else brk: {
        if (!html_loader.added_head_tags) {
            @branchHint(.cold); // this is if the document is missing all head, body, and html elements.
            var html_appender = std.heap.stackFallback(256, bun.default_allocator);
            const allocator = html_appender.get();
            const slices = html_loader.getHeadTags(allocator);
            for (slices.slice()) |slice| {
                bun.handleOom(html_loader.output.appendSlice(slice));
                allocator.free(slice);
            }
        }
        break :brk if (Environment.isDebug) undefined else 0; // value is ignored. fail loud if hit in debug
    };

    return .{ .html = .{
        .code = html_loader.output.items,
        .source_index = chunk.entry_point.source_index,
        .script_injection_offset = script_injection_offset,
    } };
}

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const ImportKind = bun.ImportKind;
const ImportRecord = bun.ImportRecord;
const Loader = bun.Loader;
const Logger = bun.logger;
const Output = bun.Output;
const ThreadPoolLib = bun.ThreadPool;
const default_allocator = bun.default_allocator;
const lol = bun.LOLHTML;
const strings = bun.strings;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const CompileResult = bundler.CompileResult;
const HTMLScanner = bun.bundle_v2.HTMLScanner;
const Index = bun.bundle_v2.Index;

const LinkerContext = bun.bundle_v2.LinkerContext;
const PendingPartRange = LinkerContext.PendingPartRange;
const debug = LinkerContext.debug;
