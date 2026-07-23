#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

JSC::JSValue createNodeURLBinding(Zig::GlobalObject*);

/// Undoes punycode encoding. Returns a null string when `domain` is not a valid IDN.
WTF::String domainToUnicode(const WTF::String& domain);

} // namespace Bun
