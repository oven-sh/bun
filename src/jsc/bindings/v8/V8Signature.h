#pragma once

#include "V8Data.h"
#include "V8Local.h"

namespace v8 {

class Isolate;
class FunctionTemplate;

class Signature : public Data {
public:
    BUN_EXPORT static Local<Signature> New(
        Isolate* isolate,
        Local<FunctionTemplate> receiver = Local<FunctionTemplate>());
};

} // namespace v8
