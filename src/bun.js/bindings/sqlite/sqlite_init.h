#pragma once

#include <atomic>
#include <mutex>

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
#include "sqlite3_local.h"
#endif

#if !USE(SYSTEM_MALLOC)
#include <bmalloc/BPlatform.h>
#define ENABLE_SQLITE_FAST_MALLOC (BENABLE(MALLOC_SIZE) && BENABLE(MALLOC_GOOD_SIZE))
#endif

#if ENABLE(SQLITE_FAST_MALLOC)
#include <bmalloc/bmalloc.h>
#endif

namespace Bun {

// Global sqlite malloc tracking - shared between bun:sqlite and node:sqlite
extern std::atomic<int64_t> sqlite_malloc_amount;

// Shared SQLite initialization function
// This function can be called multiple times safely from both bun:sqlite and node:sqlite
// It uses std::once_flag internally to ensure initialization happens only once
void initializeSQLite();

// Check if SQLite has been initialized (for debugging purposes)
bool isSQLiteInitialized();

} // namespace Bun