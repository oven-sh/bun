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

#define REPRL_CRFD 100
#define REPRL_CWFD 101
#define REPRL_DRFD 102
#define REPRL_DWFD 103
#define REPRL_MAX_DATA_SIZE (16 * 1024 * 1024)

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
    RELEASE_ASSERT_WITH_MESSAGE(!edgesStart && !edgesStop, "Coverage instrumentation is only supported for a single module");

    edgesStart = start;
    edgesStop = stop;

    if (const char* shmKey = getenv("SHM_ID")) {
        int32_t fd = shm_open(shmKey, O_RDWR, S_IREAD | S_IWRITE);
        RELEASE_ASSERT_WITH_MESSAGE(fd >= 0, "Failed to open shared memory region: %s", strerror(errno));

        sharedData = static_cast<SharedData*>(mmap(0, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0));
        RELEASE_ASSERT_WITH_MESSAGE(sharedData != MAP_FAILED, "Failed to mmap shared memory region");

        dataLogLn("[COV] edge counters initialized. Shared memory: %s with %zu edges.", shmKey, edgesStop - edgesStart);
    } else
        sharedData = static_cast<SharedData*>(malloc(SHM_SIZE));

    resetCoverageEdges();

    sharedData->numEdges = static_cast<uint32_t>(edgesStop - edgesStart);
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
    std::array<char, 4> helo { 'H', 'E', 'L', 'O' };

    WRITE_TO_FUZZILLI(helo.data(), helo.size());
    READ_FROM_FUZZILLI(helo.data(), helo.size());

    RELEASE_ASSERT_WITH_MESSAGE(equalSpans(std::span { helo } , "HELO"_span), "[REPRL] Invalid response from parent");

    // Mmap the data input buffer.
    reprlInputData = static_cast<char*>(mmap(0, REPRL_MAX_DATA_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, REPRL_DRFD, 0));
    RELEASE_ASSERT(reprlInputData != MAP_FAILED);
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

#endif // BUN_FUZZILLI_ENABLED
