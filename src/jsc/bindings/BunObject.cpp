#include "root.h"

#include "JavaScriptCore/HeapProfiler.h"
#include <JavaScriptCore/AOTMembersLeftOut.h>
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
#include <JavaScriptCore/JSONObject.h>
#include "wtf/SIMDUTF.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include "headers.h"
#include "BunObject.h"
#include "webcore/streams/BunStreamConsumers.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/JSObject.h>
#include "Exception.h"
#include "JSDOMException.h"
#include "JSDOMConvert.h"
#include "wtf/Compiler.h"
#include "PathInlines.h"
#include "wtf/text/ASCIILiteral.h"
#include "BunObject+exports.h"
#include "ErrorCode.h"
#include "GeneratedArchive.h"
#include "GeneratedBlob.h"
#include "GeneratedBunObject.h"
#include "GeneratedBunObjectInternals.h"
#include "GeneratedColorJs.h"
#include "GeneratedCrypto.h"
#include "GeneratedCryptoHasher.h"
#include "GeneratedCsrfJsc.h"
#include "GeneratedDns.h"
#include "GeneratedDnsInternals.h"
#include "GeneratedFetch.h"
#include "GeneratedFetchSession.h"
#include "GeneratedFilesystemRouter.h"
#include "GeneratedGlob.h"
#include "GeneratedHashObject.h"
#include "GeneratedImage.h"
#include "GeneratedInterpreter.h"
#include "GeneratedJSBundler.h"
#include "GeneratedJSON5Object.h"
#include "GeneratedJSONCObject.h"
#include "GeneratedJest.h"
#include "GeneratedJsBunSpawnBindings.h"
#include "GeneratedListener.h"
#include "GeneratedMarkdownObject.h"
#include "GeneratedParsedShellScript.h"
#include "GeneratedPasswordObject.h"
#include "GeneratedS3Client.h"
#include "GeneratedSemverObject.h"
#include "GeneratedSink.h"
#include "GeneratedTOMLObject.h"
#include "GeneratedTerminal.h"
#include "GeneratedTranspiler.h"
#include "GeneratedUdpSocket.h"
#include "GeneratedUnsafeObject.h"
#include "GeneratedValkey.h"
#include "GeneratedXMLObject.h"
#include "GeneratedYAMLObject.h"
#include "JavaScriptCore/BunV8HeapSnapshotBuilder.h"
#include "BunObjectModule.h"
#include "_NativeModule.h"
#include "JSCookie.h"
#include "JSCookieMap.h"
#include "Secrets.h"

#ifdef WIN32
#include <ws2def.h>
#else
#include <netdb.h>
#endif

extern "C" size_t Bun__Feature__heap_snapshot;

#include "sliceAnsi.h"
#include "escapeHTML.h"

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunStripANSI);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunWrapAnsi);
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunStringWidth);
}

using namespace JSC;
using namespace WebCore;

namespace Bun {

extern "C" bool has_bun_garbage_collector_flag_enabled;

static JSValue constructCookieObject(VM& vm, JSObject* bunObject);
static JSValue constructCookieMapObject(VM& vm, JSObject* bunObject);
static JSValue constructModuleGraphObject(VM& vm, JSObject* bunObject);
static JSValue constructSecretsObject(VM& vm, JSObject* bunObject);
static JSValue constructWebViewObject(VM& vm, JSObject* bunObject);

static JSValue constructEnvObject(VM& vm, JSObject* object)
{
    // reifyAllStaticProperties calls PropertyCallback builders without checking for exceptions, so check here.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue env = uncheckedDowncast<Zig::GlobalObject>(object->globalObject())->processEnvObject();
    RETURN_IF_EXCEPTION(scope, {});
    return env;
}

JSC::EncodedJSValue flattenArrayOfBuffersIntoArrayBufferOrUint8Array(JSGlobalObject* lexicalGlobalObject, JSValue arrayValue, size_t maxLength, bool asUint8Array)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);

    if (arrayValue.isUndefinedOrNull() || !arrayValue) {
        return JSC::JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1)));
    }

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto array = dynamicDowncast<JSC::JSArray>(arrayValue);
    if (!array) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, throwScope, "Argument must be an array"_s);
        return {};
    }

    const auto returnEmptyArrayBufferView = [&]() -> EncodedJSValue {
        if (asUint8Array) {
            RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), 0)));
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1))));
    };

    // Resolve every element of the input array into a MarkedArgumentBuffer
    // first so that all user-observable side effects (index getters) run to
    // completion before we read any byte lengths or allocate the output
    // buffer. This avoids a TOCTOU where a getter at index N detaches or
    // resizes the buffer backing index M < N after M's length was measured,
    // which previously left uninitialized bytes in the output.
    MarkedArgumentBuffer args;
    args.ensureCapacity(array->length());
    if (args.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return {};
    }

    JSC::forEachInArrayLike(lexicalGlobalObject, array, [&](JSValue element) -> bool {
        args.append(element);
        return true;
    });
    RETURN_IF_EXCEPTION(throwScope, {});
    if (args.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return {};
    }

    // All user code is done running. Validate each element and sum their
    // byte lengths. Nothing between here and the final memcpy loop can call
    // back into JavaScript, so the lengths we measure now are the lengths we
    // copy below.
    size_t byteLength = 0;
    bool any_buffer = false;
    bool any_typed = false;

    for (size_t i = 0; i < args.size(); i++) {
        JSValue element = args.at(i);
        if (auto* typedArray = dynamicDowncast<JSC::JSArrayBufferView>(element)) {
            if (typedArray->isDetached()) [[unlikely]] {
                return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject, "Cannot validate on a detached buffer"_s);
            }
            any_typed = true;
            byteLength += typedArray->byteLength();
        } else if (auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(element)) {
            auto* impl = arrayBuffer->impl();
            if (!impl || impl->isDetached()) [[unlikely]] {
                return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject, "Cannot validate on a detached buffer"_s);
            }
            any_buffer = true;
            byteLength += impl->byteLength();
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
    if (!buffer) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, throwScope, "Failed to allocate ArrayBuffer"_s);
        return {};
    }

    size_t remain = byteLength;
    auto* head = reinterpret_cast<char*>(buffer->data());

    if (!any_buffer) {
        for (size_t i = 0; i < args.size() && remain > 0; i++) {
            auto* view = uncheckedDowncast<JSC::JSArrayBufferView>(args.at(i));
            size_t length = std::min(remain, view->byteLength());
            if (length > 0)
                memcpy(head, view->vector(), length);
            remain -= length;
            head += length;
        }
    } else if (!any_typed) {
        for (size_t i = 0; i < args.size() && remain > 0; i++) {
            auto* view = uncheckedDowncast<JSC::JSArrayBuffer>(args.at(i));
            size_t length = std::min(remain, view->impl()->byteLength());
            if (length > 0)
                memcpy(head, view->impl()->data(), length);
            remain -= length;
            head += length;
        }
    } else {
        for (size_t i = 0; i < args.size() && remain > 0; i++) {
            auto element = args.at(i);
            size_t length = 0;
            if (auto* view = dynamicDowncast<JSC::JSArrayBuffer>(element)) {
                length = std::min(remain, view->impl()->byteLength());
                if (length > 0)
                    memcpy(head, view->impl()->data(), length);
            } else {
                auto* typedArray = uncheckedDowncast<JSC::JSArrayBufferView>(element);
                length = std::min(remain, typedArray->byteLength());
                if (length > 0)
                    memcpy(head, typedArray->vector(), length);
            }
            remain -= length;
            head += length;
        }
    }

    ASSERT(remain == 0);

    if (asUint8Array) {
        auto uint8array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), WTF::move(buffer), 0, byteLength);
        RETURN_IF_EXCEPTION(throwScope, {});
        return JSValue::encode(uint8array);
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), WTF::move(buffer))));
}

