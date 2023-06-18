#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "helpers.h"
#include "simdutf.h"
#include "wtf/text/ExternalStringImpl.h"
using namespace JSC;

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

BunString toString(WTF::String& wtfString)
{
    if (wtfString.length() == 0)
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}
BunString toString(const WTF::String& wtfString)
{
    if (wtfString.length() == 0)
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}
BunString toString(WTF::StringImpl* wtfString)
{
    if (wtfString->length() == 0)
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString } };
}

BunString fromString(WTF::String& wtfString)
{
    if (wtfString.length() == 0)
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString.impl() } };
}

BunString fromString(WTF::StringImpl* wtfString)
{
    if (wtfString->length() == 0)
        return { BunStringTag::Empty };

    return { BunStringTag::WTFStringImpl, { .wtf = wtfString } };
}

}

extern "C" JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject* globalObject, BunString* bunString)
{
    return JSValue::encode(Bun::toJS(globalObject, *bunString));
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

    auto str = WTF::String::fromUTF8ReplacingInvalidSequences(reinterpret_cast<const LChar*>(bytes), length);
    return Bun::fromString(str);
}

extern "C" BunString BunString__createExternal(const char* bytes, size_t length, bool isLatin1, void* ctx, void (*callback)(void* arg0, void* arg1, size_t arg2))
{
    Ref<WTF::ExternalStringImpl> impl = isLatin1 ? WTF::ExternalStringImpl::create(reinterpret_cast<const LChar*>(bytes), length, ctx, callback) :

                                                 WTF::ExternalStringImpl::create(reinterpret_cast<const UChar*>(bytes), length, ctx, callback);

    return { BunStringTag::WTFStringImpl, { .wtf = &impl.leakRef() } };
}

extern "C" EncodedJSValue BunString__createArray(
    JSC::JSGlobalObject* globalObject,
    const BunString* ptr, size_t length)
{
    if (length == 0)
        return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));

    JSC::VM& vm = globalObject->vm();

    JSC::ObjectInitializationScope scope(vm);
    const BunString* end = ptr + length;
    unsigned i = 0;

    // fast path:
    if (JSC::JSArray* array = JSC::JSArray::tryCreateUninitializedRestricted(
            scope,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            length)) {

        for (const BunString* it = ptr; it != end; ++it) {
            array->initializeIndex(scope, i++, Bun::toJS(globalObject, *it));
        }
        return JSValue::encode(array);
    }

    JSC::JSArray* array = JSC::constructEmptyArray(globalObject, nullptr);
    for (const BunString* it = ptr; it != end; ++it) {
        array->push(globalObject, Bun::toJS(globalObject, *it));
    }

    return JSValue::encode(array);
}

extern "C" void BunString__toWTFString(BunString* bunString)
{
    if (bunString->tag == BunStringTag::ZigString) {
        if (Zig::isTaggedUTF8Ptr(bunString->impl.zig.ptr)) {
            bunString->impl.wtf = Zig::toStringCopy(bunString->impl.zig).impl();
        } else {
            bunString->impl.wtf = Zig::toString(bunString->impl.zig).impl();
        }

        bunString->tag = BunStringTag::WTFStringImpl;
    } else if (bunString->tag == BunStringTag::StaticZigString) {
        bunString->impl.wtf = Zig::toStringStatic(bunString->impl.zig).impl();
        bunString->tag = BunStringTag::WTFStringImpl;
    }
}