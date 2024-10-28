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
const PropertyIdTag = css.PropertyIdTag;
const Property = css.Property;
const UnparsedProperty = css.css_properties.custom.UnparsedProperty;

/// *NOTE* The struct field names must match their corresponding names in `Property`!
pub const FallbackHandler = struct {
    color: ?usize = null,
    @"text-shadow": ?usize = null,
    // TODO: add these back plz
    // filter: ?usize = null,
    // @"backdrop-filter": ?usize = null,
    // fill: ?usize = null,
    // stroke: ?usize = null,
    // @"caret-color": ?usize = null,
    // caret: ?usize = null,

    const field_count = @typeInfo(FallbackHandler).Struct.fields.len;

    pub fn handleProperty(
        this: *FallbackHandler,
        property: *const Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        inline for (std.meta.fields(FallbackHandler)) |field| {
            if (@intFromEnum(@field(PropertyIdTag, field.name)) == @intFromEnum(@as(PropertyIdTag, property.*))) {
                const has_vendor_prefix = comptime PropertyIdTag.hasVendorPrefix(@field(PropertyIdTag, field.name));
                var val = if (comptime has_vendor_prefix)
                    @field(property, field.name)[0].deepClone(context.allocator)
                else
                    @field(property, field.name).deepClone(context.allocator);

                if (@field(this, field.name) == null) {
                    const fallbacks = val.getFallbacks(context.allocator, context.targets);
                    const has_fallbacks = !fallbacks.isEmpty();

                    for (fallbacks.slice()) |fallback| {
                        dest.append(
                            context.allocator,
                            @unionInit(
                                Property,
                                field.name,
                                if (comptime has_vendor_prefix)
                                    .{ fallback, @field(property, field.name)[1] }
                                else
                                    fallback,
                            ),
                        ) catch bun.outOfMemory();
                    }
                    if (comptime has_vendor_prefix) {
                        if (has_fallbacks and @field(property, field.name[1]).contains(VendorPrefix{ .none = true })) {
                            @field(property, field.name[1]) = css.VendorPrefix{ .none = true };
                        }
                    }
                }

                if (@field(this, field.name) == null or
                    context.targets.browsers != null and !val.isCompatible(context.targets.browsers.?))
                {
                    @field(this, field.name) = dest.items.len;
                    dest.append(
                        context.allocator,
                        @unionInit(
                            Property,
                            field.name,
                            if (comptime has_vendor_prefix)
                                .{ val, @field(property, field.name)[1] }
                            else
                                val,
                        ),
                    ) catch bun.outOfMemory();
                } else if (@field(this, field.name) != null) {
                    const index = @field(this, field.name).?;
                    dest.items[index] = @unionInit(
                        Property,
                        field.name,
                        if (comptime has_vendor_prefix)
                            .{ val, @field(property, field.name)[1] }
                        else
                            val,
                    );
                } else {
                    val.deinit(context.allocator);
                }

                return true;
            }
        }

        if (@as(PropertyIdTag, property.*) == .unparsed) {
            const val: *const UnparsedProperty = &property.unparsed;
            var unparsed, const index = unparsed_and_index: {
                inline for (std.meta.fields(FallbackHandler)) |field| {
                    if (@intFromEnum(@field(PropertyIdTag, field.name)) == @intFromEnum(val.property_id)) {
                        const has_vendor_prefix = comptime PropertyIdTag.hasVendorPrefix(@field(PropertyIdTag, field.name));
                        const newval = newval: {
                            if (comptime has_vendor_prefix) {
                                if (@field(val.property_id, field.name)[1].contains(VendorPrefix{ .none = true }))
                                    break :newval val.getPrefixed(context.targets, @field(css.prefixes.Feature, field.name));
                            }
                            break :newval val.deepClone(context.allocator);
                        };
                        break :unparsed_and_index .{ newval, &@field(this, field.name) };
                    }
                }
                return false;
            };

            context.addUnparsedFallbacks(&unparsed);
            if (index.*) |i| {
                dest.items[i] = Property{ .unparsed = unparsed };
            } else {
                index.* = dest.items.len;
                dest.append(context.allocator, Property{ .unparsed = unparsed }) catch bun.outOfMemory();
            }

            return true;
        }

        return false;
    }

    pub fn finalize(this: *FallbackHandler, _: *css.DeclarationList, _: *css.PropertyHandlerContext) void {
        inline for (std.meta.fields(FallbackHandler)) |field| {
            @field(this, field.name) = null;
        }
    }
};
