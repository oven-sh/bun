#include "config.h"
#include "Window.h"

#include "CSSComputedStyleDeclaration.h"
#include "CustomElementRegistry.h"
#include "DOMSelection.h"
#include "Document.h"
#include "ErrorEvent.h"
#include "EventNames.h"
#include "EventTargetInlines.h"
#include "HTMLDocument.h"
#include "HTMLFrameElement.h"
#include "HTMLIFrameElement.h"
#include "History.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMWrapperCache.h"
#include "JSDocumentCustom.h"
#include "JSWindow.h"
#include "JSWindowCustom.h"
#include "Location.h"
#include "MediaQueryList.h"
#include "MessageEvent.h"
#include "MessagePort.h"
#include "Navigator.h"
#include "NodeDocument.h"
#include "ParserContentPolicy.h"
#include "Performance.h"
#include "RequestAnimationFrameCallback.h"
#include "Screen.h"
#include "ScriptExecutionContext.h"
#include "ShadowRoot.h"
#include "Storage.h"
#include "TaskSource.h"
#include "TypedElementDescendantIteratorInlines.h"
#include "XMLHttpRequest.h"
#include "XMLHttpRequestUpload.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/URLParser.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Window);

ExceptionOr<Ref<Window>> Window::create(ScriptExecutionContext& context, Options&& options)
{
    URL url { options.url };
    if (!url.isValid())
        return Exception { ExceptionCode::TypeError, makeString('"', options.url, "\" cannot be parsed as a URL."_s) };

    Ref window = adoptRef(*new Window(context));
    Ref document = HTMLDocument::create(context, url);
    window->setDocument(document.copyRef());
    document->setMarkupUnsafe("<!DOCTYPE html><html><head></head><body></body></html>"_s, { ParserContentPolicy::AllowDeclarativeShadowRoots });
    return window;
}

