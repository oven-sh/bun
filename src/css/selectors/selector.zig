const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;
const debug = bun.Output.scoped(.css, true);

pub const css = @import("../css_parser.zig");
const CSSString = css.CSSString;
const CSSStringFns = css.CSSStringFns;

pub const Printer = css.Printer;
pub const PrintErr = css.PrintErr;

const Result = css.Result;
const PrintResult = css.PrintResult;

const ArrayList = std.ArrayListUnmanaged;

/// Our implementation of the `SelectorImpl` interface
///
pub const impl = struct {
    pub const Selectors = struct {
        pub const SelectorImpl = struct {
            pub const AttrValue = css.css_values.string.CSSString;
            pub const Identifier = css.css_values.ident.Ident;
            pub const LocalName = css.css_values.ident.Ident;
            pub const NamespacePrefix = css.css_values.ident.Ident;
            pub const NamespaceUrl = []const u8;
            pub const BorrowedNamespaceUrl = []const u8;
            pub const BorrowedLocalName = css.css_values.ident.Ident;

            pub const NonTSPseudoClass = parser.PseudoClass;
            pub const PseudoElement = parser.PseudoElement;
            pub const VendorPrefix = css.VendorPrefix;
            pub const ExtraMatchingData = void;
        };
    };
};

pub const parser = @import("./parser.zig");

