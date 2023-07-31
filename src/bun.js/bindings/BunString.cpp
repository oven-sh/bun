#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "helpers.h"
#include "simdutf.h"
#include "wtf/text/ExternalStringImpl.h"
#include "GCDefferalContext.h"
#include <JavaScriptCore/JSONObject.h>
#include <wtf/text/AtomString.h>

using namespace JSC;

extern "C" bool Bun__WTFStringImpl__hasPrefix(const WTF::StringImpl* impl, const char* bytes, size_t length)
{
    return impl->startsWith(bytes, length);
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

extern "C" BunString BunString__createAtom(const char* bytes, size_t length)
{
    if (simdutf::validate_ascii(bytes, length)) {
        auto atom = makeAtomString(String(StringImpl::createWithoutCopying(bytes, length)));
        atom.impl()->ref();
        return { BunStringTag::WTFStringImpl, { .wtf = atom.impl() } };
    }

    return { BunStringTag::Dead, {} };
}

namespace Bun {
JSC::JSValue toJS(JSC::JSGlobalObject* globalObject, BunString bunString)
{
    if (bunString.tag == BunStringTag::Empty || bunString.tag == BunStringTag::Dead) {
        return JSValue(JSC::jsEmptyString(globalObject->vm()));
    }
    if (bunString.tag == BunStringTag::WTFStringImpl) {
        return JSValue(jsString(globalObject->vm(), String(bunString.impl.wtf)));
    }

    if (bunString.tag == BunStringTag::StaticZigString) {
        return JSValue(jsString(globalObject->vm(), Zig::toStringStatic(bunString.impl.zig)));
    }

    return JSValue(Zig::toJSStringGC(bunString.impl.zig, globalObject));
}

WTF::String toWTFString(const BunString& bunString)
{
    if (bunString.tag == BunStringTag::ZigString) {
        if (Zig::isTaggedUTF8Ptr(bunString.impl.zig.ptr)) {
            return Zig::toStringCopy(bunString.impl.zig);
        } else {
            return Zig::toString(bunString.impl.zig);
        }

    } else if (bunString.tag == BunStringTag::StaticZigString) {
        return Zig::toStringStatic(bunString.impl.zig);
    }

    if (bunString.tag == BunStringTag::WTFStringImpl) {
        return WTF::String(bunString.impl.wtf);
    }

    return WTF::String();
}

BunString fromJS(JSC::JSGlobalObject* globalObject, JSValue value)
{
    JSC::JSString* str = value.toStringOrNull(globalObject);
    if (UNLIKELY(!str)) {
        return { BunStringTag::Dead };
    }

    if (str->length() == 0) {
        return { BunStringTag::Empty };
    }

    auto wtfString = str->value(globalObject);

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}

BunString toString(JSC::JSGlobalObject* globalObject, JSValue value)
{
    return fromJS(globalObject, value);
}

BunString toStringRef(JSC::JSGlobalObject* globalObject, JSValue value)
{
    auto str = value.toWTFString(globalObject);
    if (str.isEmpty()) {
        return { BunStringTag::Empty };
    }

    str.impl()->ref();

    return { BunStringTag::WTFStringImpl, { .wtf = str.impl() } };
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

BunString fromString(WTF::String& wtfString)
{
    if (wtfString.isEmpty())
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}

BunString fromString(WTF::StringImpl* wtfString)
{
    if (wtfString->isEmpty())
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString } };
}

}

extern "C" JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject* globalObject, BunString* bunString)
{
    return JSValue::encode(Bun::toJS(globalObject, *bunString));
}

extern "C" BunString BunString__fromUTF16Unitialized(size_t length)
{
    unsigned utf16Length = length;
    UChar* ptr;
    auto impl = WTF::StringImpl::createUninitialized(utf16Length, ptr);
    if (UNLIKELY(!ptr))
        return { BunStringTag::Dead };

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__fromLatin1Unitialized(size_t length)
{
    unsigned latin1Length = length;
    LChar* ptr;
    auto impl = WTF::StringImpl::createUninitialized(latin1Length, ptr);
    if (UNLIKELY(!ptr))
        return { BunStringTag::Dead };
    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" BunString BunString__fromUTF8(const char* bytes, size_t length)
{
    if (simdutf::validate_utf8(bytes, length)) {
        size_t u16Length = simdutf::utf16_length_from_utf8(bytes, length);
        UChar* ptr;
        auto impl = WTF::StringImpl::createUninitialized(static_cast<unsigned int>(u16Length), ptr);
        RELEASE_ASSERT(simdutf::convert_utf8_to_utf16(bytes, length, ptr) == u16Length);
        impl->ref();
        return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
    }

    auto str = WTF::String::fromUTF8ReplacingInvalidSequences(reinterpret_cast<const LChar*>(bytes), length);
    str.impl()->ref();
    return Bun::fromString(str);
}

extern "C" BunString BunString__fromLatin1(const char* bytes, size_t length)
{
    return { BunStringTag::WTFStringImpl, { .wtf = &WTF::StringImpl::create(bytes, length).leakRef() } };
}

extern "C" BunString BunString__fromBytes(const char* bytes, size_t length)
{
    if (simdutf::validate_ascii(bytes, length)) {
        return BunString__fromLatin1(bytes, length);
    }

    return BunString__fromUTF8(bytes, length);
}

extern "C" BunString BunString__createExternal(const char* bytes, size_t length, bool isLatin1, void* ctx, void (*callback)(void* arg0, void* arg1, size_t arg2))
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::create(reinterpret_cast<const LChar*>(bytes), length, ctx, callback) :

                                                 WTF::ExternalStringImpl::create(reinterpret_cast<const UChar*>(bytes), length, ctx, callback);

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" EncodedJSValue BunString__toJSON(
    JSC::JSGlobalObject* globalObject,
    BunString* bunString)
{
    JSC::JSValue result = JSC::JSONParse(globalObject, Bun::toWTFString(*bunString));

    if (!result) {
        result = JSC::JSValue(JSC::createSyntaxError(globalObject, "Failed to parse JSON"_s));
    }

    return JSC::JSValue::encode(result);
}

extern "C" EncodedJSValue BunString__createArray(
    JSC::JSGlobalObject* globalObject,
    const BunString* ptr, size_t length)
{
    if (length == 0)
        return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));

    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (length < 64) {
        // We must do this or Bun.gc(true) in a loop creating large arrays of strings will crash due to GC'ing.
        MarkedArgumentBuffer arguments;

        arguments.fill(length, [&](JSC::JSValue* value) {
            const BunString* end = ptr + length;
            while (ptr != end) {
                *value++ = Bun::toJS(globalObject, *ptr++);
            }
        });

        JSC::ObjectInitializationScope scope(vm);
        GCDeferralContext context(vm);

        JSC::JSArray* array = JSC::JSArray::tryCreateUninitializedRestricted(
            scope,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            length);

        if (array) {
            for (size_t i = 0; i < length; ++i) {
                array->initializeIndex(scope, i, arguments.at(i));
            }
            return JSValue::encode(array);
        }

        JSC::throwOutOfMemoryError(globalObject, throwScope);
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSValue()));
    } else {
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
    return Bun::toStringRef(WTF::URL::fileURLWithFileSystemPath(Bun::toWTFString(*filePath)).stringWithoutFragmentIdentifier());
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
    auto&& str = Bun::toWTFString(*input);
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" WTF::URL* URL__fromString(BunString* input)
{
    auto&& str = Bun::toWTFString(*input);
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