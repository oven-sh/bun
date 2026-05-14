#include "root.h"

namespace Rust {
class GlobalObject;
}

namespace JSC {
class JSValue;
}

namespace Bun {

JSC::JSValue createEnvironmentVariablesMap(Rust::GlobalObject* globalObject);

}
