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
#include "JavaScriptCore/DateInstance.h"
namespace Bun {

class JSStatsPrototype;
class JSBigIntStatsPrototype;
class JSStatsConstructor;
class JSBigIntStatsConstructor;
using namespace JSC;
using namespace WebCore;

#if !OS(WINDOWS)
#include <sys/stat.h>
#else
#include <uv.h>

#ifndef S_ISBLK
#define S_ISBLK(m) ((m) & _S_IFBLK) /* block special */
#endif
#ifndef S_ISCHR
#define S_ISCHR(m) ((m) & _S_IFCHR) /* char special */
#endif
#ifndef S_ISDIR
#define S_ISDIR(m) ((m) & _S_IFDIR) /* directory */
#endif
#ifndef S_ISFIFO
#define S_ISFIFO(m) ((m) & _S_IFIFO) /* fifo or socket */
#endif
#ifndef S_ISREG
#define S_ISREG(m) ((m) & _S_IFREG) /* regular file */
#endif
#ifndef S_ISLNK
#define S_ISLNK(m) ((m) & _S_IFLNK) /* symbolic link */
#endif
#ifndef S_ISSOCK
#define S_ISSOCK(m) ((m) & _S_IFSOCK) /* socket */
#endif
#endif

JSC_DECLARE_HOST_FUNCTION(callStats);
JSC_DECLARE_HOST_FUNCTION(callBigIntStats);
JSC_DECLARE_HOST_FUNCTION(constructStats);
JSC_DECLARE_HOST_FUNCTION(constructBigIntStats);

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isBlockDevice, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISBLK(mode)));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isCharacterDevice, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISCHR(mode)));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isDirectory, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISDIR(mode)));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isFIFO, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISFIFO(mode)));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isFile, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISREG(mode)));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isSocket, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISSOCK(mode)));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isSymbolicLink, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = JSC::jsDynamicCast<JSObject*>(callFrame->thisValue());
    if (!thisObject)
        return JSValue::encode(jsUndefined());

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(S_ISLNK(mode)));
}

template<bool isBigInt>
Structure* getStructure(Zig::GlobalObject* globalObject)
{
    if (isBigInt) {
        return globalObject->m_JSStatsBigIntClassStructure.getInitializedOnMainThread(globalObject);
    }

    return globalObject->m_JSStatsClassStructure.getInitializedOnMainThread(globalObject);
}

template<bool isBigInt>
JSObject* getPrototype(Zig::GlobalObject* globalObject)
{
    if (isBigInt) {
        return globalObject->m_JSStatsBigIntClassStructure.prototypeInitializedOnMainThread(globalObject);
    }

    return globalObject->m_JSStatsClassStructure.prototypeInitializedOnMainThread(globalObject);
}

template<bool isBigInt>
JSObject* getConstructor(Zig::GlobalObject* globalObject)
{
    if (isBigInt) {
        return globalObject->m_JSStatsBigIntClassStructure.constructorInitializedOnMainThread(globalObject);
    }

    return globalObject->m_JSStatsClassStructure.constructorInitializedOnMainThread(globalObject);
}

enum class DateFieldType : uint8_t {
    atime = 11,
    mtime = 12,
    ctime = 13,
    birthtime = 14,
};

static const Identifier& identifier(JSC::VM& vm, DateFieldType dateField)
{
    const auto& names = WebCore::builtinNames(vm);
    switch (dateField) {
    case DateFieldType::atime:
        return names.atimeMsPublicName();
    case DateFieldType::mtime:
        return names.mtimeMsPublicName();
    case DateFieldType::ctime:
        return names.ctimeMsPublicName();
    case DateFieldType::birthtime:
        return names.birthtimeMsPublicName();
    }

    ASSERT_NOT_REACHED();
}

template<DateFieldType field, bool isBigInt>
inline JSC::JSValue getDateField(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSObject* thisObject = jsDynamicCast<JSC::JSObject*>(JSC::JSValue::decode(thisValue));
    if (!thisObject)
        return JSC::jsUndefined();

    JSValue value;
    if (thisObject->structureID() == getStructure<isBigInt>(defaultGlobalObject(globalObject))->id()) {
        value = thisObject->getDirect(static_cast<int>(field));
    } else {
        value = thisObject->get(globalObject, identifier(vm, field));
        RETURN_IF_EXCEPTION(scope, {});
    }

    double internalNumber = value.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = JSC::DateInstance::create(vm, globalObject->dateStructure(), internalNumber);
    thisObject->putDirect(vm, propertyName, result, 0);
    return result;
}