Ref<Window> Window::createForFrame(HTMLFrameElementBase& frameElement, const URL& url)
{
    Ref containerDocument = frameElement.document();
    Ref parent = *containerDocument->window();
    Ref window = adoptRef(*new Window(parent->m_scriptExecutionContext.get()));
    window->m_isForFrame = true;
    window->m_frameElement = frameElement;
    window->m_containerDocument = containerDocument.ptr();
    parent->m_frameElements.add(frameElement);
    if (auto& name = frameElement.getNameAttribute(); !name.isNull())
        window->m_name = name;
    window->createDocument(url, parent);

    // toJS() would make the wrapper when script first asks for the window. The windows below this one need it before that.
    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(window->m_scriptExecutionContext->globalObject());
    wrap(globalObject, globalObject, window.get());
    reportMemoryForDocumentIfFrameless(*globalObject, *window->m_document);
    return window;
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-window-open-features-tokenize
static bool hasFeature(StringView features, ASCIILiteral name)
{
    for (auto feature : features.split(',')) {
        auto equalsSign = feature.find('=');
        if (!equalLettersIgnoringASCIICase(feature.left(equalsSign).trim(isASCIIWhitespace<char16_t>), name))
            continue;
        if (equalsSign == notFound)
            return true;
        auto value = feature.substring(equalsSign + 1).trim(isASCIIWhitespace<char16_t>);
        return value.isEmpty() || equalLettersIgnoringASCIICase(value, "yes"_s) || equalLettersIgnoringASCIICase(value, "true"_s) || parseIntegerAllowingTrailingJunk<int>(value).value_or(0);
    }
    return false;
}

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-open-steps
// Nothing is loaded: the new window stays at about:blank, where a browser's starts.
ExceptionOr<RefPtr<Window>> Window::open(const String& url, const String& target, const String& features)
{
    if (!url.isEmpty() && !m_document->encodingParseURL(url).isValid())
        return Exception { ExceptionCode::SyntaxError, makeString('"', url, "\" cannot be parsed as a URL."_s) };
    if (m_closed)
        return RefPtr<Window> { };

    if (equalIgnoringASCIICase(target, "_self"_s))
        return RefPtr { this };
    if (equalIgnoringASCIICase(target, "_parent"_s))
        return RefPtr { parent() };
    if (equalIgnoringASCIICase(target, "_top"_s))
        return RefPtr { top() };
    if (hasFeature(features, "noopener"_s) || hasFeature(features, "noreferrer"_s))
        return RefPtr<Window> { };

    Ref window = adoptRef(*new Window(m_scriptExecutionContext.get()));
    window->m_opener = this;
    m_openedWindows.add(window.get());
    if (!target.isEmpty() && !equalIgnoringASCIICase(target, "_blank"_s))
        window->m_name = target;
    window->createDocument(aboutBlankURL(), *this);
    protect(window->document())->setMarkupUnsafe(emptyString(), { ParserContentPolicy::AllowDeclarativeShadowRoots });
    return RefPtr { WTF::move(window) };
}

// `creator` is the parent or the opener, which the window already knows: the base URL of about:blank is the creator's.
void Window::createDocument(const URL& url, Window& creator)
{
    if (url.isAboutBlank() || url.isAboutSrcDoc())
        m_inheritedOrigin = creator.origin();
    Ref document = HTMLDocument::create(m_scriptExecutionContext.get(), URL());
    setDocument(document.copyRef());
    document->setURL(URL { url });
    document->setParserContentPolicy({ ParserContentPolicy::AllowScriptingContent, ParserContentPolicy::AllowDeclarativeShadowRoots });
}

Window::Window(ScriptExecutionContext& context)
    : m_scriptExecutionContext(context)
{
}

Window::~Window()
{
    auto detach = [](auto& property) {
        if (property)
            property->detachFromWindow();
    };
    detach(m_location);
    detach(m_history);
    detach(m_navigator);
    detach(m_screen);
    detach(m_localStorage);
    detach(m_sessionStorage);
    detach(m_selection);
    setDocument(nullptr);
}

// Call this before anything is created in or parsed into the document: a document without a window has no custom elements.
void Window::setDocument(RefPtr<Document>&& document)
{
    RefPtr previous = std::exchange(m_document, WTF::move(document));
    if (previous)
        previous->setWindow(nullptr);
    if (m_document)
        m_document->setWindow(this);

    enumerateEventListenerTypes([&](auto& eventType, uint16_t capturingCount, uint16_t bubblingCount) {
        if (capturingCount) {
            if (previous)
                previous->didRemoveEventListenersOfType(eventType, Document::IsCapture::Yes, capturingCount);
            if (m_document)
                m_document->didAddEventListenersOfType(eventType, Document::IsCapture::Yes, capturingCount);
        }
        if (bubblingCount) {
            if (previous)
                previous->didRemoveEventListenersOfType(eventType, Document::IsCapture::No, bubblingCount);
            if (m_document)
                m_document->didAddEventListenersOfType(eventType, Document::IsCapture::No, bubblingCount);
        }
    });
}

// As in jsdom, this is how a program says it is done with a window: nothing that is still queued reaches a listener.
void Window::close()
{
    close(CanRunScript::Yes);
}

void Window::close(CanRunScript canRunScript)
{
    m_closed = true;
    m_pendingTaskCount = 0;
    removeAllEventListeners();
    if (RefPtr document = m_document)
        document->removeAllEventListeners();
    if (m_history)
        m_history->cancelTraversals();
    m_animationFrameCallbacks.clear();
    for (Ref frameElement : copyToVectorOf<Ref<HTMLFrameElementBase>>(m_frameElements))
        frameElement->disconnectContentFrame();
    for (Ref window : copyToVectorOf<Ref<Window>>(m_openedWindows))
        window->close(canRunScript);

    // Cancelling a request runs script.
    auto stopRequests = [requests = copyToVectorOf<Ref<XMLHttpRequest>>(m_loadingRequests)] {
        for (Ref<ActiveDOMObject> request : requests)
            request->stop();
    };
    if (canRunScript == CanRunScript::Yes)
        stopRequests();
    else if (!m_loadingRequests.isEmptyIgnoringNullReferences()) {
        m_scriptExecutionContext->postTask([stopRequests = WTF::move(stopRequests)](ScriptExecutionContext&) {
            stopRequests();
        });
    }
}

Window* Window::parent() const
{
    if (!m_isForFrame)
        return const_cast<Window*>(this);
    return m_frameElement ? m_frameElement->document().window() : nullptr;
}

Window* Window::top() const
{
    auto* window = const_cast<Window*>(this);
    while (window && window->m_isForFrame)
        window = window->parent();
    return window;
}

Element* Window::frameElement() const
{
    return m_frameElement.get();
}

void Window::disconnectFrameElement(HTMLFrameElementBase& frameElement)
{
    if (auto* parent = frameElement.document().window()) {
        parent->m_frameElements.remove(frameElement);
        parent->m_loadingFrameWindows.removeFirstMatching([&](auto& window) {
            return window.ptr() == this;
        });
    }
    m_frameElement = nullptr;
    m_containerDocument = nullptr;
    close(CanRunScript::No);
}

void Window::finishLoadingFrameSoon(Window& frameWindow)
{
    m_loadingFrameWindows.append(frameWindow);
    if (std::exchange(m_willFinishLoadingFrames, true))
        return;
    m_document->queueMicrotask([protectedThis = Ref { *this }, pendingTask = PendingTask { this }] {
        protectedThis->finishLoadingFrames();
    });
}

void Window::finishLoadingFrames()
{
    m_willFinishLoadingFrames = false;
    for (auto& window : std::exchange(m_loadingFrameWindows, { })) {
        if (window->m_closed)
            continue;
        Ref document = *window->m_document;
        if (document->readyState() == Document::ReadyState::Loading)
            document->close();
        else
            document->dispatchWindowEvent(Event::create(eventNames().loadEvent, Event::CanBubble::No, Event::IsCancelable::No), document.ptr());
    }
}

template<typename Function> Window* Window::findFrame(NOESCAPE const Function& isMatch) const
{
    if (m_frameElements.isEmptyIgnoringNullReferences())
        return nullptr;
    for (auto& frameElement : descendantsOfType<HTMLFrameElementBase>(*m_document)) {
        if (frameElement.contentWindow() && isMatch(frameElement))
            return frameElement.contentWindow();
    }
    return nullptr;
}

unsigned Window::length() const
{
    unsigned count = 0;
    findFrame([&](auto&) {
        ++count;
        return false;
    });
    return count;
}

Window* Window::item(unsigned index) const
{
    return findFrame([&](auto&) {
        return !index--;
    });
}

Window* Window::namedItem(const AtomString& name) const
{
    return findFrame([&](auto& frameElement) {
        return frameElement.getNameAttribute() == name;
    });
}

Window::PendingTask::PendingTask(Window* window)
    : m_window(window && !window->m_closed ? window : nullptr)
{
    if (m_window)
        ++m_window->m_pendingTaskCount;
}

Window::PendingTask::~PendingTask()
{
    if (m_window && !m_window->m_closed)
        --m_window->m_pendingTaskCount;
}

Location& Window::location()
{
    if (!m_location)
        m_location = Location::create(*this);
    return *m_location;
}

History& Window::history()
{
    if (!m_history)
        m_history = History::create(*this);
    return *m_history;
}

Navigator& Window::navigator()
{
    if (!m_navigator)
        m_navigator = Navigator::create(*this);
    return *m_navigator;
}

Screen& Window::screen()
{
    if (!m_screen)
        m_screen = Screen::create(*this);
    return *m_screen;
}

DOMSelection& Window::getSelection()
{
    if (!m_selection)
        m_selection = DOMSelection::create(*this);
    return *m_selection;
}

Window* Window::forEventTarget(EventTarget* target)
{
    if (auto* node = dynamicDowncast<Node>(target))
        return node->document().window();
    if (auto* upload = dynamicDowncast<XMLHttpRequestUpload>(target))
        target = &upload->request();
    if (auto* request = dynamicDowncast<XMLHttpRequest>(target))
        return request->document() ? request->document()->window() : nullptr;
    return dynamicDowncast<Window>(target);
}

Window::CurrentEventScope::CurrentEventScope(Window* window, Event& event)
    : m_window(window)
{
    if (!window)
        return;
    m_previousEvent = window->m_currentEvent;
    // window.event should not be set when the target is inside a shadow tree, as per the DOM specification.
    if (!event.currentTargetIsInShadowTree())
        window->m_currentEvent = &event;
}

Window::CurrentEventScope::~CurrentEventScope()
{
    if (m_window)
        m_window->m_currentEvent = WTF::move(m_previousEvent);
}

void Window::scrollToFragment()
{
    auto fragment = m_document->url().fragmentIdentifier();
    RefPtr target = m_document->findAnchor(fragment);
    if (!target) {
        if (auto decodedFragment = WTF::URLParser::formURLDecode(fragment))
            target = m_document->findAnchor(*decodedFragment);
    }
    m_document->setCSSTarget(target.get());
}

// https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception
void Window::reportException(JSC::JSGlobalObject& lexicalGlobalObject, JSC::Exception& exception)
{
    auto& vm = lexicalGlobalObject.vm();
    if (vm.isTerminationException(&exception))
        return;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // An exception from an `error` listener does not fire `error` again.
    if (!std::exchange(m_isReportingException, true)) {
        auto& stack = exception.stackForReporting(vm);
        String message = retrieveErrorMessage(lexicalGlobalObject, vm, exception.value(), scope);
        String sourceURL;
        JSC::LineColumn position;
        if (!stack.isEmpty()) {
            sourceURL = stack[0].sourceURL(vm);
            position = stack[0].computeLineAndColumn();
        }
        Ref event = ErrorEvent::create(message, sourceURL, position.line, position.column, { vm, exception.value() });
        dispatchEvent(event);
        m_isReportingException = false;
        if (event->defaultPrevented())
            return;
    }

    // `window.console.error`, as script would find it: a test that replaces it sees the exception, or silences it.
    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(m_scriptExecutionContext->globalObject());
    JSC::JSValue console = toJS(globalObject, globalObject, *this).get(globalObject, JSC::Identifier::fromString(vm, "console"_s));
    if (!scope.exception() && console.isObject()) {
        JSC::JSValue function = console.get(globalObject, JSC::Identifier::fromString(vm, "error"_s));
        if (!scope.exception() && function.isCallable()) {
            JSC::MarkedArgumentBuffer arguments;
            arguments.append(exception.value());
            JSC::call(globalObject, function, console, arguments, "console.error is not a function"_s);
        }
    }
    (void)scope.tryClearException();
}

// https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror
void Window::reportError(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue error)
{
    reportException(lexicalGlobalObject, *JSC::Exception::create(lexicalGlobalObject.vm(), error));
}

// https://html.spec.whatwg.org/multipage/web-messaging.html#window-post-message-steps
// The sender is the window the caller's global object stands for. Without one it is taken to be this window.
ExceptionOr<void> Window::postMessage(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue message, Variant<String, PostMessageOptions>&& targetOriginOrOptions, Vector<JSC::Strong<JSC::JSObject>>&& transfer)
{
    String targetOrigin;
    WTF::switchOn(WTF::move(targetOriginOrOptions), [&](String&& origin) {
        targetOrigin = WTF::move(origin);
    }, [&](PostMessageOptions&& options) {
        targetOrigin = WTF::move(options.targetOrigin);
        transfer = WTF::move(options.transfer);
    });

    RefPtr source = JSWindow::toWrapped(lexicalGlobalObject.vm(), &lexicalGlobalObject);
    if (!source)
        source = this;

    bool isForThisOrigin = true;
    if (targetOrigin == "/"_s)
        isForThisOrigin = source == this || (origin() != "null"_s && origin() == source->origin());
    else if (targetOrigin != "*"_s) {
        URL targetURL { targetOrigin };
        if (!targetURL.isValid())
            return Exception { ExceptionCode::SyntaxError, makeString('"', targetOrigin, "\" cannot be parsed as a URL."_s) };
        isForThisOrigin = origin() != "null"_s && protocolHostAndPortAreEqual(targetURL, URL { origin() });
    }

    // As in MessagePort::postMessage(): the exception stays pending for the caller, this only tells the verifier that it was seen.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(lexicalGlobalObject.vm());
    Vector<RefPtr<MessagePort>> ports;
    auto serialized = SerializedScriptValue::create(lexicalGlobalObject, message, WTF::move(transfer), ports, SerializationForStorage::No, SerializationContext::WindowPostMessage);
    if (serialized.hasException()) {
        (void)scope.exception();
        return serialized.releaseException();
    }
    RETURN_IF_EXCEPTION(scope, { });
    auto transferredPorts = MessagePort::disentanglePorts(WTF::move(ports));
    if (transferredPorts.hasException())
        return transferredPorts.releaseException();
    if (!isForThisOrigin)
        return { };

    m_document->queueTask(TaskSource::PostedMessageQueue, [protectedThis = Ref { *this }, source = source.releaseNonNull(), message = serialized.releaseReturnValue(), transferredPorts = transferredPorts.releaseReturnValue()]() mutable {
        if (protectedThis->m_closed)
            return;
        auto& context = protectedThis->m_scriptExecutionContext.get();
        auto& globalObject = *context.jsGlobalObject();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject.vm());

        auto ports = MessagePort::entanglePorts(context, WTF::move(transferredPorts));
        auto event = MessageEvent::create(globalObject, WTF::move(message), source->origin(), { }, source.ptr(), WTF::move(ports));
        if (scope.exception()) [[unlikely]] {
            if (!scope.tryClearException())
                return;
            protectedThis->dispatchEvent(MessageEvent::create(eventNames().messageerrorEvent, MessageEvent::Init { { }, JSC::jsNull() }, MessageEvent::IsTrusted::Yes));
            return;
        }
        protectedThis->dispatchEvent(event->event);
    });
    return { };
}

