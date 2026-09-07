

#include "BunString.h"
#include "helpers.h"
#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

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

#include "GCDefferalContext.h"
#include "wtf/StdLibExtras.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringToIntegerConversion.h"
#include "ErrorCode.h"

using namespace JSC;
extern "C" BunString BunString__fromBytes(const char* bytes, size_t length);

// Cold path for the Rust-side inlined `deref()`: caller has already brought
// the refcount to zero via `fetch_sub`, so this is destroy-only.
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__WTFStringImpl__destroy(WTF::StringImpl* impl)
{
    WTF::StringImpl::destroy(impl);
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool BunString__fromJS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* bunString)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    *bunString = Bun::toStringRef(globalObject, value);
    return bunString->tag != BunStringTag::Dead;
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__createAtom(const char* bytes, size_t length)
{
    ASSERT(simdutf::validate_ascii(bytes, length));
    auto atom = tryMakeAtomString(String(StringImpl::createWithoutCopying({ bytes, length })));
    return { BunStringTag::WTFStringImpl, { .wtf = atom.releaseImpl().leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__tryCreateAtom(const char* bytes, size_t length)
{
    if (simdutf::validate_ascii(bytes, length)) {
        auto atom = tryMakeAtomString(String(StringImpl::createWithoutCopying({ bytes, length })));
        if (atom.isNull())
            return { BunStringTag::Dead, {} };
        return { BunStringTag::WTFStringImpl, { .wtf = atom.releaseImpl().leakRef() } };
    }

    return { BunStringTag::Dead, {} };
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
        return JSValue::encode(jsString(vm, WTF::String(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(ptr), length))));
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
    std::span<const Latin1Character> literal { Zig::untag(slice.ptr), slice.len };
    ASSERT_WITH_MESSAGE(!CommonStrings::isCommonStringLiteral(literal),
        "\"%.*s\" is in BunCommonStrings.h: use global.common_strings() instead of String::static_(..).to_js()",
        static_cast<int>(literal.size()), reinterpret_cast<const char*>(literal.data()));
}
#else
static inline void assertStaticStringIsNotCommon(EncodedSlice) {}
#endif
}

JSC::JSValue BunString::transferToJS(JSC::JSGlobalObject* globalObject)
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
        ASSERT(this->impl.wtf->refCount() > 0 && !this->impl.wtf->isEmpty());
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
    return JSValue::encode(bunString->transferToJS(globalObject));
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
    if (message.isNull() && !str->isEmpty()) [[unlikely]] {
        // Allocation failed or the message exceeds the maximum string length.
        return {};
    }
    JSC::JSObject* result = nullptr;
    switch (kind) {
    case BunErrorKind::Error:
        result = JSC::createError(globalObject, message);
        break;
    case BunErrorKind::TypeError:
        result = JSC::createTypeError(globalObject, message);
        break;
    case BunErrorKind::SyntaxError:
        result = JSC::createSyntaxError(globalObject, message);
        break;
    case BunErrorKind::RangeError:
        result = JSC::createRangeError(globalObject, message);
        break;
    }
    JSC::EnsureStillAliveScope ensureAlive(result);
    return JSValue::encode(result);
}

namespace Bun {

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
        return JSC::jsString(globalObject->vm(), Zig::toStringStatic(bunString.impl.encoded));
    }

    if (bunString.tag == BunStringTag::EncodedSlice) {
        return Zig::toJSStringGC(bunString.impl.encoded, globalObject);
    }

    UNREACHABLE();
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__threadIsolatedCopy(const BunString* str)
{
    if (str->tag == BunStringTag::WTFStringImpl)
        return { BunStringTag::WTFStringImpl, { .wtf = &str->impl.wtf->isolatedCopy().leakRef() } };
    return *str;
}

