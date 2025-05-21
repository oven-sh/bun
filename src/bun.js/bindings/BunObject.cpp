
#include "root.h"

#include "JavaScriptCore/HeapProfiler.h"
#include <JavaScriptCore/HeapSnapshotBuilder.h>
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JSDOMURL.h"
#include "helpers.h"
#include "IDLTypes.h"
#include "DOMURL.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSBase.h>
#include <JavaScriptCore/BuiltinNames.h>
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
#include "BunObject.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/JSObject.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "Exception.h"
#include "JSDOMException.h"
#include "JSDOMConvert.h"
#include "wtf/Compiler.h"
#include "PathInlines.h"
#include "wtf/text/ASCIILiteral.h"
#include "BunObject+exports.h"
#include "ErrorCode.h"
#include "GeneratedBunObject.h"
#include "JavaScriptCore/BunV8HeapSnapshotBuilder.h"
#include "BunObjectModule.h"
#include "JSCookie.h"
#include "JSCookieMap.h"

#ifdef WIN32
#include <ws2def.h>
#else
#include <netdb.h>
#endif

BUN_DECLARE_HOST_FUNCTION(Bun__DNS__lookup);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolve);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveSrv);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveTxt);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveSoa);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveNaptr);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveMx);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveCaa);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveNs);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolvePtr);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveCname);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__resolveAny);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__getServers);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__setServers);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__reverse);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__lookupService);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__prefetch);
BUN_DECLARE_HOST_FUNCTION(Bun__DNS__getCacheStats);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__new);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__cancel);
BUN_DECLARE_HOST_FUNCTION(Bun__fetch);
BUN_DECLARE_HOST_FUNCTION(Bun__fetchPreconnect);
BUN_DECLARE_HOST_FUNCTION(Bun__randomUUIDv7);

using namespace JSC;
using namespace WebCore;

namespace Bun {

extern "C" bool has_bun_garbage_collector_flag_enabled;

static JSValue BunObject_getter_wrap_ArrayBufferSink(VM& vm, JSObject* bunObject)
{
    return jsCast<Zig::GlobalObject*>(bunObject->globalObject())->ArrayBufferSink();
}

static JSValue constructCookieObject(VM& vm, JSObject* bunObject);
static JSValue constructCookieMapObject(VM& vm, JSObject* bunObject);

static JSValue constructEnvObject(VM& vm, JSObject* object)
{
    return jsCast<Zig::GlobalObject*>(object->globalObject())->processEnvObject();
}

static inline JSC::EncodedJSValue flattenArrayOfBuffersIntoArrayBufferOrUint8Array(JSGlobalObject* lexicalGlobalObject, JSValue arrayValue, size_t maxLength, bool asUint8Array)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);

    if (arrayValue.isUndefinedOrNull() || !arrayValue) {
        return JSC::JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1)));
    }

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto array = JSC::jsDynamicCast<JSC::JSArray*>(arrayValue);
    if (UNLIKELY(!array)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Argument must be an array"_s);
        return {};
    }

    size_t arrayLength = array->length();
    const auto returnEmptyArrayBufferView = [&]() -> EncodedJSValue {
        if (asUint8Array) {
            return JSValue::encode(
                JSC::JSUint8Array::create(
                    lexicalGlobalObject,
                    lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject),
                    0));
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1))));
    };

    if (arrayLength < 1) {
        return returnEmptyArrayBufferView();
    }

    size_t byteLength = 0;
    bool any_buffer = false;
    bool any_typed = false;

    // Use an argument buffer to avoid calling `getIndex` more than once per element.
    // This is a small optimization
    MarkedArgumentBuffer args;
    args.ensureCapacity(arrayLength);
    if (UNLIKELY(args.hasOverflowed())) {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return {};
    }

    for (size_t i = 0; i < arrayLength; i++) {
        auto element = array->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(throwScope, {});

        if (auto* typedArray = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(element)) {
            if (UNLIKELY(typedArray->isDetached())) {
                return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject, "Cannot validate on a detached buffer"_s);
            }
            size_t current = typedArray->byteLength();
            any_typed = true;
            byteLength += current;

            if (current > 0) {
                args.append(typedArray);
            }
        } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(element)) {
            auto* impl = arrayBuffer->impl();
            if (UNLIKELY(!impl)) {
                return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject, "Cannot validate on a detached buffer"_s);
            }

            size_t current = impl->byteLength();
            any_buffer = true;

            if (current > 0) {
                args.append(arrayBuffer);
            }

            byteLength += current;
        } else {
            throwTypeError(lexicalGlobalObject, throwScope, "Expected TypedArray"_s);
            return {};
        }
    }
    byteLength = std::min(byteLength, maxLength);

    if (byteLength == 0) {
        return returnEmptyArrayBufferView();
    }

    auto buffer = JSC::ArrayBuffer::tryCreateUninitialized(byteLength, 1);
    if (UNLIKELY(!buffer)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Failed to allocate ArrayBuffer"_s);
        return {};
    }

    size_t remain = byteLength;
    auto* head = reinterpret_cast<char*>(buffer->data());

    if (!any_buffer) {
        for (size_t i = 0; i < args.size(); i++) {
            auto element = args.at(i);
            RETURN_IF_EXCEPTION(throwScope, {});
            auto* view = JSC::jsCast<JSC::JSArrayBufferView*>(element);
            size_t length = std::min(remain, view->byteLength());
            memcpy(head, view->vector(), length);
            remain -= length;
            head += length;
        }
    } else if (!any_typed) {
        for (size_t i = 0; i < args.size(); i++) {
            auto element = args.at(i);
            RETURN_IF_EXCEPTION(throwScope, {});
            auto* view = JSC::jsCast<JSC::JSArrayBuffer*>(element);
            size_t length = std::min(remain, view->impl()->byteLength());
            memcpy(head, view->impl()->data(), length);
            remain -= length;
            head += length;
        }
    } else {
        for (size_t i = 0; i < args.size(); i++) {
            auto element = args.at(i);
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

    if (asUint8Array) {
        auto uint8array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), WTFMove(buffer), 0, byteLength);
        return JSValue::encode(uint8array);
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), WTFMove(buffer))));
}

