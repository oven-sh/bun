#pragma once

#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "ExceptionOr.h"
#include "WebCoreOpaqueRoot.h"
#include <JavaScriptCore/Strong.h>
#include <wtf/MonotonicTime.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Variant.h>
#include <wtf/WeakHashSet.h>

namespace WebCore {

class CSSStyleDeclaration;
class CustomElementRegistry;
class DOMSelection;
class Document;
class Element;
class HTMLFrameElementBase;
class History;
class Location;
class MediaQueryList;
class Node;
class Navigator;
class RequestAnimationFrameCallback;
class Screen;
class Storage;
class XMLHttpRequest;

// The `window` of a `bun:dom` document. It has no navigation or rendering.
//
// A window owns its document, and the document points back weakly. Their JS wrappers share an
// opaque root, so holding either one keeps both alive.
//
// A frame element that is connected owns the window in it, and that window points back weakly. There is no Frame.
// Every window has a wrapper from the start, and a frame's window adds the opaque root of the document the frame element is in.
// So for the collector a window and the windows of its frames live and die together.
class Window final : public RefCounted<Window>, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(Window);

public:
    struct Options {
        String url;
    };
    static ExceptionOr<Ref<Window>> create(ScriptExecutionContext&, Options&&);
    // The window in a frame. Its document is empty.
    static Ref<Window> createForFrame(HTMLFrameElementBase&, const URL&);
    ~Window();

    using RefCounted::deref;
    using RefCounted::ref;

    Window& window() { return *this; }

    // Whether script knows this window as `globalThis`, and gets that instead of the wrapper: jsFunctionSetGlobalObjectWindow().
    bool isGlobalThis() const { return m_isGlobalThis; }
    void setIsGlobalThis(bool isGlobalThis) { m_isGlobalThis = isGlobalThis; }

    Window* opener() const { return m_opener.get(); }
    ExceptionOr<RefPtr<Window>> open(const String& url, const String& target, const String& features);

    // Null once the frame element is no longer connected.
    Window* parent() const;
    Window* top() const;
    Element* frameElement() const;
    // Closes the window too. It runs no script: the frame element is being removed or destroyed.
    void disconnectFrameElement(HTMLFrameElementBase&);
    // In a microtask: closes the document of a frame's window, which fires `load`, or only fires `load` at that window if the document is closed.
    void finishLoadingFrameSoon(Window& frameWindow);

    // The windows of the frames in the document tree, in tree order. A frame in a shadow tree has a window that is not among them.
    unsigned length() const;
    Window* item(unsigned index) const;
    Window* namedItem(const AtomString& name) const;

    // The opaque root of the document that the frame element is in. The collector's threads call this.
    WebCoreOpaqueRoot containerOpaqueRoot() const { return WebCoreOpaqueRoot { m_containerDocument.load(std::memory_order_relaxed) }; }

    Document* document() const { return m_document.get(); }
    void setDocument(RefPtr<Document>&&);

    const String& name() const { return m_name; }
    void setName(const String& name) { m_name = name; }
    const String& status() const { return m_status; }
    void setStatus(const String& status) { m_status = status; }

    bool closed() const { return m_closed; }
    void close();

    // A task in the event loop's queue that is going to fire an event at the window or in its document.
    // While there is one, the collector keeps the window's wrapper, and with it every listener in the document.
    // In a browser the window is the global object, which nothing has to keep.
    class PendingTask {
    public:
        explicit PendingTask(Window*);
        PendingTask(PendingTask&&) = default;
        ~PendingTask();

    private:
        RefPtr<Window> m_window;
    };
    bool hasPendingTasks() const { return m_pendingTaskCount.load(std::memory_order_relaxed); }

    // The requests that close() cancels.
    WeakHashSet<XMLHttpRequest, WeakPtrImplWithEventTargetData>& loadingRequests() { return m_loadingRequests; }

    Location& location();
    History& history();
    Navigator& navigator();
    Screen& screen();
    DOMSelection& getSelection();
    ExceptionOr<Ref<Storage>> localStorage();
    ExceptionOr<Ref<Storage>> sessionStorage();

    String origin();
    bool isSecureContext() const { return true; }

