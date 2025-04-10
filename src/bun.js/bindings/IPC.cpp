#include "root.h"
#include "headers-handwritten.h"
#include "BunBuiltinNames.h"
#include "JavaScriptCore/JSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "WebCoreJSBuiltins.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/Exception.h"

extern "C" JSC::EncodedJSValue IPCSerialize(JSC::JSGlobalObject* global, JSC::JSValue message, JSC::JSValue handle)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* serializeFunction = JSC::JSFunction::create(vm, global, WebCore::ipcSerializeCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(serializeFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(message);
    args.append(handle);

    auto result = JSC::call(global, serializeFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}
