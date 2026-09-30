// printer/generatedidentifierflags.go: how the text of a generated identifier is made.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct GeneratedIdentifierFlags(pub isize);

impl GeneratedIdentifierFlags {
    // Not automatically generated.
    pub const NONE: Self = Self(0);
    // Automatically generated identifier.
    pub const AUTO: Self = Self(1);
    // Automatically generated identifier with a preference for '_i'.
    pub const LOOP: Self = Self(2);
    // Unique name based on the 'text' property.
    pub const UNIQUE: Self = Self(3);
    // Unique name based on the node in the 'Node' property.
    pub const NODE: Self = Self(4);
    // Mask to extract the kind of identifier from its flags.
    pub const KIND_MASK: Self = Self(7);

    pub fn kind(self) -> Self {
        Self(self.0 & Self::KIND_MASK.0)
    }

    pub fn is_node(self) -> bool {
        self.kind() == Self::NODE
    }
}
