#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "headers-handwritten.h"
#include "webcore/HTTPHeaderMap.h"
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>

#if ASAN_ENABLED
#include <sanitizer/lsan_interface.h>
#endif

extern "C" void BunString__toThreadSafe(BunString* str);

namespace Bun {

using namespace JSC;

// Exercises WebCore::lowercaseHeaderName — the Highway-SIMD-backed header-name
// lowercasing used by the Headers iterator — directly from JS so a test can
// check it against a scalar reference across lengths and alignments.
JSC_DEFINE_HOST_FUNCTION(jsFunction_lowercaseHeaderNameSIMD, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto string = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsString(vm, WebCore::lowercaseHeaderName(string)));
}

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

// Side-effect-free report of whether this binary was compiled with
// AddressSanitizer. Lets the test harness detect ASAN without running a
// stop-the-world leak check (see jsFunction_lsanDoLeakCheck).
JSC_DEFINE_HOST_FUNCTION(jsFunction_isASANEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ASAN_ENABLED
    return JSValue::encode(jsBoolean(true));
#else
    return JSValue::encode(jsBoolean(false));
#endif
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

    // Give the BunString its own ref, mirroring how a Rust-side bun.String
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

extern "C" void Bun__MemoryPressure__emit(JSC::JSGlobalObject* global, int level);
extern "C" bool Bun__MemoryPressure__isInstalled(JSC::JSGlobalObject* global);

// Synthetically fire process.on("memoryPressure") so tests can exercise the
// emit path without depending on real OS memory pressure.
JSC_DEFINE_HOST_FUNCTION(jsFunction_emitMemoryPressure, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto str = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int level = str == "warning"_s ? 2 : 4;
    Bun__MemoryPressure__emit(defaultGlobalObject(globalObject), level);
    return encodedJSUndefined();
}

// Whether the per-VM memory-pressure watcher is currently installed, so tests
// can observe that process.on/off actually arm/disarm the OS backend.
JSC_DEFINE_HOST_FUNCTION(jsFunction_isMemoryPressureWatcherInstalled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(Bun__MemoryPressure__isInstalled(defaultGlobalObject(globalObject))));
}

}
