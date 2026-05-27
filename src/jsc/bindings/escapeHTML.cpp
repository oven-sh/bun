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
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>
#include <unicode/utf16.h>

// SIMD scan kernels implemented in highway_strings.cpp.
extern "C" size_t highway_index_of_html_escape_char8(const uint8_t* text, size_t text_len);
extern "C" size_t highway_index_of_html_escape_or_non_ascii16(const uint16_t* text, size_t text_len);

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

static JSC::JSString* escapeHTMLLatin1(JSC::VM& vm, JSC::JSString* input, std::span<const Latin1Character> span)
{
    const size_t length = span.size();
    const size_t firstEscape = highway_index_of_html_escape_char8(reinterpret_cast<const uint8_t*>(span.data()), length);
    // Nothing to escape — hand back the original string without allocating.
    if (firstEscape == length)
        return input;

    StringBuilder builder;
    // Every escape expands to at least 4 characters; a little headroom avoids
    // reallocating for the common case of a handful of metacharacters.
    builder.reserveCapacity(length + 16);

    // The prefix up to the first metacharacter is plain and copied in one shot.
    builder.append(span.subspan(0, firstEscape));

    size_t i = firstEscape;
    while (i < length) {
        builder.append(htmlEntity(span[i]));
        ++i;

        // Fast-forward over the next run of characters that don't need escaping.
        const size_t remaining = length - i;
        const size_t next = highway_index_of_html_escape_char8(reinterpret_cast<const uint8_t*>(span.data() + i), remaining);
        if (next > 0) {
            builder.append(span.subspan(i, next));
            i += next;
        }
    }

    return JSC::jsString(vm, builder.toString());
}

static JSC::JSString* escapeHTMLUTF16(JSC::VM& vm, JSC::JSString* input, std::span<const char16_t> span)
{
    const size_t length = span.size();
    const size_t firstInteresting = highway_index_of_html_escape_or_non_ascii16(reinterpret_cast<const uint16_t*>(span.data()), length);
    // Nothing to escape — hand back the original string without allocating.
    if (firstInteresting == length)
        return input;

    StringBuilder builder;
    builder.reserveCapacity(length + 16);

    builder.append(span.subspan(0, firstInteresting));

    size_t i = firstInteresting;
    while (i < length) {
        const char16_t c = span[i];
        const ASCIILiteral entity = htmlEntity(c);
        if (!entity.isNull()) {
            builder.append(entity);
            ++i;
        } else if (c > 0x7F) {
            // Copy the whole codepoint through unchanged. A well-formed
            // surrogate pair is two code units; everything else (including a
            // lone surrogate) is a single code unit preserved verbatim.
            size_t codepointLength = 1;
            if (U16_IS_LEAD(c) && i + 1 < length && U16_IS_TRAIL(span[i + 1]))
                codepointLength = 2;
            builder.append(span.subspan(i, codepointLength));
            i += codepointLength;
        } else {
            // Plain ASCII: append this code unit, then fast-forward over the
            // next run that needs no special handling.
            builder.append(static_cast<char16_t>(c));
            ++i;
            const size_t remaining = length - i;
            const size_t next = highway_index_of_html_escape_or_non_ascii16(reinterpret_cast<const uint16_t*>(span.data() + i), remaining);
            if (next > 0) {
                builder.append(span.subspan(i, next));
                i += next;
            }
        }
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

    if (view->is8Bit())
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(escapeHTMLLatin1(vm, string, view->span8())));
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(escapeHTMLUTF16(vm, string, view->span16())));
}

} // namespace Bun
