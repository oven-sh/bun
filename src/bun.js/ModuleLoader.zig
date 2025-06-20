const ModuleLoader = @This();

pub const node_fallbacks = @import("../node_fallbacks.zig");

transpile_source_code_arena: ?*bun.ArenaAllocator = null,
eval_source: ?*logger.Source = null,

comptime {
    _ = Bun__transpileVirtualModule;
    _ = Bun__runVirtualModule;
    _ = Bun__transpileFile;
    _ = Bun__fetchBuiltinModule;
    _ = Bun__getDefaultLoader;
}

pub var is_allowed_to_use_internal_testing_apis = false;

/// This must be called after calling transpileSourceCode
pub fn resetArena(this: *ModuleLoader, jsc_vm: *VirtualMachine) void {
    bun.assert(&jsc_vm.module_loader == this);
    if (this.transpile_source_code_arena) |arena| {
        if (jsc_vm.smol) {
            _ = arena.reset(.free_all);
        } else {
            _ = arena.reset(.{ .retain_with_limit = 8 * 1024 * 1024 });
        }
    }
}

pub fn resolveEmbeddedFile(vm: *VirtualMachine, input_path: []const u8, extname: []const u8) ?[]const u8 {
    if (input_path.len == 0) return null;
    var graph = vm.standalone_module_graph orelse return null;
    const file = graph.find(input_path) orelse return null;

    if (comptime Environment.isLinux) {
        // TODO: use /proc/fd/12346 instead! Avoid the copy!
    }

    // atomically write to a tmpfile and then move it to the final destination
    var tmpname_buf: bun.PathBuffer = undefined;
    const tmpfilename = bun.sliceTo(bun.fs.FileSystem.instance.tmpname(extname, &tmpname_buf, bun.hash(file.name)) catch return null, 0);

    const tmpdir: bun.FD = .fromStdDir(bun.fs.FileSystem.instance.tmpdir() catch return null);

    // First we open the tmpfile, to avoid any other work in the event of failure.
    const tmpfile = bun.Tmpfile.create(tmpdir, tmpfilename).unwrap() catch return null;
    defer tmpfile.fd.close();

    switch (bun.api.node.fs.NodeFS.writeFileWithPathBuffer(
        &tmpname_buf, // not used

        .{
            .data = .{
                .encoded_slice = ZigString.Slice.fromUTF8NeverFree(file.contents),
            },
            .dirfd = tmpdir,
            .file = .{ .fd = tmpfile.fd },
            .encoding = .buffer,
        },
    )) {
        .err => {
            return null;
        },
        else => {},
    }
    return bun.path.joinAbs(bun.fs.FileSystem.instance.fs.tmpdirPath(), .auto, tmpfilename);
}

