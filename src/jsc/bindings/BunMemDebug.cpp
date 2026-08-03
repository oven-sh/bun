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
#include <mimalloc.h>
static std::vector<std::pair<uintptr_t, uintptr_t>> s_frozenRanges; // sorted [start,end)
static std::vector<uintptr_t> s_payloadPages; // sorted OS pages that held live malloc blocks (main heap) at freeze
static std::vector<uintptr_t> s_cellPages; // sorted OS pages inside MarkedBlocks at freeze
static bool recordUsedBlock(const mi_heap_t*, const mi_heap_area_t*, void* block, size_t block_size, void* arg)
{
    if (!block) return true;
    size_t pg = *static_cast<size_t*>(arg);
    for (uintptr_t a = reinterpret_cast<uintptr_t>(block) & ~(pg - 1); a < reinterpret_cast<uintptr_t>(block) + block_size; a += pg)
        s_payloadPages.push_back(a);
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
        s_cellPages.clear(); s_payloadPages.clear();
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            for (uintptr_t a = (uintptr_t)&h->block(); a < (uintptr_t)&h->block() + JSC::MarkedBlock::blockSize; a += pg) s_cellPages.push_back(a);
        });
        mi_heap_visit_blocks(mi_heap_main(), true, recordUsedBlock, &pg);
        std::sort(s_cellPages.begin(), s_cellPages.end());
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
            else { remapped += len; runs++; s_frozenRanges.push_back({ a, a + len }); }
            fileOff += len;
            i = j;
        }
    }
    if (freeze && !getenv("BUN_FILESNAP_NOMI")) {
        std::sort(s_frozenRanges.begin(), s_frozenRanges.end());
        mi_free_set_filter(frozenFreeFilter);
        mi_theap_set_default(mi_heap_theap(mi_heap_new())); // main thread allocates from fresh pages from now on
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
            if (key == "<malloc/other>" && pageIn(s_payloadPages, a)) key = "<malloc payload>";
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
