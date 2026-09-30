// internal/printer: one module per upstream file, re-exported as the package's namespace.
pub mod emittextwriter;
pub mod semicolon_writer;
pub mod singlelinestringwriter;
pub mod textwriter;

pub use emittextwriter::*;
pub use semicolon_writer::*;
pub use singlelinestringwriter::*;
pub use textwriter::*;
