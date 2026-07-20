#include "root.h"
#include "ZigGlobalObject.h"

#include "helpers.h"
#include "JSEnvironmentVariableMap.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/DateInstanceCache.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>

#include "BunClientData.h"
#include "BunProcess.h"
#include "ErrorCode.h"
#include "wtf/Compiler.h"
#include "wtf/Forward.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/PropertyDescriptor.h>
#include "BunProcess.h"
#include "ScriptExecutionContext.h"
#include "SharedEnvStore.h"
#include "wtf/NeverDestroyed.h"
#include "WebCoreJSBuiltins.h"

using namespace JSC;

extern "C" size_t Bun__getEnvCount(JSGlobalObject* globalObject, void** list_ptr);
extern "C" size_t Bun__getEnvKey(void* list, size_t index, unsigned char** out);

extern "C" bool Bun__getEnvValue(JSGlobalObject* globalObject, const ZigString* name, ZigString* value);
extern "C" bool Bun__getEnvValueBunString(JSGlobalObject* globalObject, const BunString* name, BunString* value);
extern "C" void Bun__setEnvValue(JSGlobalObject* globalObject, const BunString* name, const BunString* value);
extern "C" bool Bun__Node__ProcessPendingDeprecation;

namespace Bun {

using namespace WebCore;

void invalidateLiveDateInstanceCaches(JSC::VM& vm)
{
    // HeapIterationScope::willStartIterating stops every allocator in the
    // heap (walks all BlockDirectories); only forEachLiveCell is
    // subspace-local. TZ assignment is rare enough that this is acceptable
    // for now — the O(1) alternative is a tz-generation counter on
    // DateInstanceData compared inside gregorianDateTime (V8's design).
    JSC::HeapIterationScope iterationScope(vm.heap);
    vm.heap.dateInstanceSpace.forEachLiveCell([](JSC::HeapCell* cell, JSC::HeapCell::Kind) -> IterationStatus {
        auto* date = static_cast<JSC::DateInstance*>(static_cast<JSC::JSCell*>(cell));
        // m_data is private, but its offset is exported for the JIT.
        auto& dataSlot = *reinterpret_cast<RefPtr<JSC::DateInstanceData>*>(reinterpret_cast<uint8_t*>(date) + JSC::DateInstance::offsetOfData());
        if (dataSlot)
            dataSlot->m_gregorianDateTimeCachedForMS = PNaN;
        return IterationStatus::Continue;
    });
}

void resetDateCachesAfterTimeZoneChange(JSC::VM& vm)
{
    // The shared DateCache reset and the per-instance gregorian-cache
    // invalidation must always travel together; callers use this pair.
    WTF::timeZoneDidChange();
    vm.dateCache.clearForTimeZoneChange();
    invalidateLiveDateInstanceCaches(vm);
}

const JSC::ClassInfo JSEnvironmentVariableMap::s_info = { "ProcessEnv"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSEnvironmentVariableMap) };

// Node's EnvSetter DEP0104: emitted under --pending-deprecation for non-string,
// non-number, non-boolean values, at most once per Environment/Worker (Node's
// flag is a per-Environment member, not process-global). Every process.env
// write path — both the regular map and the SHARE_ENV one — goes through here.
static void maybeEmitEnvNonstringDeprecation(JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue value)
{
    if (!Bun__Node__ProcessPendingDeprecation || value.isString() || value.isNumber() || value.isBoolean())
        return;

    auto* process = defaultGlobalObject(globalObject)->processObject();
    if (!process->m_emitEnvNonstringWarning)
        return;
    process->m_emitEnvNonstringWarning = false;

    VM& vm = globalObject->vm();
    Bun::Process::emitWarning(globalObject,
        jsString(vm, String("Assigning any value other than a string, number, or boolean to a process.env property is deprecated. Please make sure to convert the value to a string before setting process.env with it."_s)),
        jsString(vm, String("DeprecationWarning"_s)),
        jsString(vm, String("DEP0104"_s)),
        jsUndefined());
    RETURN_IF_EXCEPTION(scope, );
}

