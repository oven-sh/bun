const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("bun");
const logger = bun.logger;

pub const css = @import("../css_parser.zig");
const CSSStringFns = css.CSSStringFns;

pub const Printer = css.Printer;
pub const PrintErr = css.PrintErr;

const Result = css.Result;
const SmallList = css.SmallList;
const ArrayList = std.ArrayListUnmanaged;

const impl = css.selector.impl;
const serialize = css.selector.serialize;

/// Instantiation of generic selector structs using our implementation of the `SelectorImpl` trait.
pub const Component = GenericComponent(impl.Selectors);
pub const Selector = GenericSelector(impl.Selectors);
pub const SelectorList = GenericSelectorList(impl.Selectors);

pub const ToCssCtx = enum {
    lightning,
    servo,
};

/// The definition of whitespace per CSS Selectors Level 3 § 4.
pub const SELECTOR_WHITESPACE: []const u8 = &[_]u8{ ' ', '\t', '\n', '\r', 0x0C };

pub fn ValidSelectorImpl(comptime T: type) void {
    _ = T.SelectorImpl.ExtraMatchingData;
    _ = T.SelectorImpl.AttrValue;
    _ = T.SelectorImpl.Identifier;
    _ = T.SelectorImpl.LocalName;
    _ = T.SelectorImpl.NamespaceUrl;
    _ = T.SelectorImpl.NamespacePrefix;
    _ = T.SelectorImpl.BorrowedNamespaceUrl;
    _ = T.SelectorImpl.BorrowedLocalName;

    _ = T.SelectorImpl.NonTSPseudoClass;
    _ = T.SelectorImpl.VendorPrefix;
    _ = T.SelectorImpl.PseudoElement;
}

const selector_builder = @import("./builder.zig");

pub const attrs = struct {
    pub fn NamespaceUrl(comptime Impl: type) type {
        return struct {
            prefix: Impl.SelectorImpl.NamespacePrefix,
            url: Impl.SelectorImpl.NamespaceUrl,

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
                return css.implementDeepClone(@This(), this, allocator);
            }

            pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
                return css.implementHash(@This(), this, hasher);
            }
        };
    }

    pub fn AttrSelectorWithOptionalNamespace(comptime Impl: type) type {
        return struct {
            namespace: ?NamespaceConstraint(NamespaceUrl(Impl)),
            local_name: Impl.SelectorImpl.LocalName,
            local_name_lower: Impl.SelectorImpl.LocalName,
            operation: ParsedAttrSelectorOperation(Impl.SelectorImpl.AttrValue),
            never_matches: bool,

            pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
                try dest.writeChar('[');
                if (this.namespace) |nsp| switch (nsp) {
                    .specific => |v| {
                        try css.IdentFns.toCss(&v.prefix, W, dest);
                        try dest.writeChar('|');
                    },
                    .any => {
                        try dest.writeStr("*|");
                    },
                };
                try css.IdentFns.toCss(&this.local_name, W, dest);
                switch (this.operation) {
                    .exists => {},
                    .with_value => |v| {
                        try v.operator.toCss(W, dest);
                        // try v.expected_value.toCss(dest);
                        try CSSStringFns.toCss(&v.expected_value, W, dest);
                        switch (v.case_sensitivity) {
                            .case_sensitive, .ascii_case_insensitive_if_in_html_element_in_html_document => {},
                            .ascii_case_insensitive => {
                                try dest.writeStr(" i");
                            },
                            .explicit_case_sensitive => {
                                try dest.writeStr(" s");
                            },
                        }
                    },
                }
                return dest.writeChar(']');
            }

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
                return css.implementDeepClone(@This(), this, allocator);
            }

            pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
                return css.implementHash(@This(), this, hasher);
            }
        };
    }

    pub fn NamespaceConstraint(comptime NamespaceUrl_: type) type {
        return union(enum) {
            any,
            /// Empty string for no namespace
            specific: NamespaceUrl_,

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
                return css.implementHash(@This(), this, hasher);
            }

            pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
                return css.implementDeepClone(@This(), this, allocator);
            }
        };
    }

    pub fn ParsedAttrSelectorOperation(comptime AttrValue: type) type {
        return union(enum) {
            exists,
            with_value: struct {
                operator: AttrSelectorOperator,
                case_sensitivity: ParsedCaseSensitivity,
                expected_value: AttrValue,

                pub fn __generateEql() void {}
                pub fn __generateDeepClone() void {}
                pub fn __generateHash() void {}
            },

            pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
                return css.implementDeepClone(@This(), this, allocator);
            }

            pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
                return css.implementEql(@This(), lhs, rhs);
            }

            pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
                return css.implementHash(@This(), this, hasher);
            }
        };
    }

    pub const AttrSelectorOperator = enum {
        equal,
        includes,
        dash_match,
        prefix,
        substring,
        suffix,

        const This = @This();
        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // https://drafts.csswg.org/cssom/#serializing-selectors
            // See "attribute selector".
            return dest.writeStr(switch (this.*) {
                .equal => "=",
                .includes => "~=",
                .dash_match => "|=",
                .prefix => "^=",
                .substring => "*=",
                .suffix => "$=",
            });
        }

        pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
            return css.implementHash(@This(), this, hasher);
        }
    };

    pub const AttrSelectorOperation = enum {
        equal,
        includes,
        dash_match,
        prefix,
        substring,
        suffix,
    };

    pub const ParsedCaseSensitivity = enum {
        // 's' was specified.
        explicit_case_sensitive,
        // 'i' was specified.
        ascii_case_insensitive,
        // No flags were specified and HTML says this is a case-sensitive attribute.
        case_sensitive,
        // No flags were specified and HTML says this is a case-insensitive attribute.
        ascii_case_insensitive_if_in_html_element_in_html_document,
    };
};

pub const Specificity = struct {
    id_selectors: u32 = 0,
    class_like_selectors: u32 = 0,
    element_selectors: u32 = 0,

    const MAX_10BIT: u32 = (1 << 10) - 1;

    pub fn toU32(this: Specificity) u32 {
        return @as(u32, @as(u32, @min(this.id_selectors, MAX_10BIT)) << @as(u32, 20)) |
            @as(u32, @as(u32, @min(this.class_like_selectors, MAX_10BIT)) << @as(u32, 10)) |
            @min(this.element_selectors, MAX_10BIT);
    }

    pub fn fromU32(value: u32) Specificity {
        bun.assert(value <= MAX_10BIT << 20 | MAX_10BIT << 10 | MAX_10BIT);
        return Specificity{
            .id_selectors = value >> 20,
            .class_like_selectors = (value >> 10) & MAX_10BIT,
            .element_selectors = value & MAX_10BIT,
        };
    }

    pub fn add(lhs: *Specificity, rhs: Specificity) void {
        lhs.id_selectors += rhs.id_selectors;
        lhs.element_selectors += rhs.element_selectors;
        lhs.class_like_selectors += rhs.class_like_selectors;
    }
};

pub fn compute_specificity(comptime Impl: type, iter: []const GenericComponent(Impl)) u32 {
    const spec = compute_complex_selector_specificity(Impl, iter);
    return spec.toU32();
}

fn compute_complex_selector_specificity(comptime Impl: type, iter: []const GenericComponent(Impl)) Specificity {
    var specificity: Specificity = .{};

    for (iter) |*simple_selector| {
        compute_simple_selector_specificity(Impl, simple_selector, &specificity);
    }

    return specificity;
}

fn compute_simple_selector_specificity(
    comptime Impl: type,
    simple_selector: *const GenericComponent(Impl),
    specificity: *Specificity,
) void {
    switch (simple_selector.*) {
        .combinator => {
            bun.unreachablePanic("Found combinator in simple selectors vector?", .{});
        },
        .part, .pseudo_element, .local_name => {
            specificity.element_selectors += 1;
        },
        .slotted => |selector| {
            specificity.element_selectors += 1;
            // Note that due to the way ::slotted works we only compete with
            // other ::slotted rules, so the above rule doesn't really
            // matter, but we do it still for consistency with other
            // pseudo-elements.
            //
            // See: https://github.com/w3c/csswg-drafts/issues/1915
            specificity.add(Specificity.fromU32(selector.specificity()));
        },
        .host => |maybe_selector| {
            specificity.class_like_selectors += 1;
            if (maybe_selector) |*selector| {
                // See: https://github.com/w3c/csswg-drafts/issues/1915
                specificity.add(Specificity.fromU32(selector.specificity()));
            }
        },
        .id => {
            specificity.id_selectors += 1;
        },
        .class,
        .attribute_in_no_namespace,
        .attribute_in_no_namespace_exists,
        .attribute_other,
        .root,
        .empty,
        .scope,
        .nth,
        .non_ts_pseudo_class,
        => {
            specificity.class_like_selectors += 1;
        },
        .nth_of => |nth_of_data| {
            // https://drafts.csswg.org/selectors/#specificity-rules:
            //
            //     The specificity of the :nth-last-child() pseudo-class,
            //     like the :nth-child() pseudo-class, combines the
            //     specificity of a regular pseudo-class with that of its
            //     selector argument S.
            specificity.class_like_selectors += 1;
            var max: u32 = 0;
            for (nth_of_data.selectors) |*selector| {
                max = @max(selector.specificity(), max);
            }
            specificity.add(Specificity.fromU32(max));
        },
        .negation, .is, .any => {
            // https://drafts.csswg.org/selectors/#specificity-rules:
            //
            //     The specificity of an :is() pseudo-class is replaced by the
            //     specificity of the most specific complex selector in its
            //     selector list argument.
            const list: []GenericSelector(Impl) = switch (simple_selector.*) {
                .negation => |list| list,
                .is => |list| list,
                .any => |a| a.selectors,
                else => unreachable,
            };
            var max: u32 = 0;
            for (list) |*selector| {
                max = @max(selector.specificity(), max);
            }
            specificity.add(Specificity.fromU32(max));
        },
        .where,
        .has,
        .explicit_universal_type,
        .explicit_any_namespace,
        .explicit_no_namespace,
        .default_namespace,
        .namespace,
        => {
            // Does not affect specificity
        },
        .nesting => {
            // TODO
        },
    }
}

const SelectorBuilder = selector_builder.SelectorBuilder;

/// Build up a Selector.
/// selector : simple_selector_sequence [ combinator simple_selector_sequence ]* ;
///
/// `Err` means invalid selector.
fn parse_selector(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
    nesting_requirement: NestingRequirement,
) Result(GenericSelector(Impl)) {
    if (nesting_requirement == .prefixed) {
        const parser_state = input.state();
        if (!input.expectDelim('&').isOk()) {
            return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.missing_nesting_prefix)) };
        }
        input.reset(&parser_state);
    }

    // PERF: allocations here
    var builder = selector_builder.SelectorBuilder(Impl){
        .allocator = input.allocator(),
    };

    outer_loop: while (true) {
        // Parse a sequence of simple selectors.
        const empty = switch (parse_compound_selector(Impl, parser, state, input, &builder)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (empty) {
            const kind: SelectorParseErrorKind = if (builder.hasCombinators())
                .dangling_combinator
            else
                .empty_selector;

            return .{ .err = input.newCustomError(kind.intoDefaultParserError()) };
        }

        if (state.afterAnyPseudo()) {
            const source_location = input.currentSourceLocation();
            if (input.next().asValue()) |next| {
                return .{ .err = source_location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unexpected_selector_after_pseudo_element = next.* })) };
            }
            break;
        }

        // Parse a combinator
        var combinator: Combinator = undefined;
        var any_whitespace = false;
        while (true) {
            const before_this_token = input.state();
            const tok: *css.Token = switch (input.nextIncludingWhitespace()) {
                .result => |vv| vv,
                .err => break :outer_loop,
            };
            switch (tok.*) {
                .whitespace => {
                    any_whitespace = true;
                    continue;
                },
                .delim => |d| {
                    switch (d) {
                        '>' => {
                            if (parser.deepCombinatorEnabled() and input.tryParse(struct {
                                pub fn parseFn(i: *css.Parser) Result(void) {
                                    if (i.expectDelim('>').asErr()) |e| return .{ .err = e };
                                    return i.expectDelim('>');
                                }
                            }.parseFn, .{}).isOk()) {
                                combinator = Combinator.deep_descendant;
                            } else {
                                combinator = Combinator.child;
                            }
                            break;
                        },
                        '+' => {
                            combinator = .next_sibling;
                            break;
                        },
                        '~' => {
                            combinator = .later_sibling;
                            break;
                        },
                        '/' => {
                            if (parser.deepCombinatorEnabled()) {
                                if (input.tryParse(struct {
                                    pub fn parseFn(i: *css.Parser) Result(void) {
                                        if (i.expectIdentMatching("deep").asErr()) |e| return .{ .err = e };
                                        return i.expectDelim('/');
                                    }
                                }.parseFn, .{}).isOk()) {
                                    combinator = .deep;
                                    break;
                                } else {
                                    break :outer_loop;
                                }
                            }
                        },
                        else => {},
                    }
                },
                else => {},
            }

            input.reset(&before_this_token);

            if (any_whitespace) {
                combinator = .descendant;
                break;
            } else {
                break :outer_loop;
            }
        }

        if (!state.allowsCombinators()) {
            return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
        }

        builder.pushCombinator(combinator);
    }

    if (!state.after_nesting) {
        switch (nesting_requirement) {
            .implicit => {
                builder.addNestingPrefix();
            },
            .contained, .prefixed => {
                return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.missing_nesting_selector)) };
            },
            else => {},
        }
    }

    const has_pseudo_element = state.after_pseudo_element or state.after_unknown_pseudo_element;
    const slotted = state.after_slotted;
    const part = state.after_part;
    const result = builder.build(has_pseudo_element, slotted, part);
    return .{ .result = Selector{
        .specificity_and_flags = result.specificity_and_flags,
        .components = result.components,
    } };
}

