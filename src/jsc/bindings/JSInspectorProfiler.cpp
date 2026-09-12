#include "root.h"
#include "helpers.h"
#include "BunCPUProfiler.h"
#include "CodeCoverage.h"
#include "NodeValidator.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ControlFlowProfiler.h>
#include <JavaScriptCore/FunctionHasExecutedCache.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/JSONValues.h>

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunction_startCPUProfiler);
JSC_DEFINE_HOST_FUNCTION(jsFunction_startCPUProfiler, (JSGlobalObject * globalObject, CallFrame*))
{
    Bun::startCPUProfiler(globalObject->vm());
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_stopCPUProfiler);
JSC_DEFINE_HOST_FUNCTION(jsFunction_stopCPUProfiler, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    WTF::String result;
    Bun::stopCPUProfiler(vm, &result, nullptr);
    return JSValue::encode(jsString(vm, result));
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_setCPUSamplingInterval);
JSC_DEFINE_HOST_FUNCTION(jsFunction_setCPUSamplingInterval, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, createNotEnoughArgumentsError(globalObject));
        return {};
    }

    int interval;
    Bun::V::validateInteger(scope, globalObject, callFrame->uncheckedArgument(0), "interval"_s, jsNumber(1), jsUndefined(), &interval);
    RETURN_IF_EXCEPTION(scope, {});

    Bun::setSamplingInterval(interval);
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_isCPUProfilerRunning);
JSC_DEFINE_HOST_FUNCTION(jsFunction_isCPUProfilerRunning, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsBoolean(Bun::isCPUProfilerRunning()));
}

// Precise code coverage via JSC's control-flow profiler. Unlike V8 (which
// deopts and instruments already-compiled code), only functions compiled from
// this point on are instrumented: JSC's own toggle recompiles everything
// (deleteAllCode when idle), which would corrupt suspended TLA module bodies.
//
// Compiled instrumented code writes through raw BasicBlockLocation pointers the
// profiler owns (op_profile_control_flow), so without that recompile the
// profiler can never be freed again once code has been compiled against it: it
// is enabled once and stays for the VM's lifetime. "stop" is protocol state in
// node/inspector.ts only.
JSC_DECLARE_HOST_FUNCTION(jsFunction_startPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_startPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    if (!vm.controlFlowProfiler())
        vm.enableControlFlowProfiler();
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_stopPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_stopPreciseCoverage, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsUndefined());
}

// Returns a JSON string describing every script the control flow profiler has
// data for: [{ url, scriptId, sourceLength, blocks: [[start, end, count]],
// functions: [[start, end, executed]] }]. The JS layer in node/inspector.ts
// reshapes this into the V8 ScriptCoverage format.
JSC_DECLARE_HOST_FUNCTION(jsFunction_collectPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_collectPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    auto* profiler = vm.controlFlowProfiler();
    if (!profiler)
        return JSValue::encode(jsNull());

    // Enumerate SourceIDs by walking only the four ScriptExecutable subspaces
    // (not the whole heap). Providers whose executables were all GC'd are not
    // reported, and offsets index the transpiled source for Bun-loaded modules;
    // Bun appends an inline //# sourceMappingURL, so consumers that read the
    // script source (v8-to-istanbul) can remap.
    Vector<Ref<JSC::SourceProvider>> providers;
    HashSet<SourceID> seenSourceIDs;
    {
        HeapIterationScope iterationScope(vm.heap);
        vm.heap.forEachScriptExecutableSpace([&](auto& spaceAndSet) {
            spaceAndSet.space.forEachLiveCell([&](HeapCell* cell, HeapCell::Kind) {
                auto* executable = static_cast<ScriptExecutable*>(cell);
                auto* provider = executable->source().provider();
                if (!provider)
                    return;
                if (!seenSourceIDs.add(provider->asID()).isNewEntry)
                    return;
                providers.append(*provider);
            });
        });
    }

    auto scripts = JSON::Array::create();
    for (auto& provider : providers) {
        SourceID sourceID = provider->asID();
        auto blocks = profiler->getBasicBlocksForSourceIDWithoutFunctionRange(sourceID, vm);
        auto functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);
        if (blocks.isEmpty() && functionRanges.isEmpty())
            continue;

        auto script = JSON::Object::create();
        // A `//# sourceURL` directive overrides the script's resource name,
        // like it does in V8's coverage output.
        const String& sourceURLDirective = provider->sourceURLDirective();
        script->setString("url"_s, sourceURLDirective.isEmpty() ? provider->sourceURL() : sourceURLDirective);
        script->setDouble("scriptId"_s, static_cast<double>(sourceID));
        script->setDouble("sourceLength"_s, static_cast<double>(provider->source().length()));

        auto blockArray = JSON::Array::create();
        for (const auto& block : blocks) {
            auto range = JSON::Array::create();
            range->pushInteger(block.m_startOffset);
            range->pushInteger(block.m_endOffset);
            range->pushDouble(static_cast<double>(block.m_executionCount));
            blockArray->pushValue(WTF::move(range));
        }
        script->setValue("blocks"_s, WTF::move(blockArray));

        auto functionArray = JSON::Array::create();
        for (const auto& functionRange : functionRanges) {
            bool hasExecuted = std::get<0>(functionRange);
            int start = static_cast<int>(std::get<1>(functionRange));
            int end = static_cast<int>(std::get<2>(functionRange));
            if (Bun::isSynthesizedDefaultConstructorRange(hasExecuted, start, end))
                continue;
            auto range = JSON::Array::create();
            range->pushDouble(static_cast<double>(start));
            range->pushDouble(static_cast<double>(end));
            range->pushBoolean(hasExecuted);
            functionArray->pushValue(WTF::move(range));
        }
        script->setValue("functions"_s, WTF::move(functionArray));

        scripts->pushValue(WTF::move(script));
    }

    return JSValue::encode(jsString(vm, scripts->toJSONString()));
}
