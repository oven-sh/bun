#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1 // dl_iterate_phdr / dl_phdr_info (Linux)
#endif
#include "root.h"
#include "StartupSnapshot.h"
#if BUN_STARTUP_SNAPSHOT_TOOLING && BUN_STARTUP_SNAPSHOT_SUPPORTED
#include <wtf/CryptographicallyRandomNumber.h>

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/ExecutableAllocator.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <wtf/text/AtomStringTable.h>
#include <wtf/RefCounted.h>
#include <JavaScriptCore/VMInlines.h>
#include <JavaScriptCore/StackAlignment.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/UnlinkedCodeBlock.h>
#include <JavaScriptCore/UnlinkedMetadataTableInlines.h>
#include <JavaScriptCore/MarkedBlockInlines.h>
#include <JavaScriptCore/BlockDirectoryInlines.h>
#include <JavaScriptCore/Subspace.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ButterflyInlines.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/SourceProvider.h>
#include <vector>
#include <unordered_map>
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
#include <sys/sysctl.h>
#include <crt_externs.h>
#include <spawn.h>
#include <termios.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <sys/ucontext.h>
#include <signal.h>
#include <libkern/OSCacheControl.h>
#include <pthread.h>
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
#include <uuid/uuid.h>
#include <mach-o/loader.h>
#include <mach-o/getsect.h>
#include <pthread.h>
#include <wtf/Threading.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/MachineStackMarker.h>
#endif
#if OS(LINUX)
#include <sys/personality.h>
#include <sys/auxv.h>
#include <link.h>
#include <elf.h>
#include <dirent.h>
#include <ucontext.h>
#endif
#ifndef MAP_JIT
#define MAP_JIT 0
#endif
#include <JavaScriptCore/Completion.h>
#include <zstd.h>
#include <dlfcn.h>
#include <hwy/targets.h>
#include "wtf/SIMDUTF.h"
#pragma clang diagnostic ignored "-Wformat" // uint64_t is unsigned long on Linux, unsigned long long on Darwin; this file prints a lot of addresses
#include <signal.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>
#if OS(DARWIN)
extern "C" uint64_t* Bun__getStandaloneModuleGraphMachoLength();
#endif

extern "C" int mi_prof_dump_to_file(const char*) noexcept;
extern "C" void mi_prof_enable(size_t) noexcept;
extern "C" void mi_on_thread_idle(void) noexcept;
extern "C" void mi_purge_holes_report(void) noexcept;
typedef void(mi_output_fun)(const char* msg, void* arg);
extern "C" void mi_stats_print_out(mi_output_fun* out, void* arg) noexcept;
extern "C" void mi_arenas_print(void) noexcept;
extern "C" void mi_collect(bool force) noexcept;
extern "C" size_t mi_usable_size(const void*) noexcept;
extern "C" int mi_heap_snapshot_to_file(const char* path, unsigned flags) noexcept;
extern "C" void mi_arenas_freeze_pages() noexcept;
extern "C" void mi_prof_visit_live(bool (*cb)(uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg), void* arg) noexcept;
#include <mimalloc.h>
#include "ZigGlobalObject.h"
using namespace Bun::StartupSnapshot;
extern "C" void Bun__requestSnapshot(JSC::VM*, const char* path);

static std::vector<uintptr_t> s_payloadPages; // sorted OS pages that held live malloc blocks (main heap) at freeze
static std::map<uintptr_t, uint32_t> s_pageSizeClass; // page -> block size of (first) live block seen
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
static std::atomic<int> s_requested { 0 };
static const char* s_dir = nullptr;
static int s_seq = 0;