JSC_DEFINE_HOST_FUNCTION(functionConcatTypedArrays, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) [[unlikely]] {
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return {};
    }

    auto arrayValue = callFrame->uncheckedArgument(0);

    size_t maxLength = std::numeric_limits<size_t>::max();
    auto arg1 = callFrame->argument(1);
    if (!arg1.isUndefined() && arg1.isNumber()) {
        double number = arg1.asNumber();
        if (std::isnan(number) || number < 0) {
            throwRangeError(globalObject, throwScope, "Maximum length must be >= 0"_s);
            return {};
        }
        if (!std::isinf(number)) {
            maxLength = JSC::toUInt32(number);
        }
    }

    bool asUint8Array = false;
    auto arg2 = callFrame->argument(2);
    if (!arg2.isUndefined()) {
        asUint8Array = arg2.toBoolean(globalObject);
    }

    RELEASE_AND_RETURN(throwScope, flattenArrayOfBuffersIntoArrayBufferOrUint8Array(globalObject, arrayValue, maxLength, asUint8Array));
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
    return jsBoolean(uncheckedDowncast<Zig::GlobalObject>(object->globalObject())->scriptExecutionContext()->isMainThread());
}

static JSValue constructPluginObject(VM& vm, JSObject* bunObject)
{
    auto* globalObject = bunObject->globalObject();
    JSFunction* pluginFunction = JSFunction::create(vm, globalObject, 1, String("plugin"_s), JSC::removableFunction<Bun::Feature::Plugin, JSC::RemovedFeatureStub::Throw, jsFunctionBunPlugin>(), ImplementationVisibility::Public, NoIntrinsic);
    pluginFunction->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "clearAll"_s), 1, JSC::removableFunction<Bun::Feature::Plugin, JSC::RemovedFeatureStub::Throw, jsFunctionBunPluginClear>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    return pluginFunction;
}

static JSValue createBunSql(VM& vm, Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue sqlValue = BUN_REQUIRE_INTERNAL_MODULE(globalObject, BunSql, "Bun.sql", "default"_s);
#if ENABLE(AOT)
    if (vm.hasCompiledCode() && scope.exception()) [[unlikely]] {
        if (JSValue standIn = JSC::AOT::takeStandInForFunctionLeftOut(globalObject, { "sql"_s, 2 }, globalObject))
            return standIn;
    }
#endif
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, sqlValue.getObject()->get(globalObject, vm.propertyNames->defaultKeyword));
}

static JSValue createBunSQLConstructor(VM& vm, Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue sqlValue = BUN_REQUIRE_INTERNAL_MODULE(globalObject, BunSql, "Bun.SQL", "SQL"_s);
#if ENABLE(AOT)
    if (vm.hasCompiledCode() && scope.exception()) [[unlikely]] {
        if (JSValue standIn = JSC::AOT::takeStandInForFunctionLeftOut(globalObject, { "SQL"_s, 0, true }, globalObject))
            return standIn;
    }
#endif
    RETURN_IF_EXCEPTION(scope, {});
    auto clientData = WebCore::clientData(vm);
    RELEASE_AND_RETURN(scope, sqlValue.getObject()->get(globalObject, clientData->builtinNames().SQLPublicName()));
}

JSValue constructBunFetchObject(VM& vm, JSObject* bunObject)
{
    JSFunction* fetchFn = JSFunction::create(vm, bunObject->globalObject(), 1, "fetch"_s, JSC::removableFunction<Bun::Feature::Fetch, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::Fetch::jsFetch>(), ImplementationVisibility::Public, NoIntrinsic);

    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    fetchFn->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "preconnect"_s), 1, JSC::removableFunction<Bun::Feature::Fetch, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::Fetch::jsPreconnect>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    return fetchFn;
}

