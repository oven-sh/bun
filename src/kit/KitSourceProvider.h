#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "KitDevGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"

namespace Kit {

struct LoadServerCodeResult {
  JSC::JSInternalPromise* promise;
  JSC::JSString* key;
};

class KitSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<KitSourceProvider> create(
      const String& source,
      const JSC::SourceOrigin& sourceOrigin,
      String&& sourceURL,
      const TextPosition& startPosition,
      JSC::SourceProviderSourceType sourceType
    ) {
        return adoptRef(*new KitSourceProvider(source, sourceOrigin, WTFMove(sourceURL), startPosition, sourceType));
    }

private:
  KitSourceProvider(
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

extern "C" LoadServerCodeResult KitLoadServerCode(DevGlobalObject* global, BunString source);
extern "C" JSC::EncodedJSValue KitGetRequestHandlerFromModule(DevGlobalObject* global, JSC::JSString* encodedModule);

} // namespace Kit
