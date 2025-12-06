// Sandboxfile: A declarative spec for agent sandboxes
//
// Example:
// ```
// # Sandboxfile
//
// FROM host
// WORKDIR .
//
// RUN bun install
//
// DEV PORT=3000 WATCH=src/** bun run dev
// SERVICE db PORT=5432 docker compose up postgres
// SERVICE redis PORT=6379 redis-server
// TEST bun test
//
// OUTPUT src/
// OUTPUT tests/
// OUTPUT package.json
//
// LOGS logs/*
//
// NET registry.npmjs.org
// NET api.stripe.com
//
// SECRET STRIPE_API_KEY
// ```
//
// Directives:
// - FROM — base environment (host or an image)
// - WORKDIR — project root
// - RUN — setup commands (once per agent)
// - DEV — primary dev server (optional name, supports PORT, WATCH)
// - SERVICE — background process (required name, supports PORT, WATCH)
// - TEST — verification command (optional name, same syntax)
// - OUTPUT — files extracted from agent (everything else is ephemeral)
// - LOGS — log streams agent can tail
// - NET — allowed external hosts (default deny-all, services implicitly allowed)
// - SECRET — env vars agent can use but not inspect
// - INFER — auto-generate lockfile from repo analysis

const std = @import("std");
const bun = @import("root").bun;
const logger = bun.logger;
const strings = bun.strings;

const string = []const u8;
const Allocator = std.mem.Allocator;
const OOM = bun.OOM;

