#include "root.h"
#include "ZigGlobalObject.h"

#include "helpers.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>

#include "BunClientData.h"
#include "wtf/Compiler.h"
#include "wtf/Forward.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/PropertyDescriptor.h>
#include "BunProcess.h"
#include "wtf/Lock.h"
#include "wtf/NeverDestroyed.h"
#include "wtf/HashMap.h"
#include "wtf/text/StringHash.h"
#include "WebCoreJSBuiltins.h"

using namespace JSC;

extern "C" size_t Bun__getEnvCount(JSGlobalObject* globalObject, void** list_ptr);
extern "C" size_t Bun__getEnvKey(void* list, size_t index, unsigned char** out);

extern "C" bool Bun__getEnvValue(JSGlobalObject* globalObject, const ZigString* name, ZigString* value);
extern "C" bool Bun__getEnvValueBunString(JSGlobalObject* globalObject, const BunString* name, BunString* value);
extern "C" void Bun__setEnvValue(JSGlobalObject* globalObject, const BunString* name, const BunString* value);

namespace Bun {

using namespace WebCore;

JSC_DEFINE_CUSTOM_GETTER(jsGetterEnvironmentVariable, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (name.len == 0) [[unlikely]]
        return JSValue::encode(jsUndefined());

    if (!Bun__getEnvValue(globalObject, &name, &value)) {
        return JSValue::encode(jsUndefined());
    }

    JSValue result = jsString(vm, Zig::toStringCopy(value));
    thisObject->putDirect(vm, propertyName, result, 0);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_SETTER(jsSetterEnvironmentVariable, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;

    auto string = JSValue::decode(value).toString(globalObject);
    if (!string) [[unlikely]]
        return false;

    object->putDirect(vm, propertyName, string, 0);
    return true;
}

// Proxy-related env vars (HTTP_PROXY, HTTPS_PROXY, NO_PROXY and lowercase
// variants) are read by fetch()'s native proxy resolution via
// env_loader.getHttpProxyFor(). Writes from JS must sync back to the native env
// map so runtime changes take effect. Unlike the generic getter, this does
// NOT cache on the JS object — the native env map is the single source of truth
// so set-then-get stays consistent and the CustomAccessor isn't clobbered.
JSC_DEFINE_CUSTOM_GETTER(jsGetterProxyEnvironmentVariable, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    BunString name = Bun::toStringView(propertyName.publicName());
    BunString value = { BunStringTag::Dead };
    if (!Bun__getEnvValueBunString(globalObject, &name, &value)) {
        return JSValue::encode(jsUndefined());
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, value.toWTFString())));
}

JSC_DEFINE_CUSTOM_SETTER(jsSetterProxyEnvironmentVariable, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;

    auto* string = JSValue::decode(value).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (!string) [[unlikely]]
        return false;

    auto view = string->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    BunString name = Bun::toStringView(propertyName.publicName());
    BunString val = Bun::toStringView(view);
    Bun__setEnvValue(globalObject, &name, &val);

    // The proxy-var accessors are added with `DontEnum` when the var was not
    // present in the OS env at startup. The regular env-var setter
    // (`jsSetterEnvironmentVariable`) makes a written var enumerable by
    // replacing the accessor with a data property; this setter keeps the
    // accessor (so the native env map stays the source of truth) but must
    // still clear `DontEnum` — otherwise `process.env.HTTP_PROXY = "..."`
    // followed by `Bun.spawn({env: {...process.env}})` silently drops the var
    // (the spread skips non-enumerable properties).
    unsigned attributes;
    JSValue existing = object->getDirect(vm, propertyName, attributes);
    if (existing && (attributes & JSC::PropertyAttribute::DontEnum)) {
        // putDirectCustomAccessor asserts NewProperty, so delete first.
        object->deleteProperty(globalObject, propertyName);
        RETURN_IF_EXCEPTION(scope, false);
        object->putDirectCustomAccessor(vm, propertyName, existing,
            attributes & ~JSC::PropertyAttribute::DontEnum);
    }
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsTimeZoneEnvironmentVariableGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    auto* clientData = WebCore::clientData(vm);

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    auto hasExistingValue = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().dataPrivateName());
    RETURN_IF_EXCEPTION(scope, {});
    if (hasExistingValue) {
        return JSValue::encode(hasExistingValue);
    }

    if (!Bun__getEnvValue(globalObject, &name, &value) || value.len == 0) {
        return JSValue::encode(jsUndefined());
    }

    JSValue out = jsString(vm, Zig::toStringCopy(value));
    thisObject->putDirect(vm, clientData->builtinNames().dataPrivateName(), out, 0);

    return JSValue::encode(out);
}

