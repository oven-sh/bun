
#include "headers.h"
#include "root.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Identifier.h>


template<class CppType, typename ZigType>
class Wrap  {
public:
    Wrap(){
    };

    Wrap(ZigType zig){
        result = zig;
        cpp = static_cast<CppType*>(static_cast<void*>(&zig));
    };

     Wrap(ZigType* zig){
        cpp = static_cast<CppType*>(static_cast<void*>(&zig));
    };


    Wrap(CppType _cpp){
        auto buffer = alignedBuffer();
        cpp = new (buffer) CppType(_cpp);
    };


    ~Wrap(){};

    unsigned char* alignedBuffer() {
        return result.bytes + alignof(CppType) - reinterpret_cast<intptr_t>(result.bytes) % alignof(CppType);
    }

    ZigType result;
    CppType* cpp;

    static ZigType wrap(CppType obj) {
        return *static_cast<ZigType*>(static_cast<void*>(&obj));
    }

    static CppType unwrap(ZigType obj) {
        return *static_cast<CppType*>(static_cast<void*>(&obj));
    }

    static CppType* unwrap(ZigType* obj) {
        return static_cast<CppType*>(static_cast<void*>(obj));
    }

 

   
};





template<class To, class From>
To cast(From v)
{
    return *static_cast<To*>(static_cast<void*>(v));
}

template<class To, class From>
To ccast(From v)
{
    return *static_cast<const To*>(static_cast<const void*>(v));
}

typedef JSC__JSValue (* NativeCallbackFunction)(void* arg0, JSC__JSGlobalObject* arg1, JSC__CallFrame* arg2);

static const JSC::ArgList makeArgs(JSC__JSValue* v, size_t count) {
    JSC::MarkedArgumentBuffer args = JSC::MarkedArgumentBuffer();
    args.ensureCapacity(count);
    for (size_t i = 0; i < count; ++i) {
        args.append(JSC::JSValue::decode(v[i]));
    }

    return JSC::ArgList(args);
}

static const JSC::Identifier toIdentifier(ZigString str, JSC::JSGlobalObject* global) {
    if (str.len == 0 || str.ptr == nullptr) {
        return JSC::Identifier::EmptyIdentifier;
    }

    return JSC::Identifier::fromString(global->vm(), str.ptr, str.len);
}

static const WTF::String toString(ZigString str) {
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }

    return WTF::String(WTF::StringImpl::createWithoutCopying(str.ptr, str.len));
}

