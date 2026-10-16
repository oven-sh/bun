#include "config.h"
#include "CSSParser.h"

#include "BunCSSParser.h"
#include "BunSelectorParser.h"
#include "DOMClientData.h"
#include "Document.h"
#include "Element.h"
#include "ImmutableStyleProperties.h"
#include "MutableStyleProperties.h"
#include "NodeDocument.h"
#include "StyleSheetContents.h"
#include <wtf/Scope.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSParsedValueCache);

static uint32_t parserFlags(CSSParserMode mode)
{
    return isQuirksModeBehavior(mode) ? BunCSSParserFlagQuirksMode : 0;
}

BunCSSStrings::BunCSSStrings(const uint8_t* strings, size_t length)
    : m_strings(unsafeMakeSpan(strings, length))
{
}

String BunCSSStrings::string(BunCSSStringRange range)
{
    // The four widths of `border` are one range. Give them one string.
    if (range.offset == m_lastRange.offset && range.length == m_lastRange.length && !m_lastString.isNull())
        return m_lastString;
    m_lastRange = range;
    m_lastString = range.length ? String::fromUTF8(byteCast<char8_t>(m_strings.subspan(range.offset, range.length))) : emptyString();
    return m_lastString;
}

void appendBunCSSDeclarations(std::span<const BunCSSDeclaration> declarations, BunCSSStrings& strings, ParsedPropertyVector& result)
{
    RefPtr<CSSShorthandValue> shorthandValue;
    BunCSSStringRange shorthandRange { 0, 0 };

    result.reserveCapacity(result.size() + declarations.size());
    for (auto& declaration : declarations) {
        auto important = declaration.isImportant ? IsImportant::Yes : IsImportant::No;
        if (declaration.property == std::to_underlying(CSSPropertyID::Custom)) {
            result.append(CSSProperty { AtomString { strings.string(declaration.name) }, strings.string(declaration.value), important });
            continue;
        }

        auto id = static_cast<CSSPropertyID>(declaration.property);
        RELEASE_ASSERT(isLonghand(id) || id == CSSPropertyID::All);
        if (!declaration.shorthand) {
            result.append(CSSProperty { id, strings.string(declaration.value), important });
            continue;
        }

        auto shorthand = static_cast<CSSPropertyID>(declaration.shorthand);
        RELEASE_ASSERT(isShorthand(shorthand));
        // The longhands of one declaration follow each other and name the same range.
        if (!shorthandValue || shorthandValue->shorthand() != shorthand || shorthandRange.offset != declaration.shorthandValue.offset) {
            shorthandValue = CSSShorthandValue::create(shorthand, strings.string(declaration.shorthandValue), declaration.hasVariableReferences);
            shorthandRange = declaration.shorthandValue;
        }
        result.append(CSSProperty { id, declaration.hasVariableReferences ? String() : strings.string(declaration.value), important, shorthandValue.copyRef() });
    }
}

template<typename Function> static bool withUTF8(const String& string, NOESCAPE const Function& function)
{
    auto result = string.tryGetUTF8([&](std::span<const char8_t> utf8) {
        return function(byteCast<uint8_t>(utf8));
    }, StrictConversionReplacingUnpairedSurrogatesWithFFFD);
    return result && *result;
}

static bool parseValueUncached(CSSPropertyID id, const String& text, uint32_t flags, ParsedPropertyVector& result)
{
    return withUTF8(text, [&](std::span<const uint8_t> utf8) {
        BunCSSDeclarationList list;
        if (!Bun__CSS__DOM__parseValue(std::to_underlying(id), utf8.data(), utf8.size(), flags, &list))
            return false;
        auto freeList = makeScopeExit([&] {
            Bun__CSS__DOM__freeDeclarationList(&list);
        });
        BunCSSStrings strings { list.strings, list.stringsLength };
        appendBunCSSDeclarations(unsafeMakeSpan(list.declarations, list.declarationCount), strings, result);
        return true;
    });
}

static const CSSParsedValueCache::Entry& parseValueCached(CSSPropertyID id, const String& text, uint32_t flags)
{
    auto& cache = domClientData().cssParsedValueCache();
    if (text.isEmpty() || text.length() > CSSParsedValueCache::maxValueLength) {
        cache.lastLongValue = { };
        cache.lastLongValue.isValid = parseValueUncached(id, text, flags, cache.lastLongValue.properties);
        return cache.lastLongValue;
    }

    auto& values = cache.values;
    if (values.size() >= CSSParsedValueCache::maxSize)
        values.clear();
    return values.ensure(std::pair { static_cast<unsigned>(id) | flags << 16, text }, [&] {
        CSSParsedValueCache::Entry entry;
        entry.isValid = parseValueUncached(id, text, flags, entry.properties);
        return entry;
    }).iterator->value;
}

