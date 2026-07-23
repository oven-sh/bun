#include "root.h"
#include "headers-handwritten.h"
#include "BunBuiltinNames.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue IPCSerialize(Zig::GlobalObject* global, JSC::EncodedJSValue message, JSC::EncodedJSValue handle)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* serializeFunction = global->m_ipcSerializeFunction.getInitializedOnMainThread(global);
    JSC::CallData callData = JSC::getCallData(serializeFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(message));
    args.append(JSC::JSValue::decode(handle));

    auto result = JSC::call(global, serializeFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue IPCParse(Zig::GlobalObject* global, JSC::EncodedJSValue target, JSC::EncodedJSValue serialized, JSC::EncodedJSValue fd)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* parseFunction = global->m_ipcParseHandleFunction.getInitializedOnMainThread(global);
    JSC::CallData callData = JSC::getCallData(parseFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(target));
    args.append(JSC::JSValue::decode(serialized));
    args.append(JSC::JSValue::decode(fd));

    auto result = JSC::call(global, parseFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue IPCTagAdvancedBuffers(Zig::GlobalObject* global, JSC::EncodedJSValue message)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* tagFunction = global->m_ipcTagAdvancedBuffersFunction.getInitializedOnMainThread(global);
    JSC::CallData callData = JSC::getCallData(tagFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(message));

    auto result = JSC::call(global, tagFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue IPCRestoreAdvancedBuffers(Zig::GlobalObject* global, JSC::EncodedJSValue envelope)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* restoreFunction = global->m_ipcRestoreAdvancedBuffersFunction.getInitializedOnMainThread(global);
    JSC::CallData callData = JSC::getCallData(restoreFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(envelope));

    auto result = JSC::call(global, restoreFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}
