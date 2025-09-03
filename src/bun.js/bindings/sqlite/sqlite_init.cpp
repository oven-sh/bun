#include "root.h"
#include "sqlite_init.h"

#include <mutex>

#if ENABLE(SQLITE_FAST_MALLOC)
#include <bmalloc/bmalloc.h>
#endif

namespace Bun {

// Global sqlite malloc tracking - shared between bun:sqlite and node:sqlite
std::atomic<int64_t> sqlite_malloc_amount = 0;

// Static flag to track initialization state
static std::once_flag s_sqliteInitOnceFlag;
static bool s_sqliteInitialized = false;

static void enableFastMallocForSQLite()
{
    // Temporarily disable fast malloc for SQLite to avoid crashes
    // TODO: Fix bmalloc integration issues
    // For now, SQLite will use its default malloc implementation
    return;
    
#if 0 // ENABLE(SQLITE_FAST_MALLOC)
    // Check if SQLite has already been initialized by checking if we can still configure it
    int returnCode = sqlite3_config(SQLITE_CONFIG_LOOKASIDE, 0, 0);
    
    // If SQLite is already initialized, this will return SQLITE_MISUSE
    // In that case, we simply skip the configuration since it's already been done
    // or SQLite is using default settings
    if (returnCode == SQLITE_MISUSE) {
        // SQLite is already initialized - this is okay, just skip configuration
        return;
    }
    
    // If we get here, SQLite wasn't initialized yet, so we can configure it
    if (returnCode != SQLITE_OK) {
        // Some other error occurred - this shouldn't happen normally
        return;
    }
    
    // Verify fastMalloc functions are available before using them
    void* testPtr = fastMalloc(16);
    if (testPtr == nullptr) {
        // fastMalloc returned null, fallback to default SQLite malloc
        return;
    }
    fastFree(testPtr);
    
    static sqlite3_mem_methods fastMallocMethods = {
        [](int n) {
            auto* ret = fastMalloc(n);
            if (ret) {
                sqlite_malloc_amount += fastMallocSize(ret);
            }
            return ret;
        },
        [](void* p) {
            if (p) {
                sqlite_malloc_amount -= fastMallocSize(p);
                fastFree(p);
            }
        },
        [](void* p, int n) {
            if (p) {
                sqlite_malloc_amount -= fastMallocSize(p);
            }
            auto* out = fastRealloc(p, n);
            if (out) {
                sqlite_malloc_amount += fastMallocSize(out);
            }
            return out;
        },
        [](void* p) { return p ? static_cast<int>(fastMallocSize(p)) : 0; },
        [](int n) { return static_cast<int>(fastMallocGoodSize(n)); },
        [](void*) { return SQLITE_OK; },
        [](void*) {},
        nullptr
    };
    
    returnCode = sqlite3_config(SQLITE_CONFIG_MALLOC, &fastMallocMethods);
    // If this fails due to SQLITE_MISUSE, that's also okay - SQLite is already initialized
    // We don't assert here because the important thing is that SQLite works
#endif
}

void initializeSQLite()
{
    std::call_once(s_sqliteInitOnceFlag, [] {
        enableFastMallocForSQLite();
        s_sqliteInitialized = true;
    });
}

bool isSQLiteInitialized()
{
    return s_sqliteInitialized;
}

} // namespace Bun