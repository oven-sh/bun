
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
#include "ObjectBindings.h"
#include "JavaScriptCore/DateInstance.h"
#if ENABLE(AOT)
#include <JavaScriptCore/AOTPropertyWalk.h>
#endif
#include <wtf/Int128.h>
#if !OS(WINDOWS)
#include <sys/stat.h>
#endif

namespace Bun {

class JSStatsPrototype;
class JSBigIntStatsPrototype;
class JSStatsConstructor;
class JSBigIntStatsConstructor;
using namespace JSC;
using namespace WebCore;

#if OS(WINDOWS)
#ifndef mode_t
#pragma push_macro("mode_t")
#define BUN_PUSHED_MODE_T
#define mode_t int32_t
#endif

#ifndef S_IFMT
#define S_IFMT 0170000
#endif

#ifndef S_IFDIR
#define S_IFDIR 0040000
#endif

#ifndef S_IFCHR
#define S_IFCHR 0020000
#endif

#ifndef S_IFBLK
#define S_IFBLK 0060000
#endif

#ifndef S_IFREG
#define S_IFREG 0100000
#endif

#ifndef S_IFIFO
#define S_IFIFO 0010000
#endif

#ifndef S_IFLNK
#define S_IFLNK 0120000
#endif

#ifndef S_IFSOCK
#define S_IFSOCK 0140000
#endif

#ifndef S_ISBLK
#define S_ISBLK(m) (((m) & S_IFMT) == S_IFBLK) /* block special */
#endif
#ifndef S_ISCHR
#define S_ISCHR(m) (((m) & S_IFMT) == S_IFCHR) /* char special */
#endif
#ifndef S_ISDIR
#define S_ISDIR(m) (((m) & S_IFMT) == S_IFDIR) /* directory */
#endif
#ifndef S_ISFIFO
#define S_ISFIFO(m) (((m) & S_IFMT) == S_IFIFO) /* fifo or socket */
#endif
#ifndef S_ISREG
#define S_ISREG(m) (((m) & S_IFMT) == S_IFREG) /* regular file */
#endif
#ifndef S_ISLNK
#define S_ISLNK(m) (((m) & S_IFMT) == S_IFLNK) /* symbolic link */
#endif
#ifndef S_ISSOCK
#define S_ISSOCK(m) (((m) & S_IFMT) == S_IFSOCK) /* socket */
#endif
#endif

JSC_DECLARE_HOST_FUNCTION(callStats);
JSC_DECLARE_HOST_FUNCTION(callBigIntStats);
JSC_DECLARE_HOST_FUNCTION(constructStats);
JSC_DECLARE_HOST_FUNCTION(constructBigIntStats);

enum class StatFunction {
    isBlockDevice,
    isCharacterDevice,
    isDirectory,
    isFIFO,
    isFile,
    isSocket,
    isSymbolicLink,
};

static bool isModeFn(StatFunction fn, mode_t mode)
{
    switch (fn) {
    case StatFunction::isBlockDevice:
        return S_ISBLK(mode);
    case StatFunction::isCharacterDevice:
        return S_ISCHR(mode);
    case StatFunction::isDirectory:
        return S_ISDIR(mode);
    case StatFunction::isFIFO:
        return S_ISFIFO(mode);
    case StatFunction::isFile:
        return S_ISREG(mode);
    case StatFunction::isSocket:
        return S_ISSOCK(mode);
    case StatFunction::isSymbolicLink:
        return S_ISLNK(mode);
    default: {
        ASSERT_NOT_REACHED();
    }
    }
}

template<StatFunction statFunction, bool isBigInt>
static JSValue modeStatFunction(JSC::JSGlobalObject* globalObject, CallFrame* callFrame)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSObject>(callFrame->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    if (!thisObject)
        return JSC::jsUndefined();

    JSValue modeValue = thisObject->get(globalObject, builtinNames(vm).modePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    if constexpr (isBigInt) {
        int64_t mode_value = modeValue.toBigInt64(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return jsBoolean(isModeFn(statFunction, mode_value));
    }

    mode_t mode = modeValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return jsBoolean(isModeFn(statFunction, mode));
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
    atime = 10,
    mtime = 11,
    ctime = 12,
    birthtime = 13,
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

    JSC::JSObject* thisObject = dynamicDowncast<JSC::JSObject>(JSC::JSValue::decode(thisValue).toThis(globalObject, JSC::ECMAMode::strict()));
    if (!thisObject)
        return JSC::jsUndefined();

    JSValue value;
    if (thisObject->structureID() == getStructure<isBigInt>(defaultGlobalObject(globalObject))->id()) {
        value = thisObject->getDirect(static_cast<int>(field));
        ASSERT(thisObject->getDirectOffset(vm, identifier(vm, field)) == static_cast<int>(field));
    } else {
        value = thisObject->get(globalObject, identifier(vm, field));
        RETURN_IF_EXCEPTION(scope, {});
    }

    double internalNumber = isBigInt ? value.toBigInt64(globalObject) : value.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = JSC::DateInstance::create(vm, globalObject->dateStructure(), internalNumber);
    if (!thisObject->structure()->mayBePrototype()) {
        putDirectOrThrow(globalObject, thisObject, propertyName, result, 0);
        RETURN_IF_EXCEPTION(scope, {});
    }
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
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue).toThis(globalObject, JSC::ECMAMode::strict()));
    if (!thisObject)
        return false;

    if (thisObject->type() == JSC::FinalObjectType || JSC::AOT::PropertyWalk::isCompiledObject(thisObject)) [[likely]]
        RELEASE_AND_RETURN(scope, putDirectOrThrow(globalObject, thisObject, propertyName, JSValue::decode(encodedValue), 0));
    // putDirect needs a structure transition, which a WebAssembly GC object doesn't support.
    RELEASE_AND_RETURN(scope, thisObject->createDataProperty(globalObject, propertyName, JSValue::decode(encodedValue), true));
}

JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isBlockDevice, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isBlockDevice, false>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isCharacterDevice, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isCharacterDevice, false>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isDirectory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isDirectory, false>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isFIFO, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isFIFO, false>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isFile, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isFile, false>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isSocket, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isSocket, false>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsStatsPrototypeFunction_isSymbolicLink, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isSymbolicLink, false>(globalObject, callframe));
}

JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isBlockDevice, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isBlockDevice, true>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isCharacterDevice, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isCharacterDevice, true>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isDirectory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isDirectory, true>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isFIFO, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isFIFO, true>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isFile, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isFile, true>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isSocket, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isSocket, true>(globalObject, callframe));
}
JSC_DEFINE_HOST_FUNCTION(jsBigIntStatsPrototypeFunction_isSymbolicLink, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(modeStatFunction<StatFunction::isSymbolicLink, true>(globalObject, callframe));
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
    { "isBlockDevice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isBlockDevice, 0 } },
    { "isCharacterDevice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isCharacterDevice, 0 } },
    { "isDirectory"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isDirectory, 0 } },
    { "isFIFO"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isFIFO, 0 } },
    { "isFile"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isFile, 0 } },
    { "isSocket"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isSocket, 0 } },
    { "isSymbolicLink"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBigIntStatsPrototypeFunction_isSymbolicLink, 0 } },
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
        JSStatsPrototype* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSStatsPrototype))) JSStatsPrototype(vm, structure);
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
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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

        Bun::reifyStaticPropertyTable(vm, this->classInfo(), JSStatsPrototypeTableValues, *this);
        Bun::putToStringTagWithoutTransition(vm, this, info());
    }
};

class JSBigIntStatsPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBigIntStatsPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBigIntStatsPrototype* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSBigIntStatsPrototype))) JSBigIntStatsPrototype(vm, structure);
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
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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

        Bun::reifyStaticPropertyTable(vm, this->classInfo(), JSBigIntStatsPrototypeTableValues, *this);
        Bun::putToStringTagWithoutTransition(vm, this, info());
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
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

// Node's own-key order, and a name's index is its property offset. Only a BigIntStats has the last four. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L386-L398
static constexpr ASCIILiteral statsFieldNames[] = {
    "dev"_s, "mode"_s, "nlink"_s, "uid"_s, "gid"_s, "rdev"_s, "blksize"_s, "ino"_s, "size"_s, "blocks"_s,
    "atimeMs"_s, "mtimeMs"_s, "ctimeMs"_s, "birthtimeMs"_s,
    "atimeNs"_s, "mtimeNs"_s, "ctimeNs"_s, "birthtimeNs"_s
};

// Intentionally not defined, to force consteval to fail.
PropertyOffset notAStatsField();

static consteval PropertyOffset statsFieldOffset(std::string_view name)
{
    for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(std::size(statsFieldNames)); ++offset) {
        if (name == std::string_view { statsFieldNames[offset].characters(), statsFieldNames[offset].length() })
            return offset;
    }
    return notAStatsField();
}

