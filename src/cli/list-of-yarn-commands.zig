const std = @import("std");
const bun = @import("root").bun;

// yarn v2.3 commands
const yarn_v2 = [_][]const u8{
    "add",
    "bin",
    "cache",
    "config",
    "dedupe",
    "dlx",
    "exec",
    "explain",
    "info",
    "init",
    "install",
    "link",
    "node",
    "npm",
    "pack",
    "patch",
    "plugin",
    "rebuild",
    "remove",
    "run",
    "set",
    "unplug",
    "up",
    "why",
    "workspace",
    "workspaces",
};

// yarn v1 commands
const yarn_v1 = [_][]const u8{
    "access",
    "add",
    "audit",
    "autoclean",
    "bin",
    "cache",
    "check",
    "config",
    "create",
    "exec",
    "generate-lock-entry",
    "generateLockEntry",
    "global",
    "help",
    "import",
    "info",
    "init",
    "install",
    "licenses",
    "link",
    "list",
    "login",
    "logout",
    "node",
    "outdated",
    "owner",
    "pack",
    "policies",
    "publish",
    "remove",
    "run",
    "tag",
    "team",
    "unlink",
    "unplug",
    "upgrade",
    "upgrade-interactive",
    "upgradeInteractive",
    "version",
    "versions",
    "why",
    "workspace",
    "workspaces",
};

pub const all_yarn_commands = brk: {
    @setEvalBranchQuota(9999);
    var array: [yarn_v2.len + yarn_v1.len]u64 = undefined;
    var array_i: usize = 0;
    for (yarn_v2) |yarn| {
        const hash = bun.hash(yarn);
        @setEvalBranchQuota(9999);
        if (std.mem.indexOfScalar(u64, array[0..array_i], hash) == null) {
            @setEvalBranchQuota(9999);
            array[array_i] = hash;
            array_i += 1;
        }
    }

    for (yarn_v1) |yarn| {
        @setEvalBranchQuota(9999);

        const hash = bun.hash(yarn);
        if (std.mem.indexOfScalar(u64, array[0..array_i], hash) == null) {
            @setEvalBranchQuota(9999);

            array[array_i] = hash;
            array_i += 1;
        }
    }

    const final = array[0..array_i].*;
    break :brk &final;
};
