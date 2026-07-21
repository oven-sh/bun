#include "root.h"
#include "IntlSegmentsContaining.h"

#include <JavaScriptCore/IntlSegments.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSString.h>
#include <unicode/utf16.h>

namespace Bun {

using namespace JSC;

// Workaround for a JavaScriptCore bug in %Segments.prototype%.containing.
//
// IntlSegments::containing computes startIndex via ubrk_preceding(index + 1).
// When index is the lead surrogate of a surrogate pair, index + 1 is a trail
// surrogate; ICU snaps that back to the code-point start (index) and then
// returns the boundary strictly before it, skipping a boundary at index
// itself. The result is a phantom segment spanning the previous segment plus
// the one actually containing index.
//
// Since index and index + 1 are the same code point in that case, the spec
// result of containing(index) equals containing(index + 1), and the latter
// avoids the trail-surrogate offset. We forward to JSC's implementation with
// the adjusted index so the rest of the algorithm (and isWordLike) is reused.
JSC_DEFINE_HOST_FUNCTION(intlSegmentsPrototypeFuncContainingFix, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* segments = dynamicDowncast<IntlSegments>(callFrame->thisValue());
    if (!segments) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "%Segments.prototype%.containing called on value that's not a Segments"_s);

    JSValue indexValue = callFrame->argument(0);
    double value = indexValue.toIntegerOrInfinity(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = segments->containing(globalObject, jsNumber(value));
    RETURN_IF_EXCEPTION(scope, {});
    if (result.isUndefined())
        return JSValue::encode(result);

    JSObject* resultObject = asObject(result);
    JSValue input = resultObject->get(globalObject, vm.propertyNames->input);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* inputString = asString(input);
    auto view = inputString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->is8Bit())
        return JSValue::encode(result);

    int32_t index = toInt32(value);
    auto span = view->span16();
    if (static_cast<size_t>(index) + 1 < span.size() && U16_IS_LEAD(span[index]) && U16_IS_TRAIL(span[index + 1]))
        RELEASE_AND_RETURN(scope, JSValue::encode(segments->containing(globalObject, jsNumber(index + 1))));

    return JSValue::encode(result);
}

} // namespace Bun
