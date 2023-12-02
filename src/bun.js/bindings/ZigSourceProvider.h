#include "headers.h"
#include "root.h"

#pragma once

namespace JSC {
class Structure;
class Identifier;
class SourceCodeKey;
class SourceProvider;
} // namespace JSC

#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include "ZigConsoleClient.h"
// #include <JavaScriptCore/SourceCodeKey.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/Structure.h>

namespace Zig {

class GlobalObject;

void forEachSourceProvider(WTF::Function<void(JSC::SourceID)>);
JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL);
void* sourceMappingForSourceURL(const WTF::String& sourceURL);

class SourceProvider final : public JSC::SourceProvider {
    WTF_MAKE_FAST_ALLOCATED;
    using Base = JSC::SourceProvider;
    using BytecodeCacheGenerator = JSC::BytecodeCacheGenerator;
    using UnlinkedFunctionExecutable = JSC::UnlinkedFunctionExecutable;
    using CachedBytecode = JSC::CachedBytecode;
    using UnlinkedFunctionCodeBlock = JSC::UnlinkedFunctionCodeBlock;
    using SourceCode = JSC::SourceCode;
    using CodeSpecializationKind = JSC::CodeSpecializationKind;
    using SourceOrigin = JSC::SourceOrigin;

public:
    static Ref<SourceProvider> create(Zig::GlobalObject*, ResolvedSource resolvedSource, JSC::SourceProviderSourceType sourceType = JSC::SourceProviderSourceType::Module, bool isBuiltIn = false);
    ~SourceProvider();
    unsigned hash() const override;
    StringView source() const override { return StringView(m_source.get()); }
    RefPtr<JSC::CachedBytecode> cachedBytecode()
    {
        // if (m_resolvedSource.bytecodecache_fd == 0) {
        return nullptr;
        // }

        // return m_cachedBytecode;
    };

    void updateCache(const UnlinkedFunctionExecutable* executable, const SourceCode&,
        CodeSpecializationKind kind, const UnlinkedFunctionCodeBlock* codeBlock);
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
        , m_source(sourceImpl)
    {

        m_resolvedSource = resolvedSource;
    }

    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    Ref<WTF::StringImpl> m_source;
    bool did_free_source_code = false;
    Zig::GlobalObject* m_globalObjectForSourceProviderMap;
    unsigned m_hash;

    // JSC::SourceCodeKey key;
};

} // namespace Zig