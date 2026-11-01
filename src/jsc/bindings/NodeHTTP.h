#include "config.h"

namespace Bun {

JSC::Structure* createNodeHTTPServerSocketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
JSC::JSValue createNodeHTTPInternalBinding(Zig::GlobalObject*);

}