pub const AsyncModule = struct {
    // This is all the state used by the printer to print the module
    parse_result: ParseResult,
    promise: JSC.Strong.Optional = .empty,
    path: Fs.Path,
    specifier: string = "",
    referrer: string = "",
    string_buf: []u8 = &[_]u8{},
    fd: ?StoredFileDescriptorType = null,
    package_json: ?*PackageJSON = null,
    loader: Api.Loader,
    hash: u32 = std.math.maxInt(u32),
    globalThis: *JSGlobalObject = undefined,
    arena: *bun.ArenaAllocator,

    // This is the specific state for making it async
    poll_ref: Async.KeepAlive = .{},
    any_task: JSC.AnyTask = undefined,

    pub const Id = u32;

    const PackageDownloadError = struct {
        name: []const u8,
        resolution: Install.Resolution,
        err: anyerror,
        url: []const u8,
    };

    const PackageResolveError = struct {
        name: []const u8,
        err: anyerror,
        url: []const u8,
        version: Dependency.Version,
    };

    pub const Queue = struct {
        map: Map = .{},
        scheduled: u32 = 0,
        concurrent_task_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

        const DeferredDependencyError = struct {
            dependency: Dependency,
            root_dependency_id: Install.DependencyID,
            err: anyerror,
        };

        pub const Map = std.ArrayListUnmanaged(AsyncModule);

        pub fn enqueue(this: *Queue, globalObject: *JSGlobalObject, opts: anytype) void {
            debug("enqueue: {s}", .{opts.specifier});
            var module = AsyncModule.init(opts, globalObject) catch unreachable;
            module.poll_ref.ref(this.vm());

            this.map.append(this.vm().allocator, module) catch unreachable;
            this.vm().packageManager().drainDependencyList();
        }

        pub fn onDependencyError(ctx: *anyopaque, dependency: Dependency, root_dependency_id: Install.DependencyID, err: anyerror) void {
            var this = bun.cast(*Queue, ctx);
            debug("onDependencyError: {s}", .{this.vm().packageManager().lockfile.str(&dependency.name)});

            var modules: []AsyncModule = this.map.items;
            var i: usize = 0;
            outer: for (modules) |module_| {
                var module = module_;
                const root_dependency_ids = module.parse_result.pending_imports.items(.root_dependency_id);
                for (root_dependency_ids, 0..) |dep, dep_i| {
                    if (dep != root_dependency_id) continue;
                    module.resolveError(
                        this.vm(),
                        module.parse_result.pending_imports.items(.import_record_id)[dep_i],
                        .{
                            .name = this.vm().packageManager().lockfile.str(&dependency.name),
                            .err = err,
                            .url = "",
                            .version = dependency.version,
                        },
                    ) catch unreachable;
                    continue :outer;
                }

                modules[i] = module;
                i += 1;
            }
            this.map.items.len = i;
        }
        pub fn onWakeHandler(ctx: *anyopaque, _: *PackageManager) void {
            debug("onWake", .{});
            var this = bun.cast(*Queue, ctx);
            this.vm().enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(this));
        }

        pub fn onPoll(this: *Queue) void {
            debug("onPoll", .{});
            this.runTasks();
            this.pollModules();
        }

        pub fn runTasks(this: *Queue) void {
            var pm = this.vm().packageManager();

            if (Output.enable_ansi_colors_stderr) {
                pm.startProgressBarIfNone();
                pm.runTasks(
                    *Queue,
                    this,
                    .{
                        .onExtract = {},
                        .onResolve = onResolve,
                        .onPackageManifestError = onPackageManifestError,
                        .onPackageDownloadError = onPackageDownloadError,
                        .progress_bar = true,
                    },
                    true,
                    PackageManager.Options.LogLevel.default,
                ) catch unreachable;
            } else {
                pm.runTasks(
                    *Queue,
                    this,
                    .{
                        .onExtract = {},
                        .onResolve = onResolve,
                        .onPackageManifestError = onPackageManifestError,
                        .onPackageDownloadError = onPackageDownloadError,
                    },
                    true,
                    PackageManager.Options.LogLevel.default_no_progress,
                ) catch unreachable;
            }
        }

        pub fn onResolve(_: *Queue) void {
            debug("onResolve", .{});
        }

        pub fn onPackageManifestError(
            this: *Queue,
            name: []const u8,
            err: anyerror,
            url: []const u8,
        ) void {
            debug("onPackageManifestError: {s}", .{name});

            var modules: []AsyncModule = this.map.items;
            var i: usize = 0;
            outer: for (modules) |module_| {
                var module = module_;
                const tags = module.parse_result.pending_imports.items(.tag);
                for (tags, 0..) |tag, tag_i| {
                    if (tag == .resolve) {
                        const esms = module.parse_result.pending_imports.items(.esm);
                        const esm = esms[tag_i];
                        const string_bufs = module.parse_result.pending_imports.items(.string_buf);

                        if (!strings.eql(esm.name.slice(string_bufs[tag_i]), name)) continue;

                        const versions = module.parse_result.pending_imports.items(.dependency);

                        module.resolveError(
                            this.vm(),
                            module.parse_result.pending_imports.items(.import_record_id)[tag_i],
                            .{
                                .name = name,
                                .err = err,
                                .url = url,
                                .version = versions[tag_i],
                            },
                        ) catch unreachable;
                        continue :outer;
                    }
                }

                modules[i] = module;
                i += 1;
            }
            this.map.items.len = i;
        }

        pub fn onPackageDownloadError(
            this: *Queue,
            package_id: Install.PackageID,
            name: []const u8,
            resolution: *const Install.Resolution,
            err: anyerror,
            url: []const u8,
        ) void {
            debug("onPackageDownloadError: {s}", .{name});

            const resolution_ids = this.vm().packageManager().lockfile.buffers.resolutions.items;
            var modules: []AsyncModule = this.map.items;
            var i: usize = 0;
            outer: for (modules) |module_| {
                var module = module_;
                const record_ids = module.parse_result.pending_imports.items(.import_record_id);
                const root_dependency_ids = module.parse_result.pending_imports.items(.root_dependency_id);
                for (root_dependency_ids, 0..) |dependency_id, import_id| {
                    if (resolution_ids[dependency_id] != package_id) continue;
                    module.downloadError(
                        this.vm(),
                        record_ids[import_id],
                        .{
                            .name = name,
                            .resolution = resolution.*,
                            .err = err,
                            .url = url,
                        },
                    ) catch unreachable;
                    continue :outer;
                }

                modules[i] = module;
                i += 1;
            }
            this.map.items.len = i;
        }

        pub fn pollModules(this: *Queue) void {
            var pm = this.vm().packageManager();
            if (pm.pending_tasks.load(.monotonic) > 0) return;

            var modules: []AsyncModule = this.map.items;
            var i: usize = 0;

            for (modules) |mod| {
                var module = mod;
                var tags = module.parse_result.pending_imports.items(.tag);
                const root_dependency_ids = module.parse_result.pending_imports.items(.root_dependency_id);
                // var esms = module.parse_result.pending_imports.items(.esm);
                // var versions = module.parse_result.pending_imports.items(.dependency);
                var done_count: usize = 0;
                for (tags, 0..) |tag, tag_i| {
                    const root_id = root_dependency_ids[tag_i];
                    const resolution_ids = pm.lockfile.buffers.resolutions.items;
                    if (root_id >= resolution_ids.len) continue;
                    const package_id = resolution_ids[root_id];

                    switch (tag) {
                        .resolve => {
                            if (package_id == Install.invalid_package_id) {
                                continue;
                            }

                            // if we get here, the package has already been resolved.
                            tags[tag_i] = .download;
                        },
                        .download => {
                            if (package_id == Install.invalid_package_id) {
                                unreachable;
                            }
                        },
                        .done => {
                            done_count += 1;
                            continue;
                        },
                    }

                    if (package_id == Install.invalid_package_id) {
                        continue;
                    }

                    const package = pm.lockfile.packages.get(package_id);
                    bun.assert(package.resolution.tag != .root);

                    var name_and_version_hash: ?u64 = null;
                    var patchfile_hash: ?u64 = null;
                    switch (pm.determinePreinstallState(package, pm.lockfile, &name_and_version_hash, &patchfile_hash)) {
                        .done => {
                            // we are only truly done if all the dependencies are done.
                            const current_tasks = pm.total_tasks;
                            // so if enqueuing all the dependencies produces no new tasks, we are done.
                            pm.enqueueDependencyList(package.dependencies);
                            if (current_tasks == pm.total_tasks) {
                                tags[tag_i] = .done;
                                done_count += 1;
                            }
                        },
                        .extracting => {
                            // we are extracting the package
                            // we need to wait for the next poll
                            continue;
                        },
                        .extract => {},
                        else => {},
                    }
                }

                if (done_count == tags.len) {
                    module.done(this.vm());
                } else {
                    modules[i] = module;
                    i += 1;
                }
            }
            this.map.items.len = i;
            if (i == 0) {
                // ensure we always end the progress bar
                this.vm().packageManager().endProgressBar();
            }
        }

        pub fn vm(this: *Queue) *VirtualMachine {
            return @alignCast(@fieldParentPtr("modules", this));
        }
    };

    pub fn init(opts: anytype, globalObject: *JSGlobalObject) !AsyncModule {
        // var stmt_blocks = js_ast.Stmt.Data.toOwnedSlice();
        // var expr_blocks = js_ast.Expr.Data.toOwnedSlice();
        const this_promise = JSValue.createInternalPromise(globalObject);
        const promise = JSC.Strong.Optional.create(this_promise, globalObject);

        var buf = bun.StringBuilder{};
        buf.count(opts.referrer);
        buf.count(opts.specifier);
        buf.count(opts.path.text);

        try buf.allocate(bun.default_allocator);
        opts.promise_ptr.?.* = this_promise.asInternalPromise().?;
        const referrer = buf.append(opts.referrer);
        const specifier = buf.append(opts.specifier);
        const path = Fs.Path.init(buf.append(opts.path.text));

        return AsyncModule{
            .parse_result = opts.parse_result,
            .promise = promise,
            .path = path,
            .specifier = specifier,
            .referrer = referrer,
            .fd = opts.fd,
            .package_json = opts.package_json,
            .loader = opts.loader.toAPI(),
            .string_buf = buf.allocatedSlice(),
            // .stmt_blocks = stmt_blocks,
            // .expr_blocks = expr_blocks,
            .globalThis = globalObject,
            .arena = opts.arena,
        };
    }

    pub fn done(this: *AsyncModule, jsc_vm: *VirtualMachine) void {
        var clone = jsc_vm.allocator.create(AsyncModule) catch unreachable;
        clone.* = this.*;
        jsc_vm.modules.scheduled += 1;
        clone.any_task = JSC.AnyTask.New(AsyncModule, onDone).init(clone);
        jsc_vm.enqueueTask(JSC.Task.init(&clone.any_task));
    }

    pub fn onDone(this: *AsyncModule) void {
        JSC.markBinding(@src());
        var jsc_vm = this.globalThis.bunVM();
        jsc_vm.modules.scheduled -= 1;
        if (jsc_vm.modules.scheduled == 0) {
            jsc_vm.packageManager().endProgressBar();
        }
        var log = logger.Log.init(jsc_vm.allocator);
        defer log.deinit();
        var errorable: JSC.ErrorableResolvedSource = undefined;
        this.poll_ref.unref(jsc_vm);
        outer: {
            errorable = JSC.ErrorableResolvedSource.ok(this.resumeLoadingModule(&log) catch |err| {
                switch (err) {
                    error.JSError => {
                        errorable = .err(error.JSError, this.globalThis.takeError(error.JSError));
                        break :outer;
                    },
                    else => {
                        VirtualMachine.processFetchLog(
                            this.globalThis,
                            bun.String.init(this.specifier),
                            bun.String.init(this.referrer),
                            &log,
                            &errorable,
                            err,
                        );
                        break :outer;
                    },
                }
            });
        }

        var spec = bun.String.init(ZigString.init(this.specifier).withEncoding());
        var ref = bun.String.init(ZigString.init(this.referrer).withEncoding());
        Bun__onFulfillAsyncModule(
            this.globalThis,
            this.promise.get().?,
            &errorable,
            &spec,
            &ref,
        );
        this.deinit();
        jsc_vm.allocator.destroy(this);
    }

    pub fn fulfill(
        globalThis: *JSGlobalObject,
        promise: JSValue,
        resolved_source: *ResolvedSource,
        err: ?anyerror,
        specifier_: bun.String,
        referrer_: bun.String,
        log: *logger.Log,
    ) bun.JSExecutionTerminated!void {
        JSC.markBinding(@src());
        var specifier = specifier_;
        var referrer = referrer_;
        var scope: JSC.CatchScope = undefined;
        scope.init(globalThis, @src(), .enabled);
        defer {
            specifier.deref();
            referrer.deref();
            scope.deinit();
        }

        var errorable: JSC.ErrorableResolvedSource = undefined;
        if (err) |e| {
            defer {
                if (resolved_source.source_code_needs_deref) {
                    resolved_source.source_code_needs_deref = false;
                    resolved_source.source_code.deref();
                }
            }

            if (e == error.JSError) {
                errorable = JSC.ErrorableResolvedSource.err(error.JSError, globalThis.takeError(error.JSError));
            } else {
                VirtualMachine.processFetchLog(
                    globalThis,
                    specifier,
                    referrer,
                    log,
                    &errorable,
                    e,
                );
            }
        } else {
            errorable = JSC.ErrorableResolvedSource.ok(resolved_source.*);
        }
        log.deinit();

        debug("fulfill: {any}", .{specifier});

        Bun__onFulfillAsyncModule(
            globalThis,
            promise,
            &errorable,
            &specifier,
            &referrer,
        );
        try scope.assertNoExceptionExceptTermination();
    }

    pub fn resolveError(this: *AsyncModule, vm: *VirtualMachine, import_record_id: u32, result: PackageResolveError) !void {
        const globalThis = this.globalThis;

        const msg: []u8 = try switch (result.err) {
            error.PackageManifestHTTP400 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 400 while resolving package '{s}' at '{s}'",
                .{ result.name, result.url },
            ),
            error.PackageManifestHTTP401 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 401 while resolving package '{s}' at '{s}'",
                .{ result.name, result.url },
            ),
            error.PackageManifestHTTP402 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 402 while resolving package '{s}' at '{s}'",
                .{ result.name, result.url },
            ),
            error.PackageManifestHTTP403 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 403 while resolving package '{s}' at '{s}'",
                .{ result.name, result.url },
            ),
            error.PackageManifestHTTP404 => std.fmt.allocPrint(
                bun.default_allocator,
                "Package '{s}' was not found",
                .{result.name},
            ),
            error.PackageManifestHTTP4xx => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 4xx while resolving package '{s}' at '{s}'",
                .{ result.name, result.url },
            ),
            error.PackageManifestHTTP5xx => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 5xx while resolving package '{s}' at '{s}'",
                .{ result.name, result.url },
            ),
            error.DistTagNotFound, error.NoMatchingVersion => brk: {
                const prefix: []const u8 = if (result.err == error.NoMatchingVersion and result.version.tag == .npm and result.version.value.npm.version.isExact())
                    "Version not found"
                else if (result.version.tag == .npm and !result.version.value.npm.version.isExact())
                    "No matching version found"
                else
                    "No match found";

                break :brk std.fmt.allocPrint(
                    bun.default_allocator,
                    "{s} '{s}' for package '{s}' (but package exists)",
                    .{ prefix, vm.packageManager().lockfile.str(&result.version.literal), result.name },
                );
            },
            else => |err| std.fmt.allocPrint(
                bun.default_allocator,
                "{s} resolving package '{s}' at '{s}'",
                .{ bun.asByteSlice(@errorName(err)), result.name, result.url },
            ),
        };

        const name: []const u8 = switch (result.err) {
            error.NoMatchingVersion => "PackageVersionNotFound",
            error.DistTagNotFound => "PackageTagNotFound",
            error.PackageManifestHTTP403 => "PackageForbidden",
            error.PackageManifestHTTP404 => "PackageNotFound",
            else => "PackageResolveError",
        };

        var error_instance = ZigString.init(msg).withEncoding().toErrorInstance(globalThis);
        if (result.url.len > 0)
            error_instance.put(globalThis, ZigString.static("url"), ZigString.init(result.url).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("name"), ZigString.init(name).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("pkg"), ZigString.init(result.name).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("specifier"), ZigString.init(this.specifier).withEncoding().toJS(globalThis));
        const location = logger.rangeData(&this.parse_result.source, this.parse_result.ast.import_records.at(import_record_id).range, "").location.?;
        error_instance.put(globalThis, ZigString.static("sourceURL"), ZigString.init(this.parse_result.source.path.text).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("line"), JSValue.jsNumber(location.line));
        if (location.line_text) |line_text| {
            error_instance.put(globalThis, ZigString.static("lineText"), ZigString.init(line_text).withEncoding().toJS(globalThis));
        }
        error_instance.put(globalThis, ZigString.static("column"), JSValue.jsNumber(location.column));
        if (this.referrer.len > 0 and !strings.eqlComptime(this.referrer, "undefined")) {
            error_instance.put(globalThis, ZigString.static("referrer"), ZigString.init(this.referrer).withEncoding().toJS(globalThis));
        }

        const promise_value = this.promise.swap();
        var promise = promise_value.asInternalPromise().?;
        promise_value.ensureStillAlive();
        this.poll_ref.unref(vm);
        this.deinit();
        promise.rejectAsHandled(globalThis, error_instance);
    }
    pub fn downloadError(this: *AsyncModule, vm: *VirtualMachine, import_record_id: u32, result: PackageDownloadError) !void {
        const globalThis = this.globalThis;

        const msg_args = .{
            result.name,
            result.resolution.fmt(vm.packageManager().lockfile.buffers.string_bytes.items, .any),
        };

        const msg: []u8 = try switch (result.err) {
            error.TarballHTTP400 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 400 downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballHTTP401 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 401 downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballHTTP402 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 402 downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballHTTP403 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 403 downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballHTTP404 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 404 downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballHTTP4xx => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 4xx downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballHTTP5xx => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 5xx downloading package '{s}@{any}'",
                msg_args,
            ),
            error.TarballFailedToExtract => std.fmt.allocPrint(
                bun.default_allocator,
                "Failed to extract tarball for package '{s}@{any}'",
                msg_args,
            ),
            else => |err| std.fmt.allocPrint(
                bun.default_allocator,
                "{s} downloading package '{s}@{any}'",
                .{
                    bun.asByteSlice(@errorName(err)),
                    result.name,
                    result.resolution.fmt(vm.packageManager().lockfile.buffers.string_bytes.items, .any),
                },
            ),
        };

        const name: []const u8 = switch (result.err) {
            error.TarballFailedToExtract => "PackageExtractionError",
            error.TarballHTTP403 => "TarballForbiddenError",
            error.TarballHTTP404 => "TarballNotFoundError",
            else => "TarballDownloadError",
        };

        var error_instance = ZigString.init(msg).withEncoding().toErrorInstance(globalThis);
        if (result.url.len > 0)
            error_instance.put(globalThis, ZigString.static("url"), ZigString.init(result.url).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("name"), ZigString.init(name).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("pkg"), ZigString.init(result.name).withEncoding().toJS(globalThis));
        if (this.specifier.len > 0 and !strings.eqlComptime(this.specifier, "undefined")) {
            error_instance.put(globalThis, ZigString.static("referrer"), ZigString.init(this.specifier).withEncoding().toJS(globalThis));
        }

        const location = logger.rangeData(&this.parse_result.source, this.parse_result.ast.import_records.at(import_record_id).range, "").location.?;
        error_instance.put(globalThis, ZigString.static("specifier"), ZigString.init(
            this.parse_result.ast.import_records.at(import_record_id).path.text,
        ).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("sourceURL"), ZigString.init(this.parse_result.source.path.text).withEncoding().toJS(globalThis));
        error_instance.put(globalThis, ZigString.static("line"), JSValue.jsNumber(location.line));
        if (location.line_text) |line_text| {
            error_instance.put(globalThis, ZigString.static("lineText"), ZigString.init(line_text).withEncoding().toJS(globalThis));
        }
        error_instance.put(globalThis, ZigString.static("column"), JSValue.jsNumber(location.column));

        const promise_value = this.promise.swap();
        var promise = promise_value.asInternalPromise().?;
        promise_value.ensureStillAlive();
        this.poll_ref.unref(vm);
        this.deinit();
        promise.rejectAsHandled(globalThis, error_instance);
    }

    pub fn resumeLoadingModule(this: *AsyncModule, log: *logger.Log) !ResolvedSource {
        debug("resumeLoadingModule: {s}", .{this.specifier});
        var parse_result = this.parse_result;
        const path = this.path;
        var jsc_vm = VirtualMachine.get();
        const specifier = this.specifier;
        const old_log = jsc_vm.log;

        jsc_vm.transpiler.linker.log = log;
        jsc_vm.transpiler.log = log;
        jsc_vm.transpiler.resolver.log = log;
        jsc_vm.packageManager().log = log;
        defer {
            jsc_vm.transpiler.linker.log = old_log;
            jsc_vm.transpiler.log = old_log;
            jsc_vm.transpiler.resolver.log = old_log;
            jsc_vm.packageManager().log = old_log;
        }

        // We _must_ link because:
        // - node_modules bundle won't be properly
        try jsc_vm.transpiler.linker.link(
            path,
            &parse_result,
            jsc_vm.origin,
            .absolute_path,
            false,
            true,
        );
        this.parse_result = parse_result;

        var printer = VirtualMachine.source_code_printer.?.*;
        printer.ctx.reset();

        {
            var mapper = jsc_vm.sourceMapHandler(&printer);
            defer VirtualMachine.source_code_printer.?.* = printer;
            _ = try jsc_vm.transpiler.printWithSourceMap(
                parse_result,
                @TypeOf(&printer),
                &printer,
                .esm_ascii,
                mapper.get(),
            );
        }

        if (comptime Environment.dump_source) {
            dumpSource(jsc_vm, specifier, &printer);
        }

        if (jsc_vm.isWatcherEnabled()) {
            var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, bun.String.init(specifier), path.text, null, false);

            if (parse_result.input_fd) |fd_| {
                if (std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                    _ = jsc_vm.bun_watcher.addFile(
                        fd_,
                        path.text,
                        this.hash,
                        options.Loader.fromAPI(this.loader),
                        .invalid,
                        this.package_json,
                        true,
                    );
                }
            }

            resolved_source.is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs;

            return resolved_source;
        }

        return ResolvedSource{
            .allocator = null,
            .source_code = bun.String.createLatin1(printer.ctx.getWritten()),
            .specifier = String.init(specifier),
            .source_url = String.init(path.text),
            .is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs,
        };
    }

    pub fn deinit(this: *AsyncModule) void {
        this.promise.deinit();
        this.parse_result.deinit();
        this.arena.deinit();
        this.globalThis.bunVM().allocator.destroy(this.arena);
        // bun.default_allocator.free(this.stmt_blocks);
        // bun.default_allocator.free(this.expr_blocks);

        bun.default_allocator.free(this.string_buf);
    }

    extern "c" fn Bun__onFulfillAsyncModule(
        globalObject: *JSGlobalObject,
        promiseValue: JSValue,
        res: *JSC.ErrorableResolvedSource,
        specifier: *bun.String,
        referrer: *bun.String,
    ) void;
};

