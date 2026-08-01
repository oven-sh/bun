#pragma once

#include "root.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

namespace Bun {

// Appends FunctionHasExecutedCache ranges for `sourceID` onto `basicBlocks` as
// BasicBlockRange entries, skipping the phantom default-class-constructor entries
// JSC records against the owner source. See CodeCoverage.cpp for the full
// explanation of why those entries exist and why they can never be cleared.
void appendFunctionRangesForCoverage(Vector<JSC::BasicBlockRange>& basicBlocks, JSC::VM& vm, JSC::SourceID sourceID);

}
