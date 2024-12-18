#include "root.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSValue.h>
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyProperty.h>

namespace Bun {

using namespace JSC;

class JSReadableStream;

class JSReadableStreamDefaultController final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.plainObjectSpace();
    }

    static JSReadableStreamDefaultController* create(JSC::VM&, JSC::Structure*, JSReadableStream* stream);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSObject* createPrototype(JSC::VM&, JSC::JSGlobalObject*);
    static JSObject* createConstructor(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    // Internal slots from the spec
    JSC::JSArray* queue() { return m_queue.get(); }
    double queueTotalSize() { return m_queueTotalSize; }
    bool started() const { return m_started; }
    bool closeRequested() const { return m_closeRequested; }
    bool pullAgain() const { return m_pullAgain; }
    bool pulling() const { return m_pulling; }
    double desiredSize();
    JSValue desiredSizeValue();

    // API for C++ usage
    JSC::JSValue enqueue(JSC::JSGlobalObject*, JSC::JSValue chunk);
    void error(JSC::JSGlobalObject*, JSC::JSValue error);
    void close(JSC::JSGlobalObject*);
    bool canCloseOrEnqueue() const;

    JSObject* cancelAlgorithm() { return m_cancelAlgorithm.get(); }
    JSObject* pullAlgorithm() { return m_pullAlgorithm.get(); }
    JSObject* strategySizeAlgorithm() { return m_strategySizeAlgorithm.get(); }

    void setPullAlgorithm(JSC::JSObject* callback) { m_pullAlgorithm.set(vm(), this, callback); }
    void setCancelAlgorithm(JSC::JSObject* callback) { m_cancelAlgorithm.set(vm(), this, callback); }
    void setStrategySizeAlgorithm(JSC::JSObject* callback) { m_strategySizeAlgorithm.set(vm(), this, callback); }

    void fulfillPull(JSC::JSGlobalObject*);
    void rejectPull(JSC::JSGlobalObject*, JSC::JSValue error);
    void callPullIfNeeded(JSC::JSGlobalObject*);
    bool shouldCallPull() const;

private:
    JSReadableStreamDefaultController(JSC::VM&, JSC::Structure*);
    ~JSReadableStreamDefaultController();
    void finishCreation(JSC::VM&, JSC::JSObject* stream);

    // Internal slots
    JSC::WriteBarrier<JSReadableStream> m_stream;
    LazyProperty<JSObject, JSArray> m_queue;
    JSC::WriteBarrier<JSC::JSObject> m_pullAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_cancelAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_strategySizeAlgorithm;
    double m_strategyHWM { 0 };
    double m_queueTotalSize { 0 };
    bool m_started { false };
    bool m_closeRequested { false };
    bool m_pullAgain { false };
    bool m_pulling { false };
};

}
