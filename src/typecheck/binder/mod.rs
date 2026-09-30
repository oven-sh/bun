// internal/binder: one module per upstream file, re-exported as the package's namespace.
pub mod binder;
pub mod nameresolver;
pub mod referenceresolver;

pub use binder::*;
pub use nameresolver::*;
pub use referenceresolver::*;
