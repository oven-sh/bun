#include "root.h"

#if OS(DARWIN)

#include "WebViewHost.h"
#include "ipc_protocol.h"

#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <wtf/text/MakeString.h>

namespace Bun {

using namespace WebViewProto;

// Defined in host_main.cpp.
namespace WebViewProto {
FrameWriter* hostWriter();
}

// ---------------------------------------------------------------------------
// Heap block factory. Each block carries Ref<WebViewHost> — one alloc per
// call, but concurrent ops across views work (no process-global target).
// WTF::BlockPtr does the same dance; this is the minimal non-templated-lambda
// version for our 3 signatures (void(), void(BOOL), void(id,id)).
//
// Lifecycle: we allocate at refcount 1. WebKit Block_copy's (refcount→2, just
// an atomic inc on _NSConcreteMallocBlock — no actual copy). Our handle
// destructor _Block_release's (→1). WebKit calls invoke, then
// _Block_release's (→0) → libBlocksRuntime calls dispose (runs ~Ref) → free.
//
// The block outlives the views map entry if close() races the completion —
// Ref keeps the host alive, on*Complete sees m_closed and no-ops, then
// dispose drops the last ref.
// ---------------------------------------------------------------------------

namespace {

struct HostBlockDescriptor {
    uintptr_t reserved;
    uintptr_t size;
    void (*copy)(void*, const void*); // null — MallocBlock Block_copy is refcount-only
    void (*dispose)(const void*);
};

enum : int32_t {
    BLOCK_NEEDS_FREE = 1 << 24,
    BLOCK_HAS_COPY_DISPOSE = 1 << 25,
};

// RAII: _Block_release on scope exit. Pass via implicit operator void*.
struct [[nodiscard]] HostBlockHandle {
    void* ptr;
    HostBlockHandle(void* p)
        : ptr(p)
    {
    }
    HostBlockHandle(const HostBlockHandle&) = delete;
    ~HostBlockHandle() { _Block_release(ptr); }
    operator void*() const { return ptr; }
};

// Member-function-pointer dispatch. Invoke forwards to (host->*Method)(args...);
// dispose runs ~Ref. The descriptor is a per-instantiation static so its
// size field is correct (libBlocksRuntime reads it for the free).
template<auto Method, typename... Args>
HostBlockHandle makeHostBlock(WebViewHost& host)
{
    struct Block {
        void* isa;
        int32_t flags;
        int32_t reserved;
        void (*invoke)(Block*, Args...);
        const HostBlockDescriptor* descriptor;
        Ref<WebViewHost> host;
    };
    static const HostBlockDescriptor desc {
        0, sizeof(Block), nullptr,
        [](const void* p) {
            static_cast<Block*>(const_cast<void*>(p))->host.~Ref();
        }
    };
    auto* b = static_cast<Block*>(malloc(sizeof(Block)));
    b->isa = _NSConcreteMallocBlock;
    b->flags = BLOCK_NEEDS_FREE | BLOCK_HAS_COPY_DISPOSE | (1 << 1); // refcount=1
    b->reserved = 0;
    b->invoke = [](Block* self, Args... args) {
        ObjCRuntime::ARPool pool;
        (self->host.get().*Method)(args...);
    };
    b->descriptor = &desc;
    new (&b->host) Ref<WebViewHost>(host);
    return { b };
}

// Console capture: wrap console.{log,warn,...} to postMessage the args
// (each JSON.stringify'd) via webkit.messageHandlers.bunConsole before
// calling the original. Injected at document-start for all frames.
// postMessage is fire-and-forget on the WebContent side but queues on the
// same IPC connection as callAsyncJavaScript completions — so a
// console.log inside an evaluate() body delivers before the evaluate's
// completion, and the parent-side callback fires before the await resumes.
static constexpr const char* kConsoleCaptureJS = R"js(
(() => {
  const h = webkit.messageHandlers.bunConsole;
  const wrap = (t, orig) => (...a) => {
    try { h.postMessage({type: t, args: a.map(x => { try { return JSON.stringify(x) ?? String(x) } catch { return String(x) } })}); } catch {}
    return orig.apply(console, a);
  };
  for (const t of ['log','warn','error','info','debug','trace','dir']) console[t] = wrap(t, console[t]);
})();
)js";

} // anonymous namespace

