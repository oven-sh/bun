#ifdef FUZZILLI_ENABLED
#include "JavaScriptCore/CallFrame.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "root.h"
#include "wtf/text/WTFString.h"
#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <sanitizer/asan_interface.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define REPRL_DWFD 103

extern "C" {

// Signal handler to ensure output is flushed before crash
static void fuzzilliSignalHandler(int sig)
{
    // Flush all output
    fflush(stdout);
    fflush(stderr);
    fsync(STDOUT_FILENO);
    fsync(STDERR_FILENO);

    // Re-raise the signal with default handler
    signal(sig, SIG_DFL);
    raise(sig);
}

// Implementation of the global fuzzilli() function for Bun
// This function is used by Fuzzilli to:
// 1. Test crash detection with fuzzilli('FUZZILLI_CRASH', type)
// 2. Print output with fuzzilli('FUZZILLI_PRINT', value)
static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES functionFuzzilli(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue arg0 = callFrame->argument(0);
    WTF::String command = arg0.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));

    if (command == "FUZZILLI_CRASH"_s) {
        // Fuzzilli uses this to test crash detection
        // The second argument is an integer specifying the crash type
        int crashType = 0;
        if (callFrame->argumentCount() >= 2) {
            JSC::JSValue arg1 = callFrame->argument(1);
            crashType = arg1.toInt32(globalObject);
        }

        // Print the crash type for debugging
        fprintf(stdout, "FUZZILLI_CRASH: %d\n", crashType);
        fflush(stdout);

        // Trigger different types of crashes for testing (similar to V8 implementation)
        switch (crashType) {
        case 0:
            // IMMEDIATE_CRASH - Simple abort
            std::abort();
            break;

        case 1:
            // CHECK failure - assertion in release builds
            // Use __builtin_trap() for a direct crash
            __builtin_trap();
            break;

        case 2:
            // DCHECK failure - always crash (use trap instead of assert which is disabled in release)
            __builtin_trap();
            break;

        case 3:
            // Wild write - heap buffer overflow (will be caught by ASAN)
            {
                volatile char* buffer = new char[10];
                buffer[20] = 'x'; // Write past the end - ASAN should catch this
                // Don't delete to make it more obvious
            }
            break;

        case 4:
            // Use-after-free (will be caught by ASAN)
            {
                volatile char* buffer = new char[10];
                delete[] buffer;
                buffer[0] = 'x'; // Use after free - ASAN should catch this
            }
            break;

        case 5:
            // Null pointer dereference
            {
                volatile int* ptr = nullptr;
                *ptr = 42;
            }
            break;

        case 6:
            // Stack buffer overflow (will be caught by ASAN)
            {
                volatile char buffer[10];
                volatile char* p = const_cast<char*>(buffer);
                p[20] = 'x'; // Write past stack buffer
            }
            break;

        case 7:
            // Double free (will be caught by ASAN)
            {
                char* buffer = new char[10];
                delete[] buffer;
                delete[] buffer; // Double free - ASAN should catch this
            }
            break;

        case 8:
            // Verify DEBUG or ASAN is enabled
            // Expected to be compiled with debug or ASAN, don't crash
            fprintf(stdout, "DEBUG or ASAN is enabled\n");
            fflush(stdout);
            break;

        default:
            // Unknown crash type, just abort
            std::abort();
            break;
        }
    } else if (command == "FUZZILLI_PRINT"_s) {
        // Optional: Print the second argument
        if (callFrame->argumentCount() >= 2) {
            JSC::JSValue arg1 = callFrame->argument(1);
            WTF::String output = arg1.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));

            FILE* f = fdopen(REPRL_DWFD, "w");
            fprintf(f, "%s\n", output.utf8().data());
            fflush(f);
        }
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

// ============================================================================
// Coverage instrumentation for Fuzzilli
// Based on workerd implementation
// Only enabled when ASAN is active
// ============================================================================