pub export fn Bun__getDefaultLoader(global: *JSGlobalObject, str: *const bun.String) Api.Loader {
    var jsc_vm = global.bunVM();
    const filename = str.toUTF8(jsc_vm.allocator);
    defer filename.deinit();
    const loader = jsc_vm.transpiler.options.loader(Fs.PathName.init(filename.slice()).ext).toAPI();
    if (loader == .file) {
        return Api.Loader.js;
    }

    return loader;
}

pub fn transpileSourceCode(
    jsc_vm: *VirtualMachine,
    specifier: string,
    referrer: string,
    input_specifier: String,
    path: Fs.Path,
    loader: options.Loader,
    module_type: options.ModuleType,
    log: *logger.Log,
    virtual_source: ?*const logger.Source,
    promise_ptr: ?*?*JSC.JSInternalPromise,
    source_code_printer: *js_printer.BufferPrinter,
    globalObject: ?*JSGlobalObject,
    comptime flags: FetchFlags,
) !ResolvedSource {
    const disable_transpilying = comptime flags.disableTranspiling();

    if (comptime disable_transpilying) {
        if (!(loader.isJavaScriptLike() or loader == .toml or loader == .text or loader == .json or loader == .jsonc)) {
            // Don't print "export default <file path>"
            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.empty,
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
            };
        }
    }

    switch (loader) {
        .js, .jsx, .ts, .tsx, .json, .jsonc, .toml, .text => {
            // Ensure that if there was an ASTMemoryAllocator in use, it's not used anymore.
            var ast_scope = js_ast.ASTMemoryAllocator.Scope{};
            ast_scope.enter();
            defer ast_scope.exit();

            jsc_vm.transpiled_count += 1;
            jsc_vm.transpiler.resetStore();
            const hash = bun.Watcher.getHash(path.text);
            const is_main = jsc_vm.main.len == path.text.len and
                jsc_vm.main_hash == hash and
                strings.eqlLong(jsc_vm.main, path.text, false);

            var arena_: ?*bun.ArenaAllocator = brk: {
                // Attempt to reuse the Arena from the parser when we can
                // This code is potentially re-entrant, so only one Arena can be reused at a time
                // That's why we have to check if the Arena is null
                //
                // Using an Arena here is a significant memory optimization when loading many files
                if (jsc_vm.module_loader.transpile_source_code_arena) |shared| {
                    jsc_vm.module_loader.transpile_source_code_arena = null;
                    break :brk shared;
                }

                // we must allocate the arena so that the pointer it points to is always valid.
                const arena = try jsc_vm.allocator.create(bun.ArenaAllocator);
                arena.* = bun.ArenaAllocator.init(bun.default_allocator);
                break :brk arena;
            };

            var give_back_arena = true;
            defer {
                if (give_back_arena) {
                    if (jsc_vm.module_loader.transpile_source_code_arena == null) {
                        // when .print_source is used
                        // caller is responsible for freeing the arena
                        if (flags != .print_source) {
                            if (jsc_vm.smol) {
                                _ = arena_.?.reset(.free_all);
                            } else {
                                _ = arena_.?.reset(.{ .retain_with_limit = 8 * 1024 * 1024 });
                            }
                        }

                        jsc_vm.module_loader.transpile_source_code_arena = arena_;
                    } else {
                        arena_.?.deinit();
                        jsc_vm.allocator.destroy(arena_.?);
                    }
                }
            }

            var arena = arena_.?;
            const allocator = arena.allocator();

            var fd: ?StoredFileDescriptorType = null;
            var package_json: ?*PackageJSON = null;

            if (jsc_vm.bun_watcher.indexOf(hash)) |index| {
                fd = jsc_vm.bun_watcher.watchlist().items(.fd)[index].unwrapValid();
                package_json = jsc_vm.bun_watcher.watchlist().items(.package_json)[index];
            }

            var cache = JSC.RuntimeTranspilerCache{
                .output_code_allocator = allocator,
                .sourcemap_allocator = bun.default_allocator,
            };

            const old = jsc_vm.transpiler.log;
            jsc_vm.transpiler.log = log;
            jsc_vm.transpiler.linker.log = log;
            jsc_vm.transpiler.resolver.log = log;
            if (jsc_vm.transpiler.resolver.package_manager) |pm| {
                pm.log = log;
            }

            defer {
                jsc_vm.transpiler.log = old;
                jsc_vm.transpiler.linker.log = old;
                jsc_vm.transpiler.resolver.log = old;
                if (jsc_vm.transpiler.resolver.package_manager) |pm| {
                    pm.log = old;
                }
            }

            // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
            const is_node_override = strings.hasPrefixComptime(specifier, node_fallbacks.import_path);

            const macro_remappings = if (jsc_vm.macro_mode or !jsc_vm.has_any_macro_remappings or is_node_override)
                MacroRemap{}
            else
                jsc_vm.transpiler.options.macro_remap;

            var fallback_source: logger.Source = undefined;

            // Usually, we want to close the input file automatically.
            //
            // If we're re-using the file descriptor from the fs watcher
            // Do not close it because that will break the kqueue-based watcher
            //
            var should_close_input_file_fd = fd == null;

            // We don't want cjs wrappers around non-js files
            const module_type_only_for_wrappables = switch (loader) {
                .js, .jsx, .ts, .tsx => module_type,
                else => .unknown,
            };

            var input_file_fd: StoredFileDescriptorType = bun.invalid_fd;
            var parse_options = Transpiler.ParseOptions{
                .allocator = allocator,
                .path = path,
                .loader = loader,
                .dirname_fd = bun.invalid_fd,
                .file_descriptor = fd,
                .file_fd_ptr = &input_file_fd,
                .file_hash = hash,
                .macro_remappings = macro_remappings,
                .jsx = jsc_vm.transpiler.options.jsx,
                .emit_decorator_metadata = jsc_vm.transpiler.options.emit_decorator_metadata,
                .virtual_source = virtual_source,
                .dont_bundle_twice = true,
                .allow_commonjs = true,
                .module_type = module_type_only_for_wrappables,
                .inject_jest_globals = jsc_vm.transpiler.options.rewrite_jest_for_tests,
                .keep_json_and_toml_as_one_statement = true,
                .allow_bytecode_cache = true,
                .set_breakpoint_on_first_line = is_main and
                    jsc_vm.debugger != null and
                    jsc_vm.debugger.?.set_breakpoint_on_first_line and
                    setBreakPointOnFirstLine(),
                .runtime_transpiler_cache = if (!disable_transpilying and !JSC.RuntimeTranspilerCache.is_disabled) &cache else null,
                .remove_cjs_module_wrapper = is_main and jsc_vm.module_loader.eval_source != null,
            };
            defer {
                if (should_close_input_file_fd and input_file_fd != bun.invalid_fd) {
                    input_file_fd.close();
                    input_file_fd = bun.invalid_fd;
                }
            }

            if (is_node_override) {
                if (node_fallbacks.contentsFromPath(specifier)) |code| {
                    const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                    fallback_source = logger.Source{ .path = fallback_path, .contents = code };
                    parse_options.virtual_source = &fallback_source;
                }
            }

            var parse_result: ParseResult = switch (disable_transpilying or
                (loader == .json)) {
                inline else => |return_file_only| brk: {
                    break :brk jsc_vm.transpiler.parseMaybeReturnFileOnly(
                        parse_options,
                        null,
                        return_file_only,
                    ) orelse {
                        if (comptime !disable_transpilying) {
                            if (jsc_vm.isWatcherEnabled()) {
                                if (input_file_fd.isValid()) {
                                    if (!is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                                        should_close_input_file_fd = false;
                                        _ = jsc_vm.bun_watcher.addFile(
                                            input_file_fd,
                                            path.text,
                                            hash,
                                            loader,
                                            .invalid,
                                            package_json,
                                            true,
                                        );
                                    }
                                }
                            }
                        }

                        give_back_arena = false;
                        return error.ParseError;
                    };
                },
            };

            const source = &parse_result.source;

            if (parse_result.loader == .wasm) {
                return transpileSourceCode(
                    jsc_vm,
                    specifier,
                    referrer,
                    input_specifier,
                    path,
                    .wasm,
                    .unknown, // cjs/esm don't make sense for wasm
                    log,
                    &parse_result.source,
                    promise_ptr,
                    source_code_printer,
                    globalObject,
                    flags,
                );
            }

            if (comptime !disable_transpilying) {
                if (jsc_vm.isWatcherEnabled()) {
                    if (input_file_fd.isValid()) {
                        if (!is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                            should_close_input_file_fd = false;
                            _ = jsc_vm.bun_watcher.addFile(
                                input_file_fd,
                                path.text,
                                hash,
                                loader,
                                .invalid,
                                package_json,
                                true,
                            );
                        }
                    }
                }
            }

            if (jsc_vm.transpiler.log.errors > 0) {
                give_back_arena = false;
                return error.ParseError;
            }

            if (loader == .json) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.createUTF8(source.contents),
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = ResolvedSource.Tag.json_for_object_loader,
                };
            }

            if (comptime disable_transpilying) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = switch (comptime flags) {
                        .print_source_and_clone => bun.String.init(jsc_vm.allocator.dupe(u8, source.contents) catch unreachable),
                        .print_source => bun.String.init(source.contents),
                        else => @compileError("unreachable"),
                    },
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                };
            }

            if (loader == .json or loader == .jsonc or loader == .toml) {
                if (parse_result.empty) {
                    return ResolvedSource{
                        .allocator = null,
                        .specifier = input_specifier,
                        .source_url = input_specifier.createIfDifferent(path.text),
                        .jsvalue_for_export = JSValue.createEmptyObject(jsc_vm.global, 0),
                        .tag = .exports_object,
                    };
                }

                return ResolvedSource{
                    .allocator = null,
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .jsvalue_for_export = parse_result.ast.parts.@"[0]"().stmts[0].data.s_expr.value.toJS(allocator, globalObject orelse jsc_vm.global) catch |e| panic("Unexpected JS error: {s}", .{@errorName(e)}),
                    .tag = .exports_object,
                };
            }

            if (parse_result.already_bundled != .none) {
                const bytecode_slice = parse_result.already_bundled.bytecodeSlice();
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.createLatin1(source.contents),
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .already_bundled = true,
                    .bytecode_cache = if (bytecode_slice.len > 0) bytecode_slice.ptr else null,
                    .bytecode_cache_size = bytecode_slice.len,
                    .is_commonjs_module = parse_result.already_bundled.isCommonJS(),
                };
            }

            if (parse_result.empty) {
                const was_cjs = (loader == .js or loader == .ts) and brk: {
                    const ext = std.fs.path.extension(source.path.text);
                    break :brk strings.eqlComptime(ext, ".cjs") or strings.eqlComptime(ext, ".cts");
                };
                if (was_cjs) {
                    return .{
                        .allocator = null,
                        .source_code = bun.String.static("(function(){})"),
                        .specifier = input_specifier,
                        .source_url = input_specifier.createIfDifferent(path.text),
                        .is_commonjs_module = true,
                        .tag = .javascript,
                    };
                }
            }

            if (cache.entry) |*entry| {
                jsc_vm.source_mappings.putMappings(source, .{
                    .list = .{ .items = @constCast(entry.sourcemap), .capacity = entry.sourcemap.len },
                    .allocator = bun.default_allocator,
                }) catch {};

                if (comptime Environment.allow_assert) {
                    dumpSourceString(jsc_vm, specifier, entry.output_code.byteSlice());
                }

                return ResolvedSource{
                    .allocator = null,
                    .source_code = switch (entry.output_code) {
                        .string => entry.output_code.string,
                        .utf8 => brk: {
                            const result = bun.String.createUTF8(entry.output_code.utf8);
                            cache.output_code_allocator.free(entry.output_code.utf8);
                            entry.output_code.utf8 = "";
                            break :brk result;
                        },
                    },
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .is_commonjs_module = entry.metadata.module_type == .cjs,
                    .tag = brk: {
                        if (entry.metadata.module_type == .cjs and source.path.isFile()) {
                            const actual_package_json: *PackageJSON = package_json orelse brk2: {
                                // this should already be cached virtually always so it's fine to do this
                                const dir_info = (jsc_vm.transpiler.resolver.readDirInfo(source.path.name.dir) catch null) orelse
                                    break :brk .javascript;

                                break :brk2 dir_info.package_json orelse dir_info.enclosing_package_json;
                            } orelse break :brk .javascript;

                            if (actual_package_json.module_type == .esm) {
                                break :brk ResolvedSource.Tag.package_json_type_module;
                            }
                        }

                        break :brk ResolvedSource.Tag.javascript;
                    },
                };
            }

            const start_count = jsc_vm.transpiler.linker.import_counter;

            // We _must_ link because:
            // - node_modules bundle won't be properly
            try jsc_vm.transpiler.linker.link(
                path,
                &parse_result,
                jsc_vm.origin,
                .absolute_path,
                false,
                true,
            );

            if (parse_result.pending_imports.len > 0) {
                if (promise_ptr == null) {
                    return error.UnexpectedPendingResolution;
                }

                if (source.contents_is_recycled) {
                    // this shared buffer is about to become owned by the AsyncModule struct
                    jsc_vm.transpiler.resolver.caches.fs.resetSharedBuffer(
                        jsc_vm.transpiler.resolver.caches.fs.sharedBuffer(),
                    );
                }

                jsc_vm.modules.enqueue(
                    globalObject.?,
                    .{
                        .parse_result = parse_result,
                        .path = path,
                        .loader = loader,
                        .fd = fd,
                        .package_json = package_json,
                        .hash = hash,
                        .promise_ptr = promise_ptr,
                        .specifier = specifier,
                        .referrer = referrer,
                        .arena = arena,
                    },
                );
                give_back_arena = false;
                return error.AsyncModule;
            }

            if (!jsc_vm.macro_mode)
                jsc_vm.resolved_count += jsc_vm.transpiler.linker.import_counter - start_count;
            jsc_vm.transpiler.linker.import_counter = 0;

            var printer = source_code_printer.*;
            printer.ctx.reset();
            defer source_code_printer.* = printer;
            _ = brk: {
                var mapper = jsc_vm.sourceMapHandler(&printer);

                break :brk try jsc_vm.transpiler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    mapper.get(),
                );
            };

            if (comptime Environment.dump_source) {
                dumpSource(jsc_vm, specifier, &printer);
            }

            defer {
                if (is_main) {
                    jsc_vm.has_loaded = true;
                }
            }

            if (jsc_vm.isWatcherEnabled()) {
                var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, input_specifier, path.text, null, false);
                resolved_source.is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs;
                return resolved_source;
            }

            // Pass along package.json type "module" if set.
            const tag: ResolvedSource.Tag = switch (loader) {
                .json, .jsonc => .json_for_object_loader,
                .js, .jsx, .ts, .tsx => brk: {
                    const module_type_ = if (package_json) |pkg| pkg.module_type else module_type;

                    break :brk switch (module_type_) {
                        .esm => .package_json_type_module,
                        .cjs => .package_json_type_commonjs,
                        else => .javascript,
                    };
                },
                else => .javascript,
            };

            return .{
                .allocator = null,
                .source_code = brk: {
                    const written = printer.ctx.getWritten();
                    const result = cache.output_code orelse bun.String.createLatin1(written);

                    if (written.len > 1024 * 1024 * 2 or jsc_vm.smol) {
                        printer.ctx.buffer.deinit();
                    }

                    break :brk result;
                },
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs,
                .tag = tag,
            };
        },
        // provideFetch() should be called
        .napi => unreachable,
        // .wasm => {
        //     jsc_vm.transpiled_count += 1;
        //     var fd: ?StoredFileDescriptorType = null;

        //     var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;

        //     const hash = http.Watcher.getHash(path.text);
        //     if (jsc_vm.watcher) |watcher| {
        //         if (watcher.indexOf(hash)) |index| {
        //             const _fd = watcher.watchlist().items(.fd)[index];
        //             fd = if (_fd > 0) _fd else null;
        //         }
        //     }

        //     var parse_options = Transpiler.ParseOptions{
        //         .allocator = allocator,
        //         .path = path,
        //         .loader = loader,
        //         .dirname_fd = 0,
        //         .file_descriptor = fd,
        //         .file_hash = hash,
        //         .macro_remappings = MacroRemap{},
        //         .jsx = jsc_vm.transpiler.options.jsx,
        //     };

        //     var parse_result = jsc_vm.transpiler.parse(
        //         parse_options,
        //         null,
        //     ) orelse {
        //         return error.ParseError;
        //     };

        //     return ResolvedSource{
        //         .allocator = if (jsc_vm.has_loaded) &jsc_vm.allocator else null,
        //         .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, source.contents) catch unreachable),
        //         .specifier = ZigString.init(specifier),
        //         .source_url = input_specifier.createIfDifferent(path.text),
        //         .tag = ResolvedSource.Tag.wasm,
        //     };
        // },
        .wasm => {
            if (strings.eqlComptime(referrer, "undefined") and strings.eqlLong(jsc_vm.main, path.text, true)) {
                if (virtual_source) |source| {
                    if (globalObject) |globalThis| {
                        // attempt to avoid reading the WASM file twice.
                        const encoded = JSC.EncodedJSValue{
                            .asPtr = globalThis,
                        };
                        const globalValue = @as(JSValue, @enumFromInt(encoded.asInt64));
                        globalValue.put(
                            globalThis,
                            ZigString.static("wasmSourceBytes"),
                            JSC.ArrayBuffer.create(globalThis, source.contents, .Uint8Array),
                        );
                    }
                }
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.static(@embedFile("../js/wasi-runner.js")),
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = .esm,
                };
            }

            return transpileSourceCode(
                jsc_vm,
                specifier,
                referrer,
                input_specifier,
                path,
                .file,
                .unknown, // cjs/esm don't make sense for wasm
                log,
                virtual_source,
                promise_ptr,
                source_code_printer,
                globalObject,
                flags,
            );
        },

        .sqlite_embedded, .sqlite => {
            const sqlite_module_source_code_string = brk: {
                if (jsc_vm.hot_reload == .hot) {
                    break :brk 
                    \\// Generated code
                    \\import {Database} from 'bun:sqlite';
                    \\const {path} = import.meta;
                    \\
                    \\// Don't reload the database if it's already loaded
                    \\const registry = (globalThis[Symbol.for("bun:sqlite:hot")] ??= new Map());
                    \\
                    \\export let db = registry.get(path);
                    \\export const __esModule = true;
                    \\if (!db) {
                    \\   // Load the database
                    \\   db = new Database(path);
                    \\   registry.set(path, db);
                    \\}
                    \\
                    \\export default db;
                    ;
                }

                break :brk 
                \\// Generated code
                \\import {Database} from 'bun:sqlite';
                \\export const db = new Database(import.meta.path);
                \\
                \\export const __esModule = true;
                \\export default db;
                ;
            };

            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.createUTF8(sqlite_module_source_code_string),
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .tag = .esm,
            };
        },

        .html => {
            if (flags.disableTranspiling()) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.empty,
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = .esm,
                };
            }

            if (globalObject == null) {
                return error.NotSupported;
            }

            const html_bundle = try JSC.API.HTMLBundle.init(globalObject.?, path.text);
            return ResolvedSource{
                .allocator = &jsc_vm.allocator,
                .jsvalue_for_export = html_bundle.toJS(globalObject.?),
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .tag = .export_default_object,
            };
        },

        else => {
            if (flags.disableTranspiling()) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.empty,
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = .esm,
                };
            }

            if (virtual_source == null) {
                if (jsc_vm.isWatcherEnabled()) auto_watch: {
                    if (std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                        const input_fd: bun.StoredFileDescriptorType = brk: {
                            // on macOS, we need a file descriptor to receive event notifications on it.
                            // so we use O_EVTONLY to open the file descriptor without asking any additional permissions.
                            if (bun.Watcher.requires_file_descriptors) {
                                switch (bun.sys.open(
                                    &(std.posix.toPosixPath(path.text) catch break :auto_watch),
                                    bun.c.O_EVTONLY,
                                    0,
                                )) {
                                    .err => break :auto_watch,
                                    .result => |fd| break :brk fd,
                                }
                            } else {
                                // Otherwise, don't even bother opening it.
                                break :brk .invalid;
                            }
                        };
                        const hash = bun.Watcher.getHash(path.text);
                        switch (jsc_vm.bun_watcher.addFile(
                            input_fd,
                            path.text,
                            hash,
                            loader,
                            .invalid,
                            null,
                            true,
                        )) {
                            .err => {
                                if (comptime Environment.isMac) {
                                    // If any error occurs and we just
                                    // opened the file descriptor to
                                    // receive event notifications on
                                    // it, we should close it.
                                    if (input_fd.isValid()) {
                                        input_fd.close();
                                    }
                                }

                                // we don't consider it a failure if we cannot watch the file
                                // they didn't open the file
                            },
                            .result => {},
                        }
                    }
                }
            }

            const value = brk: {
                if (!jsc_vm.origin.isEmpty()) {
                    var buf = MutableString.init2048(jsc_vm.allocator) catch bun.outOfMemory();
                    defer buf.deinit();
                    var writer = buf.writer();
                    JSC.API.Bun.getPublicPath(specifier, jsc_vm.origin, @TypeOf(&writer), &writer);
                    break :brk bun.String.createUTF8ForJS(globalObject.?, buf.slice());
                }

                break :brk bun.String.createUTF8ForJS(globalObject.?, path.text);
            };

            return ResolvedSource{
                .allocator = null,
                .jsvalue_for_export = value,
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .tag = .export_default_object,
            };
        },
    }
}