/// The serialization module ported from lightningcss.
///
/// Note that we have two serialization modules, one from lightningcss and one from servo.
///
/// This is because it actually uses both implementations. This is confusing.
pub const serialize = struct {
    pub fn serializeSelectorList(
        list: []const parser.Selector,
        comptime W: type,
        dest: *Printer(W),
        context: ?*const css.StyleContext,
        is_relative: bool,
    ) PrintErr!void {
        var first = true;
        for (list) |*selector| {
            if (!first) {
                try dest.delim(',', false);
            }
            first = false;
            try serializeSelector(selector, W, dest, context, is_relative);
        }
    }

    pub fn serializeSelector(
        selector: *const parser.Selector,
        comptime W: type,
        dest: *css.Printer(W),
        context: ?*const css.StyleContext,
        __is_relative: bool,
    ) PrintErr!void {
        var is_relative = __is_relative;

        if (comptime bun.Environment.isDebug) {
            debug("Selector components:", .{});
            for (selector.components.items) |*comp| {
                debug(" {}\n", .{comp});
            }

            debug("Compound selector iters", .{});
            var compound_selectors = CompoundSelectorIter{ .sel = selector };
            while (compound_selectors.next()) |comp| {
                for (comp) |c| {
                    debug("  {}, ", .{c});
                }
            }
        }

        // Compound selectors invert the order of their contents, so we need to
        // undo that during serialization.
        //
        // This two-iterator strategy involves walking over the selector twice.
        // We could do something more clever, but selector serialization probably
        // isn't hot enough to justify it, and the stringification likely
        // dominates anyway.
        //
        // NB: A parse-order iterator is a Rev<>, which doesn't expose as_slice(),
        // which we need for |split|. So we split by combinators on a match-order
        // sequence and then reverse.
        var combinators = CombinatorIter{ .sel = selector };
        var compound_selectors = CompoundSelectorIter{ .sel = selector };
        const should_compile_nesting = dest.targets.shouldCompileSame(.nesting);

        var first = true;
        var combinators_exhausted = false;
        while (compound_selectors.next()) |_compound_| {
            bun.debugAssert(!combinators_exhausted);
            var compound = _compound_;

            // Skip implicit :scope in relative selectors (e.g. :has(:scope > foo) -> :has(> foo))
            if (is_relative and compound.len >= 1 and compound[0] == .scope) {
                if (combinators.next()) |*combinator| {
                    try serializeCombinator(combinator, W, dest);
                }
                compound = compound[1..];
                is_relative = false;
            }

            // https://drafts.csswg.org/cssom/#serializing-selectors
            if (compound.len == 0) continue;

            const has_leading_nesting = first and compound[0] == .nesting;
            const first_index: usize = if (has_leading_nesting) 1 else 0;
            first = false;

            // 1. If there is only one simple selector in the compound selectors
            //    which is a universal selector, append the result of
            //    serializing the universal selector to s.
            //
            // Check if `!compound.empty()` first--this can happen if we have
            // something like `... > ::before`, because we store `>` and `::`
            // both as combinators internally.
            //
            // If we are in this case, after we have serialized the universal
            // selector, we skip Step 2 and continue with the algorithm.
            const can_elide_namespace, const first_non_namespace = if (first_index >= compound.len)
                .{ true, first_index }
            else switch (compound[0]) {
                .explicit_any_namespace, .explicit_no_namespace, .namespace => .{ false, first_index + 1 },
                .default_namespace => .{ true, first_index + 1 },
                else => .{ true, first_index },
            };
            var perform_step_2 = true;
            const next_combinator = combinators.next();
            if (first_non_namespace == compound.len - 1) {
                // We have to be careful here, because if there is a
                // pseudo element "combinator" there isn't really just
                // the one simple selector. Technically this compound
                // selector contains the pseudo element selector as well
                // -- Combinator::PseudoElement, just like
                // Combinator::SlotAssignment, don't exist in the
                // spec.
                if (next_combinator == .pseudo_element and compound[first_non_namespace].asCombinator() == .slot_assignment) {
                    // do nothing
                } else if (compound[first_non_namespace] == .explicit_universal_type) {
                    // Iterate over everything so we serialize the namespace
                    // too.
                    const swap_nesting = has_leading_nesting and should_compile_nesting;
                    const slice = if (swap_nesting) brk: {
                        // Swap nesting and type selector (e.g. &div -> div&).
                        break :brk compound[@min(1, compound.len)..];
                    } else compound;

                    for (slice) |*simple| {
                        try serializeComponent(simple, W, dest, context);
                    }

                    if (swap_nesting) {
                        try serializeNesting(W, dest, context, false);
                    }

                    // Skip step 2, which is an "otherwise".
                    perform_step_2 = false;
                } else {
                    // do nothing
                }
            }

            // 2. Otherwise, for each simple selector in the compound selectors
            //    that is not a universal selector of which the namespace prefix
            //    maps to a namespace that is not the default namespace
            //    serialize the simple selector and append the result to s.
            //
            // See https://github.com/w3c/csswg-drafts/issues/1606, which is
            // proposing to change this to match up with the behavior asserted
            // in cssom/serialize-namespaced-type-selectors.html, which the
            // following code tries to match.
            if (perform_step_2) {
                const iter = compound;
                var i: usize = 0;
                if (has_leading_nesting and
                    should_compile_nesting and
                    isTypeSelector(if (first_non_namespace < compound.len) &compound[first_non_namespace] else null))
                {
                    // Swap nesting and type selector (e.g. &div -> div&).
                    // This ensures that the compiled selector is valid. e.g. (div.foo is valid, .foodiv is not).
                    const nesting = &iter[i];
                    i += 1;
                    const local = &iter[i];
                    i += 1;
                    try serializeComponent(local, W, dest, context);

                    // Also check the next item in case of namespaces.
                    if (first_non_namespace > first_index) {
                        const local2 = &iter[i];
                        i += 1;
                        try serializeComponent(local2, W, dest, context);
                    }

                    try serializeComponent(nesting, W, dest, context);
                } else if (has_leading_nesting and should_compile_nesting) {
                    // Nesting selector may serialize differently if it is leading, due to type selectors.
                    i += 1;
                    try serializeNesting(W, dest, context, true);
                }

                if (i < compound.len) {
                    for (iter[i..]) |*simple| {
                        if (simple.* == .explicit_universal_type) {
                            // Can't have a namespace followed by a pseudo-element
                            // selector followed by a universal selector in the same
                            // compound selector, so we don't have to worry about the
                            // real namespace being in a different `compound`.
                            if (can_elide_namespace) {
                                continue;
                            }
                        }
                        try serializeComponent(simple, W, dest, context);
                    }
                }
            }

            // 3. If this is not the last part of the chain of the selector
            //    append a single SPACE (U+0020), followed by the combinator
            //    ">", "+", "~", ">>", "||", as appropriate, followed by another
            //    single SPACE (U+0020) if the combinator was not whitespace, to
            //    s.
            if (next_combinator) |*c| {
                try serializeCombinator(c, W, dest);
            } else {
                combinators_exhausted = true;
            }

            // 4. If this is the last part of the chain of the selector and
            //    there is a pseudo-element, append "::" followed by the name of
            //    the pseudo-element, to s.
            //
            // (we handle this above)
        }
    }

    pub fn serializeComponent(
        component: *const parser.Component,
        comptime W: type,
        dest: *css.Printer(W),
        context: ?*const css.StyleContext,
    ) PrintErr!void {
        switch (component.*) {
            .combinator => |c| return serializeCombinator(&c, W, dest),
            .attribute_in_no_namespace => |*v| {
                try dest.writeChar('[');
                try css.css_values.ident.IdentFns.toCss(&v.local_name, W, dest);
                try v.operator.toCss(W, dest);

                if (dest.minify) {
                    // PERF: should we put a scratch buffer in the printer
                    // Serialize as both an identifier and a string and choose the shorter one.
                    var id = std.ArrayList(u8).init(dest.allocator);
                    const writer = id.writer();
                    css.serializer.serializeIdentifier(v.value, writer) catch return dest.addFmtError();

                    const s = try css.to_css.string(dest.allocator, CSSString, &v.value, css.PrinterOptions{}, dest.import_records);

                    if (id.items.len > 0 and id.items.len < s.len) {
                        try dest.writeStr(id.items);
                    } else {
                        try dest.writeStr(s);
                    }
                } else {
                    try css.CSSStringFns.toCss(&v.value, W, dest);
                }

                switch (v.case_sensitivity) {
                    .case_sensitive, .ascii_case_insensitive_if_in_html_element_in_html_document => {},
                    .ascii_case_insensitive => try dest.writeStr(" i"),
                    .explicit_case_sensitive => try dest.writeStr(" s"),
                }
                return dest.writeChar(']');
            },
            .is, .where, .negation, .any => {
                switch (component.*) {
                    .where => try dest.writeStr(":where("),
                    .is => |selectors| {
                        // If there's only one simple selector, serialize it directly.
                        if (shouldUnwrapIs(selectors)) {
                            return serializeSelector(&selectors[0], W, dest, context, false);
                        }

                        const vp = dest.vendor_prefix;
                        if (vp.intersects(css.VendorPrefix{ .webkit = true, .moz = true })) {
                            try dest.writeChar(':');
                            try vp.toCss(W, dest);
                            try dest.writeStr("any(");
                        } else {
                            try dest.writeStr(":is(");
                        }
                    },
                    .negation => {
                        try dest.writeStr(":not(");
                    },
                    .any => |v| {
                        const vp = dest.vendor_prefix.bitwiseOr(v.vendor_prefix);
                        if (vp.intersects(css.VendorPrefix{ .webkit = true, .moz = true })) {
                            try dest.writeChar(':');
                            try vp.toCss(W, dest);
                            try dest.writeStr("any(");
                        } else {
                            try dest.writeStr(":is(");
                        }
                    },
                    else => unreachable,
                }
                try serializeSelectorList(switch (component.*) {
                    .where, .is, .negation => |list| list,
                    .any => |v| v.selectors,
                    else => unreachable,
                }, W, dest, context, false);
                return dest.writeStr(")");
            },
            .has => |list| {
                try dest.writeStr(":has(");
                try serializeSelectorList(list, W, dest, context, true);
                return dest.writeStr(")");
            },
            .non_ts_pseudo_class => |*pseudo| {
                return serializePseudoClass(pseudo, W, dest, context);
            },
            .pseudo_element => |*pseudo| {
                return serializePseudoElement(pseudo, W, dest, context);
            },
            .nesting => {
                return serializeNesting(W, dest, context, false);
            },
            .class => |class| {
                try dest.writeChar('.');
                return dest.writeIdent(class.v, true);
            },
            .id => |id| {
                try dest.writeChar('#');
                return dest.writeIdent(id.v, true);
            },
            .host => |selector| {
                try dest.writeStr(":host");
                if (selector) |*sel| {
                    try dest.writeChar('(');
                    try serializeSelector(sel, W, dest, dest.context(), false);
                    try dest.writeChar(')');
                }
                return;
            },
            .slotted => |*selector| {
                try dest.writeStr("::slotted(");
                try serializeSelector(selector, W, dest, dest.context(), false);
                try dest.writeChar(')');
            },
            // .nth => |nth_data| {
            //     try nth_data.writeStart(W, dest, nth_data.isFunction());
            //     if (nth_data.isFunction()) {
            //         try nth_data.writeAffine(W, dest);
            //         try dest.writeChar(')');
            //     }
            // },

            else => {
                try tocss_servo.toCss_Component(component, W, dest);
            },
        }
    }

    pub fn serializeCombinator(
        combinator: *const parser.Combinator,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        switch (combinator.*) {
            .child => try dest.delim('>', true),
            .descendant => try dest.writeStr(" "),
            .next_sibling => try dest.delim('+', true),
            .later_sibling => try dest.delim('~', true),
            .deep => try dest.writeStr(" /deep/ "),
            .deep_descendant => {
                try dest.whitespace();
                try dest.writeStr(">>>");
                try dest.whitespace();
            },
            .pseudo_element, .part, .slot_assignment => return,
        }
    }

    pub fn serializePseudoClass(
        pseudo_class: *const parser.PseudoClass,
        comptime W: type,
        dest: *Printer(W),
        context: ?*const css.StyleContext,
    ) PrintErr!void {
        switch (pseudo_class.*) {
            .lang => {
                try dest.writeStr(":lang(");
                var first = true;
                for (pseudo_class.lang.languages.items) |lang| {
                    if (first) {
                        first = false;
                    } else {
                        try dest.delim(',', false);
                    }
                    css.serializer.serializeIdentifier(lang, dest) catch return dest.addFmtError();
                }
                return dest.writeStr(")");
            },
            .dir => {
                const dir = pseudo_class.dir.direction;
                try dest.writeStr(":dir(");
                try dir.toCss(W, dest);
                return try dest.writeStr(")");
            },
            else => {},
        }

        const Helpers = struct {
            pub inline fn writePrefixed(
                d: *Printer(W),
                prefix: css.VendorPrefix,
                comptime val: []const u8,
            ) PrintErr!void {
                try d.writeChar(':');
                // If the printer has a vendor prefix override, use that.
                const vp = if (!d.vendor_prefix.isEmpty())
                    d.vendor_prefix.bitwiseOr(prefix).orNone()
                else
                    prefix;

                try vp.toCss(W, d);
                try d.writeStr(val);
            }
            pub inline fn pseudo(
                d: *Printer(W),
                comptime key: []const u8,
                comptime s: []const u8,
            ) PrintErr!void {
                const key_snake_case = comptime key_snake_case: {
                    var buf: [key.len]u8 = undefined;
                    for (key, 0..) |c, i| {
                        buf[i] = if (c >= 'A' and c <= 'Z') c + 32 else if (c == '-') '_' else c;
                    }
                    const buf2 = buf;
                    break :key_snake_case buf2;
                };
                const _class = if (d.pseudo_classes) |*pseudo_classes| @field(pseudo_classes, &key_snake_case) else null;

                if (_class) |class| {
                    try d.writeChar('.');
                    try d.writeIdent(class, true);
                } else {
                    try d.writeStr(s);
                }
            }
        };

        switch (pseudo_class.*) {
            // https://drafts.csswg.org/selectors-4/#useraction-pseudos
            .hover => try Helpers.pseudo(dest, "hover", ":hover"),
            .active => try Helpers.pseudo(dest, "active", ":active"),
            .focus => try Helpers.pseudo(dest, "focus", ":focus"),
            .focus_visible => try Helpers.pseudo(dest, "focus-visible", ":focus-visible"),
            .focus_within => try Helpers.pseudo(dest, "focus-within", ":focus-within"),

            // https://drafts.csswg.org/selectors-4/#time-pseudos
            .current => try dest.writeStr(":current"),
            .past => try dest.writeStr(":past"),
            .future => try dest.writeStr(":future"),

            // https://drafts.csswg.org/selectors-4/#resource-pseudos
            .playing => try dest.writeStr(":playing"),
            .paused => try dest.writeStr(":paused"),
            .seeking => try dest.writeStr(":seeking"),
            .buffering => try dest.writeStr(":buffering"),
            .stalled => try dest.writeStr(":stalled"),
            .muted => try dest.writeStr(":muted"),
            .volume_locked => try dest.writeStr(":volume-locked"),

            // https://fullscreen.spec.whatwg.org/#:fullscreen-pseudo-class
            .fullscreen => |prefix| {
                try dest.writeChar(':');
                const vp = if (!dest.vendor_prefix.isEmpty())
                    dest.vendor_prefix.bitwiseAnd(prefix).orNone()
                else
                    prefix;
                try vp.toCss(W, dest);
                if (vp.webkit or vp.moz) {
                    try dest.writeStr("full-screen");
                } else {
                    try dest.writeStr("fullscreen");
                }
            },

            // https://drafts.csswg.org/selectors/#display-state-pseudos
            .open => try dest.writeStr(":open"),
            .closed => try dest.writeStr(":closed"),
            .modal => try dest.writeStr(":modal"),
            .picture_in_picture => try dest.writeStr(":picture-in-picture"),

            // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open
            .popover_open => try dest.writeStr(":popover-open"),

            // https://drafts.csswg.org/selectors-4/#the-defined-pseudo
            .defined => try dest.writeStr(":defined"),

            // https://drafts.csswg.org/selectors-4/#location
            .any_link => |prefix| try Helpers.writePrefixed(dest, prefix, "any-link"),
            .link => try dest.writeStr(":link"),
            .local_link => try dest.writeStr(":local-link"),
            .target => try dest.writeStr(":target"),
            .target_within => try dest.writeStr(":target-within"),
            .visited => try dest.writeStr(":visited"),

            // https://drafts.csswg.org/selectors-4/#input-pseudos
            .enabled => try dest.writeStr(":enabled"),
            .disabled => try dest.writeStr(":disabled"),
            .read_only => |prefix| try Helpers.writePrefixed(dest, prefix, "read-only"),
            .read_write => |prefix| try Helpers.writePrefixed(dest, prefix, "read-write"),
            .placeholder_shown => |prefix| try Helpers.writePrefixed(dest, prefix, "placeholder-shown"),
            .default => try dest.writeStr(":default"),
            .checked => try dest.writeStr(":checked"),
            .indeterminate => try dest.writeStr(":indeterminate"),
            .blank => try dest.writeStr(":blank"),
            .valid => try dest.writeStr(":valid"),
            .invalid => try dest.writeStr(":invalid"),
            .in_range => try dest.writeStr(":in-range"),
            .out_of_range => try dest.writeStr(":out-of-range"),
            .required => try dest.writeStr(":required"),
            .optional => try dest.writeStr(":optional"),
            .user_valid => try dest.writeStr(":user-valid"),
            .user_invalid => try dest.writeStr(":user-invalid"),

            // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-autofill
            .autofill => |prefix| try Helpers.writePrefixed(dest, prefix, "autofill"),

            .local => |selector| try serializeSelector(selector.selector, W, dest, context, false),
            .global => |selector| {
                const css_module = if (dest.css_module) |module| css_module: {
                    dest.css_module = null;
                    break :css_module module;
                } else null;
                try serializeSelector(selector.selector, W, dest, context, false);
                dest.css_module = css_module;
            },

            // https://webkit.org/blog/363/styling-scrollbars/
            .webkit_scrollbar => |s| {
                try dest.writeStr(switch (s) {
                    .horizontal => ":horizontal",
                    .vertical => ":vertical",
                    .decrement => ":decrement",
                    .increment => ":increment",
                    .start => ":start",
                    .end => ":end",
                    .double_button => ":double-button",
                    .single_button => ":single-button",
                    .no_button => ":no-button",
                    .corner_present => ":corner-present",
                    .window_inactive => ":window-inactive",
                });
            },

            .lang => unreachable,
            .dir => unreachable,
            .custom => |name| {
                try dest.writeChar(':');
                return dest.writeStr(name.name);
            },
            .custom_function => |v| {
                try dest.writeChar(':');
                try dest.writeStr(v.name);
                try dest.writeChar('(');
                try v.arguments.toCssRaw(W, dest);
                try dest.writeChar(')');
            },
        }
    }

    pub fn serializePseudoElement(
        pseudo_element: *const parser.PseudoElement,
        comptime W: type,
        dest: *Printer(W),
        context: ?*const css.StyleContext,
    ) PrintErr!void {
        const Helpers = struct {
            pub fn writePrefix(d: *Printer(W), prefix: css.VendorPrefix) PrintErr!css.VendorPrefix {
                try d.writeStr("::");
                // If the printer has a vendor prefix override, use that.
                const vp = if (!d.vendor_prefix.isEmpty()) d.vendor_prefix.bitwiseAnd(prefix).orNone() else prefix;
                try vp.toCss(W, d);
                return vp;
            }

            pub fn writePrefixed(d: *Printer(W), prefix: css.VendorPrefix, comptime val: []const u8) PrintErr!void {
                _ = try writePrefix(d, prefix);
                try d.writeStr(val);
            }
        };
        // switch (pseudo_element.*) {
        //     // CSS2 pseudo elements support a single colon syntax in addition
        //     // to the more correct double colon for other pseudo elements.
        //     // We use that here because it's supported everywhere and is shorter.
        //     .after => try dest.writeStr(":after"),
        //     .before => try dest.writeStr(":before"),
        //     .marker => try dest.writeStr(":first-letter"),
        //     .selection => |prefix| Helpers.writePrefixed(dest, prefix, "selection"),
        //     .cue => dest.writeStr("::cue"),
        //     .cue_region => dest.writeStr("::cue-region"),
        //     .cue_function => |v| {
        //         dest.writeStr("::cue(");
        //         try serializeSelector(v.selector, W, dest, context, false);
        //         try dest.writeChar(')');
        //     },
        // }
        switch (pseudo_element.*) {
            // CSS2 pseudo elements support a single colon syntax in addition
            // to the more correct double colon for other pseudo elements.
            // We use that here because it's supported everywhere and is shorter.
            .after => try dest.writeStr(":after"),
            .before => try dest.writeStr(":before"),
            .first_line => try dest.writeStr(":first-line"),
            .first_letter => try dest.writeStr(":first-letter"),
            .marker => try dest.writeStr("::marker"),
            .selection => |prefix| try Helpers.writePrefixed(dest, prefix, "selection"),
            .cue => try dest.writeStr("::cue"),
            .cue_region => try dest.writeStr("::cue-region"),
            .cue_function => |v| {
                try dest.writeStr("::cue(");
                try serializeSelector(v.selector, W, dest, context, false);
                try dest.writeChar(')');
            },
            .cue_region_function => |v| {
                try dest.writeStr("::cue-region(");
                try serializeSelector(v.selector, W, dest, context, false);
                try dest.writeChar(')');
            },
            .placeholder => |prefix| {
                const vp = try Helpers.writePrefix(dest, prefix);
                if (vp.webkit or vp.ms) {
                    try dest.writeStr("input-placeholder");
                } else {
                    try dest.writeStr("placeholder");
                }
            },
            .backdrop => |prefix| try Helpers.writePrefixed(dest, prefix, "backdrop"),
            .file_selector_button => |prefix| {
                const vp = try Helpers.writePrefix(dest, prefix);
                if (vp.webkit) {
                    try dest.writeStr("file-upload-button");
                } else if (vp.ms) {
                    try dest.writeStr("browse");
                } else {
                    try dest.writeStr("file-selector-button");
                }
            },
            .webkit_scrollbar => |s| {
                try dest.writeStr(switch (s) {
                    .scrollbar => "::-webkit-scrollbar",
                    .button => "::-webkit-scrollbar-button",
                    .track => "::-webkit-scrollbar-track",
                    .track_piece => "::-webkit-scrollbar-track-piece",
                    .thumb => "::-webkit-scrollbar-thumb",
                    .corner => "::-webkit-scrollbar-corner",
                    .resizer => "::-webkit-resizer",
                });
            },
            .view_transition => try dest.writeStr("::view-transition"),
            .view_transition_group => |v| {
                try dest.writeStr("::view-transition-group(");
                try v.part_name.toCss(W, dest);
                try dest.writeChar(')');
            },
            .view_transition_image_pair => |v| {
                try dest.writeStr("::view-transition-image-pair(");
                try v.part_name.toCss(W, dest);
                try dest.writeChar(')');
            },
            .view_transition_old => |v| {
                try dest.writeStr("::view-transition-old(");
                try v.part_name.toCss(W, dest);
                try dest.writeChar(')');
            },
            .view_transition_new => |v| {
                try dest.writeStr("::view-transition-new(");
                try v.part_name.toCss(W, dest);
                try dest.writeChar(')');
            },
            .custom => |val| {
                try dest.writeStr("::");
                return dest.writeStr(val.name);
            },
            .custom_function => |v| {
                const name = v.name;
                try dest.writeStr("::");
                try dest.writeStr(name);
                try dest.writeChar('(');
                try v.arguments.toCssRaw(W, dest);
                try dest.writeChar(')');
            },
        }
    }

    pub fn serializeNesting(
        comptime W: type,
        dest: *Printer(W),
        context: ?*const css.StyleContext,
        first: bool,
    ) PrintErr!void {
        if (context) |ctx| {
            // If there's only one simple selector, just serialize it directly.
            // Otherwise, use an :is() pseudo class.
            // Type selectors are only allowed at the start of a compound selector,
            // so use :is() if that is not the case.
            if (ctx.selectors.v.items.len == 1 and
                (first or (!hasTypeSelector(&ctx.selectors.v.items[0]) and
                isSimple(&ctx.selectors.v.items[0]))))
            {
                try serializeSelector(&ctx.selectors.v.items[0], W, dest, ctx.parent, false);
            } else {
                try dest.writeStr(":is(");
                try serializeSelectorList(ctx.selectors.v.items, W, dest, ctx.parent, false);
                try dest.writeChar(')');
            }
        } else {
            // If there is no context, we are at the root if nesting is supported. This is equivalent to :scope.
            // Otherwise, if nesting is supported, serialize the nesting selector directly.
            if (dest.targets.shouldCompileSame(.nesting)) {
                try dest.writeStr(":scope");
            } else {
                try dest.writeChar('&');
            }
        }
    }
};

