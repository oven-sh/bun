// JSC 100 full E2E benchmark - 100 VMs + GlobalObjects + eval
//
// Build: cmake --build build/release --target bench-jsc-100-e2e
// Usage: ./bench-jsc-100-e2e

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

int main() {
    constexpr int NUM_VMS = 100;

    // Initialize JSC (one-time cost)
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

    fprintf(stderr, "JSC 100 Full E2E Benchmark:\n\n");

    // Keep VMs alive
    JSC::VM* vms[NUM_VMS];
    JSC::JSGlobalObject* globalObjects[NUM_VMS];

    auto timer = Stopwatch::create();
    timer->start();

    for (int i = 0; i < NUM_VMS; i++) {
        // Create VM
        auto vmPtr = JSC::VM::tryCreate(JSC::HeapType::Large);
        if (!vmPtr) {
            fprintf(stderr, "Failed to create VM %d\n", i);
            return 1;
        }
        vmPtr->refSuppressingSaferCPPChecking();
        vms[i] = vmPtr.get();
        vms[i]->heap.acquireAccess();

        JSC::JSLockHolder locker(*vms[i]);
        vms[i]->clientData = new MinimalClientData();

        // Create GlobalObject
        auto* structure = JSC::JSGlobalObject::createStructure(*vms[i], JSC::jsNull());
        globalObjects[i] = JSC::JSGlobalObject::create(*vms[i], structure);
        JSC::gcProtect(globalObjects[i]);

        // Eval script (slightly different each time)
        char scriptBuf[128];
        snprintf(scriptBuf, sizeof(scriptBuf),
            "var x = %d; for (var j = 0; j < 100; j++) x += j; x", i);

        auto source = JSC::makeSource(
            WTF::String::fromUTF8(scriptBuf),
            SourceOrigin(WTF::URL("file://script.js"_s)),
            JSC::SourceTaintedOrigin::Untainted, "script.js"_s);

        NakedPtr<Exception> exception;
        JSValue result = JSC::profiledEvaluate(globalObjects[i], ProfilingReason::API,
                                                source, globalObjects[i], exception);

        if (exception) {
            fprintf(stderr, "Exception in VM %d: %s\n", i,
                exception->value().toWTFString(globalObjects[i]).utf8().data());
            return 1;
        }
    }

    double totalTime = timer->elapsedTime().milliseconds();

    // Get memory usage
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
    double rssBytes = usage.ru_maxrss; // bytes on macOS
#else
    double rssBytes = usage.ru_maxrss * 1024; // kilobytes on Linux
#endif
    double rssMB = rssBytes / (1024 * 1024);

    fprintf(stderr, "  Created %d VMs + GlobalObjects + eval\n", NUM_VMS);
    fprintf(stderr, "  Total time:    %6.3f ms\n", totalTime);
    fprintf(stderr, "  Per instance:  %6.3f ms\n", totalTime / NUM_VMS);
    fprintf(stderr, "  Peak RSS:      %6.1f MB (%.2f MB per instance)\n", rssMB, rssMB / NUM_VMS);

    return 0;
}
