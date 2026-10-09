#include "root.h"

#include "BunClientData.h"
#include "BunProcess.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include <JavaScriptCore/PropertyNameArray.h>

extern "C" bool Bun__getEnvValue(JSC::JSGlobalObject* globalObject, const EncodedSlice* name, EncodedSlice* value);

namespace Bun {

using namespace JSC;

static bool isSSR(PropertyName propertyName)
{
    return WTF::equal(propertyName.publicName(), "SSR"_s);
}

static bool isBooleanVariable(PropertyName propertyName)
{
    auto* name = propertyName.publicName();
    return WTF::equal(name, "DEV"_s) || WTF::equal(name, "PROD"_s) || isSSR(propertyName);
}

// As in Vite, NODE_ENV decides, not MODE, and what a test assigns to it later does not count.
static bool startedInProduction(Zig::GlobalObject* globalObject)
{
    EncodedSlice name = Zig::toEncodedSlice(StringView("NODE_ENV"_s));
    EncodedSlice value = { nullptr, 0 };
    return Bun__getEnvValue(globalObject, &name, &value) && Zig::toStringCopy(value) == "production"_s;
}

// `import.meta.env` under `bun test`: a view of `process.env`. Its own properties, which nothing changes, are what Vite's variables default to.
class ImportMetaEnv final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags
        | OverridesGetOwnPropertySlot
        | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero
        | OverridesPut
        | OverridesGetOwnPropertyNames
        | ProhibitsPropertyCaching;

    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ImportMetaEnv, Base);
        return &vm.plainObjectSpace();
    }

    static ImportMetaEnv* create(VM& vm, Zig::GlobalObject* globalObject)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
        auto* env = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(ImportMetaEnv))) ImportMetaEnv(vm, structure);
        env->finishCreation(vm, globalObject);
        return env;
    }

    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&);
    static bool getOwnPropertySlotByIndex(JSObject*, JSGlobalObject*, unsigned, PropertySlot&);
    static bool put(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&);
    static bool putByIndex(JSCell*, JSGlobalObject*, unsigned, JSValue, bool shouldThrow);
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&);
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode);
    static bool defineOwnProperty(JSObject*, JSGlobalObject*, PropertyName, const PropertyDescriptor&, bool shouldThrow);
    static bool preventExtensions(JSObject*, JSGlobalObject*) { return false; }

private:
    ImportMetaEnv(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM&, Zig::GlobalObject*);
    Zig::GlobalObject* zigGlobalObject() const { return uncheckedDowncast<Zig::GlobalObject>(globalObject()); }
    JSObject* processEnv(JSGlobalObject*) const;
};

const ClassInfo ImportMetaEnv::s_info = { "ImportMetaEnv"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ImportMetaEnv) };

void ImportMetaEnv::finishCreation(VM& vm, Zig::GlobalObject* globalObject)
{
    Base::finishCreation(vm);
    bool isProduction = startedInProduction(globalObject);
    // In the order Vitest adds them to the environment.
    putDirectNamed(vm, this, "BASE_URL"_s, vm.smallStrings.singleCharacterString('/'));
    putDirectNamed(vm, this, "MODE"_s, jsNontrivialString(vm, "test"_s));
    putDirectNamed(vm, this, "DEV"_s, jsBoolean(!isProduction));
    putDirectNamed(vm, this, "PROD"_s, jsBoolean(isProduction));
    // Whether there is no `document`: see getOwnPropertySlot.
    putDirectNamed(vm, this, "SSR"_s, jsBoolean(true));
}

// What `process.env` is now: tests replace it with a copy.
JSObject* ImportMetaEnv::processEnv(JSGlobalObject* lexicalGlobalObject) const
{
    auto& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // `process.env` can be an exotic object that comes back here.
    if (!vm.isSafeToRecurseSoft()) [[unlikely]] {
        throwStackOverflowError(lexicalGlobalObject, scope);
        return nullptr;
    }

    auto* globalObject = zigGlobalObject();
    JSValue env = globalObject->processObject()->get(globalObject, Identifier::fromString(vm, "env"_s));
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSObject* object = env.getObject();
    if (!object || object->inherits<ImportMetaEnv>()) [[unlikely]]
        return globalObject->processEnvObject();
    return object;
}

