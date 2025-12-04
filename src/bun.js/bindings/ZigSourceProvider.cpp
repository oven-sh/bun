#include "root.h"

#include "helpers.h"

#include "ZigSourceProvider.h"

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
#include <JavaScriptCore/ModuleAnalyzer.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/Parser.h>
#include <JavaScriptCore/Nodes.h>

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

extern "C" int ByteRangeMapping__getSourceID(void* mappings, BunString sourceURL);
extern "C" void* ByteRangeMapping__find(BunString sourceURL);
void* sourceMappingForSourceURL(const WTF::String& sourceURL)
{
    return ByteRangeMapping__find(Bun::toString(sourceURL));
}

extern "C" void ByteRangeMapping__generate(BunString sourceURL, BunString code, int sourceID);

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL)
{
    void* mappings = ByteRangeMapping__find(Bun::toString(sourceURL));
    if (!mappings) {
        return 0;
    }

    return ByteRangeMapping__getSourceID(mappings, Bun::toString(sourceURL));
}

extern "C" bool BunTest__shouldGenerateCodeCoverage(BunString sourceURL);
extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);

Ref<SourceProvider> SourceProvider::create(
    Zig::GlobalObject* globalObject,
    ResolvedSource& resolvedSource,
    JSC::SourceProviderSourceType sourceType,
    bool isBuiltin)
{
    auto string = resolvedSource.source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURLString = resolvedSource.source_url.toWTFString(BunString::ZeroCopy);

    bool isCodeCoverageEnabled = !!globalObject->vm().controlFlowProfiler();

    bool shouldGenerateCodeCoverage = isCodeCoverageEnabled && !isBuiltin && BunTest__shouldGenerateCodeCoverage(resolvedSource.source_url);

    if (resolvedSource.needsDeref && !isBuiltin) {
        resolvedSource.needsDeref = false;
        resolvedSource.source_code.deref();
        // Do not deref either source_url or specifier
        // Specifier's lifetime is the JSValue, mostly
        // source_url is owned by the string above
        // https://github.com/oven-sh/bun/issues/9521
    }

    const auto getProvider = [&]() -> Ref<SourceProvider> {
        if (resolvedSource.bytecode_cache != nullptr) {
            const auto destructorPtr = [](const void* ptr) {
                mi_free(const_cast<void*>(ptr));
            };
            const auto destructorNoOp = [](const void* ptr) {
                // no-op, for bun build --compile.
            };
            const auto destructor = resolvedSource.needsDeref ? destructorPtr : destructorNoOp;

            Ref<JSC::CachedBytecode> bytecode = JSC::CachedBytecode::create(std::span<uint8_t>(resolvedSource.bytecode_cache, resolvedSource.bytecode_cache_size), destructor, {});
            auto provider = adoptRef(*new SourceProvider(
                globalObject->isThreadLocalDefaultGlobalObject ? globalObject : nullptr,
                resolvedSource,
                string.isNull() ? *StringImpl::empty() : *string.impl(),
                JSC::SourceTaintedOrigin::Untainted,
                toSourceOrigin(sourceURLString, isBuiltin),
                sourceURLString.impl(), TextPosition(),
                sourceType));
            provider->m_cachedBytecode = WTF::move(bytecode);
            return provider;
        }

        return adoptRef(*new SourceProvider(
            globalObject->isThreadLocalDefaultGlobalObject ? globalObject : nullptr,
            resolvedSource,
            string.isNull() ? *StringImpl::empty() : *string.impl(),
            JSC::SourceTaintedOrigin::Untainted,
            toSourceOrigin(sourceURLString, isBuiltin),
            sourceURLString.impl(), TextPosition(),
            sourceType));
    };

    auto provider = getProvider();

    if (shouldGenerateCodeCoverage) {
        ByteRangeMapping__generate(Bun::toString(provider->sourceURL()), Bun::toString(provider->source().toStringWithoutCopying()), provider->asID());
    }

    if (resolvedSource.already_bundled) {
        Bun__addSourceProviderSourceMap(globalObject->bunVM(), provider.ptr(), &resolvedSource.source_url);
    }

    return provider;
}

StringView SourceProvider::source() const
{
    return StringView(m_source.get());
}