static JSValue createBunShell(VM& vm, Zig::GlobalObject* globalObject)
{
    JSFunction* createParsedShellScript = JSFunction::create(vm, globalObject, 2, "createParsedShellScript"_s, JSC::removableFunction<Bun::Feature::Shell, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::ParsedShellScript::jsCreateParsedShellScript>(), ImplementationVisibility::Private, NoIntrinsic);
    JSFunction* createShellInterpreterFunction = JSFunction::create(vm, globalObject, 1, "createShellInterpreter"_s, JSC::removableFunction<Bun::Feature::Shell, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::Interpreter::jsCreateShellInterpreter>(), ImplementationVisibility::Private, NoIntrinsic);
    JSC::JSFunction* createShellFn = JSC::JSFunction::create(vm, globalObject, shellCreateBunShellTemplateFunctionCodeGenerator(vm), globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto args = JSC::MarkedArgumentBuffer();
    args.append(createShellInterpreterFunction);
    args.append(createParsedShellScript);
    JSC::JSValue shell = JSC::call(globalObject, createShellFn, args, "BunShell"_s);
#if ENABLE(AOT)
    // An executable of a program that never names `Bun.$` has no code for the function. It reads `process.env` when it runs, so that read is made here.
    if (vm.hasCompiledCode() && scope.exception()) [[unlikely]] {
        if (JSValue standIn = JSC::AOT::takeStandInForFunctionLeftOut(globalObject, { "BunShell"_s, 1 }, globalObject)) {
            JSValue process = globalObject->get(globalObject, Identifier::fromString(vm, "process"_s));
            RETURN_IF_EXCEPTION(scope, {});
            process.get(globalObject, Identifier::fromString(vm, "env"_s));
            RETURN_IF_EXCEPTION(scope, {});
            return standIn;
        }
    }
#endif
    RETURN_IF_EXCEPTION(scope, {});

    if (!shell.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Internal error: BunShell constructor did not return an object"_s);
        return {};
    }

    auto* bunShell = shell.getObject();

    auto ShellError = bunShell->get(globalObject, JSC::Identifier::fromString(vm, "ShellError"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (!ShellError.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Internal error: BunShell.ShellError is not an object"_s);
        return {};
    }

    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "braces"_s), 1, Bun::Bindgen::Generated::BunObject::jsBraces, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
    bunShell->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "escape"_s), 1, Bun::Bindgen::Generated::BunObject::jsShellEscape, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
    bunShell->putDirect(vm, JSC::Identifier::fromString(vm, "ShellError"_s), ShellError.getObject(), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    return bunShell;
}

// reifyAllStaticProperties calls PropertyCallback builders without checking for exceptions, so check here.
static JSValue checkedBunObjectValue(VM& vm, JSObject* bunObject, JSValue (*create)(VM&, Zig::GlobalObject*))
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue value = create(vm, defaultGlobalObject(bunObject->globalObject()));
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

static JSValue constructBunShell(VM& vm, JSObject* bunObject) { return checkedBunObjectValue(vm, bunObject, createBunShell); }
static JSValue defaultBunSQLObject(VM& vm, JSObject* bunObject) { return checkedBunObjectValue(vm, bunObject, createBunSql); }
static JSValue constructBunSQLObject(VM& vm, JSObject* bunObject) { return checkedBunObjectValue(vm, bunObject, createBunSQLConstructor); }

static JSValue constructDNSObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::JSObject* dnsObject = JSC::constructEmptyObject(globalObject);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookup"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::Dns::jsLookup>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, vm.propertyNames->resolve, 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolve>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSrv"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveSrv>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveTxt"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveTxt>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveSoa"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveSoa>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNaptr"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveNaptr>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveMx"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveMx>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCaa"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveCaa>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveNs"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveNs>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolvePtr"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolvePtr>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveCname"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveCname>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "resolveAny"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalResolveAny>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getServers"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGetGlobalServers>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "setServers"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsSetGlobalServers>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "reverse"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalReverse>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "lookupService"_s), 2, JSC::removableFunction<Bun::Feature::Dns, JSC::RemovedFeatureStub::Throw, Bun::Bindgen::Generated::DnsInternals::jsGlobalLookupService>(), ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "prefetch"_s), 1, Bun::Bindgen::Generated::Dns::jsPrefetch, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getCacheStats"_s), 0, Bun::Bindgen::Generated::Dns::jsGetCacheStats, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirect(vm, JSC::Identifier::fromString(vm, "ADDRCONFIG"_s), jsNumber(AI_ADDRCONFIG),
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirect(vm, JSC::Identifier::fromString(vm, "ALL"_s), jsNumber(AI_ALL),
        JSC::PropertyAttribute::DontDelete | 0);
    dnsObject->putDirect(vm, JSC::Identifier::fromString(vm, "V4MAPPED"_s), jsNumber(AI_V4MAPPED),
        JSC::PropertyAttribute::DontDelete | 0);
    return dnsObject;
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionJSONLParse);
JSC_DECLARE_HOST_FUNCTION(jsFunctionJSONLParseChunk);

JSC_DEFINE_HOST_FUNCTION(jsFunctionJSONLParse, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(Jsonl, jsFunctionJSONLParse);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue arg = callFrame->argument(0);
    if (arg.isUndefinedOrNull()) {
        throwTypeError(globalObject, scope, "JSONL.parse requires a string argument"_s);
        return {};
    }

    MarkedArgumentBuffer values;
    JSC::StreamingJSONParseResult result;

    if (arg.isCell() && isTypedArrayType(arg.asCell()->type())) {
        auto* view = uncheckedDowncast<JSC::JSArrayBufferView>(arg.asCell());
        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "ArrayBuffer is detached"_s);
            return {};
        }
        auto* data = static_cast<const uint8_t*>(view->vector());
        size_t length = view->byteLength();
        Vector<uint8_t> copyOfSharedBytes;
        if (view->isShared()) {
            if (!copyOfSharedBytes.tryAppend(std::span { data, length })) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            data = copyOfSharedBytes.span().data();
        }

        // Skip UTF-8 BOM if present
        if (length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) {
            data += 3;
            length -= 3;
        }

        result.status = JSC::StreamingJSONParseResult::Status::NeedsText;
        if (length <= String::MaxLength) {
            result = JSC::streamingJSONParse(globalObject, std::span { reinterpret_cast<const char8_t*>(data), length }, values);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (result.status == JSC::StreamingJSONParseResult::Status::NeedsText) {
            values.clear();
            size_t u16Length = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(data), length);
            if (u16Length > String::MaxLength) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            auto str = Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(data), length });
            if (str.isNull()) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            result = JSC::streamingJSONParse(globalObject, str, values);
        }
    } else {
        auto* inputString = arg.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto view = inputString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        result = JSC::streamingJSONParse(globalObject, view, values);
    }

    RETURN_IF_EXCEPTION(scope, {});

    if (result.status == JSC::StreamingJSONParseResult::Status::Error && values.isEmpty()) {
        throwSyntaxError(globalObject, scope, "Failed to parse JSONL"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionJSONLParseChunk, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(Jsonl, jsFunctionJSONLParseChunk);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue arg = callFrame->argument(0);
    if (arg.isUndefinedOrNull()) {
        throwTypeError(globalObject, scope, "JSONL.parseChunk requires a string argument"_s);
        return {};
    }

    MarkedArgumentBuffer values;
    JSC::StreamingJSONParseResult result;
    size_t readBytes = 0;
    bool isTypedArray = arg.isCell() && isTypedArrayType(arg.asCell()->type());

    // Apply optional start/end offsets (byte offsets for typed arrays, character offsets for strings).
    // Populates start/end clamped to [0, length], with start <= end.
    size_t start;
    size_t end;
    const auto parseOffsets = [&](size_t length) {
        start = 0;
        end = length;

        JSValue startArg = callFrame->argument(1);
        if (startArg.isNumber()) {
            double s = startArg.asNumber();
            if (s > 0)
                start = static_cast<size_t>(std::min(s, static_cast<double>(length)));
        }

        JSValue endArg = callFrame->argument(2);
        if (endArg.isNumber()) {
            double e = endArg.asNumber();
            if (e >= 0)
                end = static_cast<size_t>(std::min(e, static_cast<double>(length)));
        }

        if (start > end)
            start = end;
    };

    if (isTypedArray) {
        auto* view = uncheckedDowncast<JSC::JSArrayBufferView>(arg.asCell());
        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "ArrayBuffer is detached"_s);
            return {};
        }
        auto* data = static_cast<const uint8_t*>(view->vector());
        size_t length = view->byteLength();
        parseOffsets(length);

        const uint8_t* sliceData = data + start;
        size_t sliceLen = end - start;
        Vector<uint8_t> copyOfSharedBytes;
        if (view->isShared()) {
            if (!copyOfSharedBytes.tryAppend(std::span { sliceData, sliceLen })) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            sliceData = copyOfSharedBytes.span().data();
        }

        // Skip UTF-8 BOM if present at the start of the slice
        size_t bomOffset = 0;
        if (start == 0 && sliceLen >= 3 && sliceData[0] == 0xEF && sliceData[1] == 0xBB && sliceData[2] == 0xBF) {
            sliceData += 3;
            sliceLen -= 3;
            bomOffset = 3;
        }

        result.status = JSC::StreamingJSONParseResult::Status::NeedsText;
        if (sliceLen <= String::MaxLength) {
            result = JSC::streamingJSONParse(globalObject, std::span { reinterpret_cast<const char8_t*>(sliceData), sliceLen }, values);
            RETURN_IF_EXCEPTION(scope, {});
            readBytes = start + bomOffset + result.charactersConsumed;
        }
        if (result.status == JSC::StreamingJSONParseResult::Status::NeedsText) {
            values.clear();
            size_t u16Length = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(sliceData), sliceLen);
            if (u16Length > String::MaxLength) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            auto str = Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(sliceData), sliceLen });
            if (str.isNull()) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            result = JSC::streamingJSONParse(globalObject, str, values);
            // Convert character offset back to UTF-8 byte offset
            if (str.is8Bit()) {
                readBytes = start + bomOffset + simdutf::utf8_length_from_latin1(reinterpret_cast<const char*>(str.span8().data()), result.charactersConsumed);
            } else {
                readBytes = start + bomOffset + simdutf::utf8_length_from_utf16le(reinterpret_cast<const char16_t*>(str.span16().data()), result.charactersConsumed);
            }
        }
    } else {
        auto* inputString = arg.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto view = inputString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        size_t length = view->length();
        parseOffsets(length);

        if (start != 0 || end != length) {
            result = JSC::streamingJSONParse(globalObject, view->substring(start, end - start), values);
        } else {
            result = JSC::streamingJSONParse(globalObject, view, values);
        }
        readBytes = start + result.charactersConsumed;
    }

    RETURN_IF_EXCEPTION(scope, {});

    JSArray* array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue errorValue = jsNull();
    if (result.status == JSC::StreamingJSONParseResult::Status::Error) {
        errorValue = createSyntaxError(globalObject, "Failed to parse JSONL"_s);
    }

    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    JSObject* resultObj = constructEmptyObject(vm, zigGlobalObject->jsonlParseResultStructure());
    resultObj->putDirectOffset(vm, 0, array);
    resultObj->putDirectOffset(vm, 1, jsNumber(readBytes));
    resultObj->putDirectOffset(vm, 2, jsBoolean(result.status == JSC::StreamingJSONParseResult::Status::Complete));
    resultObj->putDirectOffset(vm, 3, errorValue);

    return JSValue::encode(resultObj);
}

