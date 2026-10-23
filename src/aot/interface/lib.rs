pub mod builtins;
pub mod compile;
#[path = "../diagnostic_codes.rs"]
pub mod diagnostic_codes;
pub mod diagnostics;
pub mod engine;
pub mod ir;
pub mod link;
mod linked;
pub mod load;
#[path = "../module_list.rs"]
pub mod module_list;
mod opaque;
#[path = "../options.rs"]
pub mod options;
pub mod report;
pub mod statistics;

pub use compile::{BuildFailed, Compilation, compile};
pub use linked::signatures;
pub use load::source_provider::{SourceProvider, WithoutServices};
pub use opaque::Opaque;
pub use options::Options;