// In Node.js, the "TZ" environment variable is special.
// Setting it automatically updates the timezone.
// We also expose an explicit setTimeZone function in bun:jsc
JSC_DEFINE_CUSTOM_SETTER(jsTimeZoneEnvironmentVariableSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;

    JSValue decodedValue = JSValue::decode(value);
    if (decodedValue.isString()) {
        auto timeZoneName = decodedValue.toWTFString(globalObject);
        if (timeZoneName.length() < 32) {
            if (WTF::setTimeZoneOverride(timeZoneName)) {
                vm.dateCache.resetIfNecessarySlow();
            }
        }
    }

    auto* clientData = WebCore::clientData(vm);
    auto* builtinNames = &clientData->builtinNames();
    auto privateName = builtinNames->dataPrivateName();
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

extern "C" int Bun__getTLSRejectUnauthorizedValue();
extern "C" int Bun__setTLSRejectUnauthorizedValue(int value);
extern "C" int Bun__getVerboseFetchValue();
extern "C" int Bun__setVerboseFetchValue(int value);

ALWAYS_INLINE static Identifier NODE_TLS_REJECT_UNAUTHORIZED_PRIVATE_PROPERTY(VM& vm)
{
    auto* clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    // We just pick one to reuse. This will never be exposed to a user. And we
    // don't want to pay the cost of adding another one.
    return builtinNames.textDecoderStreamDecoderPrivateName();
}

ALWAYS_INLINE static Identifier BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(VM& vm)
{
    auto* clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    // We just pick one to reuse. This will never be exposed to a user. And we
    // don't want to pay the cost of adding another one.
    return builtinNames.textEncoderStreamEncoderPrivateName();
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeTLSRejectUnauthorizedGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    const auto& privateName = NODE_TLS_REJECT_UNAUTHORIZED_PRIVATE_PROPERTY(vm);
    JSValue result = thisObject->getDirect(vm, privateName);
    if (result) [[unlikely]] {
        return JSValue::encode(result);
    }

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (!Bun__getEnvValue(globalObject, &name, &value) || value.len == 0) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsString(vm, Zig::toStringCopy(value)));
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeTLSRejectUnauthorizedSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!object)
        return false;

    JSValue decodedValue = JSValue::decode(value);
    WTF::String str = decodedValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    // TODO: only check "0". Node doesn't check both. But we already did. So we
    // should wait to do that until Bun v1.2.0.
    if (str == "0"_s || str == "false"_s) {
        Bun__setTLSRejectUnauthorizedValue(0);
    } else {
        Bun__setTLSRejectUnauthorizedValue(1);
    }

    const auto& privateName = NODE_TLS_REJECT_UNAUTHORIZED_PRIVATE_PROPERTY(vm);
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsBunConfigVerboseFetchGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    const auto& privateName = BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(vm);
    JSValue result = thisObject->getDirect(vm, privateName);
    if (result) [[unlikely]] {
        return JSValue::encode(result);
    }

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (!Bun__getEnvValue(globalObject, &name, &value) || value.len == 0) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsString(vm, Zig::toStringCopy(value)));
}

JSC_DEFINE_CUSTOM_SETTER(jsBunConfigVerboseFetchSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!object)
        return false;

    JSValue decodedValue = JSValue::decode(value);
    WTF::String str = decodedValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    if (str == "1"_s || str == "true"_s) {
        Bun__setVerboseFetchValue(1);
    } else if (str == "curl"_s) {
        Bun__setVerboseFetchValue(2);
    } else {
        Bun__setVerboseFetchValue(0);
    }

    const auto& privateName = BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(vm);
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

#if OS(WINDOWS)
extern "C" void Bun__Process__editWindowsEnvVar(BunString, BunString);

