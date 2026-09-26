#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Strong.h>
#include "helpers.h"

BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPlugin);
BUN_DECLARE_HOST_FUNCTION(jsFunctionBunPluginClear);
BUN_DECLARE_HOST_FUNCTION(jsFunctionMockModuleFactoryResolve);
BUN_DECLARE_HOST_FUNCTION(jsFunctionMockModuleFactoryReject);

namespace Zig {

using namespace JSC;

struct ModuleMockUndoLog;

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
        // What mock.module() calls from tests and hooks changed, for mock.restore(). WriteBarriers owned by the global object.
        ModuleMockUndoLog* _Nullable moduleMockUndoLog = nullptr;
        bool mustDoExpensiveRelativeLookup = false;
        JSC::EncodedJSValue run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path);

        bool hasVirtualModules() const { return virtualModules != nullptr; }

        void addModuleMock(Zig::GlobalObject* globalObject, const String& path, JSC::JSObject* mock);
        void restoreModuleMocks(Zig::GlobalObject* globalObject);
        void clearVirtualModules(JSC::JSCell* owner);
        template<typename Visitor> void visitModuleMockUndoLog(JSC::JSCell* owner, Visitor& visitor);

        std::optional<String> resolveVirtualModule(const String& path, const String& from);

        void clear(JSC::JSCell* owner)
        {
            Base::clear();
            clearVirtualModules(owner);
            mustDoExpensiveRelativeLookup = false;
        }

        ~OnLoad();
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

namespace Bun {
JSC::JSValue runVirtualModule(Zig::GlobalObject*, BunString* specifier, bool& wasModuleMock);
JSC::Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
}
