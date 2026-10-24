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
#include <wtf/text/MakeString.h>

using namespace JSC;

extern "C" size_t Bun__getEnvCount(JSGlobalObject* globalObject, void** list_ptr);
extern "C" size_t Bun__getEnvKey(void* list, size_t index, unsigned char** out);

extern "C" bool Bun__getEnvValue(JSGlobalObject* globalObject, const EncodedSlice* name, EncodedSlice* value);
extern "C" void Bun__setEnvValue(JSGlobalObject* globalObject, const BunString* name, const BunString* value);
extern "C" bool Bun__Node__ProcessPendingDeprecation;

namespace Bun {

using namespace WebCore;

void invalidateLiveDateInstanceCaches(JSC::VM& vm)
{
    // The walk stops every allocator of the heap. No Date has a local time to drop before one has computed it.
    if (!vm.dateCache.takeMayHaveCachedLocalGregorianDateTime())
        return;
    JSC::HeapIterationScope iterationScope(vm.heap);
    vm.heap.dateInstanceSpace.forEachLiveCell([](JSC::HeapCell* cell, JSC::HeapCell::Kind) -> IterationStatus {
        static_cast<JSC::DateInstance*>(static_cast<JSC::JSCell*>(cell))->invalidateCachedLocalGregorianDateTime();
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

bool setProcessTimeZone(JSC::VM& vm, StringView zoneID)
{
    // The longest zone name has 32 characters. ICU makes a copy of a value before it rejects it.
    static constexpr unsigned maxZoneIDLength = 128;
    if (zoneID.length() > maxZoneIDLength || !WTF::setTimeZoneOverride(zoneID))
        return false;
    resetDateCachesAfterTimeZoneChange(vm);
    return true;
}

void clearProcessTimeZone(JSC::VM& vm)
{
    WTF::setTimeZoneOverride(String());
    resetDateCachesAfterTimeZoneChange(vm);
}

struct PosixStandardTime {
    int32_t secondsWest { 0 };
    bool isWholeValue { false };
};

// A POSIX TZ value starts `std offset`: a name, then the [+-]hh[:mm[:ss]] to add to local time to get UTC.
static std::optional<PosixStandardTime> parsePosixStandardTime(StringView text)
{
    unsigned position = 0;
    auto peek = [&]() -> char16_t { return position < text.length() ? text[position] : 0; };
    auto consumeNumber = [&](int32_t max) -> std::optional<int32_t> {
        unsigned start = position;
        int32_t value = 0;
        while (isASCIIDigit(peek()) && position - start < 2)
            value = value * 10 + (text[position++] - '0');
        if (position == start || value > max)
            return std::nullopt;
        return value;
    };

    if (peek() == '<') {
        unsigned start = ++position;
        while (isASCIIAlphanumeric(peek()) || peek() == '+' || peek() == '-')
            ++position;
        if (position - start < 3 || peek() != '>')
            return std::nullopt;
        ++position;
    } else {
        while (isASCIIAlpha(peek()))
            ++position;
        if (position < 3)
            return std::nullopt;
    }

    bool isEast = peek() == '-';
    if (isEast || peek() == '+')
        ++position;
    auto hours = consumeNumber(24);
    if (!hours)
        return std::nullopt;
    int32_t seconds = hours.value() * 3600;
    for (int32_t unit : { 60, 1 }) {
        if (peek() != ':')
            break;
        ++position;
        auto part = consumeNumber(59);
        if (!part)
            return std::nullopt;
        seconds += part.value() * unit;
    }
    return PosixStandardTime { isEast ? -seconds : seconds, position == text.length() };
}

// "Etc/GMT-14" to "Etc/GMT+12" are the zones a whole number of hours from UTC. Their sign counts west, as in TZ.
static String zoneIDForWholeHoursWest(int32_t secondsWest)
{
    int32_t hoursWest = secondsWest / 3600;
    if (secondsWest % 3600 || hoursWest < -14 || hoursWest > 12)
        return String();
    return makeString("Etc/GMT"_s, hoursWest > 0 ? '+' : '-', static_cast<unsigned>(std::abs(hoursWest)));
}

// ICU reads "GMT+3" as three hours east. In TZ it is a POSIX value, three hours west.
static bool isPosixOffsetFromGMT(StringView value)
{
    constexpr auto gmt = "gmt"_s;
    if (value.length() <= gmt.length() || !startsWithLettersIgnoringASCIICase(value, gmt))
        return false;
    char16_t next = value[gmt.length()];
    return next == '+' || next == '-';
}

static bool hasProcessTimeZone()
{
    Vector<char16_t, 32> zoneID;
    WTF::getTimeZoneOverride(zoneID);
    return !zoneID.isEmpty();
}

void applyTimeZoneFromEnv(JSC::VM& vm, const String& value, TimeZoneWriter writer)
{
    StringView name = value;
    if (name.startsWith(':'))
        name = name.substring(1);
    // Only the C library can read the tzfile at a path, and what follows `std offset` in a POSIX value.
    bool isForHost = value.isEmpty() || name.startsWith('/');
    if (!isForHost) {
        // "posix/" and "right/" are directories of tzfiles: a file name follows them, and not a POSIX value.
        bool isFileName = false;
        for (auto directory : { "posix/"_s, "right/"_s }) {
            if (name.startsWith(directory)) {
                name = name.substring(directory.length());
                isFileName = true;
                break;
            }
        }
        if (!name.isEmpty() && !isPosixOffsetFromGMT(name) && setProcessTimeZone(vm, name))
            return;
        if (auto standard = isFileName ? std::nullopt : parsePosixStandardTime(name)) {
            String zoneID = standard->isWholeValue ? zoneIDForWholeHoursWest(standard->secondsWest) : String();
            if (!zoneID.isNull() && setProcessTimeZone(vm, zoneID))
                return;
            isForHost = true;
        }
    }
    // Node gives UTC for an assigned name that no zone has: https://github.com/nodejs/node/blob/v26.3.0/src/node_env_var.cc#L78-L105
    if (!isForHost && writer == TimeZoneWriter::Assignment && setProcessTimeZone(vm, "UTC"_s))
        return;
    // A start has no zone to give back, and the restore of `bun test --isolate` has one only when a file set it.
    if (writer == TimeZoneWriter::Start && !hasProcessTimeZone())
        return;
    clearProcessTimeZone(vm);
}

const JSC::ClassInfo JSEnvironmentVariableMap::s_info = { "ProcessEnv"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSEnvironmentVariableMap) };

// Node's EnvSetter DEP0104 (https://github.com/nodejs/node/blob/main/src/node_env_var.cc): once per
// Environment under --pending-deprecation. Every process.env write path goes through here.
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

// The proxy env vars are written back to the native env map, which is what
// fetch()'s proxy resolution reads.
// `name` is an atom (a property key's uid), and so is what a common string
// holds: matching one is a pointer comparison.
static bool isProxyEnvVarName(VM& vm, const StringImpl* name)
{
    // "NO_PROXY" .. "HTTPS_PROXY"
    if (!name || name->length() < 8 || name->length() > 11)
        return false;
    auto& strings = Bun::commonStrings(vm);
    auto is = [name](JSC::JSString* candidate) { return candidate->tryGetValueImpl() == name; };
    return is(strings.envALL_PROXYString()) || is(strings.envAllProxyString()) || is(strings.envHTTPS_PROXYString()) || is(strings.envHttpsProxyString()) || is(strings.envHTTP_PROXYString()) || is(strings.envHttpProxyString()) || is(strings.envNO_PROXYString()) || is(strings.envNoProxyString());
}

// For a name that is not a property key in hand: Windows upper-cases the key on the way here.
static bool isProxyEnvVarName(VM& vm, const String& name)
{
    if (name.length() < 8 || name.length() > 11)
        return false;
    return isProxyEnvVarName(vm, JSC::Identifier::fromString(vm, name).impl());
}

// Drop `name` from the native env map.
static void removeNativeEnvValue(JSGlobalObject* globalObject, const String& name)
{
    BunString key = Bun::toString(name);
    BunString dead = { .tag = BunStringTag::Dead };
    Bun__setEnvValue(globalObject, &key, &dead);
}

static void setNativeEnvValue(JSGlobalObject* globalObject, const String& name, JSC::JSString* value)
{
    auto view = value->view(globalObject);
    if (view->isNull())
        return;
    BunString key = Bun::toString(name);
    BunString val = Bun::toStringView(view);
    Bun__setEnvValue(globalObject, &key, &val);
}

static void applyTZFromString(JSGlobalObject*, const String&);
static void applyTLSRejectFromString(JSGlobalObject*, const String&);
static void applyVerboseFetchFromString(JSGlobalObject*, const String&);
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

static void applyTLSRejectEnvValue(JSGlobalObject* globalObject, JSC::JSString* string)
{
    auto view = string->view(globalObject);
    if (view->isNull())
        return;
    applyTLSRejectFromString(globalObject, view->toString());
}

bool JSEnvironmentVariableMap::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // A write to an object that merely inherits from process.env is that
    // object's: an ordinary set, with the value as given, that changes nothing
    // about the process. The accessors process.env keeps for TZ and
    // NODE_TLS_REJECT_UNAUTHORIZED act on the process, so past those the value
    // is defined on the receiver directly.
    if (slot.thisValue() != cell) [[unlikely]] {
        unsigned attributes = 0;
        bool isProcessAccessor = !parseIndex(propertyName)
            && isValidOffset(cell->structure()->get(vm, propertyName, attributes))
            && (attributes & PropertyAttribute::CustomAccessor);
        if (isProcessAccessor)
            RELEASE_AND_RETURN(scope, JSObject::definePropertyOnReceiver(globalObject, propertyName, value, slot));
        RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, propertyName, value, slot));
    }

