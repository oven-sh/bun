#[path = "../diagnostics/shared.rs"]
pub mod shared;

pub use self::shared::{InternalError, Severity};
pub use crate::linked::bun_aot_log_diagnostic as log_diagnostic;
pub use crate::linked::bun_aot_log_locales_left_out as log_locales_left_out;
