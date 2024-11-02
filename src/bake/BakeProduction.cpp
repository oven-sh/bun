#include "BakeProduction.h"
#include "BunBuiltinNames.h"
#include "WebCoreJSBuiltins.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/Exception.h"

namespace Bake {

extern "C" JSC::JSPromise* BakeRenderRoutesForProd(
    JSC::JSGlobalObject* global,
    BunString outbase,
    JSC::JSValue renderStaticCallback,
    JSC::JSValue clientEntryUrl,
    JSC::JSValue files,
    JSC::JSValue patterns,
    JSC::JSValue styles)
{
    JSC::VM& vm = global->vm();
    JSC::JSFunction* cb = JSC::JSFunction::create(vm, global, WebCore::bakeRenderRoutesForProdCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(cb);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsString(vm, outbase.toWTFString()));
    args.append(renderStaticCallback);
    args.append(clientEntryUrl);
    args.append(files);
    args.append(patterns);
    args.append(styles);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(global, cb, callData, JSC::jsUndefined(), args, returnedException);
    if (UNLIKELY(returnedException)) {
        // This should be impossible because it returns a promise.
        return JSC::JSPromise::rejectedPromise(global, returnedException->value());
    }
    return JSC::jsCast<JSC::JSPromise*>(result);
}

} // namespace Bake