static constexpr unsigned statsFieldCount = statsFieldOffset("atimeNs");
static constexpr unsigned bigIntStatsFieldCount = std::size(statsFieldNames);
static_assert(statsFieldOffset("atimeMs") == static_cast<PropertyOffset>(DateFieldType::atime));
static_assert(statsFieldOffset("mtimeMs") == static_cast<PropertyOffset>(DateFieldType::mtime));
static_assert(statsFieldOffset("ctimeMs") == static_cast<PropertyOffset>(DateFieldType::ctime));
static_assert(statsFieldOffset("birthtimeMs") == static_cast<PropertyOffset>(DateFieldType::birthtime));

static JSC::Structure* createStatsObjectStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype, unsigned fieldCount)
{
    auto structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray, fieldCount);

    PropertyOffset offset = 0;
    for (unsigned i = 0; i < fieldCount; ++i) {
        structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, statsFieldNames[i]), 0, offset);
        ASSERT(offset == static_cast<PropertyOffset>(i));
    }

    return structure;
}

extern "C" JSC::EncodedJSValue Bun__createJSStatsObject(Zig::GlobalObject* globalObject, uint64_t dev,
    uint64_t ino,
    uint64_t mode,
    uint64_t nlink,
    uint64_t uid, uint64_t gid, uint64_t rdev, uint64_t size, uint64_t blksize, uint64_t blocks, double atimeMs, double mtimeMs, double ctimeMs, double birthtimeMs)
{
    auto& vm = globalObject->vm();

    JSC::JSValue js_dev = JSC::jsNumber(dev);
    JSC::JSValue js_ino = JSC::jsNumber(ino);
    JSC::JSValue js_mode = JSC::jsNumber(mode);
    JSC::JSValue js_nlink = JSC::jsNumber(nlink);
    JSC::JSValue js_uid = JSC::jsNumber(uid);
    JSC::JSValue js_gid = JSC::jsNumber(gid);
    JSC::JSValue js_rdev = JSC::jsNumber(rdev);
    JSC::JSValue js_size = JSC::jsNumber(size);
    JSC::JSValue js_blksize = JSC::jsNumber(blksize);
    JSC::JSValue js_blocks = JSC::jsNumber(blocks);
    JSC::JSValue js_atimeMs = JSC::jsNumber(atimeMs);
    JSC::JSValue js_mtimeMs = JSC::jsNumber(mtimeMs);
    JSC::JSValue js_ctimeMs = JSC::jsNumber(ctimeMs);
    JSC::JSValue js_birthtimeMs = JSC::jsNumber(birthtimeMs);

    auto* structure = getStructure<false>(globalObject);
    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, statsFieldOffset("dev"), js_dev);
    object->putDirectOffset(vm, statsFieldOffset("ino"), js_ino);
    object->putDirectOffset(vm, statsFieldOffset("mode"), js_mode);
    object->putDirectOffset(vm, statsFieldOffset("nlink"), js_nlink);
    object->putDirectOffset(vm, statsFieldOffset("uid"), js_uid);
    object->putDirectOffset(vm, statsFieldOffset("gid"), js_gid);
    object->putDirectOffset(vm, statsFieldOffset("rdev"), js_rdev);
    object->putDirectOffset(vm, statsFieldOffset("size"), js_size);
    object->putDirectOffset(vm, statsFieldOffset("blksize"), js_blksize);
    object->putDirectOffset(vm, statsFieldOffset("blocks"), js_blocks);
    object->putDirectOffset(vm, statsFieldOffset("atimeMs"), js_atimeMs);
    object->putDirectOffset(vm, statsFieldOffset("mtimeMs"), js_mtimeMs);
    object->putDirectOffset(vm, statsFieldOffset("ctimeMs"), js_ctimeMs);
    object->putDirectOffset(vm, statsFieldOffset("birthtimeMs"), js_birthtimeMs);

    return JSC::JSValue::encode(object);
}

static constexpr WTF::Int128 kNsPerSec = 1'000'000'000;
static constexpr WTF::Int128 kNsPerMs = 1'000'000;

static ALWAYS_INLINE WTF::Int128 timespecToNs(int64_t sec, int64_t nsec)
{
    return static_cast<WTF::Int128>(sec) * kNsPerSec + static_cast<WTF::Int128>(nsec);
}

