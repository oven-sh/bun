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

const Property = css.css_properties.Property;
const PropertyId = css.css_properties.PropertyId;
const Time = css.css_values.time.Time;
const EasingFunction = css.css_values.easing.EasingFunction;

const VendorPrefix = css.VendorPrefix;
const Feature = css.prefixes.Feature;

/// A value for the [transition](https://www.w3.org/TR/2018/WD-css-transitions-1-20181011/#transition-shorthand-property) property.
pub const Transition = struct {
    /// The property to transition.
    property: PropertyId,
    /// The duration of the transition.
    duration: Time,
    /// The delay before the transition starts.
    delay: Time,
    /// The easing function for the transition.
    timing_function: EasingFunction,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.transition);
    pub usingnamespace css.DefineListShorthand(@This());

    pub const PropertyFieldMap = .{
        .property = css.PropertyIdTag.@"transition-property",
        .duration = css.PropertyIdTag.@"transition-duration",
        .delay = css.PropertyIdTag.@"transition-delay",
        .timing_function = css.PropertyIdTag.@"transition-timing-function",
    };

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(comptime @This(), this, allocator);
    }

    pub fn parse(parser: *css.Parser) css.Result(@This()) {
        var property: ?PropertyId = null;
        var duration: ?Time = null;
        var delay: ?Time = null;
        var timing_function: ?EasingFunction = null;

        while (true) {
            if (duration == null) {
                if (parser.tryParse(Time.parse, .{}).asValue()) |value| {
                    duration = value;
                    continue;
                }
            }

            if (timing_function == null) {
                if (parser.tryParse(EasingFunction.parse, .{}).asValue()) |value| {
                    timing_function = value;
                    continue;
                }
            }

            if (delay == null) {
                if (parser.tryParse(Time.parse, .{}).asValue()) |value| {
                    delay = value;
                    continue;
                }
            }

            if (property == null) {
                if (parser.tryParse(PropertyId.parse, .{}).asValue()) |value| {
                    property = value;
                    continue;
                }
            }

            break;
        }

        return .{ .result = .{
            .property = property orelse .all,
            .duration = duration orelse .{ .seconds = 0.0 },
            .delay = delay orelse .{ .seconds = 0.0 },
            .timing_function = timing_function orelse .ease,
        } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        try this.property.toCss(W, dest);
        if (!this.duration.isZero() or !this.delay.isZero()) {
            try dest.writeChar(' ');
            try this.duration.toCss(W, dest);
        }

        if (!this.timing_function.isEase()) {
            try dest.writeChar(' ');
            try this.timing_function.toCss(W, dest);
        }

        if (!this.delay.isZero()) {
            try dest.writeChar(' ');
            try this.delay.toCss(W, dest);
        }
    }
};

