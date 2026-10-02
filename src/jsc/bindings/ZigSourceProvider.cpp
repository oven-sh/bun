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
#include <JavaScriptCore/StaticHeap.h>
#include <JavaScriptCore/AOTFunction.h>
#include <zstd.h>
#include "BunBuiltinNames.h"

#if OS(DARWIN)
#include <execinfo.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#endif
#if OS(LINUX)
#include <link.h>
#endif
#if OS(DARWIN)
#include <mach/mach.h>
#include <mach/mach_vm.h>
#endif
#if OS(DARWIN) || OS(LINUX)
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <limits.h>
#endif
#include <wtf/PageBlock.h>

extern "C" bool Bun__StandaloneModuleGraph__isNoText(const uint8_t* characters);

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
    bool isBuiltin,
    bool isForModuleGraph)
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
            // The static heap refers to the provider by its address, so it is constructed there and never moves.
            JSC::SourceProvider* made = nullptr;
            // (For the program itself. A further instance of it may come first.)
            void* place = resolvedSource.bytecode_cache_persistent && !isForModuleGraph ? JSC::StaticHeap::takePlaceForSourceProvider(globalObject->vm(), resolvedSource.bytecode_cache_entry_offset, sizeof(SourceProvider), made) : nullptr;
            // Another thread's VM has already loaded the module, and all VMs share its provider. (Analyzing a module from its
            // module_info consumes the provider's copy, so in that case a new provider is needed.)
            if (made && !resolvedSource.module_info)
                return Ref { *static_cast<SourceProvider*>(made) };
            Ref sourceImpl = string.isNull() ? Ref { *StringImpl::empty() } : Ref { *string.impl() };
            auto provider = adoptRef(place
                    ? *new (NotNull, place) SourceProvider(globalObject->bunVM(), resolvedSource, WTF::move(sourceImpl), JSC::SourceTaintedOrigin::Untainted, origin, WTF::move(sourceURLString), TextPosition(), sourceType)
                    : *new SourceProvider(globalObject->bunVM(), resolvedSource, WTF::move(sourceImpl), JSC::SourceTaintedOrigin::Untainted, origin, WTF::move(sourceURLString), TextPosition(), sourceType));
            if (place)
                provider->ref();
            provider->m_hash = resolvedSource.source_code_hash;
            provider->m_cachedBytecode = WTF::move(bytecode);
            if (StringView text = provider->source(); !text.isEmpty() && Bun__StandaloneModuleGraph__isNoText(text.is8Bit() ? text.span8().data() : reinterpret_cast<const uint8_t*>(text.span16().data())))
                provider->setHasNoText();
            if (place) {
                provider->becomeShareableBetweenThreads();
                JSC::StaticHeap::didMakeSourceProvider(place);
            }
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
    JSC::StaticHeap::install(*vm); // Only has an effect for the first VM.
    static_cast<WebCore::JSVMClientData*>(vm->clientData)->setDecoderStringTable(*vm, std::span<const uint8_t>(bytes, len));
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
extern "C" JSC::BytecodeLinkEncoder* Bun__BytecodeLinkEncoder__create(JSC::EncoderStringTable* externalStrings, const uint64_t* hotFunctions, size_t hotFunctionCount, const uint64_t* knownFunctions, size_t knownFunctionCount, const uint64_t* evaluatedModules, size_t evaluatedModuleCount, const uint64_t* notEvaluatedModules, size_t notEvaluatedModuleCount, bool compileAheadOfTime, bool soundTypes)
{
    JSC::VM& vm = vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    JSC::BytecodeLinkEncoder::Hints hints;
    hints.hotFunctions.append(std::span { hotFunctions, hotFunctionCount });
    hints.knownFunctions.append(std::span { knownFunctions, knownFunctionCount });
    hints.evaluatedModules.append(std::span { evaluatedModules, evaluatedModuleCount });
    hints.notEvaluatedModules.append(std::span { notEvaluatedModules, notEvaluatedModuleCount });
    hints.compileAheadOfTime = compileAheadOfTime;
    // For this build's VM only. The caller of Bun.build keeps compiling its own code as before.
    auto& options = vm.bytecodeGenerationOptions;
    options = { };
    // The bundler has turned type annotations into $$t(value, mask): the code generated from its output has to know what that is.
    options.useSoundTypes |= soundTypes;
    options.resolveAllScopeSlotsStatically |= compileAheadOfTime;
    options.evaluateObjectLiteralValuesFirst |= compileAheadOfTime;
    options.definePlainInstanceFieldsInConstructor |= compileAheadOfTime;
    options.keepLineStartsOfEverySource |= compileAheadOfTime;
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

// For AOT builds: passes the module linkage to the compiler. Read by Bun__BytecodeLinkEncoder__finish.
extern "C" void Bun__BytecodeLinkEncoder__setPrelinkedModuleGraph(JSC::BytecodeLinkEncoder* encoder, const uint8_t* blob, size_t blobSize, const uint32_t* stringSlots, size_t stringSlotCount, const uint32_t* graphModuleOfEachAdd, size_t addCount)
{
    JSC::JSLockHolder locker(vmOfBytecodeLinkEncoder(*encoder));
    encoder->setPrelinkedModuleGraph({ blob, blobSize }, { stringSlots, stringSlotCount }, Vector<uint32_t>(std::span { graphModuleOfEachAdd, addCount }));
}

// `entryOffsets` has room for one number per successful add* call; `regionEnds` for
// JSC::BytecodeLinkEncoder::numberOfRegions.
static_assert(JSC::BytecodeLinkEncoder::numberOfRegions == 6, "bun_resolver::LINKED_BYTECODE_REGION_COUNT");
static thread_local Vector<uint8_t> s_aotImageOfLastLink;
// Kept until Bun__StaticHeap__build, which runs once all of the strings are known.
static thread_local RefPtr<JSC::CachedBytecode> s_payloadOfLastLink;
static thread_local Vector<uint32_t> s_modulesOfLastLink;
static thread_local size_t s_startOfExpressionInfoOfLastLink;
static thread_local Vector<JSC::ReportableSitesOfFunction> s_reportableSitesOfLastLink;
static thread_local Vector<std::optional<Vector<uint32_t>>> s_variablesExportedByModulesOfLastLink;
static thread_local Vector<uint8_t> s_aotImageForStaticHeap;
extern "C" const uint8_t* Bun__BytecodeLinkEncoder__aotImage(size_t* size)
{
    // (The data after the image is for Bun__StaticHeap__build.)
    *size = JSC::aotImageSize(s_aotImageOfLastLink.span()).value_or(s_aotImageOfLastLink.size());
    return s_aotImageOfLastLink.span().data();
}
extern "C" void Bun__BytecodeLinkEncoder__freeAOTImage()
{
    s_aotImageForStaticHeap = std::exchange(s_aotImageOfLastLink, { });
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
    s_aotImageOfLastLink = WTF::move(result.aotImage);
    if (!s_aotImageOfLastLink.isEmpty()) {
        s_payloadOfLastLink = result.payload;
        s_modulesOfLastLink = WTF::move(result.entryOffsetsOfModules);
        s_startOfExpressionInfoOfLastLink = result.regionEnds[JSC::BytecodeLinkRegions::ExpressionInfo - 1];
        s_reportableSitesOfLastLink = WTF::move(result.reportableSites);
        s_variablesExportedByModulesOfLastLink = WTF::move(result.variablesExportedByModules);
    }
    *outputByteCode = result.payload->span().data();
    *outputByteCodeSize = result.payload->span().size();
    *cachedBytecodePtr = result.payload.leakRef();
    return true;
}

// The offset in the executable's file of the byte that is mapped at `address` (in one of the executable's own
// segments).
static std::optional<off_t> offsetInExecutableFile(const void* address)
{
    uintptr_t target = reinterpret_cast<uintptr_t>(address);
#if OS(DARWIN)
    // Not necessarily the first image: libraries that are inserted come before it.
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
#elif OS(LINUX)
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
        return 1; // The first is the executable.
    }, &context);
    return result;
