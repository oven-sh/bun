const bun = @import("bun");

pub const css = @import("../css_parser.zig");

const CustomPropertyName = css.css_properties.CustomPropertyName;

const Printer = css.Printer;
const PrintErr = css.PrintErr;
const VendorPrefix = css.VendorPrefix;

const PropertyId = css.PropertyId;
const Property = css.Property;

pub const property_id_mixin = struct {
    pub fn toCss(this: *const PropertyId, comptime W: type, dest: *Printer(W)) PrintErr!void {
        var first = true;
        const name = this.name();
        const prefix_value = this.prefix().orNone();

        inline for (VendorPrefix.FIELDS) |field| {
            if (@field(prefix_value, field)) {
                var prefix: VendorPrefix = .{};
                @field(prefix, field) = true;

                if (first) {
                    first = false;
                } else {
                    try dest.delim(',', false);
                }
                try prefix.toCss(W, dest);
                try dest.writeStr(name);
            }
        }
    }

    pub fn parse(input: *css.Parser) css.Result(PropertyId) {
        const name = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = fromString(name) };
    }

    pub fn fromString(name_: []const u8) PropertyId {
        const name_ref = name_;
        var prefix: VendorPrefix = undefined;
        var trimmed_name: []const u8 = undefined;

        // TODO: todo_stuff.match_ignore_ascii_case
        if (bun.strings.startsWithCaseInsensitiveAscii(name_ref, "-webkit-")) {
            prefix = VendorPrefix{ .webkit = true };
            trimmed_name = name_ref[8..];
        } else if (bun.strings.startsWithCaseInsensitiveAscii(name_ref, "-moz-")) {
            prefix = VendorPrefix{ .moz = true };
            trimmed_name = name_ref[5..];
        } else if (bun.strings.startsWithCaseInsensitiveAscii(name_ref, "-o-")) {
            prefix = VendorPrefix{ .o = true };
            trimmed_name = name_ref[3..];
        } else if (bun.strings.startsWithCaseInsensitiveAscii(name_ref, "-ms-")) {
            prefix = VendorPrefix{ .ms = true };
            trimmed_name = name_ref[4..];
        } else {
            prefix = VendorPrefix{ .none = true };
            trimmed_name = name_ref;
        }

        return PropertyId.fromNameAndPrefix(trimmed_name, prefix) orelse .{ .custom = CustomPropertyName.fromStr(name_) };
    }
};

pub const property_mixin = struct {
    /// Serializes the CSS property, with an optional `!important` flag.
    pub fn toCss(this: *const Property, comptime W: type, dest: *Printer(W), important: bool) PrintErr!void {
        if (this.* == .custom) {
            try this.custom.name.toCss(W, dest);
            try dest.delim(':', false);
            try this.valueToCss(W, dest);
            if (important) {
                try dest.whitespace();
                try dest.writeStr("!important");
            }
            return;
        }
        const name, const prefix = this.__toCssHelper();
        var first = true;

        inline for (VendorPrefix.FIELDS) |field| {
            if (@field(prefix, field)) {
                var p: VendorPrefix = .{};
                @field(p, field) = true;

                if (first) {
                    first = false;
                } else {
                    try dest.writeChar(';');
                    try dest.newline();
                }
                try p.toCss(W, dest);
                try dest.writeStr(name);
                try dest.delim(':', false);
                try this.valueToCss(W, dest);
                if (important) {
                    try dest.whitespace();
                    try dest.writeStr("!important");
                }
            }
        }
    }
};
