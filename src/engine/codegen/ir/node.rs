//! Instructions that only the client understands. It replaces them before code is generated.

use super::effects::Effects;
use super::op::Type;

/// A position in the table that the client gives to [`super::Function::set_node_kinds`].
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeKind(pub u16);

/// Two nodes of one kind with the same operands and data do the same if they find the same in what they read.
pub struct NodeInfo {
    pub name: &'static str,
    pub effects: Effects,
    /// Of a node that gives a tuple.
    pub elements: &'static [Type],
}
