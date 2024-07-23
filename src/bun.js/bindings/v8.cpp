// This file implements the v8 and node C++ APIs
//
// If you have issues linking this file, you probably have to update
// the code in `napi.zig` at `const V8API`
#include "headers.h"
#include "root.h"
#include "ZigGlobalObject.h"
#include "napi_external.h"

#if defined(WIN32) || defined(_WIN32)
#define BUN_EXPORT __declspec(dllexport)
#else
#define BUN_EXPORT JS_EXPORT
#endif

extern "C" Zig::GlobalObject* Bun__getDefaultGlobal();

namespace v8 {

using Context = JSC::JSGlobalObject;

class Isolate;

namespace api_internal {
BUN_EXPORT void ToLocalEmpty()
{
    // TODO(@190n) proper error handling
    assert("ToLocalEmpty" && 0);
}
}

template<class T>
class Local final {
public:
    Local()
        : ptr(nullptr)
    {
    }

    Local(T* ptr_)
        : ptr(ptr_)
    {
    }

    Local(JSC::JSValue jsv)
        : ptr(reinterpret_cast<T*>(JSC::JSValue::encode(jsv)))
    {
    }

    bool IsEmpty() const { return ptr == nullptr; }

    T* operator*() const { return ptr; }

private:
    T* ptr;
};

template<class T>
class MaybeLocal {
public:
    MaybeLocal()
        : local_({}) {};

    template<class S> MaybeLocal(Local<S> that)
        : local_(that)
    {
    }

    bool IsEmpty() const { return local_.IsEmpty(); }

private:
    Local<T> local_;
};

class Value {
protected:
    JSC::JSValue toJSValue() const
    {
        return JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(this));
    }
};

class Primitive : public Value {
};

class Number : public Primitive {
public:
    BUN_EXPORT static Local<Number> New(Isolate* isolate, double value);

    BUN_EXPORT double Value() const;
};

Local<Number> Number::New(Isolate* isolate, double value)
{
    return JSC::jsDoubleNumber(value);
}

double Number::Value() const
{
    return toJSValue().asNumber();
}

enum class NewStringType {
    kNormal,
    kInternalized,
};

class String : Primitive {
public:
    enum WriteOptions {
        NO_OPTIONS = 0,
        HINT_MANY_WRITES_EXPECTED = 1,
        NO_NULL_TERMINATION = 2,
        PRESERVE_ONE_BYTE_NULL = 4,
        REPLACE_INVALID_UTF8 = 8,
    };

    BUN_EXPORT static MaybeLocal<String> NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int length = -1);
    BUN_EXPORT int WriteUtf8(Isolate* isolate, char* buffer, int length = -1, int* nchars_ref = nullptr, int options = NO_OPTIONS) const;
    BUN_EXPORT int Length() const;
};

class External : public Value {
public:
    BUN_EXPORT static MaybeLocal<External> New(Isolate* isolate, void* value);
    BUN_EXPORT void* Value() const;
};

// This currently is just a pointer to a Zig::GlobalObject*
// We do that so that we can recover the context and the VM from the "Isolate"
class Isolate final {
public:
    Isolate() = default;

    // Returns the isolate inside which the current thread is running or nullptr.
    BUN_EXPORT static Isolate* TryGetCurrent();

    // Returns the isolate inside which the current thread is running.
    BUN_EXPORT static Isolate* GetCurrent();

    BUN_EXPORT Local<Context> GetCurrentContext();

    Zig::GlobalObject* globalObject() { return reinterpret_cast<Zig::GlobalObject*>(this); }
    JSC::VM& vm() { return globalObject()->vm(); }
};

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = Bun__getDefaultGlobal();

    return global ? reinterpret_cast<v8::Isolate*>(global) : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = Bun__getDefaultGlobal();

    return global ? reinterpret_cast<v8::Isolate*>(global) : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return Local<Context> { reinterpret_cast<Context*>(this) };
}

MaybeLocal<String> String::NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int signed_length)
{
    (void)type;
    size_t length = 0;
    if (signed_length < 0) {
        length = strlen(data);
    } else {
        length = static_cast<int>(signed_length);
    }

    if (length > JSC::JSString::MaxLength) {
        // empty
        return MaybeLocal<String>();
    }

    std::span<const unsigned char> span(reinterpret_cast<const unsigned char*>(data), length);
    // ReplacingInvalidSequences matches how v8 behaves here
    auto string = WTF::String::fromUTF8ReplacingInvalidSequences(span);
    assert(!string.isNull());
    auto jsString = JSC::jsString(isolate->vm(), string);
    JSC::JSValue jsValue(jsString);
    Local<String> local(jsValue);
    return MaybeLocal<String>(local);
}

int String::WriteUtf8(Isolate* isolate, char* buffer, int length, int* nchars_ref, int options) const
{
    assert(options == 0);
    auto jsValue = toJSValue();
    WTF::String string = jsValue.getString(isolate->globalObject());

    if (!string.is8Bit()) {
        auto span = string.span16();
        for (auto c : span) {
            printf("%04x ", c);
        }
        printf("\n");
        abort();
    }

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
    WTF::String s;
    assert(jsValue.getString(Isolate::GetCurrent()->globalObject(), s));
    return s.length();
}

MaybeLocal<External> External::New(Isolate* isolate, void* value)
{
    auto globalObject = isolate->globalObject();
    auto& vm = globalObject->vm();
    auto structure = globalObject->NapiExternalStructure();
    JSC::JSValue val = Bun::NapiExternal::create(vm, structure, value, nullptr, nullptr);
    return MaybeLocal<External>(Local<External>(val));
}

void* External::Value() const
{
    JSC::JSValue val = toJSValue();
    auto* external = JSC::jsDynamicCast<Bun::NapiExternal*>(val);
    if (!external) {
        return nullptr;
    }
    return external->value();
}

}

namespace node {

BUN_EXPORT void AddEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg)
{
    // TODO
}

BUN_EXPORT void RemoveEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg)
{
    // TODO
}

}
