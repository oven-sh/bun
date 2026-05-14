#pragma once

#include "root.h"

namespace Rust {
class GlobalObject;
}

namespace WebCore {

// Function to create a unified MIME binding object
JSC::JSValue createMIMEBinding(Rust::GlobalObject* globalObject);

} // namespace WebCore
