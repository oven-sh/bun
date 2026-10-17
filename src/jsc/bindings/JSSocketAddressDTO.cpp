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
    VM& vm = globalObject->vm();

    auto& commonStrings = Bun::commonStrings(vm);
    auto* family = isIPv6 ? commonStrings.IPv6String() : commonStrings.IPv4String();

    JSObject* thisObject = constructEmptyObject(vm, globalObject->JSSocketAddressDTOStructure());
    thisObject->putDirectOffset(vm, addressOffset, value);
    thisObject->putDirectOffset(vm, familyOffset, family);
    thisObject->putDirectOffset(vm, portOffset, jsNumber(port));

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
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);

    auto& commonStrings = Bun::commonStrings(vm);
    auto* af = isIPv6 ? commonStrings.IPv6String() : commonStrings.IPv4String();

    JSObject* thisObject = constructEmptyObject(vm, global->JSSocketAddressDTOStructure());
    thisObject->putDirectOffset(vm, Bun::JSSocketAddressDTO::addressOffset, JSValue::decode(address));
    thisObject->putDirectOffset(vm, Bun::JSSocketAddressDTO::familyOffset, af);
    thisObject->putDirectOffset(vm, Bun::JSSocketAddressDTO::portOffset, jsNumber(port));

    return JSValue::encode(thisObject);
}

// `out` is the caller's object: each field is a [[Set]], and a store that `out` refuses is not an error, as in Node's AddressToJS:
// https://github.com/nodejs/node/blob/v26.3.0/src/tcp_wrap.cc#L567-L583
// Node stores address, family, port. The order here is the key order that server.address() already has in Bun.
extern "C" [[ZIG_EXPORT(false_is_throw)]] bool JSSocketAddressDTO__assign(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedOut, JSC::EncodedJSValue address, JSC::EncodedJSValue port, bool isIPv6)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* out = asObject(JSValue::decode(encodedOut));
    auto& commonStrings = Bun::commonStrings(vm);
    JSValue family = isIPv6 ? commonStrings.IPv6String() : commonStrings.IPv4String();

    PutPropertySlot familySlot(out, false);
    out->methodTable()->put(out, globalObject, Identifier::fromString(vm, "family"_s), family, familySlot);
    RETURN_IF_EXCEPTION(scope, false);

    PutPropertySlot addressSlot(out, false);
    out->methodTable()->put(out, globalObject, Identifier::fromString(vm, "address"_s), JSValue::decode(address), addressSlot);
    RETURN_IF_EXCEPTION(scope, false);

    PutPropertySlot portSlot(out, false);
    out->methodTable()->put(out, globalObject, WebCore::builtinNames(vm).portPublicName(), JSValue::decode(port), portSlot);
    RETURN_IF_EXCEPTION(scope, false);

    return true;
}
