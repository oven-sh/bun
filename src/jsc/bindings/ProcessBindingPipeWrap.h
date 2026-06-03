#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

JSC::JSValue createNodePipeWrapObject(JSC::JSGlobalObject* globalObject);

}
