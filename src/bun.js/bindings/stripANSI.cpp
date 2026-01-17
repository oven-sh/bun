#include "root.h"
#include "stripANSI.h"
#include "ANSIHelpers.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {
using namespace WTF;

template<typename Char>
static std::optional<WTF::String> stripANSI(const std::span<const Char> input)
{
    if (input.empty()) {
        // Signal that the original string should be used
        return std::nullopt;
    }

    StringBuilder result;
    bool foundANSI = false;

    auto start = input.data();
    const auto end = start + input.size();

    while (start != end) {
        const auto escPos = ANSI::findEscapeCharacter(start, end);
        if (!escPos) {
            // If no escape sequences found, return null to signal that the
            // original string should be used.
            if (!foundANSI)
                return std::nullopt;
            // Append the rest of the string
            result.append(std::span { start, end });
            break;
        }

        // Lazily reserve capacity on first ESC found
        if (!foundANSI) {
            result.reserveCapacity(input.size());
        }

        // Append everything before the escape sequence
        result.append(std::span { start, escPos });
        const auto newPos = ANSI::consumeANSI(escPos, end);
        ASSERT(newPos > start);
        ASSERT(newPos <= end);
        foundANSI = true;
        start = newPos;
    }
    return result.toString();
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
