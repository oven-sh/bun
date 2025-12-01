pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
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
    image_set: ImageSet,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn deinit(_: *@This(), _: std.mem.Allocator) void {
        // TODO: implement this
        // Right now not implementing this.
        // It is not a bug to implement this since all memory allocated in CSS parser is allocated into arena.
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return switch (this.*) {
            .gradient => |g| switch (g.*) {
                .linear => |linear| css.Feature.isCompatible(.linear_gradient, browsers) and linear.isCompatible(browsers),
                .repeating_linear => |repeating_linear| css.Feature.isCompatible(.repeating_linear_gradient, browsers) and repeating_linear.isCompatible(browsers),
                .radial => |radial| css.Feature.isCompatible(.radial_gradient, browsers) and radial.isCompatible(browsers),
                .repeating_radial => |repeating_radial| css.Feature.isCompatible(.repeating_radial_gradient, browsers) and repeating_radial.isCompatible(browsers),
                .conic => |conic| css.Feature.isCompatible(.conic_gradient, browsers) and conic.isCompatible(browsers),
                .repeating_conic => |repeating_conic| css.Feature.isCompatible(.repeating_conic_gradient, browsers) and repeating_conic.isCompatible(browsers),
                .@"webkit-gradient" => css.prefixes.Feature.isWebkitGradient(browsers),
            },
            .image_set => |image_set| image_set.isCompatible(browsers),
            .url, .none => true,
        };
    }

    pub fn getPrefixed(this: *const @This(), allocator: Allocator, prefix: css.VendorPrefix) Image {
        return switch (this.*) {
            .gradient => |grad| .{ .gradient = bun.create(allocator, Gradient, grad.getPrefixed(allocator, prefix)) },
            .image_set => |image_set| .{ .image_set = image_set.getPrefixed(allocator, prefix) },
            else => this.deepClone(allocator),
        };
    }

    pub fn getNecessaryPrefixes(this: *const @This(), targets: css.targets.Targets) css.VendorPrefix {
        return switch (this.*) {
            .gradient => |grad| grad.getNecessaryPrefixes(targets),
            .image_set => |*image_set| image_set.getNecessaryPrefixes(targets),
            else => css.VendorPrefix{ .none = true },
        };
    }

    pub fn hasVendorPrefix(this: *const @This()) bool {
        const prefix = this.getVendorPrefix();
        return !prefix.isEmpty() and prefix != VendorPrefix{ .none = true };
    }

    /// Returns the vendor prefix used in the image value.
    pub fn getVendorPrefix(this: *const @This()) VendorPrefix {
        return switch (this.*) {
            .gradient => |a| a.getVendorPrefix(),
            .image_set => |a| a.getVendorPrefix(),
            else => .{},
        };
    }

    /// Needed to satisfy ImageFallback interface
    pub fn getImage(this: *const @This()) *const Image {
        return this;
    }

    /// Needed to satisfy ImageFallback interface
    pub fn withImage(_: *const @This(), _: Allocator, image: Image) @This() {
        return image;
    }

    pub fn default() Image {
        return .none;
    }

    pub inline fn eql(this: *const Image, other: *const Image) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    /// Returns a legacy `-webkit-gradient()` value for the image.
    ///
    /// May return an error in case the gradient cannot be converted.
    pub fn getLegacyWebkit(this: *const @This(), allocator: Allocator) ?Image {
        return switch (this.*) {
            .gradient => |gradient| Image{ .gradient = bun.create(allocator, Gradient, gradient.getLegacyWebkit(allocator) orelse return null) },
            else => this.deepClone(allocator),
        };
    }

    pub fn getFallbacks(this: *@This(), allocator: Allocator, targets: css.targets.Targets) css.SmallList(Image, 6) {
        const ColorFallbackKind = css.ColorFallbackKind;
        // Determine which prefixes and color fallbacks are needed.
        const prefixes = this.getNecessaryPrefixes(targets);
        const fallbacks = this.getNecessaryFallbacks(targets);
        var res = css.SmallList(Image, 6){};

        // Get RGB fallbacks if needed.
        const rgb = if (fallbacks.rgb)
            this.getFallback(allocator, ColorFallbackKind.RGB)
        else
            null;

        // Prefixed properties only support RGB.
        const prefix_image = if (rgb) |r| &r else this;

        // Legacy -webkit-gradient()
        if (prefixes.webkit and
            if (targets.browsers) |browsers| css.prefixes.Feature.isWebkitGradient(browsers) else false and
                prefix_image.* == .gradient)
        {
            if (prefix_image.getLegacyWebkit(allocator)) |legacy| {
                res.append(allocator, legacy);
            }
        }

        // Standard syntax, with prefixes.
        if (prefixes.webkit) {
            res.append(allocator, prefix_image.getPrefixed(allocator, css.VendorPrefix.WEBKIT));
        }

        if (prefixes.moz) {
            res.append(allocator, prefix_image.getPrefixed(allocator, css.VendorPrefix.MOZ));
        }

        if (prefixes.o) {
            res.append(allocator, prefix_image.getPrefixed(allocator, css.VendorPrefix.O));
        }

        if (prefixes.none) {
            // Unprefixed, rgb fallback.
            if (rgb) |r| {
                res.append(allocator, r);
            }

            // P3 fallback.
            if (fallbacks.p3) {
                res.append(allocator, this.getFallback(allocator, ColorFallbackKind.P3));
            }

            // Convert original to lab if needed (e.g. if oklab is not supported but lab is).
            if (fallbacks.lab) {
                this.* = this.getFallback(allocator, ColorFallbackKind.LAB);
            }
        } else if (res.pop()) |last| {
            // Prefixed property with no unprefixed version.
            // Replace self with the last prefixed version so that it doesn't
            // get duplicated when the caller pushes the original value.
            this.* = last;
        }

        return res;
    }

    pub fn getFallback(this: *const @This(), allocator: Allocator, kind: css.ColorFallbackKind) Image {
        return switch (this.*) {
            .gradient => |grad| .{ .gradient = bun.create(allocator, Gradient, grad.getFallback(allocator, kind)) },
            else => this.deepClone(allocator),
        };
    }

    pub fn getNecessaryFallbacks(this: *const @This(), targets: css.targets.Targets) css.ColorFallbackKind {
        return switch (this.*) {
            .gradient => |grad| grad.getNecessaryFallbacks(targets),
            else => css.ColorFallbackKind{},
        };
    }

    // pub fn parse(input: *css.Parser) Result(Image) {
    //     _ = input; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

    // pub fn toCss(this: *const Image, dest: *css.Printer) css.PrintErr!void {
    //     _ = this; // autofix
    //     _ = dest; // autofix
    //     @panic(css.todo_stuff.depth);
    // }
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

    pub fn parse(input: *css.Parser) Result(ImageSet) {
        const location = input.currentSourceLocation();
        const f = switch (input.expectFunction()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const vendor_prefix = vendor_prefix: {
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("image-set", f)) {
                break :vendor_prefix VendorPrefix{ .none = true };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("-webkit-image-set", f)) {
                break :vendor_prefix VendorPrefix{ .webkit = true };
            } else return .{ .err = location.newUnexpectedTokenError(.{ .ident = f }) };
        };

        const Fn = struct {
            pub fn parseNestedBlockFn(_: void, i: *css.Parser) Result(ArrayList(ImageSetOption)) {
                return i.parseCommaSeparated(ImageSetOption, ImageSetOption.parse);
            }
        };

        const options = switch (input.parseNestedBlock(ArrayList(ImageSetOption), {}, Fn.parseNestedBlockFn)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        return .{ .result = ImageSet{
            .options = options,
            .vendor_prefix = vendor_prefix,
        } };
    }

    pub fn toCss(this: *const ImageSet, dest: *css.Printer) PrintErr!void {
        try this.vendor_prefix.toCss(dest);
        try dest.writeStr("image-set(");
        var first = true;
        for (this.options.items) |*option| {
            if (first) {
                first = false;
            } else {
                try dest.delim(',', false);
            }
            try option.toCss(dest, this.vendor_prefix != VendorPrefix{ .none = true });
        }
        return dest.writeChar(')');
    }

    pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
        return css.Feature.isCompatible(.image_set, browsers) and
            for (this.options.items) |opt| {
                if (!opt.image.isCompatible(browsers)) break false;
            } else true;
    }

    /// Returns the `image-set()` value with the given vendor prefix.
    pub fn getPrefixed(this: *const @This(), allocator: Allocator, prefix: css.VendorPrefix) ImageSet {
        return ImageSet{
            .options = css.deepClone(ImageSetOption, allocator, &this.options),
            .vendor_prefix = prefix,
        };
    }

    pub fn eql(this: *const ImageSet, other: *const ImageSet) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn getVendorPrefix(this: *const @This()) VendorPrefix {
        return this.vendor_prefix;
    }

    /// Returns the vendor prefixes needed for the given browser targets.
    pub fn getNecessaryPrefixes(this: *const @This(), targets: css.targets.Targets) css.VendorPrefix {
        return targets.prefixes(this.vendor_prefix, css.prefixes.Feature.image_set);
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

    pub fn parse(input: *css.Parser) Result(ImageSetOption) {
        const start_position = input.input.tokenizer.getPosition();
        const loc = input.currentSourceLocation();
        const image = if (input.tryParse(css.Parser.expectUrlOrString, .{}).asValue()) |url| brk: {
            const record_idx = switch (input.addImportRecord(
                url,
                start_position,
                .url,
            )) {
                .result => |idx| idx,
                .err => |e| return .{ .err = e },
            };
            break :brk Image{ .url = Url{
                .import_record_idx = record_idx,
                .loc = css.dependencies.Location.fromSourceLocation(loc),
            } };
        } else switch (@call(.auto, @field(Image, "parse"), .{input})) { // For some reason, `Image.parse` makes zls crash, using this syntax until that's fixed
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        const resolution: Resolution, const file_type: ?[]const u8 = if (input.tryParse(Resolution.parse, .{}).asValue()) |res| brk: {
            const file_type = input.tryParse(parseFileType, .{}).asValue();
            break :brk .{ res, file_type };
        } else brk: {
            const file_type = input.tryParse(parseFileType, .{}).asValue();
            const resolution = input.tryParse(Resolution.parse, .{}).unwrapOr(Resolution{ .dppx = 1.0 });
            break :brk .{ resolution, file_type };
        };

        return .{ .result = ImageSetOption{
            .image = image,
            .resolution = resolution,
            .file_type = if (file_type) |x| x else null,
        } };
    }

    pub fn toCss(
        this: *const ImageSetOption,
        dest: *css.Printer,
        is_prefixed: bool,
    ) PrintErr!void {
        if (this.image == .url and !is_prefixed) {
            const _dep: ?UrlDependency = if (dest.dependencies != null)
                UrlDependency.new(dest.allocator, &this.image.url, dest.filename(), try dest.getImportRecords())
            else
                null;

            if (_dep) |dep| {
                css.serializer.serializeString(dep.placeholder, dest) catch return dest.addFmtError();
                if (dest.dependencies) |*dependencies| {
                    dependencies.append(
                        dest.allocator,
                        .{ .url = dep },
                    ) catch |err| bun.handleOom(err);
                }
            } else {
                css.serializer.serializeString(try dest.getImportRecordUrl(this.image.url.import_record_idx), dest) catch return dest.addFmtError();
            }
        } else {
            try this.image.toCss(dest);
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
        try this.resolution.toCss(dest);
        dest.targets = targets;

        if (this.file_type) |file_type| {
            try dest.writeStr(" type(");
            css.serializer.serializeString(file_type, dest) catch return dest.addFmtError();
            try dest.writeChar(')');
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const ImageSetOption, rhs: *const ImageSetOption) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

fn parseFileType(input: *css.Parser) Result([]const u8) {
    if (input.expectFunctionMatching("type").asErr()) |e| return .{ .err = e };
    const Fn = struct {
        pub fn parseNestedBlockFn(_: void, i: *css.Parser) Result([]const u8) {
            return i.expectString();
        }
    };
    return input.parseNestedBlock([]const u8, {}, Fn.parseNestedBlockFn);
}

const bun = @import("bun");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
