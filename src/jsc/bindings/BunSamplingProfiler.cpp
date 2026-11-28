#include "root.h"
#include "BunSamplingProfiler.h"

#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/CodeBlockHash.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JITCode.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WasmCompilationMode.h>
#include <wtf/HashMap.h>
#include <wtf/StringPrintStream.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/WTFString.h>

namespace Bun {

using JSC::SamplingProfiler;

static WTF::Seconds& samplingProfilerTimingIntervalSlot()
{
    static thread_local WTF::Seconds interval = WTF::Seconds::fromMicroseconds(JSC::Options::sampleInterval());
    return interval;
}

void setSamplingProfilerTimingInterval(SamplingProfiler& profiler, WTF::Seconds interval)
{
    profiler.setTimingInterval(interval);
    samplingProfilerTimingIntervalSlot() = interval;
}

WTF::Seconds samplingProfilerTimingInterval()
{
    return samplingProfilerTimingIntervalSlot();
}

WTF::Vector<SamplingProfiler::StackTrace> takeSamplingProfilerStackTraces(SamplingProfiler& profiler, bool pause)
{
    WTF::Locker locker { profiler.getLock() };
    if (pause)
        profiler.pause();
    return profiler.releaseStackTraces();
}

// Ported from the file-static descriptionForLocation() and tierName() in
// Source/JavaScriptCore/runtime/SamplingProfiler.cpp (oven-sh/WebKit 4d45755fed, :1327 and :1383).

static WTF::String descriptionForLocation(const SamplingProfiler::StackFrame::CodeLocation& location, std::optional<JSC::Wasm::CompilationMode> wasmCompilationMode, JSC::BytecodeIndex wasmOffset)
{
    if (wasmCompilationMode) {
        WTF::StringPrintStream description;
        description.print(":");
        description.print(wasmCompilationMode.value());
        description.print(":");
        if (wasmOffset) {
            uintptr_t offset = wasmOffset.offset();
            description.print(WTF::RawHex(offset));
        } else
            description.print("nil");
        return description.toString();
    }

    WTF::String bytecodeIndex;
    WTF::String codeBlockHash;
    WTF::String jitType;
    if (location.hasBytecodeIndex())
        bytecodeIndex = WTF::toString(location.bytecodeIndex);
    else
        bytecodeIndex = "<nil>"_s;

    if (location.hasCodeBlockHash()) {
        WTF::StringPrintStream stream;
        location.codeBlockHash.dump(stream);
        codeBlockHash = stream.toString();
    } else
        codeBlockHash = "<nil>"_s;

    if (location.isRegExp)
        jitType = "RegExp"_s;
    else
        jitType = JSC::JITCode::typeName(location.jitType);

    return WTF::makeString('#', codeBlockHash, ':', jitType, ':', bytecodeIndex);
}

static ASCIILiteral tierName(const SamplingProfiler::StackFrame& frame)
{
    if (frame.isCompiledFrame())
        return "AOT"_s;
    switch (frame.frameType) {
    case SamplingProfiler::FrameType::Executable:
        switch (frame.semanticLocation.jitType) {
        case JSC::JITType::HostCallThunk:
            return "Host"_s;
        case JSC::JITType::InterpreterThunk:
            return "LLInt"_s;
        case JSC::JITType::BaselineJIT:
            return "Baseline"_s;
        case JSC::JITType::DFGJIT:
            return "DFG"_s;
        case JSC::JITType::FTLJIT:
            return "FTL"_s;
        default:
            return "Unknown Executable"_s;
        }
    case SamplingProfiler::FrameType::Wasm:
        if (frame.wasmCompilationMode) {
            switch (frame.wasmCompilationMode.value()) {
            case JSC::Wasm::CompilationMode::IPIntMode:
                return "IPInt"_s;
            case JSC::Wasm::CompilationMode::JSToWasmMode:
            case JSC::Wasm::CompilationMode::JSToWasmICMode:
            case JSC::Wasm::CompilationMode::WasmToJSMode:
            case JSC::Wasm::CompilationMode::WasmBuiltinMode:
            case JSC::Wasm::CompilationMode::RestoreFrameMode:
                break;
            case JSC::Wasm::CompilationMode::BBQMode:
                return "BBQ"_s;
            case JSC::Wasm::CompilationMode::OMGMode:
            case JSC::Wasm::CompilationMode::OMGForOSREntryMode:
                return "OMG"_s;
            }
        }
        return "Wasm"_s;
    case SamplingProfiler::FrameType::Host:
        return "Host"_s;
    case SamplingProfiler::FrameType::RegExp:
        return "RegExp"_s;
    case SamplingProfiler::FrameType::C:
        return "C/C++"_s;
    case SamplingProfiler::FrameType::Unknown:
        return "Unknown Frame"_s;
    }
    return "Unknown Frame"_s;
}

namespace {

// Each distinct string becomes one JSString that every frame shares. The raw
// JSString pointers are safe under the caller's DeferGC.
class StackTracesBuilder {
public:
    StackTracesBuilder(JSC::JSGlobalObject* globalObject)
        : m_globalObject(globalObject)
        , m_vm(JSC::getVM(globalObject))
        , m_sourceID(JSC::Identifier::fromString(m_vm, "sourceID"_s))
        , m_name(JSC::Identifier::fromString(m_vm, "name"_s))
        , m_location(JSC::Identifier::fromString(m_vm, "location"_s))
        , m_sourceURL(JSC::Identifier::fromString(m_vm, "sourceURL"_s))
        , m_line(JSC::Identifier::fromString(m_vm, "line"_s))
        , m_column(JSC::Identifier::fromString(m_vm, "column"_s))
        , m_category(JSC::Identifier::fromString(m_vm, "category"_s))
        , m_flags(JSC::Identifier::fromString(m_vm, "flags"_s))
        , m_inliner(JSC::Identifier::fromString(m_vm, "inliner"_s))
        , m_timestamp(JSC::Identifier::fromString(m_vm, "timestamp"_s))
        , m_frames(JSC::Identifier::fromString(m_vm, "frames"_s))
        , m_url(JSC::Identifier::fromString(m_vm, "url"_s))
        , m_sourceMappingURL(JSC::Identifier::fromString(m_vm, "sourceMappingURL"_s))
    {
    }