static JSValue constructJSONLObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::JSObject* jsonlObject = JSC::constructEmptyObject(globalObject);
    jsonlObject->putDirectNativeFunction(vm, globalObject, vm.propertyNames->parse, 1, jsFunctionJSONLParse, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    jsonlObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "parseChunk"_s), 1, jsFunctionJSONLParseChunk, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    jsonlObject->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "JSONL"_s),
        JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
    return jsonlObject;
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

JSC_DEFINE_HOST_FUNCTION(functionBunSleep,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSValue millisecondsValue = callFrame->argument(0);

    if (millisecondsValue.inherits<JSC::DateInstance>()) {
        auto now = MonotonicTime::now();
        double milliseconds = uncheckedDowncast<JSC::DateInstance>(millisecondsValue)->internalNumber() - now.approximate<WTF::WallTime>().secondsSinceEpoch().milliseconds();
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

JSC_DEFINE_HOST_FUNCTION(functionBunDeepEquals, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    auto& vm = JSC::getVM(global);

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "Expected 2 values to compare"_s);
        return {};
    }

    JSC::JSValue arg1 = callFrame->uncheckedArgument(0);
    JSC::JSValue arg2 = callFrame->uncheckedArgument(1);
    JSC::JSValue strict = callFrame->argument(2);
    JSC::JSValue skipPrototype = callFrame->argument(3);

    Vector<std::pair<JSValue, JSValue>, 16> stack;
    MarkedArgumentBuffer gcBuffer;

    if (strict.isBoolean() && strict.asBoolean()) {
        if (skipPrototype.isBoolean() && skipPrototype.asBoolean()) {
            bool isEqual = Bun__deepEquals<true, false, false, true>(globalObject, arg1, arg2, gcBuffer, stack, scope, true);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsBoolean(isEqual));
        }

        bool isEqual = Bun__deepEquals<true, false, false>(globalObject, arg1, arg2, gcBuffer, stack, scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    } else {
        bool isEqual = Bun__deepEquals<false, false, false>(globalObject, arg1, arg2, gcBuffer, stack, scope, true);
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
        throwTypeError(globalObject, scope, "Expected 2 values to compare"_s);
        return {};
    }

    JSC::JSValue subset = callFrame->uncheckedArgument(0);
    JSC::JSValue object = callFrame->uncheckedArgument(1);

    if (!subset.isObject() || !object.isObject()) {
        throwTypeError(globalObject, scope, "Expected 2 objects to match"_s);
        return {};
    }

    std::set<EncodedJSValue> objVisited;
    std::set<EncodedJSValue> subsetVisited;
    MarkedArgumentBuffer gcBuffer;
    bool match = Bun__deepMatch</* enableAsymmetricMatchers */ false>(object, &objVisited, subset, &subsetVisited, globalObject, scope, &gcBuffer, false, false);
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
        RETURN_IF_EXCEPTION(throwScope, {});
        pathString = pathResolveWTFString(lexicalGlobalObject, pathString);

        auto fileURL = WTF::URL::fileURLWithFileSystemPath(pathString);
        auto object = WebCore::DOMURL::create(fileURL.string(), String());
        jsValue = WebCore::toJSNewlyCreated<IDLInterface<DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTF::move(object));
    }

    RETURN_IF_EXCEPTION(throwScope, {});
    auto* jsDOMURL = uncheckedDowncast<JSDOMURL>(jsValue.asCell());
    vm.heap.reportExtraMemoryAllocated(jsDOMURL, jsDOMURL->wrapped().memoryCostForGC());
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsValue));
}

