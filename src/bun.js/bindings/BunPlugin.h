#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/StrongInlines.h"
#include "helpers.h"

extern "C" JSC_DECLARE_HOST_FUNCTION(jsFunctionBunPlugin);
extern "C" JSC_DECLARE_HOST_FUNCTION(jsFunctionBunPluginClear);

namespace Zig {

using namespace JSC;

class BunPlugin {
public:
    class Group {

    public:
        Vector<JSC::Strong<JSC::RegExp>> filters = {};
        Vector<JSC::Strong<JSC::JSFunction>> callbacks = {};
        BunPluginTarget target { BunPluginTargetBun };

        void append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func);
        JSFunction* find(JSC::JSGlobalObject* globalObj, String path);
        void clear()
        {
            filters.clear();
            callbacks.clear();
        }
    };

    class Base {
    public:
        Group fileNamespace;
        Vector<String> namespaces = {};
        Vector<Group> groups = {};

        Group* group(String& namespaceStr)
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

        EncodedJSValue run(JSC::JSGlobalObject* globalObject, ZigString* namespaceString, ZigString* path);
    };

    class OnResolve final : public Base {

    public:
        OnResolve()
            : Base()
        {
        }

        EncodedJSValue run(JSC::JSGlobalObject* globalObject, ZigString* namespaceString, ZigString* path, ZigString* importer);
    };
};

} // namespace Zig