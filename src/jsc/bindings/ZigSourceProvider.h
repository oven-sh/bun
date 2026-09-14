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

struct bun_ModuleInfoDeserialized;

namespace Zig {

class GlobalObject;

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

    // Taken from the ResolvedSource at create(); freed in the destructor (or
    // earlier by BunAnalyzeTranspiledModule once consumed).
    bun_ModuleInfoDeserialized* m_moduleInfo { nullptr };
    uint32_t m_tag { 0 };
    bool m_alreadyBundled { false };

private:
    SourceProvider(void* bunVM, ResolvedSource& resolvedSource, Ref<WTF::StringImpl>&& sourceImpl,
        JSC::SourceTaintedOrigin taintedness,
        const SourceOrigin& sourceOrigin, WTF::String&& sourceURL,
        const TextPosition& startPosition, JSC::SourceProviderSourceType sourceType)
        : Base(sourceOrigin, WTF::move(sourceURL), String(), taintedness, startPosition, sourceType)
        , m_moduleInfo(std::exchange(resolvedSource.module_info, nullptr))
        , m_tag(resolvedSource.tag)
        , m_alreadyBundled(resolvedSource.already_bundled)
        , m_bunVM(bunVM)
        , m_source(WTF::move(sourceImpl))
    {
    }

    // Stored directly (not via the creating global) so the destructor stays
    // valid when the provider outlives its global under --isolate caching.
    void* m_bunVM;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    Ref<WTF::StringImpl> m_source;
    unsigned m_hash = 0;
};

} // namespace Zig
