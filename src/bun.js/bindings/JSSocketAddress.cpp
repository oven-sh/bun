#include "JSSocketAddress.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCast.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddress {

// Using a structure with inlined offsets will be more lightweight than a class.

Structure* createStructure(VM& vm, JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        3);

    JSC::PropertyOffset offset;
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "address"_s),
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "family"_s),
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "port"_s),
        0,
        offset);

    return structure;
}

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSObject* JSSocketAddress__create(JSGlobalObject* globalObject, JSString* value, int32_t port, bool isIPv6)
{
    VM& vm = globalObject->vm();

    auto* global = jsCast<Zig::GlobalObject*>(globalObject);

    JSObject* thisObject = constructEmptyObject(vm, global->JSSocketAddressStructure());
    thisObject->putDirectOffset(vm, 0, value);
    thisObject->putDirectOffset(vm, 1, isIPv6 ? jsString(vm, Bun::JSSocketAddress::IPv6) : jsString(vm, Bun::JSSocketAddress::IPv4));
    thisObject->putDirectOffset(vm, 2, jsNumber(port));

    return thisObject;
}