JSC_DEFINE_HOST_FUNCTION(jsEditWindowsEnvVar, (JSGlobalObject * global, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    ASSERT(callFrame->argumentCount() == 2);
    ASSERT(callFrame->uncheckedArgument(0).isString());
    WTF::String string1 = callFrame->uncheckedArgument(0).toWTFString(global);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue arg2 = callFrame->uncheckedArgument(1);
    ASSERT(arg2.isNull() || arg2.isString());
    if (arg2.isCell()) {
        WTF::String string2 = arg2.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, {});
        Bun__Process__editWindowsEnvVar(Bun::toString(string1), Bun::toString(string2));
    } else {
        Bun__Process__editWindowsEnvVar(Bun::toString(string1), { .tag = BunStringTag::Dead });
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}
#endif

// ============================================================================
// worker_threads SHARE_ENV
//
// With `env: SHARE_ENV` the parent and worker share one live environment. JS
// objects can't cross VMs, so each thread gets its own `process.env` object that
// is a thin write-through view over the process-wide store below (lock-guarded,
// strings isolatedCopy()'d both ways).
//
// Only the JS-visible `process.env` is shared; Bun's Zig-side env map (Bun.env,
// fetch proxy resolution) is still snapshotted per worker.
// Windows env keys are case-insensitive; normalize shared-store keys to uppercase
// to match the regular env object's OS(WINDOWS) behavior.
static ALWAYS_INLINE String normalizeSharedEnvKey(const String& key)
{
#if OS(WINDOWS)
    return key.convertToASCIIUppercase();
#else
    return key;
#endif
}

class SharedEnvStore {
public:
    static SharedEnvStore& singleton()
    {
        static NeverDestroyed<SharedEnvStore> store;
        return store;
    }

    String get(const String& key)
    {
        Locker locker { m_lock };
        auto it = m_map.find(normalizeSharedEnvKey(key));
        if (it == m_map.end())
            return String();
        return it->value.isolatedCopy();
    }

    void set(const String& key, const String& value)
    {
        Locker locker { m_lock };
        m_map.set(normalizeSharedEnvKey(key).isolatedCopy(), value.isolatedCopy());
    }

    void remove(const String& key)
    {
        Locker locker { m_lock };
        m_map.remove(normalizeSharedEnvKey(key));
    }

    Vector<String> keys()
    {
        Locker locker { m_lock };
        Vector<String> out;
        out.reserveInitialCapacity(m_map.size());
        for (const auto& key : m_map.keys())
            out.append(key.isolatedCopy());
        return out;
    }

private:
    Lock m_lock;
    HashMap<String, String> m_map;
};

// process.env variant whose reads/writes/deletes/enumeration go through the
// process-wide SharedEnvStore; no instance state, so no custom subspace.
class JSSharedEnvMap final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags
        | JSC::OverridesGetOwnPropertySlot
        | JSC::OverridesPut
        | JSC::OverridesGetOwnPropertyNames
        | JSC::GetOwnPropertySlotMayBeWrongAboutDontEnum
        | JSC::ProhibitsPropertyCaching;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSSharedEnvMap, Base);
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSSharedEnvMap* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSSharedEnvMap* ptr = new (NotNull, JSC::allocateCell<JSSharedEnvMap>(vm)) JSSharedEnvMap(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSCell*, JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool deleteProperty(JSCell*, JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);
    static bool defineOwnProperty(JSObject*, JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);

private:
    JSSharedEnvMap(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

const JSC::ClassInfo JSSharedEnvMap::s_info = { "ProcessEnv"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSharedEnvMap) };

bool JSSharedEnvMap::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    VM& vm = JSC::getVM(globalObject);
    auto* uid = propertyName.uid();
    if (propertyName.isSymbol() || !uid) {
        return Base::getOwnPropertySlot(object, globalObject, propertyName, slot);
    }

    String value = SharedEnvStore::singleton().get(String(uid));
    if (value.isNull()) {
        return Base::getOwnPropertySlot(object, globalObject, propertyName, slot);
    }

    slot.setValue(object, 0, JSC::jsString(vm, value));
    return true;
}

