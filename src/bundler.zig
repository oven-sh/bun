usingnamespace @import("global.zig");

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
const panicky = @import("panic_handler.zig");
const Fs = @import("fs.zig");
const schema = @import("api/schema.zig");
const Api = schema.Api;
const _resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ThreadPool = sync.ThreadPool;
const ThreadSafeHashMap = @import("./thread_safe_hash_map.zig");
const ImportRecord = @import("./import_record.zig").ImportRecord;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const runtime = @import("./runtime.zig");
const Timer = @import("./timer.zig");
const hash_map = @import("hash_map.zig");
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const DebugLogs = _resolver.DebugLogs;
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const Router = @import("./router.zig");

const Css = @import("css_scanner.zig");

pub const ServeResult = struct {
    file: options.OutputFile,
    mime_type: MimeType,
};

// const BundleMap =
pub const ResolveResults = ThreadSafeHashMap.ThreadSafeStringHashMap(_resolver.Result);
pub const ResolveQueue = std.fifo.LinearFifo(_resolver.Result, std.fifo.LinearFifoBufferType.Dynamic);

// How it works end-to-end
// 1. Resolve a file path from input using the resolver
// 2. Look at the extension of that file path, and determine a loader
// 3. If the loader is .js, .jsx, .ts, .tsx, or .json, run it through our JavaScript Parser
// IF serving via HTTP and it's parsed without errors:
// 4. If parsed without errors, generate a strong ETag & write the output to a buffer that sends to the in the Printer.
// 7. Else, write any errors to error page
// IF writing to disk AND it's parsed without errors:
// 4. Write the output to a temporary file.
//    Why? Two reasons.
//    1. At this point, we don't know what the best output path is.
//       Most of the time, you want the shortest common path, which you can't know until you've
//       built & resolved all paths.
//       Consider this directory tree:
//          - /Users/jarred/Code/app/src/index.tsx
//          - /Users/jarred/Code/app/src/Button.tsx
//          - /Users/jarred/Code/app/assets/logo.png
//          - /Users/jarred/Code/app/src/Button.css
//          - /Users/jarred/Code/app/node_modules/react/index.js
//          - /Users/jarred/Code/app/node_modules/react/cjs/react.development.js
//        Remember that we cannot know which paths need to be resolved without parsing the JavaScript.
//        If we stopped here: /Users/jarred/Code/app/src/Button.tsx
//        We would choose /Users/jarred/Code/app/src/ as the directory
//        Then, that would result in a directory structure like this:
//         - /Users/jarred/Code/app/src/Users/jarred/Code/app/node_modules/react/cjs/react.development.js
//        Which is absolutely insane
//
//    2. We will need to write to disk at some point!
//          - If we delay writing to disk, we need to print & allocate a potentially quite large
//          buffer (react-dom.development.js is 550 KB)
//             ^ This is how it used to work!
//          - If we delay printing, we need to keep the AST around. Which breaks all our
//          recycling logic since that could be many many ASTs.
//  5. Once all files are written, determine the shortest common path
//  6. Move all the temporary files to their intended destinations
// IF writing to disk AND it's a file-like loader
// 4. Hash the contents
//     - rewrite_paths.put(absolute_path, hash(file(absolute_path)))
// 5. Resolve any imports of this file to that hash(file(absolute_path))
// 6. Append to the files array with the new filename
// 7. When parsing & resolving is over, just copy the file.
//     - on macOS, ensure it does an APFS shallow clone so that doesn't use disk space
// IF serving via HTTP AND it's a file-like loader:
// 4. Hash the metadata ${absolute_path}-${fstat.mtime}-${fstat.size}
// 5. Use a deterministic prefix so we know what file to look for without copying it
//    Example scenario:
//      GET /logo-SIU3242.png
//      404 Not Found because there is no file named "logo-SIu3242.png"
//    Instead, we can do this:
//      GET /public/SIU3242/logo.png
//      Our server sees "/public/" and knows the next segment will be a token
//      which lets it ignore that when resolving the absolute path on disk
// 6. Compare the current hash with the expected hash
// 7. IF does not match, do a 301 Temporary Redirect to the new file path
//    This adds an extra network request for outdated files, but that should be uncommon.
// 7. IF does match, serve it with that hash as a weak ETag
// 8. This should also just work unprefixed, but that will be served Cache-Control: private, no-store

pub const ParseResult = struct {
    source: logger.Source,
    loader: options.Loader,
    ast: js_ast.Ast,
    input_fd: ?StoredFileDescriptorType = null,
};

pub const ScanResult = struct {
    path: Fs.Path,
    is_node_module: bool = false,
    file_size: u32 = 0,
    import_record_start: u32,
    import_record_length: u32,

    pub const Summary = struct {
        import_records: std.ArrayList(ImportRecord),
        scan_results: std.ArrayList(ScanResult),
        pub fn list(summary: *const Summary) List {
            return List{
                .import_records = summary.import_records.items,
                .scan_results = summary.scan_results.items,
            };
        }
        pub const List = struct {
            import_records: []ImportRecord,
            scan_results: []ScanResult,
        };
    };
};