JSC_DEFINE_HOST_FUNCTION(functionConcatTypedArrays, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return {};
    }

    auto arrayValue = callFrame->uncheckedArgument(0);

    size_t maxLength = std::numeric_limits<size_t>::max();
    auto arg1 = callFrame->argument(1);
    if (!arg1.isUndefined() && arg1.isNumber()) {
        double number = arg1.toNumber(globalObject);
        if (std::isnan(number) || number < 0) {
            throwRangeError(globalObject, throwScope, "Maximum length must be >= 0"_s);
            return {};
        }
        if (!std::isinf(number)) {
            maxLength = arg1.toUInt32(globalObject);
        }
    }

    bool asUint8Array = false;
    auto arg2 = callFrame->argument(2);
    if (!arg2.isUndefined()) {
        asUint8Array = arg2.toBoolean(globalObject);
    }

    return flattenArrayOfBuffersIntoArrayBufferOrUint8Array(globalObject, arrayValue, maxLength, asUint8Array);
}

JSC_DECLARE_HOST_FUNCTION(functionConcatTypedArrays);

static JSValue constructBunVersion(VM& vm, JSObject*)
{
    return JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__version + 1)));
}

static JSValue constructBunRevision(VM& vm, JSObject*)
{
    return JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__version_sha)));
}

static JSValue constructBunVersionWithSha(VM& vm, JSObject*)
{
    return JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__version_with_sha)));
}

static JSValue constructIsMainThread(VM&, JSObject* object)
{
    return jsBoolean(jsCast<Zig::GlobalObject*>(object->globalObject())->scriptExecutionContext()->isMainThread());
}

static JSValue constructPluginObject(VM& vm, JSObject* bunObject)
{
    auto* globalObject = bunObject->globalObject();
    JSFunction* pluginFunction = JSFunction::create(vm, globalObject, 1, String("plugin"_s), jsFunctionBunPlugin, ImplementationVisibility::Public, NoIntrinsic);
    pluginFunction->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "clearAll"_s), 1, jsFunctionBunPluginClear, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    return pluginFunction;
}

static JSValue defaultBunSQLObject(VM& vm, JSObject* bunObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(bunObject->globalObject());
    JSValue sqlValue = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::BunSql);
    RETURN_IF_EXCEPTION(scope, {});
    return sqlValue.getObject()->get(globalObject, vm.propertyNames->defaultKeyword);
}

static JSValue constructBunSQLObject(VM& vm, JSObject* bunObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(bunObject->globalObject());
    JSValue sqlValue = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::BunSql);
    RETURN_IF_EXCEPTION(scope, {});
    auto clientData = WebCore::clientData(vm);
    return sqlValue.getObject()->get(globalObject, clientData->builtinNames().SQLPublicName());
}

