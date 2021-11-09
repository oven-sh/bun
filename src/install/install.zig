usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
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
const URL = @import("../query_string_map.zig").URL;

const URI = union(Tag) {
    local: string,
    remote: URL,

    pub const Tag = enum {
        local,
        remote,
    };
};

const Semver = @import("./semver.zig");

const Dependency = struct {
    name: string,
    name_hash: u32,
    version: Version,

    pub const Version = union(Tag) {
        pub const Tag = enum {
            npm,
            tarball,
            folder,

            /// TODO:
            symlink,
            /// TODO:
            workspace,
            /// TODO:
            git,
            /// TODO:
            github,
        };

        version: Semver.Query.Group,
        tarball: URI,
        folder: string,

        symlink: void,
        workspace: void,
        git: void,
        github: void,
    };

    pub const List = std.MultiArrayList(Dependency);
};

const Package = struct {
    name: string,
    version: string,
    dependencies: Dependency.List,
    dev_dependencies: Dependency.List,
    peer_dependencies: Dependency.List,
    optional_dependencies: Dependency.List,

    
};

/// [Abbreviated NPM Package Version](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-version-object)
const Registry = struct {
    url: URL,
};
