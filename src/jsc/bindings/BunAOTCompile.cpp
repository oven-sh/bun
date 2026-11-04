#include "root.h"

#if ENABLE(AOT)

#include "BunAOTCompile.h"

#include "AOTSchemaHash.h"
#include <JavaScriptCore/AOTBuiltinTableBindings.h>
#include <JavaScriptCore/AOTCompileOptionWords.h>
#include <JavaScriptCore/AOTCurrentWork.h>
#include <JavaScriptCore/AOTDriver.h>
#include <JavaScriptCore/AOTOptionWords.h>
#include <JavaScriptCore/AOTRegExpSummary.h>
#include <JavaScriptCore/AOTRemovableFeature.h>
#include <JavaScriptCore/AOTRuntimeDescription.h>
#include <JavaScriptCore/AOTThreads.h>
#include <JavaScriptCore/YarrErrorCode.h>
#include <JavaScriptCore/YarrFlags.h>
#include <JavaScriptCore/YarrSyntaxChecker.h>
#include <algorithm>
#include <cstring>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <wtf/MainThread.h>
#include <wtf/OptionSet.h>
#include <wtf/Threading.h>
#include <wtf/text/CString.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

#if OS(WINDOWS)
#include <fcntl.h>
#include <io.h>
#include <stdlib.h>
#endif

static_assert(JSC::AOT::Wire::schemaHash == BUN_AOT_SCHEMA_HASH, "the Rust half of the compiler and JavaScriptCore's AOTWire.h were generated from different schemas");
static_assert(sizeof(JSC::AOT::Wire::ResultSection) == sizeof(uint32_t));

namespace Wire = JSC::AOT::Wire;

static constexpr BunAOTBytes noBytes { nullptr, 0 };

struct BunAOTResult {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(BunAOTResult);

    std::unique_ptr<JSC::AOT::CompileOutput> output;
};

extern "C" BunAOTBytes Bun__AOT__resultSection(const BunAOTResult* result, Wire::ResultSection section)
{
    if (static_cast<uint32_t>(section) >= JSC::AOT::numberOfResultSections)
        return noBytes;
    std::span<const uint8_t> bytes = result->output->section(section);
    return { bytes.data(), bytes.size() };
}

extern "C" void Bun__AOT__freeResult(BunAOTResult* result)
{
    delete result;
}

static String stringFromUTF8(BunAOTBytes bytes)
{
    return String::fromUTF8ReplacingInvalidSequences(std::span { bytes.ptr, bytes.len });
}

extern "C" void Bun__AOT__initializeOptions(Wire::CompileOptions* options)
{
    WTF::initialize();

    *options = JSC::AOT::makeDefaultCompileOptions();
}

extern "C" size_t Bun__AOT__applyOptionWord(Wire::CompileOptions* options, BunAOTBytes word, uint8_t* message, size_t capacity)
{
    WTF::initialize();

    Wire::CompileOptions changedOptions = *options;
    auto error = JSC::AOT::applyOptionWord(changedOptions, stringFromUTF8(word));
    if (!error) {
        *options = changedOptions;
        return 0;
    }

    UTF8CString utf8 = error->utf8();
    RELEASE_ASSERT(utf8.length());
    if (size_t copiedLength = std::min(capacity, utf8.length()))
        memcpy(message, utf8.data(), copiedLength);
    return utf8.length();
}

static void ensureHostBindings()
{
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        if (!JSC::AOT::BuiltinBindings::hasHost())
            Bun__AOT__registerHostBindings();
    });
}

extern "C" BunAOTResult* Bun__AOT__compile(BunAOTBytes program, const JSC::AOT::ExternalFunctionBodies* externalBodies, void (*releaseProgram)(void* owner), void (*releaseBytesOfProgram)(void* owner), void* programOwner, const Wire::CompileOptions* options, const JSC::AOT::HostThreadPool* threadPool, size_t (*sizeOfFunctionText)(void* owner, uint32_t module), void (*copyFunctionText)(void* owner, uint32_t module, uint8_t* destination))
{
    ensureHostBindings();

#if OS(WINDOWS)
    _setmode(2, _O_BINARY);
    _set_fmode(_O_BINARY);
#endif

    auto* result = new BunAOTResult;
    result->output = JSC::callRemovable<JSC::RemovableFeature::ImageCompiler, JSC::RemovedFeatureStub::Abort, JSC::AOT::compileProgram>(std::span { program.ptr, program.len }, *options, threadPool, JSC::AOT::ProgramOwner { releaseProgram, programOwner, externalBodies, { programOwner, sizeOfFunctionText, copyFunctionText }, releaseBytesOfProgram });
    return result;
}