JSC_DEFINE_HOST_FUNCTION(functionGenerateHeapSnapshot, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    vm.ensureHeapProfiler();
    auto& heapProfiler = *vm.heapProfiler();
    heapProfiler.clearSnapshots();

    Bun__Feature__heap_snapshot += 1;

    JSValue arg0 = callFrame->argument(0);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    bool useV8 = false;
    bool useArrayBuffer = false;
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
        JSValue arg1 = callFrame->argument(1);
        if (!arg1.isUndefined()) {
            if (arg1.isString()) {
                auto str = arg1.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(throwScope, {});
                if (str == "arraybuffer"_s) {
                    useArrayBuffer = true;
                } else {
                    throwTypeError(globalObject, throwScope, "Expected 'arraybuffer' or undefined as second argument"_s);
                    return {};
                }
            }
        }

        if (useArrayBuffer) {
            JSC::BunV8HeapSnapshotBuilder builder(heapProfiler);
            auto bytes = builder.jsonBytes();
            heapProfiler.clearSnapshots();
            RETURN_IF_EXCEPTION(throwScope, {});
            auto released = bytes.releaseBuffer();
            auto span = released.leakSpan();
            auto buffer = ArrayBuffer::createFromBytes(std::span<const uint8_t> { span.data(), span.size() }, createSharedTask<void(void*)>([](void* p) {
                fastFree(p);
            }));
            return JSC::JSValue::encode(JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), WTF::move(buffer)));
        }

        JSC::BunV8HeapSnapshotBuilder builder(heapProfiler);
        auto json = builder.json();
        heapProfiler.clearSnapshots();
        RETURN_IF_EXCEPTION(throwScope, {});
        return JSC::JSValue::encode(jsString(vm, json));
    }

    JSC::HeapSnapshotBuilder builder(heapProfiler);
    builder.buildSnapshot();
    auto json = builder.json();
    heapProfiler.clearSnapshots();
    RETURN_IF_EXCEPTION(throwScope, {});
    // json() returns a null string if the snapshot exceeds the max string length.
    if (json.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, throwScope);
        return {};
    }
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
    if (!url.protocolIsFile()) [[unlikely]] {
        Bun::ERR::INVALID_URL_SCHEME(scope, globalObject, "file"_s);
        return {};
    }