static void memdebugSignal(int sig)
{
    s_requested.store(sig == SIGXCPU ? 3 :
#ifdef SIGINFO
            sig == SIGINFO ? 2
                           :
#endif
                           1);
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
            size_t ms = md.sizeInBytesForGC();
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
        struct DirStat {
            size_t blocks { 0 };
            size_t liveCells { 0 };
            size_t liveBytes { 0 };
            size_t emptyBlocks { 0 };
            size_t hist[11] {};
        };
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
            for (int i = 0; i < 11; i++)
                fprintf(f, "%zu%s", d.hist[i], i < 10 ? "," : "\n");
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
                size_t hist[8] = { 0 };
                size_t histBytes[8] = { 0 };
                heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
                    if (!isJSCellKind(kind))
                        return IterationStatus::Continue;
                    auto* cell = static_cast<JSC::JSCell*>(heapCell);
                    if (!cell->isString())
                        return IterationStatus::Continue;
                    auto* str = static_cast<JSC::JSString*>(cell);
                    total++;
                    if (str->isRope()) {
                        ropes++;
                        ropeBytes += str->length();
                        return IterationStatus::Continue;
                    }
                    WTF::StringImpl* impl = str->tryGetValueImpl();
                    if (!impl) return IterationStatus::Continue;
                    size_t bytes = impl->length() * (impl->is8Bit() ? 1 : 2);
                    totalBytes += bytes;
                    if (impl->isAtom()) {
                        atoms++;
                        atomBytes += bytes;
                    }
                    if (impl->isSymbol()) symbols++;
                    if (impl->bufferOwnership() == WTF::StringImpl::BufferSubstring) substrings++;
                    int b = bytes < 16 ? 0 : bytes < 64 ? 1
                        : bytes < 256                   ? 2
                        : bytes < 1024                  ? 3
                        : bytes < 4096                  ? 4
                        : bytes < 65536                 ? 5
                        : bytes < 1048576               ? 6
                                                        : 7;
                    hist[b]++;
                    histBytes[b] += bytes;
                    std::string key = impl->is8Bit() ? std::string(reinterpret_cast<const char*>(impl->span8().data()), std::min<size_t>(impl->length(), 120)) : std::string(WTF::String(impl).utf8().data()).substr(0, 120);
                    auto& e = byContent[key];
                    e.first++;
                    e.second += bytes;
                    return IterationStatus::Continue;
                });
                FILE* ff = fopen(strDump, "w");
                if (ff) {
                    fprintf(ff, "#total\t%zu\tresolvedBytes\t%zu\tropes\t%zu\tropeChars\t%zu\tatoms\t%zu\tatomBytes\t%zu\tsymbols\t%zu\tsubstrings\t%zu\n", total, totalBytes, ropes, ropeBytes, atoms, atomBytes, symbols, substrings);
                    const char* names[8] = { "<16", "16-64", "64-256", "256-1K", "1K-4K", "4K-64K", "64K-1M", ">1M" };
                    for (int i = 0; i < 8; i++)
                        fprintf(ff, "#hist\t%s\t%zu\t%zu\n", names[i], hist[i], histBytes[i]);
                    std::vector<std::pair<size_t, std::string>> dups;
                    size_t dupWaste = 0;
                    for (auto& [k, v] : byContent)
                        if (v.first > 1) {
                            size_t waste = v.second - v.second / v.first;
                            dupWaste += waste;
                            dups.push_back({ waste, std::to_string(v.first) + "\t" + std::to_string(v.second) + "\t" + k });
                        }
                    fprintf(ff, "#duplicateWasteBytes\t%zu\n", dupWaste);
                    std::sort(dups.begin(), dups.end(), std::greater<>());
                    for (size_t i = 0; i < std::min<size_t>(dups.size(), 300); i++) {
                        std::string line = dups[i].second;
                        for (auto& ch : line)
                            if (ch == '\n' || ch == '\r') ch = ' ';
                        fprintf(ff, "%zu\t%s\n", dups[i].first, line.c_str());
                    }
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
                    if (fn->inherits<JSC::JSBoundFunction>()) {
                        boundFns++;
                        return IterationStatus::Continue;
                    }
                    auto* fe = fn->jsExecutable();
                    if (!fe || fn->isHostFunction()) {
                        hostFns++;
                        return IterationStatus::Continue;
                    }
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

static void fileSnapshotHeap(JSC::VM& vm)
{
    JSC::JSLockHolder lock(vm);
    bool freeze = !getenv("BUN_FILESNAP_NOFREEZE");
    if (freeze)
        vm.heap.freezeCurrentHeapAsImmortalStartupSnapshot();
    else
        vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    mi_collect(true);
    size_t pg = getpagesize();
    bool onlyLive = !getenv("BUN_FILESNAP_ALL");
    {
        s_cellPages.clear();
        s_payloadPages.clear();
        s_pageSizeClass.clear();
        s_liveBlocks.clear();
        snapshotRuns.clear();
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            for (uintptr_t a = (uintptr_t)&h->block(); a < (uintptr_t)&h->block() + JSC::MarkedBlock::blockSize; a += pg)
                s_cellPages.push_back(a);
        });
        mi_heap_visit_blocks(mi_heap_main(), true, recordUsedBlock, &pg);
        std::sort(s_cellPages.begin(), s_cellPages.end());
        std::sort(s_liveBlocks.begin(), s_liveBlocks.end());
        std::sort(s_payloadPages.begin(), s_payloadPages.end());
        s_payloadPages.erase(std::unique(s_payloadPages.begin(), s_payloadPages.end()), s_payloadPages.end());
        // MarkedBlocks are themselves malloc blocks; keep the classes disjoint
        std::vector<uintptr_t> tmp;
        std::set_difference(s_payloadPages.begin(), s_payloadPages.end(), s_cellPages.begin(), s_cellPages.end(), std::back_inserter(tmp));
        s_payloadPages.swap(tmp);
        fprintf(stderr, "[filesnap] cellPages=%.1fMB payloadPages=%.1fMB\n", s_cellPages.size() * pg / 1048576.0, s_payloadPages.size() * pg / 1048576.0);
    }
    struct Range {
        uintptr_t start;
        size_t len;
    };
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
            unsigned long a, b;
            char perms[8];
            unsigned long off;
            char dev[16];
            unsigned long inode;
            char path[256] = "";
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
    if (fd < 0) {
        fprintf(stderr, "[filesnap] open failed %d\n", errno);
        return;
    }
    unlink(path);
    size_t fileOff = 0, remapped = 0, runs = 0, skipped = 0;
    std::vector<unsigned char> vec;
    for (auto& r : candidates) {
        if (sp >= r.start && sp < r.start + r.len) {
            skipped++;
            continue;
        } // our own stack
        size_t npages = r.len / pg;
        vec.assign(npages, 0);
#if OS(DARWIN)
        if (mincore((void*)r.start, r.len, (char*)vec.data()) != 0) {
            skipped++;
            continue;
        }
#else
        if (mincore((void*)r.start, r.len, vec.data()) != 0) {
            skipped++;
            continue;
        }
#endif
        auto want = [&](size_t k) { if (!(vec[k] & 1)) return false; if (!onlyLive) return true; uintptr_t a = r.start + k * pg; return pageIn(s_cellPages, a) || pageIn(s_payloadPages, a); };
        size_t i = 0;
        while (i < npages) {
            if (!want(i)) {
                i++;
                continue;
            }
            size_t j = i;
            while (j < npages && want(j))
                j++;
            uintptr_t a = r.start + i * pg;
            size_t len = (j - i) * pg;
            // write pages to file at page-aligned offset, then map that file range back over the same addresses
            if (getenv("BUN_FILESNAP_NOREMAP")) {
                i = j;
                continue;
            }
            if (pwrite(fd, (void*)a, len, fileOff) != (ssize_t)len) {
                fprintf(stderr, "[filesnap] pwrite failed %d\n", errno);
                close(fd);
                return;
            }
            void* m = immap((void*)a, len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, fileOff);
            if (m == MAP_FAILED) {
                fprintf(stderr, "[filesnap] mmap fixed failed at %p len %zu errno %d\n", (void*)a, len, errno);
                skipped++;
            } else {
                remapped += len;
                runs++;
                frozenRanges.push_back({ a, a + len });
                snapshotRuns.push_back({ a, len, fileOff });
            }
            fileOff += len;
            i = j;
        }
    }
    // MarkedBlocks living outside mimalloc regions (e.g. the StructureHeap reservation, JSC-tagged VM) were skipped above; remap them too.
    if (!getenv("BUN_FILESNAP_NOREMAP")) {
        std::sort(frozenRanges.begin(), frozenRanges.end());
        std::vector<uintptr_t> extra;
        vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
            uintptr_t a = (uintptr_t)&h->block();
            auto it = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair(a, UINTPTR_MAX));
            bool covered = it != frozenRanges.begin() && a < std::prev(it)->second;
            if (!covered) extra.push_back(a);
        });
        std::sort(extra.begin(), extra.end());
        size_t i = 0, extraBytes = 0;
        while (i < extra.size()) {
            size_t j = i + 1;
            while (j < extra.size() && extra[j] == extra[j - 1] + JSC::MarkedBlock::blockSize)
                j++;
            uintptr_t a = extra[i];
            size_t len = (j - i) * JSC::MarkedBlock::blockSize;
            if (pwrite(fd, (void*)a, len, fileOff) == (ssize_t)len) {
                void* m = immap((void*)a, len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, fileOff);
                if (m != MAP_FAILED) {
                    remapped += len;
                    runs++;
                    extraBytes += len;
                    frozenRanges.push_back({ a, a + len });
                    snapshotRuns.push_back({ a, len, fileOff });
                }
                fileOff += len;
            }
            i = j;
        }
        fprintf(stderr, "[filesnap] additionally remapped %.1fMB of MarkedBlocks outside malloc regions\n", extraBytes / 1048576.0);
    }
    if (freeze && !getenv("BUN_FILESNAP_NOMI")) {
        std::sort(frozenRanges.begin(), frozenRanges.end());
        mi_arenas_freeze_pages();
        mi_theap_set_default(mi_heap_theap(mi_heap_new())); // main thread allocates from fresh pages from now on
        size_t inFrozen = 0;
        for (int k = 0; k < 64; k++) {
            void* probe = mi_malloc(48 + k * 16);
            uintptr_t a = (uintptr_t)probe;
            auto it = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair(a, UINTPTR_MAX));
            if (it != frozenRanges.begin() && a < std::prev(it)->second) inFrozen++;
        }
        void* probe2 = WTF::fastMalloc(100);
        uintptr_t a2 = (uintptr_t)probe2;
        auto it2 = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair(a2, UINTPTR_MAX));
        bool f2 = it2 != frozenRanges.begin() && a2 < std::prev(it2)->second;
        fprintf(stderr, "[filesnap] post-switch probes landing in frozen ranges: mi_malloc %zu/64, fastMalloc %d\n", inFrozen, (int)f2);
    }
    std::sort(snapshotRuns.begin(), snapshotRuns.end(), [](const FrozenRun& x, const FrozenRun& y) { return x.start < y.start; });
    std::sort(frozenRanges.begin(), frozenRanges.end());
    snapshotFd = fd;
    if (const char* prot = getenv("BUN_FILESNAP_PROTECT")) {
        // Debug: make snapshot blocks of one subspace read-only so the first writer faults with a backtrace.
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
    for (auto& r : frozenRanges) {
        size_t n = (r.second - r.first) / pg;
        disp.assign(n, 0);
        mach_vm_size_t cnt = n;
        if (mach_vm_page_range_query(mach_task_self(), r.first, r.second - r.first, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS)
            continue;
        for (size_t i = 0; i < n; i++) {
            uintptr_t a = r.first + i * pg;
            bool dirty = (disp[i] & VM_PAGE_QUERY_PAGE_DIRTY) || (disp[i] & VM_PAGE_QUERY_PAGE_COPIED);
            totalPages++;
            if (dirty) dirtyPages++;
            auto it = blocks.upper_bound(a);
            std::string key = "<malloc/other>";
            if (it != blocks.begin()) {
                --it;
                if (a >= it->first && a < it->first + JSC::MarkedBlock::blockSize) key = it->second;
            }
            if (key == "<malloc/other>" && pageIn(s_payloadPages, a)) {
                auto sc = s_pageSizeClass.find(a);
                uint32_t bs = sc == s_pageSizeClass.end() ? 0 : sc->second;
                const char* bucket = bs <= 16 ? "<=16" : bs <= 32 ? "<=32"
                    : bs <= 48                                    ? "<=48"
                    : bs <= 64                                    ? "<=64"
                    : bs <= 96                                    ? "<=96"
                    : bs <= 128                                   ? "<=128"
                    : bs <= 256                                   ? "<=256"
                    : bs <= 512                                   ? "<=512"
                    : bs <= 1024                                  ? "<=1K"
                    : bs <= 4096                                  ? "<=4K"
                    : bs <= 16384                                 ? "<=16K"
                    : bs <= 65536                                 ? "<=64K"
                                                                  : ">64K";
                key = std::string("<malloc payload ") + bucket + ">";
            }
            if (key[0] != '<') {
                blockPages++;
                if (dirty) blockDirty++;
            } else if (dirty)
                otherDirty++;
            auto& e = bySubspace[key];
            e.second++;
            if (dirty) e.first++;
        }
    }
    fprintf(stderr, "[dirtymap] frozen=%.1fMB dirty=%.1fMB | markedBlockPages=%.1fMB dirty=%.1fMB | other=%.1fMB dirty=%.1fMB\n",
        totalPages * pg / 1048576.0, dirtyPages * pg / 1048576.0, blockPages * pg / 1048576.0, blockDirty * pg / 1048576.0, (totalPages - blockPages) * pg / 1048576.0, otherDirty * pg / 1048576.0);
    std::vector<std::pair<size_t, std::string>> rows;
    for (auto& [k, v] : bySubspace) {
        char line[256];
        snprintf(line, sizeof line, "  %-40s dirty %7.2fMB / %7.2fMB (%3.0f%%)", k.c_str(), v.first * pg / 1048576.0, v.second * pg / 1048576.0, v.second ? 100.0 * v.first / v.second : 0.0);
        rows.push_back({ v.first, line });
    }
    std::sort(rows.begin(), rows.end(), std::greater<>());
    for (size_t i = 0; i < std::min<size_t>(rows.size(), 40); i++)
        fprintf(stderr, "%s\n", rows[i].second.c_str());

    // Byte-level diff of dirty malloc-payload pages against the snapshot file: which blocks changed, and how.
    if (snapshotFd >= 0 && !s_liveBlocks.empty()) {
        std::vector<uint8_t> orig(pg);
        size_t changedBytes = 0, dirtyPayloadPages = 0, pagesNoChange = 0;
        std::map<std::string, size_t> blockClass; // classification -> count
        std::map<uint32_t, std::pair<size_t, size_t>> bySize; // block size -> (changedBlocks, changedBytes)
        std::set<uintptr_t> changedBlocks;
        for (auto& run : snapshotRuns) {
            size_t n = run.len / pg;
            disp.assign(n, 0);
            mach_vm_size_t cnt = n;
            if (mach_vm_page_range_query(mach_task_self(), run.start, run.len, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS) continue;
            for (size_t i = 0; i < n; i++) {
                uintptr_t a = run.start + i * pg;
                bool dirty = (disp[i] & VM_PAGE_QUERY_PAGE_DIRTY) || (disp[i] & VM_PAGE_QUERY_PAGE_COPIED);
                if (!dirty || !pageIn(s_payloadPages, a)) continue;
                dirtyPayloadPages++;
                if (ipread(snapshotFd, orig.data(), pg, run.fileOff + i * pg) != (ssize_t)pg) continue;
                const uint8_t* cur = reinterpret_cast<const uint8_t*>(a);
                bool any = false;
                for (size_t off = 0; off < pg; off += 8) {
                    if (!memcmp(cur + off, orig.data() + off, 8)) continue;
                    any = true;
                    changedBytes += 8;
                    // find owning block
                    auto it = std::upper_bound(s_liveBlocks.begin(), s_liveBlocks.end(), std::make_pair(a + off, UINT32_MAX));
                    if (it == s_liveBlocks.begin()) {
                        blockClass["<not in live block (freed-at-freeze space)>"]++;
                        continue;
                    }
                    --it;
                    if (a + off >= it->first + it->second) {
                        blockClass["<not in live block (freed-at-freeze space)>"]++;
                        continue;
                    }
                    if (changedBlocks.insert(it->first).second) {
                        bySize[it->second].first++;
                    }
                    bySize[it->second].second += 8;
                }
                if (!any) pagesNoChange++;
            }
        }
        // classify changed blocks by change shape
        size_t onlyHeader8 = 0, small32 = 0, larger = 0;
        struct SigInfo {
            size_t count = 0;
            std::vector<std::string> examples;
        };
        std::map<std::string, SigInfo> smallSigs;
        for (uintptr_t b : changedBlocks) {
            auto it = std::lower_bound(s_liveBlocks.begin(), s_liveBlocks.end(), std::make_pair(b, 0u));
            uint32_t sz = it->second;
            // re-diff this block
            size_t first = SIZE_MAX, last = 0, cntw = 0;
            for (size_t off = 0; off + 8 <= sz; off += 8) {
                uintptr_t a = b + off;
                uintptr_t page = a & ~(pg - 1);
                // find file offset for page
                auto r = std::upper_bound(snapshotRuns.begin(), snapshotRuns.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r == snapshotRuns.begin()) continue;
                --r;
                if (page >= r->start + r->len) continue;
                uint64_t o;
                if (ipread(snapshotFd, &o, 8, r->fileOff + (a - r->start)) != 8) continue;
                if (memcmp(&o, (void*)a, 8)) {
                    cntw++;
                    if (first == SIZE_MAX) first = off;
                    last = off;
                }
            }
            if (cntw == 1 && first == 0)
                onlyHeader8++;
            else if (cntw <= 4)
                small32++;
            else
                larger++;
            if (cntw <= 4 && first != SIZE_MAX) {
                // signature: size class, first changed offset, before>after of that word
                uintptr_t a = b + first;
                uintptr_t page = a & ~(pg - 1);
                uint64_t before = 0, after = *(uint64_t*)a;
                auto r = std::upper_bound(snapshotRuns.begin(), snapshotRuns.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r != snapshotRuns.begin()) {
                    --r;
                    if (page < r->start + r->len) ipread(snapshotFd, &before, 8, r->fileOff + (a - r->start));
                }
                char sig[160];
                snprintf(sig, sizeof sig, "sz%u +%zu n%zu", sz, first, cntw);
                auto& sc = smallSigs[sig];
                sc.count++;
                if (sc.examples.size() < 3) {
                    char ex[64];
                    snprintf(ex, sizeof ex, "%llx>%llx", (unsigned long long)before, (unsigned long long)after);
                    sc.examples.push_back(ex);
                }
            }
        }
        {
            std::vector<std::pair<size_t, std::string>> ss;
            for (auto& [k, v] : smallSigs) {
                std::string e = k + " x" + std::to_string(v.count) + " [";
                for (auto& x : v.examples)
                    e += x + " ";
                e += "]";
                ss.push_back({ v.count, e });
            }
            std::sort(ss.begin(), ss.end(), std::greater<>());
            fprintf(stderr, "[diffmap] small-change signatures (sizeclass +firstOff nWords xCount [before>after...]):\n");
            for (size_t i = 0; i < std::min<size_t>(ss.size(), 40); i++)
                fprintf(stderr, "    %s\n", ss[i].second.c_str());
        }
        fprintf(stderr, "[diffmap] dirtyPayloadPages=%zu (%.1fMB) pagesWithNoByteChange=%zu changedBytes=%.2fMB changedBlocks=%zu: firstWordOnly=%zu (refcount-like) small(<=4 words)=%zu larger=%zu; strayWrites(outside live blocks)=%zu\n",
            dirtyPayloadPages, dirtyPayloadPages * pg / 1048576.0, pagesNoChange, changedBytes / 1048576.0, changedBlocks.size(), onlyHeader8, small32, larger, blockClass["<not in live block (freed-at-freeze space)>"]);
        std::vector<std::pair<size_t, uint32_t>> sizes;
        for (auto& [sz, v] : bySize)
            sizes.push_back({ v.first, sz });
        std::sort(sizes.begin(), sizes.end(), std::greater<>());
        // Cell-granularity diff over immortal MarkedBlocks: how many cells actually changed vs pages dirtied.
        {
            size_t cellsTotal = 0, cellsChanged = 0, cellsHeaderOnly = 0, bytesInChangedCells = 0, dirtyCellPages = 0, identicalDirtyCellPages = 0;
            size_t coldMissCells = 0, coldMissBytes = 0;
            std::set<uintptr_t> coldMissPages;
            std::map<std::string, size_t> coldByClass;
            std::map<std::string, std::map<size_t, size_t>> offsetHistBy;
            std::map<std::string, size_t> identicalByClass;
            std::map<std::string, std::map<std::string, size_t>> headerPatBy; // high 32 bits of header (indexingType,type,flags,cellState) before>after
            std::map<std::string, std::pair<size_t, size_t>> byClass; // class -> (changed, total)
            auto fileWordAt = [&](uintptr_t a, uint64_t& out) -> bool {
                uintptr_t page = a & ~(pg - 1);
                auto r = std::upper_bound(snapshotRuns.begin(), snapshotRuns.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r == snapshotRuns.begin()) return false;
                --r;
                if (page >= r->start + r->len) return false;
                return ipread(snapshotFd, &out, 8, r->fileOff + (a - r->start)) == 8;
            };
            vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
                if (!h->block().isImmortal()) return;
                // is any page of this block dirty?
                uintptr_t base = (uintptr_t)&h->block();
                disp.assign(JSC::MarkedBlock::blockSize / pg, 0);
                mach_vm_size_t cnt = disp.size();
                if (mach_vm_page_range_query(mach_task_self(), base, JSC::MarkedBlock::blockSize, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS) return;
                bool anyDirty = false;
                for (auto d : disp)
                    if ((d & VM_PAGE_QUERY_PAGE_DIRTY) || (d & VM_PAGE_QUERY_PAGE_COPIED)) {
                        anyDirty = true;
                        dirtyCellPages++;
                    }
                std::string cls = std::string(h->subspace()->name());
                bool blockAnyChange = false;
                h->forEachCell([&](size_t, JSC::HeapCell* cell, JSC::HeapCell::Kind) -> IterationStatus {
                    if (!h->block().isMarkedRaw(cell)) return IterationStatus::Continue;
                    cellsTotal++;
                    byClass[cls].second++;
                    if (!anyDirty) return IterationStatus::Continue;
                    size_t changedWords = 0;
                    bool headerChanged = false;
                    static const char* offCls = getenv("BUN_MEMDEBUG_OFFSETS_FOR");
                    bool trackOff = offCls && (std::string(",") + offCls + ",").find("," + cls + ",") != std::string::npos;
                    for (size_t off = 0; off + 8 <= h->cellSize(); off += 8) {
                        uint64_t o;
                        if (!fileWordAt((uintptr_t)cell + off, o)) break;
                        if (memcmp(&o, (uint8_t*)cell + off, 8)) {
                            changedWords++;
                            if (!off) {
                                headerChanged = true;
                                if (trackOff) {
                                    uint64_t cur;
                                    memcpy(&cur, (uint8_t*)cell, 8);
                                    char buf[64];
                                    snprintf(buf, sizeof buf, "%016llx>%016llx", (unsigned long long)(o & 0xffffffff00000000ull), (unsigned long long)(cur & 0xffffffff00000000ull));
                                    headerPatBy[cls][buf]++;
                                }
                            }
                            if (trackOff) offsetHistBy[cls][off]++;
                        }
                    }
                    if (changedWords) {
                        cellsChanged++;
                        byClass[cls].first++;
                        bytesInChangedCells += h->cellSize();
                        blockAnyChange = true;
                        if (changedWords == 1 && headerChanged) cellsHeaderOnly++;
                        if (s_recordProfile)
                            s_profileCells.insert((uintptr_t)cell);
                        else if (!s_profileCells.empty() && !s_profileCells.count((uintptr_t)cell)) {
                            coldMissCells++;
                            coldMissBytes += h->cellSize();
                            coldMissPages.insert((uintptr_t)cell & ~(pg - 1));
                            coldByClass[cls]++;
                        }
                    }
                    return IterationStatus::Continue;
                });
                if (anyDirty && !blockAnyChange) {
                    size_t nd = 0;
                    for (auto d : disp)
                        if ((d & VM_PAGE_QUERY_PAGE_DIRTY) || (d & VM_PAGE_QUERY_PAGE_COPIED)) nd++;
                    identicalDirtyCellPages += nd;
                    identicalByClass[cls] += nd;
                }
            });
            fprintf(stderr, "[celldiff] immortal live cells=%zu changed=%zu (%.1f%%) headerOnly=%zu bytesOfChangedCells=%.2fMB vs dirtyCellPages=%.2fMB (identical-content dirty pages=%.2fMB) => perfect segregation would dirty ~%.2fMB\n",
                cellsTotal, cellsChanged, cellsTotal ? 100.0 * cellsChanged / cellsTotal : 0.0, cellsHeaderOnly, bytesInChangedCells / 1048576.0, dirtyCellPages * pg / 1048576.0, identicalDirtyCellPages * pg / 1048576.0, bytesInChangedCells / 1048576.0);
            if (s_recordProfile)
                fprintf(stderr, "[cellprofile] recorded %zu changed cells as the hot profile\n", s_profileCells.size());
            else if (!s_profileCells.empty()) {
                fprintf(stderr, "[celldiff] vs profile(%zu hot cells): cells changed that were NOT hot in profile = %zu (%.2fMB of cells, spanning %zu distinct 16K pages = %.2fMB upper bound)\n", s_profileCells.size(), coldMissCells, coldMissBytes / 1048576.0, coldMissPages.size(), coldMissPages.size() * pg / 1048576.0);
                std::vector<std::pair<size_t, std::string>> cm;
                for (auto& [k, v] : coldByClass)
                    cm.push_back({ v, k });
                std::sort(cm.begin(), cm.end(), std::greater<>());
                fprintf(stderr, "    cold misses by class:");
                for (size_t i = 0; i < std::min<size_t>(cm.size(), 10); i++)
                    fprintf(stderr, " %s=%zu", cm[i].second.c_str(), cm[i].first);
                fprintf(stderr, "\n");
            }
            {
                std::vector<std::pair<size_t, std::string>> ib;
                for (auto& [k, v] : identicalByClass)
                    ib.push_back({ v, k });
                std::sort(ib.begin(), ib.end(), std::greater<>());
                fprintf(stderr, "[celldiff] identical-content dirty pages by class:");
                for (size_t i = 0; i < std::min<size_t>(ib.size(), 10); i++)
                    fprintf(stderr, " %s=%.2fMB", ib[i].second.c_str(), ib[i].first * pg / 1048576.0);
                fprintf(stderr, "\n");
            }
            for (auto& [c, hist] : offsetHistBy) {
                fprintf(stderr, "[celldiff] changed word offsets for %s:", c.c_str());
                for (auto& [off, n] : hist)
                    fprintf(stderr, " +%zu:%zu", off, n);
                fprintf(stderr, "\n");
            }
            for (auto& [c, pats] : headerPatBy) {
                fprintf(stderr, "[celldiff] header byte patterns (idxType,type,flags,cellState hi32 before>after) for %s:", c.c_str());
                size_t k = 0;
                for (auto& [pat, n] : pats) {
                    if (k++ < 8) fprintf(stderr, " %s x%zu", pat.c_str(), n);
                }
                fprintf(stderr, "\n");
            }
            std::vector<std::pair<size_t, std::string>> crow;
            for (auto& [k, v] : byClass) {
                char line[200];
                snprintf(line, sizeof line, "    %-36s changed %7zu / %7zu (%3.0f%%)", k.c_str(), v.first, v.second, v.second ? 100.0 * v.first / v.second : 0.0);
                crow.push_back({ v.first, line });
            }
            std::sort(crow.begin(), crow.end(), std::greater<>());
            for (size_t i = 0; i < std::min<size_t>(crow.size(), 18); i++)
                fprintf(stderr, "%s\n", crow[i].second.c_str());
        }
        // Fast path: stacks for just the changed blocks (one pass over samples to index by address; no file reads).
        if (getenv("MIMALLOC_PROF_SAMPLE_RATE")) {
            // No allocation while the profiler lock is held (a sampled malloc under it self-deadlocks): count, preallocate, then copy PODs.
            struct Rec {
                uintptr_t addr;
                uint8_t n;
                uintptr_t frames[14];
            };
            struct Raw {
                Rec* recs;
                size_t cap, n;
            };
            size_t liveCount = 0;
            mi_prof_visit_live([](uintptr_t, size_t, const uintptr_t*, uint8_t, void* arg) -> bool { ++*static_cast<size_t*>(arg); return true; }, &liveCount);
            Raw raw { (Rec*)mmap(nullptr, (liveCount + 1024) * sizeof(Rec), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0), liveCount + 1024, 0 };
            mi_prof_visit_live([](uintptr_t addr, size_t, const uintptr_t* frames, uint8_t nframes, void* arg) -> bool {
                Raw* r = static_cast<Raw*>(arg);
                if (r->n >= r->cap) return false;
                Rec& rec = r->recs[r->n++];
                rec.addr = addr;
                rec.n = std::min<uint8_t>(nframes, 14);
                memcpy(rec.frames, frames, rec.n * sizeof(uintptr_t));
                return true;
            },
                &raw);
            struct Ix {
                std::unordered_map<uintptr_t, const Rec*> byAddr;
            } ix;
            ix.byAddr.reserve(raw.n);
            for (size_t i = 0; i < raw.n; i++)
                ix.byAddr.emplace(raw.recs[i].addr, &raw.recs[i]);
            char path2[512];
            snprintf(path2, sizeof path2, "%s/changed-owners.%d.tsv", s_dir, getpid());
            if (FILE* f2 = fopen(path2, "w")) {
                size_t hit = 0;
                for (uintptr_t b : changedBlocks) {
                    auto it = std::lower_bound(s_liveBlocks.begin(), s_liveBlocks.end(), std::make_pair(b, 0u));
                    uint32_t sz = (it != s_liveBlocks.end() && it->first == b) ? it->second : 0;
                    auto s = ix.byAddr.find(b);
                    if (s == ix.byAddr.end()) continue;
                    hit++;
                    fprintf(f2, "%u\t1\t0\t", sz);
                    for (size_t k = 0; k < s->second->n; k++)
                        fprintf(f2, "%s0x%lx", k ? ";" : "", (unsigned long)s->second->frames[k]);
                    fprintf(f2, "\n");
                }
                fclose(f2);
                fprintf(stderr, "[owners-fast] %zu of %zu changed blocks had samples -> %s\n", hit, changedBlocks.size(), path2);
            }
            munmap(raw.recs, raw.cap * sizeof(Rec));
        }
        // Owners of mutated payload: join live profiler samples with the byte diff.
        if (getenv("MIMALLOC_PROF_SAMPLE_RATE") && getenv("BUN_MEMDEBUG_SLOW_OWNERS")) {
            struct Ctx {
                std::function<bool(uintptr_t, uint64_t&)>* fileWordAt;
                FILE* f;
                size_t n;
                size_t changed;
            };
            std::function<bool(uintptr_t, uint64_t&)> fw = [&](uintptr_t a, uint64_t& out) -> bool {
                uintptr_t page = a & ~(pg - 1);
                auto r = std::upper_bound(snapshotRuns.begin(), snapshotRuns.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                if (r == snapshotRuns.begin()) return false;
                --r;
                if (page >= r->start + r->len) return false;
                return ipread(snapshotFd, &out, 8, r->fileOff + (a - r->start)) == 8;
            };
            char path[512];
            snprintf(path, sizeof path, "%s/payload-owners.%d.tsv", s_dir, getpid());
            Ctx ctx { &fw, fopen(path, "w"), 0, 0 };
            static char obuf[1 << 20];
            if (ctx.f) setvbuf(ctx.f, obuf, _IOFBF, sizeof obuf); // no malloc under the profiler lock (sampled malloc would self-deadlock)
            if (ctx.f) {
                mi_prof_visit_live([](uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg) -> bool {
                    Ctx* c = static_cast<Ctx*>(arg);
                    // only blocks inside the frozen snapshot
                    uint64_t probe;
                    if (!(*c->fileWordAt)(addr, probe)) return true;
                    size_t changedWords = 0, firstOff = SIZE_MAX;
                    static uint8_t fbuf[1 << 16];
                    for (size_t base = 0; base < size; base += sizeof fbuf) {
                        size_t n = std::min(sizeof fbuf, size - base);
                        uintptr_t a0 = addr + base;
                        uintptr_t page = a0 & ~(uintptr_t)(getpagesize() - 1);
                        auto r = std::upper_bound(snapshotRuns.begin(), snapshotRuns.end(), page, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
                        if (r == snapshotRuns.begin()) break;
                        --r;
                        if (a0 >= r->start + r->len) break;
                        n = std::min<size_t>(n, r->start + r->len - a0);
                        if (ipread(snapshotFd, fbuf, n, r->fileOff + (a0 - r->start)) != (ssize_t)n) break;
                        for (size_t off = 0; off + 8 <= n; off += 8)
                            if (memcmp(fbuf + off, (void*)(a0 + off), 8)) {
                                changedWords++;
                                if (firstOff == SIZE_MAX) firstOff = base + off;
                            }
                    }
                    c->n++;
                    if (changedWords) c->changed++;
                    fprintf(c->f, "%zu\t%zu\t%zu\t", size, changedWords, firstOff == SIZE_MAX ? 0 : firstOff);
                    for (uint8_t k = 0; k < nframes && k < 14; k++)
                        fprintf(c->f, "%s0x%lx", k ? ";" : "", (unsigned long)frames[k]);
                    fprintf(c->f, "\n");
                    return true;
                },
                    &ctx);
                fclose(ctx.f);
                fprintf(stderr, "[owners] wrote %s: %zu live sampled snapshot blocks, %zu changed; loadaddr=%p\n", path, ctx.n, ctx.changed, (void*)_dyld_get_image_header(0));
            }
        }
        fprintf(stderr, "[diffmap] changed blocks by block size (count, bytes changed):");
        for (size_t i = 0; i < std::min<size_t>(sizes.size(), 24); i++)
            fprintf(stderr, " %u:%zu/%zuB", sizes[i].second, sizes[i].first, bySize[sizes[i].second].second);
        fprintf(stderr, "\n");
    }
#endif
}

static void dumpUCBCensus(JSC::VM& vm)
{
    JSC::JSLockHolder lock(vm);
    struct Acc {
        size_t n = 0, cell = 0, ins = 0, expr = 0, meta = 0, ident = 0, cst = 0, jt = 0, prof = 0, rare = 0;
    } all, fresh;
    JSC::HeapIterationScope scope(vm.heap);
    vm.heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* cell, JSC::HeapCell::Kind kind) {
        if (!isJSCellKind(kind)) return IterationStatus::Continue;
        auto* ucb = dynamicDowncast<JSC::UnlinkedCodeBlock>(static_cast<JSC::JSCell*>(cell));
        if (!ucb) return IterationStatus::Continue;
        auto c = ucb->componentSizesForCensus();
        bool isNew = cell->isPreciseAllocation() ? !cell->preciseAllocation().isImmortal() : !cell->markedBlock().isImmortal();
        for (Acc* a : { &all, isNew ? &fresh : (Acc*)nullptr }) {
            if (!a) continue;
            a->n++;
            a->cell += cell->cellSize();
            a->ins += c.instructions;
            a->expr += c.expressionInfo;
            a->meta += c.metadata;
            a->ident += c.identifiers;
            a->cst += c.constants;
            a->jt += c.jumpTargets;
            a->prof += c.profiles;
            a->rare += c.rareData;
        }
        return IterationStatus::Continue;
    });
    for (auto [name, a] : { std::pair { "all", all }, std::pair { "new", fresh } }) {
        double M = 1048576.0;
        size_t tot = a.cell + a.ins + a.expr + a.meta + a.ident + a.cst + a.jt + a.prof + a.rare;
        fprintf(stderr, "[ucbcensus] %s: %zu UnlinkedCodeBlocks total=%.2fMB | cell=%.2f instructions=%.2f expressionInfo=%.2f unlinkedMetadata=%.2f identifiers=%.2f constants=%.2f jumpTargets=%.2f profiles=%.2f rareData=%.2f (MB)\n", name, a.n, tot / M, a.cell / M, a.ins / M, a.expr / M, a.meta / M, a.ident / M, a.cst / M, a.jt / M, a.prof / M, a.rare / M);
    }
    // Linked CodeBlocks: cell + MetadataTable + JIT code by tier
    {
        size_t n = 0, cellB = 0, metaB = 0, jitB[8] = { 0 }, jitN[8] = { 0 };
        JSC::HeapIterationScope scope2(vm.heap);
        vm.heap.objectSpace().forEachLiveCell(scope2, [&](JSC::HeapCell* cell, JSC::HeapCell::Kind kind) {
            if (!isJSCellKind(kind)) return IterationStatus::Continue;
            auto* cb = dynamicDowncast<JSC::CodeBlock>(static_cast<JSC::JSCell*>(cell));
            if (!cb) return IterationStatus::Continue;
            n++;
            cellB += cell->cellSize();
            if (auto* mt = cb->metadataTable()) metaB += mt->sizeInBytesForGC();
            if (auto jit = cb->jitCode()) {
                unsigned t = std::min<unsigned>(7, static_cast<unsigned>(jit->jitType()));
                jitN[t]++;
                jitB[t] += jit->size();
            }
            return IterationStatus::Continue;
        });
        double M = 1048576.0;
        fprintf(stderr, "[cbcensus] %zu CodeBlocks: cell=%.2fMB metadataTables=%.2fMB | jit code by JITType index:", n, cellB / M, metaB / M);
        for (int t = 0; t < 8; t++)
            if (jitN[t]) fprintf(stderr, " [%d]=%zux/%.2fMB", t, jitN[t], jitB[t] / M);
        fprintf(stderr, "\n");
    }
}

static void dumpNewPayload(JSC::VM& vm)
{
    JSC::JSLockHolder lock(vm);
    vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    mi_collect(true);
    char path[512];
    snprintf(path, sizeof path, "%s/new-payload.%d.tsv", s_dir ? s_dir : "/tmp", getpid());
    struct Ctx {
        FILE* f;
        size_t n, bytes;
    };
    Ctx ctx { fopen(path, "w"), 0, 0 };
    if (!ctx.f) return;
    static char obuf[1 << 20];
    setvbuf(ctx.f, obuf, _IOFBF, sizeof obuf);
    mi_prof_visit_live([](uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg) -> bool {
        Ctx* c = static_cast<Ctx*>(arg);
        auto it = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair(addr, UINTPTR_MAX));
        if (it != frozenRanges.begin() && addr < std::prev(it)->second) return true; // snapshot block
        c->n++;
        c->bytes += size;
        fprintf(c->f, "%zu\t1\t0\t", size); // same columns as payload-owners.tsv (size, changedWords, firstOff, frames)
        for (uint8_t k = 0; k < nframes && k < 14; k++)
            fprintf(c->f, "%s0x%lx", k ? ";" : "", (unsigned long)frames[k]);
        fprintf(c->f, "\n");
        return true;
    },
        &ctx);
    fclose(ctx.f);
    fprintf(stderr, "[newpayload] %zu live sampled post-restore blocks (each ~%s bytes of allocation volume) -> %s\n", ctx.n, getenv("MIMALLOC_PROF_SAMPLE_RATE") ? getenv("MIMALLOC_PROF_SAMPLE_RATE") : "?", path);
}

