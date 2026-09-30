// internal/tspath: one module per upstream file, re-exported as the package's namespace.
pub mod extension;
pub mod path;

pub use extension::*;
pub use path::*;
