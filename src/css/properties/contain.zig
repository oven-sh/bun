pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;

const ContainerName = css.css_rules.container.ContainerName;

const ContainerIdent = ContainerName;

/// A value for the [container-type](https://drafts.csswg.org/css-contain-3/#container-type) property.
/// Establishes the element as a query container for the purpose of container queries.
pub const ContainerType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [container-name](https://drafts.csswg.org/css-contain-3/#container-name) property.
pub const ContainerNameList = union(enum) {
    /// The `none` keyword.
    none,
    /// A list of container names.
    names: SmallList(ContainerIdent, 1),
};

/// A value for the [container](https://drafts.csswg.org/css-contain-3/#container-shorthand) shorthand property.
pub const Container = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
