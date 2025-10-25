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

class BunSourceProvider final : public JSC::SourceProvider {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(BunSourceProvider);
    using Base = JSC::SourceProvider;
    using BytecodeCacheGenerator = JSC::BytecodeCacheGenerator;
    using UnlinkedFunctionExecutable = JSC::UnlinkedFunctionExecutable;
    using CachedBytecode = JSC::CachedBytecode;
    using UnlinkedFunctionCodeBlock = JSC::UnlinkedFunctionCodeBlock;
    using SourceCode = JSC::SourceCode;
    using CodeSpecializationKind = JSC::CodeSpecializationKind;
    using SourceOrigin = JSC::SourceOrigin;

public:
    static Ref<BunSourceProvider> create(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const SourceOrigin& origin,
        WTF::String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    ~BunSourceProvider() final;

    unsigned hash() const final;
    StringView source() const final;

    RefPtr<JSC::CachedBytecode> cachedBytecode() const final
    {
        return m_cachedBytecode.copyRef();
    };

private:
    BunSourceProvider(
        Zig::GlobalObject* globalObject,
        Ref<WTF::StringImpl>&& source,
        const SourceOrigin& origin,
        WTF::String&& sourceURL,
        RefPtr<JSC::CachedBytecode>&& bytecode,
        JSC::SourceProviderSourceType sourceType);

    // Simplified members (vs ZigSourceProvider)
    Ref<WTF::StringImpl> m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    Zig::GlobalObject* m_globalObject; // For sourcemap cleanup only
    unsigned m_hash = 0;
};

} // namespace Zig
