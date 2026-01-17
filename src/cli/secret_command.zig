const Subcommand = enum {
    set,
    get,
    delete,
    help,
    unknown,

    pub fn fromString(str: []const u8) Subcommand {
        if (strings.eqlComptime(str, "set")) return .set;
        if (strings.eqlComptime(str, "get")) return .get;
        if (strings.eqlComptime(str, "delete")) return .delete;
        if (strings.eqlComptime(str, "help") or strings.eqlComptime(str, "--help") or strings.eqlComptime(str, "-h")) return .help;
        return .unknown;
    }
};

const sysv_abi: std.builtin.CallingConvention = if (Environment.isWindows and Environment.isX64)
    .{ .x86_64_sysv = .{} }
else
    .c;

const SecretsCliResult = extern struct {
    error_type: c_int,
    error_code: c_int,
    error_message: ?[*:0]u8,
    value: ?[*]u8,
    value_len: usize,
    success: bool,
};

const Bun__Secrets__setSync = @extern(*const fn (
    service: [*]const u8,
    service_len: usize,
    name: [*]const u8,
    name_len: usize,
    value: [*]const u8,
    value_len: usize,
    allowUnrestrictedAccess: bool,
) callconv(sysv_abi) SecretsCliResult, .{ .name = "Bun__Secrets__setSync" });

const Bun__Secrets__getSync = @extern(*const fn (
    service: [*]const u8,
    service_len: usize,
    name: [*]const u8,
    name_len: usize,
) callconv(sysv_abi) SecretsCliResult, .{ .name = "Bun__Secrets__getSync" });

const Bun__Secrets__deleteSync = @extern(*const fn (
    service: [*]const u8,
    service_len: usize,
    name: [*]const u8,
    name_len: usize,
) callconv(sysv_abi) SecretsCliResult, .{ .name = "Bun__Secrets__deleteSync" });

const Bun__Secrets__freeResult = @extern(*const fn (result: *SecretsCliResult) callconv(sysv_abi) void, .{ .name = "Bun__Secrets__freeResult" });

pub const SecretCommand = struct {
    pub fn exec(allocator: std.mem.Allocator, args: []const [:0]const u8) !void {
        _ = allocator;

        if (args.len == 0) {
            printHelp();
            return;
        }

        const subcommand = Subcommand.fromString(args[0]);

        switch (subcommand) {
            .set => try execSet(args[1..]),
            .get => try execGet(args[1..]),
            .delete => try execDelete(args[1..]),
            .help => printHelp(),
            .unknown => {
                Output.errGeneric("Unknown subcommand: {s}", .{args[0]});
                Output.errGeneric("Run 'bun secret --help' for usage.", .{});
                Global.exit(1);
            },
        }
    }

    pub fn printHelp() void {
        Output.prettyln(
            \\<cyan><b>bun secret<r> - Manage secrets in the system keychain
            \\
            \\<b>Usage:<r>
            \\  bun secret \<command\> [options]
            \\
            \\<b>Commands:<r>
            \\  <cyan>set<r>     Store a secret in the keychain
            \\  <cyan>get<r>     Retrieve a secret from the keychain
            \\  <cyan>delete<r>  Remove a secret from the keychain
            \\
            \\<b>Options:<r>
            \\  <cyan>-s, --service<r> \<name\>  Service/application name (required)
            \\  <cyan>-n, --name<r> \<name\>     Secret name (can also be positional)
            \\  <cyan>-v, --value<r> \<value\>   Secret value (for set, can also be positional)
            \\
            \\<b>Examples:<r>
            \\  bun secret set --service myapp API_KEY sk-abc123
            \\  bun secret set -s myapp -n API_KEY -v sk-abc123
            \\  bun secret get --service myapp API_KEY
            \\  bun secret delete --service myapp API_KEY
            \\
            \\<b>Note:<r>
            \\  Secrets are stored in the system keychain:
            \\  - macOS: Keychain Access
            \\  - Linux: libsecret (GNOME Keyring)
            \\  - Windows: Credential Manager
            \\
        , .{});
    }
};