// NOTE: On Windows, WTF::URL::fileSystemPath will handle UNC paths
// (`file:\\server\share\etc` -> `\\server\share\etc`), so hostname check only
// needs to happen on posix systems
#if !OS(WINDOWS)
    // file://host/path is illegal if `host` is not `localhost`.
    // Should be `file:///` instead
    if (url.host().length() > 0 && url.host() != "localhost"_s) [[unlikely]] {

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
    Archive                                        Bun::Bindgen::Generated::Archive::getArchiveConstructor             DontDelete|PropertyCallback
    ArrayBufferSink                                Bun::Bindgen::Generated::Sink::getArrayBufferSinkConstructor        DontDelete|PropertyCallback
    Cookie                                         constructCookieObject                                               DontDelete|ReadOnly|PropertyCallback
    CookieMap                                      constructCookieMapObject                                            DontDelete|ReadOnly|PropertyCallback
    CryptoHasher                                   Bun::Bindgen::Generated::CryptoHasher::getCryptoHasherConstructor   DontDelete|PropertyCallback
    FFI                                            BunObject_lazyPropCb_wrap_FFI                                       DontDelete|PropertyCallback
    FetchSession                                   Bun::Bindgen::Generated::FetchSession::getFetchSessionConstructor   DontDelete|PropertyCallback
    FileSystemRouter                               Bun::Bindgen::Generated::FilesystemRouter::getFileSystemRouterConstructor DontDelete|PropertyCallback
    Glob                                           Bun::Bindgen::Generated::Glob::getGlobConstructor                   DontDelete|PropertyCallback
    Image                                          Bun::Bindgen::Generated::Image::getImageConstructor                 DontDelete|PropertyCallback
    MD4                                            Bun::Bindgen::Generated::CryptoHasher::getMD4Constructor            DontDelete|PropertyCallback
    MD5                                            Bun::Bindgen::Generated::CryptoHasher::getMD5Constructor            DontDelete|PropertyCallback
    ModuleGraph                                    constructModuleGraphObject                                          DontDelete|ReadOnly|PropertyCallback
    SHA1                                           Bun::Bindgen::Generated::CryptoHasher::getSHA1Constructor           DontDelete|PropertyCallback
    SHA224                                         Bun::Bindgen::Generated::CryptoHasher::getSHA224Constructor         DontDelete|PropertyCallback
    SHA256                                         Bun::Bindgen::Generated::CryptoHasher::getSHA256Constructor         DontDelete|PropertyCallback
    SHA384                                         Bun::Bindgen::Generated::CryptoHasher::getSHA384Constructor         DontDelete|PropertyCallback
    SHA512                                         Bun::Bindgen::Generated::CryptoHasher::getSHA512Constructor         DontDelete|PropertyCallback
    SHA512_256                                     Bun::Bindgen::Generated::CryptoHasher::getSHA512_256Constructor     DontDelete|PropertyCallback
    JSONC                                          Bun::Bindgen::Generated::JSONCObject::createJSONC                   DontDelete|PropertyCallback
    JSON5                                          Bun::Bindgen::Generated::JSON5Object::createJSON5                   DontDelete|PropertyCallback
    JSONL                                          constructJSONLObject                                                ReadOnly|DontDelete|PropertyCallback
    markdown                                       Bun::Bindgen::Generated::MarkdownObject::createMarkdown             DontDelete|PropertyCallback
    TOML                                           Bun::Bindgen::Generated::TOMLObject::createTOML                     DontDelete|PropertyCallback
    XML                                            Bun::Bindgen::Generated::XMLObject::createXML                       DontDelete|PropertyCallback
    YAML                                           Bun::Bindgen::Generated::YAMLObject::createYAML                     DontDelete|PropertyCallback
    Transpiler                                     Bun::Bindgen::Generated::Transpiler::getTranspilerConstructor       DontDelete|PropertyCallback
    embeddedFiles                                  BunObject_lazyPropCb_wrap_embeddedFiles                             DontDelete|PropertyCallback
    S3Client                                       Bun::Bindgen::Generated::S3Client::getS3ClientConstructor           DontDelete|PropertyCallback
    s3                                             BunObject_lazyPropCb_wrap_s3                                        DontDelete|PropertyCallback
    CSRF                                           Bun::Bindgen::Generated::CsrfJsc::createCSRF                        DontDelete|PropertyCallback
    allocUnsafe                                    Bun::Bindgen::Generated::BunObject::jsAllocUnsafe                   DontDelete|Function 1
    argv                                           BunObject_lazyPropCb_wrap_argv                                      DontDelete|PropertyCallback
    build                                          Bun::Bindgen::Generated::JSBundler::jsBuild                         DontDelete|Function 1
    concatArrayBuffers                             functionConcatTypedArrays                                           DontDelete|Function 3
    connect                                        Bun::Bindgen::Generated::Listener::jsConnect                        DontDelete|Function 1
    cron                                           BunObject_lazyPropCb_wrap_cron                                      DontDelete|PropertyCallback
    cwd                                            BunObject_lazyPropCb_wrap_cwd                                       DontEnum|DontDelete|PropertyCallback
    color                                          Bun::Bindgen::Generated::ColorJs::jsColor                           DontDelete|Function 2
    deepEquals                                     functionBunDeepEquals                                               DontDelete|Function 2
    deepMatch                                      functionBunDeepMatch                                                DontDelete|Function 2
    deflateSync                                    Bun::Bindgen::Generated::BunObject::jsDeflateSync                   DontDelete|Function 1
    dns                                            constructDNSObject                                                  ReadOnly|DontDelete|PropertyCallback
    enableANSIColors                               BunObject_lazyPropCb_wrap_enableANSIColors                          DontDelete|PropertyCallback
    env                                            constructEnvObject                                                  ReadOnly|DontDelete|PropertyCallback
    escapeHTML                                     jsFunctionBunEscapeHTML                                             DontDelete|Function 2
    fetch                                          constructBunFetchObject                                             ReadOnly|DontDelete|PropertyCallback
    file                                           Bun::Bindgen::Generated::Blob::jsFile                               DontDelete|Function 1
    fileURLToPath                                  functionFileURLToPath                                               DontDelete|Function 1
    gc                                             Bun::Bindgen::Generated::BunObject::jsGc                            DontDelete|Function 1
    generateHeapSnapshot                           functionGenerateHeapSnapshot                                        DontDelete|Function 2
    gunzipSync                                     Bun::Bindgen::Generated::BunObject::jsGunzipSync                    DontDelete|Function 1
    gzipSync                                       Bun::Bindgen::Generated::BunObject::jsGzipSync                      DontDelete|Function 1
    hash                                           Bun::Bindgen::Generated::HashObject::createHash                     DontDelete|PropertyCallback
    indexOfLine                                    Bun::Bindgen::Generated::BunObject::jsIndexOfLine                   DontDelete|Function 1
    inflateSync                                    Bun::Bindgen::Generated::BunObject::jsInflateSync                   DontDelete|Function 1
    inspect                                        BunObject_lazyPropCb_wrap_inspect                                   DontDelete|PropertyCallback
    isMainThread                                   constructIsMainThread                                               ReadOnly|DontDelete|PropertyCallback
    isStandaloneExecutable                         BunObject_lazyPropCb_wrap_isStandaloneExecutable                    ReadOnly|DontDelete|PropertyCallback
    jest                                           Bun::Bindgen::Generated::Jest::jsJest                               DontEnum|DontDelete|Function 1
    listen                                         Bun::Bindgen::Generated::Listener::jsListen                         DontDelete|Function 1
    udpSocket                                      Bun::Bindgen::Generated::UdpSocket::jsUdpSocket                     DontDelete|Function 1
    main                                           bunObjectMain                                                       DontDelete|CustomAccessor
    mmap                                           Bun::Bindgen::Generated::BunObject::jsMmap                          DontDelete|Function 1
    nanoseconds                                    functionBunNanoseconds                                              DontDelete|Function 0
    openInEditor                                   Bun::Bindgen::Generated::BunObject::jsOpenInEditor                  DontDelete|Function 1
    origin                                         BunObject_lazyPropCb_wrap_origin                                    DontEnum|ReadOnly|DontDelete|PropertyCallback
    version_with_sha                               constructBunVersionWithSha                                          DontEnum|ReadOnly|DontDelete|PropertyCallback
    password                                       Bun::Bindgen::Generated::PasswordObject::createPassword             DontDelete|PropertyCallback
    pathToFileURL                                  functionPathToFileURL                                               DontDelete|Function 1
    peek                                           constructBunPeekObject                                              DontDelete|PropertyCallback
    plugin                                         constructPluginObject                                               ReadOnly|DontDelete|PropertyCallback
    randomUUIDv7                                   Bun::Bindgen::Generated::Crypto::jsRandomUUIDv7                     DontDelete|Function 2
    randomUUIDv5                                   Bun::Bindgen::Generated::Crypto::jsRandomUUIDv5                     DontDelete|Function 3
    readableStreamToArray                          WebCore::jsFunctionReadableStreamToArray           DontDelete|Function 1
    readableStreamToArrayBuffer                    WebCore::jsFunctionReadableStreamToArrayBuffer     DontDelete|Function 1
    readableStreamToBytes                          WebCore::jsFunctionReadableStreamToBytes           DontDelete|Function 1
    readableStreamToBlob                           WebCore::jsFunctionReadableStreamToBlob            DontDelete|Function 1
    readableStreamToFormData                       WebCore::jsFunctionReadableStreamToFormData        DontDelete|Function 1
    readableStreamToJSON                           WebCore::jsFunctionReadableStreamToJSON            DontDelete|Function 1
    readableStreamToText                           WebCore::jsFunctionReadableStreamToText            DontDelete|Function 1
    registerMacro                                  Bun::Bindgen::Generated::BunObjectInternals::jsRegisterMacro        DontEnum|DontDelete|Function 1
    resolve                                        Bun::Bindgen::Generated::BunObject::jsResolve                       DontDelete|Function 1
    resolveSync                                    Bun::Bindgen::Generated::BunObject::jsResolveSync                   DontDelete|Function 1
    revision                                       constructBunRevision                                                ReadOnly|DontDelete|PropertyCallback
    semver                                         Bun::Bindgen::Generated::SemverObject::createSemver                 ReadOnly|DontDelete|PropertyCallback
    sql                                            defaultBunSQLObject                                                 DontDelete|PropertyCallback
    postgres                                       defaultBunSQLObject                                                 DontDelete|PropertyCallback
    SQL                                            constructBunSQLObject                                               DontDelete|PropertyCallback
    serve                                          Bun::Bindgen::Generated::BunObject::jsServe                         DontDelete|Function 1
    sha                                            Bun::Bindgen::Generated::CryptoHasher::jsSha                        DontDelete|Function 1
    shrink                                         Bun::Bindgen::Generated::BunObject::jsShrink                        DontDelete|Function 0
    sliceAnsi                                      jsFunctionBunSliceAnsi                                              DontDelete|Function 5
    sleep                                          functionBunSleep                                                    DontDelete|Function 1
    sleepSync                                      Bun::Bindgen::Generated::BunObject::jsSleepSync                     DontDelete|Function 1
    spawn                                          Bun::Bindgen::Generated::JsBunSpawnBindings::jsSpawn                DontDelete|Function 1
    spawnSync                                      Bun::Bindgen::Generated::JsBunSpawnBindings::jsSpawnSync            DontDelete|Function 1
    stderr                                         BunObject_lazyPropCb_wrap_stderr                                    DontDelete|PropertyCallback
    stdin                                          BunObject_lazyPropCb_wrap_stdin                                     DontDelete|PropertyCallback
    stdout                                         BunObject_lazyPropCb_wrap_stdout                                    DontDelete|PropertyCallback
    stringWidth                                    jsFunctionBunStringWidth                                            DontDelete|Function 2
    stripANSI                                      jsFunctionBunStripANSI                                              DontDelete|Function 1
    wrapAnsi                                       jsFunctionBunWrapAnsi                                               DontDelete|Function 3
    Terminal                                       Bun::Bindgen::Generated::Terminal::getTerminalConstructor           DontDelete|PropertyCallback
    unsafe                                         Bun::Bindgen::Generated::UnsafeObject::createUnsafe                 DontDelete|PropertyCallback
    version                                        constructBunVersion                                                 ReadOnly|DontDelete|PropertyCallback
    WebView                                        constructWebViewObject                                              ReadOnly|DontDelete|PropertyCallback
    which                                          Bun::Bindgen::Generated::BunObject::jsWhich                         DontDelete|Function 1
    RedisClient                                    Bun::Bindgen::Generated::Valkey::getRedisClientConstructor          DontDelete|PropertyCallback
    redis                                          BunObject_lazyPropCb_wrap_valkey                                    DontDelete|PropertyCallback
    secrets                                        constructSecretsObject                                              DontDelete|PropertyCallback
    write                                          Bun::Bindgen::Generated::Blob::jsWrite                              DontDelete|Function 1
    zstdCompressSync                               Bun::Bindgen::Generated::BunObject::jsZstdCompressSync             DontDelete|Function 1
    zstdDecompressSync                             Bun::Bindgen::Generated::BunObject::jsZstdDecompressSync           DontDelete|Function 1
    zstdCompress                                 Bun::Bindgen::Generated::BunObject::jsZstdCompress                 DontDelete|Function 1
    zstdDecompress                                 Bun::Bindgen::Generated::BunObject::jsZstdDecompress                 DontDelete|Function 1
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        Bun::putToStringTagWithoutTransition(vm, this, info());
    }

    static JSBunObject* create(JSC::VM& vm, JSGlobalObject* globalObject)
    {
        auto structure = createStructure(vm, globalObject, globalObject->objectPrototype());
        auto* object = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSBunObject))) JSBunObject(vm, structure);
        object->finishCreation(vm);
        return object;
    }
};

extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_getter_main(JSC::JSGlobalObject*);
extern "C" bool SYSV_ABI BunObject_setter_main(JSC::JSGlobalObject*, JSC::EncodedJSValue);

static JSC_DEFINE_CUSTOM_GETTER(bunObjectMain, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisEncoded, PropertyName propertyName))
{
    (void)thisEncoded;
    (void)propertyName;
    return BunObject_getter_main(globalObject);
}

static JSC_DEFINE_CUSTOM_SETTER(setBunObjectMain, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisEncoded, JSC::EncodedJSValue encodedValue, PropertyName propertyName))
{
    (void)thisEncoded;
    (void)propertyName;
    return BunObject_setter_main(globalObject, encodedValue);
}

// LazyProperty wrappers for stdin/stderr/stdout
static JSValue BunObject_lazyPropCb_wrap_stdin(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return zigGlobalObject->m_bunStdin.getInitializedOnMainThread(zigGlobalObject);
}

static JSValue BunObject_lazyPropCb_wrap_stderr(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return zigGlobalObject->m_bunStderr.getInitializedOnMainThread(zigGlobalObject);
}

static JSValue BunObject_lazyPropCb_wrap_stdout(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return zigGlobalObject->m_bunStdout.getInitializedOnMainThread(zigGlobalObject);
}

