#pragma once

#include "ScriptWrappable.h"
#include <wtf/AbstractRefCounted.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Vector.h>

namespace WebCore {

class CSSRule;
class CSSStyleSheet;

class CSSRuleList : public ScriptWrappable, public AbstractRefCounted {
    WTF_MAKE_NONCOPYABLE(CSSRuleList);
    WTF_MAKE_TZONE_ALLOCATED(CSSRuleList);
public:
    virtual ~CSSRuleList();

    virtual unsigned length() const = 0;
    virtual CSSRule* item(unsigned index) const = 0;
    bool isSupportedPropertyIndex(unsigned index) const { return item(index); }

    virtual CSSStyleSheet* styleSheet() const = 0;

protected:
    CSSRuleList();
};

// The rule owns the live list.
template <class Rule>
class LiveCSSRuleList final : public CSSRuleList {
    WTF_MAKE_TZONE_ALLOCATED_TEMPLATE(LiveCSSRuleList);
public:
    LiveCSSRuleList(Rule& rule)
        : m_rule(rule)
    {
    }

    void ref() const final { m_rule.ref(); }
    void deref() const final { m_rule.deref(); }

private:
    unsigned length() const final { return protect(m_rule)->length(); }
    CSSRule* item(unsigned index) const final { return protect(m_rule)->item(index); }
    CSSStyleSheet* styleSheet() const final { return m_rule.parentStyleSheet(); }

    Rule& m_rule;
};

WTF_MAKE_TZONE_ALLOCATED_TEMPLATE_IMPL(template<class Rule>, LiveCSSRuleList<Rule>);

} // namespace WebCore
