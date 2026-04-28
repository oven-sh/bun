#include "root.h"

#if OS(DARWIN)

#include "ObjCRuntime.h"
#include "WebViewHost.h"
#include <dlfcn.h>
#include <mach/mach.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/HashMap.h>
#include <mutex>

namespace Bun {

// --- Static storage for wrapper types --------------------------------------
namespace objc {

void* Ref::s_msgSend;
SEL Ref::s_alloc;
SEL Ref::s_init;
SEL Ref::s_release;
SEL Ref::s_retain;
SEL Ref::s_description;

Class NSString::cls;
SEL NSString::s_stringWithUTF8String;
SEL NSString::s_UTF8String;

Class NSURL::cls;
SEL NSURL::s_URLWithString;
SEL NSURL::s_fileURLWithPath_isDirectory;
SEL NSURL::s_absoluteString;

Class NSURLRequest::cls;
SEL NSURLRequest::s_requestWithURL;

SEL NSError::s_localizedDescription;
SEL NSError::s_userInfo;

SEL NSData::s_bytes;
SEL NSData::s_length;

Class NSNumber::cls;
SEL NSNumber::s_numberWithDouble;

SEL NSArray::s_count;
SEL NSArray::s_objectAtIndex;

Class NSDictionary::cls;
SEL NSDictionary::s_dictionaryWithObjects_forKeys_count;
SEL NSDictionary::s_objectForKey;

Class NSApplication::cls;
SEL NSApplication::s_sharedApplication;
SEL NSApplication::s_setActivationPolicy;

Class NSWindow::cls;
Class NSWindow::hostCls;
SEL NSWindow::s_initWithContentRect_styleMask_backing_defer;
SEL NSWindow::s_setReleasedWhenClosed;
SEL NSWindow::s_setContentView;
SEL NSWindow::s_setContentSize;
SEL NSWindow::s_close;

SEL NSView::s_setFrame;

Class NSBitmapImageRep::cls;
SEL NSBitmapImageRep::s_initWithCGImage;
SEL NSBitmapImageRep::s_representationUsingType_properties;

SEL NSImage::s_CGImageForProposedRect_context_hints;

SEL NSWindow::s_windowNumber;
SEL NSWindow::s_convertPointToScreen;
SEL NSWindow::s_orderBack;
SEL NSWindow::s_setAlphaValue;
SEL NSWindow::s_setIgnoresMouseEvents;

Class NSProcessInfo::cls;
SEL NSProcessInfo::s_processInfo;
SEL NSProcessInfo::s_systemUptime;
SEL NSProcessInfo::s_beginActivityWithOptions_reason;

Class NSEvent::cls;
SEL NSEvent::s_mouseEventWithType;
SEL NSEvent::s_keyEventWithType;
SEL NSEvent::s_eventWithCGEvent;
SEL NSEvent::s_eventRelativeToWindow;
void* (*NSEvent::s_CGEventCreateScrollWheelEvent)(void*, uint32_t, uint32_t, int32_t, ...);
void (*NSEvent::s_CGEventSetLocation)(void*, CGPoint);
uint32_t (*NSEvent::s_CGMainDisplayID)();
CGRect (*NSEvent::s_CGDisplayBounds)(uint32_t);
void (*NSEvent::s_CFRelease)(void*);
uint32_t NSEvent::s_trackedButtonsMask = 0;

SEL WKWebView::s_mouseDown;
SEL WKWebView::s_mouseUp;
SEL WKWebView::s_rightMouseDown;
SEL WKWebView::s_rightMouseUp;
SEL WKWebView::s_otherMouseDown;
SEL WKWebView::s_otherMouseUp;
SEL WKWebView::s_simulateMouseMove;
SEL WKWebView::s_mouseDragged;
SEL WKWebView::s_rightMouseDragged;
SEL WKWebView::s_otherMouseDragged;
SEL WKWebView::s_keyDown;
SEL WKWebView::s_keyUp;
SEL WKWebView::s_scrollWheel;
SEL WKWebView::s_setAutomaticQuoteSubstitutionEnabled;
SEL WKWebView::s_setAutomaticDashSubstitutionEnabled;
SEL WKWebView::s_setAutomaticTextReplacementEnabled;
SEL WKWebView::s_setWindowOcclusionDetectionEnabled;
SEL WKWebView::s_executeEditCommand;
SEL WKWebView::s_doAfterPendingMouseEvents;
SEL WKWebView::s_doAfterNextPresentationUpdate;
Class WKWebView::cls_WKContentWorld;
SEL WKWebView::s_pageWorld;
SEL WKWebView::s_callAsyncJavaScript;

Class WKWebViewConfiguration::cls;
Class WKWebViewConfiguration::cls_WKWebsiteDataStore;
Class WKWebViewConfiguration::cls_WKWebsiteDataStoreConfiguration;
SEL WKWebViewConfiguration::s_nonPersistentDataStore;
SEL WKWebViewConfiguration::s_initWithDirectory;
SEL WKWebViewConfiguration::s_initWithConfiguration;

// Keyed by directory path. Stores live for the process: each WKWebsiteDataStore
// runs its own NetworkProcess session, so two instances at the same path don't
// share committed state. Retained once on insert, never released.
id WKWebViewConfiguration::persistentStoreForDirectory(const WTF::String& directory)
{
    static NeverDestroyed<HashMap<WTF::String, id>> cache;
    auto it = cache->find(directory);
    if (it != cache->end()) return it->value;

    NSURL dirURL = NSURL::fileURL(NSString::fromWTF(directory), true);
    Ref storeCfg(msgCls<id>(cls_WKWebsiteDataStoreConfiguration, s_alloc));
    storeCfg.m_id = storeCfg.msg<id>(s_initWithDirectory, dirURL.m_id);
    Ref store(msgCls<id>(cls_WKWebsiteDataStore, s_alloc));
    store.m_id = store.msg<id>(s_initWithConfiguration, storeCfg.m_id);
    storeCfg.release();

    cache->add(directory, store.m_id);
    return store.m_id;
}
SEL WKWebViewConfiguration::s_setWebsiteDataStore;
SEL WKWebViewConfiguration::s_userContentController;
SEL WKWebViewConfiguration::s_preferences;
SEL WKWebViewConfiguration::s_setPageVisibilityBasedProcessSuppressionEnabled;

Class WKUserScript::cls;
SEL WKUserScript::s_initWithSource_injectionTime_forMainFrameOnly;

SEL WKUserContentController::s_addScriptMessageHandler_name;
SEL WKUserContentController::s_addUserScript;

SEL WKScriptMessage::s_body;

Class WKWebView::cls;
Class WKWebView::cls_WKSnapshotConfiguration;
SEL WKWebView::s_initWithFrame_configuration;
SEL WKWebView::s_setNavigationDelegate;
SEL WKWebView::s_setUIDelegate;
SEL WKWebView::s_loadRequest;
SEL WKWebView::s_stopLoading;
SEL WKWebView::s_reload;
SEL WKWebView::s_canGoBack;
SEL WKWebView::s_canGoForward;
SEL WKWebView::s_goBack;
SEL WKWebView::s_goForward;
SEL WKWebView::s_isLoading;
SEL WKWebView::s_URL;
SEL WKWebView::s_title;
SEL WKWebView::s_setAfterScreenUpdates;
SEL WKWebView::s_takeSnapshotWithConfiguration_completionHandler;

Class NavigationDelegate::cls;
void (*NavigationDelegate::s_setAssoc)(id, const void*, id, uintptr_t);
id (*NavigationDelegate::s_getAssoc)(id, const void*);
char NavigationDelegate::s_hostKey = 0;

} // namespace objc

// --- Delegate IMPs ---------------------------------------------------------
// Installed on the runtime-registered BunWKNavigationDelegate class.

extern "C" {

static void delegateDidFinishNavigation(id self, SEL, id /*webView*/, id /*navigation*/)
{
    ObjCRuntime::ARPool pool;
    if (auto* host = objc::NavigationDelegate(self).host()) host->onNavigationFinished();
}

static void delegateDidFailNavigation(id self, SEL, id /*webView*/, id /*navigation*/, id error)
{
    ObjCRuntime::ARPool pool;
    if (auto* host = objc::NavigationDelegate(self).host()) {
        host->onNavigationFailed(objc::NSError(error).localizedDescription());
    }
}

static void delegateDidFailProvisionalNavigation(id self, SEL _cmd, id webView, id navigation, id error)
{
    delegateDidFailNavigation(self, _cmd, webView, navigation, error);
}

// userContentController:didReceiveScriptMessage:
// (WKScriptMessageHandler). The console-capture user script posts
// {type: NSString, args: NSArray<NSString>} — each arg is a
// JSON.stringify of the console argument. Pack and IPC to the parent.
static void delegateDidReceiveScriptMessage(id self, SEL, id /*controller*/, id message)
{
    ObjCRuntime::ARPool pool;
    auto* host = objc::NavigationDelegate(self).host();
    if (!host) return;
    objc::NSDictionary body(objc::WKScriptMessage(message).body());
    id type = body.objectForKey(objc::NSString::fromWTF("type"_s).m_id);
    id args = body.objectForKey(objc::NSString::fromWTF("args"_s).m_id);
    host->onConsoleMessage(type, args);
}

// _webView:getContextMenuFromProposedMenu:forElement:userInfo:completionHandler:
// (WKUIDelegatePrivate, macOS 10.14+). With ActivityState::IsVisible set,
// right-click opens NSMenu's modal runloop — rightMouseDown → XPC
// contextmenu → WebContextMenuProxyMac::show blocks in runModalForWindow.
// Calling the completion with nil suppresses it without touching the page's
// own contextmenu handling.
static void delegateGetContextMenu(id, SEL, id /*web*/, id /*menu*/, id /*element*/, id /*userInfo*/, void* handler)
{
    // The block's invoke is at offset 16 (isa + flags + reserved). The
    // signature is void(^)(NSMenu*); call with nil.
    struct {
        void* isa;
        int32_t flags;
        int32_t reserved;
        void (*invoke)(void*, id);
    }* block
        = reinterpret_cast<decltype(block)>(handler);
    block->invoke(handler, nullptr);
}

// NSResponder's default noResponderFor: beeps when the selector is keyDown:.
// WebContent doesn't consume press("Escape") (page listener observes but
// doesn't preventDefault) → bounces up the chain → ding. Swallow it.
static void windowNoResponderFor(id, SEL, SEL) {}

// -isVisible / -isKeyWindow overrides — same as WebKit's own
// TestWebKitAPI/OffscreenWindow.mm. PageClientImpl::isViewVisible checks
// activeViewWindow.isVisible directly; orderFront: sets the flag but on
// macOS 13/14 the catch-up activityStateDidChange doesn't reliably land
// before the first navigate() launches the WebContent process, so
// creationParameters ships IsVisible=false and rAF never ticks.
// Unconditional YES sidesteps the orderFront timing entirely —
// isViewVisible() sees visible from the first evaluation, regardless of
// when (or whether) NSWindowDidOrderOnScreenNotification fires.
// isKeyWindow is for WindowIsActive (not rAF-gating but free to add).
static signed char windowIsVisible(id, SEL) { return 1; }
static signed char windowIsKeyWindow(id, SEL) { return 1; }

// -screen override — at (-10000,-10000) the real NSWindow.screen is nil.
// WebViewImpl::windowDidChangeScreen reads it for displayID. nil → 0 →
// CVDisplayLinkCreateWithCGDisplay(0): on macOS 15 it binds to the main
// display and ticks; on macOS 13/14 it doesn't reliably fire and rAF hangs.
//
// [[NSScreen screens] firstObject] is the screen with the menu bar —
// always present when WindowServer has a session. [NSScreen mainScreen]
// is documented as "the screen with the key window" which is nil until
// some window becomes key (our isKeyWindow override doesn't make AppKit's
// internal _keyWindow point at us). WebKitTestRunner uses firstObject
// (PlatformWebViewMac.mm:77) for the same reason.
static Class s_NSScreenClass;
static SEL s_screensSel;
static SEL s_firstObjectSel;
static id windowScreen(id, SEL)
{
    id screens = objc::Ref::msgCls<id>(s_NSScreenClass, s_screensSel);
    return objc::Ref(screens).msg<id>(s_firstObjectSel);
}

} // extern "C"

// --- Loading ---------------------------------------------------------------

bool ObjCRuntime::load()
{
    using namespace objc;

    // --- dlopen frameworks ------------------------------------------------
    void* libobjc = dlopen("/usr/lib/libobjc.A.dylib", RTLD_LAZY | RTLD_LOCAL);
    if (!libobjc) {
        m_loadError = WTF::String::fromUTF8(dlerror());
        return false;
    }

    // AppKit pulls in Foundation (NSString, NSURL, NSWindow, NSBitmapImageRep).
    // CoreFoundation is transitive. host_main.cpp dlopens CF separately for
    // the CFFileDescriptor / CFRunLoop symbols it owns.
    void* appkit = dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", RTLD_LAZY | RTLD_LOCAL);
    void* webkit = dlopen("/System/Library/Frameworks/WebKit.framework/WebKit", RTLD_LAZY | RTLD_LOCAL);
    if (!appkit || !webkit) {
        m_loadError = WTF::String::fromUTF8(dlerror());
        return false;
    }

    // --- libobjc ----------------------------------------------------------
#define SYM(var, handle, name)                                      \
    do {                                                            \
        var = reinterpret_cast<decltype(var)>(dlsym(handle, name)); \
        if (!var) {                                                 \
            m_loadError = "missing symbol: " name ""_s;             \
            return false;                                           \
        }                                                           \
    } while (0)

    void* msgSend = dlsym(libobjc, "objc_msgSend");
    Class (*getClass)(const char*);
    SEL (*sel)(const char*);
    Class (*allocateClassPair)(Class, const char*, size_t);
    BOOL (*addMethod)(Class, SEL, IMP, const char*);
    BOOL (*addProtocol)(Class, Protocol*);
    Protocol* (*getProtocol)(const char*);
    void (*registerClassPair)(Class);

    Method (*getClassMethod)(Class, SEL);
    IMP (*methodSetImplementation)(Method, IMP);

    SYM(getClass, libobjc, "objc_getClass");
    SYM(sel, libobjc, "sel_registerName");
    SYM(allocateClassPair, libobjc, "objc_allocateClassPair");
    SYM(addMethod, libobjc, "class_addMethod");
    SYM(addProtocol, libobjc, "class_addProtocol");
    SYM(getProtocol, libobjc, "objc_getProtocol");
    SYM(registerClassPair, libobjc, "objc_registerClassPair");
    SYM(getClassMethod, libobjc, "class_getClassMethod");
    SYM(methodSetImplementation, libobjc, "method_setImplementation");
    SYM(NavigationDelegate::s_setAssoc, libobjc, "objc_setAssociatedObject");
    SYM(NavigationDelegate::s_getAssoc, libobjc, "objc_getAssociatedObject");
    SYM(m_autoreleasePoolPush, libobjc, "objc_autoreleasePoolPush");
    SYM(m_autoreleasePoolPop, libobjc, "objc_autoreleasePoolPop");
    if (!msgSend) {
        m_loadError = "missing symbol: objc_msgSend"_s;
        return false;
    }

#undef SYM

    // --- populate Ref (shared) --------------------------------------------
    Ref::s_msgSend = msgSend;
    Ref::s_alloc = sel("alloc");
    Ref::s_init = sel("init");
    Ref::s_release = sel("release");
    Ref::s_retain = sel("retain");
    Ref::s_description = sel("description");

    // --- populate wrapper classes -----------------------------------------
    // A missing class at load time beats a nil-message (silent no-op) at
    // call time.
#define CLS(var, name)                                 \
    do {                                               \
        var = getClass(name);                          \
        if (!var) {                                    \
            m_loadError = "missing class: " name ""_s; \
            return false;                              \
        }                                              \
    } while (0)

    CLS(NSString::cls, "NSString");
    NSString::s_stringWithUTF8String = sel("stringWithUTF8String:");
    NSString::s_UTF8String = sel("UTF8String");

    CLS(NSURL::cls, "NSURL");
    NSURL::s_URLWithString = sel("URLWithString:");
    NSURL::s_fileURLWithPath_isDirectory = sel("fileURLWithPath:isDirectory:");
    NSURL::s_absoluteString = sel("absoluteString");

    CLS(NSURLRequest::cls, "NSURLRequest");
    NSURLRequest::s_requestWithURL = sel("requestWithURL:");

    NSError::s_localizedDescription = sel("localizedDescription");
    NSError::s_userInfo = sel("userInfo");

    NSData::s_bytes = sel("bytes");
    NSData::s_length = sel("length");

    CLS(NSNumber::cls, "NSNumber");
    NSNumber::s_numberWithDouble = sel("numberWithDouble:");

    NSArray::s_count = sel("count");
    NSArray::s_objectAtIndex = sel("objectAtIndex:");

    CLS(NSDictionary::cls, "NSDictionary");
    NSDictionary::s_dictionaryWithObjects_forKeys_count = sel("dictionaryWithObjects:forKeys:count:");
    NSDictionary::s_objectForKey = sel("objectForKey:");

    CLS(NSApplication::cls, "NSApplication");
    NSApplication::s_sharedApplication = sel("sharedApplication");
    NSApplication::s_setActivationPolicy = sel("setActivationPolicy:");

    CLS(NSWindow::cls, "NSWindow");
    NSWindow::s_initWithContentRect_styleMask_backing_defer = sel("initWithContentRect:styleMask:backing:defer:");
    NSWindow::s_setReleasedWhenClosed = sel("setReleasedWhenClosed:");
    NSWindow::s_setContentView = sel("setContentView:");
    NSWindow::s_setContentSize = sel("setContentSize:");
    NSWindow::s_close = sel("close");

    NSView::s_setFrame = sel("setFrame:");

    CLS(NSBitmapImageRep::cls, "NSBitmapImageRep");
    NSBitmapImageRep::s_initWithCGImage = sel("initWithCGImage:");
    NSBitmapImageRep::s_representationUsingType_properties = sel("representationUsingType:properties:");

    NSImage::s_CGImageForProposedRect_context_hints = sel("CGImageForProposedRect:context:hints:");

    NSWindow::s_windowNumber = sel("windowNumber");
    NSWindow::s_convertPointToScreen = sel("convertPointToScreen:");
    NSWindow::s_orderBack = sel("orderBack:");
    NSWindow::s_setAlphaValue = sel("setAlphaValue:");
    NSWindow::s_setIgnoresMouseEvents = sel("setIgnoresMouseEvents:");

    CLS(NSProcessInfo::cls, "NSProcessInfo");
    NSProcessInfo::s_processInfo = sel("processInfo");
    NSProcessInfo::s_systemUptime = sel("systemUptime");
    NSProcessInfo::s_beginActivityWithOptions_reason = sel("beginActivityWithOptions:reason:");

    CLS(NSEvent::cls, "NSEvent");
    NSEvent::s_mouseEventWithType = sel("mouseEventWithType:location:modifierFlags:timestamp:windowNumber:context:eventNumber:clickCount:pressure:");
    NSEvent::s_keyEventWithType = sel("keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:");
    NSEvent::s_eventWithCGEvent = sel("eventWithCGEvent:");
    NSEvent::s_eventRelativeToWindow = sel("_eventRelativeToWindow:");
    // CoreGraphics — transitive dep of AppKit. RTLD_DEFAULT finds it.
    NSEvent::s_CGEventCreateScrollWheelEvent = reinterpret_cast<decltype(NSEvent::s_CGEventCreateScrollWheelEvent)>(
        dlsym(RTLD_DEFAULT, "CGEventCreateScrollWheelEvent"));
    NSEvent::s_CGEventSetLocation = reinterpret_cast<decltype(NSEvent::s_CGEventSetLocation)>(
        dlsym(RTLD_DEFAULT, "CGEventSetLocation"));
    NSEvent::s_CGMainDisplayID = reinterpret_cast<decltype(NSEvent::s_CGMainDisplayID)>(
        dlsym(RTLD_DEFAULT, "CGMainDisplayID"));
    NSEvent::s_CGDisplayBounds = reinterpret_cast<decltype(NSEvent::s_CGDisplayBounds)>(
        dlsym(RTLD_DEFAULT, "CGDisplayBounds"));
    NSEvent::s_CFRelease = reinterpret_cast<decltype(NSEvent::s_CFRelease)>(
        dlsym(RTLD_DEFAULT, "CFRelease"));
    if (!NSEvent::s_CGEventCreateScrollWheelEvent || !NSEvent::s_CGEventSetLocation
        || !NSEvent::s_CGMainDisplayID || !NSEvent::s_CGDisplayBounds || !NSEvent::s_CFRelease) {
        m_loadError = "missing CoreGraphics symbols"_s;
        return false;
    }

    // Swap +[NSEvent pressedMouseButtons] to return NSEvent::s_trackedButtonsMask.
    // Rationale: WebCore's PlatformEventFactoryMac.mm computes DOM
    // event.buttons for every synthesized mouse event by calling
    // +[NSEvent pressedMouseButtons]. That returns system-wide HID state
    // (not derived from the NSEvent we pass), so synthetic mousedown /
    // drag / contextmenu all got event.buttons=0 — failing the
    // spec-compliant assertion that event.buttons reflects the button
    // being pressed (= 1 for left mousedown, = 2 for right, = 4 for
    // middle). This is the same workaround Safari's automation uses
    // (WebAutomationSessionMac.mm:80, scope-limited with a swizzle);
    // ours is permanent since the host process never handles real input.
    //
    // Non-fatal if it fails: event.buttons falls back to 0, drag tests
    // that rely on it break, but the rest of the input API still works.
    // Logged via m_loadError but we continue.
    auto pressedMouseButtonsImpl = +[](id, SEL) -> unsigned long {
        return NSEvent::s_trackedButtonsMask;
    };
    if (Method m = getClassMethod(NSEvent::cls, sel("pressedMouseButtons")))
        methodSetImplementation(m, reinterpret_cast<IMP>(pressedMouseButtonsImpl));

    CLS(WKWebViewConfiguration::cls, "WKWebViewConfiguration");
    CLS(WKWebViewConfiguration::cls_WKWebsiteDataStore, "WKWebsiteDataStore");
    // _WKWebsiteDataStoreConfiguration is SPI but stable since macOS 10.13.
    // initWithDirectory: is 15.2+.
    CLS(WKWebViewConfiguration::cls_WKWebsiteDataStoreConfiguration, "_WKWebsiteDataStoreConfiguration");
    WKWebViewConfiguration::s_nonPersistentDataStore = sel("nonPersistentDataStore");
    WKWebViewConfiguration::s_initWithDirectory = sel("initWithDirectory:");
    WKWebViewConfiguration::s_initWithConfiguration = sel("_initWithConfiguration:");
    WKWebViewConfiguration::s_setWebsiteDataStore = sel("setWebsiteDataStore:");
    WKWebViewConfiguration::s_userContentController = sel("userContentController");
    WKWebViewConfiguration::s_preferences = sel("preferences");
    WKWebViewConfiguration::s_setPageVisibilityBasedProcessSuppressionEnabled = sel("_setPageVisibilityBasedProcessSuppressionEnabled:");

    CLS(WKUserScript::cls, "WKUserScript");
    WKUserScript::s_initWithSource_injectionTime_forMainFrameOnly = sel("initWithSource:injectionTime:forMainFrameOnly:");

    WKUserContentController::s_addScriptMessageHandler_name = sel("addScriptMessageHandler:name:");
    WKUserContentController::s_addUserScript = sel("addUserScript:");

    WKScriptMessage::s_body = sel("body");

    CLS(WKWebView::cls, "WKWebView");
    CLS(WKWebView::cls_WKSnapshotConfiguration, "WKSnapshotConfiguration");
    WKWebView::s_initWithFrame_configuration = sel("initWithFrame:configuration:");
    WKWebView::s_setNavigationDelegate = sel("setNavigationDelegate:");
    WKWebView::s_setUIDelegate = sel("setUIDelegate:");
    WKWebView::s_loadRequest = sel("loadRequest:");
    WKWebView::s_stopLoading = sel("stopLoading");
    WKWebView::s_reload = sel("reload");
    WKWebView::s_canGoBack = sel("canGoBack");
    WKWebView::s_canGoForward = sel("canGoForward");
    WKWebView::s_goBack = sel("goBack");
    WKWebView::s_goForward = sel("goForward");
    WKWebView::s_isLoading = sel("isLoading");
    WKWebView::s_URL = sel("URL");
    WKWebView::s_title = sel("title");
    WKWebView::s_setAfterScreenUpdates = sel("setAfterScreenUpdates:");
    WKWebView::s_takeSnapshotWithConfiguration_completionHandler = sel("takeSnapshotWithConfiguration:completionHandler:");
    WKWebView::s_mouseDown = sel("mouseDown:");
    WKWebView::s_mouseUp = sel("mouseUp:");
    WKWebView::s_rightMouseDown = sel("rightMouseDown:");
    WKWebView::s_rightMouseUp = sel("rightMouseUp:");
    WKWebView::s_otherMouseDown = sel("otherMouseDown:");
    WKWebView::s_otherMouseUp = sel("otherMouseUp:");
    WKWebView::s_simulateMouseMove = sel("_simulateMouseMove:");
    WKWebView::s_mouseDragged = sel("mouseDragged:");
    WKWebView::s_rightMouseDragged = sel("rightMouseDragged:");
    WKWebView::s_otherMouseDragged = sel("otherMouseDragged:");
    WKWebView::s_keyDown = sel("keyDown:");
    WKWebView::s_keyUp = sel("keyUp:");
    WKWebView::s_scrollWheel = sel("scrollWheel:");
    WKWebView::s_setAutomaticQuoteSubstitutionEnabled = sel("setAutomaticQuoteSubstitutionEnabled:");
    WKWebView::s_setAutomaticDashSubstitutionEnabled = sel("setAutomaticDashSubstitutionEnabled:");
    WKWebView::s_setAutomaticTextReplacementEnabled = sel("setAutomaticTextReplacementEnabled:");
    WKWebView::s_setWindowOcclusionDetectionEnabled = sel("_setWindowOcclusionDetectionEnabled:");
    WKWebView::s_executeEditCommand = sel("_executeEditCommand:argument:completion:");
    WKWebView::s_doAfterPendingMouseEvents = sel("_doAfterProcessingAllPendingMouseEvents:");
    WKWebView::s_doAfterNextPresentationUpdate = sel("_doAfterNextPresentationUpdate:");
    CLS(WKWebView::cls_WKContentWorld, "WKContentWorld");
    WKWebView::s_pageWorld = sel("pageWorld");
    WKWebView::s_callAsyncJavaScript = sel("callAsyncJavaScript:arguments:inFrame:inContentWorld:completionHandler:");
#undef CLS

    // --- register BunWKNavigationDelegate : NSObject <WKNavigationDelegate>
    Class nsobject = getClass("NSObject");
    NavigationDelegate::cls = allocateClassPair(nsobject, "BunWKNavigationDelegate", 0);
    if (!NavigationDelegate::cls) {
        m_loadError = "failed to allocate delegate class"_s;
        return false;
    }
    // Type encodings: v = void, @ = id, : = SEL.
    addMethod(NavigationDelegate::cls, sel("webView:didFinishNavigation:"),
        reinterpret_cast<IMP>(delegateDidFinishNavigation), "v@:@@");
    addMethod(NavigationDelegate::cls, sel("webView:didFailNavigation:withError:"),
        reinterpret_cast<IMP>(delegateDidFailNavigation), "v@:@@@");
    addMethod(NavigationDelegate::cls, sel("webView:didFailProvisionalNavigation:withError:"),
        reinterpret_cast<IMP>(delegateDidFailProvisionalNavigation), "v@:@@@");
    // Also adopt WKUIDelegate to suppress context menus. The method is
    // in WKUIDelegatePrivate but protocol adoption isn't checked for it;
    // WebKit does respondsToSelector:.
    addMethod(NavigationDelegate::cls,
        sel("_webView:getContextMenuFromProposedMenu:forElement:userInfo:completionHandler:"),
        reinterpret_cast<IMP>(delegateGetContextMenu), "v@:@@@@@?");
    addMethod(NavigationDelegate::cls,
        sel("userContentController:didReceiveScriptMessage:"),
        reinterpret_cast<IMP>(delegateDidReceiveScriptMessage), "v@:@@");
    if (Protocol* proto = getProtocol("WKNavigationDelegate")) addProtocol(NavigationDelegate::cls, proto);
    if (Protocol* proto = getProtocol("WKUIDelegate")) addProtocol(NavigationDelegate::cls, proto);
    if (Protocol* proto = getProtocol("WKScriptMessageHandler")) addProtocol(NavigationDelegate::cls, proto);
    registerClassPair(NavigationDelegate::cls);

    // --- register BunHostWindow : NSWindow -------------------------------
    NSWindow::hostCls = allocateClassPair(NSWindow::cls, "BunHostWindow", 0);
    if (!NSWindow::hostCls) {
        m_loadError = "failed to allocate window class"_s;
        return false;
    }
    addMethod(NSWindow::hostCls, sel("noResponderFor:"),
        reinterpret_cast<IMP>(windowNoResponderFor), "v@::");
    // 'c' = signed char = BOOL on all our targets (arm64 & x64 macOS).
    addMethod(NSWindow::hostCls, sel("isVisible"),
        reinterpret_cast<IMP>(windowIsVisible), "c@:");
    addMethod(NSWindow::hostCls, sel("isKeyWindow"),
        reinterpret_cast<IMP>(windowIsKeyWindow), "c@:");
    // '@' = id return. windowScreen reads file-static s_NSScreenClass which
    // we populate here, not a wrapper struct — NSScreen is only used in the
    // override's body, nowhere else.
    s_NSScreenClass = getClass("NSScreen");
    s_screensSel = sel("screens");
    s_firstObjectSel = sel("firstObject");
    addMethod(NSWindow::hostCls, sel("screen"),
        reinterpret_cast<IMP>(windowScreen), "@@:");
    registerClassPair(NSWindow::hostCls);

    NSApplication::setActivationPolicyAccessory();

    m_loaded = true;
    return true;
}

ObjCRuntime* ObjCRuntime::tryLoad()
{
    static LazyNeverDestroyed<ObjCRuntime> runtime;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        runtime.construct();
        runtime->load();
    });
    return &runtime.get();
}

} // namespace Bun

#endif // OS(DARWIN)
