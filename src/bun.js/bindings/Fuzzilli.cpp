/*
 *  Copyright (C) 2023 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Library General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Library General Public License for more details.
 *
 *  You should have received a copy of the GNU Library General Public License
 *  along with this library; see the file COPYING.LIB.  If not, write to
 *  the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 *  Boston, MA 02110-1301, USA.
 *
 */
#ifdef BUN_FUZZILLI_ENABLED

#include "config.h"
#include "Fuzzilli.h"

#include <fcntl.h>
#include <mutex>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <wtf/Assertions.h>
#include <wtf/Compiler.h>
#include <wtf/DataLog.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/ASCIILiteral.h>
#include <JavaScriptCore/Completion.h>

static constexpr auto REPRL_CRFD = 100;
static constexpr auto REPRL_CWFD = 101;
static constexpr auto REPRL_DRFD = 102;
static constexpr auto REPRL_DWFD = 103;

static constexpr auto REPRL_MAX_DATA_SIZE = 16 * 1024 * 1024;

#define SHM_SIZE 0x100000
#define MAX_EDGES ((SHM_SIZE - 4) * 8)

#define WRITE_TO_FUZZILLI(data_, size_) RELEASE_ASSERT(write(REPRL_CWFD, data_, size_) == static_cast<ssize_t>(size_))
#define READ_FROM_FUZZILLI(data_, size_) RELEASE_ASSERT(read(REPRL_CRFD, data_, size_) == static_cast<ssize_t>(size_))

struct Fuzzilli::SharedData* Fuzzilli::sharedData { nullptr };

uint32_t* Fuzzilli::edgesStart { nullptr };
uint32_t* Fuzzilli::edgesStop { nullptr };

char* Fuzzilli::reprlInputData { nullptr };
size_t Fuzzilli::numPendingRejectedPromises { 0 };

void Fuzzilli::resetCoverageEdges()
{
    uint64_t n = 0;
WTF_ALLOW_UNSAFE_BUFFER_USAGE_BEGIN
    for (uint32_t* edge = edgesStart; edge < edgesStop && n < MAX_EDGES; edge++)
        *edge = ++n;
WTF_ALLOW_UNSAFE_BUFFER_USAGE_END
}

FilePrintStream& Fuzzilli::logFile()
{
    static LazyNeverDestroyed<FilePrintStream> result;
    static std::once_flag flag;
    std::call_once(flag, []() {
        if (FILE* file = fdopen(REPRL_DWFD, "w"))
            result.construct(file, FilePrintStream::AdoptionMode::Adopt);
        else {
            result.construct(stdout, FilePrintStream::AdoptionMode::Borrow);
            dataLogLn("Fuzzer output channel not available, printing to stdout instead.");
        }
    });
    return result.get();
}

void Fuzzilli::waitForCommand()
{
    unsigned action;
    READ_FROM_FUZZILLI(&action, sizeof(action));
    RELEASE_ASSERT_WITH_MESSAGE(action == 'cexe', "[REPRL] Unknown action: %u", action);
}

SUPPRESS_COVERAGE
void Fuzzilli::initializeCoverage(uint32_t* start, uint32_t* stop)
{
    fprintf(stderr, "[FUZZILLI] initializeCoverage() called: start=%p, stop=%p\n", start, stop);
    fflush(stderr);

    RELEASE_ASSERT_WITH_MESSAGE(!edgesStart && !edgesStop, "Coverage instrumentation is only supported for a single module");

    edgesStart = start;
    edgesStop = stop;

    fprintf(stderr, "[FUZZILLI] Checking for SHM_ID environment variable\n");
    fflush(stderr);

    if (const char* shmKey = getenv("SHM_ID")) {
        fprintf(stderr, "[FUZZILLI] SHM_ID found: %s\n", shmKey);
        fflush(stderr);

        int32_t fd = shm_open(shmKey, O_RDWR, S_IREAD | S_IWRITE);
        RELEASE_ASSERT_WITH_MESSAGE(fd >= 0, "Failed to open shared memory region: %s", strerror(errno));

        fprintf(stderr, "[FUZZILLI] Shared memory opened, fd=%d\n", fd);
        fflush(stderr);

        sharedData = static_cast<SharedData*>(mmap(0, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0));
        RELEASE_ASSERT_WITH_MESSAGE(sharedData != MAP_FAILED, "Failed to mmap shared memory region");

        fprintf(stderr, "[FUZZILLI] Shared memory mapped at %p\n", sharedData);
        fflush(stderr);

        dataLogLn("[COV] edge counters initialized. Shared memory: %s with %zu edges.", shmKey, edgesStop - edgesStart);
    } else {
        fprintf(stderr, "[FUZZILLI] SHM_ID not found, using malloc\n");
        fflush(stderr);
        sharedData = static_cast<SharedData*>(malloc(SHM_SIZE));
        fprintf(stderr, "[FUZZILLI] Allocated sharedData at %p\n", sharedData);
        fflush(stderr);
    }

    fprintf(stderr, "[FUZZILLI] Resetting coverage edges\n");
    fflush(stderr);
    resetCoverageEdges();

    sharedData->numEdges = static_cast<uint32_t>(edgesStop - edgesStart);
    fprintf(stderr, "[FUZZILLI] initializeCoverage() completed, numEdges=%u\n", sharedData->numEdges);
    fflush(stderr);
}

