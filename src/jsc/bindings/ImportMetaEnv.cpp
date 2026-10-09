#include "root.h"

#include "BunClientData.h"
#include "BunProcess.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include <JavaScriptCore/PropertyNameArray.h>

extern "C" bool Bun__getEnvValue(JSC::JSGlobalObject* globalObject, const EncodedSlice* name, EncodedSlice* value);

namespace Bun {

using namespace JSC;

// In the order Vitest adds them to the environment.
enum class ViteVariable : uint8_t {
    BaseURL,
    Mode,
    Dev,
    Prod,
    SSR,
};

static constexpr std::array viteVariableNames { "BASE_URL"_s, "MODE"_s, "DEV"_s, "PROD"_s, "SSR"_s };

static std::optional<ViteVariable> viteVariableNamed(PropertyName propertyName)
{
    auto* name = propertyName.publicName();
    if (!name)
        return std::nullopt;
    for (size_t i = 0; i < viteVariableNames.size(); i++) {
        if (name->length() == viteVariableNames[i].length() && WTF::equal(name, viteVariableNames[i]))
            return static_cast<ViteVariable>(i);
    }
    return std::nullopt;
}

static bool isBoolean(std::optional<ViteVariable> variable)
{
    return variable && *variable >= ViteVariable::Dev;
}

// As in Vite, NODE_ENV decides, not MODE, and what a test assigns to it later does not count.
static bool startedInProduction(Zig::GlobalObject* globalObject)
{
    auto nodeEnv = "NODE_ENV"_s.span8();
    EncodedSlice name = { nodeEnv.data(), nodeEnv.size() };
    EncodedSlice value = { nullptr, 0 };
    return Bun__getEnvValue(globalObject, &name, &value) && WTF::equalSpans(std::span { Zig::untag(value.ptr), value.len }, "production"_s.span8());
}

// `import.meta.env` under `bun test`: a view of `process.env` that has Vite's variables. The cell holds nothing: its hooks never look at its own storage.
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
        env->finishCreation(vm);
        env->setPerCellBit(startedInProduction(globalObject));
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

    Zig::GlobalObject* zigGlobalObject() const { return uncheckedDowncast<Zig::GlobalObject>(globalObject()); }
    // Kept in the one bit of a cell that is its class's to use.
    bool isProduction() const { return perCellBit(); }
    JSObject* processEnv(JSGlobalObject*) const;
    JSValue defaultValueOf(ViteVariable) const;
};

const ClassInfo ImportMetaEnv::s_info = { "ImportMetaEnv"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ImportMetaEnv) };

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
    JSObject* process = globalObject->processObject();
    auto& name = WebCore::builtinNames(vm).envPublicName();
    unsigned attributes = 0;
    JSValue env = process->getDirect(vm, name, attributes);
    // Not made yet, or an accessor.
    if (!env || (attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[unlikely]] {
        env = process->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    JSObject* object = env.getObject();
    if (!object || object->classInfo() == info()) [[unlikely]]
        return globalObject->processEnvObject();
    return object;
}

JSValue ImportMetaEnv::defaultValueOf(ViteVariable variable) const
{
    auto* globalObject = zigGlobalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (variable) {
    case ViteVariable::BaseURL:
        return vm.smallStrings.singleCharacterString('/');
    case ViteVariable::Mode:
        return jsNontrivialString(vm, "test"_s);
    case ViteVariable::Dev:
        return jsBoolean(!isProduction());
    case ViteVariable::Prod:
        return jsBoolean(isProduction());
    case ViteVariable::SSR: {
        bool hasDocument = globalObject->hasProperty(globalObject, WebCore::builtinNames(vm).documentPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        return jsBoolean(!hasDocument);
    }
    }
    RELEASE_ASSERT_NOT_REACHED();
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
    bool exists = env->getOwnPropertySlotInline(globalObject, propertyName, envSlot);
    RETURN_IF_EXCEPTION(scope, false);

    JSValue value;
    if (exists) {
        // A getter that a Proxy answers with is one of its target: on Windows `process.env` is a Proxy, which keeps TZ that way.
        value = envSlot.isAccessor() && env->type() == ProxyObjectType ? env->get(globalObject, propertyName) : envSlot.getValue(globalObject, propertyName);
        RETURN_IF_EXCEPTION(scope, false);
        // On Windows `process.env` keeps its `toJSON` and `Bun.inspect.custom` among its properties, and they show `process.env`.
        exists = !value.isCallable();
    }
    auto variable = viteVariableNamed(propertyName);
    if (!exists) {
        if (!variable)
            return false;
        value = thisObject->defaultValueOf(*variable);
        RETURN_IF_EXCEPTION(scope, false);
        slot.setValue(thisObject, 0, value);
        return true;
    }

    if (isBoolean(variable))
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
    if (isBoolean(viteVariableNamed(propertyName)))
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
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* env = uncheckedDowncast<ImportMetaEnv>(object)->processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    env->methodTable()->getOwnPropertyNames(env, globalObject, propertyNames, mode);
    RETURN_IF_EXCEPTION(scope, );
    for (auto literal : viteVariableNames) {
        auto name = Identifier::fromString(vm, literal);
        // One that `process.env` has and does not enumerate is not enumerable here either.
        if (mode == DontEnumPropertiesMode::Exclude) {
            PropertySlot slot(env, PropertySlot::InternalMethodType::GetOwnProperty);
            bool exists = env->methodTable()->getOwnPropertySlot(env, globalObject, name, slot);
            RETURN_IF_EXCEPTION(scope, );
            if (exists && (slot.attributes() & PropertyAttribute::DontEnum))
                continue;
        }
        propertyNames.add(name);
    }
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

// As with a Proxy, script never sees what native code puts in the storage of the cell.
bool isImportMetaEnvForTests(JSObject* object)
{
    return object->inherits<ImportMetaEnv>();
}

}
