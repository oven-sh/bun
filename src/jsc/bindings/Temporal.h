#pragma once

#include "root.h"

// 0 for non-Temporal values, otherwise 1 Instant, 2 PlainDateTime, 3 PlainDate,
// 4 PlainTime, 5 ZonedDateTime, 6 PlainYearMonth, 7 PlainMonthDay, 8 Duration.
extern "C" uint8_t Bun__JSValue__temporalObjectType(JSC::EncodedJSValue);

// `jsFunctionTemporalLabel(value)` -> e.g. "Temporal.PlainDate", or undefined
// if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalLabel);
// `jsFunctionTemporalToDisplayString(value)` -> the value's default-options
// `toString()` text, or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalToDisplayString);
