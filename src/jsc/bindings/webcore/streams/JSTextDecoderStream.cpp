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
        JSTextDecoderStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSTextDecoderStreamPrototype>(vm)) JSTextDecoderStreamPrototype(vm, structure);
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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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
    return WebCore::subspaceForImpl<JSTextDecoderStreamConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForTextDecoderStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTextDecoderStreamConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForTextDecoderStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForTextDecoderStreamConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSTextDecoderStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "TextDecoderStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSTextDecoderStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSTextDecoderStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTextDecoderStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSTextDecoderStreamConstructor>(callFrame->jsCallee());
    auto& names = builtinNames(vm);

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* stream = JSTextDecoderStream::create(vm, structure);

    auto* transform = createTransformStream(lexicalGlobalObject, TransformerKind::TextDecoder, stream, 1, nullptr, 0, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    stream->m_transform.set(vm, stream, transform);

    JSValue label = callFrame->argumentCount() >= 1 ? callFrame->uncheckedArgument(0) : jsNontrivialString(vm, "utf-8"_s);
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

    // `new TextDecoder(label, { fatal, ignoreBOM })` owns the label validation.
    auto* decoderOptions = constructEmptyObject(lexicalGlobalObject);
    decoderOptions->putDirect(vm, names.fatalPublicName(), jsBoolean(fatal));
    decoderOptions->putDirect(vm, names.ignoreBOMPublicName(), jsBoolean(ignoreBOM));
    MarkedArgumentBuffer decoderArguments;
    decoderArguments.append(label);
    decoderArguments.append(decoderOptions);
    ASSERT(!decoderArguments.hasOverflowed());
    auto* decoder = JSC::construct(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject)->JSTextDecoderConstructor(), decoderArguments, "TextDecoder is not constructible"_s);
    RETURN_IF_EXCEPTION(scope, {});
    stream->m_decoder.set(vm, stream, decoder);

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
    // encoding/fatal/ignoreBOM live on the TextDecoder held by m_decoder; read them via the
    // public prototype getters this class already exposes so no extra coupling is introduced.
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    JSValue encoding = thisObject->get(lexicalGlobalObject, Identifier::fromString(vm, "encoding"_s));
    RETURN_IF_EXCEPTION(scope, {});
    data->putDirect(vm, Identifier::fromString(vm, "encoding"_s), encoding, 0);
    JSValue fatal = thisObject->get(lexicalGlobalObject, Identifier::fromString(vm, "fatal"_s));
    RETURN_IF_EXCEPTION(scope, {});
    data->putDirect(vm, Identifier::fromString(vm, "fatal"_s), fatal, 0);
    JSValue ignoreBOM = thisObject->get(lexicalGlobalObject, Identifier::fromString(vm, "ignoreBOM"_s));
    RETURN_IF_EXCEPTION(scope, {});
    data->putDirect(vm, Identifier::fromString(vm, "ignoreBOM"_s), ignoreBOM, 0);
    auto* transform = thisObject->m_transform.get();
    data->putDirect(vm, Identifier::fromString(vm, "readable"_s), transform && transform->m_readable.get() ? JSValue(transform->m_readable.get()) : jsUndefined(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "writable"_s), transform && transform->m_writable.get() ? JSValue(transform->m_writable.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "TextDecoderStream"_s, data));
}

void JSTextDecoderStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSTextDecoderStream::info(), JSTextDecoderStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTextDecoderStreamPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSTextDecoderStream

const ClassInfo JSTextDecoderStream::s_info = { "TextDecoderStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTextDecoderStream) };

JSTextDecoderStream::JSTextDecoderStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSTextDecoderStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSTextDecoderStream* JSTextDecoderStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSTextDecoderStream>(vm)) JSTextDecoderStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSTextDecoderStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
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
    return WebCore::subspaceForImpl<JSTextDecoderStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForTextDecoderStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTextDecoderStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForTextDecoderStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForTextDecoderStream = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSTextDecoderStream);

template<typename Visitor>
void JSTextDecoderStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTextDecoderStream>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_transform);
    visitor.appendHidden(thisObject->m_decoder);
}

