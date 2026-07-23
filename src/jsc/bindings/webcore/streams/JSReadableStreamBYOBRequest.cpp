#include "config.h"
#include "JSReadableStreamBYOBRequest.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableByteStreamController.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBRequestPrototypeFunction_respond);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBRequestPrototypeFunction_respondWithNewView);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBRequestPrototype_inspectCustom);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamBYOBRequestPrototypeGetter_view);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamBYOBRequestPrototypeGetter_constructor);

class JSReadableStreamBYOBRequestPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStreamBYOBRequestPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamBYOBRequestPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamBYOBRequestPrototype>(vm)) JSReadableStreamBYOBRequestPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamBYOBRequestPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamBYOBRequestPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamBYOBRequestPrototype, JSReadableStreamBYOBRequestPrototype::Base);

// JSReadableStreamBYOBRequestConstructor = JSDOMConstructorNotConstructable<...>:
// construct/call both throw; only the prototype link and the name/length live here.

template<> JSValue JSReadableStreamBYOBRequestConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject);
template<> void JSReadableStreamBYOBRequestConstructor::initializeProperties(JSC::VM&, JSDOMGlobalObject&);

template<> const ClassInfo JSReadableStreamBYOBRequestConstructor::s_info = { "ReadableStreamBYOBRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBRequestConstructor) };

template<> JSValue JSReadableStreamBYOBRequestConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<> void JSReadableStreamBYOBRequestConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ReadableStreamBYOBRequest"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSReadableStreamBYOBRequest::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

// JSReadableStreamBYOBRequestPrototype

static const HashTableValue JSReadableStreamBYOBRequestPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamBYOBRequestPrototypeGetter_constructor, 0 } },
    { "view"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamBYOBRequestPrototypeGetter_view, 0 } },
    { "respond"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBRequestPrototypeFunction_respond, 1 } },
    { "respondWithNewView"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBRequestPrototypeFunction_respondWithNewView, 1 } },
};

const ClassInfo JSReadableStreamBYOBRequestPrototype::s_info = { "ReadableStreamBYOBRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBRequestPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBRequestPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSReadableStreamBYOBRequest>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "view"_s), thisObject->m_view.get() ? JSValue(thisObject->m_view.get()) : jsNull(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "controller"_s), thisObject->m_controller.get() ? JSValue(thisObject->m_controller.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ReadableStreamBYOBRequest"_s, data));
}

void JSReadableStreamBYOBRequestPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStreamBYOBRequest::info(), JSReadableStreamBYOBRequestPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsReadableStreamBYOBRequestPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSReadableStreamBYOBRequest

const ClassInfo JSReadableStreamBYOBRequest::s_info = { "ReadableStreamBYOBRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBRequest) };

JSReadableStreamBYOBRequest::JSReadableStreamBYOBRequest(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamBYOBRequest::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableStreamBYOBRequest* JSReadableStreamBYOBRequest::create(VM& vm, Structure* structure)
{
    auto* request = new (NotNull, allocateCell<JSReadableStreamBYOBRequest>(vm)) JSReadableStreamBYOBRequest(vm, structure);
    request->finishCreation(vm);
    return request;
}

Structure* JSReadableStreamBYOBRequest::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableStreamBYOBRequest::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableStreamBYOBRequestPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSReadableStreamBYOBRequestPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableStreamBYOBRequest::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableStreamBYOBRequest>(vm, globalObject);
}

JSValue JSReadableStreamBYOBRequest::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSReadableStreamBYOBRequestConstructor, DOMConstructorID::ReadableStreamBYOBRequest>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSReadableStreamBYOBRequest::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamBYOBRequest, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamBYOBRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamBYOBRequest = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamBYOBRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamBYOBRequest = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadableStreamBYOBRequest);

template<typename Visitor>
void JSReadableStreamBYOBRequest::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamBYOBRequest>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_controller);
    visitor.appendHidden(thisObject->m_view);
}

void JSReadableStreamBYOBRequest::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamBYOBRequest>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_controller, "controller"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_view, "view"_s);
}

// Prototype host functions

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamBYOBRequestPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSReadableStreamBYOBRequestPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSReadableStreamBYOBRequest::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamBYOBRequestPrototypeGetter_view, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* request = dynamicDowncast<JSReadableStreamBYOBRequest>(JSValue::decode(thisValue));
    if (!request) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStreamBYOBRequest"_s);
    JSArrayBufferView* view = request->m_view.get();
    return JSValue::encode(view ? JSValue(view) : jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBRequestPrototypeFunction_respond, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* request = dynamicDowncast<JSReadableStreamBYOBRequest>(callFrame->thisValue());
    if (!request) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStreamBYOBRequest"_s);

    uint64_t bytesWritten = convertToIntegerEnforceRange<uint64_t>(*lexicalGlobalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    if (!request->m_controller)
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: This BYOB request has been invalidated"_s);
    ASSERT(request->m_view);
    if (request->m_view->isDetached())
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot respond to a ReadableStreamBYOBRequest whose view has a detached ArrayBuffer"_s);
    ASSERT(request->m_view->byteLength() > 0);

    readableByteStreamControllerRespond(lexicalGlobalObject, request->m_controller.get(), bytesWritten);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBRequestPrototypeFunction_respondWithNewView, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* request = dynamicDowncast<JSReadableStreamBYOBRequest>(callFrame->thisValue());
    if (!request) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStreamBYOBRequest"_s);

    auto* view = dynamicDowncast<JSArrayBufferView>(callFrame->argument(0));
    if (!view)
        return Bun::ERR::INVALID_ARG_INSTANCE(scope, lexicalGlobalObject, "view"_s, "Buffer, TypedArray, or DataView"_s, callFrame->argument(0));

    if (!request->m_controller)
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: This BYOB request has been invalidated"_s);
    if (view->isDetached())
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot respond with a view whose ArrayBuffer is detached"_s);

    readableByteStreamControllerRespondWithNewView(lexicalGlobalObject, request->m_controller.get(), view);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
