#pragma once

#include "root.h"

// (value) -> "Temporal.PlainDate" etc., or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalLabel);
// (value) -> the slot-derived default-options toString() text, or undefined if not Temporal.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTemporalToDisplayString);
