#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <wtf/text/AtomStringTable.h>
#include <JavaScriptCore/VMInlines.h>
#include <JavaScriptCore/StackAlignment.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/UnlinkedCodeBlock.h>
#include <JavaScriptCore/MarkedBlockInlines.h>
#include <JavaScriptCore/BlockDirectoryInlines.h>
#include <JavaScriptCore/Subspace.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/SourceProvider.h>
#include <vector>
#include <span>
#include <algorithm>
#include <string>
#include <chrono>
#include <map>
#include <functional>
#include <set>
#include <JavaScriptCore/UnlinkedMetadataTable.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/InstructionStream.h>
#include <wtf/HashSet.h>
#include <wtf/FastMalloc.h>
#include <wtf/HashMap.h>
#include <wtf/text/CString.h>
#include <atomic>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <sys/mman.h>
#include <fcntl.h>
#if OS(DARWIN)
#include <mach/mach.h>
#include <termios.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <sys/ucontext.h>
#include <signal.h>
#include <libkern/OSCacheControl.h>
#include <pthread.h>
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#include <pthread.h>
#include <wtf/Threading.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/MachineStackMarker.h>
#endif
#include <unistd.h>
#if OS(DARWIN)
extern "C" uint64_t* Bun__getStandaloneModuleGraphMachoLength();
#endif

extern "C" int mi_prof_dump_to_file(const char*) noexcept;
extern "C" void mi_prof_enable(size_t) noexcept;
typedef void(mi_output_fun)(const char* msg, void* arg);
extern "C" void mi_stats_print_out(mi_output_fun* out, void* arg) noexcept;
extern "C" void mi_arenas_print(void) noexcept;
extern "C" void mi_collect(bool force) noexcept;
extern "C" size_t mi_usable_size(const void*) noexcept;
extern "C" int mi_heap_snapshot_to_file(const char* path, unsigned flags) noexcept;
typedef bool(mi_free_filter_fun)(void* p);
extern "C" void mi_free_set_filter(mi_free_filter_fun* filter) noexcept;
extern "C" void mi_prof_visit_live(bool (*cb)(uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg), void* arg) noexcept;
#include <mimalloc.h>
#include "ZigGlobalObject.h"
static std::vector<std::pair<uintptr_t, uintptr_t>> s_frozenRanges; // sorted [start,end)
static std::vector<uintptr_t> s_payloadPages; // sorted OS pages that held live malloc blocks (main heap) at freeze
static std::map<uintptr_t, uint32_t> s_pageSizeClass; // page -> block size of (first) live block seen
struct FrozenRun { uintptr_t start; size_t len; size_t fileOff; };
static std::vector<FrozenRun> s_runs;
static int s_snapFd = -1;
static std::set<uintptr_t> s_profileCells; // cells changed during the "training" interaction
static bool s_recordProfile = false;
static std::vector<std::pair<uintptr_t, uint32_t>> s_liveBlocks; // (start, size) of live malloc blocks at freeze, sorted
static std::vector<uintptr_t> s_cellPages; // sorted OS pages inside MarkedBlocks at freeze
static bool recordUsedBlock(const mi_heap_t*, const mi_heap_area_t*, void* block, size_t block_size, void* arg)
{
    if (!block) return true;
    size_t pg = *static_cast<size_t*>(arg);
    for (uintptr_t a = reinterpret_cast<uintptr_t>(block) & ~(pg - 1); a < reinterpret_cast<uintptr_t>(block) + block_size; a += pg) {
        s_payloadPages.push_back(a);
        s_pageSizeClass.emplace(a, static_cast<uint32_t>(block_size));
    }
    s_liveBlocks.push_back({ reinterpret_cast<uintptr_t>(block), static_cast<uint32_t>(block_size) });
    return true;
}
static bool pageIn(const std::vector<uintptr_t>& v, uintptr_t a) { return std::binary_search(v.begin(), v.end(), a); }
static std::atomic<size_t> s_filteredFrees { 0 };
static bool frozenFreeFilter(void* p)
{
    uintptr_t a = reinterpret_cast<uintptr_t>(p);
    auto it = std::upper_bound(s_frozenRanges.begin(), s_frozenRanges.end(), std::make_pair(a, UINTPTR_MAX));
    if (it == s_frozenRanges.begin()) return false;
    --it;
    if (a >= it->first && a < it->second) { s_filteredFrees.fetch_add(1, std::memory_order_relaxed); return true; }
    return false;
}

static std::atomic<int> s_requested { 0 };
static const char* s_dir = nullptr;
static int s_seq = 0;

static void memdebugSignal(int sig) { s_requested.store(sig == SIGXCPU ? 3 : sig == SIGINFO ? 2 : 1); }

static void imageRestoreAndRun(const char* path);
extern "C" void Bun__imageMaybeRestore()
{
    if (const char* in = getenv("BUN_IMAGE_IN")) {
        char path[1024]; strlcpy(path, in, sizeof path);
        unsetenv("BUN_IMAGE_IN");
        imageRestoreAndRun(path);
    }
}
extern "C" void Bun__imageSetBuilding(bool);
extern "C" void Bun__requestSnapshot(JSC::VM*, const char* path);
static void imageDump(JSC::VM& vm, const char* path);
extern "C" void Bun__imageDumpNow(JSC::VM* vm, const char* path)
{
    { // the termination that unwound JS to get us here is done with; none of it may persist into the image (it would read as "terminating" forever on restore)
        JSC::JSLockHolder lock(*vm);
        vm->clearHasTerminationRequest();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(*vm); scope.clearException();
        vm->traps().clearTrap(JSC::VMTraps::NeedTermination);
    }
    imageDump(*vm, path);
}
extern "C" void Bun__memdebugInstall()
{
    if (getenv("BUN_IMAGE_OUT")) Bun__imageSetBuilding(true);

    s_dir = getenv("BUN_MEMDEBUG");
    if (!s_dir || !*s_dir) {
        s_dir = nullptr;
        return;
    }
    signal(SIGUSR1, memdebugSignal);
    signal(SIGINFO, memdebugSignal);
    signal(SIGXCPU, memdebugSignal);
}