// Node's EnvSetter value handling, shared by put / putByIndex /
// defineOwnProperty: DEP0104, then ToString coercion.
static JSC::JSString* coerceEnvValue(JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue value)
{
    maybeEmitEnvNonstringDeprecation(globalObject, scope, value);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSC::JSString* string = value.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return string;
}

static void applyTZFromString(JSGlobalObject*, const String&);
static bool shouldApplyTZSideEffect(JSGlobalObject*);

// TZ side effect for put() and jsProcessEnvCoerceForWrite, so delete-then-set
// (which drops the CustomAccessor) still updates the process timezone like
// Node's RealEnvStore::Set does on every write.
static void applyTimeZoneEnvValue(JSGlobalObject* globalObject, JSC::JSString* string)
{
    auto view = string->view(globalObject);
    if (view->isNull())
        return;
    applyTZFromString(globalObject, view->toString());
}

bool JSEnvironmentVariableMap::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* uid = propertyName.uid();
    if (uid && uid->isSymbol()) {
        throwTypeError(globalObject, scope, "Cannot convert a symbol to a string"_s);
        return false;
    }

    // Node silently ignores assignments to an empty variable name
    // (https://github.com/nodejs/node/issues/32920).
    if (propertyName.publicName() && propertyName.publicName()->isEmpty())
        return true;

    JSString* string = coerceEnvValue(globalObject, scope, value);
    RETURN_IF_EXCEPTION(scope, false);

    // Node's RealEnvStore::Set name-matches TZ on every write; do the same
    // here so `delete process.env.TZ; process.env.TZ = ...` still updates
    // Date caches (delete drops the CustomAccessor). putDirect bypasses the
    // accessor so the side effect fires exactly once.
    if (uid && WTF::equal(uid, "TZ"_s)) [[unlikely]] {
        applyTimeZoneEnvValue(globalObject, string);
        RETURN_IF_EXCEPTION(scope, false);
        static_cast<JSEnvironmentVariableMap*>(cell)->putDirect(vm, propertyName, string, 0);
        return true;
    }
    RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, propertyName, string, slot));
}

bool JSEnvironmentVariableMap::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Numeric keys route through EnvSetter in Node too, so the same DEP0104
    // and coercion rules apply.
    JSString* string = coerceEnvValue(globalObject, scope, value);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, Base::putByIndex(cell, globalObject, index, string, shouldThrow));
}

bool JSEnvironmentVariableMap::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (descriptor.isAccessorDescriptor()) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_OBJECT_DEFINE_PROPERTY, "'process.env' does not accept an accessor(getter/setter) descriptor"_s);
        return false;
    }

    // Node's EnvDefiner requires a [[Value]] alongside the three attributes,
    // so a value-less data descriptor is rejected rather than defining the
    // property as undefined.
    if (!(descriptor.value() && descriptor.configurablePresent() && descriptor.configurable()
            && descriptor.writablePresent() && descriptor.writable()
            && descriptor.enumerablePresent() && descriptor.enumerable())) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_OBJECT_DEFINE_PROPERTY, "'process.env' only accepts a configurable, writable, and enumerable data descriptor"_s);
        return false;
    }

    // Node's EnvDefiner hands the validated value to EnvSetter, i.e. plain
    // assignment. Routing through put() (NOT Base::defineOwnProperty, which
    // would replace the property) keeps the TZ/proxy CustomAccessor entries
    // and their side effects intact.
    PutPropertySlot slot(object, shouldThrow);
    RELEASE_AND_RETURN(scope, put(object, globalObject, propertyName, descriptor.value(), slot));
}

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