extern "C" size_t Bun__AOT__describeDifferenceOfRuntime(const uint8_t* description, size_t size, uint8_t* message, size_t capacity)
{
    std::optional<JSC::AOT::RuntimeDifference> difference = JSC::AOT::findDifferenceFromThisRuntime({ description, size });
    if (!difference)
        return 0;

    WTF::initialize();
    String sentence = difference->name.isNull()
        ? "its description of the run time can't be read"_str
        : makeString(difference->name, " is "_s, difference->there, " there and "_s, difference->here, " here"_s);
    UTF8CString utf8 = sentence.utf8();
    if (size_t copiedLength = std::min(capacity, utf8.length()))
        memcpy(message, utf8.data(), copiedLength);
    return utf8.length();
}

extern "C" size_t Bun__AOT__imageAlignment()
{
    return JSC::AOT::imageAlignment();
}

extern "C" void Bun__AOT__relocateImage(uint8_t* image, size_t size, uint64_t address)
{
    JSC::AOT::relocateImage({ image, size }, address);
}

extern "C" size_t Bun__AOT__peakResidentMegabytesOfProcess()
{
    return JSC::AOT::peakResidentMegabytesOfProcess();
}

extern "C" size_t Bun__AOT__describeWhereThisThreadStopped(uint8_t* buffer, size_t capacity)
{
    return JSC::AOT::describeWhereThisThreadStopped({ reinterpret_cast<char*>(buffer), capacity });
}

extern "C" size_t Bun__AOT__describeWhatThreadsAreCompiling(uint8_t* buffer, size_t capacity)
{
    return JSC::AOT::describeWhatThreadsAreCompiling({ reinterpret_cast<char*>(buffer), capacity });
}

// What the parser of JavaScript says of a regular expression literal, which it refuses the whole file for. How deep a pattern may be nested depends on the thread, so that is left to where the literal is evaluated. The front end reads the flags itself.
extern "C" size_t Bun__AOT__describeRegExpSyntaxError(const uint8_t* pattern, size_t patternSize, const uint8_t* flags, size_t flagsSize, uint8_t* message, size_t capacity)
{
    WTF::initialize();
    String patternText = String::fromUTF8ReplacingInvalidSequences(std::span { pattern, patternSize });
    String flagsText = String::fromUTF8ReplacingInvalidSequences(std::span { flags, flagsSize });
    JSC::Yarr::ErrorCode error = JSC::Yarr::checkSyntax(patternText, flagsText);
    if (!JSC::Yarr::hasHardError(error) || error == JSC::Yarr::ErrorCode::InvalidRegularExpressionFlags)
        return 0;

    ASCIILiteral sentence = JSC::Yarr::errorMessage(error);
    if (size_t copiedLength = std::min(capacity, sentence.length()))
        memcpy(message, sentence.characters(), copiedLength);
    return sentence.length();
}

static JSC::Yarr::ErrorCode errorOfRegExpPattern(StringView pattern, OptionSet<JSC::Yarr::Flags> flags)
{
    JSC::AOT::RegExpSummary summary = JSC::AOT::summarizeRegExp(pattern, flags);
    if (summary.canBeCreated())
        return JSC::Yarr::ErrorCode::NoError;
    if (JSC::Yarr::hasHardError(summary.syntaxError))
        return summary.syntaxError;
    if (JSC::Yarr::hasHardError(summary.constructionError))
        return summary.constructionError;
    return JSC::Yarr::ErrorCode::TooManyDisjunctions;
}

