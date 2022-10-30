const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");

const FileSystem = @import("../fs.zig").FileSystem;
const PathName = @import("../fs.zig").PathName;
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
const PathString = bun.PathString;
const is_bindgen = std.meta.globalOption("bindgen", bool) orelse false;
const HTTPThread = @import("http").HTTPThread;

const JSC = @import("javascript_core");
const Jest = JSC.Jest;
const TestRunner = JSC.Jest.TestRunner;
const Test = TestRunner.Test;
const NetworkThread = @import("http").NetworkThread;
const uws = @import("uws");
pub const CommandLineReporter = struct {
    jest: TestRunner,
    callback: TestRunner.Callback,
    last_dot: u32 = 0,
    summary: Summary = Summary{},
    prev_file: u64 = 0,

    failures_to_repeat_buf: std.ArrayListUnmanaged(u8) = .{},

    pub const Summary = struct {
        pass: u32 = 0,
        expectations: u32 = 0,
        fail: u32 = 0,
    };

    const DotColorMap = std.EnumMap(TestRunner.Test.Status, string);
    const dots: DotColorMap = brk: {
        var map: DotColorMap = DotColorMap.init(.{});
        map.put(TestRunner.Test.Status.pending, Output.RESET ++ Output.ED ++ Output.color_map.get("yellow").? ++ "." ++ Output.RESET);
        map.put(TestRunner.Test.Status.pass, Output.RESET ++ Output.ED ++ Output.color_map.get("green").? ++ "." ++ Output.RESET);
        map.put(TestRunner.Test.Status.fail, Output.RESET ++ Output.ED ++ Output.color_map.get("red").? ++ "." ++ Output.RESET);
        break :brk map;
    };

    pub fn handleUpdateCount(cb: *TestRunner.Callback, _: u32, _: u32) void {
        _ = cb;
    }

    pub fn handleTestStart(_: *TestRunner.Callback, _: Test.ID) void {
        // var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);
    }

    fn printTestLine(label: string, parent: ?*Jest.DescribeScope, writer: anytype) void {
        var scopes_stack = std.BoundedArray(*Jest.DescribeScope, 64).init(0) catch unreachable;
        var parent_ = parent;

        while (parent_) |scope| {
            scopes_stack.append(scope) catch break;
            parent_ = scope.parent;
        }

        var scopes: []*Jest.DescribeScope = scopes_stack.slice();

        const display_label = if (label.len > 0) label else "test";

        if (Output.enable_ansi_colors_stderr) {
            for (scopes) |scope| {
                if (scope.label.len == 0) continue;
                writer.writeAll(" ") catch unreachable;

                writer.print(comptime Output.prettyFmt("<r>", true), .{}) catch unreachable;
                writer.writeAll(scope.label) catch unreachable;
                writer.print(comptime Output.prettyFmt("<d>", true), .{}) catch unreachable;
                writer.writeAll(" >") catch unreachable;
            }
        } else {
            for (scopes) |scope| {
                if (scope.label.len == 0) continue;
                writer.writeAll(" ") catch unreachable;
                writer.writeAll(scope.label) catch unreachable;
                writer.writeAll(" >") catch unreachable;
            }
        }

        if (Output.enable_ansi_colors_stderr)
            writer.print(comptime Output.prettyFmt("<r><b> {s}<r>", true), .{display_label}) catch unreachable
        else
            writer.print(comptime Output.prettyFmt("<r><b> {s}<r>", false), .{display_label}) catch unreachable;

        writer.writeAll("\n") catch unreachable;
    }

    pub fn handleTestPass(cb: *TestRunner.Callback, id: Test.ID, _: string, label: string, expectations: u32, parent: ?*Jest.DescribeScope) void {
        var writer_: std.fs.File.Writer = Output.errorWriter();
        var buffered_writer = std.io.bufferedWriter(writer_);
        var writer = buffered_writer.writer();
        defer buffered_writer.flush() catch unreachable;

        var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);

        if (Output.enable_ansi_colors_stderr)
            writer.print(comptime Output.prettyFmt("<green>✓<r>", true), .{}) catch unreachable
        else
            writer.print(comptime Output.prettyFmt("<green>✓<r>", false), .{}) catch unreachable;

        printTestLine(label, parent, writer);

        this.jest.tests.items(.status)[id] = TestRunner.Test.Status.pass;
        this.summary.pass += 1;
        this.summary.expectations += expectations;
    }

    pub fn handleTestFail(cb: *TestRunner.Callback, id: Test.ID, _: string, label: string, expectations: u32, parent: ?*Jest.DescribeScope) void {
        var writer_: std.fs.File.Writer = Output.errorWriter();
        var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);

        // when the tests fail, we want to repeat the failures at the end
        // so that you can see them better when there are lots of tests that ran
        const initial_length = this.failures_to_repeat_buf.items.len;
        var writer = this.failures_to_repeat_buf.writer(bun.default_allocator);

        if (Output.enable_ansi_colors_stderr)
            writer.print(comptime Output.prettyFmt("<r><red>✗<r>", true), .{}) catch unreachable
        else
            writer.print(comptime Output.prettyFmt("<r><red>✗<r>", false), .{}) catch unreachable;

        printTestLine(label, parent, writer);

        writer_.writeAll(this.failures_to_repeat_buf.items[initial_length..]) catch unreachable;
        Output.flush();

        // this.updateDots();
        this.summary.fail += 1;
        this.summary.expectations += expectations;
        this.jest.tests.items(.status)[id] = TestRunner.Test.Status.fail;
    }
};

