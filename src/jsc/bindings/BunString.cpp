

#include "BunString.h"
#include "helpers.h"
#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTPropertyWalk.h>
#endif

#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/PutPropertySlot.h"

#include "wtf/SIMDUTF.h"
#include "JSDOMURL.h"
#include "DOMURL.h"
#include "ZigGlobalObject.h"
#include "IDLTypes.h"
#include "MimallocWTFMalloc.h"

#include <limits>
#include <wtf/Seconds.h>
#include <wtf/text/ExternalStringImpl.h>
#include <JavaScriptCore/JSONObject.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/WTFString.h>

#include "JSDOMWrapperCache.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertAny.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"

#include "wtf/StdLibExtras.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringToIntegerConversion.h"
#include "ErrorCode.h"

using namespace JSC;

extern "C" [[ZIG_EXPORT(nothrow)]] bool BunString__fromJS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* bunString)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    *bunString = Bun::toStringRef(globalObject, value).leak();
    return bunString->tag != BunStringTag::Dead;
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__createUTF8ForJS(JSC::JSGlobalObject* globalObject, const char* ptr, size_t length)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (length == 0) {
        return JSValue::encode(jsEmptyString(vm));
    }
    if (simdutf::validate_ascii(ptr, length)) {
        if (length > WTF::String::MaxLength) [[unlikely]] {
            return Bun::ERR::STRING_TOO_LONG(scope, globalObject);
        }
        // WTF::String(span) crashes if the allocation fails, and the caller controls the length.
        std::span<Latin1Character> characters;
        auto impl = WTF::StringImpl::tryCreateUninitialized(length, characters);
        if (!impl) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        memcpy(characters.data(), ptr, length);
        return JSValue::encode(jsString(vm, WTF::String(impl.releaseNonNull())));
    }

    auto str = Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(ptr), length });
    if (str.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    scope.assertNoException();
    return JSValue::encode(jsString(vm, WTF::move(str)));
}

namespace Bun {
#if ASSERT_ENABLED
static void assertStaticStringIsNotCommon(EncodedSlice slice)
{
    if (Zig::isTaggedUTF16Ptr(slice.ptr))
        return;
    std::span<const Latin1Character> literal { byteCast<Latin1Character>(Zig::untag(slice.ptr)), slice.len };
    ASSERT_WITH_MESSAGE(!CommonStrings::isCommonStringLiteral(literal),
        "\"%.*s\" is in BunCommonStrings.h: use global.common_strings() instead of String::static_(..).to_js()",
        static_cast<int>(literal.size()), reinterpret_cast<const char*>(literal.data()));
}
#else
static inline void assertStaticStringIsNotCommon(EncodedSlice) {}
#endif
}

JSC::JSValue BunString::transferToJS(JSC::JSGlobalObject* globalObject) &&
{
    auto& vm = JSC::getVM(globalObject);

    if (this->tag == BunStringTag::Empty) [[unlikely]] {
        return JSC::jsEmptyString(vm);
    }

    if (this->tag == BunStringTag::Dead) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return JSValue::decode(Bun::ERR::STRING_TOO_LONG(scope, globalObject));
    }

    if (this->tag == BunStringTag::OutOfMemory) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return JSValue::decode(Bun::ERR::MEMORY_ALLOCATION_FAILED(scope, globalObject));
    }

    if (this->tag == BunStringTag::WTFStringImpl) [[likely]] {
        ASSERT((this->impl.wtf->isStatic() || this->impl.wtf->refCount() > 0) && !this->impl.wtf->isEmpty());
        auto str = WTF::String(adoptRef(*this->impl.wtf));
        *this = { .tag = BunStringTag::Dead };
        return jsString(vm, WTF::move(str));
    }

    // EncodedSlice / StaticEncodedSlice: copies (the bytes are borrowed).
    if (this->tag == BunStringTag::StaticEncodedSlice)
        Bun::assertStaticStringIsNotCommon(this->impl.encoded);
    WTF::String str = this->toWTFString();
    *this = { .tag = BunStringTag::Dead };
    return jsString(vm, WTF::move(str));
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__transferToJS(BunString* bunString, JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(WTF::move(*bunString).transferToJS(globalObject));
}

// `message` for an Error built from a BunString: a WTF-backed string shares
// its impl, a static one is atomized, a borrowed EncodedSlice is copied.
static WTF::String errorMessage(const BunString* str)
{
    if (str->tag == BunStringTag::EncodedSlice)
        return Zig::toStringCopy(str->impl.encoded);
    return str->toWTFString(BunString::ZeroCopy);
}