JSC_DEFINE_CUSTOM_GETTER(jsStatsPrototypeGetter_atime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::atime, false>(globalObject, thisValue, propertyName));
}
JSC_DEFINE_CUSTOM_GETTER(jsStatsPrototypeGetter_mtime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::mtime, false>(globalObject, thisValue, propertyName));
}
JSC_DEFINE_CUSTOM_GETTER(jsStatsPrototypeGetter_ctime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::ctime, false>(globalObject, thisValue, propertyName));
}
JSC_DEFINE_CUSTOM_GETTER(jsStatsPrototypeGetter_birthtime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::birthtime, false>(globalObject, thisValue, propertyName));
}

JSC_DEFINE_CUSTOM_GETTER(jsBigIntStatsPrototypeGetter_birthtime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::birthtime, true>(globalObject, thisValue, propertyName));
}
JSC_DEFINE_CUSTOM_GETTER(jsBigIntStatsPrototypeGetter_ctime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::ctime, true>(globalObject, thisValue, propertyName));
}

JSC_DEFINE_CUSTOM_GETTER(jsBigIntStatsPrototypeGetter_mtime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::mtime, true>(globalObject, thisValue, propertyName));
}

JSC_DEFINE_CUSTOM_GETTER(jsBigIntStatsPrototypeGetter_atime, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    return JSValue::encode(getDateField<DateFieldType::atime, true>(globalObject, thisValue, propertyName));
}

JSC_DEFINE_CUSTOM_SETTER(jsStatsPrototypeFunction_DatePutter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    JSObject* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->putDirect(vm, propertyName, JSValue::decode(encodedValue), 0);
    return true;
}

static const HashTableValue JSStatsPrototypeTableValues[] = {
    { "isBlockDevice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isBlockDevice, 0 } },
    { "isCharacterDevice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isCharacterDevice, 0 } },
    { "isDirectory"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isDirectory, 0 } },
    { "isFIFO"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isFIFO, 0 } },
    { "isFile"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isFile, 0 } },
    { "isSocket"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isSocket, 0 } },
    { "isSymbolicLink"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isSymbolicLink, 0 } },
    { "atime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsStatsPrototypeGetter_atime, jsStatsPrototypeFunction_DatePutter } },
    { "mtime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsStatsPrototypeGetter_mtime, jsStatsPrototypeFunction_DatePutter } },
    { "ctime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsStatsPrototypeGetter_ctime, jsStatsPrototypeFunction_DatePutter } },
    { "birthtime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsStatsPrototypeGetter_birthtime, jsStatsPrototypeFunction_DatePutter } },
};

static const HashTableValue JSBigIntStatsPrototypeTableValues[] = {
    { "isBlockDevice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isBlockDevice, 0 } },
    { "isCharacterDevice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isCharacterDevice, 0 } },
    { "isDirectory"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isDirectory, 0 } },
    { "isFIFO"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isFIFO, 0 } },
    { "isFile"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isFile, 0 } },
    { "isSocket"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isSocket, 0 } },
    { "isSymbolicLink"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatsPrototypeFunction_isSymbolicLink, 0 } },
    { "atime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsBigIntStatsPrototypeGetter_atime, jsStatsPrototypeFunction_DatePutter } },
    { "mtime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsBigIntStatsPrototypeGetter_mtime, jsStatsPrototypeFunction_DatePutter } },
    { "ctime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsBigIntStatsPrototypeGetter_ctime, jsStatsPrototypeFunction_DatePutter } },
    { "birthtime"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsBigIntStatsPrototypeGetter_birthtime, jsStatsPrototypeFunction_DatePutter } },
};

class JSStatsPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSStatsPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSStatsPrototype* prototype = new (NotNull, JSC::allocateCell<JSStatsPrototype>(vm)) JSStatsPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStatsPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSStatsPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));

        reifyStaticProperties(vm, this->classInfo(), JSStatsPrototypeTableValues, *this);
    }
};

class JSBigIntStatsPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBigIntStatsPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBigIntStatsPrototype* prototype = new (NotNull, JSC::allocateCell<JSBigIntStatsPrototype>(vm)) JSBigIntStatsPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBigIntStatsPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSBigIntStatsPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));

        reifyStaticProperties(vm, this->classInfo(), JSBigIntStatsPrototypeTableValues, *this);
    }
};

class JSStatsConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSStatsConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSStatsConstructor* constructor = new (NotNull, JSC::allocateCell<JSStatsConstructor>(vm)) JSStatsConstructor(vm, structure);
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
    JSStatsConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callStats, constructStats)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "Stats"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

class JSBigIntStatsConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBigIntStatsConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSBigIntStatsConstructor* constructor = new (NotNull, JSC::allocateCell<JSBigIntStatsConstructor>(vm)) JSBigIntStatsConstructor(vm, structure);
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
    JSBigIntStatsConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callBigIntStats, constructBigIntStats)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "BigIntStats"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

JSC::Structure* createJSStatsObjectStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* prototype = JSStatsPrototype::create(vm, globalObject, JSStatsPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    auto structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray,
        14);

    // Add property transitions for all stat fields
    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "dev"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ino"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "mode"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "nlink"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "uid"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "gid"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "rdev"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "size"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "blksize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "blocks"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "atimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "mtimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ctimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "birthtimeMs"_s), 0, offset);

    return structure;
}

JSC::Structure* createJSBigIntStatsObjectStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto prototype = JSBigIntStatsPrototype::create(vm, globalObject, JSBigIntStatsPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    auto structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray,
        18);

    // Add property transitions for all bigint stat fields
    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "dev"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ino"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "mode"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "nlink"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "uid"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "gid"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "rdev"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "size"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "blksize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "blocks"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "atimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "mtimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ctimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "birthtimeMs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "atimeNs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "mtimeNs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ctimeNs"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "birthtimeNs"_s), 0, offset);

    return structure;
}

extern "C" JSC::EncodedJSValue Bun__createJSStatsObject(Zig::GlobalObject* globalObject, int64_t dev,
    int64_t ino,
    int64_t mode,
    int64_t nlink,
    int64_t uid, int64_t gid, int64_t rdev, int64_t size, int64_t blksize, int64_t blocks, int64_t atimeMs, int64_t mtimeMs, int64_t ctimeMs, int64_t birthtimeMs)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue js_dev = JSC::jsDoubleNumber(dev);
    JSC::JSValue js_ino = JSC::jsDoubleNumber(ino);
    JSC::JSValue js_mode = JSC::jsDoubleNumber(mode);
    JSC::JSValue js_nlink = JSC::jsDoubleNumber(nlink);
    JSC::JSValue js_uid = JSC::jsDoubleNumber(uid);
    JSC::JSValue js_gid = JSC::jsDoubleNumber(gid);
    JSC::JSValue js_rdev = JSC::jsDoubleNumber(rdev);
    JSC::JSValue js_size = JSC::jsDoubleNumber(size);
    JSC::JSValue js_blksize = JSC::jsDoubleNumber(blksize);
    JSC::JSValue js_blocks = JSC::jsDoubleNumber(blocks);
    JSC::JSValue js_atimeMs = JSC::jsDoubleNumber(atimeMs);
    JSC::JSValue js_mtimeMs = JSC::jsDoubleNumber(mtimeMs);
    JSC::JSValue js_ctimeMs = JSC::jsDoubleNumber(ctimeMs);
    JSC::JSValue js_birthtimeMs = JSC::jsDoubleNumber(birthtimeMs);

    auto* structure = getStructure<false>(globalObject);
    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, 0, js_dev);
    object->putDirectOffset(vm, 1, js_ino);
    object->putDirectOffset(vm, 2, js_mode);
    object->putDirectOffset(vm, 3, js_nlink);
    object->putDirectOffset(vm, 4, js_uid);
    object->putDirectOffset(vm, 5, js_gid);
    object->putDirectOffset(vm, 6, js_rdev);
    object->putDirectOffset(vm, 7, js_size);
    object->putDirectOffset(vm, 8, js_blksize);
    object->putDirectOffset(vm, 9, js_blocks);
    object->putDirectOffset(vm, 10, js_atimeMs);
    object->putDirectOffset(vm, 11, js_mtimeMs);
    object->putDirectOffset(vm, 12, js_ctimeMs);
    object->putDirectOffset(vm, 13, js_birthtimeMs);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(object));
}

