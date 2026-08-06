#pragma once

#include "root.h"

// Classifies a JSValue as one of the Temporal object types, or 0 for
// everything else. Discriminants are shared with the Rust callers
// (`ConsoleObject.rs`, `pretty_format.rs`): 1 Instant, 2 PlainDateTime,
// 3 PlainDate, 4 PlainTime, 5 ZonedDateTime, 6 PlainYearMonth,
// 7 PlainMonthDay, 8 Duration. Defined in bindings.cpp.
extern "C" uint8_t Bun__JSValue__temporalObjectType(JSC::EncodedJSValue);

namespace Bun {

// The text `cell.toString()` would produce with default options (auto
// precision, `[TimeZone]`/`[u-ca=...]` annotations included), computed from
// the internal slots without calling any user-observable method.
// `temporalType` is a non-zero `Bun__JSValue__temporalObjectType` result for
// `cell`. May throw (ZonedDateTime offset lookups, Duration integer
// formatting); callers check the exception scope.
WTF::String temporalDisplayString(JSC::JSGlobalObject*, JSC::JSCell*, uint8_t temporalType);

} // namespace Bun

// `jsFunctionTemporalObjectType(value)` -> number 0-8 (the classifier above).
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalObjectType);
// `jsFunctionTemporalToDisplayString(value)` -> string, or undefined when
// `value` is not a Temporal object.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalToDisplayString);