extern "C" JSC::EncodedJSValue Bun__createJSBigIntStatsObject(Zig::GlobalObject* globalObject,
    uint64_t dev,
    uint64_t ino,
    uint64_t mode,
    uint64_t nlink,
    uint64_t uid,
    uint64_t gid,
    uint64_t rdev,
    uint64_t size,
    uint64_t blksize,
    uint64_t blocks,
    int64_t atimeSec,
    int64_t atimeNsec,
    int64_t mtimeSec,
    int64_t mtimeNsec,
    int64_t ctimeSec,
    int64_t ctimeNsec,
    int64_t birthtimeSec,
    int64_t birthtimeNsec)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* structure = getStructure<true>(globalObject);

    // Node computes atimeNs = sec * 1e9n + nsec and atimeMs = atimeNs / 1e6n.
    const WTF::Int128 atimeNs = timespecToNs(atimeSec, atimeNsec);
    const WTF::Int128 mtimeNs = timespecToNs(mtimeSec, mtimeNsec);
    const WTF::Int128 ctimeNs = timespecToNs(ctimeSec, ctimeNsec);
    const WTF::Int128 birthtimeNs = timespecToNs(birthtimeSec, birthtimeNsec);

    // Node.js fills a BigInt64Array via static_cast<int64_t>(uint64_t).
    JSC::JSValue js_dev = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(dev));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_ino = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(ino));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_mode = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(mode));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_nlink = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(nlink));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_uid = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(uid));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_gid = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(gid));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_rdev = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(rdev));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_size = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(size));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_blksize = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(blksize));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_blocks = JSC::JSBigInt::createFrom(globalObject, static_cast<int64_t>(blocks));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_atimeMs = JSC::JSBigInt::createFrom(globalObject, atimeNs / kNsPerMs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_mtimeMs = JSC::JSBigInt::createFrom(globalObject, mtimeNs / kNsPerMs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_ctimeMs = JSC::JSBigInt::createFrom(globalObject, ctimeNs / kNsPerMs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_birthtimeMs = JSC::JSBigInt::createFrom(globalObject, birthtimeNs / kNsPerMs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_atimeNs = JSC::JSBigInt::createFrom(globalObject, atimeNs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_mtimeNs = JSC::JSBigInt::createFrom(globalObject, mtimeNs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_ctimeNs = JSC::JSBigInt::createFrom(globalObject, ctimeNs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue js_birthtimeNs = JSC::JSBigInt::createFrom(globalObject, birthtimeNs);
    RETURN_IF_EXCEPTION(scope, {});

    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, statsFieldOffset("dev"), js_dev);
    object->putDirectOffset(vm, statsFieldOffset("ino"), js_ino);
    object->putDirectOffset(vm, statsFieldOffset("mode"), js_mode);
    object->putDirectOffset(vm, statsFieldOffset("nlink"), js_nlink);
    object->putDirectOffset(vm, statsFieldOffset("uid"), js_uid);
    object->putDirectOffset(vm, statsFieldOffset("gid"), js_gid);
    object->putDirectOffset(vm, statsFieldOffset("rdev"), js_rdev);
    object->putDirectOffset(vm, statsFieldOffset("size"), js_size);
    object->putDirectOffset(vm, statsFieldOffset("blksize"), js_blksize);
    object->putDirectOffset(vm, statsFieldOffset("blocks"), js_blocks);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::atime), js_atimeMs);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::mtime), js_mtimeMs);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::ctime), js_ctimeMs);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::birthtime), js_birthtimeMs);
    object->putDirectOffset(vm, statsFieldOffset("atimeNs"), js_atimeNs);
    object->putDirectOffset(vm, statsFieldOffset("mtimeNs"), js_mtimeNs);
    object->putDirectOffset(vm, statsFieldOffset("ctimeNs"), js_ctimeNs);
    object->putDirectOffset(vm, statsFieldOffset("birthtimeNs"), js_birthtimeNs);

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
        atimeMs = jsDoubleNumber(atimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        mtimeMs = jsDoubleNumber(mtimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        ctimeMs = jsDoubleNumber(ctimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        birthtimeMs = jsDoubleNumber(birthtimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* object = JSC::JSFinalObject::create(vm, structure);

    object->putDirectOffset(vm, statsFieldOffset("dev"), dev);
    object->putDirectOffset(vm, statsFieldOffset("ino"), ino);
    object->putDirectOffset(vm, statsFieldOffset("mode"), mode);
    object->putDirectOffset(vm, statsFieldOffset("nlink"), nlink);
    object->putDirectOffset(vm, statsFieldOffset("uid"), uid);
    object->putDirectOffset(vm, statsFieldOffset("gid"), gid);
    object->putDirectOffset(vm, statsFieldOffset("rdev"), rdev);
    object->putDirectOffset(vm, statsFieldOffset("size"), size);
    object->putDirectOffset(vm, statsFieldOffset("blksize"), blksize);
    object->putDirectOffset(vm, statsFieldOffset("blocks"), blocks);

    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::atime), atimeMs);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::mtime), mtimeMs);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::ctime), ctimeMs);
    object->putDirectOffset(vm, static_cast<unsigned>(DateFieldType::birthtime), birthtimeMs);

    if constexpr (isBigInt) {
        object->putDirectOffset(vm, statsFieldOffset("atimeNs"), atimeNs);
        object->putDirectOffset(vm, statsFieldOffset("mtimeNs"), mtimeNs);
        object->putDirectOffset(vm, statsFieldOffset("ctimeNs"), ctimeNs);
        object->putDirectOffset(vm, statsFieldOffset("birthtimeNs"), birthtimeNs);
    }

    return object;
}

