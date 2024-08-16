
#include "root.h"

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
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/MakeString.h"
#include "wtf/text/WTFString.h"
#include "AbortSignal.h"
#include "JavaScriptCore/ErrorInstanceInlines.h"
#include "JavaScriptCore/JSInternalFieldObjectImplInlines.h"
#include "JSDOMException.h"

#include "ErrorCode.h"

extern "C" Zig::GlobalObject* Bun__getDefaultGlobalObject();

static JSC::JSObject* createErrorPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ErrorType type, WTF::ASCIILiteral name, WTF::ASCIILiteral code, bool isDOMExceptionPrototype = false)
{
    JSC::JSObject* prototype;

    // Inherit from DOMException
    // But preserve the error.stack property.
    if (isDOMExceptionPrototype) {
        auto* domGlobalObject = JSC::jsDynamicCast<Zig::GlobalObject*>(globalObject);
        if (UNLIKELY(!domGlobalObject)) {
            domGlobalObject = Bun__getDefaultGlobalObject();
        }
        // TODO: node:vm?
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
extern "C" JSC::EncodedJSValue Bun__ERR_IPC_CHANNEL_CLOSED(JSC::JSGlobalObject* globalObject);

// clang-format on

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
        return arg.toString(globalObject)->getString(globalObject);

    auto cell = arg.asCell();
    auto jstype = cell->type();

    if (jstype == JSC::JSType::StringType) {
        return cell->toStringInline(globalObject)->getString(globalObject);
    }
    if (jstype == JSC::JSType::SymbolType) {
        auto symbol = jsCast<Symbol*>(cell);
        auto result = symbol->tryGetDescriptiveString();
        if (result.has_value())
            return result.value();
    }
    return arg.toString(globalObject)->getString(globalObject);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_INVALID_ARG_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount < 3) {
        JSC::throwTypeError(globalObject, scope, "requires 3 arguments"_s);
        return {};
    }
    auto arg_name = callFrame->argument(0);
    auto expected_type = callFrame->argument(1);
    auto actual_value = callFrame->argument(2);
    return Bun__ERR_INVALID_ARG_TYPE(globalObject, JSValue::encode(arg_name), JSValue::encode(expected_type), JSValue::encode(actual_value));
}
extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue val_arg_name, JSC::EncodedJSValue val_expected_type, JSC::EncodedJSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto arg_name = JSValue::decode(val_arg_name).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto expected_type = JSValue::decode(val_expected_type).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto actual_value = JSValueToStringSafe(globalObject, JSValue::decode(val_actual_value));
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("The \""_s, arg_name, "\" argument must be of type "_s, expected_type, ". Received "_s, actual_value);
    return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
}
extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE_static(JSC::JSGlobalObject* globalObject, const ZigString* val_arg_name, const ZigString* val_expected_type, JSC::EncodedJSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto arg_name = std::span<const unsigned char>(val_arg_name->ptr, val_arg_name->len);
    ASSERT(WTF::charactersAreAllASCII(arg_name));

    auto expected_type = std::span<const unsigned char>(val_expected_type->ptr, val_expected_type->len);
    ASSERT(WTF::charactersAreAllASCII(expected_type));

    auto actual_value = JSValueToStringSafe(globalObject, JSValue::decode(val_actual_value));
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("The \""_s, arg_name, "\" argument must be of type "_s, expected_type, ". Received "_s, actual_value);
    return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, message));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount < 3) {
        JSC::throwTypeError(globalObject, scope, "requires 3 arguments"_s);
        return {};
    }

    auto arg_name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto range = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto input = callFrame->argument(2).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be "_s, range, ". Received "_s, input);
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