const Scanner = struct {
    const Fifo = std.fifo.LinearFifo(ScanEntry, .Dynamic);
    exclusion_names: []const []const u8 = &.{},
    filter_names: []const []const u8 = &.{},
    dirs_to_scan: Fifo,
    results: std.ArrayList(bun.PathString),
    fs: *FileSystem,
    open_dir_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
    scan_dir_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
    options: *options.BundleOptions,
    has_iterated: bool = false,

    const ScanEntry = struct {
        relative_dir: bun.StoredFileDescriptorType,
        dir_path: string,
        name: strings.StringOrTinyString,
    };

    fn readDirWithName(this: *Scanner, name: string, handle: ?std.fs.Dir) !*FileSystem.RealFS.EntriesOption {
        return try this.fs.fs.readDirectoryWithIterator(name, handle, *Scanner, this);
    }

    pub fn scan(this: *Scanner, path_literal: string) void {
        var parts = &[_]string{ this.fs.top_level_dir, path_literal };
        const path = this.fs.absBuf(parts, &this.scan_dir_buf);

        var root = this.readDirWithName(path, null) catch |err| {
            if (err == error.NotDir) {
                if (this.isTestFile(path)) {
                    this.results.append(bun.PathString.init(this.fs.filename_store.append(@TypeOf(path), path) catch unreachable)) catch unreachable;
                }
            }

            return;
        };

        // you typed "." and we already scanned it
        if (!this.has_iterated) {
            if (@as(FileSystem.RealFS.EntriesOption.Tag, root.*) == .entries) {
                var iter = root.entries.data.iterator();
                const fd = root.entries.fd;
                while (iter.next()) |entry| {
                    this.next(entry.value_ptr.*, fd);
                }
            }
        }

        while (this.dirs_to_scan.readItem()) |entry| {
            var dir = std.fs.Dir{ .fd = entry.relative_dir };
            var parts2 = &[_]string{ entry.dir_path, entry.name.slice() };
            var path2 = this.fs.absBuf(parts2, &this.open_dir_buf);
            this.open_dir_buf[path2.len] = 0;
            var pathZ = this.open_dir_buf[path2.len - entry.name.slice().len .. path2.len :0];
            var child_dir = dir.openDirZ(pathZ, .{ .iterate = true }) catch continue;
            path2 = this.fs.dirname_store.append(string, path2) catch unreachable;
            FileSystem.setMaxFd(child_dir.fd);
            _ = this.readDirWithName(path2, child_dir) catch continue;
        }
    }

    const test_name_suffixes = [_]string{
        ".test",
        "_test",
        ".spec",
        "_spec",
    };

    pub fn couldBeTestFile(this: *Scanner, name: string) bool {
        const extname = std.fs.path.extension(name);
        if (!this.options.loader(extname).isJavaScriptLike()) return false;
        const name_without_extension = name[0 .. name.len - extname.len];
        inline for (test_name_suffixes) |suffix| {
            if (strings.endsWithComptime(name_without_extension, suffix)) return true;
        }

        return false;
    }

    pub fn doesAbsolutePathMatchFilter(this: *Scanner, name: string) bool {
        if (this.filter_names.len == 0) return true;

        for (this.filter_names) |filter_name| {
            if (strings.contains(name, filter_name)) return true;
        }

        return false;
    }

    pub fn isTestFile(this: *Scanner, name: string) bool {
        return this.couldBeTestFile(name) and this.doesAbsolutePathMatchFilter(name);
    }

    pub fn next(this: *Scanner, entry: *FileSystem.Entry, fd: bun.StoredFileDescriptorType) void {
        const name = entry.base_lowercase();
        this.has_iterated = true;
        switch (entry.kind(&this.fs.fs)) {
            .dir => {
                if ((name.len > 0 and name[0] == '.') or strings.eqlComptime(name, "node_modules")) {
                    return;
                }

                for (this.exclusion_names) |exclude_name| {
                    if (strings.eql(exclude_name, name)) return;
                }

                this.dirs_to_scan.writeItem(.{
                    .relative_dir = fd,
                    .name = entry.base_,
                    .dir_path = entry.dir,
                }) catch unreachable;
            },
            .file => {
                // already seen it!
                if (!entry.abs_path.isEmpty()) return;

                if (!this.couldBeTestFile(name)) return;

                var parts = &[_]string{ entry.dir, entry.base() };
                const path = this.fs.absBuf(parts, &this.open_dir_buf);

                if (!this.doesAbsolutePathMatchFilter(path)) return;

                entry.abs_path = bun.PathString.init(this.fs.filename_store.append(@TypeOf(path), path) catch unreachable);
                this.results.append(entry.abs_path) catch unreachable;
            },
        }
    }
};