const ParsedPropertyVector* CSSParser::parseValue(CSSPropertyID id, const String& text, CSSParserMode mode)
{
    auto& entry = parseValueCached(id, text, parserFlags(mode));
    return entry.isValid ? &entry.properties : nullptr;
}

bool CSSParser::parseValue(MutableStyleProperties& declaration, CSSPropertyID id, const String& text, IsImportant important)
{
    auto* properties = parseValue(id, text, declaration.cssParserMode());
    if (!properties)
        return false;

    bool changed = false;
    for (auto property : *properties) {
        property.setIsImportant(important);
        changed |= declaration.setProperty(property);
    }
    return changed;
}

bool CSSParser::parseCustomPropertyValue(MutableStyleProperties& declaration, const AtomString& propertyName, const String& text, IsImportant important)
{
    // The parser checks the tokens and trims the value. It does not need the name for that.
    auto& entry = parseValueCached(CSSPropertyID::Custom, text, 0);
    if (!entry.isValid || entry.properties.size() != 1)
        return false;
    return declaration.setProperty(CSSProperty { propertyName, String { entry.properties[0].value() }, important });
}

static void parseDeclarationList(const String& text, CSSParserMode mode, ParsedPropertyVector& result)
{
    withUTF8(text, [&](std::span<const uint8_t> utf8) {
        BunCSSDeclarationList list;
        if (!Bun__CSS__DOM__parseDeclarationList(utf8.data(), utf8.size(), parserFlags(mode), &list))
            return false;
        auto freeList = makeScopeExit([&] {
            Bun__CSS__DOM__freeDeclarationList(&list);
        });
        BunCSSStrings strings { list.strings, list.stringsLength };
        appendBunCSSDeclarations(unsafeMakeSpan(list.declarations, list.declarationCount), strings, result);
        return true;
    });
}

bool CSSParser::parseDeclarationList(MutableStyleProperties& declaration, const String& text)
{
    ParsedPropertyVector properties;
    WebCore::parseDeclarationList(text, declaration.cssParserMode(), properties);
    return declaration.addParsedProperties(properties);
}

Ref<ImmutableStyleProperties> CSSParser::parseInlineStyleDeclaration(const String& text, const Element& element)
{
    auto mode = strictToCSSParserMode(element.isHTMLElement() && !element.document().inQuirksMode());
    Ref declaration = MutableStyleProperties::create(mode);
    parseDeclarationList(declaration, text);
    return declaration->immutableCopyIfNeeded();
}

String CSSParser::computedColor(const String& text)
{
    auto& entry = parseValueCached(CSSPropertyID::Color, text, BunCSSParserFlagResolveColors);
    if (!entry.isValid || entry.properties.size() != 1)
        return { };
    return entry.properties[0].value();
}

bool CSSParser::findVariableReferences(const String& text, Vector<VariableReference>& result)
{
    // The parser counts bytes of UTF-8. They are code units as long as the text is ASCII, which is checked first.
    bool isASCII = text.containsOnlyASCII();
    return withUTF8(text, [&](std::span<const uint8_t> utf8) {
        BunCSSVariableReferenceList list;
        if (!Bun__CSS__DOM__findVariableReferences(utf8.data(), utf8.size(), &list))
            return false;
        auto freeList = makeScopeExit([&] {
            Bun__CSS__DOM__freeVariableReferenceList(&list);
        });
        auto toString = [&](BunCSSStringRange range) {
            return String::fromUTF8(byteCast<char8_t>(utf8.subspan(range.offset, range.length)));
        };
        auto toCodeUnits = [&](uint32_t byteOffset) -> unsigned {
            if (isASCII)
                return byteOffset;
            return toString({ 0, byteOffset }).length();
        };
        for (auto& reference : unsafeMakeSpan(list.references, list.referenceCount)) {
            result.append(VariableReference {
                toCodeUnits(reference.whole.offset),
                toCodeUnits(reference.whole.offset + reference.whole.length),
                toString(reference.name),
                reference.hasFallback ? toString(reference.fallback) : String(),
            });
            if (reference.hasFallback && result.last().fallback.isNull())
                result.last().fallback = emptyString();
        }
        return true;
    });
}

