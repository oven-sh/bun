#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/Strong.h"
#include "JavaScriptCore/RegularExpression.h"
#include "helpers.h"
#include <JavaScriptCore/Yarr.h>

namespace Bun {

using namespace JSC;

class JSBundlerPlugin final : public WTF::RefCounted<JSBundlerPlugin> {
public:
    WTF_MAKE_ISO_ALLOCATED(JSBundlerPlugin);
    static JSBundlerPlugin* create(JSC::JSGlobalObject* globalObject, BunPluginTarget target);

    // This is a list of pairs of regexps and functions to match against
    class Group {

    public:
        Vector<Yarr::RegularExpression> filters = {};
        Vector<JSC::Strong<JSC::JSFunction>> callbacks = {};

        void append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func);
        JSFunction* find(String& path);
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
        BunPluginTarget target { BunPluginTargetBun };

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

        EncodedJSValue run(const ZigString* namespaceString, const ZigString* path, void* context);
    };

    class OnResolve final : public Base {

    public:
        OnResolve()
            : Base()
        {
        }

        EncodedJSValue run(const ZigString* namespaceString, const ZigString* path, const ZigString* importer, void* context);
    };

public:
    bool anyMatchesCrossThread(const ZigString* namespaceStr, const ZigString* path, bool isOnLoad);
    void tombstone() { tombstoned = true; }

    JSBundlerPlugin(BunPluginTarget target) { this->target = target; }

    OnLoad onLoad = {};
    OnResolve onResolve = {};
    BunPluginTarget target { BunPluginTargetBun };
    bool tombstoned { false };

    using RefCounted::deref;
    using RefCounted::ref;
};

} // namespace Zig