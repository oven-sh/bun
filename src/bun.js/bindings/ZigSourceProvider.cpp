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
#include <JavaScriptCore/VariableEnvironment.h>

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

// BMES format constants and helper functions
static constexpr uint32_t MODULE_CACHE_MAGIC = 0x424D4553; // "BMES"
static constexpr uint32_t MODULE_CACHE_VERSION = 3; // Version 3: includes VariableEnvironment and CodeFeatures

// BMES v3 Header layout (16 bytes total):
// [4 bytes: MAGIC] "BMES"
// [4 bytes: VERSION] 3
// [4 bytes: BYTECODE_OFFSET] offset from start of buffer to bytecode data
// [4 bytes: BYTECODE_SIZE] size of bytecode data
// ... metadata (includes VariableEnvironment and CodeFeatures) ...
// [BYTECODE_SIZE bytes: BYTECODE_DATA]

static constexpr size_t BMES_HEADER_SIZE = 16; // magic + version + offset + size

// Quick bytecode extraction from BMES format - O(1) for v2/v3
// Returns true if extraction was successful, and sets bytecodeStart/bytecodeSize
static bool extractBytecodeFromBMES(
    const uint8_t* cacheData,
    size_t cacheSize,
    const uint8_t*& bytecodeStart,
    size_t& bytecodeSize)
{
    if (cacheSize < 8) return false;

    // Read and validate magic
    const uint8_t* ptr = cacheData;
    uint32_t magic = static_cast<uint32_t>(ptr[0]) | (static_cast<uint32_t>(ptr[1]) << 8) | (static_cast<uint32_t>(ptr[2]) << 16) | (static_cast<uint32_t>(ptr[3]) << 24);
    if (magic != MODULE_CACHE_MAGIC) return false;
    ptr += 4;

    // Read version
    uint32_t version = static_cast<uint32_t>(ptr[0]) | (static_cast<uint32_t>(ptr[1]) << 8) | (static_cast<uint32_t>(ptr[2]) << 16) | (static_cast<uint32_t>(ptr[3]) << 24);
    ptr += 4;

    // Version 2 and 3: O(1) bytecode extraction using header offset
    // Version 2 and 3 share the same header layout
    if (version == 2 || version == 3) {
        if (cacheSize < BMES_HEADER_SIZE) return false;

        // Read bytecode offset
        uint32_t bytecodeOffset = static_cast<uint32_t>(ptr[0]) | (static_cast<uint32_t>(ptr[1]) << 8) | (static_cast<uint32_t>(ptr[2]) << 16) | (static_cast<uint32_t>(ptr[3]) << 24);
        ptr += 4;

        // Read bytecode size
        bytecodeSize = static_cast<uint32_t>(ptr[0]) | (static_cast<uint32_t>(ptr[1]) << 8) | (static_cast<uint32_t>(ptr[2]) << 16) | (static_cast<uint32_t>(ptr[3]) << 24);

        // Validate offset and size
        if (bytecodeOffset + bytecodeSize > cacheSize) return false;

        bytecodeStart = cacheData + bytecodeOffset;
        return true;
    }

    // Unknown version
    return false;
}

