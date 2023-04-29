#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/Strong.h"
#include "JavaScriptCore/RegularExpression.h"
#include "helpers.h"
#include <JavaScriptCore/Yarr.h>
#include <JavaScriptCore/Strong.h>

namespace Bun {

using namespace JSC;

class BundlerPlugin final {
public:
    class NamespaceList final {
    public:
        Vector<Yarr::RegularExpression> fileNamespace = {};
        Vector<String> namespaces = {};
        Vector<Vector<Yarr::RegularExpression>> groups = {};
        BunPluginTarget target { BunPluginTargetBun };

        Vector<Yarr::RegularExpression>* group(const String& namespaceStr)
        {
            if (namespaceStr.isEmpty()) {
                return &fileNamespace;
            }

            size_t length = namespaces.size();
            for (size_t i = 0; i < length; i++) {
                if (namespaces[i] == namespaceStr) {
                    return &groups[i];
                }
            }

            return nullptr;
        }

        void append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString);
    };

public:
    bool anyMatchesCrossThread(JSC::VM&, const ZigString* namespaceStr, const ZigString* path, bool isOnLoad);
    void tombstone() { tombstoned = true; }

    BundlerPlugin(void* config, BunPluginTarget target)
    {
        this->target = target;
        this->config = config;
    }

    NamespaceList onLoad = {};
    NamespaceList onResolve = {};
    BunPluginTarget target { BunPluginTargetBrowser };
    void* config { nullptr };
    bool tombstoned { false };
};

} // namespace Zig