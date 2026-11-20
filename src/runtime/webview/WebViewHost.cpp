#include "root.h"

#if OS(DARWIN)

#include "OwnedFd.h"
#include "WebViewHost.h"
#include "ipc_protocol.h"

#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <malloc/malloc.h>
#include <unistd.h>
#include <wtf/MmapSpan.h>
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
    // libBlocksRuntime releases the block with the system's free, so it comes from the system's zone.
    auto* b = static_cast<Block*>(malloc_zone_malloc(malloc_default_zone(), sizeof(Block)));
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
    ucc.addUserScript(objc::WKUserScript::createAtDocumentStart(
        objc::NSString::fromWTF(WTF::String::fromUTF8(kConsoleCaptureJS)), false));

    host->m_webview = objc::WKWebView::create(WTF::move(cfg), width, height);
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
    for (auto& kv : m_pendingIpcReplies) {
        if (kv.second) _Block_release(kv.second);
    }
    m_pendingIpcReplies.clear();
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
    }
    // Inside the pool.
    m_window = {};
    m_webview = {};
    m_delegate = {};
    for (auto& kv : m_schemeTasks) {
        if (kv.second) objc::Ref(kv.second).msg<void>(objc::Ref::s_release);
    }
    m_schemeTasks.clear();
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
        // NavFailEvent first, like onNavigationFailed: the promise rejection
        // alone can be silent (a constructor url is marked handled), so the
        // callback is the signal.
        hostWriter()->sendReplyStr(m_viewId, Reply::NavFailEvent, "invalid URL"_s);
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
document.querySelector(sel);
for (;;) {
  await new Promise(f => requestAnimationFrame(f));
  const el = document.querySelector(sel);
  if (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const held = [];
      for (let e = el; e; e = e.parentElement)
        for (const a of e.getAnimations()) if (a.pending && a.timeline?.currentTime != null) held.push([a, a.currentTime]);
      if (last && last.l === r.left && last.t === r.top && last.w === r.width && last.h === r.height && !last.held.some(([a, t]) => a.playState === "running" && a.currentTime === t)) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) return cx + "," + cy;
      }
      last = { l: r.left, t: r.top, w: r.width, h: r.height, held };
    } else last = undefined;
  } else last = undefined;
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "' to be actionable";
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
    if (!objc::Ref(result).isKindOf(objc::NSString::cls)) result = nullptr;
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
    // The event fires the callback; NavFailed settles the navigate slot and
    // is gated on m_navPending because the delegate also fails for
    // navigations no IPC navigate owns (reload, back/forward, the page).
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
        id arg = arr.objectAtIndex(i);
        if (!objc::Ref(arg).isKindOf(objc::NSString::cls)) arg = nullptr;
        WTF::CString argC = objc::NSString(arg).toWTF().utf8();
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
        objc::Ref(result).isKindOf(objc::NSString::cls) ? objc::NSString(result).toWTF() : WTF::String());
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
    // Unmapped before the reply goes out, so that the parent is the only mapper.
    {
        OwnedFd fd { shm_open(name, O_CREAT | O_RDWR | O_EXCL, 0600) };
        if (!fd) {
            hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, makeString("shm_open: "_s, WTF::String::fromUTF8(strerror(errno))));
            return;
        }
        if (ftruncate(fd.get(), static_cast<off_t>(length)) != 0) {
            shm_unlink(name);
            hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, makeString("ftruncate: "_s, WTF::String::fromUTF8(strerror(errno))));
            return;
        }
        auto map = MmapSpan<uint8_t>::mmap(nullptr, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd.get());
        if (!map) {
            shm_unlink(name);
            hostWriter()->sendReplyStr(m_viewId, Reply::ScreenshotFailed, makeString("mmap: "_s, WTF::String::fromUTF8(strerror(errno))));
            return;
        }
        memcpy(map.mutableSpan().data(), data.bytes(), length);
    }

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

static constexpr const char* kDesktopBridgeJS = R"js(
(() => {
  const pending = new Map();
  let nextReqId = 1;
  const listeners = new Map();
  window.__bunIpcResolve = (reqId, ok, jsonStr) => {
    const entry = pending.get(reqId);
    if (!entry) return;
    pending.delete(reqId);
    let val = undefined;
    try { val = jsonStr ? JSON.parse(jsonStr) : undefined; } catch { val = jsonStr; }
    if (ok) entry.resolve(val);
    else entry.reject(new Error(typeof val === "string" ? val : "IPC error"));
  };
  window.__bunIpcDispatch = (channel, jsonStr) => {
    const set = listeners.get(channel);
    if (!set) return;
    let args = [];
    try { args = jsonStr ? JSON.parse(jsonStr) : []; } catch {}
    for (const fn of set) fn({ senderId: 0 }, ...args);
  };
  const _replyHandler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bunIpcReply;
  const _postHandler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bunIpc;
  const _isCustomOrigin = location.protocol !== "file:" && location.protocol !== "about:" && location.protocol !== "data:" && location.origin !== "null";
  const _blobPrefix = _isCustomOrigin ? location.origin + "/__bun_ipc__/" : "";
  const _binPrefix = _isCustomOrigin ? location.origin + "/__bun_ipc_bin__/" : "";
  function _toBytes(data) {
    if (data === undefined || data === null) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(0);
  }
  function _u8ToB64(u8) {
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }
  function _b64ToU8(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  window.bunDesktopIpc = {
    async invokeBinary(channel, data) {
      if (!_binPrefix) {
        const b64 = _u8ToB64(_toBytes(data));
        const resB64 = await window.bunDesktopIpc.invoke("__bun_bin__:" + String(channel), b64);
        return resB64 ? _b64ToU8(String(resB64)) : new Uint8Array(0);
      }
      const body = data === undefined || data === null ? new Uint8Array(0) : data;
      const res = await fetch(_binPrefix + encodeURIComponent(String(channel)), {
        method: "POST",
        body,
        headers: { "x-bun-ipc-invoke": "1" },
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || ("IPC binary error (" + res.status + ")"));
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    async invoke(channel, ...args) {
      if (_replyHandler) {
        const resJson = await _replyHandler.postMessage({
          channel: String(channel),
          payload: args.length === 0 ? "[]" : JSON.stringify(args),
        });
        if (resJson === undefined || resJson === null) return undefined;
        if (_blobPrefix && typeof resJson === "string" && resJson.length < 48 && resJson.charCodeAt(0) === 123 && resJson.startsWith('{"__bunIpcBlob":')) {
          const meta = JSON.parse(resJson);
          const r = await fetch(_blobPrefix + meta.__bunIpcBlob);
          return await r.json();
        }
        return JSON.parse(resJson);
      }
      const reqId = nextReqId++;
      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        _postHandler.postMessage({
          bunIpc: "1",
          reqId: String(reqId),
          isInvoke: "1",
          channel: String(channel),
          payload: args.length === 0 ? "[]" : JSON.stringify(args),
        });
      });
    },
    send(channel, ...args) {
      _postHandler.postMessage({
        bunIpc: "1",
        reqId: "0",
        isInvoke: "0",
        channel: String(channel),
        payload: args.length === 0 ? "[]" : JSON.stringify(args),
      });
    },
    on(channel, fn) {
      let s = listeners.get(channel);
      if (!s) { s = new Set(); listeners.set(channel, s); }
      s.add(fn);
      return window.bunDesktopIpc;
    },
    once(channel, fn) {
      const wrapped = (ev, ...args) => {
        window.bunDesktopIpc.removeListener(channel, wrapped);
        fn(ev, ...args);
      };
      return window.bunDesktopIpc.on(channel, wrapped);
    },
    off(channel, fn) {
      listeners.get(channel)?.delete(fn);
      return window.bunDesktopIpc;
    },
    removeListener(channel, fn) {
      listeners.get(channel)?.delete(fn);
      return window.bunDesktopIpc;
    },
    removeAllListeners(channel) {
      if (channel === undefined) listeners.clear();
      else listeners.delete(channel);
      return window.bunDesktopIpc;
    },
  };
  const _contextBridge = {
    exposeInMainWorld(key, api) {
      window[String(key)] = api;
    },
  };
  if (typeof window.require !== "function") {
    window.require = function(id) {
      if (id === "electron") {
        return {
          ipcRenderer: window.bunDesktopIpc,
          contextBridge: _contextBridge,
          webUtils: { getPathForFile(f) { return (f && f.path) || (f && f.name) || ""; } },
        };
      }
      throw new Error("Cannot find module '" + id + "'");
    };
  }
})();
)js";

