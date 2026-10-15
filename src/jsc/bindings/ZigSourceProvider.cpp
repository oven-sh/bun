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
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/AOTProgramData.h>
#include <JavaScriptCore/AOTFunction.h>
#if ENABLE(AOT)
namespace JSC::AOT {
JS_EXPORT_PRIVATE uint64_t imageStamp();
}
#endif
#include <JavaScriptCore/AuditSites.h>
#include <JavaScriptCore/PrivateName.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/StrongInlines.h>
#include <zstd.h>
#include "BunBuiltinNames.h"

#if OS(DARWIN)
#include <execinfo.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#endif
#if OS(LINUX) || OS(FREEBSD)
#include <link.h>
#endif
#if OS(FREEBSD)
#include <sys/types.h>
#include <sys/sysctl.h>
#endif
#if OS(DARWIN)
#include <mach/mach.h>
#include <mach/mach_vm.h>
#endif
#if OS(DARWIN) || OS(LINUX) || OS(FREEBSD)
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <limits.h>
#endif
#include <wtf/PageBlock.h>

static thread_local JSC::AuditSites* s_pendingAuditSites = nullptr;
static thread_local size_t s_lengthOfSourceOfPendingAuditSites = 0;

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

extern "C" void ByteRangeMapping__generate(const BunString* sourceURL, const BunString* code, int sourceID);
extern "C" void ByteRangeMapping__addSourceID(const BunString* sourceURL, const BunString* code, int sourceID);