// Proxy env vars written back to the Zig env map so fetch()'s getHttpProxyFor()
// sees runtime changes; shared by applySharedEnvSideEffects and
// createEnvironmentVariablesMap.
static constexpr ASCIILiteral kProxyEnvVarNames[] = {
    "HTTP_PROXY"_s,
    "http_proxy"_s,
    "HTTPS_PROXY"_s,
    "https_proxy"_s,
    "NO_PROXY"_s,
    "no_proxy"_s,
};

// Mirror the regular process.env CustomSetters' native side effects (TZ, TLS,
// verbose-fetch, proxy vars); the shared store only updates strings, so without
// this a SHARE_ENV worker's writes would silently skip them.
static void applySharedEnvSideEffects(JSGlobalObject* globalObject, const String& rawKey, const String& stringValue)
{
    VM& vm = JSC::getVM(globalObject);
    // Windows env keys are case-insensitive; normalize so process.env.tz hits TZ.
    String key = normalizeSharedEnvKey(rawKey);
    if (key == "TZ"_s) {
        if (stringValue.length() < 32 && WTF::setTimeZoneOverride(stringValue))
            vm.dateCache.resetIfNecessarySlow();
        return;
    }
    if (key == "NODE_TLS_REJECT_UNAUTHORIZED"_s) {
        Bun__setTLSRejectUnauthorizedValue((stringValue == "0"_s || stringValue == "false"_s) ? 0 : 1);
        return;
    }
    if (key == "BUN_CONFIG_VERBOSE_FETCH"_s) {
        if (stringValue == "1"_s || stringValue == "true"_s)
            Bun__setVerboseFetchValue(1);
        else if (stringValue == "curl"_s)
            Bun__setVerboseFetchValue(2);
        else
            Bun__setVerboseFetchValue(0);
        return;
    }
    // Proxy vars: fetch()'s getHttpProxyFor() reads the Zig env map, so sync.
    const auto& proxyVarNames = kProxyEnvVarNames;
    for (auto proxyName : proxyVarNames) {
        if (key == proxyName) {
            BunString name = Bun::toString(key);
            BunString val = Bun::toString(stringValue);
            Bun__setEnvValue(globalObject, &name, &val);
            return;
        }
    }
}

bool JSSharedEnvMap::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* uid = propertyName.uid();
    if (propertyName.isSymbol() || !uid) {
        RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, propertyName, value, slot));
    }

    // Node coerces env values to strings on assignment.
    String stringValue = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    String keyStr = String(uid);
    applySharedEnvSideEffects(globalObject, keyStr, stringValue);
    SharedEnvStore::singleton().set(keyStr, stringValue);
    return true;
}

bool JSSharedEnvMap::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    auto* uid = propertyName.uid();
    if (propertyName.isSymbol() || !uid) {
        return Base::deleteProperty(cell, globalObject, propertyName, slot);
    }

    SharedEnvStore::singleton().remove(String(uid));
    return true;
}

void JSSharedEnvMap::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    VM& vm = JSC::getVM(globalObject);
    auto keys = SharedEnvStore::singleton().keys();
    for (const auto& key : keys) {
        propertyNames.add(JSC::Identifier::fromString(vm, key));
    }
    Base::getOwnPropertyNames(object, globalObject, propertyNames, mode);
}

bool JSSharedEnvMap::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* uid = propertyName.uid();
    if (propertyName.isSymbol() || !uid || !descriptor.isDataDescriptor() || !descriptor.value()) {
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow));
    }

    String stringValue = descriptor.value().toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    String keyStr = String(uid);
    applySharedEnvSideEffects(globalObject, keyStr, stringValue);
    SharedEnvStore::singleton().set(keyStr, stringValue);
    return true;
}

JSValue createSharedEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* structure = JSSharedEnvMap::createStructure(vm, globalObject, globalObject->objectPrototype());
    return JSSharedEnvMap::create(vm, structure);
}

