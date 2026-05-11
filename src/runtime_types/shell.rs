use core::fmt;

/// Index into the shell interpreter's node arena.
///
/// The interpreter owns the arena; this value is the stable cross-boundary
/// identity for a node inside that arena.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeId(pub u32);

impl NodeId {
    /// Sentinel: "the parent is the Interpreter itself". The root Script node
    /// uses this, and the interpreter special-cases it when a child finishes.
    pub const INTERPRETER: NodeId = NodeId(u32::MAX);
    /// Sentinel for "no node", e.g. an Option<NodeId> packed as a plain id.
    pub const NONE: NodeId = NodeId(u32::MAX - 1);

    #[inline]
    pub fn idx(self) -> usize {
        self.0 as usize
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if *self == NodeId::INTERPRETER {
            write!(f, "Node(interp)")
        } else {
            write!(f, "Node#{}", self.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_id_display_preserves_shell_labels() {
        assert_eq!(NodeId(7).to_string(), "Node#7");
        assert_eq!(NodeId::INTERPRETER.to_string(), "Node(interp)");
    }
}
