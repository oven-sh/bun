#include "root.h"

#include "ZigGlobalObject.h"
#include "JSSocketAddress.h"

#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCast.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddress {

JSObject* create(Zig::GlobalObject* globalObject, JSString* value, int32_t port, bool isIPv6)
{
    static const NeverDestroyed<String> IPv4 = MAKE_STATIC_STRING_IMPL("IPv4");
    static const NeverDestroyed<String> IPv6 = MAKE_STATIC_STRING_IMPL("IPv6");

    VM& vm = globalObject->vm();

    JSObject* thisObject = constructEmptyObject(vm, globalObject->JSSocketAddressStructure());
    thisObject->putDirectOffset(vm, 0, value);
    thisObject->putDirectOffset(vm, 1, isIPv6 ? jsString(vm, IPv6) : jsString(vm, IPv4));
    thisObject->putDirectOffset(vm, 2, jsNumber(port));

    return thisObject;
}

// Using a structure with inlined offsets should be more lightweight than a class.
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

extern "C" JSObject* JSSocketAddress__create(Zig::GlobalObject* globalObject, JSString* value, int32_t port, bool isIPv6)
{
    return Bun::JSSocketAddress::create(globalObject, value, port, isIPv6);
}
