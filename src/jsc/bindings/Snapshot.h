#pragma once
// Snapshots: Snapshot.cpp builds and restores them; SnapshotTooling.cpp holds the attribution commands used while
// putting an application on a diet (dirty-page maps, censuses, write traps), compiled only with -DBUN_SNAPSHOT_TOOLING=1.
#include "root.h"

#ifndef BUN_SNAPSHOT_TOOLING
#define BUN_SNAPSHOT_TOOLING 0
#endif

#if defined(__has_feature)
#if __has_feature(address_sanitizer)
#define BUN_SNAPSHOT_ASAN 1
#endif
#endif
#if defined(__SANITIZE_ADDRESS__)
#define BUN_SNAPSHOT_ASAN 1
#endif
// ASAN owns the fixed address ranges the snapshot heap and JIT pool are placed in. Linux support is glibc for now: the
// musl build crashes while writing the snapshot and has not been debugged yet.
#if (OS(DARWIN) || (OS(LINUX) && defined(__GLIBC__))) && !defined(BUN_SNAPSHOT_ASAN)
#define BUN_SNAPSHOT_SUPPORTED 1
#else
#define BUN_SNAPSHOT_SUPPORTED 0
#endif

namespace JSC {
class VM;
}

#if BUN_SNAPSHOT_SUPPORTED
#include <sys/types.h>
#include <utility>
#include <vector>
struct mi_heap_s;

namespace Bun::Snapshot {
struct FrozenRun {
    uintptr_t start;
    size_t len;
    size_t fileOff;
};
// State of the restored snapshot (empty in a process that did not restore one).
extern std::vector<std::pair<uintptr_t, uintptr_t>> frozenRanges; // sorted [start, end)
extern std::vector<FrozenRun> snapshotRuns; // the same ranges with their file offsets, sorted by address
extern int snapshotFd; // the snapshot file, kept open so pages can be compared with / remapped from it
extern ::mi_heap_s* freshHeap; // where this process allocates after a restore (null before one, or if the general path was used)
extern off_t snapshotBaseOff; // where the snapshot starts inside snapshotFd (non-zero when it is embedded in the executable)
ssize_t ipread(int fd, void* buf, size_t n, off_t off);
void recleanFrozenPages(JSC::VM&);
}
#endif

#if BUN_SNAPSHOT_TOOLING
void snapshotToolingInstall();
void snapshotToolingIndexAtFreeze(JSC::VM&, size_t pageSize);
void snapshotToolingArmTraps();
void snapshotToolingAfterRestore();
extern "C" void Bun__snapshotToolingTick(JSC::VM*);
#else
inline void snapshotToolingInstall() {}
inline void snapshotToolingIndexAtFreeze(JSC::VM&, size_t) {}
inline void snapshotToolingArmTraps() {}
inline void snapshotToolingAfterRestore() {}
#endif
