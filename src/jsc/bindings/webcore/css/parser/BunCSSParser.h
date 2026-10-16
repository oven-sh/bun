#pragma once

#include "CSSProperty.h"
#include <span>

// The C ABI of src/css/dom, where it is documented. Every type and number here mirrors mod.rs there.
// All text is UTF-8. What a call writes is owned by Rust: give it back with the matching free function.

namespace WebCore {

enum BunCSSParserFlag : uint32_t {
    // Lengths may be written without a unit.
    BunCSSParserFlagQuirksMode = 1 << 0,
    // Color keywords are written as rgb(), as in computed style.
    BunCSSParserFlagResolveColors = 1 << 1,
    // parseStyleSheet returns false if a rule at the top level is not valid, where it otherwise leaves the rule out.
    BunCSSParserFlagRefuseInvalidRules = 1 << 2,
};

// A part of the `strings` of the list it belongs to.
struct BunCSSStringRange {
    uint32_t offset;
    uint32_t length;
};

struct BunCSSDeclaration {
    // A CSSPropertyID: a longhand, `all`, or CSSPropertyID::Custom.
    uint16_t property;
    // The shorthand it was expanded from, or 0.
    uint16_t shorthand;
    bool isImportant;
    // The shorthand has var() in it, so the longhand has no value yet.
    bool hasVariableReferences;
    // Of a custom property.
    BunCSSStringRange name;
    BunCSSStringRange value;
    // The same range for all longhands of one declaration.
    BunCSSStringRange shorthandValue;
};

struct BunCSSDeclarationList {
    BunCSSDeclaration* declarations;
    size_t declarationCount;
    uint8_t* strings;
    size_t stringsLength;
};

enum class BunCSSRuleKind : uint8_t {
    Style = 0,
    // Rules with rules inside. `prelude` is the condition or the name.
    Media = 1,
    Supports = 2,
    LayerBlock = 3,
    Container = 4,
    Scope = 5,
    StartingStyle = 6,
    // Rules the DOM keeps as text.
    FontFace = 7,
    Keyframes = 8,
    Import = 9,
    Namespace = 10,
    Property = 11,
    Page = 12,
    CounterStyle = 13,
    LayerStatement = 14,
    FontPaletteValues = 15,
    FontFeatureValues = 16,
    ViewTransition = 17,
    PositionTry = 18,
};

enum class BunCSSPseudoElement : uint8_t {
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
    // x::slotted(y) is two selectors of the list: y, with this kind, for the element that is assigned to a slot...
    Slotted = 10,
    // ... and right after it x, for the slot.
    SlotOfSlotted = 11,
    // One that getComputedStyle() has no style for.
    Other = 255,
};

// One complex selector of a style rule, without its pseudo-element.
struct BunCSSSelector {
    BunCSSStringRange text;
    BunCSSPseudoElement pseudoElement;
};

struct BunCSSRule {
    BunCSSRuleKind kind;
    // Media, Supports: whether the rules inside apply.
    bool conditionIsTrue;
    // How many of the rules that follow are inside this one, at any depth.
    uint32_t descendantCount;
    uint32_t firstSelector;
    uint32_t selectorCount;
    uint32_t firstDeclaration;
    uint32_t declarationCount;
    // Style: the selector list, serialized. Rules with rules inside: what stands between the name and the block.
    BunCSSStringRange prelude;
    // The whole rule as it was written.
    BunCSSStringRange text;
};

struct BunCSSStyleSheet {
    BunCSSRule* rules;
    size_t ruleCount;
    BunCSSSelector* selectors;
    size_t selectorCount;
    BunCSSDeclaration* declarations;
    size_t declarationCount;
    uint8_t* strings;
    size_t stringsLength;
};

// The ranges are parts of the input.
struct BunCSSVariableReference {
    // From "var(" to ")".
    BunCSSStringRange whole;
    BunCSSStringRange name;
    BunCSSStringRange fallback;
    bool hasFallback;
};

struct BunCSSVariableReferenceList {
    BunCSSVariableReference* references;
    size_t referenceCount;
};

static_assert(sizeof(BunCSSDeclaration) == 32);
static_assert(offsetof(BunCSSDeclaration, name) == 8);
static_assert(sizeof(BunCSSSelector) == 12);
static_assert(sizeof(BunCSSRule) == 40);
static_assert(offsetof(BunCSSRule, descendantCount) == 4);
static_assert(offsetof(BunCSSRule, prelude) == 24);
static_assert(sizeof(BunCSSVariableReference) == 28);

extern "C" {

// Invalid declarations are left out. Only false if the input is not UTF-8.
bool Bun__CSS__DOM__parseDeclarationList(const uint8_t* utf8, size_t length, uint32_t flags, BunCSSDeclarationList* result);
// False if the value is not valid for the property. `!important` is not part of a value.
// With CSSPropertyID::Custom the result is one declaration without a name.
bool Bun__CSS__DOM__parseValue(uint16_t property, const uint8_t* utf8, size_t length, uint32_t flags, BunCSSDeclarationList* result);
void Bun__CSS__DOM__freeDeclarationList(BunCSSDeclarationList*);

// Invalid rules are left out.
bool Bun__CSS__DOM__parseStyleSheet(const uint8_t* utf8, size_t length, uint32_t flags, BunCSSStyleSheet* result);
void Bun__CSS__DOM__freeStyleSheet(BunCSSStyleSheet*);

// The outermost var() functions, in order. False if one of them is malformed.
bool Bun__CSS__DOM__findVariableReferences(const uint8_t* utf8, size_t length, BunCSSVariableReferenceList* result);
void Bun__CSS__DOM__freeVariableReferenceList(BunCSSVariableReferenceList*);

}

class BunCSSStrings {
public:
    BunCSSStrings(const uint8_t* strings, size_t length);

    String string(BunCSSStringRange);

private:
    std::span<const uint8_t> m_strings;
    BunCSSStringRange m_lastRange { 0, 0 };
    String m_lastString;
};

void appendBunCSSDeclarations(std::span<const BunCSSDeclaration>, BunCSSStrings&, ParsedPropertyVector&);

} // namespace WebCore