static WTF::Vector<WTF::String>& registeredCustomSchemes()
{
    static LazyNeverDestroyed<WTF::Vector<WTF::String>> schemes;
    static std::once_flag once;
    std::call_once(once, [] { schemes.construct(); });
    return schemes.get();
}

void WebViewHost::registerCustomScheme(const WTF::String& scheme)
{
    WTF::String lower = scheme.convertToASCIILowercase();
    if (lower.isEmpty() || lower == "app"_s || lower == "http"_s || lower == "https"_s || lower == "file"_s) return;
    auto& list = registeredCustomSchemes();
    for (const auto& s : list) {
        if (s == lower) return;
    }
    list.append(WTF::move(lower));
}

void WebViewHost::warmDesktop()
{
    static bool warmed = false;
    if (warmed) return;
    if (!ObjCRuntime::tryLoad()->m_loaded) return;
    warmed = true;
    ObjCRuntime::ARPool pool;
    // Initialize shared WKProcessPool + WebKit frameworks without allocating a throwaway WKWebView.
    (void)objc::WKWebViewConfiguration::createEphemeral();
}

Ref<WebViewHost> WebViewHost::createDesktopForIPC(
    uint32_t viewId,
    uint32_t width,
    uint32_t height,
    int32_t x,
    int32_t y,
    uint8_t flags,
    const WTF::String& title,
    const WTF::String& preloadJs)
{
    ASSERT(ObjCRuntime::tryLoad()->m_loaded);
    const bool show = (flags & 1) != 0;
    if (show) {
        objc::NSApplication::setActivationPolicyRegular();
    }

    auto host = adoptRef(*new WebViewHost());
    host->m_viewId = viewId;

    auto cfg = objc::WKWebViewConfiguration::createEphemeral();
    host->m_delegate = objc::NavigationDelegate::create(host.ptr());
    cfg.setURLSchemeHandler(host->m_delegate, objc::NSString::fromWTF("app"_s));
    for (const auto& s : registeredCustomSchemes()) {
        cfg.setURLSchemeHandler(host->m_delegate, objc::NSString::fromWTF(s));
    }

    objc::WKUserContentController ucc(cfg.userContentController());
    ucc.addScriptMessageHandler(host->m_delegate, objc::NSString::fromWTF("bunConsole"_s));
    ucc.addScriptMessageHandler(host->m_delegate, objc::NSString::fromWTF("bunIpc"_s));
    {
        static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
        static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
        if (selFn && clsFn) {
            if (Class cwCls = clsFn("WKContentWorld")) {
                if (id pageWorld = objc::Ref::msgCls<id>(cwCls, selFn("pageWorld"))) {
                    SEL addReplySel = selFn("addScriptMessageHandlerWithReply:contentWorld:name:");
                    if (ucc.msg<BOOL>(selFn("respondsToSelector:"), addReplySel)) {
                        ucc.msg<void>(addReplySel, host->m_delegate.m_id, pageWorld, objc::NSString::fromWTF("bunIpcReply"_s).m_id);
                    }
                }
            }
        }
    }

    const bool mainFrameOnly = (flags & 32) == 0;

    ucc.addUserScript(objc::WKUserScript::createAtDocumentStart(
        objc::NSString::fromWTF(WTF::String::fromUTF8(kConsoleCaptureJS)), mainFrameOnly));

    ucc.addUserScript(objc::WKUserScript::createAtDocumentStart(
        objc::NSString::fromWTF(WTF::String::fromUTF8(kDesktopBridgeJS)), mainFrameOnly));

    if (!preloadJs.isEmpty()) {
        ucc.addUserScript(objc::WKUserScript::createAtDocumentStart(objc::NSString::fromWTF(preloadJs), mainFrameOnly));
    }

    host->m_webview = objc::WKWebView::create(WTF::move(cfg), width, height);
    host->m_webview.setNavigationDelegate(host->m_delegate);
    host->m_webview.setUIDelegate(host->m_delegate);

    bool resizable = (flags & 2) != 0;
    bool frame = (flags & 4) != 0;
    bool transparent = (flags & 8) != 0;
    bool hasPos = (flags & 16) != 0;

    unsigned long styleMask = 0;
    if (frame) {
        styleMask = 1 | 2 | 4; // Titled | Closable | Miniaturizable
        if (resizable) styleMask |= 8; // Resizable
    }

    host->m_window = objc::NSWindow::createVisible(
        hasPos ? static_cast<double>(x) : 0.0,
        hasPos ? static_cast<double>(y) : 0.0,
        static_cast<double>(width),
        static_cast<double>(height),
        styleMask,
        transparent);
    if (!title.isEmpty()) {
        host->m_window.setTitle(objc::NSString::fromWTF(title).m_id);
    }
    if (!hasPos) {
        host->m_window.center();
    }
    host->m_window.setContentView(host->m_webview);
    if (show) {
        host->m_window.makeKeyAndOrderFront();
    }
    host->m_width = width;
    host->m_height = height;
    return host;
}

