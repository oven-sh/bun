const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;

const Location = css.dependencies.Location;

/// A value for the [composes](https://github.com/css-modules/css-modules/#dependencies) property from CSS modules.
pub const Composes = struct {
    /// A list of class names to compose.
    names: CustomIdentList,
    /// Where the class names are composed from.
    from: ?Specifier,
    /// The source location of the `composes` property.
    loc: bun.logger.Loc,
    cssparser_loc: Location,

    pub fn parse(input: *css.Parser) css.Result(Composes) {
        const loc = input.position();
        const loc2 = input.currentSourceLocation();
        var names: CustomIdentList = .{};
        while (input.tryParse(parseOneIdent, .{}).asValue()) |name| {
            names.append(input.allocator(), name);
        }

        if (names.len() == 0) return .{ .err = input.newCustomError(css.ParserError{ .invalid_declaration = {} }) };

        const from = if (input.tryParse(css.Parser.expectIdentMatching, .{"from"}).isOk()) switch (Specifier.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        } else null;

        return .{
            .result = Composes{
                .names = names,
                .from = from,
                .loc = bun.logger.Loc{ .start = @intCast(loc) },
                .cssparser_loc = Location.fromSourceLocation(loc2),
            },
        };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        var first = true;
        for (this.names.slice()) |name| {
            if (first) {
                first = false;
            } else {
                try dest.writeChar(' ');
            }
            try CustomIdentFns.toCss(&name, W, dest);
        }

        if (this.from) |*from| {
            try dest.writeStr(" from ");
            try from.toCss(W, dest);
        }
    }

    fn parseOneIdent(input: *css.Parser) css.Result(CustomIdent) {
        const name: CustomIdent = switch (CustomIdent.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        if (bun.strings.eqlCaseInsensitiveASCII(name.v, "from", true)) return .{ .err = input.newErrorForNextToken() };

        return .{ .result = name };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// Defines where the class names referenced in the `composes` property are located.
///
/// See [Composes](Composes).
pub const Specifier = union(enum) {
    /// The referenced name is global.
    global,
    /// The referenced name comes from the specified file.
    ///
    /// Is an import record index
    import_record_index: u32,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn parse(input: *css.Parser) css.Result(Specifier) {
        const start_position = input.position();
        if (input.tryParse(css.Parser.expectUrlOrString, .{}).asValue()) |file| {
            const import_record_index = switch (input.addImportRecord(file, start_position, .composes)) {
                .result => |idx| idx,
                .err => |e| return .{ .err = e },
            };
            return .{
                .result = .{
                    .import_record_index = import_record_index,
                },
            };
        }
        if (input.expectIdentMatching("global").asErr()) |e| return .{ .err = e };
        return .{ .result = .global };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return switch (this.*) {
            .global => dest.writeStr("global"),
            .import_record_index => |import_record_index| {
                const url = try dest.getImportRecordUrl(import_record_index);
                css.serializer.serializeString(url, dest) catch return dest.addFmtError();
            },
            // .source_index => {},
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};
