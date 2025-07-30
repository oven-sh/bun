#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "ZigGlobalObject.h"

namespace Bake {

class DevServerSourceProvider;

// Function to be implemented in Zig to register the source provider
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, DevServerSourceProvider* opaque_source_provider, BunString* specifier);

class DevServerSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<DevServerSourceProvider> create(
        JSC::JSGlobalObject* globalObject,
        const String& source,
        const String& sourceMapJSON,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
    {
        auto provider = adoptRef(*new DevServerSourceProvider(source, sourceMapJSON, sourceOrigin, WTFMove(sourceURL), startPosition, sourceType));
        auto* zigGlobalObject = jsCast<::Zig::GlobalObject*>(globalObject);
        auto specifier = Bun::toString(provider->sourceURL());
        Bun__addDevServerSourceProvider(zigGlobalObject->bunVM(), provider.ptr(), &specifier);
        return provider;
    }

    // TODO: This should be ZigString so we can have a UTF-8 string and not need
    // to do conversions
    const String& sourceMapJSON() const { return m_sourceMapJSON; }

private:
    DevServerSourceProvider(
        const String& source,
        const String& sourceMapJSON,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
        : StringSourceProvider(
              source,
              sourceOrigin,
              JSC::SourceTaintedOrigin::Untainted,
              WTFMove(sourceURL),
              startPosition,
              sourceType)
        , m_sourceMapJSON(sourceMapJSON)
    {
    }

    String m_sourceMapJSON;
};

} // namespace Bake
