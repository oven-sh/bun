#include "BunClientData.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCell.h"
#include "ErrorCode.h"

#include "JSSocketAddress.h"
#include "JSSocketAddressConstructor.h"
#include "JSSocketAddressPrototype.h"

using namespace JSC;

namespace Bun {

static constexpr PropertyOffset addressOffset = 0;
static constexpr PropertyOffset addressFamilyOffset = 1;
static constexpr PropertyOffset portOffset = 2;
static constexpr PropertyOffset flowLabelOffset = 3;

inline JSC::JSString* JSSocketAddress::address() const
{
    auto value = this->getDirect(addressOffset);
    JSC::JSString* str = jsCast<JSC::JSString*>(value);
    return str;
    // return value.getString(globalObject());
}

inline uint8_t JSSocketAddress::addressFamily() const
{
    uint32_t af = this->getDirect(addressFamilyOffset).asUInt32();
    ASSERT(af == AF_INET6 || af == AF_INET);
    return af;
}

inline in_port_t JSSocketAddress::port() const
{
    auto port = this->getDirect(portOffset).asUInt32();
    ASSERT(port <= 0xFFFF);
    return port;
}

inline uint32_t JSSocketAddress::flowLabel() const
{
    return this->getDirect(flowLabelOffset).asUInt32();
}

// =============================================================================

JSSocketAddress* JSSocketAddress::create(JSC::VM& vm,
    JSC::JSGlobalObject* globalObject,
    JSC::Structure* structure,
    JSC::JSString* address,
    uint32_t port,
    bool isIPv6)
{
    return create(vm, globalObject, structure, address, port, isIPv6 ? AF_INET6 : AF_INET, 0);
}

JSSocketAddress* JSSocketAddress::create(JSC::VM& vm,
    JSC::JSGlobalObject* globalObject,
    JSC::Structure* structure,
    JSC::JSString* address,
    uint32_t port,
    uint8_t addressFamily, // AF_INET | AF_INET6
    uint32_t flowLabel)
{
    static const NeverDestroyed<String> IPv4 = MAKE_STATIC_STRING_IMPL("IPv4");
    static const NeverDestroyed<String> IPv6 = MAKE_STATIC_STRING_IMPL("IPv6");

    auto scope = DECLARE_THROW_SCOPE(vm);

    address_t addr;

    const char* address_bytes = address->value(globalObject)->ascii().data();
    switch (inet_pton(addressFamily, address_bytes, &addr)) {
    case 1: // ok
        break;
    case 0: // invalid address
        // node throws ERR_INVALID_ADDRESS
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_IP_ADDRESS, "Invalid address"_s);
        return nullptr;
    case -1: // syserr
        // TODO: how to handle system errors?
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_IP_ADDRESS, "Invalid address"_s);
        return nullptr;
    default:
        __builtin_unreachable();
    }

    auto* af_str = jsString(vm, addressFamily == AF_INET6 ? IPv6 : IPv4);

    JSSocketAddress* ptr = new (NotNull, JSC::allocateCell<JSSocketAddress>(vm)) JSSocketAddress(vm, structure);
    ptr->m_address = addr;
    ptr->finishCreation(vm);

    ptr->putDirectOffset(vm, addressOffset, address);
    ptr->putDirectOffset(vm, addressFamilyOffset, af_str);
    ptr->putDirectOffset(vm, portOffset, jsNumber(static_cast<uint32_t>(port)));
    ptr->putDirectOffset(vm, flowLabelOffset, jsNumber(static_cast<uint32_t>(flowLabel)));
    return ptr;
}

void JSSocketAddress::destroy(JSC::JSCell* cell)
{
    auto* thisObject = jsCast<JSSocketAddress*>(cell);
    thisObject->~JSSocketAddress();
}

JSC::GCClient::IsoSubspace* JSSocketAddress::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSSocketAddress, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSSocketAddress.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSocketAddress = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSSocketAddress.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSocketAddress = std::forward<decltype(space)>(space); });
}

JSC::JSObject* JSSocketAddress::createPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* structure = JSSocketAddressPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    structure->setMayBePrototype(true);
    return JSSocketAddressPrototype::create(vm, globalObject, structure);
}

JSC::Structure* JSSocketAddress::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    auto* structure = JSC::Structure::create(vm,
        globalObject,
        prototype,
        JSC::TypeInfo(JSC::ObjectType, StructureFlags),
        info(),
        NonArray,
        4);

    JSC::PropertyOffset offset;
    // TODO: add identifiers to CommonIdentifiers?
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "address"_s),
        static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete),
        offset);
    ASSERT(offset == addressOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "family"_s),
        static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete),
        offset);
    ASSERT(offset == addressFamilyOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "port"_s),
        static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete),
        offset);
    ASSERT(offset == portOffset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "flowlabel"_s),
        static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | PropertyAttribute::DontEnum),
        offset);
    ASSERT(offset == flowLabelOffset);

    return structure;
}

JSSocketAddress::~JSSocketAddress()
{
}

void JSSocketAddress::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    // initializeProperties(vm, globalObject, prototype);
    // TODO: idk how to get a globalobject here
    // this->m_address.initLater([](const LazyProperty<JSSocketAddress, address_t>::Initializer& init) {
    //     auto af = init->owner->addressFamily();
    //     auto address = init->owner->address();
    //     address.value()
    //     address.value(init->vm.)
    // });
    // ASSERT(inherits(info()));
    // reifyStaticProperties(vm, JSSocketAddress::info(),
    //     JSSocketAddressPrototypeTableValues, *this);
    // JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// void JSSocketAddress::initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype)

const ClassInfo JSSocketAddress::s_info
    = {
          "SocketAddress"_s,
          &Base::s_info,
          nullptr,
          nullptr,
          CREATE_METHOD_TABLE(JSSocketAddress)
      };

template<typename Visitor>
void JSSocketAddress::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSSocketAddress* thisObject = jsCast<JSSocketAddress*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->visitAdditionalChildren<Visitor>(visitor);
}
DEFINE_VISIT_CHILDREN(JSSocketAddress);

template<typename Visitor>
void JSSocketAddress::visitAdditionalChildren(Visitor& visitor)
{
    JSSocketAddress* thisObject = this;
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());

    // TODO: do properties added via putDirectOffset need visiting?
    // visitor.append(thisObject->m_address);
}
DEFINE_VISIT_ADDITIONAL_CHILDREN(JSSocketAddress);

template<typename Visitor>
void JSSocketAddress::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{

    auto* thisObject = jsCast<JSSocketAddress*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}
DEFINE_VISIT_OUTPUT_CONSTRAINTS(JSSocketAddress);

} // namespace Bun

extern "C" JSObject* JSSocketAddress__create(JSGlobalObject* globalObject, JSString* value, int32_t port, bool isIPv6)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (UNLIKELY(port < 0 || port > std::numeric_limits<in_port_t>::max())) {
        throwRangeError(global, scope, "Port out of range"_s);
        return nullptr;
    }

    return Bun::JSSocketAddress::create(globalObject->vm(),
        globalObject,
        global->JSSocketAddressStructure(),
        value,
        port,
        isIPv6 ? AF_INET6 : AF_INET,
        0);
}

extern "C" JSC__JSValue JSSocketAddress__getConstructor(JSGlobalObject* globalObject)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    return JSC::JSValue::encode(global->JSSocketAddress());
}
