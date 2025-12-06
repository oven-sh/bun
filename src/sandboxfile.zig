/// Sandboxfile Parser
///
/// A declarative spec for agent sandboxes. Sandboxfiles define isolated
/// environments for running agents with controlled network access, secrets,
/// and file system permissions.
///
/// Example Sandboxfile:
/// ```
/// # Sandboxfile
///
/// FROM host
/// WORKDIR .
///
/// RUN bun install
///
/// DEV PORT=3000 WATCH=src/** bun run dev
/// SERVICE db PORT=5432 docker compose up postgres
/// SERVICE redis PORT=6379 redis-server
/// TEST bun test
///
/// OUTPUT src/
/// OUTPUT tests/
/// OUTPUT package.json
///
/// LOGS logs/*
///
/// NET registry.npmjs.org
/// NET api.stripe.com
///
/// SECRET STRIPE_API_KEY
/// ```
const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

/// A key-value pair for directive options (e.g., PORT=3000)
pub const KeyValue = struct {
    key: []const u8,
    value: []const u8,
};

/// Base environment specification
pub const BaseEnv = union(enum) {
    /// Use the host environment directly
    host,
    /// Use a container image
    image: []const u8,
};

/// A RUN directive - setup command executed once per agent
pub const RunDirective = struct {
    command: []const u8,
};

/// A DEV directive - primary dev server
pub const DevDirective = struct {
    name: ?[]const u8,
    port: ?u16,
    watch: ?[]const u8,
    command: []const u8,
};

/// A SERVICE directive - background process
pub const ServiceDirective = struct {
    name: []const u8,
    port: ?u16,
    watch: ?[]const u8,
    command: []const u8,
};

/// A TEST directive - verification command
pub const TestDirective = struct {
    name: ?[]const u8,
    command: []const u8,
};

/// Parsed Sandboxfile configuration
pub const Sandboxfile = struct {
    /// Base environment (FROM directive)
    base_env: BaseEnv = .host,

    /// Working directory (WORKDIR directive)
    workdir: []const u8 = ".",

    /// Setup commands (RUN directives)
    run_commands: ArrayList(RunDirective) = .{},

    /// Primary dev server (DEV directive)
    dev: ?DevDirective = null,

    /// Background services (SERVICE directives)
    services: ArrayList(ServiceDirective) = .{},

    /// Test commands (TEST directives)
    tests: ArrayList(TestDirective) = .{},

    /// Output paths - files extracted from agent (OUTPUT directives)
    outputs: ArrayList([]const u8) = .{},

    /// Log paths - streams agent can tail (LOGS directives)
    logs: ArrayList([]const u8) = .{},

    /// Allowed network hosts (NET directives)
    allowed_hosts: ArrayList([]const u8) = .{},

    /// Secret environment variable names (SECRET directives)
    secrets: ArrayList([]const u8) = .{},

    /// Whether INFER mode is enabled
    infer_enabled: bool = false,

    /// INFER pattern (default "*" when enabled)
    infer_pattern: ?[]const u8 = null,

    pub fn deinit(self: *Sandboxfile, allocator: Allocator) void {
        self.run_commands.deinit(allocator);
        self.services.deinit(allocator);
        self.tests.deinit(allocator);
        self.outputs.deinit(allocator);
        self.logs.deinit(allocator);
        self.allowed_hosts.deinit(allocator);
        self.secrets.deinit(allocator);
    }
};

/// Sandboxfile parsing errors
pub const ParseError = error{
    InvalidDirective,
    MissingArgument,
    InvalidPort,
    DuplicateFrom,
    DuplicateWorkdir,
    DuplicateDev,
    MissingServiceName,
    UnexpectedToken,
    OutOfMemory,
};