SourceProvider::~SourceProvider()
{
    if (m_resolvedSource.already_bundled) {
        BunString str = Bun::toString(sourceURL());
        Bun__removeSourceProviderSourceMap(m_globalObject->bunVM(), this, &str);
    }
}

extern "C" void CachedBytecode__deref(JSC::CachedBytecode* cachedBytecode)
{
    cachedBytecode->deref();
}

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

// Module metadata serialization format:
// [4 bytes: MAGIC] "BMES" (Bun Module ESM Serialization)
// [4 bytes: VERSION] Current version
// [4 bytes: MODULE_REQUEST_COUNT]
// For each module request:
//   [4 bytes: SPECIFIER_LENGTH]
//   [SPECIFIER_LENGTH bytes: SPECIFIER_UTF8]
//   [4 bytes: HAS_ATTRIBUTES] (0 or 1)
//   If HAS_ATTRIBUTES:
//     [4 bytes: ATTRIBUTE_COUNT]
//     For each attribute:
//       [4 bytes: KEY_LENGTH]
//       [KEY_LENGTH bytes: KEY_UTF8]
//       [4 bytes: VALUE_LENGTH]
//       [VALUE_LENGTH bytes: VALUE_UTF8]
// [4 bytes: IMPORT_ENTRY_COUNT]
// For each import entry:
//   [4 bytes: TYPE] (0=Single, 1=SingleTypeScript, 2=Namespace)
//   [4 bytes: MODULE_REQUEST_LENGTH]
//   [MODULE_REQUEST_LENGTH bytes: MODULE_REQUEST_UTF8]
//   [4 bytes: IMPORT_NAME_LENGTH]
//   [IMPORT_NAME_LENGTH bytes: IMPORT_NAME_UTF8]
//   [4 bytes: LOCAL_NAME_LENGTH]
//   [LOCAL_NAME_LENGTH bytes: LOCAL_NAME_UTF8]
// [4 bytes: EXPORT_ENTRY_COUNT]
// For each export entry:
//   [4 bytes: TYPE] (0=Local, 1=Indirect, 2=Namespace)
//   [4 bytes: EXPORT_NAME_LENGTH]
//   [EXPORT_NAME_LENGTH bytes: EXPORT_NAME_UTF8]
//   [4 bytes: MODULE_NAME_LENGTH]
//   [MODULE_NAME_LENGTH bytes: MODULE_NAME_UTF8]
//   [4 bytes: IMPORT_NAME_LENGTH]
//   [IMPORT_NAME_LENGTH bytes: IMPORT_NAME_UTF8]
//   [4 bytes: LOCAL_NAME_LENGTH]
//   [LOCAL_NAME_LENGTH bytes: LOCAL_NAME_UTF8]
// [4 bytes: STAR_EXPORT_COUNT]
// For each star export:
//   [4 bytes: MODULE_NAME_LENGTH]
//   [MODULE_NAME_LENGTH bytes: MODULE_NAME_UTF8]
// [4 bytes: BYTECODE_SIZE]
// [BYTECODE_SIZE bytes: BYTECODE_DATA]

static constexpr uint32_t MODULE_CACHE_MAGIC = 0x424D4553; // "BMES"
static constexpr uint32_t MODULE_CACHE_VERSION = 1;

static void writeUint32(Vector<uint8_t>& buffer, uint32_t value)
{
    buffer.append(static_cast<uint8_t>(value & 0xFF));
    buffer.append(static_cast<uint8_t>((value >> 8) & 0xFF));
    buffer.append(static_cast<uint8_t>((value >> 16) & 0xFF));
    buffer.append(static_cast<uint8_t>((value >> 24) & 0xFF));
}

static void writeString(Vector<uint8_t>& buffer, const WTF::String& str)
{
    if (str.isNull() || str.isEmpty()) {
        writeUint32(buffer, 0);
        return;
    }
    CString utf8 = str.utf8();
    writeUint32(buffer, utf8.length());
    buffer.appendVector(Vector<uint8_t>(std::span(reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length())));
}

static uint32_t readUint32(const uint8_t*& ptr)
{
    uint32_t value = static_cast<uint32_t>(ptr[0]) |
                     (static_cast<uint32_t>(ptr[1]) << 8) |
                     (static_cast<uint32_t>(ptr[2]) << 16) |
                     (static_cast<uint32_t>(ptr[3]) << 24);
    ptr += 4;
    return value;
}

