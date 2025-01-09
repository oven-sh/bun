const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

const ArrayList = std.ArrayListUnmanaged;

const ImportRecord = bun.ImportRecord;
const ImportKind = bun.ImportKind;

pub const prefixes = @import("./prefixes.zig");

pub const dependencies = @import("./dependencies.zig");
pub const Dependency = dependencies.Dependency;

pub const css_modules = @import("./css_modules.zig");
pub const CssModuleExports = css_modules.CssModuleExports;
pub const CssModule = css_modules.CssModule;
pub const CssModuleReferences = css_modules.CssModuleReferences;
pub const CssModuleReference = css_modules.CssModuleReference;

pub const css_rules = @import("./rules/rules.zig");
pub const CssRule = css_rules.CssRule;
pub const CssRuleList = css_rules.CssRuleList;
pub const LayerName = css_rules.layer.LayerName;
pub const SupportsCondition = css_rules.supports.SupportsCondition;
pub const CustomMedia = css_rules.custom_media.CustomMediaRule;
pub const NamespaceRule = css_rules.namespace.NamespaceRule;
pub const UnknownAtRule = css_rules.unknown.UnknownAtRule;
pub const ImportRule = css_rules.import.ImportRule;
pub const StyleRule = css_rules.style.StyleRule;
pub const StyleContext = css_rules.StyleContext;
pub const SupportsRule = css_rules.supports.SupportsRule;
pub const TailwindAtRule = css_rules.tailwind.TailwindAtRule;

pub const MinifyContext = css_rules.MinifyContext;

pub const media_query = @import("./media_query.zig");
pub const MediaList = media_query.MediaList;
pub const MediaFeatureType = media_query.MediaFeatureType;

pub const css_values = @import("./values/values.zig");
pub const DashedIdent = css_values.ident.DashedIdent;
pub const DashedIdentFns = css_values.ident.DashedIdentFns;
pub const CssColor = css_values.color.CssColor;
pub const ColorFallbackKind = css_values.color.ColorFallbackKind;
pub const CSSString = css_values.string.CSSString;
pub const CSSStringFns = css_values.string.CSSStringFns;
pub const CSSInteger = css_values.number.CSSInteger;
pub const CSSIntegerFns = css_values.number.CSSIntegerFns;
pub const CSSNumber = css_values.number.CSSNumber;
pub const CSSNumberFns = css_values.number.CSSNumberFns;
pub const Ident = css_values.ident.Ident;
pub const IdentFns = css_values.ident.IdentFns;
pub const CustomIdent = css_values.ident.CustomIdent;
pub const CustomIdentFns = css_values.ident.CustomIdentFns;
pub const Url = css_values.url.Url;

pub const declaration = @import("./declaration.zig");

pub const css_properties = @import("./properties/properties.zig");
pub const Property = css_properties.Property;
pub const PropertyId = css_properties.PropertyId;
pub const PropertyIdTag = css_properties.PropertyIdTag;
pub const TokenList = css_properties.custom.TokenList;
pub const TokenListFns = css_properties.custom.TokenListFns;

const css_decls = @import("./declaration.zig");
pub const DeclarationList = css_decls.DeclarationList;
pub const DeclarationBlock = css_decls.DeclarationBlock;

pub const selector = @import("./selectors/selector.zig");
pub const SelectorList = selector.parser.SelectorList;
pub const Selector = selector.parser.Selector;
pub const Component = selector.parser.Component;
pub const PseudoClass = selector.parser.PseudoClass;
pub const PseudoElement = selector.parser.PseudoElement;

pub const logical = @import("./logical.zig");
pub const PropertyCategory = logical.PropertyCategory;
pub const LogicalGroup = logical.LogicalGroup;

pub const css_printer = @import("./printer.zig");
pub const Printer = css_printer.Printer;
pub const PrinterOptions = css_printer.PrinterOptions;
pub const targets = @import("./targets.zig");
pub const Targets = css_printer.Targets;
// pub const Features = css_printer.Features;

const context = @import("./context.zig");
pub const PropertyHandlerContext = context.PropertyHandlerContext;
pub const DeclarationHandler = declaration.DeclarationHandler;

pub const Maybe = bun.JSC.Node.Maybe;
// TODO: Remove existing Error defined here and replace it with these
const errors_ = @import("./error.zig");
pub const Err = errors_.Err;
pub const PrinterErrorKind = errors_.PrinterErrorKind;
pub const PrinterError = errors_.PrinterError;
pub const ErrorLocation = errors_.ErrorLocation;
pub const ParseError = errors_.ParseError;
pub const ParserError = errors_.ParserError;
pub const BasicParseError = errors_.BasicParseError;
pub const BasicParseErrorKind = errors_.BasicParseErrorKind;
pub const SelectorError = errors_.SelectorError;
pub const MinifyErrorKind = errors_.MinifyErrorKind;
pub const MinifyError = errors_.MinifyError;
pub const MinifyErr = errors_.MinifyErr;

pub const generic = @import("./generics.zig");
pub const HASH_SEED = generic.HASH_SEED;

pub const ImportConditions = css_rules.import.ImportConditions;

pub const compat = @import("./compat.zig");

pub const Features = targets.Features;
pub const Feature = compat.Feature;

pub const fmtPrinterError = errors_.fmtPrinterError;

pub const PrintErr = error{
    lol,
};

pub fn OOM(e: anyerror) noreturn {
    if (comptime bun.Environment.isDebug) {
        std.debug.assert(e == std.mem.Allocator.Error.OutOfMemory);
    }
    bun.outOfMemory();
}

pub const SmallList = @import("./small_list.zig").SmallList;
pub const Bitflags = bun.Bitflags;

pub const todo_stuff = struct {
    pub const think_mem_mgmt = "TODO: think about memory management";

    pub const depth = "TODO: we need to go deeper";

    pub const match_ignore_ascii_case = "TODO: implement match_ignore_ascii_case";

    pub const enum_property = "TODO: implement enum_property!";

    pub const match_byte = "TODO: implement match_byte!";

    pub const warn = "TODO: implement warning";
};

pub const VendorPrefix = packed struct(u8) {
    /// No vendor prefixes.
    /// 0b00000001
    none: bool = false,
    /// The `-webkit` vendor prefix.
    /// 0b00000010
    webkit: bool = false,
    /// The `-moz` vendor prefix.
    /// 0b00000100
    moz: bool = false,
    /// The `-ms` vendor prefix.
    /// 0b00001000
    ms: bool = false,
    /// The `-o` vendor prefix.
    /// 0b00010000
    o: bool = false,
    __unused: u3 = 0,

    pub const NONE = VendorPrefix{ .none = true };
    pub const WEBKIT = VendorPrefix{ .webkit = true };
    pub const MOZ = VendorPrefix{ .moz = true };

    /// Fields listed here so we can iterate them in the order we want
    pub const FIELDS: []const []const u8 = &.{ "webkit", "moz", "ms", "o", "none" };

    pub usingnamespace Bitflags(@This());

    pub fn toCss(this: *const VendorPrefix, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return switch (this.asBits()) {
            VendorPrefix.asBits(.{ .webkit = true }) => dest.writeStr("-webkit-"),
            VendorPrefix.asBits(.{ .moz = true }) => dest.writeStr("-moz-"),
            VendorPrefix.asBits(.{ .ms = true }) => dest.writeStr("-ms-"),
            VendorPrefix.asBits(.{ .o = true }) => dest.writeStr("-o-"),
            else => {},
        };
    }

    /// Returns VendorPrefix::None if empty.
    pub inline fn orNone(this: VendorPrefix) VendorPrefix {
        return this._or(VendorPrefix{ .none = true });
    }

    /// **WARNING**: NOT THE SAME as .bitwiseOr!!
    pub inline fn _or(this: VendorPrefix, other: VendorPrefix) VendorPrefix {
        if (this.isEmpty()) return other;
        return this;
    }
};

pub const SourceLocation = struct {
    line: u32,
    column: u32,

    /// Create a new BasicParseError at this location for an unexpected token
    pub fn newBasicUnexpectedTokenError(this: SourceLocation, token: Token) ParseError(ParserError) {
        return BasicParseError.intoDefaultParseError(.{
            .kind = .{ .unexpected_token = token },
            .location = this,
        });
    }

    /// Create a new ParseError at this location for an unexpected token
    pub fn newUnexpectedTokenError(this: SourceLocation, token: Token) ParseError(ParserError) {
        return ParseError(ParserError){
            .kind = .{ .basic = .{ .unexpected_token = token } },
            .location = this,
        };
    }

    pub fn newCustomError(this: SourceLocation, err: anytype) ParseError(ParserError) {
        return switch (@TypeOf(err)) {
            ParserError => .{
                .kind = .{ .custom = err },
                .location = this,
            },
            BasicParseError => .{
                .kind = .{ .custom = BasicParseError.intoDefaultParseError(err) },
                .location = this,
            },
            selector.parser.SelectorParseErrorKind => .{
                .kind = .{ .custom = selector.parser.SelectorParseErrorKind.intoDefaultParserError(err) },
                .location = this,
            },
            else => @compileError("TODO implement this for: " ++ @typeName(@TypeOf(err))),
        };
    }
};
pub const Location = css_rules.Location;

pub const Error = Err(ParserError);

pub fn Result(comptime T: type) type {
    return Maybe(T, ParseError(ParserError));
}

pub fn PrintResult(comptime T: type) type {
    return Maybe(T, PrinterError);
}

pub fn todo(comptime fmt: []const u8, args: anytype) noreturn {
    bun.Analytics.Features.todo_panic = 1;
    std.debug.panic("TODO: " ++ fmt, args);
}

pub fn voidWrap(comptime T: type, comptime parsefn: *const fn (*Parser) Result(T)) *const fn (void, *Parser) Result(T) {
    const Wrapper = struct {
        fn wrapped(_: void, p: *Parser) Result(T) {
            return parsefn(p);
        }
    };
    return Wrapper.wrapped;
}

pub fn DefineListShorthand(comptime T: type) type {
    _ = T; // autofix
    // TODO: implement this when we implement visit?
    // does nothing now
    return struct {};
}

pub fn DefineShorthand(comptime T: type, comptime property_name: PropertyIdTag) type {
    _ = property_name; // autofix
    // TODO: validate map, make sure each field is set
    // make sure each field is same index as in T
    _ = T.PropertyFieldMap;

    return struct {
        /// Returns a shorthand from the longhand properties defined in the given declaration block.
        pub fn fromLonghands(allocator: Allocator, decls: *const DeclarationBlock, vendor_prefix: VendorPrefix) ?struct { T, bool } {
            _ = allocator; // autofix
            _ = decls; // autofix
            _ = vendor_prefix; // autofix
            // var count: usize = 0;
            // var important_count: usize = 0;
            // var this: T = undefined;
            // var set_fields = std.StaticBitSet(std.meta.fields(T).len).initEmpty();
            // const all_fields_set = std.StaticBitSet(std.meta.fields(T).len).initFull();

            // // Loop through each property in `decls.declarations` and then `decls.important_declarations`
            // // The inline for loop is so we can share the code for both
            // const DECL_FIELDS = &.{ "declarations", "important_declarations" };
            // inline for (DECL_FIELDS) |decl_field_name| {
            //     const decl_list: *const ArrayList(css_properties.Property) = &@field(decls, decl_field_name);
            //     const important = comptime std.mem.eql(u8, decl_field_name, "important_declarations");

            //     // Now loop through each property in the list
            //     main_loop: for (decl_list.items) |*property| {
            //         // The property field map maps each field in `T` to a tag of `Property`
            //         // Here we do `inline for` to basically switch on the tag of `property` to see
            //         // if it matches a field in `T` which maps to the same tag
            //         //
            //         // Basically, check that `@as(PropertyIdTag, property.*)` equals `T.PropertyFieldMap[field.name]`
            //         inline for (std.meta.fields(@TypeOf(T.PropertyFieldMap))) |field| {
            //             const tag: PropertyIdTag = @as(?*const PropertyIdTag, field.default_value).?.*;

            //             if (@intFromEnum(@as(PropertyIdTag, property.*)) == tag) {
            //                 if (@hasField(T.VendorPrefixMap, field.name)) {
            //                     if (@hasField(T.VendorPrefixMap, field.name) and
            //                         !VendorPrefix.eq(@field(property, field.name)[1], vendor_prefix))
            //                     {
            //                         return null;
            //                     }

            //                     @field(this, field.name) = if (@hasDecl(@TypeOf(@field(property, field.name)[0]), "clone"))
            //                         @field(property, field.name)[0].deepClone(allocator)
            //                     else
            //                         @field(property, field.name)[0];
            //                 } else {
            //                     @field(this, field.name) = if (@hasDecl(@TypeOf(@field(property, field.name)), "clone"))
            //                         @field(property, field.name).deepClone(allocator)
            //                     else
            //                         @field(property, field.name);
            //                 }

            //                 set_fields.set(std.meta.fieldIndex(T, field.name));
            //                 count += 1;
            //                 if (important) {
            //                     important_count += 1;
            //                 }

            //                 continue :main_loop;
            //             }
            //         }

            //         // If `property` matches none of the tags in `T.PropertyFieldMap` then let's try
            //         // if it matches the tag specified by `property_name`
            //         if (@as(PropertyIdTag, property.*) == property_name) {
            //             inline for (std.meta.fields(@TypeOf(T.PropertyFieldMap))) |field| {
            //                 if (@hasField(T.VendorPrefixMap, field.name)) {
            //                     @field(this, field.name) = if (@hasDecl(@TypeOf(@field(property, field.name)[0]), "clone"))
            //                         @field(property, field.name)[0].deepClone(allocator)
            //                     else
            //                         @field(property, field.name)[0];
            //                 } else {
            //                     @field(this, field.name) = if (@hasDecl(@TypeOf(@field(property, field.name)), "clone"))
            //                         @field(property, field.name).deepClone(allocator)
            //                     else
            //                         @field(property, field.name);
            //                 }

            //                 set_fields.set(std.meta.fieldIndex(T, field.name));
            //                 count += 1;
            //                 if (important) {
            //                     important_count += 1;
            //                 }
            //             }
            //             continue :main_loop;
            //         }

            //         // Otherwise, try to convert to te fields using `.longhand()`
            //         inline for (std.meta.fields(@TypeOf(T.PropertyFieldMap))) |field| {
            //             const property_id = @unionInit(
            //                 PropertyId,
            //                 field.name,
            //                 if (@hasDecl(T.VendorPrefixMap, field.name)) vendor_prefix else {},
            //             );
            //             const value = property.longhand(&property_id);
            //             if (@as(PropertyIdTag, value) == @as(PropertyIdTag, property_id)) {
            //                 @field(this, field.name) = if (@hasDecl(T.VendorPrefixMap, field.name))
            //                     @field(value, field.name)[0]
            //                 else
            //                     @field(value, field.name);
            //                 set_fields.set(std.meta.fieldIndex(T, field.name));
            //                 count += 1;
            //                 if (important) {
            //                     important_count += 1;
            //                 }
            //             }
            //         }
            //     }
            // }

            // if (important_count > 0 and important_count != count) {
            //     return null;
            // }

            // // All properties in the group must have a matching value to produce a shorthand.
            // if (set_fields.eql(all_fields_set)) {
            //     return .{ this, important_count > 0 };
            // }

            // return null;
            @compileError(todo_stuff.depth);
        }

        /// Returns a shorthand from the longhand properties defined in the given declaration block.
        pub fn longhands(vendor_prefix: VendorPrefix) []const PropertyId {
            _ = vendor_prefix; // autofix
            // const out: []const PropertyId = comptime out: {
            //     var out: [std.meta.fields(@TypeOf(T.PropertyFieldMap)).len]PropertyId = undefined;

            //     for (std.meta.fields(@TypeOf(T.PropertyFieldMap)), 0..) |field, i| {
            //         out[i] = @unionInit(
            //             PropertyId,
            //             field.name,
            //             if (@hasField(T.VendorPrefixMap, field.name)) vendor_prefix else {},
            //         );
            //     }

            //     break :out out;
            // };
            // return out;

            @compileError(todo_stuff.depth);
        }

        /// Returns a longhand property for this shorthand.
        pub fn longhand(this: *const T, allocator: Allocator, property_id: *const PropertyId) ?Property {
            _ = this; // autofix
            _ = allocator; // autofix
            _ = property_id; // autofix
            // inline for (std.meta.fields(@TypeOf(T.PropertyFieldMap))) |field| {
            //     if (@as(PropertyIdTag, property_id.*) == @field(T.PropertyFieldMap, field.name)) {
            //         const val = if (@hasDecl(@TypeOf(@field(T, field.namee)), "clone"))
            //             @field(this, field.name).deepClone(allocator)
            //         else
            //             @field(this, field.name);
            //         return @unionInit(
            //             Property,
            //             field.name,
            //             if (@field(T.VendorPrefixMap, field.name))
            //                 .{ val, @field(property_id, field.name)[1] }
            //             else
            //                 val,
            //         );
            //     }
            // }
            // return null;
            @compileError(todo_stuff.depth);
        }

        /// Updates this shorthand from a longhand property.
        pub fn setLonghand(this: *T, allocator: Allocator, property: *const Property) bool {
            _ = this; // autofix
            _ = allocator; // autofix
            _ = property; // autofix
            // inline for (std.meta.fields(T.PropertyFieldMap)) |field| {
            //     if (@as(PropertyIdTag, property.*) == @field(T.PropertyFieldMap, field.name)) {
            //         const val = if (@hasDecl(@TypeOf(@field(T, field.name)), "clone"))
            //             @field(this, field.name).deepClone(allocator)
            //         else
            //             @field(this, field.name);

            //         @field(this, field.name) = val;

            //         return true;
            //     }
            // }
            // return false;
            @compileError(todo_stuff.depth);
        }
    };
}

pub fn DefineRectShorthand(comptime T: type, comptime V: type) type {
    return struct {
        pub fn parse(input: *Parser) Result(T) {
            const rect = switch (css_values.rect.Rect(V).parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };

            return .{
                .result = .{
                    .top = rect.top,
                    .right = rect.right,
                    .bottom = rect.bottom,
                    .left = rect.left,
                },
            };
        }

        pub fn toCss(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
            const rect = css_values.rect.Rect(V){
                .top = this.top,
                .right = this.right,
                .bottom = this.bottom,
                .left = this.left,
            };
            return rect.toCss(W, dest);
        }
    };
}

pub fn DefineSizeShorthand(comptime T: type, comptime V: type) type {
    if (std.meta.fields(T).len != 2) @compileError("DefineSizeShorthand must be used on a struct with 2 fields");
    return struct {
        pub fn toCss(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
            const size: css_values.size.Size2D(V) = .{
                .a = @field(this, std.meta.fields(T)[0].name),
                .b = @field(this, std.meta.fields(T)[1].name),
            };
            return size.toCss(W, dest);
            // TODO: unfuck this
            // @panic(todo_stuff.depth);
        }

        pub fn parse(input: *Parser) Result(T) {
            const size = switch (css_values.size.Size2D(V).parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };

            var this: T = undefined;
            @field(this, std.meta.fields(T)[0].name) = size.a;
            @field(this, std.meta.fields(T)[1].name) = size.b;

            return .{ .result = this };
            // TODO: unfuck this
            // @panic(todo_stuff.depth);
        }
    };
}

pub fn DeriveParse(comptime T: type) type {
    const tyinfo = @typeInfo(T);
    const is_union_enum = tyinfo == .Union;
    const enum_type = if (comptime is_union_enum) @typeInfo(tyinfo.Union.tag_type.?) else tyinfo;
    const enum_actual_type = if (comptime is_union_enum) tyinfo.Union.tag_type.? else T;

    const Map = bun.ComptimeEnumMap(enum_actual_type);

    return struct {
        pub fn parse(input: *Parser) Result(T) {
            if (comptime is_union_enum) {
                const payload_count, const first_payload_index, const void_count, const first_void_index = comptime counts: {
                    var first_void_index: ?usize = null;
                    var first_payload_index: ?usize = null;
                    var payload_count: usize = 0;
                    var void_count: usize = 0;
                    for (tyinfo.Union.fields, 0..) |field, i| {
                        if (field.type == void) {
                            void_count += 1;
                            if (first_void_index == null) first_void_index = i;
                        } else {
                            payload_count += 1;
                            if (first_payload_index == null) first_payload_index = i;
                        }
                    }
                    if (first_payload_index == null) {
                        @compileError("Type defined as `union(enum)` but no variant carries a payload. Make it an `enum` instead.");
                    }
                    if (first_void_index) |void_index| {
                        // Check if they overlap
                        if (first_payload_index.? < void_index and void_index < first_payload_index.? + payload_count) @compileError("Please put all the fields with data together and all the fields with no data together.");
                        if (first_payload_index.? > void_index and first_payload_index.? < void_index + void_count) @compileError("Please put all the fields with data together and all the fields with no data together.");
                    }
                    break :counts .{ payload_count, first_payload_index.?, void_count, first_void_index };
                };

                return gnerateCode(input, first_payload_index, first_void_index, void_count, payload_count);
            }

            const location = input.currentSourceLocation();
            const ident = switch (input.expectIdent()) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };
            if (Map.getCaseInsensitiveWithEql(ident, bun.strings.eqlComptimeIgnoreLen)) |matched| {
                inline for (bun.meta.EnumFields(enum_actual_type)) |field| {
                    if (field.value == @intFromEnum(matched)) {
                        if (comptime is_union_enum) return .{ .result = @unionInit(T, field.name, void) };
                        return .{ .result = @enumFromInt(field.value) };
                    }
                }
                unreachable;
            }
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        }

        /// Comptime code which constructs the parsing code for a union(enum) which could contain
        /// void fields (fields with no associated data) and payload fields (fields which carry data),
        /// for example:
        ///
        /// ```zig
        /// /// A value for the [border-width](https://www.w3.org/TR/css-backgrounds-3/#border-width) property.
        /// pub const BorderSideWidth = union(enum) {
        ///     /// A UA defined `thin` value.
        ///     thin,
        ///     /// A UA defined `medium` value.
        ///     medium,
        ///     /// A UA defined `thick` value.
        ///     thick,
        ///     /// An explicit width.
        ///     length: Length,
        /// }
        /// ```
        ///
        /// During parsing, we can check if it is one of the void fields (in this case `thin`, `medium`, or `thick`) by reading a single
        /// identifier from the Parser, and checking if it matches any of the void field names. We already constructed a ComptimeEnumMap (see above)
        /// to make this super cheap.
        ///
        /// If we don't get an identifier that matches any of the void fields, we can then try to parse the payload fields.
        ///
        /// This function is made more complicated by the fact that it tries to parse in order of the fields that were declared in the union(enum).
        /// If, for example, all the void fields were declared after the `length: Length` field, this function will try to parse the `length` field first,
        /// and then try to parse the void fields.
        ///
        /// This parsing order is a detail copied from LightningCSS. I'm not sure if it is necessary. But it could be.
        inline fn gnerateCode(
            input: *Parser,
            comptime first_payload_index: usize,
            comptime maybe_first_void_index: ?usize,
            comptime void_count: usize,
            comptime payload_count: usize,
        ) Result(T) {
            const last_payload_index = first_payload_index + payload_count - 1;
            if (comptime maybe_first_void_index == null) {
                inline for (tyinfo.Union.fields[first_payload_index .. first_payload_index + payload_count], first_payload_index..) |field, i| {
                    if (comptime (i == last_payload_index)) {
                        return .{ .result = switch (generic.parseFor(field.type)(input)) {
                            .result => |v| @unionInit(T, field.name, v),
                            .err => |e| return .{ .err = e },
                        } };
                    }
                    if (input.tryParse(generic.parseFor(field.type), .{}).asValue()) |v| {
                        return .{ .result = @unionInit(T, field.name, v) };
                    }
                }
            }

            const first_void_index = maybe_first_void_index.?;

            const void_fields = bun.meta.EnumFields(T)[first_void_index .. first_void_index + void_count];

            if (comptime void_count == 1) {
                const void_field = enum_type.Enum.fields[first_void_index];
                // The field is declared before the payload fields.
                // So try to parse an ident matching the name of the field, then fallthrough
                // to parsing the payload fields.
                if (comptime first_void_index < first_payload_index) {
                    if (input.tryParse(Parser.expectIdentMatching, .{void_field.name}).isOk()) {
                        if (comptime is_union_enum) return .{ .result = @unionInit(T, void_field.name, {}) };
                        return .{ .result = @enumFromInt(void_field.value) };
                    }

                    inline for (tyinfo.Union.fields[first_payload_index .. first_payload_index + payload_count], first_payload_index..) |field, i| {
                        if (comptime (i == last_payload_index and last_payload_index > first_void_index)) {
                            return .{ .result = switch (generic.parseFor(field.type)(input)) {
                                .result => |v| @unionInit(T, field.name, v),
                                .err => |e| return .{ .err = e },
                            } };
                        }
                        if (input.tryParse(generic.parseFor(field.type), .{}).asValue()) |v| {
                            return .{ .result = @unionInit(T, field.name, v) };
                        }
                    }
                } else {
                    inline for (tyinfo.Union.fields[first_payload_index .. first_payload_index + payload_count], first_payload_index..) |field, i| {
                        if (comptime (i == last_payload_index and last_payload_index > first_void_index)) {
                            return .{ .result = switch (generic.parseFor(field.type)(input)) {
                                .result => |v| @unionInit(T, field.name, v),
                                .err => |e| return .{ .err = e },
                            } };
                        }
                        if (input.tryParse(generic.parseFor(field.type), .{}).asValue()) |v| {
                            return .{ .result = @unionInit(T, field.name, v) };
                        }
                    }

                    // We can generate this as the last statements of the function, avoiding the `input.tryParse` routine above
                    if (input.expectIdentMatching(void_field.name).asErr()) |e| return .{ .err = e };
                    if (comptime is_union_enum) return .{ .result = @unionInit(T, void_field.name, {}) };
                    return .{ .result = @enumFromInt(void_field.value) };
                }
            } else if (comptime first_void_index < first_payload_index) {
                // Multiple fields declared before the payload fields, use tryParse
                const state = input.state();
                if (input.tryParse(Parser.expectIdent, .{}).asValue()) |ident| {
                    if (Map.getCaseInsensitiveWithEql(ident, bun.strings.eqlComptimeIgnoreLen)) |matched| {
                        inline for (void_fields) |field| {
                            if (field.value == @intFromEnum(matched)) {
                                if (comptime is_union_enum) return .{ .result = @unionInit(T, field.name, {}) };
                                return .{ .result = @enumFromInt(field.value) };
                            }
                        }
                        unreachable;
                    }
                    input.reset(&state);
                }

                inline for (tyinfo.Union.fields[first_payload_index .. first_payload_index + payload_count], first_payload_index..) |field, i| {
                    if (comptime (i == last_payload_index and last_payload_index > first_void_index)) {
                        return .{ .result = switch (generic.parseFor(field.type)(input)) {
                            .result => |v| @unionInit(T, field.name, v),
                            .err => |e| return .{ .err = e },
                        } };
                    }
                    if (input.tryParse(generic.parseFor(field.type), .{}).asValue()) |v| {
                        return .{ .result = @unionInit(T, field.name, v) };
                    }
                }
            } else if (comptime first_void_index > first_payload_index) {
                inline for (tyinfo.Union.fields[first_payload_index .. first_payload_index + payload_count], first_payload_index..) |field, i| {
                    if (comptime (i == last_payload_index and last_payload_index > first_void_index)) {
                        return .{ .result = switch (generic.parseFor(field.type)(input)) {
                            .result => |v| @unionInit(T, field.name, v),
                            .err => |e| return .{ .err = e },
                        } };
                    }
                    if (input.tryParse(generic.parseFor(field.type), .{}).asValue()) |v| {
                        return .{ .result = @unionInit(T, field.name, v) };
                    }
                }

                const location = input.currentSourceLocation();
                const ident = switch (input.expectIdent()) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };
                if (Map.getCaseInsensitiveWithEql(ident, bun.strings.eqlComptimeIgnoreLen)) |matched| {
                    inline for (void_fields) |field| {
                        if (field.value == @intFromEnum(matched)) {
                            if (comptime is_union_enum) return .{ .result = @unionInit(T, field.name, {}) };
                            return .{ .result = @enumFromInt(field.value) };
                        }
                    }
                    unreachable;
                }
                return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
            }
            @compileError("SHOULD BE UNREACHABLE!");
        }

        // inline fn generatePayloadBranches(
        //     input: *Parser,
        //     comptime first_payload_index: usize,
        //     comptime first_void_index: usize,
        //     comptime payload_count: usize,
        // ) Result(T) {
        //     const last_payload_index = first_payload_index + payload_count - 1;
        //     inline for (tyinfo.Union.fields[first_payload_index..], first_payload_index..) |field, i| {
        //         if (comptime (i == last_payload_index and last_payload_index > first_void_index)) {
        //             return generic.parseFor(field.type)(input);
        //         }
        //         if (input.tryParse(generic.parseFor(field.type), .{}).asValue()) |v| {
        //             return .{ .result = @unionInit(T, field.name, v) };
        //         }
        //     }
        //     // The last field will return so this is never reachable
        //     unreachable;
        // }

        // pub fn parse(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
        //     // to implement this, we need to cargo expand the derive macro
        //     _ = this; // autofix
        //     _ = dest; // autofix
        //     @compileError(todo_stuff.depth);
        // }
    };
}

