// JSC multi-eval benchmark - 1000 scripts in same VM
//
// Tests compile + eval performance for same vs varied scripts
//
// Build: cmake --build build/release --target bench-jsc-multi-eval
// Usage: ./bench-jsc-multi-eval

#define ENABLE_COCOA_WEBM_PLAYER 0
#include "root.h"

#include <sys/resource.h>

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/JSCConfig.h>
#include <wtf/Stopwatch.h>

using namespace JSC;

class MinimalClientData : public JSC::VM::ClientData {
public:
    MinimalClientData() = default;
    virtual ~MinimalClientData() = default;
    WTF::String overrideSourceURL(const JSC::StackFrame&, const WTF::String& originalSourceURL) const override {
        return originalSourceURL;
    }
};

extern "C" {
void Bun__errorInstance__finalize(void*) {}
static char dummyTimer = 0;
void* WTFTimer__create(void*, void*, void*) { return &dummyTimer; }
void WTFTimer__deinit(void*) {}
void WTFTimer__cancel(void*) {}
void WTFTimer__update(void*, double, bool) {}
bool WTFTimer__isActive(void*) { return false; }
double WTFTimer__secondsUntilTimer(void*) { return 0.0; }
void* Bun__getVM() { return nullptr; }
}

static double getRSSMB() {
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
    return usage.ru_maxrss / (1024.0 * 1024.0);
#else
    return usage.ru_maxrss / 1024.0;
#endif
}

int main() {
    constexpr int NUM_SCRIPTS = 1000;

    // Initialize
    WTF::initialize();
    JSC::Config::enableRestrictedOptions();
    WTF::initializeMainThread();
    JSC::initialize();
    {
        JSC::Options::AllowUnfinalizedAccessScope scope;
        JSC::Options::useConcurrentJIT() = true;
        JSC::Options::useJIT() = true;
        JSC::Options::assertOptionsAreCoherent();
    }

    // Create VM + GlobalObject
    auto vmPtr = JSC::VM::tryCreate(JSC::HeapType::Large);
    vmPtr->refSuppressingSaferCPPChecking();
    auto& vm = *vmPtr;
    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);
    vm.clientData = new MinimalClientData();

    auto* structure = JSC::JSGlobalObject::createStructure(vm, JSC::jsNull());
    auto* globalObject = JSC::JSGlobalObject::create(vm, structure);
    JSC::gcProtect(globalObject);

    // ============ SAME SCRIPT (1000x) ============
    {
        auto timer = Stopwatch::create();
        timer->start();

        const char* sameScript = "function compute(n) { var sum = 0; for (var j = 0; j < n; j++) sum += j; return sum; } compute(100)";

        for (int i = 0; i < NUM_SCRIPTS; i++) {
            char nameBuf[32];
            snprintf(nameBuf, sizeof(nameBuf), "same_%d.js", i);

            auto source = JSC::makeSource(
                WTF::String::fromUTF8(sameScript),
                SourceOrigin(WTF::URL(WTF::String::fromUTF8(nameBuf))),
                JSC::SourceTaintedOrigin::Untainted,
                WTF::String::fromUTF8(nameBuf));

            NakedPtr<Exception> exception;
            JSValue result = JSC::profiledEvaluate(globalObject, ProfilingReason::API, source, globalObject, exception);

            if (exception) {
                fprintf(stderr, "Exception in same script %d: %s\n", i,
                    exception->value().toWTFString(globalObject).utf8().data());
                return 1;
            }
        }

        double totalTime = timer->elapsedTime().milliseconds();
        double rssMB = getRSSMB();

        fprintf(stderr, "same_script:    %8.3f ms  %6.1f MB\n", totalTime, rssMB);
    }

    // ============ DIFFERENT SCRIPTS (1000x) ============
    {
        auto timer = Stopwatch::create();
        timer->start();

        for (int i = 0; i < NUM_SCRIPTS; i++) {
            char scriptBuf[256];
            snprintf(scriptBuf, sizeof(scriptBuf),
                "function compute_%d(n) { var sum = %d; for (var j = 0; j < n; j++) sum += j * %d; return sum; } compute_%d(100)",
                i, i, i + 1, i);

            char nameBuf[32];
            snprintf(nameBuf, sizeof(nameBuf), "diff_%d.js", i);

            auto source = JSC::makeSource(
                WTF::String::fromUTF8(scriptBuf),
                SourceOrigin(WTF::URL(WTF::String::fromUTF8(nameBuf))),
                JSC::SourceTaintedOrigin::Untainted,
                WTF::String::fromUTF8(nameBuf));

            NakedPtr<Exception> exception;
            JSValue result = JSC::profiledEvaluate(globalObject, ProfilingReason::API, source, globalObject, exception);

            if (exception) {
                fprintf(stderr, "Exception in diff script %d: %s\n", i,
                    exception->value().toWTFString(globalObject).utf8().data());
                return 1;
            }
        }

        double totalTime = timer->elapsedTime().milliseconds();
        double rssMB = getRSSMB();

        fprintf(stderr, "diff_script:    %8.3f ms  %6.1f MB\n", totalTime, rssMB);
    }

    return 0;
}
