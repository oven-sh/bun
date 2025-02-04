const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const E = bun.JSAst.E;
const Expr = bun.JSAst.Expr;
const Loc = bun.logger.Loc;
const js_ast = bun.JSAst;
const Rope = js_ast.E.Object.Rope;
const Output = bun.Output;
const Global = bun.Global;
const Registry = bun.install.Npm.Registry;
const OOM = bun.OOM;

pub const Parser = struct {
    opts: Options = .{},
    source: bun.logger.Source,
    src: []const u8,
    out: Expr,
    logger: bun.logger.Log,
    arena: std.heap.ArenaAllocator,
    env: *bun.DotEnv.Loader,

    const Options = struct {
        bracked_array: bool = true,
    };

    pub fn init(allocator: Allocator, path: []const u8, src: []const u8, env: *bun.DotEnv.Loader) Parser {
        return .{
            .logger = bun.logger.Log.init(allocator),
            .src = src,
            .out = Expr.init(E.Object, E.Object{}, Loc.Empty),
            .source = bun.logger.Source.initPathString(path, src),
            .arena = std.heap.ArenaAllocator.init(allocator),
            .env = env,
        };
    }

    pub fn deinit(this: *Parser) void {
        this.logger.deinit();
        this.arena.deinit();
    }

    inline fn shouldSkipLine(line: []const u8) bool {
        if (line.len == 0 or
            // comments
            line[0] == ';' or
            line[0] == '#') return true;

        // check the rest is whitespace
        for (line) |c| {
            switch (c) {
                ' ', '\t', '\n', '\r' => {},
                '#', ';' => return true,
                else => return false,
            }
        }
        return true;
    }

    fn parse(this: *Parser, arena_allocator: Allocator) OOM!void {
        var iter = std.mem.splitScalar(u8, this.src, '\n');
        var head: *E.Object = this.out.data.e_object;

        // var duplicates = bun.StringArrayHashMapUnmanaged(u32){};
        // defer duplicates.deinit(allocator);

        var rope_stack = std.heap.stackFallback(@sizeOf(Rope) * 6, arena_allocator);
        const ropealloc = rope_stack.get();

        var skip_until_next_section: bool = false;

        while (iter.next()) |line_| {
            const line = if (line_.len > 0 and line_[line_.len - 1] == '\r') line_[0 .. line_.len - 1] else line_;
            if (shouldSkipLine(line)) continue;

            // Section
            // [foo]
            if (line[0] == '[') treat_as_key: {
                skip_until_next_section = false;
                const close_bracket_idx = std.mem.indexOfScalar(u8, line[0..], ']') orelse continue;
                // Make sure the rest is just whitespace
                if (close_bracket_idx + 1 < line.len) {
                    for (line[close_bracket_idx + 1 ..]) |c| if (switch (c) {
                        ' ', '\t' => false,
                        else => true,
                    }) break :treat_as_key;
                }
                const section: *Rope = try this.prepareStr(arena_allocator, ropealloc, line[1..close_bracket_idx], @as(i32, @intCast(@intFromPtr(line.ptr) - @intFromPtr(this.src.ptr))) + 1, .section);
                defer rope_stack.fixed_buffer_allocator.reset();
                const parent_object = this.out.data.e_object.getOrPutObject(section, arena_allocator) catch |e| switch (e) {
                    error.OutOfMemory => |oom| return oom,
                    error.Clobber => {
                        // We're in here if key exists but it is not an object
                        //
                        // This is possible if someone did:
                        //
                        // ```ini
                        // foo = 'bar'
                        //
                        // [foo]
                        // hello = 420
                        // ```
                        //
                        // In the above case, `this.out[section]` would be a string.
                        // So what should we do in that case?
                        //
                        // npm/ini's will chug along happily trying to assign keys to the string.
                        //
                        // In JS assigning keys to string does nothing.
                        //
                        // Technically, this would have an effect if the value was an array:
                        //
                        // ```ini
                        // foo[] = 0
                        // foo[] = 1
                        //
                        // [foo]
                        // 0 = 420
                        // ```
                        //
                        // This would result in `foo` being `[420, 1]`.
                        //
                        // To be honest this is kind of crazy behavior so we're just going to skip this for now.
                        skip_until_next_section = true;
                        continue;
                    },
                };
                head = parent_object.data.e_object;
                continue;
            }
            if (skip_until_next_section) continue;

            // Otherwise it's a key val here

            const line_offset: i32 = @intCast(@intFromPtr(line.ptr) - @intFromPtr(this.src.ptr));

            const maybe_eq_sign_idx = std.mem.indexOfScalar(u8, line, '=');

            const key_raw: []const u8 = try this.prepareStr(arena_allocator, ropealloc, line[0 .. maybe_eq_sign_idx orelse line.len], line_offset, .key);
            const is_array: bool = brk: {
                break :brk key_raw.len > 2 and bun.strings.endsWith(key_raw, "[]");
                // Commenting out because options are not supported but we might
                // support them.
                // if (this.opts.bracked_array) {
                //     break :brk key_raw.len > 2 and bun.strings.endsWith(key_raw, "[]");
                // } else {
                //     // const gop = try duplicates.getOrPut(allocator, key_raw);
                //     // if (gop.found_existing) {
                //     //     gop.value_ptr.* = 1;
                //     // } else gop.value_ptr.* += 1;
                //     // break :brk gop.value_ptr.* > 1;
                //     @panic("We don't support this right now");
                // }
            };

            const key = if (is_array and bun.strings.endsWith(key_raw, "[]"))
                key_raw[0 .. key_raw.len - 2]
            else
                key_raw;

            if (bun.strings.eqlComptime(key, "__proto__")) continue;

            const value_raw: Expr = brk: {
                if (maybe_eq_sign_idx) |eq_sign_idx| {
                    if (eq_sign_idx + 1 < line.len) break :brk try this.prepareStr(
                        arena_allocator,
                        ropealloc,
                        line[eq_sign_idx + 1 ..],
                        @intCast(line_offset + @as(i32, @intCast(eq_sign_idx)) + 1),
                        .value,
                    );
                    break :brk Expr.init(E.String, E.String{ .data = "" }, Loc.Empty);
                }
                break :brk Expr.init(E.Boolean, E.Boolean{ .value = true }, Loc.Empty);
            };

            const value: Expr = switch (value_raw.data) {
                .e_string => |s| if (bun.strings.eqlComptime(s.data, "true"))
                    Expr.init(E.Boolean, E.Boolean{ .value = true }, Loc.Empty)
                else if (bun.strings.eqlComptime(s.data, "false"))
                    Expr.init(E.Boolean, E.Boolean{ .value = false }, Loc.Empty)
                else if (bun.strings.eqlComptime(s.data, "null"))
                    Expr.init(E.Null, E.Null{}, Loc.Empty)
                else
                    value_raw,
                else => value_raw,
            };

            if (is_array) {
                if (head.get(key)) |val| {
                    if (val.data != .e_array) {
                        var arr = E.Array{};
                        try arr.push(arena_allocator, val);
                        try head.put(arena_allocator, key, Expr.init(E.Array, arr, Loc.Empty));
                    }
                } else {
                    try head.put(arena_allocator, key, Expr.init(E.Array, E.Array{}, Loc.Empty));
                }
            }

            // safeguard against resetting a previously defined
            // array by accidentally forgetting the brackets
            var was_already_array = false;
            if (head.get(key)) |val| {
                if (val.data == .e_array) {
                    was_already_array = true;
                    try val.data.e_array.push(arena_allocator, value);
                    try head.put(arena_allocator, key, val);
                }
            }
            if (!was_already_array) {
                try head.put(arena_allocator, key, value);
            }
        }
    }

    fn prepareStr(
        this: *Parser,
        arena_allocator: Allocator,
        ropealloc: Allocator,
        val_: []const u8,
        offset_: i32,
        comptime usage: enum { section, key, value },
    ) OOM!switch (usage) {
        .value => Expr,
        .section => *Rope,
        .key => []const u8,
    } {
        var offset = offset_;
        var val = std.mem.trim(u8, val_, " \n\r\t");

        if (isQuoted(val)) out: {
            // remove single quotes before calling JSON.parse
            if (val.len > 0 and val[0] == '\'') {
                val = if (val.len > 1) val[1 .. val.len - 1] else val[1..];
                offset += 1;
            }
            const src = bun.logger.Source.initPathString(this.source.path.text, val);
            var log = bun.logger.Log.init(arena_allocator);
            defer log.deinit();
            // Try to parse it and it if fails will just treat it as a string
            const json_val: Expr = bun.JSON.parseUTF8Impl(&src, &log, arena_allocator, true) catch {
                break :out;
            };

            if (json_val.asString(arena_allocator)) |str| {
                if (comptime usage == .value) return Expr.init(E.String, E.String.init(str), Loc{ .start = @intCast(offset) });
                if (comptime usage == .section) return strToRope(ropealloc, str);
                return str;
            }

            if (comptime usage == .value) return json_val;

            // unfortunately, we need to match npm/ini behavior here,
            // which requires us to turn these into a string,
            // same behavior as doing this:
            // ```
            // let foo = {}
            // const json_val = { hi: 'hello' }
            // foo[json_val] = 'nice'
            // ```
            switch (json_val.data) {
                .e_object => {
                    if (comptime usage == .section) return singleStrRope(ropealloc, "[Object object]");
                    return "[Object object]";
                },
                else => {
                    const str = try std.fmt.allocPrint(arena_allocator, "{}", .{ToStringFormatter{ .d = json_val.data }});
                    if (comptime usage == .section) return singleStrRope(ropealloc, str);
                    return str;
                },
            }
        } else {
            const STACK_BUF_SIZE = 1024;
            // walk the val to find the first non-escaped comment character (; or #)
            var did_any_escape: bool = false;
            var esc = false;
            var sfb = std.heap.stackFallback(STACK_BUF_SIZE, arena_allocator);
            var unesc = try std.ArrayList(u8).initCapacity(sfb.get(), STACK_BUF_SIZE);

            const RopeT = if (comptime usage == .section) *Rope else struct {};
            var rope: ?RopeT = if (comptime usage == .section) null else undefined;

            var i: usize = 0;
            while (i < val.len) : (i += 1) {
                const c = val[i];
                if (esc) {
                    switch (c) {
                        '\\' => try unesc.appendSlice(&[_]u8{'\\'}),
                        ';', '#', '$' => try unesc.append(c),
                        '.' => {
                            if (comptime usage == .section) {
                                try unesc.append('.');
                            } else {
                                try unesc.appendSlice("\\.");
                            }
                        },
                        else => {
                            try unesc.appendSlice(switch (bun.strings.utf8ByteSequenceLength(c)) {
                                1 => brk: {
                                    break :brk &[_]u8{ '\\', c };
                                },
                                2 => brk: {
                                    defer i += 1;
                                    break :brk &[_]u8{ '\\', c, val[i + 1] };
                                },
                                3 => brk: {
                                    defer i += 2;
                                    break :brk &[_]u8{ '\\', c, val[i + 1], val[i + 2] };
                                },
                                4 => brk: {
                                    defer i += 3;
                                    break :brk &[_]u8{ '\\', c, val[i + 1], val[i + 2], val[i + 3] };
                                },
                                // this means invalid utf8
                                else => unreachable,
                            });
                        },
                    }

                    esc = false;
                } else switch (c) {
                    '$' => {
                        not_env_substitution: {
                            if (comptime usage != .value) break :not_env_substitution;

                            if (try this.parseEnvSubstitution(val, i, i, &unesc)) |new_i| {
                                // set to true so we heap alloc
                                did_any_escape = true;
                                i = new_i;
                                continue;
                            }

                            break :not_env_substitution;
                        }
                        try unesc.append('$');
                    },
                    ';', '#' => break,
                    '\\' => {
                        esc = true;
                        did_any_escape = true;
                    },
                    '.' => {
                        if (comptime usage == .section) {
                            try this.commitRopePart(arena_allocator, ropealloc, &unesc, &rope);
                        } else {
                            try unesc.append('.');
                        }
                    },
                    else => try unesc.appendSlice(switch (bun.strings.utf8ByteSequenceLength(c)) {
                        1 => brk: {
                            break :brk &[_]u8{c};
                        },
                        2 => brk: {
                            defer i += 1;
                            break :brk &[_]u8{ c, val[i + 1] };
                        },
                        3 => brk: {
                            defer i += 2;
                            break :brk &[_]u8{ c, val[i + 1], val[i + 2] };
                        },
                        4 => brk: {
                            defer i += 3;
                            break :brk &[_]u8{ c, val[i + 1], val[i + 2], val[i + 3] };
                        },
                        // this means invalid utf8
                        else => unreachable,
                    }),
                }
            }

            if (esc)
                try unesc.append('\\');

            switch (usage) {
                .section => {
                    try this.commitRopePart(arena_allocator, ropealloc, &unesc, &rope);
                    return rope.?;
                },
                .value => {
                    if (!did_any_escape) return Expr.init(E.String, E.String.init(val[0..]), Loc{ .start = offset });
                    if (unesc.items.len <= STACK_BUF_SIZE) return Expr.init(
                        E.String,
                        E.String.init(try arena_allocator.dupe(u8, unesc.items[0..])),
                        Loc{ .start = offset },
                    );
                    return Expr.init(E.String, E.String.init(unesc.items[0..]), Loc{ .start = offset });
                },
                .key => {
                    const thestr: []const u8 = thestr: {
                        if (!did_any_escape) break :thestr try arena_allocator.dupe(u8, val[0..]);
                        if (unesc.items.len <= STACK_BUF_SIZE) break :thestr try arena_allocator.dupe(u8, unesc.items[0..]);
                        break :thestr unesc.items[0..];
                    };
                    return thestr;
                },
            }
        }
        if (comptime usage == .value) return Expr.init(E.String, E.String.init(val[0..]), Loc{ .start = offset });
        if (comptime usage == .key) return val[0..];
        return strToRope(ropealloc, val[0..]);
    }

    /// Returns index to skip or null if not an env substitution
    /// Invariants:
    /// - `i` must be an index into `val` that points to a '$' char
    ///
    /// npm/ini uses a regex pattern that will select the inner most ${...}
    fn parseEnvSubstitution(this: *Parser, val: []const u8, start: usize, i: usize, unesc: *std.ArrayList(u8)) OOM!?usize {
        bun.debugAssert(val[i] == '$');
        var esc = false;
        if (i + "{}".len < val.len and val[i + 1] == '{') {
            var found_closing = false;
            var j = i + 2;
            while (j < val.len) : (j += 1) {
                switch (val[j]) {
                    '\\' => esc = !esc,
                    '$' => if (!esc) return this.parseEnvSubstitution(val, start, j, unesc),
                    '{' => if (!esc) return null,
                    '}' => if (!esc) {
                        found_closing = true;
                        break;
                    },
                    else => {},
                }
            }

            if (!found_closing) return null;

            if (start != i) {
                const missed = val[start..i];
                try unesc.appendSlice(missed);
            }

            const env_var = val[i + 2 .. j];
            // https://github.com/npm/cli/blob/534ad7789e5c61f579f44d782bdd18ea3ff1ee20/workspaces/config/lib/env-replace.js#L6
            const expanded = this.env.get(env_var) orelse return null;
            try unesc.appendSlice(expanded);

            return j;
        }
        return null;
    }

    fn singleStrRope(ropealloc: Allocator, str: []const u8) OOM!*Rope {
        const rope = try ropealloc.create(Rope);
        rope.* = .{
            .head = Expr.init(E.String, E.String.init(str), Loc.Empty),
        };
        return rope;
    }

    fn nextDot(key: []const u8) ?usize {
        return std.mem.indexOfScalar(u8, key, '.');
    }

    fn commitRopePart(this: *Parser, arena_allocator: Allocator, ropealloc: Allocator, unesc: *std.ArrayList(u8), existing_rope: *?*Rope) OOM!void {
        _ = this; // autofix
        const slice = try arena_allocator.dupe(u8, unesc.items[0..]);
        const expr = Expr.init(E.String, E.String{ .data = slice }, Loc.Empty);
        if (existing_rope.*) |_r| {
            const r: *Rope = _r;
            _ = try r.append(expr, ropealloc);
        } else {
            existing_rope.* = try ropealloc.create(Rope);
            existing_rope.*.?.* = Rope{
                .head = expr,
            };
        }
        unesc.clearRetainingCapacity();
    }

    fn strToRope(ropealloc: Allocator, key: []const u8) OOM!*Rope {
        var dot_idx = nextDot(key) orelse {
            const rope = try ropealloc.create(Rope);
            rope.* = .{
                .head = Expr.init(E.String, E.String.init(key), Loc.Empty),
            };
            return rope;
        };
        var rope = try ropealloc.create(Rope);
        const head = rope;
        rope.* = .{
            .head = Expr.init(E.String, E.String.init(key[0..dot_idx]), Loc.Empty),
            .next = null,
        };

        while (dot_idx + 1 < key.len) {
            const next_dot_idx = dot_idx + 1 + (nextDot(key[dot_idx + 1 ..]) orelse {
                const rest = key[dot_idx + 1 ..];
                rope = try rope.append(Expr.init(E.String, E.String.init(rest), Loc.Empty), ropealloc);
                break;
            });
            const part = key[dot_idx + 1 .. next_dot_idx];
            rope = try rope.append(Expr.init(E.String, E.String.init(part), Loc.Empty), ropealloc);
            dot_idx = next_dot_idx;
        }

        return head;
    }

    fn isQuoted(val: []const u8) bool {
        return (bun.strings.startsWithChar(val, '"') and bun.strings.endsWithChar(val, '"')) or
            (bun.strings.startsWithChar(val, '\'') and bun.strings.endsWithChar(val, '\''));
    }
};