    auto* uid = propertyName.uid();
    if (uid && uid->isSymbol()) {
        throwTypeError(globalObject, scope, "Cannot convert a symbol to a string"_s);
        return false;
    }

    // Node silently ignores assignments to an empty variable name
    // (https://github.com/nodejs/node/issues/32920).
    if (propertyName.publicName() && propertyName.publicName()->isEmpty())
        return true;

    // A cached put would store the raw value and skip this function. Inline caches also can't handle a toString() that adds or deletes a key.
    slot.disableCaching();

    JSString* string = coerceEnvValue(globalObject, scope, value);
    RETURN_IF_EXCEPTION(scope, false);

    // Node's RealEnvStore::Set name-matches TZ on every write, so delete-then-set still
    // updates Date caches. putDirect bypasses the accessor so the side effect fires once.
    if (uid && WTF::equal(uid, "TZ"_s)) [[unlikely]] {
        applyTimeZoneEnvValue(globalObject, string);
        RETURN_IF_EXCEPTION(scope, false);
        static_cast<JSEnvironmentVariableMap*>(cell)->putDirect(vm, propertyName, string, 0);
        return true;
    }
    if (uid && WTF::equal(uid, "NODE_TLS_REJECT_UNAUTHORIZED"_s)) [[unlikely]] {
        applyTLSRejectEnvValue(globalObject, string);
        RETURN_IF_EXCEPTION(scope, false);
        static_cast<JSEnvironmentVariableMap*>(cell)->putDirect(vm, propertyName, string, 0);
        return true;
    }
    // fetch() reads the proxy variables from the native env map.
    if (isProxyEnvVarName(vm, uid)) [[unlikely]] {
        setNativeEnvValue(globalObject, String(uid), string);
        RETURN_IF_EXCEPTION(scope, false);
        static_cast<JSEnvironmentVariableMap*>(cell)->putDirect(vm, propertyName, string, 0);
        return true;
    }
    // No write is cached, so skip the prototype chain walk when the variable is already a plain property.
    Structure* structure = cell->structure();
    unsigned attributes = 0;
    PropertyOffset offset = structure->get(vm, propertyName, attributes);
    if (isValidOffset(offset) && !attributes) [[likely]] {
        structure->didReplaceProperty(offset);
        static_cast<JSEnvironmentVariableMap*>(cell)->putDirectOffset(vm, offset, string);
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

    // Node's EnvDefiner delegates to EnvSetter (plain assignment). put() keeps TZ/proxy
    // CustomAccessors intact; Base::defineOwnProperty would replace them.
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

    EncodedSlice name = toEncodedSlice(propertyName.publicName());
    EncodedSlice value = { nullptr, 0 };

    if (name.len == 0) [[unlikely]]
        return JSValue::encode(jsUndefined());

    if (!Bun__getEnvValue(globalObject, &name, &value)) {
        return JSValue::encode(jsUndefined());
    }

    JSValue result = jsString(vm, Zig::toStringCopy(value));
    thisObject->putDirect(vm, propertyName, result, 0);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(jsTimeZoneEnvironmentVariableGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    auto* clientData = WebCore::clientData(vm);

    EncodedSlice name = toEncodedSlice(propertyName.publicName());
    EncodedSlice value = { nullptr, 0 };

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

// Store-only: the TZ side effect fires from put() / jsProcessEnvCoerceForWrite on every
// write. Firing here too would double-apply on Windows (writeEnvVar already ran it).
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

    // Node's RealEnvStore::Delete resets Date caches for TZ; without this, delete drops
    // the CustomAccessor and existing Dates keep the old offset. put() handles re-set.
    auto* uid = propertyName.publicName();
    if (uid && WTF::equal(uid, "TZ"_s)) {
        if (shouldApplyTZSideEffect(globalObject))
            clearProcessTimeZone(vm);
        auto* clientData = WebCore::clientData(vm);
        DeletePropertySlot dataSlot;
        Base::deleteProperty(cell, globalObject, clientData->builtinNames().dataPrivateName(), dataSlot);
        RETURN_IF_EXCEPTION(scope, false);
    } else if (uid && WTF::equal(uid, "NODE_TLS_REJECT_UNAUTHORIZED"_s)) {
        applyTLSRejectFromString(globalObject, String());
    } else if (isProxyEnvVarName(vm, uid)) {
        removeNativeEnvValue(globalObject, String(uid));
    }

    RELEASE_AND_RETURN(scope, Base::deleteProperty(cell, globalObject, propertyName, slot));
}

extern "C" int Bun__getTLSRejectUnauthorizedValue();
extern "C" void Bun__setTLSRejectUnauthorizedValue(int value);
extern "C" int Bun__getVerboseFetchValue();
extern "C" void Bun__setVerboseFetchValue(int value);

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

    EncodedSlice name = toEncodedSlice(propertyName.publicName());
    EncodedSlice value = { nullptr, 0 };

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

    EncodedSlice name = toEncodedSlice(propertyName.publicName());
    EncodedSlice value = { nullptr, 0 };

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
extern "C" void Bun__Process__editWindowsEnvVar(const BunString*, const BunString*);

// Windows Proxy set/defineProperty write path: DEP0104 + ToString via coerceEnvValue,
// plus the TZ side effect so it survives `delete process.env.TZ`. Returns the string.
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
        } else if (WTF::equal(keyView, "NODE_TLS_REJECT_UNAUTHORIZED"_s)) {
            applyTLSRejectEnvValue(globalObject, string);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return JSValue::encode(string);
}

// `delete process.env.X` on Windows: undo X's native side effect (POSIX handles this in
// JSEnvironmentVariableMap::deleteProperty; the Windows internalEnv is a plain object).
JSC_DEFINE_HOST_FUNCTION(jsProcessEnvResetForDelete, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue key = callFrame->argument(0);
    if (!key.isString())
        return JSValue::encode(jsUndefined());
    auto keyView = asString(key)->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (WTF::equal(keyView, "TZ"_s)) {
        if (shouldApplyTZSideEffect(globalObject))
            clearProcessTimeZone(vm);
    } else if (WTF::equal(keyView, "NODE_TLS_REJECT_UNAUTHORIZED"_s)) {
        applyTLSRejectFromString(globalObject, String());
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
        BunString k = Bun::toString(string1);
        BunString v = Bun::toString(string2);
        Bun__Process__editWindowsEnvVar(&k, &v);
        // fetch() reads the proxy variables from the native env map.
        if (isProxyEnvVarName(global->vm(), string1))
            Bun__setEnvValue(global, &k, &v);
    } else {
        BunString k = Bun::toString(string1);
        BunString v = { .tag = BunStringTag::Dead };
        Bun__Process__editWindowsEnvVar(&k, &v);
        if (isProxyEnvVarName(global->vm(), string1))
            Bun__setEnvValue(global, &k, &v);
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
    BunString k = Bun::toString(key);
    BunString v = value ? Bun::toString(*value) : BunString { .tag = BunStringTag::Dead };
    Bun__Process__editWindowsEnvVar(&k, &v);
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray | JSC::MayHaveIndexedAccessors);
    }

