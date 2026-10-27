#pragma once

#include "root.h"

namespace Bun {

// Each makes a new function from JavaScriptCore's own table entry: a built-in module loads after a script may have replaced `Date` or its methods.
JSC::JSValue createDateNow(JSC::JSGlobalObject*);
JSC::JSValue createDatePrototypeGetTime(JSC::JSGlobalObject*);
JSC::JSValue createDatePrototypeToISOString(JSC::JSGlobalObject*);
JSC::JSValue createDatePrototypeToString(JSC::JSGlobalObject*);

} // namespace Bun