// Helper functions for reading serialized data
static uint32_t readUint32(const uint8_t*& ptr)
{
    uint32_t value = static_cast<uint32_t>(ptr[0]) | (static_cast<uint32_t>(ptr[1]) << 8) | (static_cast<uint32_t>(ptr[2]) << 16) | (static_cast<uint32_t>(ptr[3]) << 24);
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

// Structure to hold deserialized module metadata
struct DeserializedModuleMetadata {
    struct ModuleRequest {
        WTF::String specifier;
        // Attributes omitted for now
    };

    struct ImportEntry {
        uint32_t type; // 0=Single, 1=SingleTypeScript, 2=Namespace
        WTF::String moduleRequest;
        WTF::String importName;
        WTF::String localName;
    };

    struct ExportEntry {
        uint32_t type; // 0=Local, 1=Indirect, 2=Namespace
        WTF::String exportName;
        WTF::String moduleName;
        WTF::String importName;
        WTF::String localName;
    };

    struct VariableEntry {
        WTF::String name;
        uint32_t bits;
    };

    Vector<ModuleRequest> requestedModules;
    Vector<ImportEntry> importEntries;
    Vector<ExportEntry> exportEntries;
    Vector<WTF::String> starExports;
    Vector<VariableEntry> declaredVariables;
    Vector<VariableEntry> lexicalVariables;
    uint32_t codeFeatures = 0;
    const uint8_t* bytecodeStart = nullptr;
    size_t bytecodeSize = 0;
};

// Validate and deserialize cached module metadata
// Returns std::nullopt if cache is invalid
static std::optional<DeserializedModuleMetadata> deserializeCachedModuleMetadata(
    JSC::VM& vm,
    const uint8_t* cacheData,
    size_t cacheSize)
{
    if (cacheSize < 16) // At least magic + version + bytecode_offset + bytecode_size
        return std::nullopt;

    const uint8_t* ptr = cacheData;
    const uint8_t* end = cacheData + cacheSize;

    // Check magic number
    uint32_t magic = readUint32(ptr);
    if (magic != MODULE_CACHE_MAGIC)
        return std::nullopt;

    // Check version
    uint32_t version = readUint32(ptr);
    if (version != MODULE_CACHE_VERSION)
        return std::nullopt;

    // Read bytecode offset and size from header (v3 format)
    uint32_t bytecodeOffset = readUint32(ptr);
    uint32_t bytecodeSize = readUint32(ptr);

    DeserializedModuleMetadata metadata;
    metadata.bytecodeSize = bytecodeSize;
    metadata.bytecodeStart = cacheData + bytecodeOffset;

    // Read requested modules
    if (ptr + 4 > end) return std::nullopt;
    uint32_t moduleCount = readUint32(ptr);
    metadata.requestedModules.reserveInitialCapacity(moduleCount);

    for (uint32_t i = 0; i < moduleCount; ++i) {
        if (ptr >= end) return std::nullopt;
        WTF::String specifier = readString(vm, ptr);

        // Read has_attributes flag
        if (ptr + 4 > end) return std::nullopt;
        uint32_t hasAttributes = readUint32(ptr);

        if (hasAttributes) {
            // Skip attributes for now
            if (ptr + 4 > end) return std::nullopt;
            uint32_t attrCount = readUint32(ptr);
            for (uint32_t j = 0; j < attrCount; ++j) {
                if (ptr >= end) return std::nullopt;
                readString(vm, ptr); // key
                readString(vm, ptr); // value
            }
        }

        metadata.requestedModules.append({ WTF::move(specifier) });
    }

    // Read import entries
    if (ptr + 4 > end) return std::nullopt;
    uint32_t importCount = readUint32(ptr);
    metadata.importEntries.reserveInitialCapacity(importCount);

    for (uint32_t i = 0; i < importCount; ++i) {
        if (ptr + 4 > end) return std::nullopt;
        uint32_t type = readUint32(ptr);

        if (ptr >= end) return std::nullopt;
        WTF::String moduleRequest = readString(vm, ptr);
        WTF::String importName = readString(vm, ptr);
        WTF::String localName = readString(vm, ptr);

        metadata.importEntries.append({ type,
            WTF::move(moduleRequest),
            WTF::move(importName),
            WTF::move(localName) });
    }

    // Read export entries
    if (ptr + 4 > end) return std::nullopt;
    uint32_t exportCount = readUint32(ptr);
    metadata.exportEntries.reserveInitialCapacity(exportCount);

    for (uint32_t i = 0; i < exportCount; ++i) {
        if (ptr + 4 > end) return std::nullopt;
        uint32_t type = readUint32(ptr);

        if (ptr >= end) return std::nullopt;
        WTF::String exportName = readString(vm, ptr);
        WTF::String moduleName = readString(vm, ptr);
        WTF::String importName = readString(vm, ptr);
        WTF::String localName = readString(vm, ptr);

        metadata.exportEntries.append({ type,
            WTF::move(exportName),
            WTF::move(moduleName),
            WTF::move(importName),
            WTF::move(localName) });
    }

    // Read star exports
    if (ptr + 4 > end) return std::nullopt;
    uint32_t starExportCount = readUint32(ptr);
    metadata.starExports.reserveInitialCapacity(starExportCount);

    for (uint32_t i = 0; i < starExportCount; ++i) {
        if (ptr >= end) return std::nullopt;
        metadata.starExports.append(readString(vm, ptr));
    }

    // Read declared variables (v3+)
    if (ptr + 4 > end) return std::nullopt;
    uint32_t declaredVarCount = readUint32(ptr);
    metadata.declaredVariables.reserveInitialCapacity(declaredVarCount);

    for (uint32_t i = 0; i < declaredVarCount; ++i) {
        if (ptr >= end) return std::nullopt;
        WTF::String name = readString(vm, ptr);
        if (ptr + 4 > end) return std::nullopt;
        uint32_t bits = readUint32(ptr);
        metadata.declaredVariables.append({ WTF::move(name), bits });
    }

    // Read lexical variables (v3+)
    if (ptr + 4 > end) return std::nullopt;
    uint32_t lexicalVarCount = readUint32(ptr);
    metadata.lexicalVariables.reserveInitialCapacity(lexicalVarCount);

    for (uint32_t i = 0; i < lexicalVarCount; ++i) {
        if (ptr >= end) return std::nullopt;
        WTF::String name = readString(vm, ptr);
        if (ptr + 4 > end) return std::nullopt;
        uint32_t bits = readUint32(ptr);
        metadata.lexicalVariables.append({ WTF::move(name), bits });
    }

    // Read code features (v3+)
    if (ptr + 4 > end) return std::nullopt;
    metadata.codeFeatures = readUint32(ptr);

    // bytecodeStart and bytecodeSize are already set from header

    return metadata;
}

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

            uint8_t* bytecodeData = resolvedSource.bytecode_cache;
            size_t bytecodeSize = resolvedSource.bytecode_cache_size;

            // Check if this is BMES format (ESM bytecode with metadata)
            // BMES format starts with magic number 0x424D4553 ("BMES")
            const uint8_t* extractedBytecodeStart = nullptr;
            size_t extractedBytecodeSize = 0;
            if (extractBytecodeFromBMES(bytecodeData, bytecodeSize, extractedBytecodeStart, extractedBytecodeSize)) {
                // This is BMES format - use zero-copy approach
                // Keep the original buffer alive, use span pointing to bytecode section
                // The destructor will free the original BMES buffer when the bytecode is no longer needed

                // Store the original buffer pointer for the destructor
                uint8_t* originalBuffer = bytecodeData;
                bool needsDeref = resolvedSource.needsDeref;

                // Create a destructor that frees the original BMES buffer (not the span pointer)
                WTF::Function<void(const void*)> bmesDestructor = needsDeref
                    ? WTF::Function<void(const void*)>([originalBuffer](const void*) {
                          mi_free(originalBuffer);
                      })
                    : WTF::Function<void(const void*)>([](const void*) {
                          // no-op for bun build --compile
                      });

                // Create CachedBytecode with span pointing directly into BMES buffer
                Ref<JSC::CachedBytecode> bytecode = JSC::CachedBytecode::create(
                    std::span<uint8_t>(const_cast<uint8_t*>(extractedBytecodeStart), extractedBytecodeSize),
                    WTF::move(bmesDestructor), {});

                auto provider = adoptRef(*new SourceProvider(
                    globalObject->isThreadLocalDefaultGlobalObject ? globalObject : nullptr,
                    resolvedSource,
                    string.isNull() ? *StringImpl::empty() : *string.impl(),
                    JSC::SourceTaintedOrigin::Untainted,
                    toSourceOrigin(sourceURLString, isBuiltin),
                    sourceURLString.impl(), TextPosition(),
                    sourceType));
                provider->m_cachedBytecode = WTF::move(bytecode);

                // Also deserialize module metadata from BMES v3+
                auto deserializedMetadata = deserializeCachedModuleMetadata(globalObject->vm(), bytecodeData, bytecodeSize);
                if (deserializedMetadata) {
                    // Convert DeserializedModuleMetadata to CachedModuleMetadata
                    CachedModuleMetadata cachedMetadata;
                    cachedMetadata.requestedModules.reserveInitialCapacity(deserializedMetadata->requestedModules.size());
                    for (const auto& req : deserializedMetadata->requestedModules) {
                        cachedMetadata.requestedModules.append({ req.specifier });
                    }

                    cachedMetadata.importEntries.reserveInitialCapacity(deserializedMetadata->importEntries.size());
                    for (const auto& entry : deserializedMetadata->importEntries) {
                        cachedMetadata.importEntries.append({ entry.type,
                            entry.moduleRequest,
                            entry.importName,
                            entry.localName });
                    }

                    cachedMetadata.exportEntries.reserveInitialCapacity(deserializedMetadata->exportEntries.size());
                    for (const auto& entry : deserializedMetadata->exportEntries) {
                        cachedMetadata.exportEntries.append({ entry.type,
                            entry.exportName,
                            entry.moduleName,
                            entry.importName,
                            entry.localName });
                    }

                    cachedMetadata.starExports = WTF::move(deserializedMetadata->starExports);

                    cachedMetadata.declaredVariables.reserveInitialCapacity(deserializedMetadata->declaredVariables.size());
                    for (const auto& entry : deserializedMetadata->declaredVariables) {
                        cachedMetadata.declaredVariables.append({ entry.name, entry.bits });
                    }

                    cachedMetadata.lexicalVariables.reserveInitialCapacity(deserializedMetadata->lexicalVariables.size());
                    for (const auto& entry : deserializedMetadata->lexicalVariables) {
                        cachedMetadata.lexicalVariables.append({ entry.name, entry.bits });
                    }

                    cachedMetadata.codeFeatures = deserializedMetadata->codeFeatures;

                    provider->m_cachedModuleMetadata = WTF::move(cachedMetadata);
                }

                return provider;
            }

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

// MODULE_CACHE_MAGIC and MODULE_CACHE_VERSION are defined at the top of this file

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

// Check if cached metadata is valid for given source
// Only accepts v3 format (with VariableEnvironment and CodeFeatures)
extern "C" bool validateCachedModuleMetadata(
    const uint8_t* cacheData,
    size_t cacheSize)
{
    if (cacheSize < 8)
        return false;

    const uint8_t* ptr = cacheData;

    // Check magic
    uint32_t magic = readUint32(ptr);
    if (magic != MODULE_CACHE_MAGIC)
        return false;

    // Check version - only accept v3
    uint32_t version = readUint32(ptr);
    if (version != 3)
        return false;

    return true;
}

// Generate cached bytecode WITH module metadata
// Uses BMES v3 format with bytecode offset in header for O(1) extraction
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
        parserError);

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

    // Generate bytecode first to know its size
    UnlinkedModuleProgramCodeBlock* unlinkedCodeBlock = recursivelyGenerateUnlinkedCodeBlockForModuleProgram(
        vm, sourceCode, StrictModeLexicallyScopedFeature, JSParserScriptMode::Module,
        {}, parserError, EvalContextType::None);

    if (parserError.isValid() || !unlinkedCodeBlock)
        return false;

    auto key = sourceCodeKeyForSerializedModule(vm, sourceCode);
    RefPtr<CachedBytecode> bytecodeCache = encodeCodeBlock(vm, key, unlinkedCodeBlock);

    if (!bytecodeCache)
        return false;

    // BMES v3 Format:
    // [4 bytes: MAGIC] [4 bytes: VERSION] [4 bytes: BYTECODE_OFFSET] [4 bytes: BYTECODE_SIZE]
    // [... metadata (includes VariableEnvironment and CodeFeatures) ...]
    // [BYTECODE_SIZE bytes: BYTECODE_DATA]

    Vector<uint8_t> metadataBuffer;
    metadataBuffer.reserveInitialCapacity(4096);

    // Write header - offset and size will be filled in later
    writeUint32(metadataBuffer, MODULE_CACHE_MAGIC);
    writeUint32(metadataBuffer, MODULE_CACHE_VERSION); // Version 3
    size_t offsetPosition = metadataBuffer.size();
    writeUint32(metadataBuffer, 0); // Placeholder for bytecode offset
    writeUint32(metadataBuffer, static_cast<uint32_t>(bytecodeCache->span().size())); // Bytecode size

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

    // Serialize declared variables (from ModuleProgramNode)
    const auto& declaredVars = moduleProgramNode->varDeclarations();
    writeUint32(metadataBuffer, declaredVars.size());
    for (const auto& entry : declaredVars) {
        writeString(metadataBuffer, String(entry.key.get()));
        writeUint32(metadataBuffer, entry.value.bits());
    }

    // Serialize lexical variables (from ModuleProgramNode)
    const auto& lexicalVars = moduleProgramNode->lexicalVariables();
    writeUint32(metadataBuffer, lexicalVars.size());
    for (const auto& entry : lexicalVars) {
        writeString(metadataBuffer, String(entry.key.get()));
        writeUint32(metadataBuffer, entry.value.bits());
    }

    // Serialize code features
    writeUint32(metadataBuffer, static_cast<uint32_t>(moduleProgramNode->features()));

    // Align bytecode offset to 8-byte boundary for JSC's CachedBytecode requirements
    size_t currentSize = metadataBuffer.size();
    size_t alignedOffset = (currentSize + 7) & ~static_cast<size_t>(7);
    size_t paddingNeeded = alignedOffset - currentSize;

    // Add padding bytes
    for (size_t i = 0; i < paddingNeeded; ++i) {
        metadataBuffer.append(0);
    }

    // Record bytecode offset (now aligned to 8-byte boundary)
    uint32_t bytecodeOffset = static_cast<uint32_t>(metadataBuffer.size());

    // Write bytecode offset back into header
    metadataBuffer[offsetPosition] = static_cast<uint8_t>(bytecodeOffset & 0xFF);
    metadataBuffer[offsetPosition + 1] = static_cast<uint8_t>((bytecodeOffset >> 8) & 0xFF);
    metadataBuffer[offsetPosition + 2] = static_cast<uint8_t>((bytecodeOffset >> 16) & 0xFF);
    metadataBuffer[offsetPosition + 3] = static_cast<uint8_t>((bytecodeOffset >> 24) & 0xFF);

    // Append bytecode data
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
        WTF::move(finalDestructor),
        {});

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

