#pragma once

// Settings of the process. They are fixed when the first VM is made.

#include "engine/api/GlobalObject.h"

namespace JSC {

class Options {
public:
#define ENGINE_OPTION(name) \
    static auto& name() { return s_values.name; }
    ENGINE_OPTION(alwaysUseSharedArrayBuffer)
    ENGINE_OPTION(defaultErrorStackTraceLimit)
    ENGINE_OPTION(disallowNonStaticCode)
    ENGINE_OPTION(dumpSimulatedThrows)
    ENGINE_OPTION(evalMode)
    ENGINE_OPTION(heapGrowthMaxIncrease)
    ENGINE_OPTION(heapGrowthSteepnessFactor)
    ENGINE_OPTION(largeHeapSize)
    ENGINE_OPTION(numberOfGCMarkers)
    ENGINE_OPTION(showPrivateScriptsInStackTraces)
    ENGINE_OPTION(thresholdForFTLOptimizeAfterWarmUp)
    ENGINE_OPTION(useAsyncStackTrace)
    ENGINE_OPTION(useBBQJIT)
    ENGINE_OPTION(useConcurrentJIT)
    ENGINE_OPTION(useControlFlowProfiler)
    ENGINE_OPTION(useGC)
    ENGINE_OPTION(useJIT)
    ENGINE_OPTION(usePrelinkedModuleInfo)
    ENGINE_OPTION(useSamplingProfiler)
    ENGINE_OPTION(useShadowRealm)
    ENGINE_OPTION(useTemporal)
    ENGINE_OPTION(useWasm)
    ENGINE_OPTION(useWasmIPInt)
    ENGINE_OPTION(validateExceptionChecks)
#undef ENGINE_OPTION

    // Takes `name=value`. False if there is no such option or the value does not suit it.
    static bool setOption(const char* assignment);
    static bool areFrozen() { return s_areFrozen; }

private:
    friend class VM;
    friend void initialize(const ScopedLambda<void()>&);

    static void freeze();

    static Engine::Options s_values;
    static bool s_areFrozen;
};

// Once, before anything else. The options have their defaults when the function is called.
void initialize(const ScopedLambda<void()>& customizeOptions);

inline uintptr_t startOfExecutableMemory() { return Engine::executable_memory_start(); }
#if OS(WINDOWS)
// Once. For the structured exceptions that get to a frame of generated code.
inline void setExceptionHandlerOfGeneratedCode(int32_t (*handler)(void* record, void* frame, void* context, void* dispatcher)) { Engine::executable_memory_set_exception_handler(handler); }
#endif

} // namespace JSC