    struct PostMessageOptions {
        String targetOrigin;
        Vector<JSC::Strong<JSC::JSObject>> transfer;
    };
    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, Variant<String, PostMessageOptions>&& targetOriginOrOptions, Vector<JSC::Strong<JSC::JSObject>>&& transfer);

    // The window that a listener on this target runs for: that of a node's or a request's document, or the target itself.
    static Window* forEventTarget(EventTarget*);

    // `window.event`: the event whose listener is running.
    Event* currentEvent() const { return m_currentEvent.get(); }
    class CurrentEventScope {
    public:
        CurrentEventScope(Window*, Event&);
        ~CurrentEventScope();

    private:
        RefPtr<Window> m_window;
        RefPtr<Event> m_previousEvent;
    };

    // What is left of "scroll to the fragment": it finds the element that `:target` matches.
    void scrollToFragment();

    // Fires `error` at the window. If no listener cancels the event, the exception goes to `console.error()`, and that is the end of it.
    void reportException(JSC::JSGlobalObject&, JSC::Exception&);
    void reportError(JSC::JSGlobalObject&, JSC::JSValue);

    unsigned requestAnimationFrame(Ref<RequestAnimationFrameCallback>&&);
    void cancelAnimationFrame(unsigned id);
    void runAnimationFrameCallbacks();

    CustomElementRegistry* customElementRegistry() const { return m_customElementRegistry.get(); }
    CustomElementRegistry& ensureCustomElementRegistry();

    Ref<CSSStyleDeclaration> getComputedStyle(Element&, const String& pseudoElement) const;
    Ref<MediaQueryList> matchMedia(const String&);

    int innerWidth() const { return 1024; }
    int innerHeight() const { return 768; }
    int screenX() const { return 0; }
    int screenY() const { return 0; }
    double scrollX() const { return 0; }
    double scrollY() const { return 0; }
    double devicePixelRatio() const { return 1; }

    // What needs a screen, a user or another window: alert(), scrollTo(), open(), ...
    void doNothing() { }

    // EventTarget
    enum EventTargetInterfaceType eventTargetInterface() const final;
    ScriptExecutionContext* scriptExecutionContext() const final;
    bool addEventListener(const AtomString& eventType, Ref<EventListener>&&, const AddEventListenerOptions&) final;
    bool removeEventListener(const AtomString& eventType, EventListener&, const EventListenerOptions&) final;
    void removeAllEventListeners() final;

private:
    explicit Window(ScriptExecutionContext&);

    void createDocument(const URL&, Window& creator);
    enum class CanRunScript : bool { No, Yes };
    void close(CanRunScript);
    void finishLoadingFrames();
    template<typename Function> Window* findFrame(NOESCAPE const Function&) const;

    ExceptionOr<Ref<Storage>> storage(RefPtr<Storage>&);

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    const Ref<ScriptExecutionContext> m_scriptExecutionContext;
    RefPtr<Document> m_document;
    RefPtr<CustomElementRegistry> m_customElementRegistry;
    RefPtr<Location> m_location;
    RefPtr<History> m_history;
    RefPtr<Navigator> m_navigator;
    RefPtr<Screen> m_screen;
    RefPtr<Storage> m_localStorage;
    RefPtr<Storage> m_sessionStorage;
    RefPtr<DOMSelection> m_selection;
    RefPtr<Event> m_currentEvent;
    Vector<Ref<RequestAnimationFrameCallback>> m_animationFrameCallbacks;
    WeakHashSet<XMLHttpRequest, WeakPtrImplWithEventTargetData> m_loadingRequests;
    WeakHashSet<HTMLFrameElementBase, WeakPtrImplWithEventTargetData> m_frameElements; // The ones with a window, also in shadow trees.
    WeakHashSet<Window, WeakPtrImplWithEventTargetData> m_openedWindows;
    Vector<Ref<Window>> m_loadingFrameWindows; // A frame that goes takes its window out, so making and removing frames in a loop queues nothing.
    bool m_willFinishLoadingFrames { false };
    WeakPtr<HTMLFrameElementBase, WeakPtrImplWithEventTargetData> m_frameElement;
    std::atomic<Node*> m_containerDocument { nullptr }; // The document of m_frameElement. The collector's threads only compare it.
    RefPtr<Window> m_opener; // The collector's threads read it: it is set before the window has a wrapper, and never again.
    String m_inheritedOrigin; // For about:blank and about:srcdoc: the origin of the parent or the opener.
    bool m_isForFrame { false };
    bool m_isGlobalThis { false };
    unsigned m_lastAnimationFrameCallbackID { 0 };
    bool m_hasScheduledAnimationFrame { false };
    MonotonicTime m_lastAnimationFrameTime { -MonotonicTime::infinity() };
    bool m_isReportingException { false };
    String m_name { emptyString() };
    String m_status { emptyString() };
    bool m_closed { false };
    std::atomic<unsigned> m_pendingTaskCount { 0 }; // The collector's threads read it.
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::Window)
static bool isType(const WebCore::EventTarget& target) { return target.eventTargetInterface() == WebCore::EventTargetInterfaceType::Window; }
SPECIALIZE_TYPE_TRAITS_END()
