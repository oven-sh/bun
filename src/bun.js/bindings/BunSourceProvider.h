#pragma once

#include "root.h"
#include "headers.h"

#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <wtf/RefPtr.h>
#include <wtf/text/WTFString.h>

namespace Zig {

class GlobalObject;

// Helper functions for source providers
void forEachSourceProvider(WTF::Function<void(JSC::SourceID)>);
JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL);
void* sourceMappingForSourceURL(const WTF::String& sourceURL);
JSC::SourceOrigin toSourceOrigin(const WTF::String& sourceURL, bool isBuiltin);

/// New cleaner SourceProvider implementation for Bun
/// Uses TranspiledSource instead of ResolvedSource for better separation of concerns
class BunSourceProvider final : public JSC::SourceProvider {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(BunSourceProvider);
    using Base = JSC::SourceProvider;

public:
    static Ref<BunSourceProvider> create(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const WTF::String& sourceURL,
        JSC::SourceOrigin&& origin,
        JSC::SourceProviderSourceType sourceType,
        RefPtr<JSC::CachedBytecode>&& cachedBytecode = nullptr);

    virtual ~BunSourceProvider() = default;

    // Required JSC::SourceProvider overrides
    StringView source() const override;
    unsigned hash() const override;

    RefPtr<JSC::CachedBytecode> cachedBytecode() const final
    {
        return m_cachedBytecode;
    }

private:
    BunSourceProvider(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const WTF::String& sourceURL,
        JSC::SourceOrigin&& origin,
        JSC::SourceProviderSourceType sourceType,
        RefPtr<JSC::CachedBytecode>&& cachedBytecode);

    Zig::GlobalObject* m_globalObject;
    Ref<WTF::StringImpl> m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    unsigned m_hash;
};

} // namespace Zig
