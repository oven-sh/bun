#include "JSReactElement.h"

#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/Symbol.h"

using namespace JSC;

namespace Bun {
namespace JSReactElement {

// Shared by the production and development structures.
static constexpr PropertyOffset typeofOffset = 0;
static constexpr PropertyOffset typeOffset = 1;
static constexpr PropertyOffset keyOffset = 2;
static constexpr PropertyOffset refOffset = 3;
static constexpr PropertyOffset propsOffset = 4;

// Development structure only. These are the fields React's development
// build adds in `ReactElement()` (react.development.js). React's development
// renderers read and write them without guards, for example
// `element._store.validated = 1` in react-server-dom-webpack.
static constexpr PropertyOffset ownerOffset = 5;
static constexpr PropertyOffset storeOffset = 6;
static constexpr PropertyOffset debugInfoOffset = 7;
static constexpr PropertyOffset debugStackOffset = 8;
static constexpr PropertyOffset debugTaskOffset = 9;

// `_store` structure.
static constexpr PropertyOffset storeValidatedOffset = 0;

static constexpr unsigned devFieldAttributes = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete;

static Structure* addProperty(VM& vm, Structure* structure, ASCIILiteral name, unsigned attributes, PropertyOffset expectedOffset)
{
    JSC::PropertyOffset offset;
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, name),
        attributes,
        offset);
    ASSERT_UNUSED(expectedOffset, offset == expectedOffset);
    return structure;
}

Structure* createStructure(VM& vm, JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        5);

    structure = addProperty(vm, structure, "$$typeof"_s, 0, typeofOffset);
    structure = addProperty(vm, structure, "type"_s, 0, typeOffset);
    structure = addProperty(vm, structure, "key"_s, 0, keyOffset);
    structure = addProperty(vm, structure, "ref"_s, 0, refOffset);
    structure = addProperty(vm, structure, "props"_s, 0, propsOffset);

    return structure;
}

Structure* createDevStructure(VM& vm, JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        10);

    structure = addProperty(vm, structure, "$$typeof"_s, 0, typeofOffset);
    structure = addProperty(vm, structure, "type"_s, 0, typeOffset);
    structure = addProperty(vm, structure, "key"_s, 0, keyOffset);
    // React's development build defines `ref` as non-enumerable.
    structure = addProperty(vm, structure, "ref"_s, PropertyAttribute::DontEnum | 0, refOffset);
    structure = addProperty(vm, structure, "props"_s, 0, propsOffset);
    structure = addProperty(vm, structure, "_owner"_s, 0, ownerOffset);
    structure = addProperty(vm, structure, "_store"_s, 0, storeOffset);
    structure = addProperty(vm, structure, "_debugInfo"_s, devFieldAttributes, debugInfoOffset);
    structure = addProperty(vm, structure, "_debugStack"_s, devFieldAttributes, debugStackOffset);
    structure = addProperty(vm, structure, "_debugTask"_s, devFieldAttributes, debugTaskOffset);

    return structure;
}

Structure* createStoreStructure(VM& vm, JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        1);

    structure = addProperty(vm, structure, "validated"_s, devFieldAttributes, storeValidatedOffset);

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

static JSObject* createElement(Zig::GlobalObject* global, uint8_t reactVersion, bool development, JSValue type, JSValue props)
{
    VM& vm = global->vm();

    if (!development) {
        JSObject* element = constructEmptyObject(vm, global->JSReactElementStructure());
        element->putDirectOffset(vm, Bun::JSReactElement::typeofOffset, createTypeofSymbol(vm, reactVersion));
        element->putDirectOffset(vm, Bun::JSReactElement::typeOffset, type);
        element->putDirectOffset(vm, Bun::JSReactElement::keyOffset, jsNull());
        element->putDirectOffset(vm, Bun::JSReactElement::refOffset, jsNull());
        element->putDirectOffset(vm, Bun::JSReactElement::propsOffset, props);
        return element;
    }

    // `validated` is 1, the value React's JSX runtime gives static children.
    // The markdown tree is static, so React must not ask for keys on it.
    JSObject* store = constructEmptyObject(vm, global->JSReactElementStoreStructure());
    store->putDirectOffset(vm, Bun::JSReactElement::storeValidatedOffset, jsNumber(1));

    JSObject* element = constructEmptyObject(vm, global->JSReactElementDevStructure());
    element->putDirectOffset(vm, Bun::JSReactElement::typeofOffset, createTypeofSymbol(vm, reactVersion));
    element->putDirectOffset(vm, Bun::JSReactElement::typeOffset, type);
    element->putDirectOffset(vm, Bun::JSReactElement::keyOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::refOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::propsOffset, props);
    element->putDirectOffset(vm, Bun::JSReactElement::ownerOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::storeOffset, store);
    element->putDirectOffset(vm, Bun::JSReactElement::debugInfoOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::debugStackOffset, jsNull());
    element->putDirectOffset(vm, Bun::JSReactElement::debugTaskOffset, jsNull());
    return element;
}

extern "C" JSC::EncodedJSValue JSReactElement__create(
    JSGlobalObject* globalObject,
    uint8_t reactVersion,
    bool development,
    EncodedJSValue type,
    EncodedJSValue props)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    return JSValue::encode(createElement(global, reactVersion, development, JSValue::decode(type), JSValue::decode(props)));
}

extern "C" JSC::EncodedJSValue JSReactElement__createFragment(
    JSGlobalObject* globalObject,
    uint8_t reactVersion,
    bool development,
    EncodedJSValue children)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    VM& vm = global->vm();

    JSC::Symbol* fragmentSymbol = JSC::Symbol::create(vm,
        vm.symbolRegistry().symbolForKey("react.fragment"_s));

    JSObject* props = constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    props->putDirect(vm, JSC::Identifier::fromString(vm, "children"_s), JSValue::decode(children));

    return JSValue::encode(createElement(global, reactVersion, development, fragmentSymbol, props));
}
