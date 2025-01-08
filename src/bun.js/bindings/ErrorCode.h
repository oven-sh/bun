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

JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_INVALID_PROTOCOL);
JSC_DECLARE_HOST_FUNCTION(jsFunctionMakeErrorWithCode);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_BROTLI_INVALID_PARAM);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_BUFFER_TOO_LARGE);
JSC_DECLARE_HOST_FUNCTION(jsFunction_ERR_UNHANDLED_ERROR);

enum Bound {
    LOWER,
    UPPER,
};

namespace ERR {

JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value);
JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, double lower, double upper, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name, double lower, double upper, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, double bound_num, Bound bound, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, const WTF::String& msg, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name_val, const WTF::String& msg, JSC::JSValue actual);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue INVALID_ARG_VALUE_RangeError(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue UNKNOWN_ENCODING(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView encoding);
JSC::EncodedJSValue INVALID_STATE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& statemsg);
JSC::EncodedJSValue STRING_TOO_LONG(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue BUFFER_OUT_OF_BOUNDS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue UNKNOWN_SIGNAL(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue signal, bool triedUppercase = false);
JSC::EncodedJSValue SOCKET_BAD_PORT(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue port, bool allowZero);
JSC::EncodedJSValue UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue ASSERTION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue msg);
JSC::EncodedJSValue ASSERTION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral msg);

}

}
