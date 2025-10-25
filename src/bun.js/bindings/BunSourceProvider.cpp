#include "BunSourceProvider.h"
#include "ZigGlobalObject.h"
#include "BunString.h"
#include "JavaScriptCore/SourceCode.h"
#include "JavaScriptCore/CachedBytecode.h"
#include "wtf/URL.h"
#include "wtf/text/StringImpl.h"
#include "headers-handwritten.h"

// Verify struct sizes match between C++ and Zig
static_assert(sizeof(TranspiledSourceFlags) == sizeof(uint32_t), "TranspiledSourceFlags must be 32 bits");
static_assert(alignof(TranspiledSource) == 8, "TranspiledSource must be 8-byte aligned");

namespace Zig {

extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, JSC::SourceProvider* provider, BunString* specifier);

Ref<BunSourceProvider> BunSourceProvider::create(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const JSC::SourceOrigin& origin,
    String&& sourceURL,
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

BunSourceProvider::BunSourceProvider(
    Zig::GlobalObject* globalObject,
    Ref<WTF::StringImpl>&& source,
    const JSC::SourceOrigin& origin,
    String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& bytecode,
    JSC::SourceProviderSourceType sourceType)
    : JSC::SourceProvider(origin, WTF::URL(), sourceType, false)
    , m_source(WTFMove(source))
    , m_cachedBytecode(WTFMove(bytecode))
    , m_globalObject(globalObject)
    , m_hash(0)
{
    // Set the source URL
    this->setSourceURLDirectly(sourceURL);

    // Compute hash for the source
    m_hash = m_source->hash();
}

BunSourceProvider::~BunSourceProvider()
{
    // Sourcemap cleanup happens automatically via the global object's sourcemap registry
    // No manual cleanup needed here
}

// C bridge function to create a SourceProvider from TranspiledSource
extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* source)
{
    // Convert source code to WTF::String
    auto sourceString = source->source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURL = source->source_url.toWTFString(BunString::ZeroCopy);

    bool isCommonJS = source->flags.is_commonjs;
    auto sourceType = isCommonJS
        ? JSC::SourceProviderSourceType::Program
        : JSC::SourceProviderSourceType::Module;

    // Create SourceOrigin from URL
    auto origin = JSC::SourceOrigin(WTF::URL(sourceURL));

    // Handle bytecode if present
    RefPtr<JSC::CachedBytecode> bytecode;
    if (source->bytecode_cache && source->bytecode_cache_len > 0) {
        bytecode = JSC::CachedBytecode::create(
            std::span<uint8_t>(source->bytecode_cache, source->bytecode_cache_len),
            [](const void* ptr) {
                // Free using mimalloc (Bun's allocator)
                extern "C" void mi_free(void*);
                mi_free(const_cast<void*>(ptr));
            },
            {}
        );
    }

    auto provider = BunSourceProvider::create(
        globalObject,
        *sourceString.impl(),
        origin,
        WTFMove(sourceURL),
        WTFMove(bytecode),
        sourceType
    );

    // Register sourcemap if this is already bundled code
    if (source->flags.is_already_bundled) {
        auto specifier = source->source_url;
        Bun__addSourceProviderSourceMap(
            globalObject->bunVM(),
            provider.ptr(),
            const_cast<BunString*>(&specifier)
        );
    }

    return &provider.leakRef();
}

} // namespace Zig
