
#include "root.h"

#include "ZigGlobalObject.h"
#include "DOMException.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorType.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/WriteBarrier.h"
#include "root.h"
#include "headers-handwritten.h"
#include "BunClientData.h"
#include "helpers.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/Symbol.h"
#include "wtf/Assertions.h"
#include "wtf/text/ASCIIFastPath.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/MakeString.h"
#include "wtf/text/WTFString.h"
#include "AbortSignal.h"
#include "JavaScriptCore/ErrorInstanceInlines.h"
#include "JavaScriptCore/JSInternalFieldObjectImplInlines.h"
#include "JSDOMException.h"

#include "ErrorCode.h"

static JSC::JSObject* createErrorPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code, bool isDOMExceptionPrototype = false)
{
    JSC::JSObject* prototype;

    // Inherit from DOMException
    // But preserve the error.stack property.
    if (isDOMExceptionPrototype) {
        auto* domGlobalObject = defaultGlobalObject(globalObject);
        prototype = JSC::constructEmptyObject(globalObject, WebCore::JSDOMException::prototype(vm, *domGlobalObject));
    } else {
        switch (type) {
        case JSC::ErrorType::TypeError:
            prototype = JSC::constructEmptyObject(globalObject, globalObject->m_typeErrorStructure.prototype(globalObject));
            break;
        case JSC::ErrorType::RangeError:
            prototype = JSC::constructEmptyObject(globalObject, globalObject->m_rangeErrorStructure.prototype(globalObject));
            break;
        case JSC::ErrorType::Error:
            prototype = JSC::constructEmptyObject(globalObject, globalObject->errorPrototype());
            break;
        default: {
            RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("TODO: Add support for more error types");
            break;
        }
        }
    }

    prototype->putDirect(vm, vm.propertyNames->name, jsString(vm, String(name)), 0);
    prototype->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), jsString(vm, String(code)), 0);

    return prototype;
}

extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue val_arg_name, JSC::EncodedJSValue val_expected_type, JSC::EncodedJSValue val_actual_value);
extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE_static(JSC::JSGlobalObject* globalObject, const ZigString* val_arg_name, const ZigString* val_expected_type, JSC::EncodedJSValue val_actual_value);
extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3);
extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS_static(JSC::JSGlobalObject* globalObject, const ZigString* arg1, const ZigString* arg2, const ZigString* arg3);
extern "C" JSC::EncodedJSValue Bun__ERR_IPC_CHANNEL_CLOSED(JSC::JSGlobalObject* globalObject);

// clang-format on

#define EXPECT_ARG_COUNT(count__)                                                          \
    do {                                                                                   \
        auto argCount = callFrame->argumentCount();                                        \
        if (argCount < count__) {                                                          \
            JSC::throwTypeError(globalObject, scope, "requires " #count__ " arguments"_s); \
            return {};                                                                     \
        }                                                                                  \
    } while (false)

namespace Bun {

using namespace JSC;

#include "ErrorCode+Data.h"

const ClassInfo ErrorCodeCache::s_info = { "ErrorCodeCache"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ErrorCodeCache) };

ErrorCodeCache::ErrorCodeCache(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

template<typename Visitor>
void ErrorCodeCache::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<ErrorCodeCache*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE, ErrorCodeCache);

Structure* ErrorCodeCache::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(InternalFieldTupleType, StructureFlags), info(), 0, 0);
}

ErrorCodeCache* ErrorCodeCache::create(VM& vm, Structure* structure)
{
    ErrorCodeCache* object = new (NotNull, allocateCell<ErrorCodeCache>(vm)) ErrorCodeCache(vm, structure);
    object->finishCreation(vm);
    return object;
}

void ErrorCodeCache::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    for (unsigned i = 0; i < NODE_ERROR_COUNT; i++) {
        this->internalField(i).clear();
    }
}

static ErrorCodeCache* errorCache(Zig::GlobalObject* globalObject)
{
    return static_cast<ErrorCodeCache*>(globalObject->nodeErrorCache());
}

// clang-format on
static Structure* createErrorStructure(JSC::VM& vm, JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code, bool isDOMExceptionPrototype = false)
{
    auto* prototype = createErrorPrototype(vm, globalObject, type, name, code, isDOMExceptionPrototype);
    return ErrorInstance::createStructure(vm, globalObject, prototype);
}

JSObject* ErrorCodeCache::createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options)
{
    auto* cache = errorCache(globalObject);
    const auto& data = errors[static_cast<size_t>(code)];
    if (!cache->internalField(static_cast<unsigned>(code))) {
        auto* structure = createErrorStructure(vm, globalObject, data.type, data.name, data.code, code == ErrorCode::ABORT_ERR);
        cache->internalField(static_cast<unsigned>(code)).set(vm, cache, structure);
    }

    auto* structure = jsCast<Structure*>(cache->internalField(static_cast<unsigned>(code)).get());
    return JSC::ErrorInstance::create(globalObject, structure, message, options, nullptr, JSC::RuntimeType::TypeNothing, data.type, true);
}

JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, const String& message)
{
    return errorCache(globalObject)->createError(vm, globalObject, code, jsString(vm, message), jsUndefined());
}

JSObject* createError(VM& vm, JSC::JSGlobalObject* globalObject, ErrorCode code, JSValue message)
{
    if (auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject))
        return createError(vm, zigGlobalObject, code, message, jsUndefined());

    auto* structure = createErrorStructure(vm, globalObject, errors[static_cast<size_t>(code)].type, errors[static_cast<size_t>(code)].name, errors[static_cast<size_t>(code)].code);
    return JSC::ErrorInstance::create(globalObject, structure, message, jsUndefined(), nullptr, JSC::RuntimeType::TypeNothing, errors[static_cast<size_t>(code)].type, true);
}

JSC::JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options)
{
    return errorCache(globalObject)->createError(vm, globalObject, code, message, options);
}

JSObject* createError(JSC::JSGlobalObject* globalObject, ErrorCode code, const String& message)
{
    auto& vm = globalObject->vm();
    return createError(vm, globalObject, code, jsString(vm, message));
}

JSObject* createError(Zig::JSGlobalObject* globalObject, ErrorCode code, JSC::JSValue message)
{
    auto& vm = globalObject->vm();
    return createError(vm, globalObject, code, message);
}

WTF::String JSValueToStringSafe(JSC::JSGlobalObject* globalObject, JSValue arg)
{
    ASSERT(!arg.isEmpty());
    if (!arg.isCell())
        return arg.toWTFStringForConsole(globalObject);

    auto cell = arg.asCell();
    switch (cell->type()) {
    case JSC::JSType::StringType: {
        return arg.toWTFStringForConsole(globalObject);
    }
    case JSC::JSType::SymbolType: {

        auto symbol = jsCast<Symbol*>(cell);
        auto result = symbol->tryGetDescriptiveString();
        if (result.has_value())
            return result.value();
        return "Symbol"_s;
    }
    case JSC::JSType::InternalFunctionType:
    case JSC::JSType::JSFunctionType: {
        auto& vm = globalObject->vm();
        auto catchScope = DECLARE_CATCH_SCOPE(vm);
        auto name = JSC::getCalculatedDisplayName(vm, cell->getObject());
        if (catchScope.exception()) {
            catchScope.clearException();
            name = "Function"_s;
        }

        if (!name.isNull() && name.length() > 0) {
            return makeString("[Function: "_s, name, ']');
        }

        return "Function"_s;
        break;
    }

    default: {
        break;
    }
    }

    return arg.toWTFStringForConsole(globalObject);
}

namespace Message {

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const StringView& arg_name, const StringView& expected_type, JSValue actual_value)
{

    auto actual_value_string = JSValueToStringSafe(globalObject, actual_value);
    RETURN_IF_EXCEPTION(scope, {});

    return makeString("The \""_s, arg_name, "\" argument must be of type "_s, expected_type, ". Received: "_s, actual_value_string);
}

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const StringView& arg_name, ArgList expected_types, JSValue actual_value)
{
    WTF::StringBuilder result;

    auto actual_value_string = JSValueToStringSafe(globalObject, actual_value);
    RETURN_IF_EXCEPTION(scope, {});

    result.append("The \""_s, arg_name, "\" argument must be of type "_s);

    unsigned length = expected_types.size();
    if (length == 1) {
        result.append(expected_types.at(0).toWTFString(globalObject));
    } else if (length == 2) {
        result.append(expected_types.at(0).toWTFString(globalObject));
        result.append(" or "_s);
        result.append(expected_types.at(1).toWTFString(globalObject));
    } else {
        for (unsigned i = 0; i < length - 1; i++) {
            if (i > 0)
                result.append(", "_s);
            JSValue expected_type = expected_types.at(i);
            result.append(expected_type.toWTFString(globalObject));
        }
        result.append(" or "_s);
        result.append(expected_types.at(length - 1).toWTFString(globalObject));
    }

    result.append(". Received: "_s, actual_value_string);

    return result.toString();
}

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const ZigString* arg_name_string, const ZigString* expected_type_string, JSValue actual_value)
{
    auto arg_name = std::span<const LChar>(arg_name_string->ptr, arg_name_string->len);
    ASSERT(WTF::charactersAreAllASCII(arg_name));

    auto expected_type = std::span<const LChar>(expected_type_string->ptr, expected_type_string->len);
    ASSERT(WTF::charactersAreAllASCII(expected_type));

    return ERR_INVALID_ARG_TYPE(scope, globalObject, arg_name, expected_type, actual_value);
}

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue val_arg_name, JSValue val_expected_type, JSValue val_actual_value)
{

    auto arg_name = val_arg_name.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto expected_type = val_expected_type.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return ERR_INVALID_ARG_TYPE(scope, globalObject, arg_name, expected_type, val_actual_value);
}

