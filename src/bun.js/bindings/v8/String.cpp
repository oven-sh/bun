#include "v8/String.h"

#include "v8/HandleScope.h"

using JSC::JSString;
using JSC::JSValue;

namespace v8 {

MaybeLocal<String> String::NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int signed_length)
{
    // TODO(@190n) maybe use JSC::AtomString instead of ignoring type
    RELEASE_ASSERT(type == NewStringType::kNormal);
    size_t length = 0;
    if (signed_length < 0) {
        length = strlen(data);
    } else {
        length = static_cast<int>(signed_length);
    }

    if (length > JSString::MaxLength) {
        // empty
        return MaybeLocal<String>();
    }

    std::span<const unsigned char> span(reinterpret_cast<const unsigned char*>(data), length);
    // ReplacingInvalidSequences matches how v8 behaves here
    auto string = WTF::String::fromUTF8ReplacingInvalidSequences(span);
    RELEASE_ASSERT(!string.isNull());
    JSString* jsString = JSC::jsString(isolate->vm(), string);
    return MaybeLocal<String>(isolate->globalInternals()->currentHandleScope()->createLocal<String>(jsString));
}

int String::WriteUtf8(Isolate* isolate, char* buffer, int length, int* nchars_ref, int options) const
{
    RELEASE_ASSERT(options == 0);
    auto jsString = toObjectPointer<const JSString>();
    WTF::String string = jsString->getString(isolate->globalObject());

    // TODO(@190n) handle 16 bit strings
    RELEASE_ASSERT(string.is8Bit());
    auto span = string.span8();

    int to_copy = length;
    bool terminate = true;
    if (to_copy < 0) {
        to_copy = span.size();
    } else if (to_copy > span.size()) {
        to_copy = span.size();
    } else if (length < span.size()) {
        to_copy = length;
        terminate = false;
    }
    // TODO(@190n) span.data() is latin1 not utf8, but this is okay as long as the only way to make
    // a v8 string is NewFromUtf8. that's because NewFromUtf8 will use either all ASCII or all UTF-16.
    memcpy(buffer, span.data(), to_copy);
    if (terminate) {
        buffer[to_copy] = 0;
    }
    if (nchars_ref) {
        *nchars_ref = to_copy;
    }
    return terminate ? to_copy + 1 : to_copy;
}

int String::Length() const
{
    auto jsString = toObjectPointer<const JSString>();
    RELEASE_ASSERT(jsString->isString());
    WTF::String s = jsString->getString(Isolate::GetCurrent()->globalObject());
    return s.length();
}

}
