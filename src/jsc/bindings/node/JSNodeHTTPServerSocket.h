#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"

extern "C" {
struct us_socket_stream_buffer_t {
    char* list_ptr = nullptr;
    size_t list_cap = 0;
    size_t listLen = 0;
    size_t total_bytes_written = 0;
    size_t cursor = 0;

    size_t bufferedSize() const
    {
        return listLen - cursor;
    }
    size_t totalBytesWritten() const
    {
        return total_bytes_written;
    }
};

struct us_socket_t;
}

namespace uWS {
template<bool SSL>
struct HttpResponseData;
struct WebSocketData;
}

namespace WebCore {
class JSNodeHTTPResponse;
}

namespace Bun {

class JSNodeHTTPServerSocketPrototype;

class JSNodeHTTPServerSocket : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    us_socket_stream_buffer_t streamBuffer = {};
    us_socket_t* socket = nullptr;
    unsigned is_ssl : 1 = 0;
    unsigned ended : 1 = 0;
    unsigned upgraded : 1 = 0;
    JSC::Strong<JSNodeHTTPServerSocket> strongThis = {};

    static JSNodeHTTPServerSocket* create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response);
    static JSNodeHTTPServerSocket* create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response);

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSNodeHTTPServerSocket*>(cell)->JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket();
    }

    template<bool SSL>
    static void clearSocketData(bool upgraded, us_socket_t* socket);

    void close();
    bool isClosed() const;
    bool isAuthorized() const;

    ~JSNodeHTTPServerSocket();

    JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response);

    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnClose;
    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnDrain;
    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnData;
    mutable JSC::WriteBarrier<WebCore::JSNodeHTTPResponse> currentResponseObject;
    mutable JSC::WriteBarrier<JSC::JSObject> m_remoteAddress;
    mutable JSC::WriteBarrier<JSC::JSObject> m_localAddress;
    mutable JSC::WriteBarrier<JSC::JSObject> m_duplex;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<JSNodeHTTPServerSocket, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSNodeHTTPServerSocket.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNodeHTTPServerSocket = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSNodeHTTPServerSocket.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNodeHTTPServerSocket = std::forward<decltype(space)>(space); });
    }

    void detach();
    void onClose();
    void onDrain();
    void onData(const char* data, int length, bool last);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    void finishCreation(JSC::VM& vm);
};

} // namespace Bun
