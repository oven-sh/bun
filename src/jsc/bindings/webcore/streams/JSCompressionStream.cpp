#include "config.h"
#include "JSCompressionStream.h"

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
#include <JavaScriptCore/TopExceptionScope.h>

// CompressionStreamCoder.rs
extern "C" void* CompressionStreamCoder__create(uint8_t format, bool decompress);
extern "C" void CompressionStreamCoder__destroy(void* coder);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transform(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish);

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// ─── shared helpers ─────────────────────────────────────────────────────────

static std::optional<CompressionFormat> parseCompressionFormat(JSGlobalObject* globalObject, JSValue formatValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String format = formatValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (format == "deflate"_s)
        return CompressionFormat::Deflate;
    if (format == "deflate-raw"_s)
        return CompressionFormat::DeflateRaw;
    if (format == "gzip"_s)
        return CompressionFormat::Gzip;
    if (format == "brotli"_s)
        return CompressionFormat::Brotli;
    if (format == "zstd"_s)
        return CompressionFormat::Zstd;
    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "format"_s, formatValue, "must be one of: deflate, deflate-raw, gzip, brotli, zstd"_s);
    return std::nullopt;
}

// ─── JSCompressionStreamPrototype ───────────────────────────────────────────

static JSC_DECLARE_CUSTOM_GETTER(jsCompressionStreamPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsCompressionStreamPrototypeGetter_readable);
static JSC_DECLARE_CUSTOM_GETTER(jsCompressionStreamPrototypeGetter_writable);
static JSC_DECLARE_HOST_FUNCTION(jsCompressionStreamPrototype_inspectCustom);

class JSCompressionStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCompressionStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSCompressionStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSCompressionStreamPrototype>(vm)) JSCompressionStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCompressionStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSCompressionStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCompressionStreamPrototype, JSCompressionStreamPrototype::Base);

static const HashTableValue JSCompressionStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsCompressionStreamPrototypeGetter_constructor, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCompressionStreamPrototypeGetter_readable, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCompressionStreamPrototypeGetter_writable, 0 } },
};

const ClassInfo JSCompressionStreamPrototype::s_info = { "CompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCompressionStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsCompressionStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSCompressionStream>(thisValue);
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "CompressionStream"_s);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "readable"_s), thisObject->m_readable.get() ? JSValue(thisObject->m_readable.get()) : jsUndefined(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "writable"_s), thisObject->m_writable.get() ? JSValue(thisObject->m_writable.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "CompressionStream"_s, data));
}

void JSCompressionStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSCompressionStream::info(), JSCompressionStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsCompressionStreamPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSCompressionStreamConstructor = JSStreamConstructor<JSCompressionStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCompressionStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSCompressionStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSCompressionStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSCompressionStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSCompressionStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSCompressionStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSCompressionStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSCompressionStreamConstructor::s_info = { "CompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCompressionStreamConstructor) };

template<> JSValue JSCompressionStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSCompressionStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSCompressionStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSCompressionStreamConstructor);

template<> GCClient::IsoSubspace* JSCompressionStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSCompressionStreamConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCompressionStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCompressionStreamConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCompressionStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCompressionStreamConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSCompressionStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "CompressionStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSCompressionStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSCompressionStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCompressionStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSCompressionStreamConstructor>(callFrame->jsCallee());

    auto format = parseCompressionFormat(lexicalGlobalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(format.has_value());

    void* coder = CompressionStreamCoder__create(static_cast<uint8_t>(*format), false);
    if (!coder) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "failed to initialize compressor"_s);
        return {};
    }

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    if (scope.exception()) [[unlikely]] {
        CompressionStreamCoder__destroy(coder);
        return {};
    }
    auto* stream = JSCompressionStream::create(vm, structure);
    stream->m_coder = coder;
    stream->m_format = *format;

    setUpNativeTransformStream(lexicalGlobalObject, stream, TransformerKind::Compression);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSCompressionStreamConstructorConstruct, JSCompressionStreamConstructor::construct);

// ─── JSCompressionStream ────────────────────────────────────────────────────