static void dumpNewCells(JSC::VM& vm)
{
    JSC::JSLockHolder lock(vm);
    vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    struct E {
        size_t n = 0, bytes = 0;
    };
    std::map<std::string, E> byClass;
    size_t total = 0, totalBytes = 0, mortalBlocks = 0, mortalBlockLive = 0;
    struct D {
        size_t blocks = 0, liveBytes = 0, capBytes = 0, emptyBlocks = 0;
    };
    std::map<std::string, D> byDir;
    vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
        if (h->block().isImmortal()) return;
        mortalBlocks++;
        size_t live = 0;
        h->forEachLiveCell([&](size_t, JSC::HeapCell*, JSC::HeapCell::Kind) { live++; return IterationStatus::Continue; });
        char key[96];
        snprintf(key, sizeof key, "%s/%zu", h->subspace()->name(), h->cellSize());
        auto& d = byDir[key];
        d.blocks++;
        d.liveBytes += live * h->cellSize();
        d.capBytes += h->cellsPerBlock() * h->cellSize();
        if (!live) d.emptyBlocks++;
    });
    JSC::HeapIterationScope scope(vm.heap);
    vm.heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* cell, JSC::HeapCell::Kind kind) {
        bool isNew = cell->isPreciseAllocation() ? !cell->preciseAllocation().isImmortal() : !cell->markedBlock().isImmortal();
        if (!isNew) return IterationStatus::Continue;
        size_t sz = cell->cellSize();
        std::string name = isJSCellKind(kind) ? std::string(static_cast<JSC::JSCell*>(cell)->className()) : std::string("(aux) ") + (cell->isPreciseAllocation() ? "precise" : cell->markedBlock().handle().subspace()->name());
        auto& e = byClass[name];
        e.n++;
        e.bytes += sz;
        total++;
        totalBytes += sz;
        if (!cell->isPreciseAllocation()) mortalBlockLive += sz;
        return IterationStatus::Continue;
    });
    {
        std::vector<std::pair<size_t, std::string>> rows;
        for (auto& [k, d] : byDir) {
            char line[200];
            snprintf(line, sizeof line, "  %-40s blocks=%4zu (%5.2fMB) live=%5.2fMB occupancy=%3.0f%% empty=%zu", k.c_str(), d.blocks, d.blocks * JSC::MarkedBlock::blockSize / 1048576.0, d.liveBytes / 1048576.0, d.capBytes ? 100.0 * d.liveBytes / d.capBytes : 0.0, d.emptyBlocks);
            rows.push_back({ d.blocks, line });
        }
        std::sort(rows.begin(), rows.end(), std::greater<>());
        fprintf(stderr, "[newcells] mortal blocks by directory (subspace/cellSize):\n");
        for (size_t i = 0; i < std::min<size_t>(rows.size(), 25); i++)
            fprintf(stderr, "%s\n", rows[i].second.c_str());
    }
    fprintf(stderr, "[newcells] after full GC: %zu new cells, %.2fMB cell bytes; %zu mortal MarkedBlocks = %.2fMB (%.0f%% live)\n", total, totalBytes / 1048576.0, mortalBlocks, mortalBlocks * JSC::MarkedBlock::blockSize / 1048576.0, mortalBlocks ? 100.0 * mortalBlockLive / (mortalBlocks * JSC::MarkedBlock::blockSize) : 0.0);
    std::vector<std::pair<size_t, std::string>> rows;
    for (auto& [k, e] : byClass) {
        char line[200];
        snprintf(line, sizeof line, "  %-44s %8zu  %8.2fMB", k.c_str(), e.n, e.bytes / 1048576.0);
        rows.push_back({ e.bytes, line });
    }
    std::sort(rows.begin(), rows.end(), std::greater<>());
    for (size_t i = 0; i < std::min<size_t>(rows.size(), 30); i++)
        fprintf(stderr, "%s\n", rows[i].second.c_str());
}