Ref<WebViewHost> WebViewHost::createForIPC(uint32_t viewId, uint32_t width, uint32_t height, const WTF::String& persistDir)
{
    ASSERT(ObjCRuntime::tryLoad()->m_loaded);

    auto host = adoptRef(*new WebViewHost());
    host->m_viewId = viewId;

    auto cfg = persistDir.isEmpty()
        ? objc::WKWebViewConfiguration::createEphemeral()
        : objc::WKWebViewConfiguration::createPersistent(persistDir);

    host->m_delegate = objc::NavigationDelegate::create(host.ptr());

    // Console capture: delegate also adopts WKScriptMessageHandler.
    // WKUserContentController strongly retains the handler; the delegate's
    // backlink to WebViewHost is OBJC_ASSOCIATION_ASSIGN (non-retaining) so
    // there's no cycle. clearHost() on close makes late posts no-op.
    objc::WKUserContentController ucc(cfg.userContentController());
    ucc.addScriptMessageHandler(host->m_delegate, objc::NSString::fromWTF("bunConsole"_s));
    auto script = objc::WKUserScript::createAtDocumentStart(
        objc::NSString::fromWTF(WTF::String::fromUTF8(kConsoleCaptureJS)));
    ucc.addUserScript(script);
    script.release();

    host->m_webview = objc::WKWebView::create(cfg, width, height);
    host->m_webview.setNavigationDelegate(host->m_delegate);

    host->m_window = objc::NSWindow::createOffscreen(width, height);

    // PageClientImpl::isViewVisible has three gates:
    //   activeWindow exists  — setContentView puts the view in this window
    //   [window isVisible]   — genuinely YES: window is at (0,0) alpha=0,
    //                          orderBack puts it on screen behind everything
    //   !windowIsOccluded    — disableOcclusionDetection short-circuits false
    //
    // All pass → ActivityState::IsVisible is set → WebContent schedules
    // rendering updates via DisplayLink (UIProcess CVDisplayLink fires →
    // IPC to WebContent → rAF callbacks run). Without IsVisible, rAF is
    // suspended and the actionability poll hangs.
    //
    // The window is at (0,0) not (-10000,-10000) so AppKit's real isVisible
    // is YES, window.screen is the genuine firstObject (valid displayID),
    // and the physical display stays awake (has an on-screen window).
    // CVDisplayLink needs the display's vsync signal; an asleep display
    // doesn't provide one. TestWKWebView (Tools/TestWebKitAPI) uses a real
    // on-screen window for the same reason — the -10000 OffscreenWindow is
    // only for tests that don't need rendering.
    //
    // alpha=0 + ignoresMouseEvents makes it user-invisible. The
    // BunHostWindow overrides (isVisible/isKeyWindow/screen all forced) are
    // redundant with a real on-screen window but kept as belt-and-suspenders
    // against the orderBack-before-setContentView timing on older macOS.
    //
    // orderBack assigns windowNumber (NSEvent synthesis needs a real one;
    // unordered returns 0).
    host->m_webview.disableOcclusionDetection();
    host->m_window.setContentView(host->m_webview);
    host->m_window.orderBack();
    host->m_width = width;
    host->m_height = height;

    // Process-global TextChecker state. keyDown: → NSTextInputContext →
    // smart quotes by default — first view sets it off for all.
    host->m_webview.disableTextSubstitutions();

    // The delegate also adopts WKUIDelegate to suppress the context menu
    // (right-click would otherwise block in NSMenu's modal runloop now that
    // the page is visible).
    host->m_webview.setUIDelegate(host->m_delegate);

    return host;
}

WebViewHost::~WebViewHost()
{
    close();
}

void WebViewHost::close()
{
    if (m_closed) return;
    m_closed = true;
    ObjCRuntime::ARPool pool;

    // Break the delegate backlink so late navigation callbacks see null.
    // Block completions hold Ref<WebViewHost> and check m_closed; no
    // target-pointer nulling needed.
    if (m_delegate) m_delegate.clearHost();

    if (m_webview) {
        m_webview.setNavigationDelegate(nullptr);
        m_webview.stopLoading();
    }
    if (m_window) {
        m_window.setContentView(nullptr);
        m_window.close();
        m_window.release();
        m_window = {};
    }
    if (m_webview) {
        m_webview.release();
        m_webview = {};
    }
    if (m_delegate) {
        m_delegate.release();
        m_delegate = {};
    }
}

// --- Requests --------------------------------------------------------------

void WebViewHost::navigateIPC(const WTF::String& urlString)
{
    if (m_navPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::NavFailed, "navigation already pending"_s);
        return;
    }
    auto nsurl = objc::NSURL::fromString(objc::NSString::fromWTF(urlString));
    if (!nsurl) {
        hostWriter()->sendReplyStr(m_viewId, Reply::NavFailed, "invalid URL"_s);
        return;
    }
    m_navPending = true;
    m_webview.loadRequest(objc::NSURLRequest::fromURL(nsurl));
}

void WebViewHost::evaluateIPC(const WTF::String& script)
{
    if (m_evalPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::EvalFailed, "evaluate already pending"_s);
        return;
    }
    m_evalPending = true;

    // callAsyncJavaScript: wraps the body in an async function and awaits
    // the return value. JSON.stringify page-side means the result crossing
    // to us is ALWAYS an NSString (or nil for undefined) — WebKit never
    // materializes NSArray/NSNumber/NSDictionary intermediates. Same
    // serialization path as WebAutomationSessionProxy.js (the WebDriver
    // backend does exactly JSON.stringify page-side). One serialize in
    // WebContent's JSC, one JSONParse in the parent's JSC; our layer is
    // pure string transport.
    //
    // await (expr) unwraps thenables; identity for non-thenables. The
    // parenthesization forces expression context — statement sequences
    // need an IIFE wrapper: evaluate("(() => { ...; return x })()").
    //
    // JSON.stringify(undefined) evaluates to undefined (the value, not
    // the string) → callAsync returns nil → parent resolves jsUndefined().
    // Functions/symbols become undefined. Circular refs throw → rejection.
    auto body = makeString("return JSON.stringify(await ("_s, script, "))"_s);
    m_webview.callAsync(objc::NSString::fromWTF(body), nullptr,
        makeHostBlock<&WebViewHost::onEvalComplete, id, id>(*this));
}

void WebViewHost::screenshotIPC(uint8_t format, uint8_t quality)
{
    if (m_screenshotPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, "screenshot already pending"_s);
        return;
    }
    m_screenshotPending = true;
    m_screenshotFormat = format;
    m_screenshotQuality = quality;
    m_webview.takeSnapshot(makeHostBlock<&WebViewHost::onScreenshotComplete, id, id>(*this));
}

// --- Native input ----------------------------------------------------------
// click() and type()/most of press() use WebKit's own completion barriers:
//   _doAfterProcessingAllPendingMouseEvents: — fires when the UIProcess
//     mouseEventQueue drains = WebContent has acked every mouse event.
//   _executeEditCommand:argument:completion: — sendWithAsyncReply; the
//     completion block fires when WebContent has run the command.
// Return true if async (Ack from onInputComplete), false if synchronous.

