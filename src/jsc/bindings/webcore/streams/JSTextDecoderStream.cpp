#include "config.h"
#include "JSTextDecoderStream.h"

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
#include "headers-handwritten.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>

// TextDecoder.rs
extern "C" void* TextDecoder__createForStream(JSC::JSGlobalObject*, JSC::EncodedJSValue label, bool fatal, bool ignoreBOM, bool* outUtf8FastPath, uint8_t* outEncoding);
extern "C" JSC::EncodedJSValue TextDecoder__encodingToJS(JSC::JSGlobalObject*, uint8_t encoding);
extern "C" void TextDecoder__destroyForStream(void*);
extern "C" JSC::EncodedJSValue TextDecoder__decodeForStream(void*, JSC::JSGlobalObject*, const uint8_t* input, size_t inputLen, bool stream);

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_encoding);
static JSC_DECLARE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_fatal);
static JSC_DECLARE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_ignoreBOM);
static JSC_DECLARE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_readable);
static JSC_DECLARE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_writable);
static JSC_DECLARE_HOST_FUNCTION(jsTextDecoderStreamPrototype_inspectCustom);

class JSTextDecoderStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSTextDecoderStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSTextDecoderStreamPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSTextDecoderStreamPrototype))) JSTextDecoderStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTextDecoderStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSTextDecoderStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTextDecoderStreamPrototype, JSTextDecoderStreamPrototype::Base);

// JSTextDecoderStreamConstructor = JSStreamConstructor<JSTextDecoderStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTextDecoderStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSTextDecoderStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSTextDecoderStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSTextDecoderStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSTextDecoderStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSTextDecoderStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSTextDecoderStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSTextDecoderStreamConstructor::s_info = { "TextDecoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextDecoderStreamConstructor) };

template<> JSValue JSTextDecoderStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSTextDecoderStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTextDecoderStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSTextDecoderStreamConstructor);

template<> GCClient::IsoSubspace* JSTextDecoderStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSTextDecoderStreamConstructor, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTextDecoderStreamConstructor, m_subspaceForTextDecoderStreamConstructor));
}

template<> void JSTextDecoderStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeBaseProperties(vm, 0, "TextDecoderStream"_s, JSTextDecoderStream::prototype(vm, globalObject));
    m_instanceStructure.set(vm, this, getDOMStructure<JSTextDecoderStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTextDecoderStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSTextDecoderStreamConstructor>(callFrame->jsCallee());
    auto& names = builtinNames(vm);

    JSValue label = callFrame->argument(0);
    bool fatal = false;
    bool ignoreBOM = false;
    JSValue options = callFrame->argument(1);
    // Web IDL: `optional TextDecoderOptions options = {}` — undefined/null mean defaults, and
    // any other non-object is a TypeError (Node reports it as ERR_INVALID_ARG_TYPE, matching
    // what `new TextDecoder(label, options)` itself throws for the same value).
    if (!options.isUndefinedOrNull()) {
        if (!options.isObject())
            return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options"_s, "object"_s, options);
        JSValue fatalValue = options.get(lexicalGlobalObject, names.fatalPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        fatal = fatalValue.toBoolean(lexicalGlobalObject);
        JSValue ignoreBOMValue = options.get(lexicalGlobalObject, names.ignoreBOMPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        ignoreBOM = ignoreBOMValue.toBoolean(lexicalGlobalObject);
    }

    // Validates label (WebIDL DOMString coercion — may run user JS). For utf-8 + !fatal no
    // Rust decoder is allocated: the transform/flush arms use streamingUTF8Decode instead.
    bool utf8FastPath = false;
    uint8_t encoding = 0;
    void* decoder = TextDecoder__createForStream(lexicalGlobalObject, JSValue::encode(label), fatal, ignoreBOM, &utf8FastPath, &encoding);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(utf8FastPath == !decoder);

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    if (scope.exception()) [[unlikely]] {
        TextDecoder__destroyForStream(decoder);
        return {};
    }
    auto* stream = JSTextDecoderStream::create(vm, structure);
    stream->m_decoder = decoder;
    stream->m_encoding = encoding;
    stream->m_fatal = fatal;
    stream->m_ignoreBOM = ignoreBOM;
    if (utf8FastPath)
        stream->m_utf8State.bomSeen = ignoreBOM;
    else
        vm.heap.addFinalizer(stream, static_cast<JSC::Heap::CFinalizer>([](JSCell* cell) {
            TextDecoder__destroyForStream(std::exchange(static_cast<JSTextDecoderStream*>(cell)->m_decoder, nullptr));
        }));

    setUpNativeTransformStream(lexicalGlobalObject, stream, TransformerKind::TextDecoder);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSTextDecoderStreamConstructorConstruct, JSTextDecoderStreamConstructor::construct);

// JSTextDecoderStreamPrototype

static const HashTableValue JSTextDecoderStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextDecoderStreamPrototypeGetter_constructor, 0 } },
    { "encoding"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextDecoderStreamPrototypeGetter_encoding, 0 } },
    { "fatal"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextDecoderStreamPrototypeGetter_fatal, 0 } },
    { "ignoreBOM"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextDecoderStreamPrototypeGetter_ignoreBOM, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextDecoderStreamPrototypeGetter_readable, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTextDecoderStreamPrototypeGetter_writable, 0 } },
};

