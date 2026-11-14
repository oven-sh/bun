#[path = "../diagnostics/shared.rs"]
pub mod shared;

pub use self::shared::{InternalError, Severity};
pub use crate::linked::bun_aot_log_diagnostic as log_diagnostic;
