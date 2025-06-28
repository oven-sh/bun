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
    JSC::JSValue allServerFiles,
    JSC::JSValue renderStatic,
    JSC::JSValue getParams,
    JSC::JSValue clientEntryUrl,
    JSC::JSValue pattern,
    JSC::JSValue files,
    JSC::JSValue typeAndFlags,
    JSC::JSValue sourceRouteFiles,
    JSC::JSValue paramInformation,
    JSC::JSValue styles)
{
    auto& vm = JSC::getVM(global);
    JSC::JSFunction* cb = JSC::JSFunction::create(vm, global, WebCore::bakeRenderRoutesForProdStaticCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(cb);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsString(vm, outBase.toWTFString()));
    args.append(allServerFiles);
    args.append(renderStatic);
    args.append(getParams);
    args.append(clientEntryUrl);
    args.append(pattern);
    args.append(files);
    args.append(typeAndFlags);
    args.append(sourceRouteFiles);
    args.append(paramInformation);
    args.append(styles);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(global, JSC::ProfilingReason::API, cb, callData, JSC::jsUndefined(), args, returnedException);
    if (returnedException) [[unlikely]] {
        // This should be impossible because it returns a promise.
        return JSC::JSPromise::rejectedPromise(global, returnedException->value());
    }
    return JSC::jsCast<JSC::JSPromise*>(result);
}

} // namespace Bake
