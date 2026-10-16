#pragma once

#include "CSSGroupingRule.h"

namespace WebCore {

class CSSConditionRule : public CSSGroupingRule {
public:
    String conditionText() const { return groupRule().prelude(); }
    bool matches() const { return groupRule().conditionIsTrue(); }

protected:
    CSSConditionRule(StyleRuleGroup& rule, CSSStyleSheet* parent)
        : CSSGroupingRule(rule, parent)
    {
    }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::CSSConditionRule)
    static bool isType(const WebCore::CSSRule& rule) { return rule.styleRuleType() == WebCore::StyleRuleType::Media || rule.styleRuleType() == WebCore::StyleRuleType::Supports; }
SPECIALIZE_TYPE_TRAITS_END()
