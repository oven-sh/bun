use core::{fmt, num::NonZeroUsize};

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

/// Stable identity for a live shell interpreter.
///
/// The process/IO layers treat this only as an identity token. Dereferencing it
/// stays in `bun_runtime`, which owns the shell interpreter implementation.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct InterpreterHandle(NonZeroUsize);

impl InterpreterHandle {
    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        NonZeroUsize::new(ptr.cast::<()>() as usize).map(Self)
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.0.get() as *mut T
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

    #[test]
    fn interpreter_handle_preserves_pointer_identity() {
        let mut interpreter = 0u8;
        let ptr = core::ptr::from_mut(&mut interpreter);
        let handle = InterpreterHandle::from_ptr(ptr).unwrap();

        assert_eq!(handle.as_ptr::<u8>(), ptr);
        assert!(InterpreterHandle::from_ptr::<u8>(core::ptr::null_mut()).is_none());
    }
}
