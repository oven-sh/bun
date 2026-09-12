#include "root.h"
#include "IntlSegmentsContaining.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSString.h>

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
// the adjusted index so its algorithm (including isWordLike) is reused.
//
// IntlSegments.h transitively includes <unicode/ubrk.h>, which is absent from
// Apple's public ICU headers, so this file calls the stored original host
// function instead of IntlSegments::containing directly.
JSC_DEFINE_HOST_FUNCTION(intlSegmentsPrototypeFuncContainingFix, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSFunction* original = zigGlobal->m_intlSegmentsContainingOriginal.get();
    ASSERT(original);
    auto callData = JSC::getCallData(original);

    JSValue thisValue = callFrame->thisValue();
    JSValue indexValue = callFrame->argument(0);

    // Brand-check before coercion so step 2 (RequireInternalSlot) precedes
    // step 6 (ToIntegerOrInfinity). IntlSegments::info() is unreachable here,
    // so read the ClassInfo off the cached structure instead.
    const ClassInfo* segmentsClassInfo = zigGlobal->segmentsStructure()->classInfoForCells();
    if (!thisValue.isCell() || !thisValue.asCell()->inherits(segmentsClassInfo)) {
        MarkedArgumentBuffer rawArgs;
        rawArgs.append(indexValue);
        ASSERT(!rawArgs.hasOverflowed());
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::call(globalObject, original, callData, thisValue, rawArgs)));
    }

    double value = indexValue.toIntegerOrInfinity(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer args;
    args.append(jsNumber(value));
    ASSERT(!args.hasOverflowed());

    JSValue result = JSC::call(globalObject, original, callData, thisValue, args);
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
    if (static_cast<size_t>(index) + 1 < span.size() && U16_IS_LEAD(span[index]) && U16_IS_TRAIL(span[index + 1])) {
        MarkedArgumentBuffer adjustedArgs;
        adjustedArgs.append(jsNumber(index + 1));
        ASSERT(!adjustedArgs.hasOverflowed());
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::call(globalObject, original, callData, thisValue, adjustedArgs)));
    }

    return JSValue::encode(result);
}

void installIntlSegmentsContainingFix(Zig::GlobalObject* globalObject, VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* segmentsPrototype = globalObject->segmentsStructure()->storedPrototypeObject();
    auto identifier = JSC::Identifier::fromString(vm, "containing"_s);
    JSValue original = segmentsPrototype->get(globalObject, identifier);
    RETURN_IF_EXCEPTION(scope, );

    auto* originalFunction = dynamicDowncast<JSFunction>(original);
    if (!originalFunction) [[unlikely]]
        return;

    globalObject->m_intlSegmentsContainingOriginal.set(vm, globalObject, originalFunction);
    segmentsPrototype->putDirectNativeFunction(vm, globalObject, identifier, 1, intlSegmentsPrototypeFuncContainingFix, ImplementationVisibility::Public, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);
}

} // namespace Bun
