#include "config.h"
#include "JSTextEncoderStream.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSStreamsRuntime.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSWritableStream.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_encoding);
static JSC_DECLARE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_readable);
static JSC_DECLARE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_writable);
static JSC_DECLARE_HOST_FUNCTION(jsTextEncoderStreamPrototype_inspectCustom);

class JSTextEncoderStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSTextEncoderStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSTextEncoderStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSTextEncoderStreamPrototype>(vm)) JSTextEncoderStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTextEncoderStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSTextEncoderStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTextEncoderStreamPrototype, JSTextEncoderStreamPrototype::Base);

// JSTextEncoderStreamConstructor = JSStreamConstructor<JSTextEncoderStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTextEncoderStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSTextEncoderStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSTextEncoderStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSTextEncoderStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSTextEncoderStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSTextEncoderStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSTextEncoderStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSTextEncoderStreamConstructor::s_info = { "TextEncoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextEncoderStreamConstructor) };

template<> JSValue JSTextEncoderStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSTextEncoderStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTextEncoderStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSTextEncoderStreamConstructor);

template<> GCClient::IsoSubspace* JSTextEncoderStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSTextEncoderStreamConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForTextEncoderStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTextEncoderStreamConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForTextEncoderStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForTextEncoderStreamConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSTextEncoderStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "TextEncoderStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSTextEncoderStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSTextEncoderStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTextEncoderStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSTextEncoderStreamConstructor>(callFrame->jsCallee());

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* stream = JSTextEncoderStream::create(vm, structure);

    // The existing native TextEncoderStreamEncoder owns the lone-surrogate buffering.
    MarkedArgumentBuffer noArguments;
    auto* encoder = JSC::construct(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject)->JSTextEncoderStreamEncoderConstructor(), noArguments, "TextEncoderStreamEncoder is not constructible"_s);
    RETURN_IF_EXCEPTION(scope, {});
    stream->m_encoder.set(vm, stream, encoder);

    auto* transform = createTransformStream(lexicalGlobalObject, TransformerKind::TextEncoder, stream, 1, nullptr, 0, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    stream->m_transform.set(vm, stream, transform);

    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSTextEncoderStreamConstructorConstruct, JSTextEncoderStreamConstructor::construct);

// JSTextEncoderStreamPrototype

static const HashTableValue JSTextEncoderStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextEncoderStreamPrototypeGetter_constructor, 0 } },
    { "encoding"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextEncoderStreamPrototypeGetter_encoding, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextEncoderStreamPrototypeGetter_readable, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextEncoderStreamPrototypeGetter_writable, 0 } },
};

const ClassInfo JSTextEncoderStreamPrototype::s_info = { "TextEncoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextEncoderStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsTextEncoderStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSTextEncoderStream>(thisValue);
    // Node brand-checks here (lib/internal/webstreams/encoding.js) — unlike its other web
    // streams classes, whose inspect methods just fault on a bad `this`.
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextEncoderStream"_s);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "encoding"_s), jsNontrivialString(vm, "utf-8"_s), 0);
    auto* transform = thisObject->m_transform.get();
    data->putDirect(vm, Identifier::fromString(vm, "readable"_s), transform && transform->m_readable.get() ? JSValue(transform->m_readable.get()) : jsUndefined(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "writable"_s), transform && transform->m_writable.get() ? JSValue(transform->m_writable.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "TextEncoderStream"_s, data));
}

void JSTextEncoderStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSTextEncoderStream::info(), JSTextEncoderStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTextEncoderStreamPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSTextEncoderStream

const ClassInfo JSTextEncoderStream::s_info = { "TextEncoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextEncoderStream) };

JSTextEncoderStream::JSTextEncoderStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSTextEncoderStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSTextEncoderStream* JSTextEncoderStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSTextEncoderStream>(vm)) JSTextEncoderStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSTextEncoderStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSTextEncoderStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSTextEncoderStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSTextEncoderStreamPrototype::create(vm, &globalObject, structure);
}

JSObject* JSTextEncoderStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSTextEncoderStream>(vm, globalObject);
}

JSValue JSTextEncoderStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSTextEncoderStreamConstructor, DOMConstructorID::TextEncoderStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSTextEncoderStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSTextEncoderStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForTextEncoderStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTextEncoderStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForTextEncoderStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForTextEncoderStream = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSTextEncoderStream);

template<typename Visitor>
void JSTextEncoderStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTextEncoderStream>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_transform);
    visitor.appendHidden(thisObject->m_encoder);
}

void JSTextEncoderStream::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSTextEncoderStream>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_transform, "transform"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_encoder, "encoder"_s);
}

// Prototype accessors

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSTextEncoderStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSTextEncoderStream::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_encoding, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextEncoderStream"_s);
    return JSValue::encode(jsNontrivialString(vm, "utf-8"_s));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextEncoderStream"_s);
    return JSValue::encode(stream->m_transform->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextEncoderStream"_s);
    return JSValue::encode(stream->m_transform->m_writable.get());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSTextEncoderStream;

// `encoder.encode(chunk)` / `encoder.flush()` on the TextEncoderStreamEncoder cell. The
// encode arm runs user JS (ToString of the chunk). Empty return = it threw.
static JSValue invokeEncoderMethod(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* encoder, const Identifier& methodName, const MarkedArgumentBuffer& args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = encoder->get(globalObject, methodName);
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = getCallData(method);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "TextEncoderStreamEncoder method is not callable"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, call(globalObject, method, callData, encoder, args));
}

static void enqueueIfNonEmptyView(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue buffer)
{
    auto* view = dynamicDowncast<JSArrayBufferView>(buffer);
    if (!view || !view->length())
        return;
    transformStreamDefaultControllerEnqueue(globalObject, controller, buffer);
}

// An abrupt encode OR enqueue completion becomes a rejected promise (a transform algorithm
// must never throw synchronously into ProcessWrite/ProcessClose — the in-flight operation
// would never settle). Shared by the transform and flush arms.
static JSPromise* encodeAndEnqueue(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller, const Identifier& methodName, const MarkedArgumentBuffer& args)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue buffer = invokeEncoderMethod(vm, globalObject, stream->m_encoder.get(), methodName, args);
        if (!catchScope.exception() && !buffer.isEmpty())
            enqueueIfNonEmptyView(globalObject, controller, buffer);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    // takeAbruptCompletion leaves a VM termination pending and returns the empty value.
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

JSPromise* textEncoderStreamTransform(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    MarkedArgumentBuffer args;
    args.append(chunk);
    ASSERT(!args.hasOverflowed());
    return encodeAndEnqueue(globalObject, stream, controller, builtinNames(getVM(globalObject)).encodePublicName(), args);
}

JSPromise* textEncoderStreamFlush(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller)
{
    MarkedArgumentBuffer noArguments;
    return encodeAndEnqueue(globalObject, stream, controller, builtinNames(getVM(globalObject)).flushPublicName(), noArguments);
}

} // namespace WebStreams
} // namespace Bun
