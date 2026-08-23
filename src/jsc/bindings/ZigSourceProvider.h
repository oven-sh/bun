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
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/Structure.h>

namespace Zig {

class GlobalObject;
class NodeCompileCacheCollector;

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL);
JSC::SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin);
class SourceProvider final : public JSC::SourceProvider {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(SourceProvider);
    using Base = JSC::SourceProvider;
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

    // Node compile cache hooks; no-ops unless the entry missed on disk.
    void cacheBytecode(const JSC::BytecodeCacheGenerator&) const final;
    void updateCache(const JSC::UnlinkedFunctionExecutable*, const JSC::SourceCode&, JSC::CodeSpecializationKind, const JSC::UnlinkedFunctionCodeBlock*) const final;
    NodeCompileCacheCollector* nodeCompileCache() const { return m_nodeCompileCache.get(); }

    ResolvedSource m_resolvedSource;

private:
    SourceProvider(void* bunVM, ResolvedSource resolvedSource, Ref<WTF::StringImpl>&& sourceImpl,
        JSC::SourceTaintedOrigin taintedness,
        const SourceOrigin& sourceOrigin, WTF::String&& sourceURL,
        const TextPosition& startPosition, JSC::SourceProviderSourceType sourceType);

    // Stored directly (not via the creating global) so the destructor stays
    // valid when the provider outlives its global under --isolate caching.
    void* m_bunVM;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    std::unique_ptr<NodeCompileCacheCollector> m_nodeCompileCache;
    Ref<WTF::StringImpl> m_source;
    unsigned m_hash = 0;
};

} // namespace Zig
