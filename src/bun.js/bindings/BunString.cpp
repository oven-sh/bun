

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
#include "mimalloc.h"

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

extern "C" [[ZIG_EXPORT(nothrow)]] bool Bun__WTFStringImpl__hasPrefix(const WTF::StringImpl* impl, const char* bytes, size_t length)
{
    return impl->startsWith({ bytes, length });
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__WTFStringImpl__deref(WTF::StringImpl* impl)
{
    impl->deref();
}
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__WTFStringImpl__ref(WTF::StringImpl* impl)
{
    impl->ref();
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool BunString__fromJS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* bunString)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    *bunString = Bun::toString(globalObject, value);
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
        return JSValue::encode(jsString(vm, WTF::String(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(ptr), length))));
    }

    auto str = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(ptr), length });
    EXCEPTION_ASSERT(str.isNull() == !!scope.exception());
    if (str.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    scope.assertNoException();
    return JSValue::encode(jsString(vm, WTF::move(str)));
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__transferToJS(BunString* bunString, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    if (bunString->tag == BunStringTag::Empty) [[unlikely]] {
        return JSValue::encode(JSC::jsEmptyString(vm));
    }

    if (bunString->tag == BunStringTag::Dead) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return Bun::ERR::STRING_TOO_LONG(scope, globalObject);
    }

    if (bunString->tag == BunStringTag::WTFStringImpl) [[likely]] {
#if ASSERT_ENABLED
        unsigned refCount = bunString->impl.wtf->refCount();
        ASSERT(refCount > 0 && !bunString->impl.wtf->isEmpty());
#endif
        auto str = bunString->toWTFString();
#if ASSERT_ENABLED
        unsigned newRefCount = bunString->impl.wtf->refCount();
        ASSERT(newRefCount == refCount + 1);
#endif
        bunString->impl.wtf->deref();
        *bunString = { .tag = BunStringTag::Dead };
        return JSValue::encode(jsString(vm, WTF::move(str)));
    }

    WTF::String str = bunString->toWTFString();
    *bunString = { .tag = BunStringTag::Dead };
    return JSValue::encode(jsString(vm, WTF::move(str)));
}

// int64_t max to say "not a number"
extern "C" [[ZIG_EXPORT(nothrow)]] int64_t BunString__toInt32(const BunString* bunString)
{
    if (bunString->tag == BunStringTag::Empty || bunString->tag == BunStringTag::Dead) {
        return std::numeric_limits<int64_t>::max();
    }

    String str = bunString->toWTFString();
    auto val = WTF::parseIntegerAllowingTrailingJunk<int32_t>(str);
    if (val) {
        return val.value();
    }

    return std::numeric_limits<int64_t>::max();
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

    if (bunString.tag == BunStringTag::WTFStringImpl) {
#if ASSERT_ENABLED
        ASSERT(bunString.impl.wtf->hasAtLeastOneRef() && !bunString.impl.wtf->isEmpty());
#endif

        return JSC::jsString(globalObject->vm(), String(bunString.impl.wtf));
    }

    if (bunString.tag == BunStringTag::StaticZigString) {
        return JSC::jsString(globalObject->vm(), Zig::toStringStatic(bunString.impl.zig));
    }

    if (bunString.tag == BunStringTag::ZigString) {
        return Zig::toJSStringGC(bunString.impl.zig, globalObject);
    }

    UNREACHABLE();
}

BunString toString(const char* bytes, size_t length)
{
    return BunString__fromBytes(bytes, length);
}

BunString fromJS(JSC::JSGlobalObject* globalObject, JSValue value)
{
    WTF::String str = value.toWTFString(globalObject);
    if (str.isNull()) [[unlikely]] {
        return { BunStringTag::Dead };
    }
    if (str.length() == 0) [[unlikely]] {
        return { BunStringTag::Empty };
    }

    auto impl = str.releaseImpl();

    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] void BunString__toThreadSafe(BunString* str)
{
    if (str->tag == BunStringTag::WTFStringImpl) {
        auto impl = str->impl.wtf->isolatedCopy();
        if (impl.ptr() != str->impl.wtf) {
            str->impl.wtf = &impl.leakRef();
        }
    }
}

BunString toString(JSC::JSGlobalObject* globalObject, JSValue value)
{
    return fromJS(globalObject, value);
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

    StringImpl* impl = str.impl();

    impl->ref();

    return { BunStringTag::WTFStringImpl, { .wtf = impl } };
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
        BunStringTag::ZigString,
        { .zig = toZigString(view) }
    };
}

// We don't want to ban atomiziation for tiny strings that are potentially going
// to appear as properties/identifiers in JS. So we should only do this for long
// strings that are unlikely to ever be atomized.
static constexpr unsigned int kMinCrossThreadShareableLength = 256;

bool isCrossThreadShareable(const WTF::String& string)
{
    if (string.length() < kMinCrossThreadShareableLength)
        return false;

    const auto* impl = string.impl();

    // 1) Never share AtomStringImpl/symbols - they have special thread-unsafe behavior
    if (impl->isAtom() || impl->isSymbol())
        return false;

    // 2) Don't share slices
    if (impl->bufferOwnership() == StringImpl::BufferSubstring)
        return false;

    return true;
}

