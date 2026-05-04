#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "headers-handwritten.h"
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>

#if ASAN_ENABLED
#include <sanitizer/lsan_interface.h>
#endif

extern "C" void BunString__toThreadSafe(BunString* str);
extern "C" bool BunString__fromJS(JSC::JSGlobalObject*, JSC::EncodedJSValue, BunString*);

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

// Synthesize the state Fuzzilli observed (fingerprints cb01d84a, 16d4efee,
// 4d4492f1, eac903bf): toWTFString yields a null WTF::String while no VM
// exception is pending. An exhaustive trace of JSC's toWTFString call chain
// shows every null-return site throws first, so this cannot be produced from
// JavaScript; we fabricate it by nulling a JSString's m_fiber so the
// isString() fast path in toWTFString returns valueInternal() = null without
// touching any throw scope. Then call BunString__fromJS (the actual binding
// String.fromJS uses) and report whether it returned Dead with no exception —
// the exact combination that trips `bun.debugAssert(has_exception)` and
// propagates a phantom error.JSError to host_fn.zig.
JSC_DEFINE_HOST_FUNCTION(jsFunction_BunString_fromJSNullNoException, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSString* s = jsNontrivialString(vm, "placeholder"_s);
    // Null the backing StringImpl* so valueInternal() is a null String and
    // isRope() is false (bit 0 clear). toWTFString(globalObject) on this
    // returns a null String without entering any throw scope.
    uintptr_t* fiber = std::bit_cast<uintptr_t*>(std::bit_cast<char*>(s) + JSString::offsetOfValue());
    uintptr_t saved = *fiber;
    *fiber = 0;

    BunString out { BunStringTag::Dead, {} };
    bool ok = BunString__fromJS(globalObject, JSValue::encode(s), &out);
    bool hasException = !!scope.exception();
    if (hasException)
        scope.clearException();

    // Restore so GC/destruction sees a valid JSString.
    *fiber = saved;

    JSObject* result = constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "ok"_s), jsBoolean(ok));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "dead"_s), jsBoolean(out.tag == BunStringTag::Dead));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "hasException"_s), jsBoolean(hasException));
    return JSValue::encode(result);
}

}
