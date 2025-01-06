const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const ImportRecord = @import("./import_record.zig").ImportRecord;
const ImportKind = @import("./import_record.zig").ImportKind;
const lol = @import("./deps/lol-html.zig");
const logger = bun.logger;
const fs = bun.fs;

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
    this.import_records.deinitWithAllocator(this.allocator);
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

    try this.import_records.push(this.allocator, record);
}

const debug = bun.Output.scoped(.HTMLScanner, true);

pub fn onWriteHTML(this: *HTMLScanner, bytes: []const u8) void {
    _ = this; // autofix
    _ = bytes; // autofix
}

pub fn onHTMLParseError(this: *HTMLScanner, message: []const u8) void {
    this.log.addError(
        this.source,
        logger.Loc.Empty,
        message,
    ) catch bun.outOfMemory();
}

pub fn onTag(this: *HTMLScanner, _: *lol.Element, path: []const u8, url_attribute: []const u8, kind: ImportKind) void {
    _ = url_attribute; // autofix
    this.createImportRecord(path, kind) catch {};
}

const processor = HTMLProcessor(HTMLScanner, false);

pub fn scan(this: *HTMLScanner, input: []const u8) !void {
    try processor.run(this, input);
}

pub fn HTMLProcessor(comptime T: type, comptime add_head_or_html_tag: bool) type {
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

        const tag_handlers_ = [_]TagHandler{
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
            // Catch-all for other links with href
            .{
                .selector = "link:not([rel~='stylesheet']):not([rel~='modulepreload']):not([rel~='manifest']):not([rel~='icon']):not([rel~='apple-touch-icon'])[href]",
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

        const html_head_tag_handler: TagHandler = .{
            .selector = "head",
            .has_content = false,
            .url_attribute = "",
            .kind = .stmt,
            .is_head_or_html = true,
        };

        const tag_handlers = if (add_head_or_html_tag) tag_handlers_ ++ [_]TagHandler{html_head_tag_handler} else tag_handlers_;

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

                    if (comptime add_head_or_html_tag) {
                        if (tag_info.is_head_or_html) {
                            T.onHEADTag(this, element);
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
            var selectors = try std.ArrayList(*lol.HTMLSelector).initCapacity(this.allocator, tag_handlers.len);
            defer {
                for (selectors.items) |selector| {
                    selector.deinit();
                }
                selectors.deinit();
            }
            // Add handlers for each tag type
            inline for (tag_handlers) |tag_info| {
                const selector = try lol.HTMLSelector.parse(tag_info.selector);
                try selectors.append(selector);

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
                struct {
                    fn write(self: *T, bytes: []const u8) void {
                        self.onWriteHTML(bytes);
                    }
                }.write,
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

const HTMLScanner = @This();
