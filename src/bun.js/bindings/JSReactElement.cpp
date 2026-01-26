#include "JSReactElement.h"

#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/Symbol.h"

using namespace JSC;

namespace Bun {
namespace JSReactElement {

static constexpr PropertyOffset typeofOffset = 0;
static constexpr PropertyOffset typeOffset = 1;
static constexpr PropertyOffset keyOffset = 2;
static constexpr PropertyOffset refOffset = 3;
static constexpr PropertyOffset propsOffset = 4;

Structure* createStructure(VM& vm, JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        5);

    JSC::PropertyOffset offset;
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "$$typeof"_s),
        0,
        offset);
    ASSERT(offset == typeofOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "type"_s),
        0,
        offset);
    ASSERT(offset == typeOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "key"_s),
        0,
        offset);
    ASSERT(offset == keyOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "ref"_s),
        0,
        offset);
    ASSERT(offset == refOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "props"_s),
        0,
        offset);
    ASSERT(offset == propsOffset);

    return structure;
}

} // namespace JSReactElement
} // namespace Bun

extern "C" JSC::EncodedJSValue JSReactElement__create(
    JSGlobalObject* globalObject,
    uint8_t reactVersion,
    EncodedJSValue type,
    EncodedJSValue props)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    // Pick the $$typeof symbol based on React version
    JSC::Symbol* typeofSymbol;
    if (reactVersion == 0) {
        // React 18: Symbol.for('react.element')
        typeofSymbol = JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.element"_s));
    } else {
        // React 19: Symbol.for('react.transitional.element')
        typeofSymbol = JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.transitional.element"_s));
    }

    JSObject* element = constructEmptyObject(vm, global->JSReactElementStructure());
    element->putDirectOffset(vm, Bun::JSReactElement::typeofOffset, typeofSymbol);
    element->putDirectOffset(vm, Bun::JSReactElement::typeOffset, JSValue::decode(type));
    element->putDirectOffset(vm, Bun::JSReactElement::keyOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::refOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::propsOffset, JSValue::decode(props));

    return JSValue::encode(element);
}