bool ImportMetaEnv::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = uncheckedDowncast<ImportMetaEnv>(object);

    slot.disableCaching();
    slot.setIsTaintedByOpaqueObject();
    if (slot.isVMInquiry() || propertyName.isPrivateName())
        return false;

    JSObject* env = thisObject->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    // Its own slot, so that an accessor of `process.env` runs on `process.env` and only its result gets out.
    PropertySlot envSlot(env, PropertySlot::InternalMethodType::GetOwnProperty);
    bool exists = env->methodTable()->getOwnPropertySlot(env, globalObject, propertyName, envSlot);
    RETURN_IF_EXCEPTION(scope, false);

    JSValue value;
    if (exists) {
        // A getter that a Proxy answers with is one of its target: on Windows `process.env` is a Proxy, which keeps TZ that way.
        value = envSlot.isAccessor() && env->type() == ProxyObjectType ? env->get(globalObject, propertyName) : envSlot.getValue(globalObject, propertyName);
        RETURN_IF_EXCEPTION(scope, false);
        // On Windows `process.env` keeps its `toJSON` and `Bun.inspect.custom` among its properties, and they show `process.env`.
        exists = !value.isCallable();
    }
    if (!exists) {
        if (!Base::getOwnPropertySlot(thisObject, globalObject, propertyName, slot))
            return false;
        slot.disableCaching();
        if (isSSR(propertyName)) {
            auto* realm = thisObject->zigGlobalObject();
            bool hasDocument = realm->hasProperty(realm, Identifier::fromString(vm, "document"_s));
            RETURN_IF_EXCEPTION(scope, false);
            slot.setValue(thisObject, 0, jsBoolean(!hasDocument));
        }
        return true;
    }

    if (isBooleanVariable(propertyName))
        value = jsBoolean(value.toBoolean(globalObject));
    slot.setValue(thisObject, envSlot.attributes() & (PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete), value);
    return true;
}

bool ImportMetaEnv::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    return getOwnPropertySlot(object, globalObject, Identifier::from(getVM(globalObject), index), slot);
}

bool ImportMetaEnv::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // A write to an object that inherits from this one is that object's.
    if (slot.thisValue() != cell) [[unlikely]]
        RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, propertyName, value, slot));

    JSObject* env = uncheckedDowncast<ImportMetaEnv>(cell)->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (isBooleanVariable(propertyName))
        value = value.toBoolean(globalObject) ? vm.smallStrings.singleCharacterString('1') : jsEmptyString(vm);
    PutPropertySlot envSlot(env, slot.isStrictMode());
    RELEASE_AND_RETURN(scope, env->methodTable()->put(env, globalObject, propertyName, value, envSlot));
}

bool ImportMetaEnv::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    PutPropertySlot slot(cell, shouldThrow);
    return put(cell, globalObject, Identifier::from(getVM(globalObject), index), value, slot);
}

bool ImportMetaEnv::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, DeletePropertySlot&)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));

    JSObject* env = uncheckedDowncast<ImportMetaEnv>(cell)->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, JSCell::deleteProperty(env, globalObject, propertyName));
}

bool ImportMetaEnv::deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));

    JSObject* env = uncheckedDowncast<ImportMetaEnv>(cell)->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, env->methodTable()->deletePropertyByIndex(env, globalObject, index));
}

void ImportMetaEnv::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));

    JSObject* env = uncheckedDowncast<ImportMetaEnv>(object)->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    env->methodTable()->getOwnPropertyNames(env, globalObject, propertyNames, mode);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, Base::getOwnPropertyNames(object, globalObject, propertyNames, mode));
}

bool ImportMetaEnv::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));

    JSObject* env = uncheckedDowncast<ImportMetaEnv>(object)->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, env->methodTable()->defineOwnProperty(env, globalObject, propertyName, descriptor, shouldThrow));
}

JSObject* createImportMetaEnvForTests(Zig::GlobalObject* globalObject)
{
    return ImportMetaEnv::create(getVM(globalObject), globalObject);
}

}
