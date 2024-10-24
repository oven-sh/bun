#include "root.h"
#include "headers-handwritten.h"

namespace Bake {

extern "C" JSC::JSPromise* BakeRenderRoutesForProd(JSC::JSGlobalObject*, BunString, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);

} // namespace Bake