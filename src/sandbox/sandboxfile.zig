//! Sandboxfile Parser
//!
//! A declarative spec for agent sandboxes. Sandboxfile defines the environment,
//! services, outputs, network access, and secrets for ephemeral agent environments.
//!
//! Example Sandboxfile:
//! ```
//! # Sandboxfile
//!
//! FROM host
//! WORKDIR .
//!
//! RUN bun install
//!
//! DEV PORT=3000 WATCH=src/** bun run dev
//! SERVICE db PORT=5432 docker compose up postgres
//! SERVICE redis PORT=6379 redis-server
//! TEST bun test
//!
//! OUTPUT src/
//! OUTPUT tests/
//! OUTPUT package.json
//!
//! LOGS logs/*
//!
//! NET registry.npmjs.org
//! NET api.stripe.com
//!
//! SECRET STRIPE_API_KEY
//! ```

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const strings = bun.strings;
const Allocator = std.mem.Allocator;
const logger = bun.logger;

pub const Sandboxfile = struct {
    /// Base environment: "host" or an image name
    from: ?[]const u8 = null,

    /// Project root directory
    workdir: ?[]const u8 = null,

    /// Setup commands (run once per agent)
    run_commands: std.ArrayListUnmanaged([]const u8) = .{},

    /// Primary dev server (optional, supports PORT, WATCH)
    dev: ?Process = null,

    /// Background processes (required name, supports PORT, WATCH)
    services: std.ArrayListUnmanaged(Service) = .{},

    /// Verification commands (optional name)
    tests: std.ArrayListUnmanaged(Process) = .{},

    /// Files extracted from agent (everything else is ephemeral)
    outputs: std.ArrayListUnmanaged([]const u8) = .{},

    /// Log streams agent can tail
    logs: std.ArrayListUnmanaged([]const u8) = .{},

    /// Allowed external hosts (default deny-all, services implicitly allowed)
    net: std.ArrayListUnmanaged([]const u8) = .{},

    /// Env vars agent can use but not inspect
    secrets: std.ArrayListUnmanaged([]const u8) = .{},

    /// If true, agent should infer the lockfile from repo
    infer: ?[]const u8 = null,

    pub const Process = struct {
        name: ?[]const u8 = null,
        command: []const u8,
        port: ?u16 = null,
        watch: ?[]const u8 = null,
    };

    pub const Service = struct {
        name: []const u8,
        command: []const u8,
        port: ?u16 = null,
        watch: ?[]const u8 = null,
    };

    pub fn deinit(self: *Sandboxfile, allocator: Allocator) void {
        self.run_commands.deinit(allocator);
        self.services.deinit(allocator);
        self.tests.deinit(allocator);
        self.outputs.deinit(allocator);
        self.logs.deinit(allocator);
        self.net.deinit(allocator);
        self.secrets.deinit(allocator);
    }

    pub fn format(
        self: *const Sandboxfile,
        comptime fmt: []const u8,
        options: std.fmt.FormatOptions,
        writer: anytype,
    ) !void {
        _ = fmt;
        _ = options;

        if (self.from) |from| {
            try writer.print("FROM {s}\n", .{from});
        }
        if (self.workdir) |workdir| {
            try writer.print("WORKDIR {s}\n", .{workdir});
        }
        if (self.infer) |infer| {
            try writer.print("INFER {s}\n", .{infer});
        }
        for (self.run_commands.items) |cmd| {
            try writer.print("RUN {s}\n", .{cmd});
        }
        if (self.dev) |dev| {
            try writer.writeAll("DEV");
            if (dev.name) |name| try writer.print(" {s}", .{name});
            if (dev.port) |port| try writer.print(" PORT={d}", .{port});
            if (dev.watch) |watch| try writer.print(" WATCH={s}", .{watch});
            try writer.print(" {s}\n", .{dev.command});
        }
        for (self.services.items) |service| {
            try writer.print("SERVICE {s}", .{service.name});
            if (service.port) |port| try writer.print(" PORT={d}", .{port});
            if (service.watch) |watch| try writer.print(" WATCH={s}", .{watch});
            try writer.print(" {s}\n", .{service.command});
        }
        for (self.tests.items) |t| {
            try writer.writeAll("TEST");
            if (t.name) |name| try writer.print(" {s}", .{name});
            if (t.port) |port| try writer.print(" PORT={d}", .{port});
            if (t.watch) |watch| try writer.print(" WATCH={s}", .{watch});
            try writer.print(" {s}\n", .{t.command});
        }
        for (self.outputs.items) |output| {
            try writer.print("OUTPUT {s}\n", .{output});
        }
        for (self.logs.items) |log| {
            try writer.print("LOGS {s}\n", .{log});
        }
        for (self.net.items) |host| {
            try writer.print("NET {s}\n", .{host});
        }
        for (self.secrets.items) |secret| {
            try writer.print("SECRET {s}\n", .{secret});
        }
    }
};

