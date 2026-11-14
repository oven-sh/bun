#pragma once

#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ScriptFetcher.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>

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

    // A data file of the load (JSON, TOML, ...). Until the loader has a module of such a file, require() answers what it parses of the file itself.
    void noteDataFile(const WTF::String& key)
    {
        if (key.isNull())
            return;
        // The key as noteFetch() took it: the caller's may not own its characters.
        auto noted = m_keys.find(key);
        if (noted != m_keys.end())
            m_dataFiles.add(*noted, 0u);
    }

    // The source of the CommonJS import `key` is made, which is when that import would run if the load did not hold it back. `hasModule(key)`: the loader has a module of that data file.
    template<typename Functor>
    void noteCommonJSSource(const WTF::String& key, const Functor& hasModule)
    {
        unsigned madeAt = ++m_commonJSSourcesMade;
        for (auto& dataFile : m_dataFiles) {
            if (!dataFile.value && hasModule(dataFile.key))
                dataFile.value = madeAt;
        }
        m_commonJSSources.set(key, madeAt);
    }

    // While the generator of the CommonJS import `key` runs, hadNoModuleOfDataFile() goes by when the source of `key` was made. A run inside another goes by the earlier of the two sources.
    unsigned beginCommonJSRun(const WTF::String& key)
    {
        unsigned outer = m_runningCommonJSSource;
        unsigned madeAt = m_commonJSSources.get(key);
        if (madeAt && (!outer || madeAt < outer))
            m_runningCommonJSSource = madeAt;
        return outer;
    }
    // `outer` is what beginCommonJSRun() returned.
    void endCommonJSRun(unsigned outer) { m_runningCommonJSSource = outer; }

    // True in such a run for a data file of the load that the loader had no module of when that source was made: require() reads the file itself then, as where the import runs as soon as it is fetched.
    bool hadNoModuleOfDataFile(const WTF::String& key) const
    {
        if (!m_runningCommonJSSource || key.isNull())
            return false;
        auto dataFile = m_dataFiles.find(key);
        return dataFile != m_dataFiles.end() && (!dataFile->value || dataFile->value > m_runningCommonJSSource);
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
        m_commonJSSources.clear();
        m_runningCommonJSSource = 0;
        m_promise.clear();
    }

private:
    RunnerLoadFetcher(JSC::JSModuleLoader* loader, const WTF::String& rootKey)
        : m_loader(loader)
        , m_rootKey(rootKey)
    {
    }

    JSC::JSModuleLoader* m_loader;
    WTF::String m_rootKey;
    WTF::UncheckedKeyHashSet<WTF::String> m_keys;
    WTF::UncheckedKeyHashSet<WTF::String> m_commonJSKeys;
    // Each data file with the number of the first CommonJS source that was made when the loader had its module: 0 until there is one.
    WTF::UncheckedKeyHashMap<WTF::String, unsigned> m_dataFiles;
    // Each CommonJS import whose source was made, numbered from 1 in the order of making.
    WTF::UncheckedKeyHashMap<WTF::String, unsigned> m_commonJSSources;
    unsigned m_commonJSSourcesMade { 0 };
    // The number of the source that the running generator goes by: 0 when none runs.
    unsigned m_runningCommonJSSource { 0 };
    // Weak, so a load that never settles doesn't keep its global object alive.
    JSC::Weak<JSC::JSPromise> m_promise;
};

// Lives while the generator of the CommonJS import `key` runs: see RunnerLoadFetcher::beginCommonJSRun(). `load` may be null.
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

// Takes the place of a mark whose load has not settled. Null when the program is compiled ahead of time.
RefPtr<RunnerLoadFetcher> beginRunnerLoad(Zig::GlobalObject*, JSModuleGraph*, const WTF::String& rootKey);
// `promise` is null, settled, or pending and marked as handled by the loader. The mark is dropped once it is settled.
void endRunnerLoadWhenSettled(Zig::GlobalObject*, RunnerLoadFetcher&, JSC::JSPromise*);
// Drops the mark in flight, if any. The runner calls it when it gives up on a load, whose promise may never settle.
void endRunnerLoad(Zig::GlobalObject*);

} // namespace Bun
