//! `--disallow-code-generation-from-strings`: whether script may be made from a
//! string in this process. Set while the command line is parsed and never
//! lowered afterwards, so every thread and every global object made later
//! reads the same answer.
//!
//! A build configured with `codeGenerationFromStrings` off
//! (scripts/build/config.ts) has no level to set: it is the constant
//! [`CodeGenerationFromStrings::Strict`].

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
    Strict = 2,
}

impl CodeGenerationFromStrings {
    /// The value of `--disallow-code-generation-from-strings[=<value>]`; empty
    /// is the bare flag.
    pub fn from_flag_value(value: &[u8]) -> Option<Self> {
        match value {
            b"" => Some(Self::DisallowedLikeNode),
            b"strict" => Some(Self::Strict),
            _ => None,
        }
    }
}

/// Whether this build is at [`CodeGenerationFromStrings::Strict`] with no flag given.
pub const CODE_GENERATION_FROM_STRINGS_DISALLOWED_BY_BUILD: bool =
    cfg!(bun_disallow_code_generation_from_strings);

#[cfg(not(bun_disallow_code_generation_from_strings))]
mod level {
    use super::CodeGenerationFromStrings;
    use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};

    static LEVEL: AtomicU8 = AtomicU8::new(CodeGenerationFromStrings::Allowed as u8);
    static IS_DISALLOWED_BY_COMPILED_PROGRAM: AtomicBool = AtomicBool::new(false);
    static IS_INTERPRETER_REMOVED: AtomicBool = AtomicBool::new(false);

    pub fn code_generation_from_strings_by_flags() -> CodeGenerationFromStrings {
        match LEVEL.load(Ordering::Relaxed) {
            0 => CodeGenerationFromStrings::Allowed,
            1 => CodeGenerationFromStrings::DisallowedLikeNode,
            _ => CodeGenerationFromStrings::Strict,
        }
    }

    pub fn code_generation_from_strings() -> CodeGenerationFromStrings {
        if is_interpreter_removed() || is_code_generation_disallowed_by_compiled_program() {
            return CodeGenerationFromStrings::Strict;
        }
        code_generation_from_strings_by_flags()
    }

    pub fn is_code_generation_disallowed_by_trimming() -> bool {
        is_interpreter_removed()
            && code_generation_from_strings_by_flags() != CodeGenerationFromStrings::Strict
    }

    fn is_interpreter_removed() -> bool {
        IS_INTERPRETER_REMOVED.load(Ordering::Relaxed)
    }

    pub fn disallow_code_generation_for_removed_interpreter() {
        IS_INTERPRETER_REMOVED.store(true, Ordering::Relaxed);
    }

    pub fn is_code_generation_disallowed_by_compiled_program() -> bool {
        IS_DISALLOWED_BY_COMPILED_PROGRAM.load(Ordering::Relaxed)
    }

    /// The compiled code in this executable is only correct while no other script runs beside it.
    pub fn disallow_code_generation_for_compiled_program() {
        IS_DISALLOWED_BY_COMPILED_PROGRAM.store(true, Ordering::Relaxed);
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
        CodeGenerationFromStrings::Strict
    }

    #[inline(always)]
    pub const fn code_generation_from_strings_by_flags() -> CodeGenerationFromStrings {
        CodeGenerationFromStrings::Strict
    }

    /// The level is already the highest, so a flag that asks for one changes nothing.
    #[inline(always)]
    pub fn disallow_code_generation_from_strings(_level: CodeGenerationFromStrings) {}

    #[inline(always)]
    pub const fn is_code_generation_disallowed_by_trimming() -> bool {
        false
    }

    #[inline(always)]
    pub const fn is_code_generation_disallowed_by_compiled_program() -> bool {
        false
    }

    #[inline(always)]
    pub fn disallow_code_generation_for_compiled_program() {}

    #[inline(always)]
    pub fn disallow_code_generation_for_removed_interpreter() {}
}

pub use level::{
    code_generation_from_strings, code_generation_from_strings_by_flags,
    disallow_code_generation_for_compiled_program,
    disallow_code_generation_for_removed_interpreter, disallow_code_generation_from_strings,
    is_code_generation_disallowed_by_compiled_program, is_code_generation_disallowed_by_trimming,
};

#[cfg(all(test, not(bun_disallow_code_generation_from_strings)))]
mod tests {
    use super::*;

    #[test]
    fn level_only_rises_and_flags_are_not_trimming() {
        assert_eq!(
            code_generation_from_strings(),
            CodeGenerationFromStrings::Allowed
        );
        assert_eq!(
            code_generation_from_strings_by_flags(),
            CodeGenerationFromStrings::Allowed
        );
        assert!(!is_code_generation_disallowed_by_trimming());

        disallow_code_generation_from_strings(CodeGenerationFromStrings::DisallowedLikeNode);
        assert_eq!(
            code_generation_from_strings(),
            CodeGenerationFromStrings::DisallowedLikeNode
        );
        assert_eq!(
            code_generation_from_strings_by_flags(),
            CodeGenerationFromStrings::DisallowedLikeNode
        );
        assert!(!is_code_generation_disallowed_by_trimming());

        disallow_code_generation_from_strings(CodeGenerationFromStrings::Allowed);
        assert_eq!(
            code_generation_from_strings(),
            CodeGenerationFromStrings::DisallowedLikeNode
        );
        assert_eq!(
            code_generation_from_strings_by_flags(),
            CodeGenerationFromStrings::DisallowedLikeNode
        );

        assert!(!is_code_generation_disallowed_by_compiled_program());
        disallow_code_generation_for_compiled_program();
        assert!(is_code_generation_disallowed_by_compiled_program());
        assert_eq!(
            code_generation_from_strings(),
            CodeGenerationFromStrings::Strict
        );
        assert_eq!(
            code_generation_from_strings_by_flags(),
            CodeGenerationFromStrings::DisallowedLikeNode
        );
        assert!(!is_code_generation_disallowed_by_trimming());

        disallow_code_generation_for_removed_interpreter();
        assert_eq!(
            code_generation_from_strings(),
            CodeGenerationFromStrings::Strict
        );
        assert_eq!(
            code_generation_from_strings_by_flags(),
            CodeGenerationFromStrings::DisallowedLikeNode
        );
        assert!(is_code_generation_disallowed_by_trimming());

        disallow_code_generation_from_strings(CodeGenerationFromStrings::Strict);
        assert_eq!(
            code_generation_from_strings(),
            CodeGenerationFromStrings::Strict
        );
        assert_eq!(
            code_generation_from_strings_by_flags(),
            CodeGenerationFromStrings::Strict
        );
        assert!(!is_code_generation_disallowed_by_trimming());
    }
}
