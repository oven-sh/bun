// SCRATCH STAND-IN, not delivered: the parts of crate::core that the node table names.
pub mod golang;
pub mod languagevariant;
pub mod scriptkind;
pub mod text;
pub mod tristate;

pub use golang::*;
pub use languagevariant::*;
pub use scriptkind::*;
pub use text::*;
pub use tristate::*;

#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct Pattern {
    pub text: Vec<u8>,
    pub star_index: isize,
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct ModuleKind(pub i32);
pub type ResolutionMode = ModuleKind;

pub fn compute_ecma_line_starts(text: &[u8]) -> Vec<TextPos> {
    let mut starts = vec![TextPos(0)];
    for (at, byte) in text.iter().enumerate() {
        if *byte == b'\n' {
            starts.push(TextPos(at as i32 + 1));
        }
    }
    starts
}
