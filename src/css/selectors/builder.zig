//! This is the selector builder module ported from the copypasted implementation from
//! servo in lightningcss.
//!
//! -- original comment from servo --
//! Helper module to build up a selector safely and efficiently.
//!
//! Our selector representation is designed to optimize matching, and has
//! several requirements:
//! * All simple selectors and combinators are stored inline in the same buffer
//!   as Component instances.
//! * We store the top-level compound selectors from right to left, i.e. in
//!   matching order.
//! * We store the simple selectors for each combinator from left to right, so
//!   that we match the cheaper simple selectors first.
//!
//! Meeting all these constraints without extra memmove traffic during parsing
//! is non-trivial. This module encapsulates those details and presents an
//! easy-to-use API for the parser.

pub const css = @import("../css_parser.zig");

pub const Printer = css.Printer;
pub const PrintErr = css.PrintErr;

const parser = css.selector.parser;

const ValidSelectorImpl = parser.ValidSelectorImpl;
const GenericComponent = parser.GenericComponent;
const Combinator = parser.Combinator;
const SpecificityAndFlags = parser.SpecificityAndFlags;
const compute_specificity = parser.compute_specificity;
const SelectorFlags = parser.SelectorFlags;

/// Top-level SelectorBuilder struct. This should be stack-allocated by the
/// consumer and never moved (because it contains a lot of inline data that
/// would be slow to memmov).
///
/// After instantiation, callers may call the push_simple_selector() and
/// push_combinator() methods to append selector data as it is encountered
/// (from left to right). Once the process is complete, callers should invoke
/// build(), which transforms the contents of the SelectorBuilder into a heap-
/// allocated Selector and leaves the builder in a drained state.
pub fn SelectorBuilder(comptime Impl: type) type {
    ValidSelectorImpl(Impl);

    return struct {
        /// The entire sequence of simple selectors, from left to right, without combinators.
        ///
        /// We make this large because the result of parsing a selector is fed into a new
        /// Arc-ed allocation, so any spilled vec would be a wasted allocation. Also,
        /// Components are large enough that we don't have much cache locality benefit
        /// from reserving stack space for fewer of them.
        ///
        simple_selectors: css.SmallList(GenericComponent(Impl), 32) = .{},

        /// The combinators, and the length of the compound selector to their left.
        ///
        combinators: css.SmallList(struct { Combinator, usize }, 32) = .{},

        /// The length of the current compound selector.
        current_len: usize = 0,

        allocator: Allocator,

        const This = @This();

        const BuildResult = struct {
            specificity_and_flags: SpecificityAndFlags,
            components: ArrayList(GenericComponent(Impl)),
        };

        pub inline fn init(allocator: Allocator) This {
            return This{
                .allocator = allocator,
            };
        }

        /// Returns true if combinators have ever been pushed to this builder.
        pub inline fn hasCombinators(this: *This) bool {
            return this.combinators.len() > 0;
        }

        /// Completes the current compound selector and starts a new one, delimited
        /// by the given combinator.
        pub inline fn pushCombinator(this: *This, combinator: Combinator) void {
            this.combinators.append(this.allocator, .{ combinator, this.current_len });
            this.current_len = 0;
        }

        /// Pushes a simple selector onto the current compound selector.
        pub fn pushSimpleSelector(this: *This, ss: GenericComponent(Impl)) void {
            bun.assert(!ss.isCombinator());
            this.simple_selectors.append(this.allocator, ss);
            this.current_len += 1;
        }

        pub fn addNestingPrefix(this: *This) void {
            this.combinators.insert(this.allocator, 0, .{ Combinator.descendant, 1 });
            this.simple_selectors.insert(this.allocator, 0, .nesting);
        }

        pub fn deinit(this: *This) void {
            this.simple_selectors.deinit(this.allocator);
            this.combinators.deinit(this.allocator);
        }

        /// Consumes the builder, producing a Selector.
        ///
        /// *NOTE*: This will free all allocated memory in the builder
        pub fn build(
            this: *This,
            parsed_pseudo: bool,
            parsed_slotted: bool,
            parsed_part: bool,
        ) BuildResult {
            const specificity = compute_specificity(Impl, this.simple_selectors.slice());
            const flags: SelectorFlags = .{
                .has_pseudo = parsed_pseudo,
                .has_slotted = parsed_slotted,
                .has_part = parsed_part,
            };
            // `buildWithSpecificityAndFlags()` will
            defer this.deinit();
            return this.buildWithSpecificityAndFlags(SpecificityAndFlags{ .specificity = specificity, .flags = flags });
        }

        /// Builds a selector with the given specificity and flags.
        ///
        /// PERF:
        ///     Recall that this code is ported from servo, which optimizes for matching speed, so
        ///     the final AST has the components of the selector stored in reverse order, which is
        ///     optimized for matching.
        ///
        ///     We don't really care about matching selectors, and storing the components in reverse
        ///     order requires additional allocations, and undoing the reversal when serializing the
        ///     selector. So we could just change this code to store the components in the same order
        ///     as the source.
        pub fn buildWithSpecificityAndFlags(this: *This, spec: SpecificityAndFlags) BuildResult {
            const T = GenericComponent(Impl);
            const rest: []const T, const current: []const T = splitFromEnd(T, this.simple_selectors.slice(), this.current_len);
            const combinators = this.combinators.slice();
            defer {
                // This function should take every component from `this.simple_selectors`
                // and place it into `components` and return it.
                //
                // This means that we shouldn't leak any `GenericComponent(Impl)`, so
                // it is safe to just set the length to 0.
                //
                // Combinators don't need to be deinitialized because they are simple enums.
                this.simple_selectors.setLen(0);
                this.combinators.setLen(0);
            }

            var components = ArrayList(T){};

            var current_simple_selectors_i: usize = 0;
            var combinator_i: i64 = @as(i64, @intCast(this.combinators.len())) - 1;
            var rest_of_simple_selectors = rest;
            var current_simple_selectors = current;

            while (true) {
                if (current_simple_selectors_i < current_simple_selectors.len) {
                    components.append(
                        this.allocator,
                        current_simple_selectors[current_simple_selectors_i],
                    ) catch unreachable;
                    current_simple_selectors_i += 1;
                } else {
                    if (combinator_i >= 0) {
                        const combo: Combinator, const len: usize = combinators[@intCast(combinator_i)];
                        const rest2, const current2 = splitFromEnd(GenericComponent(Impl), rest_of_simple_selectors, len);
                        rest_of_simple_selectors = rest2;
                        current_simple_selectors_i = 0;
                        current_simple_selectors = current2;
                        combinator_i -= 1;
                        components.append(
                            this.allocator,
                            .{ .combinator = combo },
                        ) catch unreachable;
                        continue;
                    }
                    break;
                }
            }

            return .{ .specificity_and_flags = spec, .components = components };
        }

        pub fn splitFromEnd(comptime T: type, s: []const T, at: usize) struct { []const T, []const T } {
            const midpoint = s.len - at;
            return .{
                s[0..midpoint],
                s[midpoint..],
            };
        }
    };
}

const bun = @import("bun");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
