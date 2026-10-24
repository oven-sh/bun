#[path = "../diagnostics/shared.rs"]
pub mod shared;

use bun_ast::Log;

pub use self::shared::{InternalError, Severity};
use crate::diagnostic_codes::Code;
use crate::linked;

pub fn log_diagnostic(log: &mut Log, code: Code, arguments: &[&[u8]]) {
    linked::bun_aot_log_diagnostic(log, code, arguments);
}

pub fn log_internal_error(log: &mut Log, error: InternalError) {
    linked::bun_aot_log_internal_error(log, error);
}
