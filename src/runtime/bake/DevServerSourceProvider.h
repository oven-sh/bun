#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "ZigGlobalObject.h"
#include "MiString.h"

namespace Bake {

class DevServerSourceProvider;

// Implemented on the Rust side to register the source provider.
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, DevServerSourceProvider* opaque_source_provider, const BunString* specifier);

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
        auto* zigGlobalObject = uncheckedDowncast<::Zig::GlobalObject>(globalObject);
        provider->m_sourceMap = Bun::SourceMapRegistration::lazy(Bun__addDevServerSourceProvider, zigGlobalObject->bunVM(), provider.get());
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

    MiString m_sourceMapJSON;
    // Holds the Rust VirtualMachine: JSC's sweep destroys this, and can have swept the Zig::GlobalObject cell before.
    Bun::SourceMapRegistration m_sourceMap;
};

} // namespace Bake
