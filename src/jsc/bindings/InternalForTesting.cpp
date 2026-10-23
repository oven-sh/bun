#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "headers-handwritten.h"
#include "webcore/HTTPHeaderMap.h"
#include "webcore/JSWebSocket.h"
#include "webcore/WebSocket.h"
#include "node/JSNodeHTTPServerSocket.h"
#include <wtf/text/AtomStringImpl.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <wtf/text/WTFString.h>
#include <atomic>
#include <memory>
#if !OS(WINDOWS)
#include <pthread.h>
#include <sched.h>
#include <unistd.h>
#endif
#include <JavaScriptCore/ObjectConstructor.h>
#if ENABLE(AOT)
#include "BunAOTCompile.h"
#include <JavaScriptCore/AOTBuiltinTable.h>
#include <JavaScriptCore/AOTBuiltinTableBindings.h>
#include <JavaScriptCore/AOTBuiltinTableRealm.h>
#include <JavaScriptCore/AOTNameClass.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include "JS2Native.h"
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

JSC_DEFINE_HOST_FUNCTION(jsFunction_readFreedStringUnderASAN, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ASAN_ENABLED
    WTF::StringImpl* volatile freed = nullptr;
    {
        WTF::String string = WTF::makeString("freed "_s, callFrame->argumentCount());
        freed = string.impl();
    }
    return JSValue::encode(jsNumber(freed->length()));
#else
    return JSValue::encode(jsUndefined());
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_aotBuiltinMismatches, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* result = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    if (!JSC::AOT::BuiltinBindings::hasHost())
        Bun__AOT__registerHostBindings();
    for (auto& mismatch : JSC::AOT::BuiltinTable::singleton().mismatches(globalObject)) {
        result->push(globalObject, jsString(vm, mismatch));
        RETURN_IF_EXCEPTION(scope, {});
    }
#endif
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_aotBuiltinEntries, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ENABLE(AOT)
    return JSValue::encode(JSC::AOT::BuiltinTable::singleton().describeForTesting(globalObject));
#else
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* result = constructEmptyObject(globalObject);
    result->putDirect(vm, Identifier::fromString(vm, "hash"_s), jsEmptyString(vm));
    for (auto name : { "entries"_s, "classes"_s, "layouts"_s }) {
        JSArray* entries = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        result->putDirect(vm, Identifier::fromString(vm, name), entries);
    }
    return JSValue::encode(result);
#endif
}