static void dumpJSCHeap(JSC::VM& vm, FILE* f)
{
    JSC::JSLockHolder lock(vm);
    auto& heap = vm.heap;
    fprintf(f, "heap.size\t%zu\nheap.capacity\t%zu\nheap.extraMemorySize\t%zu\nheap.blockBytesAllocated\t%zu\nobjectSpace.capacity\t%zu\nobjectSpace.size\t%zu\n",
        heap.size(), heap.capacity(), heap.extraMemorySize(), heap.blockBytesAllocated(), heap.objectSpace().capacity(), heap.objectSpace().size());
    struct Entry {
        size_t count { 0 };
        size_t cellBytes { 0 };
        size_t estimated { 0 };
    };
    WTF::HashMap<const char*, Entry> map;

    {
        JSC::HeapIterationScope scope(heap);
        heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
            const char* name = "<auxiliary>";
            size_t cellSize = heapCell->cellSize();
            size_t est = cellSize;
            if (isJSCellKind(kind)) {
                auto* cell = static_cast<JSC::JSCell*>(heapCell);
                name = cell->className();
                est = cell->estimatedSizeInBytes(vm);
            }
            auto& e = map.add(name, Entry {}).iterator->value;
            e.count++;
            e.cellBytes += cellSize;
            e.estimated += est;
            return IterationStatus::Continue;
        });
    }
    {
        JSC::HeapIterationScope scope(heap);
        WTF::HashSet<JSC::UnlinkedCodeBlock*> linkedSet;
        size_t codeBlocks = 0;
        heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
            if (!isJSCellKind(kind))
                return IterationStatus::Continue;
            auto* cell = static_cast<JSC::JSCell*>(heapCell);
            if (auto* cb = dynamicDowncast<JSC::CodeBlock>(cell)) {
                codeBlocks++;
                linkedSet.add(cb->unlinkedCodeBlock());
            }
            return IterationStatus::Continue;
        });
        size_t n = 0, nLinked = 0, insn = 0, insnLinked = 0, meta = 0, metaLinked = 0, nHasMeta = 0;
        heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
            if (!isJSCellKind(kind))
                return IterationStatus::Continue;
            auto* cell = static_cast<JSC::JSCell*>(heapCell);
            auto* ucb = dynamicDowncast<JSC::UnlinkedCodeBlock>(cell);
            if (!ucb)
                return IterationStatus::Continue;
            bool linked = linkedSet.contains(ucb);
            n++;
            size_t is = ucb->instructions().sizeInBytes();
            auto& md = ucb->metadata();
            size_t ms = md.allocatedSizeForDebug();
            if (ms) nHasMeta++;
            insn += is;
            meta += ms;
            if (linked) {
                nLinked++;
                insnLinked += is;
                metaLinked += ms;
            }
            return IterationStatus::Continue;
        });
        fprintf(f, "\nunlinkedCodeBlocks\t%zu\nunlinkedCodeBlocks.linked\t%zu\ncodeBlocks\t%zu\ninstructionBytes\t%zu\ninstructionBytes.linked\t%zu\nmetadataBufBytes\t%zu\nmetadataBufBytes.linked\t%zu\nunlinkedWithMetadata\t%zu\n", n, nLinked, codeBlocks, insn, insnLinked, meta, metaLinked, nHasMeta);
    }
    {
        JSC::HeapIterationScope scope(heap);
        struct DirStat { size_t blocks { 0 }; size_t liveCells { 0 }; size_t liveBytes { 0 }; size_t emptyBlocks { 0 }; size_t hist[11] { }; };
        std::map<std::string, DirStat> dirs;
        heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* handle) {
            std::string key = std::string(handle->subspace()->name()) + "/" + std::to_string(handle->cellSize());
            auto& d = dirs[key];
            d.blocks++;
            size_t live = 0;
            handle->forEachLiveCell([&](size_t, JSC::HeapCell*, JSC::HeapCell::Kind) { live++; return IterationStatus::Continue; });
            d.liveCells += live;
            d.liveBytes += live * handle->cellSize();
            if (!live) d.emptyBlocks++;
            size_t cap = JSC::MarkedBlock::payloadSize / handle->cellSize();
            d.hist[cap ? std::min<size_t>(10, live * 10 / cap) : 0]++;
        });
        fprintf(f, "\ndirectory\tblocks\tblockBytes\tliveCells\tliveBytes\temptyBlocks\tutil%%\thist(0-100%% by 10)\n");
        for (auto& [k, d] : dirs) {
            fprintf(f, "%s\t%zu\t%zu\t%zu\t%zu\t%zu\t%.0f\t", k.c_str(), d.blocks, d.blocks * JSC::MarkedBlock::blockSize, d.liveCells, d.liveBytes, d.emptyBlocks, d.blocks ? 100.0 * d.liveBytes / (d.blocks * JSC::MarkedBlock::payloadSize) : 0.0);
            for (int i = 0; i < 11; i++) fprintf(f, "%zu%s", d.hist[i], i < 10 ? "," : "\n");
        }
    }
    {
        JSC::HeapIterationScope scope(heap);
        std::vector<std::pair<size_t, std::string>> mods;
        size_t totalSrc = 0;
        heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
            if (!isJSCellKind(kind))
                return IterationStatus::Continue;
            auto* rec = dynamicDowncast<JSC::JSModuleRecord>(static_cast<JSC::JSCell*>(heapCell));
            if (!rec)
                return IterationStatus::Continue;
            size_t len = rec->sourceCode().provider() ? rec->sourceCode().provider()->source().length() : 0;
            totalSrc += len;
            mods.push_back({ len, std::string(rec->moduleKey().string().string().utf8().data()) });
            return IterationStatus::Continue;
        });
        std::sort(mods.begin(), mods.end(), std::greater<>());
        {
            std::map<std::string, std::pair<size_t, size_t>> perURL; // url -> (functionExecutables, everExecuted)
            heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
                if (!isJSCellKind(kind))
                    return IterationStatus::Continue;
                auto* fe = dynamicDowncast<JSC::FunctionExecutable>(static_cast<JSC::JSCell*>(heapCell));
                if (!fe)
                    return IterationStatus::Continue;
                std::string url(fe->sourceURL().utf8().data());
                auto& e = perURL[url];
                e.first++;
                if (fe->codeBlockForCall() || fe->codeBlockForConstruct())
                    e.second++;
                return IterationStatus::Continue;
            });
            fprintf(f, "\nurl\tfunctionExecutables\texecutedFunctions\n");
            for (auto& [url, e] : perURL)
                fprintf(f, "url\t%s\t%zu\t%zu\n", url.c_str(), e.first, e.second);
            if (const char* strDump = getenv("BUN_MEMDEBUG_STR")) {
                // JSString census: duplicate contents + length histogram (resolved, non-rope strings only)
                std::map<std::string, std::pair<size_t, size_t>> byContent; // content(truncated) -> (count, bytes)
                size_t ropes = 0, ropeBytes = 0, total = 0, totalBytes = 0, atoms = 0, atomBytes = 0, symbols = 0, substrings = 0;
                size_t hist[8] = { 0 }; size_t histBytes[8] = { 0 };
                heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
                    if (!isJSCellKind(kind))
                        return IterationStatus::Continue;
                    auto* cell = static_cast<JSC::JSCell*>(heapCell);
                    if (!cell->isString())
                        return IterationStatus::Continue;
                    auto* str = static_cast<JSC::JSString*>(cell);
                    total++;
                    if (str->isRope()) { ropes++; ropeBytes += str->length(); return IterationStatus::Continue; }
                    WTF::StringImpl* impl = str->tryGetValueImpl();
                    if (!impl) return IterationStatus::Continue;
                    size_t bytes = impl->length() * (impl->is8Bit() ? 1 : 2);
                    totalBytes += bytes;
                    if (impl->isAtom()) { atoms++; atomBytes += bytes; }
                    if (impl->isSymbol()) symbols++;
                    if (impl->bufferOwnership() == WTF::StringImpl::BufferSubstring) substrings++;
                    int b = bytes < 16 ? 0 : bytes < 64 ? 1 : bytes < 256 ? 2 : bytes < 1024 ? 3 : bytes < 4096 ? 4 : bytes < 65536 ? 5 : bytes < 1048576 ? 6 : 7;
                    hist[b]++; histBytes[b] += bytes;
                    std::string key = impl->is8Bit() ? std::string(reinterpret_cast<const char*>(impl->span8().data()), std::min<size_t>(impl->length(), 120)) : std::string(WTF::String(impl).utf8().data()).substr(0, 120);
                    auto& e = byContent[key]; e.first++; e.second += bytes;
                    return IterationStatus::Continue;
                });
                FILE* ff = fopen(strDump, "w");
                if (ff) {
                    fprintf(ff, "#total\t%zu\tresolvedBytes\t%zu\tropes\t%zu\tropeChars\t%zu\tatoms\t%zu\tatomBytes\t%zu\tsymbols\t%zu\tsubstrings\t%zu\n", total, totalBytes, ropes, ropeBytes, atoms, atomBytes, symbols, substrings);
                    const char* names[8] = { "<16", "16-64", "64-256", "256-1K", "1K-4K", "4K-64K", "64K-1M", ">1M" };
                    for (int i = 0; i < 8; i++) fprintf(ff, "#hist\t%s\t%zu\t%zu\n", names[i], hist[i], histBytes[i]);
                    std::vector<std::pair<size_t, std::string>> dups;
                    size_t dupWaste = 0;
                    for (auto& [k, v] : byContent) if (v.first > 1) { size_t waste = v.second - v.second / v.first; dupWaste += waste; dups.push_back({ waste, std::to_string(v.first) + "\t" + std::to_string(v.second) + "\t" + k }); }
                    fprintf(ff, "#duplicateWasteBytes\t%zu\n", dupWaste);
                    std::sort(dups.begin(), dups.end(), std::greater<>());
                    for (size_t i = 0; i < std::min<size_t>(dups.size(), 300); i++) { std::string line = dups[i].second; for (auto& ch : line) if (ch == '\n' || ch == '\r') ch = ' '; fprintf(ff, "%zu\t%s\n", dups[i].first, line.c_str()); }
                    fclose(ff);
                }
            }
            if (const char* fnDump = getenv("BUN_MEMDEBUG_FN")) {
                // live JSFunction instances grouped by executable: url \t startOffset \t instances \t everExecuted
                std::map<std::pair<std::string, unsigned>, std::pair<size_t, int>> byExec;
                size_t hostFns = 0, boundFns = 0;
                heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
                    if (!isJSCellKind(kind))
                        return IterationStatus::Continue;
                    auto* fn = dynamicDowncast<JSC::JSFunction>(static_cast<JSC::JSCell*>(heapCell));
                    if (!fn)
                        return IterationStatus::Continue;
                    if (fn->inherits<JSC::JSBoundFunction>()) { boundFns++; return IterationStatus::Continue; }
                    auto* fe = fn->jsExecutable();
                    if (!fe || fn->isHostFunction()) { hostFns++; return IterationStatus::Continue; }
                    auto& e = byExec[{ std::string(fe->sourceURL().utf8().data()), fe->source().startOffset() }];
                    e.first++;
                    if (fe->codeBlockForCall() || fe->codeBlockForConstruct()) e.second = 1;
                    return IterationStatus::Continue;
                });
                FILE* ff = fopen(fnDump, "w");
                if (ff) {
                    fprintf(ff, "#host\t%zu\tbound\t%zu\n", hostFns, boundFns);
                    for (auto& [k, v] : byExec)
                        fprintf(ff, "%s\t%u\t%zu\t%d\n", k.first.c_str(), k.second, v.first, v.second);
                    fclose(ff);
                }
            }
            if (const char* feDump = getenv("BUN_MEMDEBUG_FE")) {
                FILE* ff = fopen(feDump, "w");
                if (ff) {
                    heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
                        if (!isJSCellKind(kind))
                            return IterationStatus::Continue;
                        auto* fe = dynamicDowncast<JSC::FunctionExecutable>(static_cast<JSC::JSCell*>(heapCell));
                        if (!fe)
                            return IterationStatus::Continue;
                        fprintf(ff, "%s\t%u\t%d\t%d\n", fe->sourceURL().utf8().data(), fe->source().startOffset(), fe->firstLine(), (fe->codeBlockForCall() || fe->codeBlockForConstruct()) ? 1 : 0);
                        return IterationStatus::Continue;
                    });
                    fclose(ff);
                }
            }
        }
        fprintf(f, "\nmodules\t%zu\ttotalSourceBytes\t%zu\n", mods.size(), totalSrc);
        for (auto& [len, key] : mods)
            fprintf(f, "module\t%zu\t%s\n", len, key.c_str());
    }
    fprintf(f, "\nclass\tcount\tcellBytes\testimatedBytes\n");
    for (auto& [name, e] : map)
        fprintf(f, "%s\t%zu\t%zu\t%zu\n", name, e.count, e.cellBytes, e.estimated);
}


// Experiment: turn resident anonymous heap pages into a private file mapping of themselves (clean, evictable, COW on write).
static void fileSnapshotHeap(JSC::VM& vm)
{
    JSC::JSLockHolder lock(vm);
    bool freeze = !getenv("BUN_FILESNAP_NOFREEZE");
    if (freeze)
        vm.heap.freezeCurrentHeapAsImmortalImage();
    else
        vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    mi_collect(true);
    size_t pg = getpagesize();
    bool onlyLive = !getenv("BUN_FILESNAP_ALL");
    {
        s_cellPages.clear(); s_payloadPages.clear(); s_pageSizeClass.clear(); s_liveBlocks.clear(); s_runs.clear();
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            for (uintptr_t a = (uintptr_t)&h->block(); a < (uintptr_t)&h->block() + JSC::MarkedBlock::blockSize; a += pg) s_cellPages.push_back(a);
        });
        mi_heap_visit_blocks(mi_heap_main(), true, recordUsedBlock, &pg);
        std::sort(s_cellPages.begin(), s_cellPages.end());
        std::sort(s_liveBlocks.begin(), s_liveBlocks.end());
        std::sort(s_payloadPages.begin(), s_payloadPages.end());
        s_payloadPages.erase(std::unique(s_payloadPages.begin(), s_payloadPages.end()), s_payloadPages.end());
        // MarkedBlocks are themselves malloc blocks; keep the classes disjoint
        std::vector<uintptr_t> tmp; std::set_difference(s_payloadPages.begin(), s_payloadPages.end(), s_cellPages.begin(), s_cellPages.end(), std::back_inserter(tmp)); s_payloadPages.swap(tmp);
        fprintf(stderr, "[filesnap] cellPages=%.1fMB payloadPages=%.1fMB\n", s_cellPages.size() * pg / 1048576.0, s_payloadPages.size() * pg / 1048576.0);
    }
    struct Range { uintptr_t start; size_t len; };
    std::vector<Range> candidates;
#if OS(DARWIN)
    {
        mach_vm_address_t addr = 0;
        for (;;) {
            mach_vm_size_t size = 0;
            vm_region_extended_info_data_t info;
            mach_msg_type_number_t count = VM_REGION_EXTENDED_INFO_COUNT;
            mach_port_t objName;
            if (mach_vm_region(mach_task_self(), &addr, &size, VM_REGION_EXTENDED_INFO, (vm_region_info_t)&info, &count, &objName) != KERN_SUCCESS)
                break;
            // anonymous, writable, private, has dirty pages, tagged by mimalloc (100/240) or untagged malloc-ish; skip stacks/JIT/mapped files
            bool writable = (info.protection & VM_PROT_WRITE) && !(info.protection & VM_PROT_EXECUTE);
            bool anon = info.external_pager == 0;
            int tag = info.user_tag;
            bool tagOk = tag == 100 || tag == 240 || tag == 0 /* untagged */;
            if (writable && anon && tagOk && info.pages_dirtied > 0 && size >= 1 * 1024 * 1024 && info.share_mode != SM_SHARED)
                candidates.push_back({ (uintptr_t)addr, (size_t)size });
            addr += size;
        }
    }
#else
    {
        FILE* maps = fopen("/proc/self/maps", "r");
        char line[512];
        while (maps && fgets(line, sizeof line, maps)) {
            unsigned long a, b; char perms[8]; unsigned long off; char dev[16]; unsigned long inode; char path[256] = "";
            if (sscanf(line, "%lx-%lx %7s %lx %15s %lu %255s", &a, &b, perms, &off, dev, &inode, path) < 6) continue;
            if (perms[0] != 'r' || perms[1] != 'w' || perms[2] == 'x') continue;
            if (inode != 0) continue; // file-backed already
            if (path[0] == '[') continue; // [stack] [heap]? keep [heap]? mimalloc doesn't use brk
            if (b - a < 1 * 1024 * 1024) continue;
            candidates.push_back({ (uintptr_t)a, (size_t)(b - a) });
        }
        if (maps) fclose(maps);
    }
