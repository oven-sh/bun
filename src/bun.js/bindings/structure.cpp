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
    JSC::Structure* structure = JSC::Structure::create(vm, globalObject, globalObject->objectPrototype(), JSC::TypeInfo(ObjectType, JSC::JSObject::StructureFlags), JSC::JSFinalObject::info(), inlineCapacity);
    PropertyOffset offset = 0;
    for (unsigned i = 0; i < inlineCapacity; i++) {
        const Identifier& ident = JSC::Identifier::fromString(vm, Bun::toWTFString(names[i]));
        structure = structure->addPropertyTransition(vm, structure, JSC::PropertyName(ident), 0, offset);
    }

    return JSValue::encode(structure);
}

extern "C" EncodedJSValue JSC__createEmptyObjectWithStructure(JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    auto& vm = globalObject->vm();
    return JSValue::encode(JSC::constructEmptyObject(vm, structure));
}

extern "C" void JSC__putDirectOffset(JSC::VM* vm, JSC::EncodedJSValue object, unsigned int offset, JSC::EncodedJSValue value)
{
    JSValue::decode(object).getObject()->putDirectOffset(*vm, offset, JSValue::decode(value));
}

}