pub fn NewBundler(cache_files: bool) type {
    return struct {
        pub const Linker = if (cache_files) linker.Linker else linker.ServeLinker;
        pub const Resolver = if (cache_files) _resolver.Resolver else _resolver.ResolverUncached;

        const ThisBundler = @This();

        options: options.BundleOptions,
        log: *logger.Log,
        allocator: *std.mem.Allocator,
        result: options.TransformResult = undefined,
        resolver: Resolver,
        fs: *Fs.FileSystem,
        // thread_pool: *ThreadPool,
        output_files: std.ArrayList(options.OutputFile),
        resolve_results: *ResolveResults,
        resolve_queue: ResolveQueue,
        elapsed: i128 = 0,
        needs_runtime: bool = false,
        router: ?Router = null,

        linker: Linker,
        timer: Timer = Timer{},

        pub const isCacheEnabled = cache_files;

        // to_bundle:

        // thread_pool: *ThreadPool,

        pub fn init(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            opts: Api.TransformOptions,
            existing_bundle: ?*NodeModuleBundle,
        ) !ThisBundler {
            js_ast.Expr.Data.Store.create(allocator);
            js_ast.Stmt.Data.Store.create(allocator);
            var fs = try Fs.FileSystem.init1(
                allocator,
                opts.absolute_working_dir,
            );
            const bundle_options = try options.BundleOptions.fromApi(
                allocator,
                fs,
                log,
                opts,
                existing_bundle,
            );

            // var pool = try allocator.create(ThreadPool);
            // try pool.init(ThreadPool.InitConfig{
            //     .allocator = allocator,
            // });
            return ThisBundler{
                .options = bundle_options,
                .fs = fs,
                .allocator = allocator,
                .resolver = Resolver.init1(allocator, log, fs, bundle_options),
                .log = log,
                // .thread_pool = pool,
                .linker = undefined,
                .result = options.TransformResult{ .outbase = bundle_options.output_dir },
                .resolve_results = try ResolveResults.init(allocator),
                .resolve_queue = ResolveQueue.init(allocator),
                .output_files = std.ArrayList(options.OutputFile).init(allocator),
            };
        }

        pub fn configureLinker(bundler: *ThisBundler) void {
            bundler.linker = Linker.init(
                bundler.allocator,
                bundler.log,
                &bundler.resolve_queue,
                &bundler.options,
                &bundler.resolver,
                bundler.resolve_results,
                bundler.fs,
            );
        }

        pub fn configureFramework(this: *ThisBundler) !void {
            if (this.options.framework) |*framework| {
                var framework_file = this.normalizeEntryPointPath(framework.entry_point);
                var resolved = this.resolver.resolve(
                    this.fs.top_level_dir,
                    framework_file,
                    .entry_point,
                ) catch |err| {
                    Output.prettyErrorln("Failed to load framework: {s}", .{@errorName(err)});
                    Output.flush();
                    this.options.framework = null;
                    return;
                };

                framework.entry_point = try this.allocator.dupe(u8, resolved.path_pair.primary.text);
            }
        }
        pub fn configureRouter(this: *ThisBundler) !void {
            try this.configureFramework();

            // if you pass just a directory, activate the router configured for the pages directory
            // for now:
            // - "." is not supported
            // - multiple pages directories is not supported
            if (this.options.route_config == null and this.options.entry_points.len == 1) {

                // When inferring:
                // - pages directory with a file extension is not supported. e.g. "pages.app/" won't work.
                //     This is a premature optimization to avoid this magical auto-detection we do here from meaningfully increasing startup time if you're just passing a file
                //     readDirInfo is a recursive lookup, top-down instead of bottom-up. It opens each folder handle and potentially reads the package.jsons
                // So it is not fast! Unless it's already cached.
                var paths = [_]string{std.mem.trimLeft(u8, this.options.entry_points[0], "./")};
                if (std.mem.indexOfScalar(u8, paths[0], '.') == null) {
                    var pages_dir_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                    var entry = this.fs.absBuf(&paths, &pages_dir_buf);

                    if (std.fs.path.extension(entry).len == 0) {
                        allocators.constStrToU8(entry).ptr[entry.len] = '/';

                        // Only throw if they actually passed in a route config and the directory failed to load
                        var dir_info_ = this.resolver.readDirInfo(entry) catch return;
                        var dir_info = dir_info_ orelse return;

                        this.options.route_config = options.RouteConfig{
                            .dir = dir_info.abs_path,
                            .extensions = std.mem.span(&options.RouteConfig.DefaultExtensions),
                        };
                        this.router = try Router.init(this.fs, this.allocator, this.options.route_config.?);
                        try this.router.?.loadRoutes(dir_info, Resolver, &this.resolver, std.math.maxInt(u16), true);
                    }
                }
            } else if (this.options.route_config) |*route_config| {
                var paths = [_]string{route_config.dir};
                var entry = this.fs.abs(&paths);
                var dir_info_ = try this.resolver.readDirInfo(entry);
                var dir_info = dir_info_ orelse return error.MissingRoutesDir;

                this.options.route_config = options.RouteConfig{
                    .dir = dir_info.abs_path,
                    .extensions = route_config.extensions,
                };
                this.router = try Router.init(this.fs, this.allocator, this.options.route_config.?);
                try this.router.?.loadRoutes(dir_info, Resolver, &this.resolver, std.math.maxInt(u16), true);
            }
        }

        pub fn resetStore(bundler: *ThisBundler) void {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();
        }

        pub const GenerateNodeModuleBundle = struct {
            module_list: std.ArrayList(Api.JavascriptBundledModule),
            package_list: std.ArrayList(Api.JavascriptBundledPackage),
            header_string_buffer: MutableString,
            // Just need to know if we've already enqueued this one
            resolved_paths: hash_map.StringHashMap(u32),
            package_list_map: std.AutoHashMap(u64, u32),
            resolve_queue: std.fifo.LinearFifo(_resolver.Result, .Dynamic),
            bundler: *ThisBundler,
            allocator: *std.mem.Allocator,
            scan_pass_result: js_parser.ScanPassResult,
            tmpfile: std.fs.File,
            log: *logger.Log,
            tmpfile_byte_offset: u32 = 0,
            code_end_byte_offset: u32 = 0,
            has_jsx: bool = false,

            pub const current_version: u32 = 1;

            // The Speedy Bundle Format
            // Your entire node_modules folder in a single compact file designed for web browsers.
            // A binary JavaScript bundle format prioritizing bundle time and serialization/deserialization time
            pub const magic_bytes = "#!/usr/bin/env speedy\n\n";
            // This makes it possible to do ./path-to-bundle on posix systems you can see the raw JS contents
            // https://en.wikipedia.org/wiki/Magic_number_(programming)#In_files
            // Immediately after the magic bytes, the next character is a uint32 followed by a newline
            // 0x00000000\n
            // That uint32 denotes the byte offset in the file where the code for the bundle ends
            //     - If the value is 0, that means the file did not finish writing or there are no modules
            //     - This imposes a maximum bundle size of around 4,294,967,295 bytes. If your JS is more than 4 GB, you probably should fix that...
            // The raw JavaScript is encoded as a UTF-8 string starting from the current position + 1 until the above byte offset.
            // This uint32 is useful for HTTP servers to separate:
            // - Which part of the bundle is the JS code?
            // - Which part is the metadata?
            // Without needing to do a full pass through the file.
            // The metadata is at the bottom of the file instead of the top because the metadata is generated after the entire bundle is written.
            // The rationale there is:
            // 1. We cannot prepend to a file without a pass over the entire file
            // 2. The metadata is variable-length and that format will change more often. Perhaps different bundlers will generate different metadata.
            // If you have 32 MB of JavaScript dependencies, the only time it's acceptable to do a full pass is when sending it over HTTP via sendfile()
            // So instead, we append to the file after printing each node_module
            // When there are no more modules to process, we generate the metadata
            // To find the metadata, you look at the byte offset: initial_header[magic_bytes.len..initial_header.len - 1]
            // Then, you add that number to initial_header.len
            const initial_header = brk: {
                var buf = std.mem.zeroes([magic_bytes.len + 5]u8);
                std.mem.copy(u8, &buf, magic_bytes);
                var remainder = buf[magic_bytes.len..];
                // Write an invalid byte offset to be updated after the file ends
                std.mem.writeIntNative(u32, remainder[0 .. remainder.len - 1], 0);
                buf[buf.len - 1] = '\n';
                break :brk buf;
            };
            const code_start_byte_offset: u32 = initial_header.len;

            pub fn appendHeaderString(generator: *GenerateNodeModuleBundle, str: string) !Api.StringPointer {
                var offset = generator.header_string_buffer.list.items.len;
                try generator.header_string_buffer.append(str);
                return Api.StringPointer{
                    .offset = @truncate(u32, offset),
                    .length = @truncate(u32, str.len),
                };
            }

            pub fn generate(bundler: *ThisBundler, allocator: *std.mem.Allocator, destination: string) !Api.JavascriptBundleContainer {
                var tmpdir: std.fs.Dir = bundler.fs.tmpdir();
                const tmpname = try bundler.fs.tmpname(".jsb");

                var tmpfile = try tmpdir.createFile(tmpname, .{ .read = isDebug });
                var generator = GenerateNodeModuleBundle{
                    .module_list = std.ArrayList(Api.JavascriptBundledModule).init(allocator),
                    .package_list = std.ArrayList(Api.JavascriptBundledPackage).init(allocator),
                    .scan_pass_result = js_parser.ScanPassResult.init(allocator),
                    .header_string_buffer = try MutableString.init(allocator, 0),
                    .allocator = allocator,
                    .resolved_paths = hash_map.StringHashMap(u32).init(allocator),
                    .resolve_queue = std.fifo.LinearFifo(_resolver.Result, .Dynamic).init(allocator),
                    .bundler = bundler,
                    .tmpfile = tmpfile,
                    .log = bundler.log,
                    .package_list_map = std.AutoHashMap(u64, u32).init(allocator),
                };
                var this = &generator;
                // Always inline the runtime into the bundle
                try generator.appendBytes(&initial_header);
                // If we try to be smart and rely on .written, it turns out incorrect
                const code_start_pos = try this.tmpfile.getPos();
                if (isDebug) {
                    try generator.appendBytes(runtime.Runtime.sourceContent());
                    try generator.appendBytes("\n\n");
                } else {
                    try generator.appendBytes(comptime runtime.Runtime.sourceContent() ++ "\n\n");
                }

                if (bundler.log.level == .verbose) {
                    bundler.resolver.debug_logs = try DebugLogs.init(allocator);
                }

                for (bundler.options.entry_points) |entry_point| {
                    const entry_point_path = bundler.normalizeEntryPointPath(entry_point);
                    const source_dir = bundler.fs.top_level_dir;
                    const resolved = try bundler.linker.resolver.resolve(source_dir, entry_point, .entry_point);
                    try this.resolve_queue.writeItem(resolved);
                }

                while (this.resolve_queue.readItem()) |resolved| {
                    try this.processFile(resolved);
                }

                if (this.has_jsx and this.bundler.options.jsx.supports_fast_refresh) {
                    if (this.bundler.resolver.resolve(
                        this.bundler.fs.top_level_dir,
                        "react-refresh/runtime",
                        .require,
                    )) |refresh_runtime| {
                        if (!this.resolved_paths.contains(refresh_runtime.path_pair.primary.text)) {
                            try this.processFile(refresh_runtime);
                        }
                    } else |err| {}
                }

                // Ensure we never overflow
                this.code_end_byte_offset = @truncate(
                    u32,
                    // Doing this math ourself seems to not necessarily produce correct results
                    (try this.tmpfile.getPos()),
                );

                var javascript_bundle_container = std.mem.zeroes(Api.JavascriptBundleContainer);

                std.sort.sort(
                    Api.JavascriptBundledModule,
                    this.module_list.items,
                    this,
                    GenerateNodeModuleBundle.sortJavascriptModuleByPath,
                );
                var hasher = std.hash.Wyhash.init(0);

                // We want to sort the packages as well as the files
                // The modules sort the packages already
                // So can just copy it in the below loop.
                var sorted_package_list = try allocator.alloc(Api.JavascriptBundledPackage, this.package_list.items.len);

                // At this point, the module_list is sorted.
                if (this.module_list.items.len > 0) {
                    var package_id_i: u32 = 0;
                    var i: usize = 0;
                    // Assumption: node_modules are immutable
                    // Assumption: module files are immutable
                    // (They're not. But, for our purposes that's okay)
                    // The etag is:
                    // - The hash of each module's path in sorted order
                    // - The hash of each module's code size in sorted order
                    // - hash(hash(package_name, package_version))
                    // If this doesn't prove strong enough, we will do a proper content hash
                    // But I want to avoid that overhead unless proven necessary.
                    // There's a good chance we don't even strictly need an etag here.
                    var bytes: [4]u8 = undefined;
                    while (i < this.module_list.items.len) {
                        var current_package_id = this.module_list.items[i].package_id;
                        this.module_list.items[i].package_id = package_id_i;
                        var offset = @truncate(u32, i);

                        i += 1;

                        while (i < this.module_list.items.len and this.module_list.items[i].package_id == current_package_id) : (i += 1) {
                            this.module_list.items[i].package_id = package_id_i;
                            // Hash the file path
                            hasher.update(this.metadataStringPointer(this.module_list.items[i].path));
                            // Then the length of the code
                            std.mem.writeIntNative(u32, &bytes, this.module_list.items[i].code.length);
                            hasher.update(&bytes);
                        }

                        this.package_list.items[current_package_id].modules_offset = offset;
                        this.package_list.items[current_package_id].modules_length = @truncate(u32, i) - offset;

                        // Hash the hash of the package name
                        // it's hash(hash(package_name, package_version))
                        std.mem.writeIntNative(u32, &bytes, this.package_list.items[current_package_id].hash);
                        hasher.update(&bytes);

                        sorted_package_list[package_id_i] = this.package_list.items[current_package_id];
                        package_id_i += 1;
                    }
                }

                var javascript_bundle = std.mem.zeroes(Api.JavascriptBundle);
                javascript_bundle.modules = this.module_list.items;
                javascript_bundle.packages = sorted_package_list;
                javascript_bundle.manifest_string = this.header_string_buffer.list.items;
                const etag_u64 = hasher.final();
                // We store the etag as a ascii hex encoded u64
                // This is so we can send the bytes directly in the HTTP server instead of formatting it as hex each time.
                javascript_bundle.etag = try std.fmt.allocPrint(allocator, "{x}", .{etag_u64});
                javascript_bundle.generated_at = @truncate(u32, @intCast(u64, std.time.milliTimestamp()));

                const basename = std.fs.path.basename(destination);
                const extname = std.fs.path.extension(basename);
                javascript_bundle.import_from_name = try std.fmt.allocPrint(
                    this.allocator,
                    "/{s}.{x}.jsb",
                    .{
                        basename[0 .. basename.len - extname.len],
                        etag_u64,
                    },
                );

                javascript_bundle_container.bundle_format_version = current_version;
                javascript_bundle_container.bundle = javascript_bundle;
                javascript_bundle_container.code_length = this.code_end_byte_offset;

                var start_pos = try this.tmpfile.getPos();
                var tmpwriter = std.io.bufferedWriter(this.tmpfile.writer());
                const SchemaWriter = schema.Writer(@TypeOf(tmpwriter.writer()));
                var schema_file_writer = SchemaWriter.init(tmpwriter.writer());
                try javascript_bundle_container.encode(&schema_file_writer);
                try tmpwriter.flush();

                // sanity check
                if (isDebug) {
                    try this.tmpfile.seekTo(start_pos);
                    var contents = try allocator.alloc(u8, (try this.tmpfile.getEndPos()) - start_pos);
                    var read_bytes = try this.tmpfile.read(contents);
                    var buf = contents[0..read_bytes];
                    var reader = schema.Reader.init(buf, allocator);

                    var decoder = try Api.JavascriptBundleContainer.decode(
                        &reader,
                    );
                    std.debug.assert(decoder.code_length.? == javascript_bundle_container.code_length.?);
                }

                var code_length_bytes: [4]u8 = undefined;
                std.mem.writeIntNative(u32, &code_length_bytes, this.code_end_byte_offset);
                _ = try std.os.pwrite(this.tmpfile.handle, &code_length_bytes, magic_bytes.len);

                const top_dir = try std.fs.openDirAbsolute(this.bundler.fs.top_level_dir, .{});
                _ = C.fchmod(
                    this.tmpfile.handle,
                    // chmod 777
                    0000010 | 0000100 | 0000001 | 0001000 | 0000040 | 0000004 | 0000002 | 0000400 | 0000200 | 0000020,
                );
                try std.os.renameat(tmpdir.fd, tmpname, top_dir.fd, destination);

                // Print any errors at the end
                try this.log.print(Output.errorWriter());
                return javascript_bundle_container;
            }

            pub fn metadataStringPointer(this: *GenerateNodeModuleBundle, ptr: Api.StringPointer) string {
                return this.header_string_buffer.list.items[ptr.offset .. ptr.offset + ptr.length];
            }

            // Since we trim the prefixes, we must also compare the package name
            pub fn sortJavascriptModuleByPath(ctx: *GenerateNodeModuleBundle, a: Api.JavascriptBundledModule, b: Api.JavascriptBundledModule) bool {
                return switch (std.mem.order(u8, ctx.metadataStringPointer(ctx.package_list.items[a.package_id].name), ctx.metadataStringPointer(ctx.package_list.items[b.package_id].name))) {
                    .eq => std.mem.order(u8, ctx.metadataStringPointer(a.path), ctx.metadataStringPointer(b.path)) == .lt,
                    .lt => true,
                    else => false,
                };
            }

            // pub fn sortJavascriptPackageByName(ctx: *GenerateNodeModuleBundle, a: Api.JavascriptBundledPackage, b: Api.JavascriptBundledPackage) bool {
            //     return std.mem.order(u8, ctx.metadataStringPointer(a.name), ctx.metadataStringPointer(b.name)) == .lt;
            // }

            pub fn appendBytes(generator: *GenerateNodeModuleBundle, bytes: anytype) !void {
                try generator.tmpfile.writeAll(bytes);
                generator.tmpfile_byte_offset += @truncate(u32, bytes.len);
            }

            fn processImportRecord(this: *GenerateNodeModuleBundle, import_record: ImportRecord) !void {}
            const node_module_root_string = "node_modules" ++ std.fs.path.sep_str;
            threadlocal var package_key_buf: [512]u8 = undefined;

            fn processFile(this: *GenerateNodeModuleBundle, _resolve: _resolver.Result) !void {
                var resolve = _resolve;
                if (resolve.is_external) return;

                const is_from_node_modules = resolve.isLikelyNodeModule();
                const loader = this.bundler.options.loaders.get(resolve.path_pair.primary.name.ext) orelse .file;
                var bundler = this.bundler;
                defer this.scan_pass_result.reset();
                defer this.bundler.resetStore();
                var file_path = resolve.path_pair.primary;
                var hasher = std.hash.Wyhash.init(0);

                // If we're in a node_module, build that almost normally
                if (is_from_node_modules) {
                    switch (loader) {
                        .jsx,
                        .tsx,
                        .js,
                        .ts,
                        => {
                            const entry = try bundler.resolver.caches.fs.readFile(
                                bundler.fs,
                                file_path.text,
                                resolve.dirname_fd,
                                true,
                                null,
                            );
                            const source = logger.Source.initFile(Fs.File{ .path = file_path, .contents = entry.contents }, bundler.allocator) catch return null;
                            const source_dir = file_path.name.dirWithTrailingSlash();

                            var jsx = bundler.options.jsx;
                            jsx.parse = loader.isJSX();

                            var opts = js_parser.Parser.Options.init(jsx, loader);
                            opts.transform_require_to_import = false;
                            opts.enable_bundling = true;

                            var ast: js_ast.Ast = (try bundler.resolver.caches.js.parse(
                                bundler.allocator,
                                opts,
                                bundler.options.define,
                                this.log,
                                &source,
                            )) orelse return;

                            for (ast.import_records) |*import_record, record_id| {

                                // Don't resolve the runtime
                                if (import_record.is_internal) {
                                    continue;
                                }

                                if (bundler.linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                                    const resolved_import: *const _resolver.Result = _resolved_import;
                                    if (resolved_import.is_external) {
                                        continue;
                                    }

                                    const absolute_path = resolved_import.path_pair.primary.text;
                                    const package_json: *const PackageJSON = (resolved_import.package_json orelse (this.bundler.resolver.packageJSONForResolvedNodeModule(resolved_import) orelse {
                                        this.log.addWarningFmt(
                                            &source,
                                            import_record.range.loc,
                                            this.allocator,
                                            "Failed to find package.json for \"{s}\". This will be unresolved and might break at runtime. If it's external, you could add it to the external list.",
                                            .{
                                                resolved_import.path_pair.primary.text,
                                            },
                                        ) catch {};
                                        continue;
                                    }));

                                    // trim node_modules/${package.name}/ from the string to save space
                                    // This reduces metadata size by about 30% for a large-ish file
                                    // A future optimization here could be to reuse the string from the original path
                                    var node_module_root = strings.indexOf(resolved_import.path_pair.primary.text, node_module_root_string) orelse unreachable;

                                    // omit node_modules
                                    node_module_root += node_module_root_string.len;

                                    // // omit package name
                                    node_module_root += package_json.name.len;

                                    node_module_root += 1;

                                    // It should be the first index, not the last to support bundling multiple of the same package
                                    import_record.path = Fs.Path.init(
                                        absolute_path[node_module_root..],
                                    );

                                    const get_or_put_result = try this.resolved_paths.getOrPut(absolute_path);

                                    if (get_or_put_result.found_existing) {
                                        import_record.module_id = get_or_put_result.entry.value;
                                        import_record.is_bundled = true;
                                        continue;
                                    }

                                    hasher = std.hash.Wyhash.init(0);
                                    hasher.update(import_record.path.text);
                                    hasher.update(std.mem.asBytes(&package_json.hash));

                                    import_record.module_id = @truncate(u32, hasher.final());
                                    get_or_put_result.entry.value = import_record.module_id;
                                    import_record.is_bundled = true;

                                    try this.resolve_queue.writeItem(_resolved_import.*);
                                } else |err| {}
                            }

                            const package = resolve.package_json orelse this.bundler.resolver.packageJSONForResolvedNodeModule(&resolve) orelse unreachable;
                            const package_relative_path = brk: {
                                // trim node_modules/${package.name}/ from the string to save space
                                // This reduces metadata size by about 30% for a large-ish file
                                // A future optimization here could be to reuse the string from the original path
                                var node_module_root = strings.indexOf(resolve.path_pair.primary.text, node_module_root_string) orelse unreachable;
                                // omit node_modules
                                node_module_root += node_module_root_string.len;

                                file_path.pretty = resolve.path_pair.primary.text[node_module_root..];

                                // omit trailing separator
                                node_module_root += 1;

                                // omit package name
                                node_module_root += package.name.len;

                                break :brk resolve.path_pair.primary.text[node_module_root..];
                            };

                            // const load_from_symbol_ref = ast.runtime_imports.$$r.?;
                            // const reexport_ref = ast.runtime_imports.__reExport.?;
                            const register_ref = ast.runtime_imports.register.?;
                            const E = js_ast.E;
                            const Expr = js_ast.Expr;
                            const Stmt = js_ast.Stmt;

                            var part = &ast.parts[ast.parts.len - 1];
                            var new_stmts: [1]Stmt = undefined;
                            var register_args: [3]Expr = undefined;

                            var package_json_string = E.String{ .utf8 = package.name };
                            var module_path_string = E.String{ .utf8 = package_relative_path };
                            var target_identifier = E.Identifier{ .ref = register_ref };
                            var cjs_args: [2]js_ast.G.Arg = undefined;
                            var module_binding = js_ast.B.Identifier{ .ref = ast.module_ref.? };
                            var exports_binding = js_ast.B.Identifier{ .ref = ast.exports_ref.? };

                            // if (!ast.uses_module_ref) {
                            //     var symbol = &ast.symbols[ast.module_ref.?.inner_index];
                            //     symbol.original_name = "_$$";
                            // }

                            cjs_args[0] = js_ast.G.Arg{
                                .binding = js_ast.Binding{
                                    .loc = logger.Loc.Empty,
                                    .data = .{ .b_identifier = &module_binding },
                                },
                            };
                            cjs_args[1] = js_ast.G.Arg{
                                .binding = js_ast.Binding{
                                    .loc = logger.Loc.Empty,
                                    .data = .{ .b_identifier = &exports_binding },
                                },
                            };
                            var closure = E.Arrow{
                                .args = &cjs_args,
                                .body = .{
                                    .loc = logger.Loc.Empty,
                                    .stmts = part.stmts,
                                },
                            };

                            // $$m(12345, "react", "index.js", function(module, exports) {

                            // })
                            register_args[0] = Expr{ .loc = .{ .start = 0 }, .data = .{ .e_string = &package_json_string } };
                            register_args[1] = Expr{ .loc = .{ .start = 0 }, .data = .{ .e_string = &module_path_string } };
                            register_args[2] = Expr{ .loc = .{ .start = 0 }, .data = .{ .e_arrow = &closure } };

                            var call_register = E.Call{
                                .target = Expr{
                                    .data = .{ .e_identifier = &target_identifier },
                                    .loc = logger.Loc{ .start = 0 },
                                },
                                .args = &register_args,
                            };
                            var register_expr = Expr{ .loc = call_register.target.loc, .data = .{ .e_call = &call_register } };
                            var decls: [1]js_ast.G.Decl = undefined;
                            var bundle_export_binding = js_ast.B.Identifier{ .ref = ast.bundle_export_ref.? };
                            var binding = js_ast.Binding{
                                .loc = register_expr.loc,
                                .data = .{ .b_identifier = &bundle_export_binding },
                            };
                            decls[0] = js_ast.G.Decl{
                                .value = register_expr,
                                .binding = binding,
                            };
                            var export_var = js_ast.S.Local{
                                .decls = &decls,
                                .is_export = true,
                            };
                            new_stmts[0] = Stmt{ .loc = register_expr.loc, .data = .{ .s_local = &export_var } };
                            part.stmts = &new_stmts;

                            var writer = js_printer.NewFileWriter(this.tmpfile);
                            var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});
                            hasher = std.hash.Wyhash.init(0);
                            hasher.update(package_relative_path);
                            hasher.update(std.mem.asBytes(&package.hash)[0..4]);
                            const module_id = @truncate(u32, hasher.final());

                            const code_offset = @truncate(u32, try this.tmpfile.getPos());
                            const written = @truncate(
                                u32,
                                try js_printer.printCommonJS(
                                    @TypeOf(writer),
                                    writer,
                                    ast,
                                    js_ast.Symbol.Map.initList(symbols),
                                    &source,
                                    false,
                                    js_printer.Options{
                                        .to_module_ref = Ref.RuntimeRef,
                                        .bundle_export_ref = ast.bundle_export_ref.?,
                                        .source_path = file_path,
                                        .externals = ast.externals,
                                        .indent = 0,
                                        .module_hash = module_id,
                                        .runtime_imports = ast.runtime_imports,
                                    },
                                    Linker,
                                    &bundler.linker,
                                ),
                            );
                            // Faster to _not_ do the syscall
                            // But there's some off-by-one error somewhere and more reliable to just do the lseek
                            this.tmpfile_byte_offset = @truncate(u32, try this.tmpfile.getPos());
                            const code_length = this.tmpfile_byte_offset - code_offset;
                            // std.debug.assert(code_length == written);
                            var package_get_or_put_entry = try this.package_list_map.getOrPut(package.hash);
                            if (!package_get_or_put_entry.found_existing) {
                                package_get_or_put_entry.value_ptr.* = @truncate(u32, this.package_list.items.len);
                                try this.package_list.append(
                                    Api.JavascriptBundledPackage{
                                        .name = try this.appendHeaderString(package.name),
                                        .version = try this.appendHeaderString(package.version),
                                        .hash = package.hash,
                                    },
                                );
                                this.has_jsx = this.has_jsx or strings.eql(package.name, this.bundler.options.jsx.package_name);
                            }

                            var path_extname_length = @truncate(u8, std.fs.path.extension(package_relative_path).len);
                            try this.module_list.append(
                                Api.JavascriptBundledModule{
                                    .path = try this.appendHeaderString(
                                        package_relative_path,
                                    ),
                                    .path_extname_length = path_extname_length,
                                    .package_id = package_get_or_put_entry.value_ptr.*,
                                    .id = module_id,
                                    .code = Api.StringPointer{
                                        .length = @truncate(u32, code_length),
                                        .offset = @truncate(u32, code_offset),
                                    },
                                },
                            );
                        },
                        else => {},
                    }
                } else {
                    // If it's app code, scan but do not fully parse.
                    switch (loader) {
                        .jsx,
                        .tsx,
                        .js,
                        .ts,
                        => {
                            const entry = bundler.resolver.caches.fs.readFile(
                                bundler.fs,
                                file_path.text,
                                resolve.dirname_fd,
                                true,
                                null,
                            ) catch return;

                            const source = logger.Source.initFile(Fs.File{ .path = file_path, .contents = entry.contents }, bundler.allocator) catch return null;
                            const source_dir = file_path.name.dirWithTrailingSlash();

                            var jsx = bundler.options.jsx;
                            jsx.parse = loader.isJSX();
                            var opts = js_parser.Parser.Options.init(jsx, loader);

                            try bundler.resolver.caches.js.scan(
                                bundler.allocator,
                                &this.scan_pass_result,
                                opts,
                                bundler.options.define,
                                this.log,
                                &source,
                            );

                            for (this.scan_pass_result.import_records.items) |*import_record, i| {
                                if (import_record.is_internal) {
                                    continue;
                                }

                                if (bundler.linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                                    const resolved_import: *const _resolver.Result = _resolved_import;
                                    if (resolved_import.is_external) {
                                        continue;
                                    }

                                    const get_or_put_result = try this.resolved_paths.getOrPut(resolved_import.path_pair.primary.text);

                                    if (get_or_put_result.found_existing) {
                                        continue;
                                    }

                                    // Always enqueue unwalked import paths, but if it's not a node_module, we don't care about the hash
                                    try this.resolve_queue.writeItem(_resolved_import.*);

                                    // trim node_modules/${package.name}/ from the string to save space
                                    // This reduces metadata size by about 30% for a large-ish file
                                    // A future optimization here could be to reuse the string from the original path
                                    var node_module_root = strings.indexOf(resolved_import.path_pair.primary.text, node_module_root_string) orelse continue;

                                    const package_json: *const PackageJSON = (resolved_import.package_json orelse (this.bundler.resolver.packageJSONForResolvedNodeModule(resolved_import) orelse {
                                        this.log.addWarningFmt(
                                            &source,
                                            import_record.range.loc,
                                            this.allocator,
                                            "Failed to find package.json for \"{s}\". This will be unresolved and might break at runtime. If it's external, you could add it to the external list.",
                                            .{
                                                resolved_import.path_pair.primary.text,
                                            },
                                        ) catch {};
                                        continue;
                                    }));

                                    // omit node_modules
                                    node_module_root += node_module_root_string.len;
                                    // // omit package name
                                    node_module_root += package_json.name.len;
                                    node_module_root += 1;

                                    // It should be the first index, not the last to support bundling multiple of the same package
                                    import_record.path = Fs.Path.init(
                                        resolved_import.path_pair.primary.text[node_module_root..],
                                    );

                                    hasher = std.hash.Wyhash.init(0);
                                    hasher.update(import_record.path.text);
                                    hasher.update(std.mem.asBytes(&package_json.hash));
                                    get_or_put_result.entry.value = @truncate(u32, hasher.final());
                                } else |err| {}
                            }
                        },
                        // TODO:
                        else => {
                            return;
                        },
                    }
                }
            }
        };

        pub const BuildResolveResultPair = struct {
            written: usize,
            input_fd: ?StoredFileDescriptorType,
        };
        pub fn buildWithResolveResult(
            bundler: *ThisBundler,
            resolve_result: _resolver.Result,
            allocator: *std.mem.Allocator,
            loader: options.Loader,
            comptime Writer: type,
            writer: Writer,
            comptime import_path_format: options.BundleOptions.ImportPathFormat,
            file_descriptor: ?StoredFileDescriptorType,
            filepath_hash: u32,
            comptime WatcherType: type,
            watcher: *WatcherType,
        ) !BuildResolveResultPair {
            if (resolve_result.is_external) {
                return BuildResolveResultPair{
                    .written = 0,
                    .input_fd = null,
                };
            }

            errdefer bundler.resetStore();

            var file_path = resolve_result.path_pair.primary;
            file_path.pretty = allocator.dupe(u8, bundler.fs.relativeTo(file_path.text)) catch unreachable;

            var old_bundler_allocator = bundler.allocator;
            bundler.allocator = allocator;
            defer bundler.allocator = old_bundler_allocator;
            var old_linker_allocator = bundler.linker.allocator;
            defer bundler.linker.allocator = old_linker_allocator;
            bundler.linker.allocator = allocator;

            switch (loader) {
                .css => {
                    const CSSBundlerHMR = Css.NewBundler(
                        Writer,
                        @TypeOf(&bundler.linker),
                        @TypeOf(&bundler.resolver.caches.fs),
                        WatcherType,
                        @TypeOf(bundler.fs),
                        true,
                    );

                    const CSSBundler = Css.NewBundler(
                        Writer,
                        @TypeOf(&bundler.linker),
                        @TypeOf(&bundler.resolver.caches.fs),
                        WatcherType,
                        @TypeOf(bundler.fs),
                        false,
                    );

                    return BuildResolveResultPair{
                        .written = brk: {
                            if (bundler.options.hot_module_reloading) {
                                break :brk (try CSSBundlerHMR.bundle(
                                    resolve_result.path_pair.primary.text,
                                    bundler.fs,
                                    writer,
                                    watcher,
                                    &bundler.resolver.caches.fs,
                                    filepath_hash,
                                    file_descriptor,
                                    allocator,
                                    bundler.log,
                                    &bundler.linker,
                                )).written;
                            } else {
                                break :brk (try CSSBundler.bundle(
                                    resolve_result.path_pair.primary.text,
                                    bundler.fs,
                                    writer,
                                    watcher,
                                    &bundler.resolver.caches.fs,
                                    filepath_hash,
                                    file_descriptor,
                                    allocator,
                                    bundler.log,
                                    &bundler.linker,
                                )).written;
                            }
                        },
                        .input_fd = file_descriptor,
                    };
                },
                else => {
                    var result = bundler.parse(
                        allocator,
                        file_path,
                        loader,
                        resolve_result.dirname_fd,
                        file_descriptor,
                        filepath_hash,
                    ) orelse {
                        bundler.resetStore();
                        return BuildResolveResultPair{
                            .written = 0,
                            .input_fd = null,
                        };
                    };

                    try bundler.linker.link(file_path, &result, import_path_format);

                    return BuildResolveResultPair{
                        .written = try bundler.print(
                            result,
                            Writer,
                            writer,
                            .esm,
                        ),
                        .input_fd = result.input_fd,
                    };
                },
            }
        }

        pub fn buildWithResolveResultEager(
            bundler: *ThisBundler,
            resolve_result: _resolver.Result,
            comptime import_path_format: options.BundleOptions.ImportPathFormat,
            comptime Outstream: type,
            outstream: Outstream,
        ) !?options.OutputFile {
            if (resolve_result.is_external) {
                return null;
            }

            // Step 1. Parse & scan
            const loader = bundler.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;
            var file_path = resolve_result.path_pair.primary;
            file_path.pretty = Linker.relative_paths_list.append(string, bundler.fs.relativeTo(file_path.text)) catch unreachable;

            var output_file = options.OutputFile{
                .input = file_path,
                .loader = loader,
                .value = undefined,
            };

            var file: std.fs.File = undefined;

            if (Outstream == std.fs.Dir) {
                const output_dir = outstream;

                if (std.fs.path.dirname(file_path.pretty)) |dirname| {
                    try output_dir.makePath(dirname);
                }
                file = try output_dir.createFile(file_path.pretty, .{});
            } else {
                file = outstream;
            }

            switch (loader) {
                .jsx, .tsx, .js, .ts, .json => {
                    var result = bundler.parse(
                        bundler.allocator,
                        file_path,
                        loader,
                        resolve_result.dirname_fd,
                        null,
                        null,
                    ) orelse {
                        return null;
                    };

                    try bundler.linker.link(
                        file_path,
                        &result,
                        import_path_format,
                    );

                    output_file.size = try bundler.print(
                        result,
                        js_printer.FileWriter,
                        js_printer.NewFileWriter(file),
                        .esm,
                    );

                    var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                    file_op.fd = file.handle;

                    file_op.is_tmpdir = false;

                    if (Outstream == std.fs.Dir) {
                        file_op.dir = outstream.fd;

                        if (bundler.fs.fs.needToCloseFiles()) {
                            file.close();
                            file_op.fd = 0;
                        }
                    }

                    output_file.value = .{ .move = file_op };
                },
                .css => {
                    const CSSWriter = Css.NewWriter(
                        std.fs.File,
                        @TypeOf(&bundler.linker),
                        import_path_format,
                        void,
                    );
                    const entry = bundler.resolver.caches.fs.readFile(
                        bundler.fs,
                        file_path.text,
                        resolve_result.dirname_fd,
                        !cache_files,
                        null,
                    ) catch return null;

                    const _file = Fs.File{ .path = file_path, .contents = entry.contents };
                    const source = try logger.Source.initFile(_file, bundler.allocator);

                    var css_writer = CSSWriter.init(
                        &source,
                        file,
                        &bundler.linker,
                    );
                    try css_writer.run(bundler.log, bundler.allocator);
                    output_file.size = css_writer.written;
                    var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                    file_op.fd = file.handle;

                    file_op.is_tmpdir = false;

                    if (Outstream == std.fs.Dir) {
                        file_op.dir = outstream.fd;

                        if (bundler.fs.fs.needToCloseFiles()) {
                            file.close();
                            file_op.fd = 0;
                        }
                    }

                    output_file.value = .{ .move = file_op };
                },
                .file => {
                    var hashed_name = try bundler.linker.getHashedFilename(file_path, null);
                    var pathname = try bundler.allocator.alloc(u8, hashed_name.len + file_path.name.ext.len);
                    std.mem.copy(u8, pathname, hashed_name);
                    std.mem.copy(u8, pathname[hashed_name.len..], file_path.name.ext);
                    const dir = if (bundler.options.output_dir_handle) |output_handle| output_handle.fd else 0;

                    output_file.value = .{
                        .copy = options.OutputFile.FileOperation{
                            .pathname = pathname,
                            .dir = dir,
                            .is_outdir = true,
                        },
                    };
                },

                // // TODO:
                // else => {},
            }

            return output_file;
        }

        pub fn scanWithResolveResult(
            bundler: *ThisBundler,
            resolve_result: _resolver.Result,
            scan_pass_result: *js_parser.ScanPassResult,
        ) !?ScanResult {
            if (resolve_result.is_external) {
                return null;
            }
            var import_records = &scan_pass_result.import_records;
            var named_imports = &scan_pass_result.named_imports;
            errdefer js_ast.Expr.Data.Store.reset();
            errdefer js_ast.Stmt.Data.Store.reset();

            // Step 1. Parse & scan
            const loader = bundler.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;
            var file_path = resolve_result.path_pair.primary;
            file_path.pretty = Linker.relative_paths_list.append(string, bundler.fs.relativeTo(file_path.text)) catch unreachable;

            switch (loader) {
                .jsx, .tsx, .js, .ts, .json => {
                    const entry = bundler.resolver.caches.fs.readFile(
                        bundler.fs,
                        file_path.text,
                        resolve_result.dirname_fd,
                        !cache_files,
                        null,
                    ) catch return null;

                    const source = logger.Source.initFile(Fs.File{ .path = file_path, .contents = entry.contents }, bundler.allocator) catch return null;
                    const source_dir = file_path.name.dirWithTrailingSlash();

                    var jsx = bundler.options.jsx;
                    jsx.parse = loader.isJSX();
                    var opts = js_parser.Parser.Options.init(jsx, loader);

                    var result = ScanResult{
                        .path = file_path,
                        .file_size = @truncate(u32, source.contents.len),
                        .is_node_module = resolve_result.isLikelyNodeModule(),
                        .import_record_start = @truncate(u32, import_records.items.len),
                        .import_record_length = 0,
                    };

                    try bundler.resolver.caches.js.scan(
                        bundler.allocator,
                        scan_pass_result,
                        opts,
                        bundler.options.define,
                        bundler.log,
                        &source,
                    );
                    result.import_record_length = @truncate(u32, import_records.items.len - result.import_record_start);
                    for (import_records.items[result.import_record_start..import_records.items.len]) |*import_record, i| {
                        if (bundler.linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*resolved_import| {
                            if (resolved_import.is_external) {
                                continue;
                            }
                        } else |err| {}
                    }
                    return result;
                },
                // TODO:
                else => {
                    return null;
                },
            }
        }

        pub fn print(
            bundler: *ThisBundler,
            result: ParseResult,
            comptime Writer: type,
            writer: Writer,
            comptime format: js_printer.Format,
        ) !usize {
            const ast = result.ast;
            var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

            return switch (format) {
                .cjs => try js_printer.printCommonJS(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    &result.source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                    },
                    Linker,
                    &bundler.linker,
                ),
                .esm => try js_printer.printAst(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    &result.source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                    },
                    Linker,
                    &bundler.linker,
                ),
                .speedy => try js_printer.printSpeedyCJS(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    &result.source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                    },
                    Linker,
                    &bundler.linker,
                ),
            };
        }

        pub fn parse(
            bundler: *ThisBundler,
            allocator: *std.mem.Allocator,
            path: Fs.Path,
            loader: options.Loader,
            // only used when file_descriptor is null
            dirname_fd: StoredFileDescriptorType,
            file_descriptor: ?StoredFileDescriptorType,
            file_hash: ?u32,
        ) ?ParseResult {
            if (FeatureFlags.tracing) {
                bundler.timer.start();
            }
            defer {
                if (FeatureFlags.tracing) {
                    bundler.timer.stop();
                    bundler.elapsed += bundler.timer.elapsed;
                }
            }
            var result: ParseResult = undefined;
            const entry = bundler.resolver.caches.fs.readFile(
                bundler.fs,
                path.text,
                dirname_fd,
                true,
                file_descriptor,
            ) catch return null;

            const source = logger.Source.initFile(Fs.File{ .path = path, .contents = entry.contents }, bundler.allocator) catch return null;

            switch (loader) {
                .js,
                .jsx,
                .ts,
                .tsx,
                => {
                    var jsx = bundler.options.jsx;
                    jsx.parse = loader.isJSX();
                    var opts = js_parser.Parser.Options.init(jsx, loader);
                    opts.enable_bundling = false;
                    opts.transform_require_to_import = !bundler.options.platform.implementsRequire();
                    opts.force_commonjs = bundler.options.platform == .speedy;
                    opts.can_import_from_bundle = bundler.options.node_modules_bundle != null;
                    opts.features.hot_module_reloading = bundler.options.hot_module_reloading and bundler.options.platform != .speedy;
                    opts.features.react_fast_refresh = opts.features.hot_module_reloading and jsx.parse and bundler.options.jsx.supports_fast_refresh;
                    opts.filepath_hash_for_hmr = file_hash orelse 0;
                    const value = (bundler.resolver.caches.js.parse(allocator, opts, bundler.options.define, bundler.log, &source) catch null) orelse return null;
                    return ParseResult{
                        .ast = value,
                        .source = source,
                        .loader = loader,
                        .input_fd = entry.fd,
                    };
                },
                .json => {
                    var expr = json_parser.ParseJSON(&source, bundler.log, allocator) catch return null;
                    var stmt = js_ast.Stmt.alloc(allocator, js_ast.S.ExportDefault{
                        .value = js_ast.StmtOrExpr{ .expr = expr },
                        .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
                    }, logger.Loc{ .start = 0 });
                    var stmts = allocator.alloc(js_ast.Stmt, 1) catch unreachable;
                    stmts[0] = stmt;
                    var parts = allocator.alloc(js_ast.Part, 1) catch unreachable;
                    parts[0] = js_ast.Part{ .stmts = stmts };

                    return ParseResult{
                        .ast = js_ast.Ast.initTest(parts),
                        .source = source,
                        .loader = loader,
                        .input_fd = entry.fd,
                    };
                },
                .css => {},
                else => Global.panic("Unsupported loader {s} for path: {s}", .{ loader, source.path.text }),
            }

            return null;
        }

        threadlocal var tmp_buildfile_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        // We try to be mostly stateless when serving
        // This means we need a slightly different resolver setup
        // Essentially:
        pub fn buildFile(
            bundler: *ThisBundler,
            log: *logger.Log,
            allocator: *std.mem.Allocator,
            relative_path: string,
            _extension: string,
        ) !ServeResult {
            var extension = _extension;
            var original_resolver_logger = bundler.resolver.log;
            var original_bundler_logger = bundler.log;

            defer bundler.log = original_bundler_logger;
            defer bundler.resolver.log = original_resolver_logger;
            bundler.log = log;
            bundler.linker.allocator = allocator;
            bundler.resolver.log = log;

            // Resolving a public file has special behavior
            if (bundler.options.public_dir_enabled) {
                // On Windows, we don't keep the directory handle open forever because Windows doesn't like that.
                const public_dir: std.fs.Dir = bundler.options.public_dir_handle orelse std.fs.openDirAbsolute(bundler.options.public_dir, .{}) catch |err| {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "Opening public directory failed: {s}", .{@errorName(err)}) catch unreachable;
                    Output.printErrorln("Opening public directory failed: {s}", .{@errorName(err)});
                    bundler.options.public_dir_enabled = false;
                    return error.PublicDirError;
                };

                var relative_unrooted_path: []u8 = resolve_path.normalizeString(relative_path, false, .auto);

                var _file: ?std.fs.File = null;

                // Is it the index file?
                if (relative_unrooted_path.len == 0) {
                    // std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path);
                    // std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/"
                    // Search for /index.html
                    if (public_dir.openFile("index.html", .{})) |file| {
                        var index_path = "index.html".*;
                        relative_unrooted_path = &(index_path);
                        _file = file;
                        extension = "html";
                    } else |err| {}
                    // Okay is it actually a full path?
                } else {
                    if (public_dir.openFile(relative_unrooted_path, .{})) |file| {
                        _file = file;
                    } else |err| {}
                }

                // Try some weird stuff.
                while (_file == null and relative_unrooted_path.len > 1) {
                    // When no extension is provided, it might be html
                    if (extension.len == 0) {
                        std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                        std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], ".html");

                        if (public_dir.openFile(tmp_buildfile_buf[0 .. relative_unrooted_path.len + ".html".len], .{})) |file| {
                            _file = file;
                            extension = "html";
                            break;
                        } else |err| {}

                        var _path: []u8 = undefined;
                        if (relative_unrooted_path[relative_unrooted_path.len - 1] == '/') {
                            std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path[0 .. relative_unrooted_path.len - 1]);
                            std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len - 1 ..], "/index.html");
                            _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len - 1 + "/index.html".len];
                        } else {
                            std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                            std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/index.html");

                            _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len + "/index.html".len];
                        }

                        if (public_dir.openFile(_path, .{})) |file| {
                            const __path = _path;
                            relative_unrooted_path = __path;
                            extension = "html";
                            _file = file;
                            break;
                        } else |err| {}
                    }

                    break;
                }

                if (_file) |*file| {
                    var stat = try file.stat();
                    var absolute_path = resolve_path.joinAbs(bundler.options.public_dir, .auto, relative_unrooted_path);

                    if (stat.kind == .SymLink) {
                        absolute_path = try std.fs.realpath(absolute_path, &tmp_buildfile_buf);
                        file.close();
                        file.* = try std.fs.openFileAbsolute(absolute_path, .{ .read = true });
                        stat = try file.stat();
                    }

                    if (stat.kind != .File) {
                        file.close();
                        return error.NotFile;
                    }

                    return ServeResult{
                        .file = options.OutputFile.initFile(file.*, absolute_path, stat.size),
                        .mime_type = MimeType.byExtension(std.fs.path.extension(absolute_path)[1..]),
                    };
                }
            }

            if (strings.eqlComptime(relative_path, "__runtime.js")) {
                return ServeResult{
                    .file = options.OutputFile.initBuf(runtime.Runtime.sourceContent(), "__runtime.js", .js),
                    .mime_type = MimeType.javascript,
                };
            }

            // We make some things faster in theory by using absolute paths instead of relative paths
            var absolute_path = resolve_path.joinAbsStringBuf(
                bundler.fs.top_level_dir,
                &tmp_buildfile_buf,
                &([_][]const u8{relative_path}),
                .auto,
            );

            defer {
                js_ast.Expr.Data.Store.reset();
                js_ast.Stmt.Data.Store.reset();
            }

            // If the extension is .js, omit it.
            // if (absolute_path.len > ".js".len and strings.eqlComptime(absolute_path[absolute_path.len - ".js".len ..], ".js")) {
            //     absolute_path = absolute_path[0 .. absolute_path.len - ".js".len];
            // }

            const resolved = (try bundler.resolver.resolve(bundler.fs.top_level_dir, absolute_path, .entry_point));

            const loader = bundler.options.loaders.get(resolved.path_pair.primary.name.ext) orelse .file;

            switch (loader) {
                .js, .jsx, .ts, .tsx, .json, .css => {
                    return ServeResult{
                        .file = options.OutputFile.initPending(loader, resolved),
                        .mime_type = MimeType.byLoader(
                            loader,
                            bundler.options.out_extensions.get(resolved.path_pair.primary.name.ext) orelse resolved.path_pair.primary.name.ext,
                        ),
                    };
                },
                else => {
                    var abs_path = resolved.path_pair.primary.text;
                    const file = try std.fs.openFileAbsolute(abs_path, .{ .read = true });
                    var stat = try file.stat();
                    return ServeResult{
                        .file = options.OutputFile.initFile(file, abs_path, stat.size),
                        .mime_type = MimeType.byLoader(loader, abs_path),
                    };
                },
            }
        }

        pub fn normalizeEntryPointPath(bundler: *ThisBundler, _entry: string) string {
            var paths = [_]string{_entry};
            var entry = bundler.fs.abs(&paths);

            std.fs.accessAbsolute(entry, .{}) catch |err| {
                return _entry;
            };

            entry = bundler.fs.relativeTo(entry);

            if (!strings.startsWith(entry, "./")) {
                // Entry point paths without a leading "./" are interpreted as package
                // paths. This happens because they go through general path resolution
                // like all other import paths so that plugins can run on them. Requiring
                // a leading "./" for a relative path simplifies writing plugins because
                // entry points aren't a special case.
                //
                // However, requiring a leading "./" also breaks backward compatibility
                // and makes working with the CLI more difficult. So attempt to insert
                // "./" automatically when needed. We don't want to unconditionally insert
                // a leading "./" because the path may not be a file system path. For
                // example, it may be a URL. So only insert a leading "./" when the path
                // is an exact match for an existing file.
                var __entry = bundler.allocator.alloc(u8, "./".len + entry.len) catch unreachable;
                __entry[0] = '.';
                __entry[1] = '/';
                std.mem.copy(u8, __entry[2..__entry.len], entry);
                entry = __entry;
            }

            return entry;
        }

        pub fn scanDependencies(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            _opts: Api.TransformOptions,
        ) !ScanResult.Summary {
            var opts = _opts;
            opts.resolve = .dev;
            var bundler = try ThisBundler.init(allocator, log, opts, null);

            bundler.configureLinker();

            var entry_points = try allocator.alloc(_resolver.Result, bundler.options.entry_points.len);

            if (log.level == .verbose) {
                bundler.resolver.debug_logs = try DebugLogs.init(allocator);
            }

            var rfs: *Fs.FileSystem.RealFS = &bundler.fs.fs;

            var entry_point_i: usize = 0;
            for (bundler.options.entry_points) |_entry| {
                var entry: string = bundler.normalizeEntryPointPath(_entry);

                defer {
                    js_ast.Expr.Data.Store.reset();
                    js_ast.Stmt.Data.Store.reset();
                }

                const result = bundler.resolver.resolve(bundler.fs.top_level_dir, entry, .entry_point) catch |err| {
                    Output.printError("Error resolving \"{s}\": {s}\n", .{ entry, @errorName(err) });
                    continue;
                };

                const key = result.path_pair.primary.text;
                if (bundler.resolve_results.contains(key)) {
                    continue;
                }
                try bundler.resolve_results.put(key, result);
                entry_points[entry_point_i] = result;

                if (isDebug) {
                    Output.print("Resolved {s} => {s}", .{ entry, result.path_pair.primary.text });
                }

                entry_point_i += 1;
                bundler.resolve_queue.writeItem(result) catch unreachable;
            }
            var scan_results = std.ArrayList(ScanResult).init(allocator);
            var scan_pass_result = js_parser.ScanPassResult.init(allocator);

            switch (bundler.options.resolve_mode) {
                .lazy, .dev, .bundle => {
                    while (bundler.resolve_queue.readItem()) |item| {
                        js_ast.Expr.Data.Store.reset();
                        js_ast.Stmt.Data.Store.reset();
                        scan_pass_result.named_imports.clearRetainingCapacity();
                        scan_results.append(bundler.scanWithResolveResult(item, &scan_pass_result) catch continue orelse continue) catch continue;
                    }
                },
                else => Global.panic("Unsupported resolve mode: {s}", .{@tagName(bundler.options.resolve_mode)}),
            }

            // if (log.level == .verbose) {
            //     for (log.msgs.items) |msg| {
            //         try msg.writeFormat(std.io.getStdOut().writer());
            //     }
            // }

            if (FeatureFlags.tracing) {
                Output.printError(
                    "\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n",
                    .{
                        bundler.resolver.elapsed,
                        bundler.elapsed,
                    },
                );
            }

            return ScanResult.Summary{
                .scan_results = scan_results,
                .import_records = scan_pass_result.import_records,
            };
        }

        fn enqueueEntryPoints(bundler: *ThisBundler, entry_points: []_resolver.Result, comptime normalize_entry_point: bool) void {
            var entry_point_i: usize = 0;

            for (bundler.options.entry_points) |_entry| {
                var entry: string = if (comptime normalize_entry_point) bundler.normalizeEntryPointPath(_entry) else _entry;

                defer {
                    js_ast.Expr.Data.Store.reset();
                    js_ast.Stmt.Data.Store.reset();
                }

                const result = bundler.resolver.resolve(bundler.fs.top_level_dir, entry, .entry_point) catch |err| {
                    Output.printError("Error resolving \"{s}\": {s}\n", .{ entry, @errorName(err) });
                    continue;
                };

                const key = result.path_pair.primary.text;
                if (bundler.resolve_results.contains(key)) {
                    continue;
                }

                bundler.resolve_results.put(key, result) catch unreachable;
                entry_points[entry_point_i] = result;

                if (isDebug) {
                    Output.print("Resolved {s} => {s}", .{ entry, result.path_pair.primary.text });
                }

                entry_point_i += 1;
                bundler.resolve_queue.writeItem(result) catch unreachable;
            }
        }

        pub fn bundle(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            opts: Api.TransformOptions,
        ) !options.TransformResult {
            var bundler = try ThisBundler.init(allocator, log, opts, null);
            bundler.configureLinker();
            // try bundler.configureRouter();

            var skip_normalize = false;
            if (bundler.router) |router| {
                bundler.options.entry_points = try router.getEntryPoints(allocator);
                skip_normalize = true;
            }

            if (bundler.options.write and bundler.options.output_dir.len > 0) {}

            //  100.00 µs std.fifo.LinearFifo(resolver.Result,std.fifo.LinearFifoBufferType { .Dynamic = {}}).writeItemAssumeCapacity
            if (bundler.options.resolve_mode != .lazy) {
                try bundler.resolve_queue.ensureUnusedCapacity(24);
            }

            var entry_points = try allocator.alloc(_resolver.Result, bundler.options.entry_points.len);
            if (skip_normalize) {
                bundler.enqueueEntryPoints(entry_points, false);
            } else {
                bundler.enqueueEntryPoints(entry_points, true);
            }

            if (log.level == .verbose) {
                bundler.resolver.debug_logs = try DebugLogs.init(allocator);
            }

            if (bundler.options.output_dir_handle == null) {
                const outstream = std.io.getStdOut();
                try switch (bundler.options.import_path_format) {
                    .relative => bundler.processResolveQueue(.relative, @TypeOf(outstream), outstream),
                    .relative_nodejs => bundler.processResolveQueue(.relative_nodejs, @TypeOf(outstream), outstream),
                    .absolute_url => bundler.processResolveQueue(.absolute_url, @TypeOf(outstream), outstream),
                    .absolute_path => bundler.processResolveQueue(.absolute_path, @TypeOf(outstream), outstream),
                    .package_path => bundler.processResolveQueue(.package_path, @TypeOf(outstream), outstream),
                };
            } else {
                const output_dir = bundler.options.output_dir_handle orelse {
                    Output.printError("Invalid or missing output directory.", .{});
                    Global.crash();
                };

                try switch (bundler.options.import_path_format) {
                    .relative => bundler.processResolveQueue(.relative, std.fs.Dir, output_dir),
                    .relative_nodejs => bundler.processResolveQueue(.relative_nodejs, std.fs.Dir, output_dir),
                    .absolute_url => bundler.processResolveQueue(.absolute_url, std.fs.Dir, output_dir),
                    .absolute_path => bundler.processResolveQueue(.absolute_path, std.fs.Dir, output_dir),
                    .package_path => bundler.processResolveQueue(.package_path, std.fs.Dir, output_dir),
                };
            }

            // if (log.level == .verbose) {
            //     for (log.msgs.items) |msg| {
            //         try msg.writeFormat(std.io.getStdOut().writer());
            //     }
            // }

            if (bundler.linker.any_needs_runtime) {
                try bundler.output_files.append(
                    options.OutputFile.initBuf(runtime.Runtime.sourceContent(), bundler.linker.runtime_source_path, .js),
                );
            }

            if (FeatureFlags.tracing) {
                Output.printError(
                    "\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n",
                    .{
                        bundler.resolver.elapsed,
                        bundler.elapsed,
                    },
                );
            }

            var final_result = try options.TransformResult.init(try allocator.dupe(u8, bundler.result.outbase), bundler.output_files.toOwnedSlice(), log, allocator);
            final_result.root_dir = bundler.options.output_dir_handle;
            return final_result;
        }

        pub fn processResolveQueue(
            bundler: *ThisBundler,
            comptime import_path_format: options.BundleOptions.ImportPathFormat,
            comptime Outstream: type,
            outstream: Outstream,
        ) !void {
            while (bundler.resolve_queue.readItem()) |item| {
                js_ast.Expr.Data.Store.reset();
                js_ast.Stmt.Data.Store.reset();
                const output_file = bundler.buildWithResolveResultEager(
                    item,
                    import_path_format,
                    Outstream,
                    outstream,
                ) catch continue orelse continue;
                bundler.output_files.append(output_file) catch unreachable;
            }
        }
    };
}

