#pragma once

#include "root.h"

// What the inspector shows of Bun's own objects.
namespace Bun::InjectedScriptHost {

JSC::JSValue subtype(JSC::JSGlobalObject*, JSC::JSValue);
JSC::JSValue getInternalProperties(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);

}
