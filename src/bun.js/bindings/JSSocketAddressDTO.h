// The object returned by Bun.serve's .requestIP()
#pragma once
#include "headers.h"
#include "root.h"
#include "JavaScriptCore/JSObjectInlines.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddressDTO {

Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSC__JSValue JSSocketAddressDTO__create(JSGlobalObject* globalObject, JSString* address, int32_t port, bool isIPv6);

extern "C" WTF::StaticStringImpl* const IPv4;
extern "C" WTF::StaticStringImpl* const IPv6;
extern "C" WTF::StaticStringImpl* const INET_LOOPBACK;
extern "C" WTF::StaticStringImpl* const INET6_ANY;