/// Represents a parsed Sandboxfile
pub const Sandboxfile = struct {
    /// Base environment (e.g., "host" or a container image)
    from: ?[]const u8 = null,

    /// Project root directory
    workdir: ?[]const u8 = null,

    /// Setup commands to run once per agent
    run_commands: std.ArrayListUnmanaged([]const u8) = .{},

    /// Primary dev server configuration
    dev: ?Process = null,

    /// Background services
    services: std.ArrayListUnmanaged(Process) = .{},

    /// Test commands
    tests: std.ArrayListUnmanaged(Process) = .{},

    /// Files/directories to extract from agent
    outputs: std.ArrayListUnmanaged([]const u8) = .{},

    /// Log file patterns agent can tail
    logs: std.ArrayListUnmanaged([]const u8) = .{},

    /// Allowed external network hosts
    net_hosts: std.ArrayListUnmanaged([]const u8) = .{},

    /// Environment variables agent can use but not inspect
    secrets: std.ArrayListUnmanaged([]const u8) = .{},

    /// INFER directive patterns (for auto-generation)
    infer_patterns: std.ArrayListUnmanaged([]const u8) = .{},

    /// Represents a process (DEV, SERVICE, or TEST)
    pub const Process = struct {
        /// Process name (required for SERVICE, optional for DEV/TEST)
        name: ?[]const u8 = null,
        /// Port number if specified
        port: ?u16 = null,
        /// File watch patterns
        watch: ?[]const u8 = null,
        /// Command to execute
        command: []const u8,

        pub fn format(self: Process, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = fmt;
            _ = options;
            try writer.writeAll("Process{ ");
            if (self.name) |n| {
                try writer.print("name=\"{s}\", ", .{n});
            }
            if (self.port) |p| {
                try writer.print("port={d}, ", .{p});
            }
            if (self.watch) |w| {
                try writer.print("watch=\"{s}\", ", .{w});
            }
            try writer.print("command=\"{s}\" }}", .{self.command});
        }
    };

    pub fn deinit(self: *Sandboxfile, allocator: Allocator) void {
        self.run_commands.deinit(allocator);
        self.services.deinit(allocator);
        self.tests.deinit(allocator);
        self.outputs.deinit(allocator);
        self.logs.deinit(allocator);
        self.net_hosts.deinit(allocator);
        self.secrets.deinit(allocator);
        self.infer_patterns.deinit(allocator);
    }

    pub fn format(self: Sandboxfile, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
        _ = fmt;
        _ = options;
        try writer.writeAll("Sandboxfile {\n");
        if (self.from) |f| try writer.print("  from: \"{s}\"\n", .{f});
        if (self.workdir) |w| try writer.print("  workdir: \"{s}\"\n", .{w});

        if (self.run_commands.items.len > 0) {
            try writer.writeAll("  run_commands: [\n");
            for (self.run_commands.items) |cmd| {
                try writer.print("    \"{s}\"\n", .{cmd});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.dev) |dev| {
            try writer.print("  dev: {}\n", .{dev});
        }

        if (self.services.items.len > 0) {
            try writer.writeAll("  services: [\n");
            for (self.services.items) |svc| {
                try writer.print("    {}\n", .{svc});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.tests.items.len > 0) {
            try writer.writeAll("  tests: [\n");
            for (self.tests.items) |t| {
                try writer.print("    {}\n", .{t});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.outputs.items.len > 0) {
            try writer.writeAll("  outputs: [\n");
            for (self.outputs.items) |o| {
                try writer.print("    \"{s}\"\n", .{o});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.logs.items.len > 0) {
            try writer.writeAll("  logs: [\n");
            for (self.logs.items) |l| {
                try writer.print("    \"{s}\"\n", .{l});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.net_hosts.items.len > 0) {
            try writer.writeAll("  net_hosts: [\n");
            for (self.net_hosts.items) |n| {
                try writer.print("    \"{s}\"\n", .{n});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.secrets.items.len > 0) {
            try writer.writeAll("  secrets: [\n");
            for (self.secrets.items) |s| {
                try writer.print("    \"{s}\"\n", .{s});
            }
            try writer.writeAll("  ]\n");
        }

        if (self.infer_patterns.items.len > 0) {
            try writer.writeAll("  infer: [\n");
            for (self.infer_patterns.items) |i| {
                try writer.print("    \"{s}\"\n", .{i});
            }
            try writer.writeAll("  ]\n");
        }

        try writer.writeAll("}\n");
    }
};

/// Parser for Sandboxfile format
pub const Parser = struct {
    source: logger.Source,
    src: []const u8,
    log: logger.Log,
    allocator: Allocator,
    result: Sandboxfile = .{},

    const whitespace_chars = " \t";
    const line_terminators = "\n\r";

    pub const Directive = enum {
        FROM,
        WORKDIR,
        RUN,
        DEV,
        SERVICE,
        TEST,
        OUTPUT,
        LOGS,
        NET,
        SECRET,
        INFER,
    };

    pub fn init(allocator: Allocator, path: []const u8, src: []const u8) Parser {
        return .{
            .log = logger.Log.init(allocator),
            .src = src,
            .source = logger.Source.initPathString(path, src),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Parser) void {
        self.log.deinit();
        self.result.deinit(self.allocator);
    }

    /// Parse the Sandboxfile and return the result
    pub fn parse(self: *Parser) OOM!Sandboxfile {
        var iter = std.mem.splitScalar(u8, self.src, '\n');

        while (iter.next()) |line_raw| {
            // Handle Windows line endings
            const line_trimmed = if (line_raw.len > 0 and line_raw[line_raw.len - 1] == '\r')
                line_raw[0 .. line_raw.len - 1]
            else
                line_raw;

            // Trim leading/trailing whitespace
            const line = std.mem.trim(u8, line_trimmed, whitespace_chars);

            // Skip empty lines and comments
            if (line.len == 0 or line[0] == '#') continue;

            try self.parseLine(line);
        }

        return self.result;
    }

    fn parseLine(self: *Parser, line: []const u8) OOM!void {
        // Find the directive (first word)
        const first_space = std.mem.indexOfAny(u8, line, whitespace_chars);
        const directive_str = if (first_space) |idx| line[0..idx] else line;
        const rest = if (first_space) |idx|
            std.mem.trimLeft(u8, line[idx..], whitespace_chars)
        else
            "";

        // Parse directive
        const directive = std.meta.stringToEnum(Directive, directive_str) orelse {
            // Unknown directive - add error
            self.log.addWarningFmt(
                self.allocator,
                self.source,
                logger.Loc{ .start = 0 },
                "Unknown directive: {s}",
                .{directive_str},
            ) catch {};
            return;
        };

        switch (directive) {
            .FROM => {
                self.result.from = rest;
            },
            .WORKDIR => {
                self.result.workdir = rest;
            },
            .RUN => {
                try self.result.run_commands.append(self.allocator, rest);
            },
            .DEV => {
                self.result.dev = try self.parseProcess(rest, false);
            },
            .SERVICE => {
                const process = try self.parseProcess(rest, true);
                try self.result.services.append(self.allocator, process);
            },
            .TEST => {
                const process = try self.parseProcess(rest, false);
                try self.result.tests.append(self.allocator, process);
            },
            .OUTPUT => {
                try self.result.outputs.append(self.allocator, rest);
            },
            .LOGS => {
                try self.result.logs.append(self.allocator, rest);
            },
            .NET => {
                try self.result.net_hosts.append(self.allocator, rest);
            },
            .SECRET => {
                try self.result.secrets.append(self.allocator, rest);
            },
            .INFER => {
                try self.result.infer_patterns.append(self.allocator, rest);
            },
        }
    }

    /// Parse a process line (DEV, SERVICE, or TEST)
    /// Format: [name] [KEY=VALUE]... command
    ///
    /// For SERVICE: name is always required (first token)
    /// For DEV/TEST: name is optional, detected when first token is followed by KEY=VALUE
    fn parseProcess(self: *Parser, line: []const u8, require_name: bool) OOM!Sandboxfile.Process {
        var result: Sandboxfile.Process = .{ .command = "" };
        var remaining = line;
        var token_index: usize = 0;

        // For optional names (DEV/TEST): name must come BEFORE any KEY=VALUE pairs
        // For required names (SERVICE): name is always the first token

        // First, check if the first token is a name
        if (remaining.len > 0) {
            const first_space = std.mem.indexOfAny(u8, remaining, whitespace_chars);
            const first_token = if (first_space) |idx| remaining[0..idx] else remaining;
            const after_first = if (first_space) |idx|
                std.mem.trimLeft(u8, remaining[idx..], whitespace_chars)
            else
                "";

            const first_has_eq = std.mem.indexOfScalar(u8, first_token, '=') != null;

            if (require_name) {
                // For SERVICE, the first token is always the name
                result.name = first_token;
                remaining = after_first;
                token_index = 1;
            } else if (!first_has_eq and isIdentifier(first_token) and after_first.len > 0) {
                // For DEV/TEST, check if first token could be a name
                // It's a name only if:
                // 1. It's an identifier (no special chars)
                // 2. It's NOT a KEY=VALUE pair
                // 3. The second token IS a KEY=VALUE pair
                const second_space = std.mem.indexOfAny(u8, after_first, whitespace_chars);
                const second_token = if (second_space) |idx| after_first[0..idx] else after_first;
                const second_has_eq = std.mem.indexOfScalar(u8, second_token, '=') != null;

                if (second_has_eq) {
                    // First token is a name, second is KEY=VALUE
                    result.name = first_token;
                    remaining = after_first;
                    token_index = 1;
                }
            }
        }

        // Parse KEY=VALUE pairs and command
        while (remaining.len > 0) {
            const next_space = std.mem.indexOfAny(u8, remaining, whitespace_chars);
            const token = if (next_space) |idx| remaining[0..idx] else remaining;
            const after = if (next_space) |idx|
                std.mem.trimLeft(u8, remaining[idx..], whitespace_chars)
            else
                "";

            // Check if this is a KEY=VALUE pair
            if (std.mem.indexOfScalar(u8, token, '=')) |eq_idx| {
                const key = token[0..eq_idx];
                const value = token[eq_idx + 1 ..];

                if (strings.eqlComptime(key, "PORT")) {
                    result.port = std.fmt.parseInt(u16, value, 10) catch null;
                } else if (strings.eqlComptime(key, "WATCH")) {
                    result.watch = value;
                }
                // Unknown KEY=VALUE pairs are ignored

                remaining = after;
                token_index += 1;
                continue;
            }

            // Everything remaining is the command
            result.command = remaining;
            break;
        }

        _ = self;
        return result;
    }

    fn isIdentifier(s: []const u8) bool {
        if (s.len == 0) return false;
        for (s) |c| {
            switch (c) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-' => continue,
                else => return false,
            }
        }
        return true;
    }
};

/// Load and parse a Sandboxfile from a file path
pub fn load(allocator: Allocator, path: []const u8) !Sandboxfile {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    const stat = try file.stat();
    const content = try allocator.alloc(u8, stat.size);
    errdefer allocator.free(content);

    const bytes_read = try file.readAll(content);
    if (bytes_read != stat.size) {
        return error.IncompleteRead;
    }

    var parser = Parser.init(allocator, path, content);
    errdefer parser.deinit();

    return try parser.parse();
}

/// Parse a Sandboxfile from a string
pub fn parseString(allocator: Allocator, content: []const u8) OOM!Sandboxfile {
    var parser = Parser.init(allocator, "<string>", content);
    // Note: caller owns the result, parser.result is moved
    defer parser.log.deinit();

    return try parser.parse();
}

test "parse simple sandboxfile" {
    const content =
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

    var result = try parseString(std.testing.allocator, content);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqualStrings("host", result.from.?);
    try std.testing.expectEqualStrings(".", result.workdir.?);
    try std.testing.expectEqual(@as(usize, 1), result.run_commands.items.len);
    try std.testing.expectEqualStrings("bun install", result.run_commands.items[0]);

    // DEV
    try std.testing.expect(result.dev != null);
    try std.testing.expectEqual(@as(u16, 3000), result.dev.?.port.?);
    try std.testing.expectEqualStrings("src/**", result.dev.?.watch.?);
    try std.testing.expectEqualStrings("bun run dev", result.dev.?.command);

    // SERVICES
    try std.testing.expectEqual(@as(usize, 2), result.services.items.len);
    try std.testing.expectEqualStrings("db", result.services.items[0].name.?);
    try std.testing.expectEqual(@as(u16, 5432), result.services.items[0].port.?);
    try std.testing.expectEqualStrings("docker compose up postgres", result.services.items[0].command);
    try std.testing.expectEqualStrings("redis", result.services.items[1].name.?);
    try std.testing.expectEqual(@as(u16, 6379), result.services.items[1].port.?);
    try std.testing.expectEqualStrings("redis-server", result.services.items[1].command);

    // TEST
    try std.testing.expectEqual(@as(usize, 1), result.tests.items.len);
    try std.testing.expectEqualStrings("bun test", result.tests.items[0].command);

    // OUTPUTS
    try std.testing.expectEqual(@as(usize, 3), result.outputs.items.len);
    try std.testing.expectEqualStrings("src/", result.outputs.items[0]);
    try std.testing.expectEqualStrings("tests/", result.outputs.items[1]);
    try std.testing.expectEqualStrings("package.json", result.outputs.items[2]);

    // LOGS
    try std.testing.expectEqual(@as(usize, 1), result.logs.items.len);
    try std.testing.expectEqualStrings("logs/*", result.logs.items[0]);

    // NET
    try std.testing.expectEqual(@as(usize, 2), result.net_hosts.items.len);
    try std.testing.expectEqualStrings("registry.npmjs.org", result.net_hosts.items[0]);
    try std.testing.expectEqualStrings("api.stripe.com", result.net_hosts.items[1]);

    // SECRET
    try std.testing.expectEqual(@as(usize, 1), result.secrets.items.len);
    try std.testing.expectEqualStrings("STRIPE_API_KEY", result.secrets.items[0]);
}

test "parse infer shorthand" {
    const content =
        \\FROM host
        \\WORKDIR .
        \\INFER *
    ;

    var result = try parseString(std.testing.allocator, content);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqualStrings("host", result.from.?);
    try std.testing.expectEqualStrings(".", result.workdir.?);
    try std.testing.expectEqual(@as(usize, 1), result.infer_patterns.items.len);
    try std.testing.expectEqualStrings("*", result.infer_patterns.items[0]);
}

test "parse empty lines and comments" {
    const content =
        \\# This is a comment
        \\
        \\FROM host
        \\
        \\# Another comment
        \\WORKDIR /app
        \\
    ;

    var result = try parseString(std.testing.allocator, content);
    defer result.deinit(std.testing.allocator);

    try std.testing.expectEqualStrings("host", result.from.?);
    try std.testing.expectEqualStrings("/app", result.workdir.?);
}

test "parse process with optional name" {
    // Name is detected when it's the first token followed by a KEY=VALUE pair
    const content =
        \\DEV mydev PORT=8080 npm start
        \\TEST unit PORT=0 bun test unit
        \\TEST bun test
    ;

    var result = try parseString(std.testing.allocator, content);
    defer result.deinit(std.testing.allocator);

    try std.testing.expect(result.dev != null);
    try std.testing.expectEqualStrings("mydev", result.dev.?.name.?);
    try std.testing.expectEqual(@as(u16, 8080), result.dev.?.port.?);
    try std.testing.expectEqualStrings("npm start", result.dev.?.command);

    try std.testing.expectEqual(@as(usize, 2), result.tests.items.len);
    try std.testing.expectEqualStrings("unit", result.tests.items[0].name.?);
    try std.testing.expectEqual(@as(u16, 0), result.tests.items[0].port.?);
    try std.testing.expectEqualStrings("bun test unit", result.tests.items[0].command);
    try std.testing.expect(result.tests.items[1].name == null);
    try std.testing.expectEqualStrings("bun test", result.tests.items[1].command);
}