/// Parser for Sandboxfile format
pub const Parser = struct {
    allocator: Allocator,
    source: []const u8,
    line_number: usize,
    result: Sandboxfile,
    errors: ArrayList(ParseErrorInfo),

    pub const ParseErrorInfo = struct {
        line: usize,
        message: []const u8,
    };

    pub fn init(allocator: Allocator, source: []const u8) Parser {
        return .{
            .allocator = allocator,
            .source = source,
            .line_number = 0,
            .result = .{},
            .errors = .{},
        };
    }

    pub fn deinit(self: *Parser) void {
        self.result.deinit(self.allocator);
        self.errors.deinit(self.allocator);
    }

    /// Parse the Sandboxfile and return the result
    pub fn parse(self: *Parser) ParseError!Sandboxfile {
        var lines = std.mem.splitScalar(u8, self.source, '\n');

        while (lines.next()) |raw_line| {
            self.line_number += 1;

            // Handle CRLF line endings
            const line = if (raw_line.len > 0 and raw_line[raw_line.len - 1] == '\r')
                raw_line[0 .. raw_line.len - 1]
            else
                raw_line;

            // Skip empty lines and comments
            const trimmed = std.mem.trim(u8, line, " \t");
            if (trimmed.len == 0 or trimmed[0] == '#') continue;

            try self.parseLine(trimmed);
        }

        return self.result;
    }

    fn parseLine(self: *Parser, line: []const u8) ParseError!void {
        // Find the directive (first word)
        const space_idx = std.mem.indexOfAny(u8, line, " \t");
        const directive = if (space_idx) |idx| line[0..idx] else line;
        const rest = if (space_idx) |idx| std.mem.trimLeft(u8, line[idx..], " \t") else "";

        if (std.mem.eql(u8, directive, "FROM")) {
            try self.parseFrom(rest);
        } else if (std.mem.eql(u8, directive, "WORKDIR")) {
            try self.parseWorkdir(rest);
        } else if (std.mem.eql(u8, directive, "RUN")) {
            try self.parseRun(rest);
        } else if (std.mem.eql(u8, directive, "DEV")) {
            try self.parseDev(rest);
        } else if (std.mem.eql(u8, directive, "SERVICE")) {
            try self.parseService(rest);
        } else if (std.mem.eql(u8, directive, "TEST")) {
            try self.parseTest(rest);
        } else if (std.mem.eql(u8, directive, "OUTPUT")) {
            try self.parseOutput(rest);
        } else if (std.mem.eql(u8, directive, "LOGS")) {
            try self.parseLogs(rest);
        } else if (std.mem.eql(u8, directive, "NET")) {
            try self.parseNet(rest);
        } else if (std.mem.eql(u8, directive, "SECRET")) {
            try self.parseSecret(rest);
        } else if (std.mem.eql(u8, directive, "INFER")) {
            try self.parseInfer(rest);
        } else {
            try self.addError("Unknown directive");
            return ParseError.InvalidDirective;
        }
    }

    fn parseFrom(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("FROM requires an argument (e.g., 'host' or an image name)");
            return ParseError.MissingArgument;
        }

        if (std.mem.eql(u8, rest, "host")) {
            self.result.base_env = .host;
        } else {
            self.result.base_env = .{ .image = rest };
        }
    }

    fn parseWorkdir(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("WORKDIR requires a path argument");
            return ParseError.MissingArgument;
        }
        self.result.workdir = rest;
    }

    fn parseRun(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("RUN requires a command");
            return ParseError.MissingArgument;
        }
        try self.result.run_commands.append(self.allocator, .{ .command = rest });
    }

    fn parseDev(self: *Parser, rest: []const u8) ParseError!void {
        var dev = DevDirective{
            .name = null,
            .port = null,
            .watch = null,
            .command = "",
        };

        var remaining = rest;

        // Parse optional key=value pairs before the command
        while (remaining.len > 0) {
            const parsed = self.parseKeyValueOrToken(remaining);
            if (parsed.key_value) |kv| {
                if (std.mem.eql(u8, kv.key, "PORT")) {
                    dev.port = std.fmt.parseInt(u16, kv.value, 10) catch {
                        try self.addError("Invalid port number");
                        return ParseError.InvalidPort;
                    };
                } else if (std.mem.eql(u8, kv.key, "WATCH")) {
                    dev.watch = kv.value;
                } else {
                    // Not a recognized key=value, treat as start of command
                    break;
                }
                remaining = parsed.rest;
            } else {
                // Not a key=value, must be the command
                break;
            }
        }

        remaining = std.mem.trimLeft(u8, remaining, " \t");
        if (remaining.len == 0) {
            try self.addError("DEV requires a command");
            return ParseError.MissingArgument;
        }
        dev.command = remaining;
        self.result.dev = dev;
    }

    fn parseService(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("SERVICE requires a name and command");
            return ParseError.MissingArgument;
        }

        // First token is the service name
        const space_idx = std.mem.indexOfAny(u8, rest, " \t");
        const name = if (space_idx) |idx| rest[0..idx] else {
            try self.addError("SERVICE requires a command after the name");
            return ParseError.MissingArgument;
        };

        var service = ServiceDirective{
            .name = name,
            .port = null,
            .watch = null,
            .command = "",
        };

        var remaining = std.mem.trimLeft(u8, rest[space_idx.?..], " \t");

        // Parse optional key=value pairs before the command
        while (remaining.len > 0) {
            const parsed = self.parseKeyValueOrToken(remaining);
            if (parsed.key_value) |kv| {
                if (std.mem.eql(u8, kv.key, "PORT")) {
                    service.port = std.fmt.parseInt(u16, kv.value, 10) catch {
                        try self.addError("Invalid port number");
                        return ParseError.InvalidPort;
                    };
                } else if (std.mem.eql(u8, kv.key, "WATCH")) {
                    service.watch = kv.value;
                } else {
                    // Not a recognized key=value, treat as start of command
                    break;
                }
                remaining = parsed.rest;
            } else {
                // Not a key=value, must be the command
                break;
            }
        }

        remaining = std.mem.trimLeft(u8, remaining, " \t");
        if (remaining.len == 0) {
            try self.addError("SERVICE requires a command");
            return ParseError.MissingArgument;
        }
        service.command = remaining;
        try self.result.services.append(self.allocator, service);
    }

    fn parseTest(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("TEST requires a command");
            return ParseError.MissingArgument;
        }

        try self.result.tests.append(self.allocator, .{
            .name = null,
            .command = rest,
        });
    }

    fn parseOutput(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("OUTPUT requires a path");
            return ParseError.MissingArgument;
        }
        try self.result.outputs.append(self.allocator, rest);
    }

    fn parseLogs(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("LOGS requires a path pattern");
            return ParseError.MissingArgument;
        }
        try self.result.logs.append(self.allocator, rest);
    }

    fn parseNet(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("NET requires a host");
            return ParseError.MissingArgument;
        }
        try self.result.allowed_hosts.append(self.allocator, rest);
    }

    fn parseSecret(self: *Parser, rest: []const u8) ParseError!void {
        if (rest.len == 0) {
            try self.addError("SECRET requires an environment variable name");
            return ParseError.MissingArgument;
        }
        try self.result.secrets.append(self.allocator, rest);
    }

    fn parseInfer(self: *Parser, rest: []const u8) ParseError!void {
        self.result.infer_enabled = true;
        if (rest.len > 0) {
            self.result.infer_pattern = rest;
        } else {
            self.result.infer_pattern = "*";
        }
    }

    const ParsedKeyValue = struct {
        key_value: ?KeyValue,
        rest: []const u8,
    };

    /// Try to parse a KEY=VALUE token from the beginning of the string.
    /// Returns the key-value pair if found, and the remaining string.
    fn parseKeyValueOrToken(self: *Parser, input: []const u8) ParsedKeyValue {
        _ = self;
        const trimmed = std.mem.trimLeft(u8, input, " \t");
        if (trimmed.len == 0) return .{ .key_value = null, .rest = "" };

        // Find the end of this token (space or tab)
        const token_end = std.mem.indexOfAny(u8, trimmed, " \t") orelse trimmed.len;
        const token = trimmed[0..token_end];

        // Check if this token contains '='
        if (std.mem.indexOfScalar(u8, token, '=')) |eq_idx| {
            const key = token[0..eq_idx];
            const value = token[eq_idx + 1 ..];

            // Only treat as key=value if key is uppercase (like PORT, WATCH)
            var is_uppercase_key = true;
            for (key) |c| {
                if (c < 'A' or c > 'Z') {
                    if (c != '_') {
                        is_uppercase_key = false;
                        break;
                    }
                }
            }

            if (is_uppercase_key and key.len > 0) {
                return .{
                    .key_value = .{ .key = key, .value = value },
                    .rest = if (token_end < trimmed.len) trimmed[token_end..] else "",
                };
            }
        }

        return .{ .key_value = null, .rest = trimmed };
    }

    fn addError(self: *Parser, message: []const u8) ParseError!void {
        try self.errors.append(self.allocator, .{
            .line = self.line_number,
            .message = message,
        });
    }

    /// Get all parsing errors
    pub fn getErrors(self: *const Parser) []const ParseErrorInfo {
        return self.errors.items;
    }
};

