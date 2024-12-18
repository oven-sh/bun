#include "root.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSValue.h>
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/JSInternalPromise.h>

namespace Bun {
class JSReadableStreamDefaultController;
class JSReadableStreamDefaultReader;

using namespace JSC;

class JSReadableStream final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = true;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSReadableStream* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*);
    static JSObject* createPrototype(JSC::VM&, JSC::JSGlobalObject*);
    static JSObject* createConstructor(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    enum class State {
        Readable,
        Closed,
        Errored,
    };

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    // Public API for C++ usage
    bool isLocked() const;
    bool isDisturbed() const { return m_disturbed; }

    JSReadableStreamDefaultController* controller() { return jsCast<JSReadableStreamDefaultController*>(m_controller.get()); }
    JSReadableStreamDefaultReader* reader() { return jsCast<JSReadableStreamDefaultReader*>(m_reader.get()); }

    bool locked() const { return !!m_reader; }
    JSC::JSValue getReader(VM&, JSGlobalObject*, JSValue options = jsUndefined());
    JSC::JSPromise* cancel(VM&, JSGlobalObject*, JSValue reason = jsUndefined());
    JSC::JSPromise* pipeTo(VM&, JSGlobalObject*, JSObject* destination, JSValue options = jsUndefined());
    JSC::JSValue pipeThrough(VM&, JSGlobalObject*, JSObject* transform, JSValue options = jsUndefined());
    void tee(VM&, JSGlobalObject*, JSValue& firstStream, JSValue& secondStream);

    void error(JSValue);
    void close(JSGlobalObject*);
    void setReader(JSReadableStreamDefaultReader*);

    State state() const { return m_state; }
    JSValue storedError() const { return m_storedError.get(); }
    bool disturbed() const { return m_disturbed; }

    ~JSReadableStream();

    static void destroy(JSCell* cell)
    {
        static_cast<JSReadableStream*>(cell)->~JSReadableStream();
    }

private:
    JSReadableStream(VM&, Structure*);
    void finishCreation(VM&);

    mutable JSC::WriteBarrier<JSObject> m_controller;
    mutable JSC::WriteBarrier<JSObject> m_reader;
    mutable JSC::WriteBarrier<JSC::JSObject> m_storedError;

    State m_state { State::Readable };
    bool m_disturbed { false };
};

}