/// This uses comptime reflection to generate a `toCss` function enums and union(enum)s.
///
/// Supported payload types for union(enum)s are:
/// - any type that has a `toCss` function
/// - void types (stringifies the identifier)
/// - optional types (unwraps the optional)
/// - anonymous structs, will automatically serialize it if it has a `__generateToCss` function
pub fn DeriveToCss(comptime T: type) type {
    const tyinfo = @typeInfo(T);
    const enum_fields = bun.meta.EnumFields(T);
    const is_enum_or_union_enum = tyinfo == .Union or tyinfo == .Enum;

    return struct {
        pub fn toCss(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
            if (comptime is_enum_or_union_enum) {
                inline for (std.meta.fields(T), 0..) |field, i| {
                    if (@intFromEnum(this.*) == enum_fields[i].value) {
                        if (comptime field.type == void) {
                            return dest.writeStr(enum_fields[i].name);
                        } else if (comptime generic.hasToCss(field.type)) {
                            return generic.toCss(field.type, &@field(this, field.name), W, dest);
                        } else if (@hasDecl(field.type, "__generateToCss") and @typeInfo(field.type) == .Struct) {
                            const variant_fields = std.meta.fields(field.type);
                            if (variant_fields.len > 1) {
                                const last = variant_fields.len - 1;
                                inline for (variant_fields, 0..) |variant_field, j| {
                                    // Unwrap it from the optional
                                    if (@typeInfo(variant_field.type) == .Optional) {
                                        if (@field(@field(this, field.name), variant_field.name)) |*value| {
                                            try value.toCss(W, dest);
                                        }
                                    } else {
                                        try @field(@field(this, field.name), variant_field.name).toCss(W, dest);
                                    }

                                    // Emit a space if there are more fields after
                                    if (comptime j != last) {
                                        try dest.writeChar(' ');
                                    }
                                }
                            } else {
                                const variant_field = variant_fields[0];
                                try @field(variant_field.type, "toCss")(@field(@field(this, field.name), variant_field.name), W, dest);
                            }
                        } else {
                            @compileError("Don't know how to serialize this variant: " ++ @typeName(field.type) ++ ", on " ++ @typeName(T) ++ ".\n\nYou probably want to implement a `toCss` function for this type, or add a dummy `fn __generateToCss() void {}` to the type signal that it is okay for it to be auto-generated by this function..");
                        }
                    }
                }
            } else {
                @compileError("Unsupported type: " ++ @typeName(T));
            }
            return;
        }
    };
}

pub const enum_property_util = struct {
    pub fn asStr(comptime T: type, this: *const T) []const u8 {
        const tag = @intFromEnum(this.*);
        inline for (bun.meta.EnumFields(T)) |field| {
            if (tag == field.value) return field.name;
        }
        unreachable;
    }

    pub inline fn parse(comptime T: type, input: *Parser) Result(T) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };

        const Map = comptime bun.ComptimeEnumMap(T);
        if (Map.getASCIIICaseInsensitive(ident)) |x| return .{ .result = x };
        // inline for (std.meta.fields(T)) |field| {
        //     if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, field.name)) return .{ .result = @enumFromInt(field.value) };
        // }

        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(comptime T: type, this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return dest.writeStr(asStr(T, this));
    }
};

pub fn DefineEnumProperty(comptime T: type) type {
    const fields: []const std.builtin.Type.EnumField = std.meta.fields(T);

    return struct {
        pub fn eql(lhs: *const T, rhs: *const T) bool {
            return @intFromEnum(lhs.*) == @intFromEnum(rhs.*);
        }

        pub fn asStr(this: *const T) []const u8 {
            const tag = @intFromEnum(this.*);
            inline for (fields) |field| {
                if (tag == field.value) return field.name;
            }
            unreachable;
        }

        pub fn parse(input: *Parser) Result(T) {
            const location = input.currentSourceLocation();
            const ident = switch (input.expectIdent()) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };

            // todo_stuff.match_ignore_ascii_case
            inline for (fields) |field| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, field.name)) return .{ .result = @enumFromInt(field.value) };
            }

            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
            // @panic("TODO renable this");
        }

        pub fn toCss(this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
            return dest.writeStr(asStr(this));
        }

        pub inline fn deepClone(this: *const T, _: std.mem.Allocator) T {
            return this.*;
        }

        pub fn hash(this: *const T, hasher: *std.hash.Wyhash) void {
            const tag = @intFromEnum(this.*);
            hasher.update(std.mem.asBytes(&tag));
        }
    };
}

pub fn DeriveValueType(comptime T: type) type {
    _ = @typeInfo(T).Enum;

    const ValueTypeMap = T.ValueTypeMap;
    const field_values: []const MediaFeatureType = field_values: {
        const fields = std.meta.fields(T);
        var mapping: [fields.len]MediaFeatureType = undefined;
        for (fields, 0..) |field, i| {
            // Check that it exists in the type map
            mapping[i] = @field(ValueTypeMap, field.name);
        }
        const mapping_final = mapping;
        break :field_values mapping_final[0..];
    };

    return struct {
        pub fn valueType(this: *const T) MediaFeatureType {
            inline for (std.meta.fields(T), 0..) |field, i| {
                if (field.value == @intFromEnum(this.*)) {
                    return field_values[i];
                }
            }
            unreachable;
        }
    };
}

fn consume_until_end_of_block(block_type: BlockType, tokenizer: *Tokenizer) void {
    @setCold(true);
    var stack = SmallList(BlockType, 16){};
    stack.appendAssumeCapacity(block_type);

    while (switch (tokenizer.next()) {
        .result => |v| v,
        .err => null,
    }) |tok| {
        if (BlockType.closing(&tok)) |b| {
            if (stack.getLastUnchecked() == b) {
                _ = stack.pop();
                if (stack.len() == 0) return;
            }
        }

        if (BlockType.opening(&tok)) |bt| stack.append(tokenizer.allocator, bt);
    }
}

fn parse_at_rule(
    allocator: Allocator,
    start: *const ParserState,
    name: []const u8,
    input: *Parser,
    comptime P: type,
    parser: *P,
) Result(P.AtRuleParser.AtRule) {
    _ = allocator; // autofix
    ValidAtRuleParser(P);
    const delimiters = Delimiters{ .semicolon = true, .curly_bracket = true };
    const Closure = struct {
        name: []const u8,
        parser: *P,

        pub fn parsefn(this: *@This(), input2: *Parser) Result(P.AtRuleParser.Prelude) {
            return P.AtRuleParser.parsePrelude(this.parser, this.name, input2);
        }
    };
    var closure = Closure{ .name = name, .parser = parser };
    const prelude: P.AtRuleParser.Prelude = switch (input.parseUntilBefore(delimiters, P.AtRuleParser.Prelude, &closure, Closure.parsefn)) {
        .result => |vvv| vvv,
        .err => |e| {
            // const end_position = input.position();
            // _ = end_position; k
            out: {
                const tok = switch (input.next()) {
                    .result => |v| v,
                    .err => break :out,
                };
                if (tok.* != .open_curly and tok.* != .semicolon) bun.unreachablePanic("Should have consumed these delimiters", .{});
                break :out;
            }
            return .{ .err = e };
        },
    };
    const next = switch (input.next()) {
        .result => |v| v.*,
        .err => {
            return switch (P.AtRuleParser.ruleWithoutBlock(parser, prelude, start)) {
                .result => |v| {
                    return .{ .result = v };
                },
                .err => {
                    return .{ .err = input.newUnexpectedTokenError(.semicolon) };
                },
            };
        },
    };
    switch (next) {
        .semicolon => {
            switch (P.AtRuleParser.ruleWithoutBlock(parser, prelude, start)) {
                .result => |v| {
                    return .{ .result = v };
                },
                .err => {
                    return .{ .err = input.newUnexpectedTokenError(.semicolon) };
                },
            }
        },
        .open_curly => {
            const AnotherClosure = struct {
                prelude: P.AtRuleParser.Prelude,
                start: *const ParserState,
                parser: *P,
                pub fn parsefn(this: *@This(), input2: *Parser) Result(P.AtRuleParser.AtRule) {
                    return P.AtRuleParser.parseBlock(this.parser, this.prelude, this.start, input2);
                }
            };
            var another_closure = AnotherClosure{
                .prelude = prelude,
                .start = start,
                .parser = parser,
            };
            return parse_nested_block(input, P.AtRuleParser.AtRule, &another_closure, AnotherClosure.parsefn);
        },
        else => {
            bun.unreachablePanic("", .{});
        },
    }
}