static WTF::String readString(JSC::VM& vm, const uint8_t*& ptr)
{
    uint32_t length = readUint32(ptr);
    if (length == 0)
        return WTF::String();
    WTF::String result = WTF::String::fromUTF8(std::span(ptr, length));
    ptr += length;
    return result;
}

// New function: Generate cached bytecode WITH module metadata
extern "C" bool generateCachedModuleByteCodeWithMetadata(
    BunString* sourceProviderURL,
    const Latin1Character* inputSourceCode,
    size_t inputSourceCodeSize,
    const uint8_t** outputByteCode,
    size_t* outputByteCodeSize,
    JSC::CachedBytecode** cachedBytecodePtr)
{
    using namespace JSC;

    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    SourceCode sourceCode = makeSource(WTF::String(sourceCodeSpan), toSourceOrigin(sourceProviderURL->toWTFString(), false), SourceTaintedOrigin::Untainted);

    VM& vm = getVMForBytecodeCache();
    JSLockHolder locker(vm);

    // Parse the module to extract metadata
    ParserError parserError;
    std::unique_ptr<ModuleProgramNode> moduleProgramNode = parseRootNode<ModuleProgramNode>(
        vm, sourceCode,
        ImplementationVisibility::Public,
        JSParserBuiltinMode::NotBuiltin,
        StrictModeLexicallyScopedFeature,
        JSParserScriptMode::Module,
        SourceParseMode::ModuleAnalyzeMode,
        parserError
    );

    if (parserError.isValid() || !moduleProgramNode)
        return false;

    // Create a temporary global object for analysis
    Structure* structure = JSGlobalObject::createStructure(vm, jsNull());
    JSGlobalObject* globalObject = JSGlobalObject::create(vm, structure);

    // Analyze the module
    ModuleAnalyzer analyzer(globalObject, Identifier::fromString(vm, sourceProviderURL->toWTFString()),
                           sourceCode, moduleProgramNode->varDeclarations(),
                           moduleProgramNode->lexicalVariables(), AllFeatures);

    auto result = analyzer.analyze(*moduleProgramNode);
    if (!result)
        return false;

    JSModuleRecord* moduleRecord = *result;

    // Serialize module metadata
    Vector<uint8_t> metadataBuffer;
    metadataBuffer.reserveInitialCapacity(4096);

    // Write magic and version
    writeUint32(metadataBuffer, MODULE_CACHE_MAGIC);
    writeUint32(metadataBuffer, MODULE_CACHE_VERSION);

    // Serialize requested modules
    const auto& requestedModules = moduleRecord->requestedModules();
    writeUint32(metadataBuffer, requestedModules.size());

    for (const auto& request : requestedModules) {
        writeString(metadataBuffer, *request.m_specifier);

        // Serialize attributes
        if (request.m_attributes) {
            writeUint32(metadataBuffer, 1); // has attributes
            // For now, we'll skip detailed attribute serialization
            // This can be extended later
            writeUint32(metadataBuffer, 0); // attribute count
        } else {
            writeUint32(metadataBuffer, 0); // no attributes
        }
    }

    // Serialize import entries
    const auto& importEntries = moduleRecord->importEntries();
    writeUint32(metadataBuffer, importEntries.size());

    for (const auto& entry : importEntries) {
        writeUint32(metadataBuffer, static_cast<uint32_t>(entry.value.type));
        writeString(metadataBuffer, entry.value.moduleRequest.string());
        writeString(metadataBuffer, entry.value.importName.string());
        writeString(metadataBuffer, entry.value.localName.string());
    }

    // Serialize export entries
    const auto& exportEntries = moduleRecord->exportEntries();
    writeUint32(metadataBuffer, exportEntries.size());

    for (const auto& entry : exportEntries) {
        writeUint32(metadataBuffer, static_cast<uint32_t>(entry.value.type));
        writeString(metadataBuffer, entry.value.exportName.string());
        writeString(metadataBuffer, entry.value.moduleName.string());
        writeString(metadataBuffer, entry.value.importName.string());
        writeString(metadataBuffer, entry.value.localName.string());
    }

    // Serialize star exports
    const auto& starExports = moduleRecord->starExportEntries();
    writeUint32(metadataBuffer, starExports.size());

    for (const auto& moduleName : starExports) {
        writeString(metadataBuffer, *moduleName);
    }

    // Generate bytecode
    UnlinkedModuleProgramCodeBlock* unlinkedCodeBlock = recursivelyGenerateUnlinkedCodeBlockForModuleProgram(
        vm, sourceCode, StrictModeLexicallyScopedFeature, JSParserScriptMode::Module,
        {}, parserError, EvalContextType::None
    );

    if (parserError.isValid() || !unlinkedCodeBlock)
        return false;

    auto key = sourceCodeKeyForSerializedModule(vm, sourceCode);
    RefPtr<CachedBytecode> bytecodeCache = encodeCodeBlock(vm, key, unlinkedCodeBlock);

    if (!bytecodeCache)
        return false;

    // Write bytecode size and data
    writeUint32(metadataBuffer, bytecodeCache->span().size());
    metadataBuffer.appendVector(Vector<uint8_t>(bytecodeCache->span()));

    // Create final cached bytecode
    WTF::Function<void(const void*)> finalDestructor = [](const void* ptr) {
        mi_free(const_cast<void*>(ptr));
    };

    // Use mi_malloc instead of new[] for consistency
    uint8_t* finalBuffer = static_cast<uint8_t*>(mi_malloc(metadataBuffer.size()));
    if (!finalBuffer)
        return false;

    // Copy using range-based iteration to avoid accessing private data()
    for (size_t i = 0; i < metadataBuffer.size(); ++i) {
        finalBuffer[i] = metadataBuffer[i];
    }

    RefPtr<CachedBytecode> finalCache = CachedBytecode::create(
        std::span<uint8_t>(finalBuffer, metadataBuffer.size()),
        WTFMove(finalDestructor),
        {}
    );

    finalCache->ref();
    *cachedBytecodePtr = finalCache.get();
    *outputByteCode = finalBuffer;
    *outputByteCodeSize = metadataBuffer.size();

    return true;
}

