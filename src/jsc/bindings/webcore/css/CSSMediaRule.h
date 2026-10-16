#pragma once

#include "CSSConditionRule.h"

namespace WebCore {

class MediaList;

class CSSMediaRule final : public CSSConditionRule {
public:
    static Ref<CSSMediaRule> create(StyleRuleGroup& rule, CSSStyleSheet* parent) { return adoptRef(*new CSSMediaRule(rule, parent)); }
    virtual ~CSSMediaRule();

    WEBCORE_EXPORT MediaList* media() const;

    void setMediaText(const String&);

private:
    CSSMediaRule(StyleRuleGroup&, CSSStyleSheet*);

    mutable RefPtr<MediaList> m_mediaCSSOMWrapper;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CSS_RULE(CSSMediaRule, StyleRuleType::Media)
