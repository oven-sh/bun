#pragma once

#include "root.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>

namespace Bun {

JSC::JSObject* createClipboardObject(JSC::JSGlobalObject* lexicalGlobalObject);

} // namespace Bun