#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Strong.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/ListHashSet.h>
#include "helpers.h"

BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPlugin);
BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPluginClear);
BUN_DECLARE_HOST_FUNCTION(jsFunctionMockModuleFactoryResolve);
#if ENABLE(AOT)
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledFactorySettled);
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledFactoryFailed);
BUN_DECLARE_HOST_FUNCTION(jsFunctionDecideFailureRetention);
BUN_DECLARE_HOST_FUNCTION(jsFunctionSettleReplacedFactory);
#endif
BUN_DECLARE_HOST_FUNCTION(jsFunctionMockModuleFactoryReject);

namespace Zig {

using namespace JSC;

class BunPlugin {
public:
    using VirtualModuleMap = WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSObject>>;

    // This is a list of pairs of regexps and functions to match against
    class Group {

    public:
        // JavaScriptCore/RegularExpression does exist however it does not JIT
        // We want JIT!
        // TODO: evaluate if using JSInternalFieldImpl(2) is faster
        Vector<JSC::Strong<JSC::RegExp>> filters = {};
        Vector<JSC::Strong<JSC::JSObject>> callbacks = {};
        BunPluginTarget target { BunPluginTargetBun };

        void append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSObject* func);
        JSObject* find(JSC::JSGlobalObject* globalObj, String& path);
        void clear()
        {
            filters.clear();
            callbacks.clear();
        }
    };

    class Base {
    public:
        Group fileNamespace = {};
        Vector<String> namespaces = {};
        Vector<Group> groups = {};

        Group* group(const String& namespaceStr)
        {
            if (namespaceStr.isEmpty()) {
                return &fileNamespace;
            }

            for (size_t i = 0; i < namespaces.size(); i++) {
                if (namespaces[i] == namespaceStr) {
                    return &groups[i];
                }
            }

            return nullptr;
        }

        void append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSObject* func, String& namespaceString);

        bool isEmpty() const { return fileNamespace.filters.isEmpty() && groups.isEmpty(); }

