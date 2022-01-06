const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");

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
const configureTransformOptionsForBun = @import("../javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;

const JSC = @import("javascript_core");
const Jest = JSC.Jest;
const TestRunner = JSC.Jest.TestRunner;
const Test = TestRunner.Test;
pub const CommandLineReporter = struct {
    jest: TestRunner,
    callback: TestRunner.Callback,
    last_dot: u32 = 0,
    summary: Summary = Summary{},

    pub const Summary = struct {
        pass: u32 = 0,
        expectations: u32 = 0,
        fail: u32 = 0,
    };

    const DotColorMap = std.EnumMap(TestRunner.Test.Status, string);
    const dots: DotColorMap = brk: {
        var map: DotColorMap = DotColorMap.init(.{});
        map.put(TestRunner.Test.Status.pending, Output.color_map.get("r").? ++ Output.color_map.get("yellow").? ++ Output.color_map.get("r").? ++ " ");
        map.put(TestRunner.Test.Status.pass, Output.color_map.get("r").? ++ Output.color_map.get("green").? ++ Output.color_map.get("r").? ++ " ");
        map.put(TestRunner.Test.Status.fail, Output.color_map.get("r").? ++ Output.color_map.get("red").? ++ Output.color_map.get("r").? ++ " ");
        break :brk map;
    };

    fn updateDots(this: *CommandLineReporter) void {
        const statuses = this.jest.tests.items(.status);
        var writer = Output.errorWriter();
        writer.writeAll("\r");
        if (Output.enable_ansi_colors_stderr) {
            for (statuses) |status| {
                writer.writeAll(this.dots.get(status).?);
            }
        } else {
            for (statuses) |_| {
                writer.writeAll(". ");
            }
        }
    }

    pub fn handleUpdateCount(cb: *TestRunner.Callback, _: u32, _: u32) void {
        var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);
        this.updateDots();
    }

    pub fn handleTestStart(_: *TestRunner.Callback, _: Test.ID) void {
        // var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);
    }
    pub fn handleTestPass(cb: *TestRunner.Callback, _: Test.ID, expectations: u32) void {
        var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);
        this.updateDots();
        this.summary.pass += 1;
        this.summary.expectations += expectations;
    }
    pub fn handleTestFail(cb: *TestRunner.Callback, test_id: Test.ID, _: string, _: string, _: u32) void {
        // var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);
        var this: *CommandLineReporter = @fieldParentPtr(CommandLineReporter, "callback", cb);
        this.last_dot = test_id;
        this.updateDots();
        this.summary.fail += 1;
    }
};

pub const TestCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        var env_loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            var loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };
        @import("javascript/jsc/javascript_core_c_api.zig").JSCInitialize();
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

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var vm = JSC.VirtualMachine.init(ctx.allocator, .{}, null, ctx.log, env_loader);
        for (ctx.positionals) |file| {
            try run(vm, file, ctx.allocator);
        }

        Output.prettyln("\n", .{});
        Output.prettyErrorln("\n ", .{});
        Output.flush();
        Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());
        Output.prettyError(
            \\ Ran {d} tests across {d} files
            \\ 
        , .{
            reporter.summary.fail + reporter.summary.pass,
            ctx.positionals.len,
        });

        if (reporter.summary.pass > 0) {
            Output.prettyError("<r><green>", .{});
        }

        Output.prettyError("  {d:5>} pass<r>\n", .{reporter.summary.pass});

        if (reporter.summary.fail > 0) {
            Output.prettyError("<r><red>", .{});
        } else {
            Output.prettyError("<r><d>", .{});
        }

        Output.prettyError("  {d:5>} fail<r>\n", .{reporter.summary.fail});

        if (reporter.summary.fail == 0) {
            Output.prettyError("<r><green>", .{});
        } else {
            Output.prettyError("<r>", .{});
        }
        Output.prettyError(" {d:5>} expectations\n", .{reporter.summary.expectations});
        Output.flush();
    }

    pub fn run(
        vm: *JSC.VirtualMachine,
        file_name: string,
        _: std.mem.Allocator,
    ) !void {
        defer {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();
            Output.flush();
        }

        var resolution = try vm.bundler.resolveEntryPoint(file_name);
        var promise = try vm.loadEntryPoint(resolution.path_pair.primary.text);
        while (promise.status(vm.global.vm()) == .pending) {
            vm.tick();
        }

        var result = promise.result(vm.global.vm());
        if (result.isError() or
            result.isAggregateError(vm.global) or
            result.isException(vm.global.vm()))
        {
            vm.defaultErrorHandler(result, null);
        }
    }
};
