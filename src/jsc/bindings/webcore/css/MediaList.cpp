#include "config.h"
#include "MediaList.h"

#include "CSSMediaRule.h"
#include "CSSParser.h"
#include "CSSStyleSheet.h"
#include "ExceptionOr.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MediaList);

MediaQueries MediaQueries::parse(const String& text)
{
    return CSSParser::parseMediaQueries(text);
}

MediaList::MediaList(CSSStyleSheet* parentSheet)
    : m_parentStyleSheet(parentSheet)
{
}

MediaList::MediaList(CSSMediaRule* parentRule)
    : m_parentRule(parentRule)
{
}

MediaList::~MediaList() = default;

CSSRule* MediaList::parentRule() const
{
    return m_parentRule;
}

void MediaList::detachFromParent()
{
    m_detachedText = mediaText();
    m_parentStyleSheet = nullptr;
    m_parentRule = nullptr;
}

String MediaList::mediaText() const
{
    if (m_parentRule)
        return m_parentRule->conditionText();
    if (m_parentStyleSheet)
        return m_parentStyleSheet->mediaQueries().text;
    return m_detachedText;
}

void MediaList::setMediaText(const String& text)
{
    if (m_parentRule)
        m_parentRule->setMediaText(text);
    else if (m_parentStyleSheet)
        m_parentStyleSheet->setMediaQueries(MediaQueries::parse(text));
    else
        m_detachedText = MediaQueries::parse(text).text;
}

// The serialization has ", " between two queries and nowhere else outside of parentheses.
static Vector<String> splitQueries(const String& text)
{
    Vector<String> result;
    unsigned depth = 0;
    unsigned start = 0;
    for (unsigned i = 0; i < text.length(); ++i) {
        auto character = text[i];
        if (character == '(')
            ++depth;
        else if (character == ')' && depth)
            --depth;
        else if (character == ',' && !depth) {
            result.append(text.substring(start, i - start));
            start = i + 2;
        }
    }
    if (start < text.length())
        result.append(text.substring(start));
    return result;
}

Vector<String> MediaList::queries() const
{
    return splitQueries(mediaText());
}

unsigned MediaList::length() const
{
    return queries().size();
}

String MediaList::item(unsigned index) const
{
    auto queries = this->queries();
    if (index < queries.size())
        return queries[index];
    return { };
}

static String join(const Vector<String>& queries)
{
    StringBuilder result;
    for (auto& query : queries) {
        if (!result.isEmpty())
            result.append(", "_s);
        result.append(query);
    }
    return result.toString();
}

ExceptionOr<void> MediaList::deleteMedium(const String& value)
{
    auto valueToRemove = MediaQueries::parse(value).text;
    auto queries = this->queries();
    if (!queries.removeAll(valueToRemove))
        return Exception { ExceptionCode::NotFoundError };
    setMediaText(join(queries));
    return { };
}

void MediaList::appendMedium(const String& value)
{
    auto newQuery = MediaQueries::parse(value).text;
    // One query, not a list.
    if (newQuery.isEmpty() || splitQueries(newQuery).size() != 1)
        return;
    auto queries = this->queries();
    if (queries.contains(newQuery))
        return;
    queries.append(WTF::move(newQuery));
    setMediaText(join(queries));
}

} // namespace WebCore
