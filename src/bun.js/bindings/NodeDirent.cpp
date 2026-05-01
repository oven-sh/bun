#include "ErrorCode.h"
#include "headers-handwritten.h"
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

using namespace JSC;
using namespace WebCore;

JSC_DECLARE_HOST_FUNCTION(callDirent);
JSC_DECLARE_HOST_FUNCTION(constructDirent);

static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsBlockDevice);
static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsCharacterDevice);
static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsDirectory);
static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsFIFO);
static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsFile);
static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsSocket);
static JSC_DECLARE_HOST_FUNCTION(jsDirentProtoFuncIsSymbolicLink);

static const HashTableValue JSDirentPrototypeTableValues[] = {
    { "isBlockDevice"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsBlockDevice, 0 } },
    { "isCharacterDevice"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsCharacterDevice, 0 } },
    { "isDirectory"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsDirectory, 0 } },
    { "isFIFO"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsFIFO, 0 } },
    { "isFile"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsFile, 0 } },
    { "isSocket"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsSocket, 0 } },
    { "isSymbolicLink"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDirentProtoFuncIsSymbolicLink, 0 } },
};

static Structure* getStructure(Zig::GlobalObject* globalObject)
{
    return globalObject->m_JSDirentClassStructure.get(globalObject);
}

// Prototype class
class JSDirentPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDirentPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDirentPrototype* prototype = new (NotNull, JSC::allocateCell<JSDirentPrototype>(vm)) JSDirentPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSDirentPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSDirentPrototype::info(), JSDirentPrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

// Constructor class
class JSDirentConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDirentConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSDirentConstructor* constructor = new (NotNull, JSC::allocateCell<JSDirentConstructor>(vm)) JSDirentConstructor(vm, structure);
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
    JSDirentConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callDirent, constructDirent)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 3, "Dirent"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

JSC::Structure* createJSDirentObjectStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* prototype = JSDirentPrototype::create(vm, globalObject, JSDirentPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    auto structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray, 4);

    // Add property transitions for all dirent fields
    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(vm, structure, vm.propertyNames->name, 0, offset);
    structure = structure->addPropertyTransition(vm, structure, Bun::builtinNames(vm).pathPublicName(), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, Bun::builtinNames(vm).dataPrivateName(), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, Identifier::fromString(vm, "parentPath"_s), 0, offset);

    return structure;
}

JSC_DEFINE_HOST_FUNCTION(callDirent, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Dirent constructor cannot be called as a function"_s);
}

JSC_DEFINE_HOST_FUNCTION(constructDirent, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue name = callFrame->argument(0);
    JSValue type = callFrame->argument(1);
    JSValue path = callFrame->argument(2);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSDirentClassStructure.get(zigGlobalObject);
    auto* originalStructure = structure;
    JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSDirentClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Dirent cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSDirentClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* object = JSC::JSFinalObject::create(vm, structure);
    if (structure->id() != originalStructure->id()) {
        object->putDirect(vm, vm.propertyNames->name, name, 0);
        object->putDirect(vm, Bun::builtinNames(vm).pathPublicName(), path, 0);
        object->putDirect(vm, Bun::builtinNames(vm).dataPrivateName(), type, 0);
        object->putDirect(vm, Identifier::fromString(vm, "parentPath"_s), path, 0);
    } else {
        object->putDirectOffset(vm, 0, name);
        object->putDirectOffset(vm, 1, path);
        object->putDirectOffset(vm, 2, type);
        object->putDirectOffset(vm, 3, path);
    }

    return JSValue::encode(object);
}

static inline int32_t getType(JSC::VM& vm, JSValue value, Zig::GlobalObject* globalObject)
{
    JSObject* object = value.getObject();
    if (!object) [[unlikely]] {
        return std::numeric_limits<int32_t>::max();
    }
    auto* structure = getStructure(globalObject);
    JSValue type;
    if (structure->id() != object->structure()->id()) {
        type = object->get(globalObject, Bun::builtinNames(vm).dataPrivateName());
        if (!type) [[unlikely]] {
            return std::numeric_limits<int32_t>::max();
        }
    } else {
        type = object->getDirect(2);
    }

    if (type.isAnyInt()) {
        return type.toInt32(globalObject);
    }

    return std::numeric_limits<int32_t>::max();
}

enum class DirEntType : int32_t {
    // These have to match up with uv_dirent_type_t
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymLink = 3,
    NamedPipe = 4,
    UnixDomainSocket = 5,
    CharacterDevice = 6,
    BlockDevice = 7,
    Whiteout = 0,
    Door = 0,
    EventPort = 0
};

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsBlockDevice, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::BlockDevice)));
}

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsCharacterDevice, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::CharacterDevice)));
}

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsDirectory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::Directory)));
}

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsFIFO, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::NamedPipe)));
}

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsFile, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::File)));
}

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsSocket, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::UnixDomainSocket)));
}

JSC_DEFINE_HOST_FUNCTION(jsDirentProtoFuncIsSymbolicLink, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t type = getType(vm, callFrame->thisValue(), defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(type == static_cast<int32_t>(DirEntType::SymLink)));
}

void initJSDirentClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* structure = createJSDirentObjectStructure(init.vm, init.global);
    auto* prototype = structure->storedPrototypeObject();
    auto* constructor = JSDirentConstructor::create(init.vm, JSDirentConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

extern "C" JSC::EncodedJSValue Bun__JSDirentObjectConstructor(Zig::GlobalObject* globalobject)
{
    return JSValue::encode(globalobject->m_JSDirentClassStructure.constructor(globalobject));
}

extern "C" JSC::EncodedJSValue Bun__Dirent__toJS(Zig::GlobalObject* globalObject, int type, BunString* name, BunString* path, JSString** previousPath)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* structure = globalObject->m_JSDirentClassStructure.get(globalObject);
    auto* object = JSC::JSFinalObject::create(vm, structure);
    JSString* pathValue = nullptr;
    if (path && path->tag == BunStringTag::WTFStringImpl && previousPath && *previousPath && (*previousPath)->length() == path->impl.wtf->length()) {
        auto view = (*previousPath)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (view == path->impl.wtf) {
            pathValue = *previousPath;

            // Decrement the ref count of the previous path
            auto pathString = path->transferToWTFString();
        }
    }

    if (!pathValue) {
        auto pathString = path->transferToWTFString();
        pathValue = jsString(vm, WTF::move(pathString));
        if (previousPath) {
            *previousPath = pathValue;
        }
    }

    auto nameString = name->transferToWTFString();
    auto nameValue = jsString(vm, WTF::move(nameString));
    auto typeValue = jsNumber(type);
    object->putDirectOffset(vm, 0, nameValue);
    object->putDirectOffset(vm, 1, pathValue);
    object->putDirectOffset(vm, 2, typeValue);
    object->putDirectOffset(vm, 3, pathValue);

    return JSValue::encode(object);
}

const ClassInfo JSDirentPrototype::s_info = { "Dirent"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDirentPrototype) };
const ClassInfo JSDirentConstructor::s_info = { "Dirent"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDirentConstructor) };

} // namespace Bun
