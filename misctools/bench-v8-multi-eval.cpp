// V8 multi-eval benchmark - 1000 scripts in same Isolate
//
// Tests compile + eval performance for same vs varied scripts
//
// Build: cmake --build build/release --target bench-v8-multi-eval
// Usage: ./bench-v8-multi-eval

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
    void reset() { start(); }
    double elapsedMs() const {
        auto now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
private:
    std::chrono::high_resolution_clock::time_point start_;
};

static double getRSSMB() {
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
#ifdef __APPLE__
    return usage.ru_maxrss / (1024.0 * 1024.0);
#else
    return usage.ru_maxrss / 1024.0;
#endif
}

int main(int argc, char* argv[]) {
    constexpr int NUM_SCRIPTS = 1000;

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

        // ============ SAME SCRIPT (1000x) ============
        {
            Timer timer;

            const char* sameScript = "function compute(n) { var sum = 0; for (var j = 0; j < n; j++) sum += j; return sum; } compute(100)";

            for (int i = 0; i < NUM_SCRIPTS; i++) {
                char nameBuf[32];
                snprintf(nameBuf, sizeof(nameBuf), "same_%d.js", i);

                Local<String> source = String::NewFromUtf8(isolate, sameScript).ToLocalChecked();
                ScriptOrigin origin(String::NewFromUtf8(isolate, nameBuf).ToLocalChecked());

                TryCatch try_catch(isolate);
                Local<Script> script;
                if (!Script::Compile(context, source, &origin).ToLocal(&script)) {
                    String::Utf8Value error(isolate, try_catch.Exception());
                    fprintf(stderr, "Compile error in same script %d: %s\n", i, *error);
                    return 1;
                }

                Local<Value> result;
                if (!script->Run(context).ToLocal(&result)) {
                    String::Utf8Value error(isolate, try_catch.Exception());
                    fprintf(stderr, "Exception in same script %d: %s\n", i, *error);
                    return 1;
                }
            }

            double totalTime = timer.elapsedMs();
            double rssMB = getRSSMB();

            fprintf(stderr, "same_script:    %8.3f ms  %6.1f MB\n", totalTime, rssMB);
        }

        // ============ DIFFERENT SCRIPTS (1000x) ============
        {
            Timer timer;

            for (int i = 0; i < NUM_SCRIPTS; i++) {
                char scriptBuf[256];
                snprintf(scriptBuf, sizeof(scriptBuf),
                    "function compute_%d(n) { var sum = %d; for (var j = 0; j < n; j++) sum += j * %d; return sum; } compute_%d(100)",
                    i, i, i + 1, i);

                char nameBuf[32];
                snprintf(nameBuf, sizeof(nameBuf), "diff_%d.js", i);

                Local<String> source = String::NewFromUtf8(isolate, scriptBuf).ToLocalChecked();
                ScriptOrigin origin(String::NewFromUtf8(isolate, nameBuf).ToLocalChecked());

                TryCatch try_catch(isolate);
                Local<Script> script;
                if (!Script::Compile(context, source, &origin).ToLocal(&script)) {
                    String::Utf8Value error(isolate, try_catch.Exception());
                    fprintf(stderr, "Compile error in diff script %d: %s\n", i, *error);
                    return 1;
                }

                Local<Value> result;
                if (!script->Run(context).ToLocal(&result)) {
                    String::Utf8Value error(isolate, try_catch.Exception());
                    fprintf(stderr, "Exception in diff script %d: %s\n", i, *error);
                    return 1;
                }
            }

            double totalTime = timer.elapsedMs();
            double rssMB = getRSSMB();

            fprintf(stderr, "diff_script:    %8.3f ms  %6.1f MB\n", totalTime, rssMB);
        }
    }

    // Skip cleanup - just exit like JSC benchmarks do
    return 0;
}