WTF::String ERR_OUT_OF_RANGE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue val_arg_name, JSValue val_range, JSValue val_input)
{
    auto arg_name = val_arg_name.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto range = val_range.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto input = JSValueToStringSafe(globalObject, val_input);
    RETURN_IF_EXCEPTION(scope, {});

    return makeString("The value of \""_s, arg_name, "\" is out of range. It must be "_s, range, ". Received: \""_s, input, '"');
}
}

static JSC::JSValue ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue arg0, JSValue arg1, JSValue arg2)
{

    if (auto* array = jsDynamicCast<JSC::JSArray*>(arg1)) {
        const WTF::String argName = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        MarkedArgumentBuffer expected_types;
        for (unsigned i = 0, length = array->length(); i < length; i++) {
            expected_types.append(array->getDirectIndex(globalObject, i));
            RETURN_IF_EXCEPTION(scope, {});
        }

        const auto msg = Bun::Message::ERR_INVALID_ARG_TYPE(scope, globalObject, argName, expected_types, arg2);
        return createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, msg);
    }

    const auto msg = Bun::Message::ERR_INVALID_ARG_TYPE(scope, globalObject, arg0, arg1, arg2);
    return createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, msg);
}

extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue val_arg_name, JSC::EncodedJSValue val_expected_type, JSC::EncodedJSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto message = Message::ERR_INVALID_ARG_TYPE(scope, globalObject, JSValue::decode(val_arg_name), JSValue::decode(val_expected_type), JSValue::decode(val_actual_value));
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
}
extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE_static(JSC::JSGlobalObject* globalObject, const ZigString* val_arg_name, const ZigString* val_expected_type, JSC::EncodedJSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String message = Message::ERR_INVALID_ARG_TYPE(scope, globalObject, val_arg_name, val_expected_type, JSValue::decode(val_actual_value));
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(3);

    auto message = Message::ERR_OUT_OF_RANGE(scope, globalObject, callFrame->argument(0), callFrame->argument(1), callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_IPC_DISCONNECTED, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_IPC_DISCONNECTED, "IPC channel is already disconnected"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_SERVER_NOT_RUNNING, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SERVER_NOT_RUNNING, "Server is not running."_s));
}

extern "C" JSC::EncodedJSValue Bun__createErrorWithCode(JSC::JSGlobalObject* globalObject, ErrorCode code, BunString* message)
{
    return JSValue::encode(createError(globalObject, code, message->toWTFString(BunString::ZeroCopy)));
}

extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (arg1 == 0) {
        JSC::throwTypeError(globalObject, scope, "requires at least 1 argument"_s);
        return {};
    }

    auto name1 = JSValue::decode(arg1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (arg2 == 0) {
        // 1 arg name passed
        auto message = makeString("The \""_s, name1, "\" argument must be specified"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
    }

    auto name2 = JSValue::decode(arg2).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (arg3 == 0) {
        // 2 arg names passed
        auto message = makeString("The \""_s, name1, "\" and \""_s, name2, "\" arguments must be specified"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
    }

    auto name3 = JSValue::decode(arg3).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // 3 arg names passed
    auto message = makeString("The \""_s, name1, "\", \""_s, name2, "\", and \""_s, name3, "\" arguments must be specified"_s);
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
}
extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS_static(JSC::JSGlobalObject* globalObject, const ZigString* arg1, const ZigString* arg2, const ZigString* arg3)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (arg1 == nullptr) {
        JSC::throwTypeError(globalObject, scope, "requires at least 1 argument"_s);
        return {};
    }

    auto name1 = std::span<const unsigned char>(arg1->ptr, arg1->len);
    ASSERT(WTF::charactersAreAllASCII(name1));

    if (arg2 == nullptr) {
        // 1 arg name passed
        auto message = makeString("The \""_s, name1, "\" argument must be specified"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
    }

    auto name2 = std::span<const unsigned char>(arg2->ptr, arg2->len);
    ASSERT(WTF::charactersAreAllASCII(name2));

    if (arg3 == nullptr) {
        // 2 arg names passed
        auto message = makeString("The \""_s, name1, "\" and \""_s, name2, "\" arguments must be specified"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
    }

    auto name3 = std::span<const unsigned char>(arg3->ptr, arg3->len);
    ASSERT(WTF::charactersAreAllASCII(name3));

    // 3 arg names passed
    auto message = makeString("The \""_s, name1, "\", \""_s, name2, "\", and \""_s, name3, "\" arguments must be specified"_s);
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_IPC_CHANNEL_CLOSED, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return Bun__ERR_IPC_CHANNEL_CLOSED(globalObject);
}
extern "C" JSC::EncodedJSValue Bun__ERR_IPC_CHANNEL_CLOSED(JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_IPC_CHANNEL_CLOSED, "Channel closed."_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_SOCKET_BAD_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_BAD_TYPE, "Bad socket type specified. Valid types are: udp4, udp6"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_INVALID_PROTOCOL, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(2);

    auto actual = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto expected = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("Protocol \""_s, actual, "\" not supported. Expected \""_s, expected, "\""_s);
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_PROTOCOL, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_INVALID_ARG_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(3);

    auto arg_name = callFrame->argument(0);
    auto expected_type = callFrame->argument(1);
    auto actual_value = callFrame->argument(2);
    return JSValue::encode(ERR_INVALID_ARG_TYPE(scope, globalObject, arg_name, expected_type, actual_value));
}

} // namespace Bun

JSC::JSValue WebCore::toJS(JSC::JSGlobalObject* globalObject, CommonAbortReason abortReason)
{
    switch (abortReason) {
    case CommonAbortReason::Timeout: {
        return createError(globalObject, Bun::ErrorCode::ABORT_ERR, "The operation timed out"_s);
    }
    case CommonAbortReason::UserAbort: {
        // This message is a standardized error message. We cannot change it.
        // https://webidl.spec.whatwg.org/#idl-DOMException:~:text=The%20operation%20was%20aborted.
        return createError(globalObject, Bun::ErrorCode::ABORT_ERR, "The operation was aborted."_s);
    }
    case CommonAbortReason::ConnectionClosed: {
        return createError(globalObject, Bun::ErrorCode::ABORT_ERR, "The connection was closed"_s);
    }
    default: {
        break;
    }
    }

    RELEASE_ASSERT_NOT_REACHED();
}

extern "C" JSC::EncodedJSValue WebCore__CommonAbortReason__toJS(JSC::JSGlobalObject* globalObject, WebCore::CommonAbortReason abortReason)
{
    return JSC::JSValue::encode(WebCore::toJS(globalObject, abortReason));
}

JSC::JSObject* Bun::createInvalidThisError(JSC::JSGlobalObject* globalObject, const String& message)
{
    return Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_THIS, message);
}

JSC::JSObject* Bun::createInvalidThisError(JSC::JSGlobalObject* globalObject, JSC::JSValue thisValue, const ASCIILiteral typeName)
{
    if (thisValue.isEmpty() || thisValue.isUndefined()) {
        return Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_THIS, makeString("Expected this to be instanceof "_s, typeName));
    }

    // Pathological case: the this value returns a string which is extremely long or causes an out of memory error.
    const auto& typeString = thisValue.isString() ? String("a string"_s) : JSC::errorDescriptionForValue(globalObject, thisValue);
    return Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_THIS, makeString("Expected this to be instanceof "_s, typeName, ", but received "_s, typeString));
}

JSC::EncodedJSValue Bun::throwError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, Bun::ErrorCode code, const WTF::String& message)
{
    return JSC::JSValue::encode(scope.throwException(globalObject, createError(globalObject, code, message)));
}

JSC_DEFINE_HOST_FUNCTION(Bun::jsFunctionMakeErrorWithCode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(2);

    JSC::JSValue codeValue = callFrame->argument(0);
    RETURN_IF_EXCEPTION(scope, {});

#if BUN_DEBUG
    if (!codeValue.isNumber()) {
        JSC::throwTypeError(globalObject, scope, "First argument to $ERR_ must be a number"_s);
        return {};
    }
#endif

    int code = codeValue.toInt32(globalObject);

#if BUN_DEBUG
    if (code > Bun::NODE_ERROR_COUNT - 1 || code < 0) {
        JSC::throwTypeError(globalObject, scope, "Invalid error code. Use $ERR_* constants"_s);
        return {};
    }
#endif

    Bun::ErrorCode error = static_cast<Bun::ErrorCode>(code);

    switch (error) {
    case Bun::ErrorCode::ERR_INVALID_ARG_TYPE: {
        JSValue arg0 = callFrame->argument(1);
        JSValue arg1 = callFrame->argument(2);
        JSValue arg2 = callFrame->argument(3);

        return JSValue::encode(ERR_INVALID_ARG_TYPE(scope, globalObject, arg0, arg1, arg2));
    }

    default: {
        break;
    }
    }

    auto message = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(createError(globalObject, error, message));
}
