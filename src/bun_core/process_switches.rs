//! The switches of this process (`code_generation`, `js_macros`) for a `bun` that it starts to run a part of the same command.

use core::ffi::CStr;
use core::iter::Chain;
use core::option::IntoIter;

use crate::{
    CODE_GENERATION_FROM_STRINGS_DISALLOWED_BY_BUILD, CodeGenerationFromStrings,
    code_generation_from_strings, js_macros_disabled,
};

/// As flags. Not `impl Iterator`: that would pin a `Vec<&CStr>` which is extended with it to `'static`.
pub fn flags_for_child() -> Chain<IntoIter<&'static CStr>, IntoIter<&'static CStr>> {
    // A build with the level as a constant gives it to the child without a flag, which nobody typed.
    let code_generation = if CODE_GENERATION_FROM_STRINGS_DISALLOWED_BY_BUILD {
        None
    } else {
        match code_generation_from_strings() {
            CodeGenerationFromStrings::Allowed => None,
            CodeGenerationFromStrings::DisallowedLikeNode => {
                Some(c"--disallow-code-generation-from-strings")
            }
            CodeGenerationFromStrings::Strict => {
                Some(c"--disallow-code-generation-from-strings=strict")
            }
        }
    };
    let macros = js_macros_disabled().then_some(c"--no-macros");
    code_generation.into_iter().chain(macros)
}

/// As `BUN_OPTIONS`, after what it holds now: every command of `bun` reads it. `None` when no switch is raised.
pub fn bun_options_for_child(current: Option<&[u8]>) -> Option<Vec<u8>> {
    let mut flags = flags_for_child().peekable();
    flags.peek()?;
    let mut options = current.unwrap_or_default().to_vec();
    for flag in flags {
        if !options.is_empty() {
            options.push(b' ');
        }
        options.extend_from_slice(flag.to_bytes());
    }
    Some(options)
}
