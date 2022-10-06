#pragma once

#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCode(JSC::JSGlobalObject *globalObject,
                               JSC::JSObject *object);

} // namespace Zig