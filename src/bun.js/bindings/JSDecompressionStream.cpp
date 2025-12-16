#include "config.h"
#include "JSDecompressionStream.h"

#include "JSDOMBuiltinConstructor.h"
#include "JSDOMGlobalObjectInlines.h"
#include "WebCoreJSClientData.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsDecompressionStreamConstructor);

class JSDecompressionStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSDecompressionStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDecompressionStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSDecompressionStreamPrototype>(vm)) JSDecompressionStreamPrototype(vm, globalObject, structure);
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
    JSDecompressionStreamPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDecompressionStreamPrototype, JSDecompressionStreamPrototype::Base);

using JSDecompressionStreamDOMConstructor = JSDOMBuiltinConstructor<JSDecompressionStream>;

template<> const ClassInfo JSDecompressionStreamDOMConstructor::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStreamDOMConstructor) };

template<> JSValue JSDecompressionStreamDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSDecompressionStreamDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "DecompressionStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSDecompressionStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

template<> FunctionExecutable* JSDecompressionStreamDOMConstructor::initializeExecutable(VM& vm)
{
    return decompressionStreamInitializeDecompressionStreamCodeGenerator(vm);
}

static const HashTableValue JSDecompressionStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsDecompressionStreamConstructor, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinAccessorType, decompressionStreamReadableCodeGenerator, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinAccessorType, decompressionStreamWritableCodeGenerator, 0 } },
};

const ClassInfo JSDecompressionStreamPrototype::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStreamPrototype) };

void JSDecompressionStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSDecompressionStream::info(), JSDecompressionStreamPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSDecompressionStream::s_info = { "DecompressionStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDecompressionStream) };

JSC::GCClient::IsoSubspace* JSDecompressionStream::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSDecompressionStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForDecompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForDecompressionStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForDecompressionStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForDecompressionStream = std::forward<decltype(space)>(space); });
}

JSDecompressionStream::JSDecompressionStream(Structure* structure, JSDOMGlobalObject& globalObject)
    : JSDOMObject(structure, globalObject)
{
}

void JSDecompressionStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
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
    return getDOMConstructor<JSDecompressionStreamDOMConstructor, DOMConstructorID::DecompressionStream>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsDecompressionStreamConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = jsDynamicCast<JSDecompressionStreamPrototype*>(JSValue::decode(thisValue));
    if (!prototype)
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSDecompressionStream::getConstructor(vm, lexicalGlobalObject));
}

} // namespace WebCore
