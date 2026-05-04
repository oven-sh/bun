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

    static std::array<JSValue, numberOfInternalFields> initialValues()
    {
        return { {
            jsNumber(-1),
            jsUndefined(),
            jsUndefined(),
        } };
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSNextTickQueue(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    bool isEmpty();
    void drain(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
};
}