/// simple_selector_sequence
/// : [ type_selector | universal ] [ HASH | class | attrib | pseudo | negation ]*
/// | [ HASH | class | attrib | pseudo | negation ]+
///
/// `Err(())` means invalid selector.
/// `Ok(true)` is an empty selector
fn parse_compound_selector(
    comptime Impl: type,
    parser: *SelectorParser,
    state: *SelectorParsingState,
    input: *css.Parser,
    builder: *SelectorBuilder(Impl),
) Result(bool) {
    input.skipWhitespace();

    var empty: bool = true;
    if (parser.isNestingAllowed() and if (input.tryParse(css.Parser.expectDelim, .{'&'}).isOk()) true else false) {
        state.after_nesting = true;
        builder.pushSimpleSelector(.nesting);
        empty = false;
    }

    if (parse_type_selector(Impl, parser, input, state.*, builder).asValue()) |_| {
        empty = false;
    }

    while (true) {
        const result: SimpleSelectorParseResult(Impl) = result: {
            const ret = switch (parse_one_simple_selector(Impl, parser, input, state)) {
                .result => |r| r,
                .err => |e| return .{ .err = e },
            };
            if (ret) |result| {
                break :result result;
            }
            break;
        };

        if (empty) {
            if (parser.defaultNamespace()) |url| {
                // If there was no explicit type selector, but there is a
                // default namespace, there is an implicit "<defaultns>|*" type
                // selector. Except for :host() or :not() / :is() / :where(),
                // where we ignore it.
                //
                // https://drafts.csswg.org/css-scoping/#host-element-in-tree:
                //
                //     When considered within its own shadow trees, the shadow
                //     host is featureless. Only the :host, :host(), and
                //     :host-context() pseudo-classes are allowed to match it.
                //
                // https://drafts.csswg.org/selectors-4/#featureless:
                //
                //     A featureless element does not match any selector at all,
                //     except those it is explicitly defined to match. If a
                //     given selector is allowed to match a featureless element,
                //     it must do so while ignoring the default namespace.
                //
                // https://drafts.csswg.org/selectors-4/#matches
                //
                //     Default namespace declarations do not affect the compound
                //     selector representing the subject of any selector within
                //     a :is() pseudo-class, unless that compound selector
                //     contains an explicit universal selector or type selector.
                //
                //     (Similar quotes for :where() / :not())
                //
                const ignore_default_ns = state.skip_default_namespace or
                    (result == .simple_selector and result.simple_selector == .host);
                if (!ignore_default_ns) {
                    builder.pushSimpleSelector(.{ .default_namespace = url });
                }
            }
        }

        empty = false;

        switch (result) {
            .simple_selector => {
                builder.pushSimpleSelector(result.simple_selector);
            },
            .part_pseudo => {
                const selector = result.part_pseudo;
                state.after_part = true;
                builder.pushCombinator(.part);
                builder.pushSimpleSelector(.{ .part = selector });
            },
            .slotted_pseudo => |selector| {
                state.after_slotted = true;
                builder.pushCombinator(.slot_assignment);
                builder.pushSimpleSelector(.{ .slotted = selector });
            },
            .pseudo_element => |p| {
                if (!p.isUnknown()) {
                    state.after_pseudo_element = true;
                    builder.pushCombinator(.pseudo_element);
                } else {
                    state.after_unknown_pseudo_element = true;
                }

                if (!p.acceptsStatePseudoClasses()) {
                    state.after_non_stateful_pseudo_element = true;
                }

                if (p.isWebkitScrollbar()) {
                    state.after_webkit_scrollbar = true;
                }

                if (p.isViewTransition()) {
                    state.after_view_transition = true;
                }

                builder.pushSimpleSelector(.{ .pseudo_element = p });
            },
        }
    }

    return .{ .result = empty };
}

