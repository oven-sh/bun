#include "JSSocketAddressConstructor.h"
#include "JSSocketAddress.h"
#include "JavaScriptCore/Lookup.h"
#include "NodeValidator.h"
#include "ZigGlobalObject.h"

using namespace JSC;
namespace Bun {

const ClassInfo JSSocketAddressConstructor::s_info = {
    "SocketAddressConstructor"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSSocketAddressConstructor)
};
// todo
// static const JSSocketAddressConstructorTableValues[] = {
//     { "isSocketAddress"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsScketAddressConstructorFunction_isSocketAddress, 1 },
//     { "parse"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsScketAddressConstructorFunction_parse, 1 } },
// };

// void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* global, JSSocketAddressPrototype* prototype)
// {
// }

JSSocketAddressConstructor* JSSocketAddressConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
{
    JSSocketAddressConstructor* ptr = new (NotNull, JSC::allocateCell<JSSocketAddressConstructor>(vm)) JSSocketAddressConstructor(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

// new SocketAddress(AF, address, port = 0, flowLabel = 0)
JSC::EncodedJSValue JSSocketAddressConstructor::construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    static const NeverDestroyed<String> port_name = MAKE_STATIC_STRING_IMPL("port");
    auto& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue af_arg = callFrame->argument(0);
    JSValue address_arg = callFrame->argument(1);
    JSValue port_arg = callFrame->argument(2);
    JSValue flowLabel_arg = callFrame->argument(3);

    // addressFamily
    V::validateUint32(scope, global, af_arg, "addressFamily"_s, jsBoolean(false));
    RETURN_IF_EXCEPTION(scope, {});
    uint32_t af = af_arg.toUInt32(global);
    if (UNLIKELY(af != AF_INET && af != AF_INET6)) {
        throwTypeError(global, scope, "Invalid address family"_s);
        return encodedJSUndefined();
    }

    // address
    V::validateString(scope, global, address_arg, "address"_s);
    RETURN_IF_EXCEPTION(scope, encodedJSUndefined());
    JSC::JSString* address = jsCast<JSC::JSString*>(address_arg);

    // port
    uint32_t port = 0;
    if (LIKELY(!port_arg.isUndefined())) {
        V::validatePort(scope, global, port_arg, jsString(vm, port_name), true);
        RETURN_IF_EXCEPTION(scope, encodedJSUndefined());
        port = port_arg.toUInt32(global);
        ASSERT(port <= std::numeric_limits<in_port_t>().max());
        // port = static_cast<in_port_t>(port32);
    }

    // flowLabel
    uint32_t flowLabel = 0;
    if (UNLIKELY(!flowLabel_arg.isUndefined())) {
        V::validateUint32(scope, global, flowLabel_arg, "flowlabel"_s, jsBoolean(false));
        RETURN_IF_EXCEPTION(scope, encodedJSUndefined());
        flowLabel = flowLabel_arg.toUInt32(global);
    }

    auto* structure = global->JSSocketAddressStructure();
    JSSocketAddress* sockaddr = JSSocketAddress::create(vm, global, structure, address, port, af, flowLabel);
    RETURN_IF_EXCEPTION(scope, encodedJSUndefined()); // throws if inet_pton fails
    return JSValue::encode(sockaddr);
}

JSC::EncodedJSValue JSSocketAddressConstructor::call(JSC::JSGlobalObject* global, JSC::CallFrame* callFrame)
{
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    throwTypeError(global, scope, "Cannot construct SocketAddress"_s);
    return encodedJSUndefined();
}

JSSocketAddressConstructor::JSSocketAddressConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, call, construct)
{
}

// TODO: reifyStaticProperties
void JSSocketAddressConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 1, String("SocketAddress"_s), PropertyAdditionMode::WithoutStructureTransition);
    ASSERT(inherits(info()));
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

} // namespace Bun
