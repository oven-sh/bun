#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>

extern "C" uint32_t Bun__JSArray__length(JSC::EncodedJSValue encodedValue)
{
    return uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell())->length();
}

// The element at `index` that a JSArray holds in its own storage, or the empty
// value for a hole, an index past the end, or an entry of the sparse map. Runs
// no user code and does not look at the prototype chain.
extern "C" JSC::EncodedJSValue Bun__JSArray__tryGetIndexQuickly(JSC::EncodedJSValue encodedValue, uint32_t index)
{
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());
    return JSC::JSValue::encode(array->tryGetIndexQuickly(index));
}
