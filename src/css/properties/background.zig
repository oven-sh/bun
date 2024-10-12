const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

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
const HorizontalPosition = css.css_values.position.HorizontalPosition;
const VerticalPosition = css.css_values.position.VerticalPosition;

const Position = css.css_values.position.Position;

/// A value for the [background](https://www.w3.org/TR/css-backgrounds-3/#background) shorthand property.
pub const Background = struct {
    /// The background image.
    image: Image,
    /// The background color.
    color: CssColor,
    /// The background position.
    position: BackgroundPosition,
    /// How the background image should repeat.
    repeat: BackgroundRepeat,
    /// The size of the background image.
    size: BackgroundSize,
    /// The background attachment.
    attachment: BackgroundAttachment,
    /// The background origin.
    origin: BackgroundOrigin,
    /// How the background should be clipped.
    clip: BackgroundClip,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var color: ?CssColor = null;
        var position: ?BackgroundPosition = null;
        var size: ?BackgroundSize = null;
        var image: ?Image = null;
        var repeat: ?BackgroundRepeat = null;
        var attachment: ?BackgroundAttachment = null;
        var origin: ?BackgroundOrigin = null;
        var clip: ?BackgroundClip = null;

        while (true) {
            // TODO: only allowed on the last background.
            if (color == null) {
                if (input.tryParse(CssColor.parse, .{}).asValue()) |value| {
                    color = value;
                    continue;
                }
            }

            if (position == null) {
                if (input.tryParse(BackgroundPosition.parse, .{}).asValue()) |value| {
                    position = value;

                    size = input.tryParse(struct {
                        fn parse(i: *css.Parser) css.Result(BackgroundSize) {
                            if (i.expectDelim('/').asErr()) |e| return .{ .err = e };
                            return BackgroundSize.parse(i);
                        }
                    }.parse, .{}).asValue();

                    continue;
                }
            }

            if (image == null) {
                if (input.tryParse(Image.parse, .{}).asValue()) |value| {
                    image = value;
                    continue;
                }
            }

            if (repeat == null) {
                if (input.tryParse(BackgroundRepeat.parse, .{}).asValue()) |value| {
                    repeat = value;
                    continue;
                }
            }

            if (attachment == null) {
                if (input.tryParse(BackgroundAttachment.parse, .{}).asValue()) |value| {
                    attachment = value;
                    continue;
                }
            }

            if (origin == null) {
                if (input.tryParse(BackgroundOrigin.parse, .{}).asValue()) |value| {
                    origin = value;
                    continue;
                }
            }

            if (clip == null) {
                if (input.tryParse(BackgroundClip.parse, .{}).asValue()) |value| {
                    clip = value;
                    continue;
                }
            }

            break;
        }

        if (clip == null) {
            if (origin) |o| {
                clip = @as(BackgroundClip, @enumFromInt(@intFromEnum(o)));
            }
        }

        return .{ .result = .{
            .image = image orelse Image.default(),
            .color = color orelse CssColor.default(),
            .position = position orelse BackgroundPosition.default(),
            .repeat = repeat orelse BackgroundRepeat.default(),
            .size = size orelse BackgroundSize.default(),
            .attachment = attachment orelse BackgroundAttachment.default(),
            .origin = origin orelse .@"padding-box",
            .clip = clip orelse .@"border-box",
        } };
    }

    pub fn toCss(this: *const Background, comptime W: type, dest: *Printer(W)) PrintErr!void {
        var has_output = false;

        if (!this.color.eql(&CssColor.default())) {
            try this.color.toCss(W, dest);
            has_output = true;
        }

        if (!this.image.eql(&Image.default())) {
            if (has_output) try dest.writeStr(" ");
            try this.image.toCss(W, dest);
            has_output = true;
        }

        const position: Position = this.position.intoPosition();
        if (!position.isZero() or !this.size.eql(&BackgroundSize.default())) {
            if (has_output) {
                try dest.writeStr(" ");
            }
            try position.toCss(W, dest);

            if (!this.size.eql(&BackgroundSize.default())) {
                try dest.delim('/', true);
                try this.size.toCss(W, dest);
            }

            has_output = true;
        }

        if (!this.repeat.eql(&BackgroundRepeat.default())) {
            if (has_output) try dest.writeStr(" ");
            try this.repeat.toCss(W, dest);
            has_output = true;
        }

        if (!this.attachment.eql(&BackgroundAttachment.default())) {
            if (has_output) try dest.writeStr(" ");
            try this.attachment.toCss(W, dest);
            has_output = true;
        }

        const output_padding_box = !this.origin.eql(&BackgroundOrigin.@"padding-box") or
            (!this.clip.eqlOrigin(&BackgroundOrigin.@"border-box") and this.clip.isBackgroundBox());

        if (output_padding_box) {
            if (has_output) try dest.writeStr(" ");
            try this.origin.toCss(W, dest);
            has_output = true;
        }

        if ((output_padding_box and !this.clip.eqlOrigin(&BackgroundOrigin.@"border-box")) or
            !this.clip.eqlOrigin(&BackgroundOrigin.@"border-box"))
        {
            if (has_output) try dest.writeStr(" ");

            try this.clip.toCss(W, dest);
            has_output = true;
        }

        // If nothing was output, then this is the initial value, e.g. background: transparent
        if (!has_output) {
            if (dest.minify) {
                // `0 0` is the shortest valid background value
                try this.position.toCss(W, dest);
            } else {
                try dest.writeStr("none");
            }
        }
    }

    pub inline fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [background-size](https://www.w3.org/TR/css-backgrounds-3/#background-size) property.
pub const BackgroundSize = union(enum) {
    /// An explicit background size.
    explicit: struct {
        /// The width of the background.
        width: css.css_values.length.LengthPercentageOrAuto,
        /// The height of the background.
        height: css.css_values.length.LengthPercentageOrAuto,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub inline fn deepClone(this: *const @This(), allocator: Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// The `cover` keyword. Scales the background image to cover both the width and height of the element.
    cover,
    /// The `contain` keyword. Scales the background image so that it fits within the element.
    contain,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(LengthPercentageOrAuto.parse, .{}).asValue()) |width| {
            const height = input.tryParse(LengthPercentageOrAuto.parse, .{}).unwrapOr(.auto);
            return .{ .result = .{ .explicit = .{ .width = width, .height = height } } };
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "cover")) {
            return .{ .result = .cover };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "contain")) {
            return .{ .result = .contain };
        } else {
            return .{ .err = location.newBasicUnexpectedTokenError(.{ .ident = ident }) };
        }
    }

    pub fn toCss(this: *const BackgroundSize, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return switch (this.*) {
            .cover => dest.writeStr("cover"),
            .contain => dest.writeStr("contain"),
            .explicit => |explicit| {
                try explicit.width.toCss(W, dest);
                if (explicit.height != .auto) {
                    try dest.writeStr(" ");
                    try explicit.height.toCss(W, dest);
                }
                return;
            },
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn default() @This() {
        return BackgroundSize{ .explicit = .{
            .width = .auto,
            .height = .auto,
        } };
    }

    pub inline fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [background-position](https://drafts.csswg.org/css-backgrounds/#background-position) shorthand property.
pub const BackgroundPosition = struct {
    /// The x-position.
    x: HorizontalPosition,
    /// The y-position.
    y: VerticalPosition,

    pub usingnamespace css.DefineListShorthand(@This());

    const PropertyFieldMap = .{
        .x = css.PropertyIdTag.@"background-position-x",
        .y = css.PropertyIdTag.@"background-position-y",
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const pos = switch (css.css_values.position.Position.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = BackgroundPosition.fromPosition(pos) };
    }

    pub fn toCss(this: *const BackgroundPosition, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const pos = this.intoPosition();
        return pos.toCss(W, dest);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn default() @This() {
        return BackgroundPosition.fromPosition(Position.default());
    }

    pub fn fromPosition(pos: Position) BackgroundPosition {
        return BackgroundPosition{ .x = pos.x, .y = pos.y };
    }

    pub fn intoPosition(this: *const BackgroundPosition) Position {
        return Position{ .x = this.x, .y = this.y };
    }

    pub inline fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [background-repeat](https://www.w3.org/TR/css-backgrounds-3/#background-repeat) property.
pub const BackgroundRepeat = struct {
    /// A repeat style for the x direction.
    x: BackgroundRepeatKeyword,
    /// A repeat style for the y direction.
    y: BackgroundRepeatKeyword,

    pub fn default() @This() {
        return BackgroundRepeat{
            .x = .repeat,
            .y = .repeat,
        };
    }

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const state = input.state();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "repeat-x")) {
            return .{ .result = .{ .x = .repeat, .y = .@"no-repeat" } };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "repeat-y")) {
            return .{ .result = .{ .x = .@"no-repeat", .y = .repeat } };
        }

        input.reset(&state);

        const x = switch (BackgroundRepeatKeyword.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        const y = input.tryParse(BackgroundRepeatKeyword.parse, .{}).unwrapOrNoOptmizations(x);

        return .{ .result = .{ .x = x, .y = y } };
    }

    pub fn toCss(this: *const BackgroundRepeat, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const Repeat = BackgroundRepeatKeyword.repeat;
        const NoRepeat = BackgroundRepeatKeyword.@"no-repeat";

        if (this.x == Repeat and this.y == NoRepeat) {
            return dest.writeStr("repeat-x");
        } else if (this.x == NoRepeat and this.y == Repeat) {
            return dest.writeStr("repeat-y");
        } else {
            try this.x.toCss(W, dest);
            if (this.y != this.x) {
                try dest.writeStr(" ");
                try this.y.toCss(W, dest);
            }
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A [`<repeat-style>`](https://www.w3.org/TR/css-backgrounds-3/#typedef-repeat-style) value,
/// used within the `background-repeat` property to represent how a background image is repeated
/// in a single direction.
///
/// See [BackgroundRepeat](BackgroundRepeat).
pub const BackgroundRepeatKeyword = enum {
    /// The image is repeated in this direction.
    repeat,
    /// The image is repeated so that it fits, and then spaced apart evenly.
    space,
    /// The image is scaled so that it repeats an even number of times.
    round,
    /// The image is placed once and not repeated in this direction.
    @"no-repeat",

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [background-attachment](https://www.w3.org/TR/css-backgrounds-3/#background-attachment) property.
pub const BackgroundAttachment = enum {
    /// The background scrolls with the container.
    scroll,
    /// The background is fixed to the viewport.
    fixed,
    /// The background is fixed with regard to the element's contents.
    local,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() @This() {
        return .scroll;
    }
};

/// A value for the [background-origin](https://www.w3.org/TR/css-backgrounds-3/#background-origin) property.
pub const BackgroundOrigin = enum {
    /// The position is relative to the border box.
    @"border-box",
    /// The position is relative to the padding box.
    @"padding-box",
    /// The position is relative to the content box.
    @"content-box",

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [background-clip](https://drafts.csswg.org/css-backgrounds-4/#background-clip) property.
pub const BackgroundClip = enum {
    /// The background is clipped to the border box.
    @"border-box",
    /// The background is clipped to the padding box.
    @"padding-box",
    /// The background is clipped to the content box.
    @"content-box",
    /// The background is clipped to the area painted by the border.
    border,
    /// The background is clipped to the text content of the element.
    text,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn eqlOrigin(this: *const @This(), other: *const BackgroundOrigin) bool {
        return switch (this.*) {
            .@"border-box" => other.* == .@"border-box",
            .@"padding-box" => other.* == .@"padding-box",
            .@"content-box" => other.* == .@"content-box",
            else => false,
        };
    }

    pub fn isBackgroundBox(this: *const @This()) bool {
        return switch (this.*) {
            .@"border-box", .@"padding-box", .@"content-box" => true,
            else => false,
        };
    }
};

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
pub const AspectRatio = struct {
    /// The `auto` keyword.
    auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    ratio: ?Ratio,
};