extern "C" bool generateCachedModuleByteCodeFromSourceCode(BunString* sourceProviderURL, const Latin1Character* inputSourceCode, size_t inputSourceCodeSize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    JSC::SourceCode sourceCode = JSC::makeSource(WTF::String(sourceCodeSpan), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);

    JSC::VM& vm = getVMForBytecodeCache();

    JSC::JSLockHolder locker(vm);
    LexicallyScopedFeatures lexicallyScopedFeatures = StrictModeLexicallyScopedFeature;
    JSParserScriptMode scriptMode = JSParserScriptMode::Module;
    EvalContextType evalContextType = EvalContextType::None;

    ParserError parserError;
    UnlinkedModuleProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForModuleProgram(vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType);
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

extern "C" bool generateCachedCommonJSProgramByteCodeFromSourceCode(BunString* sourceProviderURL, const Latin1Character* inputSourceCode, size_t inputSourceCodeSize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);

    JSC::SourceCode sourceCode = JSC::makeSource(WTF::String(sourceCodeSpan), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);
    JSC::VM& vm = getVMForBytecodeCache();

    JSC::JSLockHolder locker(vm);
    LexicallyScopedFeatures lexicallyScopedFeatures = NoLexicallyScopedFeatures;
    JSParserScriptMode scriptMode = JSParserScriptMode::Classic;
    EvalContextType evalContextType = EvalContextType::None;

    ParserError parserError;
    UnlinkedProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForProgram(vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType);
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

unsigned SourceProvider::hash() const
{
    if (m_hash) {
        return m_hash;
    }

    return m_source->hash();
}

void SourceProvider::freeSourceCode()
{
}

void SourceProvider::updateCache(const UnlinkedFunctionExecutable* executable, const SourceCode&,
    CodeSpecializationKind kind,
    const UnlinkedFunctionCodeBlock* codeBlock)
{
    // if (!m_resolvedSource.bytecodecache_fd || !m_cachedBytecode)
    return;

    JSC::BytecodeCacheError error;
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeFunctionCodeBlock(executable->vm(), codeBlock, error);
    if (cachedBytecode && !error.isValid())
        m_cachedBytecode->addFunctionUpdate(executable, kind, *cachedBytecode);
}

void SourceProvider::cacheBytecode(const BytecodeCacheGenerator& generator)
{
    // if (!m_resolvedSource.bytecodecache_fd)
    return;

    if (!m_cachedBytecode)
        m_cachedBytecode = JSC::CachedBytecode::create();
    auto update = generator();
    if (update)
        m_cachedBytecode->addGlobalUpdate(*update);
}

void SourceProvider::commitCachedBytecode()
{
    // if (!m_resolvedSource.bytecodecache_fd || !m_cachedBytecode || !m_cachedBytecode->hasUpdates())
    return;

    // auto clearBytecode = WTF::makeScopeExit([&] { m_cachedBytecode = nullptr; });
    // const auto fd = m_resolvedSource.bytecodecache_fd;

    // auto fileSize = FileSystem::fileSize(fd);
    // if (!fileSize)
    //     return;

    // size_t cacheFileSize;
    // if (!WTF::convertSafely(*fileSize, cacheFileSize) || cacheFileSize != m_cachedBytecode->size()) {
    //     // The bytecode cache has already been updated
    //     return;
    // }

    // if (!FileSystem::truncateFile(fd, m_cachedBytecode->sizeForUpdate()))
    //     return;

    // m_cachedBytecode->commitUpdates([&](off_t offset, const void* data, size_t size) {
    //     long long result = FileSystem::seekFile(fd, offset, FileSystem::FileSeekOrigin::Beginning);
    //     ASSERT_UNUSED(result, result != -1);
    //     size_t bytesWritten = static_cast<size_t>(FileSystem::writeToFile(fd, data, size));
    //     ASSERT_UNUSED(bytesWritten, bytesWritten == size);
    // });
}

bool SourceProvider::isBytecodeCacheEnabled() const
{
    // return m_resolvedSource.bytecodecache_fd > 0;
    return false;
}

void SourceProvider::readOrGenerateByteCodeCache(JSC::VM& vm, const JSC::SourceCode& sourceCode)
{
    // auto status = this->readCache(vm, sourceCode);
    // switch (status) {
    // case -1: {
    //     m_resolvedSource.bytecodecache_fd = 0;
    //     break;
    // }
    // case 0: {
    //     JSC::BytecodeCacheError err;
    //     m_cachedBytecode = JSC::generateModuleBytecode(vm, sourceCode, m_resolvedSource.bytecodecache_fd, err);

    //     if (err.isValid()) {
    //         m_resolvedSource.bytecodecache_fd = 0;
    //         m_cachedBytecode = JSC::CachedBytecode::create();
    //     }
    // }
    // // TODO: read the bytecode into a JSC::SourceCode object here
    // case 1: {
    // }
    // }
}
int SourceProvider::readCache(JSC::VM& vm, const JSC::SourceCode& sourceCode)
{
    return -1;
    // if (m_resolvedSource.bytecodecache_fd == 0)
    //     return -1;
    // if (!FileSystem::isHandleValid(m_resolvedSource.bytecodecache_fd))
    //     return -1;
    // const auto fd = m_resolvedSource.bytecodecache_fd;

    // bool success;
    // FileSystem::MappedFileData mappedFile(fd, FileSystem::MappedFileMode::Shared, success);
    // if (!success)
    //     return -1;

    // const uint8_t* fileData = reinterpret_cast<const uint8_t*>(mappedFile.data());
    // unsigned fileTotalSize = mappedFile.size();
    // if (fileTotalSize == 0)
    //     return 0;

    // Ref<JSC::CachedBytecode> cachedBytecode = JSC::CachedBytecode::create(WTF::move(mappedFile));
    // // auto key = JSC::sourceCodeKeyForSerializedModule(vm, sourceCode);
    // // if (isCachedBytecodeStillValid(vm, cachedBytecode.copyRef(), key,
    // //                                JSC::SourceCodeType::ModuleType)) {
    // m_cachedBytecode = WTF::move(cachedBytecode);
    // return 1;
    // } else {
    //   FileSystem::truncateFile(fd, 0);
    //   return 0;
    // }
}

extern "C" BunString ZigSourceProvider__getSourceSlice(SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

}; // namespace Zig
