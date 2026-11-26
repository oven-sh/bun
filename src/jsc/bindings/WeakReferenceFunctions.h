#pragma once

#include "root.h"

namespace Bun {

// The rows of engineNativesTable in ZigGlobalObject.lut.txt.
JSC::JSValue finalizationRegistryConstructorCallback(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue finalizationRegistryPrototypeRegisterCallback(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue finalizationRegistryPrototypeUnregisterCallback(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue weakRefConstructorCallback(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue weakRefPrototypeDerefCallback(JSC::VM&, JSC::JSObject* globalObject);

} // namespace Bun
