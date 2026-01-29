#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"

namespace Bake {

class SourceProvider;

extern "C" void Bun__addBakeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);

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
        auto provider = adoptRef(*new SourceProvider(source, sourceOrigin, WTF::move(sourceURL), startPosition, sourceType));
        auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
        auto specifier = Bun::toString(provider->sourceURL());
        Bun__addBakeSourceProviderSourceMap(zigGlobalObject->bunVM(), provider.ptr(), &specifier);
        return provider;
    }

private:
    SourceProvider(
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
};

} // namespace Bake
