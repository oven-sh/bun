const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
const _global = @import("global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const panicky = @import("panic_handler.zig");
const cli = @import("cli.zig");
pub const MainPanicHandler = panicky.NewPanicHandler(std.builtin.default_panic);
const js = @import("javascript/jsc/bindings/bindings.zig");
const JavaScript = @import("javascript/jsc/javascript.zig");
pub const io_mode = .blocking;
const Report = @import("./report.zig");
pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    MainPanicHandler.handle_panic(msg, error_return_trace);
}

const CrashReporter = @import("crash_reporter");

pub fn PLCrashReportHandler() void {
    Report.fatal(null, null);
}

pub var start_time: i128 = 0;
pub fn main() anyerror!void {
    std.debug.assert(CrashReporter.start(Global.package_json_version));

    start_time = std.time.nanoTimestamp();

    // The memory allocator makes a massive difference.
    // std.heap.raw_c_allocator and default_allocator perform similarly.
    // std.heap.GeneralPurposeAllocator makes this about 3x _slower_ than esbuild.
    // var root_alloc = std.heap.ArenaAllocator.init(std.heap.raw_c_allocator);
    // var root_alloc_ = &root_alloc.allocator;

    var stdout = std.io.getStdOut();
    // var stdout = std.io.bufferedWriter(stdout_file.writer());
    var stderr = std.io.getStdErr();
    var output_source = Output.Source.init(stdout, stderr);

    Output.Source.set(&output_source);
    defer Output.flush();

    cli.Cli.start(default_allocator, stdout, stderr, MainPanicHandler) catch |err| {
        switch (err) {
            error.CurrentWorkingDirectoryUnlinked => {
                Output.prettyError(
                    "\n<r><red>error: <r>The current working directory was deleted, so that command didn't work. Please cd into a different directory and try again.",
                    .{},
                );
                Output.flush();
                std.os.exit(1);
            },
            error.FileNotFound => {
                Output.prettyError(
                    "\n<r><red>error<r><d>:<r> <b>FileNotFound<r>\nbun could not find a file, and the code that produces this error is missing a better error.\n",
                    .{},
                );
                Output.flush();

                Report.printMetadata();

                Output.flush();

                print_stacktrace: {
                    var debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                    var trace = @errorReturnTrace() orelse break :print_stacktrace;
                    Output.disableBuffering();
                    std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.debug.detectTTYConfig()) catch break :print_stacktrace;
                }

                std.os.exit(1);
            },
            error.MissingPackageJSON => {
                Output.prettyError(
                    "\n<r><red>error<r><d>:<r> <b>MissingPackageJSON<r>\nbun could not find a package.json file.\n",
                    .{},
                );
                Output.flush();
                std.os.exit(1);
            },
            else => {
                Report.fatal(err, null);

                print_stacktrace: {
                    var debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                    var trace = @errorReturnTrace() orelse break :print_stacktrace;
                    Output.disableBuffering();
                    std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.debug.detectTTYConfig()) catch break :print_stacktrace;
                }

                std.os.exit(1);
            },
        }
    };

    std.mem.doNotOptimizeAway(JavaScriptVirtualMachine.fetch);
    std.mem.doNotOptimizeAway(JavaScriptVirtualMachine.init);
    std.mem.doNotOptimizeAway(JavaScriptVirtualMachine.resolve);
}

pub const JavaScriptVirtualMachine = JavaScript.VirtualMachine;

test "" {
    @import("std").testing.refAllDecls(@This());

    std.mem.doNotOptimizeAway(JavaScriptVirtualMachine.fetch);
    std.mem.doNotOptimizeAway(JavaScriptVirtualMachine.init);
    std.mem.doNotOptimizeAway(JavaScriptVirtualMachine.resolve);
}

test "panic" {
    panic("woah", null);
}
