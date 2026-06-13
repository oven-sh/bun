#include "root.h"

namespace Bun {
class GlobalObject;
}

namespace JSC {
class JSValue;
}

namespace Bun {

JSC::JSValue createEnvironmentVariablesMap(Bun::GlobalObject* globalObject);

}