extern "C" JSC::EncodedJSValue BunString__toErrorInstance(const BunString* str, JSC::JSGlobalObject* globalObject, BunErrorKind kind)
{
    WTF::String message = errorMessage(str);
    // Callers throw, reject with, or set properties on the result, so always return an error object.
    if (message.isNull() && (str->tag == BunStringTag::Dead || !str->isEmpty())) [[unlikely]]
        message = "The error message exceeds the maximum string length"_s;
    JSC::ErrorType type = JSC::ErrorType::Error;
    switch (kind) {
    case BunErrorKind::Error:
        type = JSC::ErrorType::Error;
        break;
    case BunErrorKind::TypeError:
        type = JSC::ErrorType::TypeError;
        break;
    case BunErrorKind::SyntaxError:
        type = JSC::ErrorType::SyntaxError;
        break;
    case BunErrorKind::RangeError:
        type = JSC::ErrorType::RangeError;
        break;
    }
    // Not JSC::createError(): it asserts the message is not empty, and `new Error("")` is valid.
    JSC::JSObject* result = JSC::ErrorInstance::create(globalObject->vm(), globalObject->errorStructure(type), message, JSValue(), nullptr, JSC::TypeNothing, type, true);
    JSC::EnsureStillAliveScope ensureAlive(result);
    return JSValue::encode(result);
}

namespace Bun {

static UniquedStringImpl* nameOfProgram(JSC::VM& vm, const EncodedSlice& text)
{
    if (!vm.hasCompiledCode() || !text.ptr || Zig::isTaggedUTF16Ptr(text.ptr) || Zig::isTaggedUTF8Ptr(text.ptr))
        return nullptr;
    return JSC::AOT::PropertyWalk::tryFindName(vm, { byteCast<Latin1Character>(Zig::untag(text.ptr)), text.len });
}

JSC::JSString* toJS(JSC::JSGlobalObject* globalObject, BunString bunString)
{
    if (bunString.tag == BunStringTag::Empty) {
        return JSC::jsEmptyString(globalObject->vm());
    }

    if (bunString.tag == BunStringTag::Dead) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        Bun::ERR::STRING_TOO_LONG(scope, globalObject);
        return nullptr;
    }

    if (bunString.tag == BunStringTag::OutOfMemory) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        Bun::ERR::MEMORY_ALLOCATION_FAILED(scope, globalObject);
        return nullptr;
    }

    if (bunString.tag == BunStringTag::WTFStringImpl) {
#if ASSERT_ENABLED
        ASSERT(bunString.impl.wtf->hasAtLeastOneRef() && !bunString.impl.wtf->isEmpty());
#endif

        return JSC::jsString(globalObject->vm(), String(bunString.impl.wtf));
    }

    if (bunString.tag == BunStringTag::StaticEncodedSlice) {
        assertStaticStringIsNotCommon(bunString.impl.encoded);
        if (auto* name = nameOfProgram(globalObject->vm(), bunString.impl.encoded))
            return JSC::jsString(globalObject->vm(), String(*name));
        return JSC::jsString(globalObject->vm(), Zig::toStringStatic(bunString.impl.encoded));
    }

    if (bunString.tag == BunStringTag::EncodedSlice) {
        return Zig::toJSStringGC(bunString.impl.encoded, globalObject);
    }

    RELEASE_ASSERT_NOT_REACHED();
}

JSC::Identifier toIdentifier(JSC::VM& vm, const BunString& bunString)
{
    ASSERT(!bunString.isDead());
    if (bunString.isEmpty()) {
        return vm.propertyNames->emptyIdentifier;
    }
    if (bunString.tag == BunStringTag::StaticEncodedSlice) {
        if (auto* name = nameOfProgram(vm, bunString.impl.encoded))
            return JSC::Identifier::fromUid(vm, name);
        return JSC::Identifier::fromString(vm, Zig::toStringStatic(bunString.impl.encoded));
    }
    return JSC::Identifier::fromString(vm, bunString.toWTFString());
}

OwnedString toStringRef(JSC::JSGlobalObject* globalObject, JSValue value)
{
    auto str = value.toWTFString(globalObject);
    if (str.isNull()) [[unlikely]] {
        return {};
    }

    return toStringRef(WTF::move(str));
}

BunString toString(WTF::String& wtfString)
{
    if (wtfString.isEmpty())
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}
BunString toString(const WTF::String& wtfString)
{
    if (wtfString.isEmpty())
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}
BunString toString(WTF::StringImpl* wtfString)
{
    if (wtfString->isEmpty())
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString } };
}

OwnedString toStringRef(WTF::String wtfString)
{
    if (wtfString.isEmpty())
        return OwnedString::adopt({ BunStringTag::Empty });

    return OwnedString::adopt({ BunStringTag::WTFStringImpl, { .wtf = wtfString.releaseImpl().leakRef() } });
}

BunString toStringView(StringView view)
{
    return {
        BunStringTag::EncodedSlice,
        { .encoded = toEncodedSlice(view) }
    };
}