// https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames
unsigned Window::requestAnimationFrame(Ref<RequestAnimationFrameCallback>&& callback)
{
    if (m_closed)
        return 0;

    callback->m_firedOrCancelled = false;
    callback->m_id = ++m_lastAnimationFrameCallbackID;
    m_animationFrameCallbacks.append(WTF::move(callback));
    if (!std::exchange(m_hasScheduledAnimationFrame, true)) {
        // At most 60 frames a second, and the first one after a pause does not wait. Not by performance.now(), which starts again at 0 when a test fakes it.
        scheduleAnimationFrame(*this, std::max(0.0, 1000.0 / 60 - (MonotonicTime::now() - m_lastAnimationFrameTime).milliseconds()));
    }
    return m_lastAnimationFrameCallbackID;
}

void Window::cancelAnimationFrame(unsigned id)
{
    m_animationFrameCallbacks.removeFirstMatching([&](auto& callback) {
        if (callback->m_id != id)
            return false;
        callback->m_firedOrCancelled = true;
        return true;
    });
}

void Window::runAnimationFrameCallbacks()
{
    Ref protectedThis { *this };
    m_hasScheduledAnimationFrame = false;
    auto& globalObject = *uncheckedDowncast<JSDOMGlobalObject>(m_scriptExecutionContext->globalObject());
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject.vm());
    double now = globalObject.performance()->now();
    m_lastAnimationFrameTime = MonotonicTime::now();

    // A callback that is requested from here on is for the next frame. One that is cancelled from here on does not run.
    auto callbacks = m_animationFrameCallbacks;
    for (auto& callback : callbacks) {
        if (m_closed || std::exchange(callback->m_firedOrCancelled, true))
            continue;
        callback->invokeRethrowingException(now);
        if (auto* exception = scope.exception()) {
            if (!scope.tryClearException())
                return;
            reportException(globalObject, *exception);
        }
    }
    m_animationFrameCallbacks.removeAllMatching([](auto& callback) {
        return callback->m_firedOrCancelled;
    });
}

