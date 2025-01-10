
#include "root.h"

#include "ZigGlobalObject.h"
#include "DOMException.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorType.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/WriteBarrier.h"
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
        case JSC::ErrorType::URIError:
            prototype = JSC::constructEmptyObject(globalObject, globalObject->m_URIErrorStructure.prototype(globalObject));
            break;
        case JSC::ErrorType::SyntaxError:
            prototype = JSC::constructEmptyObject(globalObject, globalObject->m_syntaxErrorStructure.prototype(globalObject));
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

// export fn Bun__inspect(globalThis: *JSGlobalObject, value: JSValue) ZigString
extern "C" ZigString Bun__inspect(JSC::JSGlobalObject* globalObject, JSValue value);

//
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
            name = ""_s;
        }

        if (!name.isNull() && name.length() > 0) {
            return makeString("[Function: "_s, name, ']');
        }

        return "[Function (anonymous)]"_s;
        break;
    }

    default: {
        break;
    }
    }

    ZigString zstring = Bun__inspect(globalObject, arg);
    BunString bstring(BunStringTag::ZigString, BunStringImpl(zstring));
    return bstring.toWTFString();
}

WTF::String determineSpecificType(JSC::JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    ASSERT(!value.isEmpty());

    if (value.isNull()) {
        return String("null"_s);
    }
    if (value.isUndefined()) {
        return String("undefined"_s);
    }
    if (value.isNumber()) {
        double d = value.asNumber();
        double infinity = std::numeric_limits<double>::infinity();
        if (value == 0) return (1 / d == -infinity) ? String("type number (-0)"_s) : String("type number (0)"_s);
        if (d != d) return String("type number (NaN)"_s);
        if (d == infinity) return String("type number (Infinity)"_s);
        if (d == -infinity) return String("type number (-Infinity)"_s);
        auto str = value.toStringOrNull(globalObject);
        if (!str) return {};
        return makeString("type number ("_s, str->getString(globalObject), ")"_s);
    }
    if (value.isBoolean()) {
        return value.asBoolean() ? String("type boolean (true)"_s) : String("type boolean (false)"_s);
    }
    if (value.isBigInt()) {
        auto str = value.toString(globalObject);
        if (!str) return {};
        return makeString("type bigint ("_s, str->getString(globalObject), "n)"_s);
    }

    ASSERT(value.isCell());
    auto cell = value.asCell();

    if (cell->isSymbol()) {
        auto symbol = jsCast<Symbol*>(cell);
        auto result = symbol->tryGetDescriptiveString();
        auto description = result.has_value() ? result.value() : String("Symbol()"_s);
        return makeString("type symbol ("_s, description, ")"_s);
    }
    if (cell->isCallable()) {
        auto name = JSC::getCalculatedDisplayName(vm, cell->getObject());
        if (scope.exception()) {
            scope.clearException();
            name = String(""_s);
        }
        if (!name.isNull() && name.length() > 0) {
            return makeString("function "_s, name);
        }
        return String("function "_s);
    }
    if (cell->isString()) {
        auto str = value.toString(globalObject)->getString(globalObject);
        if (str.length() > 28) {
            str = str.substring(0, 25);
            str = makeString(str, "..."_s);
            if (!str.contains('\'')) {
                return makeString("type string ('"_s, str, "')"_s);
            }
        }
        //       return `type string (${JSONStringify(value)})`;
        str = value.toWTFStringForConsole(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return makeString("type string ("_s, str, ")"_s);
    }
    if (cell->isObject()) {
        auto constructor = value.get(globalObject, vm.propertyNames->constructor);
        RETURN_IF_EXCEPTION(scope, {});
        if (constructor.toBoolean(globalObject)) {
            auto name = constructor.get(globalObject, vm.propertyNames->name);
            RETURN_IF_EXCEPTION(scope, {});
            auto str = name.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            return makeString("an instance of "_s, str->getString(globalObject));
        }
        // return `${lazyInternalUtilInspect().inspect(value, { depth: -1 })}`;
        auto str = JSValueToStringSafe(globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        return str;
    }

    //       value = lazyInternalUtilInspect().inspect(value, { colors: false });
    auto str = JSValueToStringSafe(globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    return str;
}

namespace Message {

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const StringView& arg_name, const StringView& expected_type, JSValue actual_value)
{
    auto actual_value_string = determineSpecificType(globalObject, actual_value);
    RETURN_IF_EXCEPTION(scope, {});

    return makeString("The \""_s, arg_name, "\" argument must be of type "_s, expected_type, ". Received "_s, actual_value_string);
}

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const StringView& arg_name, ArgList expected_types, JSValue actual_value)
{
    WTF::StringBuilder result;

    auto actual_value_string = determineSpecificType(globalObject, actual_value);
    RETURN_IF_EXCEPTION(scope, {});

    result.append("The "_s);

    if (arg_name.contains(' ')) {
        result.append(arg_name);
    } else {
        result.append("\""_s);
        result.append(arg_name);
        result.append("\" argument"_s);
    }
    result.append(" must be of type "_s);

    unsigned length = expected_types.size();
    if (length == 1) {
        result.append(expected_types.at(0).toWTFString(globalObject));
    } else {
        for (unsigned i = 0; i < length - 1; i++) {
            JSValue expected_type = expected_types.at(i);
            if (i > 0) result.append(", "_s);
            result.append(expected_type.toWTFString(globalObject));
        }
        result.append(" or "_s);
        result.append(expected_types.at(length - 1).toWTFString(globalObject));
    }

    result.append(". Received "_s, actual_value_string);

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

    return makeString("The value of \""_s, arg_name, "\" is out of range. It must be "_s, range, ". Received "_s, input);
}

}

namespace ERR {

JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value)
{
    auto arg_kind = arg_name.contains('.') ? "property"_s : "argument"_s;
    auto ty_first_char = expected_type[0];
    auto ty_kind = ty_first_char >= 'A' && ty_first_char <= 'Z' ? "an instance of"_s : "of type"_s;

    auto actual_value = determineSpecificType(globalObject, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The \""_s, arg_name, "\" "_s, arg_kind, " must be "_s, ty_kind, " "_s, expected_type, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}
JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue val_arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value)
{
    auto arg_name = val_arg_name.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto arg_kind = arg_name.contains('.') ? "property"_s : "argument"_s;

    auto ty_first_char = expected_type[0];
    auto ty_kind = ty_first_char >= 'A' && ty_first_char <= 'Z' ? "an instance of"_s : "of type"_s;

    auto actual_value = determineSpecificType(globalObject, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The \""_s, arg_name, "\" "_s, arg_kind, " must be "_s, ty_kind, " "_s, expected_type, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, double lower, double upper, JSC::JSValue actual)
{
    auto lowerStr = jsNumber(lower).toWTFString(globalObject);
    auto upperStr = jsNumber(upper).toWTFString(globalObject);
    auto actual_value = JSValueToStringSafe(globalObject, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be >= "_s, lowerStr, " and <= "_s, upperStr, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
    return {};
}
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, double lower, double upper, JSC::JSValue actual)
{
    auto arg_name = arg_name_val.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto lowerStr = jsNumber(lower).toWTFString(globalObject);
    auto upperStr = jsNumber(upper).toWTFString(globalObject);
    auto actual_value = JSValueToStringSafe(globalObject, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be >= "_s, lowerStr, " and <= "_s, upperStr, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
    return {};
}
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, double bound_num, Bound bound, JSC::JSValue actual)
{
    auto arg_name = arg_name_val.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto actual_value = JSValueToStringSafe(globalObject, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    switch (bound) {
    case LOWER: {
        auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be >= "_s, bound_num, ". Received "_s, actual_value);
        throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
        return {};
    }
    case UPPER: {
        auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be <= "_s, bound_num, ". Received "_s, actual_value);
        throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
        return {};
    }
    }
}
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, const WTF::String& msg, JSC::JSValue actual)
{
    auto arg_name = arg_name_val.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto actual_value = JSValueToStringSafe(globalObject, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be "_s, msg, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
    return {};
}
JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& msg, JSC::JSValue actual)
{
    auto actual_value = JSValueToStringSafe(globalObject, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be "_s, msg, ". Received "_s, actual_value);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason)
{
    ASCIILiteral type = String(name).contains('.') ? "property"_s : "argument"_s;

    auto value_string = JSValueToStringSafe(globalObject, value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The "_s, type, " '"_s, name, "' "_s, reason, ". Received "_s, value_string);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, message));
    return {};
}
JSC::EncodedJSValue INVALID_ARG_VALUE_RangeError(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason)
{
    ASCIILiteral type = String(name).contains('.') ? "property"_s : "argument"_s;

    auto value_string = JSValueToStringSafe(globalObject, value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto& vm = globalObject->vm();
    auto message = makeString("The "_s, type, " '"_s, name, "' "_s, reason, ". Received "_s, value_string);
    auto* structure = createErrorStructure(vm, globalObject, ErrorType::RangeError, "RangeError"_s, "ERR_INVALID_ARG_VALUE"_s);
    auto error = JSC::ErrorInstance::create(vm, structure, message, jsUndefined(), nullptr, JSC::RuntimeType::TypeNothing, ErrorType::RangeError, true);
    throwScope.throwException(globalObject, error);
    return {};
}
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, const WTF::String& reason)
{
    auto name_string = JSValueToStringSafe(globalObject, name);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto value_string = JSValueToStringSafe(globalObject, value);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString("The argument '"_s, name_string, "' "_s, reason, ". Received "_s, value_string);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, message));
    return {};
}

JSC::EncodedJSValue UNKNOWN_ENCODING(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView encoding)
{
    auto message = makeString("Unknown encoding: "_s, encoding);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_ENCODING, message));
    return {};
}

JSC::EncodedJSValue INVALID_STATE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& statemsg)
{
    auto message = makeString("Invalid state: "_s, statemsg);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_STATE, message));
    return {};
}

