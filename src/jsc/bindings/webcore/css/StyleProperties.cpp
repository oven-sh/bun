#include "config.h"
#include "StyleProperties.h"

#include "CSSMarkup.h"
#include "ImmutableStyleProperties.h"
#include "MutableStyleProperties.h"
#include <array>
#include <wtf/BitSet.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleProperties);
WTF_MAKE_TZONE_ALLOCATED_IMPL(ImmutableStyleProperties);

StyleProperties::StyleProperties(CSSParserMode mode, bool isMutable)
    : m_cssParserMode(mode)
    , m_isMutable(isMutable)
{
}

StyleProperties::StyleProperties(CSSParserMode mode, bool isMutable, Vector<CSSProperty>&& properties)
    : m_propertyVector(WTF::move(properties))
    , m_cssParserMode(mode)
    , m_isMutable(isMutable)
{
}

StyleProperties::~StyleProperties() = default;

bool isCSSWideKeyword(StringView value)
{
    switch (value.length()) {
    case 5:
        return value == "unset"_s;
    case 6:
        return value == "revert"_s;
    case 7:
        return value == "inherit"_s || value == "initial"_s;
    case 12:
        return value == "revert-layer"_s;
    default:
        return false;
    }
}

int StyleProperties::findPropertyIndex(CSSPropertyID id) const
{
    // Backwards, as upstream: the property that was set last is the one most likely to be asked for.
    for (int n = m_propertyVector.size() - 1; n >= 0; --n) {
        if (m_propertyVector[n].id() == id)
            return n;
    }
    return -1;
}

int StyleProperties::findCustomPropertyIndex(StringView propertyName) const
{
    for (int n = m_propertyVector.size() - 1; n >= 0; --n) {
        auto& property = m_propertyVector[n];
        if (property.id() == CSSPropertyID::Custom && property.customPropertyName() == propertyName)
            return n;
    }
    return -1;
}

const CSSProperty* StyleProperties::findDeclarationForCascade(CSSPropertyID id) const
{
    const CSSProperty* all = nullptr;
    for (int n = m_propertyVector.size() - 1; n >= 0; --n) {
        auto& property = m_propertyVector[n];
        if (property.id() == id)
            return &property;
        if (property.id() == CSSPropertyID::All)
            all = &property;
    }
    // What `all` overrides is removed when it is added, so a declaration that is still here comes after it.
    return all && isAffectedByAll(id) ? all : nullptr;
}

String StyleProperties::getPropertyValue(CSSPropertyID id) const
{
    if (id == CSSPropertyID::All)
        return serializeAll();
    if (isShorthand(id))
        return serializeShorthandValue(id);
    // Also what `all` says about it.
    auto* declaration = findDeclarationForCascade(id);
    return declaration ? declaration->value() : String();
}

bool StyleProperties::propertyIsImportant(CSSPropertyID id) const
{
    if (auto* declaration = findDeclarationForCascade(id))
        return declaration->isImportant();

    auto longhands = longhandsForShorthand(id);
    if (longhands.empty())
        return false;
    for (auto longhand : longhands) {
        if (!propertyIsImportant(longhand))
            return false;
    }
    return true;
}

String StyleProperties::getCustomPropertyValue(const String& propertyName) const
{
    int index = findCustomPropertyIndex(propertyName);
    if (index == -1)
        return { };
    return m_propertyVector[index].value();
}

bool StyleProperties::customPropertyIsImportant(const String& propertyName) const
{
    int index = findCustomPropertyIndex(propertyName);
    return index != -1 && m_propertyVector[index].isImportant();
}

Ref<MutableStyleProperties> StyleProperties::mutableCopy() const
{
    return adoptRef(*new MutableStyleProperties(*this));
}

Ref<ImmutableStyleProperties> StyleProperties::immutableCopyIfNeeded() const
{
    if (auto* immutableProperties = dynamicDowncast<ImmutableStyleProperties>(*this))
        return const_cast<ImmutableStyleProperties&>(*immutableProperties);
    return ImmutableStyleProperties::create(Vector<CSSProperty> { m_propertyVector }, m_cssParserMode);
}

bool StyleProperties::hasCSSOMWrapper() const
{
    auto* mutableProperties = dynamicDowncast<MutableStyleProperties>(*this);
    return mutableProperties && mutableProperties->m_cssomWrapper;
}

