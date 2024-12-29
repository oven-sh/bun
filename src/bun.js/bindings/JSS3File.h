#pragma once

#include "root.h"

namespace Bun {
JSC::JSObject* createJSS3FileConstructor(JSC::VM&, JSC::JSGlobalObject*);
JSC::JSObject* createJSS3FileStaticObject(JSC::VM&, JSC::JSGlobalObject*);
}