static unsigned long expandModifiers(uint8_t m)
{
    using namespace Bun::WebViewProto;
    using NSEvent = objc::NSEvent;
    unsigned long r = 0;
    if (m & ModShift) r |= NSEvent::ModShift;
    if (m & ModCtrl) r |= NSEvent::ModControl;
    if (m & ModAlt) r |= NSEvent::ModOption;
    if (m & ModMeta) r |= NSEvent::ModCommand;
    return r;
}

bool WebViewHost::clickIPC(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }
    doNativeClick(x, y, button, modifiers, clickCount);
    return true;
}

void WebViewHost::doNativeClick(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    using NSEvent = objc::NSEvent;
    double wy = static_cast<double>(m_height) - y; // viewport y-down → window y-up
    unsigned long mods = expandModifiers(modifiers);
    double ts = objc::NSProcessInfo::systemUptime();
    long win = m_window.windowNumber();

    // [webview mouseDown:] direct. [window sendEvent:] needs
    // makeKeyAndOrderFront: (the automation code does that) which would show
    // the window. The responder method goes _impl->mouseDown → WebViewImpl →
    // handleMouseEvent → mouseEventQueue → XPC. WebContent synthesizes click
    // from the pair: pointerdown/mousedown/pointerup/mouseup/click all fire,
    // isTrusted:true, :active CSS applies.
    //
    // No buttons-bitmap stamping here: click() is down+up at the same
    // spot and our callers (click(x,y), click(selector)) don't assert on
    // event.buttons — only event.button / event.detail / event.modifiers.
    // The low-level mouseDown/Up/Move primitives below DO set
    // NSEvent::s_trackedButtonsMask because drag test suites observe
    // event.buttons explicitly.
    switch (button) {
    case 1:
        m_webview.rightMouseDown(NSEvent::mouseEvent(NSEvent::RightMouseDown, x, wy, mods, ts, win, clickCount));
        m_webview.rightMouseUp(NSEvent::mouseEvent(NSEvent::RightMouseUp, x, wy, mods, ts, win, clickCount));
        break;
    case 2:
        m_webview.otherMouseDown(NSEvent::mouseEvent(NSEvent::OtherMouseDown, x, wy, mods, ts, win, clickCount));
        m_webview.otherMouseUp(NSEvent::mouseEvent(NSEvent::OtherMouseUp, x, wy, mods, ts, win, clickCount));
        break;
    default:
        m_webview.mouseDown(NSEvent::mouseEvent(NSEvent::LeftMouseDown, x, wy, mods, ts, win, clickCount));
        m_webview.mouseUp(NSEvent::mouseEvent(NSEvent::LeftMouseUp, x, wy, mods, ts, win, clickCount));
    }

    // Both events are now in mouseEventQueue. The barrier fires when the
    // queue drains — WebContent has processed both, synthesized click,
    // fired all JS handlers. No polling, no evaluateJavaScript hack.
    m_inputPending = true;
    m_webview.doAfterPendingMouseEvents(makeHostBlock<&WebViewHost::onInputComplete>(*this));
}

// Low-level pointer primitives. Unlike click() which pairs down+up into
// one barrier-gated sequence, these fire a single event (down/up) or a
// burst of move events and let the caller compose. Each waits on
// _doAfterProcessingAllPendingMouseEvents: so the promise resolves
// after WebContent has dispatched every event's JS handlers.
//
// For mouseDown/mouseUp the button arg picks the NSEventType + the
// right responder selector. buttonsMask is the post-op bitmap for the
// DOM event.buttons field — set into NSEvent::s_trackedButtonsMask
// before dispatch. WebCore reads +[NSEvent pressedMouseButtons] (which
// we swapped in ObjCRuntime::load to return s_trackedButtonsMask)
// synchronously inside [WKWebView mouseDown:]; the value captured
// becomes event.buttons on the DOM event. Per spec, mousedown reports
// buttons WITH the pressing bit set, mouseup reports WITHOUT it; the
// caller (JSWebView::mouseDown/Up) already computed that, we just
// publish it.
bool WebViewHost::mouseDownIPC(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask)
{
    using NSEvent = objc::NSEvent;
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }
    double wy = static_cast<double>(m_height) - y;
    unsigned long mods = expandModifiers(modifiers);
    double ts = objc::NSProcessInfo::systemUptime();
    long win = m_window.windowNumber();

    NSEvent::s_trackedButtonsMask = buttonsMask;
    switch (button) {
    case 1:
        m_webview.rightMouseDown(NSEvent::mouseEvent(NSEvent::RightMouseDown, x, wy, mods, ts, win, clickCount));
        break;
    case 2:
        m_webview.otherMouseDown(NSEvent::mouseEvent(NSEvent::OtherMouseDown, x, wy, mods, ts, win, clickCount));
        break;
    default:
        m_webview.mouseDown(NSEvent::mouseEvent(NSEvent::LeftMouseDown, x, wy, mods, ts, win, clickCount));
    }

    m_inputPending = true;
    m_webview.doAfterPendingMouseEvents(makeHostBlock<&WebViewHost::onInputComplete>(*this));
    return true;
}

