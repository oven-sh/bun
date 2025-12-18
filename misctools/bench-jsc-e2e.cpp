// JSC single end-to-end cold start benchmark
//
// Measures: process start → JSC init → VM → GlobalObject → eval → exit
//
// Build: cmake --build build/release --target bench-jsc-e2e
// Usage: ./bench-jsc-e2e

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
    auto totalTimer = Stopwatch::create();
    totalTimer->start();

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

    double initTime = totalTimer->elapsedTime().milliseconds();

    // Create VM
    auto vmPtr = JSC::VM::tryCreate(JSC::HeapType::Large);
    vmPtr->refSuppressingSaferCPPChecking();
    auto& vm = *vmPtr;
    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);
    vm.clientData = new MinimalClientData();

    double vmTime = totalTimer->elapsedTime().milliseconds();

    // Create GlobalObject
    auto* structure = JSC::JSGlobalObject::createStructure(vm, JSC::jsNull());
    auto* globalObject = JSC::JSGlobalObject::create(vm, structure);
    JSC::gcProtect(globalObject);

    double globalObjectTime = totalTimer->elapsedTime().milliseconds();

    // Eval simple script
    auto source = JSC::makeSource(
        "var x = 0; for (var i = 0; i < 1000; i++) x += i; x"_s,
        SourceOrigin(WTF::URL("file://bench.js"_s)),
        JSC::SourceTaintedOrigin::Untainted, "bench.js"_s);

    NakedPtr<Exception> exception;
    JSValue result = JSC::profiledEvaluate(globalObject, ProfilingReason::API, source, globalObject, exception);

    double evalTime = totalTimer->elapsedTime().milliseconds();

    // Get memory usage
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
    double rssBytes = usage.ru_maxrss; // bytes on macOS
#else
    double rssBytes = usage.ru_maxrss * 1024; // kilobytes on Linux
#endif
    double rssMB = rssBytes / (1024 * 1024);

    fprintf(stderr, "JSC E2E Cold Start:\n");
    fprintf(stderr, "  Initialize:    %6.3f ms\n", initTime);
    fprintf(stderr, "  VM:            %6.3f ms (+%.3f)\n", vmTime, vmTime - initTime);
    fprintf(stderr, "  GlobalObject:  %6.3f ms (+%.3f)\n", globalObjectTime, globalObjectTime - vmTime);
    fprintf(stderr, "  Eval:          %6.3f ms (+%.3f)\n", evalTime, evalTime - globalObjectTime);
    fprintf(stderr, "  Total:         %6.3f ms\n", evalTime);
    fprintf(stderr, "  Peak RSS:      %6.1f MB\n", rssMB);

    if (exception) {
        fprintf(stderr, "Exception: %s\n", exception->value().toWTFString(globalObject).utf8().data());
        return 1;
    }

    return 0;
}
