#pragma once

#include "root.h"

namespace Bun {

// Shared with Rust (`bun_jsc::TemporalType`); keep the discriminants in sync.
enum class TemporalType : uint8_t {
    None = 0,
    Instant = 1,
    PlainDateTime = 2,
    PlainDate = 3,
    PlainTime = 4,
    ZonedDateTime = 5,
    PlainYearMonth = 6,
    PlainMonthDay = 7,
    Duration = 8,
};

TemporalType temporalObjectType(JSC::JSValue);

}

// (value) -> "Temporal.PlainDate" etc., or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalLabel);
// (value) -> the slot-derived default-options toString() text, or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalToDisplayString);
