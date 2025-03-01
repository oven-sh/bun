#include "root.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/JSCInlines.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace Bun {
using namespace JSC;

class JSNextTickQueue : public JSC::JSInternalFieldObjectImpl<3> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<3>;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    JS_EXPORT_PRIVATE static JSNextTickQueue* create(VM&, Structure*);
    static JSNextTickQueue* create(JSC::JSGlobalObject* globalObject);
    static JSNextTickQueue* createWithInitialValues(VM&, Structure*);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    // These values get initialized twice. Once here, and once again in
    // `ProcessObjectInternals.js#initializeNextTickQueue`.
    static std::array<JSValue, numberOfInternalFields> initialValues()
    {
        return { {
            // Enabled/initialization status of the queue.
            // * -1: initial state. Indicates that the queue is never
            //       initialized from JS.
            // * 0:  initialized in JS but not enabled. Gets enabled when
            //       `process.nextTick()` is called.
            // * 1:  enabled. The queue has been used by userland JS. It may or
            //       may not be populated.
            // * Sometimes set to undefined for reasons I don't understand.
            jsNumber(-1),
            // The queue itself. This is a fixed circular buffer.
            jsUndefined(),
            // A callback function that drains the queue. This is
            // `processTicksAndRejections`.
            jsUndefined(),
        } };
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSNextTickQueue(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    // internal getters
    WriteBarrier<Unknown>& queueStatus();
    WriteBarrier<Unknown>& queue();
    WriteBarrier<Unknown>& drainFn();

    bool isEmpty();
    void drain(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
};
}