// MARK: - Shorthands

static String serializeQuad(const String& top, const String& right, const String& bottom, const String& left)
{
    if (left != right)
        return makeString(top, ' ', right, ' ', bottom, ' ', left);
    if (bottom != top)
        return makeString(top, ' ', right, ' ', bottom);
    if (right != top)
        return makeString(top, ' ', right);
    return top;
}

// What a longhand has when a shorthand of the OmitInitial kind does not mention it.
static ASCIILiteral omittedValue(CSSPropertyID shorthand, unsigned index)
{
    if (shorthand == CSSPropertyID::FlexFlow)
        return index ? "nowrap"_s : "row"_s;
    if (shorthand == CSSPropertyID::TextDecoration)
        return std::array { "none"_s, "solid"_s, "currentcolor"_s, "auto"_s }[index];
    if (shorthand == CSSPropertyID::ListStyle)
        return std::array { "outside"_s, "none"_s, "disc"_s }[index];
    // Width, style, color: the borders and the outline.
    switch (index) {
    case 0:
        return "medium"_s;
    case 1:
        return "none"_s;
    default:
        return "currentcolor"_s;
    }
}

static String serializeOmittingInitialValues(CSSPropertyID shorthand, std::span<const String> values)
{
    StringBuilder result;
    for (unsigned i = 0; i < values.size(); ++i) {
        if (values[i] == omittedValue(shorthand, i))
            continue;
        if (!result.isEmpty())
            result.append(' ');
        result.append(values[i]);
    }
    if (result.isEmpty())
        return values[0];
    return result.toString();
}

// "1px 2px" is the horizontal and the vertical radius of a corner, "1px" is both.
static std::pair<String, String> splitCornerRadius(const String& value)
{
    unsigned depth = 0;
    for (unsigned i = 0; i < value.length(); ++i) {
        auto character = value[i];
        if (character == '(')
            ++depth;
        else if (character == ')' && depth)
            --depth;
        else if (character == ' ' && !depth)
            return { value.left(i), value.substring(i + 1) };
    }
    return { value, value };
}

static bool isCommaSeparatedList(const String& value)
{
    unsigned depth = 0;
    for (unsigned i = 0; i < value.length(); ++i) {
        auto character = value[i];
        if (character == '(')
            ++depth;
        else if (character == ')' && depth)
            --depth;
        else if (character == ',' && !depth)
            return true;
    }
    return false;
}

// One layer: image, position x and y, size, repeat, attachment, origin, clip, color. What has its initial value is left out.
static String serializeBackground(std::span<const String> values)
{
    for (auto& value : values) {
        // A list per longhand would have to be zipped.
        if (isCommaSeparatedList(value))
            return { };
    }

    StringBuilder result;
    auto append = [&](auto&&... parts) {
        if (!result.isEmpty())
            result.append(' ');
        result.append(parts...);
    };

    if (values[0] != "none"_s)
        append(values[0]);
    bool hasSize = values[3] != "auto"_s;
    if (hasSize || values[1] != "0%"_s || values[2] != "0%"_s)
        append(values[1], ' ', values[2]);
    if (hasSize)
        append("/ "_s, values[3]);
    if (values[4] != "repeat"_s)
        append(values[4]);
    if (values[5] != "scroll"_s)
        append(values[5]);
    if (values[6] != "padding-box"_s || values[7] != "border-box"_s) {
        append(values[6]);
        if (values[7] != values[6])
            append(values[7]);
    }
    // A color that the shorthand did not mention is rgba(0, 0, 0, 0). The keyword is there only if the author wrote it.
    if (values[8] != "rgba(0, 0, 0, 0)"_s)
        append(values[8]);
    if (result.isEmpty())
        return "none"_s;
    return result.toString();
}

// One identifier that is a name and not a keyword of <grid-line>.
static bool isGridLineName(const String& value)
{
    if (value.isEmpty() || value == "auto"_s || value == "span"_s)
        return false;
    if (isASCIIDigit(value[0]) || value[0] == '+' || (value[0] == '-' && value.length() > 1 && isASCIIDigit(value[1])))
        return false;
    return !value.contains(' ') && !value.contains('(');
}

