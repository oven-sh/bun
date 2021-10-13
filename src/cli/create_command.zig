usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
const panicky = @import("../panic_handler.zig");
const allocators = @import("../allocators.zig");
const sync = @import(".././sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const fs = @import("../fs.zig");

pub const CreateCommand = struct {
    pub const Args = struct {
        template_name: string,
        directory_name: string,
    };

    pub fn exec(ctx: Command.Context) !void {}
};
