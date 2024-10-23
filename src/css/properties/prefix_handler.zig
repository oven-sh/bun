const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const CustomPropertyName = css.css_properties.CustomPropertyName;

const Printer = css.Printer;
const PrintErr = css.PrintErr;
const VendorPrefix = css.VendorPrefix;
const Error = css.Error;

const PropertyId = css.PropertyId;
const Property = css.Property;

pub const FallbackHandler = struct {
    color: ?usize = null,
    @"text-shadow": ?usize = null,
    filter: ?usize = null,
    @"backdrop-filter": ?usize = null,
    fill: ?usize = null,
    stroke: ?usize = null,
    @"caret-color": ?usize = null,
    caret: ?usize = null,

    // const property_ids = property_ids: {
    //     var map = bun.ComptimeEnumMap();
    //     _ = map; // autofix
    // };

    pub fn handleProperty(
        this: *FallbackHandler,
        property: *const Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        _ = this; // autofix
        _ = property; // autofix
        _ = dest; // autofix
        _ = context; // autofix
        inline for (std.meta.fields(FallbackHandler)) |field| {
            _ = field; // autofix

        }
    }
};