static void dumpMutatedSnapshotObjects(JSC::VM& vm)
{
    JSC::JSLockHolder lock(vm);
    if (snapshotFd < 0 || snapshotRuns.empty()) {
        fprintf(stderr, "[mutated] no snapshot\n");
        return;
    }
    size_t pg = getpagesize();
    auto fileBytesAt = [&](uintptr_t a, void* out, size_t n) -> bool {
        auto r = std::upper_bound(snapshotRuns.begin(), snapshotRuns.end(), a, [](uintptr_t v, const FrozenRun& fr) { return v < fr.start; });
        if (r == snapshotRuns.begin()) return false;
        --r;
        if (a + n > r->start + r->len) return false;
        return ipread(snapshotFd, out, n, r->fileOff + (a - r->start)) == (ssize_t)n;
    };
    struct Agg {
        size_t objects = 0, headerChanged = 0, butterflyPtrChanged = 0, inlineChanged = 0, butterflyContentsChanged = 0;
    };
    std::map<std::string, Agg> byShape;
    size_t scanned = 0, changed = 0;
    std::vector<uint8_t> orig(4096), origBf(4096);
    JSC::HeapIterationScope scope(vm.heap);
    vm.heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
        if (!isJSCellKind(kind)) return IterationStatus::Continue;
        bool immortal = heapCell->isPreciseAllocation() ? heapCell->preciseAllocation().isImmortal() : heapCell->markedBlock().isImmortal();
        if (!immortal) return IterationStatus::Continue;
        JSC::JSCell* cell = static_cast<JSC::JSCell*>(heapCell);
        JSC::JSObject* object = dynamicDowncast<JSC::JSObject>(cell);
        if (!object) return IterationStatus::Continue;
        size_t sz = std::min<size_t>(heapCell->cellSize(), orig.size());
        // quick page-level filter: skip cells on clean pages
#if OS(DARWIN)
        {
            std::vector<int> disp(1);
            mach_vm_size_t cnt = 1;
            if (mach_vm_page_range_query(mach_task_self(), (uintptr_t)cell & ~(pg - 1), pg, (mach_vm_address_t)disp.data(), &cnt) == KERN_SUCCESS && !(disp[0] & (VM_PAGE_QUERY_PAGE_DIRTY | VM_PAGE_QUERY_PAGE_COPIED))) {
                scanned++;
                return IterationStatus::Continue;
            }
        }
#else
        (void)pg;
#endif
        if (!fileBytesAt((uintptr_t)cell, orig.data(), sz)) return IterationStatus::Continue;
        scanned++;
        bool header = memcmp(orig.data(), cell, 8) != 0; // structureID/indexing/type/flags/cellState
        uint64_t oldBf;
        memcpy(&oldBf, orig.data() + 8, 8);
        bool bfPtr = oldBf != *(uint64_t*)((uint8_t*)cell + 8);
        bool inl = sz > 16 && memcmp(orig.data() + 16, (uint8_t*)cell + 16, sz - 16) != 0;
        bool bfContents = false;
        if (JSC::Butterfly* bf = object->butterfly(); bf && !bfPtr) { // same butterfly: did its out-of-line slots / elements change?
            JSC::Structure* st = object->structure();
            size_t pre = st->outOfLineCapacity() * sizeof(JSC::EncodedJSValue) + (JSC::hasIndexedProperties(object->indexingType()) ? sizeof(JSC::IndexingHeader) : 0);
            size_t post = JSC::hasIndexedProperties(object->indexingType()) ? std::min<size_t>(bf->vectorLength(), 256) * sizeof(JSC::EncodedJSValue) : 0;
            uintptr_t base = (uintptr_t)bf - pre;
            size_t n = std::min(pre + post, origBf.size());
            if (fileBytesAt(base, origBf.data(), n)) bfContents = memcmp(origBf.data(), (void*)base, n) != 0;
        }
        if (!(header || bfPtr || inl || bfContents)) return IterationStatus::Continue;
        changed++;
        std::string shape(cell->className().characters());
        shape += " {";
        {
            int k = 0;
            JSC::Structure* st = object->structure();
            st->forEachProperty(vm, [&](const JSC::PropertyTableEntry& e) { if (k < 5) { if (k) shape += ","; auto* u = e.key(); shape += (u && u->is8Bit()) ? std::string((const char*)u->span8().data(), std::min<size_t>(u->length(), 24)) : "?"; } k++; return true; });
            if (k > 5) shape += ",+" + std::to_string(k - 5);
        }
        shape += "}";
        auto& a = byShape[shape];
        a.objects++;
        a.headerChanged += header;
        a.butterflyPtrChanged += bfPtr;
        a.inlineChanged += inl;
        a.butterflyContentsChanged += bfContents;
        return IterationStatus::Continue;
    });
    std::vector<std::pair<size_t, std::string>> rows;
    for (auto& [k, a] : byShape) {
        char line[400];
        snprintf(line, sizeof line, "  %6zu  hdr=%-5zu bfptr=%-5zu inline=%-5zu bfdata=%-5zu  %s", a.objects, a.headerChanged, a.butterflyPtrChanged, a.inlineChanged, a.butterflyContentsChanged, k.c_str());
        rows.push_back({ a.objects, line });
    }
    std::sort(rows.begin(), rows.end(), std::greater<>());
    fprintf(stderr, "[mutated] %zu snapshotted JS objects changed since restore (of %zu compared). By class {first properties}: count, what changed (cell header / butterfly pointer i.e. regrown / inline slots / butterfly contents)\n", changed, scanned);
    for (size_t i = 0; i < std::min<size_t>(rows.size(), 60); i++)
        fprintf(stderr, "%s\n", rows[i].second.c_str());
}

