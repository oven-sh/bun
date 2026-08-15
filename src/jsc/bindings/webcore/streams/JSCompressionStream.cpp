#include "config.h"
#include "JSCompressionStream.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSCompressionStreamShared.h"
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
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

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
    size_t highWaterMark = parseCodecHighWaterMark(lexicalGlobalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    void* coder = CompressionStreamCoder__create(static_cast<uint8_t>(*format), false, highWaterMark);
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
    vm.heap.addFinalizer(stream, static_cast<JSC::Heap::CFinalizer>([](JSCell* cell) {
        CompressionStreamCoder__destroy(std::exchange(static_cast<JSCompressionStream*>(cell)->m_coder, nullptr));
    }));

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

} // namespace WebCore
