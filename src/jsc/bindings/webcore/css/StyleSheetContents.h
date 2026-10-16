#pragma once

#include "CSSParserMode.h"
#include "StyleRule.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>

namespace WebCore {

// The rules of a style sheet.
class StyleSheetContents final : public RefCounted<StyleSheetContents> {
    WTF_MAKE_TZONE_ALLOCATED(StyleSheetContents);
public:
    static Ref<StyleSheetContents> create(CSSParserMode mode = HTMLStandardMode) { return adoptRef(*new StyleSheetContents(mode)); }
    ~StyleSheetContents();

    CSSParserMode parserMode() const { return m_parserMode; }

    void parseString(const String&);

    const Vector<Ref<StyleRuleBase>>& childRules() const { return m_childRules; }
    unsigned ruleCount() const { return m_childRules.size(); }
    StyleRuleBase* ruleAt(unsigned index) const { return index < m_childRules.size() ? m_childRules[index].ptr() : nullptr; }

    void parserAppendRule(Ref<StyleRuleBase>&& rule) { m_childRules.append(WTF::move(rule)); }
    void clearRules() { m_childRules.clear(); }
    // False if the rule may not stand there, or may not go.
    bool wrapperInsertRule(Ref<StyleRuleBase>&&, unsigned index);
    bool wrapperDeleteRule(unsigned index);

private:
    explicit StyleSheetContents(CSSParserMode);

    Vector<Ref<StyleRuleBase>> m_childRules;
    CSSParserMode m_parserMode;
};

} // namespace WebCore