        void clear()
        {
            fileNamespace.clear();
            namespaces.clear();
            groups.clear();
        }
    };

    class OnLoad final : public Base {

    public:
        OnLoad()
            : Base()
        {
        }

        VirtualModuleMap* _Nullable virtualModules = nullptr;
        bool mustDoExpensiveRelativeLookup = false;
        // Set right before requestImportModule(), to tell moduleLoaderResolve() it's a script's import(), which can't use NUL-prefixed keys.
        bool isResolvingImportCall = false;
        // What moduleLoaderResolve() returned then.
        String keyOfImportCall;
        struct RunningModuleMock {
            JSC::Strong<JSC::JSObject> mock;
            // The factory's source file, and every module imported from it (transitively) since the factory was called.
            String file;
            WTF::UncheckedKeyHashSet<String> importChain;
            // importChain keys that have a query, with it stripped, because import() names its importer without the query.
            WTF::UncheckedKeyHashSet<String> importChainWithoutQuery;
            // Chain modules with an import redirected to the original or a copy. Evicted once the factory stops running.
            Vector<String> givenTheOriginal;
            // isWaitingForModule()'s cache.
            WTF::UncheckedKeyHashSet<String> waitingModules;
            // importChain for imports by compiled code, which the loader does not see.
            WTF::BitVector compiledImportChain = {};
            // givenTheOriginal for compiled files that required the mocked file.
            WTF::Vector<uint32_t, 2> compiledRequirersGivenOriginal = {};
        };
        // givenTheOriginal for compiled modules, by the specifier of the mock. They are evicted when the mock ends.
        WTF::UncheckedKeyHashMap<String, WTF::Vector<uint32_t, 2>> compiledModulesGivenOriginal = {};
        Vector<RunningModuleMock> runningModuleMocks = {};
        // Numbers the import() calls of compiled code and the factory calls, in order.
        uint32_t moduleMockSequenceNumber = 0;
        // See waitForTurn().
        struct WaitingModuleMock {
            JSC::Strong<JSC::JSObject> mock;
            JSC::Strong<JSC::JSObject> turn;
            // The module at the top of the load that asked for the mock, and the mock's place in that load. 0 until the load has fetched all it can.
            String load;
            unsigned rank { 0 };
        };
        Vector<WaitingModuleMock> waitingModuleMocks = {};
        struct ModuleMockWithTurn {
            JSC::Strong<JSC::JSObject> mock;
            String load;
        };
        Vector<ModuleMockWithTurn> moduleMocksWithTurn = {};
        // The reactions that rankWaitingModuleMocks() leaves behind carry the number it had then, and do nothing if it has moved on.
        unsigned timesRanked = 0;
        // How many loads it found that were still being fetched. The end of each ranks again.
        unsigned loadsBeingFetched = 0;
        // A load has been asked for that it doesn't know of.
        bool hasNewLoad = false;
        bool willGiveTurns = false;
        // Something has happened that the ranks don't know of: a mock or a factory asks for a module, or a module has left the registry.
        bool ranksAreStale = false;
        WTF::UncheckedKeyHashSet<String> modulesGivenTimeToRequestImports = {};
        // The first module of each load that import() or a factory started, oldest first.
        WTF::ListHashSet<String> loadRoots = {};
        // Those of them that a factory's file, but not the factory, called import() for while the factory ran.
        WTF::UncheckedKeyHashSet<String> loadRootsDuringFactories = {};
        // Fetch promises for those modules, kept until JSC registers them.
        WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSObject>> loadRootFetches = {};
        // Preload mocks that the running test file replaced or removed. Restored when the file ends.
        Vector<JSC::Strong<JSC::JSObject>> displacedPreloadModuleMocks = {};
        // Modules a preload loaded that the running test file evicted. Restored when the file ends.
        WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSCell>> evictedPreloadModules = {};
        WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSCell>> evictedPreloadCommonJSModules = {};
        // Starts at 1 so that a missing testFileOfModule entry (0) means a preload fetched the module.
        unsigned testFile = 1;
        // The modules that have called mock.module(), vi.mock() and the like since the running test file started.
        WTF::UncheckedKeyHashSet<String> mockingModules = {};
        WTF::UncheckedKeyHashMap<String, unsigned> testFileOfModule = {};
        // With --rerun-each: the keys of the modules that the load of the running test file fetched, in this run or in an earlier one, and that nothing has evicted since.
        // A later run of the file is linked to them again without a fetch, while testFileOfModule has them for the earlier run.
        WTF::UncheckedKeyHashSet<String> modulesOfTestFileLoad = {};
        // The keys that were evicted while that load was under way. What the load fetches under one of them after that is its second module for the key, which a later run doesn't begin with.
        WTF::UncheckedKeyHashSet<String> modulesEvictedDuringTestFileLoad = {};
        bool isLoadingRepeatedTestFile = false;
        // Data files that a reset has evicted under a mock whose end restores their original, with the test file in which their next load does not show it yet.
        WTF::UncheckedKeyHashMap<String, unsigned> dataFilesResetUnderMocks = {};
        WTF::ListHashSet<String> modulesToEvictOnceLoaded = {};
        // The pending loads those modules are waiting for. Each gets exactly one reaction. Weak, so a load that never settles doesn't keep its global object alive.
        WTF::UncheckedKeyHashMap<JSC::JSPromise*, JSC::Weak<JSC::JSPromise>> loadsOfModulesToEvict = {};
        // The mock a fetch in flight keeps resolving to, even if the mock is replaced or removed meanwhile (keepInFlightModuleMock).
        VirtualModuleMap moduleMocksBeingLoaded = {};
        // Modules that vi.importActual() was the first to load, under their own key because nothing mocked them yet.
        WTF::UncheckedKeyHashSet<String> loadedByImportActual = {};
        // Files whose module under the original's key became the original of a mock, with the test file that has the mock.
        WTF::UncheckedKeyHashMap<String, unsigned> filesWithRestoredOriginal = {};
        // Files that were mocked while an earlier module was under the original's key, with the test file that mocked them. When it ends, `bun test` gives that module the key back.
        WTF::UncheckedKeyHashMap<String, unsigned> filesWithEarlierOriginal = {};

        struct Matches {
            JSC::JSString* path { nullptr };
            JSC::MarkedArgumentBuffer callbacks;
            size_t next { 0 };
        };

        JSC::JSValue run(JSC::JSGlobalObject* globalObject, const String& key, Matches& matches);
        // Calls callbacks while `answer` is null or undefined. Returns an object, a pending or rejected promise, or empty if all declined.
        static JSC::JSValue ask(JSC::JSGlobalObject* globalObject, Matches& matches, JSC::JSValue answer);

        bool hasVirtualModules() const { return virtualModules != nullptr; }

        void addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mock);

        std::optional<String> resolveVirtualModule(const String& path, const String& from);

        void clear()
        {
            Base::clear();
            delete virtualModules;
            virtualModules = nullptr;
            mustDoExpensiveRelativeLookup = false;
            displacedPreloadModuleMocks.clear();
            runningModuleMocks.clear();
            waitingModuleMocks.clear();
            moduleMocksWithTurn.clear();
            modulesGivenTimeToRequestImports.clear();
            loadRoots.clear();
            loadRootsDuringFactories.clear();
            loadRootFetches.clear();
            moduleMocksBeingLoaded.clear();
            loadedByImportActual.clear();
            filesWithEarlierOriginal.clear();
            filesWithRestoredOriginal.clear();
#if ENABLE(AOT)
            pendingCompiledMocks.clear();
            compiledMockFactories.clear();
            latestCompiledFactoryCalls.clear();
            stashedFactoryCount = 0;
            waitingMockFetches.clear();
            fetchesBlockedOnFactories.clear();
            compiledImportersLinkedBeforeMocks.clear();
            mocksOutsideRegistry.clear();
            filesMockedOutsideRegistry.clearAll();
            bodyMocks.clear();
            modulesWithBodyMocks.clear();
#endif
        }