#include "BunObject.lut.h"

const JSC::ClassInfo JSBunObject::s_info = { "Bun"_s, &Base::s_info, &bunObjectTable, nullptr, CREATE_METHOD_TABLE(JSBunObject) };

static JSValue constructCookieObject(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return WebCore::JSCookie::getConstructor(vm, zigGlobalObject);
}

static JSValue constructCookieMapObject(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return WebCore::JSCookieMap::getConstructor(vm, zigGlobalObject);
}

static JSValue constructModuleGraphObject(VM& vm, JSObject* bunObject)
{
    return uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject())->JSModuleGraphConstructor();
}

static JSValue constructSecretsObject(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return Bun::createSecretsObject(vm, zigGlobalObject);
}

static JSValue constructWebViewObject(VM& vm, JSObject* bunObject)
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(bunObject->globalObject());
    return zigGlobalObject->m_JSWebViewClassStructure.constructor(zigGlobalObject);
}

JSC::JSObject* createBunObject(VM& vm, JSObject* globalObject)
{
    return JSBunObject::create(vm, uncheckedDowncast<Zig::GlobalObject>(globalObject));
}

} // namespace Bun

namespace Zig {
JSC::JSObject* generateNativeModule_BunObject(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* object = globalObject->bunObject();

    // Static table entries are listed whether or not they have been reified, so this is the same export
    // list that reifying them all used to produce, minus the cost of constructing every one of them.
    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->getOwnNonIndexPropertyNames(globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    RELEASE_AND_RETURN(scope, exportObjectProperties(globalObject, object, propertyNames, exportNames, exportValues));
}

} // namespace Zig
