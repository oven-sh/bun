#include "headers.h"
#include "root.h"

#pragma once

namespace JSC {
class SourceProvider;
class SourceOrigin;
} // namespace JSC

#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/SourceProvider.h>

// Forward declarations
struct TranspiledSource;

namespace Zig {

class GlobalObject;

class BunSourceProvider final : public JSC::SourceProvider {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(BunSourceProvider);
    using Base = JSC::SourceProvider;

public:
    static Ref<BunSourceProvider> create(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const JSC::SourceOrigin& origin,
        WTF::String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    ~BunSourceProvider() final;

    // Required overrides
    StringView source() const final;
    unsigned hash() const final;
    RefPtr<JSC::CachedBytecode> cachedBytecode() const final
    {
        return m_cachedBytecode.copyRef();
    };

private:
    BunSourceProvider(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const JSC::SourceOrigin& origin,
        WTF::String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    // Simplified members (vs ZigSourceProvider)
    Ref<WTF::StringImpl> m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    Zig::GlobalObject* m_globalObject; // For sourcemap cleanup only
    mutable unsigned m_hash = 0;
};

} // namespace Zig
