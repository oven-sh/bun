#pragma once

#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ScriptFetcher.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <algorithm>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/Vector.h>

namespace Bun {

// The fetcher of a load that `bun test` starts for a test file or a preload. It knows the modules that the static imports of that load fetch.
class RunnerLoadFetcher final : public JSC::ScriptFetcher {
public:
    static Ref<RunnerLoadFetcher> create(JSC::JSModuleLoader* loader, const WTF::String& rootKey) { return adoptRef(*new RunnerLoadFetcher(loader, rootKey)); }

    // Anything but NodeVM: whoever asks for the type casts a NodeVM fetcher to its own class (NodeVM.cpp).
    Type fetcherType() const final { return Type::Cached; }

    // To compare with, never to use: the slot may outlive the loader. Null once the load is dropped.
    JSC::JSModuleLoader* loader() const { return m_loader; }
    const WTF::String& rootKey() const { return m_rootKey; }

    // `key` is what GlobalObject::moduleLoaderFetch() is asked for. `mayBeCommonJS`: the import has no type attribute.
    void noteFetch(const WTF::String& key, bool mayBeCommonJS)
    {
        if (key == m_rootKey)
            return;
        m_keys.add(key);
        if (mayBeCommonJS)
            m_commonJSKeys.add(key);
    }
    // False for a key that the load fetched only with a type attribute (`with { type: "text" }`): the loader keeps an entry per key and type, so the module of that file is fetched by whichever load imports it.
    bool holdsCommonJS(const WTF::String& key) const { return m_commonJSKeys.contains(key); }
    const WTF::UncheckedKeyHashSet<WTF::String>& keys() const { return m_keys; }

    // A data file of the load (JSON, TOML, ...), or a file that it imports under a type alone. Until the loader has a module of such a file, require() answers what it parses of the file itself. The fetch that makes the source of the file notes it, before it returns. `isMadeInFetchOrder`: the loader makes the module from that source at once, as it does of a value. Of another source it may take its time (WebAssembly).
    void noteDataFile(const WTF::String& key, bool isMadeInFetchOrder)
    {
        if (key.isNull())
            return;
        // The key as noteFetch() took it: the caller's may not own its characters.
        auto noted = m_keys.find(key);
        if (noted != m_keys.end() && m_dataFiles.add(*noted, 0u).isNewEntry)
            m_dataFilesWithoutNumber.append(DataFileWithoutNumber { *noted, isMadeInFetchOrder });
    }

    // What the loader has of a data file: no entry, an entry that it is fetching, or the module.
    enum class ModuleOfDataFile : uint8_t {
        None,
        BeingFetched,
        Made,
    };

    // The source of the CommonJS import `key` is made. A load that did not hold the import back would run it right behind that, so its require() goes by what the loader has now. `moduleOf(key)`: what the loader has of that data file. `inFetchOrder`: no plugin and no mock serves a module, so the loader makes the modules in the order it fetched the files, and nothing that was noted behind a data file being fetched has its module.
    template<typename Functor>
    void noteCommonJSSource(const WTF::String& key, bool inFetchOrder, const Functor& moduleOf)
    {
        unsigned madeAt = ++m_commonJSSourcesMade;
        auto& waiting = m_dataFilesWithoutNumber;
        size_t kept = 0;
        size_t index = 0;
        for (; index < waiting.size(); ++index) {
            auto module = moduleOf(waiting[index].key);
            if (module == ModuleOfDataFile::Made) {
                auto dataFile = m_dataFiles.find(waiting[index].key);
                // A synchronous load in a run may have given it a number.
                if (dataFile != m_dataFiles.end() && !dataFile->value)
                    dataFile->value = madeAt;
                continue;
            }
            if (module == ModuleOfDataFile::BeingFetched && waiting[index].isMadeInFetchOrder && inFetchOrder && m_makesModulesInFetchOrder)
                break;
            if (kept != index)
                waiting[kept] = WTF::move(waiting[index]);
            ++kept;
        }
        if (kept != index)
            waiting.removeAt(kept, index - kept);
        m_commonJSSources.set(key, madeAt);
    }

