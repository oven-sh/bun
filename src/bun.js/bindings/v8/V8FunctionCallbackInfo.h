#pragma once

#include "shim/TaggedPointer.h"

namespace v8 {

class Isolate;
class Context;
class Value;

struct ImplicitArgs {
    // v8-function-callback.h:149-154
    void* unused; // kUnusedIndex = 0
    Isolate* isolate; // kIsolateIndex = 1
    void* context; // kContextIndex = 2
    TaggedPointer return_value; // kReturnValueIndex = 3
    TaggedPointer target; // kTargetIndex = 4
    void* new_target; // kNewTargetIndex = 5
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
