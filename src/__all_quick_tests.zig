const std = @import("std");

test {
    _ = @import("./__quick_tests.zig");

    // slow compilation

    _ = @import("./cli/add_completions.zig");
    _ = @import("./js_lexer/identifier_data.zig");

    // not supported

    // _ = @import("./boringssl.zig");
    // _ = @import("./defines.zig");
    // _ = @import("./env_loader.zig");
    // _ = @import("./fs.zig");
    // _ = @import("./http_client_async.zig");
    // _ = @import("./js_ast.zig");
    // _ = @import("./js_printer.zig");
    // _ = @import("./json_parser.zig");
    // _ = @import("./main.zig");
    // _ = @import("./router.zig");
    // _ = @import("./url.zig");
    // _ = @import("./zlib.zig");
    // _ = @import("./bun.js/webcore/encoding.zig");
    // _ = @import("./cli/run_command.zig");
    // _ = @import("./deps/picohttp.zig");
    // _ = @import("./install/install.zig");
    // _ = @import("./sourcemap/sourcemap.zig");
}
