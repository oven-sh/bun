#pragma once

#include "root.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

namespace Bun {

// Appends FunctionHasExecutedCache ranges onto `basicBlocks`, dropping the phantom
// default-class-constructor entries JSC records against the owner SourceID.
void appendFunctionRangesForCoverage(Vector<JSC::BasicBlockRange>& basicBlocks, JSC::VM& vm, JSC::SourceID sourceID);

}
