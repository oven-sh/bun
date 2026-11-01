//! `@eslint-community/eslint-utils`, which typescript-eslint re-exports as `ASTUtils` and from
//! `@typescript-eslint/utils/ast-utils`.
//!
//! The number conversions that `getStaticValue` needs are useful on their own: [`js_number`].
//!
//! | JavaScript | [`js_number`] |
//! | --- | --- |
//! | `n.toString(radix)` | `to_radix_string` |
//! | `n.toFixed(d)`, `n.toExponential(d)`, `n.toPrecision(p)` | not here: `bun_core::fmt::FormatDouble::to_fixed`, `to_exponential`, `to_precision` |
//! | `parseInt(s, radix)`, `parseFloat(s)` | `parse_int`, `parse_float` |
//! | `n \| 0`, `n >>> 0` | `to_int32`, `to_uint32` |
//!
//! Known differences from upstream:
//! - [`get_static_value`] has no value for anything [`StaticValue`] doesn't represent: `Date`, typed arrays, a `bigint`
//!   beyond 128 bits, an object with its own prototype or conversion method.
//! - `class A implements b.c` and `interface A extends b.c` have no member access here, so [`has_side_effect`] sees no
//!   getter in them and [`ReferenceTracker`] doesn't follow them.
//! - `x as const` isn't a reference to a global `const`.
//!
//! No function takes a `sourceCode`, because every handle knows its file.
//!
//! The token predicates take `&Token`, which is what `Iterator::find` and `Iterator::filter` pass:
//! `file.tokens_after(node).find(is_comma_token)`. With a token in hand, call `is_comma_token(&token)`.

mod builtins;
mod calls;
mod find_variable;
mod get_function_name_with_kind;
mod get_property_name;
mod get_static_value;
mod get_string_if_constant;
mod has_side_effect;
mod is_parenthesized;
pub mod js_number;
mod js_string;
mod operators;
mod reference_tracker;
mod static_value;
mod token_predicate;

pub use builtins::Builtin;
pub use find_variable::{find_variable, find_variable_of};
pub use get_function_name_with_kind::get_function_name_with_kind;
pub use get_property_name::{get_property_name, property_name_of_key};
pub use get_static_value::get_static_value;
pub use get_string_if_constant::get_string_if_constant;
pub use has_side_effect::{HasSideEffectOptions, has_side_effect};
pub use is_parenthesized::{is_parenthesized, is_parenthesized_times};
pub use reference_tracker::{
    Mode, ReferenceKind, ReferenceTracker, Trace, TraceMap, TrackedReference,
};
pub use static_value::{IteratorKind, PropertyKey, StaticSymbol, StaticValue};
pub use token_predicate::*;
