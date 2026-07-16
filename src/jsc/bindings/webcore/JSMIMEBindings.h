#pragma once

#include "root.h"

namespace Bun {
class GlobalObject;
}

namespace WebCore {

// Function to create a unified MIME binding object
JSC::JSValue createMIMEBinding(Bun::GlobalObject* globalObject);

} // namespace WebCore
