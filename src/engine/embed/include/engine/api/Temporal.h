#pragma once

// Instances of the classes of `Temporal`.

#include "engine/api/GlobalObject.h"

namespace JSC {

enum class TemporalType : uint8_t {
    None = Engine::TemporalType::None,
    Instant = Engine::TemporalType::Instant,
    PlainDateTime = Engine::TemporalType::PlainDateTime,
    PlainDate = Engine::TemporalType::PlainDate,
    PlainTime = Engine::TemporalType::PlainTime,
    ZonedDateTime = Engine::TemporalType::ZonedDateTime,
    PlainYearMonth = Engine::TemporalType::PlainYearMonth,
    PlainMonthDay = Engine::TemporalType::PlainMonthDay,
    Duration = Engine::TemporalType::Duration,
};

inline TemporalType temporalType(JSValue value) { return value.isObject() ? Engine::temporal_type(asObject(value)) : TemporalType::None; }
// Whether they are of one type, and all their internal slots have the same.
inline bool temporalObjectsHoldTheSame(JSObject* a, JSObject* b) { return Engine::temporal_objects_hold_the_same(a, b); }
// What `from` of Instant, PlainDateTime, PlainDate or PlainTime returns.
inline JSObject* temporalObjectFrom(JSGlobalObject* globalObject, TemporalType type, JSValue item) { return Engine::temporal_object_from(globalObject, type, item); }

// Of an Instant or a ZonedDateTime.
inline Int128 temporalEpochNanoseconds(JSObject* object)
{
    uint64_t low;
    int64_t high = Engine::temporal_epoch_nanoseconds(object, low);
    return static_cast<Int128>(high) << 64 | low;
}
// The same. It ends with `Z` if there is no offset.
inline String temporalExactTimeToString(JSObject* object, std::optional<int16_t> offsetMinutes) { return Engine::temporal_exact_time_to_string(object, !!offsetMinutes, offsetMinutes.value_or(0)); }
// Of a ZonedDateTime.
inline int64_t temporalOffsetNanoseconds(JSObject* object) { return Engine::temporal_offset_nanoseconds(object); }
// Of a PlainDateTime, a PlainDate or a PlainTime, without the calendar.
inline String temporalPlainValueToString(JSObject* object) { return Engine::temporal_plain_value_to_string(object); }

} // namespace JSC
