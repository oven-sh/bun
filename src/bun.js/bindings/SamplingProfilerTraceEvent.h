#pragma once

#include "root.h"
#include "BunString.h"

namespace JSC {
class VM;
}

extern "C" {
void BunSamplingProfilerTraceEvent__start(JSC::VM* vm);
char* BunSamplingProfilerTraceEvent__stop(JSC::VM* vm);
}