#endif
    uintptr_t sp = (uintptr_t)__builtin_frame_address(0);
    char path[256];
    snprintf(path, sizeof path, "%s/bun-heapsnap.%d", getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp", getpid());
    int fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) { fprintf(stderr, "[filesnap] open failed %d\n", errno); return; }
    unlink(path);
    size_t fileOff = 0, remapped = 0, runs = 0, skipped = 0;
    std::vector<unsigned char> vec;
    for (auto& r : candidates) {
        if (sp >= r.start && sp < r.start + r.len) { skipped++; continue; } // our own stack
        size_t npages = r.len / pg;
        vec.assign(npages, 0);
#if OS(DARWIN)
        if (mincore((void*)r.start, r.len, (char*)vec.data()) != 0) { skipped++; continue; }
#else
        if (mincore((void*)r.start, r.len, vec.data()) != 0) { skipped++; continue; }
#endif
        auto want = [&](size_t k) { if (!(vec[k] & 1)) return false; if (!onlyLive) return true; uintptr_t a = r.start + k * pg; return pageIn(s_cellPages, a) || pageIn(s_payloadPages, a); };
        size_t i = 0;
        while (i < npages) {
            if (!want(i)) { i++; continue; }
            size_t j = i; while (j < npages && want(j)) j++;
            uintptr_t a = r.start + i * pg; size_t len = (j - i) * pg;
            // write pages to file at page-aligned offset, then map that file range back over the same addresses
            if (getenv("BUN_FILESNAP_NOREMAP")) { i = j; continue; }
            if (pwrite(fd, (void*)a, len, fileOff) != (ssize_t)len) { fprintf(stderr, "[filesnap] pwrite failed %d\n", errno); close(fd); return; }
            void* m = mmap((void*)a, len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, fileOff);
            if (m == MAP_FAILED) { fprintf(stderr, "[filesnap] mmap fixed failed at %p len %zu errno %d\n", (void*)a, len, errno); skipped++; }
            else { remapped += len; runs++; s_frozenRanges.push_back({ a, a + len }); s_runs.push_back({ a, len, fileOff }); }
            fileOff += len;
            i = j;
        }
    }
    // MarkedBlocks living outside mimalloc regions (e.g. the StructureHeap reservation, JSC-tagged VM) were skipped above; remap them too.
    if (!getenv("BUN_FILESNAP_NOREMAP")) {
        std::sort(s_frozenRanges.begin(), s_frozenRanges.end());
        std::vector<uintptr_t> extra;
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            uintptr_t a = (uintptr_t)&h->block();
            auto it = std::upper_bound(s_frozenRanges.begin(), s_frozenRanges.end(), std::make_pair(a, UINTPTR_MAX));
            bool covered = it != s_frozenRanges.begin() && a < std::prev(it)->second;
            if (!covered) extra.push_back(a);
        });
        std::sort(extra.begin(), extra.end());
        size_t i = 0, extraBytes = 0;
        while (i < extra.size()) {
            size_t j = i + 1;
            while (j < extra.size() && extra[j] == extra[j - 1] + JSC::MarkedBlock::blockSize) j++;
            uintptr_t a = extra[i]; size_t len = (j - i) * JSC::MarkedBlock::blockSize;
            if (pwrite(fd, (void*)a, len, fileOff) == (ssize_t)len) {
                void* m = mmap((void*)a, len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, fileOff);
                if (m != MAP_FAILED) { remapped += len; runs++; extraBytes += len; s_frozenRanges.push_back({ a, a + len }); s_runs.push_back({ a, len, fileOff }); }
                fileOff += len;
            }
            i = j;
        }
        fprintf(stderr, "[filesnap] additionally remapped %.1fMB of MarkedBlocks outside malloc regions\n", extraBytes / 1048576.0);
    }
    if (freeze && !getenv("BUN_FILESNAP_NOMI")) {
        std::sort(s_frozenRanges.begin(), s_frozenRanges.end());
        mi_free_set_filter(frozenFreeFilter);
        mi_theap_set_default(mi_heap_theap(mi_heap_new())); // main thread allocates from fresh pages from now on
        size_t inFrozen = 0;
        for (int k = 0; k < 64; k++) { void* probe = mi_malloc(48 + k * 16); uintptr_t a = (uintptr_t)probe; auto it = std::upper_bound(s_frozenRanges.begin(), s_frozenRanges.end(), std::make_pair(a, UINTPTR_MAX)); if (it != s_frozenRanges.begin() && a < std::prev(it)->second) inFrozen++; }
        void* probe2 = WTF::fastMalloc(100); uintptr_t a2 = (uintptr_t)probe2; auto it2 = std::upper_bound(s_frozenRanges.begin(), s_frozenRanges.end(), std::make_pair(a2, UINTPTR_MAX)); bool f2 = it2 != s_frozenRanges.begin() && a2 < std::prev(it2)->second;
        fprintf(stderr, "[filesnap] post-switch probes landing in frozen ranges: mi_malloc %zu/64, fastMalloc %d\n", inFrozen, (int)f2);
    }
    std::sort(s_runs.begin(), s_runs.end(), [](const FrozenRun& x, const FrozenRun& y) { return x.start < y.start; });
    std::sort(s_frozenRanges.begin(), s_frozenRanges.end());
    s_snapFd = fd;
    if (const char* prot = getenv("BUN_FILESNAP_PROTECT")) {
        // Debug: make image blocks of one subspace read-only so the first writer faults with a backtrace.
        size_t n = 0;
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            if (!h->block().isImmortal() || strcmp(h->subspace()->name(), prot)) return;
            if (!mprotect(&h->block(), JSC::MarkedBlock::blockSize, PROT_READ)) n++;
        });
        fprintf(stderr, "[filesnap] mprotect(PROT_READ) %zu blocks of %s\n", n, prot);
    }
    // keep fd open for the life of the process (mapping holds a reference anyway)
    fprintf(stderr, "[filesnap] candidates=%zu remapped=%.1fMB in %zu runs, skipped=%zu, file=%.1fMB\n", candidates.size(), remapped / 1048576.0, runs, skipped, fileOff / 1048576.0);
}

