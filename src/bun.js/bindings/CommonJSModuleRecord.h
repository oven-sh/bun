#include "root.h"
#include "headers-handwritten.h"

namespace Zig {
class GlobalObject;
}
namespace JSC {
class SourceCode;
class EvalExecutable;
class SyntheticModuleRecord;
}

namespace Bun {

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

JSC::SourceCode createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source);

JSC::JSValue evaluateCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSC::SyntheticModuleRecord* syntheticModuleRecord,
    EvalExecutable* executable);

} // namespace Bun
