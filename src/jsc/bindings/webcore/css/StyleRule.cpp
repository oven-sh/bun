#include "config.h"
#include "StyleRule.h"

#include "CSSGroupingRule.h"
#include "CSSLayerBlockRule.h"
#include "CSSLayerStatementRule.h"
#include "CSSMediaRule.h"
#include "CSSStyleRule.h"
#include "CSSStyleSheet.h"
#include "CSSSupportsRule.h"
#include "CSSTextRule.h"
#include "MutableStyleProperties.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleRuleBase);
WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleRule);
WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleRuleGroup);
WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleRuleText);

StyleRuleBase::~StyleRuleBase() = default;

bool StyleRuleBase::isGroupRule() const
{
    switch (m_type) {
    case StyleRuleType::Media:
    case StyleRuleType::Supports:
    case StyleRuleType::LayerBlock:
    case StyleRuleType::Container:
    case StyleRuleType::Scope:
    case StyleRuleType::StartingStyle:
        return true;
    default:
        return false;
    }
}

Ref<CSSRule> StyleRuleBase::createCSSOMWrapper(CSSStyleSheet* parentSheet, CSSRule* parentRule) const
{
    auto& self = const_cast<StyleRuleBase&>(*this);
    auto wrapper = [&]() -> Ref<CSSRule> {
        switch (m_type) {
        case StyleRuleType::Style:
            return CSSStyleRule::create(uncheckedDowncast<StyleRule>(self), parentSheet);
        case StyleRuleType::Media:
            return CSSMediaRule::create(uncheckedDowncast<StyleRuleGroup>(self), parentSheet);
        case StyleRuleType::Supports:
            return CSSSupportsRule::create(uncheckedDowncast<StyleRuleGroup>(self), parentSheet);
        case StyleRuleType::LayerBlock:
            return CSSLayerBlockRule::create(uncheckedDowncast<StyleRuleGroup>(self), parentSheet);
        case StyleRuleType::LayerStatement:
            return CSSLayerStatementRule::create(uncheckedDowncast<StyleRuleText>(self), parentSheet);
        default:
            if (isGroupRule())
                return CSSGroupingRule::create(uncheckedDowncast<StyleRuleGroup>(self), parentSheet);
            return CSSTextRule::create(uncheckedDowncast<StyleRuleText>(self), parentSheet);
        }
    }();
    if (parentRule)
        wrapper->setParentRule(parentRule);
    return wrapper;
}

Ref<CSSRule> StyleRuleBase::createCSSOMWrapper(CSSStyleSheet& parentSheet) const
{
    return createCSSOMWrapper(&parentSheet, nullptr);
}

Ref<CSSRule> StyleRuleBase::createCSSOMWrapper(CSSGroupingRule& parentRule) const
{
    return createCSSOMWrapper(nullptr, &parentRule);
}

Ref<CSSRule> StyleRuleBase::createCSSOMWrapper(CSSStyleRule& parentRule) const
{
    return createCSSOMWrapper(nullptr, &parentRule);
}

StyleRule::StyleRule(Selectors&& selectors, Ref<StyleProperties>&& properties, Vector<Ref<StyleRuleBase>>&& nestedRules)
    : StyleRuleBase(StyleRuleType::Style)
    , m_selectors(WTF::move(selectors))
    , m_properties(WTF::move(properties))
    , m_nestedRules(WTF::move(nestedRules))
{
}

StyleRule::~StyleRule() = default;

Ref<StyleRule> StyleRule::create(Selectors&& selectors, Ref<StyleProperties>&& properties, Vector<Ref<StyleRuleBase>>&& nestedRules)
{
    return adoptRef(*new StyleRule(WTF::move(selectors), WTF::move(properties), WTF::move(nestedRules)));
}

MutableStyleProperties& StyleRule::mutableProperties()
{
    if (!is<MutableStyleProperties>(m_properties))
        m_properties = m_properties->mutableCopy();
    return uncheckedDowncast<MutableStyleProperties>(m_properties.get());
}

StyleRuleGroup::StyleRuleGroup(StyleRuleType type, String&& prelude, bool conditionIsTrue, Vector<Ref<StyleRuleBase>>&& rules)
    : StyleRuleBase(type)
    , m_childRules(WTF::move(rules))
    , m_prelude(WTF::move(prelude))
    , m_conditionIsTrue(conditionIsTrue)
{
}

StyleRuleGroup::~StyleRuleGroup() = default;

Ref<StyleRuleGroup> StyleRuleGroup::create(StyleRuleType type, String&& prelude, bool conditionIsTrue, Vector<Ref<StyleRuleBase>>&& rules)
{
    return adoptRef(*new StyleRuleGroup(type, WTF::move(prelude), conditionIsTrue, WTF::move(rules)));
}

void StyleRuleGroup::wrapperInsertRule(unsigned index, Ref<StyleRuleBase>&& rule)
{
    m_childRules.insert(index, WTF::move(rule));
}

void StyleRuleGroup::wrapperRemoveRule(unsigned index)
{
    m_childRules.removeAt(index);
}

void StyleRuleGroup::setPrelude(String&& prelude, bool conditionIsTrue)
{
    m_prelude = WTF::move(prelude);
    m_conditionIsTrue = conditionIsTrue;
}

StyleRuleText::StyleRuleText(StyleRuleType type, String&& prelude, String&& text)
    : StyleRuleBase(type)
    , m_prelude(WTF::move(prelude))
    , m_text(WTF::move(text))
{
}

StyleRuleText::~StyleRuleText() = default;

Ref<StyleRuleText> StyleRuleText::create(StyleRuleType type, String&& prelude, String&& text)
{
    return adoptRef(*new StyleRuleText(type, WTF::move(prelude), WTF::move(text)));
}

} // namespace WebCore
