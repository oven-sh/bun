#include "config.h"
#include "JSTextEncoderStream.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSStreamsRuntime.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSWritableStream.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
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

static Structure* structureForNewTarget(JSTextEncoderStreamConstructor* constructor, JSGlobalObject* lexicalGlobalObject, JSObject* newTarget)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    if (newTarget == constructor) [[likely]]
        return constructor->instanceStructure();

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* newTargetGlobalObject = JSC::getFunctionRealm(lexicalGlobalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* baseStructure = getDOMStructure<JSTextEncoderStream>(vm, *uncheckedDowncast<JSDOMGlobalObject>(newTargetGlobalObject));
    RELEASE_AND_RETURN(scope, JSC::InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, baseStructure));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTextEncoderStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSTextEncoderStreamConstructor>(callFrame->jsCallee());

    auto* structure = structureForNewTarget(constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
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

void JSTextEncoderStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSTextEncoderStream::info(), JSTextEncoderStreamPrototypeTableValues, *this);
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
    visitor.append(thisObject->m_transform);
    visitor.append(thisObject->m_encoder);
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
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextEncoderStream"_s, "encoding"_s);
    return JSValue::encode(jsNontrivialString(vm, "utf-8"_s));
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextEncoderStream"_s, "readable"_s);
    return JSValue::encode(stream->m_transform->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsTextEncoderStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTextEncoderStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "TextEncoderStream"_s, "writable"_s);
    return JSValue::encode(stream->m_transform->m_writable.get());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSTextEncoderStream;

// `encoder.encode(chunk)` / `encoder.flush()` on the TextEncoderStreamEncoder cell. Runs no
// user JS: the method lives on the encoder's internal prototype. Empty return = it threw.
static JSValue invokeEncoderMethod(JSGlobalObject* globalObject, JSObject* encoder, const ASCIILiteral& methodName, const MarkedArgumentBuffer& args)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = encoder->get(globalObject, Identifier::fromString(vm, methodName));
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

JSPromise* textEncoderStreamTransform(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue buffer;
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        MarkedArgumentBuffer args;
        args.append(chunk);
        ASSERT(!args.hasOverflowed());
        buffer = invokeEncoderMethod(globalObject, stream->m_encoder.get(), "encode"_s, args);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    if (buffer.isEmpty()) {
        if (thrown.isEmpty())
            return nullptr;
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    }

    enqueueIfNonEmptyView(globalObject, controller, buffer);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, jsUndefined()));
}

JSPromise* textEncoderStreamFlush(JSGlobalObject* globalObject, JSTextEncoderStream* stream, JSTransformStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    MarkedArgumentBuffer noArguments;
    JSValue buffer = invokeEncoderMethod(globalObject, stream->m_encoder.get(), "flush"_s, noArguments);
    RETURN_IF_EXCEPTION(scope, nullptr);

    enqueueIfNonEmptyView(globalObject, controller, buffer);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, jsUndefined()));
}

} // namespace WebStreams
} // namespace Bun