// Parse-and-apply for NODE_TLS_REJECT_UNAUTHORIZED / BUN_CONFIG_VERBOSE_FETCH,
// used by both the CustomSetters below and applySharedEnvSideEffects.
// (applyTZFromString is forward-declared above applyTimeZoneEnvValue.)
static void applyTLSRejectFromString(JSGlobalObject*, const String&);
static void applyVerboseFetchFromString(JSGlobalObject*, const String&);

// TZ's actual timezone side effect fires from JSEnvironmentVariableMap::put()
// (POSIX) and jsProcessEnvCoerceForWrite (Windows Proxy) name-matching every
// write, so this accessor setter is store-only. Keeping the side effect out
// of here avoids a double-fire on Windows where writeEnvVar has already
// applied it before assigning through this accessor.
JSC_DEFINE_CUSTOM_SETTER(jsTimeZoneEnvironmentVariableSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;
    auto* clientData = WebCore::clientData(vm);
    object->putDirect(vm, clientData->builtinNames().dataPrivateName(), JSValue::decode(value), 0);
    return true;
}

bool JSEnvironmentVariableMap::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Node's RealEnvStore::Delete calls DateTimeConfigurationChangeNotification
    // for TZ; without this override, delete drops the CustomAccessor without
    // reaching the TZ setter and existing Date instances keep the old offset.
    // put() name-matches TZ so a subsequent `process.env.TZ = ...` still fires
    // the side effect after the accessor is gone.
    auto* uid = propertyName.publicName();
    if (uid && WTF::equal(uid, "TZ"_s)) {
        if (shouldApplyTZSideEffect(globalObject)) {
            WTF::setTimeZoneOverride(String());
            resetDateCachesAfterTimeZoneChange(vm);
        }
        auto* clientData = WebCore::clientData(vm);
        DeletePropertySlot dataSlot;
        Base::deleteProperty(cell, globalObject, clientData->builtinNames().dataPrivateName(), dataSlot);
        RETURN_IF_EXCEPTION(scope, false);
    }

    RELEASE_AND_RETURN(scope, Base::deleteProperty(cell, globalObject, propertyName, slot));
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

    applyTLSRejectFromString(globalObject, str);

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

    applyVerboseFetchFromString(globalObject, str);

    const auto& privateName = BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(vm);
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

#if OS(WINDOWS)
extern "C" void Bun__Process__editWindowsEnvVar(BunString, BunString);

