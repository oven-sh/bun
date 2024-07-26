#include "v8/String.h"

using JSC::JSString;
using JSC::JSValue;

namespace v8 {

MaybeLocal<String> String::NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int signed_length)
{
    // TODO(@190n) maybe use JSC::AtomString instead of ignoring type
    (void)type;
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
    assert(!string.isNull());
    auto jsString = JSC::jsString(isolate->vm(), string);
    JSValue jsValue(jsString);
    Local<String> local(jsValue);
    return MaybeLocal<String>(local);
}

int String::WriteUtf8(Isolate* isolate, char* buffer, int length, int* nchars_ref, int options) const
{
    assert(options == 0);
    auto jsValue = toJSValue();
    WTF::String string = jsValue.getString(isolate->globalObject());

    // TODO(@190n) handle 16 bit strings
    assert(string.is8Bit());
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
    auto jsValue = toJSValue();
    assert(jsValue.isString());
    WTF::String s;
    jsValue.getString(Isolate::GetCurrent()->globalObject(), s);
    return s.length();
}

}
