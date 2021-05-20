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
usingnamespace @import("global.zig");
const panicky = @import("panic_handler.zig");
const cli = @import("cli.zig");
const api = @import("./api/schema.zig");

extern const Configuration = struct {};

export fn configure(configuration: Configuration) void {}
