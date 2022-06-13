const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
const bun = @import("global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const panicky = @import("panic_handler.zig");
const cli = @import("cli.zig");
pub const MainPanicHandler = panicky.NewPanicHandler(std.builtin.default_panic);
const js = @import("javascript/jsc/bindings/bindings.zig");
const JavaScript = @import("javascript/jsc/javascript.zig");
pub const io_mode = .blocking;
pub const bindgen = @import("build_options").bindgen;
const Report = @import("./report.zig");
pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    MainPanicHandler.handle_panic(msg, error_return_trace);
}

const CrashReporter = @import("crash_reporter");

pub fn PLCrashReportHandler() void {
    Report.fatal(null, null);
}

pub var start_time: i128 = 0;
pub fn main() void {
    if (comptime Environment.isRelease)
        CrashReporter.start(null, Report.CrashReportWriter.printFrame, Report.handleCrash);

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

    cli.Cli.start(default_allocator, stdout, stderr, MainPanicHandler);

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
