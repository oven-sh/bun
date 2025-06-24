
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
#include "wtf/Vector.h"
#include "wtf/text/ASCIIFastPath.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/MakeString.h"
#include "wtf/text/WTFString.h"
#include "AbortSignal.h"
#include "JavaScriptCore/ErrorInstanceInlines.h"
#include "JavaScriptCore/JSInternalFieldObjectImplInlines.h"
#include "JSDOMException.h"
#include "JSDOMExceptionHandling.h"
#include <openssl/err.h>
#include "ErrorCode.h"
#include "ErrorStackTrace.h"
#include "KeyObject.h"

namespace WTF {
template<> class StringTypeAdapter<GCOwnedDataScope<StringView>, void> {
public:
    StringTypeAdapter(GCOwnedDataScope<StringView> string)
        : m_string { string }
    {
    }

    unsigned length() const { return m_string->length(); }
    bool is8Bit() const { return m_string->is8Bit(); }
    template<typename CharacterType> void writeTo(std::span<CharacterType> destination) { m_string->getCharacters(destination); }

private:
    GCOwnedDataScope<StringView> m_string;
};
}

JSC_DEFINE_HOST_FUNCTION(NodeError_proto_toString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto thisVal = callFrame->thisValue();

    auto name = thisVal.get(globalObject, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, {});
    auto code = thisVal.get(globalObject, WebCore::builtinNames(vm).codePublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto message = thisVal.get(globalObject, vm.propertyNames->message);
    RETURN_IF_EXCEPTION(scope, {});

    auto* name_s = name.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* code_s = code.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* message_s = message.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto nameView = name_s->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto codeView = code_s->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto messageView = message_s->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::StringBuilder builder;
    builder.append(nameView);
    builder.append(" ["_s);
    builder.append(codeView);
    builder.append("]: "_s);
    builder.append(messageView);

    return JSC::JSValue::encode(JSC::jsString(vm, builder.toString()));
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
using namespace WTF;

static JSC::JSObject* createErrorPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code)
{
    JSC::JSObject* prototype;

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

    prototype->putDirect(vm, vm.propertyNames->name, jsString(vm, String(name)), 0);
    prototype->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), jsString(vm, String(code)), 0);
    prototype->putDirect(vm, vm.propertyNames->toString, JSC::JSFunction::create(vm, globalObject, 0, "toString"_s, NodeError_proto_toString, JSC::ImplementationVisibility::Private), 0);

    return prototype;
}

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
static Structure* createErrorStructure(JSC::VM& vm, JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code)
{
    auto* prototype = createErrorPrototype(vm, globalObject, type, name, code);
    return ErrorInstance::createStructure(vm, globalObject, prototype);
}

JSObject* ErrorCodeCache::createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options)
{
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto* cache = errorCache(globalObject);
    const auto& data = errors[static_cast<size_t>(code)];
    if (!cache->internalField(static_cast<unsigned>(code))) {
        auto* structure = createErrorStructure(vm, globalObject, data.type, data.name, data.code);
        cache->internalField(static_cast<unsigned>(code)).set(vm, cache, structure);
    }

    auto* structure = jsCast<Structure*>(cache->internalField(static_cast<unsigned>(code)).get());
    auto* created_error = JSC::ErrorInstance::create(globalObject, structure, message, options, nullptr, JSC::RuntimeType::TypeNothing, data.type, true);
    if (auto* thrown_exception = scope.exception()) [[unlikely]] {
        scope.clearException();
        // TODO investigate what can throw here and whether it will throw non-objects
        // (this is better than before where we would have returned nullptr from createError if any
        // exception were thrown by ErrorInstance::create)
        return jsCast<JSObject*>(thrown_exception->value());
    }
    return created_error;
}

JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, const String& message)
{
    return errorCache(globalObject)->createError(vm, globalObject, code, jsString(vm, message), jsUndefined());
}

JSObject* createError(Zig::GlobalObject* globalObject, ErrorCode code, const String& message)
{
    return createError(globalObject->vm(), globalObject, code, message);
}

JSObject* createError(VM& vm, JSC::JSGlobalObject* globalObject, ErrorCode code, const String& message)
{
    return createError(vm, defaultGlobalObject(globalObject), code, message);
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
    return createError(globalObject->vm(), globalObject, code, message);
}

JSObject* createError(Zig::JSGlobalObject* globalObject, ErrorCode code, JSC::JSValue message)
{
    auto& vm = JSC::getVM(globalObject);
    return createError(vm, globalObject, code, message);
}

extern "C" BunString Bun__inspect(JSC::JSGlobalObject* globalObject, JSValue value);

void JSValueToStringSafe(JSC::JSGlobalObject* globalObject, WTF::StringBuilder& builder, JSValue arg, bool quotesLikeInspect = false)
{
    ASSERT(!arg.isEmpty());
    if (!arg.isCell()) {
        builder.append(arg.toWTFStringForConsole(globalObject));
        return;
    }

    auto cell = arg.asCell();
    switch (cell->type()) {
    case JSC::JSType::StringType: {
        JSString* jsString = jsDynamicCast<JSString*>(cell);
        auto str = jsString->view(globalObject);
        if (quotesLikeInspect) {
            if (str->contains('\'')) {
                builder.append('"');
                if (str->is8Bit()) {
                    const auto span = str->span<LChar>();
                    for (const auto c : span) {
                        if (c == '"') {
                            builder.append("\\\""_s);
                        } else {
                            builder.append(c);
                        }
                    }
                } else {
                    const auto span = str->span<char16_t>();
                    for (const auto c : span) {
                        if (c == '"') {
                            builder.append("\\\""_s);
                        } else {
                            builder.append(c);
                        }
                    }
                }
                builder.append('"');
                return;
            }

            builder.append('\'');
            builder.append(str);
            builder.append('\'');
            return;
        }
        builder.append(str);
        return;
    }
    case JSC::JSType::SymbolType: {
        auto symbol = jsCast<Symbol*>(cell);
        auto result = symbol->tryGetDescriptiveString();
        if (result.has_value()) {
            builder.append(result.value());
        } else {
            builder.append("Symbol"_s);
        }
        return;
    }
    case JSC::JSType::InternalFunctionType:
    case JSC::JSType::JSFunctionType: {
        auto& vm = JSC::getVM(globalObject);
        auto name = Zig::functionName(vm, globalObject, cell->getObject());

        if (!name.isEmpty()) {
            builder.append("[Function: "_s);
            builder.append(name);
            builder.append(']');
        } else {
            builder.append("[Function (anonymous)]"_s);
        }
        return;
    }

    default: {
        break;
    }
    }

    auto bstring = Bun__inspect(globalObject, arg);
    auto&& str = bstring.transferToWTFString();
    builder.append(str);
}