// a / b, or row-start / column-start / row-end / column-end. A line goes unsaid if leaving it out says the same.
static String serializeGridLines(std::span<const String> values)
{
    auto impliedValue = [&](unsigned index) -> String {
        auto& opposite = values[index == 3 ? 1 : 0];
        return isGridLineName(opposite) ? opposite : "auto"_s;
    };
    unsigned count = values.size();
    while (count > 1 && values[count - 1] == impliedValue(count - 1))
        --count;

    StringBuilder result;
    for (unsigned i = 0; i < count; ++i) {
        if (i)
            result.append(" / "_s);
        result.append(values[i]);
    }
    return result.toString();
}

String StyleProperties::serializeShorthandValue(CSSPropertyID shorthand) const
{
    auto longhands = longhandsForShorthand(shorthand);
    constexpr unsigned maxLonghands = 16;
    if (longhands.empty() || longhands.size() > maxLonghands)
        return { };

    std::array<const CSSProperty*, maxLonghands> properties;
    for (unsigned i = 0; i < longhands.size(); ++i) {
        properties[i] = findDeclarationForCascade(longhands[i]);
        if (!properties[i] || properties[i]->isImportant() != properties[0]->isImportant())
            return { };
    }

    // Still as one declaration of this shorthand left them.
    String declaredText;
    if (auto* shorthandValue = properties[0]->shorthandValue(); shorthandValue && shorthandValue->shorthand() == shorthand) {
        bool isIntact = true;
        for (unsigned i = 1; i < longhands.size() && isIntact; ++i)
            isIntact = properties[i]->shorthandValue() == shorthandValue;
        if (isIntact)
            declaredText = shorthandValue->text();
    }

    // For these two, the parser's text has the components in the order and in the number no browser writes them. It only serves for lists.
    auto pattern = patternForShorthand(shorthand);
    bool prefersPattern = pattern == ShorthandPattern::Background || shorthand == CSSPropertyID::BackgroundPosition;
    if (!declaredText.isNull() && (!prefersPattern || properties[0]->isPendingSubstitution()))
        return declaredText;

    std::array<String, maxLonghands> values;
    unsigned wideKeywordCount = 0;
    for (unsigned i = 0; i < longhands.size(); ++i) {
        if (properties[i]->isPendingSubstitution())
            return { };
        values[i] = properties[i]->value();
        if (isCSSWideKeyword(values[i])) {
            if (values[i] != values[0])
                return { };
            ++wideKeywordCount;
        }
    }
    if (wideKeywordCount)
        return wideKeywordCount == longhands.size() ? values[0] : String();

    auto allEqual = [&](unsigned first, unsigned count) {
        for (unsigned i = first + 1; i < first + count; ++i) {
            if (values[i] != values[first])
                return false;
        }
        return true;
    };

    switch (pattern) {
    case ShorthandPattern::AsSet:
        return { };
    case ShorthandPattern::Quad:
        return serializeQuad(values[0], values[1], values[2], values[3]);
    case ShorthandPattern::Pair:
        return values[0] == values[1] ? values[0] : makeString(values[0], ' ', values[1]);
    case ShorthandPattern::OmitInitial:
        return serializeOmittingInitialValues(shorthand, std::span { values }.first(longhands.size()));
    case ShorthandPattern::AllValues: {
        StringBuilder result;
        for (unsigned i = 0; i < longhands.size(); ++i) {
            // A list per longhand would have to be zipped.
            if (isCommaSeparatedList(values[i]))
                return declaredText;
            if (i)
                result.append(' ');
            result.append(values[i]);
        }
        return result.toString();
    }
    case ShorthandPattern::Border: {
        // Four widths, four styles, four colors, border-image.
        if (!allEqual(0, 4) || !allEqual(4, 4) || !allEqual(8, 4) || values[12] != "none"_s)
            return { };
        std::array<String, 3> parts { values[0], values[4], values[8] };
        return serializeOmittingInitialValues(shorthand, parts);
    }
    case ShorthandPattern::BorderAxis: {
        if (!allEqual(0, 2) || !allEqual(2, 2) || !allEqual(4, 2))
            return { };
        std::array<String, 3> parts { values[0], values[2], values[4] };
        return serializeOmittingInitialValues(shorthand, parts);
    }
    case ShorthandPattern::BorderRadius: {
        std::array<std::pair<String, String>, 4> corners;
        bool isElliptical = false;
        for (unsigned i = 0; i < 4; ++i) {
            corners[i] = splitCornerRadius(values[i]);
            isElliptical |= corners[i].first != corners[i].second;
        }
        auto horizontal = serializeQuad(corners[0].first, corners[1].first, corners[2].first, corners[3].first);
        if (!isElliptical)
            return horizontal;
        return makeString(horizontal, " / "_s, serializeQuad(corners[0].second, corners[1].second, corners[2].second, corners[3].second));
    }
    case ShorthandPattern::GridLines:
        return serializeGridLines(std::span { values }.first(longhands.size()));
    case ShorthandPattern::Background: {
        auto result = serializeBackground(std::span { values }.first(longhands.size()));
        return result.isNull() ? declaredText : result;
    }
    }
    return { };
}

