#include "root.h"
#include "helpers.h"
#include "BunSourceProvider.h"
#include "ZigSourceProvider.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/BytecodeCacheError.h>
#include <JavaScriptCore/Completion.h>
#include <wtf/Scope.h>
#include <wtf/text/StringHash.h>
#include <wtf/Assertions.h>
#include <sys/stat.h>
#include <JavaScriptCore/SourceCodeKey.h>
#include <mimalloc.h>
#include <JavaScriptCore/CodeCache.h>

// Import the TranspiledSource struct from Zig
extern "C" {
struct TranspiledSource {
    BunString source_code;
    BunString source_url;
    uint8_t* bytecode_cache;
    size_t bytecode_cache_len;
    struct {
        bool is_commonjs : 1;
        bool is_already_bundled : 1;
        uint32_t _padding : 30;
    } flags;
};
}

namespace Zig {

using SourceOrigin = JSC::SourceOrigin;
using SourceProviderSourceType = JSC::SourceProviderSourceType;

extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, JSC::SourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* bun_vm, JSC::SourceProvider* opaque_source_provider, BunString* specifier);

BunSourceProvider::BunSourceProvider(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const JSC::SourceOrigin& origin,
    WTF::String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType)
    : Base(origin, WTFMove(sourceURL), WTF::String(), JSC::SourceTaintedOrigin::Untainted, WTF::TextPosition(), sourceType)
    , m_source(WTFMove(source))
    , m_cachedBytecode(WTFMove(bytecode))
    , m_globalObject(globalObject)
{
}

Ref<BunSourceProvider> BunSourceProvider::create(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const JSC::SourceOrigin& origin,
    WTF::String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType)
{
    return adoptRef(*new BunSourceProvider(
        globalObject,
        WTFMove(source),
        origin,
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType));
}

BunSourceProvider::~BunSourceProvider()
{
    // Sourcemap cleanup is handled separately
}

StringView BunSourceProvider::source() const
{
    return StringView(m_source.get());
}

unsigned BunSourceProvider::hash() const
{
    if (m_hash == 0) {
        m_hash = m_source->hash();
    }
    return m_hash;
}

// C bridge function to create BunSourceProvider from TranspiledSource
extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* source)
{
    auto sourceString = source->source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURL = source->source_url.toWTFString(BunString::ZeroCopy);

    bool isCommonJS = source->flags.is_commonjs;
    auto sourceType = isCommonJS ?
        JSC::SourceProviderSourceType::Program :
        JSC::SourceProviderSourceType::Module;

    // Handle bytecode if present
    RefPtr<JSC::CachedBytecode> bytecode;
    if (source->bytecode_cache) {
        bytecode = JSC::CachedBytecode::create(
            std::span<uint8_t>(source->bytecode_cache, source->bytecode_cache_len),
            [](const void* ptr) { mi_free(const_cast<void*>(ptr)); },
            {}
        );
    }

    auto provider = BunSourceProvider::create(
        globalObject,
        sourceString.isNull() ? Ref<WTF::StringImpl>(*StringImpl::empty()) : Ref<WTF::StringImpl>(*sourceString.impl()),
        toSourceOrigin(sourceURL, false),
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType
    );

    // Register sourcemap if needed
    if (source->flags.is_already_bundled) {
        BunString sourceUrlCopy = source->source_url;
        Bun__addSourceProviderSourceMap(
            globalObject->bunVM(),
            provider.ptr(),
            &sourceUrlCopy
        );
    }

    // Transfer ownership to caller
    return &provider.leakRef();
}

} // namespace Zig
