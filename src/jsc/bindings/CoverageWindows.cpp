// Edge-coverage collector for coverage-guided fuzzing on Windows.
//
// The same SanitizerCoverage callbacks and bitmap layout as the Fuzzilli
// collector in FuzzilliREPRL.cpp (which is POSIX-only), backed by a Windows
// named file mapping so a fuzzing driver in another process can read the
// bitmap after each run. The driver creates the mapping and passes its name
// in BUN_COVERAGE_SHM; without it, coverage collects into a private buffer.
#if defined(_WIN32) && defined(FUZZILLI_ENABLED)

#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#define SHM_SIZE 0x200000
#define MAX_EDGES ((SHM_SIZE - 4) * 8)

struct shmem_data {
    uint32_t num_edges;
    unsigned char edges[];
};

static struct shmem_data* __shmem = nullptr;
static uint32_t* __edges_start = nullptr;
static uint32_t* __edges_stop = nullptr;

static void __sanitizer_cov_reset_edgeguards()
{
    if (!__edges_start || !__edges_stop) return;
    uint32_t N = 0;
    for (uint32_t* x = __edges_start; x < __edges_stop && N < MAX_EDGES; x++) {
        *x = ++N;
    }
}

extern "C" void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop)
{
    if (start == stop || *start) return;

    if (__edges_start != nullptr || __edges_stop != nullptr) {
        fprintf(stderr, "[COV] Coverage instrumentation is only supported for a single module\n");
        _exit(-1);
    }

    __edges_start = start;
    __edges_stop = stop;

    const char* shm_key = getenv("BUN_COVERAGE_SHM");
    if (!shm_key) {
        __shmem = (struct shmem_data*)malloc(SHM_SIZE);
        if (!__shmem) {
            fprintf(stderr, "[COV] Failed to allocate coverage bitmap\n");
            _exit(-1);
        }
        memset(__shmem, 0, SHM_SIZE);
    } else {
        HANDLE mapping = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, shm_key);
        if (!mapping) {
            fprintf(stderr, "[COV] Failed to open coverage mapping %s: %lu\n", shm_key, GetLastError());
            _exit(-1);
        }
        __shmem = (struct shmem_data*)MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, SHM_SIZE);
        if (!__shmem) {
            fprintf(stderr, "[COV] Failed to map coverage mapping: %lu\n", GetLastError());
            _exit(-1);
        }
    }

    __sanitizer_cov_reset_edgeguards();
    __shmem->num_edges = static_cast<uint32_t>(stop - start);
}

extern "C" void __sanitizer_cov_trace_pc_guard(uint32_t* guard)
{
    if (!__shmem) return;
    uint32_t index = *guard;
    if (!index) return;
    __shmem->edges[index / 8] |= 1 << (index % 8);
    *guard = 0;
}

#endif
