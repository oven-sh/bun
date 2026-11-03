// The object returned by Bun.serve's .requestIP()
#pragma once
#include "headers.h"
#include "root.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "ZigGlobalObject.h"
#if OS(WINDOWS)
#include <winsock2.h>
#else
#include <sys/socket.h>
#endif

using namespace JSC;

struct us_socket_t;

namespace Bun {
namespace JSSocketAddressDTO {

Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSC::EncodedJSValue JSSocketAddressDTO__create(JSGlobalObject* globalObject, EncodedJSValue address, uint16_t port, bool isIPv6);

// getsockname() / getpeername() of a socket, whole. 0 for a unix socket and when the call fails.
extern "C" int us_socket_local_sockaddr(struct us_socket_t*, struct sockaddr_storage* out);
extern "C" int us_socket_remote_sockaddr(struct us_socket_t*, struct sockaddr_storage* out);
// `{ address, family, port }` of a kernel address, as src/runtime/socket/SocketAddress.rs prints it.
extern "C" JSC::EncodedJSValue Bun__sockaddrToJS(JSC::JSGlobalObject*, const struct sockaddr_storage*);
