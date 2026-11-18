use bun_engine_vm::RealmSlot;

use super::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::realm_slot(names::Duration, RealmSlot::temporal_duration_constructor),
    StaticProperty::realm_slot(names::Instant, RealmSlot::temporal_instant_constructor),
    StaticProperty::realm_slot(names::Now, RealmSlot::temporal_now_object),
    StaticProperty::realm_slot(names::PlainDate, RealmSlot::temporal_plain_date_constructor),
    StaticProperty::realm_slot(
        names::PlainDateTime,
        RealmSlot::temporal_plain_date_time_constructor
    ),
    StaticProperty::realm_slot(names::PlainTime, RealmSlot::temporal_plain_time_constructor),
    StaticProperty::realm_slot(
        names::PlainMonthDay,
        RealmSlot::temporal_plain_month_day_constructor
    ),
    StaticProperty::realm_slot(
        names::PlainYearMonth,
        RealmSlot::temporal_plain_year_month_constructor
    ),
    StaticProperty::realm_slot(
        names::ZonedDateTime,
        RealmSlot::temporal_zoned_date_time_constructor
    ),
    StaticProperty::string(symbols::toStringTag, names::Temporal),
]);

define_object!(TemporalObject, "Temporal", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    cx.global().init_temporal_object(TemporalObject::create(cx));
}
