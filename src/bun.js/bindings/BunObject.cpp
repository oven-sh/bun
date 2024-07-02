#include "root.h"
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

BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__lookup);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolve);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveSrv);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveTxt);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveSoa);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveNaptr);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveMx);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveCaa);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveNs);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolvePtr);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__resolveCname);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__getServers);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__reverse);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__lookupService);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__prefetch);
BUN_DECLARE_HOST_FUNCTION(Bun__DNSResolver__getCacheStats);
BUN_DECLARE_HOST_FUNCTION(Bun__fetch);

namespace Bun {

using namespace JSC;
using namespace WebCore;

extern "C" bool has_bun_garbage_collector_flag_enabled;

static JSValue BunObject_getter_wrap_ArrayBufferSink(VM& vm, JSObject* bunObject)
{
    return jsCast<Zig::GlobalObject*>(bunObject->globalObject())->ArrayBufferSink();
}

static JSValue constructEnvObject(VM& vm, JSObject* object)
{
    return jsCast<Zig::GlobalObject*>(object->globalObject())->processEnvObject();
}

static inline JSC::EncodedJSValue flattenArrayOfBuffersIntoArrayBufferOrUint8Array(JSGlobalObject* lexicalGlobalObject, JSValue arrayValue, size_t maxLength, bool asUint8Array)
{
    auto& vm = lexicalGlobalObject->vm();

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

    // Use an argument buffer to avoid calling `getIndex` more than once per element.
    // This is a small optimization
    MarkedArgumentBuffer args;
    args.ensureCapacity(arrayLength);
    if (UNLIKELY(args.hasOverflowed())) {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return JSValue::encode({});
    }

    for (size_t i = 0; i < arrayLength; i++) {
        auto element = array->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(throwScope, {});

        if (auto* typedArray = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(element)) {
            if (UNLIKELY(typedArray->isDetached())) {
                throwTypeError(lexicalGlobalObject, throwScope, "ArrayBufferView is detached"_s);
                return JSValue::encode(jsUndefined());
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
                throwTypeError(lexicalGlobalObject, throwScope, "ArrayBuffer is detached"_s);
                return JSValue::encode(jsUndefined());
            }

            size_t current = impl->byteLength();
            any_buffer = true;

            if (current > 0) {
                args.append(arrayBuffer);
            }

            byteLength += current;
        } else {
            throwTypeError(lexicalGlobalObject, throwScope, "Expected TypedArray"_s);
            return JSValue::encode(jsUndefined());
        }
    }
    byteLength = std::min(byteLength, maxLength);

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
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return JSValue::encode(jsUndefined());
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

extern "C" JSC::EncodedJSValue JSPasswordObject__create(JSGlobalObject*);

static JSValue constructPasswordObject(VM& vm, JSObject* bunObject)
{
    return JSValue::decode(JSPasswordObject__create(bunObject->globalObject()));
}

static JSValue constructBunShell(VM& vm, JSObject* bunObject)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(bunObject->globalObject());
    JSFunction* createParsedShellScript = JSFunction::create(vm, bunObject->globalObject(), 2, "createParsedShellScript"_s, BunObject_callback_createParsedShellScript, ImplementationVisibility::Private, NoIntrinsic);
    JSFunction* createShellInterpreterFunction = JSFunction::create(vm, bunObject->globalObject(), 1, "createShellInterpreter"_s, BunObject_callback_createShellInterpreter, ImplementationVisibility::Private, NoIntrinsic);
    JSC::JSFunction* createShellFn = JSC::JSFunction::create(vm, shellCreateBunShellTemplateFunctionCodeGenerator(vm), globalObject);

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

    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "braces"_s), 1, BunObject_callback_braces, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "escape"_s), 1, BunObject_callback_shellEscape, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    return bunShell;
}

static JSValue constructDNSObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::JSObject* dnsObject = JSC::constructEmptyObject(globalObject);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookup"_s), 2, Bun__DNSResolver__lookup, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, builtinNames(vm).resolvePublicName(), 2, Bun__DNSResolver__resolve, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSrv"_s), 2, Bun__DNSResolver__resolveSrv, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveTxt"_s), 2, Bun__DNSResolver__resolveTxt, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSoa"_s), 2, Bun__DNSResolver__resolveSoa, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNaptr"_s), 2, Bun__DNSResolver__resolveNaptr, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveMx"_s), 2, Bun__DNSResolver__resolveMx, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCaa"_s), 2, Bun__DNSResolver__resolveCaa, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNs"_s), 2, Bun__DNSResolver__resolveNs, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolvePtr"_s), 2, Bun__DNSResolver__resolvePtr, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCname"_s), 2, Bun__DNSResolver__resolveCname, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getServers"_s), 2, Bun__DNSResolver__getServers, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "reverse"_s), 2, Bun__DNSResolver__reverse, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookupService"_s), 2, Bun__DNSResolver__lookupService, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "prefetch"_s), 2, Bun__DNSResolver__prefetch, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getCacheStats"_s), 0, Bun__DNSResolver__getCacheStats, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    return dnsObject;
}