bool WebViewHost::mouseUpIPC(float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask)
{
    using NSEvent = objc::NSEvent;
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }
    double wy = static_cast<double>(m_height) - y;
    unsigned long mods = expandModifiers(modifiers);
    double ts = objc::NSProcessInfo::systemUptime();
    long win = m_window.windowNumber();

    NSEvent::s_trackedButtonsMask = buttonsMask;
    switch (button) {
    case 1:
        m_webview.rightMouseUp(NSEvent::mouseEvent(NSEvent::RightMouseUp, x, wy, mods, ts, win, clickCount));
        break;
    case 2:
        m_webview.otherMouseUp(NSEvent::mouseEvent(NSEvent::OtherMouseUp, x, wy, mods, ts, win, clickCount));
        break;
    default:
        m_webview.mouseUp(NSEvent::mouseEvent(NSEvent::LeftMouseUp, x, wy, mods, ts, win, clickCount));
    }

    m_inputPending = true;
    m_webview.doAfterPendingMouseEvents(makeHostBlock<&WebViewHost::onInputComplete>(*this));
    return true;
}

// mouseMove: fire `steps` NSEvents total = (steps - 1) intermediate
// drag events interpolated from (fromX,fromY) → (x,y), then one final
// event at the target. When buttonsMask==0 we sync-Ack without
// dispatching any NSEvent (see the hover-path rationale below — the
// _simulateMouseMove: SPI hangs the barrier on macOS 14/15 aarch64).
// With a button held it's mouseDragged: (or right/other variant) —
// AppKit's responder chain uses a separate selector per button. If
// multiple buttons are held we pick the lowest-order set bit (left >
// right > middle) for the drag selector. WebKit processes a single
// drag event per main loop tick, so one NSEvent per intermediate coord
// is what the handlers see. Each event lands in mouseEventQueue and
// the final barrier drains them all.
bool WebViewHost::mouseMoveIPC(float fromX, float fromY, float x, float y, uint32_t steps, uint8_t buttonsMask, uint8_t modifiers)
{
    using NSEvent = objc::NSEvent;
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }

    // Hover path (no button held): the caller intends to reposition the
    // cursor for a subsequent mouseDown, not to trigger :hover CSS. We
    // intentionally skip the NSEvent dispatch and just Ack — observations:
    //
    //   1. On macOS 14/15 aarch64 the _simulateMouseMove: SPI enqueues
    //      into mouseEventQueue but WebContent never drains it (likely
    //      because the headless window's layer tree is ineligible for
    //      hover hit-test on this OS/arch combo). The
    //      _doAfterProcessingAllPendingMouseEvents: barrier then waits
    //      forever and the test times out.
    //   2. Drag handlers in real use look at `pointermove` with
    //      `event.buttons != 0` — hover moves with buttons=0 are
    //      semantically a "position the cursor" signal, not drag.
    //   3. Parent-side state tracking (m_mouseX/Y on JSWebView) has
    //      already happened, so the next mouseDown fires at (x, y)
    //      regardless of whether we dispatched an event here.
    //
    // If a user needs trusted :hover on WebKit in the future, the fix
    // is to post a CGEvent at screen coords (the same path
    // WebAutomationSessionMac.mm uses for wheel events) — expensive
    // since it moves the real cursor, so deferred until someone asks.
    if (!buttonsMask) {
        // Sync Ack — no barrier needed because we didn't dispatch.
        return false;
    }

    unsigned long mods = expandModifiers(modifiers);
    double ts = objc::NSProcessInfo::systemUptime();
    long win = m_window.windowNumber();
    double heightD = static_cast<double>(m_height);

    // Publish the buttons state to +[NSEvent pressedMouseButtons] so
    // every synthesized drag event gets the correct DOM event.buttons.
    // See ObjCRuntime.cpp for the +[NSEvent pressedMouseButtons] swap.
    NSEvent::s_trackedButtonsMask = buttonsMask;

    // AppKit's responder chain uses a separate selector per button drag
    // (mouseDragged: / rightMouseDragged: / otherMouseDragged:). Pick
    // the lowest-order set button (left wins over right wins over
    // middle); multi-button drags are rare enough that one event per
    // tick is fine. Matches the Chrome backend's priority in
    // ChromeBackend::mouseMove.
    enum class MoveKind { LeftDrag,
        RightDrag,
        OtherDrag };
    unsigned long evtType = NSEvent::LeftMouseDragged;
    MoveKind kind = MoveKind::LeftDrag;
    if (buttonsMask & 0x1) {
        // Left — keep LeftDrag default (explicit so 0x3, 0x5, 0x7 all
        // pick left instead of falling through to right/middle).
    } else if (buttonsMask & 0x2) {
        evtType = NSEvent::RightMouseDragged;
        kind = MoveKind::RightDrag;
    } else if (buttonsMask & 0x4) {
        evtType = NSEvent::OtherMouseDragged;
        kind = MoveKind::OtherDrag;
    }
    auto dispatch = [&](NSEvent e) {
        switch (kind) {
        case MoveKind::LeftDrag:
            m_webview.mouseDragged(e);
            return;
        case MoveKind::RightDrag:
            m_webview.rightMouseDragged(e);
            return;
        case MoveKind::OtherDrag:
            m_webview.otherMouseDragged(e);
            return;
        }
    };

    if (steps < 1) steps = 1;
    // (steps - 1) intermediate events at fractions i/steps, then the
    // final event at the target — `steps` events total. clickCount 0 is
    // the convention for non-click mouse events.
    for (uint32_t i = 1; i < steps; ++i) {
        double ix = static_cast<double>(fromX) + (static_cast<double>(x) - static_cast<double>(fromX)) * (static_cast<double>(i) / static_cast<double>(steps));
        double iy = static_cast<double>(fromY) + (static_cast<double>(y) - static_cast<double>(fromY)) * (static_cast<double>(i) / static_cast<double>(steps));
        double iwy = heightD - iy;
        dispatch(NSEvent::mouseEvent(evtType, ix, iwy, mods, ts, win, 0));
    }
    double wy = heightD - static_cast<double>(y);
    dispatch(NSEvent::mouseEvent(evtType, x, wy, mods, ts, win, 0));

    m_inputPending = true;
    m_webview.doAfterPendingMouseEvents(makeHostBlock<&WebViewHost::onInputComplete>(*this));
    return true;
}

