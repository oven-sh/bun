#pragma once

#include "root.h"
#include "JavaScriptCore/SourceProvider.h"
#include "JavaScriptCore/CachedBytecode.h"
#include "JavaScriptCore/SourceOrigin.h"
#include <wtf/text/WTFString.h>

// Forward declaration - full definition in headers-handwritten.h
struct TranspiledSource;

namespace Zig {

class GlobalObject;

class BunSourceProvider final : public JSC::SourceProvider {
public:
    static Ref<BunSourceProvider> create(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const JSC::SourceOrigin& origin,
        String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    ~BunSourceProvider() final;

    // Required overrides
    StringView source() const final;
    unsigned hash() const final;
    RefPtr<JSC::CachedBytecode> cachedBytecode() const final;

private:
    BunSourceProvider(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const JSC::SourceOrigin& origin,
        String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    // Simplified members (vs ZigSourceProvider)
    Ref<WTF::StringImpl> m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;

    // REMOVED: No more m_resolvedSource member!
};

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL);

} // namespace Zig

extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* source);
