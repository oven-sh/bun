#pragma once

#include "bun-native-bundler-plugin-api/bundler_plugin.h"
#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/YarrInterpreter.h>
#include "napi_external.h"
#include <JavaScriptCore/Yarr.h>
#include <wtf/BumpPointerAllocator.h>
#include "WriteBarrierList.h"
#include <wtf/HashMap.h>

typedef void (*JSBundlerPluginAddErrorCallback)(void*, void*, JSC::EncodedJSValue, uint8_t);
typedef void (*JSBundlerPluginOnLoadAsyncCallback)(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginOnResolveAsyncCallback)(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);
typedef void (*JSBundlerPluginNativeOnBeforeParseCallback)(const OnBeforeParseArguments*, OnBeforeParseResult*);

namespace Bun {

using namespace JSC;

class BundlerPlugin final {
public:
    /// In native plugins, the regular expression could be called concurrently on multiple threads.
    /// Therefore, we need a mutex to synchronize access.
    ///
    /// This compiles Yarr bytecode directly instead of going through
    /// Yarr::RegularExpression because that wrapper's debug ASSERT rejects every
    /// flag other than i/m/v, while plugin filters are user-supplied RegExps that
    /// commonly carry /u or /s. YarrPattern itself handles all semantic flags.
    class FilterRegExp {
    public:
        String m_pattern;
        // BytecodePattern stores a raw pointer into its allocator, so the
        // allocator must not move when this struct is relocated by Vector growth.
        std::unique_ptr<WTF::BumpPointerAllocator> m_allocator;
        std::unique_ptr<Yarr::BytecodePattern> m_bytecode;
        WTF::Lock lock {};

        WTF_MAKE_NONCOPYABLE(FilterRegExp);

        FilterRegExp(FilterRegExp&& other)
            : m_pattern(WTF::move(other.m_pattern))
            , m_allocator(WTF::move(other.m_allocator))
            , m_bytecode(WTF::move(other.m_bytecode))
        {
        }

        FilterRegExp(const String& pattern, OptionSet<Yarr::Flags> flags)
            // Ensure it's safe for cross-thread usage.
            : m_pattern(pattern.isolatedCopy())
            , m_allocator(WTF::makeUnique<WTF::BumpPointerAllocator>())
        {
            // Global and HasIndices control JS iteration state and result shape,
            // not whether a path matches, so drop them. Sticky is kept: the Yarr
            // interpreter honors it (a sticky pattern only matches at the start
            // offset), and for native onBeforeParse plugins this match is the
            // sole gate with no JS-side re-check.
            constexpr auto semanticFlags = OptionSet<Yarr::Flags> {
                Yarr::Flags::IgnoreCase,
                Yarr::Flags::Multiline,
                Yarr::Flags::DotAll,
                Yarr::Flags::Unicode,
                Yarr::Flags::UnicodeSets,
                Yarr::Flags::Sticky,
            };
            Yarr::ErrorCode errorCode = Yarr::ErrorCode::NoError;
            Yarr::YarrPattern yarrPattern(m_pattern, flags & semanticFlags, errorCode);
            if (Yarr::hasError(errorCode))
                return;
            m_bytecode = Yarr::byteCompile(yarrPattern, m_allocator.get(), errorCode);
        }

        bool match(JSC::VM& vm, const String& path);
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
    bool anyMatchesCrossThread(JSC::VM&, BunString* namespaceStr, BunString* path, bool isOnLoad);

    // The onResolve / onLoad requests this plugin chain currently holds (handed over by the bundle thread,
    // not yet answered). A request has exactly one answer, produced on this (the JS) thread: by the plugin
    // (onResolveAsync / onLoadAsync / addError — whichever comes first; anything later for the same request
    // is dropped), or, once the VM that runs the plugins is shutting down, by tombstone(). JS thread only.
    enum class RequestKind : uint8_t { Resolve = 0,
        Load = 1 };
    void holdRequest(RequestKind kind, void* context) { held.add(context, kind); }
    bool holdsRequest(RequestKind kind, void* context) const
    {
        auto it = held.find(context);
        return it != held.end() && it->value == kind;
    }
    // The request was still held (and no longer is): the caller produces its answer.
    std::optional<RequestKind> takeRequest(void* context) { return held.takeOptional(context); }
    bool takeRequest(RequestKind kind, void* context)
    {
        if (!holdsRequest(kind, context))
            return false;
        held.remove(context);
        return true;
    }
    // From here the plugin object answers nothing itself: what it still holds is answered as cancelled now,
    // and whatever its JS side delivers later is dropped.
    void tombstone();

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

    WriteBarrierList<JSC::JSPromise> deferredPromises = {};
    // The raw `NapiExternal*` stored in `NativePluginCallback` is dereferenced
    // off the JS thread; this list keeps those cells alive for GC.
    WriteBarrierList<NapiExternal> onBeforeParseExternals = {};

    JSBundlerPluginAddErrorCallback addError;
    JSBundlerPluginOnLoadAsyncCallback onLoadAsync;
    JSBundlerPluginOnResolveAsyncCallback onResolveAsync;
    void* config { nullptr };
    bool tombstoned { false };

private:
    WTF::HashMap<void*, RequestKind> held;
};

} // namespace Zig
