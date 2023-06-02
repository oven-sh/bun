#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

// node:module
JSValue generateNodeModuleModule(JSC::JSGlobalObject *globalObject,
                                 JSC::Identifier moduleKey,
                                 Vector<JSC::Identifier, 4> &exportNames,
                                 JSC::MarkedArgumentBuffer &exportValues);

} // namespace Zig