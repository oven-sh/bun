//! Safe bindings to the parts of ICU that Bun calls. A module for each service declares the functions it wraps.

include!(concat!(env!("OUT_DIR"), "/symbol.rs"));

#[macro_use]
mod ffi;
mod allocator;
mod argument;
pub mod break_iterator;
mod c_text;
pub mod calendar;
pub mod case_map;
pub mod collator;
pub mod currency;
pub mod date_format;
pub mod date_interval_format;
pub mod date_pattern;
mod default_locale;
pub mod display_names;
mod enumeration;
mod error;
mod exports;
pub mod formatted_value;
mod host_language;
pub mod idna;
pub mod list_format;
pub mod locale;
pub mod normalizer;
pub mod number_format;
pub mod numbering_system;
pub mod plural_rules;
pub mod relative_time_format;
pub mod resource_bundle;
pub mod time_zone;
mod version;

pub use allocator::use_default_allocator;
pub use c_text::CText;
pub use enumeration::Enumeration;
pub use error::{Error, Result};
pub use ffi::Buffer;
pub use host_language::host_language;
pub use version::{Version, library_version};
