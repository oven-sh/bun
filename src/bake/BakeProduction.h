#include "root.h"
#include "headers-handwritten.h"

namespace JSC {
class JSGlobalObject;
class JSPromise;
class JSValue;
} // namespace JSC

namespace Bake {

extern "C" JSC::JSPromise* BakeRenderRoutesForProdStatic(
    JSC::JSGlobalObject* global,
    BunString outBase,
    JSC::JSValue allServerFiles,
    JSC::JSValue renderStatic,
    JSC::JSValue getParams,
    JSC::JSValue clientEntryUrl,
    JSC::JSValue routerTypeRoots,
    JSC::JSValue routerTypeServerEntrypoints,
    JSC::JSValue serverRuntime,
    JSC::JSValue pattern,
    JSC::JSValue files,
    JSC::JSValue typeAndFlags,
    JSC::JSValue sourceRouteFiles,
    JSC::JSValue paramInformation,
    JSC::JSValue styles);

} // namespace Bake
