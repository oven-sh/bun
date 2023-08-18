#include "root.h"
#include "BunObject.h"
#include "ZigGlobalObject.h"
#include "JSDOMURL.h"
#include "helpers.h"
#include "IDLTypes.h"
#include "DOMURL.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSBase.h"
#include "JavaScriptCore/BuiltinNames.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "headers.h"
#include "BunObject.lut.h"
#include "JavaScriptCore/JSObject.h"

#include "BunObject+exports.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

extern "C" JSC::EncodedJSValue Bun__fetch(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);

static JSValue BunObject__ArrayBufferSink__property(JSGlobalObject* globalObject, JSObject*)
{
    return jsCast<Zig::GlobalObject*>(globalObject)->ArrayBufferSink();
}

static JSValue constructEnvObject(JSGlobalObject* globalObject, JSObject*)
{
    return jsCast<Zig::GlobalObject*>(globalObject)->processEnvObject();
}

static inline EncodedJSValue flattenArrayOfBuffersIntoArrayBuffer(JSGlobalObject* lexicalGlobalObject, JSValue arrayValue)
{
    auto& vm = lexicalGlobalObject->vm();

    auto clientData = WebCore::clientData(vm);
    if (arrayValue.isUndefinedOrNull() || !arrayValue) {
        return JSC::JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1)));
    }

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto array = JSC::jsDynamicCast<JSC::JSArray*>(arrayValue);
    if (UNLIKELY(!array)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Argument must be an array"_s);
        return JSValue::encode(jsUndefined());
    }

    size_t arrayLength = array->length();
    if (arrayLength < 1) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1))));
    }

    size_t byteLength = 0;
    bool any_buffer = false;
    bool any_typed = false;

    for (size_t i = 0; i < arrayLength; i++) {
        auto element = array->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(throwScope, {});

        if (auto* typedArray = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(element)) {
            if (UNLIKELY(typedArray->isDetached())) {
                throwTypeError(lexicalGlobalObject, throwScope, "ArrayBufferView is detached"_s);
                return JSValue::encode(jsUndefined());
            }
            byteLength += typedArray->byteLength();
            any_typed = true;
        } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(element)) {
            auto* impl = arrayBuffer->impl();
            if (UNLIKELY(!impl)) {
                throwTypeError(lexicalGlobalObject, throwScope, "ArrayBuffer is detached"_s);
                return JSValue::encode(jsUndefined());
            }

            byteLength += impl->byteLength();
            any_buffer = true;
        } else {
            throwTypeError(lexicalGlobalObject, throwScope, "Expected TypedArray"_s);
            return JSValue::encode(jsUndefined());
        }
    }

    if (byteLength == 0) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1))));
    }

    auto buffer = JSC::ArrayBuffer::tryCreateUninitialized(byteLength, 1);
    if (UNLIKELY(!buffer)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Failed to allocate ArrayBuffer"_s);
        return JSValue::encode(jsUndefined());
    }

    size_t remain = byteLength;
    auto* head = reinterpret_cast<char*>(buffer->data());

    if (!any_buffer) {
        for (size_t i = 0; i < arrayLength && remain > 0; i++) {
            auto element = array->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(throwScope, {});
            auto* view = JSC::jsCast<JSC::JSArrayBufferView*>(element);
            size_t length = std::min(remain, view->byteLength());
            memcpy(head, view->vector(), length);
            remain -= length;
            head += length;
        }
    } else if (!any_typed) {
        for (size_t i = 0; i < arrayLength && remain > 0; i++) {
            auto element = array->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(throwScope, {});
            auto* view = JSC::jsCast<JSC::JSArrayBuffer*>(element);
            size_t length = std::min(remain, view->impl()->byteLength());
            memcpy(head, view->impl()->data(), length);
            remain -= length;
            head += length;
        }
    } else {
        for (size_t i = 0; i < arrayLength && remain > 0; i++) {
            auto element = array->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(throwScope, {});
            size_t length = 0;
            if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(element)) {
                length = std::min(remain, view->impl()->byteLength());
                memcpy(head, view->impl()->data(), length);
            } else {
                auto* typedArray = JSC::jsCast<JSC::JSArrayBufferView*>(element);
                length = std::min(remain, typedArray->byteLength());
                memcpy(head, typedArray->vector(), length);
            }

            remain -= length;
            head += length;
        }
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), WTFMove(buffer))));
}

