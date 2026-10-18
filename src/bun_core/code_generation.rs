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

    pub fn in_exec_argv(exec_argv: &[u8]) -> Self {
        let mut arguments: Vec<Box<crate::ZStr>> = vec![crate::ZStr::boxed(b"")];
        crate::append_options_env(exec_argv, &mut arguments);
        let levels = arguments[1..].iter().map(|argument| argument.as_bytes()).filter_map(|argument| match argument.strip_suffix(b"\0").unwrap_or(argument).strip_prefix(b"--disallow-code-generation-from-strings")? {
            b"" => Self::from_flag_value(b""),
            [b'=', value @ ..] => Self::from_flag_value(value),
            _ => None,
        });
        levels.max().unwrap_or(Self::Allowed)
    }
}

static LEVEL_IN_BUILT_EXECUTABLE: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(CodeGenerationFromStrings::Allowed as u8);

pub fn set_code_generation_from_strings_in_built_executable(level: CodeGenerationFromStrings) {
    LEVEL_IN_BUILT_EXECUTABLE.store(level as u8, core::sync::atomic::Ordering::Relaxed);
}

pub fn code_generation_from_strings_in_built_executable() -> CodeGenerationFromStrings {
    match LEVEL_IN_BUILT_EXECUTABLE.load(core::sync::atomic::Ordering::Relaxed) {
        0 => CodeGenerationFromStrings::Allowed,
        1 => CodeGenerationFromStrings::DisallowedLikeNode,
        _ => CodeGenerationFromStrings::Strict,
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
    static IS_INTERPRETER_REMOVED_BY_NAME: AtomicBool = AtomicBool::new(false);
    static LEVEL_FROM_FLAGS: AtomicU8 = AtomicU8::new(CodeGenerationFromStrings::Allowed as u8);

    fn level_of(level: &AtomicU8) -> CodeGenerationFromStrings {
        match level.load(Ordering::Relaxed) {
            0 => CodeGenerationFromStrings::Allowed,
            1 => CodeGenerationFromStrings::DisallowedLikeNode,
            _ => CodeGenerationFromStrings::Strict,
        }
    }

    pub fn code_generation_from_strings() -> CodeGenerationFromStrings {
        level_of(&LEVEL)
    }

    pub fn code_generation_from_strings_by_flags() -> CodeGenerationFromStrings {
        level_of(&LEVEL_FROM_FLAGS)
    }

    /// Raises the level. There is no way to lower it.
    pub fn disallow_code_generation_from_strings(level: CodeGenerationFromStrings) {
        LEVEL_FROM_FLAGS.fetch_max(level as u8, Ordering::Relaxed);
        LEVEL.fetch_max(level as u8, Ordering::Relaxed);
    }

    pub fn disallow_code_generation_in_trimmed_executable() {
        LEVEL.fetch_max(CodeGenerationFromStrings::Strict as u8, Ordering::Relaxed);
    }

    pub fn disallow_code_generation_without_interpreter() {
        IS_INTERPRETER_REMOVED_BY_NAME.store(true, Ordering::Relaxed);
        disallow_code_generation_in_trimmed_executable();
    }

    pub fn is_interpreter_removed_by_name() -> bool {
        IS_INTERPRETER_REMOVED_BY_NAME.load(Ordering::Relaxed)
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
    pub fn disallow_code_generation_in_trimmed_executable() {}

    #[inline(always)]
    pub fn disallow_code_generation_without_interpreter() {}

    #[inline(always)]
    pub const fn is_interpreter_removed_by_name() -> bool {
        false
    }
}

pub use level::{
    code_generation_from_strings, code_generation_from_strings_by_flags, disallow_code_generation_from_strings,
    disallow_code_generation_in_trimmed_executable, disallow_code_generation_without_interpreter, is_interpreter_removed_by_name,
};

pub fn is_code_generation_disallowed_by_trimming() -> bool {
    code_generation_from_strings() == CodeGenerationFromStrings::Strict
        && code_generation_from_strings_by_flags() != CodeGenerationFromStrings::Strict
}