// Shared write-path helper for the Windows Proxy set/defineProperty traps:
// DEP0104 + ToString via coerceEnvValue (single-sourced with POSIX put()),
// plus the TZ timezone side effect so it survives `delete process.env.TZ`
// dropping the CustomAccessor. Returns the coerced string.
JSC_DEFINE_HOST_FUNCTION(jsProcessEnvCoerceForWrite, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue key = callFrame->argument(0);
    JSValue value = callFrame->argument(1);
    JSC::JSString* string = coerceEnvValue(globalObject, scope, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (key.isString()) {
        auto keyView = asString(key)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (WTF::equal(keyView, "TZ"_s)) {
            applyTimeZoneEnvValue(globalObject, string);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return JSValue::encode(string);
}

// `delete process.env.TZ` on Windows: reset the JSC timezone override so
// existing Date instances re-read the system zone (POSIX handles this in
// JSEnvironmentVariableMap::deleteProperty; the Windows internalEnv is a
// plain object so it needs its own hook).
JSC_DEFINE_HOST_FUNCTION(jsProcessEnvResetTZ, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (shouldApplyTZSideEffect(globalObject)) {
        WTF::setTimeZoneOverride(String());
        resetDateCachesAfterTimeZoneChange(vm);
    }
    return JSValue::encode(jsUndefined());
}

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

// Founding a SHARE_ENV tree swaps main's process.env off the windowsEnv Proxy that
// called SetEnvironmentVariableW, so every mutation of a main-rooted shared store has
// to re-apply that write-through. Gated on the *store*, not the writing thread: node
// roots a main-founded tree at its RealEnvStore, so a worker writing through that tree
// reaches the OS env too. `value == nullptr` deletes.
static ALWAYS_INLINE void syncWindowsEnv(SharedEnvStore* store, const String& key, const String* value)
{
#if OS(WINDOWS)
    if (!store || !store->isMainRooted())
        return;
    if (value)
        Bun__Process__editWindowsEnvVar(Bun::toString(key), Bun::toString(*value));
    else
        Bun__Process__editWindowsEnvVar(Bun::toString(key), { .tag = BunStringTag::Dead });
#else
    UNUSED_PARAM(store);
    UNUSED_PARAM(key);
    UNUSED_PARAM(value);
#endif
}

// ============================================================================
// worker_threads SHARE_ENV
//
// With `env: SHARE_ENV` the worker shares one live environment with the thread
// that spawned it. JS objects can't cross VMs, so each thread gets its own
// `process.env` object that is a thin write-through view over the tree's
// SharedEnvStore (lock-guarded, strings isolatedCopy()'d both ways).
//
// Only the JS-visible `process.env` is shared; Bun's Zig-side env map (Bun.env,
// fetch proxy resolution) is still snapshotted per worker.

// The store for the tree this global belongs to, or null if it's in none. The
// context can be gone during teardown, when a surviving process.env is read.
static SharedEnvStore* sharedEnvStoreFor(Zig::GlobalObject* globalObject)
{
    auto* context = globalObject->scriptExecutionContext();
    return context ? context->sharedEnvStore() : nullptr;
}

// Resolve via the object's own global, never the lexical one: a cross-realm read
// of `process.env` must hit the tree that owns the object. jsDynamicCast, not
// defaultGlobalObject(), which would silently retarget the thread's default tree.
static SharedEnvStore* sharedEnvStoreFor(JSC::JSObject* object)
{
    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(object->globalObject());
    return globalObject ? sharedEnvStoreFor(globalObject) : nullptr;
}

// process.env variant whose reads/writes/deletes/enumeration go through the
// tree's SharedEnvStore; no instance state, so no custom subspace.
class JSSharedEnvMap final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags
        | JSC::OverridesGetOwnPropertySlot
        | JSC::InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero
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
    // Integer-like env keys (process.env['123']) arrive through the indexed hooks;
    // without these they land in JSObject's indexed storage, invisible to the store.
    static bool getOwnPropertySlotByIndex(JSObject*, JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static bool putByIndex(JSCell*, JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow);
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned);
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

    auto* store = sharedEnvStoreFor(object);
    String value = store ? store->get(String(uid)) : String();
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

// Node does not intercept process.env.TZ in workers: only RealEnvStore::Set
// calls DateTimeConfigurationChangeNotification, and every worker env is a
// MapKVStore. WTF::setTimeZoneOverride is process-global, so a worker write
// would otherwise flip the main thread's timezone while only invalidating the
// worker VM's Date caches.
static bool shouldApplyTZSideEffect(JSGlobalObject* globalObject)
{
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* context = zigGlobal ? zigGlobal->scriptExecutionContext() : nullptr;
    return !context || context->isMainThread();
}

// The parse-and-apply bodies for the three side-effecting env vars, shared by
// process.env's put()/CustomSetters and applySharedEnvSideEffects so a new
// side-effecting var need only be added in one place.
static void applyTZFromString(JSGlobalObject* globalObject, const String& value)
{
    if (!shouldApplyTZSideEffect(globalObject))
        return;
    if (value.length() < 32 && WTF::setTimeZoneOverride(value))
        resetDateCachesAfterTimeZoneChange(JSC::getVM(globalObject));
}
static void applyTLSRejectFromString(JSGlobalObject*, const String& value)
{
    /* Node only treats the exact string "0" as disabling verification. */
    Bun__setTLSRejectUnauthorizedValue(value == "0"_s ? 0 : 1);
}
static void applyVerboseFetchFromString(JSGlobalObject*, const String& value)
{
    if (value == "1"_s || value == "true"_s)
        Bun__setVerboseFetchValue(1);
    else if (value == "curl"_s)
        Bun__setVerboseFetchValue(2);
    else
        Bun__setVerboseFetchValue(0);
}

// Mirror the regular process.env CustomSetters' native side effects (TZ, TLS,
// verbose-fetch, proxy vars); the shared store only updates strings, so without
// this a SHARE_ENV worker's writes would silently skip them.
// These land on the *writing* thread only: the TLS-reject/verbose-fetch caches and
// the Zig env map are per-VM, so other threads in the tree read the new string but
// keep the old native effect. Node does not propagate a shared-store TZ either.
static void applySharedEnvSideEffects(JSGlobalObject* globalObject, const String& rawKey, const String& stringValue)
{
    // Windows env keys are case-insensitive; normalize so process.env.tz hits TZ.
    String key = SharedEnvStore::normalizeKey(rawKey);
    if (key == "TZ"_s) {
        applyTZFromString(globalObject, stringValue);
        return;
    }
    if (key == "NODE_TLS_REJECT_UNAUTHORIZED"_s) {
        applyTLSRejectFromString(globalObject, stringValue);
        return;
    }
    if (key == "BUN_CONFIG_VERBOSE_FETCH"_s) {
        applyVerboseFetchFromString(globalObject, stringValue);
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

    // A JSSharedEnvMap only exists on a thread that joined a tree; without a store
    // there is nowhere to write, so keep the value locally rather than drop it.
    auto* store = sharedEnvStoreFor(asObject(cell));
    if (!store) [[unlikely]] {
        ASSERT_NOT_REACHED();
        RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, propertyName, value, slot));
    }

    // Node coerces env values to strings on assignment, and warns first for
    // values that aren't a string/number/boolean — the store type doesn't
    // change EnvSetter's behavior.
    maybeEmitEnvNonstringDeprecation(globalObject, scope, value);
    RETURN_IF_EXCEPTION(scope, false);
    String stringValue = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    String keyStr = String(uid);
    applySharedEnvSideEffects(globalObject, keyStr, stringValue);
    syncWindowsEnv(store, keyStr, &stringValue);
    store->set(keyStr, stringValue);
    return true;
}

bool JSSharedEnvMap::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    auto* uid = propertyName.uid();
    if (propertyName.isSymbol() || !uid) {
        return Base::deleteProperty(cell, globalObject, propertyName, slot);
    }

    auto* store = sharedEnvStoreFor(asObject(cell));
    if (!store) [[unlikely]] {
        ASSERT_NOT_REACHED();
        return Base::deleteProperty(cell, globalObject, propertyName, slot);
    }

    // Mirror JSEnvironmentVariableMap::deleteProperty: put() applies the TZ
    // side effect via applySharedEnvSideEffects, so delete has to undo it or
    // existing Date instances keep the deleted zone's offset.
    String key(uid);
    if (SharedEnvStore::normalizeKey(key) == "TZ"_s && shouldApplyTZSideEffect(globalObject)) {
        WTF::setTimeZoneOverride(String());
        resetDateCachesAfterTimeZoneChange(JSC::getVM(globalObject));
    }

    syncWindowsEnv(store, key, nullptr);
    store->remove(key);
    // Also drop any own property the Base fallback installed (accessor descriptors).
    return Base::deleteProperty(cell, globalObject, propertyName, slot);
}

void JSSharedEnvMap::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    VM& vm = JSC::getVM(globalObject);
    if (auto* store = sharedEnvStoreFor(object)) {
        for (const auto& key : store->keys())
            propertyNames.add(JSC::Identifier::fromString(vm, key));
    }
    Base::getOwnPropertyNames(object, globalObject, propertyNames, mode);
}

