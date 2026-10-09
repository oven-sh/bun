//! The prelude: built-ins that call back into the program, written in TypeScript (`prelude/*.ts`) and compiled with every program.
//!
//! The engine's table binds a built-in to a function of the prelude (`Prelude(..)` in Source/JavaScriptCore/aot/builtins/*.def). Where the
//! receiver of a call has its original structure, or there is none, the engine calls that function directly and inlines it, and the
//! callback into it.
//!
//! The files are handed to the checker as files of the bundle that are on no disk. They are only code: they are not checked, declare nothing
//! that the program sees, and no module imports them. A function of theirs is in the program only if the program calls or reads
//! something by the name of its built-in: `link::Reach::prelude`. It is flagged `func_flags::IS_BUILTIN`.
//!
//! `$name(..)` in a file of the prelude is the operation `Name` of the engine: an `intrinsic` of the table.

pub use crate::builtins_generated::{PRELUDE_FILES as FILES, PRELUDE_FUNCTIONS as FUNCTIONS};

/// Where the file of that name is to the checker, given the directory the program is built in. In the format of `root`, native or the
/// checker's. For `Request::code` and `Provided::already_read` of the driver.
pub fn path_of(root: &[u8], name: &str) -> Vec<u8> {
    let root = root.strip_suffix(b"/").unwrap_or(root);
    [root, b"/.bun-aot-prelude/", name.as_bytes()].concat()
}