pub export fn Bun__resolveAndFetchBuiltinModule(
    jsc_vm: *VirtualMachine,
    specifier: *bun.String,
    ret: *JSC.ErrorableResolvedSource,
) bool {
    JSC.markBinding(@src());
    var log = logger.Log.init(jsc_vm.transpiler.allocator);
    defer log.deinit();

    const alias = HardcodedModule.Alias.bun_aliases.getWithEql(specifier.*, bun.String.eqlComptime) orelse
        return false;
    const hardcoded = HardcodedModule.map.get(alias.path) orelse {
        bun.debugAssert(false);
        return false;
    };
    ret.* = .ok(
        getHardcodedModule(jsc_vm, specifier.*, hardcoded) orelse
            return false,
    );
    return true;
}

pub export fn Bun__fetchBuiltinModule(
    jsc_vm: *VirtualMachine,
    globalObject: *JSGlobalObject,
    specifier: *bun.String,
    referrer: *bun.String,
    ret: *JSC.ErrorableResolvedSource,
) bool {
    JSC.markBinding(@src());
    var log = logger.Log.init(jsc_vm.transpiler.allocator);
    defer log.deinit();

    if (ModuleLoader.fetchBuiltinModule(
        jsc_vm,
        specifier.*,
    ) catch |err| {
        if (err == error.AsyncModule) {
            unreachable;
        }

        VirtualMachine.processFetchLog(globalObject, specifier.*, referrer.*, &log, ret, err);
        return true;
    }) |builtin| {
        ret.* = JSC.ErrorableResolvedSource.ok(builtin);
        return true;
    } else {
        return false;
    }
}

const always_sync_modules = .{"reflect-metadata"};

