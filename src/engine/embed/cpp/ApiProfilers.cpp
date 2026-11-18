#include "engine/Engine.h"

namespace JSC {

template<typename T> static void appendTo(void* vector, const T* elements, size_t count)
{
    static_cast<Vector<T>*>(vector)->append(std::span { elements, count });
}

Vector<BasicBlockRange> ControlFlowProfiler::basicBlocks(SourceID source, Gaps gaps) const
{
    Vector<BasicBlockRange> blocks;
    Engine::coverage_blocks(vm(), source, gaps == Gaps::With, &blocks, appendTo);
    return blocks;
}

Vector<CodeRange> ControlFlowProfiler::codeRanges(SourceID source) const
{
    Vector<CodeRange> ranges;
    Engine::coverage_code_ranges(vm(), source, &ranges, appendTo);
    return ranges;
}

Vector<Ref<SourceProvider>> ControlFlowProfiler::sourceProviders() const
{
    Vector<Ref<SourceProvider>> providers;
    Engine::coverage_source_providers(vm(), &providers, [](void* providers, SourceProvider* provider) { static_cast<Vector<Ref<SourceProvider>>*>(providers)->append(*provider); });
    return providers;
}

Vector<SamplingProfiler::StackTrace> SamplingProfiler::releaseStackTraces(const DeferGC&)
{
    auto addTrace = [](void* traces, double timestamp, size_t frameCount) {
        StackTrace trace { MonotonicTime::fromRawSeconds(timestamp), {} };
        trace.frames.reserveInitialCapacity(frameCount);
        static_cast<Vector<StackTrace>*>(traces)->append(WTF::move(trace));
    };
    auto addFrame = [](void* traces, StringImpl* name, ExecutableBase* executable, LineColumn* start, LineColumn* position) {
        static_cast<Vector<StackTrace>*>(traces)->last().frames.append({
            name,
            executable,
            start ? static_cast<int>(start->line) : -1,
            start ? start->column : std::numeric_limits<unsigned>::max(),
            position ? std::optional(*position) : std::nullopt,
        });
    };
    Vector<StackTrace> traces;
    Engine::sampling_profiler_release_traces(vm(), &traces, addTrace, addFrame);
    return traces;
}

static TypeCountSet countCells(VM& vm, bool onlyProtected)
{
    TypeCountSet counts;
    Engine::heap_count_cells(vm, onlyProtected, &counts, [](void* counts, const char* name, size_t count) { static_cast<TypeCountSet*>(counts)->add(ASCIILiteral::fromLiteralUnsafe(name), count); });
    return counts;
}

TypeCountSet Heap::objectTypeCounts()
{
    return countCells(vm(), false);
}

TypeCountSet Heap::protectedObjectTypeCounts()
{
    return countCells(vm(), true);
}

} // namespace JSC
