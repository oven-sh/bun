#include "root.h"

#include "helpers.h"

#include "ZigSourceProvider.h"
#include "MimallocWTFMalloc.h"
#include "BunAnalyzeTranspiledModule.h"

#include "ZigGlobalObject.h"
#include "wtf/Assertions.h"

#include <JavaScriptCore/Completion.h>
#include <wtf/Scope.h>
#include <wtf/text/StringHash.h>
#include <sys/stat.h>
#include <JavaScriptCore/SourceCodeKey.h>
#include <mimalloc.h>
#include <JavaScriptCore/CodeCache.h>
#include "BunBuiltinNames.h"

namespace Zig {

using SourceOrigin = JSC::SourceOrigin;
using String = WTF::String;
using SourceProviderSourceType = JSC::SourceProviderSourceType;

SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin)
{

    ASSERT_WITH_MESSAGE(!sourceURL.startsWith("file://"_s), "specifier should not already be a file URL");

    if (isBuiltin) {
        if (sourceURL.startsWith("node:"_s)) {
            return SourceOrigin(WTF::URL(makeString("builtin://node/"_s, sourceURL.substring(5))));
        } else if (sourceURL.startsWith("bun:"_s)) {
            return SourceOrigin(WTF::URL(makeString("builtin://bun/"_s, sourceURL.substring(4))));
        } else {
            return SourceOrigin(WTF::URL(makeString("builtin://"_s, sourceURL)));
        }
    }
    return SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL));
}

extern "C" int ByteRangeMapping__getSourceID(void* mappings);
extern "C" void* ByteRangeMapping__find(const BunString* sourceURL);

extern "C" void ByteRangeMapping__generate(const BunString* sourceURL, const BunString* code, int sourceID);

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL)
{
    BunString sourceURLBunString = Bun::toString(sourceURL);
    void* mappings = ByteRangeMapping__find(&sourceURLBunString);
    if (!mappings) {
        return 0;
    }

    return ByteRangeMapping__getSourceID(mappings);
}

extern "C" bool BunTest__shouldGenerateCodeCoverage(const BunString* sourceURL);
extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, const BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, const BunString* specifier);

Ref<SourceProvider> SourceProvider::create(
    Zig::GlobalObject* globalObject,
    ResolvedSource& resolvedSource,
    JSC::SourceProviderSourceType sourceType,
    bool isBuiltin)
{
    // Use BunTranspiledModule when module_info is present.
    // This allows JSC to skip parsing during the analyze phase (uses pre-computed imports/exports).
    // Bytecode cache (if present) is used separately during the evaluate phase.
    if (resolvedSource.module_info != nullptr) {
        ASSERT(!resolvedSource.isCommonJSModule);
        sourceType = JSC::SourceProviderSourceType::BunTranspiledModule;
    }

    auto string = resolvedSource.source_code.transferToWTFString();
    auto sourceURLString = resolvedSource.source_url.transferToWTFString();

    bool isCodeCoverageEnabled = !!globalObject->vm().controlFlowProfiler();

    bool shouldGenerateCodeCoverage = false;
    if (isCodeCoverageEnabled && !isBuiltin) {
        BunString sourceURLBunString = Bun::toString(sourceURLString);
        shouldGenerateCodeCoverage = BunTest__shouldGenerateCodeCoverage(&sourceURLBunString);
    }

    const auto getSourceOrigin = [&]() -> SourceOrigin {
        auto originPath = resolvedSource.origin_path.transferToWTFString();
        if (!originPath.isEmpty())
            return SourceOrigin(WTF::URL::fileURLWithFileSystemPath(originPath));
        return toSourceOrigin(sourceURLString, isBuiltin);
    };

    const auto getProvider = [&]() -> Ref<SourceProvider> {
        auto origin = getSourceOrigin();
        if (resolvedSource.bytecode_cache != nullptr) {
            const auto destructorOwned = [](const void* ptr) {
                ResolvedSource__freeBytecode(static_cast<uint8_t*>(const_cast<void*>(ptr)));
            };
            // Borrowed from the standalone module graph / compile cache.
            const auto destructorNoOp = [](const void*) {};
            Ref<JSC::CachedBytecode> bytecode = JSC::CachedBytecode::create(std::span<uint8_t>(std::exchange(resolvedSource.bytecode_cache, nullptr), resolvedSource.bytecode_cache_size), resolvedSource.bytecode_cache_owned ? destructorOwned : destructorNoOp, {});
            if (resolvedSource.bytecode_cache_persistent)
                bytecode->setPayloadIsPersistent();
            auto provider = adoptRef(*new SourceProvider(
                globalObject->bunVM(),
                resolvedSource,
                string.isNull() ? Ref { *StringImpl::empty() } : Ref { *string.impl() },
                JSC::SourceTaintedOrigin::Untainted,
                origin,
                WTF::move(sourceURLString), TextPosition(),
                sourceType));
            provider->m_hash = resolvedSource.source_code_hash;
            provider->m_cachedBytecode = WTF::move(bytecode);
            return provider;
        }

        return adoptRef(*new SourceProvider(
            globalObject->bunVM(),
            resolvedSource,
            string.isNull() ? Ref { *StringImpl::empty() } : Ref { *string.impl() },
            JSC::SourceTaintedOrigin::Untainted,
            origin,
            WTF::move(sourceURLString), TextPosition(),
            sourceType));
    };

    auto provider = getProvider();

    if (shouldGenerateCodeCoverage) {
        BunString providerURL = Bun::toString(provider->sourceURL());
        WTF::String providerSourceString = provider->source().toStringWithoutCopying();
        BunString providerSource = Bun::toString(providerSourceString);
        ByteRangeMapping__generate(&providerURL, &providerSource, provider->asID());
    }

    if (provider->m_alreadyBundled) {
        BunString str = Bun::toString(provider->sourceURL());
        Bun__addSourceProviderSourceMap(globalObject->bunVM(), provider.ptr(), &str);
    }

    return provider;
}