void WebViewHost::setWindowTitle(const WTF::String& title)
{
    if (m_closed || !m_window.m_id) return;
    m_window.setTitle(objc::NSString::fromWTF(title).m_id);
}

void WebViewHost::showWindow(bool visible)
{
    if (m_closed || !m_window.m_id) return;
    if (visible) {
        objc::NSApplication::setActivationPolicyRegular();
        m_window.makeKeyAndOrderFront();
    } else
        m_window.orderOut();
}

void WebViewHost::performWindowAction(uint8_t action)
{
    if (m_closed || !m_window.m_id) return;
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    if (!selFn) return;
    switch (action) {
    case 1: // Maximize
        if (!m_window.msg<BOOL>(selFn("isZoomed"))) {
            m_window.msg<void>(selFn("zoom:"), static_cast<id>(nullptr));
        }
        break;
    case 2: // Unmaximize
        if (m_window.msg<BOOL>(selFn("isZoomed"))) {
            m_window.msg<void>(selFn("zoom:"), static_cast<id>(nullptr));
        }
        break;
    case 3: // Minimize
        m_window.msg<void>(selFn("miniaturize:"), static_cast<id>(nullptr));
        break;
    case 4: // Focus
        objc::NSApplication::setActivationPolicyRegular();
        m_window.makeKeyAndOrderFront();
        if (clsFn) {
            if (Class nsAppCls = clsFn("NSApplication")) {
                if (id app = objc::Ref::msgCls<id>(nsAppCls, selFn("sharedApplication"))) {
                    objc::Ref(app).msg<void>(selFn("activateIgnoringOtherApps:"), static_cast<BOOL>(YES));
                }
            }
        }
        break;
    case 5: // Center
        m_window.msg<void>(selFn("center"));
        break;
    case 6: // Restore
        m_window.msg<void>(selFn("deminiaturize:"), static_cast<id>(nullptr));
        break;
    default:
        break;
    }
}

namespace {
id parseJsonObjC(const WTF::String& json)
{
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    if (!selFn || !clsFn) return nullptr;
    Class jsonCls = clsFn("NSJSONSerialization");
    if (!jsonCls) return nullptr;
    WTF::CString utf8 = json.utf8();
    if (utf8.length() == 0) return nullptr;
    Class dataCls = clsFn("NSData");
    id nsData = objc::Ref::msgCls<id>(dataCls, selFn("dataWithBytes:length:"), utf8.data(), static_cast<unsigned long>(utf8.length()));
    if (!nsData) return nullptr;
    id err = nullptr;
    return objc::Ref::msgCls<id>(jsonCls, selFn("JSONObjectWithData:options:error:"), nsData, 0UL, &err);
}

WTF::String serializeJsonObjC(id obj)
{
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    if (!selFn || !clsFn || !obj) return "{}"_s;
    Class jsonCls = clsFn("NSJSONSerialization");
    if (!jsonCls) return "{}"_s;
    id err = nullptr;
    id data = objc::Ref::msgCls<id>(jsonCls, selFn("dataWithJSONObject:options:error:"), obj, 0UL, &err);
    if (!data) return "{}"_s;
    const void* bytes = objc::Ref(data).msg<const void*>(selFn("bytes"));
    unsigned long len = objc::Ref(data).msg<unsigned long>(selFn("length"));
    if (!bytes || len == 0) return "{}"_s;
    return WTF::String::fromUTF8(std::span<const uint8_t>(static_cast<const uint8_t*>(bytes), len));
}

id buildNSMenuFromArray(id itemsArr)
{
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    if (!selFn || !clsFn || !itemsArr) return nullptr;
    Class menuCls = clsFn("NSMenu");
    Class itemCls = clsFn("NSMenuItem");
    Class arrCls = clsFn("NSArray");
    Class dictCls = clsFn("NSDictionary");
    if (!menuCls || !itemCls || !arrCls || !dictCls) return nullptr;
    if (!objc::Ref(itemsArr).isKindOf(arrCls)) return nullptr;

    id menu = objc::Ref(objc::Ref::msgCls<id>(menuCls, selFn("alloc"))).msg<id>(selFn("initWithTitle:"), objc::NSString::fromWTF(""_s).m_id);
    unsigned long count = objc::Ref(itemsArr).msg<unsigned long>(selFn("count"));
    id typeKey = objc::NSString::fromWTF("type"_s).m_id;
    id labelKey = objc::NSString::fromWTF("label"_s).m_id;
    id submenuKey = objc::NSString::fromWTF("submenu"_s).m_id;
    Class strCls = clsFn("NSString");

    for (unsigned long i = 0; i < count; ++i) {
        id entry = objc::Ref(itemsArr).msg<id>(selFn("objectAtIndex:"), i);
        if (!entry || !objc::Ref(entry).isKindOf(dictCls)) continue;
        id typeVal = objc::Ref(entry).msg<id>(selFn("objectForKey:"), typeKey);
        if (typeVal && objc::Ref(typeVal).isKindOf(strCls)) {
            const char* t = objc::Ref(typeVal).msg<const char*>(selFn("UTF8String"));
            if (t && strcmp(t, "separator") == 0) {
                id sep = objc::Ref::msgCls<id>(itemCls, selFn("separatorItem"));
                objc::Ref(menu).msg<void>(selFn("addItem:"), sep);
                continue;
            }
        }
        id labelVal = objc::Ref(entry).msg<id>(selFn("objectForKey:"), labelKey);
        id titleStr = (labelVal && objc::Ref(labelVal).isKindOf(strCls)) ? labelVal : objc::NSString::fromWTF(""_s).m_id;
        id item = objc::Ref(objc::Ref::msgCls<id>(itemCls, selFn("alloc"))).msg<id>(selFn("initWithTitle:action:keyEquivalent:"), titleStr, static_cast<SEL>(nullptr), objc::NSString::fromWTF(""_s).m_id);
        id subVal = objc::Ref(entry).msg<id>(selFn("objectForKey:"), submenuKey);
        if (subVal && objc::Ref(subVal).isKindOf(arrCls)) {
            id subMenu = buildNSMenuFromArray(subVal);
            if (subMenu) {
                objc::Ref(subMenu).msg<void>(selFn("setTitle:"), titleStr);
                objc::Ref(item).msg<void>(selFn("setSubmenu:"), subMenu);
                objc::Ref(subMenu).msg<void>(selFn("release"));
            }
        }
        objc::Ref(menu).msg<void>(selFn("addItem:"), item);
        objc::Ref(item).msg<void>(selFn("release"));
    }
    return menu;
}
} // namespace