fn execSet(args: []const [:0]const u8) !void {
    var service: ?[]const u8 = null;
    var name: ?[]const u8 = null;
    var value: ?[]const u8 = null;

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (strings.eqlComptime(arg, "--service") or strings.eqlComptime(arg, "-s")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --service", .{});
                Global.exit(1);
            }
            service = args[i];
        } else if (strings.eqlComptime(arg, "--name") or strings.eqlComptime(arg, "-n")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --name", .{});
                Global.exit(1);
            }
            name = args[i];
        } else if (strings.eqlComptime(arg, "--value") or strings.eqlComptime(arg, "-v")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --value", .{});
                Global.exit(1);
            }
            value = args[i];
        } else if (name == null) {
            name = arg;
        } else if (value == null) {
            value = arg;
        } else {
            Output.errGeneric("Unexpected argument: {s}", .{arg});
            Global.exit(1);
        }
    }

    const service_val = service orelse {
        Output.errGeneric("Missing required --service argument", .{});
        Output.errGeneric("Usage: bun secret set --service SERVICE NAME VALUE", .{});
        Global.exit(1);
    };

    const name_val = name orelse {
        Output.errGeneric("Missing required name argument", .{});
        Output.errGeneric("Usage: bun secret set --service SERVICE NAME VALUE", .{});
        Global.exit(1);
    };

    const value_val = value orelse {
        Output.errGeneric("Missing required value argument", .{});
        Output.errGeneric("Usage: bun secret set --service SERVICE NAME VALUE", .{});
        Global.exit(1);
    };

    var result = Bun__Secrets__setSync(
        service_val.ptr,
        service_val.len,
        name_val.ptr,
        name_val.len,
        value_val.ptr,
        value_val.len,
        false,
    );
    defer Bun__Secrets__freeResult(&result);

    if (!result.success) {
        const msg = result.error_message orelse {
            Output.errGeneric("Failed to set secret (error code: {d})", .{result.error_code});
            Global.exit(1);
        };
        Output.errGeneric("Failed to set secret: {s}", .{msg});
        Global.exit(1);
    }

    Output.prettyln("<green>✓<r> Secret '{s}' set successfully", .{name_val});
}

fn execGet(args: []const [:0]const u8) !void {
    var service: ?[]const u8 = null;
    var name: ?[]const u8 = null;

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (strings.eqlComptime(arg, "--service") or strings.eqlComptime(arg, "-s")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --service", .{});
                Global.exit(1);
            }
            service = args[i];
        } else if (strings.eqlComptime(arg, "--name") or strings.eqlComptime(arg, "-n")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --name", .{});
                Global.exit(1);
            }
            name = args[i];
        } else if (name == null) {
            name = arg;
        } else {
            Output.errGeneric("Unexpected argument: {s}", .{arg});
            Global.exit(1);
        }
    }

    const service_val = service orelse {
        Output.errGeneric("Missing required --service argument", .{});
        Output.errGeneric("Usage: bun secret get --service SERVICE NAME", .{});
        Global.exit(1);
    };

    const name_val = name orelse {
        Output.errGeneric("Missing required name argument", .{});
        Output.errGeneric("Usage: bun secret get --service SERVICE NAME", .{});
        Global.exit(1);
    };

    var result = Bun__Secrets__getSync(
        service_val.ptr,
        service_val.len,
        name_val.ptr,
        name_val.len,
    );
    defer Bun__Secrets__freeResult(&result);

    if (!result.success) {
        const msg = result.error_message orelse {
            Output.errGeneric("Failed to get secret (error code: {d})", .{result.error_code});
            Global.exit(1);
        };
        Output.errGeneric("Failed to get secret: {s}", .{msg});
        Global.exit(1);
    }

    const value_ptr = result.value orelse {
        Output.errGeneric("Secret '{s}' not found", .{name_val});
        Global.exit(1);
    };
    const value = value_ptr[0..result.value_len];
    Output.print("{s}\n", .{value});
}

fn execDelete(args: []const [:0]const u8) !void {
    var service: ?[]const u8 = null;
    var name: ?[]const u8 = null;

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (strings.eqlComptime(arg, "--service") or strings.eqlComptime(arg, "-s")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --service", .{});
                Global.exit(1);
            }
            service = args[i];
        } else if (strings.eqlComptime(arg, "--name") or strings.eqlComptime(arg, "-n")) {
            i += 1;
            if (i >= args.len) {
                Output.errGeneric("Missing value for --name", .{});
                Global.exit(1);
            }
            name = args[i];
        } else if (name == null) {
            name = arg;
        } else {
            Output.errGeneric("Unexpected argument: {s}", .{arg});
            Global.exit(1);
        }
    }

    const service_val = service orelse {
        Output.errGeneric("Missing required --service argument", .{});
        Output.errGeneric("Usage: bun secret delete --service SERVICE NAME", .{});
        Global.exit(1);
    };

    const name_val = name orelse {
        Output.errGeneric("Missing required name argument", .{});
        Output.errGeneric("Usage: bun secret delete --service SERVICE NAME", .{});
        Global.exit(1);
    };

    var result = Bun__Secrets__deleteSync(
        service_val.ptr,
        service_val.len,
        name_val.ptr,
        name_val.len,
    );
    defer Bun__Secrets__freeResult(&result);

    if (!result.success) {
        const msg = result.error_message orelse {
            Output.prettyln("<yellow>⚠<r> Secret '{s}' not found", .{name_val});
            return;
        };
        Output.errGeneric("Failed to delete secret: {s}", .{msg});
        Global.exit(1);
    }

    Output.prettyln("<green>✓<r> Secret '{s}' deleted successfully", .{name_val});
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const strings = bun.strings;
