#pragma once

#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ScriptFetcher.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
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

    // `key` is what GlobalObject::moduleLoaderFetch() is asked for.
    void noteFetch(const WTF::String& key)
    {
        if (key != m_rootKey)
            m_keys.add(key);
    }
    bool holds(const WTF::String& key) const { return m_keys.contains(key); }
    const WTF::UncheckedKeyHashSet<WTF::String>& keys() const { return m_keys; }

    // Null before endRunnerLoadWhenSettled() and once the load is dropped.
    JSC::JSPromise* promise() const { return m_promise.get(); }
    void setPromise(JSC::JSPromise* promise) { m_promise = JSC::Weak<JSC::JSPromise>(promise); }

    // The registry entries of the load keep the fetcher, so a dropped one gives up what it holds.
    void clear()
    {
        m_loader = nullptr;
        m_rootKey = WTF::String();
        m_keys.clear();
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
    // Weak, so a load that never settles doesn't keep its global object alive.
    JSC::Weak<JSC::JSPromise> m_promise;
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
