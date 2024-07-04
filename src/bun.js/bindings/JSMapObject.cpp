#include "root.h"

#include "blob.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSBigInt.h"

#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/JSMap.h>
#include "JavaScriptCore/JSMapInlines.h"
#include <JavaScriptCore/JSString.h>

#include "ZigGlobalObject.h"

struct DoubleToIntMapKV {
    double key;
    uint64_t value;
};

extern "C" JSC::EncodedJSValue Bun__createMapFromDoubleUint64KVArray(Zig::GlobalObject* globalObject, const DoubleToIntMapKV* kvs, size_t length, bool asBigInt)
{
    JSC::JSMap* map
        = JSC::JSMap::create(globalObject->vm(), globalObject->mapStructure());

    for (size_t i = 0; i < length; i++) {
        if (asBigInt) {
            map->set(globalObject, JSC::jsDoubleNumber(kvs[i].key), JSC::JSBigInt::createFrom(globalObject, kvs[i].value));
        } else {
            map->set(globalObject, JSC::jsDoubleNumber(kvs[i].key), JSC::jsNumber(kvs[i].value));
        }
    }

    return JSC::JSValue::encode(map);
}
