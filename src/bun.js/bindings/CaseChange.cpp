#include "root.h"
#include "CaseChange.h"

#include <unicode/uchar.h>
#include <unicode/utf16.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>

namespace Bun {

using namespace JSC;
using namespace WTF;

enum class CaseType {
    Camel,
    Pascal,
    Snake,
    Kebab,
    Constant,
    Dot,
    Capital,
    Train,
    Path,
    Sentence,
    No
};

enum class CharClass {
    Lower,
    Upper,
    Digit,
    Other
};

enum class WordTransform {
    Lower,
    Upper,
    Capitalize
};

static inline CharClass classifyCp(char32_t c)
{
    if (c < 0x80) {
        if (c >= 'a' && c <= 'z')
            return CharClass::Lower;
        if (c >= 'A' && c <= 'Z')
            return CharClass::Upper;
        if (c >= '0' && c <= '9')
            return CharClass::Digit;
        return CharClass::Other;
    }
    if (u_hasBinaryProperty(c, UCHAR_UPPERCASE))
        return CharClass::Upper;
    if (u_hasBinaryProperty(c, UCHAR_ALPHABETIC))
        return CharClass::Lower;
    return CharClass::Other;
}

static inline char separator(CaseType type)
{
    switch (type) {
    case CaseType::Camel:
    case CaseType::Pascal:
        return 0;
    case CaseType::Snake:
    case CaseType::Constant:
        return '_';
    case CaseType::Kebab:
    case CaseType::Train:
        return '-';
    case CaseType::Dot:
        return '.';
    case CaseType::Capital:
    case CaseType::Sentence:
    case CaseType::No:
        return ' ';
    case CaseType::Path:
        return '/';
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static inline bool hasDigitPrefixUnderscore(CaseType type)
{
    return type == CaseType::Camel || type == CaseType::Pascal;
}

static inline WordTransform getTransform(CaseType type, size_t wordIndex)
{
    switch (type) {
    case CaseType::Camel:
        return wordIndex == 0 ? WordTransform::Lower : WordTransform::Capitalize;
    case CaseType::Pascal:
        return WordTransform::Capitalize;
    case CaseType::Snake:
    case CaseType::Kebab:
    case CaseType::Dot:
    case CaseType::Path:
    case CaseType::No:
        return WordTransform::Lower;
    case CaseType::Constant:
        return WordTransform::Upper;
    case CaseType::Capital:
    case CaseType::Train:
        return WordTransform::Capitalize;
    case CaseType::Sentence:
        return wordIndex == 0 ? WordTransform::Capitalize : WordTransform::Lower;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// Word boundary detection and case conversion, templated on character type.
// For Latin1Character, each element is a codepoint.
// For UChar, we use U16_NEXT to handle surrogate pairs.
template<typename CharType>
static WTF::String convertCase(CaseType type, std::span<const CharType> input)
{
    // First pass: collect word boundaries (start/end byte offsets)
    struct WordRange {
        uint32_t start;
        uint32_t end;
    };

    Vector<WordRange, 16> words;
    {
        bool inWord = false;
        uint32_t wordStart = 0;
        uint32_t wordEnd = 0;
        CharClass prevClass = CharClass::Other;
        CharClass prevPrevClass = CharClass::Other;
        uint32_t prevPos = 0;

        int32_t i = 0;
        int32_t length = static_cast<int32_t>(input.size());

        while (i < length) {
            uint32_t curPos = static_cast<uint32_t>(i);
            char32_t cp;

            if constexpr (std::is_same_v<CharType, Latin1Character>) {
                cp = input[i];
                i++;
            } else {
                U16_NEXT(input.data(), i, length, cp);
            }

            uint32_t curEnd = static_cast<uint32_t>(i);
            CharClass curClass = classifyCp(cp);

            if (curClass == CharClass::Other) {
                if (inWord) {
                    inWord = false;
                    words.append({ wordStart, wordEnd });
                    prevClass = CharClass::Other;
                    prevPrevClass = CharClass::Other;
                } else {
                    prevClass = CharClass::Other;
                    prevPrevClass = CharClass::Other;
                }
                continue;
            }

            if (!inWord) {
                inWord = true;
                wordStart = curPos;
                wordEnd = curEnd;
                prevPrevClass = CharClass::Other;
                prevClass = curClass;
                prevPos = curPos;
                continue;
            }

            // Rule 2: upper+upper+lower → boundary before the last upper
            if (prevPrevClass == CharClass::Upper && prevClass == CharClass::Upper && curClass == CharClass::Lower) {
                words.append({ wordStart, prevPos });
                wordStart = prevPos;
                wordEnd = curEnd;
                prevPrevClass = prevClass;
                prevClass = curClass;
                prevPos = curPos;
                continue;
            }

            // Rule 1: (lower | digit) → upper boundary
            if ((prevClass == CharClass::Lower || prevClass == CharClass::Digit) && curClass == CharClass::Upper) {
                words.append({ wordStart, wordEnd });
                wordStart = curPos;
                wordEnd = curEnd;
                prevPrevClass = CharClass::Other;
                prevClass = curClass;
                prevPos = curPos;
                continue;
            }

            // No boundary, extend current word
            wordEnd = curEnd;
            prevPrevClass = prevClass;
            prevClass = curClass;
            prevPos = curPos;
        }

        // Flush last word
        if (inWord)
            words.append({ wordStart, wordEnd });
    }

    if (words.isEmpty())
        return emptyString();

    // Second pass: build the output string
    StringBuilder builder;
    builder.reserveCapacity(input.size() + input.size() / 4);

    char sep = separator(type);

    for (size_t wordIndex = 0; wordIndex < words.size(); wordIndex++) {
        auto& word = words[wordIndex];

        // Separator between words
        if (wordIndex > 0 && sep)
            builder.append(sep);

        // Digit-prefix underscore for camelCase/pascalCase
        if (wordIndex > 0 && hasDigitPrefixUnderscore(type)) {
            char32_t firstCp;
            if constexpr (std::is_same_v<CharType, Latin1Character>) {
                firstCp = input[word.start];
            } else {
                int32_t tmpI = word.start;
                U16_NEXT(input.data(), tmpI, static_cast<int32_t>(input.size()), firstCp);
            }
            if (firstCp >= '0' && firstCp <= '9')
                builder.append('_');
        }

        WordTransform transform = getTransform(type, wordIndex);

        // Iterate codepoints within the word and apply transform
        int32_t pos = word.start;
        int32_t end = word.end;
        bool isFirst = true;

        while (pos < end) {
            char32_t cp;
            if constexpr (std::is_same_v<CharType, Latin1Character>) {
                cp = input[pos];
                pos++;
            } else {
                U16_NEXT(input.data(), pos, end, cp);
            }

            char32_t transformed;
            switch (transform) {
            case WordTransform::Lower:
                transformed = u_tolower(cp);
                break;
            case WordTransform::Upper:
                transformed = u_toupper(cp);
                break;
            case WordTransform::Capitalize:
                transformed = isFirst ? u_toupper(cp) : u_tolower(cp);
                break;
            }
            isFirst = false;

            builder.append(static_cast<char32_t>(transformed));
        }
    }

    return builder.toString();
}

static EncodedJSValue caseChangeImpl(CaseType type, JSGlobalObject* globalObject, CallFrame* callFrame)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue input = callFrame->argument(0);
    if (!input.isString()) {
        throwTypeError(globalObject, scope, "Expected a string argument"_s);
        return {};
    }

    JSString* jsStr = input.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = jsStr->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->isEmpty())
        return JSValue::encode(jsEmptyString(vm));

    WTF::String result = view->is8Bit()
        ? convertCase<Latin1Character>(type, view->span8())
        : convertCase<UChar>(type, view->span16());

    return JSValue::encode(jsString(vm, WTF::move(result)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunCamelCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Camel, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunPascalCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Pascal, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunSnakeCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Snake, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunKebabCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Kebab, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunConstantCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Constant, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunDotCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Dot, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunCapitalCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Capital, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunTrainCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Train, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunPathCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Path, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunSentenceCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::Sentence, globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunNoCase, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return caseChangeImpl(CaseType::No, globalObject, callFrame);
}

} // namespace Bun
