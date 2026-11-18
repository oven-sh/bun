#include "ApiFixtures.h"

using namespace JSC;

TEST(ProfilersCoverage)
{
    Test::Realm realm;
    EXPECT(!realm.vm.controlFlowProfiler());
    realm.vm.enableControlFlowProfiler();
    realm.run("function called() { } function other() { } called(); called();"_s);

    auto* profiler = realm.vm.controlFlowProfiler();
    auto providers = profiler->sourceProviders();
    size_t index = providers.findIf([](auto& provider) { return provider->sourceURL() == "test.js"_s; });
    EXPECT(index != notFound);
    SourceID source = providers[index]->asID();
    EXPECT(profiler->basicBlocks(source).containsIf([](auto& block) { return block.m_executionCount == 2 && block.m_hasExecuted; }));
    auto ranges = profiler->codeRanges(source);
    ranges.removeAllMatching([](auto& range) { return range.kind != CodeRange::Kind::Function; });
    EXPECT(ranges.size() == 2);
    EXPECT(ranges[0].start == 0 && ranges[0].end == 20 && ranges[0].hasExecuted);
    EXPECT(ranges[1].start == 22 && !ranges[1].hasExecuted);
}

TEST(ProfilersHeapSnapshots)
{
    Test::Realm realm;
    realm.run("class Kept { } var kept = new Kept; async function f() { }"_s);

    auto& profiler = realm.vm.ensureHeapProfiler();
    HeapSnapshotBuilder builder(profiler);
    builder.buildSnapshot();
    EXPECT(profiler.hasSnapshot());
    EXPECT(builder.json().contains("\"Kept\""_s));
    profiler.clearSnapshots();
    EXPECT(!profiler.hasSnapshot());

    EXPECT(BunV8HeapSnapshotBuilder(profiler).json().contains("\"Kept\""_s));
    EXPECT(String::fromUTF8(BunV8HeapSnapshotBuilder(profiler).jsonBytes().span()).contains("\"Kept\""_s));
    EXPECT(std::ranges::any_of(realm.vm.heap.objectTypeCounts(), [](auto& entry) { return entry.key == "AsyncFunction"_s && entry.value; }));
}

TEST(ProfilersSampling)
{
    Test::Realm realm;
    EXPECT(!realm.vm.samplingProfiler());
    auto& profiler = realm.vm.ensureSamplingProfiler();
    profiler.setTimingInterval(Seconds::fromMicroseconds(100));
    auto start = MonotonicTime::now();
    profiler.start();
    EXPECT(realm.vm.samplingProfiler());
    while (!profiler.topFunctionsReport().contains("'busy#"_s))
        realm.run("\n  function busy() { for (let i = 0; i < 1e5; i++); } busy()"_s);
    profiler.pause();

    DeferGC deferGC(realm.vm);
    auto traces = profiler.releaseStackTraces(deferGC);
    size_t index = traces.findIf([](auto& trace) { return trace.frames[0].displayName == "busy"_s; });
    EXPECT(index != notFound);
    auto& trace = traces[index];
    EXPECT(trace.timestamp >= start && trace.timestamp <= MonotonicTime::now());
    EXPECT(trace.frames.size() == 2 && trace.frames[1].displayName == "(program)"_s);
    EXPECT(trace.frames[0].functionStartLine == 2 && trace.frames[0].functionStartColumn == 16);
    EXPECT(trace.frames[0].sourceProvider()->sourceURL() == "test.js"_s);
    EXPECT(profiler.releaseStackTraces(deferGC).isEmpty());
}