    static JSSharedEnvMap* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSSharedEnvMap* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSSharedEnvMap))) JSSharedEnvMap(vm, structure);
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

// Node does not intercept TZ in workers (only RealEnvStore::Set notifies, and worker env
// is a MapKVStore). WTF::setTimeZoneOverride is process-global, so a worker write would
// flip the main thread's timezone while only invalidating the worker VM's Date caches.
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
    applyTimeZoneFromEnv(JSC::getVM(globalObject), value, TimeZoneWriter::Assignment);
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
    if (isProxyEnvVarName(JSC::getVM(globalObject), key)) {
        BunString name = Bun::toString(key);
        BunString val = Bun::toString(stringValue);
        Bun__setEnvValue(globalObject, &name, &val);
    }
}

bool JSSharedEnvMap::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // As in JSEnvironmentVariableMap::put, a write to an object that inherits from process.env is that object's.
    if (slot.thisValue() != cell) [[unlikely]]
        RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, propertyName, value, slot));

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
    String normalizedKey = SharedEnvStore::normalizeKey(key);
    if (normalizedKey == "TZ"_s && shouldApplyTZSideEffect(globalObject)) {
        clearProcessTimeZone(JSC::getVM(globalObject));
    } else if (normalizedKey == "NODE_TLS_REJECT_UNAUTHORIZED"_s) {
        applyTLSRejectFromString(globalObject, String());
    } else if (isProxyEnvVarName(JSC::getVM(globalObject), normalizedKey)) {
        removeNativeEnvValue(globalObject, normalizedKey);
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

    // Node's EnvDefiner rejects accessors on every env store, so SHARE_ENV matches the
    // regular map; also keeps a getter off Base where the store entry would shadow it.
    if (descriptor.isAccessorDescriptor()) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_OBJECT_DEFINE_PROPERTY, "'process.env' does not accept an accessor(getter/setter) descriptor"_s);
        return false;
    }

    if (propertyName.isSymbol() || !uid || !descriptor.isDataDescriptor() || !descriptor.value()) {
        // getOwnPropertySlot reads the store first; move the entry onto Base so a partial
        // descriptor keeps enumerability. Node's EnvDefiner also rejects partials (the regular
        // map does); tightening SHARE_ENV is a separate behavior change with its own tests.
        if (!propertyName.isSymbol() && uid) {
            if (auto* store = sharedEnvStoreFor(object)) {
                String existing = store->get(String(uid));
                if (!existing.isNull()) {
                    syncWindowsEnv(store, String(uid), nullptr);
                    store->remove(String(uid));
                    // An env var name can be an array index.
                    object->putDirectMayBeIndex(globalObject, propertyName, jsString(vm, existing));
                    RETURN_IF_EXCEPTION(scope, false);
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
    RETURN_IF_EXCEPTION(scope, nullptr);
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

JSObject* createEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    void* list;
    size_t count = Bun__getEnvCount(globalObject, &list);
#if OS(WINDOWS)
    // On Windows the windowsEnv Proxy intercepts every operation before the exotic
    // method table, and its internal setup (Bun.inspect.custom symbol, toJSON) would hit
    // the exotic put's symbol-key TypeError. Keep a plain object; semantics live in traps.
    JSC::JSObject* object = nullptr;
    if (count > 0 && count < 63) {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype(), count);
    } else {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype());
    }

    JSArray* keyArray = constructEmptyArray(globalObject, nullptr, count);
    RETURN_IF_EXCEPTION(scope, nullptr);
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

    auto* cached_getter_setter = JSC::CustomGetterSetter::create(vm, jsGetterEnvironmentVariable, nullptr);

    for (size_t i = 0; i < count; i++) {
        unsigned char* chars;
        size_t len = Bun__getEnvKey(list, i, &chars);
        // We can't really trust that the OS gives us valid UTF-8
        auto name = String::fromUTF8ReplacingInvalidSequences(std::span { chars, len });
#if OS(WINDOWS)
        // Avoid [[Set]], which can run an indexed setter on Object.prototype while `list` points into the env table.
        keyArray->putDirectIndex(globalObject, (unsigned)i, jsString(vm, name));
        RETURN_IF_EXCEPTION(scope, nullptr);
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
            if (parseIndex(identifier)) {
                EncodedSlice valueString = { nullptr, 0 };
                EncodedSlice nameStr = toEncodedSlice(name);
                if (Bun__getEnvValue(globalObject, &nameStr, &valueString)) {
                    JSValue value = jsString(vm, Zig::toStringCopy(valueString));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                    // putDirectIndex falls back to [[Set]] on this exotic object, which can run an indexed setter on Object.prototype.
                    PropertyDescriptor descriptor(value, 0);
                    JSObject::defineOwnProperty(object, globalObject, identifier, descriptor, false);
                    RETURN_IF_EXCEPTION(scope, nullptr);
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

#if OS(WINDOWS)
    auto editWindowsEnvVar = JSC::JSFunction::create(vm, globalObject, 0, String("editWindowsEnvVar"_s), jsEditWindowsEnvVar, ImplementationVisibility::Public);

    JSC::JSFunction* getSourceEvent = JSC::JSFunction::create(vm, globalObject, processObjectInternalsWindowsEnvCodeGenerator(vm), globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSC::MarkedArgumentBuffer args;
    args.append(object);
    args.append(keyArray);
    args.append(editWindowsEnvVar);
    args.append(JSC::JSFunction::create(vm, globalObject, 2, "coerceForWrite"_s, jsProcessEnvCoerceForWrite, ImplementationVisibility::Private));
    args.append(JSC::JSFunction::create(vm, globalObject, 1, "resetForDelete"_s, jsProcessEnvResetForDelete, ImplementationVisibility::Private));
    JSC::CallData callData = JSC::getCallData(getSourceEvent);
    JSValue result = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, getSourceEvent, callData, globalObject->globalThis(), args);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // windowsEnv returns `new Proxy(...)`.
    return asObject(result);
#else
    return object;
#endif
}
}
