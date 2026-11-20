#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

// bun_telemetry::ENABLED, an AtomicU32 with a bit for each bun_telemetry::Instrument.
extern "C" uint32_t Bun__Telemetry__enabled;
extern "C" const uint32_t Bun__Telemetry__httpServerBit;
extern "C" const uint32_t Bun__Telemetry__sqliteBit;

namespace Bun::Telemetry {

ALWAYS_INLINE bool isEnabled(uint32_t instrumentBit) { return __atomic_load_n(&Bun__Telemetry__enabled, __ATOMIC_ACQUIRE) & instrumentBit; }

void addValuesOfOtel(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* otel);

// An AsyncContextFrame runs its callback in the async context it captured. The answer runs it there too, under the span that is active now.
JSC::JSValue callbackUnderActiveSpan(Zig::GlobalObject*, JSC::JSValue callback);

}