const ClassInfo JSCompressionStream::s_info = { "CompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCompressionStream) };

JSCompressionStream::JSCompressionStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSCompressionStream::~JSCompressionStream()
{
    if (auto* coder = std::exchange(m_coder, nullptr))
        CompressionStreamCoder__destroy(coder);
}

void JSCompressionStream::destroy(JSCell* cell)
{
    static_cast<JSCompressionStream*>(cell)->~JSCompressionStream();
}

JSCompressionStream* JSCompressionStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSCompressionStream>(vm)) JSCompressionStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSCompressionStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSCompressionStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSCompressionStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSCompressionStreamPrototype::create(vm, &globalObject, structure);
}

JSObject* JSCompressionStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSCompressionStream>(vm, globalObject);
}

JSValue JSCompressionStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSCompressionStreamConstructor, DOMConstructorID::CompressionStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSCompressionStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSCompressionStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCompressionStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCompressionStream = std::forward<decltype(space)>(space); });
}

JSC_DEFINE_CUSTOM_GETTER(jsCompressionStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSCompressionStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSCompressionStream::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsCompressionStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSCompressionStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "CompressionStream"_s);
    return JSValue::encode(stream->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsCompressionStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSCompressionStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "CompressionStream"_s);
    return JSValue::encode(stream->m_writable.get());
}

// ─── JSDecompressionStreamPrototype ─────────────────────────────────────────

static JSC_DECLARE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_readable);
static JSC_DECLARE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_writable);
static JSC_DECLARE_HOST_FUNCTION(jsDecompressionStreamPrototype_inspectCustom);

class JSDecompressionStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSDecompressionStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDecompressionStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSDecompressionStreamPrototype>(vm)) JSDecompressionStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDecompressionStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSDecompressionStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDecompressionStreamPrototype, JSDecompressionStreamPrototype::Base);

static const HashTableValue JSDecompressionStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsDecompressionStreamPrototypeGetter_constructor, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDecompressionStreamPrototypeGetter_readable, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDecompressionStreamPrototypeGetter_writable, 0 } },
};

const ClassInfo JSDecompressionStreamPrototype::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsDecompressionStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSDecompressionStream>(thisValue);
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "DecompressionStream"_s);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "readable"_s), thisObject->m_readable.get() ? JSValue(thisObject->m_readable.get()) : jsUndefined(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "writable"_s), thisObject->m_writable.get() ? JSValue(thisObject->m_writable.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "DecompressionStream"_s, data));
}

void JSDecompressionStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSDecompressionStream::info(), JSDecompressionStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsDecompressionStreamPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSDecompressionStreamConstructor = JSStreamConstructor<JSDecompressionStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDecompressionStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSDecompressionStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSDecompressionStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSDecompressionStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSDecompressionStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSDecompressionStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSDecompressionStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSDecompressionStreamConstructor::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStreamConstructor) };

template<> JSValue JSDecompressionStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSDecompressionStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDecompressionStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSDecompressionStreamConstructor);

template<> GCClient::IsoSubspace* JSDecompressionStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSDecompressionStreamConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForDecompressionStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForDecompressionStreamConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForDecompressionStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForDecompressionStreamConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSDecompressionStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "DecompressionStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSDecompressionStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSDecompressionStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDecompressionStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSDecompressionStreamConstructor>(callFrame->jsCallee());

    auto format = parseCompressionFormat(lexicalGlobalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(format.has_value());

    void* coder = CompressionStreamCoder__create(static_cast<uint8_t>(*format), true);
    if (!coder) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "failed to initialize decompressor"_s);
        return {};
    }

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    if (scope.exception()) [[unlikely]] {
        CompressionStreamCoder__destroy(coder);
        return {};
    }
    auto* stream = JSDecompressionStream::create(vm, structure);
    stream->m_coder = coder;
    stream->m_format = *format;

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

JSDecompressionStream::~JSDecompressionStream()
{
    if (auto* coder = std::exchange(m_coder, nullptr))
        CompressionStreamCoder__destroy(coder);
}

void JSDecompressionStream::destroy(JSCell* cell)
{
    static_cast<JSDecompressionStream*>(cell)->~JSDecompressionStream();
}

