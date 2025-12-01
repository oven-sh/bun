const Position = position.Position;

pub const CustomPropertyName = @import("./custom.zig").CustomPropertyName;

pub const @"align" = @import("./align.zig");
pub const animation = @import("./animation.zig");
pub const background = @import("./background.zig");
pub const border = @import("./border.zig");
pub const border_image = @import("./border_image.zig");
pub const border_radius = @import("./border_radius.zig");
pub const box_shadow = @import("./box_shadow.zig");
pub const contain = @import("./contain.zig");
pub const css_modules = @import("./css_modules.zig");
pub const custom = @import("./custom.zig");
pub const display = @import("./display.zig");
pub const effects = @import("./effects.zig");
pub const flex = @import("./flex.zig");
pub const font = @import("./font.zig");
pub const grid = @import("./grid.zig");
pub const list = @import("./list.zig");
pub const margin_padding = @import("./margin_padding.zig");
pub const masking = @import("./masking.zig");
pub const outline = @import("./outline.zig");
pub const overflow = @import("./overflow.zig");
pub const position = @import("./position.zig");
pub const prefix_handler = @import("./prefix_handler.zig");
pub const shape = @import("./shape.zig");
pub const size = @import("./size.zig");
pub const svg = @import("./svg.zig");
pub const text = @import("./text.zig");
pub const transform = @import("./transform.zig");
pub const transition = @import("./transition.zig");
pub const ui = @import("./ui.zig");

pub const PropertyId = generated.PropertyId;
pub const Property = generated.Property;
pub const PropertyIdTag = generated.PropertyIdTag;

