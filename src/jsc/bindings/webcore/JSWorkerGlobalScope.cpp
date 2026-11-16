#include "config.h"
#include "JSWorkerGlobalScope.h"

#include "BunClientData.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSEventTarget.h"
#include "JSWorkerLocation.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/Lookup.h>
#include <wtf/URL.h>

// `vm.main` (src/jsc/virtual_machine_exports.rs): a file path, a `blob:` or `data:` URL, or empty.
extern "C" BunString Bun__VirtualMachine__main(void* bunVM);

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsWorkerGlobalScopePrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerGlobalScope_location);
static JSC_DECLARE_CUSTOM_GETTER(jsDedicatedWorkerGlobalScopePrototypeGetter_constructor);

// A plain prototype object whose ClassInfo names the interface.
#define DECLARE_SCOPE_PROTOTYPE(Name)                                                                                                         \
    class Name##Prototype final : public JSC::JSNonFinalObject {                                                                              \
    public:                                                                                                                                   \
        using Base = JSC::JSNonFinalObject;                                                                                                   \
        static Name##Prototype* create(JSC::VM& vm, JSC::Structure* structure)                                                                \
        {                                                                                                                                     \
            Name##Prototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(Name##Prototype))) Name##Prototype(vm, structure);   \
            ptr->finishCreation(vm);                                                                                                          \
            return ptr;                                                                                                                       \
        }                                                                                                                                     \
                                                                                                                                              \
        DECLARE_INFO;                                                                                                                         \
        template<typename CellType, JSC::SubspaceAccess>                                                                                      \
        static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                           \
        {                                                                                                                                     \
            STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Name##Prototype, Base);                                                                       \
            return &vm.plainObjectSpace();                                                                                                    \
        }                                                                                                                                     \
        static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)                        \
        {                                                                                                                                     \
            auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info()); \
            structure->setMayBePrototype(true);                                                                                               \
            return structure;                                                                                                                 \
        }                                                                                                                                     \
                                                                                                                                              \
    private:                                                                                                                                  \
        Name##Prototype(JSC::VM& vm, JSC::Structure* structure)                                                                               \
            : JSC::JSNonFinalObject(vm, structure)                                                                                            \
        {                                                                                                                                     \
        }                                                                                                                                     \
                                                                                                                                              \
        void finishCreation(JSC::VM&);                                                                                                        \
    };                                                                                                                                        \
    STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Name##Prototype, Name##Prototype::Base);

DECLARE_SCOPE_PROTOTYPE(JSWorkerGlobalScope)
DECLARE_SCOPE_PROTOTYPE(JSDedicatedWorkerGlobalScope)

#undef DECLARE_SCOPE_PROTOTYPE

// ---- WorkerGlobalScope

template<> JSValue JSWorkerGlobalScopeConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject);
template<> void JSWorkerGlobalScopeConstructor::initializeProperties(JSC::VM&, JSDOMGlobalObject&);

template<> const ClassInfo JSWorkerGlobalScopeConstructor::s_info = { "WorkerGlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWorkerGlobalScopeConstructor) };

template<> JSValue JSWorkerGlobalScopeConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<> void JSWorkerGlobalScopeConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    initializeBaseProperties(vm, 0, "WorkerGlobalScope"_s, JSWorkerGlobalScope::prototype(vm, globalObject));
}

// `location` is not a DOMAttribute: its receiver is the global object or its JSGlobalProxy.
static const HashTableValue JSWorkerGlobalScopePrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerGlobalScopePrototypeGetter_constructor, 0 } },
    { "location"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerGlobalScope_location, 0 } },
};

const ClassInfo JSWorkerGlobalScopePrototype::s_info = { "WorkerGlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWorkerGlobalScopePrototype) };

void JSWorkerGlobalScopePrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, info(), JSWorkerGlobalScopePrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

JSObject* JSWorkerGlobalScope::prototype(VM&, JSDOMGlobalObject& globalObject)
{
    return globalObject.m_workerGlobalScopePrototype.get();
}

JSValue JSWorkerGlobalScope::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSWorkerGlobalScopeConstructor, DOMConstructorID::WorkerGlobalScope>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

// ---- DedicatedWorkerGlobalScope

template<> JSValue JSDedicatedWorkerGlobalScopeConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject);
template<> void JSDedicatedWorkerGlobalScopeConstructor::initializeProperties(JSC::VM&, JSDOMGlobalObject&);

template<> const ClassInfo JSDedicatedWorkerGlobalScopeConstructor::s_info = { "DedicatedWorkerGlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDedicatedWorkerGlobalScopeConstructor) };

template<> JSValue JSDedicatedWorkerGlobalScopeConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    // class DedicatedWorkerGlobalScope extends WorkerGlobalScope
    return JSWorkerGlobalScope::getConstructor(vm, &globalObject);
}

template<> void JSDedicatedWorkerGlobalScopeConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    initializeBaseProperties(vm, 0, "DedicatedWorkerGlobalScope"_s, JSDedicatedWorkerGlobalScope::prototype(vm, globalObject));
}