bool JSSharedEnvMap::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* uid = propertyName.uid();

    // Node's EnvDefiner rejects accessors on every env store, not just the real
    // one, so the SHARE_ENV map answers exactly like the regular map above.
    // Rejecting here also keeps a getter off the base object, where it would be
    // shadowed by the store entry that getOwnPropertySlot reads first.
    if (descriptor.isAccessorDescriptor()) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_OBJECT_DEFINE_PROPERTY, "'process.env' does not accept an accessor(getter/setter) descriptor"_s);
        return false;
    }

    if (propertyName.isSymbol() || !uid || !descriptor.isDataDescriptor() || !descriptor.value()) {
        // The descriptor lands on the Base object, but getOwnPropertySlot reads the
        // store first, so a store entry would shadow it. Move the entry onto Base as
        // an enumerable data property first so a partial descriptor keeps that
        // enumerability.
        //
        // Node's EnvDefiner also rejects partial descriptors, which
        // JSEnvironmentVariableMap::defineOwnProperty does but this map does not
        // yet. Divergence tracked separately — tightening it is a behavior change
        // to SHARE_ENV that belongs with its own tests.
        if (!propertyName.isSymbol() && uid) {
            if (auto* store = sharedEnvStoreFor(object)) {
                String existing = store->get(String(uid));
                if (!existing.isNull()) {
                    syncWindowsEnv(store, String(uid), nullptr);
                    store->remove(String(uid));
                    object->putDirect(vm, propertyName, jsString(vm, existing), 0);
                }
            }
        }
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow));
    }

    maybeEmitEnvNonstringDeprecation(globalObject, scope, descriptor.value());
    RETURN_IF_EXCEPTION(scope, false);
    String stringValue = descriptor.value().toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    auto* store = sharedEnvStoreFor(object);
    if (!store) [[unlikely]] {
        ASSERT_NOT_REACHED();
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow));
    }

    String keyStr = String(uid);
    applySharedEnvSideEffects(globalObject, keyStr, stringValue);
    syncWindowsEnv(store, keyStr, &stringValue);
    store->set(keyStr, stringValue);
    return true;
}

