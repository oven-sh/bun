#pragma once

// Thin EventTarget impl for JSWebView. Its only job is to hold the
// addEventListener/removeEventListener listener map and implement the
// EventTarget virtuals — all WebView state (promise slots, url, sessionId,
// etc.) stays on the JSWebView wrapper. This keeps the refactor minimal:
// the existing Weak<JSWebView> routing tables in both backends remain
// unchanged, and visitChildren already handles the WriteBarrier slots.
//
// The wrapper→impl link is via JSDOMWrapper<EventTarget>::m_wrapped (a
// Ref<>, so this object lives as long as the JS wrapper). The impl→wrapper
// link is ScriptWrappable::m_wrapper (a Weak<>) — set by toJSNewlyCreated.
// We don't use the impl→wrapper link; the backend dispatch goes straight
// through the JSWebView* already held in the Weak<> maps.

#include "root.h"
#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "ScriptExecutionContext.h"
#include <wtf/RefCounted.h>

namespace Bun {

class WebViewEventTarget final : public RefCounted<WebViewEventTarget>,
                                 public WebCore::EventTargetWithInlineData,
                                 private WebCore::ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(WebViewEventTarget);

public:
    static Ref<WebViewEventTarget> create(WebCore::ScriptExecutionContext& ctx)
    {
        return adoptRef(*new WebViewEventTarget(ctx));
    }

    using RefCounted::deref;
    using RefCounted::ref;

private:
    explicit WebViewEventTarget(WebCore::ScriptExecutionContext& ctx)
        : ContextDestructionObserver(&ctx)
    {
    }

    WebCore::EventTargetInterface eventTargetInterface() const final { return WebCore::BunWebViewEventTargetInterfaceType; }
    WebCore::ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
};

} // namespace Bun
