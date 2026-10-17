#pragma once

#include "ExceptionOr.h"
#include "ScriptWrappable.h"
#include "URLDecomposition.h"
#include "WindowProperty.h"
#include <wtf/RefCounted.h>

namespace WebCore {

enum class HistoryHandling : bool;

// https://html.spec.whatwg.org/multipage/history.html#location
// It shows the document's URL. Only a change of the fragment goes anywhere: nothing is ever loaded.
class Location final : public ScriptWrappable, public RefCounted<Location>, public WindowProperty, public URLDecomposition {
    WTF_MAKE_TZONE_ALLOCATED(Location);
public:
    static Ref<Location> create(Window& window) { return adoptRef(*new Location(window)); }

    String href() const { return fullURL().string(); }
    ExceptionOr<void> setHref(const String& url) { return assign(url); }
    ExceptionOr<void> setProtocol(StringView);
    void setHash(StringView);

    ExceptionOr<void> assign(const String& url);
    ExceptionOr<void> replace(const String& url);
    void reload() { }

    void navigate(URL&&, HistoryHandling);

private:
    explicit Location(Window& window)
        : WindowProperty(window)
    {
    }

    ExceptionOr<void> navigate(const String& relativeURL, HistoryHandling);

    URL fullURL() const final;
    void setFullURL(const URL&) final;
};

} // namespace WebCore
