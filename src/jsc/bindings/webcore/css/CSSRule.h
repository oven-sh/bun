#pragma once

#include "ScriptWrappable.h"
#include "StyleRuleType.h"
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/TypeCasts.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class CSSStyleSheet;
class StyleRuleBase;

template<typename> class ExceptionOr;

class CSSRule : public ScriptWrappable, public RefCountedAndCanMakeWeakPtr<CSSRule> {
    WTF_MAKE_TZONE_ALLOCATED(CSSRule);
public:
    virtual ~CSSRule();

    WEBCORE_EXPORT unsigned short typeForCSSOM() const;

    virtual StyleRuleType styleRuleType() const = 0;
    virtual bool isGroupingRule() const { return false; }
    virtual String cssText() const = 0;

    void setParentStyleSheet(CSSStyleSheet*);
    void setParentRule(CSSRule*);
    CSSStyleSheet* parentStyleSheet() const;
    CSSRule* parentRule() const { return m_parentIsRule ? m_parentRule : nullptr; }

    WEBCORE_EXPORT ExceptionOr<void> setCssText(const String&);

protected:
    explicit CSSRule(CSSStyleSheet*);

private:
    unsigned char m_parentIsRule : 1;
    union {
        CSSRule* m_parentRule;
        CSSStyleSheet* m_parentStyleSheet;
    };
};

inline CSSRule::CSSRule(CSSStyleSheet* parent)
    : m_parentIsRule(false)
    , m_parentStyleSheet(parent)
{
}

inline void CSSRule::setParentStyleSheet(CSSStyleSheet* styleSheet)
{
    m_parentIsRule = false;
    m_parentStyleSheet = styleSheet;
}

inline void CSSRule::setParentRule(CSSRule* rule)
{
    m_parentIsRule = true;
    m_parentRule = rule;
}

inline CSSStyleSheet* CSSRule::parentStyleSheet() const
{
    if (m_parentIsRule)
        return m_parentRule ? m_parentRule->parentStyleSheet() : nullptr;
    return m_parentStyleSheet;
}

} // namespace WebCore

#define SPECIALIZE_TYPE_TRAITS_CSS_RULE(ToValueTypeName, predicate) \
SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ToValueTypeName) \
    static bool isType(const WebCore::CSSRule& rule) { return rule.styleRuleType() == WebCore::predicate; } \
SPECIALIZE_TYPE_TRAITS_END()