fn parse_relative_selector(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
    nesting_requirement_: NestingRequirement,
) Result(GenericSelector(Impl)) {
    // https://www.w3.org/TR/selectors-4/#parse-relative-selector
    var nesting_requirement = nesting_requirement_;
    const s = input.state();

    const combinator: ?Combinator = combinator: {
        const tok = switch (input.next()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (tok.*) {
            .delim => |c| {
                switch (c) {
                    '>' => break :combinator Combinator.child,
                    '+' => break :combinator Combinator.next_sibling,
                    '~' => break :combinator Combinator.later_sibling,
                    else => {},
                }
            },
            else => {},
        }
        input.reset(&s);
        break :combinator null;
    };

    const scope: GenericComponent(Impl) = if (nesting_requirement == .implicit) .nesting else .scope;

    if (combinator != null) {
        nesting_requirement = .none;
    }

    var selector = switch (parse_selector(Impl, parser, input, state, nesting_requirement)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    if (combinator) |wombo_combo| {
        // https://www.w3.org/TR/selectors/#absolutizing
        selector.components.append(
            parser.allocator,
            .{ .combinator = wombo_combo },
        ) catch unreachable;
        selector.components.append(
            parser.allocator,
            scope,
        ) catch unreachable;
    }

    return .{ .result = selector };
}

pub fn ValidSelectorParser(comptime T: type) type {
    ValidSelectorImpl(T.SelectorParser.Impl);

    // Whether to parse the `::slotted()` pseudo-element.
    _ = T.SelectorParser.parseSlotted;

    _ = T.SelectorParser.parsePart;

    _ = T.SelectorParser.parseIsAndWhere;

    _ = T.SelectorParser.isAndWhereErrorRecovery;

    _ = T.SelectorParser.parseAnyPrefix;

    _ = T.SelectorParser.parseHost;

    _ = T.SelectorParser.parseNonTsPseudoClass;

    _ = T.SelectorParser.parseNonTsFunctionalPseudoClass;

    _ = T.SelectorParser.parsePseudoElement;

    _ = T.SelectorParser.parseFunctionalPseudoElement;

    _ = T.SelectorParser.defaultNamespace;

    _ = T.SelectorParser.namespaceForPrefix;

    _ = T.SelectorParser.isNestingAllowed;

    _ = T.SelectorParser.deepCombinatorEnabled;
}

/// The [:dir()](https://drafts.csswg.org/selectors-4/#the-dir-pseudo) pseudo class.
pub const Direction = enum {
    /// Left to right
    ltr,
    /// Right to left
    rtl,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }
};

/// A pseudo class.
pub const PseudoClass = union(enum) {
    /// https://drafts.csswg.org/selectors-4/#linguistic-pseudos
    /// The [:lang()](https://drafts.csswg.org/selectors-4/#the-lang-pseudo) pseudo class.
    lang: struct {
        /// A list of language codes.
        languages: ArrayList([]const u8),

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The [:dir()](https://drafts.csswg.org/selectors-4/#the-dir-pseudo) pseudo class.
    dir: struct {
        /// A direction.
        direction: Direction,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },

    // https://drafts.csswg.org/selectors-4/#useraction-pseudos
    /// The [:hover](https://drafts.csswg.org/selectors-4/#the-hover-pseudo) pseudo class.
    hover,
    /// The [:active](https://drafts.csswg.org/selectors-4/#the-active-pseudo) pseudo class.
    active,
    /// The [:focus](https://drafts.csswg.org/selectors-4/#the-focus-pseudo) pseudo class.
    focus,
    /// The [:focus-visible](https://drafts.csswg.org/selectors-4/#the-focus-visible-pseudo) pseudo class.
    focus_visible,
    /// The [:focus-within](https://drafts.csswg.org/selectors-4/#the-focus-within-pseudo) pseudo class.
    focus_within,

    /// https://drafts.csswg.org/selectors-4/#time-pseudos
    /// The [:current](https://drafts.csswg.org/selectors-4/#the-current-pseudo) pseudo class.
    current,
    /// The [:past](https://drafts.csswg.org/selectors-4/#the-past-pseudo) pseudo class.
    past,
    /// The [:future](https://drafts.csswg.org/selectors-4/#the-future-pseudo) pseudo class.
    future,

    /// https://drafts.csswg.org/selectors-4/#resource-pseudos
    /// The [:playing](https://drafts.csswg.org/selectors-4/#selectordef-playing) pseudo class.
    playing,
    /// The [:paused](https://drafts.csswg.org/selectors-4/#selectordef-paused) pseudo class.
    paused,
    /// The [:seeking](https://drafts.csswg.org/selectors-4/#selectordef-seeking) pseudo class.
    seeking,
    /// The [:buffering](https://drafts.csswg.org/selectors-4/#selectordef-buffering) pseudo class.
    buffering,
    /// The [:stalled](https://drafts.csswg.org/selectors-4/#selectordef-stalled) pseudo class.
    stalled,
    /// The [:muted](https://drafts.csswg.org/selectors-4/#selectordef-muted) pseudo class.
    muted,
    /// The [:volume-locked](https://drafts.csswg.org/selectors-4/#selectordef-volume-locked) pseudo class.
    volume_locked,

    /// The [:fullscreen](https://fullscreen.spec.whatwg.org/#:fullscreen-pseudo-class) pseudo class.
    fullscreen: css.VendorPrefix,

    /// https://drafts.csswg.org/selectors/#display-state-pseudos
    /// The [:open](https://drafts.csswg.org/selectors/#selectordef-open) pseudo class.
    open,
    /// The [:closed](https://drafts.csswg.org/selectors/#selectordef-closed) pseudo class.
    closed,
    /// The [:modal](https://drafts.csswg.org/selectors/#modal-state) pseudo class.
    modal,
    /// The [:picture-in-picture](https://drafts.csswg.org/selectors/#pip-state) pseudo class.
    picture_in_picture,

    /// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open
    /// The [:popover-open](https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open) pseudo class.
    popover_open,

    /// The [:defined](https://drafts.csswg.org/selectors-4/#the-defined-pseudo) pseudo class.
    defined,

    /// https://drafts.csswg.org/selectors-4/#location
    /// The [:any-link](https://drafts.csswg.org/selectors-4/#the-any-link-pseudo) pseudo class.
    any_link: css.VendorPrefix,
    /// The [:link](https://drafts.csswg.org/selectors-4/#link-pseudo) pseudo class.
    link,
    /// The [:local-link](https://drafts.csswg.org/selectors-4/#the-local-link-pseudo) pseudo class.
    local_link,
    /// The [:target](https://drafts.csswg.org/selectors-4/#the-target-pseudo) pseudo class.
    target,
    /// The [:target-within](https://drafts.csswg.org/selectors-4/#the-target-within-pseudo) pseudo class.
    target_within,
    /// The [:visited](https://drafts.csswg.org/selectors-4/#visited-pseudo) pseudo class.
    visited,

    /// https://drafts.csswg.org/selectors-4/#input-pseudos
    /// The [:enabled](https://drafts.csswg.org/selectors-4/#enabled-pseudo) pseudo class.
    enabled,
    /// The [:disabled](https://drafts.csswg.org/selectors-4/#disabled-pseudo) pseudo class.
    disabled,
    /// The [:read-only](https://drafts.csswg.org/selectors-4/#read-only-pseudo) pseudo class.
    read_only: css.VendorPrefix,
    /// The [:read-write](https://drafts.csswg.org/selectors-4/#read-write-pseudo) pseudo class.
    read_write: css.VendorPrefix,
    /// The [:placeholder-shown](https://drafts.csswg.org/selectors-4/#placeholder) pseudo class.
    placeholder_shown: css.VendorPrefix,
    /// The [:default](https://drafts.csswg.org/selectors-4/#the-default-pseudo) pseudo class.
    default,
    /// The [:checked](https://drafts.csswg.org/selectors-4/#checked) pseudo class.
    checked,
    /// The [:indeterminate](https://drafts.csswg.org/selectors-4/#indeterminate) pseudo class.
    indeterminate,
    /// The [:blank](https://drafts.csswg.org/selectors-4/#blank) pseudo class.
    blank,
    /// The [:valid](https://drafts.csswg.org/selectors-4/#valid-pseudo) pseudo class.
    valid,
    /// The [:invalid](https://drafts.csswg.org/selectors-4/#invalid-pseudo) pseudo class.
    invalid,
    /// The [:in-range](https://drafts.csswg.org/selectors-4/#in-range-pseudo) pseudo class.
    in_range,
    /// The [:out-of-range](https://drafts.csswg.org/selectors-4/#out-of-range-pseudo) pseudo class.
    out_of_range,
    /// The [:required](https://drafts.csswg.org/selectors-4/#required-pseudo) pseudo class.
    required,
    /// The [:optional](https://drafts.csswg.org/selectors-4/#optional-pseudo) pseudo class.
    optional,
    /// The [:user-valid](https://drafts.csswg.org/selectors-4/#user-valid-pseudo) pseudo class.
    user_valid,
    /// The [:used-invalid](https://drafts.csswg.org/selectors-4/#user-invalid-pseudo) pseudo class.
    user_invalid,

    /// The [:autofill](https://html.spec.whatwg.org/multipage/semantics-other.html#selector-autofill) pseudo class.
    autofill: css.VendorPrefix,

    // CSS modules
    /// The CSS modules :local() pseudo class.
    local: struct {
        /// A local selector.
        selector: *Selector,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The CSS modules :global() pseudo class.
    global: struct {
        /// A global selector.
        selector: *Selector,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },

    /// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo class.
    // https://webkit.org/blog/363/styling-scrollbars/
    webkit_scrollbar: WebKitScrollbarPseudoClass,
    /// An unknown pseudo class.
    custom: struct {
        /// The pseudo class name.
        name: []const u8,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// An unknown functional pseudo class.
    custom_function: struct {
        /// The pseudo class name.
        name: []const u8,
        /// The arguments of the pseudo class function.
        arguments: css.TokenList,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },

    pub fn isEquivalent(this: *const PseudoClass, other: *const PseudoClass) bool {
        if (this.* == .fullscreen and other.* == .fullscreen) return true;
        if (this.* == .any_link and other.* == .any_link) return true;
        if (this.* == .read_only and other.* == .read_only) return true;
        if (this.* == .read_write and other.* == .read_write) return true;
        if (this.* == .placeholder_shown and other.* == .placeholder_shown) return true;
        if (this.* == .autofill and other.* == .autofill) return true;
        return this.eql(other);
    }

    pub fn toCss(this: *const PseudoClass, comptime W: type, dest: *Printer(W)) PrintErr!void {
        var s = ArrayList(u8){};
        // PERF(alloc): I don't like making these little allocations
        const writer = s.writer(dest.allocator);
        const W2 = @TypeOf(writer);
        const scratchbuf = std.ArrayList(u8).init(dest.allocator);
        var printer = Printer(W2).new(dest.allocator, scratchbuf, writer, css.PrinterOptions.default(), dest.import_info, dest.local_names, dest.symbols);
        try serialize.serializePseudoClass(this, W2, &printer, null);
        return dest.writeStr(s.items);
    }

    pub fn eql(lhs: *const PseudoClass, rhs: *const PseudoClass) bool {
        return css.implementEql(PseudoClass, lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn getPrefix(this: *const PseudoClass) css.VendorPrefix {
        return switch (this.*) {
            inline .fullscreen, .any_link, .read_only, .read_write, .placeholder_shown, .autofill => |p| p,
            else => css.VendorPrefix{},
        };
    }

    pub fn getNecessaryPrefixes(this: *PseudoClass, targets: css.targets.Targets) css.VendorPrefix {
        const F = css.prefixes.Feature;
        const p: *css.VendorPrefix, const feature: F = switch (this.*) {
            .fullscreen => |*p| .{ p, F.pseudo_class_fullscreen },
            .any_link => |*p| .{ p, F.pseudo_class_any_link },
            .read_only => |*p| .{ p, F.pseudo_class_read_only },
            .read_write => |*p| .{ p, F.pseudo_class_read_write },
            .placeholder_shown => |*p| .{ p, F.pseudo_class_placeholder_shown },
            .autofill => |*p| .{ p, F.pseudo_class_autofill },
            else => return css.VendorPrefix{},
        };
        p.* = targets.prefixes(p.*, feature);
        return p.*;
    }

    pub fn isUserActionState(this: *const PseudoClass) bool {
        return switch (this.*) {
            .active, .hover, .focus, .focus_within, .focus_visible => true,
            else => false,
        };
    }

    pub fn isValidBeforeWebkitScrollbar(this: *const PseudoClass) bool {
        return !switch (this.*) {
            .webkit_scrollbar => true,
            else => false,
        };
    }

    pub fn isValidAfterWebkitScrollbar(this: *const PseudoClass) bool {
        return switch (this.*) {
            .webkit_scrollbar, .enabled, .disabled, .hover, .active => true,
            else => false,
        };
    }
};

/// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo class.
pub const WebKitScrollbarPseudoClass = enum {
    /// :horizontal
    horizontal,
    /// :vertical
    vertical,
    /// :decrement
    decrement,
    /// :increment
    increment,
    /// :start
    start,
    /// :end
    end,
    /// :double-button
    double_button,
    /// :single-button
    single_button,
    /// :no-button
    no_button,
    /// :corner-present
    corner_present,
    /// :window-inactive
    window_inactive,
};

/// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo element.
pub const WebKitScrollbarPseudoElement = enum {
    /// ::-webkit-scrollbar
    scrollbar,
    /// ::-webkit-scrollbar-button
    button,
    /// ::-webkit-scrollbar-track
    track,
    /// ::-webkit-scrollbar-track-piece
    track_piece,
    /// ::-webkit-scrollbar-thumb
    thumb,
    /// ::-webkit-scrollbar-corner
    corner,
    /// ::-webkit-resizer
    resizer,

    pub inline fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return lhs.* == rhs.*;
    }
};

pub const SelectorParser = struct {
    is_nesting_allowed: bool,
    options: *const css.ParserOptions,
    allocator: Allocator,

    pub const Impl = impl.Selectors;

    pub fn newLocalIdentifier(_: *SelectorParser, input: *css.Parser, tag: css.CssRef.Tag, raw: []const u8, loc: usize) Impl.SelectorImpl.LocalIdentifier {
        if (input.flags.css_modules) {
            return Impl.SelectorImpl.LocalIdentifier.fromRef(input.addSymbolForName(raw, tag, bun.logger.Loc{
                .start = @intCast(loc),
            }), if (comptime bun.Environment.isDebug) .{ raw, input.allocator() } else {});
        }
        return Impl.SelectorImpl.LocalIdentifier.fromIdent(.{ .v = raw });
    }

    pub fn namespaceForPrefix(this: *SelectorParser, prefix: css.css_values.ident.Ident) ?[]const u8 {
        _ = this; // autofix
        return prefix.v;
    }

    pub fn parseFunctionalPseudoElement(this: *SelectorParser, name: []const u8, input: *css.Parser) Result(Impl.SelectorImpl.PseudoElement) {
        const Enum = enum {
            cue,
            @"cue-region",
            @"view-transition-group",
            @"view-transition-image-pair",
            @"view-transition-old",
            @"view-transition-new",
        };

        const Map = bun.ComptimeEnumMap(Enum);
        if (Map.get(name)) |v| {
            return switch (v) {
                .cue => .{ .result = .{ .cue_function = .{ .selector = switch (Selector.parse(this, input)) {
                    .result => |a| bun.create(input.allocator(), Selector, a),
                    .err => |e| return .{ .err = e },
                } } } },
                .@"cue-region" => .{ .result = .{ .cue_region_function = .{ .selector = switch (Selector.parse(this, input)) {
                    .result => |a| bun.create(input.allocator(), Selector, a),
                    .err => |e| return .{ .err = e },
                } } } },
                .@"view-transition-group" => .{ .result = .{ .view_transition_group = .{ .part_name = switch (ViewTransitionPartName.parse(input)) {
                    .result => |a| a,
                    .err => |e| return .{ .err = e },
                } } } },
                .@"view-transition-image-pair" => .{ .result = .{ .view_transition_image_pair = .{ .part_name = switch (ViewTransitionPartName.parse(input)) {
                    .result => |a| a,
                    .err => |e| return .{ .err = e },
                } } } },
                .@"view-transition-old" => .{ .result = .{ .view_transition_old = .{ .part_name = switch (ViewTransitionPartName.parse(input)) {
                    .result => |a| a,
                    .err => |e| return .{ .err = e },
                } } } },
                .@"view-transition-new" => .{ .result = .{ .view_transition_new = .{ .part_name = switch (ViewTransitionPartName.parse(input)) {
                    .result => |a| a,
                    .err => |e| return .{ .err = e },
                } } } },
            };
        } else {
            if (!bun.strings.startsWith(name, "-")) {
                this.options.warn(input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{
                    .unsupported_pseudo_class_or_element = name,
                })));
            }

            var args = std.ArrayListUnmanaged(css.css_properties.custom.TokenOrValue){};
            if (css.TokenList.parseRaw(input, &args, this.options, 0).asErr()) |e| return .{ .err = e };

            return .{ .result = .{ .custom_function = .{
                .name = name,
                .arguments = css.TokenList{ .v = args },
            } } };
        }
    }

    fn parseIsAndWhere(this: *const SelectorParser) bool {
        _ = this; // autofix
        return true;
    }

    /// Whether the given function name is an alias for the `:is()` function.
    fn parseAnyPrefix(_: *const SelectorParser, name: []const u8) ?css.VendorPrefix {
        const Map = comptime bun.ComptimeStringMap(css.VendorPrefix, .{
            .{ "-webkit-any", css.VendorPrefix{ .webkit = true } },
            .{ "-moz-any", css.VendorPrefix{ .moz = true } },
        });

        return Map.getAnyCase(name);
    }

    pub fn parseNonTsPseudoClass(
        this: *SelectorParser,
        loc: css.SourceLocation,
        name: []const u8,
    ) Result(PseudoClass) {
        // @compileError(css.todo_stuff.match_ignore_ascii_case);
        const pseudo_class: PseudoClass = pseudo_class: {
            const Map = comptime bun.ComptimeStringMap(PseudoClass, .{
                // https://drafts.csswg.org/selectors-4/#useraction-pseudos
                .{ "hover", PseudoClass{ .hover = {} } },
                .{ "active", PseudoClass{ .active = {} } },
                .{ "focus", PseudoClass{ .focus = {} } },
                .{ "focus-visible", PseudoClass{ .focus_visible = {} } },
                .{ "focus-within", PseudoClass{ .focus_within = {} } },

                // https://drafts.csswg.org/selectors-4/#time-pseudos
                .{ "current", PseudoClass{ .current = {} } },
                .{ "past", PseudoClass{ .past = {} } },
                .{ "future", PseudoClass{ .future = {} } },

                // https://drafts.csswg.org/selectors-4/#resource-pseudos
                .{ "playing", PseudoClass{ .playing = {} } },
                .{ "paused", PseudoClass{ .paused = {} } },
                .{ "seeking", PseudoClass{ .seeking = {} } },
                .{ "buffering", PseudoClass{ .buffering = {} } },
                .{ "stalled", PseudoClass{ .stalled = {} } },
                .{ "muted", PseudoClass{ .muted = {} } },
                .{ "volume-locked", PseudoClass{ .volume_locked = {} } },

                // https://fullscreen.spec.whatwg.org/#:fullscreen-pseudo-class
                .{ "fullscreen", PseudoClass{ .fullscreen = css.VendorPrefix{ .none = true } } },
                .{ "-webkit-full-screen", PseudoClass{ .fullscreen = css.VendorPrefix{ .webkit = true } } },
                .{ "-moz-full-screen", PseudoClass{ .fullscreen = css.VendorPrefix{ .moz = true } } },
                .{ "-ms-fullscreen", PseudoClass{ .fullscreen = css.VendorPrefix{ .ms = true } } },

                // https://drafts.csswg.org/selectors/#display-state-pseudos
                .{ "open", PseudoClass{ .open = {} } },
                .{ "closed", PseudoClass{ .closed = {} } },
                .{ "modal", PseudoClass{ .modal = {} } },
                .{ "picture-in-picture", PseudoClass{ .picture_in_picture = {} } },

                // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open
                .{ "popover-open", PseudoClass{ .popover_open = {} } },

                // https://drafts.csswg.org/selectors-4/#the-defined-pseudo
                .{ "defined", PseudoClass{ .defined = {} } },

                // https://drafts.csswg.org/selectors-4/#location
                .{ "any-link", PseudoClass{ .any_link = css.VendorPrefix{ .none = true } } },
                .{ "-webkit-any-link", PseudoClass{ .any_link = css.VendorPrefix{ .webkit = true } } },
                .{ "-moz-any-link", PseudoClass{ .any_link = css.VendorPrefix{ .moz = true } } },
                .{ "link", PseudoClass{ .link = {} } },
                .{ "local-link", PseudoClass{ .local_link = {} } },
                .{ "target", PseudoClass{ .target = {} } },
                .{ "target-within", PseudoClass{ .target_within = {} } },
                .{ "visited", PseudoClass{ .visited = {} } },

                // https://drafts.csswg.org/selectors-4/#input-pseudos
                .{ "enabled", PseudoClass{ .enabled = {} } },
                .{ "disabled", PseudoClass{ .disabled = {} } },
                .{ "read-only", PseudoClass{ .read_only = css.VendorPrefix{ .none = true } } },
                .{ "-moz-read-only", PseudoClass{ .read_only = css.VendorPrefix{ .moz = true } } },
                .{ "read-write", PseudoClass{ .read_write = css.VendorPrefix{ .none = true } } },
                .{ "-moz-read-write", PseudoClass{ .read_write = css.VendorPrefix{ .moz = true } } },
                .{ "placeholder-shown", PseudoClass{ .placeholder_shown = css.VendorPrefix{ .none = true } } },
                .{ "-moz-placeholder-shown", PseudoClass{ .placeholder_shown = css.VendorPrefix{ .moz = true } } },
                .{ "-ms-placeholder-shown", PseudoClass{ .placeholder_shown = css.VendorPrefix{ .ms = true } } },
                .{ "default", PseudoClass{ .default = {} } },
                .{ "checked", PseudoClass{ .checked = {} } },
                .{ "indeterminate", PseudoClass{ .indeterminate = {} } },
                .{ "blank", PseudoClass{ .blank = {} } },
                .{ "valid", PseudoClass{ .valid = {} } },
                .{ "invalid", PseudoClass{ .invalid = {} } },
                .{ "in-range", PseudoClass{ .in_range = {} } },
                .{ "out-of-range", PseudoClass{ .out_of_range = {} } },
                .{ "required", PseudoClass{ .required = {} } },
                .{ "optional", PseudoClass{ .optional = {} } },
                .{ "user-valid", PseudoClass{ .user_valid = {} } },
                .{ "user-invalid", PseudoClass{ .user_invalid = {} } },

                // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-autofill
                .{ "autofill", PseudoClass{ .autofill = css.VendorPrefix{ .none = true } } },
                .{ "-webkit-autofill", PseudoClass{ .autofill = css.VendorPrefix{ .webkit = true } } },
                .{ "-o-autofill", PseudoClass{ .autofill = css.VendorPrefix{ .o = true } } },

                // https://webkit.org/blog/363/styling-scrollbars/
                .{ "horizontal", PseudoClass{ .webkit_scrollbar = .horizontal } },
                .{ "vertical", PseudoClass{ .webkit_scrollbar = .vertical } },
                .{ "decrement", PseudoClass{ .webkit_scrollbar = .decrement } },
                .{ "increment", PseudoClass{ .webkit_scrollbar = .increment } },
                .{ "start", PseudoClass{ .webkit_scrollbar = .start } },
                .{ "end", PseudoClass{ .webkit_scrollbar = .end } },
                .{ "double-button", PseudoClass{ .webkit_scrollbar = .double_button } },
                .{ "single-button", PseudoClass{ .webkit_scrollbar = .single_button } },
                .{ "no-button", PseudoClass{ .webkit_scrollbar = .no_button } },
                .{ "corner-present", PseudoClass{ .webkit_scrollbar = .corner_present } },
                .{ "window-inactive", PseudoClass{ .webkit_scrollbar = .window_inactive } },
            });

            if (Map.getAnyCase(name)) |pseudo| {
                break :pseudo_class pseudo;
            } else {
                if (bun.strings.startsWithChar(name, '_')) {
                    this.options.warn(loc.newCustomError(SelectorParseErrorKind{ .unsupported_pseudo_class_or_element = name }));
                } else if (this.options.css_modules != null and bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "local") or bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "global")) {
                    return .{ .err = loc.newCustomError(SelectorParseErrorKind{ .ambiguous_css_module_class = name }) };
                }
                return .{ .result = PseudoClass{ .custom = .{ .name = name } } };
            }
        };

        return .{ .result = pseudo_class };
    }

    pub fn parseHost(_: *SelectorParser) bool {
        return true;
    }

    pub fn parseNonTsFunctionalPseudoClass(
        this: *SelectorParser,
        name: []const u8,
        parser: *css.Parser,
    ) Result(PseudoClass) {

        // todo_stuff.match_ignore_ascii_case
        const pseudo_class = pseudo_class: {
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "lang")) {
                const languages = switch (parser.parseCommaSeparated([]const u8, css.Parser.expectIdentOrString)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                return .{ .result = PseudoClass{
                    .lang = .{ .languages = languages },
                } };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "dir")) {
                break :pseudo_class PseudoClass{
                    .dir = .{
                        .direction = switch (Direction.parse(parser)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        },
                    },
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "local") and this.options.css_modules != null) {
                break :pseudo_class PseudoClass{
                    .local = .{
                        .selector = brk: {
                            const selector = switch (Selector.parse(this, parser)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };

                            break :brk bun.create(this.allocator, Selector, selector);
                        },
                    },
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "global") and this.options.css_modules != null) {
                break :pseudo_class PseudoClass{
                    .global = .{
                        .selector = brk: {
                            const selector = switch (Selector.parse(this, parser)) {
                                .err => |e| return .{ .err = e },
                                .result => |v| v,
                            };

                            break :brk bun.create(this.allocator, Selector, selector);
                        },
                    },
                };
            } else {
                if (!bun.strings.startsWithChar(name, '-')) {
                    this.options.warn(parser.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unsupported_pseudo_class_or_element = name })));
                }
                var args = ArrayList(css.css_properties.custom.TokenOrValue){};
                _ = switch (css.TokenListFns.parseRaw(parser, &args, this.options, 0)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                break :pseudo_class PseudoClass{
                    .custom_function = .{
                        .name = name,
                        .arguments = css.TokenList{ .v = args },
                    },
                };
            }
        };

        return .{ .result = pseudo_class };
    }

    pub fn isNestingAllowed(this: *SelectorParser) bool {
        return this.is_nesting_allowed;
    }

    pub fn deepCombinatorEnabled(this: *SelectorParser) bool {
        return this.options.flags.deep_selector_combinator;
    }

    pub fn defaultNamespace(this: *SelectorParser) ?impl.Selectors.SelectorImpl.NamespaceUrl {
        _ = this; // autofix
        return null;
    }

    pub fn parsePart(this: *SelectorParser) bool {
        _ = this; // autofix
        return true;
    }

    pub fn parseSlotted(this: *SelectorParser) bool {
        _ = this; // autofix
        return true;
    }

    /// The error recovery that selector lists inside :is() and :where() have.
    fn isAndWhereErrorRecovery(this: *SelectorParser) ParseErrorRecovery {
        _ = this; // autofix
        return .ignore_invalid_selector;
    }

    pub fn parsePseudoElement(this: *SelectorParser, loc: css.SourceLocation, name: []const u8) Result(PseudoElement) {
        const Map = comptime bun.ComptimeStringMap(PseudoElement, .{
            .{ "before", PseudoElement.before },
            .{ "after", PseudoElement.after },
            .{ "first-line", PseudoElement.first_line },
            .{ "first-letter", PseudoElement.first_letter },
            .{ "cue", PseudoElement.cue },
            .{ "cue-region", PseudoElement.cue_region },
            .{ "selection", PseudoElement{ .selection = css.VendorPrefix{ .none = true } } },
            .{ "-moz-selection", PseudoElement{ .selection = css.VendorPrefix{ .moz = true } } },
            .{ "placeholder", PseudoElement{ .placeholder = css.VendorPrefix{ .none = true } } },
            .{ "-webkit-input-placeholder", PseudoElement{ .placeholder = css.VendorPrefix{ .webkit = true } } },
            .{ "-moz-placeholder", PseudoElement{ .placeholder = css.VendorPrefix{ .moz = true } } },
            .{ "-ms-input-placeholder", PseudoElement{ .placeholder = css.VendorPrefix{ .ms = true } } },
            .{ "marker", PseudoElement.marker },
            .{ "backdrop", PseudoElement{ .backdrop = css.VendorPrefix{ .none = true } } },
            .{ "-webkit-backdrop", PseudoElement{ .backdrop = css.VendorPrefix{ .webkit = true } } },
            .{ "file-selector-button", PseudoElement{ .file_selector_button = css.VendorPrefix{ .none = true } } },
            .{ "-webkit-file-upload-button", PseudoElement{ .file_selector_button = css.VendorPrefix{ .webkit = true } } },
            .{ "-ms-browse", PseudoElement{ .file_selector_button = css.VendorPrefix{ .ms = true } } },
            .{ "-webkit-scrollbar", PseudoElement{ .webkit_scrollbar = .scrollbar } },
            .{ "-webkit-scrollbar-button", PseudoElement{ .webkit_scrollbar = .button } },
            .{ "-webkit-scrollbar-track", PseudoElement{ .webkit_scrollbar = .track } },
            .{ "-webkit-scrollbar-track-piece", PseudoElement{ .webkit_scrollbar = .track_piece } },
            .{ "-webkit-scrollbar-thumb", PseudoElement{ .webkit_scrollbar = .thumb } },
            .{ "-webkit-scrollbar-corner", PseudoElement{ .webkit_scrollbar = .corner } },
            .{ "-webkit-resizer", PseudoElement{ .webkit_scrollbar = .resizer } },
            .{ "view-transition", PseudoElement.view_transition },
        });

        const pseudo_element = Map.getCaseInsensitiveWithEql(name, bun.strings.eqlComptimeIgnoreLen) orelse brk: {
            if (!bun.strings.startsWithChar(name, '-')) {
                this.options.warn(loc.newCustomError(SelectorParseErrorKind{ .unsupported_pseudo_class_or_element = name }));
            }
            break :brk PseudoElement{ .custom = .{ .name = name } };
        };

        return .{ .result = pseudo_element };
    }
};