    // While the body of the CommonJS import `key` runs, in its generator or in a require() of another body, hadNoModuleOfDataFile() goes by when the source of `key` was made: by the earlier source, in a run inside another. A module that is no such import goes by the run around it. endCommonJSRun() takes what this returns.
    unsigned beginCommonJSRun(const WTF::String& key)
    {
        unsigned outer = m_runningCommonJSSource;
        unsigned madeAt = key.isNull() ? 0 : m_commonJSSources.get(key);
        if (madeAt && (!outer || madeAt < outer))
            m_runningCommonJSSource = madeAt;
        if (madeAt && !outer) {
            m_outermostRun = key;
            ++m_outermostRuns;
        }
        return outer;
    }
    void endCommonJSRun(unsigned outer)
    {
        m_runningCommonJSSource = outer;
        if (!outer)
            forgetOutermostRun();
    }

    // True in such a run for a data file of the load that the loader had no module of when that source was made: require() reads the file itself then, as where the import runs as soon as it is fetched. Ask runnerLoadHadNoModuleOfDataFile(), which counts the synchronous loads of the runs first.
    bool hadNoModuleOfDataFile(const WTF::String& key) const
    {
        if (!m_runningCommonJSSource || key.isNull())
            return false;
        auto dataFile = m_dataFiles.find(key);
        return dataFile != m_dataFiles.end() && (!dataFile->value || dataFile->value > m_runningCommonJSSource);
    }

    // A module that require() had the loader load in a run, with the number that the run went by.
    struct SynchronousLoad {
        WTF::String key;
        unsigned source;
    };

    // require() has the loader load `key` and what that module imports. In the running CommonJS import: where the import runs as soon as it is fetched, the loader has those modules from then on. Outside the runs, this load may still be fetching: the loader may then make a module of a file ahead of those that it fetched before.
    void noteSynchronousLoad(const WTF::String& key)
    {
        if (!m_runningCommonJSSource) {
            m_makesModulesInFetchOrder = false;
            return;
        }
        if (!m_dataFiles.isEmpty() && !key.isNull())
            m_synchronousLoads.append(SynchronousLoad { key, m_runningCommonJSSource });
    }
    bool hasSynchronousLoads() const { return !m_synchronousLoads.isEmpty(); }

    // `settle(load)`, asked for the earlier runs first: false while that load has yet to link what it loaded. Otherwise it has handed each module of the load to noteModuleOfSynchronousLoad().
    template<typename Functor>
    void settleSynchronousLoads(const Functor& settle)
    {
        std::sort(m_synchronousLoads.begin(), m_synchronousLoads.end(), [](const SynchronousLoad& a, const SynchronousLoad& b) {
            return a.source < b.source;
        });
        m_synchronousLoads.removeAllMatching([&](SynchronousLoad& load) {
            return settle(load);
        });
    }

    // The loader has had a module of `key` since the run that went by `source`.
    void noteModuleOfSynchronousLoad(const WTF::String& key, unsigned source)
    {
        if (key.isNull())
            return;
        auto dataFile = m_dataFiles.find(key);
        if (dataFile != m_dataFiles.end() && (!dataFile->value || dataFile->value > source))
            dataFile->value = source;
    }

    // The import that the load held back whose body runs and is inside no other such body: null when none runs. Where that import runs as soon as it is fetched, the root of the load and every module between the two are still being loaded meanwhile, and the synchronous load that first asks for the import, or for one of those modules, ends their loads in its own queue: two loader steps for the import and one more for each module above it, and the loader links and evaluates the root one step behind the last. The steps below stand for those.
    const WTF::String& outermostRun() const { return m_outermostRun; }
    bool hasOutermostRun() const { return !m_outermostRun.isNull(); }
    // Tells the steps of one outermost run from those of another.
    unsigned outermostRunNumber() const { return m_outermostRuns; }