extern "C" JSC::EncodedJSValue JSPasswordObject__create(JSGlobalObject*);

static JSValue constructPasswordObject(VM& vm, JSObject* bunObject)
{
    return JSValue::decode(JSPasswordObject__create(bunObject->globalObject()));
}

JSValue constructBunFetchObject(VM& vm, JSObject* bunObject)
{
    JSFunction* fetchFn = JSFunction::create(vm, bunObject->globalObject(), 1, "fetch"_s, Bun__fetch, ImplementationVisibility::Public, NoIntrinsic);

    auto* globalObject = jsCast<Zig::GlobalObject*>(bunObject->globalObject());
    fetchFn->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "preconnect"_s), 1, Bun__fetchPreconnect, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    return fetchFn;
}

static JSValue constructBunShell(VM& vm, JSObject* bunObject)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(bunObject->globalObject());
    JSFunction* createParsedShellScript = JSFunction::create(vm, bunObject->globalObject(), 2, "createParsedShellScript"_s, BunObject_callback_createParsedShellScript, ImplementationVisibility::Private, NoIntrinsic);
    JSFunction* createShellInterpreterFunction = JSFunction::create(vm, bunObject->globalObject(), 1, "createShellInterpreter"_s, BunObject_callback_createShellInterpreter, ImplementationVisibility::Private, NoIntrinsic);
    JSC::JSFunction* createShellFn = JSC::JSFunction::create(vm, globalObject, shellCreateBunShellTemplateFunctionCodeGenerator(vm), globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto args = JSC::MarkedArgumentBuffer();
    args.append(createShellInterpreterFunction);
    args.append(createParsedShellScript);
    JSC::JSValue shell = JSC::call(globalObject, createShellFn, args, "BunShell"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (UNLIKELY(!shell.isObject())) {
        throwTypeError(globalObject, scope, "Internal error: BunShell constructor did not return an object"_s);
        return {};
    }

    auto* bunShell = shell.getObject();

    auto ShellError = bunShell->get(globalObject, JSC::Identifier::fromString(vm, "ShellError"_s));
    if (UNLIKELY(!ShellError.isObject())) {
        throwTypeError(globalObject, scope, "Internal error: BunShell.ShellError is not an object"_s);
        return {};
    }

    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "braces"_s), 1, Generated::BunObject::jsBraces, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "escape"_s), 1, BunObject_callback_shellEscape, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
    bunShell->putDirect(vm, JSC::Identifier::fromString(vm, "ShellError"_s), ShellError.getObject(), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    return bunShell;
}

static JSValue constructDNSObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::JSObject* dnsObject = JSC::constructEmptyObject(globalObject);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookup"_s), 2, Bun__DNS__lookup, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, vm.propertyNames->resolve, 2, Bun__DNS__resolve, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSrv"_s), 2, Bun__DNS__resolveSrv, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveTxt"_s), 2, Bun__DNS__resolveTxt, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSoa"_s), 2, Bun__DNS__resolveSoa, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNaptr"_s), 2, Bun__DNS__resolveNaptr, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveMx"_s), 2, Bun__DNS__resolveMx, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCaa"_s), 2, Bun__DNS__resolveCaa, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNs"_s), 2, Bun__DNS__resolveNs, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolvePtr"_s), 2, Bun__DNS__resolvePtr, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCname"_s), 2, Bun__DNS__resolveCname, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveAny"_s), 2, Bun__DNS__resolveAny, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getServers"_s), 2, Bun__DNS__getServers, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "setServers"_s), 2, Bun__DNS__setServers, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "reverse"_s), 2, Bun__DNS__reverse, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookupService"_s), 2, Bun__DNS__lookupService, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "prefetch"_s), 2, Bun__DNS__prefetch, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getCacheStats"_s), 0, Bun__DNS__getCacheStats, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirect(vm, JSC::Identifier::fromString(vm, "ADDRCONFIG"_s), jsNumber(AI_ADDRCONFIG),
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirect(vm, JSC::Identifier::fromString(vm, "ALL"_s), jsNumber(AI_ALL),
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirect(vm, JSC::Identifier::fromString(vm, "V4MAPPED"_s), jsNumber(AI_V4MAPPED),
        JSC::PropertyAttribute::DontDelete | 0);
    return dnsObject;
}

static JSValue constructBunPeekObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::Identifier identifier = JSC::Identifier::fromString(vm, "peek"_s);
    JSFunction* peekFunction = JSFunction::create(vm, globalObject, peekPeekCodeGenerator(vm), globalObject->globalScope());
    JSFunction* peekStatus = JSFunction::create(vm, globalObject, peekPeekStatusCodeGenerator(vm), globalObject->globalScope());
    peekFunction->putDirect(vm, PropertyName(JSC::Identifier::fromString(vm, "status"_s)), peekStatus, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    return peekFunction;
}

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(functionBunEscapeHTMLWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject*, JSObject*, JSString*));

