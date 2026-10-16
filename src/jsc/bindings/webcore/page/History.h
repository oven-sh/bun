#pragma once

#include "ExceptionOr.h"
#include "JSValueInWrappedObject.h"
#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <wtf/RefCounted.h>
#include <wtf/URL.h>
#include <wtf/Vector.h>

namespace WebCore {

class SerializedScriptValue;

enum class HistoryHandling : bool { Push, Replace };

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface
// It is also the window's session history. Every entry belongs to the window's one document.
class History final : public ScriptWrappable, public RefCounted<History>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(History);
public:
    static Ref<History> create(Window& window) { return adoptRef(*new History(window)); }
    ~History();

    unsigned length() const { return m_entries.size(); }
    SerializedScriptValue* state() const { return m_entries[m_currentIndex].state.get(); }
    JSValueInWrappedObject& cachedState() { return m_cachedState; }

    void back() { go(-1); }
    void forward() { go(1); }
    void go(int delta);

    ExceptionOr<void> pushState(RefPtr<SerializedScriptValue>&& data, const String&, const String& url) { return updateState(WTF::move(data), url, HistoryHandling::Push); }
    ExceptionOr<void> replaceState(RefPtr<SerializedScriptValue>&& data, const String&, const String& url) { return updateState(WTF::move(data), url, HistoryHandling::Replace); }

    void navigateToFragment(URL&&, HistoryHandling);
    void cancelTraversals() { ++m_traversalGeneration; }

private:
    explicit History(Window&);

    struct Entry {
        URL url;
        RefPtr<SerializedScriptValue> state;
    };

    ExceptionOr<void> updateState(RefPtr<SerializedScriptValue>&&, const String& relativeURL, HistoryHandling);
    void addEntry(Entry&&, HistoryHandling);
    void setCurrentEntry(size_t index);
    void traverse(int delta, unsigned generation);
    void dispatchTraversalEvents(const URL& oldURL, const URL& newURL, SerializedScriptValue* state);

    Vector<Entry> m_entries;
    size_t m_currentIndex { 0 };
    unsigned m_traversalGeneration { 0 };
    JSValueInWrappedObject m_cachedState;
};

} // namespace WebCore
