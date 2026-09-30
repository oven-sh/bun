// internal/pseudochecker: one module per upstream file, re-exported as the package's namespace.
pub mod checker;
pub mod lookup;
pub mod r#type;

pub use checker::*;
pub use lookup::*;
pub use r#type::*;