// The builtin names table already holds the four `*Ms` names.
template<size_t offset>
static ALWAYS_INLINE void putStatsFieldByName(JSC::VM& vm, JSC::JSObject* object, JSValue value)
{
    if constexpr (offset >= static_cast<size_t>(DateFieldType::atime) && offset <= static_cast<size_t>(DateFieldType::birthtime))
        object->putDirect(vm, identifier(vm, static_cast<DateFieldType>(offset)), value, 0);
    else
        object->putDirect(vm, JSC::Identifier::fromString(vm, statsFieldNames[offset]), value, 0);
}

// One put per field, in the order of the list. A subclass structure has no properties yet, so that order is its own-key order.
template<size_t... offsets>
static ALWAYS_INLINE void putStatsFieldsByName(JSC::VM& vm, JSC::JSObject* object, const JSValue* values, std::index_sequence<offsets...>)
{
    (putStatsFieldByName<offsets>(vm, object, values[offsets]), ...);
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
        // ShadowRealm functions belong to a different global object.
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(lexicalGlobalObject, newTarget));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, getStructure<isBigInt>(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
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
        atimeMs = jsDoubleNumber(atimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        mtimeMs = jsDoubleNumber(mtimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        ctimeMs = jsDoubleNumber(ctimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
        birthtimeMs = jsDoubleNumber(birthtimeNs.toBigInt64(globalObject) / kNsPerMsBigInt);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSFinalObject* object = JSC::JSFinalObject::create(vm, structure);
    JSValue values[bigIntStatsFieldCount];
    values[statsFieldOffset("dev")] = dev;
    values[statsFieldOffset("mode")] = mode;
    values[statsFieldOffset("nlink")] = nlink;
    values[statsFieldOffset("uid")] = uid;
    values[statsFieldOffset("gid")] = gid;
    values[statsFieldOffset("rdev")] = rdev;
    values[statsFieldOffset("blksize")] = blksize;
    values[statsFieldOffset("ino")] = ino;
    values[statsFieldOffset("size")] = size;
    values[statsFieldOffset("blocks")] = blocks;
    values[statsFieldOffset("atimeMs")] = atimeMs;
    values[statsFieldOffset("mtimeMs")] = mtimeMs;
    values[statsFieldOffset("ctimeMs")] = ctimeMs;
    values[statsFieldOffset("birthtimeMs")] = birthtimeMs;
    if constexpr (isBigInt) {
        values[statsFieldOffset("atimeNs")] = atimeNs;
        values[statsFieldOffset("mtimeNs")] = mtimeNs;
        values[statsFieldOffset("ctimeNs")] = ctimeNs;
        values[statsFieldOffset("birthtimeNs")] = birthtimeNs;
    }

    putStatsFieldsByName(vm, object, values, std::make_index_sequence<isBigInt ? bigIntStatsFieldCount : statsFieldCount>());

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
    auto* structure = createStatsObjectStructure(init.vm, init.global, prototype, statsFieldCount);
    auto* constructor = JSStatsConstructor::create(init.vm, JSStatsConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

void initJSBigIntStatsClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototype = JSBigIntStatsPrototype::create(init.vm, init.global, JSBigIntStatsPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = createStatsObjectStructure(init.vm, init.global, prototype, bigIntStatsFieldCount);
    auto* constructor = JSBigIntStatsConstructor::create(init.vm, JSBigIntStatsConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun

#ifdef BUN_PUSHED_MODE_T
#pragma pop_macro("mode_t")
#undef BUN_PUSHED_MODE_T
#endif
