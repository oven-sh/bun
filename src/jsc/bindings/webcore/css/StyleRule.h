#pragma once

#include "CSSSelectorList.h"
#include "StyleProperties.h"
#include "StyleRuleType.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/TypeCasts.h>

namespace WebCore {

class CSSGroupingRule;
class CSSRule;
class CSSStyleRule;
class CSSStyleSheet;
class MutableStyleProperties;

// The pseudo-elements getComputedStyle() answers for. The numbers are those of src/css/dom.
enum class PseudoElementType : uint8_t {
    None = 0,
    Before = 1,
    After = 2,
    Marker = 3,
    FirstLine = 4,
    FirstLetter = 5,
    Placeholder = 6,
    Selection = 7,
    Backdrop = 8,
    FileSelectorButton = 9,
    // x::slotted(y) is two selectors of the list: y, with this type, for the element that is assigned to a slot...
    Slotted = 10,
    // ... and right after it x, for the slot.
    SlotOfSlotted = 11,
    Other = 255,
};

class StyleRuleBase : public RefCounted<StyleRuleBase> {
    WTF_MAKE_TZONE_ALLOCATED(StyleRuleBase);
public:
    virtual ~StyleRuleBase();

    StyleRuleType type() const { return m_type; }
    bool isStyleRule() const { return m_type == StyleRuleType::Style; }
    bool isGroupRule() const;

    Ref<CSSRule> createCSSOMWrapper(CSSStyleSheet& parentSheet) const;
    Ref<CSSRule> createCSSOMWrapper(CSSGroupingRule& parentRule) const;
    Ref<CSSRule> createCSSOMWrapper(CSSStyleRule& parentRule) const;

protected:
    explicit StyleRuleBase(StyleRuleType type)
        : m_type(type)
    {
    }

private:
    Ref<CSSRule> createCSSOMWrapper(CSSStyleSheet* parentSheet, CSSRule* parentRule) const;

    StyleRuleType m_type;
};

class StyleRule final : public StyleRuleBase {
    WTF_MAKE_TZONE_ALLOCATED(StyleRule);
public:
    // What a selector list is for the cascade: the complex selectors without their pseudo-elements, and the pseudo-element of each.
    struct Selectors {
        CSSSelectorList list;
        Vector<PseudoElementType> pseudoElements;
        String text;
    };

    static Ref<StyleRule> create(Selectors&&, Ref<StyleProperties>&&, Vector<Ref<StyleRuleBase>>&& nestedRules = { });
    ~StyleRule();

    const CSSSelectorList& selectorList() const { return m_selectors.list; }
    // Of the nth complex selector of the list.
    PseudoElementType pseudoElement(unsigned index) const { return m_selectors.pseudoElements[index]; }
    const String& selectorText() const { return m_selectors.text; }
    void setSelectors(Selectors&& selectors) { m_selectors = WTF::move(selectors); }
    Selectors takeSelectors() { return WTF::move(m_selectors); }

    const StyleProperties& properties() const { return m_properties; }
    MutableStyleProperties& mutableProperties();

    // Their selectors have the `&` replaced by what this rule's selectors were when the sheet was parsed.
    const Vector<Ref<StyleRuleBase>>& nestedRules() const LIFETIME_BOUND { return m_nestedRules; }

private:
    StyleRule(Selectors&&, Ref<StyleProperties>&&, Vector<Ref<StyleRuleBase>>&& nestedRules);

    Selectors m_selectors;
    Ref<StyleProperties> m_properties;
    Vector<Ref<StyleRuleBase>> m_nestedRules;
};

// @media, @supports, @layer { }, @container, @scope, @starting-style.
class StyleRuleGroup final : public StyleRuleBase {
    WTF_MAKE_TZONE_ALLOCATED(StyleRuleGroup);
public:
    static Ref<StyleRuleGroup> create(StyleRuleType, String&& prelude, bool conditionIsTrue, Vector<Ref<StyleRuleBase>>&&);
    ~StyleRuleGroup();

    const Vector<Ref<StyleRuleBase>>& childRules() const { return m_childRules; }
    void wrapperInsertRule(unsigned index, Ref<StyleRuleBase>&&);
    void wrapperRemoveRule(unsigned index);

    // What stands between the name of the rule and its block, serialized.
    const String& prelude() const { return m_prelude; }
    void setPrelude(String&& prelude, bool conditionIsTrue);

    // Whether the rules inside take part in the cascade.
    bool conditionIsTrue() const { return m_conditionIsTrue; }

private:
    StyleRuleGroup(StyleRuleType, String&& prelude, bool conditionIsTrue, Vector<Ref<StyleRuleBase>>&&);

    Vector<Ref<StyleRuleBase>> m_childRules;
    String m_prelude;
    bool m_conditionIsTrue;
};

// A rule that has no effect without rendering (@font-face, @keyframes, @import, ...). It is kept as it was written.
class StyleRuleText final : public StyleRuleBase {
    WTF_MAKE_TZONE_ALLOCATED(StyleRuleText);
public:
    static Ref<StyleRuleText> create(StyleRuleType, String&& prelude, String&& text);
    ~StyleRuleText();

    const String& prelude() const { return m_prelude; }
    const String& text() const { return m_text; }

private:
    StyleRuleText(StyleRuleType, String&& prelude, String&& text);

    String m_prelude;
    String m_text;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::StyleRule)
    static bool isType(const WebCore::StyleRuleBase& rule) { return rule.isStyleRule(); }
SPECIALIZE_TYPE_TRAITS_END()

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::StyleRuleGroup)
    static bool isType(const WebCore::StyleRuleBase& rule) { return rule.isGroupRule(); }
SPECIALIZE_TYPE_TRAITS_END()

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::StyleRuleText)
    static bool isType(const WebCore::StyleRuleBase& rule) { return !rule.isStyleRule() && !rule.isGroupRule(); }
SPECIALIZE_TYPE_TRAITS_END()
