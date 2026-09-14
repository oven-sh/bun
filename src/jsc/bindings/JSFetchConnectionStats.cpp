#include "JSFetchConnectionStats.h"

#include "ZigGlobalObject.h"
#include "BunCommonStrings.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"

using namespace JSC;

namespace Bun {
namespace JSFetchConnectionStats {

static constexpr ASCIILiteral propertyNames[] = {
    "bytesWritten"_s,
    "requestBodyBytesSent"_s,
    "responseStarted"_s,
    "socketReused"_s,
    "remoteAddress"_s,
    "remotePort"_s,
    "remoteFamily"_s,
};

Structure* createStructure(VM& vm, JSGlobalObject* globalObject)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        std::size(propertyNames));

    PropertyOffset expected = 0;
    for (auto name : propertyNames) {
        PropertyOffset offset;
        structure = structure->addPropertyTransition(vm, structure, Identifier::fromString(vm, name), 0, offset);
        ASSERT_UNUSED(expected, offset == expected);
        expected++;
    }
    return structure;
}

} // namespace JSFetchConnectionStats
} // namespace Bun

// `remoteAddress` is a string, or null when no connection was established.
extern "C" JSC::EncodedJSValue JSFetchConnectionStats__create(JSGlobalObject* globalObject, uint64_t bytesWritten, uint64_t requestBodyBytesSent, bool responseStarted, bool socketReused, EncodedJSValue remoteAddress, uint16_t remotePort, bool isIPv6)
{
    VM& vm = globalObject->vm();
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);

    JSValue address = JSValue::decode(remoteAddress);
    JSValue port = jsNull();
    JSValue family = jsNull();
    if (!address.isNull()) {
        auto& commonStrings = Bun::commonStrings(vm);
        port = jsNumber(remotePort);
        family = isIPv6 ? commonStrings.IPv6String() : commonStrings.IPv4String();
    }

    JSObject* object = constructEmptyObject(vm, global->JSFetchConnectionStatsStructure());
    object->putDirectOffset(vm, 0, jsNumber(static_cast<double>(bytesWritten)));
    object->putDirectOffset(vm, 1, jsNumber(static_cast<double>(requestBodyBytesSent)));
    object->putDirectOffset(vm, 2, jsBoolean(responseStarted));
    object->putDirectOffset(vm, 3, jsBoolean(socketReused));
    object->putDirectOffset(vm, 4, address);
    object->putDirectOffset(vm, 5, port);
    object->putDirectOffset(vm, 6, family);
    return JSValue::encode(object);
}
