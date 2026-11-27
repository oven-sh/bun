#include "config.h"
#include "JSDecompressionStream.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSCompressionStreamShared.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMPrototype.h"
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
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// ─── JSDecompressionStreamPrototype ─────────────────────────────────────────

static JSC_DECLARE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_readable);
static JSC_DECLARE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_writable);
static JSC_DECLARE_HOST_FUNCTION(jsDecompressionStreamPrototype_inspectCustom);

using JSDecompressionStreamPrototype = JSDOMPrototype<JSDecompressionStream>;

static const HashTableValue JSDecompressionStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, JSDecompressionStreamPrototype::constructorGetter, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDecompressionStreamPrototypeGetter_readable, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDecompressionStreamPrototypeGetter_writable, 0 } },
};

template<> const ClassInfo JSDecompressionStreamPrototype::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsDecompressionStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSDecompressionStream>(thisValue);
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "DecompressionStream"_s);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    Bun::putDirectNamed(vm, data, "readable"_s, thisObject->m_readable.get() ? JSValue(thisObject->m_readable.get()) : jsUndefined());
    Bun::putDirectNamed(vm, data, "writable"_s, thisObject->m_writable.get() ? JSValue(thisObject->m_writable.get()) : jsUndefined());
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "DecompressionStream"_s, data));
}

template<> void JSDecompressionStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSDecompressionStream::info(), JSDecompressionStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsDecompressionStreamPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

// JSDecompressionStreamConstructor = JSStreamConstructor<JSDecompressionStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDecompressionStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> void JSDecompressionStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSDecompressionStreamConstructor::subspaceForImpl(JSC::VM&);

template<> const ClassInfo JSDecompressionStreamConstructor::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStreamConstructor) };

template<> GCClient::IsoSubspace* JSDecompressionStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSDecompressionStreamConstructor, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDecompressionStreamConstructor, m_subspaceForDecompressionStreamConstructor));
}

template<> void JSDecompressionStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeBaseProperties(vm, 1, "DecompressionStream"_s, JSDecompressionStream::prototype(vm, globalObject));
    m_instanceStructure.set(vm, this, getDOMStructure<JSDecompressionStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDecompressionStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(DecompressionStream, JSDecompressionStreamConstructor::construct);
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSDecompressionStreamConstructor>(callFrame->jsCallee());

    auto format = parseCompressionFormat(lexicalGlobalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(format.has_value());
    CodecOptions options = parseCodecOptions(lexicalGlobalObject, callFrame->argument(1), std::nullopt);
    RETURN_IF_EXCEPTION(scope, {});

    if (*format == CompressionFormat::Brotli && JSC::isFeatureRemoved(Bun::Feature::BrotliDecoder)) [[unlikely]]
        RELEASE_AND_RETURN(scope, Bun__throwForRemovedFeature(lexicalGlobalObject, static_cast<uint16_t>(Bun::Feature::BrotliDecoder)));

    std::unique_ptr<CompressionStreamCoder> coder { CompressionStreamCoder__create(static_cast<uint8_t>(*format), true, options.highWaterMark, false, 0) };
    if (!coder) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "failed to initialize decompressor"_s);
        return {};
    }

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* stream = JSDecompressionStream::create(vm, structure);
    stream->m_coder = WTF::move(coder);

    setUpNativeTransformStream(lexicalGlobalObject, stream, TransformerKind::Decompression);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSDecompressionStreamConstructorConstruct, JSDecompressionStreamConstructor::construct);

// ─── JSDecompressionStream ──────────────────────────────────────────────────

const ClassInfo JSDecompressionStream::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStream) };

JSDecompressionStream::JSDecompressionStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSDecompressionStream* JSDecompressionStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSDecompressionStream>(vm)) JSDecompressionStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSDecompressionStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSDecompressionStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSDecompressionStreamPrototype::create(vm, globalObject, globalObject.objectPrototype());
}

JSObject* JSDecompressionStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSDecompressionStream>(vm, globalObject);
}

JSValue JSDecompressionStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSDecompressionStreamConstructor, DOMConstructorID::DecompressionStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSDecompressionStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDecompressionStream, UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDecompressionStream, m_subspaceForDecompressionStream));
}

JSC_DEFINE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSDecompressionStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "DecompressionStream"_s);
    return JSValue::encode(stream->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSDecompressionStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "DecompressionStream"_s);
    return JSValue::encode(stream->m_writable.get());
}

} // namespace WebCore
