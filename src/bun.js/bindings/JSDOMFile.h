#pragma once

#include "root.h"

namespace Bun {
JSC::JSObject* createJSDOMFileConstructor(JSC::VM&, JSC::JSGlobalObject*);
JSC::Structure* createJSDOMFileInstanceStructure(JSC::VM&, JSC::JSGlobalObject*);
}
