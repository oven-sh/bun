#pragma once
// Heap images: HeapImage.cpp builds and restores them; HeapImageTooling.cpp holds the attribution commands used while
// putting an application on a diet (dirty-page maps, censuses, write traps), compiled only with -DBUN_HEAPIMAGE_TOOLING=1.
#include "root.h"

#ifndef BUN_HEAPIMAGE_TOOLING
#define BUN_HEAPIMAGE_TOOLING 0
#endif

#if OS(DARWIN) || (OS(LINUX) && !defined(__ANDROID__))
#define BUN_HEAP_IMAGE_SUPPORTED 1
#else
#define BUN_HEAP_IMAGE_SUPPORTED 0
#endif

namespace JSC {
class VM;
}

#if BUN_HEAP_IMAGE_SUPPORTED
#include <sys/types.h>
#include <utility>
#include <vector>
struct mi_heap_s;

namespace Bun::HeapImage {
struct FrozenRun {
    uintptr_t start;
    size_t len;
    size_t fileOff;
};
// State of the restored image (empty in a process that did not restore one).
extern std::vector<std::pair<uintptr_t, uintptr_t>> frozenRanges; // sorted [start, end)
extern std::vector<FrozenRun> imageRuns; // the same ranges with their file offsets, sorted by address
extern int imageFd; // the image file, kept open so pages can be compared with / remapped from it
extern ::mi_heap_s* freshHeap; // where this process allocates after a restore (null before one, or if the general path was used)
extern off_t imageBaseOff; // where the image starts inside imageFd (non-zero when it is embedded in the executable)
ssize_t ipread(int fd, void* buf, size_t n, off_t off);
void recleanFrozenPages(JSC::VM&);
}
#endif

#if BUN_HEAPIMAGE_TOOLING
void heapImageToolingInstall();
void heapImageToolingIndexAtFreeze(JSC::VM&, size_t pageSize);
void heapImageToolingArmTraps();
void heapImageToolingAfterRestore();
extern "C" void Bun__heapImageToolingTick(JSC::VM*);
#else
inline void heapImageToolingInstall() {}
inline void heapImageToolingIndexAtFreeze(JSC::VM&, size_t) {}
inline void heapImageToolingArmTraps() {}
inline void heapImageToolingAfterRestore() {}
#endif
