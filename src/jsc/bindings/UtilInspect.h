#pragma once

#include "root.h"
#include "headers-handwritten.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

// What single-line mode tells an inspect.custom hook: to print on one line too, or nothing. Mirrors ConsoleObject.rs.
enum class SingleLineHooks : uint8_t {
    OneLine = 0,
    OwnLayout = 1,
};

}

// Bun.inspect(value) on one line, with strings in quotes.
extern "C" BunString Bun__inspect_singleline(Zig::GlobalObject*, JSC::JSValue, Bun::SingleLineHooks);