pub export fn Bun__transpileFile(
    jsc_vm: *VirtualMachine,
    globalObject: *JSGlobalObject,
    specifier_ptr: *bun.String,
    referrer: *bun.String,
    type_attribute: ?*const bun.String,
    ret: *JSC.ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader_type: bun.options.Loader.Optional,
) ?*anyopaque {
    JSC.markBinding(@src());
    var log = logger.Log.init(jsc_vm.transpiler.allocator);
    defer log.deinit();

    var _specifier = specifier_ptr.toUTF8(jsc_vm.allocator);
    var referrer_slice = referrer.toUTF8(jsc_vm.allocator);
    defer _specifier.deinit();
    defer referrer_slice.deinit();

    var type_attribute_str: ?string = null;
    if (type_attribute) |attribute| if (attribute.asUTF8()) |attr_utf8| {
        type_attribute_str = attr_utf8;
    };

    var virtual_source_to_use: ?logger.Source = null;
    var blob_to_deinit: ?JSC.WebCore.Blob = null;
    var lr = options.getLoaderAndVirtualSource(_specifier.slice(), jsc_vm, &virtual_source_to_use, &blob_to_deinit, type_attribute_str) catch {
        ret.* = JSC.ErrorableResolvedSource.err(error.JSErrorObject, globalObject.ERR(.MODULE_NOT_FOUND, "Blob not found", .{}).toJS());
        return null;
    };
    defer if (blob_to_deinit) |*blob| blob.deinit();

    if (force_loader_type.unwrap()) |loader_type| {
        @branchHint(.unlikely);
        bun.assert(!is_commonjs_require);
        lr.loader = loader_type;
    } else if (is_commonjs_require and jsc_vm.has_mutated_built_in_extensions > 0) {
        @branchHint(.unlikely);
        if (node_module_module.findLongestRegisteredExtension(jsc_vm, _specifier.slice())) |entry| {
            switch (entry) {
                .loader => |loader| {
                    lr.loader = loader;
                },
                .custom => |strong| {
                    ret.* = JSC.ErrorableResolvedSource.ok(ResolvedSource{
                        .allocator = null,
                        .source_code = bun.String.empty,
                        .specifier = .empty,
                        .source_url = .empty,
                        .cjs_custom_extension_index = strong.get(),
                        .tag = .common_js_custom_extension,
                    });
                    return null;
                },
            }
        }
    }

    const module_type: options.ModuleType = brk: {
        const ext = lr.path.name.ext;
        // regular expression /.[cm][jt]s$/
        if (ext.len == ".cjs".len) {
            if (strings.eqlComptimeIgnoreLen(ext, ".cjs"))
                break :brk .cjs;
            if (strings.eqlComptimeIgnoreLen(ext, ".mjs"))
                break :brk .esm;
            if (strings.eqlComptimeIgnoreLen(ext, ".cts"))
                break :brk .cjs;
            if (strings.eqlComptimeIgnoreLen(ext, ".mts"))
                break :brk .esm;
        }
        // regular expression /.[jt]s$/
        if (ext.len == ".ts".len) {
            if (strings.eqlComptimeIgnoreLen(ext, ".js") or
                strings.eqlComptimeIgnoreLen(ext, ".ts"))
            {
                // Use the package.json module type if it exists
                break :brk if (lr.package_json) |pkg|
                    pkg.module_type
                else
                    .unknown;
            }
        }
        // For JSX TSX and other extensions, let the file contents.
        break :brk .unknown;
    };
    const pkg_name: ?[]const u8 = if (lr.package_json) |pkg|
        if (pkg.name.len > 0) pkg.name else null
    else
        null;

    // We only run the transpiler concurrently when we can.
    // Today, that's:
    //
    //   Import Statements (import 'foo')
    //   Import Expressions (import('foo'))
    //
    transpile_async: {
        if (comptime bun.FeatureFlags.concurrent_transpiler) {
            const concurrent_loader = lr.loader orelse .file;
            if (blob_to_deinit == null and
                allow_promise and
                (jsc_vm.has_loaded or jsc_vm.is_in_preload) and
                concurrent_loader.isJavaScriptLike() and
                !lr.is_main and
                // Plugins make this complicated,
                // TODO: allow running concurrently when no onLoad handlers match a plugin.
                jsc_vm.plugin_runner == null and jsc_vm.transpiler_store.enabled)
            {
                // This absolutely disgusting hack is a workaround in cases
                // where an async import is made to a CJS file with side
                // effects that other modules depend on, without incurring
                // the cost of transpiling/loading CJS modules synchronously.
                //
                // The cause of this comes from the fact that we immediately
                // and synchronously evaluate CJS modules after they've been
                // transpiled, but transpiling (which, for async imports,
                // happens in a thread pool), can resolve in whatever order.
                // This messes up module execution order.
                //
                // This is only _really_ important for
                // import("some-polyfill") cases, the most impactful of
                // which is `reflect-metadata`. People could also use
                // require or just preload their polyfills, but they aren't
                // doing this. This hack makes important polyfills work without
                // incurring the cost of transpiling/loading CJS modules
                // synchronously. The proper fix is to evaluate CJS modules
                // at the same time as ES modules. This is blocked by the
                // fact that we need exports from CJS modules and our parser
                // doesn't record them.
                if (pkg_name) |pkg_name_| {
                    inline for (always_sync_modules) |always_sync_specifier| {
                        if (bun.strings.eqlComptime(pkg_name_, always_sync_specifier)) {
                            break :transpile_async;
                        }
                    }
                }

                // TODO: check if the resolved source must be transpiled synchronously
                return jsc_vm.transpiler_store.transpile(
                    jsc_vm,
                    globalObject,
                    specifier_ptr.dupeRef(),
                    lr.path,
                    referrer.dupeRef(),
                    concurrent_loader,
                    lr.package_json,
                );
            }
        }
    }

    const synchronous_loader: options.Loader = lr.loader orelse loader: {
        if (jsc_vm.has_loaded or jsc_vm.is_in_preload) {
            // Extensionless files in this context are treated as the JS loader
            if (lr.path.name.ext.len == 0) {
                break :loader .tsx;
            }

            // Unknown extensions are to be treated as file loader
            if (is_commonjs_require) {
                if (jsc_vm.commonjs_custom_extensions.entries.len > 0 and
                    jsc_vm.has_mutated_built_in_extensions == 0)
                {
                    @branchHint(.unlikely);
                    if (node_module_module.findLongestRegisteredExtension(jsc_vm, lr.path.text)) |entry| {
                        switch (entry) {
                            .loader => |loader| break :loader loader,
                            .custom => |strong| {
                                ret.* = JSC.ErrorableResolvedSource.ok(ResolvedSource{
                                    .allocator = null,
                                    .source_code = bun.String.empty,
                                    .specifier = .empty,
                                    .source_url = .empty,
                                    .cjs_custom_extension_index = strong.get(),
                                    .tag = .common_js_custom_extension,
                                });
                                return null;
                            },
                        }
                    }
                }

                // For Node.js compatibility, requiring a file with an
                // unknown extension will be treated as a JS file
                break :loader .ts;
            }

            // For ESM, Bun treats unknown extensions as file loader
            break :loader .file;
        } else {
            // Unless it's potentially the main module
            // This is important so that "bun run ./foo-i-have-no-extension" works
            break :loader .tsx;
        }
    };

    if (comptime Environment.allow_assert)
        debug("transpile({s}, {s}, sync)", .{ lr.specifier, @tagName(synchronous_loader) });

    defer jsc_vm.module_loader.resetArena(jsc_vm);

    var promise: ?*JSC.JSInternalPromise = null;
    ret.* = JSC.ErrorableResolvedSource.ok(
        ModuleLoader.transpileSourceCode(
            jsc_vm,
            lr.specifier,
            referrer_slice.slice(),
            specifier_ptr.*,
            lr.path,
            synchronous_loader,
            module_type,
            &log,
            lr.virtual_source,
            if (allow_promise) &promise else null,
            VirtualMachine.source_code_printer.?,
            globalObject,
            FetchFlags.transpile,
        ) catch |err| {
            switch (err) {
                error.AsyncModule => {
                    bun.assert(promise != null);
                    return promise;
                },
                error.PluginError => return null,
                error.JSError => {
                    ret.* = JSC.ErrorableResolvedSource.err(error.JSError, globalObject.takeError(error.JSError));
                    return null;
                },
                else => {
                    VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer.*, &log, ret, err);
                    return null;
                },
            }
        },
    );
    return promise;
}

export fn Bun__runVirtualModule(globalObject: *JSGlobalObject, specifier_ptr: *const bun.String) JSValue {
    JSC.markBinding(@src());
    if (globalObject.bunVM().plugin_runner == null) return JSValue.zero;

    const specifier_slice = specifier_ptr.toUTF8(bun.default_allocator);
    defer specifier_slice.deinit();
    const specifier = specifier_slice.slice();

    if (!PluginRunner.couldBePlugin(specifier)) {
        return JSValue.zero;
    }

    const namespace = PluginRunner.extractNamespace(specifier);
    const after_namespace = if (namespace.len == 0)
        specifier
    else
        specifier[@min(namespace.len + 1, specifier.len)..];

    return globalObject.runOnLoadPlugins(bun.String.init(namespace), bun.String.init(after_namespace), .bun) catch {
        return JSValue.zero;
    } orelse return .zero;
}

fn getHardcodedModule(jsc_vm: *VirtualMachine, specifier: bun.String, hardcoded: HardcodedModule) ?ResolvedSource {
    Analytics.Features.builtin_modules.insert(hardcoded);
    return switch (hardcoded) {
        .@"bun:main" => .{
            .allocator = null,
            .source_code = bun.String.createUTF8(jsc_vm.entry_point.source.contents),
            .specifier = specifier,
            .source_url = specifier,
            .tag = .esm,
            .source_code_needs_deref = true,
        },
        .@"bun:internal-for-testing" => {
            if (!Environment.isDebug) {
                if (!is_allowed_to_use_internal_testing_apis)
                    return null;
            }
            return jsSyntheticModule(.@"bun:internal-for-testing", specifier);
        },
        .@"bun:wrap" => .{
            .allocator = null,
            .source_code = String.init(Runtime.Runtime.sourceCode()),
            .specifier = specifier,
            .source_url = specifier,
        },
        inline else => |tag| jsSyntheticModule(@field(ResolvedSource.Tag, @tagName(tag)), specifier),
    };
}

pub fn fetchBuiltinModule(jsc_vm: *VirtualMachine, specifier: bun.String) !?ResolvedSource {
    if (HardcodedModule.map.getWithEql(specifier, bun.String.eqlComptime)) |hardcoded| {
        return getHardcodedModule(jsc_vm, specifier, hardcoded);
    }

    if (specifier.hasPrefixComptime(js_ast.Macro.namespaceWithColon)) {
        const spec = specifier.toUTF8(bun.default_allocator);
        defer spec.deinit();
        if (jsc_vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(spec.slice()))) |entry| {
            return .{
                .allocator = null,
                .source_code = bun.String.createUTF8(entry.source.contents),
                .specifier = specifier,
                .source_url = specifier.dupeRef(),
            };
        }
    } else if (jsc_vm.standalone_module_graph) |graph| {
        const specifier_utf8 = specifier.toUTF8(bun.default_allocator);
        defer specifier_utf8.deinit();
        if (graph.files.getPtr(specifier_utf8.slice())) |file| {
            if (file.loader == .sqlite or file.loader == .sqlite_embedded) {
                const code =
                    \\/* Generated code */
                    \\import {Database} from 'bun:sqlite';
                    \\import {readFileSync} from 'node:fs';
                    \\export const db = new Database(readFileSync(import.meta.path));
                    \\
                    \\export const __esModule = true;
                    \\export default db;
                ;
                return .{
                    .allocator = null,
                    .source_code = bun.String.static(code),
                    .specifier = specifier,
                    .source_url = specifier.dupeRef(),
                    .source_code_needs_deref = false,
                };
            }

            return .{
                .allocator = null,
                .source_code = file.toWTFString(),
                .specifier = specifier,
                .source_url = specifier.dupeRef(),
                .source_code_needs_deref = false,
                .bytecode_cache = if (file.bytecode.len > 0) file.bytecode.ptr else null,
                .bytecode_cache_size = file.bytecode.len,
                .is_commonjs_module = file.module_format == .cjs,
            };
        }
    }

    return null;
}

export fn Bun__transpileVirtualModule(
    globalObject: *JSGlobalObject,
    specifier_ptr: *const bun.String,
    referrer_ptr: *const bun.String,
    source_code: *ZigString,
    loader_: Api.Loader,
    ret: *JSC.ErrorableResolvedSource,
) bool {
    JSC.markBinding(@src());
    const jsc_vm = globalObject.bunVM();
    bun.assert(jsc_vm.plugin_runner != null);

    var specifier_slice = specifier_ptr.toUTF8(jsc_vm.allocator);
    const specifier = specifier_slice.slice();
    defer specifier_slice.deinit();
    var source_code_slice = source_code.toSlice(jsc_vm.allocator);
    defer source_code_slice.deinit();
    var referrer_slice = referrer_ptr.toUTF8(jsc_vm.allocator);
    defer referrer_slice.deinit();

    var virtual_source = logger.Source.initPathString(specifier, source_code_slice.slice());
    var log = logger.Log.init(jsc_vm.allocator);
    const path = Fs.Path.init(specifier);

    const loader = if (loader_ != ._none)
        options.Loader.fromAPI(loader_)
    else
        jsc_vm.transpiler.options.loaders.get(path.name.ext) orelse brk: {
            if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                break :brk options.Loader.js;
            }

            break :brk options.Loader.file;
        };

    defer log.deinit();
    defer jsc_vm.module_loader.resetArena(jsc_vm);

    ret.* = JSC.ErrorableResolvedSource.ok(
        ModuleLoader.transpileSourceCode(
            jsc_vm,
            specifier_slice.slice(),
            referrer_slice.slice(),
            specifier_ptr.*,
            path,
            loader,
            .unknown,
            &log,
            &virtual_source,
            null,
            VirtualMachine.source_code_printer.?,
            globalObject,
            FetchFlags.transpile,
        ) catch |err| {
            switch (err) {
                error.PluginError => return true,
                error.JSError => {
                    ret.* = JSC.ErrorableResolvedSource.err(error.JSError, globalObject.takeError(error.JSError));
                    return true;
                },
                else => {
                    VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer_ptr.*, &log, ret, err);
                    return true;
                },
            }
        },
    );
    Analytics.Features.virtual_modules += 1;
    return true;
}

inline fn jsSyntheticModule(name: ResolvedSource.Tag, specifier: String) ResolvedSource {
    return ResolvedSource{
        .allocator = null,
        .source_code = bun.String.empty,
        .specifier = specifier,
        .source_url = bun.String.static(@tagName(name)),
        .tag = name,
        .source_code_needs_deref = false,
    };
}

/// Dumps the module source to a file in /tmp/bun-debug-src/{filepath}
///
/// This can technically fail if concurrent access across processes happens, or permission issues.
/// Errors here should always be ignored.
fn dumpSource(vm: *VirtualMachine, specifier: string, printer: anytype) void {
    dumpSourceString(vm, specifier, printer.ctx.getWritten());
}