void determineSpecificType(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& builder, JSValue value)
{
    auto scope = DECLARE_CATCH_SCOPE(vm);

    ASSERT(!value.isEmpty());

    if (value.isNull()) {
        builder.append("null"_s);
        return;
    }
    if (value.isUndefined()) {
        builder.append("undefined"_s);
        return;
    }
    if (value.isNumber()) {
        double d = value.asNumber();
        double infinity = std::numeric_limits<double>::infinity();
        if (d != d) return builder.append("type number (NaN)"_s);
        if (d == infinity) return builder.append("type number (Infinity)"_s);
        if (d == -infinity) return builder.append("type number (-Infinity)"_s);
        builder.append("type number ("_s);
        builder.append(d);
        builder.append(')');
        return;
    }
    if (value.isBoolean()) {
        builder.append(value.asBoolean() ? "type boolean (true)"_s : "type boolean (false)"_s);
        return;
    }
    if (value.isBigInt()) {
        auto str = value.toStringOrNull(globalObject);
        if (!str) return void();
        auto view = str->view(globalObject);
        builder.append("type bigint ("_s);
        builder.append(view);
        builder.append("n)"_s);
        return;
    }

    ASSERT(value.isCell());
    auto cell = value.asCell();

    if (cell->isSymbol()) {
        auto symbol = jsCast<Symbol*>(cell);
        auto result = symbol->tryGetDescriptiveString();
        if (result.has_value()) {
            builder.append("type symbol ("_s);
            builder.append(result.value());
            builder.append(")"_s);
        } else {
            builder.append("type symbol (Symbol())"_s);
        }
        return;
    }
    if (cell->isCallable()) {
        builder.append("function "_s);
        auto name = Zig::functionName(vm, globalObject, cell->getObject());

        if (!name.isEmpty()) {
            builder.append(name);
        }
        return;
    }
    if (cell->isString()) {
        auto* jsString = jsCast<JSString*>(cell);
        auto str = jsString->view(globalObject);

        StringView view = str;

        const bool needsEllipsis = jsString->length() > 28;
        // node checks for the presence of a single quote.
        // - if it does not exist, use single quotes.
        // - if it exists, json stringify (use double quotes).
        // https://github.com/nodejs/node/blob/c3ed292d17c34578fd7806cb42da82bbe0cca103/lib/internal/errors.js#L1030
        const bool needsEscape = str->contains('\'');
        if (needsEllipsis) {
            view = str->substring(0, 25);
        }
        builder.append("type string ("_s);
        if (needsEscape) [[unlikely]] {
            builder.append('"');
            if (view.is8Bit()) {
                const auto span = view.span<LChar>();
                for (const auto c : span) {
                    if (c == '"') {
                        builder.append("\\\""_s);
                    } else {
                        builder.append(c);
                    }
                }
            } else {
                const auto span = view.span<char16_t>();
                for (const auto c : span) {
                    if (c == '"') {
                        builder.append("\\\""_s);
                    } else {
                        builder.append(c);
                    }
                }
            }
        } else {
            builder.append('\'');
            builder.append(view);
        }
        if (needsEllipsis) {
            builder.append("..."_s);
        }
        if (needsEscape) [[unlikely]] {
            builder.append('"');
        } else {
            builder.append('\'');
        }
        builder.append(')');
        return;
    }
    if (cell->isObject()) {
        auto constructor = value.get(globalObject, vm.propertyNames->constructor);
        RETURN_IF_EXCEPTION(scope, void());
        if (constructor.toBoolean(globalObject)) {
            auto name = constructor.get(globalObject, vm.propertyNames->name);
            RETURN_IF_EXCEPTION(scope, void());
            auto str = name.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, void());
            builder.append("an instance of "_s);
            auto view = str->view(globalObject);
            builder.append(view);
            return;
        }
    }

    //       value = lazyInternalUtilInspect().inspect(value, { colors: false });
    JSValueToStringSafe(globalObject, builder, value);
}

extern "C" BunString Bun__ErrorCode__determineSpecificType(JSC::JSGlobalObject* globalObject, EncodedJSValue value)
{
    JSValue jsValue = JSValue::decode(value);
    WTF::StringBuilder builder;
    determineSpecificType(JSC::getVM(globalObject), globalObject, builder, jsValue);
    return Bun::toStringRef(builder.toString());
}

namespace Message {

void addList(WTF::StringBuilder& result, WTF::Vector<WTF::String>& types)
{
    switch (types.size()) {
    case 0:
        return;
    case 1:
        result.append(types.at(0));
        return;
    case 2:
        result.append(types.at(0));
        result.append(" or "_s);
        result.append(types.at(1));
        return;
    case 3:
        result.append(types.at(0));
        result.append(", "_s);
        result.append(types.at(1));
        result.append(", or "_s);
        result.append(types.at(2));
        return;
    default: {
        for (unsigned i = 0; i < types.size() - 1; i++) {
            result.append(types.at(i));
            result.append(", "_s);
        }
        result.append("or "_s);
        result.append(types.at(types.size() - 1));
        return;
    }
    }
}

void addParameter(WTF::StringBuilder& result, const StringView& arg_name)
{
    if (arg_name.endsWith(" argument"_s)) {
        result.append(arg_name);
    } else {
        result.append("\""_s);
        result.append(arg_name);
        result.append("\" "_s);
        result.append(arg_name.contains('.') ? "property"_s : "argument"_s);
    }
}

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const StringView& arg_name, const StringView& expected_type, JSValue actual_value)
{
    WTF::StringBuilder result;
    result.append("The "_s);
    addParameter(result, arg_name);
    result.append(" must be of type "_s);
    result.append(expected_type);
    result.append(". Received "_s);
    determineSpecificType(JSC::getVM(globalObject), globalObject, result, actual_value);
    RETURN_IF_EXCEPTION(scope, {});
    return result.toString();
}

WTF::String ERR_INVALID_ARG_TYPE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const StringView& arg_name, ArgList expected_types, JSValue actual_value)
{
    WTF::StringBuilder result;

    result.append("The "_s);
    addParameter(result, arg_name);
    result.append(" must be "_s);
    result.append("of type "_s);

    unsigned length = expected_types.size();
    if (length == 1) {
        auto* str = expected_types.at(0).toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        result.append(str->view(globalObject));
    } else if (length == 2) {
        auto* str1 = expected_types.at(0).toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        result.append(str1->view(globalObject));
        result.append(" or "_s);
        auto* str2 = expected_types.at(1).toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        result.append(str2->view(globalObject));
    } else {
        for (unsigned i = 0, end = length - 1; i < end; i++) {
            JSValue expected_type = expected_types.at(i);
            auto* str = expected_type.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            result.append(str->view(globalObject));
            result.append(", "_s);
        }
        result.append("or "_s);
        auto* str = expected_types.at(length - 1).toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        result.append(str->view(globalObject));
    }

    result.append(". Received "_s);
    determineSpecificType(JSC::getVM(globalObject), globalObject, result, actual_value);
    RETURN_IF_EXCEPTION(scope, {});

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
    auto* arg_name_str = val_arg_name.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto arg_name = arg_name_str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* expected_type_str = val_expected_type.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto expected_type = expected_type_str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return ERR_INVALID_ARG_TYPE(scope, globalObject, arg_name, expected_type, val_actual_value);
}

WTF::String ERR_OUT_OF_RANGE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue val_arg_name, JSValue val_range, JSValue val_input)
{
    auto* arg_name_str = val_arg_name.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto arg_name = arg_name_str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* range_str = val_range.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto range = range_str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::StringBuilder builder;
    builder.append("The value of \""_s);
    builder.append(arg_name);
    builder.append("\" is out of range. It must be "_s);
    builder.append(range);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, val_input);
    RETURN_IF_EXCEPTION(scope, {});

    return builder.toString();
}

}

namespace ERR {

EncodedJSValue INVALID_ARG_TYPE(ThrowScope& scope, JSGlobalObject* globalObject, ASCIILiteral message)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value)
{
    auto message = Message::ERR_INVALID_ARG_TYPE(throwScope, globalObject, arg_name, expected_type, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue val_arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value)
{
    auto* jsString = val_arg_name.toString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto arg_name = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto message = Message::ERR_INVALID_ARG_TYPE(throwScope, globalObject, arg_name, expected_type, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_TYPE_INSTANCE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral arg_name, WTF::ASCIILiteral expected_type, WTF::ASCIILiteral expected_instance_types, JSC::JSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    WTF::StringBuilder builder;
    builder.append("The \""_s);
    builder.append(arg_name);
    builder.append("\" argument must be of type "_s);
    builder.append(expected_type);
    builder.append(" or an instance of "_s);
    builder.append(expected_instance_types);
    builder.append(". Received "_s);
    determineSpecificType(vm, globalObject, builder, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, builder.toString()));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_TYPE_INSTANCE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral arg_name, WTF::ASCIILiteral expected_instance_types, JSC::JSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    WTF::StringBuilder builder;
    builder.append("The \""_s);
    builder.append(arg_name);
    builder.append("\" argument must be an instance of "_s);
    builder.append(expected_instance_types);
    builder.append(". Received "_s);
    determineSpecificType(vm, globalObject, builder, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, builder.toString()));
    return {};
}

