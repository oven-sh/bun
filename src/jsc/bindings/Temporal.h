#pragma once

#include "root.h"

// 0 = not Temporal; 1 Instant, 2 PlainDateTime, 3 PlainDate, 4 PlainTime, 5 ZonedDateTime, 6 PlainYearMonth, 7 PlainMonthDay, 8 Duration.
extern "C" uint8_t Bun__JSValue__temporalObjectType(JSC::EncodedJSValue);

// (value) -> "Temporal.PlainDate" etc., or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalLabel);
// (value) -> the slot-derived default-options toString() text, or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalToDisplayString);
