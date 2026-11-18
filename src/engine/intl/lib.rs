//! The `Intl` object.

#![forbid(unsafe_code)]
#![feature(maybe_uninit_fill, negative_impls, once_cell_try)]
#![allow(improper_ctypes_definitions)]

#[macro_use]
mod options;
mod available_locales;
mod cache;
mod calendar;
mod classes;
mod collation;
pub mod collator;
pub mod date_time_format;
mod default_instances;
pub mod display_names;
pub mod duration_format;
mod error;
mod language_tag;
mod latin1;
pub mod list_format;
pub mod locale;
mod locale_case;
mod locale_list;
mod locale_resolver;
mod normalize;
pub mod number_format;
mod numbering_system;
mod parts;
pub mod plural_rules;
mod recent;
pub mod relative_time_format;
pub mod segmenter;
mod supported_values;
mod utf16;

pub use available_locales::AvailableLocales;
pub use cache::Cache;
pub use classes::{
    bigint_to_locale_string, compare_in_locale, date_to_locale_string, initialize_slot,
    locale_compare, normalize_string, number_to_locale_string, set_preferred_languages,
    temporal_to_locale_string, to_locale_case,
};
pub use error::{Error, ErrorKind, Result};
pub use language_tag::{KeywordValue, LanguageTag};
pub use locale_case::{Case, transform_case};
pub use locale_list::LocaleList;
pub use normalize::{NormalizationForm, normalize};
pub use numbering_system::NumberingSystem;
pub use options::{HourCycle, LocaleMatcher, Named, OptionValue, Style, integer_option};
pub use parts::{Part, PartKind, Parts, Source, TimeUnit};
pub use supported_values::supported_values_of;