pub fn GenericSelectorList(comptime Impl: type) type {
    ValidSelectorImpl(Impl);

    const SelectorT = GenericSelector(Impl);
    return struct {
        // PERF: make this equivalent to SmallVec<[Selector; 1]>
        v: css.SmallList(SelectorT, 1) = .{},

        const This = @This();

        const DebugFmt = struct {
            this: *const This,

            pub fn format(this: @This(), comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
                if (comptime !bun.Environment.isDebug) return;
                _ = fmt; // autofix
                _ = options; // autofix
                try writer.print("SelectorList[\n", .{});
                const last = this.this.v.len() -| 1;
                for (this.this.v.slice(), 0..) |*sel, i| {
                    if (i != last) {
                        try writer.print(" {}\n", .{sel.debug()});
                    } else {
                        try writer.print(" {},\n", .{sel.debug()});
                    }
                }
                try writer.print("]\n", .{});
            }
        };

        pub fn debug(this: *const @This()) DebugFmt {
            return DebugFmt{ .this = this };
        }

        pub fn anyHasPseudoElement(this: *const This) bool {
            for (this.v.slice()) |*sel| {
                if (sel.hasPseudoElement()) return true;
            }
            return false;
        }

        pub fn specifitiesAllEqual(this: *const This) bool {
            if (this.v.len() == 0) return true;
            if (this.v.len() == 1) return true;

            const value = this.v.at(0).specificity();
            for (this.v.slice()[1..]) |*sel| {
                if (sel.specificity() != value) return false;
            }
            return true;
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError("Do not call this! Use `serializer.serializeSelectorList()` or `tocss_servo.toCss_SelectorList()` instead.");
        }

        pub fn parseWithOptions(input: *css.Parser, options: *const css.ParserOptions) Result(This) {
            var parser = SelectorParser{
                .options = options,
                .is_nesting_allowed = true,
            };
            return parse(&parser, input, .discard_list, .none);
        }

        pub fn parse(
            parser: *SelectorParser,
            input: *css.Parser,
            error_recovery: ParseErrorRecovery,
            nesting_requirement: NestingRequirement,
        ) Result(This) {
            var state = SelectorParsingState{};
            return parseWithState(parser, input, &state, error_recovery, nesting_requirement);
        }

        pub fn parseRelative(
            parser: *SelectorParser,
            input: *css.Parser,
            error_recovery: ParseErrorRecovery,
            nesting_requirement: NestingRequirement,
        ) Result(This) {
            var state = SelectorParsingState{};
            return parseRelativeWithState(parser, input, &state, error_recovery, nesting_requirement);
        }

        pub fn parseWithState(
            parser: *SelectorParser,
            input: *css.Parser,
            state: *SelectorParsingState,
            recovery: ParseErrorRecovery,
            nesting_requirement: NestingRequirement,
        ) Result(This) {
            const original_state = state.*;
            // TODO: Think about deinitialization in error cases
            var values = SmallList(SelectorT, 1){};

            while (true) {
                const Closure = struct {
                    outer_state: *SelectorParsingState,
                    original_state: SelectorParsingState,
                    nesting_requirement: NestingRequirement,
                    parser: *SelectorParser,

                    pub fn parsefn(this: *@This(), input2: *css.Parser) Result(SelectorT) {
                        var selector_state = this.original_state;
                        const result = parse_selector(Impl, this.parser, input2, &selector_state, this.nesting_requirement);
                        if (selector_state.after_nesting) {
                            this.outer_state.after_nesting = true;
                        }
                        return result;
                    }
                };
                var closure = Closure{
                    .outer_state = state,
                    .original_state = original_state,
                    .nesting_requirement = nesting_requirement,
                    .parser = parser,
                };
                const selector = input.parseUntilBefore(css.Delimiters{ .comma = true }, SelectorT, &closure, Closure.parsefn);

                const was_ok = selector.isOk();
                switch (selector) {
                    .result => |sel| {
                        values.append(input.allocator(), sel);
                    },
                    .err => |e| {
                        switch (recovery) {
                            .discard_list => return .{ .err = e },
                            .ignore_invalid_selector => {},
                        }
                    },
                }

                while (true) {
                    if (input.next().asValue()) |tok| {
                        if (tok.* == .comma) break;
                        // Shouldn't have got a selector if getting here.
                        bun.debugAssert(!was_ok);
                    }
                    return .{ .result = .{ .v = values } };
                }
            }
        }

        // TODO: this looks exactly the same as `parseWithState()` except it uses `parse_relative_selector()` instead of `parse_selector()`
        pub fn parseRelativeWithState(
            parser: *SelectorParser,
            input: *css.Parser,
            state: *SelectorParsingState,
            recovery: ParseErrorRecovery,
            nesting_requirement: NestingRequirement,
        ) Result(This) {
            const original_state = state.*;
            // TODO: Think about deinitialization in error cases
            var values = SmallList(SelectorT, 1){};

            while (true) {
                const Closure = struct {
                    outer_state: *SelectorParsingState,
                    original_state: SelectorParsingState,
                    nesting_requirement: NestingRequirement,
                    parser: *SelectorParser,

                    pub fn parsefn(this: *@This(), input2: *css.Parser) Result(SelectorT) {
                        var selector_state = this.original_state;
                        const result = parse_relative_selector(Impl, this.parser, input2, &selector_state, this.nesting_requirement);
                        if (selector_state.after_nesting) {
                            this.outer_state.after_nesting = true;
                        }
                        return result;
                    }
                };
                var closure = Closure{
                    .outer_state = state,
                    .original_state = original_state,
                    .nesting_requirement = nesting_requirement,
                    .parser = parser,
                };
                const selector = input.parseUntilBefore(css.Delimiters{ .comma = true }, SelectorT, &closure, Closure.parsefn);

                const was_ok = selector.isOk();
                switch (selector) {
                    .result => |sel| {
                        values.append(input.allocator(), sel);
                    },
                    .err => |e| {
                        switch (recovery) {
                            .discard_list => return .{ .err = e },
                            .ignore_invalid_selector => {},
                        }
                    },
                }

                while (true) {
                    if (input.next().asValue()) |tok| {
                        if (tok.* == .comma) break;
                        // Shouldn't have got a selector if getting here.
                        bun.debugAssert(!was_ok);
                    }
                    return .{ .result = .{ .v = values } };
                }
            }
        }

        pub fn fromSelector(allocator: Allocator, selector: GenericSelector(Impl)) This {
            var result = This{};
            result.v.append(allocator, selector);
            return result;
        }

        pub fn deepClone(this: *const @This(), allocator: Allocator) This {
            return .{ .v = this.v.deepClone(allocator) };
        }

        pub fn eql(lhs: *const This, rhs: *const This) bool {
            return lhs.v.eql(&rhs.v);
        }

        pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
            return css.implementHash(@This(), this, hasher);
        }
    };
}

/// -- original comment from servo --
/// A Selector stores a sequence of simple selectors and combinators. The
/// iterator classes allow callers to iterate at either the raw sequence level or
/// at the level of sequences of simple selectors separated by combinators. Most
/// callers want the higher-level iterator.
///
/// We store compound selectors internally right-to-left (in matching order).
/// Additionally, we invert the order of top-level compound selectors so that
/// each one matches left-to-right. This is because matching namespace, local name,
/// id, and class are all relatively cheap, whereas matching pseudo-classes might
/// be expensive (depending on the pseudo-class). Since authors tend to put the
/// pseudo-classes on the right, it's faster to start matching on the left.
///
/// This reordering doesn't change the semantics of selector matching, and we
/// handle it in to_css to make it invisible to serialization.
pub fn GenericSelector(comptime Impl: type) type {
    ValidSelectorImpl(Impl);

    return struct {
        specificity_and_flags: SpecificityAndFlags,
        components: ArrayList(GenericComponent(Impl)),

        const This = @This();

        const DebugFmt = struct {
            this: *const This,

            pub fn format(this: @This(), comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
                if (comptime !bun.Environment.isDebug) return;
                _ = fmt; // autofix
                _ = options; // autofix
                try writer.print("Selector(", .{});
                var arraylist = ArrayList(u8){};
                const w = arraylist.writer(bun.default_allocator);
                defer arraylist.deinit(bun.default_allocator);
                const symbols = bun.JSAst.Symbol.Map{};
                const P = css.Printer(@TypeOf(w));
                var printer = P.new(bun.default_allocator, std.ArrayList(u8).init(bun.default_allocator), w, css.PrinterOptions.default(), null, null, &symbols);
                defer printer.deinit();
                P.in_debug_fmt = true;
                defer P.in_debug_fmt = false;

                css.selector.tocss_servo.toCss_Selector(this.this, @TypeOf(w), &printer) catch |e| return try writer.print("<error writing selector: {s}>\n", .{@errorName(e)});
                try writer.writeAll(arraylist.items);
            }
        };

        pub fn debug(this: *const This) DebugFmt {
            return DebugFmt{ .this = this };
        }

        /// Parse a selector, without any pseudo-element.
        pub fn parse(parser: *SelectorParser, input: *css.Parser) Result(This) {
            var state = SelectorParsingState{};
            return parse_selector(Impl, parser, input, &state, .none);
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError("Do not call this! Use `serializer.serializeSelector()` or `tocss_servo.toCss_Selector()` instead.");
        }

        pub fn append(this: *This, allocator: Allocator, component: GenericComponent(Impl)) void {
            const index = index: {
                for (this.components.items, 0..) |*comp, i| {
                    switch (comp.*) {
                        .combinator, .pseudo_element => break :index i,
                        else => {},
                    }
                }
                break :index this.components.items.len;
            };
            this.components.insert(allocator, index, component) catch bun.outOfMemory();
        }

        pub fn deepClone(this: *const @This(), allocator: Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const This, other: *const This) bool {
            return css.implementEql(This, this, other);
        }

        pub fn hasCombinator(this: *const This) bool {
            for (this.components.items) |*c| {
                if (c.* == .combinator and c.combinator.isTreeCombinator()) return true;
            }
            return false;
        }

        pub fn hasPseudoElement(this: *const This) bool {
            return this.specificity_and_flags.hasPseudoElement();
        }

        /// Returns count of simple selectors and combinators in the Selector.
        pub fn len(this: *const This) usize {
            return this.components.items.len;
        }

        pub fn fromComponent(allocator: Allocator, component: GenericComponent(Impl)) This {
            var builder = SelectorBuilder(Impl).init(allocator);
            if (component.asCombinator()) |combinator| {
                builder.pushCombinator(combinator);
            } else {
                builder.pushSimpleSelector(component);
            }
            const result = builder.build(false, false, false);
            return This{
                .specificity_and_flags = result.specificity_and_flags,
                .components = result.components,
            };
        }

        pub fn specificity(this: *const This) u32 {
            return this.specificity_and_flags.specificity;
        }

        pub fn parseWithOptions(input: *css.Parser, options: *const css.ParserOptions) Result(This) {
            var selector_parser = SelectorParser{
                .is_nesting_allowed = true,
                .options = options,
            };
            return parse(&selector_parser, input);
        }

        /// Returns an iterator over the sequence of simple selectors and
        /// combinators, in parse order (from left to right), starting from
        /// `offset`.
        pub fn iterRawParseOrderFrom(this: *const This, offset: usize) RawParseOrderFromIter {
            return RawParseOrderFromIter{
                .slice = this.components.items[0 .. this.components.items.len - offset],
            };
        }

        const RawParseOrderFromIter = struct {
            slice: []const GenericComponent(Impl),
            i: usize = 0,

            pub fn next(this: *@This()) ?GenericComponent(Impl) {
                if (!(this.i < this.slice.len)) return null;
                const result = this.slice[this.slice.len - 1 - this.i];
                this.i += 1;
                return result;
            }
        };

        pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
            return css.implementHash(@This(), this, hasher);
        }
    };
}

