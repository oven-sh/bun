#include "config.h"
#include "Location.h"

#include "Document.h"
#include "History.h"
#include "Window.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Location);

URL Location::fullURL() const
{
    auto* document = this->document();
    return document ? document->url() : aboutBlankURL();
}

void Location::setFullURL(const URL& url)
{
    navigate(URL { url }, HistoryHandling::Push);
}

// A URL with another scheme is another page, so there is nowhere to go.
ExceptionOr<void> Location::setProtocol(StringView protocol)
{
    if (!fullURL().setProtocol(protocol))
        return Exception { ExceptionCode::SyntaxError };
    return { };
}

void Location::setHash(StringView hash)
{
    URL current = fullURL();
    URL url = current;
    url.setFragmentIdentifier(hash.startsWith('#') ? hash.substring(1) : hash);
    // No fragment counts as an empty one here: `location.hash = ""` does not add a "#".
    if (url.fragmentIdentifier() != current.fragmentIdentifier())
        setFullURL(url);
}

ExceptionOr<void> Location::assign(const String& url)
{
    return navigate(url, HistoryHandling::Push);
}

ExceptionOr<void> Location::replace(const String& url)
{
    return navigate(url, HistoryHandling::Replace);
}

ExceptionOr<void> Location::navigate(const String& relativeURL, HistoryHandling handling)
{
    RefPtr document = this->document();
    if (!document)
        return { };
    URL url = document->encodingParseURL(relativeURL);
    if (!url.isValid())
        return Exception { ExceptionCode::SyntaxError, makeString('"', relativeURL, "\" cannot be parsed as a URL."_s) };
    navigate(WTF::move(url), handling);
    return { };
}

void Location::navigate(URL&& url, HistoryHandling handling)
{
    URL current = fullURL();
    if (!window() || url == current || !equalIgnoringFragmentIdentifier(url, current))
        return;
    window()->history().navigateToFragment(WTF::move(url), handling);
}

} // namespace WebCore