struct TrapRec {
    uintptr_t page;
    uintptr_t pcs[10];
};
static TrapRec* s_trapRecs = nullptr;
static std::atomic<size_t> s_trapCount { 0 };
static size_t s_trapCap = 0;
static struct sigaction s_prevBus, s_prevSegv;

static void snapshotTrapHandler(int sig, siginfo_t* info, void* uctx)
{
    uintptr_t a = (uintptr_t)info->si_addr;
    size_t pg = getpagesize();
    uintptr_t page = a & ~(pg - 1);
    auto it = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair(a, UINTPTR_MAX));
    bool ours = s_trapCap && it != frozenRanges.begin() && a < std::prev(it)->second;
    if (!ours) {
#if OS(DARWIN) && CPU(ARM64)
        { // not a snapshot page: real crash. Dump a raw backtrace we can atos, then chain.
            ucontext_t* uc = (ucontext_t*)uctx;
            char line[96];
            int n = snprintf(line, sizeof line, "[snapshotcrash] sig=%d addr=%lx pc=%llx lr=%llx frames:", sig, (unsigned long)a, (unsigned long long)__darwin_arm_thread_state64_get_pc(uc->uc_mcontext->__ss), (unsigned long long)__darwin_arm_thread_state64_get_lr(uc->uc_mcontext->__ss));
            write(2, line, n);
            uintptr_t fp = (uintptr_t)__darwin_arm_thread_state64_get_fp(uc->uc_mcontext->__ss);
            for (int k = 0; k < 40 && fp && !(fp & 7); k++) {
                uintptr_t* f = (uintptr_t*)fp;
                n = snprintf(line, sizeof line, " %lx", (unsigned long)f[1]);
                write(2, line, n);
                if (f[0] <= fp) break;
                fp = f[0];
            }
            write(2, "\n", 1);
        }
#endif
        struct sigaction* prev = sig == SIGBUS ? &s_prevBus : &s_prevSegv;
        if (prev->sa_flags & SA_SIGINFO)
            prev->sa_sigaction(sig, info, uctx);
        else if (prev->sa_handler == SIG_DFL || prev->sa_handler == SIG_IGN) {
            signal(sig, SIG_DFL);
            raise(sig);
        } else
            prev->sa_handler(sig);
        return;
    }
    mprotect((void*)page, pg, PROT_READ | PROT_WRITE);
    size_t i = s_trapCount.fetch_add(1);
    if (i < s_trapCap) {
        TrapRec& r = s_trapRecs[i];
        r.page = page;
#if OS(DARWIN) && CPU(ARM64)
        ucontext_t* uc = (ucontext_t*)uctx;
        r.pcs[0] = (uintptr_t)__darwin_arm_thread_state64_get_pc(uc->uc_mcontext->__ss);
        r.pcs[1] = (uintptr_t)__darwin_arm_thread_state64_get_lr(uc->uc_mcontext->__ss);
        uintptr_t fp = (uintptr_t)__darwin_arm_thread_state64_get_fp(uc->uc_mcontext->__ss);
        for (int k = 2; k < 10; k++) {
            if (!fp || (fp & 7)) {
                r.pcs[k] = 0;
                continue;
            }
            uintptr_t* f = (uintptr_t*)fp;
            r.pcs[k] = f[1];
            uintptr_t next = f[0];
            if (next <= fp) {
                fp = 0;
                continue;
            }
            fp = next;
        }
#else
        (void)uctx;
        memset(r.pcs, 0, sizeof r.pcs);
#endif
    }
}