#if ENABLE(AOT)
        // By module. Each factory runs when a load reaches its module.
        WTF::Vector<std::pair<uint32_t, JSC::Strong<JSC::JSObject>>> pendingCompiledMocks;
        // The pending calls of those factories. Loads that reach the module wait for them.
        struct CompiledMockFactory {
            uint32_t module;
            bool isWaitedFor;
            JSC::Strong<JSC::JSObject> mock;
            // Settles after the factory, or once the mock has ended and another load requests the module.
            JSC::Strong<JSC::JSPromise> patched;
            // By the fetch of the mocked file itself, not of an importer, which belongs to another load.
            bool isAwaitedByOwnFetch { false };
            bool wasStartedByRequire { false };
            // In `bun test` the load that such a require() left continues, and fails with the factory.
            bool isAwaitedByDetachedLoad { false };
            // An earlier factory call for the module was pending: in `bun test` its fetch is in flight, and nothing takes the promise of this call.
            bool joinedFetchInFlight { false };
            bool joinedFetchWhenCalled { false };
            unsigned rejectedRequireCount { 0 };
            bool isInCurrentWalk { false };
            // By an import() of the module itself. Loads that reach it from another module resume once the mock has ended.
            bool isAwaitedByImporter { false };
            // Identifies this call of the factory.
            uint64_t call { 0 };
            WTF::Vector<uint32_t, 1> modulesRequestedByWaiters;
            WTF::Vector<JSC::Strong<JSC::JSObject>, 1> waitingFactories;
        };
        WTF::Vector<CompiledMockFactory> compiledMockFactories;
        size_t stashedFactoryCount { 0 };
        // The fetches of compiled files (by key) that wait for the turn of a mock below them. rankWaitingModuleMocks() treats their loader entries as the mock.
        WTF::Vector<std::pair<String, JSC::Strong<JSC::JSObject>>> waitingMockFetches;
        // The fetches of compiled files (by record key) that wait for a factory below them. See rankWaitingModuleMocks().
        WTF::Vector<String, 1> fetchesBlockedOnFactories;
        // An unevaluated compiled importer that the loader had linked to the evaluated module before it was mocked. It keeps that module until a reset
        // reloads it, and then gets the mock.
        struct CompiledImporterLinkedBeforeMock {
            WTF::String mocked;
            WTF::String importer;
        };
        WTF::Vector<CompiledImporterLinkedBeforeMock> compiledImportersLinkedBeforeMocks;
        // The specifiers of the mocks that may not be in the registry, by the file that they name.
        WTF::UncheckedKeyHashMap<uint32_t, WTF::Vector<WTF::String, 1>, WTF::IntHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> mocksOutsideRegistry;
        WTF::BitVector filesMockedOutsideRegistry;
        uint64_t compiledFactoryCallCount { 0 };
        // By module, whether or not the call is still in the list above.
        WTF::Vector<std::pair<uint32_t, uint64_t>> latestCompiledFactoryCalls;
        // The mock.module(), vi.mock() and similar calls made by the bodies of compiled modules other than test files. `bun test` evaluates such a
        // module again for the next test file that imports it. A compiled body runs once, so its calls are replayed.
        struct BodyMock {
            WTF::String file;
            uint32_t module;
            uint8_t function;
            // The test file has ended, and no load has reached the module since.
            bool waits { false };
            // The body of the file made the call, not a function of the file that another body called.
            bool isFromOwnBody { false };
            WTF::Vector<JSC::Strong<JSC::Unknown>, 2> arguments;
            // The other modules whose bodies were running. `bun test` evaluates those again that import the file statically.
            WTF::Vector<uint32_t, 4> importers;
            // The rest, and those that waited at a top-level import(), are evaluated again only if they installed a mock themselves.
            WTF::Vector<uint32_t, 2> importersByCall;
            // The call threw. Unless the body caught it, later imports of the body's module fail with the same error.
            bool threw { false };
        };
        WTF::Vector<BodyMock> bodyMocks;
        // Each `module` of them, once.
        WTF::Vector<uint32_t, 8> modulesWithBodyMocks;
        // During a replay: the file whose body made the call, and the frame of the call.
        WTF::String replayingFile;
        const void* replayFrame { nullptr };
        const WTF::String& replayedMockCaller(const void* frame)
        {
            if (replayingFile.isNull())
                return WTF::nullString();
            if (!replayFrame)
                replayFrame = frame;
            return replayFrame == frame ? replayingFile : WTF::nullString();
        }