String Window::origin()
{
    return m_inheritedOrigin.isNull() ? location().origin() : m_inheritedOrigin;
}

ExceptionOr<Ref<Storage>> Window::storage(RefPtr<Storage>& storage)
{
    if (!storage) {
        if (origin() == "null"_s)
            return Exception { ExceptionCode::SecurityError, "Storage is not available to a document with an opaque origin, such as about:blank."_s };
        storage = Storage::create(*this);
    }
    return Ref { *storage };
}

ExceptionOr<Ref<Storage>> Window::localStorage()
{
    return storage(m_localStorage);
}

ExceptionOr<Ref<Storage>> Window::sessionStorage()
{
    return storage(m_sessionStorage);
}

Ref<CSSStyleDeclaration> Window::getComputedStyle(Element& element, const String& pseudoElement) const
{
    return CSSComputedStyleDeclaration::create(element, pseudoElement);
}

Ref<MediaQueryList> Window::matchMedia(const String& media)
{
    return MediaQueryList::create(m_scriptExecutionContext.get(), MediaQueries::parse(media));
}

CustomElementRegistry& Window::ensureCustomElementRegistry()
{
    if (!m_customElementRegistry) {
        m_customElementRegistry = CustomElementRegistry::create(m_scriptExecutionContext.get(), *this);
        if (RefPtr document = m_document) {
            for (Ref shadowRoot : document->inDocumentShadowRoots()) {
                if (shadowRoot->mode() == ShadowRootMode::UserAgent || shadowRoot->hasScopedCustomElementRegistry())
                    continue;
                const_cast<ShadowRoot&>(shadowRoot.get()).setCustomElementRegistry(m_customElementRegistry.copyRef());
            }
            document->setCustomElementRegistry(m_customElementRegistry.copyRef());
        }
    }
    return *m_customElementRegistry;
}

