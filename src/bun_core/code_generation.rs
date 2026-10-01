//! `--disallow-code-generation-from-strings`: whether script may be made from a
//! string in this process. Set while the command line is parsed and never
//! lowered afterwards, so every thread and every global object made later
//! reads the same answer.

use core::sync::atomic::{AtomicU8, Ordering};

/// Ordered: a level refuses everything the levels below it refuse.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum CodeGenerationFromStrings {
    Allowed = 0,
    /// `--disallow-code-generation-from-strings`, as Node.js: `eval` and the
    /// `Function` constructors throw. `node:vm`, `module._compile` and `data:`
    /// imports are not affected.
    DisallowedLikeNode = 1,
    /// `--disallow-code-generation-from-strings=strict`: nothing turns a string
    /// into script.
    Disallowed = 2,
}

impl CodeGenerationFromStrings {
    /// The value of `--disallow-code-generation-from-strings[=<value>]`; empty
    /// is the bare flag.
    pub fn from_flag_value(value: &[u8]) -> Option<Self> {
        match value {
            b"" => Some(Self::DisallowedLikeNode),
            b"strict" => Some(Self::Disallowed),
            _ => None,
        }
    }
}

static LEVEL: AtomicU8 = AtomicU8::new(CodeGenerationFromStrings::Allowed as u8);

pub fn code_generation_from_strings() -> CodeGenerationFromStrings {
    match LEVEL.load(Ordering::Relaxed) {
        0 => CodeGenerationFromStrings::Allowed,
        1 => CodeGenerationFromStrings::DisallowedLikeNode,
        _ => CodeGenerationFromStrings::Disallowed,
    }
}

/// Raises the level. There is no way to lower it.
pub fn disallow_code_generation_from_strings(level: CodeGenerationFromStrings) {
    LEVEL.fetch_max(level as u8, Ordering::Relaxed);
}