JSC_DEFINE_HOST_FUNCTION(functionConcatTypedArrays, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }

    auto arrayValue = callFrame->uncheckedArgument(0);

    return flattenArrayOfBuffersIntoArrayBuffer(globalObject, arrayValue);
}

JSC_DECLARE_HOST_FUNCTION(functionConcatTypedArrays);

static JSValue constructVersion(JSGlobalObject* globalObject, JSObject*)
{
    return JSC::jsString(globalObject->vm(), makeString(Bun__version + 1));
}

static JSValue constructRevision(JSGlobalObject* globalObject, JSObject*)
{
    return JSC::jsString(globalObject->vm(), makeString(Bun__version_sha));
}

static JSValue constructIsMainThread(JSGlobalObject* globalObject, JSObject*)
{
    return jsBoolean(jsCast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext()->isMainThread());
}

static JSValue constructPluginObject(JSGlobalObject* globalObject, JSObject* bunObject)
{
    auto& vm = globalObject->vm();
    JSFunction* pluginFunction = JSFunction::create(vm, globalObject, 1, String("plugin"_s), jsFunctionBunPlugin, ImplementationVisibility::Public, NoIntrinsic);
    pluginFunction->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "clearAll"_s), 1, jsFunctionBunPluginClear, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);

    return pluginFunction;
}

extern "C" EncodedJSValue JSPasswordObject__create(JSGlobalObject*);

static JSValue constructPasswordObject(JSGlobalObject* globalObject, JSObject* bunObject)
{
    return JSValue::decode(JSPasswordObject__create(globalObject));
}