JSC::EncodedJSValue STRING_TOO_LONG(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = makeString("Cannot create a string longer than "_s, WTF::String ::MaxLength, " characters"_s);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_STRING_TOO_LONG, message));
    return {};
}

JSC::EncodedJSValue BUFFER_OUT_OF_BOUNDS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, "Attempt to access memory outside buffer bounds"_s));
    return {};
}

JSC::EncodedJSValue UNKNOWN_SIGNAL(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue signal, bool triedUppercase)
{
    auto signal_string = signal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message_extra = triedUppercase ? " (signals must use all capital letters)"_s : ""_s;
    auto message = makeString("Unknown signal: "_s, signal_string, message_extra);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_SIGNAL, message));
    return {};
}

JSC::EncodedJSValue SOCKET_BAD_PORT(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue port, bool allowZero)
{
    ASCIILiteral op = allowZero ? ">="_s : ">"_s;

    auto name_string = JSValueToStringSafe(globalObject, name);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto port_string = JSValueToStringSafe(globalObject, port);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto message = makeString(name_string, " should be "_s, op, " 0 and < 65536. Received "_s, port_string);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_SOCKET_BAD_PORT, message));
    return {};
}

JSC::EncodedJSValue UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "`process.setupUncaughtExceptionCapture()` was called while a capture callback was already active"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET, message));
    return {};
}

