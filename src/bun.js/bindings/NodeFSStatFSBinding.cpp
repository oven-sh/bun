#include "root.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"
#include "BunBuiltinNames.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/ObjectInitializationScope.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include "ZigGlobalObject.h"

namespace Bun {

class JSStatFSPrototype;
class JSBigIntStatFSPrototype;
class JSStatFSConstructor;
class JSBigIntStatFSConstructor;
using namespace JSC;
using namespace WebCore;

JSC_DECLARE_HOST_FUNCTION(callStatFS);
JSC_DECLARE_HOST_FUNCTION(callBigIntStatFS);
JSC_DECLARE_HOST_FUNCTION(constructStatFS);
JSC_DECLARE_HOST_FUNCTION(constructBigIntStatFS);

template<bool isBigInt>
Structure* getStatFSStructure(Zig::GlobalObject* globalObject)
{
    if (isBigInt) {
        return globalObject->m_JSStatFSBigIntClassStructure.getInitializedOnMainThread(globalObject);
    }

    return globalObject->m_JSStatFSClassStructure.getInitializedOnMainThread(globalObject);
}

template<bool isBigInt>
JSObject* getStatFSPrototype(Zig::GlobalObject* globalObject)
{
    if (isBigInt) {
        return globalObject->m_JSStatFSBigIntClassStructure.prototypeInitializedOnMainThread(globalObject);
    }

    return globalObject->m_JSStatFSClassStructure.prototypeInitializedOnMainThread(globalObject);
}

template<bool isBigInt>
JSObject* getStatFSConstructor(Zig::GlobalObject* globalObject)
{
    if (isBigInt) {
        return globalObject->m_JSStatFSBigIntClassStructure.constructorInitializedOnMainThread(globalObject);
    }

    return globalObject->m_JSStatFSClassStructure.constructorInitializedOnMainThread(globalObject);
}

class JSStatFSPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSStatFSPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSStatFSPrototype* prototype = new (NotNull, JSC::allocateCell<JSStatFSPrototype>(vm)) JSStatFSPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStatFSPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSStatFSPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

class JSBigIntStatFSPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBigIntStatFSPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBigIntStatFSPrototype* prototype = new (NotNull, JSC::allocateCell<JSBigIntStatFSPrototype>(vm)) JSBigIntStatFSPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBigIntStatFSPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSBigIntStatFSPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

class JSStatFSConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSStatFSConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSStatFSConstructor* constructor = new (NotNull, JSC::allocateCell<JSStatFSConstructor>(vm)) JSStatFSConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSStatFSConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callStatFS, constructStatFS)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "StatFs"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

class JSBigIntStatFSConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBigIntStatFSConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSBigIntStatFSConstructor* constructor = new (NotNull, JSC::allocateCell<JSBigIntStatFSConstructor>(vm)) JSBigIntStatFSConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSBigIntStatFSConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callBigIntStatFS, constructBigIntStatFS)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "BigIntStatFs"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

JSC::Structure* createJSStatFSObjectStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* prototype = JSStatFSPrototype::create(vm, globalObject, JSStatFSPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    auto structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray, 7);

    // Add property transitions for all statfs fields
    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(vm, structure, vm.propertyNames->type, 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "bsize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "blocks"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "bfree"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "bavail"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "files"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ffree"_s), 0, offset);

    return structure;
}

JSC::Structure* createJSBigIntStatFSObjectStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto prototype = JSBigIntStatFSPrototype::create(vm, globalObject, JSBigIntStatFSPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    auto structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray, 7);

    // Add property transitions for all bigint statfs fields
    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(vm, structure, vm.propertyNames->type, 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "bsize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "blocks"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "bfree"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "bavail"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "files"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ffree"_s), 0, offset);

    return structure;
}

extern "C" JSC::EncodedJSValue Bun__createJSStatFSObject(Zig::GlobalObject* globalObject,
    int64_t fstype,
    int64_t bsize,
    int64_t blocks,
    int64_t bfree,
    int64_t bavail,
    int64_t files,
    int64_t ffree)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue js_fstype = JSC::jsNumber(fstype);
    JSC::JSValue js_bsize = JSC::jsNumber(bsize);
    JSC::JSValue js_blocks = JSC::jsNumber(blocks);
    JSC::JSValue js_bfree = JSC::jsNumber(bfree);
    JSC::JSValue js_bavail = JSC::jsNumber(bavail);
    JSC::JSValue js_files = JSC::jsNumber(files);
    JSC::JSValue js_ffree = JSC::jsNumber(ffree);

    auto* structure = getStatFSStructure<false>(globalObject);
    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, 0, js_fstype);
    object->putDirectOffset(vm, 1, js_bsize);
    object->putDirectOffset(vm, 2, js_blocks);
    object->putDirectOffset(vm, 3, js_bfree);
    object->putDirectOffset(vm, 4, js_bavail);
    object->putDirectOffset(vm, 5, js_files);
    object->putDirectOffset(vm, 6, js_ffree);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(object));
}