// Actionability check: Playwright-style rAF-polled predicate. Runs entirely
// page-side via callAsyncJavaScript: — WebKit awaits the returned Promise.
// One IPC roundtrip regardless of how many frames the poll takes.
//
// The predicate: attached + has size + in viewport + stable for 2 frames +
// elementFromPoint at center returns the element or a descendant (not
// obscured). Returns "cx,cy" on success; throws on timeout.
//
// Arguments `sel` and `timeout` are passed via the arguments: NSDictionary,
// not string-interpolated — the selector can contain any characters.
static constexpr const char* kActionabilityJS = R"js(
const deadline = performance.now() + timeout;
let last;
for (;;) {
  const el = document.querySelector(sel);
  if (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      if (last && last.l === r.left && last.t === r.top && last.w === r.width && last.h === r.height) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) return cx + "," + cy;
      }
      last = { l: r.left, t: r.top, w: r.width, h: r.height };
    } else last = undefined;
  } else last = undefined;
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "' to be actionable";
  await new Promise(f => requestAnimationFrame(f));
}
)js";

// Simpler than click's actionability: just wait for the element to exist,
// then scrollIntoView. scrollIntoView itself handles "in viewport" and
// "scrollable ancestor" logic — it's atomic page-side, no layout race.
static constexpr const char* kScrollToJS = R"js(
const deadline = performance.now() + timeout;
for (;;) {
  const el = document.querySelector(sel);
  if (el) { el.scrollIntoView({ block, behavior: 'instant' }); return; }
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "'";
  await new Promise(f => requestAnimationFrame(f));
}
)js";

bool WebViewHost::clickSelectorIPC(const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    // Guards against a same-view overlap — the completion chains into
    // doNativeClick which sets m_inputPending, so a concurrent coord-click
    // on the same view would collide on the mouse barrier.
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }

    m_selButton = button;
    m_selModifiers = modifiers;
    m_selClickCount = clickCount;
    m_selIsScrollTo = false;

    auto body = objc::NSString::fromWTF(WTF::String::fromUTF8(kActionabilityJS));
    auto args = objc::NSDictionary::with2(
        objc::NSString::fromWTF(selector).m_id, objc::NSString::fromWTF("sel"_s).m_id,
        objc::NSNumber::withDouble(static_cast<double>(timeout)).m_id, objc::NSString::fromWTF("timeout"_s).m_id);
    m_webview.callAsync(body, args.m_id,
        makeHostBlock<&WebViewHost::onSelectorComplete, id, id>(*this));
    return true;
}

bool WebViewHost::scrollToIPC(const WTF::String& selector, uint32_t timeout, uint8_t block)
{
    static constexpr ASCIILiteral blockNames[] = { "start"_s, "center"_s, "end"_s, "nearest"_s };
    auto blockStr = blockNames[block < 4 ? block : 1];

    m_selIsScrollTo = true;

    auto body = objc::NSString::fromWTF(WTF::String::fromUTF8(kScrollToJS));
    auto args = objc::NSDictionary::with3(
        objc::NSString::fromWTF(selector).m_id, objc::NSString::fromWTF("sel"_s).m_id,
        objc::NSNumber::withDouble(static_cast<double>(timeout)).m_id, objc::NSString::fromWTF("timeout"_s).m_id,
        objc::NSString::fromWTF(blockStr).m_id, objc::NSString::fromWTF("block"_s).m_id);
    m_webview.callAsync(body, args.m_id,
        makeHostBlock<&WebViewHost::onSelectorComplete, id, id>(*this));
    return true;
}

void WebViewHost::onSelectorComplete(id result, id error)
{
    if (m_closed) return;
    if (error) {
        // WKErrorJavaScriptAsyncFunctionResultRejected carries the throw
        // reason in userInfo["WKJavaScriptExceptionMessage"], not in
        // localizedDescription (that's just "A JavaScript exception occurred").
        objc::NSError err(error);
        id msg = objc::NSDictionary(err.userInfo()).objectForKey(objc::NSString::fromWTF("WKJavaScriptExceptionMessage"_s).m_id);
        hostWriter()->sendReplyStr(m_viewId, Reply::Error,
            msg ? objc::NSString(msg).toWTF() : err.localizedDescription());
        return;
    }
    if (m_selIsScrollTo) {
        // scrollIntoView already ran page-side; nothing to chain into.
        hostWriter()->sendReply(m_viewId, Reply::Ack);
        return;
    }
    // click(selector): result is the NSString "cx,cy". Parse two doubles.
    WTF::String s = objc::NSString(result).toWTF();
    auto comma = s.find(',');
    if (comma == WTF::notFound) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "malformed selector result"_s);
        return;
    }
    float x = static_cast<float>(s.substring(0, comma).toDouble());
    float y = static_cast<float>(s.substring(comma + 1).toDouble());
    doNativeClick(x, y, m_selButton, m_selModifiers, m_selClickCount);
}

