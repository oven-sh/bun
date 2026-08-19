#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"

namespace Bake {

class SourceProvider;

extern "C" void Bun__addBakeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void Bun__removeBakeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);

class SourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<SourceProvider> create(
        JSC::JSGlobalObject* globalObject,
        const String& source,
        const JSC::SourceOrigin& sourceOrigin,
        String&& sourceURL,
        const TextPosition& startPosition,
        JSC::SourceProviderSourceType sourceType)
    {
        void* bunVM = uncheckedDowncast<Zig::GlobalObject>(globalObject)->bunVM();
        auto provider = adoptRef(*new SourceProvider(bunVM, source, sourceOrigin, WTF::move(sourceURL), startPosition, sourceType));
        auto specifier = Bun::toString(provider->sourceURL());
        Bun__addBakeSourceProviderSourceMap(bunVM, provider.ptr(), &specifier);
        return provider;
    }

private:
    SourceProvider(
        void* bunVM,
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
        , m_bunVM(bunVM)
    {
    }

    ~SourceProvider()
    {
        auto specifier = Bun::toString(sourceURL());
        Bun__removeBakeSourceProviderSourceMap(m_bunVM, this, &specifier);
    }

    // The Rust VirtualMachine rather than the Zig::GlobalObject: this
    // destructor runs from JSC's sweep, possibly after the global object cell
    // itself has been swept (see DevServerSourceProvider).
    void* m_bunVM;
};

} // namespace Bake
