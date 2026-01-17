const HTMLScanner = @This();

allocator: std.mem.Allocator,
import_records: ImportRecord.List = .{},
log: *logger.Log,
source: *const logger.Source,

pub fn init(allocator: std.mem.Allocator, log: *logger.Log, source: *const logger.Source) HTMLScanner {
    return .{
        .allocator = allocator,
        .import_records = .{},
        .log = log,
        .source = source,
    };
}

pub fn deinit(this: *HTMLScanner) void {
    for (this.import_records.slice()) |*record| {
        this.allocator.free(record.path.text);
    }
    this.import_records.deinit(this.allocator);
}

fn createImportRecord(this: *HTMLScanner, input_path: []const u8, kind: ImportKind) !void {
    // In HTML, sometimes people do /src/index.js
    // In that case, we don't want to use the absolute filesystem path, we want to use the path relative to the project root
    const path_to_use = if (input_path.len > 1 and input_path[0] == '/')
        bun.path.joinAbsString(bun.fs.FileSystem.instance.top_level_dir, &[_][]const u8{input_path[1..]}, .auto)

        // Check if imports to (e.g) "App.tsx" are actually relative imoprts w/o the "./"
    else if (input_path.len > 2 and input_path[0] != '.' and input_path[1] != '/') blk: {
        const index_of_dot = std.mem.lastIndexOfScalar(u8, input_path, '.') orelse break :blk input_path;
        const ext = input_path[index_of_dot..];
        if (ext.len > 4) break :blk input_path;
        // /foo/bar/index.html -> /foo/bar
        const dirname: []const u8 = std.fs.path.dirname(this.source.path.text) orelse break :blk input_path;
        const resolved = bun.path.joinAbsString(dirname, &[_][]const u8{input_path}, .auto);
        break :blk if (bun.sys.exists(resolved)) resolved else input_path;
    } else input_path;

    const record = ImportRecord{
        .path = fs.Path.init(try this.allocator.dupeZ(u8, path_to_use)),
        .kind = kind,
        .range = logger.Range.None,
    };

    try this.import_records.append(this.allocator, record);
}

const debug = bun.Output.scoped(.HTMLScanner, .hidden);

pub fn onWriteHTML(_: *HTMLScanner, bytes: []const u8) void {
    _ = bytes; // bytes are not written in scan phase
}

pub fn onHTMLParseError(this: *HTMLScanner, message: []const u8) void {
    this.log.addError(
        this.source,
        logger.Loc.Empty,
        message,
    ) catch |err| bun.handleOom(err);
}

pub fn onTag(this: *HTMLScanner, _: *lol.Element, path: []const u8, url_attribute: []const u8, kind: ImportKind) void {
    _ = url_attribute;
    this.createImportRecord(path, kind) catch {};
}

/// Handle URLs found inside noscript elements (parsed from raw text content)
pub fn onNoscriptUrl(this: *HTMLScanner, path: []const u8, kind: ImportKind) void {
    this.createImportRecord(path, kind) catch {};
}

const processor = HTMLProcessor(HTMLScanner, false);

pub fn scan(this: *HTMLScanner, input: []const u8) !void {
    try processor.run(this, input);
}