/// Used in JS tests, see `internal-for-testing.ts` and shell tests.
pub const IniTestingAPIs = struct {
    const JSC = bun.JSC;

    pub fn loadNpmrcFromJS(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const arg = callframe.argument(0);
        const npmrc_contents = arg.toBunString(globalThis);
        defer npmrc_contents.deref();
        const npmrc_utf8 = npmrc_contents.toUTF8(bun.default_allocator);
        defer npmrc_utf8.deinit();
        const source = bun.logger.Source.initPathString("<js>", npmrc_utf8.slice());

        var log = bun.logger.Log.init(bun.default_allocator);
        defer log.deinit();

        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        const allocator = arena.allocator();
        defer arena.deinit();

        const envjs = callframe.argument(1);
        const env = if (envjs.isEmptyOrUndefinedOrNull()) globalThis.bunVM().transpiler.env else brk: {
            var envmap = bun.DotEnv.Map.HashTable.init(allocator);
            var object_iter = try JSC.JSPropertyIterator(.{
                .skip_empty_name = false,
                .include_value = true,
            }).init(globalThis, envjs);
            defer object_iter.deinit();

            try envmap.ensureTotalCapacity(object_iter.len);

            while (try object_iter.next()) |key| {
                const keyslice = try key.toOwnedSlice(allocator);
                var value = object_iter.value;
                if (value == .undefined) continue;

                const value_str = value.getZigString(globalThis);
                const slice = try value_str.toOwnedSlice(allocator);

                envmap.put(keyslice, .{
                    .value = slice,
                    .conditional = false,
                }) catch return globalThis.throwOutOfMemoryValue();
            }

            const map = try allocator.create(bun.DotEnv.Map);
            map.* = .{
                .map = envmap,
            };

            const env = bun.DotEnv.Loader.init(map, allocator);
            const envstable = try allocator.create(bun.DotEnv.Loader);
            envstable.* = env;
            break :brk envstable;
        };

        const install = try allocator.create(bun.Schema.Api.BunInstall);
        install.* = std.mem.zeroes(bun.Schema.Api.BunInstall);
        var configs = std.ArrayList(ConfigIterator.Item).init(allocator);
        defer configs.deinit();
        loadNpmrc(allocator, install, env, ".npmrc", &log, &source, &configs) catch {
            return log.toJS(globalThis, allocator, "error");
        };

        const default_registry_url, const default_registry_token, const default_registry_username, const default_registry_password = brk: {
            const default_registry = install.default_registry orelse break :brk .{
                bun.String.static(Registry.default_url[0..]),
                bun.String.empty,
                bun.String.empty,
                bun.String.empty,
            };

            break :brk .{
                bun.String.fromBytes(default_registry.url),
                bun.String.fromBytes(default_registry.token),
                bun.String.fromBytes(default_registry.username),
                bun.String.fromBytes(default_registry.password),
            };
        };
        defer {
            default_registry_url.deref();
            default_registry_token.deref();
            default_registry_username.deref();
            default_registry_password.deref();
        }

        return JSC.JSObject.create(.{
            .default_registry_url = default_registry_url,
            .default_registry_token = default_registry_token,
            .default_registry_username = default_registry_username,
            .default_registry_password = default_registry_password,
        }, globalThis).toJS();
    }

    pub fn parse(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(1);
        const arguments = arguments_.slice();

        const jsstr = arguments[0];
        const bunstr = jsstr.toBunString(globalThis);
        defer bunstr.deref();
        const utf8str = bunstr.toUTF8(bun.default_allocator);
        defer utf8str.deinit();

        var parser = Parser.init(bun.default_allocator, "<src>", utf8str.slice(), globalThis.bunVM().transpiler.env);
        defer parser.deinit();

        try parser.parse(parser.arena.allocator());

        return parser.out.toJS(bun.default_allocator, globalThis) catch |e| {
            return globalThis.throwError(e, "failed to turn AST into JS");
        };
    }
};