extern "C" JSC::EncodedJSValue Bun__createJSBigIntStatFSObject(Zig::GlobalObject* globalObject,
    int64_t fstype,
    int64_t bsize,
    int64_t blocks,
    int64_t bfree,
    int64_t bavail,
    int64_t files,
    int64_t ffree)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* structure = getStatFSStructure<true>(globalObject);
    JSC::JSValue js_fstype = JSC::JSBigInt::createFrom(globalObject, fstype);
    JSC::JSValue js_bsize = JSC::JSBigInt::createFrom(globalObject, bsize);
    JSC::JSValue js_blocks = JSC::JSBigInt::createFrom(globalObject, blocks);
    JSC::JSValue js_bfree = JSC::JSBigInt::createFrom(globalObject, bfree);
    JSC::JSValue js_bavail = JSC::JSBigInt::createFrom(globalObject, bavail);
    JSC::JSValue js_files = JSC::JSBigInt::createFrom(globalObject, files);
    JSC::JSValue js_ffree = JSC::JSBigInt::createFrom(globalObject, ffree);

    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, 0, js_fstype);
    object->putDirectOffset(vm, 1, js_bsize);
    object->putDirectOffset(vm, 2, js_blocks);
    object->putDirectOffset(vm, 3, js_bfree);
    object->putDirectOffset(vm, 4, js_bavail);
    object->putDirectOffset(vm, 5, js_files);
    object->putDirectOffset(vm, 6, js_ffree);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(object));
}

const JSC::ClassInfo JSStatFSPrototype::s_info = { "StatFs"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatFSPrototype) };
const JSC::ClassInfo JSBigIntStatFSPrototype::s_info = { "BigIntStatFs"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBigIntStatFSPrototype) };
const JSC::ClassInfo JSStatFSConstructor::s_info = { "StatFs"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatFSConstructor) };
const JSC::ClassInfo JSBigIntStatFSConstructor::s_info = { "BigIntStatFs"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBigIntStatFSConstructor) };

template<bool isBigInt>
inline JSValue callJSStatFSFunction(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* structure = getStatFSStructure<isBigInt>(defaultGlobalObject(globalObject));

    JSValue type = callFrame->argument(0);
    JSValue bsize = callFrame->argument(1);
    JSValue blocks = callFrame->argument(2);
    JSValue bfree = callFrame->argument(3);
    JSValue bavail = callFrame->argument(4);
    JSValue files = callFrame->argument(5);
    JSValue ffree = callFrame->argument(6);

    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, 0, type);
    object->putDirectOffset(vm, 1, bsize);
    object->putDirectOffset(vm, 2, blocks);
    object->putDirectOffset(vm, 3, bfree);
    object->putDirectOffset(vm, 4, bavail);
    object->putDirectOffset(vm, 5, files);
    object->putDirectOffset(vm, 6, ffree);

    return object;
}

template<bool isBigInt>
inline JSValue constructJSStatFSObject(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* structure = getStatFSStructure<isBigInt>(globalObject);
    auto* constructor = getStatFSConstructor<isBigInt>(globalObject);
    JSObject* newTarget = asObject(callFrame->newTarget());

    if (constructor != newTarget) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(
            // ShadowRealm functions belong to a different global object.
            getFunctionRealm(lexicalGlobalObject, newTarget));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            lexicalGlobalObject,
            newTarget,
            getStatFSStructure<isBigInt>(functionGlobalObject));
    }

    JSValue type = callFrame->argument(0);
    JSValue bsize = callFrame->argument(1);
    JSValue blocks = callFrame->argument(2);
    JSValue bfree = callFrame->argument(3);
    JSValue bavail = callFrame->argument(4);
    JSValue files = callFrame->argument(5);
    JSValue ffree = callFrame->argument(6);

    JSFinalObject* object = JSC::JSFinalObject::create(vm, structure);
    object->putDirect(vm, vm.propertyNames->type, type, 0);
    object->putDirect(vm, Identifier::fromString(vm, "bsize"_s), bsize, 0);
    object->putDirect(vm, Identifier::fromString(vm, "blocks"_s), blocks, 0);
    object->putDirect(vm, Identifier::fromString(vm, "bfree"_s), bfree, 0);
    object->putDirect(vm, Identifier::fromString(vm, "bavail"_s), bavail, 0);
    object->putDirect(vm, Identifier::fromString(vm, "files"_s), files, 0);
    object->putDirect(vm, Identifier::fromString(vm, "ffree"_s), ffree, 0);

    return object;
}

JSC_DEFINE_HOST_FUNCTION(constructStatFS, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(constructJSStatFSObject<false>(lexicalGlobalObject, callFrame));
}

JSC_DEFINE_HOST_FUNCTION(constructBigIntStatFS, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(constructJSStatFSObject<true>(lexicalGlobalObject, callFrame));
}

JSC_DEFINE_HOST_FUNCTION(callStatFS, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(callJSStatFSFunction<false>(lexicalGlobalObject, callFrame));
}

JSC_DEFINE_HOST_FUNCTION(callBigIntStatFS, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(callJSStatFSFunction<true>(lexicalGlobalObject, callFrame));
}

extern "C" JSC::EncodedJSValue Bun__JSBigIntStatFSObjectConstructor(Zig::GlobalObject* globalobject)
{
    return JSValue::encode(globalobject->m_JSStatFSBigIntClassStructure.constructor(globalobject));
}

extern "C" JSC::EncodedJSValue Bun__JSStatFSObjectConstructor(Zig::GlobalObject* globalobject)
{
    return JSValue::encode(globalobject->m_JSStatFSClassStructure.constructor(globalobject));
}

void JSStatFSPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void JSBigIntStatFSPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void initJSStatFSClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototype = JSStatFSPrototype::create(init.vm, init.global, JSStatFSPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = createJSStatFSObjectStructure(init.vm, init.global);
    auto* constructor = JSStatFSConstructor::create(init.vm, JSStatFSConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

void initJSBigIntStatFSClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototype = JSBigIntStatFSPrototype::create(init.vm, init.global, JSBigIntStatFSPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = createJSBigIntStatFSObjectStructure(init.vm, init.global);
    auto* constructor = JSBigIntStatFSConstructor::create(init.vm, JSBigIntStatFSConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
