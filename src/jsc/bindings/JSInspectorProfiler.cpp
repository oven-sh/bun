#include "root.h"
#include "helpers.h"
#include "BunCPUProfiler.h"
#include "NodeValidator.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ControlFlowProfiler.h>
#include <JavaScriptCore/FunctionHasExecutedCache.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/FunctionExecutable.h>
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

// Precise code coverage via JSC's control-flow profiler. Only newly generated
// bytecode carries op_profile_control_flow, so also deleteAllCode() (deferred
// via VM::whenIdle) so already-loaded functions recompile instrumented.
JSC_DECLARE_HOST_FUNCTION(jsFunction_startPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_startPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    if (vm.enableControlFlowProfiler())
        vm.deleteAllCode(PreventCollectionAndDeleteAllCode);
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_stopPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_stopPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    if (vm.disableControlFlowProfiler())
        vm.deleteAllCode(PreventCollectionAndDeleteAllCode);
    return JSValue::encode(jsUndefined());
}

// Returns a JSON string describing every script the control flow profiler has
// data for: [{ url, scriptId, sourceLength, blocks: [[start, end, count]],
// functions: [[start, end, name]] }]. node/inspector.ts reshapes it to V8 form.
JSC_DECLARE_HOST_FUNCTION(jsFunction_collectPreciseCoverage);
JSC_DEFINE_HOST_FUNCTION(jsFunction_collectPreciseCoverage, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    auto* profiler = vm.controlFlowProfiler();
    if (!profiler)
        return JSValue::encode(jsNull());

    struct FunctionRange {
        unsigned start;
        unsigned end;
        String name;
    };
    struct ScriptInfo {
        RefPtr<JSC::SourceProvider> provider;
        Vector<FunctionRange> functions;
        UncheckedKeyHashSet<uint64_t> seenRanges;
    };

    // Walk only the four ScriptExecutable subspaces to enumerate SourceIDs.
    // FunctionExecutable ranges are collected here because FunctionHasExecutedCache
    // misses children of bodies that ran before the profiler was enabled.
    UncheckedKeyHashMap<SourceID, ScriptInfo> scriptsByID;
    {
        HeapIterationScope iterationScope(vm.heap);
        vm.heap.forEachScriptExecutableSpace([&](auto& spaceAndSet) {
            spaceAndSet.space.forEachLiveCell([&](HeapCell* cell, HeapCell::Kind) {
                auto* executable = static_cast<ScriptExecutable*>(cell);
                auto* provider = executable->source().provider();
                if (!provider)
                    return;
                SourceID sourceID = provider->asID();
                auto& info = scriptsByID.ensure(sourceID, [&] {
                    return ScriptInfo { provider, {}, {} };
                }).iterator->value;
                if (executable->type() != FunctionExecutableType)
                    return;
                auto* functionExecutable = static_cast<FunctionExecutable*>(executable);
                unsigned start = functionExecutable->typeProfilingStartOffset();
                unsigned end = functionExecutable->typeProfilingEndOffset();
                if (start > end || end > provider->source().length())
                    return;
                if (!info.seenRanges.add((static_cast<uint64_t>(start) << 32) | end).isNewEntry)
                    return;
                info.functions.append({ start, end, functionExecutable->ecmaName().string() });
            });
        });
    }

    auto scripts = JSON::Array::create();
    for (auto& entry : scriptsByID) {
        SourceID sourceID = entry.key;
        auto& info = entry.value;
        auto blocks = profiler->getBasicBlocksForSourceIDWithoutFunctionRange(sourceID, vm);
        auto cacheRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);
        if (blocks.isEmpty() && info.functions.isEmpty() && cacheRanges.isEmpty())
            continue;

        // Merge in ranges the profiler recorded whose FunctionExecutable was GCed.
        for (auto& range : cacheRanges) {
            unsigned start = std::get<1>(range);
            unsigned end = std::get<2>(range);
            if (!info.seenRanges.add((static_cast<uint64_t>(start) << 32) | end).isNewEntry)
                continue;
            info.functions.append({ start, end, String() });
        }

        auto script = JSON::Object::create();
        // A `//# sourceURL` directive overrides the script's resource name,
        // like it does in V8's coverage output.
        const String& sourceURLDirective = info.provider->sourceURLDirective();
        script->setString("url"_s, sourceURLDirective.isEmpty() ? info.provider->sourceURL() : sourceURLDirective);
        script->setDouble("scriptId"_s, static_cast<double>(sourceID));
        script->setDouble("sourceLength"_s, static_cast<double>(info.provider->source().length()));

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
        for (const auto& fn : info.functions) {
            auto range = JSON::Array::create();
            range->pushDouble(static_cast<double>(fn.start));
            range->pushDouble(static_cast<double>(fn.end));
            range->pushString(fn.name.isNull() ? emptyString() : fn.name);
            functionArray->pushValue(WTF::move(range));
        }
        script->setValue("functions"_s, WTF::move(functionArray));

        scripts->pushValue(WTF::move(script));
    }

    return JSValue::encode(jsString(vm, scripts->toJSONString()));
}