    bool knowsWaitingLoads() const { return m_knowsWaitingLoads; }
    // `waitingLoads`: each module whose load waits for the outermost run, with the step that ends its load. `rootStep`: that of the root, 0 where its load does not wait.
    void setWaitingLoads(WTF::UncheckedKeyHashMap<WTF::String, unsigned>&& waitingLoads, unsigned rootStep)
    {
        m_waitingLoads = WTF::move(waitingLoads);
        m_rootLoadStep = rootStep;
        m_knowsWaitingLoads = true;
    }
    // Whether a synchronous load that asks for `key` begins the steps.
    bool leadsToOutermostRun(const WTF::String& key) const { return m_rootLoadStep && !key.isNull() && (key == m_outermostRun || m_waitingLoads.contains(key)); }

    bool hasLoadSteps() const { return m_lastLoadStep; }
    void beginLoadSteps()
    {
        m_lastLoadStep = m_rootLoadStep;
        m_loadStep = 0;
    }
    // None is left to take: a require() of a waiting module begins them, whose own queue takes them all before any code runs, or the queue that took them gave up.
    void endLoadSteps() { m_loadStep = m_lastLoadStep = m_rootLoadStep; }
    // True for a waiting module between the first step and the one that ends its load: no other synchronous load can end that load.
    bool hasYetToEndLoad(const WTF::String& key) const
    {
        if (m_loadStep >= m_lastLoadStep || key.isNull())
            return false;
        auto waiting = m_waitingLoads.find(key);
        return waiting != m_waitingLoads.end() && waiting->value > m_loadStep;
    }

    enum class LoadStep : uint8_t {
        // Of an outermost run that has ended, or behind the last step.
        None,
        Taken,
        // The last but one: the loader links and evaluates a loaded root two of its steps behind the call that has it do so.
        LoadsRoot,
        Last,
    };
    LoadStep takeLoadStep(unsigned run)
    {
        if (run != m_outermostRuns || m_loadStep >= m_lastLoadStep)
            return LoadStep::None;
        if (++m_loadStep == m_lastLoadStep)
            return LoadStep::Last;
        return m_loadStep + 1 == m_lastLoadStep ? LoadStep::LoadsRoot : LoadStep::Taken;
    }

    // Null before endRunnerLoadWhenSettled() and once the load is dropped.
    JSC::JSPromise* promise() const { return m_promise.get(); }
    void setPromise(JSC::JSPromise* promise) { m_promise = JSC::Weak<JSC::JSPromise>(promise); }

    // The registry entries of the load keep the fetcher, so a dropped one gives up what it holds.
    void clear()
    {
        m_loader = nullptr;
        m_rootKey = WTF::String();
        m_keys.clear();
        m_commonJSKeys.clear();
        m_dataFiles.clear();
        m_dataFilesWithoutNumber.clear();
        m_commonJSSources.clear();
        m_synchronousLoads.clear();
        m_runningCommonJSSource = 0;
        forgetOutermostRun();
        m_promise.clear();
    }

private:
    RunnerLoadFetcher(JSC::JSModuleLoader* loader, const WTF::String& rootKey)
        : m_loader(loader)
        , m_rootKey(rootKey)
    {
    }

    void forgetOutermostRun()
    {
        m_outermostRun = WTF::String();
        m_knowsWaitingLoads = false;
        m_waitingLoads.clear();
        m_rootLoadStep = 0;
        m_lastLoadStep = 0;
        m_loadStep = 0;
    }