void enableSharedEnvForWorker(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& store = SharedEnvStore::singleton();

    // Initialize process.env (from the OS environment) if it was never touched,
    // so the shared store is seeded with the real values instead of an empty map.
    JSObject* envObject = globalObject->processEnvObject();
    // If this global's process.env is already the shared variant, nothing to do.
    if (envObject->inherits<JSSharedEnvMap>())
        return;

    // Merge this global's process.env into the shared store (later joiners only add
    // missing keys), then swap this global's process.env to the shared variant. The
    // swap must happen per-global, even when the store is already seeded.
    {
        if (!envObject->staticPropertiesReified()) {
            envObject->reifyAllStaticProperties(globalObject);
            RETURN_IF_EXCEPTION(scope, );
        }

        JSC::PropertyNameArrayBuilder keys(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        envObject->methodTable()->getOwnPropertyNames(envObject, globalObject, keys, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, );

        for (const auto& key : keys) {
            String keyStr = String(key.impl());
            if (!store.get(keyStr).isNull())
                continue;
            JSValue value = envObject->get(globalObject, key);
            RETURN_IF_EXCEPTION(scope, );
            String str = value.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            store.set(keyStr, str);
        }
    }

    // Swap this global's process.env to the shared, write-through variant.
    auto* shared = createSharedEnvironmentVariablesMap(globalObject).getObject();
    globalObject->m_processEnvObject.set(vm, globalObject, shared);

    // process.env may already be reified as an own property on the process object;
    // overwrite it so it resolves to the shared variant.
    if (globalObject->hasProcessObject()) {
        JSObject* processObject = globalObject->processObject();
        processObject->putDirect(vm, JSC::Identifier::fromString(vm, "env"_s), shared, 0);
    }
}

JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    void* list;
    size_t count = Bun__getEnvCount(globalObject, &list);
    JSC::JSObject* object = nullptr;
    if (count < 63) {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype(), count);
    } else {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype());
    }

#if OS(WINDOWS)
    JSArray* keyArray = constructEmptyArray(globalObject, nullptr, count);
    RETURN_IF_EXCEPTION(scope, {});