bool JSSharedEnvMap::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    VM& vm = JSC::getVM(globalObject);
    return getOwnPropertySlot(object, globalObject, Identifier::from(vm, index), slot);
}

bool JSSharedEnvMap::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    VM& vm = JSC::getVM(globalObject);
    PutPropertySlot slot(cell, shouldThrow);
    return put(cell, globalObject, Identifier::from(vm, index), value, slot);
}

bool JSSharedEnvMap::deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index)
{
    // Delegate to Base::deletePropertyByIndex, not deleteProperty: JSObject's named
    // form re-dispatches index-like names back here, which would recurse forever.
    auto* store = sharedEnvStoreFor(asObject(cell));
    if (!store) [[unlikely]] {
        ASSERT_NOT_REACHED();
        return Base::deletePropertyByIndex(cell, globalObject, index);
    }

    String keyStr = String::number(index);
    syncWindowsEnv(store, keyStr, nullptr);
    store->remove(keyStr);
    return Base::deletePropertyByIndex(cell, globalObject, index);
}

JSValue createSharedEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* structure = JSSharedEnvMap::createStructure(vm, globalObject, globalObject->objectPrototype());
    return JSSharedEnvMap::create(vm, structure);
}

bool isProcessEnvClassInfo(const JSC::ClassInfo* classInfo)
{
    return classInfo == JSEnvironmentVariableMap::info() || classInfo == JSSharedEnvMap::info();
}