pub const TransitionHandler = struct {
    properties: ?struct { SmallList(PropertyId, 1), VendorPrefix } = null,
    durations: ?struct { SmallList(Time, 1), VendorPrefix } = null,
    delays: ?struct { SmallList(Time, 1), VendorPrefix } = null,
    timing_functions: ?struct { SmallList(EasingFunction, 1), VendorPrefix } = null,
    has_any: bool = false,

    pub fn handleProperty(this: *@This(), prop: *const Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        switch (prop.*) {
            .@"transition-property" => |*x| this.property(dest, context, Feature.transition_property, "properties", &x.*[0], x.*[1]),
            .@"transition-duration" => |*x| this.property(dest, context, Feature.transition_duration, "durations", &x.*[0], x.*[1]),
            .@"transition-delay" => |*x| this.property(dest, context, Feature.transition_delay, "delays", &x.*[0], x.*[1]),
            .@"transition-timing-function" => |*x| this.property(dest, context, Feature.transition_timing_function, "timing_functions", &x.*[0], x.*[1]),
            .transition => |*x| {
                const val: *const SmallList(Transition, 1) = &x.*[0];
                const vp: VendorPrefix = x.*[1];

                var properties = SmallList(PropertyId, 1).initCapacity(context.allocator, val.len());
                var durations = SmallList(Time, 1).initCapacity(context.allocator, val.len());
                var delays = SmallList(Time, 1).initCapacity(context.allocator, val.len());
                var timing_functions = SmallList(EasingFunction, 1).initCapacity(context.allocator, val.len());
                properties.setLen(val.len());
                durations.setLen(val.len());
                delays.setLen(val.len());
                timing_functions.setLen(val.len());

                for (val.slice(), properties.slice_mut()) |*item, *out_prop| {
                    out_prop.* = item.property.deepClone(context.allocator);
                }
                this.maybeFlush(dest, context, "properties", &properties, vp);

                for (val.slice(), durations.slice_mut()) |*item, *out_dur| {
                    out_dur.* = item.duration.deepClone(context.allocator);
                }
                this.maybeFlush(dest, context, "durations", &durations, vp);

                for (val.slice(), delays.slice_mut()) |*item, *out_delay| {
                    out_delay.* = item.delay.deepClone(context.allocator);
                }
                this.maybeFlush(dest, context, "delays", &delays, vp);

                for (val.slice(), timing_functions.slice_mut()) |*item, *out_timing| {
                    out_timing.* = item.timing_function.deepClone(context.allocator);
                }
                this.maybeFlush(dest, context, "timing_functions", &timing_functions, vp);

                this.property(dest, context, Feature.transition_property, "properties", &properties, vp);
                this.property(dest, context, Feature.transition_duration, "durations", &durations, vp);
                this.property(dest, context, Feature.transition_delay, "delays", &delays, vp);
                this.property(dest, context, Feature.transition_timing_function, "timing_functions", &timing_functions, vp);
            },
            .unparsed => |*x| if (isTransitionProperty(&x.property_id)) {
                this.flush(dest, context);
                dest.append(
                    context.allocator,
                    .{ .unparsed = x.getPrefixed(context.allocator, context.targets, Feature.transition) },
                ) catch bun.outOfMemory();
            } else return false,
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
    }

    fn property(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime feature: Feature, comptime prop: []const u8, val: anytype, vp: VendorPrefix) void {
        this.maybeFlush(dest, context, prop, val, vp);

        // Otherwise, update the value and add the prefix.
        if (@field(this, prop)) |*p| {
            const v = &p.*[0];
            const prefixes = &p.*[1];
            v.* = val.deepClone(context.allocator);
            prefixes.insert(vp);
            prefixes.* = context.targets.prefixes(prefixes.*, feature);
        } else {
            const prefixes = context.targets.prefixes(vp, feature);
            const cloned_val = val.deepClone(context.allocator);
            @field(this, prop) = .{ cloned_val, prefixes };
            this.has_any = true;
        }
    }

    fn maybeFlush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, val: anytype, vp: VendorPrefix) void {
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if (@field(this, prop)) |*p| {
            const v = &p.*[0];
            const prefixes = &p.*[1];
            if (!val.eql(v) and !prefixes.contains(vp)) {
                this.flush(dest, context);
            }
        }
    }

    fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;
        this.has_any = false;

        var _properties: ?struct { SmallList(PropertyId, 1), VendorPrefix } = bun.take(&this.properties);
        var _durations: ?struct { SmallList(Time, 1), VendorPrefix } = bun.take(&this.durations);
        var _delays: ?struct { SmallList(Time, 1), VendorPrefix } = bun.take(&this.delays);
        var _timing_functions: ?struct { SmallList(EasingFunction, 1), VendorPrefix } = bun.take(&this.timing_functions);

        var rtl_properties: ?SmallList(PropertyId, 1) = if (_properties) |*p| expandProperties(&p.*[0], context) else null;

        if (_properties != null and _durations != null and _delays != null and _timing_functions != null) {
            const properties: *SmallList(PropertyId, 1) = &_properties.?[0];
            const property_prefixes: *VendorPrefix = &_properties.?[1];
            const durations: *SmallList(Time, 1) = &_durations.?[0];
            const duration_prefixes: *VendorPrefix = &_durations.?[1];
            const delays: *SmallList(Time, 1) = &_delays.?[0];
            const delay_prefixes: *VendorPrefix = &_delays.?[1];
            const timing_functions: *SmallList(EasingFunction, 1) = &_timing_functions.?[0];
            const timing_prefixes: *VendorPrefix = &_timing_functions.?[1];

            // Find the intersection of prefixes with the same value.
            // Remove that from the prefixes of each of the properties. The remaining
            // prefixes will be handled by outputting individual properties below.
            const intersection = property_prefixes.bitwiseAnd(duration_prefixes.*).bitwiseAnd(delay_prefixes.*).bitwiseAnd(timing_prefixes.*);
            if (!intersection.isEmpty()) {
                const transitions = getTransitions(context, properties, durations, delays, timing_functions);

                if (rtl_properties) |*rtl_properties2| {
                    const rtl_transitions = getTransitions(context, rtl_properties2, durations, delays, timing_functions);
                    context.addLogicalRule(
                        context.allocator,
                        Property{
                            .transition = .{ transitions, intersection },
                        },
                        Property{
                            .transition = .{ rtl_transitions, intersection },
                        },
                    );
                } else {
                    dest.append(
                        context.allocator,
                        Property{ .transition = .{ transitions.deepClone(context.allocator), intersection } },
                    ) catch bun.outOfMemory();
                }

                property_prefixes.remove(intersection);
                duration_prefixes.remove(intersection);
                delay_prefixes.remove(intersection);
                timing_prefixes.remove(intersection);
            }
        }

        if (_properties != null) {
            const properties: SmallList(PropertyId, 1) = _properties.?[0];
            const prefix: VendorPrefix = _properties.?[1];
            _properties = null;
            if (!prefix.isEmpty()) {
                if (rtl_properties) |rtl_properties2| {
                    context.addLogicalRule(
                        context.allocator,
                        Property{ .@"transition-property" = .{ properties, prefix } },
                        Property{ .@"transition-property" = .{ rtl_properties2, prefix } },
                    );
                    rtl_properties = null;
                } else {
                    dest.append(context.allocator, Property{ .@"transition-property" = .{ properties, prefix } }) catch bun.outOfMemory();
                }
            }
        }

        if (_durations != null) {
            const durations: SmallList(Time, 1) = _durations.?[0];
            const prefix: VendorPrefix = _durations.?[1];
            _durations = null;
            if (!prefix.isEmpty()) {
                dest.append(context.allocator, Property{ .@"transition-duration" = .{ durations, prefix } }) catch bun.outOfMemory();
            }
        }

        if (_delays != null) {
            const delays: SmallList(Time, 1) = _delays.?[0];
            const prefix: VendorPrefix = _delays.?[1];
            _delays = null;
            if (!prefix.isEmpty()) {
                dest.append(context.allocator, Property{ .@"transition-delay" = .{ delays, prefix } }) catch bun.outOfMemory();
            }
        }

        if (_timing_functions != null) {
            const timing_functions: SmallList(EasingFunction, 1) = _timing_functions.?[0];
            const prefix: VendorPrefix = _timing_functions.?[1];
            _timing_functions = null;
            if (!prefix.isEmpty()) {
                dest.append(context.allocator, Property{ .@"transition-timing-function" = .{ timing_functions, prefix } }) catch bun.outOfMemory();
            }
        }

        this.reset();
    }

    inline fn getTransitions(
        context: *const css.PropertyHandlerContext,
        properties: *SmallList(PropertyId, 1),
        durations: *SmallList(Time, 1),
        delays: *SmallList(Time, 1),
        timing_functions: *SmallList(EasingFunction, 1),
    ) SmallList(Transition, 1) {
        const cycleBump = struct {
            inline fn cycleBump(idx: *u32, len: u32) void {
                idx.* = (idx.* + 1) % len;
            }
        }.cycleBump;

        // transition-property determines the number of transitions. The values of other
        // properties are repeated to match this length.
        var transitions = SmallList(Transition, 1).initCapacity(context.allocator, 1);
        var durations_idx: u32 = 0;
        var delays_idx: u32 = 0;
        var timing_idx: u32 = 0;
        for (properties.slice()) |*property_id| {
            const duration = if (durations.len() > durations_idx) durations.at(durations_idx).deepClone(context.allocator) else Time{ .seconds = 0.0 };
            const delay = if (delays.len() > delays_idx) delays.at(delays_idx).deepClone(context.allocator) else Time{ .seconds = 0.0 };
            const timing_function = if (timing_functions.len() > timing_idx) timing_functions.at(timing_idx).deepClone(context.allocator) else EasingFunction.ease;
            cycleBump(&durations_idx, durations.len());
            cycleBump(&delays_idx, delays.len());
            cycleBump(&timing_idx, timing_functions.len());
            const transition = Transition{
                .property = property_id.deepClone(context.allocator),
                .duration = duration,
                .delay = delay,
                .timing_function = timing_function,
            };
            var cloned = false;

            const prefix_to_iter = property_id.prefix().orNone();
            // Expand vendor prefixes into multiple transitions.
            inline for (VendorPrefix.FIELDS) |prefix_field| {
                if (@field(prefix_to_iter, prefix_field)) {
                    var t = if (cloned) transition.deepClone(context.allocator) else transition;
                    cloned = true;
                    var new_prefix = VendorPrefix{};
                    @field(new_prefix, prefix_field) = true;
                    t.property = property_id.withPrefix(new_prefix);
                    transitions.append(context.allocator, t);
                }
            }
        }
        return transitions;
    }

    pub fn reset(this: *@This()) void {
        this.properties = null;
        this.durations = null;
        this.delays = null;
        this.timing_functions = null;
        this.has_any = false;
    }
};