enum EventTargetInterfaceType Window::eventTargetInterface() const
{
    return EventTargetInterfaceType::Window;
}

ScriptExecutionContext* Window::scriptExecutionContext() const
{
    return m_scriptExecutionContext.ptr();
}

// The document counts listeners by event type, and skips dispatching events nobody listens for.
// A window's listeners hear events that bubble up from its nodes, so they count too.
bool Window::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    if (!EventTarget::addEventListener(eventType, WTF::move(listener), options))
        return false;
    if (RefPtr document = m_document)
        document->didAddEventListenersOfType(eventType, options.capture ? Document::IsCapture::Yes : Document::IsCapture::No);
    return true;
}

bool Window::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    if (!EventTarget::removeEventListener(eventType, listener, options))
        return false;
    if (RefPtr document = m_document)
        document->didRemoveEventListenersOfType(eventType, options.capture ? Document::IsCapture::Yes : Document::IsCapture::No);
    return true;
}

void Window::removeAllEventListeners()
{
    if (RefPtr document = m_document) {
        enumerateEventListenerTypes([&](auto& eventType, uint16_t capturingCount, uint16_t bubblingCount) {
            if (capturingCount)
                document->didRemoveEventListenersOfType(eventType, Document::IsCapture::Yes, capturingCount);
            if (bubblingCount)
                document->didRemoveEventListenersOfType(eventType, Document::IsCapture::No, bubblingCount);
        });
    }
    EventTarget::removeAllEventListeners();
}

} // namespace WebCore
