// The received side of a failed `toMatchObject` diff: the received object trimmed to the
// properties the pattern mentions, recursively (jest's `getObjectSubset`). Diffing the whole
// received value prints every property the pattern does not mention as a `+` line and
// buries the mismatch; a value with its own print form (a React element, say) turns into
// a wholesale replacement that shows neither the differing property nor its value.

#include "root.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <wtf/HashMap.h>

namespace ExpectObjectSubset {

enum class Shape {
    Leaf,
    Object,
    Array,
};

// Only ordinary objects and same-length arrays are trimmed: the formatter prints those
// property by property, so a copy holding fewer properties prints as the original minus the
// dropped lines. Anything else (Date, Map, Error, native classes, asymmetric matchers, arrays
// whose lengths already differ, ...) has its own print form and is shown whole, as before.
static Shape shapeOf(JSC::JSValue received, JSC::JSValue pattern)
{
    if (!received.isCell() || !pattern.isCell())
        return Shape::Leaf;

    auto* receivedArray = dynamicDowncast<JSC::JSArray>(received);
    auto* patternArray = dynamicDowncast<JSC::JSArray>(pattern);
    if (receivedArray || patternArray)
        return receivedArray && patternArray && receivedArray->length() == patternArray->length() ? Shape::Array : Shape::Leaf;

    if (received.asCell()->type() == JSC::FinalObjectType && pattern.asCell()->type() == JSC::FinalObjectType)
        return Shape::Object;
    return Shape::Leaf;
}

class Builder {
public:
    Builder(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
        : m_globalObject(globalObject)
        , m_scope(scope)
    {
    }

    JSC::JSValue trim(Shape shape, JSC::JSValue received, JSC::JSValue pattern)
    {
        auto& vm = JSC::getVM(m_globalObject);
        // Trimming is only presentation: past this depth the rest of the branch is shown
        // whole rather than failing the matcher with a stack overflow.
        if (!vm.isSafeToRecurse()) [[unlikely]]
            return received;

        JSC::JSObject* receivedObject = JSC::asObject(received);
        JSC::JSObject* patternObject = JSC::asObject(pattern);

        JSC::JSObject* subset;
        if (shape == Shape::Array) {
            subset = JSC::constructEmptyArray(m_globalObject, nullptr, uncheckedDowncast<JSC::JSArray>(receivedObject)->length());
            RETURN_IF_EXCEPTION(m_scope, {});
        } else {
            // Same prototype as the received object, so the diff keeps printing its class name.
            JSC::JSValue prototype = receivedObject->getPrototypeDirect();
            subset = prototype.isObject()
                ? JSC::constructEmptyObject(m_globalObject, JSC::asObject(prototype))
                : JSC::constructEmptyObject(vm, m_globalObject->nullPrototypeObjectStructure());
        }

        // `m_visited` holds bare pointers: the buffer keeps the three objects alive (and
        // their addresses unique) for the rest of the walk.
        m_gcBuffer.append(received);
        m_gcBuffer.append(pattern);
        m_gcBuffer.append(subset);
        m_visited.add({ received.asCell(), pattern.asCell() }, subset);

        // The same enumeration `Bun__deepMatch` compares with, so the subset holds exactly the
        // values the match looked at, including ones the received object inherits.
        JSC::PropertyNameArrayBuilder patternProperties(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Include);
        patternObject->getPropertyNames(m_globalObject, patternProperties, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(m_scope, {});

        bool copiedAny = false;
        for (const auto& property : patternProperties) {
            JSC::JSValue receivedValue = receivedObject->getIfPropertyExists(m_globalObject, property);
            RETURN_IF_EXCEPTION(m_scope, {});
            // Left out, so the diff shows the pattern's line as missing.
            if (receivedValue.isEmpty())
                continue;
            JSC::JSValue patternValue = patternObject->get(m_globalObject, property);
            RETURN_IF_EXCEPTION(m_scope, {});
            JSC::JSValue value = subsetOf(receivedValue, patternValue);
            RETURN_IF_EXCEPTION(m_scope, {});
            subset->putDirectMayBeIndex(m_globalObject, property, value);
            RETURN_IF_EXCEPTION(m_scope, {});
            copiedAny = true;
        }

        // With no property in common, an empty subset would hide what was actually received.
        return copiedAny ? JSC::JSValue(subset) : received;
    }

private:
    JSC::JSValue subsetOf(JSC::JSValue received, JSC::JSValue pattern)
    {
        Shape shape = shapeOf(received, pattern);
        if (shape == Shape::Leaf)
            return received;

        // A pair comes up again when the pattern shares an object or cycles through one.
        // Reusing its subset (possibly still being filled) gives the copy the same shape, so a
        // cycle prints as `[Circular]` on both sides. Keyed on the pair because the same
        // received object may be trimmed against different branches of the pattern.
        if (JSC::JSObject* subset = m_visited.get({ received.asCell(), pattern.asCell() }))
            return subset;

        return trim(shape, received, pattern);
    }

    JSC::JSGlobalObject* m_globalObject;
    JSC::ThrowScope& m_scope;
    JSC::MarkedArgumentBuffer m_gcBuffer;
    WTF::HashMap<std::pair<JSC::JSCell*, JSC::JSCell*>, JSC::JSObject*> m_visited;
};

} // namespace ExpectObjectSubset

// `received` and `pattern` are the two (object) arguments of a `toMatchObject` call that did
// not match. Returns `received` itself when there is nothing to trim.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Expect__toMatchObjectSubset(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue receivedEncoded, JSC::EncodedJSValue patternEncoded)
{
    using namespace ExpectObjectSubset;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue received = JSC::JSValue::decode(receivedEncoded);
    JSC::JSValue pattern = JSC::JSValue::decode(patternEncoded);
    Shape shape = shapeOf(received, pattern);
    if (shape == Shape::Leaf)
        return receivedEncoded;

    Builder builder(globalObject, scope);
    JSC::JSValue subset = builder.trim(shape, received, pattern);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(subset);
}