pub const Bundler = NewBundler(true);
pub const ServeBundler = NewBundler(false);

pub const Transformer = struct {
    opts: Api.TransformOptions,
    log: *logger.Log,
    allocator: *std.mem.Allocator,
    platform: options.Platform = undefined,
    out_extensions: std.StringHashMap(string) = undefined,
    output_path: string,
    cwd: string,
    define: *Define,

    pub fn transform(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        js_ast.Expr.Data.Store.create(allocator);
        js_ast.Stmt.Data.Store.create(allocator);

        var define = try options.definesFromTransformOptions(allocator, log, opts.define, false);

        const cwd = if (opts.absolute_working_dir) |workdir| try std.fs.realpathAlloc(allocator, workdir) else try std.process.getCwdAlloc(allocator);

        const output_dir_parts = [_]string{ try std.process.getCwdAlloc(allocator), opts.output_dir orelse "out" };
        const output_dir = try std.fs.path.join(allocator, &output_dir_parts);
        var output_files = try std.ArrayList(options.OutputFile).initCapacity(allocator, opts.entry_points.len);
        const platform = options.Platform.from(opts.platform);
        const out_extensions = platform.outExtensions(allocator);

        var loader_map = try options.loadersFromTransformOptions(allocator, opts.loaders);
        var use_default_loaders = loader_map.count() == 0;

        var jsx = if (opts.jsx) |_jsx| try options.JSX.Pragma.fromApi(_jsx, allocator) else options.JSX.Pragma{};

        var output_i: usize = 0;
        var chosen_alloc: *std.mem.Allocator = allocator;
        var arena: std.heap.ArenaAllocator = undefined;
        const use_arenas = opts.entry_points.len > 8;

        var ulimit: usize = Fs.FileSystem.RealFS.adjustUlimit();
        var care_about_closing_files = !(FeatureFlags.store_file_descriptors and opts.entry_points.len * 2 < ulimit);

        var transformer = Transformer{
            .log = log,
            .allocator = allocator,
            .opts = opts,
            .cwd = cwd,
            .platform = platform,
            .out_extensions = out_extensions,
            .define = define,
            .output_path = output_dir,
        };

        const write_to_output_dir = opts.entry_points.len > 1 or opts.output_dir != null;

        var output_dir_handle: ?std.fs.Dir = null;
        if (write_to_output_dir) {
            output_dir_handle = try options.openOutputDir(output_dir);
        }

        if (write_to_output_dir) {
            for (opts.entry_points) |entry_point, i| {
                try transformer.processEntryPoint(
                    entry_point,
                    i,
                    &output_files,
                    output_dir_handle,
                    .disk,
                    care_about_closing_files,
                    use_default_loaders,
                    loader_map,
                    &jsx,
                );
            }
        } else {
            for (opts.entry_points) |entry_point, i| {
                try transformer.processEntryPoint(
                    entry_point,
                    i,
                    &output_files,
                    output_dir_handle,
                    .stdout,
                    care_about_closing_files,
                    use_default_loaders,
                    loader_map,
                    &jsx,
                );
            }
        }

        return try options.TransformResult.init(output_dir, output_files.toOwnedSlice(), log, allocator);
    }

    pub fn processEntryPoint(
        transformer: *Transformer,
        entry_point: string,
        i: usize,
        output_files: *std.ArrayList(options.OutputFile),
        _output_dir: ?std.fs.Dir,
        comptime write_destination_type: options.WriteDestination,
        care_about_closing_files: bool,
        use_default_loaders: bool,
        loader_map: std.StringHashMap(options.Loader),
        jsx: *options.JSX.Pragma,
    ) !void {
        var allocator = transformer.allocator;
        var log = transformer.log;

        var _log = logger.Log.init(allocator);
        var __log = &_log;
        const absolutePath = resolve_path.joinAbs(transformer.cwd, .auto, entry_point);

        const file = try std.fs.openFileAbsolute(absolutePath, std.fs.File.OpenFlags{ .read = true });
        defer {
            if (care_about_closing_files) {
                file.close();
            }
        }

        const stat = try file.stat();

        const code = try file.readToEndAlloc(allocator, stat.size);
        defer {
            if (_log.msgs.items.len == 0) {
                allocator.free(code);
            }
            _log.appendTo(log) catch {};
        }
        const _file = Fs.File{ .path = Fs.Path.init(entry_point), .contents = code };
        var source = try logger.Source.initFile(_file, allocator);
        var loader: options.Loader = undefined;
        if (use_default_loaders) {
            loader = options.defaultLoaders.get(std.fs.path.extension(absolutePath)) orelse return;
        } else {
            loader = options.Loader.forFileName(
                entry_point,
                loader_map,
            ) orelse return;
        }

        var _source = &source;

        var output_file = options.OutputFile{
            .input = _file.path,
            .loader = loader,
            .value = undefined,
        };

        var file_to_write: std.fs.File = undefined;
        var output_path: Fs.Path = undefined;

        switch (write_destination_type) {
            .stdout => {
                file_to_write = std.io.getStdOut();
                output_path = Fs.Path.init("stdout");
            },
            .disk => {
                const output_dir = _output_dir orelse unreachable;
                output_path = Fs.Path.init(try allocator.dupe(u8, resolve_path.relative(transformer.cwd, entry_point)));
                file_to_write = try output_dir.createFile(entry_point, .{});
            },
        }

        switch (loader) {
            .jsx, .js, .ts, .tsx => {
                jsx.parse = loader.isJSX();
                var file_op = options.OutputFile.FileOperation.fromFile(file_to_write.handle, output_path.pretty);

                var parser_opts = js_parser.Parser.Options.init(jsx.*, loader);
                file_op.is_tmpdir = false;
                output_file.value = .{ .move = file_op };

                if (_output_dir) |output_dir| {
                    file_op.dir = output_dir.fd;
                }

                file_op.fd = file.handle;
                var parser = try js_parser.Parser.init(parser_opts, log, _source, transformer.define, allocator);
                parser_opts.can_import_from_bundle = false;
                const result = try parser.parse();

                const ast = result.ast;
                var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

                output_file.size = try js_printer.printAst(
                    js_printer.FileWriter,
                    js_printer.NewFileWriter(file_to_write),
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    _source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .transform_imports = false,
                        .runtime_imports = ast.runtime_imports,
                    },
                    u1,
                    null,
                );
            },
            else => {
                unreachable;
            },
        }

        js_ast.Expr.Data.Store.reset();
        js_ast.Stmt.Data.Store.reset();
        try output_files.append(output_file);
    }

    pub fn _transform(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: js_parser.Parser.Options,
        loader: options.Loader,
        define: *const Define,
        source: *const logger.Source,
        comptime Writer: type,
        writer: Writer,
    ) !usize {
        var ast: js_ast.Ast = undefined;

        switch (loader) {
            .json => {
                var expr = try json_parser.ParseJSON(source, log, allocator);
                var stmt = js_ast.Stmt.alloc(allocator, js_ast.S.ExportDefault{
                    .value = js_ast.StmtOrExpr{ .expr = expr },
                    .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
                }, logger.Loc{ .start = 0 });
                var stmts = try allocator.alloc(js_ast.Stmt, 1);
                stmts[0] = stmt;
                var parts = try allocator.alloc(js_ast.Part, 1);
                parts[0] = js_ast.Part{ .stmts = stmts };

                ast = js_ast.Ast.initTest(parts);
            },
            .jsx, .tsx, .ts, .js => {
                var parser = try js_parser.Parser.init(opts, log, source, define, allocator);
                var res = try parser.parse();
                ast = res.ast;

                if (FeatureFlags.print_ast) {
                    try ast.toJSON(allocator, std.io.getStdErr().writer());
                }
            },
            else => {
                Global.panic("Unsupported loader: {s} for path: {s}", .{ loader, source.path.text });
            },
        }

        var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

        return try js_printer.printAst(
            Writer,
            writer,
            ast,
            js_ast.Symbol.Map.initList(symbols),
            source,
            false,
            js_printer.Options{
                .to_module_ref = ast.module_ref orelse js_ast.Ref{ .inner_index = 0 },
                .transform_imports = false,
                .runtime_imports = ast.runtime_imports,
            },
            null,
        );
    }
};