bool WebViewHost::typeIPC(const WTF::String& text)
{
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }

    // InsertText is a WebCore editing command. _executeEditCommand goes
    // WebPageProxy::executeEditCommand → sendWithAsyncReplyToProcessContainingFrame
    // Messages::WebPage::ExecuteEditCommandWithCallback. The completion block
    // fires when WebContent has inserted the text AND fired beforeinput/input.
    //
    // This bypasses WebViewImpl::interpretKeyEvent entirely — no IME, no
    // holding tank, no smart-quote substitution (that happens at the
    // NSTextInputContext layer we're skipping). No keydown fires — this is
    // insertText semantics, same as paste. If keydown is needed, press().
    m_inputPending = true;
    m_webview.executeEditCommand(
        objc::NSString::fromWTF("InsertText"_s),
        objc::NSString::fromWTF(text),
        makeHostBlock<&WebViewHost::onInputCompleteBool, signed char>(*this));
    return true;
}

// VirtualKey → { editing command (with completion), or HID keyCode (keyDown
// fallback) }. Indexed by enum value — no string compare. Commands from
// EditorCommand.cpp's createCommandMap; keyCodes from HIToolbox/Events.h;
// character codes are NSF-key range for nav keys.
struct VKeyInfo {
    ASCIILiteral command; // non-null → _executeEditCommand path
    uint16_t keyCode;
    UChar ch;
};
static const VKeyInfo& vkeyInfo(VirtualKey k)
{
    // Escape and Space have no editing command. All others do, but only
    // unmodified — Shift+ArrowLeft is MoveLeftAndModifySelection etc.,
    // and mapping every chord is a lot; modified presses fall through to
    // keyDown. Character stays {0,0,0}; caller supplies the char string.
    static constexpr VKeyInfo table[] = {
        /* Character */ { {}, 0, 0 },
        /* Enter */ { "InsertNewline"_s, 0x24, '\r' },
        /* Tab */ { "InsertTab"_s, 0x30, '\t' },
        /* Space */ { {}, 0x31, ' ' },
        /* Backspace */ { "DeleteBackward"_s, 0x33, 0x7f },
        /* Delete */ { "DeleteForward"_s, 0x75, 0xF728 },
        /* Escape */ { {}, 0x35, 0x1b },
        /* ArrowLeft */ { "MoveLeft"_s, 0x7B, 0xF702 },
        /* ArrowRight */ { "MoveRight"_s, 0x7C, 0xF703 },
        /* ArrowUp */ { "MoveUp"_s, 0x7E, 0xF700 },
        /* ArrowDown */ { "MoveDown"_s, 0x7D, 0xF701 },
        /* Home */ { "MoveToBeginningOfLine"_s, 0x73, 0xF729 },
        /* End */ { "MoveToEndOfLine"_s, 0x77, 0xF72B },
        /* PageUp */ { "ScrollPageBackward"_s, 0x74, 0xF72C },
        /* PageDown */ { "ScrollPageForward"_s, 0x79, 0xF72D },
    };
    static_assert(std::size(table) == static_cast<size_t>(VirtualKey::PageDown) + 1);
    uint8_t idx = static_cast<uint8_t>(k);
    return table[idx < std::size(table) ? idx : 0];
}

bool WebViewHost::pressIPC(VirtualKey key, uint8_t modifiers, const WTF::String& character)
{
    if (m_inputPending) {
        hostWriter()->sendReplyStr(m_viewId, Reply::Error, "input operation already pending"_s);
        return true;
    }

    const auto& info = vkeyInfo(key);

    // Editing-command path with proper completion. Only for unmodified
    // named keys — modifiers change the meaning, and mapping chord→command
    // is a lot of table for v1.
    if (!modifiers && info.command) {
        m_inputPending = true;
        m_webview.executeEditCommand(
            objc::NSString::fromWTF(info.command),
            objc::NSString::fromWTF(""_s),
            makeHostBlock<&WebViewHost::onInputCompleteBool, signed char>(*this));
        return true;
    }

    // keyDown fallback: Escape, Space, any key with modifiers, Character.
    // WebKit exposes no keyboard equivalent of _doAfterProcessingAllPendingMouseEvents:.
    // interpretKeyEvent is async; each press() is one pair so no holding-
    // tank burst. Sync Ack — _doAfterNextPresentationUpdate: as a barrier
    // doesn't fire reliably on macOS 13/14 CI (headless CA commit timing).
    // The user's next await serializes via our single-threaded CFRunLoop
    // dispatch, and the parent-side m_pendingMisc slot sequences ops.
    using NSEvent = objc::NSEvent;
    unsigned long mods = expandModifiers(modifiers);
    double ts = objc::NSProcessInfo::systemUptime();
    long win = m_window.windowNumber();

    WTF::String charsStr;
    uint16_t keyCode;
    if (key == VirtualKey::Character) {
        charsStr = character;
        keyCode = 0;
    } else {
        charsStr = WTF::String(std::span<const UChar>(&info.ch, 1));
        keyCode = info.keyCode;
    }
    auto chars = objc::NSString::fromWTF(charsStr);
    m_webview.keyDown(NSEvent::keyEvent(NSEvent::KeyDown, mods, ts, win, chars, chars, keyCode));
    m_webview.keyUp(NSEvent::keyEvent(NSEvent::KeyUp, mods, ts, win, chars, chars, keyCode));
    return false;
}

