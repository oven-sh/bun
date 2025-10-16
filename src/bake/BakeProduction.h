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
    JSC::EncodedJSValue allServerFiles,
    JSC::EncodedJSValue renderStatic,
    JSC::EncodedJSValue getParams,
    JSC::EncodedJSValue clientEntryUrl,
    JSC::EncodedJSValue routerTypeRoots,
    JSC::EncodedJSValue routerTypeServerEntrypoints,
    JSC::EncodedJSValue serverRuntime,
    JSC::EncodedJSValue pattern,
    JSC::EncodedJSValue files,
    JSC::EncodedJSValue typeAndFlags,
    JSC::EncodedJSValue sourceRouteFiles,
    JSC::EncodedJSValue paramInformation,
    JSC::EncodedJSValue styles,
    JSC::EncodedJSValue routeIndices);

} // namespace Bake
