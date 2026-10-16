#pragma once

#include "CSSConditionRule.h"

namespace WebCore {

class CSSSupportsRule final : public CSSConditionRule {
public:
    static Ref<CSSSupportsRule> create(StyleRuleGroup& rule, CSSStyleSheet* parent) { return adoptRef(*new CSSSupportsRule(rule, parent)); }

private:
    CSSSupportsRule(StyleRuleGroup& rule, CSSStyleSheet* parent)
        : CSSConditionRule(rule, parent)
    {
    }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CSS_RULE(CSSSupportsRule, StyleRuleType::Supports)
