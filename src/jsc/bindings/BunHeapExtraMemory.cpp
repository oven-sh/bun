#include "root.h"

#include <JavaScriptCore/HeapCellInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VM.h>

// The growth half of JSC's extra-memory contract, for native memory a cell came to own after it was
// created. The cell's visitChildren has to report the same bytes while it owns them.
extern "C" void JSC__JSValue__reportExtraMemoryAllocated(JSC::EncodedJSValue encodedCell, size_t bytes)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedCell);
    if (!value.isCell())
        return;
    JSC::JSCell* cell = value.asCell();
    cell->vm().heap.reportExtraMemoryAllocated(cell, bytes);
}
