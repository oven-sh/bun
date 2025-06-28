#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace WebCore {

// Function to create a unified MIME binding object
JSC::JSValue createMIMEBinding(Zig::GlobalObject* globalObject);

} // namespace WebCore