void WebViewHost::setWindowProgress(double progress)
{
    if (m_closed) return;
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    if (!selFn || !clsFn) return;
    Class nsAppCls = clsFn("NSApplication");
    if (!nsAppCls) return;
    id app = objc::Ref::msgCls<id>(nsAppCls, selFn("sharedApplication"));
    if (!app) return;
    id dockTile = objc::Ref(app).msg<id>(selFn("dockTile"));
    if (!dockTile) return;
    if (progress >= 0.0 && progress <= 1.0) {
        int pct = static_cast<int>(progress * 100.0 + 0.5);
        WTF::String label = makeString(pct, "%"_s);
        objc::Ref(dockTile).msg<void>(selFn("setBadgeLabel:"), objc::NSString::fromWTF(label).m_id);
    } else {
        objc::Ref(dockTile).msg<void>(selFn("setBadgeLabel:"), static_cast<id>(nullptr));
    }
}

void WebViewHost::setApplicationMenu(const WTF::String& menuJson)
{
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    if (!selFn || !clsFn) return;
    Class nsAppCls = clsFn("NSApplication");
    if (!nsAppCls) return;
    id app = objc::Ref::msgCls<id>(nsAppCls, selFn("sharedApplication"));
    if (!app) return;

    if (menuJson.isEmpty() || menuJson == "null"_s) {
        objc::Ref(app).msg<void>(selFn("setMainMenu:"), static_cast<id>(nullptr));
        return;
    }
    id parsed = parseJsonObjC(menuJson);
    id menu = buildNSMenuFromArray(parsed);
    if (menu) {
        objc::Ref(app).msg<void>(selFn("setMainMenu:"), menu);
        objc::Ref(menu).msg<void>(selFn("release"));
    }
}

