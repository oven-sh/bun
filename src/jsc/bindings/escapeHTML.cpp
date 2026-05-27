// Implementation of `Bun.escapeHTML` — replace the five HTML metacharacters
// (& < > " ') with their entities so a string can be embedded in HTML text or
// attribute values without injecting markup.
//
//   &  ->  &amp;
//   <  ->  &lt;
//   >  ->  &gt;
//   "  ->  &quot;
//   '  ->  &#x27;   (numeric; &apos; is not defined in HTML4)
//
// The common case — a string with nothing to escape — is detected with the
// SIMD scan kernels from highway_strings.cpp and returns the input JSString
// unchanged (no allocation). When something does need escaping, the result is
// built with WTF::StringBuilder, preserving the input's 8-bit/16-bit backing.
//
// UTF-16 input is copied through code unit by code unit except for the five
// metacharacters; surrogate pairs and lone surrogates are preserved verbatim
// so the output round-trips the same text (only markup characters change).

#include "root.h"
#include "escapeHTML.h"

#include <span>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>

// SIMD scan kernels implemented in highway_strings.cpp.
extern "C" size_t highway_index_of_html_escape_char8(const uint8_t* text, size_t text_len);
extern "C" size_t highway_index_of_html_escape_char16(const uint16_t* text, size_t text_len);

namespace Bun {

// Entity for a metacharacter, or an empty literal for anything else. Only the
// five characters below are ever escaped.
template<typename CharacterType>
static ALWAYS_INLINE ASCIILiteral htmlEntity(CharacterType c)
{
    switch (c) {
    case '"':
        return "&quot;"_s;
    case '&':
        return "&amp;"_s;
    case '\'':
        return "&#x27;"_s;
    case '<':
        return "&lt;"_s;
    case '>':
        return "&gt;"_s;
    default:
        return {};
    }
}

static ALWAYS_INLINE bool isHTMLEscapeChar(char16_t c)
{
    return c == '"' || c == '&' || c == '\'' || c == '<' || c == '>';
}

// Index of the first metacharacter in `span`, or span.size() if none. Picks the
// 8-bit or 16-bit Highway kernel based on the element type.
template<typename CharacterType>
static ALWAYS_INLINE size_t indexOfHTMLEscape(std::span<const CharacterType> span)
{
    if constexpr (sizeof(CharacterType) == 1)
        return highway_index_of_html_escape_char8(reinterpret_cast<const uint8_t*>(span.data()), span.size());
    else
        return highway_index_of_html_escape_char16(reinterpret_cast<const uint16_t*>(span.data()), span.size());
}

// Shared escape routine for both 8-bit (Latin-1) and 16-bit (UTF-16) input.
// For UTF-16 the five metacharacters are all < 0x80, so surrogate code units
// never match and are copied through verbatim — surrogate pairs and lone
// surrogates round-trip unchanged. Throws and returns nullptr if the escaped
// output would exceed String::MaxLength (output can be up to 6× the input).
template<typename CharacterType>
static JSC::JSString* escapeHTMLString(JSC::JSGlobalObject* globalObject, JSC::JSString* input, std::span<const CharacterType> span)
{
    auto& vm = JSC::getVM(globalObject);
    const size_t length = span.size();
    const size_t firstEscape = indexOfHTMLEscape(span);
    // Nothing to escape — hand back the original string without allocating.
    if (firstEscape == length)
        return input;

    StringBuilder builder;
    // Every escape expands to at least 4 characters; a little headroom avoids
    // reallocating for the common case of a handful of metacharacters.
    builder.reserveCapacity(length + 16);

    // The prefix up to the first metacharacter is copied in one shot.
    builder.append(span.subspan(0, firstEscape));

    size_t i = firstEscape;
    while (i < length) {
        // Emit the run of consecutive metacharacters with a tight scalar loop —
        // SIMD scanning each one individually would cost a call per character
        // on escape-dense input.
        do {
            builder.append(htmlEntity(span[i]));
            ++i;
        } while (i < length && isHTMLEscapeChar(span[i]));

        if (i >= length)
            break;

        // Skip to the next metacharacter with SIMD and copy the clean run.
        const size_t next = indexOfHTMLEscape(span.subspan(i));
        builder.append(span.subspan(i, next));
        i += next;
    }

    if (builder.hasOverflowed()) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }

    return JSC::jsString(vm, builder.toString());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunEscapeHTML, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue argument = callFrame->argument(0);
    if (argument.isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    if (argument.isNumber() || argument.isBoolean() || argument.isUndefined() || argument.isNull())
        return JSC::JSValue::encode(argument.toString(globalObject));

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSString* string = argument.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (string->length() == 0)
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(string));

    const auto view = string->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSString* result = view->is8Bit()
        ? escapeHTMLString<Latin1Character>(globalObject, string, view->span8())
        : escapeHTMLString<char16_t>(globalObject, string, view->span16());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

} // namespace Bun
