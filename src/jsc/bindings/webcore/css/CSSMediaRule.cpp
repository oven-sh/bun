#include "config.h"
#include "CSSMediaRule.h"

#include "CSSStyleSheet.h"
#include "MediaList.h"

namespace WebCore {

CSSMediaRule::CSSMediaRule(StyleRuleGroup& rule, CSSStyleSheet* parent)
    : CSSConditionRule(rule, parent)
{
}

CSSMediaRule::~CSSMediaRule()
{
    if (m_mediaCSSOMWrapper)
        m_mediaCSSOMWrapper->detachFromParent();
}

MediaList* CSSMediaRule::media() const
{
    if (!m_mediaCSSOMWrapper)
        m_mediaCSSOMWrapper = MediaList::create(const_cast<CSSMediaRule*>(this));
    return m_mediaCSSOMWrapper.get();
}

void CSSMediaRule::setMediaText(const String& text)
{
    CSSStyleSheet::RuleMutationScope mutationScope(this);
    auto queries = MediaQueries::parse(text);
    groupRule().setPrelude(WTF::move(queries.text), queries.matches);
}

} // namespace WebCore
