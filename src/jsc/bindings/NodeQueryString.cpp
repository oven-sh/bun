#include "root.h"
#include "NodeQueryString.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSONCacheInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <wtf/ASCIICType.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringCommon.h>
#include <cmath>
#include <unicode/utf16.h>
#include <unicode/utf8.h>

namespace Bun {

using namespace JSC;

// querystring.parse for the default separators and decoder; undefined when a malformed escape needs the JS fallback.

// ECMA-262 Decode of one code point's `%XX..` run: its length, or 0 where decodeURIComponent throws.
template<typename CharType>
static ALWAYS_INLINE size_t decodeEscape(std::span<const CharType> part, size_t k, char32_t& character)
{
    const size_t size = part.size();
    if (k + 3 > size || !isASCIIHexDigit(part[k + 1]) || !isASCIIHexDigit(part[k + 2]))
        return 0;
    uint8_t sequence[U8_MAX_LENGTH];
    sequence[0] = toASCIIHexValue(part[k + 1], part[k + 2]);
    const int sequenceLength = 1 + U8_COUNT_TRAIL_BYTES(sequence[0]);
    if (k + sequenceLength * 3 > size)
        return 0;
    for (int i = 1; i < sequenceLength; ++i) {
        const CharType* q = part.data() + k + i * 3;
        if (q[0] != '%' || !isASCIIHexDigit(q[1]) || !isASCIIHexDigit(q[2]))
            return 0;
        sequence[i] = toASCIIHexValue(q[1], q[2]);
    }
    int32_t offset = 0;
    U8_NEXT(sequence, offset, sequenceLength, character);
    if (character == static_cast<char32_t>(U_SENTINEL))
        return 0;
    return sequenceLength * 3;
}

template<typename CharType>
static bool escapesAreWellFormed(std::span<const CharType> characters)
{
    size_t k = WTF::find(characters, static_cast<CharType>('%'));
    while (k != WTF::notFound) {
        char32_t character;
        size_t length = decodeEscape(characters, k, character);
        if (!length)
            return false;
        k = WTF::find(characters, static_cast<CharType>('%'), k + length);
    }
    return true;
}

// decodeURIComponent into `builder`; parse() turns '+' into ' ' first, unescape() does not.
template<bool plusIsSpace, typename CharType>
static bool appendDecoded(std::span<const CharType> part, StringBuilder& builder)
{
    const size_t size = part.size();
    size_t k = 0;
    while (k < size) {
        CharType c = part[k];
        if (c == '%') {
            char32_t character;
            size_t length = decodeEscape(part, k, character);
            if (!length)
                return false;
            if (U_IS_BMP(character)) {
                builder.append(static_cast<char16_t>(character));
            } else {
                builder.append(U16_LEAD(character));
                builder.append(U16_TRAIL(character));
            }
            k += length;
            continue;
        }
        if (plusIsSpace && c == '+')
            c = ' ';
        builder.append(c);
        ++k;
    }
    return true;
}

template<typename CharType>
static ALWAYS_INLINE bool needsDecode(std::span<const CharType> part)
{
    return WTF::find(part, static_cast<CharType>('%')) != WTF::notFound || WTF::find(part, static_cast<CharType>('+')) != WTF::notFound;
}

template<typename CharType>
class QueryStringParser {
public:
    QueryStringParser(JSGlobalObject* globalObject, JSString* input, std::span<const CharType> characters)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_input(input)
        , m_characters(characters)
    {
    }

    // `pairs` is the JS maxKeys counter: one '&' each, unlimited unless it reaches 0.
    JSValue parse(double pairs)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        const size_t size = m_characters.size();
        if (!escapesAreWellFormed(m_characters.first(consumedLength(pairs))))
            return jsUndefined();
        JSObject* object = constructEmptyObject(m_vm, m_globalObject->nullPrototypeObjectStructure());
        size_t position = 0;
        while (true) {
            size_t end = WTF::find(m_characters, static_cast<CharType>('&'), position);
            const bool isLast = end == WTF::notFound;
            if (isLast)
                end = size;
            if (end > position) {
                size_t equals = WTF::find(m_characters.first(end), static_cast<CharType>('='), position);
                size_t keyEnd = equals == WTF::notFound ? end : equals;
                size_t valueStart = equals == WTF::notFound ? end : equals + 1;
                bool ok = addPair(object, m_characters.subspan(position, keyEnd - position), valueStart, end - valueStart);
                RETURN_IF_EXCEPTION(scope, {});
                if (!ok)
                    return jsUndefined();
            }
            if (isLast)
                break;
            if (--pairs == 0)
                break;
            position = end + 1;
        }
        return object;
    }

private:
    // The length parse() reads before maxKeys stops it: up to the `pairs`th '&'.
    size_t consumedLength(double pairs) const
    {
        const size_t size = m_characters.size();
        if (!(pairs >= 1 && pairs <= size) || pairs != std::floor(pairs))
            return size;
        size_t position = 0;
        for (double remaining = pairs; remaining > 0; --remaining) {
            size_t end = WTF::find(m_characters, static_cast<CharType>('&'), position);
            if (end == WTF::notFound)
                return size;
            position = end + 1;
        }
        return position;
    }

