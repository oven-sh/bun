// internal/collections: one module per upstream file, re-exported as the package's namespace.
pub mod cow;
pub mod multimap;
pub mod ordered_map;
pub mod ordered_set;
pub mod set;

pub use cow::*;
pub use multimap::*;
pub use ordered_map::*;
pub use ordered_set::*;
pub use set::*;
