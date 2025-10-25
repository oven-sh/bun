#include "root.h"

#include "helpers.h"

#include "BunSourceProvider.h"

#include <JavaScriptCore/BytecodeCacheError.h>
#include "ZigGlobalObject.h"
#include "wtf/Assertions.h"

#include <JavaScriptCore/Completion.h>
#include <wtf/Scope.h>
#include <wtf/text/StringHash.h>
#include <sys/stat.h>
#include <JavaScriptCore/SourceCodeKey.h>
#include <mimalloc.h>
#include <JavaScriptCore/CodeCache.h>

namespace Zig {

using Base = JSC::SourceProvider;
using BytecodeCacheGenerator = JSC::BytecodeCacheGenerator;
using UnlinkedFunctionExecutable = JSC::UnlinkedFunctionExecutable;
using CachedBytecode = JSC::CachedBytecode;
using UnlinkedFunctionCodeBlock = JSC::UnlinkedFunctionCodeBlock;
using SourceCode = JSC::SourceCode;
using CodeSpecializationKind = JSC::CodeSpecializationKind;
using SourceOrigin = JSC::SourceOrigin;
using String = WTF::String;
using SourceProviderSourceType = JSC::SourceProviderSourceType;

extern "C" bool BunTest__shouldGenerateCodeCoverage(BunString sourceURL);
extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, JSC::SourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* bun_vm, JSC::SourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void ByteRangeMapping__generate(BunString sourceURL, BunString code, int sourceID);

// Forward declaration - implementation is at the end of the file
JSC::SourceOrigin toSourceOrigin(const WTF::String& sourceURL, bool isBuiltin);

Ref<BunSourceProvider> BunSourceProvider::create(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const SourceOrigin& origin,
    WTF::String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType)
{
    return adoptRef(*new BunSourceProvider(
        globalObject,
        WTFMove(source),
        origin,
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType));
}

BunSourceProvider::BunSourceProvider(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const SourceOrigin& origin,
    WTF::String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType)
    : Base(origin, WTFMove(sourceURL), String(), JSC::SourceTaintedOrigin::Untainted, TextPosition(), sourceType)
    , m_source(WTFMove(source))
    , m_cachedBytecode(WTFMove(bytecode))
    , m_globalObject(globalObject)
{
}

StringView BunSourceProvider::source() const
{
    return StringView(m_source.get());
}

BunSourceProvider::~BunSourceProvider()
{
    // Sourcemap cleanup is handled separately via Bun__removeSourceProviderSourceMap
    // called from the caller when needed
}

unsigned BunSourceProvider::hash() const
{
    if (m_hash) {
        return m_hash;
    }

    return m_source->hash();
}

// Helper function for converting source URLs to SourceOrigin (used by Bun__createSourceProvider and JSCommonJSModule.cpp)
JSC::SourceOrigin toSourceOrigin(const WTF::String& sourceURL, bool isBuiltin)
{
    using namespace WTF::StringLiterals;

    ASSERT_WITH_MESSAGE(!sourceURL.startsWith("file://"_s), "specifier should not already be a file URL");

    if (isBuiltin) {
        if (sourceURL.startsWith("node:"_s)) {
            return JSC::SourceOrigin(WTF::URL(WTF::makeString("builtin://node/"_s, sourceURL.substring(5))));
        } else if (sourceURL.startsWith("bun:"_s)) {
            return JSC::SourceOrigin(WTF::URL(WTF::makeString("builtin://bun/"_s, sourceURL.substring(4))));
        } else {
            return JSC::SourceOrigin(WTF::URL(WTF::makeString("builtin://"_s, sourceURL)));
        }
    }
    return JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL));
}

}; // namespace Zig

// C bridge function to create a BunSourceProvider from TranspiledSource
extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* source,
    bool isBuiltin)
{
    using namespace Zig;

    auto sourceString = source->source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURL = source->source_url.toWTFString(BunString::ZeroCopy);

    bool isCommonJS = source->flags.is_commonjs;
    auto sourceType = isCommonJS ?
        JSC::SourceProviderSourceType::Program :
        JSC::SourceProviderSourceType::Module;

    // Handle bytecode if present
    RefPtr<JSC::CachedBytecode> bytecode;
    if (source->bytecode_cache) {
        const auto destructorPtr = [](const void* ptr) {
            mi_free(const_cast<void*>(ptr));
        };
        const auto destructorNoOp = [](const void* ptr) {
            // no-op, for bun build --compile.
        };
        // For already_bundled bytecode, we don't free it (it's embedded)
        const auto destructor = source->flags.is_already_bundled ? destructorNoOp : destructorPtr;

        bytecode = JSC::CachedBytecode::create(
            std::span<uint8_t>(source->bytecode_cache, source->bytecode_cache_len),
            destructor,
            {}
        );
    }

    bool isCodeCoverageEnabled = !!globalObject->vm().controlFlowProfiler();
    bool shouldGenerateCodeCoverage = isCodeCoverageEnabled && !isBuiltin &&
        BunTest__shouldGenerateCodeCoverage(source->source_url);

    auto provider = BunSourceProvider::create(
        globalObject->isThreadLocalDefaultGlobalObject ? globalObject : nullptr,
        sourceString.isNull() ? *WTF::StringImpl::empty() : *sourceString.impl(),
        toSourceOrigin(sourceURL, isBuiltin),
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType
    );

    // Generate code coverage mapping if needed
    if (shouldGenerateCodeCoverage) {
        ByteRangeMapping__generate(
            Bun::toString(provider->sourceURL()),
            Bun::toString(provider->source().toStringWithoutCopying()),
            provider->asID()
        );
    }

    // Register sourcemap if needed
    if (source->flags.is_already_bundled) {
        BunString sourceUrlBun = source->source_url;
        Bun__addSourceProviderSourceMap(
            globalObject->bunVM(),
            provider.ptr(),
            &sourceUrlBun
        );
    }

    // Transfer ownership to caller
    return &provider.leakRef();
}