    bool addPair(JSObject* object, std::span<const CharType> key, size_t valueStart, size_t valueLength)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        JSValue value;
        std::span<const CharType> valueSpan = m_characters.subspan(valueStart, valueLength);
        if (needsDecode(valueSpan)) {
            StringBuilder decodedValue;
            decodedValue.reserveCapacity(valueLength);
            if (!appendDecoded<true>(valueSpan, decodedValue))
                return false;
            value = jsString(m_vm, decodedValue.toString());
        } else {
            value = jsSubstringOfResolved(m_vm, m_input, valueStart, valueLength);
        }

        if (needsDecode(key)) {
            StringBuilder decodedKey;
            decodedKey.reserveCapacity(key.size());
            if (!appendDecoded<true>(key, decodedKey))
                return false;
            const String& keyString = decodedKey.toString();
            if (keyString.is8Bit())
                put(object, keyString.span8(), value);
            else
                put(object, keyString.span16(), value);
        } else {
            put(object, key, value);
        }
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }

    // addKeyVal in querystring.ts: a repeated key collects its values in an array.
    template<typename KeyCharType>
    void put(JSObject* object, std::span<const KeyCharType> key, JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        if (auto index = parseIndex(key)) {
            JSValue existing = object->getDirectIndex(m_globalObject, *index);
            RETURN_IF_EXCEPTION(scope, );
            if (!existing) {
                object->putDirectIndex(m_globalObject, *index, value);
                RETURN_IF_EXCEPTION(scope, );
                return;
            }
            JSValue combined = combine(existing, value);
            RETURN_IF_EXCEPTION(scope, );
            if (combined) {
                object->putDirectIndex(m_globalObject, *index, combined);
                RETURN_IF_EXCEPTION(scope, );
            }
            return;
        }

        Identifier identifier = Identifier::fromString(m_vm, m_vm.jsonCache().makeIdentifier(m_vm, key));
        JSValue existing = object->getDirect(m_vm, identifier);
        if (!existing) {
            object->putDirect(m_vm, identifier, value);
            return;
        }
        JSValue combined = combine(existing, value);
        RETURN_IF_EXCEPTION(scope, );
        if (combined)
            object->putDirect(m_vm, identifier, combined);
    }

    JSValue combine(JSValue existing, JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (existing.isString()) {
            JSValue values[2] = { existing, value };
            JSArray* array = constructArray(m_globalObject, m_globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), values, 2);
            RETURN_IF_EXCEPTION(scope, {});
            return array;
        }
        asArray(existing)->push(m_globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        return {};
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    JSString* m_input;
    std::span<const CharType> m_characters;
};

template<typename CharType>
static JSValue decodeComponent(VM& vm, JSString* input, std::span<const CharType> characters)
{
    if (WTF::find(characters, static_cast<CharType>('%')) == WTF::notFound)
        return input;
    StringBuilder builder;
    builder.reserveCapacity(characters.size());
    if (!appendDecoded<false>(characters, builder))
        return jsUndefined();
    return jsString(vm, builder.toString());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDecodeQueryStringComponent, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSString* input = callFrame->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto view = input->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->is8Bit())
        return JSValue::encode(decodeComponent(vm, input, view->span8()));
    return JSValue::encode(decodeComponent(vm, input, view->span16()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionParseQueryString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue argument = callFrame->argument(0);
    if (!argument.isString())
        return JSValue::encode(jsUndefined());
    JSString* input = asString(argument);

    double pairs = callFrame->argument(1).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = input->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result;
    if (view->is8Bit())
        result = QueryStringParser<Latin1Character>(globalObject, input, view->span8()).parse(pairs);
    else
        result = QueryStringParser<char16_t>(globalObject, input, view->span16()).parse(pairs);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

} // namespace Bun
