#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include "JavaScriptCore/JSCast.h"
#include <JavaScriptCore/LazyProperty.h>
#include "BunStreamQueue.h"

namespace Bun {

class JSReadableStream;

class JSReadableStreamDefaultController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr bool needsDestruction = true;

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSReadableStreamDefaultController*>(cell)->~JSReadableStreamDefaultController();
    }

    ~JSReadableStreamDefaultController()
    {
        // We want the queue destructor with the WTF::Vector to be called.
    }

    static JSReadableStreamDefaultController* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSReadableStream*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void performPullSteps(JSC::VM&, JSC::JSGlobalObject*, JSC::JSPromise* readRequest);

    // SetUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm) performs the following steps:
    void setup(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        Bun::JSReadableStream* stream,
        JSC::JSObject* underlyingSource = nullptr,
        JSC::JSObject* startAlgorithm = nullptr,
        JSC::JSObject* pullAlgorithm = nullptr,
        JSC::JSObject* cancelAlgorithm = nullptr,
        double highWaterMark = 1,
        JSC::JSObject* sizeAlgorithm = nullptr);

    void attach(JSReadableStream* stream);
    bool isByteController() const { return false; }
    JSC::JSObject* cancelAlgorithm() const { return m_cancelAlgorithm.get(); }

    // Internal slots from the spec
    const Bun::StreamQueue& queue() const { return m_queue; }
    Bun::StreamQueue& queue() { return m_queue; }

    bool started() const { return m_started; }
    bool closeRequested() const { return m_closeRequested; }
    bool pullAgain() const { return m_pullAgain; }
    bool pulling() const { return m_pulling; }
    double desiredSize() const;
    JSC::JSValue desiredSizeValue();

    // API for C++ usage
    JSC::JSValue enqueue(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue chunk);
    JSC::JSValue enqueue(JSC::JSGlobalObject* globalObject, JSC::JSValue chunk) { return this->enqueue(this->vm(), globalObject, chunk); }
    void error(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue error);
    void error(JSC::JSGlobalObject* globalObject, JSC::JSValue error) { this->error(this->vm(), globalObject, error); }
    void close(JSC::VM&, JSC::JSGlobalObject*);
    void close(JSC::JSGlobalObject* globalObject) { this->close(this->vm(), globalObject); }
    bool canCloseOrEnqueue() const;

    JSC::JSObject* pullAlgorithm() const { return m_pullAlgorithm.get(); }

    void setPullAlgorithm(JSC::JSObject* callback) { m_pullAlgorithm.set(vm(), this, callback); }
    void setCancelAlgorithm(JSC::JSObject* callback) { m_cancelAlgorithm.set(vm(), this, callback); }
    void setUnderlyingSource(JSC::JSObject* underlyingSource) { m_underlyingSource.set(vm(), this, underlyingSource); }

    void fulfillPull(JSC::JSGlobalObject*);
    void rejectPull(JSC::JSGlobalObject*, JSC::JSValue error);
    void callPullIfNeeded(JSC::JSGlobalObject*);
    bool shouldCallPull() const;
    JSReadableStream* stream() const;
    JSC::JSObject* underlyingSource() const { return m_underlyingSource.get(); }
    void clearAlgorithms();
    void setHighWaterMark(double highWaterMark) { m_queue.highWaterMark = highWaterMark; }

private:
    JSReadableStreamDefaultController(JSC::VM&, JSC::Structure*);

    void finishCreation(JSC::VM&, JSReadableStream*);

    // Internal slots
    Bun::StreamQueue m_queue {};
    mutable JSC::WriteBarrier<JSReadableStream> m_stream;
    mutable JSC::WriteBarrier<JSC::JSObject> m_pullAlgorithm;
    mutable JSC::WriteBarrier<JSC::JSObject> m_cancelAlgorithm;
    mutable JSC::WriteBarrier<JSC::JSObject> m_underlyingSource;

    bool m_started { false };
    bool m_closeRequested { false };
    bool m_pullAgain { false };
    bool m_pulling { false };
};

} // namespace Bun