const tocss_servo = struct {
    pub fn toCss_SelectorList(
        selectors: []const parser.Selector,
        comptime W: type,
        dest: *css.Printer(W),
    ) PrintErr!void {
        if (selectors.len == 0) {
            return;
        }

        try tocss_servo.toCss_Selector(&selectors[0], W, dest);

        if (selectors.len > 1) {
            for (selectors[1..]) |*selector| {
                try dest.writeStr(", ");
                try tocss_servo.toCss_Selector(selector, W, dest);
            }
        }
    }

    pub fn toCss_Selector(
        selector: *const parser.Selector,
        comptime W: type,
        dest: *css.Printer(W),
    ) PrintErr!void {
        // Compound selectors invert the order of their contents, so we need to
        // undo that during serialization.
        //
        // This two-iterator strategy involves walking over the selector twice.
        // We could do something more clever, but selector serialization probably
        // isn't hot enough to justify it, and the stringification likely
        // dominates anyway.
        //
        // NB: A parse-order iterator is a Rev<>, which doesn't expose as_slice(),
        // which we need for |split|. So we split by combinators on a match-order
        // sequence and then reverse.
        var combinators = CombinatorIter{ .sel = selector };
        var compound_selectors = CompoundSelectorIter{ .sel = selector };

        var combinators_exhausted = false;
        while (compound_selectors.next()) |compound| {
            bun.debugAssert(!combinators_exhausted);

            // https://drafts.csswg.org/cssom/#serializing-selectors
            if (compound.len == 0) continue;

            // 1. If there is only one simple selector in the compound selectors
            //    which is a universal selector, append the result of
            //    serializing the universal selector to s.
            //
            // Check if `!compound.empty()` first--this can happen if we have
            // something like `... > ::before`, because we store `>` and `::`
            // both as combinators internally.
            //
            // If we are in this case, after we have serialized the universal
            // selector, we skip Step 2 and continue with the algorithm.
            const can_elide_namespace, const first_non_namespace: usize = if (0 >= compound.len)
                .{ true, 0 }
            else switch (compound[0]) {
                .explicit_any_namespace, .explicit_no_namespace, .namespace => .{ false, 1 },
                .default_namespace => .{ true, 1 },
                else => .{ true, 0 },
            };
            var perform_step_2 = true;
            const next_combinator = combinators.next();
            if (first_non_namespace == compound.len - 1) {
                // We have to be careful here, because if there is a
                // pseudo element "combinator" there isn't really just
                // the one simple selector. Technically this compound
                // selector contains the pseudo element selector as well
                // -- Combinator::PseudoElement, just like
                // Combinator::SlotAssignment, don't exist in the
                // spec.
                if (next_combinator == .pseudo_element and compound[first_non_namespace].asCombinator() == .slot_assignment) {
                    // do nothing
                } else if (compound[first_non_namespace] == .explicit_universal_type) {
                    // Iterate over everything so we serialize the namespace
                    // too.
                    for (compound) |*simple| {
                        try tocss_servo.toCss_Component(simple, W, dest);
                    }
                    // Skip step 2, which is an "otherwise".
                    perform_step_2 = false;
                } else {
                    // do nothing
                }
            }

            // 2. Otherwise, for each simple selector in the compound selectors
            //    that is not a universal selector of which the namespace prefix
            //    maps to a namespace that is not the default namespace
            //    serialize the simple selector and append the result to s.
            //
            // See https://github.com/w3c/csswg-drafts/issues/1606, which is
            // proposing to change this to match up with the behavior asserted
            // in cssom/serialize-namespaced-type-selectors.html, which the
            // following code tries to match.
            if (perform_step_2) {
                for (compound) |*simple| {
                    if (simple.* == .explicit_universal_type) {
                        // Can't have a namespace followed by a pseudo-element
                        // selector followed by a universal selector in the same
                        // compound selector, so we don't have to worry about the
                        // real namespace being in a different `compound`.
                        if (can_elide_namespace) {
                            continue;
                        }
                    }
                    try tocss_servo.toCss_Component(simple, W, dest);
                }
            }

            // 3. If this is not the last part of the chain of the selector
            //    append a single SPACE (U+0020), followed by the combinator
            //    ">", "+", "~", ">>", "||", as appropriate, followed by another
            //    single SPACE (U+0020) if the combinator was not whitespace, to
            //    s.
            if (next_combinator) |c| {
                try toCss_Combinator(&c, W, dest);
            } else {
                combinators_exhausted = true;
            }

            // 4. If this is the last part of the chain of the selector and
            //    there is a pseudo-element, append "::" followed by the name of
            //    the pseudo-element, to s.
            //
            // (we handle this above)
        }
    }

    pub fn toCss_Component(
        component: *const parser.Component,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        switch (component.*) {
            .combinator => |*c| try toCss_Combinator(c, W, dest),
            .slotted => |*selector| {
                try dest.writeStr("::slotted(");
                try tocss_servo.toCss_Selector(selector, W, dest);
                try dest.writeChar(')');
            },
            .part => |part_names| {
                try dest.writeStr("::part(");
                for (part_names, 0..) |name, i| {
                    if (i != 0) {
                        try dest.writeChar(' ');
                    }
                    try css.IdentFns.toCss(&name, W, dest);
                }
                try dest.writeChar(')');
            },
            .pseudo_element => |*p| {
                try p.toCss(W, dest);
            },
            .id => |s| {
                try dest.writeChar('#');
                try css.IdentFns.toCss(&s, W, dest);
            },
            .class => |s| {
                try dest.writeChar('.');
                try css.IdentFns.toCss(&s, W, dest);
            },
            .local_name => |local_name| {
                try local_name.toCss(W, dest);
            },
            .explicit_universal_type => {
                try dest.writeChar('*');
            },
            .default_namespace => return,

            .explicit_no_namespace => {
                try dest.writeChar('|');
            },
            .explicit_any_namespace => {
                try dest.writeStr("*|");
            },
            .namespace => |ns| {
                try css.IdentFns.toCss(&ns.prefix, W, dest);
                try dest.writeChar('|');
            },
            .attribute_in_no_namespace_exists => |v| {
                try dest.writeChar('[');
                try css.IdentFns.toCss(&v.local_name, W, dest);
                try dest.writeChar(']');
            },
            .attribute_in_no_namespace => |v| {
                try dest.writeChar('[');
                try css.IdentFns.toCss(&v.local_name, W, dest);
                try v.operator.toCss(W, dest);
                try css.CSSStringFns.toCss(&v.value, W, dest);
                switch (v.case_sensitivity) {
                    .case_sensitive, .ascii_case_insensitive_if_in_html_element_in_html_document => {},
                    .ascii_case_insensitive => try dest.writeStr(" i"),
                    .explicit_case_sensitive => try dest.writeStr(" s"),
                }
                try dest.writeChar(']');
            },
            .attribute_other => |attr_selector| {
                try attr_selector.toCss(W, dest);
            },
            // Pseudo-classes
            .root => {
                try dest.writeStr(":root");
            },
            .empty => {
                try dest.writeStr(":empty");
            },
            .scope => {
                try dest.writeStr(":scope");
            },
            .host => |selector| {
                try dest.writeStr(":host");
                if (selector) |*sel| {
                    try dest.writeChar('(');
                    try tocss_servo.toCss_Selector(sel, W, dest);
                    try dest.writeChar(')');
                }
            },
            .nth => |nth_data| {
                try nth_data.writeStart(W, dest, nth_data.isFunction());
                if (nth_data.isFunction()) {
                    try nth_data.writeAffine(W, dest);
                    try dest.writeChar(')');
                }
            },
            .nth_of => |nth_of_data| {
                const nth_data = nth_of_data.nthData();
                try nth_data.writeStart(W, dest, true);
                // A selector must be a function to hold An+B notation
                bun.debugAssert(nth_data.is_function);
                try nth_data.writeAffine(W, dest);
                // Only :nth-child or :nth-last-child can be of a selector list
                bun.debugAssert(nth_data.ty == .child or nth_data.ty == .last_child);
                // The selector list should not be empty
                bun.debugAssert(nth_of_data.selectors.len != 0);
                try dest.writeStr(" of ");
                try tocss_servo.toCss_SelectorList(nth_of_data.selectors, W, dest);
                try dest.writeChar(')');
            },
            .is, .where, .negation, .has, .any => {
                switch (component.*) {
                    .where => try dest.writeStr(":where("),
                    .is => try dest.writeStr(":is("),
                    .negation => try dest.writeStr(":not("),
                    .has => try dest.writeStr(":has("),
                    .any => |v| {
                        try dest.writeChar(':');
                        try v.vendor_prefix.toCss(W, dest);
                        try dest.writeStr("any(");
                    },
                    else => unreachable,
                }
                try tocss_servo.toCss_SelectorList(
                    switch (component.*) {
                        .where, .is, .negation, .has => |list| list,
                        .any => |v| v.selectors,
                        else => unreachable,
                    },
                    W,
                    dest,
                );
                try dest.writeStr(")");
            },
            .non_ts_pseudo_class => |*pseudo| {
                try pseudo.toCss(W, dest);
            },
            .nesting => try dest.writeChar('&'),
        }
    }

    pub fn toCss_Combinator(
        combinator: *const parser.Combinator,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        switch (combinator.*) {
            .child => try dest.writeStr(" > "),
            .descendant => try dest.writeStr(" "),
            .next_sibling => try dest.writeStr(" + "),
            .later_sibling => try dest.writeStr(" ~ "),
            .deep => try dest.writeStr(" /deep/ "),
            .deep_descendant => {
                try dest.writeStr(" >>> ");
            },
            .pseudo_element, .part, .slot_assignment => return,
        }
    }

    pub fn toCss_PseudoElement(
        pseudo_element: *const parser.PseudoElement,
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        switch (pseudo_element.*) {
            .before => try dest.writeStr("::before"),
            .after => try dest.writeStr("::after"),
        }
    }
};