fn expandProperties(properties: *css.SmallList(PropertyId, 1), context: *css.PropertyHandlerContext) ?SmallList(PropertyId, 1) {
    const replace = struct {
        inline fn replace(allocator: Allocator, propertiez: anytype, props: []const PropertyId, i: u32) void {
            propertiez.mut(i).* = props[0].deepClone(allocator);
            if (props.len > 1) {
                propertiez.insertSlice(allocator, i + 1, props[1..]);
            }
        }
    }.replace;

    var rtl_properties: ?SmallList(PropertyId, 1) = null;
    var i: u32 = 0;

    // Expand logical properties in place.
    while (i < properties.len()) {
        const result = getLogicalProperties(properties.at(i));
        if (result == .block and context.shouldCompileLogical(result.block[0])) {
            replace(context.allocator, properties, result.block[1], i);
            if (rtl_properties) |*rtl| {
                replace(context.allocator, rtl, result.block[1], i);
            }
            i += 1;
        } else if (result == .@"inline" and context.shouldCompileLogical(result.@"inline"[0])) {
            const ltr = result.@"inline"[1];
            const rtl = result.@"inline"[2];
            // Clone properties to create RTL version only when needed.
            if (rtl_properties == null) {
                rtl_properties = properties.deepClone(context.allocator);
            }

            replace(context.allocator, properties, ltr, i);
            if (rtl_properties) |*rtl_props| {
                replace(context.allocator, rtl_props, rtl, i);
            }

            i += @intCast(ltr.len);
        } else {
            // Expand vendor prefixes for targets.
            properties.mut(i).setPrefixesForTargets(context.targets);

            // Expand mask properties, which use different vendor-prefixed names.
            if (css.css_properties.masking.getWebkitMaskProperty(properties.at(i))) |property_id| {
                if (context.targets.prefixes(VendorPrefix.NONE, Feature.mask_border).contains(VendorPrefix.WEBKIT)) {
                    properties.insert(context.allocator, i, property_id);
                    i += 1;
                }
            }

            if (rtl_properties) |*rtl_props| {
                rtl_props.mut(i).setPrefixesForTargets(context.targets);

                if (css.css_properties.masking.getWebkitMaskProperty(rtl_props.at(i))) |property_id| {
                    if (context.targets.prefixes(VendorPrefix.NONE, Feature.mask_border).contains(VendorPrefix.WEBKIT)) {
                        rtl_props.insert(context.allocator, i, property_id);
                        i += 1;
                    }
                }
            }
            i += 1;
        }
    }

    return rtl_properties;
}

