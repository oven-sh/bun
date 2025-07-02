#pragma once

#include "shim/TaggedPointer.h"

namespace v8 {

class Isolate;
class Context;
class Value;

struct ImplicitArgs {
    // v8-function-callback.h:168
    void* holder;
    Isolate* isolate;
    void* unused;
    // overwritten by the callback
    TaggedPointer return_value;
    // holds the value passed for data in FunctionTemplate::New
    TaggedPointer data;
    void* new_target;
};

// T = return value
template<typename T>
class FunctionCallbackInfo {
public:
    // V8 treats this as an array of pointers
    ImplicitArgs* implicit_args;
    // index -1 is this
    TaggedPointer* values;
    int length;

    FunctionCallbackInfo(ImplicitArgs* implicit_args_, TaggedPointer* values_, int length_)
        : implicit_args(implicit_args_)
        , values(values_)
        , length(length_)
    {
    }
};

using FunctionCallback = void (*)(const FunctionCallbackInfo<Value>&);

}
