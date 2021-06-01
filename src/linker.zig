usingnamespace @import("global.zig");
usingnamespace @import("./ast/base.zig");

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const Options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const panicky = @import("panic_handler.zig");
const Fs = @import("fs.zig");
const Api = @import("api/schema.zig").Api;
const Resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ThreadPool = sync.ThreadPool;
const ThreadSafeHashMap = @import("./thread_safe_hash_map.zig");
const ImportRecord = @import("./import_record.zig").ImportRecord;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const _bundler = @import("./bundler.zig");
const Bundler = _bundler.Bundler;
const ResolveQueue = _bundler.ResolveQueue;

pub const Linker = struct {
    allocator: *std.mem.Allocator,
    options: *Options.BundleOptions,
    fs: *Fs.FileSystem,
    log: *logger.Log,
    resolve_queue: *ResolveQueue,
    resolver: *Resolver.Resolver,
    resolve_results: *_bundler.ResolveResults,
    any_needs_runtime: bool = false,
    runtime_import_record: ?ImportRecord = null,
    runtime_source_path: string,

    pub fn init(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        resolve_queue: *ResolveQueue,
        options: *Options.BundleOptions,
        resolver: *Resolver.Resolver,
        resolve_results: *_bundler.ResolveResults,
        fs: *Fs.FileSystem,
    ) Linker {
        relative_paths_list = ImportPathsList.init(allocator);

        return Linker{
            .allocator = allocator,
            .options = options,
            .fs = fs,
            .log = log,
            .resolve_queue = resolve_queue,
            .resolver = resolver,
            .resolve_results = resolve_results,
            .runtime_source_path = fs.joinAlloc(allocator, &[_]string{"__runtime.js"}) catch unreachable,
        };
    }

    // fs: fs.FileSystem,
    // TODO:
    pub fn requireOrImportMetaForSource(c: Linker, source_index: Ref.Int) RequireOrImportMeta {
        return RequireOrImportMeta{};
    }

    // This modifies the Ast in-place!
    // But more importantly, this does the following:
    // - Wrap CommonJS files
    pub fn link(linker: *Linker, file_path: Fs.Path, result: *Bundler.ParseResult) !void {
        var needs_runtime = false;
        const source_dir = file_path.name.dir;
        var externals = std.ArrayList(u32).init(linker.allocator);

        // Step 1. Resolve imports & requires
        switch (result.loader) {
            .jsx, .js, .ts, .tsx => {
                for (result.ast.import_records) |*import_record, record_index| {
                    if (linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*resolved_import| {
                        if (resolved_import.is_external) {
                            externals.append(@truncate(u32, record_index)) catch unreachable;
                        }
                        linker.processImportRecord(
                            // Include trailing slash
                            file_path.text[0 .. source_dir.len + 1],
                            resolved_import,
                            import_record,
                        ) catch continue;
                        import_record.wrap_with_to_module = resolved_import.shouldAssumeCommonJS(import_record);
                        if (import_record.wrap_with_to_module) {
                            if (!linker.any_needs_runtime) {
                                linker.any_needs_runtime = true;
                            }
                            needs_runtime = true;
                        }
                    } else |err| {
                        switch (err) {
                            error.ModuleNotFound => {
                                if (Resolver.Resolver.isPackagePath(import_record.path.text)) {
                                    if (linker.options.platform != .node and Options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                        try linker.log.addRangeErrorFmt(
                                            &result.source,
                                            import_record.range,
                                            linker.allocator,
                                            "Could not resolve: \"{s}\". Try setting --platform=\"node\"",
                                            .{import_record.path.text},
                                        );
                                    } else {
                                        try linker.log.addRangeErrorFmt(
                                            &result.source,
                                            import_record.range,
                                            linker.allocator,
                                            "Could not resolve: \"{s}\". Maybe you need to \"npm install\" (or yarn/pnpm)?",
                                            .{import_record.path.text},
                                        );
                                    }
                                } else {
                                    try linker.log.addRangeErrorFmt(
                                        &result.source,
                                        import_record.range,
                                        linker.allocator,
                                        "Could not resolve: \"{s}\"",
                                        .{
                                            import_record.path.text,
                                        },
                                    );
                                    continue;
                                }
                            },
                            else => {
                                continue;
                            },
                        }
                    }
                }
            },
            else => {},
        }

        // Step 2.

        result.ast.externals = externals.toOwnedSlice();

        if (needs_runtime) {
            std.debug.assert(!result.ast.needs_runtime);
            result.ast.runtime_import_record = ImportRecord{
                .path = try linker.generateImportPath(
                    source_dir,
                    linker.runtime_source_path,
                ),
                .range = logger.Range.None,
                .kind = .internal,
            };
            result.ast.needs_runtime = true;
        }
    }

    const ImportPathsList = allocators.BSSStringList(512, 128);
    pub var relative_paths_list: *ImportPathsList = undefined;
    threadlocal var relative_path_allocator: std.heap.FixedBufferAllocator = undefined;
    threadlocal var relative_path_allocator_buf: [4096]u8 = undefined;
    threadlocal var relative_path_allocator_buf_loaded: bool = false;

    pub fn generateImportPath(linker: *Linker, source_dir: string, source_path: string) !Fs.Path {
        if (!relative_path_allocator_buf_loaded) {
            relative_path_allocator_buf_loaded = true;
            relative_path_allocator = std.heap.FixedBufferAllocator.init(&relative_path_allocator_buf);
        }
        defer relative_path_allocator.reset();

        var pretty = try relative_paths_list.append(linker.fs.relative(source_dir, source_path));
        var pathname = Fs.PathName.init(pretty);
        var absolute_pathname = Fs.PathName.init(source_path);

        if (linker.options.out_extensions.get(absolute_pathname.ext)) |ext| {
            absolute_pathname.ext = ext;
        }

        switch (linker.options.import_path_format) {
            .relative => {
                return Fs.Path.initWithPretty(pretty, pretty);
            },
            .relative_nodejs => {
                var path = Fs.Path.initWithPretty(pretty, pretty);
                path.text = path.text[0 .. path.text.len - path.name.ext.len];
                return path;
            },

            .absolute_url => {
                const absolute_url = try relative_paths_list.append(
                    try std.fmt.allocPrint(
                        &relative_path_allocator.allocator,
                        "{s}{s}{s}{s}",
                        .{
                            linker.options.public_url,
                            pathname.dir,
                            pathname.base,
                            absolute_pathname.ext,
                        },
                    ),
                );

                return Fs.Path.initWithPretty(absolute_url, pretty);
            },

            else => unreachable,
        }
    }

    pub fn processImportRecord(linker: *Linker, source_dir: string, resolve_result: *Resolver.Resolver.Result, import_record: *ImportRecord) !void {

        // extremely naive.
        resolve_result.is_from_node_modules = strings.contains(resolve_result.path_pair.primary.text, "/node_modules");

        // lazy means:
        // Run the resolver
        // Don't parse/print automatically.
        if (linker.options.resolve_mode != .lazy) {
            try linker.enqueueResolveResult(resolve_result);
        }

        import_record.path = try linker.generateImportPath(source_dir, resolve_result.path_pair.primary.text);
    }

    pub fn resolveResultHashKey(linker: *Linker, resolve_result: *const Resolver.Resolver.Result) string {
        var hash_key = resolve_result.path_pair.primary.text;

        // Shorter hash key is faster to hash
        if (strings.startsWith(resolve_result.path_pair.primary.text, linker.fs.top_level_dir)) {
            hash_key = resolve_result.path_pair.primary.text[linker.fs.top_level_dir.len..];
        }

        return hash_key;
    }

    pub fn enqueueResolveResult(linker: *Linker, resolve_result: *const Resolver.Resolver.Result) !void {
        const hash_key = linker.resolveResultHashKey(resolve_result);

        const get_or_put_entry = try linker.resolve_results.backing.getOrPut(hash_key);

        if (!get_or_put_entry.found_existing) {
            get_or_put_entry.entry.value = resolve_result.*;
            try linker.resolve_queue.writeItem(resolve_result.*);
        }
    }
};