bool WebViewHost::scrollIPC(float dx, float dy)
{
    // Native wheel on macOS takes a double trip through async layers:
    //
    // 1. RemoteScrollingCoordinatorProxy's tree is populated by
    //    commitScrollingTreeState, bundled in the layer tree transaction.
    //    That commit lands AFTER didFinishNavigation. Before it, the
    //    scrolling tree is empty — hit-test finds nothing, the wheel
    //    event is silently dropped. _doAfterNextPresentationUpdate: sends
    //    DispatchAfterEnsuringDrawing which forces a commit and fires
    //    after it arrives; our callbackID ships inside that commit bundle
    //    so we're past commitScrollingTreeState when the barrier runs.
    //
    // 2. RemoteLayerTreeEventDispatcher::handleWheelEvent posts to
    //    ScrollingThread, then the result bounces back via
    //    RunLoop::mainSingleton().dispatch() — a later main-loop iteration.
    //    scrollWheel: returns immediately; sendWheelEvent happens later.
    //    A second presentation-update barrier after scrollWheel: gives the
    //    scrolling thread roundtrip a chance to complete before we Ack —
    //    the wheel XPC is ordered before DispatchAfterEnsuringDrawing on
    //    the WebContent connection, so the second commit reflects the
    //    scroll.
    //
    // If a scroll is already pending on this view, accumulate onto the
    // scheduled barrier — the parent's m_pendingMisc slot serializes from
    // JS so this is rare. Cross-view scrolls are independent (per-block
    // Ref capture).
    m_pendingScrollDx += dx;
    m_pendingScrollDy += dy;
    if (std::exchange(m_scrollPending, true)) return true;

    m_scrollWheelFired = false;
    m_webview.doAfterNextPresentationUpdate(makeHostBlock<&WebViewHost::onScrollBarrier>(*this));
    return true;
}

void WebViewHost::onScrollBarrier()
{
    // m_closed must gate this — the second barrier re-arm calls
    // scrollWheel: on a released WKWebView if close() raced.
    if (m_closed || !m_scrollPending) return;

    if (!std::exchange(m_scrollWheelFired, true)) {
        float dx = std::exchange(m_pendingScrollDx, 0);
        float dy = std::exchange(m_pendingScrollDy, 0);
        // View center in window coords — AppKit bottom-left. The view
        // fills the borderless window so window-local == view-local.
        m_webview.scrollWheel(objc::NSEvent::wheelEvent(
            dx, dy, m_window, m_width / 2.0, m_height / 2.0));
        // Re-arm: second barrier serializes the ScrollingThread roundtrip.
        m_webview.doAfterNextPresentationUpdate(makeHostBlock<&WebViewHost::onScrollBarrier>(*this));
        return;
    }

    m_scrollPending = false;
    hostWriter()->sendReply(m_viewId, Reply::Ack);
}

void WebViewHost::onInputComplete()
{
    if (m_closed || !std::exchange(m_inputPending, false)) return;
    hostWriter()->sendReply(m_viewId, Reply::Ack);
}

void WebViewHost::resize(uint32_t width, uint32_t height)
{
    if (m_closed) return;
    m_window.setContentSize(width, height);
    objc::NSView(m_webview).setFrame(width, height);
    m_width = width;
    m_height = height;
}

void WebViewHost::goBack()
{
    if (m_webview.canGoBack()) m_webview.goBack();
}
void WebViewHost::goForward()
{
    if (m_webview.canGoForward()) m_webview.goForward();
}
void WebViewHost::reload() { m_webview.reload(); }

WTF::String WebViewHost::url()
{
    auto nsurl = m_webview.url();
    return nsurl ? nsurl.absoluteString() : WTF::String();
}

WTF::String WebViewHost::title() { return m_webview.title(); }

// --- Completions -----------------------------------------------------------
// Inside CFRunLoop. Write the reply, clear the pending req_id.

// Pack two inline strings: u32 alen + a + u32 blen + b.
static WTF::Vector<uint8_t, 512> pack2(const WTF::String& a, const WTF::String& b)
{
    WTF::CString ca = a.utf8(), cb = b.utf8();
    uint32_t na = static_cast<uint32_t>(ca.length()), nb = static_cast<uint32_t>(cb.length());
    WTF::Vector<uint8_t, 512> out;
    out.grow(8 + na + nb);
    uint8_t* p = out.mutableSpan().data();
    memcpy(p, &na, 4);
    p += 4;
    memcpy(p, ca.data(), na);
    p += na;
    memcpy(p, &nb, 4);
    p += 4;
    memcpy(p, cb.data(), nb);
    return out;
}

// Event before reply: the parent's `await navigate()` resumes on the reply's
// microtask. If the event arrives after, the callback fires on a LATER tick —
// `expect(callbackFired).toBe(true)` right after the await would see false.
// Sending the event first means both are in the same onData batch, processed
// in order, callback fires before the promise microtask runs.

void WebViewHost::onNavigationFinished()
{
    // NavEvent is unsolicited — fires for back()/forward()/reload() too,
    // which Ack immediately and don't set m_navPending. The parent updates
    // url/title and runs onNavigated from NavEvent; NavDone only resolves
    // the navigate() promise.
    auto payload = pack2(url(), title());
    hostWriter()->sendReply(m_viewId, Reply::NavEvent, payload.span().data(), static_cast<uint32_t>(payload.size()));
    if (!std::exchange(m_navPending, false)) return;
    hostWriter()->sendReply(m_viewId, Reply::NavDone, payload.span().data(), static_cast<uint32_t>(payload.size()));
}

void WebViewHost::onNavigationFailed(const WTF::String& err)
{
    hostWriter()->sendReplyStr(m_viewId, Reply::NavFailEvent, err);
    if (!std::exchange(m_navPending, false)) return;
    hostWriter()->sendReplyStr(m_viewId, Reply::NavFailed, err);
}