/// A CSS simple selector or combinator. We store both in the same enum for
/// optimal packing and cache performance, see [1].
///
/// [1] https://bugzilla.mozilla.org/show_bug.cgi?id=1357973
pub fn GenericComponent(comptime Impl: type) type {
    ValidSelectorImpl(Impl);

    return union(enum) {
        combinator: Combinator,

        explicit_any_namespace,
        explicit_no_namespace,
        default_namespace: Impl.SelectorImpl.NamespaceUrl,
        namespace: struct {
            prefix: Impl.SelectorImpl.NamespacePrefix,
            url: Impl.SelectorImpl.NamespaceUrl,

            pub fn __generateEql() void {}
            pub fn __generateDeepClone() void {}
            pub fn __generateHash() void {}
        },

        explicit_universal_type,
        local_name: LocalName(Impl),

        id: Impl.SelectorImpl.LocalIdentifier,
        class: Impl.SelectorImpl.LocalIdentifier,

        attribute_in_no_namespace_exists: struct {
            local_name: Impl.SelectorImpl.LocalName,
            local_name_lower: Impl.SelectorImpl.LocalName,

            pub fn __generateEql() void {}
            pub fn __generateDeepClone() void {}
            pub fn __generateHash() void {}
        },
        /// Used only when local_name is already lowercase.
        attribute_in_no_namespace: struct {
            local_name: Impl.SelectorImpl.LocalName,
            operator: attrs.AttrSelectorOperator,
            value: Impl.SelectorImpl.AttrValue,
            case_sensitivity: attrs.ParsedCaseSensitivity,
            never_matches: bool,

            pub fn __generateEql() void {}
            pub fn __generateDeepClone() void {}
            pub fn __generateHash() void {}
        },
        /// Use a Box in the less common cases with more data to keep size_of::<Component>() small.
        attribute_other: *attrs.AttrSelectorWithOptionalNamespace(Impl),

        /// Pseudo-classes
        negation: []GenericSelector(Impl),
        root,
        empty,
        scope,
        nth: NthSelectorData,
        nth_of: NthOfSelectorData(Impl),
        non_ts_pseudo_class: Impl.SelectorImpl.NonTSPseudoClass,
        /// The ::slotted() pseudo-element:
        ///
        /// https://drafts.csswg.org/css-scoping/#slotted-pseudo
        ///
        /// The selector here is a compound selector, that is, no combinators.
        ///
        /// NOTE(emilio): This should support a list of selectors, but as of this
        /// writing no other browser does, and that allows them to put ::slotted()
        /// in the rule hash, so we do that too.
        ///
        /// See https://github.com/w3c/csswg-drafts/issues/2158
        slotted: GenericSelector(Impl),
        /// The `::part` pseudo-element.
        ///   https://drafts.csswg.org/css-shadow-parts/#part
        part: []Impl.SelectorImpl.Identifier,
        /// The `:host` pseudo-class:
        ///
        /// https://drafts.csswg.org/css-scoping/#host-selector
        ///
        /// NOTE(emilio): This should support a list of selectors, but as of this
        /// writing no other browser does, and that allows them to put :host()
        /// in the rule hash, so we do that too.
        ///
        /// See https://github.com/w3c/csswg-drafts/issues/2158
        host: ?GenericSelector(Impl),
        /// The `:where` pseudo-class.
        ///
        /// https://drafts.csswg.org/selectors/#zero-matches
        ///
        /// The inner argument is conceptually a SelectorList, but we move the
        /// selectors to the heap to keep Component small.
        where: []GenericSelector(Impl),
        /// The `:is` pseudo-class.
        ///
        /// https://drafts.csswg.org/selectors/#matches-pseudo
        ///
        /// Same comment as above re. the argument.
        is: []GenericSelector(Impl),
        any: struct {
            vendor_prefix: Impl.SelectorImpl.VendorPrefix,
            selectors: []GenericSelector(Impl),

            pub fn __generateEql() void {}
            pub fn __generateDeepClone() void {}
            pub fn __generateHash() void {}
        },
        /// The `:has` pseudo-class.
        ///
        /// https://www.w3.org/TR/selectors/#relational
        has: []GenericSelector(Impl),
        /// An implementation-dependent pseudo-element selector.
        pseudo_element: Impl.SelectorImpl.PseudoElement,
        /// A nesting selector:
        ///
        /// https://drafts.csswg.org/css-nesting-1/#nest-selector
        ///
        /// NOTE: This is a lightningcss addition.
        nesting,

        const This = @This();

        /// If css mdules is enabled these will be locally scoped
        pub fn isLocallyScoped(this: *const @This()) bool {
            return switch (this.*) {
                .id, .class => true,
                else => false,
            };
        }

        pub fn asClass(this: *const @This()) ?Impl.SelectorImpl.LocalIdentifier {
            return switch (this.*) {
                inline .class => |v| v,
                else => null,
            };
        }

        pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(lhs: *const This, rhs: *const This) bool {
            return css.implementEql(This, lhs, rhs);
        }

        pub fn format(this: *const This, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            switch (this.*) {
                .local_name => return try writer.print("local_name={s}", .{this.local_name.name.v}),
                .combinator => return try writer.print("combinator='{}'", .{this.combinator}),
                .pseudo_element => return try writer.print("pseudo_element={}", .{this.pseudo_element}),
                .class => return try writer.print("class={}", .{this.class}),
                else => {},
            }
            return writer.print("{s}", .{@tagName(this.*)});
        }

        pub fn asCombinator(this: *const This) ?Combinator {
            if (this.* == .combinator) return this.combinator;
            return null;
        }

        pub fn convertHelper_is(s: []GenericSelector(Impl)) This {
            return .{ .is = s };
        }

        pub fn convertHelper_where(s: []GenericSelector(Impl)) This {
            return .{ .where = s };
        }

        pub fn convertHelper_any(s: []GenericSelector(Impl), prefix: Impl.SelectorImpl.VendorPrefix) This {
            return .{
                .any = .{
                    .vendor_prefix = prefix,
                    .selectors = s,
                },
            };
        }

        /// Returns true if this is a combinator.
        pub fn isCombinator(this: *const This) bool {
            return this.* == .combinator;
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError("Do not call this! Use `serializer.serializeComponent()` or `tocss_servo.toCss_Component()` instead.");
        }

        pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
            return css.implementHash(@This(), this, hasher);
        }
    };
}