const LogicalPropertyId = union(enum) {
    none,
    block: struct { css.compat.Feature, []const PropertyId },
    @"inline": struct { css.compat.Feature, []const PropertyId, []const PropertyId },
};

fn getLogicalProperties(property_id: *const PropertyId) LogicalPropertyId {
    return switch (property_id.*) {
        .@"block-size" => .{ .block = .{ .logical_size, &[_]PropertyId{.height} } },
        .@"inline-size" => .{ .@"inline" = .{ .logical_size, &[_]PropertyId{.width}, &[_]PropertyId{.height} } },
        .@"min-block-size" => .{ .block = .{ .logical_size, &[_]PropertyId{.@"min-height"} } },
        .@"max-block-size" => .{ .block = .{ .logical_size, &[_]PropertyId{.@"max-height"} } },
        .@"min-inline-size" => .{ .@"inline" = .{ .logical_size, &[_]PropertyId{.@"min-width"}, &[_]PropertyId{.@"min-height"} } },
        .@"max-inline-size" => .{ .@"inline" = .{ .logical_size, &[_]PropertyId{.@"max-width"}, &[_]PropertyId{.@"max-height"} } },

        .@"inset-block-start" => .{ .block = .{ .logical_inset, &[_]PropertyId{.top} } },
        .@"inset-block-end" => .{ .block = .{ .logical_inset, &[_]PropertyId{.bottom} } },
        .@"inset-inline-start" => .{ .@"inline" = .{ .logical_inset, &[_]PropertyId{.left}, &[_]PropertyId{.right} } },
        .@"inset-inline-end" => .{ .@"inline" = .{ .logical_inset, &[_]PropertyId{.right}, &[_]PropertyId{.left} } },
        .@"inset-block" => .{ .block = .{ .logical_inset, &[_]PropertyId{ .top, .bottom } } },
        .@"inset-inline" => .{ .block = .{ .logical_inset, &[_]PropertyId{ .left, .right } } },
        .inset => .{ .block = .{ .logical_inset, &[_]PropertyId{ .top, .bottom, .left, .right } } },

        .@"margin-block-start" => .{ .block = .{ .logical_margin, &[_]PropertyId{.@"margin-top"} } },
        .@"margin-block-end" => .{ .block = .{ .logical_margin, &[_]PropertyId{.@"margin-bottom"} } },
        .@"margin-inline-start" => .{ .@"inline" = .{ .logical_margin, &[_]PropertyId{.@"margin-left"}, &[_]PropertyId{.@"margin-right"} } },
        .@"margin-inline-end" => .{ .@"inline" = .{ .logical_margin, &[_]PropertyId{.@"margin-right"}, &[_]PropertyId{.@"margin-left"} } },
        .@"margin-block" => .{ .block = .{ .logical_margin, &[_]PropertyId{ .@"margin-top", .@"margin-bottom" } } },
        .@"margin-inline" => .{ .block = .{ .logical_margin, &[_]PropertyId{ .@"margin-left", .@"margin-right" } } },

        .@"padding-block-start" => .{ .block = .{ .logical_padding, &[_]PropertyId{.@"padding-top"} } },
        .@"padding-block-end" => .{ .block = .{ .logical_padding, &[_]PropertyId{.@"padding-bottom"} } },
        .@"padding-inline-start" => .{ .@"inline" = .{ .logical_padding, &[_]PropertyId{.@"padding-left"}, &[_]PropertyId{.@"padding-right"} } },
        .@"padding-inline-end" => .{ .@"inline" = .{ .logical_padding, &[_]PropertyId{.@"padding-right"}, &[_]PropertyId{.@"padding-left"} } },
        .@"padding-block" => .{ .block = .{ .logical_padding, &[_]PropertyId{ .@"padding-top", .@"padding-bottom" } } },
        .@"padding-inline" => .{ .block = .{ .logical_padding, &[_]PropertyId{ .@"padding-left", .@"padding-right" } } },

        .@"border-block-start" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-top"} } },
        .@"border-block-start-width" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-top-width"} } },
        .@"border-block-start-color" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-top-color"} } },
        .@"border-block-start-style" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-top-style"} } },

        .@"border-block-end" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-bottom"} } },
        .@"border-block-end-width" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-bottom-width"} } },
        .@"border-block-end-color" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-bottom-color"} } },
        .@"border-block-end-style" => .{ .block = .{ .logical_borders, &[_]PropertyId{.@"border-bottom-style"} } },

        .@"border-inline-start" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-left"}, &[_]PropertyId{.@"border-right"} } },
        .@"border-inline-start-width" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-left-width"}, &[_]PropertyId{.@"border-right-width"} } },
        .@"border-inline-start-color" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-left-color"}, &[_]PropertyId{.@"border-right-color"} } },
        .@"border-inline-start-style" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-left-style"}, &[_]PropertyId{.@"border-right-style"} } },

        .@"border-inline-end" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-right"}, &[_]PropertyId{.@"border-left"} } },
        .@"border-inline-end-width" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-right-width"}, &[_]PropertyId{.@"border-left-width"} } },
        .@"border-inline-end-color" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-right-color"}, &[_]PropertyId{.@"border-left-color"} } },
        .@"border-inline-end-style" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{.@"border-right-style"}, &[_]PropertyId{.@"border-left-style"} } },

        .@"border-block" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-top", .@"border-bottom" } } },
        .@"border-block-color" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-top-color", .@"border-bottom-color" } } },
        .@"border-block-width" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-top-width", .@"border-bottom-width" } } },
        .@"border-block-style" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-top-style", .@"border-bottom-style" } } },

        .@"border-inline" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-left", .@"border-right" } } },
        .@"border-inline-color" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-left-color", .@"border-right-color" } } },
        .@"border-inline-width" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-left-width", .@"border-right-width" } } },
        .@"border-inline-style" => .{ .block = .{ .logical_borders, &[_]PropertyId{ .@"border-left-style", .@"border-right-style" } } },

        .@"border-start-start-radius" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{PropertyId{ .@"border-top-left-radius" = VendorPrefix.NONE }}, &[_]PropertyId{PropertyId{ .@"border-top-right-radius" = VendorPrefix.NONE }} } },
        .@"border-start-end-radius" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{PropertyId{ .@"border-top-right-radius" = VendorPrefix.NONE }}, &[_]PropertyId{PropertyId{ .@"border-top-left-radius" = VendorPrefix.NONE }} } },
        .@"border-end-start-radius" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{PropertyId{ .@"border-bottom-left-radius" = VendorPrefix.NONE }}, &[_]PropertyId{PropertyId{ .@"border-bottom-right-radius" = VendorPrefix.NONE }} } },
        .@"border-end-end-radius" => .{ .@"inline" = .{ .logical_borders, &[_]PropertyId{PropertyId{ .@"border-bottom-right-radius" = VendorPrefix.NONE }}, &[_]PropertyId{PropertyId{ .@"border-bottom-left-radius" = VendorPrefix.NONE }} } },

        else => .none,
    };
}

fn isTransitionProperty(property_id: *const PropertyId) bool {
    return switch (property_id.*) {
        .@"transition-property",
        .@"transition-duration",
        .@"transition-delay",
        .@"transition-timing-function",
        .transition,
        => true,
        else => false,
    };
}
