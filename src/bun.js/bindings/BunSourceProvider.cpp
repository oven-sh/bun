#include "BunSourceProvider.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "wtf/text/WTFString.h"

namespace Bun {

SourceProvider::SourceProvider(
    JSC::JSGlobalObject* globalObject,
    const String& source,
    const JSC::SourceOrigin& sourceOrigin,
    String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& cachedBytecode,
    const TextPosition& startPosition,
    JSC::SourceProviderSourceType sourceType)
    : StringSourceProvider(
          source,
          sourceOrigin,
          JSC::SourceTaintedOrigin::Untainted,
          WTFMove(sourceURL),
          startPosition,
          sourceType)
    , m_cachedBytecode(WTFMove(cachedBytecode))
    , m_globalObject(globalObject)
    , m_hash(0)
{
    // Compute hash for the source
    m_hash = source.impl()->hash();

    // Register the source map with the Bun VM
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(m_globalObject);
    auto specifier = Bun::toString(this->sourceURL());
    Bun__addSourceProviderSourceMap(zigGlobalObject->bunVM(), this, &specifier);
}

SourceProvider::~SourceProvider()
{
    // Cleanup is automatic via RefPtr
}

Ref<SourceProvider> SourceProvider::create(
    JSC::JSGlobalObject* globalObject,
    const String& source,
    const JSC::SourceOrigin& sourceOrigin,
    String&& sourceURL,
    RefPtr<JSC::CachedBytecode>&& cachedBytecode,
    const TextPosition& startPosition,
    JSC::SourceProviderSourceType sourceType)
{
    return adoptRef(*new SourceProvider(
        globalObject,
        source,
        sourceOrigin,
        WTFMove(sourceURL),
        WTFMove(cachedBytecode),
        startPosition,
        sourceType));
}

} // namespace Bun

/**
 * C bridge function to create a SourceProvider from Zig
 *
 * This is the main entry point from Zig code to create a C++ SourceProvider.
 * It takes ownership of the strings in the TranspiledSource struct.
 */
extern "C" Bun::SourceProvider* Bun__createSourceProvider(
    JSC::JSGlobalObject* globalObject,
    TranspiledSource* transpiled)
{
    // Convert Bun strings to WTF strings
    WTF::String source = transpiled->source_code.toWTFString(BunString::ZeroCopy);
    WTF::String sourceURL = transpiled->source_url.toWTFString(BunString::ZeroCopy);

    // Handle bytecode cache if present
    RefPtr<JSC::CachedBytecode> cachedBytecode = nullptr;
    if (transpiled->bytecode_cache != nullptr && transpiled->bytecode_cache_len > 0) {
        // For now, skip bytecode cache - it requires FileSystem::MappedFileData
        // TODO: Implement bytecode caching properly
        cachedBytecode = nullptr;
    }

    // Create the source origin from the source URL
    JSC::SourceOrigin sourceOrigin(WTF::URL(WTF::URL(), sourceURL));

    // Determine source type based on flags
    JSC::SourceProviderSourceType sourceType = transpiled->flags.is_commonjs
        ? JSC::SourceProviderSourceType::Program
        : JSC::SourceProviderSourceType::Module;

    // Create the SourceProvider
    auto provider = Bun::SourceProvider::create(
        globalObject,
        source,
        sourceOrigin,
        WTFMove(sourceURL),
        WTFMove(cachedBytecode),
        TextPosition(),
        sourceType);

    // Leak the ref for C ownership (caller must manage)
    return &provider.leakRef();
}