static void snapshotTrapArm()
{
    const size_t pg = getpagesize();
    s_trapCap = 1 << 18;
    s_trapRecs = (TrapRec*)mmap(nullptr, s_trapCap * sizeof(TrapRec), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
    struct sigaction sa {};
    sa.sa_sigaction = snapshotTrapHandler;
    sa.sa_flags = SA_SIGINFO | SA_NODEFER;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGBUS, &sa, &s_prevBus);
    sigaction(SIGSEGV, &sa, &s_prevSegv);
    size_t n = 0;
    const char* mode = getenv("BUN_STARTUP_SNAPSHOT_TRAP");
    if (mode && !strcmp(mode, "cells")) { // only MarkedBlock pages: syscalls never target them, so kernel-side EFAULTs can't derail the run
        for (uintptr_t page : s_cellPages)
            if (!mprotect((void*)page, pg, PROT_READ)) n += pg;
    } else
        for (auto& r : frozenRanges) {
            if (!mprotect((void*)r.first, r.second - r.first, PROT_READ)) n += r.second - r.first;
        }
    fprintf(stderr, "[snapshottrap] armed: %.1fMB read-only (%s)\n", n / 1048576.0, mode);
}

static void snapshotTrapReport()
{
    size_t n = std::min(s_trapCount.load(), s_trapCap);
    char path[512];
    snprintf(path, sizeof path, "%s/snapshottrap.%d.tsv", s_dir ? s_dir : "/tmp", getpid());
    FILE* f = fopen(path, "w");
    if (!f) return;
    for (size_t i = 0; i < n; i++) {
        TrapRec& r = s_trapRecs[i];
        fprintf(f, "%lx\t%s", (unsigned long)r.page, pageIn(s_cellPages, r.page) ? "cell" : pageIn(s_payloadPages, r.page) ? "payload"
                                                                                                                           : "other");
        for (int k = 0; k < 10; k++)
            fprintf(f, "%c%lx", k ? ';' : '\t', (unsigned long)r.pcs[k]);
        fprintf(f, "\n");
    }
    fclose(f);
    fprintf(stderr, "[snapshottrap] %zu first-write faults recorded (%.1fMB of pages) -> %s\n", n, n * (size_t)getpagesize() / 1048576.0, path);
}

