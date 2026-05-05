//! Extracted from `install/PackageManager/PackageManagerOptions.zig` so
//! `options_types/schema.zig`, `cli/bunfig.zig`, and `ini/` can name the
//! linker mode without depending on the full package manager.
pub const NodeLinker = enum(u8) {
    // If workspaces are used: isolated
    // If not: hoisted
    // Used when nodeLinker is absent from package.json/bun.lock/bun.lockb
    auto,

    hoisted,
    isolated,

    pub fn fromStr(input: []const u8) ?NodeLinker {
        if (strings.eqlComptime(input, "hoisted")) {
            return .hoisted;
        }
        if (strings.eqlComptime(input, "isolated")) {
            return .isolated;
        }
        return null;
    }
};

const bun = @import("bun");
const strings = bun.strings;
