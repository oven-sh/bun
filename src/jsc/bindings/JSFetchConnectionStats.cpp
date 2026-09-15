#include "JSFetchConnectionStats.h"

#include "ZigGlobalObject.h"
#include "BunCommonStrings.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"

using namespace JSC;

namespace Bun {
namespace JSFetchConnectionStats {

static constexpr ASCIILiteral propertyNames[] = {
    "bytesSent"_s,
    "requestBodyBytesSent"_s,
    "responseStarted"_s,
    "connectionReused"_s,
    "nextHopProtocol"_s,
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
// `nextHopProtocol` is 0 (not known), or 1 + the `http::Protocol` that carried the request.
extern "C" JSC::EncodedJSValue JSFetchConnectionStats__create(JSGlobalObject* globalObject, uint64_t bytesSent, uint64_t requestBodyBytesSent, bool responseStarted, bool connectionReused, uint8_t nextHopProtocol, EncodedJSValue remoteAddress, uint16_t remotePort, bool isIPv6)
{
    VM& vm = globalObject->vm();
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);

    JSValue address = JSValue::decode(remoteAddress);
    JSValue port = jsNull();
    JSValue family = jsNull();
    auto& commonStrings = Bun::commonStrings(vm);
    if (!address.isNull()) {
        port = jsNumber(remotePort);
        family = isIPv6 ? commonStrings.IPv6String() : commonStrings.IPv4String();
    }

    // The ALPN protocol ids, as in PerformanceResourceTiming.nextHopProtocol.
    JSValue protocol = jsEmptyString(vm);
    switch (nextHopProtocol) {
    case 1:
        protocol = commonStrings.alpnHttp11String();
        break;
    case 2:
        protocol = commonStrings.alpnH2String();
        break;
    case 3:
        protocol = commonStrings.alpnH3String();
        break;
    default:
        break;
    }

    JSObject* object = constructEmptyObject(vm, global->JSFetchConnectionStatsStructure());
    object->putDirectOffset(vm, 0, jsNumber(static_cast<double>(bytesSent)));
    object->putDirectOffset(vm, 1, jsNumber(static_cast<double>(requestBodyBytesSent)));
    object->putDirectOffset(vm, 2, jsBoolean(responseStarted));
    object->putDirectOffset(vm, 3, jsBoolean(connectionReused));
    object->putDirectOffset(vm, 4, protocol);
    object->putDirectOffset(vm, 5, address);
    object->putDirectOffset(vm, 6, port);
    object->putDirectOffset(vm, 7, family);
    return JSValue::encode(object);
}