/// Parse a Sandboxfile from source text
pub fn parse(allocator: Allocator, source: []const u8) ParseError!Sandboxfile {
    var parser = Parser.init(allocator, source);
    return parser.parse();
}

/// Parse a Sandboxfile from a file path
pub fn parseFile(allocator: Allocator, path: []const u8) !Sandboxfile {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    const source = try file.readToEndAlloc(allocator, 1024 * 1024); // 1MB max
    defer allocator.free(source);

    return parse(allocator, source);
}

// Tests
test "parse basic Sandboxfile" {
    const source =
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

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqual(BaseEnv.host, result.base_env);
    try std.testing.expectEqualStrings(".", result.workdir);

    try std.testing.expectEqual(@as(usize, 1), result.run_commands.items.len);
    try std.testing.expectEqualStrings("bun install", result.run_commands.items[0].command);

    try std.testing.expect(result.dev != null);
    try std.testing.expectEqual(@as(u16, 3000), result.dev.?.port.?);
    try std.testing.expectEqualStrings("src/**", result.dev.?.watch.?);
    try std.testing.expectEqualStrings("bun run dev", result.dev.?.command);

    try std.testing.expectEqual(@as(usize, 2), result.services.items.len);
    try std.testing.expectEqualStrings("db", result.services.items[0].name);
    try std.testing.expectEqual(@as(u16, 5432), result.services.items[0].port.?);
    try std.testing.expectEqualStrings("docker compose up postgres", result.services.items[0].command);

    try std.testing.expectEqualStrings("redis", result.services.items[1].name);
    try std.testing.expectEqual(@as(u16, 6379), result.services.items[1].port.?);
    try std.testing.expectEqualStrings("redis-server", result.services.items[1].command);

    try std.testing.expectEqual(@as(usize, 1), result.tests.items.len);
    try std.testing.expectEqualStrings("bun test", result.tests.items[0].command);

    try std.testing.expectEqual(@as(usize, 3), result.outputs.items.len);
    try std.testing.expectEqualStrings("src/", result.outputs.items[0]);
    try std.testing.expectEqualStrings("tests/", result.outputs.items[1]);
    try std.testing.expectEqualStrings("package.json", result.outputs.items[2]);

    try std.testing.expectEqual(@as(usize, 1), result.logs.items.len);
    try std.testing.expectEqualStrings("logs/*", result.logs.items[0]);

    try std.testing.expectEqual(@as(usize, 2), result.allowed_hosts.items.len);
    try std.testing.expectEqualStrings("registry.npmjs.org", result.allowed_hosts.items[0]);
    try std.testing.expectEqualStrings("api.stripe.com", result.allowed_hosts.items[1]);

    try std.testing.expectEqual(@as(usize, 1), result.secrets.items.len);
    try std.testing.expectEqualStrings("STRIPE_API_KEY", result.secrets.items[0]);
}

