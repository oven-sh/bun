// To add a new error code, put it in ErrorCode.ts
#pragma once

#include "ZigGlobalObject.h"
#include "root.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include "BunClientData.h"
#include "ErrorCode+List.h"
#include "CryptoKeyType.h"

#define RELEASE_RETURN_IF_EXCEPTION(scope__, value__)                                                              \
    do {                                                                                                           \
        SUPPRESS_UNCOUNTED_LOCAL JSC::VM& vm = (scope__).vm();                                                     \
        EXCEPTION_ASSERT(!!(scope__).exception() == vm.traps().needHandling(JSC::VMTraps::NeedExceptionHandling)); \
        if (vm.traps().maybeNeedHandling()) [[unlikely]] {                                                         \
            if (vm.hasExceptionsAfterHandlingTraps()) {                                                            \
                scope__.release();                                                                                 \
                return value__;                                                                                    \
            }                                                                                                      \
        }                                                                                                          \
    } while (false)

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
JSC::JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options);
JSC::JSValue toJS(JSC::JSGlobalObject*, ErrorCode);
JSObject* createInvalidThisError(JSGlobalObject* globalObject, JSValue thisValue, const ASCIILiteral typeName);
JSObject* createInvalidThisError(JSGlobalObject* globalObject, const String& message);

JSC_DECLARE_HOST_FUNCTION(jsFunctionMakeErrorWithCode);

enum Bound {
    LOWER,
    UPPER,
};