extern "C" JSC::EncodedJSValue Bun__createJSBigIntStatsObject(Zig::GlobalObject* globalObject,
    int64_t dev,
    int64_t ino,
    int64_t mode,
    int64_t nlink,
    int64_t uid,
    int64_t gid,
    int64_t rdev,
    int64_t size,
    int64_t blksize,
    int64_t blocks,
    int64_t atimeMs,
    int64_t mtimeMs,
    int64_t ctimeMs,
    int64_t birthtimeMs,
    uint64_t atimeNs,
    uint64_t mtimeNs,
    uint64_t ctimeNs,
    uint64_t birthtimeNs)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* structure = getStructure<true>(globalObject);
    JSC::JSValue js_dev = JSC::JSBigInt::createFrom(globalObject, dev);
    JSC::JSValue js_ino = JSC::JSBigInt::createFrom(globalObject, ino);
    JSC::JSValue js_mode = JSC::JSBigInt::createFrom(globalObject, mode);
    JSC::JSValue js_nlink = JSC::JSBigInt::createFrom(globalObject, nlink);
    JSC::JSValue js_uid = JSC::JSBigInt::createFrom(globalObject, uid);
    JSC::JSValue js_gid = JSC::JSBigInt::createFrom(globalObject, gid);
    JSC::JSValue js_rdev = JSC::JSBigInt::createFrom(globalObject, rdev);
    JSC::JSValue js_size = JSC::JSBigInt::createFrom(globalObject, size);
    JSC::JSValue js_blksize = JSC::JSBigInt::createFrom(globalObject, blksize);
    JSC::JSValue js_blocks = JSC::JSBigInt::createFrom(globalObject, blocks);
    JSC::JSValue js_atimeMs = JSC::JSBigInt::createFrom(globalObject, atimeMs);
    JSC::JSValue js_mtimeMs = JSC::JSBigInt::createFrom(globalObject, mtimeMs);
    JSC::JSValue js_ctimeMs = JSC::JSBigInt::createFrom(globalObject, ctimeMs);
    JSC::JSValue js_birthtimeMs = JSC::JSBigInt::createFrom(globalObject, birthtimeMs);
    JSC::JSValue js_atimeNs = JSC::JSBigInt::createFrom(globalObject, atimeNs);
    JSC::JSValue js_mtimeNs = JSC::JSBigInt::createFrom(globalObject, mtimeNs);
    JSC::JSValue js_ctimeNs = JSC::JSBigInt::createFrom(globalObject, ctimeNs);
    JSC::JSValue js_birthtimeNs = JSC::JSBigInt::createFrom(globalObject, birthtimeNs);
    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, 0, js_dev);
    object->putDirectOffset(vm, 1, js_ino);
    object->putDirectOffset(vm, 2, js_mode);
    object->putDirectOffset(vm, 3, js_nlink);
    object->putDirectOffset(vm, 4, js_uid);
    object->putDirectOffset(vm, 5, js_gid);
    object->putDirectOffset(vm, 6, js_rdev);
    object->putDirectOffset(vm, 7, js_size);
    object->putDirectOffset(vm, 8, js_blksize);
    object->putDirectOffset(vm, 9, js_blocks);
    object->putDirectOffset(vm, 10, js_atimeMs);
    object->putDirectOffset(vm, 11, js_mtimeMs);
    object->putDirectOffset(vm, 12, js_ctimeMs);
    object->putDirectOffset(vm, 13, js_birthtimeMs);
    object->putDirectOffset(vm, 14, js_atimeNs);
    object->putDirectOffset(vm, 15, js_mtimeNs);
    object->putDirectOffset(vm, 16, js_ctimeNs);
    object->putDirectOffset(vm, 17, js_birthtimeNs);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(object));
}

const JSC::ClassInfo JSStatsPrototype::s_info = { "Stats"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatsPrototype) };
const JSC::ClassInfo JSBigIntStatsPrototype::s_info = { "BigIntStats"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBigIntStatsPrototype) };
const JSC::ClassInfo JSStatsConstructor::s_info = { "Stats"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatsConstructor) };
const JSC::ClassInfo JSBigIntStatsConstructor::s_info = { "BigIntStats"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBigIntStatsConstructor) };

