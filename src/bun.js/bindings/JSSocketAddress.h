// The object returned by Bun.serve's .requestIP()
#pragma once
#include "root.h"
#include "JavaScriptCore/JSObjectInlines.h"

extern "C" {
#if OS(WINDOWS)
#include <WinSock2.h> // in_addr - https://learn.microsoft.com/en-us/windows/win32/api/winsock2/
#include <in6addr.h> // in6_addr - https://learn.microsoft.com/en-us/windows/win32/api/ws2def/
#include <ws2tcpip.h> // inet_ntop, inet_pton - https://learn.microsoft.com/en-us/windows/win32/api/ws2tcpip/
#include <Ws2def.h> // AF_INET, AF_INET6
typedef union address {
    struct in_addr ipv4;
    struct in6_addr ipv6;
} address_t;
#define in_port_t USHORT
#else
#include <netinet/in.h> // in_addr, in6_addr
#include <arpa/inet.h> // inet_pton, inet_ntop
typedef union address {
    struct in_addr ipv4;
    struct in6_addr ipv6;
} address_t;
#endif
}

using namespace JSC;

namespace Bun {

/// `SocketAddress` is written in Zig
// struct SocketAddress;

// class JSSocketAddress : public JSC::JSDestructibleObject {
// public:
//     using Base = JSC::JSDestructibleObject;
//     using DOMWrapped = SocketAddress;
//     static J Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

// }; // class JSSocketAddress

class JSSocketAddress final : public JSC::JSObject {
public:
    using Base = JSC::JSObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    // static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    /// Native SocketAddress used in/by Zig code.
    // SocketAddress* m_sockaddr { nullptr };
    // SocketAddress* m_address
    // uint8_t m_address[16];
    // LazyProperty<JSSocketAddress, address_t> m_address;
    address_t m_address;
    JSC::JSString* address() const;
    uint8_t addressFamily() const;
    in_port_t port() const;
    uint32_t flowLabel() const;

    /// Returns `nullptr` if the address is invalid. A js exception will be thrown.
    static JSSocketAddress* create(JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure,
        JSC::JSString* address,
        in_port_t port,
        bool isIPv6);

    /// Returns `nullptr` if the address is invalid. A js exception will be thrown.
    static JSSocketAddress* create(JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure,
        JSC::JSString* address,
        in_port_t port,
        uint8_t addressFamily, // AF_INET | AF_INET6
        uint32_t flowLabel);

    static void destroy(JSC::JSCell*);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSObject* createPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    // static JSObject* createConstructor(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
    // {
    //     return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    // }

    // void detach()
    // {
    //     this->sockaddr
    // }

    // static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
    // static ptrdiff_t offsetOfWrapped() { return OBJECT_OFFSETOF(JSSocketAddress, m_ctx); }

    // /**
    //  * Estimated size of the object from Zig including the JS wrapper.
    //  */
    // static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);

    // /**
    //  * Memory cost of the object from Zig, without necessarily having a JS wrapper alive.
    //  */
    // static size_t memoryCost(void* ptr);

    JSSocketAddress(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    ~JSSocketAddress();

    void finishCreation(JSC::VM&);

    DECLARE_EXPORT_INFO;

    DECLARE_VISIT_CHILDREN;
    template<typename Visitor> void visitAdditionalChildren(Visitor&);
    DECLARE_VISIT_OUTPUT_CONSTRAINTS;

}; // class JSSocketAddress

} // namespace Bun

extern "C" JSObject* JSSocketAddress__create(JSGlobalObject* globalObject, JSString* value, int port, bool isIPv6);