JSDecompressionStream* JSDecompressionStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSDecompressionStream>(vm)) JSDecompressionStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSDecompressionStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSDecompressionStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSDecompressionStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSDecompressionStreamPrototype::create(vm, &globalObject, structure);
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
    return WebCore::subspaceForImpl<JSDecompressionStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForDecompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForDecompressionStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForDecompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForDecompressionStream = std::forward<decltype(space)>(space); });
}

JSC_DEFINE_CUSTOM_GETTER(jsDecompressionStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSDecompressionStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSDecompressionStream::getConstructor(vm, prototype->globalObject()));
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

// ─── TransformerKind::{De,}Compression algorithm arms ──────────────────────

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSCompressionStream;
using WebCore::JSDecompressionStream;

// BufferSource → (ptr, len). `scratch` owns the bytes when `chunk` is a string
// (Node-compat: node:zlib-backed CompressionStream accepts string chunks).
static std::optional<std::span<const uint8_t>> bufferSourceBytes(JSGlobalObject* globalObject, JSValue chunk, WTF::CString& scratch)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (chunk.isNull()) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_STREAM_NULL_VALUES, "May not write null values to stream"_s);
        return std::nullopt;
    }
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk)) {
        if (view->isDetached()) [[unlikely]] {
            throwTypeError(globalObject, scope, "Cannot transform a detached buffer"_s);
            return std::nullopt;
        }
        if (view->isShared()) [[unlikely]] {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
            return std::nullopt;
        }
        return std::span<const uint8_t>(static_cast<const uint8_t*>(view->vector()), view->byteLength());
    }
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(chunk)) {
        auto* impl = buffer->impl();
        if (!impl || impl->isDetached()) [[unlikely]] {
            throwTypeError(globalObject, scope, "Cannot transform a detached buffer"_s);
            return std::nullopt;
        }
        if (impl->isShared()) [[unlikely]] {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
            return std::nullopt;
        }
        return std::span<const uint8_t>(static_cast<const uint8_t*>(impl->data()), impl->byteLength());
    }
    if (chunk.isString()) {
        WTF::String s = asString(chunk)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        scratch = s.utf8();
        return std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(scratch.data()), scratch.length());
    }
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
    return std::nullopt;
}

// Runs the Rust coder and enqueues the non-empty result. Abrupt completions (from
// the coder's TypeError OR the enqueue) become a rejected promise — a transform
// algorithm must never throw synchronously into ProcessWrite/ProcessClose.
static JSPromise* codeAndEnqueue(JSGlobalObject* globalObject, void* coder, JSTransformStreamDefaultController* controller, const uint8_t* input, size_t inputLen, bool finish)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue out = JSValue::decode(CompressionStreamCoder__transform(coder, globalObject, input, inputLen, finish));
        if (!catchScope.exception()) {
            auto* view = dynamicDowncast<JSArrayBufferView>(out);
            if (view && view->length())
                transformStreamDefaultControllerEnqueue(globalObject, controller, out);
        }
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

template<typename JSStream>
static JSPromise* compressionStreamTransformImpl(JSGlobalObject* globalObject, JSStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thrown;
    WTF::CString scratch;
    std::optional<std::span<const uint8_t>> bytes;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        bytes = bufferSourceBytes(globalObject, chunk, scratch);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, codeAndEnqueue(globalObject, stream->m_coder, controller, bytes->data(), bytes->size(), false));
}

JSPromise* compressionStreamTransform(JSGlobalObject* globalObject, JSCompressionStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return compressionStreamTransformImpl(globalObject, stream, controller, chunk);
}

JSPromise* compressionStreamFlush(JSGlobalObject* globalObject, JSCompressionStream* stream, JSTransformStreamDefaultController* controller)
{
    return codeAndEnqueue(globalObject, stream->m_coder, controller, nullptr, 0, true);
}

JSPromise* decompressionStreamTransform(JSGlobalObject* globalObject, JSDecompressionStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return compressionStreamTransformImpl(globalObject, stream, controller, chunk);
}

JSPromise* decompressionStreamFlush(JSGlobalObject* globalObject, JSDecompressionStream* stream, JSTransformStreamDefaultController* controller)
{
    return codeAndEnqueue(globalObject, stream->m_coder, controller, nullptr, 0, true);
}

} // namespace WebStreams
} // namespace Bun