JSC::JSModuleRecord* SourceProvider::createModuleRecordFromCache(
    JSC::JSGlobalObject* globalObject,
    const JSC::Identifier& moduleKey)
{
    if (!m_cachedModuleMetadata.has_value()) {
        return nullptr;
    }

    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    const auto& metadata = m_cachedModuleMetadata.value();

    // Helper lambda to set VariableEnvironmentEntry bits
    // Set flags individually to be compatible with both prebuilt and local JSC
    auto setEntryBits = [](JSC::VariableEnvironmentEntry& varEntry, uint32_t bits) {
        // These bit positions match VariableEnvironmentEntry::Traits enum
        if (bits & (1 << 0)) varEntry.setIsCaptured();
        if (bits & (1 << 1)) varEntry.setIsConst();
        if (bits & (1 << 2)) varEntry.setIsVar();
        if (bits & (1 << 3)) varEntry.setIsLet();
        if (bits & (1 << 4)) varEntry.setIsExported();
        if (bits & (1 << 5)) varEntry.setIsImported();
        if (bits & (1 << 6)) varEntry.setIsImportedNamespace();
        if (bits & (1 << 7)) varEntry.setIsFunction();
        if (bits & (1 << 8)) varEntry.setIsParameter();
        if (bits & (1 << 9)) varEntry.setIsSloppyModeHoistedFunction();
        if (bits & (1 << 10)) varEntry.setIsPrivateField();
        if (bits & (1 << 11)) varEntry.setIsPrivateMethod();
        if (bits & (1 << 12)) varEntry.setIsPrivateGetter();
        if (bits & (1 << 13)) varEntry.setIsPrivateSetter();
    };

    // Build VariableEnvironment for declared variables
    JSC::VariableEnvironment declaredVariables;
    for (const auto& entry : metadata.declaredVariables) {
        auto identifier = JSC::Identifier::fromString(vm, entry.name);
        auto result = declaredVariables.add(identifier);
        setEntryBits(result.iterator->value, entry.bits);
    }

    // Build VariableEnvironment for lexical variables
    JSC::VariableEnvironment lexicalVariables;
    for (const auto& entry : metadata.lexicalVariables) {
        auto identifier = JSC::Identifier::fromString(vm, entry.name);
        auto result = lexicalVariables.add(identifier);
        setEntryBits(result.iterator->value, entry.bits);
    }

    // Create SourceCode
    JSC::SourceCode sourceCode(this, 0, source().length(), 0, 0);

    // Get the structure for JSModuleRecord
    JSC::Structure* moduleRecordStructure = globalObject->moduleRecordStructure();
    if (!moduleRecordStructure) {
        return nullptr;
    }

    // Create JSModuleRecord
    JSC::JSModuleRecord* moduleRecord = JSC::JSModuleRecord::create(
        globalObject,
        vm,
        moduleRecordStructure,
        moduleKey,
        sourceCode,
        declaredVariables,
        lexicalVariables,
        static_cast<JSC::CodeFeatures>(metadata.codeFeatures));
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (!moduleRecord) {
        return nullptr;
    }

    // Add requested modules
    for (const auto& request : metadata.requestedModules) {
        auto specifier = JSC::Identifier::fromString(vm, request.specifier);
        moduleRecord->appendRequestedModule(specifier, nullptr);
    }

    // Add import entries
    for (const auto& entry : metadata.importEntries) {
        JSC::AbstractModuleRecord::ImportEntry importEntry;
        switch (entry.type) {
        case 0:
            importEntry.type = JSC::AbstractModuleRecord::ImportEntryType::Single;
            break;
        case 1:
#if USE(BUN_JSC_ADDITIONS)
            importEntry.type = JSC::AbstractModuleRecord::ImportEntryType::SingleTypeScript;
            break;
#else
            importEntry.type = JSC::AbstractModuleRecord::ImportEntryType::Single;
            break;
#endif
        case 2:
        default:
            importEntry.type = JSC::AbstractModuleRecord::ImportEntryType::Namespace;
            break;
        }
        // Use empty identifier for null strings to avoid crash
        importEntry.moduleRequest = entry.moduleRequest.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.moduleRequest);
        importEntry.importName = entry.importName.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.importName);
        importEntry.localName = entry.localName.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.localName);
        moduleRecord->addImportEntry(importEntry);
    }

    // Add export entries
    for (const auto& entry : metadata.exportEntries) {
        JSC::AbstractModuleRecord::ExportEntry exportEntry;
        // Use empty identifier for null strings to avoid crash
        auto exportName = entry.exportName.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.exportName);
        auto moduleName = entry.moduleName.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.moduleName);
        auto importName = entry.importName.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.importName);
        auto localName = entry.localName.isNull() ? JSC::Identifier() : JSC::Identifier::fromString(vm, entry.localName);

        switch (entry.type) {
        case 0:
            exportEntry = JSC::AbstractModuleRecord::ExportEntry::createLocal(exportName, localName);
            break;
        case 1:
            exportEntry = JSC::AbstractModuleRecord::ExportEntry::createIndirect(exportName, importName, moduleName);
            break;
        case 2:
        default:
            exportEntry = JSC::AbstractModuleRecord::ExportEntry::createNamespace(exportName, moduleName);
            break;
        }
        moduleRecord->addExportEntry(exportEntry);
    }

    // Add star exports
    for (const auto& specifier : metadata.starExports) {
        auto identifier = JSC::Identifier::fromString(vm, specifier);
        moduleRecord->addStarExportEntry(identifier);
    }

    return moduleRecord;
}

}; // namespace Zig