    JSC::JSValue build(WTF::Vector<SamplingProfiler::StackTrace>&& stackTraces, WTF::Seconds interval)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        JSC::JSArray* traces = JSC::constructEmptyArray(m_globalObject, nullptr, stackTraces.size());
        RETURN_IF_EXCEPTION(scope, {});
        for (size_t i = 0; i < stackTraces.size(); i++) {
            JSC::JSObject* trace = buildStackTrace(stackTraces[i]);
            RETURN_IF_EXCEPTION(scope, {});
            traces->putDirectIndex(m_globalObject, i, trace);
            RETURN_IF_EXCEPTION(scope, {});
            stackTraces[i].frames.clear();
        }
        stackTraces.clear();

        JSC::JSArray* sources = JSC::constructEmptyArray(m_globalObject, nullptr, m_sources.size());
        RETURN_IF_EXCEPTION(scope, {});
        unsigned sourceIndex = 0;
        for (auto& entry : m_sources) {
            JSC::JSObject* source = buildSource(entry.value.get());
            RETURN_IF_EXCEPTION(scope, {});
            sources->putDirectIndex(m_globalObject, sourceIndex++, source);
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSC::JSObject* result = JSC::constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(), 3);
        result->putDirect(m_vm, JSC::Identifier::fromString(m_vm, "interval"_s), JSC::jsNumber(interval.seconds()));
        result->putDirect(m_vm, JSC::Identifier::fromString(m_vm, "traces"_s), traces);
        result->putDirect(m_vm, JSC::Identifier::fromString(m_vm, "sources"_s), sources);
        return result;
    }

private:
    JSC::JSString* string(const WTF::String& string)
    {
        if (string.isEmpty())
            return JSC::jsEmptyString(m_vm);
        auto result = m_strings.add(string, nullptr);
        if (result.isNewEntry)
            result.iterator->value = JSC::jsString(m_vm, string);
        return result.iterator->value;
    }

    JSC::JSObject* buildStackTrace(SamplingProfiler::StackTrace& stackTrace)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        JSC::JSArray* frames = JSC::constructEmptyArray(m_globalObject, nullptr, stackTrace.frames.size());
        RETURN_IF_EXCEPTION(scope, {});
        for (size_t i = 0; i < stackTrace.frames.size(); i++) {
            JSC::JSObject* frame = buildStackFrame(stackTrace.frames[i]);
            RETURN_IF_EXCEPTION(scope, {});
            frames->putDirectIndex(m_globalObject, i, frame);
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSC::JSObject* result = JSC::constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(), 2);
        result->putDirect(m_vm, m_timestamp, JSC::jsNumber(stackTrace.timestamp.secondsSinceEpoch().seconds()));
        result->putDirect(m_vm, m_frames, frames);
        return result;
    }

    JSC::JSObject* buildStackFrame(SamplingProfiler::StackFrame& stackFrame)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        auto [provider, sourceID] = stackFrame.sourceProviderAndID();
        if (provider)
            m_sources.add(sourceID, Ref { *provider });

