#include "root.h"
#include "helpers.h"
#include "BunCPUProfiler.h"
#include "NodeValidator.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ControlFlowProfiler.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/FunctionHasExecutedCache.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/JSONValues.h>

extern "C" bool InspectorCoverage__remapOffsets(BunString sourceURL, BunString transpiled, int32_t* offsets, size_t count, uint32_t* outOriginalLen);

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
// this point on are instrumented; recompiling would corrupt live TLA modules.
JSC_DECLARE_HOST_FUNCTION(jsFunction_startPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_startPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    globalObject->vm().enableControlFlowProfiler();
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_stopPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_stopPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    globalObject->vm().disableControlFlowProfiler();
    return JSValue::encode(jsUndefined());
}

// Returns a JSON string describing every script the control flow profiler has
// data for: [{ url, scriptId, sourceLength, blocks: [[start, end, count]],
// functions: [[start, end, executed, name]] }]. The JS layer in
// node/inspector.ts reshapes this into the V8 ScriptCoverage format.
JSC_DECLARE_HOST_FUNCTION(jsFunction_collectPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_collectPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    auto* profiler = vm.controlFlowProfiler();
    if (!profiler)
        return JSValue::encode(jsNull());

    // FunctionHasExecutedCache carries no names, so also index each live
    // FunctionExecutable's ecmaName by (functionStart, functionEnd) during the
    // same ScriptExecutable-subspace walk that enumerates SourceIDs. The key
    // packs both offsets so it is never 0 (WTF's empty integer hash key).
    Vector<Ref<JSC::SourceProvider>> providers;
    HashSet<SourceID> seenSourceIDs;
    UncheckedKeyHashMap<SourceID, UncheckedKeyHashMap<uint64_t, String>> functionNames;
    auto rangeKey = [](unsigned start, unsigned end) -> uint64_t {
        return (static_cast<uint64_t>(start) << 32) | static_cast<uint64_t>(end);
    };
    {
        HeapIterationScope iterationScope(vm.heap);
        vm.heap.forEachScriptExecutableSpace([&](auto& spaceAndSet) {
            spaceAndSet.space.forEachLiveCell([&](HeapCell* cell, HeapCell::Kind) {
                auto* executable = static_cast<ScriptExecutable*>(cell);
                auto* provider = executable->source().provider();
                if (!provider)
                    return;
                SourceID sourceID = provider->asID();
                if (seenSourceIDs.add(sourceID).isNewEntry)
                    providers.append(*provider);
                if (executable->type() == FunctionExecutableType) {
                    auto* fn = static_cast<FunctionExecutable*>(executable);
                    // functionStart()/End() == typeProfilingStart/End(), the same offsets FunctionHasExecutedCache stores.
                    functionNames.add(sourceID, UncheckedKeyHashMap<uint64_t, String> {})
                        .iterator->value.add(rangeKey(fn->functionStart(), fn->functionEnd()), fn->ecmaName().string());
                }
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

        // JSC's offsets index the runtime-transpiled text for Bun-loaded modules
        // (comments stripped, classes hoisted, TS lowered); remap them through
        // the saved sourcemap to original-file bytes so V8-coverage consumers
        // that slice the on-disk file see the right text. vm.Script/eval have
        // no saved sourcemap, so the remap call returns false for those.
        Vector<int32_t> remap;
        remap.reserveInitialCapacity(blocks.size() * 2 + functionRanges.size() * 2);
        for (const auto& block : blocks) {
            remap.append(block.m_startOffset);
            remap.append(block.m_endOffset);
        }
        for (const auto& functionRange : functionRanges) {
            remap.append(static_cast<int32_t>(std::get<1>(functionRange)));
            remap.append(static_cast<int32_t>(std::get<2>(functionRange)));
        }
        uint32_t sourceLength = provider->source().length();
        auto transpiledSource = provider->source().toStringWithoutCopying();
        bool remapped = InspectorCoverage__remapOffsets(
            Bun::toString(provider->sourceURL()),
            Bun::toString(transpiledSource),
            remap.begin(),
            remap.size(),
            &sourceLength);

        auto script = JSON::Object::create();
        // A `//# sourceURL` directive overrides the script's resource name,
        // like it does in V8's coverage output.
        const String& sourceURLDirective = provider->sourceURLDirective();
        script->setString("url"_s, sourceURLDirective.isEmpty() ? provider->sourceURL() : sourceURLDirective);
        script->setDouble("scriptId"_s, static_cast<double>(sourceID));
        script->setDouble("sourceLength"_s, static_cast<double>(sourceLength));

        auto namesForSource = functionNames.find(sourceID);
        size_t i = 0;
        // Emit raw offsets (for the JS layer's containment sort) and, when remapped, original-file offsets.
        auto blockArray = JSON::Array::create();
        for (const auto& block : blocks) {
            auto range = JSON::Array::create();
            range->pushInteger(block.m_startOffset);
            range->pushInteger(block.m_endOffset);
            range->pushDouble(static_cast<double>(block.m_executionCount));
            if (remapped) {
                range->pushInteger(remap[i]);
                range->pushInteger(remap[i + 1]);
            }
            i += 2;
            blockArray->pushValue(WTF::move(range));
        }
        script->setValue("blocks"_s, WTF::move(blockArray));

        auto functionArray = JSON::Array::create();
        for (const auto& functionRange : functionRanges) {
            auto range = JSON::Array::create();
            range->pushInteger(static_cast<int32_t>(std::get<1>(functionRange)));
            range->pushInteger(static_cast<int32_t>(std::get<2>(functionRange)));
            range->pushBoolean(std::get<0>(functionRange));
            String name = emptyString();
            if (namesForSource != functionNames.end()) {
                auto found = namesForSource->value.find(rangeKey(std::get<1>(functionRange), std::get<2>(functionRange)));
                if (found != namesForSource->value.end())
                    name = found->value;
            }
            range->pushString(name);
            if (remapped) {
                range->pushInteger(remap[i]);
                range->pushInteger(remap[i + 1]);
            }
            i += 2;
            functionArray->pushValue(WTF::move(range));
        }
        script->setValue("functions"_s, WTF::move(functionArray));

        scripts->pushValue(WTF::move(script));
    }

    return JSValue::encode(jsString(vm, scripts->toJSONString()));
}
