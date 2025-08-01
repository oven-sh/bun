#include "JSSocketAddressDTO.h"

#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCast.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddressDTO {

static constexpr PropertyOffset addressOffset = 0;
static constexpr PropertyOffset familyOffset = 1;
static constexpr PropertyOffset portOffset = 2;

JSObject* create(Zig::GlobalObject* globalObject, JSString* value, int32_t port, bool isIPv6)
{
    static const NeverDestroyed<String> IPv4 = MAKE_STATIC_STRING_IMPL("IPv4");
    static const NeverDestroyed<String> IPv6 = MAKE_STATIC_STRING_IMPL("IPv6");

    VM& vm = globalObject->vm();

    JSObject* thisObject = constructEmptyObject(vm, globalObject->JSSocketAddressDTOStructure());
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
    ASSERT(offset == addressOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "family"_s),
        0,
        offset);
    ASSERT(offset == familyOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "port"_s),
        0,
        offset);
    ASSERT(offset == portOffset);

    return structure;
}

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSC::EncodedJSValue JSSocketAddressDTO__create(JSGlobalObject* globalObject, EncodedJSValue address, uint16_t port, bool isIPv6)
{
    VM& vm = globalObject->vm();
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);

    auto* af = isIPv6 ? global->commonStrings().IPv6String(global) : global->commonStrings().IPv4String(global);

    JSObject* thisObject = constructEmptyObject(vm, global->JSSocketAddressDTOStructure());
    thisObject->putDirectOffset(vm, Bun::JSSocketAddressDTO::addressOffset, JSValue::decode(address));
    thisObject->putDirectOffset(vm, Bun::JSSocketAddressDTO::familyOffset, af);
    thisObject->putDirectOffset(vm, Bun::JSSocketAddressDTO::portOffset, jsNumber(port));

    return JSValue::encode(thisObject);
}