fn parse_custom_at_rule_prelude(name: []const u8, input: *Parser, options: *const ParserOptions, comptime T: type, at_rule_parser: *T) Result(AtRulePrelude(T.CustomAtRuleParser.Prelude)) {
    ValidCustomAtRuleParser(T);
    switch (T.CustomAtRuleParser.parsePrelude(at_rule_parser, name, input, options)) {
        .result => |prelude| {
            return .{ .result = .{ .custom = prelude } };
        },
        .err => |e| {
            if (e.kind == .basic and e.kind.basic == .at_rule_invalid) {
                // do nothing
            } else return .{
                .err = input.newCustomError(
                    ParserError{ .at_rule_prelude_invalid = {} },
                ),
            };
        },
    }

    options.warn(input.newError(.{ .at_rule_invalid = name }));
    input.skipWhitespace();
    const tokens = switch (TokenListFns.parse(input, options, 0)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    return .{ .result = .{ .unknown = .{
        .name = name,
        .tokens = tokens,
    } } };
}

fn parse_custom_at_rule_without_block(
    comptime T: type,
    prelude: T.CustomAtRuleParser.Prelude,
    start: *const ParserState,
    options: *const ParserOptions,
    at_rule_parser: *T,
    is_nested: bool,
) Maybe(CssRule(T.CustomAtRuleParser.AtRule), void) {
    return switch (T.CustomAtRuleParser.ruleWithoutBlock(at_rule_parser, prelude, start, options, is_nested)) {
        .result => |v| .{ .result = CssRule(T.CustomAtRuleParser.AtRule){ .custom = v } },
        .err => |e| .{ .err = e },
    };
}

fn parse_custom_at_rule_body(
    comptime T: type,
    prelude: T.CustomAtRuleParser.Prelude,
    input: *Parser,
    start: *const ParserState,
    options: *const ParserOptions,
    at_rule_parser: *T,
    is_nested: bool,
) Result(T.CustomAtRuleParser.AtRule) {
    const result = switch (T.CustomAtRuleParser.parseBlock(at_rule_parser, prelude, start, input, options, is_nested)) {
        .result => |vv| vv,
        .err => |e| {
            _ = e; // autofix
            // match &err.kind {
            //   ParseErrorKind::Basic(kind) => ParseError {
            //     kind: ParseErrorKind::Basic(kind.clone()),
            //     location: err.location,
            //   },
            //   _ => input.new_error(BasicParseErrorKind::AtRuleBodyInvalid),
            // }
            todo("This part here", .{});
        },
    };
    return .{ .result = result };
}

fn parse_qualified_rule(
    start: *const ParserState,
    input: *Parser,
    comptime P: type,
    parser: *P,
    delimiters: Delimiters,
) Result(P.QualifiedRuleParser.QualifiedRule) {
    ValidQualifiedRuleParser(P);
    const prelude_result = brk: {
        const prelude = input.parseUntilBefore(delimiters, P.QualifiedRuleParser.Prelude, parser, P.QualifiedRuleParser.parsePrelude);
        break :brk prelude;
    };
    if (input.expectCurlyBracketBlock().asErr()) |e| return .{ .err = e };
    const prelude = switch (prelude_result) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    const Closure = struct {
        start: *const ParserState,
        prelude: P.QualifiedRuleParser.Prelude,
        parser: *P,

        pub fn parsefn(this: *@This(), input2: *Parser) Result(P.QualifiedRuleParser.QualifiedRule) {
            return P.QualifiedRuleParser.parseBlock(this.parser, this.prelude, this.start, input2);
        }
    };
    var closure = Closure{
        .start = start,
        .prelude = prelude,
        .parser = parser,
    };
    return parse_nested_block(input, P.QualifiedRuleParser.QualifiedRule, &closure, Closure.parsefn);
}

fn parse_until_before(
    parser: *Parser,
    delimiters_: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    comptime T: type,
    closure: anytype,
    comptime parse_fn: *const fn (@TypeOf(closure), *Parser) Result(T),
) Result(T) {
    const delimiters = parser.stop_before.bitwiseOr(delimiters_);
    const result = result: {
        var delimited_parser = Parser{
            .input = parser.input,
            .at_start_of = if (parser.at_start_of) |block_type| brk: {
                parser.at_start_of = null;
                break :brk block_type;
            } else null,
            .stop_before = delimiters,
            .import_records = parser.import_records,
        };
        const result = delimited_parser.parseEntirely(T, closure, parse_fn);
        if (error_behavior == .stop and result.isErr()) {
            return result;
        }
        if (delimited_parser.at_start_of) |block_type| {
            consume_until_end_of_block(block_type, &delimited_parser.input.tokenizer);
        }
        break :result result;
    };

    // FIXME: have a special-purpose tokenizer method for this that does less work.
    while (true) {
        if (delimiters.contains(Delimiters.fromByte(parser.input.tokenizer.nextByte()))) break;

        switch (parser.input.tokenizer.next()) {
            .result => |token| {
                if (BlockType.opening(&token)) |block_type| {
                    consume_until_end_of_block(block_type, &parser.input.tokenizer);
                }
            },
            else => break,
        }
    }

    return result;
}

// fn parse_until_before_impl(parser: *Parser, delimiters: Delimiters, error_behavior: Parse

pub fn parse_until_after(
    parser: *Parser,
    delimiters: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    comptime T: type,
    closure: anytype,
    comptime parsefn: *const fn (@TypeOf(closure), *Parser) Result(T),
) Result(T) {
    const result = parse_until_before(parser, delimiters, error_behavior, T, closure, parsefn);
    const is_err = result.isErr();
    if (error_behavior == .stop and is_err) {
        return result;
    }
    const next_byte = parser.input.tokenizer.nextByte();
    if (next_byte != null and !parser.stop_before.contains(Delimiters.fromByte(next_byte))) {
        bun.debugAssert(delimiters.contains(Delimiters.fromByte(next_byte)));
        // We know this byte is ASCII.
        parser.input.tokenizer.advance(1);
        if (next_byte == '{') {
            consume_until_end_of_block(BlockType.curly_bracket, &parser.input.tokenizer);
        }
    }
    return result;
}

fn parse_nested_block(parser: *Parser, comptime T: type, closure: anytype, comptime parsefn: *const fn (@TypeOf(closure), *Parser) Result(T)) Result(T) {
    const block_type: BlockType = if (parser.at_start_of) |block_type| brk: {
        parser.at_start_of = null;
        break :brk block_type;
    } else @panic(
        \\
        \\A nested parser can only be created when a Function,
        \\ParenthisisBlock, SquareBracketBlock, or CurlyBracketBlock
        \\token was just consumed.
    );

    const closing_delimiter = switch (block_type) {
        .curly_bracket => Delimiters{ .close_curly_bracket = true },
        .square_bracket => Delimiters{ .close_square_bracket = true },
        .parenthesis => Delimiters{ .close_parenthesis = true },
    };
    var nested_parser = Parser{
        .input = parser.input,
        .stop_before = closing_delimiter,
        .import_records = parser.import_records,
    };
    const result = nested_parser.parseEntirely(T, closure, parsefn);
    if (nested_parser.at_start_of) |block_type2| {
        consume_until_end_of_block(block_type2, &nested_parser.input.tokenizer);
    }
    consume_until_end_of_block(block_type, &parser.input.tokenizer);
    return result;
}

pub fn ValidQualifiedRuleParser(comptime T: type) void {
    // The intermediate representation of a qualified rule prelude.
    _ = T.QualifiedRuleParser.Prelude;

    // The finished representation of a qualified rule.
    _ = T.QualifiedRuleParser.QualifiedRule;

    // Parse the prelude of a qualified rule. For style rules, this is as Selector list.
    //
    // Return the representation of the prelude,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // The prelude is the part before the `{ /* ... */ }` block.
    //
    // The given `input` is a "delimited" parser
    // that ends where the prelude should end (before the next `{`).
    //
    // fn parsePrelude(this: *T, input: *Parser) Error!T.QualifiedRuleParser.Prelude;
    _ = T.QualifiedRuleParser.parsePrelude;

    // Parse the content of a `{ /* ... */ }` block for the body of the qualified rule.
    //
    // The location passed in is source location of the start of the prelude.
    //
    // Return the finished representation of the qualified rule
    // as returned by `RuleListParser::next`,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // fn parseBlock(this: *T, prelude: P.QualifiedRuleParser.Prelude, start: *const ParserState, input: *Parser) Error!P.QualifiedRuleParser.QualifiedRule;
    _ = T.QualifiedRuleParser.parseBlock;
}

pub const DefaultAtRule = struct {
    pub fn toCss(_: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return dest.newError(.fmt_error, null);
    }

    pub fn deepClone(_: *const @This(), _: std.mem.Allocator) @This() {
        return .{};
    }
};

pub const DefaultAtRuleParser = struct {
    const This = @This();

    pub const CustomAtRuleParser = struct {
        pub const Prelude = void;
        pub const AtRule = DefaultAtRule;

        pub fn parsePrelude(_: *This, name: []const u8, input: *Parser, _: *const ParserOptions) Result(Prelude) {
            return .{ .err = input.newError(BasicParseErrorKind{ .at_rule_invalid = name }) };
        }

        pub fn parseBlock(_: *This, _: CustomAtRuleParser.Prelude, _: *const ParserState, input: *Parser, _: *const ParserOptions, _: bool) Result(CustomAtRuleParser.AtRule) {
            return .{ .err = input.newError(BasicParseErrorKind.at_rule_body_invalid) };
        }

        pub fn ruleWithoutBlock(_: *This, _: CustomAtRuleParser.Prelude, _: *const ParserState, _: *const ParserOptions, _: bool) Maybe(CustomAtRuleParser.AtRule, void) {
            return .{ .err = {} };
        }

        pub fn onImportRule(_: *This, _: *ImportRule, _: u32, _: u32) void {}
    };
};

/// We may want to enable this later
pub const ENABLE_TAILWIND_PARSING = false;

pub const BundlerAtRule = if (ENABLE_TAILWIND_PARSING) TailwindAtRule else DefaultAtRule;
pub const BundlerAtRuleParser = struct {
    const This = @This();
    allocator: Allocator,
    import_records: *bun.BabyList(ImportRecord),
    options: *const ParserOptions,

    pub const CustomAtRuleParser = struct {
        pub const Prelude = if (ENABLE_TAILWIND_PARSING) union(enum) {
            tailwind: TailwindAtRule,
        } else void;
        pub const AtRule = if (ENABLE_TAILWIND_PARSING) TailwindAtRule else DefaultAtRule;

        pub fn parsePrelude(this: *This, name: []const u8, input: *Parser, _: *const ParserOptions) Result(Prelude) {
            if (comptime ENABLE_TAILWIND_PARSING) {
                const PreludeNames = enum {
                    tailwind,
                };
                const Map = comptime bun.ComptimeEnumMap(PreludeNames);
                if (Map.getASCIIICaseInsensitive(name)) |prelude| return switch (prelude) {
                    .tailwind => {
                        const loc_ = input.currentSourceLocation();
                        const loc = css_rules.Location{
                            .source_index = this.options.source_index,
                            .line = loc_.line,
                            .column = loc_.column,
                        };
                        const style_name = switch (css_rules.tailwind.TailwindStyleName.parse(input)) {
                            .result => |v| v,
                            .err => return .{ .err = input.newError(BasicParseErrorKind{ .at_rule_invalid = name }) },
                        };
                        return .{ .result = .{
                            .tailwind = .{
                                .style_name = style_name,
                                .loc = loc,
                            },
                        } };
                    },
                };
            }
            return .{ .err = input.newError(BasicParseErrorKind{ .at_rule_invalid = name }) };
        }

        pub fn parseBlock(_: *This, _: CustomAtRuleParser.Prelude, _: *const ParserState, input: *Parser, _: *const ParserOptions, _: bool) Result(CustomAtRuleParser.AtRule) {
            return .{ .err = input.newError(BasicParseErrorKind.at_rule_body_invalid) };
        }

        pub fn ruleWithoutBlock(_: *This, prelude: CustomAtRuleParser.Prelude, _: *const ParserState, _: *const ParserOptions, _: bool) Maybe(CustomAtRuleParser.AtRule, void) {
            if (comptime ENABLE_TAILWIND_PARSING) {
                return switch (prelude) {
                    .tailwind => |v| return .{ .result = v },
                };
            }
            return .{ .err = {} };
        }

        pub fn onImportRule(this: *This, import_rule: *ImportRule, start_position: u32, end_position: u32) void {
            const import_record_index = this.import_records.len;
            import_rule.import_record_idx = import_record_index;
            this.import_records.push(this.allocator, ImportRecord{
                .path = bun.fs.Path.init(import_rule.url),
                .kind = if (import_rule.supports != null) .at_conditional else .at,
                .range = bun.logger.Range{
                    .loc = bun.logger.Loc{ .start = @intCast(start_position) },
                    .len = @intCast(end_position - start_position),
                },
            }) catch bun.outOfMemory();
        }
    };
};

/// Same as `ValidAtRuleParser` but modified to provide parser options
///
/// Also added:
/// - onImportRule to handle @import rules
pub fn ValidCustomAtRuleParser(comptime T: type) void {
    // The intermediate representation of prelude of an at-rule.
    _ = T.CustomAtRuleParser.Prelude;

    // The finished representation of an at-rule.
    _ = T.CustomAtRuleParser.AtRule;

    // Parse the prelude of an at-rule with the given `name`.
    //
    // Return the representation of the prelude and the type of at-rule,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // The prelude is the part after the at-keyword
    // and before the `;` semicolon or `{ /* ... */ }` block.
    //
    // At-rule name matching should be case-insensitive in the ASCII range.
    // This can be done with `std::ascii::Ascii::eq_ignore_ascii_case`,
    // or with the `match_ignore_ascii_case!` macro.
    //
    // The given `input` is a "delimited" parser
    // that ends wherever the prelude should end.
    // (Before the next semicolon, the next `{`, or the end of the current block.)
    //
    // pub fn parsePrelude(this: *T, allocator: Allocator, name: []const u8, *Parser, options: *ParserOptions) Result(T.CustomAtRuleParser.Prelude) {}
    _ = T.CustomAtRuleParser.parsePrelude;

    // End an at-rule which doesn't have block. Return the finished
    // representation of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    // `is_nested` indicates whether the rule is nested inside a style rule.
    //
    // This is only called when either the `;` semicolon indeed follows the prelude,
    // or parser is at the end of the input.
    _ = T.CustomAtRuleParser.ruleWithoutBlock;

    // Parse the content of a `{ /* ... */ }` block for the body of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    // `is_nested` indicates whether the rule is nested inside a style rule.
    //
    // Return the finished representation of the at-rule
    // as returned by `RuleListParser::next` or `DeclarationListParser::next`,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // This is only called when a block was found following the prelude.
    _ = T.CustomAtRuleParser.parseBlock;

    _ = T.CustomAtRuleParser.onImportRule;
}

pub fn ValidAtRuleParser(comptime T: type) void {
    _ = T.AtRuleParser.AtRule;
    _ = T.AtRuleParser.Prelude;

    // Parse the prelude of an at-rule with the given `name`.
    //
    // Return the representation of the prelude and the type of at-rule,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // The prelude is the part after the at-keyword
    // and before the `;` semicolon or `{ /* ... */ }` block.
    //
    // At-rule name matching should be case-insensitive in the ASCII range.
    // This can be done with `std::ascii::Ascii::eq_ignore_ascii_case`,
    // or with the `match_ignore_ascii_case!` macro.
    //
    // The given `input` is a "delimited" parser
    // that ends wherever the prelude should end.
    // (Before the next semicolon, the next `{`, or the end of the current block.)
    //
    // pub fn parsePrelude(this: *T, allocator: Allocator, name: []const u8, *Parser) Result(T.AtRuleParser.Prelude) {}
    _ = T.AtRuleParser.parsePrelude;

    // End an at-rule which doesn't have block. Return the finished
    // representation of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    //
    // This is only called when `parse_prelude` returned `WithoutBlock`, and
    // either the `;` semicolon indeed follows the prelude, or parser is at
    // the end of the input.
    // fn ruleWithoutBlock(this: *T, allocator: Allocator, prelude: T.AtRuleParser.Prelude, state: *const ParserState) Maybe(T.AtRuleParser.AtRule, void)
    _ = T.AtRuleParser.ruleWithoutBlock;

    // Parse the content of a `{ /* ... */ }` block for the body of the at-rule.
    //
    // The location passed in is source location of the start of the prelude.
    //
    // Return the finished representation of the at-rule
    // as returned by `RuleListParser::next` or `DeclarationListParser::next`,
    // or `Err(())` to ignore the entire at-rule as invalid.
    //
    // This is only called when `parse_prelude` returned `WithBlock`, and a block
    // was indeed found following the prelude.
    //
    // fn parseBlock(this: *T, prelude: T.AtRuleParser.Prelude, start: *const ParserState, input: *Parser) Error!T.AtRuleParser.AtRule
    _ = T.AtRuleParser.parseBlock;
}

pub fn AtRulePrelude(comptime T: type) type {
    return union(enum) {
        font_face,
        font_feature_values,
        font_palette_values: DashedIdent,
        counter_style: CustomIdent,
        import: struct {
            []const u8,
            MediaList,
            ?SupportsCondition,
            ?struct { value: ?LayerName },
        },
        namespace: struct {
            ?[]const u8,
            []const u8,
        },
        charset,
        custom_media: struct {
            DashedIdent,
            MediaList,
        },
        property: struct {
            DashedIdent,
        },
        media: MediaList,
        supports: SupportsCondition,
        viewport: VendorPrefix,
        keyframes: struct {
            name: css_rules.keyframes.KeyframesName,
            prefix: VendorPrefix,
        },
        page: ArrayList(css_rules.page.PageSelector),
        moz_document,
        layer: ArrayList(LayerName),
        container: struct {
            name: ?css_rules.container.ContainerName,
            condition: css_rules.container.ContainerCondition,
        },
        starting_style,
        nest: selector.parser.SelectorList,
        scope: struct {
            scope_start: ?selector.parser.SelectorList,
            scope_end: ?selector.parser.SelectorList,
        },
        unknown: struct {
            name: []const u8,
            /// The tokens of the prelude
            tokens: TokenList,
        },
        custom: T,

        pub fn allowedInStyleRule(this: *const @This()) bool {
            return switch (this.*) {
                .media, .supports, .container, .moz_document, .layer, .starting_style, .scope, .nest, .unknown, .custom => true,
                .namespace, .font_face, .font_feature_values, .font_palette_values, .counter_style, .keyframes, .page, .property, .import, .custom_media, .viewport, .charset => false,
            };
        }
    };
}

pub fn TopLevelRuleParser(comptime AtRuleParserT: type) type {
    ValidCustomAtRuleParser(AtRuleParserT);
    const AtRuleT = AtRuleParserT.CustomAtRuleParser.AtRule;
    const AtRulePreludeT = AtRulePrelude(AtRuleParserT.CustomAtRuleParser.Prelude);

    return struct {
        allocator: Allocator,
        options: *const ParserOptions,
        state: State,
        at_rule_parser: *AtRuleParserT,
        // TODO: think about memory management
        rules: *CssRuleList(AtRuleT),

        const State = enum(u8) {
            start = 1,
            layers = 2,
            imports = 3,
            namespaces = 4,
            body = 5,
        };

        const This = @This();

        pub const AtRuleParser = struct {
            pub const Prelude = AtRulePreludeT;
            pub const AtRule = void;

            pub fn parsePrelude(this: *This, name: []const u8, input: *Parser) Result(Prelude) {
                const PreludeEnum = enum {
                    import,
                    charset,
                    namespace,
                    @"custom-media",
                    property,
                };
                const Map = comptime bun.ComptimeEnumMap(PreludeEnum);

                if (Map.getASCIIICaseInsensitive(name)) |prelude| {
                    switch (prelude) {
                        .import => {
                            if (@intFromEnum(this.state) > @intFromEnum(State.imports)) {
                                return .{ .err = input.newCustomError(@as(ParserError, ParserError.unexpected_import_rule)) };
                            }
                            const url_str = switch (input.expectUrlOrString()) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };

                            const layer: ?struct { value: ?LayerName } =
                                if (input.tryParse(Parser.expectIdentMatching, .{"layer"}) == .result)
                                .{ .value = null }
                            else if (input.tryParse(Parser.expectFunctionMatching, .{"layer"}) == .result) brk: {
                                break :brk .{
                                    .value = switch (input.parseNestedBlock(LayerName, {}, voidWrap(LayerName, LayerName.parse))) {
                                        .result => |v| v,
                                        .err => |e| return .{ .err = e },
                                    },
                                };
                            } else null;

                            const supports = if (input.tryParse(Parser.expectFunctionMatching, .{"supports"}) == .result) brk: {
                                const Func = struct {
                                    pub fn do(_: void, p: *Parser) Result(SupportsCondition) {
                                        const result = p.tryParse(SupportsCondition.parse, .{});
                                        if (result == .err) return SupportsCondition.parseDeclaration(p);
                                        return result;
                                    }
                                };
                                break :brk switch (input.parseNestedBlock(SupportsCondition, {}, Func.do)) {
                                    .result => |v| v,
                                    .err => |e| return .{ .err = e },
                                };
                            } else null;

                            const media = switch (MediaList.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };

                            return .{
                                .result = .{
                                    .import = .{
                                        url_str,
                                        media,
                                        supports,
                                        if (layer) |l| .{ .value = if (l.value) |ll| ll else null } else null,
                                    },
                                },
                            };
                        },
                        .namespace => {
                            if (@intFromEnum(this.state) > @intFromEnum(State.namespaces)) {
                                return .{ .err = input.newCustomError(ParserError{ .unexpected_namespace_rule = {} }) };
                            }

                            const prefix = switch (input.tryParse(Parser.expectIdent, .{})) {
                                .result => |v| v,
                                .err => null,
                            };
                            const namespace = switch (input.expectUrlOrString()) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            return .{ .result = .{ .namespace = .{ prefix, namespace } } };
                        },
                        .charset => {
                            // @charset is removed by rust-cssparser if it's the first rule in the stylesheet.
                            // Anything left is technically invalid, however, users often concatenate CSS files
                            // together, so we are more lenient and simply ignore @charset rules in the middle of a file.
                            if (input.expectString().asErr()) |e| return .{ .err = e };
                            return .{ .result = .charset };
                        },
                        .@"custom-media" => {
                            const custom_media_name = switch (DashedIdentFns.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            const media = switch (MediaList.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            return .{
                                .result = .{
                                    .custom_media = .{
                                        custom_media_name,
                                        media,
                                    },
                                },
                            };
                        },
                        .property => {
                            const property_name = switch (DashedIdentFns.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            return .{ .result = .{ .property = .{property_name} } };
                        },
                    }
                }

                const Nested = NestedRuleParser(AtRuleParserT);
                var nested_rule_parser: Nested = this.nested();
                return Nested.AtRuleParser.parsePrelude(&nested_rule_parser, name, input);
            }

            pub fn parseBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState, input: *Parser) Result(AtRuleParser.AtRule) {
                this.state = .body;
                var nested_parser = this.nested();
                return NestedRuleParser(AtRuleParserT).AtRuleParser.parseBlock(&nested_parser, prelude, start, input);
            }

            pub fn ruleWithoutBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState) Maybe(AtRuleParser.AtRule, void) {
                const loc_ = start.sourceLocation();
                const loc = css_rules.Location{
                    .source_index = this.options.source_index,
                    .line = loc_.line,
                    .column = loc_.column,
                };

                switch (prelude) {
                    .import => {
                        this.state = State.imports;
                        var import_rule = ImportRule{
                            .url = prelude.import[0],
                            .media = prelude.import[1],
                            .supports = prelude.import[2],
                            .layer = if (prelude.import[3]) |v| .{ .v = v.value } else null,
                            .loc = loc,
                        };
                        AtRuleParserT.CustomAtRuleParser.onImportRule(this.at_rule_parser, &import_rule, @intCast(start.position), @intCast(start.position + 1));
                        this.rules.v.append(this.allocator, .{
                            .import = import_rule,
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .namespace => {
                        this.state = State.namespaces;

                        const prefix = prelude.namespace[0];
                        const url = prelude.namespace[1];

                        this.rules.v.append(this.allocator, .{
                            .namespace = NamespaceRule{
                                .prefix = if (prefix) |p| .{ .v = p } else null,
                                .url = url,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();

                        return .{ .result = {} };
                    },
                    .custom_media => {
                        const name = prelude.custom_media[0];
                        const query = prelude.custom_media[1];
                        this.state = State.body;
                        this.rules.v.append(
                            this.allocator,
                            .{
                                .custom_media = css_rules.custom_media.CustomMediaRule{
                                    .name = name,
                                    .query = query,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .layer => {
                        if (@intFromEnum(this.state) <= @intFromEnum(State.layers)) {
                            this.state = .layers;
                        } else {
                            this.state = .body;
                        }
                        var nested_parser = this.nested();
                        return NestedRuleParser(AtRuleParserT).AtRuleParser.ruleWithoutBlock(&nested_parser, prelude, start);
                    },
                    .charset => return .{ .result = {} },
                    .unknown => {
                        const name = prelude.unknown.name;
                        const prelude2 = prelude.unknown.tokens;
                        this.rules.v.append(this.allocator, .{ .unknown = UnknownAtRule{
                            .name = name,
                            .prelude = prelude2,
                            .block = null,
                            .loc = loc,
                        } }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .custom => {
                        this.state = .body;
                        var nested_parser = this.nested();
                        return NestedRuleParser(AtRuleParserT).AtRuleParser.ruleWithoutBlock(&nested_parser, prelude, start);
                    },
                    else => return .{ .err = {} },
                }
            }
        };

        pub const QualifiedRuleParser = struct {
            pub const Prelude = selector.parser.SelectorList;
            pub const QualifiedRule = void;

            pub fn parsePrelude(this: *This, input: *Parser) Result(Prelude) {
                this.state = .body;
                var nested_parser = this.nested();
                const N = @TypeOf(nested_parser);
                return N.QualifiedRuleParser.parsePrelude(&nested_parser, input);
            }

            pub fn parseBlock(this: *This, prelude: Prelude, start: *const ParserState, input: *Parser) Result(QualifiedRule) {
                var nested_parser = this.nested();
                const N = @TypeOf(nested_parser);
                return N.QualifiedRuleParser.parseBlock(&nested_parser, prelude, start, input);
            }
        };

        pub fn new(allocator: Allocator, options: *const ParserOptions, at_rule_parser: *AtRuleParserT, rules: *CssRuleList(AtRuleT)) @This() {
            return .{
                .options = options,
                .state = .start,
                .at_rule_parser = at_rule_parser,
                .rules = rules,
                .allocator = allocator,
            };
        }

        pub fn nested(this: *This) NestedRuleParser(AtRuleParserT) {
            return NestedRuleParser(AtRuleParserT){
                .options = this.options,
                .at_rule_parser = this.at_rule_parser,
                .declarations = DeclarationList{},
                .important_declarations = DeclarationList{},
                .rules = this.rules,
                .is_in_style_rule = false,
                .allow_declarations = false,
                .allocator = this.allocator,
            };
        }
    };
}

pub fn NestedRuleParser(comptime T: type) type {
    ValidCustomAtRuleParser(T);

    const AtRuleT = T.CustomAtRuleParser.AtRule;

    return struct {
        options: *const ParserOptions,
        at_rule_parser: *T,
        // todo_stuff.think_mem_mgmt
        declarations: DeclarationList,
        // todo_stuff.think_mem_mgmt
        important_declarations: DeclarationList,
        // todo_stuff.think_mem_mgmt
        rules: *CssRuleList(T.CustomAtRuleParser.AtRule),
        is_in_style_rule: bool,
        allow_declarations: bool,
        allocator: Allocator,

        const This = @This();

        pub fn getLoc(this: *This, start: *const ParserState) Location {
            const loc = start.sourceLocation();
            return Location{
                .source_index = this.options.source_index,
                .line = loc.line,
                .column = loc.column,
            };
        }

        pub const AtRuleParser = struct {
            pub const Prelude = AtRulePrelude(T.CustomAtRuleParser.Prelude);
            pub const AtRule = void;

            pub fn parsePrelude(this: *This, name: []const u8, input: *Parser) Result(Prelude) {
                const result: Prelude = brk: {
                    const PreludeEnum = enum {
                        media,
                        supports,
                        @"font-face",
                        @"font-palette-values",
                        @"counter-style",
                        viewport,
                        keyframes,
                        @"-ms-viewport",
                        @"-moz-keyframes",
                        @"-o-keyframes",
                        @"-ms-keyframes",
                        page,
                        @"-moz-document",
                        layer,
                        container,
                        @"starting-style",
                        scope,
                        nest,
                    };
                    const Map = comptime bun.ComptimeEnumMap(PreludeEnum);
                    if (Map.getASCIIICaseInsensitive(name)) |kind| switch (kind) {
                        .media => {
                            const media = switch (MediaList.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            break :brk .{ .media = media };
                        },
                        .supports => {
                            const cond = switch (SupportsCondition.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            break :brk .{ .supports = cond };
                        },
                        .@"font-face" => break :brk .font_face,
                        .@"font-palette-values" => {
                            const dashed_ident_name = switch (DashedIdentFns.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            break :brk .{ .font_palette_values = dashed_ident_name };
                        },
                        .@"counter-style" => {
                            const custom_name = switch (CustomIdentFns.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            break :brk .{ .counter_style = custom_name };
                        },
                        .viewport, .@"-ms-viewport" => {
                            const prefix: VendorPrefix = if (bun.strings.startsWithCaseInsensitiveAscii(name, "-ms")) VendorPrefix{ .ms = true } else VendorPrefix{ .none = true };
                            break :brk .{ .viewport = prefix };
                        },
                        .keyframes, .@"-moz-keyframes", .@"-o-keyframes", .@"-ms-keyframes" => {
                            const prefix: VendorPrefix = if (bun.strings.startsWithCaseInsensitiveAscii(name, "-webkit"))
                                VendorPrefix{ .webkit = true }
                            else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-moz-"))
                                VendorPrefix{ .moz = true }
                            else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-o-"))
                                VendorPrefix{ .o = true }
                            else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-ms-")) VendorPrefix{ .ms = true } else VendorPrefix{ .none = true };

                            const keyframes_name = switch (input.tryParse(css_rules.keyframes.KeyframesName.parse, .{})) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            break :brk .{ .keyframes = .{ .name = keyframes_name, .prefix = prefix } };
                        },
                        .page => {
                            const Fn = struct {
                                pub fn parsefn(input2: *Parser) Result(ArrayList(css_rules.page.PageSelector)) {
                                    return input2.parseCommaSeparated(css_rules.page.PageSelector, css_rules.page.PageSelector.parse);
                                }
                            };
                            const selectors = switch (input.tryParse(Fn.parsefn, .{})) {
                                .result => |v| v,
                                .err => ArrayList(css_rules.page.PageSelector){},
                            };
                            break :brk .{ .page = selectors };
                        },
                        .@"-moz-document" => {
                            // Firefox only supports the url-prefix() function with no arguments as a legacy CSS hack.
                            // See https://css-tricks.com/snippets/css/css-hacks-targeting-firefox/
                            if (input.expectFunctionMatching("url-prefix").asErr()) |e| return .{ .err = e };
                            const Fn = struct {
                                pub fn parsefn(_: void, input2: *Parser) Result(void) {
                                    // Firefox also allows an empty string as an argument...
                                    // https://github.com/mozilla/gecko-dev/blob/0077f2248712a1b45bf02f0f866449f663538164/servo/components/style/stylesheets/document_rule.rs#L303
                                    _ = input2.tryParse(parseInner, .{});
                                    if (input2.expectExhausted().asErr()) |e| return .{ .err = e };
                                    return .{ .result = {} };
                                }
                                fn parseInner(input2: *Parser) Result(void) {
                                    const s = switch (input2.expectString()) {
                                        .err => |e| return .{ .err = e },
                                        .result => |v| v,
                                    };
                                    if (s.len > 0) {
                                        return .{ .err = input2.newCustomError(ParserError.invalid_value) };
                                    }
                                    return .{ .result = {} };
                                }
                            };
                            if (input.parseNestedBlock(void, {}, Fn.parsefn).asErr()) |e| return .{ .err = e };
                            break :brk .moz_document;
                        },
                        .layer => {
                            const names = switch (input.parseList(LayerName, LayerName.parse)) {
                                .result => |vv| vv,
                                .err => |e| names: {
                                    if (e.kind == .basic and e.kind.basic == .end_of_input) {
                                        break :names ArrayList(LayerName){};
                                    }
                                    return .{ .err = e };
                                },
                            };

                            break :brk .{ .layer = names };
                        },
                        .container => {
                            const container_name = switch (input.tryParse(css_rules.container.ContainerName.parse, .{})) {
                                .result => |vv| vv,
                                .err => null,
                            };
                            const condition = switch (css_rules.container.ContainerCondition.parse(input)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };
                            break :brk .{ .container = .{ .name = container_name, .condition = condition } };
                        },
                        .@"starting-style" => break :brk .starting_style,
                        .scope => {
                            var selector_parser = selector.parser.SelectorParser{
                                .is_nesting_allowed = true,
                                .options = this.options,
                                .allocator = input.allocator(),
                            };
                            const Closure = struct {
                                selector_parser: *selector.parser.SelectorParser,
                                pub fn parsefn(self: *@This(), input2: *Parser) Result(selector.parser.SelectorList) {
                                    return selector.parser.SelectorList.parseRelative(self.selector_parser, input2, .ignore_invalid_selector, .none);
                                }
                            };
                            var closure = Closure{
                                .selector_parser = &selector_parser,
                            };

                            const scope_start = if (input.tryParse(Parser.expectParenthesisBlock, .{}).isOk()) scope_start: {
                                break :scope_start switch (input.parseNestedBlock(selector.parser.SelectorList, &closure, Closure.parsefn)) {
                                    .result => |v| v,
                                    .err => |e| return .{ .err = e },
                                };
                            } else null;

                            const scope_end = if (input.tryParse(Parser.expectIdentMatching, .{"to"}).isOk()) scope_end: {
                                if (input.expectParenthesisBlock().asErr()) |e| return .{ .err = e };
                                break :scope_end switch (input.parseNestedBlock(selector.parser.SelectorList, &closure, Closure.parsefn)) {
                                    .result => |v| v,
                                    .err => |e| return .{ .err = e },
                                };
                            } else null;

                            break :brk .{
                                .scope = .{
                                    .scope_start = scope_start,
                                    .scope_end = scope_end,
                                },
                            };
                        },
                        .nest => {
                            if (this.is_in_style_rule) {
                                this.options.warn(input.newCustomError(ParserError{ .deprecated_nest_rule = {} }));
                                var selector_parser = selector.parser.SelectorParser{
                                    .is_nesting_allowed = true,
                                    .options = this.options,
                                    .allocator = input.allocator(),
                                };
                                const selectors = switch (selector.parser.SelectorList.parse(&selector_parser, input, .discard_list, .contained)) {
                                    .err => |e| return .{ .err = e },
                                    .result => |v| v,
                                };
                                break :brk .{ .nest = selectors };
                            }
                        },
                    };

                    switch (parse_custom_at_rule_prelude(
                        name,
                        input,
                        this.options,
                        T,
                        this.at_rule_parser,
                    )) {
                        .result => |v| break :brk v,
                        .err => |e| return .{ .err = e },
                    }
                };

                if (this.is_in_style_rule and !result.allowedInStyleRule()) {
                    return .{ .err = input.newError(BasicParseErrorKind{ .at_rule_invalid = name }) };
                }

                return .{ .result = result };
            }

            pub fn parseBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState, input: *Parser) Result(AtRuleParser.AtRule) {
                const loc = this.getLoc(start);
                switch (prelude) {
                    .font_face => {
                        var decl_parser = css_rules.font_face.FontFaceDeclarationParser{};
                        var parser = RuleBodyParser(css_rules.font_face.FontFaceDeclarationParser).new(input, &decl_parser);
                        // todo_stuff.think_mem_mgmt
                        var properties: ArrayList(css_rules.font_face.FontFaceProperty) = .{};

                        while (parser.next()) |result| {
                            if (result.asValue()) |decl| {
                                properties.append(
                                    input.allocator(),
                                    decl,
                                ) catch bun.outOfMemory();
                            }
                        }

                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .font_face = css_rules.font_face.FontFaceRule{
                                    .properties = properties,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .font_palette_values => {
                        const name = prelude.font_palette_values;
                        const rule = switch (css_rules.font_palette_values.FontPaletteValuesRule.parse(name, input, loc)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(
                            input.allocator(),
                            .{ .font_palette_values = rule },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .counter_style => {
                        const name = prelude.counter_style;
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .counter_style = css_rules.counter_style.CounterStyleRule{
                                    .name = name,
                                    .declarations = switch (DeclarationBlock.parse(input, this.options)) {
                                        .err => |e| return .{ .err = e },
                                        .result => |v| v,
                                    },
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .media => {
                        const query = prelude.media;
                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .media = css_rules.media.MediaRule(T.CustomAtRuleParser.AtRule){
                                    .query = query,
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .supports => {
                        const condition = prelude.supports;
                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(input.allocator(), .{
                            .supports = css_rules.supports.SupportsRule(T.CustomAtRuleParser.AtRule){
                                .condition = condition,
                                .rules = rules,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .container => {
                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .container = css_rules.container.ContainerRule(T.CustomAtRuleParser.AtRule){
                                    .name = prelude.container.name,
                                    .condition = prelude.container.condition,
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .scope => {
                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .scope = css_rules.scope.ScopeRule(T.CustomAtRuleParser.AtRule){
                                    .scope_start = prelude.scope.scope_start,
                                    .scope_end = prelude.scope.scope_end,
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .viewport => {
                        this.rules.v.append(input.allocator(), .{
                            .viewport = css_rules.viewport.ViewportRule{
                                .vendor_prefix = prelude.viewport,
                                .declarations = switch (DeclarationBlock.parse(input, this.options)) {
                                    .err => |e| return .{ .err = e },
                                    .result => |v| v,
                                },
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .keyframes => {
                        var parser = css_rules.keyframes.KeyframesListParser{};
                        var iter = RuleBodyParser(css_rules.keyframes.KeyframesListParser).new(input, &parser);
                        // todo_stuff.think_mem_mgmt
                        var keyframes = ArrayList(css_rules.keyframes.Keyframe){};

                        while (iter.next()) |result| {
                            if (result.asValue()) |keyframe| {
                                keyframes.append(
                                    input.allocator(),
                                    keyframe,
                                ) catch bun.outOfMemory();
                            }
                        }

                        this.rules.v.append(input.allocator(), .{
                            .keyframes = css_rules.keyframes.KeyframesRule{
                                .name = prelude.keyframes.name,
                                .keyframes = keyframes,
                                .vendor_prefix = prelude.keyframes.prefix,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .page => {
                        const selectors = prelude.page;
                        const rule = switch (css_rules.page.PageRule.parse(selectors, input, loc, this.options)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(
                            input.allocator(),
                            .{ .page = rule },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .moz_document => {
                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(input.allocator(), .{
                            .moz_document = css_rules.document.MozDocumentRule(T.CustomAtRuleParser.AtRule){
                                .rules = rules,
                                .loc = loc,
                            },
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .layer => {
                        const name = if (prelude.layer.items.len == 0) null else if (prelude.layer.items.len == 1) names: {
                            var out: LayerName = .{};
                            std.mem.swap(LayerName, &out, &prelude.layer.items[0]);
                            break :names out;
                        } else return .{ .err = input.newError(.at_rule_body_invalid) };

                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };

                        this.rules.v.append(input.allocator(), .{
                            .layer_block = css_rules.layer.LayerBlockRule(T.CustomAtRuleParser.AtRule){ .name = name, .rules = rules, .loc = loc },
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .property => {
                        const name = prelude.property[0];
                        this.rules.v.append(input.allocator(), .{
                            .property = switch (css_rules.property.PropertyRule.parse(name, input, loc)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            },
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .import, .namespace, .custom_media, .charset => {
                        // These rules don't have blocks
                        return .{ .err = input.newUnexpectedTokenError(.open_curly) };
                    },
                    .starting_style => {
                        const rules = switch (this.parseStyleBlock(input)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .starting_style = css_rules.starting_style.StartingStyleRule(T.CustomAtRuleParser.AtRule){
                                    .rules = rules,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .nest => {
                        const selectors = prelude.nest;
                        const result = switch (this.parseNested(input, true)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        const declarations = result[0];
                        const rules = result[1];
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .nesting = css_rules.nesting.NestingRule(T.CustomAtRuleParser.AtRule){
                                    .style = css_rules.style.StyleRule(T.CustomAtRuleParser.AtRule){
                                        .selectors = selectors,
                                        .declarations = declarations,
                                        .vendor_prefix = VendorPrefix.empty(),
                                        .rules = rules,
                                        .loc = loc,
                                    },
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .font_feature_values => bun.unreachablePanic("", .{}),
                    .unknown => {
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .unknown = css_rules.unknown.UnknownAtRule{
                                    .name = prelude.unknown.name,
                                    .prelude = prelude.unknown.tokens,
                                    .block = switch (TokenListFns.parse(input, this.options, 0)) {
                                        .err => |e| return .{ .err = e },
                                        .result => |v| v,
                                    },
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .custom => {
                        this.rules.v.append(
                            input.allocator(),
                            .{
                                .custom = switch (parse_custom_at_rule_body(T, prelude.custom, input, start, this.options, this.at_rule_parser, this.is_in_style_rule)) {
                                    .err => |e| return .{ .err = e },
                                    .result => |v| v,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                }
            }

            pub fn ruleWithoutBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const ParserState) Maybe(AtRuleParser.AtRule, void) {
                const loc = this.getLoc(start);
                switch (prelude) {
                    .layer => {
                        if (this.is_in_style_rule or prelude.layer.items.len == 0) {
                            return .{ .err = {} };
                        }

                        this.rules.v.append(
                            this.allocator,
                            .{
                                .layer_statement = css_rules.layer.LayerStatementRule{
                                    .names = prelude.layer,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .unknown => {
                        this.rules.v.append(
                            this.allocator,
                            .{
                                .unknown = css_rules.unknown.UnknownAtRule{
                                    .name = prelude.unknown.name,
                                    .prelude = prelude.unknown.tokens,
                                    .block = null,
                                    .loc = loc,
                                },
                            },
                        ) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    .custom => {
                        this.rules.v.append(this.allocator, switch (parse_custom_at_rule_without_block(
                            T,
                            prelude.custom,
                            start,
                            this.options,
                            this.at_rule_parser,
                            this.is_in_style_rule,
                        )) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        }) catch bun.outOfMemory();
                        return .{ .result = {} };
                    },
                    else => return .{ .err = {} },
                }
            }
        };

        pub const QualifiedRuleParser = struct {
            pub const Prelude = selector.parser.SelectorList;
            pub const QualifiedRule = void;

            pub fn parsePrelude(this: *This, input: *Parser) Result(Prelude) {
                var selector_parser = selector.parser.SelectorParser{
                    .is_nesting_allowed = true,
                    .options = this.options,
                    .allocator = input.allocator(),
                };

                if (this.is_in_style_rule) {
                    return selector.parser.SelectorList.parseRelative(&selector_parser, input, .discard_list, .implicit);
                } else {
                    return selector.parser.SelectorList.parse(&selector_parser, input, .discard_list, .none);
                }
            }

            pub fn parseBlock(this: *This, selectors: Prelude, start: *const ParserState, input: *Parser) Result(QualifiedRule) {
                const loc = this.getLoc(start);
                const result = switch (this.parseNested(input, true)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                const declarations = result[0];
                const rules = result[1];

                this.rules.v.append(this.allocator, .{
                    .style = StyleRule(AtRuleT){
                        .selectors = selectors,
                        .vendor_prefix = VendorPrefix{},
                        .declarations = declarations,
                        .rules = rules,
                        .loc = loc,
                    },
                }) catch bun.outOfMemory();

                return Result(QualifiedRule).success;
            }
        };

        pub const RuleBodyItemParser = struct {
            pub fn parseQualified(this: *This) bool {
                _ = this; // autofix
                return true;
            }

            pub fn parseDeclarations(this: *This) bool {
                return this.allow_declarations;
            }
        };

        pub const DeclarationParser = struct {
            pub const Declaration = void;

            pub fn parseValue(this: *This, name: []const u8, input: *Parser) Result(Declaration) {
                return css_decls.parse_declaration(
                    name,
                    input,
                    &this.declarations,
                    &this.important_declarations,
                    this.options,
                );
            }
        };

        pub fn parseNested(this: *This, input: *Parser, is_style_rule: bool) Result(struct { DeclarationBlock, CssRuleList(T.CustomAtRuleParser.AtRule) }) {
            // TODO: think about memory management in error cases
            var rules = CssRuleList(T.CustomAtRuleParser.AtRule){};
            var nested_parser = This{
                .allocator = input.allocator(),
                .options = this.options,
                .at_rule_parser = this.at_rule_parser,
                .declarations = DeclarationList{},
                .important_declarations = DeclarationList{},
                .rules = &rules,
                .is_in_style_rule = this.is_in_style_rule or is_style_rule,
                .allow_declarations = this.allow_declarations or this.is_in_style_rule or is_style_rule,
            };

            const parse_declarations = This.RuleBodyItemParser.parseDeclarations(&nested_parser);
            // TODO: think about memory management
            var errors = ArrayList(ParseError(ParserError)){};
            var iter = RuleBodyParser(This).new(input, &nested_parser);

            while (iter.next()) |result| {
                if (result.asErr()) |e| {
                    if (parse_declarations) {
                        iter.parser.declarations.clearRetainingCapacity();
                        iter.parser.important_declarations.clearRetainingCapacity();
                        errors.append(
                            this.allocator,
                            e,
                        ) catch bun.outOfMemory();
                    } else {
                        if (iter.parser.options.error_recovery) {
                            iter.parser.options.warn(e);
                            continue;
                        }
                        return .{ .err = e };
                    }
                }
            }

            if (parse_declarations) {
                if (errors.items.len > 0) {
                    if (this.options.error_recovery) {
                        for (errors.items) |e| {
                            this.options.warn(e);
                        }
                    } else {
                        return .{ .err = errors.orderedRemove(0) };
                    }
                }
            }

            return .{
                .result = .{
                    DeclarationBlock{
                        .declarations = nested_parser.declarations,
                        .important_declarations = nested_parser.important_declarations,
                    },
                    rules,
                },
            };
        }

        pub fn parseStyleBlock(this: *This, input: *Parser) Result(CssRuleList(T.CustomAtRuleParser.AtRule)) {
            const srcloc = input.currentSourceLocation();
            const loc = Location{
                .source_index = this.options.source_index,
                .line = srcloc.line,
                .column = srcloc.column,
            };

            // Declarations can be immediately within @media and @supports blocks that are nested within a parent style rule.
            // These act the same way as if they were nested within a `& { ... }` block.
            const declarations, var rules = switch (this.parseNested(input, false)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };

            if (declarations.len() > 0) {
                rules.v.insert(
                    input.allocator(),
                    0,
                    .{
                        .style = StyleRule(T.CustomAtRuleParser.AtRule){
                            .selectors = selector.parser.SelectorList.fromSelector(
                                input.allocator(),
                                selector.parser.Selector.fromComponent(input.allocator(), .nesting),
                            ),
                            .declarations = declarations,
                            .vendor_prefix = VendorPrefix.empty(),
                            .rules = .{},
                            .loc = loc,
                        },
                    },
                ) catch unreachable;
            }

            return .{ .result = rules };
        }
    };
}

pub fn StyleSheetParser(comptime P: type) type {
    ValidAtRuleParser(P);
    ValidQualifiedRuleParser(P);

    if (P.QualifiedRuleParser.QualifiedRule != P.AtRuleParser.AtRule) {
        @compileError("StyleSheetParser: P.QualifiedRuleParser.QualifiedRule != P.AtRuleParser.AtRule");
    }

    const Item = P.AtRuleParser.AtRule;

    return struct {
        input: *Parser,
        parser: *P,
        any_rule_so_far: bool = false,

        pub fn new(input: *Parser, parser: *P) @This() {
            return .{
                .input = input,
                .parser = parser,
            };
        }

        pub fn next(this: *@This(), allocator: Allocator) ?(Result(Item)) {
            while (true) {
                this.input.@"skip cdc and cdo"();

                const start = this.input.state();
                const at_keyword: ?[]const u8 = switch (this.input.nextByte() orelse return null) {
                    '@' => brk: {
                        const at_keyword: *Token = switch (this.input.nextIncludingWhitespaceAndComments()) {
                            .result => |vv| vv,
                            .err => {
                                this.input.reset(&start);
                                break :brk null;
                            },
                        };

                        if (at_keyword.* == .at_keyword) break :brk at_keyword.at_keyword;
                        this.input.reset(&start);
                        break :brk null;
                    },
                    else => null,
                };

                if (at_keyword) |name| {
                    const first_stylesheet_rule = !this.any_rule_so_far;
                    this.any_rule_so_far = true;

                    if (first_stylesheet_rule and bun.strings.eqlCaseInsensitiveASCII(name, "charset", true)) {
                        const delimiters = Delimiters{
                            .semicolon = true,
                            .close_curly_bracket = true,
                        };
                        _ = this.input.parseUntilAfter(delimiters, void, {}, voidWrap(void, Parser.parseEmpty));
                    } else {
                        return parse_at_rule(allocator, &start, name, this.input, P, this.parser);
                    }
                } else {
                    this.any_rule_so_far = true;
                    const result = parse_qualified_rule(&start, this.input, P, this.parser, Delimiters{ .curly_bracket = true });
                    return result;
                }
            }
        }
    };
}

/// A result returned from `to_css`, including the serialized CSS
/// and other metadata depending on the input options.
pub const ToCssResult = struct {
    /// Serialized CSS code.
    code: []const u8,
    /// A map of CSS module exports, if the `css_modules` option was
    /// enabled during parsing.
    exports: ?CssModuleExports,
    /// A map of CSS module references, if the `css_modules` config
    /// had `dashed_idents` enabled.
    references: ?CssModuleReferences,
    /// A list of dependencies (e.g. `@import` or `url()`) found in
    /// the style sheet, if the `analyze_dependencies` option is enabled.
    dependencies: ?ArrayList(Dependency),
};

pub const ToCssResultInternal = struct {
    /// A map of CSS module exports, if the `css_modules` option was
    /// enabled during parsing.
    exports: ?CssModuleExports,
    /// A map of CSS module references, if the `css_modules` config
    /// had `dashed_idents` enabled.
    references: ?CssModuleReferences,
    /// A list of dependencies (e.g. `@import` or `url()`) found in
    /// the style sheet, if the `analyze_dependencies` option is enabled.
    dependencies: ?ArrayList(Dependency),
};

pub const MinifyOptions = struct {
    /// Targets to compile the CSS for.
    targets: targets.Targets,
    /// A list of known unused symbols, including CSS class names,
    /// ids, and `@keyframe` names. The declarations of these will be removed.
    unused_symbols: std.StringArrayHashMapUnmanaged(void),

    pub fn default() MinifyOptions {
        return MinifyOptions{
            .targets = .{},
            .unused_symbols = .{},
        };
    }
};

pub const BundlerStyleSheet = StyleSheet(BundlerAtRule);
pub const BundlerCssRuleList = CssRuleList(BundlerAtRule);
pub const BundlerCssRule = CssRule(BundlerAtRule);
pub const BundlerLayerBlockRule = css_rules.layer.LayerBlockRule(BundlerAtRule);
pub const BundlerTailwindState = struct {
    source: []const u8,
    index: bun.bundle_v2.Index,
    output_from_tailwind: ?[]const u8 = null,
};

pub fn StyleSheet(comptime AtRule: type) type {
    return struct {
        /// A list of top-level rules within the style sheet.
        rules: CssRuleList(AtRule),
        sources: ArrayList([]const u8),
        source_map_urls: ArrayList(?[]const u8),
        license_comments: ArrayList([]const u8),
        options: ParserOptions,
        tailwind: if (AtRule == BundlerAtRule) ?*BundlerTailwindState else u0 = if (AtRule == BundlerAtRule) null else 0,

        const This = @This();

        pub fn empty(allocator: Allocator) This {
            return This{
                .rules = .{},
                .sources = .{},
                .source_map_urls = .{},
                .license_comments = .{},
                .options = ParserOptions.default(allocator, null),
            };
        }

        /// Minify and transform the style sheet for the provided browser targets.
        pub fn minify(this: *@This(), allocator: Allocator, options: MinifyOptions) Maybe(void, Err(MinifyErrorKind)) {
            const ctx = PropertyHandlerContext.new(allocator, options.targets, &options.unused_symbols);
            var handler = declaration.DeclarationHandler.default();
            var important_handler = declaration.DeclarationHandler.default();

            // @custom-media rules may be defined after they are referenced, but may only be defined at the top level
            // of a stylesheet. Do a pre-scan here and create a lookup table by name.
            var custom_media: ?std.StringArrayHashMapUnmanaged(css_rules.custom_media.CustomMediaRule) = if (this.options.flags.contains(ParserFlags{ .custom_media = true }) and options.targets.shouldCompileSame(.custom_media_queries)) brk: {
                var custom_media = std.StringArrayHashMapUnmanaged(css_rules.custom_media.CustomMediaRule){};

                for (this.rules.v.items) |*rule| {
                    if (rule.* == .custom_media) {
                        custom_media.put(allocator, rule.custom_media.name.v, rule.custom_media.deepClone(allocator)) catch bun.outOfMemory();
                    }
                }

                break :brk custom_media;
            } else null;
            defer if (custom_media) |*media| media.deinit(allocator);

            var minify_ctx = MinifyContext{
                .allocator = allocator,
                .targets = &options.targets,
                .handler = &handler,
                .important_handler = &important_handler,
                .handler_context = ctx,
                .unused_symbols = &options.unused_symbols,
                .custom_media = custom_media,
                .css_modules = this.options.css_modules != null,
            };

            this.rules.minify(&minify_ctx, false) catch {
                @panic("TODO: Handle");
            };

            return .{ .result = {} };
        }

        pub fn toCssWithWriter(this: *const @This(), allocator: Allocator, writer: anytype, options: css_printer.PrinterOptions, import_records: ?*const bun.BabyList(ImportRecord)) PrintErr!ToCssResultInternal {
            const W = @TypeOf(writer);
            const project_root = options.project_root;
            var printer = Printer(@TypeOf(writer)).new(allocator, std.ArrayList(u8).init(allocator), writer, options, import_records);

            // #[cfg(feature = "sourcemap")]
            // {
            //   printer.sources = Some(&self.sources);
            // }

            // #[cfg(feature = "sourcemap")]
            // if printer.source_map.is_some() {
            //   printer.source_maps = self.sources.iter().enumerate().map(|(i, _)| self.source_map(i)).collect();
            // }

            for (this.license_comments.items) |comment| {
                try printer.writeStr("/*");
                try printer.writeComment(comment);
                try printer.writeStr("*/");
                try printer.newline();
            }

            if (this.options.css_modules) |*config| {
                var references = CssModuleReferences{};
                printer.css_module = CssModule.new(allocator, config, &this.sources, project_root, &references);

                try this.rules.toCss(W, &printer);
                try printer.newline();

                return ToCssResultInternal{
                    .dependencies = printer.dependencies,
                    .exports = exports: {
                        const val = printer.css_module.?.exports_by_source_index.items[0];
                        printer.css_module.?.exports_by_source_index.items[0] = .{};
                        break :exports val;
                    },
                    // .code = dest.items,
                    .references = references,
                };
            } else {
                try this.rules.toCss(W, &printer);
                try printer.newline();
                return ToCssResultInternal{
                    .dependencies = printer.dependencies,
                    // .code = dest.items,
                    .exports = null,
                    .references = null,
                };
            }
        }

        pub fn toCss(this: *const @This(), allocator: Allocator, options: css_printer.PrinterOptions, import_records: ?*const bun.BabyList(ImportRecord)) PrintErr!ToCssResult {
            // TODO: this is not necessary
            // Make sure we always have capacity > 0: https://github.com/napi-rs/napi-rs/issues/1124.
            var dest = ArrayList(u8).initCapacity(allocator, 1) catch unreachable;
            const writer = dest.writer(allocator);
            const result = try toCssWithWriter(this, allocator, writer, options, import_records);
            return ToCssResult{
                .code = dest.items,
                .dependencies = result.dependencies,
                .exports = result.exports,
                .references = result.references,
            };
        }

        pub fn parse(allocator: Allocator, code: []const u8, options: ParserOptions, import_records: ?*bun.BabyList(ImportRecord)) Maybe(This, Err(ParserError)) {
            var default_at_rule_parser = DefaultAtRuleParser{};
            return parseWith(allocator, code, options, DefaultAtRuleParser, &default_at_rule_parser, import_records);
        }

        pub fn parseBundler(allocator: Allocator, code: []const u8, options: ParserOptions, import_records: *bun.BabyList(ImportRecord)) Maybe(This, Err(ParserError)) {
            var at_rule_parser = BundlerAtRuleParser{
                .import_records = import_records,
                .allocator = allocator,
                .options = &options,
            };
            return parseWith(allocator, code, options, BundlerAtRuleParser, &at_rule_parser, import_records);
        }

        /// Parse a style sheet from a string.
        pub fn parseWith(
            allocator: Allocator,
            code: []const u8,
            options: ParserOptions,
            comptime P: type,
            at_rule_parser: *P,
            import_records: ?*bun.BabyList(ImportRecord),
        ) Maybe(This, Err(ParserError)) {
            var input = ParserInput.new(allocator, code);
            var parser = Parser.new(&input, import_records);

            var license_comments = ArrayList([]const u8){};
            var state = parser.state();
            while (switch (parser.nextIncludingWhitespaceAndComments()) {
                .result => |v| v,
                .err => null,
            }) |token| {
                switch (token.*) {
                    .whitespace => {},
                    .comment => |comment| {
                        if (bun.strings.startsWithChar(comment, '!')) {
                            license_comments.append(allocator, comment) catch bun.outOfMemory();
                        }
                    },
                    else => break,
                }
                state = parser.state();
            }
            parser.reset(&state);

            var rules = CssRuleList(AtRule){};
            var rule_parser = TopLevelRuleParser(P).new(allocator, &options, at_rule_parser, &rules);
            var rule_list_parser = StyleSheetParser(TopLevelRuleParser(P)).new(&parser, &rule_parser);

            while (rule_list_parser.next(allocator)) |result| {
                if (result.asErr()) |e| {
                    const result_options = rule_list_parser.parser.options;
                    if (result_options.error_recovery) {
                        // todo_stuff.warn
                        continue;
                    }

                    return .{ .err = Err(ParserError).fromParseError(e, options.filename) };
                }
            }

            var sources = ArrayList([]const u8){};
            sources.append(allocator, options.filename) catch bun.outOfMemory();
            var source_map_urls = ArrayList(?[]const u8){};
            source_map_urls.append(allocator, parser.currentSourceMapUrl()) catch bun.outOfMemory();

            return .{
                .result = This{
                    .rules = rules,
                    .sources = sources,
                    .source_map_urls = source_map_urls,
                    .license_comments = license_comments,
                    .options = options,
                },
            };
        }

        pub fn containsTailwindDirectives(this: *const @This()) bool {
            if (comptime AtRule != BundlerAtRule) @compileError("Expected BundlerAtRule for this function.");
            var found_import: bool = false;
            for (this.rules.v.items) |*rule| {
                switch (rule.*) {
                    .custom => {
                        return true;
                    },
                    // .charset => {},
                    // TODO: layer
                    .layer_block => {},
                    .import => {
                        found_import = true;
                    },
                    else => {
                        return false;
                    },
                }
            }
            return false;
        }

        pub fn newFromTailwindImports(
            allocator: Allocator,
            options: ParserOptions,
            imports_from_tailwind: CssRuleList(AtRule),
        ) @This() {
            _ = allocator; // autofix
            if (comptime AtRule != BundlerAtRule) @compileError("Expected BundlerAtRule for this function.");

            const stylesheet = This{
                .rules = imports_from_tailwind,
                .sources = .{},
                .source_map_urls = .{},
                .license_comments = .{},
                .options = options,
            };

            return stylesheet;
        }

        /// *NOTE*: Used for Tailwind stylesheets only
        ///
        /// This plucks out the import rules from the Tailwind stylesheet into a separate rule list,
        /// replacing them with `.ignored` rules.
        ///
        /// We do this because Tailwind's compiler pipeline does not bundle imports, so we handle that
        /// ourselves in the bundler.
        pub fn pluckImports(this: *const @This(), allocator: Allocator, out: *CssRuleList(AtRule), new_import_records: *bun.BabyList(ImportRecord)) void {
            if (comptime AtRule != BundlerAtRule) @compileError("Expected BundlerAtRule for this function.");
            const State = enum { count, exec };

            const STATES = comptime [_]State{ .count, .exec };

            var count: u32 = 0;
            inline for (STATES[0..]) |state| {
                if (comptime state == .exec) {
                    out.v.ensureUnusedCapacity(allocator, count) catch bun.outOfMemory();
                }
                var saw_imports = false;
                for (this.rules.v.items) |*rule| {
                    switch (rule.*) {
                        // TODO: layer, might have imports
                        .layer_block => {},
                        .import => {
                            if (!saw_imports) saw_imports = true;
                            switch (state) {
                                .count => count += 1,
                                .exec => {
                                    const import_rule = &rule.import;
                                    out.v.appendAssumeCapacity(rule.*);
                                    const import_record_idx = new_import_records.len;
                                    import_rule.import_record_idx = import_record_idx;
                                    new_import_records.push(allocator, ImportRecord{
                                        .path = bun.fs.Path.init(import_rule.url),
                                        .kind = if (import_rule.supports != null) .at_conditional else .at,
                                        .range = bun.logger.Range.None,
                                    }) catch bun.outOfMemory();
                                    rule.* = .ignored;
                                },
                            }
                        },
                        .unknown => {
                            if (bun.strings.eqlComptime(rule.unknown.name, "tailwind")) {
                                continue;
                            }
                        },
                        else => {},
                    }
                    if (saw_imports) break;
                }
            }
        }
    };
}

pub const StyleAttribute = struct {
    declarations: DeclarationBlock,
    sources: ArrayList([]const u8),

    pub fn parse(allocator: Allocator, code: []const u8, options: ParserOptions, import_records: *bun.BabyList(ImportRecord)) Maybe(StyleAttribute, Err(ParserError)) {
        var input = ParserInput.new(allocator, code);
        var parser = Parser.new(&input, import_records);
        const sources = sources: {
            var s = ArrayList([]const u8).initCapacity(allocator, 1) catch bun.outOfMemory();
            s.appendAssumeCapacity(options.filename);
            break :sources s;
        };
        return .{ .result = StyleAttribute{
            .declarations = switch (DeclarationBlock.parse(&parser, &options)) {
                .result => |v| v,
                .err => |e| return .{ .err = Err(ParserError).fromParseError(e, "") },
            },
            .sources = sources,
        } };
    }

    pub fn toCss(this: *const StyleAttribute, allocator: Allocator, options: PrinterOptions, import_records: *bun.BabyList(ImportRecord)) PrintErr!ToCssResult {
        // #[cfg(feature = "sourcemap")]
        // assert!(
        //   options.source_map.is_none(),
        //   "Source maps are not supported for style attributes"
        // );

        var dest = ArrayList(u8){};
        const writer = dest.writer(allocator);
        var printer = Printer(@TypeOf(writer)).new(allocator, std.ArrayList(u8).init(allocator), writer, options, import_records);
        printer.sources = &this.sources;

        try this.declarations.toCss(@TypeOf(writer), &printer);

        return ToCssResult{
            .dependencies = printer.dependencies,
            .code = dest.items,
            .exports = null,
            .references = null,
        };
    }

    pub fn minify(this: *@This(), allocator: Allocator, options: MinifyOptions) void {
        _ = allocator; // autofix
        _ = this; // autofix
        _ = options; // autofix
        // TODO: IMPLEMENT THIS!
    }
};

pub fn ValidDeclarationParser(comptime P: type) void {
    // The finished representation of a declaration.
    _ = P.DeclarationParser.Declaration;

    // Parse the value of a declaration with the given `name`.
    //
    // Return the finished representation for the declaration
    // as returned by `DeclarationListParser::next`,
    // or `Err(())` to ignore the entire declaration as invalid.
    //
    // Declaration name matching should be case-insensitive in the ASCII range.
    // This can be done with `std::ascii::Ascii::eq_ignore_ascii_case`,
    // or with the `match_ignore_ascii_case!` macro.
    //
    // The given `input` is a "delimited" parser
    // that ends wherever the declaration value should end.
    // (In declaration lists, before the next semicolon or end of the current block.)
    //
    // If `!important` can be used in a given context,
    // `input.try_parse(parse_important).is_ok()` should be used at the end
    // of the implementation of this method and the result should be part of the return value.
    //
    // fn parseValue(this: *T, name: []const u8, input: *Parser) Error!T.DeclarationParser.Declaration
    _ = P.DeclarationParser.parseValue;
}

/// Also checks that P is:
/// - ValidDeclarationParser(P)
/// - ValidQualifiedRuleParser(P)
/// - ValidAtRuleParser(P)
pub fn ValidRuleBodyItemParser(comptime P: type) void {
    ValidDeclarationParser(P);
    ValidQualifiedRuleParser(P);
    ValidAtRuleParser(P);

    // Whether we should attempt to parse declarations. If you know you won't, returning false
    // here is slightly faster.
    _ = P.RuleBodyItemParser.parseDeclarations;

    // Whether we should attempt to parse qualified rules. If you know you won't, returning false
    // would be slightly faster.
    _ = P.RuleBodyItemParser.parseQualified;

    // We should have:
    // P.DeclarationParser.Declaration == P.QualifiedRuleParser.QualifiedRule == P.AtRuleParser.AtRule
    if (P.DeclarationParser.Declaration != P.QualifiedRuleParser.QualifiedRule or
        P.DeclarationParser.Declaration != P.AtRuleParser.AtRule)
    {
        @compileError("ValidRuleBodyItemParser: P.DeclarationParser.Declaration != P.QualifiedRuleParser.QualifiedRule or\n  P.DeclarationParser.Declaration != P.AtRuleParser.AtRule");
    }
}

pub fn RuleBodyParser(comptime P: type) type {
    ValidRuleBodyItemParser(P);
    // Same as P.AtRuleParser.AtRule and P.DeclarationParser.Declaration
    const I = P.QualifiedRuleParser.QualifiedRule;

    return struct {
        input: *Parser,
        parser: *P,

        const This = @This();

        pub fn new(input: *Parser, parser: *P) This {
            return .{
                .input = input,
                .parser = parser,
            };
        }

        /// TODO: result is actually:
        ///     type Item = Result<I, (ParseError<'i, E>, &'i str)>;
        ///
        /// but nowhere in the source do i actually see it using the string part of the tuple
        pub fn next(this: *This) ?(Result(I)) {
            while (true) {
                this.input.skipWhitespace();
                const start = this.input.state();

                const tok: *Token = switch (this.input.nextIncludingWhitespaceAndComments()) {
                    .err => |_| return null,
                    .result => |vvv| vvv,
                };

                switch (tok.*) {
                    .close_curly, .whitespace, .semicolon, .comment => continue,
                    .at_keyword => {
                        const name = tok.at_keyword;
                        return parse_at_rule(
                            this.input.allocator(),
                            &start,
                            name,
                            this.input,
                            P,
                            this.parser,
                        );
                    },
                    .ident => {
                        if (P.RuleBodyItemParser.parseDeclarations(this.parser)) {
                            const name = tok.ident;
                            const parse_qualified = P.RuleBodyItemParser.parseQualified(this.parser);
                            const result: Result(I) = result: {
                                const error_behavior: ParseUntilErrorBehavior = if (parse_qualified) .stop else .consume;
                                const Closure = struct {
                                    parser: *P,
                                    name: []const u8,
                                    pub fn parsefn(self: *@This(), input: *Parser) Result(I) {
                                        if (input.expectColon().asErr()) |e| return .{ .err = e };
                                        return P.DeclarationParser.parseValue(self.parser, self.name, input);
                                    }
                                };
                                var closure = Closure{
                                    .parser = this.parser,
                                    .name = name,
                                };
                                break :result parse_until_after(this.input, Delimiters{ .semicolon = true }, error_behavior, I, &closure, Closure.parsefn);
                            };
                            if (result.isErr() and parse_qualified) {
                                this.input.reset(&start);
                                if (parse_qualified_rule(
                                    &start,
                                    this.input,
                                    P,
                                    this.parser,
                                    Delimiters{ .semicolon = true, .curly_bracket = true },
                                ).asValue()) |qual| {
                                    return .{ .result = qual };
                                }
                            }

                            return result;
                        }
                    },
                    else => {},
                }

                const result: Result(I) = if (P.RuleBodyItemParser.parseQualified(this.parser)) result: {
                    this.input.reset(&start);
                    const delimiters = if (P.RuleBodyItemParser.parseDeclarations(this.parser)) Delimiters{
                        .semicolon = true,
                        .curly_bracket = true,
                    } else Delimiters{ .curly_bracket = true };
                    break :result parse_qualified_rule(&start, this.input, P, this.parser, delimiters);
                } else result: {
                    const token = tok.*;

                    const Closure = struct { token: Token, start: ParserState };
                    break :result this.input.parseUntilAfter(Delimiters{ .semicolon = true }, I, &Closure{ .token = token, .start = start }, struct {
                        pub fn parseFn(closure: *const Closure, i: *Parser) Result(I) {
                            _ = i; // autofix
                            return .{ .err = closure.start.sourceLocation().newUnexpectedTokenError(closure.token) };
                        }
                    }.parseFn);
                };

                return result;
            }
        }
    };
}

pub const ParserOptions = struct {
    /// Filename to use in error messages.
    filename: []const u8,
    /// Whether the enable [CSS modules](https://github.com/css-modules/css-modules).
    css_modules: ?css_modules.Config,
    /// The source index to assign to all parsed rules. Impacts the source map when
    /// the style sheet is serialized.
    source_index: u32,
    /// Whether to ignore invalid rules and declarations rather than erroring.
    error_recovery: bool,
    /// A list that will be appended to when a warning occurs.
    logger: ?*Log = null,
    /// Feature flags to enable.
    flags: ParserFlags,
    allocator: Allocator,

    pub fn warn(this: *const ParserOptions, warning: ParseError(ParserError)) void {
        if (this.logger) |lg| {
            lg.addWarningFmtLineCol(
                this.filename,
                warning.location.line,
                warning.location.column,
                this.allocator,
                "{}",
                .{warning.kind},
            ) catch unreachable;
        }
    }

    pub fn default(allocator: std.mem.Allocator, log: ?*Log) ParserOptions {
        return ParserOptions{
            .filename = "",
            .css_modules = null,
            .source_index = 0,
            .error_recovery = false,
            .logger = log,
            .flags = ParserFlags{},
            .allocator = allocator,
        };
    }
};

/// Parser feature flags to enable.
pub const ParserFlags = packed struct(u8) {
    /// Whether the enable the [CSS nesting](https://www.w3.org/TR/css-nesting-1/) draft syntax.
    nesting: bool = false,
    /// Whether to enable the [custom media](https://drafts.csswg.org/mediaqueries-5/#custom-mq) draft syntax.
    custom_media: bool = false,
    /// Whether to enable the non-standard >>> and /deep/ selector combinators used by Vue and Angular.
    deep_selector_combinator: bool = false,
    __unused: u5 = 0,

    pub usingnamespace Bitflags(@This());
};

const ParseUntilErrorBehavior = enum {
    consume,
    stop,
};

// const ImportRecordHandler = union(enum) {
//     list: *bun.BabyList(ImportRecord),
//     // dummy: u32,

//     pub fn add(this: *ImportRecordHandler, allocator: Allocator, record: ImportRecord) u32 {
//         return switch (this.*) {
//             .list => |list| {
//                 const len = list.len;
//                 list.push(allocator, record) catch bun.outOfMemory();
//                 return len;
//             },
//             // .dummy => |*d| {
//             //     const val = d.*;
//             //     d.* += 1;
//             //     return val;
//             // },
//         };
//     }
// };

pub const Parser = struct {
    input: *ParserInput,
    at_start_of: ?BlockType = null,
    stop_before: Delimiters = Delimiters.NONE,
    import_records: ?*bun.BabyList(ImportRecord),

    // TODO: dedupe import records??
    pub fn addImportRecordForUrl(this: *Parser, url: []const u8, start_position: usize) Result(u32) {
        if (this.import_records) |import_records| {
            const idx = import_records.len;
            import_records.push(this.allocator(), ImportRecord{
                .path = bun.fs.Path.init(url),
                .kind = .url,
                .range = bun.logger.Range{
                    .loc = bun.logger.Loc{ .start = @intCast(start_position) },
                    .len = @intCast(url.len), // TODO: technically this is not correct because the url could be escaped
                },
            }) catch bun.outOfMemory();
            return .{ .result = idx };
        } else {
            return .{ .err = this.newBasicUnexpectedTokenError(.{ .unquoted_url = url }) };
        }
    }

    pub inline fn allocator(self: *Parser) Allocator {
        return self.input.tokenizer.allocator;
    }

    /// Create a new Parser
    ///
    /// Pass in `import_records` to track imports (`@import` rules, `url()` tokens). If this
    /// is `null`, calling `Parser.addImportRecordForUrl` will error.
    pub fn new(input: *ParserInput, import_records: ?*bun.BabyList(ImportRecord)) Parser {
        return Parser{
            .input = input,
            .import_records = import_records,
        };
    }

    pub fn newCustomError(this: *const Parser, err: ParserError) ParseError(ParserError) {
        return this.currentSourceLocation().newCustomError(err);
    }

    pub fn newBasicError(this: *const Parser, kind: BasicParseErrorKind) BasicParseError {
        return BasicParseError{
            .kind = kind,
            .location = this.currentSourceLocation(),
        };
    }

    pub fn newError(this: *const Parser, kind: BasicParseErrorKind) ParseError(ParserError) {
        return .{
            .kind = .{ .basic = kind },
            .location = this.currentSourceLocation(),
        };
    }

    pub fn newUnexpectedTokenError(this: *const Parser, token: Token) ParseError(ParserError) {
        return this.newError(.{ .unexpected_token = token });
    }

    pub fn newBasicUnexpectedTokenError(this: *const Parser, token: Token) ParseError(ParserError) {
        return this.newBasicError(.{ .unexpected_token = token }).intoDefaultParseError();
    }

    pub fn currentSourceLocation(this: *const Parser) SourceLocation {
        return this.input.tokenizer.currentSourceLocation();
    }

    pub fn currentSourceMapUrl(this: *const Parser) ?[]const u8 {
        return this.input.tokenizer.currentSourceMapUrl();
    }

    /// Return a slice of the CSS input, from the given position to the current one.
    pub fn sliceFrom(this: *const Parser, start_position: usize) []const u8 {
        return this.input.tokenizer.sliceFrom(start_position);
    }

    /// Implementation of Vec::<T>::parse
    pub fn parseList(this: *Parser, comptime T: type, comptime parse_one: *const fn (*Parser) Result(T)) Result(ArrayList(T)) {
        return this.parseCommaSeparated(T, parse_one);
    }

    /// Parse a list of comma-separated values, all with the same syntax.
    ///
    /// The given closure is called repeatedly with a "delimited" parser
    /// (see the `Parser::parse_until_before` method) so that it can over
    /// consume the input past a comma at this block/function nesting level.
    ///
    /// Successful results are accumulated in a vector.
    ///
    /// This method returns `Err(())` the first time that a closure call does,
    /// or if a closure call leaves some input before the next comma or the end
    /// of the input.
    pub fn parseCommaSeparated(
        this: *Parser,
        comptime T: type,
        comptime parse_one: *const fn (*Parser) Result(T),
    ) Result(ArrayList(T)) {
        return this.parseCommaSeparatedInternal(T, {}, voidWrap(T, parse_one), false);
    }

    pub fn parseCommaSeparatedWithCtx(
        this: *Parser,
        comptime T: type,
        closure: anytype,
        comptime parse_one: *const fn (@TypeOf(closure), *Parser) Result(T),
    ) Result(ArrayList(T)) {
        return this.parseCommaSeparatedInternal(T, closure, parse_one, false);
    }

    fn parseCommaSeparatedInternal(
        this: *Parser,
        comptime T: type,
        closure: anytype,
        comptime parse_one: *const fn (@TypeOf(closure), *Parser) Result(T),
        ignore_errors: bool,
    ) Result(ArrayList(T)) {
        // Vec grows from 0 to 4 by default on first push().  So allocate with
        // capacity 1, so in the somewhat common case of only one item we don't
        // way overallocate.  Note that we always push at least one item if
        // parsing succeeds.
        //
        // TODO(zack): might be faster to use stack fallback here
        // in the common case we may have just 1, but I feel like it is also very common to have >1
        // which means every time we have >1 items we will always incur 1 more additional allocation
        var sfb = std.heap.stackFallback(@sizeOf(T), this.allocator());
        const alloc = sfb.get();
        var values = ArrayList(T).initCapacity(alloc, 1) catch unreachable;

        while (true) {
            this.skipWhitespace(); // Unnecessary for correctness, but may help try() in parse_one rewind less.
            switch (this.parseUntilBefore(Delimiters{ .comma = true }, T, closure, parse_one)) {
                .result => |v| {
                    values.append(alloc, v) catch unreachable;
                },
                .err => |e| {
                    if (!ignore_errors) return .{ .err = e };
                },
            }

            const tok = switch (this.next()) {
                .result => |v| v,
                .err => {
                    // need to clone off the stack
                    const needs_clone = values.items.len == 1;
                    if (needs_clone) return .{ .result = values.clone(this.allocator()) catch bun.outOfMemory() };
                    return .{ .result = values };
                },
            };
            if (tok.* != .comma) bun.unreachablePanic("", .{});
        }
    }

    /// Execute the given closure, passing it the parser.
    /// If the result (returned unchanged) is `Err`,
    /// the internal state of the parser  (including position within the input)
    /// is restored to what it was before the call.
    ///
    /// func needs to be a funtion like this: `fn func(*Parser, ...@TypeOf(args_)) T`
    pub inline fn tryParse(this: *Parser, comptime func: anytype, args_: anytype) bun.meta.ReturnOf(func) {
        const start = this.state();
        const result = result: {
            const args = brk: {
                var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
                args[0] = this;

                inline for (args_, 1..) |a, i| {
                    args[i] = a;
                }

                break :brk args;
            };

            break :result @call(.auto, func, args);
        };
        if (result == .err) {
            this.reset(&start);
        }
        return result;
    }

    pub inline fn tryParseImpl(this: *Parser, comptime Ret: type, comptime func: anytype, args: anytype) Ret {
        const start = this.state();
        const result = result: {
            break :result @call(.auto, func, args);
        };
        if (result == .err) {
            this.reset(&start);
        }
        return result;
    }

    pub inline fn parseNestedBlock(this: *Parser, comptime T: type, closure: anytype, comptime parsefn: *const fn (@TypeOf(closure), *Parser) Result(T)) Result(T) {
        return parse_nested_block(this, T, closure, parsefn);
    }

    pub fn isExhausted(this: *Parser) bool {
        return this.expectExhausted().isOk();
    }

    /// Parse the input until exhaustion and check that it contains no “error” token.
    ///
    /// See `Token::is_parse_error`. This also checks nested blocks and functions recursively.
    pub fn expectNoErrorToken(this: *Parser) Result(void) {
        while (true) {
            const tok = switch (this.nextIncludingWhitespaceAndComments()) {
                .err => return .{ .result = {} },
                .result => |v| v,
            };
            switch (tok.*) {
                .function, .open_paren, .open_square, .open_curly => {
                    if (this.parseNestedBlock(void, {}, struct {
                        pub fn parse(_: void, i: *Parser) Result(void) {
                            if (i.expectNoErrorToken().asErr()) |e| {
                                return .{ .err = e };
                            }
                            return .{ .result = {} };
                        }
                    }.parse).asErr()) |err| {
                        return .{ .err = err };
                    }
                    return .{ .result = {} };
                },
                else => {
                    if (tok.isParseError()) {
                        return .{ .err = this.newUnexpectedTokenError(tok.*) };
                    }
                },
            }
        }
    }

    pub fn expectPercentage(this: *Parser) Result(f32) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .percentage) return .{ .result = tok.percentage.unit_value };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectComma(this: *Parser) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .comma => return .{ .result = {} },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    /// Parse a <number-token> that does not have a fractional part, and return the integer value.
    pub fn expectInteger(this: *Parser) Result(i32) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .number and tok.number.int_value != null) return .{ .result = tok.number.int_value.? };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    /// Parse a <number-token> and return the integer value.
    pub fn expectNumber(this: *Parser) Result(f32) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .number) return .{ .result = tok.number.value };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectDelim(this: *Parser, delim: u8) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .delim and tok.delim == delim) return .{ .result = {} };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectParenthesisBlock(this: *Parser) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .open_paren) return .{ .result = {} };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectColon(this: *Parser) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .colon) return .{ .result = {} };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectString(this: *Parser) Result([]const u8) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .quoted_string) return .{ .result = tok.quoted_string };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectIdent(this: *Parser) Result([]const u8) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .ident) return .{ .result = tok.ident };
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    /// Parse either a <ident-token> or a <string-token>, and return the unescaped value.
    pub fn expectIdentOrString(this: *Parser) Result([]const u8) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .ident => |i| return .{ .result = i },
            .quoted_string => |s| return .{ .result = s },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectIdentMatching(this: *Parser, name: []const u8) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .ident => |i| if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, i)) return .{ .result = {} },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectFunction(this: *Parser) Result([]const u8) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .function => |fn_name| return .{ .result = fn_name },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectFunctionMatching(this: *Parser, name: []const u8) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .function => |fn_name| if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, fn_name)) return .{ .result = {} },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn expectCurlyBracketBlock(this: *Parser) Result(void) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .open_curly => return .{ .result = {} },
            else => return .{ .err = start_location.newUnexpectedTokenError(tok.*) },
        }
    }

    /// Parse a <url-token> and return the unescaped value.
    pub fn expectUrl(this: *Parser) Result([]const u8) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .unquoted_url => |value| return .{ .result = value },
            .function => |name| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("url", name)) {
                    const result = this.parseNestedBlock([]const u8, {}, struct {
                        fn parse(_: void, parser: *Parser) Result([]const u8) {
                            return switch (parser.expectString()) {
                                .result => |v| .{ .result = v },
                                .err => |e| .{ .err = e },
                            };
                        }
                    }.parse);
                    return switch (result) {
                        .result => |v| .{ .result = v },
                        .err => |e| .{ .err = e },
                    };
                }
            },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    /// Parse either a <url-token> or a <string-token>, and return the unescaped value.
    pub fn expectUrlOrString(this: *Parser) Result([]const u8) {
        const start_location = this.currentSourceLocation();
        const tok = switch (this.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .unquoted_url => |value| return .{ .result = value },
            .quoted_string => |value| return .{ .result = value },
            .function => |name| {
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("url", name)) {
                    const result = this.parseNestedBlock([]const u8, {}, struct {
                        fn parse(_: void, parser: *Parser) Result([]const u8) {
                            return switch (parser.expectString()) {
                                .result => |v| .{ .result = v },
                                .err => |e| .{ .err = e },
                            };
                        }
                    }.parse);
                    return switch (result) {
                        .result => |v| .{ .result = v },
                        .err => |e| .{ .err = e },
                    };
                }
            },
            else => {},
        }
        return .{ .err = start_location.newUnexpectedTokenError(tok.*) };
    }

    pub fn position(this: *Parser) usize {
        bun.debugAssert(bun.strings.isOnCharBoundary(this.input.tokenizer.src, this.input.tokenizer.position));
        return this.input.tokenizer.position;
    }

    fn parseEmpty(_: *Parser) Result(void) {
        return .{ .result = {} };
    }

    /// Like `parse_until_before`, but also consume the delimiter token.
    ///
    /// This can be useful when you don’t need to know which delimiter it was
    /// (e.g. if these is only one in the given set)
    /// or if it was there at all (as opposed to reaching the end of the input).
    pub fn parseUntilAfter(
        this: *Parser,
        delimiters: Delimiters,
        comptime T: type,
        closure: anytype,
        comptime parse_fn: *const fn (@TypeOf(closure), *Parser) Result(T),
    ) Result(T) {
        return parse_until_after(
            this,
            delimiters,
            ParseUntilErrorBehavior.consume,
            T,
            closure,
            parse_fn,
        );
    }

    pub fn parseUntilBefore(this: *Parser, delimiters: Delimiters, comptime T: type, closure: anytype, comptime parse_fn: *const fn (@TypeOf(closure), *Parser) Result(T)) Result(T) {
        return parse_until_before(this, delimiters, .consume, T, closure, parse_fn);
    }

    pub fn parseEntirely(this: *Parser, comptime T: type, closure: anytype, comptime parsefn: *const fn (@TypeOf(closure), *Parser) Result(T)) Result(T) {
        const result = switch (parsefn(closure, this)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (this.expectExhausted().asErr()) |e| return .{ .err = e };
        return .{ .result = result };
    }

    /// Check whether the input is exhausted. That is, if `.next()` would return a token.
    /// Return a `Result` so that the `?` operator can be used: `input.expect_exhausted()?`
    ///
    /// This ignores whitespace and comments.
    pub fn expectExhausted(this: *Parser) Result(void) {
        const start = this.state();
        const result: Result(void) = switch (this.next()) {
            .result => |t| .{ .err = start.sourceLocation().newUnexpectedTokenError(t.*) },
            .err => |e| brk: {
                if (e.kind == .basic and e.kind.basic == .end_of_input) break :brk .{ .result = {} };
                bun.unreachablePanic("Unexpected error encountered: {}", .{e.kind});
            },
        };
        this.reset(&start);
        return result;
    }

    pub fn @"skip cdc and cdo"(this: *@This()) void {
        if (this.at_start_of) |block_type| {
            this.at_start_of = null;
            consume_until_end_of_block(block_type, &this.input.tokenizer);
        }

        this.input.tokenizer.@"skip cdc and cdo"();
    }

    pub fn skipWhitespace(this: *@This()) void {
        if (this.at_start_of) |block_type| {
            this.at_start_of = null;
            consume_until_end_of_block(block_type, &this.input.tokenizer);
        }

        this.input.tokenizer.skipWhitespace();
    }

    pub fn next(this: *@This()) Result(*Token) {
        this.skipWhitespace();
        return this.nextIncludingWhitespaceAndComments();
    }

    /// Same as `Parser::next`, but does not skip whitespace tokens.
    pub fn nextIncludingWhitespace(this: *@This()) Result(*Token) {
        while (true) {
            switch (this.nextIncludingWhitespaceAndComments()) {
                .result => |tok| if (tok.* == .comment) {} else break,
                .err => |e| return .{ .err = e },
            }
        }
        return .{ .result = &this.input.cached_token.?.token };
    }

    pub fn nextByte(this: *@This()) ?u8 {
        const byte = this.input.tokenizer.nextByte();
        if (this.stop_before.contains(Delimiters.fromByte(byte))) {
            return null;
        }
        return byte;
    }

    pub fn reset(this: *Parser, state_: *const ParserState) void {
        this.input.tokenizer.reset(state_);
        this.at_start_of = state_.at_start_of;
        if (this.import_records) |import_records| import_records.len = state_.import_record_count;
    }

    pub fn state(this: *Parser) ParserState {
        return ParserState{
            .position = this.input.tokenizer.getPosition(),
            .current_line_start_position = this.input.tokenizer.current_line_start_position,
            .current_line_number = @intCast(this.input.tokenizer.current_line_number),
            .at_start_of = this.at_start_of,
            .import_record_count = if (this.import_records) |import_records| import_records.len else 0,
        };
    }

    /// Same as `Parser::next`, but does not skip whitespace or comment tokens.
    ///
    /// **Note**: This should only be used in contexts like a CSS pre-processor
    /// where comments are preserved.
    /// When parsing higher-level values, per the CSS Syntax specification,
    /// comments should always be ignored between tokens.
    pub fn nextIncludingWhitespaceAndComments(this: *Parser) Result(*Token) {
        if (this.at_start_of) |block_type| {
            this.at_start_of = null;
            consume_until_end_of_block(block_type, &this.input.tokenizer);
        }

        const byte = this.input.tokenizer.nextByte();
        if (this.stop_before.contains(Delimiters.fromByte(byte))) {
            return .{ .err = this.newError(BasicParseErrorKind.end_of_input) };
        }

        const token_start_position = this.input.tokenizer.getPosition();
        const using_cached_token = this.input.cached_token != null and this.input.cached_token.?.start_position == token_start_position;

        const token = if (using_cached_token) token: {
            const cached_token = &this.input.cached_token.?;
            this.input.tokenizer.reset(&cached_token.end_state);
            if (cached_token.token == .function) {
                this.input.tokenizer.seeFunction(cached_token.token.function);
            }
            break :token &cached_token.token;
        } else token: {
            const new_token = switch (this.input.tokenizer.next()) {
                .result => |v| v,
                .err => return .{ .err = this.newError(BasicParseErrorKind.end_of_input) },
            };
            this.input.cached_token = CachedToken{
                .token = new_token,
                .start_position = token_start_position,
                .end_state = this.input.tokenizer.state(),
            };
            break :token &this.input.cached_token.?.token;
        };

        if (BlockType.opening(token)) |block_type| {
            this.at_start_of = block_type;
        }

        return .{ .result = token };
    }

    /// Create a new unexpected token or EOF ParseError at the current location
    pub fn newErrorForNextToken(this: *Parser) ParseError(ParserError) {
        const token = switch (this.next()) {
            .result => |t| t.*,
            .err => |e| return e,
        };
        return this.newError(BasicParseErrorKind{ .unexpected_token = token });
    }
};

/// A set of characters, to be used with the `Parser::parse_until*` methods.
///
/// The union of two sets can be obtained with the `|` operator. Example:
///
/// ```{rust,ignore}
/// input.parse_until_before(Delimiter::CurlyBracketBlock | Delimiter::Semicolon)
/// ```
pub const Delimiters = packed struct(u8) {
    /// The delimiter set with only the `{` opening curly bracket
    curly_bracket: bool = false,
    /// The delimiter set with only the `;` semicolon
    semicolon: bool = false,
    /// The delimiter set with only the `!` exclamation point
    bang: bool = false,
    /// The delimiter set with only the `,` comma
    comma: bool = false,
    close_curly_bracket: bool = false,
    close_square_bracket: bool = false,
    close_parenthesis: bool = false,
    __unused: u1 = 0,

    pub usingnamespace Bitflags(Delimiters);

    const NONE: Delimiters = .{};

    pub fn getDelimiter(comptime tag: @TypeOf(.EnumLiteral)) Delimiters {
        var empty = Delimiters{};
        @field(empty, @tagName(tag)) = true;
        return empty;
    }

    const TABLE: [256]Delimiters = brk: {
        var table: [256]Delimiters = [_]Delimiters{.{}} ** 256;
        table[';'] = getDelimiter(.semicolon);
        table['!'] = getDelimiter(.bang);
        table[','] = getDelimiter(.comma);
        table['{'] = getDelimiter(.curly_bracket);
        table['}'] = getDelimiter(.close_curly_bracket);
        table[']'] = getDelimiter(.close_square_bracket);
        table[')'] = getDelimiter(.close_parenthesis);
        break :brk table;
    };

    // pub fn bitwiseOr(lhs: Delimiters, rhs: Delimiters) Delimiters {
    //     return @bitCast(@as(u8, @bitCast(lhs)) | @as(u8, @bitCast(rhs)));
    // }

    // pub fn contains(lhs: Delimiters, rhs: Delimiters) bool {
    //     return @as(u8, @bitCast(lhs)) & @as(u8, @bitCast(rhs)) != 0;
    // }

    pub fn fromByte(byte: ?u8) Delimiters {
        if (byte) |b| return TABLE[b];
        return .{};
    }
};

pub const ParserInput = struct {
    tokenizer: Tokenizer,
    cached_token: ?CachedToken = null,

    pub fn new(allocator: Allocator, code: []const u8) ParserInput {
        return ParserInput{
            .tokenizer = Tokenizer.init(allocator, code),
        };
    }
};

/// A capture of the internal state of a `Parser` (including the position within the input),
/// obtained from the `Parser::position` method.
///
/// Can be used with the `Parser::reset` method to restore that state.
/// Should only be used with the `Parser` instance it came from.
pub const ParserState = struct {
    position: usize,
    current_line_start_position: usize,
    current_line_number: u32,
    import_record_count: u32,
    at_start_of: ?BlockType,

    pub fn sourceLocation(this: *const ParserState) SourceLocation {
        return .{
            .line = this.current_line_number,
            .column = @intCast(this.position - this.current_line_start_position + 1),
        };
    }
};

const BlockType = enum {
    parenthesis,
    square_bracket,
    curly_bracket,

    fn opening(token: *const Token) ?BlockType {
        return switch (token.*) {
            .function, .open_paren => .parenthesis,
            .open_square => .square_bracket,
            .open_curly => .curly_bracket,
            else => null,
        };
    }

    fn closing(token: *const Token) ?BlockType {
        return switch (token.*) {
            .close_paren => .parenthesis,
            .close_square => .square_bracket,
            .close_curly => .curly_bracket,
            else => null,
        };
    }
};

pub const nth = struct {
    const NthResult = struct { i32, i32 };
    /// Parse the *An+B* notation, as found in the `:nth-child()` selector.
    /// The input is typically the arguments of a function,
    /// in which case the caller needs to check if the arguments’ parser is exhausted.
    /// Return `Ok((A, B))`, or `Err(())` for a syntax error.
    pub fn parse_nth(input: *Parser) Result(NthResult) {
        const tok = switch (input.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .number => {
                if (tok.number.int_value) |b| return .{ .result = .{ 0, b } };
            },
            .dimension => {
                if (tok.dimension.num.int_value) |a| {
                    // @compileError(todo_stuff.match_ignore_ascii_case);
                    const unit = tok.dimension.unit;
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "n")) {
                        return parse_b(input, a);
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "n-")) {
                        return parse_signless_b(input, a, -1);
                    } else {
                        if (parse_n_dash_digits(input.allocator(), unit).asValue()) |b| {
                            return .{ .result = .{ a, b } };
                        } else {
                            return .{ .err = input.newUnexpectedTokenError(.{ .ident = unit }) };
                        }
                    }
                }
            },
            .ident => {
                const value = tok.ident;
                // @compileError(todo_stuff.match_ignore_ascii_case);
                if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "even")) {
                    return .{ .result = .{ 2, 0 } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "odd")) {
                    return .{ .result = .{ 2, 1 } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "n")) {
                    return parse_b(input, 1);
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "-n")) {
                    return parse_b(input, -1);
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "n-")) {
                    return parse_signless_b(input, 1, -1);
                } else if (bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(value, "-n-")) {
                    return parse_signless_b(input, -1, -1);
                } else {
                    const slice, const a: i32 = if (bun.strings.startsWithChar(value, '-')) .{ value[1..], -1 } else .{ value, 1 };
                    if (parse_n_dash_digits(input.allocator(), slice).asValue()) |b| return .{ .result = .{ a, b } };
                    return .{ .err = input.newUnexpectedTokenError(.{ .ident = value }) };
                }
            },
            .delim => {
                const next_tok = switch (input.nextIncludingWhitespace()) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                if (next_tok.* == .ident) {
                    const value = next_tok.ident;
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "n")) {
                        return parse_b(input, 1);
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(value, "-n")) {
                        return parse_signless_b(input, 1, -1);
                    } else {
                        if (parse_n_dash_digits(input.allocator(), value).asValue()) |b| {
                            return .{ .result = .{ 1, b } };
                        } else {
                            return .{ .err = input.newUnexpectedTokenError(.{ .ident = value }) };
                        }
                    }
                } else {
                    return .{ .err = input.newUnexpectedTokenError(next_tok.*) };
                }
            },
            else => {},
        }
        return .{ .err = input.newUnexpectedTokenError(tok.*) };
    }

    fn parse_b(input: *Parser, a: i32) Result(NthResult) {
        const start = input.state();
        const tok = switch (input.next()) {
            .result => |v| v,
            .err => {
                input.reset(&start);
                return .{ .result = .{ a, 0 } };
            },
        };

        if (tok.* == .delim and tok.delim == '+') return parse_signless_b(input, a, 1);
        if (tok.* == .delim and tok.delim == '-') return parse_signless_b(input, a, -1);
        if (tok.* == .number and tok.number.has_sign and tok.number.int_value != null) return .{ .result = NthResult{ a, tok.number.int_value.? } };
        input.reset(&start);
        return .{ .result = .{ a, 0 } };
    }

    fn parse_signless_b(input: *Parser, a: i32, b_sign: i32) Result(NthResult) {
        const tok = switch (input.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (tok.* == .number and !tok.number.has_sign and tok.number.int_value != null) {
            const b = tok.number.int_value.?;
            return .{ .result = .{ a, b_sign * b } };
        }
        return .{ .err = input.newUnexpectedTokenError(tok.*) };
    }

    fn parse_n_dash_digits(allocator: Allocator, str: []const u8) Maybe(i32, void) {
        const bytes = str;
        if (bytes.len >= 3 and
            bun.strings.eqlCaseInsensitiveASCIIICheckLength(bytes[0..2], "n-") and
            brk: {
            for (bytes[2..]) |b| {
                if (b < '0' or b > '9') break :brk false;
            }
            break :brk true;
        }) {
            return parse_number_saturate(allocator, str[1..]); // Include the minus sign
        } else {
            return .{ .err = {} };
        }
    }

    fn parse_number_saturate(allocator: Allocator, string: []const u8) Maybe(i32, void) {
        var input = ParserInput.new(allocator, string);
        var parser = Parser.new(&input, null);
        const tok = switch (parser.nextIncludingWhitespaceAndComments()) {
            .result => |v| v,
            .err => {
                return .{ .err = {} };
            },
        };
        const int = if (tok.* == .number and tok.number.int_value != null) tok.number.int_value.? else {
            return .{ .err = {} };
        };
        if (!parser.isExhausted()) {
            return .{ .err = {} };
        }
        return .{ .result = int };
    }
};

const CachedToken = struct {
    token: Token,
    start_position: usize,
    end_state: ParserState,
};

const Tokenizer = struct {
    src: []const u8,
    position: usize = 0,
    source_map_url: ?[]const u8 = null,
    current_line_start_position: usize = 0,
    current_line_number: u32 = 0,
    allocator: Allocator,
    var_or_env_functions: SeenStatus = .dont_care,
    current: Token = undefined,
    previous: Token = undefined,

    const SeenStatus = enum {
        dont_care,
        looking_for_them,
        seen_at_least_one,
    };

    const FORM_FEED_BYTE = 0x0C;
    const REPLACEMENT_CHAR = 0xFFFD;
    const REPLACEMENT_CHAR_UNICODE: [3]u8 = [3]u8{ 0xEF, 0xBF, 0xBD };
    const MAX_ONE_B: u32 = 0x80;
    const MAX_TWO_B: u32 = 0x800;
    const MAX_THREE_B: u32 = 0x10000;

    pub fn init(allocator: Allocator, src: []const u8) Tokenizer {
        var lexer = Tokenizer{
            .src = src,
            .allocator = allocator,
            .position = 0,
        };

        lexer.position = 0;

        return lexer;
    }

    pub fn currentSourceMapUrl(this: *const Tokenizer) ?[]const u8 {
        return this.source_map_url;
    }

    pub fn getPosition(this: *const Tokenizer) usize {
        bun.debugAssert(bun.strings.isOnCharBoundary(this.src, this.position));
        return this.position;
    }

    pub fn state(this: *const Tokenizer) ParserState {
        return ParserState{
            .position = this.position,
            .current_line_start_position = this.current_line_start_position,
            .current_line_number = this.current_line_number,
            .at_start_of = null,
            .import_record_count = 0,
        };
    }

    pub fn skipWhitespace(this: *Tokenizer) void {
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ' ', '\t' => this.advance(1),
                '\n', 0x0C, '\r' => this.consumeNewline(),
                '/' => {
                    if (this.startsWith("/*")) {
                        _ = this.consumeComment();
                    } else return;
                },
                else => return,
            }
        }
    }

    pub fn currentSourceLocation(this: *const Tokenizer) SourceLocation {
        return SourceLocation{
            .line = this.current_line_number,
            .column = @intCast((this.position - this.current_line_start_position) + 1),
        };
    }

    pub fn prev(this: *Tokenizer) Token {
        bun.assert(this.position > 0);
        return this.previous;
    }

    pub inline fn isEof(this: *Tokenizer) bool {
        return this.position >= this.src.len;
    }

    pub fn seeFunction(this: *Tokenizer, name: []const u8) void {
        if (this.var_or_env_functions == .looking_for_them) {
            if (std.ascii.eqlIgnoreCase(name, "var") and std.ascii.eqlIgnoreCase(name, "env")) {
                this.var_or_env_functions = .seen_at_least_one;
            }
        }
    }

    /// TODO: fix this, remove the additional shit I added
    /// return error if it is eof
    pub inline fn next(this: *Tokenizer) Maybe(Token, void) {
        return this.nextImpl();
    }

    pub fn nextImpl(this: *Tokenizer) Maybe(Token, void) {
        if (this.isEof()) return .{ .err = {} };

        // todo_stuff.match_byte;
        const b = this.byteAt(0);
        const token: Token = switch (b) {
            ' ', '\t' => this.consumeWhitespace(false),
            '\n', FORM_FEED_BYTE, '\r' => this.consumeWhitespace(true),
            '"' => this.consumeString(false),
            '#' => brk: {
                this.advance(1);
                if (this.isIdentStart()) break :brk .{ .idhash = this.consumeName() };
                if (!this.isEof() and switch (this.nextByteUnchecked()) {
                    // Any other valid case here already resulted in IDHash.
                    '0'...'9', '-' => true,
                    else => false,
                }) break :brk .{ .hash = this.consumeName() };
                break :brk .{ .delim = '#' };
            },
            '$' => brk: {
                if (this.startsWith("$=")) {
                    this.advance(2);
                    break :brk .suffix_match;
                }
                this.advance(1);
                break :brk .{ .delim = '$' };
            },
            '\'' => this.consumeString(true),
            '(' => brk: {
                this.advance(1);
                break :brk .open_paren;
            },
            ')' => brk: {
                this.advance(1);
                break :brk .close_paren;
            },
            '*' => brk: {
                if (this.startsWith("*=")) {
                    this.advance(2);
                    break :brk .substring_match;
                }
                this.advance(1);
                break :brk .{ .delim = '*' };
            },
            '+' => brk: {
                if ((this.hasAtLeast(1) and switch (this.byteAt(1)) {
                    '0'...'9' => true,
                    else => false,
                }) or (this.hasAtLeast(2) and
                    this.byteAt(1) == '.' and switch (this.byteAt(2)) {
                    '0'...'9' => true,
                    else => false,
                })) {
                    break :brk this.consumeNumeric();
                }

                this.advance(1);
                break :brk .{ .delim = '+' };
            },
            ',' => brk: {
                this.advance(1);
                break :brk .comma;
            },
            '-' => brk: {
                if ((this.hasAtLeast(1) and switch (this.byteAt(1)) {
                    '0'...'9' => true,
                    else => false,
                }) or (this.hasAtLeast(2) and this.byteAt(1) == '.' and switch (this.byteAt(2)) {
                    '0'...'9' => true,
                    else => false,
                })) break :brk this.consumeNumeric();

                if (this.startsWith("-->")) {
                    this.advance(3);
                    break :brk .cdc;
                }

                if (this.isIdentStart()) break :brk this.consumeIdentLike();

                this.advance(1);
                break :brk .{ .delim = '-' };
            },
            '.' => brk: {
                if (this.hasAtLeast(1) and switch (this.byteAt(1)) {
                    '0'...'9' => true,
                    else => false,
                }) {
                    break :brk this.consumeNumeric();
                }
                this.advance(1);
                break :brk .{ .delim = '.' };
            },
            '/' => brk: {
                if (this.startsWith("/*")) break :brk .{ .comment = this.consumeComment() };
                this.advance(1);
                break :brk .{ .delim = '/' };
            },
            '0'...'9' => this.consumeNumeric(),
            ':' => brk: {
                this.advance(1);
                break :brk .colon;
            },
            ';' => brk: {
                this.advance(1);
                break :brk .semicolon;
            },
            '<' => brk: {
                if (this.startsWith("<!--")) {
                    this.advance(4);
                    break :brk .cdo;
                }
                this.advance(1);
                break :brk .{ .delim = '<' };
            },
            '@' => brk: {
                this.advance(1);
                if (this.isIdentStart()) break :brk .{ .at_keyword = this.consumeName() };
                break :brk .{ .delim = '@' };
            },
            'a'...'z', 'A'...'Z', '_', 0 => this.consumeIdentLike(),
            '[' => brk: {
                this.advance(1);
                break :brk .open_square;
            },
            '\\' => brk: {
                if (!this.hasNewlineAt(1)) break :brk this.consumeIdentLike();
                this.advance(1);
                break :brk .{ .delim = '\\' };
            },
            ']' => brk: {
                this.advance(1);
                break :brk .close_square;
            },
            '^' => brk: {
                if (this.startsWith("^=")) {
                    this.advance(2);
                    break :brk .prefix_match;
                }
                this.advance(1);
                break :brk .{ .delim = '^' };
            },
            '{' => brk: {
                this.advance(1);
                break :brk .open_curly;
            },
            '|' => brk: {
                if (this.startsWith("|=")) {
                    this.advance(2);
                    break :brk .dash_match;
                }
                this.advance(1);
                break :brk .{ .delim = '|' };
            },
            '}' => brk: {
                this.advance(1);
                break :brk .close_curly;
            },
            '~' => brk: {
                if (this.startsWith("~=")) {
                    this.advance(2);
                    break :brk .include_match;
                }
                this.advance(1);
                break :brk .{ .delim = '~' };
            },
            else => brk: {
                if (!std.ascii.isASCII(b)) {
                    break :brk this.consumeIdentLike();
                }
                this.advance(1);
                break :brk .{ .delim = b };
            },
        };

        return .{ .result = token };
    }

    pub fn reset(this: *Tokenizer, state2: *const ParserState) void {
        this.position = state2.position;
        this.current_line_start_position = state2.current_line_start_position;
        this.current_line_number = state2.current_line_number;
    }

    pub fn @"skip cdc and cdo"(this: *@This()) void {
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ' ', '\t' => this.advance(1),
                '\n', 0x0C, '\r' => this.consumeNewline(),
                '/' => if (this.startsWith("/*")) {
                    _ = this.consumeComment();
                } else return,
                '<' => if (this.startsWith("<!--")) this.advance(4) else return,
                '-' => if (this.startsWith("-->")) this.advance(3) else return,
                else => return,
            }
        }
    }

    pub fn consumeNumeric(this: *Tokenizer) Token {
        // Parse [+-]?\d*(\.\d+)?([eE][+-]?\d+)?
        // But this is always called so that there is at least one digit in \d*(\.\d+)?

        // Do all the math in f64 so that large numbers overflow to +/-inf
        // and i32::{MIN, MAX} are within range.
        const has_sign: bool, const sign: f64 = brk: {
            switch (this.nextByteUnchecked()) {
                '-' => break :brk .{ true, -1.0 },
                '+' => break :brk .{ true, 1.0 },
                else => break :brk .{ false, 1.0 },
            }
        };

        if (has_sign) this.advance(1);

        var integral_part: f64 = 0.0;
        while (byteToDecimalDigit(this.nextByteUnchecked())) |digit| {
            integral_part = integral_part * 10.0 + @as(f64, @floatFromInt(digit));
            this.advance(1);
            if (this.isEof()) break;
        }

        var is_integer = true;

        var fractional_part: f64 = 0.0;
        if (this.hasAtLeast(1) and this.nextByteUnchecked() == '.' and switch (this.byteAt(1)) {
            '0'...'9' => true,
            else => false,
        }) {
            is_integer = false;
            this.advance(1); // Consume '.'
            var factor: f64 = 0.1;
            while (byteToDecimalDigit(this.nextByteUnchecked())) |digit| {
                fractional_part += @as(f64, @floatFromInt(digit)) * factor;
                factor *= 0.1;
                this.advance(1);
                if (this.isEof()) break;
            }
        }

        var value: f64 = sign * (integral_part + fractional_part);

        if (this.hasAtLeast(1) and switch (this.nextByteUnchecked()) {
            'e', 'E' => true,
            else => false,
        }) {
            if (switch (this.byteAt(1)) {
                '0'...'9' => true,
                else => false,
            } or (this.hasAtLeast(2) and switch (this.byteAt(1)) {
                '+', '-' => true,
                else => false,
            } and switch (this.byteAt(2)) {
                '0'...'9' => true,
                else => false,
            })) {
                is_integer = false;
                this.advance(1);
                const has_sign2: bool, const sign2: f64 = brk: {
                    switch (this.nextByteUnchecked()) {
                        '-' => break :brk .{ true, -1.0 },
                        '+' => break :brk .{ true, 1.0 },
                        else => break :brk .{ false, 1.0 },
                    }
                };

                if (has_sign2) this.advance(1);

                var exponent: f64 = 0.0;
                while (byteToDecimalDigit(this.nextByteUnchecked())) |digit| {
                    exponent = exponent * 10.0 + @as(f64, @floatFromInt(digit));
                    this.advance(1);
                    if (this.isEof()) break;
                }
                value *= bun.pow(10, sign2 * exponent);
            }
        }

        const int_value: ?i32 = brk: {
            const i32_max = comptime std.math.maxInt(i32);
            const i32_min = comptime std.math.minInt(i32);
            if (is_integer) {
                if (value >= @as(f64, @floatFromInt(i32_max))) {
                    break :brk i32_max;
                } else if (value <= @as(f64, @floatFromInt(i32_min))) {
                    break :brk i32_min;
                } else {
                    break :brk @intFromFloat(value);
                }
            }

            break :brk null;
        };

        if (!this.isEof() and this.nextByteUnchecked() == '%') {
            this.advance(1);
            return .{ .percentage = .{ .unit_value = @floatCast(value / 100), .int_value = int_value, .has_sign = has_sign } };
        }

        if (this.isIdentStart()) {
            const unit = this.consumeName();
            return .{
                .dimension = .{
                    .num = .{ .value = @floatCast(value), .int_value = int_value, .has_sign = has_sign },
                    .unit = unit,
                },
            };
        }

        return .{
            .number = .{ .value = @floatCast(value), .int_value = int_value, .has_sign = has_sign },
        };
    }

    pub fn consumeWhitespace(this: *Tokenizer, comptime newline: bool) Token {
        const start_position = this.position;
        if (newline) {
            this.consumeNewline();
        } else {
            this.advance(1);
        }

        while (!this.isEof()) {
            // todo_stuff.match_byte
            const b = this.nextByteUnchecked();
            switch (b) {
                ' ', '\t' => this.advance(1),
                '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                else => break,
            }
        }

        return .{ .whitespace = this.sliceFrom(start_position) };
    }

    pub fn consumeString(this: *Tokenizer, comptime single_quote: bool) Token {
        const quoted_string = this.consumeQuotedString(single_quote);
        if (quoted_string.bad) return .{ .bad_string = quoted_string.str };
        return .{ .quoted_string = quoted_string.str };
    }

    pub fn consumeIdentLike(this: *Tokenizer) Token {
        const value = this.consumeName();
        if (!this.isEof() and this.nextByteUnchecked() == '(') {
            this.advance(1);
            if (std.ascii.eqlIgnoreCase(value, "url")) return if (this.consumeUnquotedUrl()) |tok| return tok else .{ .function = value };
            this.seeFunction(value);
            return .{ .function = value };
        }
        return .{ .ident = value };
    }

    pub fn consumeName(this: *Tokenizer) []const u8 {
        const start_pos = this.position;
        var value_bytes: CopyOnWriteStr = undefined;

        while (true) {
            if (this.isEof()) return this.sliceFrom(start_pos);

            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-' => this.advance(1),
                '\\', 0 => {
                    // * The tokenizer’s input is UTF-8 since it’s `&str`.
                    // * start_pos is at a code point boundary
                    // * so is the current position (which is before '\\' or '\0'
                    //
                    // So `value_bytes` is well-formed UTF-8.
                    value_bytes = .{ .borrowed = this.sliceFrom(start_pos) };
                    break;
                },
                0x80...0xBF => this.consumeContinuationByte(),
                // This is the range of the leading byte of a 2-3 byte character
                // encoding
                0xC0...0xEF => this.advance(1),
                0xF0...0xFF => this.consume4byteIntro(),
                else => return this.sliceFrom(start_pos),
            }
        }

        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-' => {
                    this.advance(1);
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                '\\' => {
                    if (this.hasNewlineAt(1)) break;
                    this.advance(1);
                    this.consumeEscapeAndWrite(&value_bytes);
                },
                0 => {
                    this.advance(1);
                    value_bytes.append(this.allocator, REPLACEMENT_CHAR_UNICODE[0..]);
                },
                0x80...0xBF => {
                    // This byte *is* part of a multi-byte code point,
                    // we’ll end up copying the whole code point before this loop does something else.
                    this.consumeContinuationByte();
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                0xC0...0xEF => {
                    // This byte *is* part of a multi-byte code point,
                    // we’ll end up copying the whole code point before this loop does something else.
                    this.advance(1);
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                0xF0...0xFF => {
                    this.consume4byteIntro();
                    value_bytes.append(this.allocator, &[_]u8{b});
                },
                else => {
                    // ASCII
                    break;
                },
            }
        }

        return value_bytes.toSlice();
    }

    pub fn consumeQuotedString(this: *Tokenizer, comptime single_quote: bool) struct { str: []const u8, bad: bool = false } {
        this.advance(1); // Skip the initial quote
        const start_pos = this.position;
        var string_bytes: CopyOnWriteStr = undefined;

        while (true) {
            if (this.isEof()) return .{ .str = this.sliceFrom(start_pos) };

            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                '"' => {
                    if (!single_quote) {
                        const value = this.sliceFrom(start_pos);
                        this.advance(1);
                        return .{ .str = value };
                    }
                    this.advance(1);
                },
                '\'' => {
                    if (single_quote) {
                        const value = this.sliceFrom(start_pos);
                        this.advance(1);
                        return .{ .str = value };
                    }
                    this.advance(1);
                },
                // The CSS spec says NULL bytes ('\0') should be turned into replacement characters: 0xFFFD
                '\\', 0 => {
                    // * The tokenizer’s input is UTF-8 since it’s `&str`.
                    // * start_pos is at a code point boundary
                    // * so is the current position (which is before '\\' or '\0'
                    //
                    // So `string_bytes` is well-formed UTF-8.
                    string_bytes = .{ .borrowed = this.sliceFrom(start_pos) };
                    break;
                },
                '\n', '\r', FORM_FEED_BYTE => return .{ .str = this.sliceFrom(start_pos), .bad = true },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    this.advance(1);
                },
            }
        }

        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                // string_bytes is well-formed UTF-8, see other comments
                '\n', '\r', FORM_FEED_BYTE => return .{ .str = string_bytes.toSlice(), .bad = true },
                '"' => {
                    this.advance(1);
                    if (!single_quote) break;
                },
                '\'' => {
                    this.advance(1);
                    if (single_quote) break;
                },
                '\\' => {
                    this.advance(1);
                    if (!this.isEof()) {
                        switch (this.nextByteUnchecked()) {
                            // Escaped newline
                            '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                            else => this.consumeEscapeAndWrite(&string_bytes),
                        }
                    }
                    // else: escaped EOF, do nothing.
                    // continue;
                },
                0 => {
                    this.advance(1);
                    string_bytes.append(this.allocator, REPLACEMENT_CHAR_UNICODE[0..]);
                    continue;
                },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    this.advance(1);
                },
            }

            string_bytes.append(this.allocator, &[_]u8{b});
        }

        return .{ .str = string_bytes.toSlice() };
    }

    pub fn consumeUnquotedUrl(this: *Tokenizer) ?Token {
        // This is only called after "url(", so the current position is a code point boundary.
        const start_position = this.position;
        const from_start = this.src[this.position..];
        var newlines: u32 = 0;
        var last_newline: usize = 0;
        var found_printable_char = false;

        var offset: usize = 0;
        var b: u8 = undefined;
        while (true) {
            defer offset += 1;

            if (offset < from_start.len) {
                b = from_start[offset];
            } else {
                this.position = this.src.len;
                break;
            }

            // todo_stuff.match_byte
            switch (b) {
                ' ', '\t' => {},
                '\n', FORM_FEED_BYTE => {
                    newlines += 1;
                    last_newline = offset;
                },
                '\r' => {
                    if (offset + 1 < from_start.len and from_start[offset + 1] != '\n') {
                        newlines += 1;
                        last_newline = offset;
                    }
                },
                '"', '\'' => return null, // Do not advance
                ')' => {
                    // Don't use advance, because we may be skipping
                    // newlines here, and we want to avoid the assert.
                    this.position += offset + 1;
                    break;
                },
                else => {
                    // Don't use advance, because we may be skipping
                    // newlines here, and we want to avoid the assert.
                    this.position += offset;
                    found_printable_char = true;
                    break;
                },
            }
        }

        if (newlines > 0) {
            this.current_line_number += newlines;
            // No need for wrapping_add here, because there's no possible
            // way to wrap.
            this.current_line_start_position = start_position + last_newline + 1;
        }

        if (found_printable_char) {
            // This function only consumed ASCII (whitespace) bytes,
            // so the current position is a code point boundary.
            return this.consumeUnquotedUrlInternal();
        }
        return .{ .unquoted_url = "" };
    }

    pub fn consumeUnquotedUrlInternal(this: *Tokenizer) Token {
        // This function is only called with start_pos at a code point boundary.;
        const start_pos = this.position;
        var string_bytes: CopyOnWriteStr = undefined;

        while (true) {
            if (this.isEof()) return .{ .unquoted_url = this.sliceFrom(start_pos) };

            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ' ', '\t', '\n', '\r', FORM_FEED_BYTE => {
                    var value = .{ .borrowed = this.sliceFrom(start_pos) };
                    return this.consumeUrlEnd(start_pos, &value);
                },
                ')' => {
                    const value = this.sliceFrom(start_pos);
                    this.advance(1);
                    return .{ .unquoted_url = value };
                },
                // non-printable
                0x01...0x08,
                0x0B,
                0x0E...0x1F,
                0x7F,

                // not valid in this context
                '"',
                '\'',
                '(',
                => {
                    this.advance(1);
                    return this.consumeBadUrl(start_pos);
                },
                '\\', 0 => {
                    // * The tokenizer’s input is UTF-8 since it’s `&str`.
                    // * start_pos is at a code point boundary
                    // * so is the current position (which is before '\\' or '\0'
                    //
                    // So `string_bytes` is well-formed UTF-8.
                    string_bytes = .{ .borrowed = this.sliceFrom(start_pos) };
                    break;
                },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    // ASCII or other leading byte.
                    this.advance(1);
                },
            }
        }

        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                ' ', '\t', '\n', '\r', FORM_FEED_BYTE => {
                    // string_bytes is well-formed UTF-8, see other comments.
                    // const string = string_bytes.toSlice();
                    // return this.consumeUrlEnd(start_pos, &string);
                    return this.consumeUrlEnd(start_pos, &string_bytes);
                },
                ')' => {
                    this.advance(1);
                    break;
                },
                // non-printable
                0x01...0x08,
                0x0B,
                0x0E...0x1F,
                0x7F,

                // invalid in this context
                '"',
                '\'',
                '(',
                => {
                    this.advance(1);
                    return this.consumeBadUrl(start_pos);
                },
                '\\' => {
                    this.advance(1);
                    if (this.hasNewlineAt(0)) return this.consumeBadUrl(start_pos);

                    // This pushes one well-formed code point to string_bytes
                    this.consumeEscapeAndWrite(&string_bytes);
                },
                0 => {
                    this.advance(1);
                    string_bytes.append(this.allocator, REPLACEMENT_CHAR_UNICODE[0..]);
                },
                0x80...0xBF => {
                    // We’ll end up copying the whole code point
                    // before this loop does something else.
                    this.consumeContinuationByte();
                    string_bytes.append(this.allocator, &[_]u8{b});
                },
                0xF0...0xFF => {
                    // We’ll end up copying the whole code point
                    // before this loop does something else.
                    this.consume4byteIntro();
                    string_bytes.append(this.allocator, &[_]u8{b});
                },
                // If this byte is part of a multi-byte code point,
                // we’ll end up copying the whole code point before this loop does something else.
                else => {
                    // ASCII or other leading byte.
                    this.advance(1);
                    string_bytes.append(this.allocator, &[_]u8{b});
                },
            }
        }

        // string_bytes is well-formed UTF-8, see other comments.
        return .{ .unquoted_url = string_bytes.toSlice() };
    }

    pub fn consumeUrlEnd(this: *Tokenizer, start_pos: usize, string: *CopyOnWriteStr) Token {
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ')' => {
                    this.advance(1);
                    break;
                },
                ' ', '\t' => this.advance(1),
                '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                else => |b| {
                    this.consumeKnownByte(b);
                    return this.consumeBadUrl(start_pos);
                },
            }
        }

        return .{ .unquoted_url = string.toSlice() };
    }

    pub fn consumeBadUrl(this: *Tokenizer, start_pos: usize) Token {
        // Consume up to the closing )
        while (!this.isEof()) {
            // todo_stuff.match_byte
            switch (this.nextByteUnchecked()) {
                ')' => {
                    const contents = this.sliceFrom(start_pos);
                    this.advance(1);
                    return .{ .bad_url = contents };
                },
                '\\' => {
                    this.advance(1);
                    if (this.nextByte()) |b| {
                        if (b == ')' or b == '\\') this.advance(1); // Skip an escaped ')' or '\'
                    }
                },
                '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                else => |b| this.consumeKnownByte(b),
            }
        }
        return .{ .bad_url = this.sliceFrom(start_pos) };
    }

    pub fn consumeEscapeAndWrite(this: *Tokenizer, bytes: *CopyOnWriteStr) void {
        const val = this.consumeEscape();
        var utf8bytes: [4]u8 = undefined;
        const len = std.unicode.utf8Encode(@truncate(val), utf8bytes[0..]) catch @panic("Invalid");
        bytes.append(this.allocator, utf8bytes[0..len]);
    }

    pub fn consumeEscape(this: *Tokenizer) u32 {
        if (this.isEof()) return 0xFFFD; // Unicode replacement character

        // todo_stuff.match_byte
        switch (this.nextByteUnchecked()) {
            '0'...'9', 'A'...'F', 'a'...'f' => {
                const c = this.consumeHexDigits().value;
                if (!this.isEof()) {
                    // todo_stuff.match_byte
                    switch (this.nextByteUnchecked()) {
                        ' ', '\t' => this.advance(1),
                        '\n', FORM_FEED_BYTE, '\r' => this.consumeNewline(),
                        else => {},
                    }
                }

                if (c != 0 and std.unicode.utf8ValidCodepoint(@truncate(c))) return c;
                return REPLACEMENT_CHAR;
            },
            0 => {
                this.advance(1);
                return REPLACEMENT_CHAR;
            },
            else => return this.consumeChar(),
        }
    }

    pub fn consumeHexDigits(this: *Tokenizer) struct { value: u32, num_digits: u32 } {
        var value: u32 = 0;
        var digits: u32 = 0;
        while (digits < 6 and !this.isEof()) {
            if (byteToHexDigit(this.nextByteUnchecked())) |digit| {
                value = value * 16 + digit;
                digits += 1;
                this.advance(1);
            } else break;
        }

        return .{ .value = value, .num_digits = digits };
    }

    pub fn consumeChar(this: *Tokenizer) u32 {
        const c = this.nextChar();
        const len_utf8 = lenUtf8(c);
        this.position += len_utf8;
        // Note that due to the special case for the 4-byte sequence
        // intro, we must use wrapping add here.
        this.current_line_start_position +%= len_utf8 - lenUtf16(c);
        return c;
    }

    fn lenUtf8(code: u32) usize {
        if (code < MAX_ONE_B) {
            return 1;
        } else if (code < MAX_TWO_B) {
            return 2;
        } else if (code < MAX_THREE_B) {
            return 3;
        } else {
            return 4;
        }
    }

    fn lenUtf16(ch: u32) usize {
        if ((ch & 0xFFFF) == ch) {
            return 1;
        } else {
            return 2;
        }
    }

    fn byteToHexDigit(b: u8) ?u32 {

        // todo_stuff.match_byte
        return switch (b) {
            '0'...'9' => b - '0',
            'a'...'f' => b - 'a' + 10,
            'A'...'F' => b - 'A' + 10,
            else => null,
        };
    }

    fn byteToDecimalDigit(b: u8) ?u32 {
        if (b >= '0' and b <= '9') {
            return b - '0';
        }
        return null;
    }

    pub fn consumeComment(this: *Tokenizer) []const u8 {
        this.advance(2);
        const start_position = this.position;
        while (!this.isEof()) {
            const b = this.nextByteUnchecked();
            // todo_stuff.match_byte
            switch (b) {
                '*' => {
                    const end_position = this.position;
                    this.advance(1);
                    if (this.nextByte() == '/') {
                        this.advance(1);
                        const contents = this.src[start_position..end_position];
                        this.checkForSourceMap(contents);
                        return contents;
                    }
                },
                '\n', FORM_FEED_BYTE, '\r' => {
                    this.consumeNewline();
                },
                0x80...0xBF => this.consumeContinuationByte(),
                0xF0...0xFF => this.consume4byteIntro(),
                else => {
                    // ASCII or other leading byte
                    this.advance(1);
                },
            }
        }
        const contents = this.sliceFrom(start_position);
        this.checkForSourceMap(contents);
        return contents;
    }

    pub fn checkForSourceMap(this: *Tokenizer, contents: []const u8) void {
        {
            const directive = "# sourceMappingURL=";
            const directive_old = "@ sourceMappingURL=";
            if (std.mem.startsWith(u8, contents, directive) or std.mem.startsWith(u8, contents, directive_old)) {
                this.source_map_url = splitSourceMap(contents[directive.len..]);
            }
        }

        {
            const directive = "# sourceURL=";
            const directive_old = "@ sourceURL=";
            if (std.mem.startsWith(u8, contents, directive) or std.mem.startsWith(u8, contents, directive_old)) {
                this.source_map_url = splitSourceMap(contents[directive.len..]);
            }
        }
    }

    pub fn splitSourceMap(contents: []const u8) ?[]const u8 {
        // FIXME: Use bun CodepointIterator
        var iter = std.unicode.Utf8Iterator{ .bytes = contents, .i = 0 };
        while (iter.nextCodepoint()) |c| {
            switch (c) {
                ' ', '\t', FORM_FEED_BYTE, '\r', '\n' => {
                    const start = 0;
                    const end = iter.i;
                    return contents[start..end];
                },
                else => {},
            }
        }
        return null;
    }

    pub fn consumeNewline(this: *Tokenizer) void {
        const byte = this.nextByteUnchecked();
        if (bun.Environment.allow_assert) {
            std.debug.assert(byte == '\r' or byte == '\n' or byte == FORM_FEED_BYTE);
        }
        this.position += 1;
        if (byte == '\r' and this.nextByte() == '\n') {
            this.position += 1;
        }
        this.current_line_start_position = this.position;
        this.current_line_number += 1;
    }

    /// Advance over a single byte; the byte must be a UTF-8
    /// continuation byte.
    ///
    /// Binary    Hex          Comments
    /// 0xxxxxxx  0x00..0x7F   Only byte of a 1-byte character encoding
    /// 110xxxxx  0xC0..0xDF   First byte of a 2-byte character encoding
    /// 1110xxxx  0xE0..0xEF   First byte of a 3-byte character encoding
    /// 11110xxx  0xF0..0xF7   First byte of a 4-byte character encoding
    /// 10xxxxxx  0x80..0xBF   Continuation byte: one of 1-3 bytes following the first <--
    pub fn consumeContinuationByte(this: *Tokenizer) void {
        if (bun.Environment.allow_assert) std.debug.assert(this.nextByteUnchecked() & 0xC0 == 0x80);
        // Continuation bytes contribute to column overcount. Note
        // that due to the special case for the 4-byte sequence intro,
        // we must use wrapping add here.
        this.current_line_start_position +%= 1;
        this.position += 1;
    }

    /// Advance over a single byte; the byte must be a UTF-8 sequence
    /// leader for a 4-byte sequence.
    ///
    /// Binary    Hex          Comments
    /// 0xxxxxxx  0x00..0x7F   Only byte of a 1-byte character encoding
    /// 110xxxxx  0xC0..0xDF   First byte of a 2-byte character encoding
    /// 1110xxxx  0xE0..0xEF   First byte of a 3-byte character encoding
    /// 11110xxx  0xF0..0xF7   First byte of a 4-byte character encoding <--
    /// 10xxxxxx  0x80..0xBF   Continuation byte: one of 1-3 bytes following the first
    pub fn consume4byteIntro(this: *Tokenizer) void {
        if (bun.Environment.allow_assert) std.debug.assert(this.nextByteUnchecked() & 0xF0 == 0xF0);
        // This takes two UTF-16 characters to represent, so we
        // actually have an undercount.
        // this.current_line_start_position = self.current_line_start_position.wrapping_sub(1);
        this.current_line_start_position -%= 1;
        this.position += 1;
    }

    pub fn isIdentStart(this: *Tokenizer) bool {

        // todo_stuff.match_byte
        return !this.isEof() and switch (this.nextByteUnchecked()) {
            'a'...'z', 'A'...'Z', '_', 0 => true,

            // todo_stuff.match_byte
            '-' => this.hasAtLeast(1) and switch (this.byteAt(1)) {
                'a'...'z', 'A'...'Z', '-', '_', 0 => true,
                '\\' => !this.hasNewlineAt(1),
                else => |b| !std.ascii.isASCII(b),
            },
            '\\' => !this.hasNewlineAt(1),
            else => |b| !std.ascii.isASCII(b),
        };
    }

    /// If true, the input has at least `n` bytes left *after* the current one.
    /// That is, `tokenizer.char_at(n)` will not panic.
    fn hasAtLeast(this: *Tokenizer, n: usize) bool {
        return this.position + n < this.src.len;
    }

    fn hasNewlineAt(this: *Tokenizer, offset: usize) bool {
        return this.position + offset < this.src.len and switch (this.byteAt(offset)) {
            '\n', '\r', FORM_FEED_BYTE => true,
            else => false,
        };
    }

    pub fn startsWith(this: *Tokenizer, comptime needle: []const u8) bool {
        return bun.strings.hasPrefixComptime(this.src[this.position..], needle);
    }

    /// Advance over N bytes in the input.  This function can advance
    /// over ASCII bytes (excluding newlines), or UTF-8 sequence
    /// leaders (excluding leaders for 4-byte sequences).
    pub fn advance(this: *Tokenizer, n: usize) void {
        if (bun.Environment.allow_assert) {
            // Each byte must either be an ASCII byte or a sequence
            // leader, but not a 4-byte leader; also newlines are
            // rejected.
            for (0..n) |i| {
                const b = this.byteAt(i);
                std.debug.assert(std.ascii.isASCII(b) or (b & 0xF0 != 0xF0 and b & 0xC0 != 0x80));
                std.debug.assert(b != '\r' and b != '\n' and b != '\x0C');
            }
        }
        this.position += n;
    }

    /// Advance over any kind of byte, excluding newlines.
    pub fn consumeKnownByte(this: *Tokenizer, byte: u8) void {
        if (bun.Environment.allow_assert) std.debug.assert(byte != '\r' and byte != '\n' and byte != FORM_FEED_BYTE);
        this.position += 1;
        // Continuation bytes contribute to column overcount.
        if (byte & 0xF0 == 0xF0) {
            // This takes two UTF-16 characters to represent, so we
            // actually have an undercount.
            this.current_line_start_position -%= 1;
        } else if (byte & 0xC0 == 0x80) {
            // Note that due to the special case for the 4-byte
            // sequence intro, we must use wrapping add here.
            this.current_line_start_position +%= 1;
        }
    }

    pub inline fn byteAt(this: *Tokenizer, n: usize) u8 {
        return this.src[this.position + n];
    }

    pub inline fn nextByte(this: *Tokenizer) ?u8 {
        if (this.isEof()) return null;
        return this.src[this.position];
    }

    pub inline fn nextChar(this: *Tokenizer) u32 {
        const len = bun.strings.utf8ByteSequenceLength(this.src[this.position]);
        return bun.strings.decodeWTF8RuneT(this.src[this.position..].ptr[0..4], len, u32, bun.strings.unicode_replacement);
    }

    pub inline fn nextByteUnchecked(this: *Tokenizer) u8 {
        return this.src[this.position];
    }

    pub inline fn sliceFrom(this: *Tokenizer, start: usize) []const u8 {
        return this.src[start..this.position];
    }
};

const TokenKind = enum {
    /// An [<ident-token>](https://drafts.csswg.org/css-syntax/#typedef-ident-token)
    ident,

    /// Value is the ident
    function,

    /// Value is the ident
    at_keyword,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "unrestricted"
    ///
    /// The value does not include the `#` marker.
    hash,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "id"
    ///
    /// The value does not include the `#` marker.
    idhash,

    quoted_string,

    bad_string,

    /// `url(<string-token>)` is represented by a `.function` token
    unquoted_url,

    bad_url,

    /// Value of a single codepoint
    delim,

    /// A <number-token> can be fractional or an integer, and can contain an optional + or - sign
    number,

    percentage,

    dimension,

    whitespace,

    /// `<!---`
    cdo,

    /// `-->`
    cdc,

    /// `~=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    include_match,

    /// `|=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    dash_match,

    /// `^=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    prefix_match,

    /// `$=`(https://www.w3.org/TR/selectors-4/#attribute-substrings)
    suffix_match,

    /// `*=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    substring_match,

    colon,
    semicolon,
    comma,
    open_square,
    close_square,
    open_paren,
    close_paren,
    open_curly,
    close_curly,

    /// Not an actual token in the spec, but we keep it anyway
    comment,

    pub fn toString(this: TokenKind) []const u8 {
        return switch (this) {
            .at_keyword => "@-keyword",
            .bad_string => "bad string token",
            .bad_url => "bad URL token",
            .cdc => "\"-->\"",
            .cdo => "\"<!--\"",
            .close_curly => "\"}\"",
            .close_bracket => "\"]\"",
            .close_paren => "\")\"",
            .colon => "\":\"",
            .comma => "\",\"",
            // TODO esbuild has additional delimiter tokens (e.g. TDelimAmpersand), should we?
            .delim => |c| switch (c) {
                '&' => "\"&\"",
                '*' => "\"*\"",
                '|' => "\"|\"",
                '^' => "\"^\"",
                '$' => "\"$\"",
                '.' => "\".\"",
                '=' => "\"=\"",
                '!' => "\"!\"",
                '>' => "\">\"",
                '-' => "\"-\"",
                '+' => "\"+\"",
                '/' => "\"/\"",
                '~' => "\"~\"",
                else => "delimiter",
            },
            .dimension => "dimension",
            .function => "function token",
            .hash => "hash token",
            .ident => "identifier",
            .number => "number",
            .open_curly => "\"{\"",
            .open_square => "\"[\"",
            .open_paren => "\"(\"",
            .percentage => "percentage",
            .semicolon => "\";\"",
            .string => "string token",
            .unquoted_url => "URL token",
            .whitespace => "whitespace",
            // TODO: esbuild does this, should we?
            // .TSymbol => "identifier",
        };
    }
};

// TODO: make strings be allocated in string pool
pub const Token = union(TokenKind) {
    /// An [<ident-token>](https://drafts.csswg.org/css-syntax/#typedef-ident-token)
    ident: []const u8,

    /// Value is the ident
    function: []const u8,

    /// Value is the ident
    at_keyword: []const u8,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "unrestricted"
    ///
    /// The value does not include the `#` marker.
    hash: []const u8,

    /// A [`<hash-token>`](https://drafts.csswg.org/css-syntax/#hash-token-diagram) with the type flag set to "id"
    ///
    /// The value does not include the `#` marker.
    idhash: []const u8,

    /// A [`<string-token>`](https://drafts.csswg.org/css-syntax/#string-token-diagram)
    ///
    /// The value does not include the quotes.
    quoted_string: []const u8,

    bad_string: []const u8,

    /// `url(<string-token>)` is represented by a `.function` token
    unquoted_url: []const u8,

    bad_url: []const u8,

    /// A `<delim-token>`
    /// Value of a single codepoint
    ///
    /// NOTE/PERF: the css spec says this should be the value of a single codepoint, meaning it needs to 4 bytes long
    /// but in practice, and in this code, we only ever return ascii bytes
    delim: u32,

    /// A <number-token> can be fractional or an integer, and can contain an optional + or - sign
    number: Num,

    percentage: struct {
        has_sign: bool,
        unit_value: f32,
        int_value: ?i32,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return implementEql(@This(), lhs, rhs);
        }

        pub fn __generateHash() void {}
    },

    dimension: Dimension,

    /// [<unicode-range-token>](https://drafts.csswg.org/css-syntax/#typedef-unicode-range-token)
    /// FIXME: this is not complete
    // unicode_range: struct {
    //     start: u32,
    //     end: ?u32,
    // },

    whitespace: []const u8,

    /// `<!---`
    cdo,

    /// `-->`
    cdc,

    /// `~=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    include_match,

    /// `|=` (https://www.w3.org/TR/selectors-4/#attribute-representation)
    dash_match,

    /// `^=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    prefix_match,

    /// `$=`(https://www.w3.org/TR/selectors-4/#attribute-substrings)
    suffix_match,

    /// `*=` (https://www.w3.org/TR/selectors-4/#attribute-substrings)
    substring_match,

    colon,
    semicolon,
    comma,
    open_square,
    close_square,
    open_paren,
    close_paren,
    open_curly,
    close_curly,

    /// Not an actual token in the spec, but we keep it anyway
    comment: []const u8,

    pub fn eql(lhs: *const Token, rhs: *const Token) bool {
        return implementEql(Token, lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return implementHash(@This(), this, hasher);
    }

    /// Return whether this token represents a parse error.
    ///
    /// `BadUrl` and `BadString` are tokenizer-level parse errors.
    ///
    /// `CloseParenthesis`, `CloseSquareBracket`, and `CloseCurlyBracket` are *unmatched*
    /// and therefore parse errors when returned by one of the `Parser::next*` methods.
    pub fn isParseError(this: *const Token) bool {
        return switch (this.*) {
            .bad_url, .bad_string, .close_paren, .close_square, .close_curly => true,
            else => false,
        };
    }

    pub fn format(
        this: *const Token,
        comptime fmt: []const u8,
        opts: std.fmt.FormatOptions,
        writer: anytype,
    ) !void {
        _ = fmt; // autofix
        _ = opts; // autofix
        return switch (this.*) {
            inline .ident,
            .function,
            .at_keyword,
            .hash,
            .idhash,
            .quoted_string,
            .bad_string,
            .unquoted_url,
            .bad_url,
            .whitespace,
            .comment,
            => |str| {
                try writer.print("{s} = {s}", .{ @tagName(this.*), str });
            },
            .delim => |d| {
                try writer.print("'{c}'", .{@as(u8, @truncate(d))});
            },
            else => {
                try writer.print("{s}", .{@tagName(this.*)});
            },
        };
    }

    pub fn raw(this: Token) []const u8 {
        return switch (this) {
            .ident => this.ident,
            // .function =>
        };
    }

    pub inline fn kind(this: Token) TokenKind {
        return @as(TokenKind, this);
    }

    pub inline fn kindString(this: Token) []const u8 {
        return this.kind.toString();
    }

    // ~toCssImpl
    const This = @This();

    pub fn toCssGeneric(this: *const This, writer: anytype) !void {
        return switch (this.*) {
            .ident => {
                try serializer.serializeIdentifier(this.ident, writer);
            },
            .at_keyword => {
                try writer.writeAll("@");
                try serializer.serializeIdentifier(this.at_keyword, writer);
            },
            .hash => {
                try writer.writeAll("#");
                try serializer.serializeName(this.hash, writer);
            },
            .idhash => {
                try writer.writeAll("#");
                try serializer.serializeName(this.idhash, writer);
            },
            .quoted_string => |x| {
                try serializer.serializeName(x, writer);
            },
            .unquoted_url => |x| {
                try writer.writeAll("url(");
                try serializer.serializeUnquotedUrl(x, writer);
                try writer.writeAll(")");
            },
            .delim => |x| {
                bun.assert(x <= 0x7F);
                try writer.writeByte(@intCast(x));
            },
            .number => |n| {
                try serializer.writeNumeric(n.value, n.int_value, n.has_sign, writer);
            },
            .percentage => |p| {
                try serializer.writeNumeric(p.unit_value * 100.0, p.int_value, p.has_sign, writer);
            },
            .dimension => |d| {
                try serializer.writeNumeric(d.num.value, d.num.int_value, d.num.has_sign, writer);
                // Disambiguate with scientific notation.
                const unit = d.unit;
                // TODO(emilio): This doesn't handle e.g. 100E1m, which gets us
                // an unit of "E1m"...
                if ((unit.len == 1 and unit[0] == 'e') or
                    (unit.len == 1 and unit[0] == 'E') or
                    bun.strings.startsWith(unit, "e-") or
                    bun.strings.startsWith(unit, "E-"))
                {
                    try writer.writeAll("\\65 ");
                    try serializer.serializeName(unit[1..], writer);
                } else {
                    try serializer.serializeIdentifier(unit, writer);
                }
            },
            .whitespace => |content| {
                try writer.writeAll(content);
            },
            .comment => |content| {
                try writer.writeAll("/*");
                try writer.writeAll(content);
                try writer.writeAll("*/");
            },
            .colon => try writer.writeAll(":"),
            .semicolon => try writer.writeAll(";"),
            .comma => try writer.writeAll(","),
            .include_match => try writer.writeAll("~="),
            .dash_match => try writer.writeAll("|="),
            .prefix_match => try writer.writeAll("^="),
            .suffix_match => try writer.writeAll("$="),
            .substring_match => try writer.writeAll("*="),
            .cdo => try writer.writeAll("<!--"),
            .cdc => try writer.writeAll("-->"),

            .function => |name| {
                try serializer.serializeIdentifier(name, writer);
                try writer.writeAll("(");
            },
            .open_paren => try writer.writeAll("("),
            .open_square => try writer.writeAll("["),
            .open_curly => try writer.writeAll("{"),

            .bad_url => |contents| {
                try writer.writeAll("url(");
                try writer.writeAll(contents);
                try writer.writeByte(')');
            },
            .bad_string => |value| {
                // During tokenization, an unescaped newline after a quote causes
                // the token to be a BadString instead of a QuotedString.
                // The BadString token ends just before the newline
                // (which is in a separate WhiteSpace token),
                // and therefore does not have a closing quote.
                try writer.writeByte('"');
                var string_writer = serializer.CssStringWriter(@TypeOf(writer)).new(writer);
                try string_writer.writeStr(value);
            },
            .close_paren => try writer.writeAll(")"),
            .close_square => try writer.writeAll("]"),
            .close_curly => try writer.writeAll("}"),
        };
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // zack is here: verify this is correct
        return switch (this.*) {
            .ident => |value| serializer.serializeIdentifier(value, dest) catch return dest.addFmtError(),
            .at_keyword => |value| {
                try dest.writeStr("@");
                return serializer.serializeIdentifier(value, dest) catch return dest.addFmtError();
            },
            .hash => |value| {
                try dest.writeStr("#");
                return serializer.serializeName(value, dest) catch return dest.addFmtError();
            },
            .idhash => |value| {
                try dest.writeStr("#");
                return serializer.serializeIdentifier(value, dest) catch return dest.addFmtError();
            },
            .quoted_string => |value| serializer.serializeString(value, dest) catch return dest.addFmtError(),
            .unquoted_url => |value| {
                try dest.writeStr("url(");
                serializer.serializeUnquotedUrl(value, dest) catch return dest.addFmtError();
                return dest.writeStr(")");
            },
            .delim => |value| {
                // See comment for this variant in declaration of Token
                // The value of delim is only ever ascii
                bun.debugAssert(value <= 0x7F);
                return dest.writeChar(@truncate(value));
            },
            .number => |num| serializer.writeNumeric(num.value, num.int_value, num.has_sign, dest) catch return dest.addFmtError(),
            .percentage => |num| {
                serializer.writeNumeric(num.unit_value * 100, num.int_value, num.has_sign, dest) catch return dest.addFmtError();
                return dest.writeStr("%");
            },
            .dimension => |dim| {
                serializer.writeNumeric(dim.num.value, dim.num.int_value, dim.num.has_sign, dest) catch return dest.addFmtError();
                // Disambiguate with scientific notation.
                const unit = dim.unit;
                if (std.mem.eql(u8, unit, "e") or std.mem.eql(u8, unit, "E") or
                    std.mem.startsWith(u8, unit, "e-") or std.mem.startsWith(u8, unit, "E-"))
                {
                    try dest.writeStr("\\65 ");
                    serializer.serializeName(unit[1..], dest) catch return dest.addFmtError();
                } else {
                    serializer.serializeIdentifier(unit, dest) catch return dest.addFmtError();
                }
                return;
            },
            .whitespace => |content| dest.writeStr(content),
            .comment => |content| {
                try dest.writeStr("/*");
                try dest.writeStr(content);
                return dest.writeStr("*/");
            },
            .colon => dest.writeStr(":"),
            .semicolon => dest.writeStr(";"),
            .comma => dest.writeStr(","),
            .include_match => dest.writeStr("~="),
            .dash_match => dest.writeStr("|="),
            .prefix_match => dest.writeStr("^="),
            .suffix_match => dest.writeStr("$="),
            .substring_match => dest.writeStr("*="),
            .cdo => dest.writeStr("<!--"),
            .cdc => dest.writeStr("-->"),
            .function => |name| {
                serializer.serializeIdentifier(name, dest) catch return dest.addFmtError();
                return dest.writeStr("(");
            },
            .open_paren => dest.writeStr("("),
            .open_square => dest.writeStr("["),
            .open_curly => dest.writeStr("{"),
            .bad_url => |contents| {
                try dest.writeStr("url(");
                try dest.writeStr(contents);
                return dest.writeChar(')');
            },
            .bad_string => |value| {
                try dest.writeChar('"');
                var writer = serializer.CssStringWriter(*Printer(W)).new(dest);
                return writer.writeStr(value) catch return dest.addFmtError();
            },
            .close_paren => dest.writeStr(")"),
            .close_square => dest.writeStr("]"),
            .close_curly => dest.writeStr("}"),
        };
    }
};

const Num = struct {
    has_sign: bool,
    value: f32,
    int_value: ?i32,

    pub fn eql(lhs: *const Num, rhs: *const Num) bool {
        return implementEql(Num, lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return implementHash(@This(), this, hasher);
    }
};

const Dimension = struct {
    num: Num,
    /// e.g. "px"
    unit: []const u8,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return implementEql(@This(), lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return implementHash(@This(), this, hasher);
    }
};

const CopyOnWriteStr = union(enum) {
    borrowed: []const u8,
    owned: std.ArrayList(u8),

    pub fn append(this: *@This(), allocator: Allocator, slice: []const u8) void {
        switch (this.*) {
            .borrowed => {
                var list = std.ArrayList(u8).initCapacity(allocator, this.borrowed.len + slice.len) catch bun.outOfMemory();
                list.appendSliceAssumeCapacity(this.borrowed);
                list.appendSliceAssumeCapacity(slice);
                this.* = .{ .owned = list };
            },
            .owned => {
                this.owned.appendSlice(slice) catch bun.outOfMemory();
            },
        }
    }

    pub fn toSlice(this: *@This()) []const u8 {
        return switch (this.*) {
            .borrowed => this.borrowed,
            .owned => this.owned.items[0..],
        };
    }
};

pub const color = struct {
    /// The opaque alpha value of 1.0.
    pub const OPAQUE: f32 = 1.0;

    const ColorError = error{
        parse,
    };

    /// Either an angle or a number.
    pub const AngleOrNumber = union(enum) {
        /// `<number>`.
        number: struct {
            /// The numeric value parsed, as a float.
            value: f32,
        },
        /// `<angle>`
        angle: struct {
            /// The value as a number of degrees.
            degrees: f32,
        },
    };

    const RGB = struct { u8, u8, u8 };
    pub const named_colors = bun.ComptimeStringMap(RGB, .{
        .{ "aliceblue", .{ 240, 248, 255 } },
        .{ "antiquewhite", .{ 250, 235, 215 } },
        .{ "aqua", .{ 0, 255, 255 } },
        .{ "aquamarine", .{ 127, 255, 212 } },
        .{ "azure", .{ 240, 255, 255 } },
        .{ "beige", .{ 245, 245, 220 } },
        .{ "bisque", .{ 255, 228, 196 } },
        .{ "black", .{ 0, 0, 0 } },
        .{ "blanchedalmond", .{ 255, 235, 205 } },
        .{ "blue", .{ 0, 0, 255 } },
        .{ "blueviolet", .{ 138, 43, 226 } },
        .{ "brown", .{ 165, 42, 42 } },
        .{ "burlywood", .{ 222, 184, 135 } },
        .{ "cadetblue", .{ 95, 158, 160 } },
        .{ "chartreuse", .{ 127, 255, 0 } },
        .{ "chocolate", .{ 210, 105, 30 } },
        .{ "coral", .{ 255, 127, 80 } },
        .{ "cornflowerblue", .{ 100, 149, 237 } },
        .{ "cornsilk", .{ 255, 248, 220 } },
        .{ "crimson", .{ 220, 20, 60 } },
        .{ "cyan", .{ 0, 255, 255 } },
        .{ "darkblue", .{ 0, 0, 139 } },
        .{ "darkcyan", .{ 0, 139, 139 } },
        .{ "darkgoldenrod", .{ 184, 134, 11 } },
        .{ "darkgray", .{ 169, 169, 169 } },
        .{ "darkgreen", .{ 0, 100, 0 } },
        .{ "darkgrey", .{ 169, 169, 169 } },
        .{ "darkkhaki", .{ 189, 183, 107 } },
        .{ "darkmagenta", .{ 139, 0, 139 } },
        .{ "darkolivegreen", .{ 85, 107, 47 } },
        .{ "darkorange", .{ 255, 140, 0 } },
        .{ "darkorchid", .{ 153, 50, 204 } },
        .{ "darkred", .{ 139, 0, 0 } },
        .{ "darksalmon", .{ 233, 150, 122 } },
        .{ "darkseagreen", .{ 143, 188, 143 } },
        .{ "darkslateblue", .{ 72, 61, 139 } },
        .{ "darkslategray", .{ 47, 79, 79 } },
        .{ "darkslategrey", .{ 47, 79, 79 } },
        .{ "darkturquoise", .{ 0, 206, 209 } },
        .{ "darkviolet", .{ 148, 0, 211 } },
        .{ "deeppink", .{ 255, 20, 147 } },
        .{ "deepskyblue", .{ 0, 191, 255 } },
        .{ "dimgray", .{ 105, 105, 105 } },
        .{ "dimgrey", .{ 105, 105, 105 } },
        .{ "dodgerblue", .{ 30, 144, 255 } },
        .{ "firebrick", .{ 178, 34, 34 } },
        .{ "floralwhite", .{ 255, 250, 240 } },
        .{ "forestgreen", .{ 34, 139, 34 } },
        .{ "fuchsia", .{ 255, 0, 255 } },
        .{ "gainsboro", .{ 220, 220, 220 } },
        .{ "ghostwhite", .{ 248, 248, 255 } },
        .{ "gold", .{ 255, 215, 0 } },
        .{ "goldenrod", .{ 218, 165, 32 } },
        .{ "gray", .{ 128, 128, 128 } },
        .{ "green", .{ 0, 128, 0 } },
        .{ "greenyellow", .{ 173, 255, 47 } },
        .{ "grey", .{ 128, 128, 128 } },
        .{ "honeydew", .{ 240, 255, 240 } },
        .{ "hotpink", .{ 255, 105, 180 } },
        .{ "indianred", .{ 205, 92, 92 } },
        .{ "indigo", .{ 75, 0, 130 } },
        .{ "ivory", .{ 255, 255, 240 } },
        .{ "khaki", .{ 240, 230, 140 } },
        .{ "lavender", .{ 230, 230, 250 } },
        .{ "lavenderblush", .{ 255, 240, 245 } },
        .{ "lawngreen", .{ 124, 252, 0 } },
        .{ "lemonchiffon", .{ 255, 250, 205 } },
        .{ "lightblue", .{ 173, 216, 230 } },
        .{ "lightcoral", .{ 240, 128, 128 } },
        .{ "lightcyan", .{ 224, 255, 255 } },
        .{ "lightgoldenrodyellow", .{ 250, 250, 210 } },
        .{ "lightgray", .{ 211, 211, 211 } },
        .{ "lightgreen", .{ 144, 238, 144 } },
        .{ "lightgrey", .{ 211, 211, 211 } },
        .{ "lightpink", .{ 255, 182, 193 } },
        .{ "lightsalmon", .{ 255, 160, 122 } },
        .{ "lightseagreen", .{ 32, 178, 170 } },
        .{ "lightskyblue", .{ 135, 206, 250 } },
        .{ "lightslategray", .{ 119, 136, 153 } },
        .{ "lightslategrey", .{ 119, 136, 153 } },
        .{ "lightsteelblue", .{ 176, 196, 222 } },
        .{ "lightyellow", .{ 255, 255, 224 } },
        .{ "lime", .{ 0, 255, 0 } },
        .{ "limegreen", .{ 50, 205, 50 } },
        .{ "linen", .{ 250, 240, 230 } },
        .{ "magenta", .{ 255, 0, 255 } },
        .{ "maroon", .{ 128, 0, 0 } },
        .{ "mediumaquamarine", .{ 102, 205, 170 } },
        .{ "mediumblue", .{ 0, 0, 205 } },
        .{ "mediumorchid", .{ 186, 85, 211 } },
        .{ "mediumpurple", .{ 147, 112, 219 } },
        .{ "mediumseagreen", .{ 60, 179, 113 } },
        .{ "mediumslateblue", .{ 123, 104, 238 } },
        .{ "mediumspringgreen", .{ 0, 250, 154 } },
        .{ "mediumturquoise", .{ 72, 209, 204 } },
        .{ "mediumvioletred", .{ 199, 21, 133 } },
        .{ "midnightblue", .{ 25, 25, 112 } },
        .{ "mintcream", .{ 245, 255, 250 } },
        .{ "mistyrose", .{ 255, 228, 225 } },
        .{ "moccasin", .{ 255, 228, 181 } },
        .{ "navajowhite", .{ 255, 222, 173 } },
        .{ "navy", .{ 0, 0, 128 } },
        .{ "oldlace", .{ 253, 245, 230 } },
        .{ "olive", .{ 128, 128, 0 } },
        .{ "olivedrab", .{ 107, 142, 35 } },
        .{ "orange", .{ 255, 165, 0 } },
        .{ "orangered", .{ 255, 69, 0 } },
        .{ "orchid", .{ 218, 112, 214 } },
        .{ "palegoldenrod", .{ 238, 232, 170 } },
        .{ "palegreen", .{ 152, 251, 152 } },
        .{ "paleturquoise", .{ 175, 238, 238 } },
        .{ "palevioletred", .{ 219, 112, 147 } },
        .{ "papayawhip", .{ 255, 239, 213 } },
        .{ "peachpuff", .{ 255, 218, 185 } },
        .{ "peru", .{ 205, 133, 63 } },
        .{ "pink", .{ 255, 192, 203 } },
        .{ "plum", .{ 221, 160, 221 } },
        .{ "powderblue", .{ 176, 224, 230 } },
        .{ "purple", .{ 128, 0, 128 } },
        .{ "rebeccapurple", .{ 102, 51, 153 } },
        .{ "red", .{ 255, 0, 0 } },
        .{ "rosybrown", .{ 188, 143, 143 } },
        .{ "royalblue", .{ 65, 105, 225 } },
        .{ "saddlebrown", .{ 139, 69, 19 } },
        .{ "salmon", .{ 250, 128, 114 } },
        .{ "sandybrown", .{ 244, 164, 96 } },
        .{ "seagreen", .{ 46, 139, 87 } },
        .{ "seashell", .{ 255, 245, 238 } },
        .{ "sienna", .{ 160, 82, 45 } },
        .{ "silver", .{ 192, 192, 192 } },
        .{ "skyblue", .{ 135, 206, 235 } },
        .{ "slateblue", .{ 106, 90, 205 } },
        .{ "slategray", .{ 112, 128, 144 } },
        .{ "slategrey", .{ 112, 128, 144 } },
        .{ "snow", .{ 255, 250, 250 } },
        .{ "springgreen", .{ 0, 255, 127 } },
        .{ "steelblue", .{ 70, 130, 180 } },
        .{ "tan", .{ 210, 180, 140 } },
        .{ "teal", .{ 0, 128, 128 } },
        .{ "thistle", .{ 216, 191, 216 } },
        .{ "tomato", .{ 255, 99, 71 } },
        .{ "turquoise", .{ 64, 224, 208 } },
        .{ "violet", .{ 238, 130, 238 } },
        .{ "wheat", .{ 245, 222, 179 } },
        .{ "white", .{ 255, 255, 255 } },
        .{ "whitesmoke", .{ 245, 245, 245 } },
        .{ "yellow", .{ 255, 255, 0 } },
        .{ "yellowgreen", .{ 154, 205, 50 } },
    });

    /// Returns the named color with the given name.
    /// <https://drafts.csswg.org/css-color-4/#typedef-named-color>
    pub fn parseNamedColor(ident: []const u8) ?struct { u8, u8, u8 } {
        return named_colors.get(ident);
    }

    /// Parse a color hash, without the leading '#' character.
    pub fn parseHashColor(value: []const u8) ?struct { u8, u8, u8, f32 } {
        return parseHashColorImpl(value) catch return null;
    }

    pub fn parseHashColorImpl(value: []const u8) ColorError!struct { u8, u8, u8, f32 } {
        return switch (value.len) {
            8 => .{
                (try fromHex(value[0])) * 16 + (try fromHex(value[1])),
                (try fromHex(value[2])) * 16 + (try fromHex(value[3])),
                (try fromHex(value[4])) * 16 + (try fromHex(value[5])),
                @as(f32, @floatFromInt((try fromHex(value[6])) * 16 + (try fromHex(value[7])))) / 255.0,
            },
            6 => {
                const r = (try fromHex(value[0])) * 16 + (try fromHex(value[1]));
                const g = (try fromHex(value[2])) * 16 + (try fromHex(value[3]));
                const b = (try fromHex(value[4])) * 16 + (try fromHex(value[5]));
                return .{
                    r,      g, b,

                    OPAQUE,
                };
            },
            4 => .{
                (try fromHex(value[0])) * 17,
                (try fromHex(value[1])) * 17,
                (try fromHex(value[2])) * 17,
                @as(f32, @floatFromInt((try fromHex(value[3])) * 17)) / 255.0,
            },
            3 => .{
                (try fromHex(value[0])) * 17,
                (try fromHex(value[1])) * 17,
                (try fromHex(value[2])) * 17,
                OPAQUE,
            },
            else => ColorError.parse,
        };
    }

    pub fn fromHex(c: u8) ColorError!u8 {
        return switch (c) {
            '0'...'9' => c - '0',
            'a'...'f' => c - 'a' + 10,
            'A'...'F' => c - 'A' + 10,
            else => ColorError.parse,
        };
    }

    /// <https://drafts.csswg.org/css-color/#hsl-color>
    /// except with h pre-multiplied by 3, to avoid some rounding errors.
    pub fn hslToRgb(hue: f32, saturation: f32, lightness: f32) struct { f32, f32, f32 } {
        bun.debugAssert(saturation >= 0.0 and saturation <= 1.0);
        const Helpers = struct {
            pub fn hueToRgb(m1: f32, m2: f32, _h3: f32) f32 {
                var h3 = _h3;
                if (h3 < 0.0) {
                    h3 += 3.0;
                }
                if (h3 > 3.0) {
                    h3 -= 3.0;
                }
                if (h3 * 2.0 < 1.0) {
                    return m1 + (m2 - m1) * h3 * 2.0;
                } else if (h3 * 2.0 < 3.0) {
                    return m2;
                } else if (h3 < 2.0) {
                    return m1 + (m2 - m1) * (2.0 - h3) * 2.0;
                } else {
                    return m1;
                }
            }
        };
        const m2 = if (lightness <= 0.5)
            lightness * (saturation + 1.0)
        else
            lightness + saturation - lightness * saturation;
        const m1 = lightness * 2.0 - m2;
        const hue_times_3 = hue * 3.0;
        const red = Helpers.hueToRgb(m1, m2, hue_times_3 + 1.0);
        const green = Helpers.hueToRgb(m1, m2, hue_times_3);
        const blue = Helpers.hueToRgb(m1, m2, hue_times_3 - 1.0);
        return .{ red, green, blue };
    }
};

// pub const Bitflags

pub const serializer = struct {
    /// Write a CSS name, like a custom property name.
    ///
    /// You should only use this when you know what you're doing, when in doubt,
    /// consider using `serialize_identifier`.
    pub fn serializeName(value: []const u8, writer: anytype) !void {
        var chunk_start: usize = 0;
        for (value, 0..) |b, i| {
            const escaped: ?[]const u8 = switch (b) {
                '0'...'9', 'A'...'Z', 'a'...'z', '_', '-' => continue,
                // the unicode replacement character
                0 => bun.strings.encodeUTF8Comptime(0xFFD),
                else => if (!std.ascii.isASCII(b)) continue else null,
            };

            try writer.writeAll(value[chunk_start..i]);
            if (escaped) |esc| {
                try writer.writeAll(esc);
            } else if ((b >= 0x01 and b <= 0x1F) or b == 0x7F) {
                try hexEscape(b, writer);
            } else {
                try charEscape(b, writer);
            }
            chunk_start = i + 1;
        }
        return writer.writeAll(value[chunk_start..]);
    }

    /// Write a double-quoted CSS string token, escaping content as necessary.
    pub fn serializeString(value: []const u8, writer: anytype) !void {
        try writer.writeAll("\"");
        var string_writer = CssStringWriter(@TypeOf(writer)).new(writer);
        try string_writer.writeStr(value);
        return writer.writeAll("\"");
    }

    pub fn serializeDimension(value: f32, unit: []const u8, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const int_value: ?i32 = if (fract(value) == 0.0) @intFromFloat(value) else null;
        const token = Token{ .dimension = .{
            .num = .{
                .has_sign = value < 0.0,
                .value = value,
                .int_value = int_value,
            },
            .unit = unit,
        } };
        if (value != 0.0 and @abs(value) < 1.0) {
            // TODO: calculate the actual number of chars here
            var buf: [64]u8 = undefined;
            var fbs = std.io.fixedBufferStream(&buf);
            token.toCssGeneric(fbs.writer()) catch return dest.addFmtError();
            const s = fbs.getWritten();
            if (value < 0.0) {
                try dest.writeStr("-");
                return dest.writeStr(bun.strings.trimLeadingPattern2(s, '-', '0'));
            } else {
                return dest.writeStr(bun.strings.trimLeadingChar(s, '0'));
            }
        } else {
            return token.toCssGeneric(dest) catch return dest.addFmtError();
        }
    }

    /// Write a CSS identifier, escaping characters as necessary.
    pub fn serializeIdentifier(value: []const u8, writer: anytype) !void {
        if (value.len == 0) {
            return;
        }

        if (bun.strings.startsWith(value, "--")) {
            try writer.writeAll("--");
            return serializeName(value[2..], writer);
        } else if (bun.strings.eql(value, "-")) {
            return writer.writeAll("\\-");
        } else {
            var slice = value;
            if (slice[0] == '-') {
                try writer.writeAll("-");
                slice = slice[1..];
            }
            if (slice.len > 0 and slice[0] >= '0' and slice[0] <= '9') {
                try hexEscape(slice[0], writer);
                slice = slice[1..];
            }
            return serializeName(slice, writer);
        }
    }

    pub fn serializeUnquotedUrl(value: []const u8, writer: anytype) !void {
        var chunk_start: usize = 0;
        for (value, 0..) |b, i| {
            const hex = switch (b) {
                0...' ', 0x7F => true,
                '(', ')', '"', '\'', '\\' => false,
                else => continue,
            };
            try writer.writeAll(value[chunk_start..i]);
            if (hex) {
                try hexEscape(b, writer);
            } else {
                try charEscape(b, writer);
            }
            chunk_start = i + 1;
        }
        return writer.writeAll(value[chunk_start..]);
    }

    // pub fn writeNumeric(value: f32, int_value: ?i32, has_sign: bool, writer: anytype) !void {
    //     // `value >= 0` is true for negative 0.
    //     if (has_sign and !std.math.signbit(value)) {
    //         try writer.writeAll("+");
    //     }

    //     if (value == 0.0 and signfns.isSignNegative(value)) {
    //         // Negative zero. Work around #20596.
    //         try writer.writeAll("-0");
    //         if (int_value == null and @mod(value, 1) == 0) {
    //             try writer.writeAll(".0");
    //         }
    //     } else {
    //         var buf: [124]u8 = undefined;
    //         const bytes = bun.fmt.FormatDouble.dtoa(&buf, @floatCast(value));
    //         try writer.writeAll(bytes);
    //     }
    // }

    pub fn writeNumeric(value: f32, int_value: ?i32, has_sign: bool, writer: anytype) !void {
        // `value >= 0` is true for negative 0.
        if (has_sign and !std.math.signbit(value)) {
            try writer.writeAll("+");
        }

        const notation: Notation = if (value == 0.0 and std.math.signbit(value)) notation: {
            // Negative zero. Work around #20596.
            try writer.writeAll("-0");
            break :notation Notation{
                .decimal_point = false,
                .scientific = false,
            };
        } else notation: {
            var buf: [129]u8 = undefined;
            // We must pass finite numbers to dtoa_short
            if (std.math.isPositiveInf(value)) {
                const output = "1e999";
                try writer.writeAll(output);
                return;
            } else if (std.math.isNegativeInf(value)) {
                const output = "-1e999";
                try writer.writeAll(output);
                return;
            }
            // We shouldn't receive NaN here.
            // NaN is not a valid CSS token and any inlined calculations from `calc()` we ensure
            // are not NaN.
            bun.debugAssert(!std.math.isNan(value));
            const str, const notation = dtoa_short(&buf, value, 6);
            try writer.writeAll(str);
            break :notation notation;
        };

        if (int_value == null and fract(value) == 0) {
            if (!notation.decimal_point and !notation.scientific) {
                try writer.writeAll(".0");
            }
        }

        return;
    }

    pub fn hexEscape(ascii_byte: u8, writer: anytype) !void {
        const HEX_DIGITS = "0123456789abcdef";
        var bytes: [4]u8 = undefined;
        const slice: []const u8 = if (ascii_byte > 0x0F) slice: {
            const high: usize = @intCast(ascii_byte >> 4);
            const low: usize = @intCast(ascii_byte & 0x0F);
            bytes[0] = '\\';
            bytes[1] = HEX_DIGITS[high];
            bytes[2] = HEX_DIGITS[low];
            bytes[3] = ' ';
            break :slice bytes[0..4];
        } else slice: {
            bytes[0] = '\\';
            bytes[1] = HEX_DIGITS[ascii_byte];
            bytes[2] = ' ';
            break :slice bytes[0..3];
        };
        return writer.writeAll(slice);
    }

    pub fn charEscape(ascii_byte: u8, writer: anytype) !void {
        const bytes = [_]u8{ '\\', ascii_byte };
        return writer.writeAll(&bytes);
    }

    pub fn CssStringWriter(comptime W: type) type {
        return struct {
            inner: W,

            /// Wrap a text writer to create a `CssStringWriter`.
            pub fn new(inner: W) @This() {
                return .{ .inner = inner };
            }

            pub fn writeStr(this: *@This(), str: []const u8) !void {
                var chunk_start: usize = 0;
                for (str, 0..) |b, i| {
                    const escaped = switch (b) {
                        '"' => "\\\"",
                        '\\' => "\\\\",
                        // replacement character
                        0 => bun.strings.encodeUTF8Comptime(0xFFD),
                        0x01...0x1F, 0x7F => null,
                        else => continue,
                    };
                    try this.inner.writeAll(str[chunk_start..i]);
                    if (escaped) |e| {
                        try this.inner.writeAll(e);
                    } else {
                        try serializer.hexEscape(b, this.inner);
                    }
                    chunk_start = i + 1;
                }
                return this.inner.writeAll(str[chunk_start..]);
            }
        };
    }
};

pub inline fn implementDeepClone(comptime T: type, this: *const T, allocator: Allocator) T {
    const tyinfo = @typeInfo(T);

    if (comptime bun.meta.isSimpleCopyType(T)) {
        return this.*;
    }

    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        return switch (result) {
            .array_list => deepClone(result.child, allocator, this),
            .baby_list => @panic("Not implemented."),
            .small_list => this.deepClone(allocator),
        };
    }

    if (comptime T == []const u8) {
        return this.*;
    }

    if (comptime @typeInfo(T) == .Pointer) {
        const TT = std.meta.Child(T);
        return implementEql(TT, this.*);
    }

    return switch (tyinfo) {
        .Struct => {
            var strct: T = undefined;
            inline for (tyinfo.Struct.fields) |field| {
                if (comptime generic.canTransitivelyImplementDeepClone(field.type) and @hasDecl(field.type, "__generateDeepClone")) {
                    @field(strct, field.name) = implementDeepClone(field.type, &field(this, field.name, allocator));
                } else {
                    @field(strct, field.name) = generic.deepClone(field.type, &@field(this, field.name), allocator);
                }
            }
            return strct;
        },
        .Union => {
            inline for (bun.meta.EnumFields(T), tyinfo.Union.fields) |enum_field, union_field| {
                if (@intFromEnum(this.*) == enum_field.value) {
                    if (comptime generic.canTransitivelyImplementDeepClone(union_field.type) and @hasDecl(union_field.type, "__generateDeepClone")) {
                        return @unionInit(T, enum_field.name, implementDeepClone(union_field.type, &@field(this, enum_field.name), allocator));
                    }
                    return @unionInit(T, enum_field.name, generic.deepClone(union_field.type, &@field(this, enum_field.name), allocator));
                }
            }
            unreachable;
        },
        else => @compileError("Unhandled type " ++ @typeName(T)),
    };
}

/// A function to implement `lhs.eql(&rhs)` for the many types in the CSS parser that needs this.
///
/// This is the equivalent of doing `#[derive(PartialEq])` in Rust.
///
/// This function only works on simple types like:
/// - Simple equality types (e.g. integers, floats, strings, enums, etc.)
/// - Types which implement a `.eql(lhs: *const @This(), rhs: *const @This()) bool` function
///
/// Or compound types composed of simple types such as:
/// - Pointers to simple types
/// - Optional simple types
/// - Structs, Arrays, and Unions
pub fn implementEql(comptime T: type, this: *const T, other: *const T) bool {
    const tyinfo = @typeInfo(T);
    if (comptime bun.meta.isSimpleEqlType(T)) {
        return this.* == other.*;
    }
    if (comptime T == []const u8) {
        return bun.strings.eql(this.*, other.*);
    }
    if (comptime @typeInfo(T) == .Pointer) {
        const TT = std.meta.Child(T);
        return implementEql(TT, this.*, other.*);
    }
    if (comptime @typeInfo(T) == .Optional) {
        const TT = std.meta.Child(T);
        if (this.* != null and other.* != null) return implementEql(TT, &this.*.?, &other.*.?);
        return false;
    }
    return switch (tyinfo) {
        .Optional => @compileError("Handled above, this means Zack wrote a bug."),
        .Pointer => @compileError("Handled above, this means Zack wrote a bug."),
        .Array => {
            const Child = std.meta.Child(T);
            if (comptime bun.meta.isSimpleEqlType(Child)) {
                return std.mem.eql(Child, &this.*, &other.*);
            }
            if (this.len != other.len) return false;
            if (comptime generic.canTransitivelyImplementEql(Child) and @hasDecl(Child, "__generateEql")) {
                for (this.*, other.*) |*a, *b| {
                    if (!implementEql(Child, &a, &b)) return false;
                }
            } else {
                for (this.*, other.*) |*a, *b| {
                    if (!generic.eql(Child, a, b)) return false;
                }
            }
            return true;
        },
        .Struct => {
            inline for (tyinfo.Struct.fields) |field| {
                if (!generic.eql(field.type, &@field(this, field.name), &@field(other, field.name))) return false;
            }
            return true;
        },
        .Union => {
            if (tyinfo.Union.tag_type == null) @compileError("Unions must have a tag type");
            if (@intFromEnum(this.*) != @intFromEnum(other.*)) return false;
            const enum_fields = bun.meta.EnumFields(T);
            inline for (enum_fields, std.meta.fields(T)) |enum_field, union_field| {
                if (enum_field.value == @intFromEnum(this.*)) {
                    if (union_field.type != void) {
                        if (comptime generic.canTransitivelyImplementEql(union_field.type) and @hasDecl(union_field.type, "__generateEql")) {
                            return implementEql(union_field.type, &@field(this, enum_field.name), &@field(other, enum_field.name));
                        }
                        return generic.eql(union_field.type, &@field(this, enum_field.name), &@field(other, enum_field.name));
                    } else {
                        return true;
                    }
                }
            }
            unreachable;
        },
        else => @compileError("Unsupported type: " ++ @typeName(T)),
    };
}

pub fn implementHash(comptime T: type, this: *const T, hasher: *std.hash.Wyhash) void {
    const tyinfo = @typeInfo(T);
    if (comptime T == void) return;
    if (comptime bun.meta.isSimpleEqlType(T)) {
        return hasher.update(std.mem.asBytes(&this));
    }
    if (comptime T == []const u8) {
        return hasher.update(this.*);
    }
    if (comptime @typeInfo(T) == .Pointer) {
        @compileError("Invalid type for implementHash(): " ++ @typeName(T));
    }
    if (comptime @typeInfo(T) == .Optional) {
        @compileError("Invalid type for implementHash(): " ++ @typeName(T));
    }
    return switch (tyinfo) {
        .Optional => unreachable,
        .Pointer => unreachable,
        .Array => {
            if (comptime @typeInfo(T) == .Optional) {
                @compileError("Invalid type for implementHash(): " ++ @typeName(T));
            }
        },
        .Struct => {
            inline for (tyinfo.Struct.fields) |field| {
                if (comptime generic.hasHash(field.type)) {
                    generic.hash(field.type, &@field(this, field.name), hasher);
                } else if (@hasDecl(field.type, "__generateHash") and @typeInfo(field.type) == .Struct) {
                    implementHash(field.type, &@field(this, field.name), hasher);
                } else {
                    @compileError("Can't hash these fields: " ++ @typeName(field.type) ++ ". On " ++ @typeName(T));
                }
            }
            return;
        },
        .Union => {
            if (tyinfo.Union.tag_type == null) @compileError("Unions must have a tag type");
            const enum_fields = bun.meta.EnumFields(T);
            inline for (enum_fields, std.meta.fields(T)) |enum_field, union_field| {
                if (enum_field.value == @intFromEnum(this.*)) {
                    const field = union_field;
                    if (comptime generic.hasHash(field.type)) {
                        generic.hash(field.type, &@field(this, field.name), hasher);
                    } else if (@hasDecl(field.type, "__generateHash") and @typeInfo(field.type) == .Struct) {
                        implementHash(field.type, &@field(this, field.name), hasher);
                    } else {
                        @compileError("Can't hash these fields: " ++ @typeName(field.type) ++ ". On " ++ @typeName(T));
                    }
                }
            }
            return;
        },
        else => @compileError("Unsupported type: " ++ @typeName(T)),
    };
}

pub const parse_utility = struct {
    /// Parse a value from a string.
    ///
    /// (This is a convenience wrapper for `parse` and probably should not be overridden.)
    ///
    /// NOTE: `input` should live as long as the returned value. Otherwise, strings in the
    /// returned parsed value will point to undefined memory.
    pub fn parseString(
        allocator: Allocator,
        comptime T: type,
        input: []const u8,
        comptime parse_one: *const fn (*Parser) Result(T),
    ) Result(T) {
        // I hope this is okay
        var import_records = bun.BabyList(bun.ImportRecord){};
        defer import_records.deinitWithAllocator(allocator);
        var i = ParserInput.new(allocator, input);
        var parser = Parser.new(&i, &import_records);
        const result = switch (parse_one(&parser)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (parser.expectExhausted().asErr()) |e| return .{ .err = e };
        return .{ .result = result };
    }
};

pub const to_css = struct {
    /// Serialize `self` in CSS syntax and return a string.
    ///
    /// (This is a convenience wrapper for `to_css` and probably should not be overridden.)
    pub fn string(
        allocator: Allocator,
        comptime T: type,
        this: *const T,
        options: PrinterOptions,
        import_records: ?*const bun.BabyList(ImportRecord),
    ) PrintErr![]const u8 {
        var s = ArrayList(u8){};
        errdefer s.deinit(allocator);
        const writer = s.writer(allocator);
        const W = @TypeOf(writer);
        // PERF: think about how cheap this is to create
        var printer = Printer(W).new(allocator, std.ArrayList(u8).init(allocator), writer, options, import_records);
        defer printer.deinit();
        switch (T) {
            CSSString => try CSSStringFns.toCss(this, W, &printer),
            else => try this.toCss(W, &printer),
        }
        return s.items;
    }

    pub fn fromList(comptime T: type, this: *const ArrayList(T), comptime W: type, dest: *Printer(W)) PrintErr!void {
        const len = this.items.len;
        for (this.items, 0..) |*val, idx| {
            try val.toCss(W, dest);
            if (idx < len - 1) {
                try dest.delim(',', false);
            }
        }
        return;
    }

    pub fn fromBabyList(comptime T: type, this: *const bun.BabyList(T), comptime W: type, dest: *Printer(W)) PrintErr!void {
        const len = this.len;
        for (this.sliceConst(), 0..) |*val, idx| {
            try val.toCss(W, dest);
            if (idx < len - 1) {
                try dest.delim(',', false);
            }
        }
        return;
    }

    pub fn integer(comptime T: type, this: T, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const MAX_LEN = comptime maxDigits(T);
        var buf: [MAX_LEN]u8 = undefined;
        const str = std.fmt.bufPrint(buf[0..], "{d}", .{this}) catch unreachable;
        return dest.writeStr(str);
    }

    pub fn float32(this: f32, writer: anytype) !void {
        var scratch: [64]u8 = undefined;
        // PERF/TODO: Compare this to Rust dtoa-short crate
        const floats = std.fmt.formatFloat(scratch[0..], this, .{
            .mode = .decimal,
        }) catch unreachable;
        return writer.writeAll(floats);
    }

    fn maxDigits(comptime T: type) usize {
        const max_val = std.math.maxInt(T);
        return std.fmt.count("{d}", .{max_val});
    }
};

/// Parse `!important`.
///
/// Typical usage is `input.try_parse(parse_important).is_ok()`
/// at the end of a `DeclarationParser::parse_value` implementation.
pub fn parseImportant(input: *Parser) Result(void) {
    if (input.expectDelim('!').asErr()) |e| return .{ .err = e };
    return switch (input.expectIdentMatching("important")) {
        .result => |v| .{ .result = v },
        .err => |e| .{ .err = e },
    };
}

pub const signfns = struct {
    pub inline fn isSignPositive(x: f32) bool {
        return !isSignNegative(x);
    }
    pub inline fn isSignNegative(x: f32) bool {
        // IEEE754 says: isSignMinus(x) is true if and only if x has negative sign. isSignMinus
        // applies to zeros and NaNs as well.
        // SAFETY: This is just transmuting to get the sign bit, it's fine.
        return @as(u32, @bitCast(x)) & 0x8000_0000 != 0;
    }
    /// Returns a number that represents the sign of `self`.
    ///
    /// - `1.0` if the number is positive, `+0.0` or `INFINITY`
    /// - `-1.0` if the number is negative, `-0.0` or `NEG_INFINITY`
    /// - NaN if the number is NaN
    pub fn signum(x: f32) f32 {
        if (std.math.isNan(x)) return std.math.nan(f32);
        return copysign(1, x);
    }

    pub inline fn signF32(x: f32) f32 {
        if (x == 0.0) return if (isSignNegative(x)) 0.0 else -0.0;
        return signum(x);
    }
};

/// TODO(zack) is this correct
/// Copies the sign of `sign` to `self`, returning a new f32 value
pub inline fn copysign(self: f32, sign: f32) f32 {
    // Convert both floats to their bit representations
    const self_bits = @as(u32, @bitCast(self));
    const sign_bits = @as(u32, @bitCast(sign));

    // Clear the sign bit of self and combine with the sign bit of sign
    const result_bits = (self_bits & 0x7FFFFFFF) | (sign_bits & 0x80000000);

    // Convert the result back to f32
    return @as(f32, @bitCast(result_bits));
}

pub fn deepClone(comptime V: type, allocator: Allocator, list: *const ArrayList(V)) ArrayList(V) {
    var newlist = ArrayList(V).initCapacity(allocator, list.items.len) catch bun.outOfMemory();

    for (list.items) |*item| {
        newlist.appendAssumeCapacity(generic.deepClone(V, item, allocator));
    }

    return newlist;
}

pub fn deepDeinit(comptime V: type, allocator: Allocator, list: *ArrayList(V)) void {
    if (comptime !@hasDecl(V, "deinit")) return;
    for (list.items) |*item| {
        item.deinit(allocator);
    }

    list.deinit(allocator);
}

const Notation = struct {
    decimal_point: bool,
    scientific: bool,

    pub fn integer() Notation {
        return .{
            .decimal_point = false,
            .scientific = false,
        };
    }
};

pub fn dtoa_short(buf: *[129]u8, value: f32, comptime precision: u8) struct { []u8, Notation } {
    buf[0] = '0';
    bun.debugAssert(std.math.isFinite(value));
    const buf_len = bun.fmt.FormatDouble.dtoa(@ptrCast(buf[1..].ptr), @floatCast(value)).len;
    return restrict_prec(buf[0 .. buf_len + 1], precision);
}

fn restrict_prec(buf: []u8, comptime prec: u8) struct { []u8, Notation } {
    const len: u8 = @intCast(buf.len);

    // Put a leading zero to capture any carry.
    // Caller must prepare an empty byte for us;
    bun.debugAssert(buf[0] == '0');
    buf[0] = '0';
    // Remove the sign for now. We will put it back at the end.
    const sign = switch (buf[1]) {
        '+', '-' => brk: {
            const s = buf[1];
            buf[1] = '0';
            break :brk s;
        },
        else => null,
    };

    // Locate dot, exponent, and the first significant digit.
    var _pos_dot: ?u8 = null;
    var pos_exp: ?u8 = null;
    var _prec_start: ?u8 = null;
    for (1..len) |i| {
        if (buf[i] == '.') {
            bun.debugAssert(_pos_dot == null);
            _pos_dot = @intCast(i);
        } else if (buf[i] == 'e') {
            pos_exp = @intCast(i);
            // We don't change exponent part, so stop here.
            break;
        } else if (_prec_start == null and buf[i] != '0') {
            bun.debugAssert(buf[i] >= '1' and buf[i] <= '9');
            _prec_start = @intCast(i);
        }
    }

    const prec_start = if (_prec_start) |i|
        i
    else
        // If there is no non-zero digit at all, it is just zero.
        return .{
            buf[0..1],
            Notation.integer(),
        };

    // Coefficient part ends at 'e' or the length.
    const coeff_end = pos_exp orelse len;
    // Decimal dot is effectively at the end of coefficient part if no
    // dot presents before that.
    const had_pos_dot = _pos_dot != null;
    const pos_dot = _pos_dot orelse coeff_end;
    // Find the end position of the number within the given precision.
    const prec_end: u8 = brk: {
        const end = prec_start + prec;
        break :brk if (pos_dot > prec_start and pos_dot <= end) end + 1 else end;
    };
    var new_coeff_end = coeff_end;
    if (prec_end < coeff_end) {
        // Round to the given precision.
        const next_char = buf[prec_end];
        new_coeff_end = prec_end;
        if (next_char >= '5') {
            var i = prec_end;
            while (i != 0) {
                i -= 1;
                if (buf[i] == '.') {
                    continue;
                }
                if (buf[i] != '9') {
                    buf[i] += 1;
                    new_coeff_end = i + 1;
                    break;
                }
                buf[i] = '0';
            }
        }
    }
    if (new_coeff_end < pos_dot) {
        // If the precision isn't enough to reach the dot, set all digits
        // in-between to zero and keep the number until the dot.
        for (new_coeff_end..pos_dot) |i| {
            buf[i] = '0';
        }
        new_coeff_end = pos_dot;
    } else if (had_pos_dot) {
        // Strip any trailing zeros.
        var i = new_coeff_end;
        while (i != 0) {
            i -= 1;
            if (buf[i] != '0') {
                if (buf[i] == '.') {
                    new_coeff_end = i;
                }
                break;
            }
            new_coeff_end = i;
        }
    }
    // Move exponent part if necessary.
    const real_end = if (pos_exp) |posexp| brk: {
        const exp_len = len - posexp;
        if (new_coeff_end != posexp) {
            for (0..exp_len) |i| {
                buf[new_coeff_end + i] = buf[posexp + i];
            }
        }
        break :brk new_coeff_end + exp_len;
    } else new_coeff_end;
    // Add back the sign and strip the leading zero.
    const result = if (sign) |sgn| brk: {
        if (buf[1] == '0' and buf[2] != '.') {
            buf[1] = sgn;
            break :brk buf[1..real_end];
        }
        bun.debugAssert(buf[0] == '0');
        buf[0] = sgn;
        break :brk buf[0..real_end];
    } else brk: {
        if (buf[0] == '0' and buf[1] != '.') {
            break :brk buf[1..real_end];
        }
        break :brk buf[0..real_end];
    };
    // Generate the notation info.
    const notation = Notation{
        .decimal_point = pos_dot < new_coeff_end,
        .scientific = pos_exp != null,
    };
    return .{ result, notation };
}

pub inline fn fract(val: f32) f32 {
    return val - @trunc(val);
}
