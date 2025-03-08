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
