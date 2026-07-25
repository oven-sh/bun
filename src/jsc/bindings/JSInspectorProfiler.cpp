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
#include <JavaScriptCore/ParserModes.h>
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
// data for. The JS layer in node/inspector.ts reshapes this into the V8
// ScriptCoverage format returned by Profiler.takePreciseCoverage.
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
    // script source (v8-to-istanbul) can remap. FunctionExecutable metadata
    // (name, source span, parse mode) is collected alongside so the JS layer
    // can drop JSC-internal synthetic functions that would otherwise surface
    // as phantom V8 FunctionCoverage entries.
    struct ExecutableInfo {
        unsigned functionStart;
        unsigned functionEnd;
        unsigned sourceEnd;
        String name;
        bool skip;
    };
    Vector<Ref<JSC::SourceProvider>> providers;
    HashSet<SourceID> seenSourceIDs;
    UncheckedKeyHashMap<SourceID, Vector<ExecutableInfo>> executablesPerSource;
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
                if (executable->type() != FunctionExecutableType)
                    return;

                auto* fn = static_cast<FunctionExecutable*>(executable);
                SourceParseMode mode = fn->parseMode();
                // These compile as inner FunctionExecutables but have no direct
                // source representation a V8 consumer would recognise. Their
                // ranges either alias the wrapper (generator/async bodies) or
                // carry offsets into a different SourceProvider (default
                // constructors, class-field initializers), so emit them only
                // as a skip marker.
                bool skip = fn->isBuiltinFunction()
                    || fn->implementationVisibility() != ImplementationVisibility::Public
                    || mode == SourceParseMode::ClassFieldInitializerMode
                    || isGeneratorOrAsyncFunctionBodyParseMode(mode);
                ExecutableInfo info {
                    fn->functionStart(),
                    fn->functionEnd(),
                    static_cast<unsigned>(executable->source().endOffset()),
                    fn->ecmaName().string(),
                    skip,
                };
                executablesPerSource.ensure(sourceID, [] { return Vector<ExecutableInfo> {}; }).iterator->value.append(WTF::move(info));
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

        StringView source = provider->source();
        unsigned providerLen = source.length();
        // JSC emits a profile point after every return/throw; when that's the
        // function's last statement the resulting block spans only whitespace
        // and the closing brace. Tag each block so the JS layer can drop those
        // without shipping full source text over the wire.
        auto rangeHasCode = [&](int start, int end) -> bool {
            unsigned s = start < 0 ? 0 : static_cast<unsigned>(start);
            unsigned e = end < 0 ? 0 : static_cast<unsigned>(end);
            if (e >= providerLen)
                e = providerLen ? providerLen - 1 : 0;
            for (unsigned i = s; i <= e && i < providerLen; i++) {
                char16_t c = source[i];
                if (c != ' ' && c != '\t' && c != '\r' && c != '\n' && c != '}' && c != ';')
                    return true;
            }
            return false;
        };

        auto blockArray = JSON::Array::create();
        for (const auto& block : blocks) {
            auto range = JSON::Array::create();
            range->pushInteger(block.m_startOffset);
            range->pushInteger(block.m_endOffset);
            range->pushDouble(static_cast<double>(block.m_executionCount));
            range->pushBoolean(rangeHasCode(block.m_startOffset, block.m_endOffset));
            blockArray->pushValue(WTF::move(range));
        }
        script->setValue("blocks"_s, WTF::move(blockArray));

        auto functionArray = JSON::Array::create();
        for (const auto& functionRange : functionRanges) {
            auto range = JSON::Array::create();
            range->pushDouble(static_cast<double>(std::get<1>(functionRange)));
            range->pushDouble(static_cast<double>(std::get<2>(functionRange)));
            range->pushBoolean(std::get<0>(functionRange));
            functionArray->pushValue(WTF::move(range));
        }
        script->setValue("functions"_s, WTF::move(functionArray));

        auto executableArray = JSON::Array::create();
        auto execIt = executablesPerSource.find(sourceID);
        if (execIt != executablesPerSource.end()) {
            for (const auto& info : execIt->value) {
                auto entry = JSON::Array::create();
                entry->pushDouble(static_cast<double>(info.functionStart));
                entry->pushDouble(static_cast<double>(info.functionEnd));
                entry->pushDouble(static_cast<double>(info.sourceEnd));
                entry->pushString(info.name);
                entry->pushBoolean(info.skip);
                executableArray->pushValue(WTF::move(entry));
            }
        }
        script->setValue("executables"_s, WTF::move(executableArray));

        scripts->pushValue(WTF::move(script));
    }

    return JSValue::encode(jsString(vm, scripts->toJSONString()));
}
