#pragma once

#include "root.h"

#if OS(DARWIN)

#include "ObjCRuntime.h"
#include "ipc_protocol.h"
#include <wtf/RefCounted.h>
#include <wtf/Ref.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// WKWebView wrapper. Runs in the host subprocess on thread 0 under
// CFRunLoopRun(). Completions (delegate IMPs, blocks) fire inside CFRunLoop
// and write reply frames to the parent socket. viewId is both the routing
// key and the frame header — no separate req_id.
// RefCounted so heap completion blocks can hold a strong ref and outlive
// the views map erase on close(). The on*Complete methods check m_closed
// and no-op — the block's dispose (~Ref) drops the last reference.
class WebViewHost : public RefCounted<WebViewHost> {
public:
    static Ref<WebViewHost> createForIPC(uint32_t viewId, uint32_t width, uint32_t height, const WTF::String& persistDir);
    ~WebViewHost();

    void navigateIPC(const WTF::String& url);
    void evaluateIPC(const WTF::String& js);
    void screenshotIPC(uint8_t format, uint8_t quality);

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
    bool scrollIPC(float dx, float dy);
    bool clickSelectorIPC(const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount);
    bool scrollToIPC(const WTF::String& selector, uint32_t timeout, uint8_t block);
    // Low-level pointer primitives. Each fires one (down/up) or
    // multiple (move with steps) NSEvents and waits for the UIProcess
    // mouseEventQueue drain barrier before Acking — same barrier click
    // uses. buttonsMask is the state AFTER this op for down/up (callers
    // already computed it parent-side), or the state DURING the move.
    bool mouseDownIPC(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask);
    bool mouseUpIPC(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask);
    bool mouseMoveIPC(float fromX, float fromY, float x, float y, uint32_t steps, uint8_t buttonsMask, uint8_t modifiers);
    void onInputComplete();
    // _executeEditCommand: is void(^)(BOOL) — block ABI needs the arg slot.
    void onInputCompleteBool(signed char) { onInputComplete(); }
    void onScrollBarrier();

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
    void onSelectorComplete(id result, id error);
    // WKScriptMessageHandler — the console-capture user script posts
    // {type, args}; pack str type + u32 count + str[count] and IPC.
    void onConsoleMessage(id type, id args);

private:
    WebViewHost() = default;
    void close();
    // clickIPC's mouse-event dispatch + barrier, without the guard.
    // clickSelectorIPC enters here after the actionability check resolves.
    void doNativeClick(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount);

    uint32_t m_viewId = 0;
    // One-at-a-time: the parent's WriteBarrier slot enforces serialization
    // (INVALID_STATE on overlap), and the block correlation in ObjCRuntime
    // (single m_evalTarget) requires it.
    bool m_navPending = false;
    bool m_evalPending = false;
    bool m_screenshotPending = false;
    // Stashed by screenshotIPC; read by onScreenshotComplete to pick the
    // NSBitmapImageFileType and compression factor. format values match
    // the parent's ScreenshotFormat enum (0=png 1=jpeg 2=webp).
    uint8_t m_screenshotFormat = 0;
    uint8_t m_screenshotQuality = 80;
    bool m_inputPending = false;
    bool m_scrollPending = false;

    objc::WKWebView m_webview;
    objc::NSWindow m_window;
    objc::NavigationDelegate m_delegate;
    bool m_closed = false;
    // Cached for viewport→window coord flip and wheel event location;
    // updated in resize().
    uint32_t m_width = 0;
    uint32_t m_height = 0;
    float m_pendingScrollDx = 0;
    float m_pendingScrollDy = 0;
    bool m_scrollWheelFired = false;
    // Stored for phase 2 of click(selector): callAsync completion parses
    // coords, then doNativeClick fires with these. scrollTo(selector)
    // shares m_selectorTarget but its completion just Acks — m_selIsScrollTo
    // distinguishes.
    uint8_t m_selButton = 0;
    uint8_t m_selModifiers = 0;
    uint8_t m_selClickCount = 0;
    bool m_selIsScrollTo = false;
};

} // namespace Bun

#endif // OS(DARWIN)
