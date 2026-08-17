#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "headers-handwritten.h"
#include "webcore/HTTPHeaderMap.h"
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <mimalloc.h>
#include <openssl/err.h>
#include <openssl/mem.h>
#include <unicode/uidna.h>
#if OS(WINDOWS)
#include <uv.h>
#endif

extern "C" void BunString__toThreadSafe(BunString* str);
extern "C" size_t Bun__boringsslSystemMallocCount();

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

// bun has no global malloc override on Windows or macOS, so the C libraries it
// links are pointed at mimalloc one by one. Allocates through each library's
// own allocator and reports whether mimalloc owns the block; `null` marks a
// library that is not linked on this platform.
JSC_DEFINE_HOST_FUNCTION(jsFunction_thirdPartyAllocationsUseMimalloc, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = globalObject->vm();

    // OPENSSL_malloc -> OPENSSL_memory_alloc (src/boringssl/lib.rs).
    void* opensslBlock = OPENSSL_malloc(64);
    bool boringssl = opensslBlock && mi_is_in_heap_region(opensslBlock);
    OPENSSL_free(opensslBlock);

    // The error queue keeps its strings off OPENSSL_malloc; with
    // patches/boringssl/system-malloc-hooks.patch they come from
    // OPENSSL_system_malloc instead of the CRT. ERR_add_error_dataf formats
    // into a 64 byte buffer first, so a longer string also goes through
    // OPENSSL_system_realloc and the pointer checked below is the one it
    // returned.
    ERR_clear_error();
    ERR_put_error(ERR_LIB_USER, 0, ERR_R_INTERNAL_ERROR, __FILE__, __LINE__);
    ERR_add_error_dataf("%s", "bun:internal-for-testing thirdPartyAllocationsUseMimalloc, long enough to outgrow the initial buffer");
    const char* errorData = nullptr;
    int errorFlags = 0;
    ERR_peek_last_error_line_data(nullptr, nullptr, &errorData, &errorFlags);
    bool boringsslErrorQueue = errorData && (errorFlags & ERR_FLAG_STRING) && mi_is_in_heap_region(errorData);
    ERR_clear_error();

    // ICU objects are allocated with uprv_malloc, i.e. by whatever
    // u_setMemoryFunctions installed (bun_icu_malloc.cpp).
    UErrorCode status = U_ZERO_ERROR;
    UIDNA* idna = uidna_openUTS46(UIDNA_DEFAULT, &status);
    bool icu = U_SUCCESS(status) && idna && mi_is_in_heap_region(idna);
    if (idna)
        uidna_close(idna);

    auto* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "boringssl"_s), JSC::jsBoolean(boringssl));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "boringsslErrorQueue"_s), JSC::jsBoolean(boringsslErrorQueue));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "icu"_s), JSC::jsBoolean(icu));

#if OS(WINDOWS)
    // uv_os_environ allocates the array with uv__calloc, i.e. whatever
    // uv_replace_allocator installed (src/bun_bin/lib.rs).
    uv_env_item_t* envItems = nullptr;
    int envCount = 0;
    bool libuv = uv_os_environ(&envItems, &envCount) == 0 && envItems && mi_is_in_heap_region(envItems);
    if (envItems)
        uv_os_free_environ(envItems, envCount);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "libuv"_s), JSC::jsBoolean(libuv));
#else
    result->putDirect(vm, JSC::Identifier::fromString(vm, "libuv"_s), JSC::jsNull());
#endif

    return JSC::JSValue::encode(result);
}

// Number of OPENSSL_system_malloc calls BoringSSL has made on this thread
// (src/boringssl/lib.rs), so a test can see TLS record processing reach the
// hook rather than the CRT.
JSC_DEFINE_HOST_FUNCTION(jsFunction_boringsslSystemMallocCount, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(Bun__boringsslSystemMallocCount())));
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