StringView SourceProvider::source() const
{
    return StringView(m_source.get());
}

SourceProvider::~SourceProvider()
{
    if (m_alreadyBundled) {
        BunString str = Bun::toString(sourceURL());
        Bun__removeSourceProviderSourceMap(m_bunVM, this, &str);
    }
    if (m_moduleInfo) {
        zig__ModuleInfoDeserialized__deinit(m_moduleInfo);
    }
}

extern "C" void CachedBytecode__deref(JSC::CachedBytecode* cachedBytecode)
{
    cachedBytecode->deref();
}

JSC::VM& vmForBytecodeCache();
static thread_local JSC::VM* s_vmForBytecodeCache = nullptr;
// The builtins parse with private @names; this VM has no JSVMClientData to register Bun's, so it owns them directly.
static thread_local std::unique_ptr<WebCore::BunBuiltinNames> s_builtinNamesForBytecodeCache;

JSC::VM& vmForBytecodeCache()
{
    if (!s_vmForBytecodeCache) {
        const auto heapSize = JSC::HeapType::Small;
        auto vmPtr = JSC::VM::tryCreate(heapSize);
        vmPtr->refSuppressingSaferCPPChecking();
        s_vmForBytecodeCache = vmPtr.get();
        vmPtr->heap.acquireAccess();
    }
    return *s_vmForBytecodeCache;
}

void ensureBuiltinNamesForBytecodeCache(JSC::VM& vm)
{
    ASSERT(&vm == s_vmForBytecodeCache);
    if (!s_builtinNamesForBytecodeCache)
        s_builtinNamesForBytecodeCache = WebCore::BunBuiltinNames::createStandalone(vm);
}

extern "C" void Bun__destroyBytecodeCacheVM()
{
    JSC::VM* vm = std::exchange(s_vmForBytecodeCache, nullptr);
    if (!vm)
        return;
    JSC::JSLockHolder locker(*vm);
    s_builtinNamesForBytecodeCache = nullptr;
    vm->derefSuppressingSaferCPPChecking();
}

extern "C" JSC::EncoderStringTable* Bun__EncoderStringTable__create()
{
    return new JSC::EncoderStringTable();
}

extern "C" void Bun__EncoderStringTable__destroy(JSC::EncoderStringTable* table)
{
    delete table;
}

extern "C" void Bun__EncoderStringTable__serialize(JSC::EncoderStringTable* table, void* ctx, void (*append)(void* ctx, const uint8_t* bytes, size_t len))
{
    Vector<uint8_t> bytes = table->serialize();
    append(ctx, bytes.span().data(), bytes.size());
}

extern "C" void JSC__Heap__setInitialAllocationBudget(JSC::VM* vm, size_t bytes)
{
    vm->heap.setInitialAllocationBudget(bytes);
}

extern "C" void Bun__DecoderStringTable__install(JSC::VM* vm, const uint8_t* bytes, size_t len)
{
    ASSERT(vm->clientData);
    static_cast<WebCore::JSVMClientData*>(vm->clientData)->setDecoderStringTable(std::span<const uint8_t>(bytes, len));
}