JSC::EncodedJSValue ASSERTION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue msg)
{
    auto msg_string = msg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto message = msg_string;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_ASSERTION, message));
    return {};
}
JSC::EncodedJSValue ASSERTION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral msg)
{
    auto message = msg;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_ASSERTION, message));
    return {};
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

static JSValue ERR_INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, JSC::JSValue reason)
{
    ASSERT(name.isString());
    auto name_string = name.toWTFString(globalObject);
    ASCIILiteral type = name_string.contains('.') ? "property"_s : "argument"_s;

    auto value_string = JSValueToStringSafe(globalObject, value);
    RETURN_IF_EXCEPTION(throwScope, {});

    ASSERT(reason.isUndefined() || reason.isString());
    if (reason.isUndefined()) {
        auto message = makeString("The "_s, type, " '"_s, name_string, "' is invalid. Received "_s, value_string);
        return createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, message);
    }
    auto reason_string = reason.toWTFString(globalObject);
    auto message = makeString("The "_s, type, " '"_s, name_string, "' "_s, reason_string, ". Received "_s, value_string);
    return createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, message);
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

extern "C" JSC::EncodedJSValue Bun__createErrorWithCode(JSC::JSGlobalObject* globalObject, ErrorCode code, BunString* message)
{
    return JSValue::encode(createError(globalObject, code, message->toWTFString(BunString::ZeroCopy)));
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

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_BROTLI_INVALID_PARAM, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(1);

    auto param = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString(param, " is not a valid Brotli parameter"_s);
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_BROTLI_INVALID_PARAM, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_BUFFER_TOO_LARGE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(1);

    auto param = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("Cannot create a Buffer larger than "_s, param, " bytes"_s);
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_BUFFER_TOO_LARGE, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_UNHANDLED_ERROR, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto err = callFrame->argument(0);

    if (err.isUndefined()) {
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_UNHANDLED_ERROR, "Unhandled error."_s));
    }
    if (err.isString()) {
        auto err_str = err.getString(globalObject);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_UNHANDLED_ERROR, makeString("Unhandled error. ("_s, err_str, ")"_s)));
    }
    if (err.isCell()) {
        auto cell = err.asCell();
        if (cell->inherits<JSC::Exception>()) {
            return JSC::JSValue::encode(jsCast<JSC::Exception*>(cell)->value());
        }
    }
    auto err_str = err.toWTFString(globalObject);
    return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_UNHANDLED_ERROR, makeString("Unhandled error. ("_s, err_str, ")"_s)));
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

    EXPECT_ARG_COUNT(1);

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

    case Bun::ErrorCode::ERR_INVALID_IP_ADDRESS: {
        JSValue arg0 = callFrame->argument(1);

        auto param = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_IP_ADDRESS, makeString("Invalid IP address: "_s, param)));
    }

    case Bun::ErrorCode::ERR_INVALID_ARG_VALUE: {
        JSValue arg0 = callFrame->argument(1);
        JSValue arg1 = callFrame->argument(2);
        JSValue arg2 = callFrame->argument(3);
        return JSValue::encode(ERR_INVALID_ARG_VALUE(scope, globalObject, arg0, arg1, arg2));
    }

    case ErrorCode::ERR_IPC_DISCONNECTED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_IPC_DISCONNECTED, "IPC channel is already disconnected"_s));
    case ErrorCode::ERR_SERVER_NOT_RUNNING:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SERVER_NOT_RUNNING, "Server is not running."_s));
    case ErrorCode::ERR_IPC_CHANNEL_CLOSED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_IPC_CHANNEL_CLOSED, "Channel closed."_s));
    case ErrorCode::ERR_SOCKET_BAD_TYPE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_BAD_TYPE, "Bad socket type specified. Valid types are: udp4, udp6"_s));
    case ErrorCode::ERR_ZLIB_INITIALIZATION_FAILED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_ZLIB_INITIALIZATION_FAILED, "Initialization failed"_s));
    case ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, "Attempt to access memory outside buffer bounds"_s));
    case ErrorCode::ERR_IPC_ONE_PIPE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_IPC_ONE_PIPE, "Child process can have only one IPC pipe"_s));
    case ErrorCode::ERR_SOCKET_ALREADY_BOUND:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_ALREADY_BOUND, "Socket is already bound"_s));
    case ErrorCode::ERR_SOCKET_BAD_BUFFER_SIZE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_BAD_BUFFER_SIZE, "Buffer size must be a positive integer"_s));
    case ErrorCode::ERR_SOCKET_DGRAM_IS_CONNECTED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_DGRAM_IS_CONNECTED, "Already connected"_s));
    case ErrorCode::ERR_SOCKET_DGRAM_NOT_CONNECTED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_DGRAM_NOT_CONNECTED, "Not connected"_s));
    case ErrorCode::ERR_SOCKET_DGRAM_NOT_RUNNING:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_DGRAM_NOT_RUNNING, "Not running"_s));
    case ErrorCode::ERR_INVALID_CURSOR_POS:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_CURSOR_POS, "Cannot set cursor row without setting its column"_s));

    default: {
        break;
    }
    }

    auto message = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(createError(globalObject, error, message));
}