template<bool isBigInt>
inline JSValue callJSStatsFunction(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // function BigIntStats(dev, mode, nlink, uid, gid, rdev, blksize,
    //                      ino, size, blocks,
    //                      atimeNs, mtimeNs, ctimeNs, birthtimeNs) {

    // function Stats(dev, mode, nlink, uid, gid, rdev, blksize,
    //                ino, size, blocks,
    //                atimeMs, mtimeMs, ctimeMs, birthtimeMs) {
    auto* structure = getStructure<isBigInt>(defaultGlobalObject(globalObject));

    JSValue dev = callFrame->argument(0);
    JSValue mode = callFrame->argument(1);
    JSValue nlink = callFrame->argument(2);
    JSValue uid = callFrame->argument(3);
    JSValue gid = callFrame->argument(4);
    JSValue rdev = callFrame->argument(5);
    JSValue blksize = callFrame->argument(6);
    JSValue ino = callFrame->argument(7);
    JSValue size = callFrame->argument(8);
    JSValue blocks = callFrame->argument(9);
    JSValue atimeNs = callFrame->argument(10);
    JSValue mtimeNs = callFrame->argument(11);
    JSValue ctimeNs = callFrame->argument(12);
    JSValue birthtimeNs = callFrame->argument(13);

    JSValue atimeMs = atimeNs;
    JSValue mtimeMs = mtimeNs;
    JSValue ctimeMs = ctimeNs;
    JSValue birthtimeMs = birthtimeNs;

    if constexpr (isBigInt) {
        // this.atimeMs = atimeNs / kNsPerMsBigInt;
        // this.mtimeMs = mtimeNs / kNsPerMsBigInt;
        // this.ctimeMs = ctimeNs / kNsPerMsBigInt;
        // this.birthtimeMs = birthtimeNs / kNsPerMsBigInt;
        const double kNsPerMsBigInt = 1000000;
        atimeMs = jsDoubleNumber(atimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        mtimeMs = jsDoubleNumber(mtimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        ctimeMs = jsDoubleNumber(ctimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        birthtimeMs = jsDoubleNumber(birthtimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, 0, dev);
    object->putDirectOffset(vm, 1, mode);
    object->putDirectOffset(vm, 2, nlink);
    object->putDirectOffset(vm, 3, uid);
    object->putDirectOffset(vm, 4, gid);
    object->putDirectOffset(vm, 5, rdev);
    object->putDirectOffset(vm, 6, blksize);
    object->putDirectOffset(vm, 7, ino);
    object->putDirectOffset(vm, 8, size);
    object->putDirectOffset(vm, 9, blocks);

    object->putDirectOffset(vm, 10, atimeMs);
    object->putDirectOffset(vm, 11, mtimeMs);
    object->putDirectOffset(vm, 12, ctimeMs);
    object->putDirectOffset(vm, 13, birthtimeMs);

    if constexpr (isBigInt) {
        object->putDirectOffset(vm, 14, atimeNs);
        object->putDirectOffset(vm, 15, mtimeNs);
        object->putDirectOffset(vm, 16, ctimeNs);
        object->putDirectOffset(vm, 17, birthtimeNs);
    }

    return object;
}

template<bool isBigInt>
inline JSValue constructJSStatsObject(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* structure = getStructure<isBigInt>(globalObject);
    auto* constructor = getConstructor<isBigInt>(globalObject);
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
            getStructure<isBigInt>(functionGlobalObject));
    }

    JSValue dev = callFrame->argument(0);
    JSValue mode = callFrame->argument(1);
    JSValue nlink = callFrame->argument(2);
    JSValue uid = callFrame->argument(3);
    JSValue gid = callFrame->argument(4);
    JSValue rdev = callFrame->argument(5);
    JSValue blksize = callFrame->argument(6);
    JSValue ino = callFrame->argument(7);
    JSValue size = callFrame->argument(8);
    JSValue blocks = callFrame->argument(9);
    JSValue atimeNs = callFrame->argument(10);
    JSValue mtimeNs = callFrame->argument(11);
    JSValue ctimeNs = callFrame->argument(12);
    JSValue birthtimeNs = callFrame->argument(13);

    JSValue atimeMs = atimeNs;
    JSValue mtimeMs = mtimeNs;
    JSValue ctimeMs = ctimeNs;
    JSValue birthtimeMs = birthtimeNs;

    if constexpr (isBigInt) {
        // this.atimeMs = atimeNs / kNsPerMsBigInt;
        // this.mtimeMs = mtimeNs / kNsPerMsBigInt;
        // this.ctimeMs = ctimeNs / kNsPerMsBigInt;
        // this.birthtimeMs = birthtimeNs / kNsPerMsBigInt;
        const double kNsPerMsBigInt = 1000000;
        atimeMs = jsDoubleNumber(atimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        mtimeMs = jsDoubleNumber(mtimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        ctimeMs = jsDoubleNumber(ctimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        birthtimeMs = jsDoubleNumber(birthtimeNs.toNumber(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSFinalObject* object = JSC::JSFinalObject::create(vm, structure);
    object->putDirect(vm, Identifier::fromString(vm, "dev"_s), dev, 0);
    object->putDirect(vm, Identifier::fromString(vm, "mode"_s), mode, 0);
    object->putDirect(vm, Identifier::fromString(vm, "nlink"_s), nlink, 0);
    object->putDirect(vm, Identifier::fromString(vm, "uid"_s), uid, 0);
    object->putDirect(vm, Identifier::fromString(vm, "gid"_s), gid, 0);
    object->putDirect(vm, Identifier::fromString(vm, "rdev"_s), rdev, 0);
    object->putDirect(vm, Identifier::fromString(vm, "blksize"_s), blksize, 0);
    object->putDirect(vm, Identifier::fromString(vm, "ino"_s), ino, 0);
    object->putDirect(vm, Identifier::fromString(vm, "size"_s), size, 0);
    object->putDirect(vm, Identifier::fromString(vm, "blocks"_s), blocks, 0);
    object->putDirect(vm, Identifier::fromString(vm, "atimeMs"_s), atimeMs, 0);
    object->putDirect(vm, Identifier::fromString(vm, "mtimeMs"_s), mtimeMs, 0);
    object->putDirect(vm, Identifier::fromString(vm, "ctimeMs"_s), ctimeMs, 0);
    object->putDirect(vm, Identifier::fromString(vm, "birthtimeMs"_s), birthtimeMs, 0);

    if constexpr (isBigInt) {
        object->putDirect(vm, Identifier::fromString(vm, "atimeNs"_s), atimeNs, 0);
        object->putDirect(vm, Identifier::fromString(vm, "mtimeNs"_s), mtimeNs, 0);
        object->putDirect(vm, Identifier::fromString(vm, "ctimeNs"_s), ctimeNs, 0);
        object->putDirect(vm, Identifier::fromString(vm, "birthtimeNs"_s), birthtimeNs, 0);
    }

    return object;
}

JSC_DEFINE_HOST_FUNCTION(constructStats, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(constructJSStatsObject<false>(lexicalGlobalObject, callFrame));
}

JSC_DEFINE_HOST_FUNCTION(constructBigIntStats, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(constructJSStatsObject<true>(lexicalGlobalObject, callFrame));
}

JSC_DEFINE_HOST_FUNCTION(callStats, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(callJSStatsFunction<false>(lexicalGlobalObject, callFrame));
}

JSC_DEFINE_HOST_FUNCTION(callBigIntStats, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(callJSStatsFunction<true>(lexicalGlobalObject, callFrame));
}

extern "C" JSC::EncodedJSValue Bun__JSBigIntStatsObjectConstructor(Zig::GlobalObject* globalobject)
{
    return JSValue::encode(globalobject->m_JSStatsBigIntClassStructure.constructor(globalobject));
}

extern "C" JSC::EncodedJSValue Bun__JSStatsObjectConstructor(Zig::GlobalObject* globalobject)
{
    return JSValue::encode(globalobject->m_JSStatsClassStructure.constructor(globalobject));
}

void initJSStatsClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototype = JSStatsPrototype::create(init.vm, init.global, JSStatsPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = createJSStatsObjectStructure(init.vm, init.global);
    auto* constructor = JSStatsConstructor::create(init.vm, JSStatsConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

void initJSBigIntStatsClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototype = JSBigIntStatsPrototype::create(init.vm, init.global, JSBigIntStatsPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = createJSBigIntStatsObjectStructure(init.vm, init.global);
    auto* constructor = JSBigIntStatsConstructor::create(init.vm, JSBigIntStatsConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