// When you want INVALID_ARG_TYPE to say "The argument must be an instance of X. Received Y." instead of "The argument must be of type X. Received Y."
JSC::EncodedJSValue INVALID_ARG_INSTANCE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value)
{
    auto& vm = JSC::getVM(globalObject);
    ASCIILiteral type = String(arg_name).contains('.') ? "property"_s : "argument"_s;
    WTF::StringBuilder builder;
    builder.append("The \""_s);
    builder.append(arg_name);
    builder.append("\" "_s);
    builder.append(type);
    builder.append(" must be an instance of "_s);
    builder.append(expected_type);
    builder.append(". Received "_s);
    determineSpecificType(vm, globalObject, builder, val_actual_value);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, builder.toString()));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, double lower, double upper, JSC::JSValue actual)
{
    WTF::StringBuilder builder;
    builder.append("The value of \""_s);
    builder.append(arg_name);
    builder.append("\" is out of range. It must be >= "_s);
    builder.append(lower);
    builder.append(" and <= "_s);
    builder.append(upper);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, builder.toString()));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, double lower, double upper, JSC::JSValue actual)
{
    auto* jsString = arg_name_val.toString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto arg_name = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    WTF::StringBuilder builder;
    builder.append("The value of \""_s);
    builder.append(arg_name);
    builder.append("\" is out of range. It must be >= "_s);
    builder.append(lower);
    builder.append(" and <= "_s);
    builder.append(upper);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, builder.toString()));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, double bound_num, Bound bound, JSC::JSValue actual)
{
    auto* jsString = arg_name_val.toString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto arg_name = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    WTF::StringBuilder builder;
    builder.append("The value of \""_s);
    builder.append(arg_name);
    builder.append("\" is out of range. It must be "_s);
    builder.append(bound == LOWER ? ">= "_s : "<= "_s);
    builder.append(bound_num);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, builder.toString()));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue arg_name_val, const WTF::String& msg, JSC::JSValue actual)
{
    auto* jsString = arg_name_val.toString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto arg_name = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    WTF::StringBuilder builder;
    builder.append("The value of \""_s);
    builder.append(arg_name);
    builder.append("\" is out of range. It must be "_s);
    builder.append(msg);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, builder.toString()));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& msg, JSC::JSValue actual)
{
    WTF::StringBuilder builder;
    builder.append("The value of \""_s);
    builder.append(arg_name);
    builder.append("\" is out of range. It must be "_s);
    builder.append(msg);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, actual);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, builder.toString()));
    return {};
}

JSC::EncodedJSValue OUT_OF_RANGE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral message)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, message));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason)
{
    ASCIILiteral type = String(name).contains('.') ? "property"_s : "argument"_s;

    WTF::StringBuilder builder;
    builder.append("The "_s);
    builder.append(type);
    builder.append(" '"_s);
    builder.append(name);
    builder.append("' "_s);
    builder.append(reason);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, value, true);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString()));
    return {};
}
JSC::EncodedJSValue INVALID_ARG_VALUE_RangeError(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value, const WTF::String& reason)
{
    auto& vm = JSC::getVM(globalObject);
    ASCIILiteral type = StringView(name).contains('.') ? "property"_s : "argument"_s;
    WTF::StringBuilder builder;

    builder.append("The "_s);
    builder.append(type);
    builder.append(" '"_s);
    builder.append(name);
    builder.append("' "_s);
    builder.append(reason);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, value, true);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto* structure = createErrorStructure(vm, globalObject, ErrorType::RangeError, "RangeError"_s, "ERR_INVALID_ARG_VALUE"_s);
    auto error = JSC::ErrorInstance::create(vm, structure, builder.toString(), jsUndefined(), nullptr, JSC::RuntimeType::TypeNothing, ErrorType::RangeError, true);
    throwScope.throwException(globalObject, error);
    return {};
}
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, const WTF::String& reason)
{
    WTF::StringBuilder builder;
    builder.append("The argument '"_s);
    auto& vm = JSC::getVM(globalObject);
    determineSpecificType(vm, globalObject, builder, name);
    RETURN_IF_EXCEPTION(throwScope, {});

    builder.append("' "_s);
    builder.append(reason);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, value, true);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString()));
    return {};
}

// for validateOneOf
JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue value, WTF::ASCIILiteral reason, JSC::JSArray* oneOf)
{
    WTF::StringBuilder builder;
    builder.append("The argument '"_s);
    JSValueToStringSafe(globalObject, builder, name);
    RETURN_IF_EXCEPTION(throwScope, {});

    builder.append("' "_s);
    builder.append(reason);
    unsigned length = oneOf->length();
    for (size_t i = 0; i < length; i++) {
        JSValue index = oneOf->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (index.isString()) {
            JSString* str = index.toString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
            builder.append('\'');
            builder.append(str->view(globalObject));
            builder.append('\'');
        } else {
            JSValueToStringSafe(globalObject, builder, index);
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        if (i < length - 1) {
            builder.append(", "_s);
        }
    }
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, value, true);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString()));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, WTF::ASCIILiteral reason, JSC::JSValue value, const std::span<const ASCIILiteral> oneOf)
{
    WTF::StringBuilder builder;
    builder.append("The "_s);
    if (WTF::find(name.span(), '.') != WTF::notFound) {
        builder.append("property '"_s);
    } else {
        builder.append("argument '"_s);
    }
    builder.append(name);
    builder.append("' "_s);
    builder.append(reason);

    bool first = true;
    for (ASCIILiteral oneOfStr : oneOf) {
        if (!first) {
            builder.append(", "_s);
        }
        first = false;
        builder.append('`');
        builder.append(oneOfStr);
        builder.append('`');
    }

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString()));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, WTF::ASCIILiteral reason, JSC::JSValue value, const std::span<const int32_t> oneOf)
{
    WTF::StringBuilder builder;
    builder.append("The "_s);
    if (WTF::find(name.span(), '.') != WTF::notFound) {
        builder.append("property '"_s);
    } else {
        builder.append("argument '"_s);
    }
    builder.append(name);
    builder.append("' "_s);
    builder.append(reason);

    bool first = true;
    for (int32_t oneOfStr : oneOf) {
        if (!first) {
            builder.append(", "_s);
        }
        first = false;
        builder.append(oneOfStr);
    }

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString()));
    return {};
}

JSC::EncodedJSValue INVALID_ARG_VALUE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& name, JSC::JSValue value, const WTF::String& reason)
{
    WTF::StringBuilder builder;

    builder.append("The "_s);
    if (name.contains('.')) {
        builder.append("property '"_s);
    } else {
        builder.append("argument '"_s);
    }
    builder.append(name);
    builder.append("' "_s);
    builder.append(reason);
    builder.append(". Received "_s);

    JSValueToStringSafe(globalObject, builder, value, true);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString()));
    return {};
}

