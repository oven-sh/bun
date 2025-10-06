#include "BakeProduction.h"
#include "BunBuiltinNames.h"
#include "JavaScriptCore/CallData.h"
#include "WebCoreJSBuiltins.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/Exception.h"

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
    JSC::EncodedJSValue routeIndices)
{
    auto& vm = JSC::getVM(global);
    JSC::JSFunction* cb = JSC::JSFunction::create(vm, global, WebCore::bakeRenderRoutesForProdStaticCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(cb);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsString(vm, outBase.toWTFString()));
    args.append(JSC::JSValue::decode(allServerFiles));
    args.append(JSC::JSValue::decode(renderStatic));
    args.append(JSC::JSValue::decode(getParams));
    args.append(JSC::JSValue::decode(clientEntryUrl));
    args.append(JSC::JSValue::decode(routerTypeRoots));
    args.append(JSC::JSValue::decode(routerTypeServerEntrypoints));
    args.append(JSC::JSValue::decode(serverRuntime));
    args.append(JSC::JSValue::decode(pattern));
    args.append(JSC::JSValue::decode(files));
    args.append(JSC::JSValue::decode(typeAndFlags));
    args.append(JSC::JSValue::decode(sourceRouteFiles));
    args.append(JSC::JSValue::decode(paramInformation));
    args.append(JSC::JSValue::decode(styles));
    args.append(JSC::JSValue::decode(routeIndices));

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(global, JSC::ProfilingReason::API, cb, callData, JSC::jsUndefined(), args, returnedException);
    if (returnedException) [[unlikely]] {
        // This should be impossible because it returns a promise.
        return JSC::JSPromise::rejectedPromise(global, returnedException->value());
    }
    return JSC::jsCast<JSC::JSPromise*>(result);
}

} // namespace Bake
