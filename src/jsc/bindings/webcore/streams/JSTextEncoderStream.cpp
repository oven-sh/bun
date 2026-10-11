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
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>

// TextEncoderStreamEncoder.rs
extern "C" void* TextEncoderStreamEncoder__createForStream();
extern "C" void TextEncoderStreamEncoder__destroyForStream(void*);
extern "C" JSC::EncodedJSValue TextEncoderStreamEncoder__encodeForStream(void*, JSC::JSGlobalObject*, JSC::EncodedJSValue chunk);
extern "C" JSC::EncodedJSValue TextEncoderStreamEncoder__flushForStream(void*, JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue TextEncoderStreamEncoder__encodeIntoSink(void*, JSC::JSGlobalObject*, JSC::EncodedJSValue chunk, uint8_t sinkId, void* sinkPtr);
extern "C" JSC::EncodedJSValue TextEncoderStreamEncoder__flushIntoSink(void*, JSC::JSGlobalObject*, uint8_t sinkId, void* sinkPtr);

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
        JSTextEncoderStreamPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSTextEncoderStreamPrototype))) JSTextEncoderStreamPrototype(vm, structure);
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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
    return WebCore::subspaceForImpl<JSTextEncoderStreamConstructor, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTextEncoderStreamConstructor, m_subspaceForTextEncoderStreamConstructor));
}

template<> void JSTextEncoderStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeBaseProperties(vm, 0, "TextEncoderStream"_s, JSTextEncoderStream::prototype(vm, globalObject));
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
    stream->m_encoder = TextEncoderStreamEncoder__createForStream();
    vm.heap.addFinalizer(stream, static_cast<JSC::Heap::CFinalizer>([](JSCell* cell) {
        TextEncoderStreamEncoder__destroyForStream(std::exchange(static_cast<JSTextEncoderStream*>(cell)->m_encoder, nullptr));
    }));

    setUpNativeTransformStream(lexicalGlobalObject, stream, TransformerKind::TextEncoder);
    RETURN_IF_EXCEPTION(scope, {});

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
    Bun::putDirectNamed(vm, data, "encoding"_s, Bun::commonStrings(vm).utf8WithDashString());
    Bun::putDirectNamed(vm, data, "readable"_s, thisObject->m_readable.get() ? JSValue(thisObject->m_readable.get()) : jsUndefined());
    Bun::putDirectNamed(vm, data, "writable"_s, thisObject->m_writable.get() ? JSValue(thisObject->m_writable.get()) : jsUndefined());
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "TextEncoderStream"_s, data));
}

void JSTextEncoderStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSTextEncoderStream::info(), JSTextEncoderStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTextEncoderStreamPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

// JSTextEncoderStream

const ClassInfo JSTextEncoderStream::s_info = { "TextEncoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextEncoderStream) };

JSTextEncoderStream::JSTextEncoderStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSTextEncoderStream* JSTextEncoderStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSTextEncoderStream>(vm)) JSTextEncoderStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSTextEncoderStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
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
    return WebCore::subspaceForImpl<JSTextEncoderStream, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTextEncoderStream, m_subspaceForTextEncoderStream));
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
    return JSValue::encode(Bun::commonStrings(vm).utf8WithDashString());
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextEncoderStream"_s);
    return JSValue::encode(stream->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextEncoderStream"_s);
    return JSValue::encode(stream->m_writable.get());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSTextEncoderStream;

static void enqueueIfNonEmptyView(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue buffer)
{
    auto* view = dynamicDowncast<JSArrayBufferView>(buffer);
    if (!view || !view->length())
        return;
    transformStreamDefaultControllerEnqueue(globalObject, controller, buffer);
}

// Abrupt completions from encode (ToString runs user JS) OR enqueue become a rejected
// promise (a transform algorithm returns a promise; a throw is its rejection, never a synchronous
// throw into ProcessWrite/ProcessClose). When a native JSSink is attached (m_nativeSinkPtr), the
// encoder writes straight to it via its reusable scratch buffer (no JSUint8Array).
static JSPromise* encodeAndEnqueue(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk, bool flush)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        bool sinkBackpressure = false;
        if (void* sinkPtr = stream->m_nativeSinkPtr) {
            JSValue wrote = JSValue::decode(flush
                    ? TextEncoderStreamEncoder__flushIntoSink(stream->m_encoder, globalObject, stream->m_nativeSinkId, sinkPtr)
                    : TextEncoderStreamEncoder__encodeIntoSink(stream->m_encoder, globalObject, JSValue::encode(chunk), stream->m_nativeSinkId, sinkPtr));
            RETURN_IF_EXCEPTION(scope, nullptr);
            sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
        } else {
            JSValue buffer = JSValue::decode(flush
                    ? TextEncoderStreamEncoder__flushForStream(stream->m_encoder, globalObject)
                    : TextEncoderStreamEncoder__encodeForStream(stream->m_encoder, globalObject, JSValue::encode(chunk)));
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (!buffer.isEmpty()) {
                enqueueIfNonEmptyView(globalObject, controller, buffer);
                RETURN_IF_EXCEPTION(scope, nullptr);
            }
        }
        if (sinkBackpressure) {
            auto* ready = JSPromise::create(vm, globalObject->promiseStructure());
            stream->m_nativeSinkReadyPromise.set(vm, stream, ready);
            return ready;
        }
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    });
}

JSPromise* textEncoderStreamTransform(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return encodeAndEnqueue(globalObject, stream, controller, chunk, false);
}

JSPromise* textEncoderStreamFlush(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller)
{
    return encodeAndEnqueue(globalObject, stream, controller, jsUndefined(), true);
}

} // namespace WebStreams
} // namespace Bun
