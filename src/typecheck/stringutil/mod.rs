// internal/stringutil: one module per upstream file, re-exported as the package's namespace.
pub mod compare;
pub mod identifier;
pub mod identifier_parts_generated;
pub mod js_case;
pub mod js_case_generated;
pub mod util;

pub use compare::*;
pub use identifier::*;
pub use js_case::*;
pub use util::*;
