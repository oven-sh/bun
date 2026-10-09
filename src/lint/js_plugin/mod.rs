//! Rules that are written in JavaScript: the plugins of ESLint, as `jsPlugins` of an
//! `.oxlintrc.json` names them and `plugins` of an `eslint.config.js` has them.
//!
//! They run in a JavaScript realm ([`Vm`]) that whoever uses this module provides ([`Engine`]): in Bun a VM on a thread of
//! its own. What runs there is the [`PROGRAM`] in `worker/`: ESLint's API for rules, on top of what it asks this
//! side for. [`Host`] is what the linter talks to.
//!
//! The program is given the text of a file and which rules to run. Everything else it asks for the first time a rule needs
//! it, each in one piece, as arrays of numbers:
//! - `ast.rs`: the ESTree, written straight from the table of [`crate::estree`], and which nodes
//!   match the selectors that rules listen for, as [`crate::selector`] tells.
//! - `tokens.rs`: the tokens and the comments of [`crate::tokens`].
//! - `scopes.rs`: the scopes, variables and references of [`crate::semantic`].
//!
//! So a file for which every rule returns no listeners costs no more than its text. Nothing is kept here about a realm: one
//! that lacks a plugin, the options of a rule or the number of a selector says so.
//!
//! All offsets that the program sees are in UTF-16 code units, without the byte order mark.

mod ast;
mod engine;
mod eslint;
mod host;
mod offsets;
mod prettier;
mod processor;
mod rules;
mod schema;
mod scopes;
mod tokens;
mod wire;

pub use engine::{Demand, Engine, HEAVY, Serve, Vm};
pub use eslint::{Configuration, Linted, Refusal, Text};
pub use host::{Failure, Host, Loading, Report, Suggested};
pub use processor::{Block, Processor, Route, read_messages, write_messages};
pub(crate) use rules::has_what_json_lacks;
pub use rules::{Configured, FileSettings, Plugin, Rule, Schema};
#[doc(hidden)]
pub use schema::PROGRAM;