#if ENABLE(AOT)
// A function that passes its receiver and its arguments to the native code that compiled code calls for the overload without a function object.
static JSValue functionCallingDirectly(JSC::JSGlobalObject* globalObject, JSC::AOT::BuiltinOverloadID overload)
{
    using namespace JSC::AOT;
    std::optional<uint32_t> number = BuiltinBindings::directFunctionNumberOf(overload);
    if (!number)
        return jsUndefined();
    const BuiltinDirectFunctionBinding& binding = BuiltinBindings::directFunctionAt(*number);
    auto parameters = std::span(binding.parameters).first(binding.parameterCount);
    bool takesOnlyWords = std::ranges::all_of(parameters, [](BuiltinDirectValue parameter) {
        return parameter == BuiltinDirectValue::Realm || parameter == BuiltinDirectValue::Receiver || parameter == BuiltinDirectValue::Value || parameter == BuiltinDirectValue::ValueOrEmpty;
    });
    if (!takesOnlyWords)
        return jsUndefined();

    return JSNativeStdFunction::create(globalObject->vm(), globalObject, 0, {}, [&binding](JSGlobalObject* realm, CallFrame* frame) -> EncodedJSValue {
        std::array<uint64_t, BuiltinDirectFunctionBinding::maxParameterCount> words {};
        static_assert(words.size() == 6);
        size_t argument = 0;
        for (size_t index = 0; index < binding.parameterCount; ++index) {
            switch (binding.parameters[index]) {
            case BuiltinDirectValue::Realm:
                words[index] = std::bit_cast<uintptr_t>(realm);
                break;
            case BuiltinDirectValue::Receiver:
                words[index] = JSValue::encode(frame->thisValue());
                break;
            case BuiltinDirectValue::Value:
                words[index] = JSValue::encode(frame->argument(argument++));
                break;
            case BuiltinDirectValue::ValueOrEmpty:
                words[index] = JSValue::encode(argument < frame->argumentCount() ? frame->uncheckedArgument(argument) : JSValue());
                ++argument;
                break;
            default:
                RELEASE_ASSERT_NOT_REACHED();
            }
        }
        using Function = EncodedJSValue(SYSV_ABI*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
        return reinterpret_cast<Function>(const_cast<void*>(binding.function))(words[0], words[1], words[2], words[3], words[4], words[5]);
    });
}
#endif

JSC_DEFINE_HOST_FUNCTION(jsFunction_aotBuiltinValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ENABLE(AOT)
    using namespace JSC::AOT;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint32_t index = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto part = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto& table = BuiltinTable::singleton();
    if (index >= table.builtinCount())
        return JSValue::encode(jsUndefined());
    if (!BuiltinBindings::hasHost())
        Bun__AOT__registerHostBindings();

    BuiltinID id(index);
    if (part.startsWith("direct:"_s)) {
        std::optional<uint32_t> position = parseInteger<uint32_t>(StringView(part).substring(7));
        uint32_t seen = 0;
        for (BuiltinOverloadID overload : table.overloadIDsOf(id)) {
            if (position && seen++ == *position)
                return JSValue::encode(functionCallingDirectly(globalObject, overload));
        }
        return JSValue::encode(jsUndefined());
    }
    if (table.at(id).kind == BuiltinKind::NativeBinding) {
        // What native code hands over by itself has no number: no text evaluates it.
        std::optional<uint16_t> hostNumber = BuiltinBindings::hostNumberOf(id);
        if (!hostNumber)
            return JSValue::encode(jsUndefined());
        RELEASE_AND_RETURN(scope, JSValue::encode(JS2Native::nativeBinding(globalObject, *hostNumber)));
    }

    auto key = part == "getter"_s ? BuiltinCellKey::getter(id) : part == "setter"_s ? BuiltinCellKey::setter(id)
                                                                                    : BuiltinCellKey::object(id);
    auto cell = findInRealm(globalObject, key);
    return JSValue::encode(cell ? JSValue(*cell) : jsUndefined());
#else
    return JSValue::encode(jsUndefined());
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_builtinFeatureUses, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ENABLE(AOT)
#if OS(DARWIN)
    constexpr auto platform = JSC::AOT::BuiltinPlatform::Darwin;
#elif OS(ANDROID)
    constexpr auto platform = JSC::AOT::BuiltinPlatform::Android;
#elif OS(LINUX)
    constexpr auto platform = JSC::AOT::BuiltinPlatform::Linux;
#elif OS(WINDOWS)
    constexpr auto platform = JSC::AOT::BuiltinPlatform::Windows;
#elif OS(FREEBSD)
    constexpr auto platform = JSC::AOT::BuiltinPlatform::FreeBSD;
#else
#error "The built-ins table has no platform for this operating system"
#endif
    return JSValue::encode(JSC::AOT::BuiltinTable::singleton().describeFeatureUsesForTesting(globalObject, platform));
#else
    return JSValue::encode(constructEmptyArray(globalObject, nullptr));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_aotNameClass, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto text = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    auto utf8 = text.utf8();
    auto nameClass = JSC::AOT::Typed::classifyName(byteCast<uint8_t>(utf8.span()));
    return JSValue::encode(jsNontrivialString(vm, String(JSC::AOT::Typed::nameOf(nameClass))));
#else
    return JSValue::encode(jsUndefined());
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

}

// For setSocketOptions(): the sockets that C++ classes own. Null for anything else, and for one that isn't connected.
extern "C" us_socket_t* Bun__usSocketForTesting(JSC::EncodedJSValue encodedValue)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* webSocket = dynamicDowncast<WebCore::JSWebSocket>(value))
        return webSocket->wrapped().usSocket();
    if (auto* socket = dynamicDowncast<Bun::JSNodeHTTPServerSocket>(value))
        return socket->socket;
    return nullptr;
}
