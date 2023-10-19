#include "root.h"
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "headers-handwritten.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {
using namespace JSC;
extern "C" EncodedJSValue JSC__createStructure(JSC::JSGlobalObject* globalObject, unsigned int inlineCapacity, BunString* names)
{
    auto& vm = globalObject->vm();
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), inlineCapacity);
    PropertyOffset offset = 0;
    for (unsigned i = 0; i < inlineCapacity; i++) {
        JSC::PropertyName ident = JSC::PropertyName(JSC::Identifier::fromString(vm, Bun::toWTFString(names[i]).isolatedCopy()));
        structure = structure->addPropertyTransition(vm, structure, ident, 0, offset);
    }

    return JSValue::encode(structure);
}

extern "C" EncodedJSValue JSC__createEmptyObjectWithStructure(JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    auto& vm = globalObject->vm();
    return JSValue::encode(JSC::constructEmptyObject(vm, structure));
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
