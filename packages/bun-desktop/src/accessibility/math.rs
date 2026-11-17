//! https://w3c.github.io/mathml-aam/

use crate::abi::accessibility::{Role, Text};
use crate::accessibility::forest::{Forest, Id, Node};

impl Forest {
    /// Of what is in a formula.
    pub fn math_tag<'a>(&self, id: Id, node: &'a Node) -> Option<&'a str> {
        let tag = node
            .text(Text::Tag)
            .filter(|_| node.role == Role::Generic)?;
        let may_be = tag.starts_with('m')
            || matches!(tag, "annotation" | "annotation-xml" | "none" | "semantics");
        (may_be && self.closest(id, |it| it.role == Role::Math).is_some()).then_some(tag)
    }
}