/// The properties that comprise an :nth- pseudoclass as of Selectors 3 (e.g.,
/// nth-child(An+B)).
/// https://www.w3.org/TR/selectors-3/#nth-child-pseudo
pub const NthSelectorData = struct {
    ty: NthType,
    is_function: bool,
    a: i32,
    b: i32,

    /// Returns selector data for :only-{child,of-type}
    pub fn only(of_type: bool) NthSelectorData {
        return NthSelectorData{
            .ty = if (of_type) NthType.only_of_type else NthType.only_child,
            .is_function = false,
            .a = 0,
            .b = 1,
        };
    }

    /// Returns selector data for :first-{child,of-type}
    pub fn first(of_type: bool) NthSelectorData {
        return NthSelectorData{
            .ty = if (of_type) NthType.of_type else NthType.child,
            .is_function = false,
            .a = 0,
            .b = 1,
        };
    }

    /// Returns selector data for :last-{child,of-type}
    pub fn last(of_type: bool) NthSelectorData {
        return NthSelectorData{
            .ty = if (of_type) NthType.last_of_type else NthType.last_child,
            .is_function = false,
            .a = 0,
            .b = 1,
        };
    }

    pub fn writeStart(this: *const @This(), comptime W: type, dest: *Printer(W), is_function: bool) PrintErr!void {
        try dest.writeStr(switch (this.ty) {
            .child => if (is_function) ":nth-child(" else ":first-child",
            .last_child => if (is_function) ":nth-last-child(" else ":last-child",
            .of_type => if (is_function) ":nth-of-type(" else ":first-of-type",
            .last_of_type => if (is_function) ":nth-last-of-type(" else ":last-of-type",
            .only_child => ":only-child",
            .only_of_type => ":only-of-type",
            .col => ":nth-col(",
            .last_col => ":nth-last-col(",
        });
    }

    pub fn isFunction(this: *const @This()) bool {
        return this.a != 0 or this.b != 1;
    }

    fn numberSign(num: i32) []const u8 {
        if (num >= 0) return "+";
        return "";
    }

    pub fn writeAffine(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        // PERF: this could be made faster
        if (this.a == 0 and this.b == 0) {
            try dest.writeChar('0');
        } else if (this.a == 1 and this.b == 0) {
            try dest.writeChar('n');
        } else if (this.a == -1 and this.b == 0) {
            try dest.writeStr("-n");
        } else if (this.b == 0) {
            try dest.writeFmt("{d}n", .{this.a});
        } else if (this.a == 2 and this.b == 1) {
            try dest.writeStr("odd");
        } else if (this.a == 0) {
            try dest.writeFmt("{d}", .{this.b});
        } else if (this.a == 1) {
            try dest.writeFmt("n{s}{d}", .{ numberSign(this.b), this.b });
        } else if (this.a == -1) {
            try dest.writeFmt("-n{s}{d}", .{ numberSign(this.b), this.b });
        } else {
            try dest.writeFmt("{}n{s}{d}", .{ this.a, numberSign(this.b), this.b });
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

/// The properties that comprise an :nth- pseudoclass as of Selectors 4 (e.g.,
/// nth-child(An+B [of S]?)).
/// https://www.w3.org/TR/selectors-4/#nth-child-pseudo
pub fn NthOfSelectorData(comptime Impl: type) type {
    return struct {
        data: NthSelectorData,
        selectors: []GenericSelector(Impl),

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
            return css.implementHash(@This(), this, hasher);
        }

        pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn nthData(this: *const @This()) NthSelectorData {
            return this.data;
        }
    };
}

pub const SelectorParsingState = packed struct(u16) {
    /// Whether we should avoid adding default namespaces to selectors that
    /// aren't type or universal selectors.
    skip_default_namespace: bool = false,

    /// Whether we've parsed a ::slotted() pseudo-element already.
    ///
    /// If so, then we can only parse a subset of pseudo-elements, and
    /// whatever comes after them if so.
    after_slotted: bool = false,

    /// Whether we've parsed a ::part() pseudo-element already.
    ///
    /// If so, then we can only parse a subset of pseudo-elements, and
    /// whatever comes after them if so.
    after_part: bool = false,

    /// Whether we've parsed a pseudo-element (as in, an
    /// `Impl::PseudoElement` thus not accounting for `::slotted` or
    /// `::part`) already.
    ///
    /// If so, then other pseudo-elements and most other selectors are
    /// disallowed.
    after_pseudo_element: bool = false,

    /// Whether we've parsed a non-stateful pseudo-element (again, as-in
    /// `Impl::PseudoElement`) already. If so, then other pseudo-classes are
    /// disallowed. If this flag is set, `AFTER_PSEUDO_ELEMENT` must be set
    /// as well.
    after_non_stateful_pseudo_element: bool = false,

    /// Whether we explicitly disallow combinators.
    disallow_combinators: bool = false,

    /// Whether we explicitly disallow pseudo-element-like things.
    disallow_pseudos: bool = false,

    /// Whether we have seen a nesting selector.
    after_nesting: bool = false,

    after_webkit_scrollbar: bool = false,
    after_view_transition: bool = false,
    after_unknown_pseudo_element: bool = false,
    __unused: u5 = 0,

    /// Whether we are after any of the pseudo-like things.
    pub fn afterAnyPseudo(state: SelectorParsingState) bool {
        return state.after_part or state.after_slotted or state.after_pseudo_element;
    }

    pub fn allowsPseudos(this: SelectorParsingState) bool {
        return !this.after_pseudo_element and !this.disallow_pseudos;
    }

    pub fn allowsPart(this: SelectorParsingState) bool {
        return !this.disallow_pseudos and !this.afterAnyPseudo();
    }

    pub fn allowsSlotted(this: SelectorParsingState) bool {
        return this.allowsPart();
    }

    pub fn allowsTreeStructuralPseudoClasses(this: SelectorParsingState) bool {
        return !this.afterAnyPseudo();
    }

    pub fn allowsNonFunctionalPseudoClasses(this: SelectorParsingState) bool {
        return !this.after_slotted and !this.after_non_stateful_pseudo_element;
    }

    pub fn allowsCombinators(this: SelectorParsingState) bool {
        return !this.disallow_combinators;
    }

    pub fn allowsCustomFunctionalPseudoClasses(this: SelectorParsingState) bool {
        return !this.afterAnyPseudo();
    }
};

pub const SpecificityAndFlags = struct {
    /// There are two free bits here, since we use ten bits for each specificity
    /// kind (id, class, element).
    specificity: u32,
    /// There's padding after this field due to the size of the flags.
    flags: SelectorFlags,

    pub fn eql(this: *const SpecificityAndFlags, other: *const SpecificityAndFlags) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn hasPseudoElement(this: *const SpecificityAndFlags) bool {
        return this.flags.has_pseudo;
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const SelectorFlags = packed struct(u8) {
    has_pseudo: bool = false,
    has_slotted: bool = false,
    has_part: bool = false,
    __unused: u5 = 0,
};

/// How to treat invalid selectors in a selector list.
pub const ParseErrorRecovery = enum {
    /// Discard the entire selector list, this is the default behavior for
    /// almost all of CSS.
    discard_list,
    /// Ignore invalid selectors, potentially creating an empty selector list.
    ///
    /// This is the error recovery mode of :is() and :where()
    ignore_invalid_selector,
};

pub const NestingRequirement = enum {
    none,
    prefixed,
    contained,
    implicit,
};

pub const Combinator = enum {
    child, // >
    descendant, // space
    next_sibling, // +
    later_sibling, // ~
    /// A dummy combinator we use to the left of pseudo-elements.
    ///
    /// It serializes as the empty string, and acts effectively as a child
    /// combinator in most cases.  If we ever actually start using a child
    /// combinator for this, we will need to fix up the way hashes are computed
    /// for revalidation selectors.
    pseudo_element,
    /// Another combinator used for ::slotted(), which represent the jump from
    /// a node to its assigned slot.
    slot_assignment,

    /// Another combinator used for `::part()`, which represents the jump from
    /// the part to the containing shadow host.
    part,

    /// Non-standard Vue >>> combinator.
    /// https://vue-loader.vuejs.org/guide/scoped-css.html#deep-selectors
    deep_descendant,
    /// Non-standard /deep/ combinator.
    /// Appeared in early versions of the css-scoping-1 specification:
    /// https://www.w3.org/TR/2014/WD-css-scoping-1-20140403/#deep-combinator
    /// And still supported as an alias for >>> by Vue.
    deep,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return lhs.* == rhs.*;
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError("Do not call this! Use `serializer.serializeCombinator()` or `tocss_servo.toCss_Combinator()` instead.");
    }

    pub fn isTreeCombinator(this: *const @This()) bool {
        return switch (this.*) {
            .child, .descendant, .next_sibling, .later_sibling => true,
            else => false,
        };
    }

    pub fn format(this: *const Combinator, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        return switch (this.*) {
            .child => writer.print(">", .{}),
            .descendant => writer.print("`descendant` (space)", .{}),
            .next_sibling => writer.print("+", .{}),
            .later_sibling => writer.print("~", .{}),
            else => writer.print("{s}", .{@tagName(this.*)}),
        };
    }
};

pub const SelectorParseErrorKind = union(enum) {
    invalid_state,
    class_needs_ident: css.Token,
    pseudo_element_expected_ident: css.Token,
    unsupported_pseudo_class_or_element: []const u8,
    no_qualified_name_in_attribute_selector: css.Token,
    unexpected_token_in_attribute_selector: css.Token,
    unexpected_selector_after_pseudo_element: css.Token,
    invalid_qual_name_in_attr: css.Token,
    expected_bar_in_attr: css.Token,
    empty_selector,
    dangling_combinator,
    invalid_pseudo_class_before_webkit_scrollbar,
    invalid_pseudo_class_after_webkit_scrollbar,
    invalid_pseudo_class_after_pseudo_element,
    missing_nesting_selector,
    missing_nesting_prefix,
    expected_namespace: []const u8,
    bad_value_in_attr: css.Token,
    explicit_namespace_unexpected_token: css.Token,
    unexpected_ident: []const u8,
    ambiguous_css_module_class: []const u8,

    pub fn intoDefaultParserError(this: SelectorParseErrorKind) css.ParserError {
        return css.ParserError{
            .selector_error = this.intoSelectorError(),
        };
    }

    pub fn intoSelectorError(this: SelectorParseErrorKind) css.SelectorError {
        return switch (this) {
            .invalid_state => .invalid_state,
            .class_needs_ident => |token| .{ .class_needs_ident = token },
            .pseudo_element_expected_ident => |token| .{ .pseudo_element_expected_ident = token },
            .unsupported_pseudo_class_or_element => |name| .{ .unsupported_pseudo_class_or_element = name },
            .no_qualified_name_in_attribute_selector => |token| .{ .no_qualified_name_in_attribute_selector = token },
            .unexpected_token_in_attribute_selector => |token| .{ .unexpected_token_in_attribute_selector = token },
            .invalid_qual_name_in_attr => |token| .{ .invalid_qual_name_in_attr = token },
            .expected_bar_in_attr => |token| .{ .expected_bar_in_attr = token },
            .empty_selector => .empty_selector,
            .dangling_combinator => .dangling_combinator,
            .invalid_pseudo_class_before_webkit_scrollbar => .invalid_pseudo_class_before_webkit_scrollbar,
            .invalid_pseudo_class_after_webkit_scrollbar => .invalid_pseudo_class_after_webkit_scrollbar,
            .invalid_pseudo_class_after_pseudo_element => .invalid_pseudo_class_after_pseudo_element,
            .missing_nesting_selector => .missing_nesting_selector,
            .missing_nesting_prefix => .missing_nesting_prefix,
            .expected_namespace => |name| .{ .expected_namespace = name },
            .bad_value_in_attr => |token| .{ .bad_value_in_attr = token },
            .explicit_namespace_unexpected_token => |token| .{ .explicit_namespace_unexpected_token = token },
            .unexpected_ident => |ident| .{ .unexpected_ident = ident },
            .unexpected_selector_after_pseudo_element => |tok| .{ .unexpected_selector_after_pseudo_element = tok },
            .ambiguous_css_module_class => |name| .{ .ambiguous_css_module_class = name },
        };
    }
};

pub fn SimpleSelectorParseResult(comptime Impl: type) type {
    ValidSelectorImpl(Impl);

    return union(enum) {
        simple_selector: GenericComponent(Impl),
        pseudo_element: Impl.SelectorImpl.PseudoElement,
        slotted_pseudo: GenericSelector(Impl),
        // todo_stuff.think_mem_mgmt
        part_pseudo: []Impl.SelectorImpl.Identifier,
    };
}

/// A pseudo element.
pub const PseudoElement = union(enum) {
    /// The [::after](https://drafts.csswg.org/css-pseudo-4/#selectordef-after) pseudo element.
    after,
    /// The [::before](https://drafts.csswg.org/css-pseudo-4/#selectordef-before) pseudo element.
    before,
    /// The [::first-line](https://drafts.csswg.org/css-pseudo-4/#first-line-pseudo) pseudo element.
    first_line,
    /// The [::first-letter](https://drafts.csswg.org/css-pseudo-4/#first-letter-pseudo) pseudo element.
    first_letter,
    /// The [::selection](https://drafts.csswg.org/css-pseudo-4/#selectordef-selection) pseudo element.
    selection: css.VendorPrefix,
    /// The [::placeholder](https://drafts.csswg.org/css-pseudo-4/#placeholder-pseudo) pseudo element.
    placeholder: css.VendorPrefix,
    /// The [::marker](https://drafts.csswg.org/css-pseudo-4/#marker-pseudo) pseudo element.
    marker,
    /// The [::backdrop](https://fullscreen.spec.whatwg.org/#::backdrop-pseudo-element) pseudo element.
    backdrop: css.VendorPrefix,
    /// The [::file-selector-button](https://drafts.csswg.org/css-pseudo-4/#file-selector-button-pseudo) pseudo element.
    file_selector_button: css.VendorPrefix,
    /// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo element.
    webkit_scrollbar: WebKitScrollbarPseudoElement,
    /// The [::cue](https://w3c.github.io/webvtt/#the-cue-pseudo-element) pseudo element.
    cue,
    /// The [::cue-region](https://w3c.github.io/webvtt/#the-cue-region-pseudo-element) pseudo element.
    cue_region,
    /// The [::cue()](https://w3c.github.io/webvtt/#cue-selector) functional pseudo element.
    cue_function: struct {
        /// The selector argument.
        selector: *Selector,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The [::cue-region()](https://w3c.github.io/webvtt/#cue-region-selector) functional pseudo element.
    cue_region_function: struct {
        /// The selector argument.
        selector: *Selector,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The [::view-transition](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition) pseudo element.
    view_transition,
    /// The [::view-transition-group()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-group-pt-name-selector) functional pseudo element.
    view_transition_group: struct {
        /// A part name selector.
        part_name: ViewTransitionPartName,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The [::view-transition-image-pair()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-image-pair-pt-name-selector) functional pseudo element.
    view_transition_image_pair: struct {
        /// A part name selector.
        part_name: ViewTransitionPartName,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The [::view-transition-old()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-old-pt-name-selector) functional pseudo element.
    view_transition_old: struct {
        /// A part name selector.
        part_name: ViewTransitionPartName,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// The [::view-transition-new()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-new-pt-name-selector) functional pseudo element.
    view_transition_new: struct {
        /// A part name selector.
        part_name: ViewTransitionPartName,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// An unknown pseudo element.
    custom: struct {
        /// The name of the pseudo element.
        name: []const u8,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },
    /// An unknown functional pseudo element.
    custom_function: struct {
        /// The name of the pseudo element.
        name: []const u8,
        /// The arguments of the pseudo element function.
        arguments: css.TokenList,

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    },

    pub fn isEquivalent(this: *const PseudoElement, other: *const PseudoElement) bool {
        if (this.* == .selection and other.* == .selection) return true;
        if (this.* == .placeholder and other.* == .placeholder) return true;
        if (this.* == .backdrop and other.* == .backdrop) return true;
        if (this.* == .file_selector_button and other.* == .file_selector_button) return true;
        return this.eql(other);
    }

    pub fn eql(this: *const PseudoElement, other: *const PseudoElement) bool {
        return css.implementEql(PseudoElement, this, other);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn getNecessaryPrefixes(this: *PseudoElement, targets: css.targets.Targets) css.VendorPrefix {
        const F = css.prefixes.Feature;
        const p: *css.VendorPrefix, const feature: F = switch (this.*) {
            .selection => |*p| .{ p, F.pseudo_element_selection },
            .placeholder => |*p| .{ p, F.pseudo_element_placeholder },
            .backdrop => |*p| .{ p, F.pseudo_element_backdrop },
            .file_selector_button => |*p| .{ p, F.pseudo_element_file_selector_button },
            else => return css.VendorPrefix{},
        };

        p.* = targets.prefixes(p.*, feature);

        return p.*;
    }

    pub fn getPrefix(this: *const PseudoElement) css.VendorPrefix {
        return switch (this.*) {
            .selection, .placeholder, .backdrop, .file_selector_button => |p| p,
            else => css.VendorPrefix{},
        };
    }

    pub fn format(this: *const PseudoElement, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try writer.print("{s}", .{@tagName(this.*)});
    }

    pub fn validAfterSlotted(this: *const PseudoElement) bool {
        return switch (this.*) {
            .before, .after, .marker, .placeholder, .file_selector_button => true,
            else => false,
        };
    }

    pub fn isUnknown(this: *const PseudoElement) bool {
        return switch (this.*) {
            .custom, .custom_function => true,
            else => false,
        };
    }

    pub fn acceptsStatePseudoClasses(this: *const PseudoElement) bool {
        _ = this; // autofix
        // Be lienient.
        return true;
    }

    pub fn isWebkitScrollbar(this: *const PseudoElement) bool {
        return this.* == .webkit_scrollbar;
    }

    pub fn isViewTransition(this: *const PseudoElement) bool {
        return switch (this.*) {
            .view_transition_group, .view_transition_image_pair, .view_transition_new, .view_transition_old => true,
            else => false,
        };
    }

    pub fn toCss(this: *const PseudoElement, comptime W: type, dest: *Printer(W)) PrintErr!void {
        var s = ArrayList(u8){};
        // PERF(alloc): I don't like making small allocations here for the string.
        const writer = s.writer(dest.allocator);
        const W2 = @TypeOf(writer);
        const scratchbuf = std.ArrayList(u8).init(dest.allocator);
        var printer = Printer(W2).new(dest.allocator, scratchbuf, writer, css.PrinterOptions.default(), dest.import_info, dest.local_names, dest.symbols);
        try serialize.serializePseudoElement(this, W2, &printer, null);
        return dest.writeStr(s.items);
    }
};

/// An enum for the different types of :nth- pseudoclasses
pub const NthType = enum {
    child,
    last_child,
    only_child,
    of_type,
    last_of_type,
    only_of_type,
    col,
    last_col,

    pub fn isOnly(self: NthType) bool {
        return self == NthType.only_child or self == NthType.only_of_type;
    }

    pub fn isOfType(self: NthType) bool {
        return self == NthType.of_type or self == NthType.last_of_type or self == NthType.only_of_type;
    }

    pub fn isFromEnd(self: NthType) bool {
        return self == NthType.last_child or self == NthType.last_of_type or self == NthType.last_col;
    }

    pub fn allowsOfSelector(self: NthType) bool {
        return self == NthType.child or self == NthType.last_child;
    }
};

/// * `Err(())`: Invalid selector, abort
/// * `Ok(false)`: Not a type selector, could be something else. `input` was not consumed.
/// * `Ok(true)`: Length 0 (`*|*`), 1 (`*|E` or `ns|*`) or 2 (`|E` or `ns|E`)
pub fn parse_type_selector(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: SelectorParsingState,
    sink: *SelectorBuilder(Impl),
) Result(bool) {
    const result = switch (parse_qualified_name(
        Impl,
        parser,
        input,
        false,
    )) {
        .result => |v| v,
        .err => |e| {
            if (e.kind == .basic and e.kind.basic == .end_of_input) {
                return .{ .result = false };
            }

            return .{ .err = e };
        },
    };

    if (result == .none) return .{ .result = false };

    const namespace: QNamePrefix(Impl) = result.some[0];
    const local_name: ?[]const u8 = result.some[1];
    if (state.afterAnyPseudo()) {
        return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
    }

    switch (namespace) {
        .implicit_any_namespace => {},
        .implicit_default_namespace => |url| {
            sink.pushSimpleSelector(.{ .default_namespace = url });
        },
        .explicit_namespace => {
            const prefix = namespace.explicit_namespace[0];
            const url = namespace.explicit_namespace[1];
            const component: GenericComponent(Impl) = component: {
                if (parser.defaultNamespace()) |default_url| {
                    if (bun.strings.eql(url, default_url)) {
                        break :component .{ .default_namespace = url };
                    }
                }
                break :component .{
                    .namespace = .{
                        .prefix = prefix,
                        .url = url,
                    },
                };
            };
            sink.pushSimpleSelector(component);
        },
        .explicit_no_namespace => {
            sink.pushSimpleSelector(.explicit_no_namespace);
        },
        .explicit_any_namespace => {
            // Element type selectors that have no namespace
            // component (no namespace separator) represent elements
            // without regard to the element's namespace (equivalent
            // to "*|") unless a default namespace has been declared
            // for namespaced selectors (e.g. in CSS, in the style
            // sheet). If a default namespace has been declared,
            // such selectors will represent only elements in the
            // default namespace.
            // -- Selectors § 6.1.1
            // So we'll have this act the same as the
            // QNamePrefix::ImplicitAnyNamespace case.
            // For lightning css this logic was removed, should be handled when matching.
            sink.pushSimpleSelector(.explicit_any_namespace);
        },
        .implicit_no_namespace => {
            bun.unreachablePanic("Should not be returned with in_attr_selector = false", .{});
        },
    }

    if (local_name) |name| {
        sink.pushSimpleSelector(.{
            .local_name = LocalName(Impl){
                .lower_name = brk: {
                    var lowercase = parser.allocator.alloc(u8, name.len) catch unreachable; // PERF: check if it's already lowercase
                    break :brk .{ .v = bun.strings.copyLowercase(name, lowercase[0..]) };
                },
                .name = .{ .v = name },
            },
        });
    } else {
        sink.pushSimpleSelector(.explicit_universal_type);
    }

    return .{ .result = true };
}

/// Parse a simple selector other than a type selector.
///
/// * `Err(())`: Invalid selector, abort
/// * `Ok(None)`: Not a simple selector, could be something else. `input` was not consumed.
/// * `Ok(Some(_))`: Parsed a simple selector or pseudo-element
pub fn parse_one_simple_selector(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
) Result(?SimpleSelectorParseResult(Impl)) {
    const S = SimpleSelectorParseResult(Impl);

    const start = input.state();
    const token_location = input.currentSourceLocation();
    const token_loc = input.position();
    const token = switch (input.nextIncludingWhitespace()) {
        .result => |v| v.*,
        .err => {
            input.reset(&start);
            return .{ .result = null };
        },
    };

    switch (token) {
        .idhash => |id| {
            if (state.afterAnyPseudo()) {
                return .{ .err = token_location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unexpected_selector_after_pseudo_element = .{ .idhash = id } })) };
            }
            const component: GenericComponent(Impl) = .{ .id = parser.newLocalIdentifier(input, .ID, id, token_loc) };
            return .{ .result = S{
                .simple_selector = component,
            } };
        },
        .open_square => {
            if (state.afterAnyPseudo()) {
                return .{ .err = token_location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unexpected_selector_after_pseudo_element = .open_square })) };
            }
            const Closure = struct {
                parser: *SelectorParser,
            };
            var closure = Closure{
                .parser = parser,
            };
            const attr = switch (input.parseNestedBlock(GenericComponent(Impl), &closure, struct {
                pub fn parsefn(this: *Closure, input2: *css.Parser) Result(GenericComponent(Impl)) {
                    return parse_attribute_selector(Impl, this.parser, input2);
                }
            }
                .parsefn)) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            };
            return .{ .result = .{ .simple_selector = attr } };
        },
        .colon => {
            const location = input.currentSourceLocation();
            const is_single_colon: bool, const next_token: css.Token = switch ((switch (input.nextIncludingWhitespace()) {
                .err => |e| return .{ .err = e },
                .result => |v| v,
            }).*) {
                .colon => .{ false, (switch (input.nextIncludingWhitespace()) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                }).* },
                else => |t| .{ true, t },
            };
            const name: []const u8, const is_functional = switch (next_token) {
                .ident => |name| .{ name, false },
                .function => |name| .{ name, true },
                else => |t| {
                    const e = SelectorParseErrorKind{ .pseudo_element_expected_ident = t };
                    return .{ .err = input.newCustomError(e.intoDefaultParserError()) };
                },
            };
            const is_pseudo_element = !is_single_colon or is_css2_pseudo_element(name);
            if (is_pseudo_element) {
                if (!state.allowsPseudos()) {
                    return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
                }
                const pseudo_element: Impl.SelectorImpl.PseudoElement = if (is_functional) pseudo_element: {
                    if (parser.parsePart() and bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "part")) {
                        if (!state.allowsPart()) {
                            return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
                        }

                        const Closure = struct {
                            parser: *SelectorParser,

                            pub fn parsefn(self: *const @This(), input2: *css.Parser) Result([]Impl.SelectorImpl.Identifier) {
                                // todo_stuff.think_about_mem_mgmt
                                var result = ArrayList(Impl.SelectorImpl.Identifier).initCapacity(
                                    self.parser.allocator,
                                    // TODO: source does this, should see if initializing to 1 is actually better
                                    // when appending empty std.ArrayList(T), it will usually initially reserve 8 elements,
                                    // maybe that's unnecessary, or maybe smallvec is gud here
                                    1,
                                ) catch unreachable;

                                result.append(
                                    self.parser.allocator,
                                    switch (input2.expectIdent()) {
                                        .err => |e| return .{ .err = e },
                                        .result => |v| .{ .v = v },
                                    },
                                ) catch unreachable;

                                while (!input2.isExhausted()) {
                                    result.append(
                                        self.parser.allocator,
                                        switch (input2.expectIdent()) {
                                            .err => |e| return .{ .err = e },
                                            .result => |v| .{ .v = v },
                                        },
                                    ) catch unreachable;
                                }

                                return .{ .result = result.items };
                            }
                        };

                        const names = switch (input.parseNestedBlock([]Impl.SelectorImpl.Identifier, &Closure{ .parser = parser }, Closure.parsefn)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };

                        return .{ .result = .{ .part_pseudo = names } };
                    }

                    if (parser.parseSlotted() and bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "slotted")) {
                        if (!state.allowsSlotted()) {
                            return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
                        }
                        const Closure = struct {
                            parser: *SelectorParser,
                            state: *SelectorParsingState,
                            pub fn parsefn(this: *@This(), input2: *css.Parser) Result(GenericSelector(Impl)) {
                                return parse_inner_compound_selector(Impl, this.parser, input2, this.state);
                            }
                        };
                        var closure = Closure{
                            .parser = parser,
                            .state = state,
                        };
                        const selector = switch (input.parseNestedBlock(GenericSelector(Impl), &closure, Closure.parsefn)) {
                            .err => |e| return .{ .err = e },
                            .result => |v| v,
                        };
                        return .{ .result = .{ .slotted_pseudo = selector } };
                    }

                    const Closure = struct {
                        parser: *SelectorParser,
                        state: *SelectorParsingState,
                        name: []const u8,
                    };
                    break :pseudo_element switch (input.parseNestedBlock(Impl.SelectorImpl.PseudoElement, &Closure{ .parser = parser, .state = state, .name = name }, struct {
                        pub fn parseFn(closure: *const Closure, i: *css.Parser) Result(Impl.SelectorImpl.PseudoElement) {
                            return closure.parser.parseFunctionalPseudoElement(closure.name, i);
                        }
                    }.parseFn)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    };
                } else pseudo_element: {
                    break :pseudo_element switch (parser.parsePseudoElement(location, name)) {
                        .err => |e| return .{ .err = e },
                        .result => |v| v,
                    };
                };

                if (state.after_slotted and pseudo_element.validAfterSlotted()) {
                    return .{ .result = .{ .pseudo_element = pseudo_element } };
                }

                return .{ .result = .{ .pseudo_element = pseudo_element } };
            } else {
                const pseudo_class: GenericComponent(Impl) = if (is_functional) pseudo_class: {
                    const Closure = struct {
                        parser: *SelectorParser,
                        name: []const u8,
                        state: *SelectorParsingState,
                        pub fn parsefn(this: *@This(), input2: *css.Parser) Result(GenericComponent(Impl)) {
                            return parse_functional_pseudo_class(Impl, this.parser, input2, this.name, this.state);
                        }
                    };
                    var closure = Closure{
                        .parser = parser,
                        .name = name,
                        .state = state,
                    };

                    break :pseudo_class switch (input.parseNestedBlock(GenericComponent(Impl), &closure, Closure.parsefn)) {
                        .err => |e| return .{ .err = e },
                        .result => |v| v,
                    };
                } else switch (parse_simple_pseudo_class(Impl, parser, location, name, state.*)) {
                    .err => |e| return .{ .err = e },
                    .result => |v| v,
                };
                return .{ .result = .{ .simple_selector = pseudo_class } };
            }
        },
        .delim => |d| {
            switch (d) {
                '.' => {
                    if (state.afterAnyPseudo()) {
                        return .{ .err = token_location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unexpected_selector_after_pseudo_element = .{ .delim = '.' } })) };
                    }
                    const location = input.currentSourceLocation();
                    const class = switch ((switch (input.nextIncludingWhitespace()) {
                        .err => |e| return .{ .err = e },
                        .result => |v| v,
                    }).*) {
                        .ident => |class| class,
                        else => |t| {
                            const e = SelectorParseErrorKind{ .class_needs_ident = t };
                            return .{ .err = location.newCustomError(e.intoDefaultParserError()) };
                        },
                    };
                    return .{ .result = .{ .simple_selector = .{ .class = parser.newLocalIdentifier(input, .CLASS, class, token_loc) } } };
                },
                '&' => {
                    if (parser.isNestingAllowed()) {
                        state.after_nesting = true;
                        return .{ .result = S{
                            .simple_selector = .nesting,
                        } };
                    }
                },
                else => {},
            }
        },
        else => {},
    }

    input.reset(&start);
    return .{ .result = null };
}