#else
    UNUSED_PARAM(target);
#endif
    return std::nullopt;
}

// For AOT builds: the codec that an image uses to compress rarely used data. (For JSCInitialize().)
extern "C" void Bun__AOT__setCodecOfImages()
{
#if ENABLE(AOT)
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

// For AOT builds: creates, at build time, the objects that the program needs however it is run (JSC::StaticHeap). Runs on the
// bundler's bytecode thread. The result is placed after the image of the code, which ends on a page boundary.
// `find`, if given, maps a position in a module's text to a position in the executable's original sources. Lines and columns
// count from one. The static heap then stores those positions, for the places that a stack trace can report, and no other
// position information is kept.
extern "C" void Bun__StaticHeap__build(const uint8_t* strings, size_t stringsSize, void* ctx, void (*append)(void* ctx, const uint8_t* bytes, size_t size),
    void* findCtx, bool (*find)(void* ctx, uint32_t entryOffsetOfModule, uint32_t line, uint32_t column, const uint8_t** name, size_t* nameLength, uint32_t* lineInSource, uint32_t* columnInSource))
{
    Vector<JSC::ReportableSitesOfFunction> reportableSites = std::exchange(s_reportableSitesOfLastLink, { });
    Vector<uint8_t> imageOfCode = std::exchange(s_aotImageForStaticHeap, { });
    JSC::VM& vm = vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    RefPtr payload = std::exchange(s_payloadOfLastLink, nullptr);
    Vector<uint32_t> modules = std::exchange(s_modulesOfLastLink, { });
    Vector<std::optional<Vector<uint32_t>>> variablesExportedByModules = std::exchange(s_variablesExportedByModulesOfLastLink, { });
    std::optional<JSC::StaticHeap::PositionsToKeep> positions;
    if (find && JSC::Options::omitBytecodeFromStaticHeap()) {
        positions.emplace(JSC::StaticHeap::PositionsToKeep { reportableSites, [&](uint32_t entryOffsetOfModule, JSC::LineColumn inModule, CString& nameOfSource, JSC::LineColumn& inSource) {
            const uint8_t* name = nullptr;
            size_t nameLength = 0;
            uint32_t line = 0;
            uint32_t column = 0;
            if (!find(findCtx, entryOffsetOfModule, inModule.line, inModule.column, &name, &nameLength, &line, &column))
                return false;
            nameOfSource = CString(std::span { reinterpret_cast<const char*>(name), nameLength });
            inSource = { line, column };
            return true;
        } });
    }
    Vector<uint8_t> image = JSC::StaticHeap::build(vm, { strings, stringsSize }, payload ? payload->span() : std::span<const uint8_t> { }, modules.span(), imageOfCode.span(), JSC::Options::omitBytecodeFromStaticHeap() ? s_startOfExpressionInfoOfLastLink : 0, positions ? &*positions : nullptr, reportableSites.span(), variablesExportedByModules.span());
    append(ctx, image.span().data(), image.size());
}

static bool s_tablesOfImageAreAtTheirAddress;

static int openExecutable()
{
#if OS(DARWIN)
    char path[PATH_MAX * 2];
    uint32_t pathSize = sizeof(path);
    if (_NSGetExecutablePath(path, &pathSize))
        return -1;
#else
    const char* path = "/proc/self/exe";
#endif
    return open(path, O_RDONLY | O_CLOEXEC);
}

// `bytes` is the image of the code and the data that follows it. Reports where the static heap's copies of the string
// table and of the bytecode are in it, as { offset, size, offset, size }. Returns false if there is no static heap.
extern "C" bool Bun__StaticHeap__copiesInImage(const uint8_t* bytes, size_t length, size_t* result)
{
    auto sizeOfCodeImage = JSC::aotImageSize({ bytes, length });
    if (!sizeOfCodeImage || *sizeOfCodeImage >= length)
        return false;
    auto copies = JSC::StaticHeap::copiesIn({ bytes + *sizeOfCodeImage, length - *sizeOfCodeImage });
    if (!copies)
        return false;
    result[0] = *sizeOfCodeImage + copies->offsetOfStrings;
    result[1] = copies->sizeOfStrings;
    result[2] = *sizeOfCodeImage + copies->offsetOfPayload;
    result[3] = copies->sizeOfPayload;
    result[4] = copies->payloadIsOmitted;
    result[5] = copies->addressOfPayload;
    result[6] = copies->hasPositionsOfCallSites;
    return true;
}

// `bytes` is the image of the code and the data that follows it. Must be called on the main thread, before it has a VM.
// `fileDescriptor`, `offsetInFile`: the file that `bytes` is mapped from, and the offset of `bytes` in it. A negative
// descriptor means the executable's own file.
extern "C" void Bun__StaticHeap__map(const uint8_t* bytes, size_t length, int fileDescriptor, int64_t offsetInFile)
{
#if OS(DARWIN) || OS(LINUX)
    bool verbose = !!getenv("BUN_AOT_VERBOSE");
    auto failed = [&](const char* why) {
        if (verbose)
            fprintf(stderr, "[aot] not using the static heap: %s\n", why);
    };
    if (!JSC::Options::useAOT())
        return failed("useAOT is off");
    auto sizeOfCodeImage = JSC::aotImageSize({ bytes, length });
    if (!sizeOfCodeImage || *sizeOfCodeImage >= length)
        return failed("there is none");
    std::span<const uint8_t> image { bytes + *sizeOfCodeImage, length - *sizeOfCodeImage };
    bool isInExecutable = fileDescriptor < 0;
    auto fileOffset = isInExecutable ? offsetInExecutableFile(image.data()) : std::optional<off_t>(offsetInFile + static_cast<off_t>(*sizeOfCodeImage));
    if (!fileOffset || *fileOffset % static_cast<off_t>(WTF::pageSize()))
        return failed("it is not on a page boundary of its file");
    int fd = isInExecutable ? openExecutable() : fileDescriptor;
    if (fd < 0)
        return failed("cannot open the executable");
    // The static heap refers to the image's metadata about the code by address. (Not to the code: Bun__AOT__registerImage.)
    using Region = bmalloc::StaticRegion;
    auto codeRange = JSC::aotImageCodeRange({ bytes, length });
    off_t offsetOfCodeImage = *fileOffset - static_cast<off_t>(*sizeOfCodeImage);
    bool ok = codeRange && !(codeRange->first % WTF::pageSize())
        && Region::map(Region::Arena::Image, Region::Access::Read, fd, offsetOfCodeImage, codeRange->first);
    s_tablesOfImageAreAtTheirAddress = ok;
    ok = ok && JSC::StaticHeap::map(image, fd, *fileOffset);
    if (isInExecutable)
        close(fd);
    if (!ok)
        return failed("it is for another build of the engine, or its place is taken, or the thread has atoms");
    if (verbose)
        fprintf(stderr, "[aot] static heap: %zu bytes\n", image.size());
#else
    UNUSED_PARAM(bytes);
    UNUSED_PARAM(length);
#endif
}

// For the crash handler. The loader knows nothing about the machine code that an AOT executable carries, so its frames
// would be reported as unknown. Returns the offset of an address in that code, which the map of the image resolves to a
// function, or -1.
extern "C" int64_t Bun__AOT__offsetInCode(const void* address)
{
#if ENABLE(AOT)
    auto offset = JSC::AOT::offsetInCodeOfImage(address);
    return offset ? static_cast<int64_t>(*offset) : -1;
#else
    UNUSED_PARAM(address);
    return -1;
#endif
}

// Registers the machine code that an AOT executable carries. The executable's section is mapped as data, so the code is
// mapped a second time from the file, as executable pages. Those pages are shared, clean, and only paged in when they
// run.
// `fileDescriptor`, `offsetInFile`: see Bun__StaticHeap__map.
extern "C" void Bun__AOT__registerImage(const uint8_t* bytes, size_t length, int fileDescriptor, int64_t offsetInFile)
{
    bool verbose = !!getenv("BUN_AOT_VERBOSE");
    auto failed = [&](const char* why) {
        if (verbose)
            fprintf(stderr, "[aot] not using the image: %s\n", why);
    };
    if (!JSC::Options::useAOT())
        return failed("useAOT is off");
#if OS(DARWIN) || OS(LINUX)
    std::span<const uint8_t> image { bytes, length };
    auto range = JSC::aotImageCodeRange(image);
    if (!range)
        return failed("not an image");
    auto [codeOffset, codeSize] = *range;
    void* code = nullptr;
    // Bun__StaticHeap__map has mapped what comes before the code.
    if (s_tablesOfImageAreAtTheirAddress)
        image = { reinterpret_cast<const uint8_t*>(bmalloc::StaticRegion::startOf(bmalloc::StaticRegion::Arena::Image)), length };
    // The code does not depend on where it is, so that is up to the system.
    if (codeSize) {
        bool isInExecutable = fileDescriptor < 0;
        auto fileOffset = isInExecutable ? offsetInExecutableFile(bytes + codeOffset) : std::optional<off_t>(offsetInFile + static_cast<off_t>(codeOffset));
        if (!fileOffset)
            return failed("it is not in a segment of the executable");
        if (*fileOffset % static_cast<off_t>(WTF::pageSize()))
            return failed("its code is not on a page boundary of the file");
        int fd = isInExecutable ? openExecutable() : fileDescriptor;
        if (fd < 0)
            return failed("cannot open the executable");
        code = mmap(nullptr, codeSize, PROT_READ | PROT_EXEC, MAP_PRIVATE, fd, *fileOffset);
        // Darwin refuses an executable mapping of a file that is not signed (EPERM), but allows a mapping of one to be made executable.
        if (code == MAP_FAILED && errno == EPERM) {
            code = mmap(nullptr, codeSize, PROT_READ, MAP_PRIVATE, fd, *fileOffset);
            if (code != MAP_FAILED && mprotect(code, codeSize, PROT_READ | PROT_EXEC)) {
                munmap(code, codeSize);
                code = MAP_FAILED;
            }
        }
        if (isInExecutable)
            close(fd);
        if (code == MAP_FAILED)
            return failed(strerror(errno));
#if OS(DARWIN)
        // It cannot be made writable.
        mach_vm_protect(mach_task_self(), reinterpret_cast<mach_vm_address_t>(code), codeSize, true, VM_PROT_READ | VM_PROT_EXECUTE);
#endif
    }
    if (!JSC::registerAOTImage(image, code)) {
        if (code)
            munmap(code, codeSize);
        return failed("it was compiled for another build of the engine");
    }
    if (verbose)
        fprintf(stderr, "[aot] image: %zu bytes, %zu of code at %p, %u regular expressions\n", length, codeSize, code, JSC::aotImageNumberOfRegExps(image).value_or(0));
    if (verbose && !strcmp(getenv("BUN_AOT_VERBOSE"), "2") && codeSize > 4096) {
        // Finds the copies of the stubs by scanning all of the code. The code starts with one.
        auto* start = bytes + codeOffset;
        for (auto* at = start; (at = static_cast<const uint8_t*>(memmem(at, start + codeSize - at, start, 512))); at += 512)
            fprintf(stderr, "[aot] stubs at image+0x%zx\n", static_cast<size_t>(at - start));
    }
#else
    UNUSED_PARAM(bytes);
    UNUSED_PARAM(length);
    failed("not supported on this platform");
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
