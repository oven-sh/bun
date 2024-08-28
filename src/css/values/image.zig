const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Url = css.css_values.url.Url;
const Gradient = css.css_values.gradient.Gradient;
const Resolution = css.css_values.resolution.Resolution;
const VendorPrefix = css.VendorPrefix;
const UrlDependency = css.dependencies.UrlDependency;

/// A CSS [`<image>`](https://www.w3.org/TR/css-images-3/#image-values) value.
pub const Image = union(enum) {
    /// The `none` keyword.
    none,
    /// A `url()`.
    url: Url,
    /// A gradient.
    gradient: *Gradient,
    /// An `image-set()`.
    image_set: *ImageSet,

    // pub usingnamespace css.DeriveParse(@This());
    // pub usingnamespace css.DeriveToCss(@This());

    pub fn parse(input: *css.Parser) Error!Image {
        _ = input; // autofix
        @panic(css.todo_stuff.depth);
    }

    pub fn toCss(this: *const Image, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @panic(css.todo_stuff.depth);
    }
};

/// A CSS [`image-set()`](https://drafts.csswg.org/css-images-4/#image-set-notation) value.
///
/// `image-set()` allows the user agent to choose between multiple versions of an image to
/// display the most appropriate resolution or file type that it supports.
pub const ImageSet = struct {
    /// The image options to choose from.
    options: ArrayList(ImageSetOption),

    /// The vendor prefix for the `image-set()` function.
    vendor_prefix: VendorPrefix,

    pub fn parse(input: *css.Parser) Error!ImageSet {
        const location = input.currentSourceLocation();
        const f = input.expectFunction();
        const vendor_prefix = vendor_prefix: {
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("image-set", css.VendorPrefix{.none})) {
                break :vendor_prefix .none;
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("-webkit-image-set", css.VendorPrefix{.none})) {
                break :vendor_prefix .webkit;
            } else return location.newUnexpectedTokenError(.{ .ident = f });
        };

        const Fn = struct {
            pub fn parseNestedBlockFn(_: void, i: *css.Parser) Error!ArrayList(ImageSetOption) {
                return i.parseCommaSeparated(ImageSetOption, ImageSetOption.parse);
            }
        };

        const options = try input.parseNestedBlock(ArrayList(ImageSetOption), {}, Fn.parseNestedBlockFn);

        return ImageSet{
            .options = options,
            .vendor_prefix = vendor_prefix,
        };
    }

    pub fn toCss(this: *const ImageSet, comptime W: type, dest: *css.Printer(W)) PrintErr!void {
        try this.vendor_prefix.toCss(W, dest);
        try dest.writeStr("image-set(");
        var first = true;
        for (this.options.items) |*option| {
            if (first) {
                first = false;
            } else {
                try dest.delim(',', false);
            }
            try option.toCss(W, dest);
        }
        return dest.writeChar(')');
    }
};

/// An image option within the `image-set()` function. See [ImageSet](ImageSet).
pub const ImageSetOption = struct {
    /// The image for this option.
    image: Image,
    /// The resolution of the image.
    resolution: Resolution,
    /// The mime type of the image.
    file_type: ?[]const u8,

    pub fn parse(input: *css.Parser) Error!ImageSetOption {
        const loc = input.currentSourceLocation();
        const image = if (input.tryParse(css.Parser.expectUrlOrString, .{})) |url|
            Image{ .url = Url{
                .url = url,
                .loc = loc,
            } }
        else
            // For some reason, `Image.parse` makes zls crash, using this syntax until that's fixed
            try @call(.auto, @field(Image, "parse"), .{input});

        const resolution: Resolution, const file_type: ?[]const u8 = if (input.tryParse(Resolution.parse, .{})) |res| brk: {
            const file_type = input.tryParse(parseFileType, .{}) catch null;
            break :brk .{ res, file_type };
        } else brk: {
            const file_type = input.tryParse(parseFileType, .{}) catch null;
            const resolution = input.tryParse(Resolution.parse, .{}) catch Resolution{ .dppx = 1.0 };
            break :brk .{ resolution, file_type };
        };

        return ImageSetOption{
            .image = image,
            .resolution = resolution,
            .file_type = if (file_type) |x| x else null,
        };
    }

    pub fn toCss(
        this: *const ImageSetOption,
        comptime W: type,
        dest: *css.Printer(W),
        is_prefixed: bool,
    ) PrintErr!void {
        if (this.image.* == .url and !is_prefixed) {
            const _dep: ?UrlDependency = if (dest.dependencies != null)
                UrlDependency.new(&this.image.url.url, dest.filename())
            else
                null;

            if (_dep) |dep| {
                try css.serializer.serializeString(dep.placeholder, W, dest);
                if (dest.dependencies) |*dependencies| {
                    dependencies.append(
                        @compileError(css.todo_stuff.think_about_allocator),
                        .{ .url = dep },
                    ) catch bun.outOfMemory();
                }
            } else {
                try css.serializer.serializeString(this.image.url.url, W, dest);
            }
        } else {
            try this.image.toCss(W, dest);
        }

        // TODO: Throwing an error when `self.resolution = Resolution::Dppx(0.0)`
        // TODO: -webkit-image-set() does not support `<image()> | <image-set()> |
        // <cross-fade()> | <element()> | <gradient>` and `type(<string>)`.
        try dest.writeChar(' ');

        // Safari only supports the x resolution unit in image-set().
        // In other places, x was added as an alias later.
        // Temporarily ignore the targets while printing here.
        const targets = targets: {
            const targets = dest.targets;
            dest.targets = .{};
            break :targets targets;
        };
        try this.resolution.toCss(W, dest);
        dest.targets = targets;

        if (this.file_type) |file_type| {
            try dest.writeStr(" type(");
            try css.serializer.serializeString(file_type, W, dest);
            try dest.writeChar(')');
        }
    }
};

fn parseFileType(input: *css.Parser) Error![]const u8 {
    try input.expectFunctionMatching("type");
    const Fn = struct {
        pub fn parseNestedBlockFn(_: void, i: *css.Parser) Error![]const u8 {
            return i.expectString();
        }
    };
    return input.parseNestedBlock([]const u8, {}, Fn.parseNestedBlockFn);
}
