#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/RegularExpression.h>
#include "napi_external.h"
#include <JavaScriptCore/Yarr.h>

typedef void (*JSBundlerPluginAddErrorCallback)(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginOnLoadAsyncCallback)(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginOnResolveAsyncCallback)(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginNativeOnBeforeParseCallback)(int, void*, void*);

namespace Bun {

using namespace JSC;

class BundlerPlugin final {
public:
    class NamespaceList {
    public:
        Vector<Yarr::RegularExpression> fileNamespace = {};
        Vector<String> namespaces = {};
        Vector<Vector<Yarr::RegularExpression>> groups = {};
        BunPluginTarget target { BunPluginTargetBun };

        Vector<Yarr::RegularExpression>* group(const String& namespaceStr, unsigned& index)
        {
            if (namespaceStr.isEmpty()) {
                index = std::numeric_limits<unsigned>::max();
                return &fileNamespace;
            }

            size_t length = namespaces.size();
            for (size_t i = 0; i < length; i++) {
                if (namespaces[i] == namespaceStr) {
                    index = i;
                    return &groups[i];
                }
            }

            return nullptr;
        }

        void append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString, unsigned& index);
    };

    typedef struct {
        void *context;
        const char *path_ptr;
        size_t path_len;
        const char *namespace_ptr;
        size_t namespace_len;
        unsigned char default_loader;
        void *external;
    } OnBeforeParseArgs;

    class NativePluginList : public NamespaceList {
    public:
        using PerNamespaceCallbackList = Vector<std::pair<JSBundlerPluginNativeOnBeforeParseCallback, Bun::NapiExternal*>>;
        PerNamespaceCallbackList fileCallbacks = {};
        Vector<PerNamespaceCallbackList> namespaceCallbacks = {};
        int call(JSC::VM& vm, int* shouldContinue, void* bunContextPtr, const BunString* namespaceStr, const BunString* pathString, void* onBeforeParseArgs, void* onBeforeParseResult);
        void append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString, JSBundlerPluginNativeOnBeforeParseCallback callback, NapiExternal* external);
    };

public:
    bool anyMatchesCrossThread(JSC::VM&, const BunString* namespaceStr, const BunString* path, bool isOnLoad);
    void tombstone() { tombstoned = true; }

    BundlerPlugin(void* config, BunPluginTarget target, JSBundlerPluginAddErrorCallback addError, JSBundlerPluginOnLoadAsyncCallback onLoadAsync, JSBundlerPluginOnResolveAsyncCallback onResolveAsync)
        : addError(addError)
        , onLoadAsync(onLoadAsync)
        , onResolveAsync(onResolveAsync)
    {
        this->target = target;
        this->config = config;
    }

    NamespaceList onLoad = {};
    NamespaceList onResolve = {};
    NativePluginList onBeforeParse = {};
    BunPluginTarget target { BunPluginTargetBrowser };

    Vector<Strong<JSPromise>> deferredPromises = {};

    JSBundlerPluginAddErrorCallback addError;
    JSBundlerPluginOnLoadAsyncCallback onLoadAsync;
    JSBundlerPluginOnResolveAsyncCallback onResolveAsync;
    void* config { nullptr };
    bool tombstoned { false };
};

} // namespace Zig