pub fn shouldUnwrapIs(selectors: []const parser.Selector) bool {
    if (selectors.len == 1) {
        const first = selectors[0];
        if (!hasTypeSelector(&first) and isSimple(&first)) return true;
    }

    return false;
}

fn hasTypeSelector(selector: *const parser.Selector) bool {
    var iter = selector.iterRawParseOrderFrom(0);
    const first = iter.next();

    if (isNamespace(if (first) |*f| f else null)) return isTypeSelector(if (iter.next()) |*n| n else null);

    return isTypeSelector(if (first) |*f| f else null);
}

fn isNamespace(component: ?*const parser.Component) bool {
    if (component) |c| return switch (c.*) {
        .explicit_any_namespace, .explicit_no_namespace, .namespace, .default_namespace => true,
        else => false,
    };
    return false;
}

fn isTypeSelector(component: ?*const parser.Component) bool {
    if (component) |c| return switch (c.*) {
        .local_name, .explicit_universal_type => true,
        else => false,
    };
    return false;
}

fn isSimple(selector: *const parser.Selector) bool {
    var iter = selector.iterRawParseOrderFrom(0);
    while (iter.next()) |component| {
        if (component.isCombinator()) return true;
    }
    return false;
}

const CombinatorIter = struct {
    sel: *const parser.Selector,
    i: usize = 0,

    /// Original source has this iterator defined like so:
    /// ```rs
    /// selector
    ///   .iter_raw_match_order() // just returns an iterator
    ///   .rev() // reverses the iterator
    ///   .filter_map(|x| x.as_combinator()) // returns only entries which are combinators
    /// ```
    pub fn next(this: *@This()) ?parser.Combinator {
        while (this.i < this.sel.components.items.len) {
            defer this.i += 1;
            const combinator = this.sel.components.items[this.sel.components.items.len - 1 - this.i].asCombinator() orelse continue;
            return combinator;
        }
        return null;
    }
};
const CompoundSelectorIter = struct {
    sel: *const parser.Selector,
    i: usize = 0,

    /// This iterator is basically like doing `selector.components.splitByCombinator()`.
    ///
    /// For example:
    /// ```css
    /// div > p.class
    /// ```
    ///
    /// The iterator would return:
    /// ```
    /// First slice:
    /// .{
    ///   .{ .local_name = "div" }
    /// }
    ///
    /// Second slice:
    /// .{
    ///   .{ .local_name = "p" },
    ///   .{ .class = "class" }
    /// }
    /// ```
    ///
    /// BUT, the selectors are stored in reverse order, so this code needs to split the components backwards.
    ///
    /// Original source has this iterator defined like so:
    /// ```rs
    /// selector
    ///  .iter_raw_match_order()
    ///  .as_slice()
    ///  .split(|x| x.is_combinator()) // splits the slice into subslices by elements that match over the predicate
    ///  .rev() // reverse
    /// ```
    pub inline fn next(this: *@This()) ?[]const parser.Component {
        // Since we iterating backwards, we convert all indices into "backwards form" by doing `this.sel.components.items.len - 1 - i`
        while (this.i < this.sel.components.items.len) {
            const next_index: ?usize = next_index: {
                for (this.i..this.sel.components.items.len) |j| {
                    if (this.sel.components.items[this.sel.components.items.len - 1 - j].isCombinator()) break :next_index j;
                }
                break :next_index null;
            };
            if (next_index) |combinator_index| {
                const start = if (combinator_index == 0) 0 else combinator_index - 1;
                const end = this.i;
                const slice = this.sel.components.items[this.sel.components.items.len - 1 - start .. this.sel.components.items.len - end];
                this.i = combinator_index + 1;
                return slice;
            }
            const slice = this.sel.components.items[0 .. this.sel.components.items.len - 1 - this.i + 1];
            this.i = this.sel.components.items.len;
            return slice;
        }
        return null;
    }
};
