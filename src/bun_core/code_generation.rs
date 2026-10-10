//! `--disallow-code-generation-from-strings`: whether script may be made from a
//! string in this process. Set while the command line is parsed and never
//! lowered afterwards, so every thread and every global object made later
//! reads the same answer.
//!
//! A build configured with `codeGenerationFromStrings` off
//! (scripts/build/config.ts) has no level to set: it is the constant
//! [`CodeGenerationFromStrings::Disallowed`].

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

/// Whether this build is at [`CodeGenerationFromStrings::Disallowed`] with no flag given.
pub const CODE_GENERATION_FROM_STRINGS_DISALLOWED_BY_BUILD: bool =
    cfg!(bun_disallow_code_generation_from_strings);

#[cfg(not(bun_disallow_code_generation_from_strings))]
mod level {
    use super::CodeGenerationFromStrings;
    use core::sync::atomic::{AtomicU8, Ordering};

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
}

#[cfg(bun_disallow_code_generation_from_strings)]
mod level {
    use super::CodeGenerationFromStrings;

    #[inline(always)]
    pub const fn code_generation_from_strings() -> CodeGenerationFromStrings {
        CodeGenerationFromStrings::Disallowed
    }

    /// The level is already the highest, so a flag that asks for one changes nothing.
    #[inline(always)]
    pub fn disallow_code_generation_from_strings(_level: CodeGenerationFromStrings) {}
}

pub use level::{code_generation_from_strings, disallow_code_generation_from_strings};