void addCodeCoverageSourceID(JSC::VM& vm, JSC::SourceProvider& provider)
{
    if (!vm.controlFlowProfiler())
        return;
    BunString sourceURL = Bun::toString(provider.sourceURL());
    WTF::String sourceString = provider.source().toStringWithoutCopying();
    BunString source = Bun::toString(sourceString);
    ByteRangeMapping__addSourceID(&sourceURL, &source, provider.asID());
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
    if (resolvedSource.module_info != nullptr || resolvedSource.is_prelinked_module) {
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
        if (resolvedSource.is_compiled_ahead_of_time) {
            if (getenv("BUN_AOT_VERBOSE")) [[unlikely]]
                fprintf(stderr, "[aot] module: %s\n", byteCast<char>(sourceURLString.utf8().data()));
            auto provider = adoptRef(*new SourceProvider(globalObject->bunVM(), resolvedSource, Ref { *StringImpl::empty() }, JSC::SourceTaintedOrigin::Untainted, origin, WTF::move(sourceURLString), TextPosition(), sourceType));
            provider->setHasNoSourceText();
            provider->setAOTModuleID(resolvedSource.bytecode_cache_entry_offset + 1);
            return provider;
        }
        if (resolvedSource.bytecode_cache != nullptr) {
            // Not owned: borrowed from the standalone module graph / compile cache. No destructor then, so that JSC treats
            // the bytes as outliving the CachedBytecode only when `bytecode_cache_persistent` says so (CachePayload::isOwnedOrPersistent).
            JSC::CachePayload::Destructor destructor = nullptr;
            if (resolvedSource.bytecode_cache_owned) {
                destructor = [](const void* ptr) {
                    ResolvedSource__freeBytecode(static_cast<uint8_t*>(const_cast<void*>(ptr)));
                };
            }
            Ref<JSC::CachedBytecode> bytecode = JSC::CachedBytecode::create(std::span<uint8_t>(std::exchange(resolvedSource.bytecode_cache, nullptr), resolvedSource.bytecode_cache_size), WTF::move(destructor), {});
            if (resolvedSource.bytecode_cache_persistent)
                bytecode->setPayloadIsPersistent();
            bytecode->setEntryOffset(resolvedSource.bytecode_cache_entry_offset);
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

    if (s_pendingAuditSites) [[unlikely]] {
        RefPtr<JSC::AuditSites> sites = adoptRef(std::exchange(s_pendingAuditSites, nullptr));
        if (provider->source().length() == s_lengthOfSourceOfPendingAuditSites)
            provider->setAuditSites(WTF::move(sites));
    }

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

extern "C" void Bun__EncoderStringTable__serialize(JSC::EncoderStringTable* table, const uint64_t* hotStringHashes, size_t hotStringHashCount, void* ctx, void (*append)(void* ctx, const uint8_t* bytes, size_t len))
{
    Vector<uint8_t> bytes = table->serialize(std::span { hotStringHashes, hotStringHashCount });
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

// Parses `inputSourceCode` and generates the unlinked code of all of it (nested functions down to `depth`). Null on a
// parse error. The caller holds the bytecode VM's lock.
static JSC::UnlinkedCodeBlock* generateUnlinkedCodeForBytecodeCache(JSC::VM& vm, const BunString* sourceProviderURL, const BunString* inputSourceCode, bool isModule, uint32_t depth, bool optimize, JSC::SourceCode& sourceCode, JSC::SourceCodeKey& key)
{
    sourceCode = JSC::makeSource(inputSourceCode->toWTFString(), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);
    EvalContextType evalContextType = EvalContextType::None;
    JSC::OptimizeBytecode optimizeBytecode = optimize ? JSC::OptimizeBytecode::Yes : JSC::OptimizeBytecode::No;
    ParserError parserError;
    JSC::UnlinkedCodeBlock* unlinkedCodeBlock = isModule
        ? static_cast<JSC::UnlinkedCodeBlock*>(JSC::recursivelyGenerateUnlinkedCodeBlockForModuleProgram(vm, sourceCode, StrictModeLexicallyScopedFeature, JSParserScriptMode::Module, {}, parserError, evalContextType, depth, optimizeBytecode))
        : static_cast<JSC::UnlinkedCodeBlock*>(JSC::recursivelyGenerateUnlinkedCodeBlockForProgram(vm, sourceCode, NoLexicallyScopedFeatures, JSParserScriptMode::Classic, {}, parserError, evalContextType, depth, optimizeBytecode));
    if (parserError.isValid() || !unlinkedCodeBlock)
        return nullptr;
    key = isModule ? JSC::sourceCodeKeyForSerializedModule(vm, sourceCode) : JSC::sourceCodeKeyForSerializedProgram(vm, sourceCode);
    dataLogLnIf(JSC::Options::verboseDiskCache(), "[Bytecode Build] ", isModule ? "generateModule" : "generateCJS", " url=", sourceProviderURL->toWTFString(), " origin=", sourceCode.provider()->sourceOrigin().url().string(), " sourceSize=", sourceCode.length(), " keyHash=", key.hash());
    return unlinkedCodeBlock;
}

static bool generateCachedByteCodeFromSourceCode(const BunString* sourceProviderURL, const BunString* inputSourceCode, bool isModule, uint32_t depth, bool optimize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr, JSC::EncoderStringTable* externalStrings)
{
    JSC::VM& vm = vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    JSC::SourceCode sourceCode;
    JSC::SourceCodeKey key;
    JSC::UnlinkedCodeBlock* unlinkedCodeBlock = generateUnlinkedCodeForBytecodeCache(vm, sourceProviderURL, inputSourceCode, isModule, depth, optimize, sourceCode, key);
    if (!unlinkedCodeBlock)
        return false;

    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock, externalStrings, JSC::BytecodeCacheUpdatable::No);
    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

extern "C" bool generateCachedModuleByteCodeFromSourceCode(const BunString* sourceProviderURL, const BunString* inputSourceCode, uint32_t depth, bool optimize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr, JSC::EncoderStringTable* externalStrings)
{
    return generateCachedByteCodeFromSourceCode(sourceProviderURL, inputSourceCode, true, depth, optimize, outputByteCode, outputByteCodeSize, cachedBytecodePtr, externalStrings);
}

extern "C" bool generateCachedCommonJSProgramByteCodeFromSourceCode(const BunString* sourceProviderURL, const BunString* inputSourceCode, uint32_t depth, bool optimize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr, JSC::EncoderStringTable* externalStrings)
{
    return generateCachedByteCodeFromSourceCode(sourceProviderURL, inputSourceCode, false, depth, optimize, outputByteCode, outputByteCodeSize, cachedBytecodePtr, externalStrings);
}

// `bun build --compile --bytecode` with a payload order file (--bytecode-order): one payload for the whole link.
// Created, fed and finished on the bundler's bytecode thread (it uses that thread's bytecode VM).
extern "C" JSC::BytecodeLinkEncoder* Bun__BytecodeLinkEncoder__create(JSC::EncoderStringTable* externalStrings, const uint64_t* hotFunctions, size_t hotFunctionCount, const uint64_t* knownFunctions, size_t knownFunctionCount, const uint64_t* evaluatedModules, size_t evaluatedModuleCount, const uint64_t* notEvaluatedModules, size_t notEvaluatedModuleCount, bool compileAheadOfTime)
{
    JSC::VM& vm = vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    JSC::BytecodeLinkEncoder::Hints hints;
    hints.hotFunctions.append(std::span { hotFunctions, hotFunctionCount });
    hints.knownFunctions.append(std::span { knownFunctions, knownFunctionCount });
    hints.evaluatedModules.append(std::span { evaluatedModules, evaluatedModuleCount });
    hints.notEvaluatedModules.append(std::span { notEvaluatedModules, notEvaluatedModuleCount });
    hints.compileAheadOfTime = compileAheadOfTime;
    vm.useImmutableIntrinsics |= compileAheadOfTime;
    return new JSC::BytecodeLinkEncoder(vm, externalStrings, WTF::move(hints));
}

// An encoder roots cells of the bytecode VM it was created on: it is used and destroyed on that thread, before
// Bun__destroyBytecodeCacheVM.
JSC::VM& vmOfBytecodeLinkEncoder(JSC::BytecodeLinkEncoder& encoder)
{
    RELEASE_ASSERT(&encoder.vm() == s_vmForBytecodeCache);
    return encoder.vm();
}

extern "C" void Bun__BytecodeLinkEncoder__destroy(JSC::BytecodeLinkEncoder* encoder)
{
    JSC::JSLockHolder locker(vmOfBytecodeLinkEncoder(*encoder));
    delete encoder;
}

extern "C" bool Bun__BytecodeLinkEncoder__addModule(JSC::BytecodeLinkEncoder* encoder, const BunString* sourceProviderURL, const BunString* inputSourceCode, bool isModule, uint32_t depth, bool optimize, const Bun::BytecodeOrderNamesRef& names)
{
    JSC::VM& vm = vmOfBytecodeLinkEncoder(*encoder);
    JSC::JSLockHolder locker(vm);
    JSC::SourceCode sourceCode;
    JSC::SourceCodeKey key;
    JSC::UnlinkedCodeBlock* unlinkedCodeBlock = generateUnlinkedCodeForBytecodeCache(vm, sourceProviderURL, inputSourceCode, isModule, depth, optimize, sourceCode, key);
    if (!unlinkedCodeBlock)
        return false;
    encoder->addModule(key, unlinkedCodeBlock, sourceCode, names.view());
    return true;
}

extern "C" bool Bun__BytecodeLinkEncoder__setTypedProgram(JSC::BytecodeLinkEncoder* encoder, const uint8_t* program, size_t size, const uint32_t* modules, size_t numberOfModules, const uint8_t* replacedStrings, size_t replacedStringsSize)
{
    return encoder->setTypedProgram({ program, size }, std::span { modules, numberOfModules }, { replacedStrings, replacedStringsSize });
}

extern "C" JSC::BytecodeLinkEncoder::PreparedTypedProgram* Bun__AOT__readTypedProgram(const uint8_t* program, size_t size)
{
    return JSC::BytecodeLinkEncoder::readTypedProgram({ program, size });
}

extern "C" void Bun__AOT__optimizeTypedProgram(JSC::BytecodeLinkEncoder::PreparedTypedProgram* prepared, const uint8_t* replacedStrings, size_t replacedStringsSize)
{
    JSC::BytecodeLinkEncoder::optimizeTypedProgram(*prepared, { replacedStrings, replacedStringsSize });
}

extern "C" void Bun__AOT__discardTypedProgram(JSC::BytecodeLinkEncoder::PreparedTypedProgram* prepared)
{
    JSC::BytecodeLinkEncoder::discardTypedProgram(prepared);
}

extern "C" bool Bun__BytecodeLinkEncoder__setPreparedTypedProgram(JSC::BytecodeLinkEncoder* encoder, JSC::BytecodeLinkEncoder::PreparedTypedProgram* prepared, const uint32_t* modules, size_t numberOfModules)
{
    return encoder->setTypedProgram(prepared, std::span { modules, numberOfModules });
}

extern "C" void Bun__BytecodeLinkEncoder__setPrelinkedModuleGraph(JSC::BytecodeLinkEncoder* encoder, const uint8_t* blob, size_t blobSize, const uint32_t* stringSlots, size_t stringSlotCount, const uint32_t* graphModuleIndices, size_t addCount)
{
    JSC::JSLockHolder locker(vmOfBytecodeLinkEncoder(*encoder));
    encoder->setPrelinkedModuleGraph({ blob, blobSize }, { stringSlots, stringSlotCount }, Vector<uint32_t>(std::span { graphModuleIndices, addCount }));
}

// `entryOffsets` has room for one number per successful add* call; `regionEnds` for
// JSC::BytecodeLinkEncoder::numberOfRegions.
static_assert(JSC::BytecodeLinkEncoder::numberOfRegions == 6, "bun_resolver::LINKED_BYTECODE_REGION_COUNT");
static thread_local Vector<uint8_t> s_lastLinkAOTImage;
static thread_local RefPtr<JSC::CachedBytecode> s_lastLinkPayload;
static thread_local Vector<uint32_t> s_lastLinkModules;
static thread_local Vector<JSC::FunctionReportableSites> s_lastLinkReportableSites;
static thread_local Vector<std::optional<Vector<uint32_t>>> s_lastLinkExportedVariables;
static thread_local Vector<uint8_t> s_aotImageForProgramData;
extern "C" const uint8_t* Bun__BytecodeLinkEncoder__aotImage(size_t* size)
{
    *size = JSC::aotImageSize(s_lastLinkAOTImage.span()).value_or(s_lastLinkAOTImage.size());
    return s_lastLinkAOTImage.span().data();
}
extern "C" void Bun__BytecodeLinkEncoder__freeAOTImage()
{
    s_aotImageForProgramData = std::exchange(s_lastLinkAOTImage, { });
}
extern "C" bool Bun__BytecodeLinkEncoder__finish(JSC::BytecodeLinkEncoder* encoder, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr, uint32_t* entryOffsets, size_t entryOffsetCount, uint32_t* regionEnds, uint32_t* namedHotFunctions, uint32_t* placedHotFunctions, uint32_t* functionsWithoutName)
{
    JSC::JSLockHolder locker(vmOfBytecodeLinkEncoder(*encoder));
    auto result = encoder->finish();
    if (!result.payload || result.entryOffsets.size() != entryOffsetCount)
        return false;
    memcpySpan(std::span { entryOffsets, entryOffsetCount }, result.entryOffsets.span());
    memcpySpan(std::span { regionEnds, JSC::BytecodeLinkEncoder::numberOfRegions }, std::span<const uint32_t> { result.regionEnds });
    *namedHotFunctions = result.namedHotFunctions;
    *placedHotFunctions = result.placedHotFunctions;
    *functionsWithoutName = result.functionsWithoutName;
    s_lastLinkAOTImage = WTF::move(result.aotImage);
    if (!s_lastLinkAOTImage.isEmpty()) {
        s_lastLinkPayload = result.payload;
        s_lastLinkModules = WTF::move(result.moduleEntryOffsets);
        s_lastLinkReportableSites = WTF::move(result.reportableSites);
        s_lastLinkExportedVariables = WTF::move(result.variablesExportedByModules);
    }
    *outputByteCode = result.payload->span().data();
    *outputByteCodeSize = result.payload->span().size();
    *cachedBytecodePtr = result.payload.leakRef();
    return true;
}

extern "C" void Bun__BytecodeLinkEncoder__takeBuildErrors(JSC::BytecodeLinkEncoder* encoder, void* ctx, void (*add)(void* ctx, const uint8_t* message, size_t messageLength, const uint8_t* path, size_t pathLength, uint32_t line, uint32_t column))
{
    for (auto& error : encoder->takeBuildErrors()) {
        auto message = error.message.utf8();
        auto path = error.path.utf8();
        add(ctx, byteCast<uint8_t>(message.data()), message.length(), byteCast<uint8_t>(path.data()), path.length(), error.position.line, error.position.column);
    }
}

#if OS(DARWIN) || OS(LINUX) || OS(FREEBSD)
static std::optional<off_t> offsetInExecutableFile(const void* address)
{
    uintptr_t target = reinterpret_cast<uintptr_t>(address);
#if OS(DARWIN)
    const mach_header_64* header = nullptr;
    uintptr_t slide = 0;
    for (uint32_t i = 0, count = _dyld_image_count(); i < count; ++i) {
        auto* candidate = reinterpret_cast<const mach_header_64*>(_dyld_get_image_header(i));
        if (candidate && candidate->filetype == MH_EXECUTE) {
            header = candidate;
            slide = _dyld_get_image_vmaddr_slide(i);
            break;
        }
    }
    if (!header)
        return std::nullopt;
    auto* command = reinterpret_cast<const load_command*>(header + 1);
    for (uint32_t i = 0; i < header->ncmds; ++i) {
        if (command->cmd == LC_SEGMENT_64) {
            auto* segment = reinterpret_cast<const segment_command_64*>(command);
            uintptr_t start = segment->vmaddr + slide;
            if (target >= start && target - start < segment->filesize)
                return static_cast<off_t>(segment->fileoff + (target - start));
        }
        command = reinterpret_cast<const load_command*>(reinterpret_cast<const char*>(command) + command->cmdsize);
    }
#else
    std::optional<off_t> result;
    struct Context {
        uintptr_t target;
        std::optional<off_t>& result;
    } context { target, result };
    dl_iterate_phdr([](struct dl_phdr_info* info, size_t, void* data) -> int {
        auto& context = *static_cast<Context*>(data);
        for (unsigned i = 0; i < info->dlpi_phnum; ++i) {
            auto& segment = info->dlpi_phdr[i];
            uintptr_t start = info->dlpi_addr + segment.p_vaddr;
            if (segment.p_type == PT_LOAD && context.target >= start && context.target - start < segment.p_filesz)
                context.result = static_cast<off_t>(segment.p_offset + (context.target - start));
        }
        return 1;
    }, &context);
    return result;
#endif
    return std::nullopt;
}
#endif

extern "C" bool Bun__AOT__textOfFunctionInFile(JSC::JSGlobalObject*, const BunString* path, uint32_t place, BunString* text);

extern "C" void Bun__AOT__setImageCodec()
{
#if ENABLE(AOT)
    JSC::AOT::setTextOfFunctionInFile([](JSC::JSGlobalObject* globalObject, const WTF::String& path, uint32_t place) -> WTF::String {
        BunString pathOfFile = Bun::toString(path);
        BunString text = BunStringEmpty;
        return Bun__AOT__textOfFunctionInFile(globalObject, &pathOfFile, place, &text) ? text.transferToWTFString() : WTF::String();
    });
    JSC::AOT::setCodec(
        [](const uint8_t* source, size_t sourceSize, uint8_t* destination, size_t capacity) -> size_t {
            size_t size = ZSTD_compress(destination, capacity, source, sourceSize, 19);
            return ZSTD_isError(size) ? 0 : size;
        },
        [](const uint8_t* source, size_t sourceSize, uint8_t* destination, size_t size) -> bool {
            return ZSTD_decompress(destination, size, source, sourceSize) == size;
        });
#endif
}

extern "C" void Bun__AOT__buildProgramData(const uint8_t* strings, size_t stringsSize, void* ctx, void (*reserve)(void* ctx, size_t size), void (*append)(void* ctx, const uint8_t* bytes, size_t size),
    void* findCtx, bool (*find)(void* ctx, uint32_t moduleEntryOffset, uint32_t line, uint32_t column, const uint8_t** name, size_t* nameLength, uint32_t* lineInSource, uint32_t* columnInSource))
{
    Vector<JSC::FunctionReportableSites> reportableSites = std::exchange(s_lastLinkReportableSites, { });
    Vector<uint8_t> codeImage = std::exchange(s_aotImageForProgramData, { });
    JSC::VM& vm = vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    RefPtr payload = std::exchange(s_lastLinkPayload, nullptr);
    Vector<uint32_t> modules = std::exchange(s_lastLinkModules, { });
    Vector<std::optional<Vector<uint32_t>>> variablesExportedByModules = std::exchange(s_lastLinkExportedVariables, { });
    JSC::AOT::ProgramData::RetainedPositions positions { reportableSites, [&](uint32_t moduleEntryOffset, JSC::LineColumn inModule, UTF8CString& sourceName, JSC::LineColumn& inSource) {
        const uint8_t* name = nullptr;
        size_t nameLength = 0;
        uint32_t line = 0;
        uint32_t column = 0;
        if (!find(findCtx, moduleEntryOffset, inModule.line, inModule.column, &name, &nameLength, &line, &column))
            return false;
        sourceName = UTF8CString(std::span { reinterpret_cast<const char8_t*>(name), nameLength });
        inSource = { line, column };
        return true;
    } };
    Vector<uint8_t> image = JSC::AOT::ProgramData::build(vm, { strings, stringsSize }, payload ? payload->span() : std::span<const uint8_t> { }, modules.span(), codeImage.span(), positions, reportableSites.span(), variablesExportedByModules.span());
    JSC::AOT::ProgramData::release(reportableSites);
    if (image.isEmpty())
        return;
    size_t codeImageSize = JSC::aotImageSize(codeImage.span()).value_or(codeImage.size());
    reserve(ctx, codeImageSize + image.size());
    append(ctx, codeImage.span().data(), codeImageSize);
    append(ctx, image.span().data(), image.size());
}

#if OS(DARWIN) || OS(LINUX) || OS(FREEBSD)
static int openExecutable()
{
#if OS(DARWIN)
    char path[PATH_MAX * 2];
    uint32_t pathSize = sizeof(path);
    if (_NSGetExecutablePath(path, &pathSize))
        return -1;
#elif OS(FREEBSD)
    char path[PATH_MAX];
    size_t pathSize = sizeof(path);
    int name[] = { CTL_KERN, KERN_PROC, KERN_PROC_PATHNAME, -1 };
    if (sysctl(name, std::size(name), path, &pathSize, nullptr, 0))
        return -1;
#else
    const char* path = "/proc/self/exe";
#endif
    return open(path, O_RDONLY | O_CLOEXEC);
}
#endif

extern "C" bool Bun__AOT__isCompiledEntryPoint(uint32_t module)
{
#if ENABLE(AOT)
    return JSC::AOT::Typed::isEntryPoint(module);
#else
    return false;
#endif
}

extern "C" size_t Bun__AOT__imageAlignment()
{
    return JSC::aotImageAlignment();
}

extern "C" uint64_t Bun__AOT__stamp()
{
#if ENABLE(AOT)
    return JSC::AOT::imageStamp();
#else
    return 0;
#endif
}

extern "C" bool Bun__AOT__imageStringTable(const uint8_t* bytes, size_t length, size_t* result)
{
    auto codeImageSize = JSC::aotImageSize({ bytes, length });
    if (!codeImageSize || *codeImageSize >= length)
        return false;
    auto found = JSC::AOT::ProgramData::stringTableIn({ bytes + *codeImageSize, length - *codeImageSize });
    if (!found)
        return false;
    result[0] = *codeImageSize + found->first;
    result[1] = found->second;
    return true;
}

#if OS(DARWIN)
static bool keepsOnlyCodeExecutable(const uint8_t* bytes, size_t length)
{
    mach_vm_address_t image = reinterpret_cast<mach_vm_address_t>(bytes);
    mach_vm_address_t start = image;
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info;
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t object = MACH_PORT_NULL;
    if (mach_vm_region(mach_task_self(), &start, &size, VM_REGION_BASIC_INFO_64, reinterpret_cast<vm_region_info_t>(&info), &count, &object) != KERN_SUCCESS)
        return false;
    auto range = JSC::aotImageCodeRange({ bytes, length });
    if (start > image || !(info.protection & VM_PROT_EXECUTE) || !range)
        return false;
    mach_vm_address_t code = image + range->first;
    mach_vm_address_t endOfCode = mach_vm_round_page(code + range->second);
    if (code != mach_vm_trunc_page(code) || endOfCode > start + size)
        return false;
    if (code > start)
        mach_vm_protect(mach_task_self(), start, code - start, true, VM_PROT_READ);
    if (endOfCode < start + size)
        mach_vm_protect(mach_task_self(), endOfCode, start + size - endOfCode, true, VM_PROT_READ);
    return true;
}
#endif

extern "C" bool Bun__AOT__symbolsOfImage(const uint8_t* image, size_t length, void* ctx, uint8_t* (*reserve)(void* ctx, size_t size))
{
#if ENABLE(AOT)
    auto symbols = JSC::AOT::symbolsOfImage({ image, length });
    if (symbols.isEmpty())
        return false;
    memcpy(reserve(ctx, symbols.size()), symbols.span().data(), symbols.size());
    return true;
#else
    UNUSED_PARAM(image);
    UNUSED_PARAM(length);
    UNUSED_PARAM(ctx);
    UNUSED_PARAM(reserve);
    return false;
#endif
}

extern "C" void Bun__AOT__useImage(const uint8_t* bytes, size_t length, int fileDescriptor, int64_t offsetInFile)
{
#if OS(DARWIN) || OS(LINUX) || OS(FREEBSD) || OS(WINDOWS)
    const char* verbose = getenv("BUN_AOT_VERBOSE");
#if OS(WINDOWS)
    UNUSED_PARAM(offsetInFile);
    const char* isNotInExecutable = "it is not in the executable";
    JSC::AOTFileUse use = fileDescriptor < 0 ? JSC::useAOTFileInLoadedSection({ bytes, length }) : JSC::AOTFileUse { isNotInExecutable, isNotInExecutable };
#else
    bool isInExecutable = fileDescriptor < 0;
    JSC::AOTFileUse use;
#if OS(DARWIN)
    if (isInExecutable && keepsOnlyCodeExecutable(bytes, length))
        use = JSC::useAOTFileInLoadedSection({ bytes, length });
#else
    if (isInExecutable)
        use = JSC::useAOTFileInLoadedSection({ bytes, length });
#endif
    bool isUsedWhereItLies = !!use.code;
    if (isInExecutable && !isUsedWhereItLies) {
        auto offset = offsetInExecutableFile(bytes);
        fileDescriptor = offset ? openExecutable() : -1;
        offsetInFile = offset.value_or(0);
    }
    const char* cannotOpen = "cannot find it in the executable's file";
    if (!isUsedWhereItLies)
        use = fileDescriptor >= 0 ? JSC::useAOTFile({ bytes, length }, fileDescriptor, offsetInFile) : JSC::AOTFileUse { cannotOpen, cannotOpen };
    if (isInExecutable && fileDescriptor >= 0)
        close(fileDescriptor);
#endif
    if (const char* reason = use.imageRejectionReason ? use.imageRejectionReason : use.programDataRejectionReason) {
        fprintf(stderr, "error: this program's compiled code cannot be used: %s\n", reason);
        exit(1);
    }
    if (!verbose)
        return;
    fprintf(stderr, "[aot] program data: %zu bytes\n", use.programDataSize);
    fprintf(stderr, "[aot] image: %zu bytes, %zu of code at %p, %u regular expressions\n", length, use.codeSizeInBytes, use.code, JSC::aotImageRegExpCount({ bytes, length }).value_or(0));
#if !OS(WINDOWS)
    if (!strcmp(verbose, "2") && use.codeSizeInBytes > 4096) {
        auto* start = static_cast<const uint8_t*>(use.code);
        for (auto* at = start; (at = static_cast<const uint8_t*>(memmem(at, start + use.codeSizeInBytes - at, start, 512))); at += 512)
            fprintf(stderr, "[aot] stubs at image+0x%zx\n", static_cast<size_t>(at - start));
    }
#endif
#else
    UNUSED_PARAM(bytes);
    UNUSED_PARAM(length);
    UNUSED_PARAM(fileDescriptor);
    UNUSED_PARAM(offsetInFile);
#endif
}

extern "C" int64_t Bun__AOT__offsetInCode(const void* address)
{
#if ENABLE(AOT)
    auto offset = JSC::AOT::imageCodeOffset(address);
    return offset ? static_cast<int64_t>(*offset) : -1;
#else
    UNUSED_PARAM(address);
    return -1;
#endif
}

extern "C" uintptr_t Bun__AOT__addressOfOffsetInCode(size_t offset)
{
#if ENABLE(AOT)
    return JSC::AOT::startOfImageCode() + offset;
#else
    return offset;
#endif
}

extern "C" size_t Bun__AOT__describeAddresses(const void* const* addresses, size_t count, char* buffer, size_t capacity)
{
#if ENABLE(AOT)
    auto text = JSC::AOT::describeCodeAddresses({ addresses, count }).utf8();
    size_t length = std::min(capacity, text.length());
    if (length)
        memcpy(buffer, text.data(), length);
    return length;
#else
    UNUSED_PARAM(addresses);
    UNUSED_PARAM(count);
    UNUSED_PARAM(buffer);
    UNUSED_PARAM(capacity);
    return 0;
#endif
}

// BUN_BYTECODE_ORDER_OUT: record what this VM reads out of the executable's bytecode payload from here on.
extern "C" void Bun__BytecodeOrder__enableRecording(JSC::VM* vm)
{
    JSC::JSLockHolder locker(*vm);
    auto& recorder = vm->persistentBytecodePayloads().enableOrderRecording();
    if (vm->clientData) {
        if (auto* strings = vm->clientData->decoderStringTable())
            strings->enableFirstUseRecording(recorder);
    }
}

// The executable's bytecode was laid out by an order file: count what this VM decodes out of it by region.
extern "C" void Bun__BytecodeOrder__setLinkedPayload(JSC::VM* vm, const uint8_t* payload, size_t payloadSize, const uint32_t* regionEnds, size_t regionCount)
{
    std::array<uint32_t, JSC::BytecodeLinkRegions::Count> ends;
    RELEASE_ASSERT(regionCount == ends.size());
    std::copy_n(regionEnds, ends.size(), ends.begin());
    vm->persistentBytecodePayloads().setLinkedPayload({ payload, payloadSize }, ends);
}

// BUN_BYTECODE_ORDER_OUT, when the process exits: what every VM of the process recorded (JSC::bytecodeOrderRecording),
// for bun_bundler::bytecode_order::write to name. `take` is called once; what it is given is gone when it returns.
extern "C" void Bun__BytecodeOrder__takeRecording(void* ctx, void (*take)(void* ctx, const JSC::RecordedOrderSource* sources, size_t sourceCount, const JSC::RecordedOrderFunction* functions, size_t functionCount, const unsigned* evaluatedSources, size_t evaluatedSourceCount, const unsigned* rejectedSources, size_t rejectedSourceCount, const uint64_t* strings, size_t stringCount))
{
    static_assert(sizeof(JSC::RecordedOrderSource) == 16 && offsetof(JSC::RecordedOrderSource, entryOffset) == 8, "bun_bundler::bytecode_order::RecordedSource");
    static_assert(sizeof(JSC::RecordedOrderFunction) == 12 && offsetof(JSC::RecordedOrderFunction, key) == 4 && offsetof(JSC::OrderFunctionKey, kind) == 4, "bun_bundler::bytecode_order::RecordedFunction");
    auto recording = JSC::bytecodeOrderRecording();
    take(ctx, recording.sources.span().data(), recording.sources.size(), recording.functions.span().data(), recording.functions.size(), recording.evaluatedSources.span().data(), recording.evaluatedSources.size(), recording.rejectedSources.span().data(), recording.rejectedSources.size(), recording.strings.span().data(), recording.strings.size());
}

// BUN_BYTECODE_DIGEST_OUT: JSC::digestOfAllCachedCode for one module of the executable.
extern "C" bool Bun__BytecodeOrder__digestModule(JSC::VM* vm, const BunString* source, const BunString* originPath, bool isModule, uint8_t* bytecode, size_t bytecodeSize, uint32_t entryOffset, uint64_t* digest, uint32_t* codeBlocks)
{
    JSC::JSLockHolder locker(*vm);
    JSC::SourceCode sourceCode = JSC::makeSource(source->toWTFString(), toSourceOrigin(originPath->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);
    auto result = JSC::digestOfAllCachedCode(*vm, sourceCode, isModule, Bun::embeddedBytecode({ bytecode, bytecodeSize }, entryOffset));
    if (!result)
        return false;
    *digest = result->digest;
    *codeBlocks = result->codeBlocks;
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

namespace Bun {

// bun:internal-for-testing: whether the source of a function knows where its lines start. Before anything asked for a
// position in it, that means they came with its code: from the parse, or out of the bytecode.
JSC_DEFINE_HOST_FUNCTION(jsSourceHasLineStarts, (JSC::JSGlobalObject*, JSC::CallFrame* callFrame))
{
    auto* function = dynamicDowncast<JSC::JSFunction>(callFrame->argument(0));
    if (!function || function->isHostFunction())
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsBoolean(function->jsExecutable()->source().provider()->lineStartTableIsBuilt()));
}

} // namespace Bun

// What StringImpl::hash() returns for an 8-bit string with these bytes; `bun build --compile` records it per module.
extern "C" uint32_t Bun__WTFStringHashLatin1(const Latin1Character* characters, size_t length)
{
    return StringHasher::computeHashAndMaskTop8Bits(std::span { characters, length });
}

extern "C" uint32_t Bun__WTFStringHashUTF16(const char16_t* characters, size_t length)
{
    return StringHasher::computeHashAndMaskTop8Bits(std::span { characters, length });
}

extern "C" void Bun__AOTAudit__describe(uint32_t id, BunString* out);
extern "C" void Bun__AOTAudit__describeShape(const BunString* key, BunString* out);
extern "C" void Bun__AOTAudit__write(const uint8_t* line, size_t length);

extern "C" void Bun__AOTAudit__setPendingSites(size_t lengthOfSource, const uint32_t* expressions, size_t numberOfExpressions, const uint32_t* parameters, size_t numberOfParameters)
{
    if (auto* stale = std::exchange(s_pendingAuditSites, nullptr))
        stale->deref();
    if (!numberOfExpressions && !numberOfParameters)
        return;
    Vector<JSC::AuditedExpression> listedExpressions;
    listedExpressions.reserveInitialCapacity(numberOfExpressions);
    for (size_t i = 0; i < numberOfExpressions; ++i)
        listedExpressions.append(JSC::AuditedExpression { expressions[6 * i], expressions[6 * i + 1], expressions[6 * i + 2], expressions[6 * i + 3], static_cast<int32_t>(expressions[6 * i + 4]), static_cast<int32_t>(expressions[6 * i + 5]) });
    Vector<JSC::AuditedParameter> listedParameters;
    listedParameters.reserveInitialCapacity(numberOfParameters);
    for (size_t i = 0; i < numberOfParameters; ++i)
        listedParameters.append(JSC::AuditedParameter { parameters[6 * i], parameters[6 * i + 1], parameters[6 * i + 2], parameters[6 * i + 3], static_cast<int32_t>(parameters[6 * i + 4]), static_cast<int32_t>(parameters[6 * i + 5]) });
    s_pendingAuditSites = &JSC::AuditSites::create(WTF::move(listedExpressions), WTF::move(listedParameters)).leakRef();
    s_lengthOfSourceOfPendingAuditSites = lengthOfSource;
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditDescribe, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    BunString described;
    JSC::JSValue asked = callFrame->argument(0);
    if (asked.isString()) {
        WTF::String key = asked.getString(globalObject);
        BunString borrowed = Bun::toString(key);
        Bun__AOTAudit__describeShape(&borrowed, &described);
    } else
        Bun__AOTAudit__describe(asked.asUInt32(), &described);
    return JSC::JSValue::encode(JSC::jsString(globalObject->vm(), described.transferToWTFString()));
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditWrite, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto line = makeString(callFrame->argument(0).getString(globalObject), '\n').utf8();
    Bun__AOTAudit__write(byteCast<uint8_t>(line.data()), line.length());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditIsProxy, (JSC::JSGlobalObject*, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsBoolean(!!dynamicDowncast<JSC::ProxyObject>(callFrame->argument(0))));
}

struct AOTAuditShortcut {
    int32_t least { 1 };
    int32_t most { 0 };
    JSC::StructureID passing[4] {};
    uint32_t asleepIn { 0 };
    uint32_t madeIn { 0 };
    bool tags { false };
};

static std::atomic<uint32_t> s_auditGeneration { 1 };

extern "C" void Bun__AOTAudit__setGeneration(uint32_t generation)
{
    s_auditGeneration.store(generation, std::memory_order_release);
}

static thread_local Vector<AOTAuditShortcut>* s_auditShortcuts = nullptr;
static thread_local UncheckedKeyHashMap<JSC::JSGlobalObject*, JSC::Strong<JSC::JSObject>>* s_auditHelpers = nullptr;
static thread_local JSC::PrivateName* s_auditTag = nullptr;

static AOTAuditShortcut& auditShortcut(uint32_t id)
{
    if (!s_auditShortcuts)
        s_auditShortcuts = new Vector<AOTAuditShortcut>();
    if (id >= s_auditShortcuts->size())
        s_auditShortcuts->grow(std::max<size_t>(id + 1, s_auditShortcuts->size() * 2));
    auto& shortcut = s_auditShortcuts->at(id);
    uint32_t generation = s_auditGeneration.load(std::memory_order_acquire);
    if (shortcut.madeIn != generation) {
        shortcut = AOTAuditShortcut {};
        shortcut.madeIn = generation;
    }
    return shortcut;
}

static JSC::PrivateName& auditTag()
{
    if (!s_auditTag)
        s_auditTag = new JSC::PrivateName(JSC::PrivateName::PrivateSymbol, "aotAuditShape"_s);
    return *s_auditTag;
}

static void tagForAudit(JSC::VM& vm, JSC::JSValue value, uint32_t id)
{
    if (!value.isCell() || value.asCell()->type() != JSC::FinalObjectType)
        return;
    auditTag();
    JSC::asObject(value)->putDirect(vm, JSC::PropertyName(*s_auditTag), JSC::jsNumber(id), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditCheck, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue number = callFrame->argument(1);
    if (!number.isUInt32()) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsUndefined());
    uint32_t id = number.asUInt32();
    auto& vm = JSC::getVM(globalObject);
    uint32_t generation = s_auditGeneration.load(std::memory_order_acquire);
    if (s_auditShortcuts && id < s_auditShortcuts->size()) [[likely]] {
        auto& shortcut = s_auditShortcuts->at(id);
        if (shortcut.madeIn != generation) [[unlikely]] {
            shortcut = AOTAuditShortcut {};
            shortcut.madeIn = generation;
        }
        if (shortcut.asleepIn == generation)
            return JSC::JSValue::encode(JSC::jsUndefined());
        if (value.isInt32()) {
            if (value.asInt32() >= shortcut.least && value.asInt32() <= shortcut.most)
                return JSC::JSValue::encode(JSC::jsUndefined());
        } else if (value.isCell()) {
            JSC::StructureID structure = value.asCell()->structureID();
            if (structure == shortcut.passing[0] || structure == shortcut.passing[1] || structure == shortcut.passing[2] || structure == shortcut.passing[3])
                return JSC::JSValue::encode(JSC::jsUndefined());
            if (shortcut.tags) {
                tagForAudit(vm, value, id);
                return JSC::JSValue::encode(JSC::jsUndefined());
            }
        }
    }
    if (!s_auditHelpers) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsUndefined());
    auto found = s_auditHelpers->find(globalObject);
    if (found == s_auditHelpers->end()) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsUndefined());
    JSC::JSObject* helper = found->value.get();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(value);
    arguments.append(number);
    arguments.append(JSC::jsNumber(generation));
    JSC::JSValue answer = JSC::call(globalObject, helper, arguments, "bun:aot-audit"_s);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    if (answer.isInt32() && answer.asInt32() == 4)
        auditShortcut(id).asleepIn = generation;
    else if (answer.isInt32() && value.isCell()) {
        auto& shortcut = auditShortcut(id);
        if (answer.asInt32() == 1 && !JSC::hasAnyArrayStorage(value.asCell()->indexingType())) {
            shortcut.passing[3] = shortcut.passing[2];
            shortcut.passing[2] = shortcut.passing[1];
            shortcut.passing[1] = shortcut.passing[0];
            shortcut.passing[0] = value.asCell()->structureID();
        } else if (answer.asInt32() == 3) {
            shortcut.tags = true;
            tagForAudit(vm, value, id);
        }
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditRemember, (JSC::JSGlobalObject*, JSC::CallFrame* callFrame))
{
    if (callFrame->argument(0).isUInt32() && callFrame->argument(1).isInt32() && callFrame->argument(2).isInt32()) {
        auto& shortcut = auditShortcut(callFrame->argument(0).asUInt32());
        shortcut.least = callFrame->argument(1).asInt32();
        shortcut.most = callFrame->argument(2).asInt32();
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditTag, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (callFrame->argument(1).isUInt32())
        tagForAudit(JSC::getVM(globalObject), callFrame->argument(0), callFrame->argument(1).asUInt32());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsAOTAuditTagOf, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue value = callFrame->argument(0);
    if (!s_auditTag || !value.isObject())
        return JSC::JSValue::encode(JSC::jsUndefined());
    JSC::JSValue tag = JSC::asObject(value)->getDirect(JSC::getVM(globalObject), JSC::PropertyName(*s_auditTag));
    return JSC::JSValue::encode(tag ? tag : JSC::jsUndefined());
}

extern "C" void Bun__AOTAudit__install(Zig::GlobalObject* globalObject, const uint8_t* source, size_t length, const uint8_t* workingDirectory, size_t lengthOfWorkingDirectory)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::SourceCode code = JSC::makeSource(WTF::String::fromUTF8(std::span { source, length }), JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted, "bun:aot-audit"_s);
    NakedPtr<JSC::Exception> exception;
    JSC::JSValue makeCheck = JSC::evaluate(globalObject, code, globalObject->globalThis(), exception);
    if (exception || !makeCheck.isCallable()) [[unlikely]] {
        (void)scope.tryClearException();
        fputs("[aot] note: the audit could not start: nothing is checked\n", stderr);
        return;
    }
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSFunction::create(vm, globalObject, 1, "describe"_s, jsAOTAuditDescribe, JSC::ImplementationVisibility::Private));
    arguments.append(JSC::JSFunction::create(vm, globalObject, 1, "write"_s, jsAOTAuditWrite, JSC::ImplementationVisibility::Private));
    arguments.append(JSC::JSFunction::create(vm, globalObject, 1, "isProxy"_s, jsAOTAuditIsProxy, JSC::ImplementationVisibility::Private));
    arguments.append(JSC::jsString(vm, WTF::String::fromUTF8(std::span { workingDirectory, lengthOfWorkingDirectory })));
    arguments.append(JSC::JSFunction::create(vm, globalObject, 3, "remember"_s, jsAOTAuditRemember, JSC::ImplementationVisibility::Private));
    arguments.append(JSC::JSFunction::create(vm, globalObject, 2, "tag"_s, jsAOTAuditTag, JSC::ImplementationVisibility::Private));
    arguments.append(JSC::JSFunction::create(vm, globalObject, 1, "tagOf"_s, jsAOTAuditTagOf, JSC::ImplementationVisibility::Private));
    JSC::JSValue check = JSC::call(globalObject, makeCheck, arguments, "bun:aot-audit"_s);
    if (scope.exception() || !check.isCallable()) [[unlikely]] {
        (void)scope.tryClearException();
        fputs("[aot] note: the audit could not start: nothing is checked\n", stderr);
        return;
    }
    if (!s_auditHelpers)
        s_auditHelpers = new UncheckedKeyHashMap<JSC::JSGlobalObject*, JSC::Strong<JSC::JSObject>>();
    s_auditHelpers->set(globalObject, JSC::Strong<JSC::JSObject>(vm, asObject(check)));
    globalObject->setAuditFunction(vm, JSC::JSFunction::create(vm, globalObject, 2, "check"_s, jsAOTAuditCheck, JSC::ImplementationVisibility::Private));
}

extern "C" void Bun__AOTAudit__writeRefusedChange(const uint8_t* kind, size_t lengthOfKind, const BunString* message, const BunString* functionName, const BunString* sourceURL, int32_t line, int32_t column);

void Bun__AOTAudit__reportRefusedChange(JSC::JSGlobalObject* globalObject, ASCIILiteral kind, const WTF::String& message, const WTF::String& functionName, const WTF::String& sourceURL, unsigned line, unsigned column)
{
    Bun::OwnedZigStackFrames frames(1);
    frames[0].function_name = Bun::toStringRef(functionName);
    frames[0].source_url = Bun::toStringRef(sourceURL);
    frames[0].position.line_zero_based = static_cast<int32_t>(line) - 1;
    frames[0].position.column_zero_based = static_cast<int32_t>(column) - 1;
    frames[0].position.byte_position = -1;
    frames.remap(defaultGlobalObject(globalObject)->bunVM());
    BunString text = Bun::toString(message);
    Bun__AOTAudit__writeRefusedChange(byteCast<uint8_t>(kind.characters()), kind.length(), &text, &frames[0].function_name, &frames[0].source_url, frames[0].position.line_zero_based + 1, frames[0].position.column_zero_based + 1);
}
