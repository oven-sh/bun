#pragma once

#include "root.h"
#include "JavaScriptCore/JSObject.h"

JSC::JSObject* createJSCModule(JSC::JSGlobalObject* globalObject);
JSC::Structure* createMemoryFootprintStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);