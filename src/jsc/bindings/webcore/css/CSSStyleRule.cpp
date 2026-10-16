#include "config.h"
#include "CSSStyleRule.h"

#include "CSSParser.h"
#include "CSSRuleList.h"
#include "CSSStyleProperties.h"
#include "CSSStyleSheet.h"
#include "MutableStyleProperties.h"
#include "StyleSheetContents.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSStyleRule);

CSSStyleRule::CSSStyleRule(StyleRule& styleRule, CSSStyleSheet* parent)
    : CSSRule(parent)
    , m_styleRule(styleRule)
    , m_childRuleCSSOMWrappers(styleRule.nestedRules().size())
{
}

CSSStyleRule::~CSSStyleRule()
{
    if (m_propertiesCSSOMWrapper)
        m_propertiesCSSOMWrapper->clearParentRule();

    for (auto& wrapper : m_childRuleCSSOMWrappers) {
        if (wrapper)
            wrapper->setParentRule(nullptr);
    }
}

CSSStyleProperties& CSSStyleRule::style()
{
    if (!m_propertiesCSSOMWrapper)
        m_propertiesCSSOMWrapper = StyleRuleCSSStyleProperties::create(m_styleRule->mutableProperties(), *this);
    return *m_propertiesCSSOMWrapper;
}

String CSSStyleRule::selectorText() const
{
    return m_styleRule->selectorText();
}

void CSSStyleRule::setSelectorText(const String& selectorText)
{
    // FIXME: getMatchedCSSRules can return CSSStyleRules that are missing parent stylesheet pointer while
    // referencing StyleRules that are part of stylesheet. Disallow mutations in this case.
    RefPtr sheet = parentStyleSheet();
    if (!sheet)
        return;

    auto selectors = CSSParser::parseStyleRuleSelectors(selectorText, sheet->contents().parserMode());
    if (!selectors)
        return;

    CSSStyleSheet::RuleMutationScope mutationScope(this);
    m_styleRule->setSelectors(WTF::move(*selectors));
}

String CSSStyleRule::cssText() const
{
    auto declarations = m_styleRule->properties().asText();
    if (!length()) {
        if (declarations.isEmpty())
            return makeString(selectorText(), " { }"_s);
        return makeString(selectorText(), " { "_s, declarations, " }"_s);
    }

    StringBuilder builder;
    builder.append(selectorText(), " {"_s);
    if (!declarations.isEmpty())
        builder.append("\n  "_s, declarations);
    for (unsigned index = 0; index < length(); ++index)
        builder.append("\n  "_s, protect(item(index))->cssText());
    builder.append("\n}"_s);
    return builder.toString();
}

unsigned CSSStyleRule::length() const
{
    return m_styleRule->nestedRules().size();
}

CSSRule* CSSStyleRule::item(unsigned index) const
{
    if (index >= length())
        return nullptr;
    auto& rule = m_childRuleCSSOMWrappers[index];
    if (!rule)
        rule = m_styleRule->nestedRules()[index]->createCSSOMWrapper(const_cast<CSSStyleRule&>(*this));
    return rule.get();
}

CSSRuleList& CSSStyleRule::cssRules() const
{
    if (!m_ruleListCSSOMWrapper)
        lazyInitialize(m_ruleListCSSOMWrapper, makeUniqueWithoutRefCountedCheck<LiveCSSRuleList<CSSStyleRule>, CSSRuleList>(const_cast<CSSStyleRule&>(*this)));
    return *m_ruleListCSSOMWrapper;
}

} // namespace WebCore