pub const Parser = struct {
    source: logger.Source,
    src: []const u8,
    log: logger.Log,
    allocator: Allocator,
    result: Sandboxfile,
    line_number: u32,

    pub const Error = error{
        InvalidSandboxfile,
        OutOfMemory,
    };

    pub fn init(allocator: Allocator, path: []const u8, src: []const u8) Parser {
        return .{
            .log = logger.Log.init(allocator),
            .src = src,
            .source = logger.Source.initPathString(path, src),
            .allocator = allocator,
            .result = .{},
            .line_number = 0,
        };
    }

    pub fn deinit(self: *Parser) void {
        self.log.deinit();
        self.result.deinit(self.allocator);
    }

    fn addError(self: *Parser, comptime text: []const u8) Error {
        self.log.addErrorOpts(text, .{
            .source = &self.source,
            .loc = .{ .start = @intCast(self.line_number) },
        }) catch {};
        return error.InvalidSandboxfile;
    }

    fn addErrorFmt(self: *Parser, comptime text: []const u8, args: anytype) Error {
        self.log.addErrorFmtOpts(self.allocator, text, args, .{
            .source = &self.source,
            .loc = .{ .start = @intCast(self.line_number) },
        }) catch {};
        return error.InvalidSandboxfile;
    }

    pub fn parse(self: *Parser) Error!Sandboxfile {
        var iter = std.mem.splitScalar(u8, self.src, '\n');

        while (iter.next()) |line_raw| {
            self.line_number += 1;
            const line = std.mem.trim(u8, line_raw, " \t\r");

            // Skip empty lines and comments
            if (line.len == 0 or line[0] == '#') continue;

            try self.parseLine(line);
        }

        return self.result;
    }

    fn parseLine(self: *Parser, line: []const u8) Error!void {
        // Find the directive (first word)
        const directive_end = std.mem.indexOfAny(u8, line, " \t") orelse line.len;
        const directive = line[0..directive_end];
        const rest = if (directive_end < line.len) std.mem.trimLeft(u8, line[directive_end..], " \t") else "";

        if (strings.eqlComptime(directive, "FROM")) {
            try self.parseFrom(rest);
        } else if (strings.eqlComptime(directive, "WORKDIR")) {
            try self.parseWorkdir(rest);
        } else if (strings.eqlComptime(directive, "RUN")) {
            try self.parseRun(rest);
        } else if (strings.eqlComptime(directive, "DEV")) {
            try self.parseDev(rest);
        } else if (strings.eqlComptime(directive, "SERVICE")) {
            try self.parseService(rest);
        } else if (strings.eqlComptime(directive, "TEST")) {
            try self.parseTest(rest);
        } else if (strings.eqlComptime(directive, "OUTPUT")) {
            try self.parseOutput(rest);
        } else if (strings.eqlComptime(directive, "LOGS")) {
            try self.parseLogs(rest);
        } else if (strings.eqlComptime(directive, "NET")) {
            try self.parseNet(rest);
        } else if (strings.eqlComptime(directive, "SECRET")) {
            try self.parseSecret(rest);
        } else if (strings.eqlComptime(directive, "INFER")) {
            try self.parseInfer(rest);
        } else {
            return self.addErrorFmt("Unknown directive: {s}", .{directive});
        }
    }

    fn parseFrom(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("FROM requires an argument (e.g., 'host' or image name)");
        }
        if (self.result.from != null) {
            return self.addError("Duplicate FROM directive");
        }
        self.result.from = rest;
    }

    fn parseWorkdir(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("WORKDIR requires a path argument");
        }
        if (self.result.workdir != null) {
            return self.addError("Duplicate WORKDIR directive");
        }
        self.result.workdir = rest;
    }

    fn parseRun(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("RUN requires a command argument");
        }
        try self.result.run_commands.append(self.allocator, rest);
    }

    fn parseDev(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("DEV requires a command argument");
        }
        if (self.result.dev != null) {
            return self.addError("Duplicate DEV directive (only one dev server allowed)");
        }
        self.result.dev = try self.parseProcess(rest, false);
    }

    fn parseService(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("SERVICE requires a name and command");
        }

        const process = try self.parseProcess(rest, true);
        const name = process.name orelse {
            return self.addError("SERVICE requires a name");
        };

        try self.result.services.append(self.allocator, .{
            .name = name,
            .command = process.command,
            .port = process.port,
            .watch = process.watch,
        });
    }

    fn parseTest(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("TEST requires a command argument");
        }
        try self.result.tests.append(self.allocator, try self.parseProcess(rest, false));
    }

    fn parseOutput(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("OUTPUT requires a path argument");
        }
        try self.result.outputs.append(self.allocator, rest);
    }

    fn parseLogs(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("LOGS requires a path pattern argument");
        }
        try self.result.logs.append(self.allocator, rest);
    }

    fn parseNet(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("NET requires a hostname argument");
        }
        try self.result.net.append(self.allocator, rest);
    }

    fn parseSecret(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("SECRET requires an environment variable name");
        }
        // Validate secret name (should be valid env var name)
        for (rest) |c| {
            if (!std.ascii.isAlphanumeric(c) and c != '_') {
                return self.addError("SECRET name must be a valid environment variable name (alphanumeric and underscore only)");
            }
        }
        try self.result.secrets.append(self.allocator, rest);
    }

    fn parseInfer(self: *Parser, rest: []const u8) Error!void {
        if (rest.len == 0) {
            return self.addError("INFER requires a pattern argument (e.g., '*')");
        }
        if (self.result.infer != null) {
            return self.addError("Duplicate INFER directive");
        }
        self.result.infer = rest;
    }

    /// Parse a process definition with optional name, PORT=, WATCH= options and command
    /// Format: [name] [PORT=N] [WATCH=pattern] command args...
    fn parseProcess(self: *Parser, input: []const u8, require_name: bool) Error!Sandboxfile.Process {
        var process = Sandboxfile.Process{ .command = "" };
        var rest = input;
        var has_name = false;

        // Parse tokens until we hit the command
        while (rest.len > 0) {
            const token_end = std.mem.indexOfAny(u8, rest, " \t") orelse rest.len;
            const token = rest[0..token_end];

            if (std.mem.startsWith(u8, token, "PORT=")) {
                const port_str = token[5..];
                process.port = std.fmt.parseInt(u16, port_str, 10) catch {
                    return self.addErrorFmt("Invalid PORT value: {s}", .{port_str});
                };
            } else if (std.mem.startsWith(u8, token, "WATCH=")) {
                process.watch = token[6..];
            } else if (!has_name and !require_name) {
                // For DEV/TEST, first non-option token is the command
                process.command = rest;
                break;
            } else if (!has_name) {
                // First non-option token is the name
                process.name = token;
                has_name = true;
            } else {
                // Rest is the command
                process.command = rest;
                break;
            }

            // Move to next token
            if (token_end >= rest.len) {
                rest = "";
            } else {
                rest = std.mem.trimLeft(u8, rest[token_end..], " \t");
            }
        }

        if (process.command.len == 0) {
            return self.addError("Missing command in process definition");
        }

        return process;
    }

    /// Parse a Sandboxfile from a file path
    pub fn parseFile(allocator: Allocator, path: []const u8) Error!Sandboxfile {
        const file = std.fs.cwd().openFile(path, .{}) catch {
            var p = Parser.init(allocator, path, "");
            return p.addError("Could not open Sandboxfile");
        };
        defer file.close();

        const src = file.readToEndAlloc(allocator, 1024 * 1024) catch {
            var p = Parser.init(allocator, path, "");
            return p.addError("Could not read Sandboxfile");
        };

        var parser = Parser.init(allocator, path, src);
        return parser.parse();
    }

    /// Parse a Sandboxfile from a string
    pub fn parseString(allocator: Allocator, src: []const u8) Error!Sandboxfile {
        var parser = Parser.init(allocator, "<string>", src);
        return parser.parse();
    }
};

