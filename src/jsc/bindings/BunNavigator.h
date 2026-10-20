#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// The runtime's `navigator` and its class, with members that Node's has.
// A window of bun:dom has its own `Navigator`, with what a browser has besides: webcore/page/Navigator.h.
JSC::JSObject* createNavigatorConstructor(JSC::VM&, JSC::JSGlobalObject*);
JSC::JSObject* createNavigator(JSC::VM&, Zig::GlobalObject*);
JSC::JSObject* createNavigatorLanguages(JSC::VM&, JSC::JSGlobalObject*);

// Both classes answer with these.
WTF::String navigatorUserAgent();
WTF::ASCIILiteral navigatorPlatform();

} // namespace Bun
