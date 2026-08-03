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
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/SourceProvider.h>
#include <vector>
#include <algorithm>
#include <string>
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

extern "C" void Bun__memdebugMaybeDump(JSC::VM* vm)
{
    int req = s_requested.exchange(0);
    if (!s_dir)
        return;
    if (!req) {
        std::string cmdPath = std::string(s_dir) + "/cmd." + std::to_string(getpid());
        FILE* cf = fopen(cmdPath.c_str(), "r");
        if (!cf)
            return;
        char buf[32] = { 0 };
        fgets(buf, sizeof(buf), cf);
        fclose(cf);
        unlink(cmdPath.c_str());
        if (!strncmp(buf, "shrink", 6)) req = 3;
        else if (!strncmp(buf, "gc", 2)) req = 2;
        else req = 1;
    }
    s_seq++;
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
