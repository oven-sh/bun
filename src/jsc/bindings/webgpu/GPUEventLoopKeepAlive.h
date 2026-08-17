#pragma once

#include "root.h"
#include "JSDOMPromiseDeferred.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

// In a browser a pending WebGPU promise has nothing to keep alive: the page
// stays up regardless. Bun exits once its event loop runs dry, and the results
// of requestAdapter(), mapAsync(), onSubmittedWorkDone() and friends arrive
// from Metal's threads through the instance's work queue, which the loop does
// not know about. So each of those operations captures one of these next to
// its promise (see the capture lists in GPU*.cpp); it holds the loop open from
// the call until the completion handler, and the token with it, is destroyed.
class GPUEventLoopKeepAlive {
    WTF_MAKE_NONCOPYABLE(GPUEventLoopKeepAlive);

public:
    explicit GPUEventLoopKeepAlive(const DOMPromiseDeferredBase& promise)
    {
        auto* jsPromise = dynamicDowncast<JSC::JSPromise>(promise.promise());
        if (!jsPromise)
            return;
        m_context = defaultGlobalObject(jsPromise->realm())->scriptExecutionContext();
        if (m_context)
            m_context->refEventLoop();
    }

    GPUEventLoopKeepAlive(GPUEventLoopKeepAlive&& other)
        : m_context(std::exchange(other.m_context, nullptr))
    {
    }

    ~GPUEventLoopKeepAlive()
    {
        if (m_context)
            m_context->unrefEventLoop();
    }

private:
    RefPtr<ScriptExecutionContext> m_context;
};

} // namespace WebCore