void WebViewHost::showDialog(uint32_t viewId, uint32_t reqId, uint8_t kind, const WTF::String& optsJson)
{
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static auto clsFn = reinterpret_cast<Class (*)(const char*)>(dlsym(RTLD_DEFAULT, "objc_getClass"));
    WTF::String resultJson = "{}"_s;

    if (selFn && clsFn) {
        Class dictCls = clsFn("NSDictionary");
        Class mutDictCls = clsFn("NSMutableDictionary");
        Class mutArrCls = clsFn("NSMutableArray");
        Class arrCls = clsFn("NSArray");
        Class strCls = clsFn("NSString");
        Class numCls = clsFn("NSNumber");
        id opts = parseJsonObjC(optsJson);
        auto getStr = [&](const char* key) -> id {
            if (!opts || !objc::Ref(opts).isKindOf(dictCls)) return nullptr;
            id v = objc::Ref(opts).msg<id>(selFn("objectForKey:"), objc::NSString::fromWTF(WTF::String::fromLatin1(key)).m_id);
            return (v && objc::Ref(v).isKindOf(strCls)) ? v : nullptr;
        };

        if (kind == 0) { // open dialog
            id panel = objc::Ref::msgCls<id>(clsFn("NSOpenPanel"), selFn("openPanel"));
            if (id title = getStr("title")) objc::Ref(panel).msg<void>(selFn("setTitle:"), title);
            long res = objc::Ref(panel).msg<long>(selFn("runModal"));
            id outDict = objc::Ref::msgCls<id>(mutDictCls, selFn("dictionary"));
            // NSModalResponseOK = 1
            bool canceled = (res != 1);
            id paths = objc::Ref::msgCls<id>(mutArrCls, selFn("array"));
            if (!canceled) {
                id urls = objc::Ref(panel).msg<id>(selFn("URLs"));
                unsigned long cnt = urls ? objc::Ref(urls).msg<unsigned long>(selFn("count")) : 0;
                for (unsigned long i = 0; i < cnt; ++i) {
                    id u = objc::Ref(urls).msg<id>(selFn("objectAtIndex:"), i);
                    if (id p = objc::Ref(u).msg<id>(selFn("path"))) {
                        objc::Ref(paths).msg<void>(selFn("addObject:"), p);
                    }
                }
            }
            objc::Ref(outDict).msg<void>(selFn("setObject:forKey:"), objc::Ref::msgCls<id>(numCls, selFn("numberWithBool:"), static_cast<BOOL>(canceled)), objc::NSString::fromWTF("canceled"_s).m_id);
            objc::Ref(outDict).msg<void>(selFn("setObject:forKey:"), paths, objc::NSString::fromWTF("filePaths"_s).m_id);
            resultJson = serializeJsonObjC(outDict);
        } else if (kind == 1) { // save dialog
            id panel = objc::Ref::msgCls<id>(clsFn("NSSavePanel"), selFn("savePanel"));
            if (id title = getStr("title")) objc::Ref(panel).msg<void>(selFn("setTitle:"), title);
            long res = objc::Ref(panel).msg<long>(selFn("runModal"));
            id outDict = objc::Ref::msgCls<id>(mutDictCls, selFn("dictionary"));
            bool canceled = (res != 1);
            objc::Ref(outDict).msg<void>(selFn("setObject:forKey:"), objc::Ref::msgCls<id>(numCls, selFn("numberWithBool:"), static_cast<BOOL>(canceled)), objc::NSString::fromWTF("canceled"_s).m_id);
            if (!canceled) {
                if (id u = objc::Ref(panel).msg<id>(selFn("URL"))) {
                    if (id p = objc::Ref(u).msg<id>(selFn("path"))) {
                        objc::Ref(outDict).msg<void>(selFn("setObject:forKey:"), p, objc::NSString::fromWTF("filePath"_s).m_id);
                    }
                }
            }
            resultJson = serializeJsonObjC(outDict);
        } else { // message / error box
            id alert = objc::Ref(objc::Ref::msgCls<id>(clsFn("NSAlert"), selFn("alloc"))).msg<id>(selFn("init"));
            if (id msg = getStr("message"))
                objc::Ref(alert).msg<void>(selFn("setMessageText:"), msg);
            else if (id title = getStr("title"))
                objc::Ref(alert).msg<void>(selFn("setMessageText:"), title);
            if (id detail = getStr("detail"))
                objc::Ref(alert).msg<void>(selFn("setInformativeText:"), detail);
            else if (id content = getStr("content"))
                objc::Ref(alert).msg<void>(selFn("setInformativeText:"), content);
            if (kind == 3) {
                // NSAlertStyleCritical = 2
                objc::Ref(alert).msg<void>(selFn("setAlertStyle:"), 2UL);
            }
            if (opts && objc::Ref(opts).isKindOf(dictCls)) {
                id btns = objc::Ref(opts).msg<id>(selFn("objectForKey:"), objc::NSString::fromWTF("buttons"_s).m_id);
                if (btns && objc::Ref(btns).isKindOf(arrCls)) {
                    unsigned long cnt = objc::Ref(btns).msg<unsigned long>(selFn("count"));
                    for (unsigned long i = 0; i < cnt; ++i) {
                        id b = objc::Ref(btns).msg<id>(selFn("objectAtIndex:"), i);
                        if (b && objc::Ref(b).isKindOf(strCls)) {
                            objc::Ref(alert).msg<id>(selFn("addButtonWithTitle:"), b);
                        }
                    }
                }
            }
            long res = objc::Ref(alert).msg<long>(selFn("runModal"));
            objc::Ref(alert).msg<void>(selFn("release"));
            int idx = res >= 1000 ? static_cast<int>(res - 1000) : 0;
            id outDict = objc::Ref::msgCls<id>(mutDictCls, selFn("dictionary"));
            objc::Ref(outDict).msg<void>(selFn("setObject:forKey:"), objc::Ref::msgCls<id>(numCls, selFn("numberWithInt:"), idx), objc::NSString::fromWTF("response"_s).m_id);
            objc::Ref(outDict).msg<void>(selFn("setObject:forKey:"), objc::Ref::msgCls<id>(numCls, selFn("numberWithBool:"), NO), objc::NSString::fromWTF("checkboxChecked"_s).m_id);
            resultJson = serializeJsonObjC(outDict);
        }
    }

    WTF::CString utf8 = resultJson.utf8();
    uint32_t len = static_cast<uint32_t>(utf8.length());
    WTF::Vector<uint8_t, 256> out(8 + len);
    memcpy(out.mutableSpan().data(), &reqId, 4);
    memcpy(out.mutableSpan().data() + 4, &len, 4);
    if (len > 0) memcpy(out.mutableSpan().data() + 8, utf8.data(), len);
    hostWriter()->sendReply(viewId, Reply::DesktopDialogResult, out.span().data(), static_cast<uint32_t>(out.size()));
}

void WebViewHost::sendDesktopIpcReply(uint32_t reqId, bool ok, const WTF::String& resultJson)
{
    auto it = m_pendingIpcReplies.find(reqId);
    if (it != m_pendingIpcReplies.end()) {
        void* block = it->second;
        m_pendingIpcReplies.erase(it);
        if (block) {
            auto fn = reinterpret_cast<void (^)(id, id)>(block);
            if (ok) {
                const auto u = url();
                const bool isCustom = !u.isEmpty() && !u.startsWith("http:"_s) && !u.startsWith("https:"_s) && !u.startsWith("file:"_s) && !u.startsWith("data:"_s) && !u.startsWith("about:"_s);
                if (resultJson.length() >= 131072 && m_webview.m_id && isCustom) {
                    m_pendingIpcBlobs.emplace(reqId, resultJson);
                    fn(objc::NSString::fromWTF(makeString("{\"__bunIpcBlob\":"_s, reqId, '}')).m_id, nullptr);
                } else {
                    fn(objc::NSString::fromWTF(resultJson).m_id, nullptr);
                }
            } else {
                fn(nullptr, objc::NSString::fromWTF(resultJson).m_id);
            }
            _Block_release(block);
        }
        return;
    }
    if (m_closed || !m_webview.m_id) return;
    WTF::CString jsonUtf8 = resultJson.utf8();
    // Escape as JS string literal using JSON-style quoting or base64-free safe helper:
    WTF::StringBuilder js;
    js.append("window.__bunIpcResolve("_s);
    js.append(reqId);
    js.append(ok ? ",true,"_s : ",false,"_s);
    // Wrap in JSON.stringify-safe template by escaping backslash, quotes, newlines:
    js.append('"');
    for (size_t i = 0; i < jsonUtf8.length(); ++i) {
        char c = jsonUtf8.data()[i];
        if (c == '\\' || c == '"') {
            js.append('\\');
            js.append(c);
        } else if (c == '\n')
            js.append("\\n"_s);
        else if (c == '\r')
            js.append("\\r"_s);
        else
            js.append(c);
    }
    js.append("\");"_s);
    m_webview.callAsync(objc::NSString::fromWTF(js.toString()), nullptr, nullptr);
}

