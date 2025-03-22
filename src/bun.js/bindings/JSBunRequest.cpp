#include "root.h"

#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSObject.h>
#include "JSBunRequest.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

static JSC_DECLARE_CUSTOM_GETTER(jsJSBunRequestGetParams);

static const HashTableValue JSBunRequestPrototypeValues[] = {
    { "params"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsJSBunRequestGetParams, nullptr } },
};

JSBunRequest* JSBunRequest::create(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr, JSObject* params)
{
    JSBunRequest* ptr = new (NotNull, JSC::allocateCell<JSBunRequest>(vm)) JSBunRequest(vm, structure, sinkPtr);
    ptr->finishCreation(vm, params);
    return ptr;
}

JSC::Structure* JSBunRequest::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(0b11101110), StructureFlags), info());
}

JSC::GCClient::IsoSubspace* JSBunRequest::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSBunRequest, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForBunRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBunRequest = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForBunRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForBunRequest = std::forward<decltype(space)>(space); });
}

JSObject* JSBunRequest::params() const
{
    if (m_params) {
        return m_params.get();
    }
    return nullptr;
}

void JSBunRequest::setParams(JSObject* params)
{
    m_params.set(Base::vm(), this, params);
}

JSBunRequest::JSBunRequest(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)
    : Base(vm, structure, sinkPtr)
{
}
extern "C" size_t Request__estimatedSize(void* requestPtr);
extern "C" void Bun__JSRequest__calculateEstimatedByteSize(void* requestPtr);
void JSBunRequest::finishCreation(JSC::VM& vm, JSObject* params)
{
    Base::finishCreation(vm);
    m_params.setMayBeNull(vm, this, params);
    Bun__JSRequest__calculateEstimatedByteSize(this->wrapped());

    auto size = Request__estimatedSize(this->wrapped());
    vm.heap.reportExtraMemoryAllocated(this, size);
}

template<typename Visitor>
void JSBunRequest::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSBunRequest* thisCallSite = jsCast<JSBunRequest*>(cell);
    Base::visitChildren(thisCallSite, visitor);
    visitor.append(thisCallSite->m_params);
}

DEFINE_VISIT_CHILDREN(JSBunRequest);

class JSBunRequestPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static JSBunRequestPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSBunRequestPrototype>(vm)) JSBunRequestPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), NonArray);
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBunRequestPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSBunRequestPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSBunRequest::info(), JSBunRequestPrototypeValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

const JSC::ClassInfo JSBunRequestPrototype::s_info = { "BunRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunRequestPrototype) };
const JSC::ClassInfo JSBunRequest::s_info = { "BunRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunRequest) };

JSC_DEFINE_CUSTOM_GETTER(jsJSBunRequestGetParams, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBunRequest* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue));
    if (!request)
        return JSValue::encode(jsUndefined());

    auto* params = request->params();
    if (!params) {
        auto* prototype = defaultGlobalObject(globalObject)->m_JSBunRequestParamsPrototype.get(globalObject);
        params = JSC::constructEmptyObject(globalObject, prototype);
        request->setParams(params);
    }

    return JSValue::encode(params);
}

Structure* createJSBunRequestStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    auto prototypeStructure = JSBunRequestPrototype::createStructure(vm, globalObject, globalObject->JSRequestPrototype());
    auto* prototype = JSBunRequestPrototype::create(vm, globalObject, prototypeStructure);
    return JSBunRequest::createStructure(vm, globalObject, prototype);
}

extern "C" EncodedJSValue Bun__getParamsIfBunRequest(JSC::EncodedJSValue thisValue)
{
    if (auto* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue))) {
        auto* params = request->params();
        if (!params) {
            return JSValue::encode(jsUndefined());
        }

        return JSValue::encode(params);
    }

    return JSValue::encode({});
}

} // namespace Bun
