#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Strong.h>
#include "helpers.h"

BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPlugin);
BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPluginClear);

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
    };

    // Tracks a single mock.module() call so it can be undone when the scope ends.
    struct ModuleMockEntry {
        String specifier;
        JSC::Strong<JSC::JSObject> patchedNamespace;
        JSC::Strong<JSC::JSObject> originalExportSnapshot;
        bool hadInPlacePatch { false };
    };

    class OnLoad final : public Base {

    public:
        OnLoad()
            : Base()
        {
        }

        VirtualModuleMap* _Nullable virtualModules = nullptr;
        VirtualModuleMap* _Nullable moduleMocks = nullptr;
        bool mustDoExpensiveRelativeLookup = false;
        WTF::Vector<ModuleMockEntry> moduleMockEntries = {};
        WTF::Vector<size_t> moduleMockScopeMarkers = {};

        JSC::EncodedJSValue run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path);

        bool hasVirtualModules() const { return virtualModules != nullptr || moduleMocks != nullptr; }

        void addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mock);

        void beginModuleMockScope();
        void endModuleMockScope(JSC::JSGlobalObject* globalObject);
        void revertMockEntries(JSC::JSGlobalObject* globalObject, size_t fromIndex);

        std::optional<String> resolveVirtualModule(const String& path, const String& from);

        ~OnLoad()
        {
            if (virtualModules) {
                delete virtualModules;
            }
            if (moduleMocks) {
                delete moduleMocks;
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
