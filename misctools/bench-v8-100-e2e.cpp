// V8 100 full E2E benchmark - 100 Isolates + Contexts + eval
//
// Build: cmake --build build/release --target bench-v8-100-e2e
// Usage: ./bench-v8-100-e2e

#include <sys/resource.h>
#include <v8.h>
#include <libplatform/libplatform.h>
#include <chrono>
#include <cstdio>

using namespace v8;

class Timer {
public:
    Timer() { start(); }
    void start() { start_ = std::chrono::high_resolution_clock::now(); }
    double elapsedMs() const {
        auto now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
private:
    std::chrono::high_resolution_clock::time_point start_;
};

int main(int argc, char* argv[]) {
    constexpr int NUM_ISOLATES = 100;

    // Initialize V8 (one-time cost)
    V8::InitializeICUDefaultLocation(argv[0]);
    V8::InitializeExternalStartupData(argv[0]);
    std::unique_ptr<Platform> platform = platform::NewDefaultPlatform();
    V8::InitializePlatform(platform.get());
    V8::Initialize();

    fprintf(stderr, "V8 100 Full E2E Benchmark:\n\n");

    // Keep isolates alive
    Isolate* isolates[NUM_ISOLATES];
    Global<Context>* contexts[NUM_ISOLATES];

    Isolate::CreateParams create_params;
    create_params.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();

    Timer timer;

    for (int i = 0; i < NUM_ISOLATES; i++) {
        // Create Isolate
        isolates[i] = Isolate::New(create_params);
        if (!isolates[i]) {
            fprintf(stderr, "Failed to create isolate %d\n", i);
            return 1;
        }

        Isolate::Scope isolate_scope(isolates[i]);
        HandleScope handle_scope(isolates[i]);

        // Create Context
        Local<Context> context = Context::New(isolates[i]);
        contexts[i] = new Global<Context>(isolates[i], context);

        Context::Scope context_scope(context);

        // Eval script (slightly different each time)
        char scriptBuf[128];
        snprintf(scriptBuf, sizeof(scriptBuf),
            "var x = %d; for (var j = 0; j < 100; j++) x += j; x", i);

        Local<String> source = String::NewFromUtf8(isolates[i], scriptBuf).ToLocalChecked();

        TryCatch try_catch(isolates[i]);
        Local<Script> script;
        if (!Script::Compile(context, source).ToLocal(&script)) {
            String::Utf8Value error(isolates[i], try_catch.Exception());
            fprintf(stderr, "Compile error in isolate %d: %s\n", i, *error);
            return 1;
        }

        Local<Value> result;
        if (!script->Run(context).ToLocal(&result)) {
            String::Utf8Value error(isolates[i], try_catch.Exception());
            fprintf(stderr, "Exception in isolate %d: %s\n", i, *error);
            return 1;
        }
    }

    double totalTime = timer.elapsedMs();

    // Get memory usage
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
    double rssBytes = usage.ru_maxrss; // bytes on macOS
#else
    double rssBytes = usage.ru_maxrss * 1024; // kilobytes on Linux
#endif
    double rssMB = rssBytes / (1024 * 1024);

    fprintf(stderr, "  Created %d Isolates + Contexts + eval\n", NUM_ISOLATES);
    fprintf(stderr, "  Total time:    %6.3f ms\n", totalTime);
    fprintf(stderr, "  Per instance:  %6.3f ms\n", totalTime / NUM_ISOLATES);
    fprintf(stderr, "  Peak RSS:      %6.1f MB (%.2f MB per instance)\n", rssMB, rssMB / NUM_ISOLATES);

    // Skip cleanup - just exit like JSC benchmarks do
    return 0;
}
