#include "root.h"

#include <JavaScriptCore/HeapCellInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VM.h>

// The cell's visitChildren has to report the same bytes for as long as the cell owns them.
extern "C" void JSC__JSValue__reportExtraMemoryAllocated(JSC::EncodedJSValue encodedCell, size_t bytes)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedCell);
    if (!value.isCell())
        return;
    JSC::JSCell* cell = value.asCell();
    cell->vm().heap.reportExtraMemoryAllocated(cell, bytes);
}