static const HashTableValue JSDedicatedWorkerGlobalScopePrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsDedicatedWorkerGlobalScopePrototypeGetter_constructor, 0 } },
};

const ClassInfo JSDedicatedWorkerGlobalScopePrototype::s_info = { "DedicatedWorkerGlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDedicatedWorkerGlobalScopePrototype) };

void JSDedicatedWorkerGlobalScopePrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, info(), JSDedicatedWorkerGlobalScopePrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

JSObject* JSDedicatedWorkerGlobalScope::prototype(VM&, JSDOMGlobalObject& globalObject)
{
    return globalObject.m_dedicatedWorkerGlobalScopePrototype.get();
}

JSValue JSDedicatedWorkerGlobalScope::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSDedicatedWorkerGlobalScopeConstructor, DOMConstructorID::DedicatedWorkerGlobalScope>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

// ---- Install

void installWorkerGlobalScope(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    ASSERT(!globalObject->m_dedicatedWorkerGlobalScopePrototype);

    // DedicatedWorkerGlobalScope.prototype -> WorkerGlobalScope.prototype -> EventTarget.prototype -> Object.prototype
    auto* eventTargetPrototype = JSEventTarget::prototype(vm, *globalObject);
    auto* workerGlobalScopePrototype = JSWorkerGlobalScopePrototype::create(vm, JSWorkerGlobalScopePrototype::createStructure(vm, globalObject, eventTargetPrototype));
    globalObject->m_workerGlobalScopePrototype.set(vm, globalObject, workerGlobalScopePrototype);
    auto* dedicatedWorkerGlobalScopePrototype = JSDedicatedWorkerGlobalScopePrototype::create(vm, JSDedicatedWorkerGlobalScopePrototype::createStructure(vm, globalObject, workerGlobalScopePrototype));
    globalObject->m_dedicatedWorkerGlobalScopePrototype.set(vm, globalObject, dedicatedWorkerGlobalScopePrototype);

    // The global object and its proxy share a prototype, as Bun::GlobalScope::setPrototype keeps them.
    globalObject->setPrototypeDirect(vm, dedicatedWorkerGlobalScopePrototype);
    globalObject->globalThis()->setPrototypeDirect(vm, dedicatedWorkerGlobalScopePrototype);

    // [Exposed=Worker] interfaces.
    const auto expose = [&](ASCIILiteral name, JSValue constructor) {
        auto identifier = Identifier::fromString(vm, name);
        globalObject->putDirect(vm, identifier, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
        if (vm.hasCompiledCode()) [[unlikely]]
            JSC::AOT::hostDidCreateGlobalMember(globalObject, identifier.impl(), asObject(constructor));
    };
    expose("WorkerGlobalScope"_s, JSWorkerGlobalScope::getConstructor(vm, globalObject));
    expose("DedicatedWorkerGlobalScope"_s, JSDedicatedWorkerGlobalScope::getConstructor(vm, globalObject));
    expose("WorkerLocation"_s, JSWorkerLocation::getConstructor(vm, globalObject));
}

// ---- Getters

JSC_DEFINE_CUSTOM_GETTER(jsWorkerGlobalScopePrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSWorkerGlobalScopePrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSWorkerGlobalScope::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsDedicatedWorkerGlobalScopePrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSDedicatedWorkerGlobalScopePrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSDedicatedWorkerGlobalScope::getConstructor(vm, prototype->globalObject()));
}

// The WorkerGlobalScope that `thisValue` is: a Web Worker's global object, or its proxy. Null otherwise.
static Zig::GlobalObject* workerGlobalScopeOf(JSValue thisValue)
{
    JSObject* object = thisValue.getObject();
    if (!object)
        return nullptr;
    if (object->type() == GlobalProxyType) {
        object = uncheckedDowncast<JSGlobalProxy>(object)->target();
        if (!object)
            return nullptr;
    }
    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(object);
    if (!globalObject || !globalObject->m_dedicatedWorkerGlobalScopePrototype)
        return nullptr;
    return globalObject;
}

// Made on the first read: the entry is resolved after the global object is created.
JSC_DEFINE_CUSTOM_GETTER(jsWorkerGlobalScope_location, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = workerGlobalScopeOf(JSValue::decode(thisValue));
    if (!globalObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "WorkerGlobalScope"_s, "location"_s);

    if (auto* location = globalObject->m_workerLocation.get())
        return JSValue::encode(location);

    // A file entry is a file: URL. A blob: or data: entry is the URL itself.
    String entry = Bun__VirtualMachine__main(globalObject->bunVM()).transferToWTFString();
    URL url = entry.startsWith("blob:"_s) || entry.startsWith("data:"_s) ? URL { entry } : URL::fileURLWithFileSystemPath(entry);
    auto* location = JSWorkerLocation::create(vm, *globalObject, WTF::move(url));
    globalObject->m_workerLocation.set(vm, globalObject, location);
    return JSValue::encode(location);
}

} // namespace WebCore
