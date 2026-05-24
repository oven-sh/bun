#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/HashSet.h>
#include <wtf/Vector.h>
#include "helpers.h"

BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPlugin);
BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPluginClear);

namespace Zig {

using namespace JSC;

class BunPlugin {
public:
    using VirtualModuleMap = WTF::UncheckedKeyHashMap<String, JSC::Strong<JSC::JSObject>>;
    using PersistentMockPathSet = WTF::HashSet<String>;

    /// Per-module state captured when `mock.module(path, ...)` installs a
    /// transient mock over an already-loaded module. Lets per-file teardown
    /// restore both the virtual-module registry slot and the module
    /// environment's export bindings so sibling files see the original module
    /// — even when cached intermediate re-exporters hold live bindings into
    /// the mocked module's environment slots.
    struct InstalledMockRecord {
        /// Entry in `virtualModules[path]` at install time. `nullptr` if the
        /// path was not previously mocked; otherwise the mock installed by
        /// `--preload` or `Bun.plugin({ module })` that this transient mock
        /// displaced.
        JSC::Strong<JSC::JSObject> displacedEntry;
        /// Whether the displaced entry lived in `persistentMockPaths`. Drives
        /// whether teardown re-adds the path to that set.
        bool displacedWasPersistent { false };
        /// ESM namespace of the already-loaded module and the original value
        /// of each exported name the mock overrode. Replayed via
        /// `overrideExportValue` at teardown so re-exporters that bind
        /// through the same module environment slot revert to the real value.
        JSC::Strong<JSC::JSModuleNamespaceObject> esmNamespace;
        WTF::Vector<std::pair<JSC::Identifier, JSC::Strong<JSC::Unknown>>> esmOriginals;
    };
    using InstalledMocksMap = WTF::UncheckedKeyHashMap<String, InstalledMockRecord>;

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
    };

    class OnLoad final : public Base {

    public:
        OnLoad()
            : Base()
        {
        }

        VirtualModuleMap* _Nullable virtualModules = nullptr;
        /// Paths of `mock.module()` entries installed during `--preload` or
        /// `Bun.plugin({ module })`. These survive per-test-file teardown in
        /// `bun test`; transient entries added by a test file's top-level code
        /// or during a running test are cleared between files.
        PersistentMockPathSet* _Nullable persistentMockPaths = nullptr;
        /// Teardown state for transient mocks: each entry records what the
        /// mock displaced and what environment values it overrode so
        /// `BunPlugin__clearTransientModuleMocks` can restore them.
        InstalledMocksMap* _Nullable transientMockRecords = nullptr;
        bool mustDoExpensiveRelativeLookup = false;
        JSC::EncodedJSValue run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path);

        bool hasVirtualModules() const { return virtualModules != nullptr; }

        void addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mock, bool persistent);

        std::optional<String> resolveVirtualModule(const String& path, const String& from);

        ~OnLoad()
        {
            if (virtualModules) {
                delete virtualModules;
            }
            if (persistentMockPaths) {
                delete persistentMockPaths;
            }
            if (transientMockRecords) {
                delete transientMockRecords;
            }
        }
    };

    class OnResolve final : public Base {

    public:
        OnResolve()
            : Base()
        {
        }

        JSC::EncodedJSValue run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path, BunString* importer);
    };
};

class GlobalObject;

} // namespace Zig

namespace Bun {
JSC::JSValue runVirtualModule(Zig::GlobalObject*, BunString* specifier, bool& wasModuleMock);
JSC::Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
}
