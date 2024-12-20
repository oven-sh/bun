#include "BindgenNodeErrors.h"
#include "ErrorCode.h"

JSC::EncodedJSValue throwNodeInvalidArgTypeErrorForBindgen(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::ASCIILiteral& arg_name, const WTF::ASCIILiteral& expected_type, JSC::JSValue val_actual_value)
{
    auto actual_value = Bun::JSValueToStringSafe(globalObject, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The "_s, arg_name, " must be "_s, expected_type, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}

JSC::EncodedJSValue throwNodeInvalidArgValueErrorForBindgen(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::ASCIILiteral& arg_name, const WTF::ASCIILiteral& expected_type, JSC::JSValue val_actual_value)
{
    auto actual_value = Bun::JSValueToStringSafe(globalObject, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The "_s, arg_name, " must be "_s, expected_type, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}
