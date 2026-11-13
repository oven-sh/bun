#pragma once

#include "root.h"
#include "js_native_api.h"

#include <wtf/SentinelLinkedList.h>
#include <wtf/TZoneMalloc.h>

namespace Bun {

// The finalize_cb and hint of napi_set_instance_data.
class NapiFinalizer {
public:
    NapiFinalizer(napi_finalize callback, void* hint)
        : m_callback(callback)
        , m_hint(hint)
    {
    }

    NapiFinalizer() = default;

    void call(napi_env env, void* data);
    void clear();

    inline napi_finalize callback() const { return m_callback; }
    inline void* hint() const { return m_hint; }

private:
    napi_finalize m_callback = nullptr;
    void* m_hint = nullptr;
};

// A finalize_cb that its NapiEnv links from the registering call until it has run, like Node's RefTracker.
class NapiTrackedFinalizer final : public WTF::BasicRawSentinelNode<NapiTrackedFinalizer> {
    WTF_MAKE_TZONE_ALLOCATED(NapiTrackedFinalizer);
    WTF_MAKE_NONCOPYABLE(NapiTrackedFinalizer);

public:
    NapiTrackedFinalizer(napi_finalize callback, void* data, void* hint)
        : callback(callback)
        , data(data)
        , hint(hint)
    {
    }

    // Null once the callback has run.
    napi_finalize callback;
    void* data;
    void* hint;
    // A NapiRef, a NapiExternal, ... holds this pointer and releases it. Without one the env frees it when it runs it.
    bool hasHolder { true };
};

} // namespace Bun