void Fuzzilli::readInput(Vector<char>* buffer)
{
    size_t inputSize;
    READ_FROM_FUZZILLI(&inputSize, sizeof(inputSize));
    RELEASE_ASSERT(inputSize < REPRL_MAX_DATA_SIZE);

    buffer->resize(inputSize);
    memcpySpan(buffer->mutableSpan(), unsafeMakeSpan(reprlInputData, inputSize));
}

void Fuzzilli::flushReprl(int32_t result)
{
    // In REPRL mode, stdout and stderr may be regular files, so we need to fflush them here.
    fflush(stdout);
    fflush(stderr);

    // Check if any rejected promises weren't handled.
    if (numPendingRejectedPromises > 0) {
        numPendingRejectedPromises = 0;

        result = 1;
    }

    int32_t status = (result & 0xff) << 8;
    WRITE_TO_FUZZILLI(&status, sizeof(status));

    resetCoverageEdges();
}

void Fuzzilli::initializeReprl()
{
    fprintf(stderr, "[FUZZILLI] initializeReprl() starting\n");
    fflush(stderr);

    std::array<char, 4> helo { 'H', 'E', 'L', 'O' };

    fprintf(stderr, "[FUZZILLI] Sending HELO handshake\n");
    fflush(stderr);
    WRITE_TO_FUZZILLI(helo.data(), helo.size());

    fprintf(stderr, "[FUZZILLI] Reading HELO response\n");
    fflush(stderr);
    READ_FROM_FUZZILLI(helo.data(), helo.size());

    fprintf(stderr, "[FUZZILLI] Verifying HELO response\n");
    fflush(stderr);
    RELEASE_ASSERT_WITH_MESSAGE(equalSpans(std::span { helo } , "HELO"_span), "[REPRL] Invalid response from parent");

    fprintf(stderr, "[FUZZILLI] Mapping input buffer\n");
    fflush(stderr);
    // Mmap the data input buffer.
    reprlInputData = static_cast<char*>(mmap(0, REPRL_MAX_DATA_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, REPRL_DRFD, 0));
    RELEASE_ASSERT(reprlInputData != MAP_FAILED);

    fprintf(stderr, "[FUZZILLI] initializeReprl() completed successfully\n");
    fflush(stderr);
}


extern "C" void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop);
extern "C" void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop)
{
    // Avoid duplicate initialization.
    if (start == stop || *start)
        return;

    Fuzzilli::initializeCoverage(start, stop);
}

extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard);
extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard)
{
    // This function can be called during early program initialization (e.g., ASAN init)
    // before Fuzzilli::sharedData is set up. We need to check for null.
    if (!Fuzzilli::sharedData)
        return;

    // There's a small race condition here: if this function executes in two threads for the same
    // edge at the same time, the first thread might disable the edge (by setting the guard to zero)
    // before the second thread fetches the guard value (and thus the index). However, our
    // instrumentation ignores the first edge (see libcoverage.c) and so the race is unproblematic.

    uint32_t index = *guard;
WTF_ALLOW_UNSAFE_BUFFER_USAGE_BEGIN
    Fuzzilli::sharedData->edges[index / 8] |= 1 << (index % 8);
WTF_ALLOW_UNSAFE_BUFFER_USAGE_END

    *guard = 0;
}