Ref<WTF::StringImpl> toCrossThreadShareable(Ref<WTF::StringImpl> impl)
{
    if (impl->isAtom() || impl->isSymbol())
        return impl->isolatedCopy();

    if (impl->bufferOwnership() == StringImpl::BufferSubstring)
        return impl->isolatedCopy();

    if (impl->length() < kMinCrossThreadShareableLength)
        return impl->isolatedCopy();

    // 3) Ensure we won't lazily touch hash/flags on the consumer thread
    // Force hash computation on this thread before sharing
    impl->hash();
    impl->setNeverAtomize();

    return impl;
}

WTF::String toCrossThreadShareable(const WTF::String& string)
{
    if (string.length() < kMinCrossThreadShareableLength)
        return string.isolatedCopy();

    auto* impl = string.impl();

    // 1) Never share AtomStringImpl/symbols - they have special thread-unsafe behavior
    if (impl->isAtom() || impl->isSymbol())
        return string.isolatedCopy();

    // 2) Don't share slices
    if (impl->bufferOwnership() == StringImpl::BufferSubstring)
        return string.isolatedCopy();

    // 3) Ensure we won't lazily touch hash/flags on the consumer thread
    // Force hash computation on this thread before sharing
    const_cast<StringImpl*>(impl)->hash();
    const_cast<StringImpl*>(impl)->setNeverAtomize();

    return string;
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

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromUTF16Unitialized(size_t length)
{
    ASSERT(length > 0);
    std::span<char16_t> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (!impl) [[unlikely]] {
        return { .tag = BunStringTag::Dead };
    }
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] BunString BunString__fromLatin1Unitialized(size_t length)
{
    ASSERT(length > 0);
    std::span<Latin1Character> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (!impl) [[unlikely]] {
        return { .tag = BunStringTag::Dead };
    }
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromUTF8(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    if (simdutf::validate_utf8(bytes, length)) {
        size_t u16Length = simdutf::utf16_length_from_utf8(bytes, length);
        std::span<char16_t> ptr;
        auto impl = WTF::StringImpl::tryCreateUninitialized(static_cast<unsigned int>(u16Length), ptr);
        if (!impl) [[unlikely]] {
            return { .tag = BunStringTag::Dead };
        }
        RELEASE_ASSERT(simdutf::convert_utf8_to_utf16(bytes, length, ptr.data()) == u16Length);
        return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
    }

    auto str = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(bytes), length });
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
        return { .tag = BunStringTag::Dead };
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
        return { BunStringTag::Dead };
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
        return { .tag = BunStringTag::Dead };
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

extern "C" BunString BunString__createExternal(const char* bytes, size_t length, bool isLatin1, void* ctx, void (*callback)(void* arg0, void* arg1, size_t arg2))
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(bytes), length }, ctx, callback) :

                                                 WTF::ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(bytes), length }, ctx, callback);

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__toJSON(
    JSC::JSGlobalObject* globalObject,
    BunString* bunString)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSValue result = JSC::JSONParse(globalObject, bunString->toWTFString());

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

extern "C" [[ZIG_EXPORT(nothrow)]] void BunString__toWTFString(BunString* bunString)
{
    WTF::String str;
    if (bunString->tag == BunStringTag::ZigString) {
        if (Zig::isTaggedExternalPtr(bunString->impl.zig.ptr)) {
            str = Zig::toString(bunString->impl.zig);
        } else {
            str = Zig::toStringCopy(bunString->impl.zig);
        }

    } else if (bunString->tag == BunStringTag::StaticZigString) {
        str = Zig::toStringStatic(bunString->impl.zig);
    } else {
        return;
    }

    auto impl = str.releaseImpl();
    bunString->impl.wtf = impl.leakRef();
    bunString->tag = BunStringTag::WTFStringImpl;
}

extern "C" BunString URL__getFileURLString(BunString* filePath)
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

extern "C" JSC::EncodedJSValue BunString__toJSDOMURL(JSC::JSGlobalObject* lexicalGlobalObject, BunString* bunString)
{
    auto& globalObject = *jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto str = bunString->toWTFString(BunString::ZeroCopy);

    auto object = WebCore::DOMURL::create(str, String());
    auto jsValue = WebCore::toJSNewlyCreated<WebCore::IDLInterface<WebCore::DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTF::move(object));
    auto* jsDOMURL = jsCast<WebCore::JSDOMURL*>(jsValue.asCell());
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

extern "C" BunString URL__getHref(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__pathFromFileURL(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.fileSystemPath());
}