    JSC::JSModuleLoader* m_loader;
    WTF::String m_rootKey;
    WTF::UncheckedKeyHashSet<WTF::String> m_keys;
    WTF::UncheckedKeyHashSet<WTF::String> m_commonJSKeys;
    // Each data file with the number of the first CommonJS source that was made when the loader had its module, or of the run whose synchronous load gave the loader that module, if that is less: 0 until there is one.
    WTF::UncheckedKeyHashMap<WTF::String, unsigned> m_dataFiles;
    struct DataFileWithoutNumber {
        WTF::String key;
        bool isMadeInFetchOrder;
    };
    // The data files that no CommonJS source has numbered, in the order they were noted: what noteCommonJSSource() asks the loader for.
    WTF::Vector<DataFileWithoutNumber> m_dataFilesWithoutNumber;
    // False once a require() outside the runs had the loader load a module while this load was in flight.
    bool m_makesModulesInFetchOrder { true };
    // Each CommonJS import whose source was made, numbered from 1 in the order of making.
    WTF::UncheckedKeyHashMap<WTF::String, unsigned> m_commonJSSources;
    unsigned m_commonJSSourcesMade { 0 };
    // The synchronous loads of the runs whose modules settleSynchronousLoads() has yet to count.
    WTF::Vector<SynchronousLoad> m_synchronousLoads;
    // The number of the source that the running body goes by: 0 when none runs.
    unsigned m_runningCommonJSSource { 0 };
    WTF::String m_outermostRun;
    unsigned m_outermostRuns { 0 };
    bool m_knowsWaitingLoads { false };
    WTF::UncheckedKeyHashMap<WTF::String, unsigned> m_waitingLoads;
    unsigned m_rootLoadStep { 0 };
    // 0 until a synchronous load begins the steps, then `m_rootLoadStep`.
    unsigned m_lastLoadStep { 0 };
    unsigned m_loadStep { 0 };
    // Weak, so a load that never settles doesn't keep its global object alive.
    JSC::Weak<JSC::JSPromise> m_promise;
};

// Lives while the body of the CommonJS module `key` runs, and in its generator: see RunnerLoadFetcher::beginCommonJSRun(). `load` may be null.
class RunnerLoadCommonJSRun {
    WTF_MAKE_NONCOPYABLE(RunnerLoadCommonJSRun);

public:
    RunnerLoadCommonJSRun(RunnerLoadFetcher* load, const WTF::String& key)
        : m_load(load)
        , m_outer(load ? load->beginCommonJSRun(key) : 0)
    {
    }
    ~RunnerLoadCommonJSRun()
    {
        if (m_load)
            m_load->endCommonJSRun(m_outer);
    }

private:
    // The run may drop the load.
    RefPtr<RunnerLoadFetcher> m_load;
    unsigned m_outer;
};

// The mark of the load in flight that the runner started with the loader of `graph` (null: the global object's).
ALWAYS_INLINE RunnerLoadFetcher* liveRunnerLoad(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    auto* live = globalObject->m_runnerLoad.get();
    if (!live) [[likely]]
        return nullptr;
    return live->loader() == (graph ? graph->loader() : globalObject->moduleLoader()) ? live : nullptr;
}

// Whether the registry of `loader` is not to answer for `key`: RunnerLoadFetcher::hadNoModuleOfDataFile() of the load in flight of that loader, once the synchronous loads of its runs are counted. What reads the registry on behalf of require() asks this first.
bool runnerLoadHadNoModuleOfDataFile(Zig::GlobalObject*, JSC::JSModuleLoader*, const WTF::String& key);

// Takes the place of a mark whose load has not settled. Null when the program is compiled ahead of time.
RefPtr<RunnerLoadFetcher> beginRunnerLoad(Zig::GlobalObject*, JSModuleGraph*, const WTF::String& rootKey);
// `promise` is null, settled, or pending and marked as handled by the loader. The mark is dropped once it is settled.
void endRunnerLoadWhenSettled(Zig::GlobalObject*, RunnerLoadFetcher&, JSC::JSPromise*);
// Drops the mark in flight, if any. The runner calls it when it gives up on a load, whose promise may never settle.
void endRunnerLoad(Zig::GlobalObject*);

} // namespace Bun