// =============================================================================
// Exported extern "C" utility functions (formerly in ZigSourceProvider.cpp)
// =============================================================================

extern "C" {

// Decrement reference count for cached bytecode
void CachedBytecode__deref(JSC::CachedBytecode* cachedBytecode)
{
    cachedBytecode->deref();
}

// Get source code slice from a SourceProvider
BunString ZigSourceProvider__getSourceSlice(JSC::SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

} // extern "C"

// Shared VM for bytecode caching - thread-local to avoid conflicts
static JSC::VM& getVMForBytecodeCache()
{
    static thread_local JSC::VM* vmForBytecodeCache = nullptr;
    if (!vmForBytecodeCache) {
        const auto heapSize = JSC::HeapType::Small;
        auto vmPtr = JSC::VM::tryCreate(heapSize);
        vmPtr->refSuppressingSaferCPPChecking();
        vmForBytecodeCache = vmPtr.get();
        vmPtr->heap.acquireAccess();
    }
    return *vmForBytecodeCache;
}

extern "C" {

// Generate cached bytecode for ES modules
bool generateCachedModuleByteCodeFromSourceCode(
    BunString* sourceProviderURL,
    const Latin1Character* inputSourceCode,
    size_t inputSourceCodeSize,
    const uint8_t** outputByteCode,
    size_t* outputByteCodeSize,
    JSC::CachedBytecode** cachedBytecodePtr)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    JSC::SourceCode sourceCode = JSC::makeSource(
        WTF::String(sourceCodeSpan),
        Zig::toSourceOrigin(sourceProviderURL->toWTFString(), false),
        JSC::SourceTaintedOrigin::Untainted
    );

    JSC::VM& vm = getVMForBytecodeCache();
    JSC::JSLockHolder locker(vm);

    JSC::LexicallyScopedFeatures lexicallyScopedFeatures = JSC::StrictModeLexicallyScopedFeature;
    JSC::JSParserScriptMode scriptMode = JSC::JSParserScriptMode::Module;
    JSC::EvalContextType evalContextType = JSC::EvalContextType::None;

    JSC::ParserError parserError;
    JSC::UnlinkedModuleProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForModuleProgram(
        vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType
    );

    if (parserError.isValid())
        return false;
    if (!unlinkedCodeBlock)
        return false;

    auto key = JSC::sourceCodeKeyForSerializedModule(vm, sourceCode);
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock);

    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

// Generate cached bytecode for CommonJS programs
bool generateCachedCommonJSProgramByteCodeFromSourceCode(
    BunString* sourceProviderURL,
    const Latin1Character* inputSourceCode,
    size_t inputSourceCodeSize,
    const uint8_t** outputByteCode,
    size_t* outputByteCodeSize,
    JSC::CachedBytecode** cachedBytecodePtr)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    JSC::SourceCode sourceCode = JSC::makeSource(
        WTF::String(sourceCodeSpan),
        Zig::toSourceOrigin(sourceProviderURL->toWTFString(), false),
        JSC::SourceTaintedOrigin::Untainted
    );

    JSC::VM& vm = getVMForBytecodeCache();
    JSC::JSLockHolder locker(vm);

    JSC::LexicallyScopedFeatures lexicallyScopedFeatures = JSC::NoLexicallyScopedFeatures;
    JSC::JSParserScriptMode scriptMode = JSC::JSParserScriptMode::Classic;
    JSC::EvalContextType evalContextType = JSC::EvalContextType::None;

    JSC::ParserError parserError;
    JSC::UnlinkedProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForProgram(
        vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType
    );

    if (parserError.isValid())
        return false;
    if (!unlinkedCodeBlock)
        return false;

    auto key = JSC::sourceCodeKeyForSerializedProgram(vm, sourceCode);
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock);

    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

} // extern "C"