void startupSnapshotToolingIndexAtFreeze(JSC::VM& vm, size_t pg)
{
    s_cellPages.clear();
    s_payloadPages.clear();
    s_pageSizeClass.clear();
    s_liveBlocks.clear();
    vm.heap.objectSpace().forEachBlock([&](JSC::MarkedBlock::Handle* h) {
        for (uintptr_t a = (uintptr_t)&h->block(); a < (uintptr_t)&h->block() + JSC::MarkedBlock::blockSize; a += pg)
            s_cellPages.push_back(a);
    });
    mi_heap_visit_blocks(mi_heap_main(), true, recordUsedBlock, &pg);
    std::sort(s_cellPages.begin(), s_cellPages.end());
    std::sort(s_liveBlocks.begin(), s_liveBlocks.end());
    std::sort(s_payloadPages.begin(), s_payloadPages.end());
    s_payloadPages.erase(std::unique(s_payloadPages.begin(), s_payloadPages.end()), s_payloadPages.end());
    std::vector<uintptr_t> tmp;
    std::set_difference(s_payloadPages.begin(), s_payloadPages.end(), s_cellPages.begin(), s_cellPages.end(), std::back_inserter(tmp));
    s_payloadPages.swap(tmp);
    fprintf(stderr, "[snapshot] cellPages=%.1fMB payloadPages=%.1fMB liveMallocBlocks=%zu\n", s_cellPages.size() * pg / 1048576.0, s_payloadPages.size() * pg / 1048576.0, s_liveBlocks.size());
}

void startupSnapshotToolingArmTraps()
{
    if (getenv("BUN_STARTUP_SNAPSHOT_TRAP"))
        snapshotTrapArm();
    else if (getenv("BUN_STARTUP_SNAPSHOT_CRASHBT")) {
        struct sigaction sa {};
        sa.sa_sigaction = snapshotTrapHandler;
        sa.sa_flags = SA_SIGINFO | SA_NODEFER;
        sigemptyset(&sa.sa_mask);
        sigaction(SIGBUS, &sa, &s_prevBus);
        sigaction(SIGSEGV, &sa, &s_prevSegv);
    } // backtrace-only: frozenRanges stays as-is but nothing is protected
}

void startupSnapshotToolingAfterRestore()
{
    const char* d = getenv("BUN_MEMDEBUG");
    s_dir = (d && *d) ? strdup(d) : nullptr; // the builder's pointer would point into its environment
    if (s_dir)
        mi_prof_enable(64 * 1024); // the profiler state came from the builder (off); sample what this process allocates so newpayload can attribute it
}

void startupSnapshotToolingInstall()
{
    s_dir = getenv("BUN_MEMDEBUG");
    if (!s_dir || !*s_dir) {
        s_dir = nullptr;
        return;
    }
    signal(SIGUSR1, memdebugSignal);
#ifdef SIGINFO
    signal(SIGINFO, memdebugSignal);
#endif
    signal(SIGXCPU, memdebugSignal);
}

