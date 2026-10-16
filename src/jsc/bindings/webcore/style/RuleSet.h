#pragma once

#include "CSSPropertyNames.h"
#include "StyleRule.h"
#include <wtf/BitSet.h>
#include <wtf/HashMap.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/AtomStringHash.h>

namespace WebCore {

class CSSStyleSheet;
class Element;

namespace Style {

// One complex selector of a style rule.
struct RuleData {
    const StyleRule* rule;
    const CSSSelector* selector;
    unsigned specificity;
    // Its place among all rules of the scope.
    unsigned position;
    PseudoElementType pseudoElement;
    // An index into the layers of the rule set. 0: in no layer.
    uint16_t layer;
    // The higher, the later in the order of the layers. Rules in no layer come last.
    uint16_t layerPriority { 0 };
};

// x::slotted(y)
struct SlottedRuleData {
    // Its selector is y.
    RuleData ruleData;
    const CSSSelector* slotSelector;
};

// The style rules of a tree scope that are in force, sorted into buckets by what the rightmost compound selector asks for,
// so that an element is only tested against the few rules that name its id, one of its classes or its tag.
class RuleSet {
    WTF_MAKE_TZONE_ALLOCATED(RuleSet);
public:
    using RuleDataVector = Vector<RuleData, 1>;

    void addRulesFromSheet(CSSStyleSheet&);
    // The order of the layers is known when all sheets have been seen.
    void didAddAllRules();

    // False means that no rule can give an element a value for the property: there is nothing to match.
    bool declaresProperty(CSSPropertyID id) const { return m_declaresAll || m_declaredProperties.get(std::to_underlying(id)); }
    bool declaresCustomProperties() const { return m_declaredProperties.get(std::to_underlying(CSSPropertyID::Custom)); }

    // Calls the function with every rule the element may match.
    template<typename Function> void forEachCandidate(const Element&, NOESCAPE const Function&) const;

    // The rules of a shadow tree whose subject is :host. They are for the host, which is not in the tree.
    const RuleDataVector& hostPseudoClassRules() const LIFETIME_BOUND { return m_hostPseudoClassRules; }
    // The rules of a shadow tree for what is assigned to its slots.
    const Vector<SlottedRuleData>& slottedPseudoElementRules() const LIFETIME_BOUND { return m_slottedPseudoElementRules; }

private:
    void addChildRules(const Vector<Ref<StyleRuleBase>>&);
    void addStyleRule(const StyleRule&);
    void addOwnDeclarations(const StyleRule&);
    void addRule(RuleData&&);

    // https://drafts.csswg.org/css-cascade-5/#layering
    struct CascadeLayer {
        // Null: it has no name, so nothing else can add to it.
        String name;
        uint16_t parent;
    };
    uint16_t ensureLayer(uint16_t parent, StringView name);
    // "a.b" is the layer b in the layer a.
    uint16_t ensureLayerForPath(uint16_t parent, StringView path);

    // The first one stands for "in no layer" and is the parent of the outermost layers.
    Vector<CascadeLayer, 1> m_layers { CascadeLayer { { }, 0 } };
    uint16_t m_currentLayer { 0 };

    HashMap<AtomString, RuleDataVector> m_idRules;
    HashMap<AtomString, RuleDataVector> m_classRules;
    HashMap<AtomString, RuleDataVector> m_tagLowercaseLocalNameRules;
    RuleDataVector m_universalRules;
    RuleDataVector m_hostPseudoClassRules;
    Vector<SlottedRuleData> m_slottedPseudoElementRules;
    WTF::BitSet<lastCSSProperty + 1> m_declaredProperties;
    bool m_declaresAll { false };
    unsigned m_ruleCount { 0 };
};

} // namespace Style
} // namespace WebCore
