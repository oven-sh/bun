// clang-format off
#pragma once

#include "root.h"

#include "CommonJSModuleRecord.h"
#include "ImportMetaObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "_NativeModule.h"
#include "isBuiltinModule.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>

using namespace Zig;
using namespace JSC;


namespace Bun {
  JSC_DECLARE_HOST_FUNCTION(jsFunctionIsModuleResolveFilenameSlowPathEnabled);
  void addNodeModuleConstructorProperties(JSC::VM &vm, Zig::GlobalObject *globalObject);
}

namespace Zig {

void generateNativeModule_NodeModule(                                     
  JSC::JSGlobalObject *lexicalGlobalObject, JSC::Identifier moduleKey,     
  Vector<JSC::Identifier, 4> &exportNames,
  JSC::MarkedArgumentBuffer &exportValues);  


} // namespace Zig
