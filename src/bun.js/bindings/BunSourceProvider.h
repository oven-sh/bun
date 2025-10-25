#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/SourceProvider.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/CachedBytecode.h"

namespace Zig {

// Forward declarations
struct TranspiledSource;

/// New SourceProvider for transpiled Bun modules
/// Simpler than the old ZigSourceProvider - no stored ResolvedSource
class BunSourceProvider final : public JSC::SourceProvider {
public:
    static Ref<BunSourceProvider> create(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const JSC::SourceOrigin& origin,
        String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    virtual ~BunSourceProvider();

    // Required overrides from SourceProvider
    StringView source() const final { return m_source.get(); }
    unsigned hash() const final { return m_hash; }
    RefPtr<JSC::CachedBytecode> cachedBytecode() const final { return m_cachedBytecode; }

private:
    BunSourceProvider(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const JSC::SourceOrigin& origin,
        String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    // Simplified members (vs old ZigSourceProvider)
    Ref<WTF::StringImpl> m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    Zig::GlobalObject* m_globalObject;  // For sourcemap cleanup only
    unsigned m_hash;
};

} // namespace Zig
