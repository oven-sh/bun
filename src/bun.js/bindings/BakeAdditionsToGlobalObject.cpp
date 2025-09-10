#include "BakeAdditionsToGlobalObject.h"
#include "JSBakeResponse.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "ErrorCode.h"

namespace Bun {


extern "C" JSC::EncodedJSValue Bake__getAsyncLocalStorage(JSC::JSGlobalObject* globalObject) {
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto value = zig->bakeAdditions().getAsyncLocalStorage(zig);
    return JSValue::encode(value);
}

extern "C" JSC::EncodedJSValue Bake__getEnsureAsyncLocalStorageInstanceJSFunction(JSC::JSGlobalObject* globalObject) {
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(zig->bakeAdditions().ensureAsyncLocalStorageInstanceJSFunction(globalObject));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeGetAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe)) {
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(zig->bakeAdditions().getAsyncLocalStorage(zig));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeEnsureAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe)) {
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    if (callframe->argumentCount() < 1) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "bakeEnsureAsyncLocalStorage requires at least one argument"_s);
        return {};
    }
    zig->bakeAdditions().ensureAsyncLocalStorageInstance(zig, callframe->argument(0));
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