#endif

    static NeverDestroyed<String> TZ = MAKE_STATIC_STRING_IMPL("TZ");
    String NODE_TLS_REJECT_UNAUTHORIZED = String("NODE_TLS_REJECT_UNAUTHORIZED"_s);
    String BUN_CONFIG_VERBOSE_FETCH = String("BUN_CONFIG_VERBOSE_FETCH"_s);
    bool hasTZ = false;
    bool hasNodeTLSRejectUnauthorized = false;
    bool hasBunConfigVerboseFetch = false;

    // Proxy-related env vars need write-back to the native env map so that
    // fetch()'s getHttpProxyFor() observes runtime changes.
    const auto& proxyVarNames = kProxyEnvVarNames;
    constexpr size_t proxyVarCount = std::size(proxyVarNames);
    bool hasProxyVar[proxyVarCount] = {};

    auto isProxyVar = [&](const String& name) -> std::optional<size_t> {
        for (size_t j = 0; j < proxyVarCount; j++) {
            if (name == proxyVarNames[j]) return j;
        }
#if OS(WINDOWS)
        // Windows env var names are case-insensitive, so the OS env block can
        // carry any casing (`Http_Proxy`, `HTTP_proxy`, ...). Without this
        // fallback the per-key loop falls through, the bottom loop then adds
        // the canonical accessor with `DontEnum` (because hasProxyVar[*] stayed
        // false), and `{...process.env}` (which most spawn env merges do) drops
        // the var even though `process.env.HTTP_PROXY` reads it fine.
        for (size_t j = 0; j < proxyVarCount; j++) {
            if (equalIgnoringASCIICase(name, proxyVarNames[j])) return j;
        }
#endif
        return std::nullopt;
    };

    auto* cached_getter_setter = JSC::CustomGetterSetter::create(vm, jsGetterEnvironmentVariable, nullptr);
    auto* proxy_getter_setter = JSC::CustomGetterSetter::create(vm, jsGetterProxyEnvironmentVariable, jsSetterProxyEnvironmentVariable);

    for (size_t i = 0; i < count; i++) {
        unsigned char* chars;
        size_t len = Bun__getEnvKey(list, i, &chars);
        // We can't really trust that the OS gives us valid UTF-8
        auto name = String::fromUTF8ReplacingInvalidSequences(std::span { chars, len });
#if OS(WINDOWS)
        keyArray->putByIndexInline(globalObject, (unsigned)i, jsString(vm, name), false);
#endif
        if (name == TZ) {
            hasTZ = true;
            continue;
        }
        if (name == NODE_TLS_REJECT_UNAUTHORIZED) {
            hasNodeTLSRejectUnauthorized = true;
            continue;
        }
        if (name == BUN_CONFIG_VERBOSE_FETCH) {
            hasBunConfigVerboseFetch = true;
            continue;
        }
        if (auto idx = isProxyVar(name)) {
            hasProxyVar[*idx] = true;
            continue;
        }
        ASSERT(len > 0);
#if OS(WINDOWS)
        String idName = name.convertToASCIIUppercase();
#else
        String idName = name;
#endif
        Identifier identifier = Identifier::fromString(vm, idName);

        // CustomGetterSetter doesn't support indexed properties yet.
        // This causes strange issues when the environment variable name is an integer.
        if (chars[0] >= '0' && chars[0] <= '9') [[unlikely]] {
            if (auto index = parseIndex(identifier)) {
                ZigString valueString = { nullptr, 0 };
                ZigString nameStr = toZigString(name);
                if (Bun__getEnvValue(globalObject, &nameStr, &valueString)) {
                    JSValue value = jsString(vm, Zig::toStringCopy(valueString));
                    RETURN_IF_EXCEPTION(scope, {});
                    object->putDirectIndex(globalObject, *index, value, 0, PutDirectIndexLikePutDirect);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                continue;
            }
        }

        // JSC::PropertyAttribute::CustomValue calls the getter ONCE (the first
        // time) and then sets it onto the object, subsequent calls to the
        // getter will not go through the getter and instead will just do the
        // property lookup.
        object->putDirectCustomAccessor(vm, identifier, cached_getter_setter, JSC::PropertyAttribute::CustomValue | 0);
    }

    unsigned int TZAttrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasTZ) {
        TZAttrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, TZ), JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), TZAttrs);

    unsigned int NODE_TLS_REJECT_UNAUTHORIZED_Attrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasNodeTLSRejectUnauthorized) {
        NODE_TLS_REJECT_UNAUTHORIZED_Attrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, NODE_TLS_REJECT_UNAUTHORIZED), JSC::CustomGetterSetter::create(vm, jsNodeTLSRejectUnauthorizedGetter, jsNodeTLSRejectUnauthorizedSetter), NODE_TLS_REJECT_UNAUTHORIZED_Attrs);

    unsigned int BUN_CONFIG_VERBOSE_FETCH_Attrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasBunConfigVerboseFetch) {
        BUN_CONFIG_VERBOSE_FETCH_Attrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, BUN_CONFIG_VERBOSE_FETCH), JSC::CustomGetterSetter::create(vm, jsBunConfigVerboseFetchGetter, jsBunConfigVerboseFetchSetter), BUN_CONFIG_VERBOSE_FETCH_Attrs);

    for (size_t j = 0; j < proxyVarCount; j++) {
        // Known limitation: `delete process.env.NO_PROXY` removes the accessor
        // without calling the setter, leaving the native env map stale (same as TZ).
        // Use `process.env.NO_PROXY = ""` to unset. DontDelete would throw in
        // strict mode, so we leave it deletable and document the gap.
        unsigned attrs = JSC::PropertyAttribute::CustomAccessor | 0;
        if (!hasProxyVar[j]) {
            attrs |= JSC::PropertyAttribute::DontEnum;
        }
        object->putDirectCustomAccessor(
            vm,
            Identifier::fromString(vm, proxyVarNames[j]),
            proxy_getter_setter,
            attrs);
    }

#if OS(WINDOWS)
    auto editWindowsEnvVar = JSC::JSFunction::create(vm, globalObject, 0, String("editWindowsEnvVar"_s), jsEditWindowsEnvVar, ImplementationVisibility::Public);

    JSC::JSFunction* getSourceEvent = JSC::JSFunction::create(vm, globalObject, processObjectInternalsWindowsEnvCodeGenerator(vm), globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::MarkedArgumentBuffer args;
    args.append(object);
    args.append(keyArray);
    args.append(editWindowsEnvVar);
    auto clientData = WebCore::clientData(vm);
    JSC::CallData callData = JSC::getCallData(getSourceEvent);
    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, getSourceEvent, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (returnedException) {
        throwException(globalObject, scope, returnedException.get());
        return jsUndefined();
    }

    RELEASE_AND_RETURN(scope, result);
#else
    return object;
#endif
}
}
