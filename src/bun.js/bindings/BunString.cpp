
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
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringToIntegerConversion.h"

extern "C" void mi_free(void* ptr);

using namespace JSC;
extern "C" BunString BunString__fromBytes(const char* bytes, size_t length);

extern "C" bool Bun__WTFStringImpl__hasPrefix(const WTF::StringImpl* impl, const char* bytes, size_t length)
{
    return impl->startsWith({ bytes, length });
}

extern "C" void Bun__WTFStringImpl__deref(WTF::StringImpl* impl)
{
    impl->deref();
}
extern "C" void Bun__WTFStringImpl__ref(WTF::StringImpl* impl)
{
    impl->ref();
}

extern "C" bool BunString__fromJS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* bunString)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    *bunString = Bun::toString(globalObject, value);
    return bunString->tag != BunStringTag::Dead;
}

extern "C" bool BunString__fromJSRef(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* bunString)
{

    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    *bunString = Bun::toStringRef(globalObject, value);
    return bunString->tag != BunStringTag::Dead;
}

extern "C" BunString BunString__createAtom(const char* bytes, size_t length)
{
    ASSERT(simdutf::validate_ascii(bytes, length));
    auto atom = tryMakeAtomString(String(StringImpl::createWithoutCopying({ bytes, length })));
    atom.impl()->ref();
    return { BunStringTag::WTFStringImpl, { .wtf = atom.impl() } };
}

extern "C" BunString BunString__tryCreateAtom(const char* bytes, size_t length)
{
    if (simdutf::validate_ascii(bytes, length)) {
        auto atom = tryMakeAtomString(String(StringImpl::createWithoutCopying({ bytes, length })));
        if (atom.isNull())
            return { BunStringTag::Dead, {} };
        atom.impl()->ref();
        return { BunStringTag::WTFStringImpl, { .wtf = atom.impl() } };
    }

    return { BunStringTag::Dead, {} };
}

// int64_t max to say "not a number"
extern "C" int64_t BunString__toInt32(BunString* bunString)
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
JSC::JSValue toJS(JSC::JSGlobalObject* globalObject, BunString bunString)
{
    if (bunString.tag == BunStringTag::Empty || bunString.tag == BunStringTag::Dead) {
        return JSValue(JSC::jsEmptyString(globalObject->vm()));
    }
    if (bunString.tag == BunStringTag::WTFStringImpl) {
        ASSERT(bunString.impl.wtf->refCount() > 0 && !bunString.impl.wtf->isEmpty());
        return JSValue(jsString(globalObject->vm(), String(bunString.impl.wtf)));
    }

    if (bunString.tag == BunStringTag::StaticZigString) {
        return JSValue(jsString(globalObject->vm(), Zig::toStringStatic(bunString.impl.zig)));
    }

    return JSValue(Zig::toJSStringGC(bunString.impl.zig, globalObject));
}

BunString toString(const char* bytes, size_t length)
{
    return BunString__fromBytes(bytes, length);
}

BunString fromJS(JSC::JSGlobalObject* globalObject, JSValue value)
{
    WTF::String str = value.toWTFString(globalObject);
    if (UNLIKELY(str.isNull())) {
        return { BunStringTag::Dead };
    }
    if (UNLIKELY(str.length() == 0)) {
        return { BunStringTag::Empty };
    }

    auto impl = str.releaseImpl();

    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" void BunString__toThreadSafe(BunString* str)
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
    if (UNLIKELY(str.isNull())) {
        return { BunStringTag::Dead };
    }
    if (UNLIKELY(str.length() == 0)) {
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

}

extern "C" JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject* globalObject, const BunString* bunString)
{
    return JSValue::encode(Bun::toJS(globalObject, *bunString));
}

extern "C" BunString BunString__fromUTF16Unitialized(size_t length)
{
    ASSERT(length > 0);
    std::span<UChar> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (UNLIKELY(!impl)) {
        return { .tag = BunStringTag::Dead };
    }
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromLatin1Unitialized(size_t length)
{
    ASSERT(length > 0);
    std::span<LChar> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (UNLIKELY(!impl)) {
        return { .tag = BunStringTag::Dead };
    }
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromUTF8(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    if (simdutf::validate_utf8(bytes, length)) {
        size_t u16Length = simdutf::utf16_length_from_utf8(bytes, length);
        std::span<UChar> ptr;
        auto impl = WTF::StringImpl::tryCreateUninitialized(static_cast<unsigned int>(u16Length), ptr);
        if (UNLIKELY(!impl)) {
            return { .tag = BunStringTag::Dead };
        }
        RELEASE_ASSERT(simdutf::convert_utf8_to_utf16(bytes, length, ptr.data()) == u16Length);
        impl->ref();
        return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
    }

    auto str = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(bytes), length });
    if (UNLIKELY(str.isNull())) {
        return { .tag = BunStringTag::Dead };
    }
    str.impl()->ref();
    return Bun::toString(str);
}

