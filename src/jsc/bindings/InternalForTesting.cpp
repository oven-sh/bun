#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/JSFunction.h"
#include "WebCoreJSBuiltins.h"
#include "headers-handwritten.h"
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>

#if ASAN_ENABLED
#include <sanitizer/lsan_interface.h>
#endif

extern "C" void BunString__toThreadSafe(BunString* str);

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunction_arrayBufferViewHasBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto value = callFrame->argument(0);
    auto view = uncheckedDowncast<WebCore::JSArrayBufferView>(value);
    return JSValue::encode(jsBoolean(view->hasArrayBuffer()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_hasReifiedStatic, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto object = callFrame->argument(0).getObject();
    if (!object) {
        return JSValue::encode(jsBoolean(false));
    }

    if (object->hasNonReifiedStaticProperties()) {
        return JSValue::encode(jsBoolean(true));
    }

    return JSValue::encode(jsBoolean(false));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_lsanDoLeakCheck, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ASAN_ENABLED
    return JSValue::encode(jsNumber(__lsan_do_recoverable_leak_check()));
#endif
    return encodedJSUndefined();
}

// Drives the `windowsEnv` JS builtin (see `ProcessObjectInternals.ts`) with
// caller-supplied args, returning the resulting Proxy. On Windows this
// wrapper is what `process.env` actually is; exposing it here lets tests
// exercise the Proxy's trap semantics on every platform rather than only
// when the Windows `createEnvironmentVariablesMap` branch runs.
//
// Expected args: (internalEnv: object, envMapList: string[], editCb: (k, v) => void)
JSC_DEFINE_HOST_FUNCTION(jsFunction_createWindowsEnvProxyForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSFunction* windowsEnv = JSC::JSFunction::create(vm, globalObject, WebCore::processObjectInternalsWindowsEnvCodeGenerator(vm), globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::MarkedArgumentBuffer args;
    args.append(callFrame->argument(0));
    args.append(callFrame->argument(1));
    args.append(callFrame->argument(2));

    JSC::CallData callData = JSC::getCallData(windowsEnv);
    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, windowsEnv, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});
    if (returnedException) {
        throwException(globalObject, scope, returnedException.get());
        return {};
    }
    return JSValue::encode(result);
}

// Returns the net refcount change on the *original* StringImpl after a
// BunString owning one ref to it is passed through BunString__toThreadSafe
// and then released. A correct implementation must return 0; a positive
// value means BunString__toThreadSafe leaked a reference to the original
// StringImpl when it installed the isolated copy.
JSC_DEFINE_HOST_FUNCTION(jsFunction_BunString_toThreadSafeRefCountDelta, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // Create a fresh, non-static, non-atom StringImpl with exactly one ref
    // held by `original`.
    Ref<WTF::StringImpl> original = WTF::String::fromLatin1("BunString__toThreadSafe leak test").releaseImpl().releaseNonNull();

    const unsigned before = original->refCount();

    // Give the BunString its own ref, mirroring how a Zig-side bun.String
    // owns one reference to the underlying StringImpl.
    original->ref();
    BunString str = { BunStringTag::WTFStringImpl, { .wtf = original.ptr() } };

    BunString__toThreadSafe(&str);

    // Drop whatever the BunString now owns (the isolated copy, or the
    // original if the implementation ever decides no copy is needed).
    ASSERT(str.tag == BunStringTag::WTFStringImpl);
    str.impl.wtf->deref();

    const unsigned after = original->refCount();
    return JSValue::encode(jsNumber(static_cast<int32_t>(after) - static_cast<int32_t>(before)));
}

}
