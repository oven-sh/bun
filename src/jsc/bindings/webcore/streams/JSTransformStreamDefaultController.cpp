#include "config.h"
#include "JSTransformStreamDefaultController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultController.h"
#include "JSStreamsRuntime.h"
#include "JSTextDecoderStream.h"
#include "JSTextEncoderStream.h"
#include "JSTransformStream.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"

#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

// The default [[transformAlgorithm]]: enqueue the chunk unchanged; the enqueue's abrupt
// completion becomes a rejected promise (a sanctioned completion-record catch).
static JSPromise* defaultTransformAlgorithm(JSC::VM& vm, JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        transformStreamDefaultControllerEnqueue(globalObject, controller, chunk);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    // takeAbruptCompletion leaves a VM termination pending and returns the empty value.
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

// The [[transformAlgorithm]] dispatch; the switch is total over TransformerKind.
static JSPromise* performTransformAlgorithm(JSC::VM& vm, JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_transformerKind) {
    case TransformerKind::JavaScript:
        if (JSObject* transformMethod = controller->m_transformMethod.get()) {
            MarkedArgumentBuffer args;
            args.append(chunk);
            args.append(controller);
            if (args.hasOverflowed()) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return nullptr;
            }
            RELEASE_AND_RETURN(scope, invokePromiseReturningMethod(vm, globalObject, transformMethod, controller->m_transformer.get(), args));
        }
        break;
    case TransformerKind::Identity:
        break;
    case TransformerKind::TextEncoder:
        RELEASE_AND_RETURN(scope, textEncoderStreamTransform(globalObject, uncheckedDowncast<JSTextEncoderStream>(controller->m_algorithmContext.get()), controller, chunk));
    case TransformerKind::TextDecoder:
        RELEASE_AND_RETURN(scope, textDecoderStreamTransform(globalObject, uncheckedDowncast<JSTextDecoderStream>(controller->m_algorithmContext.get()), controller, chunk));
    }
    RELEASE_AND_RETURN(scope, defaultTransformAlgorithm(vm, globalObject, controller, chunk));
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamDefaultControllerConstructorGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamDefaultControllerPrototypeGetter_desiredSize);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototypeFunction_enqueue);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototypeFunction_error);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototypeFunction_terminate);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototype_inspectCustom);

class JSTransformStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSTransformStreamDefaultControllerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSTransformStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultControllerPrototype>(vm)) JSTransformStreamDefaultControllerPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSTransformStreamDefaultControllerPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamDefaultControllerPrototype, JSTransformStreamDefaultControllerPrototype::Base);

static const HashTableValue JSTransformStreamDefaultControllerPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsTransformStreamDefaultControllerConstructorGetter, 0 } },
    { "desiredSize"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor, NoIntrinsic, { HashTableValue::GetterSetterType, jsTransformStreamDefaultControllerPrototypeGetter_desiredSize, 0 } },
    { "enqueue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerPrototypeFunction_enqueue, 0 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerPrototypeFunction_error, 0 } },
    { "terminate"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerPrototypeFunction_terminate, 0 } },
};

const ClassInfo JSTransformStreamDefaultControllerPrototype::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSTransformStreamDefaultController>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "stream"_s), thisObject->m_stream.get() ? JSValue(thisObject->m_stream.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "TransformStreamDefaultController"_s, data));
}

void JSTransformStreamDefaultControllerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSTransformStreamDefaultController::info(), JSTransformStreamDefaultControllerPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTransformStreamDefaultControllerPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

template<> const ClassInfo JSTransformStreamDefaultControllerConstructor::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerConstructor) };

template<> JSValue JSTransformStreamDefaultControllerConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSTransformStreamDefaultControllerConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "TransformStreamDefaultController"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSTransformStreamDefaultController::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

const ClassInfo JSTransformStreamDefaultController::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultController) };

JSTransformStreamDefaultController::JSTransformStreamDefaultController(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSTransformStreamDefaultController::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSTransformStreamDefaultController* JSTransformStreamDefaultController::create(VM& vm, Structure* structure)
{
    auto* controller = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultController>(vm)) JSTransformStreamDefaultController(vm, structure);
    controller->finishCreation(vm);
    return controller;
}

Structure* JSTransformStreamDefaultController::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSTransformStreamDefaultController::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSTransformStreamDefaultControllerPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSTransformStreamDefaultControllerPrototype::create(vm, &globalObject, structure);
}

JSObject* JSTransformStreamDefaultController::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSTransformStreamDefaultController>(vm, globalObject);
}

JSValue JSTransformStreamDefaultController::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSTransformStreamDefaultControllerConstructor, DOMConstructorID::TransformStreamDefaultController>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSTransformStreamDefaultController::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSTransformStreamDefaultController, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForTransformStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTransformStreamDefaultController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForTransformStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForTransformStreamDefaultController = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSTransformStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTransformStreamDefaultController>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_finishPromise);
    visitor.appendHidden(thisObject->m_transformer);
    visitor.appendHidden(thisObject->m_transformMethod);
    visitor.appendHidden(thisObject->m_flushMethod);
    visitor.appendHidden(thisObject->m_cancelMethod);
    visitor.appendHidden(thisObject->m_algorithmContext);
}