test "parse INFER shorthand" {
    const source =
        \\FROM host
        \\WORKDIR .
        \\INFER *
    ;

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expect(result.infer_enabled);
    try std.testing.expectEqualStrings("*", result.infer_pattern.?);
}

test "parse FROM with image" {
    const source =
        \\FROM node:18-alpine
        \\WORKDIR /app
    ;

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqualStrings("node:18-alpine", result.base_env.image);
    try std.testing.expectEqualStrings("/app", result.workdir);
}

test "parse multiple RUN commands" {
    const source =
        \\FROM host
        \\RUN apt-get update
        \\RUN apt-get install -y curl
        \\RUN bun install
    ;

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqual(@as(usize, 3), result.run_commands.items.len);
    try std.testing.expectEqualStrings("apt-get update", result.run_commands.items[0].command);
    try std.testing.expectEqualStrings("apt-get install -y curl", result.run_commands.items[1].command);
    try std.testing.expectEqualStrings("bun install", result.run_commands.items[2].command);
}

test "parse DEV without options" {
    const source =
        \\FROM host
        \\DEV npm start
    ;

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expect(result.dev != null);
    try std.testing.expect(result.dev.?.port == null);
    try std.testing.expect(result.dev.?.watch == null);
    try std.testing.expectEqualStrings("npm start", result.dev.?.command);
}

test "handles CRLF line endings" {
    const source = "FROM host\r\nWORKDIR .\r\nRUN bun install\r\n";

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqual(BaseEnv.host, result.base_env);
    try std.testing.expectEqualStrings(".", result.workdir);
    try std.testing.expectEqual(@as(usize, 1), result.run_commands.items.len);
}

test "skips comments and empty lines" {
    const source =
        \\# This is a comment
        \\FROM host
        \\
        \\# Another comment
        \\WORKDIR .
        \\
    ;

    var result = try parse(std.testing.allocator, source);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqual(BaseEnv.host, result.base_env);
    try std.testing.expectEqualStrings(".", result.workdir);
}