JSC::EncodedJSValue INVALID_URL_SCHEME(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& expectedScheme)
{
    auto message = makeString("The URL must be of scheme "_s, expectedScheme);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_URL_SCHEME, message));
    return {};
}
JSC::EncodedJSValue INVALID_FILE_URL_HOST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& platform)
{
    auto message = makeString("File URL host must be \"localhost\" or empty on "_s, platform);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_FILE_URL_HOST, message));
    return {};
}
JSC::EncodedJSValue INVALID_FILE_URL_HOST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const ASCIILiteral platform)
{
    auto message = makeString("File URL host must be \"localhost\" or empty on "_s, platform);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_FILE_URL_HOST, message));
    return {};
}
/// `File URL path {suffix}`
JSC::EncodedJSValue INVALID_FILE_URL_PATH(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const ASCIILiteral suffix)
{
    auto message = makeString("File URL path "_s, suffix);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_FILE_URL_PATH, message));
    return {};
}

JSC::EncodedJSValue UNKNOWN_ENCODING(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView encoding)
{
    auto message = makeString("Unknown encoding: "_s, encoding);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_ENCODING, message));
    return {};
}

JSC::EncodedJSValue UNKNOWN_ENCODING(JSC::ThrowScope& scope, JSGlobalObject* globalObject, JSValue encodingValue)
{
    WTF::String encodingString = encodingValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::StringBuilder builder;
    builder.append("Unknown encoding: "_s);
    builder.append(encodingString);
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_ENCODING, builder.toString()));
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

JSC::EncodedJSValue BUFFER_OUT_OF_BOUNDS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral name)
{
    if (!name.isEmpty()) {
        throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, makeString("\""_s, name, "\" is outside of buffer bounds"_s)));
        return {};
    }
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, "Attempt to access memory outside buffer bounds"_s));
    return {};
}

JSC::EncodedJSValue UNKNOWN_SIGNAL(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue signal, bool triedUppercase)
{
    WTF::StringBuilder builder;
    builder.append("Unknown signal: "_s);
    JSValueToStringSafe(globalObject, builder, signal);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (triedUppercase) {
        builder.append(" (signals must use all capital letters)"_s);
    }
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_SIGNAL, builder.toString()));
    return {};
}

JSC::EncodedJSValue SOCKET_BAD_PORT(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSC::JSValue name, JSC::JSValue port, bool allowZero)
{
    ASCIILiteral op = allowZero ? ">="_s : ">"_s;
    WTF::StringBuilder builder;
    JSValueToStringSafe(globalObject, builder, name);
    RETURN_IF_EXCEPTION(throwScope, {});
    builder.append(" should be "_s);
    builder.append(op);
    builder.append(" 0 and < 65536. Received "_s);
    JSValueToStringSafe(globalObject, builder, port);
    RETURN_IF_EXCEPTION(throwScope, {});

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_SOCKET_BAD_PORT, builder.toString()));
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

JSC::EncodedJSValue CRYPTO_INVALID_CURVE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "Invalid EC curve name"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_CURVE, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_KEYTYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEYTYPE, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_KEYTYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "Invalid key type"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEYTYPE, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_UNKNOWN_CIPHER(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView& cipherName)
{
    WTF::StringBuilder builder;
    builder.append("Unknown cipher: "_s);
    builder.append(cipherName);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_UNKNOWN_CIPHER, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_AUTH_TAG(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& message)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_AUTH_TAG, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_IV(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_IV, "Invalid initialization vector"_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_UNSUPPORTED_OPERATION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_UNSUPPORTED_OPERATION, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_UNSUPPORTED_OPERATION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_UNSUPPORTED_OPERATION, "Unsupported crypto operation"_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_KEYLEN(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEYLEN, "Invalid key length"_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_STATE(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_STATE, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_MESSAGELEN(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_MESSAGELEN, "Invalid message length"_s));
    return {};
}

JSC::EncodedJSValue MISSING_ARGS(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_MISSING_ARGS, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_OPERATION_FAILED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_KEYPAIR(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "Invalid key pair"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEYPAIR, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_ECDH_INVALID_PUBLIC_KEY(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "Public key is not valid for specified curve"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_ECDH_INVALID_FORMAT(ThrowScope& scope, JSGlobalObject* globalObject, const WTF::String& formatString)
{
    WTF::StringBuilder builder;
    builder.append("Invalid ECDH format: "_s);
    builder.append(formatString);
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_ECDH_INVALID_FORMAT, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_CURVE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& curve)
{
    WTF::StringBuilder builder;
    builder.append("Unsupported JWK EC curve: "_s);
    builder.append(curve);
    builder.append('.');
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_JWK_UNSUPPORTED_CURVE, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_CURVE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message, const char* curveName)
{
    WTF::StringBuilder builder;
    builder.append(message);
    if (curveName) {
        builder.append(std::span<const char> { curveName, strlen(curveName) });
    }
    builder.append('.');
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_JWK_UNSUPPORTED_CURVE, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_KEY_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE, "Unsupported JWK Key Type."_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_JWK(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_JWK, "Invalid JWK data"_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_JWK(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_JWK, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_SIGN_KEY_REQUIRED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "No key provided to sign"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_SIGN_KEY_REQUIRED, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_KEY_OBJECT_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, JSValue received, WTF::ASCIILiteral expected)
{
    WTF::StringBuilder builder;
    builder.append("Invalid key object type "_s);
    JSValueToStringSafe(globalObject, builder, received);
    RETURN_IF_EXCEPTION(throwScope, {});

    builder.append(". Expected "_s);
    builder.append(expected);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_KEY_OBJECT_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, CryptoKeyType receivedType, ASCIILiteral expected)
{
    WTF::StringBuilder builder;
    builder.append("Invalid key object type "_s);
    switch (receivedType) {
    case CryptoKeyType::Private:
        builder.append("private"_s);
        break;
    case CryptoKeyType::Public:
        builder.append("public"_s);
        break;
    case CryptoKeyType::Secret:
        builder.append("secret"_s);
        break;
    }
    builder.append(", expected "_s);
    builder.append(expected);
    builder.append('.');
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_INCOMPATIBLE_KEY_OPTIONS(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView& receivedKeyEncoding, const WTF::String& expectedOperation)
{
    WTF::StringBuilder builder;
    builder.append("The selected key encoding "_s);
    builder.append(receivedKeyEncoding);
    builder.append(' ');
    builder.append(expectedOperation);
    builder.append('.');
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_DIGEST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::StringView& digest)
{
    WTF::StringBuilder builder;
    builder.append("Invalid digest: "_s);
    builder.append(digest);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_DIGEST, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_INVALID_DIGEST(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral message, const WTF::StringView& digest)
{
    WTF::StringBuilder builder;
    builder.append(message);
    builder.append(digest);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_DIGEST, builder.toString()));
    return {};
}

JSC::EncodedJSValue CRYPTO_HASH_FINALIZED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_HASH_FINALIZED, "Digest already called"_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_HASH_UPDATE_FAILED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_HASH_UPDATE_FAILED, "Hash update failed"_s));
    return {};
}

JSC::EncodedJSValue CRYPTO_TIMING_SAFE_EQUAL_LENGTH(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject)
{
    auto message = "Input buffers must have the same byte length"_s;
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH, message));
    return {};
}

JSC::EncodedJSValue CRYPTO_UNKNOWN_DH_GROUP(JSC::ThrowScope& scope, JSGlobalObject* globalObject)
{
    auto message = "Unknown DH group"_s;
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_UNKNOWN_DH_GROUP, message));
    return {};
}

JSC::EncodedJSValue OSSL_EVP_INVALID_DIGEST(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_OSSL_EVP_INVALID_DIGEST, "Invalid digest used"_s));
    return {};
}

JSC::EncodedJSValue MISSING_PASSPHRASE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_MISSING_PASSPHRASE, message));
    return {};
}

