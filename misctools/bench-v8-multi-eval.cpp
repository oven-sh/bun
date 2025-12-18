// V8 multi-eval benchmark - 100 slightly different scripts in same Isolate
//
// Tests compile + eval performance for varied scripts
//
// Build: cmake --build build/release --target bench-v8-multi-eval
// Usage: ./bench-v8-multi-eval

#include <v8.h>
#include <libplatform/libplatform.h>
#include <chrono>
#include <cstdio>

using namespace v8;

class Timer {
public:
    Timer() { start(); }
    void start() { start_ = std::chrono::high_resolution_clock::now(); }
    void reset() { start(); }
    double elapsedMs() const {
        auto now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
private:
    std::chrono::high_resolution_clock::time_point start_;
};

int main(int argc, char* argv[]) {
    constexpr int NUM_SCRIPTS = 100;

    // Initialize V8
    V8::InitializeICUDefaultLocation(argv[0]);
    V8::InitializeExternalStartupData(argv[0]);
    std::unique_ptr<Platform> platform = platform::NewDefaultPlatform();
    V8::InitializePlatform(platform.get());
    V8::Initialize();

    // Create Isolate + Context
    Isolate::CreateParams create_params;
    create_params.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();
    Isolate* isolate = Isolate::New(create_params);

    {
        Isolate::Scope isolate_scope(isolate);
        HandleScope handle_scope(isolate);
        Local<Context> context = Context::New(isolate);
        Context::Scope context_scope(context);

        fprintf(stderr, "V8 Multi-Eval Benchmark (%d scripts in same Isolate):\n\n", NUM_SCRIPTS);

        Timer timer;

        for (int i = 0; i < NUM_SCRIPTS; i++) {
            // Each script is slightly different
            char scriptBuf[256];
            snprintf(scriptBuf, sizeof(scriptBuf),
                "function compute_%d(n) { var sum = %d; for (var j = 0; j < n; j++) sum += j * %d; return sum; } compute_%d(100)",
                i, i, i + 1, i);

            char nameBuf[32];
            snprintf(nameBuf, sizeof(nameBuf), "script_%d.js", i);

            Local<String> source = String::NewFromUtf8(isolate, scriptBuf).ToLocalChecked();
            ScriptOrigin origin(String::NewFromUtf8(isolate, nameBuf).ToLocalChecked());

            TryCatch try_catch(isolate);
            Local<Script> script;
            if (!Script::Compile(context, source, &origin).ToLocal(&script)) {
                String::Utf8Value error(isolate, try_catch.Exception());
                fprintf(stderr, "Compile error in script %d: %s\n", i, *error);
                return 1;
            }

            Local<Value> result;
            if (!script->Run(context).ToLocal(&result)) {
                String::Utf8Value error(isolate, try_catch.Exception());
                fprintf(stderr, "Exception in script %d: %s\n", i, *error);
                return 1;
            }
        }

        double totalTime = timer.elapsedMs();

        fprintf(stderr, "  Total time:    %6.3f ms\n", totalTime);
        fprintf(stderr, "  Per script:    %6.3f ms\n", totalTime / NUM_SCRIPTS);
        fprintf(stderr, "  Scripts/sec:   %6.0f\n", NUM_SCRIPTS / (totalTime / 1000.0));
    }

    isolate->Dispose();
    V8::Dispose();
    V8::DisposePlatform();
    delete create_params.array_buffer_allocator;

    return 0;
}