const ClassInfo JSTextDecoderStreamPrototype::s_info = { "TextDecoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextDecoderStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsTextDecoderStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSTextDecoderStream>(thisValue);
    // Node brand-checks here (lib/internal/webstreams/encoding.js) — unlike its other web
    // streams classes, whose inspect methods just fault on a bad `this`.
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextDecoderStream"_s);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    Bun::putDirectNamed(vm, data, "encoding"_s, JSValue::decode(TextDecoder__encodingToJS(lexicalGlobalObject, thisObject->m_encoding)));
    Bun::putDirectNamed(vm, data, "fatal"_s, jsBoolean(thisObject->m_fatal));
    Bun::putDirectNamed(vm, data, "ignoreBOM"_s, jsBoolean(thisObject->m_ignoreBOM));
    Bun::putDirectNamed(vm, data, "readable"_s, thisObject->m_readable.get() ? JSValue(thisObject->m_readable.get()) : jsUndefined());
    Bun::putDirectNamed(vm, data, "writable"_s, thisObject->m_writable.get() ? JSValue(thisObject->m_writable.get()) : jsUndefined());
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "TextDecoderStream"_s, data));
}

void JSTextDecoderStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSTextDecoderStream::info(), JSTextDecoderStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTextDecoderStreamPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

// JSTextDecoderStream

const ClassInfo JSTextDecoderStream::s_info = { "TextDecoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextDecoderStream) };

JSTextDecoderStream::JSTextDecoderStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSTextDecoderStream* JSTextDecoderStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSTextDecoderStream>(vm)) JSTextDecoderStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSTextDecoderStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSTextDecoderStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSTextDecoderStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSTextDecoderStreamPrototype::create(vm, &globalObject, structure);
}

JSObject* JSTextDecoderStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSTextDecoderStream>(vm, globalObject);
}

JSValue JSTextDecoderStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSTextDecoderStreamConstructor, DOMConstructorID::TextDecoderStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSTextDecoderStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSTextDecoderStream, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTextDecoderStream, m_subspaceForTextDecoderStream));
}

// Prototype accessors

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSTextDecoderStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSTextDecoderStream::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_encoding, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextDecoderStream"_s, "encoding"_s);
    RELEASE_AND_RETURN(scope, TextDecoder__encodingToJS(lexicalGlobalObject, stream->m_encoding));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_fatal, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextDecoderStream"_s, "fatal"_s);
    return JSValue::encode(jsBoolean(stream->m_fatal));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_ignoreBOM, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextDecoderStream"_s, "ignoreBOM"_s);
    return JSValue::encode(jsBoolean(stream->m_ignoreBOM));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextDecoderStream"_s);
    return JSValue::encode(stream->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextDecoderStream"_s);
    return JSValue::encode(stream->m_writable.get());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSTextDecoderStream;

// [AllowShared] BufferSource → (ptr, len); a detached buffer yields the empty sequence.
static std::optional<std::span<const uint8_t>> textDecoderStreamBytes(JSGlobalObject* globalObject, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk)) {
        if (view->isDetached()) [[unlikely]]
            return std::span<const uint8_t>();
        return std::span<const uint8_t>(static_cast<const uint8_t*>(view->vector()), view->byteLength());
    }
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(chunk)) {
        auto* impl = buffer->impl();
        if (!impl || impl->isDetached()) [[unlikely]]
            return std::span<const uint8_t>();
        return std::span<const uint8_t>(static_cast<const uint8_t*>(impl->data()), impl->byteLength());
    }
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
    return std::nullopt;
}

// The transform/flush algorithms return a promise, so a throw from decode or enqueue is that
// promise's rejection (promiseFromSteps), never a synchronous throw into ProcessWrite/ProcessClose.
static void decodeAndEnqueue(JSGlobalObject* globalObject, JSTextDecoderStream* stream, JSTransformStreamDefaultController* controller, const uint8_t* input, size_t inputLen, bool streaming)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue decoded;
    if (stream->m_decoder) {
        decoded = JSValue::decode(TextDecoder__decodeForStream(stream->m_decoder, globalObject, input, inputLen, streaming));
    } else {
        auto* s = streamingUTF8Decode(globalObject, std::span<const uint8_t> { input, inputLen }, stream->m_utf8State, /* flush */ !streaming);
        decoded = s ? JSValue(s) : jsUndefined();
    }
    RETURN_IF_EXCEPTION(scope, );
    if (decoded.isString() && asString(decoded)->length())
        RELEASE_AND_RETURN(scope, transformStreamDefaultControllerEnqueue(globalObject, controller, decoded));
}

JSPromise* textDecoderStreamTransform(JSGlobalObject* globalObject, JSTextDecoderStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        std::optional<std::span<const uint8_t>> bytes = textDecoderStreamBytes(globalObject, chunk);
        RETURN_IF_EXCEPTION(scope, nullptr);
        decodeAndEnqueue(globalObject, stream, controller, bytes->data(), bytes->size(), true);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    });
}

JSPromise* textDecoderStreamFlush(JSGlobalObject* globalObject, JSTextDecoderStream* stream, JSTransformStreamDefaultController* controller)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        decodeAndEnqueue(globalObject, stream, controller, nullptr, 0, false);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    });
}

} // namespace WebStreams
} // namespace Bun