JSC_DEFINE_HOST_FUNCTION(functionBunSleep,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSValue millisecondsValue = callFrame->argument(0);

    if (millisecondsValue.inherits<JSC::DateInstance>()) {
        auto now = MonotonicTime::now();
        double milliseconds = jsCast<JSC::DateInstance*>(millisecondsValue)->internalNumber() - now.approximateWallTime().secondsSinceEpoch().milliseconds();
        millisecondsValue = JSC::jsNumber(milliseconds > 0 ? std::ceil(milliseconds) : 0);
    }

    if (!millisecondsValue.isNumber()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "sleep expects a number (milliseconds)"_s);
        return {};
    }

    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Timer__sleep(globalObject, JSValue::encode(promise), JSC::JSValue::encode(millisecondsValue));
    return JSC::JSValue::encode(promise);
}

extern "C" JSC::EncodedJSValue Bun__escapeHTML8(JSGlobalObject* globalObject, JSC::EncodedJSValue input, const LChar* ptr, size_t length);
extern "C" JSC::EncodedJSValue Bun__escapeHTML16(JSGlobalObject* globalObject, JSC::EncodedJSValue input, const UChar* ptr, size_t length);

JSC_DEFINE_HOST_FUNCTION(functionBunEscapeHTML, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSC::JSValue argument = callFrame->argument(0);
    if (argument.isEmpty())
        return JSValue::encode(jsEmptyString(vm));
    if (argument.isNumber() || argument.isBoolean() || argument.isUndefined() || argument.isNull())
        return JSValue::encode(argument.toString(lexicalGlobalObject));

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto string = argument.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (string->length() == 0)
        RELEASE_AND_RETURN(scope, JSValue::encode(string));

    auto resolvedString = string->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::EncodedJSValue encodedInput = JSValue::encode(string);
    if (!resolvedString->is8Bit()) {
        const auto span = resolvedString->span16();
        RELEASE_AND_RETURN(scope, Bun__escapeHTML16(lexicalGlobalObject, encodedInput, span.data(), span.size()));
    } else {
        const auto span = resolvedString->span8();
        RELEASE_AND_RETURN(scope, Bun__escapeHTML8(lexicalGlobalObject, encodedInput, span.data(), span.size()));
    }
}

JSC_DEFINE_HOST_FUNCTION(functionBunDeepEquals, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    auto& vm = JSC::getVM(global);

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 values to compare"_s);
        return {};
    }

    JSC::JSValue arg1 = callFrame->uncheckedArgument(0);
    JSC::JSValue arg2 = callFrame->uncheckedArgument(1);
    JSC::JSValue strict = callFrame->argument(2);

    Vector<std::pair<JSValue, JSValue>, 16> stack;
    MarkedArgumentBuffer gcBuffer;

    if (strict.isBoolean() && strict.asBoolean()) {

        bool isEqual = Bun__deepEquals<true, false>(globalObject, arg1, arg2, gcBuffer, stack, &scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    } else {
        bool isEqual = Bun__deepEquals<false, false>(globalObject, arg1, arg2, gcBuffer, stack, &scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    }
}

JSC_DEFINE_HOST_FUNCTION(functionBunDeepMatch, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    auto& vm = JSC::getVM(global);

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 values to compare"_s);
        return {};
    }

    JSC::JSValue subset = callFrame->uncheckedArgument(0);
    JSC::JSValue object = callFrame->uncheckedArgument(1);

    if (!subset.isObject() || !object.isObject()) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 objects to match"_s);
        return {};
    }

    std::set<EncodedJSValue> objVisited;
    std::set<EncodedJSValue> subsetVisited;
    MarkedArgumentBuffer gcBuffer;
    bool match = Bun__deepMatch</* enableAsymmetricMatchers */ false>(object, &objVisited, subset, &subsetVisited, globalObject, &scope, &gcBuffer, false, false);

    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(match));
}

