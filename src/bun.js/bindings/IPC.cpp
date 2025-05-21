#include "root.h"
#include "headers-handwritten.h"
#include "BunBuiltinNames.h"
#include "WebCoreJSBuiltins.h"

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

extern "C" JSC::EncodedJSValue IPCParse(JSC::JSGlobalObject* global, JSC::JSValue target, JSC::JSValue serialized, JSC::JSValue fd)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* parseFunction = JSC::JSFunction::create(vm, global, WebCore::ipcParseHandleCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(parseFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(target);
    args.append(serialized);
    args.append(fd);

    auto result = JSC::call(global, parseFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}