extern "C" [[ZIG_EXPORT(nothrow)]] void BunString__makeThreadShareable(BunString* str)
{
    if (str->tag != BunStringTag::WTFStringImpl)
        return;
    auto* impl = str->impl.wtf;
    Ref<WTF::StringImpl> shared = makeThreadShareable(*impl);
    if (shared.ptr() != impl) {
        str->impl.wtf = &shared.leakRef();
        impl->deref();
    }
}

BunString toStringRef(JSC::JSGlobalObject* globalObject, JSValue value)
{
    auto str = value.toWTFString(globalObject);
    if (str.isNull()) [[unlikely]] {
        return { BunStringTag::Dead };
    }
    if (str.length() == 0) [[unlikely]] {
        return { BunStringTag::Empty };
    }

    return { BunStringTag::WTFStringImpl, { .wtf = str.releaseImpl().leakRef() } };
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

BunString toStringRef(WTF::String& wtfString)
{
    if (wtfString.isEmpty())
        return { BunStringTag::Empty };

    wtfString.impl()->ref();
    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}
BunString toStringRef(const WTF::String& wtfString)
{
    if (wtfString.isEmpty())
        return { BunStringTag::Empty };

    wtfString.impl()->ref();
    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}
BunString toStringRef(WTF::StringImpl* wtfString)
{
    if (wtfString->isEmpty())
        return { BunStringTag::Empty };

    wtfString->ref();

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString } };
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

