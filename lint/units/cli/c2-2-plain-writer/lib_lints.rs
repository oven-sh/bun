//! Lint probe: the three modules as the crate has them, against a stand-in of `crate::diagnostic`.

#[path = "gen/diagnosticwriter.rs"]
pub mod diagnosticwriter;
#[path = "gen/scanner.rs"]
pub mod scanner;
#[path = "gen_plain/tspath.rs"]
pub mod tspath;

#[allow(clippy::all, dead_code, unreachable_pub)]
#[path = "standin_diagnostic.rs"]
pub mod diagnostic;