        JSC::JSObject* result = JSC::constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(), 9);
        result->putDirect(m_vm, m_sourceID, JSC::jsNumber(static_cast<double>(sourceID)));
        result->putDirect(m_vm, m_name, string(stackFrame.displayName(m_vm)));
        result->putDirect(m_vm, m_location, string(descriptionForLocation(stackFrame.semanticLocation, stackFrame.wasmCompilationMode, stackFrame.wasmOffset)));

        JSC::LineColumn sourceMappedLineColumn = stackFrame.semanticLocation.lineColumn;
        if (stackFrame.isCompiledFrame()) {
            result->putDirect(m_vm, m_sourceURL, string(stackFrame.url()));
        } else if (provider) {
#if USE(BUN_JSC_ADDITIONS)
            auto& fn = m_vm.computeLineColumnWithSourcemap();
            if (fn) {
                WTF::String remappedURL;
                fn(m_vm, provider, sourceMappedLineColumn, remappedURL);
                if (!remappedURL.isEmpty())
                    result->putDirect(m_vm, m_sourceURL, string(remappedURL));
            }
#endif
        }
        result->putDirect(m_vm, m_line, JSC::jsNumber(sourceMappedLineColumn.line));
        result->putDirect(m_vm, m_column, JSC::jsNumber(sourceMappedLineColumn.column));
        result->putDirect(m_vm, m_category, string(tierName(stackFrame)));

        uint32_t flags = 0;
        if (stackFrame.frameType == SamplingProfiler::FrameType::Executable && stackFrame.executable) {
            if (auto* executable = dynamicDowncast<JSC::FunctionExecutable>(stackFrame.executable); executable && executable->isBuiltinFunction())
                flags = 1;
        }
        result->putDirect(m_vm, m_flags, JSC::jsNumber(flags));

        if (auto& machineLocation = stackFrame.machineLocation) {
            JSC::JSObject* inliner = JSC::constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(), 5);
            inliner->putDirect(m_vm, m_name, string(WTF::String::fromUTF8(machineLocation->second->inferredName().span())));
            inliner->putDirect(m_vm, m_location, string(descriptionForLocation(machineLocation->first, std::nullopt, JSC::BytecodeIndex())));
            // The position is in the inlining function's source, not in the frame's.
            JSC::LineColumn inlinerLineColumn = machineLocation->first.lineColumn;
            if (auto* inlinerProvider = machineLocation->second->source().provider()) {
#if USE(BUN_JSC_ADDITIONS)
                auto& fn = m_vm.computeLineColumnWithSourcemap();
                if (fn) {
                    WTF::String inlinerRemappedURL;
                    fn(m_vm, inlinerProvider, inlinerLineColumn, inlinerRemappedURL);
                }
#endif
            }
            inliner->putDirect(m_vm, m_line, JSC::jsNumber(inlinerLineColumn.line));
            inliner->putDirect(m_vm, m_column, JSC::jsNumber(inlinerLineColumn.column));
            inliner->putDirect(m_vm, m_category, string(tierName(stackFrame)));
            result->putDirect(m_vm, m_inliner, inliner);
        }

        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }

    JSC::JSObject* buildSource(JSC::SourceProvider& provider)
    {
        JSC::JSObject* result = JSC::constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(), 4);
        result->putDirect(m_vm, m_sourceID, JSC::jsNumber(static_cast<double>(provider.asID())));
        if (!provider.sourceURL().isEmpty())
            result->putDirect(m_vm, m_url, string(provider.sourceURL()));
        if (!provider.sourceURLDirective().isEmpty())
            result->putDirect(m_vm, m_sourceURL, string(provider.sourceURLDirective()));
        if (!provider.sourceMappingURLDirective().isEmpty())
            result->putDirect(m_vm, m_sourceMappingURL, string(provider.sourceMappingURLDirective()));
        return result;
    }

    JSC::JSGlobalObject* m_globalObject;
    JSC::VM& m_vm;
    WTF::UncheckedKeyHashMap<JSC::SourceID, Ref<JSC::SourceProvider>> m_sources;
    WTF::HashMap<WTF::String, JSC::JSString*> m_strings;

    const JSC::Identifier m_sourceID;
    const JSC::Identifier m_name;
    const JSC::Identifier m_location;
    const JSC::Identifier m_sourceURL;
    const JSC::Identifier m_line;
    const JSC::Identifier m_column;
    const JSC::Identifier m_category;
    const JSC::Identifier m_flags;
    const JSC::Identifier m_inliner;
    const JSC::Identifier m_timestamp;
    const JSC::Identifier m_frames;
    const JSC::Identifier m_url;
    const JSC::Identifier m_sourceMappingURL;
};

} // namespace

JSC::JSValue samplingProfilerStackTracesToJS(JSC::JSGlobalObject* globalObject, WTF::Vector<SamplingProfiler::StackTrace>&& stackTraces, WTF::Seconds interval)
{
    StackTracesBuilder builder(globalObject);
    return builder.build(WTF::move(stackTraces), interval);
}

} // namespace Bun
