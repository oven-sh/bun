#pragma once

#include "bun-native-bundler-plugin-api/bundler_plugin.h"
#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/YarrFlags.h>
#include "napi_external.h"
#include "WriteBarrierList.h"
#include <wtf/HashMap.h>

typedef void (*JSBundlerPluginAddErrorCallback)(void*, void*, JSC::EncodedJSValue, uint8_t);
typedef void (*JSBundlerPluginOnLoadAsyncCallback)(void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginOnResolveAsyncCallback)(void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginNativeOnBeforeParseCallback)(const OnBeforeParseArguments*, OnBeforeParseResult*);

// src/jsc/RegularExpression.rs
struct CompiledRegularExpression;
extern "C" CompiledRegularExpression* Bun__RegularExpression__compile(const BunString* pattern, uint16_t flags);
extern "C" bool Bun__RegularExpression__matches(const CompiledRegularExpression*, const BunString* input);
extern "C" void Bun__RegularExpression__destroy(CompiledRegularExpression*);

namespace Bun {

using namespace JSC;

class BundlerPlugin final {
public:
    /// In native plugins, the regular expression could be called concurrently on multiple threads.
    class FilterRegExp {
    public:
        FilterRegExp(const String& pattern, OptionSet<Yarr::Flags> flags)
        {
            auto source = Bun::toString(pattern);
            m_compiled.reset(Bun__RegularExpression__compile(&source, flags.toRaw()));
        }

        bool match(const String& path) const
        {
            auto input = Bun::toString(path);
            return m_compiled && !path.isNull() && Bun__RegularExpression__matches(m_compiled.get(), &input);
        }

    private:
        struct Destroy {
            void operator()(CompiledRegularExpression* compiled) const { Bun__RegularExpression__destroy(compiled); }
        };

        std::unique_ptr<CompiledRegularExpression, Destroy> m_compiled;
    };

    class NamespaceList {
    public:
        Vector<FilterRegExp> fileNamespace = {};
        Vector<String> namespaces = {};
        Vector<Vector<FilterRegExp>> groups = {};
        BunPluginTarget target { BunPluginTargetBun };

        Vector<FilterRegExp>* group(const String& namespaceStr, unsigned& index)
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

    struct NativePluginCallback {
        JSBundlerPluginNativeOnBeforeParseCallback callback;
        Bun::NapiExternal* external;
        /// This refers to the string exported in the native plugin under
        /// the symbol BUN_PLUGIN_NAME
        ///
        /// Right now we do not close NAPI modules opened with dlopen and
        /// so we do not worry about lifetimes right now.
        const char* name;
    };

    class NativePluginList {
    public:
        using PerNamespaceCallbackList = Vector<NativePluginCallback>;

        Vector<FilterRegExp> fileNamespace = {};
        Vector<String> namespaces = {};
        Vector<Vector<FilterRegExp>> groups = {};
        BunPluginTarget target { BunPluginTargetBun };

        PerNamespaceCallbackList fileCallbacks = {};
        Vector<PerNamespaceCallbackList> namespaceCallbacks = {};

        int call(JSC::VM& vm, BundlerPlugin* plugin, int* shouldContinue, void* bunContextPtr, const BunString* namespaceStr, const BunString* pathString, OnBeforeParseArguments* onBeforeParseArgs, OnBeforeParseResult* onBeforeParseResult);
        void append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString, JSBundlerPluginNativeOnBeforeParseCallback callback, const char* name, NapiExternal* external);

        Vector<FilterRegExp>* group(const String& namespaceStr, unsigned& index)
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
    };

public:
    bool anyMatchesCrossThread(JSC::VM&, Bun::OwnedString* namespaceStr, Bun::OwnedString* path, bool isOnLoad);

    // The onResolve / onLoad requests this plugin chain currently holds (handed over by the bundle thread,
    // not yet answered). A request has exactly one answer, produced on this (the JS) thread: by the plugin
    // (onResolveAsync / onLoadAsync / addError — whichever comes first; anything later for the same request
    // is dropped), or, once the VM that runs the plugins is shutting down, by tombstone(). JS thread only.
    enum class RequestKind : uint8_t { Resolve = 0,
        Load = 1 };
    struct Request {
        void* context { nullptr };
        RequestKind kind { RequestKind::Resolve };
    };
    // A counter: a later request can get the address of an answered one.
    using RequestID = uint64_t;
    RequestID holdRequest(RequestKind kind, void* context)
    {
        held.add(++lastRequestID, Request { context, kind });
        return lastRequestID;
    }
    void* heldRequest(RequestKind kind, RequestID id) const
    {
        auto it = held.find(id);
        return it != held.end() && it->value.kind == kind ? it->value.context : nullptr;
    }
    // The request was still held (and no longer is): the caller produces its answer.
    std::optional<Request> takeRequest(RequestID id) { return held.takeOptional(id); }
    void* takeRequest(RequestKind kind, RequestID id)
    {
        void* context = heldRequest(kind, id);
        if (context)
            held.remove(id);
        return context;
    }
    // From here the plugin object answers nothing itself: what it still holds is answered as cancelled now,
    // and whatever its JS side delivers later is dropped.
    void tombstone();

    BundlerPlugin(BunPluginTarget target, JSBundlerPluginAddErrorCallback addError, JSBundlerPluginOnLoadAsyncCallback onLoadAsync, JSBundlerPluginOnResolveAsyncCallback onResolveAsync)
        : addError(addError)
        , onLoadAsync(onLoadAsync)
        , onResolveAsync(onResolveAsync)
    {
        this->target = target;
    }

    NamespaceList onLoad = {};
    NamespaceList onResolve = {};
    NativePluginList onBeforeParse = {};
    BunPluginTarget target { BunPluginTargetBrowser };

    WriteBarrierList<JSC::JSPromise> deferredPromises = {};
    // The raw `NapiExternal*` stored in `NativePluginCallback` is dereferenced
    // off the JS thread; this list keeps those cells alive for GC.
    WriteBarrierList<NapiExternal> onBeforeParseExternals = {};

    JSBundlerPluginAddErrorCallback addError;
    JSBundlerPluginOnLoadAsyncCallback onLoadAsync;
    JSBundlerPluginOnResolveAsyncCallback onResolveAsync;
    bool tombstoned { false };
    // Set on the JS thread before a bundle pass. After that, other threads read the filter lists without a lock.
    bool filtersFrozen { false };

private:
    WTF::HashMap<RequestID, Request> held;
    RequestID lastRequestID { 0 };
};

} // namespace Zig
