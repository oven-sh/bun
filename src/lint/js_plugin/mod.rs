//! Rules that are written in JavaScript: the plugins of ESLint, as `jsPlugins` of an
//! `.oxlintrc.json` names them and `plugins` of an `eslint.config.js` has them.
//!
//! They run in processes of their own, the workers: the running executable with the program in
//! `worker/`. A worker loads the plugins once. Then it is given one file after the other, and
//! answers each with what the rules report. [`Host`] has the workers, and is what the linter talks
//! to.
//!
//! A worker is sent the text of a file and which rules to run. Everything else it asks for the
//! first time a rule needs it, each in one piece, as arrays of numbers:
//! - `ast.rs`: the ESTree, written straight from the table of [`crate::estree`], and which nodes
//!   match the selectors that rules listen for, as [`crate::selector`] tells.
//! - `tokens.rs`: the tokens and the comments of [`crate::tokens`].
//! - `scopes.rs`: the scopes, variables and references of [`crate::semantic`].
//!
//! So a file for which every rule returns no listeners costs no more than its text.
//!
//! All offsets that a worker sees are in UTF-16 code units, without the byte order mark.

mod ast;
mod host;
mod offsets;
mod rules;
mod schema;
mod scopes;
mod tokens;
mod wire;

pub use host::{Channel, Failure, Host, Report, Spawn, Suggested};
pub use rules::{Configured, FileSettings, Plugin, Rule, Schema};
#[doc(hidden)]
pub use schema::PROGRAM;

/// What a worker is started with: `bun -e BOOTSTRAP`. It reads what [`Channel::send`] sends from the file descriptor 3, and
/// what it writes to 4 is for [`Channel::receive`]. Both are pipes that block. Its standard output is for what plugins
/// print, and should be the standard error of this process.
pub const BOOTSTRAP: &str = include_str!("worker/bootstrap.js");
