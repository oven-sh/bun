//! Rules written in JavaScript: ESLint plugins, listed in `jsPlugins` of an `.oxlintrc.json` or in `plugins` of an
//! `eslint.config.js`.
//!
//! They run in a JavaScript realm ([`Vm`]) provided by the user of this module ([`Engine`]). In Bun that's a VM owned
//! by a linting thread. The realm runs the [`PROGRAM`] in `worker/`, which implements ESLint's rule API on top of the
//! data it requests from this side. The linter talks to [`Host`].
//!
//! The program gets a file's text and the list of rules to run. It requests everything else the first time a rule needs
//! it, each in one piece, as arrays of numbers:
//! - `ast.rs`: the ESTree, written straight from the table in [`crate::estree`], and which nodes match the selectors
//!   that rules listen for, according to [`crate::selector`].
//! - `tokens.rs`: the tokens and comments from [`crate::tokens`].
//! - `scopes.rs`: the scopes, variables and references from [`crate::semantic`].
//! - [`crate::code_path::estree`]: the code paths, their segments and the events, if a rule listens for one.
//!
//! So a file where no rule returns a listener only costs its text. This side keeps no per-realm state: a realm that's
//! missing a plugin, a rule's options or a selector's number asks for it.
//!
//! All offsets the program sees are UTF-16 code units and don't count the byte order mark.

mod ast;
mod calls;
mod directives;
mod engine;
mod eslint;
mod host;
mod layouts;
mod prettier;
mod processor;
mod reports;
mod rules;
mod schema;
mod scopes;
mod tokens;
pub(crate) mod wire;

pub use engine::{Demand, Engine, HEAVY, Serve, Vm, Work};
pub use eslint::{Configuration, EslintFailure, Linted, Text};
pub use host::{Failure, Host, Loading, ParseAgain, Report, Suggested, ThrownAt};
pub use prettier::Unformatted;
pub use processor::{Block, Processor, Route, read_messages, write_messages};
pub(crate) use rules::has_non_json_value;
pub use rules::{Configured, FileSettings, Plugin, Rule, Schema};
#[doc(hidden)]
pub use schema::{eslint_patch, program};
