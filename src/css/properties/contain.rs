use crate::SmallList;
use crate::css_rules::container::ContainerName;

type ContainerIdent = ContainerName;

/// A value for the [container-type](https://drafts.csswg.org/css-contain-3/#container-type) property.
/// Establishes the element as a query container for the purpose of container queries.
// TODO(port): css.DefineEnumProperty(@compileError(css.todo_stuff.depth)) — unimplemented placeholder in Zig source
pub struct ContainerType;

/// A value for the [container-name](https://drafts.csswg.org/css-contain-3/#container-name) property.
pub enum ContainerNameList {
    /// The `none` keyword.
    None,
    /// A list of container names.
    Names(SmallList<ContainerIdent, 1>),
}

/// A value for the [container](https://drafts.csswg.org/css-contain-3/#container-shorthand) shorthand property.
// TODO(port): css.DefineEnumProperty(@compileError(css.todo_stuff.depth)) — unimplemented placeholder in Zig source
pub struct Container;

// ported from: src/css/properties/contain.zig
