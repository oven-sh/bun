#pragma once

#include "root.h"

#if OS(DARWIN)

#include "ObjCRuntime.h"
#include "ipc_protocol.h"
#include <wtf/Noncopyable.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// WKWebView wrapper. Runs in the host subprocess on thread 0 under
// CFRunLoopRun(). Completions (delegate IMPs, blocks) fire inside CFRunLoop
// and write reply frames to the parent socket. viewId is both the routing
// key and the frame header — no separate req_id.
class WebViewHost {
    WTF_MAKE_NONCOPYABLE(WebViewHost);

public:
    static std::unique_ptr<WebViewHost> createForIPC(uint32_t viewId, uint32_t width, uint32_t height, const WTF::String& persistDir);
    ~WebViewHost();

    void navigateIPC(const WTF::String& url);
    void evaluateIPC(const WTF::String& js);
    void screenshotIPC();

    // Native input. clickIPC/typeIPC and most of pressIPC are async with
    // proper WebKit-owned completion: _doAfterProcessingAllPendingMouseEvents:
    // for mouse (fires when the UIProcess mouseEventQueue drains = WebContent
    // acked every event), _executeEditCommand:argument:completion: for text
    // and editing keys (sendWithAsyncReply, fires when WebContent processed
    // the command). Return true if async (Ack from onInputComplete); false
    // if the key has no editing command (Escape, chars with modifiers) and
    // fell back to keyDown with no completion — caller Acks.
    bool clickIPC(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount);
    bool typeIPC(const WTF::String& text);
    bool pressIPC(WebViewProto::VirtualKey key, uint8_t modifiers, const WTF::String& character);
    void onInputComplete();

    void resize(uint32_t width, uint32_t height);
    void goBack();
    void goForward();
    void reload();

    WTF::String url();
    WTF::String title();

    // Delegate IMP / block callbacks — fire inside CFRunLoop.
    void onNavigationFinished();
    void onNavigationFailed(const WTF::String& err);
    void onEvalComplete(id result, id error);
    void onScreenshotComplete(id nsimage, id error);

private:
    WebViewHost() = default;
    void close();

    uint32_t m_viewId = 0;
    // One-at-a-time: the parent's WriteBarrier slot enforces serialization
    // (INVALID_STATE on overlap), and the block correlation in ObjCRuntime
    // (single m_evalTarget) requires it.
    bool m_navPending = false;
    bool m_evalPending = false;
    bool m_screenshotPending = false;
    bool m_inputPending = false;

    objc::WKWebView m_webview;
    objc::NSWindow m_window;
    objc::NavigationDelegate m_delegate;
    bool m_closed = false;
    // Cached for viewport→window coord flip; updated in resize().
    uint32_t m_height = 0;
};

} // namespace Bun

#endif // OS(DARWIN)