void WebViewHost::onDesktopIpcMessageWithReply(const WTF::String& channel, const WTF::String& argsJson, id replyHandler)
{
    if (m_closed) {
        if (replyHandler) {
            reinterpret_cast<void (^)(id, id)>(replyHandler)(nullptr, objc::NSString::fromWTF("Window closed"_s).m_id);
        }
        return;
    }
    uint32_t reqId = m_nextIpcReqId++;
    if (m_nextIpcReqId == 0) m_nextIpcReqId = 1;
    if (replyHandler) {
        m_pendingIpcReplies.emplace(reqId, _Block_copy(replyHandler));
    }
    onDesktopIpcMessage(reqId, true, channel, argsJson);
}

void WebViewHost::dispatchToRenderer(const WTF::String& channel, const WTF::String& argsJson)
{
    if (m_closed || !m_webview.m_id) return;
    WTF::CString chUtf8 = channel.utf8();
    WTF::CString argsUtf8 = argsJson.utf8();
    WTF::StringBuilder js;
    js.append("window.__bunIpcDispatch(\""_s);
    for (size_t i = 0; i < chUtf8.length(); ++i) {
        char c = chUtf8.data()[i];
        if (c == '\\' || c == '"') {
            js.append('\\');
            js.append(c);
        } else
            js.append(c);
    }
    js.append("\",\""_s);
    for (size_t i = 0; i < argsUtf8.length(); ++i) {
        char c = argsUtf8.data()[i];
        if (c == '\\' || c == '"') {
            js.append('\\');
            js.append(c);
        } else if (c == '\n')
            js.append("\\n"_s);
        else if (c == '\r')
            js.append("\\r"_s);
        else
            js.append(c);
    }
    js.append("\");"_s);
    m_webview.callAsync(objc::NSString::fromWTF(js.toString()), nullptr, nullptr);
}

void WebViewHost::sendDesktopIpcBinaryReply(uint32_t reqId, uint16_t status, const uint8_t* dataPtr, uint32_t dataLen)
{
    auto it = m_schemeTasks.find(reqId);
    if (it == m_schemeTasks.end()) return;
    objc::WKURLSchemeTask st(it->second);
    m_schemeTasks.erase(it);
    if (!m_closed) {
        objc::NSURL nsUrl = st.request().URL();
        auto headers = objc::NSMutableDictionary::create();
        headers.setObject(
            objc::NSString::fromWTF(status >= 400 ? "text/plain; charset=utf-8"_s : "application/octet-stream"_s).m_id,
            objc::NSString::fromWTF("Content-Type"_s).m_id);
        headers.setObject(
            objc::NSString::fromWTF("*"_s).m_id,
            objc::NSString::fromWTF("Access-Control-Allow-Origin"_s).m_id);
        auto resp = objc::NSHTTPURLResponse::create(nsUrl, status, headers.m_id);
        st.didReceiveResponse(resp.m_id);
        if (dataLen > 0 && dataPtr) {
            st.didReceiveData(objc::NSData::withBytes(dataPtr, static_cast<unsigned long>(dataLen)).m_id);
        }
        st.didFinish();
    }
    objc::Ref(st.m_id).msg<void>(objc::Ref::s_release);
}

void WebViewHost::onDesktopIpcMessage(uint32_t reqId, bool isInvoke, const WTF::String& channel, const WTF::String& argsJson)
{
    if (m_closed) return;
    WTF::CString ch = channel.utf8();
    WTF::CString args = argsJson.utf8();
    uint32_t chLen = static_cast<uint32_t>(ch.length());
    uint32_t argsLen = static_cast<uint32_t>(args.length());
    WTF::Vector<uint8_t, 128> out;
    out.grow(4 + 1 + 4 + chLen + 4 + argsLen);
    uint8_t* p = out.mutableSpan().data();
    memcpy(p, &reqId, 4);
    p += 4;
    *p++ = isInvoke ? 1 : 0;
    memcpy(p, &chLen, 4);
    p += 4;
    if (chLen) memcpy(p, ch.data(), chLen);
    p += chLen;
    memcpy(p, &argsLen, 4);
    p += 4;
    if (argsLen) memcpy(p, args.data(), argsLen);
    hostWriter()->sendReply(m_viewId, Reply::DesktopIpc, out.span().data(), static_cast<uint32_t>(out.size()));
}

static void appendHostStr(WTF::Vector<uint8_t, 256>& out, const WTF::String& s)
{
    WTF::CString u = s.utf8();
    uint32_t len = static_cast<uint32_t>(u.length());
    size_t off = out.size();
    out.grow(off + 4 + len);
    memcpy(out.mutableSpan().data() + off, &len, 4);
    if (len > 0) memcpy(out.mutableSpan().data() + off + 4, u.data(), len);
}

