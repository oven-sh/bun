#![allow(dead_code, unreachable_pub)]

#[path = "../ir/generated/compile_call_enums.rs"]
pub mod compile_call_enums;
#[path = "../ir/generated/diagnostics.rs"]
pub mod diagnostics;
#[path = "../ir/generated/limits.rs"]
pub mod limits;
#[path = "../ir/generated/statistics.rs"]
pub mod statistics;

pub use compile_call_enums::*;
pub use diagnostics::*;
pub use limits::*;
pub use statistics::*;
