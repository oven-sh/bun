#pragma once

#include "CSSParserMode.h"
#include "CSSProperty.h"
#include "MediaList.h"
#include "StyleRule.h"
#include <wtf/HashMap.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

class Element;
class ImmutableStyleProperties;
class MutableStyleProperties;
class StyleSheetContents;

// The front of Bun's CSS parser (src/css/dom). Nothing in C++ tokenizes, checks or serializes a CSS value.
class CSSParser {
public:
    // True if the declaration block has changed. A value that is not valid changes nothing.
    static bool parseValue(MutableStyleProperties&, CSSPropertyID, const String&, IsImportant);
    static bool parseCustomPropertyValue(MutableStyleProperties&, const AtomString& propertyName, const String&, IsImportant);
    static bool parseDeclarationList(MutableStyleProperties&, const String&);
    static Ref<ImmutableStyleProperties> parseInlineStyleDeclaration(const String&, const Element&);

    static void parseSheet(StyleSheetContents&, const String&);
    // Null if `text` is not exactly one valid rule.
    static RefPtr<StyleRuleBase> parseRule(const String& text, CSSParserMode);
    static std::optional<StyleRule::Selectors> parseStyleRuleSelectors(const String&, CSSParserMode);
    static MediaQueries parseMediaQueries(const String&);

    // The longhands `text` stands for as a value of the property, or nothing if it is not valid.
    // The result belongs to the VM's cache: use it before the next call.
    static const ParsedPropertyVector* parseValue(CSSPropertyID, const String& text, CSSParserMode);

    // A color as computed style has it: "rgb(255, 0, 0)" for "red". "currentcolor" stays. Null if `text` is not a color.
    static String computedColor(const String& text);

    // One outermost var() of a value. The positions count UTF-16 code units of the string that was scanned.
    struct VariableReference {
        unsigned start;
        unsigned end;
        String name;
        // Null if there is no comma.
        String fallback;
    };
    // False if the syntax of a var() is wrong.
    static bool findVariableReferences(const String&, Vector<VariableReference>&);

    static bool supportsDeclaration(const String& property, const String& value);
    static bool supportsCondition(const String&);
};

// What values have been parsed to, so that setting `display: none` a thousand times reaches the parser once. One per VM.
class CSSParsedValueCache {
    WTF_MAKE_TZONE_ALLOCATED(CSSParsedValueCache);
public:
    struct Entry {
        bool isValid { false };
        ParsedPropertyVector properties;
    };

    static constexpr unsigned maxSize = 512;

    // Longer values are not worth keeping.
    static constexpr unsigned maxValueLength = 128;

    // The key is the property and the parser's flags.
    HashMap<std::pair<unsigned, String>, Entry> values;
    Entry lastLongValue;
};

} // namespace WebCore
