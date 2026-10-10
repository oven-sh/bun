#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "headers-handwritten.h"
#include "webcore/HTTPHeaderMap.h"
#include <wtf/text/AtomStringImpl.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <wtf/text/WTFString.h>
#include <bun-uws/src/HttpRouter.h>
#include <algorithm>
#include <atomic>
#include <memory>
#include <string>
#include <string_view>
#include <vector>
#if !OS(WINDOWS)
#include <pthread.h>
#include <sched.h>
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
    bool detached;
    // Lives on the caller's stack; each loop bumps it exactly once, after its first spawn attempt.
    std::atomic<int32_t>* runningLoops;
};

// Written at once: the exec this thread races may kill it microseconds later.
static void recordSpawnThreadsForTesting(int fd, const char* what, int value)
{
    char message[96];
    int length = snprintf(message, sizeof message, "%s %d\n", what, value);
    if (fd >= 0 && length > 0)
        (void)write(fd, message, static_cast<size_t>(length));
}

// Spawns `iterations` detached no-op threads; stops at and records the first failure.
static void* spawnThreadsForTestingLoop(void* arg)
{
    std::unique_ptr<SpawnThreadsForTestingLoop> loop(static_cast<SpawnThreadsForTestingLoop*>(arg));
    // Small detached stacks keep each spawn cheap (ASAN clears a whole stack's shadow at start).
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 64 * 1024);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    intptr_t result = 0;
    // The caller waits for this; it happens once the first spawn attempt has returned.
    bool reportedRunning = false;
    for (int32_t i = 0; i < loop->iterations; i++) {
        pthread_t thread;
        int rc = pthread_create(&thread, &attr, spawnThreadsForTestingEntry, nullptr);
        if (!reportedRunning) {
            reportedRunning = true;
            loop->runningLoops->fetch_add(1, std::memory_order_release);
        }
        if (rc != 0) {
            recordSpawnThreadsForTesting(loop->fd, "pthread_create failed: errno", rc);
            result = rc;
            break;
        }
    }
    if (!reportedRunning)
        loop->runningLoops->fetch_add(1, std::memory_order_release);
    pthread_attr_destroy(&attr);
    // A detached loop has no return value, so a test that expects the loop to outlive it
    // can see in the file when it ran out of iterations instead.
    if (loop->detached && result == 0)
        recordSpawnThreadsForTesting(loop->fd, "loop finished after spawning", loop->iterations);
    return reinterpret_cast<void*>(result);
}
#endif

// (iterations, fd, parallelism, detach): see spawnThreadsForTesting in internal-for-testing.ts.
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
    std::atomic<int32_t> runningLoops { 0 };
    pthread_t loops[64];
    int32_t started = 0;
    int firstError = 0;
    for (; started < parallelism; started++) {
        // Owned by the loop thread.
        auto* loop = new SpawnThreadsForTestingLoop { iterations, fd, detach, &runningLoops };
        int rc = pthread_create(&loops[started], &attr, spawnThreadsForTestingLoop, loop);
        if (rc != 0) {
            delete loop;
            recordSpawnThreadsForTesting(fd, "loop thread pthread_create failed: errno", rc);
            firstError = rc;
            break;
        }
    }
    pthread_attr_destroy(&attr);
    // Every loop has made its first spawn attempt by the time this returns.
    while (runningLoops.load(std::memory_order_acquire) < started)
        sched_yield();
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

namespace {

struct HttpRouterScriptData {
    uint64_t request = 0;
    std::string* trace = nullptr;
};

using ScriptedHttpRouter = uWS::HttpRouter<HttpRouterScriptData>;

std::vector<std::string_view> splitFields(std::string_view text, char separator)
{
    std::vector<std::string_view> fields;
    for (;;) {
        size_t end = text.find(separator);
        fields.push_back(text.substr(0, end));
        if (end == std::string_view::npos)
            return fields;
        text.remove_prefix(end + 1);
    }
}

bool hasEmpty(const std::vector<std::string_view>& list)
{
    return std::ranges::find(list, std::string_view()) != list.end();
}

bool parsePriority(std::string_view name, uint32_t& priority)
{
    if (name == "H")
        priority = ScriptedHttpRouter::HIGH_PRIORITY;
    else if (name == "M")
        priority = ScriptedHttpRouter::MEDIUM_PRIORITY;
    else if (name == "L")
        priority = ScriptedHttpRouter::LOW_PRIORITY;
    else
        return false;
    return true;
}

}

// One uWS::HttpRouter call per script line, for tests. test/js/bun/http/bun-serve-routes.test.ts has the line formats.
JSC_DEFINE_HOST_FUNCTION(jsFunction_httpRouterScript, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto script = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto utf8 = script.utf8();
    auto bytes = byteCast<char>(utf8.span());

    auto router = std::make_unique<ScriptedHttpRouter>();
    std::string output;
    std::string trace;
    uint32_t nextHandler = 0;
    uint64_t requests = 0;

    for (std::string_view line : splitFields(std::string_view(bytes.data(), bytes.size()), '\n')) {
        if (line.empty())
            continue;
        auto fields = splitFields(line, ' ');
        // An empty field or method name is a typing error in the script: no command runs.
        std::string_view command = hasEmpty(fields) ? std::string_view() : fields[0];
        uint32_t priority = 0;
        std::vector<std::string_view> methods;
        std::optional<uint64_t> yieldPercent;
        if (command == "add" && fields.size() == 5) {
            methods = splitFields(fields[2], ',');
            yieldPercent = parseInteger<uint64_t>(StringView(std::span<const char>(fields[4].data(), fields[4].size())));
        }

        if (yieldPercent && parsePriority(fields[1], priority) && !hasEmpty(methods)) {
            uint32_t id = nextHandler++;
            router->add(methods, fields[3], [id, yieldPercent = *yieldPercent](ScriptedHttpRouter* r) {
                auto& data = r->getUserData();
                auto [top, params] = r->getParameters();
                data.trace->append(" ").append(std::to_string(id)).append("(");
                for (int i = 0; i <= top; i++) {
                    if (i)
                        data.trace->append(",");
                    data.trace->append(params[i]);
                }
                data.trace->append(")");
                // The same handler answers some requests and yields others.
                uint64_t mixed = (uint64_t(id) * 0x9e3779b97f4a7c15ull) ^ (data.request * 0xbf58476d1ce4e5b9ull);
                mixed ^= mixed >> 31;
                return (mixed % 100) >= yieldPercent; }, priority);
        } else if (command == "remove" && fields.size() == 4 && parsePriority(fields[1], priority)) {
            output.append(router->remove(fields[2], fields[3], priority) ? "r1\n" : "r0\n");
        } else if (command == "route" && fields.size() == 3) {
            trace.clear();
            router->getUserData().trace = &trace;
            router->getUserData().request = requests++;
            bool matched = router->route(fields[1], fields[2]);
            output.append(matched ? "1" : "0").append(trace).append("\n");
        } else if (command == "reset" && fields.size() == 1) {
            router = std::make_unique<ScriptedHttpRouter>();
        } else {
            throwTypeError(globalObject, scope, makeString("httpRouterScript: cannot run the line \""_s, WTF::String::fromUTF8(std::span(line.data(), line.size())), "\""_s));
            return {};
        }
    }

    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(std::span(output.data(), output.size()))));
}

}