pub fn HTMLProcessor(
    comptime T: type,
    /// If the visitor should visit html, head, body
    comptime visit_document_tags: bool,
) type {
    return struct {
        const TagHandler = struct {
            /// CSS selector to match elements
            selector: []const u8,
            /// Whether this tag can have text content that needs to be processed
            has_content: bool = false,
            /// The attribute to extract the URL from
            url_attribute: []const u8,
            /// The kind of import to create
            kind: ImportKind,

            is_head_or_html: bool = false,
        };

        const tag_handlers = [_]TagHandler{
            // Module scripts with src
            .{
                .selector = "script[src]",
                .has_content = false,
                .url_attribute = "src",
                .kind = .stmt,
            },
            // CSS Stylesheets
            .{
                .selector = "link[rel='stylesheet'][href]",
                .url_attribute = "href",
                .kind = .at,
            },

            // CSS Assets
            .{
                .selector = "link[as='style'][href]",
                .url_attribute = "href",
                .kind = .at,
            },
            // Font files
            .{
                .selector = "link[as='font'][href], link[type^='font/'][href]",
                .url_attribute = "href",
                .kind = .url,
            },
            // Image assets
            .{
                .selector = "link[as='image'][href]",
                .url_attribute = "href",
                .kind = .url,
            },
            // Audio/Video assets
            .{
                .selector = "link[as='video'][href], link[as='audio'][href]",
                .url_attribute = "href",
                .kind = .url,
            },
            // Web Workers
            .{
                .selector = "link[as='worker'][href]",
                .url_attribute = "href",
                .kind = .stmt,
            },
            // Manifest files
            .{
                .selector = "link[rel='manifest'][href]",
                .url_attribute = "href",
                .kind = .url,
            },
            // Icons
            .{
                .selector = "link[rel='icon'][href], link[rel='apple-touch-icon'][href]",
                .url_attribute = "href",
                .kind = .url,
            },
            // Images with src
            .{
                .selector = "img[src]",
                .url_attribute = "src",
                .kind = .url,
            },
            // Images with srcset
            .{
                .selector = "img[srcset]",
                .url_attribute = "srcset",
                .kind = .url,
            },
            // Videos with src
            .{
                .selector = "video[src]",
                .url_attribute = "src",
                .kind = .url,
            },
            // Videos with poster
            .{
                .selector = "video[poster]",
                .url_attribute = "poster",
                .kind = .url,
            },
            // Audio with src
            .{
                .selector = "audio[src]",
                .url_attribute = "src",
                .kind = .url,
            },
            // Source elements with src
            .{
                .selector = "source[src]",
                .url_attribute = "src",
                .kind = .url,
            },
            // Source elements with srcset
            .{
                .selector = "source[srcset]",
                .url_attribute = "srcset",
                .kind = .url,
            },
            //     // Iframes
            //     .{
            //         .selector = "iframe[src]",
            //         .url_attribute = "src",
            //         .kind = .url,
            //     },
        };

        /// URL location within noscript content for replacement
        pub const NoscriptUrlLocation = struct {
            start: usize,
            end: usize,
            kind: ImportKind,
        };

        /// Maximum number of URLs we expect to find in a single noscript element
        const max_noscript_urls = 32;

        /// Parse noscript raw text content to find URL locations.
        /// Returns a list of (start, end, kind) tuples for each URL found.
        /// Since lol-html treats noscript content as raw text (scripting flag is enabled),
        /// we manually parse the content to find resource references.
        fn findNoscriptUrls(content: []const u8) bun.BoundedArray(NoscriptUrlLocation, max_noscript_urls) {
            var urls: bun.BoundedArray(NoscriptUrlLocation, max_noscript_urls) = .{};

            // Parse href attributes (for <link> stylesheets)
            var offset: usize = 0;
            while (offset < content.len) {
                // Look for href=" or href='
                if (std.mem.indexOfPos(u8, content, offset, "href=")) |href_pos| {
                    const quote_pos = href_pos + 5;
                    if (quote_pos < content.len) {
                        const quote_char = content[quote_pos];
                        if (quote_char == '"' or quote_char == '\'') {
                            const value_start = quote_pos + 1;
                            if (std.mem.indexOfScalarPos(u8, content, value_start, quote_char)) |value_end| {
                                // Check if this is a stylesheet link by looking for rel="stylesheet" nearby
                                // Note: In streaming mode, the '<' might be in a previous chunk, so we check
                                // for "link" without requiring the '<' prefix
                                const tag_start = std.mem.lastIndexOfScalar(u8, content[0..href_pos], '<') orelse 0;
                                const tag_end = std.mem.indexOfScalarPos(u8, content, href_pos, '>') orelse content.len;
                                const tag_content = content[tag_start..tag_end];
                                // Check for <link or just "link" at start (streaming might split the '<')
                                const is_link = std.mem.indexOf(u8, tag_content, "<link") != null or
                                    (tag_start == 0 and tag_content.len >= 4 and std.mem.startsWith(u8, tag_content, "link"));
                                if (is_link) {
                                    const kind: ImportKind = if (std.mem.indexOf(u8, tag_content, "rel=\"stylesheet\"") != null or
                                        std.mem.indexOf(u8, tag_content, "rel='stylesheet'") != null)
                                        .at
                                    else
                                        .url;
                                    urls.append(.{ .start = value_start, .end = value_end, .kind = kind }) catch break;
                                }
                                offset = value_end + 1;
                                continue;
                            }
                        }
                    }
                    offset = href_pos + 1;
                } else {
                    break;
                }
            }

            // Parse src attributes (for <script>, <img>, <video>, <audio>, <source>)
            offset = 0;
            while (offset < content.len) {
                if (std.mem.indexOfPos(u8, content, offset, "src=")) |src_pos| {
                    // Make sure this is not "srcset="
                    if (src_pos > 0 and content[src_pos - 1] == 'c') {
                        offset = src_pos + 1;
                        continue;
                    }
                    const quote_pos = src_pos + 4;
                    if (quote_pos < content.len) {
                        const quote_char = content[quote_pos];
                        if (quote_char == '"' or quote_char == '\'') {
                            const value_start = quote_pos + 1;
                            if (std.mem.indexOfScalarPos(u8, content, value_start, quote_char)) |value_end| {
                                // Determine the kind based on the tag
                                // Note: In streaming mode, the '<' might be in a previous chunk
                                const tag_start = std.mem.lastIndexOfScalar(u8, content[0..src_pos], '<') orelse 0;
                                const tag_content = content[tag_start..src_pos];
                                const is_script = std.mem.indexOf(u8, tag_content, "<script") != null or
                                    (tag_start == 0 and std.mem.startsWith(u8, tag_content, "script"));
                                const kind: ImportKind = if (is_script)
                                    .stmt
                                else
                                    .url; // img, video, audio, source, etc.
                                urls.append(.{ .start = value_start, .end = value_end, .kind = kind }) catch break;
                                offset = value_end + 1;
                                continue;
                            }
                        }
                    }
                    offset = src_pos + 1;
                } else {
                    break;
                }
            }

            // Parse srcset attributes (for <img>, <source>)
            offset = 0;
            while (offset < content.len) {
                if (std.mem.indexOfPos(u8, content, offset, "srcset=")) |srcset_pos| {
                    const quote_pos = srcset_pos + 7;
                    if (quote_pos < content.len) {
                        const quote_char = content[quote_pos];
                        if (quote_char == '"' or quote_char == '\'') {
                            const value_start = quote_pos + 1;
                            if (std.mem.indexOfScalarPos(u8, content, value_start, quote_char)) |value_end| {
                                urls.append(.{ .start = value_start, .end = value_end, .kind = .url }) catch break;
                                offset = value_end + 1;
                                continue;
                            }
                        }
                    }
                    offset = srcset_pos + 1;
                } else {
                    break;
                }
            }

            // Parse poster attributes (for <video>)
            offset = 0;
            while (offset < content.len) {
                if (std.mem.indexOfPos(u8, content, offset, "poster=")) |poster_pos| {
                    const quote_pos = poster_pos + 7;
                    if (quote_pos < content.len) {
                        const quote_char = content[quote_pos];
                        if (quote_char == '"' or quote_char == '\'') {
                            const value_start = quote_pos + 1;
                            if (std.mem.indexOfScalarPos(u8, content, value_start, quote_char)) |value_end| {
                                urls.append(.{ .start = value_start, .end = value_end, .kind = .url }) catch break;
                                offset = value_end + 1;
                                continue;
                            }
                        }
                    }
                    offset = poster_pos + 1;
                } else {
                    break;
                }
            }

            // Sort by start position to process in order
            std.mem.sort(NoscriptUrlLocation, urls.slice(), {}, struct {
                pub fn lessThan(_: void, a: NoscriptUrlLocation, b: NoscriptUrlLocation) bool {
                    return a.start < b.start;
                }
            }.lessThan);

            return urls;
        }

        fn handleNoscriptText(this: *T, text_chunk: *lol.TextChunk) bool {
            const chunk_content = text_chunk.getContent();
            if (chunk_content.len == 0) return false;

            const content = chunk_content.slice();

            // Find all URLs in the content
            var urls = findNoscriptUrls(content);

            if (urls.len == 0) return false;

            // Call onNoscriptUrl for each URL found
            for (urls.slice()) |url_loc| {
                const url_value = content[url_loc.start..url_loc.end];
                debug("noscript url: {s} kind={}", .{ url_value, url_loc.kind });
                T.onNoscriptUrl(this, url_value, url_loc.kind);
            }

            // If the type has a rewriteNoscriptContent method, use it to replace the content
            if (@hasDecl(T, "rewriteNoscriptContent")) {
                if (T.rewriteNoscriptContent(this, content, urls.slice(), text_chunk)) {
                    return false;
                }
            }

            return false;
        }

        fn generateHandlerForTag(comptime tag_info: TagHandler) fn (*T, *lol.Element) bool {
            const Handler = struct {
                pub fn handle(this: *T, element: *lol.Element) bool {
                    // Handle URL attribute if present
                    if (tag_info.url_attribute.len > 0) {
                        if (element.hasAttribute(tag_info.url_attribute) catch false) {
                            const value = element.getAttribute(tag_info.url_attribute);
                            defer value.deinit();
                            if (value.len > 0) {
                                debug("{s} {s}", .{ tag_info.selector, value.slice() });
                                T.onTag(this, element, value.slice(), tag_info.url_attribute, tag_info.kind);
                            }
                        }
                    }
                    return false;
                }
            };
            return Handler.handle;
        }

        pub fn run(this: *T, input: []const u8) !void {
            var builder = lol.HTMLRewriter.Builder.init();
            defer builder.deinit();

            // +1 for noscript handler
            var selectors: bun.BoundedArray(*lol.HTMLSelector, tag_handlers.len + 1 + if (visit_document_tags) 3 else 0) = .{};
            defer for (selectors.slice()) |selector| {
                selector.deinit();
            };

            // Add handlers for each tag type
            inline for (tag_handlers) |tag_info| {
                const selector = try lol.HTMLSelector.parse(tag_info.selector);
                selectors.appendAssumeCapacity(selector);
                try builder.addElementContentHandlers(
                    selector,
                    T,
                    comptime generateHandlerForTag(tag_info),
                    this,
                    void,
                    null,
                    null,
                    void,
                    null,
                    null,
                );
            }

            // Add noscript handler with text content handler to parse raw content
            // The HTML parser treats noscript content as raw text (scripting flag enabled),
            // so we use a text handler to capture and parse the content manually.
            if (@hasDecl(T, "onNoscriptUrl")) {
                const noscript_selector = try lol.HTMLSelector.parse("noscript");
                selectors.appendAssumeCapacity(noscript_selector);
                try builder.addElementContentHandlers(
                    noscript_selector,
                    void, // No element handler needed
                    null,
                    null,
                    void,
                    null,
                    null,
                    T,
                    handleNoscriptText,
                    this,
                );
            }

            if (visit_document_tags) {
                inline for (.{ "body", "head", "html" }, &.{ T.onBodyTag, T.onHeadTag, T.onHtmlTag }) |tag, cb| {
                    const head_selector = try lol.HTMLSelector.parse(tag);
                    selectors.appendAssumeCapacity(head_selector);
                    try builder.addElementContentHandlers(
                        head_selector,
                        T,
                        cb,
                        this,
                        void,
                        null,
                        null,
                        void,
                        null,
                        null,
                    );
                }
            }

            const memory_settings = lol.MemorySettings{
                .preallocated_parsing_buffer_size = @max(input.len / 4, 1024),
                .max_allowed_memory_usage = 1024 * 1024 * 10,
            };

            errdefer {
                const last_error = lol.HTMLString.lastError();
                defer last_error.deinit();

                if (last_error.len > 0) {
                    this.onHTMLParseError(last_error.slice());
                }
            }

            var rewriter = try builder.build(
                .UTF8,
                memory_settings,
                false,
                T,
                this,
                T.onWriteHTML,
                struct {
                    fn done(_: *T) void {}
                }.done,
            );
            defer rewriter.deinit();

            try rewriter.write(input);
            try rewriter.end();
        }
    };
}

const lol = @import("./deps/lol-html.zig");
const std = @import("std");

const ImportKind = @import("./import_record.zig").ImportKind;
const ImportRecord = @import("./import_record.zig").ImportRecord;

const bun = @import("bun");
const fs = bun.fs;
const logger = bun.logger;
