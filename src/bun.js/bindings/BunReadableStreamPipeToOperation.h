#pragma once

#include "root.h"

#include "JavaScriptCore/InternalFieldTuple.h"

namespace Bun {

class JSReadableStreamDefaultReader;
class JSWritableStreamDefaultWriter;

// class PipeToOperation : public JSC::JSInternalFieldObjectImpl<7> {
// public:
//     static constexpr unsigned numberOfInternalFields = 7;
//     using Base = JSC::JSInternalFieldObjectImpl<numberOfInternalFields>;
//     static PipeToOperation* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
//         JSC::JSObject* reader, JSC::JSObject* writer,
//         bool preventClose, bool preventAbort, bool preventCancel, JSC::JSObject* signal, JSC::JSPromise* promise)
//     {
//         PipeToOperation* operation = new (NotNull, JSC::allocateCell<PipeToOperation>(vm)) PipeToOperation(vm, globalObject);
//         operation->finishCreation(vm, reader, writer, preventClose, preventAbort, preventCancel, signal, promise);
//         return operation;
//     }

//     void perform(JSC::VM& vm, JSC::JSGlobalObject* globalObject) {}

//     bool preventClose { false };
//     bool preventAbort { false };
//     bool preventCancel { false };

//     mutable JSC::WriteBarrier<JSC::JSObject> reader;
//     mutable JSC::WriteBarrier<JSC::JSObject> writer;
//     mutable JSC::WriteBarrier<JSC::JSObject> signal;
//     mutable JSC::WriteBarrier<JSC::JSPromise> promise;

// private:
//     PipeToOperation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
//         : Base(vm, globalObject)
//     {
//     }

//     void finishCreation(JSC::VM& vm, JSC::JSObject* reader, JSC::JSObject* writer,
//         bool preventClose, bool preventAbort, bool preventCancel, JSC::JSObject* signal, JSC::JSPromise* promise)
//     {
//         Base::finishCreation(vm);
//         internalField(0).set(vm, this, reader);
//         internalField(1).set(vm, this, writer);
//         internalField(2).set(vm, this, JSC::jsBoolean(preventClose));
//         internalField(3).set(vm, this, JSC::jsBoolean(preventAbort));
//         internalField(4).set(vm, this, JSC::jsBoolean(preventCancel));
//         internalField(5).set(vm, this, signal ? signal : JSC::jsUndefined());
//         internalField(6).set(vm, this, promise);
//     }
// };

}
