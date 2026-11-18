//! The objects and functions that scripts see.

#[macro_use]
mod define;
mod arguments;
mod duration;
mod fields;
mod getters;
mod instance;
mod instant;
mod methods;
mod namespace;
mod now;
mod options;
mod plain_date;
mod plain_date_time;
mod plain_month_day;
mod plain_time;
mod plain_year_month;
mod throw;
mod zone_names;
mod zoned_date_time;

use bun_engine_vm::{Cx, RealmSlot};
pub use duration::to_temporal_duration;
pub use instance::TemporalValue;
pub use instant::{instant_from_epoch_milliseconds, to_temporal_instant};
pub use plain_date::to_temporal_date;
pub use plain_date_time::to_temporal_date_time;
pub use plain_time::to_temporal_time;

/// Sets the slot, and those that come with it. False if it belongs to another crate.
pub fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;

    let initialize = match slot {
        temporal_object => namespace::initialize,
        temporal_now_object => now::initialize,
        temporal_zone_names => zone_names::initialize,
        temporal_duration_constructor | temporal_duration_shape => duration::initialize,
        temporal_instant_constructor | temporal_instant_shape => instant::initialize,
        temporal_plain_date_constructor | temporal_plain_date_shape => plain_date::initialize,
        temporal_plain_date_time_constructor | temporal_plain_date_time_shape => {
            plain_date_time::initialize
        }
        temporal_plain_month_day_constructor | temporal_plain_month_day_shape => {
            plain_month_day::initialize
        }
        temporal_plain_time_constructor | temporal_plain_time_shape => plain_time::initialize,
        temporal_plain_year_month_constructor | temporal_plain_year_month_shape => {
            plain_year_month::initialize
        }
        temporal_zoned_date_time_constructor | temporal_zoned_date_time_shape => {
            zoned_date_time::initialize
        }
        _ => return false,
    };
    initialize(cx);
    true
}

/// What nearly every module here uses.
mod prelude {
    pub(super) use bun_engine_macros::native_abi;
    pub(super) use bun_engine_text::{PropertyName, names, symbols};
    pub(super) use bun_engine_vm::{
        CallFrame, Cx, Gc, JsObject, JsResult, JsString, StaticProperty, Value, static_table,
    };

    pub(super) use super::arguments::get;
    pub(super) use super::define::{function, getter};
    pub(super) use super::instance::Instance;
    pub(super) use super::options::Options;
    pub(super) use super::throw::{OrThrow, throw};
    pub(super) use crate::Error;
}
