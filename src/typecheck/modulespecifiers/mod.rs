// internal/modulespecifiers: one module per upstream file, re-exported as the package's namespace.
pub mod compare;
pub mod specifiers;
pub mod types;

pub use compare::*;
pub use specifiers::*;
pub use types::*;
