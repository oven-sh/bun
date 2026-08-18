#include "config.h"
#include "JSTransformStreamDefaultController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSCompressionStream.h"
#include "JSDecompressionStream.h"
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

namespace Bun {
namespace WebStreams {

using namespace JSC;

// Null-safe: Bun's native-sink pumps clear a consumed stream's controller slot in their
// finally step, so a transform reaction (or an async transform()/flush() resuming after
// that teardown) can see a readable with no controller. A torn-down readable is terminal.
static JSReadableStreamDefaultController* transformReadableController(JSTransformStream* stream)
{
    const auto* readable = stream->m_readable.get();
    if (readable->m_controllerKind != ControllerKind::Default)
        return nullptr;
    return uncheckedDowncast<JSReadableStreamDefaultController>(readable->m_controller.get());
}

// The default [[transformAlgorithm]] (SetUpTransformStreamDefaultControllerFromTransformer step 2):
// "Let result be TransformStreamDefaultControllerEnqueue(controller, chunk). If result is an abrupt
// completion, return a promise rejected with result.[[Value]]. Otherwise a promise resolved with undefined."
static JSPromise* defaultTransformAlgorithm(JSC::VM& vm, JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(vm);
        transformStreamDefaultControllerEnqueue(globalObject, controller, chunk);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    });
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
            RELEASE_AND_RETURN(scope, invokeCallbackReturningPromise(globalObject, transformMethod, controller->m_transformer.get(), args));
        }
        break;
    case TransformerKind::Identity:
        break;
    case TransformerKind::TextEncoder:
        RELEASE_AND_RETURN(scope, runNativeArm<JSTextEncoderStream>(controller->m_algorithmContext.get(), [&](auto* s) { return textEncoderStreamTransform(globalObject, s, controller, chunk); }));
    case TransformerKind::TextDecoder:
        RELEASE_AND_RETURN(scope, runNativeArm<JSTextDecoderStream>(controller->m_algorithmContext.get(), [&](auto* s) { return textDecoderStreamTransform(globalObject, s, controller, chunk); }));
    case TransformerKind::Compression:
        RELEASE_AND_RETURN(scope, runNativeArm<JSCompressionStream>(controller->m_algorithmContext.get(), [&](auto* s) { return compressionStreamTransform(globalObject, s, controller, chunk); }));
    case TransformerKind::Decompression:
        RELEASE_AND_RETURN(scope, runNativeArm<JSDecompressionStream>(controller->m_algorithmContext.get(), [&](auto* s) { return decompressionStreamTransform(globalObject, s, controller, chunk); }));
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
        JSTransformStreamDefaultControllerPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSTransformStreamDefaultControllerPrototype))) JSTransformStreamDefaultControllerPrototype(vm, globalObject, structure);
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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
    JSValue thisValue = callFrame->thisValue().toThis(lexicalGlobalObject, JSC::ECMAMode::strict());
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
    Bun::reifyStaticPropertyTable(vm, JSTransformStreamDefaultController::info(), JSTransformStreamDefaultControllerPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTransformStreamDefaultControllerPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

template<> const ClassInfo JSTransformStreamDefaultControllerConstructor::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerConstructor) };

template<> JSValue JSTransformStreamDefaultControllerConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSTransformStreamDefaultControllerConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    initializeBaseProperties(vm, 0, "TransformStreamDefaultController"_s, JSTransformStreamDefaultController::prototype(vm, globalObject));
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
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
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
    return WebCore::subspaceForImpl<JSTransformStreamDefaultController, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTransformStreamDefaultController, m_subspaceForTransformStreamDefaultController));
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

extern "C" void CompressionStreamCoder__destroy(void*);
extern "C" void TextEncoderStreamEncoder__destroyForStream(void*);
extern "C" void TextDecoder__destroyForStream(void*);

// Drop the native coder/decoder now rather than waiting for the cell's finalizer: a
// CompressionStream's zlib/brotli/zstd state is hundreds of KB of window buffer, and
// finalizers run late (main-thread, typically only at full GC), so relying on them for
// this in a hot pipe loop lets native memory grow unbounded. The finalizer stays as an
// idempotent fallback for an abandoned stream that never reaches a terminal.
void nativeTransformReleaseState(JSTransformStream* stream)
{
    stream->m_nativeStateReleasePending = false;
    if (auto* s = dynamicDowncast<JSCompressionStream>(stream))
        CompressionStreamCoder__destroy(std::exchange(s->m_coder, nullptr));
    else if (auto* s = dynamicDowncast<JSDecompressionStream>(stream))
        CompressionStreamCoder__destroy(std::exchange(s->m_coder, nullptr));
    else if (auto* s = dynamicDowncast<JSTextEncoderStream>(stream))
        TextEncoderStreamEncoder__destroyForStream(std::exchange(s->m_encoder, nullptr));
    else if (auto* s = dynamicDowncast<JSTextDecoderStream>(stream))
        TextDecoder__destroyForStream(std::exchange(s->m_decoder, nullptr));
}

void nativeTransformReleaseStateIfIdle(JSTransformStream* stream)
{
    if (!stream->m_nativeStateReleasePending || stream->m_nativeStateInUse || stream->m_asyncCodecInFlight || stream->m_codecPromise)
        return;
    nativeTransformReleaseState(stream);
}

// ClearAlgorithms (post-flush, error, cancel) can reach a coder that is still busy: an arm on
// the stack, an off-thread step, or a chunk parked across turns (the close algorithm clears
// algorithms as soon as the flush arm returns). Whoever finishes that work releases it.
static void nativeTransformReleaseStateOrDefer(JSTransformStreamDefaultController* controller)
{
    auto* stream = dynamicDowncast<JSTransformStream>(controller->m_algorithmContext.get());
    if (!stream)
        return;
    stream->m_nativeStateReleasePending = true;
    nativeTransformReleaseStateIfIdle(stream);
}

void transformStreamDefaultControllerClearAlgorithms(JSTransformStreamDefaultController* controller)
{
    nativeTransformReleaseStateOrDefer(controller);
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
    readableStreamDefaultControllerEnqueue(globalObject, readableController, chunk);
    if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
        // Spec steps 4-5: "If enqueueResult is an abrupt completion, perform
        // ! TransformStreamErrorWritableAndUnblockWrite(stream, enqueueResult.[[Value]]) and throw
        // stream.[[readable]].[[storedError]]."
        TRY_CLEAR_EXCEPTION(scope, );
        transformStreamErrorWritableAndUnblockWrite(globalObject, stream, exception->value());
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
