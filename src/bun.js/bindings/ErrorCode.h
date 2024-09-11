#pragma once

#include "root.h"
#include "JavaScriptCore/ThrowScope.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include "BunClientData.h"
#include "ErrorCode+List.h"

namespace Bun {

class ErrorCodeCache : public JSC::JSInternalFieldObjectImpl<NODE_ERROR_COUNT> {
public:
    using Base = JSInternalFieldObjectImpl<NODE_ERROR_COUNT>;
    using Field = ErrorCode;

    DECLARE_EXPORT_INFO;

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(ErrorCodeCache);
    }

    template<typename, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<ErrorCodeCache, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForErrorCodeCache.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForErrorCodeCache = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForErrorCodeCache.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForErrorCodeCache = std::forward<decltype(space)>(space); });
    }

    static ErrorCodeCache* create(VM& vm, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

    JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options);

private:
    JS_EXPORT_PRIVATE ErrorCodeCache(VM&, Structure*);
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);
    void finishCreation(VM&);
};

JSC::EncodedJSValue throwError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, ErrorCode code, const WTF::String& message);
JSC::JSObject* createError(Zig::GlobalObject* globalObject, ErrorCode code, const WTF::String& message);
JSC::JSObject* createError(JSC::JSGlobalObject* globalObject, ErrorCode code, const WTF::String& message);
JSC::JSObject* createError(Zig::GlobalObject* globalObject, ErrorCode code, JSC::JSValue message);
JSC::JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options = jsUndefined());
JSC::JSValue toJS(JSC::JSGlobalObject*, ErrorCode);
JSObject* createInvalidThisError(JSGlobalObject* globalObject, JSValue thisValue, const ASCIILiteral typeName);
JSObject* createInvalidThisError(JSGlobalObject* globalObject, const String& message);

JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_INVALID_ARG_TYPE);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_IPC_DISCONNECTED);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_SERVER_NOT_RUNNING);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_IPC_CHANNEL_CLOSED);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_SOCKET_BAD_TYPE);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_INVALID_PROTOCOL);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_BUFFER_OUT_OF_BOUNDS);
JSC_DECLARE_HOST_FUNCTION(jsFunctionMakeErrorWithCode);

extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue val_arg_name, JSC::EncodedJSValue val_expected_type, JSC::EncodedJSValue val_actual_value);
extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE_static(JSC::JSGlobalObject* globalObject, const ZigString* val_arg_name, const ZigString* val_expected_type, JSC::EncodedJSValue val_actual_value);
extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3);
extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS_static(JSC::JSGlobalObject* globalObject, const ZigString* arg1, const ZigString* arg2, const ZigString* arg3);

namespace ERR {

JSC::JSValue INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, ASCIILiteral val_arg_name, ASCIILiteral val_expected_type, JSC::JSValue val_actual_value, bool instance = false);
JSC::JSValue OUT_OF_RANGE(JSC::JSGlobalObject* globalObject, ASCIILiteral arg_name, size_t lower, size_t upper, JSC::JSValue actual);
JSC::JSValue INVALID_ARG_VALUE(JSC::JSGlobalObject* globalObject, ASCIILiteral name, JSC::JSValue value, ASCIILiteral reason = "is invalid"_s);
JSC::JSValue UNKNOWN_ENCODING(JSC::JSGlobalObject* globalObject, JSC::JSValue encoding);
JSC::JSValue INVALID_STATE(JSC::JSGlobalObject* globalObject, ASCIILiteral statemsg);
JSC::JSValue STRING_TOO_LONG(JSC::JSGlobalObject* globalObject);
JSC::JSValue IPC_CHANNEL_CLOSED(JSC::JSGlobalObject* globalObject);

JSC::JSValue throw_INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral val_arg_name, ASCIILiteral val_expected_type, JSC::JSValue val_actual_value, bool instance = false);
JSC::JSValue throw_OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral arg_name, size_t lower, size_t upper, JSC::JSValue actual);
JSC::JSValue throw_INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral name, JSC::JSValue value, ASCIILiteral reason = "is invalid"_s);
JSC::JSValue throw_UNKNOWN_ENCODING(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue encoding);
JSC::JSValue throw_INVALID_STATE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral statemsg);
JSC::JSValue throw_STRING_TOO_LONG(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
// throw_IPC_CHANNEL_CLOSED

}

}
