#pragma once

#include "root.h"

// 0 for non-Temporal values, otherwise 1-8 per the discriminant table at the
// definition in bindings.cpp (shared with the Rust and JS callers).
extern "C" uint8_t Bun__JSValue__temporalObjectType(JSC::EncodedJSValue);

namespace Bun {

// The default-options `toString()` text for a Temporal `cell` whose non-zero
// classifier result is `temporalType`, built from internal slots. May throw
// (ZonedDateTime offset lookups, Duration integer formatting).
WTF::String temporalDisplayString(JSC::JSGlobalObject*, JSC::JSCell*, uint8_t temporalType);

} // namespace Bun

// `jsFunctionTemporalObjectType(value)` -> number 0-8 (the classifier above).
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalObjectType);
// `jsFunctionTemporalToDisplayString(value)` -> string, undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalToDisplayString);
