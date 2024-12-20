#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include "JavaScriptCore/JSCast.h"
#include <JavaScriptCore/LazyProperty.h>

namespace Bun {

class JSReadableStream;

class JSReadableStreamDefaultController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr bool needsDestruction = true;

    static JSReadableStreamDefaultController* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSReadableStream*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;

    void attach(JSReadableStream* stream);
    bool isByteController() const { return m_isByteController; }
    JSC::JSObject* cancelAlgorithm() const { return m_cancelAlgorithm.get(); }

    // Internal slots from the spec
    JSC::JSArray* queue() { return m_queue.getInitializedOnMainThread(this); }
    double queueTotalSize() const { return m_queueTotalSize; }
    bool started() const { return m_started; }
    bool closeRequested() const { return m_closeRequested; }
    bool pullAgain() const { return m_pullAgain; }
    bool pulling() const { return m_pulling; }
    double desiredSize() const;
    JSC::JSValue desiredSizeValue();

    // API for C++ usage
    JSC::JSValue enqueue(JSC::JSGlobalObject*, JSC::JSValue chunk);
    void error(JSC::JSGlobalObject*, JSC::JSValue error);
    void close(JSC::JSGlobalObject*);
    bool canCloseOrEnqueue() const;

    JSC::JSObject* pullAlgorithm() const { return m_pullAlgorithm.get(); }
    JSC::JSObject* strategySizeAlgorithm() const { return m_strategySizeAlgorithm.get(); }

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
    void finishCreation(JSC::VM&, JSReadableStream*);

    // Internal slots
    JSC::WriteBarrier<JSReadableStream> m_stream;
    JSC::LazyProperty<JSObject, JSC::JSArray> m_queue;
    JSC::WriteBarrier<JSC::JSObject> m_pullAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_cancelAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_strategySizeAlgorithm;
    double m_strategyHWM { 0 };
    double m_queueTotalSize { 0 };
    bool m_started { false };
    bool m_closeRequested { false };
    bool m_pullAgain { false };
    bool m_pulling { false };
    bool m_isByteController { false };
};

} // namespace Bun
