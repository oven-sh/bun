#pragma std::once_flag

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(callHTTPParser);
JSC_DECLARE_HOST_FUNCTION(constructHTTPParser);

class JSHTTPParserConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHTTPParserConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSHTTPParserConstructor* constructor = new (NotNull, JSC::allocateCell<JSHTTPParserConstructor>(vm)) JSHTTPParserConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSHTTPParserConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callHTTPParser, constructHTTPParser)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);
};

} // namespace Bun
