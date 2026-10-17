#include "config.h"
#include "RuleSet.h"

#include "CSSStyleSheet.h"
#include "CommonAtomStrings.h"
#include "SelectorChecker.h"
#include "StyleSheetContents.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {
namespace Style {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RuleSet);

void RuleSet::addRulesFromSheet(CSSStyleSheet& sheet)
{
    addChildRules(sheet.contents().childRules());
}

void RuleSet::addChildRules(const Vector<Ref<StyleRuleBase>>& rules)
{
    for (auto& rule : rules) {
        if (auto* styleRule = dynamicDowncast<StyleRule>(rule.get()))
            addStyleRule(*styleRule);
        else if (auto* groupRule = dynamicDowncast<StyleRuleGroup>(rule.get())) {
            if (!groupRule->conditionIsTrue())
                continue;
            auto enclosingLayer = m_currentLayer;
            if (groupRule->type() == StyleRuleType::LayerBlock)
                m_currentLayer = ensureLayerForPath(enclosingLayer, groupRule->prelude());
            addChildRules(groupRule->childRules());
            m_currentLayer = enclosingLayer;
        } else if (rule->type() == StyleRuleType::LayerStatement) {
            // It only says in which order the layers come.
            for (auto path : StringView { uncheckedDowncast<StyleRuleText>(rule.get()).prelude() }.split(','))
                ensureLayerForPath(m_currentLayer, path);
        }
    }
}

uint16_t RuleSet::ensureLayer(uint16_t parent, StringView name)
{
    if (!name.isEmpty()) {
        for (uint16_t layer = 1; layer < m_layers.size(); ++layer) {
            if (m_layers[layer].parent == parent && m_layers[layer].name == name)
                return layer;
        }
    }
    // More than 65,535 layers: the rest counts as one.
    if (m_layers.size() > std::numeric_limits<uint16_t>::max())
        return m_layers.size() - 1;
    m_layers.append({ name.isEmpty() ? String() : name.toString(), parent });
    return m_layers.size() - 1;
}

uint16_t RuleSet::ensureLayerForPath(uint16_t parent, StringView path)
{
    path = path.trim(isASCIIWhitespace<char16_t>);
    if (path.isEmpty())
        return ensureLayer(parent, { });
    for (auto name : path.split('.'))
        parent = ensureLayer(parent, name);
    return parent;
}

void RuleSet::didAddAllRules()
{
    if (m_layers.size() == 1)
        return;

    // The layers inside a layer come first, in the order they were first named, and then what is in the layer itself.
    Vector<uint16_t> priorities;
    priorities.fill(0, m_layers.size());
    uint16_t nextPriority = 0;
    auto visit = [&](auto& visit, uint16_t layer) -> void {
        for (uint16_t child = 1; child < m_layers.size(); ++child) {
            if (m_layers[child].parent == layer)
                visit(visit, child);
        }
        priorities[layer] = nextPriority++;
    };
    visit(visit, 0);

    auto update = [&](RuleDataVector& rules) {
        for (auto& ruleData : rules)
            ruleData.layerPriority = priorities[ruleData.layer];
    };
    for (auto* map : { &m_idRules, &m_classRules, &m_tagLowercaseLocalNameRules }) {
        for (auto& rules : map->values())
            update(rules);
    }
    update(m_universalRules);
    update(m_hostPseudoClassRules);
    for (auto& rule : m_slottedPseudoElementRules)
        rule.ruleData.layerPriority = priorities[rule.ruleData.layer];
}

void RuleSet::addStyleRule(const StyleRule& rule)
{
    addOwnDeclarations(rule);
    addChildRules(rule.nestedRules());
}

void RuleSet::addOwnDeclarations(const StyleRule& rule)
{
    if (rule.properties().isEmpty())
        return;

    for (auto& property : rule.properties()) {
        m_declaredProperties.set(std::to_underlying(property.id()));
        m_declaresAll |= property.id() == CSSPropertyID::All;
    }

    unsigned position = m_ruleCount++;
    unsigned index = 0;
    const CSSSelector* slottedSelector = nullptr;
    for (auto& selector : rule.selectorList()) {
        auto pseudoElement = rule.pseudoElement(index++);
        if (pseudoElement == PseudoElementType::Other)
            continue;
        if (pseudoElement == PseudoElementType::Slotted) {
            slottedSelector = &selector;
            continue;
        }
        if (pseudoElement == PseudoElementType::SlotOfSlotted) {
            RELEASE_ASSERT(slottedSelector);
            unsigned specificity = slottedSelector->computeSpecificity() + selector.computeSpecificity() + 1;
            m_slottedPseudoElementRules.append({ { &rule, slottedSelector, specificity, position, PseudoElementType::None, m_currentLayer }, &selector });
            continue;
        }
        // The pseudo-element was taken off the selector. It counts like a type selector.
        unsigned specificity = selector.computeSpecificity() + (pseudoElement == PseudoElementType::None ? 0 : 1);
        addRule({ &rule, &selector, specificity, position, pseudoElement, m_currentLayer });
    }
}

void RuleSet::addRule(RuleData&& ruleData)
{
    const AtomString* id = nullptr;
    const AtomString* className = nullptr;
    const AtomString* tagName = nullptr;
    bool hasHostPseudoClass = false;

    for (auto* selector = ruleData.selector; selector; selector = selector->precedingInComplexSelector()) {
        switch (selector->match()) {
        case CSSSelector::Match::Id:
            id = &selector->value();
            break;
        case CSSSelector::Match::Class:
            className = &selector->value();
            break;
        case CSSSelector::Match::Tag:
            if (selector->tagQName().localName() != starAtom())
                tagName = &selector->tagLowercaseLocalName();
            break;
        case CSSSelector::Match::PseudoClass:
            hasHostPseudoClass |= selector->isHostPseudoClass();
            break;
        default:
            break;
        }
        if (selector->relation() != CSSSelector::Relation::Subselector)
            break;
    }

    if (hasHostPseudoClass)
        m_hostPseudoClassRules.append(WTF::move(ruleData));
    else if (id)
        m_idRules.ensure(*id, [] { return RuleDataVector { }; }).iterator->value.append(WTF::move(ruleData));
    else if (className)
        m_classRules.ensure(*className, [] { return RuleDataVector { }; }).iterator->value.append(WTF::move(ruleData));
    else if (tagName)
        m_tagLowercaseLocalNameRules.ensure(*tagName, [] { return RuleDataVector { }; }).iterator->value.append(WTF::move(ruleData));
    else {
        // Only a rule whose subject compound is allowed to match a featureless element can match the shadow host.
        if (SelectorChecker::isCompoundSelectorAllowedToMatchFeaturelessShadowHost(*ruleData.selector))
            m_hostPseudoClassRules.append(ruleData);
        m_universalRules.append(WTF::move(ruleData));
    }
}

} // namespace Style
} // namespace WebCore
