#include "root.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>
#include "JSAbortController.h"

#include "BunWritableStreamDefaultController.h"
#include "BunWritableStream.h"
#include "JSAbortSignal.h"
#include "IDLTypes.h"
#include "JSDOMBinding.h"

namespace Bun {

class JSWritableStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSWritableStreamDefaultControllerPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWritableStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultControllerPrototype>(vm)) JSWritableStreamDefaultControllerPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultControllerPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSWritableStreamDefaultControllerConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    static JSWritableStreamDefaultControllerConstructor* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure,
        JSWritableStreamDefaultControllerPrototype* prototype);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSGlobalObject*, CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSGlobalObject*, CallFrame*);

    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWritableStreamDefaultControllerConstructor,
            WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForStreamConstructor.get(); },
            [](auto& spaces, auto&& space) {
                spaces.m_clientSubspaceForStreamConstructor = std::forward<decltype(space)>(space);
            },
            [](auto& spaces) { return spaces.m_subspaceForStreamConstructor.get(); },
            [](auto& spaces, auto&& space) {
                spaces.m_subspaceForStreamConstructor = std::forward<decltype(space)>(space);
            });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultControllerConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSWritableStreamDefaultControllerPrototype*);
};

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultControllerErrorFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultController* controller = jsDynamicCast<JSWritableStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller)) {
        scope.throwException(globalObject, createTypeError(globalObject, "WritableStreamDefaultController.prototype.error called on non-WritableStreamDefaultController"_s));
        return {};
    }

    return JSValue::encode(controller->error(callFrame->argument(0)));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultControllerGetSignal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSWritableStreamDefaultController*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        scope.throwException(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultController.prototype.signal called on non-WritableStreamDefaultController"_s));
        return {};
    }

    return JSValue::encode(thisObject->abortSignal());
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultControllerGetDesiredSize, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSWritableStreamDefaultController*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        scope.throwException(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultController.prototype.desiredSize called on non-WritableStreamDefaultController"_s));
        return {};
    }

    switch (thisObject->stream()->state()) {
    case JSWritableStream::State::Errored:
        return JSValue::encode(jsNull());
    case JSWritableStream::State::Closed:
        return JSValue::encode(jsNumber(0));
    default:
        return JSValue::encode(jsNumber(thisObject->getDesiredSize()));
    }
}

static const HashTableValue JSWritableStreamDefaultControllerPrototypeTableValues[] = {
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultControllerErrorFunction, 1 } },
    { "signal"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultControllerGetSignal, 0 } },
};

void JSWritableStreamDefaultControllerPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStreamDefaultController::info(), JSWritableStreamDefaultControllerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const JSC::ClassInfo JSWritableStreamDefaultControllerPrototype::s_info = {
    "WritableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultControllerPrototype)
};

// JSWritableStreamDefaultController.cpp

JSWritableStreamDefaultController* JSWritableStreamDefaultController::create(
    JSC::VM& vm,
    JSC::Structure* structure,
    JSWritableStream* stream,
    double highWaterMark,
    JSC::JSObject* underlyingSinkObj)
{
    JSWritableStreamDefaultController* controller = new (
        NotNull, JSC::allocateCell<JSWritableStreamDefaultController>(vm))
        JSWritableStreamDefaultController(vm, structure);

    controller->finishCreation(vm);
    return controller;
}

void JSWritableStreamDefaultController::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    m_queue.set(vm, JSC::constructEmptyArray(vm, nullptr));
    m_abortController.set(vm, WebCore::JSAbortController::create(vm, nullptr, nullptr));
}

JSC::JSValue JSWritableStreamDefaultController::abortSignal() const
{
    auto& vm = this->globalObject()->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    return WebCore::toJS<WebCore::IDLInterface<WebCore::AbortSignal>>(this->globalObject(), defaultGlobalObject(this->globalObject()), throwScope, m_abortController->wrapped().signal());
}

JSC::JSValue JSWritableStreamDefaultController::error(JSC::JSValue reason)
{
    auto* globalObject = JSC::jsCast<JSC::JSGlobalObject*>(m_stream->globalObject());
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_stream->state() != JSWritableStream::State::Writable)
        return JSC::jsUndefined();

    performWritableStreamDefaultControllerError(this, reason);

    RELEASE_AND_RETURN(scope, JSC::jsUndefined());
}

bool JSWritableStreamDefaultController::shouldCallWrite() const
{
    if (!m_started)
        return false;

    if (m_writing)
        return false;

    if (m_inFlightWriteRequest)
        return false;

    if (m_stream->state() != JSWritableStream::State::Writable)
        return false;

    return true;
}

double JSWritableStreamDefaultController::getDesiredSize() const
{
    return m_strategyHWM - m_queueTotalSize;
}

template<typename Visitor>
void JSWritableStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSWritableStreamDefaultController* thisObject = jsCast<JSWritableStreamDefaultController*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

template<typename Visitor>
void JSWritableStreamDefaultController::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_stream);
    visitor.append(m_abortAlgorithm);
    visitor.append(m_closeAlgorithm);
    visitor.append(m_writeAlgorithm);
    visitor.append(m_strategySizeAlgorithm);
    visitor.append(m_queue);
    visitor.append(m_abortController);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultController);
DEFINE_VISIT_ADDITIONAL_CHILDREN(JSWritableStreamDefaultController);

const JSC::ClassInfo JSWritableStreamDefaultController::s_info = {
    "WritableStreamDefaultController"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultController)
};
}
