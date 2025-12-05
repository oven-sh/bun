#include "headers.h"
#include "root.h"

#pragma once

namespace JSC {
class Structure;
class Identifier;
class SourceCodeKey;
class SourceProvider;
class JSModuleRecord;
class VariableEnvironment;
} // namespace JSC

#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/Structure.h>
#include <optional>

namespace Zig {

class GlobalObject;

// Cached module metadata for ESM bytecode cache
// This structure holds the deserialized import/export information
// that allows skipping the ModuleAnalyzeMode parsing phase
struct CachedModuleMetadata {
    struct ModuleRequest {
        WTF::String specifier;
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
        uint32_t bits; // VariableEnvironmentEntry bits
    };

    Vector<ModuleRequest> requestedModules;
    Vector<ImportEntry> importEntries;
    Vector<ExportEntry> exportEntries;
    Vector<WTF::String> starExports;
    Vector<VariableEntry> declaredVariables;
    Vector<VariableEntry> lexicalVariables;
    uint32_t codeFeatures;
};

void forEachSourceProvider(WTF::Function<void(JSC::SourceID)>);
JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL);
void* sourceMappingForSourceURL(const WTF::String& sourceURL);
JSC::SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin);
class SourceProvider final : public JSC::SourceProvider {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(SourceProvider);
    using Base = JSC::SourceProvider;
    using BytecodeCacheGenerator = JSC::BytecodeCacheGenerator;
    using UnlinkedFunctionExecutable = JSC::UnlinkedFunctionExecutable;
    using CachedBytecode = JSC::CachedBytecode;
    using UnlinkedFunctionCodeBlock = JSC::UnlinkedFunctionCodeBlock;
    using SourceCode = JSC::SourceCode;
    using CodeSpecializationKind = JSC::CodeSpecializationKind;
    using SourceOrigin = JSC::SourceOrigin;

public:
    static Ref<SourceProvider> create(
        Zig::GlobalObject*,
        ResolvedSource& resolvedSource,
        JSC::SourceProviderSourceType sourceType = JSC::SourceProviderSourceType::Module,
        bool isBuiltIn = false);
    ~SourceProvider();
    unsigned hash() const override;
    StringView source() const override;

    RefPtr<JSC::CachedBytecode> cachedBytecode() const final
    {
        return m_cachedBytecode.copyRef();
    };

    // ESM bytecode cache support - virtual overrides from JSC::SourceProvider
    bool hasCachedModuleMetadata() const override
    {
        return m_cachedModuleMetadata.has_value();
    }

    JSC::JSModuleRecord* createModuleRecordFromCache(
        JSC::JSGlobalObject* globalObject,
        const JSC::Identifier& moduleKey) override;

    void updateCache(const UnlinkedFunctionExecutable* executable, const SourceCode&, CodeSpecializationKind kind, const UnlinkedFunctionCodeBlock* codeBlock);
    void cacheBytecode(const BytecodeCacheGenerator& generator);
    void commitCachedBytecode();
    bool isBytecodeCacheEnabled() const;
    void readOrGenerateByteCodeCache(JSC::VM& vm, const JSC::SourceCode& sourceCode);
    ResolvedSource m_resolvedSource;
    int readCache(JSC::VM& vm, const JSC::SourceCode& sourceCode);
    void freeSourceCode();

private:
    SourceProvider(Zig::GlobalObject* globalObject, ResolvedSource resolvedSource, Ref<WTF::StringImpl>&& sourceImpl,
        JSC::SourceTaintedOrigin taintedness,
        const SourceOrigin& sourceOrigin, WTF::String&& sourceURL,
        const TextPosition& startPosition, JSC::SourceProviderSourceType sourceType)
        : Base(sourceOrigin, WTFMove(sourceURL), String(), taintedness, startPosition, sourceType)
        , m_globalObject(globalObject)
        , m_source(sourceImpl)
    {
        m_resolvedSource = resolvedSource;
    }

    Zig::GlobalObject* m_globalObject;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    std::optional<CachedModuleMetadata> m_cachedModuleMetadata;
    Ref<WTF::StringImpl> m_source;
    unsigned m_hash = 0;
};

} // namespace Zig