pub fn parse_attribute_selector(comptime Impl: type, parser: *SelectorParser, input: *css.Parser) Result(GenericComponent(Impl)) {
    const N = attrs.NamespaceConstraint(attrs.NamespaceUrl(Impl));

    const namespace: ?N, const local_name: []const u8 = brk: {
        input.skipWhitespace();

        const _qname = switch (parse_qualified_name(Impl, parser, input, true)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        switch (_qname) {
            .none => |t| return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .no_qualified_name_in_attribute_selector = t })) },
            .some => |qname| {
                if (qname[1] == null) {
                    bun.unreachablePanic("", .{});
                }
                const ns: QNamePrefix(Impl) = qname[0];
                const ln = qname[1].?;
                break :brk .{
                    switch (ns) {
                        .implicit_no_namespace, .explicit_no_namespace => null,
                        .explicit_namespace => |x| .{ .specific = .{ .prefix = x[0], .url = x[1] } },
                        .explicit_any_namespace => .any,
                        .implicit_any_namespace, .implicit_default_namespace => {
                            bun.unreachablePanic("Not returned with in_attr_selector = true", .{});
                        },
                    },
                    ln,
                };
            },
        }
    };

    const location = input.currentSourceLocation();
    const operator: attrs.AttrSelectorOperator = operator: {
        const tok = switch (input.next()) {
            .result => |v| v,
            .err => {
                // [foo]
                const local_name_lower = local_name_lower: {
                    const lower = parser.allocator.alloc(u8, local_name.len) catch unreachable;
                    _ = bun.strings.copyLowercase(local_name, lower);
                    break :local_name_lower lower;
                };
                if (namespace) |ns| {
                    const x = attrs.AttrSelectorWithOptionalNamespace(Impl){
                        .namespace = ns,
                        .local_name = .{ .v = local_name },
                        .local_name_lower = .{ .v = local_name_lower },
                        .never_matches = false,
                        .operation = .exists,
                    };
                    return .{
                        .result = .{ .attribute_other = bun.create(parser.allocator, attrs.AttrSelectorWithOptionalNamespace(Impl), x) },
                    };
                } else {
                    return .{ .result = .{
                        .attribute_in_no_namespace_exists = .{
                            .local_name = .{ .v = local_name },
                            .local_name_lower = .{ .v = local_name_lower },
                        },
                    } };
                }
            },
        };

        switch (tok.*) {
            // [foo=bar]
            .delim => |d| {
                if (d == '=') break :operator .equal;
            },
            // [foo~=bar]
            .include_match => break :operator .includes,
            // [foo|=bar]
            .dash_match => break :operator .dash_match,
            // [foo^=bar]
            .prefix_match => break :operator .prefix,
            // [foo*=bar]
            .substring_match => break :operator .substring,
            // [foo$=bar]
            .suffix_match => break :operator .suffix,
            else => {},
        }
        return .{ .err = location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unexpected_token_in_attribute_selector = tok.* })) };
    };

    const value_str: []const u8 = switch (input.expectIdentOrString()) {
        .result => |v| v,
        .err => |e| {
            if (e.kind == .basic and e.kind.basic == .unexpected_token) {
                return .{ .err = e.location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .bad_value_in_attr = e.kind.basic.unexpected_token })) };
            }
            return .{
                .err = .{
                    .kind = e.kind,
                    .location = e.location,
                },
            };
        },
    };
    const never_matches = switch (operator) {
        .equal, .dash_match => false,
        .includes => value_str.len == 0 or bun.strings.indexOfAny(value_str, SELECTOR_WHITESPACE) != null,
        .prefix, .substring, .suffix => value_str.len == 0,
    };

    const attribute_flags = switch (parse_attribute_flags(input)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };

    const value: Impl.SelectorImpl.AttrValue = value_str;
    const local_name_lower: Impl.SelectorImpl.LocalName, const local_name_is_ascii_lowercase: bool = brk: {
        if (a: {
            for (local_name, 0..) |b, i| {
                if (b >= 'A' and b <= 'Z') break :a i;
            }
            break :a null;
        }) |first_uppercase| {
            const str = local_name[first_uppercase..];
            const lower = parser.allocator.alloc(u8, str.len) catch unreachable;
            break :brk .{ .{ .v = bun.strings.copyLowercase(str, lower) }, false };
        } else {
            break :brk .{ .{ .v = local_name }, true };
        }
    };
    const case_sensitivity: attrs.ParsedCaseSensitivity = attribute_flags.toCaseSensitivity(local_name_lower.v, namespace != null);
    if (namespace != null and !local_name_is_ascii_lowercase) {
        return .{ .result = .{
            .attribute_other = brk: {
                const x = attrs.AttrSelectorWithOptionalNamespace(Impl){
                    .namespace = namespace,
                    .local_name = .{ .v = local_name },
                    .local_name_lower = local_name_lower,
                    .never_matches = never_matches,
                    .operation = .{
                        .with_value = .{
                            .operator = operator,
                            .case_sensitivity = case_sensitivity,
                            .expected_value = value,
                        },
                    },
                };
                break :brk bun.create(parser.allocator, @TypeOf(x), x);
            },
        } };
    } else {
        return .{ .result = .{
            .attribute_in_no_namespace = .{
                .local_name = .{ .v = local_name },
                .operator = operator,
                .value = value,
                .case_sensitivity = case_sensitivity,
                .never_matches = never_matches,
            },
        } };
    }
}

/// Returns whether the name corresponds to a CSS2 pseudo-element that
/// can be specified with the single colon syntax (in addition to the
/// double-colon syntax, which can be used for all pseudo-elements).
pub fn is_css2_pseudo_element(name: []const u8) bool {
    // ** Do not add to this list! **
    // TODO: todo_stuff.match_ignore_ascii_case
    return bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "before") or
        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "after") or
        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "first-line") or
        bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "first-letter");
}

/// Parses one compound selector suitable for nested stuff like :-moz-any, etc.
pub fn parse_inner_compound_selector(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
) Result(GenericSelector(Impl)) {
    var child_state = brk: {
        var child_state = state.*;
        child_state.disallow_pseudos = true;
        child_state.disallow_combinators = true;
        break :brk child_state;
    };
    const result = switch (parse_selector(Impl, parser, input, &child_state, NestingRequirement.none)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    if (child_state.after_nesting) {
        state.after_nesting = true;
    }
    return .{ .result = result };
}

pub fn parse_functional_pseudo_class(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    name: []const u8,
    state: *SelectorParsingState,
) Result(GenericComponent(Impl)) {
    const FunctionalPseudoClass = enum {
        @"nth-child",
        @"nth-of-type",
        @"nth-last-child",
        @"nth-last-of-type",
        @"nth-col",
        @"nth-last-col",
        is,
        where,
        has,
        host,
        not,
    };
    const Map = bun.ComptimeEnumMap(FunctionalPseudoClass);

    if (Map.getASCIIICaseInsensitive(name)) |functional_pseudo_class| {
        switch (functional_pseudo_class) {
            .@"nth-child" => return parse_nth_pseudo_class(Impl, parser, input, state.*, .child),
            .@"nth-of-type" => return parse_nth_pseudo_class(Impl, parser, input, state.*, .of_type),
            .@"nth-last-child" => return parse_nth_pseudo_class(Impl, parser, input, state.*, .last_child),
            .@"nth-last-of-type" => return parse_nth_pseudo_class(Impl, parser, input, state.*, .last_of_type),
            .@"nth-col" => return parse_nth_pseudo_class(Impl, parser, input, state.*, .col),
            .@"nth-last-col" => return parse_nth_pseudo_class(Impl, parser, input, state.*, .last_col),
            .is => if (parser.parseIsAndWhere()) return parse_is_or_where(Impl, parser, input, state, GenericComponent(Impl).convertHelper_is, .{}),
            .where => if (parser.parseIsAndWhere()) return parse_is_or_where(Impl, parser, input, state, GenericComponent(Impl).convertHelper_where, .{}),
            .has => return parse_has(Impl, parser, input, state),
            .host => if (!state.allowsTreeStructuralPseudoClasses())
                return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) }
            else
                return .{ .result = .{
                    .host = switch (parse_inner_compound_selector(Impl, parser, input, state)) {
                        .err => |e| return .{ .err = e },
                        .result => |v| v,
                    },
                } },
            .not => return parse_negation(Impl, parser, input, state),
        }
    }

    if (parser.parseAnyPrefix(name)) |prefix| {
        return parse_is_or_where(Impl, parser, input, state, GenericComponent(Impl).convertHelper_any, .{prefix});
    }

    if (!state.allowsCustomFunctionalPseudoClasses()) {
        return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
    }

    const result = switch (parser.parseNonTsFunctionalPseudoClass(name, input)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };

    return .{ .result = .{ .non_ts_pseudo_class = result } };
}