void Fuzzilli::runReprl(JSC::JSGlobalObject* globalObject)
{
    fprintf(stderr, "[FUZZILLI] runReprl() starting\n");
    fflush(stderr);

    fprintf(stderr, "[FUZZILLI] Getting VM from globalObject\n");
    fflush(stderr);
    JSC::VM& vm = JSC::getVM(globalObject);

    fprintf(stderr, "[FUZZILLI] Creating input buffer\n");
    fflush(stderr);
    Vector<char> inputBuffer;

    fprintf(stderr, "[FUZZILLI] Entering main REPRL loop\n");
    fflush(stderr);

    // Main REPRL loop - mimics WebKit's jsc shell
    int iteration = 0;
    while (true) {
        fprintf(stderr, "[FUZZILLI] Loop iteration %d: waiting for command\n", iteration);
        fflush(stderr);

        // Wait for 'cexe' command from fuzzer
        waitForCommand();

        fprintf(stderr, "[FUZZILLI] Loop iteration %d: reading input\n", iteration);
        fflush(stderr);

        // Read the JavaScript code to execute
        readInput(&inputBuffer);

        fprintf(stderr, "[FUZZILLI] Loop iteration %d: null-terminating input\n", iteration);
        fflush(stderr);

        // Null-terminate the input
        inputBuffer.append('\0');

        int32_t result = 0;

        {
            fprintf(stderr, "[FUZZILLI] Loop iteration %d: creating catch scope\n", iteration);
            fflush(stderr);

            // Create a new scope for each evaluation
            auto scope = DECLARE_CATCH_SCOPE(vm);

            fprintf(stderr, "[FUZZILLI] Loop iteration %d: creating source code\n", iteration);
            fflush(stderr);

            // Create the source code
            WTF::String sourceString = WTF::String::fromUTF8(inputBuffer.span());
            JSC::SourceCode sourceCode = JSC::makeSource(
                sourceString,
                JSC::SourceOrigin { WTF::URL() },
                JSC::SourceTaintedOrigin::Untainted
            );

            NakedPtr<JSC::Exception> exception;

            fprintf(stderr, "[FUZZILLI] Loop iteration %d: evaluating code\n", iteration);
            fflush(stderr);

            // Evaluate the code
            JSC::JSValue evalResult = JSC::evaluate(globalObject, sourceCode,
                                                    globalObject->globalThis(), exception);

            fprintf(stderr, "[FUZZILLI] Loop iteration %d: handling result\n", iteration);
            fflush(stderr);

            // Handle exceptions
            if (exception) {
                result = 1; // Non-zero indicates error
                scope.clearException();
                fprintf(stderr, "[FUZZILLI] Loop iteration %d: exception occurred\n", iteration);
                fflush(stderr);
            } else if (evalResult) {
                // Optionally print the result (like a REPL would)
                // Convert result to string and print
                WTF::String resultString = evalResult.toWTFString(globalObject);
                fprintf(stdout, "%s\n", resultString.utf8().data());
            }
        }

        fprintf(stderr, "[FUZZILLI] Loop iteration %d: flushing REPRL\n", iteration);
        fflush(stderr);

        // Flush results and send status back
        flushReprl(result);

        fprintf(stderr, "[FUZZILLI] Loop iteration %d: clearing buffer\n", iteration);
        fflush(stderr);

        // Clear for next iteration
        inputBuffer.clear();

        iteration++;
    }
}

extern "C" void Fuzzilli__runReprl(JSC::JSGlobalObject* globalObject)
{
    fprintf(stderr, "[FUZZILLI] Fuzzilli__runReprl() called from Zig\n");
    fprintf(stderr, "[FUZZILLI] globalObject = %p\n", globalObject);
    fflush(stderr);

    // Initialize REPRL protocol (handshake, mmap input buffer)
    fprintf(stderr, "[FUZZILLI] Calling initializeReprl()\n");
    fflush(stderr);
    Fuzzilli::initializeReprl();

    fprintf(stderr, "[FUZZILLI] initializeReprl() returned, calling runReprl()\n");
    fflush(stderr);

    // Run the main REPRL loop (never returns)
    Fuzzilli::runReprl(globalObject);

    fprintf(stderr, "[FUZZILLI] ERROR: runReprl() returned (should never happen)\n");
    fflush(stderr);
}

#endif // BUN_FUZZILLI_ENABLED