static WTF::String percentDecodeChannel(const WTF::String& s)
{
    WTF::CString utf8 = s.utf8();
    const char* p = reinterpret_cast<const char*>(utf8.data());
    size_t len = utf8.length();
    WTF::Vector<uint8_t, 128> out;
    out.reserveInitialCapacity(len);
    auto hexVal = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < len; ++i) {
        if (p[i] == '%' && i + 2 < len) {
            int hi = hexVal(p[i + 1]);
            int lo = hexVal(p[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.append(static_cast<uint8_t>((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.append(static_cast<uint8_t>(p[i]));
    }
    return WTF::String::fromUTF8(std::span<const char>(reinterpret_cast<const char*>(out.span().data()), out.size()));
}

void WebViewHost::evaluateDesktopJS(uint32_t reqId, const WTF::String& script)
{
    if (m_closed || !m_webview.m_id) {
        WTF::Vector<uint8_t, 256> out;
        out.grow(5);
        memcpy(out.mutableSpan().data(), &reqId, 4);
        out[4] = 0;
        appendHostStr(out, "Window closed"_s);
        hostWriter()->sendReply(m_viewId, Reply::DesktopEvalResult, out.span().data(), static_cast<uint32_t>(out.size()));
        return;
    }

    struct EvalBlock {
        void* isa;
        int32_t flags;
        int32_t reserved;
        void (*invoke)(EvalBlock*, id, id);
        const HostBlockDescriptor* descriptor;
        Ref<WebViewHost> host;
        uint32_t reqId;
    };
    static const HostBlockDescriptor desc {
        0, sizeof(EvalBlock), nullptr,
        [](const void* p) {
            static_cast<EvalBlock*>(const_cast<void*>(p))->host.~Ref();
        }
    };
    auto* b = static_cast<EvalBlock*>(malloc_zone_malloc(malloc_default_zone(), sizeof(EvalBlock)));
    b->isa = _NSConcreteMallocBlock;
    b->flags = BLOCK_NEEDS_FREE | BLOCK_HAS_COPY_DISPOSE | (1 << 1);
    b->reserved = 0;
    b->reqId = reqId;
    b->descriptor = &desc;
    new (&b->host) Ref<WebViewHost>(*this);
    b->invoke = [](EvalBlock* self, id result, id error) {
        ObjCRuntime::ARPool pool;
        WebViewHost& h = self->host.get();
        if (h.m_closed) return;
        WTF::Vector<uint8_t, 256> out;
        out.grow(5);
        memcpy(out.mutableSpan().data(), &self->reqId, 4);
        if (error) {
            out[4] = 0;
            objc::NSError err(error);
            id msg = objc::NSDictionary(err.userInfo()).objectForKey(objc::NSString::fromWTF("WKJavaScriptExceptionMessage"_s).m_id);
            appendHostStr(out, msg ? objc::NSString(msg).toWTF() : err.localizedDescription());
        } else {
            out[4] = 1;
            WTF::String resStr = objc::Ref(result).isKindOf(objc::NSString::cls)
                ? objc::NSString(result).toWTF()
                : "null"_s;
            appendHostStr(out, resStr);
        }
        hostWriter()->sendReply(h.m_viewId, Reply::DesktopEvalResult, out.span().data(), static_cast<uint32_t>(out.size()));
    };

    auto body = makeString("return JSON.stringify(await ("_s, script, "))"_s);
    m_webview.callAsync(objc::NSString::fromWTF(body), nullptr, b);
    _Block_release(b);
}

void WebViewHost::onSchemeTaskStart(id task)
{
    if (m_closed || !task) return;
    objc::WKURLSchemeTask st(task);
    objc::NSURLRequest req = st.request();
    objc::NSURL nsUrl = req.URL();
    WTF::String url = nsUrl.absoluteString();
    const bool isCustomScheme = !url.isEmpty() && !url.startsWith("http:"_s) && !url.startsWith("https:"_s) && !url.startsWith("file:"_s) && !url.startsWith("data:"_s);

    static constexpr auto kIpcBinMarker = "/__bun_ipc_bin__/"_s;
    auto binMarkerPos = url.find(kIpcBinMarker);
    if (isCustomScheme && binMarkerPos != WTF::notFound
        && !req.headerValue(objc::NSString::fromWTF("x-bun-ipc-invoke"_s)).isEmpty()) {
        WTF::String rawChannel = url.substring(binMarkerPos + kIpcBinMarker.length());
        auto qPos = rawChannel.find('?');
        if (qPos != WTF::notFound) rawChannel = rawChannel.substring(0, qPos);
        WTF::String channel = percentDecodeChannel(rawChannel);

        uint32_t reqId = m_nextSchemeTaskId++;
        objc::Ref(task).retain();
        m_schemeTasks.emplace(reqId, task);

        objc::NSData body = req.HTTPBody();
        std::span<const uint8_t> bodySpan = body.span();
        WTF::CString chUtf8 = channel.utf8();
        uint32_t chLen = static_cast<uint32_t>(chUtf8.length());
        uint32_t dataLen = static_cast<uint32_t>(bodySpan.size());

        WTF::Vector<uint8_t, 256> out;
        out.grow(4 + 4 + chLen + 4 + dataLen);
        uint8_t* p = out.mutableSpan().data();
        memcpy(p, &reqId, 4);
        p += 4;
        memcpy(p, &chLen, 4);
        p += 4;
        if (chLen > 0) memcpy(p, chUtf8.data(), chLen);
        p += chLen;
        memcpy(p, &dataLen, 4);
        p += 4;
        if (dataLen > 0) memcpy(p, bodySpan.data(), dataLen);
        hostWriter()->sendReply(m_viewId, Reply::DesktopIpcBinary, out.span().data(), static_cast<uint32_t>(out.size()));
        return;
    }

    static constexpr auto kIpcBlobMarker = "/__bun_ipc__/"_s;
    auto markerPos = url.find(kIpcBlobMarker);
    if (isCustomScheme && markerPos != WTF::notFound) {
        WTF::String idStr = url.substring(markerPos + kIpcBlobMarker.length());
        uint32_t blobId = 0;
        bool validId = idStr.length() > 0;
        for (unsigned i = 0; i < idStr.length(); ++i) {
            UChar ch = idStr[i];
            if (ch < '0' || ch > '9') {
                validId = false;
                break;
            }
            blobId = blobId * 10 + static_cast<uint32_t>(ch - '0');
        }
        auto bit = validId ? m_pendingIpcBlobs.find(blobId) : m_pendingIpcBlobs.end();
        if (bit == m_pendingIpcBlobs.end()) {
            auto headers = objc::NSMutableDictionary::create();
            auto resp = objc::NSHTTPURLResponse::create(nsUrl, 404, headers.m_id);
            st.didReceiveResponse(resp.m_id);
            st.didFinish();
            return;
        }
        auto utf8 = bit->second.utf8();
        m_pendingIpcBlobs.erase(bit);
        auto headers = objc::NSMutableDictionary::create();
        headers.setObject(
            objc::NSString::fromWTF("application/json; charset=utf-8"_s).m_id,
            objc::NSString::fromWTF("Content-Type"_s).m_id);
        headers.setObject(
            objc::NSString::fromWTF("*"_s).m_id,
            objc::NSString::fromWTF("Access-Control-Allow-Origin"_s).m_id);
        auto resp = objc::NSHTTPURLResponse::create(nsUrl, 200, headers.m_id);
        st.didReceiveResponse(resp.m_id);
        if (utf8.length() > 0) {
            st.didReceiveData(objc::NSData::withBytes(utf8.data(), static_cast<unsigned long>(utf8.length())).m_id);
        }
        st.didFinish();
        return;
    }

    uint32_t taskId = m_nextSchemeTaskId++;
    objc::Ref(task).retain();
    m_schemeTasks.emplace(taskId, task);

    WTF::String method = req.HTTPMethod();
    WTF::String range = req.headerValue(objc::NSString::fromWTF("Range"_s));
    static auto selFn = reinterpret_cast<SEL (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    static SEL s_allHdrs = selFn ? selFn("allHTTPHeaderFields") : nullptr;
    id hdrDict = s_allHdrs ? req.msg<id>(s_allHdrs) : nullptr;
    WTF::String headersJson = hdrDict ? serializeJsonObjC(hdrDict) : "{}"_s;
    objc::NSData body = req.HTTPBody();
    std::span<const uint8_t> bodySpan = body.span();

    WTF::Vector<uint8_t, 256> out;
    out.grow(4);
    memcpy(out.mutableSpan().data(), &taskId, 4);
    appendHostStr(out, url);
    appendHostStr(out, method);
    appendHostStr(out, range);
    appendHostStr(out, headersJson);
    uint32_t bodyLen = static_cast<uint32_t>(bodySpan.size());
    size_t bOff = out.size();
    out.grow(bOff + 4 + bodyLen);
    memcpy(out.mutableSpan().data() + bOff, &bodyLen, 4);
    if (bodyLen > 0) memcpy(out.mutableSpan().data() + bOff + 4, bodySpan.data(), bodyLen);
    hostWriter()->sendReply(m_viewId, Reply::DesktopSchemeRequest, out.span().data(), static_cast<uint32_t>(out.size()));
}

void WebViewHost::onSchemeTaskStop(id task)
{
    if (!task) return;
    for (auto it = m_schemeTasks.begin(); it != m_schemeTasks.end(); ++it) {
        if (it->second == task) {
            objc::Ref(task).msg<void>(objc::Ref::s_release);
            m_schemeTasks.erase(it);
            return;
        }
    }
}

static objc::Owned<objc::NSMutableDictionary> parseHeadersJson(const WTF::String& json)
{
    auto dict = objc::NSMutableDictionary::create();
    WTF::CString utf8 = json.utf8();
    const char* p = reinterpret_cast<const char*>(utf8.data());
    const char* end = p + utf8.length();
    auto skipWs = [&]() {
        while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r'))
            ++p;
    };
    auto readStr = [&](WTF::Vector<char, 128>& out) -> bool {
        skipWs();
        if (p >= end || *p != '"') return false;
        ++p;
        out.clear();
        while (p < end && *p != '"') {
            if (*p == '\\' && p + 1 < end) {
                ++p;
                switch (*p) {
                case 'n':
                    out.append('\n');
                    break;
                case 'r':
                    out.append('\r');
                    break;
                case 't':
                    out.append('\t');
                    break;
                default:
                    out.append(*p);
                    break;
                }
            } else {
                out.append(*p);
            }
            ++p;
        }
        if (p >= end || *p != '"') return false;
        ++p;
        out.append('\0');
        return true;
    };
    skipWs();
    if (p >= end || *p != '{') return dict;
    ++p;
    WTF::Vector<char, 128> key, val;
    while (p < end) {
        skipWs();
        if (p < end && *p == '}') break;
        if (!readStr(key)) break;
        skipWs();
        if (p >= end || *p != ':') break;
        ++p;
        if (!readStr(val)) break;
        dict.setObject(
            objc::NSString::fromWTF(WTF::String::fromUTF8(val.span().data())).m_id,
            objc::NSString::fromWTF(WTF::String::fromUTF8(key.span().data())).m_id);
        skipWs();
        if (p < end && *p == ',') ++p;
    }
    return dict;
}

void WebViewHost::sendSchemeResponse(
    uint32_t taskId,
    uint16_t status,
    uint8_t kind,
    const WTF::String& headersJson,
    const uint8_t* bytesPtr,
    uint32_t bytesLen,
    const WTF::String& filePath,
    uint64_t offset,
    uint64_t length)
{
    auto it = m_schemeTasks.find(taskId);
    if (it == m_schemeTasks.end()) return;
    id rawTask = it->second;
    m_schemeTasks.erase(it);

    objc::WKURLSchemeTask task(rawTask);
    objc::NSURL url = task.request().URL();

    if (kind == 2) {
        auto err = objc::NSError::create(objc::NSString::fromWTF("BunDesktopError"_s), status ? status : -1, nullptr);
        task.didFailWithError(err.m_id);
        objc::Ref(rawTask).msg<void>(objc::Ref::s_release);
        return;
    }

    auto headers = parseHeadersJson(headersJson);
    auto resp = objc::NSHTTPURLResponse::create(url, static_cast<long>(status ? status : 200), headers.m_id);

    if (kind == 1) {
        WTF::CString pathUtf8 = filePath.utf8();
        int fd = ::open(reinterpret_cast<const char*>(pathUtf8.data()), O_RDONLY);
        if (fd < 0) {
            auto err = objc::NSError::create(objc::NSString::fromWTF("NSPOSIXErrorDomain"_s), errno, nullptr);
            task.didFailWithError(err.m_id);
            objc::Ref(rawTask).msg<void>(objc::Ref::s_release);
            return;
        }
        task.didReceiveResponse(resp.m_id);
        size_t chunkCap = static_cast<size_t>(std::min<uint64_t>(length > 0 ? length : 65536, 1048576));
        WTF::Vector<uint8_t> buf(chunkCap);
        uint64_t remaining = length;
        uint64_t cur = offset;
        while (remaining > 0) {
            size_t toRead = remaining > chunkCap ? chunkCap : static_cast<size_t>(remaining);
            ssize_t n = ::pread(fd, buf.mutableSpan().data(), toRead, static_cast<off_t>(cur));
            if (n <= 0) break;
            task.didReceiveData(objc::NSData::withBytes(buf.span().data(), static_cast<unsigned long>(n)).m_id);
            cur += static_cast<uint64_t>(n);
            remaining -= static_cast<uint64_t>(n);
        }
        ::close(fd);
        task.didFinish();
        objc::Ref(rawTask).msg<void>(objc::Ref::s_release);
        return;
    }

    task.didReceiveResponse(resp.m_id);
    if (bytesLen > 0 && bytesPtr) {
        task.didReceiveData(objc::NSData::withBytes(bytesPtr, bytesLen).m_id);
    }
    task.didFinish();
    objc::Ref(rawTask).msg<void>(objc::Ref::s_release);
}

} // namespace Bun

#endif // OS(DARWIN)
