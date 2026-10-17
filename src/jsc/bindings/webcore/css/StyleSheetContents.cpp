#include "config.h"
#include "StyleSheetContents.h"

#include "CSSParser.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleSheetContents);

StyleSheetContents::StyleSheetContents(CSSParserMode mode)
    : m_parserMode(mode)
{
}

StyleSheetContents::~StyleSheetContents() = default;

void StyleSheetContents::parseString(const String& sheetText)
{
    CSSParser::parseSheet(*this, sheetText);
}

// A sheet has `@layer a, b;` statements, then @import rules, then @namespace rules, then everything else.
enum class RulePlace : uint8_t { Import, Namespace, Other };

static RulePlace placeOf(const StyleRuleBase& rule)
{
    switch (rule.type()) {
    case StyleRuleType::Import:
        return RulePlace::Import;
    case StyleRuleType::Namespace:
        return RulePlace::Namespace;
    default:
        return RulePlace::Other;
    }
}

bool StyleSheetContents::wrapperInsertRule(Ref<StyleRuleBase>&& rule, unsigned index)
{
    ASSERT_WITH_SECURITY_IMPLICATION(index <= ruleCount());

    unsigned leadingLayerStatements = 0;
    while (leadingLayerStatements < m_childRules.size() && m_childRules[leadingLayerStatements]->type() == StyleRuleType::LayerStatement)
        ++leadingLayerStatements;

    if (rule->type() != StyleRuleType::LayerStatement || index > leadingLayerStatements) {
        auto place = placeOf(rule);
        if (place != RulePlace::Other && index < leadingLayerStatements)
            return false;
        // Inserting @namespace rule when rules other than import/namespace/charset are present is not allowed.
        if (place == RulePlace::Namespace && leadingLayerStatements)
            return false;
        for (unsigned i = leadingLayerStatements; i < m_childRules.size(); ++i) {
            auto otherPlace = placeOf(m_childRules[i]);
            if (i < index ? otherPlace > place : otherPlace < place)
                return false;
            if (place == RulePlace::Namespace && otherPlace == RulePlace::Other)
                return false;
        }
    }

    m_childRules.insert(index, WTF::move(rule));
    return true;
}

bool StyleSheetContents::wrapperDeleteRule(unsigned index)
{
    ASSERT_WITH_SECURITY_IMPLICATION(index < ruleCount());

    // Deleting @namespace rule when list contains anything other than @import or @namespace rules is not allowed.
    if (m_childRules[index]->type() == StyleRuleType::Namespace) {
        for (auto& rule : m_childRules) {
            if (placeOf(rule) == RulePlace::Other)
                return false;
        }
    }

    m_childRules.removeAt(index);
    return true;
}

} // namespace WebCore