RefPtr<SharedEnvStore> ensureSharedEnvStoreForWorker(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Already in a tree: the child aliases the same store, exactly as node hands it
    // a shared_ptr to the creating thread's KVStore.
    if (auto* existing = sharedEnvStoreFor(globalObject))
        return existing;

    // Founding a new tree. processEnvObject() forces the lazy init so the OS
    // environment is captured before the swap below.
    JSObject* envObject = globalObject->processEnvObject();
    if (!envObject->staticPropertiesReified()) {
        envObject->reifyAllStaticProperties(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    JSC::PropertyNameArrayBuilder keys(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    envObject->methodTable()->getOwnPropertyNames(envObject, globalObject, keys, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Seed unconditionally: this thread's env is the new tree's initial contents.
    auto store = SharedEnvStore::create(globalObject->scriptExecutionContext()->isMainThread());
    for (const auto& key : keys) {
        JSValue value = envObject->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, nullptr);
        // Windows' process.env Proxy owns an enumerable `toJSON`; it is not an env var.
        if (value.isCallable())
            continue;
        String str = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        store->set(String(key.impl()), str);
    }

    // Enumerating or reading process.env can run user JS (an accessor, or Windows'
    // Proxy traps) that spawns a SHARE_ENV worker and founds the tree first. Defer
    // to it instead of overwriting its store and re-swapping process.env.
    if (auto* existing = sharedEnvStoreFor(globalObject))
        return existing;

    // Publish before creating the view, which resolves its store via the context.
    globalObject->scriptExecutionContext()->setSharedEnvStore(store.get());

    // Swap this global's process.env to the shared, write-through variant.
    auto* shared = createSharedEnvironmentVariablesMap(globalObject).getObject();
    globalObject->m_processEnvObject.set(vm, globalObject, shared);

    auto envIdentifier = JSC::Identifier::fromString(vm, "env"_s);

    // process.env may already be reified as an own property on the process object;
    // overwrite it so it resolves to the shared variant.
    if (globalObject->hasProcessObject()) {
        JSObject* processObject = globalObject->processObject();
        processObject->putDirect(vm, envIdentifier, shared, 0);
    }

    // Bun.env reifies to the same object at startup; repoint it too, or it keeps
    // observing the orphaned pre-swap env and silently diverges from process.env.
    if (globalObject->m_bunObject.isInitialized()) {
        JSObject* bunObject = globalObject->bunObject();
        if (bunObject->getDirect(vm, envIdentifier))
            bunObject->putDirect(vm, envIdentifier, shared, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
    }

    return store;
}

JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    void* list;
    size_t count = Bun__getEnvCount(globalObject, &list);
#if OS(WINDOWS)
    // On Windows process.env is wrapped in the windowsEnv Proxy (for
    // case-insensitive lookups), whose traps intercept every operation before
    // it would reach the exotic JSEnvironmentVariableMap method table — and
    // whose internal setup (the symbol-keyed Bun.inspect.custom helper and
    // the string-coercing toJSON) would hit the exotic put's symbol-key
    // TypeError. Keep the plain object there; the Node-specific semantics
    // live in the Proxy traps.
    JSC::JSObject* object = nullptr;
    if (count < 63) {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype(), count);
    } else {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype());
    }

    JSArray* keyArray = constructEmptyArray(globalObject, nullptr, count);
    RETURN_IF_EXCEPTION(scope, {});
#else
    auto* structure = JSEnvironmentVariableMap::createStructure(vm, globalObject, globalObject->objectPrototype());
    JSC::JSObject* object = JSEnvironmentVariableMap::create(vm, structure);
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
        // without calling the setter, leaving the native env map stale.
        // Use `process.env.NO_PROXY = ""` to unset. TZ delete is handled in
        // deleteProperty above; proxy vars need a native unset FFI export first.
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
    args.append(JSC::JSFunction::create(vm, globalObject, 2, "coerceForWrite"_s, jsProcessEnvCoerceForWrite, ImplementationVisibility::Private));
    args.append(JSC::JSFunction::create(vm, globalObject, 0, "resetTZ"_s, jsProcessEnvResetTZ, ImplementationVisibility::Private));
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
