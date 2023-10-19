#include "root.h"
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "headers-handwritten.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {
using namespace JSC;
extern "C" EncodedJSValue JSC__createStructure(JSC::JSGlobalObject* globalObject, JSC::JSCell* owner, unsigned int inlineCapacity, BunString* names)
{
    auto& vm = globalObject->vm();
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), inlineCapacity);
    if (owner) {
        vm.writeBarrier(owner, structure);
    } else {
        vm.writeBarrier(structure);
    }
    ensureStillAliveHere(structure);

    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    for (unsigned i = 0; i < inlineCapacity; i++) {
        propertyNames.add(Identifier::fromString(vm, Bun::toWTFString(names[i])));
    }

    PropertyOffset offset = 0;
    for (unsigned i = 0; i < inlineCapacity; i++) {
        structure = structure->addPropertyTransition(vm, structure, propertyNames[i], 0, offset);
    }

    return JSValue::encode(structure);
}

extern "C" EncodedJSValue JSC__createEmptyObjectWithStructure(JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    auto& vm = globalObject->vm();
    auto* object = JSC::constructEmptyObject(vm, structure);

    ensureStillAliveHere(object);
    vm.writeBarrier(object);

    return JSValue::encode(object);
}

extern "C" void JSC__runInDeferralContext(JSC::VM* vm, void* ptr, void (*callback)(void*))
{
    GCDeferralContext context(*vm);
    callback(ptr);
}

extern "C" void JSC__putDirectOffset(JSC::VM* vm, JSC::EncodedJSValue object, unsigned int offset, JSC::EncodedJSValue value)
{
    JSValue::decode(object).getObject()->putDirectOffset(*vm, offset, JSValue::decode(value));
}

}