// We don't want to ban atomiziation for tiny strings that are potentially going
// to appear as properties/identifiers in JS. So we should only do this for long
// strings that are unlikely to ever be atomized.
static constexpr unsigned int kMinCrossThreadShareableLength = 256;

// An isolated copy still gets handed to (possibly several) receiving threads —
// BroadcastChannel fans a single SerializedScriptValue out to N contexts, each
// of which deserializes the same stored string — so the copy needs the same
// pre-hash + never-atomize treatment as a directly-shared original. Otherwise
// the receivers race the lazy m_hashAndFlags update (debug: ASSERT(!hasHash())
// in setHash; e.g. two workers switch()ing on the same BroadcastChannel
// message). Static strings are immortal, pre-hashed and safe to share as-is.
Ref<WTF::StringImpl> threadShareableCopy(const WTF::StringImpl& impl)
{
    Ref<WTF::StringImpl> copy = impl.isolatedCopy();
    if (!copy->isStatic()) {
        copy->hash();
        copy->setNeverAtomize();
    }
    return copy;
}

Ref<WTF::StringImpl> makeThreadShareable(WTF::StringImpl& impl)
{
    if (impl.isAtom() || impl.isSymbol() || impl.isSubString())
        return threadShareableCopy(impl);
    if (!impl.isStatic()) {
        impl.hash();
        // Already set means other threads may hold this impl; don't write the flags word.
        if (impl.canBecomeAtom())
            impl.setNeverAtomize();
    }
    return impl;
}

WTF::String toCrossThreadShareable(const WTF::String& string)
{
    auto* impl = string.impl();
    if (!impl)
        return string;
    if (impl->length() < kMinCrossThreadShareableLength)
        return threadShareableCopy(*impl);
    return makeThreadShareable(*impl);
}

std::optional<UTF8View> UTF8View::tryCreate(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, WTF::StringView view)
{
    auto result = tryCreate(view);
    if (!result) [[unlikely]]
        throwOutOfMemoryError(globalObject, scope);
    return result;
}

}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject* globalObject, const BunString* bunString)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* result = Bun::toJS(globalObject, *bunString);
    RETURN_IF_EXCEPTION(scope, {});
    if (!result) [[unlikely]] {
        return {};
    }
    return JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__toJSON(
    JSC::JSGlobalObject* globalObject,
    const BunString* bunString)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    // toWTFString() is null for an empty string, and JSONParseWithException throws nothing for null.
    WTF::String string = !bunString->isDead() && bunString->isEmpty() ? emptyString() : bunString->toWTFString();
    JSC::JSValue result = JSC::JSONParseWithException(globalObject, string);

    if (!result && !scope.exception()) {
        scope.throwException(globalObject, createSyntaxError(globalObject, "Failed to parse JSON"_s));
    }

    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue BunString__createArray(
    JSC::JSGlobalObject* globalObject,
    const BunString* ptr, size_t length)
{
    if (length == 0)
        return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));

    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // Using tryCreateUninitialized here breaks stuff..
    // https://github.com/oven-sh/bun/issues/3931
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, length);
    RETURN_IF_EXCEPTION(throwScope, {});

    for (size_t i = 0; i < length; ++i) {
        auto* str = Bun::toJS(globalObject, *ptr++);
        RETURN_IF_EXCEPTION(throwScope, {});
        array->putDirectIndex(globalObject, i, str);
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    return JSValue::encode(array);
}

extern "C" JSC::EncodedJSValue BunString__toJSDOMURL(JSC::JSGlobalObject* lexicalGlobalObject, const BunString* bunString)
{
    auto& globalObject = *uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = globalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto str = bunString->toWTFString(BunString::ZeroCopy);

    auto object = WebCore::DOMURL::create(str, String());
    auto jsValue = WebCore::toJSNewlyCreated<WebCore::IDLInterface<WebCore::DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTF::move(object));
    RETURN_IF_EXCEPTION(throwScope, {});
    auto* jsDOMURL = uncheckedDowncast<WebCore::JSDOMURL>(jsValue.asCell());
    vm.heap.reportExtraMemoryAllocated(jsDOMURL, jsDOMURL->wrapped().memoryCostForGC());
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsValue));
}

WTF::String BunString::toWTFString() const
{
    if (this->tag == BunStringTag::EncodedSlice) {
        if (Zig::isTaggedExternalPtr(this->impl.encoded.ptr)) {
            return Zig::toString(this->impl.encoded);
        } else {
            return Zig::toStringCopy(this->impl.encoded);
        }
    } else if (this->tag == BunStringTag::StaticEncodedSlice) {
        return Zig::toStringCopy(this->impl.encoded);
    } else if (this->tag == BunStringTag::WTFStringImpl) {
        return WTF::String(this->impl.wtf);
    }

    return WTF::String();
}

