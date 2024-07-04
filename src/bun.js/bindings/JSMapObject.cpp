#include "root.h"

#include "blob.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"

#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/JSMap.h>
#include "JavaScriptCore/JSMapInlines.h"
#include <JavaScriptCore/JSString.h>

#include "ZigGlobalObject.h"

extern "C" JSC::EncodedJSValue Bun__createMapFromDoubleUint64TupleArray(Zig::GlobalObject* globalObject, const double* doubles, size_t length)
{
    // JS:Map map = JSMap::create(globalObject->vm());

    // create map
    JSC::JSMap* map
        = JSC::JSMap::create(globalObject->vm(), globalObject->mapStructure());

    for (size_t i = 0; i < length; i += 2) {
        // we passed doubles in from Zig, with this doubles.appendSlice(&.{ percentile, @bitCast(val) });
        // where percentile is a f64 and val is a u64

        uint64_t value_as_u64;
        std::memcpy(&value_as_u64, &doubles[i + 1], sizeof(double)); // cast double to u64

        map->set(globalObject, JSC::jsDoubleNumber(doubles[i]), JSC::jsNumber(value_as_u64));
    }

    // do stuff, create good map
    return JSC::JSValue::encode(map);
}
