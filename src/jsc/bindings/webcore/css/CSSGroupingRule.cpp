#include "config.h"
#include "CSSGroupingRule.h"

#include "CSSParser.h"
#include "CSSRuleList.h"
#include "CSSStyleSheet.h"
#include "ExceptionOr.h"
#include "StyleSheetContents.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSGroupingRule);

CSSGroupingRule::CSSGroupingRule(StyleRuleGroup& groupRule, CSSStyleSheet* parent)
    : CSSRule(parent)
    , m_groupRule(groupRule)
    , m_childRuleCSSOMWrappers(groupRule.childRules().size())
{
}

CSSGroupingRule::~CSSGroupingRule()
{
    ASSERT(m_childRuleCSSOMWrappers.size() == m_groupRule->childRules().size());
    for (auto& wrapper : m_childRuleCSSOMWrappers) {
        if (wrapper)
            wrapper->setParentRule(nullptr);
    }
}

ExceptionOr<unsigned> CSSGroupingRule::insertRule(const String& ruleString, unsigned index)
{
    ASSERT(m_childRuleCSSOMWrappers.size() == m_groupRule->childRules().size());

    if (index > m_groupRule->childRules().size()) {
        // IndexSizeError: Raised if the specified index is not a valid insertion point.
        return Exception { ExceptionCode::IndexSizeError };
    }

    RefPtr styleSheet = parentStyleSheet();
    RefPtr newRule = CSSParser::parseRule(ruleString, styleSheet ? styleSheet->contents().parserMode() : HTMLStandardMode);
    if (!newRule)
        return Exception { ExceptionCode::SyntaxError };

    if (newRule->type() == StyleRuleType::Import || newRule->type() == StyleRuleType::Namespace) {
        // HierarchyRequestError: Raised if the rule cannot be inserted at the specified
        // index, e.g., if an @import rule is inserted after a standard rule set or other
        // at-rule.
        return Exception { ExceptionCode::HierarchyRequestError };
    }

    CSSStyleSheet::RuleMutationScope mutationScope(this);

    m_groupRule->wrapperInsertRule(index, newRule.releaseNonNull());

    m_childRuleCSSOMWrappers.insert(index, RefPtr<CSSRule>());
    return index;
}

ExceptionOr<void> CSSGroupingRule::deleteRule(unsigned index)
{
    ASSERT(m_childRuleCSSOMWrappers.size() == m_groupRule->childRules().size());

    if (index >= m_groupRule->childRules().size()) {
        // IndexSizeError: Raised if the specified index does not correspond to a
        // rule in the media rule list.
        return Exception { ExceptionCode::IndexSizeError };
    }

    CSSStyleSheet::RuleMutationScope mutationScope(this);

    m_groupRule->wrapperRemoveRule(index);

    if (m_childRuleCSSOMWrappers[index])
        m_childRuleCSSOMWrappers[index]->setParentRule(nullptr);
    m_childRuleCSSOMWrappers.removeAt(index);

    return { };
}

static ASCIILiteral atRuleName(StyleRuleType type)
{
    switch (type) {
    case StyleRuleType::Media:
        return "@media"_s;
    case StyleRuleType::Supports:
        return "@supports"_s;
    case StyleRuleType::LayerBlock:
        return "@layer"_s;
    case StyleRuleType::Container:
        return "@container"_s;
    case StyleRuleType::Scope:
        return "@scope"_s;
    case StyleRuleType::StartingStyle:
        return "@starting-style"_s;
    default:
        ASSERT_NOT_REACHED();
        return ""_s;
    }
}

String CSSGroupingRule::cssText() const
{
    StringBuilder builder;
    builder.append(atRuleName(styleRuleType()));
    // "@media  {" is what an empty list of media queries leaves.
    if (!m_groupRule->prelude().isEmpty() || styleRuleType() == StyleRuleType::Media)
        builder.append(' ', m_groupRule->prelude());
    builder.append(" {"_s);
    for (unsigned index = 0; index < length(); ++index) {
        auto ruleText = protect(item(index))->cssText();
        if (!ruleText.isEmpty())
            builder.append("\n  "_s, WTF::move(ruleText));
    }
    builder.append("\n}"_s);
    return builder.toString();
}

unsigned CSSGroupingRule::length() const
{
    return m_groupRule->childRules().size();
}

CSSRule* CSSGroupingRule::item(unsigned index) const
{
    if (index >= length())
        return nullptr;
    ASSERT(m_childRuleCSSOMWrappers.size() == m_groupRule->childRules().size());
    auto& rule = m_childRuleCSSOMWrappers[index];
    if (!rule)
        rule = m_groupRule->childRules()[index]->createCSSOMWrapper(const_cast<CSSGroupingRule&>(*this));
    return rule.get();
}

CSSRuleList& CSSGroupingRule::cssRules() const
{
    if (!m_ruleListCSSOMWrapper)
        lazyInitialize(m_ruleListCSSOMWrapper, makeUniqueWithoutRefCountedCheck<LiveCSSRuleList<CSSGroupingRule>, CSSRuleList>(const_cast<CSSGroupingRule&>(*this)));
    return *m_ruleListCSSOMWrapper;
}

} // namespace WebCore
