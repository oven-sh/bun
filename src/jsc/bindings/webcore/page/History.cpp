#include "config.h"
#include "History.h"

#include "Document.h"
#include "EventNames.h"
#include "HashChangeEvent.h"
#include "JSHistory.h"
#include "PopStateEvent.h"
#include "SerializedScriptValue.h"
#include "TaskSource.h"
#include "Window.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(History);

History::History(Window& window)
    : WindowProperty(window)
{
    m_entries.append({ window.document()->url(), nullptr });
}

History::~History() = default;

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#can-have-its-url-rewritten
static bool canRewriteURL(const URL& documentURL, const URL& targetURL)
{
    if (targetURL.protocol() != documentURL.protocol() || targetURL.encodedUser() != documentURL.encodedUser() || targetURL.encodedPassword() != documentURL.encodedPassword()
        || targetURL.host() != documentURL.host() || targetURL.port() != documentURL.port())
        return false;
    if (targetURL.protocolIsInHTTPFamily())
        return true;
    if (targetURL.path() != documentURL.path())
        return false;
    return targetURL.protocolIsFile() || targetURL.query() == documentURL.query();
}

static bool fragmentsDiffer(const URL& a, const URL& b)
{
    return a.hasFragmentIdentifier() != b.hasFragmentIdentifier() || a.fragmentIdentifier() != b.fragmentIdentifier();
}

void History::setCurrentEntry(size_t index)
{
    m_currentIndex = index;
    m_cachedState.clear();
    if (RefPtr document = this->document())
        document->setURL(URL { m_entries[index].url });
}

void History::addEntry(Entry&& entry, HistoryHandling handling)
{
    if (handling == HistoryHandling::Replace)
        m_entries[m_currentIndex] = WTF::move(entry);
    else {
        m_entries.shrink(m_currentIndex + 1);
        m_entries.append(WTF::move(entry));
    }
    setCurrentEntry(handling == HistoryHandling::Replace ? m_currentIndex : m_currentIndex + 1);
}

ExceptionOr<void> History::updateState(RefPtr<SerializedScriptValue>&& data, const String& relativeURL, HistoryHandling handling)
{
    RefPtr document = this->document();
    if (!document)
        return Exception { ExceptionCode::SecurityError, "The window of this History is gone."_s };

    URL url = document->url();
    if (!relativeURL.isEmpty()) {
        url = document->encodingParseURL(relativeURL);
        if (!url.isValid() || !canRewriteURL(document->url(), url))
            return Exception { ExceptionCode::SecurityError, makeString("A document at "_s, document->url().string(), " cannot change its URL to \""_s, relativeURL, "\"."_s) };
    }

    if (handling == HistoryHandling::Push)
        cancelTraversals();
    addEntry({ WTF::move(url), WTF::move(data) }, handling);
    return { };
}

void History::navigateToFragment(URL&& url, HistoryHandling handling)
{
    RefPtr document = this->document();
    if (!document)
        return;

    URL oldURL = document->url();
    cancelTraversals();
    addEntry({ WTF::move(url), nullptr }, handling);
    window()->scrollToFragment();
    document->queueTask(TaskSource::DOMManipulation, [protectedThis = Ref { *this }, oldURL = WTF::move(oldURL), newURL = document->url()] {
        protectedThis->dispatchTraversalEvents(oldURL, newURL, nullptr);
    });
}

void History::go(int delta)
{
    RefPtr document = this->document();
    if (!document || !delta)
        return;

    document->queueTask(TaskSource::DOMManipulation, [protectedThis = Ref { *this }, delta, generation = m_traversalGeneration] {
        protectedThis->traverse(delta, generation);
    });
}

void History::traverse(int delta, unsigned generation)
{
    RefPtr document = this->document();
    auto index = static_cast<int64_t>(m_currentIndex) + delta;
    if (!document || generation != m_traversalGeneration || index < 0 || index >= static_cast<int64_t>(m_entries.size()))
        return;

    URL oldURL = document->url();
    setCurrentEntry(index);
    if (fragmentsDiffer(oldURL, document->url()))
        window()->scrollToFragment();
    dispatchTraversalEvents(oldURL, URL { document->url() }, state());
}

void History::dispatchTraversalEvents(const URL& oldURL, const URL& newURL, SerializedScriptValue* state)
{
    RefPtr window = this->window();
    if (!window || window->closed())
        return;

    auto& globalObject = *uncheckedDowncast<JSDOMGlobalObject>(window->scriptExecutionContext()->globalObject());
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject.vm());

    // `event.state` is the same object as `history.state`.
    JSC::JSValue stateValue = JSC::jsNull();
    if (state)
        stateValue = uncheckedDowncast<JSHistory>(toJS(&globalObject, &globalObject, *this))->state(globalObject);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        stateValue = JSC::jsNull();
    }

    window->dispatchEvent(PopStateEvent::create(globalObject, eventNames().popstateEvent, { { }, stateValue, false }, Event::IsTrusted::Yes));
    if (fragmentsDiffer(oldURL, newURL))
        window->dispatchEvent(HashChangeEvent::create(oldURL.string(), newURL.string()));
}

} // namespace WebCore
