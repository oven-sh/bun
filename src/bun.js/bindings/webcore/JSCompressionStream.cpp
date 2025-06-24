#include "config.h"
#include "JSCompressionStream.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMBuiltinConstructor.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>

namespace WebCore {
using namespace JSC;

// Import from the Zig side
extern "C" JSC::EncodedJSValue CompressionStream__construct(JSC::JSGlobalObject*, JSC::CallFrame*);

// Attributes
static JSC_DECLARE_CUSTOM_GETTER(jsCompressionStreamConstructor);

class JSCompressionStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCompressionStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSCompressionStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSCompressionStreamPrototype>(vm)) JSCompressionStreamPrototype(vm, globalObject, structure);
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
    JSCompressionStreamPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCompressionStreamPrototype, JSCompressionStreamPrototype::Base);

using JSCompressionStreamDOMConstructor = JSDOMBuiltinConstructor<JSCompressionStream>;

template<> const ClassInfo JSCompressionStreamDOMConstructor::s_info = { "CompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCompressionStreamDOMConstructor) };

template<> JSValue JSCompressionStreamDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSCompressionStreamDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "CompressionStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSCompressionStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

template<> FunctionExecutable* JSCompressionStreamDOMConstructor::initializeExecutable(VM& vm)
{
    return compressionStreamInitializeCompressionStreamCodeGenerator(vm);
}

// Custom constructor that calls into Zig
template<> EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCompressionStreamDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    // Get the constructor and newTarget
    auto* castedThis = jsCast<JSCompressionStreamDOMConstructor*>(callFrame->jsCallee());
    ASSERT(castedThis);
    
    // Create structure for the new instance
    auto* structure = castedThis->getDOMStructureForJSObject(lexicalGlobalObject, asObject(callFrame->newTarget()));
    if (!structure) [[unlikely]]
        return {};
    
    // Create the JS object
    auto* jsObject = JSCompressionStream::create(structure, castedThis->globalObject());
    
    // Call the JS initializer function with the object as 'this'
    JSC::call(lexicalGlobalObject, castedThis->initializeFunction(), jsObject, JSC::ArgList(callFrame), "This error should never occur: initialize function is guaranteed to be callable."_s);
    RETURN_IF_EXCEPTION(scope, {});
    
    // Now call the Zig constructor to set up the native parts
    JSC::MarkedArgumentBuffer args;
    args.append(jsObject);
    for (size_t i = 0; i < callFrame->argumentCount(); ++i) {
        args.append(callFrame->argument(i));
    }
    
    auto result = CompressionStream__construct(lexicalGlobalObject, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    
    return JSValue::encode(jsObject);
}

/* Hash table for prototype */

static const HashTableValue JSCompressionStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsCompressionStreamConstructor, 0 } },
    { "readable"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin, NoIntrinsic, { HashTableValue::BuiltinAccessorType, compressionStreamReadableCodeGenerator, 0 } },
    { "writable"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin, NoIntrinsic, { HashTableValue::BuiltinAccessorType, compressionStreamWritableCodeGenerator, 0 } },
};

const ClassInfo JSCompressionStreamPrototype::s_info = { "CompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCompressionStreamPrototype) };

void JSCompressionStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSCompressionStream::info(), JSCompressionStreamPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSCompressionStream::s_info = { "CompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCompressionStream) };

JSCompressionStream::JSCompressionStream(Structure* structure, JSDOMGlobalObject& globalObject)
    : JSDOMObject(structure, globalObject)
{
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
    return getDOMConstructor<JSCompressionStreamDOMConstructor, DOMConstructorID::CompressionStream>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

void JSCompressionStream::destroy(JSC::JSCell* cell)
{
    JSCompressionStream* thisObject = static_cast<JSCompressionStream*>(cell);
    thisObject->JSCompressionStream::~JSCompressionStream();
}

JSC_DEFINE_CUSTOM_GETTER(jsCompressionStreamConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = jsDynamicCast<JSCompressionStreamPrototype*>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSCompressionStream::getConstructor(vm, prototype->globalObject()));
}

JSC::GCClient::IsoSubspace* JSCompressionStream::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSCompressionStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCompressionStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCompressionStream = std::forward<decltype(space)>(space); });
}

} // namespace WebCore