JSC_DEFINE_HOST_FUNCTION(functionBunNanoseconds, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    uint64_t time = Bun__readOriginTimer(bunVM(globalObject));
    return JSValue::encode(jsNumber(time));
}

JSC_DEFINE_HOST_FUNCTION(functionPathToFileURL, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& globalObject = *defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto pathValue = callFrame->argument(0);

    JSValue jsValue;

    {
        WTF::String pathString = pathValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode({}));
        pathString = pathResolveWTFString(lexicalGlobalObject, pathString);

        auto fileURL = WTF::URL::fileURLWithFileSystemPath(pathString);
        auto object = WebCore::DOMURL::create(fileURL.string(), String());
        jsValue = WebCore::toJSNewlyCreated<IDLInterface<DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTFMove(object));
    }

    auto* jsDOMURL = jsCast<JSDOMURL*>(jsValue.asCell());
    vm.heap.reportExtraMemoryAllocated(jsDOMURL, jsDOMURL->wrapped().memoryCostForGC());
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsValue));
}

JSC_DEFINE_HOST_FUNCTION(functionGenerateHeapSnapshot, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    vm.ensureHeapProfiler();
    auto& heapProfiler = *vm.heapProfiler();
    heapProfiler.clearSnapshots();

    JSValue arg0 = callFrame->argument(0);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    bool useV8 = false;
    if (!arg0.isUndefined()) {
        if (arg0.isString()) {
            auto str = arg0.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (str == "v8"_s) {
                useV8 = true;
            } else if (str == "jsc"_s) {
                // do nothing
            } else {
                throwTypeError(globalObject, throwScope, "Expected 'v8' or 'jsc' or undefined"_s);
                return {};
            }
        }
    }

    if (useV8) {
        JSC::BunV8HeapSnapshotBuilder builder(heapProfiler);
        return JSC::JSValue::encode(jsString(vm, builder.json()));
    }

    JSC::HeapSnapshotBuilder builder(heapProfiler);
    builder.buildSnapshot();
    auto json = builder.json();
    // Returning an object was a bad idea but it's a breaking change
    // so we'll just keep it for now.
    JSC::JSValue jsonValue = JSONParseWithException(globalObject, json);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsonValue));
}

