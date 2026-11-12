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

// A finalize_cb that an addon registered for a value (napi_wrap, napi_add_finalizer, napi_create_external,
// an external buffer) or posted (node_api_post_finalizer). Its NapiEnv links it from the registering call
// until the callback has run, as Node's env does (RefTracker on napi_env__::finalizing_reflist and
// pending_finalizers). The NapiEnv functions that take one say who frees it.
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
    // The object that holds this pointer and releases it (a NapiRef, a NapiExternal, ...). Without one, the env
    // frees the finalizer when it runs it.
    bool hasHolder { true };
};

} // namespace Bun