/// Validate a parsed Sandboxfile
pub fn validate(sandboxfile: *const Sandboxfile) !void {
    // FROM is required
    if (sandboxfile.from == null and sandboxfile.infer == null) {
        return error.MissingFrom;
    }

    // WORKDIR is required (unless INFER)
    if (sandboxfile.workdir == null and sandboxfile.infer == null) {
        return error.MissingWorkdir;
    }
}

test "parse basic sandboxfile" {
    const allocator = std.testing.allocator;
    const src =
        \\# Sandboxfile
        \\
        \\FROM host
        \\WORKDIR .
        \\
        \\RUN bun install
        \\
        \\DEV PORT=3000 WATCH=src/** bun run dev
        \\SERVICE db PORT=5432 docker compose up postgres
        \\SERVICE redis PORT=6379 redis-server
        \\TEST bun test
        \\
        \\OUTPUT src/
        \\OUTPUT tests/
        \\OUTPUT package.json
        \\
        \\LOGS logs/*
        \\
        \\NET registry.npmjs.org
        \\NET api.stripe.com
        \\
        \\SECRET STRIPE_API_KEY
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = try parser.parse();

    try std.testing.expectEqualStrings("host", result.from.?);
    try std.testing.expectEqualStrings(".", result.workdir.?);
    try std.testing.expectEqual(@as(usize, 1), result.run_commands.items.len);
    try std.testing.expectEqualStrings("bun install", result.run_commands.items[0]);

    // DEV
    try std.testing.expect(result.dev != null);
    try std.testing.expectEqual(@as(u16, 3000), result.dev.?.port.?);
    try std.testing.expectEqualStrings("src/**", result.dev.?.watch.?);
    try std.testing.expectEqualStrings("bun run dev", result.dev.?.command);

    // Services
    try std.testing.expectEqual(@as(usize, 2), result.services.items.len);
    try std.testing.expectEqualStrings("db", result.services.items[0].name);
    try std.testing.expectEqual(@as(u16, 5432), result.services.items[0].port.?);
    try std.testing.expectEqualStrings("docker compose up postgres", result.services.items[0].command);
    try std.testing.expectEqualStrings("redis", result.services.items[1].name);

    // Tests
    try std.testing.expectEqual(@as(usize, 1), result.tests.items.len);
    try std.testing.expectEqualStrings("bun test", result.tests.items[0].command);

    // Outputs
    try std.testing.expectEqual(@as(usize, 3), result.outputs.items.len);
    try std.testing.expectEqualStrings("src/", result.outputs.items[0]);
    try std.testing.expectEqualStrings("tests/", result.outputs.items[1]);
    try std.testing.expectEqualStrings("package.json", result.outputs.items[2]);

    // Logs
    try std.testing.expectEqual(@as(usize, 1), result.logs.items.len);
    try std.testing.expectEqualStrings("logs/*", result.logs.items[0]);

    // Net
    try std.testing.expectEqual(@as(usize, 2), result.net.items.len);
    try std.testing.expectEqualStrings("registry.npmjs.org", result.net.items[0]);
    try std.testing.expectEqualStrings("api.stripe.com", result.net.items[1]);

    // Secrets
    try std.testing.expectEqual(@as(usize, 1), result.secrets.items.len);
    try std.testing.expectEqualStrings("STRIPE_API_KEY", result.secrets.items[0]);
}

test "parse shorthand sandboxfile" {
    const allocator = std.testing.allocator;
    const src =
        \\FROM host
        \\WORKDIR .
        \\INFER *
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = try parser.parse();

    try std.testing.expectEqualStrings("host", result.from.?);
    try std.testing.expectEqualStrings(".", result.workdir.?);
    try std.testing.expectEqualStrings("*", result.infer.?);
}

test "error on unknown directive" {
    const allocator = std.testing.allocator;
    const src =
        \\FROM host
        \\INVALID_DIRECTIVE foo
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = parser.parse();
    try std.testing.expect(result == error.InvalidSandboxfile);
}

test "error on duplicate FROM" {
    const allocator = std.testing.allocator;
    const src =
        \\FROM host
        \\FROM ubuntu:22.04
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = parser.parse();
    try std.testing.expect(result == error.InvalidSandboxfile);
}

test "error on service without name" {
    const allocator = std.testing.allocator;
    const src =
        \\FROM host
        \\WORKDIR .
        \\SERVICE PORT=5432 docker compose up postgres
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = parser.parse();
    try std.testing.expect(result == error.InvalidSandboxfile);
}

test "error on invalid secret name" {
    const allocator = std.testing.allocator;
    const src =
        \\FROM host
        \\WORKDIR .
        \\SECRET invalid-secret-name
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = parser.parse();
    try std.testing.expect(result == error.InvalidSandboxfile);
}

test "multiple RUN commands" {
    const allocator = std.testing.allocator;
    const src =
        \\FROM host
        \\WORKDIR .
        \\RUN apt-get update
        \\RUN apt-get install -y nodejs
        \\RUN npm install
    ;

    var parser = Parser.init(allocator, "Sandboxfile", src);
    defer parser.deinit();

    const result = try parser.parse();

    try std.testing.expectEqual(@as(usize, 3), result.run_commands.items.len);
    try std.testing.expectEqualStrings("apt-get update", result.run_commands.items[0]);
    try std.testing.expectEqualStrings("apt-get install -y nodejs", result.run_commands.items[1]);
    try std.testing.expectEqualStrings("npm install", result.run_commands.items[2]);
}