namespace ERR {

JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message);
JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value);
JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value);
JSC::EncodedJSValue INVALID_ARG_INSTANCE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value);
JSC::EncodedJSValue INVALID_ARG_TYPE_INSTANCE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral arg_name, WTF::ASCIILiteral expected_type, WTF::ASCIILiteral expected_instance_types, JSC::JSValue val_actual_value);
JSC::EncodedJSValue INVALID_ARG_TYPE_INSTANCE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral arg_name, WTF::ASCIILiteral expected_instance_types, JSC::JSValue val_actual_value);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, double lower, double upper, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name, double lower, double upper, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, double bound_num, Bound bound, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, const WTF::String& msg, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name_val, const WTF::String& msg, JSC::JSValue actual);
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, WTF::ASCIILiteral reason, JSC::JSArray* oneOf);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, WTF::ASCIILiteral reason, JSC::JSValue value, std::span<const ASCIILiteral> oneOf);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, WTF::ASCIILiteral reason, JSC::JSValue value, std::span<const int32_t> oneOf);
JSC::EncodedJSValue INVALID_ARG_VALUE_RangeError(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& name, JSC::JSValue value, const WTF::String& reason = "is invalid"_s);
JSC::EncodedJSValue UNKNOWN_ENCODING(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView encoding);
JSC::EncodedJSValue UNKNOWN_ENCODING(JSC::ThrowScope&, JSC::JSGlobalObject*, JSValue encodingValue);
JSC::EncodedJSValue INVALID_STATE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& statemsg);
JSC::EncodedJSValue STRING_TOO_LONG(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue BUFFER_OUT_OF_BOUNDS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral name);
JSC::EncodedJSValue UNKNOWN_SIGNAL(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue signal, bool triedUppercase = false);
JSC::EncodedJSValue MISSING_ARGS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message);
JSC::EncodedJSValue SOCKET_BAD_PORT(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue port, bool allowZero);
JSC::EncodedJSValue UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue ASSERTION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue msg);
JSC::EncodedJSValue ASSERTION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral msg);
JSC::EncodedJSValue CRYPTO_INVALID_CURVE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue CRYPTO_OPERATION_FAILED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message);
JSC::EncodedJSValue CRYPTO_INVALID_KEYPAIR(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue CRYPTO_ECDH_INVALID_PUBLIC_KEY(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue CRYPTO_ECDH_INVALID_FORMAT(JSC::ThrowScope&, JSC::JSGlobalObject*, const WTF::String& formatString);
JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_CURVE(JSC::ThrowScope&, JSC::JSGlobalObject*, const WTF::String&);
JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_CURVE(JSC::ThrowScope&, JSC::JSGlobalObject*, ASCIILiteral message, const char* curveName);
JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_KEY_TYPE(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_INVALID_JWK(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue CRYPTO_INVALID_JWK(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message);
JSC::EncodedJSValue CRYPTO_SIGN_KEY_REQUIRED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue CRYPTO_INVALID_KEY_OBJECT_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSValue received, WTF::ASCIILiteral expected);
JSC::EncodedJSValue CRYPTO_INVALID_KEY_OBJECT_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, CryptoKeyType receivedType, WTF::ASCIILiteral expected);
JSC::EncodedJSValue CRYPTO_INCOMPATIBLE_KEY_OPTIONS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView& receivedKeyEncoding, const WTF::String& expectedOperation);
JSC::EncodedJSValue CRYPTO_INVALID_DIGEST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView& digest);
JSC::EncodedJSValue CRYPTO_INVALID_DIGEST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message, const WTF::StringView& digest);
JSC::EncodedJSValue CRYPTO_HASH_FINALIZED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue CRYPTO_HASH_UPDATE_FAILED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue MISSING_PASSPHRASE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message);
JSC::EncodedJSValue CRYPTO_TIMING_SAFE_EQUAL_LENGTH(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_UNKNOWN_DH_GROUP(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_INVALID_KEYTYPE(JSC::ThrowScope&, JSC::JSGlobalObject*, WTF::ASCIILiteral message);
JSC::EncodedJSValue CRYPTO_INVALID_KEYTYPE(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_UNKNOWN_CIPHER(JSC::ThrowScope&, JSC::JSGlobalObject*, const WTF::StringView& cipherName);
JSC::EncodedJSValue CRYPTO_INVALID_AUTH_TAG(JSC::ThrowScope&, JSC::JSGlobalObject*, const WTF::String& message);
JSC::EncodedJSValue CRYPTO_INVALID_IV(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_UNSUPPORTED_OPERATION(JSC::ThrowScope&, JSC::JSGlobalObject*, WTF::ASCIILiteral message);
JSC::EncodedJSValue CRYPTO_UNSUPPORTED_OPERATION(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_INVALID_KEYLEN(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue CRYPTO_INVALID_STATE(JSC::ThrowScope&, JSC::JSGlobalObject*, WTF::ASCIILiteral message);
JSC::EncodedJSValue CRYPTO_INVALID_MESSAGELEN(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue OSSL_EVP_INVALID_DIGEST(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue KEY_GENERATION_JOB_FAILED(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue INCOMPATIBLE_OPTION_PAIR(JSC::ThrowScope&, JSC::JSGlobalObject*, ASCIILiteral opt1, ASCIILiteral opt2);
JSC::EncodedJSValue MISSING_OPTION(JSC::ThrowScope&, JSC::JSGlobalObject*, ASCIILiteral message);
JSC::EncodedJSValue INVALID_MIME_SYNTAX(JSC::ThrowScope&, JSC::JSGlobalObject*, const String& part, const String& input, int position);
JSC::EncodedJSValue CLOSED_MESSAGE_PORT(JSC::ThrowScope&, JSC::JSGlobalObject*);
JSC::EncodedJSValue INVALID_THIS(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral expectedType);
JSC::EncodedJSValue DLOPEN_DISABLED(JSC::ThrowScope&, JSC::JSGlobalObject*, ASCIILiteral message);

// URL

/// `URL must be of scheme {expectedScheme}`
JSC::EncodedJSValue INVALID_URL_SCHEME(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& expectedScheme);
/// `File URL host must be "localhost" or empty on {platform}`
JSC::EncodedJSValue INVALID_FILE_URL_HOST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& platform);
/// `File URL path {suffix}`
JSC::EncodedJSValue INVALID_FILE_URL_PATH(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const ASCIILiteral suffix);

}

void throwBoringSSLError(JSGlobalObject* globalObject, JSC::ThrowScope& scope, int errorCode);
void throwCryptoOperationFailed(JSGlobalObject* globalObject, JSC::ThrowScope& scope);

}