extern "C" void Bun__startupSnapshotToolingTick(JSC::VM* vm)
{
    int req = s_requested.exchange(0);
    bool fromCmdFile = false;
    if (!s_dir)
        return;
    if (const char* at = getenv("BUN_STARTUP_SNAPSHOT_OUT_AT_MS")) {
        static bool doneImg = false;
        static auto startImg = std::chrono::steady_clock::now();
        if (!doneImg && std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startImg).count() > atoi(at)) {
            doneImg = true;
            req = 8;
        }
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
        if (!strncmp(buf, "filesnap", 8))
            req = 4;
        else if (!strncmp(buf, "dirtymap", 8))
            req = 5;
        else if (!strncmp(buf, "reclean", 7))
            req = 6;
        else if (!strncmp(buf, "cellprofile", 11))
            req = 7;
        else if (!strncmp(buf, "snapshot", 8))
            req = 8;
        else if (!strncmp(buf, "trapreport", 10))
            req = 9;
        else if (!strncmp(buf, "newcells", 8))
            req = 10;
        else if (!strncmp(buf, "newpayload", 10))
            req = 11;
        else if (!strncmp(buf, "ucbcensus", 9))
            req = 12;
        else if (!strncmp(buf, "mutated", 7))
            req = 13;
        else if (!strncmp(buf, "shrink", 6))
            req = 3;
        else if (!strncmp(buf, "gc", 2))
            req = 2;
        else
            req = 1;
        fromCmdFile = true;
    }
    s_seq++;
    // Reports also go to <dir>/report.<pid>.txt: a TUI app owns the terminal and stderr text gets lost in its rendering.
    struct StderrTee {
        int saved = -1;
        StderrTee(bool on)
        {
            if (!on || !s_dir) return;
            char p[1200];
            snprintf(p, sizeof p, "%s/report.%d.txt", s_dir, getpid());
            int fd = open(p, O_WRONLY | O_CREAT | O_APPEND, 0644);
            if (fd < 0) return;
            fflush(stderr);
            saved = dup(2);
            dup2(fd, 2);
            close(fd);
        }
        ~StderrTee()
        {
            if (saved < 0) return;
            fflush(stderr);
            dup2(saved, 2);
            close(saved);
        }
    } tee(fromCmdFile);
    if (req == 4) {
        fileSnapshotHeap(*vm);
        return;
    }
    if (req == 5) {
        dumpDirtyMap(*vm);
        return;
    }
    if (req == 6) {
        Bun::StartupSnapshot::recleanFrozenPages(*vm);
        return;
    }
    if (req == 7) {
        s_recordProfile = true;
        dumpDirtyMap(*vm);
        s_recordProfile = false;
        return;
    }
    if (req == 9) {
        snapshotTrapReport();
        return;
    }
    if (req == 10) {
        dumpNewCells(*vm);
        return;
    }
    if (req == 13) {
        dumpMutatedSnapshotObjects(*vm);
        return;
    }
    if (req == 11) {
        dumpNewPayload(*vm);
        return;
    }
    if (req == 12) {
        dumpUCBCensus(*vm);
        return;
    }
    if (req == 8) {
        Bun__requestSnapshot(vm, getenv("BUN_STARTUP_SNAPSHOT_OUT") ? getenv("BUN_STARTUP_SNAPSHOT_OUT") : "/tmp/bun.snapshot"); // unwinds JS via termination; the run loop takes it at top level and exits
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
        fprintf(stderr, "[memdebug] full GC done; purge_delay=%ld purge_decommits=%ld arena_reserve=%ldKiB\n", mi_option_get(mi_option_purge_delay), mi_option_get(mi_option_purge_decommits), mi_option_get(mi_option_arena_reserve));
        mi_arenas_print(); // per-arena slice maps: what the fresh arenas still hold after everything freeable was freed
        { // live bytes outside the snapshot, as mimalloc sees them: the difference to the arenas' dirty pages is fragmentation
            struct Live {
                size_t bytes = 0, blocks = 0, snapshotBytes = 0;
            } live;
            auto visitLive = [](const mi_heap_t*, const mi_heap_area_t*, void* block, size_t size, void* arg) {
                auto* l = static_cast<Live*>(arg);
                if (!block) return true;
                auto it = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair((uintptr_t)block, UINTPTR_MAX));
                if (it != frozenRanges.begin() && (uintptr_t)block < std::prev(it)->second) { l->snapshotBytes += size; return true; }
                l->bytes += size; l->blocks++;
                return true; };
            mi_heap_visit_blocks(mi_heap_main(), true, visitLive, &live);
            if (freshHeap) mi_heap_visit_blocks(freshHeap, true, visitLive, &live);
            fprintf(stderr, "[memdebug] live malloc outside the snapshot (main + fresh heaps): %.1f MB in %zu blocks (snapshot-resident live: %.1f MB)\n", live.bytes / 1048576.0, live.blocks, live.snapshotBytes / 1048576.0);

            { // The residue question: are the fresh arenas' pages empty-but-retained, or sparsely used? Per page (area), outside the snapshot.
                struct Areas {
                    size_t committed[5] = {}, pages[5] = {}; // buckets: 0%, <10%, <25%, <50%, >=50% used
                    std::map<size_t, std::pair<size_t, size_t>> bySize; // block size -> (committed in pages under 25% used, live bytes there)
                    std::map<size_t, std::pair<size_t, size_t>> dirtyBySize; // block size -> (kernel-dirty bytes over all its pages, live bytes)
                    size_t dirtyTotal = 0, liveTotal = 0;
                    std::vector<int> disp;
                } areas;
                auto visitArea = [](const mi_heap_t*, const mi_heap_area_t* area, void*, size_t, void* arg) {
                auto* a = static_cast<Areas*>(arg);
                uintptr_t start = (uintptr_t)area->blocks;
                auto it = std::upper_bound(frozenRanges.begin(), frozenRanges.end(), std::make_pair(start, UINTPTR_MAX));
                if (it != frozenRanges.begin() && start < std::prev(it)->second) return true; // snapshot page
                if (!area->committed) return true;
                size_t live = area->used * area->full_block_size;
#if OS(DARWIN)
                { // what the kernel actually holds for this area: holes the sweep punched are committed to mimalloc but not dirty here
                    const size_t pg = getpagesize();
                    uintptr_t lo = start & ~(pg - 1), hi = (start + area->committed + pg - 1) & ~(pg - 1);
                    a->disp.assign((hi - lo) / pg, 0);
                    mach_vm_size_t n = a->disp.size();
                    if (mach_vm_page_range_query(mach_task_self(), lo, hi - lo, (mach_vm_address_t)a->disp.data(), &n) == KERN_SUCCESS) {
                        size_t dirty = 0;
                        for (size_t k = 0; k < a->disp.size(); k++)
                            if (a->disp[k] & (VM_PAGE_QUERY_PAGE_DIRTY | VM_PAGE_QUERY_PAGE_COPIED)) dirty += pg;
                        auto& d = a->dirtyBySize[area->block_size];
                        d.first += dirty;
                        d.second += live;
                        a->dirtyTotal += dirty;
                        a->liveTotal += live;
                    }
                }
#endif
                double util = (double)live / (double)area->committed;
                int b = area->used == 0 ? 0 : util < 0.10 ? 1 : util < 0.25 ? 2 : util < 0.50 ? 3 : 4;
                a->committed[b] += area->committed;
                a->pages[b]++;
                if (b <= 2) {
                    auto& e = a->bySize[area->block_size];
                    e.first += area->committed;
                    e.second += live;
                }
                return true; };
                mi_heap_visit_blocks(mi_heap_main(), false, visitArea, &areas);
                if (freshHeap) mi_heap_visit_blocks(freshHeap, false, visitArea, &areas);
                static const char* names[5] = { "empty", "<10%", "<25%", "<50%", ">=50%" };
                fprintf(stderr, "[memdebug] fresh pages by utilization:");
                for (int b = 0; b < 5; b++)
                    fprintf(stderr, "  %s: %zu pages / %.1f MB", names[b], areas.pages[b], areas.committed[b] / 1048576.0);
                fprintf(stderr, "\n[memdebug] committed in pages under 25%% used, by block size (committed MB / live MB):\n");
                std::vector<std::pair<size_t, size_t>> order; // committed -> size
                for (auto& [sz, e] : areas.bySize)
                    order.push_back({ e.first, sz });
                std::sort(order.rbegin(), order.rend());
                for (size_t k = 0; k < order.size() && k < 16; k++) {
                    auto& e = areas.bySize[order[k].second];
                    fprintf(stderr, "    %8zu B blocks: %6.1f MB committed, %5.2f MB live\n", order[k].second, e.first / 1048576.0, e.second / 1048576.0);
                }
                fprintf(stderr, "[memdebug] fresh pages, kernel-dirty vs live: %.1f MB dirty, %.1f MB live => %.1f MB slack. Slack by block size:\n", areas.dirtyTotal / 1048576.0, areas.liveTotal / 1048576.0, (areas.dirtyTotal > areas.liveTotal ? areas.dirtyTotal - areas.liveTotal : 0) / 1048576.0);
                std::vector<std::pair<long long, size_t>> slack; // slack bytes -> block size
                for (auto& [sz, d] : areas.dirtyBySize)
                    slack.push_back({ (long long)d.first - (long long)d.second, sz });
                std::sort(slack.rbegin(), slack.rend());
                for (size_t k = 0; k < slack.size() && k < 16; k++) {
                    auto& d = areas.dirtyBySize[slack[k].second];
                    fprintf(stderr, "    %8zu B blocks: %6.1f MB dirty, %6.1f MB live, %6.1f MB slack\n", slack[k].second, d.first / 1048576.0, d.second / 1048576.0, slack[k].first / 1048576.0);
                }
                { // Discriminator: does an explicit idle sweep on this (the JS) thread reclaim anything the census called slack?
                    mi_purge_holes_stats_t before, after;
                    mi_purge_holes_stats_get(&before);
                    auto footprint = []() -> double {
#if !OS(DARWIN)
                        return -1.0;
#else
                        task_vm_info_data_t info;
                        mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
                        return task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) == KERN_SUCCESS ? (double)info.phys_footprint / 1048576.0 : -1.0;
#endif
                    };
                    double fpBefore = footprint();
                    mi_on_thread_idle();
                    double fpAfter = footprint();
                    mi_purge_holes_stats_get(&after);
                    fprintf(stderr, "[memdebug] phys_footprint around the explicit sweep: %.1f -> %.1f MB\n", fpBefore, fpAfter);
                    mi_purge_holes_report();
                    fprintf(stderr, "[memdebug] explicit mi_on_thread_idle() on this thread: discarded %.1f MB more (total discarded now %.1f MB), pages freed %zu -> %zu, ineligible pages %zu\n",
                        ((double)after.purged_bytes_total - (double)before.purged_bytes_total) / 1048576.0, after.purged_bytes / 1048576.0, before.pages_freed, after.pages_freed, after.ineligible_pages);
                }
            }
        }
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
    fprintf(stderr, "[memdebug] wrote %s.*\n", base.c_str());
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
#endif // BUN_STARTUP_SNAPSHOT_TOOLING
