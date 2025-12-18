// V8 single end-to-end cold start benchmark
//
// Measures: process start → V8 init → Isolate → Context → eval → exit
//
// Build: cmake --build build/release --target bench-v8-e2e
// Usage: ./bench-v8-e2e

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
    Timer totalTimer;

    // Initialize V8
    V8::InitializeICUDefaultLocation(argv[0]);
    V8::InitializeExternalStartupData(argv[0]);
    std::unique_ptr<Platform> platform = platform::NewDefaultPlatform();
    V8::InitializePlatform(platform.get());
    V8::Initialize();

    double initTime = totalTimer.elapsedMs();

    // Create Isolate
    Isolate::CreateParams create_params;
    create_params.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();
    Isolate* isolate = Isolate::New(create_params);

    double isolateTime = totalTimer.elapsedMs();

    {
        Isolate::Scope isolate_scope(isolate);
        HandleScope handle_scope(isolate);

        // Create Context
        Local<Context> context = Context::New(isolate);

        double contextTime = totalTimer.elapsedMs();

        Context::Scope context_scope(context);

        // Eval simple script
        Local<String> source = String::NewFromUtf8Literal(isolate,
            "var x = 0; for (var i = 0; i < 1000; i++) x += i; x");

        TryCatch try_catch(isolate);
        Local<Script> script;
        if (!Script::Compile(context, source).ToLocal(&script)) {
            String::Utf8Value error(isolate, try_catch.Exception());
            fprintf(stderr, "Compile error: %s\n", *error);
            return 1;
        }

        Local<Value> result;
        if (!script->Run(context).ToLocal(&result)) {
            String::Utf8Value error(isolate, try_catch.Exception());
            fprintf(stderr, "Exception: %s\n", *error);
            return 1;
        }

        double evalTime = totalTimer.elapsedMs();

        // Get memory usage
        struct rusage usage;
        getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
        double rssBytes = usage.ru_maxrss; // bytes on macOS
#else
        double rssBytes = usage.ru_maxrss * 1024; // kilobytes on Linux
#endif
        double rssMB = rssBytes / (1024 * 1024);

        fprintf(stderr, "V8 E2E Cold Start:\n");
        fprintf(stderr, "  Initialize:    %6.3f ms\n", initTime);
        fprintf(stderr, "  Isolate:       %6.3f ms (+%.3f)\n", isolateTime, isolateTime - initTime);
        fprintf(stderr, "  Context:       %6.3f ms (+%.3f)\n", contextTime, contextTime - isolateTime);
        fprintf(stderr, "  Eval:          %6.3f ms (+%.3f)\n", evalTime, evalTime - contextTime);
        fprintf(stderr, "  Total:         %6.3f ms\n", evalTime);
        fprintf(stderr, "  Peak RSS:      %6.1f MB\n", rssMB);
    }

    isolate->Dispose();
    V8::Dispose();
    V8::DisposePlatform();
    delete create_params.array_buffer_allocator;

    return 0;
}