static JSValue constructBunPeekObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::Identifier identifier = JSC::Identifier::fromString(vm, "peek"_s);
    JSFunction* peekFunction = JSFunction::create(vm, peekPeekCodeGenerator(vm), globalObject->globalScope());
    JSFunction* peekStatus = JSFunction::create(vm, peekPeekStatusCodeGenerator(vm), globalObject->globalScope());
    peekFunction->putDirect(vm, PropertyName(JSC::Identifier::fromString(vm, "status"_s)), peekStatus, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    return peekFunction;
}

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(functionBunEscapeHTMLWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject*, JSObject*, JSString*));

JSC_DEFINE_HOST_FUNCTION(functionBunSleep,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue millisecondsValue = callFrame->argument(0);

    if (millisecondsValue.inherits<JSC::DateInstance>()) {
        auto now = MonotonicTime::now();
        double milliseconds = jsCast<JSC::DateInstance*>(millisecondsValue)->internalNumber() - now.approximateWallTime().secondsSinceEpoch().milliseconds();
        millisecondsValue = JSC::jsNumber(milliseconds > 0 ? std::ceil(milliseconds) : 0);
    }

    if (!millisecondsValue.isNumber()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "sleep expects a number (milliseconds)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Timer__setTimeout(globalObject, JSValue::encode(promise), JSC::JSValue::encode(millisecondsValue), {});
    return JSC::JSValue::encode(promise);
}

extern "C" JSC::EncodedJSValue Bun__escapeHTML8(JSGlobalObject* globalObject, JSC::EncodedJSValue input, const LChar* ptr, size_t length);
extern "C" JSC::EncodedJSValue Bun__escapeHTML16(JSGlobalObject* globalObject, JSC::EncodedJSValue input, const UChar* ptr, size_t length);

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

    String resolvedString = string->value(lexicalGlobalObject);
    JSC::EncodedJSValue encodedInput = JSValue::encode(string);
    if (!resolvedString.is8Bit()) {
        const auto span = resolvedString.span16();
        RELEASE_AND_RETURN(scope, Bun__escapeHTML16(lexicalGlobalObject, encodedInput, span.data(), span.size()));
    } else {
        const auto span = resolvedString.span8();
        RELEASE_AND_RETURN(scope, Bun__escapeHTML8(lexicalGlobalObject, encodedInput, span.data(), span.size()));
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
    MarkedArgumentBuffer gcBuffer;

    if (arg3.isBoolean() && arg3.asBoolean()) {

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

    bool match = Bun__deepMatch<false>(object, subset, globalObject, &scope, false, false);
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
    auto pathValue = callFrame->argument(0);

    WTF::String pathString = pathValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode({}));

    pathString = pathResolveWTFString(lexicalGlobalObject, pathString);

    auto fileURL = WTF::URL::fileURLWithFileSystemPath(pathString);
    auto object = WebCore::DOMURL::create(fileURL.string(), String());
    auto jsValue = WebCore::toJSNewlyCreated<IDLInterface<DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTFMove(object));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsValue));
}

