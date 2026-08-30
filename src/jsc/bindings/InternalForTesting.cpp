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
#include <memory>
#if !OS(WINDOWS)
#include <pthread.h>
#include <unistd.h>
#endif

extern "C" BunString BunString__threadIsolatedCopy(const BunString* str);
extern "C" void BunString__makeThreadShareable(BunString* str);

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

#if !OS(WINDOWS)
static void* spawnThreadsForTestingEntry(void* arg)
{
    return arg;
}

struct SpawnThreadsForTestingLoop {
    int32_t iterations;
    int fd;
};

// Written right away: the caller may be killed a few microseconds later by the
// exec it is racing.
static void recordSpawnThreadsForTestingFailure(int fd, int rc)
{
    char message[64];
    int length = snprintf(message, sizeof message, "pthread_create failed: errno %d\n", rc);
    if (fd >= 0 && length > 0)
        (void)write(fd, message, static_cast<size_t>(length));
}

// Spawns `iterations` detached no-op threads. Stops at the first failure,
// records it to `fd` and returns it.
static void* spawnThreadsForTestingLoop(void* arg)
{
    std::unique_ptr<SpawnThreadsForTestingLoop> loop(static_cast<SpawnThreadsForTestingLoop*>(arg));
    // Detached threads with a small stack keep each spawn cheap (no join, and
    // ASAN clears the shadow of the whole stack on thread start), so more
    // spawns land in the exec window.
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 64 * 1024);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    intptr_t result = 0;
    for (int32_t i = 0; i < loop->iterations; i++) {
        pthread_t thread;
        int rc = pthread_create(&thread, &attr, spawnThreadsForTestingEntry, nullptr);
        if (rc != 0) {
            recordSpawnThreadsForTestingFailure(loop->fd, rc);
            result = rc;
            break;
        }
    }
    pthread_attr_destroy(&attr);
    return reinterpret_cast<void*>(result);
}
#endif

// Runs `parallelism` threads that each spawn `iterations` no-op threads through
// bun's own pthread_create, so a test can keep this process inside clone(2)
// while an execve(2) runs on another thread. Each failure is written to `fd`
// (a file, so the record survives the exec). With `detach` the loops run in
// the background and the call returns 0 at once. Otherwise it waits for them
// and returns the first failing errno, or 0 when every spawn succeeded.
JSC_DEFINE_HOST_FUNCTION(jsFunction_spawnThreadsForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if OS(WINDOWS)
    UNUSED_PARAM(globalObject);
    UNUSED_PARAM(callFrame);
    return JSValue::encode(jsNumber(0));
#else
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    int32_t iterations = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int32_t fd = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int32_t parallelism = callFrame->argument(2).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool detach = callFrame->argument(3).toBoolean(globalObject);
    if (parallelism < 1)
        parallelism = 1;
    if (parallelism > 64)
        parallelism = 64;

    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, detach ? PTHREAD_CREATE_DETACHED : PTHREAD_CREATE_JOINABLE);
    pthread_t loops[64];
    int32_t started = 0;
    int firstError = 0;
    for (; started < parallelism; started++) {
        // Owned by the loop thread.
        auto* loop = new SpawnThreadsForTestingLoop { iterations, fd };
        int rc = pthread_create(&loops[started], &attr, spawnThreadsForTestingLoop, loop);
        if (rc != 0) {
            delete loop;
            recordSpawnThreadsForTestingFailure(fd, rc);
            firstError = rc;
            break;
        }
    }
    pthread_attr_destroy(&attr);
    if (!detach) {
        for (int32_t i = 0; i < started; i++) {
            void* result = nullptr;
            pthread_join(loops[i], &result);
            int rc = static_cast<int>(reinterpret_cast<intptr_t>(result));
            if (rc != 0 && firstError == 0)
                firstError = rc;
        }
    }
    return JSValue::encode(jsNumber(firstError));
#endif
}

}
