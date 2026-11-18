//! The objects and functions that scripts see.

#[macro_use]
mod define;
mod collator;
mod date_time_format;
mod display_names;
mod duration_format;
mod legacy;
mod list_format;
mod locale;
mod locales;
mod namespace;
mod number_format;
mod option_bag;
mod plural_rules;
mod relative_time_format;
mod results;
mod segmenter;
mod state;
mod string;
mod temporal;

use bun_engine_vm::{Cx, RealmSlot};
pub use collator::{compare_in_locale, locale_compare};
pub use date_time_format::date_to_locale_string;
pub use number_format::{bigint_to_locale_string, number_to_locale_string};
pub use state::set_preferred_languages;
pub use string::{normalize_string, to_locale_case};
pub use temporal::temporal_to_locale_string;

/// Sets the slot, and those that come with it. False if it belongs to another crate.
pub fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;

    let initialize = match slot {
        intl_object => namespace::initialize,
        intl_state => state::initialize,
        intl_fallback_symbol => legacy::initialize,
        intl_part_shape | intl_part_with_unit_shape | intl_part_with_source_shape => {
            results::initialize
        }
        collator_constructor | collator_shape => collator::initialize,
        date_time_format_constructor | date_time_format_shape => date_time_format::initialize,
        display_names_constructor | display_names_shape => display_names::initialize,
        duration_format_constructor | duration_format_shape => duration_format::initialize,
        list_format_constructor | list_format_shape => list_format::initialize,
        locale_constructor | locale_shape => locale::initialize,
        number_format_constructor | number_format_shape => number_format::initialize,
        plural_rules_constructor | plural_rules_shape => plural_rules::initialize,
        relative_time_format_constructor | relative_time_format_shape => {
            relative_time_format::initialize
        }
        segmenter_constructor | segmenter_shape => segmenter::initialize,
        segments_shape | segment_iterator_shape | segment_data_shape | word_segment_data_shape => {
            segmenter::initialize_segments
        }
        _ => return false,
    };
    initialize(cx);
    true
}

/// What nearly every module here uses.
mod prelude {
    pub(super) use bun_engine_macros::{cell, native_abi};
    pub(super) use bun_engine_text::{PropertyName, names, symbols};
    pub(super) use bun_engine_vm::{
        CallFrame, Cx, Field, Gc, GlobalObject, JsDestructibleObject, JsObject, JsObjectInit,
        JsResult, JsString, Shape, StaticProperty, Value, static_table,
    };

    pub(super) use super::define::{bind_method, getter};
    pub(super) use super::locales::{GENERAL_CONSTRUCTOR_PROPERTIES, canonicalize_locale_list};
    pub(super) use super::option_bag::OptionBag;
    pub(super) use super::results::{Record, named, parts_to_array, strings_to_array};
    pub(super) use super::state::{OrThrow, with_cache};
}
