const debug = Output.scoped(.AsyncModule, .hidden);

const string = []const u8;

pub const AsyncModule = struct {
    // This is all the state used by the printer to print the module
    parse_result: ParseResult,
    promise: jsc.Strong.Optional = .empty,
    path: Fs.Path,
    specifier: string = "",
    referrer: string = "",
    string_buf: []u8 = &[_]u8{},
    fd: ?StoredFileDescriptorType = null,
    package_json: ?*PackageJSON = null,
    loader: api.Loader,
    hash: u32 = std.math.maxInt(u32),
    globalThis: *JSGlobalObject = undefined,
    arena: *bun.ArenaAllocator,

    // This is the specific state for making it async
    poll_ref: Async.KeepAlive = .{},
    any_task: jsc.AnyTask = undefined,

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
            this.vm().enqueueTaskConcurrent(jsc.ConcurrentTask.createFrom(this));
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

        comptime {
            // Ensure VirtualMachine has a field named "modules" of the correct type
            // If this fails, the @fieldParentPtr in vm() above needs to be updated
            const VM = @import("./VirtualMachine.zig");
            if (!@hasField(VM, "modules")) {
                @compileError("VirtualMachine must have a 'modules' field for AsyncModule.Queue.vm() to work");
            }
        }
    };

    pub fn init(opts: anytype, globalObject: *JSGlobalObject) !AsyncModule {
        // var stmt_blocks = js_ast.Stmt.Data.toOwnedSlice();
        // var expr_blocks = js_ast.Expr.Data.toOwnedSlice();
        const this_promise = JSValue.createInternalPromise(globalObject);
        const promise = jsc.Strong.Optional.create(this_promise, globalObject);

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
        clone.any_task = jsc.AnyTask.New(AsyncModule, onDone).init(clone);
        jsc_vm.enqueueTask(jsc.Task.init(&clone.any_task));
    }

    pub fn onDone(this: *AsyncModule) void {
        jsc.markBinding(@src());
        var jsc_vm = this.globalThis.bunVM();
        jsc_vm.modules.scheduled -= 1;
        if (jsc_vm.modules.scheduled == 0) {
            jsc_vm.packageManager().endProgressBar();
        }
        var log = logger.Log.init(jsc_vm.allocator);
        defer log.deinit();
        var errorable: jsc.ErrorableResolvedSource = undefined;
        this.poll_ref.unref(jsc_vm);
        outer: {
            errorable = jsc.ErrorableResolvedSource.ok(this.resumeLoadingModule(&log) catch |err| {
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
        bun.jsc.fromJSHostCallGeneric(this.globalThis, @src(), Bun__onFulfillAsyncModule, .{
            this.globalThis,
            this.promise.get().?,
            &errorable,
            &spec,
            &ref,
        }) catch {};
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
    ) bun.JSError!void {
        jsc.markBinding(@src());
        var specifier = specifier_;
        var referrer = referrer_;
        var scope: jsc.TopExceptionScope = undefined;
        scope.init(globalThis, @src());
        defer {
            specifier.deref();
            referrer.deref();
            scope.deinit();
        }

        var errorable: jsc.ErrorableResolvedSource = undefined;
        if (err) |e| {
            defer {
                if (resolved_source.source_code_needs_deref) {
                    resolved_source.source_code_needs_deref = false;
                    resolved_source.source_code.deref();
                }
            }

            if (e == error.JSError) {
                errorable = jsc.ErrorableResolvedSource.err(error.JSError, globalThis.takeError(error.JSError));
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
            errorable = jsc.ErrorableResolvedSource.ok(resolved_source.*);
        }
        log.deinit();

        debug("fulfill: {f}", .{specifier});

        try bun.jsc.fromJSHostCallGeneric(globalThis, @src(), Bun__onFulfillAsyncModule, .{
            globalThis,
            promise,
            &errorable,
            &specifier,
            &referrer,
        });
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
        defer bun.default_allocator.free(msg);

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
                "HTTP 400 downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballHTTP401 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 401 downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballHTTP402 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 402 downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballHTTP403 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 403 downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballHTTP404 => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 404 downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballHTTP4xx => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 4xx downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballHTTP5xx => std.fmt.allocPrint(
                bun.default_allocator,
                "HTTP 5xx downloading package '{s}@{f}'",
                msg_args,
            ),
            error.TarballFailedToExtract => std.fmt.allocPrint(
                bun.default_allocator,
                "Failed to extract tarball for package '{s}@{f}'",
                msg_args,
            ),
            else => |err| std.fmt.allocPrint(
                bun.default_allocator,
                "{s} downloading package '{s}@{f}'",
                .{
                    bun.asByteSlice(@errorName(err)),
                    result.name,
                    result.resolution.fmt(vm.packageManager().lockfile.buffers.string_bytes.items, .any),
                },
            ),
        };
        defer bun.default_allocator.free(msg);

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
            .source_code = bun.String.cloneLatin1(printer.ctx.getWritten()),
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
        res: *jsc.ErrorableResolvedSource,
        specifier: *bun.String,
        referrer: *bun.String,
    ) void;
};

const Dependency = @import("../install/dependency.zig");
const Fs = @import("../fs.zig");
const options = @import("../options.zig");
const std = @import("std");
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const dumpSource = @import("./RuntimeTranspilerStore.zig").dumpSource;

const Install = @import("../install/install.zig");
const PackageManager = @import("../install/install.zig").PackageManager;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const String = bun.String;
const logger = bun.logger;
const strings = bun.strings;
const ParseResult = bun.transpiler.ParseResult;
const api = bun.schema.api;

const jsc = bun.jsc;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const ResolvedSource = bun.jsc.ResolvedSource;
const VirtualMachine = bun.jsc.VirtualMachine;
const ZigString = bun.jsc.ZigString;
