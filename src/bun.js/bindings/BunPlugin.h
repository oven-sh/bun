#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/Strong.h"
#include "helpers.h"

extern "C" JSC_DECLARE_HOST_FUNCTION(jsFunctionBunPlugin);
extern "C" JSC_DECLARE_HOST_FUNCTION(jsFunctionBunPluginClear);

namespace Zig {

using namespace JSC;

class BunPlugin {
public:
    // This is a list of pairs of regexps and functions to match against
    class Group {

    public:
        // JavaScriptCore/RegularExpression does exist however it does not JIT
        // We want JIT!
        // TODO: evaluate if using JSInternalFieldImpl(2) is faster
        Vector<JSC::Strong<JSC::RegExp>> filters = {};
        Vector<JSC::Strong<JSC::JSFunction>> callbacks = {};
        BunPluginTarget target { BunPluginTargetBun };

        void append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func);
        JSFunction* find(JSC::JSGlobalObject* globalObj, String& path);
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

        void append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func, String& namespaceString);
    };

    class OnLoad final : public Base {

    public:
        OnLoad()
            : Base()
        {
        }

        EncodedJSValue run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path);
    };

    class OnResolve final : public Base {

    public:
        OnResolve()
            : Base()
        {
        }

        EncodedJSValue run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path, BunString* importer);
    };
};

} // namespace Zig