extern "C" EncodedJSValue Bun__DNSResolver__lookup(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolve(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveSrv(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveTxt(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveSoa(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveNaptr(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveMx(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveCaa(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveNs(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolvePtr(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__resolveCname(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__getServers(JSGlobalObject*, JSC::CallFrame*);

static JSValue constructDNSObject(JSGlobalObject* globalObject, JSObject* bunObject)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSObject* dnsObject = JSC::constructEmptyObject(globalObject);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookup"_s), 2, Bun__DNSResolver__lookup, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolve"_s), 2, Bun__DNSResolver__resolve, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSrv"_s), 2, Bun__DNSResolver__resolveSrv, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveTxt"_s), 2, Bun__DNSResolver__resolveTxt, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSoa"_s), 2, Bun__DNSResolver__resolveSoa, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNaptr"_s), 2, Bun__DNSResolver__resolveNaptr, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveMx"_s), 2, Bun__DNSResolver__resolveMx, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCaa"_s), 2, Bun__DNSResolver__resolveCaa, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNs"_s), 2, Bun__DNSResolver__resolveNs, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolvePtr"_s), 2, Bun__DNSResolver__resolvePtr, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCname"_s), 2, Bun__DNSResolver__resolveCname, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getServers"_s), 2, Bun__DNSResolver__getServers, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
    return dnsObject;
}

static JSValue constructBunPeekObject(JSGlobalObject* globalObject, JSObject* bunObject)
{
    JSC::VM& vm = globalObject->vm();
    JSC::Identifier identifier = JSC::Identifier::fromString(vm, "peek"_s);
    JSFunction* peekFunction = JSFunction::create(vm, globalObject, 2, WTF::String("peek"_s), functionBunPeek, ImplementationVisibility::Public, NoIntrinsic);
    JSFunction* peekStatus = JSFunction::create(vm, globalObject, 1, WTF::String("status"_s), functionBunPeekStatus, ImplementationVisibility::Public, NoIntrinsic);
    peekFunction->putDirect(vm, PropertyName(JSC::Identifier::fromString(vm, "status"_s)), peekStatus, JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    return peekFunction;
}

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(functionBunEscapeHTMLWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject*, JSObject*, JSString*));

JSC_DEFINE_HOST_FUNCTION(functionBunSleepThenCallback,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    RELEASE_ASSERT(callFrame->argumentCount() == 1);
    JSPromise* promise = jsCast<JSC::JSPromise*>(callFrame->argument(0));
    RELEASE_ASSERT(promise);

    promise->resolve(globalObject, JSC::jsUndefined());

    return JSC::JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(functionBunPeek,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue promiseValue = callFrame->argument(0);
    if (UNLIKELY(!promiseValue)) {
        return JSValue::encode(jsUndefined());
    } else if (!promiseValue.isCell()) {
        return JSValue::encode(promiseValue);
    }

    auto* promise = jsDynamicCast<JSPromise*>(promiseValue);

    if (!promise) {
        return JSValue::encode(promiseValue);
    }

    JSValue invalidateValue = callFrame->argument(1);
    bool invalidate = invalidateValue.isBoolean() && invalidateValue.asBoolean();

    switch (promise->status(vm)) {
    case JSPromise::Status::Pending: {
        break;
    }
    case JSPromise::Status::Fulfilled: {
        JSValue result = promise->result(vm);
        if (invalidate) {
            promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, jsUndefined());
        }
        return JSValue::encode(result);
    }
    case JSPromise::Status::Rejected: {
        JSValue result = promise->result(vm);
        JSC::EnsureStillAliveScope ensureStillAliveScope(result);

        if (invalidate) {
            promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32() | JSC::JSPromise::isHandledFlag));
            promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, JSC::jsUndefined());
        }

        return JSValue::encode(result);
    }
    }

    return JSValue::encode(promiseValue);
}

JSC_DEFINE_HOST_FUNCTION(functionBunPeekStatus,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    static NeverDestroyed<String> fulfilled = MAKE_STATIC_STRING_IMPL("fulfilled");

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue promiseValue = callFrame->argument(0);
    if (!promiseValue || !promiseValue.isCell()) {
        return JSValue::encode(jsOwnedString(vm, fulfilled));
    }

    auto* promise = jsDynamicCast<JSPromise*>(promiseValue);

    if (!promise) {
        return JSValue::encode(jsOwnedString(vm, fulfilled));
    }

    switch (promise->status(vm)) {
    case JSPromise::Status::Pending: {
        static NeverDestroyed<String> pending = MAKE_STATIC_STRING_IMPL("pending");
        return JSValue::encode(jsOwnedString(vm, pending));
    }
    case JSPromise::Status::Fulfilled: {
        return JSValue::encode(jsOwnedString(vm, fulfilled));
    }
    case JSPromise::Status::Rejected: {
        static NeverDestroyed<String> rejected = MAKE_STATIC_STRING_IMPL("rejected");
        return JSValue::encode(jsOwnedString(vm, rejected));
    }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionBunSleep,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue millisecondsValue = callFrame->argument(0);

    if (millisecondsValue.inherits<JSC::DateInstance>()) {
        auto now = MonotonicTime::now();
        auto milliseconds = jsCast<JSC::DateInstance*>(millisecondsValue)->internalNumber() - now.approximateWallTime().secondsSinceEpoch().milliseconds();
        millisecondsValue = JSC::jsNumber(milliseconds > 0 ? milliseconds : 0);
    }

    if (!millisecondsValue.isNumber()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "sleep expects a number (milliseconds)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    Zig::GlobalObject* global = JSC::jsCast<Zig::GlobalObject*>(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Timer__setTimeout(globalObject, JSC::JSValue::encode(global->bunSleepThenCallback()), JSC::JSValue::encode(millisecondsValue), JSValue::encode(promise));
    return JSC::JSValue::encode(promise);
}

extern "C" EncodedJSValue Bun__escapeHTML8(JSGlobalObject* globalObject, EncodedJSValue input, const LChar* ptr, size_t length);
extern "C" EncodedJSValue Bun__escapeHTML16(JSGlobalObject* globalObject, EncodedJSValue input, const UChar* ptr, size_t length);

// JSC_DEFINE_JIT_OPERATION(functionBunEscapeHTMLWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSObject* castedglobalObject, JSString* string))
// {
//     JSC::VM& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
//     size_t length = string->length();
//     if (!length)
//         return JSValue::encode(string);

//     auto resolvedString = string->value(lexicalGlobalObject);
//     if (!resolvedString.is8Bit()) {
//         return Bun__escapeHTML16(lexicalGlobalObject, JSValue::encode(string), resolvedString.characters16(), length);
//     } else {
//         return Bun__escapeHTML8(lexicalGlobalObject, JSValue::encode(string), resolvedString.characters8(), length);
//     }
// }

JSC_DEFINE_HOST_FUNCTION(functionBunEscapeHTML, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = JSC::getVM(lexicalGlobalObject);
    JSC::JSValue argument = callFrame->argument(0);
    if (argument.isEmpty())
        return JSValue::encode(jsEmptyString(vm));
    if (argument.isNumber() || argument.isBoolean())
        return JSValue::encode(argument.toString(lexicalGlobalObject));

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto string = argument.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    size_t length = string->length();
    if (!length)
        RELEASE_AND_RETURN(scope, JSValue::encode(string));

    auto resolvedString = string->value(lexicalGlobalObject);
    EncodedJSValue encodedInput = JSValue::encode(string);
    if (!resolvedString.is8Bit()) {
        RELEASE_AND_RETURN(scope, Bun__escapeHTML16(lexicalGlobalObject, encodedInput, resolvedString.characters16(), length));
    } else {
        RELEASE_AND_RETURN(scope, Bun__escapeHTML8(lexicalGlobalObject, encodedInput, resolvedString.characters8(), length));
    }
}

JSC_DEFINE_HOST_FUNCTION(functionBunDeepEquals, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    JSC::VM& vm = global->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 values to compare"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue arg1 = callFrame->uncheckedArgument(0);
    JSC::JSValue arg2 = callFrame->uncheckedArgument(1);
    JSC::JSValue arg3 = callFrame->argument(2);

    Vector<std::pair<JSValue, JSValue>, 16> stack;

    if (arg3.isBoolean() && arg3.asBoolean()) {
        bool isEqual = Bun__deepEquals<true, false>(globalObject, arg1, arg2, stack, &scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    } else {
        bool isEqual = Bun__deepEquals<false, false>(globalObject, arg1, arg2, stack, &scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    }
}

JSC_DEFINE_HOST_FUNCTION(functionBunDeepMatch, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    JSC::VM& vm = global->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 values to compare"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue subset = callFrame->uncheckedArgument(0);
    JSC::JSValue object = callFrame->uncheckedArgument(1);

    if (!subset.isObject() || !object.isObject()) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 objects to match"_s);
        return JSValue::encode(jsUndefined());
    }

    bool match = Bun__deepMatch<false>(object, subset, globalObject, &scope, false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(match));
}

JSC_DEFINE_HOST_FUNCTION(functionBunNanoseconds, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    uint64_t time = Bun__readOriginTimer(global->bunVM());
    return JSValue::encode(jsNumber(time));
}

JSC_DEFINE_HOST_FUNCTION(functionPathToFileURL, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& globalObject = *reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto path = JSC::JSValue::encode(callFrame->argument(0));

    JSC::JSString* pathString = JSC::JSValue::decode(path).toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

    auto fileURL = WTF::URL::fileURLWithFileSystemPath(pathString->value(lexicalGlobalObject));
    auto object = WebCore::DOMURL::create(fileURL.string(), String());
    auto jsValue = toJSNewlyCreated<IDLInterface<DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTFMove(object));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsValue));
}

JSC_DEFINE_HOST_FUNCTION(functionFileURLToPath, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arg0 = callFrame->argument(0);
    auto path = JSC::JSValue::encode(arg0);
    auto* domURL = WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(path);
    if (!domURL) {
        if (arg0.isString()) {
            auto url = WTF::URL(arg0.toWTFString(globalObject));
            if (UNLIKELY(!url.protocolIs("file"_s))) {
                throwTypeError(globalObject, scope, "Argument must be a file URL"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
            RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, url.fileSystemPath())));
        }
        throwTypeError(globalObject, scope, "Argument must be a URL"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto& url = domURL->href();
    if (UNLIKELY(!url.protocolIs("file"_s))) {
        throwTypeError(globalObject, scope, "Argument must be a file URL"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    return JSC::JSValue::encode(JSC::jsString(vm, url.fileSystemPath()));
}

JSC_DEFINE_HOST_FUNCTION(functionHashCode,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue stringToHash = callFrame->argument(0);
    JSC::JSString* str = stringToHash.toStringOrNull(globalObject);
    if (!str) {
        return JSC::JSValue::encode(jsNumber(0));
    }

    auto view = str->value(globalObject);
    return JSC::JSValue::encode(jsNumber(view.hash()));
}

// static const struct HashTableValue JSBunObjectTableValues[]
//     = {
//           { "ArrayBufferSink"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__ArrayBufferSink__property } },
//           { "CryptoHasher"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__CryptoHasher__property } },
//           { "DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump_functionType, 1 } },
//           { "FFI"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__FFI__property } },
//           { "FileSystemRouter"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__FileSystemRouter__property } },
//           { "MD4"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__MD4__property } },
//           { "MD5"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__MD5__property } },
//           { "SHA1"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__SHA1__property } },
//           { "SHA224"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__SHA224__property } },
//           { "SHA256"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__SHA256__property } },
//           { "SHA384"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__SHA384__property } },
//           { "SHA512"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__SHA512__property } },
//           { "SHA512_256"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__SHA512_256__property } },
//           { "TOML"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__TOML__property } },
//           { "Transpiler"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__Transpiler__property } },
//           { "_Os"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject___Os_functionType, 1 } },
//           { "_Path"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject___Path_functionType, 1 } },
//           { "allocUnsafe"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__allocUnsafe_functionType, 1 } },
//           { "argv"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__argv__property } },
//           { "assetPrefix"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__assetPrefix__property } },
//           { "build"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__build_functionType, 1 } },
//           { "concatArrayBuffers"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionConcatTypedArraysType, 1 } },
//           { "connect"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__connect_functionType, 1 } },
//           { "cwd"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__cwd__property } },
//           { "deepEquals"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunDeepEqualsType, 2 } },
//           { "deepMatch"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunDeepMatchType, 2 } },
//           { "escapeHTML"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunEscapeHTMLType, 2 } },
//           { "deflateSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__deflateSync_functionType, 1 } },
//           { "dns"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, constructDNSObject } },
//           { "enableANSIColors"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__enableANSIColors__property } },
//           { "env"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, constructEnvObject } },
//           { "fetch"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, &Bun__fetchType, 1 } },
//           { "file"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__file_functionType, 1 } },
//           { "fileURLToPath"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionFileURLToPathType, 1 } },
//           { "fs"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__fs_functionType, 1 } },
//           { "gc"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__gc_functionType, 1 } },
//           { "generateHeapSnapshot"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__generateHeapSnapshot_functionType, 1 } },
//           { "getImportedStyles"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__getImportedStyles_functionType, 1 } },
//           { "getPublicPath"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__getPublicPath_functionType, 1 } },
//           { "getRouteFiles"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__getRouteFiles_functionType, 1 } },
//           { "getRouteNames"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__getRouteNames_functionType, 1 } },
//           { "gunzipSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__gunzipSync_functionType, 1 } },
//           { "gzipSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__gzipSync_functionType, 1 } },
//           { "hash"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__hash__property } },
//           { "indexOfLine"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__indexOfLine_functionType, 1 } },
//           { "inflateSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__inflateSync_functionType, 1 } },
//           { "inspect"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__inspect_functionType, 1 } },
//           { "isMainThread"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, constructIsMainThread } },
//           { "jest"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__jest_functionType, 1 } },
//           { "listen"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__listen_functionType, 1 } },
//           { "main"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__main__property } },
//           { "match"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__match_functionType, 1 } },
//           { "mmap"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__mmap_functionType, 1 } },
//           { "nanoseconds"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunNanoseconds, 0 } },
//           { "openInEditor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__openInEditor_functionType, 1 } },
//           { "origin"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__origin__property } },
//           { "password"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, constructPasswordObject } },
//           { "pathToFileURL"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionPathToFileURLType, 1 } },
//           { "plugin"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, constructIsMainThread } },
//           { "readableStreamToArray"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin, JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, readableStreamReadableStreamToArrayCodeGenerator, 1 } },
//           { "readableStreamToArrayBuffer"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin, JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, readableStreamReadableStreamToArrayBufferCodeGenerator, 1 } },
//           { "readableStreamToBlob"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin, JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, readableStreamReadableStreamToBlobCodeGenerator, 1 } },
//           { "readableStreamToFormData"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin, JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, readableStreamReadableStreamToFormDataCodeGenerator, 1 } },
//           { "readableStreamToJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin, JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, readableStreamReadableStreamToJSONCodeGenerator, 1 } },
//           { "readableStreamToText"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin, JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, readableStreamReadableStreamToTextCodeGenerator, 1 } },
//           { "registerMacro"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__registerMacro_functionType, 1 } },
//           { "resolve"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__resolve_functionType, 1 } },
//           { "resolveSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__resolveSync_functionType, 1 } },
//           { "routesDir"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__routesDir__property } },
//           { "serve"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__serve_functionType, 1 } },
//           { "sha"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__sha_functionType, 1 } },
//           { "shrink"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__shrink_functionType, 1 } },
//           { "sleep"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunSleepType, 1 } },
//           { "sleepSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__sleepSync_functionType, 1 } },
//           { "spawn"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__spawn_functionType, 1 } },
//           { "spawnSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__spawnSync_functionType, 1 } },
//           { "stderr"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__stderr__property } },
//           { "stdin"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__stdin__property } },
//           { "stdout"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__stdout__property } },
//           { "stringHashCode"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionHashCodeType, 1 } },
//           { "unsafe"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, BunObject__unsafe__property } },
//           { "which"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__which_functionType, 1 } },
//           { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, BunObject__write_functionType, 1 } },
//       };

/* Source for BunObject.lut.h
@begin bunObjectTable
    ArrayBufferSink                                BunObject__ArrayBufferSink__property                                      DontDelete|PropertyCallback
    CryptoHasher                                   BunObject__CryptoHasher__property                                         DontDelete|PropertyCallback
    DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump  BunObject__DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump_functionType     DontEnum|DontDelete|Function 1
    FFI                                            BunObject__FFI__property                                                  DontDelete|PropertyCallback
    FileSystemRouter                               BunObject__FileSystemRouter__property                                     DontDelete|PropertyCallback
    MD4                                            BunObject__MD4__property                                                  DontDelete|PropertyCallback
    MD5                                            BunObject__MD5__property                                                  DontDelete|PropertyCallback
    SHA1                                           BunObject__SHA1__property                                                 DontDelete|PropertyCallback
    SHA224                                         BunObject__SHA224__property                                               DontDelete|PropertyCallback
    SHA256                                         BunObject__SHA256__property                                               DontDelete|PropertyCallback
    SHA384                                         BunObject__SHA384__property                                               DontDelete|PropertyCallback
    SHA512                                         BunObject__SHA512__property                                               DontDelete|PropertyCallback
    SHA512_256                                     BunObject__SHA512_256__property                                           DontDelete|PropertyCallback
    TOML                                           BunObject__TOML__property                                                 DontDelete|PropertyCallback
    Transpiler                                     BunObject__Transpiler__property                                           DontDelete|PropertyCallback
    _Os                                            BunObject___Os_functionType                                               DontEnum|DontDelete|Function 1
    _Path                                          BunObject___Path_functionType                                             DontEnum|DontDelete|Function 1
    allocUnsafe                                    BunObject__allocUnsafe_functionType                                       DontDelete|Function 1
    argv                                           BunObject__argv__property                                                 DontDelete|PropertyCallback
    assetPrefix                                    BunObject__assetPrefix__property                                          DontEnum|DontDelete|PropertyCallback
    build                                          BunObject__build_functionType                                             DontDelete|Function 1
    concatArrayBuffers                             functionConcatTypedArraysType                                             DontDelete|Function 1
    connect                                        BunObject__connect_functionType                                           DontDelete|Function 1
    cwd                                            BunObject__cwd__property                                                  DontEnum|DontDelete|PropertyCallback
    deepEquals                                     functionBunDeepEqualsType                                                 DontDelete|Function 2
    deepMatch                                      functionBunDeepMatchType                                                  DontDelete|Function 2
    deflateSync                                    BunObject__deflateSync_functionType                                       DontDelete|Function 1
    dns                                            constructDNSObject                                                        ReadOnly|DontDelete|PropertyCallback
    enableANSIColors                               BunObject__enableANSIColors__property                                     DontDelete|PropertyCallback
    env                                            constructEnvObject                                                        ReadOnly|DontDelete|PropertyCallback
    escapeHTML                                     functionBunEscapeHTMLType                                                 DontDelete|Function 2
    fetch                                          Bun__fetchType                                                            ReadOnly|DontDelete|Function 1
    file                                           BunObject__file_functionType                                              DontDelete|Function 1
    fileURLToPath                                  functionFileURLToPathType                                                 DontDelete|Function 1
    fs                                             BunObject__fs_functionType                                                DontEnum|DontDelete|Function 1
    gc                                             BunObject__gc_functionType                                                DontDelete|Function 1
    generateHeapSnapshot                           BunObject__generateHeapSnapshot_functionType                              DontDelete|Function 1
    getImportedStyles                              BunObject__getImportedStyles_functionType                                 DontEnum|DontDelete|Function 1
    getPublicPath                                  BunObject__getPublicPath_functionType                                     DontDelete|Function 1
    getRouteFiles                                  BunObject__getRouteFiles_functionType                                     DontEnum|DontDelete|Function 1
    getRouteNames                                  BunObject__getRouteNames_functionType                                     DontEnum|DontDelete|Function 1
    gunzipSync                                     BunObject__gunzipSync_functionType                                        DontDelete|Function 1
    gzipSync                                       BunObject__gzipSync_functionType                                          DontDelete|Function 1
    hash                                           BunObject__hash__property                                                 DontDelete|PropertyCallback
    indexOfLine                                    BunObject__indexOfLine_functionType                                       DontDelete|Function 1
    inflateSync                                    BunObject__inflateSync_functionType                                       DontDelete|Function 1
    inspect                                        BunObject__inspect_functionType                                           DontDelete|Function 1
    isMainThread                                   constructIsMainThread                                                     ReadOnly|DontDelete|PropertyCallback
    jest                                           BunObject__jest_functionType                                              DontEnum|DontDelete|Function 1
    listen                                         BunObject__listen_functionType                                            DontDelete|Function 1
    main                                           BunObject__main__property                                                 DontDelete|PropertyCallback
    match                                          BunObject__match_functionType                                             DontEnum|DontDelete|Function 1
    mmap                                           BunObject__mmap_functionType                                              DontDelete|Function 1
    nanoseconds                                    functionBunNanoseconds                                                    DontDelete|Function 0
    openInEditor                                   BunObject__openInEditor_functionType                                      DontDelete|Function 1
    origin                                         BunObject__origin__property                                               DontDelete|PropertyCallback
    password                                       constructPasswordObject                                                   DontDelete|PropertyCallback
    pathToFileURL                                  functionPathToFileURLType                                                 DontDelete|Function 1
    plugin                                         constructIsMainThread                                                     ReadOnly|DontDelete|PropertyCallback
    readableStreamToArray                          JSBuiltin                                                                 Builtin|Function 1
    readableStreamToArrayBuffer                    JSBuiltin                                                                 Builtin|Function 1
    readableStreamToBlob                           JSBuiltin                                                                 Builtin|Function 1
    readableStreamToFormData                       JSBuiltin                                                                 Builtin|Function 1
    readableStreamToJSON                           JSBuiltin                                                                 Builtin|Function 1
    readableStreamToText                           JSBuiltin                                                                 Builtin|Function 1
    registerMacro                                  BunObject__registerMacro_functionType                                     DontEnum|DontDelete|Function 1
    resolve                                        BunObject__resolve_functionType                                           DontDelete|Function 1
    resolveSync                                    BunObject__resolveSync_functionType                                       DontDelete|Function 1
    routesDir                                      BunObject__routesDir__property                                            DontEnum|DontDelete|PropertyCallback
    serve                                          BunObject__serve_functionType                                             DontDelete|Function 1
    sha                                            BunObject__sha_functionType                                               DontDelete|Function 1
    shrink                                         BunObject__shrink_functionType                                            DontDelete|Function 1
    sleep                                          functionBunSleepType                                                      DontDelete|Function 1
    sleepSync                                      BunObject__sleepSync_functionType                                         DontDelete|Function 1
    spawn                                          BunObject__spawn_functionType                                             DontDelete|Function 1
    spawnSync                                      BunObject__spawnSync_functionType                                         DontDelete|Function 1
    stderr                                         BunObject__stderr__property                                               DontDelete|PropertyCallback
    stdin                                          BunObject__stdin__property                                                DontDelete|PropertyCallback
    stdout                                         BunObject__stdout__property                                               DontDelete|PropertyCallback
    stringHashCode                                 functionHashCodeType                                                      DontDelete|Function 1
    unsafe                                         BunObject__unsafe__property                                               DontDelete|PropertyCallback
    which                                          BunObject__which_functionType                                             DontDelete|Function 1
    write                                          BunObject__write_functionType                                             DontDelete|Function 1
@end
*/

class JSBunObject : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    JSBunObject(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    DECLARE_INFO;

    static constexpr bool needsDestruction = false;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSBunObject* create(JSC::VM& vm, JSGlobalObject* globalObject)
    {
        auto* object = new (NotNull, JSC::allocateCell<JSBunObject>(vm)) JSBunObject(vm, createStructure(vm, globalObject, globalObject->objectPrototype()));
        object->finishCreation(vm);
        return object;
    }
};

const JSC::ClassInfo JSBunObject::s_info = { "Bun"_s, &Base::s_info, &bunObjectTable, nullptr, CREATE_METHOD_TABLE(JSBunObject) };

JSValue createBunObject(Zig::GlobalObject* globalObject)
{
    return JSBunObject::create(globalObject->vm(), globalObject);
}

}