// After filesnap: which frozen pages were COW'd back to private (dirty), attributed to MarkedBlock subspaces vs other malloc.
static void dumpDirtyMap(JSC::VM& vm)
{
#if OS(DARWIN)
    JSC::JSLockHolder lock(vm);
    size_t pg = getpagesize();
    std::map<std::string, std::pair<size_t, size_t>> bySubspace; // name -> (dirtyPages, totalPages)
    size_t totalPages = 0, dirtyPages = 0, blockPages = 0, blockDirty = 0, otherDirty = 0;
    // index MarkedBlocks by address
    std::map<uintptr_t, std::string> blocks;
    vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
        blocks[(uintptr_t)&h->block()] = std::string(h->subspace()->name()) + (h->block().isImmortal() ? "" : " [mortal]");
    });
    std::vector<int> disp;
    for (auto& r : s_frozenRanges) {
        size_t n = (r.second - r.first) / pg;
        disp.assign(n, 0);
        mach_vm_size_t cnt = n;
        if (mach_vm_page_range_query(mach_task_self(), r.first, r.second - r.first, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS)
            continue;
        for (size_t i = 0; i < n; i++) {
            uintptr_t a = r.first + i * pg;
            bool dirty = (disp[i] & VM_PAGE_QUERY_PAGE_DIRTY) || (disp[i] & VM_PAGE_QUERY_PAGE_COPIED);
            totalPages++; if (dirty) dirtyPages++;
            auto it = blocks.upper_bound(a);
            std::string key = "<malloc/other>";
            if (it != blocks.begin()) { --it; if (a >= it->first && a < it->first + JSC::MarkedBlock::blockSize) key = it->second; }
            if (key == "<malloc/other>" && pageIn(s_payloadPages, a)) {
                auto sc = s_pageSizeClass.find(a);
                uint32_t bs = sc == s_pageSizeClass.end() ? 0 : sc->second;
                const char* bucket = bs <= 16 ? "<=16" : bs <= 32 ? "<=32" : bs <= 48 ? "<=48" : bs <= 64 ? "<=64" : bs <= 96 ? "<=96" : bs <= 128 ? "<=128" : bs <= 256 ? "<=256" : bs <= 512 ? "<=512" : bs <= 1024 ? "<=1K" : bs <= 4096 ? "<=4K" : bs <= 16384 ? "<=16K" : bs <= 65536 ? "<=64K" : ">64K";
                key = std::string("<malloc payload ") + bucket + ">";
            }
            if (key[0] != '<') { blockPages++; if (dirty) blockDirty++; } else if (dirty) otherDirty++;
            auto& e = bySubspace[key]; e.second++; if (dirty) e.first++;
        }
    }
    fprintf(stderr, "[dirtymap] frozen=%.1fMB dirty=%.1fMB | markedBlockPages=%.1fMB dirty=%.1fMB | other=%.1fMB dirty=%.1fMB\n",
        totalPages * pg / 1048576.0, dirtyPages * pg / 1048576.0, blockPages * pg / 1048576.0, blockDirty * pg / 1048576.0, (totalPages - blockPages) * pg / 1048576.0, otherDirty * pg / 1048576.0);
    std::vector<std::pair<size_t, std::string>> rows;
    for (auto& [k, v] : bySubspace) { char line[256]; snprintf(line, sizeof line, "  %-40s dirty %7.2fMB / %7.2fMB (%3.0f%%)", k.c_str(), v.first * pg / 1048576.0, v.second * pg / 1048576.0, v.second ? 100.0 * v.first / v.second : 0.0); rows.push_back({ v.first, line }); }
    std::sort(rows.begin(), rows.end(), std::greater<>());
    for (size_t i = 0; i < std::min<size_t>(rows.size(), 40); i++) fprintf(stderr, "%s\n", rows[i].second.c_str());

    // Byte-level diff of dirty malloc-payload pages against the snapshot file: which blocks changed, and how.
    if (s_snapFd >= 0 && !s_liveBlocks.empty()) {
        std::vector<uint8_t> orig(pg);
        size_t changedBytes = 0, dirtyPayloadPages = 0, pagesNoChange = 0;
        std::map<std::string, size_t> blockClass; // classification -> count
        std::map<uint32_t, std::pair<size_t,size_t>> bySize; // block size -> (changedBlocks, changedBytes)
        std::set<uintptr_t> changedBlocks;
        for (auto& run : s_runs) {
            size_t n = run.len / pg;
            disp.assign(n, 0);
            mach_vm_size_t cnt = n;
            if (mach_vm_page_range_query(mach_task_self(), run.start, run.len, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS) continue;
            for (size_t i = 0; i < n; i++) {
                uintptr_t a = run.start + i * pg;
                bool dirty = (disp[i] & VM_PAGE_QUERY_PAGE_DIRTY) || (disp[i] & VM_PAGE_QUERY_PAGE_COPIED);
                if (!dirty || !pageIn(s_payloadPages, a)) continue;
                dirtyPayloadPages++;
                if (pread(s_snapFd, orig.data(), pg, run.fileOff + i * pg) != (ssize_t)pg) continue;
                const uint8_t* cur = reinterpret_cast<const uint8_t*>(a);
                bool any = false;
                for (size_t off = 0; off < pg; off += 8) {
                    if (!memcmp(cur + off, orig.data() + off, 8)) continue;
                    any = true; changedBytes += 8;
                    // find owning block
                    auto it = std::upper_bound(s_liveBlocks.begin(), s_liveBlocks.end(), std::make_pair(a + off, UINT32_MAX));
                    if (it == s_liveBlocks.begin()) { blockClass["<not in live block (freed-at-freeze space)>"]++; continue; }
                    --it;
                    if (a + off >= it->first + it->second) { blockClass["<not in live block (freed-at-freeze space)>"]++; continue; }
                    if (changedBlocks.insert(it->first).second) { bySize[it->second].first++; }
                    bySize[it->second].second += 8;
                }
                if (!any) pagesNoChange++;
            }
        }
        // classify changed blocks by change shape
        size_t onlyHeader8 = 0, small32 = 0, larger = 0;
        struct SigInfo { size_t count = 0; std::vector<std::string> examples; }; std::map<std::string, SigInfo> smallSigs;
        for (uintptr_t b : changedBlocks) {
            auto it = std::lower_bound(s_liveBlocks.begin(), s_liveBlocks.end(), std::make_pair(b, 0u));
            uint32_t sz = it->second;
            // re-diff this block
            size_t first = SIZE_MAX, last = 0, cntw = 0;
            for (size_t off = 0; off + 8 <= sz; off += 8) {
                uintptr_t a = b + off; uintptr_t page = a & ~(pg - 1);
                // find file offset for page
                auto r = std::upper_bound(s_runs.begin(), s_runs.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r == s_runs.begin()) continue; --r; if (page >= r->start + r->len) continue;
                uint64_t o; if (pread(s_snapFd, &o, 8, r->fileOff + (a - r->start)) != 8) continue;
                if (memcmp(&o, (void*)a, 8)) { cntw++; if (first == SIZE_MAX) first = off; last = off; }
            }
            if (cntw == 1 && first == 0) onlyHeader8++; else if (cntw <= 4) small32++; else larger++;
            if (cntw <= 4 && first != SIZE_MAX) {
                // signature: size class, first changed offset, before>after of that word
                uintptr_t a = b + first; uintptr_t page = a & ~(pg - 1); uint64_t before = 0, after = *(uint64_t*)a;
                auto r = std::upper_bound(s_runs.begin(), s_runs.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r != s_runs.begin()) { --r; if (page < r->start + r->len) pread(s_snapFd, &before, 8, r->fileOff + (a - r->start)); }
                char sig[160]; snprintf(sig, sizeof sig, "sz%u +%zu n%zu", sz, first, cntw);
                auto& sc = smallSigs[sig]; sc.count++; if (sc.examples.size() < 3) { char ex[64]; snprintf(ex, sizeof ex, "%llx>%llx", (unsigned long long)before, (unsigned long long)after); sc.examples.push_back(ex); }
            }
        }
        { std::vector<std::pair<size_t, std::string>> ss; for (auto& [k, v] : smallSigs) { std::string e = k + " x" + std::to_string(v.count) + " ["; for (auto& x : v.examples) e += x + " "; e += "]"; ss.push_back({ v.count, e }); } std::sort(ss.begin(), ss.end(), std::greater<>()); fprintf(stderr, "[diffmap] small-change signatures (sizeclass +firstOff nWords xCount [before>after...]):\n"); for (size_t i = 0; i < std::min<size_t>(ss.size(), 40); i++) fprintf(stderr, "    %s\n", ss[i].second.c_str()); }
        fprintf(stderr, "[diffmap] dirtyPayloadPages=%zu (%.1fMB) pagesWithNoByteChange=%zu changedBytes=%.2fMB changedBlocks=%zu: firstWordOnly=%zu (refcount-like) small(<=4 words)=%zu larger=%zu; strayWrites(outside live blocks)=%zu\n",
            dirtyPayloadPages, dirtyPayloadPages * pg / 1048576.0, pagesNoChange, changedBytes / 1048576.0, changedBlocks.size(), onlyHeader8, small32, larger, blockClass["<not in live block (freed-at-freeze space)>"]);
        std::vector<std::pair<size_t, uint32_t>> sizes; for (auto& [sz, v] : bySize) sizes.push_back({ v.first, sz });
        std::sort(sizes.begin(), sizes.end(), std::greater<>());
        // Cell-granularity diff over immortal MarkedBlocks: how many cells actually changed vs pages dirtied.
        {
            size_t cellsTotal = 0, cellsChanged = 0, cellsHeaderOnly = 0, bytesInChangedCells = 0, dirtyCellPages = 0, identicalDirtyCellPages = 0;
            size_t coldMissCells = 0, coldMissBytes = 0; std::set<uintptr_t> coldMissPages; std::map<std::string, size_t> coldByClass;
            std::map<std::string, std::map<size_t, size_t>> offsetHistBy;
            std::map<std::string, size_t> identicalByClass;
            std::map<std::string, std::map<std::string, size_t>> headerPatBy; // high 32 bits of header (indexingType,type,flags,cellState) before>after
            std::map<std::string, std::pair<size_t, size_t>> byClass; // class -> (changed, total)
            auto fileWordAt = [&](uintptr_t a, uint64_t& out) -> bool {
                uintptr_t page = a & ~(pg - 1);
                auto r = std::upper_bound(s_runs.begin(), s_runs.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r == s_runs.begin()) return false; --r; if (page >= r->start + r->len) return false;
                return pread(s_snapFd, &out, 8, r->fileOff + (a - r->start)) == 8;
            };
            vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
                if (!h->block().isImmortal()) return;
                // is any page of this block dirty?
                uintptr_t base = (uintptr_t)&h->block();
                disp.assign(JSC::MarkedBlock::blockSize / pg, 0);
                mach_vm_size_t cnt = disp.size();
                if (mach_vm_page_range_query(mach_task_self(), base, JSC::MarkedBlock::blockSize, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS) return;
                bool anyDirty = false; for (auto d : disp) if ((d & VM_PAGE_QUERY_PAGE_DIRTY) || (d & VM_PAGE_QUERY_PAGE_COPIED)) { anyDirty = true; dirtyCellPages++; }
                std::string cls = std::string(h->subspace()->name());
                bool blockAnyChange = false;
                h->forEachCell([&](size_t, JSC::HeapCell* cell, JSC::HeapCell::Kind) -> IterationStatus {
                    if (!h->block().isMarkedRaw(cell)) return IterationStatus::Continue;
                    cellsTotal++; byClass[cls].second++;
                    if (!anyDirty) return IterationStatus::Continue;
                    size_t changedWords = 0; bool headerChanged = false;
                    static const char* offCls = getenv("BUN_MEMDEBUG_OFFSETS_FOR");
                    bool trackOff = offCls && (std::string(",") + offCls + ",").find("," + cls + ",") != std::string::npos;
                    for (size_t off = 0; off + 8 <= h->cellSize(); off += 8) {
                        uint64_t o; if (!fileWordAt((uintptr_t)cell + off, o)) break;
                        if (memcmp(&o, (uint8_t*)cell + off, 8)) { changedWords++; if (!off) { headerChanged = true; if (trackOff) { uint64_t cur; memcpy(&cur, (uint8_t*)cell, 8); char buf[64]; snprintf(buf, sizeof buf, "%016llx>%016llx", (unsigned long long)(o & 0xffffffff00000000ull), (unsigned long long)(cur & 0xffffffff00000000ull)); headerPatBy[cls][buf]++; } } if (trackOff) offsetHistBy[cls][off]++; }
                    }
                    if (changedWords) {
                        cellsChanged++; byClass[cls].first++; bytesInChangedCells += h->cellSize(); blockAnyChange = true; if (changedWords == 1 && headerChanged) cellsHeaderOnly++;
                        if (s_recordProfile) s_profileCells.insert((uintptr_t)cell);
                        else if (!s_profileCells.empty() && !s_profileCells.count((uintptr_t)cell)) { coldMissCells++; coldMissBytes += h->cellSize(); coldMissPages.insert((uintptr_t)cell & ~(pg - 1)); coldByClass[cls]++; }
                    }
                    return IterationStatus::Continue;
                });
                if (anyDirty && !blockAnyChange) { size_t nd = 0; for (auto d : disp) if ((d & VM_PAGE_QUERY_PAGE_DIRTY) || (d & VM_PAGE_QUERY_PAGE_COPIED)) nd++; identicalDirtyCellPages += nd; identicalByClass[cls] += nd; }
            });
            fprintf(stderr, "[celldiff] immortal live cells=%zu changed=%zu (%.1f%%) headerOnly=%zu bytesOfChangedCells=%.2fMB vs dirtyCellPages=%.2fMB (identical-content dirty pages=%.2fMB) => perfect segregation would dirty ~%.2fMB\n",
                cellsTotal, cellsChanged, cellsTotal ? 100.0 * cellsChanged / cellsTotal : 0.0, cellsHeaderOnly, bytesInChangedCells / 1048576.0, dirtyCellPages * pg / 1048576.0, identicalDirtyCellPages * pg / 1048576.0, bytesInChangedCells / 1048576.0);
            if (s_recordProfile) fprintf(stderr, "[cellprofile] recorded %zu changed cells as the hot profile\n", s_profileCells.size());
            else if (!s_profileCells.empty()) {
                fprintf(stderr, "[celldiff] vs profile(%zu hot cells): cells changed that were NOT hot in profile = %zu (%.2fMB of cells, spanning %zu distinct 16K pages = %.2fMB upper bound)\n", s_profileCells.size(), coldMissCells, coldMissBytes / 1048576.0, coldMissPages.size(), coldMissPages.size() * pg / 1048576.0);
                std::vector<std::pair<size_t, std::string>> cm; for (auto& [k, v] : coldByClass) cm.push_back({ v, k }); std::sort(cm.begin(), cm.end(), std::greater<>());
                fprintf(stderr, "    cold misses by class:"); for (size_t i = 0; i < std::min<size_t>(cm.size(), 10); i++) fprintf(stderr, " %s=%zu", cm[i].second.c_str(), cm[i].first); fprintf(stderr, "\n");
            }
            { std::vector<std::pair<size_t, std::string>> ib; for (auto& [k, v] : identicalByClass) ib.push_back({ v, k }); std::sort(ib.begin(), ib.end(), std::greater<>()); fprintf(stderr, "[celldiff] identical-content dirty pages by class:"); for (size_t i = 0; i < std::min<size_t>(ib.size(), 10); i++) fprintf(stderr, " %s=%.2fMB", ib[i].second.c_str(), ib[i].first * pg / 1048576.0); fprintf(stderr, "\n"); }
            for (auto& [c, hist] : offsetHistBy) { fprintf(stderr, "[celldiff] changed word offsets for %s:", c.c_str()); for (auto& [off, n] : hist) fprintf(stderr, " +%zu:%zu", off, n); fprintf(stderr, "\n"); }
            for (auto& [c, pats] : headerPatBy) { fprintf(stderr, "[celldiff] header byte patterns (idxType,type,flags,cellState hi32 before>after) for %s:", c.c_str()); size_t k = 0; for (auto& [pat, n] : pats) { if (k++ < 8) fprintf(stderr, " %s x%zu", pat.c_str(), n); } fprintf(stderr, "\n"); }
            std::vector<std::pair<size_t, std::string>> crow;
            for (auto& [k, v] : byClass) { char line[200]; snprintf(line, sizeof line, "    %-36s changed %7zu / %7zu (%3.0f%%)", k.c_str(), v.first, v.second, v.second ? 100.0 * v.first / v.second : 0.0); crow.push_back({ v.first, line }); }
            std::sort(crow.begin(), crow.end(), std::greater<>());
            for (size_t i = 0; i < std::min<size_t>(crow.size(), 18); i++) fprintf(stderr, "%s\n", crow[i].second.c_str());
        }
        // Owners of mutated payload: join live profiler samples with the byte diff.
        if (getenv("MIMALLOC_PROF_SAMPLE_RATE")) {
            struct Ctx { std::function<bool(uintptr_t, uint64_t&)>* fileWordAt; FILE* f; size_t n; size_t changed; };
            std::function<bool(uintptr_t, uint64_t&)> fw = [&](uintptr_t a, uint64_t& out) -> bool {
                uintptr_t page = a & ~(pg - 1);
                auto r = std::upper_bound(s_runs.begin(), s_runs.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r == s_runs.begin()) return false; --r; if (page >= r->start + r->len) return false;
                return pread(s_snapFd, &out, 8, r->fileOff + (a - r->start)) == 8;
            };
            char path[512]; snprintf(path, sizeof path, "%s/payload-owners.%d.tsv", s_dir, getpid());
            Ctx ctx { &fw, fopen(path, "w"), 0, 0 };
            static char obuf[1 << 20]; if (ctx.f) setvbuf(ctx.f, obuf, _IOFBF, sizeof obuf); // no malloc under the profiler lock (sampled malloc would self-deadlock)
            if (ctx.f) {
                mi_prof_visit_live([](uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg) -> bool {
                    Ctx* c = static_cast<Ctx*>(arg);
                    // only blocks inside the frozen image
                    uint64_t probe; if (!(*c->fileWordAt)(addr, probe)) return true;
                    size_t changedWords = 0, firstOff = SIZE_MAX;
                    static uint8_t fbuf[1 << 16];
                    for (size_t base = 0; base < size; base += sizeof fbuf) {
                        size_t n = std::min(sizeof fbuf, size - base); uintptr_t a0 = addr + base; uintptr_t page = a0 & ~(uintptr_t)16383;
                        auto r = std::upper_bound(s_runs.begin(), s_runs.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                        if (r == s_runs.begin()) break; --r; if (a0 >= r->start + r->len) break; n = std::min<size_t>(n, r->start + r->len - a0);
                        if (pread(s_snapFd, fbuf, n, r->fileOff + (a0 - r->start)) != (ssize_t)n) break;
                        for (size_t off = 0; off + 8 <= n; off += 8) if (memcmp(fbuf + off, (void*)(a0 + off), 8)) { changedWords++; if (firstOff == SIZE_MAX) firstOff = base + off; }
                    }
                    c->n++; if (changedWords) c->changed++;
                    fprintf(c->f, "%zu\t%zu\t%zu\t", size, changedWords, firstOff == SIZE_MAX ? 0 : firstOff);
                    for (uint8_t k = 0; k < nframes && k < 14; k++) fprintf(c->f, "%s0x%lx", k ? ";" : "", (unsigned long)frames[k]);
                    fprintf(c->f, "\n");
                    return true;
                }, &ctx);
                fclose(ctx.f);
                fprintf(stderr, "[owners] wrote %s: %zu live sampled image blocks, %zu changed; loadaddr=%p\n", path, ctx.n, ctx.changed, (void*)_dyld_get_image_header(0));
            }
        }
        fprintf(stderr, "[diffmap] changed blocks by block size (count, bytes changed):");
        for (size_t i = 0; i < std::min<size_t>(sizes.size(), 24); i++) fprintf(stderr, " %u:%zu/%zuB", sizes[i].second, sizes[i].first, bySize[sizes[i].second].second);
        fprintf(stderr, "\n");
    }
#endif
}

// Re-clean: any frozen page that is dirty but byte-identical to the snapshot gets remapped from the file again.
static void recleanFrozenPages(JSC::VM& vm)
{
#if OS(DARWIN)
    JSC::JSLockHolder lock(vm);
    if (s_snapFd < 0) return;
    size_t pg = getpagesize();
    std::vector<uint8_t> orig(pg);
    std::vector<int> disp;
    size_t dirty = 0, identical = 0, remapped = 0, cellIdentical = 0, payloadIdentical = 0, nearly = 0;
    auto t0 = std::chrono::steady_clock::now();
    for (auto& run : s_runs) {
        size_t n = run.len / pg;
        disp.assign(n, 0);
        mach_vm_size_t cnt = n;
        if (mach_vm_page_range_query(mach_task_self(), run.start, run.len, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS) continue;
        size_t i = 0;
        while (i < n) {
            uintptr_t a = run.start + i * pg;
            bool d = (disp[i] & VM_PAGE_QUERY_PAGE_DIRTY) || (disp[i] & VM_PAGE_QUERY_PAGE_COPIED);
            if (!d) { i++; continue; }
            dirty++;
            if (pread(s_snapFd, orig.data(), pg, run.fileOff + i * pg) != (ssize_t)pg) { i++; continue; }
            if (memcmp((void*)a, orig.data(), pg)) {
                // count nearly-identical (<=64 bytes differ) for information
                size_t diff = 0; for (size_t off = 0; off < pg && diff <= 64; off += 8) if (memcmp((uint8_t*)a + off, orig.data() + off, 8)) diff += 8;
                if (diff <= 64) nearly++;
                i++; continue;
            }
            identical++;
            if (pageIn(s_cellPages, a)) cellIdentical++; else payloadIdentical++;
            // coalesce consecutive identical dirty pages into one mmap
            size_t j = i + 1;
            while (j < n) {
                uintptr_t b = run.start + j * pg;
                bool dj = (disp[j] & VM_PAGE_QUERY_PAGE_DIRTY) || (disp[j] & VM_PAGE_QUERY_PAGE_COPIED);
                if (!dj) break;
                if (pread(s_snapFd, orig.data(), pg, run.fileOff + j * pg) != (ssize_t)pg || memcmp((void*)b, orig.data(), pg)) break;
                dirty++; identical++; if (pageIn(s_cellPages, b)) cellIdentical++; else payloadIdentical++;
                j++;
            }
            if (mmap((void*)a, (j - i) * pg, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, s_snapFd, run.fileOff + i * pg) != MAP_FAILED)
                remapped += (j - i);
            i = j;
        }
    }
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
    fprintf(stderr, "[reclean] dirtyFrozenPages=%zu (%.1fMB) identical=%zu (%.1fMB: cells %.1fMB, payload %.1fMB) remapped=%zu nearlyIdentical(<=64B diff)=%zu (%.1fMB) took=%lldms\n",
        dirty, dirty * pg / 1048576.0, identical, identical * pg / 1048576.0, cellIdentical * pg / 1048576.0, payloadIdentical * pg / 1048576.0, remapped, nearly, nearly * pg / 1048576.0, (long long)ms);
#endif
}

struct us_loop_t;
extern "C" void us_loop_reinit_for_image(struct us_loop_t*);
extern "C" struct us_loop_t* uws_get_loop();
extern "C" void Bun__imageContinueEventLoop();
extern "C" void uws_adopt_loop_for_current_thread(struct us_loop_t*);
void _mi_scavenger_forked_child(void); // C++-mangled (mimalloc is built as C++ here)
extern "C" void Bun__imageAdoptMainThreadVM();
// ===== v0 heap image experiment (macOS, no-ASLR, JIT off): dump all mimalloc/JSC memory + __DATA at idle; a fresh process maps it back and runs JS on the image VM.
struct ImageHeader { char magic[8]; uint64_t textBase; uint64_t vm; uint64_t globalObject; uint64_t mainThread; uint64_t nregions; uint64_t reserved[8]; };
struct ImageRegion { uint64_t addr; uint64_t len; uint64_t fileOff; uint64_t kind; }; // kind: 0 heap(anon), 1 __DATA segment

// First-writer trap: image pages are made read-only; the fault handler records the writer's stack, unprotects the page and resumes.
struct TrapRec { uintptr_t page; uintptr_t pcs[10]; };
static TrapRec* s_trapRecs = nullptr; static std::atomic<size_t> s_trapCount { 0 }; static size_t s_trapCap = 0;
static struct sigaction s_prevBus, s_prevSegv;
static void imageTrapHandler(int sig, siginfo_t* info, void* uctx)
{
    uintptr_t a = (uintptr_t)info->si_addr; size_t pg = 16384; uintptr_t page = a & ~(pg - 1);
    auto it = std::upper_bound(s_frozenRanges.begin(), s_frozenRanges.end(), std::make_pair(a, UINTPTR_MAX));
    bool ours = s_trapCap && it != s_frozenRanges.begin() && a < std::prev(it)->second;
    if (!ours) {
        { // not an image page: real crash. Dump a raw backtrace we can atos, then chain.
            ucontext_t* uc = (ucontext_t*)uctx; char line[96]; int n = snprintf(line, sizeof line, "[imagecrash] sig=%d addr=%lx pc=%llx lr=%llx frames:", sig, (unsigned long)a, (unsigned long long)__darwin_arm_thread_state64_get_pc(uc->uc_mcontext->__ss), (unsigned long long)__darwin_arm_thread_state64_get_lr(uc->uc_mcontext->__ss)); write(2, line, n);
            uintptr_t fp = (uintptr_t)__darwin_arm_thread_state64_get_fp(uc->uc_mcontext->__ss);
            for (int k = 0; k < 40 && fp && !(fp & 7); k++) { uintptr_t* f = (uintptr_t*)fp; n = snprintf(line, sizeof line, " %lx", (unsigned long)f[1]); write(2, line, n); if (f[0] <= fp) break; fp = f[0]; }
            write(2, "\n", 1);
        }
        struct sigaction* prev = sig == SIGBUS ? &s_prevBus : &s_prevSegv; if (prev->sa_flags & SA_SIGINFO) prev->sa_sigaction(sig, info, uctx); else if (prev->sa_handler == SIG_DFL || prev->sa_handler == SIG_IGN) { signal(sig, SIG_DFL); raise(sig); } else prev->sa_handler(sig); return; }
    mprotect((void*)page, pg, PROT_READ | PROT_WRITE);
    size_t i = s_trapCount.fetch_add(1);
    if (i < s_trapCap) {
        TrapRec& r = s_trapRecs[i]; r.page = page;
        ucontext_t* uc = (ucontext_t*)uctx; r.pcs[0] = (uintptr_t)__darwin_arm_thread_state64_get_pc(uc->uc_mcontext->__ss); r.pcs[1] = (uintptr_t)__darwin_arm_thread_state64_get_lr(uc->uc_mcontext->__ss);
        uintptr_t fp = (uintptr_t)__darwin_arm_thread_state64_get_fp(uc->uc_mcontext->__ss);
        for (int k = 2; k < 10; k++) { if (!fp || (fp & 7)) { r.pcs[k] = 0; continue; } uintptr_t* f = (uintptr_t*)fp; r.pcs[k] = f[1]; uintptr_t next = f[0]; if (next <= fp) { fp = 0; continue; } fp = next; }
    }
}
static void imageTrapArm()
{
    s_trapCap = 1 << 18; s_trapRecs = (TrapRec*)mmap(nullptr, s_trapCap * sizeof(TrapRec), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
    struct sigaction sa {}; sa.sa_sigaction = imageTrapHandler; sa.sa_flags = SA_SIGINFO | SA_NODEFER; sigemptyset(&sa.sa_mask);
    sigaction(SIGBUS, &sa, &s_prevBus); sigaction(SIGSEGV, &sa, &s_prevSegv);
    size_t n = 0; for (auto& r : s_frozenRanges) { if (!mprotect((void*)r.first, r.second - r.first, PROT_READ)) n += r.second - r.first; }
    fprintf(stderr, "[imagetrap] armed: %.1fMB read-only\n", n / 1048576.0);
}
static void imageTrapReport()
{
    size_t n = std::min(s_trapCount.load(), s_trapCap);
    char path[512]; snprintf(path, sizeof path, "%s/imagetrap.%d.tsv", s_dir ? s_dir : "/tmp", getpid());
    FILE* f = fopen(path, "w"); if (!f) return;
    for (size_t i = 0; i < n; i++) { TrapRec& r = s_trapRecs[i]; fprintf(f, "%lx\t%s", (unsigned long)r.page, pageIn(s_cellPages, r.page) ? "cell" : pageIn(s_payloadPages, r.page) ? "payload" : "other"); for (int k = 0; k < 10; k++) fprintf(f, "%c%lx", k ? ';' : '\t', (unsigned long)r.pcs[k]); fprintf(f, "\n"); }
    fclose(f);
    fprintf(stderr, "[imagetrap] %zu first-write faults recorded (%.1fMB of pages) -> %s\n", n, n * 16384 / 1048576.0, path);
}

static struct termios s_imageTermios; static int s_imageTermiosFd = -1; // lives in __DATA, so it travels inside the image
static uint64_t s_imageOpenFds[16]; // fds 0..1023 open in the build process: the restored process parks /dev/null on them so stale closes are harmless and new fds never alias them
struct ImageFileFd { int fd; int flags; char path[1000]; };
static ImageFileFd s_imageFileFds[32]; static int s_imageFileFdCount = 0; // writable regular files (logs) get reopened O_APPEND at the same fd number
static void imageDump(JSC::VM& vm, const char* path)
{
#if OS(DARWIN)
    JSC::JSLockHolder lock(vm);
    s_imageTermiosFd = -1;
    for (int fd = 0; fd < 3; fd++) if (isatty(fd) && !tcgetattr(fd, &s_imageTermios)) { s_imageTermiosFd = fd; break; }
    memset(s_imageOpenFds, 0, sizeof s_imageOpenFds); s_imageFileFdCount = 0;
    for (int fd = 3; fd < 1024; fd++) {
        if (fcntl(fd, F_GETFD) == -1) continue;
        s_imageOpenFds[fd / 64] |= 1ull << (fd % 64);
        struct stat st; if (s_imageFileFdCount < 32 && !fstat(fd, &st) && S_ISREG(st.st_mode)) {
            ImageFileFd& f = s_imageFileFds[s_imageFileFdCount]; f.fd = fd; f.flags = fcntl(fd, F_GETFL);
            if ((f.flags & O_ACCMODE) != O_RDONLY && fcntl(fd, F_GETPATH, f.path) != -1) s_imageFileFdCount++;
        }
    }
    { // Error objects keep raw StackFrames (CodeBlock pointers) until .stack is first read; resolve them now so nothing in the image points at code we drop or re-link
        JSC::HeapIterationScope scope(vm.heap);
        vm.heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
            if (isJSCellKind(kind)) { if (auto* error = dynamicDowncast<JSC::ErrorInstance>(static_cast<JSC::JSCell*>(heapCell))) error->materializeErrorInfoIfNeeded(vm); }
            return IterationStatus::Continue;
        });
    }
    if (getenv("BUN_IMAGE_DELETE_CODE")) { JSC::sanitizeStackForVM(vm); vm.deleteAllCode(JSC::DeleteAllCodeIfNotCollecting); } // linked CodeBlocks, metadata (value profiles/ICs) and JIT code are per-run hot state; leave them out of the image
    if (getenv("BUN_IMAGE_NOFREEZE")) vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    else vm.heap.freezeCurrentHeapAsImmortalImage(); // GC never writes image blocks again (frozen marks = liveness, side remembered set)
    mi_option_set(mi_option_purge_delay, 0);
    mi_collect(true); // free spans get decommitted so "resident" below means "image payload"
    size_t pg = getpagesize();
    { // page/block index for post-restore dirtymap/diffmap attribution (these vectors travel inside the image)
        s_cellPages.clear(); s_payloadPages.clear(); s_pageSizeClass.clear(); s_liveBlocks.clear();
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            for (uintptr_t a = (uintptr_t)&h->block(); a < (uintptr_t)&h->block() + JSC::MarkedBlock::blockSize; a += pg) s_cellPages.push_back(a);
        });
        mi_heap_visit_blocks(mi_heap_main(), true, recordUsedBlock, &pg);
        std::sort(s_cellPages.begin(), s_cellPages.end());
        std::sort(s_liveBlocks.begin(), s_liveBlocks.end());
        std::sort(s_payloadPages.begin(), s_payloadPages.end());
        s_payloadPages.erase(std::unique(s_payloadPages.begin(), s_payloadPages.end()), s_payloadPages.end());
        std::vector<uintptr_t> tmp; std::set_difference(s_payloadPages.begin(), s_payloadPages.end(), s_cellPages.begin(), s_cellPages.end(), std::back_inserter(tmp)); s_payloadPages.swap(tmp);
        fprintf(stderr, "[image] cellPages=%.1fMB payloadPages=%.1fMB liveMallocBlocks=%zu\n", s_cellPages.size() * pg / 1048576.0, s_payloadPages.size() * pg / 1048576.0, s_liveBlocks.size());
    }
    std::vector<std::pair<uintptr_t, uintptr_t>> freeRanges; // arena slices in no page: free memory, whatever the kernel says about residency
    mi_arenas_visit_free_ranges(mi_heap_main(), [](void* start, size_t size, void* arg) { static_cast<std::vector<std::pair<uintptr_t, uintptr_t>>*>(arg)->push_back({ (uintptr_t)start, (uintptr_t)start + size }); }, &freeRanges);
    std::sort(freeRanges.begin(), freeRanges.end());
    { size_t fb = 0; for (auto& r : freeRanges) fb += r.second - r.first; fprintf(stderr, "[image] arena free ranges: %zu, %.1fMB\n", freeRanges.size(), fb / 1048576.0); }
    auto inFreeRange = [&](uintptr_t a) { auto it = std::upper_bound(freeRanges.begin(), freeRanges.end(), std::make_pair(a, UINTPTR_MAX)); return it != freeRanges.begin() && a < std::prev(it)->second; };
    std::vector<ImageRegion> regions;
    // 1. anonymous writable regions (mimalloc arenas + page map, structure heap, misc JSC/WTF OS allocations); skip stacks & malloc zones & JIT
    {
        mach_vm_address_t addr = 0;
        for (;;) {
            mach_vm_size_t size = 0; vm_region_extended_info_data_t info; mach_msg_type_number_t count = VM_REGION_EXTENDED_INFO_COUNT; mach_port_t objName;
            if (mach_vm_region(mach_task_self(), &addr, &size, VM_REGION_EXTENDED_INFO, (vm_region_info_t)&info, &count, &objName) != KERN_SUCCESS) break;
            bool writable = (info.protection & VM_PROT_WRITE) && !(info.protection & VM_PROT_EXECUTE);
            int tag = info.user_tag;
            bool isStack = tag == VM_MEMORY_STACK; bool isMallocZone = tag >= VM_MEMORY_MALLOC && tag <= VM_MEMORY_MALLOC_NANO; bool isGuard = tag == VM_MEMORY_GUARD || tag == 22 /* VM_RECLAIM ring (kernel) */;
            bool anon = info.external_pager == 0;
            // Only memory we own and place deterministically: mimalloc (tag 240) + Bun bss arenas (hint area >= 0x1f0'0000'0000), JSC OSAllocator regions (tags 63/65).
            // Kernel-placed libSystem regions (OS_ALLOC_ONCE, malloc zones, activity tracing...) belong to the *new* process and must not be overlaid.
            bool ours = tag == 240 || tag == 63 || tag == 65 || (addr >= 0x1f000000000ull && addr < 0x30000000000ull) || (addr >= 0x2e0000000000ull && addr < 0x2f0000000000ull) /* bun bss + mimalloc / WTF OSAllocator hint windows */;
            if (tag == 64 /* JS JIT */ && (info.protection & VM_PROT_EXECUTE) && anon) {
                regions.push_back({ addr, size, 0, ((uint64_t)tag << 8) | 3 }); // reservation, no data
                size_t npages = size / pg; std::vector<int> disp(npages); mach_vm_size_t dispCount = npages;
                if (mach_vm_page_range_query(mach_task_self(), addr, size, (mach_vm_address_t)disp.data(), &dispCount) == KERN_SUCCESS) {
                    for (size_t i = 0; i < dispCount;) {
                        if (!disp[i]) { i++; continue; }
                        size_t j = i; while (j < dispCount && disp[j]) j++;
                        regions.push_back({ addr + i * pg, (j - i) * pg, 0, ((uint64_t)tag << 8) | 2 });
                        i = j;
                    }
                }
                if (getenv("BUN_IMAGE_VERBOSE")) fprintf(stderr, "[image] JIT region %llx+%llx resident=%u dirty=%u\n", (unsigned long long)addr, (unsigned long long)size, info.pages_resident, info.pages_dirtied);
            } else if (ours && writable && anon && !isStack && !isMallocZone && !isGuard && info.share_mode != SM_SHARED && (info.pages_resident > 0 || info.pages_dirtied > 0 || info.pages_swapped_out > 0)) {
                regions.push_back({ addr, size, 0, ((uint64_t)tag << 8) | 4 }); // anonymous reserve, then resident runs as file-backed data
                size_t npages = size / pg; std::vector<int> disp(npages); mach_vm_size_t dispCount = npages;
                if (mach_vm_page_range_query(mach_task_self(), addr, size, (mach_vm_address_t)disp.data(), &dispCount) == KERN_SUCCESS) {
                    auto live = [&](size_t k) { return disp[k] && !inFreeRange(addr + k * pg); }; // purged spans can still read as present; mimalloc knows they are free
                    for (size_t i = 0; i < dispCount;) {
                        if (!live(i)) { i++; continue; }
                        size_t j = i; while (j < dispCount && live(j)) j++;
                        regions.push_back({ addr + i * pg, (j - i) * pg, 0, (uint64_t)tag << 8 });
                        i = j;
                    }
                } else regions.back().kind = (uint64_t)tag << 8;
                if (getenv("BUN_IMAGE_VERBOSE")) fprintf(stderr, "[image] region %llx+%llx tag=%d prot=%x/%x share=%d resident=%u dirty=%u\n", (unsigned long long)addr, (unsigned long long)size, tag, info.protection, 0, info.share_mode, info.pages_resident, info.pages_dirtied);
            }
            addr += size;
        }
    }
    // 2. main binary __DATA* segments (globals of Bun/JSC/WTF/mimalloc)
    const struct mach_header_64* mh = (const struct mach_header_64*)_dyld_get_image_header(0);
    for (const char* seg : { "__DATA_CONST", "__DATA", "__DATA_DIRTY", "__AUTH", "__AUTH_CONST" }) {
        unsigned long segSize = 0; uint8_t* segData = getsegmentdata(mh, seg, &segSize);
        if (segData && segSize) regions.push_back({ (uint64_t)segData, (uint64_t)((segSize + pg - 1) & ~(pg - 1)), 0, 1 });
    }
    // drop anon regions overlapping __DATA entries (region scan sees them as file-backed anyway) and our own stack
    uintptr_t sp = (uintptr_t)__builtin_frame_address(0);
    std::vector<ImageRegion> out;
    for (auto& r : regions) { if (r.kind == 0 && sp >= r.addr && sp < r.addr + r.len) continue; out.push_back(r); }
    int fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) { fprintf(stderr, "[image] open %s failed\n", path); return; }
    ImageHeader hdr {}; memcpy(hdr.magic, "BUNIMG0", 8);
    hdr.textBase = (uint64_t)mh; hdr.vm = (uint64_t)&vm;
    hdr.globalObject = (uint64_t)defaultGlobalObject();
    hdr.mainThread = (uint64_t)&WTF::Thread::currentSingleton();
    hdr.reserved[0] = (uint64_t)mi_theap_get_default(); // main thread's mimalloc theap (TLS-referenced, lives in the heap)
    hdr.reserved[7] = (uint64_t)uws_get_loop(); // main thread's uWS loop (TLS-referenced)
    { pthread_key_t k = 0; if (!pthread_key_create(&k, nullptr)) { hdr.reserved[1] = (uint64_t)k; pthread_key_delete(k); } } // high-water mark of pthread TLS keys
    { // fds that are the controlling TTY (dup'd stdin/stdout readers): the restoring process recreates them from its own 0/1/2
        struct stat st[3]; bool have[3]; for (int i = 0; i < 3; i++) have[i] = !fstat(i, &st[i]) && S_ISCHR(st[i].st_mode);
        int n = 0;
        for (int fd = 3; fd < 256 && n < 5; fd++) {
            struct stat fs; if (fstat(fd, &fs) || !S_ISCHR(fs.st_mode)) continue;
            int fl = fcntl(fd, F_GETFL); int src = -1;
            for (int i = 0; i < 3; i++) if (have[i] && fs.st_rdev == st[i].st_rdev) { src = ((fl & O_ACCMODE) == O_RDONLY) ? 0 : (i == 0 ? 1 : i); break; }
            if (src < 0) continue;
            hdr.reserved[2 + n++] = ((uint64_t)fd << 16) | ((uint64_t)(fl & 0xffff) << 4) | (uint64_t)(src + 1);
            if (getenv("BUN_IMAGE_VERBOSE")) fprintf(stderr, "[image] tty fd %d (flags %x) <- std%d\n", fd, fl, src);
        }
    }
    hdr.nregions = out.size();
    size_t tableOff = sizeof(ImageHeader); size_t dataOff = (tableOff + out.size() * sizeof(ImageRegion) + pg - 1) & ~(pg - 1);
    size_t fileOff = dataOff, total = 0;
    for (auto& r : out) { size_t used = ((r.kind & 0xff) == 3 || (r.kind & 0xff) == 4) ? 0 : r.len; r.fileOff = fileOff; fileOff += used; }
    for (auto& r : out) {
        // write region contents; non-resident anon pages read as zero which is what a fresh mapping would give anyway
        size_t used = ((r.kind & 0xff) == 3 || (r.kind & 0xff) == 4) ? 0 : r.len;
        if (pwrite(fd, (void*)r.addr, used, r.fileOff) != (ssize_t)used) { fprintf(stderr, "[image] pwrite failed for %llx+%llx errno %d\n", r.addr, (unsigned long long)used, errno); }
        total += used;
    }
    pwrite(fd, &hdr, sizeof hdr, 0);
    pwrite(fd, out.data(), out.size() * sizeof(ImageRegion), tableOff);
    close(fd);
    fprintf(stderr, "[image] wrote %s: %zu regions, %.1fMB (vm=%p global=%p thread=%p text=%p)\n", path, out.size(), total / 1048576.0, (void*)hdr.vm, (void*)hdr.globalObject, (void*)hdr.mainThread, (void*)hdr.textBase);
