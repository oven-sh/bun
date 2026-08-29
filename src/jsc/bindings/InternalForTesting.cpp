#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "headers-handwritten.h"
#include "webcore/HTTPHeaderMap.h"
#include <wtf/text/AtomStringImpl.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>

extern "C" BunString BunString__threadIsolatedCopy(const BunString* str);
extern "C" void BunString__makeThreadShareable(BunString* str);
extern "C" void Zig__GlobalObject__testIsolationResetStats(Zig::GlobalObject*, uint32_t*, uint32_t*);

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

JSC_DEFINE_HOST_FUNCTION(jsFunction_testIsolationResetStats, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = globalObject->vm();
    uint32_t reuse = 0, swap = 0;
    Zig__GlobalObject__testIsolationResetStats(defaultGlobalObject(globalObject), &reuse, &swap);
    auto* obj = JSC::constructEmptyObject(globalObject);
    obj->putDirect(vm, Identifier::fromString(vm, "reuse"_s), jsNumber(reuse));
    obj->putDirect(vm, Identifier::fromString(vm, "swap"_s), jsNumber(swap));
    return JSValue::encode(obj);
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

// Side-effect-free report of whether this binary was compiled with
// AddressSanitizer. Lets the test harness detect ASAN cheaply.
JSC_DEFINE_HOST_FUNCTION(jsFunction_isASANEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ASAN_ENABLED
    return JSValue::encode(jsBoolean(true));
#else
    return JSValue::encode(jsBoolean(false));
#endif
}

// Net refcount change on the *original* StringImpl after a BunString owning
// one ref to it goes through BunString__threadIsolatedCopy and both are
// released. 0 is correct; positive means the original was leaked.
JSC_DEFINE_HOST_FUNCTION(jsFunction_BunString_threadIsolatedCopyRefCountDelta, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    Ref<WTF::StringImpl> original = WTF::String::fromLatin1("BunString__threadIsolatedCopy leak test").releaseImpl().releaseNonNull();
    const unsigned before = original->refCount();

    original->ref();
    BunString str = { BunStringTag::WTFStringImpl, { .wtf = original.ptr() } };
    BunString copy = BunString__threadIsolatedCopy(&str);
    ASSERT(copy.tag == BunStringTag::WTFStringImpl && copy.impl.wtf != original.ptr());
    copy.impl.wtf->deref();
    str.impl.wtf->deref();

    const unsigned after = original->refCount();
    return JSValue::encode(jsNumber(static_cast<int32_t>(after) - static_cast<int32_t>(before)));
}

// Same for BunString__makeThreadShareable on an atom: it must swap in an
// isolated copy and release exactly the one ref the BunString held on the atom.
JSC_DEFINE_HOST_FUNCTION(jsFunction_BunString_makeThreadShareableRefCountDelta, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    Ref<WTF::StringImpl> original = WTF::AtomStringImpl::add(WTF::String::fromLatin1("BunString__makeThreadShareable leak test").impl()).releaseNonNull();
    ASSERT(original->isAtom());
    const unsigned before = original->refCount();

    original->ref();
    BunString str = { BunStringTag::WTFStringImpl, { .wtf = original.ptr() } };
    BunString__makeThreadShareable(&str);
    ASSERT(str.tag == BunStringTag::WTFStringImpl && str.impl.wtf != original.ptr() && !str.impl.wtf->isAtom());
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
