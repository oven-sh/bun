#pragma once

#include "CSSGroupingRule.h"

namespace WebCore {

class CSSLayerBlockRule final : public CSSGroupingRule {
public:
    static Ref<CSSLayerBlockRule> create(StyleRuleGroup& rule, CSSStyleSheet* parent) { return adoptRef(*new CSSLayerBlockRule(rule, parent)); }

    String name() const { return groupRule().prelude(); }

private:
    CSSLayerBlockRule(StyleRuleGroup& rule, CSSStyleSheet* parent)
        : CSSGroupingRule(rule, parent)
    {
    }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CSS_RULE(CSSLayerBlockRule, StyleRuleType::LayerBlock)
