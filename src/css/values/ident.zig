const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const Result = css.Result;
pub const Printer = css.Printer;
pub const PrintErr = css.PrintErr;

pub const Specifier = css.css_properties.css_modules.Specifier;

/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) reference.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
///
/// In CSS modules, when the `dashed_idents` option is enabled, the identifier may be followed by the
/// `from` keyword and an argument indicating where the referenced identifier is declared (e.g. a filename).
pub const DashedIdentReference = struct {
    /// The referenced identifier.
    ident: DashedIdent,
    /// CSS modules extension: the filename where the variable is defined.
    /// Only enabled when the CSS modules `dashed_idents` option is turned on.
    from: ?Specifier,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn parseWithOptions(input: *css.Parser, options: *const css.ParserOptions) Result(DashedIdentReference) {
        const ident = switch (DashedIdentFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        const from = if (options.css_modules != null and options.css_modules.?.dashed_idents) from: {
            if (input.tryParse(css.Parser.expectIdentMatching, .{"from"}).isOk()) break :from switch (Specifier.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            break :from null;
        } else null;

        return .{ .result = DashedIdentReference{ .ident = ident, .from = from } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (dest.css_module) |*css_module| {
            if (css_module.config.dashed_idents) {
                if (css_module.referenceDashed(dest.allocator, this.ident.v, &this.from, dest.loc.source_index)) |name| {
                    try dest.writeStr("--");
                    css.serializer.serializeName(name, dest) catch return dest.addFmtError();
                    return;
                }
            }
        }

        return dest.writeDashedIdent(&this.ident, false);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

pub const DashedIdentFns = DashedIdent;
/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) declaration.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
pub const DashedIdent = struct {
    v: []const u8,

    pub fn HashMap(comptime V: type) type {
        return std.ArrayHashMapUnmanaged(
            DashedIdent,
            V,
            struct {
                pub fn hash(_: @This(), s: DashedIdent) u32 {
                    return std.array_hash_map.hashString(s.v);
                }
                pub fn eql(_: @This(), a: DashedIdent, b: DashedIdent, _: usize) bool {
                    return bun.strings.eql(a, b);
                }
            },
            false,
        );
    }

    pub fn parse(input: *css.Parser) Result(DashedIdent) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (!bun.strings.startsWith(ident, "--")) return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };

        return .{ .result = .{ .v = ident } };
    }

    const This = @This();

    pub fn toCss(this: *const DashedIdent, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return dest.writeDashedIdent(this, true);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

/// A CSS [`<ident>`](https://www.w3.org/TR/css-values-4/#css-css-identifier).
pub const IdentFns = Ident;
pub const Ident = struct {
    v: []const u8,

    pub fn parse(input: *css.Parser) Result(Ident) {
        const ident = switch (input.expectIdent()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = .{ .v = ident } };
    }

    pub fn toCss(this: *const Ident, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.serializer.serializeIdentifier(this.v, dest) catch return dest.addFmtError();
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

pub const CustomIdentFns = CustomIdent;
pub const CustomIdent = struct {
    v: []const u8,

    pub fn parse(input: *css.Parser) Result(CustomIdent) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        // css.todo_stuff.match_ignore_ascii_case
        const valid = !(bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "initial") or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "inherit") or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "unset") or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "default") or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "revert") or
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "revert-layer"));

        if (!valid) return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        return .{ .result = .{ .v = ident } };
    }

    const This = @This();

    pub fn toCss(this: *const CustomIdent, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return @This().toCssWithOptions(this, W, dest, true);
    }

    /// Write the custom ident to CSS.
    pub fn toCssWithOptions(
        this: *const CustomIdent,
        comptime W: type,
        dest: *Printer(W),
        enabled_css_modules: bool,
    ) PrintErr!void {
        const css_module_custom_idents_enabled = enabled_css_modules and
            if (dest.css_module) |*css_module|
            css_module.config.custom_idents
        else
            false;
        return dest.writeIdent(this.v, css_module_custom_idents_enabled);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

/// A list of CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents) values.
pub const CustomIdentList = css.SmallList(CustomIdent, 1);