fn dumpSourceString(vm: *VirtualMachine, specifier: string, written: []const u8) void {
    dumpSourceStringFailiable(vm, specifier, written) catch |e| {
        Output.debugWarn("Failed to dump source string: {}", .{e});
    };
}

fn dumpSourceStringFailiable(vm: *VirtualMachine, specifier: string, written: []const u8) !void {
    if (!Environment.isDebug) return;
    if (bun.getRuntimeFeatureFlag(.BUN_DEBUG_NO_DUMP)) return;

    const BunDebugHolder = struct {
        pub var dir: ?std.fs.Dir = null;
        pub var lock: bun.Mutex = .{};
    };

    BunDebugHolder.lock.lock();
    defer BunDebugHolder.lock.unlock();

    const dir = BunDebugHolder.dir orelse dir: {
        const base_name = switch (Environment.os) {
            else => "/tmp/bun-debug-src/",
            .windows => brk: {
                const temp = bun.fs.FileSystem.RealFS.platformTempDir();
                var win_temp_buffer: bun.PathBuffer = undefined;
                @memcpy(win_temp_buffer[0..temp.len], temp);
                const suffix = "\\bun-debug-src";
                @memcpy(win_temp_buffer[temp.len .. temp.len + suffix.len], suffix);
                win_temp_buffer[temp.len + suffix.len] = 0;
                break :brk win_temp_buffer[0 .. temp.len + suffix.len :0];
            },
        };
        const dir = try std.fs.cwd().makeOpenPath(base_name, .{});
        BunDebugHolder.dir = dir;
        break :dir dir;
    };

    if (std.fs.path.dirname(specifier)) |dir_path| {
        const root_len = switch (Environment.os) {
            else => "/".len,
            .windows => bun.path.windowsFilesystemRoot(dir_path).len,
        };
        var parent = try dir.makeOpenPath(dir_path[root_len..], .{});
        defer parent.close();
        parent.writeFile(.{
            .sub_path = std.fs.path.basename(specifier),
            .data = written,
        }) catch |e| {
            Output.debugWarn("Failed to dump source string: writeFile {}", .{e});
            return;
        };
        if (vm.source_mappings.get(specifier)) |mappings| {
            defer mappings.deref();
            const map_path = std.mem.concat(bun.default_allocator, u8, &.{ std.fs.path.basename(specifier), ".map" }) catch bun.outOfMemory();
            defer bun.default_allocator.free(map_path);
            const file = try parent.createFile(map_path, .{});
            defer file.close();

            const source_file = parent.readFileAlloc(
                bun.default_allocator,
                specifier,
                std.math.maxInt(u64),
            ) catch "";
            defer bun.default_allocator.free(source_file);

            var bufw = std.io.bufferedWriter(file.writer());
            const w = bufw.writer();
            try w.print(
                \\{{
                \\  "version": 3,
                \\  "file": {},
                \\  "sourceRoot": "",
                \\  "sources": [{}],
                \\  "sourcesContent": [{}],
                \\  "names": [],
                \\  "mappings": "{}"
                \\}}
            , .{
                bun.fmt.formatJSONStringUTF8(std.fs.path.basename(specifier), .{}),
                bun.fmt.formatJSONStringUTF8(specifier, .{}),
                bun.fmt.formatJSONStringUTF8(source_file, .{}),
                mappings.formatVLQs(),
            });
            try bufw.flush();
        }
    } else {
        dir.writeFile(.{
            .sub_path = std.fs.path.basename(specifier),
            .data = written,
        }) catch return;
    }
}

fn setBreakPointOnFirstLine() bool {
    const s = struct {
        var set_break_point: bool = true;
    };
    const ret = s.set_break_point;
    s.set_break_point = false;
    return ret;
}

pub const RuntimeTranspilerStore = struct {
    generation_number: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    store: TranspilerJob.Store,
    enabled: bool = true,
    queue: Queue = Queue{},

    pub const Queue = bun.UnboundedQueue(TranspilerJob, .next);

    pub fn init() RuntimeTranspilerStore {
        return RuntimeTranspilerStore{
            .store = TranspilerJob.Store.init(bun.typedAllocator(TranspilerJob)),
        };
    }

    // This is run at the top of the event loop on the JS thread.
    pub fn drain(this: *RuntimeTranspilerStore) bun.JSExecutionTerminated!void {
        var batch = this.queue.popBatch();
        var iter = batch.iterator();
        if (iter.next()) |job| {
            // we run just one job first to see if there are more
            try job.runFromJSThread();
        } else {
            return;
        }
        var vm: *VirtualMachine = @fieldParentPtr("transpiler_store", this);
        const event_loop = vm.eventLoop();
        const global = vm.global;
        const jsc_vm = vm.jsc;
        while (iter.next()) |job| {
            // if there are more, we need to drain the microtasks from the previous run
            try event_loop.drainMicrotasksWithGlobal(global, jsc_vm);
            try job.runFromJSThread();
        }

        // immediately after this is called, the microtasks will be drained again.
    }

    pub fn transpile(
        this: *RuntimeTranspilerStore,
        vm: *VirtualMachine,
        globalObject: *JSGlobalObject,
        input_specifier: bun.String,
        path: Fs.Path,
        referrer: bun.String,
        loader: bun.options.Loader,
        package_json: ?*const PackageJSON,
    ) *anyopaque {
        var job: *TranspilerJob = this.store.get();
        const owned_path = Fs.Path.init(bun.default_allocator.dupe(u8, path.text) catch unreachable);
        const promise = JSC.JSInternalPromise.create(globalObject);

        // NOTE: DirInfo should already be cached since module loading happens
        // after module resolution, so this should be cheap
        var resolved_source = ResolvedSource{};
        if (package_json) |pkg| {
            switch (pkg.module_type) {
                .cjs => {
                    resolved_source.tag = .package_json_type_commonjs;
                    resolved_source.is_commonjs_module = true;
                },
                .esm => resolved_source.tag = .package_json_type_module,
                .unknown => {},
            }
        }

        job.* = TranspilerJob{
            .non_threadsafe_input_specifier = input_specifier,
            .path = owned_path,
            .globalThis = globalObject,
            .non_threadsafe_referrer = referrer,
            .vm = vm,
            .log = logger.Log.init(bun.default_allocator),
            .loader = loader,
            .promise = .create(JSValue.fromCell(promise), globalObject),
            .poll_ref = .{},
            .fetcher = TranspilerJob.Fetcher{
                .file = {},
            },
            .resolved_source = resolved_source,
        };
        if (comptime Environment.allow_assert)
            debug("transpile({s}, {s}, async)", .{ path.text, @tagName(job.loader) });
        job.schedule();
        return promise;
    }

    pub const TranspilerJob = struct {
        path: Fs.Path,
        non_threadsafe_input_specifier: String,
        non_threadsafe_referrer: String,
        loader: options.Loader,
        promise: JSC.Strong.Optional = .empty,
        vm: *VirtualMachine,
        globalThis: *JSGlobalObject,
        fetcher: Fetcher,
        poll_ref: Async.KeepAlive = .{},
        generation_number: u32 = 0,
        log: logger.Log,
        parse_error: ?anyerror = null,
        resolved_source: ResolvedSource = ResolvedSource{},
        work_task: JSC.WorkPoolTask = .{ .callback = runFromWorkerThread },
        next: ?*TranspilerJob = null,

        pub const Store = bun.HiveArray(TranspilerJob, if (bun.heap_breakdown.enabled) 0 else 64).Fallback;

        pub const Fetcher = union(enum) {
            virtual_module: bun.String,
            file: void,

            pub fn deinit(this: *@This()) void {
                if (this.* == .virtual_module) {
                    this.virtual_module.deref();
                }
            }
        };

        pub fn deinit(this: *TranspilerJob) void {
            bun.default_allocator.free(this.path.text);

            this.poll_ref.disable();
            this.fetcher.deinit();
            this.loader = options.Loader.file;
            this.non_threadsafe_input_specifier.deref();
            this.non_threadsafe_referrer.deref();
            this.path = Fs.Path.empty;
            this.log.deinit();
            this.promise.deinit();
            this.globalThis = undefined;
        }

        threadlocal var ast_memory_store: ?*js_ast.ASTMemoryAllocator = null;
        threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

        pub fn dispatchToMainThread(this: *TranspilerJob) void {
            this.vm.transpiler_store.queue.push(this);
            this.vm.eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&this.vm.transpiler_store));
        }

        pub fn runFromJSThread(this: *TranspilerJob) bun.JSExecutionTerminated!void {
            var vm = this.vm;
            const promise = this.promise.swap();
            const globalThis = this.globalThis;
            this.poll_ref.unref(vm);

            const referrer = this.non_threadsafe_referrer;
            this.non_threadsafe_referrer = String.empty;
            var log = this.log;
            this.log = logger.Log.init(bun.default_allocator);
            var resolved_source = this.resolved_source;
            const specifier = brk: {
                if (this.parse_error != null) {
                    break :brk bun.String.createUTF8(this.path.text);
                }

                const out = this.non_threadsafe_input_specifier;
                this.non_threadsafe_input_specifier = String.empty;

                bun.debugAssert(resolved_source.source_url.isEmpty());
                bun.debugAssert(resolved_source.specifier.isEmpty());
                resolved_source.source_url = out.createIfDifferent(this.path.text);
                resolved_source.specifier = out.dupeRef();
                break :brk out;
            };

            const parse_error = this.parse_error;

            this.promise.deinit();
            this.deinit();

            _ = vm.transpiler_store.store.put(this);

            try ModuleLoader.AsyncModule.fulfill(globalThis, promise, &resolved_source, parse_error, specifier, referrer, &log);
        }

        pub fn schedule(this: *TranspilerJob) void {
            this.poll_ref.ref(this.vm);
            JSC.WorkPool.schedule(&this.work_task);
        }

        pub fn runFromWorkerThread(work_task: *JSC.WorkPoolTask) void {
            @as(*TranspilerJob, @fieldParentPtr("work_task", work_task)).run();
        }

        pub fn run(this: *TranspilerJob) void {
            var arena = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            const allocator = arena.allocator();

            defer this.dispatchToMainThread();
            if (this.generation_number != this.vm.transpiler_store.generation_number.load(.monotonic)) {
                this.parse_error = error.TranspilerJobGenerationMismatch;
                return;
            }

            if (ast_memory_store == null) {
                ast_memory_store = bun.default_allocator.create(js_ast.ASTMemoryAllocator) catch bun.outOfMemory();
                ast_memory_store.?.* = js_ast.ASTMemoryAllocator{
                    .allocator = allocator,
                    .previous = null,
                };
            }

            var ast_scope = ast_memory_store.?.enter(allocator);
            defer ast_scope.exit();

            const path = this.path;
            const specifier = this.path.text;
            const loader = this.loader;

            var cache = JSC.RuntimeTranspilerCache{
                .output_code_allocator = allocator,
                .sourcemap_allocator = bun.default_allocator,
            };
            var log = logger.Log.init(allocator);
            defer {
                this.log = logger.Log.init(bun.default_allocator);
                log.cloneToWithRecycled(&this.log, true) catch bun.outOfMemory();
            }
            var vm = this.vm;
            var transpiler: bun.Transpiler = undefined;
            transpiler = vm.transpiler;
            transpiler.setAllocator(allocator);
            transpiler.setLog(&log);
            transpiler.resolver.opts = transpiler.options;
            transpiler.macro_context = null;
            transpiler.linker.resolver = &transpiler.resolver;

            var fd: ?StoredFileDescriptorType = null;
            var package_json: ?*PackageJSON = null;
            const hash = bun.Watcher.getHash(path.text);

            switch (vm.bun_watcher) {
                .hot, .watch => {
                    if (vm.bun_watcher.indexOf(hash)) |index| {
                        const watcher_fd = vm.bun_watcher.watchlist().items(.fd)[index];
                        fd = if (watcher_fd.stdioTag() == null) watcher_fd else null;
                        package_json = vm.bun_watcher.watchlist().items(.package_json)[index];
                    }
                },
                else => {},
            }

            // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
            const is_node_override = strings.hasPrefixComptime(specifier, node_fallbacks.import_path);

            const macro_remappings = if (vm.macro_mode or !vm.has_any_macro_remappings or is_node_override)
                MacroRemap{}
            else
                transpiler.options.macro_remap;

            var fallback_source: logger.Source = undefined;

            // Usually, we want to close the input file automatically.
            //
            // If we're re-using the file descriptor from the fs watcher
            // Do not close it because that will break the kqueue-based watcher
            //
            var should_close_input_file_fd = fd == null;

            var input_file_fd: StoredFileDescriptorType = .invalid;

            const is_main = vm.main.len == path.text.len and
                vm.main_hash == hash and
                strings.eqlLong(vm.main, path.text, false);

            const module_type: ModuleType = switch (this.resolved_source.tag) {
                .package_json_type_commonjs => .cjs,
                .package_json_type_module => .esm,
                else => .unknown,
            };

            var parse_options = Transpiler.ParseOptions{
                .allocator = allocator,
                .path = path,
                .loader = loader,
                .dirname_fd = .invalid,
                .file_descriptor = fd,
                .file_fd_ptr = &input_file_fd,
                .file_hash = hash,
                .macro_remappings = macro_remappings,
                .jsx = transpiler.options.jsx,
                .emit_decorator_metadata = transpiler.options.emit_decorator_metadata,
                .virtual_source = null,
                .dont_bundle_twice = true,
                .allow_commonjs = true,
                .inject_jest_globals = transpiler.options.rewrite_jest_for_tests,
                .set_breakpoint_on_first_line = vm.debugger != null and
                    vm.debugger.?.set_breakpoint_on_first_line and
                    is_main and
                    setBreakPointOnFirstLine(),
                .runtime_transpiler_cache = if (!JSC.RuntimeTranspilerCache.is_disabled) &cache else null,
                .remove_cjs_module_wrapper = is_main and vm.module_loader.eval_source != null,
                .module_type = module_type,
                .allow_bytecode_cache = true,
            };

            defer {
                if (should_close_input_file_fd and input_file_fd.isValid()) {
                    input_file_fd.close();
                    input_file_fd = .invalid;
                }
            }

            if (is_node_override) {
                if (node_fallbacks.contentsFromPath(specifier)) |code| {
                    const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                    fallback_source = logger.Source{ .path = fallback_path, .contents = code };
                    parse_options.virtual_source = &fallback_source;
                }
            }

            var parse_result: bun.transpiler.ParseResult = transpiler.parseMaybeReturnFileOnlyAllowSharedBuffer(
                parse_options,
                null,
                false,
                false,
            ) orelse {
                if (vm.isWatcherEnabled()) {
                    if (input_file_fd.isValid()) {
                        if (!is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                            should_close_input_file_fd = false;
                            _ = vm.bun_watcher.addFile(
                                input_file_fd,
                                path.text,
                                hash,
                                loader,
                                .invalid,
                                package_json,
                                true,
                            );
                        }
                    }
                }

                this.parse_error = error.ParseError;

                return;
            };

            if (vm.isWatcherEnabled()) {
                if (input_file_fd.isValid()) {
                    if (!is_node_override and
                        std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules"))
                    {
                        should_close_input_file_fd = false;
                        _ = vm.bun_watcher.addFile(
                            input_file_fd,
                            path.text,
                            hash,
                            loader,
                            .invalid,
                            package_json,
                            true,
                        );
                    }
                }
            }

            if (cache.entry) |*entry| {
                vm.source_mappings.putMappings(&parse_result.source, .{
                    .list = .{ .items = @constCast(entry.sourcemap), .capacity = entry.sourcemap.len },
                    .allocator = bun.default_allocator,
                }) catch {};

                if (comptime Environment.dump_source) {
                    dumpSourceString(vm, specifier, entry.output_code.byteSlice());
                }

                this.resolved_source = ResolvedSource{
                    .allocator = null,
                    .source_code = switch (entry.output_code) {
                        .string => entry.output_code.string,
                        .utf8 => brk: {
                            const result = bun.String.createUTF8(entry.output_code.utf8);
                            cache.output_code_allocator.free(entry.output_code.utf8);
                            entry.output_code.utf8 = "";
                            break :brk result;
                        },
                    },
                    .is_commonjs_module = entry.metadata.module_type == .cjs,
                    .tag = this.resolved_source.tag,
                };

                return;
            }

            if (parse_result.already_bundled != .none) {
                const bytecode_slice = parse_result.already_bundled.bytecodeSlice();
                this.resolved_source = ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.createLatin1(parse_result.source.contents),
                    .already_bundled = true,
                    .bytecode_cache = if (bytecode_slice.len > 0) bytecode_slice.ptr else null,
                    .bytecode_cache_size = bytecode_slice.len,
                    .is_commonjs_module = parse_result.already_bundled.isCommonJS(),
                    .tag = this.resolved_source.tag,
                };
                this.resolved_source.source_code.ensureHash();
                return;
            }

            for (parse_result.ast.import_records.slice()) |*import_record_| {
                var import_record: *bun.ImportRecord = import_record_;

                if (JSC.ModuleLoader.HardcodedModule.Alias.get(import_record.path.text, transpiler.options.target)) |replacement| {
                    import_record.path.text = replacement.path;
                    import_record.tag = replacement.tag;
                    import_record.is_external_without_side_effects = true;
                    continue;
                }

                if (transpiler.options.rewrite_jest_for_tests) {
                    if (strings.eqlComptime(
                        import_record.path.text,
                        "@jest/globals",
                    ) or strings.eqlComptime(
                        import_record.path.text,
                        "vitest",
                    )) {
                        import_record.path.namespace = "bun";
                        import_record.tag = .bun_test;
                        import_record.path.text = "test";
                        import_record.is_external_without_side_effects = true;
                        continue;
                    }
                }

                if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                    import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                    import_record.path.namespace = "bun";
                    import_record.is_external_without_side_effects = true;

                    if (strings.eqlComptime(import_record.path.text, "test")) {
                        import_record.tag = .bun_test;
                    }
                }
            }

            if (source_code_printer == null) {
                const writer = js_printer.BufferWriter.init(bun.default_allocator);
                source_code_printer = bun.default_allocator.create(js_printer.BufferPrinter) catch unreachable;
                source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
                source_code_printer.?.ctx.append_null_byte = false;
            }

            var printer = source_code_printer.?.*;
            printer.ctx.reset();

            {
                var mapper = vm.sourceMapHandler(&printer);
                defer source_code_printer.?.* = printer;
                _ = transpiler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    mapper.get(),
                ) catch |err| {
                    this.parse_error = err;
                    return;
                };
            }

            if (comptime Environment.dump_source) {
                dumpSource(this.vm, specifier, &printer);
            }

            const source_code = brk: {
                const written = printer.ctx.getWritten();

                const result = cache.output_code orelse bun.String.createLatin1(written);

                if (written.len > 1024 * 1024 * 2 or vm.smol) {
                    printer.ctx.buffer.deinit();
                    source_code_printer.?.* = printer;
                }

                // In a benchmarking loading @babel/standalone 100 times:
                //
                // After ensureHash:
                // 354.00 ms    4.2%    354.00 ms           WTF::StringImpl::hashSlowCase() const
                //
                // Before ensureHash:
                // 506.00 ms    6.1%    506.00 ms           WTF::StringImpl::hashSlowCase() const
                //
                result.ensureHash();

                break :brk result;
            };
            this.resolved_source = ResolvedSource{
                .allocator = null,
                .source_code = source_code,
                .is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs,
                .tag = this.resolved_source.tag,
            };
        }
    };
};