extern "C" BunString BunString__fromLatin1(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    std::span<LChar> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (UNLIKELY(!impl)) {
        return { .tag = BunStringTag::Dead };
    }
    memcpy(ptr.data(), bytes, length);

    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromUTF16ToLatin1(const char16_t* bytes, size_t length)
{
    ASSERT(length > 0);
    ASSERT_WITH_MESSAGE(simdutf::validate_utf16le(bytes, length), "This function only accepts ascii UTF16 strings");
    size_t outLength = simdutf::latin1_length_from_utf16(length);
    std::span<LChar> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(outLength, ptr);
    if (UNLIKELY(!impl)) {
        return { BunStringTag::Dead };
    }

    size_t latin1_length = simdutf::convert_valid_utf16le_to_latin1(bytes, length, reinterpret_cast<char*>(ptr.data()));
    ASSERT_WITH_MESSAGE(latin1_length == outLength, "Failed to convert UTF16 to Latin1");
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromUTF16(const char16_t* bytes, size_t length)
{
    ASSERT(length > 0);
    std::span<UChar> ptr;
    auto impl = WTF::StringImpl::tryCreateUninitialized(length, ptr);
    if (UNLIKELY(!impl)) {
        return { .tag = BunStringTag::Dead };
    }
    memcpy(ptr.data(), bytes, length * sizeof(char16_t));
    return { BunStringTag::WTFStringImpl, { .wtf = impl.leakRef() } };
}

extern "C" BunString BunString__fromBytes(const char* bytes, size_t length)
{
    ASSERT(length > 0);
    if (simdutf::validate_ascii(bytes, length)) {
        return BunString__fromLatin1(bytes, length);
    }

    return BunString__fromUTF8(bytes, length);
}

extern "C" BunString BunString__createStaticExternal(const char* bytes, size_t length, bool isLatin1)
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::createStatic({ reinterpret_cast<const LChar*>(bytes), length }) :

                                                 WTF::ExternalStringImpl::createStatic({ reinterpret_cast<const UChar*>(bytes), length });

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createExternal(const char* bytes, size_t length, bool isLatin1, void* ctx, void (*callback)(void* arg0, void* arg1, size_t arg2))
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::create({ reinterpret_cast<const LChar*>(bytes), length }, ctx, callback) :

                                                 WTF::ExternalStringImpl::create({ reinterpret_cast<const UChar*>(bytes), length }, ctx, callback);

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" JSC::EncodedJSValue BunString__toJSON(
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

    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // Using tryCreateUninitialized here breaks stuff..
    // https://github.com/oven-sh/bun/issues/3931
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, length);
    if (!array) {
        JSC::throwOutOfMemoryError(globalObject, throwScope);
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSValue()));
    }

    for (size_t i = 0; i < length; ++i) {
        array->putDirectIndex(globalObject, i, Bun::toJS(globalObject, *ptr++));
    }

    return JSValue::encode(array);
}

extern "C" void BunString__toWTFString(BunString* bunString)
{
    if (bunString->tag == BunStringTag::ZigString) {
        if (Zig::isTaggedExternalPtr(bunString->impl.zig.ptr)) {
            bunString->impl.wtf = Zig::toString(bunString->impl.zig).impl();
        } else {
            bunString->impl.wtf = Zig::toStringCopy(bunString->impl.zig).impl();
        }

        bunString->tag = BunStringTag::WTFStringImpl;
    } else if (bunString->tag == BunStringTag::StaticZigString) {
        bunString->impl.wtf = Zig::toStringStatic(bunString->impl.zig).impl();
        bunString->tag = BunStringTag::WTFStringImpl;
    }
}

extern "C" BunString URL__getFileURLString(BunString* filePath)
{
    return Bun::toStringRef(WTF::URL::fileURLWithFileSystemPath(filePath->toWTFString()).stringWithoutFragmentIdentifier());
}

extern "C" JSC__JSValue BunString__toJSDOMURL(JSC::JSGlobalObject* lexicalGlobalObject, BunString* bunString)
{
    auto& globalObject = *jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto str = bunString->toWTFString(BunString::ZeroCopy);

    auto object = WebCore::DOMURL::create(str, String());
    auto jsValue = WebCore::toJSNewlyCreated<WebCore::IDLInterface<WebCore::DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTFMove(object));
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

    return new WTF::URL(WTFMove(url));
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

extern "C" WTF::URL* URL__fromString(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid())
        return nullptr;

    return new WTF::URL(WTFMove(url));
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

extern "C" BunString URL__host(WTF::URL* url)
{
    return Bun::toStringRef(url->host().toStringWithoutCopying());
}
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

extern "C" BunString BunString__createExternalGloballyAllocatedLatin1(
    const LChar* bytes,
    size_t length)
{
    ASSERT(length > 0);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ bytes, length }, nullptr, [](void*, void* ptr, size_t) {
        mi_free(ptr);
    });
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__createExternalGloballyAllocatedUTF16(
    const UChar* bytes,
    size_t length)
{
    ASSERT(length > 0);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ bytes, length }, nullptr, [](void*, void* ptr, size_t) {
        mi_free(ptr);
    });
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" bool WTFStringImpl__isThreadSafe(
    const WTF::StringImpl* wtf)
{
    if (wtf->bufferOwnership() != StringImpl::BufferOwnership::BufferInternal)
        return false;

    return !(wtf->isSymbol() || wtf->isAtom());
}

extern "C" void Bun__WTFStringImpl__ensureHash(WTF::StringImpl* str)
{
    str->hash();
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
    WTF::String str = key->tag == BunStringTag::Empty ? WTF::String(""_s) : key->toWTFString();
    Identifier id = Identifier::fromString(vm, str);
    target->putDirect(vm, id, value, 0);
}
