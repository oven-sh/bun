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
    JSC::JSValue files,
    JSC::JSValue patterns
) {
    JSC::VM& vm = global->vm();
    JSC::JSFunction* cb = JSC::JSFunction::create(vm, global, WebCore::bakeRenderRoutesForProdCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(cb);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsString(vm, outbase.toWTFString()));
    args.append(renderStaticCallback);
    args.append(files);
    args.append(patterns);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(global, cb, callData, JSC::jsUndefined(), args, returnedException);
    if (returnedException) {
        BUN_PANIC("bakeRenderRoutesForProd threw an exception. This should be impossible because it returns a promise.");
    }
    return JSC::jsCast<JSC::JSPromise*>(result);
}

} // namespace Bake