#endif

        ~OnLoad()
        {
            if (virtualModules) {
                delete virtualModules;
            }
        }
    };

    class OnResolve final : public Base {

    public:
        OnResolve()
            : Base()
        {
        }

        // Mirrors `ResolveMode` in VirtualMachine.rs.
        enum class Asker : uint8_t { Import,
            Require,
            RequireResolve,
            ImportResolve };
        JSC::EncodedJSValue run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* importer, const BunString* importerNamespace, const BunString* resolveDir, Asker);

        // Set by import() and consumed by the loader's resolve hook.
        bool isResolvingImportCall { false };
        // Cleared while a callback runs: anything the callback resolves is a separate request.
        bool isResolvingImportStatement { false };
    };
};

class GlobalObject;

} // namespace Zig

namespace JSC {
class JSModuleNamespaceObject;
class JSSourceCode;
}

namespace Bun {
JSC::JSValue runVirtualModule(Zig::GlobalObject*, BunString* specifier, bool& wasModuleMock, Zig::BunPlugin::OnLoad::Matches& onLoad);
JSC::JSValue findModuleMock(Zig::GlobalObject*, const BunString* specifier);
// Returns null if the factory has settled or the generated ES module will call it (never when `synchronous`), else a promise for that.
JSC::JSPromise* runModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock, const String& key, bool synchronous);
// False if the mock was replaced or removed before its factory was called.
bool isModuleMockInUse(Zig::GlobalObject*, JSC::JSObject* moduleMock);
// The exports, or a JSCommonJSModule that has them as `module.exports`. Null until the factory settles.
JSC::JSObject* resultOfModuleMock(JSC::JSObject* moduleMock);
// The factory is an async function that is running, or that nothing has called. require() can't wait for it, and calling it
// from there would make the test file the file of a running factory, whose own import of the module gets the original.
bool hasModuleMockUnsettledAsyncFactory(JSC::JSObject* moduleMock);
// Nothing has called it, and no import is loading the original, which a require() would disturb.
bool canRequireOriginalOfModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock);
bool hasSynchronousMockFactory(Zig::GlobalObject*, const String& path, bool isOriginalSynchronous);
bool isSpyMock(Zig::GlobalObject*, const String& path);
#if ENABLE(AOT)
bool hasRegisteredModuleMock(Zig::GlobalObject*, const String& path);
bool canRequireMockOriginalAt(Zig::GlobalObject*, const String& path);
// In `bun test` the require map holds a restored preload mock, which is dropped with the key.
void didDeleteModuleMockKey(Zig::GlobalObject*, const String& key);
#endif
// What jest.requireActual() returns for the mocked module.
JSC::JSValue requireOriginalOfModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock);
// "node:fs" for "node:fs?actual", the key of the original of a mocked builtin.
std::optional<ASCIILiteral> builtinModuleOfOriginalKey(const String& key);
JSC::JSSourceCode* sourceCodeOfModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock, const String& key, const String& typeAttribute);
// Whether sourceCodeOfModuleMock() generated module `key`. Its import specifiers are NUL-prefixed registry keys.
bool moduleMockImportsByKey(Zig::GlobalObject*, const String& key);
// Redirects what a running factory imports: the mocked module to its original, and a module that waits for the mock to a private copy, or if it's a mock, to a module that doesn't wait.
String keyOfImportWhileModuleMocksRun(Zig::GlobalObject*, const String& key, const String& importer, bool isESM);
String packageImportKey(Zig::GlobalObject*, const String& key, const String& importer, bool isESM);
bool isModuleMockWaitingForFactory(Zig::GlobalObject*, const String& key);
JSC::JSObject* objectHoldingExportOfModuleMock(JSC::JSGlobalObject*, JSC::JSModuleNamespaceObject*, const JSC::Identifier& name);
#if ENABLE(AOT)
// The same for the namespace object of a compiled module. Null for any other object.
JSC::JSObject* compiledMockExportHolder(JSC::JSGlobalObject*, JSC::JSObject* moduleNamespace, const JSC::Identifier& name);
#endif
// Flushes modulesToEvictOnceLoaded after a synchronous load. Does nothing inside an outer synchronous load.
void evictModulesThatHaveLoaded(Zig::GlobalObject*);
void evictModuleThatNothingFetches(Zig::GlobalObject*, const JSC::Identifier& key);
JSC::Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
}
