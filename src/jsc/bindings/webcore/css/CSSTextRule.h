#pragma once

#include "CSSRule.h"
#include "StyleRule.h"

namespace WebCore {

// The wrapper of a rule that is kept as text: script sees `type` and `cssText`.
class CSSTextRule final : public CSSRule {
public:
    static Ref<CSSTextRule> create(StyleRuleText& rule, CSSStyleSheet* parent) { return adoptRef(*new CSSTextRule(rule, parent)); }

    StyleRuleType styleRuleType() const final { return m_rule->type(); }
    String cssText() const final { return m_rule->text(); }

private:
    CSSTextRule(StyleRuleText& rule, CSSStyleSheet* parent)
        : CSSRule(parent)
        , m_rule(rule)
    {
    }

    const Ref<StyleRuleText> m_rule;
};

} // namespace WebCore