#define SHM_SIZE 0x200000
#define MAX_EDGES ((SHM_SIZE - 4) * 8)

struct shmem_data {
    uint32_t num_edges;
    unsigned char edges[];
};

// Global coverage data
static struct shmem_data* __shmem = nullptr;
static uint32_t* __edges_start = nullptr;
static uint32_t* __edges_stop = nullptr;

// Reset edge guards for next iteration
static void __sanitizer_cov_reset_edgeguards()
{
    if (!__edges_start || !__edges_stop) return;
    uint64_t N = 0;
    for (uint32_t* x = __edges_start; x < __edges_stop && N < MAX_EDGES; x++) {
        *x = ++N;
    }
}

// Called by the compiler to initialize coverage instrumentation
extern "C" void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop)
{
    // Avoid duplicate initialization
    if (start == stop || *start) return;

    if (__edges_start != nullptr || __edges_stop != nullptr) {
        fprintf(stderr, "[COV] Coverage instrumentation is only supported for a single module\n");
        _exit(-1);
    }

    __edges_start = start;
    __edges_stop = stop;

    // Map the shared memory region
    const char* shm_key = getenv("SHM_ID");
    if (!shm_key) {
        fprintf(stderr, "[COV] no shared memory bitmap available, using malloc\n");
        __shmem = (struct shmem_data*)malloc(SHM_SIZE);
        if (!__shmem) {
            fprintf(stderr, "[COV] Failed to allocate coverage bitmap\n");
            _exit(-1);
        }
        memset(__shmem, 0, SHM_SIZE);
    } else {
        int fd = shm_open(shm_key, O_RDWR, S_IREAD | S_IWRITE);
        if (fd <= -1) {
            fprintf(stderr, "[COV] Failed to open shared memory region: %s\n", strerror(errno));
            _exit(-1);
        }

        __shmem = (struct shmem_data*)mmap(0, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (__shmem == MAP_FAILED) {
            fprintf(stderr, "[COV] Failed to mmap shared memory region\n");
            _exit(-1);
        }
    }

    __sanitizer_cov_reset_edgeguards();
    __shmem->num_edges = stop - start;
    fprintf(stderr, "[COV] Coverage instrumentation initialized with %u edges\n", __shmem->num_edges);
}

// Called by the compiler for each edge
extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard)
{
    // There's a small race condition here: if this function executes in two threads for the same
    // edge at the same time, the first thread might disable the edge (by setting the guard to zero)
    // before the second thread fetches the guard value (and thus the index). However, our
    // instrumentation ignores the first edge (see libcoverage.c) and so the race is unproblematic.
    if (!__shmem) return;
    uint32_t index = *guard;
    // If this function is called before coverage instrumentation is properly initialized we want to return early.
    if (!index) return;
    __shmem->edges[index / 8] |= 1 << (index % 8);
    *guard = 0;
}

// Function to reset coverage for next REPRL iteration
// This should be called after each script execution
JSC_DEFINE_HOST_FUNCTION(jsResetCoverage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    __sanitizer_cov_reset_edgeguards();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Register the fuzzilli() function on a Bun global object
void Bun__REPRL__registerFuzzilliFunctions(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();

    // Install signal handlers to ensure output is flushed before crashes
    // This is important for ASAN output to be captured
    signal(SIGABRT, fuzzilliSignalHandler);
    signal(SIGSEGV, fuzzilliSignalHandler);
    signal(SIGILL, fuzzilliSignalHandler);
    signal(SIGFPE, fuzzilliSignalHandler);

    globalObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "fuzzilli"_s),
        2, // max 2 arguments
        functionFuzzilli,
        JSC::ImplementationVisibility::Public,
        JSC::NoIntrinsic,
        JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);

    globalObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "resetCoverage"_s),
        0,
        jsResetCoverage,
        JSC::ImplementationVisibility::Public,
        JSC::NoIntrinsic,
        JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

} // extern "C"

#endif // FUZZILLI_ENABLED