#endif
}

// Restore: called from Bun__memdebugInstall (very early in main) when BUN_IMAGE_IN is set. Never returns.
static void imageRestoreAndRun(const char* path)
{
#if OS(DARWIN)
    int fd = open(path, O_RDONLY);
    if (fd < 0) { fprintf(stderr, "[image] cannot open %s\n", path); _exit(2); }
    ImageHeader hdr; pread(fd, &hdr, sizeof hdr, 0);
    const struct mach_header_64* mh = (const struct mach_header_64*)_dyld_get_image_header(0);
    if (memcmp(hdr.magic, "BUNIMG0", 8) || hdr.textBase != (uint64_t)mh) { fprintf(stderr, "[image] bad magic or ASLR slide differs (image text %llx vs ours %p) — run both under noaslr\n", hdr.textBase, mh); _exit(2); }
    mi_scavenger_stop(); // this process's scavenger thread must not touch allocator state while/after we overlay it
    // No heap use from here until the overlay is done: with malloc routed to mimalloc, this process's heap sits at the same VA as the image's.
    if (hdr.nregions > 8192) { fprintf(stderr, "[image] too many regions\n"); _exit(2); }
    ImageRegion* regionsBuf = (ImageRegion*)mmap(nullptr, (hdr.nregions * sizeof(ImageRegion) + 16383) & ~16383ull, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0); // not heap, not __DATA: both get overlaid below
    pread(fd, regionsBuf, hdr.nregions * sizeof(ImageRegion), sizeof(ImageHeader));
    std::span<ImageRegion> regions(regionsBuf, hdr.nregions);
    size_t mapped = 0, copied = 0;
    bool verbose = !!getenv("BUN_IMAGE_VERBOSE");
    for (auto& r : regions) {
        if (verbose) { fprintf(stderr, "[image] restoring %llx+%llx kind=%llu tag=%llu\n", r.addr, r.len, r.kind & 0xff, r.kind >> 8); }
        if ((r.kind & 0xff) == 3) {
            void* m = mmap((void*)r.addr, r.len, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANON | MAP_JIT, -1, 0); // MAP_JIT|MAP_FIXED is EINVAL; rely on the hint
            if (m != (void*)r.addr) { fprintf(stderr, "[image] mmap JIT %llx+%llx landed at %p errno %d\n", r.addr, r.len, m, errno); _exit(3); }
            continue;
        }
        if ((r.kind & 0xff) == 2) {
            void* buf = mmap(nullptr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
            if (pread(fd, buf, r.len, r.fileOff) != (ssize_t)r.len) { fprintf(stderr, "[image] pread JIT failed errno %d\n", errno); _exit(3); }
            pthread_jit_write_protect_np(0); memcpy((void*)r.addr, buf, r.len); pthread_jit_write_protect_np(1);
            munmap(buf, r.len);
            sys_icache_invalidate((void*)r.addr, r.len);
            copied += r.len;
            continue;
        }
        if ((r.kind & 0xff) == 4) {
            mach_vm_deallocate(mach_task_self(), r.addr, r.len);
            void* m = mmap((void*)r.addr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON | MAP_FIXED, -1, 0);
            if (m == MAP_FAILED) { fprintf(stderr, "[image] mmap reserve %llx+%llx failed errno %d\n", r.addr, r.len, errno); _exit(3); }
            continue;
        }
        if ((r.kind & 0xff) == 1) {
            // __DATA of the running binary: make writable and copy (mmap over a segment mapping also works but keep it simple)
            if (mprotect((void*)r.addr, r.len, PROT_READ | PROT_WRITE)) { fprintf(stderr, "[image] mprotect __DATA %llx failed errno %d\n", r.addr, errno); _exit(3); }
            if (pread(fd, (void*)r.addr, r.len, r.fileOff) != (ssize_t)r.len) { fprintf(stderr, "[image] pread __DATA failed errno %d\n", errno); _exit(3); } copied += r.len;
        } else {
            void* m = mmap((void*)r.addr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, r.fileOff);
            if (m == MAP_FAILED) {
                // e.g. a reservation with restrictive max_prot already sits there: deallocate the range and retry
                int e1 = errno;
                mach_vm_deallocate(mach_task_self(), r.addr, r.len);
                m = mmap((void*)r.addr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, r.fileOff);
                if (m == MAP_FAILED) { fprintf(stderr, "[image] mmap %llx+%llx (tag %llu) failed errno %d then %d — skipping\n", r.addr, r.len, r.kind >> 8, e1, errno); continue; }
            }
            mapped += r.len;
        }
    }
    // Re-seat allocator TLS: this thread's default theap must be the image's main theap, not whatever this process created before the overlay.
    if (hdr.reserved[0]) mi_theap_set_default((mi_theap_t*)hdr.reserved[0]);
    _mi_scavenger_forked_child(); // same situation as a fork child: the image says a scavenger runs, but no such thread exists here
    { // park /dev/null on every fd number the image thinks it owns (the image file fd itself gets moved out of the way first)
        int hi = 1023; while (hi > 2 && !(s_imageOpenFds[hi / 64] & (1ull << (hi % 64)))) hi--;
        if (fd <= hi) { int moved = fcntl(fd, F_DUPFD_CLOEXEC, hi + 1); if (moved >= 0) { close(fd); fd = moved; } }
        for (int i = 0; i < s_imageFileFdCount; i++) { ImageFileFd& f = s_imageFileFds[i]; if (fcntl(f.fd, F_GETFD) != -1) continue; int nfd = open(f.path, (f.flags & ~(O_CREAT | O_TRUNC | O_EXCL)) | O_APPEND | O_CLOEXEC); if (nfd < 0) continue; if (nfd != f.fd) { dup2(nfd, f.fd); close(nfd); } if (verbose) fprintf(stderr, "[image] reopened log fd %d -> %s\n", f.fd, f.path); }
        int devnull = open("/dev/null", O_RDWR | O_CLOEXEC); int parked = 0;
        for (int k = 3; k <= hi; k++) if ((s_imageOpenFds[k / 64] & (1ull << (k % 64))) && fcntl(k, F_GETFD) == -1 && dup2(devnull, k) == k) parked++;
        if (devnull > hi) close(devnull);
        if (verbose) fprintf(stderr, "[image] parked /dev/null on %d stale fd numbers (max %d)\n", parked, hi);
    }
    if (s_imageTermiosFd >= 0 && isatty(s_imageTermiosFd)) tcsetattr(s_imageTermiosFd, TCSANOW, &s_imageTermios); // raw mode etc. as the build process left it
    for (int i = 2; i < 7 && hdr.reserved[i]; i++) { // recreate TTY fds at their old numbers from our own stdio
        int fd = (int)(hdr.reserved[i] >> 16), fl = (int)((hdr.reserved[i] >> 4) & 0xfff), src = (int)(hdr.reserved[i] & 0xf) - 1;
        if (isatty(src) && dup2(src, fd) == fd) { if (fl & O_NONBLOCK) fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK); if (verbose) fprintf(stderr, "[image] dup2(%d, %d)\n", src, fd); }
    }
    { const char* d = getenv("BUN_MEMDEBUG"); s_dir = (d && *d) ? strdup(d) : nullptr; } // globals now hold the build process's env pointers
    if (!getenv("BUN_IMAGE_NOFRESHHEAP")) {
        // Image payload pages are immortal: never free into them (that would dirty a clean file-backed page for allocator metadata) and allocate from fresh pages.
        s_frozenRanges.clear(); s_runs.clear();
        for (auto& r : regions) if ((r.kind & 0xff) == 0) { s_frozenRanges.push_back({ r.addr, r.addr + r.len }); s_runs.push_back({ (uintptr_t)r.addr, (size_t)r.len, (size_t)r.fileOff }); }
        std::sort(s_frozenRanges.begin(), s_frozenRanges.end());
        std::sort(s_runs.begin(), s_runs.end(), [](const FrozenRun& x, const FrozenRun& y) { return x.start < y.start; });
        s_snapFd = fd; // keep the image open so dirtymap/celldiff can diff against it
        mi_free_set_filter(frozenFreeFilter);
        if (hdr.reserved[0]) mi_theap_freeze((mi_theap_t*)hdr.reserved[0]);
        mi_arena_id_t freshArena = 0; mi_heap_t* fresh = nullptr;
        if (!getenv("BUN_IMAGE_NOFRESHARENA") && mi_reserve_os_memory_ex(1ull << 30, false, false, true, &freshArena) == 0) fresh = mi_heap_new_in_arena(freshArena); // post-restore memory never interleaves with (or dirties the bitmaps of) image arenas
        mi_theap_set_default(mi_heap_theap(fresh ? fresh : mi_heap_new()));
    }
    if (getenv("BUN_IMAGE_TRAP")) imageTrapArm();
    else if (getenv("BUN_IMAGE_CRASHBT")) { struct sigaction sa {}; sa.sa_sigaction = imageTrapHandler; sa.sa_flags = SA_SIGINFO | SA_NODEFER; sigemptyset(&sa.sa_mask); sigaction(SIGBUS, &sa, &s_prevBus); sigaction(SIGSEGV, &sa, &s_prevSegv); } // backtrace-only: s_frozenRanges stays as-is but nothing is protected
    // pthread TLS keys created by the build process (WTF::ThreadSpecific etc.) must exist here too, or setspecific silently fails; burn keys up to the image's high-water mark.
    if (hdr.reserved[1]) { for (int i = 0; i < 1024; i++) { pthread_key_t k = 0; if (pthread_key_create(&k, nullptr)) break; if ((uint64_t)k + 1 >= hdr.reserved[1]) break; } }
    fprintf(stderr, "[image] restored %zu regions: %.1fMB mapped clean, %.1fMB __DATA copied\n", regions.size(), mapped / 1048576.0, copied / 1048576.0);
    // From here on all globals/heap are the build process's. Adopt the image's main Thread object for this OS thread.
    WTF::Thread* mainThread = (WTF::Thread*)hdr.mainThread;
    mainThread->adoptCurrentThreadForImage();
    JSC::VM* vm = (JSC::VM*)hdr.vm;
    fprintf(stderr, "[image] thread: image main=%p currentSingleton=%p currentMayBeNull=%p apiLock owner=%p held=%d\n", mainThread, &WTF::Thread::currentSingleton(), WTF::Thread::currentMayBeNull(), vm->apiLock().ownerThread() ? vm->apiLock().ownerThread()->get() : nullptr, (int)vm->apiLock().currentThreadIsHoldingLock());
    JSC::JSGlobalObject* globalObject = (JSC::JSGlobalObject*)hdr.globalObject;
    uws_adopt_loop_for_current_thread((struct us_loop_t*)hdr.reserved[8 - 1]); // main thread's uWS::Loop TLS -> the image's loop object (else uws_get_loop() would make a second loop)
    us_loop_reinit_for_image(uws_get_loop());
    Bun__imageAdoptMainThreadVM();
    { JSC::JSLockHolder lock(*vm); vm->didRestoreFromImage();
      fprintf(stderr, "[image] termination state: request=%d pendingTermException=%d exception=%p trapsNeedTermination=%d\n", (int)vm->hasTerminationRequest(), (int)vm->hasPendingTerminationException(), vm->exceptionForInspection(), (int)vm->traps().needHandling(JSC::VMTraps::NeedTermination));
      if (vm->hasPendingTerminationException() || vm->hasTerminationRequest()) { vm->clearHasTerminationRequest(); { auto scope = DECLARE_TOP_EXCEPTION_SCOPE(*vm); scope.clearException(); } vm->traps().clearTrap(JSC::VMTraps::NeedTermination); fprintf(stderr, "[image] cleared stale termination state\n"); } }
    if (!getenv("BUN_IMAGE_NOEVACUATE")) {
        // Tables that take inserts on every run get fresh storage now, so the inserts don't COW image pages one by one.
        JSC::JSLockHolder lock(*vm);
        { auto& t = vm->atomStringTable()->table(); auto copy = t; t.swap(copy); }
    }
    if (!getenv("BUN_IMAGE_EVAL") || getenv("BUN_IMAGE_EVAL_CONTINUE")) {
        {
            JSC::JSLockHolder lock(*vm);
            NakedPtr<JSC::Exception> exception;
            if (const char* pre = getenv("BUN_IMAGE_EVAL")) { // injected startup code, then continue as normal
                JSC::evaluate(globalObject, JSC::makeSource(WTF::String::fromUTF8(pre), JSC::SourceOrigin {}, JSC::SourceTaintedOrigin::Untainted), JSC::JSValue(), exception);
                if (exception) fprintf(stderr, "[image] eval threw: %s\n", exception->value().toWTFString(globalObject).utf8().data());
                exception = nullptr;
            }
            JSC::evaluate(globalObject, JSC::makeSource("globalThis.__bunImageRestored = true; if (process.env.BUN_IMAGE_TRACE_EXIT) { const oe = process.exit; process.exit = function(c) { require('fs').writeSync(2, '[image] process.exit(' + c + ') from:\\n' + new Error().stack + '\\n'); return oe.call(this, c); }; process.on('exit', c => require('fs').writeSync(2, '[image] exit event ' + c + '\\n')); } if (typeof __onImageRestored === 'function') __onImageRestored();"_s, JSC::SourceOrigin {}, JSC::SourceTaintedOrigin::Untainted), JSC::JSValue(), exception);
            if (exception) fprintf(stderr, "[image] __onImageRestored threw: %s\n", exception->value().toWTFString(globalObject).utf8().data());
        }
        Bun__imageContinueEventLoop(); // never returns
    }
    {
        JSC::JSLockHolder lock(*vm);
        const char* src = getenv("BUN_IMAGE_EVAL") ? getenv("BUN_IMAGE_EVAL") : "typeof __onRestore === 'function' ? String(__onRestore()) : 'no __onRestore; keys=' + Object.keys(globalThis).length";
        NakedPtr<JSC::Exception> exception;
        JSC::JSValue result = JSC::evaluate(globalObject, JSC::makeSource(WTF::String::fromUTF8(src), JSC::SourceOrigin {}, JSC::SourceTaintedOrigin::Untainted), JSC::JSValue(), exception);
        if (exception) {
            fprintf(stderr, "[image] eval threw: %s\n", exception->value().toWTFString(globalObject).utf8().data());
        } else {
            fprintf(stderr, "[image] eval => %s\n", result.toWTFString(globalObject).utf8().data());
        }
    }
    _exit(0);
#endif
}

