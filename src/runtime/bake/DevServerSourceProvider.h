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
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
    {
        return adoptRef(*new DevServerSourceProvider(source, sourceOrigin, WTF::move(sourceURL), startPosition, sourceType));
    }

    // Takes ownership of the JSON and registers this provider for stack trace remapping. Registering replaces the
    // provider that holds the URL, so call this once the source has loaded.
    void attachSourceMap(JSC::JSGlobalObject* globalObject, const char* sourceMapJSONPtr, size_t sourceMapJSONLength)
    {
        ASSERT(!m_bunVM);
        m_sourceMapJSON = MiString(sourceMapJSONPtr, sourceMapJSONLength);
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
    {
    }

    ~DevServerSourceProvider()
    {
        if (m_bunVM) {
            Bun__removeDevServerSourceProvider(m_bunVM, this, &m_specifier);
        }
    }

    MiString m_sourceMapJSON { nullptr, 0 };
    // The Rust VirtualMachine, captured by attachSourceMap. Not the GC-allocated
    // Zig::GlobalObject: this destructor runs from JSC sweep, by which point
    // the global object cell may already have been swept.
    void* m_bunVM { nullptr };
    BunString m_specifier;
};

} // namespace Bake
