// V8 Isolate cold start benchmark - comparable to cold-jsc-start.cpp
//
// Usage:
//   ./cold-v8-start <file>
//   ./cold-v8-start -e "print('hey')"
//   ./cold-v8-start --benchmark-isolate   # Create 100 isolates
//
// Build with: cmake --build build/release --target cold-v8-start

#include <v8.h>
#include <libplatform/libplatform.h>
#include <cstdio>
#include <cstring>
#include <chrono>
#include <fstream>
#include <sstream>
#include <unistd.h>

using namespace v8;

// Simple high-resolution timer
class Timer {
public:
    void start() { start_ = std::chrono::high_resolution_clock::now(); }
    void reset() { start(); }
    double elapsedMs() const {
        auto now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
private:
    std::chrono::high_resolution_clock::time_point start_;
};

// Print function for JavaScript
static void Print(const FunctionCallbackInfo<Value>& args) {
    bool first = true;
    for (int i = 0; i < args.Length(); i++) {
        HandleScope handle_scope(args.GetIsolate());
        if (first) {
            first = false;
        } else {
            printf(" ");
        }
        String::Utf8Value str(args.GetIsolate(), args[i]);
        printf("%s", *str ? *str : "<string conversion failed>");
    }
    fflush(stdout);
}

// Write function matching JSC version
static void Write(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    if (args.Length() < 1) {
        args.GetReturnValue().Set(Undefined(isolate));
        return;
    }

    int fd = STDOUT_FILENO;
    Local<Value> toWrite;

    if (args.Length() > 1) {
        fd = args[0]->Int32Value(isolate->GetCurrentContext()).FromMaybe(STDOUT_FILENO);
        toWrite = args[1];
    } else {
        toWrite = args[0];
    }

    String::Utf8Value str(isolate, toWrite);
    if (*str) {
        ssize_t written = write(fd, *str, str.length());
        args.GetReturnValue().Set(Number::New(isolate, static_cast<double>(written)));
    } else {
        args.GetReturnValue().Set(Number::New(isolate, 0));
    }
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <file>\n", argv[0]);
        fprintf(stderr, "       %s -e \"code\"\n", argv[0]);
        fprintf(stderr, "       %s --benchmark-isolate\n", argv[0]);
        return 1;
    }

    // Check for --benchmark-isolate flag
    bool benchmarkIsolate = false;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--benchmark-isolate") == 0) {
            benchmarkIsolate = true;
            break;
        }
    }

    Timer timer;
    timer.start();

    // Initialize V8
    V8::InitializeICUDefaultLocation(argv[0]);
    V8::InitializeExternalStartupData(argv[0]);
    std::unique_ptr<Platform> platform = platform::NewDefaultPlatform();
    V8::InitializePlatform(platform.get());
    V8::Initialize();

    fprintf(stderr, "V8::Initialize took %f ms\n", timer.elapsedMs());
    timer.reset();

    // Benchmark mode: create 100 isolates, then 100 contexts
    if (benchmarkIsolate) {
        constexpr int NUM_ISOLATES = 100;
        Isolate* isolates[NUM_ISOLATES];
        Global<Context>* contexts[NUM_ISOLATES];

        Isolate::CreateParams create_params;
        create_params.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();

        // First benchmark: Create 100 Isolates
        Timer benchTimer;
        benchTimer.start();

        for (int i = 0; i < NUM_ISOLATES; i++) {
            isolates[i] = Isolate::New(create_params);
            if (!isolates[i]) {
                fprintf(stderr, "Failed to create isolate %d\n", i);
                return 1;
            }
        }

        double isolateTime = benchTimer.elapsedMs();
        fprintf(stderr, "Created %d Isolates in %f ms (%f ms per Isolate)\n",
                NUM_ISOLATES, isolateTime, isolateTime / NUM_ISOLATES);

        // Second benchmark: Create 100 Contexts on existing Isolates
        benchTimer.reset();

        for (int i = 0; i < NUM_ISOLATES; i++) {
            Isolate::Scope isolate_scope(isolates[i]);
            HandleScope handle_scope(isolates[i]);
            Local<Context> context = Context::New(isolates[i]);
            contexts[i] = new Global<Context>(isolates[i], context);
        }

        double contextTime = benchTimer.elapsedMs();
        fprintf(stderr, "Created %d Contexts in %f ms (%f ms per Context)\n",
                NUM_ISOLATES, contextTime, contextTime / NUM_ISOLATES);

        fprintf(stderr, "Total: %f ms (%f ms per Isolate+Context)\n",
                isolateTime + contextTime, (isolateTime + contextTime) / NUM_ISOLATES);

        // Keep isolates alive - don't dispose
        delete create_params.array_buffer_allocator;
        return 0;
    }

    // Create isolate
    Isolate::CreateParams create_params;
    create_params.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();
    Isolate* isolate = Isolate::New(create_params);

    fprintf(stderr, "Isolate::New took %f ms\n", timer.elapsedMs());
    timer.reset();

    {
        Isolate::Scope isolate_scope(isolate);
        HandleScope handle_scope(isolate);

        // Create global template with write function
        Local<ObjectTemplate> global = ObjectTemplate::New(isolate);
        global->Set(isolate, "write", FunctionTemplate::New(isolate, Write));
        global->Set(isolate, "print", FunctionTemplate::New(isolate, Print));

        // Create context
        Local<Context> context = Context::New(isolate, nullptr, global);

        fprintf(stderr, "Context::New took %f ms\n", timer.elapsedMs());
        timer.reset();

        Context::Scope context_scope(context);

        // Get source code
        std::string source;
        const char* sourceOrigin = "eval.js";

        if (argc > 2 && strcmp(argv[1], "-e") == 0) {
            source = argv[argc - 1];
        } else {
            std::ifstream file(argv[argc - 1]);
            if (!file) {
                fprintf(stderr, "Could not read file %s\n", argv[argc - 1]);
                return 1;
            }
            std::stringstream buffer;
            buffer << file.rdbuf();
            source = buffer.str();
            sourceOrigin = argv[argc - 1];
        }

        // Compile and run
        Local<String> source_str = String::NewFromUtf8(isolate, source.c_str()).ToLocalChecked();
        ScriptOrigin origin(String::NewFromUtf8(isolate, sourceOrigin).ToLocalChecked());

        TryCatch try_catch(isolate);

        Local<Script> script;
        if (!Script::Compile(context, source_str, &origin).ToLocal(&script)) {
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

        fprintf(stderr, "\neval took %f ms\n", timer.elapsedMs());
    }

    // Skip cleanup - just exit like JSC benchmarks do
    return 0;
}
