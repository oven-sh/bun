const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
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
    image_set: ImageSet,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn default() Image {
        return .none;
    }

    pub inline fn eql(this: *const Image, other: *const Image) bool {
        return switch (this.*) {
            .none => switch (other.*) {
                .none => true,
                else => false,
            },
            .url => |*a| switch (other.*) {
                .url => a.eql(&other.url),
                else => false,
            },
            .image_set => |*a| switch (other.*) {
                .image_set => a.eql(&other.image_set),
                else => false,
            },
            .gradient => |a| switch (other.*) {
                .gradient => a.eql(other.gradient),
                else => false,
            },
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    // pub fn parse(input: *css.Parser) Result(Image) {
    //     _ = input; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

    // pub fn toCss(this: *const Image, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
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
            try option.toCss(W, dest, this.vendor_prefix.neq(VendorPrefix{ .none = true }));
        }
        return dest.writeChar(')');
    }

    pub fn eql(this: *const ImageSet, other: *const ImageSet) bool {
        return this.vendor_prefix.eql(other.vendor_prefix) and css.generic.eqlList(ImageSetOption, &this.options, &other.options);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
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
            const record_idx = switch (input.addImportRecordForUrl(
                url,
                start_position,
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
        comptime W: type,
        dest: *css.Printer(W),
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
                    ) catch bun.outOfMemory();
                }
            } else {
                css.serializer.serializeString(try dest.getImportRecordUrl(this.image.url.import_record_idx), dest) catch return dest.addFmtError();
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
            css.serializer.serializeString(file_type, dest) catch return dest.addFmtError();
            try dest.writeChar(')');
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const ImageSetOption, rhs: *const ImageSetOption) bool {
        return lhs.image.eql(&rhs.image) and lhs.resolution.eql(&rhs.resolution) and (brk: {
            if (lhs.file_type != null and rhs.file_type != null) {
                break :brk bun.strings.eql(lhs.file_type.?, rhs.file_type.?);
            }
            break :brk false;
        });
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
