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

static JSC::Symbol* createTypeofSymbol(VM& vm, uint8_t reactVersion)
{
    if (reactVersion == 0)
        return JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.element"_s));
    return JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.transitional.element"_s));
}

extern "C" JSC::EncodedJSValue JSReactElement__create(
    JSGlobalObject* globalObject,
    uint8_t reactVersion,
    EncodedJSValue type,
    EncodedJSValue props)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    JSObject* element = constructEmptyObject(vm, global->JSReactElementStructure());
    element->putDirectOffset(vm, Bun::JSReactElement::typeofOffset, createTypeofSymbol(vm, reactVersion));
    element->putDirectOffset(vm, Bun::JSReactElement::typeOffset, JSValue::decode(type));
    element->putDirectOffset(vm, Bun::JSReactElement::keyOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::refOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::propsOffset, JSValue::decode(props));

    return JSValue::encode(element);
}

extern "C" JSC::EncodedJSValue JSReactElement__createFragment(
    JSGlobalObject* globalObject,
    uint8_t reactVersion,
    EncodedJSValue children)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    JSC::Symbol* fragmentSymbol = JSC::Symbol::create(vm,
        vm.symbolRegistry().symbolForKey("react.fragment"_s));

    JSObject* props = constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    props->putDirect(vm, JSC::Identifier::fromString(vm, "children"_s), JSValue::decode(children));

    JSObject* element = constructEmptyObject(vm, global->JSReactElementStructure());
    element->putDirectOffset(vm, Bun::JSReactElement::typeofOffset, createTypeofSymbol(vm, reactVersion));
    element->putDirectOffset(vm, Bun::JSReactElement::typeOffset, fragmentSymbol);
    element->putDirectOffset(vm, Bun::JSReactElement::keyOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::refOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::propsOffset, props);

    return JSValue::encode(element);
}
