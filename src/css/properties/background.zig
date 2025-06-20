const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const Property = css.Property;
const VendorPrefix = css.VendorPrefix;
const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
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

    pub fn deinit(_: *@This(), _: Allocator) void {
        // TODO: implement this
        // not necessary right now because all allocations in CSS parser are in arena
    }

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

    pub fn getImage(this: *const @This()) *const Image {
        return &this.image;
    }

    pub fn withImage(this: *const @This(), allocator: Allocator, image: Image) @This() {
        var ret = this.*;
        ret.image = .none;
        ret = ret.deepClone(allocator);
        ret.image = image;
        return ret;
    }

    pub fn getFallback(this: *const @This(), allocator: Allocator, kind: css.ColorFallbackKind) Background {
        var ret: Background = this.*;
        // Dummy values for the clone
        ret.color = CssColor.default();
        ret.image = Image.default();
        ret = ret.deepClone(allocator);
        ret.color = this.color.getFallback(allocator, kind);
        ret.image = this.image.getFallback(allocator, kind);
        return ret;
    }

    pub fn getNecessaryFallbacks(this: *const @This(), targets: css.targets.Targets) css.ColorFallbackKind {
        return bun.bits.@"or"(
            css.ColorFallbackKind,
            this.color.getNecessaryFallbacks(targets),
            this.getImage().getNecessaryFallbacks(targets),
        );
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

        const y = input.tryParse(BackgroundRepeatKeyword.parse, .{}).unwrapOr(x);

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

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
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

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// A value for the [background-attachment](https://www.w3.org/TR/css-backgrounds-3/#background-attachment) property.
pub const BackgroundAttachment = enum {
    /// The background scrolls with the container.
    scroll,
    /// The background is fixed to the viewport.
    fixed,
    /// The background is fixed with regard to the element's contents.
    local,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

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

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
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

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub fn default() BackgroundClip {
        return .@"border-box";
    }

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

pub const BackgroundProperty = packed struct(u16) {
    color: bool = false,
    image: bool = false,
    @"position-x": bool = false,
    @"position-y": bool = false,
    repeat: bool = false,
    size: bool = false,
    attachment: bool = false,
    origin: bool = false,
    clip: bool = false,
    __unused: u7 = 0,

    pub const @"background-color" = BackgroundProperty{ .color = true };
    pub const @"background-image" = BackgroundProperty{ .image = true };
    pub const @"background-position-x" = BackgroundProperty{ .@"position-x" = true };
    pub const @"background-position-y" = BackgroundProperty{ .@"position-y" = true };
    pub const @"background-position" = BackgroundProperty{ .@"position-x" = true, .@"position-y" = true };
    pub const @"background-repeat" = BackgroundProperty{ .repeat = true };
    pub const @"background-size" = BackgroundProperty{ .size = true };
    pub const @"background-attachment" = BackgroundProperty{ .attachment = true };
    pub const @"background-origin" = BackgroundProperty{ .origin = true };
    pub const @"background-clip" = BackgroundProperty{ .clip = true };

    pub const background = BackgroundProperty{
        .color = true,
        .image = true,
        .@"position-x" = true,
        .@"position-y" = true,
        .repeat = true,
        .size = true,
        .attachment = true,
        .origin = true,
        .clip = true,
    };

    pub fn isEmpty(this: @This()) bool {
        return bun.bits.asInt(@This(), this) == 0;
    }

    pub fn tryFromPropertyId(property_id: css.PropertyId) ?BackgroundProperty {
        return switch (property_id) {
            .@"background-color" => @"background-color",
            .@"background-image" => @"background-image",
            .@"background-position-x" => @"background-position-x",
            .@"background-position-y" => @"background-position-y",
            .@"background-position" => @"background-position",
            .@"background-repeat" => @"background-repeat",
            .@"background-size" => @"background-size",
            .@"background-attachment" => @"background-attachment",
            .@"background-origin" => @"background-origin",
            .background => background,
            else => null,
        };
    }
};

pub const BackgroundHandler = struct {
    color: ?CssColor = null,
    images: ?css.SmallList(Image, 1) = null,
    has_prefix: bool = false,
    x_positions: ?css.SmallList(HorizontalPosition, 1) = null,
    y_positions: ?css.SmallList(VerticalPosition, 1) = null,
    repeats: ?css.SmallList(BackgroundRepeat, 1) = null,
    sizes: ?css.SmallList(BackgroundSize, 1) = null,
    attachments: ?css.SmallList(BackgroundAttachment, 1) = null,
    origins: ?css.SmallList(BackgroundOrigin, 1) = null,
    clips: ?struct { css.SmallList(BackgroundClip, 1), VendorPrefix } = null,
    decls: ArrayList(Property) = undefined,
    flushed_properties: BackgroundProperty = undefined,
    has_any: bool = false,

    pub fn handleProperty(
        this: *BackgroundHandler,
        property: *const Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        const allocator = context.allocator;
        switch (property.*) {
            .@"background-color" => |*val| {
                this.flushHelper(allocator, "color", CssColor, val, dest, context);
                this.color = val.deepClone(allocator);
            },
            .@"background-image" => |*val| {
                this.backgroundHelper(allocator, SmallList(Image, 1), val, property, dest, context);
                this.images = val.deepClone(allocator);
            },
            .@"background-position" => |val| {
                const x_positions = this.initSmallListHelper(HorizontalPosition, 1, "x_positions", allocator, val.len());
                const y_positions = this.initSmallListHelper(VerticalPosition, 1, "y_positions", allocator, val.len());
                for (val.slice(), x_positions, y_positions) |position, *x, *y| {
                    x.* = position.x.deepClone(allocator);
                    y.* = position.y.deepClone(allocator);
                }
            },
            .@"background-position-x" => |val| {
                if (this.x_positions) |*x_positions| x_positions.deinit(allocator);
                this.x_positions = val.deepClone(allocator);
            },
            .@"background-position-y" => |val| {
                if (this.y_positions) |*y_positions| y_positions.deinit(allocator);
                this.y_positions = val.deepClone(allocator);
            },
            .@"background-repeat" => |val| {
                if (this.repeats) |*repeats| repeats.deinit(allocator);
                this.repeats = val.deepClone(allocator);
            },
            .@"background-size" => |val| {
                if (this.sizes) |*sizes| sizes.deinit(allocator);
                this.sizes = val.deepClone(allocator);
            },
            .@"background-attachment" => |val| {
                if (this.attachments) |*attachments| attachments.deinit(allocator);
                this.attachments = val.deepClone(allocator);
            },
            .@"background-origin" => |val| {
                if (this.origins) |*origins| origins.deinit(allocator);
                this.origins = val.deepClone(allocator);
            },
            .@"background-clip" => |*x| {
                const val: *const SmallList(BackgroundClip, 1) = &x.*[0];
                const vendor_prefix: VendorPrefix = x.*[1];
                if (this.clips) |*clips_and_vp| {
                    var clips: *SmallList(BackgroundClip, 1) = &clips_and_vp.*[0];
                    const vp: *VendorPrefix = &clips_and_vp.*[1];
                    if (vendor_prefix != vp.* and !val.eql(clips)) {
                        this.flush(allocator, dest, context);
                        clips.deinit(allocator);
                        this.clips = .{ val.deepClone(allocator), vendor_prefix };
                    } else {
                        if (!val.eql(clips)) {
                            clips.deinit(allocator);
                            clips.* = val.deepClone(allocator);
                        }
                        bun.bits.insert(VendorPrefix, vp, vendor_prefix);
                    }
                } else {
                    this.clips = .{ val.deepClone(allocator), vendor_prefix };
                }
            },
            .background => |*val| {
                var images = SmallList(Image, 1).initCapacity(allocator, val.len());
                for (val.slice()) |*b| {
                    images.appendAssumeCapacity(b.image.deepClone(allocator));
                }
                this.backgroundHelper(allocator, SmallList(Image, 1), &images, property, dest, context);
                const color = val.last().?.color.deepClone(allocator);
                this.flushHelper(allocator, "color", CssColor, &color, dest, context);
                var clips = SmallList(BackgroundClip, 1).initCapacity(allocator, val.len());
                for (val.slice()) |*b| {
                    clips.appendAssumeCapacity(b.clip.deepClone(allocator));
                }
                var clips_vp = VendorPrefix{ .none = true };
                if (this.clips) |*clips_and_vp| {
                    if (clips_vp != clips_and_vp.*[1] and !clips_and_vp.*[0].eql(&clips_and_vp[0])) {
                        this.flush(allocator, dest, context);
                    } else {
                        bun.bits.insert(VendorPrefix, &clips_vp, clips_and_vp.*[1]);
                    }
                }

                if (this.color) |*c| c.deinit(allocator);
                this.color = color;
                if (this.images) |*i| i.deinit(allocator);
                this.images = images;
                const x_positions = this.initSmallListHelper(HorizontalPosition, 1, "x_positions", allocator, val.len());
                const y_positions = this.initSmallListHelper(VerticalPosition, 1, "y_positions", allocator, val.len());
                const repeats = this.initSmallListHelper(BackgroundRepeat, 1, "repeats", allocator, val.len());
                const sizes = this.initSmallListHelper(BackgroundSize, 1, "sizes", allocator, val.len());
                const attachments = this.initSmallListHelper(BackgroundAttachment, 1, "attachments", allocator, val.len());
                const origins = this.initSmallListHelper(BackgroundOrigin, 1, "origins", allocator, val.len());

                for (
                    val.slice(),
                    x_positions,
                    y_positions,
                    repeats,
                    sizes,
                    attachments,
                    origins,
                ) |*b, *x, *y, *r, *s, *a, *o| {
                    x.* = b.position.x.deepClone(allocator);
                    y.* = b.position.y.deepClone(allocator);
                    r.* = b.repeat.deepClone(allocator);
                    s.* = b.size.deepClone(allocator);
                    a.* = b.attachment.deepClone(allocator);
                    o.* = b.origin.deepClone(allocator);
                }

                this.clips = .{ clips, clips_vp };
            },
            .unparsed => |*val| {
                if (isBackgroundProperty(val.property_id)) {
                    this.flush(allocator, dest, context);
                    var unparsed = val.deepClone(allocator);
                    context.addUnparsedFallbacks(&unparsed);
                    if (BackgroundProperty.tryFromPropertyId(val.property_id)) |prop| {
                        bun.bits.insert(BackgroundProperty, &this.flushed_properties, prop);
                    }

                    dest.append(allocator, Property{ .unparsed = unparsed }) catch bun.outOfMemory();
                } else return false;
            },
            else => return false,
        }

        this.has_any = true;
        return true;
    }

    // Either get the value from the field on `this` or initialize a new one
    fn initSmallListHelper(
        this: *@This(),
        comptime T: type,
        comptime N: comptime_int,
        comptime field: []const u8,
        allocator: Allocator,
        length: u32,
    ) []T {
        if (@field(this, field)) |*list| {
            list.clearRetainingCapacity();
            list.ensureTotalCapacity(allocator, length);
            list.setLen(length);
            return list.slice_mut();
        } else {
            @field(this, field) = SmallList(T, N).initCapacity(allocator, length);
            @field(this, field).?.setLen(length);
            return @field(this, field).?.slice_mut();
        }
    }

    fn backgroundHelper(
        this: *@This(),
        allocator: Allocator,
        comptime T: type,
        val: *const T,
        property: *const Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) void {
        this.flushHelper(allocator, "images", T, val, dest, context);

        // Store prefixed properties. Clear if we hit an unprefixed property and we have
        // targets. In this case, the necessary prefixes will be generated.
        this.has_prefix = val.any(struct {
            pub fn predicate(item: *const Image) bool {
                return item.hasVendorPrefix();
            }
        }.predicate);
        if (this.has_prefix) {
            this.decls.append(allocator, property.deepClone(allocator)) catch bun.outOfMemory();
        } else if (context.targets.browsers != null) {
            this.decls.clearRetainingCapacity();
        }
    }

    fn flushHelper(
        this: *@This(),
        allocator: Allocator,
        comptime field: []const u8,
        comptime T: type,
        val: *const T,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) void {
        if (@field(this, field) != null and
            !@field(this, field).?.eql(val) and
            context.targets.browsers != null and !val.isCompatible(context.targets.browsers.?))
        {
            this.flush(allocator, dest, context);
        }
    }

    fn flush(this: *@This(), allocator: Allocator, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;
        this.has_any = false;
        const push = struct {
            fn push(self: *BackgroundHandler, alloc: Allocator, d: *css.DeclarationList, comptime property_field_name: []const u8, val: anytype) void {
                d.append(alloc, @unionInit(Property, property_field_name, val)) catch bun.outOfMemory();
                const prop = @field(BackgroundProperty, property_field_name);
                bun.bits.insert(BackgroundProperty, &self.flushed_properties, prop);
            }
        }.push;

        var maybe_color: ?CssColor = bun.take(&this.color);
        var maybe_images: ?css.SmallList(Image, 1) = bun.take(&this.images);
        var maybe_x_positions: ?css.SmallList(HorizontalPosition, 1) = bun.take(&this.x_positions);
        var maybe_y_positions: ?css.SmallList(VerticalPosition, 1) = bun.take(&this.y_positions);
        var maybe_repeats: ?css.SmallList(BackgroundRepeat, 1) = bun.take(&this.repeats);
        var maybe_sizes: ?css.SmallList(BackgroundSize, 1) = bun.take(&this.sizes);
        var maybe_attachments: ?css.SmallList(BackgroundAttachment, 1) = bun.take(&this.attachments);
        var maybe_origins: ?css.SmallList(BackgroundOrigin, 1) = bun.take(&this.origins);
        var maybe_clips: ?struct { css.SmallList(BackgroundClip, 1), css.VendorPrefix } = bun.take(&this.clips);
        defer {
            if (maybe_color) |*c| c.deinit(allocator);
            if (maybe_images) |*i| i.deinit(allocator);
            if (maybe_x_positions) |*x| x.deinit(allocator);
            if (maybe_y_positions) |*y| y.deinit(allocator);
            if (maybe_repeats) |*r| r.deinit(allocator);
            if (maybe_sizes) |*s| s.deinit(allocator);
            if (maybe_attachments) |*a| a.deinit(allocator);
            if (maybe_origins) |*o| o.deinit(allocator);
            if (maybe_clips) |*c| c.*[0].deinit(allocator);
        }

        if (maybe_color != null and
            maybe_images != null and
            maybe_x_positions != null and
            maybe_y_positions != null and
            maybe_repeats != null and
            maybe_sizes != null and
            maybe_attachments != null and
            maybe_origins != null and
            maybe_clips != null)
        {
            const color = &maybe_color.?;
            var images = &maybe_images.?;
            var x_positions = &maybe_x_positions.?;
            var y_positions = &maybe_y_positions.?;
            var repeats = &maybe_repeats.?;
            var sizes = &maybe_sizes.?;
            var attachments = &maybe_attachments.?;
            var origins = &maybe_origins.?;
            var clips = &maybe_clips.?;

            // Only use shorthand syntax if the number of layers matches on all properties.
            const len = images.len();
            if (x_positions.len() == len and
                y_positions.len() == len and
                repeats.len() == len and
                sizes.len() == len and attachments.len() == len and origins.len() == len and clips[0].len() == len)
            {
                const clip_prefixes = if (clips.*[0].any(struct {
                    fn predicate(clip: *const BackgroundClip) bool {
                        return clip.* == BackgroundClip.text;
                    }
                }.predicate)) context.targets.prefixes(clips.*[1], .background_clip) else clips.*[1];
                const clip_property = if (clip_prefixes != css.VendorPrefix{ .none = true })
                    css.Property{ .@"background-clip" = .{ clips.*[0].deepClone(allocator), clip_prefixes } }
                else
                    null;

                var backgrounds = SmallList(Background, 1).initCapacity(allocator, len);
                for (
                    images.slice(),
                    x_positions.slice(),
                    y_positions.slice(),
                    repeats.slice(),
                    sizes.slice(),
                    attachments.slice(),
                    origins.slice(),
                    clips.*[0].slice(),
                    0..,
                ) |image, x_position, y_position, repeat, size, attachment, origin, clip, i| {
                    backgrounds.appendAssumeCapacity(Background{
                        .color = if (i == len - 1) color.deepClone(allocator) else CssColor.default(),
                        .image = image,
                        .position = BackgroundPosition{ .x = x_position, .y = y_position },
                        .repeat = repeat,
                        .size = size,
                        .attachment = attachment,
                        .origin = origin,
                        .clip = if (clip_prefixes == css.VendorPrefix{ .none = true }) clip else BackgroundClip.default(),
                    });
                }
                defer {
                    images.clearRetainingCapacity();
                    x_positions.clearRetainingCapacity();
                    y_positions.clearRetainingCapacity();
                    repeats.clearRetainingCapacity();
                    sizes.clearRetainingCapacity();
                    attachments.clearRetainingCapacity();
                    origins.clearRetainingCapacity();
                    clips.*[0].clearRetainingCapacity();
                }

                if (this.flushed_properties.isEmpty()) {
                    for (backgrounds.getFallbacks(allocator, context.targets).slice()) |fallback| {
                        push(this, allocator, dest, "background", fallback);
                    }
                }

                push(this, allocator, dest, "background", backgrounds);

                if (clip_property) |clip| {
                    dest.append(allocator, clip) catch bun.outOfMemory();
                    this.flushed_properties.clip = true;
                }

                this.reset(allocator);
                return;
            }
        }

        if (bun.take(&maybe_color)) |color_const| {
            var color: CssColor = color_const;
            if (!this.flushed_properties.color) {
                for (color.getFallbacks(allocator, context.targets).slice()) |fallback| {
                    push(this, allocator, dest, "background-color", fallback);
                }
            }
            push(this, allocator, dest, "background-color", color);
        }

        if (bun.take(&maybe_images)) |images_| {
            var images: css.SmallList(Image, 1) = images_;
            if (!this.flushed_properties.image) {
                var fallbacks = images.getFallbacks(allocator, context.targets);
                for (fallbacks.slice()) |fallback| {
                    push(this, allocator, dest, "background-image", fallback);
                }
            }
            push(this, allocator, dest, "background-image", images);
        }

        if (maybe_x_positions != null and maybe_y_positions != null and maybe_x_positions.?.len() == maybe_y_positions.?.len()) {
            var positions = SmallList(BackgroundPosition, 1).initCapacity(allocator, maybe_x_positions.?.len());
            for (maybe_x_positions.?.slice(), maybe_y_positions.?.slice()) |x, y| {
                positions.appendAssumeCapacity(BackgroundPosition{ .x = x, .y = y });
            }
            maybe_x_positions.?.clearRetainingCapacity();
            maybe_y_positions.?.clearRetainingCapacity();
            push(this, allocator, dest, "background-position", positions);
        } else {
            if (bun.take(&maybe_x_positions)) |x| {
                push(this, allocator, dest, "background-position-x", x);
            }
            if (bun.take(&maybe_y_positions)) |y| {
                push(this, allocator, dest, "background-position-y", y);
            }
        }

        if (bun.take(&maybe_repeats)) |rep| {
            push(this, allocator, dest, "background-repeat", rep);
        }

        if (bun.take(&maybe_sizes)) |rep| {
            push(this, allocator, dest, "background-size", rep);
        }

        if (bun.take(&maybe_attachments)) |rep| {
            push(this, allocator, dest, "background-attachment", rep);
        }

        if (bun.take(&maybe_origins)) |rep| {
            push(this, allocator, dest, "background-origin", rep);
        }

        if (bun.take(&maybe_clips)) |c| {
            const clips: css.SmallList(BackgroundClip, 1), const vp: css.VendorPrefix = c;
            const prefixes = if (clips.any(struct {
                pub fn predicate(clip: *const BackgroundClip) bool {
                    return clip.* == BackgroundClip.text;
                }
            }.predicate)) context.targets.prefixes(vp, css.prefixes.Feature.background_clip) else vp;
            dest.append(
                allocator,
                Property{
                    .@"background-clip" = .{ clips.deepClone(allocator), prefixes },
                },
            ) catch bun.outOfMemory();
            this.flushed_properties.clip = true;
        }

        this.reset(allocator);
    }

    fn reset(this: *@This(), allocator: Allocator) void {
        if (this.color) |c| c.deinit(allocator);
        this.color = null;
        if (this.images) |*i| i.deinit(allocator);
        this.images = null;
        if (this.x_positions) |*x| x.deinit(allocator);
        this.x_positions = null;
        if (this.y_positions) |*y| y.deinit(allocator);
        this.y_positions = null;
        if (this.repeats) |*r| r.deinit(allocator);
        this.repeats = null;
        if (this.sizes) |*s| s.deinit(allocator);
        this.sizes = null;
        if (this.attachments) |*a| a.deinit(allocator);
        this.attachments = null;
        if (this.origins) |*o| o.deinit(allocator);
        this.origins = null;
        if (this.clips) |*c| c.*[0].deinit(allocator);
        this.clips = null;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        const allocator = context.allocator;
        // If the last declaration is prefixed, pop the last value
        // so it isn't duplicated when we flush.
        if (this.has_prefix) {
            var maybe_prop = this.decls.pop();
            if (maybe_prop) |*prop| {
                prop.deinit(allocator);
            }
        }

        dest.appendSlice(allocator, this.decls.items) catch bun.outOfMemory();
        this.decls.clearRetainingCapacity();

        this.flush(allocator, dest, context);
        this.flushed_properties = BackgroundProperty{};
    }
};

fn isBackgroundProperty(property_id: css.PropertyId) bool {
    return switch (property_id) {
        .@"background-color",
        .@"background-image",
        .@"background-position",
        .@"background-position-x",
        .@"background-position-y",
        .@"background-repeat",
        .@"background-size",
        .@"background-attachment",
        .@"background-origin",
        .@"background-clip",
        .background,
        => true,
        else => false,
    };
}
