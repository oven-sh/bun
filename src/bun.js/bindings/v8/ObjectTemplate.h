#pragma once

#include "v8.h"
#include "v8/Context.h"
#include "v8/Local.h"
#include "v8/Isolate.h"
#include "v8/FunctionTemplate.h"
#include "v8/MaybeLocal.h"
#include "v8/Object.h"

namespace v8 {

class ObjectTemplate : public JSC::InternalFunction {
public:
    DECLARE_INFO;

    BUN_EXPORT static Local<ObjectTemplate> New(Isolate* isolate, Local<FunctionTemplate> constructor = Local<FunctionTemplate>());
    BUN_EXPORT MaybeLocal<Object> NewInstance(Local<Context> context);
    BUN_EXPORT void SetInternalFieldCount(int value);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);
};

}
