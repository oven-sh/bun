const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;

/// A value for the [align-content](https://www.w3.org/TR/css-align-3/#propdef-align-content) property.
pub const AlignContent = union(enum) {
    /// Default alignment.
    normal: void,
    /// A baseline position.
    baseline_position: BaselinePosition,
    /// A content distribution keyword.
    content_distribution: ContentDistribution,
    /// A content position keyword.
    content_position: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
        /// A content position keyword.
        value: ContentPosition,
    },
};

/// A [`<baseline-position>`](https://www.w3.org/TR/css-align-3/#typedef-baseline-position) value,
/// as used in the alignment properties.
pub const BaselinePosition = enum {
    /// The first baseline.
    first,
    /// The last baseline.
    last,
};

/// A value for the [justify-content](https://www.w3.org/TR/css-align-3/#propdef-justify-content) property.
pub const JustifyContent = union(enum) {
    /// Default justification.
    normal,
    /// A content distribution keyword.
    content_distribution: ContentDistribution,
    /// A content position keyword.
    content_position: struct {
        /// A content position keyword.
        value: ContentPosition,
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// Justify to the left.
    left: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// Justify to the right.
    right: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
};

/// A value for the [align-self](https://www.w3.org/TR/css-align-3/#align-self-property) property.
pub const AlignSelf = union(enum) {
    /// Automatic alignment.
    auto,
    /// Default alignment.
    normal,
    /// Item is stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword.
    self_position: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
        /// A self position keyword.
        value: SelfPosition,
    },
};

/// A value for the [justify-self](https://www.w3.org/TR/css-align-3/#justify-self-property) property.
pub const JustifySelf = union(enum) {
    /// Automatic justification.
    auto,
    /// Default justification.
    normal,
    /// Item is stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword.
    self_position: struct {
        /// A self position keyword.
        value: SelfPosition,
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// Item is justified to the left.
    left: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// Item is justified to the right.
    right: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
};

/// A value for the [align-items](https://www.w3.org/TR/css-align-3/#align-items-property) property.
pub const AlignItems = union(enum) {
    /// Default alignment.
    normal,
    /// Items are stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword.
    self_position: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
        /// A self position keyword.
        value: SelfPosition,
    },
};

/// A value for the [justify-items](https://www.w3.org/TR/css-align-3/#justify-items-property) property.
pub const JustifyItems = union(enum) {
    /// Default justification.
    normal,
    /// Items are stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword, with optional overflow position.
    self_position: struct {
        /// A self position keyword.
        value: SelfPosition,
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// Items are justified to the left, with an optional overflow position.
    left: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// Items are justified to the right, with an optional overflow position.
    right: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
    },
    /// A legacy justification keyword.
    legacy: LegacyJustify,
};

/// A legacy justification keyword, as used in the `justify-items` property.
pub const LegacyJustify = enum {
    /// Left justify.
    left,
    /// Right justify.
    right,
    /// Centered.
    center,
};

/// A [gap](https://www.w3.org/TR/css-align-3/#column-row-gap) value, as used in the
/// `column-gap` and `row-gap` properties.
pub const GapValue = union(enum) {
    /// Equal to `1em` for multi-column containers, and zero otherwise.
    normal,
    /// An explicit length.
    length_percentage: LengthPercentage,
};

/// A value for the [gap](https://www.w3.org/TR/css-align-3/#gap-shorthand) shorthand property.
pub const Gap = @compileError(css.todo_stuff.depth);

/// A value for the [place-items](https://www.w3.org/TR/css-align-3/#place-items-property) shorthand property.
pub const PlaceItems = @compileError(css.todo_stuff.depth);

/// A value for the [place-self](https://www.w3.org/TR/css-align-3/#place-self-property) shorthand property.
pub const PlaceSelf = @compileError(css.todo_stuff.depth);

/// A [`<self-position>`](https://www.w3.org/TR/css-align-3/#typedef-self-position) value.
pub const SelfPosition = @compileError(css.todo_stuff.depth);

/// A value for the [place-content](https://www.w3.org/TR/css-align-3/#place-content) shorthand property.
pub const PlaceContent = @compileError(css.todo_stuff.depth);

/// A [`<content-distribution>`](https://www.w3.org/TR/css-align-3/#typedef-content-distribution) value.
pub const ContentDistribution = css.DefineEnumProperty(@compileError(css.todo_stuff.errors));

/// An [`<overflow-position>`](https://www.w3.org/TR/css-align-3/#typedef-overflow-position) value.
pub const OverflowPosition = css.DefineEnumProperty(@compileError(css.todo_stuff.errors));

/// A [`<content-position>`](https://www.w3.org/TR/css-align-3/#typedef-content-position) value.
pub const ContentPosition = css.DefineEnumProperty(@compileError(css.todo_stuff.errors));