pub const ToStringFormatter = struct {
    d: js_ast.Expr.Data,

    pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (this.d) {
            .e_array => {
                const last = this.d.e_array.items.len -| 1;
                for (this.d.e_array.items.slice(), 0..) |*e, i| {
                    const is_last = i == last;
                    try writer.print("{}{s}", .{ ToStringFormatter{ .d = e.data }, if (is_last) "" else "," });
                }
            },
            .e_object => try writer.print("[Object object]", .{}),
            .e_boolean => try writer.print("{s}", .{if (this.d.e_boolean.value) "true" else "false"}),
            .e_number => try writer.print("{d}", .{this.d.e_number.value}),
            .e_string => try writer.print("{s}", .{this.d.e_string.data}),
            .e_null => try writer.print("null", .{}),

            else => |tag| if (bun.Environment.isDebug) {
                Output.panic("Unexpected AST node: {s}", .{@tagName(tag)});
            },
        }
    }
};

pub fn Option(comptime T: type) type {
    return union(enum) {
        some: T,
        none,

        pub fn get(this: @This()) ?T {
            return switch (this) {
                .some => this.some,
                .none => null,
            };
        }
    };
}

pub const ConfigIterator = struct {
    allocator: Allocator,
    config: *E.Object,
    source: *const bun.logger.Source,
    log: *bun.logger.Log,

    prop_idx: usize = 0,

    pub const Item = struct {
        registry_url: []const u8,
        optname: Opt,
        value: []const u8,
        loc: Loc,

        pub const Opt = enum {
            /// `${username}:${password}` encoded in base64
            _auth,

            /// authentication string
            _authToken,

            username,

            /// this is encoded as base64 in .npmrc
            _password,

            email,

            /// path to certificate file
            certfile,

            /// path to key file
            keyfile,

            pub fn isBase64Encoded(this: Opt) bool {
                return switch (this) {
                    ._auth, ._password => true,
                    else => false,
                };
            }
        };

        /// Duplicate ConfigIterator.Item
        pub fn dupe(this: *const Item, allocator: Allocator) OOM!?Item {
            return .{
                .registry_url = try allocator.dupe(u8, this.registry_url),
                .optname = this.optname,
                .value = try allocator.dupe(u8, this.value),
                .loc = this.loc,
            };
        }

        /// Duplicate the value, decoding it if it is base64 encoded.
        pub fn dupeValueDecoded(
            this: *const Item,
            allocator: Allocator,
            log: *bun.logger.Log,
            source: *const bun.logger.Source,
        ) OOM!?[]const u8 {
            if (this.optname.isBase64Encoded()) {
                if (this.value.len == 0) return "";
                const len = bun.base64.decodeLen(this.value);
                var slice = try allocator.alloc(u8, len);
                const result = bun.base64.decode(slice[0..], this.value);
                if (result.status != .success) {
                    try log.addErrorFmtOpts(
                        allocator,
                        "{s} is not valid base64",
                        .{@tagName(this.optname)},
                        .{
                            .source = source,
                            .loc = this.loc,
                        },
                    );
                    return null;
                }
                return try allocator.dupe(u8, slice[0..result.count]);
            }
            return try allocator.dupe(u8, this.value);
        }

        pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("//{s}:{s}={s}", .{ this.registry_url, @tagName(this.optname), this.value });
        }

        pub fn deinit(self: *const Item, allocator: Allocator) void {
            allocator.free(self.registry_url);
            allocator.free(self.value);
        }
    };

    pub fn next(this: *ConfigIterator) ?Option(Item) {
        if (this.prop_idx >= this.config.properties.len) return null;
        defer this.prop_idx += 1;

        const prop = this.config.properties.ptr[this.prop_idx];

        if (prop.key) |keyexpr| {
            if (keyexpr.asUtf8StringLiteral()) |key| {
                if (bun.strings.hasPrefixComptime(key, "//")) {
                    const optnames = comptime brk: {
                        const names = std.meta.fieldNames(Item.Opt);
                        var names2: [names.len][:0]const u8 = undefined;
                        // we need to make sure to reverse this
                        // because _auth could match when it actually had _authToken
                        // so go backwards since _authToken is last
                        for (0..names.len) |i| {
                            names2[names2.len - i - 1] = names[i];
                        }
                        break :brk names2;
                    };

                    inline for (optnames) |name| {
                        var buf: [name.len + 1]u8 = undefined;
                        buf[0] = ':';
                        @memcpy(buf[1 .. name.len + 1], name);
                        const name_with_eq = buf[0..];

                        if (std.mem.lastIndexOf(u8, key, name_with_eq)) |index| {
                            const url_part = key[2..index];
                            if (prop.value) |value_expr| {
                                if (value_expr.asUtf8StringLiteral()) |value| {
                                    return .{
                                        .some = Item{
                                            .registry_url = url_part,
                                            .value = value,
                                            .optname = std.meta.stringToEnum(Item.Opt, name).?,
                                            .loc = prop.key.?.loc,
                                        },
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        return .none;
    }
};

pub const ScopeIterator = struct {
    allocator: Allocator,
    config: *E.Object,
    source: *const bun.logger.Source,
    log: *bun.logger.Log,

    prop_idx: usize = 0,
    count: bool = false,

    const Error = error{
        no_value,
    };

    const Item = struct { scope: []const u8, registry: bun.Schema.Api.NpmRegistry };

    pub fn next(this: *ScopeIterator) OOM!?Option(Item) {
        if (this.prop_idx >= this.config.properties.len) return null;
        defer this.prop_idx += 1;

        const prop = this.config.properties.ptr[this.prop_idx];

        if (prop.key) |keyexpr| {
            if (keyexpr.asUtf8StringLiteral()) |key| {
                if (bun.strings.hasPrefixComptime(key, "@") and bun.strings.endsWith(key, ":registry")) {
                    if (!this.count) {
                        return .{
                            .some = .{
                                .scope = key[1 .. key.len - ":registry".len],
                                .registry = brk: {
                                    if (prop.value) |value| {
                                        if (value.asUtf8StringLiteral()) |str| {
                                            var parser = bun.Schema.Api.NpmRegistry.Parser{
                                                .log = this.log,
                                                .source = this.source,
                                                .allocator = this.allocator,
                                            };
                                            break :brk try parser.parseRegistryURLStringImpl(str);
                                        }
                                    }
                                    return .none;
                                },
                            },
                        };
                    }
                }
            }
        }

        return .none;
    }
};

pub fn loadNpmrcConfig(
    allocator: std.mem.Allocator,
    install: *bun.Schema.Api.BunInstall,
    env: *bun.DotEnv.Loader,
    auto_loaded: bool,
    npmrc_paths: []const [:0]const u8,
) void {
    var log = bun.logger.Log.init(allocator);
    defer log.deinit();

    // npmrc registry configurations are shared between all npmrc files
    // so we need to collect them as we go for the final registry map
    // to be created at the end.
    var configs = std.ArrayList(ConfigIterator.Item).init(allocator);
    defer {
        for (configs.items) |item| {
            item.deinit(allocator);
        }
        configs.deinit();
    }

    for (npmrc_paths) |npmrc_path| {
        const source = bun.sys.File.toSource(npmrc_path, allocator).unwrap() catch |err| {
            if (auto_loaded) continue;
            Output.err(err, "failed to read .npmrc: \"{s}\"", .{npmrc_path});
            Global.crash();
        };
        defer allocator.free(source.contents);

        loadNpmrc(allocator, install, env, npmrc_path, &log, &source, &configs) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            }
        };
        if (log.hasErrors()) {
            if (log.errors == 1)
                Output.warn("Encountered an error while reading <b>{s}<r>:\n\n", .{npmrc_path})
            else
                Output.warn("Encountered errors while reading <b>{s}<r>:\n\n", .{npmrc_path});
            Output.flush();
        }
        log.print(Output.errorWriter()) catch {};
    }
}

pub fn loadNpmrc(
    allocator: std.mem.Allocator,
    install: *bun.Schema.Api.BunInstall,
    env: *bun.DotEnv.Loader,
    npmrc_path: [:0]const u8,
    log: *bun.logger.Log,
    source: *const bun.logger.Source,
    configs: *std.ArrayList(ConfigIterator.Item),
) OOM!void {
    var parser = bun.ini.Parser.init(allocator, npmrc_path, source.contents, env);
    defer parser.deinit();
    try parser.parse(parser.arena.allocator());
    // Need to be very, very careful here with strings.
    // They are allocated in the Parser's arena, which of course gets
    // deinitialized at the end of the scope.
    // We need to dupe all strings
    const out = parser.out;

    if (out.asProperty("registry")) |query| {
        if (query.expr.asUtf8StringLiteral()) |str| {
            var p = bun.Schema.Api.NpmRegistry.Parser{
                .allocator = allocator,
                .log = log,
                .source = source,
            };
            install.default_registry = try p.parseRegistryURLStringImpl(try allocator.dupe(u8, str));
        }
    }

    if (out.asProperty("cache")) |query| {
        if (query.expr.asUtf8StringLiteral()) |str| {
            install.cache_directory = try allocator.dupe(u8, str);
        } else if (query.expr.asBool()) |b| {
            install.disable_cache = !b;
        }
    }

    if (out.asProperty("dry-run")) |query| {
        if (query.expr.asUtf8StringLiteral()) |str| {
            install.dry_run = bun.strings.eqlComptime(str, "true");
        } else if (query.expr.asBool()) |b| {
            install.dry_run = b;
        }
    }

    if (out.asProperty("ca")) |query| {
        if (query.expr.asUtf8StringLiteral()) |str| {
            install.ca = .{
                .str = str,
            };
        } else if (query.expr.isArray()) {
            const arr = query.expr.data.e_array;
            var list = try allocator.alloc([]const u8, arr.items.len);
            var i: usize = 0;
            for (arr.items.slice()) |item| {
                list[i] = try item.asStringCloned(allocator) orelse continue;
                i += 1;
            }

            install.ca = .{
                .list = list,
            };
        }
    }

    if (out.asProperty("cafile")) |query| {
        if (try query.expr.asStringCloned(allocator)) |cafile| {
            install.cafile = cafile;
        }
    }

    if (out.asProperty("omit")) |omit| {
        switch (omit.expr.data) {
            .e_string => |str| {
                if (str.eqlComptime("dev")) {
                    install.save_dev = false;
                } else if (str.eqlComptime("peer")) {
                    install.save_peer = false;
                } else if (str.eqlComptime("optional")) {
                    install.save_optional = false;
                }
            },
            .e_array => |arr| {
                for (arr.items.slice()) |item| {
                    switch (item.data) {
                        .e_string => |str| {
                            if (str.eqlComptime("dev")) {
                                install.save_dev = false;
                            } else if (str.eqlComptime("peer")) {
                                install.save_peer = false;
                            } else if (str.eqlComptime("optional")) {
                                install.save_optional = false;
                            }
                        },
                        else => {},
                    }
                }
            },
            else => {},
        }
    }

    if (out.asProperty("include")) |omit| {
        switch (omit.expr.data) {
            .e_string => |str| {
                if (str.eqlComptime("dev")) {
                    install.save_dev = true;
                } else if (str.eqlComptime("peer")) {
                    install.save_peer = true;
                } else if (str.eqlComptime("optional")) {
                    install.save_optional = true;
                }
            },
            .e_array => |arr| {
                for (arr.items.slice()) |item| {
                    switch (item.data) {
                        .e_string => |str| {
                            if (str.eqlComptime("dev")) {
                                install.save_dev = true;
                            } else if (str.eqlComptime("peer")) {
                                install.save_peer = true;
                            } else if (str.eqlComptime("optional")) {
                                install.save_optional = true;
                            }
                        },
                        else => {},
                    }
                }
            },
            else => {},
        }
    }

    if (out.get("ignore-scripts")) |ignore_scripts| {
        if (ignore_scripts.isBoolean()) {
            install.ignore_scripts = ignore_scripts.data.e_boolean.value;
        }
    }

    var registry_map = install.scoped orelse bun.Schema.Api.NpmRegistryMap{};

    // Process scopes
    {
        var iter = bun.ini.ScopeIterator{
            .config = parser.out.data.e_object,
            .count = true,
            .source = source,
            .log = log,
            .allocator = allocator,
        };

        const scope_count = brk: {
            var count: usize = 0;
            while (try iter.next()) |o| {
                if (o == .some) {
                    count += 1;
                }
            }
            break :brk count;
        };

        defer install.scoped = registry_map;
        try registry_map.scopes.ensureUnusedCapacity(allocator, scope_count);

        iter.prop_idx = 0;
        iter.count = false;

        while (try iter.next()) |val| {
            if (val.get()) |result| {
                const registry = result.registry.dupe(allocator);
                try registry_map.scopes.put(
                    allocator,
                    try allocator.dupe(u8, result.scope),
                    registry,
                );
            }
        }
    }

    // Process registry configuration
    out: {
        const count = brk: {
            var count: usize = configs.items.len;
            for (parser.out.data.e_object.properties.slice()) |prop| {
                if (prop.key) |keyexpr| {
                    if (keyexpr.asUtf8StringLiteral()) |key| {
                        if (bun.strings.hasPrefixComptime(key, "//")) {
                            count += 1;
                        }
                    }
                }
            }

            break :brk count;
        };

        if (count == 0) break :out;

        const default_registry_url: bun.URL = brk: {
            if (install.default_registry) |dr|
                break :brk bun.URL.parse(dr.url);

            break :brk bun.URL.parse(Registry.default_url);
        };

        // I don't like having to do this but we'll need a mapping of scope -> bun.URL
        // Because we need to check different parts of the URL, for instance in this
        // example .npmrc:
        _ =
            \\ @myorg:registry=https://somewhere-else.com/myorg
            \\ @another:registry=https://somewhere-else.com/another
            \\
            \\ //somewhere-else.com/myorg/:_authToken=MYTOKEN1
            \\
            \\ //somewhere-else.com/:username=foobar
            \\
        ;
        // The line that sets the auth token should only apply to the @myorg scope
        // The line that sets the username would apply to both @myorg and @another
        var url_map = url_map: {
            var url_map = bun.StringArrayHashMap(bun.URL).init(parser.arena.allocator());
            try url_map.ensureTotalCapacity(registry_map.scopes.keys().len);

            for (registry_map.scopes.keys(), registry_map.scopes.values()) |*k, *v| {
                const url = bun.URL.parse(v.url);
                try url_map.put(k.*, url);
            }

            break :url_map url_map;
        };

        defer url_map.deinit();

        var iter = bun.ini.ConfigIterator{
            .config = parser.out.data.e_object,
            .source = source,
            .log = log,
            .allocator = allocator,
        };

        while (iter.next()) |val| {
            if (val.get()) |conf_item_| {
                // `conf_item` will look like:
                //
                // - localhost:4873/
                // - somewhere-else.com/myorg/
                //
                // Scoped registries are set like this:
                // - @myorg:registry=https://somewhere-else.com/myorg
                const conf_item: bun.ini.ConfigIterator.Item = conf_item_;
                switch (conf_item.optname) {
                    .email, .certfile, .keyfile => {
                        try log.addWarningFmt(
                            source,
                            iter.config.properties.at(iter.prop_idx - 1).key.?.loc,
                            allocator,
                            "The following .npmrc registry option was not applied:\n\n  <b>{s}<r>\n\nBecause we currently don't support the <b>{s}<r> option.",
                            .{
                                conf_item,
                                @tagName(conf_item.optname),
                            },
                        );
                        continue;
                    },
                    else => {},
                }
                if (try conf_item_.dupe(allocator)) |x| try configs.append(x);
            }
        }

        for (configs.items) |conf_item| {
            const conf_item_url = bun.URL.parse(conf_item.registry_url);

            if (std.mem.eql(u8, bun.strings.withoutTrailingSlash(default_registry_url.host), bun.strings.withoutTrailingSlash(conf_item_url.host))) {
                // Apply config to default registry
                const v: *bun.Schema.Api.NpmRegistry = brk: {
                    if (install.default_registry) |*r| break :brk r;
                    install.default_registry = bun.Schema.Api.NpmRegistry{
                        .password = "",
                        .token = "",
                        .username = "",
                        .url = Registry.default_url,
                    };
                    break :brk &install.default_registry.?;
                };

                switch (conf_item.optname) {
                    ._authToken => {
                        if (try conf_item.dupeValueDecoded(allocator, log, source)) |x| v.token = x;
                    },
                    .username => {
                        if (try conf_item.dupeValueDecoded(allocator, log, source)) |x| v.username = x;
                    },
                    ._password => {
                        if (try conf_item.dupeValueDecoded(allocator, log, source)) |x| v.password = x;
                    },
                    ._auth => {
                        try @"handle _auth"(allocator, v, &conf_item, log, source);
                    },
                    .email, .certfile, .keyfile => unreachable,
                }
            }

            for (registry_map.scopes.keys(), registry_map.scopes.values()) |*k, *v| {
                const url = url_map.get(k.*) orelse unreachable;

                if (std.mem.eql(u8, bun.strings.withoutTrailingSlash(url.host), bun.strings.withoutTrailingSlash(conf_item_url.host))) {
                    if (conf_item_url.hostname.len > 0) {
                        if (!std.mem.eql(u8, bun.strings.withoutTrailingSlash(url.hostname), bun.strings.withoutTrailingSlash(conf_item_url.hostname))) {
                            continue;
                        }
                    }
                    // Apply config to scoped registry
                    switch (conf_item.optname) {
                        ._authToken => {
                            if (try conf_item.dupeValueDecoded(allocator, log, source)) |x| v.token = x;
                        },
                        .username => {
                            if (try conf_item.dupeValueDecoded(allocator, log, source)) |x| v.username = x;
                        },
                        ._password => {
                            if (try conf_item.dupeValueDecoded(allocator, log, source)) |x| v.password = x;
                        },
                        ._auth => {
                            try @"handle _auth"(allocator, v, &conf_item, log, source);
                        },
                        .email, .certfile, .keyfile => unreachable,
                    }
                    // We have to keep going as it could match multiple scopes
                    continue;
                }
            }
        }
    }
}

fn @"handle _auth"(
    allocator: Allocator,
    v: *bun.Schema.Api.NpmRegistry,
    conf_item: *const ConfigIterator.Item,
    log: *bun.logger.Log,
    source: *const bun.logger.Source,
) OOM!void {
    if (conf_item.value.len == 0) {
        try log.addErrorOpts(
            "invalid _auth value, expected base64 encoded \"<username>:<password>\", received an empty string",
            .{
                .source = source,
                .loc = conf_item.loc,
                .redact_sensitive_information = true,
            },
        );
        return;
    }
    const decode_len = bun.base64.decodeLen(conf_item.value);
    const decoded = try allocator.alloc(u8, decode_len);
    const result = bun.base64.decode(decoded[0..], conf_item.value);
    if (!result.isSuccessful()) {
        defer allocator.free(decoded);
        try log.addErrorOpts(
            "invalid _auth value, expected valid base64",
            .{
                .source = source,
                .loc = conf_item.loc,
                .redact_sensitive_information = true,
            },
        );
        return;
    }
    const @"username:password" = decoded[0..result.count];
    const colon_idx = std.mem.indexOfScalar(u8, @"username:password", ':') orelse {
        defer allocator.free(@"username:password");
        try log.addErrorOpts(
            "invalid _auth value, expected base64 encoded \"<username>:<password>\"",
            .{
                .source = source,
                .loc = conf_item.loc,
                .redact_sensitive_information = true,
            },
        );
        return;
    };
    const username = @"username:password"[0..colon_idx];
    if (colon_idx + 1 >= @"username:password".len) {
        defer allocator.free(@"username:password");
        try log.addErrorOpts(
            "invalid _auth value, expected base64 encoded \"<username>:<password>\"",
            .{
                .source = source,
                .loc = conf_item.loc,
                .redact_sensitive_information = true,
            },
        );
        return;
    }
    const password = @"username:password"[colon_idx + 1 ..];
    v.username = username;
    v.password = password;
    return;
}
