#include "root.h"
#include "BunString.h"
#include "headers-handwritten.h"

static_assert(sizeof(WTF::StringBuilder) == 24, "src/jsc/StringBuilder.rs assumes WTF::StringBuilder is 24 bytes");
static_assert(alignof(WTF::StringBuilder) == 8, "src/jsc/StringBuilder.rs assumes WTF::StringBuilder is 8-byte aligned");

// RecordOverflow: an append past String::MaxLength, or a failed allocation, marks the builder
// instead of crashing, and StringBuilder__toString throws for it. length() and capacity()
// release-assert !hasOverflowed(), so a function below that can reach them checks it first.
extern "C" void StringBuilder__init(WTF::StringBuilder* ptr)
{
    new (ptr) WTF::StringBuilder(OverflowPolicy::RecordOverflow);
}

extern "C" void StringBuilder__deinit(WTF::StringBuilder* builder)
{
    builder->~StringBuilder();
}

extern "C" void StringBuilder__appendLatin1(WTF::StringBuilder* builder, Latin1Character const* ptr, size_t len)
{
    builder->append({ ptr, len });
}

extern "C" void StringBuilder__appendUtf16(WTF::StringBuilder* builder, UChar const* ptr, size_t len)
{
    builder->append({ ptr, len });
}

extern "C" void StringBuilder__appendDouble(WTF::StringBuilder* builder, double num)
{
    builder->append(num);
}

extern "C" void StringBuilder__appendInt(WTF::StringBuilder* builder, int32_t num)
{
    builder->append(num);
}

extern "C" void StringBuilder__appendUsize(WTF::StringBuilder* builder, size_t num)
{
    builder->append(num);
}

extern "C" void StringBuilder__appendString(WTF::StringBuilder* builder, const BunString* str)
{
    // A 16-bit string makes an 8-bit builder upconvert, and that reads capacity().
    if (builder->hasOverflowed()) [[unlikely]]
        return;
    str->appendToBuilder(*builder);
}

extern "C" void StringBuilder__appendLChar(WTF::StringBuilder* builder, Latin1Character c)
{
    builder->append(c);
}

extern "C" void StringBuilder__appendUChar(WTF::StringBuilder* builder, UChar c)
{
    builder->append(c);
}

extern "C" void StringBuilder__appendQuotedJsonString(WTF::StringBuilder* builder, const BunString* str)
{
    auto string = str->toWTFString(BunString::ZeroCopy);
    builder->appendQuotedJSONString(string);
}

extern "C" JSC::EncodedJSValue StringBuilder__toString(WTF::StringBuilder* builder, JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (builder->hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode({});
    }

    auto str = builder->toString();
    return JSC::JSValue::encode(JSC::jsString(vm, str));
}

extern "C" void StringBuilder__ensureUnusedCapacity(WTF::StringBuilder* builder, size_t additional)
{
    if (builder->hasOverflowed()) [[unlikely]]
        return;
    builder->reserveCapacity(builder->length() + additional);
}