// `tryCreateUninitialized` returns null both for a length it refuses and for a
// failed allocation; the tag tells transferToJS/toJS which error to throw.
template<typename CharacterType>
static BunString uninitializedStringFailure(size_t length)
{
    if (!WTF::StringImpl::isValidLength<CharacterType>(length))
        return { .tag = BunStringTag::Dead };
    return { .tag = BunStringTag::OutOfMemory };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromUTF16Unitialized(size_t length)
{
    ASSERT(length > 0);
    std::span<char16_t> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (!impl) [[unlikely]] {
        return uninitializedStringFailure<char16_t>(length);
    }
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromLatin1Unitialized(size_t length)
{
    ASSERT(length > 0);
    std::span<Latin1Character> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (!impl) [[unlikely]] {
        return uninitializedStringFailure<Latin1Character>(length);
    }
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromUTF8(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    if (simdutf::validate_utf8(bytes, length)) {
        size_t u16Length = simdutf::utf16_length_from_utf8(bytes, length);
        std::span<char16_t> ptr;
        auto impl = WTF::StringImpl::tryCreateUninitialized(u16Length, ptr);
        if (!impl) [[unlikely]] {
            return uninitializedStringFailure<char16_t>(u16Length);
        }
        RELEASE_ASSERT(simdutf::convert_utf8_to_utf16(bytes, length, ptr.data()) == u16Length);
        return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
    }

    auto str = Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(bytes), length });
    if (str.isNull()) [[unlikely]] {
        return { .tag = BunStringTag::Dead };
    }
    auto impl = str.releaseImpl();
    return Bun::toString(impl.leakRef());
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromLatin1(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    std::span<Latin1Character> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (!impl) [[unlikely]] {
        return uninitializedStringFailure<Latin1Character>(length);
    }
    memcpy(ptr.data(), bytes, length);

    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromUTF16ToLatin1(const char16_t* bytes, size_t length)
{
    ASSERT(length > 0);
    ASSERT_WITH_MESSAGE(simdutf::validate_utf16le(bytes, length), "This function only accepts ascii UTF16 strings");
    size_t outLength = simdutf::latin1_length_from_utf16(length);
    std::span<Latin1Character> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(outLength, ptr);
    if (!impl) [[unlikely]] {
        return uninitializedStringFailure<Latin1Character>(outLength);
    }

    size_t latin1_length = simdutf::convert_valid_utf16le_to_latin1(bytes, length, reinterpret_cast<char*>(ptr.data()));
    ASSERT_WITH_MESSAGE(latin1_length == outLength, "Failed to convert UTF16 to Latin1");
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromUTF16(const char16_t* bytes, size_t length)
{
    ASSERT(length > 0);
    std::span<char16_t> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (!impl) [[unlikely]] {
        return uninitializedStringFailure<char16_t>(length);
    }
    memcpy(ptr.data(), bytes, length * sizeof(char16_t));
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromBytes(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    if (simdutf::validate_ascii(bytes, length)) {
        return BunString__fromLatin1(bytes, length);
    }

    return BunString__fromUTF8(bytes, length);
}

extern "C" BunString BunString__createStaticExternal(const char* bytes, size_t length, bool isLatin1)
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::createStatic({ reinterpret_cast<const Latin1Character*>(bytes), length }) :

                                                 WTF::ExternalStringImpl::createStatic({ reinterpret_cast<const char16_t*>(bytes), length });

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createStaticExternalLatin1WithHash(const char* bytes, size_t length, unsigned hash)
{
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::createStatic({ reinterpret_cast<const Latin1Character*>(bytes), length }, hash);
    impl->setNeverAtomize();
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createStaticExternalUTF16WithHash(const char16_t* units, size_t length, unsigned hash)
{
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::createStatic({ units, length }, hash);
    impl->setNeverAtomize();
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createExternal(const char* bytes, size_t length, bool isLatin1, void* ctx, void (*callback)(void* arg0, void* arg1, size_t arg2))
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(bytes), length }, ctx, callback) :

                                                 WTF::ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(bytes), length }, ctx, callback);

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
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

extern "C" BunString URL__getFileURLString(const BunString* filePath)
{
    return Bun::toStringRef(WTF::URL::fileURLWithFileSystemPath(filePath->toWTFString()).stringWithoutFragmentIdentifier());
}

extern "C" size_t URL__originLength(const char* latin1_slice, size_t len)
{
    WTF::String string = WTF::StringView(latin1_slice, len, true).toString();
    if (!string)
        return 0;
    WTF::URL url(string);
    if (!url.isValid())
        return 0;
    return url.pathStart();
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

extern "C" WTF::URL* URL__fromJS(EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    auto str = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    if (str.isEmpty()) {
        return nullptr;
    }

    auto url = WTF::URL(str);
    if (!url.isValid() || url.isNull())
        return nullptr;

    return new WTF::URL(WTF::move(url));
}

extern "C" BunString URL__getHrefFromJS(EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    auto str = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, { BunStringTag::Dead });
    if (str.isEmpty()) {
        return { BunStringTag::Dead };
    }

    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__getHref(const BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__pathFromFileURL(const BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.fileSystemPath());
}

extern "C" BunString URL__getHrefJoin(const BunString* baseStr, const BunString* relativeStr)
{
    auto base = baseStr->toWTFString();
    auto relative = relativeStr->toWTFString();
    auto url = WTF::URL(WTF::URL(base), relative);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__fragmentIdentifier(WTF::URL* url)
{
    const auto& fragment = url->fragmentIdentifier().isEmpty()
        ? emptyString()
        : url->fragmentIdentifier().toString();
    return Bun::toStringRef(fragment);
}

extern "C" WTF::URL* URL__fromString(const BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid())
        return nullptr;

    return new WTF::URL(WTF::move(url));
}

extern "C" BunString URL__protocol(WTF::URL* url)
{
    return Bun::toStringRef(url->protocol().toString());
}

extern "C" void URL__deinit(WTF::URL* url)
{
    delete url;
}

extern "C" BunString URL__href(WTF::URL* url)
{
    return Bun::toStringRef(url->string());
}

extern "C" BunString URL__username(WTF::URL* url)
{
    return Bun::toStringRef(url->user());
}

extern "C" BunString URL__password(WTF::URL* url)
{
    return Bun::toStringRef(url->password());
}

/// Returns the host WITHOUT the port.
///
/// Note that this does NOT match JS behavior, which returns the host with the port.
///
/// ```
/// URL("http://example.com:8080").host() => "example.com"
/// ```
extern "C" BunString URL__host(WTF::URL* url)
{
    return Bun::toStringRef(url->host().toString());
}

/// Returns the host WITH the port.
///
/// Note that this does NOT match JS behavior which returns the host without the port.
///
/// ```
/// URL("http://example.com:8080").hostname() => "example.com:8080"
/// ```
extern "C" BunString URL__hostname(WTF::URL* url)
{
    return Bun::toStringRef(url->hostAndPort());
}

extern "C" uint32_t URL__port(WTF::URL* url)
{
    auto port = url->port();

    if (port.has_value()) {
        return port.value();
    }

    return std::numeric_limits<uint32_t>::max();
}

extern "C" BunString URL__pathname(WTF::URL* url)
{
    return Bun::toStringRef(url->path().toString());
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

void BunString::appendToBuilder(WTF::StringBuilder& builder) const
{
    if (this->tag == BunStringTag::WTFStringImpl) {
        builder.append(this->impl.wtf);
        return;
    }

    if (this->tag == BunStringTag::EncodedSlice || this->tag == BunStringTag::StaticEncodedSlice) {
        Zig::appendToBuilder(this->impl.encoded, builder);
        return;
    }

    // append nothing for BunStringTag::Dead, OutOfMemory and Empty
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
        ASSERT(this->impl.wtf->refCount() > 0 && !this->impl.wtf->isEmpty());
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

WTF::String BunString::transferToWTFString()
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
        ASSERT(this->impl.wtf->refCount() > 0 && !this->impl.wtf->isEmpty());

        auto str = WTF::String(adoptRef(*this->impl.wtf));
        *this = Zig::BunStringEmpty;
        return str;
    }

    return WTF::String();
}

extern "C" BunString BunString__createExternalGloballyAllocatedLatin1(
    const Latin1Character* bytes,
    size_t length)
{
    ASSERT(length > 0);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ bytes, length }, nullptr, [](void*, void* ptr, size_t) {
        // `bytes` came from a Rust `Vec` (the global allocator); free with
        // `defaultAllocatorFree` so it agrees with the `#[global_allocator]`.
        Bun::defaultAllocatorFree(ptr);
    });
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createExternalGloballyAllocatedUTF16(
    const char16_t* bytes,
    size_t length)
{
    ASSERT(length > 0);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ bytes, length }, nullptr, [](void*, void* ptr, size_t) {
        // `bytes` came from a Rust `Vec` (the global allocator); free with
        // `defaultAllocatorFree` so it agrees with the `#[global_allocator]`.
        Bun::defaultAllocatorFree(ptr);
    });
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

// What isolatedCopy() yields: no atom-table membership and no base impl.
extern "C" [[ZIG_EXPORT(nothrow)]] bool WTFStringImpl__isThreadIsolated(
    const WTF::StringImpl* wtf)
{
    return !wtf->isAtom() && !wtf->isSymbol() && !wtf->isSubString();
}

// What BunString__makeThreadShareable yields: isolated, and no holder can
// mutate it (hash already computed, never atomized in place).
extern "C" [[ZIG_EXPORT(nothrow)]] bool WTFStringImpl__isThreadShareable(
    const WTF::StringImpl* wtf)
{
    return WTFStringImpl__isThreadIsolated(wtf) && (wtf->isStatic() || (wtf->hasHash() && !wtf->canBecomeAtom()));
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__WTFStringImpl__ensureHash(WTF::StringImpl* str)
{
    str->hash();
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
    WTF::String str = key->tag == BunStringTag::Empty ? WTF::emptyString() : key->toWTFString();
    Identifier id = Identifier::fromString(vm, str);
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
            target->putDirect(vm, id, array, 0);
        }
    } else {
        // No existing value, just put the new value directly
        target->putDirect(vm, id, newValue, 0);
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
    WTF::String str = key->tag == BunStringTag::Empty ? WTF::emptyString() : key->toWTFString();
    Identifier id = Identifier::fromString(vm, str);
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