JSC_DEFINE_HOST_FUNCTION(functionFileURLToPath, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arg0 = callFrame->argument(0);
    WTF::URL url;

    auto path = JSC::JSValue::encode(arg0);
    auto* domURL = WebCoreCast<WebCore::JSDOMURL, WebCore::DOMURL>(path);
    if (!domURL) {
        if (arg0.isString()) {
            url = WTF::URL(arg0.toWTFString(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "url"_s, "string"_s, arg0);
            return {};
        }
    } else {
        url = domURL->href();
    }

    /// cannot turn non-`file://` URLs into file paths
    if (UNLIKELY(!url.protocolIsFile())) {
        Bun::ERR::INVALID_URL_SCHEME(scope, globalObject, "file"_s);
        return {};
    }

// NOTE: On Windows, WTF::URL::fileSystemPath will handle UNC paths
// (`file:\\server\share\etc` -> `\\server\share\etc`), so hostname check only
// needs to happen on posix systems
#if !OS(WINDOWS)
    // file://host/path is illegal if `host` is not `localhost`.
    // Should be `file:///` instead
    if (UNLIKELY(url.host().length() > 0 && url.host() != "localhost"_s)) {

#if OS(DARWIN)
        Bun::ERR::INVALID_FILE_URL_HOST(scope, globalObject, "darwin"_s);
        return {};
#else
        Bun::ERR::INVALID_FILE_URL_HOST(scope, globalObject, "linux"_s);
        return {};
#endif
    }
#endif

    // ban url-encoded slashes. '/' on posix, '/' and '\' on windows.
    const StringView p = url.path();
    if (p.contains('%')) {
#if OS(WINDOWS)
        if (p.contains("%2f"_s) || p.contains("%5c"_s) || p.contains("%2F"_s) || p.contains("%5C"_s)) {
            Bun::ERR::INVALID_FILE_URL_PATH(scope, globalObject, "must not include encoded \\ or / characters"_s);
            return {};
        }
#else
        if (p.contains("%2f"_s) || p.contains("%2F"_s)) {
            Bun::ERR::INVALID_FILE_URL_PATH(scope, globalObject, "must not include encoded / characters"_s);
            return {};
        }
#endif
    }

    auto fileSystemPath = url.fileSystemPath();

#if OS(WINDOWS)
    if (!isAbsolutePath(fileSystemPath)) {
        Bun::ERR::INVALID_FILE_URL_PATH(scope, globalObject, "must be an absolute path"_s);
        return {};
    }
#endif

    return JSC::JSValue::encode(JSC::jsString(vm, fileSystemPath));
}

/* Source for BunObject.lut.h
@begin bunObjectTable
    $                                              constructBunShell                                                   DontDelete|PropertyCallback
    ArrayBufferSink                                BunObject_getter_wrap_ArrayBufferSink                               DontDelete|PropertyCallback
    Cookie                                         constructCookieObject                                              DontDelete|ReadOnly|PropertyCallback
    CookieMap                                      constructCookieMapObject                                           DontDelete|ReadOnly|PropertyCallback
    CryptoHasher                                   BunObject_getter_wrap_CryptoHasher                                  DontDelete|PropertyCallback
    FFI                                            BunObject_getter_wrap_FFI                                           DontDelete|PropertyCallback
    FileSystemRouter                               BunObject_getter_wrap_FileSystemRouter                              DontDelete|PropertyCallback
    Glob                                           BunObject_getter_wrap_Glob                                          DontDelete|PropertyCallback
    MD4                                            BunObject_getter_wrap_MD4                                           DontDelete|PropertyCallback
    MD5                                            BunObject_getter_wrap_MD5                                           DontDelete|PropertyCallback
    SHA1                                           BunObject_getter_wrap_SHA1                                          DontDelete|PropertyCallback
    SHA224                                         BunObject_getter_wrap_SHA224                                        DontDelete|PropertyCallback
    SHA256                                         BunObject_getter_wrap_SHA256                                        DontDelete|PropertyCallback
    SHA384                                         BunObject_getter_wrap_SHA384                                        DontDelete|PropertyCallback
    SHA512                                         BunObject_getter_wrap_SHA512                                        DontDelete|PropertyCallback
    SHA512_256                                     BunObject_getter_wrap_SHA512_256                                    DontDelete|PropertyCallback
    TOML                                           BunObject_getter_wrap_TOML                                          DontDelete|PropertyCallback
    Transpiler                                     BunObject_getter_wrap_Transpiler                                    DontDelete|PropertyCallback
    embeddedFiles                                  BunObject_getter_wrap_embeddedFiles                                 DontDelete|PropertyCallback
    S3Client                                       BunObject_getter_wrap_S3Client                                      DontDelete|PropertyCallback
    s3                                             BunObject_getter_wrap_s3                                            DontDelete|PropertyCallback
    CSRF                                           BunObject_getter_wrap_CSRF                                          DontDelete|PropertyCallback
    allocUnsafe                                    BunObject_callback_allocUnsafe                                      DontDelete|Function 1
    argv                                           BunObject_getter_wrap_argv                                          DontDelete|PropertyCallback
    build                                          BunObject_callback_build                                            DontDelete|Function 1
    concatArrayBuffers                             functionConcatTypedArrays                                           DontDelete|Function 3
    connect                                        BunObject_callback_connect                                          DontDelete|Function 1
    cwd                                            BunObject_getter_wrap_cwd                                           DontEnum|DontDelete|PropertyCallback
    color                                          BunObject_callback_color                                            DontDelete|Function 2
    deepEquals                                     functionBunDeepEquals                                               DontDelete|Function 2
    deepMatch                                      functionBunDeepMatch                                                DontDelete|Function 2
    deflateSync                                    BunObject_callback_deflateSync                                        DontDelete|Function 1
    dns                                            constructDNSObject                                                  ReadOnly|DontDelete|PropertyCallback
    enableANSIColors                               BunObject_getter_wrap_enableANSIColors                              DontDelete|PropertyCallback
    env                                            constructEnvObject                                                  ReadOnly|DontDelete|PropertyCallback
    escapeHTML                                     functionBunEscapeHTML                                               DontDelete|Function 2
    fetch                                         constructBunFetchObject                                              ReadOnly|DontDelete|PropertyCallback
    file                                           BunObject_callback_file                                               DontDelete|Function 1
    fileURLToPath                                  functionFileURLToPath                                                DontDelete|Function 1
    gc                                             Generated::BunObject::jsGc                                          DontDelete|Function 1
    generateHeapSnapshot                           functionGenerateHeapSnapshot                                        DontDelete|Function 1
    gunzipSync                                     BunObject_callback_gunzipSync                                       DontDelete|Function 1
    gzipSync                                       BunObject_callback_gzipSync                                         DontDelete|Function 1
    hash                                           BunObject_getter_wrap_hash                                          DontDelete|PropertyCallback
    indexOfLine                                    BunObject_callback_indexOfLine                                      DontDelete|Function 1
    inflateSync                                    BunObject_callback_inflateSync                                      DontDelete|Function 1
    inspect                                        BunObject_getter_wrap_inspect                                       DontDelete|PropertyCallback
    isMainThread                                   constructIsMainThread                                               ReadOnly|DontDelete|PropertyCallback
    jest                                           BunObject_callback_jest                                             DontEnum|DontDelete|Function 1
    listen                                         BunObject_callback_listen                                           DontDelete|Function 1
    udpSocket                                        BunObject_callback_udpSocket                                      DontDelete|Function 1
    main                                           BunObject_getter_wrap_main                                          DontDelete|PropertyCallback
    mmap                                           BunObject_callback_mmap                                             DontDelete|Function 1
    nanoseconds                                    functionBunNanoseconds                                              DontDelete|Function 0
    openInEditor                                   BunObject_callback_openInEditor                                     DontDelete|Function 1
    origin                                         BunObject_getter_wrap_origin                                        DontEnum|ReadOnly|DontDelete|PropertyCallback
    version_with_sha                               constructBunVersionWithSha                                          DontEnum|ReadOnly|DontDelete|PropertyCallback
    password                                       constructPasswordObject                                             DontDelete|PropertyCallback
    pathToFileURL                                  functionPathToFileURL                                               DontDelete|Function 1
    peek                                           constructBunPeekObject                                              DontDelete|PropertyCallback
    plugin                                         constructPluginObject                                               ReadOnly|DontDelete|PropertyCallback
    randomUUIDv7                                   Bun__randomUUIDv7                                                   DontDelete|Function 2
    readableStreamToArray                          JSBuiltin                                                           Builtin|Function 1
    readableStreamToArrayBuffer                    JSBuiltin                                                           Builtin|Function 1
    readableStreamToBytes                          JSBuiltin                                                           Builtin|Function 1
    readableStreamToBlob                           JSBuiltin                                                           Builtin|Function 1
    readableStreamToFormData                       JSBuiltin                                                           Builtin|Function 1
    readableStreamToJSON                           JSBuiltin                                                           Builtin|Function 1
    readableStreamToText                           JSBuiltin                                                           Builtin|Function 1
    registerMacro                                  BunObject_callback_registerMacro                                    DontEnum|DontDelete|Function 1
    resolve                                        BunObject_callback_resolve                                          DontDelete|Function 1
    resolveSync                                    BunObject_callback_resolveSync                                      DontDelete|Function 1
    revision                                       constructBunRevision                                                ReadOnly|DontDelete|PropertyCallback
    semver                                         BunObject_getter_wrap_semver                                        ReadOnly|DontDelete|PropertyCallback
    sql                                            defaultBunSQLObject                                                 DontDelete|PropertyCallback
    postgres                                       defaultBunSQLObject                                                 DontDelete|PropertyCallback
    SQL                                            constructBunSQLObject                                               DontDelete|PropertyCallback
    serve                                          BunObject_callback_serve                                            DontDelete|Function 1
    sha                                            BunObject_callback_sha                                              DontDelete|Function 1
    shrink                                         BunObject_callback_shrink                                           DontDelete|Function 1
    sleep                                          functionBunSleep                                                    DontDelete|Function 1
    sleepSync                                      BunObject_callback_sleepSync                                        DontDelete|Function 1
    spawn                                          BunObject_callback_spawn                                            DontDelete|Function 1
    spawnSync                                      BunObject_callback_spawnSync                                        DontDelete|Function 1
    stderr                                         BunObject_getter_wrap_stderr                                        DontDelete|PropertyCallback
    stdin                                          BunObject_getter_wrap_stdin                                         DontDelete|PropertyCallback
    stdout                                         BunObject_getter_wrap_stdout                                        DontDelete|PropertyCallback
    stringWidth                                    Generated::BunObject::jsStringWidth                                 DontDelete|Function 2
    unsafe                                         BunObject_getter_wrap_unsafe                                        DontDelete|PropertyCallback
    version                                        constructBunVersion                                                 ReadOnly|DontDelete|PropertyCallback
    which                                          BunObject_callback_which                                            DontDelete|Function 1
    RedisClient                                   BunObject_getter_wrap_ValkeyClient                                  DontDelete|PropertyCallback
    redis                                         BunObject_getter_wrap_valkey                                        DontDelete|PropertyCallback
    write                                          BunObject_callback_write                                            DontDelete|Function 1
    zstdCompressSync                               BunObject_callback_zstdCompressSync                                DontDelete|Function 1
    zstdDecompressSync                             BunObject_callback_zstdDecompressSync                              DontDelete|Function 1
    zstdCompress                                 BunObject_callback_zstdCompress                                    DontDelete|Function 1
    zstdDecompress                                 BunObject_callback_zstdDecompress                                    DontDelete|Function 1
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

    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBunObject, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }

    static JSBunObject* create(JSC::VM& vm, JSGlobalObject* globalObject)
    {
        auto structure = createStructure(vm, globalObject, globalObject->objectPrototype());
        auto* object = new (NotNull, JSC::allocateCell<JSBunObject>(vm)) JSBunObject(vm, structure);
        object->finishCreation(vm);
        return object;
    }
};

#define bunObjectReadableStreamToArrayCodeGenerator WebCore::readableStreamReadableStreamToArrayCodeGenerator
#define bunObjectReadableStreamToArrayBufferCodeGenerator WebCore::readableStreamReadableStreamToArrayBufferCodeGenerator
#define bunObjectReadableStreamToBytesCodeGenerator WebCore::readableStreamReadableStreamToBytesCodeGenerator
#define bunObjectReadableStreamToBlobCodeGenerator WebCore::readableStreamReadableStreamToBlobCodeGenerator
#define bunObjectReadableStreamToFormDataCodeGenerator WebCore::readableStreamReadableStreamToFormDataCodeGenerator
#define bunObjectReadableStreamToJSONCodeGenerator WebCore::readableStreamReadableStreamToJSONCodeGenerator
#define bunObjectReadableStreamToTextCodeGenerator WebCore::readableStreamReadableStreamToTextCodeGenerator

#include "BunObject.lut.h"

#undef bunObjectReadableStreamToArrayCodeGenerator
#undef bunObjectReadableStreamToArrayBufferCodeGenerator
#undef bunObjectReadableStreamToBytesCodeGenerator
#undef bunObjectReadableStreamToBlobCodeGenerator
#undef bunObjectReadableStreamToFormDataCodeGenerator
#undef bunObjectReadableStreamToJSONCodeGenerator
#undef bunObjectReadableStreamToTextCodeGenerator

const JSC::ClassInfo JSBunObject::s_info = { "Bun"_s, &Base::s_info, &bunObjectTable, nullptr, CREATE_METHOD_TABLE(JSBunObject) };

static JSValue constructCookieObject(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(bunObject->globalObject());
    return WebCore::JSCookie::getConstructor(vm, zigGlobalObject);
}

static JSValue constructCookieMapObject(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(bunObject->globalObject());
    return WebCore::JSCookieMap::getConstructor(vm, zigGlobalObject);
}

JSC::JSObject* createBunObject(VM& vm, JSObject* globalObject)
{
    return JSBunObject::create(vm, jsCast<Zig::GlobalObject*>(globalObject));
}

static void exportBunObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    exportNames.reserveCapacity(std::size(bunObjectTableValues) + 1);
    exportValues.ensureCapacity(std::size(bunObjectTableValues) + 1);

    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    auto scope = DECLARE_THROW_SCOPE(vm);
    object->getOwnNonIndexPropertyNames(globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, void());

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(object);

    for (const auto& propertyName : propertyNames) {
        exportNames.append(propertyName);
        auto catchScope = DECLARE_CATCH_SCOPE(vm);

        // Yes, we have to call getters :(
        JSValue value = object->get(globalObject, propertyName);

        if (catchScope.exception()) {
            catchScope.clearException();
            value = jsUndefined();
        }
        exportValues.append(value);
    }
}

}

namespace Zig {
void generateNativeModule_BunObject(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* object = globalObject->bunObject();

    // :'(
    if (LIKELY(object->hasNonReifiedStaticProperties())) {
        object->reifyAllStaticProperties(lexicalGlobalObject);
    }

    RETURN_IF_EXCEPTION(scope, void());

    Bun::exportBunObject(vm, globalObject, object, exportNames, exportValues);
}

}