void JSTextDecoderStream::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSTextDecoderStream>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_transform, "transform"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_decoder, "decoder"_s);
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

// The `encoding` / `fatal` / `ignoreBOM` getters delegate to the wrapped TextDecoder.
static EncodedJSValue textDecoderStreamDelegatedGetter(JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, const Identifier& property, ASCIILiteral attributeName)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextDecoderStream"_s, attributeName);
    RELEASE_AND_RETURN(scope, JSValue::encode(stream->m_decoder->get(lexicalGlobalObject, property)));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_encoding, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    return textDecoderStreamDelegatedGetter(lexicalGlobalObject, thisValue, builtinNames(JSC::getVM(lexicalGlobalObject)).encodingPublicName(), "encoding"_s);
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_fatal, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    return textDecoderStreamDelegatedGetter(lexicalGlobalObject, thisValue, builtinNames(JSC::getVM(lexicalGlobalObject)).fatalPublicName(), "fatal"_s);
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_ignoreBOM, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    return textDecoderStreamDelegatedGetter(lexicalGlobalObject, thisValue, builtinNames(JSC::getVM(lexicalGlobalObject)).ignoreBOMPublicName(), "ignoreBOM"_s);
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextDecoderStream"_s);
    return JSValue::encode(stream->m_transform->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsTextDecoderStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* stream = dynamicDowncast<JSTextDecoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TextDecoderStream"_s);
    return JSValue::encode(stream->m_transform->m_writable.get());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSTextDecoderStream;

// `decoder.decode(input, { stream })` on the wrapped TextDecoder. Runs user JS: `decode`
// is looked up on the public TextDecoder.prototype. Empty return = it threw.
static JSValue invokeDecode(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* decoder, JSValue input, bool streaming)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = WebCore::builtinNames(vm);

    auto* decodeOptions = constructEmptyObject(globalObject);
    decodeOptions->putDirect(vm, names.streamPublicName(), jsBoolean(streaming));

    JSValue method = decoder->get(globalObject, names.decodePublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = getCallData(method);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "TextDecoder.prototype.decode is not callable"_s);
        return {};
    }
    MarkedArgumentBuffer args;
    args.append(input);
    args.append(decodeOptions);
    ASSERT(!args.hasOverflowed());
    RELEASE_AND_RETURN(scope, call(globalObject, method, callData, decoder, args));
}

// Decodes, then enqueues the non-empty result; abrupt decode OR enqueue completions become
// a rejected promise (a transform algorithm must never throw synchronously into
// ProcessWrite — the in-flight write would never settle). Shared by transform and flush.
static JSPromise* decodeAndEnqueue(JSGlobalObject* globalObject, JSTextDecoderStream* stream, JSTransformStreamDefaultController* controller, JSValue input, bool streaming)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue decoded = invokeDecode(vm, globalObject, stream->m_decoder.get(), input, streaming);
        if (!catchScope.exception() && decoded.isString() && asString(decoded)->length())
            transformStreamDefaultControllerEnqueue(globalObject, controller, decoded);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    // takeAbruptCompletion leaves a VM termination pending and returns the empty value.
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

JSPromise* textDecoderStreamTransform(JSGlobalObject* globalObject, JSTextDecoderStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    // https://encoding.spec.whatwg.org/#decode-and-enqueue-a-chunk step 1 converts `chunk` to a
    // non-optional BufferSource, so `undefined` is a TypeError. TextDecoder.decode's first
    // argument is optional and would treat it as an empty buffer instead.
    if (chunk.isUndefined()) [[unlikely]]
        return promiseRejectedWith(globalObject, createTypeError(globalObject, "TextDecoderStream: chunk must be an ArrayBuffer or ArrayBufferView"_s));
    return decodeAndEnqueue(globalObject, stream, controller, chunk, /* streaming */ true);
}

JSPromise* textDecoderStreamFlush(JSGlobalObject* globalObject, JSTextDecoderStream* stream, JSTransformStreamDefaultController* controller)
{
    return decodeAndEnqueue(globalObject, stream, controller, jsUndefined(), /* streaming */ false);
}

} // namespace WebStreams
} // namespace Bun
