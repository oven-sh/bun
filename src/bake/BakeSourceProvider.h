#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/SourceOrigin.h"

namespace Bake {

class SourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<SourceProvider> create(
      const String& source,
      const JSC::SourceOrigin& sourceOrigin,
      String&& sourceURL,
      const TextPosition& startPosition,
      JSC::SourceProviderSourceType sourceType
    ) {
        return adoptRef(*new SourceProvider(source, sourceOrigin, WTFMove(sourceURL), startPosition, sourceType));
    }

private:
  SourceProvider(
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

} // namespace Bake
