#include "BunSourceProvider.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/BytecodeCacheError.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/UnlinkedSourceCode.h>
#include <wtf/text/StringHash.h>
#include <wtf/text/WTFString.h>
#include <mimalloc.h>

extern "C" void Bun__addSourceProviderSourceMap(void* vm, JSC::SourceProvider* provider, BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* vm, JSC::SourceProvider* provider, BunString* specifier);

namespace Zig {

BunSourceProvider::BunSourceProvider(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const JSC::SourceOrigin& origin,
    String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType
)
    : JSC::SourceProvider(origin, String(sourceURL), String(), JSC::SourceTaintedOrigin::Untainted, TextPosition(), sourceType)
    , m_source(WTFMove(source))
    , m_cachedBytecode(WTFMove(bytecode))
{
}

Ref<BunSourceProvider> BunSourceProvider::create(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const JSC::SourceOrigin& origin,
    String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType
)
{
    return adoptRef(*new BunSourceProvider(
        globalObject,
        WTFMove(source),
        origin,
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType
    ));
}

BunSourceProvider::~BunSourceProvider()
{
    // Note: We cannot unregister the sourcemap here because we don't have access
    // to the globalObject or VM at destruction time. The VM's source_mappings
    // will clean up when the VM is destroyed.
}

StringView BunSourceProvider::source() const
{
    return StringView(m_source.get());
}

unsigned BunSourceProvider::hash() const
{
    return m_source->hash();
}

RefPtr<JSC::CachedBytecode> BunSourceProvider::cachedBytecode() const
{
    return m_cachedBytecode;
}

extern "C" void* ByteRangeMapping__find(BunString);
extern "C" JSC::SourceID ByteRangeMapping__getSourceID(void*, BunString);

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL)
{
    void* mappings = ByteRangeMapping__find(Bun::toString(sourceURL));
    if (!mappings) {
        return 0;
    }

    return ByteRangeMapping__getSourceID(mappings, Bun::toString(sourceURL));
}

} // namespace Zig

// C bridge function
extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* source
)
{
    auto sourceString = source->source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURL = source->source_url.toWTFString(BunString::ZeroCopy);

    // Extract is_commonjs flag (bit 0 of flags uint32_t)
    bool isCommonJS = (source->flags & 0x1) != 0;
    auto sourceType = isCommonJS ?
        JSC::SourceProviderSourceType::Program :
        JSC::SourceProviderSourceType::Module;

    // Handle bytecode if present
    RefPtr<JSC::CachedBytecode> bytecode;
    if (source->bytecode_cache) {
        bytecode = JSC::CachedBytecode::create(
            std::span<uint8_t>(source->bytecode_cache, source->bytecode_cache_len),
            [](const void* ptr) { mi_free(const_cast<void*>(ptr)); },
            {}
        );
    }

    // Create SourceOrigin
    auto origin = JSC::SourceOrigin(WTF::URL(sourceURL));

    auto provider = Zig::BunSourceProvider::create(
        globalObject,
        Ref<WTF::StringImpl>(*sourceString.impl()),
        origin,
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType
    );

    // Register sourcemap with VM only if already_bundled (bit 1 of flags)
    if (source->flags & 0x2) {
        Bun__addSourceProviderSourceMap(
            reinterpret_cast<void*>(globalObject->bunVM()),
            &provider.get(),
            const_cast<BunString*>(&source->source_url)
        );
    }

    return &provider.leakRef();
}

// Bytecode cache utilities
extern "C" void CachedBytecode__deref(JSC::CachedBytecode* cachedBytecode)
{
    cachedBytecode->deref();
}

static JSC::VM& getVMForBytecodeCache()
{
    static thread_local JSC::VM* vmForBytecodeCache = nullptr;
    if (!vmForBytecodeCache) {
        const auto heapSize = JSC::HeapType::Small;
        auto& vm = JSC::VM::create(heapSize).leakRef();
        vmForBytecodeCache = &vm;
    }
    return *vmForBytecodeCache;
}

extern "C" bool generateCachedModuleByteCodeFromSourceCode(
    BunString* sourceProviderURL,
    const Latin1Character* inputSourceCode,
    size_t inputSourceCodeSize,
    const uint8_t** outputByteCode,
    size_t* outputByteCodeSize,
    JSC::CachedBytecode** cachedBytecodePtr,
    int32_t* errorLoc,
    BunString* errorMessage
)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    JSC::SourceCode sourceCode = JSC::makeSource(
        WTF::String(sourceCodeSpan),
        JSC::SourceOrigin(WTF::URL(sourceProviderURL->toWTFString())),
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

    if (parserError.isValid()) {
        if (errorLoc) {
            *errorLoc = parserError.token().m_startPosition.offset;
        }
        if (errorMessage) {
            *errorMessage = Bun::toStringRef(parserError.message());
        }
        return false;
    }

    auto sourceCodeKey = JSC::SourceCodeKey(
        sourceCode,
        sourceCode.provider()->sourceURL(),
        JSC::SourceCodeType::ModuleType,
        lexicallyScopedFeatures,
        scriptMode,
        JSC::DerivedContextType::None,
        evalContextType,
        false, // isArrowFunctionContext
        { }, // empty CodeGenerationMode
        std::nullopt // functionConstructorParametersEndPosition
    );
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, sourceCodeKey, unlinkedCodeBlock);
    if (!cachedBytecode) {
        if (errorLoc) {
            *errorLoc = -1;
        }
        if (errorMessage) {
            WTF::String errMsg = "Failed to encode bytecode"_s;
            *errorMessage = Bun::toStringRef(errMsg);
        }
        return false;
    }

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();
    return true;
}

extern "C" bool generateCachedCommonJSProgramByteCodeFromSourceCode(
    BunString* sourceProviderURL,
    const Latin1Character* inputSourceCode,
    size_t inputSourceCodeSize,
    const uint8_t** outputByteCode,
    size_t* outputByteCodeSize,
    JSC::CachedBytecode** cachedBytecodePtr,
    int32_t* errorLoc,
    BunString* errorMessage
)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    JSC::SourceCode sourceCode = JSC::makeSource(
        WTF::String(sourceCodeSpan),
        JSC::SourceOrigin(WTF::URL(sourceProviderURL->toWTFString())),
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

    if (parserError.isValid()) {
        if (errorLoc) {
            *errorLoc = parserError.token().m_startPosition.offset;
        }
        if (errorMessage) {
            *errorMessage = Bun::toStringRef(parserError.message());
        }
        return false;
    }

    auto sourceCodeKey = JSC::SourceCodeKey(
        sourceCode,
        sourceCode.provider()->sourceURL(),
        JSC::SourceCodeType::ProgramType,
        lexicallyScopedFeatures,
        scriptMode,
        JSC::DerivedContextType::None,
        evalContextType,
        false, // isArrowFunctionContext
        { }, // empty CodeGenerationMode
        std::nullopt // functionConstructorParametersEndPosition
    );
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, sourceCodeKey, unlinkedCodeBlock);
    if (!cachedBytecode) {
        if (errorLoc) {
            *errorLoc = -1;
        }
        if (errorMessage) {
            WTF::String errMsg = "Failed to encode bytecode"_s;
            *errorMessage = Bun::toStringRef(errMsg);
        }
        return false;
    }

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();
    return true;
}

extern "C" BunString ZigSourceProvider__getSourceSlice(JSC::SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}
