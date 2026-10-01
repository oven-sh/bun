// SCRATCH STAND-IN, not delivered: the record types of the sibling's ast/ast.rs that the node table stores, copied verbatim.
use crate::ast::*;
use crate::core::{ResolutionMode, TextRange};

pub struct PatternAmbientModule {
    pub pattern: crate::core::Pattern,
    pub symbol: SymbolId,
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct CommentDirectiveKind(pub i32);

impl CommentDirectiveKind {
    pub const UNKNOWN: Self = Self(0);
    pub const EXPECT_ERROR: Self = Self(1);
    pub const IGNORE: Self = Self(2);
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    pub loc: TextRange,
    pub kind: CommentDirectiveKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CheckJsDirective {
    pub enabled: bool,
    pub range: CommentRange,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentRange {
    pub text_range: TextRange,
    pub kind: Kind,
    pub has_trailing_new_line: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FileReference {
    pub text_range: TextRange,
    pub file_name: Vec<u8>,
    pub resolution_mode: ResolutionMode,
    pub preserve: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PragmaArgument {
    pub text_range: TextRange,
    pub name: Vec<u8>,
    pub value: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Pragma {
    pub comment_range: CommentRange,
    pub name: Vec<u8>,
    // Upstream keeps a map by argument name: a pragma has at most a handful of arguments, and a list keeps their order.
    pub args: Vec<PragmaArgument>,
}