bool CSSParser::supportsDeclaration(const String& property, const String& value)
{
    if (isCustomPropertyName(property))
        return parseValueCached(CSSPropertyID::Custom, value, 0).isValid;
    auto id = cssPropertyID(property);
    return id != CSSPropertyID::Invalid && parseValue(id, value, HTMLStandardMode);
}

// MARK: - Rules

static StyleRuleType toStyleRuleType(BunCSSRuleKind kind)
{
    switch (kind) {
    case BunCSSRuleKind::Style:
        return StyleRuleType::Style;
    case BunCSSRuleKind::Media:
        return StyleRuleType::Media;
    case BunCSSRuleKind::Supports:
        return StyleRuleType::Supports;
    case BunCSSRuleKind::LayerBlock:
        return StyleRuleType::LayerBlock;
    case BunCSSRuleKind::Container:
        return StyleRuleType::Container;
    case BunCSSRuleKind::Scope:
        return StyleRuleType::Scope;
    case BunCSSRuleKind::StartingStyle:
        return StyleRuleType::StartingStyle;
    case BunCSSRuleKind::FontFace:
        return StyleRuleType::FontFace;
    case BunCSSRuleKind::Keyframes:
        return StyleRuleType::Keyframes;
    case BunCSSRuleKind::Import:
        return StyleRuleType::Import;
    case BunCSSRuleKind::Namespace:
        return StyleRuleType::Namespace;
    case BunCSSRuleKind::Property:
        return StyleRuleType::Property;
    case BunCSSRuleKind::Page:
        return StyleRuleType::Page;
    case BunCSSRuleKind::CounterStyle:
        return StyleRuleType::CounterStyle;
    case BunCSSRuleKind::LayerStatement:
        return StyleRuleType::LayerStatement;
    case BunCSSRuleKind::FontPaletteValues:
        return StyleRuleType::FontPaletteValues;
    case BunCSSRuleKind::FontFeatureValues:
        return StyleRuleType::FontFeatureValues;
    case BunCSSRuleKind::ViewTransition:
        return StyleRuleType::ViewTransition;
    case BunCSSRuleKind::PositionTry:
        return StyleRuleType::PositionTry;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

class BunStyleSheetBuilder {
public:
    BunStyleSheetBuilder(const BunCSSStyleSheet& sheet, CSSParserMode mode)
        : m_selectors(unsafeMakeSpan(sheet.selectors, sheet.selectorCount))
        , m_declarations(unsafeMakeSpan(sheet.declarations, sheet.declarationCount))
        , m_strings(sheet.strings, sheet.stringsLength)
        , m_mode(mode)
    {
    }

    Vector<Ref<StyleRuleBase>> buildRules(std::span<const BunCSSRule> rules)
    {
        Vector<Ref<StyleRuleBase>> result;
        while (!rules.empty()) {
            auto& rule = rules.front();
            rules = rules.subspan(1);
            RELEASE_ASSERT(rule.descendantCount <= rules.size());
            auto descendants = rules.first(rule.descendantCount);
            rules = rules.subspan(rule.descendantCount);
            if (RefPtr built = buildRule(rule, descendants))
                result.append(built.releaseNonNull());
        }
        return result;
    }

private:
    RefPtr<StyleRuleBase> buildRule(const BunCSSRule& rule, std::span<const BunCSSRule> descendants)
    {
        auto type = toStyleRuleType(rule.kind);
        switch (rule.kind) {
        case BunCSSRuleKind::Style:
            return buildStyleRule(rule, descendants);
        case BunCSSRuleKind::Media:
        case BunCSSRuleKind::Supports:
        case BunCSSRuleKind::LayerBlock:
        case BunCSSRuleKind::Container:
        case BunCSSRuleKind::Scope:
        case BunCSSRuleKind::StartingStyle:
            return StyleRuleGroup::create(type, m_strings.string(rule.prelude), rule.conditionIsTrue, buildRules(descendants));
        default:
            return StyleRuleText::create(type, m_strings.string(rule.prelude), m_strings.string(rule.text));
        }
    }

    // Null if the selector checker's parser refuses a selector that the style sheet's parser let through.
    RefPtr<StyleRule> buildStyleRule(const BunCSSRule& rule, std::span<const BunCSSRule> descendants)
    {
        RELEASE_ASSERT(rule.selectorCount && rule.firstSelector + rule.selectorCount <= m_selectors.size());
        RELEASE_ASSERT(rule.firstDeclaration + rule.declarationCount <= m_declarations.size());

        StyleRule::Selectors selectors;
        StringBuilder listText;
        for (auto& selector : m_selectors.subspan(rule.firstSelector, rule.selectorCount)) {
            if (!listText.isEmpty())
                listText.append(", "_s);
            listText.append(m_strings.string(selector.text));
            selectors.pseudoElements.append(static_cast<PseudoElementType>(selector.pseudoElement));
        }
        auto list = parseCSSSelectorList(listText.toString(), isQuirksModeBehavior(m_mode));
        if (!list || list->size() != rule.selectorCount)
            return nullptr;
        selectors.list = WTF::move(*list);
        selectors.text = m_strings.string(rule.prelude);

        ParsedPropertyVector parsed;
        appendBunCSSDeclarations(m_declarations.subspan(rule.firstDeclaration, rule.declarationCount), m_strings, parsed);
        Ref properties = MutableStyleProperties::create(m_mode);
        properties->addParsedProperties(parsed);
        return StyleRule::create(WTF::move(selectors), properties->immutableCopyIfNeeded(), buildRules(descendants));
    }

    std::span<const BunCSSSelector> m_selectors;
    std::span<const BunCSSDeclaration> m_declarations;
    BunCSSStrings m_strings;
    CSSParserMode m_mode;
};

static Vector<Ref<StyleRuleBase>> parseRules(const String& text, CSSParserMode mode, uint32_t moreFlags = 0)
{
    Vector<Ref<StyleRuleBase>> rules;
    withUTF8(text, [&](std::span<const uint8_t> utf8) {
        BunCSSStyleSheet sheet;
        if (!Bun__CSS__DOM__parseStyleSheet(utf8.data(), utf8.size(), parserFlags(mode) | moreFlags, &sheet))
            return false;
        auto freeSheet = makeScopeExit([&] {
            Bun__CSS__DOM__freeStyleSheet(&sheet);
        });
        rules = BunStyleSheetBuilder { sheet, mode }.buildRules(unsafeMakeSpan(sheet.rules, sheet.ruleCount));
        return true;
    });
    return rules;
}

void CSSParser::parseSheet(StyleSheetContents& contents, const String& text)
{
    for (auto& rule : parseRules(text, contents.parserMode()))
        contents.parserAppendRule(WTF::move(rule));
}

RefPtr<StyleRuleBase> CSSParser::parseRule(const String& text, CSSParserMode mode)
{
    auto rules = parseRules(text, mode, BunCSSParserFlagRefuseInvalidRules);
    if (rules.size() != 1)
        return nullptr;
    return WTF::move(rules[0]);
}

std::optional<StyleRule::Selectors> CSSParser::parseStyleRuleSelectors(const String& text, CSSParserMode mode)
{
    RefPtr rule = dynamicDowncast<StyleRule>(parseRule(makeString(text, " { }"_s), mode));
    if (!rule)
        return std::nullopt;
    return rule->takeSelectors();
}

static RefPtr<StyleRuleGroup> parseConditionRule(ASCIILiteral name, StringView condition, StyleRuleType type)
{
    RefPtr rule = dynamicDowncast<StyleRuleGroup>(CSSParser::parseRule(makeString(name, ' ', condition, " { }"_s), HTMLStandardMode));
    return rule && rule->type() == type ? rule : nullptr;
}

MediaQueries CSSParser::parseMediaQueries(const String& text)
{
    if (text.isEmpty())
        return { emptyString(), true };
    if (RefPtr rule = parseConditionRule("@media"_s, text, StyleRuleType::Media))
        return { rule->prelude(), rule->conditionIsTrue() };
    return { "not all"_s, false };
}

bool CSSParser::supportsCondition(const String& condition)
{
    if (RefPtr rule = parseConditionRule("@supports"_s, condition, StyleRuleType::Supports))
        return rule->conditionIsTrue();
    // CSS.supports("display: flex") is CSS.supports("(display: flex)").
    if (RefPtr rule = parseConditionRule("@supports"_s, makeString('(', condition, ')'), StyleRuleType::Supports))
        return rule->conditionIsTrue();
    return false;
}

} // namespace WebCore
