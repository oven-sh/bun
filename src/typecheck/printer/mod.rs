// internal/printer: one module per upstream file, re-exported as the package's namespace.
pub mod emitcontext;
pub mod emitflags;
pub mod emitresolver;
pub mod emittextwriter;
pub mod factory;
pub mod generatedidentifierflags;
pub mod namegenerator;
pub mod printer;
pub mod semicolon_writer;
pub mod singlelinestringwriter;
pub mod textwriter;
pub mod utilities;

pub use emitcontext::*;
pub use emitflags::*;
pub use emitresolver::*;
pub use emittextwriter::*;
pub use factory::*;
pub use generatedidentifierflags::*;
pub use namegenerator::*;
pub use printer::*;
pub use semicolon_writer::*;
pub use singlelinestringwriter::*;
pub use textwriter::*;
pub use utilities::*;
