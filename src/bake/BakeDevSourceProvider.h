#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BakeDevGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"

namespace Bake {

struct LoadServerCodeResult {
  JSC::JSInternalPromise* promise;
  JSC::JSString* key;
};

class DevSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<DevSourceProvider> create(
      const String& source,
      const JSC::SourceOrigin& sourceOrigin,
      String&& sourceURL,
      const TextPosition& startPosition,
      JSC::SourceProviderSourceType sourceType
    ) {
        return adoptRef(*new DevSourceProvider(source, sourceOrigin, WTFMove(sourceURL), startPosition, sourceType));
    }

private:
  DevSourceProvider(
    const String& source,
    const JSC::SourceOrigin& sourceOrigin,
    String&& sourceURL,
    const TextPosition& startPosition,
    JSC::SourceProviderSourceType sourceType
  ) : StringSourceProvider(
    source, 
    sourceOrigin, 
    JSC::SourceTaintedOrigin::Untainted,
    WTFMove(sourceURL),
    startPosition,
    sourceType
  ) {}
};

// Zig API
extern "C" LoadServerCodeResult BakeLoadInitialServerCode(DevGlobalObject* global, BunString source);
extern "C" JSC::EncodedJSValue BakeLoadServerHmrPatch(DevGlobalObject* global, BunString source);
extern "C" JSC::EncodedJSValue BakeGetRequestHandlerFromModule(DevGlobalObject* global, JSC::JSString* encodedModule);

} // namespace Bake