/// A [CSS-wide keyword](https://drafts.csswg.org/css-cascade-5/#defaulting-keywords).
pub const CSSWideKeyword = enum {
    /// The property's initial value.
    initial,
    /// The property's computed value on the parent element.
    inherit,
    /// Either inherit or initial depending on whether the property is inherited.
    unset,
    /// Rolls back the cascade to the cascaded value of the earlier origin.
    revert,
    /// Rolls back the cascade to the value of the previous cascade layer.
    @"revert-layer",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

// pub fn DefineProperties(comptime properties: anytype) type {
//     const input_fields: []const std.builtin.Type.StructField = std.meta.fields(@TypeOf(properties));
//     const total_fields_len = input_fields.len + 2; // +2 for the custom property and the `all` property
//     const TagSize = u16;
//     const PropertyIdT, const max_enum_name_length: usize = brk: {
//         var max: usize = 0;
//         var property_id_type = std.builtin.Type.Enum{
//             .tag_type = TagSize,
//             .is_exhaustive = true,
//             .decls = &.{},
//             .fields = undefined,
//         };
//         var enum_fields: [total_fields_len]std.builtin.Type.EnumField = undefined;
//         for (input_fields, 0..) |field, i| {
//             enum_fields[i] = .{
//                 .name = field.name,
//                 .value = i,
//             };
//             max = @max(max, field.name.len);
//         }
//         enum_fields[input_fields.len] = std.builtin.Type.EnumField{
//             .name = "all",
//             .value = input_fields.len,
//             //         };
//             //         enum_fields[input_fields.len + 1] = std.builtin.Type.EnumField{
//             .name = "custom",
//             .value = input_fields.len + 1,
//         };
//         property_id_type.fields = &enum_fields;
//         break :brk .{ property_id_type, max };
//     };

//     const types: []const type = types: {
//         var types: [total_fields_len]type = undefined;
//         inline for (input_fields, 0..) |field, i| {
//             types[i] = @field(properties, field.name).ty;

//             if (std.mem.eql(u8, field.name, "transition-property")) {
//                 types[i] = struct { SmallList(PropertyIdT, 1), css.VendorPrefix };
//             }

//             // Validate it

//             const value = @field(properties, field.name);
//             const ValueT = @TypeOf(value);
//             const value_ty = value.ty;
//             const ValueTy = @TypeOf(value_ty);
//             const value_ty_info = @typeInfo(ValueTy);
//             // If `valid_prefixes` is defined, the `ty` should be a two item tuple where
//             // the second item is of type `VendorPrefix`
//             if (@hasField(ValueT, "valid_prefixes")) {
//                 if (!value_ty_info.Struct.is_tuple) {
//                     @compileError("Expected a tuple type for `ty` when `valid_prefixes` is defined");
//                 }
//                 if (value_ty_info.Struct.fields[1].type != css.VendorPrefix) {
//                     @compileError("Expected the second item in the tuple to be of type `VendorPrefix`");
//                 }
//             }
//         }
//         types[input_fields.len] = void;
//         types[input_fields.len + 1] = CustomPropertyName;
//         break :types &types;
//     };
//     const PropertyT = PropertyT: {
//         var union_fields: [total_fields_len]std.builtin.Type.UnionField = undefined;
//         inline for (input_fields, 0..) |input_field, i| {
//             const Ty = types[i];
//             union_fields[i] = std.builtin.Type.UnionField{
//                 .alignment = @alignOf(Ty),
//                 .type = type,
//                 .name = input_field.name,
//             };
//         }
//         union_fields[input_fields.len] = std.builtin.Type.UnionField{
//             .alignment = 0,
//             .type = void,
//             .name = "all",
//         };
//         union_fields[input_fields.len + 1] = std.builtin.Type.UnionField{
//             .alignment = @alignOf(CustomPropertyName),
//             .type = CustomPropertyName,
//             .name = "custom",
//         };
//         break :PropertyT std.builtin.Type.Union{
//             .layout = .auto,
//             .tag_type = PropertyIdT,
//             .decls = &.{},
//             .fields = union_fields,
//         };
//     };
//     _ = PropertyT; // autofix
//     return struct {
//         pub const PropertyId = PropertyIdT;

//         pub fn propertyIdEq(lhs: PropertyId, rhs: PropertyId) bool {
//             _ = lhs; // autofix
//             _ = rhs; // autofix
//             @compileError(css.todo_stuff.depth);
//         }

//         pub fn propertyIdIsShorthand(id: PropertyId) bool {
//             inline for (std.meta.fields(PropertyId)) |field| {
//                 if (field.value == @intFromEnum(id)) {
//                     const is_shorthand = if (@hasField(@TypeOf(@field(properties, field.name)), "shorthand"))
//                         @field(@field(properties, field.name), "shorthand")
//                     else
//                         false;
//                     return is_shorthand;
//                 }
//             }
//             return false;
//         }

//         /// PropertyId.prefix()
//         pub fn propertyIdPrefix(id: PropertyId) css.VendorPrefix {
//             _ = id; // autofix
//             @compileError(css.todo_stuff.depth);
//         }

//         /// PropertyId.name()
//         pub fn propertyIdName(id: PropertyId) []const u8 {
//             _ = id; // autofix
//             @compileError(css.todo_stuff.depth);
//         }

//         pub fn propertyIdFromStr(name: []const u8) PropertyId {
//             const prefix, const name_ref = if (bun.strings.startsWithCaseInsensitiveAscii(name, "-webkit-"))
//                 .{ css.VendorPrefix.webkit, name[8..] }
//             else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-moz-"))
//                 .{ css.VendorPrefix.moz, name[5..] }
//             else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-o-"))
//                 .{ css.VendorPrefix.moz, name[3..] }
//             else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-ms-"))
//                 .{ css.VendorPrefix.moz, name[4..] }
//             else
//                 .{ css.VendorPrefix.none, name };

//             return parsePropertyIdFromNameAndPrefix(name_ref, prefix) catch .{
//                 .custom = CustomPropertyName.fromStr(name),
//             };
//         }

//         pub fn parsePropertyIdFromNameAndPrefix(name: []const u8, prefix: css.VendorPrefix) Error!PropertyId {
//             var buffer: [max_enum_name_length]u8 = undefined;
//             if (name.len > buffer.len) {
//                 // TODO: actual source just returns empty Err(())
//                 return Error.InvalidPropertyName;
//             }
//             const lower = bun.strings.copyLowercase(name, buffer[0..name.len]);
//             inline for (std.meta.fields(PropertyIdT)) |field_| {
//                 const field: std.builtin.Type.EnumField = field_;
//                 // skip custom
//                 if (bun.strings.eql(field.name, "custom")) continue;

//                 if (bun.strings.eql(lower, field.name)) {
//                     const prop = @field(properties, field.name);
//                     const allowed_prefixes = allowed_prefixes: {
//                         var prefixes: css.VendorPrefix = if (@hasField(@TypeOf(prop), "unprefixed") and !prop.unprefixed)
//                             css.VendorPrefix{}
//                         else
//                             css.VendorPrefix{ .none = true };

//                         if (@hasField(@TypeOf(prop), "valid_prefixes")) {
//                             prefixes = css.VendorPrefix.bitwiseOr(prefixes, prop.valid_prefixes);
//                         }

//                         break :allowed_prefixes prefixes;
//                     };

//                     if (allowed_prefixes.contains(prefix)) return @enumFromInt(field.value);
//                 }
//             }
//             return Error.InvalidPropertyName;
//         }
//     };
// }

// /// SmallList(PropertyId)
// const SmallListPropertyIdPlaceholder = struct {};

// pub const Property = DefineProperties(.{
//     .@"background-color" = .{
//         .ty = CssColor,
//     },
//     .@"background-image" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(Image, 1),
//     },
//     .@"background-position-x" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(css_values.position.HorizontalPosition, 1),
//     },
//     .@"background-position-y" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(css_values.position.HorizontalPosition, 1),
//     },
//     .@"background-position" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(background.BackgroundPosition, 1),
//         .shorthand = true,
//     },
//     .@"background-size" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(background.BackgroundSize, 1),
//     },
//     .@"background-repeat" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(background.BackgroundSize, 1),
//     },
//     .@"background-attachment" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(background.BackgroundAttachment, 1),
//     },
//     .@"background-clip" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = struct {
//             SmallList(background.BackgroundAttachment, 1),
//             css.VendorPrefix,
//         },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"background-origin" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(background.BackgroundOrigin, 1),
//     },
//     .background = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = SmallList(background.Background, 1),
//     },

//     .@"box-shadow" = .{
//         // PERF: make this equivalent to SmallVec<[_; 1]>
//         .ty = struct { SmallList(box_shadow.BoxShadow, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .opacity = .{
//         .ty = css.css_values.alpha.AlphaValue,
//     },
//     .color = .{
//         .ty = CssColor,
//     },
//     .display = .{
//         .ty = display.Display,
//     },
//     .visibility = .{
//         .ty = display.Visibility,
//     },

//     .width = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.physical },
//     },
//     .height = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.physical },
//     },
//     .@"min-width" = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.physical },
//     },
//     .@"min-height" = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.physical },
//     },
//     .@"max-width" = .{
//         .ty = size.MaxSize,
//         .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.physical },
//     },
//     .@"max-height" = .{
//         .ty = size.MaxSize,
//         .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.physical },
//     },
//     .@"block-size" = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.logical },
//     },
//     .@"inline-size" = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.logical },
//     },
//     .min_block_size = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.logical },
//     },
//     .@"min-inline-size" = .{
//         .ty = size.Size,
//         .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.logical },
//     },
//     .@"max-block-size" = .{
//         .ty = size.MaxSize,
//         .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.logical },
//     },
//     .@"max-inline-size" = .{
//         .ty = size.MaxSize,
//         .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.logical },
//     },
//     .@"box-sizing" = .{
//         .ty = struct { size.BoxSizing, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"aspect-ratio" = .{
//         .ty = size.AspectRatio,
//     },

//     .overflow = .{
//         .ty = overflow.Overflow,
//         .shorthand = true,
//     },
//     .@"overflow-x" = .{
//         .ty = overflow.OverflowKeyword,
//     },
//     .@"overflow-y" = .{
//         .ty = overflow.OverflowKeyword,
//     },
//     .@"text-overflow" = .{
//         .ty = struct { overflow.TextOverflow, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .o = true,
//         },
//     },

//     // https://www.w3.org/TR/2020/WD-css-position-3-20200519
//     .position = .{
//         .ty = position.Position,
//     },
//     .top = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
//     },
//     .bottom = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
//     },
//     .left = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
//     },
//     .right = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
//     },
//     .@"inset-block-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
//     },
//     .@"inset-block-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
//     },
//     .@"inset-inline-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
//     },
//     .@"inset-inline-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
//     },
//     .@"inset-block" = .{
//         .ty = margin_padding.InsetBlock,
//         .shorthand = true,
//     },
//     .@"inset-inline" = .{
//         .ty = margin_padding.InsetInline,
//         .shorthand = true,
//     },
//     .inset = .{
//         .ty = margin_padding.Inset,
//         .shorthand = true,
//     },

//     .@"border-spacing" = .{
//         .ty = css.css_values.size.Size(Length),
//     },

//     .@"border-top-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
//     },
//     .@"border-bottom-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
//     },
//     .@"border-left-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
//     },
//     .@"border-right-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
//     },
//     .@"border-block-start-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
//     },
//     .@"border-block-end-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
//     },
//     .@"border-inline-start-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
//     },
//     .@"border-inline-end-color" = .{
//         .ty = CssColor,
//         .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
//     },

//     .@"border-top-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
//     },
//     .@"border-bottom-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
//     },
//     .@"border-left-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
//     },
//     .@"border-right-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
//     },
//     .@"border-block-start-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
//     },
//     .@"border-block-end-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
//     },
//     .@"border-inline-start-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
//     },
//     .@"border-inline-end-style" = .{
//         .ty = border.LineStyle,
//         .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
//     },

//     .@"border-top-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
//     },
//     .@"border-bottom-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
//     },
//     .@"border-left-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
//     },
//     .@"border-right-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
//     },
//     .@"border-block-start-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
//     },
//     .@"border-block-end-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
//     },
//     .@"border-inline-start-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
//     },
//     .@"border-inline-end-width" = .{
//         .ty = BorderSideWidth,
//         .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
//     },

//     .@"border-top-left-radius" = .{
//         .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
//     },
//     .@"border-top-right-radius" = .{
//         .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
//     },
//     .@"border-bottom-left-radius" = .{
//         .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
//     },
//     .@"border-bottom-right-radius" = .{
//         .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
//     },
//     .@"border-start-start-radius" = .{
//         .ty = Size2D(LengthPercentage),
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
//     },
//     .@"border-start-end-radius" = .{
//         .ty = Size2D(LengthPercentage),
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
//     },
//     .@"border-end-start-radius" = .{
//         .ty = Size2D(LengthPercentage),
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
//     },
//     .@"border-end-end-radius" = .{
//         .ty = Size2D(LengthPercentage),
//         .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
//     },
//     .@"border-radius" = .{
//         .ty = struct { BorderRadius, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .shorthand = true,
//     },

//     .@"border-image-source" = .{
//         .ty = Image,
//     },
//     .@"border-image-outset" = .{
//         .ty = Rect(LengthOrNumber),
//     },
//     .@"border-image-repeat" = .{
//         .ty = BorderImageRepeat,
//     },
//     .@"border-image-width" = .{
//         .ty = Rect(BorderImageSideWidth),
//     },
//     .@"border-image-slice" = .{
//         .ty = BorderImageSlice,
//     },
//     .@"border-image" = .{
//         .ty = struct { BorderImage, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//         .shorthand = true,
//     },

//     .@"border-color" = .{
//         .ty = BorderColor,
//         .shorthand = true,
//     },
//     .@"border-style" = .{
//         .ty = BorderStyle,
//         .shorthand = true,
//     },
//     .@"border-width" = .{
//         .ty = BorderWidth,
//         .shorthand = true,
//     },

//     .@"border-block-color" = .{
//         .ty = BorderBlockColor,
//         .shorthand = true,
//     },
//     .@"border-block-style" = .{
//         .ty = BorderBlockStyle,
//         .shorthand = true,
//     },
//     .@"border-block-width" = .{
//         .ty = BorderBlockWidth,
//         .shorthand = true,
//     },

//     .@"border-inline-color" = .{
//         .ty = BorderInlineColor,
//         .shorthand = true,
//     },
//     .@"border-inline-style" = .{
//         .ty = BorderInlineStyle,
//         .shorthand = true,
//     },
//     .@"border-inline-width" = .{
//         .ty = BorderInlineWidth,
//         .shorthand = true,
//     },

//     .border = .{
//         .ty = Border,
//         .shorthand = true,
//     },
//     .@"border-top" = .{
//         .ty = BorderTop,
//         .shorthand = true,
//     },
//     .@"border-bottom" = .{
//         .ty = BorderBottom,
//         .shorthand = true,
//     },
//     .@"border-left" = .{
//         .ty = BorderLeft,
//         .shorthand = true,
//     },
//     .@"border-right" = .{
//         .ty = BorderRight,
//         .shorthand = true,
//     },
//     .@"border-block" = .{
//         .ty = BorderBlock,
//         .shorthand = true,
//     },
//     .@"border-block-start" = .{
//         .ty = BorderBlockStart,
//         .shorthand = true,
//     },
//     .@"border-block-end" = .{
//         .ty = BorderBlockEnd,
//         .shorthand = true,
//     },
//     .@"border-inline" = .{
//         .ty = BorderInline,
//         .shorthand = true,
//     },
//     .@"border-inline-start" = .{
//         .ty = BorderInlineStart,
//         .shorthand = true,
//     },
//     .@"border-inline-end" = .{
//         .ty = BorderInlineEnd,
//         .shorthand = true,
//     },

//     .outline = .{
//         .ty = Outline,
//         .shorthand = true,
//     },
//     .@"outline-color" = .{
//         .ty = CssColor,
//     },
//     .@"outline-style" = .{
//         .ty = OutlineStyle,
//     },
//     .@"outline-width" = .{
//         .ty = BorderSideWidth,
//     },

//     // Flex properties: https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119
//     .@"flex-direction" = .{
//         .ty = struct { FlexDirection, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .ms = true,
//         },
//     },
//     .@"flex-wrap" = .{
//         .ty = struct { FlexWrap, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .ms = true,
//         },
//     },
//     .@"flex-flow" = .{
//         .ty = struct { FlexFlow, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .ms = true,
//         },
//         .shorthand = true,
//     },
//     .@"flex-grow" = .{
//         .ty = struct { CSSNumber, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"flex-shrink" = .{
//         .ty = struct { CSSNumber, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"flex-basis" = .{
//         .ty = struct { LengthPercentageOrAuto, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .flex = .{
//         .ty = struct { Flex, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .ms = true,
//         },
//         .shorthand = true,
//     },
//     .order = .{
//         .ty = struct { CSSInteger, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },

//     // Align properties: https://www.w3.org/TR/2020/WD-css-align-3-20200421
//     .@"align-content" = .{
//         .ty = struct { AlignContent, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"justify-content" = .{
//         .ty = struct { JustifyContent, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"place-content" = .{
//         .ty = PlaceContent,
//         .shorthand = true,
//     },
//     .@"align-self" = .{
//         .ty = struct { AlignSelf, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"justify-self" = .{
//         .ty = JustifySelf,
//     },
//     .@"place-self" = .{
//         .ty = PlaceSelf,
//         .shorthand = true,
//     },
//     .@"align-items" = .{
//         .ty = struct { AlignItems, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"justify-items" = .{
//         .ty = JustifyItems,
//     },
//     .@"place-items" = .{
//         .ty = PlaceItems,
//         .shorthand = true,
//     },
//     .@"row-gap" = .{
//         .ty = GapValue,
//     },
//     .@"column-gap" = .{
//         .ty = GapValue,
//     },
//     .gap = .{
//         .ty = Gap,
//         .shorthand = true,
//     },

//     // Old flex (2009): https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/
//     .@"box-orient" = .{
//         .ty = struct { BoxOrient, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-direction" = .{
//         .ty = struct { BoxDirection, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-ordinal-group" = .{
//         .ty = struct { CSSInteger, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-align" = .{
//         .ty = struct { BoxAlign, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-flex" = .{
//         .ty = struct { CSSNumber, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-flex-group" = .{
//         .ty = struct { CSSInteger, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-pack" = .{
//         .ty = struct { BoxPack, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },
//     .@"box-lines" = .{
//         .ty = struct { BoxLines, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .unprefixed = false,
//     },

//     // Old flex (2012): https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/
//     .@"flex-pack" = .{
//         .ty = struct { FlexPack, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },
//     .@"flex-order" = .{
//         .ty = struct { CSSInteger, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },
//     .@"flex-align" = .{
//         .ty = struct { BoxAlign, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },
//     .@"flex-item-align" = .{
//         .ty = struct { FlexItemAlign, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },
//     .@"flex-line-pack" = .{
//         .ty = struct { FlexLinePack, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },

//     // Microsoft extensions
//     .@"flex-positive" = .{
//         .ty = struct { CSSNumber, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },
//     .@"flex-negative" = .{
//         .ty = struct { CSSNumber, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },
//     .@"flex-preferred-size" = .{
//         .ty = struct { LengthPercentageOrAuto, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .ms = true,
//         },
//         .unprefixed = false,
//     },

//     // TODO: the following is enabled with #[cfg(feature = "grid")]
//     // .@"grid-template-columns" = .{
//     //     .ty = TrackSizing,
//     // },
//     // .@"grid-template-rows" = .{
//     //     .ty = TrackSizing,
//     // },
//     // .@"grid-auto-columns" = .{
//     //     .ty = TrackSizeList,
//     // },
//     // .@"grid-auto-rows" = .{
//     //     .ty = TrackSizeList,
//     // },
//     // .@"grid-auto-flow" = .{
//     //     .ty = GridAutoFlow,
//     // },
//     // .@"grid-template-areas" = .{
//     //     .ty = GridTemplateAreas,
//     // },
//     // .@"grid-template" = .{
//     //     .ty = GridTemplate,
//     //     .shorthand = true,
//     // },
//     // .grid = .{
//     //     .ty = Grid,
//     //     .shorthand = true,
//     // },
//     // .@"grid-row-start" = .{
//     //     .ty = GridLine,
//     // },
//     // .@"grid-row-end" = .{
//     //     .ty = GridLine,
//     // },
//     // .@"grid-column-start" = .{
//     //     .ty = GridLine,
//     // },
//     // .@"grid-column-end" = .{
//     //     .ty = GridLine,
//     // },
//     // .@"grid-row" = .{
//     //     .ty = GridRow,
//     //     .shorthand = true,
//     // },
//     // .@"grid-column" = .{
//     //     .ty = GridColumn,
//     //     .shorthand = true,
//     // },
//     // .@"grid-area" = .{
//     //     .ty = GridArea,
//     //     .shorthand = true,
//     // },

//     .@"margin-top" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
//     },
//     .@"margin-bottom" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
//     },
//     .@"margin-left" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
//     },
//     .@"margin-right" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
//     },
//     .@"margin-block-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
//     },
//     .@"margin-block-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
//     },
//     .@"margin-inline-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
//     },
//     .@"margin-inline-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
//     },
//     .@"margin-block" = .{
//         .ty = MarginBlock,
//         .shorthand = true,
//     },
//     .@"margin-inline" = .{
//         .ty = MarginInline,
//         .shorthand = true,
//     },
//     .margin = .{
//         .ty = Margin,
//         .shorthand = true,
//     },

//     .@"padding-top" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
//     },
//     .@"padding-bottom" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
//     },
//     .@"padding-left" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
//     },
//     .@"padding-right" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
//     },
//     .@"padding-block-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
//     },
//     .@"padding-block-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
//     },
//     .@"padding-inline-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
//     },
//     .@"padding-inline-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
//     },
//     .@"padding-block" = .{
//         .ty = PaddingBlock,
//         .shorthand = true,
//     },
//     .@"padding-inline" = .{
//         .ty = PaddingInline,
//         .shorthand = true,
//     },
//     .padding = .{
//         .ty = Padding,
//         .shorthand = true,
//     },

//     .@"scroll-margin-top" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
//     },
//     .@"scroll-margin-bottom" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
//     },
//     .@"scroll-margin-left" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
//     },
//     .@"scroll-margin-right" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
//     },
//     .@"scroll-margin-block-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
//     },
//     .@"scroll-margin-block-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
//     },
//     .@"scroll-margin-inline-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
//     },
//     .@"scroll-margin-inline-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
//     },
//     .@"scroll-margin-block" = .{
//         .ty = ScrollMarginBlock,
//         .shorthand = true,
//     },
//     .@"scroll-margin-inline" = .{
//         .ty = ScrollMarginInline,
//         .shorthand = true,
//     },
//     .@"scroll-margin" = .{
//         .ty = ScrollMargin,
//         .shorthand = true,
//     },

//     .@"scroll-padding-top" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
//     },
//     .@"scroll-padding-bottom" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
//     },
//     .@"scroll-padding-left" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
//     },
//     .@"scroll-padding-right" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
//     },
//     .@"scroll-padding-block-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
//     },
//     .@"scroll-padding-block-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
//     },
//     .@"scroll-padding-inline-start" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
//     },
//     .@"scroll-padding-inline-end" = .{
//         .ty = LengthPercentageOrAuto,
//         .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
//     },
//     .@"scroll-padding-block" = .{
//         .ty = ScrollPaddingBlock,
//         .shorthand = true,
//     },
//     .@"scroll-padding-inline" = .{
//         .ty = ScrollPaddingInline,
//         .shorthand = true,
//     },
//     .@"scroll-padding" = .{
//         .ty = ScrollPadding,
//         .shorthand = true,
//     },

//     .@"font-weight" = .{
//         .ty = FontWeight,
//     },
//     .@"font-size" = .{
//         .ty = FontSize,
//     },
//     .@"font-stretch" = .{
//         .ty = FontStretch,
//     },
//     .@"font-family" = .{
//         .ty = ArrayList(FontFamily),
//     },
//     .@"font-style" = .{
//         .ty = FontStyle,
//     },
//     .@"font-variant-caps" = .{
//         .ty = FontVariantCaps,
//     },
//     .@"line-height" = .{
//         .ty = LineHeight,
//     },
//     .font = .{
//         .ty = Font,
//         .shorthand = true,
//     },
//     .@"vertical-align" = .{
//         .ty = VerticalAlign,
//     },
//     .@"font-palette" = .{
//         .ty = DashedIdentReference,
//     },

//     .@"transition-property" = .{
//         .ty = struct { SmallListPropertyIdPlaceholder, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },
//     .@"transition-duration" = .{
//         .ty = struct { SmallList(Time, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },
//     .@"transition-delay" = .{
//         .ty = struct { SmallList(Time, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },
//     .@"transition-timing-function" = .{
//         .ty = struct { SmallList(EasingFunction, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },
//     .transition = .{
//         .ty = struct { SmallList(Transition, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//         .shorthand = true,
//     },

//     .@"animation-name" = .{
//         .ty = struct { AnimationNameList, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-duration" = .{
//         .ty = struct { SmallList(Time, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-timing-function" = .{
//         .ty = struct { SmallList(EasingFunction, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-iteration-count" = .{
//         .ty = struct { SmallList(AnimationIterationCount, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-direction" = .{
//         .ty = struct { SmallList(AnimationDirection, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-play-state" = .{
//         .ty = struct { SmallList(AnimationPlayState, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-delay" = .{
//         .ty = struct { SmallList(Time, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-fill-mode" = .{
//         .ty = struct { SmallList(AnimationFillMode, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"animation-composition" = .{
//         .ty = SmallList(AnimationComposition, 1),
//     },
//     .@"animation-timeline" = .{
//         .ty = SmallList(AnimationTimeline, 1),
//     },
//     .@"animation-range-start" = .{
//         .ty = SmallList(AnimationRangeStart, 1),
//     },
//     .@"animation-range-end" = .{
//         .ty = SmallList(AnimationRangeEnd, 1),
//     },
//     .@"animation-range" = .{
//         .ty = SmallList(AnimationRange, 1),
//     },
//     .animation = .{
//         .ty = struct { AnimationList, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .o = true,
//         },
//         .shorthand = true,
//     },

//     // https://drafts.csswg.org/css-transforms-2/
//     .transform = .{
//         .ty = struct { TransformList, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//             .o = true,
//         },
//     },
//     .@"transform-origin" = .{
//         .ty = struct { Position, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//             .o = true,
//         },
//         // TODO: handle z offset syntax
//     },
//     .@"transform-style" = .{
//         .ty = struct { TransformStyle, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"transform-box" = .{
//         .ty = TransformBox,
//     },
//     .@"backface-visibility" = .{
//         .ty = struct { BackfaceVisibility, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .perspective = .{
//         .ty = struct { Perspective, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"perspective-origin" = .{
//         .ty = struct { Position, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .translate = .{
//         .ty = Translate,
//     },
//     .rotate = .{
//         .ty = Rotate,
//     },
//     .scale = .{
//         .ty = Scale,
//     },

//     // https://www.w3.org/TR/2021/CRD-css-text-3-20210422
//     .@"text-transform" = .{
//         .ty = TextTransform,
//     },
//     .@"white-space" = .{
//         .ty = WhiteSpace,
//     },
//     .@"tab-size" = .{
//         .ty = struct { LengthOrNumber, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .moz = true,
//             .o = true,
//         },
//     },
//     .@"word-break" = .{
//         .ty = WordBreak,
//     },
//     .@"line-break" = .{
//         .ty = LineBreak,
//     },
//     .hyphens = .{
//         .ty = struct { Hyphens, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },
//     .@"overflow-wrap" = .{
//         .ty = OverflowWrap,
//     },
//     .@"word-wrap" = .{
//         .ty = OverflowWrap,
//     },
//     .@"text-align" = .{
//         .ty = TextAlign,
//     },
//     .@"text-align-last" = .{
//         .ty = struct { TextAlignLast, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .moz = true,
//         },
//     },
//     .@"text-justify" = .{
//         .ty = TextJustify,
//     },
//     .@"word-spacing" = .{
//         .ty = Spacing,
//     },
//     .@"letter-spacing" = .{
//         .ty = Spacing,
//     },
//     .@"text-indent" = .{
//         .ty = TextIndent,
//     },

//     // https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506
//     .@"text-decoration-line" = .{
//         .ty = struct { TextDecorationLine, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"text-decoration-style" = .{
//         .ty = struct { TextDecorationStyle, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"text-decoration-color" = .{
//         .ty = struct { CssColor, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//     },
//     .@"text-decoration-thickness" = .{
//         .ty = TextDecorationThickness,
//     },
//     .@"text-decoration" = .{
//         .ty = struct { TextDecoration, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//         },
//         .shorthand = true,
//     },
//     .@"text-decoration-skip-ink" = .{
//         .ty = struct { TextDecorationSkipInk, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"text-emphasis-style" = .{
//         .ty = struct { TextEmphasisStyle, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"text-emphasis-color" = .{
//         .ty = struct { CssColor, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"text-emphasis" = .{
//         .ty = struct { TextEmphasis, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .shorthand = true,
//     },
//     .@"text-emphasis-position" = .{
//         .ty = struct { TextEmphasisPosition, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"text-shadow" = .{
//         .ty = SmallList(TextShadow, 1),
//     },

//     // https://w3c.github.io/csswg-drafts/css-size-adjust/
//     .@"text-size-adjust" = .{
//         .ty = struct { TextSizeAdjust, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },

//     // https://drafts.csswg.org/css-writing-modes-3/
//     .direction = .{
//         .ty = Direction,
//     },
//     .@"unicode-bidi" = .{
//         .ty = UnicodeBidi,
//     },

//     // https://www.w3.org/TR/css-break-3/
//     .@"box-decoration-break" = .{
//         .ty = struct { BoxDecorationBreak, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },

//     // https://www.w3.org/TR/2021/WD-css-ui-4-20210316
//     .resize = .{
//         .ty = Resize,
//     },
//     .cursor = .{
//         .ty = Cursor,
//     },
//     .@"caret-color" = .{
//         .ty = ColorOrAuto,
//     },
//     .@"caret-shape" = .{
//         .ty = CaretShape,
//     },
//     .caret = .{
//         .ty = Caret,
//         .shorthand = true,
//     },
//     .@"user-select" = .{
//         .ty = struct { UserSelect, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },
//     .@"accent-color" = .{
//         .ty = ColorOrAuto,
//     },
//     .appearance = .{
//         .ty = struct { Appearance, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//             .moz = true,
//             .ms = true,
//         },
//     },

//     // https://www.w3.org/TR/2020/WD-css-lists-3-20201117
//     .@"list-style-type" = .{
//         .ty = ListStyleType,
//     },
//     .@"list-style-image" = .{
//         .ty = Image,
//     },
//     .@"list-style-position" = .{
//         .ty = ListStylePosition,
//     },
//     .@"list-style" = .{
//         .ty = ListStyle,
//         .shorthand = true,
//     },
//     .@"marker-side" = .{
//         .ty = MarkerSide,
//     },

//     // CSS modules
//     .composes = .{
//         .ty = Composes,
//         .conditional = .{
//             .css_modules = true,
//         },
//     },

//     // https://www.w3.org/TR/SVG2/painting.html
//     .fill = .{
//         .ty = SVGPaint,
//     },
//     .@"fill-rule" = .{
//         .ty = FillRule,
//     },
//     .@"fill-opacity" = .{
//         .ty = AlphaValue,
//     },
//     .stroke = .{
//         .ty = SVGPaint,
//     },
//     .@"stroke-opacity" = .{
//         .ty = AlphaValue,
//     },
//     .@"stroke-width" = .{
//         .ty = LengthPercentage,
//     },
//     .@"stroke-linecap" = .{
//         .ty = StrokeLinecap,
//     },
//     .@"stroke-linejoin" = .{
//         .ty = StrokeLinejoin,
//     },
//     .@"stroke-miterlimit" = .{
//         .ty = CSSNumber,
//     },
//     .@"stroke-dasharray" = .{
//         .ty = StrokeDasharray,
//     },
//     .@"stroke-dashoffset" = .{
//         .ty = LengthPercentage,
//     },
//     .@"marker-start" = .{
//         .ty = Marker,
//     },
//     .@"marker-mid" = .{
//         .ty = Marker,
//     },
//     .@"marker-end" = .{
//         .ty = Marker,
//     },
//     .marker = .{
//         .ty = Marker,
//     },
//     .@"color-interpolation" = .{
//         .ty = ColorInterpolation,
//     },
//     .@"color-interpolation-filters" = .{
//         .ty = ColorInterpolation,
//     },
//     .@"color-rendering" = .{
//         .ty = ColorRendering,
//     },
//     .@"shape-rendering" = .{
//         .ty = ShapeRendering,
//     },
//     .@"text-rendering" = .{
//         .ty = TextRendering,
//     },
//     .@"image-rendering" = .{
//         .ty = ImageRendering,
//     },

//     // https://www.w3.org/TR/css-masking-1/
//     .@"clip-path" = .{
//         .ty = struct { ClipPath, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"clip-rule" = .{
//         .ty = FillRule,
//     },
//     .@"mask-image" = .{
//         .ty = struct { SmallList(Image, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"mask-mode" = .{
//         .ty = SmallList(MaskMode, 1),
//     },
//     .@"mask-repeat" = .{
//         .ty = struct { SmallList(BackgroundRepeat, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"mask-position-x" = .{
//         .ty = SmallList(HorizontalPosition, 1),
//     },
//     .@"mask-position-y" = .{
//         .ty = SmallList(VerticalPosition, 1),
//     },
//     .@"mask-position" = .{
//         .ty = struct { SmallList(Position, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"mask-clip" = .{
//         .ty = struct { SmallList(MaskClip, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"mask-origin" = .{
//         .ty = struct { SmallList(GeometryBox, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"mask-size" = .{
//         .ty = struct { SmallList(BackgroundSize, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"mask-composite" = .{
//         .ty = SmallList(MaskComposite, 1),
//     },
//     .@"mask-type" = .{
//         .ty = MaskType,
//     },
//     .mask = .{
//         .ty = struct { SmallList(Mask, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .shorthand = true,
//     },
//     .@"mask-border-source" = .{
//         .ty = Image,
//     },
//     .@"mask-border-mode" = .{
//         .ty = MaskBorderMode,
//     },
//     .@"mask-border-slice" = .{
//         .ty = BorderImageSlice,
//     },
//     .@"mask-border-width" = .{
//         .ty = Rect(BorderImageSideWidth),
//     },
//     .@"mask-border-outset" = .{
//         .ty = Rect(LengthOrNumber),
//     },
//     .@"mask-border-repeat" = .{
//         .ty = BorderImageRepeat,
//     },
//     .@"mask-border" = .{
//         .ty = MaskBorder,
//         .shorthand = true,
//     },

//     // WebKit additions
//     .@"-webkit-mask-composite" = .{
//         .ty = SmallList(WebKitMaskComposite, 1),
//     },
//     .@"mask-source-type" = .{
//         .ty = struct { SmallList(WebKitMaskSourceType, 1), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"mask-box-image" = .{
//         .ty = struct { BorderImage, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"mask-box-image-source" = .{
//         .ty = struct { Image, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"mask-box-image-slice" = .{
//         .ty = struct { BorderImageSlice, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"mask-box-image-width" = .{
//         .ty = struct { Rect(BorderImageSideWidth), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"mask-box-image-outset" = .{
//         .ty = struct { Rect(LengthOrNumber), css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },
//     .@"mask-box-image-repeat" = .{
//         .ty = struct { BorderImageRepeat, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//         .unprefixed = false,
//     },

//     // https://drafts.fxtf.org/filter-effects-1/
//     .filter = .{
//         .ty = struct { FilterList, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },
//     .@"backdrop-filter" = .{
//         .ty = struct { FilterList, css.VendorPrefix },
//         .valid_prefixes = css.VendorPrefix{
//             .webkit = true,
//         },
//     },

//     // https://drafts.csswg.org/css2/
//     .@"z-index" = .{
//         .ty = position.ZIndex,
//     },

//     // https://drafts.csswg.org/css-contain-3/
//     .@"container-type" = .{
//         .ty = ContainerType,
//     },
//     .@"container-name" = .{
//         .ty = ContainerNameList,
//     },
//     .container = .{
//         .ty = Container,
//         .shorthand = true,
//     },

//     // https://w3c.github.io/csswg-drafts/css-view-transitions-1/
//     .@"view-transition-name" = .{
//         .ty = CustomIdent,
//     },

//     // https://drafts.csswg.org/css-color-adjust/
//     .@"color-scheme" = .{
//         .ty = ColorScheme,
//     },
// });

const bun = @import("bun");
const generated = @import("./properties_generated.zig");

const css = @import("../css_parser.zig");
const Error = css.Error;
const SmallList = css.SmallList;

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