JSC_DEFINE_HOST_FUNCTION(functionFileURLToPath, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arg0 = callFrame->argument(0);
    WTF::URL url;

    auto path = JSC::JSValue::encode(arg0);
    auto* domURL = WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(path);
    if (!domURL) {
        if (arg0.isString()) {
            url = WTF::URL(arg0.toWTFString(globalObject));
            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
        } else {
            throwTypeError(globalObject, scope, "Argument must be a URL"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
    } else {
        url = domURL->href();
    }

    if (UNLIKELY(!url.protocolIsFile())) {
        throwTypeError(globalObject, scope, "Argument must be a file URL"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto fileSystemPath = url.fileSystemPath();

#if OS(WINDOWS)
    if (!isAbsolutePath(fileSystemPath)) {
        throwTypeError(globalObject, scope, "File URL path must be absolute"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
#endif

    return JSC::JSValue::encode(JSC::jsString(vm, fileSystemPath));
}

/* Source for BunObject.lut.h
@begin bunObjectTable
    $                                              constructBunShell                                                   ReadOnly|DontDelete|PropertyCallback
    ArrayBufferSink                                BunObject_getter_wrap_ArrayBufferSink                               DontDelete|PropertyCallback
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
    allocUnsafe                                    BunObject_callback_allocUnsafe                                      DontDelete|Function 1
    argv                                           BunObject_getter_wrap_argv                                          DontDelete|PropertyCallback
    build                                          BunObject_callback_build                                            DontDelete|Function 1
    concatArrayBuffers                             functionConcatTypedArrays                                           DontDelete|Function 3
    connect                                        BunObject_callback_connect                                          DontDelete|Function 1
    cwd                                            BunObject_getter_wrap_cwd                                           DontEnum|DontDelete|PropertyCallback
    deepEquals                                     functionBunDeepEquals                                               DontDelete|Function 2
    deepMatch                                      functionBunDeepMatch                                                DontDelete|Function 2
    deflateSync                                    BunObject_callback_deflateSync                                      DontDelete|Function 1
    dns                                            constructDNSObject                                                  ReadOnly|DontDelete|PropertyCallback
    enableANSIColors                               BunObject_getter_wrap_enableANSIColors                              DontDelete|PropertyCallback
    env                                            constructEnvObject                                                  ReadOnly|DontDelete|PropertyCallback
    escapeHTML                                     functionBunEscapeHTML                                               DontDelete|Function 2
    fetch                                          Bun__fetch                                                          ReadOnly|DontDelete|Function 1
    file                                           BunObject_callback_file                                             DontDelete|Function 1
    fileURLToPath                                  functionFileURLToPath                                               DontDelete|Function 1
    gc                                             BunObject_callback_gc                                               DontDelete|Function 1
    generateHeapSnapshot                           BunObject_callback_generateHeapSnapshot                             DontDelete|Function 1
    gunzipSync                                     BunObject_callback_gunzipSync                                       DontDelete|Function 1
    gzipSync                                       BunObject_callback_gzipSync                                         DontDelete|Function 1
    hash                                           BunObject_getter_wrap_hash                                          DontDelete|PropertyCallback
    indexOfLine                                    BunObject_callback_indexOfLine                                      DontDelete|Function 1
    inflateSync                                    BunObject_callback_inflateSync                                      DontDelete|Function 1
    inspect                                        BunObject_getter_wrap_inspect                                       DontDelete|PropertyCallback
    isMainThread                                   constructIsMainThread                                               ReadOnly|DontDelete|PropertyCallback
    jest                                           BunObject_callback_jest                                             DontEnum|DontDelete|Function 1
    listen                                         BunObject_callback_listen                                           DontDelete|Function 1
    udpSocket                                        BunObject_callback_udpSocket                                          DontDelete|Function 1
    main                                           BunObject_getter_wrap_main                                          DontDelete|PropertyCallback
    mmap                                           BunObject_callback_mmap                                             DontDelete|Function 1
    nanoseconds                                    functionBunNanoseconds                                              DontDelete|Function 0
    openInEditor                                   BunObject_callback_openInEditor                                     DontDelete|Function 1
    origin                                         BunObject_getter_wrap_origin                                        DontDelete|PropertyCallback
    password                                       constructPasswordObject                                             DontDelete|PropertyCallback
    pathToFileURL                                  functionPathToFileURL                                               DontDelete|Function 1
    peek                                           constructBunPeekObject                                              DontDelete|PropertyCallback
    plugin                                         constructPluginObject                                               ReadOnly|DontDelete|PropertyCallback
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
    stringWidth                                    BunObject_callback_stringWidth                                      DontDelete|Function 2
    unsafe                                         BunObject_getter_wrap_unsafe                                        DontDelete|PropertyCallback
    version                                        constructBunVersion                                                 ReadOnly|DontDelete|PropertyCallback
    which                                          BunObject_callback_which                                            DontDelete|Function 1
    write                                          BunObject_callback_write                                            DontDelete|Function 1
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

JSC::JSObject* createBunObject(VM& vm, JSObject* globalObject)
{
    return JSBunObject::create(vm, jsCast<Zig::GlobalObject*>(globalObject));
}

}
