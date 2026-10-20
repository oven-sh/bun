#include "config.h"
#include "StyleExtractor.h"

#include "CSSParser.h"
#include "Document.h"
#include "ElementInlines.h"
#include "HTMLSlotElement.h"
#include "ImmutableStyleProperties.h"
#include "RuleSetInlines.h"
#include "SelectorChecker.h"
#include "ShadowRoot.h"
#include "StyleScope.h"
#include "StyledElement.h"
#include "UserAgentStyle.h"
#include <wtf/text/StringBuilder.h>

namespace WebCore {
namespace Style {

namespace {

// An element, or one of its pseudo-elements.
struct Styleable {
    Styleable(const Element& element, PseudoElementType pseudoElement = PseudoElementType::None)
        : element(element)
        , pseudoElement(pseudoElement)
    {
    }

    // What it inherits from.
    std::optional<Styleable> parent() const
    {
        if (pseudoElement != PseudoElementType::None)
            return Styleable { element };
        if (auto* parent = element.parentElementInComposedTree())
            return Styleable { *parent };
        return std::nullopt;
    }

    const Element& element;
    PseudoElementType pseudoElement;
};

// The names of the custom properties that are being substituted, to find cycles.
using VariablesInProgress = Vector<AtomString, 4>;

// What a custom property is when its own value refers to a variable that has no value.
enum class UnresolvedReference : bool { MakesInvalid, KeepsDeclaredText };

String computedLonghandValue(const Styleable&, CSSPropertyID);
String computedCustomPropertyValue(const Styleable&, const AtomString& name, VariablesInProgress&, UnresolvedReference = UnresolvedReference::MakesInvalid);

// MARK: - The cascade

const RuleSet* ruleSetFor(const TreeScope& treeScope)
{
    auto* scope = Scope::forTreeScopeIfExists(treeScope);
    return scope ? &scope->ruleSet() : nullptr;
}

// `mayDeclare` says whether a rule set has a declaration of the kind at all, `findDeclaration` finds it in a block.
template<typename MayDeclare, typename FindDeclaration>
const CSSProperty* cascadedDeclaration(const Styleable& styleable, NOESCAPE const MayDeclare& mayDeclare, NOESCAPE const FindDeclaration& findDeclaration)
{
    struct Winner {
        const CSSProperty* declaration { nullptr };
        bool isInline { false };
        uint16_t layerPriority { 0 };
        unsigned specificity { 0 };
        unsigned position { 0 };
    };

    auto& element = styleable.element;
    SelectorChecker checker(element.document());

    auto consider = [&](Winner& winner, const RuleData& ruleData, bool isFromShadowTreeOfElement) {
        if (ruleData.pseudoElement != styleable.pseudoElement)
            return;
        auto* declaration = findDeclaration(ruleData.rule->properties());
        if (!declaration)
            return;
        // Matching is the expensive part: leave it out for a declaration that would lose anyway.
        if (winner.declaration) {
            if (winner.declaration->isImportant() != declaration->isImportant()) {
                if (winner.declaration->isImportant())
                    return;
            } else if (winner.isInline)
                return;
            else if (ruleData.layerPriority != winner.layerPriority) {
                // Among important declarations the order of the layers is the other way round.
                if ((ruleData.layerPriority < winner.layerPriority) != declaration->isImportant())
                    return;
            } else if (std::tie(ruleData.specificity, ruleData.position) < std::tie(winner.specificity, winner.position))
                return;
        }
        SelectorChecker::CheckingContext context;
        context.mustMatchHostPseudoClass = isFromShadowTreeOfElement;
        if (!checker.match(*ruleData.selector, element, context))
            return;
        winner = { declaration, false, ruleData.layerPriority, ruleData.specificity, ruleData.position };
    };

    // https://drafts.csswg.org/css-scoping/#shadow-cascading: what a shadow tree says about its host and about what is assigned to its slots
    // loses against the element's own tree, unless it is important. Then it wins.
    Winner innerWinner;
    if (auto* shadowRoot = element.shadowRoot()) {
        if (auto* ruleSet = ruleSetFor(*shadowRoot); ruleSet && mayDeclare(*ruleSet)) {
            for (auto& ruleData : ruleSet->hostPseudoClassRules())
                consider(innerWinner, ruleData, true);
        }
    }
    for (auto* slot = element.assignedSlot(); slot; slot = slot->assignedSlot()) {
        auto* ruleSet = ruleSetFor(slot->treeScope());
        if (!ruleSet || !mayDeclare(*ruleSet))
            continue;
        for (auto& rule : ruleSet->slottedPseudoElementRules()) {
            SelectorChecker::CheckingContext context;
            if (checker.match(*rule.slotSelector, *slot, context))
                consider(innerWinner, rule.ruleData, false);
        }
    }
    if (innerWinner.declaration && innerWinner.declaration->isImportant())
        return innerWinner.declaration;

    // The style attribute beats every rule of the same importance.
    Winner winner;
    if (styleable.pseudoElement == PseudoElementType::None) {
        if (auto* styledElement = dynamicDowncast<StyledElement>(element)) {
            if (auto* inlineStyle = styledElement->inlineStyle()) {
                winner = { findDeclaration(*inlineStyle), true };
                if (winner.declaration && winner.declaration->isImportant())
                    return winner.declaration;
            }
        }
    }

    if (auto* ruleSet = ruleSetFor(element.treeScope()); ruleSet && mayDeclare(*ruleSet)) {
        ruleSet->forEachCandidate(element, [&](const RuleData& ruleData) {
            consider(winner, ruleData, false);
        });
    }
    return winner.declaration ? winner.declaration : innerWinner.declaration;
}

const CSSProperty* cascadedDeclaration(const Styleable& styleable, CSSPropertyID id)
{
    return cascadedDeclaration(styleable, [&](const RuleSet& ruleSet) {
        return ruleSet.declaresProperty(id);
    }, [&](const StyleProperties& properties) {
        return properties.findDeclarationForCascade(id);
    });
}

const CSSProperty* cascadedCustomPropertyDeclaration(const Styleable& styleable, const AtomString& name)
{
    return cascadedDeclaration(styleable, [](const RuleSet& ruleSet) {
        return ruleSet.declaresCustomProperties();
    }, [&](const StyleProperties& properties) -> const CSSProperty* {
        int index = properties.findCustomPropertyIndex(name);
        return index == -1 ? nullptr : &properties.propertyAt(index);
    });
}

// MARK: - var()

bool mayHaveVariableReferences(const String& value)
{
    return value.containsIgnoringASCIICase("var("_s);
}

// Null if a variable has no value and the reference has no fallback.
String substituteVariables(const Styleable& styleable, const String& text, VariablesInProgress& inProgress)
{
    if (!mayHaveVariableReferences(text))
        return text;

    Vector<CSSParser::VariableReference> references;
    if (!CSSParser::findVariableReferences(text, references))
        return { };

    StringBuilder result;
    unsigned position = 0;
    for (auto& reference : references) {
        result.append(StringView { text }.substring(position, reference.start - position));
        auto value = computedCustomPropertyValue(styleable, AtomString { reference.name }, inProgress);
        if (value.isNull() && !reference.fallback.isNull())
            value = substituteVariables(styleable, reference.fallback, inProgress);
        if (value.isNull())
            return { };
        result.append(value);
        position = reference.end;
    }
    result.append(StringView { text }.substring(position));
    return result.toString();
}

String computedCustomPropertyValue(const Styleable& styleable, const AtomString& name, VariablesInProgress& inProgress, UnresolvedReference unresolvedReference)
{
    auto inheritedValue = [&]() -> String {
        auto parent = styleable.parent();
        if (!parent)
            return { };
        // A cycle is a matter of one element. The parent starts afresh.
        VariablesInProgress parentInProgress;
        return computedCustomPropertyValue(*parent, name, parentInProgress, unresolvedReference);
    };

    auto* declaration = cascadedCustomPropertyDeclaration(styleable, name);
    if (!declaration)
        return inheritedValue();

    auto& value = declaration->value();
    if (value == "initial"_s)
        return { };
    if (isCSSWideKeyword(value))
        return inheritedValue();
    if (!mayHaveVariableReferences(value))
        return value;

    if (inProgress.contains(name))
        return { };
    inProgress.append(name);
    auto result = substituteVariables(styleable, value, inProgress);
    inProgress.removeLast();
    if (result.isNull() && unresolvedReference == UnresolvedReference::KeepsDeclaredText)
        return value;
    return result;
}

// MARK: - Computed values

String initialValue(const Styleable& styleable, CSSPropertyID id)
{
    if (initialValueIsCurrentColor(id))
        return computedLonghandValue(styleable, CSSPropertyID::Color);
    return initialValueTextForLonghand(id);
}

String inheritedValue(const Styleable& styleable, CSSPropertyID id)
{
    if (auto parent = styleable.parent())
        return computedLonghandValue(*parent, id);
    return initialValue(styleable, id);
}

String unsetValue(const Styleable& styleable, CSSPropertyID id)
{
    return isInheritedProperty(id) ? inheritedValue(styleable, id) : initialValue(styleable, id);
}

// What the property has without any author style.
String userAgentValue(const Styleable& styleable, CSSPropertyID id)
{
    if (auto value = UserAgentStyle::value(styleable.element, styleable.pseudoElement, id); !value.isNull())
        return value;
    return unsetValue(styleable, id);
}

String computedColor(const Styleable& styleable, CSSPropertyID id, const String& value)
{
    auto color = CSSParser::computedColor(value);
    // `none`, `auto`, url(#gradient).
    if (color.isNull())
        return value;
    if (color != "currentcolor"_s)
        return color;
    if (id == CSSPropertyID::Color)
        return inheritedValue(styleable, id);
    return computedLonghandValue(styleable, CSSPropertyID::Color);
}

// The value a declaration gives a longhand once var() is out of the way. Null if that is not a valid value.
String substitutedValue(const Styleable& styleable, CSSPropertyID id, const CSSProperty& declaration, bool& hasUnresolvedReference)
{
    auto declaredProperty = declaration.isPendingSubstitution() ? declaration.shorthandID() : id;
    auto& declaredText = declaration.isPendingSubstitution() ? declaration.shorthandValue()->text() : declaration.value();

    VariablesInProgress inProgress;
    auto text = substituteVariables(styleable, declaredText, inProgress);
    hasUnresolvedReference = text.isNull();
    if (hasUnresolvedReference)
        return { };

    auto* properties = CSSParser::parseValue(declaredProperty, text, strictToCSSParserMode(!styleable.element.document().inQuirksMode()));
    if (!properties)
        return { };
    for (auto& property : *properties) {
        if (property.id() == id)
            return property.value();
    }
    return { };
}

String computedLonghandValue(const Styleable& styleable, CSSPropertyID id)
{
    auto* declaration = cascadedDeclaration(styleable, id);
    if (!declaration)
        return userAgentValue(styleable, id);

    String value = declaration->value();
    if (declaration->isPendingSubstitution() || mayHaveVariableReferences(value)) {
        bool hasUnresolvedReference;
        auto substituted = substitutedValue(styleable, id, *declaration, hasUnresolvedReference);
        // In a test the sheet with the theme's variables is often not loaded, and the declared text says more than an initial value nobody wrote.
        if (hasUnresolvedReference && !declaration->isPendingSubstitution())
            return value;
        // Invalid at computed-value time.
        if (substituted.isNull())
            return unsetValue(styleable, id);
        value = WTF::move(substituted);
    }

    if (isCSSWideKeyword(value)) {
        if (value == "inherit"_s)
            return inheritedValue(styleable, id);
        if (value == "initial"_s)
            return initialValue(styleable, id);
        if (value == "unset"_s)
            return unsetValue(styleable, id);
        // revert, revert-layer. There are no user styles and layers are not told apart.
        return userAgentValue(styleable, id);
    }

    if (isColorProperty(id))
        return computedColor(styleable, id, value);
    return value;
}

String computedShorthandValue(const Styleable& styleable, CSSPropertyID shorthand)
{
    auto longhands = longhandsForShorthand(shorthand);
    if (longhands.empty())
        return emptyString();

    // If one declaration of the shorthand wins for all the longhands, the answer is what an inline style with that declaration says.
    CSSShorthandValue* shorthandValue = nullptr;
    Vector<CSSProperty> declared;
    for (auto longhand : longhands) {
        auto* declaration = cascadedDeclaration(styleable, longhand);
        bool isFromSameDeclaration = declaration && declaration->shorthandValue() && declaration->shorthandID() == shorthand
            && (!shorthandValue || shorthandValue == declaration->shorthandValue());
        shorthandValue = isFromSameDeclaration ? declaration->shorthandValue() : nullptr;
        if (!shorthandValue)
            break;
        declared.append(*declaration);
    }
    if (shorthandValue) {
        String text;
        if (shorthandValue->hasVariableReferences()) {
            VariablesInProgress inProgress;
            text = substituteVariables(styleable, shorthandValue->text(), inProgress);
            if (text.isNull())
                text = shorthandValue->text();
        } else
            text = ImmutableStyleProperties::create(WTF::move(declared), HTMLStandardMode)->getPropertyValue(shorthand);
        if (!text.isEmpty() && !isCSSWideKeyword(text))
            return text;
    }

    // Some cannot be put together from their longhands.
    if (patternForShorthand(shorthand) == ShorthandPattern::AsSet)
        return emptyString();

    auto properties = WTF::map(longhands, [&](auto longhand) {
        // A color that nobody declared follows `color`. As a keyword it is left out, like every other initial value.
        if (initialValueIsCurrentColor(longhand) && !cascadedDeclaration(styleable, longhand))
            return CSSProperty { longhand, "currentcolor"_s };
        return CSSProperty { longhand, computedLonghandValue(styleable, longhand) };
    });
    return ImmutableStyleProperties::create(WTF::move(properties), HTMLStandardMode)->getPropertyValue(shorthand);
}

} // namespace

String Extractor::propertyValueSerialization(CSSPropertyID id) const
{
    Styleable styleable { m_element, m_pseudoElement };
    if (isLonghand(id))
        return computedLonghandValue(styleable, id);
    return computedShorthandValue(styleable, id);
}

String Extractor::customPropertyValueSerialization(const AtomString& name) const
{
    VariablesInProgress inProgress;
    return computedCustomPropertyValue({ m_element, m_pseudoElement }, name, inProgress, UnresolvedReference::KeepsDeclaredText);
}

Vector<AtomString> Extractor::customPropertyNames() const
{
    Vector<AtomString> names;
    auto add = [&](const StyleProperties& properties) {
        for (auto& property : properties) {
            if (property.id() == CSSPropertyID::Custom && !names.contains(property.customPropertyName()))
                names.append(property.customPropertyName());
        }
    };

    auto addFrom = [&](const Styleable* styleable) {
        if (styleable->pseudoElement == PseudoElementType::None) {
            if (auto* styledElement = dynamicDowncast<StyledElement>(styleable->element)) {
                if (auto* inlineStyle = styledElement->inlineStyle())
                    add(*inlineStyle);
            }
        }
        SelectorChecker checker(styleable->element.document());
        auto addIfMatches = [&](const RuleData& ruleData, bool isFromShadowTreeOfElement) {
            if (ruleData.pseudoElement != styleable->pseudoElement)
                return;
            SelectorChecker::CheckingContext context;
            context.mustMatchHostPseudoClass = isFromShadowTreeOfElement;
            if (checker.match(*ruleData.selector, styleable->element, context))
                add(ruleData.rule->properties());
        };
        if (auto* ruleSet = ruleSetFor(styleable->element.treeScope()); ruleSet && ruleSet->declaresCustomProperties()) {
            ruleSet->forEachCandidate(styleable->element, [&](const RuleData& ruleData) {
                addIfMatches(ruleData, false);
            });
        }
        if (auto* shadowRoot = styleable->element.shadowRoot()) {
            if (auto* ruleSet = ruleSetFor(*shadowRoot); ruleSet && ruleSet->declaresCustomProperties()) {
                for (auto& ruleData : ruleSet->hostPseudoClassRules())
                    addIfMatches(ruleData, true);
            }
        }
        for (auto* slot = styleable->element.assignedSlot(); slot; slot = slot->assignedSlot()) {
            auto* ruleSet = ruleSetFor(slot->treeScope());
            if (!ruleSet || !ruleSet->declaresCustomProperties())
                continue;
            for (auto& rule : ruleSet->slottedPseudoElementRules()) {
                SelectorChecker::CheckingContext context;
                if (checker.match(*rule.slotSelector, *slot, context))
                    addIfMatches(rule.ruleData, false);
            }
        }
    };

    Styleable self { m_element, m_pseudoElement };
    addFrom(&self);
    for (auto* ancestor = m_pseudoElement == PseudoElementType::None ? m_element.parentElementInComposedTree() : &m_element; ancestor; ancestor = ancestor->parentElementInComposedTree()) {
        Styleable styleable { *ancestor };
        addFrom(&styleable);
    }

    names.removeAllMatching([&](auto& name) {
        return customPropertyValueSerialization(name).isNull();
    });
    return names;
}

} // namespace Style
} // namespace WebCore
