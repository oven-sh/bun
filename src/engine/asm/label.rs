//! Places in code, and finished code that does not yet have an address.

/// A place in the code being assembled, or an address outside it.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Label(pub(crate) u32);

impl Label {
    /// The other bits are the index of the target. Without it they are that of the state.
    pub(crate) const EXTERNAL: u32 = 1 << 31;

    /// An alias of such a label is not one.
    #[inline]
    pub(crate) fn is_external(self) -> bool {
        self.0 & Self::EXTERNAL != 0
    }
}

/// What an external label stands for.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Target {
    Address(usize),
    /// Whoever links the code gives the address.
    Symbol(u32),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RelocationKind {
    /// x86-64: four bytes that hold the distance from their end.
    Distance32,
    /// AArch64: a `b` or `bl`.
    Branch26,
}

/// A jump or call that leaves the code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Relocation {
    pub offset: u32,
    pub kind: RelocationKind,
    pub target: Target,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CodeTooLarge;

#[derive(Clone, Copy)]
pub(crate) struct LabelState {
    pub(crate) offset: u32,
    /// The number of sites before a bound label, the index of an external's target, or the label aliased.
    pub(crate) link: u32,
}

impl LabelState {
    pub(crate) const UNBOUND: u32 = u32::MAX;
    pub(crate) const EXTERNAL: u32 = u32::MAX - 1;
    pub(crate) const ALIAS: u32 = u32::MAX - 2;

    #[inline]
    pub(crate) fn is_bound(self) -> bool {
        self.offset < Self::ALIAS
    }
}

/// Does not follow an alias. Once all is emitted there is none.
#[inline]
pub(crate) fn resolve(labels: &[LabelState], label: Label) -> LabelState {
    labels.get(label.0 as usize).copied().unwrap_or_else(|| {
        assert!(label.is_external());
        LabelState {
            offset: LabelState::EXTERNAL,
            link: label.0 & !Label::EXTERNAL,
        }
    })
}

/// Position-independent machine code.
pub struct Code {
    /// The first `len` count.
    pub(crate) bytes: Vec<u8>,
    pub(crate) len: u32,
    pub(crate) labels: Vec<LabelState>,
    pub(crate) relocations: Vec<Relocation>,
    pub(crate) alignment: u32,
    pub(crate) instructions_end: u32,
}

impl Code {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes[..self.len as usize]
    }

    pub fn relocations(&self) -> &[Relocation] {
        &self.relocations
    }

    /// The code runs only at an address that is a multiple of this.
    pub fn alignment(&self) -> u32 {
        self.alignment
    }

    /// Where the constants and jump tables start.
    pub fn instructions_end(&self) -> u32 {
        self.instructions_end
    }

    #[inline]
    pub fn offset_of(&self, label: Label) -> u32 {
        let state = resolve(&self.labels, label);
        assert!(state.is_bound(), "the label has no place in the code");
        state.offset
    }
}
