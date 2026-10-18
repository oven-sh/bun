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
        // What moduleLoaderResolve() answered then.
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
        };
        Vector<RunningModuleMock> runningModuleMocks = {};
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
        WTF::ListHashSet<String> modulesAskedFor = {};
        // Fetch promises for those modules, kept until JSC registers them.
        WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSObject>> fetchesOfModulesAskedFor = {};
        // Preload mocks that the running test file replaced or removed. Restored when the file ends.
        Vector<JSC::Strong<JSC::JSObject>> displacedPreloadModuleMocks = {};
        // Modules a preload loaded that the running test file evicted. Restored when the file ends.
        WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSCell>> evictedPreloadModules = {};
        WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSCell>> evictedPreloadCommonJSModules = {};
        // Starts at 1 so that a missing testFileOfModule entry (0) means a preload fetched the module.
        unsigned testFile = 1;
        // The modules that have called mock.module(), vi.mock() and the like since the running test file started.
        WTF::UncheckedKeyHashSet<String> modulesThatMocked = {};
        WTF::UncheckedKeyHashMap<String, unsigned> testFileOfModule = {};
        WTF::ListHashSet<String> modulesToEvictOnceLoaded = {};
        // The pending loads those modules are waiting for. Each gets exactly one reaction. Weak, so a load that never settles doesn't keep its global object alive.
        WTF::UncheckedKeyHashMap<JSC::JSPromise*, JSC::Weak<JSC::JSPromise>> loadsOfModulesToEvict = {};
        // The mock a fetch in flight keeps resolving to, even if the mock is replaced or removed meanwhile (keepModuleMockOfLoadInFlight).
        VirtualModuleMap moduleMocksBeingLoaded = {};
        // Modules that vi.importActual() was the first to load, under their own key because nothing mocked them yet.
        WTF::UncheckedKeyHashSet<String> loadedByImportActual = {};

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
            modulesAskedFor.clear();
            fetchesOfModulesAskedFor.clear();
            moduleMocksBeingLoaded.clear();
            loadedByImportActual.clear();
        }

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

        JSC::EncodedJSValue run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* importer);
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
JSC::JSSourceCode* sourceCodeOfModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock, const String& key, const String& typeAttribute);
// Whether sourceCodeOfModuleMock() generated module `key`. Its import specifiers are NUL-prefixed registry keys.
bool moduleMockImportsByKey(Zig::GlobalObject*, const String& key);
// Redirects what a running factory imports: the mocked module to its original, and a module that waits for the mock to a private copy, or if it's a mock, to a module that doesn't wait.
String keyOfImportWhileModuleMocksRun(Zig::GlobalObject*, const String& key, const String& importer, bool isESM);
String keyOfImportByPackage(Zig::GlobalObject*, const String& key, const String& importer);
bool isModuleMockWaitingForFactory(Zig::GlobalObject*, const String& key);
JSC::JSObject* objectHoldingExportOfModuleMock(JSC::JSGlobalObject*, JSC::JSModuleNamespaceObject*, const JSC::Identifier& name);
// Flushes modulesToEvictOnceLoaded after a synchronous load. Does nothing inside an outer synchronous load.
void evictModulesThatHaveLoaded(Zig::GlobalObject*);
void evictModuleThatNothingFetches(Zig::GlobalObject*, const JSC::Identifier& key);
JSC::Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
}
