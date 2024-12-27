
#include "root.h"

#include "JavaScriptCore/InternalFieldTuple.h"

namespace Bun {

class JSReadableStreamDefaultReader;
class JSWritableStreamDefaultWriter;

class PipeToOperation : public JSC::JSInternalFieldObjectImpl<5> {
public:
    static constexpr unsigned numberOfInternalFields = 5;
    using Base = JSC::JSInternalFieldObjectImpl<numberOfInternalFields>;
    static PipeToOperation* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSReadableStreamDefaultReader* reader, JSWritableStreamDefaultWriter* writer,
        bool preventClose, bool preventAbort, bool preventCancel, JSC::JSObject* signal, JSC::JSPromise* promise);

    void perform(JSC::VM& vm, JSC::JSGlobalObject* globalObject) {}
};

}
