#pragma once

#include "CSSRule.h"
#include "StyleRule.h"

namespace WebCore {

class CSSRuleList;
class CSSStyleProperties;
class StyleRuleCSSStyleProperties;

class CSSStyleRule final : public CSSRule {
    WTF_MAKE_TZONE_ALLOCATED(CSSStyleRule);
public:
    static Ref<CSSStyleRule> create(StyleRule& rule, CSSStyleSheet* sheet) { return adoptRef(*new CSSStyleRule(rule, sheet)); }
    virtual ~CSSStyleRule();

    WEBCORE_EXPORT String selectorText() const;
    WEBCORE_EXPORT void setSelectorText(const String&);

    WEBCORE_EXPORT CSSStyleProperties& style();

    WEBCORE_EXPORT CSSRuleList& cssRules() const;
    unsigned length() const;
    CSSRule* item(unsigned index) const;

private:
    CSSStyleRule(StyleRule&, CSSStyleSheet*);

    StyleRuleType styleRuleType() const final { return StyleRuleType::Style; }
    String cssText() const final;

    const Ref<StyleRule> m_styleRule;
    RefPtr<StyleRuleCSSStyleProperties> m_propertiesCSSOMWrapper;
    mutable Vector<RefPtr<CSSRule>> m_childRuleCSSOMWrappers;
    const std::unique_ptr<CSSRuleList> m_ruleListCSSOMWrapper;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CSS_RULE(CSSStyleRule, StyleRuleType::Style)
