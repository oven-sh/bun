#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"

namespace Bake {

class SourceProvider;

extern "C" void Bun__addBakeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, const BunString* specifier);

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
        auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(globalObject);
        auto provider = adoptRef(*new SourceProvider(zigGlobalObject->bunVM(), source, sourceOrigin, WTF::move(sourceURL), startPosition, sourceType));
        auto specifier = Bun::toString(provider->sourceURL());
        Bun__addBakeSourceProviderSourceMap(zigGlobalObject->bunVM(), provider.ptr(), &specifier);
        return provider;
    }

    // The Bun VM this provider was created in; its source-map lookups go through that VM's bake global rather than the
    // calling thread's (a stack trace can be remapped from the collector thread).
    void* bunVM() const { return m_bunVM; }

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

    void* m_bunVM;
};

} // namespace Bake
