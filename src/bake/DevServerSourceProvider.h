#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "ZigGlobalObject.h"
#include "MiString.h"

namespace Bake {

class DevServerSourceProvider;

// Function to be implemented in Zig to register the source provider
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, DevServerSourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void Bun__removeDevServerSourceProvider(void* bun_vm, DevServerSourceProvider* opaque_source_provider, BunString* specifier);

class DevServerSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<DevServerSourceProvider> create(
        JSC::JSGlobalObject* globalObject,
        const String& source,
        const char* sourceMapJSONPtr,
        size_t sourceMapJSONLength,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
    {
        auto provider = adoptRef(*new DevServerSourceProvider(source, sourceMapJSONPtr, sourceMapJSONLength, sourceOrigin, WTF::move(sourceURL), startPosition, sourceType));
        auto* zigGlobalObject = jsCast<::Zig::GlobalObject*>(globalObject);
        auto specifier = Bun::toString(provider->sourceURL());
        provider->m_globalObject = zigGlobalObject;
        provider->m_specifier = specifier;
        Bun__addDevServerSourceProvider(zigGlobalObject->bunVM(), provider.ptr(), &specifier);
        return provider;
    }

    MiCString sourceMapJSON() const
    {
        return m_sourceMapJSON.asCString();
    }

private:
    DevServerSourceProvider(
        const String& source,
        const char* sourceMapJSONPtr,
        size_t sourceMapJSONLength,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
        : StringSourceProvider(
              source,
              sourceOrigin,
              JSC::SourceTaintedOrigin::Untainted,
              WTF::move(sourceURL),
              startPosition,
              sourceType)
        , m_sourceMapJSON(sourceMapJSONPtr, sourceMapJSONLength)
    {
    }

    ~DevServerSourceProvider()
    {
        if (m_globalObject) {
            Bun__removeDevServerSourceProvider(m_globalObject->bunVM(), this, &m_specifier);
        }
    }

    MiString m_sourceMapJSON;
    Zig::GlobalObject* m_globalObject;
    BunString m_specifier;
};

} // namespace Bake