extern "C" uint32_t Bun__EncoderStringTable__slotForLatin1(JSC::EncoderStringTable* table, const Latin1Character* chars, size_t length)
{
    std::span span { chars, length };
    // slotFor keeps a string only when it takes an ordinal (4+ characters); shorter ones are packed into the slot.
    Ref<StringImpl> string = length <= 3 ? StringImpl::createWithoutCopying(span) : StringImpl::create(span);
    return table->slotFor(string.get());
}

extern "C" uint32_t Bun__EncoderStringTable__slotForUTF16(JSC::EncoderStringTable* table, const char16_t* chars, size_t length)
{
    return table->slotFor(StringImpl::create8BitIfPossible(std::span { chars, length }).get());
}

extern "C" bool generateCachedModuleByteCodeFromSourceCode(const BunString* sourceProviderURL, const BunString* inputSourceCode, uint32_t depth, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr, JSC::EncoderStringTable* externalStrings)
{
    JSC::SourceCode sourceCode = JSC::makeSource(inputSourceCode->toWTFString(), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);

    JSC::VM& vm = vmForBytecodeCache();

    JSC::JSLockHolder locker(vm);
    LexicallyScopedFeatures lexicallyScopedFeatures = StrictModeLexicallyScopedFeature;
    JSParserScriptMode scriptMode = JSParserScriptMode::Module;
    EvalContextType evalContextType = EvalContextType::None;

    ParserError parserError;
    UnlinkedModuleProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForModuleProgram(vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType, depth);
    if (parserError.isValid())
        return false;
    if (!unlinkedCodeBlock)
        return false;

    auto key = JSC::sourceCodeKeyForSerializedModule(vm, sourceCode);

    dataLogLnIf(JSC::Options::verboseDiskCache(), "[Bytecode Build] generateModule url=", sourceProviderURL->toWTFString(), " origin=", sourceCode.provider()->sourceOrigin().url().string(), " sourceSize=", sourceCode.length(), " keyHash=", key.hash());

    // A --compile payload is a section of the executable: no per-record checksums, no patchable records.
    auto checksums = externalStrings ? JSC::BytecodeCacheChecksums::No : JSC::BytecodeCacheChecksums::Yes;
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock, externalStrings, checksums, JSC::BytecodeCacheUpdatable::No);
    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

extern "C" bool generateCachedCommonJSProgramByteCodeFromSourceCode(const BunString* sourceProviderURL, const BunString* inputSourceCode, uint32_t depth, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr, JSC::EncoderStringTable* externalStrings)
{
    JSC::SourceCode sourceCode = JSC::makeSource(inputSourceCode->toWTFString(), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);
    JSC::VM& vm = vmForBytecodeCache();

    JSC::JSLockHolder locker(vm);
    LexicallyScopedFeatures lexicallyScopedFeatures = NoLexicallyScopedFeatures;
    JSParserScriptMode scriptMode = JSParserScriptMode::Classic;
    EvalContextType evalContextType = EvalContextType::None;

    ParserError parserError;
    UnlinkedProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForProgram(vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType, depth);
    if (parserError.isValid())
        return false;
    if (!unlinkedCodeBlock)
        return false;

    auto key = JSC::sourceCodeKeyForSerializedProgram(vm, sourceCode);

    dataLogLnIf(JSC::Options::verboseDiskCache(), "[Bytecode Build] generateCJS url=", sourceProviderURL->toWTFString(), " origin=", sourceCode.provider()->sourceOrigin().url().string(), " sourceSize=", sourceCode.length(), " keyHash=", key.hash());

    // A --compile payload is a section of the executable: no per-record checksums, no patchable records.
    auto checksums = externalStrings ? JSC::BytecodeCacheChecksums::No : JSC::BytecodeCacheChecksums::Yes;
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock, externalStrings, checksums, JSC::BytecodeCacheUpdatable::No);
    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

unsigned SourceProvider::hash() const
{
    if (m_hash) {
        return m_hash;
    }

    return m_source->hash();
}

extern "C" BunString ZigSourceProvider__getSourceSlice(SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

}; // namespace Zig

// What StringImpl::hash() returns for an 8-bit string with these bytes; `bun build --compile` records it per module.
extern "C" uint32_t Bun__WTFStringHashLatin1(const Latin1Character* characters, size_t length)
{
    return StringHasher::computeHashAndMaskTop8Bits(std::span { characters, length });
}

extern "C" uint32_t Bun__WTFStringHashUTF16(const char16_t* characters, size_t length)
{
    return StringHasher::computeHashAndMaskTop8Bits(std::span { characters, length });
}
