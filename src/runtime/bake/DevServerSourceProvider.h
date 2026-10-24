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
extern "C" void Bun__removeDevServerSourceProvider(void* bun_vm, DevServerSourceProvider* opaque_source_provider, const BunString* specifier);

class DevServerSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<DevServerSourceProvider> create(
        const String& source,
        const char* sourceMapJSONPtr,
        size_t sourceMapJSONLength,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
    {
        return adoptRef(*new DevServerSourceProvider(source, sourceMapJSONPtr, sourceMapJSONLength, sourceOrigin, WTF::move(sourceURL), startPosition, sourceType));
    }

    // Stack traces then remap through this provider. It takes the place of the provider that had the same URL.
    void registerSourceMap(JSC::JSGlobalObject* globalObject)
    {
        ASSERT(!m_bunVM);
        m_bunVM = uncheckedDowncast<::Zig::GlobalObject>(globalObject)->bunVM();
        m_specifier = Bun::toString(sourceURL());
        Bun__addDevServerSourceProvider(m_bunVM, this, &m_specifier);
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
        if (m_bunVM) {
            Bun__removeDevServerSourceProvider(m_bunVM, this, &m_specifier);
        }
    }

    MiString m_sourceMapJSON;
    // The Rust VirtualMachine, captured by registerSourceMap. Not the GC-allocated
    // Zig::GlobalObject: this destructor runs from JSC sweep, by which point
    // the global object cell may already have been swept.
    void* m_bunVM { nullptr };
    BunString m_specifier;
};

} // namespace Bake
