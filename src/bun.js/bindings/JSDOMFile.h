#pragma once

#include "root.h"

namespace Bun {
JSC::JSObject* createJSDOMFileConstructor(JSC::VM&, JSC::JSGlobalObject*);
JSC::Structure* createJSFileStructure(JSC::VM&, JSC::JSGlobalObject*);
}
