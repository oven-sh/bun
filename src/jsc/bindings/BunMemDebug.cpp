#include "root.h"

#include <JavaScriptCore/VM.h>
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
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
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

extern "C" void Bun__memdebugInstall()
{
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
        }
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
            if (ctx.f) {
                mi_prof_visit_live([](uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg) -> bool {
                    Ctx* c = static_cast<Ctx*>(arg);
                    // only blocks inside the frozen image
                    uint64_t probe; if (!(*c->fileWordAt)(addr, probe)) return true;
                    size_t changedWords = 0, firstOff = SIZE_MAX;
                    for (size_t off = 0; off + 8 <= size; off += 8) { uint64_t o; if (!(*c->fileWordAt)(addr + off, o)) break; if (memcmp(&o, (void*)(addr + off), 8)) { changedWords++; if (firstOff == SIZE_MAX) firstOff = off; } }
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

extern "C" void Bun__memdebugMaybeDump(JSC::VM* vm)
{
    int req = s_requested.exchange(0);
    if (!s_dir)
        return;
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
