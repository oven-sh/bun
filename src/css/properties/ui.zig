const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Error = css.Error;

const ContainerName = css.css_rules.container.ContainerName;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
const Size2D = css.css_values.size.Size2D;
const DashedIdent = css.css_values.ident.DashedIdent;
const Image = css.css_values.image.Image;
const CssColor = css.css_values.color.CssColor;
const Ratio = css.css_values.ratio.Ratio;
const Length = css.css_values.length.LengthValue;
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const Angle = css.css_values.angle.Angle;
const Url = css.css_values.url.Url;
const Percentage = css.css_values.percentage.Percentage;

const GenericBorder = css.css_properties.border.GenericBorder;
const LineStyle = css.css_properties.border.LineStyle;

/// A value for the [color-scheme](https://drafts.csswg.org/css-color-adjust/#color-scheme-prop) property.
pub const ColorScheme = packed struct(u8) {
    /// Indicates that the element supports a light color scheme.
    light: bool = false,
    /// Indicates that the element supports a dark color scheme.
    dark: bool = false,
    /// Forbids the user agent from overriding the color scheme for the element.
    only: bool = false,
    __unused: u5 = 0,

    pub usingnamespace css.Bitflags(@This());

    const Map = bun.ComptimeEnumMap(enum { normal, only, light, dark });

    pub fn parse(input: *css.Parser) css.Result(ColorScheme) {
        var res = ColorScheme.empty();
        const ident = switch (input.expectIdent()) {
            .result => |ident| ident,
            .err => |e| return .{ .err = e },
        };

        if (Map.get(ident)) |value| switch (value) {
            .normal => return .{ .result = res },
            .only => res.insert(ColorScheme{ .only = true }),
            .light => res.insert(ColorScheme{ .light = true }),
            .dark => res.insert(ColorScheme{ .dark = true }),
        };

        while (input.tryParse(css.Parser.expectIdent, .{}).asValue()) |i| {
            if (Map.get(i)) |value| switch (value) {
                .normal => return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
                .only => {
                    // Only must be at the start or the end, not in the middle
                    if (res.contains(ColorScheme{ .only = true })) {
                        return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
                    }
                    res.insert(ColorScheme{ .only = true });
                    return .{ .result = res };
                },
                .light => res.insert(ColorScheme{ .light = true }),
                .dark => res.insert(ColorScheme{ .dark = true }),
            };
        }

        return .{ .result = res };
    }

    pub fn toCss(this: *const ColorScheme, comptime W: type, dest: *Printer(W)) css.PrintErr!void {
        if (this.isEmpty()) {
            return dest.writeStr("normal");
        }

        if (this.contains(ColorScheme{ .light = true })) {
            try dest.writeStr("light");
            if (this.contains(ColorScheme{ .dark = true })) {
                try dest.writeChar(' ');
            }
        }

        if (this.contains(ColorScheme{ .dark = true })) {
            try dest.writeStr("dark");
        }

        if (this.contains(ColorScheme{ .only = true })) {
            try dest.writeStr(" only");
        }
    }

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [resize](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#resize) property.
pub const Resize = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [cursor](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) property.
pub const Cursor = struct {
    /// A list of cursor images.
    images: SmallList(CursorImage),
    /// A pre-defined cursor.
    keyword: CursorKeyword,
};

/// A [cursor image](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) value, used in the `cursor` property.
///
/// See [Cursor](Cursor).
pub const CursorImage = struct {
    /// A url to the cursor image.
    url: Url,
    /// The location in the image where the mouse pointer appears.
    hotspot: ?[2]CSSNumber,
};

/// A pre-defined [cursor](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) value,
/// used in the `cursor` property.
///
/// See [Cursor](Cursor).
pub const CursorKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [caret-color](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-color) property.
pub const ColorOrAuto = union(enum) {
    /// The `currentColor`, adjusted by the UA to ensure contrast against the background.
    auto,
    /// A color.
    color: CssColor,
};

/// A value for the [caret-shape](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-shape) property.
pub const CaretShape = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [caret](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret) shorthand property.
pub const Caret = @compileError(css.todo_stuff.depth);

/// A value for the [user-select](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#content-selection) property.
pub const UserSelect = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [appearance](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#appearance-switching) property.
pub const Appearance = union(enum) {
    none,
    auto,
    textfield,
    menulist_button,
    button,
    checkbox,
    listbox,
    menulist,
    meter,
    progress_bar,
    push_button,
    radio,
    searchfield,
    slider_horizontal,
    square_button,
    textarea,
    non_standard: []const u8,
};

pub const ColorSchemeHandler = struct {
    pub fn handleProperty(_: *@This(), property: *const css.Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        switch (property.*) {
            .@"color-scheme" => |*color_scheme_| {
                const color_scheme: *const ColorScheme = color_scheme_;
                if (!context.targets.isCompatible(css.compat.Feature.light_dark)) {
                    if (color_scheme.contains(ColorScheme{ .light = true })) {
                        dest.append(
                            context.allocator,
                            defineVar(context.allocator, "--buncss-light", .{ .ident = "initial" }),
                        ) catch bun.outOfMemory();
                        dest.append(
                            context.allocator,
                            defineVar(context.allocator, "--buncss-dark", .{ .whitespace = " " }),
                        ) catch bun.outOfMemory();

                        if (color_scheme.contains(ColorScheme{ .dark = true })) {
                            context.addDarkRule(
                                context.allocator,
                                defineVar(context.allocator, "--buncss-light", .{ .whitespace = " " }),
                            );
                            context.addDarkRule(
                                context.allocator,
                                defineVar(context.allocator, "--buncss-dark", .{ .ident = "initial" }),
                            );
                        }
                    } else if (color_scheme.contains(ColorScheme{ .dark = true })) {
                        dest.append(context.allocator, defineVar(context.allocator, "--buncss-light", .{ .whitespace = " " })) catch bun.outOfMemory();
                        dest.append(context.allocator, defineVar(context.allocator, "--buncss-dark", .{ .ident = "initial" })) catch bun.outOfMemory();
                    }
                }
                dest.append(context.allocator, property.deepClone(context.allocator)) catch bun.outOfMemory();
                return true;
            },
            else => return false,
        }
    }

    pub fn finalize(_: *@This(), _: *css.DeclarationList, _: *css.PropertyHandlerContext) void {}
};

fn defineVar(allocator: Allocator, name: []const u8, value: css.Token) css.Property {
    return css.Property{
        .custom = css.css_properties.custom.CustomProperty{
            .name = css.css_properties.custom.CustomPropertyName{ .custom = css.DashedIdent{ .v = name } },
            .value = css.TokenList{
                .v = brk: {
                    var list = ArrayList(css.css_properties.custom.TokenOrValue){};
                    list.append(allocator, css.css_properties.custom.TokenOrValue{ .token = value }) catch bun.outOfMemory();
                    break :brk list;
                },
            },
        },
    };
}