JSC::EncodedJSValue KEY_GENERATION_JOB_FAILED(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject)
{
    auto message = "Key generation job failed"_s;
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_KEY_GENERATION_JOB_FAILED, message));
    return {};
}

JSC::EncodedJSValue INCOMPATIBLE_OPTION_PAIR(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, ASCIILiteral opt1, ASCIILiteral opt2)
{
    WTF::StringBuilder builder;
    builder.append("Option \""_s);
    builder.append(opt1);
    builder.append("\" cannot be used in combination with option \""_s);
    builder.append(opt2);
    builder.append("\""_s);

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INCOMPATIBLE_OPTION_PAIR, builder.toString()));
    return {};
}

JSC::EncodedJSValue MISSING_OPTION(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral message)
{
    WTF::StringBuilder builder;
    builder.append(message);
    builder.append(" is required"_s);
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_MISSING_OPTION, builder.toString()));
    return {};
}

JSC::EncodedJSValue INVALID_MIME_SYNTAX(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, const String& part, const String& input, int position)
{
    WTF::StringBuilder builder;
    builder.append("The MIME syntax for a "_s);
    builder.append(part);
    builder.append(" in "_s);
    builder.append(input);

    builder.append(" is invalid"_s);
    if (position != -1) {
        builder.append(" at "_s);
        builder.append(String::number(position));
    }

    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_MIME_SYNTAX, builder.toString()));
    return {};
}

EncodedJSValue CLOSED_MESSAGE_PORT(ThrowScope& scope, JSGlobalObject* globalObject)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CLOSED_MESSAGE_PORT, "Cannot send data on closed MessagePort"_s));
    return {};
}

JSC::EncodedJSValue INVALID_THIS(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral expectedType)
{
    WTF::StringBuilder builder;
    builder.append("Value of \"this\" must be of type "_s);
    builder.append(expectedType);
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_THIS, builder.toString()));
    return {};
}

JSC::EncodedJSValue DLOPEN_DISABLED(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral message)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_DLOPEN_DISABLED, message));
    return {};
}

} // namespace ERR

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
    auto* jsNameString = name.toString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto nameView = jsNameString->view(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    ASCIILiteral type = nameView->contains('.') ? "property"_s : "argument"_s;
    WTF::StringBuilder builder;

    RETURN_IF_EXCEPTION(throwScope, {});

    ASSERT(reason.isUndefined() || reason.isString());

    builder.append("The "_s);
    builder.append(type);
    builder.append(" '"_s);
    builder.append(nameView);
    builder.append("'"_s);

    if (reason.isUndefined()) {
        builder.append(" is invalid. Received "_s);
        JSValueToStringSafe(globalObject, builder, value, true);
        RETURN_IF_EXCEPTION(throwScope, {});
        return createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString());
    }

    auto* jsReasonString = reason.toString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto reasonView = jsReasonString->view(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    builder.append(' ');
    builder.append(reasonView);
    builder.append(". Received "_s);
    JSValueToStringSafe(globalObject, builder, value, true);
    RETURN_IF_EXCEPTION(throwScope, {});
    return createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, builder.toString());
}

extern "C" JSC::EncodedJSValue Bun__createErrorWithCode(JSC::JSGlobalObject* globalObject, ErrorCode code, BunString* message)
{
    return JSValue::encode(createError(globalObject, code, message->toWTFString(BunString::ZeroCopy)));
}

void throwBoringSSLError(JSC::VM& vm, JSC::ThrowScope& scope, JSGlobalObject* globalObject, int errorCode)
{
    char buf[256] = { 0 };
    ERR_error_string_n(static_cast<uint32_t>(errorCode), buf, sizeof(buf));
    auto message = String::fromUTF8(buf);
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_STATE, message));
}

void throwCryptoOperationFailed(JSGlobalObject* globalObject, JSC::ThrowScope& scope)
{
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Crypto operation failed"_s));
}

} // namespace Bun

extern "C" JSC::EncodedJSValue Bun__wrapAbortError(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue causeParam)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto cause = JSC::JSValue::decode(causeParam);

    if (cause.isUndefined()) {
        return JSC::JSValue::encode(Bun::createError(vm, globalObject, Bun::ErrorCode::ABORT_ERR, JSC::JSValue(globalObject->commonStrings().OperationWasAbortedString(globalObject))));
    }

    auto message = globalObject->commonStrings().OperationWasAbortedString(globalObject);
    JSC::JSObject* options = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 24);
    options->putDirect(vm, JSC::Identifier::fromString(vm, "cause"_s), cause);

    auto error = Bun::createError(vm, globalObject, Bun::ErrorCode::ABORT_ERR, message, options);
    return JSC::JSValue::encode(error);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionMakeAbortError, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto message = callFrame->argument(0);
    auto options = callFrame->argument(1);
    if (!options.isUndefined() && options.isCell() && !options.asCell()->isObject()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, options);

    if (message.isUndefined() && options.isUndefined()) {
        return JSValue::encode(Bun::createError(vm, lexicalGlobalObject, Bun::ErrorCode::ABORT_ERR, JSValue(globalObject->commonStrings().OperationWasAbortedString(globalObject))));
    }

    if (message.isUndefined()) message = globalObject->commonStrings().OperationWasAbortedString(globalObject);
    auto error = Bun::createError(vm, globalObject, Bun::ErrorCode::ABORT_ERR, message, options);
    return JSC::JSValue::encode(error);
}

JSC::JSValue WebCore::toJS(JSC::JSGlobalObject* globalObject, CommonAbortReason abortReason)
{
    switch (abortReason) {
    case CommonAbortReason::Timeout: {
        return createDOMException(globalObject, ExceptionCode::TimeoutError, "The operation timed out."_s);
    }
    case CommonAbortReason::UserAbort: {
        return createDOMException(globalObject, ExceptionCode::AbortError, "The operation was aborted."_s);
    }
    case CommonAbortReason::ConnectionClosed: {
        return createDOMException(globalObject, ExceptionCode::AbortError, "The connection was closed."_s);
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
    WTF::StringBuilder builder;
    builder.append("Expected this to be instanceof "_s);
    builder.append(typeName);
    builder.append(", but received "_s);
    determineSpecificType(JSC::getVM(globalObject), globalObject, builder, thisValue);
    return Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_THIS, builder.toString());
}

JSC::EncodedJSValue Bun::throwError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, Bun::ErrorCode code, const WTF::String& message)
{
    scope.throwException(globalObject, createError(globalObject, code, message));
    return {};
}