pub const FetchFlags = enum {
    transpile,
    print_source,
    print_source_and_clone,

    pub fn disableTranspiling(this: FetchFlags) bool {
        return this != .transpile;
    }
};

pub const HardcodedModule = enum {
    bun,
    @"abort-controller",
    @"bun:ffi",
    @"bun:jsc",
    @"bun:main",
    @"bun:test", // usually replaced by the transpiler but `await import("bun:" + "test")` has to work
    @"bun:wrap",
    @"bun:sqlite",
    @"node:assert",
    @"node:assert/strict",
    @"node:async_hooks",
    @"node:buffer",
    @"node:child_process",
    @"node:console",
    @"node:constants",
    @"node:crypto",
    @"node:dns",
    @"node:dns/promises",
    @"node:domain",
    @"node:events",
    @"node:fs",
    @"node:fs/promises",
    @"node:http",
    @"node:https",
    @"node:module",
    @"node:net",
    @"node:os",
    @"node:path",
    @"node:path/posix",
    @"node:path/win32",
    @"node:perf_hooks",
    @"node:process",
    @"node:querystring",
    @"node:readline",
    @"node:readline/promises",
    @"node:stream",
    @"node:stream/consumers",
    @"node:stream/promises",
    @"node:stream/web",
    @"node:string_decoder",
    @"node:test",
    @"node:timers",
    @"node:timers/promises",
    @"node:tls",
    @"node:tty",
    @"node:url",
    @"node:util",
    @"node:util/types",
    @"node:vm",
    @"node:wasi",
    @"node:zlib",
    @"node:worker_threads",
    @"node:punycode",
    undici,
    ws,
    @"isomorphic-fetch",
    @"node-fetch",
    vercel_fetch,
    @"utf-8-validate",
    @"node:v8",
    @"node:trace_events",
    @"node:repl",
    @"node:inspector",
    @"node:http2",
    @"node:diagnostics_channel",
    @"node:dgram",
    @"node:cluster",
    @"node:_stream_duplex",
    @"node:_stream_passthrough",
    @"node:_stream_readable",
    @"node:_stream_transform",
    @"node:_stream_wrap",
    @"node:_stream_writable",
    @"node:_tls_common",
    @"node:_http_agent",
    @"node:_http_client",
    @"node:_http_common",
    @"node:_http_incoming",
    @"node:_http_outgoing",
    @"node:_http_server",
    /// This is gated behind '--expose-internals'
    @"bun:internal-for-testing",

    /// The module loader first uses `Aliases` to get a single string during
    /// resolution, then maps that single string to the actual module.
    /// Do not include aliases here; Those go in `Aliases`.
    pub const map = bun.ComptimeStringMap(HardcodedModule, [_]struct { []const u8, HardcodedModule }{
        // Bun
        .{ "bun", .bun },
        .{ "bun:ffi", .@"bun:ffi" },
        .{ "bun:jsc", .@"bun:jsc" },
        .{ "bun:main", .@"bun:main" },
        .{ "bun:test", .@"bun:test" },
        .{ "bun:sqlite", .@"bun:sqlite" },
        .{ "bun:wrap", .@"bun:wrap" },
        .{ "bun:internal-for-testing", .@"bun:internal-for-testing" },
        // Node.js
        .{ "node:assert", .@"node:assert" },
        .{ "node:assert/strict", .@"node:assert/strict" },
        .{ "node:async_hooks", .@"node:async_hooks" },
        .{ "node:buffer", .@"node:buffer" },
        .{ "node:child_process", .@"node:child_process" },
        .{ "node:cluster", .@"node:cluster" },
        .{ "node:console", .@"node:console" },
        .{ "node:constants", .@"node:constants" },
        .{ "node:crypto", .@"node:crypto" },
        .{ "node:dgram", .@"node:dgram" },
        .{ "node:diagnostics_channel", .@"node:diagnostics_channel" },
        .{ "node:dns", .@"node:dns" },
        .{ "node:dns/promises", .@"node:dns/promises" },
        .{ "node:domain", .@"node:domain" },
        .{ "node:events", .@"node:events" },
        .{ "node:fs", .@"node:fs" },
        .{ "node:fs/promises", .@"node:fs/promises" },
        .{ "node:http", .@"node:http" },
        .{ "node:http2", .@"node:http2" },
        .{ "node:https", .@"node:https" },
        .{ "node:inspector", .@"node:inspector" },
        .{ "node:module", .@"node:module" },
        .{ "node:net", .@"node:net" },
        .{ "node:readline", .@"node:readline" },
        .{ "node:test", .@"node:test" },
        .{ "node:os", .@"node:os" },
        .{ "node:path", .@"node:path" },
        .{ "node:path/posix", .@"node:path/posix" },
        .{ "node:path/win32", .@"node:path/win32" },
        .{ "node:perf_hooks", .@"node:perf_hooks" },
        .{ "node:process", .@"node:process" },
        .{ "node:punycode", .@"node:punycode" },
        .{ "node:querystring", .@"node:querystring" },
        .{ "node:readline", .@"node:readline" },
        .{ "node:readline/promises", .@"node:readline/promises" },
        .{ "node:repl", .@"node:repl" },
        .{ "node:stream", .@"node:stream" },
        .{ "node:stream/consumers", .@"node:stream/consumers" },
        .{ "node:stream/promises", .@"node:stream/promises" },
        .{ "node:stream/web", .@"node:stream/web" },
        .{ "node:string_decoder", .@"node:string_decoder" },
        .{ "node:timers", .@"node:timers" },
        .{ "node:timers/promises", .@"node:timers/promises" },
        .{ "node:tls", .@"node:tls" },
        .{ "node:trace_events", .@"node:trace_events" },
        .{ "node:tty", .@"node:tty" },
        .{ "node:url", .@"node:url" },
        .{ "node:util", .@"node:util" },
        .{ "node:util/types", .@"node:util/types" },
        .{ "node:v8", .@"node:v8" },
        .{ "node:vm", .@"node:vm" },
        .{ "node:wasi", .@"node:wasi" },
        .{ "node:worker_threads", .@"node:worker_threads" },
        .{ "node:zlib", .@"node:zlib" },
        .{ "node:_stream_duplex", .@"node:_stream_duplex" },
        .{ "node:_stream_passthrough", .@"node:_stream_passthrough" },
        .{ "node:_stream_readable", .@"node:_stream_readable" },
        .{ "node:_stream_transform", .@"node:_stream_transform" },
        .{ "node:_stream_wrap", .@"node:_stream_wrap" },
        .{ "node:_stream_writable", .@"node:_stream_writable" },
        .{ "node:_tls_common", .@"node:_tls_common" },
        .{ "node:_http_agent", .@"node:_http_agent" },
        .{ "node:_http_client", .@"node:_http_client" },
        .{ "node:_http_common", .@"node:_http_common" },
        .{ "node:_http_incoming", .@"node:_http_incoming" },
        .{ "node:_http_outgoing", .@"node:_http_outgoing" },
        .{ "node:_http_server", .@"node:_http_server" },

        .{ "node-fetch", HardcodedModule.@"node-fetch" },
        .{ "isomorphic-fetch", HardcodedModule.@"isomorphic-fetch" },
        .{ "undici", HardcodedModule.undici },
        .{ "ws", HardcodedModule.ws },
        .{ "@vercel/fetch", HardcodedModule.vercel_fetch },
        .{ "utf-8-validate", HardcodedModule.@"utf-8-validate" },
        .{ "abort-controller", HardcodedModule.@"abort-controller" },
    });

    /// Contains the list of built-in modules from the perspective of the module
    /// loader. This logic is duplicated for `isBuiltinModule` and the like.
    pub const Alias = struct {
        path: [:0]const u8,
        tag: ImportRecord.Tag = .builtin,
        node_builtin: bool = false,
        node_only_prefix: bool = false,

        fn nodeEntry(path: [:0]const u8) struct { string, Alias } {
            return .{
                path,
                .{
                    .path = if (path.len > 5 and std.mem.eql(u8, path[0..5], "node:")) path else "node:" ++ path,
                    .node_builtin = true,
                },
            };
        }
        fn nodeEntryOnlyPrefix(path: [:0]const u8) struct { string, Alias } {
            return .{
                path,
                .{
                    .path = if (path.len > 5 and std.mem.eql(u8, path[0..5], "node:")) path else "node:" ++ path,
                    .node_builtin = true,
                    .node_only_prefix = true,
                },
            };
        }
        fn entry(path: [:0]const u8) struct { string, Alias } {
            return .{ path, .{ .path = path } };
        }

        // Applied to both --target=bun and --target=node
        const common_alias_kvs = [_]struct { string, Alias }{
            nodeEntry("node:assert"),
            nodeEntry("node:assert/strict"),
            nodeEntry("node:async_hooks"),
            nodeEntry("node:buffer"),
            nodeEntry("node:child_process"),
            nodeEntry("node:cluster"),
            nodeEntry("node:console"),
            nodeEntry("node:constants"),
            nodeEntry("node:crypto"),
            nodeEntry("node:dgram"),
            nodeEntry("node:diagnostics_channel"),
            nodeEntry("node:dns"),
            nodeEntry("node:dns/promises"),
            nodeEntry("node:domain"),
            nodeEntry("node:events"),
            nodeEntry("node:fs"),
            nodeEntry("node:fs/promises"),
            nodeEntry("node:http"),
            nodeEntry("node:http2"),
            nodeEntry("node:https"),
            nodeEntry("node:inspector"),
            nodeEntry("node:module"),
            nodeEntry("node:net"),
            nodeEntry("node:os"),
            nodeEntry("node:path"),
            nodeEntry("node:path/posix"),
            nodeEntry("node:path/win32"),
            nodeEntry("node:perf_hooks"),
            nodeEntry("node:process"),
            nodeEntry("node:punycode"),
            nodeEntry("node:querystring"),
            nodeEntry("node:readline"),
            nodeEntry("node:readline/promises"),
            nodeEntry("node:repl"),
            nodeEntry("node:stream"),
            nodeEntry("node:stream/consumers"),
            nodeEntry("node:stream/promises"),
            nodeEntry("node:stream/web"),
            nodeEntry("node:string_decoder"),
            nodeEntry("node:timers"),
            nodeEntry("node:timers/promises"),
            nodeEntry("node:tls"),
            nodeEntry("node:trace_events"),
            nodeEntry("node:tty"),
            nodeEntry("node:url"),
            nodeEntry("node:util"),
            nodeEntry("node:util/types"),
            nodeEntry("node:v8"),
            nodeEntry("node:vm"),
            nodeEntry("node:wasi"),
            nodeEntry("node:worker_threads"),
            nodeEntry("node:zlib"),
            // New Node.js builtins only resolve from the prefixed one.
            nodeEntryOnlyPrefix("node:test"),

            nodeEntry("assert"),
            nodeEntry("assert/strict"),
            nodeEntry("async_hooks"),
            nodeEntry("buffer"),
            nodeEntry("child_process"),
            nodeEntry("cluster"),
            nodeEntry("console"),
            nodeEntry("constants"),
            nodeEntry("crypto"),
            nodeEntry("dgram"),
            nodeEntry("diagnostics_channel"),
            nodeEntry("dns"),
            nodeEntry("dns/promises"),
            nodeEntry("domain"),
            nodeEntry("events"),
            nodeEntry("fs"),
            nodeEntry("fs/promises"),
            nodeEntry("http"),
            nodeEntry("http2"),
            nodeEntry("https"),
            nodeEntry("inspector"),
            nodeEntry("module"),
            nodeEntry("net"),
            nodeEntry("os"),
            nodeEntry("path"),
            nodeEntry("path/posix"),
            nodeEntry("path/win32"),
            nodeEntry("perf_hooks"),
            nodeEntry("process"),
            nodeEntry("punycode"),
            nodeEntry("querystring"),
            nodeEntry("readline"),
            nodeEntry("readline/promises"),
            nodeEntry("repl"),
            nodeEntry("stream"),
            nodeEntry("stream/consumers"),
            nodeEntry("stream/promises"),
            nodeEntry("stream/web"),
            nodeEntry("string_decoder"),
            nodeEntry("timers"),
            nodeEntry("timers/promises"),
            nodeEntry("tls"),
            nodeEntry("trace_events"),
            nodeEntry("tty"),
            nodeEntry("url"),
            nodeEntry("util"),
            nodeEntry("util/types"),
            nodeEntry("v8"),
            nodeEntry("vm"),
            nodeEntry("wasi"),
            nodeEntry("worker_threads"),
            nodeEntry("zlib"),

            nodeEntry("node:_http_agent"),
            nodeEntry("node:_http_client"),
            nodeEntry("node:_http_common"),
            nodeEntry("node:_http_incoming"),
            nodeEntry("node:_http_outgoing"),
            nodeEntry("node:_http_server"),

            nodeEntry("_http_agent"),
            nodeEntry("_http_client"),
            nodeEntry("_http_common"),
            nodeEntry("_http_incoming"),
            nodeEntry("_http_outgoing"),
            nodeEntry("_http_server"),

            // sys is a deprecated alias for util
            .{ "sys", .{ .path = "node:util", .node_builtin = true } },
            .{ "node:sys", .{ .path = "node:util", .node_builtin = true } },

            // These are returned in builtinModules, but probably not many
            // packages use them so we will just alias them.
            .{ "node:_stream_duplex", .{ .path = "node:_stream_duplex", .node_builtin = true } },
            .{ "node:_stream_passthrough", .{ .path = "node:_stream_passthrough", .node_builtin = true } },
            .{ "node:_stream_readable", .{ .path = "node:_stream_readable", .node_builtin = true } },
            .{ "node:_stream_transform", .{ .path = "node:_stream_transform", .node_builtin = true } },
            .{ "node:_stream_wrap", .{ .path = "node:_stream_wrap", .node_builtin = true } },
            .{ "node:_stream_writable", .{ .path = "node:_stream_writable", .node_builtin = true } },
            .{ "node:_tls_wrap", .{ .path = "node:tls", .node_builtin = true } },
            .{ "node:_tls_common", .{ .path = "node:_tls_common", .node_builtin = true } },
            .{ "_stream_duplex", .{ .path = "node:_stream_duplex", .node_builtin = true } },
            .{ "_stream_passthrough", .{ .path = "node:_stream_passthrough", .node_builtin = true } },
            .{ "_stream_readable", .{ .path = "node:_stream_readable", .node_builtin = true } },
            .{ "_stream_transform", .{ .path = "node:_stream_transform", .node_builtin = true } },
            .{ "_stream_wrap", .{ .path = "node:_stream_wrap", .node_builtin = true } },
            .{ "_stream_writable", .{ .path = "node:_stream_writable", .node_builtin = true } },
            .{ "_tls_wrap", .{ .path = "node:tls", .node_builtin = true } },
            .{ "_tls_common", .{ .path = "node:_tls_common", .node_builtin = true } },
        };

        const bun_extra_alias_kvs = [_]struct { string, Alias }{
            .{ "bun", .{ .path = "bun", .tag = .bun } },
            .{ "bun:test", .{ .path = "bun:test", .tag = .bun_test } },
            .{ "bun:ffi", .{ .path = "bun:ffi" } },
            .{ "bun:jsc", .{ .path = "bun:jsc" } },
            .{ "bun:sqlite", .{ .path = "bun:sqlite" } },
            .{ "bun:wrap", .{ .path = "bun:wrap" } },
            .{ "bun:internal-for-testing", .{ .path = "bun:internal-for-testing" } },
            .{ "ffi", .{ .path = "bun:ffi" } },

            // inspector/promises is not implemented, it is an alias of inspector
            .{ "node:inspector/promises", .{ .path = "node:inspector", .node_builtin = true } },
            .{ "inspector/promises", .{ .path = "node:inspector", .node_builtin = true } },

            // Thirdparty packages we override
            .{ "@vercel/fetch", .{ .path = "@vercel/fetch" } },
            .{ "isomorphic-fetch", .{ .path = "isomorphic-fetch" } },
            .{ "node-fetch", .{ .path = "node-fetch" } },
            .{ "undici", .{ .path = "undici" } },
            .{ "utf-8-validate", .{ .path = "utf-8-validate" } },
            .{ "ws", .{ .path = "ws" } },
            .{ "ws/lib/websocket", .{ .path = "ws" } },

            // Polyfills we force to native
            .{ "abort-controller", .{ .path = "abort-controller" } },
            .{ "abort-controller/polyfill", .{ .path = "abort-controller" } },

            // To force Next.js to not use bundled dependencies.
            .{ "next/dist/compiled/ws", .{ .path = "ws" } },
            .{ "next/dist/compiled/node-fetch", .{ .path = "node-fetch" } },
            .{ "next/dist/compiled/undici", .{ .path = "undici" } },
        };

        const node_extra_alias_kvs = [_]struct { string, Alias }{
            nodeEntry("node:inspector/promises"),
            nodeEntry("inspector/promises"),
        };

        const node_aliases = bun.ComptimeStringMap(Alias, common_alias_kvs ++ node_extra_alias_kvs);
        const bun_aliases = bun.ComptimeStringMap(Alias, common_alias_kvs ++ bun_extra_alias_kvs);

        pub fn has(name: []const u8, target: options.Target) bool {
            return get(name, target) != null;
        }

        pub fn get(name: []const u8, target: options.Target) ?Alias {
            if (target.isBun()) {
                return bun_aliases.get(name);
            } else if (target.isNode()) {
                return node_aliases.get(name);
            }
            return null;
        }
    };
};

