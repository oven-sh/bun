
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
#include <openssl/err.h>
#include "ErrorCode.h"
#include "ErrorStackTrace.h"

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

static JSC::JSObject* createErrorPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code, bool isDOMExceptionPrototype)
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
static Structure* createErrorStructure(JSC::VM& vm, JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code, bool isDOMExceptionPrototype)
{
    auto* prototype = createErrorPrototype(vm, globalObject, type, name, code, isDOMExceptionPrototype);
    return ErrorInstance::createStructure(vm, globalObject, prototype);
}

JSObject* ErrorCodeCache::createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options, bool isDOMExceptionPrototype)
{
    auto* cache = errorCache(globalObject);
    const auto& data = errors[static_cast<size_t>(code)];
    if (!cache->internalField(static_cast<unsigned>(code))) {
        auto* structure = createErrorStructure(vm, globalObject, data.type, data.name, data.code, isDOMExceptionPrototype);
        cache->internalField(static_cast<unsigned>(code)).set(vm, cache, structure);
    }

    auto* structure = jsCast<Structure*>(cache->internalField(static_cast<unsigned>(code)).get());
    return JSC::ErrorInstance::create(globalObject, structure, message, options, nullptr, JSC::RuntimeType::TypeNothing, data.type, true);
}

JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, const String& message, bool isDOMExceptionPrototype)
{
    return errorCache(globalObject)->createError(vm, globalObject, code, jsString(vm, message), jsUndefined(), isDOMExceptionPrototype);
}

JSObject* createError(Zig::GlobalObject* globalObject, ErrorCode code, const String& message, bool isDOMExceptionPrototype)
{
    return createError(globalObject->vm(), globalObject, code, message, isDOMExceptionPrototype);
}

JSObject* createError(VM& vm, JSC::JSGlobalObject* globalObject, ErrorCode code, const String& message, bool isDOMExceptionPrototype)
{
    return createError(vm, defaultGlobalObject(globalObject), code, message, isDOMExceptionPrototype);
}

JSObject* createError(VM& vm, JSC::JSGlobalObject* globalObject, ErrorCode code, JSValue message, bool isDOMExceptionPrototype)
{
    if (auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject))
        return createError(vm, zigGlobalObject, code, message, jsUndefined(), isDOMExceptionPrototype);

    auto* structure = createErrorStructure(vm, globalObject, errors[static_cast<size_t>(code)].type, errors[static_cast<size_t>(code)].name, errors[static_cast<size_t>(code)].code, isDOMExceptionPrototype);
    return JSC::ErrorInstance::create(globalObject, structure, message, jsUndefined(), nullptr, JSC::RuntimeType::TypeNothing, errors[static_cast<size_t>(code)].type, true);
}

JSC::JSObject* createError(VM& vm, Zig::GlobalObject* globalObject, ErrorCode code, JSValue message, JSValue options, bool isDOMExceptionPrototype)
{
    return errorCache(globalObject)->createError(vm, globalObject, code, message, options, isDOMExceptionPrototype);
}

JSObject* createError(JSC::JSGlobalObject* globalObject, ErrorCode code, const String& message, bool isDOMExceptionPrototype)
{
    return createError(globalObject->vm(), globalObject, code, message, isDOMExceptionPrototype);
}

JSObject* createError(Zig::JSGlobalObject* globalObject, ErrorCode code, JSC::JSValue message, bool isDOMExceptionPrototype)
{
    auto& vm = JSC::getVM(globalObject);
    return createError(vm, globalObject, code, message, isDOMExceptionPrototype);
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
                    const auto span = str->span<UChar>();
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
        const bool needsEscape = str->contains('"');
        if (needsEllipsis) {
            view = str->substring(0, 25);
        }
        builder.append("type string ("_s);
        if (UNLIKELY(needsEscape)) {
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
                const auto span = view.span<UChar>();
                for (const auto c : span) {
                    if (c == '"') {
                        builder.append("\\\""_s);
                    } else {
                        builder.append(c);
                    }
                }
            }
        } else {
            builder.append('"');
            builder.append(view);
        }
        if (needsEllipsis) {
            builder.append("..."_s);
        }
        builder.append('"');
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

JSC::EncodedJSValue INVALID_ARG_TYPE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& arg_name, const WTF::String& expected_type, JSC::JSValue val_actual_value)
{
    auto message = Message::ERR_INVALID_ARG_TYPE(throwScope, globalObject, arg_name, expected_type, val_actual_value);
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
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
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

    auto* structure = createErrorStructure(vm, globalObject, ErrorType::RangeError, "RangeError"_s, "ERR_INVALID_ARG_VALUE"_s, false);
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

JSC::EncodedJSValue CRYPTO_JWK_UNSUPPORTED_CURVE(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::String& curve)
{
    auto message = makeString("Unsupported JWK EC curve: "_s, curve);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_CRYPTO_JWK_UNSUPPORTED_CURVE, message));
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionMakeAbortError, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto message = callFrame->argument(0);
    auto options = callFrame->argument(1);
    if (!options.isUndefined() && options.isCell() && !options.asCell()->isObject()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, options);

    if (message.isUndefined() && options.isUndefined()) {
        return JSValue::encode(Bun::createError(vm, lexicalGlobalObject, Bun::ErrorCode::ABORT_ERR, JSValue(globalObject->commonStrings().OperationWasAbortedString(globalObject)), false));
    }

    if (message.isUndefined()) message = globalObject->commonStrings().OperationWasAbortedString(globalObject);
    auto error = Bun::createError(vm, globalObject, Bun::ErrorCode::ABORT_ERR, message, options, false);
    return JSC::JSValue::encode(error);
}

JSC::JSValue WebCore::toJS(JSC::JSGlobalObject* globalObject, CommonAbortReason abortReason)
{
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    switch (abortReason) {
    case CommonAbortReason::Timeout: {
        return createError(globalObject, Bun::ErrorCode::ABORT_ERR, zigGlobalObject->commonStrings().OperationWasAbortedString(globalObject), true);
    }
    case CommonAbortReason::UserAbort: {
        // This message is a standardized error message. We cannot change it.
        // https://webidl.spec.whatwg.org/#idl-DOMException:~:text=The%20operation%20was%20aborted.
        return createError(globalObject, Bun::ErrorCode::ABORT_ERR, zigGlobalObject->commonStrings().OperationWasAbortedString(globalObject), true);
    }
    case CommonAbortReason::ConnectionClosed: {
        return createError(globalObject, Bun::ErrorCode::ABORT_ERR, zigGlobalObject->commonStrings().ConnectionWasClosedString(globalObject), true);
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

        auto* jsString = arg0.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto param = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::StringBuilder builder;
        builder.append("Invalid IP address: "_s);
        builder.append(param);
        return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_IP_ADDRESS, builder.toString()));
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

    default: {
        break;
    }
    }

    auto&& message = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(createError(globalObject, error, message));
}
