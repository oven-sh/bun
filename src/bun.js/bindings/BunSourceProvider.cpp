#include "root.h"

#include "BunSourceProvider.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "BunString.h"

#include <JavaScriptCore/BytecodeCacheError.h>
#include <wtf/text/StringHash.h>
#include <wtf/URL.h>
#include <mimalloc.h>

// Forward declare the C structs from Zig
extern "C" {
    // Must match TranspiledSource.zig
    struct TranspiledSource {
        BunString source_code;
        BunString source_url;
        uint8_t* bytecode_cache;
        size_t bytecode_cache_len;
        uint32_t flags; // packed struct: is_commonjs:1, is_already_bundled:1, padding:30
    };
}

namespace Zig {

using String = WTF::String;

// Helper functions for source providers
JSC::SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin)
{
    ASSERT_WITH_MESSAGE(!sourceURL.startsWith("file://"_s), "specifier should not already be a file URL");

    if (isBuiltin) {
        if (sourceURL.startsWith("node:"_s)) {
            return JSC::SourceOrigin(WTF::URL(makeString("builtin://node/"_s, sourceURL.substring(5))));
        } else if (sourceURL.startsWith("bun:"_s)) {
            return JSC::SourceOrigin(WTF::URL(makeString("builtin://bun/"_s, sourceURL.substring(4))));
        } else {
            return JSC::SourceOrigin(WTF::URL(makeString("builtin://"_s, sourceURL)));
        }
    }
    return JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL));
}

extern "C" int ByteRangeMapping__getSourceID(void* mappings, BunString sourceURL);
extern "C" void* ByteRangeMapping__find(BunString sourceURL);

void* sourceMappingForSourceURL(const WTF::String& sourceURL)
{
    return ByteRangeMapping__find(Bun::toString(sourceURL));
}

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL)
{
    void* mappings = ByteRangeMapping__find(Bun::toString(sourceURL));
    if (!mappings) {
        return 0;
    }

    return ByteRangeMapping__getSourceID(mappings, Bun::toString(sourceURL));
}

Ref<BunSourceProvider> BunSourceProvider::create(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const WTF::String& sourceURL,
    JSC::SourceOrigin&& origin,
    JSC::SourceProviderSourceType sourceType,
    RefPtr<JSC::CachedBytecode>&& cachedBytecode)
{
    return adoptRef(*new BunSourceProvider(
        globalObject,
        WTFMove(source),
        sourceURL,
        WTFMove(origin),
        sourceType,
        WTFMove(cachedBytecode)));
}

BunSourceProvider::BunSourceProvider(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const WTF::String& sourceURL,
    JSC::SourceOrigin&& origin,
    JSC::SourceProviderSourceType sourceType,
    RefPtr<JSC::CachedBytecode>&& cachedBytecode)
    : Base(origin, String(sourceURL), String(), JSC::SourceTaintedOrigin::Untainted, TextPosition(), sourceType)
    , m_globalObject(globalObject)
    , m_source(WTFMove(source))
    , m_cachedBytecode(WTFMove(cachedBytecode))
    , m_hash(0)
{
    // m_globalObject is stored for potential future use (e.g., destructor cleanup)
    UNUSED_PARAM(m_globalObject);
}

StringView BunSourceProvider::source() const
{
    return StringView(m_source.get());
}

unsigned BunSourceProvider::hash() const
{
    if (m_hash) {
        return m_hash;
    }
    return m_source->hash();
}

// Forward declare the C bridge function for registering sourcemaps
extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, JSC::SourceProvider* opaque_source_provider, BunString* specifier);

// C bridge function for creating a BunSourceProvider from TranspiledSource
extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* transpiled)
{
    // Convert BunStrings to WTF strings
    auto sourceCode = transpiled->source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURL = transpiled->source_url.toWTFString(BunString::ZeroCopy);

    // Extract flags
    bool isCommonJS = (transpiled->flags & 0x1) != 0;
    bool alreadyBundled = (transpiled->flags & 0x2) != 0;

    // Determine source type
    JSC::SourceProviderSourceType sourceType = isCommonJS
        ? JSC::SourceProviderSourceType::Program
        : JSC::SourceProviderSourceType::Module;

    // Create source origin
    JSC::SourceOrigin origin = toSourceOrigin(sourceURL, false);

    // Handle bytecode cache if present
    RefPtr<JSC::CachedBytecode> cachedBytecode = nullptr;
    if (transpiled->bytecode_cache != nullptr && transpiled->bytecode_cache_len > 0) {
        JSC::CachePayload::Destructor destructor = [](const void* ptr) {
            mi_free(const_cast<void*>(ptr));
        };
        cachedBytecode = JSC::CachedBytecode::create(
            std::span<uint8_t>(transpiled->bytecode_cache, transpiled->bytecode_cache_len),
            WTFMove(destructor),
            {});
    }

    // Create the source provider
    auto provider = BunSourceProvider::create(
        globalObject,
        sourceCode.isNull() ? Ref<WTF::StringImpl>(*WTF::StringImpl::empty()) : Ref<WTF::StringImpl>(*sourceCode.impl()),
        sourceURL,
        WTFMove(origin),
        sourceType,
        WTFMove(cachedBytecode));

    // Register sourcemap if already bundled
    if (alreadyBundled) {
        auto sourceURLBun = transpiled->source_url;
        Bun__addSourceProviderSourceMap(globalObject->bunVM(), provider.ptr(), &sourceURLBun);
    }

    // Return leaked ref (caller takes ownership)
    provider->ref();
    return provider.ptr();
}

} // namespace Zig