extern "C" BunString URL__getHrefJoin(BunString* baseStr, BunString* relativeStr)
{
    auto base = baseStr->toWTFString();
    auto relative = relativeStr->toWTFString();
    auto url = WTF::URL(WTF::URL(base), relative);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__hash(WTF::URL* url)
{
    const auto& fragment = url->fragmentIdentifier().isEmpty()
        ? emptyString()
        : url->fragmentIdentifierWithLeadingNumberSign().toStringWithoutCopying();
    return Bun::toStringRef(fragment);
}

extern "C" BunString URL__fragmentIdentifier(WTF::URL* url)
{
    const auto& fragment = url->fragmentIdentifier().isEmpty()
        ? emptyString()
        : url->fragmentIdentifier().toStringWithoutCopying();
    return Bun::toStringRef(fragment);
}

extern "C" WTF::URL* URL__fromString(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid())
        return nullptr;

    return new WTF::URL(WTF::move(url));
}

extern "C" BunString URL__protocol(WTF::URL* url)
{
    return Bun::toStringRef(url->protocol().toStringWithoutCopying());
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

extern "C" BunString URL__search(WTF::URL* url)
{
    return Bun::toStringRef(url->query().toStringWithoutCopying());
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
    return Bun::toStringRef(url->host().toStringWithoutCopying());
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
    return Bun::toStringRef(url->path().toStringWithoutCopying());
}

size_t BunString::utf8ByteLength(const WTF::String& str)
{
    if (str.isEmpty())
        return 0;

    if (str.is8Bit()) {
        const auto s = str.span8();
        return simdutf::utf8_length_from_latin1(reinterpret_cast<const char*>(s.data()), static_cast<size_t>(s.size()));
    } else {
        const auto s = str.span16();
        return simdutf::utf8_length_from_utf16(reinterpret_cast<const char16_t*>(s.data()), static_cast<size_t>(s.size()));
    }
}

WTF::String BunString::toWTFString() const
{
    if (this->tag == BunStringTag::ZigString) {
        if (Zig::isTaggedExternalPtr(this->impl.zig.ptr)) {
            return Zig::toString(this->impl.zig);
        } else {
            return Zig::toStringCopy(this->impl.zig);
        }
    } else if (this->tag == BunStringTag::StaticZigString) {
        return Zig::toStringCopy(this->impl.zig);
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

    if (this->tag == BunStringTag::ZigString || this->tag == BunStringTag::StaticZigString) {
        Zig::appendToBuilder(this->impl.zig, builder);
        return;
    }

    // append nothing for BunStringTag::Dead and BunStringTag::Empty
}

WTF::String BunString::toWTFString(ZeroCopyTag) const
{
    if (this->tag == BunStringTag::ZigString) {
        if (Zig::isTaggedUTF8Ptr(this->impl.zig.ptr)) {
            return Zig::toStringCopy(this->impl.zig);
        } else {
            return Zig::toString(this->impl.zig);
        }
    } else if (this->tag == BunStringTag::StaticZigString) {
        return Zig::toStringStatic(this->impl.zig);
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
    if (this->tag == BunStringTag::ZigString) {
        if (Zig::isTaggedUTF8Ptr(this->impl.zig.ptr)) {
            auto str = Zig::toStringCopy(this->impl.zig);
            *this = Zig::BunStringEmpty;
            return str;
        } else {
            auto str = Zig::toString(this->impl.zig);
            *this = Zig::BunStringEmpty;
            return str;
        }
    } else if (this->tag == BunStringTag::StaticZigString) {
        auto str = Zig::toStringStatic(this->impl.zig);
        *this = Zig::BunStringEmpty;
        return str;
    } else if (this->tag == BunStringTag::WTFStringImpl) {
        ASSERT(this->impl.wtf->refCount() > 0 && !this->impl.wtf->isEmpty());

        auto str = WTF::String(this->impl.wtf);
        this->impl.wtf->deref();
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
        mi_free(ptr);
    });
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createExternalGloballyAllocatedUTF16(
    const char16_t* bytes,
    size_t length)
{
    ASSERT(length > 0);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ bytes, length }, nullptr, [](void*, void* ptr, size_t) {
        mi_free(ptr);
    });
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool WTFStringImpl__isThreadSafe(
    const WTF::StringImpl* wtf)
{
    if (wtf->isSymbol())
        return false;

    if (wtf->isAtom()) {
        // AtomString destructor would destruct on the wrong string table.
        return false;
    }

    return true;
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
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue newValue = JSC::JSValue::decode(encodedValue);
    auto& vm = global->vm();
    WTF::String str = key->tag == BunStringTag::Empty ? WTF::emptyString() : key->toWTFString();
    Identifier id = Identifier::fromString(vm, str);
    auto existingValue = target->getIfPropertyExists(global, id);
    RETURN_IF_EXCEPTION(scope, {});

    if (!existingValue.isEmpty()) {
        // If existing value is already an array, push to it
        if (existingValue.isObject() && existingValue.getObject()->inherits<JSC::JSArray>()) {
            JSC::JSArray* array = jsCast<JSC::JSArray*>(existingValue.getObject());
            array->push(global, newValue);
        } else {
            // Create new array with both values
            JSC::JSArray* array = JSC::constructEmptyArray(global, nullptr, 2);
            array->putDirectIndex(global, 0, existingValue);
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
    case BunStringTag::ZigString:
    case BunStringTag::StaticZigString:
        return impl.zig.len == 0;
    default:
        return true;
    }
}
