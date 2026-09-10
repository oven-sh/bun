#pragma once

#include "V8Object.h"
#include "V8FunctionTemplate.h"
#include "V8Local.h"
#include "V8MaybeLocal.h"
#include "V8String.h"
#include "V8ScriptOrigin.h"
#include "shim/Function.h"

namespace v8 {

class Context;

class Function : public Object {
public:
    static constexpr int kLineOffsetNotFound = -1;

    BUN_EXPORT MaybeLocal<Object> NewInstance(Local<Context> context, int argc, Local<Value> argv[]) const;

    // Inline in v8-function.h, but under dllimport MSVC emits a call to it
    // instead of inlining, so addons built with MSVC (debug) reference it as an
    // import.
    BUN_EXPORT MaybeLocal<Object> NewInstance(Local<Context> context) const;

    BUN_EXPORT MaybeLocal<Value> Call(Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[]);

    BUN_EXPORT void SetName(Local<String> name);
    BUN_EXPORT Local<Value> GetName() const;

    // The resource name is an empty Local for a native function, a builtin, or a function created
    // from a FunctionTemplate, as in V8. Line and column are 0-based and kLineOffsetNotFound (-1)
    // for those same functions.
    BUN_EXPORT ScriptOrigin GetScriptOrigin() const;
    BUN_EXPORT int GetScriptLineNumber() const;
    BUN_EXPORT int GetScriptColumnNumber() const;
};

} // namespace v8