WTF::String BunString::toWTFString(ZeroCopyTag) const
{
    if (this->tag == BunStringTag::EncodedSlice) {
        if (Zig::isTaggedUTF8Ptr(this->impl.encoded.ptr)) {
            return Zig::toStringCopy(this->impl.encoded);
        } else {
            return Zig::toString(this->impl.encoded);
        }
    } else if (this->tag == BunStringTag::StaticEncodedSlice) {
        return Zig::toStringStatic(this->impl.encoded);
    } else if (this->tag == BunStringTag::WTFStringImpl) {
        ASSERT((this->impl.wtf->isStatic() || this->impl.wtf->refCount() > 0) && !this->impl.wtf->isEmpty());
        return WTF::String(this->impl.wtf);
    }

    return WTF::String();
}

WTF::String BunString::toWTFString(NonNullTag) const
{
    WTF::String res = toWTFString(ZeroCopy);
    if (res.isNull()) {
        // TODO(dylan-conway): also use emptyString in toWTFString(ZeroCopy) and toWTFString. This will
        // require reviewing each call site for isNull() checks and most likely changing them to isEmpty()
        return WTF::emptyString();
    }
    return res;
}

WTF::String BunString::transferToWTFString() &&
{
    if (this->tag == BunStringTag::EncodedSlice) {
        if (Zig::isTaggedUTF8Ptr(this->impl.encoded.ptr)) {
            auto str = Zig::toStringCopy(this->impl.encoded);
            *this = Zig::BunStringEmpty;
            return str;
        } else {
            auto str = Zig::toString(this->impl.encoded);
            *this = Zig::BunStringEmpty;
            return str;
        }
    } else if (this->tag == BunStringTag::StaticEncodedSlice) {
        auto str = Zig::toStringStatic(this->impl.encoded);
        *this = Zig::BunStringEmpty;
        return str;
    } else if (this->tag == BunStringTag::WTFStringImpl) {
        ASSERT((this->impl.wtf->isStatic() || this->impl.wtf->refCount() > 0) && !this->impl.wtf->isEmpty());

        auto str = WTF::String(adoptRef(*this->impl.wtf));
        *this = Zig::BunStringEmpty;
        return str;
    }

    return WTF::String();
}

extern "C" JSC::EncodedJSValue JSC__JSValue__upsertBunStringArray(
    JSC::EncodedJSValue encodedTarget,
    JSC::JSGlobalObject* global,
    const BunString* key,
    JSC::EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    JSC::JSValue targetValue = JSC::JSValue::decode(encodedTarget);
    JSC::JSObject* target = targetValue.getObject();
    if (!target) {
        scope.throwException(global, createTypeError(global, "Target must be an object"_s));
        return {};
    }
    JSC::JSValue newValue = JSC::JSValue::decode(encodedValue);
    auto& vm = global->vm();
    Identifier id = Bun::toIdentifier(vm, *key);
    auto existingValue = target->getIfPropertyExists(global, id);
    RETURN_IF_EXCEPTION(scope, {});

    if (!existingValue.isEmpty()) {
        // If existing value is already an array, push to it
        if (existingValue.isObject() && existingValue.getObject()->inherits<JSC::JSArray>()) {
            JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(existingValue.getObject());
            array->push(global, newValue);
        } else {
            // Create new array with both values
            JSC::JSArray* array = JSC::constructEmptyArray(global, nullptr, 2);
            RETURN_IF_EXCEPTION(scope, {});
            array->putDirectIndex(global, 0, existingValue);
            RETURN_IF_EXCEPTION(scope, {});
            array->putDirectIndex(global, 1, newValue);
            RETURN_IF_EXCEPTION(scope, {});
            target->putDirectMayBeIndex(global, id, array);
        }
    } else {
        // No existing value, just put the new value directly
        target->putDirectMayBeIndex(global, id, newValue);
    }

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" void JSC__JSValue__putBunString(
    JSC::EncodedJSValue encodedTarget,
    JSC::JSGlobalObject* global,
    const BunString* key,
    JSC::EncodedJSValue encodedValue)
{
    JSC::JSObject* target = JSC::JSValue::decode(encodedTarget).getObject();
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    auto& vm = global->vm();
    Identifier id = Bun::toIdentifier(vm, *key);
    target->putDirect(vm, id, value, 0);
}

bool BunString::isEmpty() const
{
    switch (this->tag) {
    case BunStringTag::WTFStringImpl:
        return impl.wtf->isEmpty();
    case BunStringTag::EncodedSlice:
    case BunStringTag::StaticEncodedSlice:
        return impl.encoded.len == 0;
    default:
        return true;
    }
}