const TreeStructuralPseudoClass = enum { @"first-child", @"last-child", @"only-child", root, empty, scope, host, @"first-of-type", @"last-of-type", @"only-of-type" };
const TreeStructuralPseudoClassMap = bun.ComptimeEnumMap(TreeStructuralPseudoClass);

pub fn parse_simple_pseudo_class(
    comptime Impl: type,
    parser: *SelectorParser,
    location: css.SourceLocation,
    name: []const u8,
    state: SelectorParsingState,
) Result(GenericComponent(Impl)) {
    if (!state.allowsNonFunctionalPseudoClasses()) {
        return .{ .err = location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
    }

    if (state.allowsTreeStructuralPseudoClasses()) {
        if (TreeStructuralPseudoClassMap.getAnyCase(name)) |pseudo_class| {
            switch (pseudo_class) {
                .@"first-child" => return .{ .result = .{ .nth = NthSelectorData.first(false) } },
                .@"last-child" => return .{ .result = .{ .nth = NthSelectorData.last(false) } },
                .@"only-child" => return .{ .result = .{ .nth = NthSelectorData.only(false) } },
                .root => return .{ .result = .root },
                .empty => return .{ .result = .empty },
                .scope => return .{ .result = .scope },
                .host => if (parser.parseHost()) return .{ .result = .{ .host = null } },
                .@"first-of-type" => return .{ .result = .{ .nth = NthSelectorData.first(true) } },
                .@"last-of-type" => return .{ .result = .{ .nth = NthSelectorData.last(true) } },
                .@"only-of-type" => return .{ .result = .{ .nth = NthSelectorData.only(true) } },
            }
        }
    }

    // The view-transition pseudo elements accept the :only-child pseudo class.
    // https://w3c.github.io/csswg-drafts/css-view-transitions-1/#pseudo-root
    if (state.after_view_transition) {
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "only-child")) {
            return .{ .result = .{ .nth = NthSelectorData.only(false) } };
        }
    }

    const pseudo_class = switch (parser.parseNonTsPseudoClass(location, name)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    if (state.after_webkit_scrollbar) {
        if (!pseudo_class.isValidAfterWebkitScrollbar()) {
            return .{ .err = location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_pseudo_class_after_webkit_scrollbar)) };
        }
    } else if (state.after_pseudo_element) {
        if (!pseudo_class.isUserActionState()) {
            return .{ .err = location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_pseudo_class_after_pseudo_element)) };
        }
    } else if (!pseudo_class.isValidBeforeWebkitScrollbar()) {
        return .{ .err = location.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_pseudo_class_before_webkit_scrollbar)) };
    }

    return .{ .result = .{ .non_ts_pseudo_class = pseudo_class } };
}

pub fn parse_nth_pseudo_class(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: SelectorParsingState,
    ty: NthType,
) Result(GenericComponent(Impl)) {
    if (!state.allowsTreeStructuralPseudoClasses()) {
        return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.invalid_state)) };
    }

    const a, const b = switch (css.nth.parse_nth(input)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    const nth_data = NthSelectorData{
        .ty = ty,
        .is_function = true,
        .a = a,
        .b = b,
    };

    if (!ty.allowsOfSelector()) {
        return .{ .result = .{ .nth = nth_data } };
    }

    // Try to parse "of <selector-list>".
    if (input.tryParse(css.Parser.expectIdentMatching, .{"of"}).isErr()) {
        return .{ .result = .{ .nth = nth_data } };
    }

    // Whitespace between "of" and the selector list is optional
    // https://github.com/w3c/csswg-drafts/issues/8285
    var child_state = child_state: {
        var s = state;
        s.skip_default_namespace = true;
        s.disallow_pseudos = true;
        break :child_state s;
    };

    const selectors = switch (SelectorList.parseWithState(
        parser,
        input,
        &child_state,
        .ignore_invalid_selector,
        .none,
    )) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };

    return .{ .result = .{
        .nth_of = NthOfSelectorData(Impl){
            .data = nth_data,
            .selectors = selectors.v.toOwnedSlice(input.allocator()),
        },
    } };
}

/// `func` must be of the type: fn([]GenericSelector(Impl), ...@TypeOf(args_)) GenericComponent(Impl)
pub fn parse_is_or_where(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
    comptime func: anytype,
    args_: anytype,
) Result(GenericComponent(Impl)) {
    bun.debugAssert(parser.parseIsAndWhere());
    // https://drafts.csswg.org/selectors/#matches-pseudo:
    //
    //     Pseudo-elements cannot be represented by the matches-any
    //     pseudo-class; they are not valid within :is().
    //
    var child_state = brk: {
        var child_state = state.*;
        child_state.skip_default_namespace = true;
        child_state.disallow_pseudos = true;
        break :brk child_state;
    };

    const inner = switch (SelectorList.parseWithState(parser, input, &child_state, parser.isAndWhereErrorRecovery(), NestingRequirement.none)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };
    if (child_state.after_nesting) {
        state.after_nesting = true;
    }

    const selector_slice = inner.v.toOwnedSlice(input.allocator());

    const result = result: {
        const args = brk: {
            var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
            args[0] = selector_slice;

            inline for (args_, 1..) |a, i| {
                args[i] = a;
            }

            break :brk args;
        };

        break :result @call(.auto, func, args);
    };

    return .{ .result = result };
}

pub fn parse_has(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
) Result(GenericComponent(Impl)) {
    var child_state = state.*;
    const inner = switch (SelectorList.parseRelativeWithState(
        parser,
        input,
        &child_state,
        parser.isAndWhereErrorRecovery(),
        .none,
    )) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };

    if (child_state.after_nesting) {
        state.after_nesting = true;
    }
    return .{ .result = .{ .has = inner.v.toOwnedSlice(input.allocator()) } };
}

/// Level 3: Parse **one** simple_selector.  (Though we might insert a second
/// implied "<defaultns>|*" type selector.)
pub fn parse_negation(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    state: *SelectorParsingState,
) Result(GenericComponent(Impl)) {
    var child_state = state.*;
    child_state.skip_default_namespace = true;
    child_state.disallow_pseudos = true;

    const list = switch (SelectorList.parseWithState(parser, input, &child_state, .discard_list, .none)) {
        .err => |e| return .{ .err = e },
        .result => |v| v,
    };

    if (child_state.after_nesting) {
        state.after_nesting = true;
    }

    return .{ .result = .{ .negation = list.v.toOwnedSlice(input.allocator()) } };
}

pub fn OptionalQName(comptime Impl: type) type {
    return union(enum) {
        some: struct { QNamePrefix(Impl), ?[]const u8 },
        none: css.Token,
    };
}

pub fn QNamePrefix(comptime Impl: type) type {
    return union(enum) {
        implicit_no_namespace, // `foo` in attr selectors
        implicit_any_namespace, // `foo` in type selectors, without a default ns
        implicit_default_namespace: Impl.SelectorImpl.NamespaceUrl, // `foo` in type selectors, with a default ns
        explicit_no_namespace, // `|foo`
        explicit_any_namespace, // `*|foo`
        explicit_namespace: struct { Impl.SelectorImpl.NamespacePrefix, Impl.SelectorImpl.NamespaceUrl }, // `prefix|foo`
    };
}

/// * `Err(())`: Invalid selector, abort
/// * `Ok(None(token))`: Not a simple selector, could be something else. `input` was not consumed,
///                      but the token is still returned.
/// * `Ok(Some(namespace, local_name))`: `None` for the local name means a `*` universal selector
pub fn parse_qualified_name(
    comptime Impl: type,
    parser: *SelectorParser,
    input: *css.Parser,
    in_attr_selector: bool,
) Result(OptionalQName(Impl)) {
    const start = input.state();

    const tok = switch (input.nextIncludingWhitespace()) {
        .result => |v| v,
        .err => |e| {
            input.reset(&start);
            return .{ .err = e };
        },
    };
    switch (tok.*) {
        .ident => |value| {
            const after_ident = input.state();
            const n = if (input.nextIncludingWhitespace().asValue()) |t| t.* == .delim and t.delim == '|' else false;
            if (n) {
                const prefix: Impl.SelectorImpl.NamespacePrefix = .{ .v = value };
                const result: ?Impl.SelectorImpl.NamespaceUrl = parser.namespaceForPrefix(prefix);
                const url: Impl.SelectorImpl.NamespaceUrl = brk: {
                    if (result) |url| break :brk url;
                    return .{ .err = input.newCustomError(SelectorParseErrorKind.intoDefaultParserError(.{ .unsupported_pseudo_class_or_element = value })) };
                };
                return parse_qualified_name_eplicit_namespace_helper(
                    Impl,
                    input,
                    .{ .explicit_namespace = .{ prefix, url } },
                    in_attr_selector,
                );
            } else {
                input.reset(&after_ident);
                if (in_attr_selector) return .{ .result = .{ .some = .{ .implicit_no_namespace, value } } };
                return .{ .result = parse_qualified_name_default_namespace_helper(Impl, parser, value) };
            }
        },
        .delim => |c| {
            switch (c) {
                '*' => {
                    const after_star = input.state();
                    const result = input.nextIncludingWhitespace();
                    if (result.asValue()) |t| if (t.* == .delim and t.delim == '|')
                        return parse_qualified_name_eplicit_namespace_helper(
                            Impl,
                            input,
                            .explicit_any_namespace,
                            in_attr_selector,
                        );
                    input.reset(&after_star);
                    if (in_attr_selector) {
                        switch (result) {
                            .result => |t| {
                                return .{ .err = after_star.sourceLocation().newCustomError(SelectorParseErrorKind{
                                    .expected_bar_in_attr = t.*,
                                }) };
                            },
                            .err => |e| {
                                return .{ .err = e };
                            },
                        }
                    } else {
                        return .{ .result = parse_qualified_name_default_namespace_helper(Impl, parser, null) };
                    }
                },
                '|' => return parse_qualified_name_eplicit_namespace_helper(Impl, input, .explicit_no_namespace, in_attr_selector),
                else => {},
            }
        },
        else => {},
    }
    input.reset(&start);
    return .{ .result = .{ .none = tok.* } };
}

fn parse_qualified_name_default_namespace_helper(
    comptime Impl: type,
    parser: *SelectorParser,
    local_name: ?[]const u8,
) OptionalQName(Impl) {
    const namespace: QNamePrefix(Impl) = if (parser.defaultNamespace()) |url| .{ .implicit_default_namespace = url } else .implicit_any_namespace;
    return .{
        .some = .{
            namespace,
            local_name,
        },
    };
}

fn parse_qualified_name_eplicit_namespace_helper(
    comptime Impl: type,
    input: *css.Parser,
    namespace: QNamePrefix(Impl),
    in_attr_selector: bool,
) Result(OptionalQName(Impl)) {
    const location = input.currentSourceLocation();
    const t = switch (input.nextIncludingWhitespace()) {
        .result => |v| v,
        .err => |e| return .{ .err = e },
    };
    switch (t.*) {
        .ident => |local_name| return .{ .result = .{ .some = .{ namespace, local_name } } },
        .delim => |c| {
            if (c == '*') {
                return .{ .result = .{ .some = .{ namespace, null } } };
            }
        },
        else => {},
    }
    if (in_attr_selector) {
        const e = SelectorParseErrorKind{ .invalid_qual_name_in_attr = t.* };
        return .{ .err = location.newCustomError(e) };
    }
    return .{ .err = location.newCustomError(SelectorParseErrorKind{ .explicit_namespace_unexpected_token = t.* }) };
}

pub fn LocalName(comptime Impl: type) type {
    return struct {
        name: Impl.SelectorImpl.LocalName,
        lower_name: Impl.SelectorImpl.LocalName,

        pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
            return css.IdentFns.toCss(&this.name, W, dest);
        }

        pub fn __generateEql() void {}
        pub fn __generateDeepClone() void {}
        pub fn __generateHash() void {}
    };
}

/// An attribute selector can have 's' or 'i' as flags, or no flags at all.
pub const AttributeFlags = enum {
    // Matching should be case-sensitive ('s' flag).
    case_sensitive,
    // Matching should be case-insensitive ('i' flag).
    ascii_case_insensitive,
    // No flags.  Matching behavior depends on the name of the attribute.
    case_sensitivity_depends_on_name,

    pub fn toCaseSensitivity(this: AttributeFlags, local_name: []const u8, have_namespace: bool) attrs.ParsedCaseSensitivity {
        return switch (this) {
            .case_sensitive => .explicit_case_sensitive,
            .ascii_case_insensitive => .ascii_case_insensitive,
            .case_sensitivity_depends_on_name => {
                // <https://html.spec.whatwg.org/multipage/#selectors>
                const AsciiCaseInsensitiveHtmlAttributes = enum {
                    dir,
                    http_equiv,
                    rel,
                    enctype,
                    @"align",
                    accept,
                    nohref,
                    lang,
                    bgcolor,
                    direction,
                    valign,
                    checked,
                    frame,
                    link,
                    accept_charset,
                    hreflang,
                    text,
                    valuetype,
                    language,
                    nowrap,
                    vlink,
                    disabled,
                    noshade,
                    codetype,
                    @"defer",
                    noresize,
                    target,
                    scrolling,
                    rules,
                    scope,
                    rev,
                    media,
                    method,
                    charset,
                    alink,
                    selected,
                    multiple,
                    color,
                    shape,
                    type,
                    clear,
                    compact,
                    face,
                    declare,
                    axis,
                    readonly,
                };
                const Map = comptime bun.ComptimeEnumMap(AsciiCaseInsensitiveHtmlAttributes);
                if (!have_namespace and Map.has(local_name)) return .ascii_case_insensitive_if_in_html_element_in_html_document;
                return .case_sensitive;
            },
        };
    }
};

/// A [view transition part name](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#typedef-pt-name-selector).
pub const ViewTransitionPartName = union(enum) {
    /// *
    all,
    /// <custom-ident>
    name: css.css_values.ident.CustomIdent,

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .all => try dest.writeStr("*"),
            .name => |name| try css.CustomIdentFns.toCss(&name, W, dest),
        };
    }

    pub fn parse(input: *css.Parser) Result(ViewTransitionPartName) {
        if (input.tryParse(css.Parser.expectDelim, .{'*'}).isOk()) {
            return .{ .result = .all };
        }

        return .{ .result = .{ .name = switch (css.css_values.ident.CustomIdent.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        } } };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub fn parse_attribute_flags(input: *css.Parser) Result(AttributeFlags) {
    const location = input.currentSourceLocation();
    const token = switch (input.next()) {
        .result => |v| v,
        .err => {
            // Selectors spec says language-defined; HTML says it depends on the
            // exact attribute name.
            return .{ .result = AttributeFlags.case_sensitivity_depends_on_name };
        },
    };

    const ident = if (token.* == .ident) token.ident else return .{ .err = location.newBasicUnexpectedTokenError(token.*) };

    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "i")) {
        return .{ .result = AttributeFlags.ascii_case_insensitive };
    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "s")) {
        return .{ .result = AttributeFlags.case_sensitive };
    } else {
        return .{ .err = location.newBasicUnexpectedTokenError(token.*) };
    }
}
