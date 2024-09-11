#pragma once

#include "ZigGlobalObject.h"
#include "root.h"
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
JSC_DECLARE_HOST_FUNCTION(jsFunctionMakeErrorWithCode);

}
