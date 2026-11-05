//! Parentheses aren't part of the syntax tree. The source's parentheses are dropped, and a node is printed in
//! parentheses if it needs them in its position: to keep its meaning, to be valid syntax, or, in a few cases, to be
//! easier to read (`(a && b) || c`).

pub(crate) mod expression;
pub(crate) mod ts_type;