JSC_DEFINE_HOST_FUNCTION(Bun::jsFunctionMakeErrorWithCode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    EXPECT_ARG_COUNT(1);

    JSC::JSValue codeValue = callFrame->argument(0);
    RETURN_IF_EXCEPTION(scope, {});

#if ASSERT_ENABLED
    if (!codeValue.isNumber()) {
        JSC::throwTypeError(globalObject, scope, "First argument to $ERR_ must be a number"_s);
        return {};
    }
#endif

    int code = codeValue.toInt32(globalObject);

#if ASSERT_ENABLED
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

        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::StringBuilder builder;
        builder.append("Invalid IP address: "_s);
        builder.append(param);
        return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_IP_ADDRESS, builder.toString()));
    }

    case Bun::ErrorCode::ERR_INVALID_MIME_SYNTAX: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg2 = callFrame->argument(3);
        auto str2 = arg2.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return ERR::INVALID_MIME_SYNTAX(scope, globalObject, str0, str1, str2);
    }

    case Bun::ErrorCode::ERR_INVALID_ADDRESS_FAMILY: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg2 = callFrame->argument(3);
        auto str2 = arg2.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid address family: "_s, str0, " "_s, str1, ":"_s, str2);
        auto err = createError(globalObject, ErrorCode::ERR_INVALID_ADDRESS_FAMILY, message);
        err->putDirect(vm, builtinNames(vm).hostPublicName(), arg1, 0);
        err->putDirect(vm, builtinNames(vm).portPublicName(), arg2, 0);
        return JSC::JSValue::encode(err);
    }

    case Bun::ErrorCode::ERR_INVALID_ARG_VALUE: {
        JSValue arg0 = callFrame->argument(1);
        JSValue arg1 = callFrame->argument(2);
        JSValue arg2 = callFrame->argument(3);
        return JSValue::encode(ERR_INVALID_ARG_VALUE(scope, globalObject, arg0, arg1, arg2));
    }

    case Bun::ErrorCode::ERR_UNKNOWN_ENCODING: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("Unknown encoding: "_s);
        builder.append(param);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_STREAM_DESTROYED: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("Cannot call "_s);
        builder.append(param);
        builder.append(" after a stream was destroyed"_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_METHOD_NOT_IMPLEMENTED: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("The "_s);
        builder.append(param);
        builder.append(" method is not implemented"_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_STREAM_ALREADY_FINISHED: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("Cannot call "_s);
        builder.append(param);
        builder.append(" after a stream was finished"_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_MISSING_ARGS: {
        switch (callFrame->argumentCount()) {
        case 0: {
            UNREACHABLE();
        }
        case 1: {
            ASSERT("At least one arg needs to be specified");
        }
        case 2: {
            JSValue arg0 = callFrame->argument(1);
            // ["foo", "bar", "baz"] -> 'The "foo", "bar", or "baz" argument must be specified'
            if (auto* arr = jsDynamicCast<JSC::JSArray*>(arg0)) {
                ASSERT(arr->length() > 0);
                WTF::StringBuilder builder;
                builder.append("The "_s);
                for (unsigned i = 0, length = arr->length(); i < length; i++) {
                    JSValue index = arr->getIndex(globalObject, i);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (i == length - 1) builder.append("or "_s);
                    builder.append('"');
                    auto* jsString = index.toString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    auto str = jsString->view(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    builder.append(str);
                    builder.append('"');
                    if (i != length - 1) builder.append(',');
                    builder.append(' ');
                }
                builder.append("argument must be specified"_s);
                return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
            }

            auto* jsString = arg0.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto str0 = jsString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            WTF::StringBuilder builder;
            builder.append("The \""_s);
            builder.append(str0);
            builder.append("\" argument must be specified"_s);
            return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
        }
        case 3: {
            JSValue arg0 = callFrame->argument(1);
            auto* jsString = arg0.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto str0 = jsString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue arg1 = callFrame->argument(2);
            auto* jsString1 = arg1.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto str1 = jsString1->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            WTF::StringBuilder builder;
            builder.append("The \""_s);
            builder.append(str0);
            builder.append("\" and \""_s);
            builder.append(str1);
            builder.append("\" arguments must be specified"_s);
            return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
        }
        default: {
            WTF::StringBuilder result;
            result.append("The "_s);
            auto argumentCount = callFrame->argumentCount();
            for (int i = 1; i < argumentCount; i += 1) {
                if (i == argumentCount - 1) result.append("and "_s);
                result.append('"');
                JSValue arg = callFrame->argument(i);
                auto* jsString = arg.toString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                auto str = jsString->view(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                result.append(str);
                result.append('"');
                if (i != argumentCount - 1) result.append(',');
                result.append(' ');
            }
            result.append("arguments must be specified"_s);
            return JSC::JSValue::encode(createError(globalObject, error, result.toString()));
        }
        }
    }

    case Bun::ErrorCode::ERR_INVALID_RETURN_VALUE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto view0 = str0->view(globalObject);

        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto view1 = str1->view(globalObject);

        auto arg2 = callFrame->argument(3);

        WTF::StringBuilder messageBuilder;
        messageBuilder.append("Expected "_s);
        messageBuilder.append(view0);
        messageBuilder.append(" to be returned from the \""_s);
        messageBuilder.append(view1);
        messageBuilder.append("\" function but got "_s);
        determineSpecificType(JSC::getVM(globalObject), globalObject, messageBuilder, arg2);
        RETURN_IF_EXCEPTION(scope, {});
        messageBuilder.append('.');

        return JSC::JSValue::encode(createError(globalObject, error, messageBuilder.toString()));
    }

    case Bun::ErrorCode::ERR_OUT_OF_RANGE: {
        auto arg0 = callFrame->argument(1);
        auto arg1 = callFrame->argument(2);
        auto arg2 = callFrame->argument(3);
        return JSC::JSValue::encode(createError(globalObject, error, Message::ERR_OUT_OF_RANGE(scope, globalObject, arg0, arg1, arg2)));
    }

    case Bun::ErrorCode::ERR_INVALID_STATE:
    case Bun::ErrorCode::ERR_INVALID_STATE_TypeError:
    case Bun::ErrorCode::ERR_INVALID_STATE_RangeError: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("Invalid state: "_s);
        builder.append(param);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_INVALID_PROTOCOL: {
        auto arg0 = callFrame->argument(1);
        auto* jsString0 = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param0 = jsString0->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto* jsString1 = arg1.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param1 = jsString1->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("Protocol \""_s);
        builder.append(param0);
        builder.append("\" not supported. Expected \""_s);
        builder.append(param1);
        builder.append("\""_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_BROTLI_INVALID_PARAM: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append(param);
        builder.append(" is not a valid Brotli parameter"_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_BUFFER_TOO_LARGE: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringBuilder builder;
        builder.append("Cannot create a Buffer larger than "_s);
        builder.append(param);
        builder.append(" bytes"_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_UNHANDLED_ERROR: {
        auto arg0 = callFrame->argument(1);

        if (arg0.isUndefined()) {
            auto message = "Unhandled error."_s;
            return JSC::JSValue::encode(createError(globalObject, error, message));
        }
        if (arg0.isCell()) {
            auto cell = arg0.asCell();
            if (cell->inherits<JSC::Exception>()) {
                return JSC::JSValue::encode(jsCast<JSC::Exception*>(cell)->value());
            }
        }

        if (arg0.isString()) {
            auto* jsString = arg0.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto str0 = jsString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            WTF::StringBuilder builder;
            builder.append("Unhandled error. ("_s);
            builder.append(str0);
            builder.append(")"_s);
            return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
        }

        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto str0 = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::StringBuilder builder;
        builder.append("Unhandled error. ("_s);
        builder.append(str0);
        builder.append(")"_s);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case Bun::ErrorCode::ERR_INVALID_THIS: {
        auto arg0 = callFrame->argument(1);
        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto str0 = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::StringBuilder builder;
        builder.append("Value of \"this\" must be of type "_s);
        builder.append(str0);
        return JSC::JSValue::encode(createError(globalObject, error, builder.toString()));
    }

    case ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS: {
        auto arg0 = callFrame->argument(1);
        if (!arg0.isUndefined()) {
            auto* jsString = arg0.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto str0 = jsString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            WTF::StringBuilder builder;
            builder.append("\""_s);
            builder.append(str0);
            builder.append("\" is outside of buffer bounds"_s);
            return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, builder.toString()));
        }
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, "Attempt to access memory outside buffer bounds"_s));
    }

    case Bun::ErrorCode::ERR_TLS_INVALID_PROTOCOL_VERSION: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " is not a valid "_s, str1, " TLS protocol version"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_TLS_INVALID_PROTOCOL_VERSION, message));
    }

    case Bun::ErrorCode::ERR_TLS_PROTOCOL_VERSION_CONFLICT: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("TLS protocol version "_s, str0, " conflicts with secureProtocol "_s, str1);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_TLS_PROTOCOL_VERSION_CONFLICT, message));
    }

    case Bun::ErrorCode::ERR_TLS_CERT_ALTNAME_INVALID: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto arg2 = callFrame->argument(3);
        auto message = makeString("Hostname/IP does not match certificate's altnames: "_s, str0);
        auto err = createError(globalObject, ErrorCode::ERR_TLS_CERT_ALTNAME_INVALID, message);
        err->putDirect(vm, Identifier::fromString(vm, "reason"_s), arg0);
        err->putDirect(vm, Identifier::fromString(vm, "host"_s), arg1);
        err->putDirect(vm, Identifier::fromString(vm, "cert"_s), arg2);
        return JSC::JSValue::encode(err);
    }

    case Bun::ErrorCode::ERR_USE_AFTER_CLOSE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " was closed"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_USE_AFTER_CLOSE, message));
    }

    case Bun::ErrorCode::ERR_INVALID_HTTP_TOKEN: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " must be a valid HTTP token [\""_s, str1, "\"]"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_HTTP_TOKEN, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_INVALID_HEADER_VALUE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid value \""_s, str0, "\" for header \""_s, str1, "\""_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INVALID_HEADER_VALUE, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_STATUS_INVALID: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid status code: "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_STATUS_INVALID, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_INVALID_PSEUDOHEADER: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("\""_s, str0, "\" is an invalid pseudoheader or is used incorrectly"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INVALID_PSEUDOHEADER, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_STREAM_ERROR: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Stream closed with error code "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_STREAM_ERROR, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_SESSION_ERROR: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Session closed with error code "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_SESSION_ERROR, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_PAYLOAD_FORBIDDEN: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Responses with "_s, str0, " status must not have a payload"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_PAYLOAD_FORBIDDEN, message));
    }

    case Bun::ErrorCode::ERR_HTTP2_INVALID_INFO_STATUS: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid informational status code: "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INVALID_INFO_STATUS, message));
    }

    case Bun::ErrorCode::ERR_INVALID_URL: {
        auto arg0 = callFrame->argument(1);
        auto arg1 = callFrame->argument(2);
        // Don't include URL in message. (See https://github.com/nodejs/node/pull/38614)
        auto err = createError(globalObject, ErrorCode::ERR_INVALID_URL, "Invalid URL"_s);
        err->putDirect(vm, vm.propertyNames->input, arg0);
        if (!arg1.isUndefinedOrNull()) err->putDirect(vm, Identifier::fromString(vm, "base"_s), arg1);
        return JSC::JSValue::encode(err);
    }

    case Bun::ErrorCode::ERR_INVALID_CHAR: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        WTF::StringBuilder builder;
        builder.append("Invalid character in "_s);
        builder.append(str0);
        if (!arg1.isUndefined()) {
            auto str1 = arg1.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            builder.append(" [\""_s);
            builder.append(str1);
            builder.append("\"]"_s);
        }
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_CHAR, builder.toString()));
    }

    case Bun::ErrorCode::ERR_HTTP_INVALID_HEADER_VALUE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid value \""_s, str0, "\" for header \""_s, str1, "\""_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP_INVALID_HEADER_VALUE, message));
    }

    case Bun::ErrorCode::ERR_HTTP_HEADERS_SENT: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Cannot "_s, str0, " headers after they are sent to the client"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP_HEADERS_SENT, message));
    }

    case Bun::ErrorCode::ERR_UNESCAPED_CHARACTERS: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " contains unescaped characters"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_UNESCAPED_CHARACTERS, message));
    }

    case Bun::ErrorCode::ERR_HTTP_INVALID_STATUS_CODE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid status code: "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP_INVALID_STATUS_CODE, message));
    }

    case Bun::ErrorCode::ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid key object type "_s, str0, ", expected "_s, str1, "."_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE, message));
    }

    case Bun::ErrorCode::ERR_CRYPTO_INCOMPATIBLE_KEY: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Incompatible "_s, str0, ": "_s, str1);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_CRYPTO_INCOMPATIBLE_KEY, message));
    }

    case Bun::ErrorCode::ERR_CHILD_PROCESS_IPC_REQUIRED: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Forked processes must have an IPC channel, missing value 'ipc' in "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_CHILD_PROCESS_IPC_REQUIRED, message));
    }

    case Bun::ErrorCode::ERR_INVALID_ASYNC_ID: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid "_s, str0, " value: "_s, str1);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ASYNC_ID, message));
    }

    case Bun::ErrorCode::ERR_ASYNC_TYPE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Invalid name for async \"type\": "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_ASYNC_TYPE, message));
    }

    case Bun::ErrorCode::ERR_ASYNC_CALLBACK: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " must be a function"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_ASYNC_CALLBACK, message));
    }

    case Bun::ErrorCode::ERR_AMBIGUOUS_ARGUMENT: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto arg1 = callFrame->argument(2);
        auto str1 = arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("The \""_s, str0, "\" argument is ambiguous. "_s, str1);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_AMBIGUOUS_ARGUMENT, message));
    }

    case Bun::ErrorCode::ERR_INVALID_FD_TYPE: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Unsupported fd type: "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_FD_TYPE, message));
    }

    case Bun::ErrorCode::ERR_CHILD_PROCESS_STDIO_MAXBUFFER: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " maxBuffer length exceeded"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_CHILD_PROCESS_STDIO_MAXBUFFER, message));
    }

    case Bun::ErrorCode::ERR_IP_BLOCKED: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("IP("_s, str0, ") is blocked by net.BlockList"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_IP_BLOCKED, message));
    }

    case Bun::ErrorCode::ERR_VM_MODULE_STATUS: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString("Module status "_s, str0);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_VM_MODULE_STATUS, message));
    }

    case Bun::ErrorCode::ERR_VM_MODULE_LINK_FAILURE: {
        auto arg0 = callFrame->argument(1);
        auto message = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto cause = callFrame->argument(2);
        JSObject* error = createError(globalObject, ErrorCode::ERR_VM_MODULE_LINK_FAILURE, message);
        RETURN_IF_EXCEPTION(scope, {});
        error->putDirect(vm, Identifier::fromString(vm, "cause"_s), cause);
        RETURN_IF_EXCEPTION(scope, {});
        return JSC::JSValue::encode(error);
    }

    case Bun::ErrorCode::ERR_ZSTD_INVALID_PARAM: {
        auto arg0 = callFrame->argument(1);
        auto str0 = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto message = makeString(str0, " is not a valid zstd parameter"_s);
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_ZSTD_INVALID_PARAM, message));
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
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_DGRAM_NOT_RUNNING, "Socket is not running"_s));
    case ErrorCode::ERR_INVALID_CURSOR_POS:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_CURSOR_POS, "Cannot set cursor row without setting its column"_s));
    case ErrorCode::ERR_INVALID_HANDLE_TYPE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_HANDLE_TYPE, "This handle type cannot be sent"_s));
    case ErrorCode::ERR_MULTIPLE_CALLBACK:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_MULTIPLE_CALLBACK, "Callback called multiple times"_s));
    case ErrorCode::ERR_STREAM_PREMATURE_CLOSE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_PREMATURE_CLOSE, "Premature close"_s));
    case ErrorCode::ERR_STREAM_NULL_VALUES:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_NULL_VALUES, "May not write null values to stream"_s));
    case ErrorCode::ERR_STREAM_CANNOT_PIPE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_CANNOT_PIPE, "Cannot pipe, not readable"_s));
    case ErrorCode::ERR_STREAM_WRITE_AFTER_END:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_WRITE_AFTER_END, "write after end"_s));
    case ErrorCode::ERR_STREAM_UNSHIFT_AFTER_END_EVENT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_UNSHIFT_AFTER_END_EVENT, "stream.unshift() after end event"_s));
    case ErrorCode::ERR_STREAM_PUSH_AFTER_EOF:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_PUSH_AFTER_EOF, "stream.push() after EOF"_s));
    case ErrorCode::ERR_STREAM_UNABLE_TO_PIPE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_UNABLE_TO_PIPE, "Cannot pipe to a closed or destroyed stream"_s));
    case ErrorCode::ERR_ILLEGAL_CONSTRUCTOR:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s));
    case ErrorCode::ERR_DIR_CLOSED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_DIR_CLOSED, "Directory handle was closed"_s));
    case ErrorCode::ERR_SERVER_ALREADY_LISTEN:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SERVER_ALREADY_LISTEN, "Listen method has been called more than once without closing."_s));
    case ErrorCode::ERR_SOCKET_CLOSED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_CLOSED, "Socket is closed"_s));
    case ErrorCode::ERR_SOCKET_CLOSED_BEFORE_CONNECTION:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_CLOSED_BEFORE_CONNECTION, "Socket closed before the connection was established"_s));
    case ErrorCode::ERR_TLS_RENEGOTIATION_DISABLED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_TLS_RENEGOTIATION_DISABLED, "TLS session renegotiation disabled for this socket"_s));
    case ErrorCode::ERR_UNAVAILABLE_DURING_EXIT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_UNAVAILABLE_DURING_EXIT, "Cannot call function in process exit handler"_s));
    case ErrorCode::ERR_TLS_CERT_ALTNAME_FORMAT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_TLS_CERT_ALTNAME_FORMAT, "Invalid subject alternative name string"_s));
    case ErrorCode::ERR_TLS_SNI_FROM_SERVER:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_TLS_SNI_FROM_SERVER, "Cannot issue SNI from a TLS server-side socket"_s));
    case ErrorCode::ERR_SSL_NO_CIPHER_MATCH: {
        auto err = createError(globalObject, ErrorCode::ERR_SSL_NO_CIPHER_MATCH, "No cipher match"_s);

        auto reason = JSC::jsString(vm, WTF::String("no cipher match"_s));
        err->putDirect(vm, Identifier::fromString(vm, "reason"_s), reason);

        auto library = JSC::jsString(vm, WTF::String("SSL routines"_s));
        err->putDirect(vm, Identifier::fromString(vm, "library"_s), library);

        return JSC::JSValue::encode(err);
    }
    case ErrorCode::ERR_INVALID_URI:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_URI, "URI malformed"_s));
    case ErrorCode::ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED, "Cannot set HTTP/2 pseudo-headers"_s));
    case ErrorCode::ERR_HTTP2_INFO_STATUS_NOT_ALLOWED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INFO_STATUS_NOT_ALLOWED, "Informational status codes cannot be used"_s));
    case ErrorCode::ERR_HTTP2_HEADERS_SENT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_HEADERS_SENT, "Response has already been initiated."_s));
    case ErrorCode::ERR_HTTP2_INVALID_STREAM:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INVALID_STREAM, "The stream has been destroyed"_s));
    case ErrorCode::ERR_HTTP2_NO_SOCKET_MANIPULATION:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_NO_SOCKET_MANIPULATION, "HTTP/2 sockets should not be directly manipulated (e.g. read and written)"_s));
    case ErrorCode::ERR_HTTP2_SOCKET_UNBOUND:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_SOCKET_UNBOUND, "The socket has been disconnected from the Http2Session"_s));
    case ErrorCode::ERR_HTTP2_MAX_PENDING_SETTINGS_ACK:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_MAX_PENDING_SETTINGS_ACK, "Maximum number of pending settings acknowledgements"_s));
    case ErrorCode::ERR_HTTP2_INVALID_SESSION:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INVALID_SESSION, "The session has been destroyed"_s));
    case ErrorCode::ERR_HTTP2_TRAILERS_ALREADY_SENT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_TRAILERS_ALREADY_SENT, "Trailing headers have already been sent"_s));
    case ErrorCode::ERR_HTTP2_TRAILERS_NOT_READY:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_TRAILERS_NOT_READY, "Trailing headers cannot be sent until after the wantTrailers event is emitted"_s));
    case ErrorCode::ERR_HTTP2_SEND_FILE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_SEND_FILE, "Directories cannot be sent"_s));
    case ErrorCode::ERR_HTTP2_SEND_FILE_NOSEEK:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_SEND_FILE_NOSEEK, "Offset or length can only be specified for regular files"_s));
    case ErrorCode::ERR_HTTP2_PUSH_DISABLED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_PUSH_DISABLED, "HTTP/2 client has disabled push streams"_s));
    case ErrorCode::ERR_HTTP2_HEADERS_AFTER_RESPOND:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_HEADERS_AFTER_RESPOND, "Cannot specify additional headers after response initiated"_s));
    case ErrorCode::ERR_HTTP2_STATUS_101:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_STATUS_101, "HTTP status code 101 (Switching Protocols) is forbidden in HTTP/2"_s));
    case ErrorCode::ERR_HTTP2_ALTSVC_INVALID_ORIGIN:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_ALTSVC_INVALID_ORIGIN, "HTTP/2 ALTSVC frames require a valid origin"_s));
    case ErrorCode::ERR_HTTP2_INVALID_ORIGIN:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_INVALID_ORIGIN, "HTTP/2 ORIGIN frames require a valid origin"_s));
    case ErrorCode::ERR_HTTP2_ALTSVC_LENGTH:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_ALTSVC_LENGTH, "HTTP/2 ALTSVC frames are limited to 16382 bytes"_s));
    case ErrorCode::ERR_HTTP2_PING_LENGTH:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_PING_LENGTH, "HTTP2 ping payload must be 8 bytes"_s));
    case ErrorCode::ERR_HTTP2_OUT_OF_STREAMS:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP2_OUT_OF_STREAMS, "No stream ID is available because maximum stream ID has been reached"_s));
    case ErrorCode::ERR_HTTP_BODY_NOT_ALLOWED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP_BODY_NOT_ALLOWED, "Adding content for this request method or response status is not allowed."_s));
    case ErrorCode::ERR_HTTP_SOCKET_ASSIGNED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_HTTP_SOCKET_ASSIGNED, "Socket already assigned"_s));
    case ErrorCode::ERR_STREAM_RELEASE_LOCK:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_STREAM_RELEASE_LOCK, "Stream reader cancelled via releaseLock()"_s));
    case ErrorCode::ERR_SOCKET_CONNECTION_TIMEOUT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_SOCKET_CONNECTION_TIMEOUT, "Socket connection timeout"_s));
    case ErrorCode::ERR_TLS_HANDSHAKE_TIMEOUT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_TLS_HANDSHAKE_TIMEOUT, "TLS handshake timeout"_s));
    case ErrorCode::ERR_VM_MODULE_ALREADY_LINKED:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_VM_MODULE_ALREADY_LINKED, "Module has already been linked"_s));
    case ErrorCode::ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA, "Cached data cannot be created for a module which has been evaluated"_s));
    case ErrorCode::ERR_VM_MODULE_NOT_MODULE:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_VM_MODULE_NOT_MODULE, "Provided module is not an instance of Module"_s));
    case ErrorCode::ERR_VM_MODULE_DIFFERENT_CONTEXT:
        return JSC::JSValue::encode(createError(globalObject, ErrorCode::ERR_VM_MODULE_DIFFERENT_CONTEXT, "Linked modules must use the same context"_s));

    default: {
        break;
    }
    }

    auto&& message = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(createError(globalObject, error, message));
}
