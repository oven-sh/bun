
#include "headers.h"
#include "root.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/VM.h>


template<class CppType, typename ZigType>
class Wrap  {
public:
    Wrap(){
    };

    Wrap(ZigType zig){
        result = zig;
        cpp = static_cast<CppType*>(static_cast<void*>(&zig));
    };

    Wrap(CppType _cpp){
        char* buffer = alignedBuffer();
        memcpy(buffer, std::move(reinterpret_cast<char*>(reinterpret_cast<void*>(&_cpp))), sizeof(CppType));
        cpp = reinterpret_cast<CppType*>(buffer);
    };


    ~Wrap(){};

    char* alignedBuffer() {
        return result.bytes + alignof(CppType) - reinterpret_cast<intptr_t>(result.bytes) % alignof(CppType);
    }

    ZigType result;
    CppType* cpp;

    static ZigType wrap(CppType obj) {
        return *static_cast<ZigType*>(static_cast<void*>(&obj));
    }

    static ZigType wrap(CppType* obj) {
        return *static_cast<ZigType*>(static_cast<void*>(obj));
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
