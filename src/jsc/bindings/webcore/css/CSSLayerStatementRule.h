#pragma once

#include "CSSRule.h"
#include "StyleRule.h"

namespace WebCore {

class CSSLayerStatementRule final : public CSSRule {
public:
    static Ref<CSSLayerStatementRule> create(StyleRuleText& rule, CSSStyleSheet* parent) { return adoptRef(*new CSSLayerStatementRule(rule, parent)); }

    Vector<String> nameList() const
    {
        Vector<String> names;
        for (auto name : StringView { m_rule->prelude() }.split(','))
            names.append(name.trim(isASCIIWhitespace<char16_t>).toString());
        return names;
    }

    StyleRuleType styleRuleType() const final { return StyleRuleType::LayerStatement; }
    String cssText() const final { return m_rule->text(); }

private:
    CSSLayerStatementRule(StyleRuleText& rule, CSSStyleSheet* parent)
        : CSSRule(parent)
        , m_rule(rule)
    {
    }

    const Ref<StyleRuleText> m_rule;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CSS_RULE(CSSLayerStatementRule, StyleRuleType::LayerStatement)
