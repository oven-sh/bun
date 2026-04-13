#include "root.h"
#include "stripANSI.h"
#include "ANSIHelpers.h"

#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace Bun {
using namespace WTF;

template<typename Char>
static std::optional<WTF::String> stripANSI(const std::span<const Char> input)
{
    if (input.empty()) {
        // Signal that the original string should be used
        return std::nullopt;
    }

    auto start = input.data();
    const auto end = start + input.size();

    // Lazy flat-buffer allocation: don't touch the buffer until we find an
    // escape. For no-escape input we return std::nullopt and the caller
    // reuses the original JSString with zero copies.
    Vector<Char> buffer;
    Char* cursor = nullptr;
    bool foundANSI = false;

    while (start != end) {
        const auto* escPos = ANSI::findEscapeCharacter(start, end);
        if (!escPos) {
            // No more escapes.
            if (!foundANSI)
                return std::nullopt;
            // Copy the rest of the string.
            const auto remaining = static_cast<size_t>(end - start);
            memcpy(cursor, start, remaining * sizeof(Char));
            cursor += remaining;
            break;
        }

        // Lazily allocate the worst-case buffer on first ESC candidate. Guard
        // on `cursor == nullptr` (not `!foundANSI`) so a broad-mask false
        // positive that allocates the buffer doesn't reset the cursor on the
        // next iteration when a real escape is finally found.
        // POD types skip per-element initialization in Vector::grow.
        if (cursor == nullptr) {
            buffer.grow(input.size());
            cursor = buffer.begin();
        }

        // Copy everything before the escape sequence.
        if (escPos > start) {
            const auto chunkLen = static_cast<size_t>(escPos - start);
            memcpy(cursor, start, chunkLen * sizeof(Char));
            cursor += chunkLen;
        }

        const auto* newPos = ANSI::consumeANSI(escPos, end);
        if (newPos == escPos) {
            // Broad-mask false positive — copy the byte literally.
            *cursor++ = *escPos;
            start = escPos + 1;
            continue;
        }

        ASSERT(newPos > start);
        ASSERT(newPos <= end);
        foundANSI = true;
        start = newPos;
    }

    const size_t reserved = buffer.size();
    const size_t outputLen = static_cast<size_t>(cursor - buffer.begin());
    const size_t waste = reserved - outputLen;
    buffer.shrink(outputLen);

    // Free the slack only if we wasted significantly: capacity > 2 * length OR
    // waste > 1 KB. shrinkToFit() reallocates, so for small over-allocations
    // the realloc cost outweighs the memory saved.
    if (reserved > 2 * outputLen || waste * sizeof(Char) > 1024) {
        buffer.shrinkToFit();
    }

    return String::adopt(std::move(buffer));
}

struct BunANSIIterator {
    const unsigned char* input;
    size_t input_len;
    size_t cursor;
    const unsigned char* slice_ptr;
    size_t slice_len;
};

extern "C" bool Bun__ANSI__next(BunANSIIterator* it)
{
    auto start = it->input + it->cursor;
    const auto end = it->input + it->input_len;

    // Skip past any ANSI sequences at current position
    while (start < end) {
        const auto escPos = ANSI::findEscapeCharacter(start, end);
        if (escPos != start) break;
        const auto after = ANSI::consumeANSI(start, end);
        if (after == start) {
            start++;
            break;
        }
        start = after;
    }

    if (start >= end) {
        it->cursor = it->input_len;
        it->slice_ptr = nullptr;
        it->slice_len = 0;
        return false;
    }

    const auto escPos = ANSI::findEscapeCharacter(start, end);
    const auto slice_end = escPos ? escPos : end;

    it->slice_ptr = start;
    it->slice_len = slice_end - start;
    it->cursor = slice_end - it->input;
    return true;
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionBunStripANSI, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    const JSC::JSValue input = callFrame->argument(0);

    // Convert to JSString to get the view
    JSC::JSString* const jsString = input.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Get StringView to avoid joining sliced strings
    const auto view = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->isEmpty()) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    std::optional<WTF::String> result;
    if (view->is8Bit()) {
        result = stripANSI<Latin1Character>(view->span8());
    } else {
        result = stripANSI<UChar>(view->span16());
    }

    if (!result) {
        // If no ANSI sequences were found, return the original string
        return JSC::JSValue::encode(jsString);
    }
    return JSC::JSValue::encode(JSC::jsString(vm, *result));
}
}