extern "C" void Bun__memdebugMaybeDump(JSC::VM* vm)
{
    int req = s_requested.exchange(0);
    if (!s_dir)
        return;
    if (const char* at = getenv("BUN_IMAGE_OUT_AT_MS")) {
        static bool doneImg = false;
        static auto startImg = std::chrono::steady_clock::now();
        if (!doneImg && std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startImg).count() > atoi(at)) { doneImg = true; req = 8; }
    }
    if (const char* at = getenv("BUN_FILESNAP_AT_MS")) {
        static bool done = false;
        static auto start = std::chrono::steady_clock::now();
        if (!done && std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count() > atoi(at)) {
            done = true;
            req = 4;
        }
    }
    if (!req) {
        std::string cmdPath = std::string(s_dir) + "/cmd." + std::to_string(getpid());
        FILE* cf = fopen(cmdPath.c_str(), "r");
        if (!cf)
            return;
        char buf[32] = { 0 };
        fgets(buf, sizeof(buf), cf);
        fclose(cf);
        unlink(cmdPath.c_str());
        if (!strncmp(buf, "filesnap", 8)) req = 4;
        else if (!strncmp(buf, "dirtymap", 8)) req = 5;
        else if (!strncmp(buf, "reclean", 7)) req = 6;
        else if (!strncmp(buf, "cellprofile", 11)) req = 7;
        else if (!strncmp(buf, "imagedump", 9)) req = 8;
        else if (!strncmp(buf, "trapreport", 10)) req = 9;
        else if (!strncmp(buf, "shrink", 6)) req = 3;
        else if (!strncmp(buf, "gc", 2)) req = 2;
        else req = 1;
    }
    s_seq++;
    if (req == 4) {
        fileSnapshotHeap(*vm);
        return;
    }
    if (req == 5) {
        dumpDirtyMap(*vm);
        return;
    }
    if (req == 6) {
        recleanFrozenPages(*vm);
        return;
    }
    if (req == 7) {
        s_recordProfile = true;
        dumpDirtyMap(*vm);
        s_recordProfile = false;
        return;
    }
    if (req == 9) { imageTrapReport(); return; }
    if (req == 8) {
        Bun__requestSnapshot(vm, getenv("BUN_IMAGE_OUT") ? getenv("BUN_IMAGE_OUT") : "/tmp/bun.img"); // unwinds JS via termination; the run loop takes it at top level and exits
        return;
    }
    if (req == 3) {
        JSC::JSLockHolder lock(*vm);
        JSC::sanitizeStackForVM(*vm);
        vm->deleteAllCode(JSC::DeleteAllCodeIfNotCollecting);
        vm->heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
        WTF::releaseFastMallocFreeMemory();
        mi_collect(true);
        fprintf(stderr, "[memdebug] deleteAllCode + full GC done\n");
    }
    if (req == 2) {
        JSC::JSLockHolder lock(*vm);
        vm->heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
        WTF::releaseFastMallocFreeMemory();
        mi_collect(true);
        fprintf(stderr, "[memdebug] full GC done\n");
    }
    std::string base = std::string(s_dir) + "/memdebug." + std::to_string(getpid()) + "." + std::to_string(s_seq);
    mi_prof_dump_to_file((base + ".mi.pb").c_str());
    mi_heap_snapshot_to_file((base + ".mi.snap").c_str(), 1);
    {
        FILE* f = fopen((base + ".mi.stats.txt").c_str(), "w");
        if (f) {
            mi_stats_print_out([](const char* msg, void* arg) { fputs(msg, static_cast<FILE*>(arg)); }, f);
            fclose(f);
        }
    }
    {
        FILE* f = fopen((base + ".jsc.tsv").c_str(), "w");
        if (f) {
            dumpJSCHeap(*vm, f);
            fclose(f);
        }
    }
    fprintf(stderr, "[memdebug] wrote %s.* (filteredFrees=%zu)\n", base.c_str(), s_filteredFrees.load());
#if OS(DARWIN)
    if (const char* adv = getenv("BUN_MEMDEBUG_MADV")) {
        uint64_t* lenPtr = Bun__getStandaloneModuleGraphMachoLength();
        if (lenPtr) {
            uint64_t len = *lenPtr;
            uintptr_t start = reinterpret_cast<uintptr_t>(lenPtr);
            size_t pg = getpagesize();
            uintptr_t alignedStart = (start + pg - 1) & ~(pg - 1);
            uintptr_t end = (start + 8 + len) & ~(pg - 1);
            int rc = madvise(reinterpret_cast<void*>(alignedStart), end - alignedStart, atoi(adv));
            fprintf(stderr, "[memdebug] madvise(%p, %zu, %d) = %d errno=%d\n", (void*)alignedStart, (size_t)(end - alignedStart), atoi(adv), rc, errno);
        }
    }
#endif
}