void WebViewHost::onConsoleMessage(id type, id args)
{
    if (m_closed) return;
    // type is NSString, args is NSArray<NSString> — each a page-side
    // JSON.stringify. Payload: str type + u32 argCount + str[argCount].
    WTF::CString typeC = objc::NSString(type).toWTF().utf8();
    uint32_t typeLen = static_cast<uint32_t>(typeC.length());
    objc::NSArray arr(args);
    uint32_t argCount = args ? static_cast<uint32_t>(arr.count()) : 0;

    WTF::Vector<uint8_t, 256> out;
    out.grow(4 + typeLen + 4);
    uint8_t* p = out.mutableSpan().data();
    memcpy(p, &typeLen, 4);
    memcpy(p + 4, typeC.data(), typeLen);
    memcpy(p + 4 + typeLen, &argCount, 4);

    for (uint32_t i = 0; i < argCount; ++i) {
        WTF::CString argC = objc::NSString(arr.objectAtIndex(i)).toWTF().utf8();
        uint32_t argLen = static_cast<uint32_t>(argC.length());
        size_t was = out.size();
        out.grow(was + 4 + argLen);
        p = out.mutableSpan().data() + was;
        memcpy(p, &argLen, 4);
        memcpy(p + 4, argC.data(), argLen);
    }

    hostWriter()->sendReply(m_viewId, Reply::ConsoleEvent,
        out.span().data(), static_cast<uint32_t>(out.size()));
}

void WebViewHost::onEvalComplete(id result, id error)
{
    if (m_closed || !std::exchange(m_evalPending, false)) return;
    if (error) {
        // callAsyncJavaScript:'s error carries the throw reason in
        // userInfo[WKJavaScriptExceptionMessage]; localizedDescription is
        // generic. Same extraction as onSelectorComplete.
        objc::NSError err(error);
        id msg = objc::NSDictionary(err.userInfo()).objectForKey(objc::NSString::fromWTF("WKJavaScriptExceptionMessage"_s).m_id);
        hostWriter()->sendReplyStr(m_viewId, Reply::EvalFailed,
            msg ? objc::NSString(msg).toWTF() : err.localizedDescription());
        return;
    }
    // Body returns JSON.stringify(...) — result is NSString or nil.
    // Empty reply → parent resolves jsUndefined(); non-empty → JSONParse.
    hostWriter()->sendReplyStr(m_viewId, Reply::EvalDone,
        result ? objc::NSString(result).toWTF() : WTF::String());
}

void WebViewHost::onScreenshotComplete(id nsimage, id error)
{
    if (m_closed || !std::exchange(m_screenshotPending, false)) return;
    if (error || !nsimage) {
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed,
            error ? objc::NSError(error).localizedDescription() : "snapshot returned no image"_s);
        return;
    }

    id cg = objc::NSImage(nsimage).cgImage();
    if (!cg) {
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, "CGImage extraction failed"_s);
        return;
    }
    // NSBitmapImageFileType: 3=JPEG, 4=PNG. WebP (format==2) rejected at
    // the prototype layer — representationUsingType: has no WebP entry in
    // the enum; CGImageDestination with public.webp UTI would need a
    // separate dlsym surface (ImageIO.framework) not yet wired.
    unsigned long fileType = m_screenshotFormat == 1 ? 3 /* JPEG */ : 4 /* PNG */;
    id props = nullptr;
    if (m_screenshotFormat == 1) {
        // NSImageCompressionFactor takes a [0.0, 1.0] NSNumber. Our quality
        // is 0-100 matching CDP; map linearly.
        auto factor = objc::NSNumber::withDouble(static_cast<double>(m_screenshotQuality) / 100.0);
        props = objc::NSDictionary::with1(
            factor.m_id,
            objc::NSString::fromWTF("NSImageCompressionFactor"_s).m_id)
                    .m_id;
    }
    auto data = objc::NSBitmapImageRep::encodeFromCGImage(cg, fileType, props);
    if (!data) {
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, "image encoding failed"_s);
        return;
    }
    unsigned long length = data.length();

    // PNG goes in POSIX shared memory — reply frame stays tiny. The parent
    // shm_open's the same name, mmaps, wraps in a Uint8Array, then
    // shm_unlink's (we unlink after the parent's reply-ack in principle,
    // but it's simpler for the parent to own the unlink — it knows when
    // the JS side is done with the bytes).
    // Monotonic counter for unique names — the parent unlinks on receive,
    // but if the same viewId screenshots twice before the first is read
    // we'd collide with O_EXCL.
    static uint32_t shmSeq = 0;
    char name[48];
    snprintf(name, sizeof(name), "/bun-webview-%d-%u", getpid(), ++shmSeq);
    int fd = shm_open(name, O_CREAT | O_RDWR | O_EXCL, 0600);
    if (fd < 0) {
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, makeString("shm_open: "_s, WTF::String::fromUTF8(strerror(errno))));
        return;
    }
    if (ftruncate(fd, static_cast<off_t>(length)) != 0) {
        ::close(fd);
        shm_unlink(name);
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, makeString("ftruncate: "_s, WTF::String::fromUTF8(strerror(errno))));
        return;
    }
    void* map = mmap(nullptr, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (map == MAP_FAILED) {
        shm_unlink(name);
        hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, makeString("mmap: "_s, WTF::String::fromUTF8(strerror(errno))));
        return;
    }
    memcpy(map, data.bytes(), length);
    munmap(map, length);

    // Payload: u32 nameLen + name + u32 pngLen.
    uint32_t nameLen = static_cast<uint32_t>(strlen(name));
    uint32_t pngLen = static_cast<uint32_t>(length);
    WTF::Vector<uint8_t, 64> payload;
    payload.grow(4 + nameLen + 4);
    uint8_t* p = payload.mutableSpan().data();
    memcpy(p, &nameLen, 4);
    p += 4;
    memcpy(p, name, nameLen);
    p += nameLen;
    memcpy(p, &pngLen, 4);
    hostWriter()->sendReply(m_viewId, Reply::ScreenshotDone, payload.span().data(), static_cast<uint32_t>(payload.size()));
}

} // namespace Bun

#endif // OS(DARWIN)
