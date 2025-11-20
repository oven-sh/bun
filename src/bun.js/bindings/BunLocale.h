#pragma once

#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
}

namespace Bun {

WTF::String defaultLanguage(JSC::JSGlobalObject*);

} // namespace Bun

