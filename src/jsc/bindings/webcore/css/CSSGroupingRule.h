#pragma once

#include "CSSRule.h"
#include "StyleRule.h"
#include <memory>
#include <wtf/Vector.h>

namespace WebCore {

class CSSRuleList;

// Also what @container, @scope and @starting-style are wrapped in.
class CSSGroupingRule : public CSSRule {
    WTF_MAKE_TZONE_ALLOCATED(CSSGroupingRule);
public:
    static Ref<CSSGroupingRule> create(StyleRuleGroup& rule, CSSStyleSheet* parent) { return adoptRef(*new CSSGroupingRule(rule, parent)); }
    virtual ~CSSGroupingRule();

    WEBCORE_EXPORT CSSRuleList& cssRules() const;
    WEBCORE_EXPORT ExceptionOr<unsigned> insertRule(const String& rule, unsigned index);
    WEBCORE_EXPORT ExceptionOr<void> deleteRule(unsigned index);
    unsigned length() const;
    CSSRule* item(unsigned index) const;

    StyleRuleType styleRuleType() const final { return m_groupRule->type(); }
    String cssText() const final;

protected:
    CSSGroupingRule(StyleRuleGroup&, CSSStyleSheet* parent);
    const StyleRuleGroup& groupRule() const { return m_groupRule; }
    StyleRuleGroup& groupRule() { return m_groupRule; }

private:
    bool isGroupingRule() const final { return true; }

    const Ref<StyleRuleGroup> m_groupRule;
    mutable Vector<RefPtr<CSSRule>> m_childRuleCSSOMWrappers;
    const std::unique_ptr<CSSRuleList> m_ruleListCSSOMWrapper;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::CSSGroupingRule)
    static bool isType(const WebCore::CSSRule& rule) { return rule.isGroupingRule(); }
SPECIALIZE_TYPE_TRAITS_END()