/// Support embedded .node files
export fn Bun__resolveEmbeddedNodeFile(vm: *VirtualMachine, in_out_str: *bun.String) bool {
    if (vm.standalone_module_graph == null) return false;

    const input_path = in_out_str.toUTF8(bun.default_allocator);
    defer input_path.deinit();
    const result = ModuleLoader.resolveEmbeddedFile(vm, input_path.slice(), "node") orelse return false;
    in_out_str.* = bun.String.createUTF8(result);
    return true;
}

export fn ModuleLoader__isBuiltin(data: [*]const u8, len: usize) bool {
    const str = data[0..len];
    return HardcodedModule.Alias.bun_aliases.get(str) != null;
}

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Arena = @import("../allocators/mimalloc_arena.zig").Arena;

const Fs = @import("../fs.zig");
const ast = @import("../import_record.zig");
const MacroEntryPoint = bun.transpiler.EntryPoints.MacroEntryPoint;
const ParseResult = bun.transpiler.ParseResult;
const logger = bun.logger;
const Api = @import("../api/schema.zig").Api;
const options = @import("../options.zig");
const Transpiler = bun.Transpiler;
const PluginRunner = bun.transpiler.PluginRunner;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const Analytics = @import("../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../runtime.zig");
const ImportRecord = ast.ImportRecord;
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const node_module_module = @import("./bindings/NodeModuleModule.zig");

const JSGlobalObject = bun.JSC.JSGlobalObject;
const ResolvedSource = bun.JSC.ResolvedSource;
const Bun = JSC.API.Bun;
const PackageManager = @import("../install/install.zig").PackageManager;
const Install = @import("../install/install.zig");
const VirtualMachine = bun.JSC.VirtualMachine;
const Dependency = @import("../install/dependency.zig");
const Async = bun.Async;
const String = bun.String;
const ModuleType = options.ModuleType;

const debug = Output.scoped(.ModuleLoader, true);
const panic = std.debug.panic;
