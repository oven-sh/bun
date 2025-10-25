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
        output: std.ArrayList(u8),
        end_tag_indices: struct {
            head: ?u32 = 0,
            body: ?u32 = 0,
            html: ?u32 = 0,
        },
        added_head_tags: bool,
        /// Track where we found script tags: null = not found, false = in head, true = in body
        script_in_body: ?bool = null,
        /// Track which section we're currently in
        current_section: enum { none, head, body } = .none,

        pub fn onWriteHTML(this: *@This(), bytes: []const u8) void {
            bun.handleOom(this.output.appendSlice(bytes));
        }

        pub fn onHTMLParseError(_: *@This(), err: []const u8) void {
            Output.panic("Parsing HTML during replacement phase errored, which should never happen since the first pass succeeded: {s}", .{err});
        }

        pub fn onTag(this: *@This(), element: *lol.Element, _: []const u8, url_attribute: []const u8, kind: ImportKind) void {
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

            // Track if this is a script tag and where it's located
            const is_script = kind == .stmt and loader.isJavaScriptLike();
            if (is_script and this.script_in_body == null) {
                // First script tag - record its location
                this.script_in_body = (this.current_section == .body);
            }

            if (import_record.is_external_without_side_effects) {
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
            this.current_section = .head;
            element.onEndTag(endHeadTagHandler, this) catch return true;
            return false;
        }

        pub fn onHtmlTag(this: *@This(), element: *lol.Element) bool {
            element.onEndTag(endHtmlTagHandler, this) catch return true;
            return false;
        }

        pub fn onBodyTag(this: *@This(), element: *lol.Element) bool {
            this.current_section = .body;
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
                const link_tag = bun.handleOom(std.fmt.allocPrintZ(allocator, "<link rel=\"stylesheet\" crossorigin href=\"{s}\">", .{css_chunk.unique_key}));
                array.appendAssumeCapacity(link_tag);
            }
            if (this.chunk.getJSChunkForHTML(this.chunks)) |js_chunk| {
                // type="module" scripts do not block rendering, placement is determined by original script location
                const script = bun.handleOom(std.fmt.allocPrintZ(allocator, "<script type=\"module\" crossorigin src=\"{s}\"></script>", .{js_chunk.unique_key}));
                array.appendAssumeCapacity(script);
            }
            return array;
        }

        fn endHeadTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.C) lol.Directive {
            const this: *@This() = @alignCast(@ptrCast(opaque_this.?));
            if (this.linker.dev_server == null) {
                // Only inject if scripts were explicitly found in head (script_in_body == false)
                // If script_in_body is null, we haven't seen any scripts yet, so defer injection
                if (this.script_in_body) |in_body| {
                    if (!in_body) {
                        // Scripts were in head, inject here
                        this.addHeadTags(end) catch return .stop;
                    }
                }
            } else {
                this.end_tag_indices.head = @intCast(this.output.items.len);
            }
            return .@"continue";
        }

        fn endBodyTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.C) lol.Directive {
            const this: *@This() = @alignCast(@ptrCast(opaque_this.?));
            if (this.linker.dev_server == null) {
                // Only inject if scripts were explicitly found in body (script_in_body == true)
                // If script_in_body is null, we haven't seen any scripts yet, defer to html tag fallback
                if (this.script_in_body) |in_body| {
                    if (in_body) {
                        // Scripts were in body, inject here
                        this.addHeadTags(end) catch return .stop;
                    }
                }
            } else {
                this.end_tag_indices.body = @intCast(this.output.items.len);
            }
            return .@"continue";
        }

        fn endHtmlTagHandler(_: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.C) lol.Directive {
            const this: *@This() = @alignCast(@ptrCast(opaque_this.?));
            if (this.linker.dev_server != null) {
                this.end_tag_indices.html = @intCast(this.output.items.len);
            }
            // For production bundling, don't inject here - let post-processing handle it
            // so we can search for </head> and inject there for HTML with no scripts
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
        .output = std.ArrayList(u8).init(output_allocator),
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

    // There are some cases where invalid HTML will make it so the end tag is
    // never emitted, even if the literal text DOES appear. These cases are
    // along the lines of having a self-closing tag for a non-self closing
    // element. In this case, we do a simple search through the page.
    // See https://github.com/oven-sh/bun/issues/17554
    const script_injection_offset: u32 = if (c.dev_server != null) brk: {
        // Dev server logic - try head first, then body, then html, then end of file
        if (html_loader.end_tag_indices.head) |idx|
            break :brk idx;
        if (bun.strings.indexOf(html_loader.output.items, "</head>")) |idx|
            break :brk @intCast(idx);
        if (html_loader.end_tag_indices.body) |body|
            break :brk body;
        if (html_loader.end_tag_indices.html) |html|
            break :brk html;
        break :brk @intCast(html_loader.output.items.len); // inject at end of file.
    } else brk: {
        if (!html_loader.added_head_tags) {
            // If we never injected during parsing, try to inject at </head> position
            // This happens when the HTML has no scripts in the source
            if (bun.strings.indexOf(html_loader.output.items, "</head>")) |head_idx| {
                // Found </head>, insert before it
                var html_appender = std.heap.stackFallback(256, bun.default_allocator);
                const allocator = html_appender.get();
                const slices = html_loader.getHeadTags(allocator);
                defer for (slices.slice()) |slice|
                    allocator.free(slice);

                // Calculate total size needed for inserted tags
                var total_insert_size: usize = 0;
                for (slices.slice()) |slice|
                    total_insert_size += slice.len;

                // Make room for the tags before </head>
                const old_len = html_loader.output.items.len;
                bun.handleOom(html_loader.output.resize(old_len + total_insert_size));

                // Move everything after </head> to make room
                const items = html_loader.output.items;
                std.mem.copyBackwards(u8, items[head_idx + total_insert_size .. items.len], items[head_idx..old_len]);

                // Insert the tags
                var offset: usize = head_idx;
                for (slices.slice()) |slice| {
                    @memcpy(items[offset .. offset + slice.len], slice);
                    offset += slice.len;
                }
            } else {
                @branchHint(.cold); // this is if the document is missing all head, body, and html elements.
                // No </head> tag found - fallback to appending at end
                var html_appender = std.heap.stackFallback(256, bun.default_allocator);
                const allocator = html_appender.get();
                const slices = html_loader.getHeadTags(allocator);
                for (slices.slice()) |slice| {
                    bun.handleOom(html_loader.output.appendSlice(slice));
                    allocator.free(slice);
                }
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
