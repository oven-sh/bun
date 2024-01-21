
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
#include "BunObject+exports.h"
#include "JSDOMException.h"
#include "JSDOMConvert.h"
#include "wtf/Compiler.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

extern "C" JSC::EncodedJSValue Bun__fetch(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
extern "C" bool has_bun_garbage_collector_flag_enabled;

static JSValue BunObject_getter_wrap_ArrayBufferSink(VM& vm, JSObject* bunObject)
{
    return jsCast<Zig::GlobalObject*>(bunObject->globalObject())->ArrayBufferSink();
}

static JSValue constructEnvObject(VM& vm, JSObject* object)
{
    return jsCast<Zig::GlobalObject*>(object->globalObject())->processEnvObject();
}

static inline JSC::EncodedJSValue flattenArrayOfBuffersIntoArrayBuffer(JSGlobalObject* lexicalGlobalObject, JSValue arrayValue)
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

static JSValue constructBunVersion(VM& vm, JSObject*)
{
    return JSC::jsString(vm, makeString(Bun__version + 1));
}

static JSValue constructBunRevision(VM& vm, JSObject*)
{
    return JSC::jsString(vm, makeString(Bun__version_sha));
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
    JSValue interpreter = BunObject_getter_wrap_ShellInterpreter(vm, bunObject);

    JSC::JSFunction* createShellFn = JSC::JSFunction::create(vm, shellCreateBunShellTemplateFunctionCodeGenerator(vm), globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto args = JSC::MarkedArgumentBuffer();
    args.append(interpreter);
    JSC::JSValue shell = JSC::call(globalObject, createShellFn, args, "BunShell"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (UNLIKELY(!shell.isObject())) {
        throwTypeError(globalObject, scope, "Internal error: BunShell constructor did not return an object"_s);
        return {};
    }
    auto* bunShell = shell.getObject();

    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "braces"_s), 1, BunObject_callback_braces, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "escape"_s), 1, BunObject_callback_shellEscape, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    // auto mainShellFunc = JSFunction::create(vm, globalObject, 2, String("$"_s), BunObject_callback_$, ImplementationVisibility::Public);
    // auto mainShellFunc = JSFunction::create(vm, globalObject, 2, String("$"_s), BunObject_callback_$, ImplementationVisibility::Public);
    // auto mainShellFunc = shellShellCodeGenerator;
    if (has_bun_garbage_collector_flag_enabled) {
        auto parseIdent
            = Identifier::fromString(vm, String("parse"_s));
        auto parseFunc = JSFunction::create(vm, globalObject, 2, String("shellParse"_s), BunObject_callback_shellParse, ImplementationVisibility::Private);
        bunShell->putDirect(vm, parseIdent, parseFunc);

        auto lexIdent = Identifier::fromString(vm, String("lex"_s));
        auto lexFunc = JSFunction::create(vm, globalObject, 2, String("lex"_s), BunObject_callback_shellLex, ImplementationVisibility::Private);
        bunShell->putDirect(vm, lexIdent, lexFunc);
    }

    return bunShell;
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
extern "C" EncodedJSValue Bun__DNSResolver__reverse(JSGlobalObject*, JSC::CallFrame*);
extern "C" EncodedJSValue Bun__DNSResolver__lookupService(JSGlobalObject*, JSC::CallFrame*);

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

JSC_DEFINE_HOST_FUNCTION(functionBunSleepThenCallback,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    JSPromise* promise = jsDynamicCast<JSC::JSPromise*>(callFrame->argument(0));
    RELEASE_ASSERT(promise);

    promise->resolve(globalObject, JSC::jsUndefined());

    return JSC::JSValue::encode(promise);
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

extern "C" JSC::EncodedJSValue Bun__escapeHTML8(JSGlobalObject* globalObject, JSC::EncodedJSValue input, const LChar* ptr, size_t length);
extern "C" JSC::EncodedJSValue Bun__escapeHTML16(JSGlobalObject* globalObject, JSC::EncodedJSValue input, const UChar* ptr, size_t length);

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
    JSC::EncodedJSValue encodedInput = JSValue::encode(string);
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
    auto path = JSC::JSValue::encode(callFrame->argument(0));

    JSC::JSString* pathString = JSC::JSValue::decode(path).toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

    auto fileURL = WTF::URL::fileURLWithFileSystemPath(pathString->value(lexicalGlobalObject));
    auto object = WebCore::DOMURL::create(fileURL.string(), String());
    auto jsValue = WebCore::toJSNewlyCreated<IDLInterface<DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTFMove(object));
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
            if (UNLIKELY(!url.protocolIsFile())) {
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
    if (UNLIKELY(!url.protocolIsFile())) {
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

/* Source for BunObject.lut.h
@begin bunObjectTable
    $                                              constructBunShell                                                   ReadOnly|DontDelete|PropertyCallback
    ArrayBufferSink                                BunObject_getter_wrap_ArrayBufferSink                               DontDelete|PropertyCallback
    CryptoHasher                                   BunObject_getter_wrap_CryptoHasher                                  DontDelete|PropertyCallback
    DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump  BunObject_callback_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump    DontEnum|DontDelete|Function 1
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
    _Os                                            BunObject_callback__Os                                              DontEnum|DontDelete|Function 1
    _Path                                          BunObject_callback__Path                                            DontEnum|DontDelete|Function 1
    allocUnsafe                                    BunObject_callback_allocUnsafe                                      DontDelete|Function 1
    argv                                           BunObject_getter_wrap_argv                                          DontDelete|PropertyCallback
    assetPrefix                                    BunObject_getter_wrap_assetPrefix                                   DontEnum|DontDelete|PropertyCallback
    build                                          BunObject_callback_build                                            DontDelete|Function 1
    concatArrayBuffers                             functionConcatTypedArrays                                           DontDelete|Function 1
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
    fs                                             BunObject_callback_fs                                               DontEnum|DontDelete|Function 1
    gc                                             BunObject_callback_gc                                               DontDelete|Function 1
    generateHeapSnapshot                           BunObject_callback_generateHeapSnapshot                             DontDelete|Function 1
    getImportedStyles                              BunObject_callback_getImportedStyles                                DontEnum|DontDelete|Function 1
    gunzipSync                                     BunObject_callback_gunzipSync                                       DontDelete|Function 1
    gzipSync                                       BunObject_callback_gzipSync                                         DontDelete|Function 1
    hash                                           BunObject_getter_wrap_hash                                          DontDelete|PropertyCallback
    indexOfLine                                    BunObject_callback_indexOfLine                                      DontDelete|Function 1
    inflateSync                                    BunObject_callback_inflateSync                                      DontDelete|Function 1
    inspect                                        BunObject_getter_wrap_inspect                                       DontDelete|PropertyCallback
    isMainThread                                   constructIsMainThread                                               ReadOnly|DontDelete|PropertyCallback
    jest                                           BunObject_callback_jest                                             DontEnum|DontDelete|Function 1
    listen                                         BunObject_callback_listen                                           DontDelete|Function 1
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
    stringHashCode                                 functionHashCode                                                    DontDelete|Function 1
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
#define bunObjectReadableStreamToBlobCodeGenerator WebCore::readableStreamReadableStreamToBlobCodeGenerator
#define bunObjectReadableStreamToFormDataCodeGenerator WebCore::readableStreamReadableStreamToFormDataCodeGenerator
#define bunObjectReadableStreamToJSONCodeGenerator WebCore::readableStreamReadableStreamToJSONCodeGenerator
#define bunObjectReadableStreamToTextCodeGenerator WebCore::readableStreamReadableStreamToTextCodeGenerator

#include "BunObject.lut.h"

#undef bunObjectReadableStreamToArrayCodeGenerator
#undef bunObjectReadableStreamToArrayBufferCodeGenerator
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