DEFINE_VISIT_CHILDREN(JSTransformStreamDefaultController);

void JSTransformStreamDefaultController::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSTransformStreamDefaultController>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_finishPromise, "finishPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_transformer, "transformer"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_transformMethod, "transformAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_flushMethod, "flushAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_cancelMethod, "cancelAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithmContext, "algorithmContext"_s);
}

// [reaction-convention]: handler(resolutionValue, contextCell).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSPerformTransformRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue rejection = callFrame->argument(0);
    const auto* controller = uncheckedDowncast<JSTransformStreamDefaultController>(callFrame->argument(1));
    transformStreamError(globalObject, controller->m_stream.get(), rejection);
    RETURN_IF_EXCEPTION(scope, {});
    throwException(globalObject, scope, rejection);
    return {};
}

// Prototype accessors & methods.

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamDefaultControllerConstructorGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSTransformStreamDefaultControllerPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(globalObject, scope);
    return JSValue::encode(JSTransformStreamDefaultController::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamDefaultControllerPrototypeGetter_desiredSize, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* thisObject = dynamicDowncast<JSTransformStreamDefaultController>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "TransformStreamDefaultController"_s);
    auto* readableController = transformReadableController(thisObject->m_stream.get());
    if (!readableController)
        return JSValue::encode(jsNull());
    std::optional<double> desiredSize = readableStreamDefaultControllerGetDesiredSize(readableController);
    if (!desiredSize)
        return JSValue::encode(jsNull());
    return JSValue::encode(jsNumber(*desiredSize));
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototypeFunction_enqueue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSTransformStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "TransformStreamDefaultController"_s);
    transformStreamDefaultControllerEnqueue(globalObject, thisObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototypeFunction_error, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSTransformStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "TransformStreamDefaultController"_s);
    transformStreamDefaultControllerError(globalObject, thisObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerPrototypeFunction_terminate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSTransformStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "TransformStreamDefaultController"_s);
    transformStreamDefaultControllerTerminate(globalObject, thisObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using namespace WebCore;

void transformStreamDefaultControllerClearAlgorithms(JSTransformStreamDefaultController* controller)
{
    controller->m_transformerKind = TransformerKind::Identity;
    controller->m_transformer.clear();
    controller->m_transformMethod.clear();
    controller->m_flushMethod.clear();
    controller->m_cancelMethod.clear();
    controller->m_algorithmContext.clear();
}

void transformStreamDefaultControllerEnqueue(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = controller->m_stream.get();
    auto* readableController = transformReadableController(stream);
    if (!readableController || !readableStreamDefaultControllerCanCloseOrEnqueue(readableController)) {
        throwTypeError(globalObject, scope, "Cannot enqueue a chunk into a TransformStream whose readable side is closed or has already requested close"_s);
        return;
    }
    JSValue thrown;
    {
        // The readable-side enqueue interpreted as a completion record (a sanctioned
        // completion-record catch): an abrupt completion errors the WRITABLE side and
        // rethrows the readable's stored error.
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        readableStreamDefaultControllerEnqueue(globalObject, readableController, chunk);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    // takeAbruptCompletion leaves a VM termination pending and returns the empty value.
    RETURN_IF_EXCEPTION(scope, void());
    if (!thrown.isEmpty()) [[unlikely]] {
        transformStreamErrorWritableAndUnblockWrite(globalObject, stream, thrown);
        RETURN_IF_EXCEPTION(scope, void());
        // The readable is not necessarily Errored here: the user size() callback may have
        // closed it before throwing, leaving [[storedError]] unset — then we throw undefined.
        JSValue storedError = stream->m_readable.get()->m_storedError.get();
        throwException(globalObject, scope, storedError ? storedError : jsUndefined());
        return;
    }
    bool backpressure = readableStreamDefaultControllerHasBackpressure(readableController);
    if (backpressure != stream->m_backpressure) {
        ASSERT(backpressure);
        RELEASE_AND_RETURN(scope, transformStreamSetBackpressure(globalObject, stream, true));
    }
}

void transformStreamDefaultControllerError(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, transformStreamError(globalObject, controller->m_stream.get(), error));
}

JSPromise* transformStreamDefaultControllerPerformTransform(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSPromise* transformPromise = performTransformAlgorithm(vm, globalObject, controller, chunk);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    auto* runtime = JSStreamsRuntime::from(globalObject);
    transformPromise->performPromiseThenWithContext(vm, globalObject, jsUndefined(), runtime->onTSPerformTransformRejected(), result, controller);
    return result;
}

void transformStreamDefaultControllerTerminate(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = controller->m_stream.get();
    if (auto* readableController = transformReadableController(stream)) {
        readableStreamDefaultControllerClose(globalObject, readableController);
        RETURN_IF_EXCEPTION(scope, void());
    }
    JSObject* error = createTypeError(globalObject, "The TransformStream has been terminated"_s);
    RELEASE_AND_RETURN(scope, transformStreamErrorWritableAndUnblockWrite(globalObject, stream, error));
}

} // namespace WebStreams
} // namespace Bun
