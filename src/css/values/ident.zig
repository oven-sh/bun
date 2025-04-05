const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;
const Symbol = bun.JSAst.Symbol;

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
                if (try css_module.referenceDashed(W, dest, this.ident.v, &this.from, dest.loc.source_index)) |name| {
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

/// Encodes an `Ident` or the bundler's `Ref` into 16 bytes.
///
/// It uses the top bit of the pointer to denote whether it's an ident or a ref
///
/// If it's an `Ident`, then `__ref_bit == false` and `__len` is the length of the slice.
///
/// If it's `Ref`, then `__ref_bit == true` and `__len` is the bit pattern of the `Ref`.
///
/// In debug mode, if it is a `Ref` we will also set the `__ptrbits` to point to the original
/// []const u8 so we can debug the string. This should be fine since we use arena
pub const IdentOrRef = packed struct(u128) {
    __ptrbits: u63 = 0,
    __ref_bit: bool = false,
    __len: u64 = 0,

    const Tag = enum {
        ident,
        ref,
    };

    const DebugIdent = if (bun.Environment.isDebug) struct { []const u8, Allocator } else void;

    pub fn debugIdent(this: @This()) []const u8 {
        if (comptime !bun.Environment.isDebug) {
            @compileError("debugIdent is only available in debug mode");
        }

        if (this.__ref_bit) {
            const ptr: *const []const u8 = @ptrFromInt(@as(usize, @intCast(this.__ptrbits)));
            return ptr.*;
        }

        return this.asIdent().?.v;
    }

    pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (this.__ref_bit) {
            const ref = this.asRef().?;
            return writer.print("Ref({})", .{ref});
        }
        return writer.print("Ident({s})", .{this.asIdent().?.v});
    }

    pub fn fromIdent(ident: Ident) @This() {
        return @This(){
            .__ptrbits = @intCast(@intFromPtr(ident.v.ptr)),
            .__len = ident.v.len,
            .__ref_bit = false,
        };
    }

    pub fn fromRef(ref: bun.bundle_v2.Ref, debug_ident: DebugIdent) @This() {
        var this = @This(){
            .__len = @bitCast(ref),
            .__ref_bit = true,
        };

        if (comptime bun.Environment.isDebug) {
            const heap_ptr: *[]const u8 = debug_ident[1].create([]const u8) catch bun.outOfMemory();
            heap_ptr.* = debug_ident[0];
            this.__ptrbits = @intCast(@intFromPtr(heap_ptr));
        }

        return this;
    }

    pub inline fn isIdent(this: @This()) bool {
        return !this.__ref_bit;
    }

    pub inline fn isRef(this: @This()) bool {
        return this.__ref_bit;
    }

    pub inline fn asIdent(this: @This()) ?Ident {
        if (!this.__ref_bit) {
            const ptr: [*]const u8 = @ptrFromInt(@as(usize, @intCast(this.__ptrbits)));
            return Ident{ .v = ptr[0..this.__len] };
        }
        return null;
    }

    pub inline fn asRef(this: @This()) ?bun.bundle_v2.Ref {
        if (this.__ref_bit) {
            const out: bun.bundle_v2.Ref = @bitCast(this.__len);
            return out;
        }
        return null;
    }

    pub fn asStr(this: @This(), map: *const bun.JSAst.Symbol.Map, local_names: ?*const css.LocalsResultsMap) ?[]const u8 {
        if (this.isIdent()) return this.asIdent().?.v;
        const ref = this.asRef().?;
        const final_ref = map.follow(ref);
        return local_names.?.get(final_ref);
    }

    pub fn asOriginalString(this: @This(), symbols: *const Symbol.List) []const u8 {
        if (this.isIdent()) return this.asIdent().?.v;
        const ref = this.asRef().?;
        return symbols.at(ref.inner_index).original_name;
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        if (this.isIdent()) {
            hasher.update(this.asIdent().?.v);
        } else {
            const slice: [*]const u64 = @ptrCast(this);
            const slice_u8: [*]align(8) const u8 = @ptrCast(@alignCast(slice));
            hasher.update(slice_u8[0..2]);
        }
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        if (this.isIdent() and other.isIdent()) {
            return bun.strings.eql(this.asIdent().?.v, other.asIdent().?.v);
        } else if (this.isRef() and other.isRef()) {
            const a = this.asRef().?;
            const b = other.asRef().?;
            return a.eql(b);
        }
        return false;
    }

    pub fn deepClone(this: *const @This(), _: std.mem.Allocator) @This() {
        return this.*;
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