// What stands against creating the literal /pattern/flags, whose flags are valid, from its record. Both texts come as they do for Bun__AOT__describeRegExpSyntaxError.
// A hard error: its pattern can never be built. TooManyDisjunctions: it is nested too deep for the build to analyze.
static JSC::Yarr::ErrorCode errorOfRegExpLiteral(const uint8_t* pattern, size_t patternSize, const uint8_t* flags, size_t flagsSize)
{
    WTF::initialize();
    String patternText = String::fromUTF8ReplacingInvalidSequences(std::span { pattern, patternSize });
    String flagsText = String::fromUTF8ReplacingInvalidSequences(std::span { flags, flagsSize });
    std::optional<OptionSet<JSC::Yarr::Flags>> parsedFlags = JSC::Yarr::parseFlags(flagsText);
    RELEASE_ASSERT(parsedFlags);

    // The literal may stand deep in an expression, and with assertions or ASAN the analysis needs more stack than a thread of the pool is promised.
    if (JSC::AOT::hasStackForRegExpCompiler())
        return errorOfRegExpPattern(patternText, *parsedFlags);
    JSC::Yarr::ErrorCode error = JSC::Yarr::ErrorCode::NoError;
    JSC::AOT::runOnBuildThread([&] {
        error = errorOfRegExpPattern(patternText, *parsedFlags);
    });
    return error;
}

// 0: from its record, which cannot throw. 1: its pattern can never be built. 2: whether it can be built depends on the stack of the thread that evaluates it.
extern "C" uint32_t Bun__AOT__classifyRegExpLiteral(const uint8_t* pattern, size_t patternSize, const uint8_t* flags, size_t flagsSize)
{
    JSC::Yarr::ErrorCode error = errorOfRegExpLiteral(pattern, patternSize, flags, flagsSize);
    if (!JSC::Yarr::hasError(error))
        return 0;
    return JSC::Yarr::hasHardError(error) ? 1 : 2;
}

// The message of the SyntaxError that a literal of class 1 throws wherever it is evaluated. Nothing for the other two.
extern "C" size_t Bun__AOT__describeRegExpConstructionError(const uint8_t* pattern, size_t patternSize, const uint8_t* flags, size_t flagsSize, uint8_t* message, size_t capacity)
{
    JSC::Yarr::ErrorCode error = errorOfRegExpLiteral(pattern, patternSize, flags, flagsSize);
    if (!JSC::Yarr::hasHardError(error))
        return 0;

    ASCIILiteral sentence = JSC::Yarr::errorMessage(error);
    if (size_t copiedLength = std::min(capacity, sentence.length()))
        memcpy(message, sentence.characters(), copiedLength);
    return sentence.length();
}
#else // ENABLE(AOT)

#include <cstddef>
#include <cstdint>

// What src/aot/engine/shared.rs asks. Nothing else of this file has a caller in a Bun without the compiler.
extern "C" size_t Bun__AOT__imageAlignment() { return 1; }
extern "C" void Bun__AOT__relocateImage(uint8_t*, size_t, uint64_t) {}
extern "C" size_t Bun__AOT__describeDifferenceOfRuntime(const uint8_t*, size_t, uint8_t*, size_t) { return 0; }
extern "C" size_t Bun__AOT__describeRegExpSyntaxError(const uint8_t*, size_t, const uint8_t*, size_t, uint8_t*, size_t) { return 0; }
extern "C" uint32_t Bun__AOT__classifyRegExpLiteral(const uint8_t*, size_t, const uint8_t*, size_t) { return 0; }
extern "C" size_t Bun__AOT__describeRegExpConstructionError(const uint8_t*, size_t, const uint8_t*, size_t, uint8_t*, size_t) { return 0; }
// What src/runtime/cli/run_compiled.rs names.
extern "C" size_t Bun__AOT__peakResidentMegabytesOfProcess() { return 0; }
// What src/runtime/cli/compile_command/build.rs names.
extern "C" size_t Bun__AOT__describeWhereThisThreadStopped(uint8_t*, size_t) { return 0; }
extern "C" size_t Bun__AOT__describeWhatThreadsAreCompiling(uint8_t*, size_t) { return 0; }

#endif // ENABLE(AOT)
