#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Strong.h>
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
        // Set for the GlobalObject::moduleLoaderResolve() that JSModuleLoader::requestImportModule() starts with: what script asks for.
        bool isResolvingImportCall = false;
        struct RunningModuleMock {
            JSC::Strong<JSC::JSObject> mock;
            // The file the factory is written in, and the modules that have been imported from there, or from one of them, since.
            String file;
            WTF::UncheckedKeyHashSet<String> importChain;
            // Those with a query, without it: that is how a dynamic import names its importer.
            WTF::UncheckedKeyHashSet<String> importChainWithoutQuery;
            // Those that import the mocked module, or one that waits for it, and were given the original or a copy instead.
            Vector<String> givenTheOriginal;
            // Modules found to wait for the mocked module (isWaitingForModule).
            WTF::UncheckedKeyHashSet<String> waitingModules;
        };
        // The module mocks whose factory has been called and has not settled.
        Vector<RunningModuleMock> runningModuleMocks = {};
        // Module mocks a preload made that the running test file replaced or removed. They are back for the next file.
        Vector<JSC::Strong<JSC::JSObject>> displacedPreloadModuleMocks = {};
        // Counts the test files that share this global object, from 1.
        unsigned testFile = 1;
        // The test file that was running when each module was last fetched. None for what a preload fetched.
        WTF::UncheckedKeyHashMap<String, unsigned> testFileOfModule = {};
        // Modules that were being loaded when they were to be evicted: they go once they have loaded (evictModulesAndTheirImporters).
        WTF::ListHashSet<String> modulesToEvictOnceLoaded = {};
        // The one of them whose load a reaction is waiting for.
        String moduleAwaitedToEvict;
        // For those that are being loaded as a mock that has been replaced or removed since: that mock (keepModuleMockOfLoadInFlight).
        VirtualModuleMap moduleMocksBeingLoaded = {};

        // The callbacks whose filter matches `path`, in the order they were registered. Those before `next` have been asked.
        struct Matches {
            JSC::JSString* path { nullptr };
            JSC::MarkedArgumentBuffer callbacks;
            size_t next { 0 };
        };

        // Fills `matches` for the module `key` and asks them.
        JSC::JSValue run(JSC::JSGlobalObject* globalObject, const String& key, Matches& matches);
        // Asks the next callback while `answer` declines. Returns an object, a pending or rejected promise, or empty: all declined.
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
            moduleMocksBeingLoaded.clear();
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
// Null: its factory has settled, or the ES module it is loaded as is to call it (never if `synchronous`). Or a promise, fulfilled with undefined once that is so.
JSC::JSPromise* runModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock, bool synchronous);
// False if its factory has not been called and is not to be: the module has been mocked again since, or is not mocked any more.
bool isModuleMockInUse(Zig::GlobalObject*, JSC::JSObject* moduleMock);
// What the factory made: the exports, or a CommonJS module that has them as `module.exports`. Null until it settled.
JSC::JSObject* resultOfModuleMock(JSC::JSObject* moduleMock);
JSC::JSSourceCode* sourceCodeOfModuleMock(Zig::GlobalObject*, JSC::JSObject* moduleMock, const String& key, const String& typeAttribute);
// Whether the module `key` is one that sourceCodeOfModuleMock() wrote, which names what it imports by key: NUL, then the key.
bool moduleMockImportsByKey(Zig::GlobalObject*, const String& key);
// What a factory that is running loads gets the original of the module being mocked, and its own copy of a module that waits for the mock.
String keyOfImportWhileModuleMocksRun(Zig::GlobalObject*, const String& key, const String& importer, bool isESM);
// The object a module mock's factory returned, if the export `name` is read from it. Null otherwise.
JSC::JSObject* objectHoldingExportOfModuleMock(JSC::JSGlobalObject*, JSC::JSModuleNamespaceObject*, const JSC::Identifier& name);
// After a load that did not yield to the event loop, unless it is part of another: what it was loading when that was to be evicted goes now.
void evictModulesThatHaveLoaded(Zig::GlobalObject*);
JSC::Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
}
