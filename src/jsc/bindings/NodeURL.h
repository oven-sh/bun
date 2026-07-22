#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

JSC::JSValue createNodeURLBinding(Zig::GlobalObject*);
JSC::JSValue createNodeICUBinding(Zig::GlobalObject*);

// True when every xn-- label in `host` is valid UTS #46 punycode.
bool hasValidPunycodeHost(WTF::StringView host);

} // namespace Bun