pub const TestCommand = struct {
    pub const name = "wiptest";
    pub fn exec(ctx: Command.Context) !void {
        if (comptime is_bindgen) unreachable;
        var env_loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            var loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };
        JSC.C.JSCInitialize();
        NetworkThread.init() catch {};
        HTTPThread.init() catch {};
        var reporter = try ctx.allocator.create(CommandLineReporter);
        reporter.* = CommandLineReporter{
            .jest = TestRunner{
                .allocator = ctx.allocator,
                .log = ctx.log,
                .callback = undefined,
            },
            .callback = undefined,
        };
        reporter.callback = TestRunner.Callback{
            .onUpdateCount = CommandLineReporter.handleUpdateCount,
            .onTestStart = CommandLineReporter.handleTestStart,
            .onTestPass = CommandLineReporter.handleTestPass,
            .onTestFail = CommandLineReporter.handleTestFail,
        };
        reporter.jest.callback = &reporter.callback;
        Jest.Jest.runner = &reporter.jest;

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var vm = try JSC.VirtualMachine.init(ctx.allocator, ctx.args, null, ctx.log, env_loader);
        vm.argv = ctx.passthrough;

        try vm.bundler.configureDefines();
        vm.bundler.options.rewrite_jest_for_tests = true;

        if (vm.bundler.env.map.get("BUN_OVERRIDE_MODULE_PATH")) |override_path| {
            if (override_path.len > 0) {
                vm.load_builtins_from_path = override_path;
            }
        }

        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        var scanner = Scanner{
            .dirs_to_scan = Scanner.Fifo.init(ctx.allocator),
            .options = &vm.bundler.options,
            .fs = vm.bundler.fs,
            .filter_names = ctx.positionals[1..],
            .results = std.ArrayList(PathString).init(ctx.allocator),
        };

        scanner.scan(scanner.fs.top_level_dir);
        scanner.dirs_to_scan.deinit();

        const test_files = scanner.results.toOwnedSlice();
        if (test_files.len > 0) {
            // vm.bundler.fs.fs.readDirectory(_dir: string, _handle: ?std.fs.Dir)
            runAllTests(reporter, vm, test_files, ctx.allocator);
        }

        if (reporter.summary.pass > 20 and reporter.summary.fail > 0) {
            Output.prettyError("\n<r><d>{d} tests failed<r>:\n", .{reporter.summary.fail});

            Output.flush();

            var error_writer = Output.errorWriter();
            error_writer.writeAll(reporter.failures_to_repeat_buf.items) catch unreachable;
        }

        Output.flush();

        Output.prettyError("\n", .{});

        if (reporter.summary.pass > 0) {
            Output.prettyError("<r><green>", .{});
        }

        Output.prettyError(" {d:5>} pass<r>\n", .{reporter.summary.pass});

        if (reporter.summary.fail > 0) {
            Output.prettyError("<r><red>", .{});
        } else {
            Output.prettyError("<r><d>", .{});
        }

        Output.prettyError(" {d:5>} fail<r>\n", .{reporter.summary.fail});

        if (reporter.summary.expectations > 0) Output.prettyError(" {d:5>} expect() calls\n", .{reporter.summary.expectations});

        Output.prettyError(
            \\ Ran {d} tests across {d} files 
        , .{
            reporter.summary.fail + reporter.summary.pass,
            test_files.len,
        });
        Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());
        Output.prettyError("\n", .{});
        Output.flush();

        if (reporter.summary.fail > 0) {
            Global.exit(1);
        }
    }

    pub fn runAllTests(
        reporter_: *CommandLineReporter,
        vm_: *JSC.VirtualMachine,
        files_: []const PathString,
        allocator_: std.mem.Allocator,
    ) void {
        const Context = struct {
            reporter: *CommandLineReporter,
            vm: *JSC.VirtualMachine,
            files: []const PathString,
            allocator: std.mem.Allocator,
            pub fn begin(this: *@This()) void {
                var reporter = this.reporter;
                var vm = this.vm;
                var files = this.files;
                var allocator = this.allocator;
                std.debug.assert(files.len > 0);

                if (files.len > 1) {
                    for (files[0 .. files.len - 1]) |file_name| {
                        TestCommand.run(reporter, vm, file_name.slice(), allocator) catch {};
                        Global.mimalloc_cleanup(false);
                    }
                }

                TestCommand.run(reporter, vm, files[files.len - 1].slice(), allocator) catch {};
            }
        };

        vm_.eventLoop().ensureWaker();

        var ctx = Context{ .reporter = reporter_, .vm = vm_, .files = files_, .allocator = allocator_ };
        vm_.runWithAPILock(Context, &ctx, Context.begin);
    }

    fn timerNoop(_: *uws.Timer) callconv(.C) void {}

    pub fn run(
        reporter: *CommandLineReporter,
        vm: *JSC.VirtualMachine,
        file_name: string,
        _: std.mem.Allocator,
    ) !void {
        defer {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();

            if (vm.log.errors > 0) {
                if (Output.enable_ansi_colors) {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
                vm.log.msgs.clearRetainingCapacity();
                vm.log.errors = 0;
            }

            Output.flush();
        }

        var file_start = reporter.jest.files.len;
        var resolution = try vm.bundler.resolveEntryPoint(file_name);
        vm.clearEntryPoint();

        Output.prettyErrorln("<r>\n{s}:\n", .{resolution.path_pair.primary.name.filename});
        Output.flush();

        var promise = try vm.loadEntryPoint(resolution.path_pair.primary.text);

        switch (promise.status(vm.global.vm())) {
            .Rejected => {
                var result = promise.result(vm.global.vm());
                vm.runErrorHandler(result, null);
                return;
            },
            else => {},
        }

        var modules: []*Jest.DescribeScope = reporter.jest.files.items(.module_scope)[file_start..];
        for (modules) |module| {
            module.runTests(JSC.JSValue.zero, vm.global);
            vm.eventLoop().tick();

            while (vm.active_tasks > 0) {
                if (!Jest.Jest.runner.?.has_pending_tests) Jest.Jest.runner.?.drain();
                vm.eventLoop().tick();

                while (Jest.Jest.runner.?.has_pending_tests) : (vm.eventLoop().tick()) {
                    vm.eventLoop().tick();
                    if (!Jest.Jest.runner.?.has_pending_tests) break;
                    vm.eventLoop().autoTick();
                }
            }
            _ = vm.global.vm().runGC(false);
        }
        vm.global.vm().clearMicrotaskCallback();
    }
};