// The keyword that every property `all` stands for has. Null if they do not all have the same one.
String StyleProperties::serializeAll() const
{
    int allIndex = findPropertyIndex(CSSPropertyID::All);
    // `all` is stored as one declaration. Without it, each of its longhands has to be there.
    constexpr unsigned longhandCount = numLonghandProperties - 2;
    if (allIndex == -1 && m_propertyVector.size() < longhandCount)
        return { };

    const CSSProperty* first = allIndex == -1 ? nullptr : &m_propertyVector[allIndex];
    unsigned count = 0;
    for (auto& property : m_propertyVector) {
        if (!isAffectedByAll(property.id()))
            continue;
        if (!first)
            first = &property;
        if (property.value() != first->value() || property.isImportant() != first->isImportant())
            return { };
        ++count;
    }
    if (!first || !isCSSWideKeyword(first->value()) || (allIndex == -1 && count < longhandCount))
        return { };
    return first->value();
}

// MARK: - The block

static void appendDeclaration(StringBuilder& result, StringView name, const String& value, bool isImportant)
{
    if (!result.isEmpty())
        result.append(' ');
    result.append(name, ": "_s, value, isImportant ? " !important;"_s : ";"_s);
}

// https://drafts.csswg.org/cssom/#serialize-a-css-declaration-block
String StyleProperties::asText() const
{
    StringBuilder result;
    WTF::BitSet<numLonghandProperties> alreadySerialized;

    // What `all` says is not said again.
    auto allValue = serializeAll();
    bool wroteAll = false;
    int allIndex = allValue.isNull() ? findPropertyIndex(CSSPropertyID::All) : -1;

    for (auto& property : m_propertyVector) {
        auto id = property.id();
        if (id == CSSPropertyID::Custom) {
            StringBuilder name;
            serializeIdentifier(name, property.customPropertyName());
            appendDeclaration(result, name, property.value(), property.isImportant());
            continue;
        }
        if (!allValue.isNull() && isAffectedByAll(id)) {
            if (!std::exchange(wroteAll, true))
                appendDeclaration(result, nameLiteral(CSSPropertyID::All), allValue, property.isImportant());
            continue;
        }
        if (!isLonghand(id)) {
            appendDeclaration(result, nameLiteral(id), property.value(), property.isImportant());
            continue;
        }
        if (alreadySerialized.get(std::to_underlying(id) - firstLonghandProperty))
            continue;
        if (allIndex != -1 && isAffectedByAll(id) && property.value() == m_propertyVector[allIndex].value() && property.isImportant() == m_propertyVector[allIndex].isImportant())
            continue;

        bool wroteShorthand = false;
        for (auto shorthand : matchingShorthandsForLonghand(id)) {
            auto longhands = longhandsForShorthand(shorthand);
            bool overlaps = false;
            for (auto longhand : longhands)
                overlaps |= alreadySerialized.get(std::to_underlying(longhand) - firstLonghandProperty);
            if (overlaps)
                continue;
            auto value = serializeShorthandValue(shorthand);
            if (value.isNull())
                continue;
            appendDeclaration(result, nameLiteral(shorthand), value, property.isImportant());
            for (auto longhand : longhands)
                alreadySerialized.set(std::to_underlying(longhand) - firstLonghandProperty);
            wroteShorthand = true;
            break;
        }
        if (!wroteShorthand)
            appendDeclaration(result, nameLiteral(id), property.value(), property.isImportant());
    }
    return result.toString();
}

AtomString StyleProperties::asTextAtom() const
{
    return AtomString { asText() };
}

} // namespace WebCore
